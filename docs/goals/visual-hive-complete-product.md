# Visual Hive Complete Product Goal

Visual Hive should become a complete, production-grade, deterministic-first visual QA orchestration platform.

It should not remain only a CLI, screenshot diff tool, report generator, or passive dashboard. It should become an end-to-end system that helps users connect repositories, understand visual risk, generate and manage visual/user-flow coverage, run safe PR checks, schedule deeper validation, measure whether tests are meaningful through mutation adequacy, manage baselines, inspect failures, use LLMs safely for triage and repair context, optionally connect external visual providers, and operate across large complex applications.

The finished product should be usable by two groups at the same time:

1. **Beginner maintainers** who do not deeply understand testing, Playwright, CI, baselines, mutation testing, or visual diffing.
2. **Advanced teams** managing large applications that require fine-grained control over targets, contracts, schedules, protected environments, visual thresholds, LLM usage, provider adapters, artifacts, and governance.

The final product should make visual QA feel like a guided, understandable workflow while preserving enough depth for serious engineering teams.

---

# Product Thesis

Visual Hive turns visual testing from isolated screenshot checks into a layered, project-aware quality system.

A mature Visual Hive installation should be able to answer:

- What parts of my app are visually covered?
- What user-visible contracts protect my most important flows?
- What runs on every PR?
- What runs only on a schedule?
- What requires secrets or protected environments?
- What broke visually?
- Was the change intentional?
- What files likely caused the regression?
- What tests are missing?
- Would my current test suite catch common UI breakages?
- What should an AI or developer do next to fix the issue?
- How much do LLM/provider integrations cost?
- Which repos in my org have weak visual coverage?

Visual Hive should not merely detect differences. It should help users build and maintain a visual quality system.

---

# Product Shape

Visual Hive has four major layers:

```text
Visual Hive Core
  CLI, config schema, planner, runner, mutation engine, reports, triage

Visual Hive Integrations
  GitHub Actions, GitHub App future path, provider adapters, LLM adapters

Visual Hive Control Plane
  UI for configuration, coverage, runs, failures, baselines, schedules, LLMs, providers, repos

Visual Hive Dogfooding / Examples
  demo app, KubeStellar Console example, real repo integration patterns
```

The CLI/core engine must remain usable without the UI. The UI must act as a control plane over the same config, reports, artifacts, and workflows.

---

# Non-Negotiable Principles

## Deterministic-first

Deterministic tests decide pass/fail.

Allowed pass/fail sources:

- Playwright selector assertions
- Playwright user-flow assertions
- screenshot comparisons with thresholds
- route assertions
- console/page/network error assertions
- mutation adequacy thresholds
- provider-normalized deterministic results

LLM output must never be the sole pass/fail oracle.

## AI-amplified, not AI-dependent

LLMs may:

- explain failures
- summarize visual diffs
- classify likely causes
- suggest missing tests
- draft issues
- draft repair prompts
- review mutation survivors
- help generate contracts

LLMs may not:

- silently approve baselines
- override deterministic failures
- decide CI pass/fail alone
- access secrets
- run untrusted code in privileged contexts

## Secure by default

- PR workflows must use `pull_request`, not `pull_request_target`, when executing untrusted PR code.
- PR workflows should be read-only and no-secret by default.
- Protected targets may require secrets, but only on scheduled/manual trusted workflows.
- Secret values must never be printed.
- Required secrets may be shown by name only.
- Issue creation should happen from sanitized artifacts in a trusted workflow, not directly from untrusted PR execution.
- Config changes from the UI should show diffs before saving.
- The UI must prevent path traversal.
- LLM prompts must be sanitized.
- Provider credentials must be optional and never required for the default path.

## Local-first, cloud-ready

Visual Hive should work locally and in GitHub Actions without a hosted backend.

A future cloud/GitHub App Control Plane should be possible, but the local-first experience must remain complete enough to be useful.

## No paid provider required by default

Visual Hive may support optional providers such as Argos, Percy, Chromatic, Applitools, Storybook, GitHub Checks, Slack, Jira, Linear, etc.

But the default working path must be:

```text
Visual Hive CLI + Playwright + GitHub Actions + local artifacts
```

---

# Finished Product Definition

Visual Hive is considered substantially complete when the following are true.

## CLI/Core

The CLI can:

- initialize a repo
- validate config
- create a plan
- run deterministic contracts
- run mutation adequacy
- generate reports
- generate triage findings
- generate issue bodies
- generate repair prompts
- start the Control Plane UI
- manage baselines
- inspect providers
- support safe GitHub workflow templates

## Config

The config can model:

- project metadata
- visual diff thresholds
- targets
- contracts
- route/viewports/screenshots
- selector/text assertions
- wait conditions
- console/page/network handling
- schedule rules
- changed-file selection rules
- mutation operators and mappings
- AI settings
- GitHub settings
- provider settings
- protected environments
- secrets by name only

## Targets

Visual Hive supports:

- `url`
- `command`
- `commandGroup`
- `protected`
- future deploy preview targets
- future Storybook/component targets

Targets must support:

- install
- build
- setup
- service start
- readiness checks
- deterministic test execution
- artifact collection
- service shutdown
- teardown
- lifecycle reporting
- missing secret handling

## Planner

The planner selects tests based on:

- mode: PR, schedule, manual, canary, mutation, full
- changed files
- target safety
- target cost
- severity
- runOn settings
- schedule settings
- protected target restrictions
- provider availability
- mutation applicability
- docs-only changes
- explicit include/exclude rules

Every inclusion or exclusion must have a human-readable reason.

## Runner

The deterministic runner must:

- generate readable Playwright specs
- avoid `networkidle` as the default
- use `domcontentloaded` plus explicit readiness selectors
- support screenshots with tolerance
- support screenshot masks
- support actual/baseline/diff artifacts
- support local baseline creation
- support CI missing-baseline failure
- support baseline update policy
- capture console errors
- capture page errors
- capture failed network responses where practical
- emit structured report metadata
- produce reproduction commands

## Reports

Reports should be machine-readable and human-useful.

A full report should include:

- schema version
- project
- repository metadata where available
- mode
- branch/commit/PR where available
- generated timestamp
- status
- changed files
- selected targets
- selected contracts
- excluded contracts with reasons
- target lifecycle events
- generated spec path
- per-contract results
- selector assertions
- text assertions
- screenshot metadata
- visual diff metadata
- console/page/network errors
- artifacts
- reproduction commands
- provider results
- LLM prompt metadata
- summary counts

## Triage

Triage should classify failures as:

- `visual_diff`
- `missing_baseline`
- `created_baseline`
- `missing_element`
- `unexpected_element`
- `login_regression`
- `api_contract_regression`
- `console_error`
- `page_error`
- `target_startup_failure`
- `mutation_survivor`
- `possible_flake`
- `no_contracts_selected`
- `environment_failure`
- `provider_failure`
- `flaky_baseline`
- `protected_target_missing_secret`
- `insufficient_coverage`

Triage should generate:

- `issue.md`
- `triage-prompt.md`
- `repair-prompt.md`
- `missing-tests.md`
- PR comment markdown
- issue markdown
- suggested files to inspect
- suggested next tests
- likely root-cause context

## Mutation Adequacy

Mutation testing should measure whether the suite catches intentional breakage.

Support:

- operator metadata
- explicit operator-to-contract mapping
- heuristic operator-to-contract mapping
- killed / survived / not_applicable outcomes
- score calculation
- min score enforcement
- survived mutation recommendations
- mutation trend/history if available

Core operators should include:

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

Mutation survivors should create actionable recommendations.

Example:

```text
Survived mutation: api-500
Recommendation: Add an error-state contract for dashboard cards.
```

---

# Control Plane UI Goal

The Visual Hive UI is a **Control Plane**, not a passive dashboard.

It should make Visual Hive usable by people who do not understand testing deeply, while still exposing advanced controls for complex apps.

## Control Plane must support

### Local-first mode

Command:

```bash
visual-hive ui --repo <path> --port <port>
```

Options:

```bash
visual-hive ui --repo <path>
visual-hive ui --config <path>
visual-hive ui --port <port>
visual-hive ui --open
visual-hive ui --read-only
visual-hive ui --demo
```

The UI should read:

- `visual-hive.config.yaml`
- `.visual-hive/plan.json`
- `.visual-hive/report.json`
- `.visual-hive/mutation-report.json`
- `.visual-hive/issue.md`
- `.visual-hive/triage-prompt.md`
- `.visual-hive/repair-prompt.md`
- `.visual-hive/missing-tests.md`
- `.visual-hive/artifacts/**`
- `.visual-hive/snapshots/**`

### Future connected mode

Eventually, the Control Plane should support:

- GitHub App installation
- multi-repo management
- artifact ingestion
- setup PR creation
- workflow scheduling
- provider management
- LLM usage tracking
- org-wide coverage dashboards
- audit logs
- team policies

The local-first UI should be designed so that this future path is natural.

---

# Control Plane Pages

The finished UI should include these pages.

## 1. Overview

Show:

- Visual QA health score
- latest deterministic status
- latest mutation score
- failed contracts
- baselines created
- missing baselines
- visual diffs
- console/page errors
- LLM prompt availability
- issue body availability
- selected targets
- selected contracts
- next recommended action

The health score must be explainable, not magic.

Example beginner messages:

```text
Your fast PR checks are passing.
Three baselines were created and need review.
Mutation score is low: some intentional breakages were not caught.
No report found yet. Run visual-hive plan && visual-hive run.
```

## 2. Runs / Reports

Show:

- run metadata
- selected targets
- selected contracts
- excluded contracts and reasons
- target lifecycle
- generated spec
- per-contract results
- selector assertions
- screenshots
- errors
- artifacts
- reproduction commands
- raw JSON

## 3. Failure Inbox

Show failed contracts and triage findings.

Each failure should include:

- contract ID
- severity
- target
- route
- likely classification
- error excerpt
- changed files
- artifacts
- reproduction command
- suggested files
- suggested tests
- issue.md preview
- triage prompt preview
- repair prompt preview

## 4. Screenshot / Baseline Review

Show:

- baseline image
- actual image
- diff image
- route
- viewport
- threshold
- diff pixels
- diff ratio
- artifact paths
- copy buttons
- baseline status

Do not silently approve baselines. Show diffs and require confirmation.

## 5. Mutation Adequacy

Show:

- score
- min score
- killed count
- survived count
- not applicable count
- operator results
- recommendations

Explain:

- killed = tests caught the intentional breakage
- survived = tests missed the intentional breakage
- not_applicable = mutation did not match selected contracts

## 6. Coverage Map

Show:

- targets
- contracts
- routes from screenshots
- viewports
- PR-safe vs protected coverage
- selected vs not selected
- schedule-only contracts
- uncovered areas
- changed-file coverage

The first version may be config/report-based. Future versions can add static route/component discovery.

## 7. Config Editor

Show:

- raw YAML
- parsed config
- validation errors
- project
- visual settings
- targets
- contracts
- selection rules
- mutation settings
- AI settings
- GitHub settings
- provider settings

Editing requirements:

- validate before save
- show diff before save
- require explicit confirmation
- support read-only mode
- do not silently mutate files

## 8. Target Manager

Show target cards for:

- `url`
- `command`
- `commandGroup`
- `protected`

Each card should include:

- target ID
- URL
- PR-safe status
- cost
- schedule
- required secrets by name only
- commands/services
- readiness checks
- contracts using target
- latest result
- lifecycle events

Beginner labels:

- Safe on PR
- Protected
- Expensive
- Schedule-only
- Needs setup

## 9. Contract Manager

Show:

- contract ID
- description
- target
- severity
- runOn
- waitFor
- selectors
- screenshots
- viewports
- console error rules
- latest result
- mutation mappings

Filters:

- target
- severity
- PR-safe
- failed
- not run
- route
- viewport

## 10. Schedule Manager

Show:

- PR checks
- scheduled checks
- protected checks
- mutation schedule
- workflow templates
- cron guidance
- manual dispatch guidance

Explain safe scheduling:

- PR checks should be fast/no-secret
- scheduled checks can be deeper
- protected checks may require secrets
- issue creation should use trusted artifact workflows

## 11. LLM Settings and Usage

Show:

- LLM enabled/disabled
- provider
- model
- neverSoleOracle
- daily/monthly limits
- token/cost estimates
- prompt availability
- usage history if available

No real LLM calls by default.

## 12. Provider Integrations

Show:

- built-in Playwright
- Argos
- Percy
- Chromatic
- Applitools
- Storybook
- GitHub Checks
- Slack/Jira/Linear future hooks

Each provider should show:

- enabled/disabled
- credentials present/missing by name only
- supported actions
- result normalization status
- setup docs
- mock/test status

## 13. GitHub / CI Integration

Show:

- PR workflow template
- scheduled workflow template
- trusted failure issue workflow
- security warnings
- copyable snippets

Warnings:

- no `pull_request_target` for untrusted code execution
- no secrets in PR workflow
- issue creation from trusted artifacts only
- sanitize artifacts before issue creation

## 14. Raw Artifacts

A safe browser for `.visual-hive`.

Render:

- JSON
- Markdown
- text logs
- images
- generated specs

Security:

- no path traversal
- no files outside repo root
- sanitize logs/prompts
- do not display secret values

## 15. Multi-repo / Connections

Local-first version may support:

- list local connected repo paths
- switch repo
- store local repo connections safely
- no cloud backend required

Future version should support:

- GitHub App repos
- org dashboards
- repo health scores
- policy templates
- audit trails

---

# GitHub Integration

Visual Hive should include safe GitHub templates.

## PR workflow

- `on: pull_request`
- read-only permissions
- no secrets
- plan/run/triage/report
- upload `.visual-hive` artifacts
- write step summary
- no issue creation

## Scheduled workflow

- `on: schedule` and `workflow_dispatch`
- may use protected secrets
- plan/run/mutate/triage/report
- upload artifacts

## Trusted issue workflow

- `on: workflow_run`
- consumes uploaded artifacts
- does not checkout or execute PR code
- sanitizes issue body
- dedupes by signature
- creates or updates issue

---

# LLM Governance

LLM support must be optional and governed.

Implement:

- provider interface
- offline/mock provider
- prompt builders
- token estimate abstraction
- cost estimate abstraction
- budget settings
- usage records
- redaction
- UI settings
- tests

LLM task types:

- failure explanation
- visual diff summary
- missing coverage review
- mutation survivor review
- repair prompt
- issue draft
- baseline review summary

---

# Provider Adapter Architecture

Visual Hive should support adapters without requiring paid providers.

Adapters should expose:

- availability check
- upload artifact
- compare
- fetch result
- normalize result
- emit report metadata

Adapters:

- Playwright built-in
- Argos
- Percy
- Chromatic
- Applitools
- Storybook
- GitHub Checks

Mock adapters should be implemented and tested.

---

# Dogfooding

Visual Hive must dogfood itself.

## Demo app

Must support:

- doctor
- plan
- run
- mutate
- triage
- report
- ui

## KubeStellar example

Must model:

- hosted demo no-login
- local preview visual screenshots
- fake OAuth fullstack
- protected live cluster
- docs-only no-expensive-selection
- auth changed files select auth contracts
- schedule mode selects protected targets

## Real console integration

Eventually, Visual Hive must run against:

```text
DavidDiaz0317/console
```

Minimum console dogfood:

- config
- PR workflow
- hosted-demo-never-login
- local preview dashboard screenshots
- fake OAuth planning or runtime
- no secrets in PR

---

# Packaging and Installability

Prepare for real use.

Support:

- CLI bin entry
- package exports
- install docs
- npx future usage
- GitHub Actions templates
- monorepo setup
- troubleshooting docs
- examples

Do not publish packages unless explicitly allowed.

---

# Security and Supply Chain

Audit and improve:

- dependency vulnerabilities
- workflow permissions
- action version pinning strategy
- secret redaction
- path traversal
- artifact exposure
- prompt injection surfaces
- provider credentials
- untrusted PR boundaries

Document:

- threat model
- prompt injection guidance
- GitHub workflow safety
- dependency audit status

---

# Testing Strategy

Work in loops.

After schema/planner changes:

```bash
npm test -w @visual-hive/core
```

After runner changes:

```bash
npm test -w @visual-hive/playwright-adapter
```

After CLI changes:

```bash
npm test -w @visual-hive/cli
```

After UI changes:

```bash
npm run ui:build
npm run smoke:ui
```

Full validation:

```bash
npm install
npm run build
npm run typecheck
npm test
npm run lint
npm run demo:all
npm run demo:ci
npm run smoke:cli
npm run ui:build
npm run smoke:ui
```

Also validate:

```bash
node packages/cli/dist/index.js --help
node packages/cli/dist/index.js ui --help
node packages/cli/dist/index.js plan --config examples/kubestellar-console/visual-hive.config.yaml --mode pr --changed-files examples/kubestellar-console/sample-auth-changed-files.txt
node packages/cli/dist/index.js plan --config examples/kubestellar-console/visual-hive.config.yaml --mode pr --changed-files examples/kubestellar-console/sample-docs-changed-files.txt
node packages/cli/dist/index.js plan --config examples/kubestellar-console/visual-hive.config.yaml --mode schedule
```

Fix bugs before continuing.

---

# Autonomous Work Pattern

When Codex works toward this goal, it should:

1. Inspect current state.
2. Identify highest-leverage missing piece.
3. Plan.
4. Implement.
5. Test.
6. Fix.
7. Update docs/examples.
8. Continue.

Do not stop at stubs, docs-only changes, or a shallow dashboard.

Prefer useful vertical slices:

```text
config -> plan -> run -> report -> triage -> UI display -> test -> docs
```

over disconnected broad scaffolding.

---

# Final Product Standard

The finished product should allow a user to:

1. Install Visual Hive.
2. Connect or select a repo.
3. Generate a recommended visual QA setup.
4. Run PR-safe checks.
5. Schedule deeper checks.
6. Manage protected targets.
7. Review visual diffs.
8. Approve/update baselines safely.
9. See mutation adequacy.
10. Understand failures.
11. Generate issue/repair context.
12. Control LLM usage.
13. Use optional providers.
14. Operate across complex apps.
15. Dogfood against KubeStellar Console.

Remaining gaps should be external activation items only, not missing core architecture.
