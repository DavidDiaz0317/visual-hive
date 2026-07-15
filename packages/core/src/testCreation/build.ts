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
  ]).map((recommendation) => enrichRecommendation(recommendation, options));

  const plan: TestCreationPlan = {
    schemaVersion: "visual-hive.test-creation-plan.v2",
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
            `  - Grounding: ${recommendation.grounding.status}`,
            ...(recommendation.grounding.unresolvedReasons.length
              ? recommendation.grounding.unresolvedReasons.map((reason) => `  - Unresolved: ${reason}`)
              : []),
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
    .map((layer) => layer.id === 2 ? {
      ...layer,
      gaps: layer.gaps.filter((gap) => !/^Advisory-only:/iu.test(gap) && / unit runner .+ has no matching executable unit test file\.$/u.test(gap))
    } : layer)
    .filter((layer) => layer.id !== 2 || (layer.gaps.length > 0 && layer.gaps.every((gap) => / unit runner .+ has no matching executable unit test file\.$/u.test(gap))))
    .map((layer) => recommendationForLayer(layer));
}

function recommendationForLayer(layer: EvidencePacketTestingLayer): TestCreationRecommendationDraft {
  const kind = kindForLayer(layer.id);
  const priority = layer.status === "missing"
    ? "high"
    : layer.status === "unknown" || (layer.id === 2 && layer.status === "partial")
      ? "medium"
      : "low";
  return {
    id: safeId(`layer-${layer.id}-${layer.status}`),
    source: "testing_layer",
    kind,
    priority,
    title: `${titleForKind(kind)} for ${layer.name}`,
    rationale: layer.gaps.length ? layer.gaps : [`Layer ${layer.id} (${layer.name}) is ${layer.status}.`],
    layer: { id: layer.id, name: layer.name, status: layer.status },
    suggestedTests: testsForLayer(layer),
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
    artifacts: [".visual-hive/coverage-recommendations.json"],
    trustedOnly: Boolean(recommendation.trustedOnly),
    applyMode: "advisory_no_write"
  }));
}

function recommendationsFromMutationSurvivors(
  survivors: Array<{ operator: string; contractIds: string[]; failedAssertion?: string; artifacts: string[] }>
): TestCreationRecommendationDraft[] {
  return survivors.flatMap((survivor) => (survivor.contractIds.length ? survivor.contractIds : [undefined]).map((contractId) => ({
      id: safeId(`mutation-${survivor.operator}-${contractId ?? "unmapped"}`),
      source: "mutation_survivor" as const,
      kind: "mutation_mapping" as const,
      priority: "high" as const,
      title: `Create or strengthen tests for survived mutation ${survivor.operator}`,
      rationale: [
        `Mutation ${survivor.operator} survived deterministic adequacy checks.`,
        ...(survivor.failedAssertion ? [survivor.failedAssertion] : [])
      ],
      ...(contractId ? { contractId } : {}),
      mutationOperator: survivor.operator,
      suggestedTests: ["Strengthen deterministic coverage for the observed mutation survivor using only exact configured or repository-map evidence."],
      artifacts: survivor.artifacts.length ? survivor.artifacts : [".visual-hive/mutation-report.json"],
      trustedOnly: false,
      applyMode: "advisory_no_write" as const
    })));
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
  if (layer.id === 2) return ["Map the layer gap to an exact repository test runner or source scope before authoring unit coverage."];
  if (layer.id === 9) return ["Map the layer gap to an observed mutation operator and exact configured contract before strengthening coverage."];
  return ["Map the layer gap to an exact configured contract or repository-map node before authoring deterministic coverage."];
}

interface GroundedRecommendationFacts {
  status: "grounded" | "unresolved";
  evidence: string[];
  unresolvedReasons: string[];
  contractId?: string;
  description: string;
  targetId?: string;
  routes: string[];
  viewports: string[];
  selectors: string[];
  mustNotExistSelectors: string[];
  textMustExist: string[];
  textMustNotExist: string[];
  maskSelectors: string[];
  components: string[];
  states: string[];
  configMappedMutation?: string;
}

function enrichRecommendation(
  recommendation: TestCreationRecommendationDraft,
  options: Pick<BuildTestCreationPlanOptions, "config" | "repoMap">
): TestCreationRecommendation {
  const facts = groundRecommendation(recommendation, options);
  const affected = facts.status === "grounded"
    ? compactAffected({
        route: facts.routes[0],
        component: facts.components[0],
        viewport: facts.viewports[0],
        state: facts.states[0]
      })
    : {};
  const suggestedMutation = recommendation.mutationOperator ?? facts.configMappedMutation ?? "not_applicable";
  return {
    ...recommendation,
    gapId: gapIdForRecommendation(recommendation),
    affected,
    currentEvidence: currentEvidenceForRecommendation(recommendation),
    grounding: {
      status: facts.status,
      evidence: facts.evidence,
      unresolvedReasons: facts.unresolvedReasons
    },
    suggestedContract: compactSuggestedContract({
      id: facts.contractId ?? recommendation.contractId ?? recommendation.id,
      description: facts.description,
      targetId: facts.status === "grounded" ? facts.targetId : undefined,
      route: facts.status === "grounded" ? facts.routes[0] : undefined,
      viewport: facts.status === "grounded" ? facts.viewports[0] : undefined,
      selectors: facts.status === "grounded" ? facts.selectors : [],
      mustNotExistSelectors: facts.status === "grounded" ? facts.mustNotExistSelectors : [],
      textMustExist: facts.status === "grounded" ? facts.textMustExist : [],
      textMustNotExist: facts.status === "grounded" ? facts.textMustNotExist : [],
      maskSelectors: facts.status === "grounded" ? facts.maskSelectors : []
    }),
    suggestedMutation,
    suggestedTests: groundedTestGuidance(recommendation, facts, suggestedMutation),
    validationCommand: validationCommandForRecommendation(recommendation),
    hiveOwner: hiveOwnerForRecommendation(recommendation)
  };
}

function groundRecommendation(
  recommendation: TestCreationRecommendationDraft,
  options: Pick<BuildTestCreationPlanOptions, "config" | "repoMap">
): GroundedRecommendationFacts {
  const evidence: string[] = [];
  const unresolvedReasons: string[] = [];
  const configuredMappings: Array<{ id: string; contracts: string[] }> = (options.config?.mutation.operators ?? [])
    .flatMap((operator) => typeof operator === "string" ? [] : [{ id: operator.id, contracts: operator.contracts }])
    .filter((operator) => !recommendation.mutationOperator || operator.id === recommendation.mutationOperator);
  const mappedContractIds = sortedUnique(configuredMappings.flatMap((operator) => operator.contracts));
  const contractId = recommendation.contractId ?? (mappedContractIds.length === 1 ? mappedContractIds[0] : undefined);
  const configContract = contractId ? options.config?.contracts.find((contract) => contract.id === contractId) : undefined;
  const repoNodes = contractId
    ? groundingRepoNodes(options.repoMap).filter((node) => node.status === "active" && (node.id === contractId || node.contractIds.includes(contractId)))
    : [];
  const grounded = Boolean(configContract || repoNodes.length > 0);

  if (configContract) evidence.push(`config.contract:${configContract.id}`);
  for (const node of repoNodes) evidence.push(`repoMap.node:${node.id}`);
  if (!contractId) {
    unresolvedReasons.push("No exact contract identifier is present in the recommendation or an unambiguous configured mutation mapping.");
  } else if (!grounded) {
    unresolvedReasons.push(`Contract ${contractId} is not present in the loaded Visual Hive config or repository map.`);
  }

  const targetIds = sortedUnique([
    ...(configContract ? [configContract.target] : []),
    ...(recommendation.targetId && options.config?.targets[recommendation.targetId] ? [recommendation.targetId] : []),
    ...repoNodes.flatMap((node) => node.targetIds)
  ]);
  const routes = sortedUnique([
    ...(configContract?.screenshots.map((screenshot) => screenshot.route) ?? []),
    ...(configContract?.steps.filter((step) => step.action === "goto").flatMap((step) => step.route ? [step.route] : []) ?? []),
    ...repoNodes.flatMap((node) => node.routes)
  ]);
  const viewports = sortedUnique([
    ...(configContract?.screenshots.map((screenshot) => screenshot.viewport) ?? []),
    ...repoNodes.flatMap((node) => node.viewports)
  ]);
  const selectors = sortedUnique([
    ...(configContract ? [
      ...configContract.selectors.mustExist,
      ...configContract.waitFor.map((wait) => wait.selector),
      ...configContract.steps.flatMap((step) => step.selector ? [step.selector] : [])
    ] : []),
    ...repoNodes.flatMap((node) => node.selectors)
  ]);
  const mustNotExistSelectors = sortedUnique(configContract?.selectors.mustNotExist ?? []);
  const textMustExist = sortedUnique(configContract?.selectors.textMustExist ?? []);
  const textMustNotExist = sortedUnique(configContract?.selectors.textMustNotExist ?? []);
  const maskSelectors = sortedUnique(configContract?.screenshots.flatMap((screenshot) => screenshot.mask) ?? []);
  const components = sortedUnique(repoNodes.filter((node) => node.kind === "component").map((node) => node.id));
  const states = sortedUnique(repoNodes.flatMap((node) => node.states));
  if (grounded) {
    for (const targetId of targetIds) evidence.push(`config-or-repo.target:${targetId}`);
    for (const route of routes) evidence.push(`config-or-repo.route:${route}`);
    for (const viewport of viewports) evidence.push(`config-or-repo.viewport:${viewport}`);
    for (const selector of selectors) evidence.push(`config-or-repo.selector:${selector}`);
    for (const selector of mustNotExistSelectors) evidence.push(`config.selector.mustNotExist:${selector}`);
    for (const text of textMustExist) evidence.push(`config.text.mustExist:${text}`);
    for (const text of textMustNotExist) evidence.push(`config.text.mustNotExist:${text}`);
    for (const selector of maskSelectors) evidence.push(`config.screenshot.mask:${selector}`);
  }

  const configMappedMutation = contractId
    ? configuredMappings.find((operator) => operator.contracts.includes(contractId))
    : undefined;
  if (configMappedMutation) evidence.push(`config.mutation:${configMappedMutation.id}->${contractId}`);

  return {
    status: grounded ? "grounded" : "unresolved",
    evidence: sortedUnique(evidence).slice(0, 128),
    unresolvedReasons: grounded ? [] : unresolvedReasons,
    contractId,
    description: configContract?.description ?? recommendation.title,
    targetId: targetIds[0],
    routes,
    viewports,
    selectors,
    mustNotExistSelectors,
    textMustExist,
    textMustNotExist,
    maskSelectors,
    components,
    states,
    configMappedMutation: configMappedMutation?.id
  };
}

function compactAffected(affected: TestCreationRecommendation["affected"]): TestCreationRecommendation["affected"] {
  return Object.fromEntries(Object.entries(affected).filter(([, value]) => value !== undefined)) as TestCreationRecommendation["affected"];
}

function compactSuggestedContract(contract: TestCreationRecommendation["suggestedContract"]): TestCreationRecommendation["suggestedContract"] {
  return Object.fromEntries(Object.entries(contract).filter(([, value]) => value !== undefined)) as TestCreationRecommendation["suggestedContract"];
}

function groundedTestGuidance(
  recommendation: TestCreationRecommendationDraft,
  facts: GroundedRecommendationFacts,
  suggestedMutation: string
): string[] {
  if (facts.status === "unresolved" || !facts.contractId) {
    return ["Resolve this gap to an exact configured contract or repository-map node before authoring a test."];
  }
  return [
    `Add deterministic ${recommendation.kind.replaceAll("_", " ")} coverage for the observed contract ${facts.contractId}.`,
    ...(facts.routes[0] ? [`Exercise the observed route ${facts.routes[0]}.`] : []),
    ...(facts.selectors.length ? [`Use only observed positive or interaction selectors: ${facts.selectors.join(", ")}.`] : []),
    ...(facts.mustNotExistSelectors.length ? [`Preserve negative selector assertions: ${facts.mustNotExistSelectors.join(", ")}.`] : []),
    ...(facts.textMustExist.length ? [`Preserve required text assertions: ${facts.textMustExist.join(", ")}.`] : []),
    ...(facts.textMustNotExist.length ? [`Preserve forbidden text assertions: ${facts.textMustNotExist.join(", ")}.`] : []),
    ...(facts.maskSelectors.length ? [`Treat screenshot masks as masks, not assertion targets: ${facts.maskSelectors.join(", ")}.`] : []),
    ...(suggestedMutation !== "not_applicable" ? [`Verify the observed or configured mutation ${suggestedMutation}.`] : [])
  ];
}

function gapIdForRecommendation(recommendation: TestCreationRecommendationDraft): string {
  if (recommendation.coverageRecommendationId) return recommendation.coverageRecommendationId;
  if (recommendation.handoffWorkItemId) return recommendation.handoffWorkItemId;
  if (recommendation.mutationOperator) return `mutation:${recommendation.mutationOperator}`;
  if (recommendation.layer) return `testing-layer:${recommendation.layer.id}:${recommendation.layer.status}`;
  return recommendation.id;
}

function currentEvidenceForRecommendation(recommendation: TestCreationRecommendationDraft): string[] {
  return [
    ...recommendation.rationale,
    ...(recommendation.artifacts.length
      ? recommendation.artifacts.map((artifact) => `Artifact: ${artifact}`)
      : ["Artifact: .visual-hive/evidence-packet.json"])
  ];
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

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function groundingRepoNodes(repoMap: BuildTestCreationPlanOptions["repoMap"]): NonNullable<BuildTestCreationPlanOptions["repoMap"]>["visualMap"]["nodes"] {
  const visualMap = repoMap && typeof repoMap === "object" ? (repoMap as { visualMap?: unknown }).visualMap : undefined;
  if (!visualMap || typeof visualMap !== "object" || !Array.isArray((visualMap as { nodes?: unknown }).nodes)) return [];
  return (visualMap as { nodes: NonNullable<BuildTestCreationPlanOptions["repoMap"]>["visualMap"]["nodes"] }).nodes.filter((node) =>
    node && typeof node === "object" && typeof node.id === "string" && typeof node.status === "string" && Array.isArray(node.contractIds) &&
    Array.isArray(node.targetIds) && Array.isArray(node.routes) && Array.isArray(node.viewports) && Array.isArray(node.selectors) && Array.isArray(node.states)
  );
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
