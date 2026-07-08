#!/usr/bin/env node
import { Command } from "commander";
import { sanitizeText } from "@visual-hive/core";
import { runDoctor, formatDiagnostics } from "./commands/doctor.js";
import { runInit } from "./commands/init.js";
import { formatPlanSummary, runPlanCommand } from "./commands/plan.js";
import { formatPipelineSummary, runPipelineCommand } from "./commands/pipeline.js";
import {
  formatLoopDeriveIssuesResult,
  formatLoopLifecycleResult,
  formatLoopRunResult,
  runLoopDeriveIssuesCommand,
  runLoopInitCommand,
  runLoopLifecycleCommand,
  runLoopRunCommand
} from "./commands/loop.js";
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
  formatProviderUpload,
  formatProvidersMockSummary,
  formatProvidersSummary,
  runProviderDecisionCommand,
  runProviderHandoffCommand,
  runProviderSetupPlanCommand,
  runProviderUploadCommand,
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
import { formatEvidencePacket, runEvidenceCommand } from "./commands/evidence.js";
import { formatVerdictReport, runVerdictCommand } from "./commands/verdict.js";
import { formatLayersReport, runLayersCommand } from "./commands/layers.js";
import { formatTestCreationPlan, runTestCreationPlanCommand } from "./commands/testCreationPlan.js";
import { formatHandoffResult, formatHandoffValidation, runHandoffCommand, runHandoffValidateCommand } from "./commands/handoff.js";
import {
  formatIssuePublishResult,
  formatIssuesResult,
  formatSetupIssuePublishResult,
  runIssuePublishCommand,
  runIssuesCommand,
  runSetupIssuePublishCommand
} from "./commands/issues.js";
import {
  formatHiveExport,
  formatHiveBeads,
  formatHiveGuardedRepairPreview,
  formatHiveIntegrationSmoke,
  formatHiveModeComparison,
  formatHiveRepairRequestEnvelope,
  formatHiveSetupPack,
  formatHiveTrustedRepairConsumerSummary,
  formatHiveTrustedRepairWorkflowDryRun,
  formatHiveValidateExport,
  runHiveBeadsCommand,
  runHiveCompareModesCommand,
  runHiveExportCommand,
  runHiveGuardedRepairPreviewCommand,
  runHiveIntegrationSmokeCommand,
  runHiveRepairRequestEnvelopeCommand,
  runHiveSetupPackCommand,
  runHiveTrustedRepairConsumerSummaryCommand,
  runHiveTrustedRepairWorkflowDryRunCommand,
  runHiveValidateExportCommand
} from "./commands/hive.js";
import { formatAgentPacketResult, runAgentPacketCommand } from "./commands/agentPacket.js";
import { formatAgentIssueRunnerResult, runAgentIssueRunnerCommand } from "./commands/agentIssueRunner.js";
import { formatAgentWritePreviewResult, runAgentWritePreviewCommand } from "./commands/agentWritePreview.js";
import { formatAgentValidateResult, runAgentValidateCommand } from "./commands/agentValidate.js";
import { formatToolsRegistry, runToolsCommand } from "./commands/tools.js";
import { formatSchemasVerifyResult, runSchemasVerifyCommand } from "./commands/schemas.js";
import { formatContextLedger, runContextCommand } from "./commands/context.js";
import { formatMcpManifest, runMcpCommand } from "./commands/mcp.js";
import { formatLLMDecision, formatLLMUsage, runLLMCommand, runLLMDecisionCommand } from "./commands/llm.js";
import { formatRiskRegister, runRiskCommand } from "./commands/risk.js";
import { formatReadinessReport, runReadinessCommand } from "./commands/readiness.js";
import { formatSetupProgress, runSetupStatusCommand } from "./commands/setupStatus.js";
import { formatRunbookReport, runRunbookCommand } from "./commands/runbook.js";
import { formatSnapshotResult, runSnapshotCommand } from "./commands/snapshot.js";
import { formatSecurityAudit, runSecurityCommand } from "./commands/security.js";
import { formatPathScanResult, runPathScanCommand } from "./commands/pathScan.js";
import { formatCostsReport, runCostsCommand } from "./commands/costs.js";
import { formatAnalyzeSummary, runAnalyzeCommand } from "./commands/analyze.js";
import {
  formatGraphImpact,
  formatGraphNode,
  formatGraphSearch,
  formatGraphSummary,
  runGraphContractCommand,
  runGraphImpactCommand,
  runGraphMutationCommand,
  runGraphNodeCommand,
  runGraphRouteCommand,
  runGraphSearchCommand,
  ensureVisualGraph
} from "./commands/graph.js";
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
  .command("pipeline")
  .description("Run the end-to-end Visual Hive operational pipeline and write .visual-hive/pipeline.json")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .option("--mode <mode>", "pipeline mode: pr, schedule, manual, canary, mutation, or full", "pr")
  .option("--changed-files <path>", "newline-delimited changed files")
  .option("--base <ref>", "git base ref for diff")
    .option("--ci", "run the deterministic verification pass with CI baseline enforcement")
    .option("--bootstrap-baselines", "seed missing baselines in a non-strict local/trusted pass before strict CI")
    .option("--skip-install", "skip target install commands during deterministic runs")
    .option("--skip-build", "skip target build commands during deterministic runs")
    .option("--enforce-mutation", "run mutation checks and fail when the configured minimum score is not met")
  .option("--continue-on-error", "record downstream evidence after non-oracle pipeline step failures")
  .option("--github-step-summary", "append the markdown report to GITHUB_STEP_SUMMARY when present")
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (options) => {
    try {
      const result = await runPipelineCommand({
        config: options.config,
        mode: options.mode,
        changedFiles: options.changedFiles,
        base: options.base,
          ci: options.ci,
          bootstrapBaselines: options.bootstrapBaselines,
          skipInstall: options.skipInstall,
          skipBuild: options.skipBuild,
          enforceMutation: options.enforceMutation,
        continueOnError: options.continueOnError,
        githubStepSummary: options.githubStepSummary
      });
      console.log(formatPipelineSummary(result, options.format));
      process.exitCode = result.exitCode;
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

providersCommand
  .command("upload")
  .description("Upload staged Visual Hive artifacts to an optional hosted provider")
  .requiredOption("--provider <id>", "provider id; Argos is currently implemented")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .option("--report <path>", "deterministic report path", ".visual-hive/report.json")
  .option("--dry-run", "stage artifacts and write manifests without making external calls")
  .option("--format <format>", "markdown or json", "markdown")
  .option("--fail-on-provider-failure", "exit nonzero when provider upload fails or policy enforcement requests failure")
  .action(async (options) => {
    try {
      const result = await runProviderUploadCommand({
        config: options.config,
        providerId: options.provider,
        report: options.report,
        dryRun: options.dryRun,
        format: options.format,
        failOnProviderFailure: options.failOnProviderFailure
      });
      console.log(formatProviderUpload(result, options.format));
      process.exitCode = result.exitCode;
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

const issuesCommand = program
  .command("issues")
  .description("Generate stable deduplicated GitHub issue candidates from Visual Hive evidence")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .option("--write", "write .visual-hive/issues.json, issues.md, issue-queue.json, and setup-issue.md")
  .option("--format <format>", "markdown or json", "markdown")
  .option("--kind <kind>", "filter issue candidates by issue kind")
  .option("--min-severity <severity>", "filter issue candidates by minimum severity: low, medium, high, critical")
  .action(async (options) => {
    try {
      const result = await runIssuesCommand({
        config: options.config,
        write: options.write,
        format: options.format,
        kind: options.kind,
        minSeverity: options.minSeverity
      });
      console.log(formatIssuesResult(result, options.format));
    } catch (error) {
      fail(error);
    }
  });

issuesCommand
  .command("publish")
  .description("Write trusted issue publishing plan and dry-run artifacts from Visual Hive issue candidates")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .option("--issues <path>", "issues artifact path", ".visual-hive/issues.json")
  .option("--handoff-validation <path>", "handoff validation artifact path", ".visual-hive/hive-handoff-validation.json")
  .option("--dry-run", "write no-network issue publish dry-run artifacts", true)
  .option("--mode <mode>", "publish mode: dry_run or live", "dry_run")
  .option("--live", "attempt guarded live GitHub issue create/update; requires VISUAL_HIVE_LIVE_GITHUB_ISSUE=true and a token")
  .option("--repo <owner/repo>", "GitHub repository for live issue publishing; defaults to GITHUB_REPOSITORY")
  .option("--token-env <name>", "environment variable containing the GitHub token for live publishing")
  .option("--live-guard-env <name>", "environment variable that must be set to true for live publishing", "VISUAL_HIVE_LIVE_GITHUB_ISSUE")
  .option("--dedupe <fingerprint>", "publish only the issue candidate matching this dedupe fingerprint")
  .option("--kind <kind>", "publish only issue candidates of this kind")
  .option("--min-severity <severity>", "publish only issue candidates at or above this severity: low, medium, high, critical")
  .option("--limit <number>", "maximum number of matching issue candidates to publish", parseIntegerOption)
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (options, command: Command) => {
    try {
      const result = await runIssuePublishCommand({
        config: nestedConfigOption(options, command),
        issues: options.issues,
        handoffValidation: options.handoffValidation,
        dryRun: options.dryRun,
        live: options.live,
        mode: options.mode,
        repository: options.repo,
        tokenEnv: options.tokenEnv,
        liveGuardEnv: options.liveGuardEnv,
        dedupe: options.dedupe,
        kind: options.kind,
        minSeverity: options.minSeverity,
        limit: options.limit,
        format: options.format
      });
      console.log(formatIssuePublishResult(result, options.format));
      if (result.result.status === "blocked" || result.result.status === "failed") {
        process.exitCode = 1;
      }
    } catch (error) {
      fail(error);
    }
  });

issuesCommand
  .command("setup-publish")
  .description("Write trusted setup-issue publishing plan and dry-run artifacts from .visual-hive/setup-issue.md")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .option("--setup-issue <path>", "setup issue markdown path", ".visual-hive/setup-issue.md")
  .option("--handoff-validation <path>", "handoff validation artifact path", ".visual-hive/hive-handoff-validation.json")
  .option("--dry-run", "write no-network setup issue publish dry-run artifacts", true)
  .option("--mode <mode>", "publish mode: dry_run or live", "dry_run")
  .option("--live", "attempt guarded live GitHub setup issue create/update; requires VISUAL_HIVE_LIVE_GITHUB_ISSUE=true and a token")
  .option("--repo <owner/repo>", "GitHub repository for live setup issue publishing; defaults to GITHUB_REPOSITORY")
  .option("--token-env <name>", "environment variable containing the GitHub token for live publishing")
  .option("--live-guard-env <name>", "environment variable that must be set to true for live publishing", "VISUAL_HIVE_LIVE_GITHUB_ISSUE")
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (options, command: Command) => {
    try {
      const result = await runSetupIssuePublishCommand({
        config: nestedConfigOption(options, command),
        setupIssue: options.setupIssue,
        handoffValidation: options.handoffValidation,
        dryRun: options.dryRun,
        live: options.live,
        mode: options.mode,
        repository: options.repo,
        tokenEnv: options.tokenEnv,
        liveGuardEnv: options.liveGuardEnv,
        format: options.format
      });
      console.log(formatSetupIssuePublishResult(result, options.format));
      if (result.result.status === "blocked" || result.result.status === "failed") {
        process.exitCode = 1;
      }
    } catch (error) {
      fail(error);
    }
  });

program
  .command("evidence")
  .description("Compose sanitized Visual Hive evidence packet and verdict summary from latest artifacts")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .option("--output <path>", "evidence packet output path", ".visual-hive/evidence-packet.json")
  .option("--markdown <path>", "evidence summary markdown output path", ".visual-hive/evidence-summary.md")
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (options) => {
    try {
      const result = await runEvidenceCommand({
        config: options.config,
        output: options.output,
        markdown: options.markdown,
        format: options.format
      });
      console.log(formatEvidencePacket(result, options.format));
    } catch (error) {
      fail(error);
    }
  });

program
  .command("verdict")
  .description("Write the standalone Visual Hive verdict report from normalized evidence")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .option("--evidence <path>", "evidence packet path", ".visual-hive/evidence-packet.json")
  .option("--output <path>", "write verdict JSON to this path relative to the config root", ".visual-hive/verdict.json")
  .option("--markdown <path>", "write verdict Markdown summary to this path relative to the config root", ".visual-hive/verdict.md")
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (options) => {
    try {
      const result = await runVerdictCommand({
        config: options.config,
        evidence: options.evidence,
        output: options.output,
        markdown: options.markdown,
        format: options.format
      });
      console.log(formatVerdictReport(result, options.format));
    } catch (error) {
      fail(error);
    }
  });

program
  .command("layers")
  .description("Write the Visual Hive testing-layer audit from normalized evidence")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .option("--evidence <path>", "evidence packet path", ".visual-hive/evidence-packet.json")
  .option("--output <path>", "write layer audit JSON to this path relative to the config root", ".visual-hive/testing-layers.json")
  .option("--markdown <path>", "write layer audit Markdown summary to this path relative to the config root", ".visual-hive/testing-layers.md")
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (options) => {
    try {
      const result = await runLayersCommand({
        config: options.config,
        evidence: options.evidence,
        output: options.output,
        markdown: options.markdown,
        format: options.format
      });
      console.log(formatLayersReport(result, options.format));
    } catch (error) {
      fail(error);
    }
  });

program
  .command("test-creation-plan")
  .description("Write an advisory no-write test creation plan from evidence, layers, coverage, and handoff work")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .option("--evidence <path>", "Evidence Packet path", ".visual-hive/evidence-packet.json")
  .option("--coverage-recommendations <path>", "coverage recommendations path", ".visual-hive/coverage-recommendations.json")
  .option("--handoff <path>", "Handoff Packet path", ".visual-hive/handoff.json")
  .option("--output <path>", "test creation plan JSON output path", ".visual-hive/test-creation-plan.json")
  .option("--markdown <path>", "test creation plan Markdown output path", ".visual-hive/test-creation-plan.md")
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (options) => {
    try {
      const result = await runTestCreationPlanCommand({
        config: options.config,
        evidence: options.evidence,
        coverageRecommendations: options.coverageRecommendations,
        handoff: options.handoff,
        output: options.output,
        markdown: options.markdown,
        format: options.format
      });
      console.log(formatTestCreationPlan(result, options.format));
    } catch (error) {
      fail(error);
    }
  });

program
  .command("handoff")
  .description("Write no-network GitHub/Hive handoff artifacts from the latest Evidence Packet")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .option("--evidence <path>", "evidence packet path", ".visual-hive/evidence-packet.json")
  .option("--mode <mode>", "handoff mode: dry_run, github_issue, or bead_api", "dry_run")
  .option("--dry-run", "force dry-run mode with zero external calls")
  .option("--label <label>", "handoff label (repeatable)", collectRepeatable, [])
  .option("--agent <agent>", "Hive agent name for the bead dry-run request")
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (options) => {
    try {
      const result = await runHandoffCommand({
        config: options.config,
        evidence: options.evidence,
        mode: options.dryRun ? "dry_run" : options.mode,
        label: options.label,
        agent: options.agent
      });
      console.log(formatHandoffResult(result, options.format));
    } catch (error) {
      fail(error);
    }
  });

program
  .command("handoff-validate")
  .description("Validate no-network GitHub/Hive handoff artifacts before trusted workflow consumption")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .option("--evidence <path>", "evidence packet path", ".visual-hive/evidence-packet.json")
  .option("--handoff <path>", "handoff packet path", ".visual-hive/handoff.json")
  .option("--issue <path>", "Hive issue body path", ".visual-hive/hive-issue.md")
  .option("--bead-request <path>", "Hive bead request path", ".visual-hive/hive-bead-request.json")
  .option("--result <path>", "Hive handoff result path", ".visual-hive/hive-handoff-result.json")
  .option("--output <path>", "validation artifact path", ".visual-hive/hive-handoff-validation.json")
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (options) => {
    try {
      const result = await runHandoffValidateCommand({
        config: options.config,
        evidence: options.evidence,
        handoff: options.handoff,
        issue: options.issue,
        beadRequest: options.beadRequest,
        result: options.result,
        output: options.output,
        format: options.format
      });
      console.log(formatHandoffValidation(result, options.format));
      process.exitCode = result.exitCode;
    } catch (error) {
      fail(error);
    }
  });

const hiveCommand = program.command("hive").description("Export Hive-native beads, knowledge, graph, and guarded repair artifacts");

hiveCommand
  .command("export")
  .description("Write a no-network Hive-native export bundle from Visual Hive evidence")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .option("--evidence <path>", "evidence packet path", ".visual-hive/evidence-packet.json")
  .option("--handoff <path>", "handoff packet path", ".visual-hive/handoff.json")
  .option("--output-dir <path>", "Hive export artifact directory", ".visual-hive/hive")
  .option("--mode <mode>", "Hive mode: advisory, measured, repair_request, guarded_repair, full, or legacy dry_run/github_issue/bead_api")
  .option("--dry-run", "force no-network local export semantics")
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (options) => {
    try {
      const result = await runHiveExportCommand({
        config: options.config,
        evidence: options.evidence,
        handoff: options.handoff,
        outputDir: options.outputDir,
        mode: options.mode,
        dryRun: options.dryRun,
        format: options.format
      });
      console.log(formatHiveExport(result, options.format));
      if (result.bundle.status === "blocked") {
        process.exitCode = 1;
      }
    } catch (error) {
      fail(error);
    }
  });

const loop = program.command("loop").description("Run the real Visual Hive operational loop and Hive issue handoff artifacts");

loop
  .command("run")
  .description("Scan, plan, execute deterministic checks, mutation adequacy, evidence, verdict, Hive export, and real issue candidates")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .option("--mode <mode>", "loop mode: pr, schedule, manual, canary, mutation, or full", "full")
  .option("--changed-files <path>", "newline-delimited changed files")
  .option("--base <ref>", "git base ref for diff")
  .option("--ci", "run deterministic verification with CI baseline enforcement")
  .option("--bootstrap-baselines", "seed missing baselines before strict CI")
  .option("--skip-install", "skip target install commands")
  .option("--skip-build", "skip target build commands")
  .option("--include-seeded-smoke", "write an explicit seeded-smoke request marker; default live loop excludes synthetic seeded findings")
  .option("--fail-on-verdict", "exit nonzero when the deterministic/mutation/readiness verdict fails")
  .option("--github-step-summary", "append markdown report to GITHUB_STEP_SUMMARY when present")
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (options) => {
    try {
      const result = await runLoopRunCommand({
        config: options.config,
        mode: options.mode,
        changedFiles: options.changedFiles,
        base: options.base,
        ci: options.ci,
        bootstrapBaselines: options.bootstrapBaselines,
        skipInstall: options.skipInstall,
        skipBuild: options.skipBuild,
        includeSeededSmoke: options.includeSeededSmoke,
        githubStepSummary: options.githubStepSummary
      });
      console.log(formatLoopRunResult(result, options.format));
      process.exitCode = options.failOnVerdict ? result.exitCode : 0;
    } catch (error) {
      fail(error);
    }
  });

loop
  .command("derive-issues")
  .description("Derive real issue candidates from current Visual Hive artifacts")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (options) => {
    try {
      const result = await runLoopDeriveIssuesCommand({ config: options.config, write: true, format: options.format });
      console.log(formatLoopDeriveIssuesResult(result, options.format));
    } catch (error) {
      fail(error);
    }
  });

loop
  .command("lifecycle")
  .description("Write issue lifecycle policy evidence from current issue candidates")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (options) => {
    try {
      const result = await runLoopLifecycleCommand({ config: options.config, format: options.format });
      console.log(formatLoopLifecycleResult(result, options.format));
    } catch (error) {
      fail(error);
    }
  });

loop
  .command("init")
  .description("Generate a GitHub/Hive operational loop scaffold for another repository")
  .option("--profile <profile>", "loop profile", "github-hive")
  .option("--force", "overwrite existing files")
  .action(async (options) => {
    try {
      const written = await runLoopInitCommand({ profile: options.profile, force: options.force });
      console.log(`Created:\n${written.map((file) => `- ${file}`).join("\n")}`);
    } catch (error) {
      fail(error);
    }
  });

hiveCommand
  .command("beads")
  .description("Write Hive-compatible bead projection artifacts from Visual Hive evidence")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .option("--evidence <path>", "evidence packet path", ".visual-hive/evidence-packet.json")
  .option("--handoff <path>", "handoff packet path", ".visual-hive/handoff.json")
  .option("--output-dir <path>", "Hive export artifact directory", ".visual-hive/hive")
  .option("--mode <mode>", "Hive mode to use when refreshing export before bead projection", "measured")
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (options) => {
    try {
      const result = await runHiveBeadsCommand({
        config: options.config,
        evidence: options.evidence,
        handoff: options.handoff,
        outputDir: options.outputDir,
        mode: options.mode,
        format: options.format
      });
      console.log(formatHiveBeads(result, options.format));
    } catch (error) {
      fail(error);
    }
  });

hiveCommand
  .command("validate-export")
  .description("Validate Hive export artifacts, path sanitization, dedupe keys, and import readiness")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .option("--hive-export <path>", "Hive export artifact path", ".visual-hive/hive/hive-export.json")
  .option("--output-dir <path>", "Hive export artifact directory", ".visual-hive/hive")
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (options) => {
    try {
      const result = await runHiveValidateExportCommand({
        config: options.config,
        hiveExport: options.hiveExport,
        outputDir: options.outputDir,
        format: options.format
      });
      console.log(formatHiveValidateExport(result, options.format));
      if (result.validation.status === "failed") {
        process.exitCode = 1;
      }
    } catch (error) {
      fail(error);
    }
  });

hiveCommand
  .command("setup-pack")
  .description("Write a no-network one-setup pack for Hive to enable Visual QA safely")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .option("--hive-export <path>", "Hive export artifact path", ".visual-hive/hive/hive-export.json")
  .option("--output-dir <path>", "Hive setup pack artifact directory", ".visual-hive/hive")
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (options) => {
    try {
      const result = await runHiveSetupPackCommand({
        config: options.config,
        hiveExport: options.hiveExport,
        outputDir: options.outputDir,
        format: options.format
      });
      console.log(formatHiveSetupPack(result, options.format));
    } catch (error) {
      fail(error);
    }
  });

hiveCommand
  .command("integration-smoke")
  .description("Run a no-network Hive integration smoke: export, beads, validate, and setup pack")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .option("--evidence <path>", "evidence packet path", ".visual-hive/evidence-packet.json")
  .option("--handoff <path>", "handoff packet path", ".visual-hive/handoff.json")
  .option("--output-dir <path>", "Hive export artifact directory", ".visual-hive/hive")
  .option("--mode <mode>", "Hive mode to use for smoke export", "measured")
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (options) => {
    try {
      const result = await runHiveIntegrationSmokeCommand({
        config: options.config,
        evidence: options.evidence,
        handoff: options.handoff,
        outputDir: options.outputDir,
        mode: options.mode,
        format: options.format
      });
      console.log(formatHiveIntegrationSmoke(result, options.format));
      if (result.smoke.status === "failed") {
        process.exitCode = 1;
      }
    } catch (error) {
      fail(error);
    }
  });

hiveCommand
  .command("compare-modes")
  .description("Write no-network Hive export previews for advisory, measured, repair-request, guarded-repair, and full modes plus a comparison artifact")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .option("--evidence <path>", "evidence packet path", ".visual-hive/evidence-packet.json")
  .option("--handoff <path>", "handoff packet path", ".visual-hive/handoff.json")
  .option("--output-dir <path>", "Hive export artifact directory", ".visual-hive/hive")
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (options) => {
    try {
      const result = await runHiveCompareModesCommand({
        config: options.config,
        evidence: options.evidence,
        handoff: options.handoff,
        outputDir: options.outputDir,
        format: options.format
      });
      console.log(formatHiveModeComparison(result, options.format));
      if (!result.comparison.modes.some((mode) => mode.status === "ready")) {
        process.exitCode = 1;
      }
    } catch (error) {
      fail(error);
    }
  });

hiveCommand
  .command("guarded-repair-preview")
  .description("Write a no-network guarded repair preview from Hive repair work orders and agent policy")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .option("--hive-export <path>", "Hive export artifact path", ".visual-hive/hive/hive-export.json")
  .option("--output-dir <path>", "Hive repair-chain artifact output directory", ".visual-hive/hive")
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (options) => {
    try {
      const result = await runHiveGuardedRepairPreviewCommand({
        config: options.config,
        hiveExport: options.hiveExport,
        outputDir: options.outputDir,
        format: options.format
      });
      console.log(formatHiveGuardedRepairPreview(result, options.format));
    } catch (error) {
      fail(error);
    }
  });

hiveCommand
  .command("repair-request-envelope")
  .description("Write a no-network trusted repair request envelope from the guarded repair preview")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .option("--guarded-repair-preview <path>", "guarded repair preview artifact path", ".visual-hive/hive/guarded-repair-preview.json")
  .option("--output-dir <path>", "Hive repair-chain artifact output directory", ".visual-hive/hive")
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (options) => {
    try {
      const result = await runHiveRepairRequestEnvelopeCommand({
        config: options.config,
        guardedRepairPreview: options.guardedRepairPreview,
        outputDir: options.outputDir,
        format: options.format
      });
      console.log(formatHiveRepairRequestEnvelope(result, options.format));
    } catch (error) {
      fail(error);
    }
  });

hiveCommand
  .command("trusted-repair-consumer-summary")
  .description("Write a no-network trusted repair consumer summary from the repair request envelope")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .option("--repair-request-envelope <path>", "repair request envelope artifact path", ".visual-hive/hive/repair-request-envelope.json")
  .option("--output-dir <path>", "Hive repair-chain artifact output directory", ".visual-hive/hive")
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (options) => {
    try {
      const result = await runHiveTrustedRepairConsumerSummaryCommand({
        config: options.config,
        repairRequestEnvelope: options.repairRequestEnvelope,
        outputDir: options.outputDir,
        format: options.format
      });
      console.log(formatHiveTrustedRepairConsumerSummary(result, options.format));
    } catch (error) {
      fail(error);
    }
  });

hiveCommand
  .command("trusted-repair-workflow-dry-run")
  .description("Write a no-network dry-run plan for a future trusted repair workflow")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .option("--trusted-repair-consumer-summary <path>", "trusted repair consumer summary artifact path", ".visual-hive/hive/trusted-repair-consumer-summary.json")
  .option("--output-dir <path>", "Hive repair-chain artifact output directory", ".visual-hive/hive")
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (options) => {
    try {
      const result = await runHiveTrustedRepairWorkflowDryRunCommand({
        config: options.config,
        trustedRepairConsumerSummary: options.trustedRepairConsumerSummary,
        outputDir: options.outputDir,
        format: options.format
      });
      console.log(formatHiveTrustedRepairWorkflowDryRun(result, options.format));
    } catch (error) {
      fail(error);
    }
  });

program
  .command("agent-packet")
  .description("Write a role-specific agent packet from Evidence/Handoff artifacts")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .option("--evidence <path>", "evidence packet path", ".visual-hive/evidence-packet.json")
  .option("--handoff <path>", "handoff packet path", ".visual-hive/handoff.json")
  .option("--test-creation-plan <path>", "test creation plan path", ".visual-hive/test-creation-plan.json")
  .option("--profile <profile>", "repair_agent, test_creator, review_agent, handoff_agent, or provider_specialist", "repair_agent")
  .option("--output <path>", "agent packet output path", ".visual-hive/agent-packet.json")
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (options) => {
    try {
      const result = await runAgentPacketCommand({
        config: options.config,
        evidence: options.evidence,
        handoff: options.handoff,
        testCreationPlan: options.testCreationPlan,
        profile: options.profile,
        output: options.output,
        format: options.format
      });
      console.log(formatAgentPacketResult(result, options.format));
    } catch (error) {
      fail(error);
    }
  });

const agentCommand = program.command("agent").description("Issue-driven Visual Hive agent handoff utilities");

agentCommand
  .command("issue-runner")
  .description("Build a bounded no-write issue-agent request/output bundle from .visual-hive/issues.json")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .option("--issues <path>", "issue candidates path", ".visual-hive/issues.json")
  .option("--dedupe <fingerprint>", "dedupe fingerprint of the issue candidate to run")
  .option("--issue-index <number>", "zero-based issue index when --dedupe is not provided", parseIntegerOption)
  .option("--kind <kind>", "select the first active issue candidate of this issue kind")
  .option("--output-dir <path>", "directory for agent-request.md, agent-output.md, and agent-run.json")
  .option("--allow-write", "mark the run as write-preview capable; default remains no-write and performs no code edits")
  .option("--codex-command <command>", "Codex CLI command name to record in the request", "codex")
  .option("--codex-discovery-timeout-ms <number>", "maximum Codex CLI --help discovery time in milliseconds", parseIntegerOption)
  .option("--execute-agent", "execute the configured local issue-agent command; disabled by default")
  .option("--agent-command <command>", "local agent command to execute when --execute-agent is set")
  .option("--agent-arg <arg...>", "argument(s) for --agent-command; repeat after --agent-arg or pass values after it")
  .option("--agent-timeout-ms <number>", "maximum guarded agent command runtime in milliseconds", parseIntegerOption)
  .option("--allow-external-network", "allow explicitly configured agent command to use external network; disabled by default")
  .option("--max-external-cost-usd <number>", "maximum external cost budget for explicitly configured agent execution", parseNumberOption)
  .option("--max-runtime-ms <number>", "maximum future agent runtime budget in milliseconds", parseIntegerOption)
  .option("--max-tool-calls <number>", "maximum future tool-call budget", parseIntegerOption)
  .option("--max-prompt-tokens <number>", "maximum prompt-token budget", parseIntegerOption)
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (options, command: Command) => {
    try {
      const result = await runAgentIssueRunnerCommand({
        config: nestedConfigOption(options, command),
        issues: options.issues,
        dedupe: options.dedupe,
        issueIndex: options.issueIndex,
        kind: options.kind,
        outputDir: options.outputDir,
        allowWrite: options.allowWrite,
        codexCommand: options.codexCommand,
        codexDiscoveryTimeoutMs: options.codexDiscoveryTimeoutMs,
        executeAgent: options.executeAgent,
        agentCommand: options.agentCommand,
        agentArgs: options.agentArg,
        agentTimeoutMs: options.agentTimeoutMs,
        allowExternalNetwork: options.allowExternalNetwork,
        maxExternalCostUsd: options.maxExternalCostUsd,
        maxRuntimeMs: options.maxRuntimeMs,
        maxToolCalls: options.maxToolCalls,
        maxPromptTokens: options.maxPromptTokens,
        format: options.format
      });
      console.log(formatAgentIssueRunnerResult(result, options.format));
      if (result.run.status === "blocked" && result.run.agentExecution.enabled) {
        process.exitCode = 1;
      }
    } catch (error) {
      fail(error);
    }
  });

agentCommand
  .command("validate")
  .description("Validate issue-agent request/output/run artifacts and no-write safety counters")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .option("--agents-dir <path>", "agent artifacts directory", ".visual-hive/agents")
  .option("--dedupe <fingerprint>", "validate only one issue dedupe fingerprint")
  .option("--allow-write-artifacts", "allow nonzero write-related counters for explicitly trusted write-preview validation")
  .option("--output <path>", "validation artifact path", ".visual-hive/agent-validation.json")
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (options, command: Command) => {
    try {
      const result = await runAgentValidateCommand({
        config: nestedConfigOption(options, command),
        agentsDir: options.agentsDir,
        dedupe: options.dedupe,
        allowWriteArtifacts: options.allowWriteArtifacts,
        output: options.output,
        format: options.format
      });
      console.log(formatAgentValidateResult(result, options.format));
      if (result.report.status === "failed") {
        process.exitCode = 1;
      }
    } catch (error) {
      fail(error);
    }
  });

agentCommand
  .command("write-preview")
  .description("Plan or create a guarded local write-preview branch for one issue candidate; no push or PR by default")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .option("--issues <path>", "issue candidates path", ".visual-hive/issues.json")
  .option("--dedupe <fingerprint>", "dedupe fingerprint of the issue candidate to preview")
  .option("--issue-index <number>", "zero-based issue index when --dedupe is not provided", parseIntegerOption)
  .option("--allow-write", "explicitly allow write-preview mode")
  .option("--write-preview-branch", "explicitly create the local preview branch")
  .option("--allow-dirty", "allow branch creation from a dirty working tree in a trusted local context")
  .option("--commit-preview", "commit changed files after preview work; disabled by default")
  .option("--output <path>", "write-preview artifact path")
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (options, command: Command) => {
    try {
      const result = await runAgentWritePreviewCommand({
        config: nestedConfigOption(options, command),
        issues: options.issues,
        dedupe: options.dedupe,
        issueIndex: options.issueIndex,
        allowWrite: options.allowWrite,
        writePreviewBranch: options.writePreviewBranch,
        allowDirty: options.allowDirty,
        commitPreview: options.commitPreview,
        output: options.output,
        format: options.format
      });
      console.log(formatAgentWritePreviewResult(result, options.format));
      if (result.preview.status === "blocked") {
        process.exitCode = 1;
      }
    } catch (error) {
      fail(error);
    }
  });

program
  .command("tools")
  .description("Write the agent-facing Tool Registry and compact Tool Cards")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .option("--output <path>", "tool registry output path", ".visual-hive/tools/tool-registry.json")
  .option("--markdown <path>", "tool cards markdown output path", ".visual-hive/tools/tool-cards.md")
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (options) => {
    try {
      const result = await runToolsCommand({
        config: options.config,
        output: options.output,
        markdown: options.markdown,
        format: options.format
      });
      console.log(formatToolsRegistry(result, options.format));
    } catch (error) {
      fail(error);
    }
  });

const schemas = program.command("schemas").description("Verify checked-in Visual Hive JSON Schemas against core catalog metadata");

schemas
  .command("verify")
  .description("Check schema IDs and evidence-resource enum parity")
  .option("--schemas-dir <path>", "schemas directory", "schemas")
  .option("--output <path>", "optional JSON report path")
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (options) => {
    try {
      const result = await runSchemasVerifyCommand({
        schemasDir: options.schemasDir,
        output: options.output,
        format: options.format
      });
      console.log(formatSchemasVerifyResult(result, options.format));
      if (result.report.status !== "passed") {
        process.exitCode = 1;
      }
    } catch (error) {
      fail(error);
    }
  });

program
  .command("context")
  .description("Write the agent-facing Context Ledger for tool, token, provider, and escalation budgets")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .option("--output <path>", "context ledger output path", ".visual-hive/context-ledger.json")
  .option("--max-tool-calls <number>", "override max tool-call budget for this ledger", parseIntegerOption)
  .option("--max-tool-result-tokens <number>", "override max tool-result-token budget for this ledger", parseIntegerOption)
  .option("--max-external-cost-usd <number>", "override max external-cost budget for this ledger", parseNumberOption)
  .option("--max-provider-screenshots <number>", "override max provider screenshot budget for this ledger", parseIntegerOption)
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (options) => {
    try {
      const result = await runContextCommand({
        config: options.config,
        output: options.output,
        format: options.format,
        maxToolCalls: options.maxToolCalls,
        maxToolResultTokens: options.maxToolResultTokens,
        maxExternalCostUsd: options.maxExternalCostUsd,
        maxProviderScreenshots: options.maxProviderScreenshots
      });
      console.log(formatContextLedger(result, options.format));
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
  .option("--repo <path>", "repository root to index when a Visual Hive config is not available")
  .option("--project <name>", "project name to use with --repo; defaults to the repository directory name")
  .option("--max-artifacts <count>", "maximum artifact entries to index", (value) => Number.parseInt(value, 10))
  .option("--max-preview-bytes <count>", "maximum bytes to preview for text-like artifacts", (value) => Number.parseInt(value, 10))
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (options) => {
    try {
      const result = await runArtifactsCommand({
        config: options.config,
        repo: options.repo,
        project: options.project,
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
  .option("--provider-handoff <path>", "provider handoff artifact path", ".visual-hive/provider-handoff.json")
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
        providerHandoff: options.providerHandoff,
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
  .command("snapshot")
  .description("Write the local Control Plane snapshot as a schema-validated artifact")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .option("--repo <path>", "target repository path")
  .option("--output <path>", "snapshot output path relative to the config root", ".visual-hive/control-plane-snapshot.json")
  .option("--read-only", "build the snapshot in read-only mode", true)
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (options) => {
    try {
      const result = await runSnapshotCommand({
        config: options.config,
        repo: options.repo,
        output: options.output,
        readOnly: options.readOnly,
        format: options.format
      });
      console.log(formatSnapshotResult(result, options.format));
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
  .command("path-scan")
  .description("Scan issue-facing Visual Hive artifacts for local absolute path leaks before trusted publishing")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .option("--artifact-root <path>", "Visual Hive artifact root to scan", ".visual-hive")
  .option("--output <path>", "path leak scan artifact path", ".visual-hive/path-leak-scan.json")
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (options) => {
    try {
      const result = await runPathScanCommand({
        config: options.config,
        artifactRoot: options.artifactRoot,
        output: options.output,
        format: options.format
      });
      console.log(formatPathScanResult(result, options.format));
      if (result.report.status === "failed") {
        process.exitCode = 1;
      }
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
  .command("analyze")
  .description("Scan a repository and write read-only repo intelligence artifacts")
  .option("--repo <path>", "repository root to scan", ".")
  .option("--out <path>", "repo map JSON output path", ".visual-hive/repo-map.json")
  .option("--markdown <path>", "repo context markdown output path", ".visual-hive/repo-context.md")
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (options) => {
    try {
      const result = await runAnalyzeCommand({
        repo: options.repo,
        output: options.out,
        markdown: options.markdown,
        format: options.format
      });
      console.log(formatAnalyzeSummary(result, options.format));
    } catch (error) {
      fail(error);
    }
  });

const graph = program.command("graph").description("Query Visual Hive Visual Graph evidence");

graph
  .command("summary")
  .description("Print the Visual Graph summary")
  .option("--repo <path>", "repository root", ".")
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (options) => {
    try {
      const result = await ensureVisualGraph(options.repo);
      console.log(formatGraphSummary(result.graph, options.format));
    } catch (error) {
      fail(error);
    }
  });

graph
  .command("search <query>")
  .description("Search graph nodes by selector, route, contract, screenshot, mutation, issue, or label")
  .option("--repo <path>", "repository root", ".")
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (query, options) => {
    try {
      const result = await runGraphSearchCommand(query, { repo: options.repo, format: options.format });
      console.log(formatGraphSearch(result, options.format));
    } catch (error) {
      fail(error);
    }
  });

graph
  .command("node <id>")
  .description("Show a graph node and its adjacent edges")
  .option("--repo <path>", "repository root", ".")
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (id, options) => {
    try {
      const result = await runGraphNodeCommand(id, { repo: options.repo, format: options.format });
      console.log(formatGraphNode(result, options.format));
    } catch (error) {
      fail(error);
    }
  });

graph
  .command("impact")
  .description("Write or print blast-radius evidence for changed files, issue, contract, mutation, or route")
  .option("--repo <path>", "repository root", ".")
  .option("--changed-files <path>", "newline-delimited changed files")
  .option("--issue <fingerprint>", "issue candidate fingerprint or node id")
  .option("--contract <id>", "contract id")
  .option("--mutation <operator>", "mutation operator")
  .option("--route <route>", "route path")
  .option("--output <path>", "output path", ".visual-hive/visual-impact.json")
  .option("--no-write", "do not write visual-impact.json")
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (options) => {
    try {
      const result = await runGraphImpactCommand({
        repo: options.repo,
        changedFiles: options.changedFiles,
        issue: options.issue,
        contract: options.contract,
        mutation: options.mutation,
        route: options.route,
        output: options.output,
        write: options.write,
        format: options.format
      });
      console.log(formatGraphImpact(result, options.format));
    } catch (error) {
      fail(error);
    }
  });

graph
  .command("route <route>")
  .description("Show graph impact for a route")
  .option("--repo <path>", "repository root", ".")
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (route, options) => {
    try {
      const result = await runGraphRouteCommand(route, { repo: options.repo, format: options.format });
      console.log(formatGraphImpact(result, options.format));
    } catch (error) {
      fail(error);
    }
  });

graph
  .command("contract <contractId>")
  .description("Show graph impact for a contract")
  .option("--repo <path>", "repository root", ".")
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (contractId, options) => {
    try {
      const result = await runGraphContractCommand(contractId, { repo: options.repo, format: options.format });
      console.log(formatGraphImpact(result, options.format));
    } catch (error) {
      fail(error);
    }
  });

graph
  .command("mutation <operatorId>")
  .description("Show graph impact for a mutation operator")
  .option("--repo <path>", "repository root", ".")
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (operatorId, options) => {
    try {
      const result = await runGraphMutationCommand(operatorId, { repo: options.repo, format: options.format });
      console.log(formatGraphImpact(result, options.format));
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
  .command("mcp")
  .description("Expose Visual Hive read-only artifacts and advisory tools over MCP stdio")
  .option("--config <path>", "config path", "visual-hive.config.yaml")
  .option("--repo <path>", "repository root for setup-only MCP manifest when a Visual Hive config is not available")
  .option("--project <name>", "project name to use with --repo; defaults to the repository directory name")
  .option("--stdio", "start the MCP stdio server")
  .option("--describe", "print the MCP manifest and exit")
  .option("--output <path>", "write the MCP manifest JSON relative to the config root, or repo root when --repo is used")
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (options) => {
    try {
      if (options.stdio && options.describe) {
        throw new Error("Use either visual-hive mcp --stdio for an MCP client or visual-hive mcp --describe for a human-readable manifest, not both.");
      }
      const manifest = await runMcpCommand({
        config: options.config,
        repo: options.repo,
        project: options.project,
        stdio: options.stdio,
        output: options.output
      });
      if (!options.stdio || options.describe) {
        console.log(formatMcpManifest(manifest, options.format));
      }
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

function parseIntegerOption(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0 || String(parsed) !== value.trim()) {
    throw new Error(`Expected a non-negative integer, received "${value}".`);
  }
  return parsed;
}

function parseNumberOption(value: string): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Expected a non-negative number, received "${value}".`);
  }
  return parsed;
}

function nestedConfigOption(options: { config?: string }, command: Command): string | undefined {
  const parentConfig = command.parent?.opts<{ config?: string }>().config;
  if (options.config && options.config !== "visual-hive.config.yaml") return options.config;
  if (parentConfig && parentConfig !== "visual-hive.config.yaml") return parentConfig;
  return options.config ?? parentConfig;
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
