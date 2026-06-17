import { readdir } from "node:fs/promises";
import path from "node:path";
import {
  buildPlanLaneSummary,
  loadConfig,
  readJson,
  writeJson,
  type Plan,
  type PlanLaneSummaryReport
} from "@visual-hive/core";

export interface PlansCommandOptions {
  config?: string;
  cwd?: string;
  format?: "markdown" | "json";
}

export interface PlansCommandResult {
  report: PlanLaneSummaryReport;
  reportPath: string;
}

export async function runPlansCommand(options: PlansCommandOptions = {}): Promise<PlansCommandResult> {
  const cwd = options.cwd ?? process.cwd();
  const loaded = await loadConfig(options.config ?? "visual-hive.config.yaml", cwd);
  const hiveRoot = path.join(loaded.rootDir, ".visual-hive");
  const planFiles = await listPlanFiles(hiveRoot);
  const plans = await Promise.all(
    planFiles.map(async (fileName) => ({
      path: path.posix.join(".visual-hive", fileName),
      plan: await readJson<Plan>(path.join(hiveRoot, fileName))
    }))
  );
  const report = buildPlanLaneSummary(plans, new Date(), loaded.config.project.name);
  const reportPath = path.join(hiveRoot, "plans.json");
  await writeJson(reportPath, report);
  return { report, reportPath };
}

export function formatPlansSummary(report: PlanLaneSummaryReport, reportPath: string, format: "markdown" | "json" = "markdown"): string {
  if (format === "json") return JSON.stringify(report, null, 2);
  const lines = [
    `Wrote ${reportPath}`,
    `# Plan Lanes: ${report.project}`,
    "",
    `- Plans: ${report.planCount}`,
    `- Modes: ${report.summary.modes.join(", ") || "none"}`,
    `- Unique selected contracts: ${report.summary.selectedContracts}`,
    `- Unique selected targets: ${report.summary.selectedTargets}`,
    `- Empty plans: ${report.summary.emptyPlans}`,
    `- Review plans: ${report.summary.reviewPlans}`,
    `- Unsafe exclusions: ${report.summary.unsafeExcludedContracts}`,
    `- Expensive targets: ${report.summary.expensiveTargets}`,
    `- External calls planned: ${report.summary.externalCallsPlanned}`,
    "",
    "| Plan | Mode | Status | Contracts | Targets | Mutation | Review signals |",
    "| --- | --- | --- | ---: | --- | --- | --- |"
  ];
  for (const lane of report.lanes) {
    lines.push(
      `| ${lane.path} | ${lane.mode} | ${lane.status} | ${lane.selectedContracts.length} | ${lane.selectedTargets.join(", ") || "none"} | ${lane.mutationEnabled ? "enabled" : "disabled"} | ${lane.reasons.join("; ") || "none"} |`
    );
  }
  if (report.recommendations.length) {
    lines.push("", "## Recommendations", "", ...report.recommendations.map((recommendation) => `- ${recommendation}`));
  }
  return lines.join("\n");
}

async function listPlanFiles(hiveRoot: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(hiveRoot);
  } catch {
    return [];
  }
  return entries.filter((entry) => /^plan(?:\.[A-Za-z0-9_-]+)?\.json$/.test(entry)).sort();
}
