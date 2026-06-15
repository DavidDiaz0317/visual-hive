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
    `- Created baselines: ${report?.summary?.createdBaselines ?? 0}`,
    `- Missing baselines: ${report?.summary?.missingBaselines ?? 0}`,
    `- Visual diffs: ${report?.summary?.visualDiffs ?? 0}`,
    `- Console errors: ${report?.summary?.consoleErrors ?? 0}`,
    `- Page errors: ${report?.summary?.pageErrors ?? 0}`,
    `- Mutation score: ${formatMutationScore(mutationReport)}`,
    "",
    "## Failed contracts"
  ];

  if (failed.length === 0) {
    lines.push("- None reported.");
  } else {
    for (const failure of failed) {
      lines.push(`- ${failure.contractId} on ${failure.targetId}: ${failure.errors.join("; ") || "no error details"}`);
      for (const screenshot of failure.screenshotAssertions ?? []) {
        if (screenshot.status === "failed" || screenshot.status === "missing_baseline") {
          lines.push(
            `  - screenshot ${screenshot.name}: diffRatio=${screenshot.actualDiffPixelRatio}, actual=${screenshot.actualPath}${
              screenshot.diffPath ? `, diff=${screenshot.diffPath}` : ""
            }`
          );
        }
      }
      for (const network of failure.networkErrors ?? []) {
        lines.push(`  - network ${network.status}: ${network.url}`);
      }
    }
  }

  lines.push("", "## Target context");
  if (report?.selectedTargets.length) {
    for (const target of report.selectedTargets) {
      const missing = target.missingSecrets?.length ? `, missingSecrets=${target.missingSecrets.join(",")}` : "";
      lines.push(`- ${target.id}: kind=${target.kind}, url=${target.url}, prSafe=${target.prSafe}, cost=${target.cost}${missing}`);
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
  const artifacts = input.artifacts ?? [...new Set([...(report?.artifacts ?? []), ...(report?.results.flatMap((result) => result.artifacts) ?? [])])];
  if (artifacts.length === 0) {
    lines.push("- No artifacts were reported.");
  } else {
    for (const artifact of artifacts) {
      lines.push(`- ${artifact}`);
    }
  }

  lines.push("", "## Reproduction commands");
  for (const command of report?.reproductionCommands.length ? report.reproductionCommands : commands) {
    lines.push(`- \`${command}\``);
  }

  lines.push("", "## Mutation details");
  if (!mutationReport || mutationReport.results.length === 0) {
    lines.push("- No mutation report available.");
  } else {
    for (const result of mutationReport.results) {
      lines.push(
        `- ${result.operator}: ${result.status}, applicable=${result.applicable}, contracts=${result.contractIds.join(",") || "none"}${
          result.failureKind ? `, failureKind=${result.failureKind}` : ""
        }`
      );
    }
  }

  lines.push("", "## Likely cause classification");
  if (findings.length === 0) {
    lines.push("- No offline finding was generated.");
  } else {
    for (const finding of findings) {
      lines.push(`- ${finding.classification}: ${finding.title}`);
    }
  }

  lines.push("", "## Suggested files to inspect");
  const filesToInspect = [...new Set([...(report?.changedFiles ?? []), ...failed.map((failure) => `contracts:${failure.contractId}`)])];
  if (filesToInspect.length === 0) {
    lines.push("- No changed-file context available.");
  } else {
    for (const file of filesToInspect) {
      lines.push(`- ${file}`);
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
