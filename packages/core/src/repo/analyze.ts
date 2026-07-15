import { access, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { minimatch } from "minimatch";
import { parse as parseYaml } from "yaml";
import { parseConfigText } from "../config/load.js";
import type { VisualHiveConfig } from "../config/schema.js";
import { mutationOperatorId } from "../mutations/operators.js";
import { writeVisualGraphArtifacts } from "../graph/build.js";
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
  RepoRuntimeScopeInfo,
  RepoScriptInfo,
  RepoSelectorHint,
  RepoTargetHint,
  RepoTestFileInfo,
  RepoTestRunnerInfo,
  RepoTestRuntime,
  RepoVisualMap,
  RepoVisualMapEdge,
  RepoVisualMapFinding,
  RepoVisualMapNode,
  RepoVisualMapNodeKind,
  RepoVisualMapProvenance,
  RepoWorkflowHint
} from "./types.js";
import { incompleteUnitTestScopeMessages, isSafeStructuredRunnerCommand, unitTestScopes } from "./testEvidence.js";

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
const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".vue", ".svelte", ".html"]);
const TEST_SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts", ".vue", ".svelte", ".astro", ".py", ".go", ".java", ".kt", ".kts", ".rb", ".php", ".rs"]);
const SKIPPED_DIRS = new Set([".git", ".visual-hive", "node_modules", "dist", "build", "coverage", ".next", "out", ".turbo", "test-results", "playwright-report", ".venv", "venv", "site-packages", "vendor", "target", ".tox", ".nox", ".pytest_cache", "__pycache__"]);
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
  const scopeCache = new Map<string, string>();
  let testFiles = await collectTestFiles(repoRoot, scopeCache);
  const runtimeScopes = await collectRuntimeScopes(repoRoot, scopeCache);
  const testRunners = await detectTestRunners(repoRoot, packageManager, packages, scripts, testFiles, runtimeScopes);
  testFiles = await markRunnerEligibleTestFiles(repoRoot, testFiles, testRunners);
  const testTools = detectTestTools(dependencyNames, scripts, sourceFiles, testFiles, testRunners);
  const targetHints = targetHintsFor({ scripts, frameworks, workflows });
  const riskSignals = await riskSignalsFor({ repoRoot, scripts, selectors, routes, workflows, testTools, testFiles, testRunners, runtimeScopes });
  const coverageGaps = coverageGapsFor({ selectors, routes, workflows, testTools, testFiles, testRunners, runtimeScopes, riskSignals });
  const config = await readVisualHiveConfig(repoRoot);
  const previousVisualMap = await readPreviousVisualMap(repoRoot);
  const visualMap = await buildVisualMap({
    repoRoot,
    generatedAt: (options.now ?? new Date()).toISOString(),
    sourceFiles,
    selectors,
    routes,
    targetHints,
    coverageGaps,
    config,
    previousVisualMap
  });
  const report: RepoMapReport = {
    schemaVersion: 1,
    generatedAt: (options.now ?? new Date()).toISOString(),
    repoRoot: ".",
    outputResource: catalogedRepoOutputResource(".visual-hive/repo-map.json"),
    visualGraphOutputResources: {
      graph: catalogedRepoOutputResource(".visual-hive/visual-graph.json"),
      summary: catalogedRepoOutputResource(".visual-hive/visual-graph-summary.md"),
      vocabulary: catalogedRepoOutputResource(".visual-hive/visual-graph-vocab.json"),
      unresolved: catalogedRepoOutputResource(".visual-hive/visual-graph-unresolved.json")
    },
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
    testFiles,
    testRunners,
    runtimeScopes,
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
  await writeVisualGraphArtifacts({ repoRoot, repoMap: report, now: options.now });
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
    `- Test files: ${report.testFiles.length} (${report.testFiles.filter((file) => file.kind === "unit").length} unit, ${report.testFiles.filter((file) => file.kind === "component").length} component, ${report.testFiles.filter((file) => file.kind === "integration").length} integration, ${report.testFiles.filter((file) => file.kind === "e2e").length} e2e)`,
    `- Test runners: ${report.testRunners.length ? report.testRunners.map((runner) => `${runner.tool}/${runner.runtime}/${runner.kind}`).join(", ") : "none detected"}`,
    `- Runtime scopes: ${report.runtimeScopes.length ? report.runtimeScopes.map((scope) => `${scope.runtime}:${scope.scope}`).join(", ") : "none detected"}`,
    "",
    "## Test Evidence",
    "",
    ...listOrNone(report.testFiles.slice(0, 20).map((file) => `- [${file.kind}] ${file.path}${file.tools.length ? ` (${file.tools.join(", ")})` : ""}`)),
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

async function readPreviousVisualMap(repoRoot: string): Promise<RepoVisualMap | undefined> {
  const raw = await safeRead(path.join(repoRoot, ".visual-hive", "repo-map.json"));
  if (!raw.trim()) return undefined;
  try {
    const parsed = JSON.parse(raw) as Partial<RepoMapReport>;
    return parsed.visualMap;
  } catch {
    return undefined;
  }
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
  previousVisualMap?: RepoVisualMap;
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
      const kind = visualOwnerKind(componentName);
      const componentId = `${kind}:${safeId(componentName)}`;
      addNode(kind, componentId, componentName, {
        sourceFiles: [sourceFile],
        provenance: { source: "static", confidence: "medium", sourceFile }
      });
      addEdge(`file:${sourceFile}`, componentId, "declares", [`${sourceFile}:${kind}:${componentName}`], "medium");
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
    const componentId = selectorOwnerId(componentNamesByFile.get(selector.sourceFile));
    if (componentId) {
      addEdge(componentId, selectorId, "uses_selector", [selector.selector], "medium");
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
  const findingList = reconcileFindings([...findings.values()], input.previousVisualMap, input.generatedAt).sort((a, b) => a.id.localeCompare(b.id));

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

function reconcileFindings(
  currentFindings: RepoVisualMapFinding[],
  previousVisualMap: RepoVisualMap | undefined,
  generatedAt: string
): RepoVisualMapFinding[] {
  if (!previousVisualMap?.findings?.length) {
    return currentFindings.map((finding) => ({
      ...finding,
      previouslySeen: false,
      firstSeen: generatedAt,
      lastSeen: generatedAt
    }));
  }

  const previousByFingerprint = new Map(previousVisualMap.findings.map((finding) => [finding.fingerprint, finding]));
  const currentFingerprints = new Set(currentFindings.map((finding) => finding.fingerprint));
  const reconciled = currentFindings.map((finding) => {
    const previous = previousByFingerprint.get(finding.fingerprint);
    return {
      ...finding,
      previouslySeen: Boolean(previous),
      firstSeen: previous?.firstSeen ?? previous?.lastSeen ?? previousVisualMap.generatedAt,
      lastSeen: generatedAt,
      evidence: unique([
        ...finding.evidence,
        previous ? `previouslySeen=${previous.firstSeen ?? previous.lastSeen ?? previousVisualMap.generatedAt}` : "",
        `lastSeen=${generatedAt}`
      ])
    };
  });

  for (const previous of previousVisualMap.findings) {
    if (currentFingerprints.has(previous.fingerprint)) continue;
    const status = previous.status === "active" ? "resolved_candidate" : "stale";
    reconciled.push({
      ...previous,
      id: `${status}:${previous.id}`,
      status,
      severity: previous.severity === "high" ? "warning" : previous.severity,
      message:
        status === "resolved_candidate"
          ? `${previous.message} This finding is no longer present in the current repo map; verify before closing any linked issue.`
          : `${previous.message} This previous finding is stale in the current repo map.`,
      previouslySeen: true,
      firstSeen: previous.firstSeen ?? previous.lastSeen ?? previousVisualMap.generatedAt,
      lastSeen: previous.lastSeen ?? previousVisualMap.generatedAt,
      evidence: unique([
        ...previous.evidence,
        `previouslySeen=${previous.firstSeen ?? previous.lastSeen ?? previousVisualMap.generatedAt}`,
        `lastSeen=${previous.lastSeen ?? previousVisualMap.generatedAt}`,
        `reconciledAt=${generatedAt}`
      ])
    });
  }

  return reconciled;
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

function selectorOwnerId(componentNames?: string[]): string | undefined {
  if (componentNames?.length !== 1) return undefined;
  const componentName = componentNames[0]!;
  return `${visualOwnerKind(componentName)}:${safeId(componentName)}`;
}

function visualOwnerKind(componentName: string): "component" | "layout" {
  return /(?:Layout|Shell|Boundary)$/u.test(componentName) ? "layout" : "component";
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
  const packageRecords = await Promise.all(
    packageFiles.map(async (filePath) => {
      const rel = repoRelative(repoRoot, filePath);
      const parsed = await readPackageJson(filePath);
      const scripts = Object.entries(parsed?.scripts ?? {}).map(([name, command]) => ({
        packagePath: rel,
        name: sanitizeText(name),
        command: sanitizeText(String(command))
      }));
      return {
        filePath,
        path: rel,
        name: parsed?.name ? sanitizeText(parsed.name) : undefined,
        private: parsed?.private,
        workspaces: await workspacePatternsForDirectory(path.dirname(filePath), parsed),
        scripts,
        dependencyNames: dependencyNames(parsed)
      };
    })
  );
  const packages = await Promise.all(packageRecords.map(async (record) => ({
    path: record.path,
    packageManager: await detectNearestPackageManager(repoRoot, path.dirname(record.filePath), packageRecords.map((candidate) => ({
      directory: path.dirname(candidate.filePath),
      workspaces: candidate.workspaces
    }))),
    name: record.name,
    private: record.private,
    workspaces: record.workspaces,
    scripts: record.scripts,
    dependencyNames: record.dependencyNames
  })));
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
  return exactDirectoryPackageManager(repoRoot);
}

async function collectSourceFiles(repoRoot: string, maxSourceFiles: number): Promise<string[]> {
  const files: string[] = [];
  await walk(repoRoot, async (filePath) => {
    if (files.length >= maxSourceFiles) return;
    if (SOURCE_EXTENSIONS.has(path.extname(filePath).toLowerCase())) files.push(filePath);
  });
  return files.sort();
}

async function detectNearestPackageManager(
  repoRoot: string,
  startDirectory: string,
  packageOwners: Array<{ directory: string; workspaces: string[] }>
): Promise<RepoPackageManager> {
  const localManagers = await directoryPackageManagers(startDirectory);
  if (localManagers.length > 0) return localManagers.length === 1 ? localManagers[0]! : "unknown";
  const owners = packageOwners
    .filter((owner) => owner.directory !== startDirectory && (owner.directory === repoRoot || startDirectory.startsWith(`${owner.directory}${path.sep}`)))
    .filter((owner) => {
      const relative = path.relative(owner.directory, startDirectory).replaceAll("\\", "/");
      return matchesWorkspacePatterns(relative, owner.workspaces);
    })
    .sort((left, right) => right.directory.length - left.directory.length);
  return owners.length > 0 ? exactDirectoryPackageManager(owners[0]!.directory) : "npm";
}

async function exactDirectoryPackageManager(directory: string): Promise<RepoPackageManager> {
  const detected = await directoryPackageManagers(directory);
  return detected.length === 0 ? "npm" : detected.length === 1 ? detected[0]! : "unknown";
}

async function directoryPackageManagers(directory: string): Promise<RepoPackageManager[]> {
  const detected: RepoPackageManager[] = [];
  if (await exists(path.join(directory, "pnpm-lock.yaml"))) detected.push("pnpm");
  if (await exists(path.join(directory, "yarn.lock"))) detected.push("yarn");
  if (await exists(path.join(directory, "package-lock.json"))) detected.push("npm");
  return detected;
}

function matchesWorkspacePatterns(relativePath: string, patterns: string[]): boolean {
  let included = false;
  for (const rawPattern of patterns) {
    const negated = rawPattern.startsWith("!");
    const pattern = (negated ? rawPattern.slice(1) : rawPattern).replace(/\/$/u, "");
    if (pattern && minimatch(relativePath, pattern, { dot: true })) included = !negated;
  }
  return included;
}

async function workspacePatternsForDirectory(directory: string, pkg?: PackageJsonShape): Promise<string[]> {
  const patterns = workspacePatterns(pkg);
  const raw = await safeRead(path.join(directory, "pnpm-workspace.yaml"));
  if (!raw.trim()) return patterns;
  try {
    const parsed = parseYaml(raw) as { packages?: unknown } | undefined;
    if (Array.isArray(parsed?.packages)) {
      return orderedUnique([...patterns, ...parsed.packages.filter((item): item is string => typeof item === "string")]);
    }
  } catch {
    // An unreadable workspace file cannot establish ownership.
  }
  return patterns;
}

function orderedUnique(values: string[]): string[] {
  return [...new Set(values.map((value) => sanitizeText(value)).filter(Boolean))];
}

async function collectTestFiles(repoRoot: string, scopeCache: Map<string, string>): Promise<RepoTestFileInfo[]> {
  const files: RepoTestFileInfo[] = [];
  await walk(repoRoot, async (filePath) => {
    const relative = repoRelative(repoRoot, filePath);
    const candidate = isTestFileCandidate(relative);
    const rustSource = path.posix.extname(relative.toLowerCase()) === ".rs";
    if (!candidate && !rustSource) return;
    const content = await safeRead(filePath);
    const inlineRustTest = rustSource && /#\s*\[\s*test\s*\]\s*(?:async\s+)?fn\s+/u.test(content);
    if (!candidate && !inlineRustTest) return;
    const tools = testFileTools(relative, content);
    const runtime = testRuntime(relative);
    const scope = await testScope(repoRoot, filePath, runtime, scopeCache);
    if (!hasExecutableTestDeclaration(relative, content)) {
      if (!hasExplicitTestFileName(path.posix.basename(relative.toLowerCase())) && !inlineRustTest) return;
      files.push({ path: relative, kind: testFileKind(relative, tools, content), runtime, scope, tools, runnerEligible: false, eligibilityEvidence: ["candidate:no-runnable-declaration"] });
      return;
    }
    files.push({
      path: relative,
      kind: testFileKind(relative, tools, content),
      runtime,
      scope,
      tools,
      runnerEligible: false,
      eligibilityEvidence: ["candidate:test-file-name"]
    });
  });
  return files.sort((left, right) => utf8Compare(left.path, right.path));
}

async function collectRuntimeScopes(repoRoot: string, scopeCache: Map<string, string>): Promise<RepoRuntimeScopeInfo[]> {
  const scopes = new Map<string, RepoRuntimeScopeInfo>();
  await walk(repoRoot, async (filePath) => {
    const relative = repoRelative(repoRoot, filePath);
    if (!isProductSourceFile(relative)) return;
    const runtime = testRuntime(relative);
    const scope = await testScope(repoRoot, filePath, runtime, scopeCache);
    const key = `${runtime}\0${scope}`;
    const existing = scopes.get(key) ?? { runtime, scope, sourceFiles: [] };
    if (existing.sourceFiles.length < 50) existing.sourceFiles.push(relative);
    scopes.set(key, existing);
  });
  return [...scopes.values()]
    .map((scope) => ({ ...scope, sourceFiles: unique(scope.sourceFiles) }))
    .sort((left, right) => utf8Compare(left.runtime, right.runtime) || utf8Compare(left.scope, right.scope));
}

function isProductSourceFile(relativePath: string): boolean {
  const normalized = relativePath.replaceAll("\\", "/");
  const basename = path.posix.basename(normalized.toLowerCase());
  const extension = path.posix.extname(basename);
  if (!TEST_SOURCE_EXTENSIONS.has(extension) || isTestFileCandidate(normalized)) return false;
  if (
    /(?:^|\/)scripts\/testing(?:\/|$)/u.test(normalized.toLowerCase())
    || /(?:^|\.)generated\./u.test(basename)
    || /(?:^|\.)(?:config|setup)\.[^.]+$/u.test(basename)
    || /^(?:playwright|cypress|vitest|vite|jest|karma|webpack)\.config\./u.test(basename)
    || basename.endsWith(".d.ts")
  ) return false;
  return true;
}

function isTestFileCandidate(relativePath: string): boolean {
  const normalized = relativePath.replaceAll("\\", "/");
  const lower = normalized.toLowerCase();
  const basename = path.posix.basename(lower);
  const extension = path.posix.extname(lower);
  if (!TEST_SOURCE_EXTENSIONS.has(extension)) return false;
  if (
    /(?:^|\/)(?:__snapshots__|snapshots|generated|artifacts)(?:\/|$)/u.test(lower)
    || /(?:^|\/)(?:fixtures?|__fixtures__|mocks?|__mocks__)(?:\/|$)/u.test(lower)
    || /(?:^|\.)generated\./u.test(basename)
    || /(?:^|\.)(?:config|setup)\.[^.]+$/u.test(basename)
    || /^(?:playwright|cypress|vitest|vite|jest|karma|webpack)\.config\./u.test(basename)
    || /^(?:setup-tests|setuptests|test-setup|tests-setup)\./u.test(basename)
    || basename.endsWith(".d.ts")
  ) return false;
  if (hasExplicitTestFileName(basename)) return true;
  if (/(?:^|\/)(?:__tests__|tests?|e2e|playwright|cypress)(?:\/|$)/u.test(lower)) {
    return [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts", ".py", ".go", ".java", ".kt", ".kts", ".rb", ".php", ".rs"].includes(extension);
  }
  return false;
}

function hasExplicitTestFileName(basename: string): boolean {
  return /\.(?:test|spec|unit|e2e|cy)\.(?:[cm]?[jt]sx?|py|rb|php)$/u.test(basename)
    || /^(?:test_.+|.+_test)\.py$/u.test(basename)
    || /_test\.go$/u.test(basename)
    || /(?:test|tests)\.java$/u.test(basename);
}

function hasExecutableTestDeclaration(relativePath: string, content: string): boolean {
  const normalized = relativePath.replaceAll("\\", "/").toLowerCase();
  const runtime = testRuntime(normalized);
  const code = runtime === "python" || runtime === "ruby"
    ? maskHashStyleNonCode(content)
    : runtime === "javascript"
      ? maskJavaScriptNonCode(content)
      : maskCStyleNonCode(content, runtime === "php", runtime !== "rust");
  if (runtime === "javascript") {
    const bindings = unique(["it", "test", ...javascriptImportedTestBindings(content)]);
    const names = bindings.map((binding) => binding.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join("|");
    const activeCode = maskJavaScriptTestDefinitions(maskSkippedJavaScriptSuites(code), bindings);
    const withoutMemberCalls = activeCode.replace(new RegExp(`\\.\\s*(?:${names})(?:\\.(?:only|concurrent|serial|parallel|each))?\\s*\\(`, "gu"), ".(");
    return new RegExp(`(?:^|[;{}\\n]|=>)\\s*(?:(?:${names})(?:\\.(?:only|concurrent|serial|parallel))?\\s*\\(|(?:${names})\\.each\\s*\\()`, "u").test(withoutMemberCalls);
  }
  if (runtime === "python") return hasRunnablePythonTest(code);
  if (runtime === "go") return hasRunnableGoTest(normalized, code, content);
  if (runtime === "rust") return /#\s*\[\s*test\s*\]\s*(?:async\s+)?fn\s+/u.test(code.replace(/#\s*\[\s*ignore(?:\s*=\s*[^\]]+)?\s*\]\s*#\s*\[\s*test\s*\]/gu, ""));
  if (runtime === "jvm") return /@Test\b/u.test(code);
  if (runtime === "ruby") return /\b(?:it|test)\s*(?:\(|\b)/u.test(code);
  if (runtime === "php") return /\bfunction\s+test[A-Za-z0-9_]*\s*\(/iu.test(code);
  return false;
}

function hasRunnablePythonTest(code: string): boolean {
  const lines = code.split(/\r?\n/u);
  let classIndent = -1;
  let testClass = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (!line.trim()) continue;
    const indent = line.match(/^[ \t]*/u)?.[0].replaceAll("\t", "    ").length ?? 0;
    if (classIndent >= 0 && indent <= classIndent && !/^\s*@/u.test(line)) {
      classIndent = -1;
      testClass = false;
    }
    const classMatch = line.match(/^\s*class\s+([A-Za-z_][A-Za-z0-9_]*)(?:\(([^)]*)\))?\s*:/u);
    if (classMatch) {
      classIndent = indent;
      testClass = /^Test/u.test(classMatch[1] ?? "") || /(?:^|\.)TestCase\b/u.test(classMatch[2] ?? "");
      continue;
    }
    if (!/^\s*(?:async\s+)?def\s+test_[A-Za-z0-9_]*\s*\(/u.test(line)) continue;
    const allowedScope = indent === 0 || (testClass && classIndent >= 0 && indent > classIndent);
    const decoratorBlock = lines.slice(Math.max(0, index - 4), index).join("\n");
    const skipped = /@(?:pytest\.mark\.skip(?:if)?|unittest\.skip(?:If|Unless)?)\b/u.test(decoratorBlock);
    if (allowedScope && !skipped) return true;
  }
  return false;
}

function maskJavaScriptTestDefinitions(source: string, bindings: string[]): string {
  const output = source.split("");
  const names = bindings.map((binding) => binding.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join("|");
  const pattern = new RegExp(`(?:^|[;{},\\n])\\s*(?:async\\s+)?(?:${names})\\s*\\(`, "gmu");
  const callPattern = new RegExp(`(?:async\\s+)?(?:${names})\\s*\\(`, "u");
  for (const match of source.matchAll(pattern)) {
    const start = (match.index ?? 0) + match[0].search(callPattern);
    const open = source.indexOf("(", start);
    if (open < 0) continue;
    let depth = 0;
    let close = -1;
    for (let index = open; index < source.length; index += 1) {
      if (source[index] === "(") depth += 1;
      else if (source[index] === ")") {
        depth -= 1;
        if (depth === 0) {
          close = index;
          break;
        }
      }
    }
    if (close < 0) continue;
    let next = close + 1;
    while (next < source.length && /\s/u.test(source[next]!)) next += 1;
    if (source[next] !== "{" && source[next] !== ":") continue;
    for (let index = start; index <= close; index += 1) if (output[index] !== "\n" && output[index] !== "\r") output[index] = " ";
  }
  return output.join("");
}

function javascriptImportedTestBindings(source: string, onlyModule?: string): string[] {
  const tokens = jsConfigTokens(source);
  const supportedModules = new Set(["vitest", "@jest/globals", "node:test", "mocha", "ava", "tap", "@playwright/test"]);
  const bindings = new Set<string>();
  const addNamedBindings = (start: number, end: number) => {
    for (let index = start; index < end; index += 1) {
      if (!["it", "test"].includes(tokens[index]?.value ?? "") || tokens[index - 1]?.value === "as") continue;
      const local = tokens[index + 1]?.value === "as" ? tokens[index + 2]?.value : tokens[index]?.value;
      if (local && /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(local)) bindings.add(local);
    }
  };
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index]?.value === "from" && tokens[index + 1]?.kind === "string") {
      const moduleName = tokens[index + 1]!.value;
      if (!supportedModules.has(moduleName) || (onlyModule && moduleName !== onlyModule)) continue;
      let importIndex = index - 1;
      while (importIndex >= 0 && !["import", ";"].includes(tokens[importIndex]?.value ?? "")) importIndex -= 1;
      if (tokens[importIndex]?.value !== "import") continue;
      if (["ava", "node:test"].includes(moduleName)) {
        const defaultBinding = tokens[importIndex + 1]?.value;
        if (defaultBinding && defaultBinding !== "{" && /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(defaultBinding)) bindings.add(defaultBinding);
      }
      addNamedBindings(importIndex + 1, index);
      continue;
    }
    if (tokens[index]?.value !== "require" || tokens[index + 1]?.value !== "(" || tokens[index + 2]?.kind !== "string") continue;
    const moduleName = tokens[index + 2]!.value;
    if (!supportedModules.has(moduleName) || (onlyModule && moduleName !== onlyModule)) continue;
    let declarationIndex = index - 1;
    while (declarationIndex >= 0 && !["const", "let", "var", ";"].includes(tokens[declarationIndex]?.value ?? "")) declarationIndex -= 1;
    if (!["const", "let", "var"].includes(tokens[declarationIndex]?.value ?? "")) continue;
    addNamedBindings(declarationIndex + 1, index);
  }
  return [...bindings];
}

function hasRunnableGoTest(relativePath: string, code: string, source: string): boolean {
  if (/^\s*\/\/\s*(?:go:build|\+build)\b/mu.test(source)) return false;
  if (/_(?:aix|android|darwin|dragonfly|freebsd|illumos|ios|js|linux|netbsd|openbsd|plan9|solaris|wasip1|windows|386|amd64|arm|arm64|loong64|mips|mips64|mips64le|mipsle|ppc64|ppc64le|riscv64|s390x|wasm)_test\.go$/u.test(relativePath)) return false;
  const runnable = /^\s*func\s+Test[A-Z0-9_][A-Za-z0-9_]*\s*\(\s*[A-Za-z_][A-Za-z0-9_]*\s+\*testing\.T\s*\)/mu.test(code);
  if (runnable) return true;
  for (const match of code.matchAll(/^\s*func\s+Example[A-Za-z0-9_]*\s*\(\s*\)\s*\{/gmu)) {
    const open = (match.index ?? 0) + match[0].lastIndexOf("{");
    let depth = 0;
    let close = -1;
    for (let index = open; index < code.length; index += 1) {
      if (code[index] === "{") depth += 1;
      else if (code[index] === "}") {
        depth -= 1;
        if (depth === 0) {
          close = index;
          break;
        }
      }
    }
    if (close >= 0 && /^\s*\/\/\s*(?:Output|Unordered output):/imu.test(source.slice(open, close))) return true;
  }
  return false;
}

function maskSkippedJavaScriptSuites(source: string): string {
  const output = source.split("");
  const pattern = /\b(?:(?:describe|suite)\.(?:skip|todo)|(?:xdescribe|xsuite))\s*\(/gu;
  for (const match of source.matchAll(pattern)) {
    const start = match.index ?? 0;
    const open = start + match[0].lastIndexOf("(");
    let depth = 0;
    let end = source.length;
    for (let index = open; index < source.length; index += 1) {
      if (source[index] === "(") depth += 1;
      else if (source[index] === ")") {
        depth -= 1;
        if (depth === 0) {
          end = index + 1;
          break;
        }
      }
    }
    for (let index = start; index < end; index += 1) if (output[index] !== "\n" && output[index] !== "\r") output[index] = " ";
  }
  return output.join("");
}

function maskCStyleNonCode(source: string, hashComments = false, singleQuoteStrings = true): string {
  const output = source.split("");
  const blank = (start: number, end: number) => {
    for (let index = start; index < end; index += 1) if (output[index] !== "\n" && output[index] !== "\r") output[index] = " ";
  };
  for (let index = 0; index < source.length;) {
    if (source[index] === "/" && source[index + 1] === "/") {
      const start = index;
      while (index < source.length && source[index] !== "\n") index += 1;
      blank(start, index);
      continue;
    }
    if (source[index] === "/" && source[index + 1] === "*") {
      const start = index;
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) index += 1;
      index = Math.min(source.length, index + 2);
      blank(start, index);
      continue;
    }
    if (hashComments && source[index] === "#") {
      const start = index;
      while (index < source.length && source[index] !== "\n") index += 1;
      blank(start, index);
      continue;
    }
    if ((singleQuoteStrings && source[index] === "'") || source[index] === '"' || source[index] === "`") {
      const start = index;
      const quote = source[index]!;
      index += 1;
      while (index < source.length) {
        if (source[index] === "\\") index += 2;
        else if (source[index] === quote) {
          index += 1;
          break;
        } else index += 1;
      }
      blank(start, Math.min(index, source.length));
      continue;
    }
    index += 1;
  }
  return output.join("");
}

function maskJavaScriptNonCode(source: string): string {
  const masked = maskCStyleNonCode(source);
  const output = masked.split("");
  for (let index = 0; index < masked.length; index += 1) {
    if (masked[index] !== "/") continue;
    let previousIndex = index - 1;
    while (previousIndex >= 0 && /\s/u.test(masked[previousIndex]!)) previousIndex -= 1;
    const previous = previousIndex >= 0 ? masked[previousIndex]! : "";
    const previousWord = masked.slice(0, index).match(/([A-Za-z_$][A-Za-z0-9_$]*)\s*$/u)?.[1];
    if (previous && !/[=(:,[!&|?;{}]/u.test(previous) && !["return", "throw", "case", "yield", "await", "typeof", "void", "delete", "instanceof", "in", "of", "new"].includes(previousWord ?? "")) continue;
    const start = index;
    let inClass = false;
    index += 1;
    while (index < masked.length) {
      if (masked[index] === "\\") index += 2;
      else if (masked[index] === "[") {
        inClass = true;
        index += 1;
      } else if (masked[index] === "]") {
        inClass = false;
        index += 1;
      } else if (masked[index] === "/" && !inClass) {
        index += 1;
        while (index < masked.length && /[A-Za-z]/u.test(masked[index]!)) index += 1;
        break;
      } else if (masked[index] === "\n") break;
      else index += 1;
    }
    for (let cursor = start; cursor < index; cursor += 1) if (output[cursor] !== "\n" && output[cursor] !== "\r") output[cursor] = " ";
  }
  return output.join("");
}

function maskHashStyleNonCode(source: string): string {
  const output = source.split("");
  const blank = (start: number, end: number) => {
    for (let index = start; index < end; index += 1) if (output[index] !== "\n" && output[index] !== "\r") output[index] = " ";
  };
  for (let index = 0; index < source.length;) {
    if (source[index] === "#") {
      const start = index;
      while (index < source.length && source[index] !== "\n") index += 1;
      blank(start, index);
      continue;
    }
    if (source[index] === "'" || source[index] === '"') {
      const start = index;
      const quote = source[index]!;
      const triple = source.slice(index, index + 3) === quote.repeat(3);
      index += triple ? 3 : 1;
      while (index < source.length) {
        if (source[index] === "\\") index += 2;
        else if (triple ? source.slice(index, index + 3) === quote.repeat(3) : source[index] === quote) {
          index += triple ? 3 : 1;
          break;
        } else index += 1;
      }
      blank(start, Math.min(index, source.length));
      continue;
    }
    index += 1;
  }
  return output.join("");
}

function testFileTools(relativePath: string, content: string): string[] {
  const normalized = relativePath.replaceAll("\\", "/").toLowerCase();
  const runtime = testRuntime(normalized);
  const code = runtime === "javascript" ? maskJavaScriptNonCode(content)
    : runtime === "python" || runtime === "ruby" ? maskHashStyleNonCode(content)
      : maskCStyleNonCode(content, runtime === "php", runtime !== "rust");
  const corpus = `${normalized}\n${code}`.toLowerCase();
  const tools: string[] = [];
  const importedModules = new Set<string>();
  if (runtime === "javascript") {
    const tokens = jsConfigTokens(content);
    for (let index = 0; index < tokens.length; index += 1) {
      if (tokens[index]?.value === "import" && tokens[index + 1]?.kind === "string") importedModules.add(tokens[index + 1]!.value.toLowerCase());
      if (tokens[index]?.value === "from" && tokens[index + 1]?.kind === "string") importedModules.add(tokens[index + 1]!.value.toLowerCase());
      if (["require", "import"].includes(tokens[index]?.value ?? "") && tokens[index + 1]?.value === "(" && tokens[index + 2]?.kind === "string") importedModules.add(tokens[index + 2]!.value.toLowerCase());
    }
  }
  if (importedModules.has("@playwright/test") || importedModules.has("playwright")) tools.push("playwright");
  if (importedModules.has("cypress") || /\bcy\.(?:visit|get|intercept|contains)\b/u.test(corpus)) tools.push("cypress");
  if (importedModules.has("vitest")) tools.push("vitest");
  if (importedModules.has("@jest/globals") || /\bjest\.(?:fn|mock|spyOn)\b/u.test(corpus)) tools.push("jest");
  if (importedModules.has("node:test")) tools.push("node-test");
  if ([...importedModules].some((moduleName) => moduleName.startsWith("@testing-library/"))) tools.push("testing-library");
  if (importedModules.has("mocha")) tools.push("mocha");
  if (importedModules.has("ava")) tools.push("ava");
  if (importedModules.has("tap")) tools.push("tap");
  if (/\bpytest\b/u.test(corpus)) tools.push("pytest");
  if (/\bunittest\b/u.test(corpus)) tools.push("unittest");
  if (normalized.endsWith("_test.go")) tools.push("go-test");
  if (normalized.endsWith(".rs") && (/(?:^|\/)tests?(?:\/|$)/u.test(normalized) || /#\s*\[\s*test\s*\]/u.test(content))) tools.push("cargo-test");
  if (/\.(?:java|kt|kts)$/u.test(normalized) && /@test\b/u.test(corpus)) tools.push("junit");
  return unique(tools);
}

function testFileKind(relativePath: string, tools: string[], content: string): RepoTestFileInfo["kind"] {
  const normalized = relativePath.replaceAll("\\", "/").toLowerCase();
  const runtime = testRuntime(normalized);
  if (
    tools.includes("playwright")
    || tools.includes("cypress")
    || /(?:^|\/)(?:e2e|end-to-end|playwright|cypress)(?:\/|$)|\.(?:e2e|cy)\./u.test(normalized)
  ) return "e2e";
  if (/(?:^|\/)(?:integration)(?:\/|$)|\.integration\./u.test(normalized)) return "integration";
  if (runtime === "javascript" && (tools.includes("testing-library") || /(?:^|\/)components?(?:\/|$)|\.component\./u.test(normalized) || /\bmount\s*\(/u.test(content))) return "component";
  return "unit";
}

function testRuntime(relativePath: string): RepoTestRuntime {
  const extension = path.posix.extname(relativePath.toLowerCase());
  if (extension === ".py") return "python";
  if (extension === ".go") return "go";
  if ([".java", ".kt", ".kts"].includes(extension)) return "jvm";
  if (extension === ".rs") return "rust";
  if (extension === ".rb") return "ruby";
  if (extension === ".php") return "php";
  return "javascript";
}

async function testScope(repoRoot: string, filePath: string, runtime: RepoTestRuntime, cache: Map<string, string>): Promise<string> {
  const ownerFiles: Record<RepoTestRuntime, string[]> = {
    javascript: ["package.json"],
    python: ["pyproject.toml", "pytest.ini", "setup.cfg", "tox.ini"],
    go: ["go.mod"],
    jvm: ["pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts"],
    rust: ["Cargo.toml"],
    ruby: ["Gemfile"],
    php: ["composer.json"]
  };
  let directory = path.dirname(filePath);
  const visited: string[] = [];
  while (directory === repoRoot || directory.startsWith(`${repoRoot}${path.sep}`)) {
    const cacheKey = `${runtime}\0${directory}`;
    const cached = cache.get(cacheKey);
    if (cached !== undefined) {
      for (const visitedDirectory of visited) cache.set(`${runtime}\0${visitedDirectory}`, cached);
      return cached;
    }
    visited.push(directory);
    for (const ownerFile of ownerFiles[runtime]) {
      if (await exists(path.join(directory, ownerFile))) {
        const scope = repoRelative(repoRoot, directory);
        for (const visitedDirectory of visited) cache.set(`${runtime}\0${visitedDirectory}`, scope);
        return scope;
      }
    }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  for (const visitedDirectory of visited) cache.set(`${runtime}\0${visitedDirectory}`, ".");
  return ".";
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

async function detectTestRunners(
  repoRoot: string,
  repoPackageManager: RepoPackageManager,
  packages: RepoPackageInfo[],
  scripts: RepoScriptInfo[],
  testFiles: RepoTestFileInfo[],
  runtimeScopes: RepoRuntimeScopeInfo[]
): Promise<RepoTestRunnerInfo[]> {
  const runners = new Map<string, { info: RepoTestRunnerInfo; priority: number }>();
  const add = (
    tool: string,
    runtime: RepoTestRuntime,
    kind: RepoTestFileInfo["kind"],
    scope: string,
    command: RepoTestRunnerInfo["command"],
    commandProvider: RepoTestRunnerInfo["commandProvider"],
    evidence: string,
    priority: number,
    discoveryConstraints: string[] = []
  ) => {
    if (!isSafeStructuredRunnerCommand(command)) return;
    const key = `${runtime}:${kind}:${scope}:${tool}`;
    const existing = runners.get(key);
    const preferred = !existing || priority > existing.priority;
    runners.set(key, {
      priority: preferred ? priority : existing.priority,
      info: {
        tool,
        runtime,
        kind,
        scope,
        command: preferred ? command : existing.info.command,
        commandProvider: preferred ? commandProvider : existing.info.commandProvider,
        discoveryConstraints: preferred ? discoveryConstraints : existing.info.discoveryConstraints,
        evidence: unique([...(existing?.info.evidence ?? []), evidence])
      }
    });
  };
  for (const packageInfo of packages) {
    if (packageInfo.packageManager === "unknown") continue;
    const scope = path.posix.dirname(packageInfo.path.replaceAll("\\", "/"));
    for (const dependency of packageInfo.dependencyNames) {
      const normalized = dependency.toLowerCase();
      const tool = normalized === "@jest/globals" ? "jest" : normalized === "node:test" ? "node-test" : normalized;
      if (["vitest", "jest", "node:test"].includes(normalized)) add(tool, "javascript", "unit", scope, nodeDependencyTestCommand(packageInfo.packageManager, scope, tool), nodeCommandProvider(packageInfo.packageManager), `dependency:${packageInfo.path}:${dependency}`, 40);
      if (normalized === "@playwright/test" || normalized === "playwright") add("playwright", "javascript", "e2e", scope, nodeDependencyTestCommand(packageInfo.packageManager, scope, "playwright"), nodeCommandProvider(packageInfo.packageManager), `dependency:${packageInfo.path}:${dependency}`, 40);
      if (normalized === "cypress") add("cypress", "javascript", "e2e", scope, nodeDependencyTestCommand(packageInfo.packageManager, scope, "cypress"), nodeCommandProvider(packageInfo.packageManager), `dependency:${packageInfo.path}:${dependency}`, 40);
    }
  }
  for (const script of scripts) {
    if (/\b(?:update|watch|record|baseline|open|ui)\b/u.test(script.name.toLowerCase()) || /--update-snapshots|--watch|--ui|\b(?:record|open)\b/u.test(script.command.toLowerCase())) continue;
    const evidence = `script:${script.packagePath}:${script.name}`;
    const scope = path.posix.dirname(script.packagePath.replaceAll("\\", "/"));
    const packageManager = packages.find((packageInfo) => packageInfo.path === script.packagePath)?.packageManager ?? repoPackageManager;
    if (packageManager === "unknown") continue;
    const jsKind: RepoTestFileInfo["kind"] = /(?:^|:|\b)(?:e2e|end-to-end)(?:$|:|\b)/u.test(script.name.toLowerCase())
      ? "e2e"
      : /(?:^|:|\b)integration(?:$|:|\b)/u.test(script.name.toLowerCase())
        ? "integration"
      : /(?:^|:|\b)component(?:$|:|\b)/u.test(script.name.toLowerCase())
        ? "component"
        : "unit";
    const scriptCommand = packageScriptCommand(packageManager, scope, script.name);
    const provider = nodeCommandProvider(packageManager);
    const scriptPriority = script.name === "test" || script.name === "test:unit" || script.name === "unit:test"
      ? 100
      : script.name === "test:e2e" || script.name === "test:integration"
        ? 90
        : 80;
    const addScriptRunner = (invocationTool: string, runtime: RepoTestRuntime, kind: RepoTestFileInfo["kind"], reportedTool = invocationTool) => {
      const invocation = detectRunnerInvocation(script.command, invocationTool);
      if (!invocation.matches) return;
      add(reportedTool, runtime, kind, scope, scriptCommand, provider, evidence, scriptPriority, invocation.discoveryConstraints);
    };
    addScriptRunner("vitest", "javascript", jsKind);
    addScriptRunner("jest", "javascript", jsKind);
    addScriptRunner("node-test", "javascript", jsKind);
    addScriptRunner("playwright", "javascript", "e2e");
    addScriptRunner("cypress", "javascript", "e2e");
    addScriptRunner("pytest", "python", "unit");
    addScriptRunner("unittest", "python", "unit");
    addScriptRunner("go-test", "go", "unit");
    addScriptRunner("cargo-test", "rust", "unit");
    addScriptRunner("maven-test", "jvm", "unit", "junit");
    addScriptRunner("gradle-test", "jvm", "unit", "junit");
  }
  for (const file of testFiles) {
    for (const tool of file.tools) {
      const fileFromScope = file.scope === "." ? file.path : path.posix.relative(file.scope, file.path);
      if (tool === "node-test" && matchesDefaultNodeTestPath(fileFromScope)) add(tool, file.runtime, file.kind, file.scope, structuredCommand(file.scope, "node", ["--test", fileFromScope]), "node", `test-file:${file.path}`, 50, [`file:${file.path}`]);
      // unittest discovery is supported only from an explicit repository script.
      // A synthesized file command would not prove that Hive's repository plan
      // executes the same suite after a repair.
    }
  }
  for (const runtimeScope of runtimeScopes) {
    const scopeRoot = runtimeScope.scope === "." ? repoRoot : path.join(repoRoot, ...runtimeScope.scope.split("/"));
    if (runtimeScope.runtime === "python") {
      if (await pythonManifestDeclaresPytest(scopeRoot)) add("pytest", "python", "unit", runtimeScope.scope, structuredCommand(runtimeScope.scope, "python", ["-m", "pytest"]), "python", `manifest:${runtimeScope.scope}:pytest`, 70);
    }
    if (runtimeScope.runtime === "go" && await exists(path.join(scopeRoot, "go.mod"))) add("go-test", "go", "unit", runtimeScope.scope, structuredCommand(runtimeScope.scope, "go", ["test", "./..."]), "go", `manifest:${runtimeScope.scope}:go.mod`, 70);
    if (runtimeScope.runtime === "rust" && await exists(path.join(scopeRoot, "Cargo.toml"))) add("cargo-test", "rust", "unit", runtimeScope.scope, structuredCommand(runtimeScope.scope, "cargo", ["test"]), "cargo", `manifest:${runtimeScope.scope}:Cargo.toml`, 70);
    if (runtimeScope.runtime === "jvm" && await jvmManifestDeclaresTestFramework(scopeRoot, "maven")) add("junit", "jvm", "unit", runtimeScope.scope, structuredCommand(runtimeScope.scope, "mvn", ["test"]), "maven", `manifest:${runtimeScope.scope}:pom.xml`, 70);
    if (runtimeScope.runtime === "jvm" && await jvmManifestDeclaresTestFramework(scopeRoot, "gradle")) add("junit", "jvm", "unit", runtimeScope.scope, structuredCommand(runtimeScope.scope, "gradle", ["test"]), "gradle", `manifest:${runtimeScope.scope}:gradle`, 70);
  }
  return [...runners.values()].map((runner) => runner.info).sort((left, right) =>
    utf8Compare(left.runtime, right.runtime) || utf8Compare(left.scope, right.scope) || utf8Compare(left.kind, right.kind) || utf8Compare(left.tool, right.tool)
  );
}

async function pythonManifestDeclaresPytest(scopeRoot: string): Promise<boolean> {
  let names = ["pyproject.toml", "pytest.ini", "tox.ini", "setup.cfg", "Pipfile", "Pipfile.lock", "poetry.lock", "uv.lock", "pdm.lock"];
  try {
    names = unique([...names, ...(await readdir(scopeRoot)).filter((name) => /^requirements(?:[._-].+)?\.txt$/iu.test(name))]);
  } catch {
    return false;
  }
  for (const name of names) {
    const raw = await safeRead(path.join(scopeRoot, name));
    const uncommented = raw.split(/\r?\n/u).map((line) => line.replace(/\s+#.*$/u, "")).join("\n");
    const lines = uncommented.split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && !line.startsWith(";"));
    if (/^requirements/iu.test(name) && lines.some((line) => /^pytest(?:\[[^\]]+\])?(?:\s*[<>=~!].*)?(?:\s*;.*)?$/iu.test(line))) return true;
    if ((name === "tox.ini" || name === "setup.cfg") && /\bdeps\s*=\s*(?:[^\n]*\n(?:[ \t]+[^\n]*\n?)*)/iu.test(uncommented) && /\bpytest(?:\[[^\]]+\])?(?:[<>=~!][^\s,;]+)?\b/iu.test(uncommented.match(/\bdeps\s*=\s*(?:[^\n]*\n(?:[ \t]+[^\n]*\n?)*)/iu)?.[0] ?? "")) return true;
    if (name === "pyproject.toml" && pyprojectDeclaresPytest(uncommented)) return true;
    if (name === "Pipfile" && pipfileDeclaresPytest(uncommented)) return true;
    if (["Pipfile.lock", "poetry.lock", "uv.lock", "pdm.lock"].includes(name) && lines.some((line) => /^(?:name\s*=\s*["']pytest["']|["']pytest["']\s*:)/iu.test(line))) return true;
  }
  return false;
}

function pipfileDeclaresPytest(content: string): boolean {
  let dependencySection = false;
  for (const line of content.split(/\r?\n/u)) {
    const section = line.trim().match(/^\[([^\]]+)\]$/u)?.[1]?.toLowerCase();
    if (section !== undefined) {
      dependencySection = section === "packages" || section === "dev-packages";
      continue;
    }
    if (dependencySection && /^\s*pytest\s*=/iu.test(line)) return true;
  }
  return false;
}

function pyprojectDeclaresPytest(content: string): boolean {
  const sections = new Map<string, string[]>();
  let active = "";
  for (const line of content.split(/\r?\n/u)) {
    const section = line.trim().match(/^\[([^\]]+)\]$/u)?.[1]?.toLowerCase();
    if (section !== undefined) {
      active = section;
      if (!sections.has(active)) sections.set(active, []);
    } else if (active) sections.get(active)?.push(line);
  }
  const hasPytest = (value: string) => /["']pytest(?:\[[^"']+\])?(?:[<>=~!][^"']*)?["']/iu.test(value);
  for (const [section, lines] of sections) {
    const body = lines.join("\n");
    if (section === "project") {
      const dependencies = body.match(/^\s*dependencies\s*=\s*\[([\s\S]*?)\]/imu)?.[1] ?? "";
      if (hasPytest(dependencies)) return true;
    }
    if (section === "project.optional-dependencies" || section === "dependency-groups" || section === "tool.pdm.dev-dependencies") {
      if ([...body.matchAll(/^\s*[A-Za-z0-9_.-]+\s*=\s*\[([\s\S]*?)\]/gimu)].some((match) => hasPytest(match[1] ?? ""))) return true;
    }
    if (section === "tool.poetry.dependencies" || /^tool\.poetry\.group\.[^.]+\.dependencies$/u.test(section)) {
      if (/^\s*pytest(?:\[[^\]]+\])?\s*=/imu.test(body)) return true;
    }
    if (section === "tool.uv" || /^tool\.hatch\.envs\.[^.]+$/u.test(section)) {
      if ([...body.matchAll(/^\s*(?:dev-)?dependencies\s*=\s*\[([\s\S]*?)\]/gimu)].some((match) => hasPytest(match[1] ?? ""))) return true;
    }
  }
  return false;
}

interface RunnerInvocationDetection {
  matches: boolean;
  discoveryConstraints: string[];
}

interface RunnerArgumentSpec {
  allowedBare: Set<string>;
  flagOptions: Set<string>;
  valueOptions: Set<string>;
  configOptions?: Set<string>;
  noExecutionOptions: Set<string>;
}

function detectRunnerInvocation(command: string, tool: string): RunnerInvocationDetection {
  if (/[|;]/u.test(command) || command.replaceAll("&&", "").includes("&")) return noRunnerInvocation();
  let prefixSafe = true;
  for (const segment of command.split("&&").map((candidate) => candidate.trim()).filter(Boolean)) {
    const tokens = [...segment.matchAll(/"([^"]*)"|'([^']*)'|([^\s]+)/gu)].map((match) => match[1] ?? match[2] ?? match[3] ?? "").filter(Boolean);
    if (!prefixSafe) return noRunnerInvocation();
    if (tool === "pytest" && tokens.some((token) => /^PYTEST_ADDOPTS=/u.test(token))) return noRunnerInvocation();
    while (tokens[0] && /^[A-Za-z_][A-Za-z0-9_]*=/u.test(tokens[0])) tokens.shift();
    if (["cross-env", "cross-env-shell"].includes((tokens[0] ?? "").toLowerCase())) {
      tokens.shift();
      while (tokens[0] && /^[A-Za-z_][A-Za-z0-9_]*=/u.test(tokens[0])) tokens.shift();
    }
    const first = executableName(tokens[0]);
    if (first === "npx") {
      tokens.shift();
      while (tokens[0]?.startsWith("-")) tokens.shift();
    } else if (first === "npm" && tokens[1]?.toLowerCase() === "exec") {
      tokens.splice(0, 2);
      if (tokens[0] === "--") tokens.shift();
    } else if (["pnpm", "yarn"].includes(first) && tokens[1]?.toLowerCase() === "exec") {
      tokens.splice(0, 2);
    }
    const executable = executableName(tokens[0]);
    const args = tokens.slice(1);
    if (["vitest", "jest", "mocha", "ava", "tap"].includes(tool) && executable === tool) {
      if (tool === "vitest" && !args.includes("run") && !args.includes("--run")) return noRunnerInvocation();
      return analyzeRunnerArguments(args, jsRunnerArgumentSpec(tool));
    }
    if (tool === "node-test" && executable === "node" && args.includes("--test")) {
      return analyzeRunnerArguments(args.filter((arg) => arg !== "--test"), {
        allowedBare: new Set(),
        flagOptions: new Set(["--test-force-exit"]),
        valueOptions: new Set(["--test-reporter", "--test-reporter-destination"]),
        noExecutionOptions: new Set(["--help", "-h", "--version", "-v", "--check", "-c", "--test-only"])
      });
    }
    if (tool === "pytest" && (executable === "pytest" || executable === "py.test" || (executable === "python" && args[0] === "-m" && args[1] === "pytest"))) {
      const runnerArgs = executable === "python" ? args.slice(2) : args;
      return analyzeRunnerArguments(runnerArgs, pytestRunnerArgumentSpec());
    }
    if (tool === "unittest" && executable === "python" && args[0] === "-m" && args[1] === "unittest") {
      return analyzeRunnerArguments(args.slice(2), {
        allowedBare: new Set(),
        flagOptions: new Set(["-b", "--buffer", "-f", "--failfast", "-c", "--catch", "-v", "--verbose"]),
        valueOptions: new Set(),
        noExecutionOptions: new Set(["-h", "--help"])
      });
    }
    if (tool === "playwright" && executable === "playwright" && args[0] === "test") {
      return analyzeRunnerArguments(args.slice(1), {
        allowedBare: new Set(),
        flagOptions: new Set(["--forbid-only", "--fully-parallel", "--pass-with-no-tests"]),
        valueOptions: new Set(["--config", "-c", "--reporter", "--project", "--workers", "--timeout", "--retries"]),
        configOptions: new Set(["--config", "-c"]),
        noExecutionOptions: new Set(["--help", "-h", "--version", "-V", "--list"])
      });
    }
    if (tool === "cypress" && executable === "cypress" && args[0] === "run") {
      return analyzeRunnerArguments(args.slice(1), strictRunnerArgumentSpec(["--headless"], ["--config-file", "--browser", "--reporter"], ["--help", "-h", "--version", "-v"]));
    }
    if (tool === "go-test" && executable === "go" && args[0] === "test") {
      return analyzeRunnerArguments(args.slice(1), {
        allowedBare: new Set(["./..."]),
        flagOptions: new Set(["-v", "-race", "-short", "-failfast"]),
        valueOptions: new Set(["-count", "-timeout", "-parallel"]),
        noExecutionOptions: new Set(["-h", "--help", "-list"])
      });
    }
    if (tool === "cargo-test" && executable === "cargo" && args[0] === "test") {
      return analyzeRunnerArguments(args.slice(1), strictRunnerArgumentSpec(["--all", "--workspace", "--all-targets", "--release"], ["--package", "-p", "--jobs", "-j"], ["--no-run", "--help", "-h"]));
    }
    if (tool === "maven-test" && ["mvn", "mvnw"].includes(executable) && args.includes("test")) {
      if (args.some((arg) => /^-D(?:skipTests|maven\.test\.skip|skipITs)(?:=true)?$/iu.test(arg))) return noRunnerInvocation();
      return { matches: true, discoveryConstraints: args.some((arg) => arg.startsWith("-Dtest=")) ? ["unparsed-discovery-option"] : [] };
    }
    if (tool === "gradle-test" && ["gradle", "gradlew"].includes(executable) && args.includes("test")) {
      if (args.includes("-m") || args.includes("--dry-run") || args.some((arg, index) => (arg === "-x" || arg === "--exclude-task") && args[index + 1] === "test")) return noRunnerInvocation();
      return { matches: true, discoveryConstraints: args.some((arg) => arg.startsWith("--tests")) ? ["unparsed-discovery-option"] : [] };
    }
    prefixSafe = isSafeRunnerPrerequisite(executable, args);
  }
  return noRunnerInvocation();
}

function isSafeRunnerPrerequisite(executable: string, args: string[]): boolean {
  if (executable === "tsc") return !args.some((arg) => ["-w", "--watch", "--watchFile", "--watchDirectory"].includes(arg))
    && args.every((arg) => /^--?[A-Za-z0-9-]+(?:=.*)?$/u.test(arg));
  return false;
}

function executableName(value: string | undefined): string {
  return path.basename(value ?? "").toLowerCase().replace(/\.(?:cmd|exe)$/u, "");
}

function analyzeRunnerArguments(args: string[], spec: RunnerArgumentSpec): RunnerInvocationDetection {
  const constraints: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg.startsWith("-")) {
      const option = arg.split("=", 1)[0]!;
      if (spec.noExecutionOptions.has(option)) return noRunnerInvocation();
      if (spec.valueOptions.has(option)) {
        let value = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : undefined;
        if (value === undefined) {
          if (index + 1 >= args.length) return { matches: true, discoveryConstraints: ["unparsed-discovery-option"] };
          value = args[index + 1]!;
          if (value.startsWith("-")) return { matches: true, discoveryConstraints: ["unparsed-discovery-option"] };
          index += 1;
        }
        if (spec.configOptions?.has(option)) {
          const normalized = safeRunnerConfigPath(value);
          if (!normalized) constraints.push("unparsed-discovery-option");
          else constraints.push(`config:${normalized}`);
        }
        continue;
      }
      if (!spec.flagOptions.has(option)) constraints.push("unparsed-discovery-option");
      continue;
    }
    if (!spec.allowedBare.has(arg)) constraints.push("unparsed-positional-filter");
  }
  return { matches: true, discoveryConstraints: unique(constraints) };
}

function jsRunnerArgumentSpec(tool: string): RunnerArgumentSpec {
  const commonNoExecution = ["--help", "-h", "--version", "-v", "--list", "--listTests", "--collect-only", "--dry-run", "--clearCache", "--showConfig", "--init"];
  if (tool === "vitest") {
    return {
      allowedBare: new Set(["run"]),
      flagOptions: new Set(["--run", "--passWithNoTests", "--coverage", "--globals", "--dom", "--isolate", "--no-isolate", "--silent"]),
      valueOptions: new Set(["--config", "-c", "--reporter", "--environment", "--pool", "--maxWorkers", "--minWorkers", "--testTimeout", "--hookTimeout", "--bail", "--retry"]),
      configOptions: new Set(["--config", "-c"]),
      noExecutionOptions: new Set(commonNoExecution)
    };
  }
  if (tool === "jest") {
    return {
      allowedBare: new Set(),
      flagOptions: new Set(["--runInBand", "--passWithNoTests", "--silent", "--coverage", "--detectOpenHandles", "--forceExit", "--ci", "--verbose"]),
      valueOptions: new Set(["--config", "-c", "--reporters", "--testEnvironment", "--maxWorkers", "--testTimeout"]),
      configOptions: new Set(["--config", "-c"]),
      noExecutionOptions: new Set(commonNoExecution)
    };
  }
  return strictRunnerArgumentSpec(["--bail", "--parallel"], ["--config", "--reporter", "--timeout"], commonNoExecution);
}

function strictRunnerArgumentSpec(flagOptions: string[], valueOptions: string[], noExecutionOptions: string[]): RunnerArgumentSpec {
  return {
    allowedBare: new Set(),
    flagOptions: new Set(flagOptions),
    valueOptions: new Set(valueOptions),
    configOptions: new Set(valueOptions.filter((option) => option.includes("config"))),
    noExecutionOptions: new Set(noExecutionOptions)
  };
}

function pytestRunnerArgumentSpec(): RunnerArgumentSpec {
  return {
    allowedBare: new Set(),
    flagOptions: new Set(["-q", "--quiet", "-s", "-x", "--exitfirst", "-ra", "--strict-markers", "--strict-config", "--disable-warnings"]),
    valueOptions: new Set(["--config-file", "-c", "--maxfail", "--tb", "--color"]),
    configOptions: new Set(["--config-file", "-c"]),
    noExecutionOptions: new Set(["--help", "-h", "--version", "--collect-only", "--co", "--markers", "--fixtures", "--fixtures-per-test", "--cache-show"])
  };
}

function safeRunnerConfigPath(value: string): string | undefined {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//u, "");
  if (!normalized || normalized.startsWith("-") || normalized.startsWith("/") || /^[A-Za-z]:\//u.test(normalized)) return undefined;
  if (normalized.split("/").some((segment) => !segment || segment === ".." || segment.startsWith("-"))) return undefined;
  return /^[A-Za-z0-9@%_+=:,./-]+$/u.test(normalized) ? normalized : undefined;
}

function noRunnerInvocation(): RunnerInvocationDetection {
  return { matches: false, discoveryConstraints: [] };
}

async function markRunnerEligibleTestFiles(
  repoRoot: string,
  testFiles: RepoTestFileInfo[],
  testRunners: RepoTestRunnerInfo[]
): Promise<RepoTestFileInfo[]> {
  const configCache = new Map<string, { content: string; reason?: string }>();
  const readRunnerConfig = async (scope: string, prefix: string, runner: RepoTestRunnerInfo): Promise<{ content: string; reason?: string }> => {
    const exactConfigs = runner.discoveryConstraints.filter((constraint) => constraint.startsWith("config:")).map((constraint) => constraint.slice("config:".length));
    const key = `${scope}\0${prefix}\0${exactConfigs.join("\0")}`;
    const cached = configCache.get(key);
    if (cached !== undefined) return cached;
    const scopeRoot = scope === "." ? repoRoot : path.join(repoRoot, ...scope.split("/"));
    if (exactConfigs.length > 1) {
      const result = { content: "", reason: "ambiguous-runner-config" };
      configCache.set(key, result);
      return result;
    }
    if (exactConfigs.length === 1) {
      const configPath = path.join(scopeRoot, ...exactConfigs[0]!.split("/"));
      const result = await exists(configPath)
        ? { content: await safeRead(configPath) }
        : { content: "", reason: "missing-runner-config" };
      configCache.set(key, result);
      return result;
    }
    let names: string[] = [];
    try {
      names = (await readdir(scopeRoot)).filter((name) => {
        const lower = name.toLowerCase();
        return lower.startsWith(`${prefix}.config.`) || (prefix === "vitest" && lower.startsWith("vite.config."));
      }).sort(utf8Compare);
    } catch {
      // Missing scope directory means there is no config evidence.
    }
    if (prefix === "jest") {
      const packageJson = await safeRead(path.join(scopeRoot, "package.json"));
      try {
        const parsed = JSON.parse(packageJson) as { jest?: unknown };
        if (Object.prototype.hasOwnProperty.call(parsed, "jest")) {
          if (names.length > 0) {
            const result = { content: "", reason: "ambiguous-runner-config" };
            configCache.set(key, result);
            return result;
          }
          if (!parsed.jest || typeof parsed.jest !== "object" || Array.isArray(parsed.jest)) {
            const result = { content: "", reason: "dynamic-test-config-unverified" };
            configCache.set(key, result);
            return result;
          }
          const result = { content: `module.exports = ${JSON.stringify(parsed.jest)};` };
          configCache.set(key, result);
          return result;
        }
      } catch {
        // Invalid package metadata cannot add Jest config evidence.
      }
    }
    const result = names.length > 1
      ? { content: "", reason: "ambiguous-runner-config" }
      : { content: names.length === 1 ? await safeRead(path.join(scopeRoot, names[0]!)) : "" };
    configCache.set(key, result);
    return result;
  };
  const output: RepoTestFileInfo[] = [];
  for (const file of testFiles) {
    if (file.eligibilityEvidence.includes("candidate:no-runnable-declaration")) {
      output.push(file);
      continue;
    }
    const matchingRunners = testRunners.filter((runner) =>
      runner.runtime === file.runtime
      && runner.scope === file.scope
      && (runner.kind === file.kind || (runner.kind === "unit" && file.runtime === "javascript" && file.kind === "component"))
      && runnerMatchesDeclaredFileTool(runner, file)
      && isSafeStructuredRunnerCommand(runner.command)
    );
    const relativeToScope = file.scope === "." ? file.path : path.posix.relative(file.scope, file.path);
    const fileContent = await safeRead(path.join(repoRoot, ...file.path.split("/")));
    const evidence: string[] = [];
    let runnerEligible = false;
    for (const runner of matchingRunners) {
      if (runner.discoveryConstraints.some((constraint) => constraint.startsWith("unparsed-"))) {
        evidence.push(`runner:${runner.tool}:restricted-discovery-unverified`);
        continue;
      }
      const explicitFiles = runner.discoveryConstraints.filter((constraint) => constraint.startsWith("file:")).map((constraint) => constraint.slice("file:".length));
      if (explicitFiles.length > 0) {
        const matches = explicitFiles.includes(file.path);
        evidence.push(`runner:${runner.tool}:${matches ? "explicit-file" : "outside-explicit-files"}`);
        runnerEligible ||= matches;
        continue;
      }
      if (runner.tool === "vitest") {
        const config = await readRunnerConfig(file.scope, "vitest", runner);
        if (config.reason) {
          evidence.push(`runner:vitest:${config.reason}`);
          continue;
        }
        if (javascriptImportedTestBindings(fileContent, "vitest").length === 0 && !staticVitestGlobalsEnabled(config.content)) {
          evidence.push("runner:vitest:globals-disabled-unverified");
          continue;
        }
        const decision = matchesStaticJsTestConfig(relativeToScope, config.content, "include");
        evidence.push(`runner:vitest:${decision.reason}`);
        runnerEligible ||= decision.matches;
        continue;
      }
      if (runner.tool === "jest") {
        const config = await readRunnerConfig(file.scope, "jest", runner);
        if (config.reason) {
          evidence.push(`runner:jest:${config.reason}`);
          continue;
        }
        const decision = matchesStaticJsTestConfig(relativeToScope, config.content, "testMatch");
        evidence.push(`runner:jest:${decision.reason}`);
        runnerEligible ||= decision.matches;
        continue;
      }
      if (runner.tool === "pytest") {
        const scopeRoot = file.scope === "." ? repoRoot : path.join(repoRoot, ...file.scope.split("/"));
        const resolvedConfig = await readPytestDiscoveryConfig(scopeRoot, runner);
        if (resolvedConfig.reason) {
          evidence.push(`runner:pytest:${resolvedConfig.reason}`);
          continue;
        }
        const config = resolvedConfig.content;
        const discovery = parsePytestDiscoveryConfig(config);
        if (discovery.unverified) {
          evidence.push(`runner:pytest:${discovery.unverified}`);
          continue;
        }
        const testPaths = discovery.testPaths;
        const normalizedRelative = relativeToScope.toLowerCase();
        const defaultName = /(?:^|\/)(?:test_[^/]+|[^/]+_test)\.py$/u.test(normalizedRelative);
        const matchesPath = testPaths.length === 0 || testPaths.some((testPath) => normalizedRelative === testPath || normalizedRelative.startsWith(`${testPath.replace(/\/$/u, "")}/`));
        const matches = defaultName && matchesPath;
        evidence.push(`runner:pytest:${!defaultName ? "outside-default-discovery" : testPaths.length ? matches ? "matched-testpaths" : "outside-testpaths" : "default-discovery"}`);
        runnerEligible ||= matches;
        continue;
      }
      if (runner.tool === "junit") {
        const matches = /(?:^|\/)src\/test\/(?:java|kotlin)\//u.test(relativeToScope.replaceAll("\\", "/"));
        evidence.push(`runner:junit:${matches ? "default-discovery" : "outside-default-discovery"}`);
        runnerEligible ||= matches;
        continue;
      }
      if (runner.tool === "cargo-test") {
        const matches = /^(?:src\/|tests\/)/u.test(relativeToScope.replaceAll("\\", "/"));
        evidence.push(`runner:cargo-test:${matches ? "default-discovery" : "outside-default-discovery"}`);
        runnerEligible ||= matches;
        continue;
      }
      if (runner.tool === "node-test") {
        const matches = matchesDefaultNodeTestPath(relativeToScope);
        evidence.push(`runner:node-test:${matches ? "default-discovery" : "outside-default-discovery"}`);
        runnerEligible ||= matches;
        continue;
      }
      if (runner.tool === "unittest") {
        const matches = matchesDefaultUnittestPath(relativeToScope) && hasRunnableUnittestTest(maskHashStyleNonCode(fileContent));
        evidence.push(`runner:unittest:${matches ? "default-discovery" : "outside-default-discovery"}`);
        runnerEligible ||= matches;
        continue;
      }
      if (["mocha", "ava", "tap"].includes(runner.tool)) {
        evidence.push(`runner:${runner.tool}:unsupported-discovery-adapter`);
        continue;
      }
      evidence.push(`runner:${runner.tool}:default-discovery`);
      runnerEligible = true;
    }
    if (matchingRunners.length === 0) evidence.push("runner:none-for-scope");
    output.push({ ...file, runnerEligible, eligibilityEvidence: unique(evidence) });
  }
  return output;
}

function staticVitestGlobalsEnabled(config: string): boolean {
  const root = staticRootConfigBlock(config);
  if (!root) return false;
  const testProperty = directStaticObjectProperty(root, "test");
  if (testProperty.occurrences !== 1 || testProperty.dynamic || !testProperty.block) return false;
  let occurrences = 0;
  let enabled = false;
  let objectDepth = 0;
  for (let index = 0; index < testProperty.block.length - 2; index += 1) {
    const token = testProperty.block[index]!;
    if (token.value === "{") objectDepth += 1;
    else if (token.value === "}") objectDepth = Math.max(0, objectDepth - 1);
    else if (objectDepth === 0 && token.value === "globals" && testProperty.block[index + 1]?.value === ":") {
      occurrences += 1;
      enabled = testProperty.block[index + 2]?.value === "true";
    }
  }
  return occurrences === 1 && enabled;
}

async function jvmManifestDeclaresTestFramework(scopeRoot: string, kind: "maven" | "gradle"): Promise<boolean> {
  if (kind === "maven") {
    const content = (await safeRead(path.join(scopeRoot, "pom.xml"))).replace(/<!--[\s\S]*?-->/gu, "").toLowerCase();
    return [...content.matchAll(/<dependency\b[^>]*>([\s\S]*?)<\/dependency>/gu)].some((match) => /<(?:groupid|artifactid)>[^<]*(?:junit|testng)/u.test(match[1] ?? ""))
      && !/<(?:includes|excludes|testSourceDirectory)>/iu.test(content);
  }
  const content = `${await safeRead(path.join(scopeRoot, "build.gradle"))}\n${await safeRead(path.join(scopeRoot, "build.gradle.kts"))}`.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/.*$/gmu, "");
  return /^\s*(?:testImplementation|testRuntimeOnly)\s*(?:\(|\s)\s*["'][^"']*(?:junit|testng)/imu.test(content)
    && !/\b(?:sourceSets|include|exclude|filter)\b/iu.test(content);
}

function runnerMatchesDeclaredFileTool(runner: RepoTestRunnerInfo, file: RepoTestFileInfo): boolean {
  const declaredRunners = file.tools.filter((tool) => ["vitest", "jest", "node-test", "pytest", "unittest", "go-test", "cargo-test", "junit", "playwright", "cypress", "mocha", "ava", "tap"].includes(tool));
  if (runner.tool === "pytest" && declaredRunners.length > 0 && declaredRunners.every((tool) => tool === "pytest" || tool === "unittest")) return true;
  return declaredRunners.length === 0 || declaredRunners.includes(runner.tool);
}

async function readPytestDiscoveryConfig(scopeRoot: string, runner: RepoTestRunnerInfo): Promise<{ content: string; reason?: string }> {
  const exactConfigs = runner.discoveryConstraints.filter((constraint) => constraint.startsWith("config:")).map((constraint) => constraint.slice("config:".length));
  if (exactConfigs.length > 1) return { content: "", reason: "ambiguous-runner-config" };
  if (exactConfigs.length === 1) {
    const configPath = path.join(scopeRoot, ...exactConfigs[0]!.split("/"));
    return await exists(configPath)
      ? { content: (await safeRead(configPath)).toLowerCase() }
      : { content: "", reason: "missing-runner-config" };
  }
  const candidates = [
    ["pytest.ini", /^\s*\[pytest\]/imu],
    ["pyproject.toml", /^\s*\[tool\.pytest\.ini_options\]/imu],
    ["tox.ini", /^\s*\[pytest\]/imu],
    ["setup.cfg", /^\s*\[tool:pytest\]/imu]
  ] as const;
  for (const [name, marker] of candidates) {
    const content = await safeRead(path.join(scopeRoot, name));
    if (marker.test(content)) return { content: content.toLowerCase() };
  }
  return { content: "" };
}

function parsePytestDiscoveryConfig(config: string): { testPaths: string[]; unverified?: string } {
  if (!config.trim()) return { testPaths: [] };
  const lines = config.split(/\r?\n/u);
  const relevant: string[] = [];
  let active = false;
  for (const rawLine of lines) {
    const section = rawLine.trim().match(/^\[([^\]]+)\]$/u)?.[1]?.toLowerCase();
    if (section !== undefined) {
      active = ["pytest", "tool.pytest.ini_options", "tool:pytest"].includes(section);
      continue;
    }
    if (active) relevant.push(rawLine.replace(/\s+#.*$/u, ""));
  }
  const body = relevant.join("\n");
  if (/^\s*(?:python_files|python_functions|python_classes|norecursedirs|collect_ignore|collect_ignore_glob)\s*=/imu.test(body)) return { testPaths: [], unverified: "unsupported-discovery-key" };
  const addoptsDeclarations = [...body.matchAll(/^\s*addopts\s*=\s*([^\r\n]*(?:\r?\n[ \t]+[^\r\n]*)*)/gimu)];
  if (addoptsDeclarations.length > 1) return { testPaths: [], unverified: "duplicate-discovery-key" };
  if (addoptsDeclarations.length === 1) {
    const rawAddopts = addoptsDeclarations[0]?.[1] ?? "";
    const addopts = rawAddopts.replaceAll("[", " ").replaceAll("]", " ").replace(/[,"']/gu, " ").split(/\s+/u).map((value) => value.trim()).filter(Boolean);
    const decision = analyzeRunnerArguments(addopts, pytestRunnerArgumentSpec());
    if (!decision.matches || decision.discoveryConstraints.length > 0) return { testPaths: [], unverified: "unsupported-addopts" };
  }
  const declarations = [...body.matchAll(/^\s*testpaths\s*=\s*([^\r\n]*(?:\r?\n[ \t]+[^\r\n]*)*)/gimu)];
  if (declarations.length > 1) return { testPaths: [], unverified: "duplicate-discovery-key" };
  if (declarations.length === 0) return { testPaths: [] };
  const rawValue = declarations[0]?.[1] ?? "";
  const quoted = [...rawValue.matchAll(/["']([^"']+)["']/gu)].map((match) => match[1]!);
  const values = quoted.length > 0
    ? quoted
    : rawValue.replace(/[,[\]]/gu, " ").split(/\s+/u).map((value) => value.trim()).filter(Boolean);
  if (values.length === 0 || values.some((value) => /[$(){}]/u.test(value))) return { testPaths: [], unverified: "dynamic-discovery-key" };
  return { testPaths: unique(values.map((value) => value.replaceAll("\\", "/").replace(/^\.\//u, "").replace(/\/$/u, "").toLowerCase())) };
}

function matchesStaticJsTestConfig(
  relativePath: string,
  config: string,
  includeKey: string
): { matches: boolean; reason: string } {
  if (!config.trim()) {
    const matches = includeKey === "include" ? matchesDefaultVitestPath(relativePath) : matchesDefaultJestPath(relativePath);
    return { matches, reason: matches ? "default-discovery" : "outside-default-discovery" };
  }
  if (includeKey === "include") {
    if (!hasStaticRootConfigObject(config)) return { matches: false, reason: "dynamic-test-config-unverified" };
    if (hasDynamicShorthandProperty(config, ["test"])) return { matches: false, reason: "dynamic-test-config-unverified" };
    const discovery = staticVitestDiscoveryConfig(config);
    if (discovery.unverified) return { matches: false, reason: discovery.unverified };
    if (discovery.unsupported) return { matches: false, reason: "unsupported-discovery-key" };
    const positiveIncludes = discovery.includes.filter((pattern) => !pattern.startsWith("!"));
    const negativeIncludes = discovery.includes.filter((pattern) => pattern.startsWith("!")).map((pattern) => pattern.slice(1));
    const included = discovery.includePresent
      ? positiveIncludes.length > 0
        && positiveIncludes.some((pattern) => minimatch(relativePath, pattern, { dot: true }))
        && !negativeIncludes.some((pattern) => minimatch(relativePath, pattern, { dot: true }))
      : matchesDefaultVitestPath(relativePath);
    const excluded = discovery.excludes.some((pattern) => minimatch(relativePath, pattern, { dot: true }) || relativePath.includes(pattern.replace(/^\^|\$$/gu, "")));
    return {
      matches: included && !excluded,
      reason: !included ? "outside-include" : excluded ? "matched-exclude" : discovery.includes.length ? "matched-include" : "default-discovery"
    };
  }
  const jestDiscovery = staticJestDiscoveryConfig(config);
  if (jestDiscovery.unverified) return { matches: false, reason: jestDiscovery.unverified };
  if (jestDiscovery.unsupported) return { matches: false, reason: "unsupported-discovery-key" };
  const includes = jestDiscovery.includes;
  const excludes = jestDiscovery.excludes;
  const included = jestDiscovery.includePresent ? includes.some((pattern) => minimatch(relativePath, pattern, { dot: true })) : matchesDefaultJestPath(relativePath);
  const excluded = excludes.some((pattern) => minimatch(relativePath, pattern, { dot: true }) || relativePath.includes(pattern.replace(/^\^|\$$/gu, "")));
  return { matches: included && !excluded, reason: !included ? "outside-include" : excluded ? "matched-exclude" : includes.length ? "matched-include" : "default-discovery" };
}

function matchesDefaultVitestPath(relativePath: string): boolean {
  return /(?:^|\/)[^/]+\.(?:test|spec)\.[cm]?[jt]sx?$/iu.test(relativePath);
}

function matchesDefaultJestPath(relativePath: string): boolean {
  return /(?:^|\/)__tests__\/[^/]+\.[cm]?[jt]sx?$/iu.test(relativePath)
    || /(?:^|\/)[^/]+\.(?:test|spec)\.[cm]?[jt]sx?$/iu.test(relativePath);
}

function matchesDefaultNodeTestPath(relativePath: string): boolean {
  return /(?:^|\/)test\/.*\.[cm]?[jt]s$/u.test(relativePath)
    || /(?:^|\/)(?:test|test-[^/]+|[^/]+-test|[^/]+_test|[^/]+\.test)\.[cm]?[jt]s$/u.test(relativePath);
}

function matchesDefaultUnittestPath(relativePath: string): boolean {
  return /(?:^|\/)test[^/]*\.py$/u.test(relativePath);
}

function hasRunnableUnittestTest(code: string): boolean {
  const lines = code.split(/\r?\n/u);
  let classIndent = -1;
  let testCaseClass = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (!line.trim()) continue;
    const indent = line.match(/^[ \t]*/u)?.[0].replaceAll("\t", "    ").length ?? 0;
    if (classIndent >= 0 && indent <= classIndent && !/^\s*@/u.test(line)) {
      classIndent = -1;
      testCaseClass = false;
    }
    const classMatch = line.match(/^\s*class\s+[A-Za-z_][A-Za-z0-9_]*(?:\(([^)]*)\))?\s*:/u);
    if (classMatch) {
      classIndent = indent;
      testCaseClass = /(?:^|\.)TestCase\b/u.test(classMatch[1] ?? "");
      continue;
    }
    if (!testCaseClass || classIndent < 0 || indent <= classIndent || !/^\s*(?:async\s+)?def\s+test_[A-Za-z0-9_]*\s*\(/u.test(line)) continue;
    const decoratorBlock = lines.slice(Math.max(0, index - 4), index).join("\n");
    if (!/@(?:unittest\.skip(?:If|Unless)?|pytest\.mark\.skip(?:if)?)\b/u.test(decoratorBlock)) return true;
  }
  return false;
}

function hasStaticRootConfigObject(config: string): boolean {
  return staticRootConfigBlock(config) !== undefined;
}

function staticRootConfigBlock(config: string): JsConfigToken[] | undefined {
  const tokens = jsConfigTokens(config);
  const exports: Array<{ start: number; end: number; kind: "commonjs" | "esm"; tokenIndex: number } | undefined> = [];
  const defineConfigImported = configProvidesDefineConfig(tokens);
  const moduleReferenceIndexes = tokens.flatMap((token, index) => token.value === "module" && tokens[index + 1]?.value === "." && tokens[index + 2]?.value === "exports" ? [index] : []);
  const bareExportsReference = tokens.some((token, index) => token.value === "exports" && tokens[index - 1]?.value !== "." && [".", "["].includes(tokens[index + 1]?.value ?? ""));
  let objectDepth = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    const moduleExport = tokens[index]?.value === "module"
      && tokens[index + 1]?.value === "."
      && tokens[index + 2]?.value === "exports"
      && tokens[index + 3]?.value === "=";
    const defaultExport = tokens[index]?.value === "export" && tokens[index + 1]?.value === "default";
    if ((!moduleExport && !defaultExport) || objectDepth !== 0) {
      if (tokens[index]?.value === "{") objectDepth += 1;
      else if (tokens[index]?.value === "}") objectDepth = Math.max(0, objectDepth - 1);
      continue;
    }
    if (moduleExport && index > 0 && ![";", "}"].includes(tokens[index - 1]?.value ?? "")) {
      exports.push(undefined);
      continue;
    }
    const valueIndex = index + (moduleExport ? 4 : 2);
    const start = tokens[valueIndex]?.value === "{"
      ? valueIndex
      : defineConfigImported && tokens[valueIndex]?.value === "defineConfig" && tokens[valueIndex + 1]?.value === "(" && tokens[valueIndex + 2]?.value === "{"
        ? valueIndex + 2
        : -1;
    const end = start >= 0 ? matchingTokenIndex(tokens, start, "{", "}") : -1;
    exports.push(start >= 0 && end >= 0 ? { start, end, kind: moduleExport ? "commonjs" : "esm", tokenIndex: index } : undefined);
  }
  if (exports.length !== 1 || !exports[0]) return undefined;
  const selected = exports[0];
  if (selected.kind === "commonjs") {
    if (moduleReferenceIndexes.length !== 1 || moduleReferenceIndexes[0] !== selected.tokenIndex || bareExportsReference) return undefined;
  } else if (moduleReferenceIndexes.length > 0 || bareExportsReference) {
    return undefined;
  }
  return tokens.slice(selected.start + 1, selected.end);
}

function configProvidesDefineConfig(tokens: JsConfigToken[]): boolean {
  const shadowed = tokens.some((token, index) =>
    (token.value === "function" && tokens[index + 1]?.value === "defineConfig")
    || (["const", "let", "var"].includes(token.value) && tokens[index + 1]?.value === "defineConfig" && tokens[index + 2]?.value === "=")
    || (token.value === "defineConfig" && tokens[index + 1]?.value === "=")
  );
  if (shadowed) return false;
  return tokens.some((token, index) => {
    if (token.value === "from" && tokens[index + 1]?.kind === "string" && ["vitest/config", "vite"].includes(tokens[index + 1]!.value)) {
      let importIndex = index - 1;
      while (importIndex >= 0 && !["import", ";"].includes(tokens[importIndex]?.value ?? "")) importIndex -= 1;
      if (tokens[importIndex]?.value !== "import") return false;
      for (let bindingIndex = importIndex + 1; bindingIndex < index; bindingIndex += 1) {
        if (tokens[bindingIndex]?.value === "defineConfig" && tokens[bindingIndex + 1]?.value !== "as") return true;
      }
      return false;
    }
    if (token.value !== "require" || tokens[index + 1]?.value !== "(" || tokens[index + 2]?.kind !== "string" || !["vitest/config", "vite"].includes(tokens[index + 2]!.value)) return false;
    let declarationIndex = index - 1;
    while (declarationIndex >= 0 && !["const", "let", "var", ";"].includes(tokens[declarationIndex]?.value ?? "")) declarationIndex -= 1;
    if (!["const", "let", "var"].includes(tokens[declarationIndex]?.value ?? "")) return false;
    return tokens.slice(declarationIndex + 1, index).some((binding, offset) => binding.value === "defineConfig" && tokens[declarationIndex + 1 + offset + 1]?.value !== ":");
  });
}

function staticJestDiscoveryConfig(config: string): {
  includes: string[];
  excludes: string[];
  includePresent: boolean;
  unsupported: boolean;
  unverified?: string;
} {
  const block = staticRootConfigBlock(config);
  if (!block) return { includes: [], excludes: [], includePresent: false, unsupported: false, unverified: "dynamic-test-config-unverified" };
  if (block.some((token, index) => token.value === "." && block[index + 1]?.value === "." && block[index + 2]?.value === ".")) {
    return { includes: [], excludes: [], includePresent: false, unsupported: false, unverified: "dynamic-test-config-unverified" };
  }
  if (hasDynamicShorthandProperty(config, ["testMatch", "testPathIgnorePatterns", "testRegex", "roots"])) {
    return { includes: [], excludes: [], includePresent: false, unsupported: false, unverified: "dynamic-test-config-unverified" };
  }
  const includes = directStaticArrayProperty(block, "testMatch");
  const excludes = directStaticArrayProperty(block, "testPathIgnorePatterns");
  if (includes.dynamic || excludes.dynamic) return { includes: [], excludes: [], includePresent: includes.present, unsupported: false, unverified: "dynamic-discovery-key" };
  if (includes.occurrences > 1 || excludes.occurrences > 1) return { includes: [], excludes: [], includePresent: includes.present, unsupported: false, unverified: "duplicate-discovery-key" };
  if (excludes.present || includes.values.some((pattern) => pattern.startsWith("!"))) return { includes: [], excludes: [], includePresent: includes.present, unsupported: false, unverified: "unsupported-discovery-pattern" };
  const unsupported = ["testRegex", "roots", "projects"].some((key) => directObjectPropertyPresent(block, key));
  return { includes: includes.values, excludes: excludes.values, includePresent: includes.present, unsupported };
}

function hasDynamicShorthandProperty(config: string, keys: string[]): boolean {
  const tokens = jsConfigTokens(config);
  return tokens.some((token, index) => {
    if (!keys.includes(token.value)) return false;
    const previous = tokens[index - 1]?.value;
    const next = tokens[index + 1]?.value;
    if ((previous === "{" || previous === ",") && (next === "," || next === "}" || next === "(")) return true;
    return previous === "[" && next === "]" && tokens[index + 2]?.value === ":";
  });
}

interface JsConfigToken {
  kind: "identifier" | "string" | "punctuation" | "dynamic";
  value: string;
}

interface StaticArrayProperty {
  present: boolean;
  dynamic: boolean;
  occurrences: number;
  values: string[];
}

function staticVitestDiscoveryConfig(config: string): {
  includes: string[];
  excludes: string[];
  includePresent: boolean;
  unsupported: boolean;
  unverified?: string;
} {
  const root = staticRootConfigBlock(config);
  if (!root) return { includes: [], excludes: [], includePresent: false, unsupported: false, unverified: "dynamic-test-config-unverified" };
  if (root.some((token, index) => token.value === "." && root[index + 1]?.value === "." && root[index + 2]?.value === ".")) {
    return { includes: [], excludes: [], includePresent: false, unsupported: false, unverified: "dynamic-test-config-unverified" };
  }
  const testProperty = directStaticObjectProperty(root, "test");
  if (testProperty.occurrences === 0) return { includes: [], excludes: [], includePresent: false, unsupported: false };
  if (testProperty.dynamic || testProperty.occurrences !== 1 || !testProperty.block) {
    return { includes: [], excludes: [], includePresent: false, unsupported: false, unverified: "dynamic-test-config-unverified" };
  }
  const block = testProperty.block;
  if (hasDynamicObjectComposition(block)) return { includes: [], excludes: [], includePresent: false, unsupported: false, unverified: "dynamic-test-config-unverified" };
  const includeProperty = directStaticArrayProperty(block, "include");
  const excludeProperty = directStaticArrayProperty(block, "exclude");
  if (includeProperty.dynamic) return { includes: [], excludes: [], includePresent: true, unsupported: false, unverified: "dynamic-include-unverified" };
  if (excludeProperty.dynamic) return { includes: [], excludes: [], includePresent: includeProperty.present, unsupported: false, unverified: "dynamic-exclude-unverified" };
  if (includeProperty.occurrences > 1 || excludeProperty.occurrences > 1) {
    return { includes: [], excludes: [], includePresent: includeProperty.present, unsupported: false, unverified: "duplicate-discovery-key" };
  }
  const unsupported = ["dir", "projects", "testNamePattern"].some((key) => directObjectPropertyPresent(block, key));
  return {
    includes: includeProperty.values,
    excludes: excludeProperty.values,
    includePresent: includeProperty.present,
    unsupported
  };
}

function directStaticObjectProperty(tokens: JsConfigToken[], key: string): { occurrences: number; dynamic: boolean; block?: JsConfigToken[] } {
  let objectDepth = 0;
  let occurrences = 0;
  let dynamic = false;
  let block: JsConfigToken[] | undefined;
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const token = tokens[index]!;
    if (token.value === "{") objectDepth += 1;
    else if (token.value === "}") objectDepth = Math.max(0, objectDepth - 1);
    else if (objectDepth === 0 && token.value === key && tokens[index + 1]?.value === ":") {
      occurrences += 1;
      if (tokens[index + 2]?.value !== "{") {
        dynamic = true;
        continue;
      }
      const end = matchingTokenIndex(tokens, index + 2, "{", "}");
      if (end < 0) dynamic = true;
      else {
        block = tokens.slice(index + 3, end);
        index = end;
      }
    }
  }
  return { occurrences, dynamic, block };
}

function hasDynamicObjectComposition(tokens: JsConfigToken[]): boolean {
  let objectDepth = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token.value === "{") objectDepth += 1;
    else if (token.value === "}") objectDepth = Math.max(0, objectDepth - 1);
    else if (objectDepth === 0 && token.value === "." && tokens[index + 1]?.value === "." && tokens[index + 2]?.value === ".") return true;
    else if (objectDepth === 0 && token.value === "[" && tokens[index - 1]?.value !== ":") return true;
  }
  return false;
}

function directStaticArrayProperty(tokens: JsConfigToken[], key: string): StaticArrayProperty {
  let objectDepth = 0;
  let present = false;
  let dynamic = false;
  let occurrences = 0;
  const values: string[] = [];
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const token = tokens[index]!;
    if (token.value === "{") {
      objectDepth += 1;
      continue;
    }
    if (token.value === "}") {
      objectDepth = Math.max(0, objectDepth - 1);
      continue;
    }
    if (objectDepth !== 0 || token.value !== key || tokens[index + 1]?.value !== ":") continue;
    present = true;
    occurrences += 1;
    if (tokens[index + 2]?.value !== "[") {
      dynamic = true;
      continue;
    }
    const end = matchingTokenIndex(tokens, index + 2, "[", "]");
    if (end < 0) {
      dynamic = true;
      continue;
    }
    const arrayTokens = tokens.slice(index + 3, end);
    if (arrayTokens.some((candidate) => candidate.kind !== "string" && candidate.value !== ",")) {
      dynamic = true;
      continue;
    }
    values.push(...arrayTokens.filter((candidate) => candidate.kind === "string").map((candidate) => candidate.value));
    index = end;
  }
  return { present, dynamic, occurrences, values: unique(values) };
}

function directObjectPropertyPresent(tokens: JsConfigToken[], key: string): boolean {
  let objectDepth = 0;
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const token = tokens[index]!;
    if (token.value === "{") objectDepth += 1;
    else if (token.value === "}") objectDepth = Math.max(0, objectDepth - 1);
    else if (objectDepth === 0 && token.value === key && tokens[index + 1]?.value === ":") return true;
  }
  return false;
}

function matchingTokenIndex(tokens: JsConfigToken[], start: number, open: string, close: string): number {
  let depth = 0;
  for (let index = start; index < tokens.length; index += 1) {
    if (tokens[index]?.value === open) depth += 1;
    else if (tokens[index]?.value === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function jsConfigTokens(source: string): JsConfigToken[] {
  const tokens: JsConfigToken[] = [];
  for (let index = 0; index < source.length;) {
    const current = source[index]!;
    const next = source[index + 1];
    if (/\s/u.test(current)) {
      index += 1;
      continue;
    }
    if (current === "/" && next === "/") {
      index += 2;
      while (index < source.length && source[index] !== "\n") index += 1;
      continue;
    }
    if (current === "/" && next === "*") {
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) index += 1;
      index = Math.min(source.length, index + 2);
      continue;
    }
    if (current === "'" || current === '"') {
      const quote = current;
      let value = "";
      index += 1;
      while (index < source.length && source[index] !== quote) {
        if (source[index] === "\\" && index + 1 < source.length) {
          const escaped = source[index + 1]!;
          value += escaped === quote || escaped === "\\" ? escaped : `\\${escaped}`;
          index += 2;
        } else {
          value += source[index]!;
          index += 1;
        }
      }
      index += index < source.length ? 1 : 0;
      tokens.push({ kind: "string", value });
      continue;
    }
    if (current === "`") {
      index += 1;
      while (index < source.length) {
        if (source[index] === "\\") index += 2;
        else if (source[index] === "`") {
          index += 1;
          break;
        } else index += 1;
      }
      tokens.push({ kind: "dynamic", value: "<template>" });
      continue;
    }
    if (/[A-Za-z_$]/u.test(current)) {
      const start = index;
      index += 1;
      while (index < source.length && /[A-Za-z0-9_$]/u.test(source[index]!)) index += 1;
      tokens.push({ kind: "identifier", value: source.slice(start, index) });
      continue;
    }
    tokens.push({ kind: "punctuation", value: current });
    index += 1;
  }
  return tokens;
}

function nodeCommandProvider(packageManager: RepoPackageManager): "npm" | "pnpm" | "yarn" {
  return packageManager === "pnpm" || packageManager === "yarn" ? packageManager : "npm";
}

function packageScriptCommand(packageManager: RepoPackageManager, scope: string, scriptName: string): RepoTestRunnerInfo["command"] {
  const provider = nodeCommandProvider(packageManager);
  const args = provider === "npm"
    ? scriptName === "test" ? ["test"] : ["run", scriptName]
    : provider === "pnpm"
      ? scriptName === "test" ? ["test"] : ["run", scriptName]
      : scriptName === "test" ? ["test"] : ["run", scriptName];
  return structuredCommand(scope, provider, args);
}

function nodeDependencyTestCommand(packageManager: RepoPackageManager, scope: string, tool: string): RepoTestRunnerInfo["command"] {
  const provider = nodeCommandProvider(packageManager);
  if (tool === "node-test") return structuredCommand(scope, "node", ["--test"]);
  const toolArgs = tool === "vitest" ? [tool, "run"] : [tool];
  if (provider === "npm") return structuredCommand(scope, "npm", ["exec", "--", ...toolArgs]);
  if (provider === "pnpm") return structuredCommand(scope, "pnpm", ["exec", ...toolArgs]);
  return structuredCommand(scope, "yarn", ["exec", ...toolArgs]);
}

function structuredCommand(cwd: string, executable: string, args: string[]): RepoTestRunnerInfo["command"] {
  return { cwd, executable, args };
}

function detectTestTools(
  deps: string[],
  scripts: RepoScriptInfo[],
  sourceFiles: string[],
  testFiles: RepoTestFileInfo[],
  testRunners: RepoTestRunnerInfo[]
): string[] {
  const tools = new Set<string>();
  const corpus = `${deps.join(" ")} ${scripts.map((script) => `${script.name} ${script.command}`).join(" ")} ${sourceFiles.join(" ")}`.toLowerCase();
  for (const tool of ["playwright", "vitest", "jest", "cypress", "storybook", "testing-library", "axe", "eslint", "typescript", "mocha", "ava", "tap", "pytest"]) {
    if (corpus.includes(tool)) tools.add(tool);
  }
  if (corpus.includes("@playwright/test")) tools.add("playwright");
  if (corpus.includes("node --test") || corpus.includes("node:test")) tools.add("node-test");
  for (const tool of testFiles.flatMap((file) => file.tools)) tools.add(tool);
  for (const runner of testRunners) tools.add(runner.tool);
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
  testFiles: RepoTestFileInfo[];
  testRunners: RepoTestRunnerInfo[];
  runtimeScopes: RepoRuntimeScopeInfo[];
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
  const unitScopes = unitTestScopes(input.testRunners, input.testFiles, input.runtimeScopes);
  const incompleteScopes = incompleteUnitTestScopeMessages(unitScopes);
  if (unitScopes.length === 0 || incompleteScopes.length > 0) {
    const message = incompleteScopes.length > 0
      ? `Unit test evidence is incomplete by runtime: ${incompleteScopes.join(" ")}`
      : "No repository unit test runner or executable unit test file was detected.";
    risks.push(risk(
      "missing_unit_test_signal",
      "info",
      message,
      unitScopes.length > 0
        ? unitScopes.map((scope) => `${scope.runtime}:runners=${scope.runners.join(",") || "none"}:files=${scope.files.join(",") || "none"}`)
        : ["unitScopes=none"],
      "Add matching focused unit test files or deterministic runners for every active runtime scope."
    ));
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
  testFiles: RepoTestFileInfo[];
  testRunners: RepoTestRunnerInfo[];
  runtimeScopes: RepoRuntimeScopeInfo[];
  riskSignals: RepoRiskSignal[];
}): RepoCoverageGap[] {
  const gaps: RepoCoverageGap[] = [];
  if (input.riskSignals.some((risk) => risk.id === "missing_visual_hive_config")) {
    gaps.push(gap("repo-intelligence-config", 0, "medium", "Visual Hive config is not present yet.", ".visual-hive/recommendations.json"));
  }
  if (!input.workflows.length) gaps.push(gap("workflow-safety", 1, "medium", "No workflow safety lane was detected.", ".visual-hive/workflows.json"));
  const unitScopes = unitTestScopes(input.testRunners, input.testFiles, input.runtimeScopes);
  const incompleteUnitScopes = unitScopes.filter((scope) => scope.status === "partial");
  if (incompleteUnitScopes.length > 0) {
    const hasAmbiguousCandidate = (runtime: RepoTestRuntime, scope: string) => input.testFiles.some((file) =>
      file.runtime === runtime
      && file.scope === scope
      && !file.runnerEligible
      && file.eligibilityEvidence.some((item) => /(?:unverified|ambiguous|restricted|missing-runner-config|unsupported|globals-disabled)/u.test(item))
    );
    const actionableScopes = incompleteUnitScopes.filter((scope) =>
      scope.runners.length > 0
      && scope.files.length === 0
      && scope.runtime !== "ruby"
      && scope.runtime !== "php"
      && !hasAmbiguousCandidate(scope.runtime, scope.scope)
    );
    const advisoryScopes = incompleteUnitScopes.filter((scope) => !actionableScopes.includes(scope));
    if (actionableScopes.length > 0) {
      gaps.push(gap("unit-layer", 2, "low", `Unit test evidence is incomplete by runtime: ${incompleteUnitTestScopeMessages(actionableScopes).join(" ")}`, "matching unit test file for each detected runner"));
    }
    if (advisoryScopes.length > 0) {
      gaps.push(gap(actionableScopes.length > 0 ? "unit-layer-advisory" : "unit-layer", 2, "low", `Unit test setup requires advisory review: ${incompleteUnitTestScopeMessages(advisoryScopes).join(" ")}`, "advisory-only: deterministic runner/setup required"));
    }
  }
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
  for (const entry of entries.sort((left, right) => utf8Compare(left.name, right.name))) {
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
  const resourceId =
    artifactPath.endsWith("visual-graph.json")
      ? "visual-graph"
      : artifactPath.endsWith("visual-graph-summary.md")
        ? "visual-graph-summary"
        : artifactPath.endsWith("visual-graph-vocab.json")
          ? "visual-graph-vocab"
          : artifactPath.endsWith("visual-graph-unresolved.json")
            ? "visual-graph-unresolved"
            : "repo-map";
  const resource = getEvidenceResourceById(resourceId);
  return {
    artifactPath,
    evidenceResourceId: resource?.id ?? resourceId,
    evidenceResourceUri: resource?.uri ?? `visual-hive://${resourceId}`,
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

function utf8Compare(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
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
