import path from "node:path";
import {
  loadConfig,
  writeIssuePublishArtifacts,
  writeIssuesArtifacts,
  type IssuePublishArtifacts,
  type VisualHiveIssueCandidate,
  type VisualHiveIssuePublishMode,
  type VisualHiveIssuesReport
} from "@visual-hive/core";

export interface IssuesCommandOptions {
  config?: string;
  cwd?: string;
  write?: boolean;
  format?: "markdown" | "json";
  kind?: string;
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
}

const SEVERITY_RANK = { low: 0, medium: 1, high: 2, critical: 3 } as const;

export async function runIssuesCommand(options: IssuesCommandOptions = {}): Promise<IssuesCommandResult> {
  const loaded = await loadConfig(options.config, options.cwd ?? process.cwd());
  const result = await writeIssuesArtifacts({ rootDir: loaded.rootDir, project: loaded.config.project.name });
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
  return writeIssuePublishArtifacts({
    rootDir: loaded.rootDir,
    mode: options.live || options.mode === "live" ? "live" : options.dryRun ? "dry_run" : options.mode ?? "dry_run",
    issuesPath: options.issues,
    handoffValidationPath: options.handoffValidation,
    githubRepository: options.repository,
    tokenEnv: options.tokenEnv,
    liveGuardEnv: options.liveGuardEnv
  });
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

export function issueArtifactPaths(rootDir: string): string[] {
  return [
    path.join(rootDir, ".visual-hive", "issues.json"),
    path.join(rootDir, ".visual-hive", "issues.md"),
    path.join(rootDir, ".visual-hive", "issue-queue.json"),
    path.join(rootDir, ".visual-hive", "setup-issue.md")
  ];
}
