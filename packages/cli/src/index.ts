#!/usr/bin/env node
import { Command } from "commander";
import { sanitizeText } from "@visual-hive/core";
import { runDoctor, formatDiagnostics } from "./commands/doctor.js";
import { runInit } from "./commands/init.js";
import { formatPlanSummary, runPlanCommand } from "./commands/plan.js";
import { formatPlansSummary, runPlansCommand } from "./commands/plans.js";
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
import {
  formatProviderDecision,
  formatProviderHandoff,
  formatProviderSetupPlan,
  formatProvidersMockSummary,
  formatProvidersSummary,
  runProviderDecisionCommand,
  runProviderHandoffCommand,
  runProviderSetupPlanCommand,
  runProvidersCommand,
  runProvidersMockCommand
} from "./commands/providers.js";
import { formatCoverageSummary, runCoverageCommand } from "./commands/coverage.js";
import { formatContractsAudit, runContractsCommand } from "./commands/contracts.js";
import { formatFlowsAudit, runFlowsCommand } from "./commands/flows.js";
import { formatTargetsAudit, runTargetsCommand } from "./commands/targets.js";
import { formatSchedulesAudit, runSchedulesCommand } from "./commands/schedules.js";
import { formatWorkflowTemplateWrite, formatWorkflowsAudit, runWorkflowTemplatesWriteCommand, runWorkflowsCommand } from "./commands/workflows.js";
import { formatHistorySummary, runHistoryCommand } from "./commands/history.js";
import { formatArtifactsIndex, runArtifactsCommand } from "./commands/artifacts.js";
import { formatLLMDecision, formatLLMUsage, runLLMCommand, runLLMDecisionCommand } from "./commands/llm.js";
import { formatRiskRegister, runRiskCommand } from "./commands/risk.js";
import { formatReadinessReport, runReadinessCommand } from "./commands/readiness.js";
import { formatSetupProgress, runSetupStatusCommand } from "./commands/setupStatus.js";
import { formatRunbookReport, runRunbookCommand } from "./commands/runbook.js";
import { formatSecurityAudit, runSecurityCommand } from "./commands/security.js";
import { formatCostsReport, runCostsCommand } from "./commands/costs.js";
import { formatSetupRecommendation, runRecommendCommand } from "./commands/recommend.js";
import { formatCoverageImprovementReport, runImproveCoverageCommand } from "./commands/improve.js";
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
  .option("--output <path>", "write plan JSON to this path relative to the config root", ".visual-hive/plan.json")
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
        output: options.output,
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
  .command("plans")
  .description("Summarize .visual-hive/plan*.json lane artifacts")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (options) => {
    try {
      const result = await runPlansCommand({
        config: options.config,
        format: options.format
      });
      console.log(formatPlansSummary(result.report, result.reportPath, options.format));
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

const providersCommand = program
  .command("providers")
  .description("Inspect and govern optional provider adapters");

providersCommand
  .command("list", { isDefault: true })
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

providersCommand
  .command("decision")
  .description("Record a local provider governance decision without making external calls")
  .requiredOption("--provider <id>", "provider id, for example argos, percy, chromatic, or applitools")
  .requiredOption("--decision <decision>", "skip, review_later, or approve_trusted_setup")
  .option("--reason <text>", "human-readable reason for the decision")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (options) => {
    try {
      const result = await runProviderDecisionCommand({
        config: options.config,
        providerId: options.provider,
        decision: options.decision,
        reason: options.reason,
        format: options.format
      });
      console.log(formatProviderDecision(result, options.format));
    } catch (error) {
      fail(error);
    }
  });

providersCommand
  .command("plan")
  .description("Write a no-network provider setup plan for trusted review")
  .requiredOption("--provider <id>", "provider id, for example argos, percy, chromatic, or applitools")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (options) => {
    try {
      const result = await runProviderSetupPlanCommand({
        config: options.config,
        providerId: options.provider,
        format: options.format
      });
      console.log(formatProviderSetupPlan(result, options.format));
    } catch (error) {
      fail(error);
    }
  });

providersCommand
  .command("handoff")
  .description("Write a no-network provider artifact handoff manifest from the deterministic report")
  .requiredOption("--provider <id>", "provider id, for example argos, percy, chromatic, or applitools")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .option("--report <path>", "deterministic report path", ".visual-hive/report.json")
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (options) => {
    try {
      const result = await runProviderHandoffCommand({
        config: options.config,
        providerId: options.provider,
        report: options.report,
        format: options.format
      });
      console.log(formatProviderHandoff(result, options.format));
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
  .command("improve-coverage")
  .description("Generate deterministic coverage improvement recommendations from coverage gaps and mutation survivors")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .option("--coverage <path>", "coverage artifact path override", ".visual-hive/coverage.json")
  .option("--flows <path>", "flow audit artifact path override", ".visual-hive/flows.json")
  .option("--mutation-report <path>", "mutation report path override", ".visual-hive/mutation-report.json")
  .option("--apply <id>", "show a config diff for a specific recommendation id")
  .option("--yes", "write the selected recommendation to visual-hive.config.yaml after reviewing the diff")
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (options) => {
    try {
      const result = await runImproveCoverageCommand({
        config: options.config,
        coverage: options.coverage,
        flows: options.flows,
        mutationReport: options.mutationReport,
        apply: options.apply,
        yes: options.yes,
        format: options.format
      });
      console.log(formatCoverageImprovementReport(result.report, result.reportPath, options.format, result.applyResult, Boolean(options.yes && result.applyResult?.applied)));
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
  .command("flows")
  .description("Audit deterministic user-flow coverage, latest flow failures, and actionable flow gaps")
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
      const result = await runFlowsCommand({
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
      console.log(formatFlowsAudit(result.audit, result.auditPath, options.format));
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

const llmCommand = program
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

llmCommand
  .command("decision")
  .description("Record a local LLM governance decision without making model calls")
  .requiredOption("--decision <decision>", "keep_disabled, review_later, or approve_trusted_prompt_only")
  .option("--reason <text>", "human-readable reason for the decision")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (options) => {
    try {
      const result = await runLLMDecisionCommand({
        config: options.config,
        decision: options.decision,
        reason: options.reason,
        format: options.format
      });
      console.log(formatLLMDecision(result, options.format));
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
  .option("--flows <path>", "flow audit artifact path override")
  .option("--schedules <path>", "schedules audit artifact path override")
  .option("--workflows <path>", "workflow audit artifact path override")
  .option("--provider-decisions <path>", "provider governance decision artifact path override")
  .option("--provider-setup-plan <path>", "provider setup-plan artifact path override")
  .option("--provider-handoff <path>", "provider handoff artifact path override")
  .option("--llm-decisions <path>", "LLM governance decision artifact path override")
  .option("--history <path>", "run history artifact path override")
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
        flows: options.flows,
        schedules: options.schedules,
        workflows: options.workflows,
        providerDecisions: options.providerDecisions,
        providerSetupPlan: options.providerSetupPlan,
        providerHandoff: options.providerHandoff,
        llmDecisions: options.llmDecisions,
        history: options.history,
        workflowDir: options.workflowDir,
        format: options.format
      });
      console.log(formatRiskRegister(result.report, result.reportPath, options.format));
    } catch (error) {
      fail(error);
    }
  });

program
  .command("readiness")
  .description("Summarize whether Visual Hive evidence is ready for CI enforcement and review")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .option("--plan <path>", "plan artifact path", ".visual-hive/plan.json")
  .option("--report <path>", "deterministic report artifact path", ".visual-hive/report.json")
  .option("--mutation-report <path>", "mutation report artifact path", ".visual-hive/mutation-report.json")
  .option("--baselines <path>", "baseline review artifact path", ".visual-hive/baselines.json")
  .option("--workflows <path>", "workflow audit artifact path", ".visual-hive/workflows.json")
  .option("--workflow-dir <path>", "workflow directory to scan when workflow audit artifact is missing", ".github/workflows")
  .option("--security <path>", "security audit artifact path", ".visual-hive/security.json")
  .option("--costs <path>", "cost audit artifact path", ".visual-hive/costs.json")
  .option("--provider-decisions <path>", "provider governance decision artifact path", ".visual-hive/provider-decisions.json")
  .option("--provider-setup-plan <path>", "provider setup-plan artifact path", ".visual-hive/provider-setup-plan.json")
  .option("--provider-handoff <path>", "provider handoff artifact path", ".visual-hive/provider-handoff.json")
  .option("--llm-decisions <path>", "LLM governance decision artifact path", ".visual-hive/llm-decisions.json")
  .option("--history <path>", "run history artifact path", ".visual-hive/history.json")
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (options) => {
    try {
      const result = await runReadinessCommand({
        config: options.config,
        plan: options.plan,
        report: options.report,
        mutationReport: options.mutationReport,
        baselines: options.baselines,
        workflows: options.workflows,
        workflowDir: options.workflowDir,
        security: options.security,
        costs: options.costs,
        providerDecisions: options.providerDecisions,
        providerSetupPlan: options.providerSetupPlan,
        providerHandoff: options.providerHandoff,
        llmDecisions: options.llmDecisions,
        history: options.history,
        format: options.format
      });
      console.log(formatReadinessReport(result.report, result.reportPath, options.format));
      if (result.report.status === "blocked") {
        process.exitCode = 1;
      }
    } catch (error) {
      fail(error);
    }
  });

program
  .command("setup-status")
  .description("Summarize setup progress from recommendation, config, run, mutation, triage, workflow, provider, and readiness artifacts")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .option("--plan <path>", "plan artifact path", ".visual-hive/plan.json")
  .option("--report <path>", "deterministic report artifact path", ".visual-hive/report.json")
  .option("--mutation-report <path>", "mutation report artifact path", ".visual-hive/mutation-report.json")
  .option("--triage <path>", "triage artifact path", ".visual-hive/triage.json")
  .option("--recommendations <path>", "setup recommendation artifact path", ".visual-hive/recommendations.json")
  .option("--workflows <path>", "workflow audit artifact path", ".visual-hive/workflows.json")
  .option("--workflow-dir <path>", "workflow directory to scan when workflow audit artifact is missing", ".github/workflows")
  .option("--readiness <path>", "readiness artifact path", ".visual-hive/readiness.json")
  .option("--provider-setup-plan <path>", "provider setup-plan artifact path", ".visual-hive/provider-setup-plan.json")
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (options) => {
    try {
      const result = await runSetupStatusCommand({
        config: options.config,
        plan: options.plan,
        report: options.report,
        mutationReport: options.mutationReport,
        triage: options.triage,
        recommendations: options.recommendations,
        workflows: options.workflows,
        workflowDir: options.workflowDir,
        readiness: options.readiness,
        providerSetupPlan: options.providerSetupPlan,
        format: options.format
      });
      console.log(formatSetupProgress(result.report, result.reportPath, options.format));
    } catch (error) {
      fail(error);
    }
  });

program
  .command("runbook")
  .description("Export curated Visual Hive runbook commands and optionally execute an allowlisted command or profile")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .option("--repo <path>", "target repository path")
  .option("--execute-command <id>", "execute one allowlisted runbook command by id")
  .option("--execute-profile <id>", "execute one allowlisted run profile by id")
  .option("--read-only", "block execution and only export runbook guidance")
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (options) => {
    try {
      const result = await runRunbookCommand({
        config: options.config,
        repo: options.repo,
        executeCommand: options.executeCommand,
        executeProfile: options.executeProfile,
        readOnly: options.readOnly,
        format: options.format
      });
      console.log(formatRunbookReport(result, options.format));
      if (result.report.execution?.status === "failed" || result.report.execution?.status === "blocked") {
        process.exitCode = 1;
      }
    } catch (error) {
      fail(error);
    }
  });

program
  .command("security")
  .description("Audit Visual Hive security posture, workflow safety, provider/LLM governance, and optional npm audit evidence")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .option("--workflow-dir <path>", "workflow directory to inspect", ".github/workflows")
  .option("--workflows <path>", "existing .visual-hive/workflows.json artifact path")
  .option("--audit-json <path>", "existing npm audit --json artifact path")
  .option("--npm-audit", "run npm audit --json in this repository")
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (options) => {
    try {
      const result = await runSecurityCommand({
        config: options.config,
        workflowDir: options.workflowDir,
        workflows: options.workflows,
        auditJson: options.auditJson,
        npmAudit: options.npmAudit,
        format: options.format
      });
      console.log(formatSecurityAudit(result.report, result.reportPath, options.format));
    } catch (error) {
      fail(error);
    }
  });

program
  .command("costs")
  .description("Audit Visual Hive local/external visual QA cost posture and provider budget policy")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .option("--plan <path>", "plan artifact path", ".visual-hive/plan.json")
  .option("--report <path>", "deterministic report artifact path", ".visual-hive/report.json")
  .option("--mutation-report <path>", "mutation report artifact path", ".visual-hive/mutation-report.json")
  .option("--provider-results <path>", "provider results artifact path", ".visual-hive/provider-results.json")
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (options) => {
    try {
      const result = await runCostsCommand({
        config: options.config,
        plan: options.plan,
        report: options.report,
        mutationReport: options.mutationReport,
        providerResults: options.providerResults,
        format: options.format
      });
      console.log(formatCostsReport(result.report, result.reportPath, options.format));
    } catch (error) {
      fail(error);
    }
  });

program
  .command("recommend")
  .description("Inspect a target repo and recommend an initial Visual Hive setup")
  .option("--repo <path>", "repository path to inspect")
  .option("--profile <profile>", "setup profile: free-local, hosted-review, component-storybook, enterprise-visual-ai, or complex-app")
  .option("--write-config", "write visual-hive.config.yaml from the recommendation")
  .option("--write-docs", "write docs/visual-hive.md from the recommendation")
  .option("--write-setup-bundle", "write config, repo docs, safe GitHub workflow templates, and setup audit from the recommendation")
  .option("--force", "overwrite generated setup files when used with --write-config, --write-docs, or --write-setup-bundle")
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (options) => {
    try {
      const result = await runRecommendCommand({
        repo: options.repo,
        profile: options.profile,
        writeConfig: options.writeConfig,
        writeDocs: options.writeDocs,
        writeSetupBundle: options.writeSetupBundle,
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
  .option("--write", "write .visual-hive/connections-portfolio.json with derived health and portfolio queues")
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (options) => {
    try {
      const result = await runConnectionsListCommand({ config: options.config, format: options.format, write: options.write });
      console.log(formatConnectionsIndex(result.index, result.indexPath, options.format, result.written ? result.portfolioPath : undefined));
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
  .option("--write", "write .visual-hive/baselines.json")
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (options) => {
    try {
      const list = await runBaselineListCommand({ config: options.config, report: options.report, write: options.write, format: options.format });
      console.log(formatBaselineList(list, options.format));
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
