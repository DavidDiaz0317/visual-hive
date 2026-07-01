import type { CostAuditReport } from "../costs/analyze.js";
import type { VisualHiveConfig } from "../config/schema.js";
import type { WorkflowAuditReport } from "../github/workflowAudit.js";
import type { LLMDecisionLog } from "../llm/decisions.js";
import type { RunHistoryReport } from "../history/record.js";
import type { Plan } from "../planner/types.js";
import type { BaselineList } from "../baselines/manage.js";
import type { MutationReport, Report } from "../reports/types.js";
import type { ProviderDecisionLog } from "../providers/decisions.js";
import type { ProviderHandoffManifest } from "../providers/handoff.js";
import type { ProviderSetupPlan } from "../providers/setupPlan.js";
import type { SecurityAuditReport } from "../security/audit.js";
import { sanitizeText } from "../utils/sanitize.js";

export type ReadinessStatus = "ready" | "attention" | "blocked";
export type ReadinessGateStatus = "passed" | "warning" | "blocked" | "missing";
export type ReadinessGateCategory =
  | "config"
  | "setup"
  | "planning"
  | "deterministic"
  | "baselines"
  | "mutation"
  | "workflow"
  | "security"
  | "provider"
  | "llm"
  | "cost"
  | "history";

export interface ReadinessGate {
  id: string;
  category: ReadinessGateCategory;
  status: ReadinessGateStatus;
  title: string;
  message: string;
  evidence: string[];
  artifacts: string[];
  nextActions: string[];
}

export interface ReadinessReport {
  schemaVersion: 1;
  project: string;
  generatedAt: string;
  status: ReadinessStatus;
  score: number;
  summary: {
    total: number;
    passed: number;
    warnings: number;
    blocked: number;
    missing: number;
  };
  inputs: {
    plan: boolean;
    report: boolean;
    mutationReport: boolean;
    baselines: boolean;
    workflowAudit: boolean;
    securityAudit: boolean;
    costAudit: boolean;
    runHistory: boolean;
    providerDecisions: boolean;
    providerSetupPlan: boolean;
    providerHandoff: boolean;
    llmDecisions: boolean;
  };
  gates: ReadinessGate[];
  nextActions: string[];
}

export interface AnalyzeReadinessOptions {
  plan?: Plan;
  report?: Report;
  mutationReport?: MutationReport;
  baselines?: BaselineList;
  workflowAudit?: WorkflowAuditReport;
  securityAudit?: SecurityAuditReport;
  costAudit?: CostAuditReport;
  runHistory?: RunHistoryReport;
  providerDecisions?: ProviderDecisionLog;
  providerSetupPlan?: ProviderSetupPlan;
  providerHandoff?: ProviderHandoffManifest;
  llmDecisions?: LLMDecisionLog;
  now?: Date;
}

export function analyzeReadiness(config: VisualHiveConfig, options: AnalyzeReadinessOptions = {}): ReadinessReport {
  const gates = [
    configGate(config),
    ...setupQualityGates(config),
    ...planningGates(options.plan),
    ...deterministicGates(options.report),
    ...baselineGates(options.baselines, options.report),
    ...mutationGates(config, options.mutationReport),
    ...workflowGates(options.workflowAudit),
    ...securityGates(options.securityAudit),
    ...providerGates(config, options.costAudit, options.providerDecisions, options.providerSetupPlan, options.providerHandoff),
    ...llmGates(config, options.llmDecisions),
    ...costGates(options.costAudit),
    ...historyGates(options.runHistory)
  ].map(sanitizeGate);
  const summary = summarize(gates);
  return {
    schemaVersion: 1,
    project: sanitizeText(config.project.name),
    generatedAt: (options.now ?? new Date()).toISOString(),
    status: summary.blocked > 0 ? "blocked" : summary.warnings + summary.missing > 0 ? "attention" : "ready",
    score: score(summary),
    summary,
    inputs: {
      plan: Boolean(options.plan),
      report: Boolean(options.report),
      mutationReport: Boolean(options.mutationReport),
      baselines: Boolean(options.baselines),
      workflowAudit: Boolean(options.workflowAudit),
      securityAudit: Boolean(options.securityAudit),
      costAudit: Boolean(options.costAudit),
      runHistory: Boolean(options.runHistory),
      providerDecisions: Boolean(options.providerDecisions),
      providerSetupPlan: Boolean(options.providerSetupPlan),
      providerHandoff: Boolean(options.providerHandoff),
      llmDecisions: Boolean(options.llmDecisions)
    },
    gates,
    nextActions: nextActions(gates)
  };
}

function setupQualityGates(config: VisualHiveConfig): ReadinessGate[] {
  const gates: ReadinessGate[] = [];
  const targets = Object.entries(config.targets);
  const hasRunnableLocalTarget = targets.some(([, target]) => target.kind === "command" || target.kind === "commandGroup" || target.kind === "storybook");
  const hasLocalhostUrlOnlyTarget = targets.some(([, target]) => {
    const url = "url" in target ? target.url : undefined;
    return target.kind === "url" && Boolean(url && /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])/i.test(url));
  });

  if (!hasRunnableLocalTarget && hasLocalhostUrlOnlyTarget) {
    gates.push(
      gate(
        "setup:missing-serve-command",
        "setup",
        "blocked",
        "Local target has no serve command",
        "A localhost URL target was configured without a command, commandGroup, or Storybook target that can start it.",
        targets.map(([targetId, target]) => `${targetId}:${target.kind}`),
        ["visual-hive.config.yaml"],
        ["Add a command target with build/serve commands or model the services as a commandGroup."]
      )
    );
  } else {
    gates.push(
      gate(
        "setup:target-runnable",
        "setup",
        "passed",
        "Target model is runnable or externally hosted",
        hasRunnableLocalTarget
          ? "At least one local target has an explicit runtime command model."
          : "Configured targets are externally hosted or protected rather than implicit localhost URLs.",
        targets.map(([targetId, target]) => `${targetId}:${target.kind}`),
        ["visual-hive.config.yaml"]
      )
    );
  }

  const selectors = config.contracts.flatMap((contract) => [
    ...(contract.selectors.mustExist ?? []),
    ...(contract.selectors.mustNotExist ?? []),
    ...(contract.selectors.textMustExist ?? []),
    ...(contract.selectors.textMustNotExist ?? [])
  ]);
  const meaningfulSelectors = selectors.filter((selector) => selector.trim() && selector.trim().toLowerCase() !== "body");
  if (selectors.length > 0 && meaningfulSelectors.length === 0) {
    gates.push(
      gate(
        "setup:body-only-selector",
        "setup",
        "blocked",
        "Starter selectors are too generic",
        "Every configured selector is body, so failures will not provide useful user-visible contract evidence.",
        [`selectors=${selectors.join(", ")}`],
        ["visual-hive.config.yaml"],
        ["Add project-owned data-testid selectors for page shells, critical actions, and route-level content."]
      )
    );
  }

  const screenshotCount = config.contracts.reduce((count, contract) => count + contract.screenshots.length, 0);
  if (screenshotCount === 0) {
    gates.push(
      gate(
        "setup:no-screenshots",
        "setup",
        "blocked",
        "No screenshot contracts configured",
        "Visual Hive has deterministic selector coverage, but no visual baseline evidence can be produced.",
        [`contracts=${config.contracts.length}`, "screenshots=0"],
        ["visual-hive.config.yaml"],
        ["Add at least one stable desktop screenshot to the first PR-safe contract before enabling visual CI."]
      )
    );
  } else {
    gates.push(
      gate(
        "setup:screenshots-configured",
        "setup",
        "passed",
        "Screenshot contracts are configured",
        `Configured ${screenshotCount} screenshot assertion(s) across ${config.contracts.length} contract(s).`,
        [`screenshots=${screenshotCount}`],
        ["visual-hive.config.yaml"]
      )
    );
  }

  return gates;
}

function historyGates(runHistory?: RunHistoryReport): ReadinessGate[] {
  if (!runHistory?.trend.hasPrevious) return [];
  if (runHistory.trend.direction === "regressed") {
    const statusRegressed = runHistory.trend.statusChanged?.to === "failed";
    return [
      gate(
        "history:regressed",
        "history",
        statusRegressed ? "blocked" : "warning",
        "Latest run regressed from previous history",
        statusRegressed
          ? "The latest recorded run changed from passing to failing."
          : "The latest recorded run is worse than the previous run in one or more visual QA signals.",
        [
          `direction=${runHistory.trend.direction}`,
          runHistory.trend.statusChanged
            ? `status=${runHistory.trend.statusChanged.from ?? "unknown"}->${runHistory.trend.statusChanged.to ?? "unknown"}`
            : "",
          runHistory.trend.mutationScoreDelta === undefined ? "" : `mutationScoreDelta=${runHistory.trend.mutationScoreDelta}`,
          runHistory.trend.failedContractsDelta === undefined ? "" : `failedContractsDelta=${runHistory.trend.failedContractsDelta}`,
          runHistory.trend.visualDiffsDelta === undefined ? "" : `visualDiffsDelta=${runHistory.trend.visualDiffsDelta}`
        ].filter(Boolean),
        [".visual-hive/history.json"],
        ["Compare latest and previous archived reports before accepting the current run."]
      )
    ];
  }
  return [
    gate(
      "history:stable-or-improved",
      "history",
      "passed",
      "Run history is stable or improved",
      `Latest trend is ${runHistory.trend.direction}.`,
      runHistory.trend.reasons.slice(0, 5),
      [".visual-hive/history.json"]
    )
  ];
}

function configGate(config: VisualHiveConfig): ReadinessGate {
  return gate("config:loaded", "config", "passed", "Config is valid", `Loaded ${config.contracts.length} contract(s) and ${Object.keys(config.targets).length} target(s).`, [
    `project=${config.project.name}`,
    `type=${config.project.type}`,
    `defaultBranch=${config.project.defaultBranch}`
  ]);
}

function planningGates(plan?: Plan): ReadinessGate[] {
  if (!plan) {
    return [
      gate("planning:missing", "planning", "missing", "No execution plan found", "Run Visual Hive plan before judging PR readiness.", [], [
        ".visual-hive/plan.json"
      ], ["Run `visual-hive plan --mode pr` and review selected/excluded contracts."])
    ];
  }
  if (plan.items.length === 0) {
    return [
      gate(
        "planning:no-contracts",
        "planning",
        plan.effectiveChangedFiles.length > 0 ? "blocked" : "warning",
        "No contracts selected",
        plan.effectiveChangedFiles.length > 0
          ? "Changed files were present, but no deterministic contracts were selected."
          : "The latest plan selected no contracts.",
        [`changedFiles=${plan.effectiveChangedFiles.length}`, `excluded=${plan.excluded.length}`],
        [".visual-hive/plan.json"],
        ["Review changed-file rules, runOn settings, target safety, and explicit include/exclude filters."]
      )
    ];
  }
  return [
    gate(
      "planning:selected",
      "planning",
      "passed",
      "Plan selected deterministic work",
      `Selected ${plan.items.length} contract(s) across ${plan.targets.length} target(s).`,
      [`mode=${plan.mode}`, `mutation=${plan.mutation.enabled ? "enabled" : "disabled"}`],
      [".visual-hive/plan.json"]
    )
  ];
}

function deterministicGates(report?: Report): ReadinessGate[] {
  if (!report) {
    return [
      gate("deterministic:missing", "deterministic", "missing", "No deterministic report found", "Visual Hive has not produced report.json yet.", [], [
        ".visual-hive/report.json"
      ], ["Run `visual-hive run` locally once to create baselines, then rerun with `--ci`."])
    ];
  }
  const failed = report.summary.failed;
  const status = report.status === "passed" && failed === 0 ? "passed" : "blocked";
  return [
    gate(
      "deterministic:status",
      "deterministic",
      status,
      status === "passed" ? "Deterministic contracts passed" : "Deterministic contracts failed",
      `Report status is ${report.status}; failed contracts: ${failed}.`,
      [`selectedContracts=${report.selectedContracts.length}`, `generatedSpecPath=${report.generatedSpecPath}`],
      [".visual-hive/report.json", report.generatedSpecPath, ...report.artifacts.slice(0, 5)],
      status === "passed" ? [] : report.reproductionCommands.slice(0, 3)
    )
  ];
}

function baselineGates(baselines?: BaselineList, report?: Report): ReadinessGate[] {
  const summary = baselines?.summary;
  if (!summary && !report) {
    return [gate("baselines:missing", "baselines", "missing", "No baseline evidence found", "Run deterministic contracts and write the baseline review queue.", [], [
      ".visual-hive/baselines.json"
    ], ["Run `visual-hive run` and `visual-hive baselines list --write`."])];
  }
  const missing = summary?.missingBaseline ?? report?.summary.missingBaselines ?? 0;
  const failed = summary?.failed ?? report?.summary.screenshotsFailed ?? 0;
  const pending = summary?.pendingReview ?? 0;
  const created = summary?.created ?? report?.summary.createdBaselines ?? report?.summary.baselinesCreated ?? 0;
  if (missing > 0) {
    return [
      gate("baselines:missing-baseline", "baselines", "blocked", "Missing baselines block CI readiness", `${missing} screenshot baseline(s) are missing.`, [
        `missingBaseline=${missing}`
      ], [".visual-hive/baselines.json", ".visual-hive/report.json"], ["Create or approve baselines locally before enforcing CI."])
    ];
  }
  if (failed > 0) {
    return [
      gate("baselines:visual-diffs", "baselines", "blocked", "Visual diffs need review", `${failed} screenshot assertion(s) failed.`, [`failed=${failed}`], [
        ".visual-hive/baselines.json",
        ".visual-hive/report.json"
      ], ["Inspect actual/baseline/diff artifacts and reject or approve intentionally changed baselines."])
    ];
  }
  if (pending > 0 || created > 0) {
    return [
      gate("baselines:pending-review", "baselines", "warning", "Baselines need human review", `${pending || created} baseline item(s) need review before strict CI adoption.`, [
        `pendingReview=${pending}`,
        `created=${created}`
      ], [".visual-hive/baselines.json"], ["Review baseline artifacts and approve or reject each intentional change."])
    ];
  }
  return [
    gate("baselines:clean", "baselines", "passed", "Baseline queue is clean", "No missing baselines, failed diffs, or pending review items were found.", [
      `total=${summary?.total ?? report?.summary.screenshotsPassed ?? 0}`
    ], [".visual-hive/baselines.json", ".visual-hive/report.json"])
  ];
}

function mutationGates(config: VisualHiveConfig, mutationReport?: MutationReport): ReadinessGate[] {
  if (!config.mutation.enabled) {
    return [gate("mutation:disabled", "mutation", "passed", "Mutation adequacy is disabled", "This repository does not require mutation adequacy for readiness.", [])];
  }
  if (!mutationReport) {
    return [
      gate("mutation:missing", "mutation", "warning", "Mutation adequacy has not run", "Mutation testing is enabled, but mutation-report.json is missing.", [], [
        ".visual-hive/mutation-report.json"
      ], ["Run `visual-hive mutate` in a local or scheduled lane."])
    ];
  }
  const survivors = mutationReport.results.filter((result) => result.status === "survived").length;
  const status = mutationReport.score < mutationReport.minScore ? "blocked" : survivors > 0 ? "warning" : "passed";
  return [
    gate(
      "mutation:score",
      "mutation",
      status,
      status === "passed" ? "Mutation score meets policy" : "Mutation adequacy needs attention",
      `Score ${Math.round(mutationReport.score * 100)}% with ${survivors} survived mutation(s).`,
      [`killed=${mutationReport.killed}`, `total=${mutationReport.total}`, `minScore=${mutationReport.minScore}`],
      [".visual-hive/mutation-report.json"],
      status === "passed" ? [] : ["Add or strengthen deterministic contracts for survived mutation operators."]
    )
  ];
}

function workflowGates(workflowAudit?: WorkflowAuditReport): ReadinessGate[] {
  if (!workflowAudit) {
    return [
      gate("workflow:missing", "workflow", "missing", "Workflow safety audit is missing", "GitHub workflow safety has not been audited.", [], [
        ".visual-hive/workflows.json"
      ], ["Run `visual-hive workflows` before making Visual Hive checks required."])
    ];
  }
  const criticalHigh = workflowAudit.summary.criticalFindings + workflowAudit.summary.highFindings;
  const hidden = workflowAudit.summary.workflowsMissingHiddenArtifactUpload;
  const baselineFindings = workflowAudit.findings.filter((finding) => finding.kind === "missing_baseline_review_artifact").length;
  if (criticalHigh > 0) {
    return [
      gate("workflow:unsafe", "workflow", "blocked", "Workflow safety has high-risk findings", `${criticalHigh} critical/high workflow finding(s) were found.`, [
        `critical=${workflowAudit.summary.criticalFindings}`,
        `high=${workflowAudit.summary.highFindings}`
      ], [".visual-hive/workflows.json"], ["Fix PR permissions, secret usage, issue creation, and pull_request_target findings before enabling CI."])
    ];
  }
  if (hidden > 0 || baselineFindings > 0) {
    return [
      gate("workflow:artifacts", "workflow", "warning", "Workflow artifact evidence is incomplete", "Workflow upload or baseline review evidence needs adjustment.", [
        `hiddenArtifactFindings=${hidden}`,
        `baselineReviewFindings=${baselineFindings}`
      ], [".visual-hive/workflows.json"], ["Upload .visual-hive with include-hidden-files: true and write .visual-hive/baselines.json before upload."])
    ];
  }
  return [
    gate("workflow:safe", "workflow", "passed", "Workflow safety audit passed", "No critical/high workflow safety findings were found.", [
      `workflows=${workflowAudit.summary.workflowCount}`,
      `pullRequestTarget=${workflowAudit.summary.workflowsUsingPullRequestTarget}`
    ], [".visual-hive/workflows.json"])
  ];
}

function securityGates(securityAudit?: SecurityAuditReport): ReadinessGate[] {
  if (!securityAudit) {
    return [
      gate("security:missing", "security", "missing", "Security audit is missing", "Visual Hive security posture has not been summarized.", [], [
        ".visual-hive/security.json"
      ], ["Run `visual-hive security` to verify workflow, protected target, provider, and LLM safety posture."])
    ];
  }
  const criticalHigh = securityAudit.summary.critical + securityAudit.summary.high;
  const status = criticalHigh > 0 ? "blocked" : securityAudit.summary.medium + securityAudit.summary.low > 0 ? "warning" : "passed";
  return [
    gate(
      "security:posture",
      "security",
      status,
      status === "passed" ? "Security posture is clean" : "Security posture needs review",
      `Security score ${securityAudit.summary.score}/100 with ${criticalHigh} critical/high finding(s).`,
      [`findings=${securityAudit.summary.totalFindings}`, `trustedOnly=${securityAudit.summary.trustedOnly}`],
      [".visual-hive/security.json"],
      status === "passed" ? [] : securityAudit.recommendations.slice(0, 3)
    )
  ];
}

function providerGates(
  config: VisualHiveConfig,
  costAudit?: CostAuditReport,
  providerDecisions?: ProviderDecisionLog,
  providerSetupPlan?: ProviderSetupPlan,
  providerHandoff?: ProviderHandoffManifest
): ReadinessGate[] {
  const externalEnabled = Object.entries(config.providers).filter(
    ([providerId, provider]) => providerId !== "playwright" && provider.enabled && provider.mode === "external"
  );
  const decisions = providerDecisions?.decisions ?? [];
  const decisionByProvider = new Map(decisions.map((decision) => [decision.providerId, decision]));
  const setupPlanMatchesEnabledProvider = providerSetupPlan
    ? externalEnabled.some(([providerId]) => providerId === providerSetupPlan.providerId)
    : false;
  const handoffMatchesEnabledProvider = providerHandoff
    ? externalEnabled.some(([providerId]) => providerId === providerHandoff.providerId)
    : false;
  const conflictingDecisions = externalEnabled
    .map(([providerId]) => decisionByProvider.get(providerId))
    .filter((decision) => decision?.decision === "skip" || decision?.decision === "review_later");

  if (conflictingDecisions.length) {
    return [
      gate(
        "provider:decision-conflict",
        "provider",
        "warning",
        "Provider config conflicts with governance decision",
        "A provider is enabled in external mode even though the local governance decision is skip or review later.",
        conflictingDecisions.map((decision) => `${decision!.providerId}=${decision!.decision}`),
        [".visual-hive/provider-decisions.json", ".visual-hive/costs.json"],
        ["Align provider config with recorded provider decisions before enabling external uploads in trusted lanes."]
      )
    ];
  }
  if (!externalEnabled.length) {
    if (providerSetupPlan) {
      return [
        gate(
          "provider:setup-plan-recorded",
          "provider",
          "passed",
          "Provider setup plan is recorded",
          "A no-network provider setup plan exists for optional future provider review.",
          [
            `provider=${providerSetupPlan.providerId}`,
            `recommendation=${providerSetupPlan.recommendation}`,
            `externalCallsMade=${providerSetupPlan.externalCallsMade}`
          ],
          [".visual-hive/provider-setup-plan.json"]
        )
      ];
    }
    if (providerHandoff) {
      return [
        gate(
          "provider:handoff-recorded",
          "provider",
          "passed",
          "Provider handoff manifest is recorded",
          "A no-network provider handoff manifest exists for optional future provider review.",
          [
            `provider=${providerHandoff.providerId}`,
            `status=${providerHandoff.status}`,
            `externalCallsMade=${providerHandoff.externalCallsMade}`,
            `eligibleArtifacts=${providerHandoff.summary.eligibleArtifacts}`
          ],
          [".visual-hive/provider-handoff.json"]
        )
      ];
    }
    if (decisions.length) {
      return [
        gate(
          "provider:decisions-recorded",
          "provider",
          "passed",
          "Provider governance decisions are recorded",
          "Optional providers remain governed by local decisions; no external provider is required for the default lane.",
          decisions.map((decision) => `${decision.providerId}=${decision.decision}; externalCallsMade=${decision.externalCallsMade}`),
          [".visual-hive/provider-decisions.json"]
        )
      ];
    }
    return [gate("provider:local-only", "provider", "passed", "No external provider is required", "Default Playwright/local artifact mode remains usable without paid services.", [])];
  }
  const missing = costAudit?.providers.filter((provider) => provider.enabled && provider.mode === "external" && provider.missingEnv.length > 0) ?? [];
  const approved = externalEnabled.filter(([providerId]) => decisionByProvider.get(providerId)?.decision === "approve_trusted_setup");
  const setupEvidence = providerSetupPlan
    ? [
        `setupPlan=${providerSetupPlan.providerId}`,
        `recommendation=${providerSetupPlan.recommendation}`,
        `authorizationRequired=${providerSetupPlan.authorizationRequired}`,
        `externalCallsMade=${providerSetupPlan.externalCallsMade}`
      ]
    : ["setupPlan=missing"];
  const setupPlanWarning =
    !setupPlanMatchesEnabledProvider ||
    providerSetupPlan?.recommendation === "blocked" ||
    providerSetupPlan?.readiness.missingEnv.length;
  const handoffEvidence = providerHandoff
    ? [
        `handoff=${providerHandoff.providerId}`,
        `status=${providerHandoff.status}`,
        `deterministicStatus=${providerHandoff.deterministicStatus}`,
        `eligibleArtifacts=${providerHandoff.summary.eligibleArtifacts}`,
        `externalCallsMade=${providerHandoff.externalCallsMade}`
      ]
    : ["handoff=missing"];
  const handoffWarning = !handoffMatchesEnabledProvider || providerHandoff?.status === "blocked" || providerHandoff?.externalCallsMade !== 0;
  return [
    gate(
      "provider:external-enabled",
      "provider",
      missing.length || setupPlanWarning || handoffWarning ? "warning" : "passed",
      "External provider requires trusted setup review",
      `${externalEnabled.length} external provider(s) are enabled.`,
      [
        ...externalEnabled.map(([providerId]) => `provider=${providerId}`),
        ...approved.map(([providerId]) => `approvedForTrustedSetup=${providerId}`),
        ...setupEvidence,
        ...handoffEvidence
      ],
      [".visual-hive/costs.json", ".visual-hive/provider-decisions.json", ".visual-hive/provider-setup-plan.json", ".visual-hive/provider-handoff.json"],
      setupPlanMatchesEnabledProvider && handoffMatchesEnabledProvider
        ? ["Confirm credentials, budget policy, handoff artifact eligibility, and trusted workflow boundaries before external upload."]
        : [
            setupPlanMatchesEnabledProvider
              ? "Run `visual-hive providers handoff --provider <id>` after deterministic report generation."
              : "Write `visual-hive providers plan --provider <id>` for the enabled provider before external upload."
          ]
    )
  ];
}

function llmGates(config: VisualHiveConfig, llmDecisions?: LLMDecisionLog): ReadinessGate[] {
  const latestDecision = llmDecisions?.decisions[0];
  const externalConfigured = config.ai.enabled && config.ai.provider !== "none";
  if (latestDecision && externalConfigured && (latestDecision.decision === "keep_disabled" || latestDecision.decision === "review_later")) {
    return [
      gate(
        "llm:decision-conflict",
        "llm",
        "warning",
        "LLM config conflicts with governance decision",
        "A non-none LLM provider is configured while the latest local decision keeps LLM use disabled or deferred.",
        [
          `decision=${latestDecision.decision}`,
          `provider=${config.ai.provider}`,
          `externalCallsMade=${latestDecision.externalCallsMade}`
        ],
        [".visual-hive/llm-decisions.json", ".visual-hive/llm-usage.json"],
        ["Align ai.enabled/provider settings with the recorded LLM decision before enabling trusted model-assisted workflows."]
      )
    ];
  }
  if (latestDecision && (!config.ai.enabled || config.ai.provider === "none")) {
    return [
      gate(
        "llm:decisions-recorded",
        "llm",
        "passed",
        "LLM governance decisions are recorded",
        "LLM use remains governed by local decisions; no model call is required for the default lane.",
        [`decision=${latestDecision.decision}`, `source=${latestDecision.source}`, `externalCallsMade=${latestDecision.externalCallsMade}`],
        [".visual-hive/llm-decisions.json"]
      )
    ];
  }
  if (!config.ai.enabled || config.ai.provider === "none") {
    return [gate("llm:disabled", "llm", "passed", "LLM calls are disabled by default", "Prompts and offline heuristics may be generated, but no model call is required.", [])];
  }
  return [
    gate("llm:enabled", "llm", "warning", "LLM usage requires governance", "A non-none LLM provider is configured; output must remain advisory.", [
      `provider=${config.ai.provider}`,
      `neverSoleOracle=${config.ai.neverSoleOracle}`,
      latestDecision ? `decision=${latestDecision.decision}` : "decision=missing"
    ], [".visual-hive/llm-usage.json"], ["Run LLM calls only from trusted workflows and keep deterministic contracts as the pass/fail oracle."])
  ];
}

function costGates(costAudit?: CostAuditReport): ReadinessGate[] {
  if (!costAudit) {
    return [
      gate("cost:missing", "cost", "missing", "Cost audit is missing", "Visual Hive has not summarized local/external provider cost policy.", [], [
        ".visual-hive/costs.json"
      ], ["Run `visual-hive costs` before enabling external providers or expensive scheduled lanes."])
    ];
  }
  const status = costAudit.summary.budgetStatus === "blocked" ? "warning" : costAudit.risks.some((risk) => risk.severity === "high") ? "warning" : "passed";
  return [
    gate(
      "cost:policy",
      "cost",
      status,
      status === "passed" ? "Cost policy is within budget" : "Cost policy needs review",
      `Budget status is ${costAudit.summary.budgetStatus}; planned external screenshots: ${costAudit.summary.estimatedExternalScreenshots}.`,
      [`enabledExternalProviders=${costAudit.summary.enabledExternalProviders}`, `policyBlockedProviders=${costAudit.summary.policyBlockedProviders}`],
      [".visual-hive/costs.json"],
      status === "passed" ? [] : costAudit.recommendations.slice(0, 3)
    )
  ];
}

function gate(
  id: string,
  category: ReadinessGateCategory,
  status: ReadinessGateStatus,
  title: string,
  message: string,
  evidence: string[] = [],
  artifacts: string[] = [],
  nextActions: string[] = []
): ReadinessGate {
  return { id, category, status, title, message, evidence, artifacts, nextActions };
}

function summarize(gates: ReadinessGate[]): ReadinessReport["summary"] {
  return {
    total: gates.length,
    passed: gates.filter((gate) => gate.status === "passed").length,
    warnings: gates.filter((gate) => gate.status === "warning").length,
    blocked: gates.filter((gate) => gate.status === "blocked").length,
    missing: gates.filter((gate) => gate.status === "missing").length
  };
}

function score(summary: ReadinessReport["summary"]): number {
  return Math.max(0, Math.min(100, 100 - summary.blocked * 25 - summary.warnings * 8 - summary.missing * 5));
}

function nextActions(gates: ReadinessGate[]): string[] {
  const actions = gates
    .filter((gate) => gate.status !== "passed")
    .flatMap((gate) => gate.nextActions.length ? gate.nextActions : [`Review ${gate.title}.`]);
  return [...new Set(actions)].slice(0, 8).map(sanitizeText);
}

function sanitizeGate(gate: ReadinessGate): ReadinessGate {
  return {
    ...gate,
    id: sanitizeText(gate.id),
    title: sanitizeText(gate.title),
    message: sanitizeText(gate.message),
    evidence: gate.evidence.map(sanitizeText),
    artifacts: gate.artifacts.map(sanitizeText),
    nextActions: gate.nextActions.map(sanitizeText)
  };
}
