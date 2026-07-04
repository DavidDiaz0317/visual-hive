import { parse, stringify } from "yaml";
import type { MutationOperator, VisualHiveConfig } from "../config/schema.js";
import { VisualHiveConfigSchema } from "../config/schema.js";
import { validateReferences } from "../config/load.js";
import type { MutationReport } from "../reports/types.js";
import { getEvidenceResourceById } from "../tools/evidenceResources.js";
import { sanitizeText } from "../utils/sanitize.js";
import type { CoverageGap, CoverageReport } from "./analyze.js";
import type { FlowAuditEntry, FlowAuditReport } from "../flows/audit.js";

export interface CoverageImprovementReport {
  schemaVersion: 1;
  project: string;
  generatedAt: string;
  outputResource?: CoverageImprovementOutputResource;
  summary: CoverageImprovementSummary;
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
}

export type CoverageImprovementKind =
  | "add_contract"
  | "add_screenshot"
  | "add_selector_assertion"
  | "add_flow_steps"
  | "add_changed_file_rule"
  | "map_mutation_operator";

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
}

export function buildCoverageImprovementReport(
  config: VisualHiveConfig,
  coverage: CoverageReport,
  mutationReport?: MutationReport,
  options: BuildCoverageImprovementOptions = {}
): CoverageImprovementReport {
  const recommendations = [
    ...coverage.uncoveredAreas.flatMap((gap) => recommendationForGap(config, gap)),
    ...recommendationsForMutationSurvivors(config, mutationReport),
    ...recommendationsForFlowGaps(config, options.flowAudit)
  ];
  const deduped = dedupeRecommendations(recommendations).slice(0, options.maxRecommendations ?? 30);
  return {
    schemaVersion: 1,
    project: config.project.name,
    generatedAt: (options.now ?? new Date()).toISOString(),
    outputResource: catalogedOutputResource("coverage-recommendations", ".visual-hive/coverage-recommendations.json"),
    summary: summarize(deduped),
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
      (recommendation) => !recommendation.id.startsWith("mutation-survivor:") && recommendation.kind !== "add_flow_steps"
    ).length,
    fromMutationSurvivors: recommendations.filter((recommendation) => recommendation.id.startsWith("mutation-survivor:")).length,
    fromFlowGaps: recommendations.filter((recommendation) => recommendation.kind === "add_flow_steps").length
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
