import { copyFile, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ProviderId, VisualHiveConfig } from "../config/schema.js";
import type { Report, ScreenshotAssertionResult } from "../reports/types.js";
import { ensureDir, writeJson } from "../utils/files.js";
import { sanitizeText } from "../utils/sanitize.js";
import { buildProviderHandoffManifest, type ProviderHandoffManifest } from "./handoff.js";
import { getProviderAdapter, runProviderAdapterOperations, type ProviderAdapterOperationResult } from "./adapter.js";
import { inspectProviders, type ProviderInspection } from "./inspect.js";
import { runMockProviderAdapters, type MockProviderRun, type MockProviderRunReport } from "./mock.js";

export type ProviderUploadStatus = "uploaded" | "skipped" | "blocked" | "missing_credentials" | "failed" | "dry_run";

export interface ProviderUploadCommandInput {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export interface ProviderUploadCommandOutput {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type ProviderUploadCommandRunner = (input: ProviderUploadCommandInput) => Promise<ProviderUploadCommandOutput>;

export interface ProviderUploadOptions {
  providerId: ProviderId;
  rootDir: string;
  report: Report;
  reportPath?: string;
  env?: NodeJS.ProcessEnv;
  dryRun?: boolean;
  failOnProviderFailure?: boolean;
  generatedAt?: string;
  commandRunner?: ProviderUploadCommandRunner;
}

export interface ProviderUploadStagedArtifact {
  sourcePath: string;
  stagedPath: string;
  kind: "actual_screenshot" | "diff_screenshot" | "text_artifact";
  contractId?: string;
  screenshotName?: string;
  viewport?: string;
  route?: string;
}

export interface ProviderUploadManifest {
  schemaVersion: 1;
  project: string;
  generatedAt: string;
  providerId: ProviderId;
  label: string;
  status: ProviderUploadStatus;
  dryRun: boolean;
  deterministicStatus: Report["status"];
  mode: Report["mode"];
  externalCallsMade: number;
  readiness: ProviderHandoffManifest["readiness"];
  summary: {
    stagedArtifacts: number;
    uploadedArtifacts: number;
    actualScreenshots: number;
    diffScreenshots: number;
    textArtifacts: number;
  };
  stagedArtifacts: ProviderUploadStagedArtifact[];
  command?: string;
  stdout?: string;
  stderr?: string;
  providerUrl?: string;
  blockedReasons: string[];
  warnings: string[];
}

export interface ProviderUploadResult {
  manifest: ProviderUploadManifest;
  providerResults: MockProviderRunReport;
  manifestPath: string;
  providerResultsPath: string;
  exitCode: number;
}

const ARGOS_CLI_PACKAGE = "@argos-ci/cli@^5";
const ARGOS_UPLOAD_DIR = path.join(".visual-hive", "provider-upload", "argos");
const STDIO_EXCERPT_CHARS = 4000;

export async function uploadProviderArtifacts(config: VisualHiveConfig, options: ProviderUploadOptions): Promise<ProviderUploadResult> {
  if (options.providerId !== "argos") {
    throw new Error(`Provider upload is currently implemented for Argos only. Received "${options.providerId}".`);
  }

  const env = options.env ?? process.env;
  const rootDir = options.rootDir;
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const uploadRoot = path.join(rootDir, ARGOS_UPLOAD_DIR);
  const screenshotsDir = path.join(uploadRoot, "screenshots");
  const manifestPath = path.join(uploadRoot, "manifest.json");
  const providerResultsPath = path.join(rootDir, ".visual-hive", "provider-results.json");
  const handoff = buildProviderHandoffManifest(config, options.report, {
    providerId: options.providerId,
    env,
    generatedAt
  });
  const provider = inspectProviders(config, env, {
    mode: options.report.mode,
    deterministicStatus: options.report.status,
    artifactCount: collectUploadCandidates(config, options.report).filter((artifact) => artifact.kind !== "text_artifact").length,
    selectedContractSeverities: options.report.selectedContracts
      .map((contractId) => config.contracts.find((contract) => contract.id === contractId)?.severity)
      .filter((severity): severity is VisualHiveConfig["contracts"][number]["severity"] => Boolean(severity))
  }).find((candidate) => candidate.id === options.providerId);

  if (!provider) {
    throw new Error(`Unknown provider "${options.providerId}".`);
  }

  const preflight = preflightStatus(provider, options.dryRun ?? false);
  const blockedReasons = [...preflight.blockedReasons, ...handoff.readiness.externalUploadBlockedReasons];
  const shouldStage = preflight.status === "dry_run" || preflight.status === "uploaded";
  const stagedArtifacts = shouldStage ? await stageArgosArtifacts(config, options.report, rootDir, screenshotsDir) : [];
  const command = argosCommand(config, screenshotsDir, rootDir);
  let stdout: string | undefined;
  let stderr: string | undefined;
  let providerUrl: string | undefined;
  let externalCallsMade = 0;
  let status = preflight.status;
  let uploadedArtifacts = 0;

  if (status === "uploaded") {
    if (!options.commandRunner) {
      throw new Error("Argos upload requires a command runner. CLI users should invoke visual-hive providers upload.");
    }
    externalCallsMade = 1;
    const output = await options.commandRunner({
      command: command.command,
      args: command.args,
      cwd: rootDir,
      env: {
        ...env,
        ARGOS_TOKEN: env.ARGOS_TOKEN
      }
    });
    stdout = excerpt(output.stdout);
    stderr = excerpt(output.stderr);
    providerUrl = extractProviderUrl(`${output.stdout}\n${output.stderr}`);
    if (output.exitCode === 0) {
      uploadedArtifacts = stagedArtifacts.length;
    } else {
      status = "failed";
    }
  }

  const warnings = uploadWarnings(provider, status, blockedReasons, stagedArtifacts.length);
  const manifest = sanitizeManifest({
    schemaVersion: 1,
    project: config.project.name,
    generatedAt,
    providerId: provider.id,
    label: provider.label,
    status,
    dryRun: Boolean(options.dryRun),
    deterministicStatus: options.report.status,
    mode: options.report.mode,
    externalCallsMade,
    readiness: handoff.readiness,
    summary: {
      stagedArtifacts: stagedArtifacts.length,
      uploadedArtifacts,
      actualScreenshots: stagedArtifacts.filter((artifact) => artifact.kind === "actual_screenshot").length,
      diffScreenshots: stagedArtifacts.filter((artifact) => artifact.kind === "diff_screenshot").length,
      textArtifacts: stagedArtifacts.filter((artifact) => artifact.kind === "text_artifact").length
    },
    stagedArtifacts,
    command: sanitizedCommand(command),
    stdout,
    stderr,
    providerUrl,
    blockedReasons,
    warnings
  });

  const providerResults = buildUploadProviderResults(config, options.report, provider, manifest, generatedAt, env);
  await ensureDir(uploadRoot);
  await writeJson(manifestPath, manifest);
  await writeJson(providerResultsPath, providerResults);

  const enforceFailure = options.failOnProviderFailure || config.providers.argos.failOnProviderFailure;
  const exitCode = enforceFailure && status !== "uploaded" && status !== "dry_run" ? 1 : 0;
  return { manifest, providerResults, manifestPath, providerResultsPath, exitCode };
}

function preflightStatus(provider: ProviderInspection, dryRun: boolean): { status: ProviderUploadStatus; blockedReasons: string[] } {
  if (!provider.enabled) {
    return { status: "skipped", blockedReasons: ["Provider is disabled in config."] };
  }
  if (dryRun) {
    const blockedReasons: string[] = [];
    if (provider.mode === "mock") blockedReasons.push("Provider is in mock mode; a real upload would not run.");
    if (provider.availability === "missing_credentials") blockedReasons.push(`Missing credential names: ${provider.missingEnv.join(", ")}`);
    if (provider.availability === "policy_blocked") blockedReasons.push(...provider.costPolicy.blockedReasons);
    return { status: "dry_run", blockedReasons };
  }
  if (provider.mode === "mock") {
    return { status: "skipped", blockedReasons: ["Provider is in mock mode; external upload is disabled."] };
  }
  if (provider.availability === "missing_credentials") {
    return { status: "missing_credentials", blockedReasons: [`Missing credential names: ${provider.missingEnv.join(", ")}`] };
  }
  if (provider.availability === "policy_blocked") {
    return { status: "blocked", blockedReasons: provider.costPolicy.blockedReasons };
  }
  return { status: "uploaded", blockedReasons: [] };
}

function collectUploadCandidates(config: VisualHiveConfig, report: Report): ProviderUploadStagedArtifact[] {
  const uploadConfig = config.providers.argos.upload;
  const artifacts: ProviderUploadStagedArtifact[] = [];
  for (const result of report.results) {
    for (const shot of result.screenshotAssertions ?? []) {
      if (uploadConfig.includeActualScreenshots) {
        artifacts.push(screenshotCandidate(shot, shot.actualPath, "actual_screenshot"));
      }
      if (uploadConfig.includeDiffScreenshots && shot.diffPath) {
        artifacts.push(screenshotCandidate(shot, shot.diffPath, "diff_screenshot"));
      }
    }
  }
  if (uploadConfig.includeTextArtifacts) {
    artifacts.push({ sourcePath: ".visual-hive/report.json", stagedPath: "", kind: "text_artifact" });
    for (const filePath of uploadConfig.extraFiles) {
      artifacts.push({ sourcePath: filePath, stagedPath: "", kind: "text_artifact" });
    }
  }
  return artifacts;
}

async function stageArgosArtifacts(
  config: VisualHiveConfig,
  report: Report,
  rootDir: string,
  screenshotsDir: string
): Promise<ProviderUploadStagedArtifact[]> {
  await ensureDir(screenshotsDir);
  const staged: ProviderUploadStagedArtifact[] = [];
  const seen = new Set<string>();
  const textDir = path.join(path.dirname(screenshotsDir), "text");

  for (const candidate of collectUploadCandidates(config, report)) {
    const absoluteSource = resolveArtifactPath(rootDir, candidate.sourcePath);
    if (!(await fileExists(absoluteSource))) {
      continue;
    }
    const targetDir = candidate.kind === "text_artifact" ? textDir : screenshotsDir;
    await ensureDir(targetDir);
    const stagedName =
      candidate.kind === "text_artifact"
        ? sanitizeFileName(path.basename(candidate.sourcePath))
        : screenshotFileName(candidate);
    const stagedPath = path.join(targetDir, stagedName);
    const relativeStagedPath = toRepoRelative(rootDir, stagedPath);
    const key = `${candidate.kind}:${absoluteSource}:${relativeStagedPath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (candidate.kind === "text_artifact") {
      const raw = await readFile(absoluteSource, "utf8");
      await writeFile(stagedPath, sanitizeText(raw), "utf8");
    } else {
      await copyFile(absoluteSource, stagedPath);
    }
    staged.push({
      ...candidate,
      sourcePath: toRepoRelative(rootDir, absoluteSource),
      stagedPath: relativeStagedPath
    });
  }
  return staged;
}

function screenshotCandidate(
  shot: ScreenshotAssertionResult,
  sourcePath: string,
  kind: "actual_screenshot" | "diff_screenshot"
): ProviderUploadStagedArtifact {
  return {
    sourcePath,
    stagedPath: "",
    kind,
    contractId: shot.contractId,
    screenshotName: shot.screenshotName,
    route: shot.route,
    viewport: shot.viewport
  };
}

function screenshotFileName(candidate: ProviderUploadStagedArtifact): string {
  const parts = [
    candidate.contractId ?? "contract",
    candidate.screenshotName ?? "screenshot",
    candidate.viewport ?? "viewport",
    candidate.kind === "diff_screenshot" ? "diff" : "actual"
  ];
  return `${parts.map(sanitizeFileName).join("__")}.png`;
}

function argosCommand(config: VisualHiveConfig, screenshotsDir: string, rootDir: string): { command: string; args: string[] } {
  const args = ["exec", "--yes", "--package", ARGOS_CLI_PACKAGE, "--", "argos", "upload", toRepoRelative(rootDir, screenshotsDir)];
  const uploadConfig = config.providers.argos.upload;
  if (uploadConfig.buildName) {
    args.push("--build-name", uploadConfig.buildName);
  }
  if (uploadConfig.includeTextArtifacts) {
    args.push("--files", path.join(ARGOS_UPLOAD_DIR, "text", "*").replaceAll("\\", "/"));
  }
  return { command: "npm", args };
}

function sanitizedCommand(command: { command: string; args: string[] }): string {
  return sanitizeText([command.command, ...command.args].join(" "));
}

function buildUploadProviderResults(
  config: VisualHiveConfig,
  report: Report,
  provider: ProviderInspection,
  manifest: ProviderUploadManifest,
  generatedAt: string,
  env: NodeJS.ProcessEnv
): MockProviderRunReport {
  const artifactPaths = manifest.stagedArtifacts.map((artifact) => artifact.stagedPath);
  const providerResults = runMockProviderAdapters(
    config,
    {
      deterministicStatus: report.status,
      artifactCount: artifactPaths.length,
      artifactPaths,
      mode: report.mode,
      generatedAt
    },
    env
  );
  const providerIndex = providerResults.providers.findIndex((entry) => entry.providerId === provider.id);
  if (providerIndex >= 0) {
    providerResults.providers[providerIndex] = mergeUploadProviderRun(providerResults.providers[providerIndex], provider, manifest);
  }
  providerResults.summary.failedProviders = providerResults.providers.filter((entry) => entry.result.status === "failed").length;
  providerResults.summary.externalDeferredProviders = providerResults.providers.filter(
    (entry) => entry.enabled && entry.mode === "external" && entry.availability === "available" && entry.normalized.networkMode === "deferred"
  ).length;
  providerResults.summary.skippedProviders = providerResults.providers.filter((entry) => entry.result.status === "skipped").length;
  providerResults.warnings = [...new Set([...providerResults.warnings, ...manifest.warnings])];
  return providerResults;
}

function mergeUploadProviderRun(
  run: MockProviderRun,
  provider: ProviderInspection,
  manifest: ProviderUploadManifest
): MockProviderRun {
  const status = providerResultStatus(manifest.status);
  const operations = providerOperationsForUpload(run.operations, manifest);
  return {
    ...run,
    availability: provider.availability,
    operations,
    result: {
      ...run.result,
      status,
      message: providerResultMessage(manifest),
      artifactCount: manifest.summary.stagedArtifacts,
      externalUrl: manifest.providerUrl,
      upload: {
        status: manifest.status,
        externalCallsMade: manifest.externalCallsMade,
        uploadedArtifacts: manifest.summary.uploadedArtifacts,
        stagedArtifacts: manifest.summary.stagedArtifacts,
        manifestPath: path.join(ARGOS_UPLOAD_DIR, "manifest.json").replaceAll("\\", "/"),
        uploadDirectory: ARGOS_UPLOAD_DIR.replaceAll("\\", "/"),
        command: manifest.command,
        stdout: manifest.stdout,
        stderr: manifest.stderr,
        providerUrl: manifest.providerUrl,
        blockedReasons: manifest.blockedReasons
      }
    },
    normalized: {
      ...run.normalized,
      status,
      networkMode: manifest.status === "uploaded" || manifest.status === "failed" ? "external" : run.normalized.networkMode,
      externalCallsMade: manifest.externalCallsMade,
      artifactSummary: {
        ...run.normalized.artifactSummary,
        localArtifacts: manifest.summary.stagedArtifacts,
        uploadedArtifacts: manifest.summary.uploadedArtifacts,
        uploadMode: uploadModeForStatus(manifest.status)
      },
      hostedVisual: run.normalized.hostedVisual
        ? {
            ...run.normalized.hostedVisual,
            reviewUrl: manifest.providerUrl ?? run.normalized.hostedVisual.reviewUrl,
            baselinePolicy: "provider-owned-future"
          }
        : undefined,
      notes: [...run.normalized.notes, ...manifest.warnings]
    },
    artifacts: manifest.stagedArtifacts.map((artifact) => artifact.stagedPath),
    warnings: manifest.warnings
  };
}

function providerOperationsForUpload(
  operations: ProviderAdapterOperationResult[],
  manifest: ProviderUploadManifest
): ProviderAdapterOperationResult[] {
  const status = operationStatusForUpload(manifest.status);
  const message = providerResultMessage(manifest);
  const adapter = getProviderAdapter("argos");
  const seeded =
    operations.length > 0
      ? operations
      : runProviderAdapterOperations(adapter, {
          provider: {
            id: "argos",
            label: "Argos",
            enabled: true,
            mode: "external",
            availability: "available",
            deterministicRole: "supplemental",
            requiredEnv: ["ARGOS_TOKEN"],
            missingEnv: [],
            supports: ["availability", "artifact_upload", "result_normalization"],
            docs: "",
            message: "",
            costPolicy: {
              externalUploadAllowed: true,
              blockedReasons: [],
              estimatedExternalScreenshots: manifest.summary.stagedArtifacts,
              maxExternalScreenshotsPerRun: manifest.summary.stagedArtifacts,
              maxMonthlyExternalScreenshots: manifest.summary.stagedArtifacts,
              externalUploadPolicy: {
                pullRequest: false,
                schedule: true,
                manual: true,
                canary: false,
                mutation: false,
                full: true,
                onFailureOnly: false,
                criticalContractsOnly: false
              }
            }
          },
          deterministicStatus: manifest.deterministicStatus,
          artifactCount: manifest.summary.stagedArtifacts,
          artifacts: manifest.stagedArtifacts.map((artifact) => artifact.stagedPath),
          generatedAt: manifest.generatedAt
        });
  return seeded.map((operation) =>
    operation.operation === "upload_artifact"
      ? { ...operation, status, message, artifactCount: manifest.summary.stagedArtifacts }
      : operation
  );
}

function providerResultStatus(status: ProviderUploadStatus): MockProviderRun["result"]["status"] {
  if (status === "uploaded" || status === "dry_run") return "passed";
  if (status === "failed") return "failed";
  if (status === "missing_credentials") return "missing_credentials";
  return "skipped";
}

function operationStatusForUpload(status: ProviderUploadStatus): ProviderAdapterOperationResult["status"] {
  if (status === "uploaded" || status === "dry_run") return "passed";
  if (status === "failed") return "failed";
  return "skipped";
}

function uploadModeForStatus(status: ProviderUploadStatus): MockProviderRun["normalized"]["artifactSummary"]["uploadMode"] {
  if (status === "uploaded") return "uploaded";
  if (status === "dry_run") return "dry-run";
  if (status === "skipped") return "disabled";
  return "blocked";
}

function providerResultMessage(manifest: ProviderUploadManifest): string {
  if (manifest.status === "uploaded") return `Argos upload completed with ${manifest.summary.uploadedArtifacts} artifact(s).`;
  if (manifest.status === "dry_run") return `Argos dry run staged ${manifest.summary.stagedArtifacts} artifact(s); no external call was made.`;
  if (manifest.status === "missing_credentials") return `Argos upload skipped because required credential names are missing: ${manifest.readiness.missingEnv.join(", ")}`;
  if (manifest.status === "blocked") return `Argos upload blocked by policy: ${manifest.blockedReasons.join(" ")}`;
  if (manifest.status === "failed") return "Argos upload command failed; deterministic Playwright status is unchanged.";
  return "Argos provider disabled or skipped; no external call was made.";
}

function uploadWarnings(
  provider: ProviderInspection,
  status: ProviderUploadStatus,
  blockedReasons: string[],
  stagedArtifactCount: number
): string[] {
  const warnings = new Set<string>();
  if (provider.id !== "playwright") warnings.add("Playwright remains the deterministic pass/fail oracle; provider output is supplemental.");
  if (status === "skipped") warnings.add("Argos upload skipped because the provider is disabled or in non-external mode.");
  if (status === "missing_credentials") warnings.add(`Missing credential names: ${provider.missingEnv.join(", ")}`);
  if (status === "blocked") warnings.add(`External upload blocked: ${blockedReasons.join(" ")}`);
  if (status === "dry_run") warnings.add("Dry run staged artifacts but made zero external calls.");
  if (stagedArtifactCount === 0 && (status === "dry_run" || status === "uploaded")) warnings.add("No eligible screenshot artifacts were found to upload.");
  return [...warnings].map((warning) => sanitizeText(warning));
}

function resolveArtifactPath(rootDir: string, artifactPath: string): string {
  return path.isAbsolute(artifactPath) ? artifactPath : path.resolve(rootDir, artifactPath);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stats = await stat(filePath);
    return stats.isFile();
  } catch {
    return false;
  }
}

function toRepoRelative(rootDir: string, filePath: string): string {
  const relative = path.relative(rootDir, filePath);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative.replaceAll("\\", "/") : filePath.replaceAll("\\", "/");
}

function sanitizeFileName(value: string): string {
  return sanitizeText(value)
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "artifact";
}

function excerpt(value: string): string {
  return sanitizeText(value).slice(0, STDIO_EXCERPT_CHARS);
}

function extractProviderUrl(value: string): string | undefined {
  const match = /https?:\/\/[^\s"')]+argos[^\s"')]+/i.exec(value);
  return match ? sanitizeText(match[0]) : undefined;
}

function sanitizeManifest(manifest: ProviderUploadManifest): ProviderUploadManifest {
  return JSON.parse(JSON.stringify(manifest), (_key, value: unknown) => (typeof value === "string" ? sanitizeText(value) : value)) as ProviderUploadManifest;
}
