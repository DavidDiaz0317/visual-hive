import type {
  ContractAuditReport,
  ContractConfig,
  CostAuditReport,
  CoverageImprovementReport,
  CoverageReport,
  FlowAuditReport,
  RepoConnectionIndex,
  LLMUsageReport,
  MutationReport,
  MockProviderRunReport,
  ProviderInspection,
  ProviderSetupPlan,
  Report,
  RiskRegisterReport,
  ReadinessReport,
  SecurityAuditReport,
  RunHistoryReport,
  ScheduleAuditReport,
  TargetAuditReport,
  TriageReport,
  TargetConfig,
  VisualHiveConfig,
  ArtifactIndexEntry,
  BaselineSummary,
  GitHubWorkflowTemplate,
  LLMDecisionLog,
  ProviderDecisionLog,
  SetupRecommendationReport,
  WorkflowAuditReport
} from "@visual-hive/core";

export interface ControlPlaneOptions {
  repo?: string;
  config?: string;
  port?: number;
  open?: boolean;
  readOnly?: boolean;
  demo?: boolean;
  cliPath?: string;
  commandRunner?: ControlPlaneCommandRunner;
}

export interface ResolvedControlPlaneOptions {
  repoRoot: string;
  configPath: string;
  configRoot: string;
  readOnly: boolean;
  demo: boolean;
  activeConnectionId?: string;
}

export interface ControlPlaneOverview {
  healthScore: number;
  healthGrade: "unknown" | "poor" | "fair" | "good" | "excellent";
  deterministicStatus: "missing" | "passed" | "failed";
  mutationScore?: number;
  failedContracts: number;
  createdBaselines: number;
  missingBaselines: number;
  visualDiffs: number;
  consoleErrors: number;
  pageErrors: number;
  nextActions: string[];
  explanations: string[];
}

export type ControlPlaneArtifact = ArtifactIndexEntry;

export interface ControlPlaneScreenshot {
  contractId: string;
  name: string;
  route: string;
  viewport: string;
  status: string;
  baselinePath: string;
  actualPath: string;
  diffPath?: string;
  maxDiffPixelRatio: number;
  actualDiffPixelRatio?: number;
  actualDiffPixels?: number;
  canApprove?: boolean;
  canReject?: boolean;
  approvedAt?: string;
  rejectedAt?: string;
  rejectionReason?: string;
}

export interface ControlPlaneFailure {
  contractId: string;
  targetId: string;
  status: string;
  classification: string;
  severity?: string;
  errorExcerpt: string;
  changedFiles?: string[];
  routes?: string[];
  evidence?: string[];
  suggestedFiles?: string[];
  suggestedNextTests?: string[];
  reproductionCommand?: string;
  artifacts: string[];
}

export interface ControlPlaneRunbookCommand {
  id: string;
  label: string;
  lane: "local" | "pull_request" | "ci" | "schedule" | "protected" | "triage" | "ui";
  command: string;
  cwd: string;
  safety: "pr_safe" | "trusted_only" | "local_only";
  description: string;
  requiredSecrets: string[];
  expectedArtifacts: string[];
}

export interface ControlPlaneCommandRunnerInput {
  commandId: string;
  stepId: string;
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export interface ControlPlaneCommandRunnerResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type ControlPlaneCommandRunner = (input: ControlPlaneCommandRunnerInput) => Promise<ControlPlaneCommandRunnerResult>;

export interface ControlPlaneCommandStepResult {
  stepId: string;
  command: string;
  args: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface ControlPlaneCommandExecution {
  schemaVersion: 1;
  commandId: string;
  label: string;
  status: "passed" | "failed" | "blocked";
  startedAt: string;
  completedAt: string;
  durationMs: number;
  cwd: string;
  safety: ControlPlaneRunbookCommand["safety"];
  readOnly: boolean;
  message: string;
  steps: ControlPlaneCommandStepResult[];
  expectedArtifacts: string[];
}

export interface ControlPlaneActionHistory {
  schemaVersion: 1;
  generatedAt?: string;
  summary: {
    total: number;
    passed: number;
    failed: number;
    blocked: number;
    latestStatus?: ControlPlaneCommandExecution["status"];
    latestCommandId?: string;
    latestCompletedAt?: string;
  };
  actions: ControlPlaneCommandExecution[];
}

export interface ControlPlaneRunbook {
  generatedAt: string;
  configPath: string;
  commands: ControlPlaneRunbookCommand[];
  notes: string[];
}

export interface ControlPlaneRunProfile {
  id: string;
  label: string;
  description: string;
  commandIds: string[];
  safety: ControlPlaneRunbookCommand["safety"];
  enabled: boolean;
  blockedReasons: string[];
  expectedArtifacts: string[];
  requiredSecrets: string[];
}

export interface ControlPlaneProfileExecution {
  schemaVersion: 1;
  profileId: string;
  label: string;
  status: "passed" | "failed" | "blocked";
  startedAt: string;
  completedAt: string;
  durationMs: number;
  commandExecutions: ControlPlaneCommandExecution[];
  message: string;
}

export type ControlPlaneCoverage = CoverageReport;

export interface ControlPlaneSnapshot {
  schemaVersion: 1;
  generatedAt: string;
  repoRoot: string;
  configPath: string;
  configRoot: string;
  readOnly: boolean;
  demo: boolean;
  configRaw?: string;
  config?: VisualHiveConfig;
  configError?: string;
  plan?: unknown;
  report?: Report;
  triageReport?: TriageReport;
  runHistory?: RunHistoryReport;
  riskReport?: RiskRegisterReport;
  readinessReport?: ReadinessReport;
  securityAudit?: SecurityAuditReport;
  costAudit?: CostAuditReport;
  mutationReport?: MutationReport;
  providerRunReport?: MockProviderRunReport;
  providerDecisionLog?: ProviderDecisionLog;
  providerSetupPlan?: ProviderSetupPlan;
  targetAudit?: TargetAuditReport;
  contractAudit?: ContractAuditReport;
  flowAudit?: FlowAuditReport;
  scheduleAudit?: ScheduleAuditReport;
  workflowAudit?: WorkflowAuditReport;
  setupRecommendation?: SetupRecommendationReport;
  issueMarkdown?: string;
  prCommentMarkdown?: string;
  triagePrompt?: string;
  repairPrompt?: string;
  missingTestsMarkdown?: string;
  baselineReviewMarkdown?: string;
  llmUsage?: LLMUsageReport;
  llmDecisionLog?: LLMDecisionLog;
  actionHistory?: ControlPlaneActionHistory;
  overview: ControlPlaneOverview;
  failures: ControlPlaneFailure[];
  runbook: ControlPlaneRunbook;
  runProfiles: ControlPlaneRunProfile[];
  screenshots: ControlPlaneScreenshot[];
  baselineSummary?: BaselineSummary;
  coverage: ControlPlaneCoverage;
  coverageImprovementReport?: CoverageImprovementReport;
  targets: Array<{ id: string; config: TargetConfig; contractIds: string[]; latestStatus?: string }>;
  contracts: Array<{ config: ContractConfig; latestStatus?: string; mutationOperators: string[] }>;
  providers: ProviderInspection[];
  workflowTemplates: GitHubWorkflowTemplate[];
  artifacts: ControlPlaneArtifact[];
  connections?: RepoConnectionIndex;
  activeConnectionId?: string;
}

export interface ArtifactFile {
  path: string;
  kind: ControlPlaneArtifact["kind"];
  contentType: string;
  content: string | Buffer;
  bytes: number;
}

export interface StartedControlPlane {
  url: string;
  port: number;
  close: () => Promise<void>;
}
