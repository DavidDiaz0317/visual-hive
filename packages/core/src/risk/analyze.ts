import type { VisualHiveConfig } from "../config/schema.js";
import type { ContractAuditReport } from "../contracts/audit.js";
import type { CoverageReport } from "../coverage/analyze.js";
import type { WorkflowAuditReport } from "../github/workflowAudit.js";
import type { MutationReport, Report } from "../reports/types.js";
import type { ScheduleAuditReport } from "../schedules/audit.js";
import type { TargetAuditReport } from "../targets/audit.js";
import type { Plan } from "../planner/types.js";
import { sanitizeText } from "../utils/sanitize.js";

export type RiskSeverity = "low" | "medium" | "high" | "critical";
export type RiskCategory =
  | "deterministic_failure"
  | "baseline_review"
  | "mutation_adequacy"
  | "coverage_gap"
  | "target_safety"
  | "workflow_safety"
  | "provider_policy"
  | "environment"
  | "planning";

export interface RiskRegisterReport {
  schemaVersion: 1;
  project: string;
  generatedAt: string;
  summary: RiskSummary;
  inputs: RiskInputs;
  risks: RiskItem[];
  recommendations: string[];
}

export interface RiskSummary {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  riskScore: number;
  highestSeverity: RiskSeverity | "none";
  prBlocking: number;
  trustedOnly: number;
}

export interface RiskInputs {
  plan: boolean;
  report: boolean;
  mutationReport: boolean;
  coverageReport: boolean;
  targetAudit: boolean;
  contractAudit: boolean;
  scheduleAudit: boolean;
  workflowAudit: boolean;
}

export interface RiskItem {
  id: string;
  category: RiskCategory;
  severity: RiskSeverity;
  title: string;
  message: string;
  evidence: string[];
  contractIds: string[];
  targetIds: string[];
  artifacts: string[];
  suggestedActions: string[];
  prBlocking: boolean;
  trustedOnly: boolean;
}

export interface AnalyzeRiskOptions {
  plan?: Plan;
  report?: Report;
  mutationReport?: MutationReport;
  coverageReport?: CoverageReport;
  targetAudit?: TargetAuditReport;
  contractAudit?: ContractAuditReport;
  scheduleAudit?: ScheduleAuditReport;
  workflowAudit?: WorkflowAuditReport;
  now?: Date;
}

export function analyzeRisk(config: VisualHiveConfig, options: AnalyzeRiskOptions = {}): RiskRegisterReport {
  const contractSeverity = new Map(config.contracts.map((contract) => [contract.id, contract.severity]));
  const risks = [
    ...planningRisks(options.plan),
    ...deterministicRisks(options.report, contractSeverity),
    ...baselineRisks(options.report, contractSeverity),
    ...mutationRisks(options.mutationReport),
    ...coverageRisks(options.coverageReport),
    ...targetRisks(options.targetAudit),
    ...workflowRisks(options.workflowAudit),
    ...providerRisks(options.plan, options.report)
  ]
    .map((risk) => sanitizeRisk(risk))
    .sort(compareRisks);

  return {
    schemaVersion: 1,
    project: config.project.name,
    generatedAt: (options.now ?? new Date()).toISOString(),
    summary: summarizeRisks(risks),
    inputs: {
      plan: Boolean(options.plan),
      report: Boolean(options.report),
      mutationReport: Boolean(options.mutationReport),
      coverageReport: Boolean(options.coverageReport),
      targetAudit: Boolean(options.targetAudit),
      contractAudit: Boolean(options.contractAudit),
      scheduleAudit: Boolean(options.scheduleAudit),
      workflowAudit: Boolean(options.workflowAudit)
    },
    risks,
    recommendations: recommendations(risks)
  };
}

function planningRisks(plan?: Plan): RiskItem[] {
  if (!plan) return [];
  const risks: RiskItem[] = [];
  if (plan.items.length === 0) {
    risks.push({
      id: "planning:no-contracts-selected",
      category: "planning",
      severity: plan.effectiveChangedFiles.length > 0 ? "high" : "low",
      title: "No contracts selected",
      message:
        plan.effectiveChangedFiles.length > 0
          ? "Changed files did not produce any deterministic contracts."
          : "The latest plan selected no contracts because all changed files were ignored or no changed files were provided.",
      evidence: plan.excluded.slice(0, 5).map((item) => `${item.contractId}: ${item.reasons.join("; ")}`),
      contractIds: [],
      targetIds: [],
      artifacts: [".visual-hive/plan.json"],
      suggestedActions: ["Review runOn settings, changed-file rules, target safety, and explicit include/exclude filters."],
      prBlocking: plan.effectiveChangedFiles.length > 0,
      trustedOnly: false
    });
  }
  for (const excluded of plan.excluded.filter((item) => item.reasons.some((reason) => reason.includes("target.prSafe=false")))) {
    risks.push({
      id: `planning:unsafe-target:${excluded.contractId}`,
      category: "target_safety",
      severity: "high",
      title: `Contract excluded from PR-safe lane: ${excluded.contractId}`,
      message: "A contract was excluded because its target is not PR-safe.",
      evidence: excluded.reasons,
      contractIds: [excluded.contractId],
      targetIds: [excluded.targetId],
      artifacts: [".visual-hive/plan.json"],
      suggestedActions: ["Keep this contract in a scheduled/protected lane or move it to a PR-safe target."],
      prBlocking: false,
      trustedOnly: true
    });
  }
  return risks;
}

function deterministicRisks(report: Report | undefined, contractSeverity: Map<string, string>): RiskItem[] {
  if (!report) return [];
  return report.results
    .filter((result) => result.status === "failed")
    .map((result) => ({
      id: `deterministic:${result.contractId}`,
      category: "deterministic_failure" as const,
      severity: severityFromContract(contractSeverity.get(result.contractId)),
      title: `Deterministic contract failed: ${result.contractId}`,
      message: result.errors[0] ?? "Contract failed without a structured error excerpt.",
      evidence: [
        ...result.errors.slice(0, 3),
        ...(result.selectorAssertions ?? []).filter((assertion) => assertion.status === "failed").map((assertion) => `${assertion.kind}: ${assertion.value}`),
        ...(result.flowSteps ?? []).filter((step) => step.status === "failed").map((step) => `${step.action}: ${step.selector ?? step.route ?? step.value ?? ""}`),
        ...(result.consoleErrors ?? []).map((error) => `console: ${error.message}`),
        ...(result.pageErrors ?? []).map((error) => `page: ${error.message}`)
      ],
      contractIds: [result.contractId],
      targetIds: [result.targetId],
      artifacts: result.artifacts,
      suggestedActions: [
        result.reproductionCommand ? `Reproduce with: ${result.reproductionCommand}` : "Run visual-hive run for this contract.",
        "Inspect selector, flow, screenshot, console, and network evidence before updating baselines."
      ],
      prBlocking: report.mode === "pr",
      trustedOnly: false
    }));
}

function baselineRisks(report: Report | undefined, contractSeverity: Map<string, string>): RiskItem[] {
  if (!report) return [];
  return report.results.flatMap((result) =>
    (result.screenshotAssertions ?? [])
      .filter((shot) => shot.status === "created" || shot.status === "failed" || shot.status === "missing_baseline")
      .map((shot) => {
        const severity = shot.status === "missing_baseline" ? "high" : shot.status === "failed" ? severityFromContract(contractSeverity.get(result.contractId)) : "medium";
        return {
          id: `baseline:${result.contractId}:${shot.screenshotName}:${shot.viewport}`,
          category: "baseline_review" as const,
          severity,
          title: `Screenshot ${shot.status}: ${result.contractId}/${shot.screenshotName}`,
          message: shot.message ?? `Screenshot status is ${shot.status}.`,
          evidence: [
            `route=${shot.route}`,
            `viewport=${shot.viewport}`,
            shot.actualDiffPixelRatio === undefined ? "" : `diffRatio=${shot.actualDiffPixelRatio}`,
            shot.actualDiffPixels === undefined ? "" : `diffPixels=${shot.actualDiffPixels}`
          ].filter(Boolean),
          contractIds: [result.contractId],
          targetIds: [result.targetId],
          artifacts: [shot.actualPath, shot.baselinePath, shot.diffPath].filter((value): value is string => Boolean(value)),
          suggestedActions: ["Review baseline, actual, and diff images.", "Approve the baseline only after confirming the visual change is intentional."],
          prBlocking: shot.status !== "created" && report.mode === "pr",
          trustedOnly: false
        };
      })
  );
}

function mutationRisks(mutationReport?: MutationReport): RiskItem[] {
  if (!mutationReport) return [];
  const risks: RiskItem[] = [];
  if (mutationReport.score < mutationReport.minScore) {
    risks.push({
      id: "mutation:score-below-minimum",
      category: "mutation_adequacy",
      severity: "high",
      title: "Mutation score is below the configured minimum",
      message: `Mutation score ${Math.round(mutationReport.score * 100)}% is below minimum ${Math.round(mutationReport.minScore * 100)}%.`,
      evidence: [`killed=${mutationReport.killed}`, `total=${mutationReport.total}`],
      contractIds: [],
      targetIds: [],
      artifacts: [".visual-hive/mutation-report.json"],
      suggestedActions: ["Strengthen deterministic contracts for survived mutation operators before relying on this lane."],
      prBlocking: false,
      trustedOnly: false
    });
  }
  for (const result of mutationReport.results.filter((entry) => entry.status === "survived" || entry.status === "error")) {
    risks.push({
      id: `mutation:${result.operator}`,
      category: "mutation_adequacy",
      severity: result.status === "error" ? "medium" : "high",
      title: result.status === "survived" ? `Mutation survived: ${result.operator}` : `Mutation errored: ${result.operator}`,
      message: result.failedAssertion ?? result.errors[0] ?? `Mutation ${result.operator} did not produce a killed result.`,
      evidence: [...(result.expectedFailureKinds ?? []), ...result.errors.slice(0, 3)],
      contractIds: result.contractIds,
      targetIds: [],
      artifacts: result.artifacts ?? [".visual-hive/mutation-report.json"],
      suggestedActions: [`Add or strengthen assertions that detect ${result.operator}.`],
      prBlocking: false,
      trustedOnly: false
    });
  }
  return risks;
}

function coverageRisks(coverageReport?: CoverageReport): RiskItem[] {
  if (!coverageReport) return [];
  return coverageReport.uncoveredAreas.map((gap, index) => ({
    id: `coverage:${gap.kind}:${gap.contractId ?? gap.targetId ?? gap.route ?? gap.viewport ?? gap.changedFile ?? index}`,
    category: "coverage_gap",
    severity: gap.severity,
    title: `Coverage gap: ${gap.kind}`,
    message: gap.message,
    evidence: [gap.contractId, gap.targetId, gap.route, gap.viewport, gap.changedFile].filter((value): value is string => Boolean(value)),
    contractIds: gap.contractId ? [gap.contractId] : [],
    targetIds: gap.targetId ? [gap.targetId] : [],
    artifacts: [".visual-hive/coverage.json"],
    suggestedActions: ["Add or adjust contracts, screenshots, selectors, or changed-file rules for this uncovered area."],
    prBlocking: gap.severity === "high",
    trustedOnly: false
  }));
}

function targetRisks(targetAudit?: TargetAuditReport): RiskItem[] {
  if (!targetAudit) return [];
  return targetAudit.targets.flatMap((target) =>
    target.gaps.map((gap) => ({
      id: `target:${target.id}:${gap.kind}`,
      category: gap.kind.includes("secret") ? ("environment" as const) : ("target_safety" as const),
      severity: gap.severity,
      title: `Target risk: ${target.id}`,
      message: gap.message,
      evidence: [target.kind, target.url, ...target.missingSecrets.map((name) => `missing=${name}`)],
      contractIds: target.contractIds,
      targetIds: [target.id],
      artifacts: [".visual-hive/targets.json"],
      suggestedActions: target.recommendations.length ? target.recommendations : ["Review target safety, setup, readiness, and secret-name configuration."],
      prBlocking: gap.kind === "pr_contract_on_unsafe_target" || gap.kind === "protected_pr_safe",
      trustedOnly: target.kind === "protected"
    }))
  );
}

function workflowRisks(workflowAudit?: WorkflowAuditReport): RiskItem[] {
  if (!workflowAudit) return [];
  return workflowAudit.findings.map((finding) => ({
    id: `workflow:${finding.workflowPath}:${finding.kind}`,
    category: "workflow_safety",
    severity: finding.severity,
    title: `Workflow risk: ${finding.kind}`,
    message: finding.message,
    evidence: [finding.workflowPath, finding.evidence],
    contractIds: [],
    targetIds: [],
    artifacts: [".visual-hive/workflows.json"],
    suggestedActions: workflowAudit.recommendations.length ? workflowAudit.recommendations : ["Fix workflow safety findings before relying on CI."],
    prBlocking: finding.severity === "critical" || finding.severity === "high",
    trustedOnly: finding.workflowPath.includes("failure") || finding.workflowPath.includes("issue")
  }));
}

function providerRisks(plan?: Plan, report?: Report): RiskItem[] {
  const planRisks =
    plan?.providerPolicy
      .filter((provider) => provider.enabled && !provider.externalUploadAllowed && provider.providerId !== "playwright")
      .map((provider) => ({
        id: `provider-policy:${provider.providerId}`,
        category: "provider_policy" as const,
        severity: "medium" as const,
        title: `Provider upload blocked: ${provider.label}`,
        message: "Provider is enabled but external upload is not allowed by current policy.",
        evidence: provider.externalUploadBlockedReasons,
        contractIds: [],
        targetIds: [],
        artifacts: [".visual-hive/plan.json"],
        suggestedActions: ["Review provider cost policy and run mode before enabling external uploads."],
        prBlocking: false,
        trustedOnly: true
      })) ?? [];
  const resultRisks =
    report?.providerResults
      ?.filter((provider) => provider.status === "failed" || provider.status === "missing_credentials")
      .map((provider) => ({
        id: `provider-result:${provider.providerId}`,
        category: "provider_policy" as const,
        severity: provider.status === "failed" ? ("high" as const) : ("medium" as const),
        title: `Provider ${provider.status}: ${provider.label}`,
        message: provider.message,
        evidence: [...provider.missingEnv.map((name) => `missing=${name}`), ...(provider.externalUploadBlockedReasons ?? [])],
        contractIds: [],
        targetIds: [],
        artifacts: [".visual-hive/report.json"],
        suggestedActions: ["Confirm provider credentials by name and keep provider results supplemental to deterministic Playwright checks."],
        prBlocking: false,
        trustedOnly: true
      })) ?? [];
  return [...planRisks, ...resultRisks];
}

function summarizeRisks(risks: RiskItem[]): RiskSummary {
  const counts = {
    critical: risks.filter((risk) => risk.severity === "critical").length,
    high: risks.filter((risk) => risk.severity === "high").length,
    medium: risks.filter((risk) => risk.severity === "medium").length,
    low: risks.filter((risk) => risk.severity === "low").length
  };
  return {
    total: risks.length,
    ...counts,
    riskScore: Math.min(100, counts.critical * 30 + counts.high * 15 + counts.medium * 6 + counts.low * 2),
    highestSeverity: risks[0]?.severity ?? "none",
    prBlocking: risks.filter((risk) => risk.prBlocking).length,
    trustedOnly: risks.filter((risk) => risk.trustedOnly).length
  };
}

function recommendations(risks: RiskItem[]): string[] {
  if (risks.length === 0) {
    return ["No immediate visual QA risks were found in the loaded artifacts."];
  }
  const recs = new Set<string>();
  if (risks.some((risk) => risk.category === "deterministic_failure")) recs.add("Fix deterministic contract failures before updating baselines.");
  if (risks.some((risk) => risk.category === "baseline_review")) recs.add("Review screenshot actual/baseline/diff artifacts and record explicit baseline decisions.");
  if (risks.some((risk) => risk.category === "mutation_adequacy")) recs.add("Strengthen contracts for survived or errored mutation operators.");
  if (risks.some((risk) => risk.category === "workflow_safety")) recs.add("Repair GitHub workflow safety findings before relying on CI automation.");
  if (risks.some((risk) => risk.category === "environment")) recs.add("Configure required secret names only in trusted scheduled/manual environments.");
  if (risks.some((risk) => risk.category === "coverage_gap")) recs.add("Add contracts or changed-file rules for uncovered high-risk areas.");
  return [...recs];
}

function severityFromContract(severity: string | undefined): RiskSeverity {
  if (severity === "critical") return "critical";
  if (severity === "high") return "high";
  if (severity === "medium") return "medium";
  return "low";
}

function sanitizeRisk(risk: RiskItem): RiskItem {
  return {
    ...risk,
    title: sanitizeText(risk.title),
    message: sanitizeText(risk.message),
    evidence: risk.evidence.map((item) => sanitizeText(item)).filter(Boolean).slice(0, 10),
    contractIds: unique(risk.contractIds.map((item) => sanitizeText(item)).filter(Boolean)),
    targetIds: unique(risk.targetIds.map((item) => sanitizeText(item)).filter(Boolean)),
    artifacts: unique(risk.artifacts.map((item) => sanitizeText(item)).filter(Boolean)),
    suggestedActions: unique(risk.suggestedActions.map((item) => sanitizeText(item)).filter(Boolean))
  };
}

function compareRisks(a: RiskItem, b: RiskItem): number {
  return severityWeight(b.severity) - severityWeight(a.severity) || a.category.localeCompare(b.category) || a.id.localeCompare(b.id);
}

function severityWeight(severity: RiskSeverity): number {
  return { low: 1, medium: 2, high: 3, critical: 4 }[severity];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
