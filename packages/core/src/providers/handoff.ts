import type { ProviderId, VisualHiveConfig } from "../config/schema.js";
import type { Report, ScreenshotAssertionResult } from "../reports/types.js";
import { sanitizeText } from "../utils/sanitize.js";
import { inspectProviders, type ProviderInspection } from "./inspect.js";

export type ProviderHandoffStatus = "ready" | "review" | "blocked";
export type ProviderHandoffArtifactKind = "actual_screenshot" | "diff_screenshot" | "baseline_screenshot" | "generated_spec" | "deterministic_report";

export interface ProviderHandoffArtifact {
  path: string;
  kind: ProviderHandoffArtifactKind;
  contractId?: string;
  screenshotName?: string;
  route?: string;
  viewport?: string;
  screenshotStatus?: ScreenshotAssertionResult["status"];
  eligibleForUpload: boolean;
  blockedReasons: string[];
}

export interface ProviderHandoffManifest {
  schemaVersion: 1;
  project: string;
  generatedAt: string;
  providerId: ProviderId;
  label: string;
  status: ProviderHandoffStatus;
  deterministicStatus: Report["status"];
  mode: Report["mode"];
  externalCallsMade: 0;
  readiness: {
    enabled: boolean;
    providerMode: "mock" | "external";
    availability: ProviderInspection["availability"];
    deterministicRole: ProviderInspection["deterministicRole"];
    requiredEnv: string[];
    missingEnv: string[];
    externalUploadAllowed: boolean;
    externalUploadBlockedReasons: string[];
    projectIdConfigured: boolean;
  };
  summary: {
    totalArtifacts: number;
    screenshotArtifacts: number;
    diffArtifacts: number;
    eligibleArtifacts: number;
    blockedArtifacts: number;
    estimatedExternalScreenshots: number;
    maxExternalScreenshotsPerRun: number;
  };
  artifacts: ProviderHandoffArtifact[];
  trustedWorkflowSteps: string[];
  validationCommands: string[];
  warnings: string[];
}

export interface BuildProviderHandoffManifestOptions {
  providerId: ProviderId;
  env?: NodeJS.ProcessEnv;
  generatedAt?: string;
}

export function buildProviderHandoffManifest(
  config: VisualHiveConfig,
  report: Report,
  options: BuildProviderHandoffManifestOptions
): ProviderHandoffManifest {
  const selectedContractSeverities = report.selectedContracts
    .map((contractId) => config.contracts.find((contract) => contract.id === contractId)?.severity)
    .filter((severity): severity is VisualHiveConfig["contracts"][number]["severity"] => Boolean(severity));
  const screenshotArtifacts = collectScreenshotArtifacts(report);
  const provider = inspectProviders(config, options.env ?? process.env, {
    mode: report.mode,
    deterministicStatus: report.status,
    artifactCount: screenshotArtifacts.filter((artifact) => artifact.kind === "actual_screenshot").length,
    selectedContractSeverities
  }).find((candidate) => candidate.id === options.providerId);
  if (!provider) {
    throw new Error(`Unknown provider "${options.providerId}".`);
  }

  const manifestArtifacts = [
    ...screenshotArtifacts,
    {
      path: report.generatedSpecPath,
      kind: "generated_spec" as const,
      eligibleForUpload: false,
      blockedReasons: ["Generated specs are included for review context only, not provider upload."]
    },
    {
      path: ".visual-hive/report.json",
      kind: "deterministic_report" as const,
      eligibleForUpload: false,
      blockedReasons: ["The deterministic report is provider handoff context, not a visual upload artifact."]
    }
  ].map((artifact) => applyProviderPolicy(provider, artifact));

  const status = handoffStatus(provider, manifestArtifacts);
  const warnings = handoffWarnings(provider, manifestArtifacts);
  return sanitizeManifest({
    schemaVersion: 1,
    project: config.project.name,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    providerId: provider.id,
    label: provider.label,
    status,
    deterministicStatus: report.status,
    mode: report.mode,
    externalCallsMade: 0,
    readiness: {
      enabled: provider.enabled,
      providerMode: provider.mode,
      availability: provider.availability,
      deterministicRole: provider.deterministicRole,
      requiredEnv: provider.requiredEnv,
      missingEnv: provider.missingEnv,
      externalUploadAllowed: provider.id === "playwright" || provider.mode === "mock" ? true : provider.costPolicy.externalUploadAllowed,
      externalUploadBlockedReasons: provider.id === "playwright" || provider.mode === "mock" ? [] : provider.costPolicy.blockedReasons,
      projectIdConfigured: Boolean(provider.projectId)
    },
    summary: {
      totalArtifacts: manifestArtifacts.length,
      screenshotArtifacts: manifestArtifacts.filter((artifact) => artifact.kind === "actual_screenshot").length,
      diffArtifacts: manifestArtifacts.filter((artifact) => artifact.kind === "diff_screenshot").length,
      eligibleArtifacts: manifestArtifacts.filter((artifact) => artifact.eligibleForUpload).length,
      blockedArtifacts: manifestArtifacts.filter((artifact) => !artifact.eligibleForUpload).length,
      estimatedExternalScreenshots: provider.costPolicy.estimatedExternalScreenshots,
      maxExternalScreenshotsPerRun: provider.costPolicy.maxExternalScreenshotsPerRun
    },
    artifacts: manifestArtifacts,
    trustedWorkflowSteps: trustedWorkflowSteps(provider),
    validationCommands: validationCommands(provider),
    warnings
  });
}

function collectScreenshotArtifacts(report: Report): ProviderHandoffArtifact[] {
  const artifacts: ProviderHandoffArtifact[] = [];
  for (const result of report.results) {
    for (const shot of result.screenshotAssertions ?? []) {
      artifacts.push(screenshotArtifact(shot, shot.actualPath, "actual_screenshot"));
      if (shot.diffPath) artifacts.push(screenshotArtifact(shot, shot.diffPath, "diff_screenshot"));
      artifacts.push(screenshotArtifact(shot, shot.baselinePath, "baseline_screenshot", false, ["Baselines remain Visual Hive-owned unless a trusted provider adapter explicitly supports baseline sync."]));
    }
  }
  return dedupeArtifacts(artifacts);
}

function screenshotArtifact(
  shot: ScreenshotAssertionResult,
  filePath: string,
  kind: ProviderHandoffArtifactKind,
  eligibleForUpload = kind === "actual_screenshot" || kind === "diff_screenshot",
  blockedReasons: string[] = []
): ProviderHandoffArtifact {
  return {
    path: filePath,
    kind,
    contractId: shot.contractId,
    screenshotName: shot.screenshotName,
    route: shot.route,
    viewport: shot.viewport,
    screenshotStatus: shot.status,
    eligibleForUpload,
    blockedReasons
  };
}

function applyProviderPolicy(provider: ProviderInspection, artifact: ProviderHandoffArtifact): ProviderHandoffArtifact {
  const blockedReasons = [...artifact.blockedReasons];
  if (provider.id === "playwright") blockedReasons.push("Playwright is the local deterministic oracle and does not need external handoff.");
  if (provider.id !== "playwright" && !provider.supports.includes("artifact_upload") && artifact.eligibleForUpload) {
    blockedReasons.push(`${provider.label} does not support artifact upload in the built-in adapter registry.`);
  }
  if (!provider.enabled && provider.id !== "playwright" && artifact.eligibleForUpload) {
    blockedReasons.push("Provider is disabled in config.");
  }
  if (provider.availability === "missing_credentials" && artifact.eligibleForUpload) {
    blockedReasons.push(`Missing credential names: ${provider.missingEnv.join(", ")}`);
  }
  if (provider.availability === "policy_blocked" && artifact.eligibleForUpload) {
    blockedReasons.push(`External upload blocked by cost policy: ${provider.costPolicy.blockedReasons.join(" ")}`);
  }
  if (provider.mode === "mock" && provider.id !== "playwright" && artifact.eligibleForUpload) {
    blockedReasons.push("Provider is in mock mode; the handoff is review-only and will not upload externally.");
  }
  return {
    ...artifact,
    eligibleForUpload: artifact.eligibleForUpload && blockedReasons.length === 0,
    blockedReasons
  };
}

function handoffStatus(provider: ProviderInspection, artifacts: ProviderHandoffArtifact[]): ProviderHandoffStatus {
  if (provider.id === "playwright") return "review";
  if (!provider.enabled || provider.availability === "missing_credentials" || provider.availability === "policy_blocked") return "blocked";
  if (!artifacts.some((artifact) => artifact.eligibleForUpload)) return "review";
  if (provider.mode === "mock") return "review";
  return "ready";
}

function handoffWarnings(provider: ProviderInspection, artifacts: ProviderHandoffArtifact[]): string[] {
  const warnings = new Set<string>();
  if (provider.id === "playwright") warnings.add("Playwright is already the deterministic local engine; external handoff is not required.");
  if (provider.id !== "playwright" && !provider.enabled) warnings.add("Provider is disabled; enable it only in a trusted setup review.");
  if (provider.missingEnv.length) warnings.add(`Missing credential names: ${provider.missingEnv.join(", ")}`);
  if (provider.costPolicy.blockedReasons.length && provider.id !== "playwright" && provider.mode !== "mock") {
    warnings.add(`External upload blocked: ${provider.costPolicy.blockedReasons.join(" ")}`);
  }
  if (!artifacts.some((artifact) => artifact.eligibleForUpload)) warnings.add("No artifacts are currently eligible for external upload.");
  warnings.add("This manifest made zero external calls and does not upload screenshots.");
  return [...warnings];
}

function trustedWorkflowSteps(provider: ProviderInspection): string[] {
  if (provider.id === "playwright") {
    return ["Run visual-hive run in PR-safe workflows; no provider handoff is required."];
  }
  return [
    "Run visual-hive plan/run first and treat Playwright as the pass/fail oracle.",
    `Run visual-hive providers handoff --provider ${provider.id} after report.json exists.`,
    "Review .visual-hive/provider-handoff.json and provider-decisions.json before enabling external mode.",
    provider.id === "argos"
      ? "If approved, run visual-hive providers upload --provider argos only in scheduled/manual trusted workflows with ARGOS_TOKEN configured."
      : "If approved, run external upload only in scheduled/manual trusted workflows with required credential names configured.",
    "Upload .visual-hive artifacts with include-hidden-files: true for auditability."
  ];
}

function validationCommands(provider: ProviderInspection): string[] {
  return [
    "visual-hive doctor",
    "visual-hive plan --mode pr --changed-files changed-files.txt",
    "visual-hive run",
    `visual-hive providers plan --provider ${provider.id}`,
    `visual-hive providers handoff --provider ${provider.id}`,
    ...(provider.id === "argos" ? ["visual-hive providers upload --provider argos --dry-run"] : [])
  ];
}

function dedupeArtifacts(artifacts: ProviderHandoffArtifact[]): ProviderHandoffArtifact[] {
  const seen = new Set<string>();
  const result: ProviderHandoffArtifact[] = [];
  for (const artifact of artifacts) {
    const key = `${artifact.kind}:${artifact.path}:${artifact.contractId ?? ""}:${artifact.screenshotName ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(artifact);
  }
  return result;
}

function sanitizeManifest(manifest: ProviderHandoffManifest): ProviderHandoffManifest {
  return JSON.parse(JSON.stringify(manifest), (_key, value: unknown) => (typeof value === "string" ? sanitizeText(value) : value)) as ProviderHandoffManifest;
}
