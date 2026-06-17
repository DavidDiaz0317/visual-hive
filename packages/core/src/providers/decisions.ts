import { readFile } from "node:fs/promises";
import { sanitizeText } from "../utils/sanitize.js";
import { writeJson } from "../utils/files.js";

export type ProviderDecision = "skip" | "review_later" | "approve_trusted_setup";

export interface ProviderDecisionEntry {
  providerId: string;
  label?: string;
  decision: ProviderDecision;
  reason: string;
  decidedAt: string;
  source: "cli" | "control-plane";
  externalCallsMade: 0;
}

export interface ProviderDecisionLog {
  schemaVersion: 1;
  generatedAt: string;
  decisions: ProviderDecisionEntry[];
}

export interface RecordProviderDecisionInput {
  providerId: string;
  label?: string;
  decision: ProviderDecision;
  reason?: string;
  source?: ProviderDecisionEntry["source"];
  now?: Date;
}

export const PROVIDER_DECISION_PATH = ".visual-hive/provider-decisions.json";

const VALID_DECISIONS = new Set<ProviderDecision>(["skip", "review_later", "approve_trusted_setup"]);

export function providerDecisionPath(): string {
  return PROVIDER_DECISION_PATH;
}

export async function readProviderDecisionLog(filePath: string): Promise<ProviderDecisionLog | undefined> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as ProviderDecisionLog;
    return {
      schemaVersion: 1,
      generatedAt: sanitizeText(parsed.generatedAt || new Date(0).toISOString()),
      decisions: Array.isArray(parsed.decisions) ? parsed.decisions.map(sanitizeEntry).filter(isProviderDecisionEntry) : []
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function recordProviderDecision(
  filePath: string,
  input: RecordProviderDecisionInput
): Promise<{ ok: true; decision: ProviderDecisionEntry; decisionPath: string; summary: ProviderDecisionLog["decisions"] }> {
  const now = input.now ?? new Date();
  const providerId = sanitizeProviderId(input.providerId);
  if (!VALID_DECISIONS.has(input.decision)) {
    throw new Error(`Invalid provider decision "${sanitizeText(String(input.decision))}". Expected one of: ${[...VALID_DECISIONS].join(", ")}.`);
  }
  const existing = (await readProviderDecisionLog(filePath)) ?? {
    schemaVersion: 1 as const,
    generatedAt: now.toISOString(),
    decisions: []
  };
  const entry: ProviderDecisionEntry = {
    providerId,
    label: input.label ? sanitizeText(input.label) : undefined,
    decision: input.decision,
    reason: sanitizeText(input.reason || defaultReason(input.decision)),
    decidedAt: now.toISOString(),
    source: input.source ?? "cli",
    externalCallsMade: 0
  };
  const decisions = [entry, ...existing.decisions.filter((decision) => decision.providerId !== providerId)];
  const log: ProviderDecisionLog = {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    decisions
  };
  await writeJson(filePath, log);
  return { ok: true, decision: entry, decisionPath: PROVIDER_DECISION_PATH, summary: decisions };
}

function sanitizeProviderId(providerId: string): string {
  const sanitized = sanitizeText(providerId).trim();
  if (!/^[a-z0-9_-]{2,64}$/i.test(sanitized)) {
    throw new Error(`Invalid provider id "${sanitized}".`);
  }
  return sanitized;
}

function sanitizeEntry(entry: ProviderDecisionEntry): ProviderDecisionEntry | undefined {
  if (!entry || typeof entry.providerId !== "string" || !VALID_DECISIONS.has(entry.decision)) return undefined;
  return {
    providerId: sanitizeText(entry.providerId),
    label: entry.label ? sanitizeText(entry.label) : undefined,
    decision: entry.decision,
    reason: sanitizeText(entry.reason || defaultReason(entry.decision)),
    decidedAt: sanitizeText(entry.decidedAt || new Date(0).toISOString()),
    source: entry.source === "control-plane" ? "control-plane" : "cli",
    externalCallsMade: 0
  };
}

function isProviderDecisionEntry(entry: ProviderDecisionEntry | undefined): entry is ProviderDecisionEntry {
  return Boolean(entry);
}

function defaultReason(decision: ProviderDecision): string {
  if (decision === "skip") return "Provider skipped for now; local Playwright artifacts remain the default path.";
  if (decision === "approve_trusted_setup") return "Provider approved for future trusted setup review only; no external calls were made.";
  return "Provider left for later review.";
}
