import { minimatch } from "minimatch";
import type { ContractConfig, TargetConfig, VisualHiveConfig } from "../config/schema.js";
import type { Plan } from "../planner/types.js";
import { getEvidenceResourceById } from "../tools/evidenceResources.js";

export interface CoverageReport {
  schemaVersion: 1;
  project: string;
  generatedAt: string;
  mode?: Plan["mode"];
  outputResource?: CoverageOutputResource;
  summary: CoverageSummary;
  targets: CoverageTarget[];
  contracts: CoverageContract[];
  routes: CoverageRoute[];
  viewports: CoverageViewport[];
  changedFileCoverage: ChangedFileCoverageRule[];
  unmatchedChangedFiles: string[];
  uncoveredAreas: CoverageGap[];
}

export interface CoverageOutputResource {
  artifactPath: string;
  evidenceResourceId: string;
  evidenceResourceUri: string;
  evidenceResourceTitle: string;
  evidenceResourceDescription: string;
  evidenceReadToolName?: string;
}

export interface CoverageSummary {
  targetCount: number;
  contractCount: number;
  selectedContracts: number;
  unselectedContracts: number;
  prSafeContracts: number;
  protectedContracts: number;
  scheduleOnlyContracts: number;
  routesCovered: number;
  viewportsCovered: number;
  uncoveredTargets: number;
  uncoveredContracts: number;
  changedFileRules: number;
  matchedChangedFileRules: number;
  unmatchedChangedFiles: number;
}

export interface CoverageTarget {
  id: string;
  kind: TargetConfig["kind"];
  prSafe: boolean;
  protected: boolean;
  cost: TargetConfig["cost"];
  schedule?: string;
  requiresSecrets?: string[];
  contractIds: string[];
  selectedContractIds: string[];
  uncovered: boolean;
}

export interface CoverageContract {
  id: string;
  targetId: string;
  severity: ContractConfig["severity"];
  prSafeTarget: boolean;
  protectedTarget: boolean;
  runOnPullRequest: boolean;
  runOnSchedule: boolean;
  scheduleOnly: boolean;
  selected: boolean;
  excludedReasons: string[];
  selectorCount: number;
  textAssertionCount: number;
  flowStepCount: number;
  screenshotCount: number;
  routes: string[];
  viewports: string[];
  changedFileRules: string[];
}

export interface CoverageRoute {
  route: string;
  contracts: string[];
  targets: string[];
  viewports: string[];
  selectedContracts: string[];
}

export interface CoverageViewport {
  viewport: string;
  width: number;
  height: number;
  routes: string[];
  contracts: string[];
  selectedContracts: string[];
}

export interface ChangedFileCoverageRule {
  pattern: string;
  risk: ContractConfig["severity"];
  contracts: string[];
  matchedFiles: string[];
  selectedContracts: string[];
  unselectedContracts: string[];
  excludedContracts: Array<{ contractId: string; reasons: string[] }>;
}

export interface CoverageGap {
  kind:
    | "target_without_contracts"
    | "contract_without_assertions"
    | "contract_unselected"
    | "route_without_pr_safe_coverage"
    | "viewport_without_screenshots"
    | "changed_file_without_rule";
  severity: "low" | "medium" | "high";
  message: string;
  targetId?: string;
  contractId?: string;
  route?: string;
  viewport?: string;
  changedFile?: string;
}

export interface AnalyzeCoverageOptions {
  plan?: Plan;
  selectedContractIds?: string[];
  changedFiles?: string[];
  now?: Date;
}

export function analyzeCoverage(config: VisualHiveConfig, options: AnalyzeCoverageOptions = {}): CoverageReport {
  const selectedContracts = new Set(options.plan ? options.plan.items.map((item) => item.contractId) : (options.selectedContractIds ?? []));
  const excludedReasons = new Map((options.plan?.excluded ?? []).map((item) => [item.contractId, item.reasons]));
  const changedFiles = options.changedFiles ?? options.plan?.effectiveChangedFiles ?? options.plan?.changedFiles ?? [];
  const contractById = new Map(config.contracts.map((contract) => [contract.id, contract]));
  const contractsByTarget = new Map<string, string[]>();
  const changedRulesByContract = new Map<string, string[]>();

  for (const targetId of Object.keys(config.targets)) {
    contractsByTarget.set(targetId, []);
  }
  for (const contract of config.contracts) {
    contractsByTarget.get(contract.target)?.push(contract.id);
  }

  const changedFileCoverage = config.selection.changedFiles.map((rule) => {
    const matchedFiles = changedFiles.filter((file) => minimatch(normalizePath(file), normalizePath(rule.pattern), { dot: true }));
    for (const contractId of rule.contracts) {
      const existing = changedRulesByContract.get(contractId) ?? [];
      existing.push(rule.pattern);
      changedRulesByContract.set(contractId, existing);
    }
    return {
      pattern: rule.pattern,
      risk: rule.risk,
      contracts: [...rule.contracts],
      matchedFiles,
      selectedContracts: rule.contracts.filter((contractId) => selectedContracts.has(contractId)),
      unselectedContracts: rule.contracts.filter((contractId) => !selectedContracts.has(contractId)),
      excludedContracts: rule.contracts
        .filter((contractId) => excludedReasons.has(contractId))
        .map((contractId) => ({ contractId, reasons: excludedReasons.get(contractId) ?? [] }))
    };
  });

  const unmatchedChangedFiles = changedFiles.filter(
    (file) => !config.selection.changedFiles.some((rule) => minimatch(normalizePath(file), normalizePath(rule.pattern), { dot: true }))
  );

  const targets: CoverageTarget[] = Object.entries(config.targets)
    .map(([id, target]) => {
      const contractIds = contractsByTarget.get(id) ?? [];
      return {
        id,
        kind: target.kind,
        prSafe: target.prSafe,
        protected: target.kind === "protected",
        cost: target.cost,
        schedule: target.schedule,
        requiresSecrets: target.kind === "protected" ? target.requiresSecrets : undefined,
        contractIds,
        selectedContractIds: contractIds.filter((contractId) => selectedContracts.has(contractId)),
        uncovered: contractIds.length === 0
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  const contracts: CoverageContract[] = config.contracts
    .map((contract) => {
      const target = config.targets[contract.target];
      const selectorCount = contract.selectors.mustExist.length + contract.selectors.mustNotExist.length;
      const textAssertionCount = contract.selectors.textMustExist.length + contract.selectors.textMustNotExist.length;
      const flowStepCount = contract.steps.length;
      const routes = unique(contract.screenshots.map((shot) => shot.route)).sort();
      const viewports = unique(contract.screenshots.map((shot) => shot.viewport)).sort();
      return {
        id: contract.id,
        targetId: contract.target,
        severity: contract.severity,
        prSafeTarget: target?.prSafe ?? false,
        protectedTarget: target?.kind === "protected",
        runOnPullRequest: contract.runOn.pullRequest,
        runOnSchedule: contract.runOn.schedule,
        scheduleOnly: contract.runOn.schedule && !contract.runOn.pullRequest,
        selected: selectedContracts.has(contract.id),
        excludedReasons: excludedReasons.get(contract.id) ?? [],
        selectorCount,
        textAssertionCount,
        flowStepCount,
        screenshotCount: contract.screenshots.length,
        routes,
        viewports,
        changedFileRules: changedRulesByContract.get(contract.id) ?? []
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  const routes = collectRoutes(config, selectedContracts);
  const viewports = collectViewports(config, selectedContracts);
  const uncoveredAreas = collectGaps({
    config,
    contracts,
    targets,
    routes,
    viewports,
    unmatchedChangedFiles,
    contractById,
    selectedContracts,
    planProvided: Boolean(options.plan)
  });

  return {
    schemaVersion: 1,
    project: config.project.name,
    generatedAt: (options.now ?? new Date()).toISOString(),
    mode: options.plan?.mode,
    outputResource: catalogedCoverageOutputResource(),
    summary: {
      targetCount: targets.length,
      contractCount: contracts.length,
      selectedContracts: selectedContracts.size,
      unselectedContracts: Math.max(0, contracts.length - selectedContracts.size),
      prSafeContracts: contracts.filter((contract) => contract.prSafeTarget).length,
      protectedContracts: contracts.filter((contract) => contract.protectedTarget).length,
      scheduleOnlyContracts: contracts.filter((contract) => contract.scheduleOnly).length,
      routesCovered: routes.length,
      viewportsCovered: viewports.length,
      uncoveredTargets: targets.filter((target) => target.uncovered).length,
      uncoveredContracts: contracts.filter((contract) => contract.selectorCount + contract.textAssertionCount + contract.flowStepCount + contract.screenshotCount === 0).length,
      changedFileRules: changedFileCoverage.length,
      matchedChangedFileRules: changedFileCoverage.filter((rule) => rule.matchedFiles.length > 0).length,
      unmatchedChangedFiles: unmatchedChangedFiles.length
    },
    targets,
    contracts,
    routes,
    viewports,
    changedFileCoverage,
    unmatchedChangedFiles,
    uncoveredAreas
  };
}

function catalogedCoverageOutputResource(): CoverageOutputResource {
  const resource = getEvidenceResourceById("coverage-map");
  return {
    artifactPath: ".visual-hive/coverage.json",
    evidenceResourceId: resource?.id ?? "coverage-map",
    evidenceResourceUri: resource?.uri ?? "visual-hive://coverage-map",
    evidenceResourceTitle: resource?.title ?? "Coverage Map",
    evidenceResourceDescription: resource?.description ?? "Visual coverage and missing-test guidance.",
    ...(resource?.readTool?.name ? { evidenceReadToolName: resource.readTool.name } : {})
  };
}

function collectRoutes(config: VisualHiveConfig, selectedContracts: Set<string>): CoverageRoute[] {
  const routes = new Map<string, { contracts: Set<string>; targets: Set<string>; viewports: Set<string>; selectedContracts: Set<string> }>();
  for (const contract of config.contracts) {
    for (const screenshot of contract.screenshots) {
      const entry = routes.get(screenshot.route) ?? {
        contracts: new Set<string>(),
        targets: new Set<string>(),
        viewports: new Set<string>(),
        selectedContracts: new Set<string>()
      };
      entry.contracts.add(contract.id);
      entry.targets.add(contract.target);
      entry.viewports.add(screenshot.viewport);
      if (selectedContracts.has(contract.id)) {
        entry.selectedContracts.add(contract.id);
      }
      routes.set(screenshot.route, entry);
    }
  }
  return [...routes.entries()]
    .map(([route, entry]) => ({
      route,
      contracts: [...entry.contracts].sort(),
      targets: [...entry.targets].sort(),
      viewports: [...entry.viewports].sort(),
      selectedContracts: [...entry.selectedContracts].sort()
    }))
    .sort((a, b) => a.route.localeCompare(b.route));
}

function collectViewports(config: VisualHiveConfig, selectedContracts: Set<string>): CoverageViewport[] {
  const coverage = new Map<string, { routes: Set<string>; contracts: Set<string>; selectedContracts: Set<string> }>();
  for (const contract of config.contracts) {
    for (const screenshot of contract.screenshots) {
      const entry = coverage.get(screenshot.viewport) ?? {
        routes: new Set<string>(),
        contracts: new Set<string>(),
        selectedContracts: new Set<string>()
      };
      entry.routes.add(screenshot.route);
      entry.contracts.add(contract.id);
      if (selectedContracts.has(contract.id)) {
        entry.selectedContracts.add(contract.id);
      }
      coverage.set(screenshot.viewport, entry);
    }
  }
  return Object.entries(config.viewports)
    .map(([viewport, size]) => {
      const entry = coverage.get(viewport) ?? { routes: new Set<string>(), contracts: new Set<string>(), selectedContracts: new Set<string>() };
      return {
        viewport,
        width: size.width,
        height: size.height,
        routes: [...entry.routes].sort(),
        contracts: [...entry.contracts].sort(),
        selectedContracts: [...entry.selectedContracts].sort()
      };
    })
    .sort((a, b) => a.viewport.localeCompare(b.viewport));
}

function collectGaps(input: {
  config: VisualHiveConfig;
  contracts: CoverageContract[];
  targets: CoverageTarget[];
  routes: CoverageRoute[];
  viewports: CoverageViewport[];
  unmatchedChangedFiles: string[];
  contractById: Map<string, ContractConfig>;
  selectedContracts: Set<string>;
  planProvided: boolean;
}): CoverageGap[] {
  const gaps: CoverageGap[] = [];
  for (const target of input.targets.filter((target) => target.uncovered)) {
    gaps.push({
      kind: "target_without_contracts",
      severity: target.protected ? "medium" : "high",
      targetId: target.id,
      message: `Target "${target.id}" has no configured contracts.`
    });
  }
  for (const contract of input.contracts.filter((contract) => contract.selectorCount + contract.textAssertionCount + contract.flowStepCount + contract.screenshotCount === 0)) {
    gaps.push({
      kind: "contract_without_assertions",
      severity: contract.severity === "critical" ? "high" : "medium",
      contractId: contract.id,
      targetId: contract.targetId,
      message: `Contract "${contract.id}" has no selector, text, flow, or screenshot assertions.`
    });
  }
  if (input.planProvided) {
    for (const contract of input.contracts.filter((contract) => !contract.selected && contract.excludedReasons.length === 0)) {
      gaps.push({
        kind: "contract_unselected",
        severity: contract.runOnPullRequest || contract.runOnSchedule ? "low" : "medium",
        contractId: contract.id,
        targetId: contract.targetId,
        message: `Contract "${contract.id}" was not selected by the current plan.`
      });
    }
  }
  for (const route of input.routes) {
    const hasPrSafeContract = route.contracts.some((contractId) => {
      const contract = input.contractById.get(contractId);
      return contract ? input.config.targets[contract.target]?.prSafe : false;
    });
    if (!hasPrSafeContract) {
      gaps.push({
        kind: "route_without_pr_safe_coverage",
        severity: "medium",
        route: route.route,
        message: `Route "${route.route}" has no PR-safe screenshot coverage.`
      });
    }
  }
  for (const viewport of input.viewports.filter((viewport) => viewport.contracts.length === 0)) {
    gaps.push({
      kind: "viewport_without_screenshots",
      severity: viewport.viewport === "mobile" ? "medium" : "low",
      viewport: viewport.viewport,
      message: `Viewport "${viewport.viewport}" is configured but has no screenshot coverage.`
    });
  }
  for (const changedFile of input.unmatchedChangedFiles) {
    gaps.push({
      kind: "changed_file_without_rule",
      severity: "low",
      changedFile,
      message: `Changed file "${changedFile}" did not match any selection rule.`
    });
  }
  return gaps.sort((a, b) => `${severityRank(b.severity)}:${a.kind}:${a.message}`.localeCompare(`${severityRank(a.severity)}:${b.kind}:${b.message}`));
}

function severityRank(severity: CoverageGap["severity"]): number {
  return { low: 1, medium: 2, high: 3 }[severity];
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/");
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
