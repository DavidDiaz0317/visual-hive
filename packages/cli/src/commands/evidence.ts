import path from "node:path";
import { loadConfig, writeEvidencePacket, type EvidencePacket } from "@visual-hive/core";

export interface EvidenceCommandOptions {
  config?: string;
  cwd?: string;
  output?: string;
  markdown?: string;
  format?: "markdown" | "json";
}

export async function runEvidenceCommand(
  options: EvidenceCommandOptions = {}
): Promise<{ packet: EvidencePacket; packetPath: string; summaryPath: string }> {
  const cwd = options.cwd ?? process.cwd();
  const loaded = await loadConfig(options.config, cwd);
  return writeEvidencePacket({
    rootDir: loaded.rootDir,
    project: loaded.config.project.name,
    outputPath: options.output ?? path.join(".visual-hive", "evidence-packet.json"),
    markdownPath: options.markdown ?? path.join(".visual-hive", "evidence-summary.md"),
    hiveConfig: loaded.config.integrations.hive
  });
}

export function formatEvidencePacket(result: { packet: EvidencePacket; packetPath: string; summaryPath: string }, format: "markdown" | "json" = "markdown"): string {
  if (format === "json") {
    return JSON.stringify(result.packet, null, 2);
  }
  return [
    `Wrote ${result.packetPath}`,
    `Wrote ${result.summaryPath}`,
    "",
    `# Evidence Packet: ${result.packet.project}`,
    "",
    `- Visual Hive verdict: ${result.packet.verdictSummary.visualHiveVerdict}`,
    `- Contributions: ${result.packet.evidenceContributions.length}`,
    `- Failed reasons: ${result.packet.verdictSummary.failedBecause.length}`,
    `- Blocked reasons: ${result.packet.verdictSummary.blockedBecause.length}`,
    `- Advisory-only signals: ${result.packet.verdictSummary.advisoryOnly.length}`,
    `- Hive dry-run ready: ${result.packet.hiveReadiness.readyForHiveDryRun}`,
    `- Issue handoff ready: ${result.packet.hiveReadiness.readyForIssueHandoff}`,
    `- Recommended Hive mode: ${result.packet.hiveReadiness.recommendedMode}`,
    `- Hive modes: ${result.packet.hiveReadiness.modeReadiness.map((entry) => `${entry.mode}=${entry.status}`).join(", ")}`
  ].join("\n");
}
