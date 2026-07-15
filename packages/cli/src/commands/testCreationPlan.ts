import { realpath } from "node:fs/promises";
import path from "node:path";
import { loadConfig, readJson, writeTestCreationPlan, type RepoMapReport, type TestCreationPlan } from "@visual-hive/core";
import { z } from "zod";

const GroundingRepoMapNodeSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  label: z.string(),
  status: z.string().min(1),
  provenance: z.object({ source: z.string().min(1), confidence: z.string().min(1) }).passthrough(),
  sourceFiles: z.array(z.string()),
  routes: z.array(z.string()),
  states: z.array(z.string()),
  viewports: z.array(z.string()),
  selectors: z.array(z.string()),
  targetIds: z.array(z.string()),
  contractIds: z.array(z.string()),
  screenshotNames: z.array(z.string()),
  mutationOperators: z.array(z.string()),
  coverageGapIds: z.array(z.string())
}).passthrough();

const GroundingRepoMapSchema = z.object({
  schemaVersion: z.literal(1),
  repoRoot: z.string().min(1),
  visualMap: z.object({
    schemaVersion: z.literal(1),
    nodes: z.array(GroundingRepoMapNodeSchema)
  }).passthrough()
}).passthrough();

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
  const repoMap = await readOptionalRepoMap(path.join(loaded.rootDir, ".visual-hive", "repo-map.json"), loaded.rootDir);
  return writeTestCreationPlan({
    rootDir: loaded.rootDir,
    project: loaded.config.project.name,
    config: loaded.config,
    repoMap,
    evidencePacketPath: options.evidence ?? path.join(".visual-hive", "evidence-packet.json"),
    coverageRecommendationsPath: options.coverageRecommendations ?? path.join(".visual-hive", "coverage-recommendations.json"),
    handoffPacketPath: options.handoff ?? path.join(".visual-hive", "handoff.json"),
    outputPath: options.output ?? path.join(".visual-hive", "test-creation-plan.json"),
    markdownPath: options.markdown ?? path.join(".visual-hive", "test-creation-plan.md")
  });
}

async function readOptionalRepoMap(filePath: string, rootDir: string): Promise<RepoMapReport | undefined> {
  let value: unknown;
  try {
    value = await readJson<unknown>(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error(`Visual Hive could not read repository-map grounding evidence at ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (value && typeof value === "object" && !Array.isArray(value) && !("visualMap" in value)) return undefined;
  const parsed = GroundingRepoMapSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Visual Hive repository-map grounding evidence is invalid; rerun visual-hive analyze (${parsed.error.issues[0]?.message ?? "invalid shape"}).`);
  }
  const [expectedRoot, declaredRoot] = await Promise.all([
    realpath(path.resolve(rootDir)),
    realpath(path.resolve(rootDir, parsed.data.repoRoot)).catch(() => undefined)
  ]);
  if (!declaredRoot || path.relative(expectedRoot, declaredRoot) !== "") {
    throw new Error("Visual Hive repository-map grounding evidence does not belong to the loaded repository root; rerun visual-hive analyze.");
  }
  return value as RepoMapReport;
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
