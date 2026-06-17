import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  auditWorkflows,
  loadConfig,
  writeWorkflowTemplates,
  writeJson,
  type WorkflowTemplateWriteResult,
  type WorkflowAuditInputFile,
  type WorkflowAuditReport
} from "@visual-hive/core";

export interface WorkflowsCommandOptions {
  config?: string;
  cwd?: string;
  workflowDir?: string;
  format?: "markdown" | "json";
}

export interface WorkflowTemplatesWriteCommandOptions extends WorkflowsCommandOptions {
  force?: boolean;
  templateIds?: string[];
}

export interface WorkflowTemplatesWriteCommandResult {
  write: WorkflowTemplateWriteResult;
  audit: WorkflowAuditReport;
  auditPath: string;
}

export async function runWorkflowsCommand(options: WorkflowsCommandOptions = {}): Promise<{ audit: WorkflowAuditReport; auditPath: string }> {
  const cwd = options.cwd ?? process.cwd();
  const loaded = await loadConfig(options.config, cwd);
  const workflowRoot = path.resolve(loaded.rootDir, options.workflowDir ?? path.join(".github", "workflows"));
  const files = await readWorkflowFiles(workflowRoot);
  const audit = auditWorkflows(loaded.config, files, { workflowRoot });
  const auditPath = path.join(loaded.rootDir, ".visual-hive", "workflows.json");
  await writeJson(auditPath, audit);
  return { audit, auditPath };
}

export async function runWorkflowTemplatesWriteCommand(options: WorkflowTemplatesWriteCommandOptions = {}): Promise<WorkflowTemplatesWriteCommandResult> {
  const cwd = options.cwd ?? process.cwd();
  const loaded = await loadConfig(options.config, cwd);
  const write = await writeWorkflowTemplates(
    {
      repoRoot: loaded.rootDir,
      configRoot: loaded.rootDir
    },
    {
      confirm: true,
      force: options.force,
      templateIds: options.templateIds
    }
  );
  const auditResult = await runWorkflowsCommand(options);
  return {
    write,
    audit: auditResult.audit,
    auditPath: auditResult.auditPath
  };
}

export function formatWorkflowsAudit(audit: WorkflowAuditReport, auditPath: string, format: "markdown" | "json" = "markdown"): string {
  if (format === "json") return JSON.stringify(audit, null, 2);
  const lines = [
    `Wrote ${auditPath}`,
    `# Workflow Safety Audit: ${audit.project}`,
    "",
    `- Workflows: ${audit.summary.workflowCount}`,
    `- PR workflows: ${audit.summary.pullRequestWorkflows}`,
    `- Scheduled workflows: ${audit.summary.scheduledWorkflows}`,
    `- Trusted issue workflows: ${audit.summary.trustedIssueWorkflows}`,
    `- Critical findings: ${audit.summary.criticalFindings}`,
    `- High findings: ${audit.summary.highFindings}`,
    `- pull_request_target workflows: ${audit.summary.workflowsUsingPullRequestTarget}`,
    `- PR workflows using secrets: ${audit.summary.prWorkflowsUsingSecrets}`,
    `- PR workflows with write permissions: ${audit.summary.prWorkflowsWithWritePermissions}`,
    `- Workflows with tag/unpinned actions: ${audit.summary.workflowsUsingUnpinnedActions}`,
    `- Tag/unpinned action references: ${audit.summary.unpinnedActionReferences}`,
    "",
    "## Workflows"
  ];
  for (const workflow of audit.workflows) {
    lines.push(
      `- ${workflow.path}: kind=${workflow.kind} risk=${workflow.risk} triggers=${workflow.triggers.join(", ") || "none"} artifacts=${workflow.uploadsVisualHiveArtifacts ? "yes" : "no"} baselines=${workflow.writesBaselineReview ? "yes" : "no"} actions=${workflow.unpinnedActions.length ? `${workflow.unpinnedActions.length} tag/unpinned` : "sha/local"}`
    );
  }
  if (audit.findings.length) {
    lines.push("", "## Findings");
    for (const finding of audit.findings.slice(0, 12)) {
      lines.push(`- [${finding.severity}] ${finding.workflowPath}: ${finding.message}`);
    }
  }
  if (audit.recommendations.length) {
    lines.push("", "## Recommendations", ...audit.recommendations.map((recommendation) => `- ${recommendation}`));
  }
  return lines.join("\n");
}

export function formatWorkflowTemplateWrite(result: WorkflowTemplatesWriteCommandResult, format: "markdown" | "json" = "markdown"): string {
  if (format === "json") {
    return JSON.stringify(
      {
        workflowTemplateWrite: result.write,
        audit: result.audit
      },
      null,
      2
    );
  }
  const lines = [
    `Workflow templates audit: ${result.auditPath}`,
    `Audit log: ${result.write.auditPath}`,
    `Templates written: ${result.write.written.length}`,
    `Templates skipped: ${result.write.skipped.length}`
  ];
  for (const entry of result.write.written) {
    lines.push(`- wrote ${entry.path}${entry.overwritten ? " (overwritten)" : ""}`);
  }
  for (const entry of result.write.skipped) {
    lines.push(`- skipped ${entry.path} (exists; pass --force after reviewing the diff to overwrite)`);
  }
  lines.push("", formatWorkflowsAudit(result.audit, result.auditPath, "markdown"));
  return lines.join("\n");
}

async function readWorkflowFiles(workflowRoot: string): Promise<WorkflowAuditInputFile[]> {
  let entries: string[];
  try {
    entries = await readdir(workflowRoot);
  } catch {
    return [];
  }
  const workflowFiles = entries.filter((entry) => entry.endsWith(".yml") || entry.endsWith(".yaml")).sort();
  return Promise.all(
    workflowFiles.map(async (entry) => {
      const filePath = path.join(workflowRoot, entry);
      return {
        path: filePath,
        content: await readFile(filePath, "utf8")
      };
    })
  );
}
