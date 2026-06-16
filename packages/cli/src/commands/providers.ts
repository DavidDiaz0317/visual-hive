import path from "node:path";
import {
  inspectProviders,
  loadConfig,
  readJson,
  runMockProviderAdapters,
  writeJson,
  type MockProviderRunReport,
  type ProviderInspection,
  type Report
} from "@visual-hive/core";

export interface ProvidersCommandOptions {
  config?: string;
  cwd?: string;
  report?: string;
  format?: "markdown" | "json";
}

export interface ProvidersMockCommandResult {
  report: MockProviderRunReport;
  reportPath: string;
}

export async function runProvidersCommand(options: ProvidersCommandOptions = {}): Promise<ProviderInspection[]> {
  const cwd = options.cwd ?? process.cwd();
  const loaded = await loadConfig(options.config ?? "visual-hive.config.yaml", cwd);
  return inspectProviders(loaded.config);
}

export async function runProvidersMockCommand(options: ProvidersCommandOptions = {}): Promise<ProvidersMockCommandResult> {
  const cwd = options.cwd ?? process.cwd();
  const loaded = await loadConfig(options.config ?? "visual-hive.config.yaml", cwd);
  const hiveRoot = path.join(loaded.rootDir, ".visual-hive");
  const deterministicReportPath = path.resolve(loaded.rootDir, options.report ?? path.join(".visual-hive", "report.json"));
  let deterministicReport: Report;
  try {
    deterministicReport = await readJson<Report>(deterministicReportPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Missing deterministic report for provider adapter mock run at ${deterministicReportPath}. Run "visual-hive run" first. Details: ${message}`
    );
  }

  const artifactPaths = Array.from(
    new Set(
      [
        deterministicReport.generatedSpecPath,
        ...deterministicReport.artifacts,
        ...deterministicReport.results.flatMap((result) => result.artifacts ?? [])
      ].filter(Boolean)
    )
  );
  const report = runMockProviderAdapters(loaded.config, {
    deterministicStatus: deterministicReport.status,
    artifactCount: artifactPaths.length,
    artifactPaths,
    mode: deterministicReport.mode
  });
  const reportPath = path.join(hiveRoot, "provider-results.json");
  await writeJson(reportPath, report);
  return { report, reportPath };
}

export function formatProvidersSummary(providers: ProviderInspection[]): string {
  const widths = {
    provider: Math.max("Provider".length, ...providers.map((provider) => provider.label.length)),
    status: Math.max("Status".length, ...providers.map((provider) => provider.availability.length)),
    mode: Math.max("Mode".length, ...providers.map((provider) => provider.mode.length)),
    role: Math.max("Role".length, ...providers.map((provider) => provider.deterministicRole.length)),
    external: Math.max("External".length, ...providers.map((provider) => externalUploadLabel(provider).length))
  };
  const header = [
    pad("Provider", widths.provider),
    pad("Status", widths.status),
    pad("Mode", widths.mode),
    pad("Role", widths.role),
    pad("External", widths.external),
    "Message"
  ].join("  ");
  const separator = [
    "-".repeat(widths.provider),
    "-".repeat(widths.status),
    "-".repeat(widths.mode),
    "-".repeat(widths.role),
    "-".repeat(widths.external),
    "-------"
  ].join("  ");
  const rows = providers.map((provider) =>
    [
      pad(provider.label, widths.provider),
      pad(provider.availability, widths.status),
      pad(provider.mode, widths.mode),
      pad(provider.deterministicRole, widths.role),
      pad(externalUploadLabel(provider), widths.external),
      provider.message
    ].join("  ")
  );
  return [header, separator, ...rows].join("\n");
}

export function formatProvidersMockSummary(report: MockProviderRunReport, reportPath: string, format: "markdown" | "json" = "markdown"): string {
  if (format === "json") {
    return JSON.stringify(report, null, 2);
  }
  const lines = [
    `# Provider Adapter Mock Results: ${report.project}`,
    "",
    `- Status source: deterministic run ${report.deterministicStatus}`,
    `- Providers: ${report.summary.providerCount}`,
    `- Mock providers: ${report.summary.mockProviders}`,
    `- Missing credential providers: ${report.summary.missingCredentialProviders}`,
    `- External deferred providers: ${report.summary.externalDeferredProviders}`,
    `- Artifact count: ${report.artifactCount}`,
    `- Wrote: ${reportPath}`,
    "",
    "| Provider | Availability | Result | Network | Upload | External policy | Operations | Message |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |"
  ];
  for (const provider of report.providers) {
    lines.push(
      `| ${provider.label} | ${provider.availability} | ${provider.result.status} | ${provider.normalized.networkMode} | ${provider.normalized.artifactSummary.uploadMode} | ${mockExternalPolicyLabel(provider)} | ${provider.operations
        .map((operation) => `${operation.operation}:${operation.status}`)
        .join(", ")} | ${provider.result.message} |`
    );
  }
  if (report.warnings.length) {
    lines.push("", "## Warnings", "", ...report.warnings.map((warning) => `- ${warning}`));
  }
  return lines.join("\n");
}

function pad(value: string, width: number): string {
  return value.padEnd(width, " ");
}

function externalUploadLabel(provider: ProviderInspection): string {
  if (provider.id === "playwright") return "local";
  if (!provider.enabled) return "disabled";
  if (provider.mode === "mock") return "mock";
  return provider.costPolicy.externalUploadAllowed ? "allowed" : "blocked";
}

function mockExternalPolicyLabel(provider: MockProviderRunReport["providers"][number]): string {
  if (provider.providerId === "playwright") return "local";
  if (!provider.enabled) return "disabled";
  if (provider.mode === "mock") return "mock";
  return provider.normalized.costPolicy.externalUploadAllowed ? "allowed" : "blocked";
}
