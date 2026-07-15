import { execFileSync } from "node:child_process";

const EXACT_GIT_COMMIT = /^[a-f0-9]{40}$/;
const COMMIT_ENVIRONMENT_VARIABLES = ["VISUAL_HIVE_GIT_COMMIT", "GITHUB_SHA"];

/**
 * Resolve source identity without turning an ordinary developer build into a
 * release gate. Distribution callers opt into requireClean and fail closed.
 */
export function resolveReleaseSourceIdentity({ repoRoot, env = process.env, requireClean = false }) {
  let gitCommit;
  let status;
  try {
    gitCommit = runGit(repoRoot, ["rev-parse", "--verify", "HEAD^{commit}"]);
    status = runGit(repoRoot, ["status", "--porcelain=v1", "--untracked-files=all"]);
  } catch (error) {
    if (requireClean) {
      throw new Error(`Visual Hive release identity requires an accessible Git checkout: ${message(error)}`);
    }
    return { gitCommit: "unavailable", clean: false };
  }

  if (!EXACT_GIT_COMMIT.test(gitCommit)) {
    if (requireClean) throw new Error("Visual Hive release identity requires an exact 40-character HEAD commit.");
    return { gitCommit: "unavailable", clean: false };
  }

  if (requireClean) {
    for (const name of COMMIT_ENVIRONMENT_VARIABLES) {
      const value = env[name]?.trim();
      if (!value) continue;
      if (!EXACT_GIT_COMMIT.test(value)) {
        throw new Error(`${name} must be the exact 40-character Git HEAD commit for a Visual Hive release.`);
      }
      if (value !== gitCommit) {
        throw new Error(`${name} does not match the Visual Hive release HEAD commit ${gitCommit}.`);
      }
    }
    if (status) {
      const entries = status.split(/\r?\n/).filter(Boolean);
      throw new Error(`Visual Hive release identity requires a clean Git worktree; found ${entries.length} staged, unstaged, or untracked path(s).`);
    }
  }

  return { gitCommit, clean: status.length === 0 };
}

function runGit(repoRoot, args) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    windowsHide: true,
    timeout: 10_000,
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function message(error) {
  return error instanceof Error ? error.message : String(error);
}
