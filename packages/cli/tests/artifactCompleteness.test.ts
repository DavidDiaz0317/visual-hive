import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runArtifactsCommand } from "../src/commands/artifacts.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("complete artifact indexing", () => {
  it("fails closed when the complete artifact root cannot be enumerated", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "visual-hive-complete-index-missing-"));
    roots.push(root);

    await expect(runArtifactsCommand({ cwd: root, repo: ".", complete: true }))
      .rejects.toThrow(/could not enumerate \.visual-hive \(ENOENT\)/);
    const failedSeal = JSON.parse(await readFile(path.join(root, ".visual-hive", "artifacts-index.json"), "utf8"));
    expect(failedSeal).toMatchObject({ contentAddressed: true, complete: false, artifacts: [] });
    expect(failedSeal.warnings[0]).toContain("Final complete artifact sealing failed");
  });

  it("writes content hashes and fails closed when the requested complete index omits evidence", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "visual-hive-complete-index-"));
    roots.push(root);
    await mkdir(path.join(root, ".visual-hive"), { recursive: true });
    await writeFile(path.join(root, ".visual-hive", "report.json"), "{}\n", "utf8");
    await writeFile(path.join(root, ".visual-hive", "mutation-report.json"), "{}\n", "utf8");

    await expect(runArtifactsCommand({ cwd: root, repo: ".", complete: true, maxArtifacts: 1 }))
      .rejects.toThrow(/1 of 2 discovered artifacts were omitted/);
    const incomplete = JSON.parse(await readFile(path.join(root, ".visual-hive", "artifacts-index.json"), "utf8"));
    expect(incomplete).toMatchObject({
      contentAddressed: true,
      complete: false,
      summary: { discoveredArtifactCount: 2, artifactCount: 1, omittedArtifactCount: 1 }
    });
    expect(incomplete.artifacts[0].sha256).toMatch(/^[a-f0-9]{64}$/);

    const complete = await runArtifactsCommand({ cwd: root, repo: ".", complete: true });
    expect(complete.index.complete).toBe(true);
    expect(complete.index.summary.omittedArtifactCount).toBe(0);
    expect(complete.index.artifacts).toHaveLength(2);
  });

  it("atomically replaces a prior complete seal with an incomplete receipt when final traversal fails", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "visual-hive-complete-index-stale-"));
    const outside = await mkdtemp(path.join(os.tmpdir(), "visual-hive-complete-index-outside-"));
    roots.push(root, outside);
    await mkdir(path.join(root, ".visual-hive"), { recursive: true });
    await writeFile(path.join(root, ".visual-hive", "report.json"), "{}\n", "utf8");
    const initial = await runArtifactsCommand({ cwd: root, repo: ".", complete: true });
    expect(initial.index.complete).toBe(true);
    await symlink(outside, path.join(root, ".visual-hive", "linked"), process.platform === "win32" ? "junction" : "dir");

    await expect(runArtifactsCommand({ cwd: root, repo: ".", complete: true }))
      .rejects.toThrow("Complete artifact indexing refuses non-regular entry");
    const failedSeal = JSON.parse(await readFile(path.join(root, ".visual-hive", "artifacts-index.json"), "utf8"));
    expect(failedSeal).toMatchObject({ contentAddressed: true, complete: false, artifacts: [] });
    expect(failedSeal.warnings[0]).toContain("refuses non-regular entry");
  });

  it("refuses a linked artifact root without reading or sealing outside the repository", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "visual-hive-complete-index-root-link-"));
    const outside = await mkdtemp(path.join(os.tmpdir(), "visual-hive-complete-index-root-outside-"));
    roots.push(root, outside);
    await writeFile(path.join(outside, "outside.json"), "{}\n", "utf8");
    await symlink(outside, path.join(root, ".visual-hive"), process.platform === "win32" ? "junction" : "dir");

    await expect(runArtifactsCommand({ cwd: root, repo: ".", complete: true }))
      .rejects.toThrow(/symbolic link|reparse point|non-regular entry/);
    await expect(readFile(path.join(outside, "artifacts-index.json"), "utf8")).rejects.toThrow();
  });

  it("rejects a duplicate complete writer while an owner lock is active", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "visual-hive-complete-index-active-lock-"));
    roots.push(root);
    await mkdir(path.join(root, ".visual-hive"), { recursive: true });
    await writeFile(path.join(root, ".visual-hive", "report.json"), "{}\n", "utf8");
    const initial = await runArtifactsCommand({ cwd: root, repo: ".", complete: true });
    expect(initial.index.complete).toBe(true);
    await writeFile(
      path.join(root, ".visual-hive-artifacts-index.lock"),
      `${JSON.stringify({ token: "active-test-owner", pid: process.pid, createdAt: new Date().toISOString() })}\n`,
      "utf8"
    );

    await expect(runArtifactsCommand({ cwd: root, repo: ".", complete: true }))
      .rejects.toThrow(/already running/);
    const preserved = JSON.parse(await readFile(path.join(root, ".visual-hive", "artifacts-index.json"), "utf8"));
    expect(preserved.complete).toBe(true);
  });

  it("recovers a well-formed stale lock before publishing a complete seal", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "visual-hive-complete-index-stale-lock-"));
    roots.push(root);
    await mkdir(path.join(root, ".visual-hive"), { recursive: true });
    await writeFile(path.join(root, ".visual-hive", "report.json"), "{}\n", "utf8");
    const lockPath = path.join(root, ".visual-hive-artifacts-index.lock");
    await writeFile(
      lockPath,
      `${JSON.stringify({ token: "stale-test-owner", pid: 2_147_483_647, createdAt: "2000-01-01T00:00:00.000Z" })}\n`,
      "utf8"
    );

    const result = await runArtifactsCommand({ cwd: root, repo: ".", complete: true });

    expect(result.index.complete).toBe(true);
    await expect(access(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
