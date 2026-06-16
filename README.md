# Visual Hive

Visual Hive is a deterministic-first visual QA and testing orchestration tool for web projects. It turns screenshot and user-flow checks into a layered, project-aware quality system that can plan test depth, run Playwright contracts, compare screenshots with tolerances, measure mutation adequacy, produce machine-readable reports, and generate sanitized GitHub-ready failure context.

The default v0.2 path works without paid services. Playwright is the deterministic oracle. External providers such as Percy, Chromatic, Argos, and Applitools are modeled as optional future adapters, not required runtime dependencies.

## Why deterministic-first and AI-amplified

Visual Hive treats deterministic tests as the only pass/fail source. Playwright selector, flow, and screenshot checks decide status. Mutation testing asks whether those checks detect intentional UI/auth/API breakage. Optional LLM output is limited to triage, explanation, missing-test suggestions, and issue drafting.

LLM output is never the sole pass/fail oracle.

## Quickstart

```bash
npm install
npm run build
npm test
npm run demo:all
npm run demo:ci
npm run smoke:cli
npm run ui:build
npm run smoke:ui
```

`demo:all` may create ignored baselines under `examples/demo-react-app/.visual-hive/snapshots` on the first local run. It also writes setup recommendations, coverage, workflow-safety, triage, PR-comment, and report artifacts. `demo:ci` first ensures local baselines exist, then reruns deterministic checks in CI mode.

Initialize Visual Hive in another repo:

```bash
npx visual-hive recommend
npx visual-hive recommend --write-config
npx visual-hive init
npx visual-hive doctor
npx visual-hive plan --mode pr --changed-files changed-files.txt
npx visual-hive run --ci
```

## Config example

```yaml
project:
  name: demo-react-app
  type: react-vite
  defaultBranch: main

targets:
  localPreview:
    kind: command
    build: "npm run build"
    serve: "npm run preview -- --port 4173"
    url: "http://127.0.0.1:4173"
    prSafe: true
    cost: cheap

visual:
  maxDiffPixelRatio: 0.01
  updateSnapshots: false
  failOnMissingBaselineInCI: true
  snapshotDir: ".visual-hive/snapshots"
  artifactDir: ".visual-hive/artifacts"

contracts:
  - id: dashboard-visual-stability
    description: Dashboard should render stable visual layout.
    target: localPreview
    severity: high
    runOn:
      pullRequest: true
      schedule: true
    selectors:
      mustExist:
        - "[data-testid='dashboard-page']"
      mustNotExist:
        - "[data-testid='login-page']"
    screenshots:
      - name: dashboard-desktop
        route: "/"
        viewport: desktop

viewports:
  desktop:
    width: 1440
    height: 900
```

For YAML language-server support:

```yaml
# yaml-language-server: $schema=./schemas/visual-hive.config.schema.json
```

Output schemas for `.visual-hive/plan.json`, `.visual-hive/report.json`, and `.visual-hive/mutation-report.json` are documented in `docs/report-schema.md`.

## CLI commands

- `visual-hive init`: creates config, workflow templates, and `.visual-hive/generated`.
- `visual-hive recommend`: inspects package scripts, framework hints, and stable selectors, then writes `.visual-hive/recommendations.json`; add `--write-config` to create a starter config.
- `visual-hive doctor`: validates config, Node 22, Playwright availability, and target settings.
- `visual-hive plan`: writes `.visual-hive/plan.json` from mode, changed files, target safety, severity, and cost.
- `visual-hive run`: generates and runs Playwright contracts, then writes `.visual-hive/report.json`.
- `visual-hive mutate`: runs configured mutation operators and writes `.visual-hive/mutation-report.json`.
- `visual-hive coverage`: analyzes config plus the latest plan/changed files and writes `.visual-hive/coverage.json`.
- `visual-hive contracts`: audits configured contracts, mappings, latest results, and gaps in `.visual-hive/contracts.json`.
- `visual-hive targets`: audits target safety, commands, services, secrets, lifecycle evidence, and gaps in `.visual-hive/targets.json`.
- `visual-hive schedules`: audits PR, scheduled, protected, mutation, and trusted issue lanes in `.visual-hive/schedules.json`.
- `visual-hive workflows`: audits GitHub Actions YAML for PR secret safety, `pull_request_target`, artifact upload, and trusted issue patterns in `.visual-hive/workflows.json`.
- `visual-hive history`: records or summarizes run history and trends in `.visual-hive/history.json`.
- `visual-hive artifacts`: indexes `.visual-hive` files with classifications and sanitized previews in `.visual-hive/artifacts-index.json`.
- `visual-hive connections`: manages local repository connections for the Control Plane in `.visual-hive/connections.json`.
- `visual-hive triage`: builds offline findings, prompts, missing-test suggestions, issue markdown, and `.visual-hive/llm-usage.json` governance records.
- `visual-hive report`: prints markdown or JSON and can append to `GITHUB_STEP_SUMMARY`.
- `visual-hive baselines list|approve`: inspect screenshot baselines and explicitly approve an actual screenshot as the new baseline with an audit record.
- `visual-hive providers`: inspect optional provider adapters and missing credential names without calling paid services.
- `visual-hive providers --mock-results`: after a deterministic run, write `.visual-hive/provider-results.json` with no-network mock adapter operation evidence and provider-specific normalized metadata.
- `visual-hive ui`: starts the local-first Control Plane over config, setup recommendations, reports, baselines, coverage, mutation, failures, and raw artifacts.

Target kinds are `url`, `command`, `commandGroup`, and `protected`. Protected targets default to PR-unsafe and report missing secret environment variable names without printing values.

Plan modes are `pr`, `schedule`, `manual`, `canary`, `mutation`, and `full`. Use `canary` for cheap scheduled public checks, `mutation` for mutation-applicable contracts, and `full` only in trusted contexts where protected targets and cost are acceptable.

Changed-file selection can also define `selection.ignoreChangedFiles` for docs-only or metadata-only patterns. If every changed file matches that explicit ignore list in PR mode, Visual Hive writes an empty plan plus a passed no-op report instead of starting target servers.

For one-off investigations, `visual-hive plan` also supports repeatable `--include-contract`, `--exclude-contract`, `--include-target`, and `--exclude-target` flags. Excludes win over includes, and explicit includes still respect PR target safety unless `--allow-unsafe-targets` is passed.

## Control Plane UI

Start the local UI for a repository:

```bash
visual-hive ui --repo . --config visual-hive.config.yaml --port 4317 --open
```

Local development without publishing:

```bash
node packages/cli/dist/index.js ui --config examples/demo-react-app/visual-hive.config.yaml --read-only
```

The UI reads `.visual-hive` artifacts and shows overview health, setup recommendations, runs, failures, baselines, mutation adequacy, coverage, config, targets, contracts, GitHub guidance, LLM/provider settings, local repo connections, and raw artifacts. It does not execute target code or call LLMs. In write mode it can explicitly approve reviewed baselines, save validated config edits after a diff review, and add/remove local repo connection records; `--read-only` disables those actions.

## GitHub Actions

Use the templates in `templates/github-actions/` or run `visual-hive init`. PR lanes should run with read-only permissions and no secrets. Scheduled or protected lanes can use trusted secrets for protected environments. Use `pull_request`, not `pull_request_target`, for untrusted PR validation.

Generated Visual Hive workflows also run `visual-hive workflows` before artifact upload so `.visual-hive/workflows.json` captures workflow safety evidence.

## Mutation testing

The v0.2 release includes twelve mutation operators:

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

A mutation is killed when deterministic contracts fail under the injected breakage. The score is `killed / total`.

## Adapting to KubeStellar Console

Use a safe PR lane for local preview screenshots and public hosted demo canaries. Put fake OAuth and live cluster checks into scheduled or protected workflows, with secrets available only outside untrusted PR execution. See `docs/kubestellar-console-example.md`.

See also:

- `docs/troubleshooting.md`
- `docs/comparison.md`
- `docs/control-plane.md`
- `docs/run-history.md`
- `docs/raw-artifacts.md`
- `docs/connections.md`
- `docs/setup-recommendations.md`
- `docs/install.md`
- `docs/roadmap.md`

## Security model

- PR code runs with read-only permissions and no secrets.
- Scheduled/protected targets may use secrets.
- LLM output never decides pass/fail.
- Issue creation should happen from trusted artifacts, not by executing untrusted PR code.
- Tokens, cookies, passwords, authorization headers, and code-like query params are redacted from generated issue/comment bodies.
- External provider adapters are optional.
- Provider inspection reports credential names only, never credential values.

## Roadmap

- First-class Percy, Chromatic, Argos, and Applitools adapters.
- Richer Playwright trace parsing.
- Contract discovery from route manifests and component metadata.
- Risk-aware cost budgets for large monorepos.
- Trusted GitHub issue creation workflow.
