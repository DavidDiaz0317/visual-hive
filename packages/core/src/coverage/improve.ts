import { parse, stringify } from "yaml";
import type { MutationOperator, VisualHiveConfig } from "../config/schema.js";
import { VisualHiveConfigSchema } from "../config/schema.js";
import { validateReferences } from "../config/load.js";
import type { MutationReport } from "../reports/types.js";
import { getEvidenceResourceById } from "../tools/evidenceResources.js";
import { sanitizeText } from "../utils/sanitize.js";
import type { CoverageGap, CoverageReport } from "./analyze.js";
import type { FlowAuditEntry, FlowAuditReport } from "../flows/audit.js";
import type { BaselineApprovalLog, BaselineList, BaselineRejectionLog } from "../baselines/manage.js";
import type { RunHistoryReport } from "../history/record.js";

export interface CoverageImprovementReport {
  schemaVersion: 1;
  project: string;
  generatedAt: string;
  outputResource?: CoverageImprovementOutputResource;
  summary: CoverageImprovementSummary;
  maintenanceFindings: VisualTestMaintenanceFinding[];
  recommendations: CoverageImprovementRecommendation[];
}

export interface CoverageImprovementOutputResource {
  artifactPath: string;
  evidenceResourceId: string;
  evidenceResourceUri: string;
  evidenceResourceTitle: string;
  evidenceResourceDescription: string;
  evidenceReadToolName?: string;
}

export interface CoverageImprovementSummary {
  total: number;
  high: number;
  medium: number;
  low: number;
  fromCoverageGaps: number;
  fromMutationSurvivors: number;
  fromFlowGaps: number;
  fromMaintenanceFindings: number;
}

export type CoverageImprovementKind =
  | "add_contract"
  | "add_screenshot"
  | "add_selector_assertion"
  | "add_flow_steps"
  | "add_changed_file_rule"
  | "map_mutation_operator"
  | "maintain_visual_test";

export type VisualTestMaintenanceKind =
  | "stale_baseline"
  | "baseline_churn"
  | "mutation_survivor"
  | "screenshot_without_assertion"
  | "generic_selector"
  | "duplicate_screenshot"
  | "overbroad_full_page"
  | "missing_mobile_viewport"
  | "weak_threshold";

export type VisualTestMaintenanceAction = "remove" | "fix" | "expand" | "shrink" | "split" | "add_assertion";

export interface VisualTestMaintenanceFinding {
  id: string;
  kind: VisualTestMaintenanceKind;
  severity: "low" | "medium" | "high";
  contractId: string;
  targetId: string;
  route?: string;
  viewport?: string;
  screenshotName?: string;
  message: string;
  evidence: string[];
  recommendedAction: VisualTestMaintenanceAction;
  hiveOwner: "quality" | "ci-maintainer";
  validationCommand: string;
}

export interface CoverageImprovementRecommendation {
  id: string;
  kind: CoverageImprovementKind;
  severity: "low" | "medium" | "high";
  title: string;
  rationale: string[];
  targetId?: string;
  contractId?: string;
  route?: string;
  viewport?: string;
  changedFile?: string;
  mutationOperator?: string;
  maintenanceFindingId?: string;
  lane?: "pull_request" | "scheduled" | "protected" | "manual";
  trustedOnly?: boolean;
  suggestedConfigYaml?: string;
  suggestedTests: string[];
}

export interface CoverageImprovementApplyResult {
  recommendationId: string;
  title: string;
  applied: boolean;
  configText: string;
  diff: string;
}

export interface BuildCoverageImprovementOptions {
  now?: Date;
  maxRecommendations?: number;
  flowAudit?: FlowAuditReport;
  baselineList?: BaselineList;
  baselineApprovals?: BaselineApprovalLog;
  baselineRejections?: BaselineRejectionLog;
  runHistory?: RunHistoryReport;
}

export function buildCoverageImprovementReport(
  config: VisualHiveConfig,
  coverage: CoverageReport,
  mutationReport?: MutationReport,
  options: BuildCoverageImprovementOptions = {}
): CoverageImprovementReport {
  const maintenanceFindings = buildVisualTestMaintenanceFindings(config, coverage, mutationReport, options);
  const recommendations = [
    ...coverage.uncoveredAreas.flatMap((gap) => recommendationForGap(config, gap)),
    ...recommendationsForMutationSurvivors(config, mutationReport),
    ...recommendationsForFlowGaps(config, options.flowAudit),
    ...recommendationsForMaintenanceFindings(config, maintenanceFindings)
  ];
  const deduped = dedupeRecommendations(recommendations).slice(0, options.maxRecommendations ?? 30);
  return {
    schemaVersion: 1,
    project: config.project.name,
    generatedAt: (options.now ?? new Date()).toISOString(),
    outputResource: catalogedOutputResource("coverage-recommendations", ".visual-hive/coverage-recommendations.json"),
    summary: summarize(deduped),
    maintenanceFindings,
    recommendations: deduped
  };
}

export function applyCoverageImprovementRecommendation(
  config: VisualHiveConfig,
  report: CoverageImprovementReport,
  recommendationId: string,
  currentConfigText = stringify(config, { sortMapEntries: false }).trimEnd() + "\n"
): CoverageImprovementApplyResult {
  const recommendation = report.recommendations.find((candidate) => candidate.id === recommendationId);
  if (!recommendation) {
    throw new Error(`Unknown coverage improvement recommendation "${sanitizeText(recommendationId)}". Run "visual-hive improve-coverage" to inspect available IDs.`);
  }

  const next = cloneConfig(config);
  const applied = applyRecommendation(next, recommendation);
  const validated = VisualHiveConfigSchema.parse(next);
  validateReferences(validated);
  const configText = stringify(validated, { sortMapEntries: false }).trimEnd() + "\n";
  return {
    recommendationId: recommendation.id,
    title: recommendation.title,
    applied,
    configText,
    diff: createUnifiedDiff(currentConfigText, configText, "current visual-hive.config.yaml", "proposed visual-hive.config.yaml")
  };
}

function applyRecommendation(config: VisualHiveConfig, recommendation: CoverageImprovementRecommendation): boolean {
  switch (recommendation.kind) {
    case "add_contract":
      return applyAddContract(config, recommendation);
    case "add_screenshot":
      return applyAddScreenshot(config, recommendation);
    case "add_selector_assertion":
      return applySelectorAssertion(config, recommendation);
    case "add_flow_steps":
      return applyFlowSteps(config, recommendation);
    case "add_changed_file_rule":
      return applyChangedFileRule(config, recommendation);
    case "map_mutation_operator":
      return applyMutationMapping(config, recommendation);
    case "maintain_visual_test":
      return false;
    default:
      return false;
  }
}

function applyFlowSteps(config: VisualHiveConfig, recommendation: CoverageImprovementRecommendation): boolean {
  if (!recommendation.contractId) return false;
  const contract = config.contracts.find((candidate) => candidate.id === recommendation.contractId);
  if (!contract) return false;
  const snippet = parseSnippet<{ steps?: VisualHiveConfig["contracts"][number]["steps"] }>(recommendation);
  let changed = false;
  for (const step of snippet.steps ?? []) {
    if (!contract.steps.some((candidate) => sameFlowStep(candidate, step))) {
      contract.steps.push(step);
      changed = true;
    }
  }
  return changed;
}

function applyAddContract(config: VisualHiveConfig, recommendation: CoverageImprovementRecommendation): boolean {
  const snippet = parseSnippet<{ contracts?: VisualHiveConfig["contracts"] }>(recommendation);
  const contract = snippet.contracts?.[0];
  if (!contract || config.contracts.some((candidate) => candidate.id === contract.id)) return false;
  config.contracts.push(contract);
  return true;
}

function applyAddScreenshot(config: VisualHiveConfig, recommendation: CoverageImprovementRecommendation): boolean {
  if (!recommendation.contractId) return false;
  const contract = config.contracts.find((candidate) => candidate.id === recommendation.contractId);
  if (!contract) return false;
  const snippet = parseSnippet<{ screenshots?: VisualHiveConfig["contracts"][number]["screenshots"] }>(recommendation);
  const screenshot = snippet.screenshots?.[0];
  if (!screenshot || contract.screenshots.some((candidate) => candidate.name === screenshot.name)) return false;
  contract.screenshots.push(screenshot);
  return true;
}

function applySelectorAssertion(config: VisualHiveConfig, recommendation: CoverageImprovementRecommendation): boolean {
  if (!recommendation.contractId) return false;
  const contract = config.contracts.find((candidate) => candidate.id === recommendation.contractId);
  if (!contract) return false;
  const snippet = parseSnippet<{
    selectors?: Partial<VisualHiveConfig["contracts"][number]["selectors"]>;
    waitFor?: VisualHiveConfig["contracts"][number]["waitFor"];
    screenshots?: VisualHiveConfig["contracts"][number]["screenshots"];
  }>(recommendation);
  let changed = false;
  for (const key of ["mustExist", "mustNotExist", "textMustExist", "textMustNotExist"] as const) {
    for (const value of snippet.selectors?.[key] ?? []) {
      if (!contract.selectors[key].includes(value)) {
        contract.selectors[key].push(value);
        changed = true;
      }
    }
  }
  for (const wait of snippet.waitFor ?? []) {
    if (!contract.waitFor.some((candidate) => candidate.selector === wait.selector && candidate.state === wait.state)) {
      contract.waitFor.push(wait);
      changed = true;
    }
  }
  for (const screenshot of snippet.screenshots ?? []) {
    if (!contract.screenshots.some((candidate) => candidate.name === screenshot.name)) {
      contract.screenshots.push(screenshot);
      changed = true;
    }
  }
  return changed;
}

function applyChangedFileRule(config: VisualHiveConfig, recommendation: CoverageImprovementRecommendation): boolean {
  const snippet = parseSnippet<{ selection?: { changedFiles?: VisualHiveConfig["selection"]["changedFiles"] } }>(recommendation);
  const rule = snippet.selection?.changedFiles?.[0];
  if (!rule) return false;
  const exists = config.selection.changedFiles.some(
    (candidate) => candidate.pattern === rule.pattern && candidate.contracts.join("\0") === rule.contracts.join("\0")
  );
  if (exists) return false;
  config.selection.changedFiles.push(rule);
  return true;
}

function applyMutationMapping(config: VisualHiveConfig, recommendation: CoverageImprovementRecommendation): boolean {
  if (!recommendation.mutationOperator) return false;
  const contractId = recommendation.contractId;
  const existing = config.mutation.operators.find((operator) =>
    typeof operator === "string" ? operator === recommendation.mutationOperator : operator.id === recommendation.mutationOperator
  );
  let changed = false;
  if (!existing) {
    const operatorId = recommendation.mutationOperator as MutationOperator;
    config.mutation.operators.push(contractId ? { id: operatorId, contracts: [contractId] } : operatorId);
    changed = true;
  } else if (typeof existing === "string") {
    if (contractId) {
      const index = config.mutation.operators.findIndex((operator) => operator === recommendation.mutationOperator);
      config.mutation.operators[index] = { id: recommendation.mutationOperator as MutationOperator, contracts: [contractId] };
      changed = true;
    }
  } else if (contractId && !existing.contracts.includes(contractId)) {
    existing.contracts.push(contractId);
    changed = true;
  }
  const assertionChanged = contractId ? applySelectorAssertion(config, { ...recommendation, kind: "add_selector_assertion" }) : false;
  return changed || assertionChanged;
}

function recommendationForGap(config: VisualHiveConfig, gap: CoverageGap): CoverageImprovementRecommendation[] {
  switch (gap.kind) {
    case "target_without_contracts":
      return gap.targetId ? [targetSmokeContract(config, gap)] : [];
    case "contract_without_assertions":
      return gap.contractId ? [contractAssertions(config, gap)] : [];
    case "route_without_pr_safe_coverage":
      return gap.route ? [routePrSafeScreenshot(config, gap)] : [];
    case "viewport_without_screenshots":
      return gap.viewport ? [viewportScreenshot(config, gap)] : [];
    case "changed_file_without_rule":
      return gap.changedFile ? [changedFileRule(config, gap)] : [];
    case "contract_unselected":
      return gap.contractId ? [selectionRuleForContract(config, gap)] : [];
    default:
      return [];
  }
}

function targetSmokeContract(config: VisualHiveConfig, gap: CoverageGap): CoverageImprovementRecommendation {
  const targetId = gap.targetId ?? "target";
  const contractId = `${slug(targetId)}-smoke-visual`;
  const contract = {
    id: contractId,
    description: `Smoke visual contract for ${targetId}. Replace body with a stable project-owned selector when available.`,
    target: targetId,
    severity: gap.severity === "low" ? "medium" : gap.severity,
    runOn: { pullRequest: config.targets[targetId]?.prSafe ?? false, schedule: true },
    waitFor: [{ selector: "body", state: "attached", timeoutMs: 15000 }],
    selectors: { mustExist: ["body"] },
    screenshots: [{ name: `${slug(targetId)}-home-desktop`, route: "/", viewport: firstViewport(config, "desktop") }]
  };
  return {
    id: `add-contract:${targetId}`,
    kind: "add_contract",
    severity: gap.severity,
    title: `Add a starter contract for target "${targetId}"`,
    rationale: [gap.message, "Targets without contracts cannot produce deterministic visual evidence."],
    targetId,
    contractId,
    suggestedConfigYaml: yamlSnippet({ contracts: [contract] }),
    suggestedTests: [
      `Add a project-owned data-testid selector to the ${targetId} app shell.`,
      `Run visual-hive plan and visual-hive run to verify the new ${contractId} contract.`
    ]
  };
}

function contractAssertions(config: VisualHiveConfig, gap: CoverageGap): CoverageImprovementRecommendation {
  const contract = config.contracts.find((candidate) => candidate.id === gap.contractId);
  const route = contract?.screenshots[0]?.route ?? "/";
  const viewport = contract?.screenshots[0]?.viewport ?? firstViewport(config, "desktop");
  return {
    id: `assertions:${gap.contractId}`,
    kind: "add_selector_assertion",
    severity: gap.severity,
    title: `Add deterministic assertions to "${gap.contractId}"`,
    rationale: [gap.message, "A contract without assertions is not a useful pass/fail oracle."],
    targetId: contract?.target ?? gap.targetId,
    contractId: gap.contractId,
    route,
    viewport,
    suggestedConfigYaml: yamlSnippet({
      selectors: { mustExist: ["[data-testid='replace-with-stable-page-selector']"] },
      waitFor: [{ selector: "[data-testid='replace-with-stable-page-selector']", state: "visible", timeoutMs: 15000 }],
      screenshots: [{ name: `${slug(gap.contractId ?? "contract")}-${slug(viewport)}`, route, viewport }]
    }),
    suggestedTests: [
      "Prefer project-owned data-testid selectors over CSS layout selectors.",
      `Add at least one mustExist assertion and one screenshot to ${gap.contractId}.`
    ]
  };
}

function routePrSafeScreenshot(config: VisualHiveConfig, gap: CoverageGap): CoverageImprovementRecommendation {
  const targetId = firstPrSafeTarget(config);
  const contractId = `${slug(trimRoute(gap.route ?? "route"))}-pr-safe-visual`;
  const viewport = firstViewport(config, "desktop");
  return {
    id: `route-pr-safe:${gap.route}`,
    kind: "add_contract",
    severity: gap.severity,
    title: `Add PR-safe coverage for route "${gap.route}"`,
    rationale: [gap.message, "PR-safe route coverage catches regressions before protected scheduled lanes run."],
    targetId,
    contractId,
    route: gap.route,
    viewport,
    suggestedConfigYaml: yamlSnippet({
      contracts: [
        {
          id: contractId,
          description: `PR-safe visual coverage for ${gap.route}. Replace body with a stable route-level selector.`,
          target: targetId,
          severity: "medium",
          runOn: { pullRequest: true, schedule: true },
          waitFor: [{ selector: "body", state: "attached", timeoutMs: 15000 }],
          selectors: { mustExist: ["body"] },
          screenshots: [{ name: `${slug(trimRoute(gap.route ?? "route"))}-${slug(viewport)}`, route: gap.route, viewport }]
        }
      ]
    }),
    suggestedTests: [`Assert a route-level selector for ${gap.route}.`, `Capture ${gap.route} on ${viewport} in the PR-safe local preview target.`]
  };
}

function viewportScreenshot(config: VisualHiveConfig, gap: CoverageGap): CoverageImprovementRecommendation {
  const contract = firstContractWithScreenshots(config);
  const route = contract?.screenshots[0]?.route ?? "/";
  return {
    id: `viewport:${gap.viewport}`,
    kind: "add_screenshot",
    severity: gap.severity,
    title: `Add ${gap.viewport} screenshot coverage`,
    rationale: [gap.message, "Configured viewports should either be tested or removed from the config."],
    targetId: contract?.target,
    contractId: contract?.id,
    route,
    viewport: gap.viewport,
    suggestedConfigYaml: yamlSnippet({
      screenshots: [{ name: `${slug(contract?.id ?? "app")}-${slug(gap.viewport ?? "viewport")}`, route, viewport: gap.viewport }]
    }),
    suggestedTests: [`Add a ${gap.viewport} screenshot to a high-value layout contract.`, "Run visual-hive run locally once to create the baseline, then verify with --ci."]
  };
}

function changedFileRule(config: VisualHiveConfig, gap: CoverageGap): CoverageImprovementRecommendation {
  const contract = bestContractForChangedFile(config, gap.changedFile ?? "");
  const pattern = changedFilePattern(gap.changedFile ?? "");
  return {
    id: `changed-file-rule:${gap.changedFile}`,
    kind: "add_changed_file_rule",
    severity: gap.severity,
    title: `Map changed file "${gap.changedFile}" to visual coverage`,
    rationale: [gap.message, "Changed-file rules are how Visual Hive chooses risk-appropriate contracts on PRs."],
    changedFile: gap.changedFile,
    contractId: contract?.id,
    targetId: contract?.target,
    suggestedConfigYaml: yamlSnippet({
      selection: {
        changedFiles: [
          {
            pattern,
            contracts: contract ? [contract.id] : ["replace-with-contract-id"],
            risk: contract?.severity ?? "medium"
          }
        ]
      }
    }),
    suggestedTests: [`Add a selection.changedFiles rule for ${pattern}.`, "Confirm docs-only paths remain ignored or cheap."]
  };
}

function selectionRuleForContract(config: VisualHiveConfig, gap: CoverageGap): CoverageImprovementRecommendation {
  const contract = config.contracts.find((candidate) => candidate.id === gap.contractId);
  return {
    id: `select-contract:${gap.contractId}`,
    kind: "add_changed_file_rule",
    severity: gap.severity,
    title: `Add changed-file selection for "${gap.contractId}"`,
    rationale: [gap.message, "Configured contracts need a trigger path, explicit include flag, or schedule-only rationale."],
    targetId: contract?.target,
    contractId: gap.contractId,
    suggestedConfigYaml: yamlSnippet({
      selection: {
        changedFiles: [
          {
            pattern: "src/**",
            contracts: [gap.contractId],
            risk: contract?.severity ?? "medium"
          }
        ]
      }
    }),
    suggestedTests: [`Map files that can affect ${gap.contractId} into selection.changedFiles.`, "If this is intentionally schedule-only, document that in the contract description."]
  };
}

function recommendationsForMutationSurvivors(config: VisualHiveConfig, mutationReport?: MutationReport): CoverageImprovementRecommendation[] {
  if (!mutationReport) return [];
  return mutationReport.results
    .filter((result) => result.status === "survived")
    .map((result) => {
      const contractId = result.contractIds[0];
      const contract = config.contracts.find((candidate) => candidate.id === contractId);
      return {
        id: `mutation-survivor:${result.operator}:${contractId ?? "unmapped"}`,
        kind: "map_mutation_operator",
        severity: "high" as const,
        title: `Strengthen tests for surviving mutation "${result.operator}"`,
        rationale: [
          `Mutation "${result.operator}" survived, so current contracts did not catch the intentional breakage.`,
          ...(result.failedAssertion ? [`Observed assertion evidence: ${sanitizeText(result.failedAssertion)}`] : []),
          ...(result.errors ?? []).slice(0, 2).map(sanitizeText)
        ],
        targetId: contract?.target,
        contractId,
        mutationOperator: result.operator,
        suggestedConfigYaml: yamlSnippet({
          mutation: { operators: [{ id: result.operator, contracts: contractId ? [contractId] : ["replace-with-contract-id"] }] },
          selectors: selectorsForOperator(result.operator)
        }),
        suggestedTests: testsForMutationOperator(result.operator, contractId)
      };
    });
}

function recommendationsForFlowGaps(config: VisualHiveConfig, flowAudit?: FlowAuditReport): CoverageImprovementRecommendation[] {
  if (!flowAudit) return [];
  return flowAudit.flows.flatMap((flow) => {
    const contract = config.contracts.find((candidate) => candidate.id === flow.contractId);
    if (!contract) return [];
    const recommendations: CoverageImprovementRecommendation[] = [];
    if (flow.gaps.some((gap) => gap.kind === "no_flow_steps")) {
      recommendations.push(flowStepRecommendation(config, contract, flow, "flow-steps", "Add deterministic flow steps"));
    } else {
      if (flow.gaps.some((gap) => gap.kind === "no_navigation_step")) {
        recommendations.push(flowStepRecommendation(config, contract, flow, "flow-goto", "Add an explicit flow navigation step", ["goto"]));
      }
      if (flow.gaps.some((gap) => gap.kind === "no_assertion_step")) {
        recommendations.push(flowStepRecommendation(config, contract, flow, "flow-assertion", "Add a deterministic flow assertion step", ["assertVisible"]));
      }
    }
    return recommendations;
  });
}

function flowStepRecommendation(
  config: VisualHiveConfig,
  contract: VisualHiveConfig["contracts"][number],
  flow: FlowAuditEntry,
  idPrefix: string,
  titlePrefix: string,
  actions?: Array<"goto" | "assertVisible">
): CoverageImprovementRecommendation {
  const route = contract.screenshots[0]?.route ?? "/";
  const selector = preferredFlowSelector(contract);
  const steps = buildSuggestedFlowSteps(route, selector, actions);
  const severity = flow.severity === "critical" ? "high" : flow.severity === "high" ? "medium" : "low";
  const target = config.targets[contract.target];
  const lane = recommendationLane(contract, target, flow.selected);
  const trustedOnly = lane === "protected";
  return {
    id: `${idPrefix}:${contract.id}`,
    kind: "add_flow_steps",
    severity,
    title: `${titlePrefix} for "${contract.id}"`,
    rationale: [
      ...flow.gaps
        .filter((gap) =>
          actions?.includes("goto")
            ? gap.kind === "no_navigation_step"
            : actions?.includes("assertVisible")
              ? gap.kind === "no_assertion_step"
              : gap.kind === "no_flow_steps"
        )
        .map((gap) => gap.message),
      "Flow steps protect user-visible behavior beyond static screenshot and selector checks."
    ],
    targetId: contract.target,
    contractId: contract.id,
    route,
    lane,
    trustedOnly,
    suggestedConfigYaml: yamlSnippet({ steps }),
    suggestedTests: flowSuggestedTests(contract.id, trustedOnly)
  };
}

function buildSuggestedFlowSteps(route: string, selector: string, actions?: Array<"goto" | "assertVisible">): VisualHiveConfig["contracts"][number]["steps"] {
  const requested = actions ?? ["goto", "assertVisible"];
  return requested.map((action) =>
    action === "goto"
      ? { action: "goto" as const, route, description: `Navigate to ${route}`, state: "visible" as const, timeoutMs: 15000 }
      : { action: "assertVisible" as const, selector, description: `Assert ${selector} is visible`, state: "visible" as const, timeoutMs: 15000 }
  );
}

function preferredFlowSelector(contract: VisualHiveConfig["contracts"][number]): string {
  return contract.selectors.mustExist[0] ?? contract.waitFor[0]?.selector ?? "body";
}

function recommendationLane(
  contract: VisualHiveConfig["contracts"][number],
  target: VisualHiveConfig["targets"][string],
  selected: boolean
): CoverageImprovementRecommendation["lane"] {
  if (target.kind === "protected" || !target.prSafe) return "protected";
  if (selected && contract.runOn.pullRequest) return "pull_request";
  if (contract.runOn.schedule || target.schedule) return "scheduled";
  return "manual";
}

function flowSuggestedTests(contractId: string, trustedOnly: boolean): string[] {
  if (trustedOnly) {
    return [
      `Review ${contractId} in a trusted scheduled/manual lane before applying flow steps.`,
      "Do not run protected or secret-bearing targets from untrusted pull_request workflows."
    ];
  }
  return [
    `Run ${contractId} locally and verify the flow steps pass before making CI required.`,
    "Prefer stable data-testid selectors and avoid typing real credentials into flow steps."
  ];
}

function buildVisualTestMaintenanceFindings(
  config: VisualHiveConfig,
  coverage: CoverageReport,
  mutationReport?: MutationReport,
  options: BuildCoverageImprovementOptions = {}
): VisualTestMaintenanceFinding[] {
  const findings: VisualTestMaintenanceFinding[] = [];
  const screenshotKeys = new Map<string, Array<{ contractId: string; targetId: string; screenshotName: string; route: string; viewport: string }>>();

  for (const contract of config.contracts) {
    const coverageContract = coverage.contracts.find((candidate) => candidate.id === contract.id);
    const selectorList = [
      ...contract.selectors.mustExist,
      ...contract.selectors.mustNotExist,
      ...contract.selectors.textMustExist,
      ...contract.selectors.textMustNotExist
    ];
    const target = config.targets[contract.target];
    const trustedOnly = target?.kind === "protected" || !target?.prSafe;

    if (selectorList.length > 0 && selectorList.every(isGenericSelector)) {
      findings.push(
        maintenanceFinding({
          kind: "generic_selector",
          severity: contract.severity === "critical" ? "high" : "medium",
          contract,
          message: `Contract "${contract.id}" relies only on generic selectors, so it may pass while user-visible ownership changes.`,
          evidence: selectorList.map((selector) => `selector=${selector}`),
          recommendedAction: "add_assertion",
          hiveOwner: "quality",
          trustedOnly
        })
      );
    }

    if (contract.screenshots.length > 0 && (coverageContract?.flowStepCount ?? contract.steps.length) === 0) {
      findings.push(
        maintenanceFinding({
          kind: "screenshot_without_assertion",
          severity: contract.severity === "critical" ? "high" : "medium",
          contract,
          route: contract.screenshots[0]?.route,
          viewport: contract.screenshots[0]?.viewport,
          screenshotName: contract.screenshots[0]?.name,
          message: `Contract "${contract.id}" captures screenshots but has no user-flow steps.`,
          evidence: [`screenshots=${contract.screenshots.length}`, "flowStepCount=0"],
          recommendedAction: "add_assertion",
          hiveOwner: "quality",
          trustedOnly
        })
      );
    }

    const screenshotViewports = new Set(contract.screenshots.map((screenshot) => screenshot.viewport));
    if (contract.screenshots.length > 0 && config.viewports.mobile && !screenshotViewports.has("mobile")) {
      findings.push(
        maintenanceFinding({
          kind: "missing_mobile_viewport",
          severity: "medium",
          contract,
          route: contract.screenshots[0]?.route,
          viewport: "mobile",
          screenshotName: contract.screenshots[0]?.name,
          message: `Contract "${contract.id}" has screenshot coverage but no mobile viewport screenshot.`,
          evidence: [`viewports=${Array.from(screenshotViewports).sort().join(",") || "none"}`, "configuredViewport=mobile"],
          recommendedAction: "expand",
          hiveOwner: "quality",
          trustedOnly
        })
      );
    }

    for (const screenshot of contract.screenshots) {
      const key = `${contract.target}|${screenshot.route}|${screenshot.viewport}`;
      const existing = screenshotKeys.get(key) ?? [];
      existing.push({ contractId: contract.id, targetId: contract.target, screenshotName: screenshot.name, route: screenshot.route, viewport: screenshot.viewport });
      screenshotKeys.set(key, existing);

      if (screenshot.fullPage && screenshot.mask.length === 0) {
        findings.push(
          maintenanceFinding({
            kind: "overbroad_full_page",
            severity: "low",
            contract,
            route: screenshot.route,
            viewport: screenshot.viewport,
            screenshotName: screenshot.name,
            message: `Screenshot "${screenshot.name}" is full-page with no masks; consider shrinking or masking dynamic regions.`,
            evidence: ["fullPage=true", "maskCount=0"],
            recommendedAction: "shrink",
            hiveOwner: "quality",
            trustedOnly
          })
        );
      }
    }
  }

  for (const matches of screenshotKeys.values()) {
    if (matches.length <= 1) continue;
    const [first] = matches;
    if (!first) continue;
    findings.push(
      maintenanceFinding({
        kind: "duplicate_screenshot",
        severity: "low",
        contract: config.contracts.find((contract) => contract.id === first.contractId) ?? config.contracts[0]!,
        route: first.route,
        viewport: first.viewport,
        screenshotName: first.screenshotName,
        message: `Multiple contracts capture ${first.route} at ${first.viewport} on target ${first.targetId}.`,
        evidence: matches.map((match) => `${match.contractId}:${match.screenshotName}`),
        recommendedAction: "split",
        hiveOwner: "quality",
        trustedOnly: false
      })
    );
  }

  for (const result of mutationReport?.results ?? []) {
    if (result.status !== "survived") continue;
    const contractId = result.contractIds[0] ?? "unmapped";
    const contract = config.contracts.find((candidate) => candidate.id === contractId) ?? config.contracts[0];
    if (!contract) continue;
    findings.push(
      maintenanceFinding({
        kind: "mutation_survivor",
        severity: "high",
        contract,
        message: `Mutation "${result.operator}" survived, indicating the related visual test is underpowered.`,
        evidence: [`operator=${result.operator}`, `status=${result.status}`, ...(result.errors ?? []).slice(0, 2).map(sanitizeText)],
        recommendedAction: "fix",
        hiveOwner: "quality",
        trustedOnly: false
      })
    );
  }

  if (config.visual.maxDiffPixelRatio > 0.05 || (config.visual.maxDiffPixels ?? 0) > 5000) {
    for (const contract of config.contracts.filter((candidate) => candidate.screenshots.length > 0).slice(0, 3)) {
      findings.push(
        maintenanceFinding({
          kind: "weak_threshold",
          severity: "medium",
          contract,
          route: contract.screenshots[0]?.route,
          viewport: contract.screenshots[0]?.viewport,
          screenshotName: contract.screenshots[0]?.name,
          message: `Visual tolerance is broad enough that meaningful diffs may be hidden.`,
          evidence: [`maxDiffPixelRatio=${config.visual.maxDiffPixelRatio}`, `maxDiffPixels=${config.visual.maxDiffPixels ?? "unset"}`],
          recommendedAction: "fix",
          hiveOwner: "ci-maintainer",
          trustedOnly: false
        })
      );
    }
  }

  findings.push(...artifactBackedBaselineMaintenanceFindings(config, options));

  return dedupeMaintenanceFindings(findings).slice(0, 20);
}

function artifactBackedBaselineMaintenanceFindings(
  config: VisualHiveConfig,
  options: BuildCoverageImprovementOptions
): VisualTestMaintenanceFinding[] {
  const findings: VisualTestMaintenanceFinding[] = [];
  const now = options.now ?? new Date();
  const staleAfterMs = 7 * 24 * 60 * 60 * 1000;
  const baselineList = options.baselineList;

  if (baselineList) {
    const generatedAtMs = Date.parse(baselineList.generatedAt);
    const ageMs = Number.isFinite(generatedAtMs) ? now.getTime() - generatedAtMs : 0;
    if (ageMs >= staleAfterMs) {
      for (const entry of baselineList.entries.filter((candidate) => candidate.canApprove && !candidate.approvedAt && !candidate.rejectedAt).slice(0, 3)) {
        const contract = config.contracts.find((candidate) => candidate.id === entry.contractId);
        if (!contract) continue;
        findings.push(
          maintenanceFinding({
            kind: "stale_baseline",
            severity: "medium",
            contract,
            route: entry.route,
            viewport: entry.viewport,
            screenshotName: entry.screenshotName,
            message: `Baseline review for "${entry.contractId}/${entry.screenshotName}" has been pending since ${baselineList.generatedAt}.`,
            evidence: [
              `baselineReviewGeneratedAt=${baselineList.generatedAt}`,
              `ageDays=${Math.floor(ageMs / (24 * 60 * 60 * 1000))}`,
              `status=${entry.status}`,
              `actualPath=${entry.actualPath}`,
              `baselinePath=${entry.baselinePath}`
            ],
            recommendedAction: "fix",
            hiveOwner: "ci-maintainer",
            trustedOnly: config.targets[contract.target]?.kind === "protected" || !config.targets[contract.target]?.prSafe
          })
        );
      }
    }
  }

  const churnCounts = new Map<string, { approvals: number; rejections: number; contractId: string; screenshotName: string; route: string; viewport: string }>();
  for (const approval of options.baselineApprovals?.approvals ?? []) {
    const key = baselineDecisionKey(approval);
    const value = churnCounts.get(key) ?? { approvals: 0, rejections: 0, contractId: approval.contractId, screenshotName: approval.screenshotName, route: approval.route, viewport: approval.viewport };
    value.approvals += 1;
    churnCounts.set(key, value);
  }
  for (const rejection of options.baselineRejections?.rejections ?? []) {
    const key = baselineDecisionKey(rejection);
    const value = churnCounts.get(key) ?? { approvals: 0, rejections: 0, contractId: rejection.contractId, screenshotName: rejection.screenshotName, route: rejection.route, viewport: rejection.viewport };
    value.rejections += 1;
    churnCounts.set(key, value);
  }
  for (const churn of churnCounts.values()) {
    if (churn.approvals + churn.rejections < 3 && !(churn.approvals > 0 && churn.rejections > 0)) continue;
    const contract = config.contracts.find((candidate) => candidate.id === churn.contractId);
    if (!contract) continue;
    findings.push(
      maintenanceFinding({
        kind: "baseline_churn",
        severity: churn.rejections > 1 ? "high" : "medium",
        contract,
        route: churn.route,
        viewport: churn.viewport,
        screenshotName: churn.screenshotName,
        message: `Baseline "${churn.contractId}/${churn.screenshotName}" has repeated approval/rejection activity and may be unstable.`,
        evidence: [`approvals=${churn.approvals}`, `rejections=${churn.rejections}`, `route=${churn.route}`, `viewport=${churn.viewport}`],
        recommendedAction: "fix",
        hiveOwner: "ci-maintainer",
        trustedOnly: false
      })
    );
  }

  const history = options.runHistory;
  if (history && history.entries.length >= 3) {
    const recent = history.entries.slice(0, 5);
    const noisy = recent.filter((entry) => entry.createdBaselines + entry.missingBaselines + entry.visualDiffs > 0);
    if (noisy.length >= 3) {
      const contractId = noisy.flatMap((entry) => entry.selectedContracts)[0];
      const contract = config.contracts.find((candidate) => candidate.id === contractId) ?? config.contracts.find((candidate) => candidate.screenshots.length > 0);
      if (contract) {
        findings.push(
          maintenanceFinding({
            kind: "baseline_churn",
            severity: "medium",
            contract,
            route: contract.screenshots[0]?.route,
            viewport: contract.screenshots[0]?.viewport,
            screenshotName: contract.screenshots[0]?.name,
            message: "Recent run history shows repeated baseline or visual-diff activity.",
            evidence: noisy.map((entry) => `${entry.id}:created=${entry.createdBaselines}:missing=${entry.missingBaselines}:diffs=${entry.visualDiffs}`).slice(0, 5),
            recommendedAction: "fix",
            hiveOwner: "ci-maintainer",
            trustedOnly: false
          })
        );
      }
    }
  }

  return findings;
}

function baselineDecisionKey(value: { contractId: string; screenshotName: string; route: string; viewport: string }): string {
  return `${value.contractId}\0${value.screenshotName}\0${value.route}\0${value.viewport}`;
}

function recommendationsForMaintenanceFindings(
  config: VisualHiveConfig,
  findings: VisualTestMaintenanceFinding[]
): CoverageImprovementRecommendation[] {
  return findings.map((finding) => {
    const contract = config.contracts.find((candidate) => candidate.id === finding.contractId);
    return {
      id: `maintenance:${finding.id}`,
      kind: "maintain_visual_test",
      severity: finding.severity,
      title: `Maintain visual test "${finding.contractId}": ${finding.kind}`,
      rationale: [finding.message, ...finding.evidence],
      targetId: finding.targetId,
      contractId: finding.contractId,
      route: finding.route,
      viewport: finding.viewport,
      maintenanceFindingId: finding.id,
      lane: contract ? recommendationLane(contract, config.targets[contract.target], contract.runOn.pullRequest) : "manual",
      trustedOnly: config.targets[finding.targetId]?.kind === "protected" || !config.targets[finding.targetId]?.prSafe,
      suggestedTests: suggestedTestsForMaintenanceFinding(finding),
      suggestedConfigYaml: suggestedConfigForMaintenanceFinding(finding)
    };
  });
}

function maintenanceFinding(options: {
  kind: VisualTestMaintenanceKind;
  severity: VisualTestMaintenanceFinding["severity"];
  contract: VisualHiveConfig["contracts"][number];
  route?: string;
  viewport?: string;
  screenshotName?: string;
  message: string;
  evidence: string[];
  recommendedAction: VisualTestMaintenanceAction;
  hiveOwner: VisualTestMaintenanceFinding["hiveOwner"];
  trustedOnly: boolean;
}): VisualTestMaintenanceFinding {
  return {
    id: slug(
      [options.kind, options.contract.id, options.screenshotName, options.route, options.viewport]
        .filter(Boolean)
        .join("-")
    ),
    kind: options.kind,
    severity: options.severity,
    contractId: options.contract.id,
    targetId: options.contract.target,
    route: options.route,
    viewport: options.viewport,
    screenshotName: options.screenshotName,
    message: options.message,
    evidence: options.evidence,
    recommendedAction: options.recommendedAction,
    hiveOwner: options.hiveOwner,
    validationCommand: options.trustedOnly
      ? "visual-hive plan --config visual-hive.config.yaml --mode schedule && visual-hive run --config visual-hive.config.yaml --ci"
      : "visual-hive plan --config visual-hive.config.yaml --mode pr && visual-hive run --config visual-hive.config.yaml --ci"
  };
}

function suggestedTestsForMaintenanceFinding(finding: VisualTestMaintenanceFinding): string[] {
  if (finding.kind === "generic_selector") return ["Replace generic selectors with project-owned data-testid assertions.", "Keep the generic selector only as a fallback, not the main oracle."];
  if (finding.kind === "screenshot_without_assertion") return ["Add goto/assertVisible/assertText flow steps around the screenshot state.", "Use the same stable selectors that the screenshot is meant to protect."];
  if (finding.kind === "missing_mobile_viewport") return [`Add a ${finding.viewport ?? "mobile"} screenshot for ${finding.contractId}.`];
  if (finding.kind === "overbroad_full_page") return ["Shrink the screenshot to the stable region or add masks for dynamic areas.", "Keep full-page screenshots only when the full layout is the intended contract."];
  if (finding.kind === "duplicate_screenshot") return ["Split the duplicated screenshots by route/state or remove one after replacing it with a targeted assertion."];
  if (finding.kind === "mutation_survivor") return ["Strengthen selectors, flow steps, or screenshots until the related mutation is killed."];
  if (finding.kind === "weak_threshold") return ["Review visual.maxDiffPixelRatio/maxDiffPixels before making this lane gating."];
  if (finding.kind === "stale_baseline") return ["Review or reject the pending baseline change; do not let old created/diff screenshots become trusted by age.", "Rerun the deterministic lane after the baseline decision."];
  if (finding.kind === "baseline_churn") return ["Inspect run history and baseline approval/rejection logs for dynamic UI regions.", "Add masks, stronger waitFor selectors, or narrower screenshots before approving new baselines."];
  return ["Review and maintain this visual test before relying on it as a gating contract."];
}

function suggestedConfigForMaintenanceFinding(finding: VisualTestMaintenanceFinding): string | undefined {
  if (finding.kind === "generic_selector" || finding.kind === "screenshot_without_assertion") {
    return yamlSnippet({
      selectors: { mustExist: ["[data-testid='replace-with-stable-user-visible-selector']"] },
      steps: [
        {
          action: "assertVisible",
          selector: "[data-testid='replace-with-stable-user-visible-selector']",
          description: "Assert stable user-visible ownership for this visual contract."
        }
      ]
    });
  }
  if (finding.kind === "missing_mobile_viewport") {
    return yamlSnippet({
      screenshots: [{ name: `${slug(finding.contractId)}-mobile`, route: finding.route ?? "/", viewport: finding.viewport ?? "mobile" }]
    });
  }
  if (finding.kind === "overbroad_full_page") {
    return yamlSnippet({
      screenshots: [{ name: finding.screenshotName ?? "stable-region", route: finding.route ?? "/", viewport: finding.viewport ?? "desktop", fullPage: false }]
    });
  }
  if (finding.kind === "weak_threshold") {
    return yamlSnippet({ visual: { maxDiffPixelRatio: 0.01, failOnMissingBaselineInCI: true } });
  }
  if (finding.kind === "stale_baseline" || finding.kind === "baseline_churn") {
    return yamlSnippet({
      screenshots: [{ name: finding.screenshotName ?? "stable-region", route: finding.route ?? "/", viewport: finding.viewport ?? "desktop", mask: ["[data-testid='dynamic-region']"] }],
      waitFor: [{ selector: "[data-testid='stable-loaded-state']", state: "visible", timeoutMs: 15000 }]
    });
  }
  return undefined;
}

function isGenericSelector(selector: string): boolean {
  return ["body", "main", "#root", "html", "[role='main']"].includes(selector.trim().toLowerCase());
}

function dedupeMaintenanceFindings(findings: VisualTestMaintenanceFinding[]): VisualTestMaintenanceFinding[] {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    if (seen.has(finding.id)) return false;
    seen.add(finding.id);
    return true;
  });
}

function selectorsForOperator(operator: string): Record<string, string[]> {
  if (operator === "force-login-on-demo") return { mustNotExist: ["[data-testid='login-page']", "[data-testid='github-login-button']"] };
  if (operator === "hide-critical-button") return { mustExist: ["[data-testid='critical-action-button']"] };
  if (operator === "remove-demo-badge") return { mustExist: ["[data-testid='demo-badge']"] };
  if (operator === "api-500" || operator === "empty-data") return { mustExist: ["[data-testid='api-data-area']"] };
  if (operator === "mobile-overflow") return { mustExist: ["body"] };
  return { mustExist: ["[data-testid='replace-with-user-visible-contract']"] };
}

function testsForMutationOperator(operator: string, contractId?: string): string[] {
  const target = contractId ? ` in ${contractId}` : "";
  if (operator === "force-login-on-demo") return [`Assert login controls must not exist${target}.`, "Keep this mutation mapped to the hosted/demo no-login contract."];
  if (operator === "hide-critical-button") return [`Assert the critical action button exists${target}.`, "Add a flow step that clicks the critical action when feasible."];
  if (operator === "remove-demo-badge") return [`Assert demo badges exist on demo cards${target}.`];
  if (operator === "api-500") return [`Assert API-backed data renders a non-error state${target}.`];
  if (operator === "empty-data") return [`Assert API-backed data is not empty${target}.`];
  if (operator === "mobile-overflow") return [`Add a mobile screenshot or overflow assertion${target}.`];
  return [`Add a selector or flow assertion that detects ${operator}${target}.`];
}

function summarize(recommendations: CoverageImprovementRecommendation[]): CoverageImprovementSummary {
  return {
    total: recommendations.length,
    high: recommendations.filter((recommendation) => recommendation.severity === "high").length,
    medium: recommendations.filter((recommendation) => recommendation.severity === "medium").length,
    low: recommendations.filter((recommendation) => recommendation.severity === "low").length,
    fromCoverageGaps: recommendations.filter(
      (recommendation) =>
        !recommendation.id.startsWith("mutation-survivor:") && !recommendation.id.startsWith("maintenance:") && recommendation.kind !== "add_flow_steps"
    ).length,
    fromMutationSurvivors: recommendations.filter((recommendation) => recommendation.id.startsWith("mutation-survivor:")).length,
    fromFlowGaps: recommendations.filter((recommendation) => recommendation.kind === "add_flow_steps").length,
    fromMaintenanceFindings: recommendations.filter((recommendation) => recommendation.id.startsWith("maintenance:")).length
  };
}

function dedupeRecommendations(recommendations: CoverageImprovementRecommendation[]): CoverageImprovementRecommendation[] {
  const seen = new Set<string>();
  return recommendations
    .sort((a, b) => `${severityRank(b.severity)}:${a.kind}:${a.id}`.localeCompare(`${severityRank(a.severity)}:${b.kind}:${b.id}`))
    .filter((recommendation) => {
      if (seen.has(recommendation.id)) return false;
      seen.add(recommendation.id);
      return true;
    });
}

function yamlSnippet(value: unknown): string {
  return stringify(value, { sortMapEntries: false }).trimEnd();
}

function parseSnippet<T>(recommendation: CoverageImprovementRecommendation): T {
  if (!recommendation.suggestedConfigYaml) return {} as T;
  try {
    return JSON.parse(JSON.stringify(parse(recommendation.suggestedConfigYaml))) as T;
  } catch (error) {
    throw new Error(`Unable to apply recommendation "${recommendation.id}" because its config snippet is invalid: ${sanitizeText(error instanceof Error ? error.message : String(error))}`);
  }
}

function cloneConfig(config: VisualHiveConfig): VisualHiveConfig {
  return JSON.parse(JSON.stringify(config)) as VisualHiveConfig;
}

function createUnifiedDiff(current: string, proposed: string, fromLabel: string, toLabel: string): string {
  if (current === proposed) return "No config changes.";
  const before = current.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const after = proposed.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const diff = [`--- ${fromLabel}`, `+++ ${toLabel}`];
  const max = Math.max(before.length, after.length);
  for (let index = 0; index < max; index += 1) {
    if (before[index] === after[index] && before[index] !== undefined) {
      diff.push(` ${before[index]}`);
      continue;
    }
    if (before[index] !== undefined) diff.push(`-${before[index]}`);
    if (after[index] !== undefined) diff.push(`+${after[index]}`);
  }
  return diff.join("\n");
}

function firstViewport(config: VisualHiveConfig, preferred: string): string {
  if (config.viewports[preferred]) return preferred;
  return Object.keys(config.viewports).sort()[0] ?? "desktop";
}

function firstPrSafeTarget(config: VisualHiveConfig): string {
  return Object.entries(config.targets).find(([, target]) => target.prSafe)?.[0] ?? Object.keys(config.targets).sort()[0] ?? "localPreview";
}

function firstContractWithScreenshots(config: VisualHiveConfig) {
  return config.contracts.find((contract) => contract.screenshots.length > 0) ?? config.contracts[0];
}

function bestContractForChangedFile(config: VisualHiveConfig, changedFile: string) {
  const normalized = changedFile.toLowerCase();
  if (normalized.includes("auth") || normalized.includes("login")) {
    return config.contracts.find((contract) => /auth|login|oauth/i.test(contract.id)) ?? config.contracts[0];
  }
  if (normalized.includes("cluster")) {
    return config.contracts.find((contract) => /cluster/i.test(contract.id)) ?? config.contracts[0];
  }
  if (normalized.includes("setting")) {
    return config.contracts.find((contract) => /setting/i.test(contract.id)) ?? config.contracts[0];
  }
  return config.contracts.find((contract) => contract.target === firstPrSafeTarget(config)) ?? config.contracts[0];
}

function changedFilePattern(changedFile: string): string {
  const normalized = changedFile.replaceAll("\\", "/");
  const segments = normalized.split("/");
  if (segments.length <= 1) return normalized || "src/**";
  return `${segments.slice(0, -1).join("/")}/**`;
}

function sameFlowStep(left: VisualHiveConfig["contracts"][number]["steps"][number], right: VisualHiveConfig["contracts"][number]["steps"][number]): boolean {
  return (
    left.action === right.action &&
    left.selector === right.selector &&
    left.route === right.route &&
    left.value === right.value &&
    left.key === right.key &&
    left.text === right.text
  );
}

function trimRoute(route: string): string {
  return route.replace(/^\/+/, "") || "home";
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function severityRank(severity: CoverageImprovementRecommendation["severity"]): number {
  return { low: 1, medium: 2, high: 3 }[severity];
}

function catalogedOutputResource(resourceId: string, artifactPath: string): CoverageImprovementOutputResource {
  const resource = getEvidenceResourceById(resourceId);
  return {
    artifactPath,
    evidenceResourceId: resource?.id ?? resourceId,
    evidenceResourceUri: resource?.uri ?? `visual-hive://${resourceId}`,
    evidenceResourceTitle: resource?.title ?? resourceId,
    evidenceResourceDescription: resource?.description ?? "Visual Hive evidence artifact.",
    ...(resource?.readTool?.name ? { evidenceReadToolName: resource.readTool.name } : {})
  };
}
