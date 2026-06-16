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

Plan modes:

- `pr`: fast pull-request checks. Non-PR-safe targets are excluded unless `--allow-unsafe-targets` is passed.
- `schedule`: scheduled/trusted checks. Schedule-enabled contracts and configured mutation runs are included.
- `manual`: all contracts for local/manual investigation, with mutation enabled when configured.
- `canary`: cheap or medium scheduled PR-safe contracts only. Use this for public hosted demo canaries and other low-cost health checks.
- `mutation`: contracts relevant to configured mutation operators, using explicit mappings first and heuristics otherwise. Non-PR-safe targets are excluded unless explicitly allowed.
- `full`: explicit trusted all-contract planning. Use only where protected target credentials and runtime cost are acceptable.

Optional sections with defaults:

- `selection.changedFiles`: maps glob patterns to contract IDs.
- `selection.ignoreChangedFiles`: maps docs/metadata patterns to explicit PR-plan skips.
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

Changed-file selection:

```yaml
selection:
  ignoreChangedFiles:
    - pattern: "docs/**"
      reason: "documentation-only change"
    - pattern: "**/*.md"
      reason: "markdown-only change"
    - pattern: "*.md"
      reason: "root markdown-only change"
  changedFiles:
    - pattern: "src/components/auth/**"
      contracts:
        - hosted-demo-never-login
      risk: critical
```

`ignoreChangedFiles` is an explicit exclude list for files that should not
trigger visual QA work by themselves. When a PR's entire changed-file set
matches these rules, `visual-hive plan --mode pr` writes an empty plan with
ignored-file evidence and `visual-hive run` writes a passed no-op report without
starting targets. Mixed changes still run the normal PR lane.

Contracts support:

- `waitFor[]`
- `steps[]` for deterministic user-flow actions and assertions
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

`steps[]` supports these actions:

- `goto` with `route`
- `click` with `selector`
- `fill` with `selector` and `value` (reports store `[configured]` instead of the raw fill value)
- `press` with `selector` and `key`
- `waitFor` with `selector`, optional `state`, and optional `timeoutMs`
- `assertVisible` / `assertHidden` with `selector`
- `assertText` with `selector` and `text`
- `assertUrl` with `value` as a URL substring/escaped pattern

Example:

```yaml
contracts:
  - id: public-demo-flow
    description: Public demo shell remains visible after critical action interaction.
    target: localPreview
    steps:
      - action: assertVisible
        selector: "[data-testid='dashboard-page']"
      - action: click
        selector: "[data-testid='critical-action-button']"
      - action: assertText
        selector: ".data-status"
        text: "Demo metrics loaded"
```

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
