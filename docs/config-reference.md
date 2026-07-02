# Config Reference

`visual-hive.config.yaml` is validated with zod.

The JSON Schema for editor support is tracked at `schemas/visual-hive.config.schema.json`.

```yaml
# yaml-language-server: $schema=./schemas/visual-hive.config.schema.json
```

Required sections:

- `project`: `name`, `type`, and `defaultBranch`.
- `targets`: URL, command, command group, deploy-preview, or protected targets.
- `contracts`: selector and screenshot checks.
- `viewports`: named viewport dimensions.

Plan modes:

- `pr`: fast pull-request checks. Non-PR-safe targets are excluded unless `--allow-unsafe-targets` is passed.
- `schedule`: scheduled/trusted checks. Schedule-enabled contracts and configured mutation runs are included.
- `manual`: all contracts for local/manual investigation, with mutation enabled when configured.
- `canary`: cheap or medium scheduled PR-safe contracts only. Use this for public hosted demo canaries and other low-cost health checks.
- `mutation`: contracts relevant to configured mutation operators, using explicit mappings first and heuristics otherwise. Non-PR-safe targets are excluded unless explicitly allowed.
- `full`: explicit all-contract planning for PR-safe targets. Add `--allow-unsafe-targets` only in trusted contexts where protected target credentials and runtime cost are acceptable.

Planner include/exclude controls:

- `--include-contract <id>`: select a specific contract even when no `runOn` or changed-file rule selected it.
- `--exclude-contract <id>`: remove a specific contract from the plan.
- `--include-target <id>`: select contracts for a target.
- `--exclude-target <id>`: remove contracts for a target.
- `--output <path>`: write the plan to a custom path relative to the config root, useful for sidecar canary/full plan artifacts.

The flags are repeatable. Explicit excludes win over explicit includes. Explicit includes do not bypass PR safety; non-PR-safe targets still require `--allow-unsafe-targets`.

Optional sections with defaults:

- `selection.changedFiles`: maps glob patterns to contract IDs.
- `selection.ignoreChangedFiles`: maps docs/metadata patterns to explicit PR-plan skips.
- `visual`: controls screenshot diff thresholds and baseline update behavior.
- `mutation`: enables mutation adequacy checks.
- `ai`: controls prompt generation, advisory-only governance, and token/cost estimate budgets.
- `providers`: inspects optional provider adapter readiness without requiring paid accounts.
- `costPolicy`: controls external provider upload budgets and run-mode policy.
- `github`: controls generated markdown labels and PR marker.

Setup profiles:

- `free-local`: default profile. Uses Visual Hive, Playwright, GitHub Actions, and local artifacts with no external provider upload.
- `hosted-review`: intended for teams that want a hosted visual review provider on trusted runs.
- `component-storybook`: intended for Storybook-heavy design systems.
- `enterprise-visual-ai`: intended for enterprise visual AI or device/browser-grid providers.
- `complex-app`: intended for dashboards, auth flows, command groups, and protected environments such as KubeStellar Console.

Example:

```yaml
project:
  name: my-dashboard
  type: react-vite
  defaultBranch: main
  setupProfile: free-local
```

Target kinds:

- `url`: checks an already-running or hosted URL.
- `deployPreview`: resolves a PR preview URL from `url`, `urlEnv`, `urlTemplate`, or `fallbackUrl`; defaults to `prSafe: true` and `cost: cheap`.
- `storybook`: checks a local or hosted Storybook URL; optional `install`, `build`, and `serve` commands can start Storybook for deterministic component screenshots, and `stories`/`components` record the intended component scope.
- `command`: optionally runs `install` and `build`, then starts one long-running `serve` command with a health `url`.
- `commandGroup`: runs setup commands, starts named services with health URLs and optional `readinessTimeoutMs`, and then optional teardown commands.
- `protected`: schedule/manual-only target for secret-backed environments; `url` is optional when services are configured, `cost` defaults to `expensive`, and missing `requiresSecrets` are reported by name only.

Deploy-preview example:

```yaml
targets:
  prPreview:
    kind: deployPreview
    provider: vercel
    urlEnv: VERCEL_URL
    urlTemplate: "https://${VERCEL_URL}"
    fallbackUrl: "https://preview.example.com"
```

If `urlEnv` is missing and no `fallbackUrl` is configured, planner excludes the target with a clear reason instead of failing the whole plan. Doctor reports environment variable names only.

Storybook example:

```yaml
targets:
  componentLibrary:
    kind: storybook
    install: "npm ci"
    build: "npm run build-storybook"
    serve: "npm run storybook -- --host 127.0.0.1 --port 6006"
    url: "http://127.0.0.1:6006"
    prSafe: true
    cost: cheap
    stories:
      - "src/**/*.stories.@(ts|tsx|mdx)"
    components:
      - "src/components/**"
```

Storybook targets still use Playwright contracts as the default local browser evidence path. Chromatic or other hosted component review tools remain optional providers that can feed Visual Hive's verdict only when explicitly normalized and configured as gating.

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
    mode: external
    projectId: "org/project" # optional normalized metadata
    requiredEnv:
      - ARGOS_TOKEN
    upload:
      buildName: "nightly visual review"
      includeActualScreenshots: true
      includeDiffScreenshots: true
      includeTextArtifacts: false
      extraFiles: []
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

Provider `projectId` is optional and sanitized before it appears in `provider-results.json`. Argos is the first optional real upload adapter: `visual-hive providers upload --provider argos` can stage Visual Hive screenshots and call the Argos CLI only when the provider is enabled, `mode: external`, credentials are present, and cost policy allows the run. Visual Hive still makes no provider calls during `plan`, `run`, `mutate`, `triage`, or `report`.

`mode: mock` keeps inspection and report normalization local. `mode: external` requires the configured environment variable names to be present before an adapter can be treated as available. Visual Hive reports missing credential names only; it never prints values.

`providers.argos.upload.extraFiles` accepts repo-relative paths only. Absolute paths and parent-directory traversal are rejected. Text artifacts are sanitized while staged; screenshots are copied as image artifacts.

Provider cost policy defaults:

```yaml
costPolicy:
  maxExternalScreenshotsPerRun: 0
  maxMonthlyExternalScreenshots: 5000
  externalUpload:
    pullRequest: false
    schedule: true
    manual: true
    canary: false
    mutation: false
    full: true
    onFailureOnly: true
    criticalContractsOnly: true
```

The default `maxExternalScreenshotsPerRun: 0` blocks hosted provider uploads while keeping Playwright local checks fully enabled. This is intentional for open-source and early project setups: PRs remain free, no-secret, and local-only unless a trusted workflow explicitly raises the external screenshot budget and enables the intended run mode. Provider reports include `externalUploadAllowed`, `externalUploadBlockedReasons`, `estimatedExternalScreenshots`, and Argos upload status so the Control Plane and GitHub artifacts can explain why external upload was skipped, blocked, dry-run staged, uploaded, or failed.
