import path from "node:path";
import {
  collectRepositoryMetadata,
  catalogedReportOutputResource,
  loadConfig,
  normalizeProviderResults,
  readJson,
  sanitizeText,
  writeJson,
  type Plan,
  type Report,
  type VisualHiveConfig
} from "@visual-hive/core";
import { runPlaywrightContracts } from "@visual-hive/playwright-adapter";
import { isIntentionalIgnoredFilesPlan } from "./plan.js";

export interface RunCommandOptions {
  config?: string;
  cwd?: string;
  ci?: boolean;
  plan?: string;
  skipInstall?: boolean;
  skipBuild?: boolean;
}

export async function runDeterministicCommand(options: RunCommandOptions = {}): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const loaded = await loadConfig(options.config, cwd);
  const planPath = path.resolve(loaded.rootDir, options.plan ?? path.join(".visual-hive", "plan.json"));
  const plan = await readJson<Plan>(planPath);
  if (plan.items.length === 0) {
    if (isIntentionalIgnoredFilesPlan(plan)) {
      const report = await createIgnoredFilesReport(loaded.config, plan, loaded.rootDir);
      await writeJson(path.join(loaded.rootDir, ".visual-hive", "report.json"), report);
      return 0;
    }
    throw new Error(`No contracts selected in ${planPath}. Run "visual-hive plan" with matching runOn settings or changed files before "visual-hive run".`);
  }
  const { report, exitCode } = await runPlaywrightContracts({
    config: loaded.config,
    plan,
    rootDir: loaded.rootDir,
    ci: options.ci,
    skipInstall: options.skipInstall,
    skipBuild: options.skipBuild
  });
  await writeJson(path.join(loaded.rootDir, ".visual-hive", "report.json"), report);
  return exitCode || (report.status === "failed" ? 1 : 0);
}

async function createIgnoredFilesReport(config: VisualHiveConfig, plan: Plan, rootDir: string): Promise<Report> {
  const repository = await collectRepositoryMetadata({ repoRoot: rootDir });
  const generatedSpecPath = path.join(rootDir, ".visual-hive", "generated", "visual-hive.generated.spec.ts");
  const reason = sanitizeText(`No deterministic contracts were run because all changed files matched selection.ignoreChangedFiles: ${plan.ignoredChangedFiles
    .map((entry) => `${entry.file} (${entry.pattern})`)
    .join(", ")}`);
  return {
    schemaVersion: 2,
    project: config.project.name,
    outputResource: catalogedReportOutputResource(),
    repository,
    mode: plan.mode,
    generatedAt: new Date().toISOString(),
    status: "passed",
    changedFiles: plan.changedFiles,
    selectedTargets: [],
    selectedContracts: [],
    excludedContracts: plan.excluded,
    targetLifecycle: [],
    generatedSpecPath,
    results: [],
    summary: {
      passed: 0,
      failed: 0,
      screenshotsPassed: 0,
      screenshotsFailed: 0,
      baselinesCreated: 0,
      createdBaselines: 0,
      missingBaselines: 0,
      visualDiffs: 0,
      consoleErrors: 0,
      pageErrors: 0,
      flowStepsPassed: 0,
      flowStepsFailed: 0
    },
    consoleErrors: [],
    pageErrors: [],
    artifacts: [],
    providerResults: normalizeProviderResults(config, { deterministicStatus: "passed", artifactCount: 0, mode: plan.mode }),
    reproductionCommands: [`visual-hive plan --mode ${plan.mode}`, "No run needed; ignored changed files produced an empty PR plan."],
    noContractsReason: reason
  };
}
