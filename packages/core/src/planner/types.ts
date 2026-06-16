import type { CostSchema, MutationOperatorConfig, SeveritySchema, TargetConfig } from "../config/schema.js";
import type { z } from "zod";

export const PLAN_MODES = ["pr", "schedule", "manual", "canary", "mutation", "full"] as const;
export type PlanMode = (typeof PLAN_MODES)[number];
export type CostClass = z.infer<typeof CostSchema>;
export type Severity = z.infer<typeof SeveritySchema>;

export interface PlanTarget {
  id: string;
  kind: TargetConfig["kind"];
  url: string;
  prSafe: boolean;
  cost: CostClass;
  requiresSecrets?: string[];
}

export interface PlanItem {
  contractId: string;
  targetId: string;
  targetUrl: string;
  severity: Severity;
  cost: CostClass;
  reasons: string[];
  screenshots: string[];
}

export interface ExcludedPlanItem {
  contractId: string;
  targetId: string;
  reasons: string[];
}

export interface MutationPlan {
  enabled: boolean;
  operators: MutationOperatorConfig[];
  minScore: number;
  reasons: string[];
}

export interface PlanProviderPolicy {
  providerId: string;
  label: string;
  enabled: boolean;
  mode: "mock" | "external";
  availability: "available" | "disabled" | "missing_credentials" | "mock" | "policy_blocked";
  deterministicRole: "oracle" | "supplemental";
  requiredEnv: string[];
  missingEnv: string[];
  externalUploadAllowed: boolean;
  externalUploadBlockedReasons: string[];
  estimatedExternalScreenshots: number;
  externalCallsPlanned: 0;
  reasons: string[];
}

export interface IgnoredChangedFile {
  file: string;
  pattern: string;
  reason: string;
}

export interface Plan {
  schemaVersion: 1;
  project: string;
  mode: PlanMode;
  generatedAt: string;
  changedFiles: string[];
  effectiveChangedFiles: string[];
  ignoredChangedFiles: IgnoredChangedFile[];
  targets: PlanTarget[];
  items: PlanItem[];
  excluded: ExcludedPlanItem[];
  mutation: MutationPlan;
  providerPolicy: PlanProviderPolicy[];
}

export interface CreatePlanOptions {
  mode: PlanMode;
  changedFiles?: string[];
  allowUnsafeTargets?: boolean;
  includeContracts?: string[];
  excludeContracts?: string[];
  includeTargets?: string[];
  excludeTargets?: string[];
  now?: Date;
  env?: NodeJS.ProcessEnv;
}
