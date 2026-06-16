import type { ProviderConfig, ProviderId, VisualHiveConfig } from "../config/schema.js";
import type { PlanMode } from "../planner/types.js";
import type { ProviderResult } from "../reports/types.js";

export type ProviderAvailability = "available" | "disabled" | "missing_credentials" | "mock" | "policy_blocked";

export interface ProviderAdapterMetadata {
  id: ProviderId;
  label: string;
  category: "built-in" | "hosted-visual" | "component" | "ci";
  deterministicRole: "oracle" | "supplemental";
  supports: Array<"availability" | "artifact_upload" | "visual_compare" | "result_normalization" | "status_reporting">;
  docs: string;
}

export interface ProviderInspection {
  id: ProviderId;
  label: string;
  enabled: boolean;
  mode: ProviderConfig["mode"];
  projectId?: string;
  availability: ProviderAvailability;
  deterministicRole: ProviderAdapterMetadata["deterministicRole"];
  requiredEnv: string[];
  missingEnv: string[];
  supports: ProviderAdapterMetadata["supports"];
  docs: string;
  message: string;
  costPolicy: ProviderCostPolicyEvaluation;
}

export interface ProviderInspectionContext {
  mode?: PlanMode;
  deterministicStatus?: "passed" | "failed";
  artifactCount?: number;
  selectedContractSeverities?: Array<VisualHiveConfig["contracts"][number]["severity"]>;
}

export interface ProviderCostPolicyEvaluation {
  externalUploadAllowed: boolean;
  blockedReasons: string[];
  estimatedExternalScreenshots: number;
  maxExternalScreenshotsPerRun: number;
  maxMonthlyExternalScreenshots: number;
  externalUploadPolicy: VisualHiveConfig["costPolicy"]["externalUpload"];
}

export const PROVIDER_ADAPTERS: ProviderAdapterMetadata[] = [
  {
    id: "playwright",
    label: "Playwright built-in",
    category: "built-in",
    deterministicRole: "oracle",
    supports: ["availability", "visual_compare", "result_normalization", "status_reporting"],
    docs: "Default deterministic engine. No paid account required."
  },
  {
    id: "argos",
    label: "Argos",
    category: "hosted-visual",
    deterministicRole: "supplemental",
    supports: ["availability", "artifact_upload", "result_normalization"],
    docs: "Optional hosted visual review adapter. Requires ARGOS_TOKEN when enabled in external mode."
  },
  {
    id: "percy",
    label: "Percy",
    category: "hosted-visual",
    deterministicRole: "supplemental",
    supports: ["availability", "artifact_upload", "result_normalization"],
    docs: "Optional hosted visual review adapter. Requires PERCY_TOKEN when enabled in external mode."
  },
  {
    id: "chromatic",
    label: "Chromatic",
    category: "hosted-visual",
    deterministicRole: "supplemental",
    supports: ["availability", "artifact_upload", "result_normalization"],
    docs: "Optional Storybook/visual review adapter. Requires CHROMATIC_PROJECT_TOKEN when enabled in external mode."
  },
  {
    id: "applitools",
    label: "Applitools",
    category: "hosted-visual",
    deterministicRole: "supplemental",
    supports: ["availability", "artifact_upload", "visual_compare", "result_normalization"],
    docs: "Optional visual AI adapter. Requires APPLITOOLS_API_KEY when enabled in external mode."
  },
  {
    id: "storybook",
    label: "Storybook",
    category: "component",
    deterministicRole: "supplemental",
    supports: ["availability", "artifact_upload", "result_normalization"],
    docs: "Optional component coverage adapter. Mock mode is supported without a running Storybook service."
  },
  {
    id: "github-checks",
    label: "GitHub Checks",
    category: "ci",
    deterministicRole: "supplemental",
    supports: ["availability", "status_reporting"],
    docs: "Optional status reporting adapter. Issue creation and privileged writes must happen from trusted workflows."
  }
];

export function inspectProviders(
  config: VisualHiveConfig,
  env: NodeJS.ProcessEnv = process.env,
  context: ProviderInspectionContext = {}
): ProviderInspection[] {
  return PROVIDER_ADAPTERS.map((metadata) => inspectProvider(metadata, config.providers[metadata.id], config, env, context));
}

export function normalizeProviderResults(
  config: VisualHiveConfig,
  input: { deterministicStatus: "passed" | "failed"; artifactCount: number; generatedAt?: string; mode?: PlanMode },
  env: NodeJS.ProcessEnv = process.env
): ProviderResult[] {
  const normalizedAt = input.generatedAt ?? new Date().toISOString();
  return inspectProviders(config, env, {
    mode: input.mode,
    deterministicStatus: input.deterministicStatus,
    artifactCount: input.artifactCount
  }).map((provider) => {
    const policy = providerPolicyFields(provider);
    return {
      providerId: provider.id,
      label: provider.label,
      status: providerStatus(provider, input.deterministicStatus),
      deterministicRole: provider.deterministicRole,
      message: providerMessageForResult(provider, input.deterministicStatus),
      requiredEnv: provider.requiredEnv,
      missingEnv: provider.missingEnv,
      artifactCount: provider.enabled || provider.id === "playwright" ? input.artifactCount : 0,
      ...policy,
      normalizedAt
    };
  });
}

function inspectProvider(
  metadata: ProviderAdapterMetadata,
  config: ProviderConfig,
  fullConfig: VisualHiveConfig,
  env: NodeJS.ProcessEnv,
  context: ProviderInspectionContext
): ProviderInspection {
  const requiredEnv = config.requiredEnv;
  const missingEnv = requiredEnv.filter((name) => !env[name]);
  const costPolicy = evaluateProviderCostPolicy(fullConfig, context);
  const availability: ProviderAvailability = !config.enabled
    ? "disabled"
    : config.mode === "mock"
      ? "mock"
      : missingEnv.length > 0
        ? "missing_credentials"
        : metadata.id !== "playwright" && !costPolicy.externalUploadAllowed
          ? "policy_blocked"
          : "available";
  return {
    id: metadata.id,
    label: metadata.label,
    enabled: config.enabled,
    mode: config.mode,
    projectId: config.projectId,
    availability,
    deterministicRole: metadata.deterministicRole,
    requiredEnv,
    missingEnv,
    supports: metadata.supports,
    docs: metadata.docs,
    message: providerMessage(metadata, availability, missingEnv, costPolicy.blockedReasons),
    costPolicy
  };
}

function providerMessage(
  metadata: ProviderAdapterMetadata,
  availability: ProviderAvailability,
  missingEnv: string[],
  blockedReasons: string[]
): string {
  if (metadata.id === "playwright") return "Built-in deterministic oracle.";
  if (availability === "disabled") return "Disabled; Visual Hive will not call this provider.";
  if (availability === "mock") return "Mock mode; no external provider call will be made.";
  if (availability === "missing_credentials") return `Missing environment variables by name only: ${missingEnv.join(", ")}`;
  if (availability === "policy_blocked") return `External upload blocked by cost policy: ${blockedReasons.join(" ")}`;
  return "Configured and credential names are present. External calls remain adapter-controlled and optional.";
}

function providerStatus(provider: ProviderInspection, deterministicStatus: "passed" | "failed"): ProviderResult["status"] {
  if (provider.id === "playwright") return deterministicStatus;
  if (!provider.enabled) return "skipped";
  if (provider.availability === "mock") return "mock";
  if (provider.availability === "missing_credentials") return "missing_credentials";
  if (provider.availability === "policy_blocked") return "skipped";
  return "skipped";
}

function providerMessageForResult(provider: ProviderInspection, deterministicStatus: "passed" | "failed"): string {
  if (provider.id === "playwright") {
    return `Built-in Playwright deterministic run ${deterministicStatus}.`;
  }
  if (!provider.enabled) {
    return "Provider disabled; no external artifacts were uploaded.";
  }
  if (provider.availability === "mock") {
    return "Mock adapter normalized local metadata only; no external provider call was made.";
  }
  if (provider.availability === "missing_credentials") {
    return `Provider enabled but missing credential names: ${provider.missingEnv.join(", ")}`;
  }
  if (provider.availability === "policy_blocked") {
    return `Provider enabled but external upload is blocked by cost policy: ${provider.costPolicy.blockedReasons.join(" ")}`;
  }
  return "Provider is configured, but external upload/compare execution is deferred to a future adapter.";
}

function providerPolicyFields(
  provider: ProviderInspection
): Pick<ProviderResult, "externalUploadAllowed" | "externalUploadBlockedReasons" | "estimatedExternalScreenshots"> {
  if (provider.id === "playwright" || provider.mode === "mock") {
    return {
      externalUploadAllowed: true,
      externalUploadBlockedReasons: [],
      estimatedExternalScreenshots: provider.costPolicy.estimatedExternalScreenshots
    };
  }
  if (!provider.enabled) {
    return {};
  }
  return {
    externalUploadAllowed: provider.costPolicy.externalUploadAllowed,
    externalUploadBlockedReasons: provider.costPolicy.blockedReasons,
    estimatedExternalScreenshots: provider.costPolicy.estimatedExternalScreenshots
  };
}

function evaluateProviderCostPolicy(config: VisualHiveConfig, context: ProviderInspectionContext): ProviderCostPolicyEvaluation {
  const mode = context.mode ?? "manual";
  const deterministicStatus = context.deterministicStatus ?? "passed";
  const estimatedExternalScreenshots = context.artifactCount ?? 0;
  const policy = config.costPolicy;
  const blockedReasons: string[] = [];
  const modeAllowed = externalUploadAllowedForMode(policy.externalUpload, mode);

  if (!modeAllowed) {
    blockedReasons.push(`costPolicy.externalUpload.${externalUploadModeKey(mode)}=false for ${mode} mode.`);
  }
  if (policy.externalUpload.onFailureOnly && deterministicStatus !== "failed") {
    blockedReasons.push("costPolicy.externalUpload.onFailureOnly=true and deterministic status is passed.");
  }
  if (estimatedExternalScreenshots > policy.maxExternalScreenshotsPerRun) {
    blockedReasons.push(
      `estimated external screenshots ${estimatedExternalScreenshots} exceeds costPolicy.maxExternalScreenshotsPerRun ${policy.maxExternalScreenshotsPerRun}.`
    );
  }
  if (policy.externalUpload.criticalContractsOnly && context.selectedContractSeverities?.length) {
    const hasCritical = context.selectedContractSeverities.includes("critical");
    if (!hasCritical) {
      blockedReasons.push("costPolicy.externalUpload.criticalContractsOnly=true and no selected contract is critical.");
    }
  }

  return {
    externalUploadAllowed: blockedReasons.length === 0,
    blockedReasons,
    estimatedExternalScreenshots,
    maxExternalScreenshotsPerRun: policy.maxExternalScreenshotsPerRun,
    maxMonthlyExternalScreenshots: policy.maxMonthlyExternalScreenshots,
    externalUploadPolicy: policy.externalUpload
  };
}

function externalUploadAllowedForMode(policy: VisualHiveConfig["costPolicy"]["externalUpload"], mode: PlanMode): boolean {
  return policy[externalUploadModeKey(mode)];
}

function externalUploadModeKey(mode: PlanMode): keyof VisualHiveConfig["costPolicy"]["externalUpload"] {
  if (mode === "pr") return "pullRequest";
  return mode;
}
