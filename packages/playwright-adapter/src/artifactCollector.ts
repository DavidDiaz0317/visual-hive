import { constants } from "node:fs";
import { access, lstat, readdir, realpath } from "node:fs/promises";
import path from "node:path";

const MAX_ARTIFACT_FILES = 4096;
const MAX_ARTIFACT_DEPTH = 16;

export async function collectArtifacts(rootDir: string, artifactDir = ".visual-hive/artifacts", generatedSpecPath?: string): Promise<string[]> {
  const root = await realpath(path.resolve(rootDir));
  const resolvedArtifactDir = assertContained(root, path.resolve(root, artifactDir), "artifact directory");
  const generatedSpec = generatedSpecPath ?? path.join(rootDir, ".visual-hive", "generated", "visual-hive.generated.spec.ts");
  const files: string[] = [];
  await listFilesSafe(root, resolvedArtifactDir, 0, files);
  if (await exists(generatedSpec)) {
    const containedSpec = assertContained(root, path.resolve(generatedSpec), "generated spec");
    const info = await lstat(containedSpec);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("Generated Playwright spec must be an ordinary contained file.");
    files.push(containedSpec);
  }
  return files.sort();
}

async function listFilesSafe(root: string, dir: string, depth: number, files: string[]): Promise<void> {
  if (depth > MAX_ARTIFACT_DEPTH) throw new Error(`Playwright artifact inventory exceeds its depth limit of ${MAX_ARTIFACT_DEPTH}.`);
  try {
    const directoryInfo = await lstat(dir);
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) throw new Error(`Playwright artifact path is not an ordinary directory: ${dir}.`);
    const resolvedDirectory = await realpath(dir);
    assertContained(root, resolvedDirectory, "artifact directory");
    const entries = (await readdir(resolvedDirectory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const fullPath = assertContained(root, path.join(resolvedDirectory, entry.name), "artifact entry");
      const info = await lstat(fullPath);
      if (info.isSymbolicLink()) throw new Error(`Playwright artifact inventory contains a symbolic link: ${fullPath}.`);
      if (info.isDirectory()) {
        await listFilesSafe(root, fullPath, depth + 1, files);
        continue;
      }
      if (!info.isFile()) throw new Error(`Playwright artifact inventory contains a special file: ${fullPath}.`);
      files.push(fullPath);
      if (files.length > MAX_ARTIFACT_FILES) throw new Error(`Playwright artifact inventory exceeds its file limit of ${MAX_ARTIFACT_FILES}.`);
    }
  } catch (error) {
    if (isMissingPathError(error)) return;
    throw error;
  }
}

function assertContained(root: string, candidate: string, label: string): string {
  const absolute = path.resolve(candidate);
  const relative = path.relative(root, absolute);
  if (relative === "" && label === "artifact directory") return absolute;
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Playwright ${label} escaped the repository root.`);
  }
  return absolute;
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
