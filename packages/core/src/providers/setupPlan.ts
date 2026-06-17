import type { ProviderId, VisualHiveConfig } from "../config/schema.js";
import { sanitizeText } from "../utils/sanitize.js";
import { inspectProviders, type ProviderInspection } from "./inspect.js";

export type ProviderSetupRecommendation = "use_builtin" | "keep_disabled" | "mock_review" | "trusted_setup_ready" | "blocked";

export interface ProviderSetupPlan {
  schemaVersion: 1;
  project: string;
  generatedAt: string;
  providerId: ProviderId;
  label: string;
  recommendation: ProviderSetupRecommendation;
  readiness: {
    enabled: boolean;
    mode: "mock" | "external";
    deterministicRole: "oracle" | "supplemental";
    availability: string;
    requiredEnv: string[];
    missingEnv: string[];
    projectIdConfigured: boolean;
    externalUploadAllowed: boolean;
    externalUploadBlockedReasons: string[];
  };
  authorizationRequired: boolean;
  externalCallsMade: 0;
  configChanges: string[];
  workflowSteps: string[];
  safetyChecks: string[];
  validationCommands: string[];
  warnings: string[];
}

export interface BuildProviderSetupPlanOptions {
  providerId: ProviderId;
  env?: NodeJS.ProcessEnv;
  generatedAt?: string;
}

export function buildProviderSetupPlan(config: VisualHiveConfig, options: BuildProviderSetupPlanOptions): ProviderSetupPlan {
  const provider = inspectProviders(config, options.env ?? process.env).find((candidate) => candidate.id === options.providerId);
  if (!provider) {
    throw new Error(`Unknown provider "${options.providerId}".`);
  }
  const recommendation = recommendationFor(provider);
  const plan: ProviderSetupPlan = {
    schemaVersion: 1,
    project: config.project.name,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    providerId: provider.id,
    label: provider.label,
    recommendation,
    readiness: {
      enabled: provider.enabled,
      mode: provider.mode,
      deterministicRole: provider.deterministicRole,
      availability: provider.availability,
      requiredEnv: provider.requiredEnv,
      missingEnv: provider.missingEnv,
      projectIdConfigured: Boolean(provider.projectId),
      externalUploadAllowed: provider.id === "playwright" || provider.mode === "mock" ? true : provider.costPolicy.externalUploadAllowed,
      externalUploadBlockedReasons: provider.id === "playwright" || provider.mode === "mock" ? [] : provider.costPolicy.blockedReasons
    },
    authorizationRequired: provider.id !== "playwright" && provider.mode === "external",
    externalCallsMade: 0,
    configChanges: configChangesFor(provider),
    workflowSteps: workflowStepsFor(provider),
    safetyChecks: safetyChecksFor(provider),
    validationCommands: validationCommandsFor(provider),
    warnings: warningsFor(provider)
  };
  return sanitizePlan(plan);
}

function recommendationFor(provider: ProviderInspection): ProviderSetupRecommendation {
  if (provider.id === "playwright") return "use_builtin";
  if (!provider.enabled) return "keep_disabled";
  if (provider.mode === "mock") return "mock_review";
  if (provider.missingEnv.length || !provider.costPolicy.externalUploadAllowed) return "blocked";
  return "trusted_setup_ready";
}

function configChangesFor(provider: ProviderInspection): string[] {
  if (provider.id === "playwright") {
    return ["Keep providers.playwright enabled; it is the default deterministic oracle."];
  }
  if (!provider.enabled) {
    return [
      `Set providers.${provider.id}.enabled=true only after approving a trusted setup review.`,
      `Keep providers.${provider.id}.mode=mock for dry runs, or mode=external only in trusted scheduled/manual lanes.`,
      `Add requiredEnv names only: ${provider.requiredEnv.join(", ") || "none"}.`
    ];
  }
  if (provider.mode === "mock") {
    return [
      `Keep providers.${provider.id}.mode=mock while reviewing artifacts and cost policy.`,
      "Mock mode records provider-shaped metadata without external network calls."
    ];
  }
  return [
    `Review providers.${provider.id}.projectId if the provider needs a project/app identifier.`,
    "Keep costPolicy.externalUpload.pullRequest=false unless a security review explicitly approves PR uploads.",
    "Use scheduled/manual trusted lanes for external uploads."
  ];
}

function workflowStepsFor(provider: ProviderInspection): string[] {
  if (provider.id === "playwright") {
    return ["Run visual-hive run in pull_request workflows with contents: read and no secrets."];
  }
  const steps = [
    "Run deterministic visual-hive plan/run first; external providers must stay supplemental.",
    "Run visual-hive providers list --mock-results to produce local provider evidence before enabling external mode.",
    "Upload .visual-hive artifacts with include-hidden-files: true."
  ];
  if (provider.mode === "external") {
    steps.push("Enable credentials only in scheduled/manual trusted environments, not untrusted pull_request workflows.");
  }
  return steps;
}

function safetyChecksFor(provider: ProviderInspection): string[] {
  const checks = [
    "LLM output and provider output must never be the sole pass/fail oracle.",
    "Do not use pull_request_target for workflows that execute PR code.",
    "Do not print credential values; show required environment variable names only.",
    "Keep issue creation in a trusted workflow_run consumer of sanitized artifacts."
  ];
  if (provider.id !== "playwright") {
    checks.push("Confirm external upload budget and screenshot volume before enabling provider uploads.");
  }
  return checks;
}

function validationCommandsFor(provider: ProviderInspection): string[] {
  const commands = [
    "visual-hive doctor",
    "visual-hive plan --mode pr --changed-files changed-files.txt",
    "visual-hive run",
    "visual-hive providers list --mock-results",
    `visual-hive providers plan --provider ${provider.id}`
  ];
  if (provider.id !== "playwright") {
    commands.push(`visual-hive providers decision --provider ${provider.id} --decision review_later --reason "Review provider setup before enabling external uploads"`);
  }
  return commands;
}

function warningsFor(provider: ProviderInspection): string[] {
  const warnings: string[] = [];
  if (provider.id !== "playwright" && !provider.enabled) warnings.push("Provider is currently disabled; this plan is advisory only.");
  if (provider.missingEnv.length) warnings.push(`Missing credential names: ${provider.missingEnv.join(", ")}`);
  if (provider.costPolicy.blockedReasons.length && provider.id !== "playwright" && provider.mode !== "mock") {
    warnings.push(`External upload blocked: ${provider.costPolicy.blockedReasons.join(" ")}`);
  }
  if (provider.id !== "playwright" && provider.mode === "external") {
    warnings.push("External mode must run only after explicit user authorization in a trusted lane.");
  }
  return warnings;
}

function sanitizePlan(plan: ProviderSetupPlan): ProviderSetupPlan {
  return JSON.parse(JSON.stringify(plan), (_key, value: unknown) => (typeof value === "string" ? sanitizeText(value) : value)) as ProviderSetupPlan;
}
