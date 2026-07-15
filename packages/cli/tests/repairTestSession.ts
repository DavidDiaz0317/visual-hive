import {
  VISUAL_REPAIR_TOOL_NAMES,
  buildHiveExecutionAuthorization,
  buildHiveRepairSession,
  buildHiveRepairValidationRequestSpec,
  canonicalSha256,
  computeHiveRepairAttemptId,
  computeHiveRepairProviderIdentityDigest,
  computeHiveRepairSessionId,
  computeHiveRepairTurnId,
  computeHiveRepairTurnInputDigest,
  visualHiveObservationRepositoryFingerprint,
  type HiveExecutionAuthorization,
  type HiveRepairBudgetLimits,
  type HiveRepairSession,
  type HiveRepairSessionInput,
  type HiveRepairValidationRequestSpec,
  type VisualHiveTaskContext
} from "@visual-hive/core";

const commit = (character: string): string => character.repeat(40);
const digest = (character: string): string => character.repeat(64);

export interface TestRepairSessionFixture {
  session: HiveRepairSession;
  authorization: HiveExecutionAuthorization;
  budgetLimits: HiveRepairBudgetLimits;
  reproductionRequest: HiveRepairValidationRequestSpec;
  patchValidationRequest: HiveRepairValidationRequestSpec;
}

export function buildTestRepairSession(
  task: VisualHiveTaskContext,
  options: {
    findingFingerprint: string;
    candidateSha?: string;
    visualHiveVersion?: string;
    visualHiveCommit?: string;
    visualHiveManifestSha256?: string;
    visualHiveEntrypointSha256?: string;
    validationToolRegistryDigest?: string;
    configDigest?: string;
  }
): TestRepairSessionFixture {
  const candidateSha = options.candidateSha ?? commit("b");
  const rootCauseKey = "finding/visual_regression/card";
  const finding = {
    fingerprint: options.findingFingerprint,
    repositoryFingerprint: visualHiveObservationRepositoryFingerprint(task.repository.name, options.findingFingerprint, "canonical", rootCauseKey),
    publicationRole: "canonical" as const,
    rootCauseKey,
    recurrenceKey: "recurrence/visual_regression/card"
  };
  const imageAttachments = task.imageReferences.map((reference) => {
    const asset = task.assets.find((candidate) => candidate.assetId === reference.assetId);
    if (!asset) throw new Error(`Test task image reference names missing asset ${reference.assetId}.`);
    return { position: reference.position, assetId: asset.assetId, role: reference.role, sha256: asset.sha256, mediaType: asset.mediaType, size: asset.size };
  });
  const repository = {
    name: task.repository.name,
    ...(task.repository.repositoryId ? { repositoryId: task.repository.repositoryId } : {}),
    repositoryFingerprint: task.repository.repositoryFingerprint,
    baseSha: task.repository.baseSha,
    baseTreeSha: commit("d")
  };
  const taskProjection = {
    taskId: task.taskId,
    taskContextDigest: task.contextDigest,
    issueSource: task.issue.source,
    issueExternalId: task.issue.externalId,
    problemStatementDigest: task.issue.problemStatementSha256,
    imageAttachments
  };
  const sessionId = computeHiveRepairSessionId({ repository, finding, task: taskProjection } as HiveRepairSessionInput);
  const promptDigest = digest("4");
  const attemptId = computeHiveRepairAttemptId(sessionId, 0, promptDigest);
  const budgetLimits: HiveRepairBudgetLimits = {
    maxTurns: 8,
    maxToolCalls: 8,
    maxInputBytes: 4 * 1024 * 1024,
    maxImageBytes: 64 * 1024 * 1024,
    maxModelInputTokens: 100_000,
    maxModelOutputTokens: 20_000,
    maxProviderCostUsdMicros: 1_000_000,
    maxWallSeconds: 3600,
    maxRepairAttempts: 2
  };
  const configDigest = options.configDigest ?? digest("1");
  const toolRegistryDigest = canonicalSha256(VISUAL_REPAIR_TOOL_NAMES);
  const promptSchemaDigest = digest("3");
  const visualHiveManifestSha256 = options.visualHiveManifestSha256 ?? digest("9");
  const visualHiveEntrypointSha256 = options.visualHiveEntrypointSha256 ?? digest("2");
  const authorization = buildHiveExecutionAuthorization({
    authorizationId: "authorization.repair-test",
    issuedAt: "2026-07-14T15:00:00.000Z",
    expiresAt: "2026-07-14T18:00:00.000Z",
    repositoryFingerprint: task.repository.repositoryFingerprint,
    taskContextDigest: task.contextDigest,
    baseSha: task.repository.baseSha,
    profile: task.profiles[0]!,
    toolNames: [...VISUAL_REPAIR_TOOL_NAMES],
    assetIds: task.assets.map((asset) => asset.assetId),
    budgetDigest: canonicalSha256(budgetLimits),
    configDigest,
    toolRegistryDigest,
    promptSchemaDigest,
    visualHiveManifestSha256,
    visualHiveEntrypointSha256
  });
  const reproductionRequest = buildHiveRepairValidationRequestSpec({
    sessionId,
    attemptId,
    kind: "reproduction",
    commitRole: "base",
    profileId: task.profiles[0]!.profileId,
    profileDigest: task.profiles[0]!.profileDigest,
    commitSha: task.repository.baseSha,
    authorizationDigest: authorization.authorizationDigest
  });
  const patchValidationRequest = buildHiveRepairValidationRequestSpec({
    sessionId,
    attemptId,
    kind: "patch_validation",
    commitRole: "candidate",
    profileId: task.profiles[0]!.profileId,
    profileDigest: task.profiles[0]!.profileDigest,
    commitSha: candidateSha,
    authorizationDigest: authorization.authorizationDigest
  });
  const provider = {
    providerId: "provider.fixture",
    providerKind: "fixture",
    model: "fixture-model",
    executableIdentityDigest: digest("5"),
    capabilityDigest: digest("6"),
    modelConfigurationDigest: digest("7")
  };
  const turnInput = { attemptId, ordinal: 0, providerInputDigest: digest("8"), consumedToolOutcomeDigests: [] as string[] };
  const turnDraft = { ...turnInput, inputDigest: computeHiveRepairTurnInputDigest(sessionId, turnInput) };
  const turnId = computeHiveRepairTurnId(sessionId, turnDraft);
  const { authorizationDigest: _authorizationDigest, ...authorizationInput } = authorization;
  void _authorizationDigest;
  const totalSourceBytes = task.sourceContext.files.reduce((total, file) => total + file.size, 0);
  const session = buildHiveRepairSession({
    schemaVersion: "hive.repair-session.v1",
    digestAlgorithm: "hive.canonical-json.sha256.v1",
    createdAt: "2026-07-14T15:05:00.000Z",
    updatedAt: "2026-07-14T16:00:00.000Z",
    deadlineAt: "2026-07-14T17:30:00.000Z",
    requestedMode: "on",
    effectiveMode: "visual_hive",
    state: "awaiting_validation",
    repository,
    finding,
    task: taskProjection,
    capability: {
      selectionReasons: ["Fixture requires visual evidence."],
      visualHiveVersion: options.visualHiveVersion ?? "0.3.2",
      visualHiveCommit: options.visualHiveCommit ?? commit("c"),
      visualHiveManifestSha256,
      visualHiveEntrypointSha256,
      toolProtocolDigest: toolRegistryDigest,
      validationToolRegistryDigest: options.validationToolRegistryDigest ?? digest("4")
    },
    sourceContext: {
      digest: task.sourceContext.digest,
      maxBytes: Math.max(totalSourceBytes, 4096),
      totalBytes: totalSourceBytes,
      files: task.sourceContext.files,
      omittedPaths: task.sourceContext.omittedPaths,
      truncated: task.sourceContext.truncated
    },
    validationProfiles: task.profiles,
    promptIdentities: {
      systemPromptDigest: digest("a"),
      repairPromptDigest: digest("b"),
      toolSchemaDigest: digest("c"),
      taskSchemaDigest: digest("e"),
      modelConfigurationDigest: provider.modelConfigurationDigest
    },
    executionIdentities: { configDigest, toolRegistryDigest, promptSchemaDigest },
    provider,
    budgets: {
      limits: budgetLimits,
      usage: {
        turnsConsumed: 1,
        toolCallsConsumed: 0,
        inputBytesConsumed: 512,
        imageBytesConsumed: 0,
        modelInputTokensConsumed: 500,
        modelOutputTokensConsumed: 200,
        providerCostUsdMicrosConsumed: 10_000,
        wallMillisecondsConsumed: 60_000
      }
    },
    attempts: [{
      attemptId,
      ordinal: 0,
      state: "candidate",
      startedAt: "2026-07-14T15:10:00.000Z",
      completedAt: "2026-07-14T15:50:00.000Z",
      promptDigest,
      turnIds: [turnId],
      candidatePatchDigest: digest("f"),
      candidateHeadSha: candidateSha,
      candidateHeadTreeSha: commit("e"),
      validationRequestIds: [reproductionRequest.requestId, patchValidationRequest.requestId]
    }],
    turns: [{
      ...turnDraft,
      turnId,
      state: "completed",
      startedAt: "2026-07-14T15:20:00.000Z",
      completedAt: "2026-07-14T15:40:00.000Z",
      providerIdentityDigest: computeHiveRepairProviderIdentityDigest(provider),
      usage: { inputBytes: 512, imageBytes: 0, modelInputTokens: 500, modelOutputTokens: 200, providerCostUsdMicros: 10_000, wallMilliseconds: 60_000 },
      providerReceiptDigest: digest("0"),
      outputKind: "final_result",
      outputDigest: digest("1")
    }],
    toolReceipts: [],
    validationRequests: [
      { ...reproductionRequest, state: "requested", requestedAt: "2026-07-14T15:45:00.000Z" },
      { ...patchValidationRequest, state: "requested", requestedAt: "2026-07-14T15:45:00.000Z" }
    ],
    authorization: authorizationInput
  });
  return { session, authorization, budgetLimits, reproductionRequest, patchValidationRequest };
}
