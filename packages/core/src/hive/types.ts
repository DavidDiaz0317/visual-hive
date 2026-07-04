import type { EvidenceContribution, EvidencePacket } from "../evidence/types.js";
import type { HandoffPacket, HandoffWorkItem } from "../handoff/types.js";
import type { VisualHiveConfig } from "../config/schema.js";

export type HiveLegacyMode = "dry_run" | "github_issue" | "bead_api";
export type HiveAutomationMode = "advisory" | "measured" | "repair_request" | "guarded_repair" | "full";
export type HiveConfiguredMode = HiveAutomationMode | HiveLegacyMode;
export type HiveExportStatus = "ready" | "blocked";
export type HiveGuardedRepairPreviewStatus = "ready" | "blocked";
export type HiveRepairRequestEnvelopeStatus = "ready" | "blocked";
export type HiveTrustedRepairConsumerSummaryStatus = "ready" | "blocked";
export type HiveTrustedRepairWorkflowDryRunStatus = "ready" | "blocked";
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

export interface HiveProviderEvidenceSummary {
  providerId: string;
  status: string;
  deterministicRole: string;
  uploadStatus?: string;
  externalCallsMade: number;
  stagedArtifacts?: number;
  uploadedArtifacts?: number;
  manifestPath?: string;
  uploadDirectory?: string;
  providerUrl?: string;
  blockedReasons: string[];
}

export type HiveExportOutputResourceKey = "export" | "beads" | "knowledgeFacts" | "knowledgeGraph" | "repairWorkOrders" | "agentPolicy";

export interface HiveCatalogedOutputResource {
  artifactKey: string;
  artifactPath: string;
  evidenceResourceId: string;
  evidenceResourceUri: string;
  evidenceResourceTitle: string;
  evidenceResourceDescription: string;
  evidenceReadToolName?: string;
}

export interface HiveExportOutputResource extends HiveCatalogedOutputResource {
  artifactKey: HiveExportOutputResourceKey;
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
  outputResources: HiveExportOutputResource[];
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
  providerEvidence: HiveProviderEvidenceSummary[];
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

export interface HiveModeComparisonEntry {
  mode: HiveAutomationMode;
  status: HiveExportStatus;
  outputDir: string;
  exportPath: string;
  externalCallsMade: 0;
  summary: HiveExportBundle["summary"];
  blockedReasons: string[];
  emits: {
    issueContext: boolean;
    beads: boolean;
    knowledgeFacts: boolean;
    knowledgeGraph: boolean;
    wikiVault: boolean;
    repairWorkOrders: boolean;
    agentPolicy: boolean;
  };
  policy: {
    localPreviewAllowed: boolean;
    trustedWorkflowRequired: boolean;
    verdictAuthority: "visual_hive";
    hiveAuthority: "advisory_or_guarded_repair";
  };
  recommendedUse: string;
}

export interface HiveModeComparison {
  schemaVersion: "visual-hive.hive-mode-comparison.v1";
  generatedAt: string;
  project: string;
  externalCallsMade: 0;
  sourceArtifacts: {
    evidencePacket: string;
    handoffPacket?: string;
  };
  outputArtifacts: {
    comparison: string;
    markdown: string;
    modesDir: string;
  };
  outputResource: HiveCatalogedOutputResource;
  modes: HiveModeComparisonEntry[];
  recommendation: {
    mode: HiveAutomationMode;
    reason: string;
    nextCommand: string;
  };
  governance: HiveExportBundle["governance"];
}

export interface HiveGuardedRepairPreviewWorkOrder {
  id: string;
  title: string;
  actor: HiveBeadActor;
  objective: string;
  branchName: string;
  maxAttempts: number;
  prOnly: boolean;
  requireHumanReview: boolean;
  rerunVisualHive: boolean;
  likelyFiles: string[];
  artifacts: string[];
  reproductionCommands: string[];
  acceptanceCriteria: string[];
  allowedActions: string[];
  forbiddenActions: string[];
  blockedReasons: string[];
}

export interface HiveGuardedRepairPreview {
  schemaVersion: "visual-hive.hive-guarded-repair-preview.v1";
  generatedAt: string;
  project: string;
  status: HiveGuardedRepairPreviewStatus;
  externalCallsMade: 0;
  sourceArtifacts: {
    hiveExport: string;
    repairWorkOrders: string;
    agentPolicy: string;
    evidencePacket?: string;
    handoffPacket?: string;
  };
  outputArtifacts: {
    preview: string;
    markdown: string;
  };
  outputResource: HiveCatalogedOutputResource;
  policy: {
    verdictAuthority: "visual_hive";
    repairExecution: "preview_only_no_execution";
    branchIsolationRequired: true;
    pullRequestOnly: boolean;
    humanReviewRequired: boolean;
    visualHiveRerunRequired: boolean;
    protectedTargetsFromPr: false;
    externalNetworkCalls: false;
    secretsPolicy: "names_only_values_redacted";
  };
  readiness: {
    canRequestGuardedRepair: boolean;
    blockedReasons: string[];
    requiredApprovals: string[];
    requiredCommands: string[];
  };
  summary: {
    repairWorkOrders: number;
    readyWorkOrders: number;
    blockedWorkOrders: number;
    allowedActions: number;
    forbiddenActions: number;
  };
  workOrders: HiveGuardedRepairPreviewWorkOrder[];
}

export interface BuildHiveGuardedRepairPreviewOptions {
  hiveExport: HiveExportBundle;
  hiveExportPath: string;
  outputDir?: string;
  now?: Date;
}

export interface WriteHiveGuardedRepairPreviewOptions extends BuildHiveGuardedRepairPreviewOptions {
  rootDir: string;
}

export interface WriteHiveGuardedRepairPreviewResult {
  preview: HiveGuardedRepairPreview;
  markdown: string;
  paths: HiveGuardedRepairPreview["outputArtifacts"];
}

export interface HiveRepairRequestEnvelopeItem {
  id: string;
  title: string;
  actor: HiveBeadActor;
  objective: string;
  branchName: string;
  allowedFiles: string[];
  artifacts: string[];
  reproductionCommands: string[];
  acceptanceCriteria: string[];
  allowedActions: string[];
  forbiddenActions: string[];
  maxAttempts: number;
  requireHumanReview: boolean;
  finalValidationCommand: string;
  blockedReasons: string[];
}

export interface HiveRepairRequestEnvelope {
  schemaVersion: "visual-hive.hive-repair-request-envelope.v1";
  generatedAt: string;
  project: string;
  status: HiveRepairRequestEnvelopeStatus;
  externalCallsMade: 0;
  sourceArtifacts: {
    guardedRepairPreview: string;
    hiveExport: string;
    repairWorkOrders: string;
    agentPolicy: string;
    evidencePacket?: string;
    handoffPacket?: string;
  };
  outputArtifacts: {
    envelope: string;
    markdown: string;
  };
  outputResource: HiveCatalogedOutputResource;
  policy: {
    verdictAuthority: "visual_hive";
    requestExecution: "trusted_workflow_request_only";
    repairExecution: "not_executed_by_visual_hive";
    requiresTrustedWorkflow: true;
    branchIsolationRequired: true;
    pullRequestOnly: boolean;
    humanReviewRequired: boolean;
    visualHiveRerunRequired: boolean;
    externalNetworkCalls: false;
    protectedTargetsFromPr: false;
    secretsPolicy: "names_only_values_redacted";
  };
  github: {
    branchPrefix: string;
    pullRequestTitlePrefix: string;
    labels: string[];
    dedupeKey: string;
  };
  readiness: {
    canOpenTrustedRepairRequest: boolean;
    blockedReasons: string[];
    requiredApprovals: string[];
    requiredCommands: string[];
  };
  summary: {
    repairRequests: number;
    readyRequests: number;
    blockedRequests: number;
  };
  requests: HiveRepairRequestEnvelopeItem[];
}

export interface BuildHiveRepairRequestEnvelopeOptions {
  guardedRepairPreview: HiveGuardedRepairPreview;
  guardedRepairPreviewPath: string;
  outputDir?: string;
  now?: Date;
}

export interface WriteHiveRepairRequestEnvelopeOptions extends BuildHiveRepairRequestEnvelopeOptions {
  rootDir: string;
}

export interface WriteHiveRepairRequestEnvelopeResult {
  envelope: HiveRepairRequestEnvelope;
  markdown: string;
  paths: HiveRepairRequestEnvelope["outputArtifacts"];
}

export interface HiveTrustedRepairConsumerSummaryItem {
  id: string;
  title: string;
  actor: HiveBeadActor;
  status: "ready" | "blocked";
  branchName: string;
  pullRequestTitle: string;
  labels: string[];
  allowedFiles: string[];
  artifacts: string[];
  reproductionCommands: string[];
  acceptanceCriteria: string[];
  finalValidationCommand: string;
  blockedReasons: string[];
}

export interface HiveTrustedRepairConsumerSummary {
  schemaVersion: "visual-hive.hive-trusted-repair-consumer-summary.v1";
  generatedAt: string;
  project: string;
  status: HiveTrustedRepairConsumerSummaryStatus;
  externalCallsMade: 0;
  sourceArtifacts: {
    repairRequestEnvelope: string;
    guardedRepairPreview: string;
    hiveExport: string;
    repairWorkOrders: string;
    agentPolicy: string;
    evidencePacket?: string;
    handoffPacket?: string;
  };
  outputArtifacts: {
    summary: string;
    markdown: string;
  };
  outputResource: HiveCatalogedOutputResource;
  policy: {
    verdictAuthority: "visual_hive";
    consumerExecution: "dry_run_summary_only";
    repairExecution: "not_executed_by_visual_hive";
    checkoutCode: false;
    branchCreation: false;
    pullRequestCreation: false;
    issueCreation: false;
    hiveNetworkCalls: false;
    providerCalls: false;
    visualHiveRerun: false;
    requiresTrustedWorkflow: true;
    secretsPolicy: "names_only_values_redacted";
  };
  readiness: {
    canStartTrustedRepairWorkflow: boolean;
    blockedReasons: string[];
    requiredApprovals: string[];
    requiredCommands: string[];
  };
  summary: {
    requestedRepairs: number;
    readyRepairs: number;
    blockedRepairs: number;
    branchesToCreate: number;
    pullRequestsToOpen: number;
    externalCallsMade: 0;
  };
  consumerActions: {
    wouldCheckoutCode: false;
    wouldExecuteRepair: false;
    wouldCreateBranches: false;
    wouldOpenPullRequests: false;
    wouldCreateIssues: false;
    wouldCallHiveApi: false;
    wouldCallProviders: false;
    wouldRunVisualHive: false;
  };
  items: HiveTrustedRepairConsumerSummaryItem[];
}

export interface BuildHiveTrustedRepairConsumerSummaryOptions {
  repairRequestEnvelope: HiveRepairRequestEnvelope;
  repairRequestEnvelopePath: string;
  outputDir?: string;
  now?: Date;
}

export interface WriteHiveTrustedRepairConsumerSummaryOptions extends BuildHiveTrustedRepairConsumerSummaryOptions {
  rootDir: string;
}

export interface WriteHiveTrustedRepairConsumerSummaryResult {
  summary: HiveTrustedRepairConsumerSummary;
  markdown: string;
  paths: HiveTrustedRepairConsumerSummary["outputArtifacts"];
}

export interface HiveTrustedRepairWorkflowDryRunAction {
  id: string;
  label: string;
  phase: "artifact_validation" | "branch_preparation" | "repair_execution" | "validation" | "pull_request";
  status: "planned" | "blocked";
  futureTrustedOnly: true;
  command?: string;
  blockedReasons: string[];
}

export interface HiveTrustedRepairWorkflowDryRunItem {
  id: string;
  title: string;
  actor: HiveBeadActor;
  status: "ready" | "blocked";
  branchName: string;
  pullRequestTitle: string;
  labels: string[];
  allowedFiles: string[];
  artifacts: string[];
  reproductionCommands: string[];
  acceptanceCriteria: string[];
  finalValidationCommand: string;
  plannedActions: HiveTrustedRepairWorkflowDryRunAction[];
  blockedReasons: string[];
}

export interface HiveTrustedRepairWorkflowDryRun {
  schemaVersion: "visual-hive.hive-trusted-repair-workflow-dry-run.v1";
  generatedAt: string;
  project: string;
  status: HiveTrustedRepairWorkflowDryRunStatus;
  externalCallsMade: 0;
  sourceArtifacts: {
    trustedRepairConsumerSummary: string;
    repairRequestEnvelope: string;
    guardedRepairPreview: string;
    hiveExport: string;
    repairWorkOrders: string;
    agentPolicy: string;
    evidencePacket?: string;
    handoffPacket?: string;
  };
  outputArtifacts: {
    dryRun: string;
    markdown: string;
  };
  outputResource: HiveCatalogedOutputResource;
  policy: {
    verdictAuthority: "visual_hive";
    workflowExecution: "dry_run_only";
    repairExecution: "not_executed_by_visual_hive";
    checkoutCode: false;
    branchCreation: false;
    pullRequestCreation: false;
    issueCreation: false;
    hiveNetworkCalls: false;
    providerCalls: false;
    visualHiveRerun: false;
    requiresTrustedWorkflow: true;
    secretsPolicy: "names_only_values_redacted";
  };
  readiness: {
    canRunTrustedRepairWorkflow: boolean;
    blockedReasons: string[];
    requiredApprovals: string[];
    requiredCommands: string[];
  };
  summary: {
    requestedRepairs: number;
    readyRepairs: number;
    blockedRepairs: number;
    plannedBranches: number;
    plannedPullRequests: number;
    plannedActions: number;
    blockedActions: number;
    externalCallsMade: 0;
  };
  currentActions: {
    checkedOutCode: false;
    createdBranches: false;
    openedPullRequests: false;
    createdIssues: false;
    calledHiveApi: false;
    calledProviders: false;
    ranVisualHive: false;
    executedRepair: false;
  };
  items: HiveTrustedRepairWorkflowDryRunItem[];
}

export interface BuildHiveTrustedRepairWorkflowDryRunOptions {
  trustedRepairConsumerSummary: HiveTrustedRepairConsumerSummary;
  trustedRepairConsumerSummaryPath: string;
  outputDir?: string;
  now?: Date;
}

export interface WriteHiveTrustedRepairWorkflowDryRunOptions extends BuildHiveTrustedRepairWorkflowDryRunOptions {
  rootDir: string;
}

export interface WriteHiveTrustedRepairWorkflowDryRunResult {
  dryRun: HiveTrustedRepairWorkflowDryRun;
  markdown: string;
  paths: HiveTrustedRepairWorkflowDryRun["outputArtifacts"];
}

export interface BuildHiveModeComparisonOptions extends Omit<BuildHiveExportOptions, "outputDir" | "hiveConfig"> {
  outputDir?: string;
  modes?: HiveAutomationMode[];
  hiveConfig?: Partial<VisualHiveConfig["integrations"]["hive"]>;
}

export interface WriteHiveModeComparisonOptions extends BuildHiveModeComparisonOptions {
  rootDir: string;
}

export interface WriteHiveModeComparisonResult {
  comparison: HiveModeComparison;
  exports: WriteHiveExportResult[];
  markdown: string;
  paths: HiveModeComparison["outputArtifacts"];
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
