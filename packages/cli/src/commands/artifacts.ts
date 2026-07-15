import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";
import { indexArtifacts, loadConfig, sanitizeText, type ArtifactIndexReport } from "@visual-hive/core";

export interface ArtifactsCommandOptions {
  config?: string;
  cwd?: string;
  format?: "markdown" | "json";
  maxArtifacts?: number;
  maxPreviewBytes?: number;
  complete?: boolean;
  project?: string;
  repo?: string;
}

export async function runArtifactsCommand(options: ArtifactsCommandOptions = {}): Promise<{ index: ArtifactIndexReport; indexPath: string }> {
  const cwd = options.cwd ?? process.cwd();
  const loaded = options.repo ? undefined : await loadConfig(options.config, cwd);
  const requestedRepoRoot = options.repo ? path.resolve(cwd, options.repo) : loaded!.rootDir;
  const repoRoot = await realpath(requestedRepoRoot);
  const project = options.project ?? loaded?.config.project.name ?? path.basename(repoRoot);
  const hiveRoot = path.join(repoRoot, ".visual-hive");
  const indexPath = path.join(hiveRoot, "artifacts-index.json");
  const lockPath = path.join(repoRoot, ".visual-hive-artifacts-index.lock");
  let index: ArtifactIndexReport;
  let completeLock: ArtifactSealLock | undefined;
  let indexPublished = false;
  try {
    const hiveRootPresent = await inspectSecureArtifactDirectory(repoRoot, hiveRoot, true);
    if (options.complete) {
      completeLock = await acquireArtifactSealLock(repoRoot, lockPath);
      await writeArtifactIndexAtomic(
        repoRoot,
        indexPath,
        incompleteArtifactIndex(project, new Error("Complete artifact sealing is in progress."), "Complete artifact sealing is in progress")
      );
      if (!hiveRootPresent) {
        throw new Error("Complete artifact indexing could not enumerate .visual-hive (ENOENT).");
      }
    }
    index = await indexArtifacts({
      repoRoot,
      hiveRoot,
      project,
      maxArtifacts: options.maxArtifacts,
      maxPreviewBytes: options.maxPreviewBytes,
      complete: options.complete
    });
    await writeArtifactIndexAtomic(repoRoot, indexPath, index);
    indexPublished = true;
  } catch (error) {
    if (options.complete && completeLock && !indexPublished) {
      try {
        await writeArtifactIndexAtomic(repoRoot, indexPath, incompleteArtifactIndex(project, error));
      } catch (sealError) {
        throw new AggregateError([error, sealError], "Complete artifact indexing failed and its incomplete receipt could not be published safely.");
      }
    }
    throw error;
  } finally {
    if (completeLock) await releaseArtifactSealLock(completeLock);
  }
  if (options.complete && !index.complete) {
    throw new Error(
      `Complete artifact indexing failed at ${indexPath}: ${index.summary.omittedArtifactCount} of ${index.summary.discoveredArtifactCount} discovered artifacts were omitted.`
    );
  }
  return { index, indexPath };
}

async function writeArtifactIndexAtomic(repoRoot: string, indexPath: string, index: ArtifactIndexReport): Promise<void> {
  const directory = path.dirname(indexPath);
  await ensureSecureArtifactDirectory(repoRoot, directory);
  const directoryIdentity = await secureDirectoryIdentity(repoRoot, directory);
  const temporaryPath = path.join(directory, `.${path.basename(indexPath)}.${randomUUID()}.tmp`);
  const serialized = Buffer.from(`${JSON.stringify(index, null, 2)}\n`, "utf8");
  try {
    const temporary = await open(temporaryPath, "wx", 0o600);
    try {
      await temporary.writeFile(serialized);
      await temporary.sync();
    } finally {
      await temporary.close();
    }
    await assertSecureDirectoryIdentity(repoRoot, directory, directoryIdentity);
    await assertStableFileBytes(temporaryPath, serialized, "temporary artifact index");
    await rename(temporaryPath, indexPath);
    await assertSecureDirectoryIdentity(repoRoot, directory, directoryIdentity);
    await assertStableFileBytes(indexPath, serialized, "published artifact index");
  } finally {
    if (await secureArtifactDirectoryMatches(repoRoot, directory, directoryIdentity)) {
      await rm(temporaryPath, { force: true });
    }
  }
}

interface ArtifactSealLock {
  identity: FileIdentity;
  lockPath: string;
  token: string;
}

interface FileIdentity {
  dev: bigint;
  ino: bigint;
}

async function acquireArtifactSealLock(repoRoot: string, lockPath: string): Promise<ArtifactSealLock> {
  const canonicalRoot = await realpath(repoRoot);
  if (path.dirname(lockPath) !== canonicalRoot) throw new Error(`Artifact seal lock escapes the repository root: ${lockPath}`);
  const token = randomUUID();
  const payload = Buffer.from(`${JSON.stringify({ token, pid: process.pid, createdAt: new Date().toISOString() })}\n`, "utf8");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      try {
        await handle.writeFile(payload);
        await handle.sync();
        const stat = await handle.stat({ bigint: true });
        if (!stat.isFile()) throw new Error(`Artifact seal lock is not a regular file: ${lockPath}`);
        return { identity: fileIdentity(stat), lockPath, token };
      } finally {
        await handle.close();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = await readArtifactSealLock(lockPath);
      if (isProcessAlive(existing.pid)) {
        throw new Error(`Complete artifact indexing is already running for ${repoRoot} (pid ${existing.pid}).`);
      }
      if (attempt > 0) throw new Error(`Could not recover stale artifact seal lock: ${lockPath}`);
      await quarantineStaleArtifactSealLock(lockPath, existing.identity);
    }
  }
  throw new Error(`Could not acquire artifact seal lock: ${lockPath}`);
}

async function releaseArtifactSealLock(lock: ArtifactSealLock): Promise<void> {
  const current = await readArtifactSealLock(lock.lockPath);
  if (current.token !== lock.token || !sameIdentity(current.identity, lock.identity)) {
    throw new Error(`Artifact seal lock identity changed while indexing: ${lock.lockPath}`);
  }
  const releasedPath = `${lock.lockPath}.${lock.token}.released`;
  await rename(lock.lockPath, releasedPath);
  const released = await readArtifactSealLock(releasedPath);
  if (released.token !== lock.token || !sameIdentity(released.identity, lock.identity)) {
    throw new Error(`Artifact seal lock changed during release: ${lock.lockPath}`);
  }
  await rm(releasedPath, { force: true });
}

async function quarantineStaleArtifactSealLock(lockPath: string, identity: FileIdentity): Promise<void> {
  const stalePath = `${lockPath}.${randomUUID()}.stale`;
  await rename(lockPath, stalePath);
  const stale = await readArtifactSealLock(stalePath);
  if (!sameIdentity(stale.identity, identity)) {
    throw new Error(`Artifact seal lock changed during stale-lock recovery: ${lockPath}`);
  }
  await rm(stalePath, { force: true });
}

async function readArtifactSealLock(lockPath: string): Promise<{ identity: FileIdentity; pid: number; token: string }> {
  const before = await lstat(lockPath, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink()) throw new Error(`Artifact seal lock is not a regular file: ${lockPath}`);
  const flags = process.platform === "win32" ? constants.O_RDONLY : constants.O_RDONLY | constants.O_NOFOLLOW;
  const handle = await open(lockPath, flags);
  let bytes: Buffer;
  let during;
  try {
    during = await handle.stat({ bigint: true });
    bytes = await handle.readFile();
  } finally {
    await handle.close();
  }
  const after = await lstat(lockPath, { bigint: true });
  const identity = fileIdentity(before);
  if (!during.isFile() || !sameIdentity(identity, fileIdentity(during)) || !sameIdentity(identity, fileIdentity(after))) {
    throw new Error(`Artifact seal lock changed while it was read: ${lockPath}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`Artifact seal lock is malformed: ${lockPath}`);
  }
  if (!isLockPayload(parsed)) throw new Error(`Artifact seal lock is malformed: ${lockPath}`);
  return { identity, pid: parsed.pid, token: parsed.token };
}

function isLockPayload(value: unknown): value is { pid: number; token: string } {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return Number.isSafeInteger(candidate.pid) && Number(candidate.pid) > 0 && typeof candidate.token === "string" && candidate.token.length > 0;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code !== "ESRCH" && code !== "EINVAL";
  }
}

async function assertStableFileBytes(filePath: string, expected: Buffer, description: string): Promise<void> {
  const before = await lstat(filePath, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink()) throw new Error(`${description} is not a regular file: ${filePath}`);
  const flags = process.platform === "win32" ? constants.O_RDONLY : constants.O_RDONLY | constants.O_NOFOLLOW;
  const handle = await open(filePath, flags);
  let actual: Buffer;
  let during;
  try {
    during = await handle.stat({ bigint: true });
    actual = await handle.readFile();
  } finally {
    await handle.close();
  }
  const after = await lstat(filePath, { bigint: true });
  const identity = fileIdentity(before);
  if (!during.isFile() || !sameIdentity(identity, fileIdentity(during)) || !sameIdentity(identity, fileIdentity(after)) || !actual.equals(expected)) {
    throw new Error(`${description} changed during publication: ${filePath}`);
  }
}

async function secureDirectoryIdentity(repoRoot: string, directory: string): Promise<FileIdentity> {
  await inspectSecureArtifactDirectory(repoRoot, directory, false);
  const stat = await lstat(directory, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Artifact index directory is not a secure directory: ${directory}`);
  return fileIdentity(stat);
}

async function assertSecureDirectoryIdentity(repoRoot: string, directory: string, expected: FileIdentity): Promise<void> {
  const actual = await secureDirectoryIdentity(repoRoot, directory);
  if (!sameIdentity(actual, expected)) throw new Error(`Artifact index directory identity changed during publication: ${directory}`);
}

async function secureArtifactDirectoryMatches(repoRoot: string, directory: string, expected: FileIdentity): Promise<boolean> {
  try {
    const actual = await secureDirectoryIdentity(repoRoot, directory);
    return sameIdentity(actual, expected);
  } catch {
    return false;
  }
}

function fileIdentity(stat: { dev: bigint; ino: bigint }): FileIdentity {
  return { dev: stat.dev, ino: stat.ino };
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.ino === right.ino && (process.platform === "win32" || left.dev === right.dev);
}

async function inspectSecureArtifactDirectory(repoRoot: string, directory: string, allowMissing: boolean): Promise<boolean> {
  const { canonicalRoot, segments } = await artifactDirectoryBoundary(repoRoot, directory);
  let current = canonicalRoot;
  for (const segment of segments) {
    current = path.join(current, segment);
    let currentStat;
    try {
      currentStat = await lstat(current);
    } catch (error) {
      if (allowMissing && (error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
    if (!currentStat.isDirectory() || currentStat.isSymbolicLink()) {
      throw new Error(`Artifact index path contains a non-directory, symbolic link, or reparse point: ${path.relative(canonicalRoot, current).replaceAll("\\", "/")}`);
    }
    const canonical = await realpath(current);
    if (!isInsideOrEqual(canonicalRoot, canonical)) {
      throw new Error(`Artifact index path resolves outside the repository root: ${path.relative(canonicalRoot, current).replaceAll("\\", "/")}`);
    }
  }
  return true;
}

async function ensureSecureArtifactDirectory(repoRoot: string, directory: string): Promise<void> {
  const { canonicalRoot, segments } = await artifactDirectoryBoundary(repoRoot, directory);
  let current = canonicalRoot;
  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      await mkdir(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const currentStat = await lstat(current);
    if (!currentStat.isDirectory() || currentStat.isSymbolicLink()) {
      throw new Error(`Artifact index path contains a non-directory, symbolic link, or reparse point: ${path.relative(canonicalRoot, current).replaceAll("\\", "/")}`);
    }
    const canonical = await realpath(current);
    if (!isInsideOrEqual(canonicalRoot, canonical)) {
      throw new Error(`Artifact index path resolves outside the repository root: ${path.relative(canonicalRoot, current).replaceAll("\\", "/")}`);
    }
  }
}

async function artifactDirectoryBoundary(repoRoot: string, directory: string): Promise<{ canonicalRoot: string; segments: string[] }> {
  const requestedRoot = path.resolve(repoRoot);
  const requestedDirectory = path.resolve(directory);
  const relative = path.relative(requestedRoot, requestedDirectory);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Artifact index path escapes the repository root: ${requestedDirectory}`);
  }
  const canonicalRoot = await realpath(requestedRoot);
  return { canonicalRoot, segments: relative.split(path.sep).filter(Boolean) };
}

function isInsideOrEqual(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function incompleteArtifactIndex(project: string, error: unknown, prefix = "Final complete artifact sealing failed"): ArtifactIndexReport {
  return {
    schemaVersion: 1,
    project,
    generatedAt: new Date().toISOString(),
    root: ".visual-hive",
    contentAddressed: true,
    complete: false,
    summary: {
      discoveredArtifactCount: 0,
      artifactCount: 0,
      omittedArtifactCount: 0,
      totalBytes: 0,
      json: 0,
      markdown: 0,
      image: 0,
      text: 0,
      typescript: 0,
      yaml: 0,
      log: 0,
      other: 0,
      previewed: 0,
      redactedPreviews: 0,
      truncatedPreviews: 0
    },
    artifacts: [],
    warnings: [`${prefix}: ${sanitizeText(error instanceof Error ? error.message : String(error))}`]
  };
}

export function formatArtifactsIndex(index: ArtifactIndexReport, indexPath: string, format: "markdown" | "json" = "markdown"): string {
  if (format === "json") {
    return JSON.stringify(index, null, 2);
  }
  const lines = [
    `Wrote ${indexPath}`,
    `# Artifact Index: ${index.project}`,
    "",
    `- Artifacts: ${index.summary.artifactCount}`,
    `- Complete: ${index.complete}`,
    `- Omitted: ${index.summary.omittedArtifactCount}`,
    `- Total bytes: ${index.summary.totalBytes}`,
    `- JSON: ${index.summary.json}`,
    `- Markdown: ${index.summary.markdown}`,
    `- Images: ${index.summary.image}`,
    `- TypeScript/specs: ${index.summary.typescript}`,
    `- Previewed: ${index.summary.previewed}`,
    `- Redacted previews: ${index.summary.redactedPreviews}`,
    `- Truncated previews: ${index.summary.truncatedPreviews}`,
    "",
    "## Artifacts"
  ];
  for (const artifact of index.artifacts.slice(0, 12)) {
    const labels = artifact.labels.length ? ` labels=${artifact.labels.join(",")}` : "";
    const schema = artifact.schemaPath ? ` schema=${artifact.schemaPath}` : "";
    lines.push(`- ${artifact.path} (${artifact.kind}, ${artifact.bytes} bytes)${labels}${schema}`);
  }
  if (index.artifacts.length > 12) {
    lines.push(`- ... ${index.artifacts.length - 12} more artifact(s)`);
  }
  if (index.warnings.length) {
    lines.push("", "## Warnings", ...index.warnings.map((warning) => `- ${warning}`));
  }
  return lines.join("\n");
}
