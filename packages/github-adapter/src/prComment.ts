import type { MutationReport, Report, TriageFinding, WorkflowAuditReport } from "@visual-hive/core";
import { sanitizeMarkdown } from "./sanitize.js";

export interface PrCommentInput {
  marker?: string;
  report?: Report;
  mutationReport?: MutationReport;
  workflowAudit?: WorkflowAuditReport;
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
    `- Repository: ${report?.repository?.repository ?? "unknown"}`,
    `- Branch: ${report?.repository?.branch ?? "unknown"}`,
    `- Commit: ${report?.repository?.commitSha ? report.repository.commitSha.slice(0, 12) : "unknown"}`,
    `- Status: ${report?.status ?? "not available"}`,
    `- Contracts: ${report?.results.length ?? 0}`,
    `- Failed contracts: ${failed.length}`,
    `- Visual diffs: ${report?.summary?.visualDiffs ?? 0}`,
    `- Created baselines: ${report?.summary?.createdBaselines ?? 0}`,
    `- Console errors: ${report?.summary?.consoleErrors ?? 0}`,
    `- Mutation score: ${mutationReport ? `${Math.round(mutationReport.score * 100)}% (${mutationReport.killed}/${mutationReport.total})` : "not available"}`,
    `- Providers: ${report?.providerResults?.map((provider) => `${provider.label}=${provider.status}`).join(", ") ?? "not available"}`,
    `- Workflow safety findings: ${input.workflowAudit ? input.workflowAudit.findings.length : "not available"}`,
    `- Artifacts: ${report?.artifacts.length ?? 0}`,
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
