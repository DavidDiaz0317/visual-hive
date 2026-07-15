import type { MutationReport, ProviderResult, Report, TriageReport } from "../reports/types.js";
import type { Plan } from "../planner/types.js";
import type { RepoMapReport } from "../repo/types.js";

export type VisualHiveVerdict = "passed" | "failed" | "warning" | "blocked" | "inconclusive";

export type EvidenceContributionStatus = "passed" | "failed" | "warning" | "blocked" | "inconclusive" | "skipped";

export interface EvidenceContribution {
  key: string;
  source:
    | "visual_hive"
    | "playwright"
    | "screenshot_diff"
    | "mutation"
    | "provider"
    | "triage"
    | "readiness"
    | "coverage"
    | "llm"
    | "hive"
    | "agent";
  kind: string;
  status: EvidenceContributionStatus;
  gating: boolean;
  authority: "gating" | "advisory";
  mode?: string;
  contractId?: string;
  targetId?: string;
  operator?: string;
  providerId?: string;
  reason: string;
  artifacts: string[];
}

export function evidenceContributionKey(
  contribution: Pick<EvidenceContribution, "source" | "kind" | "contractId" | "operator" | "providerId">
): string {
  const id = contribution.operator ?? contribution.contractId ?? contribution.providerId;
  return [contribution.source, contribution.kind, id].filter(Boolean).join(".");
}

export interface VerdictSummary {
  visualHiveVerdict: VisualHiveVerdict;
  failedBecause: string[];
  warningBecause: string[];
  blockedBecause: string[];
  advisoryOnly: string[];
}

export interface EvidencePacketTestingLayer {
  id: number;
  name: string;
  status: "covered" | "partial" | "missing" | "not_applicable" | "unknown";
  evidence: string[];
  gaps: string[];
}

export type EvidencePacketHiveMode = "advisory" | "measured" | "repair_request" | "guarded_repair" | "full";

export interface EvidencePacketHiveModeReadiness {
  mode: EvidencePacketHiveMode;
  status: "ready" | "blocked" | "trusted_only";
  reason: string;
  nextCommand: string;
  localPreviewAllowed: boolean;
  trustedWorkflowRequired: boolean;
  externalCallsMade: 0;
  emits: {
    issueContext: boolean;
    beads: boolean;
    knowledgeFacts: boolean;
    knowledgeGraph: boolean;
    wikiVault: boolean;
    repairWorkOrders: boolean;
    agentPolicy: boolean;
  };
  blockedReasons: string[];
}

export interface EvidencePacketProviderEvidence
  extends Pick<
    ProviderResult,
    "providerId" | "label" | "status" | "deterministicRole" | "message" | "requiredEnv" | "missingEnv" | "artifactCount"
  > {
  externalUrl?: string;
  externalUploadAllowed?: boolean;
  externalUploadBlockedReasons?: string[];
  estimatedExternalScreenshots?: number;
  upload?: {
    status: "uploaded" | "skipped" | "blocked" | "missing_credentials" | "failed" | "dry_run";
    externalCallsMade: number;
    uploadedArtifacts: number;
    stagedArtifacts: number;
    manifestPath?: string;
    uploadDirectory?: string;
    command?: string;
    stdout?: string;
    stderr?: string;
    providerUrl?: string;
    blockedReasons: string[];
  };
}

export interface EvidencePacket {
  schemaVersion: "visual-hive.evidence-packet.v2";
  generatedAt: string;
  project: string;
  sourceArtifacts: {
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
  repo: {
    repository?: string;
    branch?: string;
    commitSha?: string;
    runContext?: string;
  };
  repoIntelligence?: Pick<RepoMapReport, "project" | "sourceSummary" | "testTools" | "testFiles" | "testRunners" | "runtimeScopes" | "targetHints" | "riskSignals" | "coverageGaps"> & {
    selectorCount: number;
    routeCount: number;
    workflowCount: number;
  };
  plan?: Pick<Plan, "schemaVersion" | "project" | "mode" | "generatedAt" | "changedFiles" | "effectiveChangedFiles"> & {
    selectedContracts: string[];
    selectedTargets: string[];
    excludedContracts: Array<{ contractId: string; targetId: string; reasons: string[] }>;
  };
  deterministicReport?: Pick<
    Report,
    | "schemaVersion"
    | "project"
    | "mode"
    | "generatedAt"
    | "status"
    | "selectedTargets"
    | "selectedContracts"
    | "excludedContracts"
    | "summary"
    | "generatedSpecPath"
    | "reproductionCommands"
  > & {
    failedContracts: Array<{ contractId: string; targetId: string; errors: string[]; artifacts: string[]; reproductionCommand?: string }>;
    screenshotEvidence: Array<{
      contractId: string;
      screenshotName: string;
      status: string;
      route: string;
      viewport: string;
      baselinePath: string;
      actualPath: string;
      diffPath?: string;
      actualDiffPixelRatio?: number;
      actualDiffPixels?: number;
    }>;
    consoleErrors: number;
    pageErrors: number;
    networkErrors: number;
  };
  mutation?: Pick<MutationReport, "schemaVersion" | "project" | "generatedAt" | "minScore" | "score" | "killed" | "total"> & {
    killedOperators: Array<{ operator: string; contractIds: string[]; affected?: MutationReport["results"][number]["affected"]; artifacts: string[]; suggestedMissingTest?: string }>;
    survivedOperators: Array<{
      operator: string;
      contractIds: string[];
      failedAssertion?: string;
      affected?: MutationReport["results"][number]["affected"];
      artifacts: string[];
      suggestedMissingTest?: string;
      validationCommand?: string;
    }>;
    notApplicableOperators: string[];
  };
  providers: EvidencePacketProviderEvidence[];
  triage?: Pick<TriageReport, "schemaVersion" | "project" | "generatedAt" | "summary"> & {
    findings: Array<{
      classification: string;
      severity: string;
      title: string;
      evidence: string[];
      contractIds?: string[];
      targetIds?: string[];
      suggestedNextTests: string[];
    }>;
  };
  testingLayers: EvidencePacketTestingLayer[];
  evidenceContributions: EvidenceContribution[];
  verdictSummary: VerdictSummary;
  hiveReadiness: {
    readyForIssueHandoff: boolean;
    readyForHiveDryRun: boolean;
    blockedReasons: string[];
    suggestedLabels: string[];
    recommendedMode: EvidencePacketHiveMode;
    recommendationReason: string;
    modeReadiness: EvidencePacketHiveModeReadiness[];
  };
}
