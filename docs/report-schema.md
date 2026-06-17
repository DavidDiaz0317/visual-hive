# Report Schemas

Visual Hive writes stable machine-readable JSON artifacts. `plan.json`, `recommendations.json`, `setup-progress.json`, `coverage.json`, `coverage-recommendations.json`, `contracts.json`, `flows.json`, `targets.json`, `schedules.json`, `workflows.json`, `risk.json`, `readiness.json`, `security.json`, `costs.json`, `history.json`, `triage.json`, `llm-usage.json`, `llm-decisions.json`, `connections.json`, `connections-portfolio.json`, `provider-results.json`, `provider-decisions.json`, `provider-setup-plan.json`, `artifacts-index.json`, `baseline-approvals.json`, and `baseline-rejections.json` use `schemaVersion: 1`; deterministic and mutation reports use `schemaVersion: 2`. Markdown artifacts such as `triage-prompt.md`, `repair-prompt.md`, `missing-tests.md`, and `baseline-review.md` are sanitized human-review artifacts, not pass/fail oracles.

## Plan

Path: `.visual-hive/plan.json`

Schema: `schemas/visual-hive.plan.schema.json`

The plan records selected targets, contracts, changed files, effective changed files after ignored-file filtering, ignored changed files with reasons, exclusion reasons, mutation selection, and provider policy evidence. Provider policy rows explain provider availability, missing credential names, external upload cost-policy decisions, estimated external screenshot counts, and `externalCallsPlanned: 0` for the default planner. A plan with no selected contracts is treated as an error by the CLI unless every PR changed file matched `selection.ignoreChangedFiles`; that intentional no-op case is written as an empty plan.

Supported plan modes are `pr`, `schedule`, `manual`, `canary`, `mutation`, and `full`. `canary` keeps scheduled low-cost PR-safe contracts separate from deeper scheduled checks. `mutation` plans only mutation-applicable contracts by default. `full` is an explicit trusted-mode plan and can include protected or expensive targets.

## Setup Recommendations

Path: `.visual-hive/recommendations.json`

Schema: `schemas/visual-hive.recommendations.schema.json`

The setup recommendation report is written by `visual-hive recommend`. It records detected framework/package-manager signals, visible `data-testid` selectors, static route hints, detected Storybook story files and iframe routes, setup profile, provider recommendations, CI/runtime and external screenshot cost estimates, PR/scheduled permission guidance, setup PR guidance, a validated starter config object, YAML for `visual-hive.config.yaml`, a recommended local preview or Storybook target, starter contracts, a structured onboarding checklist, guarded setup actions, next commands, findings, and warnings. New reports include `onboardingChecklist` rows with `ready | review | blocked` status, evidence, operator action, optional command, and related artifact paths. They also include `setupActions` rows with command, files written, confirmation requirement, safety notes, and expected outcome, so the CLI and Control Plane can show beginner-friendly setup choices without hiding writes or provider-governance boundaries.

## Setup Progress

Path: `.visual-hive/setup-progress.json`

Schema: `schemas/visual-hive.setup-progress.schema.json`

The setup progress report is written by `visual-hive setup-status`. It combines the setup recommendation, config validation state, plan, deterministic report, mutation report, triage report, workflow audit, provider setup plan, and readiness gate into one beginner-facing status. It records `status`, `phase`, completion counts, blocked/review counts, the next best action, commands to run, evidence, and artifact paths. The Control Plane Setup page uses the same core analyzer, so CLI and UI onboarding state stay consistent.

## Coverage Recommendations

Path: `.visual-hive/coverage-recommendations.json`

Schema: `schemas/visual-hive.coverage-recommendations.schema.json`

The coverage improvement report is written by `visual-hive improve-coverage`. It combines `.visual-hive/coverage.json`, optional `.visual-hive/flows.json`, and optional `.visual-hive/mutation-report.json` into deterministic config recommendations. Summary counters separate recommendations from coverage gaps, flow gaps, and mutation survivors. Recommendation kinds include starter contracts, screenshots, selector assertions, flow steps, changed-file rules, and mutation mappings. Recommendations may include `lane` and `trustedOnly` so protected or secret-bearing work is not presented as PR-safe beginner work. `visual-hive improve-coverage --apply <id>` previews a validated diff; `--yes` is required before writing `visual-hive.config.yaml`.

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

The provider-results artifact is written by `visual-hive providers list --mock-results` after a deterministic run. It exercises the provider adapter lifecycle without making paid-provider or external network calls. Each provider row records availability, upload/compare/fetch/normalize/metadata operations where applicable, normalized provider status, missing credential names, warnings, sanitized artifact paths, network mode, upload mode, local artifact counts, and provider-specific normalized metadata. Playwright remains the deterministic oracle; mock provider output is supplemental evidence only.

When this artifact exists before `visual-hive triage`, `.visual-hive/triage.json` records it under `sourceArtifacts.providerResults`, offline findings include provider credential failures and cost-policy upload blocks, `triage-prompt.md` includes the sanitized provider adapter JSON, and `issue.md` / `pr-comment.md` include provider adapter operation evidence.

## Provider Decisions

Path: `.visual-hive/provider-decisions.json`

Schema: `schemas/visual-hive.provider-decisions.schema.json`

Provider decisions are local governance records written through the shared core helper used by both the CLI and Control Plane. They record provider ID, optional label, decision (`skip`, `review_later`, or `approve_trusted_setup`), sanitized reason, timestamp, source (`cli` or `control-plane`), and `externalCallsMade: 0`. They do not enable credentials, billing, external uploads, or provider network calls.

When present, `.visual-hive/provider-decisions.json` is also loaded by `visual-hive risk` and `visual-hive readiness`. Risk reports surface provider-decision rows as trusted-only governance evidence, and readiness reports show whether optional providers remain local-only, have recorded skip/review decisions, or conflict with an enabled external-provider config. These gates are advisory governance evidence only; deterministic Playwright contracts remain the pass/fail oracle.

## Provider Setup Plan

Path: `.visual-hive/provider-setup-plan.json`

Schema: `schemas/visual-hive.provider-setup-plan.schema.json`

The provider setup plan is written by `visual-hive providers plan --provider <id>`. It is a no-network readiness artifact for a maintainer-controlled setup review. It records provider ID, label, recommendation, readiness metadata, required and missing environment variable names, whether external authorization is required, config changes to review, trusted workflow steps, safety checks, validation commands, warnings, and `externalCallsMade: 0`.

The setup plan does not enable a provider, create credentials, upload screenshots, make provider API calls, or change deterministic pass/fail authority. Missing credentials are reported by environment variable name only.

## Schedule Audit

Path: `.visual-hive/schedules.json`

Schema: `schemas/visual-hive.schedules.schema.json`

The schedule audit records the pull request, scheduled, protected, mutation, and trusted issue lanes. It includes lane commands, triggers, contract IDs, target IDs, required secret names, missing secret names, safety gaps, and recommendations. It is used by the Control Plane Schedule Manager and should not contain secret values.

## Flow Audit

Path: `.visual-hive/flows.json`

Schema: `schemas/visual-hive.flows.schema.json`

The flow audit is written by `visual-hive flows`. It records deterministic user-flow coverage per contract, classifies steps as navigation, interaction, wait, or assertion, connects latest report flow-step failures back to contracts, and highlights gaps such as critical contracts without flows, flows without explicit navigation, flows with interactions but no flow assertions, and selected flow contracts with latest failures.

## Workflow Safety Audit

Path: `.visual-hive/workflows.json`

Schema: `schemas/visual-hive.workflows.schema.json`

The workflow safety audit scans GitHub Actions YAML and records actual workflow evidence: triggers, permissions, PR secret usage, `pull_request_target`, artifact upload, hidden-file upload settings, step-summary usage, baseline review queue generation, issue creation, artifact download, checkout usage, trusted issue `issue.md` artifact discovery, defensive issue-body redaction, external action references, action pinning posture, and Visual Hive command usage. It flags unsafe PR workflows, trusted issue workflows that checkout code, missing artifact upload, missing `.visual-hive/baselines.json` generation, brittle fixed-path issue artifact reads, missing trusted issue redaction, missing dedupe patterns, and low-severity tag/unpinned external actions that should be full-SHA pinned for production hardening.

When `.visual-hive/workflows.json` exists before `visual-hive triage` runs, `.visual-hive/issue.md` includes a sanitized "Workflow safety" section with the audit summary and highest-priority findings. `.visual-hive/pr-comment.md` also records the workflow finding count for PR review context. This keeps trusted issue workflows focused on uploaded artifacts and avoids checking out or executing untrusted PR code.

## Risk Register

Path: `.visual-hive/risk.json`

Schema: `schemas/visual-hive.risk.schema.json`

The risk register is written by `visual-hive risk`. It prioritizes evidence from the current plan, deterministic report, mutation report, coverage, flow audit, target audit, contract audit, schedule audit, workflow audit, provider policy, provider decisions, provider setup plans, LLM decisions, and run history. It records a bounded risk score, severity counts, PR-blocking count, trusted-only count, loaded input artifacts, and one row per risk.

Risk categories include deterministic failures, baseline review needs, mutation adequacy gaps, coverage gaps, flow coverage gaps, target safety, workflow safety, provider policy, LLM governance, environment gaps, and planning gaps. Provider setup-plan risks flag enabled external providers without a matching no-network setup plan, or setup plans that are still blocked by credential-name or cost-policy evidence. Risk rows include sanitized evidence, related contract/target IDs, artifact paths, suggested actions, and whether the issue blocks the PR-safe lane or belongs in a trusted lane. The risk register is a prioritization layer only; deterministic Playwright contracts and mutation adequacy remain the evidence source.

## Readiness Gate

Path: `.visual-hive/readiness.json`

Schema: `schemas/visual-hive.readiness.schema.json`

The readiness gate is written by `visual-hive readiness`. It combines the current plan, deterministic report, baseline review queue, mutation report, workflow audit, security audit, cost audit, provider policy, provider decisions, provider setup plans, LLM decisions, run history, and LLM governance into a single go/no-go summary for enabling or reviewing Visual Hive automation. Gates use `passed`, `warning`, `blocked`, or `missing`; the top-level status is `ready`, `attention`, or `blocked`. This artifact is guidance and adoption evidence only. Deterministic Playwright contracts, screenshot diffs, and mutation adequacy remain the pass/fail evidence.

When `.visual-hive/readiness.json` exists, `visual-hive report` includes a readiness summary in both Markdown and JSON output. `visual-hive triage` also threads the readiness result into sanitized `.visual-hive/issue.md` and `.visual-hive/pr-comment.md` so PR reviewers can see whether adoption gates are ready, blocked, or missing evidence without opening every supporting artifact.

## Security Audit

Path: `.visual-hive/security.json`

Schema: `schemas/visual-hive.security.schema.json`

The security audit is written by `visual-hive security`. By default it is local/offline: it audits Visual Hive config posture, workflow safety, protected target setup, provider governance, and LLM governance without running npm audit or making provider/LLM calls. Pass `--audit-json <path>` to ingest an existing `npm audit --json` artifact, or `--npm-audit` in a trusted environment to run npm audit directly.

Top-level fields include project, generated timestamp, summary score, finding counts, input flags, npm audit summary, findings, and recommendations. Findings use categories such as workflow, secrets, protected_target, provider, llm, dependency, artifact, and policy. Evidence is sanitized before writing. Secret values are never required; protected targets and providers should expose required environment variable names only.

## Cost Audit

Path: `.visual-hive/costs.json`

Schema: `schemas/visual-hive.costs.schema.json`

The cost audit is written by `visual-hive costs`. It turns config, plan, deterministic report, mutation report, and provider result artifacts into a budget posture report. It does not call external providers or change pass/fail behavior.

Top-level fields include selected contract/target counts, local screenshot volume, estimated external screenshot volume, external calls planned/made, provider budget status, expensive selected targets, mutation operator count, configured cost policy, per-target rows, per-provider rows, cost risks, and recommendations. The default path should report `externalCallsPlanned: 0`; any future adapter that makes calls must make those calls explicit in provider artifacts and cost reports.

## Triage Report

Path: `.visual-hive/triage.json`

Schema: `schemas/visual-hive.triage.schema.json`

The triage report is written by `visual-hive triage`. It records offline deterministic classifications, severity counts, source artifact paths, evidence, related contract/target IDs, suggested files to inspect, and suggested next tests. It is sanitized before writing and is the machine-readable source for the Control Plane Failure Inbox. LLM prompts and GitHub markdown are generated from the same findings, but deterministic reports remain the pass/fail oracle. Source artifacts can include deterministic report, mutation report, coverage report, provider-results report, and baseline approval/rejection logs.

## Run History

Path: `.visual-hive/history.json`

Schema: `schemas/visual-hive.history.schema.json`

The run history index records archived run entries created by `visual-hive history --record`. Each entry summarizes deterministic status, selected contracts and targets, changed files, visual diff counts, baseline counts, console/page errors, mutation score, provider statuses, and links to archived artifacts. The top-level `trend` object compares the latest recorded run with the previous one and records direction, deterministic status change, mutation score delta, failed contract delta, visual diff delta, baseline deltas, console/page error deltas, and human-readable reasons. Text artifacts copied into history, including `issue.md`, `pr-comment.md`, and `baseline-review.md`, are sanitized. `triage.json` is archived as structured sanitized JSON.

`risk.json` and `readiness.json` may include optional run-history evidence when `.visual-hive/history.json` exists. A regressed trend is reported as `history_regression` risk evidence and as a `history` readiness gate; missing history is not treated as missing readiness evidence for first-time setup.

## LLM Usage

Path: `.visual-hive/llm-usage.json`

Schema: `schemas/visual-hive.llm-usage.schema.json`

The LLM usage artifact is written by `visual-hive triage` and can be refreshed independently with `visual-hive llm`. It records prompt tasks, token estimates, cost estimates, budget status, advisory-only policy, and `callsMade: 0`. The task enum includes `baseline_review_summary` for `.visual-hive/baseline-review.md`, which summarizes screenshot review evidence and baseline approval/rejection decisions without changing baselines. It is governance evidence for future trusted LLM integrations; it is not a model response log.

## LLM Decisions

Path: `.visual-hive/llm-decisions.json`

Schema: `schemas/visual-hive.llm-decisions.schema.json`

LLM decisions are local governance records written through the shared core helper used by both the CLI and Control Plane. They record decision (`keep_disabled`, `review_later`, or `approve_trusted_prompt_only`), sanitized reason, timestamp, source (`cli` or `control-plane`), and `externalCallsMade: 0`. They do not create API keys, call a model, upload artifacts, or change deterministic pass/fail authority.

When present, `.visual-hive/llm-decisions.json` is loaded by `visual-hive risk` and `visual-hive readiness`. Risk reports surface the latest decision as `llm_governance` evidence, and readiness reports show whether LLM usage remains disabled, approved for prompt-only trusted review, or conflicts with a non-none LLM provider in config. These signals are governance checks only; they never make a model response authoritative.

## Artifact Index

Path: `.visual-hive/artifacts-index.json`

Schema: `schemas/visual-hive.artifacts.schema.json`

The artifact index inventories files under `.visual-hive`, classifies renderable artifacts, and stores sanitized previews for text-like files. Image files are linked for rendering through the Control Plane image endpoint, while JSON, Markdown, logs, YAML, text, and generated specs receive redacted previews.

## Local Repository Connections

Path: `.visual-hive/connections.json`

Schema: `schemas/visual-hive.connections.schema.json`

The connections store records local repository paths, config paths, labels, and tags for repos managed from the local Control Plane. Readiness status, latest deterministic status, mutation score, coverage gaps, risk score, readiness gates, security score, and cost budget status are inspected at runtime by `visual-hive connections list` and the Control Plane. It stores no credentials or secret values.

Path: `.visual-hive/connections-portfolio.json`

Schema: `schemas/visual-hive.connections-portfolio.schema.json`

The connections portfolio artifact is written by `visual-hive connections list --write`. It records the derived runtime index: current and stored connections, health summaries, portfolio queues, top attention items, and warnings. It is intended for GitHub artifact uploads, Control Plane ingestion, and local multi-repo governance review. It is derived from local artifacts and should not be edited by hand.

## Baseline Review Logs

Paths: `.visual-hive/baselines.json`, `.visual-hive/baseline-approvals.json`, `.visual-hive/baseline-rejections.json`

Schemas: `schemas/visual-hive.baselines.schema.json`, `schemas/visual-hive.baseline-approvals.schema.json`, `schemas/visual-hive.baseline-rejections.schema.json`

`visual-hive baselines list --write` writes `.visual-hive/baselines.json`, a machine-readable review queue derived from `report.json`, `.visual-hive/baseline-approvals.json`, and `.visual-hive/baseline-rejections.json`. It includes total/passed/failed/created/missing/pending/approved/rejected counts plus per-screenshot baseline, actual, diff, threshold, and review-decision metadata.

Baseline approvals are explicit review decisions that copy the actual screenshot listed in `report.json` to the baseline path and record the source status, route, viewport, paths, byte count, and review timestamp. Baseline rejections are explicit review decisions that leave the baseline image unchanged and record the actual/baseline/diff paths plus an optional sanitized reason. These artifacts are local review evidence used by the Control Plane and CLI; none of them changes the historical deterministic report result.

## Mutation Report

Path: `.visual-hive/mutation-report.json`

Schema: `schemas/visual-hive.mutation-report.schema.json`

The mutation report records one row per operator. `score` is killed applicable mutations divided by total applicable mutations. A mutation is killed when deterministic contracts fail under the injected mutation. Non-applicable mutations have status `not_applicable` and are excluded from the score denominator.
