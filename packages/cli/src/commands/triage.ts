import { constants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import {
  buildLLMUsageReport,
  buildTriageReport,
  loadConfig,
  readJson,
  writeJson,
  writeText,
  type MutationReport,
  type MockProviderRunReport,
  type ReadinessReport,
  type Report,
  type CoverageReport,
  type WorkflowAuditReport,
  type BaselineApprovalLog,
  type BaselineRejectionLog
} from "@visual-hive/core";
import { buildIssueBody, buildPrComment } from "@visual-hive/github-adapter";
import {
  buildBaselineReviewSummaryMarkdown,
  buildMissingCoverageReviewPrompt,
  buildMissingTestsMarkdown,
  buildMutationSurvivorReviewPrompt,
  buildRepairPrompt,
  buildVisualFailureTriagePrompt,
  classifyOffline
} from "@visual-hive/llm-adapter";

export interface TriageCommandOptions {
  config?: string;
  cwd?: string;
}

export async function runTriageCommand(options: TriageCommandOptions = {}): Promise<{
  promptPath: string;
  triageReportPath: string;
  repairPromptPath: string;
  missingTestsPath: string;
  baselineReviewPath: string;
  issuePath: string;
  prCommentPath: string;
  llmUsagePath: string;
  findingCount: number;
}> {
  const cwd = options.cwd ?? process.cwd();
  const loaded = await loadConfig(options.config, cwd);
  const report = await readOptionalJson<Report>(path.join(loaded.rootDir, ".visual-hive", "report.json"));
  const mutationReport = await readOptionalJson<MutationReport>(path.join(loaded.rootDir, ".visual-hive", "mutation-report.json"));
  const coverageReport = await readOptionalJson<CoverageReport>(path.join(loaded.rootDir, ".visual-hive", "coverage.json"));
  const providerRunReport = await readOptionalJson<MockProviderRunReport>(path.join(loaded.rootDir, ".visual-hive", "provider-results.json"));
  const readinessReport = await readOptionalJson<ReadinessReport>(path.join(loaded.rootDir, ".visual-hive", "readiness.json"));
  const workflowAudit = await readOptionalJson<WorkflowAuditReport>(path.join(loaded.rootDir, ".visual-hive", "workflows.json"));
  const baselineApprovalLog = await readOptionalJson<BaselineApprovalLog>(path.join(loaded.rootDir, ".visual-hive", "baseline-approvals.json"));
  const baselineRejectionLog = await readOptionalJson<BaselineRejectionLog>(path.join(loaded.rootDir, ".visual-hive", "baseline-rejections.json"));
  const findings = classifyOffline({ report, mutationReport, coverageReport, providerRunReport, baselineApprovalLog, baselineRejectionLog });
  const triageReport = buildTriageReport({
    project: loaded.config.project.name,
    findings,
    sourceArtifacts: {
      report: report ? ".visual-hive/report.json" : undefined,
      mutationReport: mutationReport ? ".visual-hive/mutation-report.json" : undefined,
      coverageReport: coverageReport ? ".visual-hive/coverage.json" : undefined,
      providerResults: providerRunReport ? ".visual-hive/provider-results.json" : undefined,
      baselineApprovals: baselineApprovalLog ? ".visual-hive/baseline-approvals.json" : undefined,
      baselineRejections: baselineRejectionLog ? ".visual-hive/baseline-rejections.json" : undefined
    }
  });
  const prompt = [
    buildVisualFailureTriagePrompt({ report, mutationReport, coverageReport, providerRunReport, baselineApprovalLog, baselineRejectionLog, findings }),
    buildMutationSurvivorReviewPrompt({ report, mutationReport, coverageReport, providerRunReport, baselineApprovalLog, baselineRejectionLog, findings }),
    buildMissingCoverageReviewPrompt({ report, mutationReport, coverageReport, providerRunReport, baselineApprovalLog, baselineRejectionLog, findings })
  ].join("\n---\n");
  const repairPrompt = buildRepairPrompt({ report, mutationReport, coverageReport, providerRunReport, baselineApprovalLog, baselineRejectionLog, findings });
  const missingTests = buildMissingTestsMarkdown({ report, mutationReport, coverageReport, providerRunReport, baselineApprovalLog, baselineRejectionLog, findings });
  const baselineReview = buildBaselineReviewSummaryMarkdown({ report, mutationReport, coverageReport, providerRunReport, baselineApprovalLog, baselineRejectionLog, findings });
  const issue = buildIssueBody({ report, mutationReport, readinessReport, providerRunReport, workflowAudit, findings });
  const prComment = buildPrComment({ marker: loaded.config.github.commentMarker, report, mutationReport, readinessReport, providerRunReport, workflowAudit, findings });
  const triageReportPath = path.join(loaded.rootDir, ".visual-hive", "triage.json");
  const promptPath = path.join(loaded.rootDir, ".visual-hive", "triage-prompt.md");
  const repairPromptPath = path.join(loaded.rootDir, ".visual-hive", "repair-prompt.md");
  const missingTestsPath = path.join(loaded.rootDir, ".visual-hive", "missing-tests.md");
  const baselineReviewPath = path.join(loaded.rootDir, ".visual-hive", "baseline-review.md");
  const issuePath = path.join(loaded.rootDir, ".visual-hive", "issue.md");
  const prCommentPath = path.join(loaded.rootDir, ".visual-hive", "pr-comment.md");
  const llmUsagePath = path.join(loaded.rootDir, ".visual-hive", "llm-usage.json");
  await writeJson(triageReportPath, triageReport);
  await writeText(promptPath, prompt);
  await writeText(repairPromptPath, repairPrompt);
  await writeText(missingTestsPath, missingTests);
  await writeText(baselineReviewPath, baselineReview);
  await writeText(issuePath, issue);
  await writeText(prCommentPath, prComment);
  await writeJson(
    llmUsagePath,
    buildLLMUsageReport(loaded.config, [
      { task: "visual_failure_triage", path: path.relative(loaded.rootDir, promptPath), content: prompt },
      { task: "repair_prompt", path: path.relative(loaded.rootDir, repairPromptPath), content: repairPrompt },
      { task: "missing_tests", path: path.relative(loaded.rootDir, missingTestsPath), content: missingTests },
      { task: "baseline_review_summary", path: path.relative(loaded.rootDir, baselineReviewPath), content: baselineReview },
      { task: "issue_draft", path: path.relative(loaded.rootDir, issuePath), content: issue }
    ])
  );
  return {
    promptPath,
    triageReportPath,
    repairPromptPath,
    missingTestsPath,
    baselineReviewPath,
    issuePath,
    prCommentPath,
    llmUsagePath,
    findingCount: findings.length
  };
}

async function readOptionalJson<T>(filePath: string): Promise<T | undefined> {
  try {
    await access(filePath, constants.F_OK);
  } catch {
    return undefined;
  }
  return readJson<T>(filePath);
}
