import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildSetupDocsMarkdown, recommendSetup, writeJson, type SetupRecommendationReport } from "@visual-hive/core";

export interface RecommendCommandOptions {
  cwd?: string;
  repo?: string;
  writeConfig?: boolean;
  writeDocs?: boolean;
  force?: boolean;
  format?: "markdown" | "json";
}

export async function runRecommendCommand(
  options: RecommendCommandOptions = {}
): Promise<{ report: SetupRecommendationReport; reportPath: string; configWritten?: string; docsWritten?: string }> {
  const cwd = options.cwd ?? process.cwd();
  const repoRoot = path.resolve(cwd, options.repo ?? ".");
  const configPath = path.join(repoRoot, "visual-hive.config.yaml");
  const docsPath = path.join(repoRoot, "docs", "visual-hive.md");
  const report = await recommendSetup({ repoRoot, configPath });
  const reportPath = path.join(repoRoot, ".visual-hive", "recommendations.json");
  await writeJson(reportPath, report);
  let configWritten: string | undefined;
  let docsWritten: string | undefined;
  if (options.writeConfig) {
    if (!options.force && (await exists(configPath))) {
      throw new Error(`Refusing to overwrite existing Visual Hive config: ${configPath}. Pass --force to replace it.`);
    }
    await writeFile(configPath, report.recommendedConfigYaml, "utf8");
    configWritten = configPath;
  }
  if (options.writeDocs) {
    if (!options.force && (await exists(docsPath))) {
      throw new Error(`Refusing to overwrite existing Visual Hive docs: ${docsPath}. Pass --force to replace it.`);
    }
    await mkdir(path.dirname(docsPath), { recursive: true });
    await writeFile(docsPath, buildSetupDocsMarkdown(report), "utf8");
    docsWritten = docsPath;
  }
  return { report, reportPath, configWritten, docsWritten };
}

export function formatSetupRecommendation(
  result: { report: SetupRecommendationReport; reportPath: string; configWritten?: string; docsWritten?: string },
  format: "markdown" | "json" = "markdown"
): string {
  if (format === "json") {
    return JSON.stringify(result.report, null, 2);
  }
  const { report, reportPath, configWritten } = result;
  const lines = [
    `Wrote ${reportPath}`,
    "# Visual Hive Setup Recommendation",
    "",
    `- Project: ${report.project.name}`,
    `- Detected type: ${report.project.type}`,
    `- Setup profile: ${report.setupProfile}`,
    `- Package manager: ${report.project.packageManager}`,
    `- Frameworks: ${report.project.detectedFrameworks.join(", ") || "none detected"}`,
    `- Target: ${report.recommendedTarget.id} (${report.recommendedTarget.kind}, ${report.recommendedTarget.confidence} confidence)`,
    `- URL: ${report.recommendedTarget.url}`,
    `- Selector seed: ${report.recommendedContracts[0]?.selectors.join(", ") || "none"}`,
    `- Local screenshots/run: ${report.costEstimate.localScreenshotsPerRun}`,
    `- External screenshots/run: ${report.costEstimate.externalScreenshotsPerRun}`,
    `- Config written: ${configWritten ?? "no, pass --write-config to create visual-hive.config.yaml"}`,
    `- Docs written: ${result.docsWritten ?? "no, pass --write-docs to create docs/visual-hive.md"}`,
    "",
    "## Why",
    ...report.recommendedTarget.reasons.map((reason) => `- ${reason}`),
    "",
    "## Provider Recommendation",
    ...report.providerRecommendations.map(
      (provider) =>
        `- ${provider.label}: ${provider.recommendation} - ${provider.reason}${
          provider.requiredEnv.length ? ` Required env names: ${provider.requiredEnv.join(", ")}` : ""
        }`
    ),
    "",
    "## Cost And Permissions",
    `- PR runtime estimate: ${report.costEstimate.estimatedPrMinutes} minute(s), ${report.costEstimate.ciRuntimeClass}`,
    `- Scheduled runtime estimate: ${report.costEstimate.estimatedScheduledMinutes} minute(s)`,
    `- PR permissions: ${report.permissions.pullRequest.permissions.join(", ")}`,
    `- PR secrets required: ${report.permissions.pullRequest.secretsRequired.join(", ") || "none"}`,
    `- Scheduled secrets required: ${report.permissions.scheduled.secretsRequired.join(", ") || "none"}`,
    "",
    "## Next Commands",
    ...report.recommendedCommands.map((command) => `- \`${command}\``)
  ];
  if (report.setupPullRequest.recommended) {
    lines.push(
      "",
      "## Setup PR",
      `- Title: ${report.setupPullRequest.title}`,
      ...report.setupPullRequest.files.map((file) => `- File: ${file}`),
      ...report.setupPullRequest.securityNotes.map((note) => `- Security: ${note}`)
    );
  }
  if (report.warnings.length) {
    lines.push("", "## Warnings", ...report.warnings.map((warning) => `- ${warning}`));
  }
  if (report.detectedSelectors.length) {
    lines.push("", "## Detected Selectors", ...report.detectedSelectors.slice(0, 8).map((selector) => `- ${selector.selector} (${selector.sourceFile})`));
  }
  return lines.join("\n");
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
