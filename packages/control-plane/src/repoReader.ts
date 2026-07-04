import { constants } from "node:fs";
import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import {
  loadConfig,
  listBaselines,
  inspectProviders,
  buildSetupProgress,
  analyzeCoverage,
  analyzeCosts,
  analyzeReadiness,
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
  type ContextLedger,
  type CostAuditReport,
  type CoverageImprovementReport,
  type CoverageReport,
  type AgentPacket,
  type EvidencePacket,
  type FlowAuditReport,
  type HandoffPacket,
  type HiveExportBundle,
  type HiveGuardedRepairPreview,
  type HiveModeComparison,
  type HiveRepairRequestEnvelope,
  type HiveTrustedRepairConsumerSummary,
  type HiveTrustedRepairWorkflowDryRun,
  type BaselineList,
  type LLMUsageReport,
  type MockProviderRunReport,
  type MutationReport,
  type Plan,
  type PlanLaneSummaryReport,
  type ProviderHandoffManifest,
  type ProviderSetupPlan,
  type Report,
  type RiskRegisterReport,
  type ReadinessReport,
  type SecurityAuditReport,
  type SchemaCatalogReport,
  type RunHistoryReport,
  type SetupRecommendationReport,
  type SetupProgressReport,
  type SetupPullRequestPlanReport,
  type TargetConfig,
  type TestCreationPlan,
  type TriageFinding,
  type TriageReport,
  type VerdictReport,
  type VisualHiveConfig,
  type WorkflowAuditReport
} from "@visual-hive/core";
import { readControlPlaneActionHistory } from "./commandExecutor.js";
import { readLLMDecisionLog } from "./llmDecisions.js";
import { readProviderDecisionLog } from "./providerDecisions.js";
import { isControlPlaneExecutableCommandId } from "./runbookPolicy.js";
import {
  isInsidePath,
  normalizeRepoRelativePath,
  resolveSafeChildPath,
  toRepoRelativePath
} from "./safePath.js";
import type {
  ArtifactFile,
  ControlPlaneFailure,
  ControlPlaneGuidanceState,
  ControlPlaneNavigationBadges,
  ControlPlaneOptions,
  ControlPlanePipelineReport,
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
    planLaneSummary,
    report,
    triageReport,
    mutationReport,
    providerRunReport,
    providerDecisionLog,
    providerSetupPlan,
    providerHandoff,
    schemaCatalog,
    coverageImprovementArtifact,
    flowAuditArtifact,
    setupRecommendation,
    setupPullRequestPlan,
    pipelineReport,
    workflowAuditArtifact,
    runHistoryArtifact,
    contextLedger,
    riskArtifact,
    readinessArtifact,
    securityAudit,
    costAuditArtifact,
    evidencePacket,
    verdictReport,
    handoffPacket,
    hiveExport,
    hiveGuardedRepairPreview,
    hiveRepairRequestEnvelope,
    hiveTrustedRepairConsumerSummary,
    hiveTrustedRepairWorkflowDryRun,
    hiveModeComparison,
    agentPacket,
    handoffAgentPacket,
    providerAgentPacket,
    testCreationPlan,
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
    readJsonIfExists<PlanLaneSummaryReport>(path.join(hiveRoot, "plans.json")),
    readJsonIfExists<Report>(path.join(hiveRoot, "report.json")),
    readJsonIfExists<TriageReport>(path.join(hiveRoot, "triage.json")),
    readJsonIfExists<MutationReport>(path.join(hiveRoot, "mutation-report.json")),
    readJsonIfExists<MockProviderRunReport>(path.join(hiveRoot, "provider-results.json")),
    readProviderDecisionLog(path.join(hiveRoot, "provider-decisions.json")),
    readJsonIfExists<ProviderSetupPlan>(path.join(hiveRoot, "provider-setup-plan.json")),
    readJsonIfExists<ProviderHandoffManifest>(path.join(hiveRoot, "provider-handoff.json")),
    readJsonIfExists<SchemaCatalogReport>(path.join(hiveRoot, "schema-catalog.json")),
    readJsonIfExists<CoverageImprovementReport>(path.join(hiveRoot, "coverage-recommendations.json")),
    readJsonIfExists<FlowAuditReport>(path.join(hiveRoot, "flows.json")),
    readJsonIfExists<SetupRecommendationReport>(path.join(hiveRoot, "recommendations.json")),
    readJsonIfExists<SetupPullRequestPlanReport>(path.join(hiveRoot, "setup-pr-plan.json")),
    readJsonIfExists<ControlPlanePipelineReport>(path.join(hiveRoot, "pipeline.json")),
    readJsonIfExists<WorkflowAuditReport>(path.join(hiveRoot, "workflows.json")),
    readJsonIfExists<RunHistoryReport>(path.join(hiveRoot, "history.json")),
    readJsonIfExists<ContextLedger>(path.join(hiveRoot, "context-ledger.json")),
    readJsonIfExists<RiskRegisterReport>(path.join(hiveRoot, "risk.json")),
    readJsonIfExists<ReadinessReport>(path.join(hiveRoot, "readiness.json")),
    readJsonIfExists<SecurityAuditReport>(path.join(hiveRoot, "security.json")),
    readJsonIfExists<CostAuditReport>(path.join(hiveRoot, "costs.json")),
    readJsonIfExists<EvidencePacket>(path.join(hiveRoot, "evidence-packet.json")),
    readJsonIfExists<VerdictReport>(path.join(hiveRoot, "verdict.json")),
    readJsonIfExists<HandoffPacket>(path.join(hiveRoot, "handoff.json")),
    readJsonIfExists<HiveExportBundle>(path.join(hiveRoot, "hive", "hive-export.json")),
    readJsonIfExists<HiveGuardedRepairPreview>(path.join(hiveRoot, "hive", "guarded-repair-preview.json")),
    readJsonIfExists<HiveRepairRequestEnvelope>(path.join(hiveRoot, "hive", "repair-request-envelope.json")),
    readJsonIfExists<HiveTrustedRepairConsumerSummary>(path.join(hiveRoot, "hive", "trusted-repair-consumer-summary.json")),
    readJsonIfExists<HiveTrustedRepairWorkflowDryRun>(path.join(hiveRoot, "hive", "trusted-repair-workflow-dry-run.json")),
    readJsonIfExists<HiveModeComparison>(path.join(hiveRoot, "hive", "mode-comparison.json")),
    readJsonIfExists<AgentPacket>(path.join(hiveRoot, "agent-packet.json")),
    readJsonIfExists<AgentPacket>(path.join(hiveRoot, "handoff-agent-packet.json")),
    readJsonIfExists<AgentPacket>(path.join(hiveRoot, "provider-agent-packet.json")),
    readJsonIfExists<TestCreationPlan>(path.join(hiveRoot, "test-creation-plan.json")),
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
  const overview = buildOverview(report, mutationReport, configError, evidencePacket, verdictReport, pipelineReport);
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
        workflowAudit,
        providerDecisions: providerDecisionLog,
        providerSetupPlan,
        providerHandoff,
        llmDecisions: llmDecisionLog,
        runHistory
      })
    : undefined;
  const readinessReport = config
    ? readinessArtifact ??
      analyzeReadiness(config, {
        plan: isPlan(plan) ? plan : undefined,
        report,
        mutationReport,
        baselines: baselineList,
        workflowAudit,
        securityAudit,
        costAudit,
        providerDecisions: providerDecisionLog,
        providerSetupPlan,
        providerHandoff,
        llmDecisions: llmDecisionLog,
        runHistory
      })
    : undefined;
  const setupProgress = buildSetupProgress({
    config,
    configError,
    plan: isPlan(plan) ? plan : undefined,
    report,
    mutationReport,
    triageReport,
    setupRecommendation,
    workflowAudit,
    readinessReport,
    providerSetupPlan,
    providerHandoff
  });
  const guidanceState = buildGuidanceState({
    config,
    configError,
    hasConfigFile: Boolean(configRaw),
    plan: isPlan(plan) ? plan : undefined,
    report,
    evidencePacket,
    verdictReport,
    handoffPacket,
    agentPacket,
    mutationReport,
    setupProgress,
    readinessReport,
    workflowAudit,
    setupPullRequestPlan,
    runbook,
    readOnly: resolved.readOnly,
    screenshots,
    failures
  });
  const navigationBadges = buildNavigationBadges({
    setupProgress,
    failures,
    screenshots,
    riskReport,
    providers,
    testCreationPlan,
    evidencePacket,
    handoffPacket,
    hiveExport,
    hiveGuardedRepairPreview,
    hiveRepairRequestEnvelope,
    hiveTrustedRepairConsumerSummary,
    hiveTrustedRepairWorkflowDryRun,
    hiveModeComparison,
    agentPacket,
    handoffAgentPacket,
    providerAgentPacket,
    schemaCatalog,
    artifacts
  });

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
    planLaneSummary,
    report,
    triageReport,
    runHistory,
    contextLedger,
    riskReport,
    readinessReport,
    securityAudit,
    costAudit,
    evidencePacket,
    verdictReport,
    handoffPacket,
    hiveExport,
    hiveGuardedRepairPreview,
    hiveRepairRequestEnvelope,
    hiveTrustedRepairConsumerSummary,
    hiveTrustedRepairWorkflowDryRun,
    hiveModeComparison,
    agentPacket,
    handoffAgentPacket,
    providerAgentPacket,
    mutationReport,
    providerRunReport,
    providerDecisionLog,
    providerSetupPlan,
    providerHandoff,
    schemaCatalog,
    setupRecommendation,
    setupPullRequestPlan,
    pipelineReport,
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
    guidanceState,
    navigationBadges,
    failures,
    runbook,
    runProfiles,
    setupProgress,
    screenshots,
    baselineSummary: baselineList?.summary,
    coverage,
    coverageImprovementReport,
    testCreationPlan,
    targets,
    contracts,
    providers,
    workflowTemplates: githubWorkflowTemplates,
    artifacts,
    connections
  };
}

function buildGuidanceState(input: {
  config?: VisualHiveConfig;
  configError?: string;
  hasConfigFile: boolean;
  plan?: Plan;
  report?: Report;
  evidencePacket?: EvidencePacket;
  verdictReport?: VerdictReport;
  handoffPacket?: HandoffPacket;
  agentPacket?: AgentPacket;
  mutationReport?: MutationReport;
  setupProgress: SetupProgressReport;
  readinessReport?: ReadinessReport;
  workflowAudit?: WorkflowAuditReport;
  setupPullRequestPlan?: SetupPullRequestPlanReport;
  runbook: ControlPlaneRunbook;
  readOnly: boolean;
  screenshots: ControlPlaneScreenshot[];
  failures: ControlPlaneFailure[];
}): ControlPlaneGuidanceState {
  const baselineReviewCount = input.screenshots.filter((shot) => ["created", "missing_baseline", "failed"].includes(shot.status)).length;
  const verdict = resolveVisualHiveVerdict(input.report, input.evidencePacket, input.verdictReport);
  const blockedReasonsFromVerdict = resolveBlockedReasons(input.report, input.evidencePacket, input.verdictReport);
  const failedReasonsFromVerdict = resolveFailedReasons(input.report, input.evidencePacket, input.verdictReport);
  const mutationScore = input.mutationReport?.score;
  const minMutationScore = input.mutationReport?.minScore ?? input.config?.mutation?.minScore ?? 0.7;
  const readinessStatus = String(input.readinessReport?.status ?? "").toLowerCase();
  const secondaryActions: ControlPlaneGuidanceState["secondaryActions"] = [
    {
      id: "open-report",
      label: "Open report",
      description: "Review deterministic evidence and reproduction commands.",
      area: "review",
      tone: "info"
    },
    {
      id: "tune-config",
      label: "Tune config",
      description: "Adjust targets, contracts, schedules, and providers.",
      area: "configure"
    }
  ];

  let state: ControlPlaneGuidanceState["state"] = "ready";
  let title = "PR-safe checks passing";
  let summary = "Visual Hive has deterministic evidence and no urgent review items in the current snapshot.";
  let primaryAction: ControlPlaneGuidanceState["primaryAction"] = {
    id: "run-pr-safe",
    label: "Run PR-safe checks",
    description: "Refresh Visual Hive deterministic verdict evidence for safe targets.",
    area: "run",
    commandId: "run-ci",
    tone: "success"
  };
  const blockedReasons: string[] = [];

  if (!input.config) {
    const invalidConfig = Boolean(input.configError && input.hasConfigFile);
    state = invalidConfig ? "config_error" : "no_config";
    title = invalidConfig ? "Fix the Visual Hive config" : "Create a Visual Hive config";
    summary = invalidConfig
      ? "The config could not be parsed, so the Control Plane cannot plan or run checks yet."
      : "Start by detecting the app and writing a project-specific visual-hive.config.yaml.";
    primaryAction = {
      id: "setup-config",
      label: invalidConfig ? "Open config editor" : "Start setup",
      description: "Use guided setup to create or repair configuration before running checks.",
      area: "configure",
      commandId: "recommend",
      tone: invalidConfig ? "danger" : "amber"
    };
    if (invalidConfig && input.configError) blockedReasons.push(input.configError);
  } else if (!input.plan && !input.report) {
    state = "plan_needed";
    title = "Plan the PR-safe lane";
    summary = "Visual Hive has a config, but no current plan artifact. Plan first so only relevant safe contracts run.";
    primaryAction = {
      id: "plan-pr",
      label: "Plan PR-safe checks",
      description: "Select targets and contracts using changed files, safety, severity, and cost.",
      area: "run",
      commandId: "plan-pr",
      tone: "amber"
    };
  } else if (!input.report) {
    state = "run_needed";
    title = "Run deterministic checks";
    summary = "A plan exists. Run the Playwright contracts to collect selector, screenshot, console, and artifact evidence.";
    primaryAction = {
      id: "run-pr-safe",
      label: "Run PR-safe checks",
      description: "Execute deterministic contracts against selected safe targets.",
      area: "run",
      commandId: "run-ci",
      tone: "amber"
    };
  } else if (verdict === "blocked") {
    state = "readiness_blocked";
    title = "Checks are blocked";
    summary = "Visual Hive could not make a clean product-regression verdict because evidence is missing, unsafe, or environment setup failed.";
    primaryAction = {
      id: "review-blockers",
      label: "Review blockers",
      description: "Inspect blocked evidence such as target startup, missing baselines, protected secrets, or policy gates.",
      area: "review",
      tone: "warning"
    };
    blockedReasons.push(...blockedReasonsFromVerdict.slice(0, 4));
  } else if (input.failures.length > 0 || verdict === "failed" || input.report.status === "failed") {
    state = "failures_need_triage";
    title = "Failures need triage";
    summary = "Visual Hive found deterministic regression evidence such as failing contracts, unexpected elements, visual diffs, or mutation survivors.";
    primaryAction = {
      id: "review-failures",
      label: "Review failures",
      description: "Open the failure inbox with likely cause, artifacts, and reproduction commands.",
      area: "review",
      tone: "danger"
    };
    blockedReasons.push(...failedReasonsFromVerdict.slice(0, 4));
  } else if (baselineReviewCount > 0) {
    state = "baselines_need_review";
    title = "Review visual changes";
    summary = "New or changed screenshots need human review before they become trusted baselines.";
    primaryAction = {
      id: "review-baselines",
      label: "Review visual changes",
      description: "Compare baseline, actual, and diff images before approving.",
      area: "review",
      commandId: "baselines",
      tone: "warning"
    };
  } else if (typeof mutationScore === "number" && mutationScore < minMutationScore) {
    state = "mutation_needs_work";
    title = "Improve mutation score";
    summary = "Some intentional UI/API breakages survived. Add or strengthen contracts before trusting this lane.";
    primaryAction = {
      id: "mutation-audit",
      label: "View mutation report",
      description: "Inspect survived mutations and suggested missing tests.",
      area: "review",
      commandId: "mutate",
      tone: "warning"
    };
  } else if (["blocked", "failed", "error"].includes(readinessStatus)) {
    state = "readiness_blocked";
    title = "Clear readiness gates";
    summary = "The deterministic lane is healthy, but readiness checks still have workflow, security, cost, or setup blockers.";
    primaryAction = {
      id: "readiness",
      label: "Review readiness",
      description: "Inspect merge and release gates before enabling broader automation.",
      area: "configure",
      commandId: "readiness",
      tone: "warning"
    };
  }

  return {
    state,
    title,
    summary,
    primaryAction,
    secondaryActions,
    blockedReasons,
    progress: buildGuidanceProgress(input, state),
    adoptionChecklist: buildAdoptionChecklist(input)
  };
}

function buildAdoptionChecklist(input: {
  config?: VisualHiveConfig;
  configError?: string;
  plan?: Plan;
  report?: Report;
  evidencePacket?: EvidencePacket;
  handoffPacket?: HandoffPacket;
  agentPacket?: AgentPacket;
  mutationReport?: MutationReport;
  setupProgress: SetupProgressReport;
  screenshots: ControlPlaneScreenshot[];
  failures: ControlPlaneFailure[];
  workflowAudit?: WorkflowAuditReport;
  setupPullRequestPlan?: SetupPullRequestPlanReport;
  runbook: ControlPlaneRunbook;
  readOnly: boolean;
}): ControlPlaneGuidanceState["adoptionChecklist"] {
  const pendingBaselines = input.screenshots.filter((shot) => ["created", "failed", "missing_baseline"].includes(shot.status)).length;
  const mutationScore = input.mutationReport?.score;
  const mutationMinScore = input.mutationReport?.minScore ?? input.config?.mutation?.minScore ?? 0.7;
  const selectedPlanItems = input.plan?.items.length ?? 0;
  const criticalWorkflowFindings = input.workflowAudit?.summary?.criticalFindings ?? 0;
  const commandFor = (commandId: string | undefined) => checklistCommand(commandId, input.runbook, input.readOnly);
  return [
    {
      id: "configure-repo",
      step: "1. Configure the repo",
      status: input.configError ? "blocked" : input.config ? "complete" : "current",
      why: "Visual Hive needs a target, contracts, and safe defaults before it can produce useful evidence.",
      nextAction: input.configError ? "Fix config validation errors" : input.config ? "Config loaded" : "Generate or write config",
      area: "configure",
      ...commandFor("doctor")
    },
    {
      id: "plan-pr-safe",
      step: "2. Plan PR-safe checks",
      status: selectedPlanItems > 0 ? "complete" : "pending",
      why: "Planning decides what to run based on changed files, target safety, cost, and severity.",
      nextAction: selectedPlanItems > 0 ? `${selectedPlanItems} selected item(s)` : "Run a PR plan",
      area: "run",
      ...commandFor("plan-pr")
    },
    {
      id: "run-deterministic-evidence",
      step: "3. Run deterministic evidence",
      status: input.report?.status === "passed" ? "complete" : input.report?.status === "failed" ? "blocked" : input.report ? "review" : "pending",
      why: "Deterministic browser, selector, screenshot, console, and network evidence feeds the Visual Hive verdict.",
      nextAction: input.report ? `Latest run ${input.report.status}` : "Run PR-safe checks",
      area: "run",
      ...commandFor("run-ci")
    },
    {
      id: "review-visual-changes",
      step: "4. Review visual changes",
      status: pendingBaselines > 0 || input.failures.length > 0 ? "review" : input.report ? "complete" : "pending",
      why: "Created baselines, visual diffs, and failures need human review before a workflow becomes trusted.",
      nextAction:
        pendingBaselines > 0
          ? `${pendingBaselines} baseline(s) need review`
          : input.failures.length
            ? `${input.failures.length} failure(s) need triage`
            : "No visual review blockers",
      area: "review",
      ...commandFor(input.failures.length > 0 ? "triage-report" : "baselines")
    },
    {
      id: "measure-adequacy",
      step: "5. Measure adequacy",
      status: typeof mutationScore === "number" ? (mutationScore >= mutationMinScore ? "complete" : "review") : "pending",
      why: "Mutation adequacy asks whether the visual contracts catch intentional UI/auth/API breakage.",
      nextAction: typeof mutationScore === "number" ? `Mutation score ${Math.round(mutationScore * 100)}%` : "Run mutation audit",
      area: "run",
      ...commandFor("mutate")
    },
    {
      id: "package-agent-handoff",
      step: "6. Package agent handoff",
      status: input.evidencePacket && input.handoffPacket && input.agentPacket ? "complete" : input.evidencePacket ? "review" : "pending",
      why: "Evidence, handoff, Hive export, and Agent Packets give humans or agents safe context without granting verdict authority.",
      nextAction: input.agentPacket ? "Agent packet ready" : input.evidencePacket ? "Complete handoff packet" : "Create Evidence Packet",
      area: "review",
      ...commandFor(!input.evidencePacket ? "evidence" : !input.handoffPacket ? "handoff" : "agent-packet")
    },
    {
      id: "enable-safe-workflow",
      step: "7. Enable safe workflow",
      status: criticalWorkflowFindings > 0 ? "blocked" : input.setupPullRequestPlan || input.workflowAudit ? "complete" : "pending",
      why: "PR workflows should stay read-only, no-secret, and artifact-based before teams depend on them.",
      nextAction: criticalWorkflowFindings > 0 ? `${criticalWorkflowFindings} critical workflow issue(s)` : input.setupPullRequestPlan ? "Setup PR plan ready" : "Generate workflow guidance",
      area: "configure",
      ...commandFor(criticalWorkflowFindings > 0 ? "security" : "readiness")
    }
  ];
}

function checklistCommand(
  commandId: string | undefined,
  runbook: ControlPlaneRunbook,
  readOnly: boolean
): Pick<
  ControlPlaneGuidanceState["adoptionChecklist"][number],
  "commandId" | "commandLabel" | "command" | "commandSafety" | "commandRunnable" | "commandBlockedReason" | "expectedArtifacts"
> {
  if (!commandId) {
    return {
      commandRunnable: false,
      commandBlockedReason: "This step is navigation-only; open the linked workspace for guided actions.",
      expectedArtifacts: []
    };
  }
  const command = runbook.commands.find((candidate) => candidate.id === commandId);
  if (!command) {
    return {
      commandId,
      commandRunnable: false,
      commandBlockedReason: `Runbook command "${commandId}" is not available in this snapshot.`,
      expectedArtifacts: []
    };
  }
  const blockedReason = checklistCommandBlockedReason(command, readOnly);
  return {
    commandId: command.id,
    commandLabel: command.label,
    command: command.command,
    commandSafety: command.safety,
    commandRunnable: !blockedReason,
    commandBlockedReason: blockedReason,
    expectedArtifacts: command.expectedArtifacts
  };
}

function checklistCommandBlockedReason(command: ControlPlaneRunbookCommand, readOnly: boolean): string | undefined {
  if (readOnly) return "Control Plane is read-only. Copy the command or restart without --read-only to run it locally.";
  if (!isControlPlaneExecutableCommandId(command.id)) return `Runbook command "${command.id}" is guidance-only and cannot be executed from the Control Plane.`;
  if (command.safety === "trusted_only") return "Trusted-only commands require scheduled/manual protected automation and cannot be launched locally.";
  if (command.requiredSecrets.length > 0) return `Command requires protected environment variable names: ${command.requiredSecrets.join(", ")}.`;
  return undefined;
}

function buildGuidanceProgress(
  input: {
    config?: VisualHiveConfig;
    configError?: string;
    plan?: Plan;
    report?: Report;
    evidencePacket?: EvidencePacket;
    verdictReport?: VerdictReport;
    mutationReport?: MutationReport;
    setupProgress: SetupProgressReport;
    screenshots: ControlPlaneScreenshot[];
    failures: ControlPlaneFailure[];
  },
  state: ControlPlaneGuidanceState["state"]
): ControlPlaneGuidanceState["progress"] {
  const baselineReviewCount = input.screenshots.filter((shot) => ["created", "missing_baseline", "failed"].includes(shot.status)).length;
  const verdict = resolveVisualHiveVerdict(input.report, input.evidencePacket, input.verdictReport);
  const mutationScore = input.mutationReport?.score;
  const minMutationScore = input.mutationReport?.minScore ?? input.config?.mutation?.minScore ?? 0.7;
  return [
    {
      id: "setup",
      label: "Setup",
      status: input.config && !input.configError ? "complete" : state === "config_error" ? "blocked" : "current",
      description: "Load a valid project config.",
      commandId: "recommend"
    },
    {
      id: "plan",
      label: "Plan",
      status: input.plan || input.report ? "complete" : input.config ? "current" : "pending",
      description: "Select PR-safe contracts based on risk and changed files.",
      commandId: "plan-pr"
    },
    {
      id: "run",
      label: "Run",
      status: input.report ? (verdict === "failed" || verdict === "blocked" ? "blocked" : "complete") : input.plan ? "current" : "pending",
      description: "Execute deterministic Playwright contracts.",
      commandId: "run-ci"
    },
    {
      id: "review",
      label: "Review",
      status: input.failures.length > 0 ? "blocked" : baselineReviewCount > 0 ? "review" : input.report ? "complete" : "pending",
      description: "Triage failures and approve visual baselines.",
      commandId: "baselines"
    },
    {
      id: "strengthen",
      label: "Strengthen",
      status: typeof mutationScore === "number" ? (mutationScore >= minMutationScore ? "complete" : "review") : "pending",
      description: "Use mutation adequacy and coverage gaps to harden tests.",
      commandId: "mutate"
    }
  ];
}

function buildNavigationBadges(input: {
  setupProgress: SetupProgressReport;
  failures: ControlPlaneFailure[];
  screenshots: ControlPlaneScreenshot[];
  riskReport?: RiskRegisterReport;
  providers: Array<{ costPolicy?: { blockedReasons?: string[] }; missingEnv?: string[] }>;
  testCreationPlan?: TestCreationPlan;
  evidencePacket?: EvidencePacket;
  handoffPacket?: HandoffPacket;
  hiveExport?: HiveExportBundle;
  hiveGuardedRepairPreview?: HiveGuardedRepairPreview;
  hiveRepairRequestEnvelope?: HiveRepairRequestEnvelope;
  hiveTrustedRepairConsumerSummary?: HiveTrustedRepairConsumerSummary;
  hiveTrustedRepairWorkflowDryRun?: HiveTrustedRepairWorkflowDryRun;
  hiveModeComparison?: HiveModeComparison;
  agentPacket?: AgentPacket;
  handoffAgentPacket?: AgentPacket;
  providerAgentPacket?: AgentPacket;
  schemaCatalog?: SchemaCatalogReport;
  artifacts: Array<{ path: string }>;
}): ControlPlaneNavigationBadges {
  const baselines = input.screenshots.filter((shot) => ["created", "missing_baseline", "failed"].includes(shot.status)).length;
  const risks = Number(input.riskReport?.summary?.total ?? 0);
  const setup = Number(input.setupProgress.blockedSteps ?? 0) + Number(input.setupProgress.reviewSteps ?? 0);
  const providerBlocks = input.providers.filter((provider) => (provider.costPolicy?.blockedReasons?.length ?? 0) > 0 || (provider.missingEnv?.length ?? 0) > 0).length;
  const failures = input.failures.length;
  const testCreation = Number(input.testCreationPlan?.summary.high ?? 0) + Number(input.testCreationPlan?.summary.medium ?? 0);
  const schemaCatalogFailures = input.schemaCatalog?.status === "failed" ? Math.max(1, Number(input.schemaCatalog.summary.failed ?? 0)) : 0;
  const missingAgentForwardPackets = [
    input.evidencePacket,
    input.handoffPacket,
    input.hiveExport,
    input.hiveGuardedRepairPreview,
    input.hiveRepairRequestEnvelope,
    input.hiveTrustedRepairConsumerSummary,
    input.hiveTrustedRepairWorkflowDryRun,
    input.hiveModeComparison,
    input.agentPacket,
    input.handoffAgentPacket,
    input.providerAgentPacket
  ].filter((artifact) => !artifact).length;
  return {
    start: Math.min(setup + failures + baselines + testCreation + missingAgentForwardPackets + schemaCatalogFailures, 99),
    run: 0,
    review: Math.min(failures + baselines + testCreation + missingAgentForwardPackets, 99),
    configure: Math.min(setup + risks + providerBlocks + schemaCatalogFailures, 99),
    expert: input.artifacts.length + schemaCatalogFailures,
    failures,
    baselines,
    risks,
    setup,
    providerBlocks
  };
}

function buildRunProfiles(runbook: ControlPlaneRunbook): ControlPlaneRunProfile[] {
  const definitions: Array<Omit<ControlPlaneRunProfile, "enabled" | "blockedReasons" | "expectedArtifacts" | "requiredSecrets" | "safety">> = [
    {
      id: "pr-acceptance",
      label: "PR acceptance",
      description: "Check readiness, produce a PR plan, run deterministic CI contracts, then refresh triage and the markdown report.",
      commandIds: ["doctor", "plan-pr", "run-ci", "baselines", "readiness", "triage-report"]
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
      commandIds: ["doctor", "plan-pr", "mutate", "readiness", "triage-report"]
    },
    {
      id: "canary-health",
      label: "Canary health plan",
      description: "Preview cheap scheduled PR-safe canary coverage without starting protected environments or requiring secrets.",
      commandIds: ["doctor", "plan-canary", "readiness"]
    },
    {
      id: "full-safe-plan",
      label: "Full PR-safe plan",
      description: "Preview broad PR-safe coverage while keeping protected and other unsafe targets excluded unless a trusted operator opts in.",
      commandIds: ["doctor", "plan-full-safe", "readiness"]
    },
    {
      id: "coverage-improvement",
      label: "Coverage improvement",
      description: "Refresh deterministic coverage evidence and generate guarded config recommendations that can be previewed or applied from the Coverage page.",
      commandIds: ["coverage", "improve-coverage", "test-creation-plan"]
    },
    {
      id: "agent-handoff-review",
      label: "Evidence to agent handoff",
      description:
        "Regenerate the sanitized Evidence Packet, Visual Hive verdict, dry-run Hive handoff, Hive-native export, guarded repair preview, trusted repair request envelope, trusted repair consumer summary, mode comparison, advisory test plan, and bounded Agent Packet.",
      commandIds: [
        "evidence",
        "verdict",
        "handoff",
        "hive-export",
        "hive-guarded-repair-preview",
        "hive-repair-request-envelope",
        "hive-trusted-repair-consumer-summary",
        "hive-trusted-repair-workflow-dry-run",
        "hive-compare-modes",
        "test-creation-plan",
        "agent-packet",
        "handoff-agent-packet",
        "provider-agent-packet"
      ]
    },
    {
      id: "operational-pipeline",
      label: "Operational pipeline",
      description: "Run the full PR-safe Visual Hive pipeline and refresh repo intelligence, deterministic evidence, verdict, handoff, agent, tool, and context artifacts.",
      commandIds: ["pipeline"]
    },
    {
      id: "security-audit",
      label: "Security posture audit",
      description: "Validate readiness, audit workflow/config/provider/LLM security posture, then refresh the markdown report.",
      commandIds: ["doctor", "security", "readiness", "triage-report"]
    },
    {
      id: "cost-audit",
      label: "Cost policy audit",
      description: "Validate readiness, audit local/external cost posture and provider budget policy, then refresh the markdown report.",
      commandIds: ["doctor", "costs", "readiness", "triage-report"]
    },
    {
      id: "schema-catalog-health",
      label: "Schema/catalog health",
      description: "Verify checked-in JSON Schemas, MCP resource metadata, Tool Registry cards, Agent Packets, Context Ledger, and artifact evidence-resource enums stay aligned.",
      commandIds: ["schemas-verify"]
    },
    {
      id: "provider-governance",
      label: "Provider governance review",
      description: "Refresh no-network provider readiness, setup-plan, handoff, provider-specialist Agent Packet, cost, and readiness evidence before considering any trusted provider-backed lane.",
      commandIds: ["providers", "provider-plan", "provider-handoff", "provider-agent-packet", "costs", "readiness"]
    },
    {
      id: "portfolio-refresh",
      label: "Portfolio refresh",
      description: "Refresh readiness, security, cost, and local connection portfolio evidence for multi-repo governance review.",
      commandIds: ["security", "costs", "readiness", "connections-portfolio"]
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
  const configRoot = toRepoRelativePath(resolved.repoRoot, resolved.configRoot);
  const configFlag = `--config ${quoteForShell(configPath)}`;
  const schemaCatalogPath = toRepoRelativePath(resolved.repoRoot, path.join(resolved.configRoot, ".visual-hive", "schema-catalog.json"));
  const providerId = providerReviewId(config);
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
      id: "recommend",
      label: "Recommend setup",
      lane: "local",
      command: `visual-hive recommend --repo ${quoteForShell(configRoot)}`,
      cwd: resolved.repoRoot,
      safety: "pr_safe",
      description: "Inspect the repository and write setup recommendations, starter workflow guidance, provider posture, and a setup PR plan without making external calls.",
      requiredSecrets: [],
      expectedArtifacts: [".visual-hive/recommendations.json", ".visual-hive/setup-pr-plan.json"]
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
      id: "plan-canary",
      label: "Plan scheduled canaries",
      lane: "pull_request",
      command: `visual-hive plan ${configFlag} --mode canary --output .visual-hive/plan.canary.json`,
      cwd: resolved.repoRoot,
      safety: "pr_safe",
      description: "Select cheap or medium scheduled PR-safe contracts for public demo canaries and other low-cost health checks.",
      requiredSecrets: [],
      expectedArtifacts: [".visual-hive/plan.canary.json"]
    },
    {
      id: "plan-full-safe",
      label: "Plan full PR-safe coverage",
      lane: "local",
      command: `visual-hive plan ${configFlag} --mode full --output .visual-hive/plan.full.json`,
      cwd: resolved.repoRoot,
      safety: "pr_safe",
      description: "Select broad PR-safe coverage without including protected or other non-PR-safe targets. Use --allow-unsafe-targets only from a trusted context.",
      requiredSecrets: [],
      expectedArtifacts: [".visual-hive/plan.full.json"]
    },
    {
      id: "run-ci",
      label: "Run deterministic CI checks",
      lane: "ci",
      command: `visual-hive run ${configFlag} --ci`,
      cwd: resolved.repoRoot,
      safety: "pr_safe",
      description: "Run generated Playwright contracts and feed the Visual Hive verdict layer. CI mode fails on missing baselines unless snapshot updates are explicitly enabled.",
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
      id: "coverage",
      label: "Analyze visual coverage",
      lane: "local",
      command: `visual-hive coverage ${configFlag}`,
      cwd: resolved.repoRoot,
      safety: "pr_safe",
      description: "Write .visual-hive/coverage.json from the current config, plan, changed-file selection, routes, viewports, targets, and contract coverage gaps.",
      requiredSecrets: [],
      expectedArtifacts: [".visual-hive/coverage.json"]
    },
    {
      id: "improve-coverage",
      label: "Generate coverage recommendations",
      lane: "local",
      command: `visual-hive improve-coverage ${configFlag}`,
      cwd: resolved.repoRoot,
      safety: "pr_safe",
      description: "Write .visual-hive/coverage-recommendations.json with deterministic missing-test and config recommendations for review before any guarded apply action.",
      requiredSecrets: [],
      expectedArtifacts: [".visual-hive/coverage-recommendations.json"]
    },
    {
      id: "test-creation-plan",
      label: "Write test creation plan",
      lane: "local",
      command: `visual-hive test-creation-plan ${configFlag}`,
      cwd: resolved.repoRoot,
      safety: "pr_safe",
      description: "Write advisory no-write test recommendations from Evidence Packet, coverage recommendations, mutation survivors, and handoff work items.",
      requiredSecrets: [],
      expectedArtifacts: [".visual-hive/test-creation-plan.json", ".visual-hive/test-creation-plan.md"]
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
      id: "schemas-verify",
      label: "Verify schema catalog",
      lane: "local",
      command: `visual-hive schemas verify --output ${quoteForShell(schemaCatalogPath)}`,
      cwd: resolved.repoRoot,
      safety: "pr_safe",
      description: "Write schema/catalog drift evidence proving JSON Schemas, MCP resources, Tool Registry metadata, Agent Packets, Context Ledger, and artifact index metadata still agree.",
      requiredSecrets: [],
      expectedArtifacts: [schemaCatalogPath]
    },
    {
      id: "providers",
      label: "Inspect provider readiness",
      lane: "local",
      command: `visual-hive providers list ${configFlag} --mock-results`,
      cwd: resolved.repoRoot,
      safety: "pr_safe",
      description: "Inspect optional provider availability, credential-name readiness, and mock adapter evidence without making external calls.",
      requiredSecrets: [],
      expectedArtifacts: [".visual-hive/provider-results.json"]
    },
    {
      id: "provider-plan",
      label: "Write provider setup plan",
      lane: "local",
      command: `visual-hive providers plan ${configFlag} --provider ${providerId}`,
      cwd: resolved.repoRoot,
      safety: "pr_safe",
      description: "Write a no-network provider setup plan that lists required environment variable names, cost-policy blockers, trusted workflow steps, and validation commands.",
      requiredSecrets: [],
      expectedArtifacts: [".visual-hive/provider-setup-plan.json"]
    },
    {
      id: "provider-handoff",
      label: "Write provider handoff manifest",
      lane: "local",
      command: `visual-hive providers handoff ${configFlag} --provider ${providerId}`,
      cwd: resolved.repoRoot,
      safety: "pr_safe",
      description: "Write a no-network manifest of exact deterministic screenshot artifacts eligible for future trusted provider upload review.",
      requiredSecrets: [],
      expectedArtifacts: [".visual-hive/provider-handoff.json"]
    },
    {
      id: "readiness",
      label: "Summarize readiness gate",
      lane: "local",
      command: `visual-hive readiness ${configFlag}`,
      cwd: resolved.repoRoot,
      safety: "pr_safe",
      description: "Combine plan, deterministic run, baselines, mutation, workflows, security, cost, provider, and LLM evidence into one beginner-friendly go/no-go artifact.",
      requiredSecrets: [],
      expectedArtifacts: [".visual-hive/readiness.json"]
    },
    {
      id: "evidence",
      label: "Write Evidence Packet",
      lane: "local",
      command: `visual-hive evidence ${configFlag}`,
      cwd: resolved.repoRoot,
      safety: "pr_safe",
      description: "Write the canonical sanitized Evidence Packet and markdown summary from current deterministic, mutation, provider, readiness, coverage, and triage artifacts.",
      requiredSecrets: [],
      expectedArtifacts: [".visual-hive/evidence-packet.json", ".visual-hive/evidence-summary.md"]
    },
    {
      id: "verdict",
      label: "Write Visual Hive verdict",
      lane: "local",
      command: `visual-hive verdict ${configFlag}`,
      cwd: resolved.repoRoot,
      safety: "pr_safe",
      description: "Aggregate normalized deterministic evidence into the Visual Hive verdict without giving LLMs, agents, or MCP tools pass/fail authority.",
      requiredSecrets: [],
      expectedArtifacts: [".visual-hive/verdict.json", ".visual-hive/verdict.md"]
    },
    {
      id: "handoff",
      label: "Write Hive handoff dry run",
      lane: "local",
      command: `visual-hive handoff ${configFlag} --dry-run`,
      cwd: resolved.repoRoot,
      safety: "pr_safe",
      description: "Write sanitized GitHub/Hive handoff artifacts with zero external calls for trusted workflow or human review.",
      requiredSecrets: [],
      expectedArtifacts: [".visual-hive/handoff.json", ".visual-hive/hive-issue.md", ".visual-hive/hive-bead-request.json", ".visual-hive/hive-handoff-result.json"]
    },
    {
      id: "agent-packet",
      label: "Write Agent Packet",
      lane: "local",
      command: `visual-hive agent-packet ${configFlag} --profile repair_agent`,
      cwd: resolved.repoRoot,
      safety: "pr_safe",
      description: "Write a bounded advisory packet for repair/test/review agents using sanitized Evidence Packet and Handoff Packet context.",
      requiredSecrets: [],
      expectedArtifacts: [".visual-hive/agent-packet.json"]
    },
    {
      id: "handoff-agent-packet",
      label: "Write handoff Agent Packet",
      lane: "local",
      command: `visual-hive agent-packet ${configFlag} --profile handoff_agent --output .visual-hive/handoff-agent-packet.json`,
      cwd: resolved.repoRoot,
      safety: "pr_safe",
      description:
        "Write a bounded no-network handoff-agent packet for reviewing Evidence, Handoff, Hive-native export, repair-chain, mode-comparison, validation, and provider evidence before trusted routing.",
      requiredSecrets: [],
      expectedArtifacts: [".visual-hive/handoff-agent-packet.json"]
    },
    {
      id: "provider-agent-packet",
      label: "Write provider specialist Agent Packet",
      lane: "local",
      command: `visual-hive agent-packet ${configFlag} --profile provider_specialist --output .visual-hive/provider-agent-packet.json`,
      cwd: resolved.repoRoot,
      safety: "pr_safe",
      description:
        "Write a bounded no-network provider-specialist packet for reviewing provider results, upload manifests, blocked reasons, and readiness without enabling upload or provider verdict authority.",
      requiredSecrets: [],
      expectedArtifacts: [".visual-hive/provider-agent-packet.json"]
    },
    {
      id: "hive-export",
      label: "Write Hive native export",
      lane: "local",
      command: `visual-hive hive export ${configFlag} --dry-run`,
      cwd: resolved.repoRoot,
      safety: "pr_safe",
      description: "Expand deterministic evidence into no-network Hive beads, knowledge facts, graph data, wiki pages, issue context, agent policy, and guarded repair work orders.",
      requiredSecrets: [],
      expectedArtifacts: [
        ".visual-hive/hive/hive-export.json",
        ".visual-hive/hive/beads.json",
        ".visual-hive/hive/knowledge-facts.json",
        ".visual-hive/hive/knowledge-graph.json",
        ".visual-hive/hive/issue-context.md",
        ".visual-hive/hive/repair-work-orders.json",
        ".visual-hive/hive/hive-agent-policy.json"
      ]
    },
    {
      id: "hive-export-advisory",
      label: "Preview Hive advisory mode",
      lane: "local",
      command: `visual-hive hive export ${configFlag} --dry-run --mode advisory`,
      cwd: resolved.repoRoot,
      safety: "pr_safe",
      description:
        "Write the safest no-network Hive export mode: issue context and agent policy only. Use this when Hive should advise or route work without creating beads or repair work orders.",
      requiredSecrets: [],
      expectedArtifacts: [".visual-hive/hive/hive-export.json", ".visual-hive/hive/issue-context.md", ".visual-hive/hive/hive-agent-policy.json"]
    },
    {
      id: "hive-export-measured",
      label: "Preview Hive measured mode",
      lane: "local",
      command: `visual-hive hive export ${configFlag} --dry-run --mode measured`,
      cwd: resolved.repoRoot,
      safety: "pr_safe",
      description:
        "Write no-network Hive beads, knowledge facts, graph data, wiki pages, and issue context so Hive can queue and understand Visual Hive evidence without repair authority.",
      requiredSecrets: [],
      expectedArtifacts: [
        ".visual-hive/hive/hive-export.json",
        ".visual-hive/hive/beads.json",
        ".visual-hive/hive/knowledge-facts.json",
        ".visual-hive/hive/knowledge-graph.json",
        ".visual-hive/hive/issue-context.md",
        ".visual-hive/hive/wiki"
      ]
    },
    {
      id: "hive-export-repair-request",
      label: "Preview Hive repair-request mode",
      lane: "local",
      command: `visual-hive hive export ${configFlag} --dry-run --mode repair_request`,
      cwd: resolved.repoRoot,
      safety: "pr_safe",
      description:
        "Write no-network Hive repair work orders with PR-only guardrails, forbidden actions, acceptance criteria, and Visual Hive rerun requirements for a trusted repair lane.",
      requiredSecrets: [],
      expectedArtifacts: [
        ".visual-hive/hive/hive-export.json",
        ".visual-hive/hive/beads.json",
        ".visual-hive/hive/repair-work-orders.json",
        ".visual-hive/hive/hive-agent-policy.json"
      ]
    },
    {
      id: "hive-guarded-repair-preview",
      label: "Preview guarded Hive repair",
      lane: "local",
      command: `visual-hive hive guarded-repair-preview ${configFlag}`,
      cwd: resolved.repoRoot,
      safety: "pr_safe",
      description:
        "Write a no-network, preview-only guarded repair gate from Hive repair work orders and agent policy. This does not execute repair or call Hive.",
      requiredSecrets: [],
      expectedArtifacts: [".visual-hive/hive/guarded-repair-preview.json", ".visual-hive/hive/guarded-repair-preview.md"]
    },
    {
      id: "hive-repair-request-envelope",
      label: "Write trusted repair request envelope",
      lane: "local",
      command: `visual-hive hive repair-request-envelope ${configFlag}`,
      cwd: resolved.repoRoot,
      safety: "pr_safe",
      description:
        "Write a no-network trusted repair request envelope from the guarded repair preview. This does not create branches, open pull requests, execute repair, or call Hive.",
      requiredSecrets: [],
      expectedArtifacts: [".visual-hive/hive/repair-request-envelope.json", ".visual-hive/hive/repair-request-envelope.md"]
    },
    {
      id: "hive-trusted-repair-consumer-summary",
      label: "Write trusted repair consumer summary",
      lane: "local",
      command: `visual-hive hive trusted-repair-consumer-summary ${configFlag}`,
      cwd: resolved.repoRoot,
      safety: "pr_safe",
      description:
        "Write a no-network dry-run consumer summary from the repair request envelope. This previews trusted workflow readiness without checkout, repair execution, branches, pull requests, issues, Hive calls, or Visual Hive reruns.",
      requiredSecrets: [],
      expectedArtifacts: [
        ".visual-hive/hive/trusted-repair-consumer-summary.json",
        ".visual-hive/hive/trusted-repair-consumer-summary.md"
      ]
    },
    {
      id: "hive-trusted-repair-workflow-dry-run",
      label: "Preview trusted repair workflow",
      lane: "local",
      command: `visual-hive hive trusted-repair-workflow-dry-run ${configFlag}`,
      cwd: resolved.repoRoot,
      safety: "pr_safe",
      description:
        "Write a no-network dry-run plan for future trusted repair workflow actions. This does not checkout code, execute repair, create branches, open pull requests, create issues, call Hive, call providers, or rerun Visual Hive.",
      requiredSecrets: [],
      expectedArtifacts: [
        ".visual-hive/hive/trusted-repair-workflow-dry-run.json",
        ".visual-hive/hive/trusted-repair-workflow-dry-run.md"
      ]
    },
    {
      id: "hive-compare-modes",
      label: "Compare Hive export modes",
      lane: "local",
      command: `visual-hive hive compare-modes ${configFlag}`,
      cwd: resolved.repoRoot,
      safety: "pr_safe",
      description:
        "Generate advisory, measured, and repair-request Hive dry-run previews into separate directories, then write a compact mode comparison for humans, agents, and the Control Plane.",
      requiredSecrets: [],
      expectedArtifacts: [
        ".visual-hive/hive/mode-comparison.json",
        ".visual-hive/hive/mode-comparison.md",
        ".visual-hive/hive/modes/advisory/hive-export.json",
        ".visual-hive/hive/modes/measured/hive-export.json",
        ".visual-hive/hive/modes/repair_request/hive-export.json"
      ]
    },
    {
      id: "pipeline",
      label: "Run operational pipeline",
      lane: "pull_request",
      command: `visual-hive pipeline ${configFlag} --mode pr --ci --skip-install --skip-build --enforce-mutation --continue-on-error`,
      cwd: resolved.repoRoot,
      safety: "pr_safe",
      description:
        "Run the complete agent-forward artifact chain from repo intelligence through deterministic evidence, mutation adequacy, verdict, handoff, Hive-native export, agent packet, tool registry, and context ledger.",
      requiredSecrets: [],
      expectedArtifacts: [
        ".visual-hive/pipeline.json",
        ".visual-hive/repo-map.json",
        ".visual-hive/report.json",
        ".visual-hive/mutation-report.json",
        ".visual-hive/testing-layers.json",
        ".visual-hive/evidence-packet.json",
        ".visual-hive/verdict.json",
        ".visual-hive/handoff.json",
        ".visual-hive/hive/hive-export.json",
        ".visual-hive/hive/guarded-repair-preview.json",
        ".visual-hive/hive/guarded-repair-preview.md",
        ".visual-hive/hive/repair-request-envelope.json",
        ".visual-hive/hive/repair-request-envelope.md",
        ".visual-hive/hive/trusted-repair-consumer-summary.json",
        ".visual-hive/hive/trusted-repair-consumer-summary.md",
        ".visual-hive/hive/trusted-repair-workflow-dry-run.json",
        ".visual-hive/hive/trusted-repair-workflow-dry-run.md",
        ".visual-hive/agent-packet.json",
        ".visual-hive/handoff-agent-packet.json",
        ".visual-hive/provider-agent-packet.json",
        ".visual-hive/tools/tool-registry.json",
        ".visual-hive/context-ledger.json"
      ]
    },
    {
      id: "connections-portfolio",
      label: "Refresh connection portfolio",
      lane: "local",
      command: `visual-hive connections list ${configFlag} --write`,
      cwd: resolved.repoRoot,
      safety: "pr_safe",
      description: "Write .visual-hive/connections-portfolio.json with local repository health, readiness, security, cost, and portfolio queues for upload or Control Plane review.",
      requiredSecrets: [],
      expectedArtifacts: [".visual-hive/connections-portfolio.json"]
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
    "Visual Hive owns the deterministic verdict; Playwright is the default local evidence runner.",
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

function providerReviewId(config?: VisualHiveConfig): string {
  if (!config) return "argos";
  const preferred = Object.entries(config.providers).find(([providerId, provider]) => providerId !== "playwright" && provider.enabled);
  if (preferred) return preferred[0];
  const configuredProject = Object.entries(config.providers).find(([providerId, provider]) => providerId !== "playwright" && Boolean(provider.projectId));
  return configuredProject?.[0] ?? "argos";
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
  const changedFiles = uniqueStrings((report?.changedFiles ?? []).map((file) => sanitizeText(file)));
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
        changedFiles,
        routes: failureRoutes(result),
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
        changedFiles,
        routes: [],
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
      changedFiles,
      routes: [],
      evidence: finding.evidence.map((item) => sanitizeText(item)),
      suggestedFiles: (finding.suggestedFiles ?? []).map((item) => sanitizeText(item)),
      suggestedNextTests: finding.suggestedNextTests.map((item) => sanitizeText(item)),
      artifacts: []
    }));
  return [...deterministic, ...mutation, ...findingOnly];
}

function failureRoutes(result: Report["results"][number]): string[] {
  return uniqueStrings([
    ...(result.screenshotAssertions ?? []).map((shot) => shot.route),
    ...(result.flowSteps ?? []).flatMap((step) => (step.route ? [step.route] : []))
  ].map((route) => sanitizeText(route)).filter(Boolean));
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

function buildOverview(
  report?: Report,
  mutationReport?: MutationReport,
  configError?: string,
  evidencePacket?: EvidencePacket,
  verdictReport?: VerdictReport,
  pipelineReport?: ControlPlanePipelineReport
): ControlPlaneOverview {
  const deterministicStatus = !report ? "missing" : report.status;
  const visualHiveVerdict = resolveVisualHiveVerdict(report, evidencePacket, verdictReport);
  const contributionSummary = resolveContributionSummary(report, evidencePacket, verdictReport);
  const failedContracts = report?.summary.failed ?? 0;
  const createdBaselines = report?.summary.createdBaselines ?? report?.summary.baselinesCreated ?? 0;
  const missingBaselines = report?.summary.missingBaselines ?? 0;
  const visualDiffs = report?.summary.visualDiffs ?? 0;
  const consoleErrors = report?.summary.consoleErrors ?? 0;
  const pageErrors = report?.summary.pageErrors ?? 0;
  const pipelineFailedSteps = pipelineReport?.steps.filter((step) => step.status === "failed").length;
  const mutationScore = mutationReport?.score;
  let healthScore = report ? (visualHiveVerdict === "passed" ? 70 : visualHiveVerdict === "blocked" ? 45 : 35) : 10;
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
    visualHiveVerdict,
    gatingContributions: contributionSummary.gating,
    advisoryContributions: contributionSummary.advisory,
    failedContributions: contributionSummary.failed,
    blockedContributions: contributionSummary.blocked,
    mutationScore,
    failedContracts,
    createdBaselines,
    missingBaselines,
    visualDiffs,
    consoleErrors,
    pageErrors,
    pipelineStatus: pipelineReport?.status,
    pipelineSteps: pipelineReport?.steps.length,
    pipelineFailedSteps,
    nextActions: nextActions(report, mutationReport, configError, visualHiveVerdict),
    explanations: [
      report ? `Latest deterministic run ${report.status}; Visual Hive verdict ${visualHiveVerdict ?? "missing"}.` : "No deterministic report found yet.",
      mutationReport ? `Mutation score is ${Math.round(mutationReport.score * 100)}%.` : "No mutation report found yet.",
      pipelineReport ? `Operational pipeline ${pipelineReport.status}; ${pipelineFailedSteps ?? 0} failed step(s).` : "No operational pipeline report found yet.",
      configError ? `Config needs attention: ${configError}` : "Config loaded successfully."
    ]
  };
}

function resolveVisualHiveVerdict(report?: Report, evidencePacket?: EvidencePacket, verdictReport?: VerdictReport): ControlPlaneOverview["visualHiveVerdict"] {
  return report?.verdictSummary?.visualHiveVerdict ?? verdictReport?.summary?.visualHiveVerdict ?? evidencePacket?.verdictSummary?.visualHiveVerdict;
}

function resolveContributionSummary(report?: Report, evidencePacket?: EvidencePacket, verdictReport?: VerdictReport): {
  gating: number;
  advisory: number;
  failed: number;
  blocked: number;
} {
  if (report?.verdictContributions?.length) {
    return {
      gating: report.verdictContributions.filter((contribution) => contribution.gating).length,
      advisory: report.verdictContributions.filter((contribution) => !contribution.gating).length,
      failed: report.verdictContributions.filter((contribution) => contribution.status === "failed").length,
      blocked: report.verdictContributions.filter((contribution) => contribution.status === "blocked").length
    };
  }
  if (verdictReport) {
    return {
      gating: verdictReport.summary.gatingContributions,
      advisory: verdictReport.summary.advisoryContributions,
      failed: verdictReport.summary.failedContributions,
      blocked: verdictReport.summary.blockedContributions
    };
  }
  if (evidencePacket?.evidenceContributions?.length) {
    return {
      gating: evidencePacket.evidenceContributions.filter((contribution) => contribution.gating).length,
      advisory: evidencePacket.evidenceContributions.filter((contribution) => !contribution.gating).length,
      failed: evidencePacket.evidenceContributions.filter((contribution) => contribution.status === "failed").length,
      blocked: evidencePacket.evidenceContributions.filter((contribution) => contribution.status === "blocked").length
    };
  }
  return { gating: 0, advisory: 0, failed: 0, blocked: 0 };
}

function resolveBlockedReasons(report?: Report, evidencePacket?: EvidencePacket, verdictReport?: VerdictReport): string[] {
  return uniqueStrings([
    ...(report?.verdictSummary?.blockedBecause ?? []),
    ...(verdictReport?.summary?.blockedBecause ?? []),
    ...(evidencePacket?.verdictSummary?.blockedBecause ?? [])
  ]);
}

function resolveFailedReasons(report?: Report, evidencePacket?: EvidencePacket, verdictReport?: VerdictReport): string[] {
  return uniqueStrings([
    ...(report?.verdictSummary?.failedBecause ?? []),
    ...(verdictReport?.summary?.failedBecause ?? []),
    ...(evidencePacket?.verdictSummary?.failedBecause ?? [])
  ]);
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

function nextActions(report?: Report, mutationReport?: MutationReport, configError?: string, visualHiveVerdict?: ControlPlaneOverview["visualHiveVerdict"]): string[] {
  if (configError) return ["Fix visual-hive.config.yaml validation errors."];
  if (!report) return ["Run visual-hive plan && visual-hive run."];
  if (visualHiveVerdict === "blocked") return ["Open Review and inspect blocked evidence.", "Fix target startup, missing baselines, protected secrets, or policy gates before rerunning."];
  if (visualHiveVerdict === "failed" || report.status === "failed") return ["Open Failure Inbox and inspect failed contracts.", "Run visual-hive triage to refresh issue and repair context."];
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
