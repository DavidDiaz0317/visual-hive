import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  auditFlows,
  createPlan,
  loadConfig,
  readJson,
  writeJson,
  type FlowAuditReport,
  type Plan,
  type PlanMode,
  type Report
} from "@visual-hive/core";
import { gitChangedFiles } from "./gitChangedFiles.js";
import { parsePlanMode } from "./plan.js";

export interface FlowsCommandOptions {
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

export async function runFlowsCommand(options: FlowsCommandOptions = {}): Promise<{ audit: FlowAuditReport; auditPath: string }> {
  const cwd = options.cwd ?? process.cwd();
  const loaded = await loadConfig(options.config, cwd);
  const changedFiles = await resolveChangedFiles(options, cwd);
  const [plan, report] = await Promise.all([
    resolvePlan(options, loaded.rootDir, loaded.config, changedFiles),
    readOptionalJson<Report>(path.resolve(loaded.rootDir, options.report ?? ".visual-hive/report.json"))
  ]);
  const audit = auditFlows(loaded.config, { plan, report, selectedContractIds: report?.selectedContracts });
  const auditPath = path.join(loaded.rootDir, ".visual-hive", "flows.json");
  await writeJson(auditPath, audit);
  return { audit, auditPath };
}

export function formatFlowsAudit(audit: FlowAuditReport, auditPath: string, format: "markdown" | "json" = "markdown"): string {
  if (format === "json") {
    return JSON.stringify(audit, null, 2);
  }
  const lines = [
    `Wrote ${auditPath}`,
    `# Flow Audit: ${audit.project}`,
    "",
    `- Contracts: ${audit.summary.contractCount}`,
    `- Flow contracts: ${audit.summary.flowContractCount}`,
    `- Selected flow contracts: ${audit.summary.selectedFlowContracts}`,
    `- Flow steps: ${audit.summary.flowStepCount}`,
    `- Navigation steps: ${audit.summary.navigationSteps}`,
    `- Interaction steps: ${audit.summary.interactionSteps}`,
    `- Assertion steps: ${audit.summary.assertionSteps}`,
    `- Failed flow steps: ${audit.summary.failedFlowSteps}`,
    `- Critical contracts without flow: ${audit.summary.criticalContractsWithoutFlow}`,
    `- High-severity flow gaps: ${audit.summary.highSeverityFlowGaps}`,
    "",
    "## Flows"
  ];
  for (const flow of audit.flows) {
    const gapSummary = flow.gaps.length ? flow.gaps.map((gap) => `${gap.severity}:${gap.kind}`).join(", ") : "none";
    const stepSummary = flow.steps.length ? flow.steps.map((step) => `${step.index + 1}.${step.action}`).join(", ") : "none";
    lines.push(
      `- ${flow.contractId} target=${flow.targetId} selected=${flow.selected ? "yes" : "no"} latest=${flow.latestStatus} steps=${stepSummary} gaps=${gapSummary}`
    );
    for (const recommendation of flow.recommendations.slice(0, 2)) {
      lines.push(`  - ${recommendation}`);
    }
  }
  if (audit.recommendations.length) {
    lines.push("", "## Recommendations", ...audit.recommendations.slice(0, 8).map((recommendation) => `- ${recommendation}`));
  }
  return lines.join("\n");
}

async function resolvePlan(
  options: FlowsCommandOptions,
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
    // Flow audits can run before planning. Create an in-memory plan so selected
    // flow status is still useful.
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

async function resolveChangedFiles(options: FlowsCommandOptions, cwd: string): Promise<string[]> {
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
