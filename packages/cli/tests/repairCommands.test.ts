import { link, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { PNG } from "pngjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildVisualHiveTaskContext,
  buildHiveRepairResult,
  buildVisualRunContext,
  canonicalSha256,
  compareVisualPngBytes,
  computeVisualRepositoryFingerprint,
  computeVisualValidationPolicyDigest,
  computeVisualValidationProfileDigest,
  loadConfig,
  parseVisualRepairValidation,
  sha256Bytes,
  sha256Utf8,
  visualHiveObservationRepositoryFingerprint,
  visualRepairSessionRelativeRoot,
  writeVisualHiveBundle,
  type HiveRepairSession,
  type VisualHiveTaskContextInput
} from "@visual-hive/core";
import {
  PLAYWRIGHT_REPAIR_VALIDATION_TOOL_REGISTRY_DIGEST,
  type PlaywrightRepairCaptureResult,
  type RunPlaywrightRepairCaptureOptions
} from "@visual-hive/playwright-adapter";
import { runRepairCaptureCommand } from "../src/commands/repairCapture.js";
import { runRepairTaskContextCommand } from "../src/commands/repairTaskContext.js";
import { buildRepairMcpManifest, createRepairMcpServer, runRepairMcpCommand } from "../src/commands/repairMcp.js";
import { callVisualRepairMcpTool, VISUAL_REPAIR_MCP_TOOL_DEFINITIONS } from "../src/commands/repairMcpTools.js";
import { runRepairValidateCommand } from "../src/commands/repairValidate.js";
import { buildTestRepairSession } from "./repairTestSession.js";

const roots: string[] = [];
const sha = (character: string): string => character.repeat(64);
const commit = (character: string): string => character.repeat(40);
const executionBinding = {
  nonceSha256: sha("1"),
  generatedSpecSha256: sha("2"),
  generatedConfigSha256: sha("3"),
  payloadSha256: sha("4"),
  bindingMacSha256: sha("5")
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("trusted repair CLI operations", () => {
  it("atomically ingests exact task images and is a true idempotent no-op", async () => {
    const fixture = await taskFixture();
    const first = await runRepairTaskContextCommand(fixture.options);
    const second = await runRepairTaskContextCommand(fixture.options);

    expect(first.created).toBe(true);
    expect(second).toMatchObject({ created: false, sessionStorageId: first.sessionStorageId, taskContextDigest: first.taskContextDigest });
    const issue = await callVisualRepairMcpTool(fixture.storeRoot, "visual_hive_get_issue_context", {
      taskId: fixture.task.taskId,
      repository: fixture.task.repository.name,
      taskContextDigest: fixture.task.contextDigest,
      issueFingerprint: "issue.card"
    }, fixture.session, producerFor(fixture.session), { now: () => new Date("2026-07-14T16:00:00.000Z") });
    expect(issue.isError).not.toBe(true);
    expect(issue.content[0]).toMatchObject({ type: "text" });
    expect(issue.content[0]?.type === "text" ? issue.content[0].text : "").toContain("Repair the card");
  });

  it("rejects changed source bytes and corrupted durable task evidence", async () => {
    const fixture = await taskFixture();
    await runRepairTaskContextCommand(fixture.options);
    await writeFile(path.join(fixture.assetRoot, "assets", "reference.png"), png(240, 10, 10));
    await expect(runRepairTaskContextCommand(fixture.options)).rejects.toThrow("digest mismatch");

    await writeFile(path.join(fixture.assetRoot, "assets", "reference.png"), fixture.image);
    const storedAsset = path.join(fixture.storeRoot, ...visualRepairSessionRelativeRoot({ taskId: fixture.task.taskId, repository: fixture.task.repository.name, taskContextDigest: fixture.task.contextDigest }).split("/"), "assets", "reference.png");
    await writeFile(storedAsset, png(1, 2, 3));
    await expect(runRepairTaskContextCommand(fixture.options)).rejects.toThrow("digest mismatch");
  });

  it("rejects a linked session-storage parent without writing outside the repair store", async () => {
    const fixture = await taskFixture();
    const repairRoot = path.join(fixture.storeRoot, ".visual-hive", "repair");
    const outside = path.join(fixture.root, "outside-sessions");
    await Promise.all([
      mkdir(repairRoot, { recursive: true }),
      mkdir(outside, { recursive: true })
    ]);
    await symlink(outside, path.join(repairRoot, "sessions"), process.platform === "win32" ? "junction" : "dir");

    await expect(runRepairTaskContextCommand(fixture.options)).rejects.toThrow(/junction|linked|symbolic-link/u);
    expect(await readdir(outside)).toEqual([]);
  });

  it("exposes exactly the eight repair tools and no generic or execution tools", async () => {
    const fixture = await taskFixture();
    await runRepairTaskContextCommand(fixture.options);
    const producer = producerFor(fixture.session);
    const manifest = buildRepairMcpManifest(fixture.storeRoot, fixture.session, producer);
    expect(manifest.tools.map((tool) => tool.name)).toEqual(VISUAL_REPAIR_MCP_TOOL_DEFINITIONS.map((tool) => tool.name));
    expect(manifest.tools).toHaveLength(8);

    const server = createRepairMcpServer(fixture.storeRoot, fixture.session, producer, { now: () => new Date("2026-07-14T16:00:00.000Z") });
    const client = new Client({ name: "repair-only-test", version: "1" }, { capabilities: {} });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      const tools = await client.listTools(undefined, { timeout: 10_000 });
      expect(tools.tools.map((tool) => tool.name)).toEqual(VISUAL_REPAIR_MCP_TOOL_DEFINITIONS.map((tool) => tool.name));
      expect(tools.tools.some((tool) => tool.name === "visual_hive_run" || tool.name === "visual_hive_list_issues")).toBe(false);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("verifies the executing release identity before repair MCP startup and exposes the full producer scope", async () => {
    const fixture = await taskFixture();
    const sessionPath = path.join(fixture.root, "hive-repair-session.json");
    await writeFile(sessionPath, `${JSON.stringify(fixture.session, null, 2)}\n`, "utf8");
    const producer = producerFor(fixture.session);
    const manifest = await runRepairMcpCommand({
      storeRoot: fixture.storeRoot,
      hiveSession: sessionPath
    }, {
      resolveProducerIdentity: async () => producer
    });
    expect(manifest.scope).toMatchObject({
      sessionId: fixture.session.sessionId,
      sessionDigest: fixture.session.sessionDigest,
      authorizationDigest: fixture.session.authorization!.authorizationDigest,
      visualHiveVersion: producer.visualHiveVersion,
      visualHiveCommit: producer.visualHiveCommit,
      visualHiveManifestSha256: producer.manifestSha256,
      visualHiveEntrypointSha256: producer.entrypointSha256
    });

    for (const mismatched of [
      { ...producer, visualHiveVersion: "999.0.0" },
      { ...producer, visualHiveCommit: commit("f") },
      { ...producer, manifestSha256: sha("f") },
      { ...producer, entrypointSha256: sha("e") }
    ]) {
      await expect(runRepairMcpCommand({
        storeRoot: fixture.storeRoot,
        hiveSession: sessionPath
      }, {
        resolveProducerIdentity: async () => mismatched
      })).rejects.toThrow("does not match the Hive repair session capability pin");
    }
  });

  it("binds CLI capture to the canonical Hive session and resolver-proved producer before execution", async () => {
    const fixture = await taskFixture();
    const configPath = path.join(fixture.root, "visual-hive.config.yaml");
    await writeFile(configPath, `project:\n  name: repair-cli\ntargets:\n  target.app:\n    kind: url\n    url: "http://127.0.0.1:4173"\n    prSafe: true\nviewports:\n  desktop:\n    width: 2\n    height: 2\ncontracts:\n  - id: contract.card\n    description: Card\n    target: target.app\n    screenshots:\n      - name: card\n        route: "/"\n        viewport: desktop\n`, "utf8");
    const loaded = await loadConfig(configPath, fixture.root);
    const repair = buildTestRepairSession(fixture.task, {
      findingFingerprint: "issue.card",
      configDigest: canonicalSha256(loaded.config),
      validationToolRegistryDigest: PLAYWRIGHT_REPAIR_VALIDATION_TOOL_REGISTRY_DIGEST
    });
    const files = {
      taskContext: path.join(fixture.root, "task-context.json"),
      hiveSession: path.join(fixture.root, "hive-session.json"),
      request: path.join(fixture.root, "request.json"),
      authorization: path.join(fixture.root, "authorization.json"),
      budget: path.join(fixture.root, "budget.json"),
      finding: path.join(fixture.root, "finding.json")
    };
    const finding = {
      fingerprint: repair.session.finding.fingerprint,
      repositoryFingerprint: repair.session.finding.repositoryFingerprint,
      publicationRole: repair.session.finding.publicationRole,
      rootCauseKey: repair.session.finding.rootCauseKey,
      blockedByRootKeys: [],
      issueKind: "visual_regression",
      severity: "high",
      owningAgentHint: "hive/quality",
      title: "Card rendering differs",
      body: "The deterministic card screenshot differs from its expected rendering.",
      labels: ["visual-hive"],
      sourceArtifacts: [],
      affectedContracts: ["contract.card"],
      affectedObligationIds: ["obligation.card"],
      affectedAssertions: [{ contractId: "contract.card", screenshotName: "card", route: "/", state: "default", viewportId: "desktop" }],
      firstSeenAt: "2026-07-14T15:00:00.000Z"
    };
    await Promise.all([
      writeFile(files.taskContext, JSON.stringify(fixture.task)),
      writeFile(files.hiveSession, JSON.stringify(repair.session)),
      writeFile(files.request, JSON.stringify(repair.reproductionRequest)),
      writeFile(files.authorization, JSON.stringify(repair.authorization)),
      writeFile(files.budget, JSON.stringify(repair.budgetLimits)),
      writeFile(files.finding, JSON.stringify(finding))
    ]);
    const producer = {
      identityKind: "verified_release_manifest" as const,
      visualHiveVersion: repair.session.capability.visualHiveVersion!,
      visualHiveCommit: repair.session.capability.visualHiveCommit!,
      manifestSha256: repair.session.capability.visualHiveManifestSha256!,
      entrypointSha256: repair.session.capability.visualHiveEntrypointSha256!
    };
    const capture = vi.fn(async (options: RunPlaywrightRepairCaptureOptions) => fakeCaptureResult(options));
    const commandOptions = {
      cwd: fixture.root,
      config: configPath,
      taskContext: files.taskContext,
      hiveSession: files.hiveSession,
      request: files.request,
      authorization: files.authorization,
      budget: files.budget,
      finding: files.finding,
      phase: "before" as const,
      sourceRef: "refs/heads/main",
      sourceEvent: "local"
    };
    const result = await runRepairCaptureCommand(commandOptions, {
      resolveProducerIdentity: async () => producer,
      capture
    });

    expect(result).toMatchObject({ created: true, reused: false, requestId: repair.reproductionRequest.requestId, captureStatus: "failed" });
    expect(capture).toHaveBeenCalledOnce();
    expect(capture.mock.calls[0]?.[0]).toMatchObject({
      executionAuthorization: repair.authorization,
      budgetLimits: repair.budgetLimits,
      producer,
      expectedProducer: {
        visualHiveVersion: repair.session.capability.visualHiveVersion,
        visualHiveCommit: repair.session.capability.visualHiveCommit,
        manifestSha256: repair.session.capability.visualHiveManifestSha256,
        entrypointSha256: repair.session.capability.visualHiveEntrypointSha256
      }
    });

    const blockedCapture = vi.fn(async (options: RunPlaywrightRepairCaptureOptions) => fakeCaptureResult(options));
    await expect(runRepairCaptureCommand(commandOptions, {
      resolveProducerIdentity: async () => ({ ...producer, visualHiveCommit: commit("f") }),
      capture: blockedCapture
    })).rejects.toThrow("does not match the Hive repair session capability pin");
    expect(blockedCapture).not.toHaveBeenCalled();

    await writeFile(files.authorization, JSON.stringify({ ...repair.authorization, configDigest: sha("f") }));
    await expect(runRepairCaptureCommand(commandOptions, {
      resolveProducerIdentity: async () => producer,
      capture: blockedCapture
    })).rejects.toThrow("authorization digest mismatch");
    expect(blockedCapture).not.toHaveBeenCalled();
  });

  it("fails closed before validation when a bundle lacks the named run context", async () => {
    const fixture = await validationFixture();
    await expect(runRepairValidateCommand({
      ...fixture.options,
      beforeRunContext: "runs/before/run-context.json",
    })).rejects.toThrow("does not contain run context");
  });

  it("publishes one producer-faithful immutable receipt under concurrent valid validation", async () => {
    const fixture = await validationFixture();
    const concurrent = await Promise.all([
      runRepairValidateCommand(fixture.options),
      runRepairValidateCommand(fixture.options)
    ]);
    expect(concurrent.map((result) => result.created).sort()).toEqual([false, true]);
    expect(concurrent[0]!.outputPath).toBe(concurrent[1]!.outputPath);
    expect(concurrent[0]!.receiptDigest).toBe(concurrent[1]!.receiptDigest);
    expect(concurrent[0]).toMatchObject({ verdict: "pass", closureRecommendation: "resolved_candidate" });

    const receiptPath = path.join(fixture.storeRoot, ...concurrent[0]!.outputPath.split("/"));
    const firstBytes = await readFile(receiptPath);
    const receipt = parseVisualRepairValidation(JSON.parse(firstBytes.toString("utf8")));
    expect(receipt.receiptDigest).toBe(concurrent[0]!.receiptDigest);
    expect(concurrent[0]).toMatchObject({
      sessionId: receipt.sessionId,
      sessionDigest: receipt.sessionDigest,
      authorizationDigest: receipt.authorizationDigest,
      taskContextDigest: receipt.taskContextDigest,
      findingFingerprint: receipt.findingFingerprint,
      hiveRepairResultDigest: receipt.hiveRepairResultDigest,
      beforeBundleDigest: receipt.beforeBundleDigest,
      afterBundleDigest: receipt.afterBundleDigest,
      beforeReportDigest: receipt.beforeReportDigest,
      afterReportDigest: receipt.afterReportDigest,
      beforeRunContextDigest: receipt.beforeRunContextDigest,
      afterRunContextDigest: receipt.afterRunContextDigest,
      comparabilityStatus: receipt.comparability.status,
      authoritativeForResolution: receipt.authoritativeForResolution
    });
    expect(receipt.findingBeforeStatus).toBe("present");
    expect(receipt.findingStatus).toBe("absent");
    expect(receipt.screenshotTriplets).toHaveLength(1);

    const replay = await runRepairValidateCommand(fixture.options);
    expect(replay.created).toBe(false);
    expect(await readFile(receiptPath)).toEqual(firstBytes);
    expect(await readdir(path.dirname(receiptPath))).toEqual([path.basename(receiptPath)]);

    const laterReplay = await runRepairValidateCommand({
      ...fixture.options,
      now: () => new Date("2026-07-14T16:30:01.000Z")
    });
    expect(laterReplay.created).toBe(false);
    expect(await readFile(receiptPath)).toEqual(firstBytes);

    await link(receiptPath, path.join(fixture.root, "receipt-alias.json"));
    await expect(runRepairValidateCommand(fixture.options)).rejects.toThrow("hard-link alias");
    expect(await readFile(receiptPath)).toEqual(firstBytes);
  });

  it("rejects a linked validation namespace without publishing outside its store", async () => {
    const fixture = await validationFixture();
    const repairRoot = path.join(fixture.storeRoot, ".visual-hive", "repair");
    const outside = path.join(fixture.root, "outside-validations");
    await Promise.all([
      mkdir(repairRoot, { recursive: true }),
      mkdir(outside, { recursive: true })
    ]);
    await symlink(outside, path.join(repairRoot, "sessions"), process.platform === "win32" ? "junction" : "dir");

    await expect(runRepairValidateCommand(fixture.options)).rejects.toThrow(/junction|linked|symbolic-link/u);
    expect(await readdir(outside)).toEqual([]);
  });

  it("rejects a linked parent inside an input evidence bundle", async () => {
    const fixture = await validationFixture();
    const bundledEvidence = path.join(fixture.options.beforeBundle, "files", ".visual-hive");
    const outside = path.join(fixture.root, "outside-bundle-evidence");
    await rename(bundledEvidence, outside);
    await symlink(outside, bundledEvidence, process.platform === "win32" ? "junction" : "dir");

    await expect(runRepairValidateCommand(fixture.options)).rejects.toThrow(/symbolic link|junction|linked/u);
  });
});

async function taskFixture(): Promise<{
  root: string;
  storeRoot: string;
  assetRoot: string;
  image: Buffer;
  task: ReturnType<typeof buildVisualHiveTaskContext>;
  session: HiveRepairSession;
  options: { storeRoot: string; input: string; assetRoot: string };
}> {
  const root = await temporaryRoot("repair-ingest");
  const storeRoot = path.join(root, "store");
  const assetRoot = path.join(root, "source");
  await mkdir(path.join(assetRoot, "assets"), { recursive: true });
  await mkdir(storeRoot, { recursive: true });
  const image = png(10, 20, 30);
  await writeFile(path.join(assetRoot, "assets", "reference.png"), image);
  const input = taskInput(image);
  const task = buildVisualHiveTaskContext(input);
  const inputPath = path.join(root, "task-input.json");
  await writeFile(inputPath, JSON.stringify(input));
  const session = buildTestRepairSession(task, { findingFingerprint: "issue.card" }).session;
  return { root, storeRoot, assetRoot, image, task, session, options: { storeRoot, input: inputPath, assetRoot } };
}

function fakeCaptureResult(options: RunPlaywrightRepairCaptureOptions): PlaywrightRepairCaptureResult {
  const runContextDigest = sha("d");
  const reportSha256 = sha("e");
  return {
    schemaVersion: "visual-hive.playwright-repair-capture-result.v1",
    reused: false,
    phase: options.phase,
    requestId: options.brokerRequest.requestId,
    requestDigest: options.brokerRequest.requestDigest,
    commitSha: options.brokerRequest.commitSha,
    captureStatus: "failed",
    exitCode: 1,
    receiptDigest: sha("f"),
    runDirectory: `.visual-hive/repair/runs/${options.brokerRequest.requestId}`,
    reportPath: "report.json",
    runContextPath: "run-context.json",
    runtimeIdentityPath: "runtime.json",
    metadataPath: "metadata.json",
    completionPath: "capture-result.json",
    bundleManifestPath: "bundle/manifest.json",
    bundleDirectory: "bundle",
    artifactPaths: [],
    report: {} as PlaywrightRepairCaptureResult["report"],
    runContext: { runContextDigest, report: { sha256: reportSha256 }, evidenceAssets: [] } as PlaywrightRepairCaptureResult["runContext"],
    bundleManifest: { overallDigest: sha("0") } as PlaywrightRepairCaptureResult["bundleManifest"]
  };
}

function taskInput(image: Buffer): VisualHiveTaskContextInput {
  const repository = "owner/repo";
  const repositoryId = "42";
  const profileBody = {
    profileId: "profile.repair",
    targetId: "target.app",
    requestKinds: ["reproduction", "capture", "patch_validation"] as const,
    contractIds: ["contract.card"],
    routes: ["/"],
    scenarioIds: ["default"],
    viewports: [{ viewportId: "desktop", width: 2, height: 2, deviceScaleFactor: 1 }],
    validationCommandId: "command.playwright"
  };
  const files = [{ path: "src/App.tsx", sha256: sha("8"), size: 200, classification: "source" as const }];
  return {
    schemaVersion: "visual-hive.task-context.v1",
    digestAlgorithm: "visual-hive.canonical-json.sha256.v1",
    generatedAt: "2026-07-14T15:00:00.000Z",
    taskId: "task.card",
    repository: { name: repository, repositoryId, repositoryFingerprint: computeVisualRepositoryFingerprint(repository, repositoryId), baseSha: commit("a") },
    issue: { source: "fixture", externalId: "fixture-1", title: "Repair the card", problemStatement: "Match the card to the supplied reference image.", problemStatementSha256: sha256Utf8("Match the card to the supplied reference image.") },
    assets: [{ assetId: "asset.reference", role: "reference", path: "assets/reference.png", mediaType: "image/png", sha256: sha256Bytes(image), size: image.byteLength, width: 2, height: 2, provenance: { kind: "fixture", sourceId: "reference" }, regions: [] }],
    imageReferences: [{ position: 0, assetId: "asset.reference", role: "reference" }],
    graphCandidates: [{ nodeId: "component.card", kind: "component", label: "Card", score: 1, reasons: ["Reference image"], sourceSpans: [{ path: "src/App.tsx", startLine: 1, endLine: 20 }] }],
    profiles: [{ ...profileBody, requestKinds: [...profileBody.requestKinds], profileDigest: computeVisualValidationProfileDigest({ ...profileBody, requestKinds: [...profileBody.requestKinds] }) }],
    obligations: [{ obligationId: "obligation.card", description: "Card matches reference", sourceAssetIds: ["asset.reference"], mappedContractIds: ["contract.card"], route: "/", state: "default", viewportId: "desktop", assertionKind: "pixel_region", authority: "deterministic", confidence: 1, status: "mapped" }],
    sourceContext: { digest: canonicalSha256({ files, omittedPaths: 0, truncated: false }), files, omittedPaths: 0, truncated: false }
  };
}

function png(red: number, green: number, blue: number): Buffer {
  const image = new PNG({ width: 2, height: 2 });
  for (let offset = 0; offset < image.data.length; offset += 4) {
    image.data[offset] = red;
    image.data[offset + 1] = green;
    image.data[offset + 2] = blue;
    image.data[offset + 3] = 255;
  }
  return PNG.sync.write(image);
}

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), `visual-hive-${prefix}-`));
  roots.push(root);
  return root;
}

async function validationFixture(): Promise<{
  root: string;
  storeRoot: string;
  options: Parameters<typeof runRepairValidateCommand>[0];
}> {
  const fixture = await taskFixture();
  const repair = buildTestRepairSession(fixture.task, {
    findingFingerprint: "issue.card",
    validationToolRegistryDigest: canonicalSha256("tools-v1")
  });
  const attempt = repair.session.attempts[0]!;
  const headSha = repair.patchValidationRequest.commitSha;
  const hiveResult = buildHiveRepairResult({
    schemaVersion: "hive.repair-result.v1",
    digestAlgorithm: "hive.canonical-json.sha256.v1",
    generatedAt: "2026-07-14T16:10:00.000Z",
    sessionId: repair.session.sessionId,
    sessionDigest: repair.session.sessionDigest,
    transcriptDigest: repair.session.transcriptDigest,
    effectiveMode: "visual_hive",
    taskId: fixture.task.taskId,
    taskContextDigest: fixture.task.contextDigest,
    repository: {
      name: fixture.task.repository.name,
      repositoryId: fixture.task.repository.repositoryId,
      repositoryFingerprint: fixture.task.repository.repositoryFingerprint
    },
    finding: repair.session.finding,
    baseSha: fixture.task.repository.baseSha,
    baseTreeSha: repair.session.repository.baseTreeSha,
    headSha,
    headTreeSha: attempt.candidateHeadTreeSha!,
    diff: {
      algorithm: "git.diff.binary.sha256.v1",
      sha256: attempt.candidatePatchDigest!,
      changedFiles: [{
        path: "src/App.tsx",
        status: "modified",
        beforeSha256: sha("8"),
        afterSha256: sha("9"),
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
      completedAt: attempt.completedAt!,
      turnCount: attempt.turnIds.length,
      toolCallCount: repair.session.toolReceipts.length
    }],
    toolReceipts: repair.session.toolReceipts,
    authorizationDigest: repair.authorization.authorizationDigest,
    validationRequests: [repair.reproductionRequest, repair.patchValidationRequest],
    claimedOutcome: { summary: "Repaired the deterministic card rendering.", advisory: true },
    status: "candidate"
  });
  const beforeRoot = path.join(fixture.root, "before");
  const afterRoot = path.join(fixture.root, "after");
  await Promise.all([mkdir(beforeRoot), mkdir(afterRoot)]);
  const before = await writeValidationRun({
    root: beforeRoot,
    phase: "before",
    task: fixture.task,
    repair,
    commitSha: fixture.task.repository.baseSha,
    request: repair.reproductionRequest,
    image: png(240, 20, 20)
  });
  const after = await writeValidationRun({
    root: afterRoot,
    phase: "after",
    task: fixture.task,
    repair,
    commitSha: headSha,
    request: repair.patchValidationRequest,
    image: png(20, 220, 40)
  });
  const taskPath = path.join(fixture.root, "validation-task.json");
  const sessionPath = path.join(fixture.root, "validation-session.json");
  const resultPath = path.join(fixture.root, "validation-result.json");
  await Promise.all([
    writeFile(taskPath, `${JSON.stringify(fixture.task)}\n`),
    writeFile(sessionPath, `${JSON.stringify(repair.session)}\n`),
    writeFile(resultPath, `${JSON.stringify(hiveResult)}\n`)
  ]);
  return {
    root: fixture.root,
    storeRoot: fixture.storeRoot,
    options: {
      storeRoot: fixture.storeRoot,
      taskContext: taskPath,
      hiveSession: sessionPath,
      hiveResult: resultPath,
      beforeBundle: before.bundleRoot,
      beforeRunContext: before.runContextPath,
      afterBundle: after.bundleRoot,
      afterRunContext: after.runContextPath,
      validationId: "validation.card",
      now: () => new Date("2026-07-14T16:30:00.000Z")
    }
  };
}

async function writeValidationRun(input: {
  root: string;
  phase: "before" | "after";
  task: ReturnType<typeof buildVisualHiveTaskContext>;
  repair: ReturnType<typeof buildTestRepairSession>;
  commitSha: string;
  request: ReturnType<typeof buildTestRepairSession>["reproductionRequest"];
  image: Buffer;
}): Promise<{ bundleRoot: string; runContextPath: string }> {
  const failed = input.phase === "before";
  const generatedAt = failed ? "2026-07-14T16:02:00.000Z" : "2026-07-14T16:21:00.000Z";
  const startedAt = failed ? "2026-07-14T16:01:00.000Z" : "2026-07-14T16:20:00.000Z";
  const reportPath = ".visual-hive/report.json";
  const runContextPath = ".visual-hive/repair/run-context.json";
  const imagePath = ".visual-hive/results/card-actual.png";
  const baselinePath = ".visual-hive/baselines/card.png";
  const diffPath = ".visual-hive/results/card-diff.png";
  const baseline = png(20, 220, 40);
  const comparison = compareVisualPngBytes(baseline, input.image);
  const screenshot = {
    contractId: "contract.card",
    screenshotName: "card",
    name: "card",
    route: "/",
    viewport: "desktop",
    status: failed ? "failed" : "passed",
    baselinePath,
    actualPath: imagePath,
    ...(failed ? { diffPath } : {}),
    actualDiffPixelRatio: failed ? 1 : 0,
    actualDiffPixels: failed ? 4 : 0,
    diffPixels: failed ? 4 : 0,
    maxDiffPixelRatio: 0.01,
    totalPixels: 4
  };
  const report = {
    schemaVersion: 2,
    project: "repair-cli",
    repository: { provider: "local", repository: input.task.repository.name, commitSha: input.commitSha },
    mode: "full",
    generatedAt,
    status: failed ? "failed" : "passed",
    changedFiles: [],
    selectedTargets: [{ id: "target.app", kind: "url", url: "http://127.0.0.1:4173", prSafe: true, cost: "cheap" }],
    selectedContracts: ["contract.card"],
    excludedContracts: [],
    targetLifecycle: [],
    generatedSpecPath: ".visual-hive/generated.spec.ts",
    executionBinding,
    results: [{
      contractId: "contract.card",
      targetId: "target.app",
      status: failed ? "failed" : "passed",
      durationMs: 100,
      errors: failed ? ["Card screenshot differs"] : [],
      artifacts: [imagePath],
      screenshotAssertions: [screenshot]
    }],
    summary: {
      passed: failed ? 0 : 1,
      failed: failed ? 1 : 0,
      screenshotsPassed: failed ? 0 : 1,
      screenshotsFailed: failed ? 1 : 0,
      baselinesCreated: 0,
      createdBaselines: 0,
      missingBaselines: 0,
      visualDiffs: failed ? 1 : 0,
      consoleErrors: 0,
      pageErrors: 0,
      flowStepsPassed: 0,
      flowStepsFailed: 0
    },
    consoleErrors: [],
    pageErrors: [],
    artifacts: [imagePath],
    reproductionCommands: ["visual-hive repair capture"]
  };
  const reportBytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`);
  await Promise.all([
    writeFixtureArtifact(input.root, reportPath, reportBytes),
    writeFixtureArtifact(input.root, imagePath, input.image),
    writeFixtureArtifact(input.root, baselinePath, baseline),
    ...(failed ? [writeFixtureArtifact(input.root, diffPath, comparison.diffPng)] : [])
  ]);
  const profile = input.task.profiles[0]!;
  const cases = [{
    caseId: "case.card",
    targetId: profile.targetId,
    route: "/",
    state: "default",
    viewport: { viewportId: "desktop", width: 2, height: 2, deviceScaleFactor: 1 },
    contractIds: ["contract.card"]
  }];
  const thresholds = [{ contractId: "contract.card", maxDiffPixelRatio: 0.01, missingBaseline: "fail" as const }];
  const runContext = buildVisualRunContext({
    schemaVersion: "visual-hive.run-context.v1",
    digestAlgorithm: "visual-hive.canonical-json.sha256.v1",
    generatedAt,
    runId: failed ? "run.before.card" : "run.after.card",
    phase: input.phase,
    taskId: input.task.taskId,
    taskContextDigest: input.task.contextDigest,
    findingFingerprint: input.repair.session.finding.fingerprint,
    repository: {
      name: input.task.repository.name,
      repositoryId: input.task.repository.repositoryId,
      repositoryFingerprint: input.task.repository.repositoryFingerprint,
      commitSha: input.commitSha
    },
    brokerRequest: { requestId: input.request.requestId, requestDigest: input.request.requestDigest },
    execution: {
      commitSha: input.commitSha,
      profileId: profile.profileId,
      profileDigest: profile.profileDigest,
      configDigest: input.repair.authorization.configDigest,
      validationPolicyDigest: computeVisualValidationPolicyDigest(profile.validationCommandId, thresholds),
      contractInventoryDigest: canonicalSha256(["contract.card"]),
      planDigest: sha("a"),
      testPlanDigest: canonicalSha256("plan-v1"),
      toolRegistryDigest: canonicalSha256("tools-v1"),
      baselineIdentityDigest: canonicalSha256([{ path: baselinePath, sha256: sha256Bytes(baseline), size: baseline.byteLength }]),
      executionMatrixDigest: canonicalSha256(cases),
      browser: { name: "chromium", version: "130.0" },
      environment: {
        os: "windows",
        architecture: "x64",
        nodeVersion: "22.13.1",
        playwrightVersion: "1.54.1",
        fontManifestDigest: sha("d"),
        locale: "en-US",
        timezone: "UTC"
      },
      cases
    },
    producer: {
      visualHiveVersion: input.repair.session.capability.visualHiveVersion!,
      visualHiveCommit: input.repair.session.capability.visualHiveCommit!,
      manifestSha256: input.repair.session.capability.visualHiveManifestSha256!,
      entrypointSha256: input.repair.session.capability.visualHiveEntrypointSha256!,
      playwrightVersion: "1.54.1"
    },
    command: {
      validationCommandId: profile.validationCommandId,
      startedAt,
      completedAt: generatedAt,
      exitCode: failed ? 1 : 0,
      executionBinding
    },
    report: { path: reportPath, sha256: sha256Bytes(reportBytes) },
    evidenceAssets: [{
      assetId: failed ? "asset.before.actual" : "asset.after.actual",
      role: "actual",
      path: imagePath,
      mediaType: "image/png",
      sha256: sha256Bytes(input.image),
      size: input.image.byteLength,
      width: 2,
      height: 2,
      assertion: { contractId: "contract.card", screenshotName: "card", route: "/", state: "default", viewportId: "desktop" },
      obligationIds: ["obligation.card"]
    }, {
      assetId: failed ? "asset.before.baseline" : "asset.after.baseline",
      role: "baseline",
      path: baselinePath,
      mediaType: "image/png",
      sha256: sha256Bytes(baseline),
      size: baseline.byteLength,
      width: 2,
      height: 2,
      assertion: { contractId: "contract.card", screenshotName: "card", route: "/", state: "default", viewportId: "desktop" },
      obligationIds: ["obligation.card"]
    }, ...(failed ? [{
      assetId: "asset.before.diff",
      role: "diff" as const,
      path: diffPath,
      mediaType: "image/png" as const,
      sha256: sha256Bytes(comparison.diffPng),
      size: comparison.diffPng.byteLength,
      width: 2,
      height: 2,
      assertion: { contractId: "contract.card", screenshotName: "card", route: "/", state: "default", viewportId: "desktop" },
      obligationIds: ["obligation.card"]
    }] : [])],
    thresholds,
    capture: failed ? { status: "failed", failures: ["Card screenshot differs"] } : { status: "passed", failures: [] }
  });
  const runContextBytes = Buffer.from(`${JSON.stringify(runContext, null, 2)}\n`);
  await writeFixtureArtifact(input.root, runContextPath, runContextBytes);
  const finding = input.repair.session.finding;
  const bundle = await writeVisualHiveBundle({
    rootDir: input.root,
    project: "repair-cli",
    mode: "full",
    verdict: report.status,
    acmmRequest: 5,
    artifacts: [reportPath, runContextPath, imagePath, baselinePath, ...(failed ? [diffPath] : [])],
    source: {
      repository: input.task.repository.name,
      repositoryId: input.task.repository.repositoryId,
      ref: "refs/heads/main",
      commitSha: input.commitSha,
      event: "local",
      conclusion: report.status,
      trusted: false
    },
    scan: {
      scope: "full",
      authoritativeForResolution: true,
      evaluatedContracts: ["contract.card"],
      evaluatedFiles: ["src/App.tsx"],
      testPlanVersion: "plan-v1",
      toolRegistryVersion: "tools-v1"
    },
    observations: [{
      fingerprint: finding.fingerprint,
      repositoryFingerprint: visualHiveObservationRepositoryFingerprint(input.task.repository.name, finding.fingerprint, finding.publicationRole, finding.rootCauseKey),
      publicationRole: finding.publicationRole,
      rootCauseKey: finding.rootCauseKey,
      blockedByRootKeys: [],
      state: failed ? "present" : "absent",
      issueKind: "visual_regression",
      severity: "high",
      owningAgentHint: "hive/quality",
      title: "Card screenshot regression",
      body: "The card rendering differs from its deterministic expectation.",
      labels: ["visual-hive"],
      sourceArtifacts: [reportPath, imagePath],
      affectedContracts: ["contract.card"],
      validationCommand: profile.validationCommandId,
      observedAt: generatedAt,
      firstSeenAt: "2026-07-14T15:00:00.000Z",
      sourceArtifact: reportPath
    }],
    producerVersion: input.repair.session.capability.visualHiveVersion!,
    producerGitCommit: input.repair.session.capability.visualHiveCommit!,
    bundleId: failed ? "bundle.before.card" : "bundle.after.card",
    now: new Date(generatedAt)
  });
  return {
    bundleRoot: path.join(input.root, ...bundle.bundleDir.split("/")),
    runContextPath
  };
}

async function writeFixtureArtifact(root: string, relativePath: string, bytes: Uint8Array): Promise<void> {
  const destination = path.join(root, ...relativePath.split("/"));
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, bytes);
}

function producerFor(session: HiveRepairSession) {
  return {
    identityKind: "verified_release_manifest" as const,
    visualHiveVersion: session.capability.visualHiveVersion!,
    visualHiveCommit: session.capability.visualHiveCommit!,
    manifestSha256: session.capability.visualHiveManifestSha256!,
    entrypointSha256: session.capability.visualHiveEntrypointSha256!
  };
}
