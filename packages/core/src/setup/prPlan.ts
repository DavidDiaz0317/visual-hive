import path from "node:path";
import type { SetupRecommendationReport, SetupWorkflowPreview } from "./recommend.js";
import { sanitizeText } from "../utils/sanitize.js";

export type SetupPullRequestPlanStatus = "ready" | "review" | "blocked";
export type SetupPullRequestPlanFileKind = "config" | "docs" | "workflow" | "audit";

export interface SetupPullRequestPlanFile {
  path: string;
  kind: SetupPullRequestPlanFileKind;
  action: "create" | "review" | "audit";
  source: string;
  requiresOverwriteReview: boolean;
}

export interface SetupPullRequestPlanStep {
  id: string;
  title: string;
  status: SetupPullRequestPlanStatus;
  command?: string;
  writes: string[];
  safetyNotes: string[];
}

export interface SetupPullRequestPlanProviderDecision {
  providerId: string;
  label: string;
  recommendation: string;
  requiredEnv: string[];
  externalUploadAllowedByDefault: boolean;
}

export interface SetupPullRequestPlanSecurity {
  pullRequestPermissions: string[];
  pullRequestSecretsRequired: string[];
  scheduledSecretsRequired: string[];
  generatedWorkflowsUsePullRequestTarget: boolean;
  generatedPrWorkflowUsesSecrets: boolean;
  externalUploadsInPullRequest: boolean;
  issueCreationFromUntrustedPr: boolean;
  notes: string[];
}

export interface SetupPullRequestPlanReport {
  schemaVersion: 1;
  project: string;
  generatedAt: string;
  sourceRecommendationGeneratedAt: string;
  setupProfile: SetupRecommendationReport["setupProfile"];
  status: SetupPullRequestPlanStatus;
  title: string;
  summary: {
    filesPlanned: number;
    workflowsPlanned: number;
    validationCommands: number;
    externalCallsMade: 0;
    requiresReview: boolean;
    blockedReasons: string[];
  };
  files: SetupPullRequestPlanFile[];
  workflowPreviews: Array<Pick<SetupWorkflowPreview, "id" | "label" | "path" | "description" | "safetyNotes">>;
  providerDecisions: SetupPullRequestPlanProviderDecision[];
  validationCommands: string[];
  steps: SetupPullRequestPlanStep[];
  security: SetupPullRequestPlanSecurity;
  warnings: string[];
}

export function buildSetupPullRequestPlan(
  recommendation: SetupRecommendationReport,
  now: Date = new Date()
): SetupPullRequestPlanReport {
  const security = setupSecurity(recommendation);
  const blockedReasons = blockedSetupReasons(security);
  const reviewReasons = reviewSetupReasons(recommendation, security);
  const status: SetupPullRequestPlanStatus = blockedReasons.length ? "blocked" : reviewReasons.length ? "review" : "ready";
  const files = setupFiles(recommendation);
  return {
    schemaVersion: 1,
    project: sanitizeText(recommendation.project.name),
    generatedAt: now.toISOString(),
    sourceRecommendationGeneratedAt: recommendation.generatedAt,
    setupProfile: recommendation.setupProfile,
    status,
    title: sanitizeText(recommendation.setupPullRequest.title),
    summary: {
      filesPlanned: files.length,
      workflowsPlanned: recommendation.workflowPreviews.length,
      validationCommands: recommendation.recommendedCommands.length,
      externalCallsMade: 0,
      requiresReview: status !== "ready",
      blockedReasons
    },
    files,
    workflowPreviews: recommendation.workflowPreviews.map((workflow) => ({
      id: sanitizeText(workflow.id),
      label: sanitizeText(workflow.label),
      path: sanitizePath(workflow.path),
      description: sanitizeText(workflow.description),
      safetyNotes: workflow.safetyNotes.map(sanitizeText)
    })),
    providerDecisions: recommendation.providerRecommendations.map((provider) => ({
      providerId: sanitizeText(provider.providerId),
      label: sanitizeText(provider.label),
      recommendation: provider.recommendation,
      requiredEnv: provider.requiredEnv.map(sanitizeText),
      externalUploadAllowedByDefault: provider.externalUploadAllowedByDefault
    })),
    validationCommands: recommendation.recommendedCommands.map(sanitizeText),
    steps: setupSteps(recommendation, status, reviewReasons),
    security,
    warnings: [...recommendation.warnings.map(sanitizeText), ...reviewReasons].filter(unique)
  };
}

function setupFiles(recommendation: SetupRecommendationReport): SetupPullRequestPlanFile[] {
  const plannedPaths = new Set([
    ...recommendation.setupPullRequest.files,
    ...recommendation.workflowPreviews.map((workflow) => workflow.path)
  ]);
  const setupFiles = [...plannedPaths].map((filePath) => ({
    path: sanitizePath(filePath),
    kind: fileKind(filePath),
    action: "create" as const,
    source: "setupPullRequest.files",
    requiresOverwriteReview: true
  }));
  const auditFiles: SetupPullRequestPlanFile[] = [
    ".visual-hive/recommendations.json",
    ".visual-hive/setup-pr-plan.json",
    ".visual-hive/setup-bundle-edits.json"
  ].map((filePath) => ({
    path: filePath,
    kind: "audit" as const,
    action: "audit" as const,
    source: "visual-hive",
    requiresOverwriteReview: false
  }));
  return [...setupFiles, ...auditFiles].sort((a, b) => a.path.localeCompare(b.path));
}

function setupSteps(
  recommendation: SetupRecommendationReport,
  status: SetupPullRequestPlanStatus,
  reviewReasons: string[]
): SetupPullRequestPlanStep[] {
  const setupBundleAction = recommendation.setupActions.find((action) => action.id === "preview-setup-pr");
  return [
    {
      id: "review-recommendation",
      title: "Review setup recommendation and generated config",
      status: "review",
      command: "visual-hive recommend",
      writes: [".visual-hive/recommendations.json", ".visual-hive/setup-pr-plan.json"],
      safetyNotes: ["No external provider, LLM, or GitHub API calls are made."]
    },
    {
      id: "record-provider-posture",
      title: "Record provider posture before enabling optional uploads",
      status: recommendation.providerRecommendations.some((provider) => provider.externalUploadAllowedByDefault) ? "review" : "ready",
      command: recommendation.setupActions.find((action) => action.id === "skip-provider-for-now")?.command,
      writes: [".visual-hive/provider-decisions.json"],
      safetyNotes: ["Provider decisions are local governance records only; they do not create credentials or billing."]
    },
    {
      id: "write-setup-files",
      title: "Write config, docs, and safe workflow templates",
      status,
      command: setupBundleAction?.command ?? "visual-hive recommend --write-setup-bundle",
      writes: recommendation.setupPullRequest.files.map(sanitizePath),
      safetyNotes: setupBundleAction?.safetyNotes.map(sanitizeText) ?? [
        "Review generated files before writing them.",
        "Existing files require an explicit overwrite decision."
      ]
    },
    {
      id: "validate-locally",
      title: "Run deterministic local validation",
      status: recommendation.recommendedCommands.length ? "ready" : "review",
      command: recommendation.recommendedCommands.join(" && "),
      writes: [".visual-hive/plan.json", ".visual-hive/report.json"],
      safetyNotes: ["Validation runs the target app and Playwright contracts; it should not require PR secrets."]
    },
    {
      id: "open-setup-pr",
      title: "Open setup PR after validation",
      status: status === "blocked" ? "blocked" : reviewReasons.length ? "review" : "ready",
      writes: [],
      safetyNotes: [
        "Use a normal pull_request workflow for PR checks.",
        "Do not create issues directly from untrusted PR execution."
      ]
    }
  ];
}

function setupSecurity(recommendation: SetupRecommendationReport): SetupPullRequestPlanSecurity {
  const generatedWorkflows = recommendation.workflowPreviews;
  const prWorkflow = generatedWorkflows.find((workflow) => workflow.id === "pull_request");
  return {
    pullRequestPermissions: recommendation.permissions.pullRequest.permissions.map(sanitizeText),
    pullRequestSecretsRequired: recommendation.permissions.pullRequest.secretsRequired.map(sanitizeText),
    scheduledSecretsRequired: recommendation.permissions.scheduled.secretsRequired.map(sanitizeText),
    generatedWorkflowsUsePullRequestTarget: generatedWorkflows.some((workflow) => workflow.content.includes("pull_request_target")),
    generatedPrWorkflowUsesSecrets: Boolean(prWorkflow?.content.includes("secrets.")),
    externalUploadsInPullRequest: recommendation.providerRecommendations.some((provider) => provider.externalUploadAllowedByDefault),
    issueCreationFromUntrustedPr: Boolean(prWorkflow?.content.toLowerCase().includes("issues: write")),
    notes: [
      "PR setup must use pull_request with read-only permissions and no secrets.",
      "Trusted issue creation belongs in workflow_run artifact consumers, not untrusted PR execution.",
      "LLM and provider output remains advisory unless a trusted workflow explicitly enables governed integrations."
    ]
  };
}

function blockedSetupReasons(security: SetupPullRequestPlanSecurity): string[] {
  const reasons: string[] = [];
  if (security.generatedWorkflowsUsePullRequestTarget) reasons.push("Generated workflow preview references pull_request_target.");
  if (security.generatedPrWorkflowUsesSecrets) reasons.push("Generated PR workflow preview references secrets.");
  if (security.issueCreationFromUntrustedPr) reasons.push("Generated PR workflow preview can write issues.");
  if (security.pullRequestSecretsRequired.length) reasons.push("Recommended PR lane requires secrets.");
  return reasons;
}

function reviewSetupReasons(recommendation: SetupRecommendationReport, security: SetupPullRequestPlanSecurity): string[] {
  const reasons: string[] = [];
  if (recommendation.setupPullRequest.recommended) reasons.push("Setup PR files should be reviewed before writing.");
  if (security.externalUploadsInPullRequest) reasons.push("External provider uploads require explicit trusted review before use.");
  if (recommendation.recommendedTarget.confidence === "low") reasons.push("Recommended target confidence is low; review install/build/serve commands.");
  return reasons.map(sanitizeText);
}

function fileKind(filePath: string): SetupPullRequestPlanFileKind {
  const normalized = filePath.replaceAll("\\", "/");
  if (normalized.endsWith(".github/workflows/visual-hive-pr.yml") || normalized.includes("/workflows/")) return "workflow";
  if (normalized.endsWith("visual-hive.config.yaml")) return "config";
  if (normalized.endsWith(".md")) return "docs";
  return "audit";
}

function sanitizePath(filePath: string): string {
  return sanitizeText(filePath.replaceAll("\\", "/")).replaceAll(path.sep, "/");
}

function unique(value: string, index: number, all: string[]): boolean {
  return all.indexOf(value) === index;
}
