import path from "node:path";
import {
  analyzeCosts,
  loadConfig,
  readJson,
  writeJson,
  type CostAuditReport,
  type MockProviderRunReport,
  type MutationReport,
  type Plan,
  type Report
} from "@visual-hive/core";

export interface CostsCommandOptions {
  config?: string;
  cwd?: string;
  plan?: string;
  report?: string;
  mutationReport?: string;
  providerResults?: string;
  format?: "markdown" | "json";
}

export async function runCostsCommand(options: CostsCommandOptions = {}): Promise<{ report: CostAuditReport; reportPath: string }> {
  const cwd = options.cwd ?? process.cwd();
  const loaded = await loadConfig(options.config, cwd);
  const plan = await readOptionalJson<Plan>(path.resolve(loaded.rootDir, options.plan ?? path.join(".visual-hive", "plan.json")));
  const deterministicReport = await readOptionalJson<Report>(
    path.resolve(loaded.rootDir, options.report ?? path.join(".visual-hive", "report.json"))
  );
  const mutationReport = await readOptionalJson<MutationReport>(
    path.resolve(loaded.rootDir, options.mutationReport ?? path.join(".visual-hive", "mutation-report.json"))
  );
  const providerRunReport = await readOptionalJson<MockProviderRunReport>(
    path.resolve(loaded.rootDir, options.providerResults ?? path.join(".visual-hive", "provider-results.json"))
  );
  const report = analyzeCosts(loaded.config, { plan, report: deterministicReport, mutationReport, providerRunReport });
  const reportPath = path.join(loaded.rootDir, ".visual-hive", "costs.json");
  await writeJson(reportPath, report);
  return { report, reportPath };
}

export function formatCostsReport(report: CostAuditReport, reportPath: string, format: "markdown" | "json" = "markdown"): string {
  if (format === "json") return JSON.stringify(report, null, 2);
  const lines = [
    `Wrote ${reportPath}`,
    `# Cost Audit: ${report.project}`,
    "",
    `- Mode: ${report.mode}`,
    `- Budget status: ${report.summary.budgetStatus}`,
    `- Selected contracts: ${report.summary.selectedContracts}`,
    `- Selected targets: ${report.summary.selectedTargets}`,
    `- Local screenshots: ${report.summary.localScreenshots}`,
    `- Estimated external screenshots: ${report.summary.estimatedExternalScreenshots}`,
    `- External calls planned: ${report.summary.externalCallsPlanned}`,
    `- External calls made: ${report.summary.externalCallsMade}`,
    `- Enabled external providers: ${report.summary.enabledExternalProviders}`,
    `- Policy-blocked providers: ${report.summary.policyBlockedProviders}`,
    ""
  ];
  lines.push("## Providers");
  for (const provider of report.providers) {
    lines.push(
      `- ${provider.label}: ${provider.availability}; external=${provider.externalUploadAllowed ? "allowed" : "blocked"}; estimated screenshots=${provider.estimatedExternalScreenshots}`
    );
  }
  if (report.risks.length) {
    lines.push("", "## Cost Risks");
    for (const risk of report.risks.slice(0, 10)) {
      lines.push(`- [${risk.severity}] ${risk.title} (${risk.category})`);
      lines.push(`  ${risk.recommendation}`);
    }
  }
  lines.push("", "## Recommendations", ...report.recommendations.map((recommendation) => `- ${recommendation}`));
  return lines.join("\n");
}

async function readOptionalJson<T>(filePath: string): Promise<T | undefined> {
  try {
    return await readJson<T>(filePath);
  } catch {
    return undefined;
  }
}
