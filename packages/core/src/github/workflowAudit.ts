import YAML from "yaml";
import type { VisualHiveConfig } from "../config/schema.js";
import { sanitizeText } from "../utils/sanitize.js";

export type WorkflowKind = "pull_request" | "scheduled" | "trusted_issue" | "unknown";

export interface WorkflowAuditInputFile {
  path: string;
  content: string;
}

export interface WorkflowFinding {
  workflowPath: string;
  kind: string;
  severity: "low" | "medium" | "high" | "critical";
  message: string;
  evidence: string;
}

export interface WorkflowAuditEntry {
  path: string;
  name?: string;
  kind: WorkflowKind;
  triggers: string[];
  permissions: Record<string, string>;
  usesPullRequestTarget: boolean;
  usesSecrets: boolean;
  usesWritePermissions: boolean;
  uploadsVisualHiveArtifacts: boolean;
  includesHiddenArtifacts: boolean;
  appendsStepSummary: boolean;
  createsIssues: boolean;
  downloadsArtifacts: boolean;
  checksOutCode: boolean;
  runsVisualHive: boolean;
  runsMutation: boolean;
  hasDedupeSignature: boolean;
  risk: "low" | "medium" | "high" | "critical";
  findings: WorkflowFinding[];
  recommendations: string[];
}

export interface WorkflowAuditReport {
  schemaVersion: 1;
  project: string;
  generatedAt: string;
  workflowRoot: string;
  summary: {
    workflowCount: number;
    pullRequestWorkflows: number;
    scheduledWorkflows: number;
    trustedIssueWorkflows: number;
    unknownWorkflows: number;
    criticalFindings: number;
    highFindings: number;
    workflowsUsingPullRequestTarget: number;
    prWorkflowsUsingSecrets: number;
    prWorkflowsWithWritePermissions: number;
    workflowsUploadingArtifacts: number;
    workflowsMissingHiddenArtifactUpload: number;
    trustedIssueWorkflowsCheckingOutCode: number;
  };
  workflows: WorkflowAuditEntry[];
  findings: WorkflowFinding[];
  recommendations: string[];
}

export interface AuditWorkflowsOptions {
  workflowRoot?: string;
  now?: Date;
}

export function auditWorkflows(
  config: VisualHiveConfig,
  files: WorkflowAuditInputFile[],
  options: AuditWorkflowsOptions = {}
): WorkflowAuditReport {
  const workflows = files.map((file) => auditWorkflowFile(file));
  const findings = workflows.flatMap((workflow) => workflow.findings);
  return {
    schemaVersion: 1,
    project: config.project.name,
    generatedAt: (options.now ?? new Date()).toISOString(),
    workflowRoot: sanitizeText(options.workflowRoot ?? ".github/workflows"),
    summary: {
      workflowCount: workflows.length,
      pullRequestWorkflows: workflows.filter((workflow) => workflow.kind === "pull_request").length,
      scheduledWorkflows: workflows.filter((workflow) => workflow.kind === "scheduled").length,
      trustedIssueWorkflows: workflows.filter((workflow) => workflow.kind === "trusted_issue").length,
      unknownWorkflows: workflows.filter((workflow) => workflow.kind === "unknown").length,
      criticalFindings: findings.filter((finding) => finding.severity === "critical").length,
      highFindings: findings.filter((finding) => finding.severity === "high").length,
      workflowsUsingPullRequestTarget: workflows.filter((workflow) => workflow.usesPullRequestTarget).length,
      prWorkflowsUsingSecrets: workflows.filter((workflow) => workflow.kind === "pull_request" && workflow.usesSecrets).length,
      prWorkflowsWithWritePermissions: workflows.filter((workflow) => workflow.kind === "pull_request" && workflow.usesWritePermissions).length,
      workflowsUploadingArtifacts: workflows.filter((workflow) => workflow.uploadsVisualHiveArtifacts).length,
      workflowsMissingHiddenArtifactUpload: workflows.filter(
        (workflow) => workflow.uploadsVisualHiveArtifacts && !workflow.includesHiddenArtifacts
      ).length,
      trustedIssueWorkflowsCheckingOutCode: workflows.filter((workflow) => workflow.kind === "trusted_issue" && workflow.checksOutCode).length
    },
    workflows,
    findings,
    recommendations: reportRecommendations(workflows, findings)
  };
}

function auditWorkflowFile(file: WorkflowAuditInputFile): WorkflowAuditEntry {
  const content = sanitizeText(file.content);
  const parsed = parseWorkflow(content);
  const triggers = workflowTriggers(parsed, content);
  const permissions = workflowPermissions(parsed);
  const kind = classifyWorkflow(sanitizeText(file.path), triggers, content);
  const workflow: WorkflowAuditEntry = {
    path: sanitizeText(file.path),
    name: typeof parsed?.name === "string" ? sanitizeText(parsed.name) : undefined,
    kind,
    triggers,
    permissions,
    usesPullRequestTarget: triggers.includes("pull_request_target") || /\bpull_request_target\b/i.test(content),
    usesSecrets: /\$\{\{\s*secrets\./i.test(content) || /\bsecrets\.[A-Z0-9_]+/i.test(content),
    usesWritePermissions: hasWritePermission(permissions) || hasWritePermissionText(content),
    uploadsVisualHiveArtifacts: /actions\/upload-artifact@/i.test(content) && /\.visual-hive/i.test(content),
    includesHiddenArtifacts: /include-hidden-files\s*:\s*true/i.test(content),
    appendsStepSummary: /--github-step-summary|GITHUB_STEP_SUMMARY/i.test(content),
    createsIssues: /github\.rest\.issues|gh\s+issue|issues\s*:\s*write|create-issue/i.test(content),
    downloadsArtifacts: /actions\/download-artifact@/i.test(content),
    checksOutCode: /actions\/checkout@/i.test(content),
    runsVisualHive: /\bvisual-hive\s+(plan|run|mutate|triage|report|providers|workflows)\b/i.test(content) || /packages\/cli\/dist\/index\.js/i.test(content),
    runsMutation: /\bvisual-hive\s+mutate\b/i.test(content),
    hasDedupeSignature: /visual-hive-dedupe|dedupe/i.test(content),
    risk: "low",
    findings: [],
    recommendations: []
  };
  workflow.findings = workflowFindings(workflow);
  workflow.risk = riskFor(workflow.findings);
  workflow.recommendations = workflowRecommendations(workflow);
  return workflow;
}

function workflowFindings(workflow: WorkflowAuditEntry): WorkflowFinding[] {
  const findings: WorkflowFinding[] = [];
  const add = (kind: string, severity: WorkflowFinding["severity"], message: string, evidence: string) => {
    findings.push({ workflowPath: workflow.path, kind, severity, message, evidence: sanitizeText(evidence) });
  };

  if (workflow.usesPullRequestTarget) {
    add(
      "pull_request_target_execution",
      "critical",
      "`pull_request_target` must not be used for workflows that execute untrusted PR code.",
      "pull_request_target"
    );
  }
  if (workflow.kind === "pull_request") {
    if (!workflow.triggers.includes("pull_request")) {
      add("missing_pull_request_trigger", "high", "PR Visual Hive workflow should use `pull_request`.", workflow.triggers.join(", ") || "none");
    }
    if (workflow.usesSecrets) {
      add("pr_uses_secrets", "critical", "PR workflow appears to reference secrets.", "secrets.*");
    }
    if (workflow.usesWritePermissions) {
      add("pr_write_permissions", "critical", "PR workflow should use read-only permissions.", JSON.stringify(workflow.permissions));
    }
    if (workflow.createsIssues) {
      add("pr_creates_issues", "critical", "PR workflow must not create or update issues from untrusted code.", "issue creation pattern");
    }
    if (!workflow.uploadsVisualHiveArtifacts) {
      add("missing_artifact_upload", "medium", "PR workflow should upload `.visual-hive` artifacts for trusted follow-up.", "actions/upload-artifact");
    }
    if (workflow.uploadsVisualHiveArtifacts && !workflow.includesHiddenArtifacts) {
      add("hidden_artifacts_excluded", "medium", "Artifact upload should include hidden `.visual-hive` files.", "include-hidden-files: true");
    }
    if (!workflow.appendsStepSummary) {
      add("missing_step_summary", "low", "PR workflow should append Visual Hive report to `GITHUB_STEP_SUMMARY`.", "--github-step-summary");
    }
    if (!workflow.runsVisualHive) {
      add("missing_visual_hive_commands", "medium", "Workflow does not appear to run Visual Hive commands.", "visual-hive plan/run");
    }
  }

  if (workflow.kind === "scheduled") {
    if (workflow.usesPullRequestTarget) {
      add("scheduled_pull_request_target", "critical", "Scheduled workflows should not use `pull_request_target`.", "pull_request_target");
    }
    if (!workflow.triggers.includes("schedule") && !workflow.triggers.includes("workflow_dispatch")) {
      add("missing_schedule_trigger", "medium", "Scheduled lane should use schedule and/or workflow_dispatch.", workflow.triggers.join(", "));
    }
    if (!workflow.uploadsVisualHiveArtifacts) {
      add("missing_artifact_upload", "medium", "Scheduled workflow should upload `.visual-hive` artifacts.", "actions/upload-artifact");
    }
    if (workflow.uploadsVisualHiveArtifacts && !workflow.includesHiddenArtifacts) {
      add("hidden_artifacts_excluded", "medium", "Artifact upload should include hidden `.visual-hive` files.", "include-hidden-files: true");
    }
    if (!workflow.appendsStepSummary) {
      add("missing_step_summary", "low", "Scheduled workflow should append Visual Hive report to `GITHUB_STEP_SUMMARY`.", "--github-step-summary");
    }
  }

  if (workflow.kind === "trusted_issue") {
    if (!workflow.triggers.includes("workflow_run")) {
      add("missing_workflow_run_trigger", "high", "Trusted issue workflow should be triggered by workflow_run.", "workflow_run");
    }
    if (workflow.checksOutCode) {
      add("trusted_issue_checks_out_code", "critical", "Trusted issue workflow should not checkout or execute PR code.", "actions/checkout");
    }
    if (!workflow.downloadsArtifacts) {
      add("missing_artifact_download", "high", "Trusted issue workflow should download Visual Hive artifacts.", "actions/download-artifact");
    }
    if (!workflow.createsIssues) {
      add("missing_issue_creation", "medium", "Trusted issue workflow should create or update issues from sanitized artifacts.", "issues.create/update");
    }
    if (!workflow.hasDedupeSignature) {
      add("missing_dedupe_signature", "medium", "Trusted issue workflow should dedupe issue updates.", "visual-hive-dedupe");
    }
  }

  return findings;
}

function workflowRecommendations(workflow: WorkflowAuditEntry): string[] {
  const recommendations = new Set<string>();
  if (workflow.kind === "pull_request") {
    recommendations.add("Use pull_request, contents: read, no secrets, plan/run/triage/report, and upload .visual-hive artifacts.");
    recommendations.add("Move issue creation into a trusted workflow_run consumer.");
  }
  if (workflow.kind === "scheduled") {
    recommendations.add("Use schedule/workflow_dispatch for protected secrets, mutation adequacy, and deeper targets.");
    recommendations.add("Upload .visual-hive artifacts with include-hidden-files: true.");
  }
  if (workflow.kind === "trusted_issue") {
    recommendations.add("Do not checkout code; consume sanitized uploaded artifacts only.");
    recommendations.add("Use issues: write only in this trusted workflow and dedupe by signature.");
  }
  for (const finding of workflow.findings) {
    if (finding.kind === "pull_request_target_execution") recommendations.add("Replace pull_request_target with pull_request for untrusted validation.");
    if (finding.kind === "hidden_artifacts_excluded") recommendations.add("Set include-hidden-files: true on upload-artifact.");
  }
  return [...recommendations];
}

function reportRecommendations(workflows: WorkflowAuditEntry[], findings: WorkflowFinding[]): string[] {
  const recommendations = new Set<string>();
  recommendations.add("Keep deterministic PR workflows read-only and secret-free.");
  recommendations.add("Use workflow_run for trusted issue creation from sanitized artifacts.");
  if (!workflows.some((workflow) => workflow.kind === "pull_request")) recommendations.add("Add a Visual Hive pull_request workflow.");
  if (!workflows.some((workflow) => workflow.kind === "trusted_issue")) recommendations.add("Add a trusted failure issue workflow when issue creation is needed.");
  if (findings.some((finding) => finding.severity === "critical")) recommendations.add("Fix critical workflow safety findings before enabling required checks.");
  if (workflows.some((workflow) => workflow.uploadsVisualHiveArtifacts && !workflow.includesHiddenArtifacts)) {
    recommendations.add("Set include-hidden-files: true wherever .visual-hive artifacts are uploaded.");
  }
  return [...recommendations];
}

function parseWorkflow(content: string): Record<string, unknown> | undefined {
  try {
    const parsed = YAML.parse(content) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function workflowTriggers(parsed: Record<string, unknown> | undefined, content: string): string[] {
  const value = parsed?.on ?? parsed?.["true"];
  const triggers = new Set<string>();
  if (typeof value === "string") triggers.add(value);
  else if (Array.isArray(value)) value.forEach((entry) => typeof entry === "string" && triggers.add(entry));
  else if (value && typeof value === "object") Object.keys(value).forEach((trigger) => triggers.add(trigger));
  if (triggers.size === 0) {
    for (const trigger of ["pull_request_target", "pull_request", "workflow_run", "workflow_dispatch", "schedule"]) {
      if (new RegExp(`^\\s*${trigger}\\s*:`, "im").test(content) || new RegExp(`on\\s*:\\s*\\[[^\\]]*\\b${trigger}\\b`, "i").test(content)) {
        triggers.add(trigger);
      }
    }
  }
  return [...triggers].sort();
}

function workflowPermissions(parsed: Record<string, unknown> | undefined): Record<string, string> {
  const permissions = parsed?.permissions;
  if (!permissions) return {};
  if (typeof permissions === "string") return { "*": sanitizeText(permissions) };
  if (typeof permissions !== "object" || Array.isArray(permissions)) return {};
  return Object.fromEntries(
    Object.entries(permissions as Record<string, unknown>).map(([key, value]) => [sanitizeText(key), sanitizeText(String(value))])
  );
}

function classifyWorkflow(path: string, triggers: string[], content: string): WorkflowKind {
  const lowerPath = path.toLowerCase();
  const lowerContent = content.toLowerCase();
  if (triggers.includes("workflow_run") || lowerPath.includes("failure-issue") || lowerPath.includes("trusted")) return "trusted_issue";
  if (triggers.includes("pull_request") || triggers.includes("pull_request_target") || lowerPath.includes("-pr")) return "pull_request";
  if (triggers.includes("schedule") || lowerPath.includes("scheduled")) return "scheduled";
  if (lowerContent.includes("visual-hive") && lowerContent.includes("workflow_dispatch")) return "scheduled";
  return "unknown";
}

function hasWritePermission(permissions: Record<string, string>): boolean {
  return Object.values(permissions).some((value) => value.toLowerCase().includes("write") || value.toLowerCase() === "write-all");
}

function hasWritePermissionText(content: string): boolean {
  const permissionsBlock = content.match(/permissions\s*:\s*(?<body>[\s\S]{0,400}?)(?:\n[a-zA-Z0-9_-]+\s*:|\n\n|$)/i)?.groups?.body ?? "";
  return /\b(write|write-all)\b/i.test(permissionsBlock);
}

function riskFor(findings: WorkflowFinding[]): WorkflowAuditEntry["risk"] {
  if (findings.some((finding) => finding.severity === "critical")) return "critical";
  if (findings.some((finding) => finding.severity === "high")) return "high";
  if (findings.some((finding) => finding.severity === "medium")) return "medium";
  return "low";
}
