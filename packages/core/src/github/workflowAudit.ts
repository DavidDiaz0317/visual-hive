import YAML from "yaml";
import type { VisualHiveConfig } from "../config/schema.js";
import { getEvidenceResourceById } from "../tools/evidenceResources.js";
import { sanitizeText } from "../utils/sanitize.js";

export type WorkflowKind = "pull_request" | "scheduled" | "trusted_issue" | "trusted_handoff" | "unknown";

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

export interface WorkflowActionReference {
  value: string;
  action: string;
  ref?: string;
  pinning: "sha" | "tag" | "unpinned" | "local";
  line: number;
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
  readsIssueArtifact: boolean;
  readsHiveHandoffArtifacts: boolean;
  usesRecursiveArtifactDiscovery: boolean;
  reSanitizesIssueBody: boolean;
  hasLiveIssuePublishGuard: boolean;
  runsVisualHive: boolean;
  runsMutation: boolean;
  writesBaselineReview: boolean;
  hasDedupeSignature: boolean;
  actions: WorkflowActionReference[];
  unpinnedActions: WorkflowActionReference[];
  usesUnpinnedActions: boolean;
  risk: "low" | "medium" | "high" | "critical";
  findings: WorkflowFinding[];
  recommendations: string[];
}

export interface WorkflowAuditReport {
  schemaVersion: 1;
  project: string;
  generatedAt: string;
  outputResource?: WorkflowAuditOutputResource;
  workflowRoot: string;
  summary: {
    workflowCount: number;
    pullRequestWorkflows: number;
    scheduledWorkflows: number;
    trustedIssueWorkflows: number;
    trustedHandoffWorkflows: number;
    unknownWorkflows: number;
    criticalFindings: number;
    highFindings: number;
    workflowsUsingPullRequestTarget: number;
    prWorkflowsUsingSecrets: number;
    prWorkflowsWithWritePermissions: number;
    workflowsUploadingArtifacts: number;
    workflowsMissingHiddenArtifactUpload: number;
    trustedIssueWorkflowsCheckingOutCode: number;
    trustedHandoffWorkflowsCheckingOutCode: number;
    trustedIssueWorkflowsMissingLivePublishGuard: number;
    workflowsUsingUnpinnedActions: number;
    unpinnedActionReferences: number;
  };
  workflows: WorkflowAuditEntry[];
  findings: WorkflowFinding[];
  recommendations: string[];
}

export interface WorkflowAuditOutputResource {
  artifactPath: string;
  evidenceResourceId: string;
  evidenceResourceUri: string;
  evidenceResourceTitle: string;
  evidenceResourceDescription: string;
  evidenceReadToolName?: string;
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
    outputResource: catalogedWorkflowAuditOutputResource(),
    workflowRoot: sanitizeText(options.workflowRoot ?? ".github/workflows"),
    summary: {
      workflowCount: workflows.length,
      pullRequestWorkflows: workflows.filter((workflow) => workflow.kind === "pull_request").length,
      scheduledWorkflows: workflows.filter((workflow) => workflow.kind === "scheduled").length,
      trustedIssueWorkflows: workflows.filter((workflow) => workflow.kind === "trusted_issue").length,
      trustedHandoffWorkflows: workflows.filter((workflow) => workflow.kind === "trusted_handoff").length,
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
      trustedIssueWorkflowsCheckingOutCode: workflows.filter((workflow) => workflow.kind === "trusted_issue" && workflow.checksOutCode).length,
      trustedHandoffWorkflowsCheckingOutCode: workflows.filter((workflow) => workflow.kind === "trusted_handoff" && workflow.checksOutCode).length,
      trustedIssueWorkflowsMissingLivePublishGuard: workflows.filter(
        (workflow) => (workflow.kind === "trusted_issue" || workflow.kind === "trusted_handoff") && workflow.createsIssues && !workflow.hasLiveIssuePublishGuard
      ).length,
      workflowsUsingUnpinnedActions: workflows.filter((workflow) => workflow.usesUnpinnedActions).length,
      unpinnedActionReferences: workflows.reduce((sum, workflow) => sum + workflow.unpinnedActions.length, 0)
    },
    workflows,
    findings,
    recommendations: reportRecommendations(workflows, findings)
  };
}

function catalogedWorkflowAuditOutputResource(): WorkflowAuditOutputResource {
  const resource = getEvidenceResourceById("workflow-audit");
  return {
    artifactPath: ".visual-hive/workflows.json",
    evidenceResourceId: resource?.id ?? "workflow-audit",
    evidenceResourceUri: resource?.uri ?? "visual-hive://workflow-audit",
    evidenceResourceTitle: resource?.title ?? "Workflow Audit",
    evidenceResourceDescription:
      resource?.description ??
      "GitHub workflow safety evidence for PR permissions, secret use, pull_request_target posture, artifact upload, and trusted workflow_run patterns.",
    evidenceReadToolName: resource?.readTool?.name ?? "visual_hive_read_workflow_audit"
  };
}

function auditWorkflowFile(file: WorkflowAuditInputFile): WorkflowAuditEntry {
  const content = sanitizeText(file.content);
  // Parse the original YAML before redacting report text. Redaction can
  // intentionally rewrite credential-related words that are also valid job
  // identifiers (for example, a setup authorization job).
  const parsed = parseWorkflow(file.content);
  const triggers = workflowTriggers(parsed, content);
  const permissions = workflowPermissions(parsed, content);
  const kind = classifyWorkflow(sanitizeText(file.path), triggers, content);
  const actions = workflowActions(content);
  const unpinnedActions = actions.filter((action) => action.pinning !== "sha" && action.pinning !== "local");
  const usesPullRequestTarget = triggers.includes("pull_request_target") || /\bpull_request_target\b/i.test(content);
  const executesUntrustedPullRequestTargetCode = usesPullRequestTarget && !hasIsolatedHiveUninstallLane(parsed);
  const workflow: WorkflowAuditEntry = {
    path: sanitizeText(file.path),
    name: typeof parsed?.name === "string" ? sanitizeText(parsed.name) : undefined,
    kind,
    triggers,
    permissions,
    usesPullRequestTarget,
    usesSecrets: /\$\{\{\s*secrets\./i.test(content) || /\bsecrets\.[A-Z0-9_]+/i.test(content),
    usesWritePermissions: hasWritePermission(permissions) || hasWritePermissionText(content),
    uploadsVisualHiveArtifacts: /actions\/upload-artifact@/i.test(content) && /\.visual-hive/i.test(content),
    includesHiddenArtifacts: /include-hidden-files\s*:\s*true/i.test(content),
    appendsStepSummary: /--github-step-summary|GITHUB_STEP_SUMMARY/i.test(content),
    createsIssues: /github\.rest\.issues|gh\s+issue|issues\s*:\s*write|create-issue/i.test(content),
    downloadsArtifacts: /actions\/download-artifact@/i.test(content),
    checksOutCode: /actions\/checkout@/i.test(content),
    readsIssueArtifact: /issues\.json|issue\.md/i.test(content),
    readsHiveHandoffArtifacts:
      /evidence-packet\.json|handoff\.json|hive-bead-request\.json|hive-handoff-result\.json|hive-export\.json|guarded-repair-preview\.json|repair-request-envelope\.json|trusted-repair-consumer-summary\.json|trusted-repair-workflow-dry-run\.json/i.test(content),
    usesRecursiveArtifactDiscovery: /findIssueBody|walkArtifacts|readdirSync\([^)]*\{\s*withFileTypes\s*:\s*true|recursive artifact/i.test(content),
    reSanitizesIssueBody: /\b(redact|sanitize)\w*\s*\(/i.test(content) && /client_secret|set-cookie|authorization|bearer|cookie/i.test(content),
    hasLiveIssuePublishGuard: /VISUAL_HIVE_AUTO_PUBLISH_ISSUES|VISUAL_HIVE_LIVE_GITHUB_ISSUE|publish_issues|publish-issues/i.test(content),
    runsVisualHive:
      /\bvisual-hive\s+(plan|run|mutate|triage|report|providers|workflows|baselines|pipeline)\b/i.test(content) ||
      /packages\/cli\/dist\/index\.js/i.test(content) ||
      /DavidDiaz0317\/visual-hive\/actions\/run@/i.test(content),
    runsMutation: /\bvisual-hive\s+mutate\b/i.test(content) || /--enforce-mutation|--mode\s+(schedule|mutation|full)\b/i.test(content),
    writesBaselineReview:
      /\bvisual-hive\s+baselines\s+list\b[\s\S]*--write/i.test(content) ||
      /\bvisual-hive\s+pipeline\b|command:\s+pipeline|command:\s*["']?pipeline/i.test(content) ||
      /\.visual-hive\/baselines\.json/i.test(content) ||
      /npm\s+run\s+demo:baselines/i.test(content),
    hasDedupeSignature: /visual-hive-dedupe|dedupe/i.test(content),
    actions,
    unpinnedActions,
    usesUnpinnedActions: unpinnedActions.length > 0,
    risk: "low",
    findings: [],
    recommendations: []
  };
  workflow.findings = workflowFindings(workflow, executesUntrustedPullRequestTargetCode);
  workflow.risk = riskFor(workflow.findings);
  workflow.recommendations = workflowRecommendations(workflow);
  return workflow;
}

function workflowFindings(workflow: WorkflowAuditEntry, executesUntrustedPullRequestTargetCode: boolean): WorkflowFinding[] {
  const findings: WorkflowFinding[] = [];
  const add = (kind: string, severity: WorkflowFinding["severity"], message: string, evidence: string) => {
    findings.push({ workflowPath: workflow.path, kind, severity, message, evidence: sanitizeText(evidence) });
  };

  if (executesUntrustedPullRequestTargetCode) {
    add(
      "pull_request_target_execution",
      "critical",
      "`pull_request_target` must not be used for workflows that execute untrusted PR code.",
      "pull_request_target"
    );
  }
  for (const action of workflow.unpinnedActions) {
    add(
      "action_not_sha_pinned",
      "low",
      "External GitHub Action references should be SHA-pinned in production workflows.",
      `${action.value} on line ${action.line}`
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
    if (workflow.runsVisualHive && !workflow.writesBaselineReview) {
      add(
        "missing_baseline_review_artifact",
        "low",
        "PR workflow should write `.visual-hive/baselines.json` before uploading artifacts.",
        "visual-hive baselines list --write"
      );
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
    if (workflow.runsVisualHive && !workflow.writesBaselineReview) {
      add(
        "missing_baseline_review_artifact",
        "low",
        "Scheduled workflow should write `.visual-hive/baselines.json` before uploading artifacts.",
        "visual-hive baselines list --write"
      );
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
    if (!workflow.readsIssueArtifact) {
      add("missing_issue_artifact", "high", "Trusted issue workflow should read `.visual-hive/issues.json` from uploaded artifacts.", "issues.json");
    }
    if (workflow.downloadsArtifacts && workflow.readsIssueArtifact && !workflow.usesRecursiveArtifactDiscovery) {
      add(
        "brittle_issue_artifact_path",
        "medium",
        "Trusted issue workflow should discover `issues.json` recursively because uploaded artifact roots vary by workflow.",
        "recursive artifact discovery"
      );
    }
    if (workflow.createsIssues && !workflow.reSanitizesIssueBody) {
      add(
        "missing_trusted_issue_redaction",
        "medium",
        "Trusted issue workflow should redact secret-like values again before creating or updating an issue.",
        "redact issue body"
      );
    }
    if (!workflow.createsIssues) {
      add("missing_issue_creation", "medium", "Trusted issue workflow should create or update issues from sanitized artifacts.", "issues.create/update");
    }
    if (workflow.createsIssues && !workflow.hasLiveIssuePublishGuard) {
      add(
        "missing_live_issue_publish_guard",
        "high",
        "Trusted issue workflow must require an explicit repository variable or workflow input before live issue publication.",
        "VISUAL_HIVE_AUTO_PUBLISH_ISSUES"
      );
    }
    if (!workflow.hasDedupeSignature) {
      add("missing_dedupe_signature", "medium", "Trusted issue workflow should dedupe issue updates.", "visual-hive-dedupe");
    }
  }

  if (workflow.kind === "trusted_handoff") {
    if (!workflow.triggers.includes("workflow_run")) {
      add("missing_workflow_run_trigger", "high", "Trusted handoff workflow should be triggered by workflow_run.", "workflow_run");
    }
    if (workflow.checksOutCode) {
      add("trusted_handoff_checks_out_code", "critical", "Trusted handoff workflow should not checkout or execute PR code.", "actions/checkout");
    }
    if (!workflow.downloadsArtifacts) {
      add("missing_artifact_download", "high", "Trusted handoff workflow should download Visual Hive artifacts.", "actions/download-artifact");
    }
    if (!workflow.readsHiveHandoffArtifacts) {
      add(
        "missing_handoff_artifacts",
        "high",
        "Trusted handoff workflow should read Evidence Packet and Hive handoff artifacts from uploaded .visual-hive output.",
        "evidence-packet.json/hive-export.json/guarded-repair-preview.json/repair-request-envelope.json/trusted-repair-consumer-summary.json/trusted-repair-workflow-dry-run.json"
      );
    }
    if (workflow.downloadsArtifacts && workflow.readsHiveHandoffArtifacts && !workflow.usesRecursiveArtifactDiscovery) {
      add(
        "brittle_handoff_artifact_path",
        "medium",
        "Trusted handoff workflow should discover handoff artifacts recursively because uploaded artifact roots vary by workflow.",
        "recursive artifact discovery"
      );
    }
    if (!workflow.reSanitizesIssueBody) {
      add(
        "missing_trusted_handoff_redaction",
        "medium",
        "Trusted handoff workflow should redact secret-like values again before summarizing or forwarding artifacts.",
        "redact handoff artifacts"
      );
    }
    if (workflow.checksOutCode || workflow.runsVisualHive) {
      add(
        "trusted_handoff_executes_code",
        "critical",
        "Trusted handoff workflow should consume artifacts only, not checkout code or run Visual Hive again.",
        "artifact-only workflow"
      );
    }
    if (workflow.createsIssues) {
      if (workflow.permissions.issues !== "write") {
        add(
          "missing_handoff_issue_permission",
          "high",
          "Trusted handoff issue creation requires explicit issues: write permission.",
          "issues: write"
        );
      }
      if (!workflow.readsIssueArtifact) {
        add(
          "missing_hive_issue_artifact",
          "high",
          "Trusted handoff issue creation should use the sanitized hive-issue.md artifact.",
          "hive-issue.md"
        );
      }
      if (!workflow.hasDedupeSignature) {
        add(
          "missing_handoff_dedupe_signature",
          "medium",
          "Trusted handoff issue creation should dedupe issue updates from stable handoff evidence.",
          "visual-hive-hive-handoff-dedupe"
        );
      }
      if (!workflow.hasLiveIssuePublishGuard) {
        add(
          "missing_live_issue_publish_guard",
          "high",
          "Trusted handoff issue publication must require an explicit repository variable or workflow input.",
          "VISUAL_HIVE_AUTO_PUBLISH_ISSUES"
        );
      }
    }
  }

  return findings;
}

function hasIsolatedHiveUninstallLane(parsed: Record<string, unknown> | undefined): boolean {
  const jobs = asRecord(parsed?.jobs);
  if (!jobs || Object.keys(jobs).length === 0) return false;

  const authorization = asRecord(jobs["setup-authorization"]);
  if (!authorization || !isSafeHiveSetupAuthorizationJob(authorization)) return false;

  const publisher = asRecord(jobs["uninstall-required-check"]);
  if (!publisher || !isSafeHiveUninstallPublisherJob(publisher)) return false;

  for (const [name, value] of Object.entries(jobs)) {
    if (name === "setup-authorization" || name === "uninstall-required-check") continue;
    const job = asRecord(value);
    if (!job || !isPullRequestOnlyJob(job)) return false;
  }
  return true;
}

function isSafeHiveSetupAuthorizationJob(job: Record<string, unknown>): boolean {
  const condition = stringValue(job.if);
  if (
    !eventCondition(condition, "pull_request_target") ||
    !eventCondition(condition, "pull_request") ||
    !/github\.event\.pull_request\.head\.ref\s*==\s*["']hive\/uninstall-[1-9][0-9]*["']/u.test(condition) ||
    !/github\.event\.pull_request\.head\.repo\.full_name\s*==\s*github\.repository/u.test(condition) ||
    !/github\.event\.pull_request\.base\.repo\.full_name\s*==\s*github\.repository/u.test(condition)
  ) {
    return false;
  }
  if (
    !isFixedHostedRunner(job) ||
    hasExecutionTopology(job) ||
    !hasExactPermissions(job, { contents: "read", "pull-requests": "read", statuses: "read" })
  ) {
    return false;
  }
  const outputs = asRecord(job.outputs);
  if (!outputs || stringValue(outputs.operation) !== "${{ steps.authorize.outputs.operation }}") return false;
  const steps = asArray(job.steps);
  if (!steps || steps.length !== 3) return false;

  let checkoutCount = 0;
  let setupNodeCount = 0;
  let verifierCount = 0;
  for (const value of steps) {
    const step = asRecord(value);
    if (!step || containsSecretExpression(step) || typeof step["working-directory"] === "string" || !hasOnlyHiveEnvironment(step)) return false;
    const uses = stringValue(step.uses);
    const run = stringValue(step.run);
    if (uses) {
      const action = parseActionReference(uses, 0);
      if (action.pinning !== "sha") return false;
      if (action.action === "actions/checkout") {
        const withValues = asRecord(step.with);
        if (
          !withValues ||
          stringValue(withValues.ref) !== "${{ github.event.pull_request.base.sha }}" ||
          !isFalse(withValues["persist-credentials"]) ||
          withValues.repository !== undefined ||
          withValues.path !== undefined
        ) {
          return false;
        }
        checkoutCount += 1;
      } else if (action.action === "actions/setup-node") {
        setupNodeCount += 1;
      } else {
        return false;
      }
      continue;
    }
    if (
      !run ||
      stringValue(step.shell) !== "bash" ||
      !hasExactEnvironmentValue(step, "HIVE_STATUS_TOKEN", "${{ github.token }}") ||
      !hasExactEnvironmentValue(step, "HIVE_HEAD_REF", "${{ github.event.pull_request.head.ref }}") ||
      !hasExactEnvironmentValue(step, "HIVE_HEAD_SHA", "${{ github.event.pull_request.head.sha }}") ||
      !hasExactEnvironmentValue(step, "HIVE_BASE_SHA", "${{ github.event.pull_request.base.sha }}") ||
      !/^hive\/uninstall-[1-9][0-9]*$/u.test(environmentValue(step, "HIVE_EXPECTED_UNINSTALL_REF")) ||
      !condition.includes(`github.event.pull_request.head.ref == '${environmentValue(step, "HIVE_EXPECTED_UNINSTALL_REF")}'`) ||
      !isSafeHiveAuthorizationVerifier(run)
    ) {
      return false;
    }
    verifierCount += 1;
  }
  return checkoutCount === 1 && setupNodeCount === 1 && verifierCount === 1;
}

function isSafeHiveUninstallPublisherJob(job: Record<string, unknown>): boolean {
  const condition = stringValue(job.if);
  if (
    !eventCondition(condition, "pull_request_target") ||
    !/needs\.setup-authorization\.outputs\.operation\s*==\s*["']uninstall["']/u.test(condition) ||
    !hasOnlyNeed(job.needs, "setup-authorization") ||
    !isFixedHostedRunner(job) ||
    hasExecutionTopology(job) ||
    !hasExactPermissions(job, { checks: "write" })
  ) {
    return false;
  }
  const steps = asArray(job.steps);
  if (!steps || steps.length !== 1) return false;
  const step = asRecord(steps[0]);
  if (
    !step ||
    stringValue(step.uses) ||
    containsSecretExpression(step) ||
    typeof step["working-directory"] === "string" ||
    stringValue(step.shell) !== "bash" ||
    !hasOnlyHiveEnvironment(step) ||
    !hasExactEnvironmentValue(step, "HIVE_CHECK_TOKEN", "${{ github.token }}") ||
    !hasExactEnvironmentValue(step, "HIVE_API_URL", "${{ github.api_url }}") ||
    !hasExactEnvironmentValue(step, "HIVE_REPOSITORY", "${{ github.repository }}") ||
    !hasExactEnvironmentValue(step, "HIVE_HEAD_SHA", "${{ github.event.pull_request.head.sha }}") ||
    !hasExactEnvironmentValue(step, "HIVE_PULL_REQUEST_URL", "${{ github.event.pull_request.html_url }}") ||
    !hasExactEnvironmentValue(step, "HIVE_SETUP_AUTHORIZED", "${{ needs.setup-authorization.outputs.authorized }}") ||
    !hasExactEnvironmentValue(step, "HIVE_SETUP_BINDING_DIGEST", "${{ needs.setup-authorization.outputs.binding_digest }}")
  ) {
    return false;
  }
  return isSafeHiveUninstallPublisher(stringValue(step.run));
}

function isPullRequestOnlyJob(job: Record<string, unknown>): boolean {
  const condition = stringValue(job.if);
  return eventCondition(condition, "pull_request") && !condition.includes("pull_request_target");
}

function isSafeHiveAuthorizationVerifier(run: string): boolean {
  const marker = "node <<'NODE'";
  const markerIndex = run.indexOf(marker);
  if (markerIndex < 0 || !run.trimEnd().endsWith("NODE")) return false;
  const shell = run.slice(0, markerIndex).trim();
  const script = run.slice(markerIndex + marker.length, run.lastIndexOf("NODE"));
  const shellLines = shell.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  const allowedShellLine = (line: string) =>
    line === "set -euo pipefail" ||
    line === 'case "$HIVE_HEAD_REF" in' ||
    line === ";;" ||
    line === "esac" ||
    line === "unset authorization_header" ||
    /^"\$HIVE_EXPECTED_HEAD_REF"\|"\$HIVE_EXPECTED_UPGRADE_REF"\|"\$HIVE_EXPECTED_ROLLBACK_REF"\|"\$HIVE_EXPECTED_AUTHORIZER_TRANSFER_REF"\|"\$HIVE_EXPECTED_UNINSTALL_REF"\)$/u.test(line) ||
    /^authorization_header="\$\(printf 'x-access-token:%s' "\$HIVE_STATUS_TOKEN" \| base64 \| tr -d '\\r\\n'\)"$/u.test(line) ||
    /^git -c protocol\.file\.allow=never -c "http\.extraheader=AUTHORIZATION: basic \$authorization_header" fetch --force --no-tags --no-recurse-submodules origin "refs\/heads\/\$HIVE_HEAD_REF:refs\/remotes\/origin\/hive-authorization-head"$/u.test(line);
  if (shellLines.length < 8 || shellLines.some((line) => !allowedShellLine(line))) return false;
  if (
    !script.includes('require("child_process")') ||
    !script.includes('require("crypto")') ||
    !script.includes('require("fs")') ||
    !script.includes('child.spawnSync("git", args') ||
    !script.includes('"diff-tree"') ||
    !script.includes('"--no-renames"') ||
    !script.includes('"cat-file"') ||
    !script.includes('createHash("sha256")') ||
    !script.includes("HIVE_EXPECTED_UNINSTALL_REF") ||
    !script.includes("HIVE_STATUS_TOKEN") ||
    !script.includes("fs.appendFileSync(process.env.GITHUB_OUTPUT")
  ) {
    return false;
  }
  return !hasUnsafeInlineExecution(script, true);
}

function isSafeHiveUninstallPublisher(run: string): boolean {
  const marker = "node <<'NODE'";
  const markerIndex = run.indexOf(marker);
  if (markerIndex < 0 || run.slice(0, markerIndex).trim() !== "set -euo pipefail" || !run.trimEnd().endsWith("NODE")) return false;
  const script = run.slice(markerIndex + marker.length, run.lastIndexOf("NODE"));
  if (!script.includes("HIVE_SETUP_AUTHORIZED") || !script.includes("HIVE_SETUP_BINDING_DIGEST")) return false;
  if (!script.includes("/check-runs") || !script.includes('name: "visual-hive"') || !script.includes('conclusion: "success"')) return false;
  return !hasUnsafeInlineExecution(script, false);
}

function hasUnsafeInlineExecution(script: string, allowGitMetadataProcess: boolean): boolean {
  if (/\$\{\{\s*secrets\.|\b(?:eval|Function)\s*\(|\bWebAssembly\b|\bprocess\.dlopen\b|\bvm\.|\bimport\s*\(|\brequire\s*\(\s*[^"']/u.test(script)) return true;
  const requiredModules = [...script.matchAll(/\brequire\s*\(\s*["']([^"']+)["']\s*\)/gu)].map((match) => match[1]);
  const allowedModules = allowGitMetadataProcess ? new Set(["child_process", "crypto", "fs"]) : new Set<string>();
  if (requiredModules.some((moduleName) => !allowedModules.has(moduleName))) return true;
  if (!allowGitMetadataProcess && /\bchild_process\b|\bspawn(?:Sync)?\s*\(|\bexec(?:File|Sync)?\s*\(|\bfork\s*\(/u.test(script)) return true;
  if (allowGitMetadataProcess) {
    if (/\bchild\.(?:exec|execFile|fork|spawn)\s*\(/u.test(script)) return true;
    const spawnCalls = [...script.matchAll(/\bchild\.spawnSync\s*\(\s*([^,\n]+)/gu)].map((match) => match[1].trim());
    if (spawnCalls.length === 0 || spawnCalls.some((command) => command !== '"git"' && command !== "'git'")) return true;
  }
  if (/\bfs\.(?:writeFile|createWriteStream|copyFile|rename|chmod|chown|symlink|link|mkdtemp|mkdir|rm|unlink)\w*\s*\(/u.test(script)) return true;
  const appendCalls = [...script.matchAll(/\bfs\.appendFileSync\s*\(\s*([^,\n]+)/gu)].map((match) => match[1].trim());
  if (appendCalls.some((target) => target !== "process.env.GITHUB_OUTPUT")) return true;
  if (allowGitMetadataProcess && /\bmethod\s*:\s*["'](?:POST|PUT|PATCH|DELETE)["']/iu.test(script)) return true;
  return /(^|\n)\s*(?:sudo\s+)?(?:npm|npx|pnpm|yarn|bun|python|python3|pytest|go|cargo|make|dotnet|bash|sh|pwsh|powershell)\b|\bgit\s+(?:checkout|switch|restore|archive|worktree|submodule)\b|(^|\s)(?:\.\/|\.\.\/)[^\s]+/imu.test(script);
}

function eventCondition(condition: string, event: "pull_request" | "pull_request_target"): boolean {
  return new RegExp(`github\\.event_name\\s*==\\s*["']${event}["']`, "u").test(condition);
}

function hasExactPermissions(job: Record<string, unknown>, expected: Record<string, string>): boolean {
  const permissions = asRecord(job.permissions);
  if (!permissions || Object.keys(permissions).length !== Object.keys(expected).length) return false;
  return Object.entries(expected).every(([key, value]) => stringValue(permissions[key]) === value);
}

function hasOnlyNeed(value: unknown, expected: string): boolean {
  if (typeof value === "string") return value === expected;
  return Array.isArray(value) && value.length === 1 && value[0] === expected;
}

function isFixedHostedRunner(job: Record<string, unknown>): boolean {
  return stringValue(job["runs-on"]) === "ubuntu-latest";
}

function hasExecutionTopology(job: Record<string, unknown>): boolean {
  return (
    job.container !== undefined ||
    job.services !== undefined ||
    job.strategy !== undefined ||
    job.defaults !== undefined ||
    job.env !== undefined ||
    job.environment !== undefined ||
    job.uses !== undefined ||
    job.with !== undefined
  );
}

function hasOnlyHiveEnvironment(step: Record<string, unknown>): boolean {
  const environment = asRecord(step.env);
  return !environment || Object.keys(environment).every((key) => key.startsWith("HIVE_"));
}

function hasExactEnvironmentValue(step: Record<string, unknown>, key: string, expected: string): boolean {
  return environmentValue(step, key) === expected;
}

function environmentValue(step: Record<string, unknown>, key: string): string {
  return stringValue(asRecord(step.env)?.[key]);
}

function containsSecretExpression(value: unknown): boolean {
  return /\$\{\{\s*secrets\./iu.test(JSON.stringify(value));
}

function isFalse(value: unknown): boolean {
  return value === false || value === "false";
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function workflowRecommendations(workflow: WorkflowAuditEntry): string[] {
  const recommendations = new Set<string>();
  if (workflow.kind === "pull_request") {
    recommendations.add("Use pull_request, contents: read, no secrets, plan/run/triage/report, and upload .visual-hive artifacts.");
    recommendations.add("Write .visual-hive/baselines.json so trusted follow-up workflows and reviewers can inspect baseline decisions.");
    recommendations.add("Move issue creation into a trusted workflow_run consumer.");
  }
  if (workflow.kind === "scheduled") {
    recommendations.add("Use schedule/workflow_dispatch for protected secrets, mutation adequacy, and deeper targets.");
    recommendations.add("Write .visual-hive/baselines.json after deterministic runs and before artifact upload.");
    recommendations.add("Upload .visual-hive artifacts with include-hidden-files: true.");
  }
  if (workflow.kind === "trusted_issue") {
    recommendations.add("Do not checkout code; consume sanitized uploaded artifacts only.");
    recommendations.add("Use issues: write only in this trusted workflow and dedupe by signature.");
    recommendations.add("Gate live issue publication behind VISUAL_HIVE_AUTO_PUBLISH_ISSUES or an explicit workflow_dispatch input.");
    recommendations.add("Discover issues.json recursively from downloaded artifacts and redact again before issue creation.");
  }
  if (workflow.kind === "trusted_handoff") {
    recommendations.add("Do not checkout code; consume sanitized uploaded artifacts only.");
    recommendations.add("Create or update GitHub issues only from sanitized hive-issue.md artifacts after handoff validation is not blocked.");
    recommendations.add("Gate live issue publication behind VISUAL_HIVE_AUTO_PUBLISH_ISSUES or an explicit workflow_dispatch input.");
    recommendations.add("Validate dry-run Hive artifacts before any future trusted Bead API call.");
    recommendations.add("Keep real Hive network calls behind explicit trusted-lane policy and human approval.");
  }
  for (const finding of workflow.findings) {
    if (finding.kind === "pull_request_target_execution") recommendations.add("Replace pull_request_target with pull_request for untrusted validation.");
    if (finding.kind === "hidden_artifacts_excluded") recommendations.add("Set include-hidden-files: true on upload-artifact.");
    if (finding.kind === "action_not_sha_pinned") {
      recommendations.add("Pin external GitHub Actions by full commit SHA after reviewing the upstream action source.");
    }
  }
  return [...recommendations];
}

function reportRecommendations(workflows: WorkflowAuditEntry[], findings: WorkflowFinding[]): string[] {
  const recommendations = new Set<string>();
  const hasTrustedHandoffPath = workflows.some(
    (workflow) => workflow.kind === "trusted_handoff" || (workflow.kind === "trusted_issue" && workflow.readsHiveHandoffArtifacts)
  );
  recommendations.add("Keep deterministic PR workflows read-only and secret-free.");
  recommendations.add("Use workflow_run for trusted issue creation from sanitized artifacts.");
  if (!workflows.some((workflow) => workflow.kind === "pull_request")) recommendations.add("Add a Visual Hive pull_request workflow.");
  if (!workflows.some((workflow) => workflow.kind === "trusted_issue")) recommendations.add("Add a trusted failure issue workflow when issue creation is needed.");
  if (!hasTrustedHandoffPath) recommendations.add("Add a trusted Hive handoff workflow when agent handoff is needed.");
  if (findings.some((finding) => finding.severity === "critical")) recommendations.add("Fix critical workflow safety findings before enabling required checks.");
  if (findings.some((finding) => finding.kind === "missing_live_issue_publish_guard")) {
    recommendations.add("Require VISUAL_HIVE_AUTO_PUBLISH_ISSUES=true or an explicit workflow_dispatch input before trusted workflows publish live issues.");
  }
  if (workflows.some((workflow) => workflow.uploadsVisualHiveArtifacts && !workflow.includesHiddenArtifacts)) {
    recommendations.add("Set include-hidden-files: true wherever .visual-hive artifacts are uploaded.");
  }
  if (workflows.some((workflow) => workflow.usesUnpinnedActions)) {
    recommendations.add("For production hardening, pin external GitHub Actions by full commit SHA instead of mutable version tags.");
  }
  return [...recommendations];
}

function workflowActions(content: string): WorkflowActionReference[] {
  return content
    .split(/\r?\n/)
    .map((line, index) => {
      const match = line.match(/^\s*-\s+uses\s*:\s*["']?(?<value>[^"'\s#]+)["']?/i);
      if (!match?.groups?.value) return undefined;
      return parseActionReference(match.groups.value, index + 1);
    })
    .filter((reference): reference is WorkflowActionReference => Boolean(reference));
}

function parseActionReference(value: string, line: number): WorkflowActionReference {
  const sanitizedValue = sanitizeText(value);
  if (sanitizedValue.startsWith("./") || sanitizedValue.startsWith("../") || sanitizedValue.startsWith("/")) {
    return {
      value: sanitizedValue,
      action: sanitizedValue,
      line,
      pinning: "local"
    };
  }
  const dockerSha = /^docker:\/\/.+@sha256:[a-f0-9]{64}$/i.test(sanitizedValue);
  const atIndex = sanitizedValue.lastIndexOf("@");
  if (dockerSha) {
    return {
      value: sanitizedValue,
      action: sanitizedValue.slice(0, atIndex),
      ref: sanitizedValue.slice(atIndex + 1),
      line,
      pinning: "sha"
    };
  }
  if (atIndex < 0) {
    return {
      value: sanitizedValue,
      action: sanitizedValue,
      line,
      pinning: "unpinned"
    };
  }
  const action = sanitizedValue.slice(0, atIndex);
  const ref = sanitizedValue.slice(atIndex + 1);
  return {
    value: sanitizedValue,
    action,
    ref,
    line,
    pinning: /^[a-f0-9]{40}$/i.test(ref) ? "sha" : "tag"
  };
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

function workflowPermissions(parsed: Record<string, unknown> | undefined, content: string): Record<string, string> {
  const permissions = parsed?.permissions;
  if (typeof permissions === "string") return { "*": sanitizeText(permissions) };
  if (permissions && typeof permissions === "object" && !Array.isArray(permissions)) {
    return Object.fromEntries(
      Object.entries(permissions as Record<string, unknown>).map(([key, value]) => [sanitizeText(key), sanitizeText(String(value))])
    );
  }
  return workflowPermissionsFromText(content);
}

function workflowPermissionsFromText(content: string): Record<string, string> {
  const singleLine = content.match(/^permissions\s*:\s*(?<value>read-all|write-all|read|write)\s*$/im)?.groups?.value;
  if (singleLine) return { "*": sanitizeText(singleLine) };
  const block = content.match(/^permissions\s*:\s*\n(?<body>(?:[ \t]+[A-Za-z0-9_-]+\s*:\s*[A-Za-z0-9_-]+[^\n]*\n?)+)/im)?.groups?.body;
  if (!block) return {};
  const permissions: Record<string, string> = {};
  for (const line of block.split(/\r?\n/)) {
    const match = line.match(/^\s+(?<key>[A-Za-z0-9_-]+)\s*:\s*(?<value>[A-Za-z0-9_-]+)/);
    if (match?.groups?.key && match.groups.value) {
      permissions[sanitizeText(match.groups.key)] = sanitizeText(match.groups.value);
    }
  }
  return permissions;
}

function classifyWorkflow(path: string, triggers: string[], content: string): WorkflowKind {
  const lowerPath = path.toLowerCase();
  const lowerContent = content.toLowerCase();
  if (lowerPath.includes("hive-handoff") || lowerContent.includes("hive-bead-request.json")) return "trusted_handoff";
  if (triggers.includes("workflow_run") || lowerPath.includes("failure-issue") || lowerPath.includes("trusted")) return "trusted_issue";
  if (triggers.includes("pull_request") || triggers.includes("pull_request_target") || looksLikePullRequestWorkflowPath(lowerPath)) return "pull_request";
  if (triggers.includes("schedule") || lowerPath.includes("scheduled")) return "scheduled";
  if (lowerContent.includes("visual-hive") && lowerContent.includes("workflow_dispatch")) return "scheduled";
  return "unknown";
}

function looksLikePullRequestWorkflowPath(lowerPath: string): boolean {
  return /(^|[\\/_.-])(pr|pull-request|pull_request|pullrequest)([\\/_.-]|$)/i.test(lowerPath);
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
