import { constants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import { loadConfig, readJson, writeText, type MutationReport, type Report } from "@visual-hive/core";
import { buildIssueBody } from "@visual-hive/github-adapter";
import { buildMutationSurvivorReviewPrompt, buildRepairPrompt, buildVisualFailureTriagePrompt, classifyOffline } from "@visual-hive/llm-adapter";

export interface TriageCommandOptions {
  config?: string;
  cwd?: string;
}

export async function runTriageCommand(options: TriageCommandOptions = {}): Promise<{ promptPath: string; issuePath: string; findingCount: number }> {
  const cwd = options.cwd ?? process.cwd();
  const loaded = await loadConfig(options.config, cwd);
  const report = await readOptionalJson<Report>(path.join(loaded.rootDir, ".visual-hive", "report.json"));
  const mutationReport = await readOptionalJson<MutationReport>(path.join(loaded.rootDir, ".visual-hive", "mutation-report.json"));
  const findings = classifyOffline({ report, mutationReport });
  const prompt = [
    buildVisualFailureTriagePrompt({ report, mutationReport, findings }),
    buildMutationSurvivorReviewPrompt({ report, mutationReport, findings }),
    buildRepairPrompt({ report, mutationReport, findings })
  ].join("\n---\n");
  const issue = buildIssueBody({ report, mutationReport, findings });
  const promptPath = path.join(loaded.rootDir, ".visual-hive", "triage-prompt.md");
  const issuePath = path.join(loaded.rootDir, ".visual-hive", "issue.md");
  await writeText(promptPath, prompt);
  await writeText(issuePath, issue);
  return { promptPath, issuePath, findingCount: findings.length };
}

async function readOptionalJson<T>(filePath: string): Promise<T | undefined> {
  try {
    await access(filePath, constants.F_OK);
  } catch {
    return undefined;
  }
  return readJson<T>(filePath);
}
