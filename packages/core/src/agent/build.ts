import path from "node:path";
import { sanitizeText } from "../utils/sanitize.js";
import { readJson, writeJson } from "../utils/files.js";
import type { EvidencePacket } from "../evidence/types.js";
import type { HandoffPacket, HandoffWorkItem } from "../handoff/types.js";
import { getEvidenceResourceById, getEvidenceResourceByReadToolName } from "../tools/evidenceResources.js";
import type { AgentPacket, AgentPacketProfile, AgentToolPermission, BuildAgentPacketOptions } from "./types.js";

const HUMAN_APPROVAL = [
  "github_issue_creation",
  "hive_bead_creation",
  "provider_upload_enablement",
  "baseline_approval",
  "protected_target_run",
  "workflow_write",
  "external_network_access"
];

export async function readHandoffPacket(filePath: string): Promise<HandoffPacket> {
  const packet = await readJson<HandoffPacket>(filePath);
  if (packet.schemaVersion !== "visual-hive.handoff.v1") {
    throw new Error(`Unsupported Handoff Packet schema at ${filePath}: ${String(packet.schemaVersion)}`);
  }
  return sanitizeValue(packet) as HandoffPacket;
}

export function buildAgentPacket(options: BuildAgentPacketOptions): AgentPacket {
  const profile = options.profile ?? "repair_agent";
  const gatingContributions = options.evidencePacket.evidenceContributions.filter((contribution) => contribution.gating);
  const advisoryContributions = options.evidencePacket.evidenceContributions.filter((contribution) => !contribution.gating);
  const workItems = workItemsFor(profile, options.evidencePacket, options.handoffPacket);
  const artifactPointers = dedupe([
    normalize(options.evidencePacketPath),
    options.handoffPacketPath ? normalize(options.handoffPacketPath) : undefined,
    options.testCreationPlanPath ? normalize(options.testCreationPlanPath) : undefined,
    options.runHistoryPath ? normalize(options.runHistoryPath) : undefined,
    ".visual-hive/evidence-summary.md",
    ".visual-hive/test-creation-plan.json",
    ".visual-hive/report.json",
    ".visual-hive/mutation-report.json",
    ".visual-hive/triage.json",
    ".visual-hive/hive-issue.md",
    ...workItems.flatMap((item) => item.artifacts),
    ...(options.evidencePacket.deterministicReport?.screenshotEvidence.flatMap((screenshot) => [screenshot.actualPath, screenshot.diffPath, screenshot.baselinePath]) ?? [])
  ]);

  return sanitizeValue({
    schemaVersion: "visual-hive.agent-packet.v1",
    generatedAt: (options.now ?? new Date()).toISOString(),
    project: options.evidencePacket.project,
    profile,
    objective: objectiveFor(profile, options.evidencePacket, workItems),
    sourceArtifacts: {
      evidencePacket: normalize(options.evidencePacketPath),
      handoffPacket: options.handoffPacketPath ? normalize(options.handoffPacketPath) : undefined,
      testCreationPlan: options.testCreationPlanPath ? normalize(options.testCreationPlanPath) : undefined,
      runHistory: options.runHistoryPath ? normalize(options.runHistoryPath) : undefined
    },
    verdict: options.evidencePacket.verdictSummary,
    evidenceSummary: {
      gatingContributions: gatingContributions.slice(0, 12),
      advisoryContributions: advisoryContributions.slice(0, 12),
      workItems,
      selectedContracts: options.evidencePacket.deterministicReport?.selectedContracts ?? options.evidencePacket.plan?.selectedContracts ?? [],
      selectedTargets: options.evidencePacket.deterministicReport?.selectedTargets.map((target) => target.id) ?? options.evidencePacket.plan?.selectedTargets ?? [],
      mutationScore: options.evidencePacket.mutation?.score,
      providerEvidence: providerEvidenceFor(options.evidencePacket),
      runHistory: runHistoryFor(options),
      testingLayers: options.evidencePacket.testingLayers,
      testCreationRecommendations: (options.testCreationRecommendations ?? []).slice(0, 12)
    },
    allowedTools: allowedToolsFor(profile),
    forbiddenActions: forbiddenActionsFor(profile),
    budgets: budgetsFor(profile),
    reproductionCommands: reproductionCommandsFor(profile, options.evidencePacket),
    artifactPointers,
    instructions: instructionsFor(profile),
    governance: {
      verdictAuthority: "visual_hive",
      agentAuthority: "advisory_repair_only",
      secretPolicy: "redacted_values_names_only",
      requireHumanApprovalFor: HUMAN_APPROVAL
    }
  }) as AgentPacket;
}

export async function writeAgentPacket(
  options: BuildAgentPacketOptions & { rootDir: string; outputPath?: string }
): Promise<{ packet: AgentPacket; packetPath: string }> {
  const packet = buildAgentPacket(options);
  const packetPath = resolve(options.rootDir, options.outputPath ?? ".visual-hive/agent-packet.json");
  await writeJson(packetPath, packet);
  return { packet, packetPath };
}

function workItemsFor(profile: AgentPacketProfile, evidence: EvidencePacket, handoff?: HandoffPacket): HandoffWorkItem[] {
  const handoffItems = handoff?.workItems ?? [];
  if (profile === "repair_agent") {
    return handoffItems.filter((item) => item.kind === "repair" || item.kind === "setup").slice(0, 8);
  }
  if (profile === "test_creator") {
    const fromHandoff = handoffItems.filter((item) => item.kind === "test_creation");
    const mutationItems = evidence.mutation?.survivedOperators.map<HandoffWorkItem>((operator) => ({
      id: `mutation-${operator.operator}`,
      kind: "test_creation",
      priority: "high",
      title: `Add contract coverage for ${operator.operator}`,
      summary: operator.failedAssertion ?? `${operator.operator} survived mutation adequacy checks.`,
      evidenceKeys: [`mutation.mutation_survivor.${operator.operator}`],
      artifacts: operator.artifacts.length ? operator.artifacts : [".visual-hive/mutation-report.json"],
      suggestedNextSteps: ["Add selector, text, visual, or flow assertions.", "Map the mutation operator to the intended contract.", "Rerun `visual-hive mutate`."]
    })) ?? [];
    return dedupeWorkItems([...fromHandoff, ...mutationItems]).slice(0, 8);
  }
  if (profile === "handoff_agent") {
    return handoffItems.slice(0, 10);
  }
  if (profile === "provider_specialist") {
    return [
      {
        id: "review-provider-evidence",
        kind: "review",
        priority: evidence.providers.some((provider) => provider.upload?.status === "failed" || provider.status === "failed") ? "high" : "medium",
        title: "Review optional provider evidence",
        summary: `Review ${evidence.providers.length} provider evidence record(s) without enabling uploads or changing verdict policy.`,
        evidenceKeys: evidence.providers.map((provider) => `provider.${provider.providerId}`).slice(0, 10),
        artifacts: dedupe([
          ".visual-hive/provider-results.json",
          ...evidence.providers.flatMap((provider) => [provider.upload?.manifestPath, provider.upload?.uploadDirectory])
        ]),
        suggestedNextSteps: [
          "Confirm provider evidence is sanitized.",
          "Check blocked reasons, missing credential names, and upload policy.",
          "Do not enable external upload or gating without trusted policy and human approval."
        ]
      }
    ];
  }
  return handoffItems.length
    ? handoffItems.slice(0, 10)
    : [
        {
          id: "review-evidence",
          kind: "review",
          priority: evidence.verdictSummary.visualHiveVerdict === "passed" ? "low" : "medium",
          title: "Review Visual Hive evidence",
          summary: `Review ${evidence.evidenceContributions.length} evidence contribution(s) and verify governance posture.`,
          evidenceKeys: [...evidence.verdictSummary.failedBecause, ...evidence.verdictSummary.warningBecause].slice(0, 10),
          artifacts: [".visual-hive/evidence-packet.json", ".visual-hive/evidence-summary.md"],
          suggestedNextSteps: ["Review gating and advisory evidence.", "Confirm artifacts are sanitized.", "Recommend the next automation hardening step."]
        }
      ];
}

function objectiveFor(profile: AgentPacketProfile, evidence: EvidencePacket, workItems: HandoffWorkItem[]): string {
  const first = workItems[0]?.title;
  if (profile === "repair_agent") {
    if (first && workItems[0]?.kind === "setup") return `Resolve Visual Hive setup or evidence gap: ${first}`;
    if (first) return `Repair Visual Hive failure: ${first}`;
    return evidence.verdictSummary.visualHiveVerdict === "passed"
      ? `Review passing Visual Hive evidence for ${evidence.project} and identify the next safe hardening step.`
      : `Repair deterministic failures for ${evidence.project}.`;
  }
  if (profile === "test_creator") return first ? `Improve Visual Hive test adequacy: ${first}` : `Add missing Visual Hive contracts for ${evidence.project}.`;
  if (profile === "handoff_agent") return `Prepare trusted handoff for ${evidence.project} without executing untrusted code.`;
  if (profile === "provider_specialist") return `Review optional provider evidence for ${evidence.project} without enabling uploads or changing verdict policy.`;
  return `Review Visual Hive evidence and governance for ${evidence.project}.`;
}

function allowedToolsFor(profile: AgentPacketProfile): AgentToolPermission[] {
  const common: AgentToolPermission[] = [
    evidenceTool("visual_hive_read_evidence_packet", "Primary sanitized evidence source."),
    evidenceTool("visual_hive_read_latest_report", "Inspect deterministic evidence without scraping logs."),
    tool("visual_hive_list_reproduction_commands", "List reproduction commands", "read_only", "Find focused commands for human-approved reruns.")
  ];
  const triageTools = {
    report: () => evidenceTool("visual_hive_read_triage_report", "Inspect deterministic triage classifications and likely causes."),
    issue: () => evidenceTool("visual_hive_read_issue_body", "Inspect sanitized GitHub issue body without creating issues."),
    prComment: () => evidenceTool("visual_hive_read_pr_comment", "Inspect sanitized PR comment markdown without posting comments."),
    triagePrompt: () => evidenceTool("visual_hive_read_triage_prompt", "Inspect advisory triage prompt without calling an LLM."),
    repairPrompt: () => evidenceTool("visual_hive_generate_repair_prompt", "Inspect offline repair prompt without calling an LLM."),
    missingTests: () => evidenceTool("visual_hive_read_missing_tests", "Inspect missing-test recommendations without editing tests or config.")
  };
  if (profile === "repair_agent") {
    return [
      ...common,
      triageTools.report(),
      triageTools.triagePrompt(),
      triageTools.repairPrompt(),
      triageTools.missingTests(),
      tool("visual_hive_run_focused_local", "Run focused local check", "local_execution", "Allowed only in local/trusted development, not PR writes.")
    ];
  }
  if (profile === "test_creator") {
    return [
      ...common,
      triageTools.report(),
      triageTools.missingTests(),
      evidenceTool("visual_hive_read_testing_layers", "Inspect the testing-layer coverage lattice and missing-layer guidance."),
      evidenceTool("visual_hive_read_coverage_recommendations", "Inspect deterministic no-write coverage and config-improvement recommendations."),
      evidenceTool("visual_hive_read_test_creation_plan", "Inspect advisory no-write test-creation recommendations."),
      evidenceTool("visual_hive_read_mutation_report", "Use survived mutations as concrete missing-test signals."),
      tool("visual_hive_generate_config_diff", "Generate guarded config diff", "read_only", "Preview contract additions before human approval.")
    ];
  }
  if (profile === "handoff_agent") {
    return [
      ...common,
      triageTools.report(),
      triageTools.issue(),
      triageTools.prComment(),
      triageTools.missingTests(),
      evidenceTool("visual_hive_generate_handoff_dry_run", "Use the compact trusted handoff object."),
      evidenceTool("visual_hive_validate_handoff", "Inspect no-network handoff validation before trusted workflow consumption."),
      evidenceTool("visual_hive_read_hive_export", "Inspect the Hive-native bundle without calling Hive."),
      evidenceTool("visual_hive_read_hive_beads", "Inspect focused Hive bead work items without creating Beads."),
      evidenceTool("visual_hive_read_hive_knowledge_facts", "Inspect focused Hive knowledge facts before routing agent work."),
      evidenceTool("visual_hive_read_hive_knowledge_graph", "Inspect the Hive evidence graph before routing agent work."),
      evidenceTool("visual_hive_read_hive_repair_work_orders", "Inspect guarded repair work orders without executing repair."),
      evidenceTool("visual_hive_read_hive_agent_policy", "Inspect Hive agent policy and verdict-authority limits."),
      evidenceTool("visual_hive_read_hive_guarded_repair_preview", "Inspect preview-only guarded repair readiness."),
      evidenceTool("visual_hive_read_hive_repair_request_envelope", "Inspect trusted repair requests before any workflow consumes them."),
      evidenceTool("visual_hive_read_hive_trusted_repair_consumer_summary", "Inspect the no-network trusted repair consumer dry run."),
      evidenceTool("visual_hive_read_hive_trusted_repair_workflow_dry_run", "Inspect the no-network future workflow dry run."),
      evidenceTool("visual_hive_read_hive_mode_comparison", "Compare Hive advisory, measured, repair-request, guarded-repair, and full modes."),
      evidenceTool("visual_hive_read_provider_decisions", "Inspect local provider governance decisions without enabling upload."),
      evidenceTool("visual_hive_read_provider_results", "Inspect sanitized provider status without enabling upload."),
      evidenceTool("visual_hive_read_provider_upload_manifest", "Inspect staged upload metadata without making external calls.")
    ];
  }
  if (profile === "provider_specialist") {
    return [
      ...common,
      evidenceTool("visual_hive_read_provider_decisions", "Inspect local provider governance decisions without enabling credentials or uploads."),
      evidenceTool("visual_hive_read_provider_setup_plan", "Inspect provider setup planning without enabling credentials or billing."),
      evidenceTool("visual_hive_read_provider_handoff", "Inspect provider handoff eligibility without uploading artifacts."),
      evidenceTool("visual_hive_read_provider_results", "Inspect normalized provider evidence without enabling upload."),
      evidenceTool("visual_hive_read_provider_upload_manifest", "Inspect staged upload metadata without making external calls."),
      evidenceTool("visual_hive_read_provider_agent_packet", "Inspect the bounded provider-specialist packet itself."),
      tool("visual_hive_provider_handoff_dry_run", "Review provider handoff dry run", "read_only", "Review provider upload eligibility and blocked reasons locally.")
    ];
  }
  return [
    ...common,
    triageTools.report(),
    triageTools.issue(),
    triageTools.prComment(),
    triageTools.triagePrompt(),
    triageTools.repairPrompt(),
    triageTools.missingTests(),
    evidenceTool("visual_hive_read_run_history", "Inspect longitudinal trend evidence without rerunning checks or changing verdict policy."),
    evidenceTool("visual_hive_read_artifacts_index", "Inspect sanitized artifact inventory."),
    evidenceTool("visual_hive_read_provider_results", "Inspect advisory provider evidence when relevant.")
  ];
}

function forbiddenActionsFor(profile: AgentPacketProfile): string[] {
  const common = [
    "decide_visual_hive_verdict",
    "read_secret_values",
    "approve_baselines_without_human_review",
    "upload_to_paid_providers_without_policy_authorization",
    "run_protected_targets_without_approval",
    "execute_untrusted_pull_request_target_code"
  ];
  if (profile === "handoff_agent") return [...common, "create_github_issue_from_untrusted_pr", "create_hive_bead_without_trusted_workflow"];
  if (profile === "provider_specialist") return [...common, "make_provider_gating_by_default", "upload_provider_artifacts_without_trusted_policy", "use_provider_output_as_sole_oracle"];
  if (profile === "test_creator") return [...common, "weaken_thresholds_to_hide_failures", "remove_failing_contracts_without_replacement"];
  if (profile === "repair_agent") return [...common, "skip_failing_contracts_without_policy_reason"];
  return [...common, "merge_or_approve_pull_requests"];
}

function budgetsFor(profile: AgentPacketProfile): AgentPacket["budgets"] {
  const maxToolCalls = profile === "review_agent" ? 12 : profile === "handoff_agent" || profile === "provider_specialist" ? 10 : 20;
  return {
    maxToolCalls,
    maxToolResultTokens: profile === "test_creator" || profile === "repair_agent" ? 12000 : 8000,
    maxExternalCostUsd: 0,
    allowExternalNetwork: false
  };
}

function reproductionCommandsFor(profile: AgentPacketProfile, evidence: EvidencePacket): string[] {
  const commands = evidence.deterministicReport?.reproductionCommands ?? [];
  if (profile === "test_creator") return dedupe([...commands, "visual-hive mutate", "visual-hive improve-coverage"]);
  if (profile === "handoff_agent") return ["visual-hive evidence", "visual-hive handoff --dry-run", "visual-hive agent-packet --profile handoff_agent"];
  if (profile === "provider_specialist") return ["visual-hive providers list", "visual-hive providers plan --provider argos", "visual-hive providers handoff --provider argos", "visual-hive providers upload --provider argos --dry-run"];
  return commands.length ? commands : ["visual-hive plan", "visual-hive run", "visual-hive triage"];
}

function instructionsFor(profile: AgentPacketProfile): string[] {
  const common = [
    "Use the Evidence Packet as the source of truth.",
    "Do not decide pass/fail; Visual Hive's deterministic Verdict Engine owns the verdict.",
    "Do not expose secret values.",
    "Prefer focused artifact reads over broad repository context loading."
  ];
  if (profile === "repair_agent") return [...common, "Repair the app or contract only when deterministic evidence supports the change.", "Rerun focused Visual Hive checks after changes."];
  if (profile === "test_creator") return [...common, "Use mutation survivors and coverage gaps as concrete missing-test signals.", "Do not weaken thresholds to make failures disappear."];
  if (profile === "handoff_agent") return [...common, "Create external work items only from trusted sanitized artifacts.", "Do not execute PR code."];
  if (profile === "provider_specialist") return [...common, "Treat provider output as advisory unless normalized trusted gating is explicitly configured.", "Do not upload externally or enable paid providers from this packet."];
  return [...common, "Assess whether evidence, schemas, docs, and tests moved together.", "Report residual risk clearly."];
}

function providerEvidenceFor(evidence: EvidencePacket): AgentPacket["evidenceSummary"]["providerEvidence"] {
  return evidence.providers.map((provider) => ({
    providerId: provider.providerId,
    status: provider.status,
    deterministicRole: provider.deterministicRole,
    message: provider.message,
    artifactCount: provider.artifactCount,
    missingEnv: provider.missingEnv,
    uploadStatus: provider.upload?.status,
    externalCallsMade: provider.upload?.externalCallsMade ?? 0,
    stagedArtifacts: provider.upload?.stagedArtifacts,
    uploadedArtifacts: provider.upload?.uploadedArtifacts,
    manifestPath: provider.upload?.manifestPath,
    uploadDirectory: provider.upload?.uploadDirectory,
    providerUrl: provider.upload?.providerUrl,
    blockedReasons: provider.upload?.blockedReasons ?? provider.externalUploadBlockedReasons ?? []
  }));
}

function runHistoryFor(options: BuildAgentPacketOptions): AgentPacket["evidenceSummary"]["runHistory"] {
  if (!options.runHistory) return undefined;
  const resource = getEvidenceResourceById("run-history");
  if (!resource?.readTool) {
    throw new Error("Agent Packet run-history evidence resource is not registered in the shared evidence-resource catalog.");
  }
  return {
    artifactPath: normalize(options.runHistoryPath ?? resource.relativePath),
    evidenceResourceId: resource.id as "run-history",
    evidenceResourceUri: resource.uri as "visual-hive://run-history",
    evidenceReadToolName: resource.readTool.name as "visual_hive_read_run_history",
    authority: "trend_evidence_only",
    runCount: options.runHistory.summary.runCount,
    latestStatus: options.runHistory.summary.latestStatus,
    latestRecordedAt: options.runHistory.summary.latestRecordedAt,
    latestMutationScore: options.runHistory.summary.latestMutationScore,
    trendDirection: options.runHistory.trend.direction,
    trendReasons: options.runHistory.trend.reasons.slice(0, 5),
    totalVisualDiffs: options.runHistory.summary.totalVisualDiffs,
    totalMissingBaselines: options.runHistory.summary.totalMissingBaselines,
    totalCreatedBaselines: options.runHistory.summary.totalCreatedBaselines
  };
}

function tool(id: string, label: string, access: AgentToolPermission["access"], reason: string): AgentToolPermission {
  const resource = access === "read_only" ? getEvidenceResourceByReadToolName(id) : undefined;
  return {
    id,
    label,
    access,
    reason,
    evidenceResourceId: resource?.id,
    evidenceResourceUri: resource?.uri,
    evidenceResourceTitle: resource?.title,
    evidenceResourceDescription: resource?.description,
    evidenceReadToolName: resource?.readTool?.name,
    artifactPath: resource?.relativePath
  };
}

function evidenceTool(id: string, reason: string): AgentToolPermission {
  const resource = getEvidenceResourceByReadToolName(id);
  if (!resource?.readTool) {
    throw new Error(`Agent Packet read tool ${id} is not registered in the shared evidence-resource catalog.`);
  }
  return tool(resource.readTool.name, resource.readTool.title, "read_only", reason);
}

function dedupe(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)).map((value) => sanitizeText(value)))];
}

function dedupeWorkItems(items: HandoffWorkItem[]): HandoffWorkItem[] {
  const seen = new Set<string>();
  const result: HandoffWorkItem[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    result.push(item);
  }
  return result;
}

function normalize(value: string): string {
  return value.replaceAll("\\", "/");
}

function resolve(rootDir: string, artifactPath: string): string {
  return path.isAbsolute(artifactPath) ? artifactPath : path.resolve(rootDir, artifactPath);
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === "string") return sanitizeText(value);
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeValue(item)]));
  }
  return value;
}
