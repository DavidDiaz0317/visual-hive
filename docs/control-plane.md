# Visual Hive Control Plane

The Control Plane is a local-first UI over the same config, setup recommendations, plans, reports, mutation reports, prompts, and artifacts used by the CLI.

Start it from a built checkout:

```bash
node packages/cli/dist/index.js ui --config examples/demo-react-app/visual-hive.config.yaml --read-only
```

Installed CLI shape:

```bash
visual-hive ui --repo . --config visual-hive.config.yaml --port 4317 --open
```

## What It Shows

- Overview health score with explainable next actions
- Runbook commands for local readiness, PR planning, CI deterministic checks, mutation adequacy, triage/reporting, protected scheduled lanes, and opening the Control Plane. In write mode, the UI can execute a small allowlist of local Visual Hive commands by command ID and records sanitized output in `.visual-hive/control-plane-actions.json`.
- Run Profiles for curated local workflows such as PR acceptance, triage refresh, and mutation adequacy audit. Profiles are built from server-generated runbook command IDs, not browser-provided shell text.
- Action history from `.visual-hive/control-plane-actions.json`, including pass/fail/blocked counts, latest command, exit codes, sanitized stdout/stderr tails, duration, expected artifacts, and safety class.
- Risk Register from `.visual-hive/risk.json` or the same core analyzer over loaded artifacts, ranking deterministic failures, baseline review needs, mutation adequacy, coverage gaps, target safety, workflow safety, environment gaps, and provider policy. Each risk row links into the related Contracts, Targets, Failure Inbox, Baselines, Coverage, GitHub/CI, Providers, or Raw Artifacts view.
- Setup recommendations from `.visual-hive/recommendations.json`, including a guided checklist for repository inspection, PR-safe target selection, starter contracts, PR safety, setup file generation, local validation, setup profile selection, provider posture, cost estimate, permission guidance, setup PR guidance, and guarded actions to write the recommended config and repo setup docs
- Runs/reports with target lifecycle, generated spec links, run history, and mutation/visual trend summaries
- Failure inbox from deterministic failures and mutation survivors
- Baseline review with baseline, actual, diff images, diff pixel metadata, artifact path links, and copy buttons
- Mutation adequacy score and operator outcomes
- Coverage map from `.visual-hive/coverage.json` or the same core analyzer over configured targets, contracts, routes, viewports, changed-file rules, selected contracts, gaps, and deterministic coverage-improvement recommendations from `.visual-hive/coverage-recommendations.json`
- Target Manager from `.visual-hive/targets.json` or the same core audit model over URL/deploy-preview/Storybook/command/commandGroup/protected targets, services, readiness checks, required secret names, lifecycle evidence, and recommendations
- Contract Manager from `.visual-hive/contracts.json` or the same core audit model over wait selectors, assertions, screenshots, console rules, latest results, mutation mappings, and recommendations
- Schedule Manager from `.visual-hive/schedules.json` or the same core audit model over PR, scheduled, protected, mutation, and trusted issue lanes, including secret-name-only readiness and workflow safety gaps
- Config validation and raw YAML
- Config editing with validation, diff preview, explicit save confirmation, and audit logging
- Setup config generation from `.visual-hive/recommendations.json`, with validation, overwrite protection, explicit confirmation, and audit logging
- Setup docs generation into `docs/visual-hive.md`, with overwrite protection, explicit confirmation, and `.visual-hive/setup-doc-edits.json`
- Setup PR bundle generation for the recommended config, repo docs, and built-in workflow templates, with overwrite protection and `.visual-hive/setup-bundle-edits.json`
- Target and contract managers
- Schedule, GitHub, LLM, and provider settings, including external upload cost-policy decisions and blocked reasons
- Provider decisions, including explicit local records to skip a supplemental provider, review it later, or approve it only for a future trusted setup review
- GitHub workflow template snippets for PR, scheduled, and trusted failure issue lanes with copy/write buttons
- Guarded workflow template generation into `.github/workflows`, with overwrite protection, explicit confirmation, and `.visual-hive/workflow-edits.json`
- Portfolio queues for connected repositories, grouping repos into broken setup, deterministic failures, stale reports, missing coverage, coverage gaps, weak mutation, high risk, and healthy queues
- Local repository connections from `.visual-hive/connections.json`, including write-mode add/remove controls and a health dashboard derived from each repo's report, mutation, coverage, and risk artifacts
- Safe raw artifact browser for `.visual-hive`, with image previews and redacted text previews from the shared artifact index

## Safety Boundaries

- The UI reads local files only.
- Raw artifact access is restricted to the selected repository's `.visual-hive` directory.
- Repository switching is restricted to connection IDs already present in `.visual-hive/connections.json`; the browser cannot request arbitrary local paths.
- Connection add/remove actions update only `.visual-hive/connections.json`; they do not delete target repositories or artifact directories.
- Connection health is derived from local artifacts only. It can show failed deterministic runs, stale reports, missing reports, missing coverage audits, coverage gaps, weak mutation scores, and high-risk registers across connected repos without storing or printing secret values.
- Portfolio queues are read-only derived views over the same local connection index. They do not execute connected repo code or fetch remote repository data.
- Secret-like values are sanitized before text artifacts are returned or previewed in the artifact index.
- Baseline approval is explicit: the user reviews baseline/actual/diff images, diff metadata, and artifact paths, then clicks an approval button that copies the actual screenshot to the baseline path and records `.visual-hive/baseline-approvals.json`.
- Baseline rejection is explicit: the user records a reason in `.visual-hive/baseline-rejections.json`; the baseline image is not changed.
- Config editing validates against the same zod schema as the CLI, returns a diff before saving, requires explicit confirmation, and records `.visual-hive/config-edits.json`.
- Setup profile regeneration writes only `.visual-hive/recommendations.json` for one of the supported deterministic profiles. It does not alter config, docs, workflows, baselines, or target code.
- Setup config generation reads only `.visual-hive/recommendations.json`, validates `recommendedConfigYaml`, refuses to overwrite an existing config unless the user confirms the overwrite action, and records `.visual-hive/config-edits.json`.
- Setup docs generation reads only `.visual-hive/recommendations.json`, writes `docs/visual-hive.md`, refuses to overwrite existing docs unless the user confirms the overwrite action, and records `.visual-hive/setup-doc-edits.json`.
- Setup PR bundle generation preflights all output files before writing. It writes `visual-hive.config.yaml`, `docs/visual-hive.md`, and the built-in PR/scheduled/trusted-issue workflow templates only after confirmation, then records `.visual-hive/setup-bundle-edits.json`.
- Workflow template generation writes only built-in Visual Hive templates to `.github/workflows`, refuses accidental overwrites, requires explicit confirmation, and records `.visual-hive/workflow-edits.json`.
- Provider decision recording writes only `.visual-hive/provider-decisions.json`, records `externalCallsMade: 0`, and does not enable credentials, billing, uploads, or provider network calls.
- The Runbook page executes only allowlisted local commands in write mode: doctor, PR plan, deterministic CI run, triage/report, and mutation adequacy. It never executes trusted/protected lanes, secret-bearing lanes, or arbitrary browser-supplied shell text.
- The Profiles page executes only curated sequences of those same runbook commands. The PR acceptance profile runs doctor, PR plan, deterministic CI run, then triage/report. The mutation audit profile runs doctor, PR plan, mutation adequacy, then triage/report.
- Protected or secret-bearing profiles are shown as guidance-only and cannot be launched from the local UI.
- Runbook execution records a bounded, sanitized audit trail in `.visual-hive/control-plane-actions.json`. Secret-like values in stdout/stderr are redacted before the action history is written or returned to the browser.
- The Actions tab renders that same audit trail so local operators can see what the UI ran and inspect sanitized output without opening raw files.
- `--read-only` disables write actions such as baseline review decisions, setup profile regeneration, setup config/docs generation, workflow template generation, provider decision recording, config saving, and connection add/remove.
- `--read-only` also disables runbook execution; the Runbook remains copy-only in that mode.
- LLM/provider settings are displayed from config, but no LLM or paid provider calls happen by default.

## Baseline Approval

The Control Plane uses the same report metadata as the CLI. It only approves screenshots already listed in `.visual-hive/report.json`, and it refuses paths outside the selected repository.

Equivalent CLI flow:

```bash
visual-hive baselines list --config visual-hive.config.yaml
visual-hive baselines approve --config visual-hive.config.yaml --contract dashboard-visual-stability --screenshot dashboard-desktop --viewport desktop
visual-hive baselines reject --config visual-hive.config.yaml --contract dashboard-visual-stability --screenshot dashboard-desktop --viewport desktop --reason "Not an intentional visual change"
```

Approving or rejecting a baseline does not change the historical run result. Re-run `visual-hive run --ci` after approval to verify the deterministic lane passes against the approved snapshot.

## Current Limits

This is an early local Control Plane slice. It is a real management layer over guided setup recommendations, setup profile selection, provider/cost guidance and decisions, runbook commands, actionable risk ranking, artifacts, baseline review decisions, guarded setup/config/docs edits, target/contract audits, schedule lane safety, LLM usage records, provider readiness, and local repo connections. Future slices should add richer form-based config editing and connected GitHub App ingestion.

The default dogfood command, `npm run demo:all`, now generates the management artifacts this UI consumes: `targets.json`, `contracts.json`, `schedules.json`, `workflows.json`, `provider-results.json`, `risk.json`, `history.json`, `artifacts-index.json`, prompt artifacts, issue/PR markdown, reports, mutation results, and coverage.
