import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { auditTargets, createPlan, loadConfig, readJson, writeJson, type Plan, type PlanMode, type Report, type TargetAuditReport } from "@visual-hive/core";
import { parsePlanMode } from "./plan.js";

export interface TargetsCommandOptions {
  config?: string;
  cwd?: string;
  plan?: string;
  report?: string;
  mode?: PlanMode;
  changedFiles?: string;
  base?: string;
  allowUnsafeTargets?: boolean;
  includeContracts?: string[];
  excludeContracts?: string[];
  includeTargets?: string[];
  excludeTargets?: string[];
  format?: "markdown" | "json";
}

export async function runTargetsCommand(options: TargetsCommandOptions = {}): Promise<{ audit: TargetAuditReport; auditPath: string }> {
  const cwd = options.cwd ?? process.cwd();
  const loaded = await loadConfig(options.config, cwd);
  const changedFiles = await resolveChangedFiles(options, cwd);
  const [plan, report] = await Promise.all([
    resolvePlan(options, loaded.rootDir, loaded.config, changedFiles),
    readOptionalJson<Report>(path.resolve(loaded.rootDir, options.report ?? ".visual-hive/report.json"))
  ]);
  const audit = auditTargets(loaded.config, { plan, report });
  const auditPath = path.join(loaded.rootDir, ".visual-hive", "targets.json");
  await writeJson(auditPath, audit);
  return { audit, auditPath };
}

export function formatTargetsAudit(audit: TargetAuditReport, auditPath: string, format: "markdown" | "json" = "markdown"): string {
  if (format === "json") {
    return JSON.stringify(audit, null, 2);
  }
  const lines = [
    `Wrote ${auditPath}`,
    `# Target Audit: ${audit.project}`,
    "",
    `- Targets: ${audit.summary.targetCount}`,
    `- Selected: ${audit.summary.selectedTargets}`,
    `- PR-safe: ${audit.summary.prSafeTargets}`,
    `- Protected: ${audit.summary.protectedTargets}`,
    `- Command targets: ${audit.summary.commandTargets}`,
    `- Command groups: ${audit.summary.commandGroupTargets}`,
    `- Scheduled: ${audit.summary.scheduledTargets}`,
    `- Missing secret names: ${audit.summary.missingSecretNames}`,
    `- Failed lifecycle targets: ${audit.summary.targetsWithFailedLifecycle}`,
    "",
    "## Targets"
  ];
  for (const target of audit.targets) {
    const gaps = target.gaps.length ? target.gaps.map((gap) => `${gap.severity}:${gap.kind}`).join(", ") : "none";
    const labels = target.labels.length ? target.labels.join(", ") : "none";
    lines.push(`- ${target.id} (${target.kind}) url=${target.url || "n/a"} selected=${target.selected ? "yes" : "no"} latest=${target.latestStatus} labels=${labels} gaps=${gaps}`);
    for (const recommendation of target.recommendations.slice(0, 3)) {
      lines.push(`  - ${recommendation}`);
    }
  }
  return lines.join("\n");
}

async function resolvePlan(
  options: TargetsCommandOptions,
  rootDir: string,
  config: Parameters<typeof createPlan>[0],
  changedFiles: string[]
): Promise<Plan | undefined> {
  if (options.plan) {
    return readJson<Plan>(path.resolve(rootDir, options.plan));
  }
  try {
    return await readJson<Plan>(path.join(rootDir, ".visual-hive", "plan.json"));
  } catch {
    // Target audits should be useful before planning has written artifacts.
  }
  return createPlan(config, {
    mode: parsePlanMode(options.mode),
    changedFiles,
    allowUnsafeTargets: options.allowUnsafeTargets,
    includeContracts: options.includeContracts,
    excludeContracts: options.excludeContracts,
    includeTargets: options.includeTargets,
    excludeTargets: options.excludeTargets
  });
}

async function readOptionalJson<T>(filePath: string): Promise<T | undefined> {
  try {
    return await readJson<T>(filePath);
  } catch {
    return undefined;
  }
}

async function resolveChangedFiles(options: TargetsCommandOptions, cwd: string): Promise<string[]> {
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
  return [];
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
