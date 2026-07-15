import path from "node:path";
import { fileURLToPath } from "node:url";
import { sha256Bytes } from "@visual-hive/core";
import { z } from "zod";
import { visualHiveVersion } from "../version.js";
import { canonicalExistingDirectoryRoot, readBoundedOrdinaryFile } from "./repairFileIo.js";

const MAX_RELEASE_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_RELEASE_ENTRYPOINT_BYTES = 128 * 1024 * 1024;
const MAX_RELEASE_FILES = 10_000;
const MAX_RELEASE_TOTAL_BYTES = 512 * 1024 * 1024;

const ReleaseFileSchema = z.object({
  path: z.string().min(1).max(4096),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  size: z.number().int().nonnegative().max(MAX_RELEASE_ENTRYPOINT_BYTES)
}).strict();

const ReleaseManifestSchema = z.object({
  schemaVersion: z.literal("visual-hive.release.v1"),
  name: z.literal("visual-hive"),
  version: z.string().trim().min(1).max(128),
  gitCommit: z.string().regex(/^[a-f0-9]{40}$/u),
  release: z.literal(true),
  clean: z.literal(true),
  node: z.literal(">=22"),
  entrypoint: z.string().trim().min(1).max(255),
  playwrightVersion: z.string().trim().min(1).max(128),
  files: z.array(ReleaseFileSchema).min(1).max(MAX_RELEASE_FILES)
}).strict().superRefine((manifest, context) => {
  const seen = new Set<string>();
  let total = 0;
  for (const [index, file] of manifest.files.entries()) {
    if (!isSafeReleasePath(file.path)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["files", index, "path"], message: "Release inventory path is unsafe." });
    }
    if (seen.has(file.path)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["files", index, "path"], message: "Release inventory paths must be unique." });
    }
    seen.add(file.path);
    total += file.size;
  }
  if (total > MAX_RELEASE_TOTAL_BYTES) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["files"], message: "Release inventory exceeds its aggregate size limit." });
  }
  if (!isSafeReleasePath(manifest.entrypoint) || manifest.entrypoint.includes("/")) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["entrypoint"], message: "Release entrypoint must be one safe file name." });
  }
});

export interface VerifiedVisualHiveProducerIdentity {
  readonly identityKind: "verified_release_manifest";
  readonly visualHiveVersion: string;
  readonly visualHiveCommit: string;
  readonly manifestSha256: string;
  readonly entrypointSha256: string;
}

export interface VisualHiveProducerIdentityPin {
  readonly visualHiveVersion?: string;
  readonly visualHiveCommit?: string;
  readonly visualHiveManifestSha256?: string;
  readonly visualHiveEntrypointSha256?: string;
}

export interface VerifyVisualHiveProducerIdentityOptions {
  entrypointPath: string;
  manifestPath: string;
  expectedVersion: string;
}

let cachedIdentity: Promise<Readonly<VerifiedVisualHiveProducerIdentity>> | undefined;

/** Resolve identity only from the immutable release artifact beside this executing bundle. */
export function resolveVerifiedVisualHiveProducerIdentity(): Promise<Readonly<VerifiedVisualHiveProducerIdentity>> {
  cachedIdentity ??= verifyVisualHiveProducerIdentity({
    entrypointPath: fileURLToPath(import.meta.url),
    manifestPath: path.join(path.dirname(fileURLToPath(import.meta.url)), "release-manifest.json"),
    expectedVersion: visualHiveVersion
  });
  return cachedIdentity;
}

export function assertVerifiedVisualHiveProducerIdentityMatchesPin(
  producer: Readonly<VerifiedVisualHiveProducerIdentity>,
  pin: Readonly<VisualHiveProducerIdentityPin>
): void {
  if (producer.identityKind !== "verified_release_manifest") {
    throw new Error("Visual Hive producer identity is not backed by a verified release manifest.");
  }
  if (!pin.visualHiveVersion || !pin.visualHiveCommit || !pin.visualHiveManifestSha256 || !pin.visualHiveEntrypointSha256) {
    throw new Error("Hive repair session does not pin the complete Visual Hive producer identity.");
  }
  if (
    producer.visualHiveVersion !== pin.visualHiveVersion ||
    producer.visualHiveCommit !== pin.visualHiveCommit ||
    producer.manifestSha256 !== pin.visualHiveManifestSha256 ||
    producer.entrypointSha256 !== pin.visualHiveEntrypointSha256
  ) {
    throw new Error("Verified Visual Hive producer identity does not match the Hive repair session capability pin.");
  }
}

/** Exported for bounded fixture verification; production callers use the resolver above. */
export async function verifyVisualHiveProducerIdentity(
  options: VerifyVisualHiveProducerIdentityOptions
): Promise<Readonly<VerifiedVisualHiveProducerIdentity>> {
  const entrypointPath = path.resolve(options.entrypointPath);
  const manifestPath = path.resolve(options.manifestPath);
  const entrypointRoot = await canonicalExistingDirectoryRoot(path.dirname(entrypointPath), "Visual Hive release entrypoint directory");
  const manifestRoot = await canonicalExistingDirectoryRoot(path.dirname(manifestPath), "Visual Hive release manifest directory");
  if (filesystemIdentity(entrypointRoot) !== filesystemIdentity(manifestRoot)) {
    throw new Error("Visual Hive release manifest must be beside the executing entrypoint.");
  }
  if (filesystemIdentity(entrypointPath) !== filesystemIdentity(path.join(entrypointRoot, path.basename(entrypointPath)))) {
    throw new Error("Visual Hive release entrypoint must use its canonical directory.");
  }
  if (filesystemIdentity(manifestPath) !== filesystemIdentity(path.join(entrypointRoot, "release-manifest.json"))) {
    throw new Error("Visual Hive release manifest must use its canonical file name.");
  }

  const manifestBytes = await readBoundedOrdinaryFile(manifestPath, MAX_RELEASE_MANIFEST_BYTES, "Visual Hive release manifest");
  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes));
  } catch (error) {
    throw new Error(`Visual Hive release manifest is not valid UTF-8 JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const manifest = ReleaseManifestSchema.parse(rawManifest);
  if (manifest.version !== options.expectedVersion) {
    throw new Error(`Visual Hive release version ${manifest.version} does not match the executing CLI version ${options.expectedVersion}.`);
  }
  if (manifest.entrypoint !== path.basename(entrypointPath)) {
    throw new Error("Visual Hive release manifest names a different executing entrypoint.");
  }
  const entrypointEntries = manifest.files.filter((file) => file.path === manifest.entrypoint);
  if (entrypointEntries.length !== 1) {
    throw new Error("Visual Hive release manifest must inventory the executing entrypoint exactly once.");
  }
  const entrypointBytes = await readBoundedOrdinaryFile(entrypointPath, MAX_RELEASE_ENTRYPOINT_BYTES, "Visual Hive release entrypoint");
  const entrypoint = entrypointEntries[0]!;
  const entrypointSha256 = sha256Bytes(entrypointBytes);
  if (entrypoint.size !== entrypointBytes.byteLength || entrypoint.sha256 !== entrypointSha256) {
    throw new Error("Visual Hive executing entrypoint does not match its immutable release inventory.");
  }
  return Object.freeze({
    identityKind: "verified_release_manifest" as const,
    visualHiveVersion: manifest.version,
    visualHiveCommit: manifest.gitCommit,
    manifestSha256: sha256Bytes(manifestBytes),
    entrypointSha256
  });
}

function isSafeReleasePath(value: string): boolean {
  return value !== "." && !value.startsWith("/") && !value.includes("\\") && path.posix.normalize(value) === value && !value.startsWith("../");
}

function filesystemIdentity(value: string): string {
  const normalized = path.normalize(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
