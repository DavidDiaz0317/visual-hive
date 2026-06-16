import { constants } from "node:fs";
import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import {
  loadConfig,
  listBaselines,
  inspectProviders,
  analyzeCoverage,
  auditContracts,
  auditSchedules,
  auditTargets,
  auditWorkflows,
  artifactContentType,
  artifactKind,
  createRunHistoryEntry,
  createRunHistoryReport,
  indexArtifacts,
  listConnections,
  resolveConnection,
  sanitizeText,
  type ContractConfig,
  type CoverageReport,
  type LLMUsageReport,
  type MockProviderRunReport,
  type MutationReport,
  type Plan,
  type Report,
  type RunHistoryReport,
  type SetupRecommendationReport,
  type TargetConfig,
  type VisualHiveConfig,
  type WorkflowAuditReport
} from "@visual-hive/core";
import {
  isInsidePath,
  normalizeRepoRelativePath,
  resolveSafeChildPath,
  toRepoRelativePath
} from "./safePath.js";
import type {
  ArtifactFile,
  ControlPlaneFailure,
  ControlPlaneOptions,
  ControlPlaneOverview,
  ControlPlaneScreenshot,
  ControlPlaneSnapshot,
  ResolvedControlPlaneOptions
} from "./types.js";

export function resolveControlPlaneOptions(options: ControlPlaneOptions = {}, cwd = process.cwd()): ResolvedControlPlaneOptions {
  const demoRoot = path.resolve(cwd, "examples/demo-react-app");
  const repoRoot = path.resolve(cwd, options.repo ?? (options.demo && path.isAbsolute(demoRoot) ? demoRoot : "."));
  const configPath = path.resolve(cwd, options.config ?? path.join(repoRoot, "visual-hive.config.yaml"));
  return {
    repoRoot: options.repo ? repoRoot : inferRepoRoot(repoRoot, configPath, Boolean(options.config)),
    configPath,
    configRoot: path.dirname(configPath),
    readOnly: Boolean(options.readOnly),
    demo: Boolean(options.demo)
  };
}

export async function createControlPlaneSnapshot(options: ControlPlaneOptions = {}, connectionId?: string): Promise<ControlPlaneSnapshot> {
  const base = resolveControlPlaneOptions(options);
  const resolved = await resolveSelectedOptions(options, connectionId, base);
  const configRaw = await readTextIfExists(resolved.configPath);
  let config: VisualHiveConfig | undefined;
  let configError: string | undefined;
  try {
    config = (await loadConfig(resolved.configPath, resolved.repoRoot)).config;
  } catch (error) {
    configError = sanitizeText(error instanceof Error ? error.message : String(error));
  }

  const hiveRoot = path.join(resolved.configRoot, ".visual-hive");
  const [
    plan,
    report,
    mutationReport,
    providerRunReport,
    setupRecommendation,
    workflowAuditArtifact,
    runHistoryArtifact,
    issueMarkdown,
    prCommentMarkdown,
    triagePrompt,
    repairPrompt,
    missingTestsMarkdown,
    baselineReviewMarkdown,
    llmUsage,
    artifacts,
    connections
  ] = await Promise.all([
    readJsonIfExists<unknown>(path.join(hiveRoot, "plan.json")),
    readJsonIfExists<Report>(path.join(hiveRoot, "report.json")),
    readJsonIfExists<MutationReport>(path.join(hiveRoot, "mutation-report.json")),
    readJsonIfExists<MockProviderRunReport>(path.join(hiveRoot, "provider-results.json")),
    readJsonIfExists<SetupRecommendationReport>(path.join(hiveRoot, "recommendations.json")),
    readJsonIfExists<WorkflowAuditReport>(path.join(hiveRoot, "workflows.json")),
    readJsonIfExists<RunHistoryReport>(path.join(hiveRoot, "history.json")),
    readTextIfExists(path.join(hiveRoot, "issue.md")),
    readTextIfExists(path.join(hiveRoot, "pr-comment.md")),
    readTextIfExists(path.join(hiveRoot, "triage-prompt.md")),
    readTextIfExists(path.join(hiveRoot, "repair-prompt.md")),
    readTextIfExists(path.join(hiveRoot, "missing-tests.md")),
    readTextIfExists(path.join(hiveRoot, "baseline-review.md")),
    readJsonIfExists<LLMUsageReport>(path.join(hiveRoot, "llm-usage.json")),
    indexArtifacts({ repoRoot: resolved.repoRoot, hiveRoot, project: config?.project.name }).then((index) => index.artifacts),
    listConnections({ repoRoot: base.repoRoot })
  ]);

  const screenshots = await collectScreenshots(resolved.repoRoot, path.join(hiveRoot, "report.json"), report);
  const failures = collectFailures(resolved.repoRoot, report, mutationReport);
  const targets = collectTargets(config, report);
  const coverage = config
    ? analyzeCoverage(config, { plan: isPlan(plan) ? plan : undefined, selectedContractIds: report?.selectedContracts })
    : emptyCoverage();
  const targetAudit = config ? auditTargets(config, { plan: isPlan(plan) ? plan : undefined, report }) : undefined;
  const contractAudit = config
    ? auditContracts(config, { plan: isPlan(plan) ? plan : undefined, report, mutationReport, selectedContractIds: report?.selectedContracts })
    : undefined;
  const scheduleAudit = config ? auditSchedules(config, { changedFiles: isPlan(plan) ? plan.changedFiles : report?.changedFiles }) : undefined;
  const workflowAudit = config ? (workflowAuditArtifact ?? (await auditWorkflowFilesIfPresent(config, resolved.repoRoot))) : undefined;
  const contracts = collectContracts(config, report, mutationReport);
  const overview = buildOverview(report, mutationReport, configError);
  const providers = config ? inspectProviders(config) : [];
  const runHistory = runHistoryArtifact ?? buildTransientRunHistory(resolved.repoRoot, plan, report, mutationReport);

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    repoRoot: resolved.repoRoot,
    configPath: resolved.configPath,
    configRoot: resolved.configRoot,
    readOnly: resolved.readOnly,
    demo: resolved.demo,
    activeConnectionId: connectionId || "current",
    configRaw,
    config,
    configError,
    plan,
    report,
    runHistory,
    mutationReport,
    providerRunReport,
    setupRecommendation,
    targetAudit,
    contractAudit,
    scheduleAudit,
    workflowAudit,
    issueMarkdown,
    prCommentMarkdown,
    triagePrompt,
    repairPrompt,
    missingTestsMarkdown,
    baselineReviewMarkdown,
    llmUsage,
    overview,
    failures,
    screenshots,
    coverage,
    targets,
    contracts,
    providers,
    artifacts,
    connections
  };
}

export async function readControlPlaneArtifact(options: ControlPlaneOptions, repoRelativePath: string, connectionId?: string): Promise<ArtifactFile> {
  const resolved = await resolveSelectedOptions(options, connectionId, resolveControlPlaneOptions(options));
  const hiveRoot = path.join(resolved.configRoot, ".visual-hive");
  const requested = normalizeRepoRelativePath(repoRelativePath);
  const absolutePath = path.resolve(resolved.repoRoot, requested);
  if (!isInsidePath(hiveRoot, absolutePath)) {
    throw new Error(`Refusing to read file outside .visual-hive: ${repoRelativePath}`);
  }
  const safePath = resolveSafeChildPath(hiveRoot, path.relative(hiveRoot, absolutePath));
  const bytes = (await stat(safePath)).size;
  const kind = artifactKind(safePath);
  const contentType = artifactContentType(kind, safePath);
  const raw = await readFile(safePath);
  const content = kind === "image" ? raw : sanitizeText(raw.toString("utf8"));
  return {
    path: toRepoRelativePath(resolved.repoRoot, safePath),
    kind,
    contentType,
    content,
    bytes
  };
}

async function resolveSelectedOptions(
  options: ControlPlaneOptions,
  connectionId: string | undefined,
  base: ResolvedControlPlaneOptions
): Promise<ResolvedControlPlaneOptions> {
  if (!connectionId || connectionId === "current") return base;
  const connection = await resolveConnection({ repoRoot: base.repoRoot, id: connectionId });
  if (!connection) {
    throw new Error(`Unknown Visual Hive connection: ${connectionId}`);
  }
  if (connection.status !== "ready") {
    throw new Error(`Visual Hive connection "${connectionId}" is not ready: ${connection.status}`);
  }
  return resolveControlPlaneOptions(
    {
      ...options,
      repo: connection.repoRoot,
      config: connection.configPath,
      readOnly: base.readOnly,
      demo: false
    },
    process.cwd()
  );
}

function inferRepoRoot(repoRoot: string, configPath: string, explicitConfig: boolean): string {
  if (explicitConfig) {
    return path.dirname(configPath);
  }
  return repoRoot;
}

async function readTextIfExists(filePath: string): Promise<string | undefined> {
  try {
    return sanitizeText(await readFile(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

async function readJsonIfExists<T>(filePath: string): Promise<T | undefined> {
  const raw = await readTextIfExists(filePath);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

async function auditWorkflowFilesIfPresent(config: VisualHiveConfig, repoRoot: string): Promise<WorkflowAuditReport | undefined> {
  const workflowRoot = path.join(repoRoot, ".github", "workflows");
  let entries: string[];
  try {
    entries = await readdir(workflowRoot);
  } catch {
    return undefined;
  }
  const files = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".yml") || entry.endsWith(".yaml"))
      .sort()
      .map(async (entry) => ({
        path: path.join(workflowRoot, entry),
        content: await readFile(path.join(workflowRoot, entry), "utf8")
      }))
  );
  return auditWorkflows(config, files, { workflowRoot });
}

async function collectScreenshots(repoRoot: string, reportPath: string, report?: Report): Promise<ControlPlaneScreenshot[]> {
  if (report) {
    try {
      const list = await listBaselines({ repoRoot, reportPath });
      return list.entries.map((entry) => ({
        contractId: entry.contractId,
        name: entry.screenshotName,
        route: entry.route,
        viewport: entry.viewport,
        status: entry.status,
        baselinePath: entry.baselinePath,
        actualPath: entry.actualPath,
        diffPath: entry.diffPath,
        maxDiffPixelRatio: entry.maxDiffPixelRatio,
        actualDiffPixelRatio: entry.actualDiffPixelRatio,
        actualDiffPixels: entry.actualDiffPixels,
        canApprove: entry.canApprove,
        canReject: entry.canReject,
        approvedAt: entry.approvedAt,
        rejectedAt: entry.rejectedAt,
        rejectionReason: entry.rejectionReason
      }));
    } catch {
      // Fall back to report-only rendering when a legacy report contains paths
      // that cannot be safely resolved against the selected repo.
    }
  }
  return (report?.results ?? []).flatMap((result) =>
    (result.screenshotAssertions ?? []).map((shot) => ({
      contractId: result.contractId,
      name: shot.screenshotName || shot.name,
      route: shot.route,
      viewport: shot.viewport,
      status: shot.status,
      baselinePath: pathIfInside(repoRoot, shot.baselinePath),
      actualPath: pathIfInside(repoRoot, shot.actualPath),
      diffPath: shot.diffPath ? pathIfInside(repoRoot, shot.diffPath) : undefined,
      maxDiffPixelRatio: shot.maxDiffPixelRatio,
      actualDiffPixelRatio: shot.actualDiffPixelRatio,
      actualDiffPixels: shot.actualDiffPixels,
      canApprove: shot.status === "created" || shot.status === "failed" || shot.status === "missing_baseline",
      canReject: shot.status === "created" || shot.status === "failed" || shot.status === "missing_baseline"
    }))
  );
}

function collectFailures(repoRoot: string, report?: Report, mutationReport?: MutationReport): ControlPlaneFailure[] {
  const deterministic = (report?.results ?? [])
    .filter((result) => result.status === "failed")
    .map((result) => ({
      contractId: result.contractId,
      targetId: result.targetId,
      status: result.status,
      classification: classifyResult(result),
      errorExcerpt: sanitizeText(result.errors[0] ?? "Contract failed without an error excerpt."),
      reproductionCommand: result.reproductionCommand,
      artifacts: result.artifacts.map((artifact) => pathIfInside(repoRoot, artifact))
    }));
  const mutation = (mutationReport?.results ?? [])
    .filter((result) => result.status === "survived")
    .map((result) => ({
      contractId: result.contractIds.join(", ") || "unmapped",
      targetId: "mutation",
      status: result.status,
      classification: "mutation_survivor",
      errorExcerpt: `Mutation survived: ${result.operator}. Add or strengthen contracts for ${result.expectedFailureKinds?.join(", ") || "this behavior"}.`,
      artifacts: (result.artifacts ?? []).map((artifact) => pathIfInside(repoRoot, artifact))
    }));
  return [...deterministic, ...mutation];
}

function collectTargets(config?: VisualHiveConfig, report?: Report): ControlPlaneSnapshot["targets"] {
  if (!config) return [];
  return Object.entries(config.targets).map(([id, target]) => ({
    id,
    config: target as TargetConfig,
    contractIds: config.contracts.filter((contract) => contract.target === id).map((contract) => contract.id),
    latestStatus: latestTargetStatus(id, report)
  }));
}

function collectContracts(config?: VisualHiveConfig, report?: Report, mutationReport?: MutationReport): ControlPlaneSnapshot["contracts"] {
  if (!config) return [];
  return config.contracts.map((contract) => ({
    config: contract as ContractConfig,
    latestStatus: report?.results.find((result) => result.contractId === contract.id)?.status,
    mutationOperators: (mutationReport?.results ?? [])
      .filter((result) => result.contractIds.includes(contract.id))
      .map((result) => result.operator)
  }));
}

function buildOverview(report?: Report, mutationReport?: MutationReport, configError?: string): ControlPlaneOverview {
  const deterministicStatus = !report ? "missing" : report.status;
  const failedContracts = report?.summary.failed ?? 0;
  const createdBaselines = report?.summary.createdBaselines ?? report?.summary.baselinesCreated ?? 0;
  const missingBaselines = report?.summary.missingBaselines ?? 0;
  const visualDiffs = report?.summary.visualDiffs ?? 0;
  const consoleErrors = report?.summary.consoleErrors ?? 0;
  const pageErrors = report?.summary.pageErrors ?? 0;
  const mutationScore = mutationReport?.score;
  let healthScore = report ? (report.status === "passed" ? 70 : 35) : 10;
  if (mutationScore !== undefined) healthScore += Math.round(mutationScore * 20);
  if (createdBaselines > 0) healthScore -= 5;
  if (missingBaselines > 0) healthScore -= 20;
  if (visualDiffs > 0) healthScore -= 15;
  if (failedContracts > 0) healthScore -= failedContracts * 10;
  if (configError) healthScore = 0;
  healthScore = Math.max(0, Math.min(100, healthScore));
  return {
    healthScore,
    healthGrade: grade(healthScore, deterministicStatus),
    deterministicStatus,
    mutationScore,
    failedContracts,
    createdBaselines,
    missingBaselines,
    visualDiffs,
    consoleErrors,
    pageErrors,
    nextActions: nextActions(report, mutationReport, configError),
    explanations: [
      report ? `Latest deterministic run ${report.status}.` : "No deterministic report found yet.",
      mutationReport ? `Mutation score is ${Math.round(mutationReport.score * 100)}%.` : "No mutation report found yet.",
      configError ? `Config needs attention: ${configError}` : "Config loaded successfully."
    ]
  };
}

function buildTransientRunHistory(repoRoot: string, plan?: unknown, report?: Report, mutationReport?: MutationReport): RunHistoryReport | undefined {
  if (!report && !mutationReport) return undefined;
  const now = new Date().toISOString();
  return createRunHistoryReport({
    project: report?.project ?? mutationReport?.project ?? "unknown",
    generatedAt: now,
    entries: [
      createRunHistoryEntry({
        repoRoot,
        id: "latest",
        recordedAt: now,
        files: {
          plan: isPlan(plan) ? ".visual-hive/plan.json" : undefined,
          report: report ? ".visual-hive/report.json" : undefined,
          mutationReport: mutationReport ? ".visual-hive/mutation-report.json" : undefined
        },
        plan: isPlan(plan) ? plan : undefined,
        report,
        mutationReport
      })
    ]
  });
}

function nextActions(report?: Report, mutationReport?: MutationReport, configError?: string): string[] {
  if (configError) return ["Fix visual-hive.config.yaml validation errors."];
  if (!report) return ["Run visual-hive plan && visual-hive run."];
  if (report.status === "failed") return ["Open Failure Inbox and inspect failed contracts.", "Run visual-hive triage to refresh issue and repair context."];
  if ((report.summary.createdBaselines ?? report.summary.baselinesCreated) > 0) return ["Review created baselines before committing or using CI enforcement."];
  if (!mutationReport) return ["Run visual-hive mutate to measure test adequacy."];
  if (mutationReport.score < mutationReport.minScore) return ["Strengthen contracts for survived mutations."];
  return ["Keep PR checks enabled and schedule deeper mutation/protected checks."];
}

function grade(score: number, status: "missing" | "passed" | "failed"): ControlPlaneOverview["healthGrade"] {
  if (status === "missing") return "unknown";
  if (score >= 85) return "excellent";
  if (score >= 70) return "good";
  if (score >= 45) return "fair";
  return "poor";
}

function latestTargetStatus(targetId: string, report?: Report): string | undefined {
  const results = report?.results.filter((result) => result.targetId === targetId) ?? [];
  if (results.some((result) => result.status === "failed")) return "failed";
  if (results.some((result) => result.status === "created")) return "created";
  if (results.some((result) => result.status === "passed")) return "passed";
  return undefined;
}

function classifyResult(result: Report["results"][number]): string {
  const text = `${result.errors.join(" ")} ${result.selectorAssertions?.map((assertion) => `${assertion.kind}:${assertion.value}:${assertion.status}`).join(" ") ?? ""}`;
  if (text.includes("missing_baseline") || text.includes("Missing screenshot baseline")) return "missing_baseline";
  if (text.includes("mustExist")) return "missing_element";
  if (text.includes("mustNotExist")) return "unexpected_element";
  if (text.includes("login-page") || text.includes("github-login-button")) return "login_regression";
  if (result.networkErrors?.length) return "api_contract_regression";
  if (result.consoleErrors?.length) return "console_error";
  if (result.pageErrors?.length) return "page_error";
  if (result.screenshotAssertions?.some((shot) => shot.status === "failed")) return "visual_diff";
  return "possible_flake";
}

function pathIfInside(repoRoot: string, maybePath: string): string {
  const resolved = path.resolve(maybePath);
  return isInsidePath(repoRoot, resolved) ? toRepoRelativePath(repoRoot, resolved) : sanitizeText(maybePath);
}

function isPlan(value: unknown): value is Plan {
  const plan = value as Partial<Plan> | undefined;
  return Boolean(plan && plan.schemaVersion === 1 && Array.isArray(plan.items) && Array.isArray(plan.targets));
}

function emptyCoverage(): CoverageReport {
  return {
    schemaVersion: 1,
    project: "unknown",
    generatedAt: new Date().toISOString(),
    summary: {
      targetCount: 0,
      contractCount: 0,
      selectedContracts: 0,
      unselectedContracts: 0,
      prSafeContracts: 0,
      protectedContracts: 0,
      scheduleOnlyContracts: 0,
      routesCovered: 0,
      viewportsCovered: 0,
      uncoveredTargets: 0,
      uncoveredContracts: 0,
      changedFileRules: 0,
      matchedChangedFileRules: 0,
      unmatchedChangedFiles: 0
    },
    targets: [],
    contracts: [],
    routes: [],
    viewports: [],
    changedFileCoverage: [],
    unmatchedChangedFiles: [],
    uncoveredAreas: []
  };
}

export async function assertReadable(filePath: string): Promise<void> {
  await access(filePath, constants.R_OK);
}
