import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Plan } from "../planner/types.js";
import type { MutationReport, Report, RepositoryMetadata } from "../reports/types.js";
import { getEvidenceResourceById } from "../tools/evidenceResources.js";
import { readJson, writeJson } from "../utils/files.js";
import { sanitizeText } from "../utils/sanitize.js";

export interface RunHistoryReport {
  schemaVersion: 1;
  project: string;
  generatedAt: string;
  summary: RunHistorySummary;
  trend: RunHistoryTrend;
  entries: RunHistoryEntry[];
  outputResource?: RunHistoryOutputResource;
}

export interface RunHistoryOutputResource {
  artifactPath: string;
  evidenceResourceId: string;
  evidenceResourceUri: string;
  evidenceResourceTitle: string;
  evidenceResourceDescription: string;
  evidenceReadToolName?: string;
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

export interface RunHistoryTrend {
  hasPrevious: boolean;
  direction: "improved" | "regressed" | "unchanged" | "unknown";
  statusChanged?: {
    from?: "passed" | "failed";
    to?: "passed" | "failed";
  };
  mutationScoreDelta?: number;
  failedContractsDelta?: number;
  visualDiffsDelta?: number;
  missingBaselinesDelta?: number;
  createdBaselinesDelta?: number;
  consoleErrorsDelta?: number;
  pageErrorsDelta?: number;
  reasons: string[];
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
  triageReport?: string;
  issue?: string;
  prComment?: string;
  triagePrompt?: string;
  repairPrompt?: string;
  missingTests?: string;
  baselineReview?: string;
  llmUsage?: string;
  coverage?: string;
  contracts?: string;
  flows?: string;
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
  { key: "triageReport", source: "triage.json", destination: "triage.json", type: "json" },
  { key: "issue", source: "issue.md", destination: "issue.md", type: "text" },
  { key: "prComment", source: "pr-comment.md", destination: "pr-comment.md", type: "text" },
  { key: "triagePrompt", source: "triage-prompt.md", destination: "triage-prompt.md", type: "text" },
  { key: "repairPrompt", source: "repair-prompt.md", destination: "repair-prompt.md", type: "text" },
  { key: "missingTests", source: "missing-tests.md", destination: "missing-tests.md", type: "text" },
  { key: "baselineReview", source: "baseline-review.md", destination: "baseline-review.md", type: "text" },
  { key: "llmUsage", source: "llm-usage.json", destination: "llm-usage.json", type: "json" },
  { key: "coverage", source: "coverage.json", destination: "coverage.json", type: "json" },
  { key: "contracts", source: "contracts.json", destination: "contracts.json", type: "json" },
  { key: "flows", source: "flows.json", destination: "flows.json", type: "json" },
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
    trend: createRunHistoryTrend(entries),
    entries,
    outputResource: catalogedRunHistoryOutputResource()
  };
}

function catalogedRunHistoryOutputResource(): RunHistoryOutputResource {
  const resource = getEvidenceResourceById("run-history");
  return {
    artifactPath: ".visual-hive/history.json",
    evidenceResourceId: resource?.id ?? "run-history",
    evidenceResourceUri: resource?.uri ?? "visual-hive://run-history",
    evidenceResourceTitle: resource?.title ?? "Run History",
    evidenceResourceDescription:
      resource?.description ??
      "Longitudinal local run history for deterministic status, mutation score, flake signals, baseline review, and cost/runtime trend evidence.",
    evidenceReadToolName: resource?.readTool?.name ?? "visual_hive_read_run_history"
  };
}

function createRunHistoryTrend(entries: RunHistoryEntry[]): RunHistoryTrend {
  const [latest, previous] = entries;
  if (!latest || !previous) {
    return {
      hasPrevious: false,
      direction: "unknown",
      reasons: ["At least two recorded runs are required to calculate a trend."]
    };
  }

  let score = 0;
  const reasons: string[] = [];
  if (latest.deterministicStatus !== previous.deterministicStatus) {
    if (previous.deterministicStatus === "failed" && latest.deterministicStatus === "passed") {
      score += 3;
      reasons.push("Deterministic status recovered from failed to passed.");
    } else if (previous.deterministicStatus === "passed" && latest.deterministicStatus === "failed") {
      score -= 3;
      reasons.push("Deterministic status regressed from passed to failed.");
    } else {
      reasons.push("Deterministic status changed.");
    }
  }

  score += scoreDelta(latest.mutationScore, previous.mutationScore, 1, "Mutation score", reasons, true);
  score += scoreDelta(latest.failedContracts, previous.failedContracts, 2, "Failed contracts", reasons, false);
  score += scoreDelta(latest.visualDiffs, previous.visualDiffs, 1, "Visual diffs", reasons, false);
  score += scoreDelta(latest.missingBaselines, previous.missingBaselines, 1, "Missing baselines", reasons, false);
  score += scoreDelta(latest.createdBaselines, previous.createdBaselines, 1, "Created baselines", reasons, false);
  score += scoreDelta(latest.consoleErrors, previous.consoleErrors, 1, "Console errors", reasons, false);
  score += scoreDelta(latest.pageErrors, previous.pageErrors, 1, "Page errors", reasons, false);

  return {
    hasPrevious: true,
    direction: score > 0 ? "improved" : score < 0 ? "regressed" : "unchanged",
    statusChanged:
      latest.deterministicStatus !== previous.deterministicStatus
        ? {
            from: previous.deterministicStatus,
            to: latest.deterministicStatus
          }
        : undefined,
    mutationScoreDelta: numericDelta(latest.mutationScore, previous.mutationScore),
    failedContractsDelta: latest.failedContracts - previous.failedContracts,
    visualDiffsDelta: latest.visualDiffs - previous.visualDiffs,
    missingBaselinesDelta: latest.missingBaselines - previous.missingBaselines,
    createdBaselinesDelta: latest.createdBaselines - previous.createdBaselines,
    consoleErrorsDelta: latest.consoleErrors - previous.consoleErrors,
    pageErrorsDelta: latest.pageErrors - previous.pageErrors,
    reasons: reasons.length ? reasons : ["Latest run is unchanged from the previous recorded run."]
  };
}

function scoreDelta(
  latest: number | undefined,
  previous: number | undefined,
  weight: number,
  label: string,
  reasons: string[],
  higherIsBetter: boolean
): number {
  const delta = numericDelta(latest, previous);
  if (delta === undefined || delta === 0) return 0;
  const improved = higherIsBetter ? delta > 0 : delta < 0;
  reasons.push(`${label} ${improved ? "improved" : "regressed"} by ${formatDelta(delta)}.`);
  return improved ? weight : -weight;
}

function numericDelta(latest: number | undefined, previous: number | undefined): number | undefined {
  if (latest === undefined || previous === undefined) return undefined;
  return latest - previous;
}

function formatDelta(delta: number): string {
  const rounded = Math.abs(delta) < 1 ? Math.round(delta * 1000) / 1000 : delta;
  return `${delta > 0 ? "+" : ""}${rounded}`;
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
