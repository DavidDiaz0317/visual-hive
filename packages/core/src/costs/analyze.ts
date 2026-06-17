import type { VisualHiveConfig } from "../config/schema.js";
import type { Plan } from "../planner/types.js";
import { inspectProviders, type ProviderInspection } from "../providers/inspect.js";
import type { MockProviderRunReport } from "../providers/mock.js";
import type { MutationReport, Report } from "../reports/types.js";
import { sanitizeText } from "../utils/sanitize.js";

export type CostRiskSeverity = "low" | "medium" | "high";
export type CostRiskCategory = "external_upload" | "budget" | "target_cost" | "mutation" | "provider" | "planning";

export interface CostRisk {
  id: string;
  category: CostRiskCategory;
  severity: CostRiskSeverity;
  title: string;
  message: string;
  evidence: string[];
  recommendation: string;
}

export interface CostProviderRow {
  providerId: string;
  label: string;
  enabled: boolean;
  mode: "mock" | "external";
  availability: ProviderInspection["availability"];
  deterministicRole: ProviderInspection["deterministicRole"];
  externalUploadAllowed: boolean;
  blockedReasons: string[];
  estimatedExternalScreenshots: number;
  externalCallsPlanned: number;
  externalCallsMade: number;
  missingEnv: string[];
}

export interface CostTargetRow {
  targetId: string;
  kind: string;
  cost: "cheap" | "medium" | "expensive";
  prSafe: boolean;
  selected: boolean;
  contractCount: number;
  screenshotCount: number;
}

export interface CostAuditReport {
  schemaVersion: 1;
  project: string;
  generatedAt: string;
  mode: string;
  summary: {
    selectedContracts: number;
    selectedTargets: number;
    localScreenshots: number;
    estimatedExternalScreenshots: number;
    externalCallsPlanned: number;
    externalCallsMade: number;
    enabledExternalProviders: number;
    policyBlockedProviders: number;
    missingCredentialProviders: number;
    expensiveTargetsSelected: number;
    mutationOperators: number;
    maxExternalScreenshotsPerRun: number;
    maxMonthlyExternalScreenshots: number;
    budgetStatus: "ok" | "blocked" | "warning";
  };
  costPolicy: VisualHiveConfig["costPolicy"];
  targets: CostTargetRow[];
  providers: CostProviderRow[];
  risks: CostRisk[];
  recommendations: string[];
}

export interface AnalyzeCostOptions {
  plan?: Plan;
  report?: Report;
  mutationReport?: MutationReport;
  providerRunReport?: MockProviderRunReport;
  env?: NodeJS.ProcessEnv;
  now?: Date;
}

export function analyzeCosts(config: VisualHiveConfig, options: AnalyzeCostOptions = {}): CostAuditReport {
  const selectedContractIds = selectedContracts(config, options);
  const selectedTargetIds = selectedTargets(config, selectedContractIds, options);
  const mode = options.report?.mode ?? options.plan?.mode ?? "manual";
  const localScreenshots = screenshotCount(config, selectedContractIds, options);
  const providers = buildProviders(config, options, localScreenshots);
  const targets = buildTargets(config, selectedContractIds, selectedTargetIds);
  const mutationOperators = options.mutationReport?.results.length ?? config.mutation.operators.length;
  const risks = buildRisks(config, targets, providers, localScreenshots, mutationOperators);
  const summary = summarize(config, targets, providers, selectedContractIds.length, mutationOperators);
  return sanitizeReport({
    schemaVersion: 1,
    project: config.project.name,
    generatedAt: (options.now ?? new Date()).toISOString(),
    mode,
    summary,
    costPolicy: config.costPolicy,
    targets,
    providers,
    risks,
    recommendations: recommendations(risks, summary)
  });
}

function selectedContracts(config: VisualHiveConfig, options: AnalyzeCostOptions): string[] {
  if (options.report?.selectedContracts?.length) return [...options.report.selectedContracts].sort();
  if (options.plan?.items?.length) return [...new Set(options.plan.items.map((item) => item.contractId))].sort();
  return config.contracts.filter((contract) => contract.runOn.pullRequest).map((contract) => contract.id).sort();
}

function selectedTargets(config: VisualHiveConfig, contractIds: string[], options: AnalyzeCostOptions): string[] {
  if (options.report?.selectedTargets?.length) return [...new Set(options.report.selectedTargets.map((target) => target.id))].sort();
  if (options.plan?.targets?.length) return [...new Set(options.plan.targets.map((target) => target.id))].sort();
  const selected = new Set(contractIds.map((id) => config.contracts.find((contract) => contract.id === id)?.target).filter(Boolean) as string[]);
  return [...selected].sort();
}

function screenshotCount(config: VisualHiveConfig, contractIds: string[], options: AnalyzeCostOptions): number {
  if (options.report?.results?.length) {
    return options.report.results.reduce((total, result) => total + (result.screenshotAssertions?.length ?? 0), 0);
  }
  if (options.plan?.items?.length) {
    return options.plan.items.reduce((total, item) => total + item.screenshots.length, 0);
  }
  const selected = new Set(contractIds);
  return config.contracts.filter((contract) => selected.has(contract.id)).reduce((total, contract) => total + contract.screenshots.length, 0);
}

function buildProviders(config: VisualHiveConfig, options: AnalyzeCostOptions, localScreenshots: number): CostProviderRow[] {
  const providerResults = new Map((options.providerRunReport?.providers ?? []).map((provider) => [provider.providerId, provider]));
  const deterministicStatus = options.report?.status ?? "passed";
  const selectedSeverities = selectedContracts(config, options)
    .map((contractId) => config.contracts.find((contract) => contract.id === contractId)?.severity)
    .filter(Boolean) as Array<VisualHiveConfig["contracts"][number]["severity"]>;
  return inspectProviders(config, options.env ?? process.env, {
    mode: options.report?.mode ?? options.plan?.mode ?? "manual",
    deterministicStatus,
    artifactCount: localScreenshots,
    selectedContractSeverities: selectedSeverities
  }).map((provider) => {
    const run = providerResults.get(provider.id);
    return {
      providerId: provider.id,
      label: provider.label,
      enabled: provider.enabled,
      mode: provider.mode,
      availability: provider.availability,
      deterministicRole: provider.deterministicRole,
      externalUploadAllowed: provider.id === "playwright" || provider.mode === "mock" || !provider.enabled ? true : provider.costPolicy.externalUploadAllowed,
      blockedReasons: provider.id === "playwright" || provider.mode === "mock" || !provider.enabled ? [] : provider.costPolicy.blockedReasons,
      estimatedExternalScreenshots: provider.id === "playwright" || !provider.enabled ? 0 : provider.costPolicy.estimatedExternalScreenshots,
      externalCallsPlanned: 0,
      externalCallsMade: run?.normalized.externalCallsMade ?? 0,
      missingEnv: provider.missingEnv
    };
  });
}

function buildTargets(config: VisualHiveConfig, contractIds: string[], targetIds: string[]): CostTargetRow[] {
  const selectedContracts = new Set(contractIds);
  const selectedTargets = new Set(targetIds);
  return Object.entries(config.targets)
    .map(([targetId, target]) => {
      const contracts = config.contracts.filter((contract) => contract.target === targetId && selectedContracts.has(contract.id));
      return {
        targetId,
        kind: target.kind,
        cost: target.cost,
        prSafe: target.prSafe,
        selected: selectedTargets.has(targetId),
        contractCount: contracts.length,
        screenshotCount: contracts.reduce((total, contract) => total + contract.screenshots.length, 0)
      };
    })
    .sort((a, b) => a.targetId.localeCompare(b.targetId));
}

function buildRisks(
  config: VisualHiveConfig,
  targets: CostTargetRow[],
  providers: CostProviderRow[],
  localScreenshots: number,
  mutationOperators: number
): CostRisk[] {
  const risks: CostRisk[] = [];
  const enabledExternal = providers.filter((provider) => provider.enabled && provider.providerId !== "playwright" && provider.mode === "external");
  const blocked = enabledExternal.filter((provider) => !provider.externalUploadAllowed);
  const missing = enabledExternal.filter((provider) => provider.missingEnv.length > 0);
  const expensiveSelected = targets.filter((target) => target.selected && target.cost === "expensive");

  if (config.costPolicy.externalUpload.pullRequest) {
    risks.push(risk("external-upload-pr", "external_upload", "high", "External upload is allowed on PRs", [
      "costPolicy.externalUpload.pullRequest=true"
    ], "Keep PR lanes local-only unless a trusted no-secret upload path is reviewed."));
  }
  if (localScreenshots > config.costPolicy.maxExternalScreenshotsPerRun) {
    risks.push(
      risk(
        "screenshot-budget-exceeded",
        "budget",
        "medium",
        "Selected screenshots exceed per-run external budget",
        [`localScreenshots=${localScreenshots}`, `maxExternalScreenshotsPerRun=${config.costPolicy.maxExternalScreenshotsPerRun}`],
        "Raise the budget after review, reduce selected contracts, or keep external providers policy-blocked."
      )
    );
  }
  if (expensiveSelected.length) {
    risks.push(
      risk(
        "expensive-targets-selected",
        "target_cost",
        "medium",
        "Expensive targets are selected",
        expensiveSelected.map((target) => target.targetId),
        "Keep expensive targets in scheduled/manual trusted lanes unless explicitly allowed."
      )
    );
  }
  if (enabledExternal.length && blocked.length === enabledExternal.length) {
    risks.push(
      risk(
        "external-providers-policy-blocked",
        "provider",
        "low",
        "External providers are enabled but policy-blocked",
        blocked.map((provider) => `${provider.providerId}: ${provider.blockedReasons.join(" ")}`),
        "This is a safe default. Record a provider decision before enabling real uploads."
      )
    );
  }
  if (missing.length) {
    risks.push(
      risk(
        "external-provider-missing-credentials",
        "provider",
        "medium",
        "External provider credential names are missing",
        missing.map((provider) => `${provider.providerId}: ${provider.missingEnv.join(", ")}`),
        "Configure credential names only in trusted workflows, or leave providers disabled/mock."
      )
    );
  }
  if (config.mutation.enabled && mutationOperators === 0) {
    risks.push(
      risk(
        "mutation-enabled-no-operators",
        "mutation",
        "medium",
        "Mutation is enabled without operators",
        ["mutation.enabled=true", "operators=0"],
        "Configure mutation operators so adequacy runs have a measurable scope."
      )
    );
  }
  if (!localScreenshots) {
    risks.push(
      risk(
        "no-screenshot-volume",
        "planning",
        "low",
        "No screenshot volume is selected",
        ["localScreenshots=0"],
        "Add screenshots to high-value contracts if visual drift matters."
      )
    );
  }
  return risks.sort((a, b) => severityWeight(b.severity) - severityWeight(a.severity) || a.id.localeCompare(b.id));
}

function summarize(
  config: VisualHiveConfig,
  targets: CostTargetRow[],
  providers: CostProviderRow[],
  selectedContracts: number,
  mutationOperators: number
): CostAuditReport["summary"] {
  const enabledExternal = providers.filter((provider) => provider.enabled && provider.providerId !== "playwright" && provider.mode === "external");
  const estimatedExternalScreenshots = providers.reduce((max, provider) => Math.max(max, provider.estimatedExternalScreenshots), 0);
  const policyBlockedProviders = providers.filter((provider) => provider.enabled && provider.availability === "policy_blocked").length;
  const missingCredentialProviders = providers.filter((provider) => provider.enabled && provider.availability === "missing_credentials").length;
  const externalCallsMade = providers.reduce((total, provider) => total + provider.externalCallsMade, 0);
  const expensiveTargetsSelected = targets.filter((target) => target.selected && target.cost === "expensive").length;
  const budgetStatus =
    policyBlockedProviders > 0 || !config.costPolicy.externalUpload.pullRequest
      ? "blocked"
      : missingCredentialProviders > 0 || expensiveTargetsSelected > 0
        ? "warning"
        : "ok";
  return {
    selectedContracts,
    selectedTargets: targets.filter((target) => target.selected).length,
    localScreenshots: targets.reduce((total, target) => total + (target.selected ? target.screenshotCount : 0), 0),
    estimatedExternalScreenshots,
    externalCallsPlanned: 0,
    externalCallsMade,
    enabledExternalProviders: enabledExternal.length,
    policyBlockedProviders,
    missingCredentialProviders,
    expensiveTargetsSelected,
    mutationOperators,
    maxExternalScreenshotsPerRun: config.costPolicy.maxExternalScreenshotsPerRun,
    maxMonthlyExternalScreenshots: config.costPolicy.maxMonthlyExternalScreenshots,
    budgetStatus
  };
}

function recommendations(risks: CostRisk[], summary: CostAuditReport["summary"]): string[] {
  const recs = new Set<string>();
  if (summary.externalCallsPlanned === 0) recs.add("Keep default PR runs local-only; external providers should remain supplemental until explicitly approved.");
  if (summary.policyBlockedProviders > 0) recs.add("Review provider decisions before changing costPolicy to allow external uploads.");
  if (summary.expensiveTargetsSelected > 0) recs.add("Move expensive targets to scheduled/manual trusted lanes unless PR value justifies the cost.");
  if (risks.some((item) => item.category === "budget")) recs.add("Tune maxExternalScreenshotsPerRun or reduce selected screenshot volume before enabling hosted uploads.");
  if (!recs.size) recs.add("Current Visual Hive cost posture is local-first and within configured policy.");
  return [...recs];
}

function risk(
  id: string,
  category: CostRiskCategory,
  severity: CostRiskSeverity,
  title: string,
  evidence: string[],
  recommendation: string
): CostRisk {
  return {
    id,
    category,
    severity,
    title,
    message: title,
    evidence,
    recommendation
  };
}

function severityWeight(severity: CostRiskSeverity): number {
  return { low: 1, medium: 2, high: 3 }[severity];
}

function sanitizeReport(report: CostAuditReport): CostAuditReport {
  return JSON.parse(JSON.stringify(report), (_key, value: unknown) => (typeof value === "string" ? sanitizeText(value) : value)) as CostAuditReport;
}
