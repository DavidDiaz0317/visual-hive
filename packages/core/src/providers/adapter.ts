import type { ProviderId } from "../config/schema.js";
import type { ProviderResult } from "../reports/types.js";
import { sanitizeText } from "../utils/sanitize.js";
import { PROVIDER_ADAPTERS, type ProviderAdapterMetadata, type ProviderInspection } from "./inspect.js";

export type ProviderAdapterOperation =
  | "availability"
  | "upload_artifact"
  | "compare"
  | "fetch_result"
  | "normalize_result"
  | "emit_report_metadata";

export type ProviderAdapterOperationStatus = "passed" | "failed" | "skipped" | "mock";

export interface ProviderAdapterOperationResult {
  operation: ProviderAdapterOperation;
  status: ProviderAdapterOperationStatus;
  message: string;
  artifactCount?: number;
}

export type ProviderNetworkMode = "local" | "mock" | "deferred" | "disabled" | "missing_credentials" | "policy_blocked";

export interface ProviderNormalizedMetadata {
  providerId: ProviderId;
  category: ProviderAdapterMetadata["category"];
  status: ProviderResult["status"];
  deterministicRole: ProviderAdapterMetadata["deterministicRole"];
  networkMode: ProviderNetworkMode;
  externalCallsMade: 0;
  artifactSummary: {
    localArtifacts: number;
    uploadedArtifacts: number;
    comparedArtifacts: number;
    uploadMode: "local-only" | "mock" | "deferred" | "not-supported" | "disabled" | "blocked";
  };
  costPolicy: {
    externalUploadAllowed: boolean;
    blockedReasons: string[];
    estimatedExternalScreenshots: number;
    maxExternalScreenshotsPerRun: number;
    maxMonthlyExternalScreenshots: number;
  };
  hostedVisual?: {
    provider: "argos" | "percy" | "chromatic" | "applitools";
    projectId?: string;
    reviewUrl?: string;
    baselinePolicy: "visual-hive-owned" | "provider-owned-future";
  };
  storybook?: {
    mode: "mock" | "deferred" | "disabled";
    recommendedCommand: string;
    coverageHint: string;
  };
  githubChecks?: {
    checkName: string;
    conclusion: "success" | "failure" | "neutral" | "skipped";
    annotationCount: number;
    trustedIssueWorkflowRequired: true;
  };
  notes: string[];
}

export interface ProviderAdapterRunContext {
  provider: ProviderInspection;
  deterministicStatus: "passed" | "failed";
  artifactCount: number;
  artifacts: string[];
  generatedAt: string;
}

export interface ProviderAdapter {
  id: ProviderId;
  label: string;
  category: ProviderAdapterMetadata["category"];
  deterministicRole: ProviderAdapterMetadata["deterministicRole"];
  supportedOperations: ProviderAdapterOperation[];
  checkAvailability: (context: ProviderAdapterRunContext) => ProviderAdapterOperationResult;
  uploadArtifact: (context: ProviderAdapterRunContext) => ProviderAdapterOperationResult;
  compare: (context: ProviderAdapterRunContext) => ProviderAdapterOperationResult;
  fetchResult: (context: ProviderAdapterRunContext) => ProviderAdapterOperationResult;
  normalizeResult: (context: ProviderAdapterRunContext) => ProviderAdapterOperationResult;
  emitReportMetadata: (context: ProviderAdapterRunContext) => ProviderAdapterOperationResult;
  normalizeMetadata: (context: ProviderAdapterRunContext, result: ProviderResult) => ProviderNormalizedMetadata;
}

export const PROVIDER_ADAPTER_OPERATION_SEQUENCE: ProviderAdapterOperation[] = [
  "availability",
  "upload_artifact",
  "compare",
  "fetch_result",
  "normalize_result",
  "emit_report_metadata"
];

export function listProviderAdapters(): ProviderAdapter[] {
  return PROVIDER_ADAPTERS.map((metadata) => createProviderAdapter(metadata));
}

export function getProviderAdapter(providerId: ProviderId): ProviderAdapter {
  const metadata = PROVIDER_ADAPTERS.find((adapter) => adapter.id === providerId);
  if (!metadata) {
    throw new Error(`Unknown provider adapter: ${providerId}`);
  }
  return createProviderAdapter(metadata);
}

export function runProviderAdapterOperations(adapter: ProviderAdapter, context: ProviderAdapterRunContext): ProviderAdapterOperationResult[] {
  if (!context.provider.enabled && context.provider.id !== "playwright") {
    return [adapter.checkAvailability(context)];
  }
  return [
    adapter.checkAvailability(context),
    adapter.uploadArtifact(context),
    adapter.compare(context),
    adapter.fetchResult(context),
    adapter.normalizeResult(context),
    adapter.emitReportMetadata(context)
  ];
}

function createProviderAdapter(metadata: ProviderAdapterMetadata): ProviderAdapter {
  return {
    id: metadata.id,
    label: metadata.label,
    category: metadata.category,
    deterministicRole: metadata.deterministicRole,
    supportedOperations: supportedOperations(metadata),
    checkAvailability: (context) => availabilityOperation(metadata, context),
    uploadArtifact: (context) => uploadOperation(metadata, context),
    compare: (context) => compareOperation(metadata, context),
    fetchResult: (context) => fetchOperation(metadata, context),
    normalizeResult: (context) => normalizeOperation(metadata, context),
    emitReportMetadata: (context) => metadataOperation(metadata, context),
    normalizeMetadata: (context, result) => normalizeProviderMetadata(metadata, context, result)
  };
}

function supportedOperations(metadata: ProviderAdapterMetadata): ProviderAdapterOperation[] {
  const operations: ProviderAdapterOperation[] = ["availability", "normalize_result", "emit_report_metadata"];
  if (metadata.supports.includes("artifact_upload")) operations.push("upload_artifact");
  if (metadata.supports.includes("visual_compare")) operations.push("compare");
  if (metadata.supports.includes("result_normalization") || metadata.supports.includes("status_reporting")) operations.push("fetch_result");
  return PROVIDER_ADAPTER_OPERATION_SEQUENCE.filter((operation) => operations.includes(operation));
}

function availabilityOperation(metadata: ProviderAdapterMetadata, context: ProviderAdapterRunContext): ProviderAdapterOperationResult {
  const provider = context.provider;
  if (!provider.enabled && provider.id !== "playwright") {
    return operation("availability", "skipped", "Provider is disabled; no adapter operations were run.");
  }
  if (provider.id === "playwright") {
    return operation("availability", "passed", "Built-in Playwright adapter is available.");
  }
  if (provider.availability === "mock") {
    return operation("availability", "mock", "Mock adapter is available without credentials.");
  }
  if (provider.availability === "missing_credentials") {
    return operation("availability", "failed", `Missing credential environment variable names: ${provider.missingEnv.join(", ")}`);
  }
  return operation("availability", "passed", `${metadata.label} credential names are present.`);
}

function uploadOperation(metadata: ProviderAdapterMetadata, context: ProviderAdapterRunContext): ProviderAdapterOperationResult {
  if (context.provider.availability === "mock") {
    return operation("upload_artifact", "mock", "Mock upload recorded local artifact paths only.", context.artifactCount);
  }
  if (context.provider.availability === "missing_credentials") {
    return operation("upload_artifact", "skipped", "External upload skipped because credentials are missing.");
  }
  if (context.provider.availability === "policy_blocked") {
    return operation("upload_artifact", "skipped", `External upload skipped by cost policy: ${context.provider.costPolicy.blockedReasons.join(" ")}`);
  }
  if (!metadata.supports.includes("artifact_upload")) {
    return operation("upload_artifact", "skipped", `${metadata.label} does not upload external artifacts in the built-in adapter.`);
  }
  return operation("upload_artifact", "skipped", "External upload is deferred; no network call was made.", context.artifactCount);
}

function compareOperation(metadata: ProviderAdapterMetadata, context: ProviderAdapterRunContext): ProviderAdapterOperationResult {
  if (metadata.id === "playwright") {
    return operation(
      "compare",
      context.deterministicStatus === "failed" ? "failed" : "passed",
      `Deterministic Playwright run ${context.deterministicStatus}.`,
      context.artifactCount
    );
  }
  if (context.provider.availability === "mock") {
    return operation("compare", "mock", "Mock comparison mirrored deterministic Visual Hive status.", context.artifactCount);
  }
  if (context.provider.availability === "missing_credentials") {
    return operation("compare", "skipped", "External compare skipped because credentials are missing.");
  }
  if (context.provider.availability === "policy_blocked") {
    return operation("compare", "skipped", "External compare skipped because external upload is blocked by cost policy.");
  }
  return operation("compare", "skipped", "External compare is deferred; deterministic Playwright remains the oracle.");
}

function fetchOperation(metadata: ProviderAdapterMetadata, context: ProviderAdapterRunContext): ProviderAdapterOperationResult {
  if (metadata.id === "playwright") {
    return operation("fetch_result", "skipped", "Playwright result is already local; no external fetch is required.");
  }
  if (context.provider.availability === "mock") {
    return operation("fetch_result", "mock", "Mock result fetched from local deterministic metadata.");
  }
  if (context.provider.availability === "missing_credentials") {
    return operation("fetch_result", "skipped", "External result fetch skipped because credentials are missing.");
  }
  if (context.provider.availability === "policy_blocked") {
    return operation("fetch_result", "skipped", "External result fetch skipped because provider upload is policy-blocked.");
  }
  return operation("fetch_result", "skipped", "External result fetch is deferred; no network call was made.");
}

function normalizeOperation(metadata: ProviderAdapterMetadata, context: ProviderAdapterRunContext): ProviderAdapterOperationResult {
  if (metadata.id === "playwright") {
    return operation("normalize_result", "passed", "Normalized deterministic Playwright report metadata.", context.artifactCount);
  }
  if (context.provider.availability === "mock") {
    return operation("normalize_result", "mock", "Mock result normalized into Visual Hive provider metadata.", context.artifactCount);
  }
  if (context.provider.availability === "missing_credentials") {
    return operation("normalize_result", "passed", "Missing-credential status normalized without external calls.");
  }
  if (context.provider.availability === "policy_blocked") {
    return operation("normalize_result", "passed", "Cost-policy blocked status normalized without external calls.");
  }
  return operation("normalize_result", "passed", "Deferred external provider status normalized as skipped.");
}

function metadataOperation(metadata: ProviderAdapterMetadata, context: ProviderAdapterRunContext): ProviderAdapterOperationResult {
  if (metadata.id === "playwright") {
    return operation("emit_report_metadata", "passed", "Provider metadata is embedded in report.json.", context.artifactCount);
  }
  if (context.provider.availability === "mock") {
    return operation("emit_report_metadata", "mock", "Mock provider run emitted provider-results.json metadata.", context.artifactCount);
  }
  if (context.provider.availability === "missing_credentials") {
    return operation("emit_report_metadata", "passed", "Missing-credential metadata emitted with names only.");
  }
  if (context.provider.availability === "policy_blocked") {
    return operation("emit_report_metadata", "passed", "Cost-policy metadata emitted for auditability.");
  }
  return operation("emit_report_metadata", "passed", "Deferred provider metadata emitted for auditability.");
}

function operation(
  operationName: ProviderAdapterOperation,
  status: ProviderAdapterOperationStatus,
  message: string,
  artifactCount?: number
): ProviderAdapterOperationResult {
  return {
    operation: operationName,
    status,
    message: sanitizeText(message),
    artifactCount
  };
}

function normalizeProviderMetadata(
  metadata: ProviderAdapterMetadata,
  context: ProviderAdapterRunContext,
  result: ProviderResult
): ProviderNormalizedMetadata {
  const networkMode = providerNetworkMode(metadata, context.provider);
  const base: ProviderNormalizedMetadata = {
    providerId: metadata.id,
    category: metadata.category,
    status: result.status,
    deterministicRole: metadata.deterministicRole,
    networkMode,
    externalCallsMade: 0,
    artifactSummary: {
      localArtifacts: context.artifactCount,
      uploadedArtifacts: networkMode === "mock" ? context.artifactCount : 0,
      comparedArtifacts: metadata.id === "playwright" || networkMode === "mock" ? context.artifactCount : 0,
      uploadMode: uploadMode(metadata, networkMode)
    },
    costPolicy: {
      externalUploadAllowed:
        metadata.id === "playwright" || context.provider.mode === "mock" || !context.provider.enabled
          ? true
          : context.provider.costPolicy.externalUploadAllowed,
      blockedReasons:
        metadata.id === "playwright" || context.provider.mode === "mock" || !context.provider.enabled ? [] : context.provider.costPolicy.blockedReasons,
      estimatedExternalScreenshots: context.provider.costPolicy.estimatedExternalScreenshots,
      maxExternalScreenshotsPerRun: context.provider.costPolicy.maxExternalScreenshotsPerRun,
      maxMonthlyExternalScreenshots: context.provider.costPolicy.maxMonthlyExternalScreenshots
    },
    notes: providerNotes(metadata, context.provider, networkMode)
  };

  if (isHostedVisualProvider(metadata.id)) {
    base.hostedVisual = {
      provider: metadata.id,
      projectId: sanitizeOptional(context.provider.projectId),
      reviewUrl: mockReviewUrl(metadata.id, context.provider.projectId),
      baselinePolicy: networkMode === "mock" ? "visual-hive-owned" : "provider-owned-future"
    };
  }
  if (metadata.id === "storybook") {
    base.storybook = {
      mode: networkMode === "disabled" ? "disabled" : networkMode === "mock" ? "mock" : "deferred",
      recommendedCommand: "npm run storybook -- --ci",
      coverageHint: "Map Storybook stories to contracts, then upload local story screenshots through a future external adapter."
    };
  }
  if (metadata.id === "github-checks") {
    base.githubChecks = {
      checkName: "Visual Hive",
      conclusion: githubConclusion(context.deterministicStatus, result.status),
      annotationCount: 0,
      trustedIssueWorkflowRequired: true
    };
  }
  return sanitizeMetadata(base);
}

function providerNetworkMode(metadata: ProviderAdapterMetadata, provider: ProviderInspection): ProviderNetworkMode {
  if (metadata.id === "playwright") return "local";
  if (!provider.enabled) return "disabled";
  if (provider.availability === "mock") return "mock";
  if (provider.availability === "missing_credentials") return "missing_credentials";
  if (provider.availability === "policy_blocked") return "policy_blocked";
  return "deferred";
}

function uploadMode(metadata: ProviderAdapterMetadata, networkMode: ProviderNetworkMode): ProviderNormalizedMetadata["artifactSummary"]["uploadMode"] {
  if (networkMode === "disabled") return "disabled";
  if (networkMode === "missing_credentials") return "blocked";
  if (networkMode === "policy_blocked") return "blocked";
  if (networkMode === "mock") return "mock";
  if (metadata.id === "playwright") return "local-only";
  if (!metadata.supports.includes("artifact_upload")) return "not-supported";
  return "deferred";
}

function providerNotes(metadata: ProviderAdapterMetadata, provider: ProviderInspection, networkMode: ProviderNetworkMode): string[] {
  if (metadata.id === "playwright") return ["Playwright is the deterministic pass/fail oracle."];
  if (networkMode === "disabled") return ["Provider is disabled in config."];
  if (networkMode === "missing_credentials") return [`Missing credential names: ${provider.missingEnv.join(", ")}`];
  if (networkMode === "policy_blocked") return [`External upload blocked by cost policy: ${provider.costPolicy.blockedReasons.join(" ")}`];
  if (networkMode === "mock") return ["Mock mode records adapter behavior without external calls."];
  return ["External provider execution is deferred; no network call was made."];
}

function githubConclusion(
  deterministicStatus: ProviderAdapterRunContext["deterministicStatus"],
  resultStatus: ProviderResult["status"]
): NonNullable<ProviderNormalizedMetadata["githubChecks"]>["conclusion"] {
  if (resultStatus === "missing_credentials") return "neutral";
  if (resultStatus === "skipped") return "skipped";
  return deterministicStatus === "passed" ? "success" : "failure";
}

function isHostedVisualProvider(providerId: ProviderId): providerId is "argos" | "percy" | "chromatic" | "applitools" {
  return providerId === "argos" || providerId === "percy" || providerId === "chromatic" || providerId === "applitools";
}

function mockReviewUrl(providerId: "argos" | "percy" | "chromatic" | "applitools", projectId: string | undefined): string | undefined {
  if (!projectId) return undefined;
  const encodedProjectId = encodeURIComponent(sanitizeText(projectId));
  if (providerId === "argos") return `https://app.argos-ci.com/project/${encodedProjectId}/builds/mock`;
  if (providerId === "percy") return `https://percy.io/${encodedProjectId}/visual-hive-mock`;
  if (providerId === "chromatic") return `https://www.chromatic.com/build?appId=${encodedProjectId}&number=mock`;
  return `https://eyes.applitools.com/app/test-results/mock?projectId=${encodedProjectId}`;
}

function sanitizeOptional(value: string | undefined): string | undefined {
  return value ? sanitizeText(value) : undefined;
}

function sanitizeMetadata(metadata: ProviderNormalizedMetadata): ProviderNormalizedMetadata {
  return JSON.parse(JSON.stringify(metadata), (_key, value: unknown) => (typeof value === "string" ? sanitizeText(value) : value)) as ProviderNormalizedMetadata;
}
