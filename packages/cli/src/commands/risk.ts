import path from "node:path";
import {
  analyzeCoverage,
  analyzeRisk,
  auditContracts,
  auditFlows,
  auditSchedules,
  auditTargets,
  auditWorkflows,
  loadConfig,
  readLLMDecisionLog,
  readProviderDecisionLog,
  readJson,
  writeJson,
  type ContractAuditReport,
  type CoverageReport,
  type FlowAuditReport,
  type MutationReport,
  type Plan,
  type LLMDecisionLog,
  type ProviderDecisionLog,
  type ProviderHandoffManifest,
  type ProviderSetupPlan,
  type Report,
  type RiskRegisterReport,
  type RunHistoryReport,
  type ScheduleAuditReport,
  type TargetAuditReport,
  type WorkflowAuditReport
} from "@visual-hive/core";
import { readWorkflowFiles, resolveWorkflowRoot } from "./workflowAuditInput.js";

export interface RiskCommandOptions {
  config?: string;
  cwd?: string;
  plan?: string;
  report?: string;
  mutationReport?: string;
  coverage?: string;
  targets?: string;
  contracts?: string;
  flows?: string;
  schedules?: string;
  workflows?: string;
  providerDecisions?: string;
  providerSetupPlan?: string;
  providerHandoff?: string;
  llmDecisions?: string;
  history?: string;
  workflowDir?: string;
  format?: "markdown" | "json";
}

export async function runRiskCommand(options: RiskCommandOptions = {}): Promise<{ report: RiskRegisterReport; reportPath: string }> {
  const cwd = options.cwd ?? process.cwd();
  const loaded = await loadConfig(options.config, cwd);
  const hiveRoot = path.join(loaded.rootDir, ".visual-hive");
  const plan = await readOptionalJson<Plan>(path.resolve(loaded.rootDir, options.plan ?? path.join(".visual-hive", "plan.json")));
  const report = await readOptionalJson<Report>(path.resolve(loaded.rootDir, options.report ?? path.join(".visual-hive", "report.json")));
  const mutationReport = await readOptionalJson<MutationReport>(
    path.resolve(loaded.rootDir, options.mutationReport ?? path.join(".visual-hive", "mutation-report.json"))
  );
  const coverageReport =
    (await readOptionalJson<CoverageReport>(path.resolve(loaded.rootDir, options.coverage ?? path.join(".visual-hive", "coverage.json")))) ??
    analyzeCoverage(loaded.config, { plan, selectedContractIds: report?.selectedContracts, changedFiles: report?.changedFiles });
  const targetAudit =
    (await readOptionalJson<TargetAuditReport>(path.resolve(loaded.rootDir, options.targets ?? path.join(".visual-hive", "targets.json")))) ??
    auditTargets(loaded.config, { plan, report });
  const contractAudit =
    (await readOptionalJson<ContractAuditReport>(path.resolve(loaded.rootDir, options.contracts ?? path.join(".visual-hive", "contracts.json")))) ??
    auditContracts(loaded.config, { plan, report, mutationReport, selectedContractIds: report?.selectedContracts });
  const flowAudit =
    (await readOptionalJson<FlowAuditReport>(path.resolve(loaded.rootDir, options.flows ?? path.join(".visual-hive", "flows.json")))) ??
    auditFlows(loaded.config, { plan, report, selectedContractIds: report?.selectedContracts });
  const scheduleAudit =
    (await readOptionalJson<ScheduleAuditReport>(path.resolve(loaded.rootDir, options.schedules ?? path.join(".visual-hive", "schedules.json")))) ??
    auditSchedules(loaded.config, { changedFiles: plan?.changedFiles ?? report?.changedFiles });
  const workflowAudit =
    (await readOptionalJson<WorkflowAuditReport>(path.resolve(loaded.rootDir, options.workflows ?? path.join(".visual-hive", "workflows.json")))) ??
    (await auditWorkflowDirIfPresent(loaded.config, loaded.rootDir, cwd, options.workflowDir));
  const providerDecisions = await readOptionalProviderDecisions(
    path.resolve(loaded.rootDir, options.providerDecisions ?? path.join(".visual-hive", "provider-decisions.json"))
  );
  const providerSetupPlan = await readOptionalJson<ProviderSetupPlan>(
    path.resolve(loaded.rootDir, options.providerSetupPlan ?? path.join(".visual-hive", "provider-setup-plan.json"))
  );
  const providerHandoff = await readOptionalJson<ProviderHandoffManifest>(
    path.resolve(loaded.rootDir, options.providerHandoff ?? path.join(".visual-hive", "provider-handoff.json"))
  );
  const llmDecisions = await readOptionalLLMDecisions(path.resolve(loaded.rootDir, options.llmDecisions ?? path.join(".visual-hive", "llm-decisions.json")));
  const runHistory = await readOptionalJson<RunHistoryReport>(path.resolve(loaded.rootDir, options.history ?? path.join(".visual-hive", "history.json")));

  const risk = analyzeRisk(loaded.config, {
    plan,
    report,
    mutationReport,
    coverageReport,
    targetAudit,
    contractAudit,
    flowAudit,
    scheduleAudit,
    workflowAudit,
    providerDecisions,
    providerSetupPlan,
    providerHandoff,
    llmDecisions,
    runHistory
  });
  const reportPath = path.join(hiveRoot, "risk.json");
  await writeJson(reportPath, risk);
  return { report: risk, reportPath };
}

export function formatRiskRegister(report: RiskRegisterReport, reportPath: string, format: "markdown" | "json" = "markdown"): string {
  if (format === "json") return JSON.stringify(report, null, 2);
  const lines = [
    `Wrote ${reportPath}`,
    `# Risk Register: ${report.project}`,
    "",
    `- Total risks: ${report.summary.total}`,
    `- Risk score: ${report.summary.riskScore}/100`,
    `- Highest severity: ${report.summary.highestSeverity}`,
    `- Critical/high: ${report.summary.critical + report.summary.high}`,
    `- PR blocking: ${report.summary.prBlocking}`,
    `- Trusted-only: ${report.summary.trustedOnly}`
  ];
  if (report.risks.length) {
    lines.push("", "## Top Risks");
    for (const risk of report.risks.slice(0, 10)) {
      lines.push(`- [${risk.severity}] ${risk.title} (${risk.category})`);
      lines.push(`  ${risk.message}`);
    }
  }
  lines.push("", "## Recommendations");
  for (const recommendation of report.recommendations) {
    lines.push(`- ${recommendation}`);
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
  cwd: string,
  workflowDir = ".github/workflows"
): Promise<WorkflowAuditReport | undefined> {
  const { workflowRoot, exists } = await resolveWorkflowRoot({ configRoot: rootDir, cwd, workflowDir });
  if (!exists) return undefined;
  const files = await readWorkflowFiles(workflowRoot);
  return auditWorkflows(config, files, { workflowRoot });
}
