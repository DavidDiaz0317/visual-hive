import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  analyzeCosts,
  analyzeReadiness,
  analyzeSecurity,
  auditWorkflows,
  loadConfig,
  readLLMDecisionLog,
  readProviderDecisionLog,
  readJson,
  writeJson,
  type BaselineList,
  type CostAuditReport,
  type LLMDecisionLog,
  type MutationReport,
  type Plan,
  type ProviderDecisionLog,
  type ReadinessReport,
  type Report,
  type RunHistoryReport,
  type SecurityAuditReport,
  type WorkflowAuditInputFile,
  type WorkflowAuditReport
} from "@visual-hive/core";

export interface ReadinessCommandOptions {
  config?: string;
  cwd?: string;
  plan?: string;
  report?: string;
  mutationReport?: string;
  baselines?: string;
  workflows?: string;
  workflowDir?: string;
  security?: string;
  costs?: string;
  providerDecisions?: string;
  llmDecisions?: string;
  history?: string;
  format?: "markdown" | "json";
}

export async function runReadinessCommand(options: ReadinessCommandOptions = {}): Promise<{ report: ReadinessReport; reportPath: string }> {
  const cwd = options.cwd ?? process.cwd();
  const loaded = await loadConfig(options.config, cwd);
  const hiveRoot = path.join(loaded.rootDir, ".visual-hive");
  const plan = await readOptionalJson<Plan>(path.resolve(loaded.rootDir, options.plan ?? path.join(".visual-hive", "plan.json")));
  const report = await readOptionalJson<Report>(path.resolve(loaded.rootDir, options.report ?? path.join(".visual-hive", "report.json")));
  const mutationReport = await readOptionalJson<MutationReport>(
    path.resolve(loaded.rootDir, options.mutationReport ?? path.join(".visual-hive", "mutation-report.json"))
  );
  const baselines = await readOptionalJson<BaselineList>(path.resolve(loaded.rootDir, options.baselines ?? path.join(".visual-hive", "baselines.json")));
  const workflowAudit =
    (await readOptionalJson<WorkflowAuditReport>(path.resolve(loaded.rootDir, options.workflows ?? path.join(".visual-hive", "workflows.json")))) ??
    (await auditWorkflowDirIfPresent(loaded.config, loaded.rootDir, options.workflowDir));
  const securityAudit =
    (await readOptionalJson<SecurityAuditReport>(path.resolve(loaded.rootDir, options.security ?? path.join(".visual-hive", "security.json")))) ??
    analyzeSecurity(loaded.config, { workflowAudit });
  const costAudit =
    (await readOptionalJson<CostAuditReport>(path.resolve(loaded.rootDir, options.costs ?? path.join(".visual-hive", "costs.json")))) ??
    analyzeCosts(loaded.config, { plan, report, mutationReport });
  const providerDecisions = await readOptionalProviderDecisions(
    path.resolve(loaded.rootDir, options.providerDecisions ?? path.join(".visual-hive", "provider-decisions.json"))
  );
  const llmDecisions = await readOptionalLLMDecisions(path.resolve(loaded.rootDir, options.llmDecisions ?? path.join(".visual-hive", "llm-decisions.json")));
  const runHistory = await readOptionalJson<RunHistoryReport>(path.resolve(loaded.rootDir, options.history ?? path.join(".visual-hive", "history.json")));
  const readiness = analyzeReadiness(loaded.config, {
    plan,
    report,
    mutationReport,
    baselines,
    workflowAudit,
    securityAudit,
    costAudit,
    providerDecisions,
    llmDecisions,
    runHistory
  });
  const reportPath = path.join(hiveRoot, "readiness.json");
  await writeJson(reportPath, readiness);
  return { report: readiness, reportPath };
}

export function formatReadinessReport(report: ReadinessReport, reportPath: string, format: "markdown" | "json" = "markdown"): string {
  if (format === "json") return JSON.stringify(report, null, 2);
  const lines = [
    `Wrote ${reportPath}`,
    `# Readiness Gate: ${report.project}`,
    "",
    `- Status: ${report.status}`,
    `- Score: ${report.score}/100`,
    `- Gates: ${report.summary.total}`,
    `- Passed: ${report.summary.passed}`,
    `- Warnings: ${report.summary.warnings}`,
    `- Blocked: ${report.summary.blocked}`,
    `- Missing evidence: ${report.summary.missing}`,
    "",
    "## Gates"
  ];
  for (const gate of report.gates) {
    lines.push(`- [${gate.status}] ${gate.title} (${gate.category})`);
    lines.push(`  ${gate.message}`);
  }
  if (report.nextActions.length) {
    lines.push("", "## Next Actions", ...report.nextActions.map((action) => `- ${action}`));
  }
  return lines.join("\n");
}

async function readOptionalJson<T>(filePath: string): Promise<T | undefined> {
  try {
    return await readJson<T>(filePath);
  } catch {
    return undefined;
  }
}

async function readOptionalProviderDecisions(filePath: string): Promise<ProviderDecisionLog | undefined> {
  try {
    return await readProviderDecisionLog(filePath);
  } catch {
    return undefined;
  }
}

async function readOptionalLLMDecisions(filePath: string): Promise<LLMDecisionLog | undefined> {
  try {
    return await readLLMDecisionLog(filePath);
  } catch {
    return undefined;
  }
}

async function auditWorkflowDirIfPresent(
  config: Parameters<typeof auditWorkflows>[0],
  rootDir: string,
  workflowDir = ".github/workflows"
): Promise<WorkflowAuditReport | undefined> {
  const workflowRoot = path.resolve(rootDir, workflowDir);
  let entries: string[];
  try {
    entries = await readdir(workflowRoot);
  } catch {
    return undefined;
  }
  const files: WorkflowAuditInputFile[] = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".yml") || entry.endsWith(".yaml"))
      .sort()
      .map(async (entry) => ({
        path: path.join(workflowRoot, entry),
        content: await readFile(path.join(workflowRoot, entry), "utf8")
      }))
  );
  return auditWorkflows(config, files, { workflowRoot });
}
