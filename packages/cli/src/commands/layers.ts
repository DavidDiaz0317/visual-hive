import path from "node:path";
import { loadConfig, writeTestingLayerReport, type TestingLayerReport } from "@visual-hive/core";

export interface LayersCommandOptions {
  config?: string;
  cwd?: string;
  output?: string;
  markdown?: string;
  evidence?: string;
  format?: "markdown" | "json";
}

export async function runLayersCommand(options: LayersCommandOptions = {}): Promise<{ report: TestingLayerReport; reportPath: string; markdownPath: string }> {
  const cwd = options.cwd ?? process.cwd();
  const loaded = await loadConfig(options.config, cwd);
  return writeTestingLayerReport({
    rootDir: loaded.rootDir,
    project: loaded.config.project.name,
    evidencePacketPath: options.evidence ?? path.join(".visual-hive", "evidence-packet.json"),
    outputPath: options.output ?? path.join(".visual-hive", "testing-layers.json"),
    markdownPath: options.markdown ?? path.join(".visual-hive", "testing-layers.md")
  });
}

export function formatLayersReport(result: { report: TestingLayerReport; reportPath: string; markdownPath: string }, format: "markdown" | "json" = "markdown"): string {
  if (format === "json") return JSON.stringify(result.report, null, 2);
  return [
    `Wrote ${result.reportPath}`,
    `Wrote ${result.markdownPath}`,
    "",
    `# Testing Layers: ${result.report.project}`,
    "",
    `- Status: ${result.report.summary.status}`,
    `- Covered: ${result.report.summary.covered}/${result.report.summary.totalLayers}`,
    `- Partial: ${result.report.summary.partial}`,
    `- Missing: ${result.report.summary.missing}`,
    `- Unknown: ${result.report.summary.unknown}`,
    `- Gaps: ${result.report.summary.gapCount}`,
    `- Recommendations: ${result.report.recommendations.length}`
  ].join("\n");
}
