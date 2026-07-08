import path from "node:path";
import { access } from "node:fs/promises";
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
  sanitizeArtifactPathsForMarkdown,
  sanitizeText,
  writeJson,
  writeText,
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

export interface HiveValidateExportCommandOptions {
  config?: string;
  cwd?: string;
  hiveExport?: string;
  outputDir?: string;
  format?: "markdown" | "json";
}

export interface HiveBeadsCommandOptions {
  config?: string;
  cwd?: string;
  evidence?: string;
  handoff?: string;
  outputDir?: string;
  mode?: HiveConfiguredMode;
  format?: "markdown" | "json";
}

export interface HiveSetupPackCommandOptions {
  config?: string;
  cwd?: string;
  hiveExport?: string;
  outputDir?: string;
  format?: "markdown" | "json";
}

export interface HiveIntegrationSmokeCommandOptions {
  config?: string;
  cwd?: string;
  evidence?: string;
  handoff?: string;
  outputDir?: string;
  mode?: HiveConfiguredMode;
  format?: "markdown" | "json";
}

export interface HiveImportManifest {
  schemaVersion: "visual-hive.hive-import-manifest.v1";
  generatedAt: string;
  project: string;
  status: "ready" | "blocked";
  externalCallsMade: 0;
  sourceArtifacts: {
    hiveExport: string;
    hiveBeads: string;
    knowledgeGraph: string;
    knowledgeFacts: string;
    wikiIndex: string;
    issueContext: string;
    agentWorkOrders: string;
    agentPolicy: string;
  };
  importer: {
    target: "kubestellar/hive";
    recommendedPackage: string;
    beadStoreHint: string;
    dashboardHint: string;
  };
  summary: {
    beads: number;
    knowledgeFacts: number;
    graphNodes: number;
    graphEdges: number;
    agentWorkOrders: number;
    blockedReasons: number;
  };
  safety: {
    pathSanitizationStatus: "passed" | "failed";
    absolutePathLeaks: number;
    secretLeaks: number;
    externalCallsMade: 0;
    networkCallsMade: 0;
    visualHiveCreatesBeads: false;
    visualHiveCreatesIssues: false;
    visualHiveRepairsCode: false;
  };
  checks: Array<{ id: string; status: "passed" | "failed"; message: string }>;
  beads: Array<{ id: string; external_ref: string; status: string; type: string; actor: string }>;
}

export interface HiveValidationSummary {
  schemaVersion: "visual-hive.hive-validation-summary.v1";
  generatedAt: string;
  project: string;
  status: "passed" | "failed";
  externalCallsMade: 0;
  hiveExportPath: string;
  importManifestPath: string;
  checks: HiveImportManifest["checks"];
  summary: HiveImportManifest["summary"];
  safety: HiveImportManifest["safety"];
}

export interface HiveSetupPack {
  schemaVersion: "visual-hive.hive-setup-pack.v1";
  generatedAt: string;
  project: string;
  externalCallsMade: 0;
  acmmLevel: number;
  sourceArtifacts: {
    hiveExport: string;
    hiveImportManifest?: string;
  };
  oneSetupFlow: string[];
  proposedFiles: Array<{ path: string; purpose: string; trusted: boolean }>;
  permissions: Array<{ workflow: string; permissions: Record<string, string>; notes: string }>;
  validationCommands: string[];
  baselineSetupSteps: string[];
  selectorGuidance: string[];
  labels: string[];
  agentProfiles: Array<{ profile: string; role: string; allowedActions: string[]; forbiddenActions: string[] }>;
  safetyGuardrails: string[];
}

export interface HiveBeadsCommandResult {
  beads: HiveExportBundle["beads"];
  markdown: string;
  paths: {
    beads: string;
    markdown: string;
    legacyBeads: string;
  };
}

export interface HiveValidateExportCommandResult {
  manifest: HiveImportManifest;
  validation: HiveValidationSummary;
  paths: {
    manifest: string;
    validation: string;
  };
}

export interface HiveSetupPackCommandResult {
  setupPack: HiveSetupPack;
  markdown: string;
  paths: {
    setupPack: string;
    markdown: string;
  };
}

export interface HiveIntegrationSmokeCommandResult {
  schemaVersion: "visual-hive.hive-integration-smoke.v1";
  generatedAt: string;
  project: string;
  status: "passed" | "failed";
  externalCallsMade: 0;
  commands: string[];
  artifacts: Record<string, string>;
  summary: {
    beads: number;
    knowledgeFacts: number;
    graphNodes: number;
    graphEdges: number;
    agentWorkOrders: number;
    failedChecks: number;
  };
  safety: HiveImportManifest["safety"];
}

export interface HiveIntegrationSmokeCommandWriteResult {
  smoke: HiveIntegrationSmokeCommandResult;
  markdown: string;
  paths: {
    smoke: string;
    markdown: string;
  };
}

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

export async function runHiveBeadsCommand(options: HiveBeadsCommandOptions = {}): Promise<HiveBeadsCommandResult> {
  const exportResult = await runHiveExportCommand({
    config: options.config,
    cwd: options.cwd,
    evidence: options.evidence,
    handoff: options.handoff,
    outputDir: options.outputDir,
    mode: options.mode ?? "measured"
  });
  const rootDir = await rootDirFor(options.config, options.cwd);
  return writeHiveBeadsAlias(rootDir, exportResult.bundle, options.outputDir ?? path.join(".visual-hive", "hive"));
}

export function formatHiveBeads(result: HiveBeadsCommandResult, format: "markdown" | "json" = "markdown"): string {
  if (format === "json") return JSON.stringify(result.beads, null, 2);
  return [
    `Wrote ${result.paths.beads}`,
    `Wrote ${result.paths.markdown}`,
    "",
    "# Hive Beads Projection",
    "",
    `- Beads: ${result.beads.length}`,
    `- Legacy compatibility: ${result.paths.legacyBeads}`,
    "",
    ...result.beads.map((bead) => `- ${bead.id}: ${bead.title} (${bead.type}/${bead.status}, actor=${bead.actor})`)
  ].join("\n");
}

export async function runHiveValidateExportCommand(options: HiveValidateExportCommandOptions = {}): Promise<HiveValidateExportCommandResult> {
  const loaded = await loadConfig(options.config, options.cwd ?? process.cwd());
  const outputDir = options.outputDir ?? path.join(".visual-hive", "hive");
  const hiveExportArtifactPath = normalizeArtifactPath(options.hiveExport ?? path.join(outputDir, "hive-export.json"));
  const hiveExportPath = path.resolve(loaded.rootDir, hiveExportArtifactPath);
  let hiveExport: HiveExportBundle;
  try {
    hiveExport = await readJson<HiveExportBundle>(hiveExportPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Missing or invalid Hive export at ${hiveExportPath}. Run "visual-hive hive export --dry-run" before "visual-hive hive validate-export". Details: ${message}`);
  }
  await writeHiveBeadsAlias(loaded.rootDir, hiveExport, outputDir);
  const result = await writeHiveValidationArtifacts(loaded.rootDir, hiveExport, hiveExportArtifactPath, outputDir);
  return result;
}

export function formatHiveValidateExport(result: HiveValidateExportCommandResult, format: "markdown" | "json" = "markdown"): string {
  if (format === "json") return JSON.stringify(result.validation, null, 2);
  return [
    `Wrote ${result.paths.manifest}`,
    `Wrote ${result.paths.validation}`,
    "",
    `# Hive Export Validation: ${result.validation.project}`,
    "",
    `- Status: ${result.validation.status}`,
    `- Beads: ${result.validation.summary.beads}`,
    `- Agent work orders: ${result.validation.summary.agentWorkOrders}`,
    `- Path leaks: ${result.validation.safety.absolutePathLeaks}`,
    `- Secret leaks: ${result.validation.safety.secretLeaks}`,
    `- Failed checks: ${result.validation.checks.filter((check) => check.status === "failed").length}`,
    "",
    ...result.validation.checks.map((check) => `- ${check.status}: ${check.id} - ${check.message}`)
  ].join("\n");
}

export async function runHiveSetupPackCommand(options: HiveSetupPackCommandOptions = {}): Promise<HiveSetupPackCommandResult> {
  const loaded = await loadConfig(options.config, options.cwd ?? process.cwd());
  const outputDir = options.outputDir ?? path.join(".visual-hive", "hive");
  const hiveExportArtifactPath = normalizeArtifactPath(options.hiveExport ?? path.join(outputDir, "hive-export.json"));
  const hiveExportPath = path.resolve(loaded.rootDir, hiveExportArtifactPath);
  let hiveExport: HiveExportBundle;
  try {
    hiveExport = await readJson<HiveExportBundle>(hiveExportPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Missing or invalid Hive export at ${hiveExportPath}. Run "visual-hive hive export --dry-run" before "visual-hive hive setup-pack". Details: ${message}`);
  }
  return writeHiveSetupPack(loaded.rootDir, hiveExport, hiveExportArtifactPath, outputDir);
}

export function formatHiveSetupPack(result: HiveSetupPackCommandResult, format: "markdown" | "json" = "markdown"): string {
  if (format === "json") return JSON.stringify(result.setupPack, null, 2);
  return [
    `Wrote ${result.paths.setupPack}`,
    `Wrote ${result.paths.markdown}`,
    "",
    `# Hive Visual QA Setup Pack: ${result.setupPack.project}`,
    "",
    `- ACMM level: ${result.setupPack.acmmLevel}`,
    `- Proposed files: ${result.setupPack.proposedFiles.length}`,
    `- Validation commands: ${result.setupPack.validationCommands.length}`,
    `- Agent profiles: ${result.setupPack.agentProfiles.length}`,
    "- External calls made: 0"
  ].join("\n");
}

export async function runHiveIntegrationSmokeCommand(options: HiveIntegrationSmokeCommandOptions = {}): Promise<HiveIntegrationSmokeCommandWriteResult> {
  const outputDir = options.outputDir ?? path.join(".visual-hive", "hive");
  const exportResult = await runHiveExportCommand({
    config: options.config,
    cwd: options.cwd,
    evidence: options.evidence,
    handoff: options.handoff,
    outputDir,
    mode: options.mode ?? "measured"
  });
  const rootDir = await rootDirFor(options.config, options.cwd);
  const beadsResult = await writeHiveBeadsAlias(rootDir, exportResult.bundle, outputDir);
  const validationResult = await writeHiveValidationArtifacts(rootDir, exportResult.bundle, exportResult.paths.export, outputDir);
  const setupPackResult = await writeHiveSetupPack(rootDir, exportResult.bundle, exportResult.paths.export, outputDir);
  const failedChecks = validationResult.validation.checks.filter((check) => check.status === "failed").length;
  const smoke: HiveIntegrationSmokeCommandResult = sanitizeHiveValue({
    schemaVersion: "visual-hive.hive-integration-smoke.v1",
    generatedAt: new Date().toISOString(),
    project: exportResult.bundle.project,
    status: failedChecks ? "failed" : "passed",
    externalCallsMade: 0,
    commands: [
      "visual-hive hive export --dry-run",
      "visual-hive hive beads",
      "visual-hive hive validate-export",
      "visual-hive hive setup-pack"
    ],
    artifacts: {
      hiveExport: exportResult.paths.export,
      hiveBeads: beadsResult.paths.beads,
      importManifest: validationResult.paths.manifest,
      validationSummary: validationResult.paths.validation,
      setupPack: setupPackResult.paths.setupPack
    },
    summary: {
      beads: exportResult.bundle.summary.beads,
      knowledgeFacts: exportResult.bundle.summary.knowledgeFacts,
      graphNodes: exportResult.bundle.summary.graphNodes,
      graphEdges: exportResult.bundle.summary.graphEdges,
      agentWorkOrders: validationResult.validation.summary.agentWorkOrders,
      failedChecks
    },
    safety: validationResult.validation.safety
  }) as HiveIntegrationSmokeCommandResult;
  const markdown = renderHiveIntegrationSmokeMarkdown(smoke);
  const paths = {
    smoke: normalizeArtifactPath(path.join(outputDir, "hive-integration-smoke.json")),
    markdown: normalizeArtifactPath(path.join(outputDir, "hive-integration-smoke.md"))
  };
  await writeJson(path.resolve(rootDir, paths.smoke), smoke);
  await writeText(path.resolve(rootDir, paths.markdown), markdown);
  return { smoke, markdown, paths };
}

export function formatHiveIntegrationSmoke(result: HiveIntegrationSmokeCommandWriteResult, format: "markdown" | "json" = "markdown"): string {
  if (format === "json") return JSON.stringify(result.smoke, null, 2);
  return [
    `Wrote ${result.paths.smoke}`,
    `Wrote ${result.paths.markdown}`,
    "",
    `# Hive Integration Smoke: ${result.smoke.project}`,
    "",
    `- Status: ${result.smoke.status}`,
    `- Beads: ${result.smoke.summary.beads}`,
    `- Agent work orders: ${result.smoke.summary.agentWorkOrders}`,
    `- Failed checks: ${result.smoke.summary.failedChecks}`,
    `- External calls made: ${result.smoke.externalCallsMade}`
  ].join("\n");
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

async function rootDirFor(config: string | undefined, cwd: string | undefined): Promise<string> {
  const loaded = await loadConfig(config, cwd ?? process.cwd());
  return loaded.rootDir;
}

async function writeHiveBeadsAlias(rootDir: string, bundle: HiveExportBundle, outputDir: string): Promise<HiveBeadsCommandResult> {
  const paths = {
    beads: normalizeArtifactPath(path.join(outputDir, "hive-beads.json")),
    markdown: normalizeArtifactPath(path.join(outputDir, "hive-beads.md")),
    legacyBeads: bundle.outputArtifacts.beads
  };
  const markdown = sanitizeArtifactPathsForMarkdown(rootDir, renderHiveBeadsMarkdown(bundle));
  await writeJson(path.resolve(rootDir, paths.beads), bundle.beads);
  await writeText(path.resolve(rootDir, paths.markdown), markdown);
  return { beads: bundle.beads, markdown, paths };
}

async function writeHiveValidationArtifacts(
  rootDir: string,
  bundle: HiveExportBundle,
  hiveExportPath: string,
  outputDir: string
): Promise<HiveValidateExportCommandResult> {
  const generatedAt = new Date().toISOString();
  const paths = compatibilityPaths(bundle, outputDir);
  const checks = await validateHiveBundle(rootDir, bundle, hiveExportPath, paths);
  const failedChecks = checks.filter((check) => check.status === "failed").length;
  const safety = hiveSafety(rootDir, bundle);
  const manifest: HiveImportManifest = sanitizeHiveValue({
    schemaVersion: "visual-hive.hive-import-manifest.v1",
    generatedAt,
    project: bundle.project,
    status: failedChecks || safety.absolutePathLeaks || safety.secretLeaks ? "blocked" : "ready",
    externalCallsMade: 0,
    sourceArtifacts: {
      hiveExport: hiveExportPath,
      hiveBeads: paths.hiveBeads,
      knowledgeGraph: bundle.outputArtifacts.knowledgeGraph,
      knowledgeFacts: bundle.outputArtifacts.knowledgeFacts,
      wikiIndex: bundle.outputArtifacts.wikiIndex,
      issueContext: bundle.outputArtifacts.issueContext,
      agentWorkOrders: paths.agentWorkOrders,
      agentPolicy: bundle.outputArtifacts.agentPolicy
    },
    importer: {
      target: "kubestellar/hive",
      recommendedPackage: "v2/pkg/visualhive",
      beadStoreHint: "Hive v2 stores beads under deploy/data/beads/<agent>/beads.json or the configured data directory.",
      dashboardHint: "Expose Visual QA as a Hive dashboard setup/import view backed by sanitized Visual Hive artifacts."
    },
    summary: manifestSummary(bundle),
    safety,
    checks,
    beads: bundle.beads.map((bead) => ({
      id: bead.id,
      external_ref: bead.external_ref,
      status: bead.status,
      type: bead.type,
      actor: bead.actor
    }))
  }) as HiveImportManifest;
  const validation: HiveValidationSummary = sanitizeHiveValue({
    schemaVersion: "visual-hive.hive-validation-summary.v1",
    generatedAt,
    project: bundle.project,
    status: manifest.status === "ready" ? "passed" : "failed",
    externalCallsMade: 0,
    hiveExportPath,
    importManifestPath: paths.importManifest,
    checks,
    summary: manifest.summary,
    safety
  }) as HiveValidationSummary;
  await writeJson(path.resolve(rootDir, paths.importManifest), manifest);
  await writeJson(path.resolve(rootDir, paths.validationSummary), validation);
  await writeJson(path.resolve(rootDir, paths.agentWorkOrders), agentWorkOrdersFor(bundle));
  return { manifest, validation, paths: { manifest: paths.importManifest, validation: paths.validationSummary } };
}

async function writeHiveSetupPack(rootDir: string, bundle: HiveExportBundle, hiveExportPath: string, outputDir: string): Promise<HiveSetupPackCommandResult> {
  const paths = compatibilityPaths(bundle, outputDir);
  const setupPack: HiveSetupPack = sanitizeHiveValue({
    schemaVersion: "visual-hive.hive-setup-pack.v1",
    generatedAt: new Date().toISOString(),
    project: bundle.project,
    externalCallsMade: 0,
    acmmLevel: bundle.acmmLevel,
    sourceArtifacts: {
      hiveExport: hiveExportPath,
      hiveImportManifest: paths.importManifest
    },
    oneSetupFlow: [
      "Install the Hive GitHub App or run Hive in local/server mode.",
      "Enable Visual QA in Hive setup for the repository.",
      "Apply the reviewed Visual Hive setup pack as a normal setup PR.",
      "Run PR-safe Visual Hive checks without secrets.",
      "Run scheduled/deep mutation and canary checks from trusted workflows.",
      "Import sanitized Visual Hive evidence into Hive beads and issue lifecycle.",
      "Route beads to Hive agents under ACMM governance.",
      "Require Visual Hive validation before moving repair work forward."
    ],
    proposedFiles: [
      { path: "visual-hive.config.yaml", purpose: "Project-aware visual QA targets, contracts, mutations, and Hive integration policy.", trusted: false },
      { path: ".github/workflows/visual-hive-pr.yml", purpose: "Read-only PR-safe deterministic Visual Hive lane.", trusted: false },
      { path: ".github/workflows/visual-hive-scheduled.yml", purpose: "Trusted scheduled/deep lane for mutation, canaries, and import dry-runs.", trusted: true },
      { path: ".github/workflows/visual-hive-trusted-publisher.yml", purpose: "Workflow-run importer/publisher that consumes sanitized artifacts only.", trusted: true }
    ],
    permissions: [
      { workflow: "pull_request", permissions: { contents: "read" }, notes: "No secrets, no issues write, no live Hive/provider calls." },
      { workflow: "scheduled", permissions: { contents: "read", actions: "read" }, notes: "May use protected environment only for explicitly enabled trusted lanes." },
      { workflow: "trusted_publisher", permissions: { actions: "read", contents: "read", issues: "write" }, notes: "Does not checkout or execute PR code; dry-run by default." }
    ],
    validationCommands: [
      "visual-hive doctor",
      "visual-hive plan --mode pr",
      "visual-hive run --ci",
      "visual-hive mutate",
      "visual-hive evidence",
      "visual-hive hive export --dry-run --mode measured",
      "visual-hive hive validate-export",
      "visual-hive hive beads"
    ],
    baselineSetupSteps: [
      "Seed baselines only from a trusted local or protected workflow run.",
      "Review created baselines manually before enforcing CI.",
      "Never approve baselines automatically from an untrusted PR."
    ],
    selectorGuidance: [
      "Prefer stable data-testid selectors for page shells, critical controls, and user-visible contracts.",
      "Pair screenshots with selector/text assertions so visual evidence has semantic anchors.",
      "Map auth, route, API, and responsive risks to explicit contracts and mutations."
    ],
    labels: bundle.labels,
    agentProfiles: [
      agentProfile("setup_agent", "Apply initial Visual Hive config/workflow setup under review.", bundle),
      agentProfile("hive_quality_agent", "Triage failed visual contracts and route work to appropriate Hive beads.", bundle),
      agentProfile("hive_tester_agent", "Convert mutation survivors and coverage gaps into deterministic tests.", bundle),
      agentProfile("hive_ci_agent", "Maintain safe workflow lanes and trusted importer policy.", bundle),
      agentProfile("hive_security_agent", "Review path/secret leaks and protected target policy.", bundle)
    ],
    safetyGuardrails: [
      "Visual Hive owns deterministic verdicts; agents do not decide pass/fail.",
      "Visual Hive does not repair code, push branches, open PRs, merge, call Hive APIs, or create issues by default.",
      "PR workflows stay read-only and secret-free.",
      "Trusted publishing consumes sanitized artifacts and must not execute untrusted PR code.",
      "No paid providers, LLM calls, or Hive network calls are made unless explicitly configured in a trusted lane."
    ]
  }) as HiveSetupPack;
  const markdown = sanitizeArtifactPathsForMarkdown(rootDir, renderHiveSetupPackMarkdown(setupPack));
  await writeJson(path.resolve(rootDir, paths.setupPack), setupPack);
  await writeText(path.resolve(rootDir, paths.setupPackMarkdown), markdown);
  return { setupPack, markdown, paths: { setupPack: paths.setupPack, markdown: paths.setupPackMarkdown } };
}

function compatibilityPaths(bundle: HiveExportBundle, outputDir: string): {
  hiveBeads: string;
  importManifest: string;
  validationSummary: string;
  setupPack: string;
  setupPackMarkdown: string;
  agentWorkOrders: string;
} {
  const normalizedOutputDir = normalizeArtifactPath(outputDir);
  return {
    hiveBeads: normalizeArtifactPath(path.join(normalizedOutputDir, "hive-beads.json")),
    importManifest: normalizeArtifactPath(path.join(normalizedOutputDir, "hive-import-manifest.json")),
    validationSummary: normalizeArtifactPath(path.join(normalizedOutputDir, "hive-validation-summary.json")),
    setupPack: normalizeArtifactPath(path.join(normalizedOutputDir, "hive-setup-pack.json")),
    setupPackMarkdown: normalizeArtifactPath(path.join(normalizedOutputDir, "hive-setup-pack.md")),
    agentWorkOrders: normalizeArtifactPath(path.join(normalizedOutputDir, "hive-agent-work-orders.json"))
  };
}

async function validateHiveBundle(
  rootDir: string,
  bundle: HiveExportBundle,
  hiveExportPath: string,
  paths: ReturnType<typeof compatibilityPaths>
): Promise<HiveImportManifest["checks"]> {
  const checks: HiveImportManifest["checks"] = [];
  checks.push(check("schema-version", bundle.schemaVersion === "visual-hive.hive-export.v1", "Hive export schemaVersion is visual-hive.hive-export.v1."));
  checks.push(check("external-calls", bundle.externalCallsMade === 0, "Hive export made zero external calls."));
  checks.push(check("verdict-authority", bundle.governance.verdictAuthority === "visual_hive", "Visual Hive remains the deterministic verdict authority."));
  checks.push(check("acmm-policy", Number.isInteger(bundle.acmmLevel) && bundle.acmmLevel >= 1 && bundle.acmmLevel <= 6, `ACMM level is ${bundle.acmmLevel}.`));
  checks.push(check("dedupe-keys", bundle.beads.every((bead) => Boolean(bead.external_ref)), "Every bead has a stable external_ref dedupe key."));
  checks.push(check("validation-command", Boolean(bundle.agentPolicy.finalValidation.command), "Agent policy includes a final Visual Hive validation command."));
  const safety = hiveSafety(rootDir, bundle);
  checks.push(check("path-sanitization", safety.absolutePathLeaks === 0, `Path leak scan found ${safety.absolutePathLeaks} unsafe local path marker(s).`));
  checks.push(check("secret-sanitization", safety.secretLeaks === 0, `Secret leak scan found ${safety.secretLeaks} unsafe token marker(s).`));
  const artifactPaths = [
    hiveExportPath,
    bundle.outputArtifacts.beads,
    bundle.outputArtifacts.knowledgeFacts,
    bundle.outputArtifacts.knowledgeGraph,
    bundle.outputArtifacts.wikiIndex,
    bundle.outputArtifacts.issueContext,
    bundle.outputArtifacts.repairWorkOrders,
    bundle.outputArtifacts.agentPolicy
  ];
  for (const artifactPath of artifactPaths) {
    checks.push(check(`artifact:${artifactPath}`, await artifactExists(rootDir, artifactPath), `${artifactPath} exists.`));
  }
  checks.push(check("hive-beads-alias", await artifactExists(rootDir, paths.hiveBeads), `${paths.hiveBeads} exists or will be generated by visual-hive hive beads.`));
  return checks;
}

function check(id: string, passed: boolean, passedMessage: string): HiveImportManifest["checks"][number] {
  return {
    id,
    status: passed ? "passed" : "failed",
    message: passed ? passedMessage : passedMessage.replace(" exists.", " is missing.")
  };
}

async function artifactExists(rootDir: string, artifactPath: string): Promise<boolean> {
  try {
    await access(path.resolve(rootDir, artifactPath));
    return true;
  } catch {
    return false;
  }
}

function manifestSummary(bundle: HiveExportBundle): HiveImportManifest["summary"] {
  return {
    beads: bundle.beads.length,
    knowledgeFacts: bundle.knowledgeFacts.length,
    graphNodes: bundle.knowledgeGraph.nodes.length,
    graphEdges: bundle.knowledgeGraph.edges.length,
    agentWorkOrders: Math.max(bundle.repairWorkOrders.length, bundle.beads.length),
    blockedReasons: bundle.blockedReasons.length
  };
}

function hiveSafety(rootDir: string, value: unknown): HiveImportManifest["safety"] {
  const text = sanitizeArtifactPathsForMarkdown(rootDir, JSON.stringify(value, null, 2));
  return {
    pathSanitizationStatus: localPathLeakCount(text) === 0 ? "passed" : "failed",
    absolutePathLeaks: localPathLeakCount(text),
    secretLeaks: secretLeakCount(text),
    externalCallsMade: 0,
    networkCallsMade: 0,
    visualHiveCreatesBeads: false,
    visualHiveCreatesIssues: false,
    visualHiveRepairsCode: false
  };
}

function localPathLeakCount(text: string): number {
  return matchCount(text, /(?:C:\\Users|C:\/Users|OneDrive|\/Users\/|\/home\/|(?:^|[^\w])[A-Za-z]:[\\/])/g);
}

function secretLeakCount(text: string): number {
  return matchCount(text, /(?:GITHUB_TOKEN=|GH_TOKEN=|OPENAI_API_KEY=|ANTHROPIC_API_KEY=|PRIVATE KEY|Bearer\s+(?!\[REDACTED\])[A-Za-z0-9._~+/=-]+)/gi);
}

function matchCount(text: string, pattern: RegExp): number {
  return [...text.matchAll(pattern)].length;
}

function agentWorkOrdersFor(bundle: HiveExportBundle): Record<string, unknown> {
  const workOrders =
    bundle.repairWorkOrders.length > 0
      ? bundle.repairWorkOrders.map((order) => ({
          ...order,
          hiveBeadProjectionIds: order.sourceBeadIds,
          acmmLevel: bundle.acmmLevel,
          allowedActions: order.allowedActions,
          forbiddenActions: [...order.forbiddenActions, "decide_visual_hive_pass_fail", "approve_baselines_without_review"],
          finalValidationCommand: bundle.agentPolicy.finalValidation.command
        }))
      : bundle.beads.map((bead) => ({
          id: `${bead.id}-work-order`,
          title: bead.title,
          type: "advisory_visual_qa_work_order",
          status: bead.status === "blocked" ? "blocked" : "ready",
          actor: bead.actor,
          externalRef: bead.external_ref,
          dedupeFingerprint: bead.metadata.visual_hive_dedupe_fingerprint,
          hiveBeadProjectionIds: [bead.id],
          agentProfile: agentProfileForActor(bead.actor),
          acmmLevel: bundle.acmmLevel,
          issueKind: bead.metadata.visual_hive_issue_kind,
          severity: bead.metadata.visual_hive_severity,
          evidenceArtifacts: bead.metadata.visual_hive_artifacts,
          graphRefs: bead.metadata.visual_hive_graph_refs,
          impactSummary: bead.metadata.visual_hive_impact_summary,
          mutationSummary: bead.metadata.visual_hive_mutation_summary,
          reproductionCommand: bead.metadata.visual_hive_reproduction_command,
          validationCommand: bead.metadata.visual_hive_validation_command ?? bundle.agentPolicy.finalValidation.command,
          allowedActions: bundle.agentPolicy.allowedActions,
          forbiddenActions: [...bundle.agentPolicy.forbiddenActions, "decide_visual_hive_pass_fail", "approve_baselines_without_review"],
          expectedOutputSchema: {
            summary: "string",
            artifactsReviewed: "string[]",
            proposedTestsOrFixes: "string[]",
            validationCommand: "string",
            safetyNotes: "string[]"
          },
          noWriteDefault: true,
          finalValidationCommand: bundle.agentPolicy.finalValidation.command
        }));
  return sanitizeHiveValue({
    schemaVersion: "visual-hive.hive-agent-work-orders.v1",
    generatedAt: new Date().toISOString(),
    project: bundle.project,
    externalCallsMade: 0,
    acmmLevel: bundle.acmmLevel,
    sourceArtifacts: {
      hiveExport: bundle.outputArtifacts.export,
      repairWorkOrders: bundle.outputArtifacts.repairWorkOrders,
      agentPolicy: bundle.outputArtifacts.agentPolicy
    },
    policy: {
      verdictAuthority: "visual_hive",
      agentsDecidePassFail: false,
      visualHiveRepairsCode: false,
      requiresVisualHiveValidation: true
    },
    workOrders
  }) as Record<string, unknown>;
}

function agentProfileForActor(actor: string): string {
  if (actor.includes("ci")) return "hive_ci_agent";
  if (actor.includes("security")) return "hive_security_agent";
  if (actor.includes("setup")) return "setup_agent";
  if (actor.includes("tester")) return "hive_tester_agent";
  return "hive_quality_agent";
}

function agentProfile(profile: string, role: string, bundle: HiveExportBundle): HiveSetupPack["agentProfiles"][number] {
  return {
    profile,
    role,
    allowedActions: bundle.agentPolicy.allowedActions,
    forbiddenActions: bundle.agentPolicy.forbiddenActions
  };
}

function renderHiveBeadsMarkdown(bundle: HiveExportBundle): string {
  return [
    `# Hive Beads Projection: ${bundle.project}`,
    "",
    "<!-- visual-hive-hive-beads -->",
    "",
    `- Generated: ${bundle.generatedAt}`,
    `- ACMM level: ${bundle.acmmLevel}`,
    `- External calls made: ${bundle.externalCallsMade}`,
    `- Beads: ${bundle.beads.length}`,
    "",
    ...(bundle.beads.length
      ? bundle.beads.map((bead) =>
          [
            `## ${bead.title}`,
            "",
            `- ID: ${bead.id}`,
            `- Type: ${bead.type}`,
            `- Status: ${bead.status}`,
            `- Priority: P${bead.priority}`,
            `- Actor: ${bead.actor}`,
            `- Dedupe: ${bead.external_ref}`,
            "",
            bead.notes
          ].join("\n")
        )
      : ["No Hive bead projections are available. Run measured or repair-request mode after issues/evidence exist."])
  ].join("\n");
}

function renderHiveSetupPackMarkdown(setupPack: HiveSetupPack): string {
  return [
    `# Hive Visual QA Setup Pack: ${setupPack.project}`,
    "",
    "<!-- visual-hive-hive-setup-pack -->",
    "",
    "## Purpose",
    "",
    "This setup pack is a no-network artifact for Hive to review when enabling Visual Hive as the deterministic visual/UI QA capability for a repository.",
    "",
    "## One Setup Flow",
    "",
    ...setupPack.oneSetupFlow.map((step, index) => `${index + 1}. ${step}`),
    "",
    "## Proposed Files",
    "",
    ...setupPack.proposedFiles.map((file) => `- ${file.path}: ${file.purpose} (trusted=${file.trusted})`),
    "",
    "## Permissions",
    "",
    ...setupPack.permissions.map((item) => `- ${item.workflow}: ${JSON.stringify(item.permissions)} - ${item.notes}`),
    "",
    "## Validation Commands",
    "",
    ...setupPack.validationCommands.map((command) => `- \`${command}\``),
    "",
    "## Safety Guardrails",
    "",
    ...setupPack.safetyGuardrails.map((guardrail) => `- ${guardrail}`),
    "",
    "## Agent Profiles",
    "",
    ...setupPack.agentProfiles.map((profile) => `- ${profile.profile}: ${profile.role}`)
  ].join("\n");
}

function renderHiveIntegrationSmokeMarkdown(smoke: HiveIntegrationSmokeCommandResult): string {
  return [
    `# Hive Integration Smoke: ${smoke.project}`,
    "",
    "<!-- visual-hive-hive-integration-smoke -->",
    "",
    `- Status: ${smoke.status}`,
    `- External calls made: ${smoke.externalCallsMade}`,
    `- Beads: ${smoke.summary.beads}`,
    `- Knowledge facts: ${smoke.summary.knowledgeFacts}`,
    `- Graph: ${smoke.summary.graphNodes} nodes / ${smoke.summary.graphEdges} edges`,
    `- Agent work orders: ${smoke.summary.agentWorkOrders}`,
    `- Failed checks: ${smoke.summary.failedChecks}`,
    `- Path leaks: ${smoke.safety.absolutePathLeaks}`,
    `- Secret leaks: ${smoke.safety.secretLeaks}`,
    "",
    "## Artifacts",
    "",
    ...Object.entries(smoke.artifacts).map(([key, value]) => `- ${key}: ${value}`)
  ].join("\n");
}

function normalizeArtifactPath(value: string): string {
  return sanitizeText(value.replaceAll("\\", "/"));
}

function sanitizeHiveValue(value: unknown): unknown {
  if (typeof value === "string") return sanitizeText(value.replaceAll("\\", "/"));
  if (Array.isArray(value)) return value.map((item) => sanitizeHiveValue(item));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, sanitizeHiveValue(child)]));
  return value;
}

async function readOptionalHandoff(filePath: string): Promise<HandoffPacket | undefined> {
  try {
    const packet = await readJson<HandoffPacket>(filePath);
    return packet.schemaVersion === "visual-hive.handoff.v1" ? packet : undefined;
  } catch {
    return undefined;
  }
}
