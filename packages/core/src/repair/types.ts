import { z } from "zod";

export const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
export const GitCommitSchema = z.string().regex(/^[a-f0-9]{40}$/u);
export const BoundedIdSchema = z.string().min(1).max(256).regex(/^[A-Za-z0-9][A-Za-z0-9._:@+~-]*$/u);
export const RepositorySchema = z.string().min(3).max(512).regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u).refine((value) => value.split("/").every((segment) => segment !== "." && segment !== ".."), "Repository owner and name cannot be dot segments.");
export const RelativeArtifactPathSchema = z.string().min(1).max(1024).refine((value) => {
  const hasControlCharacter = [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
  if (value.includes("\\") || value.includes(":") || hasControlCharacter || value.startsWith("/") || /^[A-Za-z]:/u.test(value)) return false;
  const segments = value.split("/");
  return segments.every((segment) => segment !== "" && segment !== "." && segment !== ".." && segment === segment.trimEnd() && !segment.endsWith(".") && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(segment));
}, "Artifact path must be a canonical repository-relative path without traversal.");

const TimestampSchema = z.string().datetime({ offset: true });
const NonEmptyTextSchema = z.string().trim().min(1).max(60_000);
const ShortTextSchema = z.string().trim().min(1).max(2048);
const StringListSchema = z.array(z.string().trim().min(1).max(1024)).max(512);

export const VisualAssetRoleSchema = z.enum(["problem", "expected", "current", "baseline", "actual", "diff", "reference", "frame"]);
export const VisualAssetMediaTypeSchema = z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export const VisualAssetRegionSchema = z.object({
  regionId: BoundedIdSchema,
  label: z.string().trim().min(1).max(512).optional(),
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  width: z.number().int().positive(),
  height: z.number().int().positive()
}).strict();

export const VisualTaskAssetSchema = z.object({
  assetId: BoundedIdSchema,
  role: VisualAssetRoleSchema,
  path: RelativeArtifactPathSchema,
  mediaType: VisualAssetMediaTypeSchema,
  sha256: Sha256Schema,
  size: z.number().int().positive().max(32 * 1024 * 1024),
  width: z.number().int().positive().max(32_768).optional(),
  height: z.number().int().positive().max(32_768).optional(),
  provenance: z.object({
    kind: z.enum(["benchmark", "issue_attachment", "capture", "baseline", "generated_diff", "fixture"]),
    sourceId: z.string().trim().min(1).max(2048),
    sourceDigest: Sha256Schema.optional(),
    capturedAt: TimestampSchema.optional(),
    runId: BoundedIdSchema.optional()
  }).strict(),
  regions: z.array(VisualAssetRegionSchema).max(128).default([])
}).strict().superRefine((asset, context) => {
  if ((asset.width === undefined) !== (asset.height === undefined)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: [asset.width === undefined ? "width" : "height"], message: "Asset width and height must be provided together." });
  }
  if (asset.width !== undefined && asset.height !== undefined) {
    for (const [index, region] of asset.regions.entries()) {
      if (region.x + region.width > asset.width || region.y + region.height > asset.height) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["regions", index], message: "Asset region must remain inside the image bounds." });
      }
    }
  }
});

export const VisualTaskImageReferenceSchema = z.object({
  position: z.number().int().nonnegative().max(63),
  assetId: BoundedIdSchema,
  role: VisualAssetRoleSchema,
  caption: z.string().trim().min(1).max(4096).optional()
}).strict();

export const VisualGraphSourceSpanSchema = z.object({
  path: RelativeArtifactPathSchema,
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  startColumn: z.number().int().positive().optional(),
  endColumn: z.number().int().positive().optional()
}).strict().refine((span) => span.endLine >= span.startLine, "Source span endLine must not precede startLine.");

export const VisualGraphCandidateSchema = z.object({
  nodeId: BoundedIdSchema,
  kind: z.enum(["file", "symbol", "component", "route", "selector", "contract", "flow", "mutation"]),
  label: ShortTextSchema,
  score: z.number().min(0).max(1),
  reasons: z.array(ShortTextSchema).max(32),
  sourceSpans: z.array(VisualGraphSourceSpanSchema).max(64)
}).strict();

export const VisualViewportSchema = z.object({
  viewportId: BoundedIdSchema,
  width: z.number().int().positive().max(16_384),
  height: z.number().int().positive().max(16_384),
  deviceScaleFactor: z.number().positive().max(8).default(1)
}).strict();

export const VisualValidationProfileSchema = z.object({
  profileId: BoundedIdSchema,
  profileDigest: Sha256Schema,
  targetId: BoundedIdSchema,
  requestKinds: z.array(z.enum(["reproduction", "capture", "patch_validation"])).min(1).max(3),
  contractIds: z.array(BoundedIdSchema).max(256),
  routes: z.array(z.string().min(1).max(2048)).max(128),
  scenarioIds: z.array(BoundedIdSchema).max(128),
  viewports: z.array(VisualViewportSchema).min(1).max(32),
  validationCommandId: BoundedIdSchema
}).strict();

export const VisualObligationSchema = z.object({
  obligationId: BoundedIdSchema,
  description: NonEmptyTextSchema,
  sourceAssetIds: z.array(BoundedIdSchema).max(64),
  mappedContractIds: z.array(BoundedIdSchema).max(128),
  route: z.string().min(1).max(2048).optional(),
  state: z.string().min(1).max(1024).optional(),
  viewportId: BoundedIdSchema.optional(),
  assertionKind: z.enum(["dom", "aria", "text", "behavior", "pixel_region", "visual_relation"]),
  authority: z.enum(["deterministic", "advisory"]),
  confidence: z.number().min(0).max(1),
  status: z.enum(["specified", "mapped", "executed", "passed", "failed", "blocked", "unresolved"]),
  unresolvedReason: ShortTextSchema.optional()
}).strict().superRefine((obligation, context) => {
  if (obligation.authority === "deterministic" && obligation.mappedContractIds.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["mappedContractIds"], message: "A deterministic obligation must map to at least one contract." });
  }
  if (obligation.status === "unresolved" && !obligation.unresolvedReason) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["unresolvedReason"], message: "An unresolved obligation requires a reason." });
  }
});

export const VisualHiveTaskContextSchema = z.object({
  schemaVersion: z.literal("visual-hive.task-context.v1"),
  digestAlgorithm: z.literal("visual-hive.canonical-json.sha256.v1"),
  generatedAt: TimestampSchema,
  taskId: BoundedIdSchema,
  repository: z.object({
    name: RepositorySchema,
    repositoryId: z.string().trim().min(1).max(128).optional(),
    repositoryFingerprint: Sha256Schema,
    baseSha: GitCommitSchema,
    ref: z.string().trim().min(1).max(1024).optional()
  }).strict(),
  issue: z.object({
    source: z.enum(["swebench_multimodal", "github", "fixture", "other"]),
    externalId: z.string().trim().min(1).max(512),
    title: z.string().trim().min(1).max(1024).optional(),
    problemStatement: z.string().min(1).max(120_000),
    problemStatementSha256: Sha256Schema
  }).strict(),
  assets: z.array(VisualTaskAssetSchema).max(64),
  imageReferences: z.array(VisualTaskImageReferenceSchema).max(64),
  graphCandidates: z.array(VisualGraphCandidateSchema).max(256),
  profiles: z.array(VisualValidationProfileSchema).max(64),
  obligations: z.array(VisualObligationSchema).max(256),
  sourceContext: z.object({
    digest: Sha256Schema,
    files: z.array(z.object({
      path: RelativeArtifactPathSchema,
      sha256: Sha256Schema,
      size: z.number().int().nonnegative().max(8 * 1024 * 1024),
      classification: z.enum(["source", "test", "config", "documentation"])
    }).strict()).max(512),
    omittedPaths: z.number().int().nonnegative(),
    truncated: z.boolean()
  }).strict(),
  safety: z.object({
    containsGoldPatch: z.literal(false),
    containsTestPatch: z.literal(false),
    containsGraderTests: z.literal(false),
    externalCallsMade: z.literal(0),
    networkCallsMade: z.literal(0),
    writesMade: z.literal(0)
  }).strict(),
  contextDigest: Sha256Schema
}).strict();

export const VisualHiveTaskContextInputSchema = VisualHiveTaskContextSchema.omit({ safety: true, contextDigest: true });

export const VisualExecutionCaseSchema = z.object({
  caseId: BoundedIdSchema,
  targetId: BoundedIdSchema,
  route: z.string().min(1).max(2048),
  state: z.string().min(1).max(1024),
  viewport: VisualViewportSchema,
  contractIds: z.array(BoundedIdSchema).min(1).max(256)
}).strict();

export const VisualExecutionContextSchema = z.object({
  commitSha: GitCommitSchema,
  profileId: BoundedIdSchema,
  profileDigest: Sha256Schema,
  configDigest: Sha256Schema,
  validationPolicyDigest: Sha256Schema,
  contractInventoryDigest: Sha256Schema,
  planDigest: Sha256Schema,
  testPlanDigest: Sha256Schema,
  toolRegistryDigest: Sha256Schema,
  baselineIdentityDigest: Sha256Schema,
  executionMatrixDigest: Sha256Schema,
  browser: z.object({
    name: z.string().trim().min(1).max(128),
    version: z.string().trim().min(1).max(256),
    channel: z.string().trim().min(1).max(128).optional()
  }).strict(),
  environment: z.object({
    os: z.string().trim().min(1).max(128),
    architecture: z.string().trim().min(1).max(128),
    nodeVersion: z.string().trim().min(1).max(128),
    playwrightVersion: z.string().trim().min(1).max(128),
    fontManifestDigest: Sha256Schema,
    locale: z.string().trim().min(1).max(128),
    timezone: z.string().trim().min(1).max(128)
  }).strict(),
  cases: z.array(VisualExecutionCaseSchema).min(1).max(512)
}).strict();

export const VisualComparabilityFieldSchema = z.enum([
  "profileId",
  "profileDigest",
  "validationPolicyDigest",
  "contractInventoryDigest",
  "planDigest",
  "testPlanDigest",
  "toolRegistryDigest",
  "baselineIdentityDigest",
  "executionMatrixDigest",
  "browser",
  "environment",
  "cases"
]);

const VisualRepairValidationObjectSchema = z.object({
  schemaVersion: z.literal("visual-hive.repair-validation.v1"),
  generatedAt: TimestampSchema,
  validationId: BoundedIdSchema,
  taskId: BoundedIdSchema,
  taskContextDigest: Sha256Schema,
  findingFingerprint: z.string().trim().min(1).max(1024),
  // Added to v1 for Hive-mediated validation. Keep optional at the persisted
  // parse boundary so pre-integration v1 receipts remain readable; the
  // authoritative artifact builder and Hive publication gate require them.
  sessionId: Sha256Schema.optional(),
  sessionDigest: Sha256Schema.optional(),
  authorizationDigest: Sha256Schema.optional(),
  hiveRepairResultDigest: Sha256Schema,
  repository: RepositorySchema,
  baseSha: GitCommitSchema,
  headSha: GitCommitSchema,
  beforeBundleDigest: Sha256Schema,
  afterBundleDigest: Sha256Schema,
  beforeReportDigest: Sha256Schema,
  afterReportDigest: Sha256Schema,
  beforeRunContextDigest: Sha256Schema,
  afterRunContextDigest: Sha256Schema,
  before: VisualExecutionContextSchema,
  after: VisualExecutionContextSchema,
  comparability: z.object({
    status: z.enum(["comparable", "non_comparable"]),
    comparedFields: z.array(VisualComparabilityFieldSchema).length(12),
    differences: z.array(z.object({
      field: VisualComparabilityFieldSchema,
      beforeDigest: Sha256Schema,
      afterDigest: Sha256Schema
    }).strict()).max(12)
  }).strict(),
  obligations: z.array(z.object({
    obligationId: BoundedIdSchema,
    deterministic: z.boolean(),
    status: z.enum(["passed", "failed", "blocked", "not_evaluated"]),
    contractIds: z.array(BoundedIdSchema).max(128),
    evidenceAssetIds: z.array(BoundedIdSchema).max(64),
    reason: ShortTextSchema.optional()
  }).strict()).min(1).max(256),
  screenshotTriplets: z.array(z.object({
    obligationId: BoundedIdSchema,
    beforeAssetId: BoundedIdSchema,
    afterAssetId: BoundedIdSchema,
    diffAssetId: BoundedIdSchema.optional(),
    diffPixels: z.number().int().nonnegative(),
    totalPixels: z.number().int().positive(),
    diffRatio: z.number().min(0).max(1)
  }).strict()).max(256),
  lanes: z.object({
    targeted: z.object({
      profileId: BoundedIdSchema,
      status: z.enum(["passed", "failed", "blocked", "skipped"]),
      evaluatedContractIds: z.array(BoundedIdSchema).max(256),
      failures: StringListSchema
    }).strict(),
    regression: z.object({
      profileId: BoundedIdSchema,
      status: z.enum(["passed", "failed", "blocked", "skipped"]),
      evaluatedContractIds: z.array(BoundedIdSchema).max(256),
      failures: StringListSchema
    }).strict(),
    mutation: z.object({
      status: z.enum(["passed", "failed", "blocked", "not_required"]),
      killed: z.number().int().nonnegative(),
      survived: z.number().int().nonnegative(),
      operatorIds: z.array(BoundedIdSchema).max(256)
    }).strict()
  }).strict(),
  remainingFailures: z.array(z.object({ id: BoundedIdSchema, severity: z.enum(["critical", "high", "medium", "low"]), message: ShortTextSchema }).strict()).max(512),
  newFailures: z.array(z.object({ id: BoundedIdSchema, severity: z.enum(["critical", "high", "medium", "low"]), message: ShortTextSchema }).strict()).max(512),
  findingBeforeStatus: z.enum(["present", "absent", "not_evaluated"]),
  findingStatus: z.enum(["present", "absent", "not_evaluated"]),
  authoritativeForResolution: z.boolean(),
  policyChanges: z.object({
    configChanged: z.boolean(),
    validationPolicyChanged: z.boolean(),
    thresholdWeakened: z.boolean(),
    baselineChanged: z.boolean()
  }).strict(),
  claimedOutcome: z.string().trim().min(1).max(4096).optional(),
  verdict: z.enum(["pass", "fail", "blocked"]),
  closureRecommendation: z.enum(["keep_open", "resolved_candidate"]),
  digestAlgorithm: z.literal("visual-hive.canonical-json.sha256.v1"),
  receiptDigest: Sha256Schema
}).strict();

export const VisualRepairValidationSchema = VisualRepairValidationObjectSchema.superRefine((validation, context) => {
  const hiveBindingCount = [validation.sessionId, validation.sessionDigest, validation.authorizationDigest].filter((value) => value !== undefined).length;
  if (hiveBindingCount !== 0 && hiveBindingCount !== 3) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["sessionId"], message: "Hive session and authorization validation bindings must be provided together." });
  }
  if (validation.before.commitSha !== validation.baseSha) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["before", "commitSha"], message: "Before execution must bind the base SHA." });
  }
  if (validation.after.commitSha !== validation.headSha) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["after", "commitSha"], message: "After execution must bind the repair head SHA." });
  }
  if (validation.baseSha === validation.headSha) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["headSha"], message: "Repair validation requires a head SHA distinct from the base SHA." });
  }
  if (!validation.obligations.some((obligation) => obligation.deterministic)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["obligations"], message: "Repair validation requires at least one deterministic obligation." });
  }
  const obligationIds = new Set(validation.obligations.map((obligation) => obligation.obligationId));
  for (const [index, obligation] of validation.obligations.entries()) {
    if (obligation.deterministic && obligation.contractIds.length === 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["obligations", index, "contractIds"], message: "A deterministic obligation requires at least one contract." });
    }
    if (obligation.deterministic && (obligation.status === "passed" || obligation.status === "failed") && obligation.evidenceAssetIds.length === 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["obligations", index, "evidenceAssetIds"], message: "An evaluated deterministic obligation requires evidence." });
    }
    if ((obligation.status === "blocked" || obligation.status === "not_evaluated") && !obligation.reason) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["obligations", index, "reason"], message: "A blocked or unevaluated obligation requires a reason." });
    }
  }
  for (const [index, triplet] of validation.screenshotTriplets.entries()) {
    if (!obligationIds.has(triplet.obligationId)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["screenshotTriplets", index, "obligationId"], message: "A screenshot triplet must reference a declared obligation." });
    }
    if (triplet.beforeAssetId === triplet.afterAssetId) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["screenshotTriplets", index, "afterAssetId"], message: "Before and after screenshot assets must be distinct." });
    }
    if (triplet.diffPixels > triplet.totalPixels) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["screenshotTriplets", index, "diffPixels"], message: "diffPixels must not exceed totalPixels." });
    }
    const expectedRatio = triplet.diffPixels / triplet.totalPixels;
    if (Math.abs(triplet.diffRatio - expectedRatio) > 1e-12) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["screenshotTriplets", index, "diffRatio"], message: "diffRatio must equal diffPixels divided by totalPixels." });
    }
  }
  for (const laneName of ["targeted", "regression"] as const) {
    const lane = validation.lanes[laneName];
    if (lane.profileId !== validation.after.profileId) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["lanes", laneName, "profileId"], message: "Validation lane profile must match the verified execution profile." });
    }
    if ((lane.status === "passed" || lane.status === "failed") && lane.evaluatedContractIds.length === 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["lanes", laneName, "evaluatedContractIds"], message: "An evaluated lane requires at least one contract." });
    }
    if (lane.status === "passed" && lane.failures.length > 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["lanes", laneName, "failures"], message: "A passed lane cannot contain failures." });
    }
    if (lane.status !== "passed" && lane.failures.length === 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["lanes", laneName, "failures"], message: "A non-passing lane requires a failure or reason." });
    }
  }
  if (validation.lanes.targeted.status === "passed" || validation.lanes.targeted.status === "failed") {
    const targetedContracts = new Set(validation.lanes.targeted.evaluatedContractIds);
    for (const [index, obligation] of validation.obligations.entries()) {
      if (!obligation.deterministic) continue;
      for (const contractId of obligation.contractIds) {
        if (!targetedContracts.has(contractId)) {
          context.addIssue({ code: z.ZodIssueCode.custom, path: ["obligations", index, "contractIds"], message: `Targeted validation did not evaluate deterministic contract ${contractId}.` });
        }
      }
    }
  }
  if (validation.lanes.mutation.status === "passed" && validation.lanes.mutation.survived !== 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["lanes", "mutation", "survived"], message: "A passed mutation lane cannot contain survivors." });
  }
  if (validation.lanes.mutation.status === "failed" && validation.lanes.mutation.survived === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["lanes", "mutation", "survived"], message: "A failed mutation lane requires at least one survivor." });
  }
  if (validation.lanes.mutation.status === "not_required" && (validation.lanes.mutation.killed !== 0 || validation.lanes.mutation.survived !== 0 || validation.lanes.mutation.operatorIds.length !== 0)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["lanes", "mutation"], message: "A not-required mutation lane cannot report mutation execution." });
  }
});

export const VisualRepairValidationInputSchema = VisualRepairValidationObjectSchema.omit({ comparability: true, verdict: true, closureRecommendation: true, receiptDigest: true });

export const VisualRunEvidenceAssetSchema = z.object({
  assetId: BoundedIdSchema,
  role: z.enum(["baseline", "actual", "diff", "reference", "frame"]),
  path: RelativeArtifactPathSchema,
  mediaType: VisualAssetMediaTypeSchema,
  sha256: Sha256Schema,
  size: z.number().int().positive().max(32 * 1024 * 1024),
  width: z.number().int().positive().max(32_768),
  height: z.number().int().positive().max(32_768),
  assertion: z.object({
    contractId: BoundedIdSchema,
    screenshotName: z.string().trim().min(1).max(512),
    route: z.string().min(1).max(2048),
    state: z.string().min(1).max(1024),
    viewportId: BoundedIdSchema
  }).strict(),
  obligationIds: z.array(BoundedIdSchema).max(128)
}).strict();

export const VisualRunThresholdSchema = z.object({
  contractId: BoundedIdSchema,
  maxDiffPixelRatio: z.number().min(0).max(1),
  maxDiffPixels: z.number().int().nonnegative().optional(),
  missingBaseline: z.enum(["fail", "create"])
}).strict();

export const VisualRunExecutionBindingSchema = z.object({
  nonceSha256: Sha256Schema,
  generatedSpecSha256: Sha256Schema,
  generatedConfigSha256: Sha256Schema,
  payloadSha256: Sha256Schema,
  bindingMacSha256: Sha256Schema
}).strict();

const VisualRunContextObjectSchema = z.object({
  schemaVersion: z.literal("visual-hive.run-context.v1"),
  digestAlgorithm: z.literal("visual-hive.canonical-json.sha256.v1"),
  generatedAt: TimestampSchema,
  runId: BoundedIdSchema,
  phase: z.enum(["before", "after"]),
  taskId: BoundedIdSchema,
  taskContextDigest: Sha256Schema,
  findingFingerprint: z.string().trim().min(1).max(1024),
  repository: z.object({
    name: RepositorySchema,
    repositoryId: z.string().trim().min(1).max(128).optional(),
    repositoryFingerprint: Sha256Schema,
    commitSha: GitCommitSchema
  }).strict(),
  brokerRequest: z.object({
    requestId: BoundedIdSchema,
    requestDigest: Sha256Schema
  }).strict().optional(),
  execution: VisualExecutionContextSchema,
  producer: z.object({
    visualHiveVersion: z.string().trim().min(1).max(128),
    visualHiveCommit: GitCommitSchema,
    // Optional only for persisted pre-integration v1 contexts. Authoritative
    // repair validation requires both and binds them to Hive authorization.
    manifestSha256: Sha256Schema.optional(),
    entrypointSha256: Sha256Schema.optional(),
    playwrightVersion: z.string().trim().min(1).max(128)
  }).strict(),
  command: z.object({
    validationCommandId: BoundedIdSchema,
    startedAt: TimestampSchema,
    completedAt: TimestampSchema,
    exitCode: z.number().int(),
    // Optional only for persisted pre-integration v1 contexts. A run without
    // this binding cannot satisfy authoritative repair validation.
    executionBinding: VisualRunExecutionBindingSchema.optional()
  }).strict(),
  report: z.object({ path: RelativeArtifactPathSchema, sha256: Sha256Schema }).strict(),
  mutationReport: z.object({ path: RelativeArtifactPathSchema, sha256: Sha256Schema }).strict().optional(),
  evidenceAssets: z.array(VisualRunEvidenceAssetSchema).max(512),
  thresholds: z.array(VisualRunThresholdSchema).max(256),
  capture: z.object({
    status: z.enum(["passed", "failed", "blocked"]),
    failures: StringListSchema
  }).strict(),
  runContextDigest: Sha256Schema
}).strict().superRefine((runContext, context) => {
  if ((runContext.producer.manifestSha256 === undefined) !== (runContext.producer.entrypointSha256 === undefined)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["producer", "manifestSha256"], message: "Visual Hive manifest and entrypoint identities must be provided together." });
  }
  if (runContext.repository.commitSha !== runContext.execution.commitSha) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["execution", "commitSha"], message: "Run execution commit must match the repository commit." });
  }
  if (Date.parse(runContext.command.completedAt) < Date.parse(runContext.command.startedAt)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["command", "completedAt"], message: "Run completion must not precede its start." });
  }
  if (runContext.capture.status === "passed" && runContext.command.exitCode !== 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["command", "exitCode"], message: "A passed capture requires exit code zero." });
  }
  if (runContext.capture.status !== "passed" && runContext.command.exitCode === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["command", "exitCode"], message: "A non-passing capture cannot report exit code zero." });
  }
  if (runContext.capture.status === "passed" && runContext.capture.failures.length > 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["capture", "failures"], message: "A passed capture cannot contain failures." });
  }
  if (runContext.capture.status !== "passed" && runContext.capture.failures.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["capture", "failures"], message: "A non-passing capture requires a reason." });
  }
});

export const VisualRunContextSchema = VisualRunContextObjectSchema;
export const VisualRunContextInputSchema = VisualRunContextObjectSchema.innerType().omit({ runContextDigest: true });

export type VisualHiveTaskContext = z.infer<typeof VisualHiveTaskContextSchema>;
export type VisualHiveTaskContextInput = z.infer<typeof VisualHiveTaskContextInputSchema>;
export type VisualTaskAsset = z.infer<typeof VisualTaskAssetSchema>;
export type VisualExecutionCase = z.infer<typeof VisualExecutionCaseSchema>;
export type VisualExecutionContext = z.infer<typeof VisualExecutionContextSchema>;
export type VisualRepairValidation = z.infer<typeof VisualRepairValidationSchema>;
export type VisualRepairValidationInput = z.infer<typeof VisualRepairValidationInputSchema>;
export type VisualRunEvidenceAsset = z.infer<typeof VisualRunEvidenceAssetSchema>;
export type VisualRunThreshold = z.infer<typeof VisualRunThresholdSchema>;
export type VisualRunExecutionBinding = z.infer<typeof VisualRunExecutionBindingSchema>;
export type VisualRunContext = z.infer<typeof VisualRunContextSchema>;
export type VisualRunContextInput = z.infer<typeof VisualRunContextInputSchema>;
