import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeRepo, RepoAnalysisApiError, type RepoAnalysis } from "@visual-hive/llm-adapter";
import { recommendSetup, writeJson, type SetupRecommendationReport } from "@visual-hive/core";

export interface AnalyzeCommandOptions {
  cwd?: string;
  repo?: string;
  claudePath?: string;
  model?: string;
  writeConfig?: boolean;
  force?: boolean;
  format?: "markdown" | "json";
}

export interface AnalyzeCommandResult {
  report: SetupRecommendationReport;
  analysis: RepoAnalysis;
  analysisPath: string;
  configWritten?: string;
}

export async function runAnalyzeCommand(options: AnalyzeCommandOptions = {}): Promise<AnalyzeCommandResult> {
  const cwd = options.cwd ?? process.cwd();
  const repoRoot = path.resolve(cwd, options.repo ?? ".");
  const configPath = path.join(repoRoot, "visual-hive.config.yaml");
  const analysisPath = path.join(repoRoot, ".visual-hive", "analyze.json");

  const report = await recommendSetup({ repoRoot, configPath });

  let analysis: RepoAnalysis;
  try {
    analysis = await analyzeRepo({ report, claudePath: options.claudePath, model: options.model });
  } catch (err) {
    if (err instanceof RepoAnalysisApiError) {
      throw new Error(`LLM analysis failed: ${err.message}`);
    }
    throw err;
  }

  await mkdir(path.dirname(analysisPath), { recursive: true });
  await writeJson(analysisPath, { report, analysis });

  let configWritten: string | undefined;
  if (options.writeConfig && analysis.enhancedConfigYaml) {
    if (!options.force && (await fileExists(configPath))) {
      throw new Error(`Refusing to overwrite existing config: ${configPath}. Pass --force to replace it.`);
    }
    await writeFile(configPath, analysis.enhancedConfigYaml, "utf8");
    configWritten = configPath;
  }

  return { report, analysis, analysisPath, configWritten };
}

export function formatAnalysis(result: AnalyzeCommandResult, format: "markdown" | "json" = "markdown"): string {
  if (format === "json") {
    return JSON.stringify(result.analysis, null, 2);
  }

  const { report, analysis, analysisPath, configWritten } = result;
  const lines = [
    `Wrote ${analysisPath}`,
    "# Visual Hive LLM Analysis",
    "",
    `- Project: ${report.project.name}`,
    `- Frameworks: ${report.project.detectedFrameworks.join(", ") || "none detected"}`,
    `- Model: ${analysis.model}`,
    `- CLI calls made: ${analysis.callsMade}`,
    `- Input truncated: ${analysis.inputTruncated ? "yes (repo exceeds scan limits — suggestions reflect a partial view)" : "no"}`,
    `- Config written: ${configWritten ?? "no, pass --write-config to update visual-hive.config.yaml"}`,
    "",
    "## Priority Routes",
    ...(analysis.priorityRoutes.length
      ? analysis.priorityRoutes.map((route) => `- ${route}`)
      : ["No priority routes identified."]),
    "",
    "## Suggested Contracts",
    ...(analysis.contractSuggestions.length
      ? analysis.contractSuggestions.flatMap((contract) => [
          `### ${contract.id}`,
          `- Route: ${contract.route}`,
          `- Screenshot: ${contract.screenshotName}`,
          `- Selectors: ${contract.selectors.join(", ") || "none"}`,
          `- Rationale: ${contract.rationale}`,
          ""
        ])
      : ["No contract suggestions generated."]),
    "## Coverage Gaps",
    ...(analysis.coverageGaps.length ? analysis.coverageGaps.map((gap) => `- ${gap}`) : ["No coverage gaps identified."]),
    "",
    "## Note",
    "LLM output is advisory only. Deterministic Playwright contracts are the only pass/fail oracle.",
    "Review the enhanced config before using it: pass --write-config to apply it."
  ];

  return lines.join("\n");
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
