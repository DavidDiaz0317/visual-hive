import type { CostSchema, MutationOperator, SeveritySchema } from "../config/schema.js";
import type { z } from "zod";

export type PlanMode = "pr" | "schedule" | "manual";
export type CostClass = z.infer<typeof CostSchema>;
export type Severity = z.infer<typeof SeveritySchema>;

export interface PlanTarget {
  id: string;
  kind: "command" | "url";
  url: string;
  prSafe: boolean;
  cost: CostClass;
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
  operators: MutationOperator[];
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
