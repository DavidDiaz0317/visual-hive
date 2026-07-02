import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const cliPath = path.join(repoRoot, "packages", "cli", "dist", "index.js");
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-smoke-"));

try {
  run("node", [cliPath, "--help"], repoRoot);
  run("node", [path.join(repoRoot, "scripts", "run-demo-suite.mjs"), "--dry-run", "ci"], repoRoot);
  run("node", [cliPath, "init", "--force"], tempRoot);
  assertExists(path.join(tempRoot, "visual-hive.config.yaml"));
  assertExists(path.join(tempRoot, ".github", "workflows", "visual-hive-pr.yml"));
  assertExists(path.join(tempRoot, ".github", "workflows", "visual-hive-scheduled.yml"));
  assertExists(path.join(tempRoot, ".github", "workflows", "visual-hive-failure-issue.yml"));
  assertExists(path.join(tempRoot, ".visual-hive", "generated"));
  console.log("CLI smoke test passed");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "pipe",
    encoding: "utf8",
    timeout: 30_000,
    windowsHide: true
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  }
}

function assertExists(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`Expected ${filePath} to exist`);
  }
}
