import type { EvidenceContribution, EvidencePacket } from "../evidence/types.js";
import type { HandoffPacket, HandoffWorkItem } from "../handoff/types.js";
import type { VisualHiveConfig } from "../config/schema.js";

export type HiveLegacyMode = "dry_run" | "github_issue" | "bead_api";
export type HiveAutomationMode = "advisory" | "measured" | "repair_request" | "guarded_repair" | "full";
export type HiveConfiguredMode = HiveAutomationMode | HiveLegacyMode;
export type HiveExportStatus = "ready" | "blocked";
export type HiveBeadStatus = "open" | "in_progress" | "blocked" | "done" | "closed";
export type HiveBeadType = "bug" | "feature" | "task" | "epic" | "chore" | "decision" | "advisory";
export type HiveBeadActor = "quality" | "ci-maintainer" | "sec-check" | "scanner" | "architect" | "guide" | string;
export type HiveKnowledgeFactType = "pattern" | "gotcha" | "decision" | "regression" | "test_scaffold" | "integration" | "coverage_rule";
export type HiveGraphPredicate = "related_to" | "supersedes" | "depends_on" | "derived_from" | "shared_tag";

export interface HiveExportConfig {
  enabled: boolean;
  mode: HiveConfiguredMode;
  acmmLevel: number;
  defaultActor: string;
  labels: string[];
  export: {
    beads: boolean;
    knowledgeFacts: boolean;
    knowledgeGraph: boolean;
    wikiVault: boolean;
    repairWorkOrders: boolean;
    maxFacts: number;
  };
  repair: {
    enabled: boolean;
    prOnly: boolean;
    maxAttempts: number;
    requireHumanReview: boolean;
    rerunVisualHive: boolean;
    branchPrefix: string;
  };
}

export interface HiveBead {
  id: string;
  title: string;
  type: HiveBeadType;
  status: HiveBeadStatus;
  priority: number;
  actor: HiveBeadActor;
  external_ref: string;
  metadata: Record<string, string>;
  notes: string;
  created_at: string;
  updated_at: string;
  closed_at?: string;
  depends_on: string[];
}

export interface HiveKnowledgeFact {
  slug: string;
  title: string;
  type: HiveKnowledgeFactType;
  layer: "project";
  confidence: number;
  tags: string[];
  source: string;
  body: string;
  relatedEvidenceKeys: string[];
  artifacts: string[];
}

export interface HiveGraphNode {
  id: string;
  slug: string;
  title: string;
  type: string;
  layer?: string;
  confidence?: number;
  tags: string[];
  artifactPath?: string;
}

export interface HiveGraphEdge {
  from: string;
  to: string;
  predicate: HiveGraphPredicate;
}

export interface HiveKnowledgeGraph {
  schemaVersion: "visual-hive.hive-knowledge-graph.v1";
  nodes: HiveGraphNode[];
  edges: HiveGraphEdge[];
}

export interface HiveRepairWorkOrder {
  id: string;
  actor: HiveBeadActor;
  title: string;
  objective: string;
  sourceBeadIds: string[];
  evidenceKeys: string[];
  likelyFiles: string[];
  artifacts: string[];
  reproductionCommands: string[];
  acceptanceCriteria: string[];
  allowedActions: string[];
  forbiddenActions: string[];
  maxAttempts: number;
  branchPrefix: string;
  prOnly: boolean;
  requireHumanReview: boolean;
  rerunVisualHive: boolean;
}

export interface HiveAgentPolicy {
  schemaVersion: "visual-hive.hive-agent-policy.v1";
  mode: HiveAutomationMode;
  acmmLevel: number;
  enabled: boolean;
  externalCallsMade: 0;
  verdictAuthority: "visual_hive";
  hiveAuthority: "advisory_or_guarded_repair";
  repair: HiveExportConfig["repair"];
  allowedActions: string[];
  forbiddenActions: string[];
  trustedWorkflowRequiredFor: string[];
  finalValidation: {
    required: true;
    command: string;
    passFailOwnedBy: "visual_hive_verdict_engine";
  };
}

export interface HiveExportBundle {
  schemaVersion: "visual-hive.hive-export.v1";
  generatedAt: string;
  project: string;
  status: HiveExportStatus;
  externalCallsMade: 0;
  mode: HiveAutomationMode;
  configuredMode: HiveConfiguredMode;
  acmmLevel: number;
  sourceArtifacts: {
    evidencePacket: string;
    handoffPacket?: string;
  };
  outputArtifacts: {
    export: string;
    beads: string;
    knowledgeFacts: string;
    knowledgeGraph: string;
    issueContext: string;
    repairWorkOrders: string;
    agentPolicy: string;
    wikiVaultDir: string;
  };
  governance: {
    verdictAuthority: "visual_hive";
    defaultMode: "advisory_no_network";
    repairAuthority: "hive_may_open_pr_only_when_trusted_policy_allows";
    validationRequired: "visual_hive_must_rerun_after_repair";
    secretPolicy: "redacted_values_names_only";
  };
  summary: {
    beads: number;
    knowledgeFacts: number;
    graphNodes: number;
    graphEdges: number;
    repairWorkOrders: number;
    blockedReasons: number;
  };
  labels: string[];
  beads: HiveBead[];
  knowledgeFacts: HiveKnowledgeFact[];
  knowledgeGraph: HiveKnowledgeGraph;
  repairWorkOrders: HiveRepairWorkOrder[];
  agentPolicy: HiveAgentPolicy;
  blockedReasons: string[];
}

export interface HiveExportArtifacts {
  bundle: HiveExportBundle;
  issueContext: string;
  wikiPages: Array<{ slug: string; path: string; content: string }>;
}

export interface BuildHiveExportOptions {
  evidencePacket: EvidencePacket;
  evidencePacketPath: string;
  handoffPacket?: HandoffPacket;
  handoffPacketPath?: string;
  outputDir?: string;
  hiveConfig?: Partial<VisualHiveConfig["integrations"]["hive"]>;
  now?: Date;
}

export interface WriteHiveExportOptions extends BuildHiveExportOptions {
  rootDir: string;
}

export interface WriteHiveExportResult extends HiveExportArtifacts {
  paths: HiveExportBundle["outputArtifacts"];
}

export interface HiveSourceContext {
  evidence: EvidencePacket;
  handoff?: HandoffPacket;
  config: HiveExportConfig;
  mode: HiveAutomationMode;
  generatedAt: string;
}

export interface HiveWorkSource {
  workItem: HandoffWorkItem;
  contributions: EvidenceContribution[];
}
