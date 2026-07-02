import path from "node:path";
import { loadConfig, writeVerdictReport, type VerdictReport } from "@visual-hive/core";

export interface VerdictCommandOptions {
  config?: string;
  cwd?: string;
  output?: string;
  markdown?: string;
  evidence?: string;
  format?: "markdown" | "json";
}

export async function runVerdictCommand(options: VerdictCommandOptions = {}): Promise<{ report: VerdictReport; reportPath: string; markdownPath: string }> {
  const cwd = options.cwd ?? process.cwd();
  const loaded = await loadConfig(options.config, cwd);
  return writeVerdictReport({
    rootDir: loaded.rootDir,
    project: loaded.config.project.name,
    evidencePacketPath: options.evidence ?? path.join(".visual-hive", "evidence-packet.json"),
    outputPath: options.output ?? path.join(".visual-hive", "verdict.json"),
    markdownPath: options.markdown ?? path.join(".visual-hive", "verdict.md")
  });
}

export function formatVerdictReport(result: { report: VerdictReport; reportPath: string; markdownPath: string }, format: "markdown" | "json" = "markdown"): string {
  if (format === "json") return JSON.stringify(result.report, null, 2);
  return [
    `Wrote ${result.reportPath}`,
    `Wrote ${result.markdownPath}`,
    "",
    `# Visual Hive Verdict: ${result.report.project}`,
    "",
    `- Verdict: ${result.report.summary.visualHiveVerdict}`,
    `- Gating contributions: ${result.report.summary.gatingContributions}`,
    `- Advisory contributions: ${result.report.summary.advisoryContributions}`,
    `- Failed reasons: ${result.report.summary.failedBecause.length}`,
    `- Blocked reasons: ${result.report.summary.blockedBecause.length}`,
    "- Authority: Visual Hive deterministic Verdict Engine"
  ].join("\n");
}
