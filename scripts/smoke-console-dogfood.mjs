#!/usr/bin/env node
import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "packages", "cli", "dist", "index.js");
const checkerPath = path.join(repoRoot, "scripts", "check-demo-evidence-resources.mjs");
const defaultConsoleRoot = path.resolve(repoRoot, "..", "console");
const consoleRoot = path.resolve(process.env.VISUAL_HIVE_CONSOLE_REPO ?? defaultConsoleRoot);
const explicitConsoleRoot = Boolean(process.env.VISUAL_HIVE_CONSOLE_REPO);
const configDir = path.join(consoleRoot, "web", "e2e");
const configPath = path.join(configDir, "visual-hive.config.yaml");
const fixturesDir = path.join(consoleRoot, "docs", "visual-hive-fixtures");

const DEFAULT_TIMEOUT_MS = 120_000;

if (!(await exists(consoleRoot))) {
  if (explicitConsoleRoot) {
    throw new Error(`VISUAL_HIVE_CONSOLE_REPO does not exist: ${consoleRoot}`);
  }
  console.log(`Console dogfood smoke skipped; no checkout found at ${consoleRoot}`);
  process.exit(0);
}

await requireFile(configPath, "console Visual Hive config");
await requireFile(path.join(fixturesDir, "auth-changed-files.txt"), "auth changed-files fixture");
await requireFile(path.join(fixturesDir, "ui-changed-files.txt"), "UI changed-files fixture");
await requireFile(path.join(fixturesDir, "docs-only-changed-files.txt"), "docs-only changed-files fixture");

const commands = [
  step("recommend-setup", ["recommend", "--repo", ".", "--profile", "complex-app"], consoleRoot),
  step("doctor", ["doctor", "--config", configPath], consoleRoot),
  step("plan-auth", [
    "plan",
    "--config",
    "visual-hive.config.yaml",
    "--mode",
    "pr",
    "--changed-files",
    path.join(fixturesDir, "auth-changed-files.txt"),
    "--output",
    path.join(".visual-hive", "plan.auth.json")
  ]),
  step("plan-ui", [
    "plan",
    "--config",
    "visual-hive.config.yaml",
    "--mode",
    "pr",
    "--changed-files",
    path.join(fixturesDir, "ui-changed-files.txt"),
    "--output",
    path.join(".visual-hive", "plan.ui.json")
  ]),
  step("plan-docs", [
    "plan",
    "--config",
    "visual-hive.config.yaml",
    "--mode",
    "pr",
    "--changed-files",
    path.join(fixturesDir, "docs-only-changed-files.txt"),
    "--output",
    path.join(".visual-hive", "plan.docs.json")
  ]),
  step("plans", ["plans", "--config", "visual-hive.config.yaml"]),
  step("artifacts-pre", ["artifacts", "--config", "visual-hive.config.yaml"]),
  step("evidence", ["evidence", "--config", "visual-hive.config.yaml"]),
  step("agent-packet", ["agent-packet", "--config", "visual-hive.config.yaml", "--profile", "repair_agent"]),
  step("handoff-agent-packet", [
    "agent-packet",
    "--config",
    "visual-hive.config.yaml",
    "--profile",
    "handoff_agent",
    "--output",
    path.join(".visual-hive", "handoff-agent-packet.json")
  ]),
  step("provider-agent-packet", [
    "agent-packet",
    "--config",
    "visual-hive.config.yaml",
    "--profile",
    "provider_specialist",
    "--output",
    path.join(".visual-hive", "provider-agent-packet.json")
  ]),
  step("mcp-manifest", ["mcp", "--config", "visual-hive.config.yaml", "--describe", "--output", path.join(".visual-hive", "mcp-manifest.json")]),
  step("context-ledger", ["context", "--config", "visual-hive.config.yaml", "--max-tool-calls", "40"]),
  step("snapshot", ["snapshot", "--config", "visual-hive.config.yaml"]),
  step("artifacts-final", ["artifacts", "--config", "visual-hive.config.yaml"]),
  {
    label: "evidence-resource-check",
    executable: process.execPath,
    args: [checkerPath, "--root", configDir, "--profile", "general"],
    cwd: repoRoot,
    timeoutMs: DEFAULT_TIMEOUT_MS
  }
];

console.log(`Console dogfood smoke using ${consoleRoot}`);
for (const [index, command] of commands.entries()) {
  console.log(`\n[smoke:console] ${index + 1}/${commands.length} ${command.label}`);
  await run(command);
}

await assertSetupArtifacts(path.join(consoleRoot, ".visual-hive"));
await assertExternalCallsZero(path.join(configDir, ".visual-hive", "evidence-packet.json"));
await assertAgentPacketPolicy(path.join(configDir, ".visual-hive", "agent-packet.json"));
await assertAgentPacketPolicy(path.join(configDir, ".visual-hive", "handoff-agent-packet.json"));
await assertAgentPacketPolicy(path.join(configDir, ".visual-hive", "provider-agent-packet.json"));

console.log(`Console dogfood smoke passed for ${consoleRoot}`);

function step(label, cliArgs, cwd = configDir, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return {
    label,
    executable: process.execPath,
    args: [cliPath, ...cliArgs],
    cwd,
    timeoutMs
  };
}

function run(command) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(command.executable, command.args, {
      cwd: command.cwd,
      env: { ...process.env, VISUAL_HIVE_CI: "false", CI: "false" },
      stdio: "inherit",
      windowsHide: true
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      killProcessTree(child);
      reject(new Error(`${command.label} timed out after ${command.timeoutMs}ms`));
    }, command.timeoutMs);
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command.label} failed with exit code ${code}`));
      }
    });
  });
}

function killProcessTree(child) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true
    });
    killer.on("error", () => child.kill("SIGKILL"));
    return;
  }
  child.kill("SIGTERM");
  setTimeout(() => {
    try {
      child.kill("SIGKILL");
    } catch {
      // Process may already be gone.
    }
  }, 2_000).unref();
}

async function assertExternalCallsZero(filePath) {
  const evidence = await readJson(filePath);
  for (const mode of evidence.hiveReadiness?.modeReadiness ?? []) {
    if (mode.externalCallsMade !== 0) {
      throw new Error(`Expected Hive mode ${mode.mode} externalCallsMade=0, got ${mode.externalCallsMade}`);
    }
  }
  for (const provider of evidence.providers ?? []) {
    if (provider.providerId === "playwright") continue;
    if (!["skipped", "blocked", "missing_credentials"].includes(provider.status)) {
      throw new Error(`Expected optional provider ${provider.providerId} to avoid external upload, got ${provider.status}`);
    }
  }
}

async function assertAgentPacketPolicy(filePath) {
  const packet = await readJson(filePath);
  if (packet.budgets?.allowExternalNetwork !== false) {
    throw new Error(`${path.basename(filePath)} unexpectedly allows external network access.`);
  }
  if (packet.budgets?.maxExternalCostUsd !== 0) {
    throw new Error(`${path.basename(filePath)} unexpectedly allows external cost.`);
  }
}

async function assertSetupArtifacts(hiveRoot) {
  const recommendations = await readJson(path.join(hiveRoot, "recommendations.json"));
  const setupPrPlan = await readJson(path.join(hiveRoot, "setup-pr-plan.json"));
  assertOutputResource(recommendations.outputResource, {
    id: "setup-recommendations",
    uri: "visual-hive://setup-recommendations",
    path: ".visual-hive/recommendations.json",
    tool: "visual_hive_read_setup_recommendations"
  });
  assertOutputResource(setupPrPlan.outputResource, {
    id: "setup-pr-plan",
    uri: "visual-hive://setup-pr-plan",
    path: ".visual-hive/setup-pr-plan.json",
    tool: "visual_hive_read_setup_pr_plan"
  });
  if (setupPrPlan.summary?.externalCallsMade !== 0) {
    throw new Error(`setup-pr-plan.json made external calls: ${setupPrPlan.summary?.externalCallsMade}`);
  }
  if (setupPrPlan.security?.generatedWorkflowsUsePullRequestTarget) {
    throw new Error("setup-pr-plan.json generated workflow preview uses pull_request_target.");
  }
  if (setupPrPlan.security?.generatedPrWorkflowUsesSecrets) {
    throw new Error("setup-pr-plan.json generated PR workflow preview references secrets.");
  }
}

function assertOutputResource(actual, expected) {
  if (!actual) {
    throw new Error(`Missing outputResource for ${expected.id}.`);
  }
  if (actual.evidenceResourceId !== expected.id) {
    throw new Error(`Expected ${expected.id} output resource id, got ${actual.evidenceResourceId}`);
  }
  if (actual.evidenceResourceUri !== expected.uri) {
    throw new Error(`Expected ${expected.id} URI ${expected.uri}, got ${actual.evidenceResourceUri}`);
  }
  if (normalizePath(actual.artifactPath) !== normalizePath(expected.path)) {
    throw new Error(`Expected ${expected.id} artifact path ${expected.path}, got ${actual.artifactPath}`);
  }
  if (actual.evidenceReadToolName !== expected.tool) {
    throw new Error(`Expected ${expected.id} read tool ${expected.tool}, got ${actual.evidenceReadToolName}`);
  }
}

async function requireFile(filePath, label) {
  try {
    await access(filePath);
  } catch {
    throw new Error(`Missing ${label}: ${filePath}`);
  }
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function normalizePath(input) {
  return String(input ?? "").replaceAll("\\", "/").toLowerCase();
}
