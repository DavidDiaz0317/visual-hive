import type { VisualHiveConfig } from "../config/schema.js";
import { sanitizeText } from "../utils/sanitize.js";

export type LLMTaskType =
  | "visual_failure_triage"
  | "mutation_survivor_review"
  | "missing_coverage_review"
  | "repair_prompt"
  | "missing_tests"
  | "issue_draft";

export interface LLMPromptArtifact {
  task: LLMTaskType;
  path: string;
  content: string;
}

export interface LLMUsageReport {
  schemaVersion: 1;
  project: string;
  generatedAt: string;
  governance: LLMGovernanceSettings;
  summary: LLMUsageSummary;
  records: LLMUsageRecord[];
  warnings: string[];
  recommendations: string[];
}

export interface LLMGovernanceSettings {
  enabled: boolean;
  provider: string;
  model: string;
  neverSoleOracle: boolean;
  maxDailyRuns: number;
  maxPromptTokens: number;
  maxEstimatedCostUsd: number;
  callsMade: 0;
}

export interface LLMUsageSummary {
  promptCount: number;
  totalEstimatedTokens: number;
  totalEstimatedCostUsd: number;
  blockedPrompts: number;
  promptOnly: boolean;
  advisoryOnly: boolean;
  callsMade: 0;
}

export interface LLMUsageRecord {
  task: LLMTaskType;
  path: string;
  provider: string;
  model: string;
  enabled: boolean;
  promptOnly: true;
  advisoryOnly: true;
  callsMade: 0;
  status: "prompt_only" | "disabled" | "blocked_by_token_budget" | "blocked_by_cost_budget" | "policy_violation";
  promptChars: number;
  estimatedTokens: number;
  estimatedCostUsd: number;
  budget: {
    maxPromptTokens: number;
    maxEstimatedCostUsd: number;
  };
  notes: string[];
}

export interface BuildLLMUsageReportOptions {
  now?: Date;
}

const DEFAULT_TOKEN_ESTIMATE_CHARS = 4;
const MODEL_RATES_PER_1K_INPUT_TOKENS: Record<string, number> = {
  "gpt-4.1": 0.005,
  "gpt-4.1-mini": 0.0004,
  "gpt-4o": 0.005,
  "gpt-4o-mini": 0.00015,
  "offline": 0,
  "offline-heuristics": 0,
  "none": 0
};

export function buildLLMUsageReport(
  config: VisualHiveConfig,
  prompts: LLMPromptArtifact[],
  options: BuildLLMUsageReportOptions = {}
): LLMUsageReport {
  const governance = governanceSettings(config);
  const records = prompts.map((prompt) => usageRecord(governance, prompt));
  const totalEstimatedTokens = records.reduce((sum, record) => sum + record.estimatedTokens, 0);
  const totalEstimatedCostUsd = roundUsd(records.reduce((sum, record) => sum + record.estimatedCostUsd, 0));
  const warnings = collectWarnings(governance, records);
  return {
    schemaVersion: 1,
    project: config.project.name,
    generatedAt: (options.now ?? new Date()).toISOString(),
    governance,
    summary: {
      promptCount: records.length,
      totalEstimatedTokens,
      totalEstimatedCostUsd,
      blockedPrompts: records.filter((record) => record.status.startsWith("blocked") || record.status === "policy_violation").length,
      promptOnly: true,
      advisoryOnly: governance.neverSoleOracle,
      callsMade: 0
    },
    records,
    warnings,
    recommendations: recommendationsFor(governance, records, warnings)
  };
}

function governanceSettings(config: VisualHiveConfig): LLMGovernanceSettings {
  return {
    enabled: config.ai.enabled,
    provider: sanitizeText(config.ai.provider),
    model: sanitizeText(config.ai.model),
    neverSoleOracle: config.ai.neverSoleOracle,
    maxDailyRuns: config.ai.maxDailyRuns,
    maxPromptTokens: config.ai.maxPromptTokens,
    maxEstimatedCostUsd: config.ai.maxEstimatedCostUsd,
    callsMade: 0
  };
}

function usageRecord(governance: LLMGovernanceSettings, prompt: LLMPromptArtifact): LLMUsageRecord {
  const promptChars = prompt.content.length;
  const estimatedTokens = estimateTokens(prompt.content);
  const estimatedCostUsd = estimateCostUsd(governance.provider, governance.model, estimatedTokens);
  const notes = [
    "Prompt artifact generated locally.",
    "No LLM API call was made.",
    "Deterministic Playwright and mutation results remain the pass/fail oracle."
  ];
  return {
    task: prompt.task,
    path: sanitizeText(prompt.path.replaceAll("\\", "/")),
    provider: governance.provider,
    model: governance.model,
    enabled: governance.enabled,
    promptOnly: true,
    advisoryOnly: true,
    callsMade: 0,
    status: statusFor(governance, estimatedTokens, estimatedCostUsd),
    promptChars,
    estimatedTokens,
    estimatedCostUsd,
    budget: {
      maxPromptTokens: governance.maxPromptTokens,
      maxEstimatedCostUsd: governance.maxEstimatedCostUsd
    },
    notes
  };
}

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / DEFAULT_TOKEN_ESTIMATE_CHARS);
}

export function estimateCostUsd(provider: string, model: string, estimatedTokens: number): number {
  if (provider === "none" || provider === "offline") return 0;
  const rate = MODEL_RATES_PER_1K_INPUT_TOKENS[model] ?? 0.001;
  return roundUsd((estimatedTokens / 1000) * rate);
}

function statusFor(
  governance: LLMGovernanceSettings,
  estimatedTokens: number,
  estimatedCostUsd: number
): LLMUsageRecord["status"] {
  if (!governance.neverSoleOracle) return "policy_violation";
  if (estimatedTokens > governance.maxPromptTokens) return "blocked_by_token_budget";
  if (estimatedCostUsd > governance.maxEstimatedCostUsd) return "blocked_by_cost_budget";
  if (!governance.enabled || governance.provider === "none") return "disabled";
  return "prompt_only";
}

function collectWarnings(governance: LLMGovernanceSettings, records: LLMUsageRecord[]): string[] {
  const warnings: string[] = [];
  if (!governance.neverSoleOracle) {
    warnings.push("ai.neverSoleOracle must remain true; LLM output cannot decide pass/fail.");
  }
  if (!governance.enabled) {
    warnings.push("LLM usage is disabled; prompts are generated for offline review only.");
  }
  if (governance.provider === "none") {
    warnings.push("No LLM provider is configured; no external model call is possible from the default path.");
  }
  if (records.some((record) => record.status === "blocked_by_token_budget")) {
    warnings.push("One or more prompts exceed ai.maxPromptTokens.");
  }
  if (records.some((record) => record.status === "blocked_by_cost_budget")) {
    warnings.push("One or more prompts exceed ai.maxEstimatedCostUsd.");
  }
  return warnings;
}

function recommendationsFor(governance: LLMGovernanceSettings, records: LLMUsageRecord[], warnings: string[]): string[] {
  const recommendations = new Set<string>();
  recommendations.add("Keep LLM use prompt-only unless a trusted workflow explicitly performs a governed model call.");
  recommendations.add("Never use LLM output as the sole pass/fail oracle.");
  if (warnings.length) recommendations.add("Review LLM governance warnings before wiring external providers.");
  if (records.some((record) => record.status === "blocked_by_token_budget")) {
    recommendations.add("Reduce prompt size or raise ai.maxPromptTokens in config after review.");
  }
  if (records.some((record) => record.status === "blocked_by_cost_budget")) {
    recommendations.add("Use a lower-cost model, reduce prompt size, or raise ai.maxEstimatedCostUsd after review.");
  }
  if (governance.provider === "none") {
    recommendations.add("Leave provider as none for local-only workflows; configure a provider only in trusted environments.");
  }
  return [...recommendations];
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
