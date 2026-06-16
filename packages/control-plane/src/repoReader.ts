import { constants } from "node:fs";
import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import {
  loadConfig,
  listBaselines,
  inspectProviders,
  analyzeCoverage,
  analyzeCosts,
  analyzeRisk,
  auditContracts,
  auditFlows,
  auditSchedules,
  auditTargets,
  auditWorkflows,
  buildCoverageImprovementReport,
  artifactContentType,
  artifactKind,
  createRunHistoryEntry,
  createRunHistoryReport,
  githubWorkflowTemplates,
  indexArtifacts,
  listConnections,
  resolveConnection,
  sanitizeText,
  type ContractConfig,
  type CostAuditReport,
  type CoverageImprovementReport,
  type CoverageReport,
  type FlowAuditReport,
  type BaselineList,
  type LLMUsageReport,
  type MockProviderRunReport,
  type MutationReport,
  type Plan,
  type Report,
  type RiskRegisterReport,
  type SecurityAuditReport,
  type RunHistoryReport,
  type SetupRecommendationReport,
  type TargetConfig,
  type TriageFinding,
  type TriageReport,
  type VisualHiveConfig,
  type WorkflowAuditReport
} from "@visual-hive/core";
import { readControlPlaneActionHistory } from "./commandExecutor.js";
import { readLLMDecisionLog } from "./llmDecisions.js";
import { readProviderDecisionLog } from "./providerDecisions.js";
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
  ControlPlaneRunProfile,
  ControlPlaneRunbook,
  ControlPlaneRunbookCommand,
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
    triageReport,
    mutationReport,
    providerRunReport,
    providerDecisionLog,
    coverageImprovementArtifact,
    flowAuditArtifact,
    setupRecommendation,
    workflowAuditArtifact,
    runHistoryArtifact,
    riskArtifact,
    securityAudit,
    costAuditArtifact,
    issueMarkdown,
    prCommentMarkdown,
    triagePrompt,
    repairPrompt,
    missingTestsMarkdown,
    baselineReviewMarkdown,
    llmUsage,
    llmDecisionLog,
    actionHistory,
    artifacts,
    connections
  ] = await Promise.all([
    readJsonIfExists<unknown>(path.join(hiveRoot, "plan.json")),
    readJsonIfExists<Report>(path.join(hiveRoot, "report.json")),
    readJsonIfExists<TriageReport>(path.join(hiveRoot, "triage.json")),
    readJsonIfExists<MutationReport>(path.join(hiveRoot, "mutation-report.json")),
    readJsonIfExists<MockProviderRunReport>(path.join(hiveRoot, "provider-results.json")),
    readProviderDecisionLog(path.join(hiveRoot, "provider-decisions.json")),
    readJsonIfExists<CoverageImprovementReport>(path.join(hiveRoot, "coverage-recommendations.json")),
    readJsonIfExists<FlowAuditReport>(path.join(hiveRoot, "flows.json")),
    readJsonIfExists<SetupRecommendationReport>(path.join(hiveRoot, "recommendations.json")),
    readJsonIfExists<WorkflowAuditReport>(path.join(hiveRoot, "workflows.json")),
    readJsonIfExists<RunHistoryReport>(path.join(hiveRoot, "history.json")),
    readJsonIfExists<RiskRegisterReport>(path.join(hiveRoot, "risk.json")),
    readJsonIfExists<SecurityAuditReport>(path.join(hiveRoot, "security.json")),
    readJsonIfExists<CostAuditReport>(path.join(hiveRoot, "costs.json")),
    readTextIfExists(path.join(hiveRoot, "issue.md")),
    readTextIfExists(path.join(hiveRoot, "pr-comment.md")),
    readTextIfExists(path.join(hiveRoot, "triage-prompt.md")),
    readTextIfExists(path.join(hiveRoot, "repair-prompt.md")),
    readTextIfExists(path.join(hiveRoot, "missing-tests.md")),
    readTextIfExists(path.join(hiveRoot, "baseline-review.md")),
    readJsonIfExists<LLMUsageReport>(path.join(hiveRoot, "llm-usage.json")),
    readLLMDecisionLog(path.join(hiveRoot, "llm-decisions.json")),
    readControlPlaneActionHistory(path.join(hiveRoot, "control-plane-actions.json")),
    indexArtifacts({ repoRoot: resolved.repoRoot, hiveRoot, project: config?.project.name }).then((index) => index.artifacts),
    listConnections({ repoRoot: base.repoRoot })
  ]);

  const baselineList = report ? await collectBaselineList(resolved.repoRoot, path.join(hiveRoot, "report.json")) : undefined;
  const screenshots = collectScreenshotsFromBaselineList(resolved.repoRoot, report, baselineList);
  const failures = collectFailures(resolved.repoRoot, report, mutationReport, triageReport);
  const targets = collectTargets(config, report);
  const coverage = config
    ? analyzeCoverage(config, { plan: isPlan(plan) ? plan : undefined, selectedContractIds: report?.selectedContracts })
    : emptyCoverage();
  const coverageImprovementReport = config ? (coverageImprovementArtifact ?? buildCoverageImprovementReport(config, coverage, mutationReport)) : undefined;
  const targetAudit = config ? auditTargets(config, { plan: isPlan(plan) ? plan : undefined, report }) : undefined;
  const contractAudit = config
    ? auditContracts(config, { plan: isPlan(plan) ? plan : undefined, report, mutationReport, selectedContractIds: report?.selectedContracts })
    : undefined;
  const flowAudit = config
    ? (flowAuditArtifact ?? auditFlows(config, { plan: isPlan(plan) ? plan : undefined, report, selectedContractIds: report?.selectedContracts }))
    : undefined;
  const scheduleAudit = config ? auditSchedules(config, { changedFiles: isPlan(plan) ? plan.changedFiles : report?.changedFiles }) : undefined;
  const workflowAudit = config ? (workflowAuditArtifact ?? (await auditWorkflowFilesIfPresent(config, resolved.repoRoot))) : undefined;
  const contracts = collectContracts(config, report, mutationReport);
  const overview = buildOverview(report, mutationReport, configError);
  const providers = config ? inspectProviders(config) : [];
  const costAudit = config ? costAuditArtifact ?? analyzeCosts(config, { plan: isPlan(plan) ? plan : undefined, report, mutationReport, providerRunReport }) : undefined;
  const runHistory = runHistoryArtifact ?? buildTransientRunHistory(resolved.repoRoot, plan, report, mutationReport);
  const runbook = buildRunbook(resolved, config, plan, report, mutationReport);
  const runProfiles = buildRunProfiles(runbook);
  const riskReport = config
    ? riskArtifact ??
      analyzeRisk(config, {
        plan: isPlan(plan) ? plan : undefined,
        report,
        mutationReport,
        coverageReport: coverage,
        targetAudit,
        contractAudit,
        flowAudit,
        scheduleAudit,
        workflowAudit
      })
    : undefined;

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
    triageReport,
    runHistory,
    riskReport,
    securityAudit,
    costAudit,
    mutationReport,
    providerRunReport,
    providerDecisionLog,
    setupRecommendation,
    targetAudit,
    contractAudit,
    flowAudit,
    scheduleAudit,
    workflowAudit,
    issueMarkdown,
    prCommentMarkdown,
    triagePrompt,
    repairPrompt,
    missingTestsMarkdown,
    baselineReviewMarkdown,
    llmUsage,
    llmDecisionLog,
    actionHistory,
    overview,
    failures,
    runbook,
    runProfiles,
    screenshots,
    baselineSummary: baselineList?.summary,
    coverage,
    coverageImprovementReport,
    targets,
    contracts,
    providers,
    workflowTemplates: githubWorkflowTemplates,
    artifacts,
    connections
  };
}

function buildRunProfiles(runbook: ControlPlaneRunbook): ControlPlaneRunProfile[] {
  const definitions: Array<Omit<ControlPlaneRunProfile, "enabled" | "blockedReasons" | "expectedArtifacts" | "requiredSecrets" | "safety">> = [
    {
      id: "pr-acceptance",
      label: "PR acceptance",
      description: "Check readiness, produce a PR plan, run deterministic CI contracts, then refresh triage and the markdown report.",
      commandIds: ["doctor", "plan-pr", "run-ci", "baselines", "triage-report"]
    },
    {
      id: "triage-refresh",
      label: "Triage refresh",
      description: "Regenerate sanitized triage, repair prompts, issue/PR markdown, and the human-readable report from current artifacts.",
      commandIds: ["triage-report"]
    },
    {
      id: "mutation-audit",
      label: "Mutation adequacy audit",
      description: "Validate readiness, refresh the PR plan, run contract-aware mutation adequacy, then regenerate triage/report evidence.",
      commandIds: ["doctor", "plan-pr", "mutate", "triage-report"]
    },
    {
      id: "security-audit",
      label: "Security posture audit",
      description: "Validate readiness, audit workflow/config/provider/LLM security posture, then refresh the markdown report.",
      commandIds: ["doctor", "security", "triage-report"]
    },
    {
      id: "cost-audit",
      label: "Cost policy audit",
      description: "Validate readiness, audit local/external cost posture and provider budget policy, then refresh the markdown report.",
      commandIds: ["doctor", "costs", "triage-report"]
    },
    {
      id: "protected-schedule-preview",
      label: "Protected scheduled lane preview",
      description: "Show the trusted protected-lane command sequence when protected targets exist. This profile remains guidance-only in the local UI.",
      commandIds: ["schedule-protected"]
    }
  ];
  return definitions.map((definition) => materializeRunProfile(definition, runbook));
}

function materializeRunProfile(
  definition: Omit<ControlPlaneRunProfile, "enabled" | "blockedReasons" | "expectedArtifacts" | "requiredSecrets" | "safety">,
  runbook: ControlPlaneRunbook
): ControlPlaneRunProfile {
  const commands = definition.commandIds
    .map((id) => runbook.commands.find((command) => command.id === id))
    .filter((command): command is ControlPlaneRunbookCommand => Boolean(command));
  const missingCommands = definition.commandIds.filter((id) => !commands.some((command) => command.id === id));
  const requiredSecrets = uniqueStrings(commands.flatMap((command) => command.requiredSecrets));
  const blockedReasons = [
    ...missingCommands.map((id) => `Runbook command "${id}" is not available for this repository.`),
    ...commands
      .filter((command) => command.safety === "trusted_only")
      .map((command) => `Runbook command "${command.id}" is trusted-only and cannot be executed from the local Control Plane.`),
    ...(requiredSecrets.length ? [`Profile requires protected environment variable names: ${requiredSecrets.join(", ")}.`] : [])
  ];
  return {
    ...definition,
    safety: mostRestrictiveSafety(commands.map((command) => command.safety)),
    enabled: blockedReasons.length === 0,
    blockedReasons,
    expectedArtifacts: uniqueStrings(commands.flatMap((command) => command.expectedArtifacts)),
    requiredSecrets
  };
}

function mostRestrictiveSafety(safety: Array<ControlPlaneRunbookCommand["safety"]>): ControlPlaneRunbookCommand["safety"] {
  if (safety.includes("trusted_only")) return "trusted_only";
  if (safety.includes("local_only")) return "local_only";
  return "pr_safe";
}

function buildRunbook(
  resolved: ResolvedControlPlaneOptions,
  config?: VisualHiveConfig,
  plan?: unknown,
  report?: Report,
  mutationReport?: MutationReport
): ControlPlaneRunbook {
  const configPath = toRepoRelativePath(resolved.repoRoot, resolved.configPath);
  const configFlag = `--config ${quoteForShell(configPath)}`;
  const commands: ControlPlaneRunbookCommand[] = [
    {
      id: "doctor",
      label: "Check local readiness",
      lane: "local",
      command: `visual-hive doctor ${configFlag}`,
      cwd: resolved.repoRoot,
      safety: "pr_safe",
      description: "Validate config, Node, Playwright, target shapes, and protected secret names before running contracts.",
      requiredSecrets: [],
      expectedArtifacts: []
    },
    {
      id: "plan-pr",
      label: "Plan PR-safe contracts",
      lane: "pull_request",
      command: `visual-hive plan ${configFlag} --mode pr --base origin/main --ci`,
      cwd: resolved.repoRoot,
      safety: "pr_safe",
      description: "Select only PR-safe deterministic contracts from changed files, target safety, severity, cost, mutation applicability, and provider policy.",
      requiredSecrets: [],
      expectedArtifacts: [".visual-hive/plan.json"]
    },
    {
      id: "run-ci",
      label: "Run deterministic CI checks",
      lane: "ci",
      command: `visual-hive run ${configFlag} --ci`,
      cwd: resolved.repoRoot,
      safety: "pr_safe",
      description: "Run generated Playwright contracts as the pass/fail oracle. CI mode fails on missing baselines unless snapshot updates are explicitly enabled.",
      requiredSecrets: [],
      expectedArtifacts: [".visual-hive/report.json", ".visual-hive/generated/visual-hive.generated.spec.ts", ".visual-hive/artifacts"]
    },
    {
      id: "triage-report",
      label: "Triage and summarize",
      lane: "triage",
      command: `visual-hive triage ${configFlag} && visual-hive report ${configFlag}`,
      cwd: resolved.repoRoot,
      safety: "pr_safe",
      description: "Generate offline triage, repair prompts, issue/PR markdown, and a markdown report from sanitized deterministic artifacts.",
      requiredSecrets: [],
      expectedArtifacts: [".visual-hive/triage.json", ".visual-hive/issue.md", ".visual-hive/pr-comment.md"]
    },
    {
      id: "baselines",
      label: "Refresh baseline review queue",
      lane: "local",
      command: `visual-hive baselines list ${configFlag} --write`,
      cwd: resolved.repoRoot,
      safety: "pr_safe",
      description: "Write .visual-hive/baselines.json with pending, approved, rejected, created, failed, and missing-baseline screenshot review evidence.",
      requiredSecrets: [],
      expectedArtifacts: [".visual-hive/baselines.json"]
    },
    {
      id: "mutate",
      label: "Measure mutation adequacy",
      lane: "schedule",
      command: `visual-hive mutate ${configFlag}${config?.mutation.enabled ? " --enforce-min-score" : ""}`,
      cwd: resolved.repoRoot,
      safety: "local_only",
      description: "Run contract-aware mutation operators to verify that deterministic contracts catch intentional UI/auth/API breakage.",
      requiredSecrets: [],
      expectedArtifacts: [".visual-hive/mutation-report.json"]
    },
    {
      id: "security",
      label: "Audit security posture",
      lane: "local",
      command: `visual-hive security ${configFlag}`,
      cwd: resolved.repoRoot,
      safety: "pr_safe",
      description: "Audit workflow safety, protected targets, provider/LLM governance, and optional npm audit evidence without making external provider or model calls.",
      requiredSecrets: [],
      expectedArtifacts: [".visual-hive/security.json"]
    },
    {
      id: "costs",
      label: "Audit cost posture",
      lane: "local",
      command: `visual-hive costs ${configFlag}`,
      cwd: resolved.repoRoot,
      safety: "pr_safe",
      description: "Explain selected contract volume, screenshot volume, external provider policy, and cost budget posture without making external calls.",
      requiredSecrets: [],
      expectedArtifacts: [".visual-hive/costs.json"]
    },
    {
      id: "control-plane",
      label: "Open local Control Plane",
      lane: "ui",
      command: `visual-hive ui ${configFlag}`,
      cwd: resolved.repoRoot,
      safety: "local_only",
      description: "Inspect runs, failures, baselines, coverage, providers, LLM prompts, schedules, workflows, artifacts, and this runbook locally.",
      requiredSecrets: [],
      expectedArtifacts: []
    }
  ];
  const protectedSecretNames = config ? protectedSecrets(config) : [];
  const hasProtectedTargets = config ? Object.values(config.targets).some((target) => target.kind === "protected") : false;
  if (hasProtectedTargets) {
    commands.push({
      id: "schedule-protected",
      label: "Plan trusted protected lane",
      lane: "protected",
      command: `visual-hive plan ${configFlag} --mode schedule --allow-unsafe-targets && visual-hive run ${configFlag} --ci`,
      cwd: resolved.repoRoot,
      safety: "trusted_only",
      description: "Use only from a trusted scheduled/manual workflow where protected target secret values are available. Do not run this from untrusted pull_request code.",
      requiredSecrets: protectedSecretNames,
      expectedArtifacts: [".visual-hive/plan.json", ".visual-hive/report.json"]
    });
  }
  const notes = [
    "Playwright contracts remain the deterministic pass/fail oracle.",
    "PR commands require no secrets and should run under pull_request with read-only permissions.",
    "LLM and provider outputs are advisory/supplemental unless a future trusted adapter explicitly changes policy.",
    "Protected commands show required environment variable names only; secret values are never included."
  ];
  if (isPlan(plan)) {
    notes.push(`Latest plan selected ${plan.items.length} contract(s) across ${plan.targets.length} target(s).`);
  }
  if (report) {
    notes.push(`Latest deterministic report status: ${report.status}.`);
  }
  if (mutationReport) {
    notes.push(`Latest mutation score: ${Math.round(mutationReport.score * 100)}%.`);
  }
  return {
    generatedAt: new Date().toISOString(),
    configPath,
    commands,
    notes
  };
}

function protectedSecrets(config: VisualHiveConfig): string[] {
  return uniqueStrings(
    Object.values(config.targets).flatMap((target) => (target.kind === "protected" ? (target.requiresSecrets ?? []) : []))
  );
}

function quoteForShell(value: string): string {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) return value;
  return `"${value.replaceAll('"', '\\"')}"`;
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

async function collectBaselineList(repoRoot: string, reportPath: string): Promise<BaselineList | undefined> {
  try {
    return await listBaselines({ repoRoot, reportPath });
  } catch {
    // Fall back to report-only rendering when a legacy report contains paths
    // that cannot be safely resolved against the selected repo.
    return undefined;
  }
}

function collectScreenshotsFromBaselineList(
  repoRoot: string,
  report?: Report,
  baselineList?: BaselineList
): ControlPlaneScreenshot[] {
  if (baselineList) {
    return baselineList.entries.map((entry) => ({
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

function collectFailures(repoRoot: string, report?: Report, mutationReport?: MutationReport, triageReport?: TriageReport): ControlPlaneFailure[] {
  const findings = triageReport?.findings ?? [];
  const usedFindings = new Set<TriageFinding>();
  const deterministic = (report?.results ?? [])
    .filter((result) => result.status === "failed")
    .map((result) => {
      const relatedFindings = findings.filter((finding) => findingMatchesResult(finding, result.contractId, result.targetId));
      for (const finding of relatedFindings) usedFindings.add(finding);
      return {
        contractId: result.contractId,
        targetId: result.targetId,
        status: result.status,
        classification: relatedFindings[0]?.classification ?? classifyResult(result),
        severity: relatedFindings[0]?.severity,
        errorExcerpt: sanitizeText(relatedFindings[0]?.title ?? result.errors[0] ?? "Contract failed without an error excerpt."),
        evidence: uniqueStrings(relatedFindings.flatMap((finding) => finding.evidence)),
        suggestedFiles: uniqueStrings(relatedFindings.flatMap((finding) => finding.suggestedFiles ?? [])),
        suggestedNextTests: uniqueStrings(relatedFindings.flatMap((finding) => finding.suggestedNextTests)),
        reproductionCommand: result.reproductionCommand,
        artifacts: result.artifacts.map((artifact) => pathIfInside(repoRoot, artifact))
      };
    });
  const mutation = (mutationReport?.results ?? [])
    .filter((result) => result.status === "survived")
    .map((result) => {
      const relatedFindings = findings.filter((finding) => finding.classification === "mutation_survivor" && finding.title.includes(result.operator));
      for (const finding of relatedFindings) usedFindings.add(finding);
      return {
        contractId: result.contractIds.join(", ") || "unmapped",
        targetId: "mutation",
        status: result.status,
        classification: "mutation_survivor",
        severity: relatedFindings[0]?.severity ?? "high",
        errorExcerpt: sanitizeText(
          relatedFindings[0]?.title ?? `Mutation survived: ${result.operator}. Add or strengthen contracts for ${result.expectedFailureKinds?.join(", ") || "this behavior"}.`
        ),
        evidence: uniqueStrings(relatedFindings.flatMap((finding) => finding.evidence)),
        suggestedFiles: uniqueStrings(relatedFindings.flatMap((finding) => finding.suggestedFiles ?? [])),
        suggestedNextTests: uniqueStrings(
          relatedFindings.flatMap((finding) => finding.suggestedNextTests).concat(`Add an assertion that detects ${result.operator}.`)
        ),
        artifacts: (result.artifacts ?? []).map((artifact) => pathIfInside(repoRoot, artifact))
      };
    });
  const findingOnly = findings
    .filter((finding) => !usedFindings.has(finding))
    .map((finding) => ({
      contractId: finding.contractIds?.join(", ") || "triage",
      targetId: finding.targetIds?.join(", ") || "triage",
      status: "finding",
      classification: finding.classification,
      severity: finding.severity,
      errorExcerpt: sanitizeText(finding.title),
      evidence: finding.evidence.map((item) => sanitizeText(item)),
      suggestedFiles: (finding.suggestedFiles ?? []).map((item) => sanitizeText(item)),
      suggestedNextTests: finding.suggestedNextTests.map((item) => sanitizeText(item)),
      artifacts: []
    }));
  return [...deterministic, ...mutation, ...findingOnly];
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

function findingMatchesResult(finding: TriageFinding, contractId: string, targetId: string): boolean {
  return Boolean(finding.contractIds?.includes(contractId) || finding.targetIds?.includes(targetId) || finding.title.includes(contractId));
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => sanitizeText(value)).filter(Boolean))].sort();
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
