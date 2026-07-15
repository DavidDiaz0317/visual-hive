import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const buildScript = path.join(repoRoot, "scripts", "build-release-bundle.mjs");
const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("release bundle traversal", () => {
  it("accepts only real directories and regular files", async () => {
    const root = await makeTempRoot();
    await mkdir(path.join(root, "nested"));
    await writeFile(path.join(root, "nested", "file.txt"), "release\n", "utf8");

    const result = await execFileAsync(process.execPath, [buildScript, "--verify-tree-only", root], {
      cwd: repoRoot,
      timeout: 10_000,
      windowsHide: true
    });

    expect(JSON.parse(result.stdout)).toEqual([path.join("nested", "file.txt")]);
  });

  it("rejects symlinked directories without following them", async () => {
    const temp = await makeTempRoot();
    const root = path.join(temp, "bundle");
    const target = path.join(temp, "target");
    await mkdir(root);
    await mkdir(target);
    await writeFile(path.join(target, "outside.txt"), "outside\n", "utf8");
    await symlink(target, path.join(root, "linked"), process.platform === "win32" ? "junction" : "dir");

    await expect(runVerify(root)).rejects.toThrow("release bundle cannot contain symlinks");
  });

  it.runIf(process.platform !== "win32")("rejects symlinked files without reading them", async () => {
    const temp = await makeTempRoot();
    const root = path.join(temp, "bundle");
    const target = path.join(temp, "outside.txt");
    await mkdir(root);
    await writeFile(target, "outside\n", "utf8");
    await symlink(target, path.join(root, "linked.txt"), "file");

    await expect(runVerify(root)).rejects.toThrow("release bundle cannot contain symlinks");
  });
});

async function runVerify(root: string): Promise<void> {
  try {
    await execFileAsync(process.execPath, [buildScript, "--verify-tree-only", root], {
      cwd: repoRoot,
      timeout: 10_000,
      windowsHide: true
    });
  } catch (error) {
    const stderr = typeof error === "object" && error && "stderr" in error ? String(error.stderr) : String(error);
    throw new Error(stderr);
  }
}

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-hive-release-tree-"));
  tempRoots.push(root);
  return root;
}
