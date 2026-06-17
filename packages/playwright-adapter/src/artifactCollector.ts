import { constants } from "node:fs";
import { access, readdir } from "node:fs/promises";
import path from "node:path";

export async function collectArtifacts(rootDir: string, artifactDir = ".visual-hive/artifacts", generatedSpecPath?: string): Promise<string[]> {
  const resolvedArtifactDir = path.resolve(rootDir, artifactDir);
  const generatedSpec = generatedSpecPath ?? path.join(rootDir, ".visual-hive", "generated", "visual-hive.generated.spec.ts");
  const files = await listFilesSafe(resolvedArtifactDir);
  if (await exists(generatedSpec)) {
    files.push(generatedSpec);
  }
  return files.sort();
}

async function listFilesSafe(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(dir, entry.name);
        return entry.isDirectory() ? listFilesSafe(fullPath) : [fullPath];
      })
    );
    return files.flat();
  } catch {
    return [];
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
