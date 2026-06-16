import type { ProviderResult } from "../reports/types.js";
import type { PlanMode } from "../planner/types.js";
import { sanitizeText } from "../utils/sanitize.js";
import { inspectProviders, normalizeProviderResults, type ProviderInspection } from "./inspect.js";
import type { VisualHiveConfig } from "../config/schema.js";
import {
  getProviderAdapter,
  runProviderAdapterOperations,
  type ProviderAdapterOperationResult,
  type ProviderNormalizedMetadata
} from "./adapter.js";

export interface MockProviderRun {
  providerId: string;
  label: string;
  enabled: boolean;
  mode: ProviderInspection["mode"];
  availability: ProviderInspection["availability"];
  deterministicRole: ProviderInspection["deterministicRole"];
  operations: ProviderAdapterOperationResult[];
  result: ProviderResult;
  normalized: ProviderNormalizedMetadata;
  artifacts: string[];
  missingEnv: string[];
  warnings: string[];
}

export interface MockProviderRunReport {
  schemaVersion: 1;
  project: string;
  generatedAt: string;
  deterministicStatus: "passed" | "failed";
  artifactCount: number;
  providers: MockProviderRun[];
  summary: {
    providerCount: number;
    enabledProviders: number;
    mockProviders: number;
    missingCredentialProviders: number;
    externalDeferredProviders: number;
    skippedProviders: number;
    failedProviders: number;
  };
  warnings: string[];
}

export interface MockProviderAdapterInput {
  deterministicStatus: "passed" | "failed";
  artifactCount: number;
  artifactPaths?: string[];
  generatedAt?: string;
  mode?: PlanMode;
}

export function runMockProviderAdapters(
  config: VisualHiveConfig,
  input: MockProviderAdapterInput,
  env: NodeJS.ProcessEnv = process.env
): MockProviderRunReport {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const inspections = inspectProviders(config, env, {
    mode: input.mode,
    deterministicStatus: input.deterministicStatus,
    artifactCount: input.artifactCount
  });
  const normalized = normalizeProviderResults(
    config,
    {
      deterministicStatus: input.deterministicStatus,
      artifactCount: input.artifactCount,
      generatedAt,
      mode: input.mode
    },
    env
  );
  const artifacts = (input.artifactPaths ?? []).map((artifact) => sanitizeText(artifact));
  const providers = inspections.map((provider) => {
    const result = normalized.find((entry) => entry.providerId === provider.id);
    return buildMockProviderRun(provider, result, artifacts, input.artifactCount);
  });
  const warnings = providers.flatMap((provider) => provider.warnings);

  return {
    schemaVersion: 1,
    project: config.project.name,
    generatedAt,
    deterministicStatus: input.deterministicStatus,
    artifactCount: input.artifactCount,
    providers,
    summary: {
      providerCount: providers.length,
      enabledProviders: providers.filter((provider) => provider.enabled).length,
      mockProviders: providers.filter((provider) => provider.availability === "mock").length,
      missingCredentialProviders: providers.filter((provider) => provider.availability === "missing_credentials").length,
      externalDeferredProviders: providers.filter((provider) => isExternalDeferred(provider)).length,
      skippedProviders: providers.filter((provider) => provider.result.status === "skipped").length,
      failedProviders: providers.filter((provider) => provider.operations.some((operation) => operation.status === "failed")).length
    },
    warnings
  };
}

function buildMockProviderRun(
  provider: ProviderInspection,
  result: ProviderResult | undefined,
  artifacts: string[],
  artifactCount: number
): MockProviderRun {
  const safeMissingEnv = provider.missingEnv.map((name) => sanitizeText(name));
  const safeResult = result ?? fallbackResult(provider, artifactCount);
  const warnings: string[] = [];
  const adapter = getProviderAdapter(provider.id);
  const operations = runProviderAdapterOperations(adapter, {
    provider,
    deterministicStatus: safeResult.status === "failed" ? "failed" : "passed",
    artifactCount,
    artifacts,
    generatedAt: safeResult.normalizedAt
  });
  const normalized = adapter.normalizeMetadata(
    {
      provider,
      deterministicStatus: safeResult.status === "failed" ? "failed" : "passed",
      artifactCount,
      artifacts,
      generatedAt: safeResult.normalizedAt
    },
    safeResult
  );

  if (provider.availability === "missing_credentials") {
    warnings.push(`${provider.label} is enabled but missing credential names: ${safeMissingEnv.join(", ")}`);
  } else if (provider.availability === "policy_blocked") {
    warnings.push(`${provider.label} external upload is blocked by cost policy: ${provider.costPolicy.blockedReasons.join(" ")}`);
  } else if (provider.enabled && provider.mode === "external" && provider.availability === "available" && provider.id !== "playwright") {
    warnings.push(`${provider.label} external execution is configured but deferred in this local adapter runner.`);
  }

  return {
    providerId: provider.id,
    label: provider.label,
    enabled: provider.enabled,
    mode: provider.mode,
    availability: provider.availability,
    deterministicRole: provider.deterministicRole,
    operations,
    result: {
      ...safeResult,
      message: sanitizeText(safeResult.message),
      externalUrl: safeResult.externalUrl ? sanitizeText(safeResult.externalUrl) : undefined,
      requiredEnv: safeResult.requiredEnv.map((name) => sanitizeText(name)),
      missingEnv: safeResult.missingEnv.map((name) => sanitizeText(name))
    },
    normalized,
    artifacts,
    missingEnv: safeMissingEnv,
    warnings: warnings.map((warning) => sanitizeText(warning))
  };
}

function fallbackResult(provider: ProviderInspection, artifactCount: number): ProviderResult {
  return {
    providerId: provider.id,
    label: provider.label,
    status: provider.id === "playwright" ? "passed" : "skipped",
    deterministicRole: provider.deterministicRole,
    message: provider.message,
    requiredEnv: provider.requiredEnv,
    missingEnv: provider.missingEnv,
    artifactCount,
    normalizedAt: new Date().toISOString()
  };
}

function isExternalDeferred(provider: MockProviderRun): boolean {
  return provider.enabled && provider.mode === "external" && provider.availability === "available" && provider.providerId !== "playwright";
}
