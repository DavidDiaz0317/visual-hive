import path from "node:path";
import { sanitizeText } from "../utils/sanitize.js";
import { writeJson, writeText } from "../utils/files.js";
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
      maxToolDefinitionsPerAgent: 8,
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
    cli("visual_hive_plan", "Plan checks", "Plan contracts from changed files, risk, target safety, and cost.", "read_only", "local", ["setup_agent", "repair_agent", "test_creator", "review_agent"], ["local", "pr", "schedule", "manual"], "visual-hive plan", [".visual-hive/plan.json"]),
    cli("visual_hive_read_latest_report", "Read latest report", "Read deterministic report evidence without scraping CI logs.", "read_only", "local", ["repair_agent", "test_creator", "review_agent", "handoff_agent"], ["local", "pr", "schedule", "manual"], "visual-hive report", [".visual-hive/report.json"]),
    cli("visual_hive_read_evidence_packet", "Read Evidence Packet", "Read the canonical sanitized evidence contract.", "read_only", "local", ["repair_agent", "test_creator", "review_agent", "handoff_agent"], ["local", "pr", "schedule", "manual"], "visual-hive evidence", [".visual-hive/evidence-packet.json"]),
    cli("visual_hive_explain_failure", "Explain failure", "Use triage and report artifacts to explain likely deterministic failure causes.", "read_only", "local", ["repair_agent", "review_agent"], ["local", "pr", "schedule", "manual"], "visual-hive triage", [".visual-hive/triage.json", ".visual-hive/issue.md"]),
    cli("visual_hive_list_reproduction_commands", "List reproduction commands", "List focused commands from reports and Agent Packets.", "read_only", "local", ["repair_agent", "test_creator", "review_agent"], ["local", "pr_debug", "schedule", "manual"], "visual-hive report", [".visual-hive/report.json"]),
    cli("visual_hive_generate_repair_prompt", "Generate repair prompt", "Generate sanitized repair guidance from deterministic evidence.", "read_only", "local", ["repair_agent"], ["local", "pr", "schedule", "manual"], "visual-hive triage", [".visual-hive/repair-prompt.md"]),
    cli("visual_hive_generate_handoff_dry_run", "Generate handoff dry run", "Write local GitHub/Hive handoff artifacts with zero external calls.", "read_only", "local", ["handoff_agent", "review_agent"], ["local", "schedule", "manual", "trusted"], "visual-hive handoff --dry-run", [".visual-hive/handoff.json", ".visual-hive/hive-issue.md"]),
    cli("visual_hive_agent_packet", "Generate Agent Packet", "Write a bounded role-specific packet for an agent.", "read_only", "local", ["setup_agent", "repair_agent", "test_creator", "review_agent", "handoff_agent"], ["local", "pr", "schedule", "manual"], "visual-hive agent-packet", [".visual-hive/agent-packet.json"]),
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
    mcp("visual_hive_mcp", "Visual Hive MCP", "Planned first-party MCP adapter over the same CLI/JSON artifacts.", "first_party_mcp", "local", true, ["setup_agent", "repair_agent", "test_creator", "review_agent", "handoff_agent"], ["local", "pr_debug", "schedule", "manual"], "visual-hive", "planned"),
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
  options: Partial<Pick<ToolRegistryEntry, "trustedOnly" | "externalNetwork" | "requiresHumanApproval" | "forbiddenInPullRequest" | "writeRestrictions">> = {}
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
  status: "planned" | "disabled",
  options: Partial<Pick<ToolRegistryEntry, "externalNetwork" | "requiresHumanApproval" | "forbiddenInPullRequest" | "writeRestrictions">> = {}
): ToolRegistryEntry {
  return entry({
    id,
    label,
    description,
    kind,
    enabled: false,
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
  return {
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
    evidenceArtifacts: input.writes ?? [],
    notes: input.notes ?? []
  };
}

function roleProfiles(tools: ToolRegistryEntry[]): ToolRoleProfile[] {
  const profile = (role: ToolRole, purpose: string, forbiddenActions: string[], trustedOnly = false, requiresBudget = false): ToolRoleProfile => ({
    role,
    purpose,
    trustedOnly,
    requiresBudget,
    allowedToolIds: tools
      .filter((tool) => tool.allowedRoles.includes(role))
      .filter((tool) => !tool.trustedOnly || trustedOnly)
      .slice(0, 8)
      .map((tool) => tool.id),
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
