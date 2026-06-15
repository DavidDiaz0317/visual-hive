import path from "node:path";
import {
  buildMutationReport,
  loadConfig,
  readJson,
  writeJson,
  type MutationReport,
  type MutationResult,
  type Plan,
  type Report,
  type VisualHiveConfig
} from "@visual-hive/core";
import { runPlaywrightContracts } from "@visual-hive/playwright-adapter";

export type MutationRunner = (options: {
  config: VisualHiveConfig;
  plan: Plan;
  rootDir: string;
  ci?: boolean;
  mutationOperator?: string;
}) => Promise<{ report: Report; exitCode: number }>;

export interface MutateCommandOptions {
  config?: string;
  cwd?: string;
  plan?: string;
  enforceMinScore?: boolean;
  runner?: MutationRunner;
}

export async function runMutateCommand(options: MutateCommandOptions = {}): Promise<{ exitCode: number; reportPath: string; report: MutationReport }> {
  const cwd = options.cwd ?? process.cwd();
  const loaded = await loadConfig(options.config, cwd);
  const plan = await readJson<Plan>(path.resolve(loaded.rootDir, options.plan ?? path.join(".visual-hive", "plan.json")));
  if (plan.items.length === 0) {
    throw new Error(`No contracts selected in mutation plan. Run "visual-hive plan" with matching contracts before "visual-hive mutate".`);
  }
  const operators = plan.mutation.enabled ? plan.mutation.operators : loaded.config.mutation.operators;
  if (operators.length === 0) {
    throw new Error(`No mutation operators configured. Add mutation.operators to visual-hive.config.yaml before running "visual-hive mutate".`);
  }
  const results: MutationResult[] = [];
  const runner = options.runner ?? runPlaywrightContracts;

  for (const operator of operators) {
    const startedAt = Date.now();
    const { report, exitCode } = await runner({
      config: loaded.config,
      plan,
      rootDir: loaded.rootDir,
      ci: true,
      mutationOperator: operator
    });
    const killed = exitCode !== 0 || report.status === "failed";
    results.push({
      operator,
      status: killed ? "killed" : "survived",
      killed,
      contractIds: plan.items.map((item) => item.contractId),
      durationMs: Date.now() - startedAt,
      errors: report.results.flatMap((result) => result.errors)
    });
  }

  const report = buildMutationReport({
    project: loaded.config.project.name,
    minScore: loaded.config.mutation.minScore,
    results
  });
  const reportPath = path.join(loaded.rootDir, ".visual-hive", "mutation-report.json");
  await writeJson(reportPath, report);
  const exitCode = options.enforceMinScore && report.score < report.minScore ? 1 : 0;
  return { exitCode, reportPath, report };
}

export function formatMutationSummary(report: MutationReport, reportPath: string): string {
  return [
    `Wrote ${reportPath}`,
    `Mutation score: ${Math.round(report.score * 100)}% (${report.killed}/${report.total})`,
    `Minimum score: ${Math.round(report.minScore * 100)}%`,
    ...report.results.map((result) => `- ${result.operator}: ${result.status}`)
  ].join("\n");
}
