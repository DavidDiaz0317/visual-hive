import path from "node:path";
import { pathToFileURL } from "node:url";
import { sanitizeText, writeJson, type VisualHiveIssueCandidate } from "@visual-hive/core";
import { publishGitHubAppIssuesFromWebhookResult, type GitHubAppLivePublishOptions, type GitHubAppLivePublishResult } from "./live.js";
import { handleVisualHiveGitHubAppWebhook, type VisualHiveGitHubAppWebhookResult } from "./webhook.js";
import { writeGitHubAppArtifacts } from "./server.js";

export interface GitHubAppLiveSmokeArgs {
  repository: string;
  outputDir: string;
  requireLive: boolean;
  apiBaseUrl?: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}

export interface GitHubAppLiveSmokeResult {
  schemaVersion: "visual-hive.github-app.live-smoke-result.v1";
  generatedAt: string;
  repository: string;
  webhookResult: VisualHiveGitHubAppWebhookResult;
  livePublish: GitHubAppLivePublishResult;
  dedicatedIssueFingerprint: string;
  expectedIssueCount: 1;
  externalCallsMade: number;
  networkCallsMade: number;
  checkoutPerformed: false;
  repoCodeExecuted: false;
  realGithubIssuesCreated: number;
  realGithubIssuesUpdated: number;
  status: "blocked" | "passed" | "failed";
}

export async function runGitHubAppLiveSmoke(args: GitHubAppLiveSmokeArgs): Promise<GitHubAppLiveSmokeResult> {
  const repository = sanitizeText(args.repository);
  const candidate = buildDedicatedSmokeCandidate(repository);
  const webhookResult = handleVisualHiveGitHubAppWebhook({
    eventName: "workflow_run",
    payload: {
      repository: { full_name: repository },
      workflow_run: { conclusion: "success" },
      visual_hive_artifact_summary: { issueCandidate: candidate }
    },
    deliveryId: "visual-hive-github-app-live-smoke"
  });
  await writeGitHubAppArtifacts(args.outputDir, webhookResult);
  const liveOptions: GitHubAppLivePublishOptions = {
    env: args.env,
    fetchImpl: args.fetchImpl,
    apiBaseUrl: args.apiBaseUrl
  };
  const livePublish = await publishGitHubAppIssuesFromWebhookResult(webhookResult, liveOptions);
  await writeJson(path.join(args.outputDir, "github-app-live-publish-result.json"), livePublish);
  const created = livePublish.results.filter((result) => result.status === "created").length;
  const updated = livePublish.results.filter((result) => result.status === "updated").length;
  const failed = livePublish.results.some((result) => result.status === "failed");
  const status = livePublish.mode === "blocked" ? "blocked" : failed || created + updated !== 1 ? "failed" : "passed";
  const result: GitHubAppLiveSmokeResult = {
    schemaVersion: "visual-hive.github-app.live-smoke-result.v1",
    generatedAt: new Date().toISOString(),
    repository,
    webhookResult,
    livePublish,
    dedicatedIssueFingerprint: candidate.dedupeFingerprint,
    expectedIssueCount: 1,
    externalCallsMade: livePublish.externalCallsMade,
    networkCallsMade: livePublish.networkCallsMade,
    checkoutPerformed: false,
    repoCodeExecuted: false,
    realGithubIssuesCreated: created,
    realGithubIssuesUpdated: updated,
    status
  };
  await writeJson(path.join(args.outputDir, "github-app-live-smoke-result.json"), result);
  if (args.requireLive && status !== "passed") {
    throw new Error(status === "blocked"
      ? "GitHub App live smoke is blocked. Set VISUAL_HIVE_GITHUB_APP_LIVE=true, VISUAL_HIVE_GITHUB_APP_LIVE_ISSUE_WRITE=true, and GitHub App credential env vars."
      : "GitHub App live smoke failed to create or update exactly one issue.");
  }
  return result;
}

function buildDedicatedSmokeCandidate(repository: string): VisualHiveIssueCandidate {
  const normalizedRepo = repository.toLowerCase();
  return {
    issueKind: "external_repo_onboarding",
    severity: "low",
    status: "open_candidate",
    dedupeFingerprint: `visual-hive:github-app-live-smoke:${normalizedRepo}`,
    title: "[Visual Hive smoke] GitHub App issue publishing",
    labels: ["visual-hive", "hive/quality", "e2e-smoke"],
    body: [
      "This is a guarded Visual Hive GitHub App live smoke issue.",
      "",
      "It proves the GitHub App can create or update one deduped issue from sanitized Visual Hive evidence.",
      "",
      "Default/local Visual Hive runs do not create this issue. Live writes require explicit trusted guards."
    ].join("\n"),
    owningAgentHint: "visual-hive/setup",
    sourceArtifacts: [".visual-hive/github-app-live-smoke-result.json", ".visual-hive/evidence-packet.json"],
    affected: [],
    validationCommand: "npm run github-app:smoke:live",
    guardrails: [
      "Do not repair code from the GitHub App smoke issue.",
      "Do not approve baselines blindly.",
      "Do not weaken thresholds to close this issue."
    ]
  };
}

function parseArgs(argv: string[]): GitHubAppLiveSmokeArgs {
  let repository = "DavidDiaz0317/visual-hive-demo-site";
  let outputDir = ".visual-hive";
  let requireLive = false;
  let apiBaseUrl: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--repo") repository = argv[++index] ?? repository;
    else if (arg === "--output-dir") outputDir = argv[++index] ?? outputDir;
    else if (arg === "--api-base-url") apiBaseUrl = argv[++index];
    else if (arg === "--require-live") requireLive = true;
  }
  return { repository, outputDir, requireLive, apiBaseUrl };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runGitHubAppLiveSmoke(parseArgs(process.argv.slice(2))).then((result) => {
    console.log(JSON.stringify(result, null, 2));
    if (result.status === "failed") process.exitCode = 1;
  }).catch((error) => {
    console.error(sanitizeText(error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  });
}
