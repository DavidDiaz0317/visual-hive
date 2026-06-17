import type { MockProviderRunReport, MutationReport, ReadinessReport, Report, TriageFinding, WorkflowAuditReport } from "@visual-hive/core";
import { sanitizeMarkdown } from "./sanitize.js";

export interface IssueBodyInput {
  report?: Report;
  mutationReport?: MutationReport;
  providerRunReport?: MockProviderRunReport;
  readinessReport?: ReadinessReport;
  workflowAudit?: WorkflowAuditReport;
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
    `- Repository: ${report?.repository?.repository ?? "unknown"}`,
    `- Branch: ${report?.repository?.branch ?? "unknown"}`,
    `- Commit: ${report?.repository?.commitSha ? report.repository.commitSha.slice(0, 12) : "unknown"}`,
    `- Run context: ${report?.repository?.provider ?? "unknown"}`,
    `- Deterministic status: ${report?.status ?? "not available"}`,
    `- Failed contracts: ${failed.length}`,
    `- Created baselines: ${report?.summary?.createdBaselines ?? 0}`,
    `- Missing baselines: ${report?.summary?.missingBaselines ?? 0}`,
    `- Visual diffs: ${report?.summary?.visualDiffs ?? 0}`,
    `- Console errors: ${report?.summary?.consoleErrors ?? 0}`,
    `- Page errors: ${report?.summary?.pageErrors ?? 0}`,
    `- Mutation score: ${formatMutationScore(mutationReport)}`,
    `- Readiness: ${formatReadiness(input.readinessReport)}`,
    "",
    "## Failed contracts"
  ];

  if (failed.length === 0) {
    lines.push("- None reported.");
  } else {
    for (const failure of failed) {
      lines.push(`- ${failure.contractId} on ${failure.targetId}: ${failure.errors.join("; ") || "no error details"}`);
      for (const step of failure.flowSteps ?? []) {
        if (step.status === "failed") {
          lines.push(`  - flow ${step.action}: ${step.selector ?? step.route ?? step.value ?? "step"} failed${step.message ? ` - ${step.message}` : ""}`);
        }
      }
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

  lines.push("", "## Provider results");
  if (!report?.providerResults?.length) {
    lines.push("- No provider results were reported.");
  } else {
    for (const provider of report.providerResults) {
      const missing = provider.missingEnv.length ? `, missingEnv=${provider.missingEnv.join(",")}` : "";
      lines.push(`- ${provider.label}: status=${provider.status}, role=${provider.deterministicRole}, artifacts=${provider.artifactCount}${missing}`);
    }
  }

  lines.push("", "## Provider adapter evidence");
  appendProviderAdapterEvidence(lines, input.providerRunReport);

  lines.push("", "## Workflow safety");
  appendWorkflowSafety(lines, input.workflowAudit);

  lines.push("", "## Readiness gate");
  appendReadiness(lines, input.readinessReport);

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

function formatReadiness(report?: ReadinessReport): string {
  if (!report) return "not available";
  return `${report.status} (${report.score}/100, blocked=${report.summary.blocked}, warnings=${report.summary.warnings}, missing=${report.summary.missing})`;
}

function appendReadiness(lines: string[], report?: ReadinessReport): void {
  if (!report) {
    lines.push("- No readiness gate artifact was reported.");
    lines.push("- Run `visual-hive readiness` after report/security/cost/workflow artifacts to include go/no-go evidence.");
    return;
  }

  lines.push(`- Status: ${report.status}`);
  lines.push(`- Score: ${report.score}/100`);
  lines.push(`- Gates: ${report.summary.total}`);
  lines.push(`- Blocked: ${report.summary.blocked}`);
  lines.push(`- Warnings: ${report.summary.warnings}`);
  lines.push(`- Missing evidence: ${report.summary.missing}`);

  const attention = report.gates.filter((gate) => gate.status !== "passed");
  if (attention.length === 0) {
    lines.push("- All readiness gates passed.");
    return;
  }
  lines.push("- Gates needing attention:");
  for (const gate of attention.slice(0, 8)) {
    lines.push(`  - ${gate.status}/${gate.category}: ${gate.title} - ${gate.message}`);
  }
  if (attention.length > 8) {
    lines.push(`  - ${attention.length - 8} additional readiness gates omitted from issue summary.`);
  }
}

function appendProviderAdapterEvidence(lines: string[], providerRunReport?: MockProviderRunReport): void {
  if (!providerRunReport) {
    lines.push("- No provider adapter mock-results artifact was reported.");
    lines.push("- Run `visual-hive providers --mock-results` after deterministic checks to include adapter operation evidence.");
    return;
  }

  lines.push(`- Providers inspected: ${providerRunReport.summary.providerCount}`);
  lines.push(`- Mock providers: ${providerRunReport.summary.mockProviders}`);
  lines.push(`- Missing credential providers: ${providerRunReport.summary.missingCredentialProviders}`);
  lines.push(`- External deferred providers: ${providerRunReport.summary.externalDeferredProviders}`);
  lines.push(`- Failed provider operations: ${providerRunReport.summary.failedProviders}`);

  for (const provider of providerRunReport.providers.slice(0, 8)) {
    const operations = provider.operations.map((operation) => `${operation.operation}:${operation.status}`).join(", ") || "none";
    const missing = provider.missingEnv.length ? `, missingEnv=${provider.missingEnv.join(",")}` : "";
    lines.push(
      `- ${provider.label}: availability=${provider.availability}, result=${provider.result.status}, network=${provider.normalized.networkMode}, upload=${provider.normalized.artifactSummary.uploadMode}${missing}, operations=${operations}`
    );
  }
  if (providerRunReport.providers.length > 8) {
    lines.push(`- ${providerRunReport.providers.length - 8} additional provider rows omitted from issue summary.`);
  }
}

function formatMutationScore(report?: MutationReport): string {
  if (!report) {
    return "not available";
  }
  return `${Math.round(report.score * 100)}% (${report.killed}/${report.total})`;
}

function appendWorkflowSafety(lines: string[], workflowAudit?: WorkflowAuditReport): void {
  if (!workflowAudit) {
    lines.push("- No workflow safety audit was reported.");
    lines.push("- Run `visual-hive workflows` before `visual-hive triage` to include CI safety evidence.");
    return;
  }

  lines.push(`- Workflows audited: ${workflowAudit.summary.workflowCount}`);
  lines.push(`- Critical findings: ${workflowAudit.summary.criticalFindings}`);
  lines.push(`- High findings: ${workflowAudit.summary.highFindings}`);
  lines.push(`- pull_request_target workflows: ${workflowAudit.summary.workflowsUsingPullRequestTarget}`);
  lines.push(`- PR workflows using secrets: ${workflowAudit.summary.prWorkflowsUsingSecrets}`);
  lines.push(`- PR workflows with write permissions: ${workflowAudit.summary.prWorkflowsWithWritePermissions}`);
  lines.push(`- Workflows missing hidden artifact upload: ${workflowAudit.summary.workflowsMissingHiddenArtifactUpload}`);

  if (workflowAudit.findings.length === 0) {
    lines.push("- No workflow safety findings were recorded.");
    return;
  }

  lines.push("- Findings:");
  for (const finding of workflowAudit.findings.slice(0, 8)) {
    lines.push(`  - ${finding.severity}/${finding.kind} in ${finding.workflowPath}: ${finding.message}`);
  }
  if (workflowAudit.findings.length > 8) {
    lines.push(`  - ${workflowAudit.findings.length - 8} additional findings omitted from issue summary.`);
  }
}
