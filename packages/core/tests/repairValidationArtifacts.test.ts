import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PNG } from "pngjs";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildHiveExecutionAuthorization,
  buildHiveRepairResult,
  buildHiveRepairSession,
  buildHiveRepairValidationRequestSpec,
  buildVisualHiveTaskContext,
  buildVisualRepairValidationFromArtifacts,
  buildVisualRunContext,
  canonicalSha256,
  computeHiveRepairAttemptId,
  computeHiveRepairProviderIdentityDigest,
  computeHiveRepairSessionId,
  computeHiveRepairToolCallId,
  computeHiveRepairToolOutcomeDigest,
  computeHiveRepairTurnInputDigest,
  computeHiveRepairTurnId,
  computeVisualRepositoryFingerprint,
  computeVisualValidationPolicyDigest,
  computeVisualValidationProfileDigest,
  compareVisualPngBytes,
  sha256Bytes,
  sha256Utf8,
  VISUAL_REPAIR_TOOL_NAMES,
  visualHiveObservationRepositoryFingerprint,
  writeVisualHiveBundle,
  type BuildVisualRepairValidationArtifacts,
  type RawRepairArtifact,
  type VisualHiveBundleObservation
} from "../src/index.js";

const temporaryRoots: string[] = [];
const sha = (character: string): string => character.repeat(64);
const commit = (character: string): string => character.repeat(40);
const releaseManifestSha256 = sha("e");
const releaseEntrypointSha256 = sha("f");
const executionBinding = {
  nonceSha256: sha("1"),
  generatedSpecSha256: sha("2"),
  generatedConfigSha256: sha("3"),
  payloadSha256: sha("4"),
  bindingMacSha256: sha("5")
};

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("artifact-derived visual-hive.repair-validation.v1", () => {
  it("derives an authoritative passing receipt from actual bundles, reports, contexts, and images", async () => {
    const fixture = await repairFixture();
    const receipt = buildVisualRepairValidationFromArtifacts(fixture.input);

    expect(receipt).toMatchObject({
      verdict: "pass",
      closureRecommendation: "resolved_candidate",
      findingBeforeStatus: "present",
      findingStatus: "absent",
      authoritativeForResolution: true,
      policyChanges: { configChanged: false, validationPolicyChanged: false, thresholdWeakened: false, baselineChanged: false }
    });
    expect(receipt.screenshotTriplets).toHaveLength(1);
    expect(receipt.screenshotTriplets[0]!.diffPixels).toBeGreaterThan(0);
    expect(receipt.lanes.targeted.status).toBe("passed");
    expect(receipt.lanes.regression.status).toBe("passed");
    expect(receipt.remainingFailures).toEqual([]);
    expect(receipt.newFailures).toEqual([]);
  });

  it("rejects tampering in every raw identity boundary", async () => {
    const task = await repairFixture();
    task.input.taskContext = tamperJson(task.input.taskContext, (value) => { value.contextDigest = sha("f"); });
    expect(() => buildVisualRepairValidationFromArtifacts(task.input)).toThrow("digest mismatch");

    const hive = await repairFixture();
    hive.input.hiveRepairResult = tamperJson(hive.input.hiveRepairResult, (value) => { value.resultDigest = sha("f"); });
    expect(() => buildVisualRepairValidationFromArtifacts(hive.input)).toThrow("digest mismatch");

    const session = await repairFixture();
    session.input.hiveRepairSession = tamperJson(session.input.hiveRepairSession, (value) => { value.sessionDigest = sha("f"); });
    expect(() => buildVisualRepairValidationFromArtifacts(session.input)).toThrow("digest mismatch");

    const manifest = await repairFixture();
    manifest.input.after.manifest = tamperJson(manifest.input.after.manifest, (value) => { value.overallDigest = sha("f"); });
    expect(() => buildVisualRepairValidationFromArtifacts(manifest.input)).toThrow("publication digest");

    const report = await repairFixture();
    const reportPayload = report.input.after.payloads.find((item) => item.sourcePath === ".visual-hive/report.json")!;
    reportPayload.bytes = Buffer.concat([Buffer.from(reportPayload.bytes), Buffer.from(" ")]);
    expect(() => buildVisualRepairValidationFromArtifacts(report.input)).toThrow("file record");

    const context = await repairFixture();
    const contextPayload = context.input.after.payloads.find((item) => item.sourcePath === ".visual-hive/repair/run-context.json")!;
    contextPayload.bytes = Buffer.concat([Buffer.from(contextPayload.bytes), Buffer.from(" ")]);
    expect(() => buildVisualRepairValidationFromArtifacts(context.input)).toThrow("file record");

    const image = await repairFixture();
    const imagePayload = image.input.after.payloads.find((item) => item.sourcePath === ".visual-hive/results/card-actual.png")!;
    imagePayload.bytes = Buffer.from(imagePayload.bytes).fill(0, 0, 1);
    expect(() => buildVisualRepairValidationFromArtifacts(image.input)).toThrow("file record");
  });

  it("binds the task projection and actual browser runs to Hive authorization", async () => {
    const issue = await repairFixture({ sessionIssueExternalId: "fixture-other" });
    expect(() => buildVisualRepairValidationFromArtifacts(issue.input)).toThrow("issue projection");

    const image = await repairFixture({ sessionImageSha: sha("f") });
    expect(() => buildVisualRepairValidationFromArtifacts(image.input)).toThrow("image projection");

    const profile = await repairFixture({ runProfileId: "profile.alternate" });
    expect(() => buildVisualRepairValidationFromArtifacts(profile.input)).toThrow("Hive-brokered validation request");

    const producer = await repairFixture({ sessionVisualHiveVersion: "0.3.3" });
    expect(() => buildVisualRepairValidationFromArtifacts(producer.input)).toThrow("authorized Visual Hive release artifact");

    const expired = await repairFixture({ authorizationExpiresAt: "2026-07-14T12:01:30.000Z" });
    expect(() => buildVisualRepairValidationFromArtifacts(expired.input)).toThrow("authorization window");

    const substitutedRun = await repairFixture({ beforeUsesPatchRequest: true });
    expect(() => buildVisualRepairValidationFromArtifacts(substitutedRun.input)).toThrow("Hive-brokered validation request");

    const prematureBrokerRun = await repairFixture({
      requestRequestedAt: "2026-07-14T12:00:30.000Z",
      sessionUpdatedAt: "2026-07-14T12:00:30.000Z",
      resultGeneratedAt: "2026-07-14T12:00:31.000Z"
    });
    expect(() => buildVisualRepairValidationFromArtifacts(prematureBrokerRun.input)).toThrow("broker-request journal entry");

    const prematureAfterRun = await repairFixture({ resultGeneratedAt: "2026-07-14T12:02:30.000Z" });
    expect(() => buildVisualRepairValidationFromArtifacts(prematureAfterRun.input)).toThrow("predates the immutable Hive repair result");
  });

  it("blocks missing evidence and fails a still-present finding without trusting model claims", async () => {
    const missingAfter = await repairFixture({ afterFinding: "missing" });
    const missingReceipt = buildVisualRepairValidationFromArtifacts(missingAfter.input);
    expect(missingReceipt.findingStatus).toBe("not_evaluated");
    expect(missingReceipt.verdict).toBe("blocked");

    const missingBefore = await repairFixture({ beforeFinding: "missing" });
    const missingBeforeReceipt = buildVisualRepairValidationFromArtifacts(missingBefore.input);
    expect(missingBeforeReceipt.findingBeforeStatus).toBe("not_evaluated");
    expect(missingBeforeReceipt.verdict).toBe("blocked");

    const stillPresent = await repairFixture({ afterFinding: "present" });
    const failedReceipt = buildVisualRepairValidationFromArtifacts(stillPresent.input);
    expect(failedReceipt.findingStatus).toBe("present");
    expect(failedReceipt.verdict).toBe("fail");
    expect(failedReceipt.remainingFailures.length).toBeGreaterThan(0);
  });

  it("retains advisory run evidence without authorizing resolution or absence", async () => {
    const advisory = await repairFixture({ afterFinding: "present", afterAuthoritativeForResolution: false });
    const receipt = buildVisualRepairValidationFromArtifacts(advisory.input);
    expect(receipt.findingStatus).toBe("present");
    expect(receipt.authoritativeForResolution).toBe(false);
    expect(receipt.lanes.targeted.status).toBe("passed");
    expect(receipt.verdict).toBe("blocked");
    expect(receipt.closureRecommendation).toBe("keep_open");
  });

  it("binds obligation evidence to the exact contract, route, state, and viewport", async () => {
    const overbound = await repairFixture({ obligationRoute: "/unrelated" });
    expect(() => buildVisualRepairValidationFromArtifacts(overbound.input)).toThrow("obligation binding does not match");

    const unexecutable = await repairFixture({ obligationRoute: "/unrelated", evidenceObligationIds: [] });
    const receipt = buildVisualRepairValidationFromArtifacts(unexecutable.input);
    expect(receipt.obligations[0]).toMatchObject({ obligationId: "obligation.card", deterministic: true, status: "blocked" });
    expect(receipt.obligations[0]!.reason).toContain("contract, route, state, and viewport");
    expect(receipt.screenshotTriplets).toEqual([]);
    expect(receipt.lanes.targeted.status).toBe("blocked");
    expect(receipt.verdict).toBe("blocked");
  });

  it("blocks missing baselines and incomplete regression inventory, and fails a new deterministic regression", async () => {
    const missingBaseline = await repairFixture({ afterCardStatus: "missing_baseline" });
    const blockedBaseline = buildVisualRepairValidationFromArtifacts(missingBaseline.input);
    expect(blockedBaseline.lanes.targeted.status).toBe("blocked");
    expect(blockedBaseline.verdict).toBe("blocked");

    const missingRegression = await repairFixture({ omitAfterSecondaryResult: true });
    const blockedRegression = buildVisualRepairValidationFromArtifacts(missingRegression.input);
    expect(blockedRegression.lanes.targeted.status).toBe("passed");
    expect(blockedRegression.lanes.regression.status).toBe("blocked");
    expect(blockedRegression.verdict).toBe("blocked");

    const newRegression = await repairFixture({ failAfterSecondary: true });
    const failedRegression = buildVisualRepairValidationFromArtifacts(newRegression.input);
    expect(failedRegression.lanes.regression.status).toBe("failed");
    expect(failedRegression.newFailures).toHaveLength(1);
    expect(failedRegression.verdict).toBe("fail");
  });

  it("blocks config, policy, threshold, and baseline changes", async () => {
    const config = await repairFixture({ afterConfigDigest: sha("f") });
    const configReceipt = buildVisualRepairValidationFromArtifacts(config.input);
    expect(configReceipt.policyChanges.configChanged).toBe(true);
    expect(configReceipt.verdict).toBe("blocked");

    const policy = await repairFixture({ afterMaxDiffPixelRatio: 0.005 });
    const policyReceipt = buildVisualRepairValidationFromArtifacts(policy.input);
    expect(policyReceipt.policyChanges.validationPolicyChanged).toBe(true);
    expect(policyReceipt.verdict).toBe("blocked");

    const threshold = await repairFixture({ afterMaxDiffPixelRatio: 0.5 });
    const thresholdReceipt = buildVisualRepairValidationFromArtifacts(threshold.input);
    expect(thresholdReceipt.policyChanges.thresholdWeakened).toBe(true);
    expect(thresholdReceipt.verdict).toBe("blocked");

    const baseline = await repairFixture({ afterBaselineDigest: sha("f") });
    const baselineReceipt = buildVisualRepairValidationFromArtifacts(baseline.input);
    expect(baselineReceipt.policyChanges.baselineChanged).toBe(true);
    expect(baselineReceipt.verdict).toBe("blocked");
  });

  it("rejects cross-repository, stale-commit, report-summary, and screenshot-arithmetic drift", async () => {
    const repository = await repairFixture();
    repository.input.hiveRepairResult = tamperAndRedigestHive(repository.input.hiveRepairResult, (value) => { value.repository.name = "owner/other"; });
    expect(() => buildVisualRepairValidationFromArtifacts(repository.input)).toThrow(/repository.*identity/u);

    const stale = await repairFixture({ afterCommitSha: commit("c") });
    expect(() => buildVisualRepairValidationFromArtifacts(stale.input)).toThrow("commit mismatch");

    const summary = await repairFixture();
    await replaceBundledReport(summary, (value) => { value.summary.passed += 1; });
    expect(() => buildVisualRepairValidationFromArtifacts(summary.input)).toThrow("summary does not recompute");

    const arithmetic = await repairFixture();
    await replaceBundledReport(arithmetic, (value) => {
      value.results[0].screenshotAssertions[0].actualDiffPixelRatio = 0.5;
      value.results[0].screenshotAssertions[0].actualDiffPixels = 0;
    });
    expect(() => buildVisualRepairValidationFromArtifacts(arithmetic.input)).toThrow("direct baseline/actual pixel comparison");
  });

  it("rejects a capture status that contradicts the deterministic report", async () => {
    const contradiction = await repairFixture();
    await replaceBundledRunContext(contradiction, (value) => {
      value.capture = { status: "failed", failures: ["Contradictory synthetic failure"] };
      value.command.exitCode = 1;
    });
    expect(() => buildVisualRepairValidationFromArtifacts(contradiction.input)).toThrow("capture status does not match");
  });

  it("rejects top-level success when nested browser evidence contains a deterministic failure", async () => {
    const selector = await repairFixture();
    await replaceBundledReport(selector, (value) => {
      value.results[0].selectorAssertions = [{ kind: "mustExist", value: "[data-testid=card]", status: "failed", message: "Card is missing" }];
    });
    expect(() => buildVisualRepairValidationFromArtifacts(selector.input)).toThrow("reports success despite structured deterministic failures");

    const browser = await repairFixture();
    await replaceBundledReport(browser, (value) => {
      value.results[0].networkErrors = [{ type: "network", url: "https://fixture.invalid/api", status: 500, statusText: "Internal Server Error" }];
    });
    expect(() => buildVisualRepairValidationFromArtifacts(browser.input)).toThrow("reports success despite structured deterministic failures");
  });
});

interface FixtureOptions {
  beforeFinding?: "present" | "missing";
  afterFinding?: "absent" | "present" | "missing";
  afterCardStatus?: "passed" | "missing_baseline";
  omitAfterSecondaryResult?: boolean;
  failAfterSecondary?: boolean;
  afterConfigDigest?: string;
  afterBaselineDigest?: string;
  afterMaxDiffPixelRatio?: number;
  afterCommitSha?: string;
  runProfileId?: string;
  sessionIssueExternalId?: string;
  sessionVisualHiveVersion?: string;
  sessionImageSha?: string;
  authorizationExpiresAt?: string;
  beforeUsesPatchRequest?: boolean;
  requestRequestedAt?: string;
  sessionUpdatedAt?: string;
  resultGeneratedAt?: string;
  obligationRoute?: string;
  evidenceObligationIds?: string[];
  afterAuthoritativeForResolution?: boolean;
}

interface FixtureResult {
  input: BuildVisualRepairValidationArtifacts;
  roots: { before: string; after: string };
}

async function repairFixture(options: FixtureOptions = {}): Promise<FixtureResult> {
  const repository = "owner/repo";
  const repositoryId = "42";
  const repositoryFingerprint = computeVisualRepositoryFingerprint(repository, repositoryId);
  const baseSha = commit("a");
  const headSha = commit("b");
  const findingFingerprint = "visual-hive:fixture:card-layout";
  const findingRootCauseKey = "finding/visual_regression/card";
  const findingRepositoryFingerprint = visualHiveObservationRepositoryFingerprint(repository, findingFingerprint, "canonical", findingRootCauseKey);
  const beforePng = solidPng(255, 0, 0);
  const afterPng = solidPng(0, 255, 0);
  const afterExecutionPng = options.afterBaselineDigest ? solidPng(0, 0, 255) : afterPng;
  const profileBody = {
    profileId: "profile.repair",
    targetId: "target.app",
    requestKinds: ["reproduction", "capture", "patch_validation"] as Array<"reproduction" | "capture" | "patch_validation">,
    contractIds: ["contract.card", "contract.secondary"],
    routes: ["/"],
    scenarioIds: ["default"],
    viewports: [{ viewportId: "desktop", width: 2, height: 2, deviceScaleFactor: 1 }],
    validationCommandId: "command.playwright"
  };
  const alternateProfileBody = { ...profileBody, profileId: "profile.alternate", validationCommandId: "command.playwright.alternate" };
  const sourceFiles = [{ path: "src/App.tsx", sha256: sha("8"), size: 200, classification: "source" as const }];
  const task = buildVisualHiveTaskContext({
    schemaVersion: "visual-hive.task-context.v1",
    digestAlgorithm: "visual-hive.canonical-json.sha256.v1",
    generatedAt: "2026-07-14T11:00:00.000Z",
    taskId: "task.card-layout",
    repository: { name: repository, repositoryId, repositoryFingerprint, baseSha },
    issue: {
      source: "fixture", externalId: "fixture-1", problemStatement: "Repair the card screenshot without changing visual policy.",
      problemStatementSha256: sha256Utf8("Repair the card screenshot without changing visual policy.")
    },
    assets: [{
      assetId: "asset.reference", role: "reference", path: "task/reference.png", mediaType: "image/png", sha256: sha256Bytes(afterPng),
      size: afterPng.byteLength, width: 2, height: 2, provenance: { kind: "fixture", sourceId: "fixture:reference" }, regions: []
    }],
    imageReferences: [{ position: 0, assetId: "asset.reference", role: "reference" }],
    graphCandidates: [{ nodeId: "component.card", kind: "component", label: "Card", score: 1, reasons: ["Screenshot obligation"], sourceSpans: [{ path: "src/App.tsx", startLine: 1, endLine: 20 }] }],
    profiles: [
      { ...profileBody, profileDigest: computeVisualValidationProfileDigest(profileBody) },
      { ...alternateProfileBody, profileDigest: computeVisualValidationProfileDigest(alternateProfileBody) }
    ],
    obligations: [{
      obligationId: "obligation.card", description: "Card rendering matches the reference.", sourceAssetIds: ["asset.reference"], mappedContractIds: ["contract.card"],
      route: options.obligationRoute ?? "/", state: "default", viewportId: "desktop", assertionKind: "pixel_region", authority: "deterministic", confidence: 1, status: "mapped"
    }],
    sourceContext: { digest: canonicalSha256({ files: sourceFiles, omittedPaths: 0, truncated: false }), files: sourceFiles, omittedPaths: 0, truncated: false }
  });
  const repairProfile = task.profiles.find((profile) => profile.profileId === "profile.repair")!;
  const findingIdentity = {
    fingerprint: findingFingerprint,
    repositoryFingerprint: findingRepositoryFingerprint,
    publicationRole: "canonical" as const,
    rootCauseKey: findingRootCauseKey,
    recurrenceKey: "recurrence/visual_regression/card"
  };
  const limits = {
    maxTurns: 8, maxToolCalls: 8, maxInputBytes: 1_000_000, maxImageBytes: 1_000_000,
    maxModelInputTokens: 20_000, maxModelOutputTokens: 10_000, maxProviderCostUsdMicros: 5_000_000,
    maxWallSeconds: 1800, maxRepairAttempts: 2
  };
  const provider = { providerId: "provider.fixture", providerKind: "fixture", model: "fixture-model", executableIdentityDigest: sha("6"), capabilityDigest: sha("7"), modelConfigurationDigest: sha("5") };
  const providerIdentityDigest = computeHiveRepairProviderIdentityDigest(provider);
  const sessionIdentity = {
    repository: { name: repository, repositoryId, repositoryFingerprint, baseSha, baseTreeSha: commit("d") },
    finding: findingIdentity,
    task: {
      taskId: task.taskId,
      taskContextDigest: task.contextDigest,
      issueSource: "fixture" as const,
      issueExternalId: options.sessionIssueExternalId ?? "fixture-1",
      problemStatementDigest: task.issue.problemStatementSha256,
      imageAttachments: task.imageReferences.map((reference) => {
        const asset = task.assets.find((candidate) => candidate.assetId === reference.assetId)!;
        return {
          position: reference.position,
          assetId: asset.assetId,
          role: reference.role as "reference",
          sha256: options.sessionImageSha ?? asset.sha256,
          mediaType: asset.mediaType,
          size: asset.size
        };
      })
    }
  };
  const sessionId = computeHiveRepairSessionId(sessionIdentity as any);
  const promptDigest = sha("5");
  const attemptId = computeHiveRepairAttemptId(sessionId, 0, promptDigest);
  const authorization = buildHiveExecutionAuthorization({
    authorizationId: "authorization.fixture",
    issuedAt: "2026-07-14T11:00:00.000Z",
    expiresAt: options.authorizationExpiresAt ?? "2026-07-14T13:00:00.000Z",
    repositoryFingerprint,
    taskContextDigest: task.contextDigest,
    baseSha,
    profile: repairProfile,
    toolNames: [...VISUAL_REPAIR_TOOL_NAMES],
    assetIds: task.assets.map((asset) => asset.assetId),
    budgetDigest: canonicalSha256(limits),
    configDigest: sha("a"),
    toolRegistryDigest: sha("b"),
    promptSchemaDigest: sha("c"),
    visualHiveManifestSha256: releaseManifestSha256,
    visualHiveEntrypointSha256: releaseEntrypointSha256
  });
  const toolTurnInput = { attemptId, ordinal: 0, providerInputDigest: sha("4"), consumedToolOutcomeDigests: [] as string[] };
  const toolTurnDraft = { ...toolTurnInput, inputDigest: computeHiveRepairTurnInputDigest(sessionId, toolTurnInput) };
  const toolTurnId = computeHiveRepairTurnId(sessionId, toolTurnDraft);
  const toolReceiptDraft = { turnId: toolTurnId, sequence: 0, toolName: "visual_hive_get_task_context" as const, argumentsDigest: sha("3") };
  const toolCallId = computeHiveRepairToolCallId(sessionId, toolReceiptDraft);
  const toolReceiptContent = { ...toolReceiptDraft, callId: toolCallId, resultDigest: task.contextDigest, status: "passed" as const, startedAt: "2026-07-14T11:12:00.000Z", completedAt: "2026-07-14T11:13:00.000Z", textBytes: 256, imageBytes: 128 };
  const toolReceipt = { ...toolReceiptContent, outcomeDigest: computeHiveRepairToolOutcomeDigest(toolReceiptContent) };
  const finalTurnInput = { attemptId, ordinal: 1, providerInputDigest: sha("2"), previousTurnOutputDigest: sha("8"), consumedToolOutcomeDigests: [toolReceipt.outcomeDigest] };
  const finalTurnDraft = { ...finalTurnInput, inputDigest: computeHiveRepairTurnInputDigest(sessionId, finalTurnInput) };
  const finalTurnId = computeHiveRepairTurnId(sessionId, finalTurnDraft);
  const reproductionRequest = buildHiveRepairValidationRequestSpec({
    sessionId,
    attemptId,
    kind: "reproduction",
    commitRole: "base",
    profileId: repairProfile.profileId,
    profileDigest: repairProfile.profileDigest,
    commitSha: baseSha,
    authorizationDigest: authorization.authorizationDigest
  });
  const patchValidationRequest = buildHiveRepairValidationRequestSpec({
    sessionId,
    attemptId,
    kind: "patch_validation",
    commitRole: "candidate",
    profileId: repairProfile.profileId,
    profileDigest: repairProfile.profileDigest,
    commitSha: headSha,
    authorizationDigest: authorization.authorizationDigest
  });
  const { authorizationDigest: _authorizationDigest, ...authorizationInput } = authorization;
  void _authorizationDigest;
  const hiveSession = buildHiveRepairSession({
    schemaVersion: "hive.repair-session.v1",
    digestAlgorithm: "hive.canonical-json.sha256.v1",
    createdAt: "2026-07-14T11:00:00.000Z",
    updatedAt: options.sessionUpdatedAt ?? "2026-07-14T11:50:00.000Z",
    deadlineAt: "2026-07-14T12:30:00.000Z",
    requestedMode: "on",
    effectiveMode: "visual_hive",
    state: "awaiting_validation",
    ...sessionIdentity,
    capability: {
      selectionReasons: ["Fixture has a visual task asset."],
      visualHiveVersion: options.sessionVisualHiveVersion ?? "0.3.2",
      visualHiveCommit: commit("c"),
      visualHiveManifestSha256: releaseManifestSha256,
      visualHiveEntrypointSha256: releaseEntrypointSha256,
      toolProtocolDigest: sha("b"),
      validationToolRegistryDigest: canonicalSha256("tools-v1")
    },
    sourceContext: {
      digest: task.sourceContext.digest,
      maxBytes: 4096,
      totalBytes: task.sourceContext.files.reduce((total, file) => total + file.size, 0),
      files: task.sourceContext.files,
      omittedPaths: task.sourceContext.omittedPaths,
      truncated: task.sourceContext.truncated
    },
    validationProfiles: task.profiles,
    promptIdentities: { systemPromptDigest: sha("1"), repairPromptDigest: sha("2"), toolSchemaDigest: sha("3"), taskSchemaDigest: sha("4"), modelConfigurationDigest: sha("5") },
    executionIdentities: { configDigest: sha("a"), toolRegistryDigest: sha("b"), promptSchemaDigest: sha("c") },
    provider,
    budgets: {
      limits,
      usage: { turnsConsumed: 2, toolCallsConsumed: 1, inputBytesConsumed: 1024, imageBytesConsumed: 128, modelInputTokensConsumed: 1000, modelOutputTokensConsumed: 500, providerCostUsdMicrosConsumed: 100_000, wallMillisecondsConsumed: 720_000 }
    },
    attempts: [{ attemptId, ordinal: 0, state: "candidate", startedAt: "2026-07-14T11:05:00.000Z", completedAt: "2026-07-14T11:45:00.000Z", promptDigest, turnIds: [toolTurnId, finalTurnId], candidatePatchDigest: sha("7"), candidateHeadSha: headSha, candidateHeadTreeSha: commit("e"), validationRequestIds: [reproductionRequest.requestId, patchValidationRequest.requestId] }],
    turns: [
      { ...toolTurnDraft, turnId: toolTurnId, state: "completed", startedAt: "2026-07-14T11:10:00.000Z", completedAt: "2026-07-14T11:11:00.000Z", providerIdentityDigest, usage: { inputBytes: 500, imageBytes: 0, modelInputTokens: 500, modelOutputTokens: 100, providerCostUsdMicros: 50_000, wallMilliseconds: 60_000 }, providerReceiptDigest: sha("a"), outputKind: "tool_request", outputDigest: sha("8"), toolCallId },
      { ...finalTurnDraft, turnId: finalTurnId, state: "completed", startedAt: "2026-07-14T11:30:00.000Z", completedAt: "2026-07-14T11:40:00.000Z", providerIdentityDigest, usage: { inputBytes: 524, imageBytes: 128, modelInputTokens: 500, modelOutputTokens: 400, providerCostUsdMicros: 50_000, wallMilliseconds: 600_000 }, providerReceiptDigest: sha("b"), outputKind: "final_result", outputDigest: sha("9") }
    ],
    toolReceipts: [toolReceipt],
    validationRequests: [
      { ...reproductionRequest, state: "requested", requestedAt: options.requestRequestedAt ?? "2026-07-14T11:46:00.000Z" },
      { ...patchValidationRequest, state: "requested", requestedAt: options.requestRequestedAt ?? "2026-07-14T11:46:00.000Z" }
    ],
    authorization: authorizationInput
  });
  const hiveResult = buildHiveRepairResult({
    schemaVersion: "hive.repair-result.v1",
    digestAlgorithm: "hive.canonical-json.sha256.v1",
    generatedAt: options.resultGeneratedAt ?? "2026-07-14T11:51:00.000Z",
    sessionId: hiveSession.sessionId,
    sessionDigest: hiveSession.sessionDigest,
    transcriptDigest: hiveSession.transcriptDigest,
    effectiveMode: "visual_hive",
    taskId: task.taskId,
    taskContextDigest: task.contextDigest,
    repository: { name: repository, repositoryId, repositoryFingerprint },
    finding: findingIdentity,
    baseSha,
    baseTreeSha: commit("d"),
    headSha,
    headTreeSha: commit("e"),
    diff: { algorithm: "git.diff.binary.sha256.v1", sha256: sha("7"), changedFiles: [{ path: "src/App.tsx", status: "modified", beforeSha256: sha("5"), afterSha256: sha("6"), beforeMode: "100644", afterMode: "100644" }] },
    provider: hiveSession.provider,
    attempts: [{ attemptId, ordinal: 0, state: "candidate", promptDigest, startedAt: "2026-07-14T11:05:00.000Z", completedAt: "2026-07-14T11:45:00.000Z", turnCount: 2, toolCallCount: 1 }],
    toolReceipts: hiveSession.toolReceipts,
    authorizationDigest: authorization.authorizationDigest,
    validationRequests: [reproductionRequest, patchValidationRequest],
    claimedOutcome: { summary: "Updated the card layout and preserved regression coverage.", advisory: true },
    status: "candidate"
  });

  const beforeRoot = await makeRoot("before");
  const afterRoot = await makeRoot("after");
  const before = await makeRun({
    root: beforeRoot, phase: "before", commitSha: baseSha, task, repository, repositoryId, repositoryFingerprint, findingFingerprint,
    image: beforePng, baseline: afterPng, imageId: "asset.before.actual", report: report("before", repository, baseSha, "failed", "failed", false, false),
    finding: options.beforeFinding === "missing" ? undefined : "present", findingRepositoryFingerprint, configDigest: sha("1"), maxDiffPixelRatio: 0.01, profileId: options.runProfileId,
    brokerRequest: options.beforeUsesPatchRequest ? patchValidationRequest : reproductionRequest,
    evidenceObligationIds: options.evidenceObligationIds
  });
  const afterCommitSha = options.afterCommitSha ?? headSha;
  const afterReport = report(
    "after",
    repository,
    afterCommitSha,
    options.afterCardStatus === "missing_baseline" ? "failed" : "passed",
    options.afterCardStatus === "missing_baseline" ? "failed" : "passed",
    Boolean(options.omitAfterSecondaryResult),
    Boolean(options.failAfterSecondary),
    options.afterCardStatus,
    options.afterMaxDiffPixelRatio ?? 0.01
  );
  const after = await makeRun({
    root: afterRoot, phase: "after", commitSha: afterCommitSha, task, repository, repositoryId, repositoryFingerprint, findingFingerprint,
    image: afterExecutionPng, baseline: afterExecutionPng, imageId: "asset.after.actual", report: afterReport,
    finding: options.afterFinding === "missing" ? undefined : (options.afterFinding ?? "absent"),
    findingRepositoryFingerprint,
    configDigest: options.afterConfigDigest ?? sha("1"),
    maxDiffPixelRatio: options.afterMaxDiffPixelRatio ?? 0.01, profileId: options.runProfileId,
    brokerRequest: patchValidationRequest,
    evidenceObligationIds: options.evidenceObligationIds,
    authoritativeForResolution: options.afterAuthoritativeForResolution
  });

  return {
    input: {
      validationId: "validation.card",
      generatedAt: "2026-07-14T12:10:00.000Z",
      taskContext: jsonArtifact(".visual-hive/repair/task-context.json", task),
      hiveRepairSession: jsonArtifact(".hive/repair-session.json", hiveSession),
      hiveRepairResult: jsonArtifact(".hive/repair-result.json", hiveResult),
      before,
      after
    },
    roots: { before: beforeRoot, after: afterRoot }
  };
}

function report(
  phase: "before" | "after",
  repository: string,
  commitSha: string,
  reportStatus: "passed" | "failed",
  cardStatus: "passed" | "failed",
  omitSecondary: boolean,
  failSecondary: boolean,
  screenshotStatus: "passed" | "missing_baseline" = cardStatus === "passed" ? "passed" : "failed",
  maxDiffPixelRatio = 0.01
): Record<string, any> {
  const screenshotEvidence = screenshotStatus === "missing_baseline"
    ? { actualDiffPixelRatio: 1, actualDiffPixels: 4, diffPixels: 4 }
    : screenshotStatus === "failed"
      ? { diffPath: ".visual-hive/results/card-diff.png", actualDiffPixelRatio: 1, actualDiffPixels: 4, diffPixels: 4 }
      : { actualDiffPixelRatio: 0, actualDiffPixels: 0, diffPixels: 0 };
  const card = {
    contractId: "contract.card",
    targetId: "target.app",
    status: cardStatus,
    durationMs: 100,
    errors: cardStatus === "failed" ? [screenshotStatus === "missing_baseline" ? "Missing screenshot baseline" : "Card screenshot differs"] : [],
    artifacts: [`.visual-hive/results/card-actual.png`],
    screenshotAssertions: [{
      contractId: "contract.card", screenshotName: "card", name: "card", route: "/", viewport: "desktop", status: screenshotStatus,
      baselinePath: ".visual-hive/baselines/card.png", actualPath: ".visual-hive/results/card-actual.png",
      ...screenshotEvidence,
      maxDiffPixelRatio, totalPixels: 4,
      ...(screenshotStatus === "missing_baseline" ? { message: "Missing screenshot baseline" } : {})
    }]
  };
  const secondary = {
    contractId: "contract.secondary",
    targetId: "target.app",
    status: failSecondary ? "failed" : "passed",
    durationMs: 50,
    errors: failSecondary ? ["Secondary panel regressed"] : [],
    artifacts: [],
    ...(failSecondary ? { selectorAssertions: [{ kind: "mustExist", value: "secondary-panel", status: "failed", message: "Panel missing" }] } : {})
  };
  const results = omitSecondary ? [card] : [card, secondary];
  const screenshots = results.flatMap((item) => item.screenshotAssertions ?? []);
  const effectiveStatus = results.some((item) => item.status === "failed") ? "failed" : reportStatus;
  return {
    schemaVersion: 2,
    project: "fixture",
    repository: { provider: "local", repository, commitSha },
    mode: "full",
    generatedAt: phase === "before" ? "2026-07-14T12:01:00.000Z" : "2026-07-14T12:03:00.000Z",
    status: effectiveStatus,
    changedFiles: [],
    selectedTargets: [{ id: "target.app", kind: "command", url: "http://127.0.0.1:4173", prSafe: true, cost: "cheap" }],
    selectedContracts: ["contract.card", "contract.secondary"],
    excludedContracts: [],
    targetLifecycle: [],
    generatedSpecPath: ".visual-hive/generated.spec.ts",
    executionBinding,
    results,
    summary: {
      passed: results.filter((item) => item.status === "passed" || item.status === "created").length,
      failed: results.filter((item) => item.status === "failed").length,
      screenshotsPassed: screenshots.filter((item) => item.status === "passed" || item.status === "created").length,
      screenshotsFailed: screenshots.filter((item) => item.status === "failed" || item.status === "missing_baseline").length,
      baselinesCreated: screenshots.filter((item) => item.status === "created").length,
      createdBaselines: screenshots.filter((item) => item.status === "created").length,
      missingBaselines: screenshots.filter((item) => item.status === "missing_baseline").length,
      visualDiffs: screenshots.filter((item) => item.status === "failed").length,
      consoleErrors: 0,
      pageErrors: 0,
      flowStepsPassed: 0,
      flowStepsFailed: 0
    },
    consoleErrors: [],
    pageErrors: [],
    artifacts: [".visual-hive/results/card-actual.png"],
    reproductionCommands: ["visual-hive run"]
  };
}

interface MakeRunInput {
  root: string;
  phase: "before" | "after";
  commitSha: string;
  task: ReturnType<typeof buildVisualHiveTaskContext>;
  repository: string;
  repositoryId: string;
  repositoryFingerprint: string;
  findingFingerprint: string;
  image: Buffer;
  baseline: Buffer;
  imageId: string;
  report: Record<string, any>;
  finding?: "present" | "absent";
  findingRepositoryFingerprint: string;
  configDigest: string;
  maxDiffPixelRatio: number;
  profileId?: string;
  brokerRequest: { requestId: string; requestDigest: string };
  evidenceObligationIds?: string[];
  authoritativeForResolution?: boolean;
}

async function makeRun(input: MakeRunInput): Promise<BuildVisualRepairValidationArtifacts["before"]> {
  const reportPath = ".visual-hive/report.json";
  const runContextPath = ".visual-hive/repair/run-context.json";
  const imagePath = ".visual-hive/results/card-actual.png";
  const baselinePath = ".visual-hive/baselines/card.png";
  const diffPath = ".visual-hive/results/card-diff.png";
  const screenshot = input.report.results[0].screenshotAssertions[0];
  const missingBaseline = screenshot.status === "missing_baseline";
  const comparison = compareVisualPngBytes(input.baseline, input.image);
  const reportBytes = jsonBytes(input.report);
  await writeArtifact(input.root, reportPath, reportBytes);
  await writeArtifact(input.root, imagePath, input.image);
  if (!missingBaseline) await writeArtifact(input.root, baselinePath, input.baseline);
  if (!missingBaseline && comparison.diffPixels > 0) await writeArtifact(input.root, diffPath, comparison.diffPng);
  const cases = [{
    caseId: "case.full",
    targetId: "target.app",
    route: "/",
    state: "default",
    viewport: { viewportId: "desktop", width: 2, height: 2, deviceScaleFactor: 1 },
    contractIds: ["contract.card", "contract.secondary"]
  }];
  const thresholds = [
    { contractId: "contract.card", maxDiffPixelRatio: input.maxDiffPixelRatio, missingBaseline: "fail" as const },
    { contractId: "contract.secondary", maxDiffPixelRatio: 0, missingBaseline: "fail" as const }
  ];
  const runProfile = input.task.profiles.find((profile) => profile.profileId === (input.profileId ?? "profile.repair"))!;
  const captureStatus = missingBaseline ? "blocked" : input.report.status === "failed" ? "failed" : "passed";
  const captureFailures = captureStatus === "passed"
    ? []
    : input.report.results.flatMap((result: any) => result.errors).length > 0
      ? input.report.results.flatMap((result: any) => result.errors)
      : [`Fixture capture ${captureStatus}.`];
  const runContext = buildVisualRunContext({
    schemaVersion: "visual-hive.run-context.v1",
    digestAlgorithm: "visual-hive.canonical-json.sha256.v1",
    generatedAt: input.phase === "before" ? "2026-07-14T12:01:00.000Z" : "2026-07-14T12:03:00.000Z",
    runId: input.phase === "before" ? "run.before" : "run.after",
    phase: input.phase,
    taskId: input.task.taskId,
    taskContextDigest: input.task.contextDigest,
    findingFingerprint: input.findingFingerprint,
    repository: { name: input.repository, repositoryId: input.repositoryId, repositoryFingerprint: input.repositoryFingerprint, commitSha: input.commitSha },
    brokerRequest: { requestId: input.brokerRequest.requestId, requestDigest: input.brokerRequest.requestDigest },
    execution: {
      commitSha: input.commitSha,
      profileId: runProfile.profileId,
      profileDigest: runProfile.profileDigest,
      configDigest: input.configDigest,
      validationPolicyDigest: computeVisualValidationPolicyDigest(runProfile.validationCommandId, thresholds),
      contractInventoryDigest: canonicalSha256(["contract.card", "contract.secondary"]),
      planDigest: sha("a"),
      testPlanDigest: canonicalSha256("plan-v1"),
      toolRegistryDigest: canonicalSha256("tools-v1"),
      baselineIdentityDigest: canonicalSha256([missingBaseline
        ? { path: baselinePath, sha256: null, size: null }
        : { path: baselinePath, sha256: sha256Bytes(input.baseline), size: input.baseline.byteLength }]),
      executionMatrixDigest: canonicalSha256(cases),
      browser: { name: "chromium", version: "130.0" },
      environment: {
        os: "windows", architecture: "x64", nodeVersion: "22.13.1", playwrightVersion: "1.54.1",
        fontManifestDigest: sha("d"), locale: "en-US", timezone: "UTC"
      },
      cases
    },
    producer: {
      visualHiveVersion: "0.3.2",
      visualHiveCommit: commit("c"),
      manifestSha256: releaseManifestSha256,
      entrypointSha256: releaseEntrypointSha256,
      playwrightVersion: "1.54.1"
    },
    command: {
      validationCommandId: runProfile.validationCommandId,
      startedAt: input.phase === "before" ? "2026-07-14T12:00:00.000Z" : "2026-07-14T12:02:00.000Z",
      completedAt: input.phase === "before" ? "2026-07-14T12:01:00.000Z" : "2026-07-14T12:03:00.000Z",
      exitCode: captureStatus === "passed" ? 0 : 1,
      executionBinding
    },
    report: { path: reportPath, sha256: sha256Bytes(reportBytes) },
    evidenceAssets: [{
      assetId: input.imageId,
      role: "actual",
      path: imagePath,
      mediaType: "image/png",
      sha256: sha256Bytes(input.image),
      size: input.image.byteLength,
      width: 2,
      height: 2,
      assertion: { contractId: "contract.card", screenshotName: "card", route: "/", state: "default", viewportId: "desktop" },
      obligationIds: input.evidenceObligationIds ?? ["obligation.card"]
    }, ...(!missingBaseline ? [{
      assetId: `asset.${input.phase}.baseline`,
      role: "baseline" as const,
      path: baselinePath,
      mediaType: "image/png" as const,
      sha256: sha256Bytes(input.baseline),
      size: input.baseline.byteLength,
      width: 2,
      height: 2,
      assertion: { contractId: "contract.card", screenshotName: "card", route: "/", state: "default", viewportId: "desktop" },
      obligationIds: input.evidenceObligationIds ?? ["obligation.card"]
    }] : []), ...(!missingBaseline && comparison.diffPixels > 0 ? [{
      assetId: `asset.${input.phase}.diff`,
      role: "diff" as const,
      path: diffPath,
      mediaType: "image/png" as const,
      sha256: sha256Bytes(comparison.diffPng),
      size: comparison.diffPng.byteLength,
      width: 2,
      height: 2,
      assertion: { contractId: "contract.card", screenshotName: "card", route: "/", state: "default", viewportId: "desktop" },
      obligationIds: input.evidenceObligationIds ?? ["obligation.card"]
    }] : [])],
    thresholds,
    capture: { status: captureStatus, failures: captureFailures }
  });
  const runContextBytes = jsonBytes(runContext);
  await writeArtifact(input.root, runContextPath, runContextBytes);
  const observations = input.finding
    ? [observation(input.findingFingerprint, input.findingRepositoryFingerprint, captureStatus === "blocked" ? "present" : input.finding)]
    : [];
  const payloads = [
    { sourcePath: reportPath, bytes: reportBytes },
    { sourcePath: runContextPath, bytes: runContextBytes },
    { sourcePath: imagePath, bytes: input.image },
    ...(!missingBaseline ? [{ sourcePath: baselinePath, bytes: input.baseline }] : []),
    ...(!missingBaseline && comparison.diffPixels > 0 ? [{ sourcePath: diffPath, bytes: comparison.diffPng }] : [])
  ];
  const bundle = await writeVisualHiveBundle({
    rootDir: input.root,
    project: "fixture",
    mode: "full",
    verdict: input.report.status,
    acmmRequest: 3,
    artifacts: payloads.map((payload) => payload.sourcePath),
    source: { repository: input.repository, repositoryId: input.repositoryId, ref: "main", commitSha: input.commitSha, event: "local", conclusion: input.report.status, trusted: false },
    scan: { scope: "full", authoritativeForResolution: input.authoritativeForResolution ?? (captureStatus !== "blocked"), evaluatedContracts: ["contract.card", "contract.secondary"], evaluatedFiles: ["src/App.tsx"], testPlanVersion: "plan-v1", toolRegistryVersion: "tools-v1" },
    observations,
    producerVersion: "0.3.2",
    producerGitCommit: commit("c"),
    bundleId: input.phase === "before" ? "bundle.before" : "bundle.after",
    now: new Date(input.phase === "before" ? "2026-07-14T12:01:30.000Z" : "2026-07-14T12:03:30.000Z")
  });
  return {
    manifest: jsonArtifact("manifest.json", bundle.manifest),
    runContextPath,
    payloads
  };
}

function observation(fingerprint: string, repositoryFingerprint: string, state: "present" | "absent"): VisualHiveBundleObservation {
  return {
    fingerprint,
    repositoryFingerprint,
    publicationRole: "canonical",
    rootCauseKey: "finding/visual_regression/card",
    blockedByRootKeys: [],
    state,
    issueKind: "visual_regression",
    severity: "high",
    owningAgentHint: "hive/quality",
    title: "Card screenshot regression",
    body: "The card rendering differs from its deterministic expectation.",
    labels: ["visual-hive"],
    sourceArtifacts: [".visual-hive/report.json"],
    affectedContracts: ["contract.card"],
    validationCommand: "visual-hive run",
    observedAt: "2026-07-14T12:00:00.000Z",
    firstSeenAt: "2026-07-14T12:00:00.000Z",
    sourceArtifact: ".visual-hive/report.json"
  };
}

async function replaceBundledReport(fixture: FixtureResult, mutate: (value: any) => void): Promise<void> {
  const payload = fixture.input.after.payloads.find((item) => item.sourcePath === ".visual-hive/report.json")!;
  const report = JSON.parse(Buffer.from(payload.bytes).toString("utf8"));
  mutate(report);
  const reportBytes = jsonBytes(report);
  const contextPayload = fixture.input.after.payloads.find((item) => item.sourcePath === ".visual-hive/repair/run-context.json")!;
  const context = JSON.parse(Buffer.from(contextPayload.bytes).toString("utf8"));
  context.report.sha256 = sha256Bytes(reportBytes);
  const { runContextDigest: _digest, ...contextContent } = context;
  void _digest;
  context.runContextDigest = canonicalSha256(contextContent);
  const contextBytes = jsonBytes(context);
  const root = fixture.roots.after;
  await writeArtifact(root, ".visual-hive/report.json", reportBytes);
  await writeArtifact(root, ".visual-hive/repair/run-context.json", contextBytes);
  const payloads = fixture.input.after.payloads.map((payload) => {
    if (payload.sourcePath === ".visual-hive/report.json") return { sourcePath: payload.sourcePath, bytes: reportBytes };
    if (payload.sourcePath === ".visual-hive/repair/run-context.json") return { sourcePath: payload.sourcePath, bytes: contextBytes };
    return payload;
  });
  const manifestValue = JSON.parse(Buffer.from(fixture.input.after.manifest.bytes).toString("utf8"));
  await rm(path.join(root, ".visual-hive", "bundles", manifestValue.bundleId), { recursive: true, force: true });
  const rebuilt = await writeVisualHiveBundle({
    rootDir: root, project: "fixture", mode: "full", verdict: report.status, acmmRequest: 3,
    artifacts: payloads.map((payload) => payload.sourcePath),
    source: manifestValue.source, scan: manifestValue.scan, observations: manifestValue.observations,
    producerVersion: "0.3.2", producerGitCommit: commit("c"), bundleId: manifestValue.bundleId, now: new Date(manifestValue.generatedAt)
  });
  fixture.input.after.manifest = jsonArtifact("manifest.json", rebuilt.manifest);
  fixture.input.after.payloads = payloads;
}

async function replaceBundledRunContext(fixture: FixtureResult, mutate: (value: any) => void): Promise<void> {
  const contextPayload = fixture.input.after.payloads.find((item) => item.sourcePath === ".visual-hive/repair/run-context.json")!;
  const context = JSON.parse(Buffer.from(contextPayload.bytes).toString("utf8"));
  mutate(context);
  const { runContextDigest: _digest, ...contextContent } = context;
  void _digest;
  context.runContextDigest = canonicalSha256(contextContent);
  const contextBytes = jsonBytes(context);
  const payloads = fixture.input.after.payloads.map((payload) => payload.sourcePath === ".visual-hive/repair/run-context.json"
    ? { sourcePath: payload.sourcePath, bytes: contextBytes }
    : payload);
  const manifestValue = JSON.parse(Buffer.from(fixture.input.after.manifest.bytes).toString("utf8"));
  const root = fixture.roots.after;
  await writeArtifact(root, ".visual-hive/repair/run-context.json", contextBytes);
  await rm(path.join(root, ".visual-hive", "bundles", manifestValue.bundleId), { recursive: true, force: true });
  const rebuilt = await writeVisualHiveBundle({
    rootDir: root,
    project: "fixture",
    mode: "full",
    verdict: manifestValue.verdict,
    acmmRequest: 3,
    artifacts: payloads.map((payload) => payload.sourcePath),
    source: manifestValue.source,
    scan: manifestValue.scan,
    observations: manifestValue.observations,
    producerVersion: "0.3.2",
    producerGitCommit: commit("c"),
    bundleId: manifestValue.bundleId,
    now: new Date(manifestValue.generatedAt)
  });
  fixture.input.after.manifest = jsonArtifact("manifest.json", rebuilt.manifest);
  fixture.input.after.payloads = payloads;
}

function tamperAndRedigestHive(artifact: RawRepairArtifact, mutate: (value: any) => void): RawRepairArtifact {
  const value = JSON.parse(Buffer.from(artifact.bytes).toString("utf8"));
  mutate(value);
  const { resultDigest: _digest, ...content } = value;
  void _digest;
  value.resultDigest = canonicalSha256(content);
  return jsonArtifact(artifact.sourcePath, value);
}

function tamperJson(artifact: RawRepairArtifact, mutate: (value: any) => void): RawRepairArtifact {
  const value = JSON.parse(Buffer.from(artifact.bytes).toString("utf8"));
  mutate(value);
  return jsonArtifact(artifact.sourcePath, value);
}

function solidPng(red: number, green: number, blue: number): Buffer {
  const image = new PNG({ width: 2, height: 2 });
  for (let index = 0; index < image.data.length; index += 4) {
    image.data[index] = red;
    image.data[index + 1] = green;
    image.data[index + 2] = blue;
    image.data[index + 3] = 255;
  }
  return PNG.sync.write(image);
}

async function makeRoot(label: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), `visual-hive-receipt-${label}-`));
  temporaryRoots.push(root);
  return root;
}

async function writeArtifact(root: string, sourcePath: string, bytes: Uint8Array): Promise<void> {
  const destination = path.join(root, ...sourcePath.split("/"));
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, bytes);
}

function jsonArtifact(sourcePath: string, value: unknown): RawRepairArtifact {
  return { sourcePath, bytes: jsonBytes(value) };
}

function jsonBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}
