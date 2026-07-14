import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PNG } from "pngjs";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildVisualHiveTaskContext,
  buildVisualRepairValidationFromArtifacts,
  buildVisualRunContext,
  canonicalSha256,
  computeVisualRepositoryFingerprint,
  computeVisualValidationPolicyDigest,
  computeVisualValidationProfileDigest,
  sha256Bytes,
  sha256Utf8,
  visualHiveObservationRepositoryFingerprint,
  writeVisualHiveBundle,
  type BuildVisualRepairValidationArtifacts,
  type RawRepairArtifact,
  type VisualHiveBundleObservation
} from "../src/index.js";

const temporaryRoots: string[] = [];
const sha = (character: string): string => character.repeat(64);
const commit = (character: string): string => character.repeat(40);

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

  it("allows a non-policy config repair but blocks policy, threshold, and baseline weakening", async () => {
    const config = await repairFixture({ afterConfigDigest: sha("f") });
    const configReceipt = buildVisualRepairValidationFromArtifacts(config.input);
    expect(configReceipt.policyChanges.configChanged).toBe(true);
    expect(configReceipt.verdict).toBe("pass");

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
    expect(() => buildVisualRepairValidationFromArtifacts(repository.input)).toThrow("repository identity");

    const stale = await repairFixture();
    stale.input.hiveRepairResult = tamperAndRedigestHive(stale.input.hiveRepairResult, (value) => {
      value.headSha = commit("c");
      value.validationRequests[0].commitSha = commit("c");
    });
    expect(() => buildVisualRepairValidationFromArtifacts(stale.input)).toThrow("commit mismatch");

    const summary = await repairFixture();
    await replaceBundledReport(summary, (value) => { value.summary.passed += 1; });
    expect(() => buildVisualRepairValidationFromArtifacts(summary.input)).toThrow("summary does not recompute");

    const arithmetic = await repairFixture();
    await replaceBundledReport(arithmetic, (value) => {
      value.results[0].screenshotAssertions[0].actualDiffPixelRatio = 0.5;
      value.results[0].screenshotAssertions[0].actualDiffPixels = 0;
    });
    expect(() => buildVisualRepairValidationFromArtifacts(arithmetic.input)).toThrow("inconsistent diff arithmetic");
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
    profiles: [{ ...profileBody, profileDigest: computeVisualValidationProfileDigest(profileBody) }],
    obligations: [{
      obligationId: "obligation.card", description: "Card rendering matches the reference.", sourceAssetIds: ["asset.reference"], mappedContractIds: ["contract.card"],
      route: "/", state: "default", viewportId: "desktop", assertionKind: "pixel_region", authority: "deterministic", confidence: 1, status: "mapped"
    }],
    sourceContext: { digest: canonicalSha256({ files: sourceFiles, omittedPaths: 0, truncated: false }), files: sourceFiles, omittedPaths: 0, truncated: false }
  });
  const hiveResultContent = {
    schemaVersion: "hive.repair-result.v1",
    digestAlgorithm: "hive.canonical-json.sha256.v1",
    generatedAt: "2026-07-14T11:50:00.000Z",
    taskId: task.taskId,
    taskContextDigest: task.contextDigest,
    repository: { name: repository, repositoryId, repositoryFingerprint },
    finding: { fingerprint: findingFingerprint, repositoryFingerprint: findingRepositoryFingerprint, publicationRole: "canonical", rootCauseKey: findingRootCauseKey },
    baseSha,
    headSha,
    diffSha256: sha("7"),
    changedFiles: [{ path: "src/App.tsx", status: "modified", sha256: sha("6") }],
    attempts: [{ attemptId: "attempt.1", model: "fixture-model", promptDigest: sha("5"), startedAt: "2026-07-14T11:30:00.000Z", completedAt: "2026-07-14T11:45:00.000Z", status: "completed" }],
    toolTranscript: [{ sequence: 0, toolName: "visual_hive_get_task_context", requestDigest: sha("4"), resultDigest: task.contextDigest, status: "passed" }],
    validationRequests: [{ requestId: "validation.1", kind: "patch_validation", profileId: "profile.repair", commitSha: headSha, requestDigest: sha("3") }],
    claimedOutcome: "Updated the card layout and preserved regression coverage.",
    status: "candidate"
  };
  const hiveResult = { ...hiveResultContent, resultDigest: canonicalSha256(hiveResultContent) };

  const beforeRoot = await makeRoot("before");
  const afterRoot = await makeRoot("after");
  const before = await makeRun({
    root: beforeRoot, phase: "before", commitSha: baseSha, task, repository, repositoryId, repositoryFingerprint, findingFingerprint,
    image: beforePng, imageId: "asset.before.actual", report: report("before", repository, baseSha, "failed", "failed", false, false),
    finding: options.beforeFinding === "missing" ? undefined : "present", findingRepositoryFingerprint, configDigest: sha("1"), baselineDigest: sha("9"), maxDiffPixelRatio: 0.01
  });
  const afterReport = report(
    "after",
    repository,
    headSha,
    options.afterCardStatus === "missing_baseline" ? "failed" : "passed",
    options.afterCardStatus === "missing_baseline" ? "failed" : "passed",
    Boolean(options.omitAfterSecondaryResult),
    Boolean(options.failAfterSecondary),
    options.afterCardStatus
  );
  const after = await makeRun({
    root: afterRoot, phase: "after", commitSha: headSha, task, repository, repositoryId, repositoryFingerprint, findingFingerprint,
    image: afterPng, imageId: "asset.after.actual", report: afterReport,
    finding: options.afterFinding === "missing" ? undefined : (options.afterFinding ?? "absent"),
    findingRepositoryFingerprint,
    configDigest: options.afterConfigDigest ?? sha("1"),
    baselineDigest: options.afterBaselineDigest ?? sha("9"), maxDiffPixelRatio: options.afterMaxDiffPixelRatio ?? 0.01
  });

  return {
    input: {
      validationId: "validation.card",
      generatedAt: "2026-07-14T12:10:00.000Z",
      taskContext: jsonArtifact(".visual-hive/repair/task-context.json", task),
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
  screenshotStatus: "passed" | "missing_baseline" = cardStatus === "passed" ? "passed" : "failed"
): Record<string, any> {
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
      ...(screenshotStatus === "failed" ? { diffPath: ".visual-hive/results/card-diff.png", actualDiffPixelRatio: 1, actualDiffPixels: 4, diffPixels: 4 } : { actualDiffPixelRatio: 0, actualDiffPixels: 0, diffPixels: 0 }),
      maxDiffPixelRatio: 0.01, totalPixels: 4,
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
  imageId: string;
  report: Record<string, any>;
  finding?: "present" | "absent";
  findingRepositoryFingerprint: string;
  configDigest: string;
  baselineDigest: string;
  maxDiffPixelRatio: number;
}

async function makeRun(input: MakeRunInput): Promise<BuildVisualRepairValidationArtifacts["before"]> {
  const reportPath = ".visual-hive/report.json";
  const runContextPath = ".visual-hive/repair/run-context.json";
  const imagePath = ".visual-hive/results/card-actual.png";
  const reportBytes = jsonBytes(input.report);
  await writeArtifact(input.root, reportPath, reportBytes);
  await writeArtifact(input.root, imagePath, input.image);
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
    execution: {
      commitSha: input.commitSha,
      profileId: "profile.repair",
      profileDigest: input.task.profiles[0]!.profileDigest,
      configDigest: input.configDigest,
      validationPolicyDigest: computeVisualValidationPolicyDigest("command.playwright", thresholds),
      contractInventoryDigest: canonicalSha256(["contract.card", "contract.secondary"]),
      planDigest: sha("a"),
      testPlanDigest: canonicalSha256("plan-v1"),
      toolRegistryDigest: canonicalSha256("tools-v1"),
      baselineIdentityDigest: input.baselineDigest,
      executionMatrixDigest: canonicalSha256(cases),
      browser: { name: "chromium", version: "130.0" },
      environment: {
        os: "windows", architecture: "x64", nodeVersion: "22.13.1", playwrightVersion: "1.54.1",
        fontManifestDigest: sha("d"), locale: "en-US", timezone: "UTC"
      },
      cases
    },
    producer: { visualHiveVersion: "0.3.2", visualHiveCommit: commit("c"), playwrightVersion: "1.54.1" },
    command: {
      validationCommandId: "command.playwright",
      startedAt: input.phase === "before" ? "2026-07-14T12:00:00.000Z" : "2026-07-14T12:02:00.000Z",
      completedAt: input.phase === "before" ? "2026-07-14T12:01:00.000Z" : "2026-07-14T12:03:00.000Z",
      exitCode: 0
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
      obligationIds: ["obligation.card"]
    }],
    thresholds,
    capture: { status: "passed", failures: [] }
  });
  const runContextBytes = jsonBytes(runContext);
  await writeArtifact(input.root, runContextPath, runContextBytes);
  const observations = input.finding ? [observation(input.findingFingerprint, input.findingRepositoryFingerprint, input.finding)] : [];
  const bundle = await writeVisualHiveBundle({
    rootDir: input.root,
    project: "fixture",
    mode: "measured",
    verdict: input.phase === "after" && input.finding === "absent" ? "ready" : "blocked",
    acmmRequest: 3,
    artifacts: [reportPath, runContextPath, imagePath],
    source: { repository: input.repository, repositoryId: input.repositoryId, ref: "main", commitSha: input.commitSha, event: "local", conclusion: "success", trusted: false },
    scan: { scope: "full", authoritativeForResolution: true, evaluatedContracts: ["contract.card", "contract.secondary"], evaluatedFiles: ["src/App.tsx"], testPlanVersion: "plan-v1", toolRegistryVersion: "tools-v1" },
    observations,
    producerVersion: "0.3.2",
    producerGitCommit: commit("c"),
    bundleId: input.phase === "before" ? "bundle.before" : "bundle.after",
    now: new Date(input.phase === "before" ? "2026-07-14T12:01:30.000Z" : "2026-07-14T12:03:30.000Z")
  });
  return {
    manifest: jsonArtifact("manifest.json", bundle.manifest),
    runContextPath,
    payloads: [
      { sourcePath: reportPath, bytes: reportBytes },
      { sourcePath: runContextPath, bytes: runContextBytes },
      { sourcePath: imagePath, bytes: input.image }
    ]
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
  context.runContextDigest = canonicalSha256(contextContent);
  const contextBytes = jsonBytes(context);
  const root = fixture.roots.after;
  await writeArtifact(root, ".visual-hive/report.json", reportBytes);
  await writeArtifact(root, ".visual-hive/repair/run-context.json", contextBytes);
  const imagePayload = fixture.input.after.payloads.find((item) => item.sourcePath === ".visual-hive/results/card-actual.png")!;
  const manifestValue = JSON.parse(Buffer.from(fixture.input.after.manifest.bytes).toString("utf8"));
  await rm(path.join(root, ".visual-hive", "bundles", manifestValue.bundleId), { recursive: true, force: true });
  const rebuilt = await writeVisualHiveBundle({
    rootDir: root, project: "fixture", mode: "measured", verdict: "ready", acmmRequest: 3,
    artifacts: [".visual-hive/report.json", ".visual-hive/repair/run-context.json", ".visual-hive/results/card-actual.png"],
    source: manifestValue.source, scan: manifestValue.scan, observations: manifestValue.observations,
    producerVersion: "0.3.2", producerGitCommit: commit("c"), bundleId: manifestValue.bundleId, now: new Date(manifestValue.generatedAt)
  });
  fixture.input.after.manifest = jsonArtifact("manifest.json", rebuilt.manifest);
  fixture.input.after.payloads = [
    { sourcePath: ".visual-hive/report.json", bytes: reportBytes },
    { sourcePath: ".visual-hive/repair/run-context.json", bytes: contextBytes },
    { sourcePath: ".visual-hive/results/card-actual.png", bytes: imagePayload.bytes }
  ];
}

function tamperAndRedigestHive(artifact: RawRepairArtifact, mutate: (value: any) => void): RawRepairArtifact {
  const value = JSON.parse(Buffer.from(artifact.bytes).toString("utf8"));
  mutate(value);
  const { resultDigest: _digest, ...content } = value;
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
