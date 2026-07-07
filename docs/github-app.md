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

The prototype package is `@visual-hive/github-app`. It provides:

- `getVisualHiveGitHubAppPermissions`
- `assertLeastPrivilegePermissions`
- `verifyGitHubWebhookSignature`
- `handleVisualHiveGitHubAppWebhook`
- `buildSetupIssuePayload`
- `buildIssuePayloadFromArtifactSummary`

The package is mock/local first. It returns payloads and actions, but makes zero network calls.

Local server health endpoints:

- `GET /health`
- `GET /healthz`

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
