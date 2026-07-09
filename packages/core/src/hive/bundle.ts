import { createHash, randomUUID } from "node:crypto";
import { cp, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export interface VisualHiveBundleSource {
  repository: string;
  repositoryId?: string;
  ref: string;
  commitSha: string;
  event: string;
  workflowName?: string;
  workflowRunId?: string;
  workflowRunAttempt?: string;
  conclusion: string;
  trusted: boolean;
}

export interface VisualHiveBundleFile {
  path: string;
  sourcePath: string;
  sha256: string;
  size: number;
  mediaType: "application/json" | "text/markdown" | "text/plain" | "application/octet-stream";
  schemaVersion?: string;
}

export interface VisualHiveBundleManifest {
  schemaVersion: "visual-hive.bundle.v1";
  bundleId: string;
  generatedAt: string;
  expiresAt: string;
  producer: {
    name: "visual-hive";
    version: string;
    gitCommit: string;
  };
  source: VisualHiveBundleSource;
  project: string;
  mode: string;
  verdict: string;
  acmmRequest: number;
  externalCallsMade: number;
  files: VisualHiveBundleFile[];
  overallDigest: string;
  provenance: {
    kind: "github-actions" | "local";
    subjectDigest: string;
    attestationRequired: boolean;
  };
  safety: {
    atomicWrite: true;
    pathsAreRelative: true;
    digestsRequired: true;
    producerCountersAreAdvisory: true;
  };
}

export interface WriteVisualHiveBundleOptions {
  rootDir: string;
  project: string;
  mode: string;
  verdict: string;
  acmmRequest: number;
  artifacts: string[];
  source: VisualHiveBundleSource;
  producerVersion: string;
  producerGitCommit: string;
  externalCallsMade?: number;
  expiresInHours?: number;
  outputDir?: string;
  now?: Date;
  bundleId?: string;
}

export interface WriteVisualHiveBundleResult {
  manifest: VisualHiveBundleManifest;
  manifestPath: string;
  bundleDir: string;
}

export async function writeVisualHiveBundle(options: WriteVisualHiveBundleOptions): Promise<WriteVisualHiveBundleResult> {
  const rootDir = path.resolve(options.rootDir);
  const bundlesRoot = resolveInsideRoot(rootDir, options.outputDir ?? path.join(".visual-hive", "bundles"));
  const bundleId = safeBundleId(options.bundleId ?? randomUUID());
  const finalDir = path.join(bundlesRoot, bundleId);
  const temporaryDir = path.join(bundlesRoot, `.tmp-${bundleId}-${randomUUID()}`);
  const generatedAt = (options.now ?? new Date()).toISOString();
  const expiresAt = new Date(Date.parse(generatedAt) + (options.expiresInHours ?? 168) * 60 * 60 * 1000).toISOString();

  await mkdir(temporaryDir, { recursive: true });
  try {
    const files: VisualHiveBundleFile[] = [];
    for (const artifact of uniqueSorted(options.artifacts)) {
      const sourcePath = normalizeRelativeArtifactPath(artifact);
      const absoluteSource = resolveInsideRoot(rootDir, sourcePath);
      const sourceStat = await lstat(absoluteSource);
      if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) throw new Error(`Visual Hive bundle artifact is not a regular file: ${sourcePath}`);
      const bundledPath = normalizeRelativeArtifactPath(path.join("files", sourcePath));
      const destination = path.join(temporaryDir, ...bundledPath.split("/"));
      await mkdir(path.dirname(destination), { recursive: true });
      await cp(absoluteSource, destination, { force: false, errorOnExist: true });
      const data = await readFile(destination);
      files.push({
        path: bundledPath,
        sourcePath,
        sha256: sha256(data),
        size: data.byteLength,
        mediaType: mediaTypeFor(sourcePath),
        schemaVersion: schemaVersionFor(sourcePath, data)
      });
    }

    const overallDigest = digestFiles(files);
    const manifest: VisualHiveBundleManifest = {
      schemaVersion: "visual-hive.bundle.v1",
      bundleId,
      generatedAt,
      expiresAt,
      producer: { name: "visual-hive", version: options.producerVersion, gitCommit: options.producerGitCommit },
      source: sanitizeSource(options.source),
      project: options.project,
      mode: options.mode,
      verdict: options.verdict,
      acmmRequest: options.acmmRequest,
      externalCallsMade: options.externalCallsMade ?? 0,
      files,
      overallDigest,
      provenance: {
        kind: process.env.GITHUB_ACTIONS === "true" ? "github-actions" : "local",
        subjectDigest: overallDigest,
        attestationRequired: process.env.GITHUB_ACTIONS === "true"
      },
      safety: {
        atomicWrite: true,
        pathsAreRelative: true,
        digestsRequired: true,
        producerCountersAreAdvisory: true
      }
    };
    await writeFile(path.join(temporaryDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await mkdir(bundlesRoot, { recursive: true });
    await rename(temporaryDir, finalDir);
    return {
      manifest,
      manifestPath: normalizeRelativeArtifactPath(path.relative(rootDir, path.join(finalDir, "manifest.json"))),
      bundleDir: normalizeRelativeArtifactPath(path.relative(rootDir, finalDir))
    };
  } catch (error) {
    await rm(temporaryDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    throw error;
  }
}

export function verifyVisualHiveBundleDigest(manifest: VisualHiveBundleManifest): boolean {
  return manifest.overallDigest === digestFiles(manifest.files);
}

function resolveInsideRoot(rootDir: string, candidate: string): string {
  const resolved = path.resolve(rootDir, candidate);
  const relative = path.relative(rootDir, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Artifact path escapes repository root: ${candidate}`);
  return resolved;
}

function normalizeRelativeArtifactPath(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) throw new Error(`Artifact path must be relative: ${value}`);
  if (normalized.split("/").some((segment) => segment === ".." || segment === "")) throw new Error(`Artifact path is unsafe: ${value}`);
  return normalized;
}

function safeBundleId(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) throw new Error(`Invalid Visual Hive bundle id: ${value}`);
  return value;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map(normalizeRelativeArtifactPath))].sort((a, b) => a.localeCompare(b));
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function digestFiles(files: VisualHiveBundleFile[]): string {
  return sha256(files.map((file) => `${file.path}\0${file.sha256}\0${file.size}`).sort().join("\n"));
}

function mediaTypeFor(filePath: string): VisualHiveBundleFile["mediaType"] {
  if (filePath.endsWith(".json")) return "application/json";
  if (filePath.endsWith(".md")) return "text/markdown";
  if (filePath.endsWith(".txt") || filePath.endsWith(".log")) return "text/plain";
  return "application/octet-stream";
}

function schemaVersionFor(filePath: string, data: Buffer): string | undefined {
  if (!filePath.endsWith(".json")) return undefined;
  try {
    const parsed = JSON.parse(data.toString("utf8")) as { schemaVersion?: unknown };
    return typeof parsed.schemaVersion === "string" ? parsed.schemaVersion : undefined;
  } catch {
    throw new Error(`Visual Hive bundle JSON artifact is invalid: ${filePath}`);
  }
}

function sanitizeSource(source: VisualHiveBundleSource): VisualHiveBundleSource {
  const clean = (value: string | undefined, fallback = "unknown") => (value?.trim() ? value.trim().slice(0, 512) : fallback);
  return {
    repository: clean(source.repository),
    repositoryId: source.repositoryId ? clean(source.repositoryId) : undefined,
    ref: clean(source.ref),
    commitSha: clean(source.commitSha),
    event: clean(source.event),
    workflowName: source.workflowName ? clean(source.workflowName) : undefined,
    workflowRunId: source.workflowRunId ? clean(source.workflowRunId) : undefined,
    workflowRunAttempt: source.workflowRunAttempt ? clean(source.workflowRunAttempt) : undefined,
    conclusion: clean(source.conclusion),
    trusted: source.trusted
  };
}
