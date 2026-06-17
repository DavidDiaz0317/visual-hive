import type { SetupRecommendationReport } from "./recommend.js";
import { sanitizeText } from "../utils/sanitize.js";

export function buildSetupDocsMarkdown(report: SetupRecommendationReport): string {
  const lines = [
    "# Visual Hive",
    "",
    "This repository uses Visual Hive for deterministic-first visual QA orchestration.",
    "",
    "Playwright contracts are the pass/fail oracle. Optional provider and LLM output is advisory unless a trusted workflow explicitly enables a governed integration.",
    "",
    "## Generated Setup",
    "",
    `- Project: ${safe(report.project.name)}`,
    `- Detected type: ${safe(report.project.type)}`,
    `- Setup profile: ${safe(report.setupProfile)}`,
    `- Package manager: ${safe(report.project.packageManager)}`,
    `- Frameworks: ${listInline(report.project.detectedFrameworks)}`,
    `- Config path: ${safe(report.configPath)}`,
    "",
    "## PR Lane",
    "",
    "PR checks should run with read-only permissions and no repository secrets.",
    "",
    `- Recommended target: ${safe(report.recommendedTarget.id)} (${safe(report.recommendedTarget.kind)})`,
    `- Target URL: ${safe(report.recommendedTarget.url)}`,
    `- Install command: ${safe(report.recommendedTarget.install ?? "not configured")}`,
    `- Build command: ${safe(report.recommendedTarget.build ?? "not configured")}`,
    `- Serve command: ${safe(report.recommendedTarget.serve ?? "not configured")}`,
    `- Estimated PR runtime: ${safe(String(report.costEstimate.estimatedPrMinutes))} minute(s)`,
    `- PR permissions: ${listInline(report.permissions.pullRequest.permissions)}`,
    `- PR secrets required: ${listInline(report.permissions.pullRequest.secretsRequired)}`,
    "",
    "## Scheduled Or Protected Lane",
    "",
    "Scheduled/manual lanes may run deeper checks, mutation adequacy, optional provider uploads, and protected targets after explicit authorization.",
    "",
    `- Estimated scheduled runtime: ${safe(String(report.costEstimate.estimatedScheduledMinutes))} minute(s)`,
    `- Scheduled secrets by name: ${listInline(report.permissions.scheduled.secretsRequired)}`,
    `- External network allowed by recommendation: ${report.permissions.scheduled.externalNetwork ? "yes" : "no"}`,
    "",
    "## Recommended Contracts",
    "",
    ...contractLines(report),
    "",
    "## Detected Storybook Stories",
    "",
    ...storyLines(report),
    "",
    "## Existing Workflow Hints",
    "",
    ...workflowHintLines(report),
    "",
    "## Provider Posture",
    "",
    ...providerLines(report),
    "",
    "## Onboarding Checklist",
    "",
    ...onboardingChecklistLines(report),
    "",
    "## Cost Guardrails",
    "",
    `- Local screenshots per run: ${safe(String(report.costEstimate.localScreenshotsPerRun))}`,
    `- External screenshots per run by default: ${safe(String(report.costEstimate.externalScreenshotsPerRun))}`,
    `- Estimated monthly external screenshots: ${safe(String(report.costEstimate.estimatedMonthlyExternalScreenshots))}`,
    `- CI runtime class: ${safe(report.costEstimate.ciRuntimeClass)}`,
    ...report.costEstimate.notes.map((note) => `- ${safe(note)}`),
    "",
    "## Baselines",
    "",
    "First local runs may create missing baselines. Review generated actual/baseline/diff artifacts before approving them.",
    "",
    "```bash",
    "visual-hive baselines list",
    "visual-hive baselines approve --contract <contract-id> --screenshot <screenshot-name> --viewport <viewport>",
    "visual-hive baselines reject --contract <contract-id> --screenshot <screenshot-name> --viewport <viewport> --reason \"Not approved\"",
    "```",
    "",
    "## Local Commands",
    "",
    "```bash",
    ...report.recommendedCommands.map((command) => safe(command)),
    "visual-hive workflows --write-templates",
    "```",
    "",
    "## Setup PR Checklist",
    "",
    ...setupPrLines(report),
    "",
    "## Workflow Previews",
    "",
    ...workflowPreviewLines(report),
    "",
    "## Security Rules",
    "",
    "- Use `pull_request`, not `pull_request_target`, for workflows that execute PR code.",
    "- Do not expose repository secrets to PR workflows.",
    "- Show required secret names only, never secret values.",
    "- Create issues only from sanitized artifacts in a trusted `workflow_run` lane.",
    "- LLM output is advisory and never the sole pass/fail oracle.",
    "",
    "## Warnings And Findings",
    "",
    ...warningLines(report)
  ];
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n")}\n`;
}

function contractLines(report: SetupRecommendationReport): string[] {
  if (!report.recommendedContracts.length) return ["No starter contracts were recommended."];
  return report.recommendedContracts.flatMap((contract) => [
    `### ${safe(contract.id)}`,
    "",
    `- Target: ${safe(contract.targetId)}`,
    `- Selectors: ${listInline(contract.selectors)}`,
    `- Screenshots: ${listInline(contract.screenshots.map((shot) => `${shot.name} ${shot.route}@${shot.viewport}`))}`,
    `- Reasons: ${listInline(contract.reasons)}`,
    ""
  ]);
}

function storyLines(report: SetupRecommendationReport): string[] {
  if (!report.detectedStories?.length) return ["No Storybook story files were detected."];
  return report.detectedStories.slice(0, 10).map((story) => `- ${safe(story.storyFile)}: ${safe(story.title)} -> ${safe(story.route)}`);
}

function workflowHintLines(report: SetupRecommendationReport): string[] {
  if (!report.detectedWorkflows?.length) return ["No existing GitHub workflow files were detected."];
  return report.detectedWorkflows.slice(0, 10).map((workflow) => {
    const risks = [
      workflow.usesPullRequestTarget ? "uses pull_request_target" : "",
      workflow.usesSecrets ? "references secrets" : ""
    ].filter(Boolean);
    return `- ${safe(workflow.path)}: triggers=${listInline(workflow.triggers)}, permissions=${listInline(workflow.permissions)}, Visual Hive=${workflow.visualHiveRelated ? "yes" : "no"}${risks.length ? `. Review: ${safe(risks.join(", "))}` : ""}`;
  });
}

function providerLines(report: SetupRecommendationReport): string[] {
  if (!report.providerRecommendations.length) return ["No provider recommendations were generated."];
  return report.providerRecommendations.map(
    (provider) =>
      `- ${safe(provider.label)}: ${safe(provider.recommendation)}. ${safe(provider.reason)} Required env names: ${listInline(provider.requiredEnv)}. External by default: ${
        provider.externalUploadAllowedByDefault ? "yes" : "no"
      }.`
  );
}

function onboardingChecklistLines(report: SetupRecommendationReport): string[] {
  if (!report.onboardingChecklist?.length) return ["No structured onboarding checklist was generated. Re-run `visual-hive recommend` with a current Visual Hive version."];
  return report.onboardingChecklist.flatMap((item) => [
    `### ${safe(item.title)}`,
    "",
    `- Status: ${safe(item.status)}`,
    `- Why: ${safe(item.description)}`,
    `- Action: ${safe(item.action)}`,
    item.command ? `- Command: \`${safe(item.command)}\`` : "- Command: none",
    `- Evidence: ${listInline(item.evidence)}`,
    `- Related artifacts: ${listInline(item.relatedArtifacts)}`,
    ""
  ]);
}

function setupPrLines(report: SetupRecommendationReport): string[] {
  if (!report.setupPullRequest.recommended) return ["No setup PR is recommended."];
  return [
    `- Title: ${safe(report.setupPullRequest.title)}`,
    `- Files: ${listInline(report.setupPullRequest.files)}`,
    ...report.setupPullRequest.steps.map((step) => `- ${safe(step)}`),
    ...report.setupPullRequest.securityNotes.map((note) => `- Security: ${safe(note)}`)
  ];
}

function workflowPreviewLines(report: SetupRecommendationReport): string[] {
  if (!report.workflowPreviews?.length) return ["No workflow previews were generated."];
  return report.workflowPreviews.flatMap((workflow) => [
    `### ${safe(workflow.label)}`,
    "",
    `- Path: ${safe(workflow.path)}`,
    `- Purpose: ${safe(workflow.description)}`,
    `- Safety notes: ${listInline(workflow.safetyNotes)}`,
    "",
    "```yaml",
    safe(workflow.content).trim(),
    "```",
    ""
  ]);
}

function warningLines(report: SetupRecommendationReport): string[] {
  const lines = [
    ...report.findings.map((finding) => `- [${safe(finding.severity)}] ${safe(finding.message)}${finding.evidence ? ` Evidence: ${safe(finding.evidence)}` : ""}`),
    ...report.warnings.map((warning) => `- [warning] ${safe(warning)}`)
  ];
  return lines.length ? lines : ["No warnings or findings."];
}

function listInline(values: string[] | undefined): string {
  return values && values.length ? values.map((value) => safe(value)).join(", ") : "none";
}

function safe(value: string): string {
  return sanitizeText(value).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}
