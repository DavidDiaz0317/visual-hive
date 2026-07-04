import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import {
  analyzeSecurity,
  auditWorkflows,
  loadConfig,
  npmAuditSummaryFromError,
  npmAuditSummaryFromJson,
  readJson,
  writeJson,
  type NpmAuditSummary,
  type SecurityAuditReport,
  type WorkflowAuditReport
} from "@visual-hive/core";
import { readWorkflowFiles, resolveWorkflowRoot } from "./workflowAuditInput.js";

const execFileAsync = promisify(execFile);

export interface SecurityCommandOptions {
  config?: string;
  cwd?: string;
  workflowDir?: string;
  workflows?: string;
  auditJson?: string;
  npmAudit?: boolean;
  format?: "markdown" | "json";
}

export async function runSecurityCommand(options: SecurityCommandOptions = {}): Promise<{ report: SecurityAuditReport; reportPath: string }> {
  const cwd = options.cwd ?? process.cwd();
  const loaded = await loadConfig(options.config, cwd);
  const workflowAudit =
    (options.workflows ? await readOptionalJson<WorkflowAuditReport>(path.resolve(loaded.rootDir, options.workflows)) : undefined) ??
    (await auditWorkflowDirIfPresent(loaded.config, loaded.rootDir, cwd, options.workflowDir));
  const npmAudit = await readNpmAuditSummary(loaded.rootDir, options);
  const report = analyzeSecurity(loaded.config, { workflowAudit, npmAudit });
  const reportPath = path.join(loaded.rootDir, ".visual-hive", "security.json");
  await writeJson(reportPath, report);
  return { report, reportPath };
}

export function formatSecurityAudit(report: SecurityAuditReport, reportPath: string, format: "markdown" | "json" = "markdown"): string {
  if (format === "json") return JSON.stringify(report, null, 2);
  const lines = [
    `Wrote ${reportPath}`,
    `# Security Audit: ${report.project}`,
    "",
    `- Score: ${report.summary.score}/100`,
    `- Findings: ${report.summary.totalFindings}`,
    `- Critical/high: ${report.summary.critical + report.summary.high}`,
    `- PR-blocking: ${report.summary.prBlocking}`,
    `- Trusted-only: ${report.summary.trustedOnly}`,
    `- npm audit: ${report.summary.npmAuditSource} (${report.summary.npmAuditTotal} vulnerabilities)`,
    "",
    "## Findings"
  ];
  if (!report.findings.length) {
    lines.push("- No immediate Visual Hive security posture findings.");
  } else {
    for (const finding of report.findings.slice(0, 12)) {
      lines.push(`- [${finding.severity}] ${finding.title} (${finding.category})`);
      lines.push(`  ${finding.message}`);
      lines.push(`  Recommendation: ${finding.recommendation}`);
    }
  }
  lines.push("", "## Recommendations", ...report.recommendations.map((recommendation) => `- ${recommendation}`));
  return lines.join("\n");
}

async function readNpmAuditSummary(rootDir: string, options: SecurityCommandOptions): Promise<NpmAuditSummary | undefined> {
  if (options.auditJson) {
    const auditPath = path.resolve(rootDir, options.auditJson);
    return npmAuditSummaryFromJson(await readJson<unknown>(auditPath), "npm_audit_json");
  }
  if (!options.npmAudit) {
    return undefined;
  }
  try {
    const { stdout } = await execFileAsync("npm", ["audit", "--json"], {
      cwd: rootDir,
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024
    });
    return npmAuditSummaryFromJson(JSON.parse(stdout), "npm_audit_command");
  } catch (error) {
    const maybeStdout = error && typeof error === "object" && "stdout" in error ? String((error as { stdout?: unknown }).stdout ?? "") : "";
    if (maybeStdout.trim()) {
      try {
        return npmAuditSummaryFromJson(JSON.parse(maybeStdout), "npm_audit_command");
      } catch {
        // Fall through to sanitized error reporting.
      }
    }
    return npmAuditSummaryFromError(error, "npm_audit_command");
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

async function readOptionalJson<T>(filePath: string): Promise<T | undefined> {
  try {
    return await readJson<T>(filePath);
  } catch {
    return undefined;
  }
}
