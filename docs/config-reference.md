# Config Reference

`visual-hive.config.yaml` is validated with zod.

The JSON Schema for editor support is tracked at `schemas/visual-hive.config.schema.json`.

```yaml
# yaml-language-server: $schema=./schemas/visual-hive.config.schema.json
```

Required sections:

- `project`: `name`, `type`, and `defaultBranch`.
- `targets`: command or URL targets.
- `contracts`: selector and screenshot checks.
- `viewports`: named viewport dimensions.

Optional sections with defaults:

- `selection.changedFiles`: maps glob patterns to contract IDs.
- `visual`: controls screenshot diff thresholds and baseline update behavior.
- `mutation`: enables mutation adequacy checks.
- `ai`: controls prompt generation, advisory-only governance, and token/cost estimate budgets.
- `providers`: inspects optional provider adapter readiness without requiring paid accounts.
- `github`: controls generated markdown labels and PR marker.

Target kinds:

- `url`: checks an already-running or hosted URL.
- `command`: optionally runs `install` and `build`, then starts one long-running `serve` command with a health `url`.
- `commandGroup`: runs setup commands, starts named services with health URLs and optional `readinessTimeoutMs`, and then optional teardown commands.
- `protected`: schedule/manual-only target for secret-backed environments; `url` is optional when services are configured, `cost` defaults to `expensive`, and missing `requiresSecrets` are reported by name only.

Contracts support:

- `waitFor[]`
- `timeoutMs`
- `failOnConsoleError`
- `expectedConsoleErrors`
- `selectors.mustExist`
- `selectors.mustNotExist`
- `selectors.textMustExist`
- `selectors.textMustNotExist`
- `screenshots[].route`
- `screenshots[].viewport`
- `screenshots[].fullPage`
- `screenshots[].mask`

Visual defaults:

```yaml
visual:
  maxDiffPixelRatio: 0.01
  updateSnapshots: false
  failOnMissingBaselineInCI: true
  snapshotDir: ".visual-hive/snapshots"
  artifactDir: ".visual-hive/artifacts"
```

`snapshotDir` and `artifactDir` must be repo-relative paths and cannot contain `..` traversal.

Mutation operators:

- `hide-critical-button`
- `force-login-on-demo`
- `remove-demo-badge`
- `api-500`
- `empty-data`
- `mobile-overflow`
- `route-guard-bypass`
- `hidden-error-banner`
- `broken-image`
- `removed-accessible-name`
- `theme-token-drift`
- `stale-loading-state`

Operators can be listed as strings for heuristic contract mapping, or as objects with explicit `contracts`.

AI defaults:

```yaml
ai:
  enabled: false
  provider: none
  model: offline-heuristics
  neverSoleOracle: true
  createIssuePrompt: true
  maxDailyRuns: 5
  maxPromptTokens: 50000
  maxEstimatedCostUsd: 0
```

`visual-hive triage` always remains prompt-only in the default CLI path. `llm-usage.json` records estimated tokens/costs and `callsMade: 0` so teams can review governance before wiring any trusted external LLM workflow.

Provider defaults:

```yaml
providers:
  playwright:
    enabled: true
  argos:
    enabled: false
    projectId: "org/project" # optional, used only for normalized metadata until external adapters are wired
    requiredEnv:
      - ARGOS_TOKEN
  percy:
    enabled: false
    requiredEnv:
      - PERCY_TOKEN
  chromatic:
    enabled: false
    requiredEnv:
      - CHROMATIC_PROJECT_TOKEN
  applitools:
    enabled: false
    requiredEnv:
      - APPLITOOLS_API_KEY
  storybook:
    enabled: false
    mode: mock
  github-checks:
    enabled: false
    requiredEnv:
      - GITHUB_TOKEN
```

Provider `projectId` is optional and sanitized before it appears in `provider-results.json`. In v0.2 it is used for mock/deferred review metadata only; Visual Hive still makes no external provider calls by default.

`mode: mock` keeps inspection and report normalization local. `mode: external` requires the configured environment variable names to be present before an adapter can be treated as available. Visual Hive reports missing credential names only; it never prints values.
