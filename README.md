# Visual Hive

Visual Hive is a deterministic-first visual QA and testing orchestration tool for web projects. It turns screenshot and user-flow checks into a layered, project-aware quality system that can plan test depth, run Playwright contracts, compare screenshots with tolerances, measure mutation adequacy, produce machine-readable reports, and generate sanitized GitHub-ready failure context.

The default v0.2 path works without paid services. Playwright is the default first-party local browser runner and primary local evidence source. Visual Hive owns the final deterministic verdict layer. Argos has an optional explicit upload adapter, while Percy, Chromatic, and Applitools remain governed/deferred integrations. No hosted provider is required for normal use.

## Vision

Modern frontend quality is not just "did one screenshot change?" A real release gate needs to know which target is safe to run, which routes and user-visible contracts matter, whether the current change touched risky files, whether tests catch intentional breakage, and how to hand reviewers enough evidence to fix the failure quickly.

Visual Hive is built to be that orchestration layer. It does not replace Playwright, Argos, Percy, Chromatic, Applitools, or GitHub Actions. It coordinates them around a deterministic core:

- **Plan** the right work from changed files, target safety, schedule, cost, and risk.
- **Run** Playwright selector, flow, and tolerant screenshot checks as the default local evidence path.
- **Measure** mutation adequacy so weak visual contracts are visible instead of assumed.
- **Explain** failures with structured reports, sanitized issue bodies, triage prompts, baseline review queues, and artifact indexes.
- **Govern** optional hosted providers, LLM prompts, protected targets, workflow safety, and cost policy without requiring paid services by default.

The long-term goal is a standalone visual QA control plane: local-first for individual repos, GitHub-native for CI, and eventually installable as a package/action for teams that want visual regression protection without handing pass/fail authority to a hosted screenshot service.

## Repository Goals

This repository is both the Visual Hive implementation and the proving ground for the product. A healthy checkout should demonstrate:

- a runnable TypeScript CLI with strict config validation;
- a React/Vite demo app with deterministic visual, selector, and mutation checks;
- a local Control Plane UI that reads `.visual-hive` artifacts;
- GitHub Action templates that are safe for untrusted PRs;
- KubeStellar Console examples for hosted-demo, local-preview, fake OAuth planning, and protected scheduled lanes;
- consumer-repo smoke tests proving Visual Hive can be used outside this repo.

## How To Use This Repo

Use it in three ways:

1. **Develop Visual Hive itself**: run the root validation scripts in the quickstart below.
2. **Try the product locally**: run `npm run demo:ci`, then open the Control Plane with `node packages/cli/dist/index.js ui --config examples/demo-react-app/visual-hive.config.yaml --read-only --open`.
3. **Dogfood against another repo**: build this checkout, run `node packages/cli/dist/index.js recommend --repo ../target --write-setup-bundle`, then use `pipeline` to bootstrap baselines and enforce strict CI.

## Why deterministic-first and AI-amplified

Visual Hive treats deterministic evidence as the only pass/fail source. Its verdict layer assembles configured evidence from Playwright contracts, screenshot diffs, selector/text/user-flow assertions, console/page/network error policy, mutation adequacy, protected canaries, and future normalized provider results when explicitly configured as gating.

Playwright remains the default first-party local browser runner and primary PR-safe evidence source. It is excellent for browser automation, selector assertions, flows, screenshots, traces, and CI-friendly local checks. Visual Hive owns the final verdict so the product can grow into a multi-oracle deterministic QA system without making provider output, LLM output, or agent judgment authoritative by default.

LLM output is never a verdict authority.

### Verdict model

Visual Hive verdicts should be understood as:

- `passed`: all configured gating deterministic evidence passed.
- `failed`: at least one configured gating deterministic evidence source failed.
- `warning`: non-gating evidence needs review, such as advisory provider output or weak coverage.
- `blocked`: the run could not collect required evidence because setup, target readiness, policy, or secret availability failed.
- `inconclusive`: evidence is insufficient to make a trustworthy verdict.

LLMs, MCP tools, Hive agents, and prompt builders may explain evidence and recommend actions. They do not decide the verdict.

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
npm run smoke:ui:browser
```

`demo:all` may create ignored baselines under `examples/demo-react-app/.visual-hive/snapshots` on the first local run. It is the normal bounded acceptance path: it builds and inspects the demo app, writes PR/canary/full-safe plans, seeds local baselines when needed, runs the end-to-end operational pipeline in CI verification mode, then emits the provider, LLM, Evidence Packet, Verdict, Hive handoff, Hive native export, main Agent Packet, handoff-agent Agent Packet, provider-specialist Agent Packet, tool registry, KubeStellar planning, schema catalog, Control Plane snapshot, artifact index, persisted evidence-resource consistency check, and read-only Control Plane smoke evidence that the UI consumes. The schema catalog is generated before the Control Plane snapshot so the persisted snapshot includes schema/resource drift health, not only the live UI endpoint. The evidence-resource consistency check verifies that Context Ledger, Control Plane snapshot, artifact index, MCP manifest, and role-specific Agent Packets agree on catalog-backed resource IDs, URIs, paths, and read tools for generated demo evidence. The same checker also has a generic mode used by KubeStellar planning artifacts and consumer-install smoke output, so catalog-backed evidence identity is exercised outside the built-in demo app. `demo:ci` uses the same acceptance sequence and is safe for clean CI workspaces because it seeds deterministic local baselines before strict verification.

The aggregate demo commands are intentionally run through `scripts/run-demo-suite.mjs`, which gives every step an explicit timeout and kills the child process tree if a tool stalls. Use `npm run demo:list` to inspect the suites, run smaller bounded slices with `npm run demo:acceptance:core`, `npm run demo:acceptance:governance`, `npm run demo:acceptance:agent`, and `npm run demo:acceptance:portfolio`, or run the longer command-by-command sweep with `npm run demo:acceptance:exhaustive`. `smoke:ui` checks the served bundle and snapshot API; `smoke:ui:browser` launches Chromium and verifies the rendered guided cockpit, verdict panel, Review navigation, and Expert evidence disclosure.

Initialize Visual Hive in another repo:

```bash
node packages/cli/dist/index.js recommend --repo ../target-repo --write-setup-bundle
cd ../target-repo
node ../visual-hive/packages/cli/dist/index.js pipeline --mode pr --bootstrap-baselines --changed-files changed-files.txt
node ../visual-hive/packages/cli/dist/index.js pipeline --mode pr --ci --changed-files changed-files.txt
```

Once `@visual-hive/cli` is published, the same target-repo flow becomes:

```bash
visual-hive recommend --write-setup-bundle
visual-hive pipeline --mode pr --bootstrap-baselines --changed-files changed-files.txt
visual-hive pipeline --mode pr --ci --changed-files changed-files.txt
```

Bootstrap creates or lists missing local baselines and writes `.visual-hive/baseline-bootstrap.md`; review those images before making strict CI required.

## Config example

```yaml
project:
  name: demo-react-app
  type: react-vite
  defaultBranch: main
  setupProfile: free-local

targets:
  localPreview:
    kind: command
    build: "npm run build"
    serve: "npm run preview -- --port 4173 --strictPort"
    url: "http://127.0.0.1:4173"
    prSafe: true
    cost: cheap

visual:
  maxDiffPixelRatio: 0.01
  updateSnapshots: false
  failOnMissingBaselineInCI: true
  snapshotDir: ".visual-hive/snapshots"
  artifactDir: ".visual-hive/artifacts"

costPolicy:
  maxExternalScreenshotsPerRun: 0
  maxMonthlyExternalScreenshots: 5000
  externalUpload:
    pullRequest: false
    schedule: true
    manual: true
    onFailureOnly: true
    criticalContractsOnly: true

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

The agent-facing Evidence Packet is generated with:

```bash
visual-hive evidence --config visual-hive.config.yaml
visual-hive layers --config visual-hive.config.yaml
visual-hive verdict --config visual-hive.config.yaml
```

It writes `.visual-hive/evidence-packet.json`, `.visual-hive/evidence-summary.md`, `.visual-hive/testing-layers.json`, `.visual-hive/testing-layers.md`, `.visual-hive/verdict.json`, and `.visual-hive/verdict.md`. The packet records normalized evidence contributions, Visual Hive's final deterministic verdict, advisory-only signals, testing-layer coverage, and Hive handoff readiness, including a recommended Hive mode plus per-mode readiness for advisory, measured, repair-request, guarded-repair, and full automation. The layer report makes missing or partial test layers explicit. The standalone verdict artifact is the compact pass/fail contract for humans, CI summaries, and agents.

Role-specific Agent Packets are generated with:

```bash
visual-hive handoff --dry-run --config visual-hive.config.yaml
visual-hive hive export --dry-run --config visual-hive.config.yaml
visual-hive hive guarded-repair-preview --config visual-hive.config.yaml
visual-hive hive repair-request-envelope --config visual-hive.config.yaml
visual-hive hive trusted-repair-consumer-summary --config visual-hive.config.yaml
visual-hive hive trusted-repair-workflow-dry-run --config visual-hive.config.yaml
visual-hive test-creation-plan --config visual-hive.config.yaml
visual-hive agent-packet --config visual-hive.config.yaml --profile repair_agent
visual-hive tools --config visual-hive.config.yaml
visual-hive context --config visual-hive.config.yaml
```

This writes `.visual-hive/test-creation-plan.json`, `.visual-hive/test-creation-plan.md`, and `.visual-hive/agent-packet.json`. The test-creation plan converts missing testing layers, mutation survivors, coverage recommendations, and handoff work items into advisory no-write test recommendations. It does not edit config or tests. The Agent Packet is a sanitized work envelope with allowed tools, forbidden actions, budgets, reproduction commands, artifact pointers, and testing-layer gap context for repair, test-generation, review, or handoff agents. `visual-hive handoff --dry-run` turns deterministic failures, mutation survivors, blocked evidence, and missing/partial testing layers into bounded work items without making agents verdict authorities. `visual-hive hive export --dry-run` expands that evidence into Hive-native beads, project wiki facts, graph data, issue context, agent policy, and guarded repair work orders under `.visual-hive/hive/`, still with `externalCallsMade: 0`. `visual-hive hive guarded-repair-preview` consumes that export and writes `.visual-hive/hive/guarded-repair-preview.json` plus Markdown, a preview-only gate for branch isolation, PR-only repair policy, human review, rerun requirements, blocked reasons, and work-order readiness before Hive or an agent can repair anything. `visual-hive hive repair-request-envelope` consumes that preview and writes `.visual-hive/hive/repair-request-envelope.json` plus Markdown, a no-network trusted-workflow request package that creates no branches, PRs, issues, or Hive Beads. `visual-hive hive trusted-repair-consumer-summary` consumes the envelope and writes `.visual-hive/hive/trusted-repair-consumer-summary.json` plus Markdown, a no-network dry-run consumer summary that previews trusted workflow readiness without checkout, repair execution, branches, PRs, issues, Hive calls, or Visual Hive reruns. `visual-hive hive trusted-repair-workflow-dry-run` consumes that summary and writes `.visual-hive/hive/trusted-repair-workflow-dry-run.json` plus Markdown, a future trusted workflow plan that still performs no checkout, repair, branch creation, PR creation, issue creation, Hive call, provider call, or Visual Hive rerun. `visual-hive hive compare-modes` writes `.visual-hive/hive/mode-comparison.json`, `.visual-hive/hive/mode-comparison.md`, and per-mode previews for advisory, measured, repair-request, guarded-repair, and full export policies without calling Hive. Guarded repair and full automation appear as blocked/trusted-only states until explicit policy permits them. `visual-hive tools` writes `.visual-hive/tools/tool-registry.json` and `.visual-hive/tools/tool-cards.md`, the conservative tool policy surface for future MCP/agent use. `visual-hive context` writes `.visual-hive/context-ledger.json`, a governance ledger for tool-call, token, provider-screenshot, external-cost, and escalation budgets.

## CLI commands

- `visual-hive init`: creates config, workflow templates, and `.visual-hive/generated`.
- `visual-hive analyze`: scans a target repo and writes `.visual-hive/repo-map.json` plus `.visual-hive/repo-context.md` with package manager, workspace, script, framework, selector, route, workflow, test-tool, target-hint, risk, and coverage-gap evidence.
- `visual-hive recommend`: inspects package scripts, framework hints, Playwright presence, stable selectors, static route hints, existing workflow hints, setup profile, provider posture, cost/permission guidance, setup action plan, setup PR steps, and safe workflow previews, then writes catalog-backed `.visual-hive/recommendations.json` (`visual-hive://setup-recommendations` / `visual_hive_read_setup_recommendations`) plus `.visual-hive/setup-pr-plan.json` (`visual-hive://setup-pr-plan` / `visual_hive_read_setup_pr_plan`); normal app repos get an app-shell contract plus route-specific starter contracts for detected routes, Storybook repos get component story contracts, and complex apps with explicit frontend/backend/fake-OAuth scripts can get a reviewed `commandGroup` target. Add `--profile free-local|hosted-review|component-storybook|enterprise-visual-ai|complex-app` to choose an onboarding profile explicitly, `--write-config` to create a starter config, `--write-docs` to create `docs/visual-hive.md`, or `--write-setup-bundle` to create config, repo docs, safe workflow templates, and `.visual-hive/setup-bundle-edits.json` after overwrite preflight.
- `visual-hive doctor`: validates config, Node 22, Playwright availability, and target settings.
- `visual-hive plan`: writes `.visual-hive/plan.json` from mode, changed files, target safety, severity, cost, mutation applicability, and provider cost-policy evidence. Use `--output .visual-hive/plan.canary.json` or another repo-relative path to preserve sidecar plans for canary/full comparisons without replacing the active run plan.
- `visual-hive pipeline`: runs the operational path end to end: doctor, repo analysis, plan, deterministic run, baseline review, optional mutation, coverage/improvement, target/contract/flow/schedule/workflow/provider/risk/security/cost/readiness audits, triage, report, history, artifact indexing, Evidence Packet, testing-layer audit, Verdict Report, Hive handoff dry run, Hive-native export, guarded repair preview, trusted repair request envelope, trusted repair consumer summary, trusted repair workflow dry-run, Test Creation Plan, Agent Packet, Tool Registry, Context Ledger, and a final artifact-index refresh. It writes `.visual-hive/pipeline.json` and returns nonzero when deterministic checks fail, mutation enforcement fails, or readiness is blocked. The agent/Hive outputs are dry-run and advisory by default; they make no external calls.
- `visual-hive plans`: writes catalog-backed `.visual-hive/plans.json` (`visual-hive://plan-lanes` / `visual_hive_read_plan_lanes`), a lane summary across `.visual-hive/plan*.json` artifacts so PR, canary, full, schedule, and docs-only plans can be compared without reading every JSON file. Reading plan lanes does not run targets, change selected contracts, or override the current verdict.
- `visual-hive run`: generates and runs Playwright contracts, then writes `.visual-hive/report.json`.
- `visual-hive mutate`: runs configured mutation operators and writes `.visual-hive/mutation-report.json`.
- `visual-hive coverage`: analyzes config plus the latest plan/changed files and writes `.visual-hive/coverage.json`.
- `visual-hive improve-coverage`: writes `.visual-hive/coverage-recommendations.json` with missing-coverage, flow-gap, and mutation-survivor recommendations. The JSON is catalog-backed as `visual-hive://coverage-recommendations` / `visual_hive_read_coverage_recommendations` for read-only agent/MCP review. Pass `--apply <recommendation-id>` to preview a validated config diff, then add `--yes` only after review to update `visual-hive.config.yaml`.
- `visual-hive risk`: builds `.visual-hive/risk.json`, a prioritized register across deterministic failures, baselines, mutation adequacy, coverage, target safety, workflow safety, environment gaps, provider policy, provider setup plans, and governance decisions.
- `visual-hive readiness`: builds `.visual-hive/readiness.json`, a beginner-friendly go/no-go gate across plan, run, baseline, mutation, workflow, security, cost, provider setup, provider decisions, and LLM evidence.
- `visual-hive setup-status`: writes `.visual-hive/setup-progress.json`, an artifact-backed onboarding status with current phase, next best action, commands, and evidence across recommendation, config, plan, run, mutation, triage, workflow, provider, and readiness artifacts.
- `visual-hive runbook`: writes `.visual-hive/runbook.json`, the same curated command/profile runbook shown in the Control Plane. Use `--execute-command <id>` or `--execute-profile <id>` only for explicit allowlisted local execution; protected/secret-bearing lanes remain guidance-only.
- `visual-hive snapshot`: writes `.visual-hive/control-plane-snapshot.json`, the same local-first snapshot served by `/api/snapshot`, validated by `schemas/visual-hive.control-plane-snapshot.schema.json`. This gives agents and CI summaries the Control Plane's guidance state, adoption checklist, runbook, run profiles, failures, artifacts, and navigation evidence without starting the browser UI.
- `visual-hive security`: builds `.visual-hive/security.json`, an offline security posture report across workflow safety, protected targets, provider/LLM governance, and optional npm audit evidence.
- `visual-hive costs`: builds `.visual-hive/costs.json`, a local/external cost posture report across selected contracts, screenshot volume, provider upload policy, and budgets.
- `visual-hive contracts`: audits configured contracts, mappings, latest results, and gaps in `.visual-hive/contracts.json`.
- `visual-hive flows`: audits deterministic user-flow coverage, latest flow failures, and gaps in `.visual-hive/flows.json`.
- `visual-hive targets`: audits target safety, commands, services, secrets, lifecycle evidence, and gaps in `.visual-hive/targets.json`.
- `visual-hive schedules`: audits PR, scheduled, protected, mutation, and trusted issue lanes in `.visual-hive/schedules.json`.
- `visual-hive workflows`: audits GitHub Actions YAML for PR secret safety, `pull_request_target`, artifact upload, trusted issue patterns, and tag/unpinned external action references in catalog-backed `.visual-hive/workflows.json` (`visual-hive://workflow-audit` / `visual_hive_read_workflow_audit`). Add `--write-templates` to write the built-in PR, scheduled, and trusted issue workflow templates; existing files are protected unless `--force` is passed after review.
- `visual-hive history`: records or summarizes run history and trends in catalog-backed `.visual-hive/history.json` (`visual-hive://run-history` / `visual_hive_read_run_history`). Reading history helps review flake, baseline stability, mutation, runtime, and cost trends, but does not rerun checks, approve baselines, or override the current Visual Hive verdict.
- `visual-hive artifacts`: indexes `.visual-hive` files with classifications and sanitized previews in `.visual-hive/artifacts-index.json`. Use `--repo <path>` when setup artifacts such as `.visual-hive/recommendations.json` and `.visual-hive/setup-pr-plan.json` exist before a repo has a committed Visual Hive config.
- `visual-hive connections`: manages local repository connections for the Control Plane in `.visual-hive/connections.json`.
- `visual-hive triage`: builds `.visual-hive/triage.json`, offline findings, prompts, missing-test suggestions, baseline review summary, issue markdown, and `.visual-hive/llm-usage.json` governance records.
- `visual-hive llm`: re-audits prompt-only LLM governance, token/cost estimates, and available prompt artifacts without making model calls.
- `visual-hive llm decision`: records a local sanitized LLM governance decision in `.visual-hive/llm-decisions.json` without enabling API keys or model calls.
- `visual-hive report`: prints markdown or JSON, includes readiness evidence when `.visual-hive/readiness.json` exists, and can append to `GITHUB_STEP_SUMMARY`.
- `visual-hive evidence`: writes `.visual-hive/evidence-packet.json` and `.visual-hive/evidence-summary.md`, composing existing artifacts into a sanitized Visual Hive verdict and agent/handoff-ready evidence contract.
- `visual-hive layers`: writes `.visual-hive/testing-layers.json` and `.visual-hive/testing-layers.md`, summarizing layer coverage, missing evidence, skipped reasons, and recommended next steps.
- `visual-hive verdict`: writes `.visual-hive/verdict.json` and `.visual-hive/verdict.md`, extracting the final Visual Hive verdict, gating contributions, advisory contributions, and oracle policy from normalized evidence.
- `visual-hive handoff --dry-run`: consumes `.visual-hive/evidence-packet.json` and writes `.visual-hive/handoff.json`, `.visual-hive/hive-issue.md`, `.visual-hive/hive-bead-request.json`, and `.visual-hive/hive-handoff-result.json` with zero external calls.
- `visual-hive handoff-validate`: validates the Evidence Packet and Hive handoff artifacts before trusted workflow consumption, including no-network policy, sanitization, artifact consistency, Hive readiness mode policy, blocked full automation, guarded-repair restrictions, and optional Hive repair-chain artifact safety when export/preview/envelope/consumer/workflow dry-run artifacts exist.
- `visual-hive hive export --dry-run`: consumes `.visual-hive/evidence-packet.json` plus optional `.visual-hive/handoff.json`, then writes `.visual-hive/hive/hive-export.json`, `beads.json`, `knowledge-facts.json`, `knowledge-graph.json`, `wiki-index.json`, `issue-context.md`, `repair-work-orders.json`, `hive-agent-policy.json`, and `wiki/*.md` for Hive ingestion or trusted repair workflows. Advisory mode emits issue context only; measured mode emits beads/facts/graph/wiki index; repair modes emit PR-only work orders that require a fresh Visual Hive pass before merge.
- `visual-hive hive guarded-repair-preview`: consumes `.visual-hive/hive/hive-export.json` and writes `.visual-hive/hive/guarded-repair-preview.json` plus Markdown. It is preview-only, performs no repair, makes no Hive network calls, and shows whether repair work orders satisfy branch, PR, review, forbidden-action, and Visual Hive rerun policy.
- `visual-hive hive repair-request-envelope`: consumes `.visual-hive/hive/guarded-repair-preview.json` and writes `.visual-hive/hive/repair-request-envelope.json` plus Markdown. It is trusted-workflow-only, performs no repair, creates no branch or PR, creates no issue, makes no Hive network calls, and packages ready or blocked repair requests for a future trusted consumer.
- `visual-hive hive trusted-repair-consumer-summary`: consumes `.visual-hive/hive/repair-request-envelope.json` and writes `.visual-hive/hive/trusted-repair-consumer-summary.json` plus Markdown. It is a no-network dry-run consumer summary for future trusted repair automation; it performs no checkout, repair, branch creation, PR creation, issue creation, Hive API call, provider call, or Visual Hive rerun.
- `visual-hive hive trusted-repair-workflow-dry-run`: consumes `.visual-hive/hive/trusted-repair-consumer-summary.json` and writes `.visual-hive/hive/trusted-repair-workflow-dry-run.json` plus Markdown. It is a reviewable future trusted workflow plan only; it performs no checkout, repair, branch creation, PR creation, issue creation, Hive API call, provider call, or Visual Hive rerun.
- `visual-hive hive compare-modes`: writes a no-network comparison artifact for advisory, measured, repair-request, guarded-repair, and reserved full Hive export modes so maintainers can inspect what each mode would send to Hive before enabling a trusted workflow.
- `visual-hive test-creation-plan`: consumes `.visual-hive/evidence-packet.json`, optional `.visual-hive/coverage-recommendations.json`, and optional `.visual-hive/handoff.json`, then writes `.visual-hive/test-creation-plan.json` and `.visual-hive/test-creation-plan.md` with advisory no-write test recommendations. The JSON includes its catalog-backed `visual-hive://test-creation-plan` resource identity so agents can read it through `visual_hive_read_test_creation_plan` without path guessing.
- `visual-hive agent-packet`: consumes `.visual-hive/evidence-packet.json` plus optional `.visual-hive/handoff.json` and `.visual-hive/test-creation-plan.json`, then writes `.visual-hive/agent-packet.json` for `repair_agent`, `test_creator`, `review_agent`, or `handoff_agent` profiles.
- `visual-hive tools`: writes `.visual-hive/tools/tool-registry.json` and `.visual-hive/tools/tool-cards.md`, describing first-party, optional MCP, GitHub, and provider tools with role access, mode restrictions, cost class, trusted-only status, and human-approval gates.
- `visual-hive schemas verify`: verifies checked-in JSON Schema `$id` values and evidence-resource enum parity against the shared core evidence-resource catalog. The root `npm run schema:verify` script also writes `.visual-hive/schema-catalog.json` as read-only maintenance evidence for agents and reviewers. Use it after changing MCP resources, Agent Packet allowed tools, Context Ledger tool-call metadata, artifact index metadata, Tool Registry cards, or Control Plane evidence resources.
- `visual-hive context`: writes `.visual-hive/context-ledger.json`, tracking inferred tool calls, token estimates, provider screenshot budgets, external cost, remaining budget, and escalation reasons for agents and future MCP tooling.
- `visual-hive mcp --describe|--stdio`: exposes first-party read-only MCP resources over existing artifacts such as config, plan, report, Evidence Packet, Control Plane snapshot, verdict, handoff, Hive export, guarded repair preview, repair request envelope, trusted repair consumer summary, trusted repair workflow dry-run, Hive mode comparison, provider results/upload manifest evidence, Agent Packet, Tool Registry, Context Ledger, pipeline status, and artifact index. Execution and provider-upload tools remain disabled by default.
- `visual-hive baselines list|approve|reject`: inspect screenshot baselines, write `.visual-hive/baselines.json` with `baselines list --write`, and explicitly approve or reject reviewed screenshots with audit records. The baseline queue and decision logs are catalog-backed read-only evidence (`visual-hive://baseline-review`, `visual-hive://baseline-approvals`, `visual-hive://baseline-rejections`) for agents and reviewers; reading them does not approve, reject, copy, or update baselines.
- `visual-hive providers list`: inspect optional provider adapters and missing credential names without calling paid services.
- `visual-hive providers list --mock-results`: after a deterministic run, write `.visual-hive/provider-results.json` with no-network mock adapter operation evidence, provider-specific normalized metadata, and external upload cost-policy decisions.
- `visual-hive providers plan --provider argos`: write `.visual-hive/provider-setup-plan.json`, a no-network provider setup plan with required env names, config changes, trusted workflow steps, safety checks, and validation commands.
- `visual-hive providers handoff --provider argos`: after a deterministic run, write `.visual-hive/provider-handoff.json`, a no-network manifest of exact screenshot artifacts, eligibility, blocked reasons, required env names, and trusted workflow steps for optional provider upload review.
- `visual-hive providers upload --provider argos --dry-run`: stage eligible screenshots into `.visual-hive/provider-upload/argos` and write provider upload evidence without network calls. A real Argos upload is opt-in, trusted-lane oriented, requires `ARGOS_TOKEN`, and affects the Visual Hive verdict only if normalized provider gating is explicitly enabled for that trusted lane.
- `visual-hive providers decision`: records a local sanitized provider governance decision in `.visual-hive/provider-decisions.json` without enabling credentials, billing, uploads, or provider network calls.
- `visual-hive ui`: starts the local-first Control Plane over config, setup recommendations, reports, baselines, coverage, flows, mutation, failures, and raw artifacts.

Target kinds are `url`, `deployPreview`, `storybook`, `command`, `commandGroup`, and `protected`. Deploy-preview targets resolve PR preview URLs from safe env-var names and default to cheap PR-safe checks; Storybook targets model component-library coverage without requiring Chromatic; protected targets default to PR-unsafe and report missing secret environment variable names without printing values.

Plan modes are `pr`, `schedule`, `manual`, `canary`, `mutation`, and `full`. Use `canary` for cheap scheduled public checks, `mutation` for mutation-applicable contracts, and `full` for broad PR-safe coverage. Add `--allow-unsafe-targets` to `full` only in trusted contexts where protected targets and cost are acceptable.

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

The UI reads `.visual-hive` artifacts and shows overview health, portfolio queues, runbooks, actionable risk ranking, guided setup progress, runs, failures, baselines, mutation adequacy, coverage, config, targets, contracts, GitHub guidance, LLM/provider settings, local repo connections, and raw artifacts. The Start / Quality Cockpit view exposes a snapshot-backed setup/adoption checklist that walks beginners from config, PR-safe planning, deterministic evidence, visual review, mutation adequacy, agent handoff packaging, and safe workflow enablement while keeping expert evidence behind disclosures. The same snapshot can be written without starting a browser with `visual-hive snapshot`, producing `.visual-hive/control-plane-snapshot.json` for agents, MCP clients, CI summaries, and artifact review. The Portfolio page groups connected repos into broken setup, deterministic failures, stale reports, missing coverage, coverage gaps, weak mutation, high risk, and healthy queues. The Connections page includes a multi-repo health dashboard derived from each repo's report, mutation, coverage, and risk artifacts so maintainers can see which connected repos have failed or stale runs, missing reports, missing coverage audits, high coverage gaps, weak mutation scores, high risk, or broken config. Risk rows link directly into related contracts, targets, failure evidence, baseline review, coverage, workflow/provider posture, and artifact previews. The Setup page turns `.visual-hive/recommendations.json` and `.visual-hive/setup-pr-plan.json` plus the current config, plan, report, mutation, triage, workflow, provider, and readiness artifacts into a current phase, percent complete, next best action, checklist, setup PR file plan, security checks, and action plan covering repo inspection, PR-safe targets, starter contracts, PR safety, provider choices, generated files, setup PR preview, and local validation. It does not execute target code or call LLMs. In write mode it can generate a recommended config and `docs/visual-hive.md` from `.visual-hive/recommendations.json`, generate a setup PR bundle with config/docs/workflows after preflight checks, write built-in safe workflow templates into `.github/workflows`, write no-network provider setup plans, explicitly record provider/LLM governance decisions, explicitly approve or reject reviewed baselines after confirmation, save validated config edits after a diff review, and add/remove local repo connection records; `--read-only` disables those actions.

## GitHub Actions

Use the templates in `templates/github-actions/`, run `visual-hive init`, run `visual-hive workflows --write-templates`, or use the Control Plane GitHub / CI page to write the built-in templates after review. PR lanes should run with read-only permissions and no secrets. Scheduled or protected lanes can use trusted secrets for protected environments. Use `pull_request`, not `pull_request_target`, for untrusted PR validation. The templates use readable version tags by default; `visual-hive workflows` reports those as low-severity supply-chain evidence so production teams can replace them with reviewed full commit SHAs.

Generated Visual Hive workflows also run `visual-hive baselines list --write` and `visual-hive workflows` before artifact upload so `.visual-hive/baselines.json` captures baseline review evidence and `.visual-hive/workflows.json` captures workflow safety evidence.

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

This repo also dogfoods the example with `npm run demo:kubestellar`, a no-network planning check that exercises auth, cluster/API, docs-only, and scheduled protected-lane scenarios against `examples/kubestellar-console/visual-hive.config.yaml`, indexes the generated `.visual-hive` files, and verifies generic catalog-backed evidence-resource metadata for the generated planning artifacts.

For a local checkout of the real KubeStellar Console repo, run:

```bash
npm run smoke:console
```

The script uses `../console` by default, or `VISUAL_HIVE_CONSOLE_REPO=/path/to/console` when set. It is no-network from Visual Hive's side: it writes catalog-backed setup recommendation and setup PR-plan artifacts at the console repo root, plans auth/UI/docs-only lanes, writes the plan-lane summary, Evidence Packet, MCP manifest, role-specific Agent Packets, Context Ledger, Control Plane snapshot, and artifact index under the console repo's `web/e2e/.visual-hive`, then verifies catalog-backed evidence-resource identity with the generic checker. It also asserts role Agent Packet budgets keep `allowExternalNetwork=false` and `maxExternalCostUsd=0`. It does not start console targets, upload provider artifacts, call Hive, call LLMs, or grant agents verdict authority.

To prove the real Console local preview lane end to end, run:

```bash
npm run smoke:console:run
```

That heavier smoke reuses the existing Console `web/dist` build by default, creates a `localPreview`-only plan from the UI changed-files fixture, starts the configured Vite preview server through Visual Hive, seeds local baselines if needed, reruns strict CI-mode visual checks, writes report/evidence/snapshot/artifact outputs under `web/e2e/.visual-hive`, and verifies lifecycle plus screenshot metadata. Set `VISUAL_HIVE_CONSOLE_BUILD=true` to run `npm run build --prefix <console>/web` first when you want the smoke to rebuild the external repo.

See also:

- `docs/troubleshooting.md`
- `docs/comparison.md`
- `docs/control-plane.md`
- `docs/run-history.md`
- `docs/raw-artifacts.md`
- `docs/connections.md`
- `docs/setup-recommendations.md`
- `docs/security.md`
- `docs/cost-policy.md`
- `docs/install.md`
- `docs/roadmap.md`
- `docs/research/visual-hive-vision-and-rationale.md`
- `docs/agent-forward-v2/README-DOC-PACK.md`

## Security model

- PR code runs with read-only permissions and no secrets.
- Scheduled/protected targets may use secrets.
- LLM output never decides pass/fail.
- Issue creation should happen from trusted artifacts, not by executing untrusted PR code.
- Tokens, cookies, passwords, authorization headers, and code-like query params are redacted from generated issue/comment bodies.
- External provider adapters are optional.
- Provider inspection reports credential names only, never credential values.

## Roadmap

- Additional first-class Percy, Chromatic, and Applitools upload adapters.
- Richer Playwright trace parsing.
- Contract discovery from route manifests and component metadata.
- Risk-aware cost budgets for large monorepos.
- Trusted GitHub issue creation workflow.
