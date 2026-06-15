# Visual Hive

Visual Hive is a deterministic-first visual QA and testing orchestration tool for web projects. It turns screenshot checks into a layered, project-aware quality system that can plan test depth, run Playwright contracts, measure mutation adequacy, produce machine-readable reports, and generate sanitized GitHub-ready failure context.

The MVP works without paid services. Playwright is the default oracle. External providers such as Percy, Chromatic, Argos, and Applitools are modeled as optional future adapters, not required runtime dependencies.

## Why deterministic-first and AI-amplified

Visual Hive treats deterministic tests as the only pass/fail source. Playwright selector, flow, and screenshot checks decide status. Mutation testing asks whether those checks detect intentional UI/auth/API breakage. Optional LLM output is limited to triage, explanation, missing-test suggestions, and issue drafting.

LLM output is never the sole pass/fail oracle.

## Quickstart

```bash
npm install
npm run build
npm test
npm run demo:doctor
npm run demo:plan
npm run demo:run
npm run demo:mutate
npm run demo:triage
npm run demo:report
```

Initialize Visual Hive in another repo:

```bash
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
- `visual-hive doctor`: validates config, Node 22, Playwright availability, and target settings.
- `visual-hive plan`: writes `.visual-hive/plan.json` from mode, changed files, target safety, severity, and cost.
- `visual-hive run`: generates and runs Playwright contracts, then writes `.visual-hive/report.json`.
- `visual-hive mutate`: runs configured mutation operators and writes `.visual-hive/mutation-report.json`.
- `visual-hive triage`: builds offline findings, `.visual-hive/triage-prompt.md`, and `.visual-hive/issue.md`.
- `visual-hive report`: prints markdown or JSON and can append to `GITHUB_STEP_SUMMARY`.

## GitHub Actions

Use the templates in `templates/github-actions/` or run `visual-hive init`. PR lanes should run with read-only permissions and no secrets. Scheduled or protected lanes can use trusted secrets for protected environments. Use `pull_request`, not `pull_request_target`, for untrusted PR validation.

## Mutation testing

The MVP includes six mutation operators:

- `hide-critical-button`
- `force-login-on-demo`
- `remove-demo-badge`
- `api-500`
- `empty-data`
- `mobile-overflow`

A mutation is killed when deterministic contracts fail under the injected breakage. The score is `killed / total`.

## Adapting to KubeStellar Console

Use a safe PR lane for local preview screenshots and public hosted demo canaries. Put fake OAuth and live cluster checks into scheduled or protected workflows, with secrets available only outside untrusted PR execution. See `docs/kubestellar-console-example.md`.

## Security model

- PR code runs with read-only permissions and no secrets.
- Scheduled/protected targets may use secrets.
- LLM output never decides pass/fail.
- Issue creation should happen from trusted artifacts, not by executing untrusted PR code.
- Tokens, cookies, passwords, authorization headers, and code-like query params are redacted from generated issue/comment bodies.
- External provider adapters are optional.

## Roadmap

- First-class Percy, Chromatic, Argos, and Applitools adapters.
- Richer Playwright trace parsing.
- Contract discovery from route manifests and component metadata.
- Risk-aware cost budgets for large monorepos.
- Trusted GitHub issue creation workflow.
