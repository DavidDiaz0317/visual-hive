import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveReleaseSourceIdentity } from "../../../scripts/release-source-identity.mjs";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("release source identity", () => {
  it("binds a clean release to exact HEAD", async () => {
    const fixture = await makeRepository();

    expect(resolveReleaseSourceIdentity({
      repoRoot: fixture.root,
      requireClean: true,
      env: { VISUAL_HIVE_GIT_COMMIT: fixture.head, GITHUB_SHA: fixture.head }
    })).toEqual({ gitCommit: fixture.head, clean: true });
  });

  it("rejects unstaged tracked changes for a release but permits a developer identity", async () => {
    const fixture = await makeRepository();
    await writeFile(path.join(fixture.root, "tracked.txt"), "changed\n", "utf8");

    expect(() => resolveReleaseSourceIdentity({ repoRoot: fixture.root, requireClean: true, env: {} }))
      .toThrow("clean Git worktree");
    expect(resolveReleaseSourceIdentity({ repoRoot: fixture.root, requireClean: false, env: {} }))
      .toEqual({ gitCommit: fixture.head, clean: false });
  });

  it("rejects staged changes for a release", async () => {
    const fixture = await makeRepository();
    await writeFile(path.join(fixture.root, "tracked.txt"), "staged\n", "utf8");
    git(fixture.root, ["add", "tracked.txt"]);

    expect(() => resolveReleaseSourceIdentity({ repoRoot: fixture.root, requireClean: true, env: {} }))
      .toThrow("clean Git worktree");
  });

  it("rejects relevant untracked files for a release", async () => {
    const fixture = await makeRepository();
    await writeFile(path.join(fixture.root, "untracked.txt"), "untracked\n", "utf8");

    expect(() => resolveReleaseSourceIdentity({ repoRoot: fixture.root, requireClean: true, env: {} }))
      .toThrow("clean Git worktree");
  });

  it("rejects mismatched or malformed release commit environment values", async () => {
    const fixture = await makeRepository();

    for (const name of ["VISUAL_HIVE_GIT_COMMIT", "GITHUB_SHA"]) {
      expect(() => resolveReleaseSourceIdentity({
        repoRoot: fixture.root,
        requireClean: true,
        env: { [name]: "b".repeat(40) }
      })).toThrow("does not match");
      expect(() => resolveReleaseSourceIdentity({
        repoRoot: fixture.root,
        requireClean: true,
        env: { [name]: "not-a-commit" }
      })).toThrow("exact 40-character");
    }
  });
});

async function makeRepository(): Promise<{ root: string; head: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-hive-release-source-"));
  tempRoots.push(root);
  git(root, ["init", "--quiet"]);
  git(root, ["config", "user.email", "visual-hive@example.invalid"]);
  git(root, ["config", "user.name", "Visual Hive Test"]);
  await writeFile(path.join(root, "tracked.txt"), "clean\n", "utf8");
  git(root, ["add", "tracked.txt"]);
  git(root, ["commit", "--quiet", "-m", "fixture"]);
  return { root, head: git(root, ["rev-parse", "HEAD"]) };
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    timeout: 10_000,
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}
