# Visual Hive GitHub App

The GitHub App is the long-term connection model for production repositories. It should connect repositories, read trusted Visual Hive artifacts, and create or update issues from sanitized evidence. It must not execute untrusted pull request code.

See also: `docs/product-readiness/github-app-production-mvp.md`.

## Responsibilities

- User installs the app on selected repositories.
- App reads repository metadata and Visual Hive setup state.
- App opens a setup issue, and optionally a setup PR later.
- App reads Actions/check/artifact metadata from trusted workflows.
- App creates or updates Visual Hive issues from sanitized artifacts.
- App comments on Visual Hive-owned issues with validation state.
- App never runs tests, repairs code, approves baselines, or calls Hive/LLMs/providers by default.

## Permission Matrix

| Permission | Default | Why |
| --- | --- | --- |
| Metadata | read | Required by GitHub Apps and used to map installations to repositories. |
| Contents | read | Reads repo metadata and setup state. Direct writes are not part of the default model. |
| Actions | read | Finds and downloads trusted Visual Hive artifacts. |
| Checks | read | Reads deterministic validation state. |
| Issues | write | Creates and updates Visual Hive issue candidates. |
| Pull requests | none | Only needed if a future setup PR flow is enabled. |
| Workflows | none | Only needed if the app directly writes workflow files; setup PR is preferred. |

`workflows:write` and `contents:write` are intentionally outside the default permission set. If they are ever enabled, the app should explain why and prefer a reviewable setup PR.

## Event Model

- `installation` and `repository`: create a setup issue queue item.
- `workflow_run`: after a trusted Visual Hive workflow completes, read uploaded artifacts and create/update Visual Hive issues from sanitized issue candidates.
- `issues`: observe issue activity and validation labels; never execute code from issue content.

The local/server MVP package is `@visual-hive/github-app`. It provides:

- `getVisualHiveGitHubAppPermissions`
- `assertLeastPrivilegePermissions`
- `getGitHubAppEnvironmentReadiness`
- `verifyGitHubWebhookSignature`
- `handleVisualHiveGitHubAppWebhook`
- `buildSetupIssuePayload`
- `buildIssuePayloadFromArtifactSummary`

The package is mock/local first. It returns payloads and actions, but makes zero network calls unless a future trusted live path is explicitly implemented and guarded.
The current package also includes a guarded live issue client for the trusted App path. It remains blocked unless `VISUAL_HIVE_GITHUB_APP_LIVE=true`, all GitHub App credential env vars are present, and the extra destructive-operation guard `VISUAL_HIVE_GITHUB_APP_LIVE_ISSUE_WRITE=true` is set.

From the product repo root:

```bash
npm run github-app:smoke:mock
VISUAL_HIVE_GITHUB_APP_ALLOW_UNSIGNED_MOCKS=true npm run github-app:dev
npm run github-app:smoke:live
```

After generating `.visual-hive` artifacts, the app can also build an issue action from a downloaded artifact directory without network calls:

```bash
npm run demo:full-run
npm run github-app:smoke:artifacts
```

Local server health endpoints:

- `GET /health`
- `GET /healthz`

Health responses include a `readiness` object with boolean credential presence and missing environment variable names only. They never include private key, token, webhook secret, or installation values. In `VISUAL_HIVE_GITHUB_APP_LIVE=true`, the server reports `live_guard_blocked` until `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` or `GITHUB_APP_PRIVATE_KEY_PATH`, `GITHUB_APP_INSTALLATION_ID`, and `GITHUB_WEBHOOK_SECRET` are configured.

## Guarded Live Issue Writes

The server and package can create or update Visual Hive GitHub issues through GitHub App installation authentication, but only in an explicitly trusted environment:

```bash
VISUAL_HIVE_GITHUB_APP_LIVE=true
VISUAL_HIVE_GITHUB_APP_LIVE_ISSUE_WRITE=true
GITHUB_APP_ID=...
GITHUB_APP_PRIVATE_KEY_PATH=/run/secrets/visual-hive-app.pem
GITHUB_APP_INSTALLATION_ID=...
GITHUB_WEBHOOK_SECRET=...
npm run start -w @visual-hive/github-app
```

The live client:

- creates a short-lived GitHub App JWT locally;
- exchanges it for an installation token;
- searches existing `visual-hive` issues for the dedupe fingerprint;
- updates the existing issue when the fingerprint is present;
- creates exactly one new issue when no matching fingerprint exists;
- never checks out repo code or executes artifact content;
- sanitizes issue payloads before publishing;
- records only counters and issue URLs, not token/private-key/secret values.

Leaving out either `VISUAL_HIVE_GITHUB_APP_LIVE=true` or `VISUAL_HIVE_GITHUB_APP_LIVE_ISSUE_WRITE=true` keeps the App in blocked/dry planning mode with `externalCallsMade: 0`.

The package includes a dedicated live-smoke command:

```bash
npm run github-app:smoke:live
```

By default it writes `.visual-hive/github-app-live-smoke-result.json` and `.visual-hive/github-app-live-publish-result.json` with `status: blocked`, `externalCallsMade: 0`, and `networkCallsMade: 0`. In a trusted environment with all live env vars and the issue-write guard set, it creates or updates exactly one smoke issue using the fingerprint:

```text
visual-hive:github-app-live-smoke:<owner/repo>
```

Use `npm run smoke:live -w @visual-hive/github-app -- --require-live` only in a trusted local or workflow context where a failed live issue write should fail the command.

## Trusted Publishing Pattern

1. Untrusted PR workflow runs Visual Hive with `pull_request`, read-only permissions, and no secrets.
2. Workflow uploads `.visual-hive` artifacts.
3. A trusted `workflow_run` consumer downloads artifacts without checking out PR code.
4. The consumer validates Evidence Packet, Handoff Packet, issues, and handoff validation.
5. The GitHub App creates or updates issues using sanitized payloads.

This keeps issue creation separate from untrusted code execution.

## Setup Issue

A newly connected repo should get:

- Title: `[Visual Hive] Setup visual QA`
- Labels: `visual-hive`, `setup`, `hive/quality`
- Body: detected frameworks, checklist, proposed config, proposed workflows, exact commands, next action, and guardrails.

The setup issue is the queue item for a setup agent or human maintainer. Visual Hive still does not repair code by itself.

## Setup Publish Dry Run

Visual Hive can produce setup issue publishing evidence without creating a real GitHub issue:

```bash
visual-hive issues --write
visual-hive issues setup-publish --dry-run
```

This writes:

- `.visual-hive/setup-issue-candidate.json`
- `.visual-hive/setup-issue-publish-plan.json`
- `.visual-hive/setup-issue-publish-dry-run.json`
- `.visual-hive/setup-issue-publish-result.json`

The GitHub App or trusted `workflow_run` consumer can later use those sanitized artifacts to create or update the setup issue. Local/default runs still make zero network calls and create zero real issues.
