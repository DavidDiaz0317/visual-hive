import { z } from "zod";
import { assertPermittedVisualTaskPath } from "./build.js";
import { canonicalJson, canonicalSha256, sha256Utf8, stableTextCompare } from "./canonical.js";
import { VisualRepairToolNameSchema, VISUAL_REPAIR_TOOL_NAMES } from "./toolProtocol.js";
import {
  BoundedIdSchema,
  GitCommitSchema,
  RelativeArtifactPathSchema,
  RepositorySchema,
  Sha256Schema
} from "./types.js";

const TimestampSchema = z.string().datetime({ offset: true });
const ShortTextSchema = z.string().trim().min(1).max(4096);
const ProviderTextSchema = z.string().trim().min(1).max(512);

export const HiveRepairFindingSchema = z.object({
  fingerprint: z.string().trim().min(1).max(2048),
  repositoryFingerprint: Sha256Schema,
  publicationRole: z.enum(["canonical", "derivative", "aggregate"]),
  rootCauseKey: z.string().trim().min(1).max(2048),
  recurrenceKey: z.string().trim().min(1).max(2048)
}).strict();

export const HiveRepairRepositorySchema = z.object({
  name: RepositorySchema,
  repositoryId: z.string().trim().min(1).max(128).optional(),
  repositoryFingerprint: Sha256Schema,
  baseSha: GitCommitSchema,
  baseTreeSha: GitCommitSchema
}).strict();

export const HiveRepairValidationProfileSchema = z.object({
  profileId: BoundedIdSchema,
  profileDigest: Sha256Schema,
  targetId: BoundedIdSchema,
  requestKinds: z.array(z.enum(["reproduction", "capture", "patch_validation"])).min(1).max(3),
  contractIds: z.array(BoundedIdSchema).max(256),
  routes: z.array(z.string().min(1).max(2048)).max(128),
  scenarioIds: z.array(BoundedIdSchema).max(128),
  viewports: z.array(z.object({
    viewportId: BoundedIdSchema,
    width: z.number().int().positive().max(16_384),
    height: z.number().int().positive().max(16_384),
    deviceScaleFactor: z.number().positive().max(8)
  }).strict()).min(1).max(32),
  validationCommandId: BoundedIdSchema
}).strict();

export const HiveRepairSourceContextSchema = z.object({
  digest: Sha256Schema,
  maxBytes: z.number().int().positive().max(64 * 1024 * 1024),
  totalBytes: z.number().int().nonnegative().max(64 * 1024 * 1024),
  files: z.array(z.object({
    path: RelativeArtifactPathSchema,
    sha256: Sha256Schema,
    size: z.number().int().nonnegative().max(8 * 1024 * 1024),
    classification: z.enum(["source", "test", "config", "documentation"])
  }).strict()).max(512),
  omittedPaths: z.number().int().nonnegative(),
  truncated: z.boolean()
}).strict();

export const HiveRepairBudgetLimitsSchema = z.object({
  maxTurns: z.number().int().positive().max(128),
  maxToolCalls: z.number().int().positive().max(128),
  maxInputBytes: z.number().int().positive().max(64 * 1024 * 1024),
  maxImageBytes: z.number().int().nonnegative().max(256 * 1024 * 1024),
  maxModelInputTokens: z.number().int().positive().max(10_000_000),
  maxModelOutputTokens: z.number().int().positive().max(10_000_000),
  maxProviderCostUsdMicros: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  maxWallSeconds: z.number().int().positive().max(24 * 60 * 60),
  maxRepairAttempts: z.number().int().positive().max(32)
}).strict();

export type HiveRepairBudgetLimits = z.infer<typeof HiveRepairBudgetLimitsSchema>;

export const HiveRepairBudgetUsageSchema = z.object({
  turnsConsumed: z.number().int().nonnegative(),
  toolCallsConsumed: z.number().int().nonnegative(),
  inputBytesConsumed: z.number().int().nonnegative(),
  imageBytesConsumed: z.number().int().nonnegative(),
  modelInputTokensConsumed: z.number().int().nonnegative(),
  modelOutputTokensConsumed: z.number().int().nonnegative(),
  providerCostUsdMicrosConsumed: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  wallMillisecondsConsumed: z.number().int().nonnegative()
}).strict();

const HiveExecutionAuthorizationContentSchema = z.object({
  authorizationId: BoundedIdSchema,
  issuedAt: TimestampSchema,
  expiresAt: TimestampSchema,
  repositoryFingerprint: Sha256Schema,
  taskContextDigest: Sha256Schema,
  baseSha: GitCommitSchema,
  profile: HiveRepairValidationProfileSchema,
  toolNames: z.array(VisualRepairToolNameSchema).length(VISUAL_REPAIR_TOOL_NAMES.length),
  assetIds: z.array(BoundedIdSchema).max(128),
  budgetDigest: Sha256Schema,
  configDigest: Sha256Schema,
  toolRegistryDigest: Sha256Schema,
  promptSchemaDigest: Sha256Schema,
  // Optional at the v1 persistence boundary for sessions written before
  // release-artifact pinning. New authoritative executions require both.
  visualHiveManifestSha256: Sha256Schema.optional(),
  visualHiveEntrypointSha256: Sha256Schema.optional()
}).strict();

export const HiveExecutionAuthorizationSchema = HiveExecutionAuthorizationContentSchema.extend({
  authorizationDigest: Sha256Schema
}).strict().superRefine((authorization, context) => {
  if (Date.parse(authorization.expiresAt) <= Date.parse(authorization.issuedAt)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["expiresAt"], message: "Hive execution authorization must expire after it is issued." });
  }
  if (authorization.profile.profileDigest !== computeHiveRepairValidationProfileDigest(authorization.profile)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["profile", "profileDigest"], message: "Hive execution authorization profile digest is invalid." });
  }
  if (canonicalJson([...authorization.toolNames].sort(stableTextCompare)) !== canonicalJson([...VISUAL_REPAIR_TOOL_NAMES].sort(stableTextCompare))) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["toolNames"], message: "Hive execution authorization must expose exactly the frozen Visual Hive treatment tools." });
  }
  if ((authorization.visualHiveManifestSha256 === undefined) !== (authorization.visualHiveEntrypointSha256 === undefined)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["visualHiveManifestSha256"], message: "Visual Hive manifest and entrypoint identities must be provided together." });
  }
});

export const HiveExecutionAuthorizationInputSchema = HiveExecutionAuthorizationContentSchema;

export const HiveRepairToolReceiptSchema = z.object({
  callId: Sha256Schema,
  turnId: Sha256Schema,
  sequence: z.number().int().nonnegative(),
  toolName: VisualRepairToolNameSchema,
  argumentsDigest: Sha256Schema,
  resultDigest: Sha256Schema.optional(),
  status: z.enum(["started", "passed", "failed", "blocked", "lost"]),
  startedAt: TimestampSchema,
  completedAt: TimestampSchema.optional(),
  textBytes: z.number().int().nonnegative().max(16 * 1024 * 1024),
  imageBytes: z.number().int().nonnegative().max(64 * 1024 * 1024),
  errorCode: BoundedIdSchema.optional(),
  outcomeDigest: Sha256Schema.optional()
}).strict().superRefine((receipt, context) => {
  if (receipt.status === "started" && receipt.completedAt !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["completedAt"], message: "A started tool call cannot be completed." });
  }
  if (receipt.status !== "started" && receipt.completedAt === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["completedAt"], message: "A terminal tool call requires a completion time." });
  }
  if (receipt.status === "passed" && receipt.resultDigest === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["resultDigest"], message: "A passed tool call requires a result digest." });
  }
  if ((receipt.status === "failed" || receipt.status === "blocked" || receipt.status === "lost") && receipt.errorCode === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["errorCode"], message: "An unsuccessful tool call requires an error code." });
  }
  if ((receipt.status === "started" || receipt.status === "passed") && receipt.errorCode !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["errorCode"], message: "A started or passed tool call cannot carry an error code." });
  }
  if (receipt.status === "started" && receipt.outcomeDigest !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["outcomeDigest"], message: "A started tool call cannot carry a terminal outcome digest." });
  }
  if (receipt.status !== "started" && receipt.outcomeDigest === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["outcomeDigest"], message: "A terminal tool call requires an outcome digest." });
  }
  if (receipt.status !== "started" && receipt.outcomeDigest !== computeHiveRepairToolOutcomeDigest(receipt)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["outcomeDigest"], message: "Hive repair tool outcome digest is invalid." });
  }
  if (receipt.completedAt !== undefined && Date.parse(receipt.completedAt) < Date.parse(receipt.startedAt)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["completedAt"], message: "A tool call cannot complete before it starts." });
  }
});

export const HiveRepairProviderUsageSchema = z.object({
  inputBytes: z.number().int().nonnegative(),
  imageBytes: z.number().int().nonnegative(),
  modelInputTokens: z.number().int().nonnegative(),
  modelOutputTokens: z.number().int().nonnegative(),
  providerCostUsdMicros: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  wallMilliseconds: z.number().int().nonnegative()
}).strict();

export const HiveRepairTurnSchema = z.object({
  turnId: Sha256Schema,
  attemptId: BoundedIdSchema,
  ordinal: z.number().int().nonnegative(),
  state: z.enum(["started", "completed", "failed", "blocked", "lost"]),
  startedAt: TimestampSchema,
  completedAt: TimestampSchema.optional(),
  inputDigest: Sha256Schema,
  providerInputDigest: Sha256Schema,
  previousTurnOutputDigest: Sha256Schema.optional(),
  consumedToolOutcomeDigests: z.array(Sha256Schema).max(128),
  providerIdentityDigest: Sha256Schema,
  usage: HiveRepairProviderUsageSchema.optional(),
  providerReceiptDigest: Sha256Schema.optional(),
  outputKind: z.enum(["tool_request", "final_result", "error"]).optional(),
  outputDigest: Sha256Schema.optional(),
  toolCallId: Sha256Schema.optional(),
  errorCode: BoundedIdSchema.optional()
}).strict().superRefine((turn, context) => {
  if (turn.state === "started" && turn.completedAt !== undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ["completedAt"], message: "A started turn cannot be completed." });
  if (turn.state !== "started" && turn.completedAt === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ["completedAt"], message: "A terminal turn requires a completion time." });
  if (turn.state === "completed" && (turn.outputKind === undefined || turn.outputDigest === undefined)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["outputDigest"], message: "A completed turn requires output kind and digest." });
  if (turn.outputKind === "tool_request" && turn.toolCallId === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ["toolCallId"], message: "A tool-request turn requires a tool call ID." });
  if (turn.outputKind !== "tool_request" && turn.toolCallId !== undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ["toolCallId"], message: "Only a tool-request turn may name a tool call." });
  if (turn.state === "started" && (turn.outputKind !== undefined || turn.outputDigest !== undefined || turn.toolCallId !== undefined || turn.errorCode !== undefined)) context.addIssue({ code: z.ZodIssueCode.custom, message: "A started turn cannot carry output or error fields." });
  if ((turn.state === "failed" || turn.state === "blocked" || turn.state === "lost") && turn.errorCode === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ["errorCode"], message: "An unsuccessful turn requires an error code." });
  if (turn.state === "started" && (turn.usage !== undefined || turn.providerReceiptDigest !== undefined)) context.addIssue({ code: z.ZodIssueCode.custom, message: "A started turn cannot carry provider usage or a provider receipt." });
  if (turn.state !== "started" && turn.usage === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ["usage"], message: "A terminal turn requires provider usage." });
  if (turn.state !== "started" && turn.state !== "lost" && turn.providerReceiptDigest === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ["providerReceiptDigest"], message: "A provider-completed turn requires a provider receipt." });
  if (turn.completedAt !== undefined && Date.parse(turn.completedAt) < Date.parse(turn.startedAt)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["completedAt"], message: "A turn cannot complete before it starts." });
});

export const HiveRepairAttemptSchema = z.object({
  attemptId: BoundedIdSchema,
  ordinal: z.number().int().nonnegative(),
  state: z.enum(["started", "candidate", "failed", "blocked", "exhausted"]),
  startedAt: TimestampSchema,
  completedAt: TimestampSchema.optional(),
  promptDigest: Sha256Schema,
  turnIds: z.array(Sha256Schema).max(128),
  candidatePatchDigest: Sha256Schema.optional(),
  candidateHeadSha: GitCommitSchema.optional(),
  candidateHeadTreeSha: GitCommitSchema.optional(),
  validationRequestIds: z.array(BoundedIdSchema).max(128)
}).strict().superRefine((attempt, context) => {
  if (attempt.state === "started" && attempt.completedAt !== undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ["completedAt"], message: "A started attempt cannot be completed." });
  if (attempt.state !== "started" && attempt.completedAt === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ["completedAt"], message: "A terminal attempt requires a completion time." });
  const candidateFields = [attempt.candidatePatchDigest, attempt.candidateHeadSha, attempt.candidateHeadTreeSha];
  if (attempt.state === "candidate" && candidateFields.some((value) => value === undefined)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["candidatePatchDigest"], message: "A candidate attempt requires patch, head commit, and head tree identity." });
  if (candidateFields.some((value) => value !== undefined) && candidateFields.some((value) => value === undefined)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["candidatePatchDigest"], message: "Hive repair candidate identity fields must be provided together." });
  if (attempt.completedAt !== undefined && Date.parse(attempt.completedAt) < Date.parse(attempt.startedAt)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["completedAt"], message: "An attempt cannot complete before it starts." });
});

const HiveRepairValidationRequestSpecObjectSchema = z.object({
  requestId: BoundedIdSchema,
  idempotencyKey: Sha256Schema,
  sessionId: Sha256Schema,
  attemptId: BoundedIdSchema,
  kind: z.enum(["reproduction", "capture", "patch_validation"]),
  commitRole: z.enum(["base", "candidate"]),
  profileId: BoundedIdSchema,
  profileDigest: Sha256Schema,
  commitSha: GitCommitSchema,
  authorizationDigest: Sha256Schema.optional(),
  requestDigest: Sha256Schema
}).strict();

type HiveRepairValidationRequestSpecContract = z.infer<typeof HiveRepairValidationRequestSpecObjectSchema>;

export const HiveRepairValidationRequestSpecSchema = HiveRepairValidationRequestSpecObjectSchema.superRefine((request, context) => {
  if (request.requestId !== computeHiveRepairValidationRequestId(request)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["requestId"], message: "Hive repair validation request ID is invalid." });
  if (request.idempotencyKey !== computeHiveRepairValidationRequestIdentity(request)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["idempotencyKey"], message: "Hive repair validation request idempotency key is invalid." });
  if (request.requestDigest !== computeHiveRepairValidationRequestDigest(request)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["requestDigest"], message: "Hive repair validation request digest is invalid." });
});

export const HiveRepairValidationRequestSchema = HiveRepairValidationRequestSpecObjectSchema.extend({
  state: z.enum(["requested", "started", "completed", "failed", "blocked", "lost"]),
  requestedAt: TimestampSchema,
  startedAt: TimestampSchema.optional(),
  completedAt: TimestampSchema.optional(),
  receiptDigest: Sha256Schema.optional(),
  errorCode: BoundedIdSchema.optional()
}).strict().superRefine((request, context) => {
  if (request.requestId !== computeHiveRepairValidationRequestId(request)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["requestId"], message: "Hive repair validation request ID is invalid." });
  if (request.idempotencyKey !== computeHiveRepairValidationRequestIdentity(request)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["idempotencyKey"], message: "Hive repair validation request idempotency key is invalid." });
  if (request.requestDigest !== computeHiveRepairValidationRequestDigest(request)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["requestDigest"], message: "Hive repair validation request digest is invalid." });
  if (request.state === "requested" && (request.startedAt !== undefined || request.completedAt !== undefined || request.receiptDigest !== undefined || request.errorCode !== undefined)) context.addIssue({ code: z.ZodIssueCode.custom, message: "A requested validation operation cannot carry execution or terminal fields." });
  if (request.state === "started" && (request.startedAt === undefined || request.completedAt !== undefined || request.receiptDigest !== undefined || request.errorCode !== undefined)) context.addIssue({ code: z.ZodIssueCode.custom, message: "A started validation operation requires only its start time." });
  if (request.state === "completed" && (request.startedAt === undefined || request.completedAt === undefined || request.receiptDigest === undefined || request.errorCode !== undefined)) context.addIssue({ code: z.ZodIssueCode.custom, message: "A completed validation operation requires start, completion, and receipt fields without an error." });
  if ((request.state === "failed" || request.state === "blocked" || request.state === "lost") && (request.completedAt === undefined || request.errorCode === undefined)) context.addIssue({ code: z.ZodIssueCode.custom, message: "An unsuccessful validation operation requires completion and error fields." });
  if (request.startedAt !== undefined && Date.parse(request.startedAt) < Date.parse(request.requestedAt)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["startedAt"], message: "A validation operation cannot start before it is requested." });
  if (request.completedAt !== undefined && Date.parse(request.completedAt) < Date.parse(request.startedAt ?? request.requestedAt)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["completedAt"], message: "A validation operation cannot complete before it starts." });
});

const HiveRepairSessionBaseSchema = z.object({
  schemaVersion: z.literal("hive.repair-session.v1"),
  digestAlgorithm: z.literal("hive.canonical-json.sha256.v1"),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  deadlineAt: TimestampSchema,
  requestedMode: z.enum(["off", "auto", "on", "required"]),
  effectiveMode: z.enum(["standard", "visual_hive"]),
  state: z.enum(["planned", "active", "awaiting_validation", "candidate", "completed", "failed", "blocked", "exhausted"]),
  terminal: z.object({
    code: z.enum(["completed", "provider_failed", "provider_identity_mismatch", "tool_failed", "validation_failed", "authorization_expired", "budget_exhausted", "blocked", "internal_error"]),
    message: ShortTextSchema,
    retryable: z.boolean(),
    exhaustedLimit: z.enum(["turns", "tool_calls", "input_bytes", "image_bytes", "model_input_tokens", "model_output_tokens", "provider_cost", "wall_time", "repair_attempts"]).optional()
  }).strict().optional(),
  repository: HiveRepairRepositorySchema,
  finding: HiveRepairFindingSchema,
  task: z.object({
    taskId: BoundedIdSchema,
    taskContextDigest: Sha256Schema,
    issueSource: z.enum(["swebench_multimodal", "github", "fixture", "other"]),
    issueExternalId: z.string().trim().min(1).max(512),
    problemStatementDigest: Sha256Schema,
    imageAttachments: z.array(z.object({
      position: z.number().int().nonnegative().max(63),
      assetId: BoundedIdSchema,
      role: z.enum(["problem", "expected", "current", "reference"]),
      sha256: Sha256Schema,
      mediaType: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]),
      size: z.number().int().positive().max(32 * 1024 * 1024)
    }).strict()).max(64)
  }).strict(),
  capability: z.object({
    selectionReasons: z.array(ShortTextSchema).max(64),
    visualHiveVersion: ProviderTextSchema.optional(),
    visualHiveCommit: GitCommitSchema.optional(),
    visualHiveManifestSha256: Sha256Schema.optional(),
    visualHiveEntrypointSha256: Sha256Schema.optional(),
    toolProtocolDigest: Sha256Schema.optional(),
    validationToolRegistryDigest: Sha256Schema.optional()
  }).strict(),
  sourceContext: HiveRepairSourceContextSchema,
  validationProfiles: z.array(HiveRepairValidationProfileSchema).max(64),
  promptIdentities: z.object({
    systemPromptDigest: Sha256Schema,
    repairPromptDigest: Sha256Schema,
    toolSchemaDigest: Sha256Schema,
    taskSchemaDigest: Sha256Schema,
    modelConfigurationDigest: Sha256Schema
  }).strict(),
  executionIdentities: z.object({
    configDigest: Sha256Schema,
    toolRegistryDigest: Sha256Schema,
    promptSchemaDigest: Sha256Schema
  }).strict(),
  provider: z.object({
    providerId: BoundedIdSchema,
    providerKind: ProviderTextSchema,
    model: ProviderTextSchema,
    executableIdentityDigest: Sha256Schema,
    capabilityDigest: Sha256Schema,
    modelConfigurationDigest: Sha256Schema
  }).strict(),
  budgets: z.object({ limits: HiveRepairBudgetLimitsSchema, usage: HiveRepairBudgetUsageSchema }).strict(),
  attempts: z.array(HiveRepairAttemptSchema).max(32),
  turns: z.array(HiveRepairTurnSchema).max(4096),
  toolReceipts: z.array(HiveRepairToolReceiptSchema).max(4096),
  validationRequests: z.array(HiveRepairValidationRequestSchema).max(4096)
}).strict();

export const HiveRepairSessionInputSchema = HiveRepairSessionBaseSchema.extend({
  authorization: HiveExecutionAuthorizationInputSchema.optional()
}).strict();

const HiveRepairSessionContractSchema = HiveRepairSessionBaseSchema.extend({
  sessionId: Sha256Schema,
  authorization: HiveExecutionAuthorizationSchema.optional(),
  transcriptDigest: Sha256Schema,
  sessionDigest: Sha256Schema
}).strict();

type HiveRepairSessionBase = z.infer<typeof HiveRepairSessionBaseSchema>;
type HiveRepairSessionContract = z.infer<typeof HiveRepairSessionContractSchema>;
type HiveRepairSessionRelationshipInput = HiveRepairSessionBase & {
  authorization?: HiveExecutionAuthorization;
};

export const HiveRepairSessionSchema = HiveRepairSessionContractSchema.superRefine(
  (session, context) => validateSessionRelationships(session, context)
);

export const HiveRepairChangedFileSchema = z.object({
  path: RelativeArtifactPathSchema,
  status: z.enum(["added", "modified", "deleted", "renamed"]),
  previousPath: RelativeArtifactPathSchema.optional(),
  beforeSha256: Sha256Schema.optional(),
  afterSha256: Sha256Schema.optional(),
  beforeMode: z.string().regex(/^[0-7]{6}$/u).optional(),
  afterMode: z.string().regex(/^[0-7]{6}$/u).optional()
}).strict().superRefine((file, context) => {
  if (file.status === "added" && (file.beforeSha256 !== undefined || file.afterSha256 === undefined || file.beforeMode !== undefined || file.afterMode === undefined)) context.addIssue({ code: z.ZodIssueCode.custom, message: "An added file requires only an after digest and mode." });
  if (file.status === "deleted" && (file.beforeSha256 === undefined || file.afterSha256 !== undefined || file.beforeMode === undefined || file.afterMode !== undefined)) context.addIssue({ code: z.ZodIssueCode.custom, message: "A deleted file requires only a before digest and mode." });
  if ((file.status === "modified" || file.status === "renamed") && (file.beforeSha256 === undefined || file.afterSha256 === undefined || file.beforeMode === undefined || file.afterMode === undefined)) context.addIssue({ code: z.ZodIssueCode.custom, message: "A modified or renamed file requires before and after digests and modes." });
  if (file.status === "renamed" && file.previousPath === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ["previousPath"], message: "A renamed file requires its previous path." });
  if (file.status !== "renamed" && file.previousPath !== undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ["previousPath"], message: "Only a renamed file may have a previous path." });
  if (file.previousPath === file.path) context.addIssue({ code: z.ZodIssueCode.custom, path: ["previousPath"], message: "A renamed file must change path." });
});

const HiveRepairResultContentSchema = z.object({
  schemaVersion: z.literal("hive.repair-result.v1"),
  digestAlgorithm: z.literal("hive.canonical-json.sha256.v1"),
  generatedAt: TimestampSchema,
  sessionId: Sha256Schema,
  sessionDigest: Sha256Schema,
  transcriptDigest: Sha256Schema,
  effectiveMode: z.enum(["standard", "visual_hive"]),
  taskId: BoundedIdSchema,
  taskContextDigest: Sha256Schema,
  repository: z.object({ name: RepositorySchema, repositoryId: z.string().trim().min(1).max(128).optional(), repositoryFingerprint: Sha256Schema }).strict(),
  finding: HiveRepairFindingSchema,
  baseSha: GitCommitSchema,
  baseTreeSha: GitCommitSchema,
  headSha: GitCommitSchema,
  headTreeSha: GitCommitSchema,
  diff: z.object({
    algorithm: z.literal("git.diff.binary.sha256.v1"),
    sha256: Sha256Schema,
    changedFiles: z.array(HiveRepairChangedFileSchema).min(1).max(4096)
  }).strict(),
  provider: z.object({
    providerId: BoundedIdSchema,
    providerKind: ProviderTextSchema,
    model: ProviderTextSchema,
    executableIdentityDigest: Sha256Schema,
    capabilityDigest: Sha256Schema,
    modelConfigurationDigest: Sha256Schema
  }).strict(),
  attempts: z.array(z.object({
    attemptId: BoundedIdSchema,
    ordinal: z.number().int().nonnegative(),
    state: z.enum(["candidate", "failed", "blocked", "exhausted"]),
    promptDigest: Sha256Schema,
    startedAt: TimestampSchema,
    completedAt: TimestampSchema,
    turnCount: z.number().int().nonnegative(),
    toolCallCount: z.number().int().nonnegative()
  }).strict()).min(1).max(32),
  toolReceipts: z.array(HiveRepairToolReceiptSchema).max(4096),
  authorizationDigest: Sha256Schema.optional(),
  validationRequests: z.array(HiveRepairValidationRequestSpecSchema).min(1).max(256),
  claimedOutcome: z.object({ summary: ShortTextSchema, advisory: z.literal(true) }).strict().optional(),
  status: z.literal("candidate")
}).strict();

export const HiveRepairResultInputSchema = HiveRepairResultContentSchema;

export const HiveRepairResultSchema = HiveRepairResultContentSchema.extend({
  resultDigest: Sha256Schema
}).strict().superRefine((result, context) => {
  if (result.baseSha === result.headSha || result.baseTreeSha === result.headTreeSha) context.addIssue({ code: z.ZodIssueCode.custom, path: ["headSha"], message: "A repair candidate must differ from its base commit and tree." });
  if (result.validationRequests.some((request) => request.kind === "patch_validation" && request.commitSha !== result.headSha)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["validationRequests"], message: "Every patch-validation request must bind the repair head SHA." });
  if (result.validationRequests.some((request) => (request.kind === "patch_validation" && request.commitRole !== "candidate") || (request.kind === "reproduction" && request.commitRole !== "base"))) context.addIssue({ code: z.ZodIssueCode.custom, path: ["validationRequests"], message: "Repair validation request kind and commit role do not match." });
  if (!result.validationRequests.some((request) => request.kind === "patch_validation" && request.commitSha === result.headSha)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["validationRequests"], message: "A repair candidate requires a head-bound patch-validation request." });
  if (result.validationRequests.some((request) => request.authorizationDigest !== result.authorizationDigest)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["validationRequests"], message: "Every validation request must use the result authorization identity." });
  if (result.effectiveMode === "standard" && (result.authorizationDigest !== undefined || result.toolReceipts.length > 0)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["effectiveMode"], message: "A standard repair result cannot carry Visual Hive authorization or tool receipts." });
  if (result.effectiveMode === "visual_hive" && result.authorizationDigest === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ["authorizationDigest"], message: "A Visual Hive repair result requires execution authorization." });
  if (new Set(result.diff.changedFiles.map((file) => file.path)).size !== result.diff.changedFiles.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ["diff", "changedFiles"], message: "Repair result changed-file paths must be unique." });
  const previousPaths = result.diff.changedFiles.flatMap((file) => file.previousPath ? [file.previousPath] : []);
  if (new Set(previousPaths).size !== previousPaths.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ["diff", "changedFiles"], message: "Repair result rename source paths must be unique." });
  if (new Set(result.attempts.map((attempt) => attempt.ordinal)).size !== result.attempts.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ["attempts"], message: "Repair result attempt ordinals must be unique." });
  if (result.attempts.filter((attempt) => attempt.state === "candidate").length !== 1) context.addIssue({ code: z.ZodIssueCode.custom, path: ["attempts"], message: "A repair result requires exactly one candidate attempt." });
  if (result.attempts.some((attempt) => Date.parse(attempt.completedAt) < Date.parse(attempt.startedAt) || Date.parse(attempt.completedAt) > Date.parse(result.generatedAt))) context.addIssue({ code: z.ZodIssueCode.custom, path: ["attempts"], message: "Repair result attempt timestamps are invalid." });
  if (result.toolReceipts.some((receipt) => receipt.status === "started")) context.addIssue({ code: z.ZodIssueCode.custom, path: ["toolReceipts"], message: "A repair result cannot contain an in-flight tool call." });
  try {
    assertContiguousOrdinals(result.attempts.map((attempt) => attempt.ordinal), "result attempt");
    assertContiguousOrdinals(result.toolReceipts.map((receipt) => receipt.sequence), "result tool-call");
  } catch (error) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: error instanceof Error ? error.message : String(error) });
  }
});

export type HiveRepairFinding = z.infer<typeof HiveRepairFindingSchema>;
export type HiveRepairValidationProfile = z.infer<typeof HiveRepairValidationProfileSchema>;
export type HiveExecutionAuthorization = z.infer<typeof HiveExecutionAuthorizationSchema>;
export type HiveExecutionAuthorizationInput = z.infer<typeof HiveExecutionAuthorizationInputSchema>;
export type HiveRepairToolReceipt = z.infer<typeof HiveRepairToolReceiptSchema>;
export type HiveRepairValidationRequest = z.infer<typeof HiveRepairValidationRequestSchema>;
export type HiveRepairValidationRequestSpec = HiveRepairValidationRequestSpecContract;
export type HiveRepairSession = HiveRepairSessionContract;
export type HiveRepairSessionInput = z.infer<typeof HiveRepairSessionInputSchema>;
export type HiveRepairResult = z.infer<typeof HiveRepairResultSchema>;
export type HiveRepairResultInput = z.infer<typeof HiveRepairResultInputSchema>;

export function computeHiveRepairProviderIdentityDigest(provider: HiveRepairSessionInput["provider"]): string {
  return canonicalSha256(provider);
}

export function computeHiveRepairValidationProfileDigest(profile: HiveRepairValidationProfile): string {
  const { profileDigest: _profileDigest, ...content } = profile;
  void _profileDigest;
  return canonicalSha256({
    ...content,
    requestKinds: [...new Set(content.requestKinds)].sort(stableTextCompare),
    contractIds: sortedUnique(content.contractIds),
    routes: sortedUnique(content.routes),
    scenarioIds: sortedUnique(content.scenarioIds),
    viewports: uniqueBy(content.viewports, (viewport) => viewport.viewportId).sort((left, right) => stableTextCompare(left.viewportId, right.viewportId))
  });
}

export function computeHiveRepairSourceContextDigest(sourceContext: Pick<z.infer<typeof HiveRepairSourceContextSchema>, "files" | "omittedPaths" | "truncated">): string {
  return canonicalSha256({
    files: uniqueBy(sourceContext.files, (file) => file.path).sort((left, right) => stableTextCompare(left.path, right.path)),
    omittedPaths: sourceContext.omittedPaths,
    truncated: sourceContext.truncated
  });
}

export function computeHiveRepairValidationRequestId(request: Pick<HiveRepairValidationRequestSpec, "sessionId" | "attemptId" | "kind" | "commitRole" | "profileId" | "profileDigest" | "commitSha" | "authorizationDigest">): string {
  return canonicalSha256({
    schemaVersion: "hive.repair-validation-request-id.v1",
    sessionId: request.sessionId,
    attemptId: request.attemptId,
    kind: request.kind,
    commitRole: request.commitRole,
    profileId: request.profileId,
    profileDigest: request.profileDigest,
    commitSha: request.commitSha,
    authorizationDigest: request.authorizationDigest ?? null
  });
}

export function computeHiveRepairValidationRequestIdentity(request: Pick<HiveRepairValidationRequestSpec, "sessionId" | "attemptId" | "kind" | "commitRole" | "profileId" | "profileDigest" | "commitSha" | "authorizationDigest">): string {
  return canonicalSha256({
    schemaVersion: "hive.repair-validation-request-identity.v1",
    sessionId: request.sessionId,
    attemptId: request.attemptId,
    kind: request.kind,
    commitRole: request.commitRole,
    profileId: request.profileId,
    profileDigest: request.profileDigest,
    commitSha: request.commitSha,
    authorizationDigest: request.authorizationDigest ?? null
  });
}

export function computeHiveRepairValidationRequestDigest(request: Pick<HiveRepairValidationRequestSpec, "requestId" | "idempotencyKey" | "sessionId" | "attemptId" | "kind" | "commitRole" | "profileId" | "profileDigest" | "commitSha" | "authorizationDigest">): string {
  return canonicalSha256({
    schemaVersion: "hive.repair-validation-request.v1",
    requestId: request.requestId,
    idempotencyKey: request.idempotencyKey,
    sessionId: request.sessionId,
    attemptId: request.attemptId,
    kind: request.kind,
    commitRole: request.commitRole,
    profileId: request.profileId,
    profileDigest: request.profileDigest,
    commitSha: request.commitSha,
    authorizationDigest: request.authorizationDigest ?? null
  });
}

export function buildHiveRepairValidationRequestSpec(
  input: Omit<HiveRepairValidationRequestSpec, "requestId" | "idempotencyKey" | "requestDigest">
): HiveRepairValidationRequestSpec {
  const requestId = computeHiveRepairValidationRequestId(input);
  const idempotencyKey = computeHiveRepairValidationRequestIdentity(input);
  const withIdentity = { ...input, requestId, idempotencyKey };
  return HiveRepairValidationRequestSpecSchema.parse({
    ...withIdentity,
    requestDigest: computeHiveRepairValidationRequestDigest(withIdentity)
  });
}

export function buildHiveExecutionAuthorization(input: HiveExecutionAuthorizationInput): HiveExecutionAuthorization {
  const normalized = normalizeAuthorization(HiveExecutionAuthorizationInputSchema.parse(input));
  return HiveExecutionAuthorizationSchema.parse({ ...normalized, authorizationDigest: canonicalSha256(normalized) });
}

export function parseHiveExecutionAuthorization(value: unknown): HiveExecutionAuthorization {
  const parsed = HiveExecutionAuthorizationSchema.parse(value);
  const { authorizationDigest, ...content } = parsed;
  const expected = canonicalSha256(content);
  if (authorizationDigest !== expected) throw new Error(`Hive execution authorization digest mismatch: expected ${expected}, got ${authorizationDigest}.`);
  const rebuilt = buildHiveExecutionAuthorization(content);
  if (canonicalJson(rebuilt) !== canonicalJson(parsed)) throw new Error("Hive execution authorization is not in canonical normalized form.");
  return parsed;
}

export function computeHiveRepairSessionId(input: Pick<HiveRepairSessionInput, "repository" | "finding" | "task">): string {
  return canonicalSha256({
    schemaVersion: "hive.repair-session-id.v1",
    repository: {
      name: input.repository.name,
      repositoryId: input.repository.repositoryId ?? null,
      repositoryFingerprint: input.repository.repositoryFingerprint
    },
    finding: {
      repositoryFingerprint: input.finding.repositoryFingerprint,
      recurrenceKey: input.finding.recurrenceKey
    },
    task: {
      taskId: input.task.taskId,
      issueSource: input.task.issueSource,
      issueExternalId: input.task.issueExternalId,
      problemStatementDigest: input.task.problemStatementDigest
    },
    baseSha: input.repository.baseSha
  });
}

export function computeHiveRepairAttemptId(sessionId: string, ordinal: number, promptDigest: string): string {
  return canonicalSha256({ schemaVersion: "hive.repair-attempt-id.v1", sessionId, ordinal, promptDigest });
}

export function computeHiveRepairTurnId(
  sessionId: string,
  turn: Pick<z.infer<typeof HiveRepairTurnSchema>, "attemptId" | "ordinal" | "inputDigest">
): string {
  return canonicalSha256({
    schemaVersion: "hive.repair-turn-id.v1",
    sessionId,
    attemptId: turn.attemptId,
    ordinal: turn.ordinal,
    inputDigest: turn.inputDigest
  });
}

export function computeHiveRepairTurnInputDigest(
  sessionId: string,
  turn: Pick<z.infer<typeof HiveRepairTurnSchema>, "attemptId" | "ordinal" | "providerInputDigest" | "previousTurnOutputDigest" | "consumedToolOutcomeDigests">
): string {
  return canonicalSha256({
    schemaVersion: "hive.repair-turn-input.v1",
    sessionId,
    attemptId: turn.attemptId,
    ordinal: turn.ordinal,
    providerInputDigest: turn.providerInputDigest,
    previousTurnOutputDigest: turn.previousTurnOutputDigest ?? null,
    consumedToolOutcomeDigests: sortedUnique(turn.consumedToolOutcomeDigests)
  });
}

export function computeHiveRepairToolCallId(
  sessionId: string,
  receipt: Pick<HiveRepairToolReceipt, "turnId" | "sequence" | "toolName" | "argumentsDigest">
): string {
  return canonicalSha256({
    schemaVersion: "hive.repair-tool-call-id.v1",
    sessionId,
    turnId: receipt.turnId,
    sequence: receipt.sequence,
    toolName: receipt.toolName,
    argumentsDigest: receipt.argumentsDigest
  });
}

export function computeHiveRepairToolOutcomeDigest(
  receipt: Pick<HiveRepairToolReceipt, "callId" | "toolName" | "argumentsDigest" | "resultDigest" | "status" | "textBytes" | "imageBytes" | "errorCode">
): string {
  return canonicalSha256({
    schemaVersion: "hive.repair-tool-outcome.v1",
    callId: receipt.callId,
    toolName: receipt.toolName,
    argumentsDigest: receipt.argumentsDigest,
    resultDigest: receipt.resultDigest ?? null,
    status: receipt.status,
    textBytes: receipt.textBytes,
    imageBytes: receipt.imageBytes,
    errorCode: receipt.errorCode ?? null
  });
}

export function buildHiveRepairSession(input: HiveRepairSessionInput): HiveRepairSession {
  const parsed = HiveRepairSessionInputSchema.parse(input);
  const { authorization: authorizationInput, ...sessionBase } = parsed;
  const validationProfiles = uniqueBy(parsed.validationProfiles, (profile) => profile.profileId).map(normalizeProfile).sort((left, right) => stableTextCompare(left.profileId, right.profileId));
  const authorization = authorizationInput ? buildHiveExecutionAuthorization(authorizationInput) : undefined;
  const turns = uniqueBy(parsed.turns, (turn) => turn.turnId).map((turn) => ({
    ...turn,
    consumedToolOutcomeDigests: sortedUnique(turn.consumedToolOutcomeDigests)
  })).sort((left, right) => left.ordinal - right.ordinal || stableTextCompare(left.turnId, right.turnId));
  const turnOrdinals = new Map(turns.map((turn) => [turn.turnId, turn.ordinal]));
  const validationRequests = uniqueBy(parsed.validationRequests, (request) => request.requestId).sort((left, right) => stableTextCompare(left.requestId, right.requestId));
  const attempts = uniqueBy(parsed.attempts, (attempt) => attempt.attemptId).map((attempt) => ({
    ...attempt,
    turnIds: uniqueBy(attempt.turnIds, (turnId) => turnId).sort((left, right) => (turnOrdinals.get(left) ?? Number.MAX_SAFE_INTEGER) - (turnOrdinals.get(right) ?? Number.MAX_SAFE_INTEGER) || stableTextCompare(left, right)),
    validationRequestIds: sortedUnique(attempt.validationRequestIds)
  })).sort((left, right) => left.ordinal - right.ordinal || stableTextCompare(left.attemptId, right.attemptId));
  const toolReceipts = uniqueBy(parsed.toolReceipts, (receipt) => receipt.callId).sort((left, right) => left.sequence - right.sequence || stableTextCompare(left.callId, right.callId));
  const sourceContext = {
    ...parsed.sourceContext,
    files: uniqueBy(parsed.sourceContext.files, (file) => file.path).sort((left, right) => stableTextCompare(left.path, right.path))
  };
  const normalized = {
    ...sessionBase,
    task: { ...parsed.task, imageAttachments: uniqueBy(parsed.task.imageAttachments, (asset) => String(asset.position)).sort((left, right) => left.position - right.position) },
    capability: { ...parsed.capability, selectionReasons: sortedUnique(parsed.capability.selectionReasons) },
    sourceContext,
    validationProfiles,
    ...(authorization ? { authorization } : {}),
    attempts,
    turns,
    toolReceipts,
    validationRequests
  };
  validateSessionInputRelationships(normalized);
  const sessionId = computeHiveRepairSessionId(normalized);
  const transcriptDigest = canonicalSha256({ turns, toolReceipts });
  const content = { ...normalized, sessionId, transcriptDigest };
  return HiveRepairSessionSchema.parse({ ...content, sessionDigest: canonicalSha256(content) });
}

export function parseHiveRepairSession(value: unknown): HiveRepairSession {
  const parsed = HiveRepairSessionSchema.parse(value);
  const { sessionDigest, ...content } = parsed;
  const expected = canonicalSha256(content);
  if (sessionDigest !== expected) throw new Error(`Hive repair session digest mismatch: expected ${expected}, got ${sessionDigest}.`);
  const { sessionId: _sessionId, transcriptDigest: _transcriptDigest, authorization, ...base } = content;
  void _sessionId;
  void _transcriptDigest;
  const rebuilt = buildHiveRepairSession({
    ...base,
    ...(authorization ? { authorization: stripAuthorizationDigest(authorization) } : {})
  });
  if (canonicalJson(rebuilt) !== canonicalJson(parsed)) throw new Error("Hive repair session is not in canonical normalized form.");
  return parsed;
}

export function buildHiveRepairResult(input: HiveRepairResultInput): HiveRepairResult {
  const parsed = HiveRepairResultInputSchema.parse(input);
  const normalized = {
    ...parsed,
    diff: {
      ...parsed.diff,
      changedFiles: uniqueBy(parsed.diff.changedFiles, (file) => file.path).sort((left, right) => stableTextCompare(left.path, right.path))
    },
    attempts: uniqueBy(parsed.attempts, (attempt) => attempt.attemptId).sort((left, right) => left.ordinal - right.ordinal || stableTextCompare(left.attemptId, right.attemptId)),
    toolReceipts: uniqueBy(parsed.toolReceipts, (receipt) => receipt.callId).sort((left, right) => left.sequence - right.sequence || stableTextCompare(left.callId, right.callId)),
    validationRequests: uniqueBy(parsed.validationRequests, (request) => request.requestId).sort((left, right) => stableTextCompare(left.requestId, right.requestId))
  };
  return HiveRepairResultSchema.parse({ ...normalized, resultDigest: canonicalSha256(normalized) });
}

export function parseHiveRepairResult(value: unknown): HiveRepairResult {
  const parsed = HiveRepairResultSchema.parse(value);
  const { resultDigest, ...content } = parsed;
  const expected = canonicalSha256(content);
  if (resultDigest !== expected) throw new Error(`Hive repair result digest mismatch: expected ${expected}, got ${resultDigest}.`);
  const rebuilt = buildHiveRepairResult(content);
  if (canonicalJson(rebuilt) !== canonicalJson(parsed)) throw new Error("Hive repair result is not in canonical normalized form.");
  return parsed;
}

export function verifyHiveRepairResultAgainstSession(resultValue: unknown, sessionValue: unknown): HiveRepairResult {
  const result = parseHiveRepairResult(resultValue);
  const session = parseHiveRepairSession(sessionValue);
  if (result.sessionId !== session.sessionId || result.sessionDigest !== session.sessionDigest || result.transcriptDigest !== session.transcriptDigest) throw new Error("Hive repair result does not bind the verified repair session and transcript.");
  if (result.effectiveMode !== session.effectiveMode) throw new Error("Hive repair result capability mode does not match its session.");
  if (result.taskId !== session.task.taskId || result.taskContextDigest !== session.task.taskContextDigest) throw new Error("Hive repair result task identity does not match its session.");
  if (result.repository.name !== session.repository.name || result.repository.repositoryId !== session.repository.repositoryId || result.repository.repositoryFingerprint !== session.repository.repositoryFingerprint || result.baseSha !== session.repository.baseSha || result.baseTreeSha !== session.repository.baseTreeSha) throw new Error("Hive repair result repository or base identity does not match its session.");
  if (canonicalJson(result.finding) !== canonicalJson(session.finding)) throw new Error("Hive repair result finding identity does not match its session.");
  if (session.authorization?.authorizationDigest !== result.authorizationDigest) throw new Error("Hive repair result authorization does not match its session.");
  if (session.state !== "candidate" && session.state !== "awaiting_validation") throw new Error("Hive repair result must bind an immutable candidate session snapshot.");
  if (Date.parse(result.generatedAt) < Date.parse(session.updatedAt)) throw new Error("Hive repair result predates its bound session snapshot.");
  const expectedProvider = {
    providerId: session.provider.providerId,
    providerKind: session.provider.providerKind,
    model: session.provider.model,
    executableIdentityDigest: session.provider.executableIdentityDigest,
    capabilityDigest: session.provider.capabilityDigest,
    modelConfigurationDigest: session.provider.modelConfigurationDigest
  };
  if (canonicalJson(result.provider) !== canonicalJson(expectedProvider)) throw new Error("Hive repair result provider identity does not match its session.");
  if (canonicalJson(result.toolReceipts) !== canonicalJson(session.toolReceipts)) throw new Error("Hive repair result tool receipts do not match its durable session transcript.");
  const turnsById = new Map(session.turns.map((turn) => [turn.turnId, turn]));
  const expectedAttempts = session.attempts.map((attempt) => ({
    attemptId: attempt.attemptId,
    ordinal: attempt.ordinal,
    state: attempt.state,
    promptDigest: attempt.promptDigest,
    startedAt: attempt.startedAt,
    completedAt: attempt.completedAt,
    turnCount: attempt.turnIds.length,
    toolCallCount: session.toolReceipts.filter((receipt) => turnsById.get(receipt.turnId)?.attemptId === attempt.attemptId).length
  }));
  if (expectedAttempts.some((attempt) => attempt.state === "started" || attempt.completedAt === undefined)) throw new Error("Hive repair result cannot bind a session with an in-flight attempt.");
  if (canonicalJson(result.attempts) !== canonicalJson(expectedAttempts)) throw new Error("Hive repair result attempt summaries do not match its session.");
  const expectedValidationRequests = session.validationRequests.map(stripValidationRequestLifecycle);
  if (canonicalJson(result.validationRequests) !== canonicalJson(expectedValidationRequests)) throw new Error("Hive repair result validation requests do not match its session ledger.");
  const candidateAttempt = session.attempts.find((attempt) => attempt.state === "candidate");
  if (!candidateAttempt || candidateAttempt.candidatePatchDigest !== result.diff.sha256 || candidateAttempt.candidateHeadSha !== result.headSha || candidateAttempt.candidateHeadTreeSha !== result.headTreeSha) throw new Error("Hive repair result diff or head identity does not match its candidate attempt.");
  if (session.turns.some((turn) => turn.state === "started")) throw new Error("Hive repair result cannot bind an in-flight model turn.");
  const candidateTurns = candidateAttempt.turnIds.map((turnId) => turnsById.get(turnId)!);
  const finalTurns = candidateTurns.filter((turn) => turn.state === "completed" && turn.outputKind === "final_result");
  const lastCandidateTurn = [...candidateTurns].sort((left, right) => left.ordinal - right.ordinal).at(-1);
  if (candidateTurns.some((turn) => turn.state !== "completed") || finalTurns.length !== 1 || lastCandidateTurn?.turnId !== finalTurns[0]!.turnId) throw new Error("Hive repair candidate must end in exactly one completed final-result turn.");
  const patchRequests = session.validationRequests.filter((request) => candidateAttempt.validationRequestIds.includes(request.requestId) && request.kind === "patch_validation" && request.commitSha === result.headSha);
  if (patchRequests.length === 0 || patchRequests.some((request) => request.state !== "requested")) throw new Error("Hive repair result must freeze its head validation request before execution.");
  return result;
}

function normalizeAuthorization(input: HiveExecutionAuthorizationInput): HiveExecutionAuthorizationInput {
  return {
    ...input,
    profile: normalizeProfile(input.profile),
    toolNames: sortedUnique(input.toolNames) as HiveExecutionAuthorizationInput["toolNames"],
    assetIds: sortedUnique(input.assetIds)
  };
}

function normalizeProfile<T extends HiveRepairValidationProfile>(profile: T): T {
  return {
    ...profile,
    requestKinds: [...new Set(profile.requestKinds)].sort(stableTextCompare),
    contractIds: sortedUnique(profile.contractIds),
    routes: sortedUnique(profile.routes),
    scenarioIds: sortedUnique(profile.scenarioIds),
    viewports: uniqueBy(profile.viewports, (viewport) => viewport.viewportId).sort((left, right) => stableTextCompare(left.viewportId, right.viewportId))
  };
}

function validateSessionInputRelationships(session: HiveRepairSessionRelationshipInput): void {
  const createdAt = Date.parse(session.createdAt);
  const updatedAt = Date.parse(session.updatedAt);
  const deadlineAt = Date.parse(session.deadlineAt);
  if (updatedAt < createdAt || deadlineAt < createdAt) throw new Error("Hive repair session timestamps are not ordered.");
  const terminalStates = new Set(["completed", "failed", "blocked", "exhausted"]);
  if (terminalStates.has(session.state) !== (session.terminal !== undefined)) throw new Error("Hive repair session terminal metadata does not match its state.");
  if (!terminalStates.has(session.state) && updatedAt > deadlineAt) throw new Error("A non-terminal Hive repair session cannot continue past its deadline.");
  if (session.state === "completed" && session.terminal?.code !== "completed") throw new Error("A completed Hive repair session requires a completed terminal code.");
  if (session.state === "exhausted" && (session.terminal?.code !== "budget_exhausted" || session.terminal.exhaustedLimit === undefined)) throw new Error("An exhausted Hive repair session must identify the exhausted budget.");
  if (session.state === "failed" && (session.terminal?.code === "completed" || session.terminal?.code === "budget_exhausted" || session.terminal?.code === "blocked" || session.terminal?.code === "authorization_expired")) throw new Error("A failed Hive repair session has an incompatible terminal code.");
  if (session.state === "blocked" && session.terminal?.code !== "blocked" && session.terminal?.code !== "authorization_expired") throw new Error("A blocked Hive repair session has an incompatible terminal code.");

  const expectedRepositoryFingerprint = canonicalSha256({ repository: session.repository.name, repositoryId: session.repository.repositoryId ?? null });
  if (session.repository.repositoryFingerprint !== expectedRepositoryFingerprint) throw new Error("Hive repair session repository fingerprint is invalid.");
  const findingIdentity = session.finding.publicationRole === "canonical" ? session.finding.rootCauseKey : session.finding.fingerprint;
  const expectedFindingFingerprint = sha256Utf8(`${session.repository.name.trim().toLowerCase()}\0${findingIdentity}`);
  if (session.finding.repositoryFingerprint !== expectedFindingFingerprint) throw new Error("Hive repair session finding repository fingerprint is invalid.");
  assertContiguousOrdinals(session.task.imageAttachments.map((asset) => asset.position), "task image");

  const sourceBytes = session.sourceContext.files.reduce((total, file) => total + file.size, 0);
  if (sourceBytes !== session.sourceContext.totalBytes || sourceBytes > session.sourceContext.maxBytes) throw new Error("Hive repair source-context byte accounting is invalid.");
  if (session.sourceContext.digest !== computeHiveRepairSourceContextDigest(session.sourceContext)) throw new Error("Hive repair source-context digest is invalid.");
  if (session.sourceContext.omittedPaths > 0 && !session.sourceContext.truncated) throw new Error("Hive repair source context with omitted paths must be marked truncated.");
  for (const file of session.sourceContext.files) assertPermittedVisualTaskPath(file.path);

  if (session.provider.modelConfigurationDigest !== session.promptIdentities.modelConfigurationDigest) throw new Error("Hive repair provider model configuration does not match the prompt identity.");
  const providerIdentityDigest = computeHiveRepairProviderIdentityDigest(session.provider);
  if (session.turns.some((turn) => turn.providerIdentityDigest !== providerIdentityDigest)) throw new Error("Hive repair turn provider identity does not match the session provider.");
  for (const profile of session.validationProfiles) {
    if (profile.profileDigest !== computeHiveRepairValidationProfileDigest(profile)) throw new Error(`Hive repair validation profile digest is invalid: ${profile.profileId}.`);
  }

  if (session.budgets.usage.turnsConsumed !== session.turns.length || session.budgets.usage.toolCallsConsumed !== session.toolReceipts.length) throw new Error("Hive repair session usage counters do not match its durable turns and tool receipts.");
  const providerUsage = session.turns.reduce((total, turn) => ({
    inputBytesConsumed: total.inputBytesConsumed + (turn.usage?.inputBytes ?? 0),
    imageBytesConsumed: total.imageBytesConsumed + (turn.usage?.imageBytes ?? 0),
    modelInputTokensConsumed: total.modelInputTokensConsumed + (turn.usage?.modelInputTokens ?? 0),
    modelOutputTokensConsumed: total.modelOutputTokensConsumed + (turn.usage?.modelOutputTokens ?? 0),
    providerCostUsdMicrosConsumed: total.providerCostUsdMicrosConsumed + (turn.usage?.providerCostUsdMicros ?? 0),
    providerWallMilliseconds: total.providerWallMilliseconds + (turn.usage?.wallMilliseconds ?? 0)
  }), { inputBytesConsumed: 0, imageBytesConsumed: 0, modelInputTokensConsumed: 0, modelOutputTokensConsumed: 0, providerCostUsdMicrosConsumed: 0, providerWallMilliseconds: 0 });
  const toolWallMilliseconds = session.toolReceipts.reduce((total, receipt) => total + (receipt.completedAt === undefined ? 0 : Date.parse(receipt.completedAt) - Date.parse(receipt.startedAt)), 0);
  const validationWallMilliseconds = session.validationRequests.reduce((total, request) => total + (request.completedAt === undefined ? 0 : Date.parse(request.completedAt) - Date.parse(request.startedAt ?? request.requestedAt)), 0);
  const expectedUsage = {
    turnsConsumed: session.turns.length,
    toolCallsConsumed: session.toolReceipts.length,
    inputBytesConsumed: providerUsage.inputBytesConsumed,
    imageBytesConsumed: providerUsage.imageBytesConsumed,
    modelInputTokensConsumed: providerUsage.modelInputTokensConsumed,
    modelOutputTokensConsumed: providerUsage.modelOutputTokensConsumed,
    providerCostUsdMicrosConsumed: providerUsage.providerCostUsdMicrosConsumed,
    wallMillisecondsConsumed: providerUsage.providerWallMilliseconds + toolWallMilliseconds + validationWallMilliseconds
  };
  if (canonicalJson(session.budgets.usage) !== canonicalJson(expectedUsage)) throw new Error("Hive repair session usage does not recompute from its durable provider and execution receipts.");
  if (session.attempts.length > session.budgets.limits.maxRepairAttempts) throw new Error("Hive repair session exceeds its repair-attempt budget.");
  if (session.budgets.usage.turnsConsumed > session.budgets.limits.maxTurns || session.budgets.usage.toolCallsConsumed > session.budgets.limits.maxToolCalls || session.budgets.usage.inputBytesConsumed > session.budgets.limits.maxInputBytes || session.budgets.usage.imageBytesConsumed > session.budgets.limits.maxImageBytes || session.budgets.usage.modelInputTokensConsumed > session.budgets.limits.maxModelInputTokens || session.budgets.usage.modelOutputTokensConsumed > session.budgets.limits.maxModelOutputTokens || session.budgets.usage.providerCostUsdMicrosConsumed > session.budgets.limits.maxProviderCostUsdMicros || session.budgets.usage.wallMillisecondsConsumed > session.budgets.limits.maxWallSeconds * 1000) throw new Error("Hive repair session exceeds its declared budget.");
  if (session.state === "exhausted" && session.terminal?.exhaustedLimit !== undefined && !isRepairBudgetLimitReached(session, session.terminal.exhaustedLimit)) throw new Error("Hive repair session names a budget that has not been exhausted.");
  const durableTextBytes = session.toolReceipts.reduce((total, receipt) => total + receipt.textBytes, 0);
  const durableImageBytes = session.toolReceipts.reduce((total, receipt) => total + receipt.imageBytes, 0);
  if (durableTextBytes > session.budgets.usage.inputBytesConsumed || durableImageBytes > session.budgets.usage.imageBytesConsumed) throw new Error("Hive repair session byte usage is smaller than its durable tool evidence.");

  assertContiguousOrdinals(session.attempts.map((attempt) => attempt.ordinal), "attempt");
  assertContiguousOrdinals(session.turns.map((turn) => turn.ordinal), "turn");
  assertContiguousOrdinals(session.toolReceipts.map((receipt) => receipt.sequence), "tool-call");
  const attemptsById = new Map(session.attempts.map((attempt) => [attempt.attemptId, attempt]));
  const turnsById = new Map(session.turns.map((turn) => [turn.turnId, turn]));
  const receiptsByCallId = new Map(session.toolReceipts.map((receipt) => [receipt.callId, receipt]));
  const requestsById = new Map(session.validationRequests.map((request) => [request.requestId, request]));
  const assignedTurns = new Set<string>();
  const assignedRequests = new Set<string>();
  for (const attempt of session.attempts) {
    if (Date.parse(attempt.startedAt) < createdAt || Date.parse(attempt.startedAt) > updatedAt || (attempt.completedAt !== undefined && Date.parse(attempt.completedAt) > updatedAt)) throw new Error(`Hive repair attempt ${attempt.attemptId} falls outside its session timestamps.`);
    for (const turnId of attempt.turnIds) {
      const turn = turnsById.get(turnId);
      if (!turn) throw new Error(`Hive repair attempt ${attempt.attemptId} names an unknown turn.`);
      if (turn.attemptId !== attempt.attemptId) throw new Error(`Hive repair attempt ${attempt.attemptId} claims a turn owned by another attempt.`);
      if (assignedTurns.has(turnId)) throw new Error(`Hive repair turn ${turnId} is assigned to multiple attempts.`);
      assignedTurns.add(turnId);
    }
    for (const requestId of attempt.validationRequestIds) {
      const request = requestsById.get(requestId);
      if (!request) throw new Error(`Hive repair attempt ${attempt.attemptId} names an unknown validation request.`);
      if (request.attemptId !== attempt.attemptId) throw new Error(`Hive repair attempt ${attempt.attemptId} claims a validation request owned by another attempt.`);
      if (assignedRequests.has(requestId)) throw new Error(`Hive repair validation request ${requestId} is assigned to multiple attempts.`);
      assignedRequests.add(requestId);
    }
  }
  if (assignedTurns.size !== session.turns.length) throw new Error("Every Hive repair turn must belong to exactly one attempt.");
  if (assignedRequests.size !== session.validationRequests.length) throw new Error("Every Hive repair validation request must belong to exactly one attempt.");

  for (const turn of session.turns) {
    const attempt = attemptsById.get(turn.attemptId);
    if (!attempt) throw new Error(`Hive repair turn ${turn.turnId} names an unknown attempt.`);
    if (Date.parse(turn.startedAt) < Date.parse(attempt.startedAt) || Date.parse(turn.startedAt) > updatedAt || (turn.completedAt !== undefined && (Date.parse(turn.completedAt) > updatedAt || (attempt.completedAt !== undefined && Date.parse(turn.completedAt) > Date.parse(attempt.completedAt))))) throw new Error(`Hive repair turn ${turn.turnId} falls outside its attempt timestamps.`);
    if (turn.outputKind === "tool_request") {
      const receipt = turn.toolCallId ? receiptsByCallId.get(turn.toolCallId) : undefined;
      if (!receipt || receipt.turnId !== turn.turnId) throw new Error(`Hive repair tool-request turn ${turn.turnId} has no matching durable tool receipt.`);
    } else if (session.toolReceipts.some((receipt) => receipt.turnId === turn.turnId)) {
      throw new Error(`Hive repair non-tool turn ${turn.turnId} cannot own a tool receipt.`);
    }
  }
  for (const receipt of session.toolReceipts) {
    const turn = turnsById.get(receipt.turnId);
    if (!turn || turn.outputKind !== "tool_request" || turn.toolCallId !== receipt.callId) throw new Error(`Hive repair tool call ${receipt.callId} does not bind its tool-request turn.`);
    if (turn.completedAt === undefined || Date.parse(receipt.startedAt) < Date.parse(turn.completedAt) || Date.parse(receipt.startedAt) > updatedAt || (receipt.completedAt !== undefined && Date.parse(receipt.completedAt) > updatedAt)) throw new Error(`Hive repair tool call ${receipt.callId} falls outside its causal session timestamps.`);
  }

  for (const request of session.validationRequests) {
    const profile = session.validationProfiles.find((candidate) => candidate.profileId === request.profileId);
    if (!profile || request.profileDigest !== profile.profileDigest || !profile.requestKinds.includes(request.kind)) throw new Error(`Hive repair validation request ${request.requestId} is outside its declared profile.`);
    const attempt = attemptsById.get(request.attemptId);
    if (!attempt || Date.parse(request.requestedAt) < Date.parse(attempt.startedAt) || Date.parse(request.requestedAt) > updatedAt || (request.startedAt !== undefined && Date.parse(request.startedAt) > updatedAt) || (request.completedAt !== undefined && Date.parse(request.completedAt) > updatedAt)) throw new Error(`Hive repair validation request ${request.requestId} falls outside its session timestamps.`);
    if (request.kind === "reproduction" && request.commitRole !== "base") throw new Error(`Hive repair reproduction request ${request.requestId} must bind the base commit.`);
    if (request.kind === "patch_validation" && request.commitRole !== "candidate") throw new Error(`Hive repair patch-validation request ${request.requestId} must bind its candidate commit.`);
    const expectedCommit = request.commitRole === "base" ? session.repository.baseSha : attempt.candidateHeadSha;
    if (!expectedCommit || request.commitSha !== expectedCommit) throw new Error(`Hive repair validation request ${request.requestId} names an unauthorized commit.`);
  }

  if (session.requestedMode === "off" && session.effectiveMode !== "standard") throw new Error("Visual Hive mode off must select the standard repair path.");
  if ((session.requestedMode === "on" || session.requestedMode === "required") && session.effectiveMode !== "visual_hive") throw new Error(`Visual Hive mode ${session.requestedMode} must select the Visual Hive repair path.`);
  if (session.effectiveMode === "standard") {
    if (session.authorization !== undefined || session.toolReceipts.length > 0) throw new Error("A standard Hive repair session cannot carry Visual Hive authorization or tool receipts.");
    if (session.validationRequests.some((request) => request.authorizationDigest !== undefined)) throw new Error("A standard Hive repair validation request cannot carry Visual Hive authorization.");
  } else {
    if (!session.authorization) throw new Error("A Visual Hive repair session requires execution authorization.");
    if (!session.capability.visualHiveVersion || !session.capability.visualHiveCommit || !session.capability.toolProtocolDigest || !session.capability.validationToolRegistryDigest) throw new Error("A Visual Hive repair session requires pinned Visual Hive capability identity.");
    const authorization = session.authorization;
    if (authorization.repositoryFingerprint !== session.repository.repositoryFingerprint || authorization.taskContextDigest !== session.task.taskContextDigest || authorization.baseSha !== session.repository.baseSha) throw new Error("Hive execution authorization does not bind the session repository, task, and base commit.");
    if (authorization.budgetDigest !== canonicalSha256(session.budgets.limits)) throw new Error("Hive execution authorization does not bind the session budget.");
    if (authorization.configDigest !== session.executionIdentities.configDigest || authorization.toolRegistryDigest !== session.executionIdentities.toolRegistryDigest || authorization.promptSchemaDigest !== session.executionIdentities.promptSchemaDigest) throw new Error("Hive execution authorization does not bind the session config, tool registry, and prompt schema.");
    const capabilityHasReleaseIdentity = session.capability.visualHiveManifestSha256 !== undefined || session.capability.visualHiveEntrypointSha256 !== undefined;
    const authorizationHasReleaseIdentity = authorization.visualHiveManifestSha256 !== undefined || authorization.visualHiveEntrypointSha256 !== undefined;
    if ((session.capability.visualHiveManifestSha256 === undefined) !== (session.capability.visualHiveEntrypointSha256 === undefined) || capabilityHasReleaseIdentity !== authorizationHasReleaseIdentity || (capabilityHasReleaseIdentity && (authorization.visualHiveManifestSha256 !== session.capability.visualHiveManifestSha256 || authorization.visualHiveEntrypointSha256 !== session.capability.visualHiveEntrypointSha256))) throw new Error("Hive execution authorization does not bind the pinned Visual Hive release artifact.");
    if (session.capability.toolProtocolDigest !== session.executionIdentities.toolRegistryDigest) throw new Error("Visual Hive capability protocol does not match the authorized tool registry.");
    if (Date.parse(authorization.issuedAt) > updatedAt || Date.parse(authorization.expiresAt) < updatedAt) throw new Error("Hive execution authorization is not valid at the session snapshot time.");
    const profile = session.validationProfiles.find((candidate) => candidate.profileId === authorization.profile.profileId);
    if (!profile || canonicalJson(profile) !== canonicalJson(authorization.profile)) throw new Error("Hive execution authorization profile does not match a declared validation profile.");
    const taskAssetIds = new Set(session.task.imageAttachments.map((asset) => asset.assetId));
    for (const assetId of authorization.assetIds) if (!taskAssetIds.has(assetId)) throw new Error(`Hive execution authorization names an undeclared task asset: ${assetId}.`);
    for (const receipt of session.toolReceipts) {
      if (!authorization.toolNames.includes(receipt.toolName)) throw new Error(`Hive repair tool call ${receipt.callId} is not authorized.`);
      if (Date.parse(receipt.startedAt) < Date.parse(authorization.issuedAt) || Date.parse(receipt.startedAt) > Date.parse(authorization.expiresAt) || (receipt.completedAt !== undefined && Date.parse(receipt.completedAt) > Date.parse(authorization.expiresAt))) throw new Error(`Hive repair tool call ${receipt.callId} falls outside its authorization window.`);
    }
    for (const request of session.validationRequests) {
      if (request.authorizationDigest !== authorization.authorizationDigest || request.profileId !== authorization.profile.profileId || request.profileDigest !== authorization.profile.profileDigest) throw new Error(`Hive repair validation request ${request.requestId} is not covered by execution authorization.`);
      if (Date.parse(request.requestedAt) < Date.parse(authorization.issuedAt) || Date.parse(request.requestedAt) > Date.parse(authorization.expiresAt) || (request.startedAt !== undefined && Date.parse(request.startedAt) > Date.parse(authorization.expiresAt)) || (request.completedAt !== undefined && Date.parse(request.completedAt) > Date.parse(authorization.expiresAt))) throw new Error(`Hive repair validation request ${request.requestId} falls outside its authorization window.`);
    }
  }

  const candidateAttempts = session.attempts.filter((attempt) => attempt.state === "candidate");
  if (candidateAttempts.length > 1) throw new Error("A Hive repair session can expose at most one candidate attempt.");
  if ((session.state === "candidate" || session.state === "awaiting_validation" || session.state === "completed") && candidateAttempts.length !== 1) throw new Error(`Hive repair session state ${session.state} requires exactly one candidate attempt.`);
  const sessionId = computeHiveRepairSessionId(session);
  for (const attempt of session.attempts) {
    const attemptTurns = attempt.turnIds.map((turnId) => turnsById.get(turnId)!).sort((left, right) => left.ordinal - right.ordinal);
    if (attempt.state !== "started" && attemptTurns.some((turn) => turn.state === "started")) throw new Error(`Terminal Hive repair attempt ${attempt.attemptId} cannot contain an in-flight turn.`);
    for (let index = 0; index < attemptTurns.length; index += 1) {
      const turn = attemptTurns[index]!;
      const previous = attemptTurns[index - 1];
      if (turn.inputDigest !== computeHiveRepairTurnInputDigest(sessionId, turn)) throw new Error(`Hive repair turn ${turn.turnId} input digest does not bind its provider input and consumed tool outcomes.`);
      if (!previous) {
        if (turn.previousTurnOutputDigest !== undefined || turn.consumedToolOutcomeDigests.length !== 0) throw new Error(`First Hive repair turn ${turn.turnId} cannot claim prior output or tool evidence.`);
        continue;
      }
      if (previous.state !== "completed" || previous.outputDigest === undefined || turn.previousTurnOutputDigest !== previous.outputDigest) throw new Error(`Hive repair turn ${turn.turnId} does not bind the immediately preceding provider output.`);
      if (previous.outputKind === "tool_request") {
        const receipt = previous.toolCallId ? receiptsByCallId.get(previous.toolCallId) : undefined;
        if (!receipt || receipt.completedAt === undefined || receipt.outcomeDigest === undefined || Date.parse(receipt.completedAt) > Date.parse(turn.startedAt)) throw new Error(`Hive repair turn ${turn.turnId} began before its preceding tool outcome was durably available.`);
        if (canonicalJson(turn.consumedToolOutcomeDigests) !== canonicalJson([receipt.outcomeDigest])) throw new Error(`Hive repair turn ${turn.turnId} does not consume its preceding tool outcome.`);
      } else if (turn.consumedToolOutcomeDigests.length !== 0) {
        throw new Error(`Hive repair turn ${turn.turnId} claims tool evidence without a preceding tool request.`);
      }
    }
    if (attempt.state === "candidate") {
      const finalTurns = attemptTurns.filter((turn) => turn.state === "completed" && turn.outputKind === "final_result");
      const lastTurn = [...attemptTurns].sort((left, right) => left.ordinal - right.ordinal).at(-1);
      if (attemptTurns.some((turn) => turn.state !== "completed") || finalTurns.length !== 1 || lastTurn?.turnId !== finalTurns[0]!.turnId) throw new Error("Hive repair candidate must end in exactly one completed final-result turn.");
    }
  }
}

function validateSessionRelationships(session: HiveRepairSessionContract, context: z.RefinementCtx): void {
  try {
    validateSessionInputRelationships(session);
    if (session.sessionId !== computeHiveRepairSessionId(session)) throw new Error("Hive repair session ID does not match its immutable identity.");
    if (session.transcriptDigest !== canonicalSha256({ turns: session.turns, toolReceipts: session.toolReceipts })) throw new Error("Hive repair transcript digest does not match its turns and receipts.");
    for (const attempt of session.attempts) if (attempt.attemptId !== computeHiveRepairAttemptId(session.sessionId, attempt.ordinal, attempt.promptDigest)) throw new Error(`Hive repair attempt ID is invalid for ordinal ${attempt.ordinal}.`);
    for (const turn of session.turns) if (turn.turnId !== computeHiveRepairTurnId(session.sessionId, turn)) throw new Error(`Hive repair turn ID is invalid for ordinal ${turn.ordinal}.`);
    for (const receipt of session.toolReceipts) if (receipt.callId !== computeHiveRepairToolCallId(session.sessionId, receipt)) throw new Error(`Hive repair tool-call ID is invalid for sequence ${receipt.sequence}.`);
    for (const request of session.validationRequests) if (request.sessionId !== session.sessionId) throw new Error(`Hive repair validation request ${request.requestId} names the wrong session.`);
  } catch (error) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: error instanceof Error ? error.message : String(error) });
  }
}

function assertContiguousOrdinals(values: readonly number[], label: string): void {
  const sorted = [...values].sort((left, right) => left - right);
  for (let index = 0; index < sorted.length; index += 1) {
    if (sorted[index] !== index) throw new Error(`Hive repair ${label} ordinals must be unique and contiguous from zero.`);
  }
}

function isRepairBudgetLimitReached(session: HiveRepairSessionRelationshipInput, limit: NonNullable<HiveRepairSessionRelationshipInput["terminal"]>["exhaustedLimit"]): boolean {
  switch (limit) {
    case "turns": return session.budgets.usage.turnsConsumed >= session.budgets.limits.maxTurns;
    case "tool_calls": return session.budgets.usage.toolCallsConsumed >= session.budgets.limits.maxToolCalls;
    case "input_bytes": return session.budgets.usage.inputBytesConsumed >= session.budgets.limits.maxInputBytes;
    case "image_bytes": return session.budgets.usage.imageBytesConsumed >= session.budgets.limits.maxImageBytes;
    case "model_input_tokens": return session.budgets.usage.modelInputTokensConsumed >= session.budgets.limits.maxModelInputTokens;
    case "model_output_tokens": return session.budgets.usage.modelOutputTokensConsumed >= session.budgets.limits.maxModelOutputTokens;
    case "provider_cost": return session.budgets.usage.providerCostUsdMicrosConsumed >= session.budgets.limits.maxProviderCostUsdMicros;
    case "wall_time": return session.budgets.usage.wallMillisecondsConsumed >= session.budgets.limits.maxWallSeconds * 1000;
    case "repair_attempts": return session.attempts.length >= session.budgets.limits.maxRepairAttempts;
    default: return false;
  }
}

function stripAuthorizationDigest(authorization: HiveExecutionAuthorization): HiveExecutionAuthorizationInput {
  const { authorizationDigest: _digest, ...input } = authorization;
  void _digest;
  return input;
}

function stripValidationRequestLifecycle(request: HiveRepairValidationRequest): HiveRepairValidationRequestSpec {
  const { state: _state, requestedAt: _requestedAt, startedAt: _startedAt, completedAt: _completedAt, receiptDigest: _receiptDigest, errorCode: _errorCode, ...spec } = request;
  void _state;
  void _requestedAt;
  void _startedAt;
  void _completedAt;
  void _receiptDigest;
  void _errorCode;
  return spec;
}

function sortedUnique<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort(stableTextCompare);
}

function uniqueBy<T>(values: readonly T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  for (const value of values) {
    const identity = key(value);
    if (seen.has(identity)) throw new Error(`Duplicate Hive repair contract identity: ${identity}.`);
    seen.add(identity);
  }
  return [...values];
}
