import path from "node:path";
import { rm } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import {
  buildMutationReport,
  loadConfig,
  readJson,
  sanitizeText,
  writeJson,
  selectContractsForMutation,
  MUTATION_OPERATOR_METADATA,
  mutationOperatorId,
  type MutationReport,
  type MutationResult,
  type Plan,
  type Report,
  type VisualHiveConfig
} from "@visual-hive/core";
import { runPlaywrightContracts, startManagedServer, type ManagedServer } from "@visual-hive/playwright-adapter";

export type MutationRunner = (options: {
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
}) => Promise<{ report: Report; exitCode: number }>;

export interface MutateCommandOptions {
  config?: string;
  cwd?: string;
  plan?: string;
  enforceMinScore?: boolean;
  runner?: MutationRunner;
  skipInstall?: boolean;
  skipBuild?: boolean;
}

interface MutationTargetSession {
  stop: () => Promise<void>;
}

interface ApplicableMutationMapping {
  operatorId: string;
  selectedItems: Plan["items"];
  expectedFailureKinds: string[];
}

const MUTATION_LIFECYCLE_COMMAND_TIMEOUT_MS = 300_000;

export async function runMutateCommand(options: MutateCommandOptions = {}): Promise<{ exitCode: number; reportPath: string; report: MutationReport }> {
  const cwd = options.cwd ?? process.cwd();
  const loaded = await loadConfig(options.config, cwd);
  const plan = await readJson<Plan>(path.resolve(loaded.rootDir, options.plan ?? path.join(".visual-hive", "plan.json")));
  if (plan.items.length === 0) {
    throw new Error(`No contracts selected in mutation plan. Run "visual-hive plan" with matching contracts before "visual-hive mutate".`);
  }
  const operators = plan.mutation.enabled ? plan.mutation.operators : loaded.config.mutation.operators;
  if (operators.length === 0) {
    throw new Error(`No mutation operators configured. Add mutation.operators to visual-hive.config.yaml before running "visual-hive mutate".`);
  }
  const results: MutationResult[] = [];
  const runner = options.runner ?? runPlaywrightContracts;
  const manageTargetLifecycle = !options.runner;
  let targetSession: MutationTargetSession | undefined;
  const deterministicReportPath = path.join(loaded.rootDir, ".visual-hive", "report.json");
  const previousDeterministicReport = await readOptionalReport(deterministicReportPath);

  if (manageTargetLifecycle) {
    try {
      return await runDefaultMutationBatch({
        config: loaded.config,
        plan,
        rootDir: loaded.rootDir,
        operators,
        enforceMinScore: options.enforceMinScore,
        skipInstall: options.skipInstall,
        skipBuild: options.skipBuild
      });
    } finally {
      await restoreDeterministicReport(deterministicReportPath, previousDeterministicReport);
    }
  }

  try {
    for (const operator of operators) {
      const mapping = selectContractsForMutation(
        operator,
        loaded.config.contracts.filter((contract) => plan.items.some((item) => item.contractId === contract.id))
      );
      const selectedItems = plan.items.filter((item) => mapping.contractIds.includes(item.contractId));
      const selectedTargetIds = [...new Set(selectedItems.map((item) => item.targetId))];
      if (!mapping.applicable || selectedItems.length === 0) {
        const metadata = MUTATION_OPERATOR_METADATA[mapping.operatorId];
        results.push({
          operator: mapping.operatorId,
          status: "not_applicable",
          killed: false,
          applicable: false,
          contractIds: [],
          affected: [],
          expectedFailureKinds: metadata.expectedFailureKinds,
          durationMs: 0,
          artifacts: [],
          validationCommand: "visual-hive mutate --config visual-hive.config.yaml --enforce-min-score",
          suggestedMissingTest: `Map mutation ${mapping.operatorId} to a relevant contract or document why it is not applicable.`,
          mutationMode: "runtime",
          sourceMutation: false,
          errors: [`Mutation ${mapping.operatorId} was not applicable: ${mapping.reason}`]
        });
        continue;
      }
      const metadata = MUTATION_OPERATOR_METADATA[mapping.operatorId];
      const startedAt = Date.now();
      const mutationPlan: Plan = {
        ...plan,
        items: selectedItems,
        targets: plan.targets.filter((target) => selectedTargetIds.includes(target.id))
      };
      if (manageTargetLifecycle && !targetSession) {
        targetSession = await startMutationTargetSession({
          config: loaded.config,
          plan,
          rootDir: loaded.rootDir,
          skipInstall: options.skipInstall,
          skipBuild: options.skipBuild
        });
      }
      const { report, exitCode } = await runner({
        config: loaded.config,
        plan: mutationPlan,
        rootDir: loaded.rootDir,
        ci: true,
        mutationOperator: mapping.operatorId,
        runTargetCommands: !manageTargetLifecycle,
        skipInstall: options.skipInstall,
        skipBuild: options.skipBuild
      });
      const killed = exitCode !== 0 || report.status === "failed";
      const errors = report.results.flatMap((result) => result.errors);
      results.push({
        operator: mapping.operatorId,
        status: killed ? "killed" : "survived",
        killed,
        applicable: true,
        contractIds: selectedItems.map((item) => item.contractId),
        ...mutationResultContext(loaded.config, selectedItems, mapping.operatorId, killed),
        expectedFailureKinds: metadata.expectedFailureKinds,
        failureKind: killed ? inferFailureKind(errors) : undefined,
        failedAssertion: killed ? errors[0] : undefined,
        durationMs: Date.now() - startedAt,
        errors,
        artifacts: [...new Set(report.results.flatMap((result) => result.artifacts))]
      });
    }

    const report = buildMutationReport({
      project: loaded.config.project.name,
      minScore: loaded.config.mutation.minScore,
      results
    });
    const reportPath = path.join(loaded.rootDir, ".visual-hive", "mutation-report.json");
    await writeJson(reportPath, report);
    const exitCode = options.enforceMinScore && report.score < report.minScore ? 1 : 0;
    return { exitCode, reportPath, report };
  } finally {
    await targetSession?.stop();
    await restoreDeterministicReport(deterministicReportPath, previousDeterministicReport);
  }
}

async function startMutationTargetSession(input: {
  config: VisualHiveConfig;
  plan: Plan;
  rootDir: string;
  skipInstall?: boolean;
  skipBuild?: boolean;
}): Promise<MutationTargetSession> {
  const startedServers: Array<{ server: ManagedServer }> = [];
  const teardownCommands: Array<{ command: string; cwd: string }> = [];
  try {
    for (const target of input.plan.targets) {
      const targetConfig = input.config.targets[target.id];
      if (targetConfig.kind === "url") {
        continue;
      }
      if (targetConfig.kind === "command" || targetConfig.kind === "storybook") {
        if (targetConfig.install && !input.skipInstall) {
          await runMutationLifecycleCommand(targetConfig.install, input.rootDir);
        }
        if (targetConfig.build && !input.skipBuild) {
          await runMutationLifecycleCommand(targetConfig.build, input.rootDir);
        }
        const serveCommand = targetConfig.kind === "command" ? targetConfig.serve : targetConfig.serve;
        if (serveCommand) {
          const server = await startManagedServer({
            command: serveCommand,
            cwd: input.rootDir,
            url: targetConfig.url
          });
          startedServers.push({ server });
        }
      }
      if (targetConfig.kind === "commandGroup" || targetConfig.kind === "protected") {
        for (const setupCommand of targetConfig.setup ?? []) {
          await runMutationLifecycleCommand(setupCommand, input.rootDir);
        }
        for (const service of targetConfig.services ?? []) {
          const serviceUrl = service.healthPath ? new URL(service.healthPath, service.url).toString() : service.url;
          const server = await startManagedServer({
            command: service.command,
            cwd: input.rootDir,
            url: serviceUrl,
            timeoutMs: service.readinessTimeoutMs
          });
          startedServers.push({ server });
        }
        for (const teardownCommand of targetConfig.teardown ?? []) {
          teardownCommands.push({ command: teardownCommand, cwd: input.rootDir });
        }
      }
    }
    return {
      stop: async () => {
        for (const started of startedServers.reverse()) {
          await started.server.stop();
        }
        for (const teardown of teardownCommands.reverse()) {
          await runMutationLifecycleCommand(teardown.command, teardown.cwd, true);
        }
      }
    };
  } catch (error) {
    for (const started of startedServers.reverse()) {
      await started.server.stop();
    }
    for (const teardown of teardownCommands.reverse()) {
      await runMutationLifecycleCommand(teardown.command, teardown.cwd, true);
    }
    throw error;
  }
}

function runMutationLifecycleCommand(command: string, cwd: string, allowFailure = false): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let stderr = "";
    const timeout = setTimeout(() => {
      if (child.pid) {
        killProcessTree(child.pid);
      }
      reject(new Error(`Mutation target lifecycle command timed out after ${MUTATION_LIFECYCLE_COMMAND_TIMEOUT_MS}ms: ${sanitizeText(command)}`));
    }, MUTATION_LIFECYCLE_COMMAND_TIMEOUT_MS);
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 4000) {
        stderr = stderr.slice(-4000);
      }
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      const exitCode = code ?? 1;
      if (exitCode !== 0 && !allowFailure) {
        reject(new Error(sanitizeText(stderr || `Mutation target lifecycle command exited with code ${exitCode}: ${command}`)));
        return;
      }
      resolve();
    });
  });
}

function killProcessTree(pid: number): void {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Process already exited.
    }
  }
}

async function readOptionalReport(reportPath: string): Promise<Report | undefined> {
  try {
    return await readJson<Report>(reportPath);
  } catch {
    return undefined;
  }
}

async function runDefaultMutationBatch(input: {
  config: VisualHiveConfig;
  plan: Plan;
  rootDir: string;
  operators: Plan["mutation"]["operators"];
  enforceMinScore?: boolean;
  skipInstall?: boolean;
  skipBuild?: boolean;
}): Promise<{ exitCode: number; reportPath: string; report: MutationReport }> {
  const selectedContracts = input.config.contracts.filter((contract) => input.plan.items.some((item) => item.contractId === contract.id));
  const results: MutationResult[] = [];
  const applicableMappings: ApplicableMutationMapping[] = [];

  for (const operator of input.operators) {
    const mapping = selectContractsForMutation(operator, selectedContracts);
    const selectedItems = input.plan.items.filter((item) => mapping.contractIds.includes(item.contractId));
    const metadata = MUTATION_OPERATOR_METADATA[mapping.operatorId];
    if (!mapping.applicable || selectedItems.length === 0) {
      results.push({
        operator: mapping.operatorId,
        status: "not_applicable",
        killed: false,
        applicable: false,
        contractIds: [],
        affected: [],
        expectedFailureKinds: metadata.expectedFailureKinds,
        durationMs: 0,
        artifacts: [],
        validationCommand: "visual-hive mutate --config visual-hive.config.yaml --enforce-min-score",
        suggestedMissingTest: `Map mutation ${mapping.operatorId} to a relevant contract or document why it is not applicable.`,
        mutationMode: "runtime",
        sourceMutation: false,
        errors: [`Mutation ${mapping.operatorId} was not applicable: ${mapping.reason}`]
      });
      continue;
    }
    applicableMappings.push({
      operatorId: mapping.operatorId,
      selectedItems,
      expectedFailureKinds: metadata.expectedFailureKinds
    });
  }

  let targetSession: MutationTargetSession | undefined;
  try {
    if (applicableMappings.length > 0) {
      targetSession = await startMutationTargetSession({
        config: input.config,
        plan: input.plan,
        rootDir: input.rootDir,
        skipInstall: input.skipInstall,
        skipBuild: input.skipBuild
      });
      const uniqueContractIds = new Set(applicableMappings.flatMap((mapping) => mapping.selectedItems.map((item) => item.contractId)));
      const batchItems = input.plan.items.filter((item) => uniqueContractIds.has(item.contractId));
      const selectedTargetIds = new Set(batchItems.map((item) => item.targetId));
      const startedAt = Date.now();
      const { report } = await runPlaywrightContracts({
        config: input.config,
        plan: {
          ...input.plan,
          items: batchItems,
          targets: input.plan.targets.filter((target) => selectedTargetIds.has(target.id))
        },
        rootDir: input.rootDir,
        ci: true,
        mutationOperators: applicableMappings.map((mapping) => mapping.operatorId),
        mutationMatrix: Object.fromEntries(
          applicableMappings.map((mapping) => [mapping.operatorId, mapping.selectedItems.map((item) => item.contractId)])
        ),
        runTargetCommands: false,
        skipInstall: input.skipInstall,
        skipBuild: input.skipBuild
      });
      const batchDurationMs = Date.now() - startedAt;
      for (const mapping of applicableMappings) {
        const contractIds = new Set(mapping.selectedItems.map((item) => item.contractId));
        const operatorResults = report.results.filter(
          (result) => result.mutationOperator === mapping.operatorId && contractIds.has(result.contractId)
        );
        const errors = operatorResults.flatMap((result) => result.errors);
        const killed = operatorResults.some((result) => result.status === "failed");
        const missingStructuredResult = operatorResults.length === 0;
        results.push({
          operator: mapping.operatorId,
          status: missingStructuredResult ? "error" : killed ? "killed" : "survived",
          killed,
          applicable: true,
          contractIds: mapping.selectedItems.map((item) => item.contractId),
          ...mutationResultContext(input.config, mapping.selectedItems, mapping.operatorId, killed),
          expectedFailureKinds: mapping.expectedFailureKinds,
          failureKind: killed ? inferFailureKind(errors) : undefined,
          failedAssertion: killed ? errors[0] : undefined,
          durationMs:
            operatorResults.reduce((sum, result) => sum + result.durationMs, 0) ||
            Math.round(batchDurationMs / Math.max(applicableMappings.length, 1)),
          errors: missingStructuredResult ? [`No structured Playwright result was produced for mutation ${mapping.operatorId}.`] : errors,
          artifacts: [...new Set(operatorResults.flatMap((result) => result.artifacts))]
        });
      }
    }

    const report = buildMutationReport({
      project: input.config.project.name,
      minScore: input.config.mutation.minScore,
      results
    });
    const reportPath = path.join(input.rootDir, ".visual-hive", "mutation-report.json");
    await writeJson(reportPath, report);
    const exitCode = input.enforceMinScore && report.score < report.minScore ? 1 : 0;
    return { exitCode, reportPath, report };
  } finally {
    await targetSession?.stop();
  }
}

async function restoreDeterministicReport(reportPath: string, report: Report | undefined): Promise<void> {
  if (report) {
    await writeJson(reportPath, report);
    return;
  }
  await rm(reportPath, { force: true });
}

function inferFailureKind(errors: string[]): string | undefined {
  const joined = errors.join("\n").toLowerCase();
  if (joined.includes("baseline")) return "missing_baseline";
  if (joined.includes("screenshot") || joined.includes("diff")) return "visual_diff";
  if (joined.includes("login")) return "login_regression";
  if (joined.includes("absent") || joined.includes("mustnotexist")) return "unexpected_element";
  if (joined.includes("visible") || joined.includes("exist") || joined.includes("locator")) return "missing_element";
  if (joined.includes("console")) return "console_error";
  if (/\bapi\b/.test(joined) || /\bhttp\s*500\b/.test(joined) || /\bstatus\s*500\b/.test(joined)) return "api_contract_regression";
  return undefined;
}

function mutationResultContext(config: VisualHiveConfig, items: Plan["items"], operatorId: string, killed: boolean): Pick<
  MutationResult,
  "affected" | "validationCommand" | "suggestedMissingTest" | "mutationMode" | "sourceMutation"
> {
  return {
    affected: items.map((item) => {
      const contract = config.contracts.find((candidate) => candidate.id === item.contractId);
      const route = contract?.screenshots[0]?.route ?? contract?.steps.find((step) => step.action === "goto")?.route;
      const viewport = contract?.screenshots[0]?.viewport;
      return {
        contractId: item.contractId,
        targetId: item.targetId,
        route,
        viewport,
        component: inferAffectedComponent(operatorId, contract?.id, contract?.description)
      };
    }),
    validationCommand: "visual-hive mutate --config visual-hive.config.yaml --enforce-min-score",
    suggestedMissingTest: killed
      ? `Keep mutation ${operatorId} mapped to contracts that protect this user-visible surface.`
      : `Add or strengthen deterministic assertions so mutation ${operatorId} fails at least one mapped contract.`,
    mutationMode: "runtime",
    sourceMutation: false
  };
}

function inferAffectedComponent(operatorId: string, contractId = "", description = ""): string {
  const text = `${operatorId} ${contractId} ${description}`.toLowerCase();
  if (text.includes("login") || text.includes("oauth") || text.includes("auth") || text.includes("route-guard")) return "auth-boundary";
  if (text.includes("api") || text.includes("data") || text.includes("empty")) return "api-backed-data-area";
  if (text.includes("mobile") || text.includes("overflow")) return "responsive-layout";
  if (text.includes("badge") || text.includes("card")) return "dashboard-card";
  if (text.includes("image") || text.includes("theme") || text.includes("visual")) return "visual-layout";
  if (text.includes("critical") || text.includes("button")) return "critical-action";
  return "contract-surface";
}

export function formatMutationSummary(report: MutationReport, reportPath: string): string {
  return [
    `Wrote ${reportPath}`,
    `Mutation score: ${Math.round(report.score * 100)}% (${report.killed}/${report.total})`,
    `Minimum score: ${Math.round(report.minScore * 100)}%`,
    ...report.results.map((result) => {
      const selected = result.contractIds.length ? ` (${result.contractIds.join(", ")})` : "";
      const affected = result.affected?.length ? ` affected=${result.affected.map((surface) => `${surface.contractId}${surface.route ? `@${surface.route}` : ""}`).join(",")}` : "";
      const action = result.suggestedMissingTest ? ` next="${result.suggestedMissingTest}"` : "";
      return `- ${result.operator}: ${result.status}${selected}${affected}${action}`;
    })
  ].join("\n");
}

export function formatMutationOperatorList(operators: Plan["mutation"]["operators"]): string {
  return operators.map((operator) => mutationOperatorId(operator)).join(", ");
}
