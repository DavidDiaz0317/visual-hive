import path from "node:path";
import { verifySchemaCatalog, writeJson, type SchemaCatalogReport } from "@visual-hive/core";
import { resolveVisualHiveSchemasDir } from "../schemaLocation.js";

export interface SchemasVerifyCommandOptions {
  cwd?: string;
  schemasDir?: string;
  output?: string;
  format?: "markdown" | "json";
}

export interface SchemasVerifyCommandResult {
  report: SchemaCatalogReport;
  outputPath?: string;
}

export async function runSchemasVerifyCommand(options: SchemasVerifyCommandOptions = {}): Promise<SchemasVerifyCommandResult> {
  const cwd = options.cwd ?? process.cwd();
  const schemasDir = await resolveVisualHiveSchemasDir(cwd, options.schemasDir);
  const report = await verifySchemaCatalog({
    rootDir: cwd,
    schemasDir
  });
  const outputPath = options.output ? path.resolve(cwd, options.output) : undefined;
  if (outputPath) {
    await writeJson(outputPath, report);
  }
  return { report, outputPath };
}

export function formatSchemasVerifyResult(result: SchemasVerifyCommandResult, format: "markdown" | "json" = "markdown"): string {
  if (format === "json") return JSON.stringify(result.report, null, 2);
  const { report } = result;
  const failedChecks = report.checks.filter((check) => check.status === "failed");
  return [
    result.outputPath ? `Wrote ${result.outputPath}` : undefined,
    `# Schema Catalog Verification`,
    "",
    `- Status: ${report.status}`,
    `- Schemas checked: ${report.summary.schemasChecked}`,
    `- Checks: ${report.summary.checks}`,
    `- Failed: ${report.summary.failed}`,
    `- Evidence resources: ${report.summary.evidenceResources}`,
    `- Evidence read tools: ${report.summary.evidenceReadTools}`,
    failedChecks.length ? "" : undefined,
    failedChecks.length ? "## Failed Checks" : undefined,
    ...failedChecks.slice(0, 20).map((check) => `- ${check.id}: ${check.message}`),
    failedChecks.length > 20 ? `- ... ${failedChecks.length - 20} more failed check(s)` : undefined
  ].filter(Boolean).join("\n");
}
