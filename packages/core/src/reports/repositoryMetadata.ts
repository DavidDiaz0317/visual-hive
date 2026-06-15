import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { sanitizeText } from "../utils/sanitize.js";
import type { RepositoryMetadata } from "./types.js";

const execFileAsync = promisify(execFile);

export interface CollectRepositoryMetadataOptions {
  repoRoot: string;
  env?: NodeJS.ProcessEnv;
}

export async function collectRepositoryMetadata(options: CollectRepositoryMetadataOptions): Promise<RepositoryMetadata> {
  const env = options.env ?? process.env;
  const githubRepo = env.GITHUB_REPOSITORY;
  const remoteUrl = await git(options.repoRoot, ["config", "--get", "remote.origin.url"]);
  const branch = env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME || (await git(options.repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]));
  const commitSha = env.GITHUB_SHA || (await git(options.repoRoot, ["rev-parse", "HEAD"]));
  const pullRequestNumber = env.GITHUB_EVENT_NAME === "pull_request" ? pullRequestNumberFromRef(env.GITHUB_REF) : undefined;
  return {
    provider: env.GITHUB_ACTIONS === "true" ? "github-actions" : "local",
    repository: sanitizeText(githubRepo || repoNameFromRemote(remoteUrl) || "unknown"),
    owner: sanitizeOptional(githubRepo?.split("/")[0]),
    repo: sanitizeOptional(githubRepo?.split("/")[1]),
    remoteUrl: sanitizeOptional(remoteUrl),
    branch: sanitizeOptional(branch),
    baseBranch: sanitizeOptional(env.GITHUB_BASE_REF),
    commitSha: sanitizeOptional(commitSha),
    pullRequestNumber,
    runId: sanitizeOptional(env.GITHUB_RUN_ID),
    runAttempt: sanitizeOptional(env.GITHUB_RUN_ATTEMPT),
    workflow: sanitizeOptional(env.GITHUB_WORKFLOW),
    actor: sanitizeOptional(env.GITHUB_ACTOR)
  };
}

async function git(cwd: string, args: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd, timeout: 2000, windowsHide: true });
    const value = stdout.trim();
    return value || undefined;
  } catch {
    return undefined;
  }
}

function sanitizeOptional(value: string | undefined): string | undefined {
  return value ? sanitizeText(value) : undefined;
}

function repoNameFromRemote(remoteUrl: string | undefined): string | undefined {
  if (!remoteUrl) return undefined;
  const sanitized = remoteUrl.replace(/\.git$/i, "");
  const githubMatch = sanitized.match(/github\.com[:/](?<owner>[^/]+)\/(?<repo>[^/]+)$/i);
  if (githubMatch?.groups) return `${githubMatch.groups.owner}/${githubMatch.groups.repo}`;
  const parts = sanitized.split(/[/:\\]/).filter(Boolean);
  return parts.slice(-2).join("/") || undefined;
}

function pullRequestNumberFromRef(ref: string | undefined): number | undefined {
  if (!ref) return undefined;
  const match = ref.match(/refs\/pull\/(\d+)\/merge/);
  return match ? Number.parseInt(match[1] ?? "", 10) : undefined;
}
