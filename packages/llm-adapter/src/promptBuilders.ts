import type { PromptInput } from "./types.js";

const ORACLE_NOTICE =
  "Important: LLM output is advisory only. Deterministic Playwright contracts and mutation results are the only pass/fail oracle.";

export function buildVisualFailureTriagePrompt(input: PromptInput): string {
  return buildPrompt("Visual failure triage", input, [
    "Classify likely root causes for failed visual or selector contracts.",
    "Explain what a maintainer should inspect first.",
    "Do not declare the build passing or failing; rely on deterministic report status."
  ]);
}

export function buildMissingCoverageReviewPrompt(input: PromptInput): string {
  return buildPrompt("Missing coverage review", input, [
    "Identify high-value contracts that are missing from the current report.",
    "Prefer deterministic selector, route, and screenshot checks.",
    "Avoid paid provider assumptions."
  ]);
}

export function buildMutationSurvivorReviewPrompt(input: PromptInput): string {
  return buildPrompt("Mutation survivor review", input, [
    "Review survived mutations and suggest assertions that would kill them.",
    "Map each suggestion to a route, selector, or API response contract."
  ]);
}

export function buildRepairPrompt(input: PromptInput): string {
  return buildPrompt("Repair prompt", input, [
    "Draft a concise implementation repair plan.",
    "Keep repair suggestions grounded in deterministic evidence.",
    "Suggest tests that prove the fix."
  ]);
}

function buildPrompt(title: string, input: PromptInput, tasks: string[]): string {
  return [
    `# ${title}`,
    "",
    ORACLE_NOTICE,
    "",
    "## Tasks",
    ...tasks.map((task) => `- ${task}`),
    "",
    "## Deterministic report JSON",
    "```json",
    JSON.stringify(input.report ?? null, null, 2),
    "```",
    "",
    "## Mutation report JSON",
    "```json",
    JSON.stringify(input.mutationReport ?? null, null, 2),
    "```",
    "",
    "## Offline findings",
    "```json",
    JSON.stringify(input.findings ?? [], null, 2),
    "```",
    ""
  ].join("\n");
}
