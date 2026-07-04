import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  auditContracts,
  createPlan,
  loadConfig,
  readJson,
  writeJson,
  type ContractAuditReport,
  type MutationReport,
  type Plan,
  type PlanMode,
  type Report
} from "@visual-hive/core";
import { gitChangedFiles } from "./gitChangedFiles.js";
import { parsePlanMode } from "./plan.js";

export interface ContractsCommandOptions {
  config?: string;
  cwd?: string;
  plan?: string;
  report?: string;
  mutationReport?: string;
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

export async function runContractsCommand(options: ContractsCommandOptions = {}): Promise<{ audit: ContractAuditReport; auditPath: string }> {
  const cwd = options.cwd ?? process.cwd();
  const loaded = await loadConfig(options.config, cwd);
  const changedFiles = await resolveChangedFiles(options, cwd);
  const [plan, report, mutationReport] = await Promise.all([
    resolvePlan(options, loaded.rootDir, loaded.config, changedFiles),
    readOptionalJson<Report>(path.resolve(loaded.rootDir, options.report ?? ".visual-hive/report.json")),
    readOptionalJson<MutationReport>(path.resolve(loaded.rootDir, options.mutationReport ?? ".visual-hive/mutation-report.json"))
  ]);
  const audit = auditContracts(loaded.config, { plan, report, mutationReport });
  const auditPath = path.join(loaded.rootDir, ".visual-hive", "contracts.json");
  await writeJson(auditPath, audit);
  return { audit, auditPath };
}

export function formatContractsAudit(audit: ContractAuditReport, auditPath: string, format: "markdown" | "json" = "markdown"): string {
  if (format === "json") {
    return JSON.stringify(audit, null, 2);
  }
  const lines = [
    `Wrote ${auditPath}`,
    `# Contract Audit: ${audit.project}`,
    "",
    `- Contracts: ${audit.summary.contractCount}`,
    `- Selected: ${audit.summary.selectedContracts}`,
    `- Not run: ${audit.summary.notRunContracts}`,
    `- Failed: ${audit.summary.failedContracts}`,
    `- Assertion-free: ${audit.summary.assertionFreeContracts}`,
    `- Screenshotless: ${audit.summary.screenshotlessContracts}`,
    `- Without waitFor: ${audit.summary.contractsWithoutWaitFor}`,
    `- Without changed-file rules: ${audit.summary.contractsWithoutChangedFileRules}`,
    `- Mutation mapped: ${audit.summary.mutationMappedContracts}`,
    `- High-severity gaps: ${audit.summary.contractsWithHighSeverityGaps}`,
    "",
    "## Contracts"
  ];
  for (const contract of audit.contracts) {
    const gapSummary = contract.gaps.length ? contract.gaps.map((gap) => `${gap.severity}:${gap.kind}`).join(", ") : "none";
    lines.push(
      `- ${contract.id} (${contract.severity}) target=${contract.targetId} selected=${contract.selected ? "yes" : "no"} latest=${contract.latestStatus} gaps=${gapSummary}`
    );
    for (const recommendation of contract.recommendations.slice(0, 3)) {
      lines.push(`  - ${recommendation}`);
    }
  }
  return lines.join("\n");
}

async function resolvePlan(
  options: ContractsCommandOptions,
  rootDir: string,
  config: Parameters<typeof createPlan>[0],
  changedFiles: string[]
): Promise<Plan | undefined> {
  if (options.plan) {
    return readJson<Plan>(path.resolve(rootDir, options.plan));
  }
  const defaultPlanPath = path.join(rootDir, ".visual-hive", "plan.json");
  try {
    return await readJson<Plan>(defaultPlanPath);
  } catch {
    // Contract audits can run before planning. Create an in-memory plan so
    // selected/not-selected status is still useful.
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

async function resolveChangedFiles(options: ContractsCommandOptions, cwd: string): Promise<string[]> {
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
