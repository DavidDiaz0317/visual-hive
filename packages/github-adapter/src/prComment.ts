import type { MutationReport, Report, TriageFinding } from "@visual-hive/core";
import { sanitizeMarkdown } from "./sanitize.js";

export interface PrCommentInput {
  marker?: string;
  report?: Report;
  mutationReport?: MutationReport;
  findings?: TriageFinding[];
}

export function buildPrComment(input: PrCommentInput): string {
  const marker = input.marker ?? "<!-- visual-hive-report -->";
  const report = input.report;
  const mutationReport = input.mutationReport;
  const failed = report?.results.filter((result) => result.status === "failed") ?? [];
  const findings = input.findings ?? [];
  const lines = [
    marker,
    "## Visual Hive report",
    "",
    `- Status: ${report?.status ?? "not available"}`,
    `- Contracts: ${report?.results.length ?? 0}`,
    `- Failed contracts: ${failed.length}`,
    `- Mutation score: ${mutationReport ? `${Math.round(mutationReport.score * 100)}% (${mutationReport.killed}/${mutationReport.total})` : "not available"}`,
    "",
    "### Failed contracts"
  ];

  if (failed.length === 0) {
    lines.push("- None.");
  } else {
    for (const failure of failed) {
      lines.push(`- ${failure.contractId} on ${failure.targetId}`);
    }
  }

  lines.push("", "### Triage");
  if (findings.length === 0) {
    lines.push("- No offline findings.");
  } else {
    for (const finding of findings) {
      lines.push(`- ${finding.classification}: ${finding.title}`);
    }
  }

  return sanitizeMarkdown(`${lines.join("\n")}\n`);
}
