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

export interface Plan {
  schemaVersion: 1;
  project: string;
  mode: PlanMode;
  generatedAt: string;
  changedFiles: string[];
  targets: PlanTarget[];
  items: PlanItem[];
  excluded: ExcludedPlanItem[];
  mutation: MutationPlan;
}

export interface CreatePlanOptions {
  mode: PlanMode;
  changedFiles?: string[];
  allowUnsafeTargets?: boolean;
  now?: Date;
}
