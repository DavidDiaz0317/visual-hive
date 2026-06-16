# Report Schemas

Visual Hive writes stable machine-readable JSON artifacts. `plan.json`, `recommendations.json`, `coverage.json`, `coverage-recommendations.json`, `contracts.json`, `targets.json`, `schedules.json`, `workflows.json`, `risk.json`, `history.json`, `triage.json`, `llm-usage.json`, `connections.json`, `provider-results.json`, `artifacts-index.json`, `baseline-approvals.json`, and `baseline-rejections.json` use `schemaVersion: 1`; deterministic and mutation reports use `schemaVersion: 2`. Markdown artifacts such as `triage-prompt.md`, `repair-prompt.md`, `missing-tests.md`, and `baseline-review.md` are sanitized human-review artifacts, not pass/fail oracles.

## Plan

Path: `.visual-hive/plan.json`

Schema: `schemas/visual-hive.plan.schema.json`

The plan records selected targets, contracts, changed files, effective changed files after ignored-file filtering, ignored changed files with reasons, exclusion reasons, mutation selection, and provider policy evidence. Provider policy rows explain provider availability, missing credential names, external upload cost-policy decisions, estimated external screenshot counts, and `externalCallsPlanned: 0` for the default planner. A plan with no selected contracts is treated as an error by the CLI unless every PR changed file matched `selection.ignoreChangedFiles`; that intentional no-op case is written as an empty plan.

Supported plan modes are `pr`, `schedule`, `manual`, `canary`, `mutation`, and `full`. `canary` keeps scheduled low-cost PR-safe contracts separate from deeper scheduled checks. `mutation` plans only mutation-applicable contracts by default. `full` is an explicit trusted-mode plan and can include protected or expensive targets.

## Setup Recommendations

Path: `.visual-hive/recommendations.json`

Schema: `schemas/visual-hive.recommendations.schema.json`

The setup recommendation report is written by `visual-hive recommend`. It records detected framework/package-manager signals, visible `data-testid` selectors, setup profile, provider recommendations, CI/runtime and external screenshot cost estimates, PR/scheduled permission guidance, setup PR guidance, a validated starter config object, YAML for `visual-hive.config.yaml`, a recommended local preview target, starter contracts, next commands, findings, and warnings.

## Deterministic Report

Path: `.visual-hive/report.json`

Schema: `schemas/visual-hive.report.schema.json`

The report records deterministic Playwright contract results. `status` is `failed` if any selected contract failed.

Top-level fields include project, repository metadata, mode, generated time, changed files, selected targets, selected contracts, excluded contracts, generated spec path, target lifecycle events, summary counts, aggregate console/page errors, artifacts, provider results, reproduction commands, and optional `noContractsReason` for intentional ignored-file no-op runs. Summary counts include passed/failed contracts, screenshot pass/fail counts, created baselines, missing baselines, visual diffs, flow step pass/fail counts, and console/page errors.

`repository` is collected from GitHub Actions environment variables when present, then local Git metadata when available. It includes provider (`local` or `github-actions`), repository name, branch, base branch, commit SHA, pull request number, workflow/run IDs, actor, and remote URL where available. Values are sanitized before report writing.

Per-contract fields include selector assertions, user-flow step results, screenshot assertions, console/page/network errors, artifacts, duration, and a reproduction command. Flow steps record action, selector/route/value metadata, status, duration, and an error message when the deterministic user-flow action failed. Screenshot assertions include contract ID, screenshot name, route, viewport, baseline path, actual path, optional diff path, max diff thresholds, actual diff ratio, diff pixel count, and `passed | failed | created | missing_baseline` status.

`providerResults` normalizes provider adapter status. Playwright is the built-in deterministic oracle. Optional providers such as Argos, Percy, Chromatic, Applitools, Storybook, and GitHub Checks are reported as skipped, mock, available/missing-credential metadata, policy-blocked metadata, or future external adapter output. Missing credentials are listed by environment variable name only.

Each provider result can include:

- `externalUploadAllowed`: whether Visual Hive policy would allow external upload for the run context.
- `externalUploadBlockedReasons`: human-readable reasons such as PR upload disabled, pass-only run blocked by `onFailureOnly`, or screenshot budget exceeded.
- `estimatedExternalScreenshots`: the current run's local artifact count used as the conservative external screenshot estimate.

These fields are governance evidence only. The default v0.2 path still makes no paid-provider network calls.

## Provider Adapter Mock Results

Path: `.visual-hive/provider-results.json`

Schema: `schemas/visual-hive.provider-results.schema.json`

The provider-results artifact is written by `visual-hive providers --mock-results` after a deterministic run. It exercises the provider adapter lifecycle without making paid-provider or external network calls. Each provider row records availability, upload/compare/fetch/normalize/metadata operations where applicable, normalized provider status, missing credential names, warnings, sanitized artifact paths, network mode, upload mode, local artifact counts, and provider-specific normalized metadata. Playwright remains the deterministic oracle; mock provider output is supplemental evidence only.

When this artifact exists before `visual-hive triage`, `.visual-hive/triage.json` records it under `sourceArtifacts.providerResults`, offline findings include provider credential failures and cost-policy upload blocks, `triage-prompt.md` includes the sanitized provider adapter JSON, and `issue.md` / `pr-comment.md` include provider adapter operation evidence.

## Schedule Audit

Path: `.visual-hive/schedules.json`

Schema: `schemas/visual-hive.schedules.schema.json`

The schedule audit records the pull request, scheduled, protected, mutation, and trusted issue lanes. It includes lane commands, triggers, contract IDs, target IDs, required secret names, missing secret names, safety gaps, and recommendations. It is used by the Control Plane Schedule Manager and should not contain secret values.

## Workflow Safety Audit

Path: `.visual-hive/workflows.json`

Schema: `schemas/visual-hive.workflows.schema.json`

The workflow safety audit scans GitHub Actions YAML and records actual workflow evidence: triggers, permissions, PR secret usage, `pull_request_target`, artifact upload, hidden-file upload settings, step-summary usage, issue creation, artifact download, checkout usage, trusted issue `issue.md` artifact discovery, defensive issue-body redaction, and Visual Hive command usage. It flags unsafe PR workflows, trusted issue workflows that checkout code, missing artifact upload, brittle fixed-path issue artifact reads, missing trusted issue redaction, and missing dedupe patterns.

When `.visual-hive/workflows.json` exists before `visual-hive triage` runs, `.visual-hive/issue.md` includes a sanitized "Workflow safety" section with the audit summary and highest-priority findings. `.visual-hive/pr-comment.md` also records the workflow finding count for PR review context. This keeps trusted issue workflows focused on uploaded artifacts and avoids checking out or executing untrusted PR code.

## Risk Register

Path: `.visual-hive/risk.json`

Schema: `schemas/visual-hive.risk.schema.json`

The risk register is written by `visual-hive risk`. It prioritizes evidence from the current plan, deterministic report, mutation report, coverage, target audit, contract audit, schedule audit, workflow audit, and provider policy. It records a bounded risk score, severity counts, PR-blocking count, trusted-only count, loaded input artifacts, and one row per risk.

Risk categories include deterministic failures, baseline review needs, mutation adequacy gaps, coverage gaps, target safety, workflow safety, provider policy, environment gaps, and planning gaps. Risk rows include sanitized evidence, related contract/target IDs, artifact paths, suggested actions, and whether the issue blocks the PR-safe lane or belongs in a trusted lane. The risk register is a prioritization layer only; deterministic Playwright contracts and mutation adequacy remain the evidence source.

## Triage Report

Path: `.visual-hive/triage.json`

Schema: `schemas/visual-hive.triage.schema.json`

The triage report is written by `visual-hive triage`. It records offline deterministic classifications, severity counts, source artifact paths, evidence, related contract/target IDs, suggested files to inspect, and suggested next tests. It is sanitized before writing and is the machine-readable source for the Control Plane Failure Inbox. LLM prompts and GitHub markdown are generated from the same findings, but deterministic reports remain the pass/fail oracle. Source artifacts can include deterministic report, mutation report, coverage report, provider-results report, and baseline approval/rejection logs.

## Run History

Path: `.visual-hive/history.json`

Schema: `schemas/visual-hive.history.schema.json`

The run history index records archived run entries created by `visual-hive history --record`. Each entry summarizes deterministic status, selected contracts and targets, changed files, visual diff counts, baseline counts, console/page errors, mutation score, provider statuses, and links to archived artifacts. Text artifacts copied into history, including `issue.md`, `pr-comment.md`, and `baseline-review.md`, are sanitized. `triage.json` is archived as structured sanitized JSON.

## LLM Usage

Path: `.visual-hive/llm-usage.json`

Schema: `schemas/visual-hive.llm-usage.schema.json`

The LLM usage artifact is written by `visual-hive triage` and can be refreshed independently with `visual-hive llm`. It records prompt tasks, token estimates, cost estimates, budget status, advisory-only policy, and `callsMade: 0`. The task enum includes `baseline_review_summary` for `.visual-hive/baseline-review.md`, which summarizes screenshot review evidence and baseline approval/rejection decisions without changing baselines. It is governance evidence for future trusted LLM integrations; it is not a model response log.

## Artifact Index

Path: `.visual-hive/artifacts-index.json`

Schema: `schemas/visual-hive.artifacts.schema.json`

The artifact index inventories files under `.visual-hive`, classifies renderable artifacts, and stores sanitized previews for text-like files. Image files are linked for rendering through the Control Plane image endpoint, while JSON, Markdown, logs, YAML, text, and generated specs receive redacted previews.

## Local Repository Connections

Path: `.visual-hive/connections.json`

Schema: `schemas/visual-hive.connections.schema.json`

The connections store records local repository paths, config paths, labels, and tags for repos managed from the local Control Plane. Readiness status and latest deterministic status are inspected at runtime by `visual-hive connections list` and the Control Plane. It stores no credentials or secret values.

## Baseline Review Logs

Paths: `.visual-hive/baseline-approvals.json`, `.visual-hive/baseline-rejections.json`

Schemas: `schemas/visual-hive.baseline-approvals.schema.json`, `schemas/visual-hive.baseline-rejections.schema.json`

Baseline approvals are explicit review decisions that copy the actual screenshot listed in `report.json` to the baseline path and record the source status, route, viewport, paths, byte count, and review timestamp. Baseline rejections are explicit review decisions that leave the baseline image unchanged and record the actual/baseline/diff paths plus an optional sanitized reason. Both logs are local review evidence used by the Control Plane and CLI; neither changes the historical deterministic report result.

## Mutation Report

Path: `.visual-hive/mutation-report.json`

Schema: `schemas/visual-hive.mutation-report.schema.json`

The mutation report records one row per operator. `score` is killed applicable mutations divided by total applicable mutations. A mutation is killed when deterministic contracts fail under the injected mutation. Non-applicable mutations have status `not_applicable` and are excluded from the score denominator.
