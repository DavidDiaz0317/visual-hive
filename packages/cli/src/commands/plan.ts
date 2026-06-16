import { spawn } from "node:child_process";
import path from "node:path";
import { createPlan, loadConfig, mutationOperatorId, PLAN_MODES, writeJson, type Plan, type PlanMode } from "@visual-hive/core";
import { readFile } from "node:fs/promises";

export interface PlanCommandOptions {
  config?: string;
  cwd?: string;
  mode?: PlanMode;
  changedFiles?: string;
  base?: string;
  allowUnsafeTargets?: boolean;
}

export async function runPlanCommand(options: PlanCommandOptions = {}): Promise<Plan> {
  const cwd = options.cwd ?? process.cwd();
  const loaded = await loadConfig(options.config, cwd);
  const changedFiles = await resolveChangedFiles(options, cwd, loaded.config.project.defaultBranch);
  const plan = createPlan(loaded.config, {
    mode: parsePlanMode(options.mode),
    changedFiles,
    allowUnsafeTargets: options.allowUnsafeTargets
  });
  if (plan.items.length === 0 && !isIntentionalIgnoredFilesPlan(plan)) {
    const excluded = plan.excluded.length
      ? ` Excluded contracts: ${plan.excluded.map((item) => `${item.contractId} (${item.reasons.join("; ")})`).join(", ")}.`
      : "";
    throw new Error(
      `No contracts selected for mode "${plan.mode}". Check runOn settings, changed-file rules, target prSafe settings, or pass --allow-unsafe-targets for trusted runs.${excluded}`
    );
  }
  await writeJson(path.join(loaded.rootDir, ".visual-hive", "plan.json"), plan);
  return plan;
}

export function parsePlanMode(mode: string | undefined): PlanMode {
  const value = mode ?? "pr";
  if ((PLAN_MODES as readonly string[]).includes(value)) {
    return value as PlanMode;
  }
  throw new Error(`Invalid plan mode "${value}". Expected one of: ${PLAN_MODES.join(", ")}`);
}

export function formatPlanSummary(plan: Plan): string {
  const lines = [
    `Visual Hive plan for ${plan.project}`,
    `Mode: ${plan.mode}`,
    `Contracts selected: ${plan.items.length}`,
    `Targets selected: ${plan.targets.map((target) => target.id).join(", ") || "none"}`,
    `Mutation: ${plan.mutation.enabled ? `enabled (${plan.mutation.operators.map((operator) => mutationOperatorId(operator)).join(", ")})` : "disabled"}`
  ];
  if (plan.mode === "pr" && plan.ignoredChangedFiles.length > 0) {
    lines.push(`Ignored changed files: ${plan.ignoredChangedFiles.length}`);
    for (const ignored of plan.ignoredChangedFiles) {
      lines.push(`- ${ignored.file} ignored by ${ignored.pattern}: ${ignored.reason}`);
    }
  }
  for (const item of plan.items) {
    lines.push(`- ${item.contractId} on ${item.targetId} [${item.cost}] because ${item.reasons.join("; ")}`);
  }
  if (plan.excluded.length > 0) {
    lines.push("Excluded:");
    for (const item of plan.excluded) {
      lines.push(`- ${item.contractId} on ${item.targetId}: ${item.reasons.join("; ")}`);
    }
  }
  return lines.join("\n");
}

export function isIntentionalIgnoredFilesPlan(plan: Plan): boolean {
  return plan.mode === "pr" && plan.changedFiles.length > 0 && plan.effectiveChangedFiles.length === 0 && plan.ignoredChangedFiles.length > 0;
}

async function resolveChangedFiles(options: PlanCommandOptions, cwd: string, defaultBranch: string): Promise<string[]> {
  if (options.changedFiles) {
    const raw = await readFile(path.resolve(cwd, options.changedFiles), "utf8");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }
  if (options.base) {
    return gitChangedFiles(cwd, options.base);
  }
  return gitChangedFiles(cwd, defaultBranch).catch(() => []);
}

function gitChangedFiles(cwd: string, base: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["diff", "--name-only", `${base}...HEAD`], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `git diff failed for base ${base}`));
        return;
      }
      resolve(
        stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
      );
    });
  });
}
