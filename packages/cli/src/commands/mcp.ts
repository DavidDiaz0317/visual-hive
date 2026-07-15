import { readFile } from "node:fs/promises";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { visualHiveVersion } from "../version.js";
import {
  VISUAL_HIVE_EVIDENCE_RESOURCES,
  createPlan,
  getEvidenceResourceByReadToolName,
  loadConfig,
  recommendSetup,
  sanitizeText,
  writeJson,
  type LoadedConfig
} from "@visual-hive/core";

export interface McpCommandOptions {
  config?: string;
  cwd?: string;
  stdio?: boolean;
  describe?: boolean;
  output?: string;
  project?: string;
  repo?: string;
}

export interface McpResourceDefinition {
  id: string;
  uri: string;
  name: string;
  title: string;
  description: string;
  relativePath: string;
  mimeType: string;
  readToolName?: string;
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

export const MCP_RESOURCES: McpResourceDefinition[] = VISUAL_HIVE_EVIDENCE_RESOURCES.map((resource) => ({
  id: resource.id,
  uri: resource.uri,
  name: resource.name,
  title: resource.title,
  description: resource.description,
  relativePath: resource.relativePath,
  mimeType: resource.mimeType,
  ...(resource.readTool ? { readToolName: resource.readTool.name } : {})
}));

const MCP_STATIC_READ_ONLY_TOOLS: McpToolDefinition[] = [
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
    name: "visual_hive_list_issues",
    title: "List Issues",
    description: "Summarize Visual Hive issue candidates without creating, updating, or closing GitHub issues.",
    mode: "read_only"
  },
  {
    name: "visual_hive_query_visual_graph",
    title: "Query Visual Graph",
    description: "Return compact Visual Graph, vocabulary, unresolved-reference, and impact summaries without rescanning or running targets.",
    mode: "read_only"
  },
  {
    name: "visual_hive_get_visual_impact",
    title: "Get Visual Impact",
    description: "Read the latest Visual Impact analysis without running validation commands or changing issue state.",
    mode: "read_only"
  },
  {
    name: "visual_hive_list_artifacts",
    title: "List Artifacts",
    description: "Summarize the sanitized Visual Hive artifact index for issue and evidence navigation.",
    mode: "read_only"
  },
  {
    name: "visual_hive_get_validation_command",
    title: "Get Validation Command",
    description: "List validation commands keyed by exact issue fingerprint, or report-level reproduction commands when no issues exist.",
    mode: "read_only"
  },
  {
    name: "visual_hive_get_agent_prompt",
    title: "Get Agent Prompt",
    description: "List issue-agent request paths keyed by exact issue fingerprint without executing an agent.",
    mode: "read_only"
  },
  {
    name: "visual_hive_get_handoff_context",
    title: "Get Handoff Context",
    description: "Return compact handoff and Hive export context without creating issues, Beads, branches, or PRs.",
    mode: "read_only"
  },
  {
    name: "visual_hive_get_hive_export",
    title: "Get Hive Export",
    description: "Return compact Hive export context for agents without importing beads or calling Hive APIs.",
    mode: "read_only"
  },
  {
    name: "visual_hive_list_hive_beads",
    title: "List Hive Beads",
    description: "List Hive bead projections generated from Visual Hive issue candidates without creating beads in Hive.",
    mode: "read_only"
  },
  {
    name: "visual_hive_get_hive_bead_context",
    title: "Get Hive Bead Context",
    description: "Return one Hive bead projection with linked Visual Hive issue, evidence, graph, and validation context.",
    mode: "read_only"
  },
  {
    name: "visual_hive_get_hive_agent_work_order",
    title: "Get Hive Agent Work Order",
    description: "Return one Hive-compatible agent work order without executing an agent or writing source files.",
    mode: "read_only"
  }
];

const MCP_RESOURCE_READ_TOOLS: McpToolDefinition[] = VISUAL_HIVE_EVIDENCE_RESOURCES.flatMap((resource) =>
  resource.readTool
    ? [
        {
          name: resource.readTool.name,
          title: resource.readTool.title,
          description: resource.readTool.description,
          mode: "read_only" as const
        }
      ]
    : []
);

export const MCP_READ_ONLY_TOOLS: McpToolDefinition[] = [
  ...MCP_STATIC_READ_ONLY_TOOLS,
  ...MCP_RESOURCE_READ_TOOLS
];

const SETUP_ONLY_RESOURCE_IDS = new Set([
  "setup-recommendations",
  "setup-pr-plan",
  "repo-map",
  "repo-context",
  "artifacts-index",
  "mcp-manifest"
]);
const SETUP_ONLY_STATIC_TOOLS = new Set(["visual_hive_recommend_setup"]);

export const MCP_DISABLED_EXECUTION_TOOLS: McpToolDefinition[] = [
  "visual_hive_run",
  "visual_hive_mutate",
  "visual_hive_update_baseline",
  "visual_hive_handoff_github_issue",
  "visual_hive_handoff_hive_bead",
  "visual_hive_hive_repair",
  "visual_hive_provider_upload",
  "visual_hive_apply_patch",
  "visual_hive_open_pr"
].map((name) => ({
  name,
  title: name.replaceAll("_", " "),
  description: "Execution or write-capable tool intentionally disabled by default. Use the CLI in a trusted workflow instead.",
  mode: "execution_disabled" as const
}));

export async function runMcpCommand(options: McpCommandOptions = {}): Promise<McpManifest> {
  if (options.repo) {
    if (options.stdio) {
      throw new Error("visual-hive mcp --repo is manifest-only. Generate setup artifacts with visual-hive recommend, then run visual-hive mcp --repo <path> --describe or --output <path>.");
    }
    const cwd = options.cwd ?? process.cwd();
    const repoRoot = path.resolve(cwd, options.repo);
    const manifest = buildSetupOnlyMcpManifest(options.project ?? path.basename(repoRoot));
    if (options.output) {
      await writeJson(path.resolve(repoRoot, options.output), manifest);
    }
    return manifest;
  }
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
    ...manifest.resources.map((resource) => {
      const readTool = resource.readToolName ? `; read tool: ${resource.readToolName}` : "";
      return `- ${resource.id}: ${resource.uri} -> ${resource.relativePath}${readTool}`;
    }),
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
    version: visualHiveVersion
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

export function buildSetupOnlyMcpManifest(project: string): McpManifest {
  const resources = MCP_RESOURCES.filter((resource) => SETUP_ONLY_RESOURCE_IDS.has(resource.id));
  const resourceToolNames = new Set(resources.map((resource) => resource.readToolName).filter((name): name is string => Boolean(name)));
  return sanitizeObject({
    schemaVersion: "visual-hive.mcp.v1",
    project,
    server: {
      name: "visual-hive",
      transport: "stdio",
      defaultAccess: "read_only",
      externalCallsMade: 0
    },
    resources,
    tools: MCP_READ_ONLY_TOOLS.filter((tool) => SETUP_ONLY_STATIC_TOOLS.has(tool.name) || resourceToolNames.has(tool.name)),
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

export async function callReadOnlyTool(loaded: LoadedConfig, toolName: string): Promise<string> {
  const resourceTool = getEvidenceResourceByReadToolName(toolName);
  if (resourceTool) {
    const filePath = resourceTool.uri === "visual-hive://config" ? loaded.configPath : path.join(loaded.rootDir, resourceTool.relativePath);
    return readArtifactText(filePath, resourceTool.relativePath);
  }

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
    case "visual_hive_explain_failure":
      return explainLatestFailure(loaded.rootDir);
    case "visual_hive_list_reproduction_commands":
      return listReproductionCommands(loaded.rootDir);
    case "visual_hive_list_issues":
      return JSON.stringify(await listIssues(loaded.rootDir), null, 2);
    case "visual_hive_query_visual_graph":
      return JSON.stringify(await queryVisualGraph(loaded.rootDir), null, 2);
    case "visual_hive_get_visual_impact":
      return JSON.stringify(await readNamedJson(loaded.rootDir, ".visual-hive/visual-impact.json", "Run visual-hive graph impact first."), null, 2);
    case "visual_hive_list_artifacts":
      return JSON.stringify(await listArtifacts(loaded.rootDir), null, 2);
    case "visual_hive_get_validation_command":
      return JSON.stringify(await getValidationCommand(loaded.rootDir), null, 2);
    case "visual_hive_get_agent_prompt":
      return JSON.stringify(await getAgentPrompt(loaded.rootDir), null, 2);
    case "visual_hive_get_handoff_context":
      return JSON.stringify(await getHandoffContext(loaded.rootDir), null, 2);
    case "visual_hive_get_hive_export":
      return JSON.stringify(await getHiveExportContext(loaded.rootDir), null, 2);
    case "visual_hive_list_hive_beads":
      return JSON.stringify(await listHiveBeads(loaded.rootDir), null, 2);
    case "visual_hive_get_hive_bead_context":
      return JSON.stringify(await getHiveBeadContext(loaded.rootDir), null, 2);
    case "visual_hive_get_hive_agent_work_order":
      return JSON.stringify(await getHiveAgentWorkOrder(loaded.rootDir), null, 2);
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

async function listIssues(rootDir: string): Promise<Record<string, unknown>> {
  const issues = await readJsonArtifact<Record<string, unknown>>(path.join(rootDir, ".visual-hive", "issues.json"));
  if (!issues) {
    return missingJson(".visual-hive/issues.json", "Run visual-hive issues --write first.");
  }
  const candidates = Array.isArray(issues.issues) ? issues.issues.filter(isRecord) : [];
  return sanitizeObject({
    schemaVersion: issues.schemaVersion,
    project: issues.project,
    summary: issues.summary,
    externalCallsMade: issues.externalCallsMade ?? 0,
    networkCallsMade: issues.networkCallsMade ?? 0,
    issues: candidates.map((issue) => ({
      dedupeFingerprint: readString(issue, "dedupeFingerprint"),
      title: readString(issue, "title"),
      issueKind: readString(issue, "issueKind"),
      severity: readString(issue, "severity"),
      status: readString(issue, "status"),
      owningAgentHint: readString(issue, "owningAgentHint"),
      validationCommand: readString(issue, "validationCommand")
    }))
  });
}

async function queryVisualGraph(rootDir: string): Promise<Record<string, unknown>> {
  const graph = await readJsonArtifact<Record<string, unknown>>(path.join(rootDir, ".visual-hive", "visual-graph.json"));
  const vocab = await readJsonArtifact<Record<string, unknown>>(path.join(rootDir, ".visual-hive", "visual-graph-vocab.json"));
  const unresolved = await readJsonArtifact<Record<string, unknown>>(path.join(rootDir, ".visual-hive", "visual-graph-unresolved.json"));
  const impact = await readJsonArtifact<Record<string, unknown>>(path.join(rootDir, ".visual-hive", "visual-impact.json"));
  return sanitizeObject({
    graph: graph
      ? {
          schemaVersion: graph.schemaVersion,
          project: graph.project,
          summary: graph.summary,
          nodeCount: Array.isArray(graph.nodes) ? graph.nodes.length : undefined,
          edgeCount: Array.isArray(graph.edges) ? graph.edges.length : undefined
        }
      : missingJson(".visual-hive/visual-graph.json", "Run visual-hive analyze or visual-hive graph search first."),
    vocab: vocab
      ? {
          schemaVersion: vocab.schemaVersion,
          project: vocab.project,
          summary: vocab.summary,
          termCount: Array.isArray(vocab.entries) ? vocab.entries.length : undefined
        }
      : missingJson(".visual-hive/visual-graph-vocab.json", "Run visual-hive analyze or visual-hive graph search first."),
    unresolved: unresolved
      ? {
          schemaVersion: unresolved.schemaVersion,
          summary: unresolved.summary,
          unresolvedCount: Array.isArray(unresolved.unresolvedReferences) ? unresolved.unresolvedReferences.length : undefined
        }
      : missingJson(".visual-hive/visual-graph-unresolved.json", "Run visual-hive graph impact first."),
    latestImpact: impact
      ? {
          schemaVersion: impact.schemaVersion,
          project: impact.project,
          summary: impact.summary,
          validationCommands: impact.validationCommands
        }
      : missingJson(".visual-hive/visual-impact.json", "Run visual-hive graph impact first."),
    searchCommand: "visual-hive graph search <selector-route-contract-or-mutation>",
    impactCommand: "visual-hive graph impact --changed-files changed-files.txt",
    safety: {
      readOnly: true,
      externalCallsMade: 0,
      networkCallsMade: 0,
      writesMade: 0
    }
  });
}

async function listArtifacts(rootDir: string): Promise<Record<string, unknown>> {
  const index = await readJsonArtifact<Record<string, unknown>>(path.join(rootDir, ".visual-hive", "artifacts-index.json"));
  if (!index) {
    return missingJson(".visual-hive/artifacts-index.json", "Run visual-hive artifacts first.");
  }
  const artifacts = Array.isArray(index.artifacts) ? index.artifacts.filter(isRecord) : [];
  return sanitizeObject({
    schemaVersion: index.schemaVersion,
    project: index.project,
    summary: index.summary,
    artifacts: artifacts.map((artifact) => ({
      path: readString(artifact, "path"),
      type: readString(artifact, "type"),
      schemaPath: readString(artifact, "schemaPath"),
      evidenceResourceId: readString(artifact, "evidenceResourceId"),
      evidenceResourceUri: readString(artifact, "evidenceResourceUri"),
      evidenceReadToolName: readString(artifact, "evidenceReadToolName"),
      labels: Array.isArray(artifact.labels) ? artifact.labels.filter((item): item is string => typeof item === "string") : []
    }))
  });
}

async function getValidationCommand(rootDir: string): Promise<Record<string, unknown>> {
  const issues = await readJsonArtifact<Record<string, unknown>>(path.join(rootDir, ".visual-hive", "issues.json"));
  const candidates = Array.isArray(issues?.issues) ? issues.issues.filter(isRecord) : [];
  if (candidates.length > 0) {
    return sanitizeObject({
      source: ".visual-hive/issues.json",
      selection: "explicit_identity_required",
      issues: candidates.map((candidate) => ({
        dedupeFingerprint: readString(candidate, "dedupeFingerprint"),
        title: readString(candidate, "title"),
        status: readString(candidate, "status"),
        validationCommand: readString(candidate, "validationCommand") ?? "not recorded",
        reproductionCommand: readString(candidate, "reproductionCommand")
      }))
    });
  }
  const commands = await listReproductionCommands(rootDir);
  return sanitizeObject({
    source: ".visual-hive/report.json",
    validationCommand: commands,
    note: "No active issue candidate was available, so reproduction commands from the latest report were returned."
  });
}

async function getAgentPrompt(rootDir: string): Promise<Record<string, unknown>> {
  const issues = await readJsonArtifact<Record<string, unknown>>(path.join(rootDir, ".visual-hive", "issues.json"));
  const candidates = Array.isArray(issues?.issues) ? issues.issues.filter(isRecord) : [];
  const requests = (await Promise.all(candidates.map(async (candidate) => {
    const dedupeFingerprint = readString(candidate, "dedupeFingerprint");
    if (!dedupeFingerprint) return undefined;
    const requestPath = path.join(".visual-hive", "agents", safeSegment(dedupeFingerprint), "agent-request.md").replaceAll(path.sep, "/");
    const exists = await readJsonlessArtifact(path.join(rootDir, requestPath));
    return { dedupeFingerprint, requestPath: exists === undefined ? null : requestPath };
  }))).filter((item): item is { dedupeFingerprint: string; requestPath: string | null } => item !== undefined);
  return sanitizeObject({
    status: requests.some((request) => request.requestPath) ? "available" : "not_generated",
    selection: "explicit_identity_required",
    requests,
    generateNote: "Prompt generation remains outside the read-only repair MCP session. Select an exact issue identity through Hive policy.",
    recommendedMcpPath: [
      "visual_hive_get_issue_context",
      "visual_hive_read_issue_queue",
      "visual_hive_query_visual_graph",
      "visual_hive_get_visual_impact",
      "visual_hive_read_evidence_packet",
      "visual_hive_read_mutation_report",
      "visual_hive_get_validation_command",
      "visual_hive_get_handoff_context"
    ],
    outputContract: ["summary", "graphNodesUsed", "artifactsUsed", "proposedChanges", "validationCommand", "safetyNotes"],
    safety: {
      noWriteDefault: true,
      visualHiveOwnsVerdict: true,
      externalCallsMade: 0,
      networkCallsMade: 0
    }
  });
}

async function getHandoffContext(rootDir: string): Promise<Record<string, unknown>> {
  const handoff = await readJsonArtifact<Record<string, unknown>>(path.join(rootDir, ".visual-hive", "handoff.json"));
  const hiveExport = await readJsonArtifact<Record<string, unknown>>(path.join(rootDir, ".visual-hive", "hive", "hive-export.json"));
  return sanitizeObject({
    handoff: handoff
      ? {
          schemaVersion: handoff.schemaVersion,
          project: handoff.project,
          summary: handoff.summary,
          status: handoff.status,
          externalCallsMade: handoff.externalCallsMade ?? 0
        }
      : missingJson(".visual-hive/handoff.json", "Run visual-hive handoff --dry-run first."),
    hiveExport: hiveExport
      ? {
          schemaVersion: hiveExport.schemaVersion,
          project: hiveExport.project,
          summary: hiveExport.summary,
          externalCallsMade: hiveExport.externalCallsMade ?? 0
        }
      : missingJson(".visual-hive/hive/hive-export.json", "Run visual-hive hive export --dry-run first."),
    safety: {
      readOnly: true,
      createsIssues: false,
      createsHiveBeads: false,
      createsBranches: false,
      createsPullRequests: false,
      externalCallsMade: 0,
      networkCallsMade: 0
    }
  });
}

async function getHiveExportContext(rootDir: string): Promise<Record<string, unknown>> {
  const hiveExport = await readJsonArtifact<Record<string, unknown>>(path.join(rootDir, ".visual-hive", "hive", "hive-export.json"));
  if (!hiveExport) {
    return missingJson(".visual-hive/hive/hive-export.json", "Run visual-hive hive export --config visual-hive.config.yaml first.");
  }
  return sanitizeObject({
    schemaVersion: hiveExport.schemaVersion,
    project: hiveExport.project,
    repository: hiveExport.repository,
    createdAt: hiveExport.createdAt,
    acmm: hiveExport.acmm,
    summary: hiveExport.summary,
    verdictSummary: hiveExport.verdictSummary,
    issueCandidates: Array.isArray(hiveExport.issueCandidates) ? hiveExport.issueCandidates.length : 0,
    beadProjections: Array.isArray(hiveExport.beads) ? hiveExport.beads.length : 0,
    evidenceRefs: hiveExport.evidenceRefs,
    safety: {
      readOnly: true,
      externalCallsMade: hiveExport.externalCallsMade ?? 0,
      networkCallsMade: hiveExport.networkCallsMade ?? 0,
      createsBeads: false,
      createsIssues: false
    }
  });
}

async function listHiveBeads(rootDir: string): Promise<Record<string, unknown>> {
  const hiveBeads =
    (await readJsonArtifact<Record<string, unknown>>(path.join(rootDir, ".visual-hive", "hive", "hive-beads.json"))) ??
    (await readJsonArtifact<Record<string, unknown>>(path.join(rootDir, ".visual-hive", "hive", "beads.json")));
  if (!hiveBeads) {
    return missingJson(".visual-hive/hive/hive-beads.json", "Run visual-hive hive beads --config visual-hive.config.yaml first.");
  }
  const beads = hiveBeadsList(hiveBeads);
  return sanitizeObject({
    schemaVersion: hiveBeads.schemaVersion,
    project: hiveBeads.project,
    summary: hiveBeads.summary,
    beads: beads.map((bead) => ({
      id: readString(bead, "id"),
      title: readString(bead, "title"),
      type: readString(bead, "type"),
      status: readString(bead, "status"),
      priority: readString(bead, "priority"),
      actor: readString(bead, "actor"),
      externalRef: readString(bead, "external_ref"),
      validationCommand: readNestedString(bead, ["metadata", "visual_hive_validation_command"])
    })),
    safety: {
      readOnly: true,
      externalCallsMade: 0,
      networkCallsMade: 0,
      createsBeads: false
    }
  });
}

async function getHiveBeadContext(rootDir: string): Promise<Record<string, unknown>> {
  const hiveBeads =
    (await readJsonArtifact<Record<string, unknown>>(path.join(rootDir, ".visual-hive", "hive", "hive-beads.json"))) ??
    (await readJsonArtifact<Record<string, unknown>>(path.join(rootDir, ".visual-hive", "hive", "beads.json")));
  const workOrders = await readJsonArtifact<Record<string, unknown>>(path.join(rootDir, ".visual-hive", "hive", "hive-agent-work-orders.json"));
  if (!hiveBeads) {
    return missingJson(".visual-hive/hive/hive-beads.json", "Run visual-hive hive beads --config visual-hive.config.yaml first.");
  }
  const beads = hiveBeadsList(hiveBeads);
  if (beads.length === 0) {
    return sanitizeObject({
      status: "missing",
      message: "No Hive bead projections are available.",
      externalCallsMade: 0,
      networkCallsMade: 0
    });
  }
  const orders = Array.isArray(workOrders?.workOrders) ? workOrders.workOrders.filter(isRecord) : [];
  return sanitizeObject({
    status: "identity_required",
    beads: beads.map((bead) => ({ id: readString(bead, "id"), externalRef: readString(bead, "external_ref"), title: readString(bead, "title") })),
    workOrders: orders.map((order) => ({ id: readString(order, "id"), externalRef: readString(order, "externalRef"), dedupeFingerprint: readString(order, "dedupeFingerprint") })),
    recommendedReadPath: [
      "visual_hive_get_hive_export",
      "visual_hive_list_hive_beads",
      "visual_hive_get_hive_agent_work_order",
      "visual_hive_get_issue_context",
      "visual_hive_query_visual_graph",
      "visual_hive_read_evidence_packet",
      "visual_hive_get_validation_command"
    ],
    safety: {
      readOnly: true,
      createsBeads: false,
      createsIssues: false,
      executesAgents: false,
      externalCallsMade: 0,
      networkCallsMade: 0
    }
  });
}

function hiveBeadsList(hiveBeads: Record<string, unknown>): Record<string, unknown>[] {
  if (Array.isArray(hiveBeads)) return hiveBeads.filter(isRecord);
  return Array.isArray(hiveBeads.beads) ? hiveBeads.beads.filter(isRecord) : [];
}

async function getHiveAgentWorkOrder(rootDir: string): Promise<Record<string, unknown>> {
  const workOrders = await readJsonArtifact<Record<string, unknown>>(path.join(rootDir, ".visual-hive", "hive", "hive-agent-work-orders.json"));
  if (!workOrders) {
    return missingJson(".visual-hive/hive/hive-agent-work-orders.json", "Run visual-hive hive validate-export --config visual-hive.config.yaml first.");
  }
  const orders = Array.isArray(workOrders.workOrders) ? workOrders.workOrders.filter(isRecord) : [];
  return sanitizeObject({
    schemaVersion: workOrders.schemaVersion,
    project: workOrders.project,
    selection: "explicit_identity_required",
    workOrders: orders,
    count: orders.length,
    policy: workOrders.policy,
    safety: {
      readOnly: true,
      executesAgent: false,
      writesSource: false,
      externalCallsMade: 0,
      networkCallsMade: 0
    }
  });
}

async function readNamedJson(rootDir: string, relativePath: string, generateHint: string): Promise<Record<string, unknown>> {
  return (await readJsonArtifact<Record<string, unknown>>(path.join(rootDir, relativePath))) ?? missingJson(relativePath, generateHint);
}

async function readJsonlessArtifact(filePath: string): Promise<string | undefined> {
  try {
    return sanitizeText(await readFile(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

function missingJson(relativePath: string, generateHint: string): Record<string, unknown> {
  return sanitizeObject({
    status: "missing",
    artifact: relativePath,
    generateHint,
    externalCallsMade: 0,
    networkCallsMade: 0
  });
}

function reportResults(report?: Record<string, unknown>): Record<string, unknown>[] {
  const results = report?.results;
  if (Array.isArray(results)) return results.filter(isRecord);
  const legacyResults = report?.contractResults;
  if (Array.isArray(legacyResults)) return legacyResults.filter(isRecord);
  return [];
}

function safeSegment(value: string): string {
  return sanitizeText(value).replace(/[^A-Za-z0-9_.-]+/g, "-").slice(0, 96);
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
