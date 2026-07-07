import path from "node:path";
import { readdir, readFile, stat } from "node:fs/promises";
import { sanitizeArtifactPathForIssue, sanitizeText, type VisualHiveIssueCandidate } from "@visual-hive/core";

const REQUIRED_VISUAL_HIVE_ARTIFACTS = [
  "issues.json",
  "issue-queue.json",
  "evidence-packet.json",
  "handoff.json",
  "visual-graph.json",
  "visual-impact.json",
  "mutation-report.json",
  "artifacts-index.json"
] as const;

export interface VisualHiveGitHubAppArtifactSummary {
  issueCandidate?: VisualHiveIssueCandidate;
  artifactRoot: string;
  discoveredArtifacts: string[];
  missingArtifacts: string[];
  externalCallsMade: 0;
  networkCallsMade: 0;
  checkoutPerformed: false;
  repoCodeExecuted: false;
}

export interface BuildArtifactSummaryOptions {
  artifactRoot: string;
  repoRoot?: string;
}

export async function buildVisualHiveArtifactSummaryFromDirectory(options: BuildArtifactSummaryOptions): Promise<VisualHiveGitHubAppArtifactSummary> {
  const artifactRoot = path.resolve(options.artifactRoot);
  const repoRoot = options.repoRoot ? path.resolve(options.repoRoot) : artifactRoot;
  const files = await listFiles(artifactRoot);
  const byBaseName = new Map(files.map((file) => [path.basename(file), file]));
  const discoveredArtifacts = REQUIRED_VISUAL_HIVE_ARTIFACTS
    .filter((name) => byBaseName.has(name))
    .map((name) => sanitizeArtifactPathForIssue(repoRoot, byBaseName.get(name)));
  const missingArtifacts = REQUIRED_VISUAL_HIVE_ARTIFACTS.filter((name) => !byBaseName.has(name));
  const issueCandidate = await readBestIssueCandidate(byBaseName.get("issues.json"), repoRoot, discoveredArtifacts);

  return {
    issueCandidate,
    artifactRoot: sanitizeArtifactPathForIssue(repoRoot, artifactRoot),
    discoveredArtifacts,
    missingArtifacts,
    externalCallsMade: 0,
    networkCallsMade: 0,
    checkoutPerformed: false,
    repoCodeExecuted: false
  };
}

async function listFiles(root: string): Promise<string[]> {
  const rootStats = await stat(root).catch((error: unknown) => {
    throw new Error(`Cannot read Visual Hive artifact root ${sanitizeText(root)}. ${sanitizeText(error instanceof Error ? error.message : String(error))}`);
  });
  if (!rootStats.isDirectory()) throw new Error(`Visual Hive artifact root must be a directory: ${sanitizeText(root)}`);
  return walk(root);
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

async function readBestIssueCandidate(issuesPath: string | undefined, repoRoot: string, discoveredArtifacts: string[]): Promise<VisualHiveIssueCandidate | undefined> {
  if (!issuesPath) return undefined;
  const raw = await readFile(issuesPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  const issues = objectValue(parsed)?.issues;
  if (!Array.isArray(issues)) return undefined;
  const candidates = issues.filter((issue): issue is Record<string, unknown> => Boolean(objectValue(issue)));
  const selected = candidates.find((issue) => issue.status === "open_candidate" || issue.status === "update_candidate")
    ?? candidates.find((issue) => issue.status === "resolved_candidate")
    ?? candidates[0];
  if (!selected) return undefined;
  return normalizeIssueCandidate(selected, repoRoot, discoveredArtifacts);
}

function normalizeIssueCandidate(candidate: Record<string, unknown>, repoRoot: string, discoveredArtifacts: string[]): VisualHiveIssueCandidate {
  const sourceArtifacts = Array.isArray(candidate.sourceArtifacts)
    ? candidate.sourceArtifacts.map((artifact) => sanitizeArtifactPathForIssue(repoRoot, String(artifact)))
    : discoveredArtifacts;
  const labels = Array.isArray(candidate.labels) ? candidate.labels.map((label) => sanitizeText(String(label))) : ["visual-hive"];
  const guardrails = Array.isArray(candidate.guardrails)
    ? candidate.guardrails.map((guardrail) => sanitizeText(String(guardrail)))
    : ["Do not repair code from the GitHub App.", "Do not approve baselines blindly."];

  return {
    ...candidate,
    title: sanitizeText(stringValue(candidate.title) ?? "[Visual Hive] Issue candidate"),
    issueKind: sanitizeText(stringValue(candidate.issueKind) ?? "visual_hive_issue"),
    severity: sanitizeText(stringValue(candidate.severity) ?? "medium"),
    status: sanitizeText(stringValue(candidate.status) ?? "open_candidate"),
    dedupeFingerprint: sanitizeText(stringValue(candidate.dedupeFingerprint) ?? `visual-hive:${stringValue(candidate.issueKind) ?? "issue"}:${stringValue(candidate.title) ?? "candidate"}`),
    labels,
    body: sanitizeText(stringValue(candidate.body) ?? "Visual Hive issue candidate generated from trusted workflow artifacts."),
    owningAgentHint: sanitizeText(stringValue(candidate.owningAgentHint) ?? "visual-hive/review-agent"),
    sourceArtifacts,
    affected: Array.isArray(candidate.affected) ? candidate.affected : [],
    validationCommand: sanitizeText(stringValue(candidate.validationCommand) ?? "visual-hive verdict"),
    guardrails
  } as VisualHiveIssueCandidate;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
