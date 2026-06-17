import type { ContractConfig, VisualHiveConfig } from "../config/schema.js";
import type { Plan } from "../planner/types.js";
import type { FlowStepResult, Report } from "../reports/types.js";

export interface FlowAuditReport {
  schemaVersion: 1;
  project: string;
  generatedAt: string;
  mode?: Plan["mode"] | Report["mode"];
  summary: FlowAuditSummary;
  flows: FlowAuditEntry[];
  recommendations: string[];
}

export interface FlowAuditSummary {
  contractCount: number;
  flowContractCount: number;
  selectedFlowContracts: number;
  flowStepCount: number;
  navigationSteps: number;
  interactionSteps: number;
  assertionSteps: number;
  failedFlowSteps: number;
  contractsWithoutFlow: number;
  criticalContractsWithoutFlow: number;
  highSeverityFlowGaps: number;
}

export interface FlowAuditEntry {
  contractId: string;
  targetId: string;
  targetKind: VisualHiveConfig["targets"][string]["kind"];
  severity: ContractConfig["severity"];
  selected: boolean;
  runOn: {
    pullRequest: boolean;
    schedule: boolean;
  };
  steps: FlowAuditStep[];
  latestStatus: "passed" | "failed" | "created" | "skipped" | "not_run";
  latestPassedSteps: number;
  latestFailedSteps: number;
  latestFailedMessages: string[];
  gaps: FlowAuditGap[];
  recommendations: string[];
}

export interface FlowAuditStep {
  index: number;
  action: FlowStepResult["action"];
  description?: string;
  selector?: string;
  route?: string;
  value?: string;
  timeoutMs: number;
  category: "navigation" | "interaction" | "assertion" | "wait";
}

export interface FlowAuditGap {
  kind: "no_flow_steps" | "no_navigation_step" | "no_assertion_step" | "failed_latest_flow" | "flow_not_selected";
  severity: "low" | "medium" | "high";
  message: string;
}

export interface AuditFlowsOptions {
  plan?: Plan;
  report?: Report;
  selectedContractIds?: string[];
  now?: Date;
}

export function auditFlows(config: VisualHiveConfig, options: AuditFlowsOptions = {}): FlowAuditReport {
  const selectedContracts = new Set(
    options.plan?.items.map((item) => item.contractId) ?? options.selectedContractIds ?? options.report?.selectedContracts ?? []
  );
  const reportResults = new Map((options.report?.results ?? []).map((result) => [result.contractId, result]));
  const flows = config.contracts
    .map((contract) => {
      const target = config.targets[contract.target];
      const latest = reportResults.get(contract.id);
      const steps = contract.steps.map((step, index) => ({
        index,
        action: step.action,
        description: step.description,
        selector: step.selector,
        route: step.route,
        value: visibleValue(step),
        timeoutMs: step.timeoutMs,
        category: categorizeStep(step.action)
      }));
      const latestFlowSteps = latest?.flowSteps ?? [];
      const latestFailedMessages = latestFlowSteps
        .filter((step) => step.status === "failed")
        .map((step) => step.message ?? `${step.action} failed`)
        .filter(Boolean)
        .slice(0, 5);
      const gaps = collectGaps({
        contract,
        selected: selectedContracts.has(contract.id),
        hasNavigation: steps.some((step) => step.category === "navigation"),
        hasAssertion: steps.some((step) => step.category === "assertion"),
        latestFailedSteps: latestFlowSteps.filter((step) => step.status === "failed").length,
        planProvided: Boolean(options.plan || options.report)
      });
      return {
        contractId: contract.id,
        targetId: contract.target,
        targetKind: target.kind,
        severity: contract.severity,
        selected: selectedContracts.has(contract.id),
        runOn: {
          pullRequest: contract.runOn.pullRequest,
          schedule: contract.runOn.schedule
        },
        steps,
        latestStatus: latest?.status ?? "not_run",
        latestPassedSteps: latestFlowSteps.filter((step) => step.status === "passed").length,
        latestFailedSteps: latestFlowSteps.filter((step) => step.status === "failed").length,
        latestFailedMessages,
        gaps,
        recommendations: recommendationsFor(contract, gaps)
      } satisfies FlowAuditEntry;
    })
    .sort((a, b) => a.contractId.localeCompare(b.contractId));

  const summary = summarize(flows);
  return {
    schemaVersion: 1,
    project: config.project.name,
    generatedAt: (options.now ?? new Date()).toISOString(),
    mode: options.plan?.mode ?? options.report?.mode,
    summary,
    flows,
    recommendations: buildRecommendations(flows, summary)
  };
}

function collectGaps(input: {
  contract: ContractConfig;
  selected: boolean;
  hasNavigation: boolean;
  hasAssertion: boolean;
  latestFailedSteps: number;
  planProvided: boolean;
}): FlowAuditGap[] {
  const gaps: FlowAuditGap[] = [];
  if (input.contract.steps.length === 0) {
    gaps.push({
      kind: "no_flow_steps",
      severity: input.contract.severity === "critical" ? "high" : input.contract.severity === "high" ? "medium" : "low",
      message: "Contract has no deterministic user-flow steps."
    });
  } else {
    if (!input.hasNavigation) {
      gaps.push({
        kind: "no_navigation_step",
        severity: "low",
        message: "Flow has no explicit goto step, so it depends on screenshot/assertion navigation."
      });
    }
    if (!input.hasAssertion) {
      gaps.push({
        kind: "no_assertion_step",
        severity: input.contract.severity === "critical" ? "high" : "medium",
        message: "Flow has interactions but no explicit flow assertion step."
      });
    }
  }
  if (input.latestFailedSteps > 0) {
    gaps.push({
      kind: "failed_latest_flow",
      severity: "high",
      message: "Latest deterministic report includes failed flow steps."
    });
  }
  if (input.planProvided && input.contract.steps.length > 0 && !input.selected && input.contract.runOn.pullRequest) {
    gaps.push({
      kind: "flow_not_selected",
      severity: "medium",
      message: "Flow contract was not selected by the latest plan/report."
    });
  }
  return gaps.sort((a, b) => `${rank(b.severity)}:${a.kind}`.localeCompare(`${rank(a.severity)}:${b.kind}`));
}

function summarize(flows: FlowAuditEntry[]): FlowAuditSummary {
  const allSteps = flows.flatMap((flow) => flow.steps);
  return {
    contractCount: flows.length,
    flowContractCount: flows.filter((flow) => flow.steps.length > 0).length,
    selectedFlowContracts: flows.filter((flow) => flow.selected && flow.steps.length > 0).length,
    flowStepCount: allSteps.length,
    navigationSteps: allSteps.filter((step) => step.category === "navigation").length,
    interactionSteps: allSteps.filter((step) => step.category === "interaction").length,
    assertionSteps: allSteps.filter((step) => step.category === "assertion").length,
    failedFlowSteps: flows.reduce((total, flow) => total + flow.latestFailedSteps, 0),
    contractsWithoutFlow: flows.filter((flow) => flow.steps.length === 0).length,
    criticalContractsWithoutFlow: flows.filter((flow) => flow.severity === "critical" && flow.steps.length === 0).length,
    highSeverityFlowGaps: flows.filter((flow) => flow.gaps.some((gap) => gap.severity === "high")).length
  };
}

function recommendationsFor(contract: ContractConfig, gaps: FlowAuditGap[]): string[] {
  const recommendations = new Set<string>();
  for (const gap of gaps) {
    if (gap.kind === "no_flow_steps") {
      recommendations.add(`Add deterministic flow steps to "${contract.id}" for the primary user-visible behavior this contract protects.`);
    }
    if (gap.kind === "no_navigation_step") {
      recommendations.add(`Add a goto flow step to "${contract.id}" so the flow is independent of screenshot route ordering.`);
    }
    if (gap.kind === "no_assertion_step") {
      recommendations.add(`Add assertVisible, assertHidden, assertText, or assertUrl to "${contract.id}" after interactions.`);
    }
    if (gap.kind === "failed_latest_flow") {
      recommendations.add(`Inspect the failed flow evidence for "${contract.id}" before updating baselines.`);
    }
    if (gap.kind === "flow_not_selected") {
      recommendations.add(`Review changed-file rules and runOn settings so "${contract.id}" runs when its flow is at risk.`);
    }
  }
  return [...recommendations];
}

function buildRecommendations(flows: FlowAuditEntry[], summary: FlowAuditSummary): string[] {
  const recommendations = new Set<string>();
  if (summary.criticalContractsWithoutFlow > 0) {
    recommendations.add("Add flow steps for critical contracts so important user-visible behavior is protected beyond screenshots.");
  }
  if (summary.failedFlowSteps > 0) {
    recommendations.add("Run visual-hive triage after flow failures so issue context includes failed user actions.");
  }
  if (summary.flowContractCount === 0 && summary.contractCount > 0) {
    recommendations.add("Start with one flow contract for the most important happy path, then expand from mutation survivors and coverage gaps.");
  }
  for (const flow of flows) {
    for (const recommendation of flow.recommendations.slice(0, 2)) {
      recommendations.add(recommendation);
    }
  }
  return [...recommendations];
}

function categorizeStep(action: FlowStepResult["action"]): FlowAuditStep["category"] {
  if (action === "goto") return "navigation";
  if (action === "click" || action === "fill" || action === "press") return "interaction";
  if (action === "waitFor") return "wait";
  return "assertion";
}

function visibleValue(step: ContractConfig["steps"][number]): string | undefined {
  if (step.action === "fill" && step.value) return "[configured]";
  return step.value ?? step.key ?? step.text;
}

function rank(severity: FlowAuditGap["severity"]): number {
  return { low: 1, medium: 2, high: 3 }[severity];
}
