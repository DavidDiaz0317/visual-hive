import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { sanitizeText } from "../utils/sanitize.js";

export type ArtifactKind = "json" | "markdown" | "image" | "text" | "typescript" | "yaml" | "log" | "other";

export interface ArtifactIndexReport {
  schemaVersion: 1;
  project: string;
  generatedAt: string;
  root: string;
  summary: ArtifactIndexSummary;
  artifacts: ArtifactIndexEntry[];
  warnings: string[];
}

export interface ArtifactIndexSummary {
  artifactCount: number;
  totalBytes: number;
  json: number;
  markdown: number;
  image: number;
  text: number;
  typescript: number;
  yaml: number;
  log: number;
  other: number;
  previewed: number;
  redactedPreviews: number;
  truncatedPreviews: number;
}

export interface ArtifactIndexEntry {
  path: string;
  kind: ArtifactKind;
  contentType: string;
  bytes: number;
  safeToRender: boolean;
  schemaPath?: string;
  schemaId?: string;
  preview?: string;
  previewTruncated: boolean;
  previewRedacted: boolean;
  labels: string[];
}

export interface IndexArtifactsOptions {
  repoRoot: string;
  hiveRoot?: string;
  project?: string;
  now?: Date;
  maxArtifacts?: number;
  maxPreviewBytes?: number;
}

const DEFAULT_MAX_ARTIFACTS = 500;
const DEFAULT_MAX_PREVIEW_BYTES = 8192;
const GENERATED_ARTIFACT_INDEX = ".visual-hive/artifacts-index.json";
const SCHEMA_ID_BASE = "https://visual-hive.dev/schemas/";

export async function indexArtifacts(options: IndexArtifactsOptions): Promise<ArtifactIndexReport> {
  const repoRoot = path.resolve(options.repoRoot);
  const hiveRoot = path.resolve(options.hiveRoot ?? path.join(repoRoot, ".visual-hive"));
  if (!isInsideOrEqual(repoRoot, hiveRoot)) {
    throw new Error(`Refusing to index artifacts outside repository root: ${options.hiveRoot}`);
  }
  const maxArtifacts = options.maxArtifacts ?? DEFAULT_MAX_ARTIFACTS;
  const maxPreviewBytes = options.maxPreviewBytes ?? DEFAULT_MAX_PREVIEW_BYTES;
  const warnings: string[] = [];
  const artifacts: ArtifactIndexEntry[] = [];

  await walk(hiveRoot, async (filePath) => {
    const repoRelativePath = toRepoRelativePath(repoRoot, filePath);
    if (isGeneratedArtifactIndex(repoRelativePath)) return;
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) return;
    artifacts.push(await artifactEntry({ repoRoot, hiveRoot, filePath, bytes: fileStat.size, maxPreviewBytes }));
  });

  const sorted = artifacts.sort(compareArtifactEntries).slice(0, maxArtifacts);
  if (artifacts.length > maxArtifacts) {
    warnings.push(`Artifact listing reached maxArtifacts=${maxArtifacts}; some files may be omitted.`);
  }
  return {
    schemaVersion: 1,
    project: options.project ?? "unknown",
    generatedAt: (options.now ?? new Date()).toISOString(),
    root: toRepoRelativePath(repoRoot, hiveRoot),
    summary: summarize(sorted),
    artifacts: sorted,
    warnings
  };
}

function compareArtifactEntries(a: ArtifactIndexEntry, b: ArtifactIndexEntry): number {
  const rankDelta = artifactRank(a) - artifactRank(b);
  if (rankDelta !== 0) return rankDelta;
  return a.path.localeCompare(b.path);
}

function artifactRank(artifact: ArtifactIndexEntry): number {
  if (!artifact.labels.includes("history")) return 0;
  return 1;
}

export function artifactKind(filePath: string): ArtifactKind {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".json") return "json";
  if (ext === ".md" || ext === ".markdown") return "markdown";
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"].includes(ext)) return "image";
  if (ext === ".ts" || ext === ".tsx") return "typescript";
  if (ext === ".yaml" || ext === ".yml") return "yaml";
  if (ext === ".log") return "log";
  if (ext === ".txt") return "text";
  return "other";
}

export function artifactContentType(kind: ArtifactKind, filePath: string): string {
  if (kind === "json") return "application/json; charset=utf-8";
  if (kind === "markdown" || kind === "text" || kind === "typescript" || kind === "yaml" || kind === "log") return "text/plain; charset=utf-8";
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  if (ext === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}

function summarize(artifacts: ArtifactIndexEntry[]): ArtifactIndexSummary {
  const count = (kind: ArtifactKind) => artifacts.filter((artifact) => artifact.kind === kind).length;
  return {
    artifactCount: artifacts.length,
    totalBytes: artifacts.reduce((sum, artifact) => sum + artifact.bytes, 0),
    json: count("json"),
    markdown: count("markdown"),
    image: count("image"),
    text: count("text"),
    typescript: count("typescript"),
    yaml: count("yaml"),
    log: count("log"),
    other: count("other"),
    previewed: artifacts.filter((artifact) => artifact.preview !== undefined).length,
    redactedPreviews: artifacts.filter((artifact) => artifact.previewRedacted).length,
    truncatedPreviews: artifacts.filter((artifact) => artifact.previewTruncated).length
  };
}

async function artifactEntry(input: {
  repoRoot: string;
  hiveRoot: string;
  filePath: string;
  bytes: number;
  maxPreviewBytes: number;
}): Promise<ArtifactIndexEntry> {
  const kind = artifactKind(input.filePath);
  const contentType = artifactContentType(kind, input.filePath);
  const preview = await previewFor(input.filePath, kind, input.maxPreviewBytes);
  const labels = labelsFor(input.filePath, kind);
  const schemaPath = schemaPathFor(input.filePath, kind);
  return {
    path: toRepoRelativePath(input.repoRoot, input.filePath),
    kind,
    contentType,
    bytes: input.bytes,
    safeToRender: kind !== "other",
    schemaPath,
    schemaId: schemaPath ? `${SCHEMA_ID_BASE}${path.basename(schemaPath)}` : undefined,
    preview: preview?.text,
    previewTruncated: Boolean(preview?.truncated),
    previewRedacted: Boolean(preview?.redacted),
    labels
  };
}

async function previewFor(
  filePath: string,
  kind: ArtifactKind,
  maxPreviewBytes: number
): Promise<{ text: string; truncated: boolean; redacted: boolean } | undefined> {
  if (kind === "image" || kind === "other") return undefined;
  const raw = await readFile(filePath);
  const slice = raw.subarray(0, maxPreviewBytes);
  const before = slice.toString("utf8");
  const text = sanitizeText(before);
  return {
    text,
    truncated: raw.length > maxPreviewBytes,
    redacted: text !== before
  };
}

function labelsFor(filePath: string, kind: ArtifactKind): string[] {
  const normalized = filePath.replaceAll("\\", "/").toLowerCase();
  const labels = new Set<string>();
  labels.add(kind);
  if (normalized.includes("/generated/") || normalized.endsWith(".generated.spec.ts")) labels.add("generated-spec");
  if (normalized.includes("/screenshots/")) labels.add("screenshot");
  if (normalized.includes("/snapshots/")) labels.add("baseline");
  if (normalized.includes("/history/")) labels.add("history");
  if (normalized.endsWith("triage-prompt.md") || normalized.endsWith("repair-prompt.md") || normalized.endsWith("baseline-review.md")) {
    labels.add("prompt");
  }
  if (normalized.endsWith("baseline-review.md")) labels.add("baseline-review");
  if (normalized.endsWith("baselines.json")) labels.add("baseline-review");
  if (normalized.endsWith("issue.md")) labels.add("issue");
  if (normalized.endsWith("pr-comment.md")) labels.add("pr-comment");
  if (/\/plan(?:\.[a-z0-9_-]+)?\.json$/.test(normalized)) labels.add("plan");
  if (normalized.endsWith("triage.json")) labels.add("triage-report");
  if (normalized.endsWith("risk.json")) labels.add("risk-register");
  if (normalized.endsWith("readiness.json")) labels.add("readiness-gate");
  if (normalized.endsWith("setup-progress.json")) labels.add("setup-progress");
  if (normalized.endsWith("setup-pr-plan.json")) labels.add("setup-pr-plan");
  if (normalized.endsWith("runbook.json")) labels.add("runbook");
  if (normalized.endsWith("plans.json")) labels.add("plan-lanes");
  if (normalized.endsWith("security.json")) labels.add("security-audit");
  if (normalized.endsWith("costs.json")) labels.add("cost-audit");
  if (normalized.endsWith("control-plane-actions.json")) labels.add("control-plane-actions");
  if (normalized.endsWith("report.json")) labels.add("report");
  if (normalized.endsWith("mutation-report.json")) labels.add("mutation");
  if (normalized.endsWith("flows.json")) labels.add("flow-audit");
  if (normalized.endsWith("provider-results.json")) labels.add("provider-results");
  if (normalized.endsWith("provider-decisions.json")) labels.add("provider-decisions");
  if (normalized.endsWith("provider-setup-plan.json")) labels.add("provider-setup-plan");
  if (normalized.endsWith("provider-handoff.json")) labels.add("provider-handoff");
  if (normalized.endsWith("llm-decisions.json")) labels.add("llm-decisions");
  if (normalized.endsWith("connections-portfolio.json")) labels.add("connections-portfolio");
  if (normalized.endsWith("repo-map.json")) labels.add("repo-map");
  if (normalized.endsWith("repo-context.md")) labels.add("repo-context");
  if (normalized.endsWith("evidence-packet.json")) labels.add("evidence-packet");
  if (normalized.endsWith("evidence-summary.md")) labels.add("evidence-summary");
  if (normalized.endsWith("agent-packet.json")) labels.add("agent-packet");
  if (normalized.endsWith("tool-registry.json")) labels.add("tool-registry");
  if (normalized.endsWith("tool-cards.md")) labels.add("tool-cards");
  if (normalized.endsWith("context-ledger.json")) labels.add("context-ledger");
  if (normalized.endsWith("/handoff.json")) labels.add("handoff-packet");
  if (normalized.endsWith("hive-issue.md")) labels.add("hive-issue");
  if (normalized.endsWith("hive-bead-request.json")) labels.add("hive-bead-request");
  if (normalized.endsWith("hive-handoff-result.json")) labels.add("hive-handoff-result");
  if (normalized.endsWith("/recommendations.json")) labels.add("setup-recommendations");
  if (normalized.endsWith("coverage-recommendations.json")) labels.add("coverage-recommendations");
  return [...labels].sort();
}

function schemaPathFor(filePath: string, kind: ArtifactKind): string | undefined {
  if (kind !== "json") return undefined;
  const fileName = path.basename(filePath.replaceAll("\\", "/").toLowerCase());
  const mapping: Record<string, string> = {
    "plan.json": "visual-hive.plan.schema.json",
    "recommendations.json": "visual-hive.recommendations.schema.json",
    "coverage.json": "visual-hive.coverage.schema.json",
    "coverage-recommendations.json": "visual-hive.coverage-recommendations.schema.json",
    "contracts.json": "visual-hive.contracts.schema.json",
    "flows.json": "visual-hive.flows.schema.json",
    "targets.json": "visual-hive.targets.schema.json",
    "schedules.json": "visual-hive.schedules.schema.json",
    "workflows.json": "visual-hive.workflows.schema.json",
    "risk.json": "visual-hive.risk.schema.json",
    "readiness.json": "visual-hive.readiness.schema.json",
    "setup-progress.json": "visual-hive.setup-progress.schema.json",
    "setup-pr-plan.json": "visual-hive.setup-pr-plan.schema.json",
    "runbook.json": "visual-hive.runbook.schema.json",
    "plans.json": "visual-hive.plans.schema.json",
    "security.json": "visual-hive.security.schema.json",
    "costs.json": "visual-hive.costs.schema.json",
    "history.json": "visual-hive.history.schema.json",
    "triage.json": "visual-hive.triage.schema.json",
    "llm-usage.json": "visual-hive.llm-usage.schema.json",
    "llm-decisions.json": "visual-hive.llm-decisions.schema.json",
    "connections.json": "visual-hive.connections.schema.json",
    "connections-portfolio.json": "visual-hive.connections-portfolio.schema.json",
    "repo-map.json": "visual-hive.repo-map.schema.json",
    "evidence-packet.json": "visual-hive.evidence-packet.schema.json",
    "agent-packet.json": "visual-hive.agent-packet.schema.json",
    "tool-registry.json": "visual-hive.tool-registry.schema.json",
    "context-ledger.json": "visual-hive.context-ledger.schema.json",
    "handoff.json": "visual-hive.handoff.schema.json",
    "hive-bead-request.json": "visual-hive.hive-bead-request.schema.json",
    "hive-handoff-result.json": "visual-hive.hive-handoff-result.schema.json",
    "provider-results.json": "visual-hive.provider-results.schema.json",
    "provider-decisions.json": "visual-hive.provider-decisions.schema.json",
    "provider-setup-plan.json": "visual-hive.provider-setup-plan.schema.json",
    "provider-handoff.json": "visual-hive.provider-handoff.schema.json",
    "artifacts-index.json": "visual-hive.artifacts.schema.json",
    "baseline-approvals.json": "visual-hive.baseline-approvals.schema.json",
    "baseline-rejections.json": "visual-hive.baseline-rejections.schema.json",
    "baselines.json": "visual-hive.baselines.schema.json",
    "mutation-report.json": "visual-hive.mutation-report.schema.json",
    "report.json": "visual-hive.report.schema.json"
  };
  const schemaFile = /^plan(?:\.[a-z0-9_-]+)?\.json$/.test(fileName) ? "visual-hive.plan.schema.json" : mapping[fileName];
  return schemaFile ? `schemas/${schemaFile}` : undefined;
}

async function walk(dir: string, visit: (filePath: string) => Promise<void>): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(child, visit);
    } else if (entry.isFile()) {
      await visit(child);
    }
  }
}

function toRepoRelativePath(repoRoot: string, filePath: string): string {
  return path.relative(repoRoot, filePath).replaceAll("\\", "/");
}

function isInsideOrEqual(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isGeneratedArtifactIndex(repoRelativePath: string): boolean {
  return repoRelativePath.replaceAll("\\", "/") === GENERATED_ARTIFACT_INDEX;
}
