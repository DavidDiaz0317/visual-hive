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
    if (artifacts.length >= maxArtifacts) return;
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) return;
    artifacts.push(await artifactEntry({ repoRoot, hiveRoot, filePath, bytes: fileStat.size, maxPreviewBytes }));
  });

  if (artifacts.length >= maxArtifacts) {
    warnings.push(`Artifact listing reached maxArtifacts=${maxArtifacts}; some files may be omitted.`);
  }
  const sorted = artifacts.sort((a, b) => a.path.localeCompare(b.path));
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
  return {
    path: toRepoRelativePath(input.repoRoot, input.filePath),
    kind,
    contentType,
    bytes: input.bytes,
    safeToRender: kind !== "other",
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
  if (normalized.endsWith("triage-prompt.md") || normalized.endsWith("repair-prompt.md")) labels.add("prompt");
  if (normalized.endsWith("issue.md")) labels.add("issue");
  if (normalized.endsWith("pr-comment.md")) labels.add("pr-comment");
  if (normalized.endsWith("report.json")) labels.add("report");
  if (normalized.endsWith("mutation-report.json")) labels.add("mutation");
  return [...labels].sort();
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
