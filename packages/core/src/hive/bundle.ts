import { createHash, randomUUID } from "node:crypto";
import { cp, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { VisualHiveIssueCandidate, VisualHiveIssueSeverity } from "../issues/types.js";

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
  state: "present" | "absent";
  issueKind: string;
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

    const source = sanitizeSource(options.source);
    const scan = sanitizeScan(options.scan);
    const observations = sanitizeObservations(
      options.observations ?? observationsFromIssues(options.issues ?? [], source.repository, generatedAt, options.issuesArtifact)
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
    const overallDigest = digestBundleContent(files, scan, observations, source, replayProtection.key);
    const manifest: VisualHiveBundleManifest = {
      schemaVersion: "visual-hive.bundle.v2",
      bundleId,
      generatedAt,
      expiresAt,
      producer: { name: "visual-hive", version: options.producerVersion, gitCommit: options.producerGitCommit },
      source,
      project: options.project,
      mode: options.mode,
      verdict: options.verdict,
      acmmRequest: options.acmmRequest,
      externalCallsMade: options.externalCallsMade ?? 0,
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

export function verifyVisualHiveBundleDigest(manifest: VisualHiveBundleManifest): boolean {
  return manifest.overallDigest === digestBundleContent(
    manifest.files,
    manifest.scan,
    manifest.observations,
    manifest.source,
    manifest.replayProtection.key
  );
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

function digestBundleContent(
  files: VisualHiveBundleFile[],
  scan: VisualHiveBundleScan,
  observations: VisualHiveBundleObservation[],
  source: VisualHiveBundleSource,
  replayKey: string
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
  return sha256([...fileLines, ...observationLines, scanLine, sourceLine, `replay\0${replayKey}`].join("\n"));
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
    return [{
      fingerprint: issue.dedupeFingerprint,
      repositoryFingerprint: sha256(`${repository.trim().toLowerCase()}\0${issue.dedupeFingerprint}`),
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

function sanitizeObservations(observations: VisualHiveBundleObservation[]): VisualHiveBundleObservation[] {
  const seen = new Set<string>();
  return observations.map((observation) => {
    if (!/^[a-f0-9]{64}$/.test(observation.repositoryFingerprint)) throw new Error(`Invalid repository fingerprint for ${observation.fingerprint}`);
    if (seen.has(observation.repositoryFingerprint)) throw new Error(`Duplicate lifecycle observation: ${observation.fingerprint}`);
    seen.add(observation.repositoryFingerprint);
    if (!observation.fingerprint.trim() || !observation.title.trim() || !observation.body.trim() || !observation.validationCommand.trim()) throw new Error("Lifecycle observations require a fingerprint, title, body, and validation command.");
    const digestFields = [
      observation.fingerprint,
      observation.issueKind,
      observation.owningAgentHint,
      observation.title,
      observation.body,
      observation.validationCommand,
      observation.sourceArtifact,
      ...observation.labels,
      ...observation.sourceArtifacts,
      ...observation.affectedContracts
    ];
    if (digestFields.some((value) => value.includes("\0"))) throw new Error("Lifecycle observations cannot contain NUL delimiters.");
    if (observation.state !== "present" && observation.state !== "absent") throw new Error(`Invalid lifecycle observation state: ${observation.state}`);
    return {
      ...observation,
      fingerprint: observation.fingerprint.trim().slice(0, 512),
      issueKind: observation.issueKind.trim().slice(0, 128),
      owningAgentHint: observation.owningAgentHint.trim().slice(0, 128),
      title: observation.title.trim().slice(0, 512),
      body: observation.body.trim().slice(0, 60_000),
      labels: uniqueText(observation.labels).slice(0, 50),
      sourceArtifacts: uniqueText(observation.sourceArtifacts.map(normalizeRelativeArtifactPath)),
      affectedContracts: uniqueText(observation.affectedContracts),
      validationCommand: observation.validationCommand.trim().slice(0, 2048),
      sourceArtifact: normalizeRelativeArtifactPath(observation.sourceArtifact)
    };
  }).sort((a, b) => a.repositoryFingerprint.localeCompare(b.repositoryFingerprint));
}

function uniqueText(values: string[]): string[] {
  if (values.some((value) => value.includes("\0"))) throw new Error("Visual Hive bundle metadata cannot contain NUL delimiters.");
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function cleanVersion(value: string | undefined, fallback: string): string {
  if (value?.includes("\0")) throw new Error("Visual Hive bundle versions cannot contain NUL delimiters.");
  const clean = value?.trim();
  return clean ? clean.slice(0, 256) : fallback;
}
