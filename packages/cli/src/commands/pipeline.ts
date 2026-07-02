import path from "node:path";
import { loadConfig, readJson, sanitizeText, writeJson, writeText, type PlanMode, type Report } from "@visual-hive/core";
import { runAgentPacketCommand } from "./agentPacket.js";
import { runAnalyzeCommand } from "./analyze.js";
import { runArtifactsCommand } from "./artifacts.js";
import { formatBaselineList, runBaselineListCommand } from "./baselines.js";
import { runContractsCommand } from "./contracts.js";
import { runCostsCommand } from "./costs.js";
import { runCoverageCommand } from "./coverage.js";
import { runDoctor } from "./doctor.js";
import { runFlowsCommand } from "./flows.js";
import { runHandoffCommand, runHandoffValidateCommand } from "./handoff.js";
import { runHistoryCommand } from "./history.js";
import { runImproveCoverageCommand } from "./improve.js";
import { runLayersCommand } from "./layers.js";
import { runMutateCommand } from "./mutate.js";
import { runPlanCommand } from "./plan.js";
import { runProvidersMockCommand } from "./providers.js";
import { runReadinessCommand } from "./readiness.js";
import { runReportCommand } from "./report.js";
import { runRiskCommand } from "./risk.js";
import { runSchedulesCommand } from "./schedules.js";
import { runSecurityCommand } from "./security.js";
import { runTargetsCommand } from "./targets.js";
import { runTestCreationPlanCommand } from "./testCreationPlan.js";
import { runToolsCommand } from "./tools.js";
import { runTriageCommand } from "./triage.js";
import { runVerdictCommand } from "./verdict.js";
import { runWorkflowsCommand } from "./workflows.js";
import { runDeterministicCommand } from "./run.js";
import { runContextCommand } from "./context.js";
import { runEvidenceCommand } from "./evidence.js";

export interface PipelineCommandOptions {
  config?: string;
  cwd?: string;
  mode?: PlanMode;
  changedFiles?: string;
  base?: string;
  ci?: boolean;
  bootstrapBaselines?: boolean;
  enforceMutation?: boolean;
  continueOnError?: boolean;
  githubStepSummary?: boolean;
  skipInstall?: boolean;
  skipBuild?: boolean;
}

export type PipelineStepStatus = "passed" | "failed" | "skipped";
export type PipelineFinalStatus = "passed" | "failed" | "blocked";

export interface PipelineStepResult {
  id: string;
  label: string;
  status: PipelineStepStatus;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  exitCode: number;
  artifacts: string[];
  message?: string;
}

export interface PipelineReport {
  schemaVersion: 1;
  project: string;
  mode: PlanMode;
  generatedAt: string;
  status: PipelineFinalStatus;
  exitCode: number;
  rootCause?: string;
  options: {
    ci: boolean;
    bootstrapBaselines: boolean;
    enforceMutation: boolean;
    continueOnError: boolean;
    skipInstall: boolean;
    skipBuild: boolean;
    changedFiles?: string;
    base?: string;
  };
  steps: PipelineStepResult[];
  artifacts: string[];
}

export interface PipelineCommandResult {
  report: PipelineReport;
  reportPath: string;
  exitCode: number;
}

interface PipelineContext {
  cwd: string;
  config?: string;
  rootDir: string;
  project: string;
  mode: PlanMode;
  options: Required<Pick<PipelineCommandOptions, "ci" | "bootstrapBaselines" | "enforceMutation" | "continueOnError">> &
    Required<Pick<PipelineCommandOptions, "skipInstall" | "skipBuild">> &
    Pick<PipelineCommandOptions, "changedFiles" | "base">;
  steps: PipelineStepResult[];
  deterministicExitCode: number;
  mutationExitCode: number;
  readinessBlocked: boolean;
  intentionalNoContracts: boolean;
}

export async function runPipelineCommand(options: PipelineCommandOptions = {}): Promise<PipelineCommandResult> {
  const cwd = options.cwd ?? process.cwd();
  if (options.bootstrapBaselines && isUntrustedPullRequestCi()) {
    throw new Error(
      "Refusing to bootstrap baselines in untrusted pull_request CI. Run baseline bootstrap locally or from a trusted branch workflow, then review the created images before strict CI."
    );
  }
  const loaded = await loadConfig(options.config, cwd);
  const context: PipelineContext = {
    cwd,
    config: options.config,
    rootDir: loaded.rootDir,
    project: loaded.config.project.name,
    mode: options.mode ?? "pr",
    options: {
      ci: Boolean(options.ci),
      bootstrapBaselines: Boolean(options.bootstrapBaselines),
      enforceMutation: Boolean(options.enforceMutation),
      continueOnError: Boolean(options.continueOnError),
      skipInstall: Boolean(options.skipInstall),
      skipBuild: Boolean(options.skipBuild),
      changedFiles: options.changedFiles,
      base: options.base
    },
    steps: [],
    deterministicExitCode: 0,
    mutationExitCode: 0,
    readinessBlocked: false,
    intentionalNoContracts: false
  };

  await runStep(context, "doctor", "Doctor", async () => {
    const result = await runDoctor({ config: options.config, cwd });
    if (!result.ok) {
      throw new Error(result.diagnostics.filter((diagnostic) => !diagnostic.ok).map((diagnostic) => diagnostic.detail).join("; "));
    }
    return { artifacts: [] };
  });

  await runStep(context, "analyze", "Repo Intelligence", async () => {
    await runAnalyzeCommand({ repo: context.rootDir });
    return { artifacts: [".visual-hive/repo-map.json", ".visual-hive/repo-context.md"] };
  });

  await runStep(context, "plan", "Plan", async () => {
    await runPlanCommand({
      config: options.config,
      cwd,
      mode: context.mode,
      changedFiles: options.changedFiles,
      base: options.base
    });
    return { artifacts: [".visual-hive/plan.json"] };
  });

  if (options.bootstrapBaselines) {
    await runStep(context, "baseline-bootstrap-run", "Bootstrap Baseline Seed Run", async () => {
      const exitCode = await withVisualHiveCiOverride("false", () =>
        runDeterministicCommand({
          config: options.config,
          cwd,
          ci: false,
          skipInstall: options.skipInstall,
          skipBuild: options.skipBuild
        })
      );
      context.deterministicExitCode = Math.max(context.deterministicExitCode, exitCode);
      return { exitCode, artifacts: [".visual-hive/report.json", ".visual-hive/generated/visual-hive.generated.spec.ts"] };
    });
    await runStep(context, "baseline-bootstrap-list", "Bootstrap Baseline Review", async () => {
      const list = await runBaselineListCommand({ config: options.config, cwd, write: true });
      const markdownPath = path.join(context.rootDir, ".visual-hive", "baseline-bootstrap.md");
      await writeText(markdownPath, formatBaselineBootstrapMarkdown(list));
      return { artifacts: [".visual-hive/baselines.json", ".visual-hive/baseline-bootstrap.md"] };
    });
  }

  await runStep(context, "run", "Deterministic Run", async () => {
    const exitCode = await runDeterministicCommand({
      config: options.config,
      cwd,
      ci: options.ci,
      skipInstall: options.skipInstall || options.bootstrapBaselines,
      skipBuild: options.skipBuild || options.bootstrapBaselines
    });
    await updateNoContractIntent(context);
    context.deterministicExitCode = Math.max(context.deterministicExitCode, exitCode);
    return { exitCode, artifacts: [".visual-hive/report.json", ".visual-hive/generated/visual-hive.generated.spec.ts"] };
  });

  await runStep(context, "baselines", "Baseline Queue", async () => {
    await runBaselineListCommand({ config: options.config, cwd, write: true });
    return { artifacts: [".visual-hive/baselines.json"] };
  });

  if (shouldRunMutation(context.mode, options.enforceMutation)) {
    await runStep(context, "mutate", "Mutation Adequacy", async () => {
      const result = await runMutateCommand({
        config: options.config,
        cwd,
        enforceMinScore: options.enforceMutation,
        skipInstall: true,
        skipBuild: true
      });
      context.mutationExitCode = result.exitCode;
      return { exitCode: result.exitCode, artifacts: [".visual-hive/mutation-report.json"] };
    });
  } else {
    context.steps.push(skippedStep("mutate", "Mutation Adequacy", "Skipped for this pipeline mode; use --mode mutation/full or --enforce-mutation."));
  }

  await runStep(context, "coverage", "Coverage", async () => {
    await runCoverageCommand({ config: options.config, cwd, mode: context.mode, changedFiles: options.changedFiles, base: options.base });
    return { artifacts: [".visual-hive/coverage.json"] };
  });
  await runStep(context, "flows", "Flow Audit", async () => {
    await runFlowsCommand({ config: options.config, cwd, mode: context.mode, changedFiles: options.changedFiles, base: options.base });
    return { artifacts: [".visual-hive/flows.json"] };
  });
  await runStep(context, "improve-coverage", "Coverage Recommendations", async () => {
    await runImproveCoverageCommand({ config: options.config, cwd });
    return { artifacts: [".visual-hive/coverage-recommendations.json"] };
  });
  await runStep(context, "targets", "Target Audit", async () => {
    await runTargetsCommand({ config: options.config, cwd, mode: context.mode, changedFiles: options.changedFiles, base: options.base });
    return { artifacts: [".visual-hive/targets.json"] };
  });
  await runStep(context, "contracts", "Contract Audit", async () => {
    await runContractsCommand({ config: options.config, cwd, mode: context.mode, changedFiles: options.changedFiles, base: options.base });
    return { artifacts: [".visual-hive/contracts.json"] };
  });
  await runStep(context, "schedules", "Schedule Audit", async () => {
    await runSchedulesCommand({ config: options.config, cwd, changedFiles: options.changedFiles, base: options.base });
    return { artifacts: [".visual-hive/schedules.json"] };
  });
  await runStep(context, "workflows", "Workflow Audit", async () => {
    await runWorkflowsCommand({ config: options.config, cwd });
    return { artifacts: [".visual-hive/workflows.json"] };
  });
  await runStep(context, "providers", "Provider Mock Results", async () => {
    await runProvidersMockCommand({ config: options.config, cwd });
    return { artifacts: [".visual-hive/provider-results.json"] };
  });
  await runStep(context, "security", "Security Audit", async () => {
    await runSecurityCommand({ config: options.config, cwd });
    return { artifacts: [".visual-hive/security.json"] };
  });
  await runStep(context, "costs", "Cost Audit", async () => {
    await runCostsCommand({ config: options.config, cwd });
    return { artifacts: [".visual-hive/costs.json"] };
  });
  await runStep(context, "history", "History", async () => {
    await runHistoryCommand({ config: options.config, cwd, record: true });
    return { artifacts: [".visual-hive/history.json"] };
  });
  await runStep(context, "risk", "Risk Register", async () => {
    await runRiskCommand({ config: options.config, cwd });
    return { artifacts: [".visual-hive/risk.json"] };
  });
  await runStep(context, "readiness", "Readiness Gate", async () => {
    const result = await runReadinessCommand({ config: options.config, cwd });
    context.readinessBlocked = result.report.status === "blocked";
    return { exitCode: context.readinessBlocked ? 1 : 0, artifacts: [".visual-hive/readiness.json"] };
  });
  await runStep(context, "triage", "Triage", async () => {
    await runTriageCommand({ config: options.config, cwd });
    return {
      artifacts: [
        ".visual-hive/triage.json",
        ".visual-hive/triage-prompt.md",
        ".visual-hive/issue.md",
        ".visual-hive/pr-comment.md",
        ".visual-hive/missing-tests.md"
      ]
    };
  });
  await runStep(context, "report", "Report", async () => {
    await runReportCommand({ config: options.config, cwd, format: "markdown", githubStepSummary: options.githubStepSummary });
    return { artifacts: [".visual-hive/report.json", ".visual-hive/mutation-report.json", ".visual-hive/readiness.json"] };
  });
  await runStep(context, "artifacts", "Artifact Index", async () => {
    await runArtifactsCommand({ config: options.config, cwd });
    return { artifacts: [".visual-hive/artifacts-index.json"] };
  });
  await runStep(context, "evidence", "Evidence Packet", async () => {
    await runEvidenceCommand({ config: options.config, cwd });
    return { artifacts: [".visual-hive/evidence-packet.json", ".visual-hive/evidence-summary.md"] };
  });
  await runStep(context, "layers", "Testing Layers", async () => {
    await runLayersCommand({ config: options.config, cwd });
    return { artifacts: [".visual-hive/testing-layers.json", ".visual-hive/testing-layers.md"] };
  });
  await runStep(context, "verdict", "Visual Hive Verdict", async () => {
    await runVerdictCommand({ config: options.config, cwd });
    return { artifacts: [".visual-hive/verdict.json", ".visual-hive/verdict.md"] };
  });
  await runStep(context, "handoff", "Hive Handoff Dry Run", async () => {
    await runHandoffCommand({ config: options.config, cwd, mode: "dry_run" });
    return { artifacts: [".visual-hive/handoff.json", ".visual-hive/hive-issue.md", ".visual-hive/hive-bead-request.json", ".visual-hive/hive-handoff-result.json"] };
  });
  await runStep(context, "handoff-validate", "Hive Handoff Validation", async () => {
    const result = await runHandoffValidateCommand({ config: options.config, cwd });
    return { exitCode: result.exitCode, artifacts: [".visual-hive/hive-handoff-validation.json"] };
  });
  await runStep(context, "test-creation-plan", "Test Creation Plan", async () => {
    await runTestCreationPlanCommand({ config: options.config, cwd });
    return { artifacts: [".visual-hive/test-creation-plan.json", ".visual-hive/test-creation-plan.md"] };
  });
  await runStep(context, "agent-packet", "Agent Packet", async () => {
    await runAgentPacketCommand({ config: options.config, cwd, profile: "repair_agent" });
    return { artifacts: [".visual-hive/agent-packet.json"] };
  });
  await runStep(context, "tools", "Tool Registry", async () => {
    await runToolsCommand({ config: options.config, cwd });
    return { artifacts: [".visual-hive/tools/tool-registry.json", ".visual-hive/tools/tool-cards.md"] };
  });
  await runStep(context, "context", "Context Ledger", async () => {
    await runContextCommand({ config: options.config, cwd });
    return { artifacts: [".visual-hive/context-ledger.json"] };
  });
  await runStep(context, "artifacts-final", "Artifact Index Refresh", async () => {
    await runArtifactsCommand({ config: options.config, cwd });
    return { artifacts: [".visual-hive/artifacts-index.json"] };
  });

  const report = buildPipelineReport(context);
  const reportPath = path.join(context.rootDir, ".visual-hive", "pipeline.json");
  await writeJson(reportPath, report);
  return { report, reportPath, exitCode: report.exitCode };
}

export function formatPipelineSummary(result: PipelineCommandResult, format: "markdown" | "json" = "markdown"): string {
  if (format === "json") return JSON.stringify(result.report, null, 2);
  const lines = [
    `Wrote ${result.reportPath}`,
    `# Visual Hive Pipeline: ${result.report.project}`,
    "",
    `- Mode: ${result.report.mode}`,
    `- Status: ${result.report.status}`,
    `- Exit code: ${result.report.exitCode}`,
    `- Root cause: ${result.report.rootCause ?? "none"}`,
    `- Steps: ${result.report.steps.filter((step) => step.status === "passed").length} passed, ${result.report.steps.filter((step) => step.status === "failed").length} failed, ${result.report.steps.filter((step) => step.status === "skipped").length} skipped`,
    "",
    "| Step | Status | Exit | Artifacts |",
    "| --- | --- | ---: | --- |",
    ...result.report.steps.map((step) => `| ${step.label} | ${step.status} | ${step.exitCode} | ${step.artifacts.join(", ") || "none"} |`)
  ];
  return lines.join("\n");
}

async function runStep(
  context: PipelineContext,
  id: string,
  label: string,
  action: () => Promise<{ exitCode?: number; artifacts?: string[]; message?: string }>
): Promise<void> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  try {
    const result = await action();
    const exitCode = result.exitCode ?? 0;
    context.steps.push({
      id,
      label,
      status: exitCode === 0 ? "passed" : "failed",
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      exitCode,
      artifacts: result.artifacts ?? [],
      message: result.message ? sanitizeText(result.message) : undefined
    });
  } catch (error) {
    context.steps.push({
      id,
      label,
      status: "failed",
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      exitCode: 1,
      artifacts: [],
      message: sanitizeText(error instanceof Error ? error.message : String(error))
    });
  }
}

function buildPipelineReport(context: PipelineContext): PipelineReport {
  const failedStep = context.steps.find((step) => step.status === "failed" && !(context.intentionalNoContracts && step.id === "readiness"));
  const readinessStep = context.steps.find((step) => step.id === "readiness");
  const advisoryFailureExitCode = failedStep && !context.options.continueOnError ? 1 : 0;
  const readinessExitCode = context.readinessBlocked && !context.intentionalNoContracts ? 1 : 0;
  const exitCode = context.deterministicExitCode || context.mutationExitCode || readinessExitCode || advisoryFailureExitCode;
  const rootCause =
    exitCode === 0
      ? undefined
      : context.deterministicExitCode > 0
        ? "deterministic_failed"
        : context.mutationExitCode > 0
          ? "mutation_enforcement_failed"
          : readinessExitCode > 0
            ? "readiness_blocked"
            : failedStep
              ? `${failedStep.id}_failed`
              : undefined;
  return {
    schemaVersion: 1,
    project: sanitizeText(context.project),
    mode: context.mode,
    generatedAt: new Date().toISOString(),
    status: exitCode === 0 ? "passed" : context.readinessBlocked || readinessStep?.status === "failed" ? "blocked" : "failed",
    exitCode,
    rootCause,
    options: context.options,
    steps: context.steps,
    artifacts: Array.from(new Set(context.steps.flatMap((step) => step.artifacts).concat(".visual-hive/pipeline.json"))).sort()
  };
}

async function updateNoContractIntent(context: PipelineContext): Promise<void> {
  try {
    const report = await readJson<Report>(path.join(context.rootDir, ".visual-hive", "report.json"));
    context.intentionalNoContracts = Boolean(
      report.results.length === 0 &&
        report.status === "passed" &&
        report.noContractsReason?.includes("selection.ignoreChangedFiles")
    );
  } catch {
    context.intentionalNoContracts = false;
  }
}

function skippedStep(id: string, label: string, message: string): PipelineStepResult {
  const now = new Date().toISOString();
  return {
    id,
    label,
    status: "skipped",
    startedAt: now,
    completedAt: now,
    durationMs: 0,
    exitCode: 0,
    artifacts: [],
    message
  };
}

function shouldRunMutation(mode: PlanMode, enforceMutation?: boolean): boolean {
  return Boolean(enforceMutation || mode === "mutation" || mode === "full" || mode === "schedule");
}

function isUntrustedPullRequestCi(): boolean {
  return process.env.CI === "true" && process.env.GITHUB_EVENT_NAME === "pull_request";
}

async function withVisualHiveCiOverride<T>(value: "true" | "false", action: () => Promise<T>): Promise<T> {
  const previous = process.env.VISUAL_HIVE_CI;
  process.env.VISUAL_HIVE_CI = value;
  try {
    return await action();
  } finally {
    if (previous === undefined) {
      delete process.env.VISUAL_HIVE_CI;
    } else {
      process.env.VISUAL_HIVE_CI = previous;
    }
  }
}

function formatBaselineBootstrapMarkdown(list: Awaited<ReturnType<typeof runBaselineListCommand>>): string {
  const created = list.entries.filter((entry) => entry.status === "created" || entry.status === "missing_baseline");
  return [
    "# Visual Hive Baseline Bootstrap",
    "",
    "This bootstrap created or discovered screenshot baselines for local review. Do not treat new baselines as approved until a maintainer inspects the images.",
    "",
    `- Total screenshots: ${list.summary.total}`,
    `- Created baselines: ${list.summary.created}`,
    `- Missing baselines: ${list.summary.missingBaseline}`,
    `- Pending review: ${list.summary.pendingReview}`,
    "",
    "## Created Or Missing Baselines",
    ...(created.length
      ? created.map((entry) => `- ${entry.contractId}/${entry.screenshotName} (${entry.viewport} ${entry.route}) -> ${entry.baselinePath}`)
      : ["- None"]),
    "",
    "## Review Queue",
    "",
    "Run `visual-hive baselines list --write`, inspect actual/baseline/diff artifacts, and approve or reject intentional changes before strict CI.",
    "",
    "```text",
    formatBaselineList(list),
    "```"
  ].join("\n");
}
