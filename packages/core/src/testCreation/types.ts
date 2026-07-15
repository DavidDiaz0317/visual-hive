import type { CoverageImprovementRecommendation } from "../coverage/improve.js";
import type { EvidencePacketTestingLayer } from "../evidence/types.js";
import type { HandoffWorkItem } from "../handoff/types.js";
import type { VisualHiveConfig } from "../config/schema.js";
import type { RepoMapReport } from "../repo/types.js";

export type TestCreationPriority = "low" | "medium" | "high";
export type TestCreationSource = "testing_layer" | "coverage_recommendation" | "mutation_survivor" | "handoff_work_item";
export type TestCreationHiveOwner = "quality" | "tester" | "ci-maintainer";
export type TestCreationKind =
  | "unit_test"
  | "accessibility_check"
  | "api_contract"
  | "selector_assertion"
  | "screenshot"
  | "flow"
  | "mutation_mapping"
  | "workflow_setup"
  | "provider_review"
  | "protected_canary"
  | "history_review"
  | "agent_handoff";

export interface TestCreationPlan {
  schemaVersion: "visual-hive.test-creation-plan.v2";
  generatedAt: string;
  project: string;
  outputResource?: TestCreationPlanOutputResource;
  sourceArtifacts: {
    evidencePacket?: string;
    coverageRecommendations?: string;
    handoffPacket?: string;
  };
  governance: {
    verdictAuthority: "visual_hive";
    agentAuthority: "advisory_test_generation_only";
    writePolicy: "no_config_or_test_files_written";
    secretPolicy: "redacted_values_names_only";
  };
  summary: {
    total: number;
    high: number;
    medium: number;
    low: number;
    fromTestingLayers: number;
    fromCoverageRecommendations: number;
    fromMutationSurvivors: number;
    fromHandoffWorkItems: number;
  };
  recommendations: TestCreationRecommendation[];
}

export interface TestCreationPlanOutputResource {
  artifactPath: string;
  evidenceResourceId: string;
  evidenceResourceUri: string;
  evidenceResourceTitle: string;
  evidenceResourceDescription: string;
  evidenceReadToolName?: string;
}

export interface TestCreationRecommendation {
  id: string;
  gapId: string;
  source: TestCreationSource;
  kind: TestCreationKind;
  priority: TestCreationPriority;
  title: string;
  rationale: string[];
  affected: TestCreationAffected;
  currentEvidence: string[];
  grounding: TestCreationGrounding;
  suggestedContract: TestCreationSuggestedContract;
  suggestedMutation: string;
  validationCommand: string;
  hiveOwner: TestCreationHiveOwner;
  layer?: Pick<EvidencePacketTestingLayer, "id" | "name" | "status">;
  targetId?: string;
  contractId?: string;
  mutationOperator?: string;
  coverageRecommendationId?: string;
  handoffWorkItemId?: string;
  suggestedTests: string[];
  suggestedConfigYaml?: string;
  artifacts: string[];
  trustedOnly: boolean;
  applyMode: "advisory_no_write";
}

export interface TestCreationAffected {
  route?: string;
  component?: string;
  viewport?: string;
  state?: string;
}

export interface TestCreationSuggestedContract {
  id: string;
  description: string;
  targetId?: string;
  route?: string;
  viewport?: string;
  selectors: string[];
  mustNotExistSelectors: string[];
  textMustExist: string[];
  textMustNotExist: string[];
  maskSelectors: string[];
}

export interface TestCreationGrounding {
  status: "grounded" | "unresolved";
  evidence: string[];
  unresolvedReasons: string[];
}

export type TestCreationRecommendationDraft = Omit<
  TestCreationRecommendation,
  "gapId" | "affected" | "currentEvidence" | "grounding" | "suggestedContract" | "suggestedMutation" | "validationCommand" | "hiveOwner"
>;

export interface BuildTestCreationPlanOptions {
  project: string;
  now?: Date;
  evidencePacketPath?: string;
  coverageRecommendationsPath?: string;
  handoffPacketPath?: string;
  evidencePacket?: {
    testingLayers: EvidencePacketTestingLayer[];
    mutation?: {
      survivedOperators: Array<{ operator: string; contractIds: string[]; failedAssertion?: string; artifacts: string[] }>;
    };
  };
  coverageRecommendations?: {
    recommendations: CoverageImprovementRecommendation[];
  };
  handoffPacket?: {
    workItems: HandoffWorkItem[];
  };
  config?: VisualHiveConfig;
  repoMap?: RepoMapReport;
}
