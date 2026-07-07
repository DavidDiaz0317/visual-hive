import path from "node:path";
import {
  loadConfig,
  scanIssueFacingPaths,
  type PathLeakScanReport
} from "@visual-hive/core";

export interface PathScanCommandOptions {
  config?: string;
  cwd?: string;
  artifactRoot?: string;
  output?: string;
  format?: "markdown" | "json";
}

export interface PathScanCommandResult {
  report: PathLeakScanReport;
  outputPath?: string;
}

export async function runPathScanCommand(options: PathScanCommandOptions = {}): Promise<PathScanCommandResult> {
  const loaded = await loadConfig(options.config, options.cwd ?? process.cwd());
  const result = await scanIssueFacingPaths({
    rootDir: loaded.rootDir,
    artifactRoot: options.artifactRoot,
    outputPath: options.output ?? ".visual-hive/path-leak-scan.json"
  });
  return {
    report: result.report,
    outputPath: result.outputPath ? path.relative(loaded.rootDir, result.outputPath).replaceAll(path.sep, "/") : undefined
  };
}

export function formatPathScanResult(result: PathScanCommandResult, format: "markdown" | "json" = "markdown"): string {
  if (format === "json") return JSON.stringify(result.report, null, 2);
  const lines = [
    ...(result.outputPath ? [`Wrote ${result.outputPath}`, ""] : []),
    "# Visual Hive Issue-Facing Path Scan",
    "",
    `- Status: ${result.report.status}`,
    `- Files scanned: ${result.report.summary.filesScanned}`,
    `- Findings: ${result.report.summary.findings}`,
    "",
    "## Findings"
  ];
  if (!result.report.findings.length) {
    lines.push("- No local absolute path leaks found in scanned issue-facing artifacts.");
  } else {
    for (const finding of result.report.findings.slice(0, 20)) {
      lines.push(`- ${finding.file}: ${finding.patternId} -> ${finding.excerpt}`);
    }
  }
  return lines.join("\n");
}
