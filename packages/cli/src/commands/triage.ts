import { constants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import {
  buildLLMUsageReport,
  loadConfig,
  readJson,
  writeJson,
  writeText,
  type MutationReport,
  type Report,
  type CoverageReport,
  type WorkflowAuditReport
} from "@visual-hive/core";
import { buildIssueBody, buildPrComment } from "@visual-hive/github-adapter";
import {
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
  repairPromptPath: string;
  missingTestsPath: string;
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
  const workflowAudit = await readOptionalJson<WorkflowAuditReport>(path.join(loaded.rootDir, ".visual-hive", "workflows.json"));
  const findings = classifyOffline({ report, mutationReport, coverageReport });
  const prompt = [
    buildVisualFailureTriagePrompt({ report, mutationReport, coverageReport, findings }),
    buildMutationSurvivorReviewPrompt({ report, mutationReport, coverageReport, findings }),
    buildMissingCoverageReviewPrompt({ report, mutationReport, coverageReport, findings })
  ].join("\n---\n");
  const repairPrompt = buildRepairPrompt({ report, mutationReport, coverageReport, findings });
  const missingTests = buildMissingTestsMarkdown({ report, mutationReport, coverageReport, findings });
  const issue = buildIssueBody({ report, mutationReport, workflowAudit, findings });
  const prComment = buildPrComment({ marker: loaded.config.github.commentMarker, report, mutationReport, workflowAudit, findings });
  const promptPath = path.join(loaded.rootDir, ".visual-hive", "triage-prompt.md");
  const repairPromptPath = path.join(loaded.rootDir, ".visual-hive", "repair-prompt.md");
  const missingTestsPath = path.join(loaded.rootDir, ".visual-hive", "missing-tests.md");
  const issuePath = path.join(loaded.rootDir, ".visual-hive", "issue.md");
  const prCommentPath = path.join(loaded.rootDir, ".visual-hive", "pr-comment.md");
  const llmUsagePath = path.join(loaded.rootDir, ".visual-hive", "llm-usage.json");
  await writeText(promptPath, prompt);
  await writeText(repairPromptPath, repairPrompt);
  await writeText(missingTestsPath, missingTests);
  await writeText(issuePath, issue);
  await writeText(prCommentPath, prComment);
  await writeJson(
    llmUsagePath,
    buildLLMUsageReport(loaded.config, [
      { task: "visual_failure_triage", path: path.relative(loaded.rootDir, promptPath), content: prompt },
      { task: "repair_prompt", path: path.relative(loaded.rootDir, repairPromptPath), content: repairPrompt },
      { task: "missing_tests", path: path.relative(loaded.rootDir, missingTestsPath), content: missingTests },
      { task: "issue_draft", path: path.relative(loaded.rootDir, issuePath), content: issue }
    ])
  );
  return { promptPath, repairPromptPath, missingTestsPath, issuePath, prCommentPath, llmUsagePath, findingCount: findings.length };
}

async function readOptionalJson<T>(filePath: string): Promise<T | undefined> {
  try {
    await access(filePath, constants.F_OK);
  } catch {
    return undefined;
  }
  return readJson<T>(filePath);
}
