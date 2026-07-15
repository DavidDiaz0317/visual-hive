import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-repair-proof-"));
const fixtureRoot = path.join(tempRoot, "repository");
const controlRoot = path.join(tempRoot, "control");
const storeRoot = path.join(tempRoot, "store");
const releaseRoot = path.join(tempRoot, "release");
const configPath = path.join(fixtureRoot, "visual-hive.config.yaml");
const entrypoint = path.join(releaseRoot, "visual-hive.mjs");
const serverPidPath = path.join(fixtureRoot, ".fixture-server.pid");
let fixtureServerPid;

try {
  await run(process.execPath, [path.join(repoRoot, "scripts", "build-release-bundle.mjs"), "--output", releaseRoot], {
    cwd: repoRoot,
    timeoutMs: 180_000
  });
  await assertFile(entrypoint, "packaged Visual Hive entrypoint");

  const core = await import(pathToFileURL(path.join(repoRoot, "packages", "core", "dist", "index.js")));
  const playwrightAdapter = await import(pathToFileURL(path.join(repoRoot, "packages", "playwright-adapter", "dist", "index.js")));
  const manifestBytes = await readFile(path.join(releaseRoot, "release-manifest.json"));
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const entrypointBytes = await readFile(entrypoint);
  assert(/^[a-f0-9]{40}$/u.test(manifest.gitCommit), "release manifest must contain an exact Git commit");

  await Promise.all([mkdir(fixtureRoot), mkdir(controlRoot), mkdir(storeRoot)]);
  const port = await reservePort();
  await writeFixtureFiles(fixtureRoot, port, healthyPage());

  await git(["init", "-b", "main"]);
  await git(["config", "user.name", "Visual Hive Repair Proof"]);
  await git(["config", "user.email", "visual-hive-repair-proof@example.invalid"]);
  await git(["config", "core.autocrlf", "false"]);
  await git(["remote", "add", "origin", "https://github.com/fixture/visual-hive-local-repair-proof.git"]);

  await packaged(["plan", "--config", configPath, "--mode", "full"], { timeoutMs: 60_000 });
  await packaged(["run", "--config", configPath, "--skip-install", "--skip-build"], { timeoutMs: 120_000 });
  await rememberFixtureServerPid();
  await stopOrphanedFixtureServer();
  const seedReport = await readJson(path.join(fixtureRoot, ".visual-hive", "report.json"));
  assertScreenshotStatuses(seedReport, ["created", "created"], "baseline seed");
  const baselinePaths = screenshotAssertions(seedReport).map((item) => path.join(fixtureRoot, ...item.baselinePath.split("/")));
  assert(baselinePaths.length === 2, "baseline seed must create exactly two screenshot baselines");
  for (const baselinePath of baselinePaths) await assertFile(baselinePath, "seeded screenshot baseline");

  await git(["add", ".gitignore", "server.mjs", "page.json", "visual-hive.config.yaml", ".visual-hive/snapshots"]);
  await git(["commit", "-m", "seed immutable visual baselines"]);

  await writeJson(path.join(fixtureRoot, "page.json"), brokenPage());
  await git(["add", "page.json"]);
  await git(["commit", "-m", "introduce first-route visual regression"]);
  const baseSha = await git(["rev-parse", "HEAD"]);
  const baseTreeSha = await git(["rev-parse", "HEAD^{tree}"]);
  const basePageBytes = Buffer.from(await git(["show", `${baseSha}:page.json`], { trim: false }), "utf8");

  await writeJson(path.join(fixtureRoot, "page.json"), healthyPage());
  await git(["add", "page.json"]);
  await git(["commit", "-m", "repair first-route visual regression"]);
  const candidateSha = await git(["rev-parse", "HEAD"]);
  const candidateTreeSha = await git(["rev-parse", "HEAD^{tree}"]);
  const candidatePageBytes = Buffer.from(await git(["show", `${candidateSha}:page.json`], { trim: false }), "utf8");
  const patchBytes = Buffer.from(await git(["diff", "--binary", baseSha, candidateSha, "--", "page.json"], { trim: false }), "utf8");

  const loaded = await core.loadConfig(configPath, fixtureRoot);
  const identity = {
    visualHiveVersion: manifest.version,
    visualHiveCommit: manifest.gitCommit,
    visualHiveManifestSha256: sha256(manifestBytes),
    visualHiveEntrypointSha256: sha256(entrypointBytes)
  };
  const repair = buildRepairArtifacts({
    core,
    validationToolRegistryDigest: playwrightAdapter.PLAYWRIGHT_REPAIR_VALIDATION_TOOL_REGISTRY_DIGEST,
    config: loaded.config,
    baseSha,
    baseTreeSha,
    candidateSha,
    candidateTreeSha,
    basePageBytes,
    candidatePageBytes,
    patchBytes,
    identity
  });
  const files = await writeRepairInputs(controlRoot, repair);

  await git(["checkout", "--detach", baseSha]);
  const before = await capture("before", repair.reproductionRequest, files, baseSha);
  await rememberFixtureServerPid();
  await stopOrphanedFixtureServer();
  assert(before.commitSha === baseSha, `before capture commit mismatch: ${before.commitSha}`);
  assert(before.captureStatus === "failed", `before capture must fail, got ${before.captureStatus}`);
  const beforeReport = await readJson(path.join(fixtureRoot, ...before.reportPath.split("/")));
  assertScreenshotStatuses(beforeReport, ["failed", "passed"], "broken base capture");
  assert(before.evidenceAssetCount >= 5, "broken base capture must retain actual/baseline/diff evidence for both screenshots");

  repair.hiveResult = buildHiveResult(core, repair, {
    generatedAt: new Date().toISOString(),
    baseSha,
    baseTreeSha,
    candidateSha,
    candidateTreeSha,
    basePageBytes,
    candidatePageBytes,
    patchBytes
  });
  await writeJson(files.hiveResult, repair.hiveResult);

  await git(["checkout", "--detach", candidateSha]);
  const after = await capture("after", repair.patchValidationRequest, files, candidateSha);
  await rememberFixtureServerPid();
  await stopOrphanedFixtureServer();
  assert(after.commitSha === candidateSha, `after capture commit mismatch: ${after.commitSha}`);
  assert(after.captureStatus === "passed", `after capture must pass, got ${after.captureStatus}`);
  const afterReport = await readJson(path.join(fixtureRoot, ...after.reportPath.split("/")));
  assertScreenshotStatuses(afterReport, ["passed", "passed"], "repaired candidate capture");

  const validation = await packagedJson([
    "repair", "validate",
    "--store", storeRoot,
    "--task-context", files.taskContext,
    "--hive-session", files.hiveSession,
    "--hive-result", files.hiveResult,
    "--before-bundle", path.join(fixtureRoot, ...before.bundleDirectory.split("/")),
    "--before-run-context", before.runContextPath,
    "--after-bundle", path.join(fixtureRoot, ...after.bundleDirectory.split("/")),
    "--after-run-context", after.runContextPath,
    "--validation-id", "validation.local-repair-proof"
  ], { timeoutMs: 60_000 });

  const receipt = await readJson(path.join(storeRoot, ...validation.outputPath.split("/")));
  assert(validation.comparabilityStatus === "comparable", `repair evidence must be comparable, got ${validation.comparabilityStatus}`);
  assert(receipt.lanes?.targeted?.status === "passed", `targeted lane must pass, got ${receipt.lanes?.targeted?.status}`);
  assert(receipt.lanes?.regression?.status === "passed", `regression lane must pass, got ${receipt.lanes?.regression?.status}`);
  assert(receipt.obligations?.length === 1 && receipt.obligations[0]?.status === "passed", "the exact first-route deterministic obligation must pass");
  assert(receipt.screenshotTriplets?.length === 1, "the exact first-route obligation must bind one before/baseline/after screenshot triplet");
  assert(receipt.authoritativeForResolution === false, "an unsandboxed command target without broker target attestation must remain non-authoritative");
  assert(receipt.verdict === "blocked", `non-authoritative repair verdict must be blocked, got ${receipt.verdict}`);
  assert(receipt.closureRecommendation === "keep_open", `non-authoritative repair must keep the issue open, got ${receipt.closureRecommendation}`);
  assert(receipt.policyChanges?.configChanged === false, "repair must not change Visual Hive config");
  assert(receipt.policyChanges?.validationPolicyChanged === false, "repair must not change validation policy");
  assert(receipt.policyChanges?.thresholdWeakened === false, "repair must not weaken thresholds");
  assert(receipt.policyChanges?.baselineChanged === false, "repair must not change approved baselines");

  console.log(JSON.stringify({
    schemaVersion: "visual-hive.repair-local-proof.v1",
    release: identity,
    repository: "fixture/visual-hive-local-repair-proof",
    baseSha,
    candidateSha,
    before: { captureStatus: before.captureStatus, screenshotStatuses: statuses(beforeReport), bundleDigest: before.bundleDigest },
    after: { captureStatus: after.captureStatus, screenshotStatuses: statuses(afterReport), bundleDigest: after.bundleDigest },
    validation: {
      comparabilityStatus: validation.comparabilityStatus,
      targeted: receipt.lanes.targeted.status,
      regression: receipt.lanes.regression.status,
      authoritativeForResolution: receipt.authoritativeForResolution,
      verdict: receipt.verdict,
      closureRecommendation: receipt.closureRecommendation,
      receiptDigest: validation.receiptDigest
    }
  }, null, 2));
} finally {
  await rememberFixtureServerPid().catch(() => undefined);
  await stopOrphanedFixtureServer().catch(() => undefined);
  await rm(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

async function capture(phase, request, files, expectedSha) {
  assert(await git(["rev-parse", "HEAD"]) === expectedSha, `${phase} capture checkout is not at its requested commit`);
  return packagedJson([
    "repair", "capture",
    "--cwd", fixtureRoot,
    "--config", configPath,
    "--task-context", files.taskContext,
    "--hive-session", files.hiveSession,
    "--request", phase === "before" ? files.reproductionRequest : files.patchValidationRequest,
    "--authorization", files.authorization,
    "--budget", files.budget,
    "--finding", files.finding,
    "--phase", phase,
    "--source-ref", "refs/heads/main",
    "--source-event", "local-packaged-proof",
    "--acmm-request", "5"
  ], { cwd: fixtureRoot, timeoutMs: 120_000 });
}

function buildRepairArtifacts(input) {
  const { core } = input;
  const repository = "fixture/visual-hive-local-repair-proof";
  const repositoryId = "local-proof-1";
  const repositoryFingerprint = core.computeVisualRepositoryFingerprint(repository, repositoryId);
  const generatedAt = new Date(Date.now() - 60_000).toISOString();
  const profileBody = {
    profileId: "profile.local-repair-proof",
    targetId: "app",
    requestKinds: ["reproduction", "capture", "patch_validation"],
    contractIds: ["contract.routes"],
    routes: ["/first", "/second"],
    scenarioIds: ["default"],
    viewports: [{ viewportId: "desktop", width: 320, height: 200, deviceScaleFactor: 1 }],
    validationCommandId: "command.playwright.full"
  };
  const profile = { ...profileBody, profileDigest: core.computeVisualValidationProfileDigest(profileBody) };
  const sourceFiles = [{ path: "page.json", sha256: sha256(input.basePageBytes), size: input.basePageBytes.byteLength, classification: "source" }];
  const task = core.buildVisualHiveTaskContext({
    schemaVersion: "visual-hive.task-context.v1",
    digestAlgorithm: "visual-hive.canonical-json.sha256.v1",
    generatedAt,
    taskId: "task.local-repair-proof",
    repository: { name: repository, repositoryId, repositoryFingerprint, baseSha: input.baseSha, ref: "refs/heads/main" },
    issue: {
      source: "fixture",
      externalId: "local-repair-proof-1",
      title: "Repair the first route without regressing the second",
      problemStatement: "Restore the first route to its approved deterministic rendering while preserving the second route.",
      problemStatementSha256: core.sha256Utf8("Restore the first route to its approved deterministic rendering while preserving the second route.")
    },
    assets: [],
    imageReferences: [],
    graphCandidates: [{
      nodeId: "route.first",
      kind: "route",
      label: "First route",
      score: 1,
      reasons: ["The first route differs from its approved screenshot."],
      sourceSpans: [{ path: "page.json", startLine: 1, endLine: 4 }]
    }],
    profiles: [profile],
    obligations: [{
      obligationId: "obligation.first-route",
      description: "The first route matches its approved rendering.",
      sourceAssetIds: [],
      mappedContractIds: ["contract.routes"],
      route: "/first",
      state: "default",
      viewportId: "desktop",
      assertionKind: "pixel_region",
      authority: "deterministic",
      confidence: 1,
      status: "mapped"
    }],
    sourceContext: {
      digest: core.canonicalSha256({ files: sourceFiles, omittedPaths: 0, truncated: false }),
      files: sourceFiles,
      omittedPaths: 0,
      truncated: false
    }
  });
  const rootCauseKey = "finding/visual_regression/first-route";
  const findingIdentity = {
    fingerprint: "visual-hive:fixture:first-route",
    repositoryFingerprint: core.visualHiveObservationRepositoryFingerprint(repository, "visual-hive:fixture:first-route", "canonical", rootCauseKey),
    publicationRole: "canonical",
    rootCauseKey,
    recurrenceKey: "recurrence/visual_regression/first-route"
  };
  const repositoryProjection = { name: repository, repositoryId, repositoryFingerprint, baseSha: input.baseSha, baseTreeSha: input.baseTreeSha };
  const taskProjection = {
    taskId: task.taskId,
    taskContextDigest: task.contextDigest,
    issueSource: task.issue.source,
    issueExternalId: task.issue.externalId,
    problemStatementDigest: task.issue.problemStatementSha256,
    imageAttachments: []
  };
  const sessionId = core.computeHiveRepairSessionId({ repository: repositoryProjection, finding: findingIdentity, task: taskProjection });
  const promptDigest = "4".repeat(64);
  const attemptId = core.computeHiveRepairAttemptId(sessionId, 0, promptDigest);
  const budgetLimits = {
    maxTurns: 8,
    maxToolCalls: 8,
    maxInputBytes: 4 * 1024 * 1024,
    maxImageBytes: 32 * 1024 * 1024,
    maxModelInputTokens: 100_000,
    maxModelOutputTokens: 20_000,
    maxProviderCostUsdMicros: 1_000_000,
    maxWallSeconds: 600,
    maxRepairAttempts: 2
  };
  const configDigest = core.canonicalSha256(input.config);
  const toolRegistryDigest = core.canonicalSha256(core.VISUAL_REPAIR_TOOL_NAMES);
  const promptSchemaDigest = core.canonicalSha256("local-repair-proof-prompt-schema.v1");
  const authorization = core.buildHiveExecutionAuthorization({
    authorizationId: "authorization.local-repair-proof",
    issuedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
    repositoryFingerprint,
    taskContextDigest: task.contextDigest,
    baseSha: input.baseSha,
    profile,
    toolNames: [...core.VISUAL_REPAIR_TOOL_NAMES],
    assetIds: [],
    budgetDigest: core.canonicalSha256(budgetLimits),
    configDigest,
    toolRegistryDigest,
    promptSchemaDigest,
    visualHiveManifestSha256: input.identity.visualHiveManifestSha256,
    visualHiveEntrypointSha256: input.identity.visualHiveEntrypointSha256
  });
  const reproductionRequest = core.buildHiveRepairValidationRequestSpec({
    sessionId,
    attemptId,
    kind: "reproduction",
    commitRole: "base",
    profileId: profile.profileId,
    profileDigest: profile.profileDigest,
    commitSha: input.baseSha,
    authorizationDigest: authorization.authorizationDigest
  });
  const patchValidationRequest = core.buildHiveRepairValidationRequestSpec({
    sessionId,
    attemptId,
    kind: "patch_validation",
    commitRole: "candidate",
    profileId: profile.profileId,
    profileDigest: profile.profileDigest,
    commitSha: input.candidateSha,
    authorizationDigest: authorization.authorizationDigest
  });
  const provider = {
    providerId: "provider.local-proof",
    providerKind: "fixture",
    model: "deterministic-local-proof",
    executableIdentityDigest: "5".repeat(64),
    capabilityDigest: "6".repeat(64),
    modelConfigurationDigest: "7".repeat(64)
  };
  const turnInput = {
    attemptId,
    ordinal: 0,
    providerInputDigest: "8".repeat(64),
    consumedToolOutcomeDigests: []
  };
  const turnDraft = { ...turnInput, inputDigest: core.computeHiveRepairTurnInputDigest(sessionId, turnInput) };
  const turnId = core.computeHiveRepairTurnId(sessionId, turnDraft);
  const requestedAt = new Date(Date.now() - 4 * 60_000).toISOString();
  const { authorizationDigest: _authorizationDigest, ...authorizationInput } = authorization;
  void _authorizationDigest;
  const session = core.buildHiveRepairSession({
    schemaVersion: "hive.repair-session.v1",
    digestAlgorithm: "hive.canonical-json.sha256.v1",
    createdAt: new Date(Date.now() - 8 * 60_000).toISOString(),
    updatedAt: new Date(Date.now() - 3 * 60_000).toISOString(),
    deadlineAt: new Date(Date.now() + 90 * 60_000).toISOString(),
    requestedMode: "on",
    effectiveMode: "visual_hive",
    state: "awaiting_validation",
    repository: repositoryProjection,
    finding: findingIdentity,
    task: taskProjection,
    capability: {
      selectionReasons: ["The task requires exact before/after screenshot evidence."],
      visualHiveVersion: input.identity.visualHiveVersion,
      visualHiveCommit: input.identity.visualHiveCommit,
      visualHiveManifestSha256: input.identity.visualHiveManifestSha256,
      visualHiveEntrypointSha256: input.identity.visualHiveEntrypointSha256,
      toolProtocolDigest: toolRegistryDigest,
      validationToolRegistryDigest: input.validationToolRegistryDigest
    },
    sourceContext: {
      digest: task.sourceContext.digest,
      maxBytes: Math.max(input.basePageBytes.byteLength, 4096),
      totalBytes: input.basePageBytes.byteLength,
      files: task.sourceContext.files,
      omittedPaths: 0,
      truncated: false
    },
    validationProfiles: [profile],
    promptIdentities: {
      systemPromptDigest: "a".repeat(64),
      repairPromptDigest: "b".repeat(64),
      toolSchemaDigest: "c".repeat(64),
      taskSchemaDigest: "d".repeat(64),
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
      startedAt: new Date(Date.now() - 7 * 60_000).toISOString(),
      completedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
      promptDigest,
      turnIds: [turnId],
      candidatePatchDigest: sha256(input.patchBytes),
      candidateHeadSha: input.candidateSha,
      candidateHeadTreeSha: input.candidateTreeSha,
      validationRequestIds: [reproductionRequest.requestId, patchValidationRequest.requestId]
    }],
    turns: [{
      ...turnDraft,
      turnId,
      state: "completed",
      startedAt: new Date(Date.now() - 7 * 60_000).toISOString(),
      completedAt: new Date(Date.now() - 6 * 60_000).toISOString(),
      providerIdentityDigest: core.computeHiveRepairProviderIdentityDigest(provider),
      usage: {
        inputBytes: 512,
        imageBytes: 0,
        modelInputTokens: 500,
        modelOutputTokens: 200,
        providerCostUsdMicros: 10_000,
        wallMilliseconds: 60_000
      },
      providerReceiptDigest: "0".repeat(64),
      outputKind: "final_result",
      outputDigest: "1".repeat(64)
    }],
    toolReceipts: [],
    validationRequests: [
      { ...reproductionRequest, state: "requested", requestedAt },
      { ...patchValidationRequest, state: "requested", requestedAt }
    ],
    authorization: authorizationInput
  });
  const finding = {
    fingerprint: findingIdentity.fingerprint,
    repositoryFingerprint: findingIdentity.repositoryFingerprint,
    publicationRole: findingIdentity.publicationRole,
    rootCauseKey: findingIdentity.rootCauseKey,
    blockedByRootKeys: [],
    issueKind: "visual_regression",
    severity: "high",
    owningAgentHint: "hive/quality",
    title: "The first route differs from its approved rendering",
    body: "The deterministic first-route screenshot differs while the independent second route remains healthy.",
    labels: ["visual-hive"],
    sourceArtifacts: [],
    affectedContracts: ["contract.routes"],
    affectedObligationIds: ["obligation.first-route"],
    affectedAssertions: [{ contractId: "contract.routes", screenshotName: "first", route: "/first", state: "default", viewportId: "desktop" }],
    firstSeenAt: generatedAt
  };
  return { task, session, authorization, budgetLimits, reproductionRequest, patchValidationRequest, finding };
}

function buildHiveResult(core, repair, input) {
  const attempt = repair.session.attempts[0];
  return core.buildHiveRepairResult({
    schemaVersion: "hive.repair-result.v1",
    digestAlgorithm: "hive.canonical-json.sha256.v1",
    generatedAt: input.generatedAt,
    sessionId: repair.session.sessionId,
    sessionDigest: repair.session.sessionDigest,
    transcriptDigest: repair.session.transcriptDigest,
    effectiveMode: "visual_hive",
    taskId: repair.task.taskId,
    taskContextDigest: repair.task.contextDigest,
    repository: {
      name: repair.task.repository.name,
      repositoryId: repair.task.repository.repositoryId,
      repositoryFingerprint: repair.task.repository.repositoryFingerprint
    },
    finding: repair.session.finding,
    baseSha: input.baseSha,
    baseTreeSha: input.baseTreeSha,
    headSha: input.candidateSha,
    headTreeSha: input.candidateTreeSha,
    diff: {
      algorithm: "git.diff.binary.sha256.v1",
      sha256: sha256(input.patchBytes),
      changedFiles: [{
        path: "page.json",
        status: "modified",
        beforeSha256: sha256(input.basePageBytes),
        afterSha256: sha256(input.candidatePageBytes),
        beforeMode: "100644",
        afterMode: "100644"
      }]
    },
    provider: repair.session.provider,
    attempts: [{
      attemptId: attempt.attemptId,
      ordinal: attempt.ordinal,
      state: "candidate",
      promptDigest: attempt.promptDigest,
      startedAt: attempt.startedAt,
      completedAt: attempt.completedAt,
      turnCount: 1,
      toolCallCount: 0
    }],
    toolReceipts: [],
    authorizationDigest: repair.authorization.authorizationDigest,
    validationRequests: [repair.reproductionRequest, repair.patchValidationRequest],
    claimedOutcome: { summary: "Restored the first route and preserved the independent second route.", advisory: true },
    status: "candidate"
  });
}

async function writeRepairInputs(root, repair) {
  const files = {
    taskContext: path.join(root, "task-context.json"),
    hiveSession: path.join(root, "hive-session.json"),
    hiveResult: path.join(root, "hive-result.json"),
    reproductionRequest: path.join(root, "reproduction-request.json"),
    patchValidationRequest: path.join(root, "patch-validation-request.json"),
    authorization: path.join(root, "authorization.json"),
    budget: path.join(root, "budget.json"),
    finding: path.join(root, "finding.json")
  };
  await Promise.all([
    writeJson(files.taskContext, repair.task),
    writeJson(files.hiveSession, repair.session),
    writeJson(files.reproductionRequest, repair.reproductionRequest),
    writeJson(files.patchValidationRequest, repair.patchValidationRequest),
    writeJson(files.authorization, repair.authorization),
    writeJson(files.budget, repair.budgetLimits),
    writeJson(files.finding, repair.finding)
  ]);
  return files;
}

async function writeFixtureFiles(root, port, page) {
  await writeFile(path.join(root, ".gitignore"), [
    ".fixture-server.pid",
    ".visual-hive/*",
    "!.visual-hive/snapshots/",
    "!.visual-hive/snapshots/**",
    ""
  ].join("\n"), "utf8");
  await writeFile(path.join(root, "server.mjs"), [
    "import { readFileSync, writeFileSync } from 'node:fs';",
    "import { createServer } from 'node:http';",
    "const pages = JSON.parse(readFileSync(new URL('./page.json', import.meta.url), 'utf8'));",
    "writeFileSync(new URL('./.fixture-server.pid', import.meta.url), String(process.pid));",
    "const server = createServer((request, response) => {",
    "  const route = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;",
    "  const page = pages[route];",
    "  if (!page) { response.writeHead(404); response.end('not found'); return; }",
    "  const html = `<!doctype html><html><head><meta charset=\"utf-8\"><style>html,body{margin:0;width:100%;height:100%;background:#fff;font-family:Arial,sans-serif}.card{box-sizing:border-box;width:240px;height:100px;margin:20px;padding:16px;background:${page.background};color:#fff;border:4px solid ${page.border};font-size:18px}</style></head><body><main class=\"card\" data-testid=\"route-card\">${page.label}</main></body></html>`;",
    "  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });",
    "  response.end(html);",
    "});",
    `server.listen(${port}, '127.0.0.1');`,
    "for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));",
    ""
  ].join("\n"), "utf8");
  await writeJson(path.join(root, "page.json"), page);
  await writeFile(configPath, [
    "project:",
    "  name: visual-hive-local-repair-proof",
    "  type: static",
    "  defaultBranch: main",
    "targets:",
    "  app:",
    "    kind: command",
    "    serve: \"node server.mjs\"",
    `    url: "http://127.0.0.1:${port}"`,
    "    prSafe: true",
    "    cost: cheap",
    "viewports:",
    "  desktop:",
    "    width: 320",
    "    height: 200",
    "visual:",
    "  maxDiffPixelRatio: 0",
    "  updateSnapshots: false",
    "  failOnMissingBaselineInCI: true",
    "  baselinePlatform: shared",
    "  snapshotDir: .visual-hive/snapshots",
    "  artifactDir: .visual-hive/artifacts",
    "contracts:",
    "  - id: contract.routes",
    "    description: Both independent routes retain their approved rendering.",
    "    target: app",
    "    severity: high",
    "    runOn:",
    "      pullRequest: true",
    "      schedule: true",
    "    waitFor:",
    "      - selector: \"[data-testid='route-card']\"",
    "        state: visible",
    "        timeoutMs: 10000",
    "    screenshots:",
    "      - name: first",
    "        route: /first",
    "        viewport: desktop",
    "      - name: second",
    "        route: /second",
    "        viewport: desktop",
    ""
  ].join("\n"), "utf8");
}

function healthyPage() {
  return {
    "/first": { label: "FIRST ROUTE", background: "#0f172a", border: "#38bdf8" },
    "/second": { label: "SECOND ROUTE", background: "#14532d", border: "#4ade80" }
  };
}

function brokenPage() {
  return {
    "/first": { label: "BROKEN FIRST ROUTE", background: "#7f1d1d", border: "#f87171" },
    "/second": { label: "SECOND ROUTE", background: "#14532d", border: "#4ade80" }
  };
}

async function packaged(args, options = {}) {
  return run(process.execPath, [entrypoint, ...args], {
    cwd: options.cwd ?? fixtureRoot,
    timeoutMs: options.timeoutMs ?? 120_000,
    allowExitCodes: options.allowExitCodes ?? [0]
  });
}

async function packagedJson(args, options = {}) {
  const result = await packaged(args, options);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`packaged Visual Hive command did not return JSON: ${error instanceof Error ? error.message : String(error)}\n${result.stdout}`);
  }
}

async function git(args, options = {}) {
  const result = await run("git", args, { cwd: fixtureRoot, timeoutMs: 20_000 });
  return options.trim === false ? result.stdout : result.stdout.trim();
}

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: { ...process.env, CI: "false", TZ: "UTC" }
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${path.basename(command)} ${args.join(" ")} timed out after ${options.timeoutMs}ms`));
    }, options.timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      const result = { code, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") };
      if ((options.allowExitCodes ?? [0]).includes(code)) resolve(result);
      else reject(new Error(`${path.basename(command)} exited ${code}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`));
    });
  });
}

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("failed to reserve a local proof port");
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function rememberFixtureServerPid() {
  try {
    const value = (await readFile(serverPidPath, "utf8")).trim();
    if (/^[1-9][0-9]*$/u.test(value)) fixtureServerPid = Number(value);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
}

async function stopOrphanedFixtureServer() {
  if (!fixtureServerPid) return;
  try {
    process.kill(fixtureServerPid, 0);
  } catch {
    fixtureServerPid = undefined;
    return;
  }
  process.kill(fixtureServerPid, "SIGTERM");
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    try {
      process.kill(fixtureServerPid, 0);
    } catch {
      fixtureServerPid = undefined;
      return;
    }
  }
  process.kill(fixtureServerPid, "SIGKILL");
  fixtureServerPid = undefined;
}

function screenshotAssertions(report) {
  return report.results.flatMap((result) => result.screenshotAssertions ?? []);
}

function statuses(report) {
  return screenshotAssertions(report).map((item) => item.status);
}

function assertScreenshotStatuses(report, expected, label) {
  const actual = statuses(report);
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label} screenshot statuses must be ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function assertFile(filePath, label) {
  try {
    await access(filePath);
  } catch {
    throw new Error(`${label} is missing: ${filePath}`);
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isMissing(error) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
