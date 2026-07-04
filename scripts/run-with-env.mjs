#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 180_000;

const separatorIndex = process.argv.indexOf("--");
if (separatorIndex === -1 || separatorIndex === process.argv.length - 1) {
  console.error("Usage: node scripts/run-with-env.mjs KEY=value [KEY=value...] -- <command> [args...]");
  process.exit(2);
}

const assignments = process.argv.slice(2, separatorIndex);
const command = process.argv[separatorIndex + 1];
const args = process.argv.slice(separatorIndex + 2);
const env = { ...process.env };

for (const assignment of assignments) {
  const equalsIndex = assignment.indexOf("=");
  if (equalsIndex <= 0) {
    console.error(`Invalid environment assignment: ${assignment}`);
    process.exit(2);
  }
  env[assignment.slice(0, equalsIndex)] = assignment.slice(equalsIndex + 1);
}

const timeoutMs = Number.parseInt(env.VISUAL_HIVE_RUN_WITH_ENV_TIMEOUT_MS ?? String(DEFAULT_TIMEOUT_MS), 10);
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  console.error("VISUAL_HIVE_RUN_WITH_ENV_TIMEOUT_MS must be a positive integer.");
  process.exit(2);
}

const result = spawnSync(commandForPlatform(command), args, {
  env,
  shell: false,
  stdio: "inherit",
  timeout: timeoutMs,
  killSignal: "SIGTERM",
  windowsHide: true
});

if (result.error) {
  if (result.error.code === "ETIMEDOUT") {
    console.error(`${command} ${args.join(" ")} timed out after ${timeoutMs}ms`);
    process.exit(124);
  }
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);

function commandForPlatform(input) {
  return process.platform === "win32" && (input === "npm" || input === "npx") ? `${input}.cmd` : input;
}
