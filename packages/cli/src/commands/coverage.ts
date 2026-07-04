import { readFile } from "node:fs/promises";
import path from "node:path";
import { analyzeCoverage, createPlan, loadConfig, readJson, writeJson, type CoverageReport, type Plan, type PlanMode } from "@visual-hive/core";
import { gitChangedFiles } from "./gitChangedFiles.js";
import { parsePlanMode } from "./plan.js";

export interface CoverageCommandOptions {
  config?: string;
  cwd?: string;
  plan?: string;
  mode?: PlanMode;
  changedFiles?: string;
  base?: string;
  allowUnsafeTargets?: boolean;
  includeContracts?: string[];
  excludeContracts?: string[];
  includeTargets?: string[];
  excludeTargets?: string[];
}

export async function runCoverageCommand(options: CoverageCommandOptions = {}): Promise<{ report: CoverageReport; reportPath: string }> {
  const cwd = options.cwd ?? process.cwd();
  const loaded = await loadConfig(options.config, cwd);
  const changedFiles = await resolveChangedFiles(options, cwd);
  const plan = await resolvePlan(options, loaded.rootDir, loaded.config, changedFiles);
  const report = analyzeCoverage(loaded.config, { plan, changedFiles });
  const reportPath = path.join(loaded.rootDir, ".visual-hive", "coverage.json");
  await writeJson(reportPath, report);
  return { report, reportPath };
}

export function formatCoverageSummary(report: CoverageReport, reportPath: string): string {
  const lines = [
    `Wrote ${reportPath}`,
    `Coverage for ${report.project}`,
    `Targets: ${report.summary.targetCount}`,
    `Contracts: ${report.summary.contractCount} (${report.summary.selectedContracts} selected, ${report.summary.unselectedContracts} not selected)`,
    `PR-safe contracts: ${report.summary.prSafeContracts}`,
    `Protected contracts: ${report.summary.protectedContracts}`,
    `Schedule-only contracts: ${report.summary.scheduleOnlyContracts}`,
    `Routes covered: ${report.summary.routesCovered}`,
    `Viewports covered: ${report.summary.viewportsCovered}`,
    `Coverage gaps: ${report.uncoveredAreas.length}`
  ];
  for (const gap of report.uncoveredAreas.slice(0, 8)) {
    lines.push(`- [${gap.severity}] ${gap.message}`);
  }
  if (report.uncoveredAreas.length > 8) {
    lines.push(`- ... ${report.uncoveredAreas.length - 8} more gap(s)`);
  }
  return lines.join("\n");
}

async function resolvePlan(
  options: CoverageCommandOptions,
  rootDir: string,
  config: Parameters<typeof createPlan>[0],
  changedFiles: string[]
): Promise<Plan | undefined> {
  if (options.plan) {
    return readJson<Plan>(path.resolve(rootDir, options.plan));
  }
  const defaultPlanPath = path.join(rootDir, ".visual-hive", "plan.json");
  try {
    return await readJson<Plan>(defaultPlanPath);
  } catch {
    // Coverage can run before planning. In that case, create an in-memory plan
    // so selected/unselected coverage still has useful context.
  }
  return createPlan(config, {
    mode: parsePlanMode(options.mode),
    changedFiles,
    allowUnsafeTargets: options.allowUnsafeTargets,
    includeContracts: options.includeContracts,
    excludeContracts: options.excludeContracts,
    includeTargets: options.includeTargets,
    excludeTargets: options.excludeTargets
  });
}

async function resolveChangedFiles(options: CoverageCommandOptions, cwd: string): Promise<string[]> {
  if (options.changedFiles) {
    const raw = await readFile(path.resolve(cwd, options.changedFiles), "utf8");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }
  if (options.base) {
    return gitChangedFiles(cwd, options.base);
  }
  return [];
}
