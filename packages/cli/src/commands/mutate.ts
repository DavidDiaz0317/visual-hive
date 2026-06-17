import path from "node:path";
import {
  buildMutationReport,
  loadConfig,
  readJson,
  writeJson,
  selectContractsForMutation,
  MUTATION_OPERATOR_METADATA,
  mutationOperatorId,
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
  skipInstall?: boolean;
  skipBuild?: boolean;
}) => Promise<{ report: Report; exitCode: number }>;

export interface MutateCommandOptions {
  config?: string;
  cwd?: string;
  plan?: string;
  enforceMinScore?: boolean;
  runner?: MutationRunner;
  skipInstall?: boolean;
  skipBuild?: boolean;
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
    const mapping = selectContractsForMutation(
      operator,
      loaded.config.contracts.filter((contract) => plan.items.some((item) => item.contractId === contract.id))
    );
    const selectedItems = plan.items.filter((item) => mapping.contractIds.includes(item.contractId));
    const selectedTargetIds = [...new Set(selectedItems.map((item) => item.targetId))];
    if (!mapping.applicable || selectedItems.length === 0) {
      const metadata = MUTATION_OPERATOR_METADATA[mapping.operatorId];
      results.push({
        operator: mapping.operatorId,
        status: "not_applicable",
        killed: false,
        applicable: false,
        contractIds: [],
        expectedFailureKinds: metadata.expectedFailureKinds,
        durationMs: 0,
        artifacts: [],
        errors: [`Mutation ${mapping.operatorId} was not applicable: ${mapping.reason}`]
      });
      continue;
    }
    const metadata = MUTATION_OPERATOR_METADATA[mapping.operatorId];
    const startedAt = Date.now();
    const mutationPlan: Plan = {
      ...plan,
      items: selectedItems,
      targets: plan.targets.filter((target) => selectedTargetIds.includes(target.id))
    };
    const { report, exitCode } = await runner({
      config: loaded.config,
      plan: mutationPlan,
      rootDir: loaded.rootDir,
      ci: true,
      mutationOperator: mapping.operatorId,
      skipInstall: options.skipInstall,
      skipBuild: options.skipBuild
    });
    const killed = exitCode !== 0 || report.status === "failed";
    const errors = report.results.flatMap((result) => result.errors);
    results.push({
      operator: mapping.operatorId,
      status: killed ? "killed" : "survived",
      killed,
      applicable: true,
      contractIds: selectedItems.map((item) => item.contractId),
      expectedFailureKinds: metadata.expectedFailureKinds,
      failureKind: killed ? inferFailureKind(errors) : undefined,
      failedAssertion: killed ? errors[0] : undefined,
      durationMs: Date.now() - startedAt,
      errors,
      artifacts: [...new Set(report.results.flatMap((result) => result.artifacts))]
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

function inferFailureKind(errors: string[]): string | undefined {
  const joined = errors.join("\n").toLowerCase();
  if (joined.includes("baseline")) return "missing_baseline";
  if (joined.includes("screenshot") || joined.includes("diff")) return "visual_diff";
  if (joined.includes("login")) return "login_regression";
  if (joined.includes("absent") || joined.includes("mustnotexist")) return "unexpected_element";
  if (joined.includes("visible") || joined.includes("exist") || joined.includes("locator")) return "missing_element";
  if (joined.includes("console")) return "console_error";
  if (/\bapi\b/.test(joined) || /\bhttp\s*500\b/.test(joined) || /\bstatus\s*500\b/.test(joined)) return "api_contract_regression";
  return undefined;
}

export function formatMutationSummary(report: MutationReport, reportPath: string): string {
  return [
    `Wrote ${reportPath}`,
    `Mutation score: ${Math.round(report.score * 100)}% (${report.killed}/${report.total})`,
    `Minimum score: ${Math.round(report.minScore * 100)}%`,
    ...report.results.map((result) => {
      const selected = result.contractIds.length ? ` (${result.contractIds.join(", ")})` : "";
      return `- ${result.operator}: ${result.status}${selected}`;
    })
  ].join("\n");
}

export function formatMutationOperatorList(operators: Plan["mutation"]["operators"]): string {
  return operators.map((operator) => mutationOperatorId(operator)).join(", ");
}
