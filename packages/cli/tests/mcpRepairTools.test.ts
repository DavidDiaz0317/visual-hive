import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
  loadConfig,
  sha256Bytes,
  sha256Utf8,
  visualRepairSessionRelativeRoot,
  type VisualHiveTaskContext,
  type VisualRepairValidation,
  type VisualRunContext
} from "@visual-hive/core";
import { PNG } from "pngjs";
import { afterEach, describe, expect, it } from "vitest";
import { buildVisualRepairValidation } from "../../core/src/repair/build.js";
import { createVisualHiveMcpServer } from "../src/commands/mcp.js";

const roots: string[] = [];
const commit = (value: string): string => value.repeat(40);
const digest = (value: string): string => value.repeat(64);

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("parameterized Visual Hive repair MCP tools", () => {
  it("exposes exact schemas and returns identity-bound multimodal evidence", async () => {
    const fixture = await createFixture();
    const loaded = await loadConfig(undefined, fixture.root);
    const server = createVisualHiveMcpServer(loaded);
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
      expect(JSON.parse(textOf(screenshots)).assets.map((asset: { role: string }) => asset.role)).toEqual(["baseline", "actual", "diff"]);
      expect(imagesOf(screenshots)).toHaveLength(3);

      const browser = await client.callTool({
        name: "visual_hive_get_browser_evidence",
        arguments: { ...common, ...runIdentity }
      }, undefined, { timeout: 10_000 });
      expect(textOf(browser)).toContain("chromium");
      expect(textOf(browser)).toContain("selectorAssertions");
      expect(imagesOf(browser)).not.toHaveLength(0);

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

  it("fails closed on duplicate issue identities instead of selecting one", async () => {
    const fixture = await createFixture();
    await writeJsonFile(path.join(fixture.root, ".visual-hive", "issues.json"), {
      schemaVersion: "visual-hive.issues.v1",
      issues: [
        { dedupeFingerprint: "issue.target", title: "First duplicate" },
        { dedupeFingerprint: "issue.target", title: "Second duplicate" }
      ]
    });
    const loaded = await loadConfig(undefined, fixture.root);
    const server = createVisualHiveMcpServer(loaded);
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
          issueFingerprint: "issue.target"
        }
      }, undefined, { timeout: 10_000 });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain("found 2");
    } finally {
      await client.close();
      await server.close();
    }
  });
});

async function createFixture(): Promise<{
  root: string;
  task: VisualHiveTaskContext;
  run: VisualRunContext;
  validation: VisualRepairValidation;
  expected: Buffer;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-hive-repair-mcp-"));
  roots.push(root);
  await writeFile(path.join(root, "visual-hive.config.yaml"), `project:\n  name: repair-mcp\ntargets:\n  local:\n    kind: url\n    url: "http://127.0.0.1:4173"\ncontracts:\n  - id: contract.card\n    description: Card\n    target: local\n`, "utf8");

  const expected = makePng(10, 20, 30);
  const current = makePng(220, 30, 40);
  const task = makeTask(expected, current);
  const sessionRoot = path.join(root, ...visualRepairSessionRelativeRoot({ taskId: task.taskId, repository: task.repository.name, taskContextDigest: task.contextDigest }).split("/"));
  await mkdir(path.join(sessionRoot, "assets"), { recursive: true });
  await writeFile(path.join(sessionRoot, "assets", "expected.png"), expected);
  await writeFile(path.join(sessionRoot, "assets", "current.png"), current);
  await writeJsonFile(path.join(sessionRoot, "task-context.json"), task);

  await writeJsonFile(path.join(root, ".visual-hive", "issues.json"), {
    schemaVersion: "visual-hive.issues.v1",
    issues: [
      { dedupeFingerprint: "issue.unrelated", title: "First unrelated issue", status: "open_candidate" },
      { dedupeFingerprint: "issue.target", title: "Target issue", status: "open_candidate", affected: [{ contractId: "contract.card" }], guardrails: ["Keep deterministic thresholds"] }
    ]
  });

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
  const run = makeRun(task, expected, current, reportBytes);
  const runRoot = path.join(sessionRoot, "runs", run.runId);
  await mkdir(path.join(runRoot, "assets"), { recursive: true });
  await writeFile(path.join(runRoot, "assets", "baseline.png"), expected);
  await writeFile(path.join(runRoot, "assets", "actual.png"), current);
  await writeFile(path.join(runRoot, "assets", "diff.png"), current);
  await writeFile(path.join(runRoot, "report.json"), reportBytes);
  await writeJsonFile(path.join(runRoot, "run-context.json"), run);

  const validation = makeValidation(task, run);
  await writeJsonFile(path.join(sessionRoot, "validations", `${validation.validationId}.json`), validation);
  return { root, task, run, validation, expected };
}

function makeTask(expected: Buffer, current: Buffer): VisualHiveTaskContext {
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
      { assetId: "asset.expected", role: "expected", path: "assets/expected.png", mediaType: "image/png", sha256: sha256Bytes(expected), size: expected.length, width: 2, height: 2, provenance: { kind: "fixture", sourceId: "expected" }, regions: [] },
      { assetId: "asset.current", role: "current", path: "assets/current.png", mediaType: "image/png", sha256: sha256Bytes(current), size: current.length, width: 2, height: 2, provenance: { kind: "fixture", sourceId: "current" }, regions: [] }
    ],
    imageReferences: [
      { position: 0, assetId: "asset.expected", role: "expected" },
      { position: 1, assetId: "asset.current", role: "current" }
    ],
    graphCandidates: [{ nodeId: "component.card", kind: "component", label: "Responsive Card", score: 0.95, reasons: ["Issue names the card"], sourceSpans: [{ path: "src/Card.tsx", startLine: 1, endLine: 30 }] }],
    profiles: [{ ...profile, profileDigest: computeVisualValidationProfileDigest(profile) }],
    obligations: [{ obligationId: "obligation.card", description: "Card matches the reference", sourceAssetIds: ["asset.expected", "asset.current"], mappedContractIds: ["contract.card"], route: "/", state: "default", viewportId: "viewport.desktop", assertionKind: "pixel_region", authority: "deterministic", confidence: 1, status: "mapped" }],
    sourceContext: { digest: canonicalSha256({ files, omittedPaths: 0, truncated: false }), files, omittedPaths: 0, truncated: false }
  });
}

function makeRun(task: VisualHiveTaskContext, baseline: Buffer, actual: Buffer, reportBytes: Buffer): VisualRunContext {
  const cases = [{ caseId: "case.card", targetId: "target.app", route: "/", state: "default", viewport: { viewportId: "viewport.desktop", width: 2, height: 2, deviceScaleFactor: 1 }, contractIds: ["contract.card"] }];
  const thresholds = [{ contractId: "contract.card", maxDiffPixelRatio: 0, missingBaseline: "fail" as const }];
  const assertion = { contractId: "contract.card", screenshotName: "Card desktop state", route: "/", state: "default", viewportId: "viewport.desktop" };
  return buildVisualRunContext({
    schemaVersion: "visual-hive.run-context.v1",
    digestAlgorithm: "visual-hive.canonical-json.sha256.v1",
    generatedAt: "2026-07-14T16:05:00.000Z",
    runId: "run.before",
    phase: "before",
    taskId: task.taskId,
    taskContextDigest: task.contextDigest,
    findingFingerprint: "finding.card",
    repository: { name: task.repository.name, repositoryId: task.repository.repositoryId, repositoryFingerprint: task.repository.repositoryFingerprint, commitSha: task.repository.baseSha },
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
    producer: { visualHiveVersion: "0.3.2", visualHiveCommit: commit("c"), playwrightVersion: "1.54.1" },
    command: { validationCommandId: "command.playwright", startedAt: "2026-07-14T16:04:00.000Z", completedAt: "2026-07-14T16:05:00.000Z", exitCode: 1 },
    report: { path: "runs/run.before/report.json", sha256: sha256Bytes(reportBytes) },
    evidenceAssets: [
      { assetId: "asset.run.baseline", role: "baseline", path: "runs/run.before/assets/baseline.png", mediaType: "image/png", sha256: sha256Bytes(baseline), size: baseline.length, width: 2, height: 2, assertion, obligationIds: ["obligation.card"] },
      { assetId: "asset.run.actual", role: "actual", path: "runs/run.before/assets/actual.png", mediaType: "image/png", sha256: sha256Bytes(actual), size: actual.length, width: 2, height: 2, assertion, obligationIds: ["obligation.card"] },
      { assetId: "asset.run.diff", role: "diff", path: "runs/run.before/assets/diff.png", mediaType: "image/png", sha256: sha256Bytes(actual), size: actual.length, width: 2, height: 2, assertion, obligationIds: ["obligation.card"] }
    ],
    thresholds,
    capture: { status: "failed", failures: ["Visual mismatch"] }
  });
}

function makeValidation(task: VisualHiveTaskContext, run: VisualRunContext): VisualRepairValidation {
  const headSha = commit("b");
  return buildVisualRepairValidation({
    schemaVersion: "visual-hive.repair-validation.v1",
    generatedAt: "2026-07-14T16:10:00.000Z",
    validationId: "validation.card",
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

function makePng(red: number, green: number, blue: number): Buffer {
  const image = new PNG({ width: 2, height: 2 });
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

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.find((item) => item.type === "text")?.text ?? "";
}

function imagesOf(result: { content: Array<{ type: string; data?: string; mimeType?: string }> }): Array<{ data: string; mimeType: string }> {
  return result.content
    .filter((item): item is { type: "image"; data: string; mimeType: string } => item.type === "image" && typeof item.data === "string" && typeof item.mimeType === "string")
    .map((item) => ({ data: item.data, mimeType: item.mimeType }));
}
