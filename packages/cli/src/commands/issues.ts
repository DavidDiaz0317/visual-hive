import path from "node:path";
import { lstat, readFile } from "node:fs/promises";
import {
  loadConfig,
  lifecycleWriteBlock,
  visualHiveLifecyclePolicy,
  writeIssuePublishArtifacts,
  writeIssuesArtifacts,
  writeSetupIssuePublishArtifacts,
  type IssuePublishArtifacts,
  type VisualHiveIssueKind,
  type VisualHiveIssueCandidate,
  type VisualHiveIssuePublishMode,
  type VisualHiveIssuesReport
} from "@visual-hive/core";

export interface IssuesCommandOptions {
  config?: string;
  cwd?: string;
  write?: boolean;
  format?: "markdown" | "json";
  kind?: VisualHiveIssueKind;
  minSeverity?: "low" | "medium" | "high" | "critical";
}

export interface IssuesCommandResult {
  report: VisualHiveIssuesReport;
  markdown: string;
  issuesPath: string;
  markdownPath: string;
  queuePath: string;
  setupIssuePath: string;
}

export interface IssuePublishCommandOptions {
  config?: string;
  cwd?: string;
  mode?: VisualHiveIssuePublishMode;
  dryRun?: boolean;
  live?: boolean;
  issues?: string;
  handoffValidation?: string;
  repository?: string;
  tokenEnv?: string;
  liveGuardEnv?: string;
  format?: "markdown" | "json";
  dedupe?: string;
  kind?: string;
  minSeverity?: "low" | "medium" | "high" | "critical";
  limit?: number;
}

export interface SetupIssuePublishCommandOptions extends Omit<IssuePublishCommandOptions, "issues"> {
  setupIssue?: string;
}

const SEVERITY_RANK = { low: 0, medium: 1, high: 2, critical: 3 } as const;
const ISSUE_KINDS = new Set<VisualHiveIssueKind>([
  "setup_needed",
  "map_drift",
  "missing_visual_coverage",
  "test_adequacy_gap",
  "weak_visual_test",
  "stale_baseline",
  "baseline_churn",
  "visual_regression",
  "selector_contract_failure",
  "screenshot_diff",
  "mutation_survivor",
  "workflow_safety",
  "provider_governance",
  "protected_target_blocked",
  "external_repo_onboarding"
]);

export async function runIssuesCommand(options: IssuesCommandOptions = {}): Promise<IssuesCommandResult> {
  const loaded = await loadConfig(options.config, options.cwd ?? process.cwd());
  const lifecycle = visualHiveLifecyclePolicy(
    loaded.config.integrations.hive.enabled || await hasHiveInstallationMarker(loaded.rootDir)
  );
  const result = await writeIssuesArtifacts({
    rootDir: loaded.rootDir,
    project: loaded.config.project.name,
    lifecycle
  });
  const filteredIssues = filterIssues(result.report.issues, options);
  if (filteredIssues.length !== result.report.issues.length) {
    result.report = {
      ...result.report,
      summary: summarize(filteredIssues),
      issues: filteredIssues
    };
  }
  if (!options.write) {
    // The command is intentionally artifact-forward: even read-mode computes the files so downstream
    // trusted workflows have a stable queue to consume. The flag is accepted for explicit UX.
  }
  return result;
}

export function formatIssuesResult(result: IssuesCommandResult, format: "markdown" | "json" = "markdown"): string {
  if (format === "json") return JSON.stringify(result.report, null, 2);
  return [
    `Wrote ${result.issuesPath}`,
    `Wrote ${result.markdownPath}`,
    `Wrote ${result.queuePath}`,
    `Wrote ${result.setupIssuePath}`,
    "",
    `# Visual Hive Issues: ${result.report.project}`,
    "",
    `- Candidates: ${result.report.summary.total}`,
    `- Open: ${result.report.summary.openCandidates}`,
    `- Updates: ${result.report.summary.updateCandidates}`,
    `- Resolved candidates: ${result.report.summary.resolvedCandidates}`,
    `- Suppressed: ${result.report.summary.suppressed}`,
    `- External calls made: ${result.report.externalCallsMade}`,
    "",
    "## Top Candidates",
    ...result.report.issues.slice(0, 10).map((issue) => `- [${issue.severity}] ${issue.issueKind}: ${issue.title} (${issue.dedupeFingerprint})`)
  ].join("\n");
}

export async function runIssuePublishCommand(options: IssuePublishCommandOptions = {}): Promise<IssuePublishArtifacts> {
  const loaded = await loadConfig(options.config, options.cwd ?? process.cwd());
  const lifecycle = visualHiveLifecyclePolicy(
    loaded.config.integrations.hive.enabled || await hasHiveInstallationMarker(loaded.rootDir)
  );
  const lifecycleBlock = lifecycleWriteBlock(lifecycle);
  return writeIssuePublishArtifacts({
    rootDir: loaded.rootDir,
    mode: options.live || options.mode === "live" ? "live" : options.dryRun ? "dry_run" : options.mode ?? "dry_run",
    issuesPath: options.issues,
    handoffValidationPath: options.handoffValidation,
    githubRepository: options.repository,
    tokenEnv: options.tokenEnv,
    liveGuardEnv: options.liveGuardEnv,
    dedupeFingerprint: options.dedupe,
    issueKind: parseIssueKindOption(options.kind),
    minSeverity: options.minSeverity,
    limit: options.limit,
    lifecycle,
    blockedReasons: lifecycleBlock ? [lifecycleBlock] : []
  });
}

export async function runSetupIssuePublishCommand(options: SetupIssuePublishCommandOptions = {}): Promise<IssuePublishArtifacts & { candidatePath: string }> {
  const loaded = await loadConfig(options.config, options.cwd ?? process.cwd());
  const lifecycle = visualHiveLifecyclePolicy(
    loaded.config.integrations.hive.enabled || await hasHiveInstallationMarker(loaded.rootDir)
  );
  const lifecycleBlock = lifecycleWriteBlock(lifecycle);
  return writeSetupIssuePublishArtifacts({
    rootDir: loaded.rootDir,
    mode: options.live || options.mode === "live" ? "live" : options.dryRun ? "dry_run" : options.mode ?? "dry_run",
    setupIssuePath: options.setupIssue,
    handoffValidationPath: options.handoffValidation,
    githubRepository: options.repository,
    tokenEnv: options.tokenEnv,
    liveGuardEnv: options.liveGuardEnv,
    lifecycle,
    blockedReasons: lifecycleBlock ? [lifecycleBlock] : []
  });
}

async function hasHiveInstallationMarker(rootDir: string): Promise<boolean> {
  const markerPath = path.join(rootDir, ".hive", "integrated.json");
  try {
    const markerStat = await lstat(markerPath);
    if (!markerStat.isFile() || markerStat.isSymbolicLink()) return true;
    const marker = JSON.parse(await readFile(markerPath, "utf8")) as unknown;
    if (!marker || typeof marker !== "object" || Array.isArray(marker)) return true;
    // The marker is suppress-only. Removing it through Hive's audited uninstall
    // path is the only checkout-level transition back to standalone ownership;
    // a present branch-controlled value can never grant write authority.
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    // A present but unreadable/invalid Hive installation marker fails closed for
    // external lifecycle writes while evidence generation remains available.
    return true;
  }
}

export function formatIssuePublishResult(result: IssuePublishArtifacts, format: "markdown" | "json" = "markdown"): string {
  if (format === "json") {
    return JSON.stringify({ plan: result.plan, dryRun: result.dryRun, result: result.result }, null, 2);
  }
  return [
    `Wrote ${result.planPath}`,
    `Wrote ${result.dryRunPath}`,
    `Wrote ${result.resultPath}`,
    "",
    `# Visual Hive Issue Publish: ${result.plan.project}`,
    "",
    `- Mode: ${result.plan.mode}`,
    `- Status: ${result.result.status}`,
    `- Candidates: ${result.plan.summary.total}`,
    `- Would create: ${result.dryRun.wouldCreateIssues}`,
    `- Would update: ${result.dryRun.wouldUpdateIssues}`,
    `- Skipped: ${result.dryRun.wouldSkipIssues}`,
    `- Blocked: ${result.dryRun.wouldBlockIssues}`,
    `- External calls made: ${result.result.externalCallsMade}`,
    `- Network calls made: ${result.result.networkCallsMade}`,
    `- Real GitHub issues created: ${result.result.realGithubIssuesCreated}`,
    ...(result.plan.blockedReasons.length ? ["", "## Blocked Reasons", ...result.plan.blockedReasons.map((reason) => `- ${reason}`)] : []),
    "",
    "## Decisions",
    ...result.plan.decisions.slice(0, 10).map((decision) => `- ${decision.action}: ${decision.title} (${decision.dedupeFingerprint})`)
  ].join("\n");
}

export function formatSetupIssuePublishResult(result: IssuePublishArtifacts & { candidatePath: string }, format: "markdown" | "json" = "markdown"): string {
  if (format === "json") {
    return JSON.stringify({ candidatePath: result.candidatePath, plan: result.plan, dryRun: result.dryRun, result: result.result }, null, 2);
  }
  return [
    `Wrote ${result.candidatePath}`,
    `Wrote ${result.planPath}`,
    `Wrote ${result.dryRunPath}`,
    `Wrote ${result.resultPath}`,
    "",
    `# Visual Hive Setup Issue Publish: ${result.plan.project}`,
    "",
    `- Mode: ${result.plan.mode}`,
    `- Status: ${result.result.status}`,
    `- Would create: ${result.dryRun.wouldCreateIssues}`,
    `- Would update: ${result.dryRun.wouldUpdateIssues}`,
    `- External calls made: ${result.result.externalCallsMade}`,
    `- Network calls made: ${result.result.networkCallsMade}`,
    `- Real GitHub issues created: ${result.result.realGithubIssuesCreated}`,
    "",
    "## Decisions",
    ...result.plan.decisions.map((decision) => `- ${decision.action}: ${decision.title} (${decision.dedupeFingerprint})`)
  ].join("\n");
}

function filterIssues(issues: VisualHiveIssueCandidate[], options: IssuesCommandOptions): VisualHiveIssueCandidate[] {
  return issues.filter((issue) => {
    if (options.kind && issue.issueKind !== options.kind) return false;
    if (options.minSeverity && SEVERITY_RANK[issue.severity] < SEVERITY_RANK[options.minSeverity]) return false;
    return true;
  });
}

function summarize(issues: VisualHiveIssueCandidate[]): VisualHiveIssuesReport["summary"] {
  const byKind: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};
  for (const issue of issues) {
    byKind[issue.issueKind] = (byKind[issue.issueKind] ?? 0) + 1;
    bySeverity[issue.severity] = (bySeverity[issue.severity] ?? 0) + 1;
  }
  return {
    total: issues.length,
    openCandidates: issues.filter((issue) => issue.status === "open_candidate").length,
    updateCandidates: issues.filter((issue) => issue.status === "update_candidate").length,
    resolvedCandidates: issues.filter((issue) => issue.status === "resolved_candidate").length,
    suppressed: issues.filter((issue) => issue.status === "suppressed").length,
    blocked: issues.filter((issue) => issue.status === "blocked").length,
    byKind,
    bySeverity
  };
}

function parseIssueKindOption(value?: string): VisualHiveIssueKind | undefined {
  if (!value) return undefined;
  if (ISSUE_KINDS.has(value as VisualHiveIssueKind)) return value as VisualHiveIssueKind;
  throw new Error(`Invalid issue kind "${value}". Expected one of: ${[...ISSUE_KINDS].join(", ")}`);
}

export function issueArtifactPaths(rootDir: string): string[] {
  return [
    path.join(rootDir, ".visual-hive", "issues.json"),
    path.join(rootDir, ".visual-hive", "issues.md"),
    path.join(rootDir, ".visual-hive", "issue-queue.json"),
    path.join(rootDir, ".visual-hive", "setup-issue.md")
  ];
}
