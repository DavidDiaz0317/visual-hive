import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { sanitizeText } from "@visual-hive/core";
import { handleVisualHiveGitHubAppWebhook, type VisualHiveGitHubAppEventName } from "./webhook.js";
import { writeGitHubAppArtifacts } from "./server.js";

interface MockArgs {
  eventName: VisualHiveGitHubAppEventName;
  payloadPath?: string;
  outputDir: string;
}

export async function runGitHubAppMock(args: MockArgs): Promise<void> {
  const payload = args.payloadPath ? JSON.parse(await readFile(args.payloadPath, "utf8")) as Record<string, unknown> : defaultPayload(args.eventName);
  const result = handleVisualHiveGitHubAppWebhook({
    eventName: args.eventName,
    payload,
    deliveryId: "visual-hive-local-mock"
  });
  await writeGitHubAppArtifacts(args.outputDir, result);
  console.log(JSON.stringify(result, null, 2));
}

function defaultPayload(eventName: VisualHiveGitHubAppEventName): Record<string, unknown> {
  if (eventName === "workflow_run") {
    return {
      repository: { full_name: "DavidDiaz0317/visual-hive-demo-site" },
      workflow_run: { conclusion: "failure" },
      visual_hive_artifact_summary: {
        issueCandidate: {
          issueKind: "missing_visual_coverage",
          severity: "medium",
          status: "open_candidate",
          dedupeFingerprint: "visual-hive:mock:github-app",
          title: "[Visual Hive] Mock GitHub App issue",
          labels: ["visual-hive", "hive/quality"],
          body: "Mock sanitized issue body with .visual-hive/evidence-packet.json.",
          owningAgentHint: "visual-hive/test-creator",
          sourceArtifacts: [".visual-hive/evidence-packet.json"],
          affected: [],
          validationCommand: "visual-hive issues --write",
          guardrails: ["Do not repair code from the GitHub App mock."]
        }
      }
    };
  }
  if (eventName === "issues") {
    return {
      repository: { full_name: "DavidDiaz0317/visual-hive-demo-site" },
      issue: { title: "[Visual Hive] Mock issue event" }
    };
  }
  return {
    repositories: [{ full_name: "DavidDiaz0317/visual-hive-demo-site", default_branch: "main" }]
  };
}

function parseArgs(argv: string[]): MockArgs {
  let eventName: VisualHiveGitHubAppEventName = "installation";
  let payloadPath: string | undefined;
  let outputDir = ".visual-hive";
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--event") eventName = parseEvent(argv[++index]);
    else if (arg === "--payload") payloadPath = argv[++index];
    else if (arg === "--output-dir") outputDir = argv[++index] ?? outputDir;
  }
  return { eventName, payloadPath, outputDir };
}

function parseEvent(value: string | undefined): VisualHiveGitHubAppEventName {
  if (value === "installation" || value === "repository" || value === "workflow_run" || value === "issues") return value;
  throw new Error(`Unsupported mock event: ${sanitizeText(value ?? "missing")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runGitHubAppMock(parseArgs(process.argv.slice(2))).catch((error) => {
    console.error(sanitizeText(error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  });
}
