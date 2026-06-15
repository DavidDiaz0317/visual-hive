import path from "node:path";
import { loadConfig, readJson, writeJson, type Plan } from "@visual-hive/core";
import { runPlaywrightContracts } from "@visual-hive/playwright-adapter";

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
