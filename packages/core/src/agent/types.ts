import type { EvidenceContribution, EvidencePacket, VisualHiveVerdict } from "../evidence/types.js";
import type { HandoffPacket, HandoffWorkItem } from "../handoff/types.js";
import type { RunHistoryReport } from "../history/record.js";
import type { TestCreationRecommendation } from "../testCreation/types.js";

export type AgentPacketProfile = "repair_agent" | "test_creator" | "review_agent" | "handoff_agent" | "provider_specialist";

export interface AgentToolPermission {
  id: string;
  label: string;
  access: "read_only" | "local_execution" | "trusted_write";
  reason: string;
  evidenceResourceId?: string;
  evidenceResourceUri?: string;
  evidenceResourceTitle?: string;
  evidenceResourceDescription?: string;
  evidenceReadToolName?: string;
  artifactPath?: string;
}

export interface AgentProviderEvidenceSummary {
  providerId: string;
  status: string;
  deterministicRole: string;
  message: string;
  artifactCount: number;
  missingEnv: string[];
  uploadStatus?: string;
  externalCallsMade: number;
  stagedArtifacts?: number;
  uploadedArtifacts?: number;
  manifestPath?: string;
  uploadDirectory?: string;
  providerUrl?: string;
  blockedReasons: string[];
}

export interface AgentRunHistorySummary {
  artifactPath: string;
  evidenceResourceId: "run-history";
  evidenceResourceUri: "visual-hive://run-history";
  evidenceReadToolName: "visual_hive_read_run_history";
  authority: "trend_evidence_only";
  runCount: number;
  latestStatus?: "passed" | "failed";
  latestRecordedAt?: string;
  latestMutationScore?: number;
  trendDirection: RunHistoryReport["trend"]["direction"];
  trendReasons: string[];
  totalVisualDiffs: number;
  totalMissingBaselines: number;
  totalCreatedBaselines: number;
}

export interface AgentPacket {
  schemaVersion: "visual-hive.agent-packet.v1";
  generatedAt: string;
  project: string;
  profile: AgentPacketProfile;
  objective: string;
  sourceArtifacts: {
    evidencePacket: string;
    handoffPacket?: string;
    testCreationPlan?: string;
    runHistory?: string;
  };
  verdict: {
    visualHiveVerdict: VisualHiveVerdict;
    failedBecause: string[];
    warningBecause: string[];
    blockedBecause: string[];
    advisoryOnly: string[];
  };
  evidenceSummary: {
    gatingContributions: EvidenceContribution[];
    advisoryContributions: EvidenceContribution[];
    workItems: HandoffWorkItem[];
    selectedContracts: string[];
    selectedTargets: string[];
    mutationScore?: number;
    providerEvidence: AgentProviderEvidenceSummary[];
    runHistory?: AgentRunHistorySummary;
    testingLayers: EvidencePacket["testingLayers"];
    testCreationRecommendations: TestCreationRecommendation[];
  };
  allowedTools: AgentToolPermission[];
  forbiddenActions: string[];
  budgets: {
    maxToolCalls: number;
    maxToolResultTokens: number;
    maxExternalCostUsd: number;
    allowExternalNetwork: false;
  };
  reproductionCommands: string[];
  artifactPointers: string[];
  instructions: string[];
  governance: {
    verdictAuthority: "visual_hive";
    agentAuthority: "advisory_repair_only";
    secretPolicy: "redacted_values_names_only";
    requireHumanApprovalFor: string[];
  };
}

export interface BuildAgentPacketOptions {
  rootDir?: string;
  evidencePacket: EvidencePacket;
  evidencePacketPath: string;
  handoffPacket?: HandoffPacket;
  handoffPacketPath?: string;
  testCreationRecommendations?: TestCreationRecommendation[];
  testCreationPlanPath?: string;
  runHistory?: RunHistoryReport;
  runHistoryPath?: string;
  profile?: AgentPacketProfile;
  now?: Date;
}
