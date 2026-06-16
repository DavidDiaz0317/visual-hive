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
    `- Needs attention: ${index.summary.connectionsNeedingAttention}`,
    `- Blocked: ${index.summary.blockedConnections}`,
    `- Failed deterministic reports: ${index.summary.failedConnections}`,
    `- Missing deterministic reports: ${index.summary.missingReportConnections}`,
    `- Stale deterministic reports: ${index.summary.staleReportConnections}`,
    `- Weak mutation scores: ${index.summary.weakMutationConnections}`,
    `- Missing coverage audits: ${index.summary.missingCoverageConnections}`,
    `- Coverage gaps: ${index.summary.coverageGapConnections}`,
    `- High coverage gaps: ${index.summary.highCoverageGapConnections}`,
    `- High risk registers: ${index.summary.highRiskConnections}`,
    `- Missing config: ${index.summary.missingConfigConnections}`,
    `- Invalid config: ${index.summary.invalidConfigConnections}`,
    `- Missing repo: ${index.summary.missingRepoConnections}`,
    "",
    "## Repositories"
  ];
  for (const connection of index.connections) {
    const status = connection.projectName ? `${connection.status} (${connection.projectName})` : connection.status;
    const tags = connection.tags.length ? ` tags=${connection.tags.join(",")}` : "";
    const mutation =
      connection.latestMutationScore === undefined
        ? "mutation=not run"
        : `mutation=${Math.round(connection.latestMutationScore * 100)}%${connection.mutationMinScore === undefined ? "" : ` min=${Math.round(connection.mutationMinScore * 100)}%`}`;
    const coverage =
      connection.missingCoverage || connection.coverageGapCount === undefined
        ? "coverage=not run"
        : `coverage=${connection.coverageGapCount} gap(s), high=${connection.highCoverageGapCount ?? 0}`;
    const risk = connection.latestRiskScore === undefined ? "risk=not run" : `risk=${connection.latestRiskScore}/100 ${connection.latestRiskSeverity ?? ""}`.trim();
    lines.push(`- ${connection.id}: ${connection.label} - ${connection.health} / ${status}${tags}`);
    lines.push(`  repo: ${connection.repoRoot}`);
    lines.push(`  config: ${connection.configPath}`);
    lines.push(
      `  latest: ${connection.latestDeterministicStatus ?? "no report"}${connection.latestReportAgeDays === undefined ? "" : ` (${connection.latestReportAgeDays}d old)`}; ${mutation}; ${coverage}; ${risk}`
    );
    if (connection.attention.length) lines.push(`  attention: ${connection.attention.join(" ")}`);
  }
  const activeQueues = index.portfolio.queues.filter((queue) => queue.count > 0);
  if (activeQueues.length) {
    lines.push("", "## Portfolio Queues");
    for (const queue of activeQueues) {
      const repos = queue.connections.map((connection) => `${connection.id}(${connection.score})`).join(", ");
      lines.push(`- ${queue.label}: ${queue.count} - ${repos}`);
      lines.push(`  next: ${queue.nextAction}`);
    }
  }
  if (index.portfolio.topAttention.length) {
    lines.push("", "## Top Attention");
    for (const connection of index.portfolio.topAttention) {
      lines.push(`- ${connection.id}: ${connection.label} score=${connection.score} reasons=${connection.reasons.join(" ")}`);
    }
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
