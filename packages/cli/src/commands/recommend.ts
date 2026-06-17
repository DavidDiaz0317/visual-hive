import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { writeSetupBundleFromRecommendation, type SetupBundleWriteResult } from "@visual-hive/control-plane";
import {
  SetupProfileSchema,
  buildSetupDocsMarkdown,
  recommendSetup,
  writeJson,
  type SetupRecommendationReport,
  type VisualHiveConfig
} from "@visual-hive/core";

export interface RecommendCommandOptions {
  cwd?: string;
  repo?: string;
  profile?: VisualHiveConfig["project"]["setupProfile"];
  writeConfig?: boolean;
  writeDocs?: boolean;
  writeSetupBundle?: boolean;
  force?: boolean;
  format?: "markdown" | "json";
}

export interface RecommendCommandResult {
  report: SetupRecommendationReport;
  reportPath: string;
  configWritten?: string;
  docsWritten?: string;
  setupBundle?: SetupBundleWriteResult;
}

export async function runRecommendCommand(
  options: RecommendCommandOptions = {}
): Promise<RecommendCommandResult> {
  const cwd = options.cwd ?? process.cwd();
  const repoRoot = path.resolve(cwd, options.repo ?? ".");
  const configPath = path.join(repoRoot, "visual-hive.config.yaml");
  const docsPath = path.join(repoRoot, "docs", "visual-hive.md");
  const profile = parseProfileOption(options.profile);
  const report = await recommendSetup({ repoRoot, configPath, setupProfile: profile });
  const reportPath = path.join(repoRoot, ".visual-hive", "recommendations.json");
  await writeJson(reportPath, report);
  let configWritten: string | undefined;
  let docsWritten: string | undefined;
  let setupBundle: SetupBundleWriteResult | undefined;
  if (options.writeSetupBundle) {
    setupBundle = await writeSetupBundleFromRecommendation(
      {
        repo: repoRoot,
        config: configPath
      },
      {
        confirm: true,
        force: options.force
      }
    );
    configWritten = path.join(repoRoot, setupBundle.config.configPath);
    docsWritten = path.join(repoRoot, setupBundle.docs.docsPath);
  } else if (options.writeConfig) {
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
  return { report, reportPath, configWritten, docsWritten, setupBundle };
}

export function formatSetupRecommendation(
  result: RecommendCommandResult,
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
    `- Playwright setup: ${report.playwright?.status ?? "unknown"}`,
    `- Target: ${report.recommendedTarget.id} (${report.recommendedTarget.kind}, ${report.recommendedTarget.confidence} confidence)`,
    `- URL: ${report.recommendedTarget.url}`,
    `- Selector seed: ${report.recommendedContracts[0]?.selectors.join(", ") || "none"}`,
    `- Story routes: ${report.detectedStories?.length ? report.detectedStories.map((story) => story.route).slice(0, 3).join(", ") : "none detected"}`,
    `- Existing workflows: ${report.detectedWorkflows?.length ? report.detectedWorkflows.map((workflow) => workflow.path).slice(0, 3).join(", ") : "none detected"}`,
    `- Local screenshots/run: ${report.costEstimate.localScreenshotsPerRun}`,
    `- External screenshots/run: ${report.costEstimate.externalScreenshotsPerRun}`,
    `- Config written: ${configWritten ?? "no, pass --write-config to create visual-hive.config.yaml"}`,
    `- Docs written: ${result.docsWritten ?? "no, pass --write-docs to create docs/visual-hive.md"}`,
    `- Setup bundle written: ${result.setupBundle ? `yes, audit ${result.setupBundle.auditPath}` : "no, pass --write-setup-bundle to create config, docs, and workflows"}`,
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
    "## Playwright Presence",
    `- Status: ${report.playwright?.status ?? "unknown"}`,
    `- Dependencies: ${report.playwright?.dependencies.join(", ") || "none"}`,
    `- Scripts: ${report.playwright?.scripts.join(", ") || "none"}`,
    `- Config files: ${report.playwright?.configFiles.join(", ") || "none"}`,
    "",
    "## Onboarding Checklist",
    ...(report.onboardingChecklist ?? []).map(
      (item) =>
        `- [${item.status}] ${item.title}: ${item.action}${item.command ? ` Command: \`${item.command}\`` : ""}`
    ),
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
  if (report.workflowPreviews?.length) {
    lines.push(
      "",
      "## Workflow Previews",
      ...report.workflowPreviews.map(
        (workflow) => `- ${workflow.label}: ${workflow.path} - ${workflow.description}`
      )
    );
  }
  if (result.setupBundle) {
    lines.push(
      "",
      "## Setup Bundle",
      `- Audit: ${result.setupBundle.auditPath}`,
      `- Config: ${result.setupBundle.config.configPath}`,
      `- Docs: ${result.setupBundle.docs.docsPath}`,
      `- Workflows written: ${result.setupBundle.workflows.written.length}`,
      `- Workflows skipped: ${result.setupBundle.workflows.skipped.length}`,
      ...result.setupBundle.workflows.written.map((entry) => `- Workflow: ${entry.path}${entry.overwritten ? " (overwritten)" : ""}`)
    );
  }
  if (report.warnings.length) {
    lines.push("", "## Warnings", ...report.warnings.map((warning) => `- ${warning}`));
  }
  if (report.detectedSelectors.length) {
    lines.push("", "## Detected Selectors", ...report.detectedSelectors.slice(0, 8).map((selector) => `- ${selector.selector} (${selector.sourceFile})`));
  }
  if (report.detectedWorkflows?.length) {
    lines.push(
      "",
      "## Existing Workflow Hints",
      ...report.detectedWorkflows.slice(0, 8).map((workflow) => {
        const risks = [
          workflow.usesPullRequestTarget ? "uses pull_request_target" : "",
          workflow.usesSecrets ? "references secrets" : ""
        ].filter(Boolean);
        return `- ${workflow.path}: triggers=${workflow.triggers.join(", ") || "unknown"} permissions=${workflow.permissions.join(", ") || "unspecified"}${
          risks.length ? ` review=${risks.join(", ")}` : ""
        }`;
      })
    );
  }
  return lines.join("\n");
}

function parseProfileOption(profile: VisualHiveConfig["project"]["setupProfile"] | undefined): VisualHiveConfig["project"]["setupProfile"] | undefined {
  if (profile === undefined) return undefined;
  const parsed = SetupProfileSchema.safeParse(profile);
  if (parsed.success) return parsed.data;
  throw new Error(
    `Invalid setup profile "${profile}". Expected one of: ${SetupProfileSchema.options.join(", ")}.`
  );
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
