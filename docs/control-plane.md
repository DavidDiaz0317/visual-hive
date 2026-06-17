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
- Run Profiles for curated local workflows such as PR acceptance, canary health planning, full PR-safe planning, triage refresh, mutation adequacy audit, coverage improvement generation, and portfolio refresh. Profiles are built from server-generated runbook command IDs, not browser-provided shell text.
- CLI parity through `visual-hive runbook`, which writes `.visual-hive/runbook.json` and can execute the same allowlisted local command/profile IDs without opening the browser UI.
- Action history from `.visual-hive/control-plane-actions.json`, including pass/fail/blocked counts, latest command, exit codes, sanitized stdout/stderr tails, duration, expected artifacts, and safety class.
- Risk Register from `.visual-hive/risk.json` or the same core analyzer over loaded artifacts, ranking deterministic failures, baseline review needs, mutation adequacy, coverage gaps, flow coverage gaps, target safety, workflow safety, environment gaps, provider policy, and LLM governance decisions. Each risk row links into the related Contracts, Targets, Failure Inbox, Baselines, Coverage, Flows, GitHub/CI, Providers, LLM, or Raw Artifacts view.
- Setup progress and recommendations from `.visual-hive/recommendations.json` plus the current config, plan, report, mutation, triage, workflow, provider, and readiness artifacts. The Setup tab shows the current phase, percent complete, blocked/review counts, next best action, evidence, commands, and artifact links before the detailed checklist for repository inspection, Playwright presence, PR-safe target selection, detected app route hints, detected Storybook story routes, existing workflow hints, starter contracts, PR safety, generated workflow previews, setup action plan, setup file generation, local validation, setup profile selection, provider posture, cost estimate, permission guidance, setup PR guidance, and guarded actions to write the recommended config and repo setup docs
- Runs/reports with selected targets, selected/excluded contracts and reasons, selector assertions, screenshot assertion diff metadata, console/page/network evidence, artifact links, reproduction commands, target lifecycle, generated spec links, run history, and mutation/visual trend summaries
- Failure inbox from deterministic failures, triage-only findings, and mutation survivors, with classification, severity, status, target, routes, changed files, evidence, suggested files/tests, reproduction commands, artifacts, and issue/PR/prompt previews
- Baseline review with baseline, actual, diff images, diff pixel metadata, artifact path links, and copy buttons
- Mutation adequacy score with killed/survived/not-applicable/error counts, status explanations, operator metadata, expected failure kinds, failure evidence, artifact links, and missing-test recommendations from survived mutations
- Coverage map from `.visual-hive/coverage.json` or the same core analyzer over configured targets, contracts, routes, viewports, changed-file rules, selected contracts, gaps, and deterministic coverage-improvement recommendations from `.visual-hive/coverage-recommendations.json`, including guarded config-diff preview and apply actions for selected recommendations
- Flow Manager from `.visual-hive/flows.json` or the same core analyzer over deterministic user-flow steps, latest flow failures, critical contracts without flows, and recommendations for stronger user journey coverage
- Target Manager from `.visual-hive/targets.json` or the same core audit model over URL/deploy-preview/Storybook/command/commandGroup/protected targets, services, readiness checks, required secret names, lifecycle evidence, and recommendations
- Contract Manager from `.visual-hive/contracts.json` or the same core audit model over wait selectors, assertions, screenshots, console rules, latest results, mutation mappings, and recommendations
- Schedule Manager from `.visual-hive/schedules.json` or the same core audit model over PR, scheduled, protected, mutation, and trusted issue lanes, including secret-name-only readiness and workflow safety gaps
- Config validation and raw YAML
- Config editing with validation, diff preview, explicit save confirmation, and audit logging
- Setup config generation from `.visual-hive/recommendations.json`, with validation, overwrite protection, explicit confirmation, and audit logging
- Setup docs generation into `docs/visual-hive.md`, with overwrite protection, explicit confirmation, and `.visual-hive/setup-doc-edits.json`
- Setup PR bundle generation for the recommended config, repo docs, and built-in workflow templates, with overwrite protection and `.visual-hive/setup-bundle-edits.json`
- Target and contract managers
- Schedule, GitHub, LLM, and provider settings, including external upload cost-policy decisions, blocked reasons, provider setup plans, and provider governance decisions
- LLM decisions, including explicit local records to keep LLM use disabled, review it later, or approve prompt-only review in a trusted lane
- Provider setup planning, including no-network `.visual-hive/provider-setup-plan.json` artifacts that list required credential names, missing credential names, trusted workflow steps, safety checks, validation commands, warnings, and `externalCallsMade: 0`
- Provider decisions, including explicit local records to skip a supplemental provider, review it later, or approve it only for a future trusted setup review
- GitHub workflow template snippets for PR, scheduled, and trusted failure issue lanes with copy/write buttons
- Guarded workflow template generation into `.github/workflows`, with overwrite protection, explicit confirmation, and `.visual-hive/workflow-edits.json`
- Portfolio queues for connected repositories, grouping repos into broken setup, deterministic failures, stale reports, missing coverage, coverage gaps, weak mutation, high risk, blocked readiness, security risk, cost policy, and healthy queues
- Local repository connections from `.visual-hive/connections.json`, including write-mode add/remove controls and a health dashboard derived from each repo's report, mutation, coverage, risk, readiness, security, and cost artifacts
- Safe raw artifact browser for `.visual-hive`, with image previews and redacted text previews from the shared artifact index

## Safety Boundaries

- The UI reads local files only.
- Raw artifact access is restricted to the selected repository's `.visual-hive` directory.
- Repository switching is restricted to connection IDs already present in `.visual-hive/connections.json`; the browser cannot request arbitrary local paths.
- Connection add/remove actions update only `.visual-hive/connections.json`; they do not delete target repositories or artifact directories.
- Connection health is derived from local artifacts only. It can show failed deterministic runs, stale reports, missing reports, missing coverage audits, coverage gaps, weak mutation scores, high-risk registers, blocked readiness gates, security findings, and cost-policy warnings across connected repos without storing or printing secret values.
- Portfolio queues are read-only derived views over the same local connection index. They do not execute connected repo code or fetch remote repository data.
- Secret-like values are sanitized before text artifacts are returned or previewed in the artifact index.
- Baseline approval is explicit: the user reviews baseline/actual/diff images, diff metadata, and artifact paths, then confirms an approval prompt that copies the actual screenshot to the baseline path and records `.visual-hive/baseline-approvals.json`.
- Baseline rejection is explicit: the user records a reason, confirms the rejection prompt, and Visual Hive records `.visual-hive/baseline-rejections.json`; the baseline image is not changed.
- Config editing validates against the same zod schema as the CLI, returns a diff before saving, requires explicit confirmation, and records `.visual-hive/config-edits.json`.
- Coverage recommendation application reads `.visual-hive/coverage-recommendations.json`, validates the resulting config, previews a diff first, and writes through the audited config editor only after explicit confirmation.
- Setup profile regeneration writes only `.visual-hive/recommendations.json` for one of the supported deterministic profiles. It does not alter config, docs, workflows, baselines, or target code.
- Setup action recommendations are display/copy guidance until an explicit guarded write or governance-decision action is confirmed. Provider setup-plan actions write local readiness artifacts only. Provider decision actions record local decisions only. Neither action enables credentials, billing, uploads, or network calls.
- Setup config generation reads only `.visual-hive/recommendations.json`, validates `recommendedConfigYaml`, refuses to overwrite an existing config unless the user confirms the overwrite action, and records `.visual-hive/config-edits.json`.
- Setup docs generation reads only `.visual-hive/recommendations.json`, writes `docs/visual-hive.md`, refuses to overwrite existing docs unless the user confirms the overwrite action, and records `.visual-hive/setup-doc-edits.json`.
- Setup PR bundle generation preflights all output files before writing. It writes `visual-hive.config.yaml`, `docs/visual-hive.md`, and the built-in PR/scheduled/trusted-issue workflow templates only after confirmation, then records `.visual-hive/setup-bundle-edits.json`.
- Workflow template generation writes only built-in Visual Hive templates to `.github/workflows`, refuses accidental overwrites, requires explicit confirmation, and records `.visual-hive/workflow-edits.json`.
- Provider setup planning writes only `.visual-hive/provider-setup-plan.json`, records `externalCallsMade: 0`, and does not enable credentials, billing, uploads, or provider network calls.
- Provider decision recording writes only `.visual-hive/provider-decisions.json`, records `externalCallsMade: 0`, and does not enable credentials, billing, uploads, or provider network calls.
- LLM decision recording writes only `.visual-hive/llm-decisions.json`, records `externalCallsMade: 0`, and does not enable API keys, billing, model calls, or pass/fail authority.
- The Runbook page executes only allowlisted local commands in write mode: doctor, PR plan, deterministic CI run, triage/report, and mutation adequacy. It never executes trusted/protected lanes, secret-bearing lanes, or arbitrary browser-supplied shell text.
- The Runbook page also includes a safe baseline review refresh command that writes `.visual-hive/baselines.json` from existing report and review-log artifacts.
- The Profiles page executes only curated sequences of those same runbook commands. The PR acceptance profile runs doctor, PR plan, deterministic CI run, baseline review refresh, then triage/report. The mutation audit profile runs doctor, PR plan, mutation adequacy, then triage/report. The coverage improvement profile runs `visual-hive coverage` and `visual-hive improve-coverage`, producing `.visual-hive/coverage.json` and `.visual-hive/coverage-recommendations.json` for review before any guarded config apply action. The portfolio refresh profile runs security, cost, readiness, and `visual-hive connections list --write` to produce `.visual-hive/connections-portfolio.json` for multi-repo governance review.
- Protected or secret-bearing profiles are shown as guidance-only and cannot be launched from the local UI.
- Runbook execution records a bounded, sanitized audit trail in `.visual-hive/control-plane-actions.json`. Secret-like values in stdout/stderr are redacted before the action history is written or returned to the browser.
- The Actions tab renders that same audit trail so local operators can see what the UI ran and inspect sanitized output without opening raw files.
- `--read-only` disables write actions such as baseline review decisions, setup profile regeneration, setup config/docs generation, workflow template generation, provider setup planning, provider decision recording, LLM decision recording, config saving, and connection add/remove.
- `--read-only` also disables runbook execution; the Runbook remains copy-only in that mode.
- LLM/provider settings are displayed from config, but no LLM or paid provider calls happen by default.

## Baseline Approval

The Control Plane uses the same report metadata as the CLI. It only approves screenshots already listed in `.visual-hive/report.json`, and it refuses paths outside the selected repository.

The local write API requires an explicit confirmation payload before approving or rejecting a baseline. Browser actions show the baseline, actual, diff, metadata, and paths first, then ask for confirmation before mutating baseline files or writing review logs.

Equivalent CLI flow:

```bash
visual-hive baselines list --config visual-hive.config.yaml
visual-hive baselines approve --config visual-hive.config.yaml --contract dashboard-visual-stability --screenshot dashboard-desktop --viewport desktop
visual-hive baselines reject --config visual-hive.config.yaml --contract dashboard-visual-stability --screenshot dashboard-desktop --viewport desktop --reason "Not an intentional visual change"
```

Approving or rejecting a baseline does not change the historical run result. Re-run `visual-hive run --ci` after approval to verify the deterministic lane passes against the approved snapshot.

## Current Limits

This is an early local Control Plane slice. It is a real management layer over guided setup recommendations, setup profile selection, provider/cost guidance and decisions, runbook commands, actionable risk ranking, artifacts, baseline review decisions, guarded setup/config/docs edits, target/contract audits, schedule lane safety, LLM usage records, provider readiness, and local repo connections. Future slices should add richer form-based config editing and connected GitHub App ingestion.

The default dogfood command, `npm run demo:all`, now generates the management artifacts this UI consumes: `targets.json`, `contracts.json`, `flows.json`, `schedules.json`, `workflows.json`, `provider-results.json`, `risk.json`, `history.json`, `artifacts-index.json`, prompt artifacts, issue/PR markdown, reports, mutation results, and coverage. It finishes with `npm run demo:ui`, which starts the read-only local Control Plane and verifies the snapshot exposes deterministic results, setup progress, mutation score evidence, coverage recommendations, runbook commands, run profiles, and raw artifact paths.
