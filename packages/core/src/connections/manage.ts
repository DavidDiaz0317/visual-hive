import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../config/load.js";
import type { CostAuditReport } from "../costs/analyze.js";
import type { CoverageReport } from "../coverage/analyze.js";
import type { MutationReport, Report } from "../reports/types.js";
import type { ReadinessReport } from "../readiness/analyze.js";
import type { RiskRegisterReport, RiskSeverity } from "../risk/analyze.js";
import type { SecurityAuditReport } from "../security/audit.js";
import { readJson, writeJson } from "../utils/files.js";
import { sanitizeText } from "../utils/sanitize.js";

export type ConnectionStatus = "ready" | "missing_repo" | "missing_config" | "invalid_config";
export type ConnectionHealth = "ready" | "attention" | "blocked";
export type ConnectionPortfolioQueueId =
  | "broken_setup"
  | "deterministic_failures"
  | "missing_reports"
  | "stale_reports"
  | "missing_coverage"
  | "coverage_gaps"
  | "weak_mutation"
  | "high_risk"
  | "readiness_blocked"
  | "security_risks"
  | "cost_policy"
  | "healthy";
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
  latestReadinessStatus?: ReadinessReport["status"];
  latestReadinessScore?: number;
  readinessBlocked?: number;
  readinessWarnings?: number;
  latestReadinessAt?: string;
  latestSecurityScore?: number;
  securityCriticalHigh?: number;
  latestSecurityAt?: string;
  latestCostBudgetStatus?: CostAuditReport["summary"]["budgetStatus"];
  costPolicyBlockedProviders?: number;
  latestCostAt?: string;
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
    readinessBlockedConnections: number;
    securityRiskConnections: number;
    costPolicyConnections: number;
  };
  portfolio: RepoConnectionPortfolio;
  connections: RepoConnectionEntry[];
  warnings: string[];
}

export interface RepoConnectionPortfolio {
  queues: RepoConnectionPortfolioQueue[];
  topAttention: RepoConnectionPortfolioItem[];
}

export interface RepoConnectionPortfolioQueue {
  id: ConnectionPortfolioQueueId;
  label: string;
  description: string;
  severity: "critical" | "warning" | "ok";
  nextAction: string;
  count: number;
  connections: RepoConnectionPortfolioItem[];
}

export interface RepoConnectionPortfolioItem {
  id: string;
  label: string;
  projectName?: string;
  health: ConnectionHealth;
  status: ConnectionStatus;
  score: number;
  reasons: string[];
  latestDeterministicStatus?: "passed" | "failed";
  latestReportAgeDays?: number;
  latestMutationScore?: number;
  coverageGapCount?: number;
  highCoverageGapCount?: number;
  latestRiskScore?: number;
  latestRiskSeverity?: RiskSeverity | "none";
  latestReadinessStatus?: ReadinessReport["status"];
  latestReadinessScore?: number;
  latestSecurityScore?: number;
  latestCostBudgetStatus?: CostAuditReport["summary"]["budgetStatus"];
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
    portfolio: buildPortfolio(connections),
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
  let latestReadinessStatus: ReadinessReport["status"] | undefined;
  let latestReadinessScore: number | undefined;
  let readinessBlocked: number | undefined;
  let readinessWarnings: number | undefined;
  let latestReadinessAt: string | undefined;
  let latestSecurityScore: number | undefined;
  let securityCriticalHigh: number | undefined;
  let latestSecurityAt: string | undefined;
  let latestCostBudgetStatus: CostAuditReport["summary"]["budgetStatus"] | undefined;
  let costPolicyBlockedProviders: number | undefined;
  let latestCostAt: string | undefined;

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

  try {
    const readinessReport = await readOptionalJson<ReadinessReport>(artifactPath(record, "readiness.json"));
    latestReadinessStatus = readinessStatusOrUndefined(readinessReport.status);
    latestReadinessScore = numberOrUndefined(readinessReport.score);
    readinessBlocked = numberOrUndefined(readinessReport.summary?.blocked);
    readinessWarnings = numberOrUndefined(readinessReport.summary?.warnings);
    latestReadinessAt = stringOrUndefined(readinessReport.generatedAt);
  } catch {
    // Readiness reports are optional for connected repositories.
  }

  try {
    const securityReport = await readOptionalJson<SecurityAuditReport>(artifactPath(record, "security.json"));
    latestSecurityScore = numberOrUndefined(securityReport.summary?.score);
    securityCriticalHigh = numberOrUndefined((securityReport.summary?.critical ?? 0) + (securityReport.summary?.high ?? 0));
    latestSecurityAt = stringOrUndefined(securityReport.generatedAt);
  } catch {
    // Security reports are optional for connected repositories.
  }

  try {
    const costReport = await readOptionalJson<CostAuditReport>(artifactPath(record, "costs.json"));
    latestCostBudgetStatus = costBudgetStatusOrUndefined(costReport.summary?.budgetStatus);
    costPolicyBlockedProviders = numberOrUndefined(costReport.summary?.policyBlockedProviders);
    latestCostAt = stringOrUndefined(costReport.generatedAt);
  } catch {
    // Cost reports are optional for connected repositories.
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
    latestRiskSeverity,
    latestReadinessStatus,
    latestReadinessScore,
    readinessBlocked,
    readinessWarnings,
    latestSecurityScore,
    securityCriticalHigh,
    latestCostBudgetStatus,
    costPolicyBlockedProviders
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
    latestReadinessStatus,
    latestReadinessScore,
    readinessBlocked,
    readinessWarnings,
    latestReadinessAt,
    latestSecurityScore,
    securityCriticalHigh,
    latestSecurityAt,
    latestCostBudgetStatus,
    costPolicyBlockedProviders,
    latestCostAt,
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
    readinessBlockedConnections: connections.filter((connection) => readinessNeedsAttention(connection)).length,
    securityRiskConnections: connections.filter((connection) => securityNeedsAttention(connection)).length,
    costPolicyConnections: connections.filter((connection) => costNeedsAttention(connection)).length,
    staleReportConnections: connections.filter((connection) => connection.staleReport).length,
    missingCoverageConnections: connections.filter((connection) => connection.status === "ready" && connection.missingCoverage).length,
    coverageGapConnections: connections.filter((connection) => (connection.coverageGapCount ?? 0) > 0).length,
    highCoverageGapConnections: connections.filter((connection) => (connection.highCoverageGapCount ?? 0) > 0).length
  };
}

function buildPortfolio(connections: RepoConnectionEntry[]): RepoConnectionPortfolio {
  const queueDefinitions: Array<{
    id: ConnectionPortfolioQueueId;
    label: string;
    description: string;
    severity: RepoConnectionPortfolioQueue["severity"];
    nextAction: string;
    filter: (connection: RepoConnectionEntry) => boolean;
  }> = [
    {
      id: "broken_setup",
      label: "Broken setup",
      description: "Repository path, config path, or config validation prevents Visual Hive from inspecting the repo.",
      severity: "critical",
      nextAction: "Fix the local repo/config path or repair the Visual Hive config before relying on this connection.",
      filter: (connection) => connection.health === "blocked"
    },
    {
      id: "deterministic_failures",
      label: "Deterministic failures",
      description: "Latest Playwright-backed deterministic run failed.",
      severity: "critical",
      nextAction: "Open the failed report, inspect artifacts, and keep Visual Hive verdict artifacts as the pass/fail authority.",
      filter: (connection) => connection.latestDeterministicStatus === "failed"
    },
    {
      id: "missing_reports",
      label: "Missing reports",
      description: "Config is valid, but no deterministic report is available yet.",
      severity: "warning",
      nextAction: "Run visual-hive plan and visual-hive run in the connected repo.",
      filter: (connection) => connection.status === "ready" && !connection.latestDeterministicStatus
    },
    {
      id: "stale_reports",
      label: "Stale reports",
      description: `Latest deterministic report is older than ${STALE_REPORT_DAYS} days.`,
      severity: "warning",
      nextAction: "Rerun deterministic checks or schedule a canary lane for this repo.",
      filter: (connection) => connection.staleReport
    },
    {
      id: "missing_coverage",
      label: "Missing coverage audits",
      description: "No coverage artifact exists for a repo with deterministic run evidence.",
      severity: "warning",
      nextAction: "Run visual-hive coverage so selection rules, routes, and viewports are visible.",
      filter: (connection) => connection.status === "ready" && connection.missingCoverage && Boolean(connection.latestDeterministicStatus)
    },
    {
      id: "coverage_gaps",
      label: "Coverage gaps",
      description: "Coverage audit found uncovered targets, contracts, routes, viewports, or changed-file rules.",
      severity: "warning",
      nextAction: "Review coverage gaps and add contracts or selection rules where risk justifies it.",
      filter: (connection) => (connection.coverageGapCount ?? 0) > 0
    },
    {
      id: "weak_mutation",
      label: "Weak mutation adequacy",
      description: "Mutation score is below the configured minimum.",
      severity: "warning",
      nextAction: "Inspect survived mutations and add deterministic contracts that kill them.",
      filter: (connection) => mutationIsWeak(connection)
    },
    {
      id: "high_risk",
      label: "High risk register",
      description: "Risk register contains high or critical risks, or a high aggregate score.",
      severity: "critical",
      nextAction: "Open the risk register and address PR-blocking or trusted-only risks first.",
      filter: (connection) => riskIsHigh(connection)
    },
    {
      id: "readiness_blocked",
      label: "Readiness gates",
      description: "Readiness gate is blocked or has warnings that need operator review.",
      severity: "critical",
      nextAction: "Run visual-hive readiness and address blocked or warning gates before expanding automation.",
      filter: (connection) => readinessNeedsAttention(connection)
    },
    {
      id: "security_risks",
      label: "Security posture",
      description: "Security audit contains critical/high findings or a low security score.",
      severity: "critical",
      nextAction: "Run visual-hive security and fix workflow, protected target, provider, dependency, or LLM governance findings.",
      filter: (connection) => securityNeedsAttention(connection)
    },
    {
      id: "cost_policy",
      label: "Cost policy",
      description: "Cost audit is warning or blocked because target/provider usage needs budget review.",
      severity: "warning",
      nextAction: "Run visual-hive costs and review external provider budgets, expensive targets, and screenshot volume.",
      filter: (connection) => costNeedsAttention(connection)
    },
    {
      id: "healthy",
      label: "Healthy",
      description: "Connected repos with valid config and no derived attention signals.",
      severity: "ok",
      nextAction: "Keep PR checks enabled and scheduled deeper validation running.",
      filter: (connection) => connection.health === "ready"
    }
  ];

  const queues = queueDefinitions.map((definition) => {
    const items = connections.filter(definition.filter).map(toPortfolioItem).sort(comparePortfolioItems);
    return {
      id: definition.id,
      label: definition.label,
      description: definition.description,
      severity: definition.severity,
      nextAction: definition.nextAction,
      count: items.length,
      connections: items
    };
  });
  const byId = new Map<string, RepoConnectionPortfolioItem>();
  for (const connection of connections.filter((candidate) => candidate.health !== "ready").map(toPortfolioItem).sort(comparePortfolioItems)) {
    byId.set(connection.id, connection);
  }
  return {
    queues,
    topAttention: [...byId.values()].slice(0, 10)
  };
}

function toPortfolioItem(connection: RepoConnectionEntry): RepoConnectionPortfolioItem {
  return {
    id: connection.id,
    label: connection.label,
    projectName: connection.projectName,
    health: connection.health,
    status: connection.status,
    score: portfolioScore(connection),
    reasons: connection.attention.length ? [...connection.attention] : ["No attention required."],
    latestDeterministicStatus: connection.latestDeterministicStatus,
    latestReportAgeDays: connection.latestReportAgeDays,
    latestMutationScore: connection.latestMutationScore,
    coverageGapCount: connection.coverageGapCount,
    highCoverageGapCount: connection.highCoverageGapCount,
    latestRiskScore: connection.latestRiskScore,
    latestRiskSeverity: connection.latestRiskSeverity,
    latestReadinessStatus: connection.latestReadinessStatus,
    latestReadinessScore: connection.latestReadinessScore,
    latestSecurityScore: connection.latestSecurityScore,
    latestCostBudgetStatus: connection.latestCostBudgetStatus
  };
}

function comparePortfolioItems(a: RepoConnectionPortfolioItem, b: RepoConnectionPortfolioItem): number {
  return b.score - a.score || a.label.localeCompare(b.label) || a.id.localeCompare(b.id);
}

function portfolioScore(connection: RepoConnectionEntry): number {
  let score = 0;
  if (connection.health === "blocked") score += 100;
  if (connection.latestDeterministicStatus === "failed") score += 90;
  if (riskIsHigh(connection)) score += 80;
  if (readinessNeedsAttention(connection)) score += connection.latestReadinessStatus === "blocked" ? 85 : 55;
  if (securityNeedsAttention(connection)) score += 78;
  if ((connection.highCoverageGapCount ?? 0) > 0) score += 75;
  if (connection.staleReport) score += 65;
  if (mutationIsWeak(connection)) score += 60;
  if (costNeedsAttention(connection)) score += connection.latestCostBudgetStatus === "blocked" ? 50 : 25;
  if (connection.status === "ready" && !connection.latestDeterministicStatus) score += 55;
  if (connection.missingCoverage && connection.latestDeterministicStatus) score += 45;
  if ((connection.coverageGapCount ?? 0) > 0) score += 30;
  return score;
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
  latestReadinessStatus?: ReadinessReport["status"];
  latestReadinessScore?: number;
  readinessBlocked?: number;
  readinessWarnings?: number;
  latestSecurityScore?: number;
  securityCriticalHigh?: number;
  latestCostBudgetStatus?: CostAuditReport["summary"]["budgetStatus"];
  costPolicyBlockedProviders?: number;
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
  if (input.latestReadinessStatus === "blocked") {
    attention.push(
      `Readiness gate is blocked${input.latestReadinessScore === undefined ? "." : ` (${input.latestReadinessScore}/100).`}`
    );
  } else if ((input.readinessBlocked ?? 0) > 0 || (input.readinessWarnings ?? 0) > 0) {
    attention.push(`Readiness has ${input.readinessBlocked ?? 0} blocked and ${input.readinessWarnings ?? 0} warning gate(s).`);
  }
  if ((input.securityCriticalHigh ?? 0) > 0) {
    attention.push(`Security audit has ${input.securityCriticalHigh} critical/high finding${input.securityCriticalHigh === 1 ? "" : "s"}.`);
  } else if (input.latestSecurityScore !== undefined && input.latestSecurityScore < 80) {
    attention.push(`Security score is ${input.latestSecurityScore}/100.`);
  }
  if (input.latestCostBudgetStatus === "blocked" || input.latestCostBudgetStatus === "warning") {
    attention.push(
      `Cost policy is ${input.latestCostBudgetStatus}${input.costPolicyBlockedProviders ? ` with ${input.costPolicyBlockedProviders} policy-blocked provider(s)` : ""}.`
    );
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

function readinessNeedsAttention(connection: RepoConnectionEntry): boolean {
  return connection.latestReadinessStatus === "blocked" || (connection.readinessBlocked ?? 0) > 0 || (connection.readinessWarnings ?? 0) > 0;
}

function securityNeedsAttention(connection: RepoConnectionEntry): boolean {
  return (connection.securityCriticalHigh ?? 0) > 0 || (connection.latestSecurityScore !== undefined && connection.latestSecurityScore < 80);
}

function costNeedsAttention(connection: RepoConnectionEntry): boolean {
  return connection.latestCostBudgetStatus === "blocked" || connection.latestCostBudgetStatus === "warning";
}

function readinessStatusOrUndefined(value: unknown): ReadinessReport["status"] | undefined {
  return value === "ready" || value === "attention" || value === "blocked" ? value : undefined;
}

function costBudgetStatusOrUndefined(value: unknown): CostAuditReport["summary"]["budgetStatus"] | undefined {
  return value === "ok" || value === "blocked" || value === "warning" ? value : undefined;
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
