import { appendFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig, readJson, type MutationReport, type Report } from "@visual-hive/core";

export interface ReportCommandOptions {
  config?: string;
  cwd?: string;
  format?: "markdown" | "json";
  githubStepSummary?: boolean;
}

export async function runReportCommand(options: ReportCommandOptions = {}): Promise<string> {
  const cwd = options.cwd ?? process.cwd();
  const loaded = await loadConfig(options.config, cwd);
  const report = await readOptional<Report>(path.join(loaded.rootDir, ".visual-hive", "report.json"));
  const mutationReport = await readOptional<MutationReport>(path.join(loaded.rootDir, ".visual-hive", "mutation-report.json"));
  const output =
    options.format === "json"
      ? `${JSON.stringify({ report, mutationReport }, null, 2)}\n`
      : renderMarkdownReport(report, mutationReport);

  if (options.githubStepSummary) {
    const summaryPath = process.env.GITHUB_STEP_SUMMARY;
    if (summaryPath) {
      await appendFile(summaryPath, output, "utf8");
    }
  }

  return output;
}

export function renderMarkdownReport(report?: Report, mutationReport?: MutationReport): string {
  const failed = report?.results.filter((result) => result.status === "failed") ?? [];
  const visualDiffs = report?.results.flatMap((result) => result.screenshotAssertions ?? []).filter((screenshot) => screenshot.status === "failed") ?? [];
  const lines = [
    "## Visual Hive Summary",
    "",
    `- Project: ${report?.project ?? mutationReport?.project ?? "unknown"}`,
    `- Repository: ${report?.repository?.repository ?? "unknown"}`,
    `- Branch: ${report?.repository?.branch ?? "unknown"}`,
    `- Commit: ${report?.repository?.commitSha ? report.repository.commitSha.slice(0, 12) : "unknown"}`,
    `- Run context: ${report?.repository?.provider ?? "unknown"}`,
    `- Deterministic status: ${report?.status ?? "not available"}`,
    `- Contracts: ${report?.results.length ?? 0}`,
    `- Failed contracts: ${failed.length}`,
    `- Created baselines: ${report?.summary?.createdBaselines ?? 0}`,
    `- Visual diffs: ${report?.summary?.visualDiffs ?? visualDiffs.length}`,
    `- Console errors: ${report?.summary?.consoleErrors ?? 0}`,
    `- Page errors: ${report?.summary?.pageErrors ?? 0}`,
    `- Flow steps: ${report?.summary?.flowStepsPassed ?? 0} passed, ${report?.summary?.flowStepsFailed ?? 0} failed`,
    `- Mutation score: ${mutationReport ? `${Math.round(mutationReport.score * 100)}% (${mutationReport.killed}/${mutationReport.total})` : "not available"}`,
    `- Providers: ${report?.providerResults?.map((provider) => `${provider.label}=${provider.status}`).join(", ") ?? "not available"}`,
    ""
  ];

  if (failed.length > 0) {
    lines.push("### Failed Contracts", "");
    for (const result of failed) {
      lines.push(`- ${result.contractId} on ${result.targetId}: ${result.errors.join("; ") || "failed"}`);
    }
    lines.push("");
  }

  if (visualDiffs.length > 0) {
    lines.push("### Visual Diffs", "");
    for (const screenshot of visualDiffs) {
      lines.push(`- ${screenshot.name} (${screenshot.viewport} ${screenshot.route}): diffRatio=${screenshot.actualDiffPixelRatio}`);
    }
    lines.push("");
  }

  if ((report?.providerResults?.length ?? 0) > 0) {
    lines.push("### Provider Results", "");
    for (const provider of report?.providerResults ?? []) {
      lines.push(`- ${provider.label}: ${provider.status} (${provider.deterministicRole}) - ${provider.message}`);
      if (provider.externalUploadAllowed === false && provider.externalUploadBlockedReasons?.length) {
        lines.push(`  - External upload blocked: ${provider.externalUploadBlockedReasons.join(" ")}`);
      }
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

async function readOptional<T>(filePath: string): Promise<T | undefined> {
  try {
    return await readJson<T>(filePath);
  } catch {
    return undefined;
  }
}
