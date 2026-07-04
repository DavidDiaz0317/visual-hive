import { spawn } from "node:child_process";
import path from "node:path";
import {
  buildProviderHandoffManifest,
  inspectProviders,
  loadConfig,
  buildProviderSetupPlan,
  recordProviderDecision,
  readJson,
  runMockProviderAdapters,
  uploadProviderArtifacts,
  writeJson,
  type MockProviderRunReport,
  type ProviderHandoffManifest,
  type ProviderDecision,
  type ProviderDecisionEntry,
  type ProviderInspection,
  type ProviderUploadCommandInput,
  type ProviderUploadCommandOutput,
  type ProviderUploadCommandRunner,
  type ProviderUploadResult,
  type ProviderSetupPlan,
  type Report
} from "@visual-hive/core";

export interface ProvidersCommandOptions {
  config?: string;
  cwd?: string;
  report?: string;
  format?: "markdown" | "json";
}

export interface ProviderDecisionCommandOptions {
  config?: string;
  cwd?: string;
  providerId: string;
  decision: ProviderDecision;
  reason?: string;
  format?: "markdown" | "json";
}

export interface ProviderSetupPlanCommandOptions {
  config?: string;
  cwd?: string;
  providerId: string;
  format?: "markdown" | "json";
}

export interface ProviderHandoffCommandOptions {
  config?: string;
  cwd?: string;
  providerId: string;
  report?: string;
  format?: "markdown" | "json";
}

export interface ProviderUploadCommandOptions {
  config?: string;
  cwd?: string;
  providerId: string;
  report?: string;
  dryRun?: boolean;
  format?: "markdown" | "json";
  failOnProviderFailure?: boolean;
}

export interface ProvidersMockCommandResult {
  report: MockProviderRunReport;
  reportPath: string;
}

export interface ProviderDecisionCommandResult {
  decision: ProviderDecisionEntry;
  decisionPath: string;
  summary: ProviderDecisionEntry[];
}

export interface ProviderSetupPlanCommandResult {
  plan: ProviderSetupPlan;
  planPath: string;
}

export interface ProviderHandoffCommandResult {
  manifest: ProviderHandoffManifest;
  manifestPath: string;
}

export type ProviderUploadCommandResult = ProviderUploadResult;

const DEFAULT_PROVIDER_COMMAND_TIMEOUT_MS = 180_000;
const PROVIDER_COMMAND_TIMEOUT_ENV = "VISUAL_HIVE_PROVIDER_COMMAND_TIMEOUT_MS";

export async function runProvidersCommand(options: ProvidersCommandOptions = {}): Promise<ProviderInspection[]> {
  const cwd = options.cwd ?? process.cwd();
  const loaded = await loadConfig(options.config ?? "visual-hive.config.yaml", cwd);
  return inspectProviders(loaded.config);
}

export async function runProvidersMockCommand(options: ProvidersCommandOptions = {}): Promise<ProvidersMockCommandResult> {
  const cwd = options.cwd ?? process.cwd();
  const loaded = await loadConfig(options.config ?? "visual-hive.config.yaml", cwd);
  const hiveRoot = path.join(loaded.rootDir, ".visual-hive");
  const deterministicReportPath = path.resolve(loaded.rootDir, options.report ?? path.join(".visual-hive", "report.json"));
  let deterministicReport: Report;
  try {
    deterministicReport = await readJson<Report>(deterministicReportPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Missing deterministic report for provider adapter mock run at ${deterministicReportPath}. Run "visual-hive run" first. Details: ${message}`
    );
  }

  const artifactPaths = Array.from(
    new Set(
      [
        deterministicReport.generatedSpecPath,
        ...deterministicReport.artifacts,
        ...deterministicReport.results.flatMap((result) => result.artifacts ?? [])
      ].filter(Boolean)
    )
  );
  const report = runMockProviderAdapters(loaded.config, {
    deterministicStatus: deterministicReport.status,
    artifactCount: artifactPaths.length,
    artifactPaths,
    mode: deterministicReport.mode
  });
  const reportPath = path.join(hiveRoot, "provider-results.json");
  await writeJson(reportPath, report);
  return { report, reportPath };
}

export async function runProviderDecisionCommand(options: ProviderDecisionCommandOptions): Promise<ProviderDecisionCommandResult> {
  const cwd = options.cwd ?? process.cwd();
  const loaded = await loadConfig(options.config ?? "visual-hive.config.yaml", cwd);
  const provider = inspectProviders(loaded.config).find((candidate) => candidate.id === options.providerId);
  if (!provider) {
    throw new Error(`Unknown provider "${options.providerId}". Run "visual-hive providers list" to list configured providers.`);
  }
  return recordProviderDecision(path.join(loaded.rootDir, ".visual-hive", "provider-decisions.json"), {
    providerId: provider.id,
    label: provider.label,
    decision: options.decision,
    reason: options.reason
  });
}

export async function runProviderSetupPlanCommand(options: ProviderSetupPlanCommandOptions): Promise<ProviderSetupPlanCommandResult> {
  const cwd = options.cwd ?? process.cwd();
  const loaded = await loadConfig(options.config ?? "visual-hive.config.yaml", cwd);
  const provider = inspectProviders(loaded.config).find((candidate) => candidate.id === options.providerId);
  if (!provider) {
    throw new Error(`Unknown provider "${options.providerId}". Run "visual-hive providers list" to list configured providers.`);
  }
  const plan = buildProviderSetupPlan(loaded.config, { providerId: provider.id });
  const planPath = path.join(loaded.rootDir, ".visual-hive", "provider-setup-plan.json");
  await writeJson(planPath, plan);
  return { plan, planPath };
}

export async function runProviderHandoffCommand(options: ProviderHandoffCommandOptions): Promise<ProviderHandoffCommandResult> {
  const cwd = options.cwd ?? process.cwd();
  const loaded = await loadConfig(options.config ?? "visual-hive.config.yaml", cwd);
  const deterministicReportPath = path.resolve(loaded.rootDir, options.report ?? path.join(".visual-hive", "report.json"));
  let deterministicReport: Report;
  try {
    deterministicReport = await readJson<Report>(deterministicReportPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Missing deterministic report for provider handoff at ${deterministicReportPath}. Run "visual-hive run" first. Details: ${message}`
    );
  }
  const provider = inspectProviders(loaded.config).find((candidate) => candidate.id === options.providerId);
  if (!provider) {
    throw new Error(`Unknown provider "${options.providerId}". Run "visual-hive providers list" to list configured providers.`);
  }
  const manifest = buildProviderHandoffManifest(loaded.config, deterministicReport, { providerId: provider.id });
  const manifestPath = path.join(loaded.rootDir, ".visual-hive", "provider-handoff.json");
  await writeJson(manifestPath, manifest);
  return { manifest, manifestPath };
}

export async function runProviderUploadCommand(
  options: ProviderUploadCommandOptions,
  commandRunner: ProviderUploadCommandRunner = defaultProviderUploadCommandRunner
): Promise<ProviderUploadCommandResult> {
  const cwd = options.cwd ?? process.cwd();
  const loaded = await loadConfig(options.config ?? "visual-hive.config.yaml", cwd);
  const deterministicReportPath = path.resolve(loaded.rootDir, options.report ?? path.join(".visual-hive", "report.json"));
  let deterministicReport: Report;
  try {
    deterministicReport = await readJson<Report>(deterministicReportPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Missing deterministic report for provider upload at ${deterministicReportPath}. Run "visual-hive run" first. Details: ${message}`
    );
  }
  const provider = inspectProviders(loaded.config).find((candidate) => candidate.id === options.providerId);
  if (!provider) {
    throw new Error(`Unknown provider "${options.providerId}". Run "visual-hive providers list" to list configured providers.`);
  }
  return uploadProviderArtifacts(loaded.config, {
    providerId: provider.id,
    rootDir: loaded.rootDir,
    report: deterministicReport,
    reportPath: deterministicReportPath,
    dryRun: options.dryRun,
    failOnProviderFailure: options.failOnProviderFailure,
    commandRunner
  });
}

export function formatProvidersSummary(providers: ProviderInspection[]): string {
  const widths = {
    provider: Math.max("Provider".length, ...providers.map((provider) => provider.label.length)),
    status: Math.max("Status".length, ...providers.map((provider) => provider.availability.length)),
    mode: Math.max("Mode".length, ...providers.map((provider) => provider.mode.length)),
    role: Math.max("Role".length, ...providers.map((provider) => provider.deterministicRole.length)),
    external: Math.max("External".length, ...providers.map((provider) => externalUploadLabel(provider).length))
  };
  const header = [
    pad("Provider", widths.provider),
    pad("Status", widths.status),
    pad("Mode", widths.mode),
    pad("Role", widths.role),
    pad("External", widths.external),
    "Message"
  ].join("  ");
  const separator = [
    "-".repeat(widths.provider),
    "-".repeat(widths.status),
    "-".repeat(widths.mode),
    "-".repeat(widths.role),
    "-".repeat(widths.external),
    "-------"
  ].join("  ");
  const rows = providers.map((provider) =>
    [
      pad(provider.label, widths.provider),
      pad(provider.availability, widths.status),
      pad(provider.mode, widths.mode),
      pad(provider.deterministicRole, widths.role),
      pad(externalUploadLabel(provider), widths.external),
      provider.message
    ].join("  ")
  );
  return [header, separator, ...rows].join("\n");
}

export function formatProvidersMockSummary(report: MockProviderRunReport, reportPath: string, format: "markdown" | "json" = "markdown"): string {
  if (format === "json") {
    return JSON.stringify(report, null, 2);
  }
  const lines = [
    `# Provider Adapter Mock Results: ${report.project}`,
    "",
    `- Status source: deterministic run ${report.deterministicStatus}`,
    `- Providers: ${report.summary.providerCount}`,
    `- Mock providers: ${report.summary.mockProviders}`,
    `- Missing credential providers: ${report.summary.missingCredentialProviders}`,
    `- External deferred providers: ${report.summary.externalDeferredProviders}`,
    `- Artifact count: ${report.artifactCount}`,
    `- Wrote: ${reportPath}`,
    "",
    "| Provider | Availability | Result | Network | Upload | External policy | Operations | Message |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |"
  ];
  for (const provider of report.providers) {
    lines.push(
      `| ${provider.label} | ${provider.availability} | ${provider.result.status} | ${provider.normalized.networkMode} | ${provider.normalized.artifactSummary.uploadMode} | ${mockExternalPolicyLabel(provider)} | ${provider.operations
        .map((operation) => `${operation.operation}:${operation.status}`)
        .join(", ")} | ${provider.result.message} |`
    );
  }
  if (report.warnings.length) {
    lines.push("", "## Warnings", "", ...report.warnings.map((warning) => `- ${warning}`));
  }
  return lines.join("\n");
}

export function formatProviderDecision(result: ProviderDecisionCommandResult, format: "markdown" | "json" = "markdown"): string {
  if (format === "json") {
    return JSON.stringify(
      {
        decision: result.decision,
        decisionPath: result.decisionPath,
        summary: result.summary
      },
      null,
      2
    );
  }
  return [
    `Wrote ${result.decisionPath}`,
    "# Provider Decision",
    "",
    `- Provider: ${result.decision.label ?? result.decision.providerId} (${result.decision.providerId})`,
    `- Decision: ${result.decision.decision}`,
    `- External calls made: ${result.decision.externalCallsMade}`,
    `- Reason: ${result.decision.reason}`,
    "",
    "This records local governance only. It does not enable credentials, billing, uploads, or provider network calls."
  ].join("\n");
}

export function formatProviderSetupPlan(result: ProviderSetupPlanCommandResult, format: "markdown" | "json" = "markdown"): string {
  if (format === "json") {
    return JSON.stringify(
      {
        plan: result.plan,
        planPath: result.planPath
      },
      null,
      2
    );
  }
  const plan = result.plan;
  return [
    `Wrote ${result.planPath}`,
    `# Provider Setup Plan: ${plan.label}`,
    "",
    `- Recommendation: ${plan.recommendation}`,
    `- Availability: ${plan.readiness.availability}`,
    `- Mode: ${plan.readiness.mode}`,
    `- Authorization required: ${plan.authorizationRequired ? "yes" : "no"}`,
    `- External calls made: ${plan.externalCallsMade}`,
    `- Required env names: ${plan.readiness.requiredEnv.join(", ") || "none"}`,
    `- Missing env names: ${plan.readiness.missingEnv.join(", ") || "none"}`,
    `- External upload: ${plan.readiness.externalUploadAllowed ? "allowed" : "blocked"}`,
    "",
    "## Config Changes",
    ...plan.configChanges.map((item) => `- ${item}`),
    "",
    "## Workflow Steps",
    ...plan.workflowSteps.map((item) => `- ${item}`),
    "",
    "## Safety Checks",
    ...plan.safetyChecks.map((item) => `- ${item}`),
    "",
    "## Validation Commands",
    ...plan.validationCommands.map((command) => `- \`${command}\``),
    ...(plan.warnings.length ? ["", "## Warnings", ...plan.warnings.map((warning) => `- ${warning}`)] : [])
  ].join("\n");
}

export function formatProviderHandoff(result: ProviderHandoffCommandResult, format: "markdown" | "json" = "markdown"): string {
  if (format === "json") {
    return JSON.stringify(
      {
        manifest: result.manifest,
        manifestPath: result.manifestPath
      },
      null,
      2
    );
  }
  const manifest = result.manifest;
  return [
    `Wrote ${result.manifestPath}`,
    `# Provider Handoff: ${manifest.label}`,
    "",
    `- Status: ${manifest.status}`,
    `- Deterministic status: ${manifest.deterministicStatus}`,
    `- Mode: ${manifest.mode}`,
    `- External calls made: ${manifest.externalCallsMade}`,
    `- Required env names: ${manifest.readiness.requiredEnv.join(", ") || "none"}`,
    `- Missing env names: ${manifest.readiness.missingEnv.join(", ") || "none"}`,
    `- External upload: ${manifest.readiness.externalUploadAllowed ? "allowed" : "blocked"}`,
    `- Eligible artifacts: ${manifest.summary.eligibleArtifacts}/${manifest.summary.totalArtifacts}`,
    "",
    "| Artifact | Kind | Contract | Upload | Blocked reasons |",
    "| --- | --- | --- | --- | --- |",
    ...manifest.artifacts.map(
      (artifact) =>
        `| ${artifact.path} | ${artifact.kind} | ${artifact.contractId ?? "n/a"} | ${artifact.eligibleForUpload ? "yes" : "no"} | ${artifact.blockedReasons.join(" ") || "none"} |`
    ),
    "",
    "## Trusted Workflow Steps",
    ...manifest.trustedWorkflowSteps.map((step) => `- ${step}`),
    "",
    "## Validation Commands",
    ...manifest.validationCommands.map((command) => `- \`${command}\``),
    ...(manifest.warnings.length ? ["", "## Warnings", ...manifest.warnings.map((warning) => `- ${warning}`)] : [])
  ].join("\n");
}

export function formatProviderUpload(result: ProviderUploadCommandResult, format: "markdown" | "json" = "markdown"): string {
  if (format === "json") {
    return JSON.stringify(
      {
        manifest: result.manifest,
        manifestPath: result.manifestPath,
        providerResultsPath: result.providerResultsPath,
        exitCode: result.exitCode
      },
      null,
      2
    );
  }
  const manifest = result.manifest;
  return [
    `Wrote ${result.manifestPath}`,
    `Wrote ${result.providerResultsPath}`,
    `# Provider Upload: ${manifest.label}`,
    "",
    `- Status: ${manifest.status}`,
    `- Dry run: ${manifest.dryRun ? "yes" : "no"}`,
    `- Deterministic status: ${manifest.deterministicStatus}`,
    `- External calls made: ${manifest.externalCallsMade}`,
    `- Staged artifacts: ${manifest.summary.stagedArtifacts}`,
    `- Uploaded artifacts: ${manifest.summary.uploadedArtifacts}`,
    `- Required env names: ${manifest.readiness.requiredEnv.join(", ") || "none"}`,
    `- Missing env names: ${manifest.readiness.missingEnv.join(", ") || "none"}`,
    `- Provider URL: ${manifest.providerUrl ?? "none"}`,
    ...(manifest.blockedReasons.length ? ["", "## Blocked Reasons", ...manifest.blockedReasons.map((reason) => `- ${reason}`)] : []),
    ...(manifest.warnings.length ? ["", "## Warnings", ...manifest.warnings.map((warning) => `- ${warning}`)] : []),
    "",
    "Visual Hive remains the deterministic verdict authority; hosted provider evidence is supplemental unless explicitly configured as gating."
  ].join("\n");
}

function pad(value: string, width: number): string {
  return value.padEnd(width, " ");
}

function externalUploadLabel(provider: ProviderInspection): string {
  if (provider.id === "playwright") return "local";
  if (!provider.enabled) return "disabled";
  if (provider.mode === "mock") return "mock";
  return provider.costPolicy.externalUploadAllowed ? "allowed" : "blocked";
}

function mockExternalPolicyLabel(provider: MockProviderRunReport["providers"][number]): string {
  if (provider.providerId === "playwright") return "local";
  if (!provider.enabled) return "disabled";
  if (provider.mode === "mock") return "mock";
  return provider.normalized.costPolicy.externalUploadAllowed ? "allowed" : "blocked";
}

function defaultProviderUploadCommandRunner(input: ProviderUploadCommandInput): Promise<ProviderUploadCommandOutput> {
  return new Promise((resolve) => {
    const command = process.platform === "win32" && input.command === "npm" ? "npm.cmd" : input.command;
    const timeoutMs = providerCommandTimeoutMs(input.env);
    let stdout = "";
    let stderr = "";
    let settled = false;
    let killFallback: NodeJS.Timeout | undefined;
    let timeoutOutput: ProviderUploadCommandOutput | undefined;
    const finish = (output: ProviderUploadCommandOutput): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (killFallback) clearTimeout(killFallback);
      resolve(output);
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, input.args, {
        cwd: input.cwd,
        env: input.env,
        windowsHide: true,
        shell: process.platform === "win32",
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (error) {
      stderr += error instanceof Error ? error.message : String(error);
      settled = true;
      resolve({ exitCode: 1, stdout, stderr });
      return;
    }
    const timeout = setTimeout(() => {
      stderr += `${stderr ? "\n" : ""}Provider upload command timed out after ${timeoutMs}ms.`;
      timeoutOutput = { exitCode: 124, stdout, stderr };
      killProviderUploadProcess(child.pid);
      killFallback = setTimeout(() => {
        finish(timeoutOutput ?? { exitCode: 124, stdout, stderr });
      }, 2_000);
      killFallback.unref?.();
    }, timeoutMs);
    timeout.unref?.();
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      stderr += error.message;
      finish({ exitCode: 1, stdout, stderr });
    });
    child.on("close", (code) => {
      if (timeoutOutput) {
        finish(timeoutOutput);
        return;
      }
      finish({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}

function providerCommandTimeoutMs(env: NodeJS.ProcessEnv): number {
  const raw = env[PROVIDER_COMMAND_TIMEOUT_ENV];
  if (!raw) return DEFAULT_PROVIDER_COMMAND_TIMEOUT_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PROVIDER_COMMAND_TIMEOUT_MS;
}

function killProviderUploadProcess(pid: number | undefined): void {
  if (!pid) return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(pid), "/t", "/f"], {
      windowsHide: true,
      stdio: "ignore"
    });
    killer.on("error", () => {
      // Best effort cleanup; the timeout result is still recorded for the provider run.
    });
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return;
  }
  setTimeout(() => {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Process already exited.
    }
  }, 1_000).unref?.();
}
