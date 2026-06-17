import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  auditWorkflows,
  buildSetupProgress,
  loadConfig,
  readJson,
  sanitizeText,
  writeJson,
  type MutationReport,
  type Plan,
  type ProviderSetupPlan,
  type ReadinessReport,
  type Report,
  type SetupProgressReport,
  type SetupRecommendationReport,
  type TriageReport,
  type VisualHiveConfig,
  type WorkflowAuditInputFile,
  type WorkflowAuditReport
} from "@visual-hive/core";

export interface SetupStatusCommandOptions {
  config?: string;
  cwd?: string;
  plan?: string;
  report?: string;
  mutationReport?: string;
  triage?: string;
  recommendations?: string;
  workflows?: string;
  workflowDir?: string;
  readiness?: string;
  providerSetupPlan?: string;
  format?: "markdown" | "json";
}

export async function runSetupStatusCommand(options: SetupStatusCommandOptions = {}): Promise<{ report: SetupProgressReport; reportPath: string }> {
  const cwd = options.cwd ?? process.cwd();
  const configPath = options.config ?? "visual-hive.config.yaml";
  let config: VisualHiveConfig | undefined;
  let configError: string | undefined;
  let rootDir = cwd;
  try {
    const loaded = await loadConfig(configPath, cwd);
    config = loaded.config;
    rootDir = loaded.rootDir;
  } catch (error) {
    configError = sanitizeText(error instanceof Error ? error.message : String(error));
    rootDir = path.dirname(path.resolve(cwd, configPath));
  }
  const hiveRoot = path.join(rootDir, ".visual-hive");
  const plan = await readOptionalJson<Plan>(path.resolve(rootDir, options.plan ?? path.join(".visual-hive", "plan.json")));
  const deterministicReport = await readOptionalJson<Report>(path.resolve(rootDir, options.report ?? path.join(".visual-hive", "report.json")));
  const mutationReport = await readOptionalJson<MutationReport>(
    path.resolve(rootDir, options.mutationReport ?? path.join(".visual-hive", "mutation-report.json"))
  );
  const triageReport = await readOptionalJson<TriageReport>(path.resolve(rootDir, options.triage ?? path.join(".visual-hive", "triage.json")));
  const setupRecommendation = await readOptionalJson<SetupRecommendationReport>(
    path.resolve(rootDir, options.recommendations ?? path.join(".visual-hive", "recommendations.json"))
  );
  const workflowAudit =
    (await readOptionalJson<WorkflowAuditReport>(path.resolve(rootDir, options.workflows ?? path.join(".visual-hive", "workflows.json")))) ??
    (config ? await auditWorkflowDirIfPresent(config, rootDir, options.workflowDir) : undefined);
  const readinessReport = await readOptionalJson<ReadinessReport>(path.resolve(rootDir, options.readiness ?? path.join(".visual-hive", "readiness.json")));
  const providerSetupPlan = await readOptionalJson<ProviderSetupPlan>(
    path.resolve(rootDir, options.providerSetupPlan ?? path.join(".visual-hive", "provider-setup-plan.json"))
  );
  const setupProgress = buildSetupProgress({
    project: config?.project.name ?? setupRecommendation?.project.name,
    config,
    configError,
    plan,
    report: deterministicReport,
    mutationReport,
    triageReport,
    setupRecommendation,
    workflowAudit,
    readinessReport,
    providerSetupPlan
  });
  const reportPath = path.join(hiveRoot, "setup-progress.json");
  await writeJson(reportPath, setupProgress);
  return { report: setupProgress, reportPath };
}

export function formatSetupProgress(report: SetupProgressReport, reportPath: string, format: "markdown" | "json" = "markdown"): string {
  if (format === "json") return JSON.stringify(report, null, 2);
  const lines = [
    `Wrote ${reportPath}`,
    `# Setup Progress: ${report.project}`,
    "",
    `- Status: ${report.status}`,
    `- Phase: ${report.phase}`,
    `- Complete: ${report.completedSteps}/${report.totalSteps} (${report.percentComplete}%)`,
    `- Needs review: ${report.reviewSteps}`,
    `- Blocked: ${report.blockedSteps}`
  ];
  if (report.nextStep) {
    lines.push("", "## Next Best Action", `- [${report.nextStep.status}] ${report.nextStep.label}`, `  ${report.nextStep.description}`);
    if (report.nextStep.command) lines.push(`  Command: \`${report.nextStep.command}\``);
    if (report.nextStep.evidence.length) {
      lines.push("  Evidence:");
      for (const item of report.nextStep.evidence) lines.push(`  - ${item}`);
    }
  }
  lines.push("", "## Steps");
  for (const step of report.steps) {
    lines.push(`- [${step.status}] ${step.label}`);
    if (step.command) lines.push(`  Command: \`${step.command}\``);
    if (step.evidence.length) lines.push(`  Evidence: ${step.evidence.join("; ")}`);
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
