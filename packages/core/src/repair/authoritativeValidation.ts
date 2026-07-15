import { TextDecoder } from "node:util";
import { z } from "zod";
import { verifyVisualHiveBundleDigest, visualHiveObservationRepositoryFingerprint, type VisualHiveBundleManifest } from "../hive/bundle.js";
import { inspectVisualImageBytes } from "./assets.js";
import { buildVisualRepairValidation, parseVisualHiveTaskContext } from "./build.js";
import { canonicalJson, canonicalSha256, sha256Bytes, stableTextCompare } from "./canonical.js";
import { compareVisualPngBytes } from "./imageCompare.js";
import { parseHiveRepairSession, verifyHiveRepairResultAgainstSession, type HiveRepairResult, type HiveRepairSession } from "./hiveContracts.js";
import { parseVisualRunContext } from "./runContext.js";
import {
  BoundedIdSchema,
  GitCommitSchema,
  RelativeArtifactPathSchema,
  RepositorySchema,
  Sha256Schema,
  VisualRunExecutionBindingSchema,
  type VisualHiveTaskContext,
  type VisualRepairValidation,
  type VisualRepairValidationInput,
  type VisualRunContext,
  type VisualRunEvidenceAsset,
  type VisualRunThreshold
} from "./types.js";

const MAX_JSON_BYTES = 16 * 1024 * 1024;
const TimestampSchema = z.string().datetime({ offset: true });
const TextSchema = z.string().trim().min(1).max(60_000);
const StringListSchema = z.array(z.string().trim().min(1).max(4096)).max(4096);

export interface RawRepairArtifact {
  sourcePath: string;
  bytes: Uint8Array;
}

export interface RepairRunArtifacts {
  manifest: RawRepairArtifact;
  runContextPath: string;
  payloads: readonly RawRepairArtifact[];
}

export interface BuildVisualRepairValidationArtifacts {
  validationId: string;
  generatedAt: string;
  taskContext: RawRepairArtifact;
  hiveRepairSession: RawRepairArtifact;
  hiveRepairResult: RawRepairArtifact;
  before: RepairRunArtifacts;
  after: RepairRunArtifacts;
}

const BundleSourceSchema = z.object({
  repository: RepositorySchema,
  repositoryId: z.string().trim().min(1).max(128).optional(),
  ref: z.string().trim().min(1).max(1024),
  commitSha: GitCommitSchema,
  event: z.string().trim().min(1).max(256),
  workflowName: z.string().trim().min(1).max(512).optional(),
  workflowRunId: z.string().trim().min(1).max(256).optional(),
  workflowRunAttempt: z.string().trim().min(1).max(256).optional(),
  workflowArtifactId: z.string().trim().min(1).max(256).optional(),
  conclusion: z.string().trim().min(1).max(256),
  trusted: z.boolean()
}).strict();

const BundleScanSchema = z.object({
  scope: z.enum(["full", "partial", "changed-files", "targeted"]),
  authoritativeForResolution: z.boolean(),
  evaluatedContracts: z.array(BoundedIdSchema).max(4096),
  evaluatedFiles: z.array(RelativeArtifactPathSchema).max(16_384),
  testPlanVersion: z.string().trim().min(1).max(1024),
  toolRegistryVersion: z.string().trim().min(1).max(1024)
}).strict();

const BundleObservationSchema = z.object({
  fingerprint: z.string().trim().min(1).max(2048),
  repositoryFingerprint: Sha256Schema,
  publicationRole: z.enum(["canonical", "derivative", "aggregate"]),
  rootCauseKey: z.string().trim().min(1).max(2048),
  blockedByRootKeys: z.array(z.string().trim().min(1).max(2048)).max(512),
  state: z.enum(["present", "absent"]),
  issueKind: z.enum([
    "setup_needed", "map_drift", "missing_visual_coverage", "test_adequacy_gap", "weak_visual_test", "stale_baseline",
    "baseline_churn", "visual_regression", "selector_contract_failure", "screenshot_diff", "mutation_survivor",
    "workflow_safety", "provider_governance", "protected_target_blocked", "external_repo_onboarding"
  ]),
  severity: z.enum(["low", "medium", "high", "critical"]),
  owningAgentHint: z.string().trim().min(1).max(512),
  title: TextSchema,
  body: TextSchema,
  labels: z.array(z.string().trim().min(1).max(512)).max(128),
  sourceArtifacts: z.array(RelativeArtifactPathSchema).max(512),
  affectedContracts: z.array(BoundedIdSchema).max(512),
  validationCommand: TextSchema,
  observedAt: TimestampSchema,
  firstSeenAt: TimestampSchema,
  sourceArtifact: RelativeArtifactPathSchema
}).strict();

const BundleManifestSchema = z.object({
  schemaVersion: z.literal("visual-hive.bundle.v2"),
  digestAlgorithm: z.literal("visual-hive.bundle.publication-digest.v1"),
  bundleId: BoundedIdSchema,
  generatedAt: TimestampSchema,
  expiresAt: TimestampSchema,
  producer: z.object({ name: z.literal("visual-hive"), version: z.string().trim().min(1).max(128), gitCommit: z.string().trim().min(1).max(128) }).strict(),
  source: BundleSourceSchema,
  project: z.string().trim().min(1).max(1024),
  mode: z.string().trim().min(1).max(256),
  verdict: z.string().trim().min(1).max(256),
  acmmRequest: z.number().int().min(1).max(6),
  externalCallsMade: z.number().int().nonnegative(),
  scan: BundleScanSchema,
  observations: z.array(BundleObservationSchema).max(16_384),
  files: z.array(z.object({
    path: RelativeArtifactPathSchema,
    sourcePath: RelativeArtifactPathSchema,
    sha256: Sha256Schema,
    size: z.number().int().nonnegative().max(512 * 1024 * 1024),
    mediaType: z.enum(["application/json", "text/markdown", "text/plain", "application/octet-stream"]),
    schemaVersion: z.string().trim().min(1).max(256).optional()
  }).strict()).max(32_768),
  overallDigest: Sha256Schema,
  replayProtection: z.object({ nonce: z.string().trim().min(1).max(2048), key: Sha256Schema }).strict(),
  provenance: z.object({ kind: z.enum(["github-actions", "local"]), subjectDigest: Sha256Schema, attestationRequired: z.boolean() }).strict(),
  safety: z.object({
    atomicWrite: z.literal(true), pathsAreRelative: z.literal(true), digestsRequired: z.literal(true),
    producerCountersAreAdvisory: z.literal(true), producerTrustClaimIsAdvisory: z.literal(true), absenceRequiresAuthoritativeScan: z.literal(true)
  }).strict()
}).strict();

const ScreenshotAssertionSchema = z.object({
  contractId: BoundedIdSchema,
  screenshotName: z.string().trim().min(1).max(512),
  name: z.string().trim().min(1).max(512),
  route: z.string().min(1).max(2048),
  viewport: z.string().trim().min(1).max(512),
  status: z.enum(["passed", "failed", "created", "missing_baseline"]),
  baselinePath: RelativeArtifactPathSchema,
  actualPath: RelativeArtifactPathSchema,
  diffPath: RelativeArtifactPathSchema.optional(),
  maxDiffPixelRatio: z.number().min(0).max(1),
  maxDiffPixels: z.number().int().nonnegative().optional(),
  actualDiffPixelRatio: z.number().min(0).max(1).optional(),
  actualDiffPixels: z.number().int().nonnegative().optional(),
  diffPixels: z.number().int().nonnegative().optional(),
  totalPixels: z.number().int().positive(),
  message: z.string().max(60_000).optional()
}).strict();

const RuntimeErrorSchema = z.object({ type: z.enum(["console", "page"]), message: TextSchema }).strict();

export const ContractResultSchema = z.object({
  contractId: BoundedIdSchema,
  mutationOperator: z.string().trim().min(1).max(1024).optional(),
  targetId: BoundedIdSchema,
  status: z.enum(["passed", "failed", "created", "skipped"]),
  durationMs: z.number().nonnegative(),
  errors: StringListSchema,
  artifacts: z.array(RelativeArtifactPathSchema).max(16_384),
  reproductionCommand: z.string().trim().min(1).max(4096).optional(),
  selectorAssertions: z.array(z.object({
    kind: z.enum(["mustExist", "mustNotExist", "textMustExist", "textMustNotExist", "waitFor"]),
    value: z.string().max(4096), status: z.enum(["passed", "failed"]), message: z.string().max(60_000).optional()
  }).strict()).max(4096).optional(),
  flowSteps: z.array(z.object({
    action: z.enum(["goto", "click", "fill", "press", "waitFor", "assertVisible", "assertHidden", "assertText", "assertUrl"]),
    description: z.string().max(4096).optional(), selector: z.string().max(4096).optional(), route: z.string().max(2048).optional(),
    value: z.string().max(4096).optional(), status: z.enum(["passed", "failed"]), durationMs: z.number().nonnegative(), message: z.string().max(60_000).optional()
  }).strict()).max(4096).optional(),
  screenshotAssertions: z.array(ScreenshotAssertionSchema).max(4096).optional(),
  consoleErrors: z.array(RuntimeErrorSchema).max(4096).optional(),
  pageErrors: z.array(RuntimeErrorSchema).max(4096).optional(),
  networkErrors: z.array(z.object({ type: z.literal("network"), url: z.string().max(4096), status: z.number().int(), statusText: z.string().max(2048) }).strict()).max(4096).optional()
}).strict();

const ReportSchema = z.object({
  schemaVersion: z.literal(2),
  project: z.string().trim().min(1).max(1024),
  outputResource: z.record(z.unknown()).optional(),
  repository: z.object({
    provider: z.enum(["local", "github-actions"]), repository: RepositorySchema, owner: z.string().optional(), repo: z.string().optional(),
    remoteUrl: z.string().optional(), branch: z.string().optional(), baseBranch: z.string().optional(), commitSha: GitCommitSchema,
    pullRequestNumber: z.number().int().positive().optional(), runId: z.string().optional(), runAttempt: z.string().optional(), workflow: z.string().optional(), actor: z.string().optional()
  }).strict(),
  mode: z.enum(["pr", "schedule", "manual", "canary", "mutation", "full"]),
  generatedAt: TimestampSchema,
  status: z.enum(["passed", "failed"]),
  changedFiles: z.array(RelativeArtifactPathSchema).max(16_384),
  selectedTargets: z.array(z.object({
    id: BoundedIdSchema, kind: z.string().trim().min(1).max(256), url: z.string().min(1).max(4096), prSafe: z.boolean(), cost: z.string().min(1).max(256),
    missingSecrets: z.array(z.string().trim().min(1).max(512)).max(512).optional()
  }).strict()).max(4096),
  selectedContracts: z.array(BoundedIdSchema).max(4096),
  excludedContracts: z.array(z.object({ contractId: BoundedIdSchema, targetId: BoundedIdSchema, reasons: StringListSchema }).strict()).max(4096),
  targetLifecycle: z.array(z.object({
    targetId: BoundedIdSchema, serviceName: z.string().max(512).optional(), phase: z.enum(["install", "build", "setup", "serve", "service", "teardown"]),
    status: z.enum(["started", "passed", "failed", "stopped"]), durationMs: z.number().nonnegative(), command: z.string().max(4096).optional(),
    url: z.string().max(4096).optional(), message: z.string().max(60_000).optional()
  }).strict()).max(16_384),
  generatedSpecPath: RelativeArtifactPathSchema,
  executionBinding: VisualRunExecutionBindingSchema.optional(),
  results: z.array(ContractResultSchema).max(4096),
  summary: z.object({
    passed: z.number().int().nonnegative(), failed: z.number().int().nonnegative(), screenshotsPassed: z.number().int().nonnegative(),
    screenshotsFailed: z.number().int().nonnegative(), baselinesCreated: z.number().int().nonnegative(), createdBaselines: z.number().int().nonnegative(),
    missingBaselines: z.number().int().nonnegative(), visualDiffs: z.number().int().nonnegative(), consoleErrors: z.number().int().nonnegative(),
    pageErrors: z.number().int().nonnegative(), flowStepsPassed: z.number().int().nonnegative().optional(), flowStepsFailed: z.number().int().nonnegative().optional()
  }).strict(),
  consoleErrors: z.array(z.string().max(60_000)).max(4096),
  pageErrors: z.array(RuntimeErrorSchema).max(4096),
  artifacts: z.array(RelativeArtifactPathSchema).max(32_768),
  providerResults: z.array(z.unknown()).optional(),
  reproductionCommands: z.array(z.string().trim().min(1).max(4096)).max(512),
  verdictSummary: z.object({
    visualHiveVerdict: z.enum(["passed", "failed", "warning", "blocked", "inconclusive"]),
    failedBecause: StringListSchema, warningBecause: StringListSchema, blockedBecause: StringListSchema, advisoryOnly: StringListSchema
  }).strict().optional(),
  verdictContributions: z.array(z.unknown()).optional(),
  noContractsReason: z.string().max(60_000).optional()
}).strict();

const MutationReportSchema = z.object({
  schemaVersion: z.literal(2), project: z.string().trim().min(1).max(1024), generatedAt: TimestampSchema,
  outputResource: z.record(z.unknown()).optional(), minScore: z.number().min(0).max(1), score: z.number().min(0).max(1),
  killed: z.number().int().nonnegative(), total: z.number().int().nonnegative(),
  results: z.array(z.object({
    operator: z.string().trim().min(1).max(1024), status: z.enum(["killed", "survived", "not_applicable", "error"]), killed: z.boolean(),
    contractIds: z.array(BoundedIdSchema).max(512), applicable: z.boolean(), affected: z.array(z.unknown()).optional(), affectedSurfaces: z.array(z.unknown()).optional(),
    expectedFailureKinds: z.array(z.string()).optional(), failureKind: z.string().optional(), failedAssertion: z.string().optional(), durationMs: z.number().nonnegative(),
    errors: StringListSchema, artifacts: z.array(RelativeArtifactPathSchema).optional(), validationCommand: z.string().optional(), suggestedMissingTest: z.string().optional(),
    mutationMode: z.enum(["runtime", "fixture", "source"]).optional(), sourceMutation: z.boolean().optional()
  }).strict()).max(4096)
}).strict();

type ParsedReport = z.infer<typeof ReportSchema>;
type ParsedMutationReport = z.infer<typeof MutationReportSchema>;
type ParsedHiveRepairResult = HiveRepairResult;
type ParsedBundleObservation = z.infer<typeof BundleObservationSchema>;

interface VerifiedRunArtifacts {
  bundle: VisualHiveBundleManifest;
  runContext: VisualRunContext;
  report: ParsedReport;
  mutationReport?: ParsedMutationReport;
  payloads: Map<string, Buffer>;
}

export function buildVisualRepairValidationFromArtifacts(input: BuildVisualRepairValidationArtifacts): VisualRepairValidation {
  const taskContext = parseVisualHiveTaskContext(parseJsonArtifact(input.taskContext));
  const hiveSession = parseHiveRepairSession(parseJsonArtifact(input.hiveRepairSession));
  const hiveResult = verifyHiveRepairResultAgainstSession(parseJsonArtifact(input.hiveRepairResult), hiveSession);
  verifyHiveResultBinding(taskContext, hiveSession, hiveResult);
  const before = verifyRunArtifacts(input.before, "before", taskContext, hiveSession, hiveResult, input.generatedAt);
  const after = verifyRunArtifacts(input.after, "after", taskContext, hiveSession, hiveResult, input.generatedAt);
  verifyRunPair(before, after, taskContext, hiveResult);

  const beforeFinding = exactFinding(before.bundle, hiveResult.finding);
  const afterFinding = exactFinding(after.bundle, hiveResult.finding);
  const findingBeforeStatus = beforeFinding?.state ?? "not_evaluated";
  const findingStatus = afterFinding?.state ?? "not_evaluated";
  const obligationResults = deriveObligations(taskContext, before, after);
  const targeted = deriveTargetedLane(taskContext, after, obligationResults.obligations);
  const regression = deriveRegressionLane(after);
  const mutation = deriveMutationLane(beforeFinding, after.mutationReport);
  const failures = deriveFailures(before, after);
  const policyChanges = derivePolicyChanges(before.runContext, after.runContext);
  const authoritativeForResolution = after.bundle.scan.scope === "full" && after.bundle.scan.authoritativeForResolution;

  const receiptInput: VisualRepairValidationInput = {
    schemaVersion: "visual-hive.repair-validation.v1",
    generatedAt: input.generatedAt,
    validationId: input.validationId,
    taskId: taskContext.taskId,
    taskContextDigest: taskContext.contextDigest,
    findingFingerprint: hiveResult.finding.fingerprint,
    sessionId: hiveSession.sessionId,
    sessionDigest: hiveSession.sessionDigest,
    authorizationDigest: hiveSession.authorization!.authorizationDigest,
    hiveRepairResultDigest: hiveResult.resultDigest,
    repository: taskContext.repository.name,
    baseSha: hiveResult.baseSha,
    headSha: hiveResult.headSha,
    beforeBundleDigest: before.bundle.overallDigest,
    afterBundleDigest: after.bundle.overallDigest,
    beforeReportDigest: before.runContext.report.sha256,
    afterReportDigest: after.runContext.report.sha256,
    beforeRunContextDigest: before.runContext.runContextDigest,
    afterRunContextDigest: after.runContext.runContextDigest,
    before: before.runContext.execution,
    after: after.runContext.execution,
    obligations: obligationResults.obligations,
    screenshotTriplets: obligationResults.screenshotTriplets,
    lanes: { targeted, regression, mutation },
    remainingFailures: failures.remaining,
    newFailures: failures.introduced,
    findingBeforeStatus,
    findingStatus,
    authoritativeForResolution,
    policyChanges,
    claimedOutcome: hiveResult.claimedOutcome?.summary,
    digestAlgorithm: "visual-hive.canonical-json.sha256.v1"
  };
  return buildVisualRepairValidation(receiptInput);
}

function verifyHiveResultBinding(task: VisualHiveTaskContext, session: HiveRepairSession, result: ParsedHiveRepairResult): void {
  if (session.effectiveMode !== "visual_hive" || result.effectiveMode !== "visual_hive" || !session.authorization || !result.authorizationDigest) throw new Error("Visual Hive repair validation requires an authorized Visual Hive Hive session.");
  if (result.taskId !== task.taskId || result.taskContextDigest !== task.contextDigest) throw new Error("Hive repair result does not bind the verified Visual Hive task context.");
  if (result.repository.name !== task.repository.name || result.repository.repositoryId !== task.repository.repositoryId || result.repository.repositoryFingerprint !== task.repository.repositoryFingerprint) throw new Error("Hive repair result repository identity does not match the task context.");
  const findingRepositoryFingerprint = visualHiveObservationRepositoryFingerprint(task.repository.name, result.finding.fingerprint, result.finding.publicationRole, result.finding.rootCauseKey);
  if (result.finding.repositoryFingerprint !== findingRepositoryFingerprint) throw new Error("Hive repair result finding repository fingerprint does not match its publication identity.");
  if (result.baseSha !== task.repository.baseSha) throw new Error("Hive repair result base SHA does not match the task context.");
  if (result.baseSha === result.headSha) throw new Error("Hive repair result head SHA must differ from its base SHA.");
  if (session.task.issueSource !== task.issue.source || session.task.issueExternalId !== task.issue.externalId || session.task.problemStatementDigest !== task.issue.problemStatementSha256) throw new Error("Hive repair session issue projection does not match the verified Visual Hive task context.");
  const expectedImageAttachments = task.imageReferences.map((reference) => {
    const asset = task.assets.find((candidate) => candidate.assetId === reference.assetId);
    if (!asset || !["problem", "expected", "current", "reference"].includes(reference.role)) throw new Error(`Visual Hive task image reference ${reference.assetId} cannot be projected into the Hive repair session.`);
    return { position: reference.position, assetId: asset.assetId, role: reference.role, sha256: asset.sha256, mediaType: asset.mediaType, size: asset.size };
  }).sort((left, right) => left.position - right.position);
  if (canonicalJson(session.task.imageAttachments) !== canonicalJson(expectedImageAttachments)) throw new Error("Hive repair session image projection does not match the verified Visual Hive task context.");
  const expectedSourceContext = {
    digest: task.sourceContext.digest,
    files: task.sourceContext.files,
    omittedPaths: task.sourceContext.omittedPaths,
    truncated: task.sourceContext.truncated
  };
  const actualSourceContext = {
    digest: session.sourceContext.digest,
    files: session.sourceContext.files,
    omittedPaths: session.sourceContext.omittedPaths,
    truncated: session.sourceContext.truncated
  };
  if (canonicalJson(actualSourceContext) !== canonicalJson(expectedSourceContext)) throw new Error("Hive repair session source-context projection does not match the verified Visual Hive task context.");
  const request = result.validationRequests.find((candidate) => candidate.kind === "patch_validation" && candidate.commitSha === result.headSha);
  if (!request || request.authorizationDigest !== session.authorization.authorizationDigest || request.profileId !== session.authorization.profile.profileId || request.profileDigest !== session.authorization.profile.profileDigest) throw new Error("Hive repair result has no authorized head-bound patch validation request.");
  const taskProfile = task.profiles.find((candidate) => candidate.profileId === request.profileId);
  if (!taskProfile || taskProfile.profileDigest !== request.profileDigest) throw new Error("Hive repair result validation profile does not match the verified Visual Hive task context.");
}

function verifyRunArtifacts(input: RepairRunArtifacts, phase: "before" | "after", task: VisualHiveTaskContext, session: HiveRepairSession, result: ParsedHiveRepairResult, validationAt: string): VerifiedRunArtifacts {
  const manifest = BundleManifestSchema.parse(parseJsonArtifact(input.manifest)) as VisualHiveBundleManifest;
  const validationTimestamp = Date.parse(validationAt);
  if (!Number.isFinite(validationTimestamp)) throw new Error("Visual Hive repair validation time is invalid.");
  if (!verifyVisualHiveBundleDigest(manifest)) throw new Error(`Visual Hive ${phase} bundle publication digest is invalid.`);
  if (manifest.provenance.subjectDigest !== manifest.overallDigest) throw new Error(`Visual Hive ${phase} bundle provenance subject does not match its digest.`);
  if (Date.parse(manifest.generatedAt) > validationTimestamp) throw new Error(`Visual Hive ${phase} bundle was generated after repair validation.`);
  if (Date.parse(manifest.expiresAt) < validationTimestamp) throw new Error(`Visual Hive ${phase} bundle expired before repair validation.`);
  if (Date.parse(manifest.expiresAt) <= Date.parse(manifest.generatedAt)) throw new Error(`Visual Hive ${phase} bundle has an invalid expiry window.`);
  if (manifest.source.repository !== task.repository.name || manifest.source.repositoryId !== task.repository.repositoryId) throw new Error(`Visual Hive ${phase} bundle repository identity mismatch.`);
  const expectedCommit = phase === "before" ? result.baseSha : result.headSha;
  if (manifest.source.commitSha !== expectedCommit) throw new Error(`Visual Hive ${phase} bundle commit mismatch: expected ${expectedCommit}.`);

  const payloads = payloadMap(input.payloads);
  const runContextPath = RelativeArtifactPathSchema.parse(input.runContextPath);
  const runContextBytes = requireBundlePayload(manifest, payloads, runContextPath);
  const runContext = parseVisualRunContext(parseJsonBytes(runContextBytes, runContextPath));
  if (runContext.phase !== phase) throw new Error(`Visual Hive run context phase mismatch: expected ${phase}.`);
  if (runContext.repository.commitSha !== expectedCommit || runContext.repository.name !== task.repository.name || runContext.repository.repositoryId !== task.repository.repositoryId || runContext.repository.repositoryFingerprint !== task.repository.repositoryFingerprint) throw new Error(`Visual Hive ${phase} run context repository or commit identity mismatch.`);
  const brokerIdentity = runContext.brokerRequest;
  const brokerRequest = brokerIdentity ? result.validationRequests.find((request) => request.requestId === brokerIdentity.requestId && request.requestDigest === brokerIdentity.requestDigest) : undefined;
  const validRequestKind = phase === "before"
    ? brokerRequest?.commitRole === "base" && (brokerRequest.kind === "reproduction" || brokerRequest.kind === "capture")
    : brokerRequest?.commitRole === "candidate" && brokerRequest.kind === "patch_validation";
  if (!brokerRequest || !validRequestKind || brokerRequest.commitSha !== expectedCommit || brokerRequest.profileId !== runContext.execution.profileId || brokerRequest.profileDigest !== runContext.execution.profileDigest) throw new Error(`Visual Hive ${phase} run does not bind the exact Hive-brokered validation request.`);
  const journalRequest = session.validationRequests.find((request) => request.requestId === brokerRequest.requestId && request.requestDigest === brokerRequest.requestDigest);
  if (!journalRequest || Date.parse(runContext.command.startedAt) < Date.parse(journalRequest.requestedAt)) throw new Error(`Visual Hive ${phase} run predates its durable Hive broker-request journal entry.`);
  if (phase === "after" && Date.parse(runContext.command.startedAt) < Date.parse(result.generatedAt)) throw new Error("Visual Hive after run predates the immutable Hive repair result it validates.");
  if (runContext.taskId !== task.taskId || runContext.taskContextDigest !== task.contextDigest || runContext.findingFingerprint !== result.finding.fingerprint) throw new Error(`Visual Hive ${phase} run context task or finding identity mismatch.`);
  if (runContext.producer.visualHiveVersion !== manifest.producer.version || runContext.producer.visualHiveCommit !== manifest.producer.gitCommit || runContext.producer.playwrightVersion !== runContext.execution.environment.playwrightVersion) throw new Error(`Visual Hive ${phase} producer identity mismatch.`);
  if (runContext.producer.visualHiveVersion !== session.capability.visualHiveVersion || runContext.producer.visualHiveCommit !== session.capability.visualHiveCommit || runContext.producer.manifestSha256 !== session.capability.visualHiveManifestSha256 || runContext.producer.entrypointSha256 !== session.capability.visualHiveEntrypointSha256 || runContext.execution.toolRegistryDigest !== session.capability.validationToolRegistryDigest) throw new Error(`Visual Hive ${phase} run does not match the authorized Visual Hive release artifact and validation tool registry.`);
  const authorization = session.authorization;
  if (!authorization || runContext.execution.profileId !== authorization.profile.profileId || runContext.execution.profileDigest !== authorization.profile.profileDigest || runContext.command.validationCommandId !== authorization.profile.validationCommandId) throw new Error(`Visual Hive ${phase} run does not use the authorized validation profile.`);
  if (Date.parse(runContext.command.startedAt) < Date.parse(authorization.issuedAt) || Date.parse(runContext.command.completedAt) > Date.parse(authorization.expiresAt)) throw new Error(`Visual Hive ${phase} run falls outside its execution authorization window.`);
  if (Date.parse(runContext.command.completedAt) > validationTimestamp || Date.parse(result.generatedAt) > validationTimestamp) throw new Error(`Visual Hive ${phase} evidence or Hive repair result postdates repair validation.`);
  if (runContext.execution.testPlanDigest !== canonicalSha256(manifest.scan.testPlanVersion) || runContext.execution.toolRegistryDigest !== canonicalSha256(manifest.scan.toolRegistryVersion)) throw new Error(`Visual Hive ${phase} plan or tool registry identity mismatch.`);

  const reportBytes = requireBundlePayload(manifest, payloads, runContext.report.path);
  if (sha256Bytes(reportBytes) !== runContext.report.sha256) throw new Error(`Visual Hive ${phase} report digest does not match its run context.`);
  const report = ReportSchema.parse(parseJsonBytes(reportBytes, runContext.report.path));
  if (report.mode !== "full") throw new Error(`Visual Hive ${phase} repair validation requires a full execution-matrix report.`);
  for (const asset of runContext.evidenceAssets) verifyEvidenceAsset(manifest, payloads, asset);
  verifyReportBinding(report, runContext, task, manifest, payloads);
  verifyCaptureBinding(report, runContext, manifest, phase);

  let mutationReport: ParsedMutationReport | undefined;
  if (runContext.mutationReport) {
    const bytes = requireBundlePayload(manifest, payloads, runContext.mutationReport.path);
    if (sha256Bytes(bytes) !== runContext.mutationReport.sha256) throw new Error(`Visual Hive ${phase} mutation report digest does not match its run context.`);
    mutationReport = MutationReportSchema.parse(parseJsonBytes(bytes, runContext.mutationReport.path));
  }

  return { bundle: manifest, runContext, report, mutationReport, payloads };
}

function verifyRunPair(before: VerifiedRunArtifacts, after: VerifiedRunArtifacts, task: VisualHiveTaskContext, result: ParsedHiveRepairResult): void {
  if (before.runContext.runId === after.runContext.runId) throw new Error("Visual Hive before and after runs must have distinct run IDs.");
  if (Date.parse(after.runContext.command.startedAt) < Date.parse(before.runContext.command.completedAt)) throw new Error("Visual Hive after validation started before the before run completed.");
  for (const run of [before.runContext, after.runContext]) verifyRunAgainstTaskProfile(run, task);
  if (before.bundle.bundleId === after.bundle.bundleId || before.bundle.replayProtection.key === after.bundle.replayProtection.key) throw new Error("Visual Hive before and after bundles must not reuse replay identity.");
  if (before.runContext.execution.commitSha !== result.baseSha || after.runContext.execution.commitSha !== result.headSha) throw new Error("Visual Hive execution commits do not match the Hive repair result.");
  if (canonicalJson(before.runContext.producer) !== canonicalJson(after.runContext.producer)) throw new Error("Visual Hive before and after runs use different release artifacts or Playwright producers.");
}

function verifyRunAgainstTaskProfile(run: VisualRunContext, task: VisualHiveTaskContext): void {
  const profile = task.profiles.find((candidate) => candidate.profileId === run.execution.profileId);
  if (!profile || profile.profileDigest !== run.execution.profileDigest || profile.validationCommandId !== run.command.validationCommandId) throw new Error(`Visual Hive run ${run.runId} does not bind a declared task validation profile.`);
  const routes = new Set(profile.routes);
  const viewports = new Set(profile.viewports.map((viewport) => viewport.viewportId));
  const contracts = new Set(profile.contractIds);
  for (const executionCase of run.execution.cases) {
    if (executionCase.targetId !== profile.targetId || !routes.has(executionCase.route) || !viewports.has(executionCase.viewport.viewportId)) throw new Error(`Visual Hive run ${run.runId} contains an execution case outside its declared profile.`);
    for (const contractId of executionCase.contractIds) if (!contracts.has(contractId)) throw new Error(`Visual Hive run ${run.runId} contains undeclared contract ${contractId}.`);
  }
  for (const obligation of task.obligations.filter((candidate) => candidate.authority === "deterministic")) {
    for (const contractId of obligation.mappedContractIds) if (!run.execution.cases.some((executionCase) => executionCase.contractIds.includes(contractId))) throw new Error(`Visual Hive run ${run.runId} omits deterministic obligation contract ${contractId}.`);
  }
}

function verifyReportBinding(report: ParsedReport, run: VisualRunContext, task: VisualHiveTaskContext, manifest: VisualHiveBundleManifest, payloads: Map<string, Buffer>): void {
  if (report.repository.repository !== task.repository.name || report.repository.commitSha !== run.repository.commitSha) throw new Error(`Visual Hive report repository or commit mismatch for run ${run.runId}.`);
  if (!report.executionBinding || canonicalJson(report.executionBinding) !== canonicalJson(run.command.executionBinding)) throw new Error(`Visual Hive report does not bind the exact Playwright execution for run ${run.runId}.`);
  const expectedContracts = sortedUnique(run.execution.cases.flatMap((executionCase) => executionCase.contractIds));
  const selectedContracts = sortedUnique(report.selectedContracts);
  if (canonicalSha256(selectedContracts) !== canonicalSha256(expectedContracts)) throw new Error(`Visual Hive report contract inventory does not match run ${run.runId}.`);
  uniqueBy(report.results, (item) => item.contractId, "report contract result");
  if (report.results.some((item) => !selectedContracts.includes(item.contractId))) throw new Error(`Visual Hive report contains a result outside run ${run.runId}.`);
  const evaluatedContracts = new Set(manifest.scan.evaluatedContracts);
  for (const contractId of selectedContracts) if (!evaluatedContracts.has(contractId)) throw new Error(`Visual Hive bundle scan does not bind evaluated contract ${contractId}.`);
  for (const asset of run.evidenceAssets) verifyEvidenceObligationBinding(run, task, asset);
  verifyReportSummary(report);
  const usedAssetIds = new Set<string>();
  const baselineRecords: Array<{ path: string; sha256: string | null; size: number | null }> = [];
  for (const result of report.results) {
    const threshold = run.thresholds.find((candidate) => candidate.contractId === result.contractId);
    if (!threshold) throw new Error(`Visual Hive report contract ${result.contractId} has no verified threshold policy.`);
    for (const screenshot of result.screenshotAssertions ?? []) {
      if (screenshot.contractId !== result.contractId) throw new Error(`Visual Hive screenshot assertion contract mismatch in ${result.contractId}.`);
      if (screenshot.maxDiffPixelRatio !== threshold.maxDiffPixelRatio || screenshot.maxDiffPixels !== threshold.maxDiffPixels) throw new Error(`Visual Hive screenshot ${screenshot.screenshotName} does not use its verified threshold policy.`);
      const actual = exactScreenshotAsset(run, screenshot, "actual", screenshot.actualPath);
      usedAssetIds.add(actual.assetId);
      if (screenshot.status === "created") throw new Error(`Visual Hive repair validation cannot accept a newly created baseline for ${screenshot.screenshotName}.`);
      if (screenshot.status === "missing_baseline") {
        if (run.evidenceAssets.some((asset) => asset.role === "baseline" && asset.path === screenshot.baselinePath)) throw new Error(`Visual Hive screenshot ${screenshot.screenshotName} reports a missing baseline that is present in evidence.`);
        baselineRecords.push({ path: screenshot.baselinePath, sha256: null, size: null });
        if (screenshot.actualDiffPixels !== screenshot.totalPixels || screenshot.diffPixels !== screenshot.totalPixels || screenshot.actualDiffPixelRatio !== 1 || screenshot.diffPath !== undefined) throw new Error(`Visual Hive missing-baseline arithmetic is inconsistent for ${screenshot.screenshotName}.`);
        continue;
      }
      const baseline = exactScreenshotAsset(run, screenshot, "baseline", screenshot.baselinePath);
      usedAssetIds.add(baseline.assetId);
      baselineRecords.push({ path: screenshot.baselinePath, sha256: baseline.sha256, size: baseline.size });
      const comparison = compareVisualPngBytes(payloads.get(baseline.path)!, payloads.get(actual.path)!);
      if (comparison.totalPixels !== screenshot.totalPixels || comparison.diffPixels !== screenshot.diffPixels || comparison.diffPixels !== screenshot.actualDiffPixels || Math.abs(comparison.diffRatio - (screenshot.actualDiffPixelRatio ?? -1)) > 1e-12) {
        throw new Error(`Visual Hive screenshot ${screenshot.screenshotName} does not match direct baseline/actual pixel comparison.`);
      }
      const expectedFailure = comparison.diffRatio > threshold.maxDiffPixelRatio || (threshold.maxDiffPixels !== undefined && comparison.diffPixels > threshold.maxDiffPixels);
      if (screenshot.status !== (expectedFailure ? "failed" : "passed")) throw new Error(`Visual Hive screenshot ${screenshot.screenshotName} status contradicts its verified pixel threshold.`);
      const matchingDiffs = run.evidenceAssets.filter((asset) => asset.role === "diff" && assertionKey(asset) === assertionKey(actual));
      if (comparison.diffPixels === 0) {
        if (screenshot.diffPath !== undefined || matchingDiffs.length !== 0) throw new Error(`Visual Hive zero-diff screenshot ${screenshot.screenshotName} unexpectedly carries a diff artifact.`);
      } else {
        if (!screenshot.diffPath) throw new Error(`Visual Hive screenshot ${screenshot.screenshotName} is missing its deterministic diff artifact.`);
        const diff = exactScreenshotAsset(run, screenshot, "diff", screenshot.diffPath);
        usedAssetIds.add(diff.assetId);
        if (diff.sha256 !== comparison.diffSha256 || !payloads.get(diff.path)?.equals(comparison.diffPng)) throw new Error(`Visual Hive screenshot ${screenshot.screenshotName} diff bytes do not match direct recomputation.`);
      }
    }
  }
  uniqueBy(baselineRecords, (record) => record.path, "baseline inventory path");
  baselineRecords.sort((left, right) => stableTextCompare(left.path, right.path));
  if (canonicalSha256(baselineRecords) !== run.execution.baselineIdentityDigest) throw new Error(`Visual Hive report does not reproduce the approved baseline inventory for run ${run.runId}.`);
  const unused = run.evidenceAssets.filter((asset) => ["baseline", "actual", "diff"].includes(asset.role) && !usedAssetIds.has(asset.assetId));
  if (unused.length > 0) throw new Error(`Visual Hive run ${run.runId} contains screenshot evidence not bound to a structured assertion.`);
}

function verifyEvidenceObligationBinding(run: VisualRunContext, task: VisualHiveTaskContext, asset: VisualRunEvidenceAsset): void {
  const matchingCases = run.execution.cases.filter((executionCase) =>
    executionCase.contractIds.includes(asset.assertion.contractId) && executionCase.route === asset.assertion.route &&
    executionCase.state === asset.assertion.state && executionCase.viewport.viewportId === asset.assertion.viewportId
  );
  if (matchingCases.length !== 1) {
    throw new Error(`Visual Hive evidence asset ${asset.assetId} must bind exactly one executed contract, route, state, and viewport.`);
  }
  const expectedObligationIds = sortedUnique(task.obligations
    .filter((obligation) => isExecutableScreenshotObligation(obligation) && obligationMatchesEvidenceAssertion(obligation, asset))
    .map((obligation) => obligation.obligationId));
  if (canonicalJson(asset.obligationIds) !== canonicalJson(expectedObligationIds)) {
    throw new Error(`Visual Hive evidence asset ${asset.assetId} obligation binding does not match its declared contract, route, state, and viewport.`);
  }
}

function exactScreenshotAsset(
  run: VisualRunContext,
  screenshot: z.infer<typeof ScreenshotAssertionSchema>,
  role: "baseline" | "actual" | "diff",
  artifactPath: string
): VisualRunEvidenceAsset {
  const matches = run.evidenceAssets.filter((asset) => asset.role === role && asset.path === artifactPath);
  if (matches.length !== 1) throw new Error(`Visual Hive screenshot ${screenshot.screenshotName} must bind exactly one ${role} asset.`);
  const asset = matches[0]!;
  if (asset.assertion.contractId !== screenshot.contractId || asset.assertion.screenshotName !== screenshot.screenshotName || asset.assertion.route !== screenshot.route || asset.assertion.viewportId !== screenshot.viewport) {
    throw new Error(`Visual Hive screenshot ${screenshot.screenshotName} ${role} asset has a mismatched assertion identity.`);
  }
  return asset;
}

function verifyCaptureBinding(report: ParsedReport, run: VisualRunContext, manifest: VisualHiveBundleManifest, phase: "before" | "after"): void {
  const missingBaseline = report.results.some((result) =>
    (result.screenshotAssertions ?? []).some((screenshot) => screenshot.status === "missing_baseline")
  );
  const expectedStatus = run.execution.browser.name === "unavailable" || missingBaseline
    ? "blocked"
    : report.status === "failed" ? "failed" : "passed";
  if (run.capture.status !== expectedStatus) {
    throw new Error(`Visual Hive ${phase} capture status does not match its deterministic report and runtime evidence.`);
  }
  if (manifest.verdict !== report.status || manifest.source.conclusion !== report.status) {
    throw new Error(`Visual Hive ${phase} bundle verdict does not match its deterministic report.`);
  }
  if (manifest.mode !== "full") {
    throw new Error(`Visual Hive ${phase} repair bundle must identify a full execution.`);
  }
  if (manifest.scan.authoritativeForResolution && expectedStatus === "blocked") {
    throw new Error(`Visual Hive ${phase} bundle cannot claim authority from a blocked capture.`);
  }
}

function verifyReportSummary(report: ParsedReport): void {
  const screenshots = report.results.flatMap((result) => result.screenshotAssertions ?? []);
  for (const result of report.results) {
    const structuredFailures = [
      ...result.errors,
      ...(result.selectorAssertions ?? []).filter((assertion) => assertion.status === "failed").map((assertion) => assertion.message ?? `Selector ${assertion.kind} failed.`),
      ...(result.flowSteps ?? []).filter((step) => step.status === "failed").map((step) => step.message ?? `Flow step ${step.action} failed.`),
      ...(result.screenshotAssertions ?? []).filter((screenshot) => screenshot.status === "failed" || screenshot.status === "missing_baseline").map((screenshot) => screenshot.message ?? `Screenshot ${screenshot.screenshotName} failed.`),
      ...(result.consoleErrors ?? []).map((error) => error.message),
      ...(result.pageErrors ?? []).map((error) => error.message),
      ...(result.networkErrors ?? []).map((error) => `${error.status} ${error.url}`)
    ];
    if ((result.status === "passed" || result.status === "created") && structuredFailures.length > 0) throw new Error(`Visual Hive contract ${result.contractId} reports success despite structured deterministic failures.`);
    if (result.status === "failed" && structuredFailures.length === 0) throw new Error(`Visual Hive contract ${result.contractId} reports failure without structured evidence.`);
    const created = (result.screenshotAssertions ?? []).some((screenshot) => screenshot.status === "created");
    if ((result.status === "created") !== created) throw new Error(`Visual Hive contract ${result.contractId} baseline-creation status is inconsistent.`);
  }
  const expected = {
    passed: report.results.filter((result) => result.status === "passed" || result.status === "created").length,
    failed: report.results.filter((result) => result.status === "failed").length,
    screenshotsPassed: screenshots.filter((item) => item.status === "passed" || item.status === "created").length,
    screenshotsFailed: screenshots.filter((item) => item.status === "failed" || item.status === "missing_baseline").length,
    baselinesCreated: screenshots.filter((item) => item.status === "created").length,
    missingBaselines: screenshots.filter((item) => item.status === "missing_baseline" || item.message?.toLowerCase().includes("missing screenshot baseline")).length,
    visualDiffs: screenshots.filter((item) => item.status === "failed").length,
    consoleErrors: report.results.reduce((sum, result) => sum + (result.consoleErrors?.length ?? 0), 0),
    pageErrors: report.results.reduce((sum, result) => sum + (result.pageErrors?.length ?? 0), 0)
  };
  if (report.summary.passed !== expected.passed || report.summary.failed !== expected.failed || report.summary.screenshotsPassed !== expected.screenshotsPassed || report.summary.screenshotsFailed !== expected.screenshotsFailed || report.summary.baselinesCreated !== expected.baselinesCreated || report.summary.createdBaselines !== expected.baselinesCreated || report.summary.missingBaselines !== expected.missingBaselines || report.summary.visualDiffs !== expected.visualDiffs || report.summary.consoleErrors !== expected.consoleErrors || report.summary.pageErrors !== expected.pageErrors) {
    throw new Error("Visual Hive report summary does not recompute from structured contract results.");
  }
  const expectedStatus = report.results.some((result) => result.status === "failed") ? "failed" : "passed";
  if (report.status !== expectedStatus) throw new Error(`Visual Hive report status mismatch: expected ${expectedStatus}, got ${report.status}.`);
}

function verifyEvidenceAsset(manifest: VisualHiveBundleManifest, payloads: Map<string, Buffer>, asset: VisualRunEvidenceAsset): void {
  const bytes = requireBundlePayload(manifest, payloads, asset.path);
  if (sha256Bytes(bytes) !== asset.sha256 || bytes.byteLength !== asset.size) throw new Error(`Visual Hive evidence asset bytes do not match ${asset.assetId}.`);
  const image = inspectVisualImageBytes(bytes);
  if (image.mediaType !== asset.mediaType || image.width !== asset.width || image.height !== asset.height) throw new Error(`Visual Hive evidence asset image identity does not match ${asset.assetId}.`);
}

function exactFinding(bundle: VisualHiveBundleManifest, findingIdentity: ParsedHiveRepairResult["finding"]): ParsedBundleObservation | undefined {
  const matches = bundle.observations.filter((observation) =>
    observation.fingerprint === findingIdentity.fingerprint &&
    observation.repositoryFingerprint === findingIdentity.repositoryFingerprint &&
    observation.publicationRole === findingIdentity.publicationRole &&
    observation.rootCauseKey === findingIdentity.rootCauseKey
  );
  if (matches.length > 1) throw new Error(`Visual Hive bundle contains duplicate finding observations for ${findingIdentity.fingerprint}.`);
  const finding = matches[0] as ParsedBundleObservation | undefined;
  if (finding && finding.publicationRole !== "canonical") throw new Error(`Visual Hive repair validation requires a canonical finding observation for ${findingIdentity.fingerprint}.`);
  if (finding?.state === "absent" && (!bundle.scan.authoritativeForResolution || bundle.scan.scope !== "full")) throw new Error(`Visual Hive finding absence is not backed by an authoritative full scan for ${findingIdentity.fingerprint}.`);
  return finding;
}

function deriveObligations(task: VisualHiveTaskContext, before: VerifiedRunArtifacts, after: VerifiedRunArtifacts): Pick<VisualRepairValidationInput, "obligations" | "screenshotTriplets"> {
  const obligations: VisualRepairValidationInput["obligations"] = [];
  const screenshotTriplets: VisualRepairValidationInput["screenshotTriplets"] = [];
  const afterResults = new Map(after.report.results.map((result) => [result.contractId, result]));
  for (const obligation of task.obligations) {
    const deterministic = obligation.authority === "deterministic";
    const results = obligation.mappedContractIds.map((contractId) => afterResults.get(contractId));
    const pairing = pairedActualAssets(obligation, before, after);
    const pairs = pairing.pairs;
    const evidenceAssetIds = sortedUnique(pairs.flatMap((pair) => [pair.before.assetId, pair.after.assetId]));
    let status: "passed" | "failed" | "blocked" | "not_evaluated";
    let reason: string | undefined;
    if (!isExecutableScreenshotObligation(obligation)) {
      status = deterministic ? "blocked" : "not_evaluated";
      reason = obligation.status === "unresolved" || obligation.status === "blocked"
        ? obligation.unresolvedReason ?? `Obligation is ${obligation.status}.`
        : "Obligation has no executable mapped status with an exact route, state, and viewport.";
    } else if (obligation.mappedContractIds.length === 0 || results.some((result) => !result)) {
      status = "not_evaluated";
      reason = "One or more obligation contracts have no structured after-run result.";
    } else if (!pairing.complete) {
      status = "blocked";
      reason = pairing.reason;
    } else if (results.some((result) => result!.status === "failed" && !resultBlockedOnly(after.report, result!))) {
      status = "failed";
      reason = results.flatMap((result) => result?.errors ?? [])[0] ?? "A deterministic obligation contract failed.";
    } else if (results.some((result) => result!.status !== "passed") || pairs.length === 0) {
      status = "blocked";
      reason = pairs.length === 0 ? "No assertion-identical before/after screenshot pair was available." : "An obligation contract was skipped, blocked, or created a baseline.";
    } else {
      status = "passed";
    }
    obligations.push({ obligationId: obligation.obligationId, deterministic, status, contractIds: obligation.mappedContractIds, evidenceAssetIds, ...(reason ? { reason } : {}) });
    for (const pair of pairs) {
      const comparison = compareVisualPngBytes(before.payloads.get(pair.before.path)!, after.payloads.get(pair.after.path)!);
      screenshotTriplets.push({
        obligationId: obligation.obligationId,
        beforeAssetId: pair.before.assetId,
        afterAssetId: pair.after.assetId,
        diffPixels: comparison.diffPixels,
        totalPixels: comparison.totalPixels,
        diffRatio: comparison.diffRatio
      });
    }
  }
  return { obligations, screenshotTriplets };
}

function pairedActualAssets(
  obligation: VisualHiveTaskContext["obligations"][number],
  before: VerifiedRunArtifacts,
  after: VerifiedRunArtifacts
): { pairs: Array<{ before: VisualRunEvidenceAsset; after: VisualRunEvidenceAsset }>; complete: boolean; reason?: string } {
  const beforeAssets = before.runContext.evidenceAssets.filter((asset) =>
    asset.role === "actual" && asset.obligationIds.includes(obligation.obligationId) && obligationMatchesEvidenceAssertion(obligation, asset)
  );
  const afterAssets = after.runContext.evidenceAssets.filter((asset) =>
    asset.role === "actual" && asset.obligationIds.includes(obligation.obligationId) && obligationMatchesEvidenceAssertion(obligation, asset)
  );
  uniqueBy(beforeAssets, assertionKey, `before assertion evidence for obligation ${obligation.obligationId}`);
  uniqueBy(afterAssets, assertionKey, `after assertion evidence for obligation ${obligation.obligationId}`);
  const beforeKeys = beforeAssets.map(assertionKey).sort(stableTextCompare);
  const afterKeys = afterAssets.map(assertionKey).sort(stableTextCompare);
  const coveredBeforeContracts = sortedUnique(beforeAssets.map((asset) => asset.assertion.contractId));
  const coveredAfterContracts = sortedUnique(afterAssets.map((asset) => asset.assertion.contractId));
  const expectedContracts = sortedUnique(obligation.mappedContractIds);
  if (canonicalJson(beforeKeys) !== canonicalJson(afterKeys)) {
    return { pairs: [], complete: false, reason: "Expected assertion-identical before and after screenshot evidence was incomplete." };
  }
  if (beforeAssets.length === 0) {
    return { pairs: [], complete: false, reason: "No exact before and after screenshot evidence matched the obligation contract, route, state, and viewport." };
  }
  if (canonicalJson(coveredBeforeContracts) !== canonicalJson(expectedContracts) || canonicalJson(coveredAfterContracts) !== canonicalJson(expectedContracts)) {
    return { pairs: [], complete: false, reason: "Expected before and after screenshot evidence did not cover every mapped obligation contract." };
  }
  const afterByAssertion = new Map(afterAssets.map((asset) => [assertionKey(asset), asset]));
  const pairs = beforeAssets.map((beforeAsset) => {
    const afterAsset = afterByAssertion.get(assertionKey(beforeAsset));
    if (!afterAsset) throw new Error(`Visual Hive obligation ${obligation.obligationId} lost an expected after screenshot.`);
    if (beforeAsset.assetId === afterAsset.assetId) throw new Error(`Visual Hive before and after evidence assets reuse ID ${beforeAsset.assetId}.`);
    return { before: beforeAsset, after: afterAsset };
  });
  return { pairs, complete: true };
}

function assertionKey(asset: VisualRunEvidenceAsset): string {
  return canonicalSha256(asset.assertion);
}

function isExecutableScreenshotObligation(obligation: VisualHiveTaskContext["obligations"][number]): boolean {
  return obligation.route !== undefined && obligation.state !== undefined && obligation.viewportId !== undefined &&
    obligation.mappedContractIds.length > 0 && ["mapped", "executed", "passed", "failed"].includes(obligation.status);
}

function obligationMatchesEvidenceAssertion(
  obligation: VisualHiveTaskContext["obligations"][number],
  asset: VisualRunEvidenceAsset
): boolean {
  return obligation.mappedContractIds.includes(asset.assertion.contractId) && obligation.route === asset.assertion.route &&
    obligation.state === asset.assertion.state && obligation.viewportId === asset.assertion.viewportId;
}

function deriveTargetedLane(task: VisualHiveTaskContext, after: VerifiedRunArtifacts, obligations: VisualRepairValidationInput["obligations"]): VisualRepairValidationInput["lanes"]["targeted"] {
  const contractIds = sortedUnique(task.obligations.filter((item) => item.authority === "deterministic").flatMap((item) => item.mappedContractIds));
  const failures = obligations.filter((item) => item.deterministic && item.status !== "passed").map((item) => item.reason ?? `${item.obligationId} ${item.status}`);
  const status = after.runContext.capture.status === "blocked" || obligations.some((item) => item.deterministic && (item.status === "blocked" || item.status === "not_evaluated"))
    ? "blocked"
    : obligations.some((item) => item.deterministic && item.status === "failed") ? "failed" : "passed";
  return { profileId: after.runContext.execution.profileId, status, evaluatedContractIds: status === "blocked" ? contractIds.filter((id) => after.report.results.some((result) => result.contractId === id)) : contractIds, failures: status === "passed" ? [] : failures.length > 0 ? failures : after.runContext.capture.failures };
}

function deriveRegressionLane(after: VerifiedRunArtifacts): VisualRepairValidationInput["lanes"]["regression"] {
  const expected = sortedUnique(after.runContext.execution.cases.flatMap((executionCase) => executionCase.contractIds));
  const results = new Map(after.report.results.map((result) => [result.contractId, result]));
  const missing = expected.filter((contractId) => !results.has(contractId));
  const blocked = after.runContext.capture.status === "blocked" || missing.length > 0 || after.report.targetLifecycle.some((event) => event.status === "failed") || after.report.selectedTargets.some((target) => (target.missingSecrets?.length ?? 0) > 0) || after.report.results.some((result) => result.status === "created" || result.status === "skipped" || resultBlockedOnly(after.report, result));
  const failed = after.report.results.some((result) => result.status === "failed" && !resultBlockedOnly(after.report, result));
  const status = blocked ? "blocked" : failed ? "failed" : "passed";
  const failures = [
    ...after.runContext.capture.failures,
    ...missing.map((contractId) => `Missing structured result for ${contractId}.`),
    ...after.report.targetLifecycle.filter((event) => event.status === "failed").map((event) => event.message ?? `${event.targetId} ${event.phase} failed.`),
    ...after.report.results.filter((result) => result.status !== "passed").flatMap((result) => result.errors.length > 0 ? result.errors : [`${result.contractId} ${result.status}.`])
  ];
  return { profileId: after.runContext.execution.profileId, status, evaluatedContractIds: expected.filter((contractId) => results.has(contractId)), failures: status === "passed" ? [] : failures.length > 0 ? sortedUnique(failures) : [`Regression lane ${status}.`] };
}

function deriveMutationLane(beforeFinding: ParsedBundleObservation | undefined, mutation?: ParsedMutationReport): VisualRepairValidationInput["lanes"]["mutation"] {
  if (!mutation) {
    if (beforeFinding?.issueKind === "mutation_survivor") return { status: "blocked", killed: 0, survived: 0, operatorIds: [] };
    return { status: "not_required", killed: 0, survived: 0, operatorIds: [] };
  }
  const applicable = mutation.results.filter((result) => result.applicable && result.status !== "not_applicable");
  const survived = applicable.filter((result) => result.status === "survived" || result.status === "error").length;
  const killed = applicable.filter((result) => result.status === "killed" && result.killed).length;
  const operatorIds = sortedUnique(applicable.map((result) => safeId("mutation", result.operator)));
  if (applicable.length === 0) return { status: "blocked", killed, survived, operatorIds };
  return { status: survived > 0 || mutation.score < mutation.minScore ? "failed" : "passed", killed, survived, operatorIds };
}

function deriveFailures(before: VerifiedRunArtifacts, after: VerifiedRunArtifacts): { remaining: VisualRepairValidationInput["remainingFailures"]; introduced: VisualRepairValidationInput["newFailures"] } {
  const beforeFailures = failureMap(before);
  const afterFailures = failureMap(after);
  const remaining = [...afterFailures.values()].sort((left, right) => stableTextCompare(left.id, right.id));
  const introduced = [...afterFailures.entries()].filter(([id]) => !beforeFailures.has(id)).map(([, failure]) => failure).sort((left, right) => stableTextCompare(left.id, right.id));
  return { remaining, introduced };
}

function failureMap(run: VerifiedRunArtifacts): Map<string, VisualRepairValidationInput["remainingFailures"][number]> {
  const failures = new Map<string, VisualRepairValidationInput["remainingFailures"][number]>();
  for (const observation of run.bundle.observations.filter((item) => item.state === "present")) {
    const id = safeId("finding", observation.fingerprint);
    failures.set(id, { id, severity: observation.severity, message: observation.title });
  }
  for (const result of run.report.results.filter((item) => item.status === "failed" && !resultBlockedOnly(run.report, item))) {
    const id = safeId("contract", result.contractId);
    failures.set(id, { id, severity: "high", message: result.errors[0] ?? `Contract ${result.contractId} failed.` });
  }
  return failures;
}

function derivePolicyChanges(before: VisualRunContext, after: VisualRunContext): VisualRepairValidationInput["policyChanges"] {
  return {
    configChanged: before.execution.configDigest !== after.execution.configDigest,
    validationPolicyChanged: before.execution.validationPolicyDigest !== after.execution.validationPolicyDigest,
    thresholdWeakened: thresholdsWeakened(before.thresholds, after.thresholds),
    baselineChanged: before.execution.baselineIdentityDigest !== after.execution.baselineIdentityDigest
  };
}

function thresholdsWeakened(before: VisualRunThreshold[], after: VisualRunThreshold[]): boolean {
  const afterByContract = new Map(after.map((threshold) => [threshold.contractId, threshold]));
  return before.some((threshold) => {
    const next = afterByContract.get(threshold.contractId);
    if (!next) return true;
    if (next.maxDiffPixelRatio > threshold.maxDiffPixelRatio) return true;
    if (threshold.maxDiffPixels !== undefined && (next.maxDiffPixels === undefined || next.maxDiffPixels > threshold.maxDiffPixels)) return true;
    return threshold.missingBaseline === "fail" && next.missingBaseline === "create";
  });
}

function resultBlockedOnly(report: ParsedReport, result: ParsedReport["results"][number]): boolean {
  const blocking = report.targetLifecycle.some((event) => event.targetId === result.targetId && event.status === "failed") ||
    report.selectedTargets.some((target) => target.id === result.targetId && (target.missingSecrets?.length ?? 0) > 0) ||
    (result.screenshotAssertions ?? []).some((screenshot) => screenshot.status === "missing_baseline");
  const regression = result.status === "failed" && ((result.selectorAssertions ?? []).some((assertion) => assertion.status === "failed") ||
    (result.flowSteps ?? []).some((step) => step.status === "failed") || (result.screenshotAssertions ?? []).some((screenshot) => screenshot.status === "failed") ||
    (result.consoleErrors?.length ?? 0) > 0 || (result.pageErrors?.length ?? 0) > 0 || (result.networkErrors?.length ?? 0) > 0);
  return blocking && !regression;
}

function payloadMap(payloads: readonly RawRepairArtifact[]): Map<string, Buffer> {
  const output = new Map<string, Buffer>();
  for (const artifact of payloads) {
    const sourcePath = RelativeArtifactPathSchema.parse(artifact.sourcePath);
    if (output.has(sourcePath)) throw new Error(`Duplicate Visual Hive raw artifact payload: ${sourcePath}.`);
    output.set(sourcePath, Buffer.from(artifact.bytes));
  }
  return output;
}

function requireBundlePayload(manifest: VisualHiveBundleManifest, payloads: Map<string, Buffer>, sourcePath: string): Buffer {
  const records = manifest.files.filter((file) => file.sourcePath === sourcePath);
  if (records.length !== 1) throw new Error(`Visual Hive bundle must contain exactly one file record for ${sourcePath}.`);
  const data = payloads.get(sourcePath);
  if (!data) throw new Error(`Visual Hive bundle payload is missing ${sourcePath}.`);
  const record = records[0]!;
  if (record.size !== data.byteLength || record.sha256 !== sha256Bytes(data)) throw new Error(`Visual Hive bundle payload does not match its file record: ${sourcePath}.`);
  return data;
}

function parseJsonArtifact(artifact: RawRepairArtifact): unknown {
  RelativeArtifactPathSchema.parse(artifact.sourcePath);
  return parseJsonBytes(Buffer.from(artifact.bytes), artifact.sourcePath);
}

function parseJsonBytes(bytes: Buffer, label: string): unknown {
  if (bytes.byteLength <= 0 || bytes.byteLength > MAX_JSON_BYTES) throw new Error(`Visual Hive JSON artifact ${label} has invalid size ${bytes.byteLength}.`);
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch (error) {
    throw new Error(`Visual Hive JSON artifact ${label} is invalid UTF-8 JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort(stableTextCompare);
}

function uniqueBy<T>(values: T[], key: (value: T) => string, label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    const identity = key(value);
    if (seen.has(identity)) throw new Error(`Duplicate Visual Hive ${label}: ${identity}.`);
    seen.add(identity);
  }
}

function safeId(prefix: string, value: string): string {
  return `${prefix}.${canonicalSha256(value).slice(0, 24)}`;
}
