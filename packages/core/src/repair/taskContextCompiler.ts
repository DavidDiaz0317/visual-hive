import { realpath, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { VisualHiveConfig, ContractConfig } from "../config/schema.js";
import { searchVisualGraph } from "../graph/build.js";
import type { VisualGraph, VisualGraphNode, VisualGraphNodeKind } from "../graph/types.js";
import type { RepoMapReport } from "../repo/types.js";
import {
  assertPermittedVisualTaskPath,
  buildVisualHiveTaskContext,
  computeVisualRepositoryFingerprint,
  computeVisualValidationProfileDigest
} from "./build.js";
import { canonicalSha256, sha256Bytes, sha256Utf8, stableTextCompare } from "./canonical.js";
import {
  BoundedIdSchema,
  GitCommitSchema,
  RelativeArtifactPathSchema,
  type VisualHiveTaskContext,
  type VisualHiveTaskContextInput,
  type VisualTaskAsset
} from "./types.js";

const DEFAULT_BOUNDS: VisualTaskContextCompilerBounds = {
  maxCandidates: 32,
  maxSourceFiles: 32,
  maxSourceBytes: 2 * 1024 * 1024,
  maxSourceFileBytes: 512 * 1024,
  maxSpansPerCandidate: 8,
  maxObligations: 64
};

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "from", "has", "have", "in", "is", "it", "of", "on", "or", "that", "the", "this", "to", "was", "when", "with"
]);

const GRAPH_KIND_MAP: Partial<Record<VisualGraphNodeKind, VisualHiveTaskContext["graphCandidates"][number]["kind"]>> = {
  file: "file",
  component: "component",
  layout: "component",
  route: "route",
  selector: "selector",
  contract: "contract",
  screenshot: "flow",
  mutation_operator: "mutation"
};

export interface VisualTaskContextCompilerBounds {
  maxCandidates: number;
  maxSourceFiles: number;
  maxSourceBytes: number;
  maxSourceFileBytes: number;
  maxSpansPerCandidate: number;
  maxObligations: number;
}

export interface CompileVisualTaskContextOptions {
  repoRoot: string;
  generatedAt: string;
  taskId: string;
  repository: {
    name: string;
    repositoryId?: string;
    baseSha: string;
    ref?: string;
  };
  issue: Omit<VisualHiveTaskContextInput["issue"], "problemStatementSha256">;
  assets?: VisualTaskAsset[];
  imageReferences?: VisualHiveTaskContextInput["imageReferences"];
  config: VisualHiveConfig;
  repoMap: RepoMapReport;
  graph: VisualGraph;
  observedCheckoutSha: string;
  registeredValidationCommands?: Readonly<Record<string, string>>;
  bounds?: Partial<VisualTaskContextCompilerBounds>;
}

export interface VisualTaskContextBuildReport {
  schemaVersion: "visual-hive.task-context-build-report.v1";
  generatedAt: string;
  taskId: string;
  inputDigests: {
    config: string;
    repoMap: string;
    graph: string;
  };
  repository: {
    baseSha: string;
    observedCheckoutSha: string | null;
    checkoutVerified: boolean;
  };
  bounds: VisualTaskContextCompilerBounds;
  selection: {
    graphCandidateIds: string[];
    matchedContractIds: string[];
    mappedContractIds: string[];
    profileIds: string[];
    obligationIds: string[];
  };
  sourceContext: {
    selectedFiles: number;
    selectedBytes: number;
    omittedPaths: number;
    truncated: boolean;
  };
  assets: {
    verified: number;
    imageReferences: number;
  };
  resolution: {
    deterministicObligations: number;
    advisoryObligations: number;
    codes: string[];
  };
  contextDigest: string;
  reportDigest: string;
}

export interface CompiledVisualTaskContext {
  input: VisualHiveTaskContextInput;
  taskContext: VisualHiveTaskContext;
  report: VisualTaskContextBuildReport;
}

interface RankedContract {
  contract: ContractConfig;
  score: number;
  reasons: string[];
}

interface RankedNode {
  node: VisualGraphNode;
  score: number;
  reasons: string[];
}

interface SourceFile {
  path: string;
  bytes: Uint8Array;
  text: string;
  lines: string[];
}

interface ScreenshotBinding {
  screenshotName: string;
  route: string;
  viewportId: string;
}

/**
 * Compile local repository facts into an immutable repair task context.
 *
 * The compiler is deliberately read-only and evidence-conservative. It never
 * searches the network, invokes a model, runs repository commands, or creates
 * a route, selector, contract, viewport, or validation command that was not
 * already present in the supplied repository evidence.
 */
export async function compileVisualHiveTaskContext(options: CompileVisualTaskContextOptions): Promise<CompiledVisualTaskContext> {
  const root = path.resolve(options.repoRoot);
  const rootReal = await realpath(root);
  if (!GitCommitSchema.safeParse(options.repository.baseSha).success) {
    throw new Error("Visual Hive task-context compiler repository base SHA format is invalid.");
  }
  if (!GitCommitSchema.safeParse(options.observedCheckoutSha).success) {
    throw new Error("Visual Hive task-context compiler observed checkout SHA format is invalid.");
  }
  if (options.observedCheckoutSha !== options.repository.baseSha) {
    throw new Error("Visual Hive task-context compiler repository base SHA does not match the observed checkout SHA.");
  }
  let repoMapRootReal: string;
  try {
    const repoMapRoot = path.isAbsolute(options.repoMap.repoRoot)
      ? path.resolve(options.repoMap.repoRoot)
      : path.resolve(root, options.repoMap.repoRoot);
    repoMapRootReal = await realpath(repoMapRoot);
  } catch {
    throw new Error("Visual Hive task-context compiler repository map does not belong to repoRoot.");
  }
  if (path.relative(rootReal, repoMapRootReal) !== "") {
    throw new Error("Visual Hive task-context compiler repository map does not belong to repoRoot.");
  }

  const bounds = normalizeBounds(options.bounds);
  const resolutionCodes = new Set<string>();
  const issueText = [options.issue.title ?? "", options.issue.problemStatement].join("\n");
  const issueTokens = tokens(issueText);
  const rankedContracts = rankContracts(options.config, issueText, issueTokens);
  if (rankedContracts.length === 0) resolutionCodes.add("no_configured_contract_match");

  const verifiedAssets = await verifyAssets(rootReal, options.assets ?? []);
  const imageReferences = options.imageReferences ?? [];
  const rankedNodes = rankGraphNodes(options.graph, issueText, issueTokens, rankedContracts);
  const sourceState = {
    files: new Map<string, SourceFile>(),
    selectedBytes: 0,
    omittedPaths: 0,
    truncated: false
  };
  const graphCandidates: VisualHiveTaskContextInput["graphCandidates"] = [];

  for (const ranked of rankedNodes) {
    if (graphCandidates.length >= bounds.maxCandidates) {
      sourceState.truncated = true;
      break;
    }
    if (!BoundedIdSchema.safeParse(ranked.node.id).success) {
      resolutionCodes.add("invalid_graph_node_id_omitted");
      continue;
    }
    const kind = GRAPH_KIND_MAP[ranked.node.kind];
    if (!kind) continue;
    const spans = [] as VisualHiveTaskContextInput["graphCandidates"][number]["sourceSpans"];
    for (const sourcePath of sourcePathsFor(ranked.node, options.repoMap)) {
      if (spans.length >= bounds.maxSpansPerCandidate) break;
      const source = await loadSourceFile(rootReal, sourcePath, bounds, sourceState);
      if (!source) continue;
      const span = exactSpanFor(ranked.node, source);
      if (span) spans.push(span);
    }
    if (spans.length === 0) {
      resolutionCodes.add("graph_candidate_without_exact_source_omitted");
      continue;
    }
    graphCandidates.push({
      nodeId: ranked.node.id,
      kind,
      label: ranked.node.label.slice(0, 2048),
      score: ranked.score,
      reasons: ranked.reasons,
      sourceSpans: uniqueSpans(spans)
    });
  }

  const profileResult = buildProfiles(options.config, rankedContracts, options.registeredValidationCommands ?? {}, resolutionCodes);
  const obligationResult = buildObligations(rankedContracts, profileResult.profiles, verifiedAssets, bounds, resolutionCodes);
  const usedSourcePaths = new Set(graphCandidates.flatMap((candidate) => candidate.sourceSpans.map((span) => span.path)));
  const unusedSourcePaths = [...sourceState.files.keys()].filter((sourcePath) => !usedSourcePaths.has(sourcePath)).length;
  const omittedPaths = sourceState.omittedPaths + unusedSourcePaths;
  const sourceFiles = [...sourceState.files.values()]
    .filter((file) => usedSourcePaths.has(file.path))
    .map((file) => ({
      path: file.path,
      sha256: sha256Bytes(file.bytes),
      size: file.bytes.byteLength,
      classification: classifySource(file.path)
    }))
    .sort((left, right) => stableTextCompare(left.path, right.path));
  const sourceContext = {
    files: sourceFiles,
    omittedPaths,
    truncated: sourceState.truncated,
    digest: canonicalSha256({ files: sourceFiles, omittedPaths, truncated: sourceState.truncated })
  };

  const repository = {
    name: options.repository.name,
    ...(options.repository.repositoryId ? { repositoryId: options.repository.repositoryId } : {}),
    repositoryFingerprint: computeVisualRepositoryFingerprint(options.repository.name, options.repository.repositoryId),
    baseSha: options.repository.baseSha,
    ...(options.repository.ref ? { ref: options.repository.ref } : {})
  };
  const input: VisualHiveTaskContextInput = {
    schemaVersion: "visual-hive.task-context.v1",
    digestAlgorithm: "visual-hive.canonical-json.sha256.v1",
    generatedAt: options.generatedAt,
    taskId: options.taskId,
    repository,
    issue: {
      ...options.issue,
      problemStatementSha256: sha256Utf8(options.issue.problemStatement)
    },
    assets: verifiedAssets,
    imageReferences,
    graphCandidates,
    profiles: profileResult.profiles,
    obligations: obligationResult,
    sourceContext
  };
  const taskContext = buildVisualHiveTaskContext(input);
  const reportContent = {
    schemaVersion: "visual-hive.task-context-build-report.v1" as const,
    generatedAt: options.generatedAt,
    taskId: options.taskId,
    inputDigests: {
      config: canonicalSha256(options.config),
      repoMap: canonicalSha256(options.repoMap),
      graph: canonicalSha256(options.graph)
    },
    repository: {
      baseSha: options.repository.baseSha,
      observedCheckoutSha: options.observedCheckoutSha,
      checkoutVerified: true
    },
    bounds,
    selection: {
      graphCandidateIds: taskContext.graphCandidates.map((candidate) => candidate.nodeId),
      matchedContractIds: rankedContracts.map(({ contract }) => contract.id).sort(stableTextCompare),
      mappedContractIds: [...new Set(taskContext.obligations.flatMap((obligation) => obligation.mappedContractIds))].sort(stableTextCompare),
      profileIds: taskContext.profiles.map((profile) => profile.profileId),
      obligationIds: taskContext.obligations.map((obligation) => obligation.obligationId)
    },
    sourceContext: {
      selectedFiles: sourceFiles.length,
      selectedBytes: sourceFiles.reduce((sum, file) => sum + file.size, 0),
      omittedPaths,
      truncated: sourceState.truncated
    },
    assets: {
      verified: verifiedAssets.length,
      imageReferences: imageReferences.length
    },
    resolution: {
      deterministicObligations: taskContext.obligations.filter((obligation) => obligation.authority === "deterministic").length,
      advisoryObligations: taskContext.obligations.filter((obligation) => obligation.authority === "advisory").length,
      codes: [...resolutionCodes].sort(stableTextCompare)
    },
    contextDigest: taskContext.contextDigest
  };
  return {
    input,
    taskContext,
    report: { ...reportContent, reportDigest: canonicalSha256(reportContent) }
  };
}

function normalizeBounds(input: Partial<VisualTaskContextCompilerBounds> | undefined): VisualTaskContextCompilerBounds {
  const bounds = { ...DEFAULT_BOUNDS, ...input };
  for (const [name, value] of Object.entries(bounds)) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Visual Hive task-context compiler bound ${name} must be a positive safe integer.`);
  }
  if (bounds.maxCandidates > 256 || bounds.maxSourceFiles > 512 || bounds.maxSourceFileBytes > 8 * 1024 * 1024 || bounds.maxSpansPerCandidate > 64 || bounds.maxObligations > 256) {
    throw new Error("Visual Hive task-context compiler bounds exceed the task-context schema limits.");
  }
  return bounds;
}

function rankContracts(config: VisualHiveConfig, issueText: string, issueTokens: string[]): RankedContract[] {
  return config.contracts
    .map((contract) => {
      const facts = contractFacts(contract);
      const match = matchEvidence(issueText, issueTokens, facts);
      return { contract, score: match.score, reasons: match.reasons };
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || stableTextCompare(left.contract.id, right.contract.id));
}

function rankGraphNodes(graph: VisualGraph, issueText: string, issueTokens: string[], contracts: RankedContract[]): RankedNode[] {
  const searched = new Map(searchVisualGraph(graph, issueText).map((result) => [result.node.id, result]));
  const contractFactsSet = new Set(contracts.flatMap(({ contract }) => contractFacts(contract).map(normalizeFact)));
  return graph.nodes
    .filter((node) => GRAPH_KIND_MAP[node.kind] !== undefined && !["suppressed", "conflicted"].includes(node.status))
    .map((node) => {
      const facts = nodeFacts(node);
      const match = matchEvidence(issueText, issueTokens, facts);
      const graphJoin = facts.some((fact) => contractFactsSet.has(normalizeFact(fact)));
      const searchResult = searched.get(node.id);
      const relevant = match.score > 0 || graphJoin;
      const confidence = Math.min(1, Math.max(0, node.confidence));
      const score = relevant ? roundScore(Math.min(1, 0.45 + match.score * 0.35 + (graphJoin ? 0.15 : 0) + confidence * 0.05)) : 0;
      const reasons = [
        ...match.reasons,
        ...(graphJoin ? ["matches configured contract evidence"] : []),
        ...(searchResult && searchResult.matchedTokens.length > 0 ? [`visual graph search matched: ${searchResult.matchedTokens.slice(0, 8).join(", ")}`] : [])
      ];
      return { node, score, reasons: [...new Set(reasons)].slice(0, 32) };
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || stableTextCompare(left.node.id, right.node.id));
}

function matchEvidence(issueText: string, issueTokens: string[], facts: string[]): { score: number; reasons: string[] } {
  const issueLower = issueText.toLowerCase();
  const normalizedFacts = facts.map(normalizeFact).filter(Boolean);
  const exact = normalizedFacts
    .filter((fact) => fact.length >= 3 && issueLower.includes(fact))
    .sort((left, right) => right.length - left.length || stableTextCompare(left, right));
  const factTokens = new Set(normalizedFacts.flatMap(tokens));
  const matchedTokens = issueTokens.filter((token) => factTokens.has(token));
  const uniqueMatches = [...new Set(matchedTokens)].sort(stableTextCompare);
  const strongSingleToken = uniqueMatches.some((token) => token.length >= 7);
  if (exact.length === 0 && uniqueMatches.length < 2 && !strongSingleToken) return { score: 0, reasons: [] };
  const score = roundScore(Math.min(1, (exact.length > 0 ? 0.65 : 0.35) + Math.min(0.3, uniqueMatches.length * 0.08)));
  return {
    score,
    reasons: [
      ...(exact[0] ? [`exact observed fact: ${exact[0].slice(0, 256)}`] : []),
      ...(uniqueMatches.length > 0 ? [`issue tokens: ${uniqueMatches.slice(0, 12).join(", ")}`] : [])
    ]
  };
}

function buildProfiles(
  config: VisualHiveConfig,
  contracts: RankedContract[],
  validationCommands: Readonly<Record<string, string>>,
  resolutionCodes: Set<string>
): { profiles: VisualHiveTaskContextInput["profiles"] } {
  const grouped = new Map<string, RankedContract[]>();
  for (const contract of contracts) grouped.set(contract.contract.target, [...(grouped.get(contract.contract.target) ?? []), contract]);
  const profiles: VisualHiveTaskContextInput["profiles"] = [];
  for (const [targetId, ranked] of [...grouped.entries()].sort(([left], [right]) => stableTextCompare(left, right))) {
    if (profiles.length >= 64) {
      resolutionCodes.add("profile_limit_reached");
      break;
    }
    const captureContracts = ranked.filter(({ contract }) => exactScreenshotBindings(config, contract).length > 0);
    if (captureContracts.length !== ranked.length) resolutionCodes.add("matched_contract_without_supported_screenshot_capture");
    if (captureContracts.length === 0) continue;
    if (!config.targets[targetId]) {
      resolutionCodes.add("matched_contract_without_configured_target");
      continue;
    }
    const commandId = validationCommands[targetId];
    if (!commandId) {
      resolutionCodes.add("matched_contract_without_registered_validation_command");
      continue;
    }
    if (!BoundedIdSchema.safeParse(targetId).success || !BoundedIdSchema.safeParse(commandId).success) {
      resolutionCodes.add("invalid_registered_validation_identity");
      continue;
    }
    const allValidContracts = captureContracts.filter(({ contract }) => BoundedIdSchema.safeParse(contract.id).success);
    const validContracts = allValidContracts.slice(0, 256);
    if (allValidContracts.length !== captureContracts.length) resolutionCodes.add("invalid_contract_id_omitted");
    if (allValidContracts.length > validContracts.length) resolutionCodes.add("profile_contract_limit_reached");
    if (validContracts.length === 0) continue;
    const bindings = validContracts.flatMap(({ contract }) => exactScreenshotBindings(config, contract));
    const viewportIds = [...new Set(bindings.map((binding) => binding.viewportId))].sort(stableTextCompare);
    const configuredViewportIds = viewportIds.slice(0, 32);
    if (viewportIds.length > configuredViewportIds.length) resolutionCodes.add("profile_viewport_limit_reached");
    const viewports = configuredViewportIds
      .filter((viewportId) => BoundedIdSchema.safeParse(viewportId).success && config.viewports[viewportId] !== undefined)
      .map((viewportId) => ({ viewportId, ...config.viewports[viewportId]!, deviceScaleFactor: 1 }));
    if (viewports.length === 0) {
      resolutionCodes.add("matched_contract_without_valid_viewport");
      continue;
    }
    const allRoutes = [...new Set(bindings.map((binding) => binding.route))].sort(stableTextCompare);
    if (allRoutes.length > 128) resolutionCodes.add("profile_route_limit_reached");
    const profileWithoutDigest = {
      profileId: boundedDerivedId("repair-profile", targetId),
      targetId,
      requestKinds: ["reproduction", "capture", "patch_validation"] as VisualHiveTaskContextInput["profiles"][number]["requestKinds"],
      contractIds: validContracts.map(({ contract }) => contract.id).sort(stableTextCompare),
      routes: allRoutes.slice(0, 128),
      scenarioIds: ["default"],
      viewports,
      validationCommandId: commandId
    };
    profiles.push({ ...profileWithoutDigest, profileDigest: computeVisualValidationProfileDigest(profileWithoutDigest) });
  }
  return { profiles };
}

function buildObligations(
  contracts: RankedContract[],
  profiles: VisualHiveTaskContextInput["profiles"],
  assets: VisualTaskAsset[],
  bounds: VisualTaskContextCompilerBounds,
  resolutionCodes: Set<string>
): VisualHiveTaskContextInput["obligations"] {
  const profileByContract = new Map(profiles.flatMap((profile) => profile.contractIds.map((contractId) => [contractId, profile] as const)));
  const obligations: VisualHiveTaskContextInput["obligations"] = [];
  const contractBudget = bounds.maxObligations - (assets.length > 0 ? 1 : 0);
  for (const ranked of contracts) {
    if (obligations.length >= contractBudget) {
      resolutionCodes.add("obligation_limit_reached");
      break;
    }
    const profile = profileByContract.get(ranked.contract.id);
    const bindings = profile ? exactScreenshotBindingsFromProfile(ranked.contract, profile) : [];
    if (profile && bindings.length > 0) {
      for (const binding of bindings) {
        if (obligations.length >= contractBudget) {
          resolutionCodes.add("obligation_limit_reached");
          break;
        }
        obligations.push({
          obligationId: boundedDerivedId("screenshot-obligation", `${ranked.contract.id}\0${binding.screenshotName}\0${binding.route}\0${binding.viewportId}\0default`),
          description: `Configured screenshot ${binding.screenshotName} for contract ${ranked.contract.id}: ${ranked.contract.description}`,
          sourceAssetIds: [],
          mappedContractIds: [ranked.contract.id],
          route: binding.route,
          state: "default",
          viewportId: binding.viewportId,
          assertionKind: "pixel_region",
          authority: "deterministic",
          confidence: ranked.score,
          status: "mapped"
        });
      }
      continue;
    }
    const routes = contractRoutes(ranked.contract);
    obligations.push({
      obligationId: boundedDerivedId("configured-obligation", ranked.contract.id),
      description: `Configured contract ${ranked.contract.id}: ${ranked.contract.description}`,
      sourceAssetIds: [],
      mappedContractIds: [],
      ...(routes[0] ? { route: routes[0] } : {}),
      state: "default",
      assertionKind: assertionKind(ranked.contract),
      authority: "advisory",
      confidence: ranked.score,
      status: "unresolved",
      unresolvedReason: ranked.contract.screenshots.length > 0
        ? "The configured screenshot contract lacks an executable registered profile with an exact route and viewport."
        : "This assertion kind remains advisory until deterministic generalized assertion capture is available."
    });
  }
  if (assets.length > 0) {
    obligations.push({
      obligationId: boundedDerivedId("unresolved-visual-assets", assets.map((asset) => asset.assetId).sort(stableTextCompare).join("\0")),
      description: "Issue-provided visual assets require an explicit evidence-to-contract mapping before they can become deterministic obligations.",
      sourceAssetIds: assets.map((asset) => asset.assetId).sort(stableTextCompare),
      mappedContractIds: [],
      assertionKind: "visual_relation",
      authority: "advisory",
      confidence: 0,
      status: "unresolved",
      unresolvedReason: "The compiler does not infer that an issue image is authoritative evidence for every configured contract."
    });
    resolutionCodes.add("visual_assets_require_explicit_obligation_mapping");
  }
  if (obligations.length === 0) {
    obligations.push({
      obligationId: boundedDerivedId("unresolved-obligation", "issue"),
      description: "No configured visual contract was deterministically matched to the issue evidence.",
      sourceAssetIds: [],
      mappedContractIds: [],
      assertionKind: "visual_relation",
      authority: "advisory",
      confidence: 0,
      status: "unresolved",
      unresolvedReason: "Repository evidence did not support a deterministic contract mapping."
    });
  }
  return obligations;
}

async function verifyAssets(rootReal: string, assets: VisualTaskAsset[]): Promise<VisualTaskAsset[]> {
  const verified: VisualTaskAsset[] = [];
  for (const asset of assets) {
    const relativePath = permittedRelativePath(asset.path);
    const file = await readContainedRegularFile(rootReal, relativePath);
    if (file.bytes.byteLength !== asset.size) throw new Error(`Visual Hive task asset size mismatch for ${asset.assetId}.`);
    const digest = sha256Bytes(file.bytes);
    if (digest !== asset.sha256) throw new Error(`Visual Hive task asset digest mismatch for ${asset.assetId}.`);
    verified.push(asset);
  }
  return verified;
}

async function loadSourceFile(
  rootReal: string,
  candidatePath: string,
  bounds: VisualTaskContextCompilerBounds,
  state: { files: Map<string, SourceFile>; selectedBytes: number; omittedPaths: number; truncated: boolean }
): Promise<SourceFile | undefined> {
  let relativePath: string;
  try {
    relativePath = permittedRelativePath(candidatePath);
  } catch {
    state.omittedPaths += 1;
    return undefined;
  }
  const existing = state.files.get(relativePath);
  if (existing) return existing;
  if (state.files.size >= bounds.maxSourceFiles) {
    state.omittedPaths += 1;
    state.truncated = true;
    return undefined;
  }
  try {
    const file = await readContainedRegularFile(rootReal, relativePath);
    if (file.bytes.byteLength > bounds.maxSourceFileBytes || state.selectedBytes + file.bytes.byteLength > bounds.maxSourceBytes) {
      state.omittedPaths += 1;
      state.truncated = true;
      return undefined;
    }
    const text = Buffer.from(file.bytes).toString("utf8");
    if (text.includes("\0")) {
      state.omittedPaths += 1;
      return undefined;
    }
    const source = { path: relativePath, bytes: file.bytes, text, lines: text.split(/\r?\n/u) };
    state.files.set(relativePath, source);
    state.selectedBytes += file.bytes.byteLength;
    return source;
  } catch {
    state.omittedPaths += 1;
    return undefined;
  }
}

async function readContainedRegularFile(rootReal: string, relativePath: string): Promise<{ bytes: Uint8Array }> {
  const absolute = path.resolve(rootReal, ...relativePath.split("/"));
  const targetReal = await realpath(absolute);
  if (!isContained(rootReal, targetReal)) throw new Error("Visual Hive task-context compiler path resolves outside repoRoot.");
  const metadata = await stat(targetReal);
  if (!metadata.isFile()) throw new Error("Visual Hive task-context compiler path is not a regular file.");
  return { bytes: await readFile(targetReal) };
}

function permittedRelativePath(value: string): string {
  if (value.includes("\\")) throw new Error("Visual Hive task-context compiler requires canonical repository-relative paths.");
  const normalized = value;
  RelativeArtifactPathSchema.parse(normalized);
  assertPermittedVisualTaskPath(normalized);
  const segments = normalized.toLowerCase().split("/");
  if (segments.some((segment) => ["answer", "answers", "grader", "graders", "solution", "solutions"].includes(segment))) {
    throw new Error("Visual Hive task-context compiler prohibits answer and grader paths.");
  }
  return normalized;
}

function isContained(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function sourcePathsFor(node: VisualGraphNode, repoMap: RepoMapReport): string[] {
  const paths = new Set<string>();
  if (node.sourceSpan?.filePath) paths.add(node.sourceSpan.filePath);
  const metadataSource = node.metadata?.sourceFile;
  if (typeof metadataSource === "string") paths.add(metadataSource);
  for (const repoNode of repoMap.visualMap.nodes) {
    if (repoNode.id === node.id) {
      for (const sourceFile of repoNode.sourceFiles) paths.add(sourceFile);
      if (repoNode.provenance.sourceFile) paths.add(repoNode.provenance.sourceFile);
    }
  }
  if (node.kind === "route") {
    for (const route of repoMap.routes) if (nodeFacts(node).some((fact) => normalizeFact(fact) === normalizeFact(route.route))) paths.add(route.sourceFile);
  }
  if (node.kind === "selector") {
    for (const selector of repoMap.selectors) if (nodeFacts(node).some((fact) => normalizeFact(fact) === normalizeFact(selector.selector))) paths.add(selector.sourceFile);
  }
  return [...paths].sort(stableTextCompare);
}

function exactSpanFor(node: VisualGraphNode, source: SourceFile): VisualHiveTaskContextInput["graphCandidates"][number]["sourceSpans"][number] | undefined {
  if (node.sourceSpan?.filePath && normalizePath(node.sourceSpan.filePath) === source.path && node.sourceSpan.startLine && node.sourceSpan.endLine) {
    if (validProvidedSpan(node.sourceSpan, source.lines)) {
      return {
        path: source.path,
        startLine: node.sourceSpan.startLine,
        endLine: node.sourceSpan.endLine,
        ...(node.sourceSpan.startColumn ? { startColumn: node.sourceSpan.startColumn } : {}),
        ...(node.sourceSpan.endColumn ? { endColumn: node.sourceSpan.endColumn } : {})
      };
    }
  }
  const facts = nodeFacts(node).filter((value) => value.length >= 2 && !value.includes("\n"));
  const needles = uniqueStrings([
    ...facts,
    ...facts.flatMap((value) => value.match(/[A-Za-z0-9][A-Za-z0-9._:@+~-]{3,}/gu) ?? [])
  ])
    .sort((left, right) => right.length - left.length || stableTextCompare(left, right));
  for (const needle of needles) {
    const lineIndex = source.lines.findIndex((line) => line.includes(needle) || line.toLowerCase().includes(needle.toLowerCase()));
    if (lineIndex >= 0) {
      const start = Math.max(0, source.lines[lineIndex]!.toLowerCase().indexOf(needle.toLowerCase()));
      return { path: source.path, startLine: lineIndex + 1, endLine: lineIndex + 1, startColumn: start + 1, endColumn: start + Math.max(1, needle.length) + 1 };
    }
  }
  if (node.kind === "file" && source.lines.length > 0) return { path: source.path, startLine: 1, endLine: 1 };
  return undefined;
}

function validProvidedSpan(span: NonNullable<VisualGraphNode["sourceSpan"]>, lines: string[]): boolean {
  if (!span.startLine || !span.endLine || span.startLine < 1 || span.endLine < span.startLine || span.endLine > lines.length) return false;
  const startLineLength = lines[span.startLine - 1]!.length;
  const endLineLength = lines[span.endLine - 1]!.length;
  if (span.startColumn !== undefined && (span.startColumn < 1 || span.startColumn > startLineLength + 1)) return false;
  if (span.endColumn !== undefined && (span.endColumn < 1 || span.endColumn > endLineLength + 1)) return false;
  if (span.startLine === span.endLine && span.startColumn !== undefined && span.endColumn !== undefined && span.endColumn < span.startColumn) return false;
  return true;
}

function nodeFacts(node: VisualGraphNode): string[] {
  return uniqueStrings([
    node.id,
    node.label,
    ...stringValues(node.metadata?.routes),
    ...stringValues(node.metadata?.selectors),
    ...stringValues(node.metadata?.contractIds),
    ...stringValues(node.metadata?.screenshotNames),
    ...stringValues(node.metadata?.mutationOperators),
    typeof node.metadata?.route === "string" ? node.metadata.route : "",
    typeof node.metadata?.selector === "string" ? node.metadata.selector : "",
    typeof node.metadata?.contractId === "string" ? node.metadata.contractId : ""
  ]);
}

function contractFacts(contract: ContractConfig): string[] {
  return uniqueStrings([
    contract.id,
    contract.description,
    ...contractRoutes(contract),
    ...contract.waitFor.map((wait) => wait.selector),
    ...contract.steps.flatMap((step) => [step.description ?? "", step.selector ?? "", step.route ?? "", step.text ?? ""]),
    ...contract.selectors.mustExist,
    ...contract.selectors.mustNotExist,
    ...contract.selectors.textMustExist,
    ...contract.selectors.textMustNotExist,
    ...contract.screenshots.flatMap((screenshot) => [screenshot.name, screenshot.route, ...screenshot.mask])
  ]);
}

function contractRoutes(contract: ContractConfig): string[] {
  return uniqueStrings([
    ...contract.screenshots.map((screenshot) => screenshot.route),
    ...contract.steps.filter((step) => step.action === "goto").map((step) => step.route ?? "")
  ]).sort(stableTextCompare);
}

function exactScreenshotBindings(config: VisualHiveConfig, contract: ContractConfig): ScreenshotBinding[] {
  return uniqueScreenshotBindings(contract.screenshots
    .filter((screenshot) => screenshot.route.trim().length > 0 && BoundedIdSchema.safeParse(screenshot.viewport).success && config.viewports[screenshot.viewport] !== undefined)
    .map((screenshot) => ({ screenshotName: screenshot.name, route: screenshot.route, viewportId: screenshot.viewport })));
}

function exactScreenshotBindingsFromProfile(contract: ContractConfig, profile: VisualHiveTaskContextInput["profiles"][number]): ScreenshotBinding[] {
  if (!profile.scenarioIds.includes("default")) return [];
  const routes = new Set(profile.routes);
  const viewports = new Set(profile.viewports.map((viewport) => viewport.viewportId));
  return uniqueScreenshotBindings(contract.screenshots
    .filter((screenshot) => routes.has(screenshot.route) && viewports.has(screenshot.viewport))
    .map((screenshot) => ({ screenshotName: screenshot.name, route: screenshot.route, viewportId: screenshot.viewport })));
}

function uniqueScreenshotBindings(bindings: ScreenshotBinding[]): ScreenshotBinding[] {
  const seen = new Set<string>();
  return bindings
    .sort((left, right) => stableTextCompare(`${left.route}\0${left.viewportId}\0${left.screenshotName}`, `${right.route}\0${right.viewportId}\0${right.screenshotName}`))
    .filter((binding) => {
      const key = `${binding.route}\0${binding.viewportId}\0${binding.screenshotName}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function assertionKind(contract: ContractConfig): VisualHiveTaskContextInput["obligations"][number]["assertionKind"] {
  if (contract.screenshots.length > 0) return "pixel_region";
  if (contract.selectors.textMustExist.length > 0 || contract.selectors.textMustNotExist.length > 0 || contract.steps.some((step) => step.action === "assertText")) return "text";
  if (contract.steps.some((step) => ["click", "fill", "press", "assertUrl"].includes(step.action))) return "behavior";
  if (contract.selectors.mustExist.length > 0 || contract.selectors.mustNotExist.length > 0 || contract.waitFor.length > 0) return "dom";
  return "visual_relation";
}

function classifySource(value: string): "source" | "test" | "config" | "documentation" {
  const normalized = value.toLowerCase();
  if (/(^|\/)(?:test|tests|__tests__|specs?)(\/|$)|\.(?:test|spec)\.[^.]+$/u.test(normalized)) return "test";
  if (/(^|\/)(?:readme|docs?)(?:\/|\.|$)|\.(?:md|mdx|rst)$/u.test(normalized)) return "documentation";
  if (/(^|\/)(?:package(?:-lock)?\.json|tsconfig[^/]*\.json|visual-hive\.(?:ya?ml|json)|[^/]+\.config\.[^/]+)$/u.test(normalized)) return "config";
  return "source";
}

function stringValues(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function uniqueSpans(spans: VisualHiveTaskContextInput["graphCandidates"][number]["sourceSpans"]): VisualHiveTaskContextInput["graphCandidates"][number]["sourceSpans"] {
  const seen = new Set<string>();
  return spans.filter((span) => {
    const key = canonicalSha256(span);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function tokens(value: string): string[] {
  return uniqueStrings(value
    .replace(/([a-z])([A-Z])/gu, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/gu)
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token)));
}

function normalizeFact(value: string): string {
  return value.trim().toLowerCase();
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/");
}

function boundedDerivedId(prefix: string, value: string): string {
  const readable = value.replace(/[^A-Za-z0-9._:@+~-]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 80) || "item";
  return `${prefix}.${readable}.${canonicalSha256(value).slice(0, 12)}`;
}

function roundScore(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
