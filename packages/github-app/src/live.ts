import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { sanitizeText } from "@visual-hive/core";
import { getGitHubAppEnvironmentReadiness } from "./env.js";
import type { GitHubIssuePayload } from "./payloads.js";
import type { VisualHiveGitHubAppWebhookResult } from "./webhook.js";

export interface GitHubAppLivePublishOptions {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  apiBaseUrl?: string;
}

export interface GitHubAppIssuePublishResult {
  repository: string;
  title: string;
  status: "created" | "updated" | "skipped" | "blocked" | "failed";
  issueNumber?: number;
  issueUrl?: string;
  dedupeFingerprint?: string;
  message: string;
}

export interface GitHubAppLivePublishResult {
  schemaVersion: "visual-hive.github-app.live-publish-result.v1";
  generatedAt: string;
  mode: "blocked" | "dry_run" | "live";
  externalCallsMade: number;
  networkCallsMade: number;
  checkoutPerformed: false;
  repoCodeExecuted: false;
  results: GitHubAppIssuePublishResult[];
  missingForLive: string[];
}

interface InstallationTokenResponse {
  token?: string;
}

interface GitHubIssueResponse {
  number?: number;
  html_url?: string;
  body?: string;
  title?: string;
}

interface GitHubContentResponse {
  type?: string;
  content?: string;
  encoding?: string;
}

interface ProtectedLifecycleCheck {
  owner: "visual-hive" | "hive" | "blocked";
  networkCallsMade: number;
  message: string;
}

export async function publishGitHubAppIssuesFromWebhookResult(
  webhookResult: VisualHiveGitHubAppWebhookResult,
  options: GitHubAppLivePublishOptions = {}
): Promise<GitHubAppLivePublishResult> {
  const env = options.env ?? process.env;
  const readiness = getGitHubAppEnvironmentReadiness(env);
  const writeGuardEnabled = env.VISUAL_HIVE_GITHUB_APP_LIVE_ISSUE_WRITE === "true";
  const issueActions = webhookResult.actions.filter((action) => action.issuePayload && action.repository);
  const blocked = readiness.mode !== "live_ready" || !writeGuardEnabled;
  if (blocked) {
    return {
      schemaVersion: "visual-hive.github-app.live-publish-result.v1",
      generatedAt: new Date().toISOString(),
      mode: "blocked",
      externalCallsMade: 0,
      networkCallsMade: 0,
      checkoutPerformed: false,
      repoCodeExecuted: false,
      missingForLive: [
        ...readiness.missingForLive,
        ...(writeGuardEnabled ? [] : ["VISUAL_HIVE_GITHUB_APP_LIVE_ISSUE_WRITE"])
      ],
      results: issueActions.map((action) => ({
        repository: action.repository ?? "unknown",
        title: action.issuePayload?.title ?? "unknown",
        status: "blocked",
        dedupeFingerprint: action.issuePayload?.dedupeFingerprint,
        message: "Live issue publishing is blocked until GitHub App live credentials and VISUAL_HIVE_GITHUB_APP_LIVE_ISSUE_WRITE=true are configured."
      }))
    };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const apiBaseUrl = (options.apiBaseUrl ?? "https://api.github.com").replace(/\/$/, "");
  let jwt: string;
  try {
    const privateKey = await loadPrivateKey(env);
    jwt = createGitHubAppJwt({
      appId: requireEnv(env, "GITHUB_APP_ID"),
      privateKey
    });
  } catch {
    return failedResult(issueActions, 0, "Failed to prepare GitHub App authentication. Check configured GitHub App credential environment variables.");
  }
  let networkCallsMade = 0;
  let tokenResponse: Response;
  try {
    tokenResponse = await fetchImpl(`${apiBaseUrl}/app/installations/${encodeURIComponent(requireEnv(env, "GITHUB_APP_INSTALLATION_ID"))}/access_tokens`, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${jwt}`,
        "X-GitHub-Api-Version": "2022-11-28"
      }
    });
    networkCallsMade += 1;
  } catch {
    return failedResult(issueActions, networkCallsMade, "Failed to reach GitHub installation-token endpoint.");
  }
  if (!tokenResponse.ok) {
    return failedResult(issueActions, networkCallsMade, `Failed to create installation token: HTTP ${tokenResponse.status}`);
  }
  const tokenBody = await tokenResponse.json() as InstallationTokenResponse;
  if (!tokenBody.token) {
    return failedResult(issueActions, networkCallsMade, "Failed to create installation token: response did not include token.");
  }

  const results: GitHubAppIssuePublishResult[] = [];
  for (const action of issueActions) {
    const payload = action.issuePayload;
    const repository = action.repository;
    if (!payload || !repository) continue;
    const lifecycle = await verifyProtectedLifecycleOwner({
      fetchImpl,
      apiBaseUrl,
      token: tokenBody.token,
      repository
    });
    networkCallsMade += lifecycle.networkCallsMade;
    if (lifecycle.owner !== "visual-hive") {
      results.push({
        repository,
        title: payload.title,
        status: lifecycle.owner === "hive" ? "skipped" : "blocked",
        dedupeFingerprint: payload.dedupeFingerprint,
        message: lifecycle.message
      });
      continue;
    }
    const publish = await createOrUpdateIssue({
      fetchImpl,
      apiBaseUrl,
      token: tokenBody.token,
      repository,
      payload
    });
    networkCallsMade += publish.networkCallsMade;
    results.push(publish.result);
  }

  return {
    schemaVersion: "visual-hive.github-app.live-publish-result.v1",
    generatedAt: new Date().toISOString(),
    mode: "live",
    externalCallsMade: networkCallsMade,
    networkCallsMade,
    checkoutPerformed: false,
    repoCodeExecuted: false,
    missingForLive: [],
    results
  };
}

async function verifyProtectedLifecycleOwner(input: {
  fetchImpl: typeof fetch;
  apiBaseUrl: string;
  token: string;
  repository: string;
}): Promise<ProtectedLifecycleCheck> {
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${input.token}`,
    "X-GitHub-Api-Version": "2022-11-28"
  };
  let response: Response;
  try {
    response = await input.fetchImpl(
      `${input.apiBaseUrl}/repos/${input.repository}/contents/.hive/integrated.json`,
      { headers }
    );
  } catch {
    return {
      owner: "blocked",
      networkCallsMade: 1,
      message: "Refusing GitHub App issue publication because protected Hive lifecycle ownership could not be verified."
    };
  }
  if (response.status === 404) {
    return {
      owner: "visual-hive",
      networkCallsMade: 1,
      message: "No protected Hive installation marker exists; standalone Visual Hive lifecycle ownership remains active."
    };
  }
  if (!response.ok) {
    return {
      owner: "blocked",
      networkCallsMade: 1,
      message: `Refusing GitHub App issue publication because protected Hive lifecycle ownership returned HTTP ${response.status}.`
    };
  }

  let file: GitHubContentResponse;
  try {
    file = await response.json() as GitHubContentResponse;
  } catch {
    return {
      owner: "blocked",
      networkCallsMade: 1,
      message: "Refusing GitHub App issue publication because protected Hive lifecycle ownership was not valid JSON."
    };
  }
  if (file.type !== "file" || file.encoding !== "base64" || typeof file.content !== "string") {
    return {
      owner: "blocked",
      networkCallsMade: 1,
      message: "Refusing GitHub App issue publication because .hive/integrated.json is not a protected regular file."
    };
  }

  let marker: unknown;
  try {
    marker = JSON.parse(Buffer.from(file.content.replace(/\s/g, ""), "base64").toString("utf8")) as unknown;
  } catch {
    return {
      owner: "blocked",
      networkCallsMade: 1,
      message: "Refusing GitHub App issue publication because protected .hive/integrated.json is invalid."
    };
  }
  if (!marker || typeof marker !== "object" || Array.isArray(marker)) {
    return {
      owner: "blocked",
      networkCallsMade: 1,
      message: "Refusing GitHub App issue publication because protected .hive/integrated.json is malformed."
    };
  }
  const record = marker as Record<string, unknown>;
  if (record.visual_hive !== true) {
    return {
      owner: "blocked",
      networkCallsMade: 1,
      message: "Refusing GitHub App issue publication because a protected Hive marker cannot grant standalone lifecycle ownership. Remove it through the audited Hive uninstall path."
    };
  }
  if (typeof record.repository !== "string" || record.repository.toLowerCase() !== input.repository.toLowerCase()) {
    return {
      owner: "blocked",
      networkCallsMade: 1,
      message: "Refusing GitHub App issue publication because protected Hive repository identity does not match this repository."
    };
  }
  return {
    owner: "hive",
    networkCallsMade: 1,
    message: "managed_by_hive: protected default-branch installation state assigns lifecycle writes to Hive."
  };
}

export function createGitHubAppJwt(input: { appId: string; privateKey: string; nowSeconds?: number }): string {
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const header = base64UrlJson({ alg: "RS256", typ: "JWT" });
  const payload = base64UrlJson({
    iat: now - 60,
    exp: now + 9 * 60,
    iss: input.appId
  });
  const body = `${header}.${payload}`;
  const signature = crypto.createSign("RSA-SHA256").update(body).sign(input.privateKey);
  return `${body}.${base64Url(signature)}`;
}

async function createOrUpdateIssue(input: {
  fetchImpl: typeof fetch;
  apiBaseUrl: string;
  token: string;
  repository: string;
  payload: GitHubIssuePayload;
}): Promise<{ networkCallsMade: number; result: GitHubAppIssuePublishResult }> {
  let networkCallsMade = 0;
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${input.token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json"
  };
  const searchUrl = `${input.apiBaseUrl}/repos/${input.repository}/issues?state=all&labels=${encodeURIComponent("visual-hive")}&per_page=100`;
  const issuesResponse = await input.fetchImpl(searchUrl, { headers });
  networkCallsMade += 1;
  if (!issuesResponse.ok) {
    return {
      networkCallsMade,
      result: {
        repository: input.repository,
        title: input.payload.title,
        status: "failed",
        dedupeFingerprint: input.payload.dedupeFingerprint,
        message: `Failed to search existing issues: HTTP ${issuesResponse.status}`
      }
    };
  }
  const issues = await issuesResponse.json() as GitHubIssueResponse[];
  const existing = Array.isArray(issues) ? issues.find((issue) =>
    input.payload.dedupeFingerprint
      ? issue.body?.includes(input.payload.dedupeFingerprint)
      : issue.title === input.payload.title
  ) : undefined;

  if (existing?.number) {
    const updateResponse = await input.fetchImpl(`${input.apiBaseUrl}/repos/${input.repository}/issues/${existing.number}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        title: input.payload.title,
        body: input.payload.body,
        labels: input.payload.labels
      })
    });
    networkCallsMade += 1;
    if (!updateResponse.ok) {
      return {
        networkCallsMade,
        result: {
          repository: input.repository,
          title: input.payload.title,
          status: "failed",
          issueNumber: existing.number,
          dedupeFingerprint: input.payload.dedupeFingerprint,
          message: `Failed to update existing issue: HTTP ${updateResponse.status}`
        }
      };
    }
    const updated = await updateResponse.json() as GitHubIssueResponse;
    return {
      networkCallsMade,
      result: {
        repository: input.repository,
        title: input.payload.title,
        status: "updated",
        issueNumber: updated.number ?? existing.number,
        issueUrl: sanitizeText(updated.html_url ?? existing.html_url ?? ""),
        dedupeFingerprint: input.payload.dedupeFingerprint,
        message: "Updated existing Visual Hive issue by dedupe fingerprint."
      }
    };
  }

  const createResponse = await input.fetchImpl(`${input.apiBaseUrl}/repos/${input.repository}/issues`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      title: input.payload.title,
      body: input.payload.body,
      labels: input.payload.labels
    })
  });
  networkCallsMade += 1;
  if (!createResponse.ok) {
    return {
      networkCallsMade,
      result: {
        repository: input.repository,
        title: input.payload.title,
        status: "failed",
        dedupeFingerprint: input.payload.dedupeFingerprint,
        message: `Failed to create issue: HTTP ${createResponse.status}`
      }
    };
  }
  const created = await createResponse.json() as GitHubIssueResponse;
  return {
    networkCallsMade,
    result: {
      repository: input.repository,
      title: input.payload.title,
      status: "created",
      issueNumber: created.number,
      issueUrl: sanitizeText(created.html_url ?? ""),
      dedupeFingerprint: input.payload.dedupeFingerprint,
      message: "Created new Visual Hive issue."
    }
  };
}

async function loadPrivateKey(env: NodeJS.ProcessEnv): Promise<string> {
  if (env.GITHUB_APP_PRIVATE_KEY?.trim()) return env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, "\n");
  if (env.GITHUB_APP_PRIVATE_KEY_PATH?.trim()) return readFile(env.GITHUB_APP_PRIVATE_KEY_PATH, "utf8");
  throw new Error("Missing GITHUB_APP_PRIVATE_KEY or GITHUB_APP_PRIVATE_KEY_PATH.");
}

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

function failedResult(
  actions: VisualHiveGitHubAppWebhookResult["actions"],
  networkCallsMade: number,
  message: string
): GitHubAppLivePublishResult {
  return {
    schemaVersion: "visual-hive.github-app.live-publish-result.v1",
    generatedAt: new Date().toISOString(),
    mode: "live",
    externalCallsMade: networkCallsMade,
    networkCallsMade,
    checkoutPerformed: false,
    repoCodeExecuted: false,
    missingForLive: [],
    results: actions.filter((action) => action.issuePayload && action.repository).map((action) => ({
      repository: action.repository ?? "unknown",
      title: action.issuePayload?.title ?? "unknown",
      status: "failed",
      dedupeFingerprint: action.issuePayload?.dedupeFingerprint,
      message: sanitizeText(message)
    }))
  };
}

function base64UrlJson(value: unknown): string {
  return base64Url(Buffer.from(JSON.stringify(value), "utf8"));
}

function base64Url(value: Buffer): string {
  return value.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
