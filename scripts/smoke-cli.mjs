import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const cliPath = path.join(repoRoot, "packages", "cli", "dist", "index.js");
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-smoke-"));

try {
  const rootHelp = run("node", [cliPath, "--help"], repoRoot);
  assertIncludes(rootHelp.stdout, "Usage: visual-hive");
  assertIncludes(rootHelp.stdout, "hive");

  const hiveHelp = run("node", [cliPath, "hive", "--help"], repoRoot);
  assertIncludes(hiveHelp.stdout, "guarded-repair-preview");
  assertIncludes(hiveHelp.stdout, "repair-request-envelope");
  assertIncludes(hiveHelp.stdout, "trusted-repair-consumer-summary");
  assertIncludes(hiveHelp.stdout, "trusted-repair-workflow-dry-run");

  const contextHelp = run("node", [cliPath, "context", "--help"], repoRoot);
  assertIncludes(contextHelp.stdout, "--max-tool-calls");
  assertIncludes(contextHelp.stdout, "--max-tool-result-tokens");
  assertIncludes(contextHelp.stdout, "--max-external-cost-usd");
  assertIncludes(contextHelp.stdout, "--max-provider-screenshots");

  const runWithEnv = path.join(repoRoot, "scripts", "run-with-env.mjs");
  const envCheck = run("node", [runWithEnv, "VISUAL_HIVE_SMOKE_VALUE=ok", "--", "node", "-p", "process.env.VISUAL_HIVE_SMOKE_VALUE"], repoRoot);
  assertIncludes(envCheck.stdout, "ok");
  const timeoutCheck = runWithStatus(
    "node",
    [runWithEnv, "VISUAL_HIVE_RUN_WITH_ENV_TIMEOUT_MS=50", "--", "node", "-e", "setInterval(() => {}, 1000)"],
    repoRoot,
    124
  );
  assertIncludes(timeoutCheck.stderr, "timed out after 50ms");

  run("node", [path.join(repoRoot, "scripts", "run-demo-suite.mjs"), "--dry-run", "ci"], repoRoot);
  run("node", [cliPath, "init", "--force"], tempRoot);
  assertExists(path.join(tempRoot, "visual-hive.config.yaml"));
  assertExists(path.join(tempRoot, ".github", "workflows", "visual-hive-pr.yml"));
  assertExists(path.join(tempRoot, ".github", "workflows", "visual-hive-scheduled.yml"));
  assertExists(path.join(tempRoot, ".github", "workflows", "visual-hive-failure-issue.yml"));
  assertExists(path.join(tempRoot, ".github", "workflows", "visual-hive-hive-handoff.yml"));
  assertExists(path.join(tempRoot, ".visual-hive", "generated"));
  console.log("CLI smoke test passed");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

function run(command, args, cwd) {
  return runWithStatus(command, args, cwd, 0);
}

function runWithStatus(command, args, cwd, expectedStatus) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "pipe",
    encoding: "utf8",
    timeout: 30_000,
    windowsHide: true
  });
  if (result.status !== expectedStatus) {
    throw new Error(`${command} ${args.join(" ")} exited ${result.status}, expected ${expectedStatus}\n${result.stdout}\n${result.stderr}`);
  }
  return result;
}

function assertExists(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`Expected ${filePath} to exist`);
  }
}

function assertIncludes(value, expected) {
  if (!value.includes(expected)) {
    throw new Error(`Expected output to include ${expected}\n\n${value}`);
  }
}
