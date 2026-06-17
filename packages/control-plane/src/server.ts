import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { URL } from "node:url";
import {
  SetupProfileSchema,
  addConnection,
  applyCoverageImprovementRecommendation,
  approveBaseline,
  recommendSetup,
  rejectBaseline,
  removeConnection,
  sanitizeText,
  writeJson,
  type CoverageImprovementReport
} from "@visual-hive/core";
import { executeRunbookCommand, executeRunbookProfile } from "./commandExecutor.js";
import { saveConfigDraft, validateConfigDraft, writeRecommendedConfigFromSetup, writeRecommendedDocsFromSetup } from "./configEditor.js";
import { recordLLMDecision, type LLMDecision } from "./llmDecisions.js";
import { recordProviderDecision, type ProviderDecision } from "./providerDecisions.js";
import { createControlPlaneSnapshot, readControlPlaneArtifact, resolveControlPlaneOptions } from "./repoReader.js";
import { writeSetupBundleFromRecommendation } from "./setupBundle.js";
import { controlPlaneCss, controlPlaneHtml, controlPlaneJs } from "./uiAssets.js";
import type { ControlPlaneOptions, ResolvedControlPlaneOptions, StartedControlPlane } from "./types.js";
import { writeWorkflowTemplates } from "./workflowWriter.js";

export async function startControlPlaneServer(options: ControlPlaneOptions = {}): Promise<StartedControlPlane> {
  const server = http.createServer((request, response) => {
    void handleRequest(request, response, options);
  });
  const requestedPort = options.port ?? 4317;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(requestedPort, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : requestedPort;
  const url = `http://127.0.0.1:${port}`;
  if (options.open) {
    openBrowser(url);
  }
  return {
    url,
    port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      })
  };
}

async function handleRequest(request: IncomingMessage, response: ServerResponse, options: ControlPlaneOptions): Promise<void> {
  try {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/healthz") {
      if (request.method !== "GET") return methodNotAllowed(response);
      sendJson(response, { ok: true });
      return;
    }
    if (url.pathname === "/api/snapshot") {
      if (request.method !== "GET") return methodNotAllowed(response);
      sendJson(response, await createControlPlaneSnapshot(options, connectionIdFromUrl(url)));
      return;
    }
    if (url.pathname === "/api/file" || url.pathname === "/api/image") {
      if (request.method !== "GET") return methodNotAllowed(response);
      const artifactPath = url.searchParams.get("path");
      if (!artifactPath) {
        send(response, 400, "Missing path", "text/plain; charset=utf-8");
        return;
      }
      const artifact = await readControlPlaneArtifact(options, artifactPath, connectionIdFromUrl(url));
      send(response, 200, artifact.content, artifact.contentType);
      return;
    }
    if (url.pathname === "/api/baseline/approve") {
      if (request.method !== "POST") return methodNotAllowed(response);
      const resolved = await resolveRequestOptions(options, url);
      if (resolved.readOnly) {
        sendJson(response, { ok: false, error: "Control Plane is read-only. Restart without --read-only to approve baselines." }, 403);
        return;
      }
      const body = await readJsonBody(request);
      if (body.confirm !== true) {
        sendJson(response, { ok: false, error: "Baseline approval requires explicit confirmation after reviewing baseline, actual, diff, and artifact paths." }, 400);
        return;
      }
      const approval = await approveBaseline({
        repoRoot: resolved.repoRoot,
        reportPath: path.join(resolved.configRoot, ".visual-hive", "report.json"),
        contractId: requiredString(body.contractId, "contractId"),
        screenshotName: requiredString(body.screenshotName, "screenshotName"),
        viewport: optionalString(body.viewport),
        route: optionalString(body.route)
      });
      sendJson(response, { ok: true, approval });
      return;
    }
    if (url.pathname === "/api/baseline/reject") {
      if (request.method !== "POST") return methodNotAllowed(response);
      const resolved = await resolveRequestOptions(options, url);
      if (resolved.readOnly) {
        sendJson(response, { ok: false, error: "Control Plane is read-only. Restart without --read-only to reject baselines." }, 403);
        return;
      }
      const body = await readJsonBody(request);
      if (body.confirm !== true) {
        sendJson(response, { ok: false, error: "Baseline rejection requires explicit confirmation after reviewing baseline, actual, diff, and artifact paths." }, 400);
        return;
      }
      const rejection = await rejectBaseline({
        repoRoot: resolved.repoRoot,
        reportPath: path.join(resolved.configRoot, ".visual-hive", "report.json"),
        contractId: requiredString(body.contractId, "contractId"),
        screenshotName: requiredString(body.screenshotName, "screenshotName"),
        viewport: optionalString(body.viewport),
        route: optionalString(body.route),
        reason: optionalString(body.reason)
      });
      sendJson(response, { ok: true, rejection });
      return;
    }
    if (url.pathname === "/api/config/validate") {
      if (request.method !== "POST") return methodNotAllowed(response);
      const body = await readJsonBody(request);
      const result = await validateConfigDraft(await optionsForRequest(options, url), requiredString(body.content, "content"));
      sendJson(response, result, result.ok ? 200 : 422);
      return;
    }
    if (url.pathname === "/api/config/save") {
      if (request.method !== "POST") return methodNotAllowed(response);
      const body = await readJsonBody(request);
      const resolved = await resolveRequestOptions(options, url);
      if (resolved.readOnly) {
        sendJson(response, { ok: false, error: "Control Plane is read-only. Restart without --read-only to edit config." }, 403);
        return;
      }
      if (body.confirm !== true) {
        sendJson(response, { ok: false, error: "Config save requires explicit confirmation after reviewing the diff." }, 400);
        return;
      }
      const result = await saveConfigDraft(await optionsForRequest(options, url), requiredString(body.content, "content"), true);
      sendJson(response, result);
      return;
    }
    if (url.pathname === "/api/coverage/apply-recommendation") {
      if (request.method !== "POST") return methodNotAllowed(response);
      const body = await readJsonBody(request);
      const resolved = await resolveRequestOptions(options, url);
      if (body.confirm === true && resolved.readOnly) {
        sendJson(response, { ok: false, error: "Control Plane is read-only. Restart without --read-only to apply coverage recommendations." }, 403);
        return;
      }
      try {
        const recommendationId = requiredString(body.recommendationId, "recommendationId");
        const snapshot = await createControlPlaneSnapshot(options, connectionIdFromUrl(url));
        if (!snapshot.config) {
          sendJson(response, { ok: false, error: "A valid Visual Hive config is required before applying coverage recommendations." }, 400);
          return;
        }
        const recommendationPath = path.join(resolved.configRoot, ".visual-hive", "coverage-recommendations.json");
        const recommendationReport = await readCoverageImprovementReport(recommendationPath);
        const currentConfig = await readFile(resolved.configPath, "utf8");
        const applyResult = applyCoverageImprovementRecommendation(snapshot.config, recommendationReport, recommendationId, currentConfig);
        if (body.confirm !== true) {
          sendJson(response, {
            ok: true,
            saved: false,
            recommendationPath: ".visual-hive/coverage-recommendations.json",
            applyResult
          });
          return;
        }
        const saveResult = applyResult.applied
          ? await saveConfigDraft(await optionsForRequest(options, url), applyResult.configText, true)
          : undefined;
        sendJson(response, {
          ok: true,
          saved: Boolean(saveResult),
          recommendationPath: ".visual-hive/coverage-recommendations.json",
          applyResult,
          config: saveResult
        });
      } catch (error) {
        sendJson(response, { ok: false, error: sanitizeText(error instanceof Error ? error.message : String(error)) }, 400);
      }
      return;
    }
    if (url.pathname === "/api/setup/write-config") {
      if (request.method !== "POST") return methodNotAllowed(response);
      const body = await readJsonBody(request);
      const resolved = await resolveRequestOptions(options, url);
      if (resolved.readOnly) {
        sendJson(response, { ok: false, error: "Control Plane is read-only. Restart without --read-only to generate config." }, 403);
        return;
      }
      if (body.confirm !== true) {
        sendJson(response, { ok: false, error: "Recommended config write requires explicit confirmation after reviewing the generated YAML." }, 400);
        return;
      }
      try {
        const result = await writeRecommendedConfigFromSetup(await optionsForRequest(options, url), true, body.force === true);
        sendJson(response, result);
      } catch (error) {
        sendJson(response, { ok: false, error: sanitizeText(error instanceof Error ? error.message : String(error)) }, 400);
      }
      return;
    }
    if (url.pathname === "/api/setup/recommend") {
      if (request.method !== "POST") return methodNotAllowed(response);
      const body = await readJsonBody(request);
      const resolved = await resolveRequestOptions(options, url);
      if (resolved.readOnly) {
        sendJson(response, { ok: false, error: "Control Plane is read-only. Restart without --read-only to regenerate setup recommendations." }, 403);
        return;
      }
      const profile = SetupProfileSchema.safeParse(requiredString(body.profile, "profile"));
      if (!profile.success) {
        sendJson(response, { ok: false, error: `Invalid setup profile "${sanitizeText(String(body.profile))}". Expected one of: ${SetupProfileSchema.options.join(", ")}.` }, 400);
        return;
      }
      try {
        const report = await recommendSetup({
          repoRoot: resolved.repoRoot,
          configPath: resolved.configPath,
          setupProfile: profile.data
        });
        const reportPath = path.join(resolved.configRoot, ".visual-hive", "recommendations.json");
        await writeJson(reportPath, report);
        sendJson(response, {
          ok: true,
          profile: report.setupProfile,
          recommendationPath: ".visual-hive/recommendations.json",
          providerRecommendations: report.providerRecommendations.map((provider) => ({
            providerId: provider.providerId,
            recommendation: provider.recommendation,
            externalUploadAllowedByDefault: provider.externalUploadAllowedByDefault
          })),
          costEstimate: report.costEstimate
        });
      } catch (error) {
        sendJson(response, { ok: false, error: sanitizeText(error instanceof Error ? error.message : String(error)) }, 400);
      }
      return;
    }
    if (url.pathname === "/api/setup/write-docs") {
      if (request.method !== "POST") return methodNotAllowed(response);
      const body = await readJsonBody(request);
      const resolved = await resolveRequestOptions(options, url);
      if (resolved.readOnly) {
        sendJson(response, { ok: false, error: "Control Plane is read-only. Restart without --read-only to generate setup docs." }, 403);
        return;
      }
      if (body.confirm !== true) {
        sendJson(response, { ok: false, error: "Recommended docs write requires explicit confirmation after reviewing the generated docs." }, 400);
        return;
      }
      try {
        const result = await writeRecommendedDocsFromSetup(await optionsForRequest(options, url), true, body.force === true);
        sendJson(response, result);
      } catch (error) {
        sendJson(response, { ok: false, error: sanitizeText(error instanceof Error ? error.message : String(error)) }, 400);
      }
      return;
    }
    if (url.pathname === "/api/setup/write-bundle") {
      if (request.method !== "POST") return methodNotAllowed(response);
      const body = await readJsonBody(request);
      const resolved = await resolveRequestOptions(options, url);
      if (resolved.readOnly) {
        sendJson(response, { ok: false, error: "Control Plane is read-only. Restart without --read-only to generate a setup bundle." }, 403);
        return;
      }
      if (body.confirm !== true) {
        sendJson(response, { ok: false, error: "Setup bundle generation requires explicit confirmation after reviewing the recommendation and workflow snippets." }, 400);
        return;
      }
      try {
        const result = await writeSetupBundleFromRecommendation(await optionsForRequest(options, url), { confirm: true, force: body.force === true });
        sendJson(response, result);
      } catch (error) {
        sendJson(response, { ok: false, error: sanitizeText(error instanceof Error ? error.message : String(error)) }, 400);
      }
      return;
    }
    if (url.pathname === "/api/workflows/write-templates") {
      if (request.method !== "POST") return methodNotAllowed(response);
      const body = await readJsonBody(request);
      const resolved = await resolveRequestOptions(options, url);
      if (resolved.readOnly) {
        sendJson(response, { ok: false, error: "Control Plane is read-only. Restart without --read-only to write workflow templates." }, 403);
        return;
      }
      if (body.confirm !== true) {
        sendJson(response, { ok: false, error: "Workflow template writes require explicit confirmation after reviewing the templates." }, 400);
        return;
      }
      try {
        const result = await writeWorkflowTemplates(await optionsForRequest(options, url), {
          confirm: true,
          force: body.force === true,
          templateIds: optionalStringArray(body.templateIds)
        });
        sendJson(response, result);
      } catch (error) {
        sendJson(response, { ok: false, error: sanitizeText(error instanceof Error ? error.message : String(error)) }, 400);
      }
      return;
    }
    if (url.pathname === "/api/providers/decision") {
      if (request.method !== "POST") return methodNotAllowed(response);
      const body = await readJsonBody(request);
      const resolved = await resolveRequestOptions(options, url);
      if (resolved.readOnly) {
        sendJson(response, { ok: false, error: "Control Plane is read-only. Restart without --read-only to record provider decisions." }, 403);
        return;
      }
      if (body.confirm !== true) {
        sendJson(response, { ok: false, error: "Provider decision recording requires explicit confirmation. No provider calls were made." }, 400);
        return;
      }
      const providerId = requiredString(body.providerId, "providerId");
      const decision = requiredString(body.decision, "decision") as ProviderDecision;
      const snapshot = await createControlPlaneSnapshot(options, connectionIdFromUrl(url));
      const provider = snapshot.providers.find((candidate) => candidate.id === providerId);
      if (!provider) {
        sendJson(response, { ok: false, error: `Unknown provider "${sanitizeText(providerId)}".` }, 404);
        return;
      }
      try {
        const result = await recordProviderDecision(path.join(resolved.configRoot, ".visual-hive", "provider-decisions.json"), {
          providerId,
          label: provider.label,
          decision,
          reason: optionalString(body.reason),
          source: "control-plane"
        });
        sendJson(response, result);
      } catch (error) {
        sendJson(response, { ok: false, error: sanitizeText(error instanceof Error ? error.message : String(error)) }, 400);
      }
      return;
    }
    if (url.pathname === "/api/llm/decision") {
      if (request.method !== "POST") return methodNotAllowed(response);
      const body = await readJsonBody(request);
      const resolved = await resolveRequestOptions(options, url);
      if (resolved.readOnly) {
        sendJson(response, { ok: false, error: "Control Plane is read-only. Restart without --read-only to record LLM decisions." }, 403);
        return;
      }
      if (body.confirm !== true) {
        sendJson(response, { ok: false, error: "LLM decision recording requires explicit confirmation. No model calls were made." }, 400);
        return;
      }
      try {
        const result = await recordLLMDecision(path.join(resolved.configRoot, ".visual-hive", "llm-decisions.json"), {
          decision: requiredString(body.decision, "decision") as LLMDecision,
          reason: optionalString(body.reason),
          source: "control-plane"
        });
        sendJson(response, result);
      } catch (error) {
        sendJson(response, { ok: false, error: sanitizeText(error instanceof Error ? error.message : String(error)) }, 400);
      }
      return;
    }
    if (url.pathname === "/api/runbook/execute") {
      if (request.method !== "POST") return methodNotAllowed(response);
      const body = await readJsonBody(request);
      const commandId = requiredString(body.commandId, "commandId");
      const snapshot = await createControlPlaneSnapshot(options, connectionIdFromUrl(url));
      const command = snapshot.runbook.commands.find((candidate) => candidate.id === commandId);
      if (!command) {
        sendJson(response, { ok: false, error: `Unknown runbook command "${sanitizeText(commandId)}".` }, 404);
        return;
      }
      const execution = await executeRunbookCommand({
        options,
        resolved: {
          repoRoot: snapshot.repoRoot,
          configPath: snapshot.configPath,
          configRoot: snapshot.configRoot,
          readOnly: snapshot.readOnly,
          demo: snapshot.demo,
          activeConnectionId: snapshot.activeConnectionId
        },
        command
      });
      sendJson(response, { ok: execution.status !== "blocked", execution }, execution.status === "blocked" ? 403 : 200);
      return;
    }
    if (url.pathname === "/api/runbook/profile") {
      if (request.method !== "POST") return methodNotAllowed(response);
      const body = await readJsonBody(request);
      const profileId = requiredString(body.profileId, "profileId");
      const snapshot = await createControlPlaneSnapshot(options, connectionIdFromUrl(url));
      const profile = snapshot.runProfiles.find((candidate) => candidate.id === profileId);
      if (!profile) {
        sendJson(response, { ok: false, error: `Unknown run profile "${sanitizeText(profileId)}".` }, 404);
        return;
      }
      const execution = await executeRunbookProfile({
        options,
        resolved: {
          repoRoot: snapshot.repoRoot,
          configPath: snapshot.configPath,
          configRoot: snapshot.configRoot,
          readOnly: snapshot.readOnly,
          demo: snapshot.demo,
          activeConnectionId: snapshot.activeConnectionId
        },
        profile,
        commands: snapshot.runbook.commands
      });
      sendJson(response, { ok: execution.status !== "blocked", execution }, execution.status === "blocked" ? 403 : 200);
      return;
    }
    if (url.pathname === "/api/connections/add") {
      if (request.method !== "POST") return methodNotAllowed(response);
      const resolved = resolveControlPlaneOptions(options);
      if (resolved.readOnly) {
        sendJson(response, { ok: false, error: "Control Plane is read-only. Restart without --read-only to add connections." }, 403);
        return;
      }
      const body = await readJsonBody(request);
      const index = await addConnection({
        repoRoot: resolved.repoRoot,
        repoPath: requiredString(body.repoPath, "repoPath"),
        configPath: optionalString(body.configPath),
        id: optionalString(body.id),
        label: optionalString(body.label),
        tags: optionalStringArray(body.tags)
      });
      sendJson(response, { ok: true, index });
      return;
    }
    if (url.pathname === "/api/connections/remove") {
      if (request.method !== "POST") return methodNotAllowed(response);
      const resolved = resolveControlPlaneOptions(options);
      if (resolved.readOnly) {
        sendJson(response, { ok: false, error: "Control Plane is read-only. Restart without --read-only to remove connections." }, 403);
        return;
      }
      const body = await readJsonBody(request);
      const index = await removeConnection({
        repoRoot: resolved.repoRoot,
        id: requiredString(body.id, "id")
      });
      sendJson(response, { ok: true, index });
      return;
    }
    if (url.pathname === "/assets/app.js") {
      if (request.method !== "GET") return methodNotAllowed(response);
      send(response, 200, controlPlaneJs, "text/javascript; charset=utf-8");
      return;
    }
    if (url.pathname === "/assets/styles.css") {
      if (request.method !== "GET") return methodNotAllowed(response);
      send(response, 200, controlPlaneCss, "text/css; charset=utf-8");
      return;
    }
    if (url.pathname === "/") {
      if (request.method !== "GET") return methodNotAllowed(response);
      send(response, 200, controlPlaneHtml, "text/html; charset=utf-8");
      return;
    }
    send(response, 404, "Not found", "text/plain; charset=utf-8");
  } catch (error) {
    const message = sanitizeText(error instanceof Error ? error.message : String(error));
    send(response, 500, message, "text/plain; charset=utf-8");
  }
}

function connectionIdFromUrl(url: URL): string | undefined {
  const value = url.searchParams.get("connection");
  return value && value !== "current" ? value : undefined;
}

async function resolveRequestOptions(options: ControlPlaneOptions, url: URL): Promise<ResolvedControlPlaneOptions> {
  const connection = connectionIdFromUrl(url);
  if (!connection) return resolveControlPlaneOptions(options);
  const snapshot = await createControlPlaneSnapshot(options, connection);
  return {
    repoRoot: snapshot.repoRoot,
    configPath: snapshot.configPath,
    configRoot: snapshot.configRoot,
    readOnly: snapshot.readOnly,
    demo: snapshot.demo,
    activeConnectionId: snapshot.activeConnectionId
  };
}

async function optionsForRequest(options: ControlPlaneOptions, url: URL): Promise<ControlPlaneOptions> {
  const resolved = await resolveRequestOptions(options, url);
  return {
    ...options,
    repo: resolved.repoRoot,
    config: resolved.configPath,
    readOnly: resolved.readOnly,
    demo: false
  };
}

async function readCoverageImprovementReport(filePath: string): Promise<CoverageImprovementReport> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    throw new Error(`Missing coverage recommendation artifact. Run "visual-hive improve-coverage" first. Details: ${sanitizeText(error instanceof Error ? error.message : String(error))}`);
  }
  try {
    const parsed = JSON.parse(raw) as CoverageImprovementReport;
    if (!parsed || parsed.schemaVersion !== 1 || !Array.isArray(parsed.recommendations)) {
      throw new Error("schemaVersion or recommendations array is invalid");
    }
    return parsed;
  } catch (error) {
    throw new Error(`Invalid coverage recommendation artifact. Re-run "visual-hive improve-coverage". Details: ${sanitizeText(error instanceof Error ? error.message : String(error))}`);
  }
}

function sendJson(response: ServerResponse, value: unknown, status = 200): void {
  send(response, status, JSON.stringify(value, null, 2), "application/json; charset=utf-8");
}

function send(response: ServerResponse, status: number, body: string | Buffer, contentType: string): void {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff"
  });
  response.end(body);
}

function methodNotAllowed(response: ServerResponse): void {
  send(response, 405, "Method not allowed", "text/plain; charset=utf-8");
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > 1024 * 1024) {
      throw new Error("Request body is too large");
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected a JSON object request body");
  }
  return parsed as Record<string, unknown>;
}

function requiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing required field "${fieldName}"`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function optionalStringArray(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return undefined;
}

function openBrowser(url: string): void {
  const platform = process.platform;
  if (platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    return;
  }
  if (platform === "darwin") {
    spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
}
