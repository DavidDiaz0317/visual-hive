import type { ContractConfig, MutationOperator, VisualHiveConfig } from "../config/schema.js";
import { MUTATION_OPERATOR_METADATA, mutationOperatorId, selectContractsForMutation } from "../mutations/operators.js";
import type { Plan } from "../planner/types.js";
import type { MutationReport, Report } from "../reports/types.js";

export interface ContractAuditReport {
  schemaVersion: 1;
  project: string;
  generatedAt: string;
  mode?: Plan["mode"] | Report["mode"];
  summary: ContractAuditSummary;
  contracts: ContractAuditEntry[];
}

export interface ContractAuditSummary {
  contractCount: number;
  selectedContracts: number;
  notRunContracts: number;
  failedContracts: number;
  assertionFreeContracts: number;
  screenshotlessContracts: number;
  contractsWithoutWaitFor: number;
  contractsWithoutChangedFileRules: number;
  mutationMappedContracts: number;
  contractsWithHighSeverityGaps: number;
}

export interface ContractAuditEntry {
  id: string;
  description: string;
  targetId: string;
  targetKind: VisualHiveConfig["targets"][string]["kind"];
  targetPrSafe: boolean;
  targetCost: VisualHiveConfig["targets"][string]["cost"];
  severity: ContractConfig["severity"];
  runOn: {
    pullRequest: boolean;
    schedule: boolean;
  };
  waitFor: Array<{ selector: string; state: string; timeoutMs: number }>;
  selectors: {
    mustExist: string[];
    mustNotExist: string[];
    textMustExist: string[];
    textMustNotExist: string[];
    total: number;
  };
  screenshots: Array<{ name: string; route: string; viewport: string; fullPage: boolean; masks: string[] }>;
  routes: string[];
  viewports: string[];
  consoleRules: {
    failOnConsoleError: boolean;
    expectedConsoleErrors: string[];
  };
  selected: boolean;
  latestStatus: "passed" | "failed" | "created" | "skipped" | "not_run";
  latestDurationMs?: number;
  mutationMappings: ContractMutationMapping[];
  mutationResults: Array<{ operator: string; status: string; killed: boolean }>;
  changedFileRules: Array<{ pattern: string; risk: string }>;
  gaps: ContractAuditGap[];
  recommendations: string[];
}

export interface ContractMutationMapping {
  operator: MutationOperator;
  reason: string;
  expectedFailureKinds: string[];
}

export interface ContractAuditGap {
  kind:
    | "no_assertions"
    | "no_screenshots"
    | "no_wait_for"
    | "no_changed_file_rule"
    | "pr_unsafe_target"
    | "not_selected"
    | "failed_latest_run"
    | "no_mutation_mapping";
  severity: "low" | "medium" | "high";
  message: string;
}

export interface AuditContractsOptions {
  plan?: Plan;
  report?: Report;
  mutationReport?: MutationReport;
  selectedContractIds?: string[];
  now?: Date;
}

export function auditContracts(config: VisualHiveConfig, options: AuditContractsOptions = {}): ContractAuditReport {
  const selectedContracts = new Set(
    options.plan?.items.map((item) => item.contractId) ?? options.selectedContractIds ?? options.report?.selectedContracts ?? []
  );
  const reportResults = new Map((options.report?.results ?? []).map((result) => [result.contractId, result]));
  const mutationResults = options.mutationReport?.results ?? [];
  const mutationMappings = collectMutationMappings(config);
  const changedFileRules = collectChangedFileRules(config);

  const contracts = config.contracts
    .map((contract) => {
      const target = config.targets[contract.target];
      const latest = reportResults.get(contract.id);
      const mappedMutations = mutationMappings.get(contract.id) ?? [];
      const contractMutationResults = mutationResults
        .filter((result) => result.contractIds.includes(contract.id))
        .map((result) => ({ operator: result.operator, status: result.status, killed: result.killed }));
      const rules = changedFileRules.get(contract.id) ?? [];
      const selectorTotal =
        contract.selectors.mustExist.length +
        contract.selectors.mustNotExist.length +
        contract.selectors.textMustExist.length +
        contract.selectors.textMustNotExist.length;
      const routes = unique(contract.screenshots.map((shot) => shot.route)).sort();
      const viewports = unique(contract.screenshots.map((shot) => shot.viewport)).sort();
      const gaps = collectGaps({
        contract,
        targetPrSafe: target.prSafe,
        selected: selectedContracts.has(contract.id),
        latestStatus: latest?.status,
        selectorTotal,
        mutationMappings: mappedMutations,
        changedFileRules: rules,
        planProvided: Boolean(options.plan || options.report)
      });

      return {
        id: contract.id,
        description: contract.description,
        targetId: contract.target,
        targetKind: target.kind,
        targetPrSafe: target.prSafe,
        targetCost: target.cost,
        severity: contract.severity,
        runOn: {
          pullRequest: contract.runOn.pullRequest,
          schedule: contract.runOn.schedule
        },
        waitFor: contract.waitFor.map((wait) => ({ selector: wait.selector, state: wait.state, timeoutMs: wait.timeoutMs })),
        selectors: {
          mustExist: [...contract.selectors.mustExist],
          mustNotExist: [...contract.selectors.mustNotExist],
          textMustExist: [...contract.selectors.textMustExist],
          textMustNotExist: [...contract.selectors.textMustNotExist],
          total: selectorTotal
        },
        screenshots: contract.screenshots.map((shot) => ({
          name: shot.name,
          route: shot.route,
          viewport: shot.viewport,
          fullPage: shot.fullPage,
          masks: [...shot.mask]
        })),
        routes,
        viewports,
        consoleRules: {
          failOnConsoleError: contract.failOnConsoleError,
          expectedConsoleErrors: [...contract.expectedConsoleErrors]
        },
        selected: selectedContracts.has(contract.id),
        latestStatus: latest?.status ?? "not_run",
        latestDurationMs: latest?.durationMs,
        mutationMappings: mappedMutations,
        mutationResults: contractMutationResults,
        changedFileRules: rules,
        gaps,
        recommendations: recommendationsFor(contract, gaps)
      } satisfies ContractAuditEntry;
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  return {
    schemaVersion: 1,
    project: config.project.name,
    generatedAt: (options.now ?? new Date()).toISOString(),
    mode: options.plan?.mode ?? options.report?.mode,
    summary: {
      contractCount: contracts.length,
      selectedContracts: contracts.filter((contract) => contract.selected).length,
      notRunContracts: contracts.filter((contract) => contract.latestStatus === "not_run").length,
      failedContracts: contracts.filter((contract) => contract.latestStatus === "failed").length,
      assertionFreeContracts: contracts.filter((contract) => contract.selectors.total + contract.screenshots.length === 0).length,
      screenshotlessContracts: contracts.filter((contract) => contract.screenshots.length === 0).length,
      contractsWithoutWaitFor: contracts.filter((contract) => contract.waitFor.length === 0).length,
      contractsWithoutChangedFileRules: contracts.filter((contract) => contract.changedFileRules.length === 0).length,
      mutationMappedContracts: contracts.filter((contract) => contract.mutationMappings.length > 0).length,
      contractsWithHighSeverityGaps: contracts.filter((contract) => contract.gaps.some((gap) => gap.severity === "high")).length
    },
    contracts
  };
}

function collectMutationMappings(config: VisualHiveConfig): Map<string, ContractMutationMapping[]> {
  const mappings = new Map<string, ContractMutationMapping[]>();
  for (const operator of config.mutation.operators) {
    const selected = selectContractsForMutation(operator, config.contracts);
    const metadata = MUTATION_OPERATOR_METADATA[mutationOperatorId(operator)];
    for (const contractId of selected.contractIds) {
      const existing = mappings.get(contractId) ?? [];
      existing.push({
        operator: metadata.id,
        reason: selected.reason,
        expectedFailureKinds: [...metadata.expectedFailureKinds]
      });
      mappings.set(contractId, existing);
    }
  }
  return mappings;
}

function collectChangedFileRules(config: VisualHiveConfig): Map<string, Array<{ pattern: string; risk: string }>> {
  const rules = new Map<string, Array<{ pattern: string; risk: string }>>();
  for (const rule of config.selection.changedFiles) {
    for (const contractId of rule.contracts) {
      const existing = rules.get(contractId) ?? [];
      existing.push({ pattern: rule.pattern, risk: rule.risk });
      rules.set(contractId, existing);
    }
  }
  return rules;
}

function collectGaps(input: {
  contract: ContractConfig;
  targetPrSafe: boolean;
  selected: boolean;
  latestStatus?: string;
  selectorTotal: number;
  mutationMappings: ContractMutationMapping[];
  changedFileRules: Array<{ pattern: string; risk: string }>;
  planProvided: boolean;
}): ContractAuditGap[] {
  const gaps: ContractAuditGap[] = [];
  if (input.selectorTotal + input.contract.screenshots.length === 0) {
    gaps.push({
      kind: "no_assertions",
      severity: input.contract.severity === "critical" ? "high" : "medium",
      message: "Contract has no selector, text, or screenshot assertions."
    });
  }
  if (input.contract.screenshots.length === 0) {
    gaps.push({
      kind: "no_screenshots",
      severity: input.contract.severity === "critical" || input.contract.severity === "high" ? "medium" : "low",
      message: "Contract has no screenshot assertions."
    });
  }
  if (input.contract.waitFor.length === 0 && input.selectorTotal + input.contract.screenshots.length > 0) {
    gaps.push({
      kind: "no_wait_for",
      severity: "low",
      message: "Contract has no explicit waitFor selector before assertions."
    });
  }
  if (input.changedFileRules.length === 0) {
    gaps.push({
      kind: "no_changed_file_rule",
      severity: "low",
      message: "No changed-file selection rule references this contract."
    });
  }
  if (input.contract.runOn.pullRequest && !input.targetPrSafe) {
    gaps.push({
      kind: "pr_unsafe_target",
      severity: "high",
      message: "Contract is PR-enabled but its target is not PR safe, so PR plans will exclude it unless unsafe targets are explicitly allowed."
    });
  }
  if (input.planProvided && !input.selected && input.contract.runOn.pullRequest) {
    gaps.push({
      kind: "not_selected",
      severity: "medium",
      message: "Contract was not selected by the latest plan or report."
    });
  }
  if (input.latestStatus === "failed") {
    gaps.push({
      kind: "failed_latest_run",
      severity: "high",
      message: "Latest deterministic report shows this contract failed."
    });
  }
  if (input.contract.severity === "critical" && input.mutationMappings.length === 0) {
    gaps.push({
      kind: "no_mutation_mapping",
      severity: "medium",
      message: "Critical contract has no explicit or heuristic mutation operator mapping."
    });
  }
  return gaps.sort((a, b) => `${rank(b.severity)}:${a.kind}`.localeCompare(`${rank(a.severity)}:${b.kind}`));
}

function recommendationsFor(contract: ContractConfig, gaps: ContractAuditGap[]): string[] {
  const recommendations: string[] = [];
  for (const gap of gaps) {
    if (gap.kind === "no_assertions") {
      recommendations.push(`Add mustExist/mustNotExist selectors or a screenshot for "${contract.id}".`);
    } else if (gap.kind === "no_screenshots") {
      recommendations.push(`Add at least one deterministic screenshot route/viewport for "${contract.id}" if layout drift matters.`);
    } else if (gap.kind === "no_wait_for") {
      recommendations.push(`Add waitFor selectors so "${contract.id}" does not depend on generic navigation timing.`);
    } else if (gap.kind === "no_changed_file_rule") {
      recommendations.push(`Map changed files to "${contract.id}" under selection.changedFiles.`);
    } else if (gap.kind === "pr_unsafe_target") {
      recommendations.push(`Move "${contract.id}" to a PR-safe target or keep it schedule/manual-only.`);
    } else if (gap.kind === "not_selected") {
      recommendations.push(`Review runOn, target safety, and changed-file rules for "${contract.id}".`);
    } else if (gap.kind === "failed_latest_run") {
      recommendations.push(`Inspect report artifacts and reproduce with the contract's latest run command.`);
    } else if (gap.kind === "no_mutation_mapping") {
      recommendations.push(`Map a relevant mutation operator to "${contract.id}" to measure adequacy.`);
    }
  }
  return unique(recommendations);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function rank(severity: ContractAuditGap["severity"]): number {
  return { low: 1, medium: 2, high: 3 }[severity];
}
