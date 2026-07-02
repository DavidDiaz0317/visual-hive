import path from "node:path";
import {
  loadConfig,
  readEvidencePacket,
  writeHandoffArtifacts,
  type HandoffArtifacts,
  type HandoffMode,
  type HandoffPacket,
  type HiveBeadDryRunRequest,
  type HiveHandoffResult
} from "@visual-hive/core";

export interface HandoffCommandOptions {
  config?: string;
  cwd?: string;
  evidence?: string;
  mode?: HandoffMode;
  label?: string[];
  agent?: string;
}

export interface HandoffCommandResult extends HandoffArtifacts {
  handoffPath: string;
  issuePath: string;
  beadRequestPath: string;
  resultPath: string;
}

export async function runHandoffCommand(options: HandoffCommandOptions = {}): Promise<HandoffCommandResult> {
  const cwd = options.cwd ?? process.cwd();
  const loaded = await loadConfig(options.config, cwd);
  const hiveConfig = loaded.config.integrations.hive;
  const evidencePath = path.resolve(loaded.rootDir, options.evidence ?? path.join(".visual-hive", "evidence-packet.json"));
  let evidencePacket;
  try {
    evidencePacket = await readEvidencePacket(evidencePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Missing or invalid Evidence Packet at ${evidencePath}. Run "visual-hive evidence" before "visual-hive handoff --dry-run". Details: ${message}`);
  }
  const mode = options.mode ?? hiveConfig.mode ?? "dry_run";
  return writeHandoffArtifacts({
    rootDir: loaded.rootDir,
    evidencePacket,
    evidencePacketPath: path.relative(loaded.rootDir, evidencePath).replaceAll(path.sep, "/"),
    mode,
    labels: options.label?.length ? options.label : hiveConfig.labels,
    agent: options.agent ?? hiveConfig.beadApi.agent
  });
}

export function formatHandoffResult(result: HandoffCommandResult, format: "markdown" | "json" = "markdown"): string {
  if (format === "json") {
    return JSON.stringify(
      {
        handoff: result.handoff as HandoffPacket,
        beadRequest: result.beadRequest as HiveBeadDryRunRequest,
        result: result.result as HiveHandoffResult
      },
      null,
      2
    );
  }
  return [
    `Wrote ${result.handoffPath}`,
    `Wrote ${result.issuePath}`,
    `Wrote ${result.beadRequestPath}`,
    `Wrote ${result.resultPath}`,
    "",
    `# Hive Handoff Dry Run: ${result.handoff.project}`,
    "",
    `- Status: ${result.handoff.status}`,
    `- Mode: ${result.handoff.mode}`,
    `- Visual Hive verdict: ${result.handoff.verdict.visualHiveVerdict}`,
    `- Work items: ${result.handoff.workItems.length}`,
    `- External calls made: ${result.handoff.externalCallsMade}`,
    `- Labels: ${result.handoff.labels.join(", ")}`,
    `- Trusted workflow required: ${result.handoff.githubIssue.trustedWorkflowRequired}`,
    ...(result.handoff.blockedReasons.length ? [`- Blocked reasons: ${result.handoff.blockedReasons.join("; ")}`] : [])
  ].join("\n");
}
