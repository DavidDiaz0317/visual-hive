import path from "node:path";
import { writeJson, writeText } from "../utils/files.js";
import { sanitizeText } from "../utils/sanitize.js";
import type { HandoffMode, HandoffPacket, HandoffPriority, HandoffWorkItem } from "../handoff/types.js";
import type { EvidenceContribution, EvidencePacket } from "../evidence/types.js";
import type {
  BuildHiveExportOptions,
  BuildHiveModeComparisonOptions,
  HiveAgentPolicy,
  HiveAutomationMode,
  HiveBead,
  HiveBeadActor,
  HiveBeadType,
  HiveConfiguredMode,
  HiveExportArtifacts,
  HiveExportBundle,
  HiveExportConfig,
  HiveModeComparison,
  HiveModeComparisonEntry,
  HiveGraphEdge,
  HiveGraphNode,
  HiveKnowledgeFact,
  HiveKnowledgeGraph,
  HiveRepairWorkOrder,
  HiveSourceContext,
  HiveWorkSource,
  WriteHiveExportOptions,
  WriteHiveExportResult,
  WriteHiveModeComparisonOptions,
  WriteHiveModeComparisonResult
} from "./types.js";

const DEFAULT_OUTPUT_DIR = ".visual-hive/hive";
const DEFAULT_MODE_COMPARISON_MODES: HiveAutomationMode[] = ["advisory", "measured", "repair_request", "guarded_repair", "full"];
const DEFAULT_LABELS = ["visual-hive", "hive/quality", "ai-ready"];
const DEFAULT_CONFIG: HiveExportConfig = {
  enabled: false,
  mode: "advisory",
  acmmLevel: 3,
  defaultActor: "quality",
  labels: DEFAULT_LABELS,
  export: {
    beads: true,
    knowledgeFacts: true,
    knowledgeGraph: true,
    wikiVault: true,
    repairWorkOrders: true,
    maxFacts: 50
  },
  repair: {
    enabled: false,
    prOnly: true,
    maxAttempts: 1,
    requireHumanReview: true,
    rerunVisualHive: true,
    branchPrefix: "hive/visual-hive-"
  }
};

export function normalizeHiveAutomationMode(mode?: string): HiveAutomationMode {
  if (mode === "measured" || mode === "repair_request" || mode === "guarded_repair" || mode === "full" || mode === "advisory") {
    return mode;
  }
  if (mode === "github_issue" || mode === "bead_api") return "measured";
  return "advisory";
}

export function handoffModeFromHiveMode(mode?: string): HandoffMode {
  if (mode === "github_issue" || mode === "bead_api" || mode === "dry_run") return mode;
  return "dry_run";
}

export function normalizeHiveExportConfig(input?: BuildHiveExportOptions["hiveConfig"]): HiveExportConfig {
  const raw = (input ?? {}) as Partial<HiveExportConfig> & {
    mode?: HiveConfiguredMode;
    labels?: string[];
  };
  return sanitizeValue({
    ...DEFAULT_CONFIG,
    enabled: raw.enabled ?? DEFAULT_CONFIG.enabled,
    mode: raw.mode ?? DEFAULT_CONFIG.mode,
    acmmLevel: raw.acmmLevel ?? DEFAULT_CONFIG.acmmLevel,
    defaultActor: raw.defaultActor ?? DEFAULT_CONFIG.defaultActor,
    labels: dedupe([...(raw.labels?.length ? raw.labels : DEFAULT_CONFIG.labels), ...DEFAULT_LABELS]),
    export: {
      ...DEFAULT_CONFIG.export,
      ...(raw.export ?? {})
    },
    repair: {
      ...DEFAULT_CONFIG.repair,
      ...(raw.repair ?? {})
    }
  }) as HiveExportConfig;
}

export function buildHiveExportArtifacts(options: BuildHiveExportOptions): HiveExportArtifacts {
  const generatedAt = (options.now ?? new Date()).toISOString();
  const config = normalizeHiveExportConfig(options.hiveConfig);
  const mode = normalizeHiveAutomationMode(config.mode);
  const outputDir = normalizePath(options.outputDir ?? DEFAULT_OUTPUT_DIR);
  const paths = outputPaths(outputDir);
  const context: HiveSourceContext = {
    evidence: sanitizeValue(options.evidencePacket) as EvidencePacket,
    handoff: options.handoffPacket ? (sanitizeValue(options.handoffPacket) as HandoffPacket) : undefined,
    config,
    mode,
    generatedAt
  };
  const workSources = buildWorkSources(context.evidence, context.handoff);
  const beads = shouldEmitMeasuredArtifacts(mode) && config.export.beads ? buildBeads(context, workSources) : [];
  const knowledgeFacts =
    shouldEmitMeasuredArtifacts(mode) && config.export.knowledgeFacts ? buildKnowledgeFacts(context, workSources, config.export.maxFacts) : [];
  const repairWorkOrders = shouldEmitRepairArtifacts(mode, config) && config.export.repairWorkOrders ? buildRepairWorkOrders(context, workSources, beads) : [];
  const knowledgeGraph =
    shouldEmitMeasuredArtifacts(mode) && config.export.knowledgeGraph
      ? buildKnowledgeGraph(context, beads, knowledgeFacts, repairWorkOrders)
      : emptyGraph();
  const agentPolicy = buildAgentPolicy(context);
  const blockedReasons = blockedReasonsFor(context);
  const bundle: HiveExportBundle = sanitizeValue({
    schemaVersion: "visual-hive.hive-export.v1",
    generatedAt,
    project: context.evidence.project,
    status: blockedReasons.length ? "blocked" : "ready",
    externalCallsMade: 0,
    mode,
    configuredMode: config.mode,
    acmmLevel: config.acmmLevel,
    sourceArtifacts: {
      evidencePacket: normalizePath(options.evidencePacketPath),
      handoffPacket: options.handoffPacketPath ? normalizePath(options.handoffPacketPath) : undefined
    },
    outputArtifacts: paths,
    governance: {
      verdictAuthority: "visual_hive",
      defaultMode: "advisory_no_network",
      repairAuthority: "hive_may_open_pr_only_when_trusted_policy_allows",
      validationRequired: "visual_hive_must_rerun_after_repair",
      secretPolicy: "redacted_values_names_only"
    },
    summary: {
      beads: beads.length,
      knowledgeFacts: knowledgeFacts.length,
      graphNodes: knowledgeGraph.nodes.length,
      graphEdges: knowledgeGraph.edges.length,
      repairWorkOrders: repairWorkOrders.length,
      blockedReasons: blockedReasons.length
    },
    labels: config.labels,
    beads,
    knowledgeFacts,
    knowledgeGraph,
    repairWorkOrders,
    agentPolicy,
    blockedReasons
  }) as HiveExportBundle;

  const issueContext = renderHiveIssueContext(bundle, context, workSources);
  const wikiPages = config.export.wikiVault && knowledgeFacts.length ? knowledgeFacts.map((fact) => wikiPageFor(fact, paths.wikiVaultDir)) : [];
  return { bundle, issueContext, wikiPages };
}

export async function writeHiveExportArtifacts(options: WriteHiveExportOptions): Promise<WriteHiveExportResult> {
  const artifacts = buildHiveExportArtifacts(options);
  const rootDir = path.resolve(options.rootDir);
  const paths = artifacts.bundle.outputArtifacts;
  await writeJson(resolveArtifact(rootDir, paths.export), artifacts.bundle);
  await writeJson(resolveArtifact(rootDir, paths.beads), artifacts.bundle.beads);
  await writeJson(resolveArtifact(rootDir, paths.knowledgeFacts), artifacts.bundle.knowledgeFacts);
  await writeJson(resolveArtifact(rootDir, paths.knowledgeGraph), artifacts.bundle.knowledgeGraph);
  await writeJson(resolveArtifact(rootDir, paths.repairWorkOrders), artifacts.bundle.repairWorkOrders);
  await writeJson(resolveArtifact(rootDir, paths.agentPolicy), artifacts.bundle.agentPolicy);
  await writeText(resolveArtifact(rootDir, paths.issueContext), artifacts.issueContext);
  for (const page of artifacts.wikiPages) {
    await writeText(resolveArtifact(rootDir, page.path), page.content);
  }
  return { ...artifacts, paths };
}

export function renderHiveExportSummary(result: WriteHiveExportResult, format: "markdown" | "json" = "markdown"): string {
  if (format === "json") return JSON.stringify(result.bundle, null, 2);
  return [
    `Wrote ${result.paths.export}`,
    `Wrote ${result.paths.beads}`,
    `Wrote ${result.paths.knowledgeFacts}`,
    `Wrote ${result.paths.knowledgeGraph}`,
    `Wrote ${result.paths.issueContext}`,
    `Wrote ${result.paths.repairWorkOrders}`,
    `Wrote ${result.paths.agentPolicy}`,
    "",
    `# Hive Native Export: ${result.bundle.project}`,
    "",
    `- Status: ${result.bundle.status}`,
    `- Mode: ${result.bundle.mode}`,
    `- ACMM level: ${result.bundle.acmmLevel}`,
    `- External calls made: ${result.bundle.externalCallsMade}`,
    `- Beads: ${result.bundle.summary.beads}`,
    `- Knowledge facts: ${result.bundle.summary.knowledgeFacts}`,
    `- Graph: ${result.bundle.summary.graphNodes} nodes / ${result.bundle.summary.graphEdges} edges`,
    `- Repair work orders: ${result.bundle.summary.repairWorkOrders}`,
    ...(result.bundle.blockedReasons.length ? [`- Blocked reasons: ${result.bundle.blockedReasons.join("; ")}`] : [])
  ].join("\n");
}

export function buildHiveModeComparison(options: BuildHiveModeComparisonOptions): { comparison: HiveModeComparison; exports: HiveExportArtifacts[]; markdown: string } {
  const generatedAt = (options.now ?? new Date()).toISOString();
  const outputDir = normalizePath(options.outputDir ?? DEFAULT_OUTPUT_DIR);
  const modesDir = `${outputDir}/modes`;
  const modes = dedupeModes(options.modes?.length ? options.modes : DEFAULT_MODE_COMPARISON_MODES);
  const exports = modes.map((mode) =>
    buildHiveExportArtifacts({
      ...options,
      now: new Date(generatedAt),
      outputDir: `${modesDir}/${mode}`,
      hiveConfig: {
        ...(options.hiveConfig ?? {}),
        mode
      }
    })
  );
  const entries = exports.map((artifact): HiveModeComparisonEntry => modeComparisonEntry(artifact.bundle));
  const recommendation = recommendHiveMode(entries, outputDir);
  const comparison: HiveModeComparison = sanitizeValue({
    schemaVersion: "visual-hive.hive-mode-comparison.v1",
    generatedAt,
    project: options.evidencePacket.project,
    externalCallsMade: 0,
    sourceArtifacts: {
      evidencePacket: normalizePath(options.evidencePacketPath),
      handoffPacket: options.handoffPacketPath ? normalizePath(options.handoffPacketPath) : undefined
    },
    outputArtifacts: {
      comparison: `${outputDir}/mode-comparison.json`,
      markdown: `${outputDir}/mode-comparison.md`,
      modesDir
    },
    modes: entries,
    recommendation,
    governance: {
      verdictAuthority: "visual_hive",
      defaultMode: "advisory_no_network",
      repairAuthority: "hive_may_open_pr_only_when_trusted_policy_allows",
      validationRequired: "visual_hive_must_rerun_after_repair",
      secretPolicy: "redacted_values_names_only"
    }
  }) as HiveModeComparison;
  return { comparison, exports, markdown: renderHiveModeComparisonMarkdown(comparison) };
}

export async function writeHiveModeComparison(options: WriteHiveModeComparisonOptions): Promise<WriteHiveModeComparisonResult> {
  const rootDir = path.resolve(options.rootDir);
  const comparisonArtifacts = buildHiveModeComparison(options);
  const writtenExports: WriteHiveExportResult[] = [];
  for (const artifact of comparisonArtifacts.exports) {
    writtenExports.push(
      await writeHiveExportArtifacts({
        ...options,
        now: new Date(comparisonArtifacts.comparison.generatedAt),
        outputDir: path.dirname(artifact.bundle.outputArtifacts.export),
        hiveConfig: {
          ...(options.hiveConfig ?? {}),
          mode: artifact.bundle.mode
        },
        rootDir
      })
    );
  }
  await writeJson(resolveArtifact(rootDir, comparisonArtifacts.comparison.outputArtifacts.comparison), comparisonArtifacts.comparison);
  await writeText(resolveArtifact(rootDir, comparisonArtifacts.comparison.outputArtifacts.markdown), comparisonArtifacts.markdown);
  return {
    comparison: comparisonArtifacts.comparison,
    exports: writtenExports,
    markdown: comparisonArtifacts.markdown,
    paths: comparisonArtifacts.comparison.outputArtifacts
  };
}

export function renderHiveModeComparisonSummary(result: WriteHiveModeComparisonResult, format: "markdown" | "json" = "markdown"): string {
  if (format === "json") return JSON.stringify(result.comparison, null, 2);
  return [
    `Wrote ${result.paths.comparison}`,
    `Wrote ${result.paths.markdown}`,
    "",
    renderHiveModeComparisonMarkdown(result.comparison)
  ].join("\n");
}

function modeComparisonEntry(bundle: HiveExportBundle): HiveModeComparisonEntry {
  return {
    mode: bundle.mode,
    status: bundle.status,
    outputDir: path.dirname(bundle.outputArtifacts.export).replaceAll("\\", "/"),
    exportPath: bundle.outputArtifacts.export,
    externalCallsMade: 0,
    summary: bundle.summary,
    blockedReasons: bundle.blockedReasons,
    emits: {
      issueContext: true,
      beads: bundle.summary.beads > 0,
      knowledgeFacts: bundle.summary.knowledgeFacts > 0,
      knowledgeGraph: bundle.summary.graphNodes > 0 || bundle.summary.graphEdges > 0,
      wikiVault: bundle.summary.knowledgeFacts > 0,
      repairWorkOrders: bundle.summary.repairWorkOrders > 0,
      agentPolicy: true
    },
    policy: {
      localPreviewAllowed: ["advisory", "measured", "repair_request"].includes(bundle.mode),
      trustedWorkflowRequired: bundle.mode === "guarded_repair" || bundle.mode === "full",
      verdictAuthority: "visual_hive",
      hiveAuthority: "advisory_or_guarded_repair"
    },
    recommendedUse: recommendedUseForMode(bundle.mode)
  };
}

function recommendHiveMode(entries: HiveModeComparisonEntry[], outputDir: string): HiveModeComparison["recommendation"] {
  const repair = entries.find((entry) => entry.mode === "repair_request" && entry.summary.repairWorkOrders > 0 && entry.status === "ready");
  if (repair) {
    return {
      mode: "repair_request",
      reason: "Deterministic evidence produced repair-ready work orders; use repair_request for a trusted Hive issue or repair lane.",
      nextCommand: `visual-hive hive export --dry-run --mode repair_request --output-dir ${outputDir}`
    };
  }
  const measured = entries.find((entry) => entry.mode === "measured" && (entry.summary.beads > 0 || entry.summary.knowledgeFacts > 0) && entry.status === "ready");
  if (measured) {
    return {
      mode: "measured",
      reason: "Evidence produced Hive Beads or knowledge facts but no guarded repair work orders; use measured mode for queueing and context.",
      nextCommand: `visual-hive hive export --dry-run --mode measured --output-dir ${outputDir}`
    };
  }
  return {
    mode: "advisory",
    reason: "No repair-ready or measured work was available; use advisory mode for issue context and policy documentation only.",
    nextCommand: `visual-hive hive export --dry-run --mode advisory --output-dir ${outputDir}`
  };
}

function recommendedUseForMode(mode: HiveAutomationMode): string {
  if (mode === "advisory") return "Use for the safest issue-context export when Hive should only summarize or route evidence.";
  if (mode === "measured") return "Use when Hive should receive Beads, facts, graph context, and wiki pages without repair authority.";
  if (mode === "repair_request") return "Use when deterministic evidence should become bounded repair work orders for a trusted PR-only lane.";
  if (mode === "guarded_repair") return "Use only in future trusted automation with branch isolation, human review policy, and rerun enforcement.";
  return "Reserved for future mature automation and blocked locally until governance is proven.";
}

function renderHiveModeComparisonMarkdown(comparison: HiveModeComparison): string {
  return sanitizeText(
    [
      `# Hive Export Mode Comparison: ${comparison.project}`,
      "",
      "- External calls made: 0",
      "- Verdict authority: Visual Hive",
      `- Recommended mode: ${comparison.recommendation.mode}`,
      `- Recommendation: ${comparison.recommendation.reason}`,
      `- Next command: \`${comparison.recommendation.nextCommand}\``,
      "",
      "| Mode | Status | Beads | Facts | Graph | Repair orders | Policy |",
      "| --- | --- | ---: | ---: | --- | ---: | --- |",
      ...comparison.modes.map((entry) =>
        [
          entry.mode,
          entry.status,
          String(entry.summary.beads),
          String(entry.summary.knowledgeFacts),
          `${entry.summary.graphNodes}/${entry.summary.graphEdges}`,
          String(entry.summary.repairWorkOrders),
          entry.policy.trustedWorkflowRequired ? "trusted workflow required" : "local dry-run preview"
        ].join(" | ")
      ).map((row) => `| ${row} |`),
      "",
      "## Guardrails",
      "",
      "- Visual Hive owns the deterministic verdict.",
      "- Hive exports are no-network by default.",
      "- Advisory, measured, and repair-request previews are local dry-run artifacts.",
      "- Guarded repair and full automation are visible policy states, but remain blocked until explicit trusted policy permits execution.",
      "- Secret values must never be copied into Hive artifacts."
    ].join("\n")
  ) + "\n";
}

function buildWorkSources(evidence: EvidencePacket, handoff?: HandoffPacket): HiveWorkSource[] {
  const workItems = handoff?.workItems.length ? handoff.workItems : fallbackWorkItems(evidence);
  return workItems.map((workItem) => ({
    workItem,
    contributions: evidence.evidenceContributions.filter((contribution) => workItem.evidenceKeys.includes(contribution.key))
  }));
}

function fallbackWorkItems(evidence: EvidencePacket): HandoffWorkItem[] {
  const actionable = evidence.evidenceContributions.filter((contribution) =>
    ["failed", "blocked"].includes(contribution.status) || contribution.kind === "mutation_survivor"
  );
  return actionable.slice(0, 12).map((contribution) => ({
    id: safeSlug(contribution.key),
    kind: contribution.kind === "mutation_survivor" || contribution.source === "mutation" ? "test_creation" : contribution.status === "blocked" ? "setup" : "repair",
    priority: contribution.status === "blocked" ? "critical" : contribution.gating ? "high" : "medium",
    title: titleForContribution(contribution),
    summary: contribution.reason,
    evidenceKeys: [contribution.key],
    artifacts: contribution.artifacts,
    suggestedNextSteps: suggestedStepsForContribution(contribution)
  }));
}

function buildBeads(context: HiveSourceContext, workSources: HiveWorkSource[]): HiveBead[] {
  return workSources.map(({ workItem, contributions }) => {
    const beadId = `vh-${stableHash(workItem.id).slice(0, 12)}`;
    const firstContribution = contributions[0];
    return {
      id: beadId,
      title: workItem.title,
      type: beadTypeFor(workItem),
      status: workItem.kind === "setup" ? "blocked" : "open",
      priority: beadPriorityFor(workItem.priority),
      actor: actorFor(workItem, context),
      external_ref: `visual-hive://${context.evidence.project}/${workItem.id}`,
      metadata: compactRecord({
        visual_hive_project: context.evidence.project,
        visual_hive_verdict: context.evidence.verdictSummary.visualHiveVerdict,
        visual_hive_work_item_id: workItem.id,
        visual_hive_work_item_kind: workItem.kind,
        visual_hive_source: firstContribution?.source,
        visual_hive_contract_id: firstContribution?.contractId,
        visual_hive_target_id: firstContribution?.targetId,
        visual_hive_operator: firstContribution?.operator,
        visual_hive_mode: context.mode,
        artifact_count: String(workItem.artifacts.length)
      }),
      notes: renderBeadNotes(workItem),
      created_at: context.generatedAt,
      updated_at: context.generatedAt,
      depends_on: []
    };
  });
}

function buildKnowledgeFacts(context: HiveSourceContext, workSources: HiveWorkSource[], maxFacts: number): HiveKnowledgeFact[] {
  const facts: HiveKnowledgeFact[] = [];
  for (const { workItem, contributions } of workSources) {
    const firstContribution = contributions[0];
    facts.push({
      slug: safeSlug(`visual-hive-${workItem.id}`),
      title: factTitleFor(workItem, firstContribution),
      type: factTypeFor(workItem, firstContribution),
      layer: "project",
      confidence: confidenceFor(firstContribution),
      tags: factTagsFor(workItem, firstContribution, context),
      source: "visual-hive:evidence-packet",
      body: renderFactBody(workItem, contributions, context),
      relatedEvidenceKeys: workItem.evidenceKeys,
      artifacts: workItem.artifacts
    });
  }
  for (const layer of context.evidence.testingLayers.filter((layer) => layer.status === "missing" || layer.status === "partial").slice(0, 8)) {
    facts.push({
      slug: safeSlug(`visual-hive-testing-layer-${layer.id}-${layer.status}`),
      title: `${layer.name} is ${layer.status}`,
      type: "test_scaffold",
      layer: "project",
      confidence: 0.78,
      tags: ["visual-hive", "testing-layer", `layer-${layer.id}`, layer.status],
      source: "visual-hive:testing-layers",
      body: sanitizeText([`Layer ${layer.id}: ${layer.name}`, "", ...layer.gaps.map((gap) => `- ${gap}`)].join("\n")),
      relatedEvidenceKeys: [`testing_layer.${layer.id}.${layer.status}`],
      artifacts: layer.evidence
    });
  }
  facts.push({
    slug: "visual-hive-verdict-policy",
    title: "Visual Hive remains the deterministic verdict authority",
    type: "decision",
    layer: "project",
    confidence: 1,
    tags: ["visual-hive", "policy", "verdict", "hive"],
    source: "visual-hive:hive-export",
    body: "Hive may route, advise, and repair in trusted modes, but only a fresh Visual Hive deterministic verdict can close the finding.",
    relatedEvidenceKeys: ["visual_hive.policy.verdict_authority"],
    artifacts: [".visual-hive/evidence-packet.json", ".visual-hive/verdict.json"]
  });
  return dedupeFacts(facts).slice(0, Math.max(0, maxFacts));
}

function buildRepairWorkOrders(context: HiveSourceContext, workSources: HiveWorkSource[], beads: HiveBead[]): HiveRepairWorkOrder[] {
  const beadByWorkItem = new Map<string, HiveBead>();
  for (let index = 0; index < workSources.length; index += 1) {
    const bead = beads[index];
    if (bead) beadByWorkItem.set(workSources[index]!.workItem.id, bead);
  }
  return workSources
    .filter(({ workItem }) => workItem.kind === "repair" || workItem.kind === "test_creation" || workItem.kind === "setup")
    .map(({ workItem, contributions }) => ({
      id: `hive-repair-${safeSlug(workItem.id)}`,
      actor: actorFor(workItem, context),
      title: workItem.title,
      objective: repairObjectiveFor(workItem),
      sourceBeadIds: beadByWorkItem.get(workItem.id)?.id ? [beadByWorkItem.get(workItem.id)!.id] : [],
      evidenceKeys: workItem.evidenceKeys,
      likelyFiles: likelyFilesFor(context, contributions),
      artifacts: workItem.artifacts,
      reproductionCommands: context.evidence.deterministicReport?.failedContracts
        .map((contract) => contract.reproductionCommand)
        .filter((command): command is string => Boolean(command)) ?? context.evidence.deterministicReport?.reproductionCommands ?? [],
      acceptanceCriteria: [
        "Visual Hive verdict passes after repair.",
        "The repair is submitted as a branch or pull request, not a direct write to main.",
        "No secret values are read or printed.",
        "Protected targets are not executed from untrusted PR code."
      ],
      allowedActions: allowedRepairActionsFor(workItem),
      forbiddenActions: forbiddenRepairActions(),
      maxAttempts: context.config.repair.maxAttempts,
      branchPrefix: context.config.repair.branchPrefix,
      prOnly: context.config.repair.prOnly,
      requireHumanReview: context.config.repair.requireHumanReview,
      rerunVisualHive: context.config.repair.rerunVisualHive
    }));
}

function buildKnowledgeGraph(
  context: HiveSourceContext,
  beads: HiveBead[],
  facts: HiveKnowledgeFact[],
  repairWorkOrders: HiveRepairWorkOrder[]
): HiveKnowledgeGraph {
  const nodes = new Map<string, HiveGraphNode>();
  const edges: HiveGraphEdge[] = [];
  const addNode = (node: HiveGraphNode) => nodes.set(node.id, node);
  const addEdge = (from: string, to: string, predicate: HiveGraphEdge["predicate"]) => {
    if (nodes.has(from) && nodes.has(to)) edges.push({ from, to, predicate });
  };
  addNode({ id: "visual-hive-verdict", slug: "visual-hive-verdict", title: `Visual Hive ${context.evidence.verdictSummary.visualHiveVerdict}`, type: "verdict", tags: ["visual-hive", "verdict"] });
  for (const contribution of context.evidence.evidenceContributions.slice(0, 80)) {
    addNode({
      id: `evidence:${safeSlug(contribution.key)}`,
      slug: safeSlug(contribution.key),
      title: contribution.key,
      type: `evidence:${contribution.source}:${contribution.kind}`,
      tags: ["evidence", contribution.source, contribution.kind, contribution.status],
      artifactPath: contribution.artifacts[0]
    });
    addEdge(`evidence:${safeSlug(contribution.key)}`, "visual-hive-verdict", "derived_from");
  }
  for (const bead of beads) {
    addNode({ id: `bead:${bead.id}`, slug: bead.id, title: bead.title, type: `bead:${bead.type}`, tags: ["bead", bead.actor, String(bead.priority)] });
    addEdge(`bead:${bead.id}`, "visual-hive-verdict", "derived_from");
  }
  for (const fact of facts) {
    addNode({
      id: `fact:${fact.slug}`,
      slug: fact.slug,
      title: fact.title,
      type: `fact:${fact.type}`,
      layer: fact.layer,
      confidence: fact.confidence,
      tags: fact.tags,
      artifactPath: fact.artifacts[0]
    });
    for (const key of fact.relatedEvidenceKeys) {
      addEdge(`fact:${fact.slug}`, `evidence:${safeSlug(key)}`, "derived_from");
    }
  }
  for (const workOrder of repairWorkOrders) {
    addNode({ id: `repair:${workOrder.id}`, slug: workOrder.id, title: workOrder.title, type: "repair_work_order", tags: ["repair", workOrder.actor] });
    for (const beadId of workOrder.sourceBeadIds) addEdge(`repair:${workOrder.id}`, `bead:${beadId}`, "depends_on");
    for (const key of workOrder.evidenceKeys) addEdge(`repair:${workOrder.id}`, `evidence:${safeSlug(key)}`, "derived_from");
  }
  for (const fact of facts) {
    for (const bead of beads) {
      if (fact.relatedEvidenceKeys.some((key) => bead.metadata.visual_hive_work_item_id?.includes(safeSlug(key)) || bead.notes.includes(key))) {
        addEdge(`bead:${bead.id}`, `fact:${fact.slug}`, "related_to");
      }
    }
  }
  return { schemaVersion: "visual-hive.hive-knowledge-graph.v1", nodes: [...nodes.values()], edges: dedupeEdges(edges) };
}

function buildAgentPolicy(context: HiveSourceContext): HiveAgentPolicy {
  const repairMode = shouldEmitRepairArtifacts(context.mode, context.config);
  return {
    schemaVersion: "visual-hive.hive-agent-policy.v1",
    mode: context.mode,
    acmmLevel: context.config.acmmLevel,
    enabled: context.config.enabled,
    externalCallsMade: 0,
    verdictAuthority: "visual_hive",
    hiveAuthority: "advisory_or_guarded_repair",
    repair: context.config.repair,
    allowedActions: repairMode
      ? ["read_sanitized_evidence", "create_repair_branch", "edit_source_or_tests", "open_pull_request", "request_visual_hive_rerun"]
      : ["read_sanitized_evidence", "summarize_failures", "draft_issue_comment", "recommend_tests"],
    forbiddenActions: forbiddenRepairActions(),
    trustedWorkflowRequiredFor: ["github_issue_creation", "hive_bead_creation", "agent_repair_execution", "protected_target_execution", "auto_merge"],
    finalValidation: {
      required: true,
      command: "visual-hive pipeline --mode pr --ci",
      passFailOwnedBy: "visual_hive_verdict_engine"
    }
  };
}

function renderHiveIssueContext(bundle: HiveExportBundle, context: HiveSourceContext, workSources: HiveWorkSource[]): string {
  const repairMessage = bundle.repairWorkOrders.length
    ? "Hive may attempt a repair PR under trusted policy; Visual Hive must re-run before merge."
    : "Hive may summarize, route, and recommend next tests; repair execution is not enabled for this export.";
  return sanitizeText(
    [
      `# Hive Agent Work Order: ${bundle.project}`,
      "",
      "<!-- visual-hive-hive-native-export -->",
      "",
      "## Summary",
      "",
      `- Visual Hive verdict: ${context.evidence.verdictSummary.visualHiveVerdict}`,
      `- Hive mode: ${bundle.mode}`,
      `- ACMM level: ${bundle.acmmLevel}`,
      `- External calls made: ${bundle.externalCallsMade}`,
      `- Beads: ${bundle.summary.beads}`,
      `- Knowledge facts: ${bundle.summary.knowledgeFacts}`,
      `- Repair work orders: ${bundle.summary.repairWorkOrders}`,
      `- Policy: ${repairMessage}`,
      "",
      "## Gating Evidence",
      "",
      ...listEvidence(context.evidence.evidenceContributions.filter((contribution) => contribution.gating).slice(0, 16)),
      "",
      "## Beads",
      "",
      ...(bundle.beads.length ? bundle.beads.map((bead) => `- [${bead.id}] p${bead.priority} ${bead.actor}/${bead.type}: ${bead.title}`) : ["- No Hive beads emitted in advisory mode."]),
      "",
      "## Knowledge Facts",
      "",
      ...(bundle.knowledgeFacts.length
        ? bundle.knowledgeFacts.slice(0, 12).map((fact) => `- ${fact.type}: ${fact.title} (${fact.slug})`)
        : ["- No Hive knowledge facts emitted in advisory mode."]),
      "",
      "## Repair Work Orders",
      "",
      ...(bundle.repairWorkOrders.length
        ? bundle.repairWorkOrders.map((order) => `- ${order.id}: ${order.objective}`)
        : ["- No repair work orders emitted."]),
      "",
      "## Reproduction Commands",
      "",
      ...(context.evidence.deterministicReport?.reproductionCommands?.length
        ? context.evidence.deterministicReport.reproductionCommands.map((command) => `- \`${command}\``)
        : ["- See `.visual-hive/evidence-packet.json`."]),
      "",
      "## Suggested Files To Inspect",
      "",
      ...suggestedFiles(context, workSources).map((file) => `- ${file}`),
      "",
      "## Guardrails",
      "",
      "- Visual Hive owns the final deterministic verdict.",
      "- Hive agents may fix issues only in trusted repair modes.",
      "- A Hive repair must create a branch or pull request and Visual Hive must pass afterward.",
      "- No secret values may be read, printed, or copied into issues.",
      "- Protected targets must not run from untrusted PR code."
    ].join("\n")
  ) + "\n";
}

function wikiPageFor(fact: HiveKnowledgeFact, wikiVaultDir: string): { slug: string; path: string; content: string } {
  const tags = fact.tags.map((tag) => `  - ${yamlString(tag)}`).join("\n");
  const evidence = fact.relatedEvidenceKeys.map((key) => `  - ${yamlString(key)}`).join("\n");
  const artifacts = fact.artifacts.map((artifact) => `  - ${yamlString(artifact)}`).join("\n");
  const content = sanitizeText(
    [
      "---",
      `title: ${yamlString(fact.title)}`,
      `type: ${fact.type}`,
      `layer: ${fact.layer}`,
      `confidence: ${fact.confidence}`,
      `source: ${yamlString(fact.source)}`,
      "tags:",
      tags || "  - visual-hive",
      "relatedEvidenceKeys:",
      evidence || "  - visual_hive",
      "artifacts:",
      artifacts || "  - .visual-hive/evidence-packet.json",
      "---",
      "",
      fact.body,
      ""
    ].join("\n")
  );
  return { slug: fact.slug, path: `${wikiVaultDir}/${fact.slug}.md`, content };
}

function blockedReasonsFor(context: HiveSourceContext): string[] {
  const reasons = [...context.evidence.hiveReadiness.blockedReasons];
  if (context.mode === "guarded_repair") {
    if (!context.config.enabled) reasons.push("Guarded Hive repair requires integrations.hive.enabled=true in a trusted workflow.");
    if (!context.config.repair.enabled) reasons.push("Guarded Hive repair requires integrations.hive.repair.enabled=true.");
    if (context.config.acmmLevel < 5) reasons.push("Guarded Hive repair requires ACMM level 5 or higher.");
  }
  if (context.mode === "full") {
    reasons.push("Full Hive automation is reserved for a future ACMM L6-compatible workflow and is blocked locally.");
  }
  if (shouldEmitRepairArtifacts(context.mode, context.config)) {
    if (!context.config.repair.prOnly) reasons.push("Hive repair must be PR-only in the current Visual Hive integration.");
    if (!context.config.repair.requireHumanReview) reasons.push("Hive repair requires human review in the current Visual Hive integration.");
    if (!context.config.repair.rerunVisualHive) reasons.push("Hive repair must require a Visual Hive rerun before merge.");
  }
  if (!context.evidence.evidenceContributions.length) reasons.push("Evidence Packet has no evidence contributions.");
  return dedupe(reasons);
}

function shouldEmitMeasuredArtifacts(mode: HiveAutomationMode): boolean {
  return mode !== "advisory";
}

function shouldEmitRepairArtifacts(mode: HiveAutomationMode, config: HiveExportConfig): boolean {
  return config.repair.enabled || mode === "repair_request" || mode === "guarded_repair" || mode === "full";
}

function outputPaths(outputDir: string): HiveExportBundle["outputArtifacts"] {
  return {
    export: `${outputDir}/hive-export.json`,
    beads: `${outputDir}/beads.json`,
    knowledgeFacts: `${outputDir}/knowledge-facts.json`,
    knowledgeGraph: `${outputDir}/knowledge-graph.json`,
    issueContext: `${outputDir}/issue-context.md`,
    repairWorkOrders: `${outputDir}/repair-work-orders.json`,
    agentPolicy: `${outputDir}/hive-agent-policy.json`,
    wikiVaultDir: `${outputDir}/wiki`
  };
}

function emptyGraph(): HiveKnowledgeGraph {
  return { schemaVersion: "visual-hive.hive-knowledge-graph.v1", nodes: [], edges: [] };
}

function beadTypeFor(workItem: HandoffWorkItem): HiveBeadType {
  if (workItem.kind === "repair") return "bug";
  if (workItem.kind === "test_creation") return "task";
  if (workItem.kind === "setup") return "chore";
  return "advisory";
}

function beadPriorityFor(priority: HandoffPriority): number {
  if (priority === "critical") return 0;
  if (priority === "high") return 1;
  if (priority === "medium") return 2;
  return 3;
}

function actorFor(workItem: HandoffWorkItem, context: HiveSourceContext): HiveBeadActor {
  if (workItem.kind === "setup") return "ci-maintainer";
  if (workItem.kind === "test_creation" || workItem.kind === "repair") return "quality";
  return context.config.defaultActor;
}

function factTypeFor(workItem: HandoffWorkItem, contribution?: EvidenceContribution): HiveKnowledgeFact["type"] {
  if (contribution?.source === "mutation" || workItem.kind === "test_creation") return "coverage_rule";
  if (workItem.kind === "repair") return "regression";
  if (workItem.kind === "setup") return "integration";
  return "gotcha";
}

function factTitleFor(workItem: HandoffWorkItem, contribution?: EvidenceContribution): string {
  if (contribution?.source === "mutation") return `Mutation adequacy gap: ${contribution.operator ?? workItem.id}`;
  return workItem.title;
}

function confidenceFor(contribution?: EvidenceContribution): number {
  if (!contribution) return 0.75;
  if (contribution.gating && contribution.status === "failed") return 0.95;
  if (contribution.status === "blocked") return 0.9;
  if (contribution.authority === "advisory") return 0.72;
  return 0.82;
}

function factTagsFor(workItem: HandoffWorkItem, contribution: EvidenceContribution | undefined, context: HiveSourceContext): string[] {
  return dedupe([
    "visual-hive",
    "hive",
    workItem.kind,
    contribution?.source,
    contribution?.kind,
    contribution?.contractId ? `contract:${contribution.contractId}` : undefined,
    contribution?.targetId ? `target:${contribution.targetId}` : undefined,
    contribution?.operator ? `mutation:${contribution.operator}` : undefined,
    `verdict:${context.evidence.verdictSummary.visualHiveVerdict}`
  ].filter((value): value is string => Boolean(value)));
}

function renderFactBody(workItem: HandoffWorkItem, contributions: EvidenceContribution[], context: HiveSourceContext): string {
  return sanitizeText(
    [
      workItem.summary,
      "",
      "Evidence:",
      ...(contributions.length ? contributions.map((contribution) => `- ${contribution.key}: ${contribution.reason}`) : workItem.evidenceKeys.map((key) => `- ${key}`)),
      "",
      "Suggested next steps:",
      ...workItem.suggestedNextSteps.map((step) => `- ${step}`),
      "",
      `Visual Hive verdict: ${context.evidence.verdictSummary.visualHiveVerdict}`
    ].join("\n")
  );
}

function renderBeadNotes(workItem: HandoffWorkItem): string {
  return sanitizeText(
    [
      workItem.summary,
      "",
      "Evidence keys:",
      ...workItem.evidenceKeys.map((key) => `- ${key}`),
      "",
      "Artifacts:",
      ...(workItem.artifacts.length ? workItem.artifacts.map((artifact) => `- ${artifact}`) : ["- .visual-hive/evidence-packet.json"]),
      "",
      "Suggested next steps:",
      ...workItem.suggestedNextSteps.map((step) => `- ${step}`)
    ].join("\n")
  );
}

function repairObjectiveFor(workItem: HandoffWorkItem): string {
  if (workItem.kind === "test_creation") return `Add or strengthen deterministic tests so Visual Hive catches: ${workItem.title}`;
  if (workItem.kind === "setup") return `Unblock Visual Hive evidence collection for: ${workItem.title}`;
  return `Repair the deterministic Visual Hive failure: ${workItem.title}`;
}

function allowedRepairActionsFor(workItem: HandoffWorkItem): string[] {
  const base = ["read_sanitized_evidence", "inspect_repo_files", "create_branch", "open_pull_request", "request_visual_hive_rerun"];
  if (workItem.kind === "test_creation") return [...base, "edit_tests", "edit_visual_hive_config"];
  if (workItem.kind === "setup") return [...base, "edit_workflow_or_setup_files"];
  return [...base, "edit_source", "edit_tests"];
}

function forbiddenRepairActions(): string[] {
  return [
    "decide_visual_hive_verdict",
    "read_secret_values",
    "print_secret_values",
    "approve_baselines_without_human_review",
    "run_protected_targets_from_untrusted_pr",
    "push_directly_to_main",
    "auto_merge_without_visual_hive_pass"
  ];
}

function likelyFilesFor(context: HiveSourceContext, contributions: EvidenceContribution[]): string[] {
  const changed = context.evidence.plan?.effectiveChangedFiles ?? context.evidence.plan?.changedFiles ?? [];
  const repoHints = context.evidence.repoIntelligence?.riskSignals.flatMap((signal) => signal.evidence).filter(Boolean) ?? [];
  const contractTargets = contributions.flatMap((contribution) => [contribution.contractId, contribution.targetId].filter(Boolean) as string[]);
  return dedupe([...changed, ...repoHints, ...contractTargets.map((value) => `visual-hive.config.yaml#${value}`)]).slice(0, 12);
}

function suggestedFiles(context: HiveSourceContext, workSources: HiveWorkSource[]): string[] {
  return dedupe([
    ...(context.evidence.plan?.effectiveChangedFiles ?? context.evidence.plan?.changedFiles ?? []),
    ...workSources.flatMap((source) => source.contributions.flatMap((contribution) => [contribution.contractId, contribution.targetId].filter(Boolean) as string[]).map((id) => `visual-hive.config.yaml#${id}`)),
    ".visual-hive/evidence-packet.json",
    ".visual-hive/report.json",
    ".visual-hive/mutation-report.json"
  ]).slice(0, 16);
}

function titleForContribution(contribution: EvidenceContribution): string {
  if (contribution.operator) return `Strengthen tests for ${contribution.operator}`;
  if (contribution.contractId) return `Repair ${contribution.contractId}`;
  return `Review ${contribution.source}.${contribution.kind}`;
}

function suggestedStepsForContribution(contribution: EvidenceContribution): string[] {
  if (contribution.source === "mutation") return ["Add a deterministic assertion that kills this mutation.", "Rerun visual-hive mutate.", "Regenerate the Evidence Packet."];
  if (contribution.status === "blocked") return ["Resolve the blocked setup or target lifecycle issue.", "Rerun visual-hive pipeline.", "Regenerate the Hive export."];
  return ["Inspect linked artifacts.", "Repair the UI or reviewed baseline.", "Rerun Visual Hive and verify the verdict passes."];
}

function listEvidence(contributions: EvidenceContribution[]): string[] {
  if (!contributions.length) return ["- None"];
  return contributions.map((contribution) => `- [${contribution.status}] ${contribution.key}: ${contribution.reason}`);
}

function dedupeFacts(facts: HiveKnowledgeFact[]): HiveKnowledgeFact[] {
  const seen = new Set<string>();
  const result: HiveKnowledgeFact[] = [];
  for (const fact of facts) {
    if (seen.has(fact.slug)) continue;
    seen.add(fact.slug);
    result.push(fact);
  }
  return result;
}

function dedupeEdges(edges: HiveGraphEdge[]): HiveGraphEdge[] {
  const seen = new Set<string>();
  const result: HiveGraphEdge[] = [];
  for (const edge of edges) {
    const key = `${edge.from}|${edge.predicate}|${edge.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(edge);
  }
  return result;
}

function compactRecord(values: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0));
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.map((value) => sanitizeText(value)).filter(Boolean))];
}

function dedupeModes(values: HiveAutomationMode[]): HiveAutomationMode[] {
  return [...new Set(values)];
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function safeSlug(value: string): string {
  return sanitizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

function yamlString(value: string): string {
  return JSON.stringify(sanitizeText(value));
}

function normalizePath(value: string): string {
  return sanitizeText(value.replaceAll("\\", "/"));
}

function resolveArtifact(rootDir: string, artifactPath: string): string {
  return path.isAbsolute(artifactPath) ? artifactPath : path.resolve(rootDir, artifactPath);
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === "string") return sanitizeText(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, sanitizeValue(child)]));
  return value;
}
