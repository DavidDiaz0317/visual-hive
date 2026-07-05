import path from "node:path";
import { readJson, writeJson } from "../utils/files.js";
import { sanitizeText } from "../utils/sanitize.js";
import type { HandoffValidationReport } from "../handoff/validate.js";
import type {
  VisualHiveIssueCandidate,
  VisualHiveIssuePublishDecision,
  VisualHiveIssuePublishDryRun,
  VisualHiveIssuePublishMode,
  VisualHiveIssuePublishPlan,
  VisualHiveIssuePublishResult,
  VisualHiveIssuesReport,
  VisualHivePublishedIssueRef
} from "./types.js";

export interface BuildIssuePublishPlanOptions {
  rootDir: string;
  mode?: VisualHiveIssuePublishMode;
  now?: Date;
  issuesPath?: string;
  handoffValidationPath?: string;
  existingIssues?: VisualHivePublishedIssueRef[];
}

export interface WriteIssuePublishArtifactsOptions extends BuildIssuePublishPlanOptions {
  planPath?: string;
  dryRunPath?: string;
  resultPath?: string;
}

export interface IssuePublishArtifacts {
  plan: VisualHiveIssuePublishPlan;
  dryRun: VisualHiveIssuePublishDryRun;
  result: VisualHiveIssuePublishResult;
  planPath: string;
  dryRunPath: string;
  resultPath: string;
}

const DEFAULT_PATHS = {
  issues: ".visual-hive/issues.json",
  handoffValidation: ".visual-hive/hive-handoff-validation.json",
  plan: ".visual-hive/issue-publish-plan.json",
  dryRun: ".visual-hive/issue-publish-dry-run.json",
  result: ".visual-hive/issue-publish-result.json"
};

export async function buildIssuePublishPlan(options: BuildIssuePublishPlanOptions): Promise<VisualHiveIssuePublishPlan> {
  const rootDir = path.resolve(options.rootDir);
  const issuesPath = normalizeArtifactPath(options.issuesPath ?? DEFAULT_PATHS.issues);
  const handoffValidationPath = normalizeArtifactPath(options.handoffValidationPath ?? DEFAULT_PATHS.handoffValidation);
  const issues = await readJson<VisualHiveIssuesReport>(resolveArtifact(rootDir, issuesPath));
  const handoffValidation = await readOptional<HandoffValidationReport>(rootDir, handoffValidationPath);
  const generatedAt = (options.now ?? new Date()).toISOString();
  const existingByFingerprint = new Map((options.existingIssues ?? []).map((issue) => [issue.dedupeFingerprint, issue]));
  const blockedReasons = [
    ...artifactSafetyBlocks(issues, handoffValidation),
    ...(!issues.issues.length ? ["issues.json contains no issue candidates to publish."] : [])
  ];
  const decisions = issues.issues.map((issue) => decisionForIssue(issue, existingByFingerprint.get(issue.dedupeFingerprint), blockedReasons));
  const plan = sanitizeValue({
    schemaVersion: "visual-hive.issue-publish-plan.v1",
    generatedAt,
    project: issues.project,
    mode: options.mode ?? "dry_run",
    status: blockedReasons.length ? "blocked" : "ready",
    externalCallsMade: 0,
    networkCallsMade: 0,
    sourceArtifacts: {
      issues: issuesPath,
      ...(handoffValidation ? { handoffValidation: handoffValidationPath } : {})
    },
    summary: summarizeDecisions(decisions),
    blockedReasons,
    decisions
  }) as VisualHiveIssuePublishPlan;
  return plan;
}

export async function writeIssuePublishArtifacts(options: WriteIssuePublishArtifactsOptions): Promise<IssuePublishArtifacts> {
  const rootDir = path.resolve(options.rootDir);
  const plan = await buildIssuePublishPlan(options);
  const dryRun = buildDryRun(plan, options.now);
  const result = buildDryRunResult(plan, options.now);
  const planPath = resolveArtifact(rootDir, options.planPath ?? DEFAULT_PATHS.plan);
  const dryRunPath = resolveArtifact(rootDir, options.dryRunPath ?? DEFAULT_PATHS.dryRun);
  const resultPath = resolveArtifact(rootDir, options.resultPath ?? DEFAULT_PATHS.result);
  await writeJson(planPath, plan);
  await writeJson(dryRunPath, dryRun);
  await writeJson(resultPath, result);
  return { plan, dryRun, result, planPath, dryRunPath, resultPath };
}

function decisionForIssue(issue: VisualHiveIssueCandidate, existingIssue: VisualHivePublishedIssueRef | undefined, globalBlockedReasons: string[]): VisualHiveIssuePublishDecision {
  if (globalBlockedReasons.length) {
    return decision(issue, "blocked", globalBlockedReasons[0] ?? "Issue publishing is blocked.", existingIssue);
  }
  if (issue.status === "suppressed") {
    return decision(issue, "skip", `Suppressed: ${issue.suppressedReason ?? "suppression entry present"}`, existingIssue);
  }
  if (issue.status === "blocked") {
    return decision(issue, "blocked", "Issue candidate is blocked by Visual Hive policy.", existingIssue);
  }
  if (issue.status === "resolved_candidate" && !existingIssue) {
    return decision(issue, "skip", "Resolved candidate has no known published issue to update.", existingIssue);
  }
  if (existingIssue) {
    return decision(issue, "update", issue.status === "resolved_candidate" ? "Existing issue should receive resolved-candidate evidence." : "Existing issue matches dedupe fingerprint.", existingIssue);
  }
  return decision(issue, "create", "No existing issue was provided for this dedupe fingerprint.", existingIssue);
}

function decision(
  issue: VisualHiveIssueCandidate,
  action: VisualHiveIssuePublishDecision["action"],
  reason: string,
  existingIssue?: VisualHivePublishedIssueRef
): VisualHiveIssuePublishDecision {
  return sanitizeValue({
    dedupeFingerprint: issue.dedupeFingerprint,
    issueKind: issue.issueKind,
    title: issue.title,
    status: issue.status,
    severity: issue.severity,
    action,
    reason,
    labels: issue.labels,
    owningAgentHint: issue.owningAgentHint,
    validationCommand: issue.validationCommand,
    existingIssue,
    targetIssue: existingIssue,
    body: issue.body
  }) as VisualHiveIssuePublishDecision;
}

function artifactSafetyBlocks(issues: VisualHiveIssuesReport, handoffValidation?: HandoffValidationReport): string[] {
  const blocks: string[] = [];
  if (issues.externalCallsMade !== 0 || issues.networkCallsMade !== 0) {
    blocks.push("Refusing to publish because issues.json was not produced by a no-network Visual Hive run.");
  }
  if (handoffValidation?.status === "blocked") {
    blocks.push("Refusing to publish because handoff validation is blocked.");
  }
  if ((handoffValidation?.summary.externalCallsMade ?? 0) !== 0) {
    blocks.push("Refusing to publish because handoff validation reports prior external calls.");
  }
  return blocks;
}

function buildDryRun(plan: VisualHiveIssuePublishPlan, now?: Date): VisualHiveIssuePublishDryRun {
  return sanitizeValue({
    schemaVersion: "visual-hive.issue-publish-dry-run.v1",
    generatedAt: (now ?? new Date()).toISOString(),
    project: plan.project,
    status: plan.status,
    externalCallsMade: 0,
    networkCallsMade: 0,
    wouldCreateIssues: plan.summary.create,
    wouldUpdateIssues: plan.summary.update,
    wouldSkipIssues: plan.summary.skip,
    wouldBlockIssues: plan.summary.blocked,
    decisions: plan.decisions
  }) as VisualHiveIssuePublishDryRun;
}

function buildDryRunResult(plan: VisualHiveIssuePublishPlan, now?: Date): VisualHiveIssuePublishResult {
  return sanitizeValue({
    schemaVersion: "visual-hive.issue-publish-result.v1",
    generatedAt: (now ?? new Date()).toISOString(),
    project: plan.project,
    mode: "dry_run",
    status: plan.status === "blocked" ? "blocked" : "dry_run_written",
    externalCallsMade: 0,
    networkCallsMade: 0,
    realGithubIssuesCreated: 0,
    realGithubIssuesUpdated: 0,
    blockedReasons: plan.blockedReasons,
    decisions: plan.decisions,
    createdIssues: [],
    updatedIssues: []
  }) as VisualHiveIssuePublishResult;
}

function summarizeDecisions(decisions: VisualHiveIssuePublishDecision[]): VisualHiveIssuePublishPlan["summary"] {
  return {
    total: decisions.length,
    create: decisions.filter((decision) => decision.action === "create").length,
    update: decisions.filter((decision) => decision.action === "update").length,
    skip: decisions.filter((decision) => decision.action === "skip").length,
    blocked: decisions.filter((decision) => decision.action === "blocked").length,
    suppressed: decisions.filter((decision) => decision.status === "suppressed").length,
    resolvedCandidates: decisions.filter((decision) => decision.status === "resolved_candidate").length
  };
}

async function readOptional<T>(rootDir: string, artifactPath: string): Promise<T | undefined> {
  try {
    return await readJson<T>(resolveArtifact(rootDir, artifactPath));
  } catch {
    return undefined;
  }
}

function resolveArtifact(rootDir: string, artifactPath: string): string {
  return path.isAbsolute(artifactPath) ? artifactPath : path.resolve(rootDir, artifactPath);
}

function normalizeArtifactPath(value: string): string {
  return value.replaceAll("\\", "/");
}

function sanitizeValue<T>(value: T): T {
  return JSON.parse(sanitizeText(JSON.stringify(value))) as T;
}
