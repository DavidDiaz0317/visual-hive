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
- Setup recommendations from `.visual-hive/recommendations.json`
- Runs/reports with target lifecycle, generated spec links, run history, and mutation/visual trend summaries
- Failure inbox from deterministic failures and mutation survivors
- Baseline review with baseline, actual, diff images, diff pixel metadata, artifact path links, and copy buttons
- Mutation adequacy score and operator outcomes
- Coverage map from `.visual-hive/coverage.json` or the same core analyzer over configured targets, contracts, routes, viewports, changed-file rules, selected contracts, and gaps
- Target Manager from `.visual-hive/targets.json` or the same core audit model over URL/command/commandGroup/protected targets, services, readiness checks, required secret names, lifecycle evidence, and recommendations
- Contract Manager from `.visual-hive/contracts.json` or the same core audit model over wait selectors, assertions, screenshots, console rules, latest results, mutation mappings, and recommendations
- Schedule Manager from `.visual-hive/schedules.json` or the same core audit model over PR, scheduled, protected, mutation, and trusted issue lanes, including secret-name-only readiness and workflow safety gaps
- Config validation and raw YAML
- Config editing with validation, diff preview, explicit save confirmation, and audit logging
- Target and contract managers
- Schedule, GitHub, LLM, and provider settings
- GitHub workflow template snippets for PR, scheduled, and trusted failure issue lanes with copy buttons
- Local repository connections from `.visual-hive/connections.json`, including write-mode add/remove controls
- Safe raw artifact browser for `.visual-hive`, with image previews and redacted text previews from the shared artifact index

## Safety Boundaries

- The UI reads local files only.
- Raw artifact access is restricted to the selected repository's `.visual-hive` directory.
- Repository switching is restricted to connection IDs already present in `.visual-hive/connections.json`; the browser cannot request arbitrary local paths.
- Connection add/remove actions update only `.visual-hive/connections.json`; they do not delete target repositories or artifact directories.
- Secret-like values are sanitized before text artifacts are returned or previewed in the artifact index.
- Baseline approval is explicit: the user reviews baseline/actual/diff images, diff metadata, and artifact paths, then clicks an approval button that copies the actual screenshot to the baseline path and records `.visual-hive/baseline-approvals.json`.
- Baseline rejection is explicit: the user records a reason in `.visual-hive/baseline-rejections.json`; the baseline image is not changed.
- Config editing validates against the same zod schema as the CLI, returns a diff before saving, requires explicit confirmation, and records `.visual-hive/config-edits.json`.
- `--read-only` disables write actions such as baseline review decisions, config saving, and connection add/remove.
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

This is an early local Control Plane slice. It is a real management layer over setup recommendations, artifacts, baseline review decisions, guarded config edits, target/contract audits, schedule lane safety, LLM usage records, provider readiness, and local repo connections. Future slices should add richer form-based config editing and connected GitHub App ingestion.

The default dogfood command, `npm run demo:all`, now generates the management artifacts this UI consumes: `targets.json`, `contracts.json`, `schedules.json`, `workflows.json`, `provider-results.json`, `history.json`, `artifacts-index.json`, prompt artifacts, issue/PR markdown, reports, mutation results, and coverage.
