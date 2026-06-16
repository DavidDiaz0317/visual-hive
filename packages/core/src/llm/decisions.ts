import { readFile } from "node:fs/promises";
import { sanitizeText } from "../utils/sanitize.js";
import { writeJson } from "../utils/files.js";

export type LLMDecision = "keep_disabled" | "review_later" | "approve_trusted_prompt_only";

export interface LLMDecisionEntry {
  decision: LLMDecision;
  reason: string;
  decidedAt: string;
  source: "cli" | "control-plane";
  externalCallsMade: 0;
}

export interface LLMDecisionLog {
  schemaVersion: 1;
  generatedAt: string;
  decisions: LLMDecisionEntry[];
}

export interface RecordLLMDecisionInput {
  decision: LLMDecision;
  reason?: string;
  source?: LLMDecisionEntry["source"];
  now?: Date;
}

export const LLM_DECISION_PATH = ".visual-hive/llm-decisions.json";

const VALID_DECISIONS = new Set<LLMDecision>(["keep_disabled", "review_later", "approve_trusted_prompt_only"]);

export function llmDecisionPath(): string {
  return LLM_DECISION_PATH;
}

export async function readLLMDecisionLog(filePath: string): Promise<LLMDecisionLog | undefined> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as LLMDecisionLog;
    return {
      schemaVersion: 1,
      generatedAt: sanitizeText(parsed.generatedAt || new Date(0).toISOString()),
      decisions: Array.isArray(parsed.decisions) ? parsed.decisions.map(sanitizeEntry).filter(isLLMDecisionEntry) : []
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function recordLLMDecision(
  filePath: string,
  input: RecordLLMDecisionInput
): Promise<{ ok: true; decision: LLMDecisionEntry; decisionPath: string; summary: LLMDecisionEntry[] }> {
  if (!VALID_DECISIONS.has(input.decision)) {
    throw new Error(`Invalid LLM decision "${sanitizeText(String(input.decision))}". Expected one of: ${[...VALID_DECISIONS].join(", ")}.`);
  }
  const now = input.now ?? new Date();
  const existing = (await readLLMDecisionLog(filePath)) ?? {
    schemaVersion: 1 as const,
    generatedAt: now.toISOString(),
    decisions: []
  };
  const entry: LLMDecisionEntry = {
    decision: input.decision,
    reason: sanitizeText(input.reason || defaultReason(input.decision)),
    decidedAt: now.toISOString(),
    source: input.source ?? "cli",
    externalCallsMade: 0
  };
  const log: LLMDecisionLog = {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    decisions: [entry, ...existing.decisions]
  };
  await writeJson(filePath, log);
  return { ok: true, decision: entry, decisionPath: LLM_DECISION_PATH, summary: log.decisions };
}

function sanitizeEntry(entry: LLMDecisionEntry): LLMDecisionEntry | undefined {
  if (!entry || !VALID_DECISIONS.has(entry.decision)) return undefined;
  return {
    decision: entry.decision,
    reason: sanitizeText(entry.reason || defaultReason(entry.decision)),
    decidedAt: sanitizeText(entry.decidedAt || new Date(0).toISOString()),
    source: entry.source === "control-plane" ? "control-plane" : "cli",
    externalCallsMade: 0
  };
}

function isLLMDecisionEntry(entry: LLMDecisionEntry | undefined): entry is LLMDecisionEntry {
  return Boolean(entry);
}

function defaultReason(decision: LLMDecision): string {
  if (decision === "keep_disabled") return "LLM usage remains disabled; offline heuristics and prompt artifacts are sufficient for now.";
  if (decision === "approve_trusted_prompt_only") return "Prompt-only LLM review approved for future trusted workflow review; no model calls were made.";
  return "LLM usage left for later review.";
}
