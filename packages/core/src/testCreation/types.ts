import type { CoverageImprovementRecommendation } from "../coverage/improve.js";
import type { EvidencePacketTestingLayer } from "../evidence/types.js";
import type { HandoffWorkItem } from "../handoff/types.js";
import type { VisualHiveConfig } from "../config/schema.js";
import type { RepoMapReport } from "../repo/types.js";
import { z } from "zod";

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

const TestCreationBoundedStringV2Schema = z.string().max(32_768);
const TestCreationNonemptyStringV2Schema = TestCreationBoundedStringV2Schema.refine((value) => Boolean(value.trim()), {
  message: "Expected a nonempty string."
});
const TestCreationTimestampV2Schema = TestCreationNonemptyStringV2Schema.refine((value) => Number.isFinite(Date.parse(value)), {
  message: "Expected a valid timestamp."
});
const TestCreationStringListV2Schema = z.array(TestCreationBoundedStringV2Schema).max(8_192);

const TestCreationAffectedV2Schema = z.object({
  route: TestCreationBoundedStringV2Schema.optional(),
  component: TestCreationBoundedStringV2Schema.optional(),
  viewport: TestCreationBoundedStringV2Schema.optional(),
  state: TestCreationBoundedStringV2Schema.optional()
}).strict();

const TestCreationGroundingV2Schema = z.object({
  status: z.enum(["grounded", "unresolved"]),
  evidence: TestCreationStringListV2Schema,
  unresolvedReasons: TestCreationStringListV2Schema
}).strict().superRefine((grounding, context) => {
  if (grounding.status !== "grounded") return;
  if (grounding.evidence.length === 0 || grounding.evidence.some((item) => !item.trim())) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["evidence"],
      message: "Grounded recommendations require at least one nonempty evidence item."
    });
  }
  if (grounding.unresolvedReasons.length !== 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["unresolvedReasons"],
      message: "Grounded recommendations cannot retain unresolved reasons."
    });
  }
});

const TestCreationSuggestedContractV2Schema = z.object({
  id: TestCreationNonemptyStringV2Schema,
  description: TestCreationNonemptyStringV2Schema,
  targetId: TestCreationBoundedStringV2Schema.optional(),
  route: TestCreationBoundedStringV2Schema.optional(),
  viewport: TestCreationBoundedStringV2Schema.optional(),
  selectors: TestCreationStringListV2Schema,
  mustNotExistSelectors: TestCreationStringListV2Schema,
  textMustExist: TestCreationStringListV2Schema,
  textMustNotExist: TestCreationStringListV2Schema,
  maskSelectors: TestCreationStringListV2Schema
}).strict();

export const TestCreationRecommendationV2Schema: z.ZodType<TestCreationRecommendation> = z.object({
  id: TestCreationNonemptyStringV2Schema,
  gapId: TestCreationNonemptyStringV2Schema,
  source: z.enum(["testing_layer", "coverage_recommendation", "mutation_survivor", "handoff_work_item"]),
  kind: z.enum([
    "unit_test",
    "accessibility_check",
    "api_contract",
    "selector_assertion",
    "screenshot",
    "flow",
    "mutation_mapping",
    "workflow_setup",
    "provider_review",
    "protected_canary",
    "history_review",
    "agent_handoff"
  ]),
  priority: z.enum(["low", "medium", "high"]),
  title: TestCreationNonemptyStringV2Schema,
  rationale: TestCreationStringListV2Schema,
  affected: TestCreationAffectedV2Schema,
  currentEvidence: TestCreationStringListV2Schema,
  grounding: TestCreationGroundingV2Schema,
  suggestedContract: TestCreationSuggestedContractV2Schema,
  suggestedMutation: TestCreationNonemptyStringV2Schema,
  validationCommand: TestCreationNonemptyStringV2Schema,
  hiveOwner: z.enum(["quality", "tester", "ci-maintainer"]),
  layer: z.object({
    id: z.number(),
    name: TestCreationNonemptyStringV2Schema,
    status: z.enum(["covered", "partial", "missing", "not_applicable", "unknown"])
  }).strict().optional(),
  targetId: TestCreationBoundedStringV2Schema.optional(),
  contractId: TestCreationBoundedStringV2Schema.optional(),
  mutationOperator: TestCreationBoundedStringV2Schema.optional(),
  coverageRecommendationId: TestCreationBoundedStringV2Schema.optional(),
  handoffWorkItemId: TestCreationBoundedStringV2Schema.optional(),
  suggestedTests: TestCreationStringListV2Schema,
  suggestedConfigYaml: TestCreationBoundedStringV2Schema.optional(),
  artifacts: TestCreationStringListV2Schema,
  trustedOnly: z.boolean(),
  applyMode: z.literal("advisory_no_write")
}).strict();

export const TestCreationPlanV2Schema: z.ZodType<TestCreationPlan> = z.object({
  schemaVersion: z.literal("visual-hive.test-creation-plan.v2"),
  generatedAt: TestCreationTimestampV2Schema,
  project: TestCreationNonemptyStringV2Schema,
  outputResource: z.object({
    artifactPath: z.literal(".visual-hive/test-creation-plan.json"),
    evidenceResourceId: z.literal("test-creation-plan"),
    evidenceResourceUri: z.literal("visual-hive://test-creation-plan"),
    evidenceResourceTitle: z.literal("Test Creation Plan"),
    evidenceResourceDescription: TestCreationNonemptyStringV2Schema,
    evidenceReadToolName: z.literal("visual_hive_read_test_creation_plan").optional()
  }).strict().optional(),
  sourceArtifacts: z.object({
    evidencePacket: TestCreationBoundedStringV2Schema.optional(),
    coverageRecommendations: TestCreationBoundedStringV2Schema.optional(),
    handoffPacket: TestCreationBoundedStringV2Schema.optional()
  }).strict(),
  governance: z.object({
    verdictAuthority: z.literal("visual_hive"),
    agentAuthority: z.literal("advisory_test_generation_only"),
    writePolicy: z.literal("no_config_or_test_files_written"),
    secretPolicy: z.literal("redacted_values_names_only")
  }).strict(),
  summary: z.object({
    total: z.number().int().nonnegative(),
    high: z.number().int().nonnegative(),
    medium: z.number().int().nonnegative(),
    low: z.number().int().nonnegative(),
    fromTestingLayers: z.number().int().nonnegative(),
    fromCoverageRecommendations: z.number().int().nonnegative(),
    fromMutationSurvivors: z.number().int().nonnegative(),
    fromHandoffWorkItems: z.number().int().nonnegative()
  }).strict(),
  recommendations: z.array(TestCreationRecommendationV2Schema)
}).strict().superRefine((plan, context) => {
  const expected = {
    total: plan.recommendations.length,
    high: plan.recommendations.filter((recommendation) => recommendation.priority === "high").length,
    medium: plan.recommendations.filter((recommendation) => recommendation.priority === "medium").length,
    low: plan.recommendations.filter((recommendation) => recommendation.priority === "low").length,
    fromTestingLayers: plan.recommendations.filter((recommendation) => recommendation.source === "testing_layer").length,
    fromCoverageRecommendations: plan.recommendations.filter((recommendation) => recommendation.source === "coverage_recommendation").length,
    fromMutationSurvivors: plan.recommendations.filter((recommendation) => recommendation.source === "mutation_survivor").length,
    fromHandoffWorkItems: plan.recommendations.filter((recommendation) => recommendation.source === "handoff_work_item").length
  };
  for (const [key, count] of Object.entries(expected)) {
    if (plan.summary[key as keyof typeof expected] !== count) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["summary", key],
        message: `Summary count must equal ${count}.`
      });
    }
  }
});

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
