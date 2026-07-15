import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { visualHiveVersion } from "./version.js";

export interface VisualHiveReleaseIdentity {
  version: string;
  gitCommit: string;
  release: boolean;
  clean: boolean;
}

export interface ResolveVisualHiveReleaseIdentityOptions {
  requireRelease?: boolean;
  candidates?: string[];
}

export async function resolveVisualHiveReleaseIdentity(
  options: ResolveVisualHiveReleaseIdentityOptions = {}
): Promise<VisualHiveReleaseIdentity> {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = options.candidates ?? [
    path.join(moduleDir, "release-manifest.json"),
    path.join(moduleDir, "release-identity.json"),
    path.resolve(moduleDir, "../dist/release-identity.json")
  ];

  for (const candidate of [...new Set(candidates)]) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(candidate, "utf8"));
    } catch (error) {
      if (isMissingFile(error)) continue;
      throw new Error(`Unable to read installed Visual Hive release identity at ${candidate}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!isRecord(parsed)
      || (parsed.schemaVersion !== "visual-hive.release-identity.v1" && parsed.schemaVersion !== "visual-hive.release.v1")
      || parsed.name !== "visual-hive"
      || parsed.version !== visualHiveVersion
      || typeof parsed.gitCommit !== "string"
      || (parsed.gitCommit !== "unavailable" && !/^[a-f0-9]{40}$/.test(parsed.gitCommit))
      || (parsed.release !== undefined && typeof parsed.release !== "boolean")
      || (parsed.clean !== undefined && typeof parsed.clean !== "boolean")) {
      throw new Error(`Installed Visual Hive release identity is invalid or does not match version ${visualHiveVersion}: ${candidate}`);
    }
    const identity = {
      version: parsed.version,
      gitCommit: parsed.gitCommit,
      release: parsed.release === true,
      clean: parsed.clean === true
    };
    if (identity.release && (!identity.clean || !/^[a-f0-9]{40}$/.test(identity.gitCommit))) {
      throw new Error(`Installed Visual Hive release identity has an invalid release/clean marker: ${candidate}`);
    }
    assertRequiredReleaseIdentity(identity, options.requireRelease ?? false);
    return identity;
  }

  const fallbackCommit = process.env.VISUAL_HIVE_GIT_COMMIT?.trim()
    || process.env.VISUAL_HIVE_BUILD_SHA?.trim()
    || "unavailable";
  const fallback = {
    version: visualHiveVersion,
    gitCommit: /^[a-f0-9]{40}$/.test(fallbackCommit) ? fallbackCommit : "unavailable",
    release: false,
    clean: false
  };
  assertRequiredReleaseIdentity(fallback, options.requireRelease ?? false);
  return fallback;
}

function assertRequiredReleaseIdentity(identity: VisualHiveReleaseIdentity, required: boolean): void {
  if (!required) return;
  if (!identity.release || !identity.clean || !/^[a-f0-9]{40}$/.test(identity.gitCommit)) {
    throw new Error("Hosted Visual Hive bundle publication requires an installed clean release identity bound to an exact Git commit.");
  }
}

function isMissingFile(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
