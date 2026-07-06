import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  analyzeVisualImpact,
  readVisualGraph,
  renderVisualGraphSummary,
  searchVisualGraph,
  writeRepoMap,
  writeVisualImpact,
  type VisualGraph,
  type VisualGraphSearchResult,
  type VisualImpactReport
} from "@visual-hive/core";

export interface GraphCommandOptions {
  repo?: string;
  format?: "markdown" | "json";
  write?: boolean;
  changedFiles?: string;
  issue?: string;
  contract?: string;
  mutation?: string;
  route?: string;
  output?: string;
}

export async function ensureVisualGraph(repo = process.cwd()): Promise<{ graph: VisualGraph; repoRoot: string }> {
  const repoRoot = path.resolve(repo);
  try {
    return { graph: await readVisualGraph(repoRoot), repoRoot };
  } catch {
    const result = await writeRepoMap({ repoRoot });
    return { graph: await readVisualGraph(repoRoot), repoRoot: path.dirname(path.dirname(result.reportPath)) };
  }
}

export async function runGraphSearchCommand(query: string, options: GraphCommandOptions = {}): Promise<{ graph: VisualGraph; results: VisualGraphSearchResult[] }> {
  const { graph } = await ensureVisualGraph(options.repo);
  return { graph, results: searchVisualGraph(graph, query) };
}

export async function runGraphNodeCommand(id: string, options: GraphCommandOptions = {}): Promise<{ graph: VisualGraph; node: VisualGraph["nodes"][number]; edges: VisualGraph["edges"] }> {
  const { graph } = await ensureVisualGraph(options.repo);
  const node = graph.nodes.find((candidate) => candidate.id === id || candidate.id.endsWith(`:${id}`));
  if (!node) throw new Error(`Visual Graph node not found: ${id}`);
  const edges = graph.edges.filter((edge) => edge.from === node.id || edge.to === node.id);
  return { graph, node, edges };
}

export async function runGraphImpactCommand(options: GraphCommandOptions = {}): Promise<{ graph: VisualGraph; impact: VisualImpactReport; outputPath?: string }> {
  const { graph, repoRoot } = await ensureVisualGraph(options.repo);
  const query: VisualImpactReport["query"] = {
    changedFiles: options.changedFiles ? await readChangedFiles(options.changedFiles) : [],
    issue: options.issue,
    contract: options.contract,
    mutation: options.mutation,
    route: options.route
  };
  if (options.write ?? true) {
    const written = await writeVisualImpact({ repoRoot, graph, query, outputPath: options.output });
    return { graph, impact: written.impact, outputPath: written.outputPath };
  }
  return { graph, impact: analyzeVisualImpact(graph, query) };
}

export async function runGraphRouteCommand(route: string, options: GraphCommandOptions = {}): Promise<{ graph: VisualGraph; impact: VisualImpactReport }> {
  const { graph } = await ensureVisualGraph(options.repo);
  return { graph, impact: analyzeVisualImpact(graph, { changedFiles: [], route }) };
}

export async function runGraphContractCommand(contract: string, options: GraphCommandOptions = {}): Promise<{ graph: VisualGraph; impact: VisualImpactReport }> {
  const { graph } = await ensureVisualGraph(options.repo);
  return { graph, impact: analyzeVisualImpact(graph, { changedFiles: [], contract }) };
}

export async function runGraphMutationCommand(mutation: string, options: GraphCommandOptions = {}): Promise<{ graph: VisualGraph; impact: VisualImpactReport }> {
  const { graph } = await ensureVisualGraph(options.repo);
  return { graph, impact: analyzeVisualImpact(graph, { changedFiles: [], mutation }) };
}

export function formatGraphSearch(result: { graph: VisualGraph; results: VisualGraphSearchResult[] }, format: "markdown" | "json" = "markdown"): string {
  if (format === "json") return JSON.stringify(result.results, null, 2);
  return [
    `# Visual Graph Search: ${result.graph.project}`,
    "",
    ...listOrNone(result.results.map((item) => `- ${item.node.id} (${item.node.kind}, score ${item.score}) — ${item.node.label}`))
  ].join("\n");
}

export function formatGraphNode(result: Awaited<ReturnType<typeof runGraphNodeCommand>>, format: "markdown" | "json" = "markdown"): string {
  if (format === "json") return JSON.stringify({ node: result.node, edges: result.edges }, null, 2);
  return [
    `# Visual Graph Node: ${result.node.id}`,
    "",
    `- Kind: ${result.node.kind}`,
    `- Label: ${result.node.label}`,
    `- Status: ${result.node.status}`,
    `- Confidence: ${result.node.confidence}`,
    `- Artifacts: ${result.node.evidenceArtifacts.length ? result.node.evidenceArtifacts.join(", ") : "none"}`,
    "",
    "## Edges",
    "",
    ...listOrNone(result.edges.map((edge) => `- ${edge.from} ${edge.relation} ${edge.to}`))
  ].join("\n");
}

export function formatGraphImpact(result: { graph: VisualGraph; impact: VisualImpactReport; outputPath?: string }, format: "markdown" | "json" = "markdown"): string {
  if (format === "json") return JSON.stringify(result.impact, null, 2);
  return [
    `# Visual Impact: ${result.graph.project}`,
    "",
    result.outputPath ? `Wrote ${result.outputPath}` : undefined,
    `Affected nodes: ${result.impact.summary.affectedNodeCount}`,
    `Routes: ${result.impact.summary.affectedRouteCount}`,
    `Contracts: ${result.impact.summary.affectedContractCount}`,
    `Screenshots: ${result.impact.summary.affectedScreenshotCount}`,
    `Mutations: ${result.impact.summary.affectedMutationCount}`,
    "",
    "## Validation",
    "",
    ...result.impact.validationCommands.map((command) => `- \`${command}\``),
    "",
    "## Affected Nodes",
    "",
    ...listOrNone(result.impact.affectedNodes.slice(0, 30).map((node) => `- ${node.id} (${node.kind})`))
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}

export function formatGraphSummary(graph: VisualGraph, format: "markdown" | "json" = "markdown"): string {
  return format === "json" ? JSON.stringify(graph, null, 2) : renderVisualGraphSummary(graph);
}

async function readChangedFiles(filePath: string): Promise<string[]> {
  const raw = await readFile(path.resolve(filePath), "utf8");
  return raw
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);
}

function listOrNone(lines: string[]): string[] {
  return lines.length ? lines : ["- none"];
}
