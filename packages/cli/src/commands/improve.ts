import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import {
  applyCoverageImprovementRecommendation,
  analyzeCoverage,
  buildCoverageImprovementReport,
  loadConfig,
  readJson,
  writeJson,
  sanitizeText,
  type CoverageImprovementApplyResult,
  type CoverageImprovementReport,
  type CoverageReport,
  type FlowAuditReport,
  type MutationReport
} from "@visual-hive/core";

export interface ImproveCoverageCommandOptions {
  config?: string;
  coverage?: string;
  flows?: string;
  mutationReport?: string;
  format?: "markdown" | "json";
  apply?: string;
  yes?: boolean;
}

export async function runImproveCoverageCommand(
  options: ImproveCoverageCommandOptions = {}
): Promise<{ report: CoverageImprovementReport; reportPath: string; applyResult?: CoverageImprovementApplyResult }> {
  const loaded = await loadConfig(options.config, process.cwd());
  const coveragePath = path.resolve(loaded.rootDir, options.coverage ?? ".visual-hive/coverage.json");
  const flowsPath = path.resolve(loaded.rootDir, options.flows ?? ".visual-hive/flows.json");
  const mutationPath = path.resolve(loaded.rootDir, options.mutationReport ?? ".visual-hive/mutation-report.json");
  const coverage = await readCoverageOrAnalyze(loaded.config, coveragePath);
  const flowAudit = await readOptionalJson<FlowAuditReport>(flowsPath);
  const mutationReport = await readOptionalJson<MutationReport>(mutationPath);
  const report = buildCoverageImprovementReport(loaded.config, coverage, mutationReport, { flowAudit });
  const reportPath = path.join(loaded.rootDir, ".visual-hive", "coverage-recommendations.json");
  await writeJson(reportPath, report);
  const applyResult = options.apply
    ? applyCoverageImprovementRecommendation(loaded.config, report, options.apply, await readFile(loaded.configPath, "utf8"))
    : undefined;
  if (applyResult?.applied && options.yes) {
    await writeFile(loaded.configPath, applyResult.configText, "utf8");
  }
  return { report, reportPath, applyResult };
}

export function formatCoverageImprovementReport(
  report: CoverageImprovementReport,
  reportPath: string,
  format = "markdown",
  applyResult?: CoverageImprovementApplyResult,
  appliedToConfig = false
): string {
  if (format === "json") return JSON.stringify(applyResult ? { report, applyResult } : report, null, 2);
  const lines = [
    `Wrote ${reportPath}`,
    `# Coverage Improvement Plan: ${report.project}`,
    "",
    `- Recommendations: ${report.summary.total}`,
    `- High: ${report.summary.high}`,
    `- Medium: ${report.summary.medium}`,
    `- Low: ${report.summary.low}`,
    `- From coverage gaps: ${report.summary.fromCoverageGaps}`,
    `- From mutation survivors: ${report.summary.fromMutationSurvivors}`,
    `- From flow gaps: ${report.summary.fromFlowGaps}`
  ];
  if (report.recommendations.length === 0) {
    lines.push("", "No deterministic coverage improvement recommendations were produced from the current artifacts.");
    return lines.join("\n");
  }
  if (applyResult) {
    lines.push(
      "",
      "## Selected Recommendation Diff",
      `- ID: ${applyResult.recommendationId}`,
      `- Title: ${sanitizeText(applyResult.title)}`,
      `- Applied: ${appliedToConfig ? "yes" : applyResult.applied ? "no, re-run with --yes after reviewing the diff" : "no config changes needed"}`,
      "",
      "```diff",
      applyResult.diff,
      "```"
    );
  }
  lines.push("", "## Recommendations");
  for (const recommendation of report.recommendations.slice(0, 12)) {
    lines.push(
      `- [${recommendation.severity}] ${recommendation.title} (${recommendation.kind}${recommendation.lane ? `, lane=${recommendation.lane}` : ""}${recommendation.trustedOnly ? ", trusted-only" : ""})`,
      `  ID: ${recommendation.id}`,
      `  ${recommendation.rationale.join(" ")}`,
      `  Suggested tests: ${recommendation.suggestedTests.join(" ")}`,
      recommendation.suggestedConfigYaml ? `  Config snippet:\n\n\`\`\`yaml\n${recommendation.suggestedConfigYaml}\n\`\`\`` : "  Config snippet: none"
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
