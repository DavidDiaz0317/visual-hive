#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = "examples/demo-react-app/visual-hive.defect.config.yaml";
const TIMEOUT_MS = 180_000;

const steps = [
  {
    label: "defect-plan",
    args: ["packages/cli/dist/index.js", "plan", "--config", configPath, "--mode", "pr", "--changed-files", "examples/demo-react-app/changed-files.txt"],
    expectFailure: false
  },
  {
    label: "defect-run-expected-failure",
    args: ["packages/cli/dist/index.js", "run", "--config", configPath, "--skip-install", "--skip-build"],
    expectFailure: true
  },
  {
    label: "defect-triage",
    args: ["packages/cli/dist/index.js", "triage", "--config", configPath],
    expectFailure: false
  },
  {
    label: "defect-evidence",
    args: ["packages/cli/dist/index.js", "evidence", "--config", configPath],
    expectFailure: false
  },
  {
    label: "defect-handoff",
    args: ["packages/cli/dist/index.js", "handoff", "--config", configPath, "--dry-run"],
    expectFailure: false
  },
  {
    label: "defect-test-creation",
    args: ["packages/cli/dist/index.js", "test-creation-plan", "--config", configPath],
    expectFailure: false
  },
  {
    label: "defect-artifacts",
    args: ["packages/cli/dist/index.js", "artifacts", "--config", configPath],
    expectFailure: false
  }
];

for (const step of steps) {
  const result = await runNodeStep(step);
  if (step.expectFailure) {
    if (result.status === 0) {
      throw new Error(`${step.label} unexpectedly passed; seeded demo defect was not detected.`);
    }
    console.log(`[${step.label}] failed as expected with exit code ${result.status}`);
    continue;
  }
  if (result.status !== 0) {
    throw new Error(`${step.label} failed with exit code ${result.status}`);
  }
}

const report = await readJson(path.join(repoRoot, "examples", "demo-react-app", ".visual-hive", "report.json"));
const triage = await readJson(path.join(repoRoot, "examples", "demo-react-app", ".visual-hive", "triage.json"));
const evidence = await readJson(path.join(repoRoot, "examples", "demo-react-app", ".visual-hive", "evidence-packet.json"));
const issue = await readFile(path.join(repoRoot, "examples", "demo-react-app", ".visual-hive", "hive-issue.md"), "utf8");

const serializedReport = JSON.stringify(report);
if (report.status !== "failed") {
  throw new Error(`Expected seeded defect report status failed, got ${report.status}`);
}
if (!serializedReport.includes("seeded-force-login-public-demo")) {
  throw new Error("Seeded defect report did not include the defect contract id.");
}
if (!serializedReport.includes("dashboard-page") || !serializedReport.includes("login-page")) {
  throw new Error("Seeded defect report did not preserve dashboard/login selector evidence.");
}
if (!Array.isArray(triage.findings) || triage.findings.length === 0) {
  throw new Error("Seeded defect triage did not include findings.");
}
if (evidence.verdictSummary?.visualHiveVerdict !== "failed") {
  throw new Error(`Expected seeded defect Evidence Packet verdict failed, got ${evidence.verdictSummary?.visualHiveVerdict}`);
}
if (!issue.includes("Visual Hive") || !issue.includes("seeded-force-login-public-demo")) {
  throw new Error("Seeded defect Hive issue body did not include Visual Hive failure context.");
}

console.log("Visual Hive seeded defect proof passed: deterministic run failed as expected and report/triage/evidence/handoff artifacts were generated.");

function runNodeStep(step) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, step.args, {
      cwd: repoRoot,
      stdio: "inherit",
      windowsHide: true,
      env: { ...process.env, VISUAL_HIVE_CI: "false", CI: "false" }
    });
    const timer = setTimeout(async () => {
      console.error(`[${step.label}] timed out after ${Math.round(TIMEOUT_MS / 1000)}s; terminating process tree`);
      await killProcessTree(child);
      resolve({ status: 124 });
    }, TIMEOUT_MS);
    child.on("error", (error) => {
      clearTimeout(timer);
      console.error(`[${step.label}] failed to start: ${error.message}`);
      resolve({ status: 1 });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (signal) {
        console.error(`[${step.label}] exited after signal ${signal}`);
        resolve({ status: 1 });
        return;
      }
      resolve({ status: code ?? 1 });
    });
  });
}

async function killProcessTree(child) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      killer.on("close", resolve);
      killer.on("error", resolve);
    });
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}
