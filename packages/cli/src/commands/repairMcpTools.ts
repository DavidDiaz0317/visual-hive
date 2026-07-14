import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  RelativeArtifactPathSchema,
  VISUAL_REPAIR_MAX_JSON_BYTES as MAX_JSON_BYTES,
  VisualRepairAssetLocatorSchema as AssetLocatorSchema,
  VisualRepairCompareAssetsInputSchema as CompareAssetsInputSchema,
  VisualRepairGetBrowserEvidenceInputSchema as GetBrowserEvidenceInputSchema,
  VisualRepairGetIssueContextInputSchema as GetIssueContextInputSchema,
  VisualRepairGetScreenshotSetInputSchema as GetScreenshotSetInputSchema,
  VisualRepairGetTaskContextInputSchema as GetTaskContextInputSchema,
  VisualRepairGetValidationInputSchema as GetRepairValidationInputSchema,
  VisualRepairGetVisualAssetInputSchema as GetVisualAssetInputSchema,
  VisualRepairSearchSurfaceInputSchema as SearchSurfaceInputSchema,
  compareVisualPngBytes,
  computeVisualRepairSessionStorageId,
  loadVisualRunEvidenceAsset,
  loadVisualTaskAsset,
  parseVisualHiveTaskContext,
  parseVisualRepairValidation,
  parseVisualRunContext,
  sanitizeArtifactPathsForMarkdown,
  sanitizeText,
  sha256Bytes,
  stableTextCompare,
  type VisualHiveTaskContext,
  type VisualRunContext
} from "@visual-hive/core";
import { z } from "zod";

export interface VisualRepairMcpToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodTypeAny;
}

export const VISUAL_REPAIR_MCP_TOOL_DEFINITIONS: readonly VisualRepairMcpToolDefinition[] = [
  {
    name: "visual_hive_get_task_context",
    title: "Get Visual Repair Task Context",
    description: "Read one exact, digest-bound multimodal task context with bounded section pagination.",
    inputSchema: GetTaskContextInputSchema
  },
  {
    name: "visual_hive_get_issue_context",
    title: "Get Exact Issue Context",
    description: "Read one exact issue fingerprint for a digest-bound task; never selects the first active issue.",
    inputSchema: GetIssueContextInputSchema
  },
  {
    name: "visual_hive_search_surface",
    title: "Search Task Surface",
    description: "Search bounded task-specific graph candidates and source spans without rescanning or executing code.",
    inputSchema: SearchSurfaceInputSchema
  },
  {
    name: "visual_hive_get_visual_asset",
    title: "Get Visual Asset",
    description: "Return one verified task image as actual MCP image content plus content and repository identity.",
    inputSchema: GetVisualAssetInputSchema
  },
  {
    name: "visual_hive_get_screenshot_set",
    title: "Get Screenshot Set",
    description: "Return a bounded page of verified screenshots for one run, contract, screenshot, and viewport selection.",
    inputSchema: GetScreenshotSetInputSchema
  },
  {
    name: "visual_hive_get_browser_evidence",
    title: "Get Browser Evidence",
    description: "Return deterministic browser assertions and verified images for one run and contract.",
    inputSchema: GetBrowserEvidenceInputSchema
  },
  {
    name: "visual_hive_compare_assets",
    title: "Compare Visual Assets",
    description: "Compare two verified PNG assets in memory with the fixed deterministic Visual Hive algorithm.",
    inputSchema: CompareAssetsInputSchema
  },
  {
    name: "visual_hive_get_repair_validation",
    title: "Get Repair Validation",
    description: "Read one exact deterministic repair-validation receipt and verify its canonical identity.",
    inputSchema: GetRepairValidationInputSchema
  }
] as const;

export const VISUAL_REPAIR_MCP_TOOL_NAMES = new Set(VISUAL_REPAIR_MCP_TOOL_DEFINITIONS.map((tool) => tool.name));

export async function callVisualRepairMcpTool(rootDir: string, toolName: string, rawArguments: unknown): Promise<CallToolResult> {
  try {
    switch (toolName) {
      case "visual_hive_get_task_context":
        return await getTaskContext(rootDir, GetTaskContextInputSchema.parse(rawArguments));
      case "visual_hive_get_issue_context":
        return await getIssueContext(rootDir, GetIssueContextInputSchema.parse(rawArguments));
      case "visual_hive_search_surface":
        return await searchSurface(rootDir, SearchSurfaceInputSchema.parse(rawArguments));
      case "visual_hive_get_visual_asset":
        return await getVisualAsset(rootDir, GetVisualAssetInputSchema.parse(rawArguments));
      case "visual_hive_get_screenshot_set":
        return await getScreenshotSet(rootDir, GetScreenshotSetInputSchema.parse(rawArguments));
      case "visual_hive_get_browser_evidence":
        return await getBrowserEvidence(rootDir, GetBrowserEvidenceInputSchema.parse(rawArguments));
      case "visual_hive_compare_assets":
        return await compareAssets(rootDir, CompareAssetsInputSchema.parse(rawArguments));
      case "visual_hive_get_repair_validation":
        return await getRepairValidation(rootDir, GetRepairValidationInputSchema.parse(rawArguments));
      default:
        throw new Error(`Parameterized Visual Hive tool ${toolName} is not registered.`);
    }
  } catch (error) {
    return errorResult(rootDir, toolName, error);
  }
}

async function getTaskContext(rootDir: string, input: z.infer<typeof GetTaskContextInputSchema>): Promise<CallToolResult> {
  const { context } = await loadTask(rootDir, input);
  if (context.repository.baseSha !== input.baseSha) throw new Error("Task context base commit does not match the requested commit.");
  const binding = taskBinding(context);
  let result: Record<string, unknown>;
  switch (input.section) {
    case "summary":
      result = {
        issue: {
          source: context.issue.source,
          externalId: context.issue.externalId,
          title: context.issue.title,
          problemStatementSha256: context.issue.problemStatementSha256
        },
        counts: {
          assets: context.assets.length,
          graphCandidates: context.graphCandidates.length,
          profiles: context.profiles.length,
          obligations: context.obligations.length,
          sourceFiles: context.sourceContext.files.length
        },
        safety: context.safety
      };
      break;
    case "issue": {
      const start = Math.min(input.cursor, context.issue.problemStatement.length);
      const end = Math.min(start + input.maxChars, context.issue.problemStatement.length);
      result = {
        issue: { ...context.issue, problemStatement: context.issue.problemStatement.slice(start, end) },
        page: pageMetadata(start, end - start, context.issue.problemStatement.length)
      };
      break;
    }
    case "assets":
      result = paged("assets", context.assets, input.cursor, input.limit);
      break;
    case "graph":
      result = paged("graphCandidates", context.graphCandidates, input.cursor, input.limit);
      break;
    case "profiles":
      result = paged("profiles", context.profiles, input.cursor, input.limit);
      break;
    case "obligations":
      result = paged("obligations", context.obligations, input.cursor, input.limit);
      break;
    case "source":
      result = { ...paged("files", context.sourceContext.files, input.cursor, input.limit), omittedPaths: context.sourceContext.omittedPaths, truncated: context.sourceContext.truncated };
      break;
  }
  return textResult(rootDir, { schemaVersion: "visual-hive.mcp-tool-result.v1", tool: "visual_hive_get_task_context", binding, section: input.section, result });
}

async function getIssueContext(rootDir: string, input: z.infer<typeof GetIssueContextInputSchema>): Promise<CallToolResult> {
  const { context } = await loadTask(rootDir, input);
  const bytes = await readContainedFile(rootDir, ".visual-hive/issues.json", MAX_JSON_BYTES);
  const issues = parseJsonObject(bytes, ".visual-hive/issues.json");
  const candidates = Array.isArray(issues.issues) ? issues.issues.filter(isRecord) : [];
  const matches = candidates.filter((issue) => readRawString(issue, "dedupeFingerprint") === input.issueFingerprint);
  if (matches.length !== 1) throw new Error(`Expected one issue with fingerprint ${input.issueFingerprint}; found ${matches.length}.`);
  const issue = matches[0]!;
  return textResult(rootDir, {
    schemaVersion: "visual-hive.mcp-tool-result.v1",
    tool: "visual_hive_get_issue_context",
    binding: { ...taskBinding(context), issueExternalId: context.issue.externalId, issueFingerprint: input.issueFingerprint, issuesArtifactSha256: sha256Bytes(bytes) },
    issue: boundedObject(issue),
    safety: readOnlySafety()
  });
}

async function searchSurface(rootDir: string, input: z.infer<typeof SearchSurfaceInputSchema>): Promise<CallToolResult> {
  const { context } = await loadTask(rootDir, input);
  const tokens = normalizedTokens(input.query);
  const allowedKinds = new Set(input.kinds);
  const matches = context.graphCandidates
    .filter((candidate) => allowedKinds.size === 0 || allowedKinds.has(candidate.kind))
    .map((candidate) => {
      const haystack = [candidate.nodeId, candidate.kind, candidate.label, ...candidate.reasons, ...candidate.sourceSpans.map((span) => span.path)].join(" ").toLowerCase();
      const matchedTokens = tokens.filter((token) => haystack.includes(token));
      return { candidate, matchedTokens, score: candidate.score + matchedTokens.length / Math.max(tokens.length, 1) };
    })
    .filter((match) => match.matchedTokens.length > 0)
    .sort((left, right) => right.score - left.score || stableTextCompare(left.candidate.nodeId, right.candidate.nodeId));
  const page = matches.slice(input.cursor, input.cursor + input.limit);
  return textResult(rootDir, {
    schemaVersion: "visual-hive.mcp-tool-result.v1",
    tool: "visual_hive_search_surface",
    binding: taskBinding(context),
    query: input.query,
    kinds: input.kinds,
    matches: page,
    page: pageMetadata(input.cursor, page.length, matches.length),
    safety: readOnlySafety()
  });
}

async function getVisualAsset(rootDir: string, input: z.infer<typeof GetVisualAssetInputSchema>): Promise<CallToolResult> {
  const { context, taskRoot } = await loadTask(rootDir, input);
  const loaded = await loadVisualTaskAsset({
    evidenceRoot: taskRoot,
    taskContext: context,
    taskId: context.taskId,
    repository: context.repository.name,
    commitSha: context.repository.baseSha,
    assetId: input.assetId,
    maxBytes: input.maxBytes
  });
  return imageResult(rootDir, {
    schemaVersion: "visual-hive.mcp-tool-result.v1",
    tool: "visual_hive_get_visual_asset",
    binding: taskBinding(context),
    asset: loaded.asset,
    safety: readOnlySafety()
  }, [{ data: loaded.data, mimeType: loaded.asset.mediaType }]);
}

async function getScreenshotSet(rootDir: string, input: z.infer<typeof GetScreenshotSetInputSchema>): Promise<CallToolResult> {
  const { context, taskRoot } = await loadTask(rootDir, input);
  const run = await loadRun(rootDir, context, input.runId, input.runContextDigest, input.commitSha);
  const requestedRoles = new Set(input.roles);
  const matching = run.evidenceAssets
    .filter((asset) => asset.assertion.contractId === input.contractId)
    .filter((asset) => asset.assertion.screenshotName === input.screenshotName)
    .filter((asset) => asset.assertion.route === input.route && asset.assertion.state === input.state && asset.assertion.viewportId === input.viewportId)
    .filter((asset) => requestedRoles.has(asset.role as "baseline" | "actual" | "diff"))
    .sort((left, right) => screenshotRoleOrder(left.role) - screenshotRoleOrder(right.role) || stableTextCompare(left.assetId, right.assetId));
  if (matching.length === 0) throw new Error(`No screenshot evidence matched the requested assertion identity in run ${input.runId}.`);
  for (const role of input.roles) {
    const count = matching.filter((asset) => asset.role === role).length;
    if (count > 1) throw new Error(`Screenshot assertion has ${count} ambiguous ${role} assets.`);
  }
  const selected = matching;
  const images = await Promise.all(selected.map(async (asset) => {
    const loaded = await loadVisualRunEvidenceAsset({
      evidenceRoot: taskRoot,
      runContext: run,
      taskId: context.taskId,
      taskContextDigest: context.contextDigest,
      repository: context.repository.name,
      commitSha: run.repository.commitSha,
      runId: run.runId,
      assetId: asset.assetId,
      maxBytes: input.maxBytesPerImage
    });
    return { data: loaded.data, mimeType: loaded.asset.mediaType };
  }));
  return imageResult(rootDir, {
    schemaVersion: "visual-hive.mcp-tool-result.v1",
    tool: "visual_hive_get_screenshot_set",
    binding: runBinding(context, run),
    assertion: { contractId: input.contractId, screenshotName: input.screenshotName, route: input.route, state: input.state, viewportId: input.viewportId },
    assets: selected,
    safety: readOnlySafety()
  }, images);
}

async function getBrowserEvidence(rootDir: string, input: z.infer<typeof GetBrowserEvidenceInputSchema>): Promise<CallToolResult> {
  const { context, taskRoot } = await loadTask(rootDir, input);
  const run = await loadRun(rootDir, context, input.runId, input.runContextDigest, input.commitSha);
  const reportBytes = await readDeclaredFile(taskRoot, run.report.path, run.report.sha256, MAX_JSON_BYTES);
  const report = parseJsonObject(reportBytes, run.report.path);
  verifyReportIdentity(report, context, run);
  const results = Array.isArray(report.results) ? report.results.filter(isRecord).filter((result) => readRawString(result, "contractId") === input.contractId) : [];
  if (results.length !== 1) throw new Error(`Expected one browser result for contract ${input.contractId}; found ${results.length}.`);
  const result = results[0]!;
  const evidenceAssets = run.evidenceAssets
    .filter((asset) => asset.assertion.contractId === input.contractId && (asset.role === "actual" || asset.role === "diff" || asset.role === "reference"))
    .slice(0, input.maxImages);
  const images = input.includeImages
    ? await Promise.all(evidenceAssets.map(async (asset) => {
        const loaded = await loadVisualRunEvidenceAsset({
          evidenceRoot: taskRoot,
          runContext: run,
          taskId: context.taskId,
          taskContextDigest: context.contextDigest,
          repository: context.repository.name,
          commitSha: run.repository.commitSha,
          runId: run.runId,
          assetId: asset.assetId,
          maxBytes: input.maxBytesPerImage
        });
        return { data: loaded.data, mimeType: loaded.asset.mediaType };
      }))
    : [];
  return imageResult(rootDir, {
    schemaVersion: "visual-hive.mcp-tool-result.v1",
    tool: "visual_hive_get_browser_evidence",
    binding: { ...runBinding(context, run), reportSha256: run.report.sha256 },
    contractId: input.contractId,
    result: boundedBrowserResult(result),
    evidenceAssets,
    safety: readOnlySafety()
  }, images);
}

async function compareAssets(rootDir: string, input: z.infer<typeof CompareAssetsInputSchema>): Promise<CallToolResult> {
  const { context, taskRoot } = await loadTask(rootDir, input);
  const before = await loadAssetLocator(rootDir, taskRoot, context, input.before, input.maxBytesPerImage);
  const after = await loadAssetLocator(rootDir, taskRoot, context, input.after, input.maxBytesPerImage);
  if (before.mediaType !== "image/png" || after.mediaType !== "image/png") throw new Error("Deterministic direct asset comparison currently requires two PNG assets.");
  const comparison = compareVisualPngBytes(before.data, after.data);
  return imageResult(rootDir, {
    schemaVersion: "visual-hive.mcp-tool-result.v1",
    tool: "visual_hive_compare_assets",
    binding: taskBinding(context),
    before: before.identity,
    after: after.identity,
    comparison: {
      algorithm: comparison.algorithm,
      width: comparison.width,
      height: comparison.height,
      diffPixels: comparison.diffPixels,
      totalPixels: comparison.totalPixels,
      diffRatio: comparison.diffRatio,
      beforeSha256: comparison.beforeSha256,
      afterSha256: comparison.afterSha256,
      diffSha256: comparison.diffSha256
    },
    safety: readOnlySafety()
  }, [{ data: comparison.diffPng, mimeType: "image/png" }]);
}

async function getRepairValidation(rootDir: string, input: z.infer<typeof GetRepairValidationInputSchema>): Promise<CallToolResult> {
  const { context, sessionRelativeRoot } = await loadTask(rootDir, input);
  const relativePath = `${sessionRelativeRoot}/validations/${input.validationId}.json`;
  const bytes = await readContainedFile(rootDir, relativePath, MAX_JSON_BYTES);
  const receipt = parseVisualRepairValidation(JSON.parse(bytes.toString("utf8")) as unknown);
  if (receipt.validationId !== input.validationId || receipt.taskId !== context.taskId || receipt.taskContextDigest !== context.contextDigest || receipt.repository !== context.repository.name || receipt.baseSha !== context.repository.baseSha || receipt.findingFingerprint !== input.findingFingerprint || receipt.headSha !== input.headSha || receipt.receiptDigest !== input.receiptDigest) {
    throw new Error("Repair validation does not match the requested task, repository, base commit, or validation identity.");
  }
  const summary = {
    validationId: receipt.validationId,
    generatedAt: receipt.generatedAt,
    findingFingerprint: receipt.findingFingerprint,
    headSha: receipt.headSha,
    verdict: receipt.verdict,
    closureRecommendation: receipt.closureRecommendation,
    comparability: receipt.comparability,
    receiptDigest: receipt.receiptDigest
  };
  return textResult(rootDir, {
    schemaVersion: "visual-hive.mcp-tool-result.v1",
    tool: "visual_hive_get_repair_validation",
    binding: taskBinding(context),
    validation: input.detail === "full" ? receipt : summary,
    safety: readOnlySafety()
  });
}

async function loadTask(rootDir: string, input: { taskId: string; repository: string; taskContextDigest: string }): Promise<{ context: VisualHiveTaskContext; taskRoot: string; sessionRelativeRoot: string }> {
  const sessionStorageId = computeVisualRepairSessionStorageId({
    taskId: input.taskId,
    repository: input.repository,
    taskContextDigest: input.taskContextDigest
  });
  const sessionRelativeRoot = `.visual-hive/repair/sessions/${sessionStorageId}`;
  const relativePath = `${sessionRelativeRoot}/task-context.json`;
  const bytes = await readContainedFile(rootDir, relativePath, MAX_JSON_BYTES);
  const context = parseVisualHiveTaskContext(JSON.parse(bytes.toString("utf8")) as unknown);
  if (context.taskId !== input.taskId || context.repository.name !== input.repository || context.contextDigest !== input.taskContextDigest) {
    throw new Error("Task context does not match the requested task, repository, or digest identity.");
  }
  return { context, taskRoot: path.join(rootDir, ...sessionRelativeRoot.split("/")), sessionRelativeRoot };
}

async function loadRun(rootDir: string, task: VisualHiveTaskContext, runId: string, expectedDigest?: string, expectedCommit?: string): Promise<VisualRunContext> {
  const sessionStorageId = computeVisualRepairSessionStorageId({ taskId: task.taskId, repository: task.repository.name, taskContextDigest: task.contextDigest });
  const relativePath = `.visual-hive/repair/sessions/${sessionStorageId}/runs/${runId}/run-context.json`;
  const bytes = await readContainedFile(rootDir, relativePath, MAX_JSON_BYTES);
  const run = parseVisualRunContext(JSON.parse(bytes.toString("utf8")) as unknown);
  if (run.runId !== runId || run.taskId !== task.taskId || run.taskContextDigest !== task.contextDigest || run.repository.name !== task.repository.name || run.repository.repositoryId !== task.repository.repositoryId || run.repository.repositoryFingerprint !== task.repository.repositoryFingerprint) {
    throw new Error("Run context does not match the requested task or repository identity.");
  }
  if (expectedDigest !== undefined && run.runContextDigest !== expectedDigest) throw new Error("Run context digest does not match the requested run identity.");
  if (expectedCommit !== undefined && run.repository.commitSha !== expectedCommit) throw new Error("Run commit does not match the requested run identity.");
  return run;
}

async function loadAssetLocator(
  rootDir: string,
  taskRoot: string,
  context: VisualHiveTaskContext,
  locator: z.infer<typeof AssetLocatorSchema>,
  maxBytes: number
): Promise<{ data: Buffer; mediaType: string; identity: Record<string, unknown> }> {
  if (locator.source === "task") {
    const loaded = await loadVisualTaskAsset({
      evidenceRoot: taskRoot,
      taskContext: context,
      taskId: context.taskId,
      repository: context.repository.name,
      commitSha: context.repository.baseSha,
      assetId: locator.assetId,
      maxBytes
    });
    return { data: loaded.data, mediaType: loaded.asset.mediaType, identity: { source: "task", assetId: loaded.asset.assetId, sha256: loaded.asset.sha256, commitSha: loaded.commitSha } };
  }
  const run = await loadRun(rootDir, context, locator.runId, locator.runContextDigest, locator.commitSha);
  const loaded = await loadVisualRunEvidenceAsset({
    evidenceRoot: taskRoot,
    runContext: run,
    taskId: context.taskId,
    taskContextDigest: context.contextDigest,
    repository: context.repository.name,
    commitSha: run.repository.commitSha,
    runId: run.runId,
    assetId: locator.assetId,
    maxBytes
  });
  return { data: loaded.data, mediaType: loaded.asset.mediaType, identity: { source: "run", runId: run.runId, runContextDigest: run.runContextDigest, assetId: loaded.asset.assetId, sha256: loaded.asset.sha256, commitSha: run.repository.commitSha } };
}

async function readDeclaredFile(root: string, relativePath: string, expectedSha256: string, maxBytes: number): Promise<Buffer> {
  const normalized = RelativeArtifactPathSchema.parse(relativePath);
  const bytes = await readContainedFile(root, normalized, maxBytes);
  const digest = sha256Bytes(bytes);
  if (digest !== expectedSha256) throw new Error(`Declared artifact ${normalized} digest mismatch.`);
  return bytes;
}

async function readContainedFile(rootDir: string, relativePath: string, maxBytes: number): Promise<Buffer> {
  const normalized = RelativeArtifactPathSchema.parse(relativePath);
  const root = await realpath(path.resolve(rootDir));
  let current = root;
  const segments = normalized.split("/");
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    const entry = await lstat(current);
    if (entry.isSymbolicLink()) throw new Error(`Artifact path contains a symbolic link: ${normalized}.`);
    if (index < segments.length - 1 && !entry.isDirectory()) throw new Error(`Artifact path has a non-directory parent: ${normalized}.`);
  }
  const resolved = await realpath(current);
  const relative = path.relative(root, resolved);
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("Artifact resolved outside the repository root.");
  const handle = await open(resolved, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error(`Artifact is not a regular file: ${normalized}.`);
    if (stat.size <= 0 || stat.size > maxBytes) throw new Error(`Artifact ${normalized} exceeds its bounded retrieval size.`);
    const bytes = await handle.readFile();
    if (bytes.length !== stat.size) throw new Error(`Artifact changed while being read: ${normalized}.`);
    return bytes;
  } finally {
    await handle.close();
  }
}

function verifyReportIdentity(report: Record<string, unknown>, task: VisualHiveTaskContext, run: VisualRunContext): void {
  const repository = isRecord(report.repository) ? report.repository : undefined;
  if (readRawString(repository, "repository") !== task.repository.name || readRawString(repository, "commitSha") !== run.repository.commitSha) {
    throw new Error("Browser report repository or commit identity does not match the run context.");
  }
  const selectedContracts = Array.isArray(report.selectedContracts) ? report.selectedContracts.filter((value): value is string => typeof value === "string") : [];
  const expectedContracts = new Set(run.execution.cases.flatMap((executionCase) => executionCase.contractIds));
  if (selectedContracts.some((contractId) => !expectedContracts.has(contractId))) throw new Error("Browser report contains a contract outside the declared execution matrix.");
}

function taskBinding(task: VisualHiveTaskContext): Record<string, unknown> {
  return {
    taskId: task.taskId,
    taskContextDigest: task.contextDigest,
    sessionStorageId: computeVisualRepairSessionStorageId({ taskId: task.taskId, repository: task.repository.name, taskContextDigest: task.contextDigest }),
    repository: task.repository.name,
    repositoryId: task.repository.repositoryId,
    repositoryFingerprint: task.repository.repositoryFingerprint,
    baseSha: task.repository.baseSha
  };
}

function runBinding(task: VisualHiveTaskContext, run: VisualRunContext): Record<string, unknown> {
  return { ...taskBinding(task), runId: run.runId, runContextDigest: run.runContextDigest, commitSha: run.repository.commitSha, browser: run.execution.browser, environment: run.execution.environment };
}

function boundedBrowserResult(result: Record<string, unknown>): Record<string, unknown> {
  return {
    contractId: readRawString(result, "contractId"),
    targetId: readRawString(result, "targetId"),
    status: readRawString(result, "status"),
    durationMs: result.durationMs,
    errors: boundedArray(result.errors, 64),
    selectorAssertions: boundedArray(result.selectorAssertions, 128),
    flowSteps: boundedArray(result.flowSteps, 128),
    screenshotAssertions: boundedArray(result.screenshotAssertions, 64),
    consoleErrors: boundedArray(result.consoleErrors, 64),
    pageErrors: boundedArray(result.pageErrors, 64),
    networkErrors: boundedArray(result.networkErrors, 64)
  };
}

function boundedObject(value: Record<string, unknown>): Record<string, unknown> {
  const entries = Object.entries(value).slice(0, 128);
  return Object.fromEntries(entries.map(([key, child]) => [key, Array.isArray(child) ? child.slice(0, 128) : child]));
}

function boundedArray(value: unknown, limit: number): unknown[] {
  return Array.isArray(value) ? value.slice(0, limit) : [];
}

function normalizedTokens(value: string): string[] {
  return [...new Set(value.toLowerCase().split(/[^a-z0-9_.:@+~/-]+/u).filter((token) => token.length > 1))].slice(0, 32);
}

function screenshotRoleOrder(role: string): number {
  return role === "baseline" ? 0 : role === "actual" ? 1 : role === "diff" ? 2 : 3;
}

function paged(name: string, values: unknown[], cursor: number, limit: number): Record<string, unknown> {
  const selected = values.slice(cursor, cursor + limit);
  return { [name]: selected, page: pageMetadata(cursor, selected.length, values.length) };
}

function pageMetadata(cursor: number, count: number, total: number): Record<string, unknown> {
  const next = cursor + count;
  return { cursor, count, total, nextCursor: next < total ? next : null };
}

function parseJsonObject(bytes: Buffer, displayPath: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`Artifact ${displayPath} is not valid JSON.`);
  }
  if (!isRecord(parsed) || Array.isArray(parsed)) throw new Error(`Artifact ${displayPath} must contain a JSON object.`);
  return parsed;
}

function readRawString(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const entry = value[key];
  return typeof entry === "string" ? entry : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readOnlySafety(): Record<string, unknown> {
  return { readOnly: true, deterministic: true, externalCallsMade: 0, networkCallsMade: 0, writesMade: 0 };
}

function textResult(rootDir: string, value: Record<string, unknown>): CallToolResult {
  const text = sanitizeArtifactPathsForMarkdown(rootDir, sanitizeText(JSON.stringify(value, null, 2)));
  return { content: [{ type: "text", text }] };
}

function imageResult(rootDir: string, value: Record<string, unknown>, images: Array<{ data: Buffer; mimeType: string }>): CallToolResult {
  const result = textResult(rootDir, value);
  for (const image of images) result.content.push({ type: "image", data: image.data.toString("base64"), mimeType: image.mimeType });
  return result;
}

function errorResult(rootDir: string, toolName: string, error: unknown): CallToolResult {
  const raw = error instanceof Error ? error.message : String(error);
  const message = sanitizeArtifactPathsForMarkdown(rootDir, sanitizeText(raw)).slice(0, 2048);
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ schemaVersion: "visual-hive.mcp-tool-error.v1", tool: toolName, error: message, retryable: false }) }]
  };
}
