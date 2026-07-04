import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { Report, ScreenshotAssertionResult } from "../reports/types.js";
import { getEvidenceResourceById } from "../tools/evidenceResources.js";
import { ensureDir, readJson, writeJson } from "../utils/files.js";
import { sanitizeText } from "../utils/sanitize.js";

export interface BaselineCandidate {
  contractId: string;
  screenshotName: string;
  route: string;
  viewport: string;
  status: ScreenshotAssertionResult["status"];
  baselinePath: string;
  actualPath: string;
  diffPath?: string;
  maxDiffPixelRatio: number;
  actualDiffPixelRatio?: number;
  actualDiffPixels?: number;
  canApprove: boolean;
  canReject: boolean;
  approvedAt?: string;
  rejectedAt?: string;
  rejectionReason?: string;
}

export interface BaselineApproval {
  schemaVersion: 1;
  approvedAt: string;
  contractId: string;
  screenshotName: string;
  route: string;
  viewport: string;
  sourceStatus: ScreenshotAssertionResult["status"];
  actualPath: string;
  baselinePath: string;
  diffPath?: string;
  bytes: number;
}

export interface BaselineApprovalLog {
  schemaVersion: 1;
  outputResource?: BaselineOutputResource;
  approvals: BaselineApproval[];
}

export interface BaselineRejection {
  schemaVersion: 1;
  rejectedAt: string;
  contractId: string;
  screenshotName: string;
  route: string;
  viewport: string;
  sourceStatus: ScreenshotAssertionResult["status"];
  actualPath: string;
  baselinePath: string;
  diffPath?: string;
  reason?: string;
}

export interface BaselineRejectionLog {
  schemaVersion: 1;
  outputResource?: BaselineOutputResource;
  rejections: BaselineRejection[];
}

export interface BaselineList {
  schemaVersion: 1;
  project: string;
  generatedAt: string;
  outputResource?: BaselineOutputResource;
  reportGeneratedAt: string;
  reportPath: string;
  approvalLogPath: string;
  rejectionLogPath: string;
  summary: BaselineSummary;
  entries: BaselineCandidate[];
}

export interface BaselineOutputResource {
  artifactPath: string;
  evidenceResourceId: string;
  evidenceResourceUri: string;
  evidenceResourceTitle: string;
  evidenceResourceDescription: string;
  evidenceReadToolName?: string;
}

export interface BaselineSummary {
  total: number;
  passed: number;
  failed: number;
  created: number;
  missingBaseline: number;
  approvable: number;
  approved: number;
  rejected: number;
  pendingReview: number;
}

export interface BaselineSelection {
  contractId: string;
  screenshotName: string;
  viewport?: string;
  route?: string;
}

export interface BaselineManageOptions {
  repoRoot?: string;
  reportPath?: string;
  now?: Date;
}

export async function listBaselines(options: BaselineManageOptions = {}): Promise<BaselineList> {
  const resolved = resolveBaselineOptions(options);
  const report = await readJson<Report>(resolved.reportPath);
  const approvals = await readApprovalLog(resolved.approvalLogPath);
  const rejections = await readRejectionLog(resolved.rejectionLogPath);
  const approvedKeys = new Map(approvals.approvals.map((approval) => [baselineKey(approval), approval.approvedAt]));
  const rejectedKeys = new Map(
    rejections.rejections.map((rejection) => [
      baselineKey(rejection),
      {
        rejectedAt: rejection.rejectedAt,
        reason: rejection.reason
      }
    ])
  );
  const entries = report.results.flatMap((result) =>
    (result.screenshotAssertions ?? []).map((screenshot) => {
      const baselinePath = resolveReportPath(resolved.repoRoot, screenshot.baselinePath, "baselinePath");
      const actualPath = resolveReportPath(resolved.repoRoot, screenshot.actualPath, "actualPath");
      const diffPath = screenshot.diffPath ? resolveReportPath(resolved.repoRoot, screenshot.diffPath, "diffPath") : undefined;
      const candidate = {
        contractId: screenshot.contractId || result.contractId,
        screenshotName: screenshot.screenshotName || screenshot.name,
        route: screenshot.route,
        viewport: screenshot.viewport,
        status: screenshot.status,
        baselinePath: toDisplayPath(resolved.repoRoot, baselinePath),
        actualPath: toDisplayPath(resolved.repoRoot, actualPath),
        diffPath: diffPath ? toDisplayPath(resolved.repoRoot, diffPath) : undefined,
        maxDiffPixelRatio: screenshot.maxDiffPixelRatio,
        actualDiffPixelRatio: screenshot.actualDiffPixelRatio,
        actualDiffPixels: screenshot.actualDiffPixels,
        canApprove: screenshot.status === "created" || screenshot.status === "failed" || screenshot.status === "missing_baseline",
        canReject: screenshot.status === "created" || screenshot.status === "failed" || screenshot.status === "missing_baseline"
      };
      const rejection = rejectedKeys.get(baselineKey(candidate));
      return {
        ...candidate,
        approvedAt: approvedKeys.get(baselineKey(candidate)),
        rejectedAt: rejection?.rejectedAt,
        rejectionReason: rejection?.reason
      };
    })
  );
  return {
    schemaVersion: 1,
    project: sanitizeText(report.project),
    generatedAt: (options.now ?? new Date()).toISOString(),
    outputResource: catalogedBaselineOutputResource("baseline-review", ".visual-hive/baselines.json"),
    reportGeneratedAt: sanitizeText(report.generatedAt),
    reportPath: resolved.reportPath,
    approvalLogPath: resolved.approvalLogPath,
    rejectionLogPath: resolved.rejectionLogPath,
    summary: summarizeBaselines(entries),
    entries
  };
}

export async function writeBaselineReview(options: BaselineManageOptions = {}): Promise<{ list: BaselineList; baselineReportPath: string }> {
  const resolved = resolveBaselineOptions(options);
  const list = await listBaselines(options);
  const baselineReportPath = path.join(path.dirname(resolved.reportPath), "baselines.json");
  await ensureDir(path.dirname(baselineReportPath));
  await writeJson(baselineReportPath, list);
  return { list, baselineReportPath };
}

export async function approveBaseline(options: BaselineManageOptions & BaselineSelection): Promise<BaselineApproval> {
  const resolved = resolveBaselineOptions(options);
  const report = await readJson<Report>(resolved.reportPath);
  const screenshot = selectScreenshot(report, options);
  const actualPath = resolveReportPath(resolved.repoRoot, screenshot.actualPath, "actualPath");
  const baselinePath = resolveReportPath(resolved.repoRoot, screenshot.baselinePath, "baselinePath");
  const diffPath = screenshot.diffPath ? resolveReportPath(resolved.repoRoot, screenshot.diffPath, "diffPath") : undefined;
  const actualStat = await stat(actualPath).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot approve baseline because the actual screenshot is missing: ${toDisplayPath(resolved.repoRoot, actualPath)}. ${sanitizeText(message)}`);
  });
  await mkdir(path.dirname(baselinePath), { recursive: true });
  await copyFile(actualPath, baselinePath);

  const approval: BaselineApproval = {
    schemaVersion: 1,
    approvedAt: new Date().toISOString(),
    contractId: screenshot.contractId,
    screenshotName: screenshot.screenshotName || screenshot.name,
    route: screenshot.route,
    viewport: screenshot.viewport,
    sourceStatus: screenshot.status,
    actualPath: toDisplayPath(resolved.repoRoot, actualPath),
    baselinePath: toDisplayPath(resolved.repoRoot, baselinePath),
    diffPath: diffPath ? toDisplayPath(resolved.repoRoot, diffPath) : undefined,
    bytes: actualStat.size
  };
  await appendApproval(resolved.approvalLogPath, approval);
  return approval;
}

export async function rejectBaseline(options: BaselineManageOptions & BaselineSelection & { reason?: string }): Promise<BaselineRejection> {
  const resolved = resolveBaselineOptions(options);
  const report = await readJson<Report>(resolved.reportPath);
  const screenshot = selectScreenshot(report, options);
  const actualPath = resolveReportPath(resolved.repoRoot, screenshot.actualPath, "actualPath");
  const baselinePath = resolveReportPath(resolved.repoRoot, screenshot.baselinePath, "baselinePath");
  const diffPath = screenshot.diffPath ? resolveReportPath(resolved.repoRoot, screenshot.diffPath, "diffPath") : undefined;
  const rejection: BaselineRejection = {
    schemaVersion: 1,
    rejectedAt: new Date().toISOString(),
    contractId: screenshot.contractId,
    screenshotName: screenshot.screenshotName || screenshot.name,
    route: screenshot.route,
    viewport: screenshot.viewport,
    sourceStatus: screenshot.status,
    actualPath: toDisplayPath(resolved.repoRoot, actualPath),
    baselinePath: toDisplayPath(resolved.repoRoot, baselinePath),
    diffPath: diffPath ? toDisplayPath(resolved.repoRoot, diffPath) : undefined,
    reason: options.reason ? sanitizeText(options.reason).trim().slice(0, 500) : undefined
  };
  await appendRejection(resolved.rejectionLogPath, rejection);
  return rejection;
}

function resolveBaselineOptions(options: BaselineManageOptions): { repoRoot: string; reportPath: string; approvalLogPath: string; rejectionLogPath: string } {
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  const reportPath = path.resolve(repoRoot, options.reportPath ?? path.join(".visual-hive", "report.json"));
  if (!isInsidePath(repoRoot, reportPath)) {
    throw new Error(`Refusing to read a report outside the repository: ${options.reportPath}`);
  }
  return {
    repoRoot,
    reportPath,
    approvalLogPath: path.join(path.dirname(reportPath), "baseline-approvals.json"),
    rejectionLogPath: path.join(path.dirname(reportPath), "baseline-rejections.json")
  };
}

function selectScreenshot(report: Report, selection: BaselineSelection): ScreenshotAssertionResult {
  const matches = report.results.flatMap((result) =>
    (result.screenshotAssertions ?? [])
      .filter((screenshot) => {
        const screenshotName = screenshot.screenshotName || screenshot.name;
        return (
          (screenshot.contractId || result.contractId) === selection.contractId &&
          screenshotName === selection.screenshotName &&
          (!selection.viewport || screenshot.viewport === selection.viewport) &&
          (!selection.route || screenshot.route === selection.route)
        );
      })
      .map((screenshot) => ({
        ...screenshot,
        contractId: screenshot.contractId || result.contractId,
        screenshotName: screenshot.screenshotName || screenshot.name
      }))
  );
  if (matches.length === 0) {
    throw new Error(
      `No screenshot assertion matched contract "${selection.contractId}" and screenshot "${selection.screenshotName}". Run "visual-hive baselines list" to inspect available baselines.`
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `Multiple screenshot assertions matched "${selection.contractId}/${selection.screenshotName}". Pass --viewport or --route to choose one.`
    );
  }
  return matches[0] as ScreenshotAssertionResult;
}

async function appendApproval(logPath: string, approval: BaselineApproval): Promise<void> {
  const log = await readApprovalLog(logPath);
  log.approvals.push(approval);
  await ensureDir(path.dirname(logPath));
  await writeJson(logPath, log);
}

async function appendRejection(logPath: string, rejection: BaselineRejection): Promise<void> {
  const log = await readRejectionLog(logPath);
  log.rejections.push(rejection);
  await ensureDir(path.dirname(logPath));
  await writeJson(logPath, log);
}

async function readApprovalLog(logPath: string): Promise<BaselineApprovalLog> {
  try {
    const raw = await readFile(logPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<BaselineApprovalLog>;
    return {
      schemaVersion: 1,
      outputResource: catalogedBaselineOutputResource("baseline-approvals", ".visual-hive/baseline-approvals.json"),
      approvals: Array.isArray(parsed.approvals) ? parsed.approvals : []
    };
  } catch {
    return {
      schemaVersion: 1,
      outputResource: catalogedBaselineOutputResource("baseline-approvals", ".visual-hive/baseline-approvals.json"),
      approvals: []
    };
  }
}

async function readRejectionLog(logPath: string): Promise<BaselineRejectionLog> {
  try {
    const raw = await readFile(logPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<BaselineRejectionLog>;
    return {
      schemaVersion: 1,
      outputResource: catalogedBaselineOutputResource("baseline-rejections", ".visual-hive/baseline-rejections.json"),
      rejections: Array.isArray(parsed.rejections) ? parsed.rejections : []
    };
  } catch {
    return {
      schemaVersion: 1,
      outputResource: catalogedBaselineOutputResource("baseline-rejections", ".visual-hive/baseline-rejections.json"),
      rejections: []
    };
  }
}

function catalogedBaselineOutputResource(resourceId: string, artifactPath: string): BaselineOutputResource {
  const resource = getEvidenceResourceById(resourceId);
  return {
    artifactPath,
    evidenceResourceId: resource?.id ?? resourceId,
    evidenceResourceUri: resource?.uri ?? `visual-hive://${resourceId}`,
    evidenceResourceTitle: resource?.title ?? resourceId,
    evidenceResourceDescription: resource?.description ?? "Visual Hive baseline governance evidence.",
    evidenceReadToolName: resource?.readTool?.name
  };
}

function resolveReportPath(repoRoot: string, value: string, label: string): string {
  const resolved = path.isAbsolute(value) ? path.resolve(value) : path.resolve(repoRoot, value);
  if (!isInsidePath(repoRoot, resolved)) {
    throw new Error(`Refusing to use ${label} outside repository root: ${sanitizeText(value)}`);
  }
  return resolved;
}

function toDisplayPath(repoRoot: string, filePath: string): string {
  return normalizeSlashes(path.relative(repoRoot, filePath));
}

function normalizeSlashes(value: string): string {
  return value.replaceAll("\\", "/");
}

function summarizeBaselines(entries: BaselineCandidate[]): BaselineSummary {
  const countStatus = (status: BaselineCandidate["status"]) => entries.filter((entry) => entry.status === status).length;
  const approved = entries.filter((entry) => entry.approvedAt).length;
  const rejected = entries.filter((entry) => entry.rejectedAt).length;
  return {
    total: entries.length,
    passed: countStatus("passed"),
    failed: countStatus("failed"),
    created: countStatus("created"),
    missingBaseline: countStatus("missing_baseline"),
    approvable: entries.filter((entry) => entry.canApprove).length,
    approved,
    rejected,
    pendingReview: entries.filter((entry) => entry.canApprove && !entry.approvedAt && !entry.rejectedAt).length
  };
}

function baselineKey(value: { contractId: string; screenshotName: string; route: string; viewport: string }): string {
  return `${value.contractId}\0${value.screenshotName}\0${value.route}\0${value.viewport}`;
}

function isInsidePath(parent: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
