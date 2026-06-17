# Setup Recommendations

`visual-hive recommend` inspects a target repository and writes `.visual-hive/recommendations.json`. It is a bootstrap aid for real repos that do not yet have a Visual Hive config.

The command detects:

- package manager and root package scripts
- frontend framework hints from dependencies
- existing Playwright dependency, script, and config-file hints
- stable `data-testid` selectors in source files
- static route hints from common `to`, `href`, route, and path declarations
- Storybook story files and the first few runnable iframe routes when Storybook is detected
- existing GitHub workflow hints, including triggers, permissions, secret references, Visual Hive usage, and `pull_request_target`
- a likely PR-safe target, including `localPreview` for single-service apps or `commandGroup` for detected fullstack/fake-OAuth script sets
- starter visual contracts: an app-shell contract plus route-specific contracts for detected app routes, or Storybook component contracts for component-library repos
- an opinionated setup profile such as `free-local`, `component-storybook`, or `complex-app`
- provider recommendations that keep Playwright as the default oracle and external uploads disabled by default
- CI runtime, screenshot, and external upload cost estimates
- PR/scheduled permission guidance and required secret names only
- setup PR file list, steps, and security notes
- a structured setup action plan for "Use free local setup", "Enable hosted review", "Skip provider", "Generate config", and "Preview setup PR"
- repo-specific setup documentation for `docs/visual-hive.md`
- initial changed-file selection and mutation operators

It does not run target code, call LLMs, contact paid visual providers, or decide pass/fail. Playwright contracts remain the only deterministic oracle once the generated config is used.

## Commands

```bash
visual-hive recommend
visual-hive recommend --profile hosted-review
visual-hive recommend --write-config --write-docs
visual-hive recommend --write-setup-bundle
visual-hive recommend --write-config --force
visual-hive recommend --write-docs --force
visual-hive recommend --write-setup-bundle --force
visual-hive recommend --format json
visual-hive setup-status
```

`--profile` overrides the inferred setup profile. Supported profiles are `free-local`, `hosted-review`, `component-storybook`, `enterprise-visual-ai`, and `complex-app`. Profile selection changes the generated `project.setupProfile`, provider recommendations, estimated external screenshot budget, scheduled-lane permission guidance, and `costPolicy.maxExternalScreenshotsPerRun`. It still keeps PR external uploads disabled by default and does not make provider calls.

`--write-config` creates `visual-hive.config.yaml` from the recommendation. Existing configs are protected unless `--force` is passed.

`--write-docs` creates `docs/visual-hive.md` from the same deterministic recommendation data. It explains the PR lane, scheduled/protected lane, recommended contracts, provider posture, cost guardrails, baseline review commands, setup PR checklist, and security rules. Existing docs are protected unless `--force` is passed.

`--write-setup-bundle` creates the recommended config, repo docs, and built-in PR, scheduled, and trusted failure-issue workflow templates in one guarded operation. It preflights every output path and refuses to overwrite existing files unless `--force` is passed after review. The bundle records `.visual-hive/config-edits.json`, `.visual-hive/setup-doc-edits.json`, `.visual-hive/workflow-edits.json`, and `.visual-hive/setup-bundle-edits.json`.

The local Control Plane exposes the same guarded setup path from the Setup tab. It reads `.visual-hive/recommendations.json`, can regenerate that recommendation for any supported setup profile, validates `recommendedConfigYaml` for config writes, can generate `docs/visual-hive.md` from the same recommendation, refuses accidental overwrites, requires explicit confirmation, and records `.visual-hive/config-edits.json` or `.visual-hive/setup-doc-edits.json`. It can also generate the same setup PR bundle after preflighting every output path. `--read-only` disables recommendation regeneration and setup writes.

Regenerating from the Control Plane writes only `.visual-hive/recommendations.json`. It does not overwrite `visual-hive.config.yaml`, docs, or workflows. After reviewing the profile-specific recommendation, use the guarded setup actions to generate config, docs, or the setup PR bundle.

`visual-hive setup-status` writes `.visual-hive/setup-progress.json`, which turns recommendation/config/plan/run/mutation/triage/workflow/provider/readiness artifacts into a current phase and next best action. The Control Plane Setup tab uses the same core analyzer, so users who stay in the CLI and users who open the UI see the same onboarding state.

The recommendation artifact also includes `setupActions`, a deterministic list of next actions with commands, files written, confirmation requirements, safety notes, and expected outcomes. These actions are intended to power beginner-friendly UI buttons without hiding what will happen. Provider actions such as "Skip provider for now" write local governance evidence only; they do not create credentials, enable billing, upload screenshots, or call provider APIs.

## Artifact

The report schema is `schemas/visual-hive.recommendations.schema.json`.

Important fields:

- `project`: detected project name, type, package manager, scripts, and framework hints
- `setupProfile`: deterministic setup profile recommendation
- `providerRecommendations`: Playwright and optional hosted-provider guidance, required environment variable names only, and whether external upload is allowed by default
- `costEstimate`: local screenshot count, external screenshot count, CI runtime class, monthly external screenshot estimate, and notes
- `permissions`: least-privilege PR and scheduled-lane recommendations
- `setupPullRequest`: suggested setup PR title, files, steps, and security notes
- `setupActions`: guarded setup commands, writes, safety notes, confirmation requirements, and outcomes for profile selection, provider decisions, config generation, setup PR preview, and local validation
- `workflowPreviews`: built-in PR, scheduled, and trusted failure-issue workflow snippets with paths, descriptions, and safety notes
- `playwright`: existing Playwright setup status, dependency names, package scripts, config files, and notes
- `recommendedConfig`: parsed Visual Hive config object
- `recommendedConfigYaml`: YAML that can be written as `visual-hive.config.yaml`
- `recommendedTarget`: target kind, URL, commands, services, confidence, and reasons; Storybook repos can receive a `storybook` target with story/component globs, while complex apps can receive a `commandGroup` with frontend/backend/fake-OAuth services
- `recommendedContracts`: starter contracts, route or story coverage, selectors, screenshots, flow steps, and reasons
- `detectedSelectors`: top discovered `data-testid` selectors
- `detectedRoutes`: top discovered static app route hints, source files, and occurrence counts
- `detectedStories`: top discovered Storybook story files, CSF titles, named exports, and generated iframe routes
- `detectedWorkflows`: existing `.github/workflows/*.yml|yaml` files with trigger, permission, secret-reference, Visual Hive, and `pull_request_target` hints
- `warnings`: setup gaps such as missing preview scripts or missing selectors

For Storybook repositories, the generated starter contracts target up to the first three detected CSF stories through routes such as `/iframe.html?id=dashboard-card--primary&viewMode=story`. The generated selection rules include story files and `src/components/**`, so component-only changes can select the component visual lane without running unrelated app routes. Hosted Storybook providers such as Chromatic remain optional; the default contracts still run through Playwright/local artifacts.

For normal app repositories, the generated starter config keeps the app-shell contract for `/` and adds up to three route-specific visual contracts from detected route hints such as `/clusters` or `/settings`. Those route contracts include explicit `goto` flow steps, route screenshots, and changed-file rules for common route/page directories plus a general `src/**` fallback. This gives beginners useful initial coverage without requiring them to understand the full contract model on day one.

For complex repositories with explicit scripts such as `dev:web`, `dev:api`, and `fake-oauth`, the setup agent can recommend a PR-safe `commandGroup` target. It records setup commands, named services, local readiness URLs, and conservative startup timeouts so fake OAuth or local fullstack lanes can be reviewed before they are made required in CI. Secret-backed live environments should still be modeled separately as protected targets.

## Control Plane

The Control Plane Setup tab reads `.visual-hive/recommendations.json` and combines it with the current config, plan, report, mutation, triage, workflow, provider, and readiness artifacts. It shows setup progress with a current phase, percent complete, blocked/review counts, next best action, evidence, commands, and artifact links before the detailed setup profile, Playwright presence, provider recommendation, cost estimate, permission guidance, setup action plan, setup PR guidance, existing workflow hints, workflow previews, recommended target, detected app route hints, detected Storybook story iframe routes, contracts, warnings, and YAML preview. In write mode it can regenerate recommendations for `free-local`, `hosted-review`, `component-storybook`, `enterprise-visual-ai`, or `complex-app`, then generate the recommended config, `docs/visual-hive.md`, or the full setup PR bundle with confirmation and audit logging. In `--read-only` mode it remains display-only.
