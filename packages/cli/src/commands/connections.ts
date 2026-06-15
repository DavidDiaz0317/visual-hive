import path from "node:path";
import {
  addConnection,
  listConnections,
  loadConfig,
  removeConnection,
  type RepoConnectionIndex
} from "@visual-hive/core";

export interface ConnectionsCommandOptions {
  config?: string;
  cwd?: string;
  format?: "markdown" | "json";
}

export interface AddConnectionCommandOptions extends ConnectionsCommandOptions {
  repo: string;
  connectionConfig?: string;
  id?: string;
  label?: string;
  tags?: string[];
}

export interface RemoveConnectionCommandOptions extends ConnectionsCommandOptions {
  id: string;
}

export async function runConnectionsListCommand(options: ConnectionsCommandOptions = {}): Promise<{ index: RepoConnectionIndex; indexPath: string }> {
  const resolved = await resolveConnectionsCommand(options);
  const index = await listConnections({ repoRoot: resolved.rootDir });
  return { index, indexPath: resolved.indexPath };
}

export async function runConnectionsAddCommand(options: AddConnectionCommandOptions): Promise<{ index: RepoConnectionIndex; indexPath: string }> {
  const resolved = await resolveConnectionsCommand(options);
  const index = await addConnection({
    repoRoot: resolved.rootDir,
    repoPath: options.repo,
    configPath: options.connectionConfig,
    id: options.id,
    label: options.label,
    tags: options.tags
  });
  return { index, indexPath: resolved.indexPath };
}

export async function runConnectionsRemoveCommand(options: RemoveConnectionCommandOptions): Promise<{ index: RepoConnectionIndex; indexPath: string }> {
  const resolved = await resolveConnectionsCommand(options);
  const index = await removeConnection({ repoRoot: resolved.rootDir, id: options.id });
  return { index, indexPath: resolved.indexPath };
}

export function formatConnectionsIndex(index: RepoConnectionIndex, indexPath: string, format: "markdown" | "json" = "markdown"): string {
  if (format === "json") return JSON.stringify(index, null, 2);
  const lines = [
    `Connections file: ${indexPath}`,
    `# Visual Hive Connections`,
    "",
    `- Connections: ${index.summary.connectionCount}`,
    `- Stored: ${index.summary.storedConnections}`,
    `- Ready: ${index.summary.readyConnections}`,
    `- Missing config: ${index.summary.missingConfigConnections}`,
    `- Invalid config: ${index.summary.invalidConfigConnections}`,
    `- Missing repo: ${index.summary.missingRepoConnections}`,
    "",
    "## Repositories"
  ];
  for (const connection of index.connections) {
    const status = connection.projectName ? `${connection.status} (${connection.projectName})` : connection.status;
    const tags = connection.tags.length ? ` tags=${connection.tags.join(",")}` : "";
    lines.push(`- ${connection.id}: ${connection.label} - ${status}${tags}`);
    lines.push(`  repo: ${connection.repoRoot}`);
    lines.push(`  config: ${connection.configPath}`);
  }
  if (index.warnings.length) {
    lines.push("", "## Warnings", ...index.warnings.map((warning) => `- ${warning}`));
  }
  return lines.join("\n");
}

async function resolveConnectionsCommand(options: ConnectionsCommandOptions): Promise<{ rootDir: string; indexPath: string }> {
  const cwd = options.cwd ?? process.cwd();
  const loaded = await loadConfig(options.config ?? "visual-hive.config.yaml", cwd);
  return {
    rootDir: loaded.rootDir,
    indexPath: path.join(loaded.rootDir, ".visual-hive", "connections.json")
  };
}
