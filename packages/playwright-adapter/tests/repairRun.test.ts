import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { chromium } from "@playwright/test";
import {
  VisualHiveConfigSchema,
  VISUAL_REPAIR_TOOL_NAMES,
  buildHiveExecutionAuthorization,
  buildHiveRepairValidationRequestSpec,
  buildVisualHiveTaskContext,
  canonicalSha256,
  computeVisualRepositoryFingerprint,
  computeVisualValidationProfileDigest,
  loadVisualRunEvidenceAsset,
  sha256Bytes,
  sha256Utf8,
  verifyVisualHiveBundleDigest,
  visualHiveObservationRepositoryFingerprint,
  visualRepairSessionRelativeRoot,
  type HiveRepairValidationRequestSpec,
  type HiveExecutionAuthorization,
  type HiveRepairBudgetLimits,
  type Plan,
  type VisualHiveConfig,
  type VisualHiveTaskContext
} from "@visual-hive/core";
import { afterEach, describe, expect, it } from "vitest";
import {
  PLAYWRIGHT_REPAIR_VALIDATION_TOOL_REGISTRY_DIGEST,
  parsePlaywrightRepairCaptureFinding,
  runPlaywrightRepairCapture,
  type PlaywrightRepairCaptureFinding,
  type RunPlaywrightRepairCaptureOptions
} from "../src/repairRun.js";
import { buildReportFromPlaywrightOutput } from "../src/runner.js";

const execFileAsync = promisify(execFile);
const fixtures: RepairFixture[] = [];
const testExecutionBinding = {
  nonceSha256: "1".repeat(64),
  generatedSpecSha256: "2".repeat(64),
  generatedConfigSha256: "3".repeat(64),
  payloadSha256: "4".repeat(64),
  bindingMacSha256: "5".repeat(64)
};

afterEach(async () => {
  for (const fixture of fixtures.splice(0).reverse()) {
    await closeServer(fixture.server);
    await rm(fixture.rootDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});

describe.sequential("runPlaywrightRepairCapture", () => {
  it("runs real before/after browser captures with request isolation, exact identity, relative paths, verified bundles, and idempotent replay", async () => {
    const fixture = await createRepairFixture({ baseline: true });
    const beforeRequest = validationRequest(fixture, fixture.baseSha, "before");
    const before = await runPlaywrightRepairCapture(captureOptions(fixture, beforeRequest, "before"));

    expect(before.captureStatus).toBe("passed");
    expect(before.exitCode).toBe(0);
    expect(before.reused).toBe(false);
    expect(before.runContext.brokerRequest).toEqual({
      requestId: beforeRequest.requestId,
      requestDigest: beforeRequest.requestDigest
    });
    expect(before.runContext.execution).toMatchObject({
      commitSha: fixture.baseSha,
      profileId: fixture.profile.profileId,
      profileDigest: fixture.profile.profileDigest,
      toolRegistryDigest: PLAYWRIGHT_REPAIR_VALIDATION_TOOL_REGISTRY_DIGEST
    });
    expect(before.runContext.execution.browser.name).toBe("chromium");
    expect(before.runContext.execution.browser.version).toMatch(/^\d+\./u);
    expect(before.runContext.execution.environment.nodeVersion).toBe(process.version);
    expect(before.runContext.producer.playwrightVersion).toBe(before.runContext.execution.environment.playwrightVersion);
    expect(before.report.mode).toBe("full");
    expect(before.report.repository).toMatchObject({ repository: fixture.repository, commitSha: fixture.baseSha });
    expect(verifyVisualHiveBundleDigest(before.bundleManifest)).toBe(true);
    expect(before.bundleManifest.scan).toMatchObject({ scope: "full", authoritativeForResolution: true });
    expect(before.bundleManifest.observations[0]?.state).toBe("absent");
    expect(before.artifactPaths).toContain(before.reportPath);
    expect(before.artifactPaths).toContain(before.runContextPath);
    expect(before.artifactPaths).toContain(before.runtimeIdentityPath);
    const expectedSessionRoot = visualRepairSessionRelativeRoot({
      taskId: fixture.task.taskId,
      repository: fixture.repository,
      taskContextDigest: fixture.task.contextDigest
    });
    expect(before.runDirectory).toBe(`${expectedSessionRoot}/runs/${before.runContext.runId}`);
    expect(before.runContext.evidenceAssets.map((asset) => asset.role)).toEqual(["actual", "baseline"]);
    expect(before.runContext.evidenceAssets.find((asset) => asset.role === "actual")?.path.startsWith(`${expectedSessionRoot}/runs/exec.`)).toBe(true);
    expect(before.report.executionBinding).toEqual(before.runContext.command.executionBinding);
    expect(allSerializedPaths(before)).not.toContain(fixture.rootDir);
    expect(allSerializedPaths(before)).not.toMatch(/[A-Za-z]:\\/u);

    const loaded = await loadVisualRunEvidenceAsset({
      evidenceRoot: fixture.rootDir,
      runContext: before.runContext,
      taskId: fixture.task.taskId,
      taskContextDigest: fixture.task.contextDigest,
      repository: fixture.repository,
      commitSha: fixture.baseSha,
      runId: before.runContext.runId,
      assetId: before.runContext.evidenceAssets.find((asset) => asset.role === "actual")!.assetId
    });
    expect(loaded.data.byteLength).toBeGreaterThan(100);
    await verifyBundledFiles(fixture.rootDir, before.bundleDirectory, before.bundleManifest);

    const replay = await runPlaywrightRepairCapture(captureOptions(fixture, beforeRequest, "before"));
    expect(replay.reused).toBe(true);
    expect(replay.receiptDigest).toBe(before.receiptDigest);
    expect(replay.runContext.runContextDigest).toBe(before.runContext.runContextDigest);

    await writeFile(path.join(fixture.rootDir, "candidate.txt"), "candidate\n", "utf8");
    await git(fixture.rootDir, ["add", "candidate.txt"]);
    await git(fixture.rootDir, ["commit", "-m", "candidate"]);
    const candidateSha = await git(fixture.rootDir, ["rev-parse", "HEAD"]);
    const afterRequest = validationRequest(fixture, candidateSha, "after");
    const after = await runPlaywrightRepairCapture({
      ...captureOptions(fixture, afterRequest, "after"),
      outputRoot: `${expectedSessionRoot}/runs`
    });

    expect(after.captureStatus).toBe("passed");
    expect(after.runDirectory).not.toBe(before.runDirectory);
    expect(after.runContext.runId).not.toBe(before.runContext.runId);
    expect(after.runContext.execution.commitSha).toBe(candidateSha);
    expect(after.runContext.execution.profileDigest).toBe(before.runContext.execution.profileDigest);
    expect(after.runContext.execution.configDigest).toBe(before.runContext.execution.configDigest);
    expect(after.runContext.execution.planDigest).toBe(before.runContext.execution.planDigest);
    expect(after.runContext.execution.baselineIdentityDigest).toBe(before.runContext.execution.baselineIdentityDigest);
    expect(after.runContext.execution.executionMatrixDigest).toBe(before.runContext.execution.executionMatrixDigest);
    expect(verifyVisualHiveBundleDigest(after.bundleManifest)).toBe(true);
    await verifyBundledFiles(fixture.rootDir, after.bundleDirectory, after.bundleManifest);
  }, 120_000);

  it("preserves a real failed-before screenshot and its deterministic bundle instead of discarding defect evidence", async () => {
    const fixture = await createRepairFixture({ baseline: true });
    fixture.page.html = pageHtml("BROKEN RENDER");
    const request = validationRequest(fixture, fixture.baseSha, "before");
    const result = await runPlaywrightRepairCapture(captureOptions(fixture, request, "before"));

    expect(result.captureStatus).toBe("failed");
    expect(result.exitCode).toBe(1);
    expect(result.report.status).toBe("failed");
    expect(result.report.results[0]?.screenshotAssertions?.[0]?.status).toBe("failed");
    expect(result.bundleManifest.observations[0]?.state).toBe("present");
    expect(verifyVisualHiveBundleDigest(result.bundleManifest)).toBe(true);
    const actualPath = result.report.results[0]!.screenshotAssertions![0]!.actualPath;
    const diffPath = result.report.results[0]!.screenshotAssertions![0]!.diffPath!;
    await expect(access(path.join(fixture.rootDir, ...actualPath.split("/")), constants.F_OK)).resolves.toBeUndefined();
    await expect(access(path.join(fixture.rootDir, ...diffPath.split("/")), constants.F_OK)).resolves.toBeUndefined();
    expect(result.artifactPaths).toEqual(expect.arrayContaining([actualPath, diffPath]));
    const actualAsset = result.runContext.evidenceAssets.find((asset) => asset.role === "actual")!;
    const diffAsset = result.runContext.evidenceAssets.find((asset) => asset.role === "diff")!;
    expect(result.runContext.evidenceAssets.map((asset) => asset.role).sort()).toEqual(["actual", "baseline", "diff"]);
    const [loadedActual, loadedDiff] = await Promise.all([actualAsset, diffAsset].map((asset) => loadVisualRunEvidenceAsset({
      evidenceRoot: fixture.rootDir,
      runContext: result.runContext,
      taskId: fixture.task.taskId,
      taskContextDigest: fixture.task.contextDigest,
      repository: fixture.repository,
      commitSha: fixture.baseSha,
      runId: result.runContext.runId,
      assetId: asset.assetId
    })));
    expect(loadedActual.asset.role).toBe("actual");
    expect(loadedDiff.asset.role).toBe("diff");
    await verifyBundledFiles(fixture.rootDir, result.bundleDirectory, result.bundleManifest);
  }, 120_000);

  it("fails closed on wrong commits, forged authorization, producer mismatch, partial plans, update mode, and missing baselines", async () => {
    const fixture = await createRepairFixture({ baseline: true });
    const valid = validationRequest(fixture, fixture.baseSha, "before");
    const wrongCommit = buildRequest(fixture, "f".repeat(40), "before");

    await expect(runPlaywrightRepairCapture(captureOptions(fixture, wrongCommit, "before"))).rejects.toThrow("expected git HEAD");
    await expect(runPlaywrightRepairCapture({
      ...captureOptions(fixture, valid, "before"),
      executionAuthorization: { ...fixture.authorization, configDigest: "f".repeat(64) }
    })).rejects.toThrow("authorization digest mismatch");
    await expect(runPlaywrightRepairCapture({
      ...captureOptions(fixture, valid, "before"),
      expectedProducer: {
        visualHiveVersion: "0.3.2-test",
        visualHiveCommit: "d".repeat(40),
        manifestSha256: "b".repeat(64),
        entrypointSha256: "c".repeat(64)
      }
    })).rejects.toThrow("does not match the Hive session capability pin");
    await expect(runPlaywrightRepairCapture({
      ...captureOptions(fixture, valid, "before"),
      producer: { ...captureOptions(fixture, valid, "before").producer, manifestSha256: "invalid" }
    })).rejects.toThrow("release-manifest identity is invalid");
    await expect(runPlaywrightRepairCapture({
      ...captureOptions(fixture, valid, "before"),
      plan: { ...fixture.plan, mode: "pr" }
    })).rejects.toThrow("requires a full Playwright plan");
    await expect(runPlaywrightRepairCapture({
      ...captureOptions(fixture, valid, "before"),
      plan: {
        ...fixture.plan,
        targets: [{ ...fixture.plan.targets[0]!, url: "https://unapproved.example.invalid" }],
        items: [{ ...fixture.plan.items[0]!, targetUrl: "https://unapproved.example.invalid" }]
      }
    })).rejects.toThrow("not an exact configured destination");
    await expect(runPlaywrightRepairCapture({
      ...captureOptions(fixture, valid, "before"),
      config: { ...fixture.config, visual: { ...fixture.config.visual, updateSnapshots: true } }
    })).rejects.toThrow("forbids snapshot updates");
    await expect(runPlaywrightRepairCapture({
      ...captureOptions(fixture, valid, "before"),
      config: { ...fixture.config, project: { ...fixture.config.project, name: "candidate-controlled-config" } }
    })).rejects.toThrow("authorized base config digest");
    expect(() => parsePlaywrightRepairCaptureFinding({ ...fixture.finding, unexpected: true })).toThrow("missing or unknown fields");

    const missing = await createRepairFixture({ baseline: false });
    const missingRequest = validationRequest(missing, missing.baseSha, "before");
    const missingResult = await runPlaywrightRepairCapture(captureOptions(missing, missingRequest, "before"));
    const baselinePath = path.join(missing.rootDir, ".visual-hive", "snapshots", "contract.card__home__desktop.png");

    expect(missingResult.captureStatus).toBe("blocked");
    expect(missingResult.exitCode).toBe(1);
    expect(missingResult.report.results[0]?.screenshotAssertions?.[0]?.status).toBe("missing_baseline");
    expect(missingResult.runContext.capture.failures.join("\n")).toContain("Missing approved screenshot baseline");
    await expect(access(baselinePath, constants.F_OK)).rejects.toThrow();
    const actualPath = missingResult.report.results[0]!.screenshotAssertions![0]!.actualPath;
    await expect(access(path.join(missing.rootDir, ...actualPath.split("/")), constants.F_OK)).resolves.toBeUndefined();
    expect(verifyVisualHiveBundleDigest(missingResult.bundleManifest)).toBe(true);
  }, 120_000);

  it("binds immutable reuse to every effective input and safely recovers a terminally failed directory", async () => {
    const fixture = await createRepairFixture({ baseline: true });
    const request = validationRequest(fixture, fixture.baseSha, "before");
    const first = await runPlaywrightRepairCapture(captureOptions(fixture, request, "before"));
    await expect(runPlaywrightRepairCapture({
      ...captureOptions(fixture, request, "before"),
      source: { ref: "refs/heads/main", event: "different-source", trusted: false }
    })).rejects.toThrow("does not match the Hive request");

    await rm(path.join(fixture.rootDir, ...first.completionPath.split("/")));
    await writeFile(path.join(fixture.rootDir, ...first.runDirectory.split("/"), "capture-failure.json"), JSON.stringify({ terminal: true }));
    const retried = await runPlaywrightRepairCapture(captureOptions(fixture, request, "before"));
    expect(retried.reused).toBe(false);
    expect(retried.captureStatus).toBe("passed");
    const runParent = path.dirname(path.join(fixture.rootDir, ...retried.runDirectory.split("/")));
    const archived = (await readdir(runParent)).filter((name) => name.includes(".failed."));
    expect(archived).toHaveLength(1);
  }, 120_000);

  it("rejects linked output parents before writing capture state", async () => {
    const fixture = await createRepairFixture({ baseline: true });
    const outside = path.join(fixture.rootDir, "linked-output");
    await mkdir(outside);
    const repairRoot = path.join(fixture.rootDir, ".visual-hive", "repair");
    await symlink(outside, repairRoot, process.platform === "win32" ? "junction" : "dir");
    const request = validationRequest(fixture, fixture.baseSha, "before");
    await expect(runPlaywrightRepairCapture(captureOptions(fixture, request, "before"))).rejects.toThrow(/junction|symbolic-link|linked/u);
  }, 120_000);

  it("does not claim a targeted screenshot finding is present for an unrelated contract failure", async () => {
    const fixture = await createRepairFixture({ baseline: true });
    fixture.page.html = fixture.page.html.replace("</head>", "<script>console.error('unrelated deterministic error')</script></head>");
    const request = validationRequest(fixture, fixture.baseSha, "before");
    const result = await runPlaywrightRepairCapture(captureOptions(fixture, request, "before"));
    expect(result.report.status).toBe("failed");
    expect(result.report.results[0]?.screenshotAssertions?.[0]?.status).toBe("passed");
    expect(result.bundleManifest.observations[0]?.state).toBe("absent");
    expect(result.bundleManifest.scan.authoritativeForResolution).toBe(true);
  }, 120_000);

  it("publishes a deterministic blocked capture when every target fails before browser runtime identity exists", async () => {
    const fixture = await createRepairFixture({ baseline: true });
    const failedUrl = "http://127.0.0.1:9";
    fixture.config = VisualHiveConfigSchema.parse({
      ...fixture.config,
      targets: { app: { kind: "command", serve: "node -e \"process.exit(1)\"", url: failedUrl, prSafe: true, cost: "cheap" } }
    });
    fixture.plan = {
      ...fixture.plan,
      targets: [{ ...fixture.plan.targets[0]!, kind: "command", url: failedUrl }],
      items: [{ ...fixture.plan.items[0]!, targetUrl: failedUrl }]
    };
    const { authorizationDigest: _authorizationDigest, ...authorizationInput } = fixture.authorization;
    void _authorizationDigest;
    fixture.authorization = buildHiveExecutionAuthorization({ ...authorizationInput, configDigest: canonicalSha256(fixture.config) });
    const request = validationRequest(fixture, fixture.baseSha, "before");
    const result = await runPlaywrightRepairCapture(captureOptions(fixture, request, "before"));

    expect(result.captureStatus).toBe("blocked");
    expect(result.exitCode).toBe(1);
    expect(result.runContext.execution.browser).toEqual({ name: "unavailable", version: "unavailable" });
    expect(result.runContext.capture.failures.join("\n")).toMatch(/startup|failed|unavailable/u);
    expect(result.bundleManifest.scan.authoritativeForResolution).toBe(false);
    expect(verifyVisualHiveBundleDigest(result.bundleManifest)).toBe(true);
  }, 120_000);

  it("fails closed when authorization expires while the browser capture is running", async () => {
    const fixture = await createRepairFixture({ baseline: true });
    const request = validationRequest(fixture, fixture.baseSha, "before");
    let clockReads = 0;
    const active = new Date(Date.parse(fixture.authorization.issuedAt) + 60_000);
    const expired = new Date(Date.parse(fixture.authorization.expiresAt) + 1);
    await expect(runPlaywrightRepairCapture({
      ...captureOptions(fixture, request, "before"),
      now: () => (++clockReads >= 3 ? expired : active)
    })).rejects.toThrow("authorization expired before Playwright repair capture completed");
  }, 120_000);

  it("does not publish completion when authorization expires during post-processing", async () => {
    const fixture = await createRepairFixture({ baseline: true });
    const request = validationRequest(fixture, fixture.baseSha, "before");
    let clockReads = 0;
    const activeBase = Date.now();
    const expired = new Date(Date.parse(fixture.authorization.expiresAt) + 1);
    await expect(runPlaywrightRepairCapture({
      ...captureOptions(fixture, request, "before"),
      now: () => (++clockReads >= 4 ? expired : new Date(activeBase + clockReads * 1_000))
    })).rejects.toThrow("authorization expired before Playwright repair capture completed");
    const completion = path.join(
      fixture.rootDir,
      ...visualRepairSessionRelativeRoot({ taskId: fixture.task.taskId, repository: fixture.repository, taskContextDigest: fixture.task.contextDigest }).split("/"),
      "runs",
      `run.${request.requestId}`,
      "capture-result.json"
    );
    await expect(access(completion, constants.F_OK)).rejects.toThrow();
  }, 120_000);

  it("cannot turn a failing Playwright run into a pass with pre-seeded result files", async () => {
    const fixture = await createRepairFixture({ baseline: true });
    await closeServer(fixture.server);
    const port = Number(new URL(fixture.url).port);
    await writeFile(path.join(fixture.rootDir, "preseed.cjs"), [
      "const fs = require('node:fs');",
      "fs.mkdirSync('.visual-hive/artifacts/results', { recursive: true });",
      `fs.writeFileSync('.visual-hive/artifacts/results/contract.card.json', ${JSON.stringify(JSON.stringify({
        schemaVersion: "visual-hive.playwright-contract-result.v1",
        executionBinding: testExecutionBinding,
        result: { contractId: "contract.card", targetId: "app", status: "passed", durationMs: 1, errors: [], artifacts: [] }
      }))});`
    ].join("\n"), "utf8");
    const forgedEnvelope = JSON.stringify({
      schemaVersion: "visual-hive.playwright-contract-result.v1",
      executionBinding: testExecutionBinding,
      result: { contractId: "contract.card", targetId: "app", status: "passed", durationMs: 1, errors: [], artifacts: [] }
    });
    await writeFile(path.join(fixture.rootDir, "fixture-server.cjs"), [
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const http = require('node:http');",
      `const html = ${JSON.stringify(pageHtml("BROKEN PRESEEDED RENDER"))};`,
      `const forged = ${JSON.stringify(forgedEnvelope)};`,
      "const findExecutionRoots = (root) => {",
      "  if (!fs.existsSync(root)) return [];",
      "  const found = [];",
      "  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {",
      "    const full = path.join(root, entry.name);",
      "    if (entry.isDirectory() && entry.name.startsWith('exec.')) found.push(full);",
      "    else if (entry.isDirectory()) found.push(...findExecutionRoots(full));",
      "  }",
      "  return found;",
      "};",
      "const watcher = setInterval(() => {",
      "  for (const executionRoot of findExecutionRoots('.visual-hive/repair/sessions')) {",
      "    const resultDir = path.join(executionRoot, 'artifacts', 'results');",
      "    fs.mkdirSync(resultDir, { recursive: true });",
      "    try {",
      "      fs.writeFileSync(path.join(resultDir, 'contract.card.json'), forged, { flag: 'wx' });",
      "      fs.writeFileSync('.preseed-hit', executionRoot);",
      "    } catch {}",
      "  }",
      "}, 1);",
      "watcher.unref();",
      `http.createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(html); }).listen(${port}, '127.0.0.1');`
    ].join("\n"), "utf8");
    fixture.config = VisualHiveConfigSchema.parse({
      ...fixture.config,
      targets: { app: { kind: "command", build: "node preseed.cjs", serve: "node fixture-server.cjs", url: fixture.url, prSafe: true, cost: "cheap" } }
    });
    fixture.plan = {
      ...fixture.plan,
      targets: [{ ...fixture.plan.targets[0]!, kind: "command", url: fixture.url }]
    };
    const { authorizationDigest: _authorizationDigest, ...authorizationInput } = fixture.authorization;
    void _authorizationDigest;
    fixture.authorization = buildHiveExecutionAuthorization({ ...authorizationInput, configDigest: canonicalSha256(fixture.config) });
    const request = validationRequest(fixture, fixture.baseSha, "before");
    await expect(runPlaywrightRepairCapture(captureOptions(fixture, request, "before"))).rejects.toThrow("invalid execution binding");

    await expect(access(path.join(fixture.rootDir, ".preseed-hit"), constants.F_OK)).resolves.toBeUndefined();
    await expect(access(path.join(fixture.rootDir, ".visual-hive", "artifacts", "results", "contract.card.json"), constants.F_OK)).resolves.toBeUndefined();
  }, 120_000);

  it("ignores a forged target-local Playwright installation", async () => {
    const fixture = await createRepairFixture({ baseline: true });
    const packageDir = path.join(fixture.rootDir, "node_modules", "@playwright", "test");
    await mkdir(packageDir, { recursive: true });
    await writeFile(path.join(packageDir, "package.json"), JSON.stringify({
      name: "@playwright/test",
      version: "99.0.0-forged",
      exports: { ".": "./index.js", "./cli": "./cli.js", "./package.json": "./package.json" }
    }), "utf8");
    await writeFile(path.join(packageDir, "index.js"), "throw new Error('forged target Playwright module loaded');\n", "utf8");
    await writeFile(path.join(packageDir, "cli.js"), "require('node:fs').writeFileSync('.forged-playwright-used', 'yes'); process.stdout.write('{\"suites\":[],\"errors\":[]}');\n", "utf8");

    const request = validationRequest(fixture, fixture.baseSha, "before");
    const result = await runPlaywrightRepairCapture(captureOptions(fixture, request, "before"));
    expect(result.captureStatus).toBe("passed");
    await expect(access(path.join(fixture.rootDir, ".forged-playwright-used"), constants.F_OK)).rejects.toThrow();
  }, 120_000);

  it("rejects generated spec replacement by a lifecycle watcher", async () => {
    const fixture = await createRepairFixture({ baseline: true });
    await closeServer(fixture.server);
    const port = Number(new URL(fixture.url).port);
    await writeFile(path.join(fixture.rootDir, "watcher-server.cjs"), [
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const http = require('node:http');",
      `const html = ${JSON.stringify(pageHtml("EXPECTED RENDER"))};`,
      "let changed = false;",
      "const visit = (root) => {",
      "  if (changed || !fs.existsSync(root)) return;",
      "  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {",
      "    const full = path.join(root, entry.name);",
      "    if (entry.isDirectory()) visit(full);",
      "    else if (entry.name === 'visual-hive.generated.spec.ts') {",
      "      fs.appendFileSync(full, '\\n// target-controlled mutation\\n');",
      "      fs.writeFileSync('.spec-mutation-hit', full);",
      "      changed = true;",
      "      return;",
      "    }",
      "  }",
      "};",
      "const watcher = setInterval(() => { try { visit('.visual-hive/repair/sessions'); } catch {} }, 1);",
      "watcher.unref();",
      `http.createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(html); }).listen(${port}, '127.0.0.1');`
    ].join("\n"), "utf8");
    fixture.config = VisualHiveConfigSchema.parse({
      ...fixture.config,
      targets: { app: { kind: "command", serve: "node watcher-server.cjs", url: fixture.url, prSafe: true, cost: "cheap" } }
    });
    fixture.plan = { ...fixture.plan, targets: [{ ...fixture.plan.targets[0]!, kind: "command", url: fixture.url }] };
    const { authorizationDigest: _authorizationDigest, ...authorizationInput } = fixture.authorization;
    void _authorizationDigest;
    fixture.authorization = buildHiveExecutionAuthorization({ ...authorizationInput, configDigest: canonicalSha256(fixture.config) });
    const request = validationRequest(fixture, fixture.baseSha, "before");

    const result = await runPlaywrightRepairCapture(captureOptions(fixture, request, "before"));
    expect(result.captureStatus).toBe("blocked");
    expect(result.exitCode).toBe(1);
    expect(result.report.results[0]?.errors.join("\n")).toMatch(/generated Playwright spec or config does not match its execution binding/u);
    await expect(access(path.join(fixture.rootDir, ".spec-mutation-hit"), constants.F_OK)).resolves.toBeUndefined();
  }, 120_000);

  it("creates no evidence outside the repository after lifecycle-time path redirection", async () => {
    const fixture = await createRepairFixture({ baseline: true });
    await closeServer(fixture.server);
    const outside = await mkdtemp(path.join(os.tmpdir(), "visual-hive-redirect-outside-"));
    const port = Number(new URL(fixture.url).port);
    const runsPath = path.join(fixture.rootDir, ...visualRepairSessionRelativeRoot({
      taskId: fixture.task.taskId,
      repository: fixture.repository,
      taskContextDigest: fixture.task.contextDigest
    }).split("/"), "runs");
    await writeFile(path.join(fixture.rootDir, "redirect.cjs"), [
      "const fs = require('node:fs');",
      `const runs = ${JSON.stringify(runsPath)};`,
      `const outside = ${JSON.stringify(outside)};`,
      "fs.renameSync(runs, runs + '.target-moved');",
      `fs.symlinkSync(outside, runs, ${JSON.stringify(process.platform === "win32" ? "junction" : "dir")});`
    ].join("\n"), "utf8");
    await writeFile(path.join(fixture.rootDir, "redirect-server.cjs"), [
      "const http = require('node:http');",
      `const html = ${JSON.stringify(pageHtml("EXPECTED RENDER"))};`,
      `http.createServer((_req, res) => res.end(html)).listen(${port}, '127.0.0.1');`
    ].join("\n"), "utf8");
    fixture.config = VisualHiveConfigSchema.parse({
      ...fixture.config,
      targets: { app: { kind: "command", build: "node redirect.cjs", serve: "node redirect-server.cjs", url: fixture.url, prSafe: true, cost: "cheap" } }
    });
    fixture.plan = { ...fixture.plan, targets: [{ ...fixture.plan.targets[0]!, kind: "command", url: fixture.url }] };
    const { authorizationDigest: _authorizationDigest, ...authorizationInput } = fixture.authorization;
    void _authorizationDigest;
    fixture.authorization = buildHiveExecutionAuthorization({ ...authorizationInput, configDigest: canonicalSha256(fixture.config) });
    const request = validationRequest(fixture, fixture.baseSha, "before");
    try {
      await expect(runPlaywrightRepairCapture(captureOptions(fixture, request, "before"))).rejects.toThrow(/linked|junction|redirected|symbolic/u);
      expect(await readdir(outside)).toEqual([]);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  }, 120_000);

  it("fails closed when an expected contract is absent from both reporter and structured evidence", async () => {
    const fixture = await createRepairFixture({ baseline: true });
    const generatedDir = path.join(fixture.rootDir, ".visual-hive", "generated-unit");
    const generatedSpecPath = path.join(generatedDir, "visual-hive.generated.spec.ts");
    await mkdir(generatedDir, { recursive: true });
    await writeFile(generatedSpecPath, "// intentionally empty reporter fixture\n", "utf8");
    const report = await buildReportFromPlaywrightOutput({
      config: fixture.config,
      plan: fixture.plan,
      stdout: JSON.stringify({ suites: [], errors: [] }),
      stderr: "",
      exitCode: 0,
      rootDir: fixture.rootDir,
      durationMs: 1,
      targetLifecycle: [],
      generatedSpecPath,
      executionBinding: testExecutionBinding,
      deadlineAtMs: Date.now() + 1,
      targetStartupErrors: new Map()
    });

    expect(report.status).toBe("failed");
    expect(report.results[0]).toMatchObject({ contractId: "contract.card", status: "failed" });
    expect(report.results[0]?.errors.join("\n")).toContain("did not return expected contract");
  }, 120_000);

  it("rejects wrong execution bindings, wrong targets, unknown fields, and aggregate result overflow", async () => {
    const cases = [
      {
        label: "binding",
        binding: { ...testExecutionBinding, bindingMacSha256: "f".repeat(64) },
        targetId: "app",
        extraEnvelope: {},
        maxBytes: 4096,
        expected: "invalid execution binding"
      },
      {
        label: "target",
        binding: testExecutionBinding,
        targetId: "other-target",
        extraEnvelope: {},
        maxBytes: 4096,
        expected: "expected contract and target inventory"
      },
      {
        label: "unknown",
        binding: testExecutionBinding,
        targetId: "app",
        extraEnvelope: { attackerControlled: true },
        maxBytes: 4096,
        expected: "invalid execution binding"
      },
      {
        label: "aggregate",
        binding: testExecutionBinding,
        targetId: "app",
        extraEnvelope: {},
        maxBytes: 128,
        expected: "aggregate byte limit"
      }
    ] as const;
    for (const testCase of cases) {
      const fixture = await createRepairFixture({ baseline: true });
      const generatedDir = path.join(fixture.rootDir, ".visual-hive", `generated-${testCase.label}`);
      const generatedSpecPath = path.join(generatedDir, "visual-hive.generated.spec.ts");
      const resultDir = path.join(fixture.rootDir, ".visual-hive", "artifacts", "results");
      await mkdir(generatedDir, { recursive: true });
      await mkdir(resultDir, { recursive: true });
      await writeFile(generatedSpecPath, "// bounded ingestion fixture\n", "utf8");
      await writeFile(path.join(resultDir, "contract.card.json"), JSON.stringify({
        schemaVersion: "visual-hive.playwright-contract-result.v1",
        executionBinding: testCase.binding,
        result: { contractId: "contract.card", targetId: testCase.targetId, status: "passed", durationMs: 1, errors: [], artifacts: [] },
        ...testCase.extraEnvelope
      }), "utf8");
      await expect(buildReportFromPlaywrightOutput({
        config: fixture.config,
        plan: fixture.plan,
        stdout: JSON.stringify({ suites: [], errors: [] }),
        stderr: "",
        exitCode: 0,
        rootDir: fixture.rootDir,
        durationMs: 1,
        targetLifecycle: [],
        generatedSpecPath,
        executionBinding: testExecutionBinding,
        maxStructuredResultBytes: testCase.maxBytes,
        deadlineAtMs: Date.now() + 1,
        targetStartupErrors: new Map()
      })).rejects.toThrow(testCase.expected);
    }
  }, 120_000);
});

interface RepairFixture {
  rootDir: string;
  server: Server;
  page: { html: string };
  url: string;
  repository: string;
  repositoryId: string;
  baseSha: string;
  config: VisualHiveConfig;
  plan: Plan;
  task: VisualHiveTaskContext;
  profile: VisualHiveTaskContext["profiles"][number];
  finding: PlaywrightRepairCaptureFinding;
  authorization: HiveExecutionAuthorization;
  budgetLimits: HiveRepairBudgetLimits;
}

async function createRepairFixture(options: { baseline: boolean }): Promise<RepairFixture> {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "visual-hive-repair-run-"));
  const page = { html: pageHtml("EXPECTED RENDER") };
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    response.end(page.html);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture server did not expose a port.");
  const url = `http://127.0.0.1:${address.port}`;
  const repository = "fixture/repair-browser";
  const repositoryId = "101";
  const config = VisualHiveConfigSchema.parse({
    project: { name: "repair-browser", type: "static", defaultBranch: "main" },
    targets: { app: { kind: "url", url, prSafe: true, cost: "cheap" } },
    viewports: { desktop: { width: 320, height: 200 } },
    visual: {
      maxDiffPixelRatio: 0,
      updateSnapshots: false,
      failOnMissingBaselineInCI: true,
      baselinePlatform: "shared",
      snapshotDir: ".visual-hive/snapshots",
      artifactDir: ".visual-hive/artifacts"
    },
    contracts: [{
      id: "contract.card",
      description: "The card has the expected rendering.",
      target: "app",
      severity: "high",
      runOn: { pullRequest: true },
      failOnConsoleError: true,
      screenshots: [{ name: "home", route: "/", viewport: "desktop", fullPage: true }]
    }]
  });
  await mkdir(path.join(rootDir, "src"), { recursive: true });
  await writeFile(path.join(rootDir, "src", "app.html"), page.html, "utf8");
  await writeFile(path.join(rootDir, ".gitignore"), ".visual-hive/repair/sessions/\n.visual-hive/playwright-results/\n", "utf8");
  if (options.baseline) {
    const baselineDir = path.join(rootDir, ".visual-hive", "snapshots");
    await mkdir(baselineDir, { recursive: true });
    const browser = await chromium.launch({ headless: true });
    try {
      const browserPage = await browser.newPage({ viewport: { width: 320, height: 200 } });
      await browserPage.goto(url, { waitUntil: "domcontentloaded" });
      const bytes = await browserPage.screenshot({ fullPage: true, animations: "disabled" });
      await writeFile(path.join(baselineDir, "contract.card__home__desktop.png"), bytes);
    } finally {
      await browser.close();
    }
  }
  await git(rootDir, ["init", "-b", "main"]);
  await git(rootDir, ["config", "user.name", "Visual Hive Test"]);
  await git(rootDir, ["config", "user.email", "visual-hive@example.invalid"]);
  await git(rootDir, ["config", "core.autocrlf", "false"]);
  await git(rootDir, ["remote", "add", "origin", `https://github.com/${repository}.git`]);
  await git(rootDir, ["add", "."]);
  await git(rootDir, ["commit", "-m", "fixture"]);
  const baseSha = await git(rootDir, ["rev-parse", "HEAD"]);
  const repositoryFingerprint = computeVisualRepositoryFingerprint(repository, repositoryId);
  const profileBody = {
    profileId: "profile.full",
    targetId: "app",
    requestKinds: ["reproduction", "capture", "patch_validation"] as Array<"reproduction" | "capture" | "patch_validation">,
    contractIds: ["contract.card"],
    routes: ["/"],
    scenarioIds: ["default"],
    viewports: [{ viewportId: "desktop", width: 320, height: 200, deviceScaleFactor: 1 }],
    validationCommandId: "command.playwright.full"
  };
  const profile = { ...profileBody, profileDigest: computeVisualValidationProfileDigest(profileBody) };
  const sourceBytes = Buffer.from(page.html, "utf8");
  const sourceFiles = [{ path: "src/app.html", sha256: sha256Bytes(sourceBytes), size: sourceBytes.byteLength, classification: "source" as const }];
  const task = buildVisualHiveTaskContext({
    schemaVersion: "visual-hive.task-context.v1",
    digestAlgorithm: "visual-hive.canonical-json.sha256.v1",
    generatedAt: "2026-07-14T12:00:00.000Z",
    taskId: "task.browser-card",
    repository: { name: repository, repositoryId, repositoryFingerprint, baseSha, ref: "refs/heads/main" },
    issue: {
      source: "fixture",
      externalId: "repair-browser-1",
      problemStatement: "Repair the card rendering without changing deterministic policy.",
      problemStatementSha256: sha256Utf8("Repair the card rendering without changing deterministic policy.")
    },
    assets: [],
    imageReferences: [],
    graphCandidates: [],
    profiles: [profile],
    obligations: [{
      obligationId: "obligation.card",
      description: "The card rendering remains deterministic.",
      sourceAssetIds: [],
      mappedContractIds: ["contract.card"],
      route: "/",
      state: "default",
      viewportId: "desktop",
      assertionKind: "pixel_region",
      authority: "deterministic",
      confidence: 1,
      status: "mapped"
    }],
    sourceContext: {
      digest: canonicalSha256({ files: sourceFiles, omittedPaths: 0, truncated: false }),
      files: sourceFiles,
      omittedPaths: 0,
      truncated: false
    }
  });
  const plan: Plan = {
    schemaVersion: 1,
    project: config.project.name,
    mode: "full",
    generatedAt: "2026-07-14T12:00:00.000Z",
    changedFiles: [],
    effectiveChangedFiles: [],
    ignoredChangedFiles: [],
    targets: [{ id: "app", kind: "url", url, prSafe: true, cost: "cheap" }],
    items: [{
      contractId: "contract.card",
      targetId: "app",
      targetUrl: url,
      severity: "high",
      cost: "cheap",
      reasons: ["full authoritative repair validation"],
      screenshots: ["home:/:desktop"]
    }],
    excluded: [],
    mutation: { enabled: false, operators: [], minScore: 0.7, reasons: [] },
    providerPolicy: []
  };
  const fingerprint = "visual-hive:fixture:card";
  const rootCauseKey = "finding/visual_regression/card";
  const finding: PlaywrightRepairCaptureFinding = {
    fingerprint,
    repositoryFingerprint: visualHiveObservationRepositoryFingerprint(repository, fingerprint, "canonical", rootCauseKey),
    publicationRole: "canonical",
    rootCauseKey,
    blockedByRootKeys: [],
    issueKind: "visual_regression",
    severity: "high",
    owningAgentHint: "hive/quality",
    title: "Card rendering differs from its baseline",
    body: "The deterministic Playwright screenshot for the card differs.",
    labels: ["visual-hive"],
    sourceArtifacts: [],
    affectedContracts: ["contract.card"],
    affectedObligationIds: ["obligation.card"],
    affectedAssertions: [{ contractId: "contract.card", screenshotName: "home", route: "/", state: "default", viewportId: "desktop" }],
    firstSeenAt: "2026-07-14T12:00:00.000Z"
  };
  const budgetLimits: HiveRepairBudgetLimits = {
    maxTurns: 8,
    maxToolCalls: 8,
    maxInputBytes: 4 * 1024 * 1024,
    maxImageBytes: 32 * 1024 * 1024,
    maxModelInputTokens: 100_000,
    maxModelOutputTokens: 20_000,
    maxProviderCostUsdMicros: 1_000_000,
    maxWallSeconds: 120,
    maxRepairAttempts: 2
  };
  const authorization = buildHiveExecutionAuthorization({
    authorizationId: "authorization.browser-card",
    issuedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
    repositoryFingerprint,
    taskContextDigest: task.contextDigest,
    baseSha,
    profile: task.profiles[0]!,
    toolNames: [...VISUAL_REPAIR_TOOL_NAMES],
    assetIds: [],
    budgetDigest: canonicalSha256(budgetLimits),
    configDigest: canonicalSha256(config),
    toolRegistryDigest: canonicalSha256(VISUAL_REPAIR_TOOL_NAMES),
    promptSchemaDigest: canonicalSha256("fixture-prompt-schema"),
    visualHiveManifestSha256: "b".repeat(64),
    visualHiveEntrypointSha256: "c".repeat(64)
  });
  const fixture = { rootDir, server, page, url, repository, repositoryId, baseSha, config, plan, task, profile: task.profiles[0]!, finding, authorization, budgetLimits };
  fixtures.push(fixture);
  return fixture;
}

function validationRequest(fixture: RepairFixture, commitSha: string, phase: "before" | "after"): HiveRepairValidationRequestSpec {
  return buildRequest(fixture, commitSha, phase);
}

function buildRequest(fixture: RepairFixture, commitSha: string, phase: "before" | "after"): HiveRepairValidationRequestSpec {
  return buildHiveRepairValidationRequestSpec({
    sessionId: canonicalSha256({ repository: fixture.repository, baseSha: fixture.baseSha }),
    attemptId: "attempt.0",
    kind: phase === "before" ? "reproduction" : "patch_validation",
    commitRole: phase === "before" ? "base" : "candidate",
    profileId: fixture.profile.profileId,
    profileDigest: fixture.profile.profileDigest,
    commitSha,
    authorizationDigest: fixture.authorization.authorizationDigest
  });
}

function captureOptions(
  fixture: RepairFixture,
  brokerRequest: HiveRepairValidationRequestSpec,
  phase: "before" | "after"
): RunPlaywrightRepairCaptureOptions {
  return {
    rootDir: fixture.rootDir,
    config: fixture.config,
    plan: fixture.plan,
    taskContext: fixture.task,
    brokerRequest,
    executionAuthorization: fixture.authorization,
    budgetLimits: fixture.budgetLimits,
    phase,
    finding: fixture.finding,
    producer: {
      identityKind: "verified_release_manifest",
      visualHiveVersion: "0.3.2-test",
      visualHiveCommit: "a".repeat(40),
      manifestSha256: "b".repeat(64),
      entrypointSha256: "c".repeat(64)
    },
    expectedProducer: {
      visualHiveVersion: "0.3.2-test",
      visualHiveCommit: "a".repeat(40),
      manifestSha256: "b".repeat(64),
      entrypointSha256: "c".repeat(64)
    },
    source: { ref: "refs/heads/main", event: "local", trusted: false }
  };
}

function pageHtml(label: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;min-height:100%;background:#fff;font-family:Arial,sans-serif}.card{box-sizing:border-box;width:240px;height:100px;margin:20px;padding:16px;background:#0f172a;color:#fff;border:4px solid #38bdf8}</style></head><body><main class="card">${label}</main></body></html>`;
}

function allSerializedPaths(result: Awaited<ReturnType<typeof runPlaywrightRepairCapture>>): string {
  return JSON.stringify({ report: result.report, runContext: result.runContext, manifest: result.bundleManifest });
}

async function verifyBundledFiles(rootDir: string, bundleDirectory: string, manifest: Awaited<ReturnType<typeof runPlaywrightRepairCapture>>["bundleManifest"]): Promise<void> {
  for (const file of manifest.files) {
    const bytes = await readFile(path.join(rootDir, ...bundleDirectory.split("/"), ...file.path.split("/")));
    expect(bytes.byteLength).toBe(file.size);
    expect(sha256Bytes(bytes)).toBe(file.sha256);
  }
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, timeout: 10_000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
  return stdout.trim();
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
