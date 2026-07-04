import path from "node:path";
import { readJson, writeJson, writeText } from "../utils/files.js";
import { sanitizeText } from "../utils/sanitize.js";
import type { CoverageImprovementReport, CoverageImprovementRecommendation } from "../coverage/improve.js";
import type { EvidencePacket, EvidencePacketTestingLayer } from "../evidence/types.js";
import type { HandoffPacket, HandoffWorkItem } from "../handoff/types.js";
import { getEvidenceResourceById } from "../tools/evidenceResources.js";
import type {
  BuildTestCreationPlanOptions,
  TestCreationKind,
  TestCreationPlan,
  TestCreationPlanOutputResource,
  TestCreationPriority,
  TestCreationRecommendation,
  TestCreationRecommendationDraft
} from "./types.js";

export interface WriteTestCreationPlanOptions extends BuildTestCreationPlanOptions {
  rootDir: string;
  outputPath?: string;
  markdownPath?: string;
}

export async function buildTestCreationPlan(options: BuildTestCreationPlanOptions): Promise<TestCreationPlan> {
  const evidence = options.evidencePacket ?? (options.evidencePacketPath ? await readOptional<EvidencePacket>(options.evidencePacketPath) : undefined);
  const coverage =
    options.coverageRecommendations ??
    (options.coverageRecommendationsPath ? await readOptional<CoverageImprovementReport>(options.coverageRecommendationsPath) : undefined);
  const handoff = options.handoffPacket ?? (options.handoffPacketPath ? await readOptional<HandoffPacket>(options.handoffPacketPath) : undefined);
  const recommendations = dedupeRecommendations([
    ...recommendationsFromTestingLayers(evidence?.testingLayers ?? []),
    ...recommendationsFromCoverage(coverage?.recommendations ?? []),
    ...recommendationsFromMutationSurvivors(evidence?.mutation?.survivedOperators ?? []),
    ...recommendationsFromHandoff(handoff?.workItems ?? [])
  ]).map(enrichRecommendation);

  const plan: TestCreationPlan = {
    schemaVersion: "visual-hive.test-creation-plan.v1",
    generatedAt: (options.now ?? new Date()).toISOString(),
    project: options.project,
    outputResource: catalogedOutputResource("test-creation-plan", ".visual-hive/test-creation-plan.json"),
    sourceArtifacts: sanitizeValue({
      evidencePacket: normalizeArtifactPath(options.evidencePacketPath),
      coverageRecommendations: normalizeArtifactPath(options.coverageRecommendationsPath),
      handoffPacket: normalizeArtifactPath(options.handoffPacketPath)
    }) as TestCreationPlan["sourceArtifacts"],
    governance: {
      verdictAuthority: "visual_hive",
      agentAuthority: "advisory_test_generation_only",
      writePolicy: "no_config_or_test_files_written",
      secretPolicy: "redacted_values_names_only"
    },
    summary: summarize(recommendations),
    recommendations: sanitizeValue(recommendations) as TestCreationRecommendation[]
  };
  return plan;
}

export async function writeTestCreationPlan(
  options: WriteTestCreationPlanOptions
): Promise<{ plan: TestCreationPlan; planPath: string; markdownPath: string }> {
  const rootDir = path.resolve(options.rootDir);
  const evidencePacketPath = options.evidencePacketPath ?? ".visual-hive/evidence-packet.json";
  const coverageRecommendationsPath = options.coverageRecommendationsPath ?? ".visual-hive/coverage-recommendations.json";
  const handoffPacketPath = options.handoffPacketPath ?? ".visual-hive/handoff.json";
  const plan = await buildTestCreationPlan({
    ...options,
    evidencePacketPath,
    coverageRecommendationsPath,
    handoffPacketPath,
    evidencePacket: options.evidencePacket ?? (await readOptional<EvidencePacket>(resolve(rootDir, evidencePacketPath))),
    coverageRecommendations:
      options.coverageRecommendations ?? (await readOptional<CoverageImprovementReport>(resolve(rootDir, coverageRecommendationsPath))),
    handoffPacket: options.handoffPacket ?? (await readOptional<HandoffPacket>(resolve(rootDir, handoffPacketPath)))
  });
  const planPath = resolve(rootDir, options.outputPath ?? ".visual-hive/test-creation-plan.json");
  const markdownPath = resolve(rootDir, options.markdownPath ?? ".visual-hive/test-creation-plan.md");
  await writeJson(planPath, plan);
  await writeText(markdownPath, renderTestCreationPlanMarkdown(plan));
  return { plan, planPath, markdownPath };
}

export function renderTestCreationPlanMarkdown(plan: TestCreationPlan): string {
  const lines = [
    `# Visual Hive Test Creation Plan: ${plan.project}`,
    "",
    `- Generated: ${plan.generatedAt}`,
    `- Recommendations: ${plan.summary.total}`,
    `- High: ${plan.summary.high}`,
    `- Medium: ${plan.summary.medium}`,
    `- Low: ${plan.summary.low}`,
    `- Write policy: ${plan.governance.writePolicy}`,
    "- Verdict authority: Visual Hive deterministic Verdict Engine",
    "- Agent output is advisory test-generation guidance only.",
    "",
    "## Recommendations",
    ...(plan.recommendations.length
      ? plan.recommendations
          .slice(0, 20)
          .flatMap((recommendation) => [
            `- [${recommendation.priority}] ${recommendation.title}`,
            `  - Source: ${recommendation.source}`,
            `  - Kind: ${recommendation.kind}`,
            `  - Gap: ${recommendation.gapId}`,
            `  - Affected: ${formatAffected(recommendation.affected)}`,
            `  - Hive owner: ${recommendation.hiveOwner}`,
            `  - Suggested mutation: ${recommendation.suggestedMutation}`,
            `  - Validation: \`${recommendation.validationCommand}\``,
            `  - Suggested tests: ${recommendation.suggestedTests.join(" ")}`
          ])
      : ["- No test-creation recommendations were generated from current evidence."])
  ];
  return `${sanitizeText(lines.join("\n"))}\n`;
}

function recommendationsFromTestingLayers(layers: EvidencePacketTestingLayer[]): TestCreationRecommendationDraft[] {
  return layers
    .filter((layer) => layer.status === "missing" || layer.status === "unknown" || layer.status === "partial")
    .filter((layer) => [2, 3, 4, 5, 6, 9].includes(layer.id))
    .map((layer) => recommendationForLayer(layer));
}

function recommendationForLayer(layer: EvidencePacketTestingLayer): TestCreationRecommendationDraft {
  const kind = kindForLayer(layer.id);
  const priority = layer.status === "missing" ? "high" : layer.status === "unknown" ? "medium" : "low";
  return {
    id: safeId(`layer-${layer.id}-${layer.status}`),
    source: "testing_layer",
    kind,
    priority,
    title: `${titleForKind(kind)} for ${layer.name}`,
    rationale: layer.gaps.length ? layer.gaps : [`Layer ${layer.id} (${layer.name}) is ${layer.status}.`],
    layer: { id: layer.id, name: layer.name, status: layer.status },
    suggestedTests: testsForLayer(layer),
    suggestedConfigYaml: configSnippetForLayer(layer),
    artifacts: layer.evidence.length ? layer.evidence : [".visual-hive/testing-layers.json", ".visual-hive/evidence-packet.json"],
    trustedOnly: layer.id === 8,
    applyMode: "advisory_no_write"
  };
}

function recommendationsFromCoverage(recommendations: CoverageImprovementRecommendation[]): TestCreationRecommendationDraft[] {
  return recommendations.slice(0, 20).map((recommendation) => ({
    id: safeId(`coverage-${recommendation.id}`),
    source: "coverage_recommendation",
    kind: kindForCoverage(recommendation),
    priority: recommendation.severity,
    title: recommendation.title,
    rationale: recommendation.rationale,
    targetId: recommendation.targetId,
    contractId: recommendation.contractId,
    mutationOperator: recommendation.mutationOperator,
    coverageRecommendationId: recommendation.id,
    suggestedTests: recommendation.suggestedTests,
    suggestedConfigYaml: recommendation.suggestedConfigYaml,
    artifacts: [".visual-hive/coverage-recommendations.json"],
    trustedOnly: Boolean(recommendation.trustedOnly),
    applyMode: "advisory_no_write"
  }));
}

function recommendationsFromMutationSurvivors(
  survivors: Array<{ operator: string; contractIds: string[]; failedAssertion?: string; artifacts: string[] }>
): TestCreationRecommendationDraft[] {
  return survivors.map((survivor) => ({
    id: safeId(`mutation-${survivor.operator}-${survivor.contractIds[0] ?? "unmapped"}`),
    source: "mutation_survivor",
    kind: "mutation_mapping",
    priority: "high",
    title: `Create or strengthen tests for survived mutation ${survivor.operator}`,
    rationale: [
      `Mutation ${survivor.operator} survived deterministic adequacy checks.`,
      ...(survivor.failedAssertion ? [survivor.failedAssertion] : [])
    ],
    contractId: survivor.contractIds[0],
    mutationOperator: survivor.operator,
    suggestedTests: testsForMutationOperator(survivor.operator),
    suggestedConfigYaml: `mutation:\n  operators:\n    - id: ${survivor.operator}\n      contracts:\n        - ${survivor.contractIds[0] ?? "replace-with-contract-id"}`,
    artifacts: survivor.artifacts.length ? survivor.artifacts : [".visual-hive/mutation-report.json"],
    trustedOnly: false,
    applyMode: "advisory_no_write"
  }));
}

function recommendationsFromHandoff(items: HandoffWorkItem[]): TestCreationRecommendationDraft[] {
  return items
    .filter((item) => item.kind === "test_creation")
    .map((item) => ({
      id: safeId(`handoff-${item.id}`),
      source: "handoff_work_item",
      kind: kindFromHandoff(item),
      priority: item.priority === "critical" ? "high" : item.priority,
      title: item.title,
      rationale: [item.summary],
      handoffWorkItemId: item.id,
      suggestedTests: item.suggestedNextSteps,
      artifacts: item.artifacts.length ? item.artifacts : [".visual-hive/handoff.json"],
      trustedOnly: false,
      applyMode: "advisory_no_write"
    }));
}

function kindForLayer(layerId: number): TestCreationKind {
  if (layerId === 2) return "unit_test";
  if (layerId === 3) return "accessibility_check";
  if (layerId === 4) return "api_contract";
  if (layerId === 5) return "screenshot";
  if (layerId === 6) return "flow";
  if (layerId === 9) return "mutation_mapping";
  return "selector_assertion";
}

function kindForCoverage(recommendation: CoverageImprovementRecommendation): TestCreationKind {
  if (recommendation.kind === "add_screenshot") return "screenshot";
  if (recommendation.kind === "add_flow_steps") return "flow";
  if (recommendation.kind === "map_mutation_operator") return "mutation_mapping";
  if (recommendation.kind === "add_changed_file_rule") return "workflow_setup";
  return "selector_assertion";
}

function kindFromHandoff(item: HandoffWorkItem): TestCreationKind {
  if (item.id.includes("mutation") || item.evidenceKeys.some((key) => key.includes("mutation"))) return "mutation_mapping";
  if (item.id.includes("accessibility") || item.title.toLowerCase().includes("accessibility")) return "accessibility_check";
  if (item.id.includes("api") || item.title.toLowerCase().includes("api")) return "api_contract";
  if (item.id.includes("visual") || item.title.toLowerCase().includes("visual")) return "screenshot";
  return "selector_assertion";
}

function titleForKind(kind: TestCreationKind): string {
  if (kind === "unit_test") return "Add unit test evidence";
  if (kind === "accessibility_check") return "Add accessibility evidence";
  if (kind === "api_contract") return "Add API contract evidence";
  if (kind === "screenshot") return "Add visual screenshot evidence";
  if (kind === "flow") return "Add user-flow evidence";
  if (kind === "mutation_mapping") return "Add mutation adequacy evidence";
  return "Add deterministic assertion evidence";
}

function testsForLayer(layer: EvidencePacketTestingLayer): string[] {
  if (layer.id === 2) return ["Add or expose unit test scripts for non-visual logic.", "Run unit tests before Visual Hive handoff."];
  if (layer.id === 3) return ["Add accessibility checks for critical route shells.", "Verify labels, roles, contrast, and focus behavior with deterministic tooling."];
  if (layer.id === 4) return ["Add API/data assertions for loading, error, empty, and success states.", "Connect API failures to user-visible contract failures."];
  if (layer.id === 5) return ["Add stable component or route screenshots with masks for dynamic regions.", "Review baselines before enforcing CI."];
  if (layer.id === 6) return ["Add user-flow steps for important navigation or state changes.", "Use stable data-testid selectors and no real credentials."];
  if (layer.id === 9) return ["Run visual-hive mutate.", "Map survived operators to contracts and strengthen assertions until killed."];
  return ["Add deterministic evidence for this layer."];
}

function configSnippetForLayer(layer: EvidencePacketTestingLayer): string | undefined {
  if (layer.id === 3) {
    return "contracts:\n  - id: accessibility-critical-route\n    selectors:\n      mustExist:\n        - \"[data-testid='replace-with-accessible-route-shell']\"";
  }
  if (layer.id === 4) {
    return "contracts:\n  - id: api-data-contract\n    selectors:\n      mustExist:\n        - \"[data-testid='replace-with-api-data-area']\"";
  }
  if (layer.id === 5 || layer.id === 6) {
    return "screenshots:\n  - name: replace-with-stable-state\n    route: \"/\"\n    viewport: desktop";
  }
  if (layer.id === 9) {
    return "mutation:\n  enabled: true\n  operators:\n    - force-login-on-demo";
  }
  return undefined;
}

function testsForMutationOperator(operator: string): string[] {
  if (operator === "force-login-on-demo") return ["Assert login page and OAuth controls are absent from public demo targets."];
  if (operator === "hide-critical-button") return ["Assert the critical action button exists and is usable."];
  if (operator === "remove-demo-badge") return ["Assert demo badges render on demo cards."];
  if (operator === "api-500") return ["Assert API-backed error state does not replace the expected dashboard state."];
  if (operator === "empty-data") return ["Assert API-backed data is not empty when seeded demo data should render."];
  if (operator === "mobile-overflow") return ["Add mobile screenshots or overflow assertions for responsive layouts."];
  return [`Add selector, screenshot, or flow assertions that fail when ${operator} is injected.`];
}

function enrichRecommendation(recommendation: TestCreationRecommendationDraft): TestCreationRecommendation {
  const affected = affectedForRecommendation(recommendation);
  return {
    ...recommendation,
    gapId: gapIdForRecommendation(recommendation),
    affected,
    currentEvidence: currentEvidenceForRecommendation(recommendation),
    suggestedContract: suggestedContractForRecommendation(recommendation, affected),
    suggestedMutation: suggestedMutationForRecommendation(recommendation),
    validationCommand: validationCommandForRecommendation(recommendation),
    hiveOwner: hiveOwnerForRecommendation(recommendation)
  };
}

function gapIdForRecommendation(recommendation: TestCreationRecommendationDraft): string {
  if (recommendation.coverageRecommendationId) return recommendation.coverageRecommendationId;
  if (recommendation.handoffWorkItemId) return recommendation.handoffWorkItemId;
  if (recommendation.mutationOperator) return `mutation:${recommendation.mutationOperator}`;
  if (recommendation.layer) return `testing-layer:${recommendation.layer.id}:${recommendation.layer.status}`;
  return recommendation.id;
}

function affectedForRecommendation(recommendation: TestCreationRecommendationDraft): TestCreationRecommendation["affected"] {
  const text = [recommendation.id, recommendation.title, recommendation.contractId, recommendation.mutationOperator, recommendation.kind]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const affected: TestCreationRecommendation["affected"] = {};

  if (text.includes("mobile")) affected.viewport = "mobile";
  else if (recommendation.kind === "screenshot") affected.viewport = "desktop";

  if (text.includes("login") || text.includes("oauth") || text.includes("auth")) {
    affected.route = "/";
    affected.component = "auth-boundary";
    affected.state = "public-demo";
  } else if (text.includes("api") || text.includes("data") || recommendation.kind === "api_contract") {
    affected.route = "/";
    affected.component = "api-backed-data-area";
    affected.state = "success-error-empty";
  } else if (text.includes("cluster")) {
    affected.route = "/clusters";
    affected.component = "clusters-page";
  } else if (text.includes("settings")) {
    affected.route = "/settings";
    affected.component = "settings-page";
  } else if (text.includes("dashboard") || recommendation.contractId === "dashboard") {
    affected.route = "/";
    affected.component = "dashboard-shell";
  } else if (recommendation.layer?.id === 9 || recommendation.kind === "mutation_mapping") {
    affected.route = "/";
    affected.component = "contract-under-mutation";
    affected.state = "mutated";
  } else {
    affected.route = "/";
    affected.component = "critical-route-shell";
  }

  return affected;
}

function currentEvidenceForRecommendation(recommendation: TestCreationRecommendationDraft): string[] {
  return [
    ...recommendation.rationale,
    ...(recommendation.artifacts.length
      ? recommendation.artifacts.map((artifact) => `Artifact: ${artifact}`)
      : ["Artifact: .visual-hive/evidence-packet.json"])
  ];
}

function suggestedContractForRecommendation(
  recommendation: TestCreationRecommendationDraft,
  affected: TestCreationRecommendation["affected"]
): TestCreationRecommendation["suggestedContract"] {
  const mutation = recommendation.mutationOperator;
  if (mutation === "force-login-on-demo") {
    return {
      id: recommendation.contractId ?? "public-demo-never-login",
      description: "Public/demo target should render the dashboard and never expose login controls.",
      targetId: recommendation.targetId,
      route: affected.route ?? "/",
      selectors: ["[data-testid='dashboard-page']", "not:[data-testid='login-page']", "not:[data-testid='github-login-button']"]
    };
  }
  if (mutation === "hide-critical-button") {
    return {
      id: recommendation.contractId ?? "critical-action-visible",
      description: "Critical user action remains visible and actionable.",
      targetId: recommendation.targetId,
      route: affected.route ?? "/",
      selectors: ["[data-testid='critical-action-button']"]
    };
  }
  if (mutation === "remove-demo-badge") {
    return {
      id: recommendation.contractId ?? "demo-badges-render",
      description: "Demo cards keep visible demo badges.",
      targetId: recommendation.targetId,
      route: affected.route ?? "/",
      selectors: ["[data-testid='demo-badge']"]
    };
  }
  if (mutation === "api-500" || mutation === "empty-data" || recommendation.kind === "api_contract") {
    return {
      id: recommendation.contractId ?? "api-backed-data-contract",
      description: "API-backed data area renders expected success/error/empty state evidence.",
      targetId: recommendation.targetId,
      route: affected.route ?? "/",
      selectors: ["[data-testid='api-data-area']", "[data-testid='dashboard-page']"]
    };
  }
  if (mutation === "mobile-overflow" || affected.viewport === "mobile") {
    return {
      id: recommendation.contractId ?? "mobile-layout-stability",
      description: "Mobile viewport should not regress layout or overflow critical content.",
      targetId: recommendation.targetId,
      route: affected.route ?? "/",
      viewport: "mobile",
      selectors: ["[data-testid='dashboard-page']"]
    };
  }

  return {
    id: recommendation.contractId ?? safeId(`suggested-${recommendation.kind}-${affected.component ?? "route"}`),
    description: recommendation.title,
    targetId: recommendation.targetId,
    route: affected.route ?? "/",
    viewport: affected.viewport,
    selectors: selectorsForKind(recommendation.kind)
  };
}

function selectorsForKind(kind: TestCreationKind): string[] {
  if (kind === "accessibility_check") return ["[data-testid='dashboard-page']", "[role='main']"];
  if (kind === "api_contract") return ["[data-testid='api-data-area']"];
  if (kind === "flow") return ["[data-testid='dashboard-page']", "[data-testid='critical-action-button']"];
  return ["[data-testid='dashboard-page']"];
}

function suggestedMutationForRecommendation(recommendation: TestCreationRecommendationDraft): string {
  if (recommendation.mutationOperator) return recommendation.mutationOperator;
  if (recommendation.kind === "api_contract") return "api-500";
  if (recommendation.kind === "flow") return "hide-critical-button";
  if (recommendation.kind === "screenshot") return "mobile-overflow";
  if (recommendation.kind === "mutation_mapping") return "force-login-on-demo";
  const title = recommendation.title.toLowerCase();
  if (title.includes("login") || title.includes("auth")) return "force-login-on-demo";
  return "not_applicable";
}

function validationCommandForRecommendation(recommendation: TestCreationRecommendationDraft): string {
  if (recommendation.kind === "mutation_mapping" || recommendation.mutationOperator) {
    return "visual-hive mutate --config visual-hive.config.yaml --enforce-min-score";
  }
  if (recommendation.kind === "workflow_setup") {
    return "visual-hive doctor --config visual-hive.config.yaml && visual-hive plan --config visual-hive.config.yaml --mode pr";
  }
  if (recommendation.trustedOnly) {
    return "visual-hive plan --config visual-hive.config.yaml --mode schedule && visual-hive run --config visual-hive.config.yaml --ci";
  }
  return "visual-hive plan --config visual-hive.config.yaml --mode pr && visual-hive run --config visual-hive.config.yaml --ci";
}

function hiveOwnerForRecommendation(recommendation: TestCreationRecommendationDraft): TestCreationRecommendation["hiveOwner"] {
  if (recommendation.kind === "workflow_setup" || recommendation.kind === "history_review" || recommendation.kind === "provider_review") return "ci-maintainer";
  if (recommendation.kind === "mutation_mapping" || recommendation.source === "mutation_survivor") return "quality";
  return "tester";
}

function formatAffected(affected: TestCreationRecommendation["affected"]): string {
  const parts = [
    affected.route ? `route=${affected.route}` : undefined,
    affected.component ? `component=${affected.component}` : undefined,
    affected.viewport ? `viewport=${affected.viewport}` : undefined,
    affected.state ? `state=${affected.state}` : undefined
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "route/component to be determined";
}

function summarize(recommendations: TestCreationRecommendation[]): TestCreationPlan["summary"] {
  const count = (priority: TestCreationPriority) => recommendations.filter((recommendation) => recommendation.priority === priority).length;
  const sourceCount = (source: TestCreationRecommendation["source"]) => recommendations.filter((recommendation) => recommendation.source === source).length;
  return {
    total: recommendations.length,
    high: count("high"),
    medium: count("medium"),
    low: count("low"),
    fromTestingLayers: sourceCount("testing_layer"),
    fromCoverageRecommendations: sourceCount("coverage_recommendation"),
    fromMutationSurvivors: sourceCount("mutation_survivor"),
    fromHandoffWorkItems: sourceCount("handoff_work_item")
  };
}

function dedupeRecommendations(recommendations: TestCreationRecommendationDraft[]): TestCreationRecommendationDraft[] {
  const seen = new Set<string>();
  return recommendations
    .sort((left, right) => priorityRank(right.priority) - priorityRank(left.priority) || left.id.localeCompare(right.id))
    .filter((recommendation) => {
      const key = [recommendation.kind, recommendation.contractId, recommendation.mutationOperator, recommendation.layer?.id, recommendation.title].join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 40);
}

function priorityRank(priority: TestCreationPriority): number {
  return { low: 1, medium: 2, high: 3 }[priority];
}

function safeId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function resolve(rootDir: string, artifactPath: string): string {
  return path.isAbsolute(artifactPath) ? artifactPath : path.resolve(rootDir, artifactPath);
}

function normalizeArtifactPath(value: string | undefined): string | undefined {
  return value?.replaceAll("\\", "/");
}

function catalogedOutputResource(resourceId: string, artifactPath: string): TestCreationPlanOutputResource {
  const resource = getEvidenceResourceById(resourceId);
  return {
    artifactPath,
    evidenceResourceId: resource?.id ?? resourceId,
    evidenceResourceUri: resource?.uri ?? `visual-hive://${resourceId}`,
    evidenceResourceTitle: resource?.title ?? resourceId,
    evidenceResourceDescription: resource?.description ?? "Visual Hive evidence artifact.",
    evidenceReadToolName: resource?.readTool?.name
  };
}

async function readOptional<T>(filePath: string): Promise<T | undefined> {
  try {
    return sanitizeValue(await readJson<T>(filePath)) as T;
  } catch {
    return undefined;
  }
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === "string") return sanitizeText(value);
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeValue(item)]));
  }
  return value;
}
