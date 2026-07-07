import path from "node:path";
import { sanitizeText } from "../utils/sanitize.js";
import { writeJson, writeText } from "../utils/files.js";
import { getEvidenceResourceById, type EvidenceResourceDefinition } from "./evidenceResources.js";
import type { ToolAccess, ToolCostClass, ToolKind, ToolMode, ToolRegistry, ToolRegistryEntry, ToolRole, ToolRoleProfile } from "./types.js";

const HUMAN_APPROVAL = [
  "provider_upload_enablement",
  "baseline_approval",
  "github_issue_creation",
  "hive_bead_creation",
  "paid_provider_connection",
  "protected_target_run",
  "workflow_write",
  "external_network_access"
];

const MAX_TOOL_DEFINITIONS_PER_AGENT = 8;

const ROLE_TOOL_PRIORITY: Record<ToolRole, string[]> = {
  setup_agent: [
    "visual_hive_validate_config",
    "visual_hive_doctor",
    "visual_hive_recommend_setup",
    "visual_hive_read_setup_recommendations",
    "visual_hive_read_setup_pr_plan",
    "visual_hive_plan",
    "visual_hive_read_control_plane_snapshot",
    "visual_hive_agent_packet"
  ],
  repair_agent: [
    "visual_hive_get_issue_context",
    "visual_hive_query_visual_graph",
    "visual_hive_get_visual_impact",
    "visual_hive_read_evidence_packet",
    "visual_hive_read_control_plane_snapshot",
    "visual_hive_read_verdict",
    "visual_hive_read_visual_graph",
    "visual_hive_read_visual_graph_impact",
    "visual_hive_read_latest_report",
    "visual_hive_read_triage_report",
    "visual_hive_get_validation_command",
    "visual_hive_get_agent_prompt",
    "visual_hive_generate_repair_prompt",
    "visual_hive_read_missing_tests",
    "visual_hive_list_reproduction_commands",
    "visual_hive_read_agent_packet"
  ],
  test_creator: [
    "visual_hive_get_issue_context",
    "visual_hive_query_visual_graph",
    "visual_hive_get_visual_impact",
    "visual_hive_read_evidence_packet",
    "visual_hive_read_control_plane_snapshot",
    "visual_hive_read_verdict",
    "visual_hive_read_visual_graph",
    "visual_hive_read_visual_graph_impact",
    "visual_hive_read_missing_tests",
    "visual_hive_read_testing_layers",
    "visual_hive_read_coverage_recommendations",
    "visual_hive_read_test_creation_plan",
    "visual_hive_get_validation_command",
    "visual_hive_read_mutation_report"
  ],
  review_agent: [
    "visual_hive_list_issues",
    "visual_hive_get_issue_context",
    "visual_hive_read_evidence_packet",
    "visual_hive_read_control_plane_snapshot",
    "visual_hive_read_verdict",
    "visual_hive_read_latest_report",
    "visual_hive_read_visual_graph",
    "visual_hive_read_visual_graph_impact",
    "visual_hive_list_artifacts",
    "visual_hive_read_triage_report",
    "visual_hive_read_baseline_review",
    "visual_hive_read_run_history",
    "visual_hive_read_context_ledger"
  ],
  handoff_agent: [
    "visual_hive_list_issues",
    "visual_hive_get_issue_context",
    "visual_hive_read_evidence_packet",
    "visual_hive_read_control_plane_snapshot",
    "visual_hive_read_verdict",
    "visual_hive_read_issue_queue",
    "visual_hive_query_visual_graph",
    "visual_hive_get_handoff_context",
    "visual_hive_read_visual_graph",
    "visual_hive_read_visual_graph_impact",
    "visual_hive_read_issue_candidates",
    "visual_hive_read_triage_report",
    "visual_hive_read_issue_body",
    "visual_hive_read_pr_comment",
    "visual_hive_get_validation_command",
    "visual_hive_generate_handoff_dry_run",
    "visual_hive_validate_handoff"
  ],
  provider_specialist: [
    "visual_hive_read_provider_decisions",
    "visual_hive_read_provider_results",
    "visual_hive_read_provider_upload_manifest",
    "visual_hive_read_provider_agent_packet",
    "visual_hive_provider_handoff_dry_run",
    "visual_hive_read_evidence_packet",
    "visual_hive_read_control_plane_snapshot",
    "visual_hive_read_verdict",
    "visual_hive_read_context_ledger"
  ]
};

export interface BuildToolRegistryOptions {
  project: string;
  now?: Date;
}

export interface WriteToolRegistryOptions extends BuildToolRegistryOptions {
  rootDir: string;
  registryPath?: string;
  cardsPath?: string;
}

export function buildToolRegistry(options: BuildToolRegistryOptions): ToolRegistry {
  const tools = allTools();
  return sanitizeValue({
    schemaVersion: "visual-hive.tool-registry.v1",
    generatedAt: (options.now ?? new Date()).toISOString(),
    project: options.project,
    policy: {
      defaultPolicy: "gated",
      exposeThirdPartyMcp: false,
      maxToolDefinitionsPerAgent: MAX_TOOL_DEFINITIONS_PER_AGENT,
      maxToolCallsPerTask: 20,
      maxToolResultTokensPerTask: 12000,
      maxExternalCostUsdPerTask: 0,
      requireTrustedModeForWrites: true,
      requireTrustedModeForProviderMcp: true,
      githubWritesFromPr: false,
      externalUploadsFromPr: false,
      baselineApprovalByAgent: false,
      requireHumanApprovalFor: HUMAN_APPROVAL
    },
    tools,
    roleProfiles: roleProfiles(tools),
    notes: [
      "Visual Hive CLI/JSON and Evidence Packet are the default agent interface.",
      "MCP and provider tools are listed for governance but disabled unless explicitly configured later.",
      "LLMs, MCP tools, providers, and agents do not decide pass/fail; Visual Hive's deterministic Verdict Engine owns the verdict.",
      "Secret values must not be exposed; missing secret names may be reported."
    ]
  }) as ToolRegistry;
}

export async function writeToolRegistry(
  options: WriteToolRegistryOptions
): Promise<{ registry: ToolRegistry; registryPath: string; cardsPath: string; cardsMarkdown: string }> {
  const registry = buildToolRegistry(options);
  const registryPath = resolve(options.rootDir, options.registryPath ?? path.join(".visual-hive", "tools", "tool-registry.json"));
  const cardsPath = resolve(options.rootDir, options.cardsPath ?? path.join(".visual-hive", "tools", "tool-cards.md"));
  const cardsMarkdown = renderToolCards(registry);
  await writeJson(registryPath, registry);
  await writeText(cardsPath, cardsMarkdown);
  return { registry, registryPath, cardsPath, cardsMarkdown };
}

export function renderToolCards(registry: ToolRegistry): string {
  const lines = [
    `# Visual Hive Tool Cards: ${registry.project}`,
    "",
    "These cards are compact descriptions for agents. They are not permission grants. The Tool Registry policy remains authoritative.",
    "",
    "## Default Policy",
    "",
    `- Third-party MCP exposed by default: ${registry.policy.exposeThirdPartyMcp}`,
    `- Max tool definitions per agent: ${registry.policy.maxToolDefinitionsPerAgent}`,
    `- Max tool calls per task: ${registry.policy.maxToolCallsPerTask}`,
    `- Max tool result tokens per task: ${registry.policy.maxToolResultTokensPerTask}`,
    `- Max external cost per task: $${registry.policy.maxExternalCostUsdPerTask}`,
    `- External uploads from PR: ${registry.policy.externalUploadsFromPr}`,
    "",
    "## Role Profiles"
  ];

  for (const profile of registry.roleProfiles) {
    lines.push(
      "",
      `### ${profile.role}`,
      "",
      profile.purpose,
      "",
      `Allowed tools: ${profile.allowedToolIds.join(", ")}`,
      `Forbidden actions: ${profile.forbiddenActions.join(", ")}`
    );
  }

  lines.push("", "## Tool Cards");
  for (const tool of registry.tools) {
    lines.push(
      "",
      `### Tool: ${tool.id}`,
      "",
      `Use when: ${tool.description}`,
      `Cost: ${tool.costClass}; access: ${tool.defaultAccess}; trusted only: ${tool.trustedOnly}.`,
      `Allowed roles: ${tool.allowedRoles.join(", ") || "none"}.`,
      `Allowed modes: ${tool.allowedModes.join(", ") || "none"}.`,
      `Reads: ${tool.reads.join(", ") || "none"}.`,
      `Writes: ${tool.writes.join(", ") || "none"}.`,
      `Do not use for: ${tool.writeRestrictions.join("; ") || "unscoped work outside the current Agent Packet."}`
    );
    if (tool.requiresHumanApproval.length) {
      lines.push(`Human approval required for: ${tool.requiresHumanApproval.join(", ")}.`);
    }
    if (tool.notes.length) {
      lines.push(`Notes: ${tool.notes.join(" ")}`);
    }
  }
  return `${sanitizeText(lines.join("\n"))}\n`;
}

function allTools(): ToolRegistryEntry[] {
  return [
    cli("visual_hive_doctor", "Doctor", "Validate config and local prerequisites.", "read_only", "local", ["setup_agent", "review_agent"], ["local", "pr", "schedule", "manual"], "visual-hive doctor", [".visual-hive/readiness.json"]),
    cli("visual_hive_validate_config", "Validate config", "Validate Visual Hive config without executing target code.", "read_only", "local", ["setup_agent", "review_agent"], ["local", "pr", "schedule", "manual"], "visual-hive doctor", []),
    cli("visual_hive_recommend_setup", "Recommend setup", "Inspect repository hints and generate no-network setup recommendations.", "read_only", "local", ["setup_agent", "review_agent"], ["local", "pr"], "visual-hive recommend", [".visual-hive/recommendations.json", ".visual-hive/setup-pr-plan.json"]),
    evidenceCli("setup-recommendations", ["setup_agent", "review_agent"], ["local", "pr", "manual"], { writes: [] }),
    evidenceCli("setup-pr-plan", ["setup_agent", "review_agent"], ["local", "pr", "manual"], { writes: [] }),
    evidenceCli("repo-map", ["setup_agent", "review_agent", "handoff_agent"], ["local", "pr", "schedule", "manual"], { writes: [] }),
    evidenceCli("repo-context", ["setup_agent", "review_agent", "handoff_agent"], ["local", "pr", "schedule", "manual"], { writes: [] }),
    evidenceCli("visual-graph", ["setup_agent", "repair_agent", "test_creator", "review_agent", "handoff_agent"], ["local", "pr", "schedule", "manual"], { writes: [] }),
    evidenceCli("visual-graph-summary", ["setup_agent", "review_agent", "handoff_agent"], ["local", "pr", "schedule", "manual"], { writes: [] }),
    evidenceCli("visual-graph-vocab", ["setup_agent", "repair_agent", "test_creator", "review_agent"], ["local", "pr", "schedule", "manual"], { writes: [] }),
    evidenceCli("visual-graph-unresolved", ["setup_agent", "review_agent", "handoff_agent"], ["local", "pr", "schedule", "manual"], { writes: [] }),
    evidenceCli("visual-graph-impact", ["repair_agent", "test_creator", "review_agent", "handoff_agent"], ["local", "pr", "schedule", "manual"], { writes: [] }),
    cli("visual_hive_plan", "Plan checks", "Plan contracts from changed files, risk, target safety, and cost.", "read_only", "local", ["setup_agent", "repair_agent", "test_creator", "review_agent"], ["local", "pr", "schedule", "manual"], "visual-hive plan", [".visual-hive/plan.json"]),
    evidenceCli("plan-lanes", ["setup_agent", "review_agent", "handoff_agent"], ["local", "pr", "schedule", "manual"], { writes: [] }),
    evidenceCli("latest-report", ["repair_agent", "test_creator", "review_agent", "handoff_agent"], ["local", "pr", "schedule", "manual"]),
    evidenceCli("latest-evidence", ["repair_agent", "test_creator", "review_agent", "handoff_agent", "provider_specialist"], ["local", "pr", "schedule", "manual"]),
    evidenceCli(
      "control-plane-snapshot",
      ["setup_agent", "repair_agent", "test_creator", "review_agent", "handoff_agent", "provider_specialist"],
      ["local", "pr", "schedule", "manual"]
    ),
    evidenceCli("latest-verdict", ["repair_agent", "test_creator", "review_agent", "handoff_agent", "provider_specialist"], ["local", "pr", "schedule", "manual"], {
      writes: []
    }),
    evidenceCli("readiness-gate", ["review_agent", "handoff_agent"], ["local", "pr", "schedule", "manual", "trusted"], { writes: [] }),
    evidenceCli("run-history", ["review_agent", "handoff_agent"], ["local", "pr", "schedule", "manual", "trusted"], { writes: [] }),
    evidenceCli("workflow-audit", ["setup_agent", "review_agent", "handoff_agent"], ["local", "pr", "schedule", "manual", "trusted"], { writes: [] }),
    evidenceCli("path-leak-scan", ["review_agent", "handoff_agent"], ["local", "pr", "schedule", "manual", "trusted"], { writes: [] }),
    evidenceCli("baseline-review", ["repair_agent", "review_agent", "handoff_agent"], ["local", "pr", "schedule", "manual", "trusted"], { writes: [] }),
    evidenceCli("baseline-approvals", ["review_agent", "handoff_agent"], ["local", "schedule", "manual", "trusted"], { writes: [] }),
    evidenceCli("baseline-rejections", ["review_agent", "handoff_agent"], ["local", "schedule", "manual", "trusted"], { writes: [] }),
    evidenceCli("testing-layers", ["test_creator", "review_agent", "handoff_agent"], ["local", "pr", "schedule", "manual"], { writes: [] }),
    evidenceCli("coverage-recommendations", ["test_creator", "review_agent", "handoff_agent"], ["local", "pr", "schedule", "manual"], { writes: [] }),
    evidenceCli("test-creation-plan", ["test_creator", "review_agent", "handoff_agent"], ["local", "pr", "schedule", "manual"], { writes: [] }),
    cli("visual_hive_explain_failure", "Explain failure", "Use triage and report artifacts to explain likely deterministic failure causes.", "read_only", "local", ["repair_agent", "review_agent"], ["local", "pr", "schedule", "manual"], "visual-hive triage", [".visual-hive/triage.json", ".visual-hive/issue.md"]),
    cli("visual_hive_list_reproduction_commands", "List reproduction commands", "List focused commands from reports and Agent Packets.", "read_only", "local", ["repair_agent", "test_creator", "review_agent"], ["local", "pr_debug", "schedule", "manual"], "visual-hive report", [".visual-hive/report.json"]),
    cli(
      "visual_hive_list_issues",
      "List issue candidates",
      "Summarize issue candidates without creating, updating, or closing GitHub issues.",
      "read_only",
      "local",
      ["repair_agent", "test_creator", "review_agent", "handoff_agent"],
      ["local", "pr", "schedule", "manual", "trusted"],
      "visual-hive mcp tool visual_hive_list_issues",
      [],
      { reads: [".visual-hive/issues.json"], evidenceArtifacts: [".visual-hive/issues.json"], writeRestrictions: ["Read issue candidates only. Do not publish issues from this read-only tool."] }
    ),
    cli(
      "visual_hive_get_issue_context",
      "Get issue context",
      "Return the selected issue with linked evidence, graph, impact, artifacts, and validation context.",
      "read_only",
      "local",
      ["repair_agent", "test_creator", "review_agent", "handoff_agent"],
      ["local", "pr", "schedule", "manual", "trusted"],
      "visual-hive mcp tool visual_hive_get_issue_context",
      [],
      {
        reads: [".visual-hive/issues.json", ".visual-hive/issue-queue.json", ".visual-hive/evidence-packet.json", ".visual-hive/visual-graph.json", ".visual-hive/visual-impact.json"],
        evidenceArtifacts: [".visual-hive/issues.json", ".visual-hive/issue-queue.json"],
        writeRestrictions: ["Read issue context only. Do not repair code, create issues, call Hive, or override verdicts."]
      }
    ),
    cli(
      "visual_hive_query_visual_graph",
      "Query Visual Graph",
      "Summarize graph, vocabulary, unresolved-reference, and impact evidence without rescanning or running targets.",
      "read_only",
      "local",
      ["repair_agent", "test_creator", "review_agent", "handoff_agent"],
      ["local", "pr", "schedule", "manual"],
      "visual-hive mcp tool visual_hive_query_visual_graph",
      [],
      {
        reads: [".visual-hive/visual-graph.json", ".visual-hive/visual-graph-vocab.json", ".visual-hive/visual-graph-unresolved.json", ".visual-hive/visual-impact.json"],
        evidenceArtifacts: [".visual-hive/visual-graph.json", ".visual-hive/visual-impact.json"],
        writeRestrictions: ["Read graph evidence only. Do not infer a new verdict or suppress graph findings from this tool."]
      }
    ),
    cli(
      "visual_hive_get_visual_impact",
      "Get Visual Impact",
      "Read the latest Visual Impact analysis for issue and validation routing.",
      "read_only",
      "local",
      ["repair_agent", "test_creator", "review_agent", "handoff_agent"],
      ["local", "pr", "schedule", "manual"],
      "visual-hive mcp tool visual_hive_get_visual_impact",
      [],
      { reads: [".visual-hive/visual-impact.json"], evidenceArtifacts: [".visual-hive/visual-impact.json"], writeRestrictions: ["Read impact evidence only. Do not run validation or publish issues from this tool."] }
    ),
    cli(
      "visual_hive_list_artifacts",
      "List artifacts",
      "Summarize the sanitized artifact index for issue and evidence navigation.",
      "read_only",
      "local",
      ["review_agent", "handoff_agent", "provider_specialist"],
      ["local", "pr", "schedule", "manual"],
      "visual-hive mcp tool visual_hive_list_artifacts",
      [],
      { reads: [".visual-hive/artifacts-index.json"], evidenceArtifacts: [".visual-hive/artifacts-index.json"], writeRestrictions: ["Read artifact inventory only. Do not load large screenshots unless the current task requires visual evidence."] }
    ),
    cli(
      "visual_hive_get_validation_command",
      "Get validation command",
      "Return the issue validation command or latest report reproduction commands.",
      "read_only",
      "local",
      ["repair_agent", "test_creator", "review_agent", "handoff_agent"],
      ["local", "pr_debug", "schedule", "manual"],
      "visual-hive mcp tool visual_hive_get_validation_command",
      [],
      { reads: [".visual-hive/issues.json", ".visual-hive/report.json"], evidenceArtifacts: [".visual-hive/issues.json", ".visual-hive/report.json"], writeRestrictions: ["Read validation commands only. Running them requires a separate explicit shell/CLI action."] }
    ),
    cli(
      "visual_hive_get_agent_prompt",
      "Get agent prompt",
      "Return the generated issue-agent prompt path and bounded prompt guidance without executing an agent.",
      "read_only",
      "local",
      ["repair_agent", "test_creator", "review_agent", "handoff_agent"],
      ["local", "pr", "schedule", "manual"],
      "visual-hive mcp tool visual_hive_get_agent_prompt",
      [],
      { reads: [".visual-hive/issues.json", ".visual-hive/agents"], evidenceArtifacts: [".visual-hive/agents"], writeRestrictions: ["Read prompt routing only. Do not execute Codex, Hive, providers, or GitHub writes from this tool."] }
    ),
    cli(
      "visual_hive_get_handoff_context",
      "Get handoff context",
      "Summarize handoff and Hive export context without creating issues, Beads, branches, or PRs.",
      "read_only",
      "local",
      ["review_agent", "handoff_agent"],
      ["local", "schedule", "manual", "trusted"],
      "visual-hive mcp tool visual_hive_get_handoff_context",
      [],
      {
        reads: [".visual-hive/handoff.json", ".visual-hive/hive/hive-export.json"],
        evidenceArtifacts: [".visual-hive/handoff.json", ".visual-hive/hive/hive-export.json"],
        writeRestrictions: ["Read handoff context only. Publishing issues or Hive Beads requires a trusted workflow and explicit approval."]
      }
    ),
    evidenceCli("triage-report", ["repair_agent", "test_creator", "review_agent", "handoff_agent"], ["local", "pr", "schedule", "manual"], { writes: [] }),
    evidenceCli("issue-body", ["repair_agent", "review_agent", "handoff_agent"], ["local", "pr", "schedule", "manual", "trusted"], { writes: [] }),
    evidenceCli("issue-candidates", ["setup_agent", "repair_agent", "test_creator", "review_agent", "handoff_agent"], ["local", "pr", "schedule", "manual", "trusted"], { writes: [] }),
    evidenceCli("issue-queue", ["setup_agent", "repair_agent", "test_creator", "review_agent", "handoff_agent"], ["local", "pr", "schedule", "manual", "trusted"], { writes: [] }),
    evidenceCli("setup-issue", ["setup_agent", "review_agent", "handoff_agent"], ["local", "pr", "schedule", "manual", "trusted"], { writes: [] }),
    evidenceCli("issue-publish-plan", ["review_agent", "handoff_agent"], ["local", "schedule", "manual", "trusted"], { writes: [] }),
    evidenceCli("issue-publish-dry-run", ["review_agent", "handoff_agent"], ["local", "schedule", "manual", "trusted"], { writes: [] }),
    evidenceCli("issue-publish-result", ["review_agent", "handoff_agent"], ["local", "schedule", "manual", "trusted"], { writes: [] }),
    evidenceCli("pr-comment", ["review_agent", "handoff_agent"], ["local", "pr", "schedule", "manual"], { writes: [] }),
    evidenceCli("triage-prompt", ["repair_agent", "review_agent"], ["local", "pr", "schedule", "manual"], { writes: [] }),
    evidenceCli("repair-prompt", ["repair_agent"], ["local", "pr", "schedule", "manual"]),
    evidenceCli("missing-tests", ["test_creator", "repair_agent", "review_agent"], ["local", "pr", "schedule", "manual"], { writes: [] }),
    evidenceCli("mutation-report", ["repair_agent", "test_creator", "review_agent"], ["local", "pr", "schedule", "manual"], { writes: [] }),
    evidenceCli("latest-handoff", ["handoff_agent", "review_agent"], ["local", "schedule", "manual", "trusted"], {
      writes: [".visual-hive/handoff.json", ".visual-hive/hive-issue.md"],
      evidenceArtifacts: [".visual-hive/handoff.json"]
    }),
    evidenceCli("handoff-validation", ["handoff_agent", "review_agent"], ["local", "schedule", "manual", "trusted"]),
    evidenceCli("hive-export", ["handoff_agent", "review_agent"], ["local", "schedule", "manual", "trusted"], { writes: [] }),
    evidenceCli("hive-beads", ["handoff_agent", "review_agent"], ["local", "schedule", "manual", "trusted"], { writes: [] }),
    evidenceCli("hive-knowledge-facts", ["handoff_agent", "review_agent"], ["local", "schedule", "manual", "trusted"], { writes: [] }),
    evidenceCli("hive-knowledge-graph", ["handoff_agent", "review_agent"], ["local", "schedule", "manual", "trusted"], { writes: [] }),
    evidenceCli("hive-wiki-index", ["handoff_agent", "review_agent"], ["local", "schedule", "manual", "trusted"], { writes: [] }),
    evidenceCli("hive-repair-work-orders", ["handoff_agent", "review_agent"], ["local", "schedule", "manual", "trusted"], { writes: [] }),
    evidenceCli("hive-agent-policy", ["handoff_agent", "review_agent"], ["local", "schedule", "manual", "trusted"], { writes: [] }),
    evidenceCli("hive-guarded-repair-preview", ["handoff_agent", "review_agent"], ["local", "schedule", "manual", "trusted"], { writes: [] }),
    evidenceCli("hive-repair-request-envelope", ["handoff_agent", "review_agent"], ["local", "schedule", "manual", "trusted"], { writes: [] }),
    evidenceCli("hive-trusted-repair-consumer-summary", ["handoff_agent", "review_agent"], ["local", "schedule", "manual", "trusted"], { writes: [] }),
    evidenceCli("hive-trusted-repair-workflow-dry-run", ["handoff_agent", "review_agent"], ["local", "schedule", "manual", "trusted"], { writes: [] }),
    evidenceCli("hive-mode-comparison", ["handoff_agent", "review_agent"], ["local", "schedule", "manual", "trusted"], { writes: [] }),
    evidenceCli("agent-packet", ["repair_agent", "test_creator", "review_agent", "handoff_agent", "provider_specialist"], ["local", "pr", "schedule", "manual"], {
      writes: []
    }),
    evidenceCli("agent-validation", ["test_creator", "review_agent", "handoff_agent"], ["local", "pr", "schedule", "manual", "trusted"], {
      writes: []
    }),
    evidenceCli("handoff-agent-packet", ["handoff_agent", "review_agent"], ["local", "pr", "schedule", "manual", "trusted"], {
      writes: []
    }),
    evidenceCli("provider-agent-packet", ["provider_specialist", "review_agent"], ["local", "pr", "schedule", "manual", "trusted"], {
      writes: []
    }),
    evidenceCli("tool-registry", ["review_agent", "handoff_agent"], ["local", "pr", "schedule", "manual"], { writes: [] }),
    evidenceCli("context-ledger", ["review_agent", "handoff_agent", "provider_specialist"], ["local", "pr", "schedule", "manual"], { writes: [] }),
    evidenceCli("artifacts-index", ["review_agent", "handoff_agent", "provider_specialist"], ["local", "pr", "schedule", "manual"], { writes: [] }),
    cli("visual_hive_agent_packet", "Generate Agent Packet", "Write a bounded role-specific packet for an agent.", "read_only", "local", ["setup_agent", "repair_agent", "test_creator", "review_agent", "handoff_agent", "provider_specialist"], ["local", "pr", "schedule", "manual"], "visual-hive agent-packet", [".visual-hive/agent-packet.json"]),
    evidenceCli("provider-results", ["review_agent", "handoff_agent", "provider_specialist"], ["local", "pr", "schedule", "manual", "trusted"], {
      writes: []
    }),
    evidenceCli("provider-decisions", ["setup_agent", "review_agent", "handoff_agent", "provider_specialist"], ["local", "pr", "schedule", "manual", "trusted"], {
      writes: []
    }),
    evidenceCli("provider-setup-plan", ["setup_agent", "review_agent", "handoff_agent", "provider_specialist"], ["local", "schedule", "manual", "trusted"], {
      writes: []
    }),
    evidenceCli("provider-handoff", ["review_agent", "handoff_agent", "provider_specialist"], ["local", "schedule", "manual", "trusted"], {
      writes: []
    }),
    evidenceCli("provider-upload-argos-manifest", ["review_agent", "handoff_agent", "provider_specialist"], ["local", "schedule", "manual", "trusted"], {
      writes: []
    }),
    evidenceCli("pipeline-status", ["review_agent", "handoff_agent"], ["local", "pr", "schedule", "manual"], { writes: [] }),
    evidenceCli("schema-catalog", ["review_agent", "handoff_agent"], ["local", "pr", "schedule", "manual"], { writes: [] }),
    evidenceCli("mcp-manifest", ["review_agent", "handoff_agent"], ["local", "pr", "schedule", "manual"], { writes: [] }),
    cli("visual_hive_provider_handoff_dry_run", "Provider handoff dry run", "Review provider upload eligibility, blocked reasons, required credential names, and trusted workflow steps without making external calls.", "read_only", "local", ["review_agent", "handoff_agent", "provider_specialist"], ["local", "schedule", "manual", "trusted"], "visual-hive providers handoff --provider argos", [".visual-hive/provider-handoff.json"], {
      writeRestrictions: ["Writes local provider handoff evidence only. Does not upload screenshots or enable provider gating."]
    }),
    cli("visual_hive_run", "Run deterministic checks", "Run Playwright-backed deterministic checks; execution must be explicit.", "local_execution", "local", ["repair_agent"], ["local", "pr_debug", "schedule", "manual"], "visual-hive run", [".visual-hive/report.json"], { trustedOnly: false, writeRestrictions: ["Do not run protected targets from untrusted PRs.", "Do not approve baselines."] }),
    cli("visual_hive_mutate", "Run mutation checks", "Run mutation adequacy checks to verify contracts catch intentional breakage.", "local_execution", "local", ["test_creator", "repair_agent"], ["local", "schedule", "manual"], "visual-hive mutate", [".visual-hive/mutation-report.json"], { trustedOnly: false }),
    cli("visual_hive_update_baseline", "Update baseline", "Approve or reject screenshot baselines after human review.", "trusted_write", "local", ["review_agent"], ["manual", "trusted"], "visual-hive baselines approve|reject", [".visual-hive/baseline-approvals.json", ".visual-hive/baseline-rejections.json"], {
      trustedOnly: true,
      requiresHumanApproval: ["baseline_approval"],
      writeRestrictions: ["Agents must not approve baselines without human review."]
    }),
    cli("visual_hive_handoff_github_issue", "Create GitHub issue from handoff", "Future trusted workflow action to create or update an issue from sanitized artifacts.", "trusted_write", "external_api", ["handoff_agent"], ["trusted"], "trusted workflow_run consumer", [".visual-hive/hive-issue.md"], {
      trustedOnly: true,
      externalNetwork: true,
      requiresHumanApproval: ["github_issue_creation"],
      writeRestrictions: ["Do not create issues from untrusted PR execution."]
    }),
    cli("visual_hive_handoff_hive_bead", "Create Hive Bead", "Future trusted Hive Bead handoff from sanitized evidence.", "trusted_write", "external_api", ["handoff_agent"], ["trusted"], "visual-hive handoff --mode bead_api", [".visual-hive/hive-bead-request.json"], {
      trustedOnly: true,
      externalNetwork: true,
      requiresHumanApproval: ["hive_bead_creation"],
      writeRestrictions: ["Dry-run only until trusted API integration is configured."]
    }),
    cli("visual_hive_provider_upload", "Provider upload", "Upload staged artifacts to optional hosted visual provider under policy.", "external_upload", "paid_provider", ["provider_specialist"], ["schedule", "manual", "trusted"], "visual-hive providers upload --provider argos", [".visual-hive/provider-results.json", ".visual-hive/provider-upload/argos/manifest.json"], {
      trustedOnly: true,
      externalNetwork: true,
      requiresHumanApproval: ["provider_upload_enablement", "paid_provider_connection", "external_network_access"],
      forbiddenInPullRequest: true,
      writeRestrictions: ["Disabled by default.", "Requires explicit credentials, cost policy, and trusted lane."]
    }),
    mcp("visual_hive_mcp", "Visual Hive MCP", "First-party MCP adapter over the same CLI/JSON artifacts.", "first_party_mcp", "local", false, ["setup_agent", "repair_agent", "test_creator", "review_agent", "handoff_agent"], ["local", "pr_debug", "schedule", "manual"], "visual-hive", "available", {
      enabled: true
    }),
    mcp("playwright_accessibility_snapshot", "Playwright accessibility snapshot", "Optional local MCP for scoped DOM/accessibility inspection when authoring or repairing contracts.", "local_mcp", "local", false, ["repair_agent", "test_creator"], ["local", "pr_debug", "schedule"], "playwright", "disabled"),
    mcp("storybook_component_index", "Storybook component index", "Optional local component/story context for Storybook-heavy repos.", "local_mcp", "local", false, ["test_creator", "review_agent"], ["local", "pr_debug"], "storybook", "disabled"),
    mcp("github_read_only", "GitHub read-only", "Optional read-only PR/check/issue context when local artifacts are insufficient.", "github_mcp", "external_api", false, ["review_agent", "handoff_agent"], ["trusted", "manual"], "github", "disabled", { externalNetwork: true }),
    mcp("argos_provider_review", "Argos provider review", "Optional provider result review after trusted upload lanes are configured.", "provider_mcp", "paid_provider", true, ["provider_specialist"], ["schedule", "manual", "trusted"], "argos", "disabled", {
      externalNetwork: true,
      requiresHumanApproval: ["paid_provider_connection", "external_network_access"]
    }),
    mcp("applitools_provider_review", "Applitools provider review", "Optional enterprise visual AI result review when explicitly configured.", "provider_mcp", "paid_provider", true, ["provider_specialist"], ["schedule", "manual", "trusted"], "applitools", "disabled", {
      externalNetwork: true,
      requiresHumanApproval: ["paid_provider_connection", "external_network_access"]
    })
  ];
}

type EvidenceCliOptions = Partial<
  Pick<ToolRegistryEntry, "trustedOnly" | "externalNetwork" | "requiresHumanApproval" | "forbiddenInPullRequest" | "writeRestrictions" | "reads" | "evidenceArtifacts" | "notes">
> & {
  writes?: string[];
};

function evidenceCli(resourceId: string, roles: ToolRole[], modes: ToolMode[], options: EvidenceCliOptions = {}): ToolRegistryEntry {
  const resource = getRequiredEvidenceReadResource(resourceId);
  const writes = options.writes ?? [resource.relativePath];
  const reads = options.reads ?? (writes.length ? undefined : [resource.relativePath]);
  const cliOptions: Partial<
    Pick<
      ToolRegistryEntry,
      | "trustedOnly"
      | "externalNetwork"
      | "requiresHumanApproval"
      | "forbiddenInPullRequest"
      | "writeRestrictions"
      | "reads"
      | "evidenceArtifacts"
      | "evidenceResourceId"
      | "evidenceResourceUri"
      | "evidenceResourceTitle"
      | "evidenceResourceDescription"
      | "evidenceReadToolName"
      | "notes"
    >
  > = {
    evidenceArtifacts: options.evidenceArtifacts ?? [resource.relativePath],
    evidenceResourceId: resource.id,
    evidenceResourceUri: resource.uri,
    evidenceResourceTitle: resource.title,
    evidenceResourceDescription: resource.description,
    evidenceReadToolName: resource.readTool.name,
    writeRestrictions: options.writeRestrictions ?? resource.readTool.writeRestrictions,
    trustedOnly: options.trustedOnly,
    externalNetwork: options.externalNetwork,
    requiresHumanApproval: options.requiresHumanApproval,
    forbiddenInPullRequest: options.forbiddenInPullRequest,
    notes: options.notes ?? [`Catalog resource: ${resource.uri}`]
  };
  if (reads) cliOptions.reads = reads;
  return cli(
    resource.readTool.name,
    resource.readTool.title,
    resource.readTool.description,
    "read_only",
    "local",
    roles,
    modes,
    resource.readTool.command ?? `visual-hive mcp/read ${resource.name}`,
    writes,
    cliOptions
  );
}

function getRequiredEvidenceReadResource(resourceId: string): EvidenceResourceDefinition & { readTool: NonNullable<EvidenceResourceDefinition["readTool"]> } {
  const resource = getEvidenceResourceById(resourceId);
  if (!resource?.readTool) {
    throw new Error(`Evidence resource ${resourceId} is missing read-tool metadata.`);
  }
  return resource as EvidenceResourceDefinition & { readTool: NonNullable<EvidenceResourceDefinition["readTool"]> };
}

function cli(
  id: string,
  label: string,
  description: string,
  access: ToolAccess,
  costClass: ToolCostClass,
  roles: ToolRole[],
  modes: ToolMode[],
  command: string,
  writes: string[],
  options: Partial<
    Pick<
      ToolRegistryEntry,
      | "trustedOnly"
      | "externalNetwork"
      | "requiresHumanApproval"
      | "forbiddenInPullRequest"
      | "writeRestrictions"
      | "reads"
      | "evidenceArtifacts"
      | "evidenceResourceId"
      | "evidenceResourceUri"
      | "evidenceResourceTitle"
      | "evidenceResourceDescription"
      | "evidenceReadToolName"
      | "notes"
    >
  > = {}
): ToolRegistryEntry {
  return entry({
    id,
    label,
    description,
    kind: "first_party_cli",
    enabled: true,
    defaultAccess: access,
    costClass,
    allowedRoles: roles,
    allowedModes: modes,
    command,
    reads: [".visual-hive/evidence-packet.json", ".visual-hive/report.json"].filter((artifact) => !writes.includes(artifact)),
    writes,
    ...options
  });
}

function mcp(
  id: string,
  label: string,
  description: string,
  kind: ToolKind,
  costClass: ToolCostClass,
  trustedOnly: boolean,
  roles: ToolRole[],
  modes: ToolMode[],
  server: string,
  status: "available" | "planned" | "disabled",
  options: Partial<Pick<ToolRegistryEntry, "enabled" | "externalNetwork" | "requiresHumanApproval" | "forbiddenInPullRequest" | "writeRestrictions">> = {}
): ToolRegistryEntry {
  return entry({
    id,
    label,
    description,
    kind,
    enabled: options.enabled ?? false,
    defaultAccess: "read_only",
    costClass,
    trustedOnly,
    allowedRoles: roles,
    allowedModes: modes,
    mcp: { server, transport: kind === "github_mcp" || kind === "provider_mcp" ? "remote" : "stdio", status },
    reads: [],
    writes: [],
    ...options
  });
}

function entry(input: Partial<ToolRegistryEntry> & Pick<ToolRegistryEntry, "id" | "label" | "description" | "kind" | "enabled" | "defaultAccess" | "costClass" | "allowedRoles" | "allowedModes">): ToolRegistryEntry {
  const trustedOnly = input.trustedOnly ?? (input.defaultAccess === "trusted_write" || input.defaultAccess === "external_upload");
  const externalNetwork = input.externalNetwork ?? (input.costClass !== "local");
  const result: ToolRegistryEntry = {
    id: input.id,
    label: input.label,
    description: input.description,
    kind: input.kind,
    enabled: input.enabled,
    defaultAccess: input.defaultAccess,
    costClass: input.costClass,
    trustedOnly,
    externalNetwork,
    forbiddenInPullRequest: input.forbiddenInPullRequest ?? (trustedOnly || externalNetwork),
    requiresHumanApproval: input.requiresHumanApproval ?? [],
    allowedRoles: input.allowedRoles,
    allowedModes: input.allowedModes,
    command: input.command,
    mcp: input.mcp,
    reads: input.reads ?? [],
    writes: input.writes ?? [],
    writeRestrictions: input.writeRestrictions ?? ["Use only when the current Agent Packet allows this tool."],
    evidenceArtifacts: input.evidenceArtifacts ?? input.writes ?? [],
    notes: input.notes ?? []
  };
  if (input.evidenceResourceId) result.evidenceResourceId = input.evidenceResourceId;
  if (input.evidenceResourceUri) result.evidenceResourceUri = input.evidenceResourceUri;
  if (input.evidenceResourceTitle) result.evidenceResourceTitle = input.evidenceResourceTitle;
  if (input.evidenceResourceDescription) result.evidenceResourceDescription = input.evidenceResourceDescription;
  if (input.evidenceReadToolName) result.evidenceReadToolName = input.evidenceReadToolName;
  return result;
}

function roleProfiles(tools: ToolRegistryEntry[]): ToolRoleProfile[] {
  const profile = (role: ToolRole, purpose: string, forbiddenActions: string[], trustedOnly = false, requiresBudget = false): ToolRoleProfile => ({
    role,
    purpose,
    trustedOnly,
    requiresBudget,
    allowedToolIds: selectRoleToolIds(tools, role, trustedOnly),
    forbiddenActions
  });
  return [
    profile("setup_agent", "Generate and validate safe local-first Visual Hive setup.", ["provider.write", "github.createIssue", "github.mergePullRequest", "protectedTarget.run"]),
    profile("repair_agent", "Reproduce and repair deterministic failures from sanitized evidence.", ["baseline.approve", "provider.upload", "github.write", "protectedTarget.run"]),
    profile("test_creator", "Add or improve visual/user-flow contracts from coverage gaps and mutation survivors.", ["baseline.approve", "provider.upload", "github.write", "weaken.thresholds"]),
    profile("review_agent", "Review evidence, governance, artifacts, and residual risk.", ["github.mergePullRequest", "baseline.approve", "provider.write"]),
    profile("handoff_agent", "Prepare trusted GitHub/Hive handoff from sanitized artifacts.", ["execute.prCode", "read.secrets"], true),
    profile("provider_specialist", "Review optional provider setup/results under explicit budget and trusted policy.", ["run.untrustedPrUpload", "make.provider.gating.by.default"], true, true)
  ];
}

function selectRoleToolIds(tools: ToolRegistryEntry[], role: ToolRole, includeTrustedTools: boolean): string[] {
  const priority = new Map(ROLE_TOOL_PRIORITY[role].map((id, index) => [id, index]));
  const declarationOrder = new Map(tools.map((tool, index) => [tool.id, index]));
  return tools
    .filter((tool) => tool.allowedRoles.includes(role))
    .filter((tool) => !tool.trustedOnly || includeTrustedTools)
    .sort((left, right) => {
      const leftRank = priority.get(left.id);
      const rightRank = priority.get(right.id);
      if (leftRank !== undefined || rightRank !== undefined) {
        return (leftRank ?? Number.MAX_SAFE_INTEGER) - (rightRank ?? Number.MAX_SAFE_INTEGER);
      }
      return (declarationOrder.get(left.id) ?? 0) - (declarationOrder.get(right.id) ?? 0);
    })
    .slice(0, MAX_TOOL_DEFINITIONS_PER_AGENT)
    .map((tool) => tool.id);
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
