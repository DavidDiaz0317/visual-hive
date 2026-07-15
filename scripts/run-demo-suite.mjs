#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const DEFAULT_TIMEOUT_MS = 120_000;
const TIMEOUTS_BY_SCRIPT = {
  "demo:build": 180_000,
  "demo:run": 180_000,
  "demo:run:seed": 180_000,
  "demo:run:ci": 180_000,
  "demo:mutate": 240_000,
  "demo:e2e:defect": 300_000,
  "demo:e2e:mutation": 120_000,
  "demo:e2e:handoff-dry-run": 120_000,
  "demo:pipeline": 420_000,
  "demo:ui": 120_000,
  "demo:kubestellar": 180_000
};

const coreSteps = [
  script("demo:build"),
  script("demo:doctor"),
  script("demo:analyze"),
  script("demo:graph:search"),
  script("demo:graph:impact"),
  script("demo:recommend"),
  script("demo:plan"),
  script("demo:plan:canary"),
  script("demo:plan:full"),
  script("demo:plans"),
  script("demo:run"),
  script("demo:baselines"),
  script("demo:mutate")
];

const governanceSteps = [
  script("demo:coverage"),
  script("demo:flows"),
  script("demo:improve"),
  script("demo:targets"),
  script("demo:contracts"),
  script("demo:schedules"),
  script("demo:workflows"),
  script("demo:providers"),
  script("demo:provider-plan"),
  script("demo:provider-handoff"),
  script("demo:provider-upload"),
  script("demo:risk"),
  script("demo:security"),
  script("demo:costs")
];

const agentSteps = [
  script("demo:triage"),
  script("demo:llm"),
  script("demo:readiness"),
  script("demo:setup-status"),
  script("demo:runbook"),
  script("demo:report"),
  script("demo:history"),
  script("demo:connections"),
  script("demo:evidence"),
  script("demo:layers"),
  script("demo:verdict"),
  script("demo:handoff"),
  script("demo:hive-export"),
  script("demo:hive-beads"),
  script("demo:hive-validate"),
  script("demo:hive-setup-pack"),
  script("demo:hive-integration-smoke"),
  script("demo:hive-guarded-preview"),
  script("demo:hive-repair-envelope"),
  script("demo:hive-repair-consumer"),
  script("demo:hive-repair-workflow"),
  script("demo:handoff-validate"),
  script("demo:hive-modes"),
  script("demo:test-creation"),
  script("demo:agent-packet"),
  script("demo:agent-packet:handoff"),
  script("demo:agent-packet:provider"),
  script("demo:tools"),
  script("demo:mcp"),
  script("demo:hive-bundle")
];

const portfolioSteps = [
  script("demo:kubestellar"),
  script("demo:pipeline"),
  script("demo:context"),
  script("demo:schemas"),
  script("demo:snapshot"),
  script("demo:artifacts"),
  script("demo:hive-bundle"),
  script("demo:evidence-resources"),
  script("demo:ui")
];

const acceptanceSteps = [
  script("demo:build"),
  script("demo:doctor"),
  script("demo:analyze"),
  script("demo:graph:search"),
  script("demo:graph:impact"),
  script("demo:recommend"),
  script("demo:plan"),
  script("demo:plan:canary"),
  script("demo:plan:full"),
  script("demo:plans"),
  script("demo:run:seed"),
  script("demo:pipeline"),
  script("demo:provider-plan"),
  script("demo:provider-handoff"),
  script("demo:provider-upload"),
  script("demo:llm"),
  script("demo:setup-status"),
  script("demo:runbook"),
  script("demo:report"),
  script("demo:connections"),
  script("demo:evidence"),
  script("demo:layers"),
  script("demo:verdict"),
  script("demo:handoff"),
  script("demo:hive-export"),
  script("demo:hive-beads"),
  script("demo:hive-validate"),
  script("demo:hive-setup-pack"),
  script("demo:hive-integration-smoke"),
  script("demo:hive-guarded-preview"),
  script("demo:hive-repair-envelope"),
  script("demo:hive-repair-consumer"),
  script("demo:hive-repair-workflow"),
  script("demo:handoff-validate"),
  script("demo:hive-modes"),
  script("demo:test-creation"),
  script("demo:agent-packet"),
  script("demo:agent-packet:handoff"),
  script("demo:agent-packet:provider"),
  script("demo:tools"),
  script("demo:mcp"),
  script("demo:kubestellar"),
  script("demo:context"),
  script("demo:schemas"),
  script("demo:snapshot"),
  script("demo:artifacts"),
  script("demo:hive-bundle"),
  script("demo:evidence-resources"),
  script("demo:ui")
];

// Hosted source-checkout CI cannot publish a trusted Hive bundle: that path
// requires the immutable identity exercised by smoke:release/smoke:consumer.
// Keep the local advisory bundle proof in demo:all without weakening the
// hosted release-identity gate.
const ciSteps = acceptanceSteps.filter((step) => step.label !== "demo:hive-bundle");

const e2eCleanSteps = [
  script("demo:build"),
  script("demo:plan"),
  script("demo:run:seed"),
  script("demo:run:ci"),
  script("demo:triage"),
  script("demo:evidence"),
  script("demo:artifacts")
];

const e2eRestoreSteps = [
  script("demo:plan"),
  script("demo:run:seed"),
  script("demo:run:ci"),
  script("demo:mutate"),
  script("demo:e2e:mutation"),
  script("demo:triage"),
  script("demo:evidence"),
  script("demo:handoff"),
  script("demo:handoff-validate"),
  script("demo:e2e:handoff-dry-run"),
  script("demo:test-creation"),
  script("demo:agent-packet"),
  script("demo:agent-packet:handoff"),
  script("demo:agent-packet:provider"),
  script("demo:tools"),
  script("demo:mcp"),
  script("demo:context"),
  script("demo:snapshot"),
  script("demo:artifacts"),
  command("demo:evidence-resources:general", process.execPath, ["scripts/check-demo-evidence-resources.mjs", "--profile", "general"])
];

const e2eSteps = [...e2eCleanSteps, script("demo:e2e:defect"), ...e2eRestoreSteps];

const suites = {
  core: coreSteps,
  governance: governanceSteps,
  agent: agentSteps,
  portfolio: portfolioSteps,
  all: acceptanceSteps,
  exhaustive: [...coreSteps, ...governanceSteps, ...agentSteps, ...portfolioSteps],
  ci: ciSteps,
  "e2e-clean": e2eCleanSteps,
  e2e: e2eSteps
};

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const list = args.includes("--list");
const selfTestTimeout = args.includes("--self-test-timeout");
if (selfTestTimeout) {
  suites["self-test-timeout"] = [
    command("self-test-timeout", process.execPath, ["-e", "setTimeout(() => {}, 60000)"], 250)
  ];
}
const suiteName = selfTestTimeout ? "self-test-timeout" : args.find((arg) => !arg.startsWith("--")) ?? "all";

if (list) {
  for (const [name, steps] of Object.entries(suites)) {
    console.log(`${name}: ${steps.length} steps`);
  }
  process.exit(0);
}

const steps = suites[suiteName];
if (!steps) {
  console.error(`Unknown demo suite "${suiteName}". Available suites: ${Object.keys(suites).join(", ")}`);
  process.exit(2);
}

if (dryRun) {
  console.log(`[demo:${suiteName}] dry run (${steps.length} steps)`);
  for (const [index, step] of steps.entries()) {
    console.log(`${index + 1}. ${step.label}: ${formatCommand(step)} (timeout ${Math.round(step.timeoutMs / 1000)}s)`);
  }
  process.exit(0);
}

console.log(`[demo:${suiteName}] starting ${steps.length} timeout-bounded steps`);

for (const [index, step] of steps.entries()) {
  console.log(`\n[demo:${suiteName}] ${index + 1}/${steps.length} ${step.label}`);
  console.log(`[demo:${suiteName}] command: ${formatCommand(step)}`);
  console.log(`[demo:${suiteName}] timeout: ${Math.round(step.timeoutMs / 1000)}s`);
  const result = await runStep(step);
  if (result.status !== 0) {
    console.error(`[demo:${suiteName}] failed at ${step.label} with exit code ${result.status}`);
    process.exit(result.status);
  }
}

console.log(`\n[demo:${suiteName}] completed successfully`);

function script(name) {
  if (process.platform === "win32") {
    return command(name, process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "npm", "run", name], TIMEOUTS_BY_SCRIPT[name] ?? DEFAULT_TIMEOUT_MS);
  }
  return command(name, "npm", ["run", name], TIMEOUTS_BY_SCRIPT[name] ?? DEFAULT_TIMEOUT_MS);
}

function command(label, executable, args, timeoutMs = DEFAULT_TIMEOUT_MS, options = {}) {
  return { label, executable, args, timeoutMs, shell: options.shell ?? false };
}

function formatCommand(step) {
  return [step.executable, ...step.args].join(" ");
}

function runStep(step) {
  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    const child = spawn(step.executable, step.args, {
      cwd: repoRoot,
      stdio: "inherit",
      windowsHide: true,
      shell: step.shell,
      detached: process.platform !== "win32"
    });

    const timer = setTimeout(async () => {
      timedOut = true;
      console.error(`[${step.label}] timed out after ${Math.round(step.timeoutMs / 1000)}s; terminating process tree`);
      await killProcessTree(child);
    }, step.timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        console.error(`[${step.label}] failed to start: ${error.message}`);
        resolve({ status: 1 });
      }
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        if (timedOut) {
          resolve({ status: 124 });
          return;
        }
        if (signal) {
          console.error(`[${step.label}] exited after signal ${signal}`);
          resolve({ status: 1 });
          return;
        }
        resolve({ status: code ?? 1 });
      }
    });
  });
}

async function killProcessTree(child) {
  if (!child.pid) {
    return;
  }
  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true
      });
      killer.on("error", resolve);
      killer.on("close", resolve);
    });
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      // Process already exited.
    }
  }
}
