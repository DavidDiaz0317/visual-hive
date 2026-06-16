import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Plan } from "../planner/types.js";
import type { MutationReport, Report, RepositoryMetadata } from "../reports/types.js";
import { readJson, writeJson } from "../utils/files.js";
import { sanitizeText } from "../utils/sanitize.js";

export interface RunHistoryReport {
  schemaVersion: 1;
  project: string;
  generatedAt: string;
  summary: RunHistorySummary;
  entries: RunHistoryEntry[];
}

export interface RunHistorySummary {
  runCount: number;
  passedRuns: number;
  failedRuns: number;
  latestStatus?: "passed" | "failed";
  latestRecordedAt?: string;
  latestReportGeneratedAt?: string;
  averageMutationScore?: number;
  latestMutationScore?: number;
  totalVisualDiffs: number;
  totalMissingBaselines: number;
  totalCreatedBaselines: number;
}

export interface RunHistoryEntry {
  id: string;
  recordedAt: string;
  reportGeneratedAt?: string;
  repository?: Pick<RepositoryMetadata, "provider" | "repository" | "branch" | "baseBranch" | "commitSha" | "pullRequestNumber" | "runId">;
  mode?: Plan["mode"];
  deterministicStatus?: "passed" | "failed";
  mutationScore?: number;
  mutationKilled?: number;
  mutationTotal?: number;
  failedContracts: number;
  createdBaselines: number;
  missingBaselines: number;
  visualDiffs: number;
  consoleErrors: number;
  pageErrors: number;
  selectedTargets: string[];
  selectedContracts: string[];
  changedFiles: string[];
  providerStatuses: Array<{ providerId: string; label: string; status: string; deterministicRole: string }>;
  files: RunHistoryFiles;
  artifacts: string[];
}

export interface RunHistoryFiles {
  plan?: string;
  report?: string;
  mutationReport?: string;
  issue?: string;
  prComment?: string;
  triagePrompt?: string;
  repairPrompt?: string;
  missingTests?: string;
  baselineReview?: string;
  llmUsage?: string;
  coverage?: string;
  contracts?: string;
  targets?: string;
  schedules?: string;
}

export interface CreateRunHistoryEntryOptions {
  repoRoot: string;
  id: string;
  recordedAt: string;
  files: RunHistoryFiles;
  plan?: Plan;
  report?: Report;
  mutationReport?: MutationReport;
}

export interface RecordRunHistoryOptions {
  repoRoot: string;
  hiveRoot?: string;
  now?: Date;
  runId?: string;
  maxEntries?: number;
}

const DEFAULT_MAX_ENTRIES = 50;

const ARCHIVED_FILES: Array<{ key: keyof RunHistoryFiles; source: string; destination: string; type: "json" | "text" }> = [
  { key: "plan", source: "plan.json", destination: "plan.json", type: "json" },
  { key: "report", source: "report.json", destination: "report.json", type: "json" },
  { key: "mutationReport", source: "mutation-report.json", destination: "mutation-report.json", type: "json" },
  { key: "issue", source: "issue.md", destination: "issue.md", type: "text" },
  { key: "prComment", source: "pr-comment.md", destination: "pr-comment.md", type: "text" },
  { key: "triagePrompt", source: "triage-prompt.md", destination: "triage-prompt.md", type: "text" },
  { key: "repairPrompt", source: "repair-prompt.md", destination: "repair-prompt.md", type: "text" },
  { key: "missingTests", source: "missing-tests.md", destination: "missing-tests.md", type: "text" },
  { key: "baselineReview", source: "baseline-review.md", destination: "baseline-review.md", type: "text" },
  { key: "llmUsage", source: "llm-usage.json", destination: "llm-usage.json", type: "json" },
  { key: "coverage", source: "coverage.json", destination: "coverage.json", type: "json" },
  { key: "contracts", source: "contracts.json", destination: "contracts.json", type: "json" },
  { key: "targets", source: "targets.json", destination: "targets.json", type: "json" },
  { key: "schedules", source: "schedules.json", destination: "schedules.json", type: "json" }
];

export async function recordRunHistory(options: RecordRunHistoryOptions): Promise<RunHistoryReport> {
  const repoRoot = path.resolve(options.repoRoot);
  const hiveRoot = path.resolve(options.hiveRoot ?? path.join(repoRoot, ".visual-hive"));
  if (!isInsideOrEqual(repoRoot, hiveRoot)) {
    throw new Error(`Refusing to record history outside repository root: ${options.hiveRoot}`);
  }
  const now = options.now ?? new Date();
  const runId = options.runId ?? runIdFromDate(now);
  const historyDir = path.join(hiveRoot, "history", runId);
  await mkdir(historyDir, { recursive: true });

  const files: RunHistoryFiles = {};
  let plan: Plan | undefined;
  let report: Report | undefined;
  let mutationReport: MutationReport | undefined;

  for (const archived of ARCHIVED_FILES) {
    const sourcePath = path.join(hiveRoot, archived.source);
    const destinationPath = path.join(historyDir, archived.destination);
    if (!(await fileExists(sourcePath))) continue;
    if (archived.type === "text") {
      const raw = await readFile(sourcePath, "utf8");
      await writeSanitizedText(destinationPath, raw);
    } else {
      await copyFile(sourcePath, destinationPath);
    }
    files[archived.key] = toRepoRelativePath(repoRoot, destinationPath);
    if (archived.key === "plan") plan = await readJson<Plan>(sourcePath);
    if (archived.key === "report") report = await readJson<Report>(sourcePath);
    if (archived.key === "mutationReport") mutationReport = await readJson<MutationReport>(sourcePath);
  }

  if (!report && !mutationReport) {
    throw new Error("Cannot record Visual Hive history because neither .visual-hive/report.json nor .visual-hive/mutation-report.json exists.");
  }

  const entry = createRunHistoryEntry({
    repoRoot,
    id: runId,
    recordedAt: now.toISOString(),
    files,
    plan,
    report,
    mutationReport
  });

  const historyPath = path.join(hiveRoot, "history.json");
  const existing = await readOptionalHistory(historyPath);
  const entries = [entry, ...(existing?.entries ?? []).filter((candidate) => candidate.id !== entry.id)]
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))
    .slice(0, options.maxEntries ?? DEFAULT_MAX_ENTRIES);
  const history = createRunHistoryReport({
    project: report?.project ?? mutationReport?.project ?? existing?.project ?? "unknown",
    generatedAt: now.toISOString(),
    entries
  });
  await writeJson(historyPath, history);
  return history;
}

export function createRunHistoryEntry(options: CreateRunHistoryEntryOptions): RunHistoryEntry {
  const report = options.report;
  const mutationReport = options.mutationReport;
  return {
    id: sanitizeText(options.id),
    recordedAt: options.recordedAt,
    reportGeneratedAt: report?.generatedAt,
    repository: report?.repository
      ? {
          provider: report.repository.provider,
          repository: sanitizeText(report.repository.repository),
          branch: report.repository.branch ? sanitizeText(report.repository.branch) : undefined,
          baseBranch: report.repository.baseBranch ? sanitizeText(report.repository.baseBranch) : undefined,
          commitSha: report.repository.commitSha ? sanitizeText(report.repository.commitSha) : undefined,
          pullRequestNumber: report.repository.pullRequestNumber,
          runId: report.repository.runId ? sanitizeText(report.repository.runId) : undefined
        }
      : undefined,
    mode: report?.mode ?? options.plan?.mode,
    deterministicStatus: report?.status,
    mutationScore: mutationReport?.score,
    mutationKilled: mutationReport?.killed,
    mutationTotal: mutationReport?.total,
    failedContracts: report?.summary.failed ?? report?.results.filter((result) => result.status === "failed").length ?? 0,
    createdBaselines: report?.summary.createdBaselines ?? report?.summary.baselinesCreated ?? 0,
    missingBaselines: report?.summary.missingBaselines ?? 0,
    visualDiffs: report?.summary.visualDiffs ?? 0,
    consoleErrors: report?.summary.consoleErrors ?? 0,
    pageErrors: report?.summary.pageErrors ?? 0,
    selectedTargets: report?.selectedTargets.map((target) => target.id).sort() ?? options.plan?.targets.map((target) => target.id).sort() ?? [],
    selectedContracts: report?.selectedContracts.sort() ?? options.plan?.items.map((item) => item.contractId).sort() ?? [],
    changedFiles: (report?.changedFiles ?? options.plan?.changedFiles ?? []).map((file) => sanitizeText(file)),
    providerStatuses:
      report?.providerResults?.map((provider) => ({
        providerId: sanitizeText(provider.providerId),
        label: sanitizeText(provider.label),
        status: sanitizeText(provider.status),
        deterministicRole: sanitizeText(provider.deterministicRole)
      })) ?? [],
    files: sanitizeFiles(options.files),
    artifacts: [...new Set(report?.artifacts.map((artifact) => sanitizeText(normalizeSlashes(artifact))) ?? [])].sort()
  };
}

export function createRunHistoryReport(input: { project: string; generatedAt: string; entries: RunHistoryEntry[] }): RunHistoryReport {
  const entries = [...input.entries].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  const mutationScores = entries.map((entry) => entry.mutationScore).filter((score): score is number => typeof score === "number");
  return {
    schemaVersion: 1,
    project: sanitizeText(input.project),
    generatedAt: input.generatedAt,
    summary: {
      runCount: entries.length,
      passedRuns: entries.filter((entry) => entry.deterministicStatus === "passed").length,
      failedRuns: entries.filter((entry) => entry.deterministicStatus === "failed").length,
      latestStatus: entries[0]?.deterministicStatus,
      latestRecordedAt: entries[0]?.recordedAt,
      latestReportGeneratedAt: entries[0]?.reportGeneratedAt,
      averageMutationScore: mutationScores.length ? mutationScores.reduce((sum, score) => sum + score, 0) / mutationScores.length : undefined,
      latestMutationScore: entries.find((entry) => typeof entry.mutationScore === "number")?.mutationScore,
      totalVisualDiffs: entries.reduce((sum, entry) => sum + entry.visualDiffs, 0),
      totalMissingBaselines: entries.reduce((sum, entry) => sum + entry.missingBaselines, 0),
      totalCreatedBaselines: entries.reduce((sum, entry) => sum + entry.createdBaselines, 0)
    },
    entries
  };
}

async function readOptionalHistory(historyPath: string): Promise<RunHistoryReport | undefined> {
  try {
    return await readJson<RunHistoryReport>(historyPath);
  } catch {
    return undefined;
  }
}

async function writeSanitizedText(filePath: string, value: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, sanitizeText(value), "utf8");
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function sanitizeFiles(files: RunHistoryFiles): RunHistoryFiles {
  return Object.fromEntries(Object.entries(files).map(([key, value]) => [key, value ? sanitizeText(normalizeSlashes(value)) : value])) as RunHistoryFiles;
}

function runIdFromDate(date: Date): string {
  return date.toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

function toRepoRelativePath(repoRoot: string, filePath: string): string {
  return sanitizeText(normalizeSlashes(path.relative(repoRoot, filePath)));
}

function normalizeSlashes(value: string): string {
  return value.replaceAll("\\", "/");
}

function isInsideOrEqual(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
