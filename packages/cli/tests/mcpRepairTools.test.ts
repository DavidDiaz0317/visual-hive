import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  buildVisualHiveTaskContext,
  buildVisualRunContext,
  canonicalSha256,
  computeVisualRepositoryFingerprint,
  computeVisualValidationPolicyDigest,
  computeVisualValidationProfileDigest,
  sha256Bytes,
  sha256Utf8,
  visualRepairSessionRelativeRoot,
  writeVisualHiveBundle,
  type VisualHiveTaskContext,
  type HiveRepairSession,
  type HiveRepairValidationRequestSpec,
  type VisualRepairValidation,
  type VisualRunContext
} from "@visual-hive/core";
import { PNG } from "pngjs";
import { afterEach, describe, expect, it } from "vitest";
import { buildVisualRepairValidation } from "../../core/src/repair/build.js";
import { createRepairMcpServer } from "../src/commands/repairMcp.js";
import { buildTestRepairSession } from "./repairTestSession.js";

const roots: string[] = [];
const commit = (value: string): string => value.repeat(40);
const digest = (value: string): string => value.repeat(64);
const executionBinding = {
  nonceSha256: digest("1"),
  generatedSpecSha256: digest("2"),
  generatedConfigSha256: digest("3"),
  payloadSha256: digest("4"),
  bindingMacSha256: digest("5")
};
const repairClock = { now: () => new Date("2026-07-14T16:10:00.000Z") };

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("parameterized Visual Hive repair MCP tools", () => {
  it("exposes exact schemas and returns identity-bound multimodal evidence", async () => {
    const fixture = await createFixture();
    const producer = producerFor(fixture.session);
    const server = createRepairMcpServer(fixture.root, fixture.session, producer, repairClock);
    const client = new Client({ name: "repair-tool-test", version: "1" }, { capabilities: {} });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      const tools = await client.listTools(undefined, { timeout: 10_000 });
      const required = [
        "visual_hive_get_task_context",
        "visual_hive_get_issue_context",
        "visual_hive_search_surface",
        "visual_hive_get_visual_asset",
        "visual_hive_get_screenshot_set",
        "visual_hive_get_browser_evidence",
        "visual_hive_compare_assets",
        "visual_hive_get_repair_validation"
      ];
      for (const name of required) {
        const tool = tools.tools.find((candidate) => candidate.name === name);
        expect(tool, name).toBeDefined();
        expect(tool?.inputSchema.required, name).toContain("taskId");
        expect(tool?.inputSchema.required, name).toContain("repository");
        expect(tool?.inputSchema.required, name).toContain("taskContextDigest");
      }

      const common = {
        taskId: fixture.task.taskId,
        repository: fixture.task.repository.name,
        taskContextDigest: fixture.task.contextDigest
      };
      const taskResult = await client.callTool({
        name: "visual_hive_get_task_context",
        arguments: { ...common, baseSha: fixture.task.repository.baseSha, section: "summary" }
      }, undefined, { timeout: 10_000 });
      const taskEnvelope = JSON.parse(textOf(taskResult));
      expect(taskEnvelope.binding).toMatchObject({
        sessionId: fixture.session.sessionId,
        sessionDigest: fixture.session.sessionDigest,
        authorizationDigest: fixture.session.authorization!.authorizationDigest,
        visualHiveVersion: producer.visualHiveVersion,
        visualHiveCommit: producer.visualHiveCommit,
        visualHiveManifestSha256: producer.manifestSha256,
        visualHiveEntrypointSha256: producer.entrypointSha256
      });
      expect(textOf(taskResult)).toContain(fixture.task.contextDigest);
      expect(textOf(taskResult)).toContain("sessionStorageId");

      const issueResult = await client.callTool({
        name: "visual_hive_get_issue_context",
        arguments: { ...common, issueFingerprint: "issue.target" }
      }, undefined, { timeout: 10_000 });
      expect(textOf(issueResult)).toContain("Target issue");
      expect(textOf(issueResult)).not.toContain("First unrelated issue");

      const searchResult = await client.callTool({
        name: "visual_hive_search_surface",
        arguments: { ...common, query: "responsive card" }
      }, undefined, { timeout: 10_000 });
      expect(textOf(searchResult)).toContain("component.card");

      const assetResult = await client.callTool({
        name: "visual_hive_get_visual_asset",
        arguments: { ...common, assetId: "asset.expected" }
      }, undefined, { timeout: 10_000 });
      expect(imagesOf(assetResult)).toEqual([{ data: fixture.expected.toString("base64"), mimeType: "image/png" }]);

      const runIdentity = {
        runId: fixture.run.runId,
        runContextDigest: fixture.run.runContextDigest,
        commitSha: fixture.run.repository.commitSha,
        contractId: "contract.card"
      };
      expect(fixture.run.report.path).toMatch(/^\.visual-hive\/repair\/sessions\/[^/]+\/runs\/run\.[^/]+\/report\.json$/);
      expect(fixture.run.evidenceAssets.every((asset) => asset.path.startsWith(".visual-hive/repair/sessions/"))).toBe(true);
      const screenshots = await client.callTool({
        name: "visual_hive_get_screenshot_set",
        arguments: {
          ...common,
          ...runIdentity,
          screenshotName: "Card desktop state",
          route: "/",
          state: "default",
          viewportId: "viewport.desktop"
        }
      }, undefined, { timeout: 10_000 });
      const screenshotEnvelope = JSON.parse(textOf(screenshots));
      expect(screenshotEnvelope.assets.map((asset: { role: string }) => asset.role)).toEqual(["baseline", "actual", "diff"]);
      const captureReceiptDigest = fixture.session.validationRequests.find((request) => request.requestId === fixture.run.brokerRequest?.requestId)?.receiptDigest;
      expect(captureReceiptDigest).toBeDefined();
      expect(screenshotEnvelope.binding.captureReceiptDigest).toBe(captureReceiptDigest);
      expect(imagesOf(screenshots)).toHaveLength(3);

      const browser = await client.callTool({
        name: "visual_hive_get_browser_evidence",
        arguments: { ...common, ...runIdentity }
      }, undefined, { timeout: 10_000 });
      expect(textOf(browser)).toContain("chromium");
      expect(textOf(browser)).toContain("selectorAssertions");
      expect(imagesOf(browser)).not.toHaveLength(0);
      expect(JSON.parse(textOf(browser)).binding.captureReceiptDigest).toBe(captureReceiptDigest);

      const comparison = await client.callTool({
        name: "visual_hive_compare_assets",
        arguments: {
          ...common,
          before: { source: "task", assetId: "asset.expected" },
          after: { source: "task", assetId: "asset.current" }
        }
      }, undefined, { timeout: 10_000 });
      const comparisonText = JSON.parse(textOf(comparison));
      expect(comparisonText.comparison.diffPixels).toBeGreaterThan(0);
      expect(comparisonText.comparison.algorithm).toContain("pixelmatch.v7");
      expect(imagesOf(comparison)).toHaveLength(1);

      const runComparison = await client.callTool({
        name: "visual_hive_compare_assets",
        arguments: {
          ...common,
          before: { source: "task", assetId: "asset.expected" },
          after: {
            source: "run",
            runId: fixture.run.runId,
            runContextDigest: fixture.run.runContextDigest,
            commitSha: fixture.run.repository.commitSha,
            assetId: "asset.run.actual"
          }
        }
      }, undefined, { timeout: 10_000 });
      expect(JSON.parse(textOf(runComparison)).binding.verifiedCaptureReceipts).toEqual([{
        runId: fixture.run.runId,
        receiptDigest: captureReceiptDigest
      }]);

      const validation = await client.callTool({
        name: "visual_hive_get_repair_validation",
        arguments: {
          ...common,
          validationId: fixture.validation.validationId,
          findingFingerprint: fixture.validation.findingFingerprint,
          headSha: fixture.validation.headSha,
          receiptDigest: fixture.validation.receiptDigest
        }
      }, undefined, { timeout: 10_000 });
      expect(textOf(validation)).toContain("resolved_candidate");
      expect(textOf(validation)).toContain(fixture.validation.receiptDigest);

      const staleRun = await client.callTool({
        name: "visual_hive_get_browser_evidence",
        arguments: { ...common, ...runIdentity, runContextDigest: digest("f") }
      }, undefined, { timeout: 10_000 });
      expect(staleRun.isError).toBe(true);
      expect(textOf(staleRun)).toContain("digest does not match");

      const crossRepository = await client.callTool({
        name: "visual_hive_get_visual_asset",
        arguments: { ...common, repository: "owner/other", assetId: "asset.expected" }
      }, undefined, { timeout: 10_000 });
      expect(crossRepository.isError).toBe(true);

      const malformed = await client.callTool({
        name: "visual_hive_get_visual_asset",
        arguments: { ...common, assetId: "asset.expected", unexpected: true }
      }, undefined, { timeout: 10_000 });
      expect(malformed.isError).toBe(true);
      expect(textOf(malformed)).toContain("Input validation error");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("projects unequal image dimensions and deterministic changed bounds", async () => {
    const fixture = await createFixture({
      expected: makePng(10, 20, 30, 2, 2),
      current: makePng(220, 30, 40, 3, 1)
    });
    const server = createRepairMcpServer(fixture.root, fixture.session, producerFor(fixture.session), repairClock);
    const client = new Client({ name: "repair-tool-dimension-diagnostic-test", version: "1" }, { capabilities: {} });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      const result = await client.callTool({
        name: "visual_hive_compare_assets",
        arguments: {
          taskId: fixture.task.taskId,
          repository: fixture.task.repository.name,
          taskContextDigest: fixture.task.contextDigest,
          before: { source: "task", assetId: "asset.expected" },
          after: { source: "task", assetId: "asset.current" }
        }
      }, undefined, { timeout: 10_000 });

      const envelope = JSON.parse(textOf(result));
      expect(envelope.comparison).toMatchObject({
        width: 3,
        height: 2,
        beforeDimensions: { width: 2, height: 2 },
        afterDimensions: { width: 3, height: 1 },
        changedBoundingBox: { x: 0, y: 0, width: 3, height: 2 },
        diffPixels: 6,
        totalPixels: 6,
        diffRatio: 1
      });
      const diff = PNG.sync.read(Buffer.from(imagesOf(result)[0]!.data, "base64"));
      expect(diff.width).toBe(3);
      expect(diff.height).toBe(2);
      expect(Array.from(diff.data).some((value, index) => index % 4 === 3 && value > 0)).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("rejects run evidence whose release-artifact hashes differ from the verified MCP producer", async () => {
    const fixture = await createFixture();
    const producer = producerFor(fixture.session);
    const server = createRepairMcpServer(fixture.root, fixture.session, producer, repairClock);
    const client = new Client({ name: "repair-tool-producer-pin-test", version: "1" }, { capabilities: {} });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const sessionRoot = path.join(fixture.root, ...visualRepairSessionRelativeRoot({
      taskId: fixture.task.taskId,
      repository: fixture.task.repository.name,
      taskContextDigest: fixture.task.contextDigest
    }).split("/"));
    const { runContextDigest: _runContextDigest, ...runInput } = fixture.run;
    void _runContextDigest;
    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      for (const producerOverride of [
        { manifestSha256: digest("f") },
        { entrypointSha256: digest("e") }
      ]) {
        const mismatched = buildVisualRunContext({
          ...structuredClone(runInput),
          producer: { ...runInput.producer, ...producerOverride }
        });
        await writeJsonFile(path.join(sessionRoot, "runs", mismatched.runId, "run-context.json"), mismatched);
        const result = await client.callTool({
          name: "visual_hive_get_browser_evidence",
          arguments: {
            taskId: fixture.task.taskId,
            repository: fixture.task.repository.name,
            taskContextDigest: fixture.task.contextDigest,
            runId: mismatched.runId,
            runContextDigest: mismatched.runContextDigest,
            commitSha: mismatched.repository.commitSha,
            contractId: "contract.card"
          }
        }, undefined, { timeout: 10_000 });
        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain("producer or validation-tool identity does not match");
      }
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("denies requested, started, and failed Hive validation requests even when run files already exist", async () => {
    const fixture = await createFixture();
    for (const state of ["requested", "started", "failed"] as const) {
      const session = buildTestRepairSession(fixture.task, { ...repairSessionOptions(), reproductionState: state }).session;
      const server = createRepairMcpServer(fixture.root, session, producerFor(session), repairClock);
      const client = new Client({ name: `repair-tool-${state}-completion-gate-test`, version: "1" }, { capabilities: {} });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      try {
        await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
        const result = await client.callTool({
          name: "visual_hive_get_browser_evidence",
          arguments: {
            taskId: fixture.task.taskId,
            repository: fixture.task.repository.name,
            taskContextDigest: fixture.task.contextDigest,
            runId: fixture.run.runId,
            runContextDigest: fixture.run.runContextDigest,
            commitSha: fixture.run.repository.commitSha,
            contractId: "contract.card"
          }
        }, undefined, { timeout: 10_000 });
        expect(result.isError, state).toBe(true);
        expect(textOf(result), state).toContain(`validation request is ${state}`);
        expect(textOf(result), state).toContain("requires a completed request receipt");
      } finally {
        await client.close();
        await server.close();
      }
    }
  });

  it("rejects missing or altered completion, run-context, manifest, and bundle payload evidence", async () => {
    const missingCompletion = await createFixture();
    await rm(path.join(missingCompletion.root, ...missingCompletion.completionPath.split("/")));
    expect((await invokeBrowserEvidence(missingCompletion)).isError).toBe(true);

    const alteredCompletion = await createFixture();
    const completionAbsolute = path.join(alteredCompletion.root, ...alteredCompletion.completionPath.split("/"));
    const completion = JSON.parse(await readFile(completionAbsolute, "utf8")) as Record<string, unknown>;
    completion.receiptDigest = digest("f");
    await writeJsonFile(completionAbsolute, completion);
    const completionResult = await invokeBrowserEvidence(alteredCompletion);
    expect(completionResult.isError).toBe(true);
    expect(textOf(completionResult)).toContain("capture result receipt digest is invalid");

    const alteredRun = await createFixture();
    const runContextPath = path.join(alteredRun.root, ...path.posix.join(path.posix.dirname(alteredRun.run.report.path), "run-context.json").split("/"));
    const runContext = JSON.parse(await readFile(runContextPath, "utf8")) as Record<string, unknown>;
    runContext.runContextDigest = digest("f");
    await writeJsonFile(runContextPath, runContext);
    expect((await invokeBrowserEvidence(alteredRun)).isError).toBe(true);

    const alteredManifest = await createFixture();
    const manifestPath = path.join(alteredManifest.root, ...`${alteredManifest.bundleDirectory}/manifest.json`.split("/"));
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    manifest.verdict = "tampered";
    await writeJsonFile(manifestPath, manifest);
    const manifestResult = await invokeBrowserEvidence(alteredManifest);
    expect(manifestResult.isError).toBe(true);
    expect(textOf(manifestResult)).toContain("bundle manifest digest is invalid");

    const alteredPayload = await createFixture();
    const payloadManifestPath = path.join(alteredPayload.root, ...`${alteredPayload.bundleDirectory}/manifest.json`.split("/"));
    const payloadManifest = JSON.parse(await readFile(payloadManifestPath, "utf8")) as { files: Array<{ path: string }> };
    await writeFile(path.join(alteredPayload.root, ...alteredPayload.bundleDirectory.split("/"), ...payloadManifest.files[0]!.path.split("/")), "tampered", "utf8");
    const payloadResult = await invokeBrowserEvidence(alteredPayload);
    expect(payloadResult.isError).toBe(true);
    expect(textOf(payloadResult)).toContain("bundle payload digest is invalid");
  });

  it("preserves declared task-image order, captions, and content retrieval arguments", async () => {
    const fixture = await createFixture();
    const server = createRepairMcpServer(fixture.root, fixture.session, producerFor(fixture.session), repairClock);
    const client = new Client({ name: "repair-tool-image-order-test", version: "1" }, { capabilities: {} });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      const response = await client.callTool({
        name: "visual_hive_get_task_context",
        arguments: {
          taskId: fixture.task.taskId,
          repository: fixture.task.repository.name,
          taskContextDigest: fixture.task.contextDigest,
          baseSha: fixture.task.repository.baseSha,
          section: "assets"
        }
      }, undefined, { timeout: 10_000 });
      const assets = JSON.parse(textOf(response)).result.assets as Array<{
        position: number;
        assetId: string;
        caption: string;
        asset: { assetId: string };
        retrieval: { tool: string; arguments: Record<string, string> };
      }>;

      expect(fixture.task.assets.map((asset) => asset.assetId)).toEqual(["asset.current", "asset.expected"]);
      expect(assets.map(({ position, assetId, caption }) => ({ position, assetId, caption }))).toEqual([
        { position: 0, assetId: "asset.expected", caption: "Expected card appearance from the issue." },
        { position: 1, assetId: "asset.current", caption: "Current broken card appearance from the issue." }
      ]);
      for (const entry of assets) {
        expect(entry.asset.assetId).toBe(entry.assetId);
        expect(entry.retrieval).toEqual({
          tool: "visual_hive_get_visual_asset",
          arguments: {
            taskId: fixture.task.taskId,
            repository: fixture.task.repository.name,
            taskContextDigest: fixture.task.contextDigest,
            assetId: entry.assetId
          }
        });
      }
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("keeps late browser failures visible in bounded failure-first summaries", async () => {
    const fixture = await createFixture();
    const screenshotAssertions = [
      ...Array.from({ length: 65 }, (_, index) => ({ screenshotName: `passing-${index}`, status: "passed" })),
      { screenshotName: "late-failure", status: "failed", message: "Mismatch after many passing screenshots." }
    ];
    const report = {
      schemaVersion: 2,
      project: "repair-mcp",
      repository: { provider: "local", repository: fixture.task.repository.name, commitSha: fixture.task.repository.baseSha },
      selectedContracts: ["contract.card"],
      results: [{
        contractId: "contract.card",
        targetId: "target.app",
        status: "failed",
        durationMs: 25,
        errors: ["Late screenshot mismatch"],
        selectorAssertions: [],
        screenshotAssertions
      }]
    };
    const reportBytes = Buffer.from(JSON.stringify(report), "utf8");
    const { runContextDigest: _runContextDigest, ...runInput } = fixture.run;
    void _runContextDigest;
    const run = buildVisualRunContext({
      ...structuredClone(runInput),
      report: { ...runInput.report, sha256: sha256Bytes(reportBytes) }
    });
    await writeFile(path.join(fixture.root, ...run.report.path.split("/")), reportBytes);
    const sessionRoot = path.join(fixture.root, ...visualRepairSessionRelativeRoot({
      taskId: fixture.task.taskId,
      repository: fixture.task.repository.name,
      taskContextDigest: fixture.task.contextDigest
    }).split("/"));
    await writeJsonFile(path.join(sessionRoot, "runs", run.runId, "run-context.json"), run);
    const completed = await writeCompletedCaptureFixture(fixture.root, fixture.task, run);

    const server = createRepairMcpServer(fixture.root, completed.session, producerFor(completed.session), repairClock);
    const client = new Client({ name: "repair-tool-failure-first-test", version: "1" }, { capabilities: {} });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      const response = await client.callTool({
        name: "visual_hive_get_browser_evidence",
        arguments: {
          taskId: fixture.task.taskId,
          repository: fixture.task.repository.name,
          taskContextDigest: fixture.task.contextDigest,
          runId: run.runId,
          runContextDigest: run.runContextDigest,
          commitSha: run.repository.commitSha,
          contractId: "contract.card",
          includeImages: false
        }
      }, undefined, { timeout: 10_000 });
      const result = JSON.parse(textOf(response)).result as {
        screenshotAssertions: Array<{ screenshotName: string; status: string }>;
        arrayCounts: { screenshotAssertions: { total: number; returned: number; omitted: number } };
      };

      expect(result.screenshotAssertions).toHaveLength(64);
      expect(result.screenshotAssertions[0]).toMatchObject({ screenshotName: "late-failure", status: "failed" });
      expect(result.arrayCounts.screenshotAssertions).toEqual({ total: 66, returned: 64, omitted: 2 });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("indexes every multi-state evidence tuple independently from bounded image content", async () => {
    const fixture = await createFixture();
    const extraImage = makePng(70, 80, 90);
    const runRoot = path.posix.dirname(fixture.run.report.path);
    const extraAssets = [
      { assetId: "asset.run.hover.baseline", role: "baseline" as const, state: "hover" },
      { assetId: "asset.run.hover.actual", role: "actual" as const, state: "hover" },
      { assetId: "asset.run.hover.diff", role: "diff" as const, state: "hover" },
      { assetId: "asset.run.expanded.actual", role: "actual" as const, state: "expanded" },
      { assetId: "asset.run.expanded.diff", role: "diff" as const, state: "expanded" }
    ].map(({ assetId, role, state }) => ({
      assetId,
      role,
      path: `${runRoot}/assets/${assetId}.png`,
      mediaType: "image/png" as const,
      sha256: sha256Bytes(extraImage),
      size: extraImage.length,
      width: 2,
      height: 2,
      assertion: {
        contractId: "contract.card",
        screenshotName: "Card desktop state",
        route: "/",
        state,
        viewportId: "viewport.desktop"
      },
      obligationIds: ["obligation.card"]
    }));
    for (const asset of extraAssets) {
      await mkdir(path.dirname(path.join(fixture.root, ...asset.path.split("/"))), { recursive: true });
      await writeFile(path.join(fixture.root, ...asset.path.split("/")), extraImage);
    }
    const { runContextDigest: _runContextDigest, ...runInput } = fixture.run;
    void _runContextDigest;
    const run = buildVisualRunContext({ ...structuredClone(runInput), evidenceAssets: [...runInput.evidenceAssets, ...extraAssets] });
    const sessionRoot = path.join(fixture.root, ...visualRepairSessionRelativeRoot({
      taskId: fixture.task.taskId,
      repository: fixture.task.repository.name,
      taskContextDigest: fixture.task.contextDigest
    }).split("/"));
    await writeJsonFile(path.join(sessionRoot, "runs", run.runId, "run-context.json"), run);
    const completed = await writeCompletedCaptureFixture(fixture.root, fixture.task, run);

    const server = createRepairMcpServer(fixture.root, completed.session, producerFor(completed.session), repairClock);
    const client = new Client({ name: "repair-tool-evidence-index-test", version: "1" }, { capabilities: {} });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      const response = await client.callTool({
        name: "visual_hive_get_browser_evidence",
        arguments: {
          taskId: fixture.task.taskId,
          repository: fixture.task.repository.name,
          taskContextDigest: fixture.task.contextDigest,
          runId: run.runId,
          runContextDigest: run.runContextDigest,
          commitSha: run.repository.commitSha,
          contractId: "contract.card",
          includeImages: true,
          maxImages: 4
        }
      }, undefined, { timeout: 10_000 });
      const envelope = JSON.parse(textOf(response)) as {
        evidenceAssetIndex: Array<{ assetId: string; role: string; sha256: string; path: string; width: number; height: number; assertion: { screenshotName: string; route: string; state: string; viewportId: string } }>;
        evidenceAssetIndexCounts: { total: number; returned: number; omitted: number };
        imageContentIndex: Array<{ contentIndex: number; assetId: string; role: string; sha256: string }>;
        imageContentCounts: { total: number; returned: number; omitted: number };
      };

      expect(envelope.evidenceAssetIndexCounts).toEqual({ total: 8, returned: 8, omitted: 0 });
      expect(new Set(envelope.evidenceAssetIndex.map((asset) => `${asset.assertion.screenshotName}|${asset.assertion.route}|${asset.assertion.state}|${asset.assertion.viewportId}`))).toEqual(new Set([
        "Card desktop state|/|default|viewport.desktop",
        "Card desktop state|/|expanded|viewport.desktop",
        "Card desktop state|/|hover|viewport.desktop"
      ]));
      expect(envelope.evidenceAssetIndex.every((asset) => asset.assetId && asset.role && asset.sha256 && asset.path && asset.width === 2 && asset.height === 2)).toBe(true);
      expect(envelope.imageContentIndex).toHaveLength(4);
      expect(imagesOf(response)).toHaveLength(4);
      expect(envelope.imageContentIndex.map((entry) => entry.contentIndex)).toEqual([1, 2, 3, 4]);
      expect(envelope.imageContentCounts).toEqual({ total: 6, returned: 4, omitted: 2 });
      const attachedIds = new Set(envelope.imageContentIndex.map((entry) => entry.assetId));
      expect(envelope.evidenceAssetIndex.some((asset) => asset.assertion.state === "hover" && !attachedIds.has(asset.assetId))).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("fails closed when issue or session identity differs", async () => {
    const fixture = await createFixture();
    const server = createRepairMcpServer(fixture.root, fixture.session, producerFor(fixture.session), repairClock);
    const client = new Client({ name: "repair-tool-duplicate-test", version: "1" }, { capabilities: {} });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      const result = await client.callTool({
        name: "visual_hive_get_issue_context",
        arguments: {
          taskId: fixture.task.taskId,
          repository: fixture.task.repository.name,
          taskContextDigest: fixture.task.contextDigest,
          issueFingerprint: "issue.other"
        }
      }, undefined, { timeout: 10_000 });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain("does not match the Hive session finding");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("checks the live authorization window on every tool call", async () => {
    const fixture = await createFixture();
    for (const [label, now, expected] of [
      ["not-yet-active", "2026-07-14T14:59:59.000Z", "not yet active"],
      ["expired", "2026-07-14T18:00:01.000Z", "expired"]
    ] as const) {
      const server = createRepairMcpServer(fixture.root, fixture.session, producerFor(fixture.session), { now: () => new Date(now) });
      const client = new Client({ name: `repair-tool-${label}-test`, version: "1" }, { capabilities: {} });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      try {
        await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
        const result = await client.callTool({
          name: "visual_hive_get_task_context",
          arguments: {
            taskId: fixture.task.taskId,
            repository: fixture.task.repository.name,
            taskContextDigest: fixture.task.contextDigest,
            baseSha: fixture.task.repository.baseSha,
            section: "summary"
          }
        }, undefined, { timeout: 10_000 });
        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain(expected);
      } finally {
        await client.close();
        await server.close();
      }
    }
  });

  it("rejects a canonically valid validation receipt from another Hive session", async () => {
    const fixture = await createFixture();
    const crossSession = {
      ...fixture.session,
      sessionId: digest("e"),
      sessionDigest: digest("f")
    } as HiveRepairSession;
    const receipt = makeValidation(fixture.task, fixture.run, crossSession);
    const sessionRoot = path.join(fixture.root, ...visualRepairSessionRelativeRoot({
      taskId: fixture.task.taskId,
      repository: fixture.task.repository.name,
      taskContextDigest: fixture.task.contextDigest
    }).split("/"));
    await writeJsonFile(path.join(sessionRoot, "validations", `${receipt.validationId}.json`), receipt);

    const server = createRepairMcpServer(fixture.root, fixture.session, producerFor(fixture.session), repairClock);
    const client = new Client({ name: "repair-tool-cross-session-test", version: "1" }, { capabilities: {} });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      const result = await client.callTool({
        name: "visual_hive_get_repair_validation",
        arguments: {
          taskId: fixture.task.taskId,
          repository: fixture.task.repository.name,
          taskContextDigest: fixture.task.contextDigest,
          validationId: receipt.validationId,
          findingFingerprint: receipt.findingFingerprint,
          headSha: receipt.headSha,
          receiptDigest: receipt.receiptDigest
        }
      }, undefined, { timeout: 10_000 });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain("does not match the requested task, repository, base commit, or validation identity");
    } finally {
      await client.close();
      await server.close();
    }
  });
});

async function createFixture(options: { expected?: Buffer; current?: Buffer } = {}): Promise<{
  root: string;
  task: VisualHiveTaskContext;
  run: VisualRunContext;
  validation: VisualRepairValidation;
  session: HiveRepairSession;
  expected: Buffer;
  completionPath: string;
  bundleDirectory: string;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-hive-repair-mcp-"));
  roots.push(root);
  await writeFile(path.join(root, "visual-hive.config.yaml"), `project:\n  name: repair-mcp\ntargets:\n  local:\n    kind: url\n    url: "http://127.0.0.1:4173"\ncontracts:\n  - id: contract.card\n    description: Card\n    target: local\n`, "utf8");

  const expected = options.expected ?? makePng(10, 20, 30);
  const current = options.current ?? makePng(220, 30, 40);
  const task = makeTask(expected, current);
  const sessionRoot = path.join(root, ...visualRepairSessionRelativeRoot({ taskId: task.taskId, repository: task.repository.name, taskContextDigest: task.contextDigest }).split("/"));
  await mkdir(path.join(sessionRoot, "assets"), { recursive: true });
  await writeFile(path.join(sessionRoot, "assets", "expected.png"), expected);
  await writeFile(path.join(sessionRoot, "assets", "current.png"), current);
  await writeJsonFile(path.join(sessionRoot, "task-context.json"), task);

  const report = {
    schemaVersion: 2,
    project: "repair-mcp",
    repository: { provider: "local", repository: task.repository.name, commitSha: task.repository.baseSha },
    selectedContracts: ["contract.card"],
    results: [{
      contractId: "contract.card",
      targetId: "target.app",
      status: "failed",
      durationMs: 25,
      errors: ["Visual mismatch"],
      selectorAssertions: [{ kind: "mustExist", value: "[data-testid=card]", status: "passed" }],
      screenshotAssertions: [{ screenshotName: "Card desktop state", status: "failed" }]
    }]
  };
  const reportBytes = Buffer.from(JSON.stringify(report), "utf8");
  const repairSession = buildTestRepairSession(task, repairSessionOptions());
  const run = makeRun(task, expected, current, reportBytes, repairSession.reproductionRequest);
  const runRoot = path.join(sessionRoot, "runs", run.runId);
  await mkdir(path.join(runRoot, "assets"), { recursive: true });
  await writeFile(path.join(runRoot, "assets", "baseline.png"), expected);
  await writeFile(path.join(runRoot, "assets", "actual.png"), current);
  await writeFile(path.join(runRoot, "assets", "diff.png"), current);
  await writeFile(path.join(runRoot, "report.json"), reportBytes);
  await writeJsonFile(path.join(runRoot, "run-context.json"), run);

  const completed = await writeCompletedCaptureFixture(root, task, run);

  const validation = makeValidation(task, run, completed.session);
  await writeJsonFile(path.join(sessionRoot, "validations", `${validation.validationId}.json`), validation);
  return { root, task, run, validation, session: completed.session, expected, completionPath: completed.completionPath, bundleDirectory: completed.bundleDirectory };
}

function repairSessionOptions() {
  return {
    findingFingerprint: "issue.target",
    candidateSha: commit("b"),
    validationToolRegistryDigest: digest("4"),
    configDigest: digest("1")
  };
}

async function writeCompletedCaptureFixture(
  root: string,
  task: VisualHiveTaskContext,
  run: VisualRunContext
): Promise<{ session: HiveRepairSession; completionPath: string; bundleDirectory: string; receiptDigest: string }> {
  const draft = buildTestRepairSession(task, repairSessionOptions());
  expect(run.brokerRequest).toEqual({ requestId: draft.reproductionRequest.requestId, requestDigest: draft.reproductionRequest.requestDigest });
  const runDirectory = path.posix.dirname(run.report.path);
  const runContextPath = `${runDirectory}/run-context.json`;
  const runtimeIdentityPath = `${runDirectory}/runtime.json`;
  const metadataPath = `${runDirectory}/capture-metadata.json`;
  const intentPath = `${runDirectory}/capture-input.json`;
  const completionPath = `${runDirectory}/capture-result.json`;
  await writeJsonFile(path.join(root, ...runtimeIdentityPath.split("/")), { schemaVersion: "visual-hive.playwright-runtime.v1", fixture: true });
  await writeJsonFile(path.join(root, ...metadataPath.split("/")), { schemaVersion: "visual-hive.playwright-repair-capture.v1", fixture: true });
  const captureInputDigest = canonicalSha256({ requestId: draft.reproductionRequest.requestId, runContextDigest: run.runContextDigest });
  await writeJsonFile(path.join(root, ...intentPath.split("/")), { schemaVersion: "visual-hive.playwright-repair-capture-input.v1", captureInputDigest });
  const artifactPaths = [...new Set([
    run.report.path,
    runContextPath,
    runtimeIdentityPath,
    metadataPath,
    intentPath,
    ...run.evidenceAssets.map((asset) => asset.path)
  ])].sort();
  const bundle = await writeVisualHiveBundle({
    rootDir: root,
    project: "repair-mcp",
    mode: "full",
    verdict: run.capture.status,
    acmmRequest: 5,
    artifacts: artifactPaths,
    source: {
      repository: run.repository.name,
      ...(run.repository.repositoryId ? { repositoryId: run.repository.repositoryId } : {}),
      ref: "refs/heads/main",
      commitSha: run.repository.commitSha,
      event: "fixture",
      conclusion: run.capture.status,
      trusted: false
    },
    scan: {
      scope: "full",
      authoritativeForResolution: false,
      evaluatedContracts: run.execution.cases.flatMap((executionCase) => executionCase.contractIds),
      evaluatedFiles: task.sourceContext.files.map((file) => file.path),
      testPlanVersion: "fixture.v1",
      toolRegistryVersion: "fixture.v1"
    },
    observations: [],
    producerVersion: run.producer.visualHiveVersion,
    producerGitCommit: run.producer.visualHiveCommit,
    outputDir: `${runDirectory}/bundle`,
    bundleId: `repair-${run.phase}-${draft.reproductionRequest.requestId.slice(0, 24)}-${run.runContextDigest.slice(0, 12)}`,
    now: new Date(run.command.completedAt)
  });
  const receiptDigest = canonicalSha256({
    schemaVersion: "visual-hive.playwright-repair-capture-receipt.v1",
    phase: run.phase,
    requestId: draft.reproductionRequest.requestId,
    requestDigest: draft.reproductionRequest.requestDigest,
    captureInputDigest,
    commitSha: run.repository.commitSha,
    runContextDigest: run.runContextDigest,
    bundleDigest: bundle.manifest.overallDigest,
    captureStatus: run.capture.status,
    exitCode: run.command.exitCode
  });
  await writeJsonFile(path.join(root, ...completionPath.split("/")), {
    schemaVersion: "visual-hive.playwright-repair-capture-completion.v1",
    phase: run.phase,
    requestId: draft.reproductionRequest.requestId,
    requestDigest: draft.reproductionRequest.requestDigest,
    captureInputDigest,
    commitSha: run.repository.commitSha,
    captureStatus: run.capture.status,
    exitCode: run.command.exitCode,
    receiptDigest,
    runDirectory,
    reportPath: run.report.path,
    reportSha256: run.report.sha256,
    runContextPath,
    runContextDigest: run.runContextDigest,
    runtimeIdentityPath,
    metadataPath,
    bundleManifestPath: bundle.manifestPath,
    bundleDirectory: bundle.bundleDir,
    bundleDigest: bundle.manifest.overallDigest,
    artifactPaths,
    completedAt: run.command.completedAt
  });
  const completed = buildTestRepairSession(task, {
    ...repairSessionOptions(),
    reproductionState: "completed",
    reproductionReceiptDigest: receiptDigest
  });
  return { session: completed.session, completionPath, bundleDirectory: bundle.bundleDir, receiptDigest };
}

function makeTask(expected: Buffer, current: Buffer): VisualHiveTaskContext {
  const expectedDimensions = PNG.sync.read(expected);
  const currentDimensions = PNG.sync.read(current);
  const profile = {
    profileId: "profile.repair",
    targetId: "target.app",
    requestKinds: ["reproduction", "capture", "patch_validation"] as Array<"reproduction" | "capture" | "patch_validation">,
    contractIds: ["contract.card"],
    routes: ["/"],
    scenarioIds: ["scenario.default"],
    viewports: [{ viewportId: "viewport.desktop", width: 2, height: 2, deviceScaleFactor: 1 }],
    validationCommandId: "command.playwright"
  };
  const files = [{ path: "src/Card.tsx", sha256: digest("8"), size: 100, classification: "source" as const }];
  const problemStatement = "Make the responsive card match the supplied reference image.";
  return buildVisualHiveTaskContext({
    schemaVersion: "visual-hive.task-context.v1",
    digestAlgorithm: "visual-hive.canonical-json.sha256.v1",
    generatedAt: "2026-07-14T16:00:00.000Z",
    taskId: "task.card",
    repository: {
      name: "owner/repo",
      repositoryId: "42",
      repositoryFingerprint: computeVisualRepositoryFingerprint("owner/repo", "42"),
      baseSha: commit("a")
    },
    issue: { source: "fixture", externalId: "issue.target", title: "Target issue", problemStatement, problemStatementSha256: sha256Utf8(problemStatement) },
    assets: [
      { assetId: "asset.expected", role: "expected", path: "assets/expected.png", mediaType: "image/png", sha256: sha256Bytes(expected), size: expected.length, width: expectedDimensions.width, height: expectedDimensions.height, provenance: { kind: "fixture", sourceId: "expected" }, regions: [] },
      { assetId: "asset.current", role: "current", path: "assets/current.png", mediaType: "image/png", sha256: sha256Bytes(current), size: current.length, width: currentDimensions.width, height: currentDimensions.height, provenance: { kind: "fixture", sourceId: "current" }, regions: [] }
    ],
    imageReferences: [
      { position: 0, assetId: "asset.expected", role: "expected", caption: "Expected card appearance from the issue." },
      { position: 1, assetId: "asset.current", role: "current", caption: "Current broken card appearance from the issue." }
    ],
    graphCandidates: [{ nodeId: "component.card", kind: "component", label: "Responsive Card", score: 0.95, reasons: ["Issue names the card"], sourceSpans: [{ path: "src/Card.tsx", startLine: 1, endLine: 30 }] }],
    profiles: [{ ...profile, profileDigest: computeVisualValidationProfileDigest(profile) }],
    obligations: [{ obligationId: "obligation.card", description: "Card matches the reference", sourceAssetIds: ["asset.expected", "asset.current"], mappedContractIds: ["contract.card"], route: "/", state: "default", viewportId: "viewport.desktop", assertionKind: "pixel_region", authority: "deterministic", confidence: 1, status: "mapped" }],
    sourceContext: { digest: canonicalSha256({ files, omittedPaths: 0, truncated: false }), files, omittedPaths: 0, truncated: false }
  });
}

function makeRun(task: VisualHiveTaskContext, baseline: Buffer, actual: Buffer, reportBytes: Buffer, request: HiveRepairValidationRequestSpec): VisualRunContext {
  const baselineDimensions = PNG.sync.read(baseline);
  const actualDimensions = PNG.sync.read(actual);
  const cases = [{ caseId: "case.card", targetId: "target.app", route: "/", state: "default", viewport: { viewportId: "viewport.desktop", width: 2, height: 2, deviceScaleFactor: 1 }, contractIds: ["contract.card"] }];
  const thresholds = [{ contractId: "contract.card", maxDiffPixelRatio: 0, missingBaseline: "fail" as const }];
  const assertion = { contractId: "contract.card", screenshotName: "Card desktop state", route: "/", state: "default", viewportId: "viewport.desktop" };
  const runId = `run.${request.requestId}`;
  const runRoot = `${visualRepairSessionRelativeRoot({ taskId: task.taskId, repository: task.repository.name, taskContextDigest: task.contextDigest })}/runs/${runId}`;
  return buildVisualRunContext({
    schemaVersion: "visual-hive.run-context.v1",
    digestAlgorithm: "visual-hive.canonical-json.sha256.v1",
    generatedAt: "2026-07-14T16:05:00.000Z",
    runId,
    phase: "before",
    taskId: task.taskId,
    taskContextDigest: task.contextDigest,
    findingFingerprint: "issue.target",
    repository: { name: task.repository.name, repositoryId: task.repository.repositoryId, repositoryFingerprint: task.repository.repositoryFingerprint, commitSha: task.repository.baseSha },
    brokerRequest: { requestId: request.requestId, requestDigest: request.requestDigest },
    execution: {
      commitSha: task.repository.baseSha,
      profileId: task.profiles[0]!.profileId,
      profileDigest: task.profiles[0]!.profileDigest,
      configDigest: digest("1"),
      validationPolicyDigest: computeVisualValidationPolicyDigest("command.playwright", thresholds),
      contractInventoryDigest: canonicalSha256(["contract.card"]),
      planDigest: digest("2"),
      testPlanDigest: digest("3"),
      toolRegistryDigest: digest("4"),
      baselineIdentityDigest: digest("5"),
      executionMatrixDigest: canonicalSha256(cases),
      browser: { name: "chromium", version: "130" },
      environment: { os: "windows", architecture: "x64", nodeVersion: "22.13.1", playwrightVersion: "1.54.1", fontManifestDigest: digest("6"), locale: "en-US", timezone: "UTC" },
      cases
    },
    producer: {
      visualHiveVersion: "0.3.2",
      visualHiveCommit: commit("c"),
      manifestSha256: digest("9"),
      entrypointSha256: digest("2"),
      playwrightVersion: "1.54.1"
    },
    command: {
      validationCommandId: "command.playwright",
      startedAt: "2026-07-14T16:04:00.000Z",
      completedAt: "2026-07-14T16:05:00.000Z",
      exitCode: 1,
      executionBinding
    },
    report: { path: `${runRoot}/report.json`, sha256: sha256Bytes(reportBytes) },
    evidenceAssets: [
      { assetId: "asset.run.baseline", role: "baseline", path: `${runRoot}/assets/baseline.png`, mediaType: "image/png", sha256: sha256Bytes(baseline), size: baseline.length, width: baselineDimensions.width, height: baselineDimensions.height, assertion, obligationIds: ["obligation.card"] },
      { assetId: "asset.run.actual", role: "actual", path: `${runRoot}/assets/actual.png`, mediaType: "image/png", sha256: sha256Bytes(actual), size: actual.length, width: actualDimensions.width, height: actualDimensions.height, assertion, obligationIds: ["obligation.card"] },
      { assetId: "asset.run.diff", role: "diff", path: `${runRoot}/assets/diff.png`, mediaType: "image/png", sha256: sha256Bytes(actual), size: actual.length, width: actualDimensions.width, height: actualDimensions.height, assertion, obligationIds: ["obligation.card"] }
    ],
    thresholds,
    capture: { status: "failed", failures: ["Visual mismatch"] }
  });
}

function makeValidation(task: VisualHiveTaskContext, run: VisualRunContext, session: HiveRepairSession): VisualRepairValidation {
  const headSha = commit("b");
  return buildVisualRepairValidation({
    schemaVersion: "visual-hive.repair-validation.v1",
    generatedAt: "2026-07-14T16:10:00.000Z",
    validationId: "validation.card",
    sessionId: session.sessionId,
    sessionDigest: session.sessionDigest,
    authorizationDigest: session.authorization!.authorizationDigest,
    taskId: task.taskId,
    taskContextDigest: task.contextDigest,
    findingFingerprint: run.findingFingerprint,
    hiveRepairResultDigest: digest("7"),
    repository: task.repository.name,
    baseSha: task.repository.baseSha,
    headSha,
    beforeBundleDigest: digest("8"),
    afterBundleDigest: digest("9"),
    beforeReportDigest: run.report.sha256,
    afterReportDigest: digest("a"),
    beforeRunContextDigest: run.runContextDigest,
    afterRunContextDigest: digest("b"),
    before: run.execution,
    after: { ...structuredClone(run.execution), commitSha: headSha },
    obligations: [{ obligationId: "obligation.card", deterministic: true, status: "passed", contractIds: ["contract.card"], evidenceAssetIds: ["asset.run.actual"] }],
    screenshotTriplets: [{ obligationId: "obligation.card", beforeAssetId: "asset.before", afterAssetId: "asset.after", diffAssetId: "asset.diff", diffPixels: 0, totalPixels: 4, diffRatio: 0 }],
    lanes: {
      targeted: { profileId: run.execution.profileId, status: "passed", evaluatedContractIds: ["contract.card"], failures: [] },
      regression: { profileId: run.execution.profileId, status: "passed", evaluatedContractIds: ["contract.card"], failures: [] },
      mutation: { status: "not_required", killed: 0, survived: 0, operatorIds: [] }
    },
    remainingFailures: [],
    newFailures: [],
    findingBeforeStatus: "present",
    findingStatus: "absent",
    authoritativeForResolution: true,
    policyChanges: { configChanged: false, validationPolicyChanged: false, thresholdWeakened: false, baselineChanged: false },
    digestAlgorithm: "visual-hive.canonical-json.sha256.v1"
  });
}

function makePng(red: number, green: number, blue: number, width = 2, height = 2): Buffer {
  const image = new PNG({ width, height });
  for (let offset = 0; offset < image.data.length; offset += 4) {
    image.data[offset] = red;
    image.data[offset + 1] = green;
    image.data[offset + 2] = blue;
    image.data[offset + 3] = 255;
  }
  return PNG.sync.write(image);
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function invokeBrowserEvidence(fixture: {
  root: string;
  task: VisualHiveTaskContext;
  run: VisualRunContext;
  session: HiveRepairSession;
}) {
  const server = createRepairMcpServer(fixture.root, fixture.session, producerFor(fixture.session), repairClock);
  const client = new Client({ name: "repair-tool-durable-capture-test", version: "1" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    return await client.callTool({
      name: "visual_hive_get_browser_evidence",
      arguments: {
        taskId: fixture.task.taskId,
        repository: fixture.task.repository.name,
        taskContextDigest: fixture.task.contextDigest,
        runId: fixture.run.runId,
        runContextDigest: fixture.run.runContextDigest,
        commitSha: fixture.run.repository.commitSha,
        contractId: "contract.card"
      }
    }, undefined, { timeout: 10_000 });
  } finally {
    await client.close();
    await server.close();
  }
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.find((item) => item.type === "text")?.text ?? "";
}

function imagesOf(result: { content: Array<{ type: string; data?: string; mimeType?: string }> }): Array<{ data: string; mimeType: string }> {
  return result.content
    .filter((item): item is { type: "image"; data: string; mimeType: string } => item.type === "image" && typeof item.data === "string" && typeof item.mimeType === "string")
    .map((item) => ({ data: item.data, mimeType: item.mimeType }));
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
