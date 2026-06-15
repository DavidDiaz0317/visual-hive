import type { PromptInput } from "./types.js";
import { sanitizeText } from "@visual-hive/core";

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

export function buildMissingTestsMarkdown(input: PromptInput): string {
  const suggestions = collectMissingTestSuggestions(input);
  return [
    "# Missing Test Suggestions",
    "",
    ORACLE_NOTICE,
    "",
    suggestions.length ? suggestions.join("\n\n") : "No immediate missing-test recommendation was produced from the current deterministic evidence.",
    "",
    "## Evidence Inputs",
    "",
    `- Deterministic report: ${input.report ? `${input.report.status} (${input.report.results.length} contract results)` : "missing"}`,
    `- Mutation report: ${input.mutationReport ? `${Math.round(input.mutationReport.score * 100)}% (${input.mutationReport.killed}/${input.mutationReport.total})` : "missing"}`,
    `- Coverage report: ${input.coverageReport ? `${input.coverageReport.uncoveredAreas.length} uncovered areas` : "missing"}`,
    `- Offline findings: ${input.findings?.length ?? 0}`,
    ""
  ].join("\n");
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
    safeJson(input.report ?? null),
    "```",
    "",
    "## Mutation report JSON",
    "```json",
    safeJson(input.mutationReport ?? null),
    "```",
    "",
    "## Coverage report JSON",
    "```json",
    safeJson(input.coverageReport ?? null),
    "```",
    "",
    "## Offline findings",
    "```json",
    safeJson(input.findings ?? []),
    "```",
    ""
  ].join("\n");
}

function safeJson(value: unknown): string {
  return sanitizeText(JSON.stringify(value, null, 2));
}

function collectMissingTestSuggestions(input: PromptInput): string[] {
  const suggestions: string[] = [];
  const findings = input.findings ?? [];
  for (const finding of findings) {
    if (finding.suggestedNextTests.length === 0) continue;
    suggestions.push(
      [
        `## ${sanitizeText(finding.title)}`,
        "",
        `Classification: \`${finding.classification}\``,
        "",
        "Suggested deterministic checks:",
        ...finding.suggestedNextTests.map((test) => `- ${sanitizeText(test)}`),
        "",
        finding.evidence.length ? "Evidence:" : "",
        ...finding.evidence.slice(0, 5).map((item) => `- ${sanitizeText(item)}`)
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  const createdBaselines =
    input.report?.results.flatMap((result) => result.screenshotAssertions ?? []).filter((screenshot) => screenshot.status === "created") ?? [];
  if (createdBaselines.length > 0) {
    suggestions.push(
      [
        "## Review Created Baselines",
        "",
        "Suggested deterministic checks:",
        "- Review each created baseline image in the Control Plane Baselines page.",
        "- Approve intentional baselines explicitly, then rerun `visual-hive run --ci`.",
        "",
        "Created baselines:",
        ...createdBaselines.map((screenshot) => `- ${sanitizeText(screenshot.contractId)}/${sanitizeText(screenshot.screenshotName)} at ${sanitizeText(screenshot.baselinePath)}`)
      ].join("\n")
    );
  }

  const missingMutationRun = !input.mutationReport && input.report;
  if (missingMutationRun) {
    suggestions.push(
      [
        "## Add Mutation Adequacy Signal",
        "",
        "Suggested deterministic checks:",
        "- Run `visual-hive mutate` on scheduled or manual lanes to verify that intentional UI/API breakages are caught.",
        "- Map mutation operators to the contracts that should detect them."
      ].join("\n")
    );
  }

  const report = input.report;
  if (report && report.selectedContracts.length === 0) {
    suggestions.push(
      [
        "## Add A PR-Safe Smoke Contract",
        "",
        "Suggested deterministic checks:",
        "- Add one PR-safe route screenshot for the main dashboard or landing page.",
        "- Add selector assertions for the page shell and one critical user action."
      ].join("\n")
    );
  }

  return suggestions;
}
