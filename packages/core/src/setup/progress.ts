import type { VisualHiveConfig } from "../config/schema.js";
import type { MutationReport, Report, TriageReport } from "../reports/types.js";
import type { Plan } from "../planner/types.js";
import type { ProviderSetupPlan } from "../providers/setupPlan.js";
import type { ReadinessReport } from "../readiness/analyze.js";
import type { WorkflowAuditReport } from "../github/workflowAudit.js";
import type { SetupRecommendationReport } from "./recommend.js";
import { sanitizeText } from "../utils/sanitize.js";

export interface SetupProgressStep {
  id: string;
  label: string;
  status: "complete" | "pending" | "review" | "blocked";
  description: string;
  evidence: string[];
  command?: string;
  artifacts: string[];
}

export interface SetupProgressReport {
  schemaVersion: 1;
  project: string;
  generatedAt: string;
  status: "not_started" | "in_progress" | "attention" | "ready";
  phase: string;
  percentComplete: number;
  completedSteps: number;
  totalSteps: number;
  reviewSteps: number;
  blockedSteps: number;
  nextStep?: SetupProgressStep;
  steps: SetupProgressStep[];
}

export interface BuildSetupProgressOptions {
  project?: string;
  config?: VisualHiveConfig;
  configError?: string;
  plan?: Plan;
  report?: Report;
  mutationReport?: MutationReport;
  triageReport?: TriageReport;
  setupRecommendation?: SetupRecommendationReport;
  workflowAudit?: WorkflowAuditReport;
  readinessReport?: ReadinessReport;
  providerSetupPlan?: ProviderSetupPlan;
  now?: Date;
}

export function buildSetupProgress(options: BuildSetupProgressOptions = {}): SetupProgressReport {
  const reportSummary = options.report?.summary;
  const createdBaselines = reportSummary?.createdBaselines ?? reportSummary?.baselinesCreated ?? 0;
  const missingBaselines = reportSummary?.missingBaselines ?? 0;
  const visualDiffs = reportSummary?.visualDiffs ?? 0;
  const screenshotsFailed = reportSummary?.screenshotsFailed ?? 0;
  const externalProviders = options.config
    ? Object.entries(options.config.providers).filter(
        ([providerId, provider]) => providerId !== "playwright" && provider.enabled && provider.mode === "external"
      )
    : [];
  const workflowCriticalHigh =
    options.workflowAudit?.findings.filter((finding) => finding.severity === "critical" || finding.severity === "high").length ?? 0;
  const readinessBlocked = options.readinessReport?.summary.blocked ?? 0;
  const readinessWarnings = options.readinessReport?.summary.warnings ?? 0;
  const steps: SetupProgressStep[] = [
    setupStep({
      id: "recommend",
      label: "Scan and recommend setup",
      status: options.setupRecommendation ? "complete" : "pending",
      description: "Detect package scripts, framework signals, selectors, routes, stories, workflows, providers, and a safe starter profile.",
      evidence: options.setupRecommendation
        ? [
            `profile=${options.setupRecommendation.setupProfile}`,
            `target=${options.setupRecommendation.recommendedTarget.id}`,
            `selectors=${options.setupRecommendation.detectedSelectors.length}`
          ]
        : ["No .visual-hive/recommendations.json artifact found."],
      command: "visual-hive recommend --repo .",
      artifacts: [".visual-hive/recommendations.json"]
    }),
    setupStep({
      id: "config",
      label: "Load valid config",
      status: options.configError ? "blocked" : options.config ? "complete" : "pending",
      description: "Keep the repository configuration valid before planning, running, or writing workflows.",
      evidence: options.configError
        ? [`error=${options.configError}`]
        : options.config
          ? [`project=${options.config.project.name}`, `targets=${Object.keys(options.config.targets).length}`, `contracts=${options.config.contracts.length}`]
          : ["No visual-hive.config.yaml loaded."],
      command: options.config ? "visual-hive doctor" : "visual-hive recommend --write-config",
      artifacts: ["visual-hive.config.yaml"]
    }),
    setupStep({
      id: "plan",
      label: "Plan PR-safe deterministic work",
      status: options.plan ? (options.plan.items.length ? "complete" : "review") : "pending",
      description: "Select contracts from changed files, severity, target safety, cost, and provider policy before running Playwright.",
      evidence: options.plan
        ? [`mode=${options.plan.mode}`, `contracts=${options.plan.items.length}`, `targets=${options.plan.targets.length}`]
        : ["No .visual-hive/plan.json artifact found."],
      command: "visual-hive plan --mode pr --changed-files changed-files.txt",
      artifacts: [".visual-hive/plan.json"]
    }),
    setupStep({
      id: "run",
      label: "Run deterministic contracts",
      status: options.report ? (options.report.status === "passed" ? "complete" : "blocked") : "pending",
      description: "Use Playwright contracts, selector assertions, flows, screenshot diffs, console/page/network evidence, and artifacts as the pass/fail oracle.",
      evidence: options.report
        ? [`status=${options.report.status}`, `passed=${options.report.summary.passed}`, `failed=${options.report.summary.failed}`]
        : ["No .visual-hive/report.json artifact found."],
      command: "visual-hive run",
      artifacts: [".visual-hive/report.json", ".visual-hive/generated/visual-hive.generated.spec.ts"]
    }),
    setupStep({
      id: "baselines",
      label: "Review baseline queue",
      status: !options.report
        ? "pending"
        : missingBaselines || screenshotsFailed
          ? "blocked"
          : createdBaselines || visualDiffs
            ? "review"
            : "complete",
      description: "Review created baselines and visual diffs explicitly before enforcing CI or approving snapshot changes.",
      evidence: options.report
        ? [`created=${createdBaselines}`, `missing=${missingBaselines}`, `visualDiffs=${visualDiffs}`, `screenshotsFailed=${screenshotsFailed}`]
        : ["Run deterministic contracts before reviewing baselines."],
      command: "visual-hive baselines list --write",
      artifacts: [".visual-hive/baselines.json", ".visual-hive/artifacts/screenshots"]
    }),
    setupStep({
      id: "mutation",
      label: "Measure mutation adequacy",
      status: options.mutationReport
        ? options.mutationReport.score >= options.mutationReport.minScore
          ? "complete"
          : "blocked"
        : "review",
      description: "Confirm contracts catch intentional UI/auth/API/layout breakage rather than only producing screenshots.",
      evidence: options.mutationReport
        ? [
            `score=${Math.round(options.mutationReport.score * 100)}%`,
            `min=${Math.round(options.mutationReport.minScore * 100)}%`,
            `survived=${options.mutationReport.results.filter((result) => result.status === "survived").length}`
          ]
        : ["No .visual-hive/mutation-report.json artifact found."],
      command: "visual-hive mutate",
      artifacts: [".visual-hive/mutation-report.json"]
    }),
    setupStep({
      id: "triage",
      label: "Generate repair-ready triage",
      status: options.triageReport ? "complete" : options.report ? "pending" : "review",
      description: "Create sanitized issue, PR comment, missing-test suggestions, and LLM-ready prompt artifacts without making model calls by default.",
      evidence: options.triageReport
        ? [`findings=${options.triageReport.summary.findingCount}`, `classes=${Object.keys(options.triageReport.summary.classifications).join(", ") || "none"}`]
        : ["No .visual-hive/triage.json artifact found."],
      command: "visual-hive triage && visual-hive report",
      artifacts: [".visual-hive/triage.json", ".visual-hive/issue.md", ".visual-hive/pr-comment.md"]
    }),
    setupStep({
      id: "workflow-safety",
      label: "Audit workflow safety",
      status: options.workflowAudit ? (workflowCriticalHigh ? "blocked" : "complete") : "review",
      description: "Verify PR workflows stay read-only, no-secret, artifact-uploading, and free of pull_request_target execution.",
      evidence: options.workflowAudit
        ? [`findings=${options.workflowAudit.findings.length}`, `criticalHigh=${workflowCriticalHigh}`]
        : ["No workflow audit artifact found."],
      command: "visual-hive workflows",
      artifacts: [".visual-hive/workflows.json", ".github/workflows"]
    }),
    setupStep({
      id: "provider-governance",
      label: "Record provider posture",
      status: !externalProviders.length ? "complete" : options.providerSetupPlan ? "review" : "blocked",
      description: "Keep hosted providers optional, no-network by default, and explicitly planned before trusted uploads or credentials are introduced.",
      evidence: externalProviders.length
        ? [
            `externalProviders=${externalProviders.map(([providerId]) => providerId).join(", ")}`,
            options.providerSetupPlan ? `setupPlan=${options.providerSetupPlan.providerId}` : "setupPlan=missing"
          ]
        : ["No external supplemental provider is enabled."],
      command: externalProviders.length ? `visual-hive providers plan --provider ${externalProviders[0]?.[0] ?? "argos"}` : "visual-hive providers list --mock-results",
      artifacts: [".visual-hive/provider-setup-plan.json", ".visual-hive/provider-decisions.json", ".visual-hive/provider-results.json"]
    }),
    setupStep({
      id: "readiness",
      label: "Pass readiness gate",
      status: options.readinessReport
        ? readinessBlocked
          ? "blocked"
          : readinessWarnings
            ? "review"
            : "complete"
        : "pending",
      description: "Combine deterministic status, baselines, mutation, workflow safety, security, cost, provider, LLM, and run history evidence.",
      evidence: options.readinessReport
        ? [`status=${options.readinessReport.status}`, `score=${options.readinessReport.score}`, `blocked=${readinessBlocked}`, `warnings=${readinessWarnings}`]
        : ["No .visual-hive/readiness.json artifact found."],
      command: "visual-hive readiness",
      artifacts: [".visual-hive/readiness.json"]
    })
  ];
  const completedSteps = steps.filter((step) => step.status === "complete").length;
  const blockedSteps = steps.filter((step) => step.status === "blocked").length;
  const reviewSteps = steps.filter((step) => step.status === "review").length;
  const status: SetupProgressReport["status"] = blockedSteps
    ? "attention"
    : completedSteps === steps.length
      ? "ready"
      : completedSteps === 0 && !reviewSteps
        ? "not_started"
        : "in_progress";
  const nextStep =
    steps.find((step) => step.status === "blocked") ??
    steps.find((step) => step.status === "review") ??
    steps.find((step) => step.status === "pending");
  return {
    schemaVersion: 1,
    project: sanitizeText(options.project ?? options.config?.project.name ?? options.setupRecommendation?.project.name ?? "unknown"),
    generatedAt: (options.now ?? new Date()).toISOString(),
    status,
    phase: setupPhase(steps, status),
    percentComplete: Math.round((completedSteps / steps.length) * 100),
    completedSteps,
    totalSteps: steps.length,
    reviewSteps,
    blockedSteps,
    nextStep,
    steps
  };
}

function setupStep(step: SetupProgressStep): SetupProgressStep {
  return {
    ...step,
    label: sanitizeText(step.label),
    description: sanitizeText(step.description),
    evidence: uniqueStrings(step.evidence),
    artifacts: uniqueStrings(step.artifacts),
    command: step.command ? sanitizeText(step.command) : undefined
  };
}

function setupPhase(steps: SetupProgressStep[], status: SetupProgressReport["status"]): string {
  if (status === "ready") return "ready for required PR checks";
  if (status === "not_started") return "scan repository";
  const next =
    steps.find((step) => step.status === "blocked") ??
    steps.find((step) => step.status === "review") ??
    steps.find((step) => step.status === "pending");
  if (!next) return "ready for required PR checks";
  return next.label.toLowerCase();
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => sanitizeText(value)).filter(Boolean))].sort();
}
