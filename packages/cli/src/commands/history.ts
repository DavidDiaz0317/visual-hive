import path from "node:path";
import {
  createRunHistoryEntry,
  createRunHistoryReport,
  loadConfig,
  readJson,
  recordRunHistory,
  type MutationReport,
  type Plan,
  type Report,
  type RunHistoryFiles,
  type RunHistoryReport
} from "@visual-hive/core";

export interface HistoryCommandOptions {
  config?: string;
  cwd?: string;
  record?: boolean;
  maxEntries?: number;
  format?: "markdown" | "json";
}

export async function runHistoryCommand(options: HistoryCommandOptions = {}): Promise<{ history: RunHistoryReport; historyPath: string; recorded: boolean }> {
  const cwd = options.cwd ?? process.cwd();
  const loaded = await loadConfig(options.config, cwd);
  const hiveRoot = path.join(loaded.rootDir, ".visual-hive");
  const historyPath = path.join(hiveRoot, "history.json");
  if (options.record) {
    const history = await recordRunHistory({ repoRoot: loaded.rootDir, hiveRoot, maxEntries: options.maxEntries });
    return { history, historyPath, recorded: true };
  }
  try {
    const history = await readJson<RunHistoryReport>(historyPath);
    return { history, historyPath, recorded: false };
  } catch {
    const history = await transientLatestHistory(loaded.rootDir, hiveRoot);
    return { history, historyPath, recorded: false };
  }
}

export function formatHistorySummary(history: RunHistoryReport, historyPath: string, format: "markdown" | "json" = "markdown", recorded = false): string {
  if (format === "json") {
    return JSON.stringify(history, null, 2);
  }
  const lines = [
    `${recorded ? "Recorded" : "Read"} ${historyPath}`,
    `# Run History: ${history.project}`,
    "",
    `- Runs: ${history.summary.runCount}`,
    `- Passed: ${history.summary.passedRuns}`,
    `- Failed: ${history.summary.failedRuns}`,
    `- Latest status: ${history.summary.latestStatus ?? "unknown"}`,
    `- Latest mutation score: ${history.summary.latestMutationScore === undefined ? "not available" : `${Math.round(history.summary.latestMutationScore * 100)}%`}`,
    `- Total visual diffs: ${history.summary.totalVisualDiffs}`,
    `- Total missing baselines: ${history.summary.totalMissingBaselines}`,
    "",
    "## Entries"
  ];
  for (const entry of history.entries.slice(0, 10)) {
    lines.push(
      `- ${entry.id}: status=${entry.deterministicStatus ?? "unknown"} mode=${entry.mode ?? "unknown"} failed=${entry.failedContracts} mutation=${
        entry.mutationScore === undefined ? "n/a" : `${Math.round(entry.mutationScore * 100)}%`
      }`
    );
  }
  return lines.join("\n");
}

async function transientLatestHistory(repoRoot: string, hiveRoot: string): Promise<RunHistoryReport> {
  const [plan, report, mutationReport] = await Promise.all([
    readOptional<Plan>(path.join(hiveRoot, "plan.json")),
    readOptional<Report>(path.join(hiveRoot, "report.json")),
    readOptional<MutationReport>(path.join(hiveRoot, "mutation-report.json"))
  ]);
  if (!report && !mutationReport) {
    throw new Error("No Visual Hive history found. Run visual-hive run or visual-hive mutate, then use visual-hive history --record.");
  }
  const files: RunHistoryFiles = {
    plan: plan ? ".visual-hive/plan.json" : undefined,
    report: report ? ".visual-hive/report.json" : undefined,
    mutationReport: mutationReport ? ".visual-hive/mutation-report.json" : undefined
  };
  const now = new Date().toISOString();
  return createRunHistoryReport({
    project: report?.project ?? mutationReport?.project ?? "unknown",
    generatedAt: now,
    entries: [
      createRunHistoryEntry({
        repoRoot,
        id: "latest",
        recordedAt: now,
        files,
        plan,
        report,
        mutationReport
      })
    ]
  });
}

async function readOptional<T>(filePath: string): Promise<T | undefined> {
  try {
    return await readJson<T>(filePath);
  } catch {
    return undefined;
  }
}
