import path from "node:path";
import { readJson, readText, writeJson } from "../utils/files.js";
import { sanitizeArtifactPathForIssue, sanitizeArtifactPathsForMarkdown, sanitizeText } from "../utils/sanitize.js";
import type { HandoffValidationReport } from "../handoff/validate.js";
import type {
  VisualHiveIssueCandidate,
  VisualHiveIssueKind,
  VisualHiveIssuePublishDecision,
  VisualHiveIssuePublishDryRun,
  VisualHiveIssuePublishMode,
  VisualHiveIssuePublishPlan,
  VisualHiveIssuePublishResult,
  VisualHiveIssueSeverity,
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
  blockedReasons?: string[];
  dedupeFingerprint?: string;
  issueKind?: VisualHiveIssueKind;
  minSeverity?: VisualHiveIssueSeverity;
  limit?: number;
}

export interface WriteIssuePublishArtifactsOptions extends BuildIssuePublishPlanOptions {
  planPath?: string;
  dryRunPath?: string;
  resultPath?: string;
  githubRepository?: string;
  tokenEnv?: string;
  liveGuardEnv?: string;
  env?: Record<string, string | undefined>;
  githubClient?: GitHubIssuePublisherClient;
}

export interface WriteSetupIssuePublishArtifactsOptions extends Omit<WriteIssuePublishArtifactsOptions, "issuesPath" | "planPath" | "dryRunPath" | "resultPath"> {
  setupIssuePath?: string;
  setupIssueCandidatePath?: string;
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

export interface GitHubIssuePublisherClient {
  listOpenIssues(input: GitHubIssuePublisherInput): Promise<VisualHivePublishedIssueRef[]>;
  createIssue(input: GitHubIssueMutationInput): Promise<VisualHivePublishedIssueRef>;
  updateIssue(input: GitHubIssueMutationInput & { issueNumber: number }): Promise<VisualHivePublishedIssueRef>;
}

export interface GitHubIssuePublisherInput {
  repository: string;
  token: string;
}

export interface GitHubIssueMutationInput extends GitHubIssuePublisherInput {
  title: string;
  body: string;
  labels: string[];
  dedupeFingerprint: string;
}

const DEFAULT_PATHS = {
  issues: ".visual-hive/issues.json",
  handoffValidation: ".visual-hive/hive-handoff-validation.json",
  plan: ".visual-hive/issue-publish-plan.json",
  dryRun: ".visual-hive/issue-publish-dry-run.json",
  result: ".visual-hive/issue-publish-result.json",
  setupIssue: ".visual-hive/setup-issue.md",
  setupIssueCandidate: ".visual-hive/setup-issue-candidate.json",
  setupPlan: ".visual-hive/setup-issue-publish-plan.json",
  setupDryRun: ".visual-hive/setup-issue-publish-dry-run.json",
  setupResult: ".visual-hive/setup-issue-publish-result.json"
};

export async function buildIssuePublishPlan(options: BuildIssuePublishPlanOptions): Promise<VisualHiveIssuePublishPlan> {
  const rootDir = path.resolve(options.rootDir);
  const issuesPath = normalizeArtifactPath(rootDir, options.issuesPath ?? DEFAULT_PATHS.issues);
  const handoffValidationPath = normalizeArtifactPath(rootDir, options.handoffValidationPath ?? DEFAULT_PATHS.handoffValidation);
  const issues = await readJson<VisualHiveIssuesReport>(resolveArtifact(rootDir, issuesPath));
  const selectedIssues = filterPublishIssues(issues.issues, options);
  const handoffValidation = await readOptional<HandoffValidationReport>(rootDir, handoffValidationPath);
  const generatedAt = (options.now ?? new Date()).toISOString();
  const existingByFingerprint = new Map((options.existingIssues ?? []).map((issue) => [issue.dedupeFingerprint, issue]));
  const blockedReasons = [
    ...(options.blockedReasons ?? []),
    ...artifactSafetyBlocks(issues, handoffValidation),
    ...(!issues.issues.length ? ["issues.json contains no issue candidates to publish."] : []),
    ...(issues.issues.length && !selectedIssues.length ? ["No issue candidates matched the publish filters."] : [])
  ];
  const decisions = selectedIssues.map((issue) => decisionForIssue(rootDir, issue, existingByFingerprint.get(issue.dedupeFingerprint), blockedReasons));
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

const SEVERITY_RANK: Record<VisualHiveIssueSeverity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3
};

function filterPublishIssues(issues: VisualHiveIssueCandidate[], options: BuildIssuePublishPlanOptions): VisualHiveIssueCandidate[] {
  const filtered = issues.filter((issue) => {
    if (options.dedupeFingerprint && issue.dedupeFingerprint !== options.dedupeFingerprint) return false;
    if (options.issueKind && issue.issueKind !== options.issueKind) return false;
    if (options.minSeverity && SEVERITY_RANK[issue.severity] < SEVERITY_RANK[options.minSeverity]) return false;
    return true;
  });
  if (options.limit === undefined) return filtered;
  const limit = Math.max(0, Math.floor(options.limit));
  return filtered.slice(0, limit);
}

export async function writeIssuePublishArtifacts(options: WriteIssuePublishArtifactsOptions): Promise<IssuePublishArtifacts> {
  const rootDir = path.resolve(options.rootDir);
  const liveContext = await prepareLiveContext(rootDir, options);
  const plan = await buildIssuePublishPlan({
    ...options,
    existingIssues: liveContext.existingIssues ?? options.existingIssues,
    blockedReasons: liveContext.blockedReasons
  });
  const dryRun = buildDryRun(plan, options.now);
  const result = plan.mode === "live" ? await buildLiveResult(plan, liveContext, options) : buildDryRunResult(plan, options.now);
  const planPath = resolveArtifact(rootDir, options.planPath ?? DEFAULT_PATHS.plan);
  const dryRunPath = resolveArtifact(rootDir, options.dryRunPath ?? DEFAULT_PATHS.dryRun);
  const resultPath = resolveArtifact(rootDir, options.resultPath ?? DEFAULT_PATHS.result);
  await writeJson(planPath, plan);
  await writeJson(dryRunPath, dryRun);
  await writeJson(resultPath, result);
  return {
    plan,
    dryRun,
    result,
    planPath: normalizeArtifactPath(rootDir, options.planPath ?? DEFAULT_PATHS.plan),
    dryRunPath: normalizeArtifactPath(rootDir, options.dryRunPath ?? DEFAULT_PATHS.dryRun),
    resultPath: normalizeArtifactPath(rootDir, options.resultPath ?? DEFAULT_PATHS.result)
  };
}

export async function writeSetupIssuePublishArtifacts(options: WriteSetupIssuePublishArtifactsOptions): Promise<IssuePublishArtifacts & { candidatePath: string }> {
  const rootDir = path.resolve(options.rootDir);
  const setupIssuePath = options.setupIssuePath ?? DEFAULT_PATHS.setupIssue;
  const candidatePath = options.setupIssueCandidatePath ?? DEFAULT_PATHS.setupIssueCandidate;
  const setupBody = await readText(resolveArtifact(rootDir, setupIssuePath));
  const existingIssues = await readOptional<VisualHiveIssuesReport>(rootDir, DEFAULT_PATHS.issues);
  const generatedAt = (options.now ?? new Date()).toISOString();
  const project = existingIssues?.project ?? projectFromSetupIssue(setupBody) ?? "unknown";
  const setupCandidate = setupIssueCandidate(project, setupBody, setupIssuePath, rootDir);
  const setupIssuesReport = sanitizeValue({
    schemaVersion: "visual-hive.issues.v1",
    generatedAt,
    project,
    externalCallsMade: 0,
    networkCallsMade: 0,
    sourceArtifacts: {
      ...(existingIssues?.sourceArtifacts ?? {}),
      setupIssue: normalizeArtifactPath(rootDir, setupIssuePath)
    },
    summary: {
      total: 1,
      openCandidates: 1,
      updateCandidates: 0,
      resolvedCandidates: 0,
      suppressed: 0,
      blocked: 0,
      byKind: { setup_needed: 1 },
      bySeverity: { medium: 1 }
    },
    issues: [setupCandidate]
  }) as VisualHiveIssuesReport;
  const candidateAbsolutePath = resolveArtifact(rootDir, candidatePath);
  await writeJson(candidateAbsolutePath, setupIssuesReport);
  const artifacts = await writeIssuePublishArtifacts({
    ...options,
    issuesPath: candidatePath,
    planPath: options.planPath ?? DEFAULT_PATHS.setupPlan,
    dryRunPath: options.dryRunPath ?? DEFAULT_PATHS.setupDryRun,
    resultPath: options.resultPath ?? DEFAULT_PATHS.setupResult
  });
  return { ...artifacts, candidatePath: normalizeArtifactPath(rootDir, candidatePath) };
}

async function prepareLiveContext(
  rootDir: string,
  options: WriteIssuePublishArtifactsOptions
): Promise<{ blockedReasons: string[]; existingIssues?: VisualHivePublishedIssueRef[]; repository?: string; token?: string; externalCallsMade: number; networkCallsMade: number }> {
  if ((options.mode ?? "dry_run") !== "live") {
    return { blockedReasons: [], existingIssues: options.existingIssues, externalCallsMade: 0, networkCallsMade: 0 };
  }
  const env = options.env ?? process.env;
  const liveGuardEnv = options.liveGuardEnv ?? "VISUAL_HIVE_LIVE_GITHUB_ISSUE";
  const repository = options.githubRepository ?? env.GITHUB_REPOSITORY;
  const tokenEnv = options.tokenEnv ?? (env.GH_TOKEN ? "GH_TOKEN" : "GITHUB_TOKEN");
  const token = env[tokenEnv];
  const blockedReasons: string[] = [];
  if (env[liveGuardEnv] !== "true") {
    blockedReasons.push(`Refusing live issue publishing because ${liveGuardEnv}=true is not set.`);
  }
  if (!repository || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    blockedReasons.push("Refusing live issue publishing because no valid GitHub repository was provided.");
  }
  if (!token) {
    blockedReasons.push(`Refusing live issue publishing because ${tokenEnv} is not set.`);
  }
  if (blockedReasons.length) {
    return { blockedReasons, existingIssues: options.existingIssues, repository, externalCallsMade: 0, networkCallsMade: 0 };
  }
  try {
    const client = options.githubClient ?? createGitHubIssuePublisherClient();
    const existingIssues = await client.listOpenIssues({ repository: repository!, token: token! });
    return {
      blockedReasons: [],
      existingIssues: mergeIssueRefs(options.existingIssues ?? [], existingIssues),
      repository,
      token,
      externalCallsMade: 1,
      networkCallsMade: 1
    };
  } catch (error) {
    return {
      blockedReasons: [`Refusing live issue publishing because GitHub issue discovery failed: ${sanitizeText(error instanceof Error ? error.message : String(error))}`],
      existingIssues: options.existingIssues,
      repository,
      externalCallsMade: 1,
      networkCallsMade: 1
    };
  }
}

async function buildLiveResult(
  plan: VisualHiveIssuePublishPlan,
  context: { repository?: string; token?: string; externalCallsMade: number; networkCallsMade: number },
  options: WriteIssuePublishArtifactsOptions
): Promise<VisualHiveIssuePublishResult> {
  const generatedAt = (options.now ?? new Date()).toISOString();
  if (plan.status === "blocked" || !context.repository || !context.token) {
    return sanitizeValue({
      schemaVersion: "visual-hive.issue-publish-result.v1",
      generatedAt,
      project: plan.project,
      mode: "live",
      status: "blocked",
      externalCallsMade: context.externalCallsMade,
      networkCallsMade: context.networkCallsMade,
      realGithubIssuesCreated: 0,
      realGithubIssuesUpdated: 0,
      blockedReasons: plan.blockedReasons,
      decisions: plan.decisions,
      createdIssues: [],
      updatedIssues: []
    }) as VisualHiveIssuePublishResult;
  }

  const client = options.githubClient ?? createGitHubIssuePublisherClient();
  const createdIssues: VisualHivePublishedIssueRef[] = [];
  const updatedIssues: VisualHivePublishedIssueRef[] = [];
  const decisions: VisualHiveIssuePublishDecision[] = [];
  const blockedReasons: string[] = [];
  let externalCallsMade = context.externalCallsMade;
  let networkCallsMade = context.networkCallsMade;

  for (const item of plan.decisions) {
    if (item.action !== "create" && item.action !== "update") {
      decisions.push(item);
      continue;
    }
    try {
      if (item.action === "create") {
        const created = await client.createIssue({
          repository: context.repository,
          token: context.token,
          title: item.title,
          body: item.body,
          labels: item.labels,
          dedupeFingerprint: item.dedupeFingerprint
        });
        externalCallsMade += 1;
        networkCallsMade += 1;
        createdIssues.push(created);
        decisions.push({ ...item, targetIssue: created });
      } else if (item.existingIssue) {
        const updated = await client.updateIssue({
          repository: context.repository,
          token: context.token,
          issueNumber: item.existingIssue.number,
          title: item.title,
          body: item.body,
          labels: item.labels,
          dedupeFingerprint: item.dedupeFingerprint
        });
        externalCallsMade += 1;
        networkCallsMade += 1;
        updatedIssues.push(updated);
        decisions.push({ ...item, targetIssue: updated });
      } else {
        decisions.push({ ...item, action: "blocked", reason: "Update decision had no target issue." });
        blockedReasons.push(`No existing issue target was available for ${item.dedupeFingerprint}.`);
      }
    } catch (error) {
      externalCallsMade += 1;
      networkCallsMade += 1;
      const reason = `GitHub issue ${item.action} failed for ${item.dedupeFingerprint}: ${sanitizeText(error instanceof Error ? error.message : String(error))}`;
      blockedReasons.push(reason);
      decisions.push({ ...item, action: "blocked", reason });
    }
  }

  return sanitizeValue({
    schemaVersion: "visual-hive.issue-publish-result.v1",
    generatedAt,
    project: plan.project,
    mode: "live",
    status: blockedReasons.length ? "failed" : "published",
    externalCallsMade,
    networkCallsMade,
    realGithubIssuesCreated: createdIssues.length,
    realGithubIssuesUpdated: updatedIssues.length,
    blockedReasons,
    decisions,
    createdIssues,
    updatedIssues
  }) as VisualHiveIssuePublishResult;
}

function decisionForIssue(rootDir: string, issue: VisualHiveIssueCandidate, existingIssue: VisualHivePublishedIssueRef | undefined, globalBlockedReasons: string[]): VisualHiveIssuePublishDecision {
  if (globalBlockedReasons.length) {
    return decision(rootDir, issue, "blocked", globalBlockedReasons[0] ?? "Issue publishing is blocked.", existingIssue);
  }
  if (issue.status === "suppressed") {
    return decision(rootDir, issue, "skip", `Suppressed: ${issue.suppressedReason ?? "suppression entry present"}`, existingIssue);
  }
  if (issue.status === "blocked") {
    return decision(rootDir, issue, "blocked", "Issue candidate is blocked by Visual Hive policy.", existingIssue);
  }
  if (issue.status === "resolved_candidate" && !existingIssue) {
    return decision(rootDir, issue, "skip", "Resolved candidate has no known published issue to update.", existingIssue);
  }
  if (existingIssue) {
    return decision(rootDir, issue, "update", issue.status === "resolved_candidate" ? "Existing issue should receive resolved-candidate evidence." : "Existing issue matches dedupe fingerprint.", existingIssue);
  }
  return decision(rootDir, issue, "create", "No existing issue was provided for this dedupe fingerprint.", existingIssue);
}

function setupIssueCandidate(project: string, setupBody: string, setupIssuePath: string, rootDir: string): VisualHiveIssueCandidate {
  return sanitizeValue({
    issueKind: "setup_needed",
    severity: "medium",
    status: "open_candidate",
    dedupeFingerprint: `visual-hive:setup:${safeFingerprintSegment(project)}`,
    title: "[Visual Hive] Setup visual QA",
    labels: ["visual-hive", "setup", "hive/quality", "visual-hive/agent-setup"],
    body: sanitizeArtifactPathsForMarkdown(rootDir, `${setupBody.trim()}\n\n## Visual Hive Setup Issue Routing\n\nVisual Hive generated this setup issue as a safe, reviewable entry point for humans, Hive, or setup agents. Visual Hive does not repair code, create repair branches, open pull requests, approve baselines, call Hive, call LLMs, or call paid providers from this default setup path.\n\nvisual-hive-dedupe: visual-hive:setup:${safeFingerprintSegment(project)}\n`),
    owningAgentHint: "visual-hive/setup",
    sourceArtifacts: [normalizeArtifactPath(rootDir, setupIssuePath)],
    affected: [],
    reproductionCommand: "visual-hive recommend --repo .",
    validationCommand: "visual-hive doctor && visual-hive plan --mode pr && visual-hive issues --write",
    linkedRepoMap: ".visual-hive/repo-map.json",
    guardrails: [
      "Keep PR workflows on pull_request with read-only permissions and no secrets.",
      "Do not approve baselines blindly during setup.",
      "Do not add paid providers, Hive calls, or LLM calls unless explicitly configured in a trusted lane.",
      "Validate setup with Visual Hive doctor, plan, and issues before publishing."
    ]
  }) as VisualHiveIssueCandidate;
}

function projectFromSetupIssue(body: string): string | undefined {
  return body.match(/Project:\s*([^\n]+)/i)?.[1]?.trim();
}

function safeFingerprintSegment(value: string): string {
  return sanitizeText(value).toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}

function decision(
  rootDir: string,
  issue: VisualHiveIssueCandidate,
  action: VisualHiveIssuePublishDecision["action"],
  reason: string,
  existingIssue?: VisualHivePublishedIssueRef
): VisualHiveIssuePublishDecision {
  const labels = issue.status === "resolved_candidate" ? dedupe([...issue.labels, "visual-hive/resolved-candidate"]) : issue.labels;
  const body = issue.status === "resolved_candidate" ? resolvedCandidateBody(issue.body) : issue.body;
  return sanitizeValue({
    dedupeFingerprint: issue.dedupeFingerprint,
    issueKind: issue.issueKind,
    title: issue.title,
    status: issue.status,
    severity: issue.severity,
    action,
    reason,
    labels,
    owningAgentHint: issue.owningAgentHint,
    validationCommand: issue.validationCommand,
    existingIssue,
    targetIssue: existingIssue,
    body: sanitizeArtifactPathsForMarkdown(rootDir, body)
  }) as VisualHiveIssuePublishDecision;
}

function resolvedCandidateBody(body: string): string {
  if (body.includes("## Resolved Candidate Evidence")) return body;
  return sanitizeText(`${body}\n\n## Resolved Candidate Evidence\n\nVisual Hive no longer detects this finding in the latest artifact set. Do not auto-close by default unless repository policy explicitly enables auto-close. A trusted workflow or human reviewer should add \`visual-hive/resolved-candidate\` or close the issue after reviewing validation evidence.\n`);
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.map((value) => sanitizeText(value)).filter(Boolean))];
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

function mergeIssueRefs(left: VisualHivePublishedIssueRef[], right: VisualHivePublishedIssueRef[]): VisualHivePublishedIssueRef[] {
  const byFingerprint = new Map<string, VisualHivePublishedIssueRef>();
  for (const issue of [...left, ...right]) {
    byFingerprint.set(issue.dedupeFingerprint, sanitizeValue(issue));
  }
  return [...byFingerprint.values()];
}

function createGitHubIssuePublisherClient(): GitHubIssuePublisherClient {
  return {
    async listOpenIssues(input) {
      const issues: VisualHivePublishedIssueRef[] = [];
      let page = 1;
      while (page <= 5) {
        const response = await githubFetch(input, `/issues?state=open&labels=${encodeURIComponent("visual-hive")}&per_page=100&page=${page}`);
        const rows = await response.json() as unknown[];
        if (!Array.isArray(rows) || !rows.length) break;
        for (const row of rows) {
          const issue = issueRefFromGitHub(row);
          if (issue) issues.push(issue);
        }
        if (rows.length < 100) break;
        page += 1;
      }
      return issues;
    },
    async createIssue(input) {
      const response = await githubFetch(input, "/issues", {
        method: "POST",
        body: JSON.stringify({ title: input.title, body: input.body, labels: input.labels })
      });
      const row = await response.json() as unknown;
      const issue = issueRefFromGitHub(row, input.dedupeFingerprint);
      if (!issue) throw new Error("GitHub create response did not include an issue reference.");
      return issue;
    },
    async updateIssue(input) {
      const response = await githubFetch(input, `/issues/${input.issueNumber}`, {
        method: "PATCH",
        body: JSON.stringify({ title: input.title, body: input.body, labels: input.labels })
      });
      const row = await response.json() as unknown;
      const issue = issueRefFromGitHub(row, input.dedupeFingerprint);
      if (!issue) throw new Error("GitHub update response did not include an issue reference.");
      return issue;
    }
  };
}

async function githubFetch(input: GitHubIssuePublisherInput, pathValue: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(`https://api.github.com/repos/${input.repository}${pathValue}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${input.token}`,
      "Content-Type": "application/json",
      "User-Agent": "visual-hive-issue-publisher",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers ?? {})
    }
  });
  if (!response.ok) {
    const text = sanitizeText(await response.text());
    throw new Error(`GitHub API returned ${response.status}: ${text.slice(0, 500)}`);
  }
  return response;
}

function issueRefFromGitHub(value: unknown, fallbackDedupe?: string): VisualHivePublishedIssueRef | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const number = typeof row.number === "number" ? row.number : undefined;
  const url = typeof row.html_url === "string" ? row.html_url : typeof row.url === "string" ? row.url : undefined;
  const title = typeof row.title === "string" ? row.title : undefined;
  const body = typeof row.body === "string" ? row.body : "";
  const labels = Array.isArray(row.labels)
    ? row.labels
        .map((label) => {
          if (typeof label === "string") return label;
          if (label && typeof label === "object" && !Array.isArray(label) && typeof (label as Record<string, unknown>).name === "string") {
            return (label as Record<string, string>).name;
          }
          return undefined;
        })
        .filter((label): label is string => Boolean(label))
    : [];
  const dedupeFingerprint = fallbackDedupe ?? extractDedupeFingerprint(body);
  if (!number || !url || !title || !dedupeFingerprint) return undefined;
  return sanitizeValue({ number, url, dedupeFingerprint, title, labels }) as VisualHivePublishedIssueRef;
}

function extractDedupeFingerprint(body: string): string | undefined {
  return body.match(/dedupe:\s*([A-Za-z0-9:_./-]+)/)?.[1] ?? body.match(/visual-hive-dedupe:\s*([A-Za-z0-9:_./-]+)/)?.[1];
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

function normalizeArtifactPath(rootDir: string, value: string): string {
  return sanitizeArtifactPathForIssue(rootDir, value.replaceAll("\\", "/"));
}

function sanitizeValue<T>(value: T): T {
  return JSON.parse(sanitizeText(JSON.stringify(value))) as T;
}
