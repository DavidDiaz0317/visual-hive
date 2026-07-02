import path from "node:path";
import { sanitizeText } from "../utils/sanitize.js";
import { readJson, writeJson } from "../utils/files.js";
import type { EvidencePacket } from "../evidence/types.js";
import type { HandoffPacket, HandoffWorkItem } from "../handoff/types.js";
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
    ".visual-hive/evidence-summary.md",
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
      handoffPacket: options.handoffPacketPath ? normalize(options.handoffPacketPath) : undefined
    },
    verdict: options.evidencePacket.verdictSummary,
    evidenceSummary: {
      gatingContributions: gatingContributions.slice(0, 12),
      advisoryContributions: advisoryContributions.slice(0, 12),
      workItems,
      selectedContracts: options.evidencePacket.deterministicReport?.selectedContracts ?? options.evidencePacket.plan?.selectedContracts ?? [],
      selectedTargets: options.evidencePacket.deterministicReport?.selectedTargets.map((target) => target.id) ?? options.evidencePacket.plan?.selectedTargets ?? [],
      mutationScore: options.evidencePacket.mutation?.score,
      testingLayers: options.evidencePacket.testingLayers
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
  return `Review Visual Hive evidence and governance for ${evidence.project}.`;
}

function allowedToolsFor(profile: AgentPacketProfile): AgentToolPermission[] {
  const common: AgentToolPermission[] = [
    tool("visual_hive_read_evidence_packet", "Read Evidence Packet", "read_only", "Primary sanitized evidence source."),
    tool("visual_hive_read_latest_report", "Read latest report", "read_only", "Inspect deterministic evidence without scraping logs."),
    tool("visual_hive_list_reproduction_commands", "List reproduction commands", "read_only", "Find focused commands for human-approved reruns.")
  ];
  if (profile === "repair_agent") {
    return [...common, tool("visual_hive_run_focused_local", "Run focused local check", "local_execution", "Allowed only in local/trusted development, not PR writes.")];
  }
  if (profile === "test_creator") {
    return [
      ...common,
      tool("visual_hive_read_mutation_report", "Read mutation report", "read_only", "Use survived mutations as concrete missing-test signals."),
      tool("visual_hive_generate_config_diff", "Generate guarded config diff", "read_only", "Preview contract additions before human approval.")
    ];
  }
  if (profile === "handoff_agent") {
    return [
      ...common,
      tool("visual_hive_read_handoff_packet", "Read Handoff Packet", "read_only", "Use the compact trusted handoff object."),
      tool("visual_hive_generate_handoff_dry_run", "Regenerate handoff dry run", "read_only", "Writes local artifacts only.")
    ];
  }
  return [...common, tool("visual_hive_read_artifacts_index", "Read artifact index", "read_only", "Inspect sanitized artifact inventory.")];
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
  if (profile === "test_creator") return [...common, "weaken_thresholds_to_hide_failures", "remove_failing_contracts_without_replacement"];
  if (profile === "repair_agent") return [...common, "skip_failing_contracts_without_policy_reason"];
  return [...common, "merge_or_approve_pull_requests"];
}

function budgetsFor(profile: AgentPacketProfile): AgentPacket["budgets"] {
  const maxToolCalls = profile === "review_agent" ? 12 : profile === "handoff_agent" ? 10 : 20;
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
  return [...common, "Assess whether evidence, schemas, docs, and tests moved together.", "Report residual risk clearly."];
}

function tool(id: string, label: string, access: AgentToolPermission["access"], reason: string): AgentToolPermission {
  return { id, label, access, reason };
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
