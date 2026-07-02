import path from "node:path";
import {
  loadConfig,
  readEvidencePacket,
  readJson,
  renderHiveExportSummary,
  writeHiveExportArtifacts,
  type HandoffPacket,
  type HiveConfiguredMode,
  type WriteHiveExportResult
} from "@visual-hive/core";

export interface HiveExportCommandOptions {
  config?: string;
  cwd?: string;
  evidence?: string;
  handoff?: string;
  outputDir?: string;
  mode?: HiveConfiguredMode;
  dryRun?: boolean;
  format?: "markdown" | "json";
}

export type HiveExportCommandResult = WriteHiveExportResult;

export async function runHiveExportCommand(options: HiveExportCommandOptions = {}): Promise<HiveExportCommandResult> {
  const cwd = options.cwd ?? process.cwd();
  const loaded = await loadConfig(options.config, cwd);
  const evidencePath = path.resolve(loaded.rootDir, options.evidence ?? path.join(".visual-hive", "evidence-packet.json"));
  let evidencePacket;
  try {
    evidencePacket = await readEvidencePacket(evidencePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Missing or invalid Evidence Packet at ${evidencePath}. Run "visual-hive evidence" before "visual-hive hive export --dry-run". Details: ${message}`);
  }

  const handoffArtifactPath = options.handoff ?? path.join(".visual-hive", "handoff.json");
  const handoffPath = path.resolve(loaded.rootDir, handoffArtifactPath);
  const handoffPacket = await readOptionalHandoff(handoffPath);
  const hiveConfig = {
    ...loaded.config.integrations.hive,
    mode: options.mode ?? loaded.config.integrations.hive.mode
  };

  return writeHiveExportArtifacts({
    rootDir: loaded.rootDir,
    evidencePacket,
    evidencePacketPath: path.relative(loaded.rootDir, evidencePath).replaceAll(path.sep, "/"),
    handoffPacket,
    handoffPacketPath: handoffPacket ? handoffArtifactPath.replaceAll(path.sep, "/") : undefined,
    outputDir: options.outputDir ?? path.join(".visual-hive", "hive"),
    hiveConfig
  });
}

export function formatHiveExport(result: HiveExportCommandResult, format: "markdown" | "json" = "markdown"): string {
  return renderHiveExportSummary(result, format);
}

async function readOptionalHandoff(filePath: string): Promise<HandoffPacket | undefined> {
  try {
    const packet = await readJson<HandoffPacket>(filePath);
    return packet.schemaVersion === "visual-hive.handoff.v1" ? packet : undefined;
  } catch {
    return undefined;
  }
}
