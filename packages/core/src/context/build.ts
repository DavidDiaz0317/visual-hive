import { access } from "node:fs/promises";
import path from "node:path";
import type { AgentPacket } from "../agent/types.js";
import { VISUAL_HIVE_EVIDENCE_RESOURCES } from "../tools/evidenceResources.js";
import type { ToolRegistry, ToolRegistryEntry } from "../tools/types.js";
import { readJson, writeJson } from "../utils/files.js";
import { sanitizeText } from "../utils/sanitize.js";
import type {
  ContextEscalation,
  ContextLedger,
  ContextLedgerBudgets,
  ContextLedgerSourceArtifacts,
  ContextLlmUsage,
  ContextPolicyViolation,
  ContextProviderUsage,
  ContextToolCall
} from "./types.js";

export interface BuildContextLedgerOptions {
  rootDir: string;
  project: string;
  now?: Date;
  budgets?: Partial<ContextLedgerBudgets>;
  toolRegistryPath?: string;
  agentPacketPath?: string;
  evidencePacketPath?: string;
  llmUsagePath?: string;
  providerResultsPath?: string;
  providerUploadManifestPath?: string;
  pipelinePath?: string;
  artifactsIndexPath?: string;
  handoffPacketPath?: string;
  hiveBeadRequestPath?: string;
  hiveHandoffResultPath?: string;
  hiveHandoffValidationPath?: string;
  testCreationPlanPath?: string;
}

export interface WriteContextLedgerOptions extends BuildContextLedgerOptions {
  outputPath?: string;
}

interface PipelineReportLike {
  steps?: Array<{
    id?: unknown;
    label?: unknown;
    status?: unknown;
    exitCode?: unknown;
    artifacts?: unknown;
    message?: unknown;
  }>;
}

const DEFAULT_BUDGETS: ContextLedgerBudgets = {
  maxToolCalls: 20,
  maxToolResultTokens: 12_000,
  maxExternalCostUsd: 0,
  maxProviderScreenshots: 0
};

const DEFAULT_PATHS = {
  toolRegistry: ".visual-hive/tools/tool-registry.json",
  agentPacket: ".visual-hive/agent-packet.json",
  evidencePacket: ".visual-hive/evidence-packet.json",
  llmUsage: ".visual-hive/llm-usage.json",
  providerResults: ".visual-hive/provider-results.json",
  providerUploadManifest: ".visual-hive/provider-upload/argos/manifest.json",
  pipeline: ".visual-hive/pipeline.json",
  artifactsIndex: ".visual-hive/artifacts-index.json",
  handoffPacket: ".visual-hive/handoff.json",
  hiveBeadRequest: ".visual-hive/hive-bead-request.json",
  hiveHandoffResult: ".visual-hive/hive-handoff-result.json",
  hiveHandoffValidation: ".visual-hive/hive-handoff-validation.json",
  testCreationPlan: ".visual-hive/test-creation-plan.json"
};

export async function buildContextLedger(options: BuildContextLedgerOptions): Promise<ContextLedger> {
  const rootDir = path.resolve(options.rootDir);
  const paths = {
    toolRegistry: artifactPath(rootDir, options.toolRegistryPath ?? DEFAULT_PATHS.toolRegistry),
    agentPacket: artifactPath(rootDir, options.agentPacketPath ?? DEFAULT_PATHS.agentPacket),
    evidencePacket: artifactPath(rootDir, options.evidencePacketPath ?? DEFAULT_PATHS.evidencePacket),
    llmUsage: artifactPath(rootDir, options.llmUsagePath ?? DEFAULT_PATHS.llmUsage),
    providerResults: artifactPath(rootDir, options.providerResultsPath ?? DEFAULT_PATHS.providerResults),
    providerUploadManifest: artifactPath(rootDir, options.providerUploadManifestPath ?? DEFAULT_PATHS.providerUploadManifest),
    pipeline: artifactPath(rootDir, options.pipelinePath ?? DEFAULT_PATHS.pipeline),
    artifactsIndex: artifactPath(rootDir, options.artifactsIndexPath ?? DEFAULT_PATHS.artifactsIndex),
    handoffPacket: artifactPath(rootDir, options.handoffPacketPath ?? DEFAULT_PATHS.handoffPacket),
    hiveBeadRequest: artifactPath(rootDir, options.hiveBeadRequestPath ?? DEFAULT_PATHS.hiveBeadRequest),
    hiveHandoffResult: artifactPath(rootDir, options.hiveHandoffResultPath ?? DEFAULT_PATHS.hiveHandoffResult),
    hiveHandoffValidation: artifactPath(rootDir, options.hiveHandoffValidationPath ?? DEFAULT_PATHS.hiveHandoffValidation),
    testCreationPlan: artifactPath(rootDir, options.testCreationPlanPath ?? DEFAULT_PATHS.testCreationPlan)
  };

  const [
    toolRegistry,
    agentPacket,
    llmUsageReport,
    providerResultsReport,
    providerUploadManifest,
    pipelineReport,
    handoffPacket,
    hiveBeadRequest,
    hiveHandoffResult
  ] = await Promise.all([
    readOptionalJson<ToolRegistry>(paths.toolRegistry),
    readOptionalJson<AgentPacket>(paths.agentPacket),
    readOptionalJson<unknown>(paths.llmUsage),
    readOptionalJson<unknown>(paths.providerResults),
    readOptionalJson<unknown>(paths.providerUploadManifest),
    readOptionalJson<PipelineReportLike>(paths.pipeline),
    readOptionalJson<unknown>(paths.handoffPacket),
    readOptionalJson<unknown>(paths.hiveBeadRequest),
    readOptionalJson<unknown>(paths.hiveHandoffResult)
  ]);

  const sourceArtifacts = await existingSources(rootDir, paths);
  const budgets = budgetsFor(agentPacket, toolRegistry, options.budgets);
  const providerUsage = providerUsageFor(providerResultsReport, providerUploadManifest);
  const llmUsage = llmUsageFor(llmUsageReport);
  const toolCalls = toolCallsFor(pipelineReport, toolRegistry);
  const hiveHandoffUsage = hiveHandoffUsageFor({ handoffPacket, hiveBeadRequest, hiveHandoffResult, sourceArtifacts });

  const usage = {
    toolCallsUsed: toolCalls.filter((call) => call.status !== "available").length,
    estimatedToolResultTokens: toolCalls.reduce((sum, call) => sum + call.estimatedResultTokens, 0),
    estimatedPromptTokens: llmUsage.reduce((sum, record) => sum + record.estimatedPromptTokens, 0),
    estimatedExternalCostUsd: roundUsd(
      llmUsage.reduce((sum, record) => sum + record.estimatedCostUsd, 0) +
        providerUsage.reduce((sum, provider) => sum + provider.estimatedCostUsd, 0)
    ),
    providerScreenshots: providerUsage.reduce((sum, provider) => sum + provider.estimatedExternalScreenshots, 0),
    externalCallsMade:
      llmUsage.reduce((sum, record) => sum + record.callsMade, 0) +
      providerUsage.reduce((sum, provider) => sum + provider.externalCallsMade, 0) +
      hiveHandoffUsage.externalCallsMade
  };

  const remaining = {
    toolCalls: Math.max(0, budgets.maxToolCalls - usage.toolCallsUsed),
    toolResultTokens: Math.max(0, budgets.maxToolResultTokens - usage.estimatedToolResultTokens),
    externalCostUsd: Math.max(0, roundUsd(budgets.maxExternalCostUsd - usage.estimatedExternalCostUsd)),
    providerScreenshots: Math.max(0, budgets.maxProviderScreenshots - usage.providerScreenshots)
  };

  const escalations = escalationsFor({ toolCalls, providerUsage, llmUsage, hiveHandoffUsage, usage, sourceArtifacts });
  const policyViolations = policyViolationsFor({ budgets, usage, sourceArtifacts });

  return sanitizeLedger({
    schemaVersion: "visual-hive.context-ledger.v1",
    generatedAt: (options.now ?? new Date()).toISOString(),
    project: sanitizeText(options.project),
    sourceArtifacts,
    budgets,
    usage,
    remaining,
    toolCalls,
    providerUsage,
    llmUsage,
    escalations,
    policyViolations,
    notes: [
      "Context Ledger is governance evidence for agents and MCP tooling; it is not a pass/fail oracle.",
      "Visual Hive's deterministic Verdict Engine remains the authority for pass/fail.",
      "External provider and LLM use must stay disabled or explicitly governed by trusted workflow policy."
    ]
  });
}

export async function writeContextLedger(
  options: WriteContextLedgerOptions
): Promise<{ ledger: ContextLedger; ledgerPath: string }> {
  const ledger = await buildContextLedger(options);
  const ledgerPath = artifactPath(path.resolve(options.rootDir), options.outputPath ?? ".visual-hive/context-ledger.json");
  await writeJson(ledgerPath, ledger);
  return { ledger, ledgerPath };
}

function budgetsFor(agentPacket?: AgentPacket, registry?: ToolRegistry, overrides?: Partial<ContextLedgerBudgets>): ContextLedgerBudgets {
  return {
    maxToolCalls: numberOr(overrides?.maxToolCalls, agentPacket?.budgets?.maxToolCalls, registry?.policy?.maxToolCallsPerTask, DEFAULT_BUDGETS.maxToolCalls),
    maxToolResultTokens: numberOr(
      overrides?.maxToolResultTokens,
      agentPacket?.budgets?.maxToolResultTokens,
      registry?.policy?.maxToolResultTokensPerTask,
      DEFAULT_BUDGETS.maxToolResultTokens
    ),
    maxExternalCostUsd: numberOr(
      overrides?.maxExternalCostUsd,
      agentPacket?.budgets?.maxExternalCostUsd,
      registry?.policy?.maxExternalCostUsdPerTask,
      DEFAULT_BUDGETS.maxExternalCostUsd
    ),
    maxProviderScreenshots: numberOr(overrides?.maxProviderScreenshots, DEFAULT_BUDGETS.maxProviderScreenshots)
  };
}

function toolCallsFor(pipeline?: PipelineReportLike, registry?: ToolRegistry): ContextToolCall[] {
  const toolByCommand = new Map<string, ToolRegistryEntry>();
  const ambiguousCommandKeys = new Set<string>();
  for (const tool of registry?.tools ?? []) {
    const commandKey = firstCommandWord(tool.command);
    if (commandKey) {
      if (toolByCommand.has(commandKey)) {
        toolByCommand.delete(commandKey);
        ambiguousCommandKeys.add(commandKey);
      } else if (!ambiguousCommandKeys.has(commandKey)) {
        toolByCommand.set(commandKey, tool);
      }
    }
    toolByCommand.set(tool.id, tool);
  }

  const steps = Array.isArray(pipeline?.steps) ? pipeline.steps : [];
  const calls = steps.map((step, index) => {
    const id = stringOr(step.id, `step-${index + 1}`);
    const matched = toolByCommand.get(`visual_hive_${id.replaceAll("-", "_")}`) ?? toolByCommand.get(id);
    const artifacts = stringArray(step.artifacts);
    return {
      id: sanitizeText(id),
      source: "pipeline" as const,
      toolId: sanitizeText(matched?.id ?? `visual_hive_${id.replaceAll("-", "_")}`),
      label: sanitizeText(stringOr(step.label, id)),
      access: sanitizeText(matched?.defaultAccess ?? "local_execution"),
      status: sanitizeText(stringOr(step.status, "unknown")),
      trustedOnly: Boolean(matched?.trustedOnly),
      externalNetwork: Boolean(matched?.externalNetwork),
      ...contextEvidenceResourceMetadata(matched, artifacts),
      estimatedResultTokens: estimateToolResultTokens(step, artifacts),
      artifacts,
      reason: sanitizeText(stringOr(step.message, "Recorded from .visual-hive/pipeline.json."))
    };
  });

  if (calls.length) return calls;

  return (registry?.tools ?? [])
    .filter((tool) => tool.enabled)
    .slice(0, 8)
    .map((tool) => ({
      id: sanitizeText(tool.id),
      source: "tool-registry" as const,
      toolId: sanitizeText(tool.id),
      label: sanitizeText(tool.label),
      access: sanitizeText(tool.defaultAccess),
      status: "available",
      trustedOnly: tool.trustedOnly,
      externalNetwork: tool.externalNetwork,
      ...contextEvidenceResourceMetadata(tool, tool.evidenceArtifacts),
      estimatedResultTokens: 0,
      artifacts: tool.evidenceArtifacts.map((artifact) => sanitizeText(artifact)),
      reason: "Available tool from registry; not counted as an executed call."
    }));
}

function contextEvidenceResourceMetadata(tool?: ToolRegistryEntry, artifactPaths: string[] = []): Partial<ContextToolCall> {
  const linkedResources = evidenceResourcesFromArtifacts(artifactPaths);
  const resource =
    tool?.evidenceResourceId || tool?.evidenceResourceUri || tool?.evidenceReadToolName
      ? {
          id: tool.evidenceResourceId,
          uri: tool.evidenceResourceUri,
          title: tool.evidenceResourceTitle,
          description: tool.evidenceResourceDescription,
          readToolName: tool.evidenceReadToolName,
          artifactPath: tool.evidenceArtifacts[0] ?? artifactPaths[0]
        }
      : linkedResources[0]
        ? {
            id: linkedResources[0].evidenceResourceId,
            uri: linkedResources[0].evidenceResourceUri,
            title: linkedResources[0].evidenceResourceTitle,
            description: linkedResources[0].evidenceResourceDescription,
            readToolName: linkedResources[0].evidenceReadToolName,
            artifactPath: linkedResources[0].artifactPath
          }
        : undefined;
  const evidenceResources = uniqueEvidenceResources([
    ...(resource?.id && resource.uri && resource.title && resource.description && resource.artifactPath
      ? [
          {
            evidenceResourceId: resource.id,
            evidenceResourceUri: resource.uri,
            evidenceResourceTitle: resource.title,
            evidenceResourceDescription: resource.description,
            evidenceReadToolName: resource.readToolName,
            artifactPath: resource.artifactPath
          }
        ]
      : []),
    ...linkedResources
  ]);
  if (!resource?.id) return evidenceResources.length ? { evidenceResources } : {};
  const metadata: Partial<ContextToolCall> = {
    evidenceResourceId: resource.id,
    evidenceResourceUri: resource.uri,
    evidenceResourceTitle: resource.title,
    evidenceResourceDescription: resource.description,
    evidenceReadToolName: resource.readToolName,
    evidenceResources
  };
  return Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== undefined)) as Partial<ContextToolCall>;
}

function evidenceResourcesFromArtifacts(artifacts: string[] = []): NonNullable<ContextToolCall["evidenceResources"]> {
  const resources: NonNullable<ContextToolCall["evidenceResources"]> = [];
  for (const rawArtifact of artifacts) {
    const artifact = sanitizeText(rawArtifact);
    const normalizedArtifact = artifact.replaceAll("\\", "/").toLowerCase();
    const resource = VISUAL_HIVE_EVIDENCE_RESOURCES.find((candidate) => normalizedArtifact === candidate.relativePath.toLowerCase());
    if (resource) {
      resources.push({
        evidenceResourceId: resource.id,
        evidenceResourceUri: resource.uri,
        evidenceResourceTitle: resource.title,
        evidenceResourceDescription: resource.description,
        evidenceReadToolName: resource.readTool?.name,
        artifactPath: resource.relativePath
      });
    }
  }
  return uniqueEvidenceResources(resources);
}

function uniqueEvidenceResources(resources: NonNullable<ContextToolCall["evidenceResources"]>): NonNullable<ContextToolCall["evidenceResources"]> {
  const seen = new Set<string>();
  return resources.filter((resource) => {
    const key = `${resource.evidenceResourceId}:${resource.artifactPath}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function providerUsageFor(providerResults: unknown, providerUploadManifest: unknown): ContextProviderUsage[] {
  const fromResults = providerUsagesFromResults(providerResults);
  const fromManifest = providerUsageFromManifest(providerUploadManifest);
  if (!fromManifest) return fromResults;
  const index = fromResults.findIndex((provider) => provider.providerId === fromManifest.providerId);
  if (index === -1) return [...fromResults, fromManifest];
  const merged = [...fromResults];
  merged[index] = {
    ...merged[index],
    uploadStatus: fromManifest.uploadStatus,
    artifactCount: Math.max(merged[index]?.artifactCount ?? 0, fromManifest.artifactCount),
    stagedArtifacts: numberOr(merged[index]?.stagedArtifacts, fromManifest.stagedArtifacts),
    uploadedArtifacts: numberOr(merged[index]?.uploadedArtifacts, fromManifest.uploadedArtifacts),
    estimatedExternalScreenshots: Math.max(merged[index]?.estimatedExternalScreenshots ?? 0, fromManifest.estimatedExternalScreenshots),
    externalCallsMade: Math.max(merged[index]?.externalCallsMade ?? 0, fromManifest.externalCallsMade),
    blockedReasons: unique([...(merged[index]?.blockedReasons ?? []), ...fromManifest.blockedReasons]),
    artifacts: unique([...(merged[index]?.artifacts ?? []), ...fromManifest.artifacts]),
    manifestPath: fromManifest.manifestPath ?? merged[index]?.manifestPath,
    uploadDirectory: fromManifest.uploadDirectory ?? merged[index]?.uploadDirectory,
    command: fromManifest.command ?? merged[index]?.command,
    stdout: fromManifest.stdout ?? merged[index]?.stdout,
    stderr: fromManifest.stderr ?? merged[index]?.stderr,
    providerUrl: fromManifest.providerUrl ?? merged[index]?.providerUrl,
    dryRun: fromManifest.dryRun ?? merged[index]?.dryRun
  };
  return merged;
}

function providerUsagesFromResults(input: unknown): ContextProviderUsage[] {
  const providers = arrayAt(input, "providers");
  return providers
    .map((record) => objectAt(record, "result") ?? objectAt(record))
    .filter((record): record is Record<string, unknown> => Boolean(record))
    .map((record) => {
      const normalized = objectAt(record, "normalized");
      const costPolicy = objectAt(record, "costPolicy");
      const upload = objectAt(record, "upload");
      return {
        providerId: sanitizeText(stringOr(record.providerId, "unknown-provider")),
        status: sanitizeText(stringOr(record.status, "unknown")),
        uploadStatus: sanitizeOptionalString(upload?.status),
        artifactCount: numberOr(record.artifactCount, 0),
        stagedArtifacts: optionalNumber(upload?.stagedArtifacts),
        uploadedArtifacts: optionalNumber(upload?.uploadedArtifacts),
        estimatedExternalScreenshots: numberOr(record.estimatedExternalScreenshots, costPolicy?.estimatedExternalScreenshots, 0),
        externalCallsMade: numberOr(upload?.externalCallsMade, normalized?.externalCallsMade, record.externalCallsMade, 0),
        estimatedCostUsd: numberOr(record.estimatedCostUsd, 0),
        missingEnv: stringArray(record.missingEnv),
        blockedReasons: unique([...stringArray(record.externalUploadBlockedReasons), ...stringArray(costPolicy?.blockedReasons), ...stringArray(upload?.blockedReasons)]),
        artifacts: unique([".visual-hive/provider-results.json", sanitizeOptionalString(upload?.manifestPath), sanitizeOptionalString(upload?.uploadDirectory)].filter(Boolean) as string[]),
        manifestPath: sanitizeOptionalString(upload?.manifestPath),
        uploadDirectory: sanitizeOptionalString(upload?.uploadDirectory),
        command: sanitizeOptionalString(upload?.command),
        stdout: sanitizeOptionalString(upload?.stdout),
        stderr: sanitizeOptionalString(upload?.stderr),
        providerUrl: sanitizeOptionalString(upload?.providerUrl)
      };
    });
}

function providerUsageFromManifest(input: unknown): ContextProviderUsage | undefined {
  const manifest = objectAt(input);
  if (!manifest) return undefined;
  const summary = objectAt(manifest, "summary");
  const status = stringOr(manifest.status, "unknown");
  return {
    providerId: sanitizeText(stringOr(manifest.providerId, "argos")),
    status: sanitizeText(status),
    uploadStatus: sanitizeText(status),
    artifactCount: numberOr(summary?.stagedArtifacts, summary?.uploadedArtifacts, manifest.artifactCount, 0),
    stagedArtifacts: optionalNumber(summary?.stagedArtifacts),
    uploadedArtifacts: optionalNumber(summary?.uploadedArtifacts),
    estimatedExternalScreenshots: numberOr(summary?.stagedArtifacts, manifest.estimatedExternalScreenshots, 0),
    externalCallsMade: numberOr(manifest.externalCallsMade, 0),
    estimatedCostUsd: numberOr(manifest.estimatedCostUsd, 0),
    missingEnv: stringArray(manifest.missingEnv),
    blockedReasons: stringArray(manifest.blockedReasons),
    artifacts: [".visual-hive/provider-upload/argos/manifest.json"],
    manifestPath: ".visual-hive/provider-upload/argos/manifest.json",
    uploadDirectory: ".visual-hive/provider-upload/argos",
    command: sanitizeOptionalString(manifest.command),
    stdout: sanitizeOptionalString(manifest.stdout),
    stderr: sanitizeOptionalString(manifest.stderr),
    providerUrl: sanitizeOptionalString(manifest.providerUrl),
    dryRun: Boolean(manifest.dryRun)
  };
}

function llmUsageFor(input: unknown): ContextLlmUsage[] {
  const report = objectAt(input);
  if (!report) return [];
  const records = arrayAt(report, "records");
  return records.map((record) => {
    const budget = objectAt(record, "budget");
    return {
      task: sanitizeText(stringOr((record as Record<string, unknown>).task, "unknown")),
      promptOnly: Boolean((record as Record<string, unknown>).promptOnly ?? true),
      callsMade: numberOr((record as Record<string, unknown>).callsMade, 0),
      estimatedPromptTokens: numberOr((record as Record<string, unknown>).estimatedTokens, (record as Record<string, unknown>).estimatedPromptTokens, 0),
      estimatedCompletionTokens: optionalNumber((record as Record<string, unknown>).estimatedCompletionTokens),
      estimatedCostUsd: numberOr((record as Record<string, unknown>).estimatedCostUsd, 0),
      budgetStatus: sanitizeOptionalString((record as Record<string, unknown>).status ?? budget?.status),
      artifact: sanitizeOptionalString((record as Record<string, unknown>).path)
    };
  });
}

function hiveHandoffUsageFor(input: {
  handoffPacket: unknown;
  hiveBeadRequest: unknown;
  hiveHandoffResult: unknown;
  sourceArtifacts: ContextLedgerSourceArtifacts;
}): { status?: string; externalCallsMade: number; blockedReasons: string[]; artifacts: string[] } {
  const handoff = objectAt(input.handoffPacket);
  const beadRequest = objectAt(input.hiveBeadRequest);
  const result = objectAt(input.hiveHandoffResult);
  const artifacts = [
    input.sourceArtifacts.handoffPacket,
    input.sourceArtifacts.hiveBeadRequest,
    input.sourceArtifacts.hiveHandoffResult
  ].filter(Boolean) as string[];
  return {
    status: sanitizeOptionalString(result?.status ?? handoff?.status),
    externalCallsMade: numberOr(result?.externalCallsMade, beadRequest?.externalCallsMade, handoff?.externalCallsMade, 0),
    blockedReasons: unique([...stringArray(result?.blockedReasons), ...stringArray(handoff?.blockedReasons)]),
    artifacts
  };
}

function escalationsFor(input: {
  toolCalls: ContextToolCall[];
  providerUsage: ContextProviderUsage[];
  llmUsage: ContextLlmUsage[];
  hiveHandoffUsage: ReturnType<typeof hiveHandoffUsageFor>;
  usage: ContextLedger["usage"];
  sourceArtifacts: ContextLedgerSourceArtifacts;
}): ContextEscalation[] {
  const escalations: ContextEscalation[] = [];
  for (const call of input.toolCalls) {
    if (call.trustedOnly) {
      escalations.push(escalation("trusted_tool", "warning", `Tool ${call.toolId} requires trusted mode.`, [call.toolId], call.artifacts));
    }
    if (call.externalNetwork) {
      escalations.push(escalation("external_network", "warning", `Tool ${call.toolId} can use external network access.`, [call.toolId], call.artifacts));
    }
  }
  for (const provider of input.providerUsage) {
    if (
      ["blocked", "missing_credentials", "failed", "uploaded"].includes(provider.uploadStatus ?? provider.status) ||
      provider.missingEnv.length > 0 ||
      provider.blockedReasons.length > 0
    ) {
      escalations.push(
        escalation(
          "provider",
          provider.status === "uploaded" || provider.uploadStatus === "dry_run" ? "warning" : "blocked",
          `${provider.providerId} provider status is ${provider.uploadStatus ?? provider.status}.`,
          ["visual_hive_provider_upload"],
          provider.artifacts
        )
      );
    }
  }
  for (const llm of input.llmUsage) {
    if (llm.callsMade > 0) {
      escalations.push(escalation("llm", "warning", `LLM task ${llm.task} recorded ${llm.callsMade} external call(s).`, [], [llm.artifact].filter(Boolean) as string[]));
    }
  }
  if (input.usage.externalCallsMade > 0) {
    escalations.push(
      escalation("external_network", "warning", `Recorded ${input.usage.externalCallsMade} external call(s) across providers or LLM usage.`, [], [
        input.sourceArtifacts.providerResults,
        input.sourceArtifacts.llmUsage
      ].filter(Boolean) as string[])
    );
  }
  if (input.hiveHandoffUsage.status === "blocked" || input.hiveHandoffUsage.blockedReasons.length > 0) {
    escalations.push(
      escalation(
        "trusted_tool",
        "blocked",
        `Hive handoff is blocked: ${input.hiveHandoffUsage.blockedReasons.join("; ") || "status=blocked"}.`,
        ["visual_hive_handoff"],
        input.hiveHandoffUsage.artifacts
      )
    );
  }
  if (input.hiveHandoffUsage.externalCallsMade > 0) {
    escalations.push(
      escalation(
        "external_network",
        "warning",
        `Hive handoff recorded ${input.hiveHandoffUsage.externalCallsMade} external call(s).`,
        ["visual_hive_handoff"],
        input.hiveHandoffUsage.artifacts
      )
    );
  }
  return uniqueEscalations(escalations);
}

function policyViolationsFor(input: {
  budgets: ContextLedgerBudgets;
  usage: ContextLedger["usage"];
  sourceArtifacts: ContextLedgerSourceArtifacts;
}): ContextPolicyViolation[] {
  const violations: ContextPolicyViolation[] = [];
  if (input.usage.toolCallsUsed > input.budgets.maxToolCalls) {
    violations.push(policyViolation("maxToolCalls", "blocked", `Tool calls ${input.usage.toolCallsUsed} exceed budget ${input.budgets.maxToolCalls}.`, input.sourceArtifacts.pipeline));
  }
  if (input.usage.estimatedToolResultTokens > input.budgets.maxToolResultTokens) {
    violations.push(
      policyViolation(
        "maxToolResultTokens",
        "warning",
        `Estimated tool result tokens ${input.usage.estimatedToolResultTokens} exceed budget ${input.budgets.maxToolResultTokens}.`,
        input.sourceArtifacts.pipeline
      )
    );
  }
  if (input.usage.estimatedExternalCostUsd > input.budgets.maxExternalCostUsd) {
    violations.push(
      policyViolation(
        "maxExternalCostUsd",
        "blocked",
        `Estimated external cost $${input.usage.estimatedExternalCostUsd} exceeds budget $${input.budgets.maxExternalCostUsd}.`,
        input.sourceArtifacts.llmUsage
      )
    );
  }
  if (input.usage.providerScreenshots > input.budgets.maxProviderScreenshots) {
    violations.push(
      policyViolation(
        "maxProviderScreenshots",
        "blocked",
        `Provider screenshots ${input.usage.providerScreenshots} exceed budget ${input.budgets.maxProviderScreenshots}.`,
        input.sourceArtifacts.providerResults
      )
    );
  }
  return violations;
}

async function existingSources(rootDir: string, paths: Record<keyof ContextLedgerSourceArtifacts, string>): Promise<ContextLedgerSourceArtifacts> {
  const entries = await Promise.all(
    Object.entries(paths).map(async ([key, filePath]) => {
      try {
        await access(filePath);
        return [key, toRepoRelative(rootDir, filePath)] as const;
      } catch {
        return [key, undefined] as const;
      }
    })
  );
  return Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => Boolean(entry[1]))) as ContextLedgerSourceArtifacts;
}

async function readOptionalJson<T>(filePath: string): Promise<T | undefined> {
  try {
    return await readJson<T>(filePath);
  } catch {
    return undefined;
  }
}

function sanitizeLedger(ledger: ContextLedger): ContextLedger {
  return sanitizeValue(ledger) as ContextLedger;
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === "string") return sanitizeText(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item));
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, sanitizeValue(child)]));
  return value;
}

function artifactPath(rootDir: string, filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(rootDir, filePath);
}

function toRepoRelative(rootDir: string, filePath: string): string {
  return path.relative(rootDir, filePath).replaceAll("\\", "/");
}

function estimateToolResultTokens(step: NonNullable<PipelineReportLike["steps"]>[number], artifacts: string[]): number {
  const message = stringOr(step.message, "");
  return Math.ceil((message.length + artifacts.join(" ").length) / 4) + 150;
}

function firstCommandWord(command?: string): string | undefined {
  if (!command) return undefined;
  const parts = command.split(/\s+/).filter(Boolean);
  if (parts[0] !== "visual-hive" || !parts[1]) return undefined;
  return `visual_hive_${parts[1].replaceAll("-", "_")}`;
}

function objectAt(value: unknown, key?: string): Record<string, unknown> | undefined {
  const candidate = key && isRecord(value) ? value[key] : value;
  return isRecord(candidate) ? candidate : undefined;
}

function arrayAt(value: unknown, key: string): unknown[] {
  const candidate = isRecord(value) ? value[key] : undefined;
  return Array.isArray(candidate) ? candidate : [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => sanitizeText(String(item))).filter(Boolean) : [];
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value ? value : fallback;
}

function sanitizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value ? sanitizeText(value) : undefined;
}

function numberOr(...values: unknown[]): number {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return 0;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean).map((value) => sanitizeText(value)))].sort();
}

function escalation(
  kind: ContextEscalation["kind"],
  severity: ContextEscalation["severity"],
  reason: string,
  relatedToolIds: string[],
  artifacts: string[]
): ContextEscalation {
  return {
    kind,
    severity,
    reason: sanitizeText(reason),
    relatedToolIds: unique(relatedToolIds),
    artifacts: unique(artifacts)
  };
}

function uniqueEscalations(escalations: ContextEscalation[]): ContextEscalation[] {
  const seen = new Set<string>();
  return escalations.filter((item) => {
    const key = `${item.kind}:${item.severity}:${item.reason}:${item.relatedToolIds.join(",")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function policyViolation(policy: string, severity: "warning" | "blocked", reason: string, artifact?: string): ContextPolicyViolation {
  return {
    policy,
    severity,
    reason: sanitizeText(reason),
    artifacts: artifact ? [sanitizeText(artifact)] : []
  };
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
