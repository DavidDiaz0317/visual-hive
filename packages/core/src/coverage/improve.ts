import { stringify } from "yaml";
import type { VisualHiveConfig } from "../config/schema.js";
import type { MutationReport } from "../reports/types.js";
import { sanitizeText } from "../utils/sanitize.js";
import type { CoverageGap, CoverageReport } from "./analyze.js";

export interface CoverageImprovementReport {
  schemaVersion: 1;
  project: string;
  generatedAt: string;
  summary: CoverageImprovementSummary;
  recommendations: CoverageImprovementRecommendation[];
}

export interface CoverageImprovementSummary {
  total: number;
  high: number;
  medium: number;
  low: number;
  fromCoverageGaps: number;
  fromMutationSurvivors: number;
}

export type CoverageImprovementKind =
  | "add_contract"
  | "add_screenshot"
  | "add_selector_assertion"
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
  suggestedConfigYaml?: string;
  suggestedTests: string[];
}

export interface BuildCoverageImprovementOptions {
  now?: Date;
  maxRecommendations?: number;
}

export function buildCoverageImprovementReport(
  config: VisualHiveConfig,
  coverage: CoverageReport,
  mutationReport?: MutationReport,
  options: BuildCoverageImprovementOptions = {}
): CoverageImprovementReport {
  const recommendations = [
    ...coverage.uncoveredAreas.flatMap((gap) => recommendationForGap(config, gap)),
    ...recommendationsForMutationSurvivors(config, mutationReport)
  ];
  const deduped = dedupeRecommendations(recommendations).slice(0, options.maxRecommendations ?? 30);
  return {
    schemaVersion: 1,
    project: config.project.name,
    generatedAt: (options.now ?? new Date()).toISOString(),
    summary: summarize(deduped),
    recommendations: deduped
  };
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
    fromCoverageGaps: recommendations.filter((recommendation) => !recommendation.id.startsWith("mutation-survivor:")).length,
    fromMutationSurvivors: recommendations.filter((recommendation) => recommendation.id.startsWith("mutation-survivor:")).length
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
