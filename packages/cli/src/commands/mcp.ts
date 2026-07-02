import { readFile } from "node:fs/promises";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createPlan, loadConfig, recommendSetup, sanitizeText, writeJson, type LoadedConfig } from "@visual-hive/core";

export interface McpCommandOptions {
  config?: string;
  cwd?: string;
  stdio?: boolean;
  describe?: boolean;
  output?: string;
}

export interface McpResourceDefinition {
  uri: string;
  name: string;
  title: string;
  description: string;
  relativePath: string;
  mimeType: string;
}

export interface McpToolDefinition {
  name: string;
  title: string;
  description: string;
  mode: "read_only" | "execution_disabled";
}

export interface McpManifest {
  schemaVersion: "visual-hive.mcp.v1";
  project: string;
  server: {
    name: "visual-hive";
    transport: "stdio";
    defaultAccess: "read_only";
    externalCallsMade: 0;
  };
  resources: McpResourceDefinition[];
  tools: McpToolDefinition[];
  disabledExecutionTools: McpToolDefinition[];
  policy: {
    thirdPartyMcpDefault: "disabled";
    executionToolsDefault: "disabled";
    githubWritesFromPr: false;
    externalUploadsFromPr: false;
    baselineApprovalByAgent: false;
    llmSoleOracle: false;
  };
}

export const MCP_RESOURCES: McpResourceDefinition[] = [
  {
    uri: "visual-hive://config",
    name: "config",
    title: "Visual Hive Config",
    description: "Validated Visual Hive YAML configuration for this repository.",
    relativePath: "visual-hive.config.yaml",
    mimeType: "text/yaml"
  },
  {
    uri: "visual-hive://latest-plan",
    name: "latest-plan",
    title: "Latest Plan",
    description: "Latest deterministic plan artifact.",
    relativePath: ".visual-hive/plan.json",
    mimeType: "application/json"
  },
  {
    uri: "visual-hive://latest-report",
    name: "latest-report",
    title: "Latest Report",
    description: "Latest deterministic Visual Hive report.",
    relativePath: ".visual-hive/report.json",
    mimeType: "application/json"
  },
  {
    uri: "visual-hive://latest-evidence",
    name: "latest-evidence",
    title: "Latest Evidence Packet",
    description: "Sanitized Evidence Packet consumed by humans, agents, GitHub, and Hive handoff flows.",
    relativePath: ".visual-hive/evidence-packet.json",
    mimeType: "application/json"
  },
  {
    uri: "visual-hive://latest-verdict",
    name: "latest-verdict",
    title: "Latest Visual Hive Verdict",
    description: "Normalized Visual Hive verdict artifact assembled from deterministic evidence contributions.",
    relativePath: ".visual-hive/verdict.json",
    mimeType: "application/json"
  },
  {
    uri: "visual-hive://latest-handoff",
    name: "latest-handoff",
    title: "Latest Handoff Packet",
    description: "Dry-run GitHub/Hive handoff packet.",
    relativePath: ".visual-hive/handoff.json",
    mimeType: "application/json"
  },
  {
    uri: "visual-hive://handoff-validation",
    name: "handoff-validation",
    title: "Handoff Validation",
    description: "No-network validation report for Evidence Packet and Hive handoff artifacts.",
    relativePath: ".visual-hive/hive-handoff-validation.json",
    mimeType: "application/json"
  },
  {
    uri: "visual-hive://coverage-map",
    name: "coverage-map",
    title: "Coverage Map",
    description: "Visual coverage and missing-test guidance.",
    relativePath: ".visual-hive/coverage.json",
    mimeType: "application/json"
  },
  {
    uri: "visual-hive://mutation-report",
    name: "mutation-report",
    title: "Mutation Report",
    description: "Mutation adequacy report and survivor evidence.",
    relativePath: ".visual-hive/mutation-report.json",
    mimeType: "application/json"
  },
  {
    uri: "visual-hive://repair-prompt",
    name: "repair-prompt",
    title: "Repair Prompt",
    description: "Offline advisory repair prompt generated from deterministic evidence.",
    relativePath: ".visual-hive/repair-prompt.md",
    mimeType: "text/markdown"
  },
  {
    uri: "visual-hive://artifacts/index",
    name: "artifacts-index",
    title: "Artifact Index",
    description: "Sanitized index of Visual Hive JSON, markdown, screenshots, and generated spec artifacts.",
    relativePath: ".visual-hive/artifacts-index.json",
    mimeType: "application/json"
  },
  {
    uri: "visual-hive://agent-packet",
    name: "agent-packet",
    title: "Agent Packet",
    description: "Bounded advisory work packet for repair, test-creation, review, or handoff agents.",
    relativePath: ".visual-hive/agent-packet.json",
    mimeType: "application/json"
  },
  {
    uri: "visual-hive://tool-registry",
    name: "tool-registry",
    title: "Tool Registry",
    description: "Governed Visual Hive tool registry and MCP/provider policy surface.",
    relativePath: ".visual-hive/tools/tool-registry.json",
    mimeType: "application/json"
  },
  {
    uri: "visual-hive://context-ledger",
    name: "context-ledger",
    title: "Context Ledger",
    description: "Governance ledger for tool calls, token estimates, external cost, provider screenshots, and escalation budgets.",
    relativePath: ".visual-hive/context-ledger.json",
    mimeType: "application/json"
  },
  {
    uri: "visual-hive://pipeline-status",
    name: "pipeline-status",
    title: "Pipeline Status",
    description: "Latest operational pipeline status across repo intelligence, evidence, verdict, handoff, agent, tool, and context artifacts.",
    relativePath: ".visual-hive/pipeline.json",
    mimeType: "application/json"
  }
];

export const MCP_READ_ONLY_TOOLS: McpToolDefinition[] = [
  {
    name: "visual_hive_doctor",
    title: "Doctor Summary",
    description: "Summarize the loaded config, targets, contracts, and missing secret names without running target code.",
    mode: "read_only"
  },
  {
    name: "visual_hive_validate_config",
    title: "Validate Config",
    description: "Validate the configured Visual Hive repository without running tests or making external calls.",
    mode: "read_only"
  },
  {
    name: "visual_hive_recommend_setup",
    title: "Recommend Setup",
    description: "Inspect repository setup signals and return bounded setup recommendations without writing files.",
    mode: "read_only"
  },
  {
    name: "visual_hive_plan",
    title: "Plan Summary",
    description: "Create an in-memory PR-mode plan summary without writing plan.json or executing contracts.",
    mode: "read_only"
  },
  {
    name: "visual_hive_read_latest_report",
    title: "Read Latest Report",
    description: "Read the latest deterministic report artifact.",
    mode: "read_only"
  },
  {
    name: "visual_hive_read_evidence_packet",
    title: "Read Evidence Packet",
    description: "Read the latest sanitized Evidence Packet.",
    mode: "read_only"
  },
  {
    name: "visual_hive_read_verdict",
    title: "Read Visual Hive Verdict",
    description: "Read the latest normalized Visual Hive verdict artifact.",
    mode: "read_only"
  },
  {
    name: "visual_hive_read_agent_packet",
    title: "Read Agent Packet",
    description: "Read the latest bounded advisory Agent Packet.",
    mode: "read_only"
  },
  {
    name: "visual_hive_read_tool_registry",
    title: "Read Tool Registry",
    description: "Read the governed first-party and optional tool policy registry.",
    mode: "read_only"
  },
  {
    name: "visual_hive_read_context_ledger",
    title: "Read Context Ledger",
    description: "Read the governance ledger for tool, token, provider, and escalation budget evidence.",
    mode: "read_only"
  },
  {
    name: "visual_hive_read_pipeline_status",
    title: "Read Pipeline Status",
    description: "Read the latest operational pipeline artifact status.",
    mode: "read_only"
  },
  {
    name: "visual_hive_explain_failure",
    title: "Explain Failure",
    description: "Summarize failed deterministic contracts, verdict reasons, and mutation survivors from existing artifacts.",
    mode: "read_only"
  },
  {
    name: "visual_hive_list_reproduction_commands",
    title: "List Reproduction Commands",
    description: "List deterministic reproduction commands recorded in the latest report.",
    mode: "read_only"
  },
  {
    name: "visual_hive_generate_repair_prompt",
    title: "Read Repair Prompt",
    description: "Return the existing offline repair prompt if it has been generated by triage.",
    mode: "read_only"
  },
  {
    name: "visual_hive_generate_handoff_dry_run",
    title: "Read Handoff Dry Run",
    description: "Return the existing dry-run handoff packet if it has been generated; no issue or Hive Bead is created.",
    mode: "read_only"
  },
  {
    name: "visual_hive_validate_handoff",
    title: "Read Handoff Validation",
    description: "Return the existing no-network handoff validation report if it has been generated.",
    mode: "read_only"
  }
];

export const MCP_DISABLED_EXECUTION_TOOLS: McpToolDefinition[] = [
  "visual_hive_run",
  "visual_hive_mutate",
  "visual_hive_update_baseline",
  "visual_hive_handoff_github_issue",
  "visual_hive_handoff_hive_bead",
  "visual_hive_provider_upload"
].map((name) => ({
  name,
  title: name.replaceAll("_", " "),
  description: "Execution or write-capable tool intentionally disabled by default. Use the CLI in a trusted workflow instead.",
  mode: "execution_disabled" as const
}));

export async function runMcpCommand(options: McpCommandOptions = {}): Promise<McpManifest> {
  const loaded = await loadConfig(options.config, options.cwd ?? process.cwd());
  const manifest = buildMcpManifest(loaded);
  if (options.output) {
    await writeJson(path.resolve(loaded.rootDir, options.output), manifest);
  }
  if (options.stdio) {
    const server = createVisualHiveMcpServer(loaded, manifest);
    await server.connect(new StdioServerTransport());
  }
  return manifest;
}

export function buildMcpManifest(loaded: LoadedConfig): McpManifest {
  return sanitizeObject({
    schemaVersion: "visual-hive.mcp.v1",
    project: loaded.config.project.name,
    server: {
      name: "visual-hive",
      transport: "stdio",
      defaultAccess: "read_only",
      externalCallsMade: 0
    },
    resources: MCP_RESOURCES.map((resource) => ({
      ...resource,
      relativePath: resource.uri === "visual-hive://config" ? path.relative(loaded.rootDir, loaded.configPath) || path.basename(loaded.configPath) : resource.relativePath
    })),
    tools: MCP_READ_ONLY_TOOLS,
    disabledExecutionTools: MCP_DISABLED_EXECUTION_TOOLS,
    policy: {
      thirdPartyMcpDefault: "disabled",
      executionToolsDefault: "disabled",
      githubWritesFromPr: false,
      externalUploadsFromPr: false,
      baselineApprovalByAgent: false,
      llmSoleOracle: false
    }
  }) as McpManifest;
}

export function formatMcpManifest(manifest: McpManifest, format: "markdown" | "json" = "markdown"): string {
  if (format === "json") return JSON.stringify(manifest, null, 2);
  return [
    `# Visual Hive MCP: ${manifest.project}`,
    "",
    `- Transport: ${manifest.server.transport}`,
    `- Default access: ${manifest.server.defaultAccess}`,
    `- Resources: ${manifest.resources.length}`,
    `- Read-only tools: ${manifest.tools.length}`,
    `- Disabled execution tools: ${manifest.disabledExecutionTools.length}`,
    `- External calls made: ${manifest.server.externalCallsMade}`,
    `- Third-party MCP default: ${manifest.policy.thirdPartyMcpDefault}`,
    "",
    "## Resources",
    ...manifest.resources.map((resource) => `- ${resource.uri} -> ${resource.relativePath}`),
    "",
    "## Read-only Tools",
    ...manifest.tools.map((tool) => `- ${tool.name}: ${tool.description}`),
    "",
    "## Disabled Execution Tools",
    ...manifest.disabledExecutionTools.map((tool) => `- ${tool.name}`)
  ].join("\n");
}

export function createVisualHiveMcpServer(loaded: LoadedConfig, manifest = buildMcpManifest(loaded)): McpServer {
  const server = new McpServer({
    name: "visual-hive",
    version: "0.2.0"
  });

  for (const resource of manifest.resources) {
    server.registerResource(
      resource.name,
      resource.uri,
      {
        title: resource.title,
        description: resource.description,
        mimeType: resource.mimeType
      },
      async (uri) => ({
        contents: [
          {
            uri: uri.href,
            mimeType: resource.mimeType,
            text: await readMcpResourceText(loaded, resource)
          }
        ]
      })
    );
  }

  for (const tool of manifest.tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false
        }
      },
      async () => ({
        content: [
          {
            type: "text",
            text: await callReadOnlyTool(loaded, tool.name)
          }
        ]
      })
    );
  }

  return server;
}

export async function readMcpResourceText(loaded: LoadedConfig, resource: McpResourceDefinition): Promise<string> {
  const filePath = resource.uri === "visual-hive://config" ? loaded.configPath : path.join(loaded.rootDir, resource.relativePath);
  return readArtifactText(filePath, resource.relativePath);
}

export async function callReadOnlyTool(loaded: LoadedConfig, toolName: string): Promise<string> {
  switch (toolName) {
    case "visual_hive_doctor":
      return JSON.stringify(buildDoctorSummary(loaded), null, 2);
    case "visual_hive_validate_config":
      return JSON.stringify(
        sanitizeObject({
          ok: true,
          project: loaded.config.project.name,
          rootDir: loaded.rootDir,
          configPath: loaded.configPath,
          targets: Object.keys(loaded.config.targets),
          contracts: loaded.config.contracts.map((contract) => contract.id),
          externalCallsMade: 0
        }),
        null,
        2
      );
    case "visual_hive_recommend_setup":
      return JSON.stringify(await buildSetupRecommendationSummary(loaded), null, 2);
    case "visual_hive_plan":
      return JSON.stringify(buildReadOnlyPlanSummary(loaded), null, 2);
    case "visual_hive_read_latest_report":
      return readArtifactText(path.join(loaded.rootDir, ".visual-hive", "report.json"), ".visual-hive/report.json");
    case "visual_hive_read_evidence_packet":
      return readArtifactText(path.join(loaded.rootDir, ".visual-hive", "evidence-packet.json"), ".visual-hive/evidence-packet.json");
    case "visual_hive_read_verdict":
      return readArtifactText(path.join(loaded.rootDir, ".visual-hive", "verdict.json"), ".visual-hive/verdict.json");
    case "visual_hive_read_agent_packet":
      return readArtifactText(path.join(loaded.rootDir, ".visual-hive", "agent-packet.json"), ".visual-hive/agent-packet.json");
    case "visual_hive_read_tool_registry":
      return readArtifactText(path.join(loaded.rootDir, ".visual-hive", "tools", "tool-registry.json"), ".visual-hive/tools/tool-registry.json");
    case "visual_hive_read_context_ledger":
      return readArtifactText(path.join(loaded.rootDir, ".visual-hive", "context-ledger.json"), ".visual-hive/context-ledger.json");
    case "visual_hive_read_pipeline_status":
      return readArtifactText(path.join(loaded.rootDir, ".visual-hive", "pipeline.json"), ".visual-hive/pipeline.json");
    case "visual_hive_explain_failure":
      return explainLatestFailure(loaded.rootDir);
    case "visual_hive_list_reproduction_commands":
      return listReproductionCommands(loaded.rootDir);
    case "visual_hive_generate_repair_prompt":
      return readArtifactText(path.join(loaded.rootDir, ".visual-hive", "repair-prompt.md"), ".visual-hive/repair-prompt.md");
    case "visual_hive_generate_handoff_dry_run":
      return readArtifactText(path.join(loaded.rootDir, ".visual-hive", "handoff.json"), ".visual-hive/handoff.json");
    case "visual_hive_validate_handoff":
      return readArtifactText(path.join(loaded.rootDir, ".visual-hive", "hive-handoff-validation.json"), ".visual-hive/hive-handoff-validation.json");
    default:
      return `Tool ${sanitizeText(toolName)} is not registered as a default read-only Visual Hive MCP tool.`;
  }
}

function buildDoctorSummary(loaded: LoadedConfig): Record<string, unknown> {
  const targetRows = Object.entries(loaded.config.targets).map(([id, target]) => {
    const missingSecrets = target.kind === "protected" ? (target.requiresSecrets ?? []).filter((name) => !process.env[name]) : [];
    return {
      id,
      kind: target.kind,
      url: "url" in target ? target.url : undefined,
      prSafe: target.prSafe,
      cost: target.cost,
      missingSecrets,
      hasInstall: "install" in target ? Boolean(target.install) : false,
      hasBuild: "build" in target ? Boolean(target.build) : false,
      hasServe: "serve" in target ? Boolean(target.serve) : false,
      serviceCount: "services" in target ? (target.services?.length ?? 0) : 0
    };
  });
  return sanitizeObject({
    ok: true,
    project: loaded.config.project.name,
    configPath: loaded.configPath,
    rootDir: loaded.rootDir,
    targetCount: targetRows.length,
    contractCount: loaded.config.contracts.length,
    targets: targetRows,
    contracts: loaded.config.contracts.map((contract) => ({
      id: contract.id,
      target: contract.target,
      severity: contract.severity,
      runOn: contract.runOn
    })),
    externalCallsMade: 0
  });
}

async function buildSetupRecommendationSummary(loaded: LoadedConfig): Promise<Record<string, unknown>> {
  const recommendation = await recommendSetup({
    repoRoot: loaded.rootDir,
    configPath: path.relative(loaded.rootDir, loaded.configPath)
  });
  return sanitizeObject({
    schemaVersion: recommendation.schemaVersion,
    project: recommendation.project,
    setupProfile: recommendation.setupProfile,
    recommendedTarget: recommendation.recommendedTarget,
    recommendedContracts: recommendation.recommendedContracts.map((contract) => ({
      id: contract.id,
      targetId: contract.targetId,
      selectors: contract.selectors,
      screenshots: contract.screenshots,
      reasons: contract.reasons
    })),
    onboardingChecklist: recommendation.onboardingChecklist.map((item) => ({
      id: item.id,
      title: item.title,
      status: item.status,
      action: item.action,
      command: item.command
    })),
    warnings: recommendation.warnings,
    externalCallsMade: 0
  });
}

function buildReadOnlyPlanSummary(loaded: LoadedConfig): Record<string, unknown> {
  const plan = createPlan(loaded.config, {
    mode: "pr",
    changedFiles: [],
    allowUnsafeTargets: false
  });
  return sanitizeObject({
    schemaVersion: plan.schemaVersion,
    project: plan.project,
    mode: plan.mode,
    selectedContracts: plan.items.map((item) => ({
      contractId: item.contractId,
      targetId: item.targetId,
      reasons: item.reasons,
      cost: item.cost
    })),
    selectedTargets: plan.targets,
    excludedContracts: plan.excluded,
    mutation: plan.mutation,
    providerPolicy: plan.providerPolicy,
    externalCallsMade: 0,
    wroteArtifacts: false
  });
}

async function explainLatestFailure(rootDir: string): Promise<string> {
  const report = await readJsonArtifact<Record<string, unknown>>(path.join(rootDir, ".visual-hive", "report.json"));
  const mutation = await readJsonArtifact<Record<string, unknown>>(path.join(rootDir, ".visual-hive", "mutation-report.json"));
  const evidence = await readJsonArtifact<Record<string, unknown>>(path.join(rootDir, ".visual-hive", "evidence-packet.json"));
  const lines = ["# Visual Hive Failure Explanation", ""];
  if (!report && !mutation && !evidence) {
    return "No report, mutation report, or Evidence Packet has been generated yet. Run visual-hive pipeline or visual-hive run/triage/evidence first.";
  }
  const reportStatus = readString(report, "status");
  const verdict = readNestedString(evidence, ["verdictSummary", "visualHiveVerdict"]);
  lines.push(`- Deterministic report: ${reportStatus ?? "missing"}`);
  lines.push(`- Visual Hive verdict: ${verdict ?? "missing"}`);
  const failedContracts = reportResults(report)
    .filter((result) => readString(result, "status") === "failed")
    .map((result) => readString(result, "contractId"))
    .filter(Boolean);
  lines.push(`- Failed contracts: ${failedContracts.length ? failedContracts.join(", ") : "none"}`);
  const survivedMutations = Array.isArray(mutation?.results)
    ? mutation.results.filter((result) => readString(result, "status") === "survived").map((result) => readString(result, "operator")).filter(Boolean)
    : [];
  lines.push(`- Survived mutations: ${survivedMutations.length ? survivedMutations.join(", ") : "none"}`);
  const failedBecause = readNestedStringArray(evidence, ["verdictSummary", "failedBecause"]);
  const blockedBecause = readNestedStringArray(evidence, ["verdictSummary", "blockedBecause"]);
  lines.push(`- Failed because: ${failedBecause.length ? failedBecause.join(", ") : "none"}`);
  lines.push(`- Blocked because: ${blockedBecause.length ? blockedBecause.join(", ") : "none"}`);
  return sanitizeText(lines.join("\n"));
}

async function listReproductionCommands(rootDir: string): Promise<string> {
  const report = await readJsonArtifact<Record<string, unknown>>(path.join(rootDir, ".visual-hive", "report.json"));
  if (!report) {
    return "No deterministic report has been generated yet. Run visual-hive run or visual-hive pipeline first.";
  }
  const commands = new Set<string>();
  if (Array.isArray(report.reproductionCommands)) {
    for (const command of report.reproductionCommands) {
      if (typeof command === "string" && command.trim()) commands.add(command.trim());
    }
  }
  for (const result of reportResults(report)) {
    const command = readString(result, "reproductionCommand");
    if (command) commands.add(command);
  }
  return commands.size
    ? [...commands].map((command) => `- \`${sanitizeText(command)}\``).join("\n")
    : "No reproduction commands were recorded in the latest report.";
}

function reportResults(report?: Record<string, unknown>): Record<string, unknown>[] {
  const results = report?.results;
  if (Array.isArray(results)) return results.filter(isRecord);
  const legacyResults = report?.contractResults;
  if (Array.isArray(legacyResults)) return legacyResults.filter(isRecord);
  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

async function readArtifactText(filePath: string, displayPath: string): Promise<string> {
  try {
    return sanitizeText(await readFile(filePath, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Artifact ${sanitizeText(displayPath)} is not available yet. Generate it with the matching Visual Hive CLI command. Details: ${sanitizeText(message)}`;
  }
}

async function readJsonArtifact<T>(filePath: string): Promise<T | undefined> {
  try {
    return sanitizeObject(JSON.parse(await readFile(filePath, "utf8"))) as T;
  } catch {
    return undefined;
  }
}

function readString(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object" || !(key in value)) return undefined;
  const entry = (value as Record<string, unknown>)[key];
  return typeof entry === "string" && entry.trim() ? sanitizeText(entry) : undefined;
}

function readNestedString(value: unknown, keys: string[]): string | undefined {
  let current = value;
  for (const key of keys) {
    if (!current || typeof current !== "object" || !(key in current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" && current.trim() ? sanitizeText(current) : undefined;
}

function readNestedStringArray(value: unknown, keys: string[]): string[] {
  let current = value;
  for (const key of keys) {
    if (!current || typeof current !== "object" || !(key in current)) return [];
    current = (current as Record<string, unknown>)[key];
  }
  return Array.isArray(current) ? current.filter((entry): entry is string => typeof entry === "string").map((entry) => sanitizeText(entry)) : [];
}

function sanitizeObject<T>(value: T): T {
  return JSON.parse(sanitizeText(JSON.stringify(value))) as T;
}
