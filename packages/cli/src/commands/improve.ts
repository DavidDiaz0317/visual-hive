import path from "node:path";
import {
  analyzeCoverage,
  buildCoverageImprovementReport,
  loadConfig,
  readJson,
  writeJson,
  type CoverageImprovementReport,
  type CoverageReport,
  type MutationReport
} from "@visual-hive/core";

export interface ImproveCoverageCommandOptions {
  config?: string;
  coverage?: string;
  mutationReport?: string;
  format?: "markdown" | "json";
}

export async function runImproveCoverageCommand(
  options: ImproveCoverageCommandOptions = {}
): Promise<{ report: CoverageImprovementReport; reportPath: string }> {
  const loaded = await loadConfig(options.config, process.cwd());
  const coveragePath = path.resolve(loaded.rootDir, options.coverage ?? ".visual-hive/coverage.json");
  const mutationPath = path.resolve(loaded.rootDir, options.mutationReport ?? ".visual-hive/mutation-report.json");
  const coverage = await readCoverageOrAnalyze(loaded.config, coveragePath);
  const mutationReport = await readOptionalJson<MutationReport>(mutationPath);
  const report = buildCoverageImprovementReport(loaded.config, coverage, mutationReport);
  const reportPath = path.join(loaded.rootDir, ".visual-hive", "coverage-recommendations.json");
  await writeJson(reportPath, report);
  return { report, reportPath };
}

export function formatCoverageImprovementReport(report: CoverageImprovementReport, reportPath: string, format = "markdown"): string {
  if (format === "json") return JSON.stringify(report, null, 2);
  const lines = [
    `Wrote ${reportPath}`,
    `# Coverage Improvement Plan: ${report.project}`,
    "",
    `- Recommendations: ${report.summary.total}`,
    `- High: ${report.summary.high}`,
    `- Medium: ${report.summary.medium}`,
    `- Low: ${report.summary.low}`,
    `- From coverage gaps: ${report.summary.fromCoverageGaps}`,
    `- From mutation survivors: ${report.summary.fromMutationSurvivors}`
  ];
  if (report.recommendations.length === 0) {
    lines.push("", "No deterministic coverage improvement recommendations were produced from the current artifacts.");
    return lines.join("\n");
  }
  lines.push("", "## Recommendations");
  for (const recommendation of report.recommendations.slice(0, 12)) {
    lines.push(
      `- [${recommendation.severity}] ${recommendation.title} (${recommendation.kind})`,
      `  ${recommendation.rationale.join(" ")}`,
      `  Suggested tests: ${recommendation.suggestedTests.join(" ")}`
    );
  }
  if (report.recommendations.length > 12) {
    lines.push(`- ... ${report.recommendations.length - 12} more recommendation(s)`);
  }
  return lines.join("\n");
}

async function readCoverageOrAnalyze(config: Parameters<typeof analyzeCoverage>[0], coveragePath: string): Promise<CoverageReport> {
  try {
    return await readJson<CoverageReport>(coveragePath);
  } catch {
    return analyzeCoverage(config);
  }
}

async function readOptionalJson<T>(filePath: string): Promise<T | undefined> {
  try {
    return await readJson<T>(filePath);
  } catch {
    return undefined;
  }
}
