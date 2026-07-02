import path from "node:path";
import { loadConfig, writeTestCreationPlan, type TestCreationPlan } from "@visual-hive/core";

export interface TestCreationPlanCommandOptions {
  config?: string;
  cwd?: string;
  evidence?: string;
  coverageRecommendations?: string;
  handoff?: string;
  output?: string;
  markdown?: string;
  format?: "markdown" | "json";
}

export interface TestCreationPlanCommandResult {
  plan: TestCreationPlan;
  planPath: string;
  markdownPath: string;
}

export async function runTestCreationPlanCommand(options: TestCreationPlanCommandOptions = {}): Promise<TestCreationPlanCommandResult> {
  const loaded = await loadConfig(options.config, options.cwd ?? process.cwd());
  return writeTestCreationPlan({
    rootDir: loaded.rootDir,
    project: loaded.config.project.name,
    evidencePacketPath: options.evidence ?? path.join(".visual-hive", "evidence-packet.json"),
    coverageRecommendationsPath: options.coverageRecommendations ?? path.join(".visual-hive", "coverage-recommendations.json"),
    handoffPacketPath: options.handoff ?? path.join(".visual-hive", "handoff.json"),
    outputPath: options.output ?? path.join(".visual-hive", "test-creation-plan.json"),
    markdownPath: options.markdown ?? path.join(".visual-hive", "test-creation-plan.md")
  });
}

export function formatTestCreationPlan(result: TestCreationPlanCommandResult, format: "markdown" | "json" = "markdown"): string {
  if (format === "json") return JSON.stringify(result.plan, null, 2);
  return [
    `Wrote ${result.planPath}`,
    `Wrote ${result.markdownPath}`,
    "",
    `# Test Creation Plan: ${result.plan.project}`,
    "",
    `- Recommendations: ${result.plan.summary.total}`,
    `- High: ${result.plan.summary.high}`,
    `- Medium: ${result.plan.summary.medium}`,
    `- Low: ${result.plan.summary.low}`,
    `- From testing layers: ${result.plan.summary.fromTestingLayers}`,
    `- From coverage recommendations: ${result.plan.summary.fromCoverageRecommendations}`,
    `- From mutation survivors: ${result.plan.summary.fromMutationSurvivors}`,
    `- From handoff work items: ${result.plan.summary.fromHandoffWorkItems}`,
    `- Write policy: ${result.plan.governance.writePolicy}`
  ].join("\n");
}
