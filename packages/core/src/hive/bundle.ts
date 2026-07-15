import { createHash, randomUUID } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ArtifactIndexEntry, ArtifactIndexReport } from "../artifacts/index.js";
import type { CapabilityParityReport } from "../capabilities/types.js";
import type { VisualHiveIssueCandidate, VisualHiveIssueKind, VisualHiveIssueSeverity, VisualHivePublicationRole } from "../issues/types.js";

export const VISUAL_HIVE_BUNDLE_DIGEST_ALGORITHM = "visual-hive.bundle.publication-digest.v1" as const;
export const VISUAL_HIVE_BUNDLE_V3_DIGEST_ALGORITHM = "visual-hive.bundle.content-addressed-digest.v1" as const;

const DEFAULT_ARTIFACT_INDEX_PATH = ".visual-hive/artifacts-index.json";
const DEFAULT_CAPABILITY_PARITY_PATH = ".visual-hive/capability-parity.json";
const ARTIFACT_INDEX_SEAL_LOCK_PATH = ".visual-hive-artifacts-index.lock";
const CAPABILITY_PARITY_DOMAINS = [
  "cli",
  "schemas",
  "evidenceResources",
  "artifactSurfaces",
  "planModes",
  "workflowLanes",
  "mutationOperators",
  "deterministicPrimitives",
  "providers",
  "openSourceAdapters",
  "controlPlane"
] as const;

export interface VisualHiveBundleSource {
  repository: string;
  repositoryId?: string;
  ref: string;
  commitSha: string;
  event: string;
  workflowName?: string;
  workflowRunId?: string;
  workflowRunAttempt?: string;
  workflowArtifactId?: string;
  conclusion: string;
  /** Producer claim only. Hive must independently verify GitHub provenance. */
  trusted: boolean;
}

export type VisualHiveBundleScanScope = "full" | "partial" | "changed-files" | "targeted";

export interface VisualHiveBundleScan {
  scope: VisualHiveBundleScanScope;
  authoritativeForResolution: boolean;
  evaluatedContracts: string[];
  evaluatedFiles: string[];
  testPlanVersion: string;
  toolRegistryVersion: string;
}

export interface VisualHiveBundleObservation {
  fingerprint: string;
  repositoryFingerprint: string;
  publicationRole: VisualHivePublicationRole;
  rootCauseKey: string;
  blockedByRootKeys: string[];
  state: "present" | "absent";
  issueKind: VisualHiveIssueKind;
  severity: VisualHiveIssueSeverity;
  owningAgentHint: string;
  title: string;
  body: string;
  labels: string[];
  sourceArtifacts: string[];
  affectedContracts: string[];
  validationCommand: string;
  observedAt: string;
  firstSeenAt: string;
  sourceArtifact: string;
}

export interface VisualHiveBundleFile {
  path: string;
  sourcePath: string;
  sha256: string;
  size: number;
  mediaType: "application/json" | "text/markdown" | "text/plain" | "application/octet-stream";
  schemaVersion?: string;
}

export interface VisualHiveBundleArtifactIndexBinding {
  path: string;
  sourcePath: string;
  sha256: string;
  schemaVersion: 1;
  contentAddressed: true;
  complete: true;
  artifactCount: number;
  totalBytes: number;
}

export interface VisualHiveBundleCapabilityParityBinding {
  path: string;
  sourcePath: string;
  sha256: string;
  schemaVersion: "visual-hive.capability-parity.v1";
  baselineVersion: "visual-hive.capability-baseline.v1";
  status: "passed";
  runtimeStatus: "ready" | "blocked";
  summary: CapabilityParityReport["summary"];
}

export interface VisualHiveBundleManifest {
  schemaVersion: "visual-hive.bundle.v2" | "visual-hive.bundle.v3";
  /** Absent only on legacy v2 manifests whose observations have no publication metadata. */
  digestAlgorithm?: typeof VISUAL_HIVE_BUNDLE_DIGEST_ALGORITHM | typeof VISUAL_HIVE_BUNDLE_V3_DIGEST_ALGORITHM;
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
  scan: VisualHiveBundleScan;
  observations: VisualHiveBundleObservation[];
  files: VisualHiveBundleFile[];
  artifactIndex?: VisualHiveBundleArtifactIndexBinding;
  capabilityParity?: VisualHiveBundleCapabilityParityBinding;
  overallDigest: string;
  replayProtection: {
    nonce: string;
    key: string;
  };
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
    producerTrustClaimIsAdvisory: true;
    absenceRequiresAuthoritativeScan: true;
  };
}

export interface WriteVisualHiveBundleOptions {
  rootDir: string;
  project: string;
  mode: string;
  verdict: string;
  acmmRequest: number;
  artifacts: string[];
  artifactIndex?: string;
  capabilityParity?: string;
  source: VisualHiveBundleSource;
  scan?: Partial<VisualHiveBundleScan>;
  observations?: VisualHiveBundleObservation[];
  issues?: VisualHiveIssueCandidate[];
  issuesArtifact?: string;
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
  const rootDir = await canonicalRepositoryRoot(options.rootDir);
  const bundlesRoot = resolveInsideRoot(rootDir, options.outputDir ?? path.join(".visual-hive", "bundles"));
  const bundleId = safeBundleId(options.bundleId ?? randomUUID());
  const finalDir = path.join(bundlesRoot, bundleId);
  const temporaryDir = path.join(bundlesRoot, `.tmp-${bundleId}-${randomUUID()}`);
  const generatedAt = (options.now ?? new Date()).toISOString();
  const expiresAt = new Date(Date.parse(generatedAt) + (options.expiresInHours ?? 168) * 60 * 60 * 1000).toISOString();
  if (!isValidV3TimestampWindow(generatedAt, expiresAt)) {
    throw new Error("Visual Hive bundle expiry must be a canonical UTC-millisecond timestamp after generation.");
  }
  const source = sanitizeSource(options.source);
  const bundleVersion = selectBundleVersion(source);
  const requestedArtifacts = uniqueSorted(options.artifacts);
  const artifactIndexPath = bundleVersion === "v3"
    ? normalizeRelativeArtifactPath(options.artifactIndex ?? DEFAULT_ARTIFACT_INDEX_PATH)
    : undefined;
  const capabilityParityPath = bundleVersion === "v3"
    ? normalizeRelativeArtifactPath(options.capabilityParity ?? DEFAULT_CAPABILITY_PARITY_PATH)
    : undefined;
  const bundleEvidence = bundleVersion === "v3"
    ? await validateBundleEvidence({
        rootDir,
        project: options.project,
        artifactIndexPath: artifactIndexPath!,
        capabilityParityPath: capabilityParityPath!,
        requestedArtifacts
      })
    : undefined;
  const artifacts = bundleVersion === "v3"
    ? uniqueSorted([...requestedArtifacts, artifactIndexPath!, capabilityParityPath!])
    : requestedArtifacts;

  await ensureSecureDirectory(rootDir, bundlesRoot);
  await mkdir(temporaryDir);
  let temporaryDirectoryIdentity: StableDirectoryIdentity | undefined;
  try {
    temporaryDirectoryIdentity = await captureStableDirectoryIdentity(rootDir, temporaryDir);
    const files: VisualHiveBundleFile[] = [];
    const expectedArtifacts: Array<{ path: string; data: Buffer }> = [];
    for (const artifact of artifacts) {
      const sourcePath = normalizeRelativeArtifactPath(artifact);
      const data = bundleEvidence?.artifactData.get(sourcePath)
        ?? await readStableRegularFile(rootDir, sourcePath, "artifact");
      const bundledPath = normalizeRelativeArtifactPath(path.join("files", sourcePath));
      const destination = path.join(temporaryDir, ...bundledPath.split("/"));
      await ensureSecureDirectory(rootDir, path.dirname(destination));
      await writeFile(destination, data, { flag: "wx" });
      await assertExactFileReadback(
        rootDir,
        normalizeRelativeArtifactPath(path.relative(rootDir, destination)),
        data,
        `written artifact ${sourcePath}`
      );
      expectedArtifacts.push({ path: bundledPath, data });
      if (bundleEvidence) {
        const expected = sourcePath === artifactIndexPath
          ? { sha256: bundleEvidence.artifactIndexSha256, bytes: bundleEvidence.artifactIndexBytes }
          : bundleEvidence.indexedArtifacts.get(sourcePath);
        if (!expected || expected.sha256 !== sha256(data) || expected.bytes !== data.byteLength) {
          throw new Error(`Visual Hive bundle artifact changed after content-addressed index validation: ${sourcePath}`);
        }
      }
      files.push({
        path: bundledPath,
        sourcePath,
        sha256: sha256(data),
        size: data.byteLength,
        mediaType: mediaTypeFor(sourcePath),
        schemaVersion: schemaVersionFor(sourcePath, data)
      });
    }

    const scan = sanitizeScan(options.scan);
    const observations = sanitizeObservations(
      options.observations ?? observationsFromIssues(options.issues ?? [], source.repository, generatedAt, options.issuesArtifact),
      source.repository
    );
    if (!scan.authoritativeForResolution && observations.some((observation) => observation.state === "absent")) {
      throw new Error("Absent lifecycle observations require an authoritative Visual Hive scan.");
    }
    const replayProtection = {
      nonce: bundleId,
      key: bundleVersion === "v3"
        ? v3ReplayKey(source, bundleId)
        : v2ReplayKey(source, bundleId)
    };
    const acmmRequest = sanitizeACMMRequest(options.acmmRequest);
    const metadata = {
      generatedAt,
      expiresAt,
      project: options.project,
      mode: options.mode,
      verdict: options.verdict,
      acmmRequest,
      externalCallsMade: options.externalCallsMade ?? 0,
      producerName: "visual-hive" as const,
      producerVersion: options.producerVersion,
      producerGitCommit: options.producerGitCommit
    };
    const artifactIndex = bundleEvidence
      ? bindArtifactIndex(files, artifactIndexPath!, bundleEvidence.artifactIndex, bundleEvidence.artifactIndexSha256)
      : undefined;
    const capabilityParity = bundleEvidence
      ? bindCapabilityParity(files, capabilityParityPath!, bundleEvidence.capabilityParity, bundleEvidence.capabilityParitySha256)
      : undefined;
    const digestAlgorithm = bundleVersion === "v3"
      ? VISUAL_HIVE_BUNDLE_V3_DIGEST_ALGORITHM
      : VISUAL_HIVE_BUNDLE_DIGEST_ALGORITHM;
    const overallDigest = bundleVersion === "v3"
      ? digestV3BundleContent(files, scan, observations, source, replayProtection.key, metadata, artifactIndex!, capabilityParity!)
      : digestPublicationBundleContent(files, scan, observations, source, replayProtection.key, metadata);
    const manifest: VisualHiveBundleManifest = {
      schemaVersion: bundleVersion === "v3" ? "visual-hive.bundle.v3" : "visual-hive.bundle.v2",
      digestAlgorithm,
      bundleId,
      generatedAt,
      expiresAt,
      producer: { name: metadata.producerName, version: metadata.producerVersion, gitCommit: metadata.producerGitCommit },
      source,
      project: options.project,
      mode: options.mode,
      verdict: options.verdict,
      acmmRequest: metadata.acmmRequest,
      externalCallsMade: metadata.externalCallsMade,
      scan,
      observations,
      files,
      ...(artifactIndex ? { artifactIndex } : {}),
      ...(capabilityParity ? { capabilityParity } : {}),
      overallDigest,
      replayProtection,
      provenance: {
        kind: process.env.GITHUB_ACTIONS === "true" ? "github-actions" : "local",
        subjectDigest: overallDigest,
        attestationRequired: process.env.GITHUB_ACTIONS === "true"
      },
      safety: {
        atomicWrite: true,
        pathsAreRelative: true,
        digestsRequired: true,
        producerCountersAreAdvisory: true,
        producerTrustClaimIsAdvisory: true,
        absenceRequiresAuthoritativeScan: true
      }
    };
    const manifestData = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    const temporaryManifest = path.join(temporaryDir, "manifest.json");
    await writeFile(temporaryManifest, manifestData, { flag: "wx" });
    await assertExactFileReadback(
      rootDir,
      normalizeRelativeArtifactPath(path.relative(rootDir, temporaryManifest)),
      manifestData,
      "written manifest"
    );
    await assertSecureDirectory(rootDir, bundlesRoot);
    await assertSecureDirectory(rootDir, temporaryDir);
    await assertStableDirectoryIdentity(rootDir, temporaryDir, temporaryDirectoryIdentity);
    await assertPathDoesNotExist(rootDir, finalDir);
    const bundlesRootIdentities = await captureStablePathIdentities(rootDir, bundlesRoot);
    if (bundleVersion === "v3") await assertArtifactIndexSealUnlocked(rootDir);
    await rename(temporaryDir, finalDir);
    await assertStablePathNodeIdentities(rootDir, bundlesRootIdentities);
    await assertStableDirectoryIdentity(rootDir, finalDir, temporaryDirectoryIdentity, true);
    if (bundleVersion === "v3") await assertArtifactIndexSealUnlocked(rootDir);
    await assertExactBundleReadback(rootDir, finalDir, [
      ...expectedArtifacts,
      { path: "manifest.json", data: manifestData }
    ]);
    return {
      manifest,
      manifestPath: normalizeRelativeArtifactPath(path.relative(rootDir, path.join(finalDir, "manifest.json"))),
      bundleDir: normalizeRelativeArtifactPath(path.relative(rootDir, finalDir))
    };
  } catch (error) {
    await removePrivateDirectory(rootDir, bundlesRoot, temporaryDir, temporaryDirectoryIdentity);
    await removePrivateDirectory(rootDir, bundlesRoot, finalDir, temporaryDirectoryIdentity);
    throw error;
  }
}

export function verifyVisualHiveBundleDigest(manifest: VisualHiveBundleManifest): boolean {
  if (manifest.schemaVersion === "visual-hive.bundle.v3") return verifyV3BundleDigest(manifest);
  if (manifest.schemaVersion !== "visual-hive.bundle.v2") return false;
  const publicationMode = publicationMetadataMode(manifest.observations);
  if (publicationMode === "invalid") return false;
  const digestAlgorithm = (manifest as VisualHiveBundleManifest & { digestAlgorithm?: unknown }).digestAlgorithm;
  if (digestAlgorithm !== undefined && digestAlgorithm !== VISUAL_HIVE_BUNDLE_DIGEST_ALGORITHM) return false;
  if (digestAlgorithm === undefined && publicationMode === "publication") return false;
  if (digestAlgorithm === VISUAL_HIVE_BUNDLE_DIGEST_ALGORITHM && publicationMode === "legacy") return false;
  const digest = digestAlgorithm === VISUAL_HIVE_BUNDLE_DIGEST_ALGORITHM
    ? digestPublicationBundleContent
    : digestLegacyBundleContent;
  return manifest.overallDigest === digest(
    manifest.files,
    manifest.scan,
    manifest.observations,
    manifest.source,
    manifest.replayProtection.key,
    {
      project: manifest.project,
      mode: manifest.mode,
      verdict: manifest.verdict,
      acmmRequest: manifest.acmmRequest,
      externalCallsMade: manifest.externalCallsMade,
      producerName: manifest.producer.name,
      producerVersion: manifest.producer.version,
      producerGitCommit: manifest.producer.gitCommit
    }
  );
}

function verifyV3BundleDigest(manifest: VisualHiveBundleManifest): boolean {
  if (manifest.digestAlgorithm !== VISUAL_HIVE_BUNDLE_V3_DIGEST_ALGORITHM) return false;
  if (publicationMetadataMode(manifest.observations) === "legacy" || publicationMetadataMode(manifest.observations) === "invalid") return false;
  if (!manifest.artifactIndex || !manifest.capabilityParity) return false;
  if (!isValidV3TimestampWindow(manifest.generatedAt, manifest.expiresAt)) return false;
  if (!hasV3SourceIdentity(manifest.source)) return false;
  if (manifest.replayProtection.nonce !== manifest.bundleId) return false;
  if (manifest.replayProtection.key !== v3ReplayKey(manifest.source, manifest.bundleId)) return false;
  if (!validArtifactIndexBinding(manifest.artifactIndex, manifest.files)) return false;
  if (!validCapabilityParityBinding(manifest.capabilityParity, manifest.files)) return false;
  const digest = digestV3BundleContent(
    manifest.files,
    manifest.scan,
    manifest.observations,
    manifest.source,
    manifest.replayProtection.key,
    {
      project: manifest.project,
      mode: manifest.mode,
      verdict: manifest.verdict,
      acmmRequest: manifest.acmmRequest,
      externalCallsMade: manifest.externalCallsMade,
      generatedAt: manifest.generatedAt,
      expiresAt: manifest.expiresAt,
      producerName: manifest.producer.name,
      producerVersion: manifest.producer.version,
      producerGitCommit: manifest.producer.gitCommit
    },
    manifest.artifactIndex,
    manifest.capabilityParity
  );
  return manifest.overallDigest === digest && manifest.provenance.subjectDigest === digest;
}

function publicationMetadataMode(observations: VisualHiveBundleObservation[]): "empty" | "legacy" | "publication" | "invalid" {
  let mode: "legacy" | "publication" | undefined;
  for (const observation of observations) {
    const compatible = observation as VisualHiveBundleObservation & {
      publicationRole?: unknown;
      rootCauseKey?: unknown;
      blockedByRootKeys?: unknown;
    };
    const count = [compatible.publicationRole, compatible.rootCauseKey, compatible.blockedByRootKeys]
      .filter((value) => value !== undefined).length;
    if (count !== 0 && count !== 3) return "invalid";
    const observationMode = count === 0 ? "legacy" : "publication";
    if (mode && mode !== observationMode) return "invalid";
    mode = observationMode;
  }
  return mode ?? "empty";
}

interface BundleDigestMetadata {
  project: string;
  mode: string;
  verdict: string;
  acmmRequest: number;
  externalCallsMade: number;
  producerName: string;
  producerVersion: string;
  producerGitCommit: string;
}

interface V3BundleDigestMetadata extends BundleDigestMetadata {
  generatedAt: string;
  expiresAt: string;
}

function isCanonicalV3Timestamp(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString() === value;
}

function isValidV3TimestampWindow(generatedAt: string, expiresAt: string): boolean {
  return isCanonicalV3Timestamp(generatedAt)
    && isCanonicalV3Timestamp(expiresAt)
    && Date.parse(expiresAt) > Date.parse(generatedAt);
}

function resolveInsideRoot(rootDir: string, candidate: string): string {
  const resolved = path.resolve(rootDir, candidate);
  const relative = path.relative(rootDir, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Artifact path escapes repository root: ${candidate}`);
  return resolved;
}

async function canonicalRepositoryRoot(candidate: string): Promise<string> {
  const absolute = path.resolve(candidate);
  const sourceStat = await lstat(absolute, { bigint: true });
  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) {
    throw new Error(`Visual Hive bundle repository root is not a regular directory: ${absolute}`);
  }
  requireStableNodeIdentity(sourceStat, absolute);
  const canonical = await realpath(absolute);
  const canonicalStat = await lstat(canonical, { bigint: true });
  if (!canonicalStat.isDirectory() || canonicalStat.isSymbolicLink()) {
    throw new Error(`Visual Hive bundle repository root is not a regular directory: ${absolute}`);
  }
  const afterCanonicalization = await lstat(absolute, { bigint: true });
  if (!sameDirectorySnapshot(sourceStat, canonicalStat) || !sameDirectorySnapshot(sourceStat, afterCanonicalization)) {
    throw new Error(`Visual Hive bundle repository root changed during canonicalization: ${absolute}`);
  }
  return canonical;
}

interface StableDirectoryIdentity {
  absolutePath: string;
  canonicalPath: string;
  stat: BigIntStats;
}

async function captureStableDirectoryIdentity(rootDir: string, target: string): Promise<StableDirectoryIdentity> {
  const absolutePath = resolveInsideRoot(rootDir, target);
  const before = await lstat(absolutePath, { bigint: true });
  if (before.isSymbolicLink()) {
    throw new Error(`Visual Hive bundle path contains a symbolic link or reparse point: ${normalizeDisplayPath(rootDir, absolutePath)}`);
  }
  if (!before.isDirectory()) {
    throw new Error(`Visual Hive bundle path is not a regular directory: ${normalizeDisplayPath(rootDir, absolutePath)}`);
  }
  requireStableNodeIdentity(before, absolutePath);
  const canonicalPath = await realpath(absolutePath);
  if (!isInsideOrEqualPath(rootDir, canonicalPath)) {
    throw new Error(`Visual Hive bundle path resolves outside the repository root: ${normalizeDisplayPath(rootDir, absolutePath)}`);
  }
  const after = await lstat(absolutePath, { bigint: true });
  if (!after.isDirectory() || after.isSymbolicLink() || !sameDirectorySnapshot(before, after)) {
    throw new Error(`Visual Hive bundle directory identity changed during traversal: ${normalizeDisplayPath(rootDir, absolutePath)}`);
  }
  return { absolutePath, canonicalPath, stat: after };
}

async function captureStablePathIdentities(rootDir: string, targetDirectory: string): Promise<StableDirectoryIdentity[]> {
  const resolved = resolveInsideRoot(rootDir, targetDirectory);
  const relative = path.relative(rootDir, resolved);
  const identities: StableDirectoryIdentity[] = [];
  let current = rootDir;
  identities.push(await captureStableDirectoryIdentity(rootDir, current));
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    identities.push(await captureStableDirectoryIdentity(rootDir, current));
  }
  await assertStablePathIdentities(rootDir, identities);
  return identities;
}

async function assertStablePathIdentities(rootDir: string, identities: StableDirectoryIdentity[]): Promise<void> {
  for (const expected of identities) {
    await assertStableDirectoryIdentity(rootDir, expected.absolutePath, expected, false, true);
  }
}

async function assertStablePathNodeIdentities(rootDir: string, identities: StableDirectoryIdentity[]): Promise<void> {
  for (const expected of identities) {
    await assertStableDirectoryIdentity(rootDir, expected.absolutePath, expected);
  }
}

async function assertStableDirectoryIdentity(
  rootDir: string,
  target: string,
  expected: StableDirectoryIdentity,
  allowCanonicalPathChange = false,
  requireUnchangedSnapshot = false
): Promise<void> {
  const actual = await captureStableDirectoryIdentity(rootDir, target);
  const identityMatches = requireUnchangedSnapshot
    ? sameDirectorySnapshot(expected.stat, actual.stat)
    : sameDirectoryIdentity(expected.stat, actual.stat);
  if (!identityMatches
    || (!allowCanonicalPathChange && expected.canonicalPath !== actual.canonicalPath)) {
    throw new Error(`Visual Hive bundle directory identity changed during traversal: ${normalizeDisplayPath(rootDir, actual.absolutePath)}`);
  }
}

async function assertSecureDirectory(rootDir: string, target: string): Promise<void> {
  const resolved = resolveInsideRoot(rootDir, target);
  await captureStablePathIdentities(rootDir, resolved);
}

async function ensureSecureDirectory(rootDir: string, target: string): Promise<void> {
  const resolved = resolveInsideRoot(rootDir, target);
  const relative = path.relative(rootDir, resolved);
  let current = rootDir;
  const identities = [await captureStableDirectoryIdentity(rootDir, current)];
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    await assertStablePathNodeIdentities(rootDir, identities);
    current = path.join(current, segment);
    try {
      await mkdir(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const currentStat = await lstat(current);
    if (!currentStat.isDirectory() || currentStat.isSymbolicLink()) {
      throw new Error(`Visual Hive bundle output path contains a non-directory or symbolic link: ${normalizeDisplayPath(rootDir, current)}`);
    }
    const canonical = await realpath(current);
    if (!isInsideOrEqualPath(rootDir, canonical)) {
      throw new Error(`Visual Hive bundle output path resolves outside the repository root: ${normalizeDisplayPath(rootDir, current)}`);
    }
    identities.push(await captureStableDirectoryIdentity(rootDir, current));
  }
  await assertStablePathNodeIdentities(rootDir, identities);
}

async function assertPathDoesNotExist(rootDir: string, target: string): Promise<void> {
  const resolved = resolveInsideRoot(rootDir, target);
  const parentIdentities = await captureStablePathIdentities(rootDir, path.dirname(resolved));
  try {
    await lstat(resolved);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      await assertStablePathIdentities(rootDir, parentIdentities);
      return;
    }
    throw error;
  }
  await assertStablePathIdentities(rootDir, parentIdentities);
  throw new Error(`Visual Hive bundle destination already exists: ${normalizeDisplayPath(rootDir, resolved)}`);
}

async function assertArtifactIndexSealUnlocked(rootDir: string): Promise<void> {
  const rootIdentities = await captureStablePathIdentities(rootDir, rootDir);
  const lockPath = path.join(rootDir, ARTIFACT_INDEX_SEAL_LOCK_PATH);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await lstat(lockPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await assertStablePathIdentities(rootDir, rootIdentities);
      continue;
    }
    throw new Error(`Visual Hive bundle publication refuses an artifact index seal lock: ${ARTIFACT_INDEX_SEAL_LOCK_PATH}`);
  }
}

async function removePrivateDirectory(
  rootDir: string,
  bundlesRoot: string,
  privateDir: string,
  expectedIdentity?: StableDirectoryIdentity
): Promise<void> {
  try {
    if (!expectedIdentity) return;
    await assertSecureDirectory(rootDir, bundlesRoot);
    const actualIdentity = await captureStableDirectoryIdentity(rootDir, privateDir);
    if (!sameDirectoryIdentity(expectedIdentity.stat, actualIdentity.stat)) return;
    await rm(privateDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      // Preserve the publication error and leave an untrusted path untouched for inspection.
    }
  }
}

async function readStableRegularFile(rootDir: string, relativePath: string, label: string): Promise<Buffer> {
  const normalized = normalizeRelativeArtifactPath(relativePath);
  const absolute = resolveInsideRoot(rootDir, normalized);
  const parentIdentities = await captureStablePathIdentities(rootDir, path.dirname(absolute));
  const before = await lstat(absolute, { bigint: true });
  if (before.isSymbolicLink()) {
    throw new Error(`Visual Hive bundle path contains a symbolic link or reparse point: ${normalized}`);
  }
  if (!before.isFile()) {
    throw new Error(`Visual Hive bundle ${label} is not a regular file: ${normalized}`);
  }
  requireStableNodeIdentity(before, absolute);
  const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
  const handle = await open(absolute, constants.O_RDONLY | noFollow);
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || !sameFileIdentity(before, opened)) {
      throw new Error(`Visual Hive bundle ${label} changed while it was opened: ${normalized}`);
    }
    const data = await handle.readFile();
    const afterRead = await handle.stat({ bigint: true });
    if (!sameFileIdentity(opened, afterRead) || BigInt(data.byteLength) !== afterRead.size) {
      throw new Error(`Visual Hive bundle ${label} changed while it was read: ${normalized}`);
    }
    const afterPath = await lstat(absolute, { bigint: true });
    if (!sameFileIdentity(afterRead, afterPath)) {
      throw new Error(`Visual Hive bundle ${label} path changed while it was read: ${normalized}`);
    }
    await assertStablePathIdentities(rootDir, parentIdentities);
    return data;
  } finally {
    await handle.close();
  }
}

function requireStableNodeIdentity(stat: BigIntStats, target: string): void {
  if (stat.ino === 0n) {
    throw new Error(`Visual Hive bundle cannot establish a stable filesystem identity for: ${target}`);
  }
}

function sameNodeIdentity(left: BigIntStats, right: BigIntStats): boolean {
  const deviceMatches = left.dev === right.dev || left.dev === 0n || right.dev === 0n;
  return left.ino !== 0n && right.ino !== 0n && deviceMatches && left.ino === right.ino;
}

function sameDirectoryIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return sameNodeIdentity(left, right) && left.isDirectory() && right.isDirectory();
}

function sameDirectorySnapshot(left: BigIntStats, right: BigIntStats): boolean {
  return sameDirectoryIdentity(left, right)
    && left.mode === right.mode
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function sameFileIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return sameNodeIdentity(left, right)
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

async function assertExactFileReadback(rootDir: string, relativePath: string, expected: Buffer, label: string): Promise<void> {
  const actual = await readStableRegularFile(rootDir, relativePath, label);
  if (!actual.equals(expected)) {
    throw new Error(`Visual Hive bundle ${label} failed exact readback: ${relativePath}`);
  }
}

async function assertExactBundleReadback(
  rootDir: string,
  bundleDir: string,
  expectedFiles: Array<{ path: string; data: Buffer }>
): Promise<void> {
  const directoryIdentities = new Map<string, StableDirectoryIdentity>();
  for (const expected of expectedFiles) {
    const target = resolveInsideRoot(bundleDir, expected.path);
    const identities = await captureStablePathIdentities(rootDir, path.dirname(target));
    for (const identity of identities) {
      const existing = directoryIdentities.get(identity.absolutePath);
      if (existing && !sameDirectorySnapshot(existing.stat, identity.stat)) {
        throw new Error(`Visual Hive bundle directory identity changed during readback: ${normalizeDisplayPath(rootDir, identity.absolutePath)}`);
      }
      directoryIdentities.set(identity.absolutePath, identity);
    }
  }
  const stableDirectories = [...directoryIdentities.values()];
  await assertStablePathIdentities(rootDir, stableDirectories);
  for (const expected of [...expectedFiles].sort((left, right) => stableCompare(left.path, right.path))) {
    const relativePath = normalizeRelativeArtifactPath(path.relative(rootDir, resolveInsideRoot(bundleDir, expected.path)));
    await assertExactFileReadback(rootDir, relativePath, expected.data, `published file ${expected.path}`);
  }
  await assertStablePathIdentities(rootDir, stableDirectories);
}

async function requireExactArtifactSet(
  rootDir: string,
  indexedRoot: string,
  artifactIndexPath: string,
  indexedArtifacts: Map<string, ArtifactIndexEntry>
): Promise<void> {
  const actual = await enumerateArtifactFiles(rootDir, indexedRoot);
  actual.delete(artifactIndexPath);
  for (const artifactPath of actual) {
    if (!indexedArtifacts.has(artifactPath)) {
      throw new Error(`Complete content-addressed artifact index omits on-disk artifact: ${artifactPath}`);
    }
  }
  for (const artifactPath of indexedArtifacts.keys()) {
    if (!actual.has(artifactPath)) {
      throw new Error(`Complete content-addressed artifact index names a missing artifact: ${artifactPath}`);
    }
  }
}

async function enumerateArtifactFiles(rootDir: string, indexedRoot: string): Promise<Set<string>> {
  const absoluteRoot = resolveInsideRoot(rootDir, indexedRoot);
  await assertSecureDirectory(rootDir, absoluteRoot);
  const files = new Set<string>();
  const walk = async (directory: string): Promise<void> => {
    const directoryIdentities = await captureStablePathIdentities(rootDir, directory);
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => stableCompare(left.name, right.name));
    for (const entry of entries) {
      const child = path.join(directory, entry.name);
      const childStat = await lstat(child);
      const relative = normalizeRelativeArtifactPath(path.relative(rootDir, child));
      if (childStat.isSymbolicLink()) {
        throw new Error(`Complete content-addressed artifact index refuses symbolic link or reparse point: ${relative}`);
      }
      if (childStat.isDirectory()) {
        if (!isBundlePayloadDirectory(rootDir, child)) await walk(child);
        continue;
      }
      if (!childStat.isFile()) {
        throw new Error(`Complete content-addressed artifact index refuses non-regular entry: ${relative}`);
      }
      files.add(relative);
    }
    await assertStablePathIdentities(rootDir, directoryIdentities);
  };
  await walk(absoluteRoot);
  return files;
}

function isBundlePayloadDirectory(rootDir: string, directory: string): boolean {
  const relative = path.relative(rootDir, directory).replaceAll("\\", "/");
  return /^\.visual-hive\/bundles\/[^/]+\/files$/.test(relative);
}

function parseJsonBuffer(data: Buffer, label: string): unknown {
  try {
    return JSON.parse(data.toString("utf8")) as unknown;
  } catch {
    throw new Error(`Visual Hive bundle ${label} is not valid JSON.`);
  }
}

function isInsideOrEqualPath(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function normalizeDisplayPath(rootDir: string, target: string): string {
  return path.relative(rootDir, target).replaceAll("\\", "/") || ".";
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
  return [...new Set(values.map(normalizeRelativeArtifactPath))].sort(stableCompare);
}

interface ValidatedBundleEvidence {
  artifactIndex: ArtifactIndexReport;
  artifactIndexSha256: string;
  artifactIndexBytes: number;
  capabilityParity: CapabilityParityReport;
  capabilityParitySha256: string;
  indexedArtifacts: Map<string, ArtifactIndexEntry>;
  artifactData: Map<string, Buffer>;
}

async function validateBundleEvidence(input: {
  rootDir: string;
  project: string;
  artifactIndexPath: string;
  capabilityParityPath: string;
  requestedArtifacts: string[];
}): Promise<ValidatedBundleEvidence> {
  await assertArtifactIndexSealUnlocked(input.rootDir);
  if (input.artifactIndexPath === input.capabilityParityPath) {
    throw new Error("Visual Hive bundle artifact index and capability parity receipt must be different files.");
  }
  const artifactIndexFile = await readRegularJsonFile(input.rootDir, input.artifactIndexPath, "artifact index");
  const artifactIndex = validateArtifactIndexReport(artifactIndexFile.value, input.project, input.artifactIndexPath);
  const indexedArtifacts = new Map<string, ArtifactIndexEntry>();
  const artifactData = new Map<string, Buffer>([[input.artifactIndexPath, artifactIndexFile.data]]);
  const normalizedRoot = normalizeRelativeArtifactPath(artifactIndex.root);
  if (input.artifactIndexPath !== normalizedRoot && !input.artifactIndexPath.startsWith(`${normalizedRoot}/`)) {
    throw new Error(`Visual Hive artifact index must be stored inside its indexed root ${normalizedRoot}.`);
  }

  for (const entry of artifactIndex.artifacts) {
    const artifactPath = normalizeRelativeArtifactPath(entry.path);
    if (artifactPath !== normalizedRoot && !artifactPath.startsWith(`${normalizedRoot}/`)) {
      throw new Error(`Content-addressed artifact is outside the indexed root ${normalizedRoot}: ${artifactPath}`);
    }
    if (artifactPath === input.artifactIndexPath) {
      throw new Error("A content-addressed artifact index must exclude itself to avoid a recursive digest.");
    }
    if (indexedArtifacts.has(artifactPath)) throw new Error(`Duplicate content-addressed artifact path: ${artifactPath}`);
    indexedArtifacts.set(artifactPath, entry);

    const data = await readStableRegularFile(input.rootDir, artifactPath, "content-addressed artifact");
    if (data.byteLength !== entry.bytes || sha256(data) !== entry.sha256) {
      throw new Error(`Content-addressed artifact index is stale for ${artifactPath}.`);
    }
    artifactData.set(artifactPath, data);
  }

  await requireExactArtifactSet(input.rootDir, normalizedRoot, input.artifactIndexPath, indexedArtifacts);

  const capabilityData = artifactData.get(input.capabilityParityPath);
  if (!capabilityData) {
    throw new Error(`Capability parity receipt is missing from the complete artifact index: ${input.capabilityParityPath}`);
  }
  const capabilityParity = validateCapabilityParityReport(parseJsonBuffer(capabilityData, "capability parity receipt"));

  const capabilityEntry = indexedArtifacts.get(input.capabilityParityPath);
  if (!capabilityEntry || capabilityEntry.bytes !== capabilityData.byteLength || capabilityEntry.sha256 !== sha256(capabilityData)) {
    throw new Error("Capability parity receipt does not match its content-addressed artifact index entry.");
  }
  for (const artifactPath of input.requestedArtifacts) {
    if (artifactPath === input.artifactIndexPath) continue;
    if (!indexedArtifacts.has(artifactPath)) {
      throw new Error(`Compact bundle artifact is missing from the complete content-addressed index: ${artifactPath}`);
    }
  }

  return {
    artifactIndex,
    artifactIndexSha256: sha256(artifactIndexFile.data),
    artifactIndexBytes: artifactIndexFile.data.byteLength,
    capabilityParity,
    capabilityParitySha256: sha256(capabilityData),
    indexedArtifacts,
    artifactData
  };
}

async function readRegularJsonFile(rootDir: string, relativePath: string, label: string): Promise<{ data: Buffer; value: unknown }> {
  const data = await readStableRegularFile(rootDir, relativePath, label);
  return { data, value: parseJsonBuffer(data, `${label}: ${relativePath}`) };
}

function validateArtifactIndexReport(value: unknown, project: string, sourcePath: string): ArtifactIndexReport {
  if (!isRecord(value)) throw new Error(`Visual Hive artifact index must be a JSON object: ${sourcePath}`);
  if (value.schemaVersion !== 1 || value.contentAddressed !== true || value.complete !== true) {
    throw new Error("Visual Hive bundle v3 requires a complete content-addressed artifact index with schemaVersion=1.");
  }
  if (value.project !== project) throw new Error(`Visual Hive artifact index project does not match bundle project ${project}.`);
  if (typeof value.root !== "string" || !value.root.trim()) throw new Error("Visual Hive artifact index requires a repository-relative root.");
  if (!Array.isArray(value.artifacts) || !Array.isArray(value.warnings) || value.warnings.some((warning) => typeof warning !== "string")) {
    throw new Error("Visual Hive artifact index artifacts and warnings must be arrays.");
  }
  if (!isRecord(value.summary)) throw new Error("Visual Hive artifact index requires a summary object.");
  const summary = value.summary;
  const artifactCount = nonNegativeInteger(summary.artifactCount, "artifactIndex.summary.artifactCount");
  const discoveredArtifactCount = nonNegativeInteger(summary.discoveredArtifactCount, "artifactIndex.summary.discoveredArtifactCount");
  const omittedArtifactCount = nonNegativeInteger(summary.omittedArtifactCount, "artifactIndex.summary.omittedArtifactCount");
  const totalBytes = nonNegativeInteger(summary.totalBytes, "artifactIndex.summary.totalBytes");
  if (artifactCount !== value.artifacts.length || discoveredArtifactCount !== artifactCount || omittedArtifactCount !== 0) {
    throw new Error("Visual Hive bundle v3 requires an artifact index with no omitted entries and internally consistent counts.");
  }
  let indexedBytes = 0;
  for (const candidate of value.artifacts) {
    if (!isRecord(candidate) || typeof candidate.path !== "string") throw new Error("Artifact index entries require a relative path.");
    const bytes = nonNegativeInteger(candidate.bytes, `artifactIndex.artifacts[${candidate.path}].bytes`);
    if (typeof candidate.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(candidate.sha256)) {
      throw new Error(`Artifact index entry has an invalid SHA-256 digest: ${candidate.path}`);
    }
    indexedBytes += bytes;
  }
  if (indexedBytes !== totalBytes) throw new Error("Visual Hive artifact index totalBytes does not match its entries.");
  return value as unknown as ArtifactIndexReport;
}

function validateCapabilityParityReport(value: unknown): CapabilityParityReport {
  if (!isRecord(value)) throw new Error("Visual Hive capability parity receipt must be a JSON object.");
  if (value.schemaVersion !== "visual-hive.capability-parity.v1" || value.baselineVersion !== "visual-hive.capability-baseline.v1") {
    throw new Error("Visual Hive bundle v3 requires capability parity schema v1 and frozen baseline v1.");
  }
  if (typeof value.generatedAt !== "string" || !Number.isFinite(Date.parse(value.generatedAt))) {
    throw new Error("Visual Hive capability parity receipt requires a valid generatedAt timestamp.");
  }
  if (!isRecord(value.summary) || !Array.isArray(value.domains) || !Array.isArray(value.checks)) {
    throw new Error("Visual Hive capability parity receipt requires summary, domains, and checks.");
  }
  const rawSummary = value.summary;
  const counterNames = ["expected", "actual", "present", "blocked", "missing", "unexpected", "mismatched"] as const;
  const summary = Object.fromEntries(counterNames.map((name) => [name, nonNegativeInteger(rawSummary[name], `capabilityParity.summary.${name}`)])) as unknown as CapabilityParityReport["summary"];
  const domainTotals = Object.fromEntries(counterNames.map((name) => [name, 0])) as Record<(typeof counterNames)[number], number>;
  const domains = new Set<string>();
  for (const candidate of value.domains) {
    if (!isRecord(candidate)
      || typeof candidate.domain !== "string"
      || !(CAPABILITY_PARITY_DOMAINS as readonly string[]).includes(candidate.domain)
      || domains.has(candidate.domain)) {
      throw new Error("Visual Hive capability parity receipt has an invalid or duplicate domain summary.");
    }
    domains.add(candidate.domain);
    for (const name of counterNames) domainTotals[name] += nonNegativeInteger(candidate[name], `capabilityParity.domains.${candidate.domain}.${name}`);
  }
  if (domains.size !== CAPABILITY_PARITY_DOMAINS.length) {
    throw new Error("Visual Hive capability parity receipt must summarize every frozen capability domain.");
  }
  for (const name of counterNames) {
    if (domainTotals[name] !== summary[name]) throw new Error(`Capability parity ${name} summary does not match domain totals.`);
  }
  const checkCounts = { present: 0, blocked: 0, missing: 0, unexpected: 0, mismatched: 0 };
  for (const candidate of value.checks) {
    if (!isRecord(candidate) || typeof candidate.domain !== "string" || !domains.has(candidate.domain) || typeof candidate.key !== "string" || typeof candidate.message !== "string") {
      throw new Error("Visual Hive capability parity receipt contains a malformed check.");
    }
    if (!(candidate.status === "present" || candidate.status === "blocked" || candidate.status === "missing" || candidate.status === "unexpected" || candidate.status === "mismatched")) {
      throw new Error(`Visual Hive capability parity receipt contains an invalid check status: ${String(candidate.status)}`);
    }
    const expectedParity = candidate.status === "present" || candidate.status === "blocked";
    if (candidate.parity !== expectedParity) throw new Error(`Capability parity boolean disagrees with check status for ${candidate.domain}:${candidate.key}.`);
    checkCounts[candidate.status] += 1;
  }
  for (const name of ["present", "blocked", "missing", "unexpected", "mismatched"] as const) {
    if (checkCounts[name] !== summary[name]) throw new Error(`Capability parity ${name} summary does not match checks.`);
  }
  const failedChecks = summary.missing + summary.unexpected + summary.mismatched;
  if (value.status !== (failedChecks === 0 ? "passed" : "failed")) throw new Error("Capability parity status does not match its summary.");
  if (value.runtimeStatus !== (summary.blocked === 0 ? "ready" : "blocked")) throw new Error("Capability parity runtimeStatus does not match its blocked checks.");
  if (value.status !== "passed") throw new Error("Refusing to create a Visual Hive bundle when capability parity failed.");
  return value as unknown as CapabilityParityReport;
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${field} must be a non-negative safe integer.`);
  return Number(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function bindArtifactIndex(
  files: VisualHiveBundleFile[],
  sourcePath: string,
  report: ArtifactIndexReport,
  digest: string
): VisualHiveBundleArtifactIndexBinding {
  const file = requiredBundleFile(files, sourcePath, digest);
  return {
    path: file.path,
    sourcePath,
    sha256: digest,
    schemaVersion: 1,
    contentAddressed: true,
    complete: true,
    artifactCount: report.summary.artifactCount,
    totalBytes: report.summary.totalBytes
  };
}

function bindCapabilityParity(
  files: VisualHiveBundleFile[],
  sourcePath: string,
  report: CapabilityParityReport,
  digest: string
): VisualHiveBundleCapabilityParityBinding {
  const file = requiredBundleFile(files, sourcePath, digest);
  return {
    path: file.path,
    sourcePath,
    sha256: digest,
    schemaVersion: report.schemaVersion,
    baselineVersion: report.baselineVersion,
    status: "passed",
    runtimeStatus: report.runtimeStatus,
    summary: { ...report.summary }
  };
}

function requiredBundleFile(files: VisualHiveBundleFile[], sourcePath: string, digest: string): VisualHiveBundleFile {
  const file = files.find((candidate) => candidate.sourcePath === sourcePath);
  if (!file || file.sha256 !== digest) throw new Error(`Required bundle evidence was not copied with its validated digest: ${sourcePath}`);
  return file;
}

function validArtifactIndexBinding(binding: VisualHiveBundleArtifactIndexBinding, files: VisualHiveBundleFile[]): boolean {
  return binding.schemaVersion === 1
    && binding.contentAddressed === true
    && binding.complete === true
    && Number.isSafeInteger(binding.artifactCount)
    && binding.artifactCount >= 0
    && Number.isSafeInteger(binding.totalBytes)
    && binding.totalBytes >= 0
    && validBoundFile(binding, files);
}

function validCapabilityParityBinding(binding: VisualHiveBundleCapabilityParityBinding, files: VisualHiveBundleFile[]): boolean {
  const summary = binding.summary;
  if (binding.schemaVersion !== "visual-hive.capability-parity.v1"
    || binding.baselineVersion !== "visual-hive.capability-baseline.v1"
    || binding.status !== "passed"
    || !summary) return false;
  const values = [summary.expected, summary.actual, summary.present, summary.blocked, summary.missing, summary.unexpected, summary.mismatched];
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) return false;
  if (summary.missing !== 0 || summary.unexpected !== 0 || summary.mismatched !== 0) return false;
  if (binding.runtimeStatus !== (summary.blocked === 0 ? "ready" : "blocked")) return false;
  return validBoundFile(binding, files);
}

function validBoundFile(
  binding: Pick<VisualHiveBundleArtifactIndexBinding, "path" | "sourcePath" | "sha256">,
  files: VisualHiveBundleFile[]
): boolean {
  if (!/^[a-f0-9]{64}$/.test(binding.sha256)) return false;
  try {
    if (binding.path !== `files/${normalizeRelativeArtifactPath(binding.sourcePath)}`) return false;
  } catch {
    return false;
  }
  return files.some((file) => file.path === binding.path && file.sourcePath === binding.sourcePath && file.sha256 === binding.sha256);
}

function selectBundleVersion(source: VisualHiveBundleSource): "v2" | "v3" {
  if (hasV3SourceIdentity(source)) return "v3";
  const hasPartialHostedIdentity = Boolean(source.workflowRunId || source.workflowRunAttempt || source.workflowArtifactId);
  if (source.event !== "local" || hasPartialHostedIdentity) {
    throw new Error("Hosted Visual Hive bundle publication requires repository, commit, workflow run ID, workflow run attempt, and immutable workflow artifact ID source identity.");
  }
  return "v2";
}

function hasV3SourceIdentity(source: VisualHiveBundleSource): boolean {
  const required = [source.repository, source.commitSha, source.workflowRunId, source.workflowRunAttempt, source.workflowArtifactId];
  return required.every((value) => typeof value === "string" && Boolean(value.trim()) && value !== "unknown" && !value.includes("\0"));
}

function v3ReplayKey(source: VisualHiveBundleSource, bundleId: string): string {
  return sha256([
    "visual-hive.bundle.replay.v3",
    source.repository,
    source.repositoryId ?? "",
    source.commitSha,
    source.workflowRunId ?? "",
    source.workflowRunAttempt ?? "",
    source.workflowArtifactId ?? "",
    bundleId
  ].join("\0"));
}

function v2ReplayKey(source: VisualHiveBundleSource, bundleId: string): string {
  return sha256([
    source.repository,
    source.commitSha,
    source.workflowRunId ?? "local",
    bundleId
  ].join("\0"));
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function digestLegacyBundleContent(
  files: VisualHiveBundleFile[],
  scan: VisualHiveBundleScan,
  observations: VisualHiveBundleObservation[],
  source: VisualHiveBundleSource,
  replayKey: string,
  metadata: BundleDigestMetadata
): string {
  const fileLines = files.map((file) => `file\0${file.path}\0${file.sha256}\0${file.size}`).sort();
  const observationLines = observations.map((observation) => [
      "observation",
      observation.repositoryFingerprint,
      observation.fingerprint,
      observation.state,
      observation.issueKind,
      observation.severity,
      observation.owningAgentHint,
      observation.title,
      observation.body,
      observation.labels.join(","),
      observation.sourceArtifacts.join(","),
      observation.affectedContracts.join(","),
      observation.validationCommand,
      observation.observedAt,
      observation.firstSeenAt,
      observation.sourceArtifact
    ].join("\0")).sort();
  const scanLine = [
    "scan",
    scan.scope,
    String(scan.authoritativeForResolution),
    scan.evaluatedContracts.join(","),
    scan.evaluatedFiles.join(","),
    scan.testPlanVersion,
    scan.toolRegistryVersion
  ].join("\0");
  const sourceLine = [
    "source",
    source.repository,
    source.repositoryId ?? "",
    source.ref,
    source.commitSha,
    source.workflowRunId ?? "",
    source.workflowArtifactId ?? "",
    source.conclusion
  ].join("\0");
  const metadataLine = [
    "metadata",
    metadata.project,
    metadata.mode,
    metadata.verdict,
    String(metadata.acmmRequest),
    String(metadata.externalCallsMade),
    metadata.producerName,
    metadata.producerVersion,
    metadata.producerGitCommit
  ].join("\0");
  return sha256([...fileLines, ...observationLines, scanLine, sourceLine, metadataLine, `replay\0${replayKey}`].join("\n"));
}

type PublicationDigestField =
  | { kind: "scalar"; name: string; value: string }
  | { kind: "array"; name: string; value: string[] };

function digestPublicationBundleContent(
  files: VisualHiveBundleFile[],
  scan: VisualHiveBundleScan,
  observations: VisualHiveBundleObservation[],
  source: VisualHiveBundleSource,
  replayKey: string,
  metadata: BundleDigestMetadata
): string {
  const fileRecords = files.map((file) => encodeDigestRecord("file", [
    scalar("path", file.path),
    scalar("sha256", file.sha256),
    scalar("size", String(file.size))
  ])).sort(Buffer.compare);
  const observationRecords = observations.map((observation) => encodeDigestRecord("observation", [
    scalar("repositoryFingerprint", observation.repositoryFingerprint),
    scalar("fingerprint", observation.fingerprint),
    scalar("publicationRole", observation.publicationRole),
    scalar("rootCauseKey", observation.rootCauseKey),
    array("blockedByRootKeys", observation.blockedByRootKeys),
    scalar("state", observation.state),
    scalar("issueKind", observation.issueKind),
    scalar("severity", observation.severity),
    scalar("owningAgentHint", observation.owningAgentHint),
    scalar("title", observation.title),
    scalar("body", observation.body),
    array("labels", observation.labels),
    array("sourceArtifacts", observation.sourceArtifacts),
    array("affectedContracts", observation.affectedContracts),
    scalar("validationCommand", observation.validationCommand),
    scalar("observedAt", observation.observedAt),
    scalar("firstSeenAt", observation.firstSeenAt),
    scalar("sourceArtifact", observation.sourceArtifact)
  ])).sort(Buffer.compare);
  const chunks = [
    Buffer.from(VISUAL_HIVE_BUNDLE_DIGEST_ALGORITHM, "utf8"),
    encodeDigestCollection("files", fileRecords),
    encodeDigestCollection("observations", observationRecords),
    encodeDigestRecord("scan", [
      scalar("scope", scan.scope),
      scalar("authoritativeForResolution", String(scan.authoritativeForResolution)),
      array("evaluatedContracts", scan.evaluatedContracts),
      array("evaluatedFiles", scan.evaluatedFiles),
      scalar("testPlanVersion", scan.testPlanVersion),
      scalar("toolRegistryVersion", scan.toolRegistryVersion)
    ]),
    encodeDigestRecord("source", [
      scalar("repository", source.repository),
      scalar("repositoryId", source.repositoryId ?? ""),
      scalar("ref", source.ref),
      scalar("commitSha", source.commitSha),
      scalar("workflowRunId", source.workflowRunId ?? ""),
      scalar("workflowArtifactId", source.workflowArtifactId ?? ""),
      scalar("conclusion", source.conclusion)
    ]),
    encodeDigestRecord("metadata", [
      scalar("project", metadata.project),
      scalar("mode", metadata.mode),
      scalar("verdict", metadata.verdict),
      scalar("acmmRequest", String(metadata.acmmRequest)),
      scalar("externalCallsMade", String(metadata.externalCallsMade)),
      scalar("producerName", metadata.producerName),
      scalar("producerVersion", metadata.producerVersion),
      scalar("producerGitCommit", metadata.producerGitCommit)
    ]),
    encodeDigestRecord("replay", [scalar("key", replayKey)])
  ];
  return sha256(Buffer.concat(chunks));
}

function digestV3BundleContent(
  files: VisualHiveBundleFile[],
  scan: VisualHiveBundleScan,
  observations: VisualHiveBundleObservation[],
  source: VisualHiveBundleSource,
  replayKey: string,
  metadata: V3BundleDigestMetadata,
  artifactIndex: VisualHiveBundleArtifactIndexBinding,
  capabilityParity: VisualHiveBundleCapabilityParityBinding
): string {
  const fileRecords = files.map((file) => encodeDigestRecord("file", [
    scalar("path", file.path),
    scalar("sourcePath", file.sourcePath),
    scalar("sha256", file.sha256),
    scalar("size", String(file.size)),
    scalar("mediaType", file.mediaType),
    scalar("schemaVersion", file.schemaVersion ?? "")
  ])).sort(Buffer.compare);
  const observationRecords = observations.map((observation) => encodeDigestRecord("observation", [
    scalar("repositoryFingerprint", observation.repositoryFingerprint),
    scalar("fingerprint", observation.fingerprint),
    scalar("publicationRole", observation.publicationRole),
    scalar("rootCauseKey", observation.rootCauseKey),
    array("blockedByRootKeys", observation.blockedByRootKeys),
    scalar("state", observation.state),
    scalar("issueKind", observation.issueKind),
    scalar("severity", observation.severity),
    scalar("owningAgentHint", observation.owningAgentHint),
    scalar("title", observation.title),
    scalar("body", observation.body),
    array("labels", observation.labels),
    array("sourceArtifacts", observation.sourceArtifacts),
    array("affectedContracts", observation.affectedContracts),
    scalar("validationCommand", observation.validationCommand),
    scalar("observedAt", observation.observedAt),
    scalar("firstSeenAt", observation.firstSeenAt),
    scalar("sourceArtifact", observation.sourceArtifact)
  ])).sort(Buffer.compare);
  const summary = capabilityParity.summary;
  const chunks = [
    Buffer.from(VISUAL_HIVE_BUNDLE_V3_DIGEST_ALGORITHM, "utf8"),
    encodeDigestCollection("files", fileRecords),
    encodeDigestCollection("observations", observationRecords),
    encodeDigestRecord("scan", [
      scalar("scope", scan.scope),
      scalar("authoritativeForResolution", String(scan.authoritativeForResolution)),
      array("evaluatedContracts", scan.evaluatedContracts),
      array("evaluatedFiles", scan.evaluatedFiles),
      scalar("testPlanVersion", scan.testPlanVersion),
      scalar("toolRegistryVersion", scan.toolRegistryVersion)
    ]),
    encodeDigestRecord("source", [
      scalar("repository", source.repository),
      scalar("repositoryId", source.repositoryId ?? ""),
      scalar("ref", source.ref),
      scalar("commitSha", source.commitSha),
      scalar("event", source.event),
      scalar("workflowName", source.workflowName ?? ""),
      scalar("workflowRunId", source.workflowRunId ?? ""),
      scalar("workflowRunAttempt", source.workflowRunAttempt ?? ""),
      scalar("workflowArtifactId", source.workflowArtifactId ?? ""),
      scalar("conclusion", source.conclusion),
      scalar("trusted", String(source.trusted))
    ]),
    encodeDigestRecord("metadata", [
      scalar("generatedAt", metadata.generatedAt),
      scalar("expiresAt", metadata.expiresAt),
      scalar("project", metadata.project),
      scalar("mode", metadata.mode),
      scalar("verdict", metadata.verdict),
      scalar("acmmRequest", String(metadata.acmmRequest)),
      scalar("externalCallsMade", String(metadata.externalCallsMade)),
      scalar("producerName", metadata.producerName),
      scalar("producerVersion", metadata.producerVersion),
      scalar("producerGitCommit", metadata.producerGitCommit)
    ]),
    encodeDigestRecord("artifactIndex", [
      scalar("path", artifactIndex.path),
      scalar("sourcePath", artifactIndex.sourcePath),
      scalar("sha256", artifactIndex.sha256),
      scalar("schemaVersion", String(artifactIndex.schemaVersion)),
      scalar("contentAddressed", String(artifactIndex.contentAddressed)),
      scalar("complete", String(artifactIndex.complete)),
      scalar("artifactCount", String(artifactIndex.artifactCount)),
      scalar("totalBytes", String(artifactIndex.totalBytes))
    ]),
    encodeDigestRecord("capabilityParity", [
      scalar("path", capabilityParity.path),
      scalar("sourcePath", capabilityParity.sourcePath),
      scalar("sha256", capabilityParity.sha256),
      scalar("schemaVersion", capabilityParity.schemaVersion),
      scalar("baselineVersion", capabilityParity.baselineVersion),
      scalar("status", capabilityParity.status),
      scalar("runtimeStatus", capabilityParity.runtimeStatus),
      scalar("expected", String(summary.expected)),
      scalar("actual", String(summary.actual)),
      scalar("present", String(summary.present)),
      scalar("blocked", String(summary.blocked)),
      scalar("missing", String(summary.missing)),
      scalar("unexpected", String(summary.unexpected)),
      scalar("mismatched", String(summary.mismatched))
    ]),
    encodeDigestRecord("replay", [scalar("key", replayKey)])
  ];
  return sha256(Buffer.concat(chunks));
}

function scalar(name: string, value: string): PublicationDigestField {
  return { kind: "scalar", name, value };
}

function array(name: string, value: string[]): PublicationDigestField {
  return { kind: "array", name, value };
}

function encodeDigestRecord(domain: string, fields: PublicationDigestField[]): Buffer {
  const chunks: Buffer[] = [Buffer.from("R"), lengthPrefixed(domain)];
  for (const field of fields) {
    if (field.kind === "scalar") {
      chunks.push(Buffer.from("S"), lengthPrefixed(field.name), lengthPrefixed(field.value));
      continue;
    }
    chunks.push(Buffer.from("A"), lengthPrefixed(field.name), lengthPrefixed(String(field.value.length)));
    for (const item of field.value) chunks.push(Buffer.from("E"), lengthPrefixed(item));
  }
  chunks.push(Buffer.from("Z"));
  return Buffer.concat(chunks);
}

function encodeDigestCollection(domain: string, records: Buffer[]): Buffer {
  const chunks: Buffer[] = [Buffer.from("C"), lengthPrefixed(domain), lengthPrefixed(String(records.length))];
  for (const record of records) chunks.push(Buffer.from("I"), lengthPrefixed(record));
  return Buffer.concat(chunks);
}

function lengthPrefixed(value: string | Buffer): Buffer {
  const data = typeof value === "string" ? Buffer.from(value, "utf8") : value;
  if (data.byteLength > 0xffff_ffff) throw new Error("Visual Hive bundle digest field exceeds the uint32 encoding limit.");
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(data.byteLength);
  return Buffer.concat([length, data]);
}

function sanitizeACMMRequest(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 6) {
    throw new Error(`Visual Hive bundle ACMM request must be an integer from 1 through 6; received ${String(value)}.`);
  }
  return value;
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
  const clean = (value: string | undefined, fallback = "unknown") => {
    if (value?.includes("\0")) throw new Error("Visual Hive bundle source fields cannot contain NUL delimiters.");
    return value?.trim() ? value.trim().slice(0, 512) : fallback;
  };
  return {
    repository: clean(source.repository),
    repositoryId: source.repositoryId ? clean(source.repositoryId) : undefined,
    ref: clean(source.ref),
    commitSha: clean(source.commitSha),
    event: clean(source.event),
    workflowName: source.workflowName ? clean(source.workflowName) : undefined,
    workflowRunId: source.workflowRunId ? clean(source.workflowRunId) : undefined,
    workflowRunAttempt: source.workflowRunAttempt ? clean(source.workflowRunAttempt) : undefined,
    workflowArtifactId: source.workflowArtifactId ? clean(source.workflowArtifactId) : undefined,
    conclusion: clean(source.conclusion),
    trusted: source.trusted
  };
}

function sanitizeScan(scan: Partial<VisualHiveBundleScan> | undefined): VisualHiveBundleScan {
  const scope = scan?.scope ?? "partial";
  if (!["full", "partial", "changed-files", "targeted"].includes(scope)) throw new Error(`Invalid Visual Hive scan scope: ${scope}`);
  const authoritativeForResolution = scan?.authoritativeForResolution ?? false;
  if (authoritativeForResolution && scope !== "full") {
    throw new Error("Only a full Visual Hive scan can be authoritative for resolution.");
  }
  return {
    scope,
    authoritativeForResolution,
    evaluatedContracts: uniqueText(scan?.evaluatedContracts ?? []),
    evaluatedFiles: uniqueText(scan?.evaluatedFiles ?? []),
    testPlanVersion: cleanVersion(scan?.testPlanVersion, "unknown"),
    toolRegistryVersion: cleanVersion(scan?.toolRegistryVersion, "unknown")
  };
}

function observationsFromIssues(
  issues: VisualHiveIssueCandidate[],
  repository: string,
  observedAt: string,
  sourceArtifact = ".visual-hive/issues.json"
): VisualHiveBundleObservation[] {
  return issues.flatMap((issue) => {
    const state = issue.status === "resolved_candidate"
      ? "absent"
      : issue.status === "open_candidate" || issue.status === "update_candidate"
        ? "present"
        : undefined;
    if (!state) return [];
    const publication = publicationMetadataForIssue(issue);
    return [{
      fingerprint: issue.dedupeFingerprint,
      repositoryFingerprint: observationRepositoryFingerprint(repository, issue.dedupeFingerprint, publication.publicationRole, publication.rootCauseKey),
      ...publication,
      state,
      issueKind: issue.issueKind,
      severity: issue.severity,
      owningAgentHint: issue.owningAgentHint,
      title: issue.title,
      body: issue.body,
      labels: uniqueText(issue.labels),
      sourceArtifacts: uniqueText(issue.sourceArtifacts.map(normalizeRelativeArtifactPath)),
      affectedContracts: uniqueText(issue.affected.map((affected) => affected.contractId).filter((value): value is string => Boolean(value))),
      validationCommand: issue.validationCommand,
      observedAt,
      firstSeenAt: observedAt,
      sourceArtifact
    }];
  });
}

function sanitizeObservations(observations: VisualHiveBundleObservation[], repository: string): VisualHiveBundleObservation[] {
  const seen = new Set<string>();
  const sanitized = observations.map((observation) => {
    const publication = publicationMetadataForObservation(observation);
    if (!/^[a-f0-9]{64}$/.test(observation.repositoryFingerprint)) throw new Error(`Invalid repository fingerprint for ${observation.fingerprint}`);
    if (seen.has(observation.repositoryFingerprint)) throw new Error(`Duplicate lifecycle observation: ${observation.fingerprint}`);
    seen.add(observation.repositoryFingerprint);
    if (!observation.fingerprint.trim() || !observation.title.trim() || !observation.body.trim() || !observation.validationCommand.trim()) throw new Error("Lifecycle observations require a fingerprint, title, body, and validation command.");
    const digestFields = [
      observation.fingerprint,
      publication.publicationRole,
      publication.rootCauseKey,
      observation.issueKind,
      observation.owningAgentHint,
      observation.title,
      observation.body,
      observation.validationCommand,
      observation.sourceArtifact,
      ...publication.blockedByRootKeys,
      ...observation.labels,
      ...observation.sourceArtifacts,
      ...observation.affectedContracts
    ];
    if (digestFields.some((value) => value.includes("\0"))) throw new Error("Lifecycle observations cannot contain NUL delimiters.");
    if (observation.state !== "present" && observation.state !== "absent") throw new Error(`Invalid lifecycle observation state: ${observation.state}`);
    validatePublicationRoleForIssueKind(observation.issueKind, publication.publicationRole);
    const expectedRepositoryFingerprint = observationRepositoryFingerprint(
      repository,
      observation.fingerprint.trim(),
      publication.publicationRole,
      publication.rootCauseKey
    );
    if (observation.repositoryFingerprint !== expectedRepositoryFingerprint) {
      throw new Error(`Repository fingerprint does not match publication identity for ${observation.fingerprint}.`);
    }
    return {
      ...observation,
      ...publication,
      fingerprint: observation.fingerprint.trim().slice(0, 512),
      issueKind: observation.issueKind,
      owningAgentHint: observation.owningAgentHint.trim().slice(0, 128),
      title: observation.title.trim().slice(0, 512),
      body: observation.body.trim().slice(0, 60_000),
      labels: uniqueText(observation.labels).slice(0, 50),
      sourceArtifacts: uniqueText(observation.sourceArtifacts.map(normalizeRelativeArtifactPath)),
      affectedContracts: uniqueText(observation.affectedContracts),
      validationCommand: observation.validationCommand.trim().slice(0, 2048),
      sourceArtifact: normalizeRelativeArtifactPath(observation.sourceArtifact)
    };
  }).sort((a, b) => stableCompare(a.repositoryFingerprint, b.repositoryFingerprint));
  return sanitized;
}

type PublicationMetadata = Pick<VisualHiveBundleObservation, "publicationRole" | "rootCauseKey" | "blockedByRootKeys">;

function publicationMetadataForIssue(issue: VisualHiveIssueCandidate): PublicationMetadata {
  return normalizePublicationMetadata(issue.publicationRole, issue.rootCauseKey, issue.blockedByRootKeys, issue.dedupeFingerprint);
}

function publicationMetadataForObservation(observation: VisualHiveBundleObservation): PublicationMetadata {
  return normalizePublicationMetadata(
    observation.publicationRole,
    observation.rootCauseKey,
    observation.blockedByRootKeys,
    observation.fingerprint
  );
}

function normalizePublicationMetadata(
  publicationRole: VisualHivePublicationRole,
  rootCauseKey: string,
  blockedByRootKeys: string[],
  fingerprint: string
): PublicationMetadata {
  if (!(["canonical", "derivative", "aggregate"] as const).includes(publicationRole)) {
    throw new Error(`Lifecycle observation ${fingerprint} has an invalid publication role.`);
  }
  const cleanRoot = cleanRootCauseKey(rootCauseKey, fingerprint);
  if (!Array.isArray(blockedByRootKeys)) throw new Error(`Lifecycle observation ${fingerprint} blockedByRootKeys must be an array.`);
  const cleanBlockedRoots = stableUniqueText(blockedByRootKeys.map((value) => cleanRootCauseKey(value, fingerprint)));
  if (publicationRole === "aggregate" && cleanBlockedRoots.length === 0) {
    throw new Error(`Aggregate lifecycle observation ${fingerprint} requires blocked root keys.`);
  }
  if (publicationRole !== "aggregate" && cleanBlockedRoots.length > 0) {
    throw new Error(`Only aggregate lifecycle observations may declare blocked root keys: ${fingerprint}`);
  }
  if (cleanBlockedRoots.includes(cleanRoot)) throw new Error(`Lifecycle observation ${fingerprint} cannot block on its own root cause key.`);
  return { publicationRole, rootCauseKey: cleanRoot, blockedByRootKeys: cleanBlockedRoots };
}

function cleanRootCauseKey(value: string, fingerprint: string): string {
  if (typeof value !== "string") throw new Error(`Lifecycle observation ${fingerprint} rootCauseKey must be a string.`);
  const clean = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._~:/,%+-]{0,511}$/u.test(clean) || /%(?![0-9A-Fa-f]{2})/u.test(clean)) {
    throw new Error(`Lifecycle observation ${fingerprint} rootCauseKey must be a 1-512 character URI-safe publication key.`);
  }
  return clean;
}

function validatePublicationRoleForIssueKind(issueKind: VisualHiveIssueKind, publicationRole: VisualHivePublicationRole): void {
  const knownIssueKinds: VisualHiveIssueKind[] = [
    "setup_needed",
    "map_drift",
    "missing_visual_coverage",
    "test_adequacy_gap",
    "weak_visual_test",
    "stale_baseline",
    "baseline_churn",
    "visual_regression",
    "selector_contract_failure",
    "screenshot_diff",
    "mutation_survivor",
    "workflow_safety",
    "provider_governance",
    "protected_target_blocked",
    "external_repo_onboarding"
  ];
  if (!knownIssueKinds.includes(issueKind)) throw new Error(`Unknown lifecycle observation issue kind: ${String(issueKind)}`);
  if (publicationRole === "derivative" && !["missing_visual_coverage", "weak_visual_test", "external_repo_onboarding"].includes(issueKind)) {
    throw new Error(`Issue kind ${issueKind} cannot be a derivative lifecycle observation.`);
  }
  if (publicationRole === "aggregate" && issueKind !== "external_repo_onboarding") {
    throw new Error(`Issue kind ${issueKind} cannot be an aggregate lifecycle observation.`);
  }
}

function observationRepositoryFingerprint(
  repository: string,
  fingerprint: string,
  publicationRole: VisualHivePublicationRole,
  rootCauseKey: string
): string {
  const identity = publicationRole === "canonical" ? rootCauseKey : fingerprint;
  return sha256(`${repository.trim().toLowerCase()}\0${identity}`);
}

function stableUniqueText(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort(stableCompare);
}

function uniqueText(values: string[]): string[] {
  if (values.some((value) => value.includes("\0"))) throw new Error("Visual Hive bundle metadata cannot contain NUL delimiters.");
  return stableUniqueText(values);
}

function stableCompare(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function cleanVersion(value: string | undefined, fallback: string): string {
  if (value?.includes("\0")) throw new Error("Visual Hive bundle versions cannot contain NUL delimiters.");
  const clean = value?.trim();
  return clean ? clean.slice(0, 256) : fallback;
}
