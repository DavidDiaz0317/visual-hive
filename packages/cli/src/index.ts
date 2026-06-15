#!/usr/bin/env node
import { Command } from "commander";
import { sanitizeText } from "@visual-hive/core";
import { runDoctor, formatDiagnostics } from "./commands/doctor.js";
import { runInit } from "./commands/init.js";
import { formatPlanSummary, runPlanCommand } from "./commands/plan.js";
import { runDeterministicCommand } from "./commands/run.js";
import { formatMutationSummary, runMutateCommand } from "./commands/mutate.js";
import { runTriageCommand } from "./commands/triage.js";
import { runReportCommand } from "./commands/report.js";

const program = new Command();

program.name("visual-hive").description("Deterministic-first visual QA orchestration").version("0.2.0");

program
  .command("init")
  .description("Create Visual Hive config, workflow templates, and generated artifact directories")
  .option("--force", "overwrite existing files")
  .action(async (options) => {
    try {
      const created = await runInit({ force: options.force });
      console.log(`Created:\n${created.map((file) => `- ${file}`).join("\n")}`);
    } catch (error) {
      fail(error);
    }
  });

program
  .command("doctor")
  .description("Validate config and local execution prerequisites")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .action(async (options) => {
    const result = await runDoctor({ config: options.config });
    console.log(formatDiagnostics(result.diagnostics));
    if (!result.ok) {
      process.exitCode = 1;
    }
  });

program
  .command("plan")
  .description("Create a deterministic Visual Hive execution plan")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .option("--mode <mode>", "plan mode: pr, schedule, or manual", "pr")
  .option("--changed-files <path>", "newline-delimited changed files")
  .option("--base <ref>", "git base ref for diff")
  .option("--allow-unsafe-targets", "include non-prSafe targets in PR mode")
  .option("--ci", "accepted for workflow compatibility")
  .action(async (options) => {
    try {
      const plan = await runPlanCommand({
        config: options.config,
        mode: options.mode,
        changedFiles: options.changedFiles,
        base: options.base,
        allowUnsafeTargets: options.allowUnsafeTargets
      });
      console.log(formatPlanSummary(plan));
    } catch (error) {
      fail(error);
    }
  });

program
  .command("run")
  .description("Run selected deterministic Playwright contracts")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .option("--plan <path>", "plan path", ".visual-hive/plan.json")
  .option("--ci", "fail on missing baselines")
  .option("--skip-install", "skip configured install commands")
  .option("--skip-build", "skip configured build commands")
  .action(async (options) => {
    try {
      process.exitCode = await runDeterministicCommand({
        config: options.config,
        plan: options.plan,
        ci: options.ci,
        skipInstall: options.skipInstall,
        skipBuild: options.skipBuild
      });
    } catch (error) {
      fail(error);
    }
  });

program
  .command("mutate")
  .description("Run mutation adequacy checks")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .option("--plan <path>", "plan path", ".visual-hive/plan.json")
  .option("--enforce-min-score", "exit nonzero when mutation score is below configured minScore")
  .option("--skip-install", "skip configured install commands")
  .option("--skip-build", "skip configured build commands")
  .action(async (options) => {
    try {
      const result = await runMutateCommand({
        config: options.config,
        plan: options.plan,
        enforceMinScore: options.enforceMinScore,
        skipInstall: options.skipInstall,
        skipBuild: options.skipBuild
      });
      console.log(formatMutationSummary(result.report, result.reportPath));
      process.exitCode = result.exitCode;
    } catch (error) {
      fail(error);
    }
  });

program
  .command("triage")
  .description("Generate offline triage, LLM-ready prompts, and a sanitized issue body")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .action(async (options) => {
    try {
      const result = await runTriageCommand({ config: options.config });
      console.log(`Wrote ${result.promptPath}`);
      console.log(`Wrote ${result.issuePath}`);
      console.log(`Offline findings: ${result.findingCount}`);
    } catch (error) {
      fail(error);
    }
  });

program
  .command("report")
  .description("Print a markdown or JSON report summary")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .option("--format <format>", "markdown or json", "markdown")
  .option("--github-step-summary", "append markdown to GITHUB_STEP_SUMMARY when present")
  .action(async (options) => {
    try {
      const output = await runReportCommand({
        config: options.config,
        format: options.format,
        githubStepSummary: options.githubStepSummary
      });
      console.log(output);
    } catch (error) {
      fail(error);
    }
  });

program.parseAsync(process.argv);

function fail(error: unknown): void {
  console.error(sanitizeText(error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
}
