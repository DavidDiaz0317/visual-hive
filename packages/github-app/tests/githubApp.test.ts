import crypto from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertLeastPrivilegePermissions,
  buildVisualHiveArtifactSummaryFromDirectory,
  buildIssuePayloadFromArtifactSummary,
  buildSetupIssuePayload,
  createGitHubAppJwt,
  getGitHubAppEnvironmentReadiness,
  getVisualHiveGitHubAppPermissions,
  handleVisualHiveGitHubAppWebhook,
  publishGitHubAppIssuesFromWebhookResult,
  runGitHubAppMock,
  startVisualHiveGitHubAppServer,
  verifyGitHubWebhookSignature,
  type GitHubIssuePayload
} from "../src/index.js";

const issueCandidate = {
  issueKind: "mutation_survivor",
  severity: "high",
  status: "open_candidate",
  dedupeFingerprint: "visual-hive:mutation_survivor:force-login-on-demo",
  title: "[Visual Hive] Mutation survived: force-login-on-demo",
  labels: ["visual-hive", "mutation-survivor", "hive/quality"],
  body: "Failure context token=super-secret access_token=abc123 should be redacted.",
  owningAgentHint: "visual-hive/test-creator",
  sourceArtifacts: [".visual-hive/mutation-report.json", "C:/Users/david/OneDrive/Documents/visual-hive-demo-site/.visual-hive/artifacts/screenshots/login.png", "/home/david/private/token.txt"],
  affected: [{ route: "/", contractId: "hosted-demo-never-login", selector: "[data-testid='login-page']", viewport: "desktop" }],
  reproductionCommand: "visual-hive mutate",
  validationCommand: "visual-hive mutate --enforce-min-score",
  linkedEvidencePacket: ".visual-hive/evidence-packet.json",
  linkedRepoMap: ".visual-hive/repo-map.json",
  linkedMutationReport: ".visual-hive/mutation-report.json",
  linkedHandoff: ".visual-hive/handoff.json",
  linkedHiveExport: ".visual-hive/hive/hive-export.json",
  linkedKnowledgeGraph: ".visual-hive/hive/knowledge-graph.json",
  linkedAgentPacket: ".visual-hive/agent-packet.json",
  guardrails: ["Do not weaken thresholds.", "Do not approve baselines blindly."]
} as const;

describe("Visual Hive GitHub App prototype", () => {
  it("models least-privilege default permissions and flags elevated write permissions", () => {
    const permissions = getVisualHiveGitHubAppPermissions();
    expect(permissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "metadata", access: "read" }),
        expect.objectContaining({ name: "contents", access: "read" }),
        expect.objectContaining({ name: "actions", access: "read" }),
        expect.objectContaining({ name: "checks", access: "read" }),
        expect.objectContaining({ name: "issues", access: "write" }),
        expect.objectContaining({ name: "pull_requests", access: "none" }),
        expect.objectContaining({ name: "workflows", access: "none" })
      ])
    );
    expect(assertLeastPrivilegePermissions(permissions).passed).toBe(true);

    const elevated = getVisualHiveGitHubAppPermissions({ directContentWrites: true, directWorkflowWrites: true });
    const audit = assertLeastPrivilegePermissions(elevated);
    expect(audit.passed).toBe(false);
    expect(audit.findings.join("\n")).toContain("workflows:write");
    expect(audit.findings.join("\n")).toContain("contents:write");
  });

  it("verifies GitHub webhook signatures with timing-safe sha256 comparison", () => {
    const secret = "webhook-secret";
    const payload = JSON.stringify({ action: "created" });
    const signature = `sha256=${crypto.createHmac("sha256", secret).update(payload).digest("hex")}`;

    expect(verifyGitHubWebhookSignature(secret, payload, signature)).toBe(true);
    expect(verifyGitHubWebhookSignature(secret, payload, "sha256=bad")).toBe(false);
    expect(verifyGitHubWebhookSignature(secret, payload, undefined)).toBe(false);
  });

  it("reports GitHub App live readiness by env var name without leaking values", () => {
    const blocked = getGitHubAppEnvironmentReadiness({
      VISUAL_HIVE_GITHUB_APP_LIVE: "true",
      GITHUB_APP_ID: "12345",
      GITHUB_APP_PRIVATE_KEY: "super-secret-private-key"
    });
    expect(blocked.mode).toBe("live_guard_blocked");
    expect(blocked.missingForLive).toEqual(expect.arrayContaining(["GITHUB_APP_INSTALLATION_ID", "GITHUB_WEBHOOK_SECRET"]));
    expect(JSON.stringify(blocked)).not.toContain("super-secret-private-key");

    const ready = getGitHubAppEnvironmentReadiness({
      VISUAL_HIVE_GITHUB_APP_LIVE: "true",
      GITHUB_APP_ID: "12345",
      GITHUB_APP_PRIVATE_KEY_PATH: "/run/secrets/github-app.pem",
      GITHUB_APP_INSTALLATION_ID: "67890",
      GITHUB_WEBHOOK_SECRET: "webhook-secret"
    });
    expect(ready).toMatchObject({
      mode: "live_ready",
      privateKeySource: "GITHUB_APP_PRIVATE_KEY_PATH",
      missingForLive: [],
      externalCallsMade: 0,
      networkCallsMade: 0
    });
    expect(JSON.stringify(ready)).not.toContain("webhook-secret");
    expect(JSON.stringify(ready)).not.toContain("/run/secrets/github-app.pem");
  });

  it("creates setup issue actions from installation events without executing repo code", () => {
    const result = handleVisualHiveGitHubAppWebhook({
      eventName: "installation",
      deliveryId: "delivery-1",
      receivedAt: new Date("2026-07-05T12:00:00.000Z"),
      payload: {
        repositories: [{ full_name: "DavidDiaz0317/visual-hive-demo-site", default_branch: "main" }]
      }
    });

    expect(result.schemaVersion).toBe("visual-hive.github-app.webhook-result.v1");
    expect(result.externalCallsMade).toBe(0);
    expect(result.networkCallsMade).toBe(0);
    expect(result.checkoutPerformed).toBe(false);
    expect(result.repoCodeExecuted).toBe(false);
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]).toMatchObject({
      action: "create_setup_issue",
      repository: "DavidDiaz0317/visual-hive-demo-site"
    });
    expect(result.actions[0].issuePayload?.title).toBe("[Visual Hive] Setup visual QA");
    expect(result.actions[0].issuePayload?.labels).toContain("hive/quality");
    expect(result.actions[0].issuePayload?.body).toContain("pull_request");
  });

  it("maps trusted workflow artifact summaries to sanitized issue payloads", () => {
    const result = handleVisualHiveGitHubAppWebhook({
      eventName: "workflow_run",
      payload: {
        repository: { full_name: "DavidDiaz0317/visual-hive-demo-site" },
        workflow_run: { conclusion: "failure" },
        visual_hive_artifact_summary: {
          issueCandidate
        }
      }
    });

    expect(result.actions[0]).toMatchObject({
      action: "create_or_update_visual_hive_issue",
      repository: "DavidDiaz0317/visual-hive-demo-site"
    });
    const payload = result.actions[0].issuePayload as GitHubIssuePayload;
    expect(payload.dedupeFingerprint).toBe("visual-hive:mutation_survivor:force-login-on-demo");
    expect(payload.body).toContain("Validation command");
    expect(payload.body).toContain("visual-hive mutate --enforce-min-score");
    expect(payload.body).toContain("Dedupe fingerprint");
    expect(payload.body).toContain("[redacted-external-path]/login.png");
    expect(payload.body).toContain("[redacted-external-path]/token.txt");
    expect(payload.body).not.toContain("C:/Users/david");
    expect(payload.body).not.toContain("/home/david/private");
    expect(payload.body).not.toContain("super-secret");
    expect(payload.body).not.toContain("abc123");
    expect(payload.body).toContain("[REDACTED]");
  });

  it("blocks live GitHub App issue writes by default and reports env var names only", async () => {
    const result = handleVisualHiveGitHubAppWebhook({
      eventName: "workflow_run",
      payload: {
        repository: { full_name: "DavidDiaz0317/visual-hive-demo-site" },
        workflow_run: { conclusion: "failure" },
        visual_hive_artifact_summary: { issueCandidate }
      }
    });

    const publish = await publishGitHubAppIssuesFromWebhookResult(result, {
      env: {
        VISUAL_HIVE_GITHUB_APP_LIVE: "true",
        GITHUB_APP_ID: "12345",
        GITHUB_APP_PRIVATE_KEY: "super-secret-private-key"
      },
      fetchImpl: async () => {
        throw new Error("fetch should not be called while blocked");
      }
    });

    expect(publish.mode).toBe("blocked");
    expect(publish.networkCallsMade).toBe(0);
    expect(publish.missingForLive).toEqual(expect.arrayContaining([
      "GITHUB_APP_INSTALLATION_ID",
      "GITHUB_WEBHOOK_SECRET",
      "VISUAL_HIVE_GITHUB_APP_LIVE_ISSUE_WRITE"
    ]));
    expect(JSON.stringify(publish)).not.toContain("super-secret-private-key");
    expect(publish.results[0]).toMatchObject({ status: "blocked" });
  });

  it("creates a signed GitHub App JWT without embedding private key material", () => {
    const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const privateKeyPem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
    const jwt = createGitHubAppJwt({ appId: "12345", privateKey: privateKeyPem, nowSeconds: 1_700_000_000 });
    const [header, payload, signature] = jwt.split(".");
    expect(header).toBeTruthy();
    expect(payload).toBeTruthy();
    expect(signature).toBeTruthy();
    expect(JSON.stringify(jwt)).not.toContain("BEGIN RSA PRIVATE KEY");
  });

  it("uses guarded live GitHub App credentials to create a deduped issue with mocked fetch", async () => {
    const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const privateKeyPem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
    const result = handleVisualHiveGitHubAppWebhook({
      eventName: "workflow_run",
      payload: {
        repository: { full_name: "DavidDiaz0317/visual-hive-demo-site" },
        workflow_run: { conclusion: "failure" },
        visual_hive_artifact_summary: { issueCandidate }
      }
    });
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/access_tokens")) {
        return jsonResponse({ token: "installation-token-secret" });
      }
      if (String(url).includes("/issues?")) {
        return jsonResponse([]);
      }
      if (String(url).endsWith("/issues") && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { body: string };
        expect(body.body).toContain("Dedupe fingerprint");
        expect(body.body).not.toContain("super-secret");
        return jsonResponse({ number: 6, html_url: "https://github.com/DavidDiaz0317/visual-hive-demo-site/issues/6" });
      }
      throw new Error(`Unexpected fetch ${String(url)}`);
    };

    const publish = await publishGitHubAppIssuesFromWebhookResult(result, {
      env: {
        VISUAL_HIVE_GITHUB_APP_LIVE: "true",
        VISUAL_HIVE_GITHUB_APP_LIVE_ISSUE_WRITE: "true",
        GITHUB_APP_ID: "12345",
        GITHUB_APP_PRIVATE_KEY: privateKeyPem,
        GITHUB_APP_INSTALLATION_ID: "67890",
        GITHUB_WEBHOOK_SECRET: "webhook-secret"
      },
      fetchImpl
    });

    expect(publish.mode).toBe("live");
    expect(publish.externalCallsMade).toBe(3);
    expect(publish.networkCallsMade).toBe(3);
    expect(publish.results[0]).toMatchObject({ status: "created", issueNumber: 6 });
    expect(JSON.stringify(publish)).not.toContain("installation-token-secret");
    expect(calls.map((call) => call.url)).toEqual([
      "https://api.github.com/app/installations/67890/access_tokens",
      "https://api.github.com/repos/DavidDiaz0317/visual-hive-demo-site/issues?state=all&labels=visual-hive&per_page=100",
      "https://api.github.com/repos/DavidDiaz0317/visual-hive-demo-site/issues"
    ]);
  });

  it("does not leak private key paths when guarded live authentication preparation fails", async () => {
    const result = handleVisualHiveGitHubAppWebhook({
      eventName: "workflow_run",
      payload: {
        repository: { full_name: "DavidDiaz0317/visual-hive-demo-site" },
        visual_hive_artifact_summary: { issueCandidate }
      }
    });

    const publish = await publishGitHubAppIssuesFromWebhookResult(result, {
      env: {
        VISUAL_HIVE_GITHUB_APP_LIVE: "true",
        VISUAL_HIVE_GITHUB_APP_LIVE_ISSUE_WRITE: "true",
        GITHUB_APP_ID: "12345",
        GITHUB_APP_PRIVATE_KEY_PATH: "C:/Users/david/secret/private-key.pem",
        GITHUB_APP_INSTALLATION_ID: "67890",
        GITHUB_WEBHOOK_SECRET: "webhook-secret"
      },
      fetchImpl: async () => {
        throw new Error("fetch should not be called when auth preparation fails");
      }
    });

    expect(publish.results[0]).toMatchObject({ status: "failed" });
    expect(JSON.stringify(publish)).not.toContain("C:/Users/david");
    expect(JSON.stringify(publish)).not.toContain("private-key.pem");
    expect(publish.networkCallsMade).toBe(0);
  });

  it("updates an existing issue when the dedupe fingerprint is found", async () => {
    const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const privateKeyPem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
    const result = handleVisualHiveGitHubAppWebhook({
      eventName: "workflow_run",
      payload: {
        repository: { full_name: "DavidDiaz0317/visual-hive-demo-site" },
        visual_hive_artifact_summary: { issueCandidate }
      }
    });
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      if (String(url).endsWith("/access_tokens")) return jsonResponse({ token: "installation-token-secret" });
      if (String(url).includes("/issues?")) {
        return jsonResponse([{ number: 6, body: `existing ${issueCandidate.dedupeFingerprint}`, html_url: "https://example.test/6" }]);
      }
      if (String(url).endsWith("/issues/6") && init?.method === "PATCH") return jsonResponse({ number: 6, html_url: "https://example.test/6" });
      throw new Error(`Unexpected fetch ${String(url)}`);
    };

    const publish = await publishGitHubAppIssuesFromWebhookResult(result, {
      env: {
        VISUAL_HIVE_GITHUB_APP_LIVE: "true",
        VISUAL_HIVE_GITHUB_APP_LIVE_ISSUE_WRITE: "true",
        GITHUB_APP_ID: "12345",
        GITHUB_APP_PRIVATE_KEY: privateKeyPem,
        GITHUB_APP_INSTALLATION_ID: "67890",
        GITHUB_WEBHOOK_SECRET: "webhook-secret"
      },
      fetchImpl
    });

    expect(publish.results[0]).toMatchObject({ status: "updated", issueNumber: 6 });
  });

  it("builds setup and artifact issue payloads with explicit Visual Hive boundaries", () => {
    const setup = buildSetupIssuePayload({
      repository: { fullName: "DavidDiaz0317/visual-hive-demo-site" },
      detectedFrameworks: ["react", "vite"]
    });
    expect(setup.body).toContain("Visual Hive detects, proves, packages, and routes");
    expect(setup.body).toContain("does not repair code");

    const issue = buildIssuePayloadFromArtifactSummary({
      repository: { fullName: "DavidDiaz0317/visual-hive-demo-site" },
      candidate: issueCandidate
    });
    expect(issue.labels).toEqual(expect.arrayContaining(["visual-hive", "mutation-survivor", "hive/quality"]));
    expect(issue.body).toContain("Owning agent hint: visual-hive/test-creator");
    expect(issue.body).toContain("Do not approve baselines blindly.");
  });

  it("runs the local GitHub App server with health, signature, mock, and artifact outputs", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "visual-hive-github-app-"));
    const app = await startVisualHiveGitHubAppServer({
      outputDir,
      env: { VISUAL_HIVE_GITHUB_APP_ALLOW_UNSIGNED_MOCKS: "true" }
    });
    try {
      const health = await fetch(`${app.url}/healthz`);
      expect(health.status).toBe(200);
      expect(await health.json()).toMatchObject({
        status: "ok",
        mode: "mock_or_plan",
        readiness: { mode: "mock_or_plan", mockModeEnabled: true, liveModeRequested: false, externalCallsMade: 0 },
        externalCallsMade: 0,
        repoCodeExecuted: false
      });

      const healthAlias = await fetch(`${app.url}/health`);
      expect(healthAlias.status).toBe(200);
      expect(await healthAlias.json()).toMatchObject({ status: "ok", mode: "mock_or_plan", networkCallsMade: 0 });

      const payload = JSON.stringify({
        repositories: [{ full_name: "DavidDiaz0317/visual-hive-demo-site" }]
      });
      const response = await fetch(`${app.url}/mock/installation`, {
        method: "POST",
        body: payload,
        headers: { "Content-Type": "application/json" }
      });
      expect(response.status).toBe(200);
      const result = await response.json() as { actions: Array<{ action: string }> };
      expect(result.actions[0]?.action).toBe("create_setup_issue");
      expect(await readFile(path.join(outputDir, "github-app-webhook-result.json"), "utf8")).toContain("create_setup_issue");
      expect(await readFile(path.join(outputDir, "github-app-setup-issue-preview.md"), "utf8")).toContain("Setup Checklist");
    } finally {
      await app.close();
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it("rejects unsigned real webhooks unless mock mode is explicitly enabled", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "visual-hive-github-app-unsigned-"));
    const app = await startVisualHiveGitHubAppServer({ outputDir, env: {} });
    try {
      const response = await fetch(`${app.url}/webhooks/github`, {
        method: "POST",
        body: JSON.stringify({ repositories: [] }),
        headers: { "Content-Type": "application/json", "x-github-event": "installation" }
      });
      expect(response.status).toBe(401);
    } finally {
      await app.close();
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it("builds workflow_run issue actions from a downloaded Visual Hive artifact directory", async () => {
    const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-github-app-artifacts-"));
    const repoRoot = "C:/Users/david/OneDrive/Documents/visual-hive-demo-site";
    try {
      await writeMinimalVisualHiveArtifacts(artifactRoot, {
        issues: [
          {
            ...issueCandidate,
            body: "Artifact issue from C:/Users/david/OneDrive/Documents/visual-hive-demo-site/.visual-hive/report.json token=artifact-secret",
            sourceArtifacts: [
              "C:/Users/david/OneDrive/Documents/visual-hive-demo-site/.visual-hive/report.json",
              "/home/david/private/debug.log"
            ]
          }
        ]
      });
      const summary = await buildVisualHiveArtifactSummaryFromDirectory({ artifactRoot, repoRoot });
      expect(summary.externalCallsMade).toBe(0);
      expect(summary.networkCallsMade).toBe(0);
      expect(summary.checkoutPerformed).toBe(false);
      expect(summary.repoCodeExecuted).toBe(false);
      expect(summary.missingArtifacts).toEqual([]);
      expect(summary.discoveredArtifacts).toEqual(expect.arrayContaining([
        "[redacted-external-path]/issues.json",
        "[redacted-external-path]/evidence-packet.json"
      ]));

      const result = handleVisualHiveGitHubAppWebhook({
        eventName: "workflow_run",
        payload: {
          repository: { full_name: "DavidDiaz0317/visual-hive-demo-site" },
          workflow_run: { conclusion: "failure" },
          visual_hive_artifact_summary: summary
        }
      });
      const payload = result.actions[0]?.issuePayload as GitHubIssuePayload;
      expect(result.actions[0]?.action).toBe("create_or_update_visual_hive_issue");
      expect(payload.body).toContain("Validation command");
      expect(payload.body).toContain("[redacted-external-path]/report.json");
      expect(payload.body).toContain("[redacted-external-path]/debug.log");
      expect(payload.body).not.toContain("C:/Users/david");
      expect(payload.body).not.toContain("/home/david/private");
      expect(payload.body).not.toContain("artifact-secret");
    } finally {
      await rm(artifactRoot, { recursive: true, force: true });
    }
  });

  it("does not enter live mode unless explicit live guard and webhook authentication are configured", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "visual-hive-github-app-live-guard-"));
    const app = await startVisualHiveGitHubAppServer({
      outputDir,
      env: { VISUAL_HIVE_GITHUB_APP_LIVE: "true" }
    });
    try {
      const health = await fetch(`${app.url}/health`);
      const healthBody = await health.json();
      expect(healthBody).toMatchObject({
        mode: "live_guard_blocked",
        readiness: {
          mode: "live_guard_blocked",
          missingForLive: expect.arrayContaining([
            "GITHUB_APP_ID",
            "GITHUB_APP_PRIVATE_KEY or GITHUB_APP_PRIVATE_KEY_PATH",
            "GITHUB_APP_INSTALLATION_ID",
            "GITHUB_WEBHOOK_SECRET"
          ])
        },
        externalCallsMade: 0,
        repoCodeExecuted: false
      });
      expect(JSON.stringify(healthBody)).not.toContain("secret-value");
      const response = await fetch(`${app.url}/webhooks/github`, {
        method: "POST",
        body: JSON.stringify({ repositories: [] }),
        headers: { "Content-Type": "application/json", "x-github-event": "installation" }
      });
      expect(response.status).toBe(401);
      expect(await readFile(path.join(outputDir, "github-app-webhook-result.json"), "utf8").catch(() => "")).toBe("");
    } finally {
      await app.close();
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it("accepts signed webhook payloads and writes issue preview artifacts", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "visual-hive-github-app-signed-"));
    const secret = "signed-secret";
    const app = await startVisualHiveGitHubAppServer({ outputDir, env: { GITHUB_WEBHOOK_SECRET: secret } });
    try {
      const payload = JSON.stringify({
        repository: { full_name: "DavidDiaz0317/visual-hive-demo-site" },
        workflow_run: { conclusion: "failure" },
        visual_hive_artifact_summary: { issueCandidate }
      });
      const signature = `sha256=${crypto.createHmac("sha256", secret).update(payload).digest("hex")}`;
      const response = await fetch(`${app.url}/webhooks/github`, {
        method: "POST",
        body: payload,
        headers: { "Content-Type": "application/json", "x-github-event": "workflow_run", "x-hub-signature-256": signature }
      });
      expect(response.status).toBe(200);
      const result = await response.json() as { actions: Array<{ action: string }>; externalCallsMade: number };
      expect(result.externalCallsMade).toBe(0);
      expect(result.actions[0]?.action).toBe("create_or_update_visual_hive_issue");
      const issuePreview = await readFile(path.join(outputDir, "github-app-issue-preview.md"), "utf8");
      expect(issuePreview).toContain("Dedupe fingerprint");
      expect(issuePreview).not.toContain("C:/Users/david");
    } finally {
      await app.close();
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it("allows mock server workflow_run events to read an explicit local artifact root", async () => {
    const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-github-app-server-artifacts-"));
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "visual-hive-github-app-server-output-"));
    const app = await startVisualHiveGitHubAppServer({
      outputDir,
      env: { VISUAL_HIVE_GITHUB_APP_ALLOW_UNSIGNED_MOCKS: "true" }
    });
    try {
      await writeMinimalVisualHiveArtifacts(artifactRoot, { issues: [issueCandidate] });
      const response = await fetch(`${app.url}/mock/workflow-run`, {
        method: "POST",
        body: JSON.stringify({
          repository: { full_name: "DavidDiaz0317/visual-hive-demo-site" },
          workflow_run: { conclusion: "failure" },
          local_artifact_root: artifactRoot
        }),
        headers: { "Content-Type": "application/json" }
      });
      expect(response.status).toBe(200);
      const result = await response.json() as { actions: Array<{ action: string }>; externalCallsMade: number };
      expect(result.externalCallsMade).toBe(0);
      expect(result.actions[0]?.action).toBe("create_or_update_visual_hive_issue");
      const issuePreview = await readFile(path.join(outputDir, "github-app-issue-preview.md"), "utf8");
      expect(issuePreview).toContain("Dedupe fingerprint");
      expect(issuePreview).not.toContain(artifactRoot);
    } finally {
      await app.close();
      await rm(artifactRoot, { recursive: true, force: true });
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it("blocks local artifact root reads on real webhook paths unless explicitly allowed", async () => {
    const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-github-app-blocked-artifacts-"));
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "visual-hive-github-app-blocked-output-"));
    const secret = "signed-secret";
    const app = await startVisualHiveGitHubAppServer({ outputDir, env: { GITHUB_WEBHOOK_SECRET: secret } });
    try {
      await writeMinimalVisualHiveArtifacts(artifactRoot, { issues: [issueCandidate] });
      const payload = JSON.stringify({
        repository: { full_name: "DavidDiaz0317/visual-hive-demo-site" },
        workflow_run: { conclusion: "failure" },
        local_artifact_root: artifactRoot
      });
      const signature = `sha256=${crypto.createHmac("sha256", secret).update(payload).digest("hex")}`;
      const response = await fetch(`${app.url}/webhooks/github`, {
        method: "POST",
        body: payload,
        headers: { "Content-Type": "application/json", "x-github-event": "workflow_run", "x-hub-signature-256": signature }
      });
      expect(response.status).toBe(403);
      const body = await response.json() as { message: string };
      expect(body.message).toContain("VISUAL_HIVE_GITHUB_APP_ALLOW_LOCAL_ARTIFACT_ROOT=true");
      expect(body.message).not.toContain(artifactRoot);
    } finally {
      await app.close();
      await rm(artifactRoot, { recursive: true, force: true });
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it("runs a no-network mock webhook artifact writer", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "visual-hive-github-app-mock-"));
    const originalLog = console.log;
    console.log = () => undefined;
    try {
      await runGitHubAppMock({ eventName: "workflow_run", outputDir });
      expect(await readFile(path.join(outputDir, "github-app-webhook-result.json"), "utf8")).toContain("create_or_update_visual_hive_issue");
      expect(await readFile(path.join(outputDir, "github-app-issue-preview.md"), "utf8")).toContain("Mock sanitized issue body");
    } finally {
      console.log = originalLog;
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it("runs mock workflow_run from an artifact directory without network calls", async () => {
    const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-github-app-mock-artifacts-"));
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "visual-hive-github-app-mock-output-"));
    const originalLog = console.log;
    console.log = () => undefined;
    try {
      await writeMinimalVisualHiveArtifacts(artifactRoot, { issues: [issueCandidate] });
      await runGitHubAppMock({ eventName: "workflow_run", artifactRoot, outputDir });
      const result = await readFile(path.join(outputDir, "github-app-webhook-result.json"), "utf8");
      expect(result).toContain("create_or_update_visual_hive_issue");
      expect(result).not.toContain(artifactRoot);
      expect(await readFile(path.join(outputDir, "github-app-issue-preview.md"), "utf8")).toContain("Dedupe fingerprint");
    } finally {
      console.log = originalLog;
      await rm(artifactRoot, { recursive: true, force: true });
      await rm(outputDir, { recursive: true, force: true });
    }
  });
});

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

async function writeMinimalVisualHiveArtifacts(root: string, options: { issues: unknown[] }): Promise<void> {
  await mkdir(root, { recursive: true });
  const files: Record<string, unknown> = {
    "issues.json": { schemaVersion: "visual-hive.issues.v1", issues: options.issues },
    "issue-queue.json": { schemaVersion: "visual-hive.issue-queue.v1", queues: {} },
    "evidence-packet.json": { schemaVersion: "visual-hive.evidence-packet.v1", verdict: "failed" },
    "handoff.json": { schemaVersion: "visual-hive.handoff.v1", externalCallsMade: 0 },
    "visual-graph.json": { schemaVersion: "visual-hive.visual-graph.v1", nodes: [] },
    "visual-impact.json": { schemaVersion: "visual-hive.visual-impact.v1", impacts: [] },
    "mutation-report.json": { schemaVersion: 2, results: [] },
    "artifacts-index.json": { schemaVersion: "visual-hive.artifacts-index.v1", artifacts: [] }
  };
  await Promise.all(Object.entries(files).map(([file, value]) => writeFile(path.join(root, file), JSON.stringify(value, null, 2))));
}
