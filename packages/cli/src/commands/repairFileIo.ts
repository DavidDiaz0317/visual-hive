import { constants } from "node:fs";
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import path from "node:path";

export async function readBoundedOrdinaryFile(filePathValue: string, maxBytes: number, label: string): Promise<Buffer> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error(`Invalid byte limit for ${label}.`);
  const filePath = path.resolve(filePathValue);
  const entry = await lstat(filePath);
  if (!entry.isFile() || entry.isSymbolicLink()) throw new Error(`${label} must be an ordinary file.`);
  const handle = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size <= 0 || before.size > maxBytes) {
      throw new Error(`${label} must contain between 1 and ${maxBytes} bytes.`);
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (bytes.byteLength !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
      throw new Error(`${label} changed while it was being read.`);
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

export async function readBoundedJsonFile<T = unknown>(filePath: string, maxBytes: number, label: string): Promise<T> {
  const bytes = await readBoundedOrdinaryFile(filePath, maxBytes, label);
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as T;
  } catch (error) {
    throw new Error(`${label} is not valid UTF-8 JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function ensureCanonicalDirectoryRoot(rootValue: string, label: string): Promise<string> {
  const requested = path.resolve(rootValue);
  const parsed = path.parse(requested);
  let current = parsed.root;
  await canonicalExistingDirectoryRoot(current, label);
  const relative = path.relative(parsed.root, requested);
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      await mkdir(current);
    } catch (error) {
      if (!isErrorCode(error, "EEXIST")) throw error;
    }
    await canonicalExistingDirectoryRoot(current, label);
  }
  return canonicalExistingDirectoryRoot(requested, label);
}

export async function canonicalExistingDirectoryRoot(rootValue: string, label: string): Promise<string> {
  const requested = path.resolve(rootValue);
  const entry = await lstat(requested);
  if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error(`${label} must be an ordinary directory.`);
  const canonical = await realpath(requested);
  if (filesystemIdentity(canonical) !== filesystemIdentity(requested)) {
    throw new Error(`${label} cannot contain a symbolic-link or junction ancestor.`);
  }
  return canonical;
}

export async function ensureSafeRelativeDirectory(rootValue: string, relativeValue: string, label: string): Promise<string> {
  const root = await canonicalExistingDirectoryRoot(rootValue, `${label} root`);
  const segments = safeRelativeSegments(relativeValue, label);
  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      await mkdir(current);
    } catch (error) {
      if (!isErrorCode(error, "EEXIST")) throw error;
    }
    const entry = await lstat(current);
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error(`${label} contains a non-directory or linked parent.`);
    const canonical = await realpath(current);
    assertContained(root, canonical, label);
    if (filesystemIdentity(canonical) !== filesystemIdentity(current)) throw new Error(`${label} contains a symbolic-link or junction parent.`);
  }
  return current;
}

export async function resolveSafeRelativeWriteFile(rootValue: string, relativeValue: string, label: string): Promise<string> {
  const root = await canonicalExistingDirectoryRoot(rootValue, `${label} root`);
  const segments = safeRelativeSegments(relativeValue, label);
  const fileName = segments.pop();
  if (!fileName) throw new Error(`${label} requires a file path.`);
  const parent = segments.length === 0 ? root : await ensureSafeRelativeDirectory(root, segments.join("/"), label);
  const destination = path.join(parent, fileName);
  assertContained(root, destination, label);
  try {
    const entry = await lstat(destination);
    if (!entry.isFile() || entry.isSymbolicLink()) throw new Error(`${label} destination is not an ordinary file.`);
    const canonical = await realpath(destination);
    assertContained(root, canonical, label);
  } catch (error) {
    if (!isErrorCode(error, "ENOENT")) throw error;
  }
  return destination;
}

function safeRelativeSegments(relativeValue: string, label: string): string[] {
  const normalized = relativeValue.replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || path.isAbsolute(relativeValue)) throw new Error(`${label} must be repository-relative.`);
  const segments = normalized.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) throw new Error(`${label} contains an unsafe path segment.`);
  return segments;
}

function assertContained(root: string, candidate: string, label: string): void {
  const relative = path.relative(root, candidate);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} escaped its approved root.`);
  }
}

function filesystemIdentity(value: string): string {
  const normalized = path.normalize(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code;
}
