export type VisualGraphNodeKind =
  | "file"
  | "package"
  | "component"
  | "layout"
  | "route"
  | "state"
  | "viewport"
  | "selector"
  | "target"
  | "contract"
  | "screenshot"
  | "baseline"
  | "mutation_operator"
  | "workflow"
  | "artifact"
  | "issue_candidate"
  | "agent_profile"
  | "hive_resource"
  | "coverage_gap";

export type VisualGraphEdgeRelation =
  | "declares"
  | "imports"
  | "renders"
  | "uses_selector"
  | "covers_route"
  | "captures"
  | "uses_viewport"
  | "targets"
  | "mutates"
  | "killed_by"
  | "survived_by"
  | "produces_artifact"
  | "backs_issue"
  | "assigned_to_agent"
  | "validates"
  | "stale_due_to"
  | "resolved_candidate_for"
  | "has_gap"
  | "impacts";

export type VisualGraphProvenance =
  | "static"
  | "config"
  | "runtime_dom"
  | "playwright_report"
  | "screenshot"
  | "mutation_report"
  | "workflow"
  | "manual_suppression"
  | "agent_suggested"
  | "derived";

export type VisualGraphStatus = "active" | "stale" | "unresolved" | "resolved_candidate" | "conflicted" | "suppressed";

export interface VisualGraphSourceSpan {
  filePath: string;
  startLine?: number;
  endLine?: number;
  startColumn?: number;
  endColumn?: number;
}

export interface VisualGraphNode {
  id: string;
  kind: VisualGraphNodeKind;
  label: string;
  sourceSpan?: VisualGraphSourceSpan;
  provenance: VisualGraphProvenance;
  confidence: number;
  firstSeen: string;
  lastSeen: string;
  lastValidated?: string;
  status: VisualGraphStatus;
  evidenceArtifacts: string[];
  metadata?: Record<string, unknown>;
}

export interface VisualGraphEdge {
  id: string;
  from: string;
  to: string;
  relation: VisualGraphEdgeRelation;
  sourceSpan?: VisualGraphSourceSpan;
  provenance: VisualGraphProvenance;
  confidence: number;
  firstSeen: string;
  lastSeen: string;
  metadata?: Record<string, unknown>;
  evidenceArtifacts: string[];
}

export type VisualGraphReferenceKind =
  | "component_to_route"
  | "selector_to_component"
  | "contract_to_route"
  | "screenshot_to_component"
  | "mutation_to_contract"
  | "workflow_to_command"
  | "issue_to_artifact"
  | "artifact_to_graph_node";

export type VisualGraphResolutionStrategy = "static_extract" | "config_extract" | "runtime_dom_observation" | "report_evidence" | "manual_review";
export type VisualGraphResolvedBy =
  | "exact_id"
  | "config"
  | "source_span"
  | "route_match"
  | "selector_match"
  | "runtime_dom"
  | "screenshot_metadata"
  | "mutation_mapping"
  | "workflow_audit"
  | "fuzzy";

export interface VisualGraphReferenceCandidate {
  nodeId: string;
  label: string;
  confidence: number;
  reason: string;
}

export interface VisualGraphUnresolvedReference {
  id: string;
  fromNodeId: string;
  referenceName: string;
  referenceKind: VisualGraphReferenceKind;
  sourceSpan?: VisualGraphSourceSpan;
  candidates: VisualGraphReferenceCandidate[];
  confidence: number;
  blockedReason?: string;
  nextResolutionStrategy: VisualGraphResolutionStrategy;
}

export interface VisualGraphResolvedReference {
  id: string;
  fromNodeId: string;
  referenceName: string;
  referenceKind: VisualGraphReferenceKind;
  targetNodeId: string;
  confidence: number;
  resolvedBy: VisualGraphResolvedBy;
}

export interface VisualGraph {
  schemaVersion: "visual-hive.visual-graph.v1";
  generatedAt: string;
  project: string;
  summary: {
    nodes: number;
    edges: number;
    unresolvedReferences: number;
    resolvedReferences: number;
    completeChains: number;
    nodeKinds: Record<string, number>;
  };
  extractorArchitecture: {
    interface: "VisualHiveGraphExtractor";
    extractors: string[];
    notes: string[];
  };
  nodes: VisualGraphNode[];
  edges: VisualGraphEdge[];
  unresolvedReferences: VisualGraphUnresolvedReference[];
  resolvedReferences: VisualGraphResolvedReference[];
}

export interface VisualGraphVocabularyEntry {
  token: string;
  nodeIds: string[];
  kinds: VisualGraphNodeKind[];
  labels: string[];
}

export interface VisualGraphVocabulary {
  schemaVersion: "visual-hive.visual-graph-vocab.v1";
  generatedAt: string;
  project: string;
  entries: VisualGraphVocabularyEntry[];
}

export interface VisualGraphSearchResult {
  node: VisualGraphNode;
  score: number;
  matchedTokens: string[];
}

export interface VisualImpactReport {
  schemaVersion: "visual-hive.visual-impact.v1";
  generatedAt: string;
  project: string;
  query: {
    changedFiles: string[];
    issue?: string;
    contract?: string;
    mutation?: string;
    route?: string;
    text?: string;
  };
  affectedNodes: VisualGraphNode[];
  affectedEdges: VisualGraphEdge[];
  grouped: Record<string, string[]>;
  validationCommands: string[];
  issueContext: {
    issueNodeIds: string[];
    evidenceArtifacts: string[];
    suggestedAgentProfiles: string[];
  };
  summary: {
    affectedNodeCount: number;
    affectedRouteCount: number;
    affectedContractCount: number;
    affectedScreenshotCount: number;
    affectedMutationCount: number;
  };
}

export interface VisualHiveGraphExtractor {
  id: string;
  detect(context: { repoRoot: string; files: string[] }): boolean | Promise<boolean>;
  extractFile?(file: string, content: string): unknown | Promise<unknown>;
  resolve?(reference: VisualGraphUnresolvedReference, context: { graph: VisualGraph }): VisualGraphResolvedReference | undefined | Promise<VisualGraphResolvedReference | undefined>;
  postExtract?(context: { graph: VisualGraph }): VisualGraph | Promise<VisualGraph>;
}
