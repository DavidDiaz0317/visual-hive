import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { access, lstat, mkdir, open, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import {
  HiveRepairValidationRequestSpecSchema,
  HiveRepairBudgetLimitsSchema,
  RelativeArtifactPathSchema,
  buildVisualRunContext,
  canonicalSha256,
  computeVisualValidationPolicyDigest,
  inspectVisualImageBytes,
  parseVisualHiveTaskContext,
  parseHiveExecutionAuthorization,
  parseVisualRunContext,
  sha256Bytes,
  stableTextCompare,
  verifyVisualHiveBundleDigest,
  visualHiveObservationRepositoryFingerprint,
  visualRepairSessionRelativeRoot,
  writeVisualHiveBundle,
  type ContractResult,
  type HiveRepairValidationRequestSpec,
  type HiveExecutionAuthorization,
  type Plan,
  type PlaywrightExecutionBinding,
  type Report,
  type VisualExecutionCase,
  type VisualHiveBundleManifest,
  type VisualHiveBundleObservation,
  type VisualHiveConfig,
  type VisualHiveTaskContext,
  type VisualRunContext,
  type VisualRunEvidenceAsset,
  type VisualRunThreshold
} from "@visual-hive/core";
import { runPlaywrightContracts } from "./runner.js";

type HiveRepairBudgetLimits = (typeof HiveRepairBudgetLimitsSchema)["_output"];

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const MAX_REPAIR_JSON_BYTES = 16 * 1024 * 1024;
const MAX_REPAIR_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_REPAIR_ARTIFACT_BYTES = 64 * 1024 * 1024;
const MAX_REPAIR_ARTIFACT_TOTAL_BYTES = 512 * 1024 * 1024;
const MAX_REPAIR_ARTIFACT_FILES = 4096;
const MAX_REPAIR_ARTIFACT_DEPTH = 24;

export const PLAYWRIGHT_REPAIR_VALIDATION_TOOL_REGISTRY_VERSION = "visual-hive.playwright-repair-runner.v1" as const;
export const PLAYWRIGHT_REPAIR_VALIDATION_TOOL_REGISTRY_DIGEST = canonicalSha256(
  PLAYWRIGHT_REPAIR_VALIDATION_TOOL_REGISTRY_VERSION
);

export interface PlaywrightRepairCaptureSource {
  ref: string;
  event: string;
  workflowName?: string;
  workflowRunId?: string;
  workflowRunAttempt?: string;
  workflowArtifactId?: string;
  /** A producer claim only; Hive independently verifies hosted provenance. */
  trusted: boolean;
}

export interface PlaywrightRepairCaptureAssertionIdentity {
  contractId: string;
  screenshotName: string;
  route: string;
  state: string;
  viewportId: string;
}

export interface PlaywrightRepairProducerIdentity {
  identityKind: "verified_release_manifest";
  visualHiveVersion: string;
  visualHiveCommit: string;
  manifestSha256: string;
  entrypointSha256: string;
}

export type PlaywrightRepairCaptureFinding = Omit<
  VisualHiveBundleObservation,
  "state" | "observedAt" | "sourceArtifact" | "validationCommand"
> & {
  affectedObligationIds: string[];
  affectedAssertions: PlaywrightRepairCaptureAssertionIdentity[];
};

const PLAYWRIGHT_REPAIR_FINDING_KEYS = [
  "affectedContracts",
  "affectedAssertions",
  "affectedObligationIds",
  "blockedByRootKeys",
  "body",
  "fingerprint",
  "firstSeenAt",
  "issueKind",
  "labels",
  "owningAgentHint",
  "publicationRole",
  "repositoryFingerprint",
  "rootCauseKey",
  "severity",
  "sourceArtifacts",
  "title"
] as const;

const PLAYWRIGHT_REPAIR_ISSUE_KINDS = [
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
] as const;

/** Strict JSON-boundary parser used by CLI and broker integrations. */
export function parsePlaywrightRepairCaptureFinding(value: unknown): PlaywrightRepairCaptureFinding {
  if (!isPlainRecord(value)) throw new Error("Playwright repair capture finding must be an object.");
  const keys = Object.keys(value).sort(stableTextCompare);
  if (canonicalSha256(keys) !== canonicalSha256([...PLAYWRIGHT_REPAIR_FINDING_KEYS].sort(stableTextCompare))) {
    throw new Error("Playwright repair capture finding has missing or unknown fields.");
  }
  const publicationRole = requiredEnum(value.publicationRole, ["canonical", "derivative", "aggregate"] as const, "publicationRole");
  const rootCauseKey = requiredText(value.rootCauseKey, "rootCauseKey", 512);
  if (!/^[A-Za-z0-9][A-Za-z0-9._~:/,%+-]{0,511}$/u.test(rootCauseKey) || /%(?![0-9A-Fa-f]{2})/u.test(rootCauseKey)) {
    throw new Error("Playwright repair capture finding rootCauseKey is not URI-safe.");
  }
  const repositoryFingerprint = requiredText(value.repositoryFingerprint, "repositoryFingerprint", 64);
  if (!/^[a-f0-9]{64}$/u.test(repositoryFingerprint)) throw new Error("Playwright repair capture finding repositoryFingerprint is invalid.");
  const firstSeenAt = requiredText(value.firstSeenAt, "firstSeenAt", 128);
  if (!/T/u.test(firstSeenAt) || Number.isNaN(Date.parse(firstSeenAt))) throw new Error("Playwright repair capture finding firstSeenAt is invalid.");
  return {
    fingerprint: requiredText(value.fingerprint, "fingerprint", 512),
    repositoryFingerprint,
    publicationRole,
    rootCauseKey,
    blockedByRootKeys: requiredTextArray(value.blockedByRootKeys, "blockedByRootKeys", 512, 512),
    issueKind: requiredEnum(value.issueKind, PLAYWRIGHT_REPAIR_ISSUE_KINDS, "issueKind"),
    severity: requiredEnum(value.severity, ["low", "medium", "high", "critical"] as const, "severity"),
    owningAgentHint: requiredText(value.owningAgentHint, "owningAgentHint", 128),
    title: requiredText(value.title, "title", 512),
    body: requiredText(value.body, "body", 60_000),
    labels: requiredTextArray(value.labels, "labels", 50, 512),
    sourceArtifacts: requiredTextArray(value.sourceArtifacts, "sourceArtifacts", 512, 1024).map((item) => RelativeArtifactPathSchema.parse(item)),
    affectedContracts: requiredTextArray(value.affectedContracts, "affectedContracts", 512, 256),
    affectedObligationIds: requiredTextArray(value.affectedObligationIds, "affectedObligationIds", 256, 256),
    affectedAssertions: requiredAssertionIdentities(value.affectedAssertions),
    firstSeenAt
  };
}

export interface RunPlaywrightRepairCaptureOptions {
  rootDir: string;
  config: VisualHiveConfig;
  plan: Plan;
  taskContext: VisualHiveTaskContext;
  brokerRequest: HiveRepairValidationRequestSpec;
  executionAuthorization: HiveExecutionAuthorization;
  budgetLimits: HiveRepairBudgetLimits;
  phase: "before" | "after";
  finding: PlaywrightRepairCaptureFinding;
  producer: PlaywrightRepairProducerIdentity;
  expectedProducer: {
    visualHiveVersion: string;
    visualHiveCommit: string;
    manifestSha256: string;
    entrypointSha256: string;
  };
  source: PlaywrightRepairCaptureSource;
  outputRoot?: string;
  acmmRequest?: number;
  /** Injectable trusted clock for deterministic tests. */
  now?: () => Date;
}

export interface PlaywrightRepairCaptureResult {
  schemaVersion: "visual-hive.playwright-repair-capture-result.v1";
  reused: boolean;
  phase: "before" | "after";
  requestId: string;
  requestDigest: string;
  commitSha: string;
  captureStatus: "passed" | "failed" | "blocked";
  exitCode: number;
  receiptDigest: string;
  runDirectory: string;
  reportPath: string;
  runContextPath: string;
  runtimeIdentityPath: string;
  metadataPath: string;
  completionPath: string;
  bundleManifestPath: string;
  bundleDirectory: string;
  artifactPaths: string[];
  report: Report;
  runContext: VisualRunContext;
  bundleManifest: VisualHiveBundleManifest;
}

export class PlaywrightRepairCaptureError extends Error {
  constructor(message: string, readonly runDirectory?: string, readonly failurePath?: string) {
    super(message);
    this.name = "PlaywrightRepairCaptureError";
  }
}

interface RuntimeSidecar {
  schemaVersion: "visual-hive.playwright-runtime.v1";
  executionBinding: PlaywrightExecutionBinding;
  capturedAt: string;
  browser: { name: string; version: string };
  environment: {
    os: string;
    architecture: string;
    nodeVersion: string;
    playwrightVersion: string;
    locale: string;
    timezone: string;
    userAgent: string;
    deviceScaleFactor: number;
    fonts: Array<{ name: string; available: boolean }>;
  };
}

interface CaptureInputs {
  task: VisualHiveTaskContext;
  request: HiveRepairValidationRequestSpec;
  authorization: HiveExecutionAuthorization;
  budgetLimits: HiveRepairBudgetLimits;
  cases: VisualExecutionCase[];
  thresholds: VisualRunThreshold[];
  configDigest: string;
  planDigest: string;
  testPlanVersion: string;
  baselineIdentityDigest: string;
  missingBaselines: string[];
  profile: VisualHiveTaskContext["profiles"][number];
  captureInputDigest: string;
  captureDeadlineAtMs: number;
}

interface CaptureCompletion {
  schemaVersion: "visual-hive.playwright-repair-capture-completion.v1";
  phase: "before" | "after";
  requestId: string;
  requestDigest: string;
  captureInputDigest: string;
  commitSha: string;
  captureStatus: "passed" | "failed" | "blocked";
  exitCode: number;
  receiptDigest: string;
  runDirectory: string;
  reportPath: string;
  reportSha256: string;
  runContextPath: string;
  runContextDigest: string;
  runtimeIdentityPath: string;
  metadataPath: string;
  bundleManifestPath: string;
  bundleDirectory: string;
  bundleDigest: string;
  artifactPaths: string[];
  completedAt: string;
}

/**
 * Runs the existing first-party Playwright adapter as an immutable Hive-brokered
 * validation operation. The caller cannot supply browser identity, case matrix,
 * thresholds, or execution digests; they are derived from the actual run inputs.
 */
export async function runPlaywrightRepairCapture(
  options: RunPlaywrightRepairCaptureOptions
): Promise<PlaywrightRepairCaptureResult> {
  const normalizedOptions: RunPlaywrightRepairCaptureOptions = {
    ...options,
    finding: parsePlaywrightRepairCaptureFinding(options.finding)
  };
  const rootDir = await canonicalRepositoryRoot(normalizedOptions.rootDir);
  const inputs = await validateAndDeriveInputs(normalizedOptions, rootDir);
  const defaultOutputRoot = relativeJoin(visualRepairSessionRelativeRoot({
    taskId: inputs.task.taskId,
    repository: inputs.task.repository.name,
    taskContextDigest: inputs.task.contextDigest
  }), "runs");
  const outputRoot = RelativeArtifactPathSchema.parse(normalizedOptions.outputRoot ?? defaultOutputRoot);
  if (outputRoot !== defaultOutputRoot) throw new Error("Playwright repair capture output must use the exact computed session namespace.");
  const runDirectory = relativeJoin(outputRoot, `run.${inputs.request.requestId}`);
  const completionPath = relativeJoin(runDirectory, "capture-result.json");
  const existing = await loadExistingCapture(normalizedOptions, inputs, rootDir, runDirectory, completionPath);
  if (existing) return existing;

  const runDirectoryAbsolute = resolveRelative(rootDir, runDirectory);
  await ensureSafeRelativeDirectory(rootDir, outputRoot);
  try {
    await mkdir(runDirectoryAbsolute);
    await assertSafeRelativeDirectory(rootDir, runDirectory);
  } catch (error) {
    if (isErrorCode(error, "EEXIST")) {
      const completed = await loadExistingCapture(normalizedOptions, inputs, rootDir, runDirectory, completionPath);
      if (completed) return completed;
      throw new PlaywrightRepairCaptureError(
        `Hive validation request ${inputs.request.requestId} already has an incomplete immutable capture directory.`,
        runDirectory
      );
    }
    throw error;
  }

  const failurePath = relativeJoin(runDirectory, "capture-failure.json");
  const intentPath = relativeJoin(runDirectory, "capture-input.json");
  const executionDirectory = relativeJoin(path.posix.dirname(runDirectory), `exec.${randomBytes(12).toString("hex")}`);
  await writeJsonExclusive(rootDir, intentPath, captureIntent(normalizedOptions, inputs, runDirectory, executionDirectory));
  try {
    return await executeCapture(normalizedOptions, inputs, rootDir, runDirectory, executionDirectory, completionPath, intentPath);
  } catch (error) {
    const message = scrubRepositoryRoot(error instanceof Error ? error.message : String(error), rootDir);
    await writeFailureMarker(rootDir, failurePath, inputs, normalizedOptions.phase, message);
    throw new PlaywrightRepairCaptureError(message, runDirectory, failurePath);
  }
}

function captureIntent(options: RunPlaywrightRepairCaptureOptions, inputs: CaptureInputs, runDirectory: string, executionDirectory: string): Record<string, unknown> {
  return {
    schemaVersion: "visual-hive.playwright-repair-capture-input.v1",
    captureInputDigest: inputs.captureInputDigest,
    startedAt: new Date().toISOString(),
    ownerPid: process.pid,
    phase: options.phase,
    runDirectory,
    executionDirectory,
    leaseExpiresAt: new Date(inputs.captureDeadlineAtMs).toISOString(),
    taskContextDigest: inputs.task.contextDigest,
    requestId: inputs.request.requestId,
    requestDigest: inputs.request.requestDigest,
    authorizationDigest: inputs.authorization.authorizationDigest,
    budgetDigest: inputs.authorization.budgetDigest,
    configDigest: inputs.configDigest,
    planDigest: inputs.planDigest,
    baselineIdentityDigest: inputs.baselineIdentityDigest,
    producer: options.producer,
    source: captureSourceIdentity(options.source),
    acmmRequest: options.acmmRequest ?? 5
  };
}

async function validateAndDeriveInputs(
  options: RunPlaywrightRepairCaptureOptions,
  rootDir: string
): Promise<CaptureInputs> {
  const task = parseVisualHiveTaskContext(options.taskContext);
  const request = HiveRepairValidationRequestSpecSchema.parse(options.brokerRequest);
  const authorization = parseHiveExecutionAuthorization(options.executionAuthorization);
  const budgetLimits = HiveRepairBudgetLimitsSchema.parse(options.budgetLimits);
  const logicalNow = trustedNow(options);
  const authorizationRemainingMs = Date.parse(authorization.expiresAt) - logicalNow.getTime();
  if (logicalNow.getTime() < Date.parse(authorization.issuedAt)) throw new Error("Hive execution authorization is not yet active.");
  if (authorizationRemainingMs <= 0) throw new Error("Hive execution authorization has expired.");
  if (!request.authorizationDigest) throw new Error("A Hive-brokered Playwright repair capture requires execution authorization identity.");
  if (request.authorizationDigest !== authorization.authorizationDigest) throw new Error("Hive validation request does not bind the supplied execution authorization.");
  if (authorization.taskContextDigest !== task.contextDigest) throw new Error("Hive execution authorization names a different Visual Hive task context.");
  if (authorization.repositoryFingerprint !== task.repository.repositoryFingerprint || authorization.baseSha !== task.repository.baseSha) {
    throw new Error("Hive execution authorization names a different repository or base commit.");
  }
  if (authorization.budgetDigest !== canonicalSha256(budgetLimits)) throw new Error("Hive execution budget does not match its authorization digest.");
  if (request.commitSha !== await git(rootDir, ["rev-parse", "HEAD"])) {
    throw new Error(`Playwright repair capture expected git HEAD ${request.commitSha}, but the repository is at a different commit.`);
  }
  if (options.phase === "before" && (request.commitRole !== "base" || !["reproduction", "capture"].includes(request.kind))) {
    throw new Error("A before repair capture requires a base reproduction or capture request.");
  }
  if (options.phase === "after" && (request.commitRole !== "candidate" || request.kind !== "patch_validation")) {
    throw new Error("An after repair capture requires a candidate patch-validation request.");
  }
  if (options.phase === "before" && request.commitSha !== task.repository.baseSha) {
    throw new Error("A before repair capture must execute the task base commit.");
  }
  if (options.phase === "after" && request.commitSha === task.repository.baseSha) {
    throw new Error("An after repair capture must execute a candidate commit distinct from the task base.");
  }
  if (options.plan.mode !== "full") throw new Error("Hive repair validation requires a full Playwright plan.");
  if (options.plan.mutation.enabled) throw new Error("Playwright repair capture cannot claim a full plan that includes an unexecuted mutation lane.");
  if (options.config.visual.updateSnapshots) throw new Error("Hive repair validation forbids snapshot updates.");
  if (!options.config.visual.failOnMissingBaselineInCI) {
    throw new Error("Hive repair validation must fail closed when a screenshot baseline is missing.");
  }
  if (options.finding.publicationRole !== "canonical") throw new Error("Hive repair validation requires a canonical finding.");
  if (options.finding.issueKind !== "visual_regression" && options.finding.issueKind !== "screenshot_diff") {
    throw new Error(`Playwright repair capture cannot resolve non-screenshot finding kind ${options.finding.issueKind}.`);
  }
  const expectedFindingRepositoryFingerprint = visualHiveObservationRepositoryFingerprint(
    task.repository.name,
    options.finding.fingerprint,
    options.finding.publicationRole,
    options.finding.rootCauseKey
  );
  if (options.finding.repositoryFingerprint !== expectedFindingRepositoryFingerprint) {
    throw new Error("Hive repair validation finding repository identity is invalid.");
  }
  if (options.finding.affectedContracts.length === 0) throw new Error("Hive repair validation finding has no affected contracts.");
  if (options.producer.identityKind !== "verified_release_manifest") throw new Error("Visual Hive repair capture requires verified release-manifest producer identity.");
  if (!options.producer.visualHiveVersion.trim()) throw new Error("Visual Hive producer version is required.");
  if (!/^[a-f0-9]{40}$/u.test(options.producer.visualHiveCommit)) throw new Error("Visual Hive producer commit must be an exact 40-character SHA.");
  if (!/^[a-f0-9]{64}$/u.test(options.producer.manifestSha256) || !/^[a-f0-9]{64}$/u.test(options.producer.entrypointSha256)) {
    throw new Error("Visual Hive producer release-manifest identity is invalid.");
  }
  if (options.producer.visualHiveVersion !== options.expectedProducer.visualHiveVersion || options.producer.visualHiveCommit !== options.expectedProducer.visualHiveCommit || options.producer.manifestSha256 !== options.expectedProducer.manifestSha256 || options.producer.entrypointSha256 !== options.expectedProducer.entrypointSha256) {
    throw new Error("Verified Visual Hive producer identity does not match the Hive session capability pin.");
  }
  if (authorization.visualHiveManifestSha256 !== options.producer.manifestSha256 || authorization.visualHiveEntrypointSha256 !== options.producer.entrypointSha256) {
    throw new Error("Hive execution authorization does not bind the verified Visual Hive release artifact.");
  }
  if (options.acmmRequest !== undefined && (!Number.isInteger(options.acmmRequest) || options.acmmRequest < 1 || options.acmmRequest > 6)) {
    throw new Error("Playwright repair capture ACMM request must be an integer from 1 through 6.");
  }
  if (!options.source.ref.trim() || !options.source.event.trim()) throw new Error("Repair capture source ref and event are required.");
  await assertTrackedTreeUnchanged(rootDir);

  const profile = task.profiles.find((candidate) => candidate.profileId === request.profileId);
  if (!profile || profile.profileDigest !== request.profileDigest) {
    throw new Error("Hive validation request does not match a task-declared Visual Hive profile.");
  }
  if (canonicalSha256(authorization.profile) !== canonicalSha256(profile)) {
    throw new Error("Hive execution authorization does not bind the exact task validation profile.");
  }
  if (!profile.requestKinds.includes(request.kind)) throw new Error(`Visual Hive profile ${profile.profileId} does not authorize ${request.kind}.`);
  if (profile.scenarioIds.length > 1) {
    throw new Error("The first-party Playwright repair bridge cannot prove more than one implicit scenario in a single profile.");
  }

  const configContractIds = sortedUnique(options.config.contracts.map((contract) => contract.id));
  const planContractIds = sortedUnique(options.plan.items.map((item) => item.contractId));
  const profileContractIds = sortedUnique(profile.contractIds);
  assertExactSet(configContractIds, profileContractIds, "configured and authorized contract inventory");
  assertExactSet(planContractIds, profileContractIds, "planned and authorized contract inventory");
  if (new Set(options.plan.items.map((item) => item.contractId)).size !== options.plan.items.length) {
    throw new Error("Full Playwright repair plan contains duplicate contract items.");
  }
  if (options.plan.excluded.length > 0) throw new Error("Full Playwright repair plan cannot exclude configured contracts.");
  const planTargetIds = options.plan.targets.map((target) => target.id);
  if (new Set(planTargetIds).size !== planTargetIds.length) throw new Error("Full Playwright repair plan contains duplicate targets.");
  assertExactSet(planTargetIds, [profile.targetId], "planned and authorized target inventory");
  const configuredTarget = options.config.targets[profile.targetId];
  const plannedTarget = options.plan.targets.find((target) => target.id === profile.targetId)!;
  if (!configuredTarget || !declaredTargetUrls(configuredTarget).includes(plannedTarget.url)) {
    throw new Error(`Playwright repair target URL is not an exact configured destination for ${profile.targetId}.`);
  }
  const affected = new Set(options.finding.affectedContracts);
  for (const contractId of affected) {
    if (!profileContractIds.includes(contractId)) throw new Error(`Finding contract ${contractId} is outside the authorized full profile.`);
  }
  if (options.finding.affectedObligationIds.length === 0 || options.finding.affectedAssertions.length === 0) {
    throw new Error("Hive repair validation finding requires exact obligation and screenshot assertion identities.");
  }
  if (new Set(options.finding.affectedObligationIds).size !== options.finding.affectedObligationIds.length) {
    throw new Error("Hive repair validation finding contains duplicate obligation identities.");
  }
  const findingAssertionKeys = options.finding.affectedAssertions.map((assertion) => canonicalSha256(assertion));
  if (new Set(findingAssertionKeys).size !== findingAssertionKeys.length) {
    throw new Error("Hive repair validation finding contains duplicate screenshot assertion identities.");
  }
  const affectedObligations: VisualHiveTaskContext["obligations"] = [];
  for (const obligationId of options.finding.affectedObligationIds) {
    const obligation = task.obligations.find((candidate) => candidate.obligationId === obligationId);
    if (!obligation || obligation.authority !== "deterministic") throw new Error(`Finding obligation ${obligationId} is not a declared deterministic obligation.`);
    if (!obligation.mappedContractIds.some((contractId) => affected.has(contractId))) throw new Error(`Finding obligation ${obligationId} is not mapped to an affected contract.`);
    if (!isExecutableScreenshotObligation(obligation)) {
      throw new Error(`Finding obligation ${obligationId} has no executable route, state, viewport, or mapped status.`);
    }
    affectedObligations.push(obligation);
  }
  for (const assertion of options.finding.affectedAssertions) {
    if (!affected.has(assertion.contractId)) throw new Error(`Finding assertion ${assertion.contractId}/${assertion.screenshotName} is outside the affected contracts.`);
    const contract = options.config.contracts.find((candidate) => candidate.id === assertion.contractId);
    const screenshot = contract?.screenshots.find((candidate) => candidate.name === assertion.screenshotName && candidate.route === assertion.route && candidate.viewport === assertion.viewportId);
    if (!screenshot) throw new Error(`Finding assertion ${assertion.contractId}/${assertion.screenshotName} is not declared by the authorized config.`);
    if (!profile.scenarioIds.includes(assertion.state) || !profile.routes.includes(assertion.route) || !profile.viewports.some((viewport) => viewport.viewportId === assertion.viewportId)) {
      throw new Error(`Finding assertion ${assertion.contractId}/${assertion.screenshotName} is outside the authorized execution matrix.`);
    }
    const matchingObligations = affectedObligations.filter((obligation) => obligationMatchesAssertion(obligation, assertion));
    if (matchingObligations.length === 0) {
      throw new Error(`Finding assertion ${assertion.contractId}/${assertion.screenshotName} does not match an affected obligation's contract, route, state, and viewport.`);
    }
  }
  for (const obligation of affectedObligations) {
    if (!options.finding.affectedAssertions.some((assertion) => obligationMatchesAssertion(obligation, assertion))) {
      throw new Error(`Finding obligation ${obligation.obligationId} does not bind an affected screenshot assertion at its declared route, state, and viewport.`);
    }
  }
  const deterministicObligations = task.obligations.filter((candidate) => candidate.authority === "deterministic");
  if (deterministicObligations.length === 0) throw new Error("Playwright repair capture requires a deterministic visual obligation.");
  for (const obligation of deterministicObligations) {
    for (const contractId of obligation.mappedContractIds) {
      if (!profileContractIds.includes(contractId)) throw new Error(`Deterministic obligation contract ${contractId} is outside the full profile.`);
      const contract = options.config.contracts.find((candidate) => candidate.id === contractId);
      if (!contract?.screenshots.length) throw new Error(`Deterministic visual obligation contract ${contractId} has no screenshot capture.`);
    }
  }

  const cases = deriveExecutionCases(options.config, options.plan, profile);
  const thresholds = profileContractIds.map((contractId) => ({
    contractId,
    maxDiffPixelRatio: options.config.visual.maxDiffPixelRatio,
    ...(options.config.visual.maxDiffPixels === undefined ? {} : { maxDiffPixels: options.config.visual.maxDiffPixels }),
    missingBaseline: "fail" as const
  }));
  const configDigest = canonicalSha256(options.config);
  if (authorization.configDigest !== configDigest) {
    throw new Error("Candidate Visual Hive config does not match the Hive-authorized base config digest.");
  }
  const planDigest = canonicalSha256(options.plan);
  const testPlanVersion = `visual-hive.playwright-repair-plan.v1:${canonicalSha256({
    profileId: profile.profileId,
    profileDigest: profile.profileDigest,
    configDigest,
    planDigest,
    cases,
    thresholds
  })}`;
  const baseline = await baselineInventory(rootDir, options.config);
  const baselineIdentityDigest = canonicalSha256(baseline.records);
  const captureInputDigest = canonicalSha256({
    schemaVersion: "visual-hive.playwright-repair-capture-input.v1",
    phase: options.phase,
    taskContextDigest: task.contextDigest,
    requestDigest: request.requestDigest,
    authorizationDigest: authorization.authorizationDigest,
    budgetDigest: authorization.budgetDigest,
    finding: options.finding,
    producer: options.producer,
    source: captureSourceIdentity(options.source),
    configDigest,
    planDigest,
    baselineIdentityDigest,
    execution: { runTargetCommands: true, skipInstall: false, skipBuild: false },
    acmmRequest: options.acmmRequest ?? 5
  });
  return {
    task,
    request,
    authorization,
    budgetLimits,
    cases,
    thresholds,
    configDigest,
    planDigest,
    testPlanVersion,
    baselineIdentityDigest,
    missingBaselines: baseline.missing,
    profile,
    captureInputDigest,
    captureDeadlineAtMs: Date.now() + Math.min(budgetLimits.maxWallSeconds * 1000, authorizationRemainingMs)
  };
}

function trustedNow(options: Pick<RunPlaywrightRepairCaptureOptions, "now">): Date {
  const value = options.now?.() ?? new Date();
  if (!Number.isFinite(value.getTime())) throw new Error("Playwright repair capture trusted clock is invalid.");
  return value;
}

function assertCaptureStillAuthorized(inputs: CaptureInputs, completedAt: Date): void {
  const completedAtMs = completedAt.getTime();
  if (completedAtMs < Date.parse(inputs.authorization.issuedAt) || completedAtMs > Date.parse(inputs.authorization.expiresAt)) {
    throw new Error("Hive execution authorization expired before Playwright repair capture completed.");
  }
  if (Date.now() > inputs.captureDeadlineAtMs) {
    throw new Error("Playwright repair capture exceeded its authorized wall-clock deadline.");
  }
}

function captureSourceIdentity(source: PlaywrightRepairCaptureSource): Record<string, unknown> {
  return {
    ref: source.ref,
    event: source.event,
    workflowName: source.workflowName ?? null,
    workflowRunId: source.workflowRunId ?? null,
    workflowRunAttempt: source.workflowRunAttempt ?? null,
    workflowArtifactId: source.workflowArtifactId ?? null,
    trusted: source.trusted
  };
}

async function executeCapture(
  options: RunPlaywrightRepairCaptureOptions,
  inputs: CaptureInputs,
  rootDir: string,
  runDirectory: string,
  executionDirectory: string,
  completionPath: string,
  intentPath: string
): Promise<PlaywrightRepairCaptureResult> {
  // This namespace is generated only after the repository lifecycle has been
  // authorized. The runner creates it after lifecycle commands complete, so
  // target code cannot pre-seed a result at a predictable durable path.
  // Keep the ephemeral execution root beside (not beneath) the digest-heavy
  // immutable run directory so ordinary Windows installations stay well below
  // MAX_PATH even when result filenames are appended. The HMAC nonce remains
  // a separate full 256-bit secret generated inside the runner.
  const artifactDir = relativeJoin(executionDirectory, "artifacts");
  const generatedDir = relativeJoin(executionDirectory, "generated");
  const playwrightOutputDir = relativeJoin(executionDirectory, "playwright-results");
  const runtimeIdentityPath = relativeJoin(executionDirectory, "runtime.json");
  const reportPath = relativeJoin(runDirectory, "report.json");
  const runContextPath = relativeJoin(runDirectory, "run-context.json");
  const metadataPath = relativeJoin(runDirectory, "capture-metadata.json");
  const runConfig: VisualHiveConfig = {
    ...options.config,
    visual: { ...options.config.visual, artifactDir }
  };
  const startedAt = trustedNow(options).toISOString();
  const executed = await runPlaywrightContracts({
    rootDir,
    config: runConfig,
    plan: options.plan,
    ci: true,
    generatedOutputDir: resolveRelative(rootDir, generatedDir),
    runtimeSidecarPath: resolveRelative(rootDir, runtimeIdentityPath),
    playwrightOutputDir,
    runTargetCommands: true,
    skipInstall: false,
    skipBuild: false,
    processTimeoutMs: Math.min(inputs.budgetLimits.maxWallSeconds * 1000, 10 * 60 * 1000),
    maxProcessOutputBytes: Math.min(inputs.budgetLimits.maxInputBytes, 16 * 1024 * 1024),
    deadlineAtMs: inputs.captureDeadlineAtMs,
    repairBinding: {
      captureInputDigest: inputs.captureInputDigest,
      requestId: inputs.request.requestId,
      requestDigest: inputs.request.requestDigest,
      phase: options.phase,
      commitSha: inputs.request.commitSha
    }
  });
  const completedAtDate = trustedNow(options);
  assertCaptureStillAuthorized(inputs, completedAtDate);
  const completedAt = completedAtDate.toISOString();
  await assertExpectedHead(rootDir, inputs.request.commitSha);
  await assertTrackedTreeUnchanged(rootDir);
  const completedBaseline = await baselineInventory(rootDir, options.config);
  if (canonicalSha256(completedBaseline.records) !== inputs.baselineIdentityDigest) {
    throw new Error("Approved screenshot baseline identity changed during Playwright repair capture.");
  }

  const report = normalizeReport(executed.report, rootDir, inputs.task, inputs.request.commitSha, options.source, reportPath);
  await rewriteStructuredResults(rootDir, artifactDir, report, executed.executionBinding);
  const runtime = await loadRuntimeSidecarOrBlocked(rootDir, runtimeIdentityPath, executed.report.status, completedAt, executed.executionBinding);
  if (Date.parse(runtime.capturedAt) < Date.parse(startedAt) || Date.parse(runtime.capturedAt) > Date.parse(completedAt)) {
    throw new Error("Playwright runtime sidecar timestamp falls outside the executed command window.");
  }
  if (runtime.browser.name !== "unavailable" && inputs.cases.some((executionCase) => executionCase.viewport.deviceScaleFactor !== runtime.environment.deviceScaleFactor)) {
    throw new Error("Playwright runtime device scale factor does not match the authorized execution matrix.");
  }
  const evidenceAssets = await buildEvidenceAssets(rootDir, report, inputs.task, inputs.cases, options.phase, inputs.budgetLimits);
  const capture = deriveCaptureStatus(report, inputs.missingBaselines, runtime.browser.name !== "unavailable", executed.exitCode);
  const reportBytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFileExclusive(rootDir, reportPath, reportBytes);

  const executionContractIds = sortedUnique(inputs.cases.flatMap((executionCase) => executionCase.contractIds));
  const runContext = buildVisualRunContext({
    schemaVersion: "visual-hive.run-context.v1",
    digestAlgorithm: "visual-hive.canonical-json.sha256.v1",
    generatedAt: completedAt,
    runId: `run.${inputs.request.requestId}`,
    phase: options.phase,
    taskId: inputs.task.taskId,
    taskContextDigest: inputs.task.contextDigest,
    findingFingerprint: options.finding.fingerprint,
    repository: {
      name: inputs.task.repository.name,
      ...(inputs.task.repository.repositoryId ? { repositoryId: inputs.task.repository.repositoryId } : {}),
      repositoryFingerprint: inputs.task.repository.repositoryFingerprint,
      commitSha: inputs.request.commitSha
    },
    brokerRequest: { requestId: inputs.request.requestId, requestDigest: inputs.request.requestDigest },
    execution: {
      commitSha: inputs.request.commitSha,
      profileId: inputs.profile.profileId,
      profileDigest: inputs.profile.profileDigest,
      configDigest: inputs.configDigest,
      validationPolicyDigest: computeVisualValidationPolicyDigest(inputs.profile.validationCommandId, inputs.thresholds),
      contractInventoryDigest: canonicalSha256(executionContractIds),
      planDigest: inputs.planDigest,
      testPlanDigest: canonicalSha256(inputs.testPlanVersion),
      toolRegistryDigest: PLAYWRIGHT_REPAIR_VALIDATION_TOOL_REGISTRY_DIGEST,
      baselineIdentityDigest: inputs.baselineIdentityDigest,
      executionMatrixDigest: canonicalSha256(inputs.cases),
      browser: runtime.browser,
      environment: {
        os: bounded(runtime.environment.os, 128),
        architecture: bounded(runtime.environment.architecture, 128),
        nodeVersion: bounded(runtime.environment.nodeVersion, 128),
        playwrightVersion: bounded(runtime.environment.playwrightVersion, 128),
        fontManifestDigest: canonicalSha256({
          fonts: runtime.environment.fonts,
          userAgent: runtime.environment.userAgent,
          deviceScaleFactor: runtime.environment.deviceScaleFactor
        }),
        locale: bounded(runtime.environment.locale, 128),
        timezone: bounded(runtime.environment.timezone, 128)
      },
      cases: inputs.cases
    },
    producer: {
      visualHiveVersion: options.producer.visualHiveVersion,
      visualHiveCommit: options.producer.visualHiveCommit,
      manifestSha256: options.producer.manifestSha256,
      entrypointSha256: options.producer.entrypointSha256,
      playwrightVersion: runtime.environment.playwrightVersion
    },
    command: {
      validationCommandId: inputs.profile.validationCommandId,
      startedAt,
      completedAt,
      exitCode: executed.exitCode,
      executionBinding: executed.executionBinding
    },
    report: { path: reportPath, sha256: sha256Bytes(reportBytes) },
    evidenceAssets,
    thresholds: inputs.thresholds,
    capture
  });
  await writeJsonExclusive(rootDir, runContextPath, runContext);

  const resultArtifactPaths = await listRelativeFiles(rootDir, relativeJoin(artifactDir, "results"), inputs.budgetLimits);
  const screenshotSupportPaths = sortedUnique(evidenceAssets.map((asset) => asset.path));
  const metadata = {
    schemaVersion: "visual-hive.playwright-repair-capture.v1",
    generatedAt: completedAt,
    phase: options.phase,
    taskId: inputs.task.taskId,
    taskContextDigest: inputs.task.contextDigest,
    captureInputDigest: inputs.captureInputDigest,
    request: {
      requestId: inputs.request.requestId,
      requestDigest: inputs.request.requestDigest,
      kind: inputs.request.kind,
      commitRole: inputs.request.commitRole,
      commitSha: inputs.request.commitSha,
      profileId: inputs.request.profileId,
      profileDigest: inputs.request.profileDigest
    },
    execution: {
      configDigest: inputs.configDigest,
      planDigest: inputs.planDigest,
      testPlanVersion: inputs.testPlanVersion,
      testPlanDigest: canonicalSha256(inputs.testPlanVersion),
      toolRegistryVersion: PLAYWRIGHT_REPAIR_VALIDATION_TOOL_REGISTRY_VERSION,
      toolRegistryDigest: PLAYWRIGHT_REPAIR_VALIDATION_TOOL_REGISTRY_DIGEST,
      baselineIdentityDigest: inputs.baselineIdentityDigest,
      missingBaselines: inputs.missingBaselines,
      cases: inputs.cases,
      thresholds: inputs.thresholds
    },
    producer: options.producer,
    outputs: { executionDirectory, reportPath, runContextPath, runtimeIdentityPath, artifactDir },
    executionBinding: executed.executionBinding
  };
  await writeJsonExclusive(rootDir, metadataPath, metadata);

  const artifactPaths = sortedUnique([
    reportPath,
    runContextPath,
    runtimeIdentityPath,
    metadataPath,
    intentPath,
    ...resultArtifactPaths,
    ...screenshotSupportPaths
  ]);
  await validateArtifactInventory(rootDir, artifactPaths, inputs.budgetLimits);
  const reportedFindingState = (capture.status === "passed" || (options.phase === "before" && capture.status === "failed"))
    ? findingStateFromReport(report, options.finding)
    : "present";
  // Until a broker-authenticated target/executor receipt exists, a passing
  // advisory observation cannot publish lifecycle absence or close a finding.
  const targetExecutionAuthoritativeForResolution = false;
  const findingState = targetExecutionAuthoritativeForResolution ? reportedFindingState : "present";
  const { affectedAssertions: _affectedAssertions, affectedObligationIds: _affectedObligationIds, ...publicationFinding } = options.finding;
  void _affectedAssertions;
  void _affectedObligationIds;
  const observation: VisualHiveBundleObservation = {
    ...publicationFinding,
    state: findingState,
    sourceArtifacts: sortedUnique([...options.finding.sourceArtifacts, reportPath, ...screenshotSupportPaths]),
    validationCommand: inputs.profile.validationCommandId,
    observedAt: completedAt,
    sourceArtifact: reportPath
  };
  assertCaptureStillAuthorized(inputs, trustedNow(options));
  await ensureSafeRelativeDirectory(rootDir, relativeJoin(runDirectory, "bundle"));
  const bundle = await writeVisualHiveBundle({
    rootDir,
    project: options.config.project.name,
    mode: "full",
    verdict: report.status,
    acmmRequest: options.acmmRequest ?? 5,
    artifacts: artifactPaths,
    artifactLimits: {
      maxFiles: MAX_REPAIR_ARTIFACT_FILES,
      maxFileBytes: Math.min(MAX_REPAIR_ARTIFACT_BYTES, Math.max(inputs.budgetLimits.maxInputBytes, inputs.budgetLimits.maxImageBytes)),
      maxTotalBytes: Math.min(MAX_REPAIR_ARTIFACT_TOTAL_BYTES, inputs.budgetLimits.maxInputBytes + inputs.budgetLimits.maxImageBytes)
    },
    source: {
      repository: inputs.task.repository.name,
      ...(inputs.task.repository.repositoryId ? { repositoryId: inputs.task.repository.repositoryId } : {}),
      ref: options.source.ref,
      commitSha: inputs.request.commitSha,
      event: options.source.event,
      ...(options.source.workflowName ? { workflowName: options.source.workflowName } : {}),
      ...(options.source.workflowRunId ? { workflowRunId: options.source.workflowRunId } : {}),
      ...(options.source.workflowRunAttempt ? { workflowRunAttempt: options.source.workflowRunAttempt } : {}),
      ...(options.source.workflowArtifactId ? { workflowArtifactId: options.source.workflowArtifactId } : {}),
      conclusion: report.status,
      trusted: options.source.trusted
    },
    scan: {
      scope: "full",
      // A verified browser run proves what the runner observed, but it does not
      // prove that a mutable URL or an unsandboxed local target came from the
      // requested commit. Re-enable resolution authority only when a future
      // broker supplies a separately verified target/executor receipt.
      authoritativeForResolution: targetExecutionAuthoritativeForResolution,
      evaluatedContracts: executionContractIds,
      evaluatedFiles: sortedUnique(inputs.task.sourceContext.files.map((file) => file.path)),
      testPlanVersion: inputs.testPlanVersion,
      toolRegistryVersion: PLAYWRIGHT_REPAIR_VALIDATION_TOOL_REGISTRY_VERSION
    },
    observations: [observation],
    producerVersion: options.producer.visualHiveVersion,
    producerGitCommit: options.producer.visualHiveCommit,
    externalCallsMade: 0,
    outputDir: relativeJoin(runDirectory, "bundle"),
    bundleId: `repair-${options.phase}-${inputs.request.requestId.slice(0, 24)}`,
    purpose: "repair-validation",
    now: new Date(completedAt)
  });
  if (!verifyVisualHiveBundleDigest(bundle.manifest)) throw new Error("Generated Playwright repair bundle failed its publication-digest verification.");

  const receiptDigest = canonicalSha256({
    schemaVersion: "visual-hive.playwright-repair-capture-receipt.v1",
    phase: options.phase,
    requestId: inputs.request.requestId,
    requestDigest: inputs.request.requestDigest,
    captureInputDigest: inputs.captureInputDigest,
    commitSha: inputs.request.commitSha,
    runContextDigest: runContext.runContextDigest,
    bundleDigest: bundle.manifest.overallDigest,
    captureStatus: capture.status,
    exitCode: runContext.command.exitCode
  });
  const completion: CaptureCompletion = {
    schemaVersion: "visual-hive.playwright-repair-capture-completion.v1",
    phase: options.phase,
    requestId: inputs.request.requestId,
    requestDigest: inputs.request.requestDigest,
    captureInputDigest: inputs.captureInputDigest,
    commitSha: inputs.request.commitSha,
    captureStatus: capture.status,
    exitCode: runContext.command.exitCode,
    receiptDigest,
    runDirectory,
    reportPath,
    reportSha256: runContext.report.sha256,
    runContextPath,
    runContextDigest: runContext.runContextDigest,
    runtimeIdentityPath,
    metadataPath,
    bundleManifestPath: bundle.manifestPath,
    bundleDirectory: bundle.bundleDir,
    bundleDigest: bundle.manifest.overallDigest,
    artifactPaths,
    completedAt
  };
  assertCaptureStillAuthorized(inputs, trustedNow(options));
  await writeJsonExclusive(rootDir, completionPath, completion);
  return materializeResult(completion, false, report, runContext, bundle.manifest, completionPath);
}

function deriveExecutionCases(
  config: VisualHiveConfig,
  plan: Plan,
  profile: VisualHiveTaskContext["profiles"][number]
): VisualExecutionCase[] {
  const state = profile.scenarioIds[0] ?? "default";
  const profileRoutes = new Set(profile.routes);
  const profileViewports = new Map(profile.viewports.map((viewport) => [viewport.viewportId, viewport]));
  const grouped = new Map<string, Omit<VisualExecutionCase, "caseId" | "contractIds"> & { contractIds: string[] }>();
  const planItems = new Map(plan.items.map((item) => [item.contractId, item]));
  for (const contract of config.contracts) {
    const item = planItems.get(contract.id);
    if (!item || item.targetId !== contract.target || contract.target !== profile.targetId) {
      throw new Error(`Full Playwright plan target binding is invalid for ${contract.id}.`);
    }
    const plannedTarget = plan.targets.find((target) => target.id === contract.target);
    if (!plannedTarget || plannedTarget.url !== item.targetUrl) throw new Error(`Full Playwright plan URL binding is invalid for ${contract.id}.`);
    const routes = [
      { route: contract.screenshots[0]?.route ?? "/", viewportId: "desktop" },
      ...contract.steps.filter((step) => step.action === "goto").map((step) => ({ route: step.route!, viewportId: "desktop" })),
      ...contract.screenshots.map((screenshot) => ({ route: screenshot.route, viewportId: screenshot.viewport }))
    ];
    for (const candidate of routes) {
      const configuredViewport = config.viewports[candidate.viewportId] ?? (candidate.viewportId === "desktop" ? { width: 1440, height: 900 } : undefined);
      const authorizedViewport = profileViewports.get(candidate.viewportId);
      if (!configuredViewport || !authorizedViewport || configuredViewport.width !== authorizedViewport.width || configuredViewport.height !== authorizedViewport.height) {
        throw new Error(`Executed viewport ${candidate.viewportId} for ${contract.id} does not match the authorized profile.`);
      }
      if (!profileRoutes.has(candidate.route)) throw new Error(`Executed route ${candidate.route} for ${contract.id} is outside the authorized profile.`);
      const viewport = {
        viewportId: candidate.viewportId,
        width: configuredViewport.width,
        height: configuredViewport.height,
        deviceScaleFactor: authorizedViewport.deviceScaleFactor
      };
      const key = canonicalSha256({ targetId: contract.target, route: candidate.route, state, viewport });
      const existing = grouped.get(key);
      if (existing) existing.contractIds.push(contract.id);
      else grouped.set(key, { targetId: contract.target, route: candidate.route, state, viewport, contractIds: [contract.id] });
    }
  }
  const cases = [...grouped.entries()].map(([identity, executionCase]) => ({
    ...executionCase,
    caseId: `case.${identity.slice(0, 24)}`,
    contractIds: sortedUnique(executionCase.contractIds)
  })).sort((left, right) => stableTextCompare(left.caseId, right.caseId));
  assertExactSet(sortedUnique(cases.map((item) => item.route)), sortedUnique(profile.routes), "executed and authorized route inventory");
  assertExactSet(
    sortedUnique(cases.map((item) => item.viewport.viewportId)),
    sortedUnique(profile.viewports.map((viewport) => viewport.viewportId)),
    "executed and authorized viewport inventory"
  );
  return cases;
}

async function baselineInventory(
  rootDir: string,
  config: VisualHiveConfig
): Promise<{ records: Array<{ path: string; sha256: string | null; size: number | null }>; missing: string[] }> {
  const snapshotRoot = relativeJoin(
    config.visual.snapshotDir,
    ...(config.visual.baselinePlatform === "platform" ? [process.platform] : [])
  );
  const paths = config.contracts.flatMap((contract) => contract.screenshots.map((screenshot) =>
    relativeJoin(snapshotRoot, `${safeName(contract.id)}__${safeName(screenshot.name)}__${safeName(screenshot.viewport)}.png`)
  ));
  if (new Set(paths).size !== paths.length) throw new Error("Configured screenshot assertions collide on one baseline path.");
  const records: Array<{ path: string; sha256: string | null; size: number | null }> = [];
  const missing: string[] = [];
  for (const baselinePath of paths.sort(stableTextCompare)) {
    if (!await exists(resolveRelative(rootDir, baselinePath))) {
      missing.push(baselinePath);
      records.push({ path: baselinePath, sha256: null, size: null });
      continue;
    }
    const bytes = await readRegularContainedFile(rootDir, baselinePath, MAX_REPAIR_IMAGE_BYTES);
    inspectVisualImageBytes(bytes);
    records.push({ path: baselinePath, sha256: sha256Bytes(bytes), size: bytes.byteLength });
  }
  return { records, missing };
}

function normalizeReport(
  input: Report,
  rootDir: string,
  task: VisualHiveTaskContext,
  commitSha: string,
  source: PlaywrightRepairCaptureSource,
  reportPath: string
): Report {
  return {
    ...input,
    outputResource: input.outputResource ? { ...input.outputResource, artifactPath: reportPath } : undefined,
    repository: {
      provider: process.env.GITHUB_ACTIONS === "true" ? "github-actions" : "local",
      repository: task.repository.name,
      owner: task.repository.name.split("/")[0],
      repo: task.repository.name.split("/")[1],
      commitSha,
      runId: source.workflowRunId,
      runAttempt: source.workflowRunAttempt,
      workflow: source.workflowName
    },
    generatedSpecPath: repositoryRelativePath(input.generatedSpecPath, rootDir),
    artifacts: sortedUnique(input.artifacts.map((artifact) => repositoryRelativePath(artifact, rootDir))),
    results: input.results.map((result) => normalizeContractResult(result, rootDir)),
    targetLifecycle: input.targetLifecycle.map((event) => ({
      ...event,
      message: event.message ? scrubRepositoryRoot(event.message, rootDir) : undefined
    })),
    consoleErrors: input.consoleErrors.map((message) => scrubRepositoryRoot(message, rootDir)),
    pageErrors: input.pageErrors.map((error) => ({ ...error, message: scrubRepositoryRoot(error.message, rootDir) })),
    verdictContributions: input.verdictContributions?.map((contribution) => ({
      ...contribution,
      reason: scrubRepositoryRoot(contribution.reason, rootDir),
      artifacts: contribution.artifacts.map((artifact) =>
        artifact === ".visual-hive/report.json" ? reportPath : repositoryRelativePath(artifact, rootDir)
      )
    }))
  };
}

function normalizeContractResult(result: ContractResult, rootDir: string): ContractResult {
  return {
    ...result,
    errors: result.errors.map((message) => scrubRepositoryRoot(message, rootDir)),
    artifacts: sortedUnique(result.artifacts.map((artifact) => repositoryRelativePath(artifact, rootDir))),
    screenshotAssertions: result.screenshotAssertions?.map((screenshot) => ({
      ...screenshot,
      baselinePath: repositoryRelativePath(screenshot.baselinePath, rootDir),
      actualPath: repositoryRelativePath(screenshot.actualPath, rootDir),
      diffPath: screenshot.diffPath ? repositoryRelativePath(screenshot.diffPath, rootDir) : undefined,
      message: screenshot.message ? scrubRepositoryRoot(screenshot.message, rootDir) : undefined
    })),
    selectorAssertions: result.selectorAssertions?.map((assertion) => ({
      ...assertion,
      message: assertion.message ? scrubRepositoryRoot(assertion.message, rootDir) : undefined
    })),
    flowSteps: result.flowSteps?.map((step) => ({ ...step, message: step.message ? scrubRepositoryRoot(step.message, rootDir) : undefined })),
    consoleErrors: result.consoleErrors?.map((error) => ({ ...error, message: scrubRepositoryRoot(error.message, rootDir) })),
    pageErrors: result.pageErrors?.map((error) => ({ ...error, message: scrubRepositoryRoot(error.message, rootDir) }))
  };
}

async function rewriteStructuredResults(
  rootDir: string,
  artifactDir: string,
  report: Report,
  executionBinding: PlaywrightExecutionBinding
): Promise<void> {
  const resultsDirectory = resolveRelative(rootDir, relativeJoin(artifactDir, "results"));
  if (!await exists(resultsDirectory)) return;
  const reportResults = new Map(report.results.map((result) => [result.contractId, result]));
  for (const entry of await readdir(resultsDirectory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const absolute = path.join(resultsDirectory, entry.name);
    const relative = repositoryRelativePath(absolute, rootDir);
    const envelope = JSON.parse((await readRegularContainedFile(rootDir, relative, MAX_REPAIR_JSON_BYTES)).toString("utf8")) as {
      schemaVersion?: unknown;
      executionBinding?: unknown;
      result?: unknown;
    };
    if (envelope.schemaVersion !== "visual-hive.playwright-contract-result.v1" || !sameExecutionBinding(envelope.executionBinding, executionBinding) || !isPlainRecord(envelope.result)) {
      throw new Error(`Playwright repair structured result has an invalid execution binding: ${entry.name}.`);
    }
    const parsed = envelope.result as unknown as ContractResult;
    if (typeof parsed.contractId !== "string") throw new Error(`Playwright repair structured result has no contract identity: ${entry.name}.`);
    const normalized = reportResults.get(parsed.contractId) ?? normalizeContractResult(parsed, rootDir);
    await overwriteRegularContainedFile(rootDir, relative, Buffer.from(`${JSON.stringify({
      schemaVersion: "visual-hive.playwright-contract-result.v1",
      executionBinding,
      result: normalized
    }, null, 2)}\n`, "utf8"));
  }
}

async function buildEvidenceAssets(
  rootDir: string,
  report: Report,
  task: VisualHiveTaskContext,
  cases: VisualExecutionCase[],
  phase: "before" | "after",
  budgetLimits: HiveRepairBudgetLimits
): Promise<VisualRunEvidenceAsset[]> {
  const assets: VisualRunEvidenceAsset[] = [];
  const seenPaths = new Set<string>();
  for (const result of report.results) {
    for (const screenshot of result.screenshotAssertions ?? []) {
      if (screenshot.contractId !== result.contractId) {
        throw new Error(`Screenshot ${screenshot.screenshotName} does not match its structured contract result ${result.contractId}.`);
      }
      const matchingCases = cases.filter((candidate) =>
        candidate.contractIds.includes(result.contractId) && candidate.route === screenshot.route && candidate.viewport.viewportId === screenshot.viewport
      );
      if (matchingCases.length !== 1) throw new Error(`Screenshot ${result.contractId}/${screenshot.screenshotName} must have exactly one executed case identity.`);
      const executionCase = matchingCases[0]!;
      const assertion = {
        contractId: result.contractId,
        screenshotName: screenshot.screenshotName,
        route: screenshot.route,
        state: executionCase.state,
        viewportId: screenshot.viewport
      };
      const obligationIds = sortedUnique(task.obligations
        .filter((obligation) => isExecutableScreenshotObligation(obligation) && obligationMatchesAssertion(obligation, assertion))
        .map((obligation) => obligation.obligationId));
      const addAsset = async (role: "baseline" | "actual" | "diff", artifactPath: string): Promise<void> => {
        const normalizedPath = RelativeArtifactPathSchema.parse(artifactPath);
        if (seenPaths.has(normalizedPath)) throw new Error(`Playwright repair capture reused screenshot evidence path ${normalizedPath}.`);
        seenPaths.add(normalizedPath);
        const bytes = await readRegularContainedFile(rootDir, normalizedPath, Math.min(MAX_REPAIR_IMAGE_BYTES, budgetLimits.maxImageBytes));
        const image = inspectVisualImageBytes(bytes);
        const sha256 = sha256Bytes(bytes);
        assets.push({
          assetId: `asset.${phase}.${role}.${canonicalSha256({ normalizedPath, sha256, assertion }).slice(0, 24)}`,
          role,
          path: normalizedPath,
          mediaType: image.mediaType,
          sha256,
          size: bytes.byteLength,
          width: image.width,
          height: image.height,
          assertion,
          obligationIds
        });
      };
      if (await exists(resolveRelative(rootDir, screenshot.baselinePath))) await addAsset("baseline", screenshot.baselinePath);
      await addAsset("actual", screenshot.actualPath);
      if (screenshot.diffPath) await addAsset("diff", screenshot.diffPath);
    }
  }
  return assets.sort((left, right) => stableTextCompare(left.assetId, right.assetId));
}

function isExecutableScreenshotObligation(obligation: VisualHiveTaskContext["obligations"][number]): boolean {
  return obligation.route !== undefined && obligation.state !== undefined && obligation.viewportId !== undefined &&
    obligation.mappedContractIds.length > 0 && ["mapped", "executed", "passed", "failed"].includes(obligation.status);
}

function obligationMatchesAssertion(
  obligation: VisualHiveTaskContext["obligations"][number],
  assertion: PlaywrightRepairCaptureAssertionIdentity
): boolean {
  return obligation.mappedContractIds.includes(assertion.contractId) && obligation.route === assertion.route &&
    obligation.state === assertion.state && obligation.viewportId === assertion.viewportId;
}

function deriveCaptureStatus(
  report: Report,
  missingBaselines: string[],
  runtimeAvailable: boolean,
  processExitCode: number
): { status: "passed" | "failed" | "blocked"; failures: string[] } {
  const missingFromReport = report.results.flatMap((result) => result.screenshotAssertions ?? [])
    .filter((screenshot) => screenshot.status === "missing_baseline")
    .map((screenshot) => `Missing approved screenshot baseline: ${screenshot.baselinePath}.`);
  const failures = sortedUnique([
    ...(runtimeAvailable ? [] : ["Playwright browser/runtime identity was unavailable."]),
    ...(processExitCode === 0 ? [] : [`Playwright process exited with code ${processExitCode}.`]),
    ...missingBaselines.map((baselinePath) => `Missing approved screenshot baseline: ${baselinePath}.`),
    ...missingFromReport,
    ...report.targetLifecycle.filter((event) => event.status === "failed").map((event) => event.message ?? `${event.targetId} ${event.phase} failed.`),
    ...report.results.filter((result) => result.status !== "passed").flatMap((result) =>
      result.errors.length ? result.errors : [`Contract ${result.contractId} ${result.status}.`]
    )
  ]).map((failure) => bounded(failure, 1024));
  if (!runtimeAvailable || missingBaselines.length > 0 || missingFromReport.length > 0) return { status: "blocked", failures };
  if (processExitCode !== 0 || report.status === "failed") return { status: "failed", failures: failures.length ? failures : ["Playwright repair capture failed."] };
  return { status: "passed", failures: [] };
}

function findingStateFromReport(report: Report, finding: PlaywrightRepairCaptureFinding): "present" | "absent" {
  const results = new Map(report.results.map((result) => [result.contractId, result]));
  for (const contractId of finding.affectedContracts) {
    if (!results.has(contractId)) throw new Error(`Finding contract ${contractId} was not evaluated by the full report.`);
  }
  let present = false;
  for (const expected of finding.affectedAssertions) {
    const matches = (results.get(expected.contractId)?.screenshotAssertions ?? []).filter((assertion) =>
      assertion.contractId === expected.contractId && assertion.screenshotName === expected.screenshotName &&
      assertion.route === expected.route && assertion.viewport === expected.viewportId
    );
    if (matches.length !== 1) throw new Error(`Finding assertion ${expected.contractId}/${expected.screenshotName} was not evaluated exactly once.`);
    if (matches[0]!.status === "failed" || matches[0]!.status === "missing_baseline") present = true;
  }
  return present ? "present" : "absent";
}

async function loadExistingCapture(
  options: RunPlaywrightRepairCaptureOptions,
  inputs: CaptureInputs,
  rootDir: string,
  runDirectory: string,
  completionPath: string
): Promise<PlaywrightRepairCaptureResult | undefined> {
  if (!await exists(resolveRelative(rootDir, runDirectory))) return undefined;
  if (!await exists(resolveRelative(rootDir, completionPath))) {
    const intentPath = relativeJoin(runDirectory, "capture-input.json");
    if (!await exists(resolveRelative(rootDir, intentPath))) {
      throw new PlaywrightRepairCaptureError(`Hive validation request ${inputs.request.requestId} has an incomplete directory without a verifiable capture intent.`, runDirectory);
    }
    const intent = await readJsonFile(rootDir, intentPath);
    if (!isPlainRecord(intent) || intent.schemaVersion !== "visual-hive.playwright-repair-capture-input.v1" || intent.captureInputDigest !== inputs.captureInputDigest) {
      throw new PlaywrightRepairCaptureError("Existing incomplete Playwright repair capture does not match the current effective input.", runDirectory);
    }
    const failurePath = relativeJoin(runDirectory, "capture-failure.json");
    const hasTerminalFailure = await exists(resolveRelative(rootDir, failurePath));
    const ownerPid = typeof intent.ownerPid === "number" && Number.isSafeInteger(intent.ownerPid) && intent.ownerPid > 0 ? intent.ownerPid : undefined;
    const leaseExpiresAt = typeof intent.leaseExpiresAt === "string" ? Date.parse(intent.leaseExpiresAt) : Number.NaN;
    if (!hasTerminalFailure && ownerPid !== undefined && processIsAlive(ownerPid) && Number.isFinite(leaseExpiresAt) && Date.now() < leaseExpiresAt) {
      throw new PlaywrightRepairCaptureError(`Hive validation request ${inputs.request.requestId} already has an active capture lease owned by PID ${ownerPid}.`, runDirectory);
    }
    await removeInterruptedExecutionDirectory(rootDir, runDirectory, intent.executionDirectory);
    await archiveInterruptedCapture(rootDir, runDirectory, inputs.captureInputDigest, hasTerminalFailure ? "failed" : "interrupted");
    return undefined;
  }
  const completion = await readJsonFile(rootDir, completionPath) as CaptureCompletion;
  if (
    completion.schemaVersion !== "visual-hive.playwright-repair-capture-completion.v1" ||
    completion.phase !== options.phase ||
    completion.requestId !== inputs.request.requestId ||
    completion.requestDigest !== inputs.request.requestDigest ||
    completion.captureInputDigest !== inputs.captureInputDigest ||
    completion.commitSha !== inputs.request.commitSha ||
    completion.runDirectory !== runDirectory
  ) {
    throw new PlaywrightRepairCaptureError("Existing immutable Playwright repair capture does not match the Hive request.", runDirectory);
  }
  const reportBytes = await readRegularContainedFile(rootDir, completion.reportPath, MAX_REPAIR_JSON_BYTES);
  if (sha256Bytes(reportBytes) !== completion.reportSha256) throw new Error("Existing Playwright repair report digest is invalid.");
  const report = JSON.parse(reportBytes.toString("utf8")) as Report;
  const runContext = parseVisualRunContext(await readJsonFile(rootDir, completion.runContextPath));
  const bundleManifest = await readJsonFile(rootDir, completion.bundleManifestPath) as VisualHiveBundleManifest;
  if (
    runContext.runContextDigest !== completion.runContextDigest ||
    runContext.report.sha256 !== completion.reportSha256 ||
    runContext.brokerRequest?.requestId !== inputs.request.requestId ||
    runContext.brokerRequest.requestDigest !== inputs.request.requestDigest ||
    bundleManifest.overallDigest !== completion.bundleDigest ||
    !verifyVisualHiveBundleDigest(bundleManifest)
  ) {
    throw new Error("Existing immutable Playwright repair capture failed digest or request verification.");
  }
  const expectedReceiptDigest = canonicalSha256({
    schemaVersion: "visual-hive.playwright-repair-capture-receipt.v1",
    phase: completion.phase,
    requestId: completion.requestId,
    requestDigest: completion.requestDigest,
    captureInputDigest: completion.captureInputDigest,
    commitSha: completion.commitSha,
    runContextDigest: completion.runContextDigest,
    bundleDigest: completion.bundleDigest,
    captureStatus: completion.captureStatus,
    exitCode: completion.exitCode
  });
  if (completion.receiptDigest !== expectedReceiptDigest || runContext.capture.status !== completion.captureStatus || runContext.command.exitCode !== completion.exitCode) {
    throw new Error("Existing immutable Playwright repair capture receipt is invalid.");
  }
  await validateArtifactInventory(rootDir, completion.artifactPaths, inputs.budgetLimits);
  for (const file of bundleManifest.files) {
    const sourceBytes = await readRegularContainedFile(rootDir, file.sourcePath);
    const bundledBytes = await readRegularContainedFile(rootDir, relativeJoin(completion.bundleDirectory, file.path));
    if (
      sourceBytes.byteLength !== file.size || sha256Bytes(sourceBytes) !== file.sha256 ||
      bundledBytes.byteLength !== file.size || sha256Bytes(bundledBytes) !== file.sha256
    ) {
      throw new Error(`Existing immutable Playwright repair bundle payload is invalid: ${file.sourcePath}.`);
    }
  }
  return materializeResult(completion, true, report, runContext, bundleManifest, completionPath);
}

async function removeInterruptedExecutionDirectory(rootDir: string, runDirectory: string, value: unknown): Promise<void> {
  if (typeof value !== "string") return;
  const executionDirectory = RelativeArtifactPathSchema.parse(value);
  const expectedParent = path.posix.dirname(runDirectory);
  if (path.posix.dirname(executionDirectory) !== expectedParent || !/^exec\.[a-f0-9]{24}$/u.test(path.posix.basename(executionDirectory))) {
    throw new PlaywrightRepairCaptureError("Interrupted Playwright repair capture names an invalid execution directory.", runDirectory);
  }
  const absolute = resolveRelative(rootDir, executionDirectory);
  if (!await exists(absolute)) return;
  await assertSafeRelativeDirectory(rootDir, executionDirectory);
  await rm(absolute, { recursive: true, force: false, maxRetries: 3, retryDelay: 100 });
}

async function archiveInterruptedCapture(rootDir: string, runDirectory: string, inputDigest: string, reason: "failed" | "interrupted"): Promise<void> {
  await assertSafeRelativeDirectory(rootDir, runDirectory);
  const parent = path.posix.dirname(runDirectory);
  const name = path.posix.basename(runDirectory);
  for (let ordinal = 1; ordinal <= 8; ordinal += 1) {
    const archive = relativeJoin(parent, `${name}.${reason}.${inputDigest.slice(0, 12)}.${ordinal}`);
    if (await exists(resolveRelative(rootDir, archive))) continue;
    const marker = relativeJoin(runDirectory, "capture-interruption.json");
    try {
      await writeJsonExclusive(rootDir, marker, {
        schemaVersion: "visual-hive.playwright-repair-capture-interruption.v1",
        recordedAt: new Date().toISOString(),
        reason,
        captureInputDigest: inputDigest,
        archivedAs: archive
      });
    } catch (error) {
      if (!isErrorCode(error, "EEXIST")) throw error;
    }
    await rename(resolveRelative(rootDir, runDirectory), resolveRelative(rootDir, archive));
    await assertSafeRelativeDirectory(rootDir, archive);
    return;
  }
  throw new PlaywrightRepairCaptureError("Playwright repair capture exceeded its bounded interrupted-attempt archive limit.", runDirectory);
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function materializeResult(
  completion: CaptureCompletion,
  reused: boolean,
  report: Report,
  runContext: VisualRunContext,
  bundleManifest: VisualHiveBundleManifest,
  completionPath: string
): PlaywrightRepairCaptureResult {
  return {
    schemaVersion: "visual-hive.playwright-repair-capture-result.v1",
    reused,
    phase: completion.phase,
    requestId: completion.requestId,
    requestDigest: completion.requestDigest,
    commitSha: completion.commitSha,
    captureStatus: completion.captureStatus,
    exitCode: completion.exitCode,
    receiptDigest: completion.receiptDigest,
    runDirectory: completion.runDirectory,
    reportPath: completion.reportPath,
    runContextPath: completion.runContextPath,
    runtimeIdentityPath: completion.runtimeIdentityPath,
    metadataPath: completion.metadataPath,
    completionPath,
    bundleManifestPath: completion.bundleManifestPath,
    bundleDirectory: completion.bundleDirectory,
    artifactPaths: completion.artifactPaths,
    report,
    runContext,
    bundleManifest
  };
}

async function loadRuntimeSidecarOrBlocked(
  rootDir: string,
  runtimeIdentityPath: string,
  reportStatus: Report["status"],
  completedAt: string,
  executionBinding: PlaywrightExecutionBinding
): Promise<RuntimeSidecar> {
  try {
    return parseRuntimeSidecar(await readJsonFile(rootDir, runtimeIdentityPath), executionBinding);
  } catch (error) {
    if (!isErrorCode(error, "ENOENT")) throw error;
    if (reportStatus !== "failed") throw new Error("A successful Playwright repair run did not produce runtime identity.");
    const fallback: RuntimeSidecar = {
      schemaVersion: "visual-hive.playwright-runtime.v1",
      executionBinding,
      capturedAt: completedAt,
      browser: { name: "unavailable", version: "unavailable" },
      environment: {
        os: `${process.platform} unavailable`,
        architecture: process.arch,
        nodeVersion: process.version,
        playwrightVersion: installedPlaywrightVersion(),
        locale: Intl.DateTimeFormat().resolvedOptions().locale || "und",
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "unknown",
        userAgent: "unavailable",
        deviceScaleFactor: 1,
        fonts: []
      }
    };
    await writeJsonExclusive(rootDir, runtimeIdentityPath, fallback);
    return fallback;
  }
}

function installedPlaywrightVersion(): string {
  try {
    return String((require("@playwright/test/package.json") as { version?: unknown }).version ?? "unavailable");
  } catch {
    return "unavailable";
  }
}

function parseRuntimeSidecar(value: unknown, expectedBinding: PlaywrightExecutionBinding): RuntimeSidecar {
  const runtime = value as Partial<RuntimeSidecar>;
  if (runtime.schemaVersion !== "visual-hive.playwright-runtime.v1" || !runtime.capturedAt || Number.isNaN(Date.parse(runtime.capturedAt))) {
    throw new Error("Playwright runtime sidecar is missing or malformed.");
  }
  if (!runtime.browser?.name?.trim() || !runtime.browser.version?.trim()) throw new Error("Playwright runtime sidecar has no actual browser identity.");
  if (!sameExecutionBinding(runtime.executionBinding, expectedBinding)) throw new Error("Playwright runtime sidecar does not match its bound execution.");
  const environment = runtime.environment;
  if (
    !environment?.os?.trim() || !environment.architecture?.trim() || !environment.nodeVersion?.trim() ||
    !environment.playwrightVersion?.trim() || !environment.locale?.trim() || !environment.timezone?.trim() ||
    !environment.userAgent?.trim() || !Number.isFinite(environment.deviceScaleFactor) || !Array.isArray(environment.fonts)
  ) {
    throw new Error("Playwright runtime sidecar has incomplete environment identity.");
  }
  for (const font of environment.fonts) {
    if (!font || typeof font.name !== "string" || !font.name.trim() || typeof font.available !== "boolean") {
      throw new Error("Playwright runtime sidecar has malformed font identity.");
    }
  }
  return runtime as RuntimeSidecar;
}

async function canonicalRepositoryRoot(input: string): Promise<string> {
  const rootDir = await realpath(path.resolve(input));
  const gitRoot = await realpath(await git(rootDir, ["rev-parse", "--show-toplevel"]));
  if (normalizeFilesystemIdentity(gitRoot) !== normalizeFilesystemIdentity(rootDir)) {
    throw new Error("Playwright repair capture root must be the exact git worktree root.");
  }
  return rootDir;
}

async function assertExpectedHead(rootDir: string, expected: string): Promise<void> {
  const actual = await git(rootDir, ["rev-parse", "HEAD"]);
  if (actual !== expected) throw new Error(`Git HEAD changed during Playwright repair capture: expected ${expected}, got ${actual}.`);
}

async function assertTrackedTreeUnchanged(rootDir: string): Promise<void> {
  const status = await git(rootDir, ["status", "--porcelain=v1", "--untracked-files=no"]);
  if (status) throw new Error("Playwright repair capture requires a clean tracked git worktree matching the expected commit.");
}

async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd, timeout: 5_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
    return stdout.trim();
  } catch (error) {
    throw new Error(`Git identity command failed: git ${args.join(" ")}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function readRegularContainedFile(rootDir: string, relativePath: string, maxBytes = MAX_REPAIR_ARTIFACT_BYTES): Promise<Buffer> {
  const normalized = RelativeArtifactPathSchema.parse(relativePath);
  let current = rootDir;
  for (const segment of normalized.split("/")) {
    current = path.join(current, segment);
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw new Error(`Playwright repair artifact path contains a symbolic link: ${normalized}.`);
  }
  const resolved = await realpath(current);
  const relative = path.relative(rootDir, resolved);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Playwright repair artifact escaped the repository: ${normalized}.`);
  }
  const handle = await open(resolved, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size <= 0 || before.size > maxBytes) throw new Error(`Playwright repair artifact is not a bounded regular file: ${normalized}.`);
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (bytes.byteLength !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
      throw new Error(`Playwright repair artifact changed while it was being read: ${normalized}.`);
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

async function readJsonFile(rootDir: string, relativePath: string): Promise<unknown> {
  const bytes = await readRegularContainedFile(rootDir, relativePath, MAX_REPAIR_JSON_BYTES);
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch (error) {
    throw new Error(`Playwright repair JSON artifact is invalid: ${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function writeJsonExclusive(rootDir: string, relativePath: string, value: unknown): Promise<void> {
  await writeFileExclusive(rootDir, relativePath, Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"));
}

async function writeFileExclusive(rootDir: string, relativePath: string, bytes: Buffer): Promise<void> {
  const normalized = RelativeArtifactPathSchema.parse(relativePath);
  const segments = normalized.split("/");
  segments.pop();
  if (segments.length > 0) await ensureSafeRelativeDirectory(rootDir, segments.join("/"));
  const absolute = resolveRelative(rootDir, normalized);
  try {
    const existing = await lstat(absolute);
    if (existing.isSymbolicLink()) throw new Error(`Playwright repair write destination is a symbolic link: ${normalized}.`);
  } catch (error) {
    if (!isErrorCode(error, "ENOENT")) throw error;
  }
  await writeFile(absolute, bytes, { flag: "wx" });
}

async function overwriteRegularContainedFile(rootDir: string, relativePath: string, bytes: Buffer): Promise<void> {
  if (bytes.byteLength <= 0 || bytes.byteLength > MAX_REPAIR_JSON_BYTES) throw new Error(`Playwright repair replacement is outside its byte limit: ${relativePath}.`);
  // Establish containment and reject linked path components before opening the
  // existing generated result. O_NOFOLLOW keeps a final-component swap from
  // redirecting the trusted rewrite.
  await readRegularContainedFile(rootDir, relativePath, MAX_REPAIR_JSON_BYTES);
  const absolute = resolveRelative(rootDir, relativePath);
  const noFollowFlag = process.platform === "win32" ? 0 : (constants.O_NOFOLLOW ?? 0);
  const handle = await open(absolute, constants.O_WRONLY | noFollowFlag);
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error(`Playwright repair replacement target is not a regular file: ${relativePath}.`);
    await handle.truncate(0);
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function sameExecutionBinding(value: unknown, expected: PlaywrightExecutionBinding): boolean {
  if (!isPlainRecord(value)) return false;
  const keys = Object.keys(value).sort(stableTextCompare);
  const expectedKeys = ["bindingMacSha256", "generatedConfigSha256", "generatedSpecSha256", "nonceSha256", "payloadSha256"];
  return canonicalSha256(keys) === canonicalSha256(expectedKeys) && expectedKeys.every((key) => value[key] === expected[key as keyof PlaywrightExecutionBinding]);
}

async function ensureSafeRelativeDirectory(rootDir: string, relativePath: string): Promise<string> {
  const normalized = RelativeArtifactPathSchema.parse(relativePath);
  let current = rootDir;
  for (const segment of normalized.split("/")) {
    current = path.join(current, segment);
    try {
      await mkdir(current);
    } catch (error) {
      if (!isErrorCode(error, "EEXIST")) throw error;
    }
    const entry = await lstat(current);
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error(`Playwright repair output contains a linked or non-directory parent: ${normalized}.`);
    const canonical = await realpath(current);
    const relative = path.relative(rootDir, canonical);
    if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`Playwright repair output escaped the repository: ${normalized}.`);
    }
    if (normalizeFilesystemIdentity(canonical) !== normalizeFilesystemIdentity(current)) {
      throw new Error(`Playwright repair output contains a junction or symbolic-link parent: ${normalized}.`);
    }
  }
  return current;
}

async function assertSafeRelativeDirectory(rootDir: string, relativePath: string): Promise<void> {
  const normalized = RelativeArtifactPathSchema.parse(relativePath);
  const absolute = resolveRelative(rootDir, normalized);
  const entry = await lstat(absolute);
  if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error(`Playwright repair output is not an ordinary directory: ${normalized}.`);
  const canonical = await realpath(absolute);
  const relative = path.relative(rootDir, canonical);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || normalizeFilesystemIdentity(canonical) !== normalizeFilesystemIdentity(absolute)) {
    throw new Error(`Playwright repair output directory escaped its repository namespace: ${normalized}.`);
  }
}

async function writeFailureMarker(
  rootDir: string,
  failurePath: string,
  inputs: CaptureInputs,
  phase: "before" | "after",
  message: string
): Promise<void> {
  try {
    await writeJsonExclusive(rootDir, failurePath, {
      schemaVersion: "visual-hive.playwright-repair-capture-failure.v1",
      failedAt: new Date().toISOString(),
      phase,
      requestId: inputs.request.requestId,
      requestDigest: inputs.request.requestDigest,
      captureInputDigest: inputs.captureInputDigest,
      commitSha: inputs.request.commitSha,
      error: bounded(message, 4096)
    });
  } catch (error) {
    if (!isErrorCode(error, "EEXIST")) throw error;
  }
}

async function listRelativeFiles(rootDir: string, relativeDirectory: string, budgetLimits: HiveRepairBudgetLimits): Promise<string[]> {
  const absoluteDirectory = resolveRelative(rootDir, relativeDirectory);
  if (!await exists(absoluteDirectory)) return [];
  const output: string[] = [];
  let inputBytes = 0;
  let imageBytes = 0;
  const visit = async (directory: string, depth: number): Promise<void> => {
    if (depth > MAX_REPAIR_ARTIFACT_DEPTH) throw new Error("Playwright repair artifact tree exceeds its depth limit.");
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Playwright repair artifact contains a symbolic link: ${repositoryRelativePath(absolute, rootDir)}.`);
      if (entry.isDirectory()) await visit(absolute, depth + 1);
      else if (entry.isFile()) {
        const relative = repositoryRelativePath(absolute, rootDir);
        const image = isImageArtifactPath(relative);
        const bytes = await readRegularContainedFile(rootDir, relative, Math.min(MAX_REPAIR_ARTIFACT_BYTES, image ? budgetLimits.maxImageBytes : budgetLimits.maxInputBytes));
        if (image) imageBytes += bytes.byteLength;
        else inputBytes += bytes.byteLength;
        assertArtifactBudgets(inputBytes, imageBytes, budgetLimits, "tree");
        output.push(relative);
        if (output.length > MAX_REPAIR_ARTIFACT_FILES) throw new Error("Playwright repair artifact tree exceeds its file-count limit.");
      }
    }
  };
  await visit(absoluteDirectory, 0);
  return output.sort(stableTextCompare);
}

async function validateArtifactInventory(rootDir: string, artifactPaths: string[], budgetLimits: HiveRepairBudgetLimits): Promise<void> {
  const paths = sortedUnique(artifactPaths);
  if (paths.length !== artifactPaths.length || paths.length > MAX_REPAIR_ARTIFACT_FILES) throw new Error("Playwright repair artifact inventory is duplicated or exceeds its file-count limit.");
  let inputBytes = 0;
  let imageBytes = 0;
  for (const artifactPath of paths) {
    const image = isImageArtifactPath(artifactPath);
    const bytes = await readRegularContainedFile(rootDir, artifactPath, Math.min(MAX_REPAIR_ARTIFACT_BYTES, image ? budgetLimits.maxImageBytes : budgetLimits.maxInputBytes));
    if (image) imageBytes += bytes.byteLength;
    else inputBytes += bytes.byteLength;
    assertArtifactBudgets(inputBytes, imageBytes, budgetLimits, "inventory");
  }
}

function isImageArtifactPath(value: string): boolean {
  return /\.(?:gif|jpe?g|png|webp)$/iu.test(value);
}

function assertArtifactBudgets(inputBytes: number, imageBytes: number, budgetLimits: HiveRepairBudgetLimits, scope: string): void {
  if (inputBytes > budgetLimits.maxInputBytes) throw new Error(`Playwright repair artifact ${scope} exceeds its authorized input-byte budget.`);
  if (imageBytes > budgetLimits.maxImageBytes) throw new Error(`Playwright repair artifact ${scope} exceeds its authorized image-byte budget.`);
  if (inputBytes + imageBytes > MAX_REPAIR_ARTIFACT_TOTAL_BYTES) throw new Error(`Playwright repair artifact ${scope} exceeds its aggregate byte limit.`);
}

function repositoryRelativePath(value: string, rootDir: string): string {
  const absolute = path.isAbsolute(value) ? path.resolve(value) : path.resolve(rootDir, value);
  const relative = path.relative(rootDir, absolute);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Playwright emitted a path outside the repository: ${value}.`);
  }
  return RelativeArtifactPathSchema.parse(relative.split(path.sep).join("/"));
}

function resolveRelative(rootDir: string, relativePath: string): string {
  const normalized = RelativeArtifactPathSchema.parse(relativePath);
  const absolute = path.resolve(rootDir, ...normalized.split("/"));
  const relative = path.relative(rootDir, absolute);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Playwright repair path escaped the repository: ${relativePath}.`);
  }
  return absolute;
}

function relativeJoin(...segments: string[]): string {
  return RelativeArtifactPathSchema.parse(segments.join("/").replaceAll("\\", "/").replace(/\/{2,}/gu, "/"));
}

function scrubRepositoryRoot(value: string, rootDir: string): string {
  const withBackslashes = `${rootDir}${path.sep}`;
  const withSlashes = `${rootDir.split(path.sep).join("/")}/`;
  return value.split(withBackslashes).join("").split(withSlashes).join("").replaceAll("\\", "/");
}

function normalizeFilesystemIdentity(value: string): string {
  const normalized = path.resolve(value).replace(/[\\/]+$/u, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function safeName(value: string): string {
  return String(value).replace(/[^a-z0-9_.-]+/gi, "-");
}

function declaredTargetUrls(target: VisualHiveConfig["targets"][string]): string[] {
  const urls: string[] = [];
  if ("url" in target && typeof target.url === "string") urls.push(target.url);
  if (target.kind === "deployPreview" && target.fallbackUrl) urls.push(target.fallbackUrl);
  if (target.kind === "commandGroup" || target.kind === "protected") urls.push(...target.services.map((service) => service.url));
  return sortedUnique(urls);
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort(stableTextCompare);
}

function assertExactSet(left: string[], right: string[], label: string): void {
  if (canonicalSha256(sortedUnique(left)) !== canonicalSha256(sortedUnique(right))) {
    throw new Error(`Playwright repair capture ${label} differs.`);
  }
}

function bounded(value: string, maximum: number): string {
  const trimmed = value.trim();
  if (!trimmed) return "unspecified";
  return trimmed.length <= maximum ? trimmed : `${trimmed.slice(0, maximum - 1)}…`;
}

async function exists(absolutePath: string): Promise<boolean> {
  try {
    await access(absolutePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function isErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && String((error as NodeJS.ErrnoException).code) === code;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requiredText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string") throw new Error(`Playwright repair capture finding ${field} must be a string.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum || normalized.includes("\0")) {
    throw new Error(`Playwright repair capture finding ${field} must contain 1-${maximum} safe characters.`);
  }
  return normalized;
}

function requiredTextArray(value: unknown, field: string, maximumItems: number, maximumLength: number): string[] {
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new Error(`Playwright repair capture finding ${field} must contain at most ${maximumItems} strings.`);
  }
  const normalized = value.map((item) => requiredText(item, field, maximumLength));
  if (new Set(normalized).size !== normalized.length) throw new Error(`Playwright repair capture finding ${field} contains duplicates.`);
  return normalized;
}

function requiredAssertionIdentities(value: unknown): PlaywrightRepairCaptureAssertionIdentity[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 256) {
    throw new Error("Playwright repair capture finding affectedAssertions must contain 1-256 entries.");
  }
  const parsed = value.map((item) => {
    if (!isPlainRecord(item)) throw new Error("Playwright repair capture finding assertion identity must be an object.");
    const keys = Object.keys(item).sort(stableTextCompare);
    const expectedKeys = ["contractId", "route", "screenshotName", "state", "viewportId"].sort(stableTextCompare);
    if (canonicalSha256(keys) !== canonicalSha256(expectedKeys)) throw new Error("Playwright repair capture finding assertion identity has missing or unknown fields.");
    return {
      contractId: requiredText(item.contractId, "affectedAssertions.contractId", 256),
      screenshotName: requiredText(item.screenshotName, "affectedAssertions.screenshotName", 256),
      route: requiredText(item.route, "affectedAssertions.route", 2048),
      state: requiredText(item.state, "affectedAssertions.state", 1024),
      viewportId: requiredText(item.viewportId, "affectedAssertions.viewportId", 256)
    };
  });
  const identities = parsed.map((item) => canonicalSha256(item));
  if (new Set(identities).size !== identities.length) throw new Error("Playwright repair capture finding affectedAssertions contains duplicates.");
  return parsed;
}

function requiredEnum<const T extends readonly string[]>(value: unknown, allowed: T, field: string): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(`Playwright repair capture finding ${field} is invalid.`);
  }
  return value as T[number];
}
