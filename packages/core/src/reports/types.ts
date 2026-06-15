import type { PlanMode } from "../planner/types.js";

export type ContractStatus = "passed" | "failed" | "created" | "skipped";
export type MutationStatus = "killed" | "survived" | "error";
export type TriageClassification =
  | "visual_diff"
  | "missing_element"
  | "login_regression"
  | "api_contract_regression"
  | "possible_flake"
  | "environment_failure"
  | "coverage_gap"
  | "mutation_survivor";

export interface ContractResult {
  contractId: string;
  targetId: string;
  status: ContractStatus;
  durationMs: number;
  errors: string[];
  artifacts: string[];
}

export interface Report {
  schemaVersion: 1;
  project: string;
  mode: PlanMode;
  generatedAt: string;
  status: "passed" | "failed";
  changedFiles: string[];
  results: ContractResult[];
  consoleErrors: string[];
}

export interface MutationResult {
  operator: string;
  status: MutationStatus;
  killed: boolean;
  contractIds: string[];
  durationMs: number;
  errors: string[];
}

export interface MutationReport {
  schemaVersion: 1;
  project: string;
  generatedAt: string;
  minScore: number;
  score: number;
  killed: number;
  total: number;
  results: MutationResult[];
}

export interface TriageFinding {
  classification: TriageClassification;
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  evidence: string[];
  suggestedNextTests: string[];
}
