#!/usr/bin/env node
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startVisualHiveGitHubAppServer } from "../packages/github-app/dist/index.js";

const outputDir = await mkdtemp(path.join(os.tmpdir(), "visual-hive-github-app-server-smoke-"));
const app = await startVisualHiveGitHubAppServer({
  outputDir,
  env: {
    VISUAL_HIVE_GITHUB_APP_ALLOW_UNSIGNED_MOCKS: "true"
  }
});

try {
  const health = await fetch(`${app.url}/health`);
  assert(health.status === 200, `Expected /health status 200, got ${health.status}.`);
  const healthBody = await health.json();
  assert(healthBody.status === "ok", "GitHub App health response must be ok.");
  assert(healthBody.mode === "mock_or_plan", `Expected mock_or_plan mode, got ${healthBody.mode}.`);
  assert(healthBody.externalCallsMade === 0, "GitHub App health must make zero external calls.");
  assert(healthBody.networkCallsMade === 0, "GitHub App health must make zero network calls.");
  assert(healthBody.repoCodeExecuted === false, "GitHub App health must not execute repo code.");

  const installResponse = await fetch(`${app.url}/mock/installation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      repositories: [{ full_name: "DavidDiaz0317/visual-hive-demo-site", default_branch: "main" }]
    })
  });
  assert(installResponse.status === 200, `Expected mock installation status 200, got ${installResponse.status}.`);
  const installResult = await installResponse.json();
  assert(installResult.externalCallsMade === 0, "Mock installation must make zero external calls.");
  assert(installResult.networkCallsMade === 0, "Mock installation must make zero network calls.");
  assert(installResult.checkoutPerformed === false, "Mock installation must not check out code.");
  assert(installResult.repoCodeExecuted === false, "Mock installation must not execute repo code.");
  assert(installResult.actions?.[0]?.action === "create_setup_issue", "Mock installation must plan a setup issue.");

  const setupIssue = await readFile(path.join(outputDir, "github-app-setup-issue-preview.md"), "utf8");
  assert(setupIssue.includes("Setup Checklist"), "Setup issue preview must include a setup checklist.");
  assert(setupIssue.includes("does not repair code"), "Setup issue preview must include Visual Hive safety boundary.");
  assertNoPathLeaks(setupIssue);

  const unsignedResponse = await fetch(`${app.url}/webhooks/github`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-github-event": "issues" },
    body: JSON.stringify({
      repository: { full_name: "DavidDiaz0317/visual-hive-demo-site" },
      issue: { title: "Unsigned should be allowed only because mock mode is explicit" }
    })
  });
  assert(unsignedResponse.status === 200, "Explicit unsigned mock guard must allow local unsigned smoke webhook.");

  console.log(`Visual Hive GitHub App server smoke passed at ${app.url}`);
} finally {
  await app.close();
  await rm(outputDir, { recursive: true, force: true });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertNoPathLeaks(text) {
  const forbidden = [
    /C:\\Users/i,
    /C:\/Users/i,
    /[A-Z]:[\\/][^\r\n"'<>]*OneDrive[^\r\n"'<>]*/i,
    /\/Users\//,
    /\/home\//,
    /[A-Z]:\\/i
  ];
  for (const pattern of forbidden) {
    assert(!pattern.test(text), `GitHub App smoke output leaked a local path matching ${pattern}.`);
  }
}
