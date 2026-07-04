import path from "node:path";
import {
  loadConfig,
  readEvidencePacket,
  readJson,
  renderHiveGuardedRepairPreviewSummary,
  renderHiveModeComparisonSummary,
  renderHiveRepairRequestEnvelopeSummary,
  renderHiveTrustedRepairConsumerSummary,
  renderHiveTrustedRepairWorkflowDryRun,
  renderHiveExportSummary,
  writeHiveGuardedRepairPreview,
  writeHiveModeComparison,
  writeHiveRepairRequestEnvelope,
  writeHiveTrustedRepairConsumerSummary,
  writeHiveTrustedRepairWorkflowDryRun,
  writeHiveExportArtifacts,
  type HandoffPacket,
  type HiveExportBundle,
  type HiveGuardedRepairPreview,
  type HiveRepairRequestEnvelope,
  type HiveTrustedRepairConsumerSummary,
  type HiveConfiguredMode,
  type HiveAutomationMode,
  type WriteHiveGuardedRepairPreviewResult,
  type WriteHiveModeComparisonResult,
  type WriteHiveRepairRequestEnvelopeResult,
  type WriteHiveTrustedRepairConsumerSummaryResult,
  type WriteHiveTrustedRepairWorkflowDryRunResult,
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
export type HiveModeComparisonCommandResult = WriteHiveModeComparisonResult;
export type HiveGuardedRepairPreviewCommandResult = WriteHiveGuardedRepairPreviewResult;
export type HiveRepairRequestEnvelopeCommandResult = WriteHiveRepairRequestEnvelopeResult;
export type HiveTrustedRepairConsumerSummaryCommandResult = WriteHiveTrustedRepairConsumerSummaryResult;
export type HiveTrustedRepairWorkflowDryRunCommandResult = WriteHiveTrustedRepairWorkflowDryRunResult;

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

export interface HiveGuardedRepairPreviewCommandOptions {
  config?: string;
  cwd?: string;
  hiveExport?: string;
  outputDir?: string;
  format?: "markdown" | "json";
}

export async function runHiveGuardedRepairPreviewCommand(options: HiveGuardedRepairPreviewCommandOptions = {}): Promise<HiveGuardedRepairPreviewCommandResult> {
  const cwd = options.cwd ?? process.cwd();
  const loaded = await loadConfig(options.config, cwd);
  const hiveExportArtifactPath = options.hiveExport ?? path.join(".visual-hive", "hive", "hive-export.json");
  const hiveExportPath = path.resolve(loaded.rootDir, hiveExportArtifactPath);
  let hiveExport;
  try {
    hiveExport = await readJson<HiveExportBundle>(hiveExportPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Missing or invalid Hive export at ${hiveExportPath}. Run "visual-hive hive export --dry-run --mode repair_request" before "visual-hive hive guarded-repair-preview". Details: ${message}`);
  }
  if (hiveExport.schemaVersion !== "visual-hive.hive-export.v1") {
    throw new Error(`Invalid Hive export schemaVersion at ${hiveExportPath}. Expected visual-hive.hive-export.v1.`);
  }

  return writeHiveGuardedRepairPreview({
    rootDir: loaded.rootDir,
    hiveExport,
    hiveExportPath: hiveExportArtifactPath.replaceAll(path.sep, "/"),
    outputDir: options.outputDir ?? path.join(".visual-hive", "hive")
  });
}

export function formatHiveGuardedRepairPreview(result: HiveGuardedRepairPreviewCommandResult, format: "markdown" | "json" = "markdown"): string {
  return renderHiveGuardedRepairPreviewSummary(result, format);
}

export interface HiveRepairRequestEnvelopeCommandOptions {
  config?: string;
  cwd?: string;
  guardedRepairPreview?: string;
  outputDir?: string;
  format?: "markdown" | "json";
}

export async function runHiveRepairRequestEnvelopeCommand(options: HiveRepairRequestEnvelopeCommandOptions = {}): Promise<HiveRepairRequestEnvelopeCommandResult> {
  const cwd = options.cwd ?? process.cwd();
  const loaded = await loadConfig(options.config, cwd);
  const previewArtifactPath = options.guardedRepairPreview ?? path.join(".visual-hive", "hive", "guarded-repair-preview.json");
  const previewPath = path.resolve(loaded.rootDir, previewArtifactPath);
  let guardedRepairPreview;
  try {
    guardedRepairPreview = await readJson<HiveGuardedRepairPreview>(previewPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Missing or invalid guarded repair preview at ${previewPath}. Run "visual-hive hive guarded-repair-preview" before "visual-hive hive repair-request-envelope". Details: ${message}`
    );
  }
  if (guardedRepairPreview.schemaVersion !== "visual-hive.hive-guarded-repair-preview.v1") {
    throw new Error(`Invalid guarded repair preview schemaVersion at ${previewPath}. Expected visual-hive.hive-guarded-repair-preview.v1.`);
  }

  return writeHiveRepairRequestEnvelope({
    rootDir: loaded.rootDir,
    guardedRepairPreview,
    guardedRepairPreviewPath: previewArtifactPath.replaceAll(path.sep, "/"),
    outputDir: options.outputDir ?? path.join(".visual-hive", "hive")
  });
}

export function formatHiveRepairRequestEnvelope(result: HiveRepairRequestEnvelopeCommandResult, format: "markdown" | "json" = "markdown"): string {
  return renderHiveRepairRequestEnvelopeSummary(result, format);
}

export interface HiveTrustedRepairConsumerSummaryCommandOptions {
  config?: string;
  cwd?: string;
  repairRequestEnvelope?: string;
  outputDir?: string;
  format?: "markdown" | "json";
}

export async function runHiveTrustedRepairConsumerSummaryCommand(
  options: HiveTrustedRepairConsumerSummaryCommandOptions = {}
): Promise<HiveTrustedRepairConsumerSummaryCommandResult> {
  const cwd = options.cwd ?? process.cwd();
  const loaded = await loadConfig(options.config, cwd);
  const envelopeArtifactPath = options.repairRequestEnvelope ?? path.join(".visual-hive", "hive", "repair-request-envelope.json");
  const envelopePath = path.resolve(loaded.rootDir, envelopeArtifactPath);
  let repairRequestEnvelope;
  try {
    repairRequestEnvelope = await readJson<HiveRepairRequestEnvelope>(envelopePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Missing or invalid repair request envelope at ${envelopePath}. Run "visual-hive hive repair-request-envelope" before "visual-hive hive trusted-repair-consumer-summary". Details: ${message}`
    );
  }
  if (repairRequestEnvelope.schemaVersion !== "visual-hive.hive-repair-request-envelope.v1") {
    throw new Error(`Invalid repair request envelope schemaVersion at ${envelopePath}. Expected visual-hive.hive-repair-request-envelope.v1.`);
  }

  return writeHiveTrustedRepairConsumerSummary({
    rootDir: loaded.rootDir,
    repairRequestEnvelope,
    repairRequestEnvelopePath: envelopeArtifactPath.replaceAll(path.sep, "/"),
    outputDir: options.outputDir ?? path.join(".visual-hive", "hive")
  });
}

export function formatHiveTrustedRepairConsumerSummary(
  result: HiveTrustedRepairConsumerSummaryCommandResult,
  format: "markdown" | "json" = "markdown"
): string {
  return renderHiveTrustedRepairConsumerSummary(result, format);
}

export interface HiveTrustedRepairWorkflowDryRunCommandOptions {
  config?: string;
  cwd?: string;
  trustedRepairConsumerSummary?: string;
  outputDir?: string;
  format?: "markdown" | "json";
}

export async function runHiveTrustedRepairWorkflowDryRunCommand(
  options: HiveTrustedRepairWorkflowDryRunCommandOptions = {}
): Promise<HiveTrustedRepairWorkflowDryRunCommandResult> {
  const cwd = options.cwd ?? process.cwd();
  const loaded = await loadConfig(options.config, cwd);
  const summaryArtifactPath = options.trustedRepairConsumerSummary ?? path.join(".visual-hive", "hive", "trusted-repair-consumer-summary.json");
  const summaryPath = path.resolve(loaded.rootDir, summaryArtifactPath);
  let trustedRepairConsumerSummary;
  try {
    trustedRepairConsumerSummary = await readJson<HiveTrustedRepairConsumerSummary>(summaryPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Missing or invalid trusted repair consumer summary at ${summaryPath}. Run "visual-hive hive trusted-repair-consumer-summary" before "visual-hive hive trusted-repair-workflow-dry-run". Details: ${message}`
    );
  }
  if (trustedRepairConsumerSummary.schemaVersion !== "visual-hive.hive-trusted-repair-consumer-summary.v1") {
    throw new Error(`Invalid trusted repair consumer summary schemaVersion at ${summaryPath}. Expected visual-hive.hive-trusted-repair-consumer-summary.v1.`);
  }

  return writeHiveTrustedRepairWorkflowDryRun({
    rootDir: loaded.rootDir,
    trustedRepairConsumerSummary,
    trustedRepairConsumerSummaryPath: summaryArtifactPath.replaceAll(path.sep, "/"),
    outputDir: options.outputDir ?? path.join(".visual-hive", "hive")
  });
}

export function formatHiveTrustedRepairWorkflowDryRun(
  result: HiveTrustedRepairWorkflowDryRunCommandResult,
  format: "markdown" | "json" = "markdown"
): string {
  return renderHiveTrustedRepairWorkflowDryRun(result, format);
}

export interface HiveCompareModesCommandOptions {
  config?: string;
  cwd?: string;
  evidence?: string;
  handoff?: string;
  outputDir?: string;
  modes?: HiveAutomationMode[];
  format?: "markdown" | "json";
}

export async function runHiveCompareModesCommand(options: HiveCompareModesCommandOptions = {}): Promise<HiveModeComparisonCommandResult> {
  const cwd = options.cwd ?? process.cwd();
  const loaded = await loadConfig(options.config, cwd);
  const evidencePath = path.resolve(loaded.rootDir, options.evidence ?? path.join(".visual-hive", "evidence-packet.json"));
  let evidencePacket;
  try {
    evidencePacket = await readEvidencePacket(evidencePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Missing or invalid Evidence Packet at ${evidencePath}. Run "visual-hive evidence" before "visual-hive hive compare-modes". Details: ${message}`);
  }

  const handoffArtifactPath = options.handoff ?? path.join(".visual-hive", "handoff.json");
  const handoffPath = path.resolve(loaded.rootDir, handoffArtifactPath);
  const handoffPacket = await readOptionalHandoff(handoffPath);

  return writeHiveModeComparison({
    rootDir: loaded.rootDir,
    evidencePacket,
    evidencePacketPath: path.relative(loaded.rootDir, evidencePath).replaceAll(path.sep, "/"),
    handoffPacket,
    handoffPacketPath: handoffPacket ? handoffArtifactPath.replaceAll(path.sep, "/") : undefined,
    outputDir: options.outputDir ?? path.join(".visual-hive", "hive"),
    modes: options.modes,
    hiveConfig: loaded.config.integrations.hive
  });
}

export function formatHiveModeComparison(result: HiveModeComparisonCommandResult, format: "markdown" | "json" = "markdown"): string {
  return renderHiveModeComparisonSummary(result, format);
}

async function readOptionalHandoff(filePath: string): Promise<HandoffPacket | undefined> {
  try {
    const packet = await readJson<HandoffPacket>(filePath);
    return packet.schemaVersion === "visual-hive.handoff.v1" ? packet : undefined;
  } catch {
    return undefined;
  }
}
