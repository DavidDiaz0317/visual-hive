import path from "node:path";
import {
  buildCapabilityInventory,
  buildCapabilityParityReport,
  loadConfig,
  readSchemaCapabilities,
  writeJson,
  type CapabilityInventory,
  type CapabilityParityReport,
  type CliCapability,
  type ControlPlaneCapability
} from "@visual-hive/core";
import { CONTROL_PLANE_CAPABILITY_SURFACES } from "@visual-hive/control-plane";
import { resolveVisualHiveSchemasDir } from "../schemaLocation.js";

export interface CapabilitiesCommandOptions {
  config?: string;
  cwd?: string;
  schemasDir?: string;
  output?: string;
  cli?: CliCapability[];
  controlPlane?: ControlPlaneCapability[];
  baseline: CapabilityInventory;
  now?: Date;
}

export interface CapabilitiesCommandResult {
  report: CapabilityParityReport;
  outputPath: string;
  schemasDir: string;
}

export async function runCapabilitiesCommand(options: CapabilitiesCommandOptions): Promise<CapabilitiesCommandResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const rootDir = options.config ? (await loadConfig(options.config, cwd)).rootDir : cwd;
  const schemasDir = await resolveVisualHiveSchemasDir(cwd, options.schemasDir);
  const actual = buildCapabilityInventory({
    cli: options.cli ?? options.baseline.cli,
    schemas: await readSchemaCapabilities(schemasDir),
    controlPlane: options.controlPlane ?? CONTROL_PLANE_CAPABILITY_SURFACES
  });
  const report = buildCapabilityParityReport(options.baseline, actual, options.now);
  const outputPath = path.resolve(rootDir, options.output ?? path.join(".visual-hive", "capability-parity.json"));
  await writeJson(outputPath, report);
  return { report, outputPath, schemasDir };
}

export function formatCapabilitiesResult(result: CapabilitiesCommandResult, format: "markdown" | "json" = "markdown"): string {
  if (format === "json") return JSON.stringify(result.report, null, 2);
  const failures = result.report.checks.filter((check) => !check.parity);
  return [
    `Wrote ${result.outputPath}`,
    "# Visual Hive Capability Parity",
    "",
    `- Parity: ${result.report.status}`,
    `- Runtime: ${result.report.runtimeStatus}`,
    `- Expected: ${result.report.summary.expected}`,
    `- Actual: ${result.report.summary.actual}`,
    `- Present: ${result.report.summary.present}`,
    `- Explicitly blocked: ${result.report.summary.blocked}`,
    `- Missing: ${result.report.summary.missing}`,
    `- Unexpected: ${result.report.summary.unexpected}`,
    `- Mismatched: ${result.report.summary.mismatched}`,
    failures.length ? "" : undefined,
    failures.length ? "## Parity Failures" : undefined,
    ...failures.slice(0, 25).map((check) => `- ${check.domain}:${check.key}: ${check.message}`)
  ].filter(Boolean).join("\n");
}

