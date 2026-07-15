import { createHash, randomUUID } from "node:crypto";
import { cp, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { VisualHiveIssueCandidate, VisualHiveIssueKind, VisualHiveIssueSeverity, VisualHivePublicationRole } from "../issues/types.js";

export const VISUAL_HIVE_BUNDLE_DIGEST_ALGORITHM = "visual-hive.bundle.publication-digest.v1" as const;

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

export interface VisualHiveBundleManifest {
  schemaVersion: "visual-hive.bundle.v2";
  /** Absent only on legacy v2 manifests whose observations have no publication metadata. */
  digestAlgorithm?: typeof VISUAL_HIVE_BUNDLE_DIGEST_ALGORITHM;
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
  artifactLimits?: {
    maxFiles: number;
    maxFileBytes: number;
    maxTotalBytes: number;
  };
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
    const artifacts = uniqueSorted(options.artifacts);
    const limits = sanitizeArtifactLimits(options.artifactLimits);
    if (artifacts.length > limits.maxFiles) throw new Error(`Visual Hive bundle exceeds its ${limits.maxFiles}-file limit.`);
    let totalBytes = 0;
    for (const artifact of artifacts) {
      const sourcePath = normalizeRelativeArtifactPath(artifact);
      const absoluteSource = resolveInsideRoot(rootDir, sourcePath);
      const sourceStat = await lstat(absoluteSource);
      if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) throw new Error(`Visual Hive bundle artifact is not a regular file: ${sourcePath}`);
      if (sourceStat.size <= 0 || sourceStat.size > limits.maxFileBytes) throw new Error(`Visual Hive bundle artifact exceeds its bounded file size: ${sourcePath}`);
      totalBytes += sourceStat.size;
      if (totalBytes > limits.maxTotalBytes) throw new Error(`Visual Hive bundle exceeds its ${limits.maxTotalBytes}-byte aggregate limit.`);
      const bundledPath = normalizeRelativeArtifactPath(path.join("files", sourcePath));
      const destination = path.join(temporaryDir, ...bundledPath.split("/"));
      await mkdir(path.dirname(destination), { recursive: true });
      await cp(absoluteSource, destination, { force: false, errorOnExist: true });
      const destinationStat = await lstat(destination);
      if (!destinationStat.isFile() || destinationStat.isSymbolicLink() || destinationStat.size !== sourceStat.size) throw new Error(`Visual Hive bundle artifact changed while being copied: ${sourcePath}`);
      const data = await readFile(destination);
      if (data.byteLength !== sourceStat.size) throw new Error(`Visual Hive bundle artifact changed while being read: ${sourcePath}`);
      files.push({
        path: bundledPath,
        sourcePath,
        sha256: sha256(data),
        size: data.byteLength,
        mediaType: mediaTypeFor(sourcePath),
        schemaVersion: schemaVersionFor(sourcePath, data)
      });
    }

    const source = sanitizeSource(options.source);
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
      key: sha256([
        source.repository,
        source.commitSha,
        source.workflowRunId ?? "local",
        bundleId
      ].join("\0"))
    };
    const acmmRequest = sanitizeACMMRequest(options.acmmRequest);
    const metadata = {
      project: options.project,
      mode: options.mode,
      verdict: options.verdict,
      acmmRequest,
      externalCallsMade: options.externalCallsMade ?? 0,
      producerName: "visual-hive" as const,
      producerVersion: options.producerVersion,
      producerGitCommit: options.producerGitCommit
    };
    const digestAlgorithm = VISUAL_HIVE_BUNDLE_DIGEST_ALGORITHM;
    const overallDigest = digestPublicationBundleContent(files, scan, observations, source, replayProtection.key, metadata);
    const manifest: VisualHiveBundleManifest = {
      schemaVersion: "visual-hive.bundle.v2",
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

function sanitizeArtifactLimits(value: WriteVisualHiveBundleOptions["artifactLimits"]): { maxFiles: number; maxFileBytes: number; maxTotalBytes: number } {
  const limits = value ?? { maxFiles: 4096, maxFileBytes: 64 * 1024 * 1024, maxTotalBytes: 512 * 1024 * 1024 };
  if (!Number.isSafeInteger(limits.maxFiles) || limits.maxFiles <= 0 || limits.maxFiles > 100_000) throw new Error("Visual Hive bundle file-count limit is invalid.");
  if (!Number.isSafeInteger(limits.maxFileBytes) || limits.maxFileBytes <= 0 || limits.maxFileBytes > 1024 * 1024 * 1024) throw new Error("Visual Hive bundle per-file limit is invalid.");
  if (!Number.isSafeInteger(limits.maxTotalBytes) || limits.maxTotalBytes < limits.maxFileBytes || limits.maxTotalBytes > 4 * 1024 * 1024 * 1024) throw new Error("Visual Hive bundle aggregate limit is invalid.");
  return limits;
}

export function verifyVisualHiveBundleDigest(manifest: VisualHiveBundleManifest): boolean {
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
  return [...new Set(values.map(normalizeRelativeArtifactPath))].sort(stableCompare);
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
      repositoryFingerprint: visualHiveObservationRepositoryFingerprint(repository, issue.dedupeFingerprint, publication.publicationRole, publication.rootCauseKey),
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
    const expectedRepositoryFingerprint = visualHiveObservationRepositoryFingerprint(
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

export function visualHiveObservationRepositoryFingerprint(
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
