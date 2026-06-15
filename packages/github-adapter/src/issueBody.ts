import type { MutationReport, Report, TriageFinding } from "@visual-hive/core";
import { sanitizeMarkdown } from "./sanitize.js";

export interface IssueBodyInput {
  report?: Report;
  mutationReport?: MutationReport;
  findings?: TriageFinding[];
  reproductionCommands?: string[];
  artifacts?: string[];
}

export function buildIssueBody(input: IssueBodyInput): string {
  const report = input.report;
  const mutationReport = input.mutationReport;
  const failed = report?.results.filter((result) => result.status === "failed") ?? [];
  const findings = input.findings ?? [];
  const commands = input.reproductionCommands ?? [
    "visual-hive plan --mode pr --changed-files changed-files.txt",
    "visual-hive run --ci",
    "visual-hive triage"
  ];

  const lines: string[] = [
    "# Visual Hive failure report",
    "",
    "## Summary",
    `- Project: ${report?.project ?? mutationReport?.project ?? "unknown"}`,
    `- Deterministic status: ${report?.status ?? "not available"}`,
    `- Failed contracts: ${failed.length}`,
    `- Mutation score: ${formatMutationScore(mutationReport)}`,
    "",
    "## Failed contracts"
  ];

  if (failed.length === 0) {
    lines.push("- None reported.");
  } else {
    for (const failure of failed) {
      lines.push(`- ${failure.contractId} on ${failure.targetId}: ${failure.errors.join("; ") || "no error details"}`);
    }
  }

  lines.push("", "## Target context");
  if (report?.results.length) {
    for (const result of report.results) {
      lines.push(`- ${result.contractId}: target=${result.targetId}, status=${result.status}, durationMs=${result.durationMs}`);
    }
  } else {
    lines.push("- No deterministic target context available.");
  }

  lines.push("", "## Changed files");
  if (report?.changedFiles.length) {
    for (const file of report.changedFiles) {
      lines.push(`- ${file}`);
    }
  } else {
    lines.push("- No changed files were provided.");
  }

  lines.push("", "## Artifacts");
  const artifacts = input.artifacts ?? [...new Set(report?.results.flatMap((result) => result.artifacts) ?? [])];
  if (artifacts.length === 0) {
    lines.push("- No artifacts were reported.");
  } else {
    for (const artifact of artifacts) {
      lines.push(`- ${artifact}`);
    }
  }

  lines.push("", "## Reproduction commands");
  for (const command of commands) {
    lines.push(`- \`${command}\``);
  }

  lines.push("", "## Likely cause classification");
  if (findings.length === 0) {
    lines.push("- No offline finding was generated.");
  } else {
    for (const finding of findings) {
      lines.push(`- ${finding.classification}: ${finding.title}`);
    }
  }

  lines.push("", "## Suggested next tests");
  const suggestions = findings.flatMap((finding) => finding.suggestedNextTests);
  if (suggestions.length === 0) {
    lines.push("- Add a focused contract for any failed route or missing UI assertion.");
  } else {
    for (const suggestion of [...new Set(suggestions)]) {
      lines.push(`- ${suggestion}`);
    }
  }

  return sanitizeMarkdown(`${lines.join("\n")}\n`);
}

function formatMutationScore(report?: MutationReport): string {
  if (!report) {
    return "not available";
  }
  return `${Math.round(report.score * 100)}% (${report.killed}/${report.total})`;
}
