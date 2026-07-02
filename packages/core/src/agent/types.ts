import type { EvidenceContribution, EvidencePacket, VisualHiveVerdict } from "../evidence/types.js";
import type { HandoffPacket, HandoffWorkItem } from "../handoff/types.js";

export type AgentPacketProfile = "repair_agent" | "test_creator" | "review_agent" | "handoff_agent";

export interface AgentToolPermission {
  id: string;
  label: string;
  access: "read_only" | "local_execution" | "trusted_write";
  reason: string;
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
  evidencePacket: EvidencePacket;
  evidencePacketPath: string;
  handoffPacket?: HandoffPacket;
  handoffPacketPath?: string;
  profile?: AgentPacketProfile;
  now?: Date;
}
