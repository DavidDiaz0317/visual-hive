import { readFile } from "node:fs/promises";
import { getEvidenceResourceById } from "../tools/evidenceResources.js";
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

export interface ProviderDecisionLogOutputResource {
  artifactPath: string;
  evidenceResourceId: string;
  evidenceResourceUri: string;
  evidenceResourceTitle: string;
  evidenceResourceDescription: string;
  evidenceReadToolName?: string;
}

export interface ProviderDecisionLog {
  schemaVersion: 1;
  generatedAt: string;
  outputResource?: ProviderDecisionLogOutputResource;
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
      outputResource: parsed.outputResource ? sanitizeOutputResource(parsed.outputResource) : catalogedProviderDecisionLogOutputResource(),
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
    outputResource: catalogedProviderDecisionLogOutputResource(),
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
    outputResource: catalogedProviderDecisionLogOutputResource(),
    decisions
  };
  await writeJson(filePath, log);
  return { ok: true, decision: entry, decisionPath: PROVIDER_DECISION_PATH, summary: decisions };
}

export function catalogedProviderDecisionLogOutputResource(): NonNullable<ProviderDecisionLog["outputResource"]> {
  const resource = getEvidenceResourceById("provider-decisions");
  return {
    artifactPath: PROVIDER_DECISION_PATH,
    evidenceResourceId: resource?.id ?? "provider-decisions",
    evidenceResourceUri: resource?.uri ?? "visual-hive://provider-decisions",
    evidenceResourceTitle: resource?.title ?? "Provider Decisions",
    evidenceResourceDescription: resource?.description ?? "Local optional provider governance decisions. Read-only; does not enable credentials, uploads, or provider gating.",
    evidenceReadToolName: resource?.readTool?.name ?? "visual_hive_read_provider_decisions"
  };
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

function sanitizeOutputResource(outputResource: ProviderDecisionLogOutputResource): ProviderDecisionLogOutputResource {
  const fallback = catalogedProviderDecisionLogOutputResource();
  return {
    artifactPath: sanitizeText(outputResource.artifactPath || fallback.artifactPath),
    evidenceResourceId: sanitizeText(outputResource.evidenceResourceId || fallback.evidenceResourceId),
    evidenceResourceUri: sanitizeText(outputResource.evidenceResourceUri || fallback.evidenceResourceUri),
    evidenceResourceTitle: sanitizeText(outputResource.evidenceResourceTitle || fallback.evidenceResourceTitle),
    evidenceResourceDescription: sanitizeText(outputResource.evidenceResourceDescription || fallback.evidenceResourceDescription),
    evidenceReadToolName: outputResource.evidenceReadToolName ? sanitizeText(outputResource.evidenceReadToolName) : fallback.evidenceReadToolName
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
