import { spawn } from "node:child_process";
import { readdir, readFile, rm } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import {
  collectRepositoryMetadata,
  buildReportVerdict,
  sanitizeText,
  normalizeProviderResults,
  type EvidenceContribution,
  type ContractResult,
  type Plan,
  type Report,
  type TargetLifecycleEvent,
  type VisualHiveConfig
} from "@visual-hive/core";
import { generatePlaywrightSpec } from "./generator.js";
import { collectArtifacts } from "./artifactCollector.js";
import { startManagedServer, type ManagedServer } from "./serverManager.js";

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
}

export async function runPlaywrightContracts(options: RunPlaywrightOptions): Promise<{ report: Report; exitCode: number }> {
  const startedServers: Array<{ targetId: string; serviceName?: string; server: ManagedServer }> = [];
  const teardownCommands: Array<{ targetId: string; command: string; cwd: string }> = [];
  const targetLifecycle: TargetLifecycleEvent[] = [];
  const startedAt = Date.now();
  const spec = await generatePlaywrightSpec(options);
  await removeGeneratedResults(path.join(options.rootDir, options.config.visual.artifactDir, "results"));
  let playwrightResult: { stdout: string; stderr: string; exitCode: number } | undefined;
  let executionError: unknown;

  try {
    if (options.runTargetCommands ?? true) {
      for (const targetId of options.plan.targets.map((target) => target.id)) {
        const target = options.config.targets[targetId];
        if (target.kind === "command" || target.kind === "storybook") {
          if (target.install && !options.skipInstall) {
            await runLifecycleCommand(targetLifecycle, targetId, "install", target.install, options.rootDir);
          }
          if (target.build && !options.skipBuild) {
            await runLifecycleCommand(targetLifecycle, targetId, "build", target.build, options.rootDir);
          }
          if (target.kind === "command" || target.serve) {
            const server = await startLifecycleServer(targetLifecycle, {
              targetId,
              serviceName: target.kind === "storybook" ? "storybook" : "serve",
              command: target.kind === "command" ? target.serve : target.serve!,
              cwd: options.rootDir,
              url: target.url
            });
            startedServers.push({ targetId, serviceName: target.kind === "storybook" ? "storybook" : "serve", server });
          }
        }
        if (target.kind === "commandGroup" || target.kind === "protected") {
          for (const setupCommand of target.setup ?? []) {
            await runLifecycleCommand(targetLifecycle, targetId, "setup", setupCommand, options.rootDir);
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
            });
            startedServers.push({ targetId, serviceName: service.name, server });
          }
          for (const teardownCommand of target.teardown ?? []) {
            teardownCommands.push({ targetId, command: teardownCommand, cwd: options.rootDir });
          }
        }
      }
    }

    const specArg = toPlaywrightPath(path.relative(options.rootDir, spec.path));
    const outputArg = toPlaywrightPath(path.join(".visual-hive", "playwright-results"));
    playwrightResult = await runShell(
      `npx playwright test "${specArg}" --reporter=json --output="${outputArg}"`,
      options.rootDir,
      {
        VISUAL_HIVE_CI: options.ci ? "true" : "false",
        VISUAL_HIVE_MUTATION_OPERATOR: options.mutationOperator ?? "",
        VISUAL_HIVE_MUTATION_OPERATORS: options.mutationOperators?.length ? JSON.stringify(options.mutationOperators) : "",
        VISUAL_HIVE_MUTATION_MATRIX: options.mutationMatrix ? JSON.stringify(options.mutationMatrix) : ""
      },
      true
    );
  } catch (error) {
    executionError = error;
  } finally {
    for (const started of startedServers.reverse()) {
      const stoppedAt = Date.now();
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
    }
    for (const teardown of teardownCommands.reverse()) {
      await runLifecycleCommand(targetLifecycle, teardown.targetId, "teardown", teardown.command, teardown.cwd, true);
    }
  }

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
    executionError,
    mutationBatch: Boolean(options.mutationOperators?.length)
  });
  return { report, exitCode: playwrightResult?.exitCode ?? (executionError ? 1 : 0) };
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

async function buildReportFromPlaywrightOutput(input: {
  config: VisualHiveConfig;
  plan: Plan;
  stdout: string;
  stderr: string;
  exitCode: number;
  rootDir: string;
  durationMs: number;
  targetLifecycle: TargetLifecycleEvent[];
  generatedSpecPath: string;
  executionError?: unknown;
  mutationBatch?: boolean;
}): Promise<Report> {
  const artifacts = await collectArtifacts(input.rootDir, input.config.visual.artifactDir, input.generatedSpecPath);
  const structuredResultList = await readStructuredContractResults(input.rootDir, input.config.visual.artifactDir);
  const structuredResults = new Map<string, ContractResult>();
  for (const structured of structuredResultList) {
    if (!structured.mutationOperator) structuredResults.set(structured.contractId, structured);
  }
  const repository = await collectRepositoryMetadata({ repoRoot: input.rootDir });
  const parsed = parsePlaywrightJson(input.stdout);
  const resultByContract = new Map<string, { status: "passed" | "failed"; errors: string[]; durationMs: number }>();

  if (parsed) {
    for (const test of flattenPlaywrightTests(parsed)) {
      const contractId = extractContractId(test.title);
      if (!contractId) {
        continue;
      }
      resultByContract.set(contractId, {
        status: test.ok ? "passed" : "failed",
        errors: test.errors,
        durationMs: test.durationMs
      });
    }
  }

  const results: ContractResult[] = input.mutationBatch && structuredResultList.length
    ? structuredResultList.map((structured) => normalizeStructuredContractResult(structured, artifacts, "visual-hive mutate", "contract-only"))
    : input.plan.items.map((item) => {
        const structured = structuredResults.get(item.contractId);
        if (structured) {
          return normalizeStructuredContractResult(structured, artifacts, "visual-hive run --ci", "include-run-artifacts");
        }
        const parsedResult = resultByContract.get(item.contractId);
        const failed = input.exitCode !== 0 && (!parsedResult || parsedResult.status === "failed");
        const executionErrorMessage = input.executionError instanceof Error ? input.executionError.message : input.executionError ? String(input.executionError) : "";
        return {
          contractId: item.contractId,
          targetId: item.targetId,
          status: parsedResult?.status ?? (failed ? "failed" : "passed"),
          durationMs: parsedResult?.durationMs ?? input.durationMs,
          errors: parsedResult?.errors.length
            ? parsedResult.errors.map((error) => sanitizeText(error))
            : failed
              ? [sanitizeText(executionErrorMessage || input.stderr || "Playwright reported a failure without structured error details.")]
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

async function readStructuredContractResults(rootDir: string, artifactDir: string): Promise<ContractResult[]> {
  const resultDir = path.join(rootDir, artifactDir, "results");
  const results: ContractResult[] = [];
  try {
    const entries = await readdir(resultDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }
      const raw = await readFile(path.join(resultDir, entry.name), "utf8");
      const parsed = JSON.parse(raw) as ContractResult;
      results.push(parsed);
    }
  } catch {
    return results;
  }
  return results.sort((a, b) => `${a.mutationOperator ?? ""}:${a.contractId}`.localeCompare(`${b.mutationOperator ?? ""}:${b.contractId}`));
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
  allowFailure = false
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const startedAt = Date.now();
  try {
    const result = await runShell(command, cwd, {}, allowFailure);
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
  input: { targetId: string; serviceName?: string; command: string; cwd: string; url: string; timeoutMs?: number }
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
      timeoutMs: input.timeoutMs
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

function runShell(command: string, cwd: string, env: NodeJS.ProcessEnv, allowFailure = false): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...env },
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      const exitCode = code ?? 1;
      if (exitCode !== 0 && !allowFailure) {
        reject(new Error(sanitizeText(stderr || `Command failed with exit code ${exitCode}: ${command}`)));
        return;
      }
      resolve({ stdout, stderr, exitCode });
    });
  });
}
