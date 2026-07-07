import path from "node:path";
import {
  loadConfig,
  validateAgentArtifacts,
  type AgentArtifactsValidationReport
} from "@visual-hive/core";

export interface AgentValidateCommandOptions {
  config?: string;
  cwd?: string;
  agentsDir?: string;
  dedupe?: string;
  allowWriteArtifacts?: boolean;
  output?: string;
  format?: "markdown" | "json";
}

export interface AgentValidateCommandResult {
  report: AgentArtifactsValidationReport;
  outputPath?: string;
}

export async function runAgentValidateCommand(options: AgentValidateCommandOptions = {}): Promise<AgentValidateCommandResult> {
  const loaded = await loadConfig(options.config, options.cwd ?? process.cwd());
  const result = await validateAgentArtifacts({
    rootDir: loaded.rootDir,
    agentsDir: options.agentsDir,
    dedupeFingerprint: options.dedupe,
    allowWriteArtifacts: options.allowWriteArtifacts,
    outputPath: options.output ?? ".visual-hive/agent-validation.json"
  });
  return {
    report: result.report,
    outputPath: result.outputPath ? path.relative(loaded.rootDir, result.outputPath).replaceAll(path.sep, "/") : undefined
  };
}

export function formatAgentValidateResult(result: AgentValidateCommandResult, format: "markdown" | "json" = "markdown"): string {
  if (format === "json") return JSON.stringify(result.report, null, 2);
  const lines = [
    ...(result.outputPath ? [`Wrote ${result.outputPath}`, ""] : []),
    "# Visual Hive Agent Artifact Validation",
    "",
    `- Status: ${result.report.status}`,
    `- Agent runs: ${result.report.summary.agentRuns}`,
    `- Passed: ${result.report.summary.passed}`,
    `- Failed: ${result.report.summary.failed}`,
    `- Forbidden action failures: ${result.report.summary.forbiddenActionFailures}`,
    "",
    "## Runs",
    ...result.report.items.map((item) => {
      const failedChecks = item.checks.filter((check) => check.status === "failed");
      return `- ${item.status}: ${item.dedupeFingerprint} (${item.profile}, ${item.mode})${failedChecks.length ? ` - failed checks: ${failedChecks.map((check) => check.id).join(", ")}` : ""}`;
    })
  ];
  return lines.join("\n");
}
