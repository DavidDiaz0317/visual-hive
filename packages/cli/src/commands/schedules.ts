import { readFile } from "node:fs/promises";
import path from "node:path";
import { auditSchedules, loadConfig, writeJson, type ScheduleAuditReport } from "@visual-hive/core";
import { gitChangedFiles } from "./gitChangedFiles.js";

export interface SchedulesCommandOptions {
  config?: string;
  cwd?: string;
  changedFiles?: string;
  base?: string;
  format?: "markdown" | "json";
}

export async function runSchedulesCommand(options: SchedulesCommandOptions = {}): Promise<{ audit: ScheduleAuditReport; auditPath: string }> {
  const cwd = options.cwd ?? process.cwd();
  const loaded = await loadConfig(options.config, cwd);
  const changedFiles = await resolveChangedFiles(options, cwd);
  const audit = auditSchedules(loaded.config, { changedFiles });
  const auditPath = path.join(loaded.rootDir, ".visual-hive", "schedules.json");
  await writeJson(auditPath, audit);
  return { audit, auditPath };
}

export function formatSchedulesAudit(audit: ScheduleAuditReport, auditPath: string, format: "markdown" | "json" = "markdown"): string {
  if (format === "json") {
    return JSON.stringify(audit, null, 2);
  }
  const lines = [
    `Wrote ${auditPath}`,
    `# Schedule Audit: ${audit.project}`,
    "",
    `- Pull request contracts: ${audit.summary.pullRequestContracts}`,
    `- Scheduled contracts: ${audit.summary.scheduledContracts}`,
    `- Protected contracts: ${audit.summary.protectedContracts}`,
    `- Protected scheduled contracts: ${audit.summary.protectedScheduledContracts}`,
    `- Targets with cron schedules: ${audit.summary.targetsWithCronSchedules}`,
    `- Mutation scheduled: ${audit.summary.mutationScheduled ? "yes" : "no"}`,
    `- Missing secret names: ${audit.summary.missingSecretNames}`,
    `- High-severity gaps: ${audit.summary.highSeverityGaps}`,
    "",
    "## Lanes"
  ];
  for (const lane of audit.lanes) {
    const warnings = lane.warnings.length ? ` warnings=${lane.warnings.join("; ")}` : "";
    lines.push(
      `- ${lane.label}: trigger=${lane.trigger} contracts=${lane.contractIds.length} targets=${lane.targetIds.join(", ") || "none"} secrets=${lane.usesSecrets ? "yes" : "no"}${warnings}`
    );
  }
  if (audit.gaps.length) {
    lines.push("", "## Gaps");
    for (const gap of audit.gaps.slice(0, 10)) {
      lines.push(`- [${gap.severity}] ${gap.message}`);
    }
  }
  if (audit.recommendations.length) {
    lines.push("", "## Recommendations", ...audit.recommendations.map((recommendation) => `- ${recommendation}`));
  }
  return lines.join("\n");
}

async function resolveChangedFiles(options: SchedulesCommandOptions, cwd: string): Promise<string[]> {
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
