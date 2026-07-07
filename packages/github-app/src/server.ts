import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { mkdir } from "node:fs/promises";
import { sanitizeText, writeJson, writeText } from "@visual-hive/core";
import { buildVisualHiveArtifactSummaryFromDirectory } from "./artifacts.js";
import { getGitHubAppEnvironmentReadiness } from "./env.js";
import { publishGitHubAppIssuesFromWebhookResult } from "./live.js";
import { handleVisualHiveGitHubAppWebhook, verifyGitHubWebhookSignature, type VisualHiveGitHubAppEventName, type VisualHiveGitHubAppWebhookResult } from "./webhook.js";

export interface VisualHiveGitHubAppServerOptions {
  port?: number;
  host?: string;
  outputDir?: string;
  env?: NodeJS.ProcessEnv;
}

export interface VisualHiveGitHubAppServer {
  server: http.Server;
  url: string;
  close(): Promise<void>;
}

export async function startVisualHiveGitHubAppServer(options: VisualHiveGitHubAppServerOptions = {}): Promise<VisualHiveGitHubAppServer> {
  const env = options.env ?? process.env;
  const outputDir = options.outputDir ?? ".visual-hive";
  const server = http.createServer((request, response) => {
    handleRequest(request, response, { env, outputDir }).catch((error) => {
      writeJsonResponse(response, 500, {
        error: "internal_error",
        message: sanitizeText(error instanceof Error ? error.message : String(error)),
        externalCallsMade: 0,
        networkCallsMade: 0,
        checkoutPerformed: false,
        repoCodeExecuted: false
      });
    });
  });
  const host = options.host ?? "127.0.0.1";
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, host, () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : options.port;
  return {
    server,
    url: `http://${host}:${port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

async function handleRequest(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  options: { env: NodeJS.ProcessEnv; outputDir: string }
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (request.method === "GET" && (url.pathname === "/healthz" || url.pathname === "/health")) {
    const readiness = getGitHubAppEnvironmentReadiness(options.env);
    writeJsonResponse(response, 200, {
      status: "ok",
      service: "visual-hive-github-app",
      mode: readiness.mode,
      readiness,
      externalCallsMade: 0,
      networkCallsMade: 0,
      checkoutPerformed: false,
      repoCodeExecuted: false
    });
    return;
  }

  if (request.method === "POST" && (url.pathname === "/webhooks/github" || url.pathname.startsWith("/mock/"))) {
    const body = await readRequestBody(request);
    const eventName = eventNameFor(request, url);
    if (!eventName) {
      writeJsonResponse(response, 400, { error: "unsupported_event", message: "Missing or unsupported GitHub event name." });
      return;
    }
    const signatureResult = signatureAllowed(options.env, body, request.headers["x-hub-signature-256"]);
    if (!signatureResult.allowed) {
      writeJsonResponse(response, 401, {
        error: "signature_required",
        message: signatureResult.reason,
        externalCallsMade: 0,
        networkCallsMade: 0,
        checkoutPerformed: false,
        repoCodeExecuted: false
      });
      return;
    }
    const payload = parseJsonBody(body);
    if (!payload) {
      writeJsonResponse(response, 400, { error: "invalid_json", message: "Webhook body must be JSON." });
      return;
    }
    const enrichment = await enrichPayloadWithLocalArtifacts(payload, options.env, url.pathname.startsWith("/mock/"));
    if (!enrichment.allowed) {
      writeJsonResponse(response, 403, {
        error: "local_artifact_root_blocked",
        message: enrichment.reason,
        externalCallsMade: 0,
        networkCallsMade: 0,
        checkoutPerformed: false,
        repoCodeExecuted: false
      });
      return;
    }
    const result = handleVisualHiveGitHubAppWebhook({
      eventName,
      payload: enrichment.payload,
      deliveryId: headerString(request.headers["x-github-delivery"])
    });
    await writeGitHubAppArtifacts(options.outputDir, result);
    const livePublish = await publishGitHubAppIssuesFromWebhookResult(result, { env: options.env });
    if (livePublish.mode === "live" || options.env.VISUAL_HIVE_GITHUB_APP_WRITE_BLOCKED_LIVE_RESULT === "true") {
      await writeJson(path.join(options.outputDir, "github-app-live-publish-result.json"), livePublish);
    }
    writeJsonResponse(response, 200, { ...result, livePublish });
    return;
  }

  writeJsonResponse(response, 404, { error: "not_found" });
}

async function enrichPayloadWithLocalArtifacts(
  payload: Record<string, unknown>,
  env: NodeJS.ProcessEnv,
  isMockEndpoint: boolean
): Promise<{ allowed: true; payload: Record<string, unknown> } | { allowed: false; reason: string }> {
  const artifactRoot = stringValue(payload.visual_hive_artifact_root)
    ?? stringValue(payload.local_artifact_root)
    ?? env.VISUAL_HIVE_GITHUB_APP_ARTIFACT_ROOT;
  if (!artifactRoot) return { allowed: true, payload };
  const allowed = isMockEndpoint || env.VISUAL_HIVE_GITHUB_APP_ALLOW_LOCAL_ARTIFACT_ROOT === "true";
  if (!allowed) {
    return { allowed: false, reason: "Refusing to read local Visual Hive artifacts without VISUAL_HIVE_GITHUB_APP_ALLOW_LOCAL_ARTIFACT_ROOT=true or a /mock endpoint." };
  }
  const repoRoot = stringValue(payload.repository_root) ?? env.VISUAL_HIVE_GITHUB_APP_REPO_ROOT;
  const summary = await buildVisualHiveArtifactSummaryFromDirectory({ artifactRoot, repoRoot });
  return {
    allowed: true,
    payload: {
      ...payload,
      visual_hive_artifact_summary: {
        ...summary,
        ...(objectValue(payload.visual_hive_artifact_summary) ?? {})
      }
    }
  };
}

export async function writeGitHubAppArtifacts(outputDir: string, result: VisualHiveGitHubAppWebhookResult): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  await writeJson(path.join(outputDir, "github-app-webhook-result.json"), result);
  const setup = result.actions.find((action) => action.action === "create_setup_issue")?.issuePayload;
  const issue = result.actions.find((action) => action.action === "create_or_update_visual_hive_issue")?.issuePayload;
  if (setup) await writeText(path.join(outputDir, "github-app-setup-issue-preview.md"), setup.body);
  if (issue) await writeText(path.join(outputDir, "github-app-issue-preview.md"), issue.body);
}

function eventNameFor(request: http.IncomingMessage, url: URL): VisualHiveGitHubAppEventName | undefined {
  const header = headerString(request.headers["x-github-event"]);
  if (isEventName(header)) return header;
  const mock = url.pathname.split("/").pop();
  if (mock === "installation") return "installation";
  if (mock === "workflow-run") return "workflow_run";
  if (mock === "issues") return "issues";
  return undefined;
}

function signatureAllowed(env: NodeJS.ProcessEnv, body: Buffer, signature: string | string[] | undefined): { allowed: boolean; reason: string } {
  const secret = env.GITHUB_WEBHOOK_SECRET;
  if (secret) {
    return verifyGitHubWebhookSignature(secret, body, headerString(signature))
      ? { allowed: true, reason: "signature_verified" }
      : { allowed: false, reason: "Invalid GitHub webhook signature." };
  }
  if (env.VISUAL_HIVE_GITHUB_APP_ALLOW_UNSIGNED_MOCKS === "true") {
    return { allowed: true, reason: "unsigned_mock_allowed" };
  }
  return { allowed: false, reason: "Unsigned GitHub App mock webhooks require VISUAL_HIVE_GITHUB_APP_ALLOW_UNSIGNED_MOCKS=true." };
}

function parseJsonBody(body: Buffer): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(body.toString("utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function readRequestBody(request: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))));
    request.on("error", reject);
    request.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

function writeJsonResponse(response: http.ServerResponse, statusCode: number, value: unknown): void {
  response.writeHead(statusCode, { "Content-Type": "application/json" });
  response.end(`${JSON.stringify(value)}\n`);
}

function headerString(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function isEventName(value: string | undefined): value is VisualHiveGitHubAppEventName {
  return value === "installation" || value === "repository" || value === "workflow_run" || value === "issues";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? "0") || 0;
  const outputDir = process.env.VISUAL_HIVE_GITHUB_APP_OUTPUT_DIR ?? ".visual-hive";
  startVisualHiveGitHubAppServer({ port, outputDir })
    .then((app) => {
      console.log(`Visual Hive GitHub App local server listening at ${app.url}`);
    })
    .catch((error) => {
      console.error(sanitizeText(error instanceof Error ? error.message : String(error)));
      process.exitCode = 1;
    });
}
