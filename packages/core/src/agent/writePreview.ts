import { spawn } from "node:child_process";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { readJson, writeJson } from "../utils/files.js";
import { sanitizeText } from "../utils/sanitize.js";
import type { VisualHiveIssueCandidate, VisualHiveIssuesReport } from "../issues/types.js";

export interface AgentWritePreviewOptions {
  rootDir: string;
  project?: string;
  issuesPath?: string;
  dedupeFingerprint?: string;
  issueIndex?: number;
  allowWrite?: boolean;
  writePreviewBranch?: boolean;
  allowDirty?: boolean;
  commitPreview?: boolean;
  now?: Date;
  gitRunner?: GitRunner;
  outputPath?: string;
}

export type GitRunner = (args: string[], cwd: string, timeoutMs: number) => Promise<{ status: number | null; stdout: string; stderr: string; error?: string }>;

export interface AgentWritePreview {
  schemaVersion: "visual-hive.agent-write-preview.v1";
  generatedAt: string;
  project: string;
  mode: "dry_run" | "write_preview";
  status: "planned" | "created" | "blocked" | "noop";
  issue: {
    dedupeFingerprint: string;
    title: string;
    issueKind: string;
    status: string;
  };
  branchName: string;
  validationCommand: string;
  changedFiles: string[];
  blockedReasons: string[];
  safety: {
    branchesCreated: number;
    commitsCreated: number;
    pullRequestsOpened: 0;
    pushesPerformed: 0;
    realGithubIssuesCreated: 0;
    sourceMutations: 0;
    externalCallsMade: 0;
    networkCallsMade: 0;
  };
}

export async function writeAgentWritePreview(options: AgentWritePreviewOptions): Promise<{ preview: AgentWritePreview; outputPath: string }> {
  const rootDir = path.resolve(options.rootDir);
  const issues = await readJson<VisualHiveIssuesReport>(resolve(rootDir, options.issuesPath ?? ".visual-hive/issues.json"));
  const issue = selectIssue(issues.issues, options);
  const branchName = `visual-hive/issue-${safeSegment(issue.dedupeFingerprint).slice(0, 48)}-preview`;
  const outputPath = resolve(rootDir, options.outputPath ?? `.visual-hive/agents/${safeSegment(issue.dedupeFingerprint)}/write-preview.json`);
  const generatedAt = (options.now ?? new Date()).toISOString();
  const blockedReasons: string[] = [];
  const mode = options.allowWrite && options.writePreviewBranch ? "write_preview" : "dry_run";
  const runner = options.gitRunner ?? defaultGitRunner;

  let changedFiles: string[] = [];
  let branchesCreated = 0;
  let commitsCreated = 0;
  let status: AgentWritePreview["status"] = mode === "dry_run" ? "planned" : "noop";

  if (mode === "write_preview") {
    const dirty = await runner(["status", "--short"], rootDir, 5000);
    if (dirty.status !== 0) {
      blockedReasons.push(`Unable to inspect git working tree: ${sanitizeText(dirty.stderr || dirty.error || "unknown git status failure")}`);
    } else if (dirty.stdout.trim() && !options.allowDirty) {
      blockedReasons.push("Refusing write-preview branch because the working tree is dirty. Pass --allow-dirty only in a trusted local context.");
    }

    if (!blockedReasons.length) {
      const create = await runner(["switch", "-c", branchName], rootDir, 10000);
      if (create.status === 0) {
        branchesCreated = 1;
        status = "created";
      } else {
        blockedReasons.push(`Unable to create write-preview branch ${branchName}: ${sanitizeText(create.stderr || create.error || "git switch failed")}`);
      }
    }

    if (!blockedReasons.length && options.commitPreview) {
      const diff = await runner(["status", "--short"], rootDir, 5000);
      changedFiles = parseChangedFiles(diff.stdout);
      if (changedFiles.length) {
        await runner(["add", "--", ...changedFiles], rootDir, 10000);
        const commit = await runner(["commit", "-m", `Visual Hive write preview ${issue.dedupeFingerprint}`], rootDir, 10000);
        if (commit.status === 0) commitsCreated = 1;
        else blockedReasons.push(`Preview commit failed: ${sanitizeText(commit.stderr || commit.error || "git commit failed")}`);
      }
    }
  }

  if (blockedReasons.length) status = "blocked";
  const preview: AgentWritePreview = {
    schemaVersion: "visual-hive.agent-write-preview.v1",
    generatedAt,
    project: options.project ?? issues.project,
    mode,
    status,
    issue: {
      dedupeFingerprint: issue.dedupeFingerprint,
      title: issue.title,
      issueKind: issue.issueKind,
      status: issue.status
    },
    branchName,
    validationCommand: issue.validationCommand,
    changedFiles,
    blockedReasons,
    safety: {
      branchesCreated,
      commitsCreated,
      pullRequestsOpened: 0,
      pushesPerformed: 0,
      realGithubIssuesCreated: 0,
      sourceMutations: 0,
      externalCallsMade: 0,
      networkCallsMade: 0
    }
  };
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeJson(outputPath, preview);
  return { preview, outputPath };
}

function selectIssue(issues: VisualHiveIssueCandidate[], options: Pick<AgentWritePreviewOptions, "dedupeFingerprint" | "issueIndex">): VisualHiveIssueCandidate {
  if (!issues.length) throw new Error("No issue candidates found. Run visual-hive issues --write first.");
  if (options.dedupeFingerprint) {
    const match = issues.find((issue) => issue.dedupeFingerprint === options.dedupeFingerprint);
    if (!match) throw new Error(`No issue candidate matched dedupe fingerprint ${sanitizeText(options.dedupeFingerprint)}.`);
    return match;
  }
  return issues[options.issueIndex ?? 0] ?? issues[0]!;
}

function defaultGitRunner(args: string[], cwd: string, timeoutMs: number): Promise<{ status: number | null; stdout: string; stderr: string; error?: string }> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const timer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
        // Already exited.
      }
      finish({ status: null, stdout, stderr, error: "git command timed out" });
    }, timeoutMs);
    const finish = (result: { status: number | null; stdout: string; stderr: string; error?: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => finish({ status: null, stdout, stderr, error: error.message }));
    child.on("close", (status) => finish({ status, stdout, stderr }));
  });
}

function parseChangedFiles(stdout: string): string[] {
  return stdout.split(/\r?\n/).map((line) => line.slice(3).trim()).filter(Boolean);
}

function safeSegment(value: string): string {
  return sanitizeText(value).replace(/[^A-Za-z0-9_.-]+/g, "-").slice(0, 96);
}

function resolve(rootDir: string, artifactPath: string): string {
  return path.isAbsolute(artifactPath) ? artifactPath : path.resolve(rootDir, artifactPath);
}
