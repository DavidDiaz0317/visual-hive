import { renderRepoContext, writeRepoMap, type RepoMapReport } from "@visual-hive/core";

export interface AnalyzeCommandOptions {
  repo?: string;
  output?: string;
  markdown?: string;
  format?: "markdown" | "json";
}

export interface AnalyzeCommandResult {
  report: RepoMapReport;
  reportPath: string;
  markdownPath: string;
}

export async function runAnalyzeCommand(options: AnalyzeCommandOptions = {}): Promise<AnalyzeCommandResult> {
  return writeRepoMap({
    repoRoot: options.repo ?? process.cwd(),
    outputPath: options.output ?? ".visual-hive/repo-map.json",
    markdownPath: options.markdown ?? ".visual-hive/repo-context.md"
  });
}

export function formatAnalyzeSummary(result: AnalyzeCommandResult, format: "markdown" | "json" = "markdown"): string {
  if (format === "json") return JSON.stringify(result.report, null, 2);
  return [
    `Wrote ${result.reportPath}`,
    `Wrote ${result.markdownPath}`,
    "",
    renderRepoContext(result.report)
  ].join("\n");
}
