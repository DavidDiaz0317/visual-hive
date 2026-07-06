import { sanitizeArtifactPathForIssue, sanitizeArtifactPathsForMarkdown, sanitizeText, type VisualHiveIssueCandidate } from "@visual-hive/core";

export interface GitHubRepositoryRef {
  fullName: string;
  defaultBranch?: string;
  htmlUrl?: string;
}

export interface GitHubIssuePayload {
  title: string;
  body: string;
  labels: string[];
  dedupeFingerprint?: string;
}

export interface VisualHiveSetupIssueInput {
  repository: GitHubRepositoryRef;
  detectedFrameworks?: string[];
  proposedConfigPath?: string;
  proposedWorkflowPath?: string;
  nextCommand?: string;
}

export interface ArtifactIssueSummary {
  repository: GitHubRepositoryRef;
  repoRoot?: string;
  candidate: Pick<
    VisualHiveIssueCandidate,
    | "title"
    | "labels"
    | "body"
    | "dedupeFingerprint"
    | "issueKind"
    | "severity"
    | "owningAgentHint"
    | "validationCommand"
    | "sourceArtifacts"
    | "guardrails"
  >;
}

export function buildSetupIssuePayload(input: VisualHiveSetupIssueInput): GitHubIssuePayload {
  const configPath = input.proposedConfigPath ?? "visual-hive.config.yaml";
  const workflowPath = input.proposedWorkflowPath ?? ".github/workflows/visual-hive-pr.yml";
  const command = input.nextCommand ?? "visual-hive recommend --write-setup-bundle";
  const body = [
    "<!-- visual-hive-setup-issue -->",
    "",
    `Repository: ${input.repository.fullName}`,
    `Detected frameworks: ${input.detectedFrameworks?.join(", ") || "unknown"}`,
    "",
    "## Setup Checklist",
    "",
    "- Review the proposed Visual Hive config.",
    "- Keep the PR workflow on `pull_request` with read-only permissions and no secrets.",
    "- Seed baselines locally before enforcing CI.",
    "- Keep Hive, LLMs, and paid providers disabled unless explicitly configured in a trusted lane.",
    "",
    "## Proposed Files",
    "",
    `- Config: ${configPath}`,
    `- PR workflow: ${workflowPath}`,
    "",
    "## Next Action",
    "",
    `Run: \`${command}\``,
    "",
    "Visual Hive detects, proves, packages, and routes QA findings. It does not repair code or decide to approve baselines silently."
  ].join("\n");
  return sanitizeIssuePayload({
    title: "[Visual Hive] Setup visual QA",
    body,
    labels: ["visual-hive", "setup", "hive/quality"],
    dedupeFingerprint: `visual-hive:setup:${input.repository.fullName.toLowerCase()}`
  });
}

export function buildIssuePayloadFromArtifactSummary(input: ArtifactIssueSummary): GitHubIssuePayload {
  const rootDir = input.repoRoot ?? process.cwd();
  const sourceArtifacts = input.candidate.sourceArtifacts.map((artifact) => sanitizeArtifactPathForIssue(rootDir, artifact));
  const body = [
    sanitizeArtifactPathsForMarkdown(rootDir, input.candidate.body),
    "",
    "## GitHub App Routing",
    "",
    `Repository: ${input.repository.fullName}`,
    `Issue kind: ${input.candidate.issueKind}`,
    `Severity: ${input.candidate.severity}`,
    `Owning agent hint: ${input.candidate.owningAgentHint}`,
    `Validation command: \`${input.candidate.validationCommand}\``,
    `Source artifacts: ${sourceArtifacts.join(", ") || "none"}`,
    "",
    "## Guardrails",
    "",
    ...input.candidate.guardrails.map((guardrail) => `- ${guardrail}`),
    "",
    `Dedupe fingerprint: ${input.candidate.dedupeFingerprint}`
  ].join("\n");
  return sanitizeIssuePayload({
    title: input.candidate.title,
    body,
    labels: [...new Set(["visual-hive", ...input.candidate.labels])],
    dedupeFingerprint: input.candidate.dedupeFingerprint
  });
}

export function sanitizeIssuePayload(payload: GitHubIssuePayload): GitHubIssuePayload {
  return {
    title: sanitizeText(payload.title),
    body: sanitizeText(payload.body),
    labels: payload.labels.map((label) => sanitizeText(label)).filter(Boolean),
    dedupeFingerprint: payload.dedupeFingerprint ? sanitizeText(payload.dedupeFingerprint) : undefined
  };
}
