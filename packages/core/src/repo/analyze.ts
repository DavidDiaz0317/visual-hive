import { access, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parseConfigText } from "../config/load.js";
import type { VisualHiveConfig } from "../config/schema.js";
import { mutationOperatorId } from "../mutations/operators.js";
import { getEvidenceResourceById } from "../tools/evidenceResources.js";
import { writeJson, writeText } from "../utils/files.js";
import { sanitizeText } from "../utils/sanitize.js";
import type {
  RepoCoverageGap,
  RepoMapReport,
  RepoMapOutputResource,
  RepoPackageInfo,
  RepoPackageManager,
  RepoRiskSignal,
  RepoRouteHint,
  RepoScriptInfo,
  RepoSelectorHint,
  RepoTargetHint,
  RepoVisualMap,
  RepoVisualMapEdge,
  RepoVisualMapFinding,
  RepoVisualMapNode,
  RepoVisualMapNodeKind,
  RepoVisualMapProvenance,
  RepoWorkflowHint
} from "./types.js";

export interface AnalyzeRepositoryOptions {
  repoRoot: string;
  now?: Date;
  maxSourceFiles?: number;
}

export interface WriteRepoMapOptions extends AnalyzeRepositoryOptions {
  outputPath?: string;
  markdownPath?: string;
}

interface PackageJsonShape {
  name?: string;
  private?: boolean;
  workspaces?: string[] | { packages?: string[] };
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

const MAX_SOURCE_FILES = 350;
const MAX_PACKAGE_FILES = 40;
const MAX_OUTPUT_HINTS = 50;
const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".vue", ".svelte", ".html"]);
const SKIPPED_DIRS = new Set([".git", ".visual-hive", "node_modules", "dist", "build", "coverage", ".next", "out", ".turbo"]);
const TEST_ID_PATTERN = /data-testid\s*=\s*["'`]([^"'`]+)["'`]/g;
const ROUTE_HINT_PATTERN = /\b(?:to|href|path)\s*=\s*["'`]((?:\/|#\/)[^"'`{}\s]*)["'`]|(?:route|path)\s*:\s*["'`]((?:\/|#\/)[^"'`{}\s]*)["'`]/g;
const DEFAULT_PREVIEW_URL = "http://127.0.0.1:4173";

export async function analyzeRepository(options: AnalyzeRepositoryOptions): Promise<RepoMapReport> {
  const repoRoot = path.resolve(options.repoRoot);
  const packageManager = await detectPackageManager(repoRoot);
  const packages = await collectPackages(repoRoot);
  const rootPackage = packages.find((pkg) => pkg.path === "package.json") ?? packages[0];
  const scripts = packages.flatMap((pkg) => pkg.scripts);
  const dependencyNames = unique(packages.flatMap((pkg) => pkg.dependencyNames));
  const frameworks = detectFrameworks(dependencyNames);
  const sourceFiles = await collectSourceFiles(repoRoot, options.maxSourceFiles ?? MAX_SOURCE_FILES);
  const selectors = await collectSelectors(repoRoot, sourceFiles);
  const routes = await collectRoutes(repoRoot, sourceFiles);
  const workflows = await collectWorkflows(repoRoot);
  const testTools = detectTestTools(dependencyNames, scripts, sourceFiles);
  const targetHints = targetHintsFor({ scripts, frameworks, workflows });
  const riskSignals = await riskSignalsFor({ repoRoot, scripts, selectors, routes, workflows, testTools });
  const coverageGaps = coverageGapsFor({ selectors, routes, workflows, testTools, riskSignals });
  const config = await readVisualHiveConfig(repoRoot);
  const visualMap = await buildVisualMap({
    repoRoot,
    generatedAt: (options.now ?? new Date()).toISOString(),
    sourceFiles,
    selectors,
    routes,
    targetHints,
    coverageGaps,
    config
  });
  const report: RepoMapReport = {
    schemaVersion: 1,
    generatedAt: (options.now ?? new Date()).toISOString(),
    repoRoot: ".",
    outputResource: catalogedRepoOutputResource(".visual-hive/repo-map.json"),
    project: {
      name: sanitizeText(rootPackage?.name ?? path.basename(repoRoot)),
      packageManager,
      workspaces: unique(packages.flatMap((pkg) => pkg.workspaces)),
      frameworks
    },
    packages,
    scripts: scripts.sort(compareScripts),
    sourceSummary: {
      scannedFiles: sourceFiles.length,
      truncated: sourceFiles.length >= (options.maxSourceFiles ?? MAX_SOURCE_FILES),
      extensions: extensionSummary(sourceFiles)
    },
    selectors: selectors.slice(0, MAX_OUTPUT_HINTS),
    routes: routes.slice(0, MAX_OUTPUT_HINTS),
    workflows,
    testTools,
    targetHints,
    riskSignals,
    coverageGaps,
    visualMap,
    recommendations: recommendationsFor({ selectors, routes, workflows, testTools, targetHints, riskSignals })
  };
  return sanitizeValue(report) as RepoMapReport;
}

export async function writeRepoMap(options: WriteRepoMapOptions): Promise<{ report: RepoMapReport; reportPath: string; markdownPath: string }> {
  const report = await analyzeRepository(options);
  const repoRoot = path.resolve(options.repoRoot);
  const reportPath = resolveArtifact(repoRoot, options.outputPath ?? ".visual-hive/repo-map.json");
  const markdownPath = resolveArtifact(repoRoot, options.markdownPath ?? ".visual-hive/repo-context.md");
  await writeJson(reportPath, report);
  await writeText(markdownPath, renderRepoContext(report));
  return { report, reportPath, markdownPath };
}

export function renderRepoContext(report: RepoMapReport): string {
  const lines = [
    `# Visual Hive Repo Context: ${report.project.name}`,
    "",
    "This file is generated by `visual-hive analyze`. It is read-only repo intelligence for humans and agents.",
    "",
    "## Summary",
    "",
    `- Package manager: ${report.project.packageManager}`,
    `- Workspaces: ${report.project.workspaces.length ? report.project.workspaces.join(", ") : "none detected"}`,
    `- Frameworks: ${report.project.frameworks.length ? report.project.frameworks.join(", ") : "none detected"}`,
    `- Scripts: ${report.scripts.length}`,
    `- Source files scanned: ${report.sourceSummary.scannedFiles}${report.sourceSummary.truncated ? " (truncated)" : ""}`,
    `- Stable selectors: ${report.selectors.length}`,
    `- Route hints: ${report.routes.length}`,
    `- Workflows: ${report.workflows.length}`,
    `- Test tools: ${report.testTools.length ? report.testTools.join(", ") : "none detected"}`,
    "",
    "## Target Hints",
    "",
    ...listOrNone(report.targetHints.map((hint) => `- ${hint.id}: ${hint.kind}, ${hint.confidence}${hint.command ? `, \`${hint.command}\`` : ""}`)),
    "",
    "## Selectors",
    "",
    ...listOrNone(report.selectors.slice(0, 12).map((selector) => `- ${selector.selector} (${selector.sourceFile}, ${selector.occurrences})`)),
    "",
    "## Routes",
    "",
    ...listOrNone(report.routes.slice(0, 12).map((route) => `- ${route.route} (${route.sourceFile}, ${route.occurrences})`)),
    "",
    "## Risk Signals",
    "",
    ...listOrNone(report.riskSignals.map((risk) => `- [${risk.severity}] ${risk.message}`)),
    "",
    "## Coverage Gaps",
    "",
    ...listOrNone(report.coverageGaps.map((gap) => `- [layer ${gap.layer}] ${gap.message} -> ${gap.suggestedArtifact}`)),
    "",
    "## Visual Map",
    "",
    `- Nodes: ${report.visualMap.summary.nodes}`,
    `- Edges: ${report.visualMap.summary.edges}`,
    `- Components: ${report.visualMap.summary.components}`,
    `- Routes: ${report.visualMap.summary.routes}`,
    `- Contracts: ${report.visualMap.summary.contracts}`,
    `- Screenshots: ${report.visualMap.summary.screenshots}`,
    `- Mutations: ${report.visualMap.summary.mutations}`,
    "",
    "### Key Relations",
    "",
    ...listOrNone(
      report.visualMap.edges
        .filter((edge) => ["impacts", "validated_by", "captures", "maps_mutation"].includes(edge.relation))
        .slice(0, 16)
        .map((edge) => `- ${edge.from} ${edge.relation} ${edge.to}`)
    ),
    "",
    "## Recommendations",
    "",
    ...listOrNone(report.recommendations.map((recommendation) => `- ${recommendation}`)),
    "",
    "Visual Hive uses this context as evidence for planning and agent handoff. It does not grant agents pass/fail authority."
  ];
  return lines.join("\n");
}

async function readVisualHiveConfig(repoRoot: string): Promise<VisualHiveConfig | undefined> {
  for (const candidate of ["visual-hive.config.yaml", path.join(".visual-hive", "visual-hive.config.yaml")]) {
    const configPath = path.join(repoRoot, candidate);
    const raw = await safeRead(configPath);
    if (!raw.trim()) continue;
    try {
      return parseConfigText(raw, configPath);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

async function buildVisualMap(input: {
  repoRoot: string;
  generatedAt: string;
  sourceFiles: string[];
  selectors: RepoSelectorHint[];
  routes: RepoRouteHint[];
  targetHints: RepoTargetHint[];
  coverageGaps: RepoCoverageGap[];
  config?: VisualHiveConfig;
}): Promise<RepoVisualMap> {
  const nodes = new Map<string, RepoVisualMapNode>();
  const edges = new Map<string, RepoVisualMapEdge>();
  const findings = new Map<string, RepoVisualMapFinding>();
  const addNode = nodeAdder(nodes, input.generatedAt);
  const addEdge = edgeAdder(edges);
  const addFinding = findingAdder(findings);

  for (const sourceFile of input.sourceFiles.map((filePath) => repoRelative(input.repoRoot, filePath))) {
    addNode("file", `file:${sourceFile}`, sourceFile, {
      sourceFiles: [sourceFile],
      provenance: { source: "static", confidence: "high", sourceFile }
    });
  }

  const componentNamesByFile = await collectComponents(input.repoRoot, input.sourceFiles);
  for (const [sourceFile, componentNames] of componentNamesByFile) {
    for (const componentName of componentNames) {
      const componentId = `component:${safeId(componentName)}`;
      addNode("component", componentId, componentName, {
        sourceFiles: [sourceFile],
        provenance: { source: "static", confidence: "medium", sourceFile }
      });
      addEdge(`file:${sourceFile}`, componentId, "declares", [`${sourceFile}:component:${componentName}`], "medium");
    }
  }

  for (const selector of input.selectors) {
    const selectorId = `selector:${safeId(selector.selector)}`;
    addNode("selector", selectorId, selector.selector, {
      sourceFiles: [selector.sourceFile],
      selectors: [selector.selector],
      provenance: { source: "static", confidence: "high", sourceFile: selector.sourceFile }
    });
    addEdge(`file:${selector.sourceFile}`, selectorId, "declares", [`${selector.sourceFile}:selector:${selector.selector}`], "high");
    const componentId = selectorComponentId(selector.selector, componentNamesByFile.get(selector.sourceFile));
    if (componentId) {
      addEdge(componentId, selectorId, "uses_selector", [selector.selector], "medium");
    }
    const layoutId = selectorLayoutId(selector.selector);
    if (layoutId) {
      addNode("layout", layoutId, labelFromId(layoutId), {
        sourceFiles: [selector.sourceFile],
        selectors: [selector.selector],
        provenance: { source: "derived", confidence: "medium", sourceFile: selector.sourceFile }
      });
      if (componentId) addEdge(componentId, layoutId, "renders", [selector.selector], "medium");
      addEdge(layoutId, selectorId, "uses_selector", [selector.selector], "medium");
    }
  }

  for (const route of input.routes) {
    const routeId = routeNodeId(route.route);
    addNode("route", routeId, route.route, {
      sourceFiles: [route.sourceFile],
      routes: [route.route],
      provenance: { source: "static", confidence: "medium", sourceFile: route.sourceFile }
    });
    addEdge(`file:${route.sourceFile}`, routeId, "declares", [route.route], "medium");
  }

  for (const targetHint of input.targetHints) {
    addNode("target", `target:${targetHint.id}`, targetHint.id, {
      targetIds: [targetHint.id],
      provenance: { source: "derived", confidence: targetHint.confidence }
    });
  }

  for (const gap of input.coverageGaps) {
    const gapId = `coverage_gap:${gap.id}`;
    addNode("coverage_gap", gapId, gap.message, {
      coverageGapIds: [gap.id],
      provenance: { source: "derived", confidence: "medium" },
      status: "active"
    });
    addFinding({
      id: gapId,
      fingerprint: fingerprint([gap.id, gap.message, gap.suggestedArtifact]),
      status: "active",
      severity: gap.severity === "high" ? "high" : gap.severity === "medium" ? "warning" : "info",
      message: gap.message,
      nodeIds: [gapId],
      evidence: [gap.suggestedArtifact]
    });
  }

  if (input.config) {
    addConfigVisualMap(input.config, { addNode, addEdge, addFinding, nodes, generatedAt: input.generatedAt });
  }

  for (const node of nodes.values()) {
    if (node.kind === "component" && node.contractIds.length === 0) {
      addFinding({
        id: `unverified:${node.id}`,
        fingerprint: fingerprint([node.id, "component-unverified"]),
        status: "unverified",
        severity: "info",
        message: `${node.label} was detected statically but has no direct contract relation yet.`,
        nodeIds: [node.id],
        evidence: node.sourceFiles
      });
    }
  }

  const nodeList = [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id));
  const edgeList = [...edges.values()].sort((a, b) => a.id.localeCompare(b.id));
  const findingList = [...findings.values()].sort((a, b) => a.id.localeCompare(b.id));

  return sanitizeValue({
    schemaVersion: 1,
    generatedAt: input.generatedAt,
    summary: {
      nodes: nodeList.length,
      edges: edgeList.length,
      routes: nodeList.filter((node) => node.kind === "route").length,
      components: nodeList.filter((node) => node.kind === "component").length,
      contracts: nodeList.filter((node) => node.kind === "contract").length,
      screenshots: nodeList.filter((node) => node.kind === "screenshot").length,
      mutations: nodeList.filter((node) => node.kind === "mutation").length,
      activeFindings: findingList.filter((finding) => finding.status === "active").length
    },
    lifecycle: "File -> Component -> Layout -> Route -> State -> Viewport -> Target -> Contract -> Screenshot -> Mutation -> Issue",
    nodes: nodeList,
    edges: edgeList,
    findings: findingList
  }) as RepoVisualMap;
}

function addConfigVisualMap(
  config: VisualHiveConfig,
  context: {
    addNode: ReturnType<typeof nodeAdder>;
    addEdge: ReturnType<typeof edgeAdder>;
    addFinding: ReturnType<typeof findingAdder>;
    nodes: Map<string, RepoVisualMapNode>;
    generatedAt: string;
  }
): void {
  for (const [targetId, target] of Object.entries(config.targets)) {
    context.addNode("target", `target:${targetId}`, targetId, {
      targetIds: [targetId],
      provenance: { source: "config", confidence: "high", sourceFile: "visual-hive.config.yaml" }
    });
    if (!target.prSafe) {
      context.addFinding({
        id: `protected-target:${targetId}`,
        fingerprint: fingerprint([targetId, "protected-target"]),
        status: "active",
        severity: "warning",
        message: `${targetId} is not PR-safe and should stay in trusted lanes.`,
        nodeIds: [`target:${targetId}`],
        evidence: ["visual-hive.config.yaml"]
      });
    }
  }

  for (const [viewportId, viewport] of Object.entries(config.viewports)) {
    context.addNode("viewport", `viewport:${viewportId}`, `${viewportId} ${viewport.width}x${viewport.height}`, {
      viewports: [viewportId],
      provenance: { source: "config", confidence: "high", sourceFile: "visual-hive.config.yaml" }
    });
  }

  for (const contract of config.contracts) {
    const contractId = `contract:${contract.id}`;
    context.addNode("contract", contractId, contract.id, {
      targetIds: [contract.target],
      contractIds: [contract.id],
      provenance: { source: "config", confidence: "high", sourceFile: "visual-hive.config.yaml" }
    });
    context.addEdge(contractId, `target:${contract.target}`, "targets", [`contract:${contract.id}:target:${contract.target}`], "high");

    for (const selector of allContractSelectors(contract)) {
      const selectorId = `selector:${safeId(selector)}`;
      context.addNode("selector", selectorId, selector, {
        selectors: [selector],
        contractIds: [contract.id],
        provenance: { source: "config", confidence: "high", sourceFile: "visual-hive.config.yaml" }
      });
      context.addEdge(contractId, selectorId, "uses_selector", [`contract:${contract.id}:selector:${selector}`], "high");
      const layoutId = selectorLayoutId(selector);
      if (layoutId) {
        context.addNode("layout", layoutId, labelFromId(layoutId), {
          selectors: [selector],
          contractIds: [contract.id],
          provenance: { source: "derived", confidence: "medium", sourceFile: "visual-hive.config.yaml" }
        });
        context.addEdge(layoutId, contractId, "validated_by", [`contract:${contract.id}:selector:${selector}`], "medium");
      }
    }

    for (const screenshot of contract.screenshots) {
      const routeId = routeNodeId(screenshot.route);
      const screenshotId = `screenshot:${contract.id}:${screenshot.name}:${screenshot.viewport}`;
      context.addNode("route", routeId, screenshot.route, {
        routes: [screenshot.route],
        contractIds: [contract.id],
        provenance: { source: "config", confidence: "high", sourceFile: "visual-hive.config.yaml" }
      });
      for (const state of statesFromRoute(screenshot.route)) {
        context.addNode("state", `state:${safeId(state)}`, state, {
          routes: [screenshot.route],
          states: [state],
          contractIds: [contract.id],
          provenance: { source: "config", confidence: "high", sourceFile: "visual-hive.config.yaml" }
        });
        context.addEdge(routeId, `state:${safeId(state)}`, "renders", [`route:${screenshot.route}`], "high");
      }
      context.addNode("screenshot", screenshotId, screenshot.name, {
        routes: [screenshot.route],
        viewports: [screenshot.viewport],
        contractIds: [contract.id],
        screenshotNames: [screenshot.name],
        provenance: { source: "config", confidence: "high", sourceFile: "visual-hive.config.yaml" }
      });
      context.addEdge(contractId, routeId, "covers_route", [`contract:${contract.id}:route:${screenshot.route}`], "high");
      context.addEdge(contractId, screenshotId, "captures", [`contract:${contract.id}:screenshot:${screenshot.name}`], "high");
      context.addEdge(screenshotId, `viewport:${screenshot.viewport}`, "uses_viewport", [`screenshot:${screenshot.name}:viewport:${screenshot.viewport}`], "high");
    }
  }

  for (const operator of config.mutation.operators) {
    const operatorId = mutationOperatorId(operator);
    const mutationId = `mutation:${operatorId}`;
    context.addNode("mutation", mutationId, operatorId, {
      mutationOperators: [operatorId],
      provenance: { source: "config", confidence: "high", sourceFile: "visual-hive.config.yaml" }
    });
    const mappedContracts = typeof operator === "string" ? [] : operator.contracts;
    for (const contractId of mappedContracts) {
      context.addEdge(mutationId, `contract:${contractId}`, "maps_mutation", [`mutation:${operatorId}:contract:${contractId}`], "high");
    }
    if (!mappedContracts.length) {
      context.addFinding({
        id: `mutation-unmapped:${operatorId}`,
        fingerprint: fingerprint([operatorId, "mutation-unmapped"]),
        status: "unverified",
        severity: "info",
        message: `${operatorId} relies on heuristic mutation-to-contract mapping.`,
        nodeIds: [mutationId],
        evidence: ["visual-hive.config.yaml"]
      });
    }
  }

  for (const rule of config.selection.changedFiles ?? []) {
    for (const contractId of rule.contracts) {
      for (const node of context.nodes.values()) {
        if (node.kind === "file" && minimatchLike(node.label, rule.pattern)) {
          context.addEdge(node.id, `contract:${contractId}`, "impacts", [`selection:${rule.pattern}:risk:${rule.risk}`], "medium");
        }
      }
    }
  }

  const dashboardComponent = context.nodes.get("component:app");
  if (dashboardComponent) {
    for (const edge of [...context.nodes.values()].filter((node) => node.kind === "route" || node.kind === "screenshot" || node.kind === "contract")) {
      if (edge.contractIds.includes("dashboard-visual-stability") || edge.routes.includes("/") || edge.routes.some((route) => route.startsWith("/?issue="))) {
        context.addEdge(dashboardComponent.id, edge.id, "impacts", ["derived:app-component-demo-impact"], "medium");
      }
    }
  }
}

function nodeAdder(nodes: Map<string, RepoVisualMapNode>, generatedAt: string) {
  return (
    kind: RepoVisualMapNodeKind,
    id: string,
    label: string,
    options: Partial<Omit<RepoVisualMapNode, "id" | "kind" | "label" | "provenance">> & { provenance: Partial<RepoVisualMapProvenance> }
  ) => {
    const existing = nodes.get(id);
    const provenance: RepoVisualMapProvenance = {
      source: options.provenance.source ?? "derived",
      confidence: options.provenance.confidence ?? "medium",
      sourceFile: options.provenance.sourceFile,
      generatedAt,
      firstSeen: generatedAt,
      lastValidated: options.provenance.source === "config" || options.provenance.source === "static" ? generatedAt : undefined
    };
    const next: RepoVisualMapNode = {
      id,
      kind,
      label: sanitizeText(label),
      status: options.status ?? "active",
      provenance,
      sourceFiles: unique(options.sourceFiles ?? []),
      routes: unique(options.routes ?? []),
      states: unique(options.states ?? []),
      viewports: unique(options.viewports ?? []),
      selectors: unique(options.selectors ?? []),
      targetIds: unique(options.targetIds ?? []),
      contractIds: unique(options.contractIds ?? []),
      screenshotNames: unique(options.screenshotNames ?? []),
      mutationOperators: unique(options.mutationOperators ?? []),
      coverageGapIds: unique(options.coverageGapIds ?? [])
    };
    nodes.set(id, existing ? mergeNode(existing, next) : next);
  };
}

function edgeAdder(edges: Map<string, RepoVisualMapEdge>) {
  return (from: string, to: string, relation: RepoVisualMapEdge["relation"], evidence: string[], confidence: RepoVisualMapEdge["confidence"]) => {
    const id = `${from}--${relation}--${to}`;
    const existing = edges.get(id);
    edges.set(id, {
      id,
      from,
      to,
      relation,
      evidence: unique([...(existing?.evidence ?? []), ...evidence]),
      confidence: existing?.confidence === "high" || confidence === "high" ? "high" : existing?.confidence ?? confidence
    });
  };
}

function findingAdder(findings: Map<string, RepoVisualMapFinding>) {
  return (finding: RepoVisualMapFinding) => {
    findings.set(finding.id, {
      ...finding,
      message: sanitizeText(finding.message),
      nodeIds: unique(finding.nodeIds),
      evidence: unique(finding.evidence)
    });
  };
}

async function collectComponents(repoRoot: string, sourceFiles: string[]): Promise<Map<string, string[]>> {
  const components = new Map<string, string[]>();
  for (const filePath of sourceFiles) {
    const relative = repoRelative(repoRoot, filePath);
    const content = await safeRead(filePath);
    const names = new Set<string>();
    for (const match of content.matchAll(/\b(?:export\s+)?function\s+([A-Z][A-Za-z0-9_]*)\s*\(/g)) names.add(match[1]);
    for (const match of content.matchAll(/\bconst\s+([A-Z][A-Za-z0-9_]*)\s*=\s*(?:\([^)]*\)|[A-Za-z0-9_]+)\s*=>/g)) names.add(match[1]);
    if (!names.size && path.basename(filePath).match(/^[A-Z]/)) names.add(path.basename(filePath, path.extname(filePath)));
    if (names.size) components.set(relative, [...names].sort());
  }
  return components;
}

function selectorComponentId(selector: string, componentNames?: string[]): string | undefined {
  if (selector.includes("dashboard-card")) return "component:dashboard-card";
  if (selector.includes("artifact-card")) return "component:artifact-card";
  if (selector.includes("login")) return "component:login";
  if (componentNames?.[0]) return `component:${safeId(componentNames[0])}`;
  return undefined;
}

function selectorLayoutId(selector: string): string | undefined {
  if (selector.includes("dashboard-page") || selector.includes("dashboard-card") || selector.includes("coverage-matrix") || selector.includes("target-lane-list")) {
    return "layout:dashboard-shell";
  }
  if (selector.includes("login-page") || selector.includes("github-login-button")) return "layout:auth-boundary";
  if (selector.includes("mobile-overflow")) return "layout:responsive-mobile";
  if (selector.includes("error-banner") || selector.includes("empty-data")) return "layout:data-state";
  return undefined;
}

function statesFromRoute(route: string): string[] {
  try {
    const url = new URL(route, "http://visual-hive.local");
    const issue = url.searchParams.get("issue");
    return issue ? [issue] : ["default"];
  } catch {
    return route.includes("?") ? [route.split("?")[1] ?? "custom-state"] : ["default"];
  }
}

function routeNodeId(route: string): string {
  if (route === "/" || route.trim() === "") return "route:root";
  return `route:${safeId(route)}`;
}

function allContractSelectors(contract: VisualHiveConfig["contracts"][number]): string[] {
  return unique([
    ...(contract.selectors.mustExist ?? []),
    ...(contract.selectors.mustNotExist ?? []),
    ...(contract.waitFor ?? []).map((wait) => wait.selector),
    ...(contract.steps ?? []).map((step) => step.selector ?? "").filter(Boolean)
  ]);
}

function mergeNode(left: RepoVisualMapNode, right: RepoVisualMapNode): RepoVisualMapNode {
  return {
    ...left,
    status: left.status === "active" || right.status === "active" ? "active" : left.status,
    provenance: left.provenance.confidence === "high" ? left.provenance : right.provenance,
    sourceFiles: unique([...left.sourceFiles, ...right.sourceFiles]),
    routes: unique([...left.routes, ...right.routes]),
    states: unique([...left.states, ...right.states]),
    viewports: unique([...left.viewports, ...right.viewports]),
    selectors: unique([...left.selectors, ...right.selectors]),
    targetIds: unique([...left.targetIds, ...right.targetIds]),
    contractIds: unique([...left.contractIds, ...right.contractIds]),
    screenshotNames: unique([...left.screenshotNames, ...right.screenshotNames]),
    mutationOperators: unique([...left.mutationOperators, ...right.mutationOperators]),
    coverageGapIds: unique([...left.coverageGapIds, ...right.coverageGapIds])
  };
}

function labelFromId(id: string): string {
  return id.split(":").at(-1)?.replaceAll("-", " ") ?? id;
}

function safeId(value: string): string {
  return sanitizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "unknown";
}

function fingerprint(values: string[]): string {
  let hash = 0;
  for (const char of values.join("|")) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function minimatchLike(filePath: string, pattern: string): boolean {
  if (pattern.endsWith("/**")) return filePath.startsWith(pattern.slice(0, -3));
  if (pattern.endsWith("/**/*")) return filePath.startsWith(pattern.slice(0, -5));
  if (pattern.endsWith("**")) return filePath.startsWith(pattern.slice(0, -2));
  if (pattern.includes("*")) {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("**", ".*").replaceAll("*", "[^/]*");
    return new RegExp(`^${escaped}$`).test(filePath);
  }
  return filePath === pattern;
}

async function collectPackages(repoRoot: string): Promise<RepoPackageInfo[]> {
  const packageFiles: string[] = [];
  await walk(repoRoot, async (filePath) => {
    if (path.basename(filePath) === "package.json" && packageFiles.length < MAX_PACKAGE_FILES) packageFiles.push(filePath);
  });
  const packages = await Promise.all(
    packageFiles.map(async (filePath) => {
      const rel = repoRelative(repoRoot, filePath);
      const parsed = await readPackageJson(filePath);
      const scripts = Object.entries(parsed?.scripts ?? {}).map(([name, command]) => ({
        packagePath: rel,
        name: sanitizeText(name),
        command: sanitizeText(String(command))
      }));
      return {
        path: rel,
        name: parsed?.name ? sanitizeText(parsed.name) : undefined,
        private: parsed?.private,
        workspaces: workspacePatterns(parsed),
        scripts,
        dependencyNames: dependencyNames(parsed)
      };
    })
  );
  return packages.sort((a, b) => a.path.localeCompare(b.path));
}

async function readPackageJson(filePath: string): Promise<PackageJsonShape | undefined> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as PackageJsonShape;
  } catch {
    return undefined;
  }
}

async function detectPackageManager(repoRoot: string): Promise<RepoPackageManager> {
  if (await exists(path.join(repoRoot, "pnpm-lock.yaml"))) return "pnpm";
  if (await exists(path.join(repoRoot, "yarn.lock"))) return "yarn";
  if (await exists(path.join(repoRoot, "package-lock.json"))) return "npm";
  return "unknown";
}

async function collectSourceFiles(repoRoot: string, maxSourceFiles: number): Promise<string[]> {
  const files: string[] = [];
  await walk(repoRoot, async (filePath) => {
    if (files.length >= maxSourceFiles) return;
    if (SOURCE_EXTENSIONS.has(path.extname(filePath).toLowerCase())) files.push(filePath);
  });
  return files.sort();
}

async function collectSelectors(repoRoot: string, sourceFiles: string[]): Promise<RepoSelectorHint[]> {
  const counts = new Map<string, RepoSelectorHint>();
  for (const filePath of sourceFiles) {
    const content = await safeRead(filePath);
    for (const match of content.matchAll(TEST_ID_PATTERN)) {
      const selector = `[data-testid='${match[1]}']`;
      const key = `${selector}:${repoRelative(repoRoot, filePath)}`;
      const existing = counts.get(key);
      if (existing) existing.occurrences += 1;
      else counts.set(key, { selector: sanitizeText(selector), sourceFile: repoRelative(repoRoot, filePath), occurrences: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.occurrences - a.occurrences || a.selector.localeCompare(b.selector));
}

async function collectRoutes(repoRoot: string, sourceFiles: string[]): Promise<RepoRouteHint[]> {
  const counts = new Map<string, RepoRouteHint>();
  for (const filePath of sourceFiles) {
    const content = await safeRead(filePath);
    for (const match of content.matchAll(ROUTE_HINT_PATTERN)) {
      const route = match[1] ?? match[2];
      if (!route || route.length > 120 || route.startsWith("//")) continue;
      const key = `${route}:${repoRelative(repoRoot, filePath)}`;
      const existing = counts.get(key);
      if (existing) existing.occurrences += 1;
      else counts.set(key, { route: sanitizeText(route), sourceFile: repoRelative(repoRoot, filePath), occurrences: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.occurrences - a.occurrences || a.route.localeCompare(b.route));
}

async function collectWorkflows(repoRoot: string): Promise<RepoWorkflowHint[]> {
  const workflowRoot = path.join(repoRoot, ".github", "workflows");
  const files: string[] = [];
  await walk(workflowRoot, async (filePath) => {
    if ([".yml", ".yaml"].includes(path.extname(filePath).toLowerCase())) files.push(filePath);
  });
  return Promise.all(
    files.sort().map(async (filePath) => {
      const raw = await safeRead(filePath);
      return {
        path: repoRelative(repoRoot, filePath),
        triggers: detectWorkflowTriggers(raw),
        permissions: detectWorkflowPermissions(raw),
        usesPullRequestTarget: /\bpull_request_target\b/.test(raw),
        usesSecrets: /\bsecrets\./i.test(raw),
        uploadsArtifacts: /upload-artifact/i.test(raw),
        visualHiveRelated: /visual-hive|visual_hive/i.test(raw)
      };
    })
  );
}

function detectWorkflowTriggers(raw: string): string[] {
  return ["pull_request_target", "pull_request", "workflow_run", "workflow_dispatch", "schedule", "push"].filter((trigger) =>
    new RegExp(`\\b${trigger}\\b`).test(raw)
  );
}

function detectWorkflowPermissions(raw: string): string[] {
  const permissions = new Set<string>();
  for (const match of raw.matchAll(/^\s{2,}([a-z-]+):\s*(read|write|none)\s*$/gim)) {
    permissions.add(`${match[1]}:${match[2]}`);
  }
  return [...permissions].sort();
}

function detectFrameworks(deps: string[]): string[] {
  const frameworks = new Set<string>();
  for (const dep of deps) {
    if (["react", "vue", "svelte", "angular", "astro", "vite", "next", "nuxt", "solid-js"].includes(dep)) frameworks.add(dep);
    if (dep.startsWith("@storybook/") || dep === "storybook") frameworks.add("storybook");
  }
  return [...frameworks].sort();
}

function detectTestTools(deps: string[], scripts: RepoScriptInfo[], sourceFiles: string[]): string[] {
  const tools = new Set<string>();
  const corpus = `${deps.join(" ")} ${scripts.map((script) => `${script.name} ${script.command}`).join(" ")} ${sourceFiles.join(" ")}`.toLowerCase();
  for (const tool of ["playwright", "vitest", "jest", "cypress", "storybook", "testing-library", "axe", "eslint", "typescript"]) {
    if (corpus.includes(tool)) tools.add(tool);
  }
  if (corpus.includes("@playwright/test")) tools.add("playwright");
  return [...tools].sort();
}

function targetHintsFor(input: { scripts: RepoScriptInfo[]; frameworks: string[]; workflows: RepoWorkflowHint[] }): RepoTargetHint[] {
  const hints: RepoTargetHint[] = [];
  const scripts = input.scripts;
  const preview = findScript(scripts, ["preview", "serve"]);
  const dev = findScript(scripts, ["dev", "start"]);
  const storybook = findScript(scripts, ["storybook", "storybook:dev", "dev:storybook"]);
  const buildStorybook = findScript(scripts, ["build-storybook", "storybook:build"]);
  if (preview) {
    hints.push({
      id: "localPreview",
      kind: "command",
      confidence: "high",
      command: scriptRunner(preview.packagePath, preview.name),
      url: DEFAULT_PREVIEW_URL,
      evidence: [`script:${preview.packagePath}:${preview.name}`]
    });
  } else if (dev) {
    hints.push({
      id: "localDev",
      kind: "command",
      confidence: "medium",
      command: scriptRunner(dev.packagePath, dev.name),
      url: "http://127.0.0.1:3000",
      evidence: [`script:${dev.packagePath}:${dev.name}`]
    });
  }
  if (storybook) {
    hints.push({
      id: "componentLibrary",
      kind: "storybook",
      confidence: buildStorybook ? "high" : "medium",
      command: scriptRunner(storybook.packagePath, storybook.name),
      url: "http://127.0.0.1:6006",
      evidence: [`script:${storybook.packagePath}:${storybook.name}`, buildStorybook ? `script:${buildStorybook.packagePath}:${buildStorybook.name}` : ""].filter(Boolean)
    });
  }
  if (input.workflows.some((workflow) => /vercel|deploy|preview/i.test(workflow.path) || /vercel|deploy|preview/i.test(workflow.triggers.join(" ")))) {
    hints.push({
      id: "deployPreview",
      kind: "deployPreview",
      confidence: "low",
      evidence: ["workflow preview/deploy hints detected"]
    });
  }
  if (scripts.some((script) => /backend|api|server/i.test(`${script.name} ${script.command}`)) && scripts.some((script) => /frontend|web|preview|dev/i.test(`${script.name} ${script.command}`))) {
    hints.push({
      id: "localFullstack",
      kind: "commandGroup",
      confidence: "medium",
      evidence: ["frontend and backend script hints detected"]
    });
  }
  return hints;
}

async function riskSignalsFor(input: {
  repoRoot: string;
  scripts: RepoScriptInfo[];
  selectors: RepoSelectorHint[];
  routes: RepoRouteHint[];
  workflows: RepoWorkflowHint[];
  testTools: string[];
}): Promise<RepoRiskSignal[]> {
  const risks: RepoRiskSignal[] = [];
  if (!(await exists(path.join(input.repoRoot, "visual-hive.config.yaml"))) && !(await exists(path.join(input.repoRoot, ".visual-hive", "visual-hive.config.yaml")))) {
    risks.push(risk("missing_visual_hive_config", "warning", "No Visual Hive config was detected.", ["visual-hive.config.yaml"], "Run `visual-hive recommend --write-config` after reviewing the generated config."));
  }
  if (!findScript(input.scripts, ["build"])) {
    risks.push(risk("missing_build_script", "warning", "No build script was detected.", ["package.json scripts"], "Add or document a build command so command targets can run before preview."));
  }
  if (!findScript(input.scripts, ["preview", "serve", "dev", "start"])) {
    risks.push(risk("missing_serve_script", "high", "No preview/dev/serve script was detected.", ["package.json scripts"], "Expose a local preview command for deterministic browser checks."));
  }
  if (!input.selectors.length) {
    risks.push(risk("missing_stable_selectors", "high", "No data-testid selectors were detected.", ["source scan"], "Add stable user-visible selectors for important screens and controls."));
  }
  if (!input.routes.length) {
    risks.push(risk("missing_route_hints", "warning", "No route hints were detected.", ["source scan"], "Document important routes in visual-hive.config.yaml contracts."));
  }
  if (!input.testTools.includes("playwright")) {
    risks.push(risk("missing_playwright", "warning", "Playwright dependency or script was not detected.", ["dependencies/scripts"], "Install Playwright or rely on Visual Hive workspace tooling during setup."));
  }
  if (!input.testTools.some((tool) => ["vitest", "jest"].includes(tool))) {
    risks.push(risk("missing_unit_test_signal", "info", "No Vitest/Jest unit test signal was detected.", ["dependencies/scripts"], "Keep unit tests alongside Visual Hive user-visible contracts."));
  }
  if (!input.workflows.length) {
    risks.push(risk("missing_workflows", "warning", "No GitHub Actions workflows were detected.", [".github/workflows"], "Add a read-only Visual Hive pull_request workflow when ready."));
  }
  for (const workflow of input.workflows) {
    if (workflow.usesPullRequestTarget) {
      risks.push(risk("workflow_pull_request_target", "high", `${workflow.path} uses pull_request_target.`, [workflow.path], "Do not execute untrusted PR code from pull_request_target workflows."));
    }
    if (workflow.usesSecrets && workflow.triggers.includes("pull_request")) {
      risks.push(risk("workflow_pr_secrets", "high", `${workflow.path} references secrets in a pull_request workflow.`, [workflow.path], "Keep PR workflows read-only and secret-free."));
    }
  }
  return risks;
}

function coverageGapsFor(input: {
  selectors: RepoSelectorHint[];
  routes: RepoRouteHint[];
  workflows: RepoWorkflowHint[];
  testTools: string[];
  riskSignals: RepoRiskSignal[];
}): RepoCoverageGap[] {
  const gaps: RepoCoverageGap[] = [];
  if (input.riskSignals.some((risk) => risk.id === "missing_visual_hive_config")) {
    gaps.push(gap("repo-intelligence-config", 0, "medium", "Visual Hive config is not present yet.", ".visual-hive/recommendations.json"));
  }
  if (!input.workflows.length) gaps.push(gap("workflow-safety", 1, "medium", "No workflow safety lane was detected.", ".visual-hive/workflows.json"));
  if (!input.testTools.some((tool) => ["vitest", "jest"].includes(tool))) gaps.push(gap("unit-layer", 2, "low", "Unit test layer is not visible from repo scripts/dependencies.", "package.json"));
  if (!input.testTools.includes("playwright")) gaps.push(gap("e2e-layer", 6, "medium", "Playwright E2E layer is not visible from repo scripts/dependencies.", "visual-hive.config.yaml"));
  if (!input.selectors.length) gaps.push(gap("selector-contracts", 6, "high", "No stable selectors were found for user-visible contracts.", "visual-hive.config.yaml"));
  if (!input.routes.length) gaps.push(gap("route-coverage", 6, "medium", "No route hints were found for route-level visual contracts.", "visual-hive.config.yaml"));
  return gaps;
}

function recommendationsFor(input: {
  selectors: RepoSelectorHint[];
  routes: RepoRouteHint[];
  workflows: RepoWorkflowHint[];
  testTools: string[];
  targetHints: RepoTargetHint[];
  riskSignals: RepoRiskSignal[];
}): string[] {
  const recommendations = new Set<string>();
  recommendations.add("Run `visual-hive recommend` to compare this repo map with a generated starter config.");
  if (input.targetHints.length) recommendations.add("Use detected target hints to create PR-safe local preview or Storybook targets.");
  if (input.selectors.length) recommendations.add("Prefer detected data-testid selectors when authoring contracts.");
  if (input.routes.length) recommendations.add("Map important route hints to screenshot and user-flow contracts.");
  if (!input.workflows.some((workflow) => workflow.visualHiveRelated)) recommendations.add("Add a read-only pull_request Visual Hive workflow after local validation.");
  if (input.riskSignals.some((risk) => risk.severity === "high")) recommendations.add("Resolve high-severity repo risks before making Visual Hive checks required.");
  recommendations.add("Keep LLMs, MCP tools, and Hive handoff advisory; use deterministic evidence for verdicts.");
  return [...recommendations];
}

function dependencyNames(pkg?: PackageJsonShape): string[] {
  return unique([
    ...Object.keys(pkg?.dependencies ?? {}),
    ...Object.keys(pkg?.devDependencies ?? {}),
    ...Object.keys(pkg?.optionalDependencies ?? {})
  ]);
}

function workspacePatterns(pkg?: PackageJsonShape): string[] {
  if (Array.isArray(pkg?.workspaces)) return pkg.workspaces.map((item) => sanitizeText(item));
  if (Array.isArray(pkg?.workspaces?.packages)) return pkg.workspaces.packages.map((item) => sanitizeText(item));
  return [];
}

function findScript(scripts: RepoScriptInfo[], names: string[]): RepoScriptInfo | undefined {
  return scripts.find((script) => names.includes(script.name));
}

function scriptRunner(packagePath: string, scriptName: string): string {
  const dir = path.dirname(packagePath).replaceAll("\\", "/");
  const prefix = dir === "." ? "" : `cd ${dir} && `;
  return `${prefix}npm run ${scriptName}`;
}

function risk(id: string, severity: RepoRiskSignal["severity"], message: string, evidence: string[], recommendation: string): RepoRiskSignal {
  return { id, severity, message: sanitizeText(message), evidence: evidence.map(sanitizeText), recommendation: sanitizeText(recommendation) };
}

function gap(id: string, layer: number, severity: RepoCoverageGap["severity"], message: string, suggestedArtifact: string): RepoCoverageGap {
  return { id, layer, severity, message: sanitizeText(message), suggestedArtifact: sanitizeText(suggestedArtifact) };
}

async function walk(dir: string, visit: (filePath: string) => Promise<void>): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIPPED_DIRS.has(entry.name)) continue;
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(child, visit);
    } else if (entry.isFile()) {
      await visit(child);
    }
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function safeRead(filePath: string): Promise<string> {
  try {
    const fileStat = await stat(filePath);
    if (fileStat.size > 512_000) return "";
    return await readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

function extensionSummary(files: string[]): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const file of files) {
    const ext = path.extname(file).toLowerCase() || "(none)";
    summary[ext] = (summary[ext] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(summary).sort(([a], [b]) => a.localeCompare(b)));
}

function repoRelative(repoRoot: string, filePath: string): string {
  return path.relative(repoRoot, filePath).replaceAll("\\", "/") || ".";
}

function resolveArtifact(repoRoot: string, filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(repoRoot, filePath);
}

function catalogedRepoOutputResource(artifactPath: string): RepoMapOutputResource {
  const resource = getEvidenceResourceById("repo-map");
  return {
    artifactPath,
    evidenceResourceId: resource?.id ?? "repo-map",
    evidenceResourceUri: resource?.uri ?? "visual-hive://repo-map",
    evidenceResourceTitle: resource?.title ?? "Repository Intelligence Map",
    evidenceResourceDescription:
      resource?.description ??
      "Sanitized deterministic repository scan with package manager, frameworks, scripts, selectors, route hints, workflow hints, risk signals, and coverage gaps.",
    evidenceReadToolName: resource?.readTool?.name ?? "visual_hive_read_repo_map"
  };
}

function compareScripts(a: RepoScriptInfo, b: RepoScriptInfo): number {
  return a.packagePath.localeCompare(b.packagePath) || a.name.localeCompare(b.name);
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean).map((value) => sanitizeText(value)))].sort();
}

function listOrNone(lines: string[]): string[] {
  return lines.length ? lines : ["- none"];
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === "string") return sanitizeText(value);
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, sanitizeValue(child)]));
  return value;
}
