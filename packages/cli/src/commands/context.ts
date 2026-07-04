import path from "node:path";
import { loadConfig, writeContextLedger, type ContextLedger } from "@visual-hive/core";

export interface ContextCommandOptions {
  config?: string;
  cwd?: string;
  output?: string;
  format?: "markdown" | "json";
  maxToolCalls?: number;
  maxToolResultTokens?: number;
  maxExternalCostUsd?: number;
  maxProviderScreenshots?: number;
}

export interface ContextCommandResult {
  ledger: ContextLedger;
  ledgerPath: string;
}

export async function runContextCommand(options: ContextCommandOptions = {}): Promise<ContextCommandResult> {
  const loaded = await loadConfig(options.config, options.cwd ?? process.cwd());
  return writeContextLedger({
    rootDir: loaded.rootDir,
    project: loaded.config.project.name,
    outputPath: options.output ?? path.join(".visual-hive", "context-ledger.json"),
    budgets: {
      maxToolCalls: options.maxToolCalls,
      maxToolResultTokens: options.maxToolResultTokens,
      maxExternalCostUsd: options.maxExternalCostUsd,
      maxProviderScreenshots: options.maxProviderScreenshots
    }
  });
}

export function formatContextLedger(result: ContextCommandResult, format: "markdown" | "json" = "markdown"): string {
  if (format === "json") return JSON.stringify(result.ledger, null, 2);
  const ledger = result.ledger;
  return [
    `Wrote ${result.ledgerPath}`,
    `# Context Ledger: ${ledger.project}`,
    "",
    `- Tool calls used: ${ledger.usage.toolCallsUsed}/${ledger.budgets.maxToolCalls}`,
    `- Estimated tool result tokens: ${ledger.usage.estimatedToolResultTokens}/${ledger.budgets.maxToolResultTokens}`,
    `- Estimated prompt tokens: ${ledger.usage.estimatedPromptTokens}`,
    `- Provider screenshots: ${ledger.usage.providerScreenshots}/${ledger.budgets.maxProviderScreenshots}`,
    `- External calls made: ${ledger.usage.externalCallsMade}`,
    `- Estimated external cost: $${ledger.usage.estimatedExternalCostUsd}/$${ledger.budgets.maxExternalCostUsd}`,
    `- Escalations: ${ledger.escalations.length}`,
    `- Policy violations: ${ledger.policyViolations.length}`,
    "",
    "Visual Hive's deterministic Verdict Engine remains the pass/fail authority; this ledger governs agent/tool context usage."
  ].join("\n");
}
