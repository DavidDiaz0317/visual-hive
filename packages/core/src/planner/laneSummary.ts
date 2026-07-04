import { mutationOperatorId } from "../mutations/operators.js";
import { getEvidenceResourceById } from "../tools/evidenceResources.js";
import { sanitizeText } from "../utils/sanitize.js";
import type { Plan } from "./types.js";

export interface PlanLaneSummaryInput {
  path: string;
  plan: Plan;
}

export interface PlanLaneSummaryRow {
  path: string;
  mode: Plan["mode"];
  generatedAt: string;
  changedFiles: number;
  effectiveChangedFiles: number;
  ignoredChangedFiles: number;
  selectedContracts: string[];
  selectedTargets: string[];
  excludedContracts: number;
  unsafeExcludedContracts: number;
  expensiveTargets: string[];
  mutationEnabled: boolean;
  mutationOperators: string[];
  externalCallsPlanned: number;
  providerPolicyBlocked: string[];
  status: "ready" | "empty" | "review";
  reasons: string[];
}

export interface PlanLaneSummaryOutputResource {
  artifactPath: string;
  evidenceResourceId: string;
  evidenceResourceUri: string;
  evidenceResourceTitle: string;
  evidenceResourceDescription: string;
  evidenceReadToolName?: string;
}

export interface PlanLaneSummaryReport {
  schemaVersion: 1;
  project: string;
  generatedAt: string;
  planCount: number;
  summary: {
    modes: string[];
    selectedContracts: number;
    selectedTargets: number;
    emptyPlans: number;
    reviewPlans: number;
    unsafeExcludedContracts: number;
    expensiveTargets: number;
    mutationEnabledPlans: number;
    externalCallsPlanned: number;
  };
  lanes: PlanLaneSummaryRow[];
  recommendations: string[];
  outputResource?: PlanLaneSummaryOutputResource;
}

export function buildPlanLaneSummary(inputs: PlanLaneSummaryInput[], now = new Date(), fallbackProject = "unknown"): PlanLaneSummaryReport {
  const lanes = inputs
    .map((input) => summarizeLane(input))
    .sort((a, b) => `${a.mode}:${a.path}`.localeCompare(`${b.mode}:${b.path}`));
  const selectedContracts = new Set(lanes.flatMap((lane) => lane.selectedContracts));
  const selectedTargets = new Set(lanes.flatMap((lane) => lane.selectedTargets));
  const project = sanitizeText(inputs[0]?.plan.project ?? fallbackProject);
  const summary = {
    modes: [...new Set(lanes.map((lane) => lane.mode))].sort(),
    selectedContracts: selectedContracts.size,
    selectedTargets: selectedTargets.size,
    emptyPlans: lanes.filter((lane) => lane.status === "empty").length,
    reviewPlans: lanes.filter((lane) => lane.status === "review").length,
    unsafeExcludedContracts: lanes.reduce((total, lane) => total + lane.unsafeExcludedContracts, 0),
    expensiveTargets: new Set(lanes.flatMap((lane) => lane.expensiveTargets)).size,
    mutationEnabledPlans: lanes.filter((lane) => lane.mutationEnabled).length,
    externalCallsPlanned: lanes.reduce((total, lane) => total + lane.externalCallsPlanned, 0)
  };
  return {
    schemaVersion: 1,
    project,
    generatedAt: now.toISOString(),
    planCount: lanes.length,
    summary,
    lanes,
    recommendations: recommendations(lanes, summary),
    outputResource: catalogedPlanLaneOutputResource()
  };
}

function summarizeLane(input: PlanLaneSummaryInput): PlanLaneSummaryRow {
  const plan = input.plan;
  const unsafeExcludedContracts = plan.excluded.filter((item) => item.reasons.some((reason) => reason.includes("target.prSafe=false"))).length;
  const expensiveTargets = plan.targets.filter((target) => target.cost === "expensive").map((target) => target.id);
  const externalCallsPlanned = plan.providerPolicy.reduce((total, provider) => total + provider.externalCallsPlanned, 0);
  const providerPolicyBlocked = plan.providerPolicy
    .filter((provider) => provider.enabled && provider.externalUploadBlockedReasons.length > 0)
    .map((provider) => `${provider.providerId}:${provider.externalUploadBlockedReasons.join(",")}`);
  const reasons: string[] = [];
  if (plan.items.length === 0) reasons.push("No contracts selected.");
  if (unsafeExcludedContracts > 0) reasons.push(`${unsafeExcludedContracts} non-PR-safe contract(s) excluded.`);
  if (expensiveTargets.length > 0) reasons.push(`Expensive targets selected: ${expensiveTargets.join(", ")}.`);
  if (externalCallsPlanned > 0) reasons.push(`External provider calls planned: ${externalCallsPlanned}.`);
  if (providerPolicyBlocked.length > 0) reasons.push("One or more provider uploads are blocked by policy.");
  const status: PlanLaneSummaryRow["status"] = plan.items.length === 0 ? "empty" : reasons.length > 0 ? "review" : "ready";

  return {
    path: sanitizeText(input.path),
    mode: plan.mode,
    generatedAt: sanitizeText(plan.generatedAt),
    changedFiles: plan.changedFiles.length,
    effectiveChangedFiles: plan.effectiveChangedFiles.length,
    ignoredChangedFiles: plan.ignoredChangedFiles.length,
    selectedContracts: plan.items.map((item) => sanitizeText(item.contractId)).sort(),
    selectedTargets: plan.targets.map((target) => sanitizeText(target.id)).sort(),
    excludedContracts: plan.excluded.length,
    unsafeExcludedContracts,
    expensiveTargets: expensiveTargets.sort(),
    mutationEnabled: plan.mutation.enabled,
    mutationOperators: plan.mutation.operators.map((operator) => mutationOperatorId(operator)).sort(),
    externalCallsPlanned,
    providerPolicyBlocked: providerPolicyBlocked.map((item) => sanitizeText(item)).sort(),
    status,
    reasons: reasons.map((reason) => sanitizeText(reason)).sort()
  };
}

function recommendations(lanes: PlanLaneSummaryRow[], summary: PlanLaneSummaryReport["summary"]): string[] {
  const recs = new Set<string>();
  if (!lanes.length) {
    recs.add("Run visual-hive plan for at least one lane before summarizing plan coverage.");
  }
  if (summary.emptyPlans > 0) {
    recs.add("Review empty plans and confirm they are intentional docs-only or no-op lanes.");
  }
  if (summary.unsafeExcludedContracts > 0) {
    recs.add("Keep non-PR-safe targets out of untrusted lanes; use --allow-unsafe-targets only in trusted scheduled/manual contexts.");
  }
  if (summary.expensiveTargets > 0) {
    recs.add("Review expensive target selections before making the lane required or frequent.");
  }
  if (summary.externalCallsPlanned > 0) {
    recs.add("Confirm provider budget and authorization before allowing external calls.");
  }
  if (!summary.modes.includes("pr")) {
    recs.add("Create a PR-mode plan so required pull request checks have explicit coverage evidence.");
  }
  if (!summary.modes.includes("canary")) {
    recs.add("Consider a canary plan for cheap scheduled public/demo health checks.");
  }
  return [...recs].sort();
}

function catalogedPlanLaneOutputResource(): PlanLaneSummaryOutputResource {
  const resource = getEvidenceResourceById("plan-lanes");
  return {
    artifactPath: ".visual-hive/plans.json",
    evidenceResourceId: resource?.id ?? "plan-lanes",
    evidenceResourceUri: resource?.uri ?? "visual-hive://plan-lanes",
    evidenceResourceTitle: resource?.title ?? "Plan Lanes",
    evidenceResourceDescription:
      resource?.description ??
      "Lane summary across active and sidecar plan artifacts, including PR, schedule, canary, full, and docs-only planning evidence.",
    evidenceReadToolName: resource?.readTool?.name ?? "visual_hive_read_plan_lanes"
  };
}
