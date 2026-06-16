import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../config/load.js";
import type { CoverageReport } from "../coverage/analyze.js";
import type { MutationReport, Report } from "../reports/types.js";
import type { RiskRegisterReport, RiskSeverity } from "../risk/analyze.js";
import { readJson, writeJson } from "../utils/files.js";
import { sanitizeText } from "../utils/sanitize.js";

export type ConnectionStatus = "ready" | "missing_repo" | "missing_config" | "invalid_config";
export type ConnectionHealth = "ready" | "attention" | "blocked";
const STALE_REPORT_DAYS = 7;

export interface RepoConnectionRecord {
  id: string;
  label: string;
  repoRoot: string;
  configPath: string;
  tags: string[];
  addedAt: string;
  updatedAt: string;
}

export interface RepoConnectionEntry extends RepoConnectionRecord {
  stored: boolean;
  status: ConnectionStatus;
  health: ConnectionHealth;
  projectName?: string;
  latestDeterministicStatus?: "passed" | "failed";
  latestReportAt?: string;
  latestReportAgeDays?: number;
  staleReport: boolean;
  latestMutationScore?: number;
  latestMutationAt?: string;
  mutationMinScore?: number;
  mutationKilled?: number;
  mutationTotal?: number;
  latestCoverageAt?: string;
  coverageGapCount?: number;
  highCoverageGapCount?: number;
  mediumCoverageGapCount?: number;
  uncoveredTargets?: number;
  uncoveredContracts?: number;
  missingCoverage: boolean;
  latestRiskScore?: number;
  latestRiskSeverity?: RiskSeverity | "none";
  latestRiskAt?: string;
  attention: string[];
  warnings: string[];
}

export interface RepoConnectionIndex {
  schemaVersion: 1;
  generatedAt: string;
  rootRepo: string;
  connectionsPath: string;
  summary: {
    connectionCount: number;
    storedConnections: number;
    readyConnections: number;
    missingConfigConnections: number;
    invalidConfigConnections: number;
    missingRepoConnections: number;
    blockedConnections: number;
    connectionsNeedingAttention: number;
    failedConnections: number;
    missingReportConnections: number;
    weakMutationConnections: number;
    highRiskConnections: number;
    staleReportConnections: number;
    missingCoverageConnections: number;
    coverageGapConnections: number;
    highCoverageGapConnections: number;
  };
  connections: RepoConnectionEntry[];
  warnings: string[];
}

export interface ConnectionStoreFile {
  schemaVersion: 1;
  connections: RepoConnectionRecord[];
}

export interface ConnectionStoreOptions {
  repoRoot: string;
  connectionsPath?: string;
  now?: Date;
}

export interface AddConnectionOptions extends ConnectionStoreOptions {
  repoPath: string;
  configPath?: string;
  id?: string;
  label?: string;
  tags?: string[];
}

export interface RemoveConnectionOptions extends ConnectionStoreOptions {
  id: string;
}

export async function listConnections(options: ConnectionStoreOptions): Promise<RepoConnectionIndex> {
  const resolved = await resolveConnectionStore(options);
  const store = await readStore(resolved.connectionsPath);
  const current = await inspectConnection(
    {
      id: "current",
      label: "Current repository",
      repoRoot: resolved.repoRoot,
      configPath: path.join(resolved.repoRoot, "visual-hive.config.yaml"),
      tags: ["current"],
      addedAt: resolved.now.toISOString(),
      updatedAt: resolved.now.toISOString()
    },
    false,
    resolved.now
  );
  const stored = await Promise.all(store.connections.map((connection) => inspectConnection(connection, true, resolved.now)));
  const byId = new Map<string, RepoConnectionEntry>();
  byId.set(current.id, current);
  for (const connection of stored) {
    byId.set(connection.id, connection);
  }
  const connections = [...byId.values()].sort((a, b) => (a.id === "current" ? -1 : b.id === "current" ? 1 : a.id.localeCompare(b.id)));
  const warnings = connections.flatMap((connection) => connection.warnings.map((warning) => `${connection.id}: ${warning}`));
  return {
    schemaVersion: 1,
    generatedAt: resolved.now.toISOString(),
    rootRepo: resolved.repoRoot,
    connectionsPath: toRepoRelativePath(resolved.repoRoot, resolved.connectionsPath),
    summary: summarize(connections),
    connections,
    warnings
  };
}

export async function addConnection(options: AddConnectionOptions): Promise<RepoConnectionIndex> {
  const resolved = await resolveConnectionStore(options);
  const store = await readStore(resolved.connectionsPath);
  const repoRoot = await canonicalDirectory(options.repoPath, "connection repo");
  const configPath = path.resolve(repoRoot, options.configPath ?? "visual-hive.config.yaml");
  if (!isInsidePath(repoRoot, configPath)) {
    throw new Error(`Refusing to connect a config outside the connected repository: ${sanitizeText(configPath)}`);
  }
  const now = resolved.now.toISOString();
  const label = sanitizeLabel(options.label ?? (path.basename(repoRoot) || repoRoot));
  const id = sanitizeId(options.id ?? label);
  const next: RepoConnectionRecord = {
    id,
    label,
    repoRoot,
    configPath,
    tags: unique((options.tags ?? []).map(sanitizeLabel).filter(Boolean)),
    addedAt: store.connections.find((connection) => connection.id === id)?.addedAt ?? now,
    updatedAt: now
  };
  const withoutExisting = store.connections.filter((connection) => connection.id !== id);
  await writeStore(resolved.connectionsPath, { schemaVersion: 1, connections: [...withoutExisting, next].sort((a, b) => a.id.localeCompare(b.id)) });
  return listConnections(options);
}

export async function removeConnection(options: RemoveConnectionOptions): Promise<RepoConnectionIndex> {
  if (options.id === "current") {
    throw new Error("The synthetic current repository connection cannot be removed.");
  }
  const resolved = await resolveConnectionStore(options);
  const store = await readStore(resolved.connectionsPath);
  const next = store.connections.filter((connection) => connection.id !== options.id);
  if (next.length === store.connections.length) {
    throw new Error(`No Visual Hive connection found with id "${options.id}".`);
  }
  await writeStore(resolved.connectionsPath, { schemaVersion: 1, connections: next });
  return listConnections(options);
}

export async function resolveConnection(options: ConnectionStoreOptions & { id?: string }): Promise<RepoConnectionEntry | undefined> {
  if (!options.id || options.id === "current") return undefined;
  const index = await listConnections(options);
  return index.connections.find((connection) => connection.id === options.id);
}

async function resolveConnectionStore(options: ConnectionStoreOptions): Promise<{ repoRoot: string; connectionsPath: string; now: Date }> {
  const repoRoot = await canonicalDirectory(options.repoRoot, "repository root");
  const connectionsPath = path.resolve(options.connectionsPath ?? path.join(repoRoot, ".visual-hive", "connections.json"));
  if (!isInsidePath(repoRoot, connectionsPath)) {
    throw new Error(`Refusing to use a connections file outside the repository root: ${sanitizeText(connectionsPath)}`);
  }
  return { repoRoot, connectionsPath, now: options.now ?? new Date() };
}

async function canonicalDirectory(value: string, label: string): Promise<string> {
  const resolved = path.resolve(value);
  let stats;
  try {
    stats = await stat(resolved);
  } catch {
    throw new Error(`Cannot use ${label} because it does not exist: ${sanitizeText(resolved)}`);
  }
  if (!stats.isDirectory()) {
    throw new Error(`Cannot use ${label} because it is not a directory: ${sanitizeText(resolved)}`);
  }
  return realpath(resolved);
}

async function readStore(filePath: string): Promise<ConnectionStoreFile> {
  try {
    const parsed = await readJson<Partial<ConnectionStoreFile>>(filePath);
    return {
      schemaVersion: 1,
      connections: Array.isArray(parsed.connections) ? parsed.connections.filter(isConnectionRecord).filter((connection) => connection.id !== "current") : []
    };
  } catch {
    return { schemaVersion: 1, connections: [] };
  }
}

async function writeStore(filePath: string, store: ConnectionStoreFile): Promise<void> {
  await writeJson(filePath, store);
}

async function inspectConnection(record: RepoConnectionRecord, stored: boolean, now: Date): Promise<RepoConnectionEntry> {
  const warnings: string[] = [];
  let statusValue: ConnectionStatus = "ready";
  let projectName: string | undefined;
  let latestDeterministicStatus: "passed" | "failed" | undefined;
  let latestReportAt: string | undefined;
  let latestReportAgeDays: number | undefined;
  let latestMutationScore: number | undefined;
  let latestMutationAt: string | undefined;
  let mutationMinScore: number | undefined;
  let mutationKilled: number | undefined;
  let mutationTotal: number | undefined;
  let latestCoverageAt: string | undefined;
  let coverageGapCount: number | undefined;
  let highCoverageGapCount: number | undefined;
  let mediumCoverageGapCount: number | undefined;
  let uncoveredTargets: number | undefined;
  let uncoveredContracts: number | undefined;
  let missingCoverage = true;
  let latestRiskScore: number | undefined;
  let latestRiskSeverity: RiskSeverity | "none" | undefined;
  let latestRiskAt: string | undefined;

  try {
    const stats = await stat(record.repoRoot);
    if (!stats.isDirectory()) {
      statusValue = "missing_repo";
      warnings.push("Repository path is not a directory.");
    }
  } catch {
    statusValue = "missing_repo";
    warnings.push("Repository path does not exist.");
  }

  if (statusValue !== "missing_repo") {
    try {
      const configStats = await stat(record.configPath);
      if (!configStats.isFile()) {
        statusValue = "missing_config";
        warnings.push("Config path is not a file.");
      }
    } catch {
      statusValue = "missing_config";
      warnings.push("Config file was not found.");
    }
  }

  if (statusValue === "ready") {
    try {
      const loaded = await loadConfig(record.configPath, record.repoRoot);
      projectName = loaded.config.project.name;
    } catch (error) {
      statusValue = "invalid_config";
      warnings.push(sanitizeText(error instanceof Error ? error.message : String(error)));
    }
  }

  try {
    const report = await readOptionalJson<Report>(artifactPath(record, "report.json"));
    if (report.status === "passed" || report.status === "failed") latestDeterministicStatus = report.status;
    if (typeof report.generatedAt === "string") latestReportAt = report.generatedAt;
    latestReportAgeDays = ageInDays(latestReportAt, now);
  } catch {
    // Reports are optional for connected repositories.
  }

  try {
    const mutationReport = await readOptionalJson<MutationReport>(artifactPath(record, "mutation-report.json"));
    latestMutationScore = numberOrUndefined(mutationReport.score);
    latestMutationAt = stringOrUndefined(mutationReport.generatedAt);
    mutationMinScore = numberOrUndefined(mutationReport.minScore);
    mutationKilled = numberOrUndefined(mutationReport.killed);
    mutationTotal = numberOrUndefined(mutationReport.total);
  } catch {
    // Mutation reports are optional for connected repositories.
  }

  try {
    const coverageReport = await readOptionalJson<CoverageReport>(artifactPath(record, "coverage.json"));
    missingCoverage = false;
    latestCoverageAt = stringOrUndefined(coverageReport.generatedAt);
    coverageGapCount = numberOrUndefined(coverageReport.uncoveredAreas?.length);
    highCoverageGapCount = numberOrUndefined(coverageReport.uncoveredAreas?.filter((gap) => gap.severity === "high").length);
    mediumCoverageGapCount = numberOrUndefined(coverageReport.uncoveredAreas?.filter((gap) => gap.severity === "medium").length);
    uncoveredTargets = numberOrUndefined(coverageReport.summary?.uncoveredTargets);
    uncoveredContracts = numberOrUndefined(coverageReport.summary?.uncoveredContracts);
  } catch {
    // Coverage reports are optional, but missing coverage is useful health evidence.
  }

  try {
    const riskReport = await readOptionalJson<RiskRegisterReport>(artifactPath(record, "risk.json"));
    latestRiskScore = numberOrUndefined(riskReport.summary?.riskScore);
    latestRiskSeverity = riskSeverityOrUndefined(riskReport.summary?.highestSeverity);
    latestRiskAt = stringOrUndefined(riskReport.generatedAt);
  } catch {
    // Risk reports are optional for connected repositories.
  }

  const attention = deriveAttention({
    status: statusValue,
    latestDeterministicStatus,
    latestReportAgeDays,
    latestMutationScore,
    mutationMinScore,
    missingCoverage,
    coverageGapCount,
    highCoverageGapCount,
    uncoveredTargets,
    uncoveredContracts,
    latestRiskScore,
    latestRiskSeverity
  });
  const health = deriveHealth(statusValue, attention);

  return {
    ...record,
    stored,
    repoRoot: path.resolve(record.repoRoot),
    configPath: path.resolve(record.configPath),
    label: sanitizeLabel(record.label),
    tags: record.tags.map(sanitizeLabel).filter(Boolean),
    status: statusValue,
    health,
    projectName,
    latestDeterministicStatus,
    latestReportAt,
    latestReportAgeDays,
    staleReport: latestReportAgeDays !== undefined && latestReportAgeDays > STALE_REPORT_DAYS,
    latestMutationScore,
    latestMutationAt,
    mutationMinScore,
    mutationKilled,
    mutationTotal,
    latestCoverageAt,
    coverageGapCount,
    highCoverageGapCount,
    mediumCoverageGapCount,
    uncoveredTargets,
    uncoveredContracts,
    missingCoverage,
    latestRiskScore,
    latestRiskSeverity,
    latestRiskAt,
    attention,
    warnings
  };
}

function summarize(connections: RepoConnectionEntry[]): RepoConnectionIndex["summary"] {
  return {
    connectionCount: connections.length,
    storedConnections: connections.filter((connection) => connection.stored).length,
    readyConnections: connections.filter((connection) => connection.status === "ready").length,
    missingConfigConnections: connections.filter((connection) => connection.status === "missing_config").length,
    invalidConfigConnections: connections.filter((connection) => connection.status === "invalid_config").length,
    missingRepoConnections: connections.filter((connection) => connection.status === "missing_repo").length,
    blockedConnections: connections.filter((connection) => connection.health === "blocked").length,
    connectionsNeedingAttention: connections.filter((connection) => connection.health === "attention").length,
    failedConnections: connections.filter((connection) => connection.latestDeterministicStatus === "failed").length,
    missingReportConnections: connections.filter((connection) => connection.status === "ready" && !connection.latestDeterministicStatus).length,
    weakMutationConnections: connections.filter((connection) => mutationIsWeak(connection)).length,
    highRiskConnections: connections.filter((connection) => riskIsHigh(connection)).length,
    staleReportConnections: connections.filter((connection) => connection.staleReport).length,
    missingCoverageConnections: connections.filter((connection) => connection.status === "ready" && connection.missingCoverage).length,
    coverageGapConnections: connections.filter((connection) => (connection.coverageGapCount ?? 0) > 0).length,
    highCoverageGapConnections: connections.filter((connection) => (connection.highCoverageGapCount ?? 0) > 0).length
  };
}

function artifactPath(record: RepoConnectionRecord, artifactName: string): string {
  return path.join(path.dirname(record.configPath), ".visual-hive", artifactName);
}

async function readOptionalJson<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

function deriveAttention(input: {
  status: ConnectionStatus;
  latestDeterministicStatus?: "passed" | "failed";
  latestReportAgeDays?: number;
  latestMutationScore?: number;
  mutationMinScore?: number;
  missingCoverage?: boolean;
  coverageGapCount?: number;
  highCoverageGapCount?: number;
  uncoveredTargets?: number;
  uncoveredContracts?: number;
  latestRiskScore?: number;
  latestRiskSeverity?: RiskSeverity | "none";
}): string[] {
  const attention: string[] = [];
  if (input.status === "missing_repo") attention.push("Repository path is missing.");
  if (input.status === "missing_config") attention.push("Visual Hive config is missing.");
  if (input.status === "invalid_config") attention.push("Visual Hive config is invalid.");
  if (input.status === "ready" && !input.latestDeterministicStatus) attention.push("No deterministic report found.");
  if (input.latestDeterministicStatus === "failed") attention.push("Latest deterministic run failed.");
  if (input.latestReportAgeDays !== undefined && input.latestReportAgeDays > STALE_REPORT_DAYS) {
    attention.push(`Latest deterministic report is stale (${input.latestReportAgeDays} days old).`);
  }
  if (input.latestMutationScore !== undefined && input.mutationMinScore !== undefined && input.latestMutationScore < input.mutationMinScore) {
    attention.push(`Mutation score ${formatPercent(input.latestMutationScore)} is below minimum ${formatPercent(input.mutationMinScore)}.`);
  }
  if (input.status === "ready" && input.latestDeterministicStatus && input.missingCoverage) {
    attention.push("No coverage audit found.");
  }
  if ((input.highCoverageGapCount ?? 0) > 0) {
    attention.push(`Coverage has ${input.highCoverageGapCount} high-severity gap${input.highCoverageGapCount === 1 ? "" : "s"}.`);
  }
  if ((input.uncoveredTargets ?? 0) > 0 || (input.uncoveredContracts ?? 0) > 0) {
    attention.push(`Coverage leaves ${input.uncoveredTargets ?? 0} target(s) and ${input.uncoveredContracts ?? 0} contract(s) uncovered.`);
  }
  if (input.latestRiskSeverity === "critical" || input.latestRiskSeverity === "high" || (input.latestRiskScore ?? 0) >= 50) {
    attention.push(`Risk register needs review${input.latestRiskScore === undefined ? "." : ` (${input.latestRiskScore}/100).`}`);
  }
  return unique(attention);
}

function deriveHealth(statusValue: ConnectionStatus, attention: string[]): ConnectionHealth {
  if (statusValue !== "ready") return "blocked";
  return attention.length ? "attention" : "ready";
}

function mutationIsWeak(connection: RepoConnectionEntry): boolean {
  return connection.latestMutationScore !== undefined && connection.mutationMinScore !== undefined && connection.latestMutationScore < connection.mutationMinScore;
}

function riskIsHigh(connection: RepoConnectionEntry): boolean {
  return connection.latestRiskSeverity === "critical" || connection.latestRiskSeverity === "high" || (connection.latestRiskScore ?? 0) >= 50;
}

function ageInDays(value: string | undefined, now: Date): number | undefined {
  if (!value) return undefined;
  const then = Date.parse(value);
  if (!Number.isFinite(then)) return undefined;
  return Math.max(0, Math.floor((now.getTime() - then) / 86_400_000));
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? sanitizeText(value) : undefined;
}

function riskSeverityOrUndefined(value: unknown): RiskSeverity | "none" | undefined {
  return value === "critical" || value === "high" || value === "medium" || value === "low" || value === "none" ? value : undefined;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function isConnectionRecord(value: unknown): value is RepoConnectionRecord {
  const record = value as Partial<RepoConnectionRecord> | undefined;
  return Boolean(
    record &&
      typeof record.id === "string" &&
      typeof record.label === "string" &&
      typeof record.repoRoot === "string" &&
      typeof record.configPath === "string" &&
      Array.isArray(record.tags) &&
      typeof record.addedAt === "string" &&
      typeof record.updatedAt === "string"
  );
}

function sanitizeLabel(value: string): string {
  return sanitizeText(value).trim().slice(0, 120);
}

function sanitizeId(value: string): string {
  const id = sanitizeLabel(value)
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!id) {
    throw new Error("Connection id must contain at least one letter or number.");
  }
  return id.slice(0, 80);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function toRepoRelativePath(repoRoot: string, filePath: string): string {
  return path.relative(repoRoot, filePath).replaceAll("\\", "/");
}

function isInsidePath(parent: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
