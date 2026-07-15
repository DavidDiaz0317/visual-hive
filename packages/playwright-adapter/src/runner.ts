import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { lstat, mkdir, readdir, readFile, realpath, rm } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { createRequire } from "node:module";
import path from "node:path";
import {
  collectRepositoryMetadata,
  buildReportVerdict,
  catalogedReportOutputResource,
  ContractResultSchema,
  sanitizeText,
  normalizeProviderResults,
  type EvidenceContribution,
  type ContractResult,
  type PlaywrightExecutionBinding,
  type Plan,
  type Report,
  type TargetLifecycleEvent,
  type VisualHiveConfig
} from "@visual-hive/core";
import { generatePlaywrightSpec } from "./generator.js";
import { collectArtifacts } from "./artifactCollector.js";
import { startManagedServer, type ManagedServer } from "./serverManager.js";

const require = createRequire(import.meta.url);
const DEFAULT_PROCESS_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_PROCESS_OUTPUT_BYTES = 4 * 1024 * 1024;
const PROCESS_KILL_GRACE_MS = 1_000;

export interface RunPlaywrightOptions {
  config: VisualHiveConfig;
  plan: Plan;
  rootDir: string;
  ci?: boolean;
  mutationOperator?: string;
  mutationOperators?: string[];
  mutationMatrix?: Record<string, string[]>;
  runTargetCommands?: boolean;
  skipInstall?: boolean;
  skipBuild?: boolean;
  /** Isolates generated runner inputs for a request-bound execution. */
  generatedOutputDir?: string;
  /** Absolute path written by the generated spec with the launched browser identity. */
  runtimeSidecarPath?: string;
  /** Isolates Playwright's own test attachments from other executions. */
  playwrightOutputDir?: string;
  /** Hard bound for each install/build/teardown/Playwright subprocess. */
  processTimeoutMs?: number;
  /** Combined stdout/stderr bound for each subprocess. */
  maxProcessOutputBytes?: number;
  /** Absolute overall execution deadline inherited from Hive authorization. */
  deadlineAtMs?: number;
  /** Repair-only immutable identity mixed into the unpredictable Playwright execution binding. */
  repairBinding?: {
    captureInputDigest: string;
    requestId: string;
    requestDigest: string;
    phase: "before" | "after";
    commitSha: string;
  };
}

export interface RunPlaywrightContractsResult {
  report: Report;
  exitCode: number;
  executionBinding: PlaywrightExecutionBinding;
}

export async function runPlaywrightContracts(options: RunPlaywrightOptions): Promise<RunPlaywrightContractsResult> {
  const startedServers: Array<{ targetId: string; serviceName?: string; server: ManagedServer }> = [];
  const teardownCommands: Array<{ targetId: string; command: string; cwd: string }> = [];
  const targetLifecycle: TargetLifecycleEvent[] = [];
  const startedAt = Date.now();
  const limits = processLimits(options);
  let spec: Awaited<ReturnType<typeof generatePlaywrightSpec>> | undefined;
  let executionBinding: PreparedExecutionBinding | undefined;
  let playwrightResult: { stdout: string; stderr: string; exitCode: number } | undefined;
  let executionError: unknown;
  const targetStartupErrors = new Map<string, string>();
  const cleanupErrors: string[] = [];

  try {
    if (options.runTargetCommands ?? true) {
      const targetIds = options.plan.targets.map((target) => target.id);
      const completedInstalls = new Set<string>();
      // Repository installs are commonly shared by several targets. Run every
      // unique install before any target build so plan ordering cannot make a
      // Storybook or secondary target observe a half-prepared workspace.
      for (const targetId of targetIds) {
        const target = options.config.targets[targetId];
        if (
          (target.kind === "command" || target.kind === "storybook") &&
          target.install &&
          !options.skipInstall &&
          !completedInstalls.has(target.install)
        ) {
          await runLifecycleCommand(targetLifecycle, targetId, "install", target.install, options.rootDir, false, limits);
          completedInstalls.add(target.install);
        }
      }
      for (const targetId of targetIds) {
        const target = options.config.targets[targetId];
        try {
          if (target.kind === "command" || target.kind === "storybook") {
            if (target.build && !options.skipBuild) {
              await runLifecycleCommand(targetLifecycle, targetId, "build", target.build, options.rootDir, false, limits);
            }
            if (target.kind === "command" || target.serve) {
              const server = await startLifecycleServer(targetLifecycle, {
                targetId,
                serviceName: target.kind === "storybook" ? "storybook" : "serve",
                command: target.kind === "command" ? target.serve : target.serve!,
                cwd: options.rootDir,
                url: target.url
              }, limits);
              startedServers.push({ targetId, serviceName: target.kind === "storybook" ? "storybook" : "serve", server });
            }
          }
          if (target.kind === "commandGroup" || target.kind === "protected") {
            for (const setupCommand of target.setup ?? []) {
              await runLifecycleCommand(targetLifecycle, targetId, "setup", setupCommand, options.rootDir, false, limits);
            }
            for (const service of target.services ?? []) {
              const serviceUrl = service.healthPath ? new URL(service.healthPath, service.url).toString() : service.url;
              const server = await startLifecycleServer(targetLifecycle, {
                targetId,
                serviceName: service.name,
                command: service.command,
                cwd: options.rootDir,
                url: serviceUrl,
                timeoutMs: service.readinessTimeoutMs
              }, limits);
              startedServers.push({ targetId, serviceName: service.name, server });
            }
            for (const teardownCommand of target.teardown ?? []) {
              teardownCommands.push({ targetId, command: teardownCommand, cwd: options.rootDir });
            }
          }
        } catch (error) {
          targetStartupErrors.set(targetId, sanitizeText(error instanceof Error ? error.message : String(error)));
        }
      }
    }

    const runnableItems = options.plan.items.filter((item) => !targetStartupErrors.has(item.targetId));
    const runnablePlan = runnableItems.length === options.plan.items.length ? options.plan : {
      ...options.plan,
      items: runnableItems,
      targets: options.plan.targets.filter((target) => !targetStartupErrors.has(target.id))
    };
    executionBinding = await prepareBoundExecution(options, runnablePlan);
    spec = executionBinding.spec;
    if (runnableItems.length > 0) {
      const specArg = toPlaywrightPath(path.relative(options.rootDir, spec.path));
      const configArg = toPlaywrightPath(path.relative(options.rootDir, spec.configPath));
      const outputArg = toPlaywrightPath(
        path.isAbsolute(options.playwrightOutputDir ?? "")
          ? path.relative(options.rootDir, options.playwrightOutputDir!)
          : options.playwrightOutputDir ?? path.join(".visual-hive", "playwright-results")
      );
      assertManagedServersRunning(startedServers);
      playwrightResult = await runPlaywrightCli(
        ["test", specArg, `--config=${configArg}`, "--reporter=json", `--output=${outputArg}`],
        options.rootDir,
        {
          VISUAL_HIVE_CI: options.ci ? "true" : "false",
          VISUAL_HIVE_MUTATION_OPERATOR: options.mutationOperator ?? "",
          VISUAL_HIVE_MUTATION_OPERATORS: options.mutationOperators?.length ? JSON.stringify(options.mutationOperators) : "",
          VISUAL_HIVE_MUTATION_MATRIX: options.mutationMatrix ? JSON.stringify(options.mutationMatrix) : "",
          VISUAL_HIVE_RUNTIME_SIDECAR: options.runtimeSidecarPath ?? "",
          VISUAL_HIVE_EXECUTION_NONCE: executionBinding.nonce.toString("hex"),
          VISUAL_HIVE_EXECUTION_PAYLOAD: executionBinding.payload.toString("base64"),
          VISUAL_HIVE_EXECUTION_MAC: executionBinding.binding.bindingMacSha256,
          VISUAL_HIVE_EXECUTION_BINDING: JSON.stringify(executionBinding.binding),
          VISUAL_HIVE_SPEC_PATH: spec.path,
          VISUAL_HIVE_CONFIG_PATH: spec.configPath,
          VISUAL_HIVE_EVIDENCE_ROOT: executionBinding.evidenceRoot
        },
        true,
        limits
      );
      assertManagedServersRunning(startedServers);
      await verifyPreparedExecutionUnchanged(executionBinding);
    } else if (targetStartupErrors.size > 0) {
      playwrightResult = { stdout: "", stderr: "", exitCode: 1 };
    }
  } catch (error) {
    executionError = error;
  } finally {
    for (const started of startedServers.reverse()) {
      const stoppedAt = Date.now();
      try {
        await started.server.stop();
        targetLifecycle.push({
          targetId: started.targetId,
          serviceName: started.serviceName,
          phase: started.serviceName === "serve" ? "serve" : "service",
          status: "stopped",
          durationMs: Date.now() - stoppedAt,
          command: started.server.command,
          url: started.server.url
        });
      } catch (error) {
        const message = sanitizeText(error instanceof Error ? error.message : String(error));
        cleanupErrors.push(message);
        targetLifecycle.push({ targetId: started.targetId, serviceName: started.serviceName, phase: started.serviceName === "serve" ? "serve" : "service", status: "failed", durationMs: Date.now() - stoppedAt, command: started.server.command, url: started.server.url, message });
      }
    }
    for (const teardown of teardownCommands.reverse()) {
      try {
        await runLifecycleCommand(targetLifecycle, teardown.targetId, "teardown", teardown.command, teardown.cwd, true, limits);
      } catch (error) {
        cleanupErrors.push(sanitizeText(error instanceof Error ? error.message : String(error)));
      }
    }
  }

  if (!executionBinding) {
    try {
      executionBinding = await prepareBoundExecution(options, options.plan);
      spec = executionBinding.spec;
    } catch (error) {
      executionError = combineExecutionErrors(executionError, error);
    }
  }
  if (cleanupErrors.length > 0) executionError = combineExecutionErrors(executionError, new Error(`Playwright cleanup failed: ${cleanupErrors.join("; ")}`));
  if (!spec || !executionBinding) throw executionError instanceof Error ? executionError : new Error("Playwright execution could not establish a bound generated spec.");

  const report = await buildReportFromPlaywrightOutput({
    config: options.config,
    plan: options.plan,
    stdout: playwrightResult?.stdout ?? "",
    stderr: playwrightResult?.stderr ?? "",
    exitCode: playwrightResult?.exitCode ?? (executionError ? 1 : 0),
    rootDir: options.rootDir,
    durationMs: Date.now() - startedAt,
    targetLifecycle,
    generatedSpecPath: spec.path,
    executionBinding: executionBinding.binding,
    maxStructuredResultBytes: limits.maxOutputBytes,
    deadlineAtMs: options.deadlineAtMs,
    executionError,
    targetStartupErrors,
    mutationBatch: Boolean(options.mutationOperators?.length)
  });
  const processExitCode = playwrightResult?.exitCode ?? (executionError || targetStartupErrors.size > 0 ? 1 : 0);
  return { report, exitCode: processExitCode === 0 && report.status === "passed" ? 0 : Math.max(1, processExitCode), executionBinding: executionBinding.binding };
}

interface PreparedExecutionBinding {
  spec: Awaited<ReturnType<typeof generatePlaywrightSpec>>;
  nonce: Buffer;
  payload: Buffer;
  binding: PlaywrightExecutionBinding;
  evidenceRoot: string;
}

async function prepareBoundExecution(options: RunPlaywrightOptions, executionPlan: Plan): Promise<PreparedExecutionBinding> {
  const rootDir = await realpath(path.resolve(options.rootDir));
  const artifactRoot = containedOutputPath(rootDir, path.resolve(rootDir, options.config.visual.artifactDir), "artifact directory");
  const generatedRoot = containedOutputPath(rootDir, path.resolve(options.generatedOutputDir ?? path.join(rootDir, ".visual-hive", "generated")), "generated spec directory");
  const playwrightRoot = containedOutputPath(rootDir, path.resolve(rootDir, options.playwrightOutputDir ?? path.join(".visual-hive", "playwright-results")), "Playwright output directory");
  const runtimePath = options.runtimeSidecarPath ? containedOutputPath(rootDir, path.resolve(options.runtimeSidecarPath), "runtime sidecar") : undefined;
  const evidenceRoot = options.repairBinding
    ? containedOutputPath(rootDir, path.dirname(runtimePath ?? artifactRoot), "repair evidence root")
    : rootDir;
  for (const [label, candidate] of [["artifact directory", artifactRoot], ["generated spec directory", generatedRoot], ["Playwright output directory", playwrightRoot], ...(runtimePath ? [["runtime sidecar", runtimePath]] : [])] as Array<[string, string]>) {
    containedOutputPath(evidenceRoot, candidate, label);
  }
  if (options.repairBinding) {
    await createExclusiveContainedDirectory(rootDir, evidenceRoot, "repair evidence root");
  } else {
    await removeGeneratedResults(path.join(artifactRoot, "results"));
  }
  const spec = await generatePlaywrightSpec({ ...options, plan: executionPlan, outputDir: generatedRoot });
  const generatedSpecSha256 = sha256(Buffer.from(spec.content, "utf8"));
  const generatedConfigSha256 = sha256(Buffer.from(spec.configContent, "utf8"));
  if (sha256(await readFile(spec.path)) !== generatedSpecSha256 || sha256(await readFile(spec.configPath)) !== generatedConfigSha256) {
    throw new Error("Generated Playwright spec or config changed before its execution binding was established.");
  }
  const expectedContracts = executionPlan.items.map((item) => item.contractId).sort();
  const payload = Buffer.from(JSON.stringify({
    schemaVersion: "visual-hive.playwright-execution-binding.v1",
    repair: options.repairBinding ?? null,
    generatedSpecSha256,
    generatedConfigSha256,
    expectedContracts,
    expectedTargets: executionPlan.targets.map((target) => target.id).sort(),
    expectedResultFiles: expectedContracts.map((contractId) => `${safeResultName(contractId)}.json`),
    artifactDirectory: relativeOutputPath(rootDir, artifactRoot),
    generatedSpecPath: relativeOutputPath(rootDir, spec.path),
    generatedConfigPath: relativeOutputPath(rootDir, spec.configPath),
    playwrightOutputDirectory: relativeOutputPath(rootDir, playwrightRoot),
    runtimeSidecarPath: runtimePath ? relativeOutputPath(rootDir, runtimePath) : null,
    evidenceRootPath: samePath(rootDir, evidenceRoot) ? "." : relativeOutputPath(rootDir, evidenceRoot)
  }), "utf8");
  const nonce = randomBytes(32);
  const payloadSha256 = sha256(payload);
  const bindingMacSha256 = createHmac("sha256", nonce).update(payload).digest("hex");
  return {
    spec,
    nonce,
    payload,
    evidenceRoot,
    binding: {
      nonceSha256: sha256(nonce),
      generatedSpecSha256,
      generatedConfigSha256,
      payloadSha256,
      bindingMacSha256
    }
  };
}

async function verifyPreparedExecutionUnchanged(prepared: PreparedExecutionBinding): Promise<void> {
  if (sha256(await readFile(prepared.spec.path)) !== prepared.binding.generatedSpecSha256 || sha256(await readFile(prepared.spec.configPath)) !== prepared.binding.generatedConfigSha256) {
    throw new Error("Generated Playwright spec or config changed during its bound execution.");
  }
}

function containedOutputPath(rootDir: string, candidate: string, label: string): string {
  const absolute = path.resolve(candidate);
  const relative = path.relative(path.resolve(rootDir), absolute);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(`Playwright ${label} must remain inside its approved output root.`);
  return absolute;
}

async function createExclusiveContainedDirectory(rootDir: string, candidate: string, label: string): Promise<void> {
  const root = await realpath(path.resolve(rootDir));
  const absolute = containedOutputPath(root, candidate, label);
  const relative = path.relative(root, absolute);
  const segments = relative.split(path.sep).filter(Boolean);
  let current = root;
  for (const segment of segments.slice(0, -1)) {
    current = path.join(current, segment);
    const entry = await lstat(current);
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error(`Playwright ${label} parent contains a linked or non-directory entry.`);
    const resolved = await realpath(current);
    containedOutputPath(root, resolved, `${label} parent`);
    if (!samePath(resolved, current)) throw new Error(`Playwright ${label} parent was redirected through a junction or link.`);
  }
  try {
    await lstat(absolute);
    throw new Error(`Playwright ${label} already exists before its exclusive creation.`);
  } catch (error) {
    if (!isMissingPathError(error)) throw error;
  }
  await mkdir(absolute, { recursive: false });
  const created = await lstat(absolute);
  const resolved = await realpath(absolute);
  if (!created.isDirectory() || created.isSymbolicLink() || !samePath(resolved, absolute)) throw new Error(`Playwright ${label} creation was redirected.`);
  containedOutputPath(root, resolved, label);
}

function samePath(left: string, right: string): boolean {
  const normalize = (value: string): string => process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
  return normalize(left) === normalize(right);
}

function relativeOutputPath(rootDir: string, candidate: string): string {
  return toPlaywrightPath(path.relative(rootDir, containedOutputPath(rootDir, candidate, "output path")));
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function combineExecutionErrors(first: unknown, second: unknown): Error {
  const messages = [first, second].filter((value) => value !== undefined).map((value) => value instanceof Error ? value.message : String(value));
  return new Error(messages.join("; "));
}

function assertManagedServersRunning(startedServers: Array<{ targetId: string; serviceName?: string; server: ManagedServer }>): void {
  const stopped = startedServers.find((started) => !started.server.isRunning());
  if (stopped) throw new Error(`Managed target process exited during Playwright execution: ${stopped.targetId}/${stopped.serviceName ?? "service"}.`);
}

function runPlaywrightCli(
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  allowFailure = false,
  limits: ProcessLimits = defaultProcessLimits()
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const playwrightCli = resolvePlaywrightCli(cwd);
  const nodeModules = playwrightNodeModulesPath(playwrightCli);
  const childEnv = {
    ...env,
    NODE_PATH: [nodeModules, env.NODE_PATH].filter(Boolean).join(path.delimiter)
  };
  return runProcess(process.execPath, [playwrightCli, ...args], cwd, childEnv, allowFailure, false, limits);
}

export function resolvePlaywrightCli(cwd: string): string {
  void cwd;
  return require.resolve("@playwright/test/cli");
}

export function playwrightNodeModulesPath(playwrightCli: string): string {
  let current = path.dirname(path.resolve(playwrightCli));
  while (path.dirname(current) !== current) {
    if (path.basename(current) === "node_modules") return current;
    current = path.dirname(current);
  }
  return path.dirname(path.dirname(path.dirname(path.resolve(playwrightCli))));
}

async function removeGeneratedResults(resultsDir: string): Promise<void> {
  const retryable = new Set(["EBUSY", "ENOTEMPTY", "EPERM"]);
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(resultsDir, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      const code = typeof error === "object" && error && "code" in error ? String((error as NodeJS.ErrnoException).code) : "";
      if (!retryable.has(code)) throw error;
      await delay(100 * (attempt + 1));
    }
  }
  throw lastError;
}

export async function buildReportFromPlaywrightOutput(input: {
  config: VisualHiveConfig;
  plan: Plan;
  stdout: string;
  stderr: string;
  exitCode: number;
  rootDir: string;
  durationMs: number;
  targetLifecycle: TargetLifecycleEvent[];
  generatedSpecPath: string;
  executionBinding: PlaywrightExecutionBinding;
  maxStructuredResultBytes?: number;
  deadlineAtMs?: number;
  executionError?: unknown;
  targetStartupErrors: Map<string, string>;
  mutationBatch?: boolean;
}): Promise<Report> {
  if (!input.mutationBatch && !input.executionError) {
    await waitForStructuredContractResults(
      input.rootDir,
      input.config.visual.artifactDir,
      input.plan.items.filter((item) => !input.targetStartupErrors.has(item.targetId)).map((item) => item.contractId),
      input.executionBinding,
      input.deadlineAtMs
    );
  }
  const artifacts = await collectArtifacts(input.rootDir, input.config.visual.artifactDir, input.generatedSpecPath);
  const expectedStructuredTargets = new Map(input.plan.items.filter((item) => !input.targetStartupErrors.has(item.targetId)).map((item) => [item.contractId, item.targetId]));
  const structuredResultList = await readStructuredContractResults(
    input.rootDir,
    input.config.visual.artifactDir,
    input.executionBinding,
    expectedStructuredTargets,
    input.maxStructuredResultBytes ?? DEFAULT_PROCESS_OUTPUT_BYTES,
    Boolean(input.mutationBatch)
  );
  const structuredResults = new Map<string, ContractResult>();
  for (const structured of structuredResultList) {
    if (!structured.mutationOperator) structuredResults.set(structured.contractId, structured);
  }
  const repository = await collectRepositoryMetadata({ repoRoot: input.rootDir });
  const parsed = parsePlaywrightJson(input.stdout);
  const resultByContract = new Map<string, { status: "passed" | "failed"; errors: string[]; durationMs: number }>();
  const globalErrors = parsed ? extractPlaywrightGlobalErrors(parsed) : [];

  if (parsed) {
    for (const test of flattenPlaywrightTests(parsed)) {
      const contractId = extractContractId(test.title);
      if (!contractId) {
        continue;
      }
      if (resultByContract.has(contractId)) {
        globalErrors.push(`Playwright reporter returned duplicate contract ${contractId}.`);
        continue;
      }
      resultByContract.set(contractId, {
        status: test.ok ? "passed" : "failed",
        errors: test.errors,
        durationMs: test.durationMs
      });
    }
  }
  const expectedReporterContracts = new Set(input.plan.items.filter((item) => !input.targetStartupErrors.has(item.targetId)).map((item) => item.contractId));
  for (const contractId of resultByContract.keys()) if (!expectedReporterContracts.has(contractId)) globalErrors.push(`Playwright reporter returned unexpected contract ${contractId}.`);
  for (const contractId of expectedReporterContracts) if (!resultByContract.has(contractId)) globalErrors.push(`Playwright reporter did not return expected contract ${contractId}.`);
  const reporterHasFailedContract = [...resultByContract.values()].some((result) => result.status === "failed");
  const unexplainedProcessFailure = input.exitCode !== 0 && !reporterHasFailedContract;

  const results: ContractResult[] = input.mutationBatch && structuredResultList.length
    ? structuredResultList.map((structured) => normalizeStructuredContractResult(structured, artifacts, "visual-hive mutate", "contract-only"))
    : input.plan.items.map((item) => {
        const targetStartupError = input.targetStartupErrors.get(item.targetId);
        if (targetStartupError) {
          return {
            contractId: item.contractId,
            targetId: item.targetId,
            status: "failed" as const,
            durationMs: input.durationMs,
            errors: [targetStartupError],
            artifacts,
            reproductionCommand: "visual-hive run --ci"
          };
        }
        const structured = structuredResults.get(item.contractId);
        if (structured) {
          const normalized = normalizeStructuredContractResult(structured, artifacts, "visual-hive run --ci", "include-run-artifacts");
          const reporter = resultByContract.get(item.contractId);
          const structuredReporterStatus = normalized.status === "failed" ? "failed" : "passed";
          const mismatch = !reporter || reporter.status !== structuredReporterStatus;
          const globalFailure = input.executionError !== undefined || globalErrors.length > 0 || unexplainedProcessFailure;
          if (!mismatch && !globalFailure) return normalized;
          const reasons = [
            ...normalized.errors,
            ...(mismatch ? [`Bound structured result for ${item.contractId} does not match the exact Playwright reporter result.`] : []),
            ...(globalFailure ? [input.executionError instanceof Error ? input.executionError.message : input.executionError ? String(input.executionError) : globalErrors.join("; ") || `Playwright exited ${input.exitCode} without a failing reporter contract.`] : [])
          ].map((reason) => sanitizeText(reason));
          return { ...normalized, status: "failed" as const, errors: [...new Set(reasons)] };
        }
        const parsedResult = resultByContract.get(item.contractId);
        const missingStructuredEvidence = parsedResult?.status === "passed";
        const missingReporterEvidence = !parsedResult;
        const failed = missingStructuredEvidence || missingReporterEvidence || input.executionError !== undefined || globalErrors.length > 0 || (input.exitCode !== 0 && (!parsedResult || parsedResult.status === "failed"));
        const executionErrorMessage = input.executionError instanceof Error ? input.executionError.message : input.executionError ? String(input.executionError) : "";
        return {
          contractId: item.contractId,
          targetId: item.targetId,
          status: failed ? "failed" : (parsedResult?.status ?? "passed"),
          durationMs: parsedResult?.durationMs ?? input.durationMs,
          errors: missingStructuredEvidence
            ? [
                sanitizeText(
                  `Playwright reported contract "${item.contractId}" as passed, but Visual Hive did not find its structured result artifact. This run is treated as failed because report evidence is incomplete.`
                )
              ]
            : missingReporterEvidence
              ? [
                  `Playwright reporter did not return expected contract "${item.contractId}"; the run is incomplete and failed closed.`,
                  executionErrorMessage,
                  ...globalErrors,
                  input.stderr
                ].filter(Boolean).map((error) => sanitizeText(error))
            : parsedResult?.errors.length
              ? parsedResult.errors.map((error) => sanitizeText(error))
              : failed
                ? [
                    sanitizeText(
                      executionErrorMessage ||
                        globalErrors.join("\n\n") ||
                        input.stderr ||
                        "Playwright reported a failure without structured error details."
                    )
                  ]
                : [],
          artifacts,
          reproductionCommand: "visual-hive run --ci"
        };
      });
  const summary = buildSummary(results);

  const status = results.some((result) => result.status === "failed") ? "failed" : "passed";
  const providerResults = normalizeProviderResults(input.config, {
    deterministicStatus: status,
    artifactCount: artifacts.length,
    mode: input.plan.mode
  });
  const reportWithoutVerdict: Report = {
    schemaVersion: 2,
    project: input.config.project.name,
    outputResource: catalogedReportOutputResource(),
    repository,
    mode: input.plan.mode,
    generatedAt: new Date().toISOString(),
    status,
    changedFiles: input.plan.changedFiles,
    selectedTargets: input.plan.targets.map((target) => {
      const configTarget = input.config.targets[target.id];
      const missingSecrets = configTarget.kind === "protected" ? configTarget.requiresSecrets.filter((name) => !process.env[name]) : [];
      return { ...target, missingSecrets };
    }),
    selectedContracts: input.plan.items.map((item) => item.contractId),
    excludedContracts: input.plan.excluded,
    targetLifecycle: input.targetLifecycle,
    generatedSpecPath: input.generatedSpecPath,
    executionBinding: input.executionBinding,
    results,
    summary,
    consoleErrors: results.flatMap((result) => result.consoleErrors?.map((error) => error.message) ?? []),
    pageErrors: results.flatMap((result) => result.pageErrors ?? []),
    artifacts,
    providerResults,
    reproductionCommands: [
      `visual-hive plan --mode ${input.plan.mode}`,
      "visual-hive run",
      "visual-hive triage",
      "visual-hive report"
    ]
  };
  const reportVerdict = buildReportVerdict(reportWithoutVerdict);
  return sanitizeReport({
    ...reportWithoutVerdict,
    ...reportVerdict
  });
}

function extractPlaywrightGlobalErrors(report: unknown): string[] {
  return ((report as any)?.errors ?? [])
    .map((error: any) => error?.message ?? error?.stack ?? String(error))
    .filter(Boolean);
}

async function waitForStructuredContractResults(rootDir: string, artifactDir: string, contractIds: string[], _binding: PlaywrightExecutionBinding, deadlineAtMs?: number): Promise<void> {
  if (contractIds.length === 0) return;
  const resultsDir = path.join(rootDir, artifactDir, "results");
  const expected = new Set(contractIds.map((contractId) => `${safeResultName(contractId)}.json`));
  const deadline = Math.min(Date.now() + 1_000, deadlineAtMs ?? Number.MAX_SAFE_INTEGER);
  while (Date.now() < deadline) {
    const present = new Set(await listResultFiles(resultsDir));
    if ([...expected].every((file) => present.has(file))) {
      return;
    }
    await delay(100);
  }
}

async function listResultFiles(resultsDir: string): Promise<string[]> {
  try {
    const entries = await readdir(resultsDir, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

function safeResultName(value: string): string {
  return String(value).replace(/[^a-z0-9_.-]+/gi, "-");
}

export function normalizeStructuredContractResult(
  structured: ContractResult,
  runArtifacts: string[],
  fallbackReproductionCommand: string,
  artifactScope: "contract-only" | "include-run-artifacts"
): ContractResult {
  return {
    ...structured,
    errors: structured.errors.map((error) => sanitizeText(error)),
    artifacts:
      artifactScope === "contract-only"
        ? [...new Set(structured.artifacts ?? [])]
        : [...new Set([...(structured.artifacts ?? []), ...runArtifacts])],
    reproductionCommand: structured.reproductionCommand ?? fallbackReproductionCommand
  };
}

async function readStructuredContractResults(
  rootDir: string,
  artifactDir: string,
  binding: PlaywrightExecutionBinding,
  expectedTargets: ReadonlyMap<string, string>,
  maxTotalBytes: number,
  mutationBatch: boolean
): Promise<ContractResult[]> {
  const resultDir = path.join(rootDir, artifactDir, "results");
  const results: ContractResult[] = [];
  let totalBytes = 0;
  try {
    const entries = await readdir(resultDir, { withFileTypes: true });
    if (entries.length > 4096) throw new Error("Playwright structured-result inventory exceeds its file-count limit.");
    for (const entry of entries) {
      if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith(".json")) throw new Error(`Playwright structured-result inventory contains an unexpected entry: ${entry.name}.`);
      const resultPath = path.join(resultDir, entry.name);
      const info = await lstat(resultPath);
      if (!info.isFile() || info.isSymbolicLink() || info.size <= 0 || info.size > 4 * 1024 * 1024) throw new Error(`Playwright structured result is not a bounded ordinary file: ${entry.name}.`);
      totalBytes += info.size;
      if (totalBytes > maxTotalBytes) throw new Error(`Playwright structured-result inventory exceeds its aggregate byte limit of ${maxTotalBytes}.`);
      const raw = await readFile(resultPath, "utf8");
      const envelope = JSON.parse(raw) as { schemaVersion?: unknown; executionBinding?: unknown; result?: unknown };
      if (Object.keys(envelope).sort().join(",") !== "executionBinding,result,schemaVersion" || envelope.schemaVersion !== "visual-hive.playwright-contract-result.v1" || !sameExecutionBinding(envelope.executionBinding, binding) || !envelope.result || typeof envelope.result !== "object" || Array.isArray(envelope.result)) {
        throw new Error(`Playwright structured result has an invalid execution binding: ${entry.name}.`);
      }
      const parsed = ContractResultSchema.parse(envelope.result) as ContractResult;
      if (typeof parsed.contractId !== "string" || `${safeResultName(parsed.mutationOperator ? `${parsed.mutationOperator}__${parsed.contractId}` : parsed.contractId)}.json` !== entry.name) throw new Error(`Playwright structured result filename does not match its contract identity: ${entry.name}.`);
      const expectedTargetId = expectedTargets.get(parsed.contractId);
      if (!expectedTargetId || parsed.targetId !== expectedTargetId) throw new Error(`Playwright structured result does not match the expected contract and target inventory: ${entry.name}.`);
      if (!mutationBatch && parsed.mutationOperator) throw new Error(`Playwright deterministic run returned an unexpected mutation result: ${entry.name}.`);
      if (!mutationBatch && results.some((result) => result.contractId === parsed.contractId)) throw new Error(`Playwright structured-result inventory contains duplicate contract ${parsed.contractId}.`);
      results.push(parsed);
    }
  } catch (error) {
    if (!isMissingPathError(error)) throw error;
    return results;
  }
  if (!mutationBatch) {
    const actual = results.map((result) => result.contractId).sort();
    const expected = [...expectedTargets.keys()].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("Playwright structured-result inventory is incomplete or contains unexpected contracts.");
  }
  return results.sort((a, b) => `${a.mutationOperator ?? ""}:${a.contractId}`.localeCompare(`${b.mutationOperator ?? ""}:${b.contractId}`));
}

function sameExecutionBinding(value: unknown, expected: PlaywrightExecutionBinding): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.nonceSha256 === expected.nonceSha256 && candidate.generatedSpecSha256 === expected.generatedSpecSha256 && candidate.generatedConfigSha256 === expected.generatedConfigSha256 && candidate.payloadSha256 === expected.payloadSha256 && candidate.bindingMacSha256 === expected.bindingMacSha256 && Object.keys(candidate).length === 5;
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}

function parsePlaywrightJson(stdout: string): unknown | undefined {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(trimmed.slice(first, last + 1));
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

function flattenPlaywrightTests(report: unknown): Array<{ title: string; ok: boolean; errors: string[]; durationMs: number }> {
  const tests: Array<{ title: string; ok: boolean; errors: string[]; durationMs: number }> = [];
  const visitSuite = (suite: any): void => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const results = test.results ?? [];
        const ok = test.status === "expected" || results.some((result: any) => result.status === "passed");
        const errors = results.flatMap((result: any) => (result.errors ?? []).map((error: any) => error.message ?? String(error)));
        const durationMs = results.reduce((sum: number, result: any) => sum + (result.duration ?? 0), 0);
        tests.push({ title: spec.title ?? test.title ?? "", ok, errors, durationMs });
      }
    }
    for (const child of suite.suites ?? []) {
      visitSuite(child);
    }
  };
  for (const suite of (report as any)?.suites ?? []) {
    visitSuite(suite);
  }
  return tests;
}

function extractContractId(title: string): string | undefined {
  const match = /^contract:(.+)$/.exec(title);
  return match?.[1];
}

function toPlaywrightPath(value: string): string {
  return value.replaceAll("\\", "/");
}

function buildSummary(results: ContractResult[]): Report["summary"] {
  const screenshots = results.flatMap((result) => result.screenshotAssertions ?? []);
  const missingBaselines = screenshots.filter(
    (screenshot) => screenshot.status === "missing_baseline" || screenshot.message?.toLowerCase().includes("missing screenshot baseline")
  ).length;
  const screenshotsPassed = screenshots.filter((screenshot) => screenshot.status === "passed" || screenshot.status === "created").length;
  const screenshotsFailed = screenshots.filter((screenshot) => screenshot.status === "failed" || screenshot.status === "missing_baseline").length;
  const baselinesCreated = screenshots.filter((screenshot) => screenshot.status === "created").length;
  const flowSteps = results.flatMap((result) => result.flowSteps ?? []);
  return {
    passed: results.filter((result) => result.status === "passed" || result.status === "created").length,
    failed: results.filter((result) => result.status === "failed").length,
    screenshotsPassed,
    screenshotsFailed,
    baselinesCreated,
    createdBaselines: baselinesCreated,
    missingBaselines,
    visualDiffs: screenshots.filter((screenshot) => screenshot.status === "failed").length,
    consoleErrors: results.reduce((sum, result) => sum + (result.consoleErrors?.length ?? 0), 0),
    pageErrors: results.reduce((sum, result) => sum + (result.pageErrors?.length ?? 0), 0),
    flowStepsPassed: flowSteps.filter((step) => step.status === "passed").length,
    flowStepsFailed: flowSteps.filter((step) => step.status === "failed").length
  };
}

function sanitizeReport(report: Report): Report {
  return {
    ...report,
    repository: {
      ...report.repository,
      repository: sanitizeText(report.repository.repository),
      owner: report.repository.owner ? sanitizeText(report.repository.owner) : undefined,
      repo: report.repository.repo ? sanitizeText(report.repository.repo) : undefined,
      remoteUrl: report.repository.remoteUrl ? sanitizeText(report.repository.remoteUrl) : undefined,
      branch: report.repository.branch ? sanitizeText(report.repository.branch) : undefined,
      baseBranch: report.repository.baseBranch ? sanitizeText(report.repository.baseBranch) : undefined,
      commitSha: report.repository.commitSha ? sanitizeText(report.repository.commitSha) : undefined,
      runId: report.repository.runId ? sanitizeText(report.repository.runId) : undefined,
      runAttempt: report.repository.runAttempt ? sanitizeText(report.repository.runAttempt) : undefined,
      workflow: report.repository.workflow ? sanitizeText(report.repository.workflow) : undefined,
      actor: report.repository.actor ? sanitizeText(report.repository.actor) : undefined
    },
    selectedTargets: report.selectedTargets.map((target) => ({
      ...target,
      url: sanitizeText(target.url),
      missingSecrets: target.missingSecrets?.map((name) => sanitizeText(name))
    })),
    targetLifecycle: report.targetLifecycle.map((event) => ({
      ...event,
      command: event.command ? sanitizeText(event.command) : undefined,
      url: event.url ? sanitizeText(event.url) : undefined,
      message: event.message ? sanitizeText(event.message) : undefined
    })),
    generatedSpecPath: sanitizeText(report.generatedSpecPath),
    results: report.results.map(sanitizeContractResult),
    consoleErrors: report.consoleErrors.map((error) => sanitizeText(error)),
    pageErrors: report.pageErrors.map((error) => ({ ...error, message: sanitizeText(error.message) })),
    artifacts: report.artifacts.map((artifact) => sanitizeText(artifact)),
    providerResults: report.providerResults?.map((provider) => ({
      ...provider,
      message: sanitizeText(provider.message),
      requiredEnv: provider.requiredEnv.map((name) => sanitizeText(name)),
      missingEnv: provider.missingEnv.map((name) => sanitizeText(name)),
      externalUploadBlockedReasons: provider.externalUploadBlockedReasons?.map((reason) => sanitizeText(reason)),
      externalUrl: provider.externalUrl ? sanitizeText(provider.externalUrl) : undefined
    })),
    reproductionCommands: report.reproductionCommands.map((command) => sanitizeText(command)),
    verdictSummary: report.verdictSummary
      ? {
          visualHiveVerdict: report.verdictSummary.visualHiveVerdict,
          failedBecause: report.verdictSummary.failedBecause.map((reason) => sanitizeText(reason)),
          warningBecause: report.verdictSummary.warningBecause.map((reason) => sanitizeText(reason)),
          blockedBecause: report.verdictSummary.blockedBecause.map((reason) => sanitizeText(reason)),
          advisoryOnly: report.verdictSummary.advisoryOnly.map((reason) => sanitizeText(reason))
        }
      : undefined,
    verdictContributions: report.verdictContributions?.map(sanitizeEvidenceContribution)
  };
}

function sanitizeEvidenceContribution(contribution: EvidenceContribution): EvidenceContribution {
  return {
    ...contribution,
    key: sanitizeText(contribution.key),
    kind: sanitizeText(contribution.kind),
    mode: contribution.mode ? sanitizeText(contribution.mode) : undefined,
    contractId: contribution.contractId ? sanitizeText(contribution.contractId) : undefined,
    targetId: contribution.targetId ? sanitizeText(contribution.targetId) : undefined,
    operator: contribution.operator ? sanitizeText(contribution.operator) : undefined,
    providerId: contribution.providerId ? sanitizeText(contribution.providerId) : undefined,
    reason: sanitizeText(contribution.reason),
    artifacts: contribution.artifacts.map((artifact) => sanitizeText(artifact))
  };
}

function sanitizeContractResult(result: ContractResult): ContractResult {
  return {
    ...result,
    mutationOperator: result.mutationOperator ? sanitizeText(result.mutationOperator) : undefined,
    errors: result.errors.map((error) => sanitizeText(error)),
    artifacts: result.artifacts.map((artifact) => sanitizeText(artifact)),
    reproductionCommand: result.reproductionCommand ? sanitizeText(result.reproductionCommand) : undefined,
    selectorAssertions: result.selectorAssertions?.map((assertion) => ({
      ...assertion,
      value: sanitizeText(assertion.value),
      message: assertion.message ? sanitizeText(assertion.message) : undefined
    })),
    flowSteps: result.flowSteps?.map((step) => ({
      ...step,
      description: step.description ? sanitizeText(step.description) : undefined,
      selector: step.selector ? sanitizeText(step.selector) : undefined,
      route: step.route ? sanitizeText(step.route) : undefined,
      value: step.value ? sanitizeText(step.value) : undefined,
      message: step.message ? sanitizeText(step.message) : undefined
    })),
    screenshotAssertions: result.screenshotAssertions?.map((assertion) => ({
      ...assertion,
      baselinePath: sanitizeText(assertion.baselinePath),
      actualPath: sanitizeText(assertion.actualPath),
      diffPath: assertion.diffPath ? sanitizeText(assertion.diffPath) : undefined,
      message: assertion.message ? sanitizeText(assertion.message) : undefined
    })),
    consoleErrors: result.consoleErrors?.map((error) => ({ ...error, message: sanitizeText(error.message) })),
    pageErrors: result.pageErrors?.map((error) => ({ ...error, message: sanitizeText(error.message) })),
    networkErrors: result.networkErrors?.map((error) => ({
      ...error,
      url: sanitizeText(error.url),
      statusText: sanitizeText(error.statusText)
    }))
  };
}

async function runLifecycleCommand(
  events: TargetLifecycleEvent[],
  targetId: string,
  phase: TargetLifecycleEvent["phase"],
  command: string,
  cwd: string,
  allowFailure = false,
  limits: ProcessLimits = defaultProcessLimits()
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const startedAt = Date.now();
  try {
    const result = await runShell(command, cwd, {}, allowFailure, limits);
    events.push({
      targetId,
      phase,
      status: result.exitCode === 0 ? "passed" : "failed",
      durationMs: Date.now() - startedAt,
      command,
      message: result.exitCode === 0 ? undefined : sanitizeText(result.stderr || `Command exited with code ${result.exitCode}`)
    });
    return result;
  } catch (error) {
    events.push({
      targetId,
      phase,
      status: "failed",
      durationMs: Date.now() - startedAt,
      command,
      message: sanitizeText(error instanceof Error ? error.message : String(error))
    });
    throw error;
  }
}

async function startLifecycleServer(
  events: TargetLifecycleEvent[],
  input: { targetId: string; serviceName?: string; command: string; cwd: string; url: string; timeoutMs?: number },
  limits: ProcessLimits = defaultProcessLimits()
): Promise<ManagedServer> {
  const startedAt = Date.now();
  const phase: TargetLifecycleEvent["phase"] = input.serviceName === "serve" ? "serve" : "service";
  events.push({
    targetId: input.targetId,
    serviceName: input.serviceName,
    phase,
    status: "started",
    durationMs: 0,
    command: input.command,
    url: input.url
  });
  try {
    const server = await startManagedServer({
      command: input.command,
      cwd: input.cwd,
      url: input.url,
      timeoutMs: Math.min(input.timeoutMs ?? 30_000, limits.timeoutMs),
      deadlineAtMs: limits.deadlineAtMs
    });
    events.push({
      targetId: input.targetId,
      serviceName: input.serviceName,
      phase,
      status: "passed",
      durationMs: Date.now() - startedAt,
      command: input.command,
      url: input.url
    });
    return server;
  } catch (error) {
    events.push({
      targetId: input.targetId,
      serviceName: input.serviceName,
      phase,
      status: "failed",
      durationMs: Date.now() - startedAt,
      command: input.command,
      url: input.url,
      message: sanitizeText(error instanceof Error ? error.message : String(error))
    });
    throw error;
  }
}

function runShell(command: string, cwd: string, env: NodeJS.ProcessEnv, allowFailure = false, limits: ProcessLimits = defaultProcessLimits()): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return runProcess(command, [], cwd, env, allowFailure, true, limits);
}

interface ProcessLimits {
  timeoutMs: number;
  maxOutputBytes: number;
  deadlineAtMs?: number;
  consumedOutputBytes: number;
}

function defaultProcessLimits(): ProcessLimits {
  return { timeoutMs: DEFAULT_PROCESS_TIMEOUT_MS, maxOutputBytes: DEFAULT_PROCESS_OUTPUT_BYTES, consumedOutputBytes: 0 };
}

function processLimits(options: RunPlaywrightOptions): ProcessLimits {
  const timeoutMs = options.processTimeoutMs ?? DEFAULT_PROCESS_TIMEOUT_MS;
  const maxOutputBytes = options.maxProcessOutputBytes ?? DEFAULT_PROCESS_OUTPUT_BYTES;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 24 * 60 * 60 * 1000) throw new Error("Playwright subprocess timeout is outside its bounded range.");
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes <= 0 || maxOutputBytes > 64 * 1024 * 1024) throw new Error("Playwright subprocess output limit is outside its bounded range.");
  if (options.deadlineAtMs !== undefined && (!Number.isSafeInteger(options.deadlineAtMs) || options.deadlineAtMs <= 0)) throw new Error("Playwright overall deadline is invalid.");
  return { timeoutMs, maxOutputBytes, consumedOutputBytes: 0, ...(options.deadlineAtMs === undefined ? {} : { deadlineAtMs: options.deadlineAtMs }) };
}

function runProcess(
  executable: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  allowFailure = false,
  shell = false,
  limits: ProcessLimits = defaultProcessLimits()
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const remaining = limits.deadlineAtMs === undefined ? limits.timeoutMs : Math.min(limits.timeoutMs, limits.deadlineAtMs - Date.now());
    if (remaining <= 0) {
      reject(new Error(`Command deadline elapsed before launch: ${[executable, ...args].join(" ")}`));
      return;
    }
    const child = spawn(executable, args, {
      cwd,
      shell,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...env },
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let terminalError: Error | undefined;
    let settled = false;
    let forceKillTimer: NodeJS.Timeout | undefined;
    let terminationSettleTimer: NodeJS.Timeout | undefined;
    const terminate = (error: Error): void => {
      if (terminalError) return;
      terminalError = error;
      forceKillTimer = terminateProcessTree(child);
      terminationSettleTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(error);
      }, 15_000);
      terminationSettleTimer.unref();
    };
    const timer = setTimeout(() => terminate(new Error(`Command timed out after ${remaining}ms: ${[executable, ...args].join(" ")}`)), remaining);
    timer.unref();
    const append = (stream: "stdout" | "stderr", chunkValue: Buffer | string): void => {
      const chunk = Buffer.isBuffer(chunkValue) ? chunkValue : Buffer.from(chunkValue);
      outputBytes += chunk.byteLength;
      limits.consumedOutputBytes += chunk.byteLength;
      if (outputBytes > limits.maxOutputBytes || limits.consumedOutputBytes > limits.maxOutputBytes) {
        terminate(new Error(`Command output exceeded ${limits.maxOutputBytes} bytes: ${[executable, ...args].join(" ")}`));
        return;
      }
      if (stream === "stdout") stdout += chunk.toString();
      else stderr += chunk.toString();
    };
    child.stdout.on("data", (chunk) => {
      append("stdout", chunk);
    });
    child.stderr.on("data", (chunk) => {
      append("stderr", chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      if (terminalError) return;
      if (forceKillTimer) clearTimeout(forceKillTimer);
      if (terminationSettleTimer) clearTimeout(terminationSettleTimer);
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.on("close", (code) => {
      void (async () => {
        clearTimeout(timer);
        const residualTree = child.pid ? await reapResidualProcessTree(child.pid) : false;
        if (residualTree && !terminalError) terminalError = new Error(`Command left a detached descendant process and was failed closed: ${[executable, ...args].join(" ")}`);
        if (forceKillTimer) clearTimeout(forceKillTimer);
        if (terminationSettleTimer) clearTimeout(terminationSettleTimer);
        if (settled) return;
        settled = true;
        if (terminalError) {
          reject(terminalError);
          return;
        }
        const exitCode = code ?? 1;
        if (exitCode !== 0 && !allowFailure) {
          reject(new Error(sanitizeText(stderr || `Command failed with exit code ${exitCode}: ${[executable, ...args].join(" ")}`)));
          return;
        }
        resolve({ stdout, stderr, exitCode });
      })().catch((error) => {
        clearTimeout(timer);
        if (forceKillTimer) clearTimeout(forceKillTimer);
        if (terminationSettleTimer) clearTimeout(terminationSettleTimer);
        if (settled) return;
        settled = true;
        reject(error);
      });
    });
  });
}

async function reapResidualProcessTree(rootPid: number): Promise<boolean> {
  await delay(100);
  if (process.platform === "win32") {
    const descendants = windowsDescendantPids(rootPid);
    if (descendants.length === 0) return false;
    for (const pid of descendants.reverse()) {
      spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore", windowsHide: true, timeout: 5_000 });
    }
    await delay(100);
    const remaining = new Set(windowsProcessInventory().map((processEntry) => processEntry.pid));
    const survivors = descendants.filter((pid) => remaining.has(pid));
    if (survivors.length > 0) throw new Error(`Command descendant processes did not terminate: ${survivors.join(", ")}.`);
    return true;
  }
  if (!isUnixProcessGroupRunning(rootPid)) return false;
  try { process.kill(-rootPid, "SIGTERM"); } catch { /* group may already be exiting */ }
  const gracefulDeadline = Date.now() + PROCESS_KILL_GRACE_MS;
  while (Date.now() < gracefulDeadline && isUnixProcessGroupRunning(rootPid)) await delay(25);
  if (isUnixProcessGroupRunning(rootPid)) {
    try { process.kill(-rootPid, "SIGKILL"); } catch { /* group may already be gone */ }
  }
  const forcedDeadline = Date.now() + 3_000;
  while (Date.now() < forcedDeadline && isUnixProcessGroupRunning(rootPid)) await delay(25);
  if (isUnixProcessGroupRunning(rootPid)) throw new Error(`Command process group ${rootPid} did not terminate.`);
  return true;
}

function isUnixProcessGroupRunning(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function windowsDescendantPids(rootPid: number): number[] {
  const inventory = windowsProcessInventory();
  const children = new Map<number, number[]>();
  for (const entry of inventory) children.set(entry.parentPid, [...(children.get(entry.parentPid) ?? []), entry.pid]);
  const descendants: number[] = [];
  const pending = [...(children.get(rootPid) ?? [])];
  const seen = new Set<number>();
  while (pending.length > 0) {
    const pid = pending.shift()!;
    if (seen.has(pid)) continue;
    seen.add(pid);
    descendants.push(pid);
    pending.push(...(children.get(pid) ?? []));
  }
  return descendants;
}

function windowsProcessInventory(): Array<{ pid: number; parentPid: number }> {
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress"],
    { encoding: "utf8", windowsHide: true, timeout: 5_000, maxBuffer: 8 * 1024 * 1024 }
  );
  if (result.error || result.status !== 0) throw new Error("Visual Hive could not verify Windows command-tree cleanup.");
  const parsed = JSON.parse(result.stdout || "[]") as unknown;
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  return entries.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const value = entry as { ProcessId?: unknown; ParentProcessId?: unknown };
    const pid = Number(value.ProcessId);
    const parentPid = Number(value.ParentProcessId);
    return Number.isSafeInteger(pid) && pid > 0 && Number.isSafeInteger(parentPid) && parentPid >= 0 ? [{ pid, parentPid }] : [];
  });
}

function terminateProcessTree(child: ChildProcess): NodeJS.Timeout | undefined {
  const pid = child.pid;
  if (!pid) return undefined;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore", windowsHide: true, timeout: 5_000 });
    return undefined;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try { child.kill("SIGTERM"); } catch { /* already exited */ }
  }
  const force = setTimeout(() => {
    try { process.kill(-pid, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch { /* already exited */ } }
  }, PROCESS_KILL_GRACE_MS);
  force.unref();
  return force;
}
