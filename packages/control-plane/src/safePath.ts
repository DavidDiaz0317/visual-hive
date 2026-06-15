import { stat } from "node:fs/promises";
import path from "node:path";

export function normalizeRepoRelativePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\/+/, "");
}

export function toRepoRelativePath(repoRoot: string, filePath: string): string {
  return normalizeRepoRelativePath(path.relative(repoRoot, filePath));
}

export function resolveSafeChildPath(root: string, requestedPath: string): string {
  const normalizedRequest = normalizeRepoRelativePath(requestedPath);
  if (!normalizedRequest || normalizedRequest.includes("\0")) {
    throw new Error("Artifact path is required");
  }
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(resolvedRoot, normalizedRequest);
  if (!isInsidePath(resolvedRoot, resolvedPath)) {
    throw new Error(`Refusing to read path outside Visual Hive artifacts: ${requestedPath}`);
  }
  return resolvedPath;
}

export function isInsidePath(parent: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export function artifactKind(filePath: string): "json" | "markdown" | "image" | "text" | "typescript" | "other" {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".json") return "json";
  if (ext === ".md" || ext === ".markdown") return "markdown";
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"].includes(ext)) return "image";
  if (ext === ".ts" || ext === ".tsx") return "typescript";
  if ([".txt", ".log", ".yaml", ".yml"].includes(ext)) return "text";
  return "other";
}

export function contentTypeForKind(kind: ReturnType<typeof artifactKind>, filePath: string): string {
  if (kind === "json") return "application/json; charset=utf-8";
  if (kind === "markdown" || kind === "text" || kind === "typescript") return "text/plain; charset=utf-8";
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  if (ext === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}
