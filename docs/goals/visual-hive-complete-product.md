# Visual Hive Complete Product Goal

Visual Hive should become a complete, production-grade, deterministic-first visual QA orchestration platform.

It should not remain only a CLI, screenshot diff tool, report generator, passive dashboard, or thin wrapper around existing visual testing products. It should become an end-to-end system that helps users connect repositories, understand visual risk, generate and manage visual/user-flow coverage, run safe PR checks, schedule deeper validation, measure whether tests are meaningful through mutation adequacy, manage baselines, inspect failures, govern LLM usage, optionally connect external visual providers, and operate across large complex applications.

The most important product framing:

> **Visual Hive is the visual QA orchestration and control layer. It should decide what to test, where to run it, how deeply to run it, what it costs, what is protected, what is missing, and which external tool should be used only when it adds value.**

Visual Hive should not try to out-Percy Percy, out-Chromatic Chromatic, out-Argos Argos, or out-Applitools Applitools. It should integrate with those tools when they are useful, while owning the project-aware intelligence layer they generally do not provide.

The finished product should be usable by two groups at the same time:

1. **Beginner maintainers** who do not deeply understand testing, Playwright, CI, baselines, mutation testing, visual diffing, GitHub workflow safety, provider setup, or LLM governance.
2. **Advanced teams** managing large applications that require fine-grained control over targets, contracts, schedules, protected environments, visual thresholds, provider adapters, LLM usage, artifacts, secrets, costs, and governance.

The final product should make visual QA feel like a guided, understandable workflow while preserving enough depth for serious engineering teams.

---

# Current Baseline To Preserve

Recent work has moved Visual Hive beyond a pure MVP scaffold. Future Codex runs should build on this baseline rather than recreating it:

- TypeScript npm workspace with CLI, core, Playwright adapter, GitHub adapter, LLM adapter, Control Plane UI, demo app, and KubeStellar examples.
- CLI commands for init, doctor, plan, run, mutate, triage, report, pipeline, recommend, providers, evidence packets, handoff, Hive export, Hive export mode comparison, MCP, Control Plane UI, runbook, readiness, security, costs, baselines, coverage, flows, schedules, contracts, and connections.
- Target model support for `url`, `command`, `commandGroup`, and `protected`.
- Tolerant visual diffing with baseline, actual, and diff artifacts under `.visual-hive`.
- Schema v2 deterministic reports and a Visual Hive Evidence Packet model.
- Local-first Guided Cockpit Control Plane with beginner/expert access, runbook actions, artifact inspection, provider governance visibility, and Hive-native export visibility.
- Optional Argos/provider upload path governed by policy, credentials, cost controls, and dry-run behavior.
- No-network Hive export artifacts for beads, knowledge facts, graph edges, wiki pages, issue context, repair work orders, agent policy, and side-by-side advisory/measured/repair-request mode comparison.
- Demo acceptance scripts including `demo:all`, `demo:ci`, `smoke:cli`, and `smoke:ui`.
- Console dogfooding direction through KubeStellar-style hosted demo, local preview, fake OAuth planning, and protected live-cluster modeling.

The next product work should focus on tightening vertical slices that connect scanner/recommendation, planning, execution, evidence, Control Plane guidance, provider governance, and Hive handoff into one understandable workflow.

---

# Product Thesis

Visual Hive turns visual testing from isolated screenshot checks into a layered, project-aware quality system.

A mature Visual Hive installation should be able to answer:

- What parts of my app are visually covered?
- What important user-visible contracts protect my app?
- What runs on every PR?
- What runs only on a schedule?
- What requires secrets or protected environments?
- What broke visually?
- Was the change intentional?
- What files likely caused the regression?
- What tests are missing?
- Would my current test suite catch common UI/auth/API/layout breakages?
- What should an AI or developer do next to fix the issue?
- How much do LLM/provider integrations cost?
- Which external visual provider, if any, is worth using for this repo?
- Which repos in my org have weak visual coverage?
- How do I set this up without becoming a testing expert?

Visual Hive should not merely detect differences. It should help users build and maintain a visual quality system.

---

# Strategic Positioning

Visual Hive should be built around this division of responsibility:

```text
Visual Hive owns:
  planning, orchestration, target setup, contracts, mutation adequacy,
  security policy, reports, LLM governance, repair context, cost policy,
  Control Plane UX, and repo-specific visual QA strategy.

External providers optionally own:
  hosted screenshot storage, team visual review, browser/device grids,
  visual AI comparison, Storybook publishing, enterprise collaboration,
  and mature baseline approval workflows.
```

## What Visual Hive should build in-house

Visual Hive should own these because they are the core differentiated product:

- Project-aware planning
- Changed-file risk selection
- PR-safe vs protected target decisions
- `url`, `command`, `commandGroup`, `protected`, deploy-preview, and Storybook-like targets
- User-visible contracts
- Fake OAuth / local fullstack orchestration
- Live-cluster or protected-environment scheduling
- Mutation adequacy
- Cost/risk-aware scheduling
- LLM prompt generation and governance
- Repair-ready issue context
- Coverage maps
- Beginner-friendly setup and Control Plane UX
- GitHub-safe workflow templates
- Provider selection and policy

## What Visual Hive should integrate instead of rebuilding

Visual Hive should not prioritize rebuilding these from scratch unless there is a clear product reason:

- Hosted visual review UI
- Cross-browser/device infrastructure
- Enterprise baseline collaboration
- Visual AI diffing engines
- Storybook publishing/versioning
- Team review workflows
- SSO/enterprise access control for hosted artifact review
- Long-term screenshot hosting at scale

Those should be handled through optional adapters where possible.

---

# Product Shape

Visual Hive has five major layers:

```text
Visual Hive Core
  CLI, config schema, planner, runner, mutation engine, reports, triage

Visual Hive Setup Agent
  repo scanner, setup wizard, provider recommender, cost estimator,
  config/workflow generator, setup PR generator, safe authorization guide

Visual Hive Integrations
  GitHub Actions, future GitHub App, provider adapters, LLM adapters,
  trusted artifact workflows, optional issue/comment creation

Visual Hive Control Plane
  UI for setup, configuration, coverage, runs, failures, baselines,
  schedules, LLMs, providers, costs, repos, artifacts, and governance

Visual Hive Dogfooding / Examples
  demo app, KubeStellar Console example, real repo integration patterns
```

The CLI/core engine must remain usable without the UI. The UI must act as a control plane over the same config, reports, artifacts, workflows, and setup recommendations.

---

# Non-Negotiable Principles

## Deterministic-first

Visual Hive owns the final deterministic verdict layer.

Playwright is the default first-party local browser runner and primary local deterministic evidence source, but the long-term pass/fail decision should be a Visual Hive verdict assembled from configured deterministic evidence. This distinction matters: Visual Hive should be able to normalize evidence from Playwright, screenshot diffing, mutation adequacy, console/page/network policy, accessibility/API checks, protected canaries, and explicitly trusted provider results into one governed verdict.

Allowed deterministic verdict inputs:

- Playwright selector assertions
- Playwright user-flow assertions
- screenshot comparisons with thresholds
- route assertions
- console/page/network error assertions
- mutation adequacy thresholds
- provider-normalized deterministic results when explicitly configured as trusted, gating, and budget-authorized

LLM output must never be a verdict authority.

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
- explain provider recommendations
- draft setup PR descriptions
- translate expert testing concepts for beginners

LLMs may not:

- silently approve baselines
- override deterministic failures
- decide CI pass/fail alone
- access secrets
- run untrusted code in privileged contexts
- silently connect paid tools
- silently upload screenshots/logs to a third party
- silently create GitHub secrets
- enable billing or paid-provider integrations without explicit authorization

## Secure by default

- PR workflows must use `pull_request`, not `pull_request_target`, when executing untrusted PR code.
- PR workflows should be read-only and no-secret by default.
- Protected targets may require secrets, but only on scheduled/manual trusted workflows.
- Secret values must never be printed.
- Required secrets may be shown by name only.
- Issue creation should happen from sanitized artifacts in a trusted workflow, not directly from untrusted PR execution.
- Config changes from the UI should show diffs before saving.
- Setup changes should ideally be committed through setup PRs.
- The UI must prevent path traversal.
- LLM prompts must be sanitized.
- Provider credentials must be optional and never required for the default path.
- External artifact upload must be opt-in.
- Paid provider usage must be explicit and budget-aware.

## Local-first, cloud-ready

Visual Hive should work locally and in GitHub Actions without a hosted backend.

A future cloud/GitHub App Control Plane should be possible, but the local-first experience must remain complete enough to be useful.

## Hive-native, agent-forward evidence

Visual Hive should integrate deeply with KubeStellar Hive without making Hive, LLMs, or any hosted service required for the default path.

The safest first-class integration surface is a no-network Hive-native export bundle:

```text
.visual-hive/hive/hive-export.json
.visual-hive/hive/beads.json
.visual-hive/hive/knowledge-facts.json
.visual-hive/hive/knowledge-graph.json
.visual-hive/hive/issue-context.md
.visual-hive/hive/repair-work-orders.json
.visual-hive/hive/hive-agent-policy.json
.visual-hive/hive/mode-comparison.json
.visual-hive/hive/mode-comparison.md
.visual-hive/hive/modes/advisory/**
.visual-hive/hive/modes/measured/**
.visual-hive/hive/modes/repair_request/**
.visual-hive/hive/wiki/*.md
```

The command surface should include:

```bash
visual-hive hive export --dry-run
visual-hive hive export --mode measured
visual-hive hive export --mode repair_request
visual-hive hive compare-modes
```

`visual-hive hive compare-modes` should remain no-network and write a side-by-side preview of the safe Hive export levels. It lets a maintainer compare advisory issue context, measured Beads/knowledge graph/wiki output, and guarded repair-request work orders before enabling any trusted Hive workflow. The Control Plane should surface this comparison as a beginner-friendly policy explanation and as expert-accessible artifacts.

Hive-native export modes should be governed:

- `advisory`: explain and package evidence only.
- `measured`: emit Beads, knowledge facts, graph nodes/edges, and wiki pages.
- `repair_request`: create bounded repair work orders from deterministic evidence.
- `guarded_repair`: allow repair execution only under explicit policy, branch, budget, and revalidation constraints.
- `full`: reserved for future mature automation and blocked locally until governance is proven.

Hive may route, explain, and eventually repair issues, but Visual Hive evidence and verdict policy must remain the safety boundary. A Hive repair work order must include allowed files, forbidden actions, reproduction commands, acceptance criteria, and a requirement to rerun Visual Hive before a repair can be considered complete.

## No paid provider required by default

Visual Hive may support optional providers such as Argos, Percy, Chromatic, Applitools, Storybook, GitHub Checks, Slack, Jira, Linear, etc.

But the default working path must remain:

```text
Visual Hive CLI + Playwright + GitHub Actions + local artifacts
```

---

# Setup Agent / Setup Wizard Goal

Visual Hive should make onboarding easy enough for users who are not testing experts.

The Setup Agent should not be “an LLM that does whatever it wants.” It should be a hybrid system:

```text
Deterministic scanner + policy engine + optional LLM explanation
```

The scanner/policy engine should make safety-critical decisions. The LLM may explain or draft recommendations.

## Setup Agent responsibilities

The Setup Agent should:

1. Scan the repo.
2. Detect framework, package manager, build scripts, preview scripts, Storybook, Playwright, CI workflows, likely routes, selectors, test IDs, and app type.
3. Recommend a setup profile.
4. Recommend local-only vs hosted-provider usage.
5. Estimate runtime, screenshot count, and external cost risk.
6. Generate `visual-hive.config.yaml`.
7. Generate GitHub Actions workflows.
8. Generate docs for the repo.
9. Create or preview a setup PR.
10. Guide provider connection.
11. Verify provider readiness by checking credential names only.
12. Explain what is now protected and what remains uncovered.

## Setup profiles

Visual Hive should provide opinionated setup profiles:

### Free Local

Best for early projects, open-source repos, and budget-sensitive teams.

Uses:

- Visual Hive
- Playwright
- GitHub Actions
- local artifacts
- no external provider

### Hosted Review

Best for teams needing hosted screenshot review/history.

Uses:

- Visual Hive planner
- Playwright local deterministic checks
- optional Argos or Percy upload
- scheduled or failure-only external upload by default

### Component / Storybook

Best for design systems and Storybook-heavy repos.

Uses:

- Visual Hive
- Storybook target
- Chromatic or Storybook adapter
- optional Playwright app-flow checks

### Enterprise Visual AI

Best for large apps requiring enterprise visual AI, browser/device grids, and team governance.

Uses:

- Visual Hive
- Applitools or Percy/BrowserStack-style provider
- protected/scheduled checks
- strict LLM/provider governance

### Complex App / KubeStellar

Best for dashboards, auth flows, local services, fake OAuth, and protected live environments.

Uses:

- hosted demo canary
- local preview
- fake OAuth `commandGroup`
- protected live-cluster target
- mutation adequacy
- optional hosted provider on scheduled/failure-only runs

## User authorization model

Visual Hive should eliminate manual wiring where possible, but not eliminate user authorization.

An LLM/setup agent may:

- recommend tools
- generate config
- generate workflows
- draft setup PRs
- explain tradeoffs
- identify required secrets
- suggest provider connection

It may not silently:

- install GitHub Apps
- create repository secrets
- connect paid providers
- upload artifacts externally
- accept billing
- expand permissions
- make LLM calls using paid APIs

The ideal flow:

```text
LLM recommends.
Policy engine constrains.
User authorizes.
Visual Hive configures.
GitHub Actions runs.
Providers remain optional.
```

## Setup Wizard UI

The Control Plane should include a Setup page that shows:

- detected repo facts
- recommended profile
- provider recommendation
- why this recommendation was made
- estimated CI runtime
- estimated external cost
- required permissions
- required secrets by name only
- generated config preview
- generated workflow preview
- setup PR instructions
- “Use free local setup”
- “Enable hosted review”
- “Skip provider”
- “Generate config”
- “Preview setup PR”

Empty states should teach the next command:

```bash
visual-hive recommend
visual-hive recommend --write-config
visual-hive recommend --profile hosted-review
```

---

# Provider Strategy

Visual Hive should not treat provider integrations as an afterthought, but it should also not make external providers mandatory.

## Provider roles

### Playwright

- Default first-party local browser runner and primary local evidence source.
- No paid account.
- Should always be usable.

### Argos

- Good first hosted visual adapter candidate for general Playwright screenshot review.
- Useful for teams that want hosted review without building a full review UI in Visual Hive.
- Should support mock mode and future external upload.

### Chromatic

- Strong for Storybook/component/design-system workflows.
- Should be recommended primarily when Storybook is detected or component coverage is requested.

### Percy / BrowserStack

- Strong for broader browser/device visual coverage and hosted team review.
- Should be recommended when real-device/browser matrix or team review requirements justify it.

### Applitools

- Strong for enterprise visual AI and cross-browser visual testing.
- Should be recommended only when enterprise visual AI/cross-browser/device needs justify cost/complexity.

### Storybook

- Supplemental component coverage target.
- Useful for design-system and card/component-level visual coverage.

### GitHub Checks

- Supplemental status/reporting adapter.
- Should respect trusted workflow boundaries.

## Provider cost policy

Visual Hive should make cost visible and controllable.

Config should support cost policy such as:

```yaml
costPolicy:
  maxExternalScreenshotsPerRun: 0
  maxMonthlyExternalScreenshots: 5000
  externalUpload:
    pullRequest: false
    schedule: true
    manual: true
    onFailureOnly: true
    criticalContractsOnly: true
```

The planner and Control Plane should explain:

```text
Playwright local: 42 screenshots, $0 external
Argos: skipped on PR by policy
Chromatic: skipped because no Storybook detected
Percy: missing PERCY_TOKEN
Applitools: disabled
LLM: prompt-only, no call
```

Provider usage must be recommended based on:

- user profile
- repo type
- Storybook presence
- screenshot count
- team review need
- cross-browser/device need
- budget policy
- token availability
- schedule mode
- PR safety

## Adapter standard

Adapters should expose:

- availability check
- credential-name check
- upload artifact
- compare
- fetch result
- normalize result
- emit report metadata
- cost estimate
- skipped/deferred reason
- external calls made count

Adapters must support mock mode.

No external network call should happen unless:

- provider is enabled
- mode is external
- credentials are present
- user/policy allows upload
- run mode allows provider usage
- budget constraints pass

---

# Finished Product Definition

Visual Hive is considered substantially complete when the following are true.

## CLI/Core

The CLI can:

- initialize a repo
- recommend a setup
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
- inspect coverage
- inspect contracts
- inspect targets
- inspect schedules
- inspect workflows
- inspect artifacts
- manage local repo connections
- support safe GitHub workflow templates

## Config

The config can model:

- project metadata
- setup profile
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
- provider cost policy
- protected environments
- secrets by name only
- local/future connected repo metadata

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
- provider cost policy
- mutation applicability
- docs-only changes
- explicit include/exclude rules
- setup profile

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
- provider skipped reasons
- provider cost estimates
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
- `provider_cost_policy_skipped`
- `external_upload_blocked`

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
- provider recommendation context where relevant

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
- `.visual-hive/recommendations.json`
- `.visual-hive/provider-results.json`
- `.visual-hive/llm-usage.json`
- `.visual-hive/coverage.json`
- `.visual-hive/history.json`
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
- provider billing/cost visibility
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
- provider status
- external upload policy
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
Argos is recommended for hosted review, but external uploads are disabled on PRs.
No report found yet. Run visual-hive plan && visual-hive run.
```

## 2. Setup Wizard

Show:

- detected repo facts
- package manager
- framework
- build/preview scripts
- Storybook presence
- Playwright presence
- existing workflow hints
- detected selectors/routes where practical
- recommended setup profile
- provider recommendation
- cost/runtime estimate
- required secrets by name only
- generated config preview
- generated workflow preview
- setup PR instructions

Actions:

- use free local setup
- enable hosted review
- skip provider
- generate config
- preview setup PR instructions

## 3. Runs / Reports

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
- provider results
- raw JSON

## 4. Failure Inbox

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

## 5. Screenshot / Baseline Review

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

## 6. Mutation Adequacy

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

## 7. Coverage Map

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

## 8. Config Editor

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
- cost policy

Editing requirements:

- validate before save
- show diff before save
- require explicit confirmation
- support read-only mode
- do not silently mutate files

## 9. Target Manager

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

## 10. Contract Manager

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

## 11. Schedule Manager

Show:

- PR checks
- scheduled checks
- protected checks
- mutation schedule
- provider upload schedule
- workflow templates
- cron guidance
- manual dispatch guidance

Explain safe scheduling:

- PR checks should be fast/no-secret
- scheduled checks can be deeper
- protected checks may require secrets
- issue creation should use trusted artifact workflows
- external provider upload should usually be scheduled, failure-only, or critical-contract-only by default

## 12. LLM Settings and Usage

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

## 13. Provider Integrations

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
- recommended/not recommended
- credentials present/missing by name only
- supported actions
- result normalization status
- cost policy
- estimated screenshot use
- setup docs
- mock/test status
- external calls made count

## 14. GitHub / CI Integration

Show:

- PR workflow template
- scheduled workflow template
- trusted failure issue workflow
- security warnings
- copyable snippets
- setup PR guidance

Warnings:

- no `pull_request_target` for untrusted code execution
- no secrets in PR workflow
- issue creation from trusted artifacts only
- sanitize artifacts before issue creation

## 15. Raw Artifacts

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

## 16. Multi-repo / Connections

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
- no paid provider upload by default unless explicitly allowed and no secrets are exposed

## Scheduled workflow

- `on: schedule` and `workflow_dispatch`
- may use protected secrets
- plan/run/mutate/triage/report
- optional provider upload
- upload artifacts

## Trusted issue workflow

- `on: workflow_run`
- consumes uploaded artifacts
- does not checkout or execute PR code
- sanitizes issue body
- dedupes by signature
- creates or updates issue

## Future GitHub App

Eventually support:

- repo installation
- repo selection
- setup PR generation
- artifact ingestion
- workflow scheduling
- issue/comment creation
- secret-name readiness checks
- audit logs

GitHub App permissions should be incremental and least-privilege.

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

- setup explanation
- provider recommendation explanation
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
- credential-name check
- upload artifact
- compare
- fetch result
- normalize result
- emit report metadata
- estimate cost
- explain skip/defer reason

Adapters:

- Playwright built-in
- Argos
- Percy
- Chromatic
- Applitools
- Storybook
- GitHub Checks

Mock adapters should be implemented and tested.

A real provider integration should be implemented one provider at a time, with Argos or another accessible hosted provider as the likely first candidate. External providers should supplement Visual Hive; they should not replace the default Playwright path.

---

# Dogfooding

Visual Hive must dogfood itself.

## Demo app

Must support:

- doctor
- recommend
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
- optional hosted provider policy

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
- setup wizard docs
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
- external provider upload policy
- LLM data-sharing policy

Document:

- threat model
- prompt injection guidance
- GitHub workflow safety
- dependency audit status
- provider credential handling
- setup agent authorization model

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
node packages/cli/dist/index.js recommend --help
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
scan -> recommend -> config -> plan -> run -> report -> triage -> UI display -> test -> docs
```

over disconnected broad scaffolding.

When CI is red, stop feature expansion and stabilize before continuing.

---

# Final Product Standard

The finished product should allow a user to:

1. Install Visual Hive.
2. Connect or select a repo.
3. Generate a recommended visual QA setup.
4. Choose free-local or optional provider-backed workflows.
5. Understand provider recommendations and cost tradeoffs.
6. Run PR-safe checks.
7. Schedule deeper checks.
8. Manage protected targets.
9. Review visual diffs.
10. Approve/update baselines safely.
11. See mutation adequacy.
12. Understand failures.
13. Generate issue/repair context.
14. Control LLM usage.
15. Use optional providers.
16. Operate across complex apps.
17. Dogfood against KubeStellar Console.

Remaining gaps should be external activation items only, not missing core architecture.
