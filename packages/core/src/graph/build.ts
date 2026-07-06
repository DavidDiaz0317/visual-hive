import { access, readFile } from "node:fs/promises";
import path from "node:path";
import type { MutationReport, Report } from "../reports/types.js";
import type { VisualHiveIssueCandidate, VisualHiveIssuesReport } from "../issues/types.js";
import type { RepoMapReport, RepoVisualMapEdge, RepoVisualMapNode } from "../repo/types.js";
import { writeJson, writeText } from "../utils/files.js";
import { sanitizeText } from "../utils/sanitize.js";
import { detectVisualGraphExtractors } from "./extractors.js";
import type {
  VisualGraph,
  VisualGraphEdge,
  VisualGraphEdgeRelation,
  VisualGraphNode,
  VisualGraphNodeKind,
  VisualGraphProvenance,
  VisualGraphReferenceKind,
  VisualGraphResolvedBy,
  VisualGraphResolvedReference,
  VisualGraphSearchResult,
  VisualGraphStatus,
  VisualGraphUnresolvedReference,
  VisualGraphVocabulary,
  VisualImpactReport
} from "./types.js";

export interface BuildVisualGraphOptions {
  repoRoot: string;
  repoMap: RepoMapReport;
  report?: Report;
  mutationReport?: MutationReport;
  issuesReport?: VisualHiveIssuesReport;
  now?: Date;
}

export interface WriteVisualGraphArtifactsOptions extends BuildVisualGraphOptions {
  graphPath?: string;
  summaryPath?: string;
  vocabPath?: string;
  unresolvedPath?: string;
}

const GRAPH_SCHEMA_VERSION = "visual-hive.visual-graph.v1" as const;
const VOCAB_SCHEMA_VERSION = "visual-hive.visual-graph-vocab.v1" as const;
const IMPACT_SCHEMA_VERSION = "visual-hive.visual-impact.v1" as const;
const DEFAULT_ARTIFACTS = [
  ".visual-hive/repo-map.json",
  ".visual-hive/repo-context.md",
  ".visual-hive/report.json",
  ".visual-hive/mutation-report.json",
  ".visual-hive/issues.json",
  ".visual-hive/issue-queue.json",
  ".visual-hive/evidence-packet.json",
  ".visual-hive/handoff.json",
  ".visual-hive/hive/hive-export.json"
];
const AGENT_PROFILES = ["setup_agent", "map_agent", "test_creator_agent", "test_maintainer_agent", "mutation_agent", "review_agent"];

export async function writeVisualGraphArtifacts(options: WriteVisualGraphArtifactsOptions): Promise<{
  graph: VisualGraph;
  vocabulary: VisualGraphVocabulary;
  graphPath: string;
  summaryPath: string;
  vocabPath: string;
  unresolvedPath: string;
}> {
  const repoRoot = path.resolve(options.repoRoot);
  const graph = buildVisualGraph({
    ...options,
    report: options.report ?? (await readOptionalJson<Report>(repoRoot, ".visual-hive/report.json")),
    mutationReport: options.mutationReport ?? (await readOptionalJson<MutationReport>(repoRoot, ".visual-hive/mutation-report.json")),
    issuesReport: options.issuesReport ?? (await readOptionalJson<VisualHiveIssuesReport>(repoRoot, ".visual-hive/issues.json"))
  });
  const vocabulary = buildVisualGraphVocabulary(graph);
  const graphPath = resolveArtifact(repoRoot, options.graphPath ?? ".visual-hive/visual-graph.json");
  const summaryPath = resolveArtifact(repoRoot, options.summaryPath ?? ".visual-hive/visual-graph-summary.md");
  const vocabPath = resolveArtifact(repoRoot, options.vocabPath ?? ".visual-hive/visual-graph-vocab.json");
  const unresolvedPath = resolveArtifact(repoRoot, options.unresolvedPath ?? ".visual-hive/visual-graph-unresolved.json");
  await writeJson(graphPath, graph);
  await writeText(summaryPath, renderVisualGraphSummary(graph));
  await writeJson(vocabPath, vocabulary);
  await writeJson(unresolvedPath, {
    schemaVersion: "visual-hive.visual-graph-unresolved.v1",
    generatedAt: graph.generatedAt,
    project: graph.project,
    unresolvedReferences: graph.unresolvedReferences,
    resolvedReferences: graph.resolvedReferences
  });
  return { graph, vocabulary, graphPath, summaryPath, vocabPath, unresolvedPath };
}

export function buildVisualGraph(options: BuildVisualGraphOptions): VisualGraph {
  const generatedAt = (options.now ?? new Date()).toISOString();
  const nodes = new Map<string, VisualGraphNode>();
  const edges = new Map<string, VisualGraphEdge>();

  const addNode = (node: VisualGraphNode) => {
    const existing = nodes.get(node.id);
    if (!existing) {
      nodes.set(node.id, sanitizeNode(node));
      return;
    }
    nodes.set(node.id, sanitizeNode({
      ...existing,
      evidenceArtifacts: unique([...existing.evidenceArtifacts, ...node.evidenceArtifacts]),
      metadata: { ...(existing.metadata ?? {}), ...(node.metadata ?? {}) },
      confidence: Math.max(existing.confidence, node.confidence),
      lastSeen: maxIso(existing.lastSeen, node.lastSeen),
      lastValidated: node.lastValidated ?? existing.lastValidated
    }));
  };
  const addEdge = (edge: VisualGraphEdge) => {
    edges.set(edge.id, sanitizeEdge(edge));
  };

  for (const node of options.repoMap.visualMap.nodes) addNode(fromRepoNode(node, generatedAt));
  for (const edge of options.repoMap.visualMap.edges) {
    const mapped = fromRepoEdge(edge, generatedAt);
    if (nodes.has(mapped.from) && nodes.has(mapped.to)) addEdge(mapped);
  }
  addPackageNodes(options.repoMap, generatedAt, addNode, addEdge);
  addWorkflowNodes(options.repoMap, generatedAt, addNode, addEdge);
  addArtifactNodes(generatedAt, addNode);
  addAgentAndHiveNodes(generatedAt, addNode);
  addReportEvidence(options.report, generatedAt, addNode, addEdge);
  addMutationEvidence(options.mutationReport, generatedAt, addNode, addEdge);
  addIssueEvidence(options.issuesReport, generatedAt, addNode, addEdge);
  addDerivedRelations([...nodes.values()], generatedAt, addEdge);

  const unresolvedReferences = buildUnresolvedReferences([...nodes.values()], [...edges.values()], options.repoMap, generatedAt);
  const resolvedReferences = buildResolvedReferences([...edges.values()]);
  const nodeList = [...nodes.values()].sort(compareById);
  const edgeList = [...edges.values()].sort(compareById);
  const detectedExtractors = detectVisualGraphExtractors(options.repoMap, [
    ...DEFAULT_ARTIFACTS,
    ...(options.report?.artifacts ?? []),
    ...(options.mutationReport?.results?.flatMap((result) => result.artifacts ?? []) ?? []),
    ...(options.issuesReport?.issues?.flatMap((issue) => issue.sourceArtifacts ?? []) ?? [])
  ]);
  const graph: VisualGraph = {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    generatedAt,
    project: options.repoMap.project.name,
    summary: {
      nodes: nodeList.length,
      edges: edgeList.length,
      unresolvedReferences: unresolvedReferences.length,
      resolvedReferences: resolvedReferences.length,
      completeChains: countCompleteChains(nodeList, edgeList),
      nodeKinds: countBy(nodeList, (node) => node.kind)
    },
    extractorArchitecture: {
      interface: "VisualHiveGraphExtractor",
      extractors: detectedExtractors.map((extractor) => extractor.id),
      notes: [
        "v0.2 derives the production graph from deterministic repo-map, config, reports, mutation reports, and issue artifacts.",
        `Detected extractor registry: ${detectedExtractors.map((extractor) => `${extractor.id}(${extractor.evidenceKinds.join("/")})`).join(", ") || "none"}.`,
        "Framework-specific extractors can replace individual derivation steps without changing the graph contract."
      ]
    },
    nodes: nodeList,
    edges: edgeList,
    unresolvedReferences,
    resolvedReferences
  };
  return graph;
}

export function buildVisualGraphVocabulary(graph: VisualGraph): VisualGraphVocabulary {
  const tokenMap = new Map<string, { nodeIds: Set<string>; kinds: Set<VisualGraphNodeKind>; labels: Set<string> }>();
  for (const node of graph.nodes) {
    for (const token of tokensForNode(node)) {
      const existing = tokenMap.get(token) ?? { nodeIds: new Set<string>(), kinds: new Set<VisualGraphNodeKind>(), labels: new Set<string>() };
      existing.nodeIds.add(node.id);
      existing.kinds.add(node.kind);
      existing.labels.add(node.label);
      tokenMap.set(token, existing);
    }
  }
  return {
    schemaVersion: VOCAB_SCHEMA_VERSION,
    generatedAt: graph.generatedAt,
    project: graph.project,
    entries: [...tokenMap.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([token, value]) => ({
        token,
        nodeIds: [...value.nodeIds].sort(),
        kinds: [...value.kinds].sort(),
        labels: [...value.labels].sort()
      }))
  };
}

export function searchVisualGraph(graph: VisualGraph, query: string): VisualGraphSearchResult[] {
  const tokens = tokenize(query);
  if (!tokens.length) return [];
  return graph.nodes
    .map((node) => {
      const nodeTokens = new Set(tokensForNode(node));
      const matchedTokens = tokens.filter((token) => nodeTokens.has(token) || node.id.toLowerCase().includes(token) || node.label.toLowerCase().includes(token));
      const score = matchedTokens.length * 10 + tokens.reduce((sum, token) => sum + (node.id.toLowerCase().includes(token) ? 2 : 0) + (node.label.toLowerCase().includes(token) ? 3 : 0), 0);
      return { node, score, matchedTokens: unique(matchedTokens) };
    })
    .filter((result) => result.score > 0)
    .sort((left, right) => right.score - left.score || left.node.id.localeCompare(right.node.id))
    .slice(0, 30);
}

export function analyzeVisualImpact(graph: VisualGraph, query: VisualImpactReport["query"], now = new Date()): VisualImpactReport {
  const seedIds = new Set<string>();
  for (const changedFile of query.changedFiles ?? []) {
    const normalized = changedFile.replaceAll("\\", "/");
    for (const node of graph.nodes) {
      const filePath = node.sourceSpan?.filePath ?? String(node.metadata?.sourceFile ?? "");
      if (node.kind === "file" && (node.id.endsWith(normalized) || filePath === normalized)) seedIds.add(node.id);
      if (filePath && (filePath === normalized || filePath.endsWith(`/${normalized}`) || normalized.endsWith(filePath))) seedIds.add(node.id);
    }
  }
  addSearchSeeds(graph, seedIds, "issue_candidate", query.issue);
  addSearchSeeds(graph, seedIds, "contract", query.contract);
  addSearchSeeds(graph, seedIds, "mutation_operator", query.mutation);
  addSearchSeeds(graph, seedIds, "route", query.route);
  if (query.text) {
    for (const result of searchVisualGraph(graph, query.text).slice(0, 10)) seedIds.add(result.node.id);
  }
  const affectedIds = traverse(graph, [...seedIds], 4);
  const affectedNodes = graph.nodes.filter((node) => affectedIds.has(node.id)).sort(compareById);
  const affectedEdges = graph.edges.filter((edge) => affectedIds.has(edge.from) && affectedIds.has(edge.to)).sort(compareById);
  const grouped = groupNodes(affectedNodes);
  const issueNodes = affectedNodes.filter((node) => node.kind === "issue_candidate").map((node) => node.id);
  const validationCommands = unique(
    affectedNodes
      .map((node) => String(node.metadata?.validationCommand ?? node.metadata?.reproductionCommand ?? ""))
      .filter(Boolean)
  );
  if (!validationCommands.length) validationCommands.push("visual-hive plan && visual-hive run --ci && visual-hive triage && visual-hive evidence");
  return {
    schemaVersion: IMPACT_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    project: graph.project,
    query,
    affectedNodes,
    affectedEdges,
    grouped,
    validationCommands,
    issueContext: {
      issueNodeIds: issueNodes,
      evidenceArtifacts: unique(affectedNodes.flatMap((node) => node.evidenceArtifacts)),
      suggestedAgentProfiles: unique(affectedNodes.map((node) => String(node.metadata?.owningAgentHint ?? "")).filter(Boolean))
    },
    summary: {
      affectedNodeCount: affectedNodes.length,
      affectedRouteCount: affectedNodes.filter((node) => node.kind === "route").length,
      affectedContractCount: affectedNodes.filter((node) => node.kind === "contract").length,
      affectedScreenshotCount: affectedNodes.filter((node) => node.kind === "screenshot").length,
      affectedMutationCount: affectedNodes.filter((node) => node.kind === "mutation_operator").length
    }
  };
}

export async function writeVisualImpact(options: { repoRoot: string; graph: VisualGraph; query: VisualImpactReport["query"]; outputPath?: string; now?: Date }): Promise<{ impact: VisualImpactReport; outputPath: string }> {
  const repoRoot = path.resolve(options.repoRoot);
  const impact = analyzeVisualImpact(options.graph, options.query, options.now);
  const outputPath = resolveArtifact(repoRoot, options.outputPath ?? ".visual-hive/visual-impact.json");
  await writeJson(outputPath, impact);
  return { impact, outputPath };
}

export function renderVisualGraphSummary(graph: VisualGraph): string {
  const topKinds = Object.entries(graph.summary.nodeKinds)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([kind, count]) => `- ${kind}: ${count}`);
  const unresolved = graph.unresolvedReferences.slice(0, 12).map((ref) => `- ${ref.referenceKind}: ${ref.fromNodeId} -> ${ref.referenceName} (${ref.blockedReason ?? "pending resolution"})`);
  return [
    `# Visual Hive Visual Graph: ${graph.project}`,
    "",
    "This graph is deterministic local evidence for humans, Hive, MCP tools, and issue-driven agents. It is not a repair action.",
    "",
    "## Summary",
    "",
    `- Nodes: ${graph.summary.nodes}`,
    `- Edges: ${graph.summary.edges}`,
    `- Complete chains: ${graph.summary.completeChains}`,
    `- Unresolved references: ${graph.summary.unresolvedReferences}`,
    `- Resolved references: ${graph.summary.resolvedReferences}`,
    "",
    "## Node Kinds",
    "",
    ...(topKinds.length ? topKinds : ["- none"]),
    "",
    "## Unresolved References",
    "",
    ...(unresolved.length ? unresolved : ["- none"]),
    "",
    "## Extractors",
    "",
    ...graph.extractorArchitecture.extractors.map((extractor) => `- ${extractor}`)
  ].join("\n");
}

function fromRepoNode(node: RepoVisualMapNode, generatedAt: string): VisualGraphNode {
  return {
    id: normalizeNodeId(node.id),
    kind: mapNodeKind(node.kind),
    label: node.label,
    sourceSpan: sourceSpanFor(node),
    provenance: mapProvenance(node.provenance.source),
    confidence: confidenceValue(node.provenance.confidence),
    firstSeen: node.provenance.firstSeen ?? generatedAt,
    lastSeen: generatedAt,
    lastValidated: node.provenance.lastValidated,
    status: mapStatus(node.status),
    evidenceArtifacts: [".visual-hive/repo-map.json"],
    metadata: {
      sourceFiles: node.sourceFiles,
      routes: node.routes,
      states: node.states,
      viewports: node.viewports,
      selectors: node.selectors,
      targetIds: node.targetIds,
      contractIds: node.contractIds,
      screenshotNames: node.screenshotNames,
      mutationOperators: node.mutationOperators,
      coverageGapIds: node.coverageGapIds
    }
  };
}

function fromRepoEdge(edge: RepoVisualMapEdge, generatedAt: string): VisualGraphEdge {
  return {
    id: `edge:${normalizeNodeId(edge.from)}:${mapRelation(edge.relation)}:${normalizeNodeId(edge.to)}`,
    from: normalizeNodeId(edge.from),
    to: normalizeNodeId(edge.to),
    relation: mapRelation(edge.relation),
    provenance: "derived",
    confidence: confidenceValue(edge.confidence),
    firstSeen: generatedAt,
    lastSeen: generatedAt,
    metadata: { previousRelation: edge.relation },
    evidenceArtifacts: unique([".visual-hive/repo-map.json", ...edge.evidence])
  };
}

function addPackageNodes(repoMap: RepoMapReport, generatedAt: string, addNode: (node: VisualGraphNode) => void, addEdge: (edge: VisualGraphEdge) => void): void {
  for (const pkg of repoMap.packages) {
    const pkgId = `package:${safeId(pkg.path)}`;
    addNode(baseNode(pkgId, "package", pkg.name ?? pkg.path, "static", generatedAt, [".visual-hive/repo-map.json"], { packagePath: pkg.path, scripts: pkg.scripts.map((script) => script.name) }));
    const fileId = `file:${pkg.path}`;
    addNode(baseNode(fileId, "file", pkg.path, "static", generatedAt, [".visual-hive/repo-map.json"], { sourceFile: pkg.path }, pkg.path));
    addEdge(baseEdge(pkgId, fileId, "declares", "static", generatedAt, [".visual-hive/repo-map.json"]));
  }
}

function addWorkflowNodes(repoMap: RepoMapReport, generatedAt: string, addNode: (node: VisualGraphNode) => void, addEdge: (edge: VisualGraphEdge) => void): void {
  for (const workflow of repoMap.workflows) {
    const workflowId = `workflow:${safeId(workflow.path)}`;
    addNode(baseNode(workflowId, "workflow", workflow.path, "workflow", generatedAt, [".visual-hive/repo-map.json"], { ...workflow }, workflow.path));
    addNode(baseNode(`file:${workflow.path}`, "file", workflow.path, "static", generatedAt, [".visual-hive/repo-map.json"], { sourceFile: workflow.path }, workflow.path));
    addEdge(baseEdge(`file:${workflow.path}`, workflowId, "declares", "workflow", generatedAt, [".visual-hive/repo-map.json"]));
  }
}

function addArtifactNodes(generatedAt: string, addNode: (node: VisualGraphNode) => void): void {
  for (const artifact of DEFAULT_ARTIFACTS) {
    addNode(baseNode(`artifact:${safeId(artifact)}`, "artifact", artifact, "derived", generatedAt, [artifact], { artifactPath: artifact }));
  }
}

function addAgentAndHiveNodes(generatedAt: string, addNode: (node: VisualGraphNode) => void): void {
  for (const profile of AGENT_PROFILES) {
    addNode(baseNode(`agent_profile:${profile}`, "agent_profile", profile, "agent_suggested", generatedAt, [".visual-hive/agents"], { profile }));
  }
  for (const resource of ["hive-export", "hive-beads", "hive-knowledge-graph", "hive-wiki", "hive-repair-work-orders"]) {
    addNode(baseNode(`hive_resource:${resource}`, "hive_resource", resource, "derived", generatedAt, [".visual-hive/hive/hive-export.json"], { resource }));
  }
}

function addReportEvidence(report: Report | undefined, generatedAt: string, addNode: (node: VisualGraphNode) => void, addEdge: (edge: VisualGraphEdge) => void): void {
  if (!report) return;
  for (const result of report.results ?? []) {
    const contractId = `contract:${result.contractId}`;
    addNode(baseNode(contractId, "contract", result.contractId, "playwright_report", generatedAt, [".visual-hive/report.json"], { status: result.status, targetId: result.targetId, reproductionCommand: result.reproductionCommand }));
    addEdge(baseEdge(contractId, "artifact:visual-hive_report_json", "produces_artifact", "playwright_report", generatedAt, [".visual-hive/report.json"]));
    for (const screenshot of result.screenshotAssertions ?? []) {
      const screenshotId = `screenshot:${result.contractId}:${screenshot.screenshotName ?? screenshot.name ?? "screenshot"}`;
      addNode(baseNode(screenshotId, "screenshot", String(screenshot.screenshotName ?? screenshot.name ?? "screenshot"), "screenshot", generatedAt, [".visual-hive/report.json", String(screenshot.actualPath ?? "")].filter(Boolean), { ...screenshot }));
      addEdge(baseEdge(contractId, screenshotId, "captures", "playwright_report", generatedAt, [".visual-hive/report.json"]));
      if (screenshot.viewport) addEdge(baseEdge(screenshotId, `viewport:${screenshot.viewport}`, "uses_viewport", "playwright_report", generatedAt, [".visual-hive/report.json"]));
      if (screenshot.baselinePath) {
        const baselineId = `baseline:${safeId(String(screenshot.baselinePath))}`;
        addNode(baseNode(baselineId, "baseline", String(screenshot.baselinePath), "screenshot", generatedAt, [String(screenshot.baselinePath)], { ...screenshot }));
        addEdge(baseEdge(screenshotId, baselineId, "validates", "screenshot", generatedAt, [".visual-hive/report.json"]));
      }
    }
  }
}

function addMutationEvidence(mutationReport: MutationReport | undefined, generatedAt: string, addNode: (node: VisualGraphNode) => void, addEdge: (edge: VisualGraphEdge) => void): void {
  if (!mutationReport) return;
  for (const result of mutationReport.results ?? []) {
    const operator = String(result.operator);
    const mutationId = `mutation_operator:${operator}`;
    addNode(baseNode(mutationId, "mutation_operator", operator, "mutation_report", generatedAt, [".visual-hive/mutation-report.json"], { ...result }));
    const contractIds = result.contractIds ?? [];
    for (const contractId of contractIds) {
      const contractNodeId = `contract:${contractId}`;
      addEdge(baseEdge(mutationId, contractNodeId, "mutates", "mutation_report", generatedAt, [".visual-hive/mutation-report.json"]));
      addEdge(baseEdge(mutationId, contractNodeId, result.status === "survived" ? "survived_by" : result.status === "killed" ? "killed_by" : "validates", "mutation_report", generatedAt, [".visual-hive/mutation-report.json"]));
    }
  }
}

function addIssueEvidence(issuesReport: VisualHiveIssuesReport | undefined, generatedAt: string, addNode: (node: VisualGraphNode) => void, addEdge: (edge: VisualGraphEdge) => void): void {
  if (!issuesReport) return;
  for (const issue of issuesReport.issues ?? []) {
    const issueId = `issue_candidate:${safeId(issue.dedupeFingerprint)}`;
    addNode(baseNode(issueId, "issue_candidate", issue.title, "derived", generatedAt, [".visual-hive/issues.json", ".visual-hive/issues.md"], {
      issueKind: issue.issueKind,
      severity: issue.severity,
      lifecycleStatus: issue.status,
      dedupeFingerprint: issue.dedupeFingerprint,
      validationCommand: issue.validationCommand,
      owningAgentHint: issue.owningAgentHint
    }));
    addEdge(baseEdge(issueId, `agent_profile:${agentProfile(issue)}`, "assigned_to_agent", "agent_suggested", generatedAt, [".visual-hive/issues.json"]));
    for (const affected of issue.affected ?? []) {
      if (affected.contractId) addEdge(baseEdge(`contract:${affected.contractId}`, issueId, "backs_issue", "derived", generatedAt, [".visual-hive/issues.json"]));
      if (affected.route) addEdge(baseEdge(`route:${affected.route}`, issueId, "backs_issue", "derived", generatedAt, [".visual-hive/issues.json"]));
      if (affected.selector) addEdge(baseEdge(`selector:${affected.selector}`, issueId, "backs_issue", "derived", generatedAt, [".visual-hive/issues.json"]));
    }
    for (const artifact of issue.sourceArtifacts ?? []) addEdge(baseEdge(`artifact:${safeId(artifact)}`, issueId, "backs_issue", "derived", generatedAt, [artifact]));
  }
}

function addDerivedRelations(nodes: VisualGraphNode[], generatedAt: string, addEdge: (edge: VisualGraphEdge) => void): void {
  const components = nodes.filter((node) => node.kind === "component");
  const routes = nodes.filter((node) => node.kind === "route");
  const contracts = nodes.filter((node) => node.kind === "contract");
  const screenshots = nodes.filter((node) => node.kind === "screenshot");
  const mutations = nodes.filter((node) => node.kind === "mutation_operator");
  for (const component of components) {
    const sourceFile = sourceFileFor(component);
    for (const route of routes) {
      if (sourceFile && sourceFile === sourceFileFor(route)) addEdge(baseEdge(component.id, route.id, "renders", "derived", generatedAt, [".visual-hive/visual-graph.json"], 0.78));
    }
  }
  for (const contract of contracts) {
    const routesMeta = asArray(contract.metadata?.routes);
    for (const route of routes) {
      if (routesMeta.includes(route.label) || route.id.endsWith(`:${route.label}`)) addEdge(baseEdge(contract.id, route.id, "covers_route", "derived", generatedAt, [".visual-hive/visual-graph.json"], 0.75));
    }
  }
  for (const screenshot of screenshots) {
    const contractId = String(screenshot.metadata?.contractId ?? "");
    if (contractId) addEdge(baseEdge(`contract:${contractId}`, screenshot.id, "captures", "derived", generatedAt, [".visual-hive/visual-graph.json"], 0.9));
  }
  for (const mutation of mutations) {
    const op = mutation.label;
    let matched = false;
    for (const contract of contracts) {
      if (heuristicMutationMatchesContract(op, contract)) {
        matched = true;
        addEdge(baseEdge(mutation.id, contract.id, "mutates", "derived", generatedAt, [".visual-hive/visual-graph.json"], 0.55));
      }
    }
    if (!matched && contracts.length === 1) {
      addEdge(baseEdge(mutation.id, contracts[0]!.id, "mutates", "derived", generatedAt, [".visual-hive/visual-graph.json"], 0.35));
    }
  }
}

function buildUnresolvedReferences(nodes: VisualGraphNode[], edges: VisualGraphEdge[], repoMap: RepoMapReport, generatedAt: string): VisualGraphUnresolvedReference[] {
  const refs: VisualGraphUnresolvedReference[] = [];
  const hasEdge = (from: string, relation: VisualGraphEdgeRelation) => edges.some((edge) => edge.from === from && edge.relation === relation);
  for (const node of nodes) {
    if (node.kind === "component" && !hasEdge(node.id, "renders")) {
      refs.push(unresolved(node, "component_to_route", "route", candidates(nodes, "route", node), "No exact component-to-route relationship was proven from config or source spans.", "runtime_dom_observation", generatedAt));
    }
    if (node.kind === "selector" && !edges.some((edge) => edge.from === edge.from && edge.relation === "uses_selector" && edge.to === node.id)) {
      refs.push(unresolved(node, "selector_to_component", "component", candidates(nodes, "component", node), "Selector is known, but owning component was not proven.", "static_extract", generatedAt));
    }
    if (node.kind === "mutation_operator" && !hasEdge(node.id, "mutates")) {
      refs.push(unresolved(node, "mutation_to_contract", "contract", candidates(nodes, "contract", node), "Mutation operator has no explicit or heuristic contract mapping.", "manual_review", generatedAt));
    }
    if (node.kind === "workflow" && !hasEdge(node.id, "validates")) {
      refs.push(unresolved(node, "workflow_to_command", "command", [], "Workflow commands were summarized but not normalized into runbook command nodes.", "manual_review", generatedAt));
    }
    if (node.kind === "issue_candidate" && !hasEdge(node.id, "validates")) {
      refs.push(unresolved(node, "issue_to_artifact", "artifact", candidates(nodes, "artifact", node), "Issue candidate needs trusted publish/validation artifact linkage before external handoff.", "report_evidence", generatedAt));
    }
  }
  for (const finding of repoMap.visualMap.findings.filter((finding) => finding.status === "stale" || finding.status === "resolved_candidate")) {
    for (const nodeId of finding.nodeIds) {
      const node = nodes.find((candidateNode) => candidateNode.id === normalizeNodeId(nodeId));
      if (!node) continue;
      refs.push({
        id: `ref:${safeId(finding.id)}:${safeId(node.id)}`,
        fromNodeId: node.id,
        referenceName: finding.message,
        referenceKind: "artifact_to_graph_node",
        sourceSpan: node.sourceSpan,
        candidates: [],
        confidence: 0.4,
        blockedReason: finding.status === "stale" ? "Prior graph evidence is stale and needs rerun validation." : undefined,
        nextResolutionStrategy: "report_evidence"
      });
    }
  }
  return dedupeBy(refs, (ref) => ref.id);
}

function buildResolvedReferences(edges: VisualGraphEdge[]): VisualGraphResolvedReference[] {
  return edges
    .filter((edge) => edge.confidence >= 0.7)
    .slice(0, 300)
    .map((edge) => ({
      id: `resolved:${safeId(edge.id)}`,
      fromNodeId: edge.from,
      referenceName: edge.relation,
      referenceKind: relationToReferenceKind(edge.relation),
      targetNodeId: edge.to,
      confidence: edge.confidence,
      resolvedBy: relationResolvedBy(edge.relation, edge.provenance)
    }));
}

function unresolved(
  node: VisualGraphNode,
  kind: VisualGraphReferenceKind,
  referenceName: string,
  candidatesValue: VisualGraphUnresolvedReference["candidates"],
  blockedReason: string,
  nextResolutionStrategy: VisualGraphUnresolvedReference["nextResolutionStrategy"],
  generatedAt: string
): VisualGraphUnresolvedReference {
  return {
    id: `unresolved:${kind}:${safeId(node.id)}:${generatedAt.slice(0, 10)}`,
    fromNodeId: node.id,
    referenceName,
    referenceKind: kind,
    sourceSpan: node.sourceSpan,
    candidates: candidatesValue,
    confidence: candidatesValue[0]?.confidence ?? 0.25,
    blockedReason,
    nextResolutionStrategy
  };
}

function candidates(nodes: VisualGraphNode[], kind: VisualGraphNodeKind, from: VisualGraphNode) {
  const fromTokens = new Set(tokensForNode(from));
  return nodes
    .filter((node) => node.kind === kind)
    .map((node) => {
      const overlap = tokensForNode(node).filter((token) => fromTokens.has(token)).length;
      return {
        nodeId: node.id,
        label: node.label,
        confidence: Math.min(0.9, 0.25 + overlap * 0.15),
        reason: overlap ? "shared graph vocabulary tokens" : "same node kind candidate"
      };
    })
    .filter((candidate) => candidate.confidence >= 0.4)
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, 5);
}

function baseNode(
  id: string,
  kind: VisualGraphNodeKind,
  label: string,
  provenance: VisualGraphProvenance,
  generatedAt: string,
  evidenceArtifacts: string[],
  metadata?: Record<string, unknown>,
  filePath?: string,
  confidence = 0.85
): VisualGraphNode {
  return {
    id,
    kind,
    label: sanitizeText(label),
    sourceSpan: filePath ? { filePath } : undefined,
    provenance,
    confidence,
    firstSeen: generatedAt,
    lastSeen: generatedAt,
    lastValidated: generatedAt,
    status: "active",
    evidenceArtifacts: unique(evidenceArtifacts.filter(Boolean)),
    metadata
  };
}

function baseEdge(from: string, to: string, relation: VisualGraphEdgeRelation, provenance: VisualGraphProvenance, generatedAt: string, evidenceArtifacts: string[], confidence = 0.85): VisualGraphEdge {
  return {
    id: `edge:${safeId(from)}:${relation}:${safeId(to)}`,
    from,
    to,
    relation,
    provenance,
    confidence,
    firstSeen: generatedAt,
    lastSeen: generatedAt,
    evidenceArtifacts: unique(evidenceArtifacts.filter(Boolean))
  };
}

export async function readVisualGraph(repoRoot: string, graphPath = ".visual-hive/visual-graph.json"): Promise<VisualGraph> {
  return JSON.parse(await readFile(resolveArtifact(path.resolve(repoRoot), graphPath), "utf8")) as VisualGraph;
}

function mapNodeKind(kind: RepoVisualMapNode["kind"]): VisualGraphNodeKind {
  if (kind === "mutation") return "mutation_operator";
  return kind;
}

function mapRelation(relation: RepoVisualMapEdge["relation"]): VisualGraphEdgeRelation {
  const mapping: Record<RepoVisualMapEdge["relation"], VisualGraphEdgeRelation> = {
    declares: "declares",
    renders: "renders",
    uses_selector: "uses_selector",
    targets: "targets",
    covers_route: "covers_route",
    captures: "captures",
    uses_viewport: "uses_viewport",
    maps_mutation: "mutates",
    has_gap: "has_gap",
    impacts: "impacts",
    validated_by: "validates"
  };
  return mapping[relation];
}

function mapProvenance(source: RepoVisualMapNode["provenance"]["source"]): VisualGraphProvenance {
  if (source === "runtime") return "runtime_dom";
  return source;
}

function mapStatus(status: RepoVisualMapNode["status"]): VisualGraphStatus {
  if (status === "unverified") return "unresolved";
  return status;
}

function confidenceValue(confidence: "high" | "medium" | "low"): number {
  return confidence === "high" ? 0.95 : confidence === "medium" ? 0.65 : 0.35;
}

function sourceSpanFor(node: RepoVisualMapNode) {
  const filePath = node.sourceFiles[0] ?? node.provenance.sourceFile;
  return filePath ? { filePath } : undefined;
}

function normalizeNodeId(id: string): string {
  return id.startsWith("mutation:") ? id.replace(/^mutation:/, "mutation_operator:") : id;
}

function safeId(value: string): string {
  return sanitizeText(value).replaceAll("\\", "/").replace(/[^a-zA-Z0-9._:/-]+/g, "_").replaceAll("/", "_").replaceAll(":", "_");
}

function sanitizeNode(node: VisualGraphNode): VisualGraphNode {
  return {
    ...node,
    label: sanitizeText(node.label),
    evidenceArtifacts: unique(node.evidenceArtifacts.map((artifact) => sanitizeText(artifact))),
    metadata: sanitizeValue(node.metadata)
  };
}

function sanitizeEdge(edge: VisualGraphEdge): VisualGraphEdge {
  return {
    ...edge,
    evidenceArtifacts: unique(edge.evidenceArtifacts.map((artifact) => sanitizeText(artifact))),
    metadata: sanitizeValue(edge.metadata)
  };
}

function sanitizeValue<T>(value: T): T {
  if (typeof value === "string") return sanitizeText(value) as T;
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeValue(item)])) as T;
  }
  return value;
}

function tokensForNode(node: VisualGraphNode): string[] {
  const raw = [
    node.id,
    node.label,
    node.kind,
    node.sourceSpan?.filePath,
    ...asArray(node.metadata?.routes),
    ...asArray(node.metadata?.selectors),
    ...asArray(node.metadata?.contractIds),
    ...asArray(node.metadata?.screenshotNames),
    ...asArray(node.metadata?.mutationOperators),
    String(node.metadata?.issueKind ?? ""),
    String(node.metadata?.severity ?? "")
  ];
  return unique(raw.flatMap((value) => tokenize(String(value ?? ""))));
}

function tokenize(value: string): string[] {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length >= 2);
}

function addSearchSeeds(graph: VisualGraph, seedIds: Set<string>, kind: VisualGraphNodeKind, text?: string): void {
  if (!text) return;
  for (const node of graph.nodes) {
    if (node.kind === kind && (node.id === `${kind}:${text}` || node.id.includes(text) || node.label === text || node.label.includes(text))) seedIds.add(node.id);
  }
}

function traverse(graph: VisualGraph, seeds: string[], depth: number): Set<string> {
  const visited = new Set<string>(seeds);
  let frontier = new Set<string>(seeds);
  for (let i = 0; i < depth; i += 1) {
    const next = new Set<string>();
    for (const edge of graph.edges) {
      if (frontier.has(edge.from) && !visited.has(edge.to)) next.add(edge.to);
      if (frontier.has(edge.to) && !visited.has(edge.from)) next.add(edge.from);
    }
    for (const id of next) visited.add(id);
    frontier = next;
    if (!frontier.size) break;
  }
  return visited;
}

function groupNodes(nodes: VisualGraphNode[]): Record<string, string[]> {
  const grouped: Record<string, string[]> = {};
  for (const node of nodes) {
    grouped[node.kind] = [...(grouped[node.kind] ?? []), node.id].sort();
  }
  return grouped;
}

function sourceFileFor(node: VisualGraphNode): string | undefined {
  return node.sourceSpan?.filePath ?? asArray(node.metadata?.sourceFiles)[0];
}

function heuristicMutationMatchesContract(operator: string, contract: VisualGraphNode): boolean {
  const selectors = asArray(contract.metadata?.selectors).join(" ");
  const screenshots = asArray(contract.metadata?.screenshotNames).join(" ");
  if (operator === "hide-critical-button") return selectors.includes("critical-action-button");
  if (operator === "force-login-on-demo") return selectors.includes("login-page") || selectors.includes("github-login-button");
  if (operator === "remove-demo-badge") return selectors.includes("demo-badge");
  if (operator === "mobile-overflow") return screenshots.includes("mobile") || asArray(contract.metadata?.viewports).includes("mobile");
  if (operator === "api-500" || operator === "empty-data") return /api|data|dashboard|screenshot/.test(`${selectors} ${screenshots}`.toLowerCase());
  return false;
}

function countCompleteChains(nodes: VisualGraphNode[], edges: VisualGraphEdge[]): number {
  const has = (kind: VisualGraphNodeKind) => nodes.some((node) => node.kind === kind);
  const hasRel = (relation: VisualGraphEdgeRelation) => edges.some((edge) => edge.relation === relation);
  return has("file") && has("component") && has("route") && has("contract") && has("screenshot") && has("mutation_operator") && hasRel("declares") && hasRel("captures") ? 1 : 0;
}

function relationToReferenceKind(relation: VisualGraphEdgeRelation): VisualGraphReferenceKind {
  if (relation === "renders") return "component_to_route";
  if (relation === "uses_selector") return "selector_to_component";
  if (relation === "covers_route") return "contract_to_route";
  if (relation === "captures") return "screenshot_to_component";
  if (relation === "mutates" || relation === "killed_by" || relation === "survived_by") return "mutation_to_contract";
  if (relation === "backs_issue" || relation === "assigned_to_agent") return "issue_to_artifact";
  return "artifact_to_graph_node";
}

function relationResolvedBy(relation: VisualGraphEdgeRelation, provenance: VisualGraphProvenance): VisualGraphResolvedBy {
  if (provenance === "config") return "config";
  if (provenance === "workflow") return "workflow_audit";
  if (provenance === "runtime_dom") return "runtime_dom";
  if (provenance === "screenshot") return "screenshot_metadata";
  if (provenance === "mutation_report" || relation === "mutates") return "mutation_mapping";
  if (relation === "covers_route") return "route_match";
  if (relation === "uses_selector") return "selector_match";
  return "exact_id";
}

function agentProfile(issue: VisualHiveIssueCandidate): string {
  const hint = String(issue.owningAgentHint ?? "");
  if (AGENT_PROFILES.includes(hint)) return hint;
  if (/mutation/i.test(issue.issueKind)) return "mutation_agent";
  if (/coverage|test/i.test(issue.issueKind)) return "test_creator_agent";
  if (/setup|workflow/i.test(issue.issueKind)) return "setup_agent";
  return "review_agent";
}

async function readOptionalJson<T>(repoRoot: string, relativePath: string): Promise<T | undefined> {
  const filePath = path.join(repoRoot, relativePath);
  try {
    await access(filePath);
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return undefined;
  }
}

function resolveArtifact(repoRoot: string, relativePath: string): string {
  const resolved = path.resolve(repoRoot, relativePath);
  if (!resolved.startsWith(repoRoot)) throw new Error(`Refusing to write Visual Graph artifact outside repository root: ${relativePath}`);
  return resolved;
}

function asArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function dedupeBy<T>(values: T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const value of values) {
    const id = key(value);
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(value);
  }
  return result;
}

function countBy<T>(values: T[], key: (value: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[key(value)] = (counts[key(value)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function maxIso(left: string, right: string): string {
  return left > right ? left : right;
}

function compareById(left: { id: string }, right: { id: string }): number {
  return left.id.localeCompare(right.id);
}
