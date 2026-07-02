import type { EvidenceContribution, VerdictSummary } from "../evidence/types.js";

export interface VerdictContribution extends EvidenceContribution {
  key: string;
}

export interface VerdictReport {
  schemaVersion: "visual-hive.verdict.v1";
  generatedAt: string;
  project: string;
  sourceArtifacts: {
    evidencePacket?: string;
    plan?: string;
    report?: string;
    mutationReport?: string;
    triageReport?: string;
    providerResults?: string;
    readiness?: string;
    coverage?: string;
    repoMap?: string;
    artifactsIndex?: string;
  };
  governance: {
    verdictAuthority: "visual_hive";
    defaultBrowserBackend: "playwright";
    llmAuthority: "advisory_only";
    providerAuthority: "policy_gated_when_normalized";
    secretPolicy: "redacted_values_names_only";
  };
  policy: {
    passFailOwnedBy: "visual_hive_verdict_engine";
    deterministicSources: string[];
    advisorySources: string[];
    providerGating: "explicit_normalized_trusted_budget_authorized";
    mutationGating: "configured_threshold";
  };
  summary: VerdictSummary & {
    totalContributions: number;
    gatingContributions: number;
    advisoryContributions: number;
    failedContributions: number;
    blockedContributions: number;
    warningContributions: number;
    inconclusiveContributions: number;
    passedContributions: number;
    skippedContributions: number;
  };
  gatingContributions: VerdictContribution[];
  advisoryContributions: VerdictContribution[];
  allContributions: VerdictContribution[];
}
