# GitHub App Production MVP

The Visual Hive GitHub App package is a production-oriented local/server MVP. It is designed to be deployable later, while remaining safe in local and test modes today.

## Environment Model

| Variable | Required for | Notes |
| --- | --- | --- |
| `GITHUB_APP_ID` | future live GitHub App auth | Not required for mock/local action-plan mode. |
| `GITHUB_APP_PRIVATE_KEY` | future live GitHub App auth | Must never be logged. Prefer secret manager or mounted file. |
| `GITHUB_APP_PRIVATE_KEY_PATH` | future live GitHub App auth | Path-based alternative to inline private key. |
| `GITHUB_WEBHOOK_SECRET` | signed webhook verification | When set, unsigned or invalid webhook requests are rejected. |
| `GITHUB_APP_INSTALLATION_ID` | guarded live issue writes | Used only with explicit live guard and the issue-write guard. |
| `VISUAL_HIVE_GITHUB_APP_ALLOW_UNSIGNED_MOCKS=true` | local mock webhook testing | Allows unsigned `/mock/*` payloads only in local/dev mode. |
| `VISUAL_HIVE_GITHUB_APP_ALLOW_LOCAL_ARTIFACT_ROOT=true` | trusted local artifact ingestion | Allows signed `/webhooks/github` test payloads to read `VISUAL_HIVE_GITHUB_APP_ARTIFACT_ROOT` or `local_artifact_root`; `/mock/*` endpoints can use local artifact roots in mock mode. |
| `VISUAL_HIVE_GITHUB_APP_ARTIFACT_ROOT` | trusted local artifact ingestion | Directory containing downloaded Visual Hive artifacts such as `issues.json`, `issue-queue.json`, `evidence-packet.json`, and `artifacts-index.json`. |
| `VISUAL_HIVE_GITHUB_APP_REPO_ROOT` | path sanitization | Optional repo root used to convert artifact paths to repo-relative issue links. |
| `VISUAL_HIVE_GITHUB_APP_LIVE=true` | guarded live mode | Does not by itself make network calls; live issue writes also require credentials, trusted event handling, and `VISUAL_HIVE_GITHUB_APP_LIVE_ISSUE_WRITE=true`. |
| `VISUAL_HIVE_GITHUB_APP_LIVE_ISSUE_WRITE=true` | guarded live issue write | Required in addition to live mode before the App may create or update GitHub issues. |

## Local Run

```bash
npm run build -w @visual-hive/github-app
VISUAL_HIVE_GITHUB_APP_ALLOW_UNSIGNED_MOCKS=true npm run dev -w @visual-hive/github-app
```

Top-level aliases are also available:

```bash
npm run github-app:smoke:mock
VISUAL_HIVE_GITHUB_APP_ALLOW_UNSIGNED_MOCKS=true npm run github-app:dev
```

After a Visual Hive run has produced `.visual-hive` artifacts, use the artifact-root smoke to emulate a trusted workflow downloading artifacts and handing them to the App:

```bash
npm run demo:full-run
npm run github-app:smoke:artifacts
```

Use the dedicated live-smoke command to prove the live path is blocked by default, or to create/update exactly one smoke issue when all trusted credentials and guards are configured:

```bash
npm run github-app:smoke:live

VISUAL_HIVE_GITHUB_APP_LIVE=true \
VISUAL_HIVE_GITHUB_APP_LIVE_ISSUE_WRITE=true \
GITHUB_APP_ID=... \
GITHUB_APP_PRIVATE_KEY_PATH=/run/secrets/visual-hive-app.pem \
GITHUB_APP_INSTALLATION_ID=... \
GITHUB_WEBHOOK_SECRET=... \
npm run smoke:live -w @visual-hive/github-app -- --require-live
```

The live-smoke fingerprint is deterministic: `visual-hive:github-app-live-smoke:<owner/repo>`. The command must create or update exactly one issue; otherwise the `--require-live` form fails.

Health endpoints:

- `GET /health`
- `GET /healthz`

The health payload includes:

- `mode`: `mock_or_plan`, `live_guard_blocked`, or `live_ready`.
- `readiness.requiredForLive`: the exact environment variable names required for live operation.
- `readiness.missingForLive`: missing environment variable names only.
- boolean flags for whether app id, private key, installation id, webhook secret, mock mode, and live mode are configured.

The health payload never includes private key contents, webhook secret contents, installation id values, tokens, or file path values. Path-based private key configuration is reported only as `privateKeySource: GITHUB_APP_PRIVATE_KEY_PATH`.

Webhook endpoint:

- `POST /webhooks/github`

Mock endpoints:

- `POST /mock/installation`
- `POST /mock/workflow-run`
- `POST /mock/issues`

## Event Handling

| Event | Action plan |
| --- | --- |
| `installation` / `repository` | Create a setup issue payload with detected project checklist, commands, workflows, and guardrails. |
| `workflow_run` | Create or update a Visual Hive issue payload from a trusted sanitized artifact summary or an explicitly provided local artifact root in mock/trusted mode. |
| `issues` | Record issue activity. Never execute issue body or comment content. |

## Safety Invariants

- Unsigned real webhooks are rejected unless mock mode is explicitly enabled.
- Webhook signatures are verified with SHA-256 HMAC when `GITHUB_WEBHOOK_SECRET` is set.
- Default server responses report `externalCallsMade: 0`, `networkCallsMade: 0`, `checkoutPerformed: false`, and `repoCodeExecuted: false`.
- The app does not check out repository code.
- The app does not run tests, approve baselines, repair code, push branches, open PRs, call Hive, call LLMs, or upload provider artifacts.

## Current Live Boundary

The current package produces safe action plans and issue payloads, and it now includes a guarded installation-token issue client. Live issue writes remain disabled by default. They require:

- `VISUAL_HIVE_GITHUB_APP_LIVE=true`;
- `VISUAL_HIVE_GITHUB_APP_LIVE_ISSUE_WRITE=true`;
- GitHub App id, private key or private-key path, installation id, and webhook secret;
- a trusted webhook or local trusted artifact-ingestion path;
- sanitized Visual Hive issue payloads with dedupe fingerprints.

When enabled, the live client creates a GitHub App JWT, exchanges it for an installation token, searches existing `visual-hive` issues, updates by dedupe fingerprint when present, or creates one issue when absent. The result records issue number/URL and network counters only. Token, private key, webhook secret, and installation token values are never written to logs or JSON artifacts.

Full GitHub Actions artifact download from arbitrary workflow runs remains a deployment concern for the hosted App. The trusted `workflow_run` publisher in client repos remains the recommended live publishing path today because it already consumes sanitized artifacts without checking out or executing PR code.
