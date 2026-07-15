import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { visualHiveVersion } from "../version.js";
import { VISUAL_REPAIR_MCP_TOOL_DEFINITIONS, callVisualRepairMcpTool, type VisualRepairMcpRuntime } from "./repairMcpTools.js";
import {
  assertVerifiedVisualHiveProducerIdentityMatchesPin,
  resolveVerifiedVisualHiveProducerIdentity,
  type VerifiedVisualHiveProducerIdentity
} from "./repairProducerIdentity.js";
import { loadHiveRepairSessionSnapshot } from "./repairSessionScope.js";
import type { HiveRepairSession } from "@visual-hive/core";

export interface RepairMcpCommandOptions {
  storeRoot: string;
  hiveSession: string;
  stdio?: boolean;
}

export interface RepairMcpManifest {
  schemaVersion: "visual-hive.repair-mcp.v1";
  server: { name: "visual-hive-repair"; version: string; transport: "stdio"; defaultAccess: "read_only" };
  storeRoot: string;
  scope: {
    sessionId: string;
    sessionDigest: string;
    taskId: string;
    taskContextDigest: string;
    repository: string;
    baseSha: string;
    findingFingerprint: string;
    authorizationDigest: string;
    visualHiveVersion: string;
    visualHiveCommit: string;
    visualHiveManifestSha256: string;
    visualHiveEntrypointSha256: string;
  };
  tools: Array<{ name: string; title: string; description: string }>;
  safety: {
    exactToolSet: true;
    readOnly: true;
    executionTools: false;
    lifecycleWrites: false;
    externalCallsMade: 0;
    networkCallsMade: 0;
  };
}

export interface RepairMcpCommandDependencies {
  resolveProducerIdentity: () => Promise<Readonly<VerifiedVisualHiveProducerIdentity>>;
}

const DEFAULT_REPAIR_MCP_DEPENDENCIES: RepairMcpCommandDependencies = {
  resolveProducerIdentity: resolveVerifiedVisualHiveProducerIdentity
};

export async function runRepairMcpCommand(
  options: RepairMcpCommandOptions,
  dependencies: RepairMcpCommandDependencies = DEFAULT_REPAIR_MCP_DEPENDENCIES
): Promise<RepairMcpManifest> {
  const storeRoot = await resolveOrdinaryDirectory(options.storeRoot);
  const session = await loadHiveRepairSessionSnapshot(options.hiveSession);
  const producer = await dependencies.resolveProducerIdentity();
  assertVerifiedVisualHiveProducerIdentityMatchesPin(producer, session.capability);
  const manifest = buildRepairMcpManifest(storeRoot, session, producer);
  if (options.stdio) {
    const server = createRepairMcpServer(storeRoot, session, producer);
    await server.connect(new StdioServerTransport());
  }
  return manifest;
}

export function buildRepairMcpManifest(
  storeRoot: string,
  session: HiveRepairSession,
  producer: Readonly<VerifiedVisualHiveProducerIdentity>
): RepairMcpManifest {
  if (session.effectiveMode !== "visual_hive" || !session.authorization) throw new Error("Repair MCP requires an authorized visual_hive Hive session.");
  assertVerifiedVisualHiveProducerIdentityMatchesPin(producer, session.capability);
  return {
    schemaVersion: "visual-hive.repair-mcp.v1",
    server: { name: "visual-hive-repair", version: visualHiveVersion, transport: "stdio", defaultAccess: "read_only" },
    storeRoot: path.resolve(storeRoot),
    scope: {
      sessionId: session.sessionId,
      sessionDigest: session.sessionDigest,
      taskId: session.task.taskId,
      taskContextDigest: session.task.taskContextDigest,
      repository: session.repository.name,
      baseSha: session.repository.baseSha,
      findingFingerprint: session.finding.fingerprint,
      authorizationDigest: session.authorization.authorizationDigest,
      visualHiveVersion: producer.visualHiveVersion,
      visualHiveCommit: producer.visualHiveCommit,
      visualHiveManifestSha256: producer.manifestSha256,
      visualHiveEntrypointSha256: producer.entrypointSha256
    },
    tools: VISUAL_REPAIR_MCP_TOOL_DEFINITIONS.map(({ name, title, description }) => ({ name, title, description })),
    safety: {
      exactToolSet: true,
      readOnly: true,
      executionTools: false,
      lifecycleWrites: false,
      externalCallsMade: 0,
      networkCallsMade: 0
    }
  };
}

export function createRepairMcpServer(
  storeRoot: string,
  session: HiveRepairSession,
  producer: Readonly<VerifiedVisualHiveProducerIdentity>,
  runtime: VisualRepairMcpRuntime = {}
): McpServer {
  const root = path.resolve(storeRoot);
  if (session.effectiveMode !== "visual_hive" || !session.authorization) throw new Error("Repair MCP requires an authorized visual_hive Hive session.");
  assertVerifiedVisualHiveProducerIdentityMatchesPin(producer, session.capability);
  const server = new McpServer({ name: "visual-hive-repair", version: visualHiveVersion });
  for (const tool of VISUAL_REPAIR_MCP_TOOL_DEFINITIONS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
      },
      async (args) => callVisualRepairMcpTool(root, tool.name, args, session, producer, runtime)
    );
  }
  return server;
}

async function resolveOrdinaryDirectory(value: string): Promise<string> {
  const absolute = path.resolve(value);
  const entry = await lstat(absolute);
  if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error("Visual Hive repair MCP store root must be an ordinary directory, not a symbolic link.");
  const resolved = await realpath(absolute);
  const comparableResolved = process.platform === "win32" ? resolved.toLowerCase() : resolved;
  const comparableAbsolute = process.platform === "win32" ? absolute.toLowerCase() : absolute;
  if (comparableResolved !== comparableAbsolute) throw new Error("Visual Hive repair MCP store root must use its canonical real path.");
  return resolved;
}
