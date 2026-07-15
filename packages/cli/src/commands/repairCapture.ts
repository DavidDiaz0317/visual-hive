import path from "node:path";
import {
  HiveRepairValidationRequestSpecSchema,
  HiveRepairBudgetLimitsSchema,
  canonicalJson,
  createPlan,
  loadConfig,
  parseHiveExecutionAuthorization,
  parseVisualHiveTaskContext
} from "@visual-hive/core";
import {
  parsePlaywrightRepairCaptureFinding,
  runPlaywrightRepairCapture,
  type PlaywrightRepairCaptureSource
} from "@visual-hive/playwright-adapter";
import { readBoundedJsonFile } from "./repairFileIo.js";
import {
  resolveVerifiedVisualHiveProducerIdentity,
  type VerifiedVisualHiveProducerIdentity
} from "./repairProducerIdentity.js";
import {
  assertHiveRepairSessionContainsRequest,
  assertHiveRepairSessionMatchesFinding,
  assertHiveRepairSessionMatchesTask,
  loadHiveRepairSessionSnapshot
} from "./repairSessionScope.js";

const MAX_REPAIR_INPUT_BYTES = 16 * 1024 * 1024;

export interface RepairCaptureCommandOptions {
  cwd?: string;
  config?: string;
  taskContext: string;
  hiveSession: string;
  request: string;
  authorization: string;
  budget: string;
  finding: string;
  phase: "before" | "after";
  sourceRef: string;
  sourceEvent: string;
  sourceTrusted?: boolean;
  sourceWorkflowName?: string;
  sourceWorkflowRunId?: string;
  sourceWorkflowRunAttempt?: string;
  sourceWorkflowArtifactId?: string;
  outputRoot?: string;
  acmmRequest?: number;
}

export interface RepairCaptureCommandDependencies {
  resolveProducerIdentity: () => Promise<Readonly<VerifiedVisualHiveProducerIdentity>>;
  capture: typeof runPlaywrightRepairCapture;
}

const DEFAULT_REPAIR_CAPTURE_DEPENDENCIES: RepairCaptureCommandDependencies = {
  resolveProducerIdentity: resolveVerifiedVisualHiveProducerIdentity,
  capture: runPlaywrightRepairCapture
};

export interface RepairCaptureCommandResult {
  schemaVersion: "visual-hive.repair-capture-command-result.v1";
  created: boolean;
  reused: boolean;
  phase: "before" | "after";
  requestId: string;
  requestDigest: string;
  commitSha: string;
  captureStatus: "passed" | "failed" | "blocked";
  exitCode: number;
  receiptDigest: string;
  runDirectory: string;
  runContextPath: string;
  runContextDigest: string;
  reportPath: string;
  reportSha256: string;
  runtimeIdentityPath: string;
  metadataPath: string;
  completionPath: string;
  bundleManifestPath: string;
  bundleDirectory: string;
  bundleDigest: string;
  evidenceAssetCount: number;
  externalCallsMade: 0;
}

export async function runRepairCaptureCommand(
  options: RepairCaptureCommandOptions,
  dependencies: RepairCaptureCommandDependencies = DEFAULT_REPAIR_CAPTURE_DEPENDENCIES
): Promise<RepairCaptureCommandResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const loaded = await loadConfig(options.config, cwd);
  const taskValue = await readBoundedJsonFile(path.resolve(options.taskContext), MAX_REPAIR_INPUT_BYTES, "Visual Hive repair task context");
  const hiveSession = await loadHiveRepairSessionSnapshot(options.hiveSession);
  const requestValue = await readBoundedJsonFile(path.resolve(options.request), MAX_REPAIR_INPUT_BYTES, "Visual Hive repair Hive validation request");
  const authorizationValue = await readBoundedJsonFile(path.resolve(options.authorization), MAX_REPAIR_INPUT_BYTES, "Visual Hive repair execution authorization");
  const budgetValue = await readBoundedJsonFile(path.resolve(options.budget), MAX_REPAIR_INPUT_BYTES, "Visual Hive repair execution budget");
  const findingValue = await readBoundedJsonFile(path.resolve(options.finding), MAX_REPAIR_INPUT_BYTES, "Visual Hive repair finding");
  const taskContext = parseVisualHiveTaskContext(taskValue);
  const brokerRequest = HiveRepairValidationRequestSpecSchema.parse(requestValue);
  const executionAuthorization = parseHiveExecutionAuthorization(authorizationValue);
  const budgetLimits = HiveRepairBudgetLimitsSchema.parse(budgetValue);
  const finding = parsePlaywrightRepairCaptureFinding(findingValue);
  assertHiveRepairSessionMatchesTask(hiveSession, taskContext);
  assertHiveRepairSessionMatchesFinding(hiveSession, finding);
  assertHiveRepairSessionContainsRequest(hiveSession, brokerRequest);
  if (!hiveSession.authorization || canonicalJson(hiveSession.authorization) !== canonicalJson(executionAuthorization)) {
    throw new Error("Hive repair capture authorization does not match its exact session snapshot.");
  }
  if (canonicalJson(hiveSession.budgets.limits) !== canonicalJson(budgetLimits)) {
    throw new Error("Hive repair capture budget does not match its exact session snapshot.");
  }
  const producer = await dependencies.resolveProducerIdentity();
  const expectedProducer = {
    visualHiveVersion: hiveSession.capability.visualHiveVersion ?? "",
    visualHiveCommit: hiveSession.capability.visualHiveCommit ?? "",
    manifestSha256: hiveSession.capability.visualHiveManifestSha256 ?? "",
    entrypointSha256: hiveSession.capability.visualHiveEntrypointSha256 ?? ""
  };
  if (!expectedProducer.visualHiveVersion || !expectedProducer.visualHiveCommit || !expectedProducer.manifestSha256 || !expectedProducer.entrypointSha256) {
    throw new Error("Hive repair session does not pin the Visual Hive producer identity.");
  }
  if (producer.visualHiveVersion !== expectedProducer.visualHiveVersion || producer.visualHiveCommit !== expectedProducer.visualHiveCommit || producer.manifestSha256 !== expectedProducer.manifestSha256 || producer.entrypointSha256 !== expectedProducer.entrypointSha256) {
    throw new Error("Verified Visual Hive producer identity does not match the Hive repair session capability pin.");
  }
  if (!options.sourceRef.trim() || !options.sourceEvent.trim()) {
    throw new Error("Visual Hive repair capture requires source ref and event identity.");
  }
  if (options.acmmRequest !== undefined && (!Number.isSafeInteger(options.acmmRequest) || options.acmmRequest < 1 || options.acmmRequest > 6)) {
    throw new Error("Visual Hive repair capture ACMM request must be an integer from 1 through 6.");
  }

  // Plan generation time is bound to the immutable task context so separate
  // before and after commands derive the same plan digest from the same config.
  const plan = createPlan(loaded.config, {
    mode: "full",
    changedFiles: [],
    allowUnsafeTargets: false,
    now: new Date(taskContext.generatedAt)
  });
  if (plan.items.length === 0 || plan.excluded.length > 0) {
    const excluded = plan.excluded.map((entry) => `${entry.contractId}: ${entry.reasons.join("; ")}`).join(", ");
    throw new Error(`Visual Hive repair capture requires a complete full plan.${excluded ? ` Excluded: ${excluded}` : ""}`);
  }

  const source: PlaywrightRepairCaptureSource = {
    ref: options.sourceRef.trim(),
    event: options.sourceEvent.trim(),
    trusted: options.sourceTrusted ?? false,
    ...(options.sourceWorkflowName ? { workflowName: options.sourceWorkflowName } : {}),
    ...(options.sourceWorkflowRunId ? { workflowRunId: options.sourceWorkflowRunId } : {}),
    ...(options.sourceWorkflowRunAttempt ? { workflowRunAttempt: options.sourceWorkflowRunAttempt } : {}),
    ...(options.sourceWorkflowArtifactId ? { workflowArtifactId: options.sourceWorkflowArtifactId } : {})
  };
  const captured = await dependencies.capture({
    rootDir: loaded.rootDir,
    config: loaded.config,
    plan,
    taskContext,
    brokerRequest,
    executionAuthorization,
    budgetLimits,
    phase: options.phase,
    finding,
    producer,
    expectedProducer,
    source,
    ...(options.outputRoot ? { outputRoot: options.outputRoot } : {}),
    ...(options.acmmRequest === undefined ? {} : { acmmRequest: options.acmmRequest }),
  });
  return {
    schemaVersion: "visual-hive.repair-capture-command-result.v1",
    created: !captured.reused,
    reused: captured.reused,
    phase: captured.phase,
    requestId: captured.requestId,
    requestDigest: captured.requestDigest,
    commitSha: captured.commitSha,
    captureStatus: captured.captureStatus,
    exitCode: captured.exitCode,
    receiptDigest: captured.receiptDigest,
    runDirectory: captured.runDirectory,
    runContextPath: captured.runContextPath,
    runContextDigest: captured.runContext.runContextDigest,
    reportPath: captured.reportPath,
    reportSha256: captured.runContext.report.sha256,
    runtimeIdentityPath: captured.runtimeIdentityPath,
    metadataPath: captured.metadataPath,
    completionPath: captured.completionPath,
    bundleManifestPath: captured.bundleManifestPath,
    bundleDirectory: captured.bundleDirectory,
    bundleDigest: captured.bundleManifest.overallDigest,
    evidenceAssetCount: captured.runContext.evidenceAssets.length,
    externalCallsMade: 0
  };
}
