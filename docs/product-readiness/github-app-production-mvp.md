# GitHub App Production MVP

The Visual Hive GitHub App package is a production-oriented local/server MVP. It is designed to be deployable later, while remaining safe in local and test modes today.

## Environment Model

| Variable | Required for | Notes |
| --- | --- | --- |
| `GITHUB_APP_ID` | future live GitHub App auth | Not required for mock/local action-plan mode. |
| `GITHUB_APP_PRIVATE_KEY` | future live GitHub App auth | Must never be logged. Prefer secret manager or mounted file. |
| `GITHUB_APP_PRIVATE_KEY_PATH` | future live GitHub App auth | Path-based alternative to inline private key. |
| `GITHUB_WEBHOOK_SECRET` | signed webhook verification | When set, unsigned or invalid webhook requests are rejected. |
| `GITHUB_APP_INSTALLATION_ID` | future local live smoke | Used only with explicit live guard. |
| `VISUAL_HIVE_GITHUB_APP_ALLOW_UNSIGNED_MOCKS=true` | local mock webhook testing | Allows unsigned `/mock/*` payloads only in local/dev mode. |
| `VISUAL_HIVE_GITHUB_APP_LIVE=true` | guarded live mode | Does not by itself make network calls; future live actions still require credentials and trusted event handling. |

## Local Run

```bash
npm run build -w @visual-hive/github-app
VISUAL_HIVE_GITHUB_APP_ALLOW_UNSIGNED_MOCKS=true npm run dev -w @visual-hive/github-app
```

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
| `workflow_run` | Create or update a Visual Hive issue payload from trusted sanitized artifact summary. |
| `issues` | Record issue activity. Never execute issue body or comment content. |

## Safety Invariants

- Unsigned real webhooks are rejected unless mock mode is explicitly enabled.
- Webhook signatures are verified with SHA-256 HMAC when `GITHUB_WEBHOOK_SECRET` is set.
- Default server responses report `externalCallsMade: 0`, `networkCallsMade: 0`, `checkoutPerformed: false`, and `repoCodeExecuted: false`.
- The app does not check out repository code.
- The app does not run tests, approve baselines, repair code, push branches, open PRs, call Hive, call LLMs, or upload provider artifacts.

## Current Live Boundary

The current package produces safe action plans and issue payloads. It can report whether live GitHub App credentials are present, but full live GitHub App artifact download and installation-token issue writes remain guarded direction work. The trusted `workflow_run` publisher in client repos provides the current live issue publishing path from sanitized artifacts.
