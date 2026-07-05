import path from "node:path";
import { mkdir } from "node:fs/promises";
import { readJson, writeJson, writeText } from "../utils/files.js";
import { sanitizeText } from "../utils/sanitize.js";
import type { VisualHiveIssueCandidate, VisualHiveIssuesReport, VisualHiveOwningAgentHint } from "../issues/types.js";

export type AgentIssueRunnerProfile = "setup_agent" | "map_agent" | "test_creator_agent" | "test_maintainer_agent" | "mutation_agent" | "review_agent";
export type AgentIssueRunnerMode = "no_write" | "write_preview";
export type AgentIssueRunStatus = "completed" | "blocked";

export interface AgentIssueRun {
  schemaVersion: "visual-hive.agent-issue-run.v1";
  generatedAt: string;
  project: string;
  mode: AgentIssueRunnerMode;
  status: AgentIssueRunStatus;
  profile: AgentIssueRunnerProfile;
  selectedIssue: {
    dedupeFingerprint: string;
    issueKind: string;
    severity: string;
    status: string;
    title: string;
    owningAgentHint: string;
  };
  parsedIssue: {
    affectedRoutes: string[];
    affectedComponents: string[];
    affectedContracts: string[];
    affectedSelectors: string[];
    affectedViewports: string[];
    sourceArtifacts: string[];
    evidenceArtifacts: string[];
    reproductionCommand?: string;
    validationCommand: string;
    guardrails: string[];
  };
  codexCli: {
    command: string;
    discoveryStatus: "not_executed";
    helpExcerpt?: string;
  };
  budgets: {
    maxRuntimeMs: number;
    maxToolCalls: number;
    maxPromptTokens: number;
    allowWrite: boolean;
    allowExternalNetwork: false;
    maxExternalCostUsd: 0;
  };
  safety: {
    sourceMutations: 0;
    branchesCreated: 0;
    pullRequestsOpened: 0;
    externalCallsMade: 0;
    networkCallsMade: 0;
    realGithubIssuesCreated: 0;
    realGithubIssuesUpdated: 0;
    hiveApiCallsMade: 0;
    llmCallsMade: 0;
    paidProviderCallsMade: 0;
  };
  artifactPaths: {
    request: string;
    output: string;
    run: string;
  };
  recommendations: string[];
  blockedReasons: string[];
}

export interface BuildAgentIssueRunOptions {
  rootDir: string;
  project?: string;
  issuesPath?: string;
  dedupeFingerprint?: string;
  issueIndex?: number;
  kind?: string;
  allowWrite?: boolean;
  codexCommand?: string;
  maxRuntimeMs?: number;
  maxToolCalls?: number;
  maxPromptTokens?: number;
  now?: Date;
}

export interface WriteAgentIssueRunOptions extends BuildAgentIssueRunOptions {
  outputDir?: string;
}

export interface AgentIssueRunArtifacts {
  run: AgentIssueRun;
  requestMarkdown: string;
  outputMarkdown: string;
  requestPath: string;
  outputPath: string;
  runPath: string;
}

const DEFAULT_BUDGETS = {
  maxRuntimeMs: 300000,
  maxToolCalls: 12,
  maxPromptTokens: 12000
};

export async function buildAgentIssueRun(options: BuildAgentIssueRunOptions): Promise<Omit<AgentIssueRunArtifacts, "requestPath" | "outputPath" | "runPath">> {
  const rootDir = path.resolve(options.rootDir);
  const issuesPath = resolve(rootDir, options.issuesPath ?? ".visual-hive/issues.json");
  const issuesReport = await readJson<VisualHiveIssuesReport>(issuesPath);
  const issue = selectIssue(issuesReport.issues, options);
  const generatedAt = (options.now ?? new Date()).toISOString();
  const profile = profileForIssue(issue);
  const mode: AgentIssueRunnerMode = options.allowWrite ? "write_preview" : "no_write";
  const parsedIssue = parseIssue(issue);
  const blockedReasons = issue.status === "blocked" ? ["Issue candidate is blocked by Visual Hive policy."] : [];
  const runRelativeDir = issueRunRelativeDir(issue);
  const artifactPaths = {
    request: `${runRelativeDir}/agent-request.md`,
    output: `${runRelativeDir}/agent-output.md`,
    run: `${runRelativeDir}/agent-run.json`
  };
  const recommendations = recommendationsFor(issue, profile, mode);
  const run: AgentIssueRun = sanitizeValue({
    schemaVersion: "visual-hive.agent-issue-run.v1",
    generatedAt,
    project: options.project ?? issuesReport.project,
    mode,
    status: blockedReasons.length ? "blocked" : "completed",
    profile,
    selectedIssue: {
      dedupeFingerprint: issue.dedupeFingerprint,
      issueKind: issue.issueKind,
      severity: issue.severity,
      status: issue.status,
      title: issue.title,
      owningAgentHint: issue.owningAgentHint
    },
    parsedIssue,
    codexCli: {
      command: options.codexCommand ?? "codex",
      discoveryStatus: "not_executed",
      helpExcerpt: "Codex CLI execution is disabled in the default no-write Visual Hive issue-runner path."
    },
    budgets: {
      maxRuntimeMs: options.maxRuntimeMs ?? DEFAULT_BUDGETS.maxRuntimeMs,
      maxToolCalls: options.maxToolCalls ?? DEFAULT_BUDGETS.maxToolCalls,
      maxPromptTokens: options.maxPromptTokens ?? DEFAULT_BUDGETS.maxPromptTokens,
      allowWrite: Boolean(options.allowWrite),
      allowExternalNetwork: false,
      maxExternalCostUsd: 0
    },
    safety: {
      sourceMutations: 0,
      branchesCreated: 0,
      pullRequestsOpened: 0,
      externalCallsMade: 0,
      networkCallsMade: 0,
      realGithubIssuesCreated: 0,
      realGithubIssuesUpdated: 0,
      hiveApiCallsMade: 0,
      llmCallsMade: 0,
      paidProviderCallsMade: 0
    },
    artifactPaths,
    recommendations,
    blockedReasons
  }) as AgentIssueRun;
  const requestMarkdown = renderAgentRequest(issue, run);
  const outputMarkdown = renderAgentOutput(issue, run);
  return { run, requestMarkdown, outputMarkdown };
}

export async function writeAgentIssueRun(options: WriteAgentIssueRunOptions): Promise<AgentIssueRunArtifacts> {
  const rootDir = path.resolve(options.rootDir);
  const built = await buildAgentIssueRun(options);
  const outputDir = resolve(rootDir, options.outputDir ?? issueRunRelativeDirFromRun(built.run));
  await mkdir(outputDir, { recursive: true });
  const requestPath = path.join(outputDir, "agent-request.md");
  const outputPath = path.join(outputDir, "agent-output.md");
  const runPath = path.join(outputDir, "agent-run.json");
  const artifactPaths = {
    request: relative(rootDir, requestPath),
    output: relative(rootDir, outputPath),
    run: relative(rootDir, runPath)
  };
  const run = sanitizeValue({ ...built.run, artifactPaths }) as AgentIssueRun;
  const requestMarkdown = renderAgentRequestFromRun(built.requestMarkdown, run);
  const outputMarkdown = renderAgentOutputFromRun(built.outputMarkdown, run);
  await writeText(requestPath, requestMarkdown);
  await writeText(outputPath, outputMarkdown);
  await writeJson(runPath, run);
  return { run, requestMarkdown, outputMarkdown, requestPath, outputPath, runPath };
}

function selectIssue(issues: VisualHiveIssueCandidate[], options: BuildAgentIssueRunOptions): VisualHiveIssueCandidate {
  if (!issues.length) {
    throw new Error("No issue candidates found. Run visual-hive issues --write first.");
  }
  if (options.dedupeFingerprint) {
    const match = issues.find((issue) => issue.dedupeFingerprint === options.dedupeFingerprint);
    if (!match) throw new Error(`No issue candidate matched dedupe fingerprint ${sanitizeText(options.dedupeFingerprint)}.`);
    return match;
  }
  if (options.kind) {
    const match = issues.find((issue) => issue.issueKind === options.kind && issue.status !== "suppressed" && issue.status !== "resolved_candidate");
    if (!match) throw new Error(`No active issue candidate matched kind ${sanitizeText(options.kind)}.`);
    return match;
  }
  const index = options.issueIndex ?? 0;
  const active = issues.filter((issue) => issue.status !== "suppressed" && issue.status !== "resolved_candidate");
  const selected = active[index] ?? issues[index];
  if (!selected) throw new Error(`No issue candidate exists at index ${index}.`);
  return selected;
}

function profileForIssue(issue: VisualHiveIssueCandidate): AgentIssueRunnerProfile {
  const byOwner: Record<VisualHiveOwningAgentHint, AgentIssueRunnerProfile> = {
    "visual-hive/setup": "setup_agent",
    "visual-hive/map": "map_agent",
    "visual-hive/test-creator": "test_creator_agent",
    "visual-hive/test-maintainer": "test_maintainer_agent",
    "visual-hive/mutation": "mutation_agent",
    "hive/quality": "review_agent",
    "hive/ci": "review_agent",
    "hive/architect": "review_agent"
  };
  if (issue.issueKind === "mutation_survivor") return "test_creator_agent";
  if (issue.issueKind === "map_drift") return "map_agent";
  if (issue.issueKind === "setup_needed" || issue.issueKind === "external_repo_onboarding") return "setup_agent";
  return byOwner[issue.owningAgentHint] ?? "review_agent";
}

function parseIssue(issue: VisualHiveIssueCandidate): AgentIssueRun["parsedIssue"] {
  return {
    affectedRoutes: dedupe(issue.affected.map((surface) => surface.route)),
    affectedComponents: dedupe(issue.affected.map((surface) => surface.component)),
    affectedContracts: dedupe(issue.affected.map((surface) => surface.contractId)),
    affectedSelectors: dedupe(issue.affected.map((surface) => surface.selector)),
    affectedViewports: dedupe(issue.affected.map((surface) => surface.viewport)),
    sourceArtifacts: issue.sourceArtifacts,
    evidenceArtifacts: dedupe([
      issue.linkedEvidencePacket,
      issue.linkedRepoMap,
      issue.linkedMutationReport,
      issue.linkedHandoff,
      issue.linkedHiveExport,
      issue.linkedKnowledgeGraph,
      issue.linkedAgentPacket
    ]),
    reproductionCommand: issue.reproductionCommand,
    validationCommand: issue.validationCommand,
    guardrails: issue.guardrails
  };
}

function recommendationsFor(issue: VisualHiveIssueCandidate, profile: AgentIssueRunnerProfile, mode: AgentIssueRunnerMode): string[] {
  const common = [
    "Read the linked Evidence Packet, repo map, and issue body before proposing any change.",
    "Do not decide pass/fail; rerun the issue validation command after any future write-mode change.",
    "Do not approve baselines blindly or weaken thresholds to make the issue disappear."
  ];
  if (mode === "no_write") {
    common.push("Default run is advisory no-write: produce analysis and a proposed plan only.");
  }
  if (issue.issueKind === "mutation_survivor") {
    return [
      ...common,
      "Use the mutation survivor as the concrete missing-test signal.",
      "Recommend selector, text, visual, or flow assertions that would kill the mutation.",
      "Prefer adding a focused contract over broadening screenshot tolerance."
    ];
  }
  if (profile === "test_creator_agent") {
    return [
      ...common,
      "Use the linked coverage gap, route, selector, or flow evidence as the concrete missing-test signal.",
      "Recommend a focused selector, text, visual, or flow contract that covers the affected surface.",
      "Prefer adding targeted coverage over broadening screenshot tolerance."
    ];
  }
  if (profile === "test_maintainer_agent") {
    return [...common, "Recommend stronger selectors, waits, masks, or explicit baseline review actions."];
  }
  if (profile === "setup_agent") {
    return [...common, "Recommend config, workflow, selector, or setup issue changes in a reviewed branch."];
  }
  if (profile === "map_agent") {
    return [...common, "Recommend repo-map or contract reference updates grounded in static and config evidence."];
  }
  return [...common, "Verify the issue is actionable and identify the smallest safe next validation step."];
}

function renderAgentRequest(issue: VisualHiveIssueCandidate, run: AgentIssueRun): string {
  return sanitizeText([
    `# Visual Hive Issue Agent Request`,
    "",
    `Issue: ${issue.title}`,
    `Dedupe: ${issue.dedupeFingerprint}`,
    `Profile: ${run.profile}`,
    `Mode: ${run.mode}`,
    "",
    "## Objective",
    "",
    `Act on this issue as ${run.profile}. In default mode, produce a recommendation only and do not write code.`,
    "",
    "## Parsed Evidence",
    "",
    `- Issue kind: ${issue.issueKind}`,
    `- Severity: ${issue.severity}`,
    `- Status: ${issue.status}`,
    `- Owning agent hint: ${issue.owningAgentHint}`,
    `- Reproduction command: ${issue.reproductionCommand ?? "not recorded"}`,
    `- Validation command: ${issue.validationCommand}`,
    `- Source artifacts: ${issue.sourceArtifacts.join(", ") || "none"}`,
    `- Evidence artifacts: ${run.parsedIssue.evidenceArtifacts.join(", ") || "none"}`,
    "",
    "## Recommended Agent Plan",
    "",
    ...run.recommendations.map((recommendation) => `- ${recommendation}`),
    "",
    "## Guardrails",
    "",
    ...issue.guardrails.map((guardrail) => `- ${guardrail}`),
    "",
    "## Agent Budget",
    "",
    `- Max runtime ms: ${run.budgets.maxRuntimeMs}`,
    `- Max tool calls: ${run.budgets.maxToolCalls}`,
    `- Max prompt tokens: ${run.budgets.maxPromptTokens}`,
    `- Allow write: ${run.budgets.allowWrite}`,
    `- Allow external network: ${run.budgets.allowExternalNetwork}`,
    `- Max external cost USD: ${run.budgets.maxExternalCostUsd}`
  ].join("\n"));
}

function renderAgentRequestFromRun(markdown: string, run: AgentIssueRun): string {
  return sanitizeText(`${markdown}\n\n## Output Artifacts\n\n- Request: ${run.artifactPaths.request}\n- Output: ${run.artifactPaths.output}\n- Run JSON: ${run.artifactPaths.run}\n`);
}

function renderAgentOutput(issue: VisualHiveIssueCandidate, run: AgentIssueRun): string {
  return sanitizeText([
    `# Visual Hive Issue Agent Output`,
    "",
    `Status: ${run.status}`,
    `Issue: ${issue.title}`,
    `Profile: ${run.profile}`,
    "",
    "This default Visual Hive issue-runner did not call Codex, Hive, LLMs, providers, or GitHub. It produced a bounded request and recommendation artifact for a human or trusted agent runner.",
    "",
    "## Recommended Next Steps",
    "",
    ...run.recommendations.map((recommendation) => `- ${recommendation}`),
    "",
    "## Safety Counters",
    "",
    `- Source mutations: ${run.safety.sourceMutations}`,
    `- Branches created: ${run.safety.branchesCreated}`,
    `- Pull requests opened: ${run.safety.pullRequestsOpened}`,
    `- External calls made: ${run.safety.externalCallsMade}`,
    `- Real GitHub issues created: ${run.safety.realGithubIssuesCreated}`
  ].join("\n"));
}

function renderAgentOutputFromRun(markdown: string, run: AgentIssueRun): string {
  return sanitizeText(`${markdown}\n\n## Output Artifacts\n\n- Request: ${run.artifactPaths.request}\n- Output: ${run.artifactPaths.output}\n- Run JSON: ${run.artifactPaths.run}\n`);
}

function issueRunRelativeDir(issue: VisualHiveIssueCandidate): string {
  return `.visual-hive/agents/${safeSegment(issue.dedupeFingerprint)}`;
}

function issueRunRelativeDirFromRun(run: AgentIssueRun): string {
  return `.visual-hive/agents/${safeSegment(run.selectedIssue.dedupeFingerprint)}`;
}

function safeSegment(value: string): string {
  return sanitizeText(value).replace(/[^A-Za-z0-9_.-]+/g, "-").slice(0, 96);
}

function dedupe(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)).map((value) => sanitizeText(value)))];
}

function resolve(rootDir: string, artifactPath: string): string {
  return path.isAbsolute(artifactPath) ? artifactPath : path.resolve(rootDir, artifactPath);
}

function relative(rootDir: string, filePath: string): string {
  return path.relative(rootDir, filePath).replaceAll(path.sep, "/");
}

function sanitizeValue<T>(value: T): T {
  return JSON.parse(sanitizeText(JSON.stringify(value))) as T;
}
