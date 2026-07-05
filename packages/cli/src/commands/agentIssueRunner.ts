import path from "node:path";
import {
  loadConfig,
  writeAgentIssueRun,
  type AgentIssueRun,
  type AgentIssueRunArtifacts
} from "@visual-hive/core";

export interface AgentIssueRunnerCommandOptions {
  config?: string;
  cwd?: string;
  issues?: string;
  dedupe?: string;
  issueIndex?: number;
  kind?: string;
  outputDir?: string;
  allowWrite?: boolean;
  codexCommand?: string;
  maxRuntimeMs?: number;
  maxToolCalls?: number;
  maxPromptTokens?: number;
  format?: "markdown" | "json";
}

export interface AgentIssueRunnerCommandResult {
  run: AgentIssueRun;
  requestMarkdown: string;
  outputMarkdown: string;
  requestPath: string;
  outputPath: string;
  runPath: string;
}

export async function runAgentIssueRunnerCommand(options: AgentIssueRunnerCommandOptions = {}): Promise<AgentIssueRunnerCommandResult> {
  const loaded = await loadConfig(options.config, options.cwd ?? process.cwd());
  const result = await writeAgentIssueRun({
    rootDir: loaded.rootDir,
    project: loaded.config.project.name,
    issuesPath: options.issues,
    dedupeFingerprint: options.dedupe,
    issueIndex: options.issueIndex,
    kind: options.kind,
    outputDir: options.outputDir,
    allowWrite: options.allowWrite,
    codexCommand: options.codexCommand,
    maxRuntimeMs: options.maxRuntimeMs,
    maxToolCalls: options.maxToolCalls,
    maxPromptTokens: options.maxPromptTokens
  });
  return normalizePaths(result, loaded.rootDir);
}

export function formatAgentIssueRunnerResult(result: AgentIssueRunnerCommandResult, format: "markdown" | "json" = "markdown"): string {
  if (format === "json") {
    return JSON.stringify(result.run, null, 2);
  }
  return [
    `Wrote ${result.requestPath}`,
    `Wrote ${result.outputPath}`,
    `Wrote ${result.runPath}`,
    "",
    `# Visual Hive Issue Agent Run: ${result.run.project}`,
    "",
    `- Status: ${result.run.status}`,
    `- Mode: ${result.run.mode}`,
    `- Profile: ${result.run.profile}`,
    `- Issue: ${result.run.selectedIssue.title}`,
    `- Dedupe: ${result.run.selectedIssue.dedupeFingerprint}`,
    `- Validation: \`${result.run.parsedIssue.validationCommand}\``,
    `- Allow write: ${result.run.budgets.allowWrite}`,
    `- External network allowed: ${result.run.budgets.allowExternalNetwork}`,
    `- External calls made: ${result.run.safety.externalCallsMade}`,
    `- Real GitHub issues created: ${result.run.safety.realGithubIssuesCreated}`,
    "",
    "## Recommendations",
    ...result.run.recommendations.map((recommendation) => `- ${recommendation}`)
  ].join("\n");
}

function normalizePaths(result: AgentIssueRunArtifacts, rootDir: string): AgentIssueRunnerCommandResult {
  return {
    ...result,
    requestPath: relative(rootDir, result.requestPath),
    outputPath: relative(rootDir, result.outputPath),
    runPath: relative(rootDir, result.runPath)
  };
}

function relative(rootDir: string, filePath: string): string {
  return path.relative(rootDir, filePath).replaceAll(path.sep, "/");
}
