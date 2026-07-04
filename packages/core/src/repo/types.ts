export type RepoPackageManager = "npm" | "pnpm" | "yarn" | "unknown";

export interface RepoScriptInfo {
  packagePath: string;
  name: string;
  command: string;
}

export interface RepoPackageInfo {
  path: string;
  name?: string;
  private?: boolean;
  workspaces: string[];
  scripts: RepoScriptInfo[];
  dependencyNames: string[];
}

export interface RepoSelectorHint {
  selector: string;
  sourceFile: string;
  occurrences: number;
}

export interface RepoRouteHint {
  route: string;
  sourceFile: string;
  occurrences: number;
}

export interface RepoWorkflowHint {
  path: string;
  triggers: string[];
  permissions: string[];
  usesPullRequestTarget: boolean;
  usesSecrets: boolean;
  uploadsArtifacts: boolean;
  visualHiveRelated: boolean;
}

export interface RepoTargetHint {
  id: string;
  kind: "command" | "commandGroup" | "storybook" | "deployPreview" | "url";
  confidence: "high" | "medium" | "low";
  command?: string;
  url?: string;
  evidence: string[];
}

export interface RepoRiskSignal {
  id: string;
  severity: "info" | "warning" | "high";
  message: string;
  evidence: string[];
  recommendation: string;
}

export interface RepoCoverageGap {
  id: string;
  layer: number;
  severity: "low" | "medium" | "high";
  message: string;
  suggestedArtifact: string;
}

export type RepoVisualMapNodeKind =
  | "file"
  | "component"
  | "layout"
  | "route"
  | "state"
  | "viewport"
  | "target"
  | "contract"
  | "screenshot"
  | "mutation"
  | "selector"
  | "coverage_gap";

export type RepoVisualMapNodeStatus = "active" | "stale" | "unverified" | "conflicted";

export interface RepoVisualMapProvenance {
  source: "static" | "config" | "runtime" | "derived";
  confidence: "high" | "medium" | "low";
  sourceFile?: string;
  generatedAt: string;
  firstSeen: string;
  lastValidated?: string;
}

export interface RepoVisualMapNode {
  id: string;
  kind: RepoVisualMapNodeKind;
  label: string;
  status: RepoVisualMapNodeStatus;
  provenance: RepoVisualMapProvenance;
  sourceFiles: string[];
  routes: string[];
  states: string[];
  viewports: string[];
  selectors: string[];
  targetIds: string[];
  contractIds: string[];
  screenshotNames: string[];
  mutationOperators: string[];
  coverageGapIds: string[];
}

export interface RepoVisualMapEdge {
  id: string;
  from: string;
  to: string;
  relation:
    | "declares"
    | "renders"
    | "uses_selector"
    | "targets"
    | "covers_route"
    | "captures"
    | "uses_viewport"
    | "maps_mutation"
    | "has_gap"
    | "impacts"
    | "validated_by";
  evidence: string[];
  confidence: "high" | "medium" | "low";
}

export interface RepoVisualMapFinding {
  id: string;
  fingerprint: string;
  status: RepoVisualMapNodeStatus;
  severity: "info" | "warning" | "high";
  message: string;
  nodeIds: string[];
  evidence: string[];
}

export interface RepoVisualMap {
  schemaVersion: 1;
  generatedAt: string;
  summary: {
    nodes: number;
    edges: number;
    routes: number;
    components: number;
    contracts: number;
    screenshots: number;
    mutations: number;
    activeFindings: number;
  };
  lifecycle: "File -> Component -> Layout -> Route -> State -> Viewport -> Target -> Contract -> Screenshot -> Mutation -> Issue";
  nodes: RepoVisualMapNode[];
  edges: RepoVisualMapEdge[];
  findings: RepoVisualMapFinding[];
}

export interface RepoMapOutputResource {
  artifactPath: string;
  evidenceResourceId: string;
  evidenceResourceUri: string;
  evidenceResourceTitle: string;
  evidenceResourceDescription: string;
  evidenceReadToolName?: string;
}

export interface RepoMapReport {
  schemaVersion: 1;
  generatedAt: string;
  repoRoot: string;
  outputResource?: RepoMapOutputResource;
  project: {
    name: string;
    packageManager: RepoPackageManager;
    workspaces: string[];
    frameworks: string[];
  };
  packages: RepoPackageInfo[];
  scripts: RepoScriptInfo[];
  sourceSummary: {
    scannedFiles: number;
    truncated: boolean;
    extensions: Record<string, number>;
  };
  selectors: RepoSelectorHint[];
  routes: RepoRouteHint[];
  workflows: RepoWorkflowHint[];
  testTools: string[];
  targetHints: RepoTargetHint[];
  riskSignals: RepoRiskSignal[];
  coverageGaps: RepoCoverageGap[];
  visualMap: RepoVisualMap;
  recommendations: string[];
}
