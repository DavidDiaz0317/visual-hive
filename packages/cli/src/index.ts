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
import { runUiCommand } from "./commands/ui.js";
import {
  formatBaselineApproval,
  formatBaselineList,
  formatBaselineRejection,
  runBaselineApproveCommand,
  runBaselineListCommand,
  runBaselineRejectCommand
} from "./commands/baselines.js";
import { formatProvidersMockSummary, formatProvidersSummary, runProvidersCommand, runProvidersMockCommand } from "./commands/providers.js";
import { formatCoverageSummary, runCoverageCommand } from "./commands/coverage.js";
import { formatContractsAudit, runContractsCommand } from "./commands/contracts.js";
import { formatTargetsAudit, runTargetsCommand } from "./commands/targets.js";
import { formatSchedulesAudit, runSchedulesCommand } from "./commands/schedules.js";
import { formatWorkflowTemplateWrite, formatWorkflowsAudit, runWorkflowTemplatesWriteCommand, runWorkflowsCommand } from "./commands/workflows.js";
import { formatHistorySummary, runHistoryCommand } from "./commands/history.js";
import { formatArtifactsIndex, runArtifactsCommand } from "./commands/artifacts.js";
import { formatLLMUsage, runLLMCommand } from "./commands/llm.js";
import { formatRiskRegister, runRiskCommand } from "./commands/risk.js";
import { formatSetupRecommendation, runRecommendCommand } from "./commands/recommend.js";
import {
  formatConnectionsIndex,
  runConnectionsAddCommand,
  runConnectionsListCommand,
  runConnectionsRemoveCommand
} from "./commands/connections.js";

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
  .option("--mode <mode>", "plan mode: pr, schedule, manual, canary, mutation, or full", "pr")
  .option("--changed-files <path>", "newline-delimited changed files")
  .option("--base <ref>", "git base ref for diff")
  .option("--allow-unsafe-targets", "include non-prSafe targets in PR mode")
  .option("--include-contract <id>", "explicitly include a contract in the plan (repeatable)", collectRepeatable, [])
  .option("--exclude-contract <id>", "explicitly exclude a contract from the plan (repeatable)", collectRepeatable, [])
  .option("--include-target <id>", "explicitly include contracts for a target in the plan (repeatable)", collectRepeatable, [])
  .option("--exclude-target <id>", "explicitly exclude contracts for a target from the plan (repeatable)", collectRepeatable, [])
  .option("--ci", "accepted for workflow compatibility")
  .action(async (options) => {
    try {
      const plan = await runPlanCommand({
        config: options.config,
        mode: options.mode,
        changedFiles: options.changedFiles,
        base: options.base,
        allowUnsafeTargets: options.allowUnsafeTargets,
        includeContracts: options.includeContract,
        excludeContracts: options.excludeContract,
        includeTargets: options.includeTarget,
        excludeTargets: options.excludeTarget
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
      console.log(`Wrote ${result.triageReportPath}`);
      console.log(`Wrote ${result.promptPath}`);
      console.log(`Wrote ${result.repairPromptPath}`);
      console.log(`Wrote ${result.missingTestsPath}`);
      console.log(`Wrote ${result.baselineReviewPath}`);
      console.log(`Wrote ${result.issuePath}`);
      console.log(`Wrote ${result.prCommentPath}`);
      console.log(`Wrote ${result.llmUsagePath}`);
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

program
  .command("providers")
  .description("Inspect optional provider adapters and credential-name readiness")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .option("--mock-results", "write .visual-hive/provider-results.json using mock/no-network adapter operations")
  .option("--report <path>", "deterministic report path for --mock-results", ".visual-hive/report.json")
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (options) => {
    try {
      if (options.mockResults) {
        const result = await runProvidersMockCommand({ config: options.config, report: options.report, format: options.format });
        console.log(formatProvidersMockSummary(result.report, result.reportPath, options.format));
        return;
      }
      const providers = await runProvidersCommand({ config: options.config });
      console.log(options.format === "json" ? JSON.stringify(providers, null, 2) : formatProvidersSummary(providers));
    } catch (error) {
      fail(error);
    }
  });

program
  .command("coverage")
  .description("Analyze configured visual coverage and write .visual-hive/coverage.json")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .option("--plan <path>", "plan path override")
  .option("--mode <mode>", "plan mode to use when no plan exists: pr, schedule, manual, canary, mutation, or full", "pr")
  .option("--changed-files <path>", "newline-delimited changed files")
  .option("--base <ref>", "git base ref for changed-file coverage")
  .option("--allow-unsafe-targets", "include non-prSafe targets in PR-mode coverage selection")
  .option("--include-contract <id>", "explicitly include a contract when creating an in-memory plan (repeatable)", collectRepeatable, [])
  .option("--exclude-contract <id>", "explicitly exclude a contract when creating an in-memory plan (repeatable)", collectRepeatable, [])
  .option("--include-target <id>", "explicitly include contracts for a target when creating an in-memory plan (repeatable)", collectRepeatable, [])
  .option("--exclude-target <id>", "explicitly exclude contracts for a target when creating an in-memory plan (repeatable)", collectRepeatable, [])
  .action(async (options) => {
    try {
      const result = await runCoverageCommand({
        config: options.config,
        plan: options.plan,
        mode: options.mode,
        changedFiles: options.changedFiles,
        base: options.base,
        allowUnsafeTargets: options.allowUnsafeTargets,
        includeContracts: options.includeContract,
        excludeContracts: options.excludeContract,
        includeTargets: options.includeTarget,
        excludeTargets: options.excludeTarget
      });
      console.log(formatCoverageSummary(result.report, result.reportPath));
    } catch (error) {
      fail(error);
    }
  });

program
  .command("contracts")
  .description("Audit configured contracts, mappings, latest results, and actionable gaps")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .option("--plan <path>", "plan path override")
  .option("--report <path>", "report path override")
  .option("--mutation-report <path>", "mutation report path override")
  .option("--mode <mode>", "plan mode to use when no plan exists: pr, schedule, manual, canary, mutation, or full", "pr")
  .option("--changed-files <path>", "newline-delimited changed files")
  .option("--base <ref>", "git base ref for changed-file selection")
  .option("--allow-unsafe-targets", "include non-prSafe targets in PR-mode selection")
  .option("--include-contract <id>", "explicitly include a contract when creating an in-memory plan (repeatable)", collectRepeatable, [])
  .option("--exclude-contract <id>", "explicitly exclude a contract when creating an in-memory plan (repeatable)", collectRepeatable, [])
  .option("--include-target <id>", "explicitly include contracts for a target when creating an in-memory plan (repeatable)", collectRepeatable, [])
  .option("--exclude-target <id>", "explicitly exclude contracts for a target when creating an in-memory plan (repeatable)", collectRepeatable, [])
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (options) => {
    try {
      const result = await runContractsCommand({
        config: options.config,
        plan: options.plan,
        report: options.report,
        mutationReport: options.mutationReport,
        mode: options.mode,
        changedFiles: options.changedFiles,
        base: options.base,
        allowUnsafeTargets: options.allowUnsafeTargets,
        includeContracts: options.includeContract,
        excludeContracts: options.excludeContract,
        includeTargets: options.includeTarget,
        excludeTargets: options.excludeTarget,
        format: options.format
      });
      console.log(formatContractsAudit(result.audit, result.auditPath, options.format));
    } catch (error) {
      fail(error);
    }
  });

program
  .command("targets")
  .description("Audit configured targets, safety, services, secrets, lifecycle evidence, and gaps")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .option("--plan <path>", "plan path override")
  .option("--report <path>", "report path override")
  .option("--mode <mode>", "plan mode to use when no plan exists: pr, schedule, manual, canary, mutation, or full", "pr")
  .option("--changed-files <path>", "newline-delimited changed files")
  .option("--base <ref>", "git base ref for changed-file selection")
  .option("--allow-unsafe-targets", "include non-prSafe targets in PR-mode selection")
  .option("--include-contract <id>", "explicitly include a contract when creating an in-memory plan (repeatable)", collectRepeatable, [])
  .option("--exclude-contract <id>", "explicitly exclude a contract when creating an in-memory plan (repeatable)", collectRepeatable, [])
  .option("--include-target <id>", "explicitly include contracts for a target when creating an in-memory plan (repeatable)", collectRepeatable, [])
  .option("--exclude-target <id>", "explicitly exclude contracts for a target when creating an in-memory plan (repeatable)", collectRepeatable, [])
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (options) => {
    try {
      const result = await runTargetsCommand({
        config: options.config,
        plan: options.plan,
        report: options.report,
        mode: options.mode,
        changedFiles: options.changedFiles,
        base: options.base,
        allowUnsafeTargets: options.allowUnsafeTargets,
        includeContracts: options.includeContract,
        excludeContracts: options.excludeContract,
        includeTargets: options.includeTarget,
        excludeTargets: options.excludeTarget,
        format: options.format
      });
      console.log(formatTargetsAudit(result.audit, result.auditPath, options.format));
    } catch (error) {
      fail(error);
    }
  });

program
  .command("schedules")
  .alias("schedule")
  .description("Audit PR, scheduled, protected, mutation, and trusted issue workflow lanes")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .option("--changed-files <path>", "newline-delimited changed files")
  .option("--base <ref>", "git base ref for changed-file selection")
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (options) => {
    try {
      const result = await runSchedulesCommand({
        config: options.config,
        changedFiles: options.changedFiles,
        base: options.base,
        format: options.format
      });
      console.log(formatSchedulesAudit(result.audit, result.auditPath, options.format));
    } catch (error) {
      fail(error);
    }
  });

program
  .command("workflows")
  .alias("workflow")
  .description("Audit GitHub Actions workflow YAML for Visual Hive safety invariants")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .option("--workflow-dir <path>", "workflow directory to scan", ".github/workflows")
  .option("--write-templates", "write built-in Visual Hive workflow templates into .github/workflows")
  .option("--template <id>", "template id to write: pull_request, scheduled, trusted_failure_issue (repeatable)", collectRepeatable, [])
  .option("--force", "overwrite existing workflow template files when used with --write-templates")
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (options) => {
    try {
      if (options.writeTemplates) {
        const result = await runWorkflowTemplatesWriteCommand({
          config: options.config,
          workflowDir: options.workflowDir,
          format: options.format,
          force: options.force,
          templateIds: options.template
        });
        console.log(formatWorkflowTemplateWrite(result, options.format));
        return;
      }
      const result = await runWorkflowsCommand({
        config: options.config,
        workflowDir: options.workflowDir,
        format: options.format
      });
      console.log(formatWorkflowsAudit(result.audit, result.auditPath, options.format));
    } catch (error) {
      fail(error);
    }
  });

program
  .command("history")
  .description("Inspect or record run history from the latest Visual Hive artifacts")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .option("--record", "archive latest artifacts into .visual-hive/history and update .visual-hive/history.json")
  .option("--max-entries <count>", "maximum history entries to keep", (value) => Number.parseInt(value, 10))
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (options) => {
    try {
      const result = await runHistoryCommand({
        config: options.config,
        record: options.record,
        maxEntries: options.maxEntries,
        format: options.format
      });
      console.log(formatHistorySummary(result.history, result.historyPath, options.format, result.recorded));
    } catch (error) {
      fail(error);
    }
  });

program
  .command("artifacts")
  .description("Index .visual-hive artifacts with safe classifications and sanitized previews")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .option("--max-artifacts <count>", "maximum artifact entries to index", (value) => Number.parseInt(value, 10))
  .option("--max-preview-bytes <count>", "maximum bytes to preview for text-like artifacts", (value) => Number.parseInt(value, 10))
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (options) => {
    try {
      const result = await runArtifactsCommand({
        config: options.config,
        maxArtifacts: options.maxArtifacts,
        maxPreviewBytes: options.maxPreviewBytes,
        format: options.format
      });
      console.log(formatArtifactsIndex(result.index, result.indexPath, options.format));
    } catch (error) {
      fail(error);
    }
  });

program
  .command("llm")
  .description("Audit prompt-only LLM governance, budgets, and generated prompt artifacts")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (options) => {
    try {
      const result = await runLLMCommand({
        config: options.config,
        format: options.format
      });
      console.log(formatLLMUsage(result, options.format));
    } catch (error) {
      fail(error);
    }
  });

program
  .command("risk")
  .description("Build a prioritized visual QA risk register from Visual Hive artifacts")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .option("--plan <path>", "plan path override")
  .option("--report <path>", "report path override")
  .option("--mutation-report <path>", "mutation report path override")
  .option("--coverage <path>", "coverage artifact path override")
  .option("--targets <path>", "targets audit artifact path override")
  .option("--contracts <path>", "contracts audit artifact path override")
  .option("--schedules <path>", "schedules audit artifact path override")
  .option("--workflows <path>", "workflow audit artifact path override")
  .option("--workflow-dir <path>", "workflow directory to scan when workflow audit artifact is missing", ".github/workflows")
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (options) => {
    try {
      const result = await runRiskCommand({
        config: options.config,
        plan: options.plan,
        report: options.report,
        mutationReport: options.mutationReport,
        coverage: options.coverage,
        targets: options.targets,
        contracts: options.contracts,
        schedules: options.schedules,
        workflows: options.workflows,
        workflowDir: options.workflowDir,
        format: options.format
      });
      console.log(formatRiskRegister(result.report, result.reportPath, options.format));
    } catch (error) {
      fail(error);
    }
  });

program
  .command("recommend")
  .description("Inspect a target repo and recommend an initial Visual Hive setup")
  .option("--repo <path>", "repository path to inspect")
  .option("--write-config", "write visual-hive.config.yaml from the recommendation")
  .option("--write-docs", "write docs/visual-hive.md from the recommendation")
  .option("--force", "overwrite generated setup files when used with --write-config or --write-docs")
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (options) => {
    try {
      const result = await runRecommendCommand({
        repo: options.repo,
        writeConfig: options.writeConfig,
        writeDocs: options.writeDocs,
        force: options.force,
        format: options.format
      });
      console.log(formatSetupRecommendation(result, options.format));
    } catch (error) {
      fail(error);
    }
  });

const connections = program.command("connections").alias("connection").description("Manage local Visual Hive repository connections");

connections
  .command("list")
  .description("List connected local repositories")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (options) => {
    try {
      const result = await runConnectionsListCommand({ config: options.config, format: options.format });
      console.log(formatConnectionsIndex(result.index, result.indexPath, options.format));
    } catch (error) {
      fail(error);
    }
  });

connections
  .command("add")
  .description("Add or update a connected local repository")
  .requiredOption("--repo <path>", "repository path to connect")
  .option("--connection-config <path>", "config path inside the connected repo", "visual-hive.config.yaml")
  .option("--id <id>", "stable connection id")
  .option("--label <label>", "display label")
  .option("--tag <tag...>", "connection tags")
  .option("--config <path>", "config path for the managing repo", "visual-hive.config.yaml")
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (options) => {
    try {
      const result = await runConnectionsAddCommand({
        config: options.config,
        repo: options.repo,
        connectionConfig: options.connectionConfig,
        id: options.id,
        label: options.label,
        tags: options.tag,
        format: options.format
      });
      console.log(formatConnectionsIndex(result.index, result.indexPath, options.format));
    } catch (error) {
      fail(error);
    }
  });

connections
  .command("remove")
  .description("Remove a connected local repository")
  .requiredOption("--id <id>", "connection id")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (options) => {
    try {
      const result = await runConnectionsRemoveCommand({ config: options.config, id: options.id, format: options.format });
      console.log(formatConnectionsIndex(result.index, result.indexPath, options.format));
    } catch (error) {
      fail(error);
    }
  });

const baselines = program.command("baselines").alias("baseline").description("Inspect, approve, and reject screenshot baselines");

baselines
  .command("list")
  .description("List screenshot baselines from the latest report")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .option("--report <path>", "report path override")
  .action(async (options) => {
    try {
      const list = await runBaselineListCommand({ config: options.config, report: options.report });
      console.log(formatBaselineList(list));
    } catch (error) {
      fail(error);
    }
  });

baselines
  .command("approve")
  .description("Approve one screenshot by copying its actual image to the baseline path")
  .requiredOption("--contract <id>", "contract ID")
  .requiredOption("--screenshot <name>", "screenshot name")
  .option("--viewport <name>", "viewport name when contract/screenshot is ambiguous")
  .option("--route <route>", "route when contract/screenshot is ambiguous")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .option("--report <path>", "report path override")
  .action(async (options) => {
    try {
      const approval = await runBaselineApproveCommand({
        config: options.config,
        report: options.report,
        contractId: options.contract,
        screenshotName: options.screenshot,
        viewport: options.viewport,
        route: options.route
      });
      console.log(formatBaselineApproval(approval));
    } catch (error) {
      fail(error);
    }
  });

baselines
  .command("reject")
  .description("Reject one screenshot without copying it to the baseline path")
  .requiredOption("--contract <id>", "contract ID")
  .requiredOption("--screenshot <name>", "screenshot name")
  .option("--viewport <name>", "viewport name when contract/screenshot is ambiguous")
  .option("--route <route>", "route when contract/screenshot is ambiguous")
  .option("--reason <text>", "short review reason")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .option("--report <path>", "report path override")
  .action(async (options) => {
    try {
      const rejection = await runBaselineRejectCommand({
        config: options.config,
        report: options.report,
        contractId: options.contract,
        screenshotName: options.screenshot,
        viewport: options.viewport,
        route: options.route,
        reason: options.reason
      });
      console.log(formatBaselineRejection(rejection));
    } catch (error) {
      fail(error);
    }
  });

program
  .command("ui")
  .description("Start the local-first Visual Hive Control Plane UI")
  .option("--repo <path>", "target repository path")
  .option("--config <path>", "config path")
  .option("--port <port>", "port to listen on", "4317")
  .option("--open", "open the Control Plane in your browser")
  .option("--read-only", "disable file mutation actions in the UI")
  .option("--demo", "use examples/demo-react-app when no repo/config is provided")
  .action(async (options) => {
    try {
      const server = await runUiCommand({
        repo: options.repo,
        config: options.config,
        port: options.port,
        open: options.open,
        readOnly: options.readOnly,
        demo: options.demo
      });
      console.log(`Visual Hive Control Plane running at ${server.url}`);
      console.log("Press Ctrl+C to stop.");
      await waitForShutdown(server.close);
    } catch (error) {
      fail(error);
    }
  });

program.parseAsync(process.argv);

function fail(error: unknown): void {
  console.error(sanitizeText(error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
}

function collectRepeatable(value: string, previous: string[]): string[] {
  const trimmed = value.trim();
  return trimmed ? [...previous, trimmed] : previous;
}

async function waitForShutdown(close: () => Promise<void>): Promise<void> {
  await new Promise<void>((resolve) => {
    const shutdown = () => {
      process.off("SIGINT", shutdown);
      process.off("SIGTERM", shutdown);
      resolve();
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });
  await close();
}
