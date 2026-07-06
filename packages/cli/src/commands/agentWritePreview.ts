import path from "node:path";
import { loadConfig, writeAgentWritePreview, type AgentWritePreview } from "@visual-hive/core";

export interface AgentWritePreviewCommandOptions {
  config?: string;
  issues?: string;
  dedupe?: string;
  issueIndex?: number;
  allowWrite?: boolean;
  writePreviewBranch?: boolean;
  allowDirty?: boolean;
  commitPreview?: boolean;
  output?: string;
  format?: "markdown" | "json";
}

export interface AgentWritePreviewCommandResult {
  preview: AgentWritePreview;
  outputPath: string;
}

export async function runAgentWritePreviewCommand(options: AgentWritePreviewCommandOptions = {}): Promise<AgentWritePreviewCommandResult> {
  const loaded = await loadConfig(options.config, process.cwd());
  const result = await writeAgentWritePreview({
    rootDir: loaded.rootDir,
    project: loaded.config.project.name,
    issuesPath: options.issues,
    dedupeFingerprint: options.dedupe,
    issueIndex: options.issueIndex,
    allowWrite: options.allowWrite,
    writePreviewBranch: options.writePreviewBranch,
    allowDirty: options.allowDirty,
    commitPreview: options.commitPreview,
    outputPath: options.output
  });
  return {
    preview: result.preview,
    outputPath: path.relative(loaded.rootDir, result.outputPath).replaceAll(path.sep, "/")
  };
}

export function formatAgentWritePreviewResult(result: AgentWritePreviewCommandResult, format: "markdown" | "json" = "markdown"): string {
  if (format === "json") return JSON.stringify(result.preview, null, 2);
  return [
    `Wrote ${result.outputPath}`,
    "",
    `# Visual Hive Write Preview: ${result.preview.project}`,
    "",
    `- Status: ${result.preview.status}`,
    `- Mode: ${result.preview.mode}`,
    `- Issue: ${result.preview.issue.title}`,
    `- Dedupe: ${result.preview.issue.dedupeFingerprint}`,
    `- Branch: ${result.preview.branchName}`,
    `- Validation: \`${result.preview.validationCommand}\``,
    `- Branches created: ${result.preview.safety.branchesCreated}`,
    `- Commits created: ${result.preview.safety.commitsCreated}`,
    `- Pull requests opened: ${result.preview.safety.pullRequestsOpened}`,
    `- Pushes performed: ${result.preview.safety.pushesPerformed}`,
    `- Real GitHub issues created: ${result.preview.safety.realGithubIssuesCreated}`,
    ...(result.preview.blockedReasons.length ? ["", "## Blocked", ...result.preview.blockedReasons.map((reason) => `- ${reason}`)] : [])
  ].join("\n");
}
