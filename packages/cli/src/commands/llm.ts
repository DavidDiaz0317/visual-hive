import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import {
  buildLLMUsageReport,
  KNOWN_LLM_PROMPT_ARTIFACTS,
  loadConfig,
  recordLLMDecision,
  sanitizeText,
  writeJson,
  type LLMDecision,
  type LLMDecisionEntry,
  type LLMPromptArtifact,
  type LLMUsageReport
} from "@visual-hive/core";

export interface LLMCommandOptions {
  config?: string;
  cwd?: string;
  format?: "markdown" | "json";
}

export interface LLMDecisionCommandOptions {
  config?: string;
  cwd?: string;
  decision: LLMDecision;
  reason?: string;
  format?: "markdown" | "json";
}

export interface LLMCommandResult {
  report: LLMUsageReport;
  reportPath: string;
  promptArtifactCount: number;
  missingPromptArtifacts: string[];
}

export interface LLMDecisionCommandResult {
  decision: LLMDecisionEntry;
  decisionPath: string;
  summary: LLMDecisionEntry[];
}

export async function runLLMCommand(options: LLMCommandOptions = {}): Promise<LLMCommandResult> {
  const cwd = options.cwd ?? process.cwd();
  const loaded = await loadConfig(options.config, cwd);
  const promptArtifacts = await readKnownPromptArtifacts(loaded.rootDir);
  const report = buildLLMUsageReport(loaded.config, promptArtifacts);
  const reportPath = path.join(loaded.rootDir, ".visual-hive", "llm-usage.json");
  await writeJson(reportPath, report);
  return {
    report,
    reportPath,
    promptArtifactCount: promptArtifacts.length,
    missingPromptArtifacts: KNOWN_LLM_PROMPT_ARTIFACTS.map((artifact) => artifact.path).filter(
      (artifactPath) => !promptArtifacts.some((prompt) => prompt.path === artifactPath)
    )
  };
}

export async function runLLMDecisionCommand(options: LLMDecisionCommandOptions): Promise<LLMDecisionCommandResult> {
  const cwd = options.cwd ?? process.cwd();
  const loaded = await loadConfig(options.config, cwd);
  return recordLLMDecision(path.join(loaded.rootDir, ".visual-hive", "llm-decisions.json"), {
    decision: options.decision,
    reason: options.reason
  });
}

export function formatLLMUsage(result: LLMCommandResult, format: "markdown" | "json" = "markdown"): string {
  if (format === "json") {
    return JSON.stringify(result.report, null, 2);
  }
  const lines = [
    `Wrote ${result.reportPath}`,
    `# LLM Governance: ${result.report.project}`,
    "",
    `- Enabled: ${result.report.governance.enabled ? "yes" : "no"}`,
    `- Provider: ${result.report.governance.provider}`,
    `- Model: ${result.report.governance.model}`,
    `- Never sole oracle: ${result.report.governance.neverSoleOracle ? "yes" : "no"}`,
    `- Prompt artifacts found: ${result.promptArtifactCount}`,
    `- Estimated tokens: ${result.report.summary.totalEstimatedTokens}`,
    `- Estimated cost: $${result.report.summary.totalEstimatedCostUsd}`,
    `- Blocked prompts: ${result.report.summary.blockedPrompts}`,
    `- External LLM calls made: ${result.report.summary.callsMade}`,
    "",
    "## Prompt Records"
  ];
  if (result.report.records.length === 0) {
    lines.push("- No prompt artifacts found. Run `visual-hive triage` to generate prompt-only artifacts first.");
  } else {
    for (const record of result.report.records) {
      lines.push(`- ${record.task}: ${record.status}, ${record.estimatedTokens} tokens, $${record.estimatedCostUsd}, ${record.path}`);
    }
  }
  if (result.missingPromptArtifacts.length) {
    lines.push("", "## Missing Prompt Artifacts", ...result.missingPromptArtifacts.map((artifactPath) => `- ${artifactPath}`));
  }
  if (result.report.warnings.length) {
    lines.push("", "## Warnings", ...result.report.warnings.map((warning) => `- ${sanitizeText(warning)}`));
  }
  if (result.report.recommendations.length) {
    lines.push("", "## Recommendations", ...result.report.recommendations.map((recommendation) => `- ${sanitizeText(recommendation)}`));
  }
  lines.push("", "LLM output is advisory only. Deterministic Playwright contracts and mutation adequacy remain the pass/fail oracle.");
  return lines.join("\n");
}

export function formatLLMDecision(result: LLMDecisionCommandResult, format: "markdown" | "json" = "markdown"): string {
  if (format === "json") {
    return JSON.stringify(
      {
        decision: result.decision,
        decisionPath: result.decisionPath,
        summary: result.summary
      },
      null,
      2
    );
  }
  return [
    `Wrote ${result.decisionPath}`,
    "# LLM Decision",
    "",
    `- Decision: ${result.decision.decision}`,
    `- External calls made: ${result.decision.externalCallsMade}`,
    `- Reason: ${result.decision.reason}`,
    "",
    "This records local governance only. It does not enable API keys, billing, model calls, uploads, or pass/fail authority."
  ].join("\n");
}

async function readKnownPromptArtifacts(rootDir: string): Promise<LLMPromptArtifact[]> {
  const artifacts: LLMPromptArtifact[] = [];
  for (const artifact of KNOWN_LLM_PROMPT_ARTIFACTS) {
    const absolutePath = path.join(rootDir, artifact.path);
    if (!(await exists(absolutePath))) {
      continue;
    }
    artifacts.push({
      task: artifact.task,
      path: artifact.path,
      content: sanitizeText(await readFile(absolutePath, "utf8"))
    });
  }
  return artifacts;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
