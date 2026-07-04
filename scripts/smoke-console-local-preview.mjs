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
const webRoot = path.join(consoleRoot, "web");
const configDir = path.join(webRoot, "e2e");
const configPath = path.join(configDir, "visual-hive.config.yaml");
const fixturesDir = path.join(consoleRoot, "docs", "visual-hive-fixtures");
const distIndexPath = path.join(webRoot, "dist", "index.html");
const localPreviewPlanPath = path.join(".visual-hive", "plan.local-preview.json");
const shouldBuild = process.env.VISUAL_HIVE_CONSOLE_BUILD === "true";

const DEFAULT_TIMEOUT_MS = 180_000;
const RUN_TIMEOUT_MS = Number.parseInt(process.env.VISUAL_HIVE_CONSOLE_RUN_TIMEOUT_MS ?? "360000", 10);
const BUILD_TIMEOUT_MS = Number.parseInt(process.env.VISUAL_HIVE_CONSOLE_BUILD_TIMEOUT_MS ?? "360000", 10);

if (!(await exists(consoleRoot))) {
  if (explicitConsoleRoot) {
    throw new Error(`VISUAL_HIVE_CONSOLE_REPO does not exist: ${consoleRoot}`);
  }
  console.log(`Console local-preview smoke skipped; no checkout found at ${consoleRoot}`);
  process.exit(0);
}

await requireFile(configPath, "console Visual Hive config");
await requireFile(path.join(fixturesDir, "ui-changed-files.txt"), "UI changed-files fixture");
if (!shouldBuild) {
  await requireFile(
    distIndexPath,
    "existing Console web build; run `npm run build --prefix <console>/web` or set VISUAL_HIVE_CONSOLE_BUILD=true"
  );
}

const commands = [
  shouldBuild
    ? command("console-web-build", npmCommand(), ["run", "build", "--prefix", webRoot], repoRoot, BUILD_TIMEOUT_MS, true)
    : null,
  step("plan-local-preview", [
    "plan",
    "--config",
    "visual-hive.config.yaml",
    "--mode",
    "pr",
    "--changed-files",
    path.join(fixturesDir, "ui-changed-files.txt"),
    "--include-target",
    "localPreview",
    "--exclude-target",
    "hostedDemo",
    "--output",
    localPreviewPlanPath
  ]),
  step(
    "run-local-preview-seed",
    [
      "run",
      "--config",
      "visual-hive.config.yaml",
      "--plan",
      localPreviewPlanPath,
      "--skip-install",
      "--skip-build"
    ],
    configDir,
    RUN_TIMEOUT_MS,
    { VISUAL_HIVE_CI: "false", CI: "false" }
  ),
  step(
    "run-local-preview-ci",
    [
      "run",
      "--config",
      "visual-hive.config.yaml",
      "--plan",
      localPreviewPlanPath,
      "--skip-install",
      "--skip-build",
      "--ci"
    ],
    configDir,
    RUN_TIMEOUT_MS,
    { VISUAL_HIVE_CI: "true", CI: "true" }
  ),
  step("triage", ["triage", "--config", "visual-hive.config.yaml"]),
  step("report", ["report", "--config", "visual-hive.config.yaml"]),
  step("evidence", ["evidence", "--config", "visual-hive.config.yaml"]),
  step("agent-packet", ["agent-packet", "--config", "visual-hive.config.yaml", "--profile", "repair_agent"]),
  step("snapshot", ["snapshot", "--config", "visual-hive.config.yaml"]),
  step("artifacts", ["artifacts", "--config", "visual-hive.config.yaml"]),
  {
    label: "evidence-resource-check",
    executable: process.execPath,
    args: [checkerPath, "--root", configDir, "--profile", "general"],
    cwd: repoRoot,
    timeoutMs: DEFAULT_TIMEOUT_MS
  }
].filter(Boolean);

console.log(`Console local-preview smoke using ${consoleRoot}`);
console.log(`Build step: ${shouldBuild ? "enabled by VISUAL_HIVE_CONSOLE_BUILD=true" : "skipped; reusing existing web/dist"}`);

for (const [index, commandEntry] of commands.entries()) {
  console.log(`\n[smoke:console:run] ${index + 1}/${commands.length} ${commandEntry.label}`);
  await run(commandEntry);
}

await assertLocalPreviewReport(path.join(configDir, ".visual-hive", "report.json"));

console.log(`Console local-preview smoke passed for ${consoleRoot}`);

function step(label, cliArgs, cwd = configDir, timeoutMs = DEFAULT_TIMEOUT_MS, extraEnv = {}) {
  return {
    label,
    executable: process.execPath,
    args: [cliPath, ...cliArgs],
    cwd,
    timeoutMs,
    extraEnv
  };
}

function command(label, executable, args, cwd, timeoutMs, shell = false, extraEnv = {}) {
  return { label, executable, args, cwd, timeoutMs, shell, extraEnv };
}

function run(commandEntry) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(commandEntry.executable, commandEntry.args, {
      cwd: commandEntry.cwd,
      env: { ...process.env, ...(commandEntry.extraEnv ?? {}) },
      shell: commandEntry.shell ?? false,
      stdio: "inherit",
      windowsHide: true,
      detached: process.platform !== "win32"
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      killProcessTree(child);
      reject(new Error(`${commandEntry.label} timed out after ${commandEntry.timeoutMs}ms`));
    }, commandEntry.timeoutMs);
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${commandEntry.label} failed with exit code ${code ?? `signal ${signal}`}`));
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
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  setTimeout(() => {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      // Process may already be gone.
    }
  }, 2_000).unref();
}

async function assertLocalPreviewReport(filePath) {
  const report = await readJson(filePath);
  if (report.status !== "passed") {
    throw new Error(`Expected console local-preview report status passed, got ${report.status}`);
  }
  const selectedTargetIds = new Set((report.selectedTargets ?? []).map((target) => target.id));
  if (!selectedTargetIds.has("localPreview")) {
    throw new Error("Expected localPreview to be selected in console local-preview report.");
  }
  if (selectedTargetIds.has("hostedDemo")) {
    throw new Error("hostedDemo should not be selected in local-preview-only smoke.");
  }
  const selectedContracts = new Set(report.selectedContracts ?? []);
  for (const contractId of [
    "local-preview-dashboard-visual",
    "local-preview-clusters-visual",
    "local-preview-settings-visual"
  ]) {
    if (!selectedContracts.has(contractId)) {
      throw new Error(`Expected ${contractId} in local-preview selected contracts.`);
    }
  }
  if (!report.generatedSpecPath) {
    throw new Error("Expected generatedSpecPath in console local-preview report.");
  }
  const lifecycle = report.targetLifecycle ?? [];
  for (const status of ["started", "passed", "stopped"]) {
    if (!lifecycle.some((event) => event.targetId === "localPreview" && event.status === status)) {
      throw new Error(`Expected localPreview lifecycle status ${status}.`);
    }
  }
  const screenshotAssertions = (report.results ?? []).flatMap((result) => result.screenshotAssertions ?? []);
  if (screenshotAssertions.length < 4) {
    throw new Error(`Expected at least 4 screenshot assertions, got ${screenshotAssertions.length}.`);
  }
  if (screenshotAssertions.some((screenshot) => !screenshot.baselinePath || !screenshot.actualPath)) {
    throw new Error("Every console local-preview screenshot should include baselinePath and actualPath.");
  }
  if (screenshotAssertions.some((screenshot) => screenshot.status !== "passed")) {
    throw new Error("Expected all console local-preview screenshots to pass in CI verification.");
  }
  if ((report.summary?.missingBaselines ?? 0) !== 0) {
    throw new Error(`Expected no missing baselines, got ${report.summary.missingBaselines}.`);
  }
  if ((report.summary?.screenshotsPassed ?? 0) < 4) {
    throw new Error(`Expected at least 4 passed screenshots, got ${report.summary?.screenshotsPassed ?? 0}.`);
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

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}
