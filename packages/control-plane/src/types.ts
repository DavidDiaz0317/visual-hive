import type {
  ContractAuditReport,
  ContractConfig,
  CoverageReport,
  RepoConnectionIndex,
  LLMUsageReport,
  MutationReport,
  MockProviderRunReport,
  ProviderInspection,
  Report,
  RunHistoryReport,
  ScheduleAuditReport,
  TargetAuditReport,
  TargetConfig,
  VisualHiveConfig,
  ArtifactIndexEntry,
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
  errorExcerpt: string;
  reproductionCommand?: string;
  artifacts: string[];
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
  runHistory?: RunHistoryReport;
  mutationReport?: MutationReport;
  providerRunReport?: MockProviderRunReport;
  targetAudit?: TargetAuditReport;
  contractAudit?: ContractAuditReport;
  scheduleAudit?: ScheduleAuditReport;
  workflowAudit?: WorkflowAuditReport;
  setupRecommendation?: SetupRecommendationReport;
  issueMarkdown?: string;
  prCommentMarkdown?: string;
  triagePrompt?: string;
  repairPrompt?: string;
  missingTestsMarkdown?: string;
  llmUsage?: LLMUsageReport;
  overview: ControlPlaneOverview;
  failures: ControlPlaneFailure[];
  screenshots: ControlPlaneScreenshot[];
  coverage: ControlPlaneCoverage;
  targets: Array<{ id: string; config: TargetConfig; contractIds: string[]; latestStatus?: string }>;
  contracts: Array<{ config: ContractConfig; latestStatus?: string; mutationOperators: string[] }>;
  providers: ProviderInspection[];
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
