#!/usr/bin/env node
import { spawnSync } from "node:child_process";

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

const result = spawnSync(command, args, {
  env,
  shell: process.platform === "win32",
  stdio: "inherit"
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
