import { readFile } from "node:fs/promises";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import {
  buildHiveExecutionAuthorization,
  buildHiveRepairResult,
  buildHiveRepairSession,
  buildHiveRepairValidationRequestSpec,
  canonicalJson,
  canonicalSha256,
  computeHiveRepairAttemptId,
  computeHiveRepairProviderIdentityDigest,
  computeHiveRepairSessionId,
  computeHiveRepairSourceContextDigest,
  computeHiveRepairToolCallId,
  computeHiveRepairToolOutcomeDigest,
  computeHiveRepairTurnInputDigest,
  computeHiveRepairTurnId,
  computeHiveRepairValidationProfileDigest,
  computeVisualRepositoryFingerprint,
  computeVisualValidationProfileDigest,
  parseHiveExecutionAuthorization,
  parseHiveRepairResult,
  parseHiveRepairSession,
  verifyHiveRepairResultAgainstSession,
  visualHiveObservationRepositoryFingerprint,
  VISUAL_REPAIR_TOOL_NAMES,
  type HiveExecutionAuthorization,
  type HiveRepairResult,
  type HiveRepairResultInput,
  type HiveRepairSession,
  type HiveRepairSessionInput,
  type HiveRepairValidationProfile
} from "../src/index.js";

const sha = (character: string): string => character.repeat(64);
const commit = (character: string): string => character.repeat(40);

describe("hive.repair-session.v1 and hive.repair-result.v1", () => {
  it("matches the immutable cross-language repair identity vectors", async () => {
    const root = path.resolve(import.meta.dirname, "../../..");
    const fixture = JSON.parse(await readFile(path.join(root, "schemas", "fixtures", "hive.repair-contract-vectors.v1.json"), "utf8")) as {
      schemaVersion: string;
      digestAlgorithm: string;
      vectors: Array<{ name: string; projection: any; canonical: string; sha256: string }>;
    };
    expect(fixture.schemaVersion).toBe("hive.repair-contract-vectors.v1");
    expect(fixture.digestAlgorithm).toBe("hive.canonical-json.sha256.v1");
    for (const vector of fixture.vectors) {
      expect(canonicalJson(vector.projection), vector.name).toBe(vector.canonical);
      expect(canonicalSha256(vector.projection), vector.name).toBe(vector.sha256);
    }

    const vectors = new Map(fixture.vectors.map((vector) => [vector.name, vector]));
    const profile = vectors.get("validation-profile")!;
    expect(computeHiveRepairValidationProfileDigest({ ...profile.projection, profileDigest: sha("0") })).toBe(profile.sha256);
    const source = vectors.get("source-context")!;
    expect(computeHiveRepairSourceContextDigest(source.projection)).toBe(source.sha256);
    const provider = vectors.get("provider-identity")!;
    expect(computeHiveRepairProviderIdentityDigest(provider.projection)).toBe(provider.sha256);
    const attempt = vectors.get("repair-attempt-id")!;
    expect(computeHiveRepairAttemptId(attempt.projection.sessionId, attempt.projection.ordinal, attempt.projection.promptDigest)).toBe(attempt.sha256);
    const turnInput = vectors.get("repair-turn-input")!;
    expect(computeHiveRepairTurnInputDigest(turnInput.projection.sessionId, {
      attemptId: turnInput.projection.attemptId,
      ordinal: turnInput.projection.ordinal,
      providerInputDigest: turnInput.projection.providerInputDigest,
      consumedToolOutcomeDigests: turnInput.projection.consumedToolOutcomeDigests
    })).toBe(turnInput.sha256);
    const turn = vectors.get("repair-turn-id")!;
    expect(computeHiveRepairTurnId(turn.projection.sessionId, turn.projection)).toBe(turn.sha256);
    const call = vectors.get("repair-tool-call-id")!;
    expect(computeHiveRepairToolCallId(call.projection.sessionId, call.projection)).toBe(call.sha256);
    const outcome = vectors.get("repair-tool-outcome")!;
    expect(computeHiveRepairToolOutcomeDigest({
      callId: outcome.projection.callId,
      toolName: outcome.projection.toolName,
      argumentsDigest: outcome.projection.argumentsDigest,
      resultDigest: outcome.projection.resultDigest,
      status: outcome.projection.status,
      textBytes: outcome.projection.textBytes,
      imageBytes: outcome.projection.imageBytes
    })).toBe(outcome.sha256);
    const authorization = vectors.get("execution-authorization")!;
    expect(buildHiveExecutionAuthorization(authorization.projection).authorizationDigest).toBe(authorization.sha256);
    const request = vectors.get("validation-request-digest")!.projection;
    const builtRequest = buildHiveRepairValidationRequestSpec({
      sessionId: request.sessionId,
      attemptId: request.attemptId,
      kind: request.kind,
      commitRole: request.commitRole,
      profileId: request.profileId,
      profileDigest: request.profileDigest,
      commitSha: request.commitSha,
      authorizationDigest: request.authorizationDigest
    });
    expect(builtRequest.requestId).toBe(request.requestId);
    expect(builtRequest.idempotencyKey).toBe(request.idempotencyKey);
    expect(builtRequest.requestDigest).toBe(vectors.get("validation-request-digest")!.sha256);
  });

  it("matches the checked-in draft-2020 JSON Schemas", async () => {
    const fixture = buildFixture("visual_hive");
    const root = path.resolve(import.meta.dirname, "../../..");
    const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
    for (const [file, value] of [
      ["visual-hive.hive-repair-session.schema.json", fixture.session],
      ["visual-hive.hive-repair-result.schema.json", fixture.result]
    ] as const) {
      const schema = JSON.parse(await readFile(path.join(root, "schemas", file), "utf8"));
      const validate = ajv.compile(schema);
      expect(validate(value), JSON.stringify(validate.errors)).toBe(true);
    }
  });

  it("keeps Zod and JSON Schema aligned for Windows-reserved paths", async () => {
    const fixture = buildFixture("visual_hive");
    const root = path.resolve(import.meta.dirname, "../../..");
    const schema = JSON.parse(await readFile(path.join(root, "schemas", "visual-hive.hive-repair-session.schema.json"), "utf8"));
    const validate = new Ajv2020({ allErrors: true, strict: false, validateFormats: false }).compile(schema);
    for (const invalidPath of ["CON", "Com1/file.ts", "nested/Lpt9.txt"]) {
      const artifact = structuredClone(fixture.session) as any;
      artifact.sourceContext.files[0].path = invalidPath;
      expect(validate(artifact), invalidPath).toBe(false);

      const input = structuredClone(fixture.sessionInput);
      input.sourceContext.files[0]!.path = invalidPath;
      input.sourceContext.digest = computeHiveRepairSourceContextDigest(input.sourceContext);
      expect(() => buildHiveRepairSession(input), invalidPath).toThrow();
    }
  });

  it("builds deterministic canonical Visual Hive session and result contracts", () => {
    const fixture = buildFixture("visual_hive");

    expect(parseHiveExecutionAuthorization(fixture.authorization)).toEqual(fixture.authorization);
    expect(parseHiveRepairSession(fixture.session)).toEqual(fixture.session);
    expect(parseHiveRepairResult(fixture.result)).toEqual(fixture.result);
    expect(verifyHiveRepairResultAgainstSession(fixture.result, fixture.session)).toEqual(fixture.result);
    expect(buildHiveRepairSession(fixture.sessionInput)).toEqual(fixture.session);
    expect(buildHiveRepairResult(fixture.resultInput)).toEqual(fixture.result);
    expect(fixture.session.authorization?.toolNames).toEqual([...VISUAL_REPAIR_TOOL_NAMES].sort());
    expect(fixture.result.authorizationDigest).toBe(fixture.authorization.authorizationDigest);
    expect(computeHiveRepairValidationProfileDigest(fixture.profile)).toBe(computeVisualValidationProfileDigest(fixture.profile));
  });

  it("preserves the standard Hive repair path without Visual Hive authorization or tools", () => {
    const fixture = buildFixture("standard");

    expect(fixture.session.requestedMode).toBe("off");
    expect(fixture.session.authorization).toBeUndefined();
    expect(fixture.session.toolReceipts).toEqual([]);
    expect(fixture.result.authorizationDigest).toBeUndefined();
    expect(fixture.result.toolReceipts).toEqual([]);
    expect(verifyHiveRepairResultAgainstSession(fixture.result, fixture.session)).toEqual(fixture.result);
  });

  it("keeps resumable session identity stable across equivalent regenerated task context", () => {
    const fixture = buildFixture("visual_hive");
    const changedContext = structuredClone(fixture.sessionInput);
    changedContext.task.taskContextDigest = sha("f");
    changedContext.authorization!.taskContextDigest = sha("f");
    const changedAuthorization = buildHiveExecutionAuthorization(changedContext.authorization!);
    changedContext.authorization = stripAuthorization(changedAuthorization);
    const changedRequest = buildHiveRepairValidationRequestSpec({
      sessionId: fixture.session.sessionId,
      attemptId: fixture.session.attempts[0]!.attemptId,
      kind: "patch_validation",
      commitRole: "candidate",
      profileId: fixture.profile.profileId,
      profileDigest: fixture.profile.profileDigest,
      commitSha: fixture.result.headSha,
      authorizationDigest: changedAuthorization.authorizationDigest
    });
    changedContext.validationRequests = [{ ...changedRequest, state: "requested", requestedAt: "2026-07-14T11:45:00.000Z" }];
    changedContext.attempts[0]!.validationRequestIds = [changedRequest.requestId];

    expect(computeHiveRepairSessionId(changedContext)).toBe(fixture.session.sessionId);
    expect(buildHiveRepairSession(changedContext).sessionDigest).not.toBe(fixture.session.sessionDigest);
  });

  it("rejects mode widening, incomplete capability identity, and stale or widened authorization", () => {
    const fixture = buildFixture("visual_hive");
    const off = structuredClone(fixture.sessionInput);
    off.requestedMode = "off";
    expect(() => buildHiveRepairSession(off)).toThrow("mode off");

    const requiredStandard = structuredClone(buildFixture("standard").sessionInput);
    requiredStandard.requestedMode = "required";
    expect(() => buildHiveRepairSession(requiredStandard)).toThrow("mode required");

    const missingCapability = structuredClone(fixture.sessionInput);
    delete missingCapability.capability.visualHiveVersion;
    expect(() => buildHiveRepairSession(missingCapability)).toThrow("pinned Visual Hive capability");

    const expired = structuredClone(fixture.sessionInput);
    expired.authorization!.expiresAt = "2026-07-14T11:30:00.000Z";
    expect(() => buildHiveRepairSession(expired)).toThrow("session snapshot time");

    const widenedAuthorization = authorizationInput(fixture.profile, fixture.sessionInput);
    widenedAuthorization.toolNames = widenedAuthorization.toolNames.slice(1);
    expect(() => buildHiveExecutionAuthorization(widenedAuthorization)).toThrow(/exactly the frozen|exactly 8/u);
  });

  it("rejects source, repository, profile, budget, and model-configuration drift", () => {
    const fixture = buildFixture("visual_hive");

    const source = structuredClone(fixture.sessionInput);
    source.sourceContext.totalBytes += 1;
    expect(() => buildHiveRepairSession(source)).toThrow("source-context byte accounting");

    const leakedSource = structuredClone(fixture.sessionInput);
    leakedSource.sourceContext.files[0]!.path = ".swebench/gold.patch";
    leakedSource.sourceContext.digest = computeHiveRepairSourceContextDigest(leakedSource.sourceContext);
    expect(() => buildHiveRepairSession(leakedSource)).toThrow("prohibited evaluator or answer path");

    const repository = structuredClone(fixture.sessionInput);
    repository.repository.name = "owner/other";
    expect(() => buildHiveRepairSession(repository)).toThrow("repository fingerprint");

    const profile = structuredClone(fixture.sessionInput);
    profile.validationProfiles[0]!.routes.push("/admin");
    expect(() => buildHiveRepairSession(profile)).toThrow(/profile digest|authorization profile/u);

    const budget = structuredClone(fixture.sessionInput);
    budget.budgets.limits.maxTurns = 1;
    expect(() => buildHiveRepairSession(budget)).toThrow(/declared budget|bind the session budget/u);

    const provider = structuredClone(fixture.sessionInput);
    provider.provider.modelConfigurationDigest = sha("e");
    expect(() => buildHiveRepairSession(provider)).toThrow("model configuration");
  });

  it("requires exact turn, receipt, attempt, and validation-request relationships", () => {
    const fixture = buildFixture("visual_hive");

    const lostReceipt = structuredClone(fixture.sessionInput);
    lostReceipt.toolReceipts = [];
    lostReceipt.budgets.usage.toolCallsConsumed = 0;
    lostReceipt.budgets.usage.wallMillisecondsConsumed -= 60_000;
    expect(() => buildHiveRepairSession(lostReceipt)).toThrow("no matching durable tool receipt");

    const wrongAttempt = structuredClone(fixture.sessionInput);
    wrongAttempt.validationRequests[0]!.attemptId = "attempt.other";
    expect(() => buildHiveRepairSession(wrongAttempt)).toThrow(/validation request ID|owned by another attempt/u);

    const duplicateOrdinal = structuredClone(fixture.sessionInput);
    duplicateOrdinal.turns[1]!.ordinal = 0;
    expect(() => buildHiveRepairSession(duplicateOrdinal)).toThrow("turn ordinals");

    const badRequestDigest = structuredClone(fixture.sessionInput);
    badRequestDigest.validationRequests[0]!.requestDigest = sha("f");
    expect(() => buildHiveRepairSession(badRequestDigest)).toThrow("request digest");

    const invalidLifecycle = structuredClone(fixture.sessionInput);
    invalidLifecycle.validationRequests[0]!.state = "started";
    invalidLifecycle.validationRequests[0]!.startedAt = "2026-07-14T11:44:00.000Z";
    expect(() => buildHiveRepairSession(invalidLifecycle)).toThrow("before it is requested");

    const unauthorizedCommit = structuredClone(fixture.sessionInput);
    const unauthorizedRequest = buildHiveRepairValidationRequestSpec({
      sessionId: fixture.session.sessionId,
      attemptId: fixture.session.attempts[0]!.attemptId,
      kind: "patch_validation",
      commitRole: "candidate",
      profileId: fixture.profile.profileId,
      profileDigest: fixture.profile.profileDigest,
      commitSha: commit("f"),
      authorizationDigest: fixture.authorization.authorizationDigest
    });
    unauthorizedCommit.validationRequests = [{ ...unauthorizedRequest, state: "requested", requestedAt: "2026-07-14T11:45:00.000Z" }];
    unauthorizedCommit.attempts[0]!.validationRequestIds = [unauthorizedRequest.requestId];
    expect(() => buildHiveRepairSession(unauthorizedCommit)).toThrow("unauthorized commit");

    const providerIdentity = structuredClone(fixture.sessionInput);
    providerIdentity.turns[0]!.providerIdentityDigest = sha("f");
    expect(() => buildHiveRepairSession(providerIdentity)).toThrow("provider identity");

    const usage = structuredClone(fixture.sessionInput);
    usage.budgets.usage.providerCostUsdMicrosConsumed += 1;
    expect(() => buildHiveRepairSession(usage)).toThrow("does not recompute");

    const omittedEvidence = structuredClone(fixture.sessionInput);
    omittedEvidence.turns[1]!.consumedToolOutcomeDigests = [];
    expect(() => buildHiveRepairSession(omittedEvidence)).toThrow("input digest does not bind");

    const prematureNextTurn = structuredClone(fixture.sessionInput);
    prematureNextTurn.turns[1]!.startedAt = "2026-07-14T11:12:30.000Z";
    expect(() => buildHiveRepairSession(prematureNextTurn)).toThrow("durably available");

    const noFinalResult = structuredClone(fixture.sessionInput);
    noFinalResult.turns.at(-1)!.outputKind = "error";
    expect(() => buildHiveRepairSession(noFinalResult)).toThrow("final-result turn");

    const unknownTool = structuredClone(fixture.sessionInput) as any;
    unknownTool.toolReceipts[0].toolName = "visual_hive_unknown";
    expect(() => buildHiveRepairSession(unknownTool)).toThrow();
  });

  it("records a structured terminal reason only when the named budget is exhausted", () => {
    const exhausted = structuredClone(buildFixture("standard").sessionInput);
    exhausted.state = "exhausted";
    exhausted.budgets.limits.maxTurns = exhausted.budgets.usage.turnsConsumed;
    exhausted.terminal = { code: "budget_exhausted", message: "Turn budget reached.", retryable: true, exhaustedLimit: "turns" };
    expect(() => buildHiveRepairSession(exhausted)).not.toThrow();

    exhausted.terminal.exhaustedLimit = "tool_calls";
    expect(() => buildHiveRepairSession(exhausted)).toThrow("has not been exhausted");
  });

  it("rejects result metadata fabricated after the session snapshot", () => {
    const fixture = buildFixture("visual_hive");

    const provider = resultInput(fixture.result);
    provider.provider.model = "substitute-model";
    expect(() => verifyHiveRepairResultAgainstSession(buildHiveRepairResult(provider), fixture.session)).toThrow("provider identity");

    const receipt = resultInput(fixture.result);
    receipt.toolReceipts[0]!.textBytes += 1;
    receipt.toolReceipts[0]!.outcomeDigest = computeHiveRepairToolOutcomeDigest(receipt.toolReceipts[0]!);
    expect(() => verifyHiveRepairResultAgainstSession(buildHiveRepairResult(receipt), fixture.session)).toThrow("tool receipts");

    const requests = resultInput(fixture.result);
    requests.validationRequests.push(buildHiveRepairValidationRequestSpec({
      sessionId: fixture.session.sessionId,
      attemptId: fixture.session.attempts[0]!.attemptId,
      kind: "capture",
      commitRole: "candidate",
      profileId: fixture.profile.profileId,
      profileDigest: fixture.profile.profileDigest,
      commitSha: fixture.result.headSha,
      authorizationDigest: fixture.authorization.authorizationDigest
    }));
    expect(() => verifyHiveRepairResultAgainstSession(buildHiveRepairResult(requests), fixture.session)).toThrow("validation requests");

    const diff = resultInput(fixture.result);
    diff.diff.sha256 = sha("f");
    expect(() => verifyHiveRepairResultAgainstSession(buildHiveRepairResult(diff), fixture.session)).toThrow("candidate attempt");
  });

  it("permits base reproduction while requiring head-bound patch validation", () => {
    const fixture = buildFixture("visual_hive");
    const input = resultInput(fixture.result);
    input.validationRequests.unshift(buildHiveRepairValidationRequestSpec({
      sessionId: fixture.session.sessionId,
      attemptId: fixture.session.attempts[0]!.attemptId,
      kind: "reproduction",
      commitRole: "base",
      profileId: fixture.profile.profileId,
      profileDigest: fixture.profile.profileDigest,
      commitSha: fixture.result.baseSha,
      authorizationDigest: fixture.authorization.authorizationDigest
    }));
    expect(() => buildHiveRepairResult(input)).not.toThrow();

    const noHeadValidation = resultInput(fixture.result);
    noHeadValidation.validationRequests[0]!.commitSha = fixture.result.baseSha;
    expect(() => buildHiveRepairResult(noHeadValidation)).toThrow("request ID");
  });

  it("rejects duplicate changed paths and non-canonical array order", () => {
    const fixture = buildFixture("visual_hive");
    const duplicate = resultInput(fixture.result);
    duplicate.diff.changedFiles.push({ ...duplicate.diff.changedFiles[0]!, status: "modified" });
    expect(() => buildHiveRepairResult(duplicate)).toThrow("Duplicate Hive repair contract identity");

    const nonCanonical = structuredClone(fixture.session) as any;
    nonCanonical.turns.reverse();
    nonCanonical.transcriptDigest = canonicalSha256({ turns: nonCanonical.turns, toolReceipts: nonCanonical.toolReceipts });
    const { sessionDigest: _oldDigest, ...content } = nonCanonical;
    void _oldDigest;
    nonCanonical.sessionDigest = canonicalSha256(content);
    expect(() => parseHiveRepairSession(nonCanonical)).toThrow("canonical normalized form");
  });
});

interface Fixture {
  profile: HiveRepairValidationProfile;
  authorization: HiveExecutionAuthorization;
  sessionInput: HiveRepairSessionInput;
  session: HiveRepairSession;
  resultInput: HiveRepairResultInput;
  result: HiveRepairResult;
}

function buildFixture(mode: "standard" | "visual_hive"): Fixture {
  const repository = "owner/repo";
  const repositoryId = "42";
  const repositoryFingerprint = computeVisualRepositoryFingerprint(repository, repositoryId);
  const finding = {
    fingerprint: "visual-hive:fixture:card-layout",
    repositoryFingerprint: visualHiveObservationRepositoryFingerprint(repository, "visual-hive:fixture:card-layout", "canonical", "finding/visual_regression/card"),
    publicationRole: "canonical" as const,
    rootCauseKey: "finding/visual_regression/card",
    recurrenceKey: "recurrence/visual_regression/card"
  };
  const profile = profileFixture();
  const sourceFiles = [{ path: "src/App.tsx", sha256: sha("8"), size: 200, classification: "source" as const }];
  const sourceContext = {
    digest: computeHiveRepairSourceContextDigest({ files: sourceFiles, omittedPaths: 0, truncated: false }),
    maxBytes: 4096,
    totalBytes: 200,
    files: sourceFiles,
    omittedPaths: 0,
    truncated: false
  };
  const limits = {
    maxTurns: 8,
    maxToolCalls: 8,
    maxInputBytes: 1_000_000,
    maxImageBytes: 1_000_000,
    maxModelInputTokens: 20_000,
    maxModelOutputTokens: 10_000,
    maxProviderCostUsdMicros: 5_000_000,
    maxWallSeconds: 1800,
    maxRepairAttempts: 2
  };
  const provider = { providerId: "provider.fixture", providerKind: "fixture", model: "fixture-model", executableIdentityDigest: sha("2"), capabilityDigest: sha("3"), modelConfigurationDigest: sha("1") };
  const providerIdentityDigest = computeHiveRepairProviderIdentityDigest(provider);
  const identity = {
    repository: { name: repository, repositoryId, repositoryFingerprint, baseSha: commit("a"), baseTreeSha: commit("c") },
    finding,
    task: {
      taskId: "task.card-layout",
      taskContextDigest: sha("1"),
      issueSource: "fixture" as const,
      issueExternalId: "fixture-1",
      problemStatementDigest: sha("2"),
      imageAttachments: [{ position: 0, assetId: "asset.reference", role: "reference" as const, sha256: sha("3"), mediaType: "image/png" as const, size: 128 }]
    }
  };
  const sessionId = computeHiveRepairSessionId(identity as HiveRepairSessionInput);
  const promptDigest = sha("4");
  const attemptId = computeHiveRepairAttemptId(sessionId, 0, promptDigest);
  const authorizationBase = authorizationInput(profile, {
    repository: identity.repository,
    task: identity.task,
    budgets: { limits }
  } as HiveRepairSessionInput);
  const authorization = buildHiveExecutionAuthorization(authorizationBase);
  const firstTurnInput = { attemptId, ordinal: 0, providerInputDigest: sha("5"), consumedToolOutcomeDigests: [] as string[] };
  const firstTurnDraft = { ...firstTurnInput, inputDigest: computeHiveRepairTurnInputDigest(sessionId, firstTurnInput) };
  const firstTurnId = computeHiveRepairTurnId(sessionId, firstTurnDraft);
  const receiptDraft = { turnId: firstTurnId, sequence: 0, toolName: "visual_hive_get_task_context" as const, argumentsDigest: sha("6") };
  const callId = computeHiveRepairToolCallId(sessionId, receiptDraft);
  const toolReceiptContent = {
    ...receiptDraft,
    callId,
    resultDigest: sha("b"),
    status: "passed" as const,
    startedAt: "2026-07-14T11:12:00.000Z",
    completedAt: "2026-07-14T11:13:00.000Z",
    textBytes: 256,
    imageBytes: 128
  };
  const toolReceipt = { ...toolReceiptContent, outcomeDigest: computeHiveRepairToolOutcomeDigest(toolReceiptContent) };
  const finalOrdinal = mode === "visual_hive" ? 1 : 0;
  const finalTurnInput = {
    attemptId,
    ordinal: finalOrdinal,
    providerInputDigest: sha("7"),
    ...(mode === "visual_hive" ? { previousTurnOutputDigest: sha("9"), consumedToolOutcomeDigests: [toolReceipt.outcomeDigest] } : { consumedToolOutcomeDigests: [] as string[] })
  };
  const finalTurnDraft = { ...finalTurnInput, inputDigest: computeHiveRepairTurnInputDigest(sessionId, finalTurnInput) };
  const finalTurnId = computeHiveRepairTurnId(sessionId, finalTurnDraft);
  const requestSpec = buildHiveRepairValidationRequestSpec({
    sessionId,
    attemptId,
    kind: "patch_validation",
    commitRole: "candidate",
    profileId: profile.profileId,
    profileDigest: profile.profileDigest,
    commitSha: commit("b"),
    ...(mode === "visual_hive" ? { authorizationDigest: authorization.authorizationDigest } : {})
  });
  const turns = mode === "visual_hive" ? [{
    ...firstTurnDraft,
    turnId: firstTurnId,
    state: "completed" as const,
    startedAt: "2026-07-14T11:10:00.000Z",
    completedAt: "2026-07-14T11:11:00.000Z",
    providerIdentityDigest,
    usage: { inputBytes: 500, imageBytes: 0, modelInputTokens: 500, modelOutputTokens: 100, providerCostUsdMicros: 50_000, wallMilliseconds: 60_000 },
    providerReceiptDigest: sha("c"),
    outputKind: "tool_request" as const,
    outputDigest: sha("9"),
    toolCallId: callId
  }, {
    ...finalTurnDraft,
    turnId: finalTurnId,
    state: "completed" as const,
    startedAt: "2026-07-14T11:30:00.000Z",
    completedAt: "2026-07-14T11:40:00.000Z",
    providerIdentityDigest,
    usage: { inputBytes: 524, imageBytes: 128, modelInputTokens: 500, modelOutputTokens: 400, providerCostUsdMicros: 50_000, wallMilliseconds: 600_000 },
    providerReceiptDigest: sha("d"),
    outputKind: "final_result" as const,
    outputDigest: sha("a")
  }] : [{
    ...finalTurnDraft,
    turnId: finalTurnId,
    state: "completed" as const,
    startedAt: "2026-07-14T11:30:00.000Z",
    completedAt: "2026-07-14T11:40:00.000Z",
    providerIdentityDigest,
    usage: { inputBytes: 512, imageBytes: 0, modelInputTokens: 1000, modelOutputTokens: 500, providerCostUsdMicros: 100_000, wallMilliseconds: 600_000 },
    providerReceiptDigest: sha("d"),
    outputKind: "final_result" as const,
    outputDigest: sha("a")
  }];
  const toolReceipts = mode === "visual_hive" ? [toolReceipt] : [];
  const sessionInput: HiveRepairSessionInput = {
    schemaVersion: "hive.repair-session.v1",
    digestAlgorithm: "hive.canonical-json.sha256.v1",
    createdAt: "2026-07-14T11:00:00.000Z",
    updatedAt: "2026-07-14T12:00:00.000Z",
    deadlineAt: "2026-07-14T12:30:00.000Z",
    requestedMode: mode === "visual_hive" ? "on" : "off",
    effectiveMode: mode,
    state: "awaiting_validation",
    ...identity,
    capability: mode === "visual_hive" ? {
      selectionReasons: ["Task includes a reference image."],
      visualHiveVersion: "0.3.2",
      visualHiveCommit: commit("d"),
      toolProtocolDigest: sha("c"),
      validationToolRegistryDigest: sha("d")
    } : { selectionReasons: ["Visual Hive was disabled."] },
    sourceContext,
    validationProfiles: [profile],
    promptIdentities: {
      systemPromptDigest: sha("d"), repairPromptDigest: sha("e"), toolSchemaDigest: sha("f"), taskSchemaDigest: sha("0"), modelConfigurationDigest: sha("1")
    },
    executionIdentities: { configDigest: sha("a"), toolRegistryDigest: sha("c"), promptSchemaDigest: sha("e") },
    provider,
    budgets: {
      limits,
      usage: {
        turnsConsumed: turns.length,
        toolCallsConsumed: toolReceipts.length,
        inputBytesConsumed: mode === "visual_hive" ? 1024 : 512,
        imageBytesConsumed: mode === "visual_hive" ? 128 : 0,
        modelInputTokensConsumed: 1000,
        modelOutputTokensConsumed: 500,
        providerCostUsdMicrosConsumed: 100_000,
        wallMillisecondsConsumed: mode === "visual_hive" ? 720_000 : 600_000
      }
    },
    attempts: [{
      attemptId,
      ordinal: 0,
      state: "candidate",
      startedAt: "2026-07-14T11:05:00.000Z",
      completedAt: "2026-07-14T11:50:00.000Z",
      promptDigest,
      turnIds: turns.map((turn) => turn.turnId),
      candidatePatchDigest: sha("4"),
      candidateHeadSha: commit("b"),
      candidateHeadTreeSha: commit("d"),
      validationRequestIds: [requestSpec.requestId]
    }],
    turns,
    toolReceipts,
    validationRequests: [{ ...requestSpec, state: "requested", requestedAt: "2026-07-14T11:45:00.000Z" }],
    ...(mode === "visual_hive" ? { authorization: stripAuthorization(authorization) } : {})
  };
  const session = buildHiveRepairSession(sessionInput);
  const resultInputValue: HiveRepairResultInput = {
    schemaVersion: "hive.repair-result.v1",
    digestAlgorithm: "hive.canonical-json.sha256.v1",
    generatedAt: "2026-07-14T12:01:00.000Z",
    sessionId: session.sessionId,
    sessionDigest: session.sessionDigest,
    transcriptDigest: session.transcriptDigest,
    effectiveMode: mode,
    taskId: session.task.taskId,
    taskContextDigest: session.task.taskContextDigest,
    repository: { name: repository, repositoryId, repositoryFingerprint },
    finding,
    baseSha: commit("a"),
    baseTreeSha: commit("c"),
    headSha: commit("b"),
    headTreeSha: commit("d"),
    diff: {
      algorithm: "git.diff.binary.sha256.v1",
      sha256: sha("4"),
      changedFiles: [{ path: "src/App.tsx", status: "modified", beforeSha256: sha("5"), afterSha256: sha("6"), beforeMode: "100644", afterMode: "100644" }]
    },
    provider: { ...session.provider },
    attempts: [{
      attemptId,
      ordinal: 0,
      state: "candidate",
      promptDigest,
      startedAt: "2026-07-14T11:05:00.000Z",
      completedAt: "2026-07-14T11:50:00.000Z",
      turnCount: turns.length,
      toolCallCount: toolReceipts.length
    }],
    toolReceipts,
    ...(mode === "visual_hive" ? { authorizationDigest: authorization.authorizationDigest } : {}),
    validationRequests: [requestSpec],
    claimedOutcome: { summary: "Updated the card layout without changing visual policy.", advisory: true },
    status: "candidate"
  };
  const result = buildHiveRepairResult(resultInputValue);
  return { profile, authorization, sessionInput, session, resultInput: resultInputValue, result };
}

function profileFixture(): HiveRepairValidationProfile {
  const profile: HiveRepairValidationProfile = {
    profileId: "profile.repair",
    profileDigest: sha("0"),
    targetId: "target.app",
    requestKinds: ["reproduction", "capture", "patch_validation"],
    contractIds: ["contract.card", "contract.secondary"],
    routes: ["/"],
    scenarioIds: ["default"],
    viewports: [{ viewportId: "desktop", width: 1280, height: 720, deviceScaleFactor: 1 }],
    validationCommandId: "command.playwright"
  };
  profile.profileDigest = computeHiveRepairValidationProfileDigest(profile);
  return profile;
}

function authorizationInput(profile: HiveRepairValidationProfile, session: HiveRepairSessionInput): Omit<HiveExecutionAuthorization, "authorizationDigest"> {
  return {
    authorizationId: "authorization.fixture",
    issuedAt: "2026-07-14T10:55:00.000Z",
    expiresAt: "2026-07-14T13:00:00.000Z",
    repositoryFingerprint: session.repository.repositoryFingerprint,
    taskContextDigest: session.task.taskContextDigest,
    baseSha: session.repository.baseSha,
    profile,
    toolNames: [...VISUAL_REPAIR_TOOL_NAMES],
    assetIds: session.task.imageAttachments.map((asset) => asset.assetId),
    budgetDigest: canonicalSha256(session.budgets.limits),
    configDigest: sha("a"),
    toolRegistryDigest: sha("c"),
    promptSchemaDigest: sha("e")
  };
}

function stripAuthorization(authorization: HiveExecutionAuthorization): Omit<HiveExecutionAuthorization, "authorizationDigest"> {
  const { authorizationDigest: _digest, ...input } = authorization;
  void _digest;
  return input;
}

function resultInput(result: HiveRepairResult): HiveRepairResultInput {
  const { resultDigest: _digest, ...input } = structuredClone(result);
  void _digest;
  return input;
}
