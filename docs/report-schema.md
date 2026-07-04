# Report Schemas

Visual Hive writes stable machine-readable JSON artifacts. `plan.json`, `plans.json`, `pipeline.json`, `repo-map.json`, `testing-layers.json`, `recommendations.json`, `setup-pr-plan.json`, `setup-progress.json`, `control-plane-snapshot.json`, `coverage.json`, `coverage-recommendations.json`, `contracts.json`, `flows.json`, `targets.json`, `schedules.json`, `workflows.json`, `risk.json`, `readiness.json`, `security.json`, `costs.json`, `history.json`, `triage.json`, `llm-usage.json`, `llm-decisions.json`, `connections.json`, `connections-portfolio.json`, `provider-results.json`, `provider-decisions.json`, `provider-setup-plan.json`, `provider-handoff.json`, `provider-upload/argos/manifest.json`, `artifacts-index.json`, `baseline-approvals.json`, and `baseline-rejections.json` use `schemaVersion: 1`; deterministic and mutation reports use `schemaVersion: 2`; `evidence-packet.json` uses `schemaVersion: "visual-hive.evidence-packet.v2"` because contribution `key` and `authority` fields are required; `verdict.json`, `handoff.json`, `test-creation-plan.json`, `agent-packet.json`, `handoff-agent-packet.json`, `provider-agent-packet.json`, `tool-registry.json`, `context-ledger.json`, `mcp-manifest.json`, `schema-catalog.json`, `hive-export.json`, `hive-guarded-repair-preview.json`, `hive-repair-request-envelope.json`, `hive-trusted-repair-consumer-summary.json`, `hive-trusted-repair-workflow-dry-run.json`, `hive-mode-comparison.json`, `hive-bead-request.json`, `hive-handoff-result.json`, and `hive-handoff-validation.json` use versioned string schema IDs. Hive bridge sub-artifacts such as `beads.json`, `knowledge-facts.json`, `knowledge-graph.json`, `wiki-index.json`, `repair-work-orders.json`, and `hive-agent-policy.json` have standalone schemas so Hive/MCP consumers can read individual files without parsing the full export bundle or scanning the wiki directory. Markdown artifacts such as `repo-context.md`, `testing-layers.md`, `test-creation-plan.md`, `triage-prompt.md`, `repair-prompt.md`, `missing-tests.md`, `baseline-review.md`, `evidence-summary.md`, `verdict.md`, `tool-cards.md`, `hive-issue.md`, `.visual-hive/hive/issue-context.md`, `.visual-hive/hive/guarded-repair-preview.md`, `.visual-hive/hive/repair-request-envelope.md`, `.visual-hive/hive/trusted-repair-consumer-summary.md`, and `.visual-hive/hive/trusted-repair-workflow-dry-run.md` are sanitized human-review artifacts, not verdict authorities.

The Evidence Packet is the preferred agent-facing contract. It composes plan, report, mutation, provider, readiness, coverage, and triage artifacts into a sanitized Visual Hive verdict summary without making Playwright, LLMs, or providers the final authority.

## Pipeline Report

Path: `.visual-hive/pipeline.json`

Schema: `schemas/visual-hive.pipeline.schema.json`

The pipeline report is written by `visual-hive pipeline` and records the end-to-end operational acceptance sequence: doctor, analysis, planning, deterministic run, baselines, mutation adequacy when selected, governance audits, triage, evidence packet, verdict, Hive exports, handoff validation, agent packets, tool registry, context ledger, and artifact indexing. It is read by the Context Ledger, Control Plane, and `visual-hive://pipeline-status` MCP evidence resource. It is an execution summary, not an override of the Visual Hive verdict; the verdict remains in `.visual-hive/verdict.json` and the deterministic report remains in `.visual-hive/report.json`.

The run history report is written by `visual-hive history --record` and is catalog-backed as `visual-hive://run-history` / `visual_hive_read_run_history`. Newly generated history reports include `outputResource` with that same catalog identity. It records longitudinal local evidence such as deterministic status, mutation score, baseline review, runtime, and cost trend data. It is trend evidence only: reading `.visual-hive/history.json` does not rerun checks, approve baselines, infer a fresh verdict, or change gating policy.

## Plan

Path: `.visual-hive/plan.json`

Schema: `schemas/visual-hive.plan.schema.json`

The plan records selected targets, contracts, changed files, effective changed files after ignored-file filtering, ignored changed files with reasons, exclusion reasons, mutation selection, and provider policy evidence. Provider policy rows explain provider availability, missing credential names, external upload cost-policy decisions, estimated external screenshot counts, and `externalCallsPlanned: 0` for the default planner. A plan with no selected contracts is treated as an error by the CLI unless every PR changed file matched `selection.ignoreChangedFiles`; that intentional no-op case is written as an empty plan.

Supported plan modes are `pr`, `schedule`, `manual`, `canary`, `mutation`, and `full`. `canary` keeps scheduled low-cost PR-safe contracts separate from deeper scheduled checks. `mutation` plans only mutation-applicable contracts by default. `full` selects broad PR-safe coverage by default; protected or other non-PR-safe targets require `--allow-unsafe-targets` in a trusted context. The default output path is `.visual-hive/plan.json`; pass `--output .visual-hive/plan.canary.json` or another path relative to the config root to keep sidecar plan artifacts without replacing the plan consumed by `visual-hive run`.

## Plan Lane Summary

Path: `.visual-hive/plans.json`

Schema: `schemas/visual-hive.plans.schema.json`

The plan lane summary is written by `visual-hive plans`. It scans `.visual-hive/plan*.json`, then records one row per lane with mode, status, selected contract/target IDs, ignored changed-file counts, unsafe exclusions, expensive targets, mutation operators, provider policy blocks, external calls planned, and recommendations. It lets maintainers compare PR, canary, full, scheduled, mutation, and docs-only plans without replacing the active `.visual-hive/plan.json` used by `visual-hive run`. The artifact is catalog-backed as `.visual-hive/plans.json`, `visual-hive://plan-lanes`, and `visual_hive_read_plan_lanes`; newly generated lane summaries also include `outputResource` with that same identity. Reading it is lane evidence only and does not run targets, change plan policy, or override a verdict.

## Repo Map

Path: `.visual-hive/repo-map.json`

Schema: `schemas/visual-hive.repo-map.schema.json`

The repo map is written by `visual-hive analyze`. It is read-only repository intelligence for setup, planning, and agent context minimization. It is catalog-backed as `visual-hive://repo-map` / `visual_hive_read_repo_map`.

It records package manager and workspace hints, package scripts, dependency-derived frameworks, source file summary, stable `data-testid` selectors, route hints, GitHub workflow safety hints, detected test tools, target hints, risk signals, coverage gaps, and recommendations.

Newly generated repo maps include `outputResource`, the same catalog-backed resource identity used by MCP, Agent Packets, the artifact index, Tool Registry, and the Control Plane. The field is optional in the schema so older repo-map artifacts remain readable.

The companion `.visual-hive/repo-context.md` is the compact Markdown view for humans and agents, catalog-backed as `visual-hive://repo-context` / `visual_hive_read_repo_context`. The repo map and context summary do not decide pass/fail and do not grant agents permission to execute tools.

## Setup Recommendations

Path: `.visual-hive/recommendations.json`

Schema: `schemas/visual-hive.recommendations.schema.json`

The setup recommendation report is written by `visual-hive recommend`. It records detected framework/package-manager signals, visible `data-testid` selectors, static route hints, detected Storybook story files and iframe routes, setup profile, provider recommendations, CI/runtime and external screenshot cost estimates, PR/scheduled permission guidance, setup PR guidance, a validated starter config object, YAML for `visual-hive.config.yaml`, a recommended local preview or Storybook target, starter contracts, a structured onboarding checklist, guarded setup actions, next commands, findings, and warnings. New reports include `onboardingChecklist` rows with `ready | review | blocked` status, evidence, operator action, optional command, and related artifact paths. They also include `setupActions` rows with command, files written, confirmation requirement, safety notes, and expected outcome, so the CLI and Control Plane can show beginner-friendly setup choices without hiding writes or provider-governance boundaries. `outputResource` identifies the catalog-backed evidence resource as `.visual-hive/recommendations.json`, `visual-hive://setup-recommendations`, and `visual_hive_read_setup_recommendations`.

## Setup PR Plan

Path: `.visual-hive/setup-pr-plan.json`

Schema: `schemas/visual-hive.setup-pr-plan.schema.json`

`visual-hive recommend` also writes a no-network setup PR plan. It records the planned config, docs, workflow, and audit files; workflow preview metadata; validation commands; provider posture records; PR workflow security checks; setup steps; blocked/review reasons; and `externalCallsMade: 0`. It does not create a GitHub PR. It gives beginners and the Control Plane a reviewable setup PR surface before anyone runs `visual-hive recommend --write-setup-bundle` or opens a real PR. `outputResource` identifies the catalog-backed evidence resource as `.visual-hive/setup-pr-plan.json`, `visual-hive://setup-pr-plan`, and `visual_hive_read_setup_pr_plan`.

## Setup Progress

Path: `.visual-hive/setup-progress.json`

Schema: `schemas/visual-hive.setup-progress.schema.json`

The setup progress report is written by `visual-hive setup-status`. It combines the setup recommendation, config validation state, plan, deterministic report, mutation report, triage report, workflow audit, provider setup plan, provider handoff manifest, and readiness gate into one beginner-facing status. It records `status`, `phase`, completion counts, blocked/review counts, the next best action, commands to run, evidence, and artifact paths. The Control Plane Setup page uses the same core analyzer, so CLI and UI onboarding state stay consistent.

## Runbook

Path: `.visual-hive/runbook.json`

Schema: `schemas/visual-hive.runbook.schema.json`

The runbook artifact is written by `visual-hive runbook`. It exports the same curated command list and run profiles shown in the local Control Plane, including safety class, lane, required secret names, expected artifacts, `runnable`, primary `blockedReason`, full blocked reasons, and optional execution evidence. Execution remains allowlisted by command/profile ID; protected or secret-bearing lanes are guidance-only outside trusted scheduled/manual automation. The provider-governance profile runs only no-network provider readiness, setup-plan, handoff, cost, and readiness commands so optional provider adoption remains reviewable before any trusted upload lane exists.

## Coverage Recommendations

Path: `.visual-hive/coverage-recommendations.json`

Schema: `schemas/visual-hive.coverage-recommendations.schema.json`

The coverage improvement report is written by `visual-hive improve-coverage`. It combines `.visual-hive/coverage.json`, optional `.visual-hive/flows.json`, and optional `.visual-hive/mutation-report.json` into deterministic config recommendations. Summary counters separate recommendations from coverage gaps, flow gaps, and mutation survivors. Recommendation kinds include starter contracts, screenshots, selector assertions, flow steps, changed-file rules, and mutation mappings. Recommendations may include `lane` and `trustedOnly` so protected or secret-bearing work is not presented as PR-safe beginner work. The `outputResource` field points at `visual-hive://coverage-recommendations` and `visual_hive_read_coverage_recommendations`; this is read-only evidence and does not authorize edits. `visual-hive improve-coverage --apply <id>` previews a validated diff; `--yes` is required before writing `visual-hive.config.yaml`.

## Deterministic Report

Path: `.visual-hive/report.json`

Schema: `schemas/visual-hive.report.schema.json`

The report records deterministic Playwright contract results. `status` is `failed` if any selected contract failed. Contract results may include `mutationOperator` when the result was produced by the mutation adequacy runner; normal deterministic runs omit it.

Top-level fields include project, repository metadata, mode, generated time, changed files, selected targets, selected contracts, excluded contracts, generated spec path, target lifecycle events, summary counts, aggregate console/page errors, artifacts, provider results, reproduction commands, and optional `noContractsReason` for intentional ignored-file no-op runs. Summary counts include passed/failed contracts, screenshot pass/fail counts, created baselines, missing baselines, visual diffs, flow step pass/fail counts, and console/page errors.

`repository` is collected from GitHub Actions environment variables when present, then local Git metadata when available. It includes provider (`local` or `github-actions`), repository name, branch, base branch, commit SHA, pull request number, workflow/run IDs, actor, and remote URL where available. Values are sanitized before report writing.

Per-contract fields include selector assertions, user-flow step results, screenshot assertions, console/page/network errors, artifacts, duration, and a reproduction command. Flow steps record action, selector/route/value metadata, status, duration, and an error message when the deterministic user-flow action failed. Screenshot assertions include contract ID, screenshot name, route, viewport, baseline path, actual path, optional diff path, max diff thresholds, actual diff ratio, diff pixel count, and `passed | failed | created | missing_baseline` status.

`providerResults` normalizes provider adapter status. Playwright is the built-in first-party local browser runner and primary local evidence source. Visual Hive owns the final deterministic verdict. Optional providers such as Argos, Percy, Chromatic, Applitools, Storybook, and GitHub Checks are reported as skipped, mock, available/missing-credential metadata, policy-blocked metadata, future external adapter output, or explicitly configured gating evidence. Missing credentials are listed by environment variable name only.

Generated reports also include `verdictSummary` and `verdictContributions`. These fields make `report.json` usable as a standalone CI artifact while preserving the product boundary: Playwright supplies the default local evidence, and Visual Hive assembles the final deterministic verdict from normalized gating and advisory contributions. Target lifecycle failures, protected-target missing secret names, and CI missing baselines are represented as `blocked` evidence; true selector, flow, visual diff, console/page, network, mutation, or configured provider regression evidence remains `failed`. The fuller Evidence Packet still composes plan, mutation, provider, readiness, coverage, triage, and repo-intelligence artifacts into the preferred agent-facing contract.

Each provider result can include:

- `externalUploadAllowed`: whether Visual Hive policy would allow external upload for the run context.
- `externalUploadBlockedReasons`: human-readable reasons such as PR upload disabled, pass-only run blocked by `onFailureOnly`, or screenshot budget exceeded.
- `estimatedExternalScreenshots`: the current run's local artifact count used as the conservative external screenshot estimate.

These fields are governance evidence only. The default v0.2 path still makes no paid-provider network calls.

## Provider Adapter Mock Results

Path: `.visual-hive/provider-results.json`

Schema: `schemas/visual-hive.provider-results.schema.json`

The provider-results artifact is written by `visual-hive providers list --mock-results` after a deterministic run or by `visual-hive providers upload --provider argos`. Mock/list mode exercises the provider adapter lifecycle without making paid-provider or external network calls. Argos upload mode records upload status (`uploaded`, `skipped`, `blocked`, `missing_credentials`, `failed`, or `dry_run`), external call count, staged/uploaded artifact counts, sanitized command/stdout/stderr excerpts, and an optional provider URL. Each provider row records availability, upload/compare/fetch/normalize/metadata operations where applicable, normalized provider status, missing credential names, warnings, sanitized artifact paths, network mode, upload mode, local artifact counts, and provider-specific normalized metadata. Provider output is supplemental unless the config explicitly marks a normalized provider result as gating for a trusted lane.

## Provider Upload Manifest

Path: `.visual-hive/provider-upload/argos/manifest.json`

Schema: `schemas/visual-hive.provider-upload.schema.json`

The Argos upload manifest is written by `visual-hive providers upload --provider argos`. Dry-run and skipped/blocked/missing-credential paths make zero external calls. A real upload is attempted only when `providers.argos.enabled=true`, `mode=external`, `ARGOS_TOKEN` is present by name in the environment, cost policy permits the run, and the command is invoked explicitly. The manifest records deterministic status, run mode, readiness, staged actual/diff/text artifacts, upload status, uploaded artifact count, external calls made, blocked reasons, warnings, and sanitized command output. It never becomes a verdict authority unless normalized provider gating is explicitly configured for a trusted lane.

When this artifact exists before `visual-hive triage`, `.visual-hive/triage.json` records it under `sourceArtifacts.providerResults`, offline findings include provider credential failures and cost-policy upload blocks, `triage-prompt.md` includes the sanitized provider adapter JSON, and `issue.md` / `pr-comment.md` include provider adapter operation evidence.

## Provider Decisions

Path: `.visual-hive/provider-decisions.json`

Schema: `schemas/visual-hive.provider-decisions.schema.json`

Provider decisions are local governance records written through the shared core helper used by both the CLI and Control Plane. They record provider ID, optional label, decision (`skip`, `review_later`, or `approve_trusted_setup`), sanitized reason, timestamp, source (`cli` or `control-plane`), and `externalCallsMade: 0`. They do not enable credentials, billing, external uploads, or provider network calls.

When present, `.visual-hive/provider-decisions.json` is also loaded by `visual-hive risk` and `visual-hive readiness`. Risk reports surface provider-decision rows as trusted-only governance evidence, and readiness reports show whether optional providers remain local-only, have recorded skip/review decisions, or conflict with an enabled external-provider config. These gates are advisory governance evidence only unless provider gating is explicitly configured; Visual Hive remains the verdict authority.

## Provider Setup Plan

Path: `.visual-hive/provider-setup-plan.json`

Schema: `schemas/visual-hive.provider-setup-plan.schema.json`

The provider setup plan is written by `visual-hive providers plan --provider <id>`. It is a no-network readiness artifact for a maintainer-controlled setup review. It records provider ID, label, recommendation, readiness metadata, required and missing environment variable names, whether external authorization is required, config changes to review, trusted workflow steps, safety checks, validation commands, warnings, and `externalCallsMade: 0`.

## Provider Handoff Manifest

Path: `.visual-hive/provider-handoff.json`

Schema: `schemas/visual-hive.provider-handoff.schema.json`

The provider handoff manifest is written by `visual-hive providers handoff --provider <id>` after a deterministic report exists. It enumerates the exact actual/diff/baseline screenshot artifacts and context files that a trusted external-provider lane would review, marks which artifacts are eligible for upload, records blocked reasons from credential names and `costPolicy`, and includes trusted workflow steps plus validation commands. It always records `externalCallsMade: 0`; the default CLI does not upload screenshots or call provider APIs.

The setup plan does not enable a provider, create credentials, upload screenshots, make provider API calls, or change deterministic pass/fail authority. Missing credentials are reported by environment variable name only.

## Evidence Packet

Path: `.visual-hive/evidence-packet.json`

Schema: `schemas/visual-hive.evidence-packet.schema.json`

The Evidence Packet is written by `visual-hive evidence`. It is the canonical agent-forward artifact for downstream humans, GitHub issue workflows, optional provider review, LLM prompt builders, and future Hive dry-run handoff.

Key fields:

- `governance`: declares Visual Hive as verdict authority, Playwright as default browser backend, LLMs as advisory-only, providers as policy-gated when normalized, and secrets as redacted.
- `evidenceContributions`: normalized gating and advisory evidence from Playwright contracts, screenshot diffs, mutation adequacy, provider results, readiness, coverage, and triage. Each contribution includes a stable `key` plus explicit `authority: gating | advisory` so humans and agents can distinguish verdict inputs from advisory context without treating Playwright or provider-shaped fields as the final oracle.
- `verdictSummary`: `passed`, `failed`, `warning`, `blocked`, or `inconclusive`, plus `failedBecause`, `warningBecause`, `blockedBecause`, and `advisoryOnly`.
- `testingLayers`: layer coverage from repo intelligence through agent/Hive feedback.
- `hiveReadiness`: whether the packet is ready for trusted GitHub issue handoff or Hive dry-run handoff.

`visual-hive evidence` also writes `.visual-hive/evidence-summary.md`, a sanitized human-readable summary of the same verdict and handoff state.

## Testing Layers

Path: `.visual-hive/testing-layers.json`

Schema: `schemas/visual-hive.testing-layers.schema.json`

The testing-layer report is written by `visual-hive layers`. It summarizes the 0-11 layer lattice from repo intelligence through agent/Hive feedback, including covered, partial, missing, unknown, and not-applicable states. Each layer includes evidence artifacts, gaps, skipped reasons, and a recommended next step. New reports include `outputResource`, the same catalog-backed identity used by MCP, Agent Packets, the artifact index, Tool Registry, and the Control Plane: `.visual-hive/testing-layers.json`, `visual-hive://testing-layers`, and `visual_hive_read_testing_layers`. This artifact is guidance for humans and agents; it does not decide pass/fail.

The companion `.visual-hive/testing-layers.md` is a sanitized Markdown summary suitable for reviewers and agent context.

## Verdict Report

Path: `.visual-hive/verdict.json`

Schema: `schemas/visual-hive.verdict.schema.json`

The verdict report is written by `visual-hive verdict`. It is the compact pass/fail contract extracted from normalized evidence, separate from raw Playwright output. It records the final Visual Hive verdict, all gating contributions, all advisory-only contributions, contribution counts by status, source artifact pointers, and policy text explaining that Visual Hive owns pass/fail. Playwright remains the default local browser backend and primary evidence source, but the verdict report is shaped around normalized evidence so mutation adequacy, provider-normalized results, readiness blocks, coverage warnings, and future deterministic sources can participate without becoming Playwright-shaped.

The companion `.visual-hive/verdict.md` is a sanitized human-readable summary for CI summaries, reviewers, and agent handoff.

## Handoff Packet

Path: `.visual-hive/handoff.json`

Schema: `schemas/visual-hive.handoff.schema.json`

The handoff packet is written by `visual-hive handoff --dry-run` after an Evidence Packet exists. It is a smaller task-oriented object for trusted GitHub issue workflows, Hive dry-run review, and future agent queueing. It records the source Evidence Packet, labels, Visual Hive verdict summary, governance policy, work items, trusted issue metadata, Hive Bead dry-run metadata, and `externalCallsMade: 0`.

Related artifacts:

- `.visual-hive/hive-issue.md`: sanitized GitHub/Hive issue body for trusted workflows.
- `.visual-hive/hive-bead-request.json`: dry-run Hive Bead request object with allowed and forbidden agent actions plus safe target metadata: configured mode, optional redacted bead API URL, token environment variable name, token-present boolean, and missing token env name when applicable.
- `.visual-hive/hive-handoff-result.json`: command result summary and artifact paths.
- `.visual-hive/hive-handoff-validation.json`: local no-network validation report from `visual-hive handoff-validate`; it checks schema versions, artifact path consistency, verdict consistency, issue-body sanitization, dry-run policy, `externalCallsMade: 0`, and Evidence Packet Hive readiness policy. When Hive repair-chain artifacts are present, it also validates Hive export, guarded repair preview, repair request envelope, trusted repair consumer summary, and trusted repair workflow dry-run schema/policy/source-chain safety. The report includes `hiveReadiness` with the recommended mode/status, ready/trusted-only/blocked mode lists, trusted-workflow-required modes, `fullAutomationBlocked`, and `guardedRepairTrustedOnlyOrBlocked`.

The command does not create issues, create Hive Beads, call Hive APIs, or execute PR code. `github_issue` and `bead_api` modes are represented for future trusted workflows, but local dry-run remains the default. Token values are never written; only environment variable names and presence/absence evidence may appear.

## Hive Native Export

Path: `.visual-hive/hive/hive-export.json`

Schema: `schemas/visual-hive.hive-export.schema.json`

The Hive export is written by `visual-hive hive export --dry-run` after an Evidence Packet exists. It is the richer downstream package for KubeStellar Hive and repair-capable agents. It keeps `externalCallsMade: 0` and writes split artifacts under `.visual-hive/hive/`:

- `beads.json`: Hive-compatible work items with type, actor, priority, metadata, notes, and dependencies.
- `knowledge-facts.json`: project-layer facts using Hive fact types such as `regression`, `coverage_rule`, `test_scaffold`, `integration`, and `decision`.
- `knowledge-graph.json`: nodes and edges connecting evidence, contracts, facts, beads, and repair work orders.
- `wiki-index.json`: machine-readable index of generated wiki-vault Markdown pages.
- `wiki/*.md`: markdown wiki-vault pages with YAML frontmatter for project knowledge ingestion.
- `issue-context.md`: Hive-oriented agent work order for trusted issue creation or queueing.
- `providerEvidence`: compact provider status and upload posture rows copied from the Evidence Packet, including upload status, external calls made, staged/uploaded artifacts, manifest path, upload directory, provider URL, and blocked reasons. Hive may route or explain this evidence, but provider output is not a verdict authority unless explicitly configured as trusted/gating.
- `repair-work-orders.json`: guarded PR-only repair requests when `integrations.hive.mode` is `repair_request`, `guarded_repair`, or repair is explicitly enabled.
- `hive-agent-policy.json`: allowed/forbidden agent actions, ACMM level, and Visual Hive rerun requirements.
- `guarded-repair-preview.json`: preview-only repair readiness gate over repair work orders and agent policy.
- `repair-request-envelope.json`: no-network trusted-workflow request package over a guarded repair preview.
- `trusted-repair-consumer-summary.json`: no-network dry-run consumer summary over a repair request envelope.
- `trusted-repair-workflow-dry-run.json`: no-network future trusted workflow plan over a trusted repair consumer summary.

The bundle keeps the legacy `outputArtifacts` path map and also exposes `outputResources`, a catalog-backed list for the JSON artifacts that have first-party read-only evidence resources: `hive-export`, `hive-beads`, `hive-knowledge-facts`, `hive-knowledge-graph`, `hive-wiki-index`, `hive-repair-work-orders`, and `hive-agent-policy`. Each row includes the artifact key, actual artifact path, evidence-resource ID, URI, title, description, and MCP read-tool name so Hive, agents, MCP clients, the artifact index, and the Control Plane can refer to the same evidence without guessing from paths.

`advisory` mode emits issue context only. `measured` emits beads, knowledge facts, and graph data. Repair modes emit work orders, but Hive still cannot mark a finding resolved; a fresh Visual Hive verdict must pass after the repair PR.

Standalone Hive bridge schemas:

- `schemas/visual-hive.hive-beads.schema.json`
- `schemas/visual-hive.hive-knowledge-facts.schema.json`
- `schemas/visual-hive.hive-knowledge-graph.schema.json`
- `schemas/visual-hive.hive-wiki-index.schema.json`
- `schemas/visual-hive.hive-repair-work-orders.schema.json`
- `schemas/visual-hive.hive-agent-policy.schema.json`

## Hive Guarded Repair Preview

Path: `.visual-hive/hive/guarded-repair-preview.json`

Schema: `schemas/visual-hive.hive-guarded-repair-preview.schema.json`

The guarded repair preview is written by `visual-hive hive guarded-repair-preview` after `.visual-hive/hive/hive-export.json` exists. It is a no-network, preview-only policy gate for future Hive repair execution. It records source Hive export paths, output paths, policy flags, readiness, required approvals, required commands, and per-work-order branch names, max attempts, allowed actions, forbidden actions, artifacts, reproduction commands, acceptance criteria, and blocked reasons.

Its `outputResource` field points at the shared `hive-guarded-repair-preview` evidence resource and `visual_hive_read_hive_guarded_repair_preview` read-only MCP tool.

`status: "ready"` means the exported repair work orders satisfy Visual Hive's current guarded repair constraints. `status: "blocked"` is still a successful artifact generation state: it means repair execution should not be requested until missing work orders, PR-only policy, human review, Visual Hive rerun, forbidden-action, or governance requirements are satisfied. The command performs no repair and makes no Hive API calls.

## Hive Repair Request Envelope

Path: `.visual-hive/hive/repair-request-envelope.json`

Schema: `schemas/visual-hive.hive-repair-request-envelope.schema.json`

The repair request envelope is written by `visual-hive hive repair-request-envelope` after `.visual-hive/hive/guarded-repair-preview.json` exists. It is a no-network, trusted-workflow-only package for future Hive or GitHub repair execution. It records source artifact paths, output paths, policy flags, readiness, branch and label conventions, dedupe keys, selected work orders, required commands, acceptance criteria, blocked reasons, and sanitized artifact references. It does not execute repair, create branches, open pull requests, create issues, call Hive, or decide the Visual Hive verdict.

Its `outputResource` field points at the shared `hive-repair-request-envelope` evidence resource and `visual_hive_read_hive_repair_request_envelope` read-only MCP tool.

## Hive Trusted Repair Consumer Summary

Path: `.visual-hive/hive/trusted-repair-consumer-summary.json`

Schema: `schemas/visual-hive.hive-trusted-repair-consumer-summary.schema.json`

The trusted repair consumer summary is written by `visual-hive hive trusted-repair-consumer-summary` after `.visual-hive/hive/repair-request-envelope.json` exists. It is a no-network, dry-run consumer artifact for a future trusted Hive or GitHub repair workflow. It records source artifact paths, output paths, Visual Hive verdict-authority policy, dry-run consumer policy, readiness, required approvals, required commands, ready/blocked repair counts, preview branch names, preview pull request titles, labels, allowed files, artifacts, reproduction commands, acceptance criteria, and blocked reasons.

Its `outputResource` field points at the shared `hive-trusted-repair-consumer-summary` evidence resource and `visual_hive_read_hive_trusted_repair_consumer_summary` read-only MCP tool.

The command does not checkout code, execute repair, create branches, open pull requests, create issues, call Hive, call providers, or rerun Visual Hive. `consumerActions` is intentionally all false; `summary.branchesToCreate` and `summary.pullRequestsToOpen` preview what a future trusted workflow would do, not actions Visual Hive performed.

## Hive Trusted Repair Workflow Dry Run

Path: `.visual-hive/hive/trusted-repair-workflow-dry-run.json`

Schema: `schemas/visual-hive.hive-trusted-repair-workflow-dry-run.schema.json`

The trusted repair workflow dry-run is written by `visual-hive hive trusted-repair-workflow-dry-run` after `.visual-hive/hive/trusted-repair-consumer-summary.json` exists. It is a no-network, no-write future workflow plan for a trusted Hive or GitHub repair lane. It records source artifacts, output paths, Visual Hive verdict-authority policy, readiness, required approvals, required commands, ready/blocked repair counts, current action flags, and per-repair planned future actions such as artifact download, policy validation, trusted checkout, branch creation, bounded Hive repair-agent execution, final Visual Hive validation, and pull request creation.

Its `outputResource` field points at the shared `hive-trusted-repair-workflow-dry-run` evidence resource and `visual_hive_read_hive_trusted_repair_workflow_dry_run` read-only MCP tool.

The command does not checkout code, execute repair, create branches, open pull requests, create issues, call Hive, call providers, or rerun Visual Hive. `currentActions` is intentionally all false; `items[].plannedActions[]` describes what a later trusted workflow may do after validation and approval.

## Hive Export Mode Comparison

Path: `.visual-hive/hive/mode-comparison.json`

Schema: `schemas/visual-hive.hive-mode-comparison.schema.json`

The mode comparison is written by `visual-hive hive compare-modes` after an Evidence Packet exists. It is a no-network side-by-side preview of the safe Hive export levels. The command writes `.visual-hive/hive/mode-comparison.json`, `.visual-hive/hive/mode-comparison.md`, and per-mode export previews under `.visual-hive/hive/modes/`.

Its `outputResource` field points at the shared `hive-mode-comparison` evidence resource and `visual_hive_read_hive_mode_comparison` read-only MCP tool.

Key fields:

- `modes`: advisory, measured, repair-request, guarded-repair, and full entries with status, artifact paths, blocked reasons, and `externalCallsMade: 0`.
- `recommendedMode`: the safest useful next export mode for the current evidence.
- `recommendationReason`: plain-language rationale for the recommendation.
- `externalCallsMade`: always `0` for the local comparison command.

This artifact helps humans and agents choose between issue-only context, measured Hive Beads/knowledge graph output, bounded repair-request work orders, and blocked future automation states without creating Hive Beads or running a repair agent.

## Test Creation Plan

Path: `.visual-hive/test-creation-plan.json`

Schema: `schemas/visual-hive.test-creation-plan.schema.json`

The test-creation plan is written by `visual-hive test-creation-plan` after an Evidence Packet exists. It can also consume `.visual-hive/coverage-recommendations.json` and `.visual-hive/handoff.json`. It translates missing or partial testing layers, mutation survivors, coverage recommendations, and handoff `test_creation` work items into advisory no-write test recommendations.

Key fields:

- `outputResource`: catalog-backed identity for this artifact, including `.visual-hive/test-creation-plan.json`, `visual-hive://test-creation-plan`, and `visual_hive_read_test_creation_plan`.
- `governance`: declares Visual Hive as verdict authority, agents as advisory test-generation helpers, and `writePolicy: no_config_or_test_files_written`.
- `summary`: counts recommendations by priority and source.
- `recommendations`: bounded recommendations with source, kind, priority, rationale, suggested tests, optional config snippets, artifacts, trusted-only flags, and `applyMode: advisory_no_write`.

The companion `.visual-hive/test-creation-plan.md` is a sanitized summary for human review. Neither artifact edits config, writes tests, approves baselines, enables providers, or changes the Visual Hive verdict.

## Agent Packet

Path: `.visual-hive/agent-packet.json`

Schema: `schemas/visual-hive.agent-packet.schema.json`

The Agent Packet is written by `visual-hive agent-packet` after an Evidence Packet exists. It optionally consumes `.visual-hive/handoff.json` and `.visual-hive/test-creation-plan.json`, then creates a profile-specific envelope for `repair_agent`, `test_creator`, `review_agent`, `handoff_agent`, or `provider_specialist`. The default path is `.visual-hive/agent-packet.json`; the demo and agent-handoff Control Plane path write the handoff-agent envelope to `.visual-hive/handoff-agent-packet.json`, and the provider-governance path writes the provider-specialist envelope to `.visual-hive/provider-agent-packet.json`.

Key fields:

- `objective`: a bounded task derived from the current evidence and profile.
- `verdict`: Visual Hive's deterministic verdict summary.
- `evidenceSummary`: compact gating/advisory evidence, work items, selected contracts/targets, mutation score, provider evidence summaries, testing layers, and optional test-creation recommendations.
- `evidenceSummary.providerEvidence`: provider posture rows copied from the Evidence Packet, including provider status, deterministic role, upload status, external calls made, staged/uploaded artifact counts, missing credential names, blocked reasons, manifest path, upload directory, and provider URL. These rows guide agents but do not grant provider upload authority.
- `allowedTools`: role-scoped read-only or local-only tool affordances. Read-only tools that map to known Visual Hive artifacts carry shared evidence-resource metadata (`evidenceResourceId`, `evidenceResourceUri`, `evidenceResourceTitle`, `evidenceResourceDescription`, `evidenceReadToolName`, and `artifactPath`) so agents, MCP clients, the Tool Registry, the artifact index, and the Control Plane resolve the same resource consistently.
- `forbiddenActions`: actions that must remain human/trusted-workflow controlled.
- `budgets`: tool-call/token budgets with `allowExternalNetwork: false` and `maxExternalCostUsd: 0`.
- `artifactPointers`: exact artifacts the agent should read before broader context.

The packet is advisory and repair-oriented. It does not grant agents pass/fail authority, secret access, provider upload authority, baseline approval authority, or protected target execution authority.

## Tool Registry

Path: `.visual-hive/tools/tool-registry.json`

Schema: `schemas/visual-hive.tool-registry.schema.json`

The Tool Registry is written by `visual-hive tools`. It records first-party Visual Hive CLI tools, planned first-party MCP access, optional local Playwright/Storybook MCP tools, read-only GitHub MCP posture, and disabled paid-provider MCP/provider tools.

Key fields:

- `policy`: default gated tool policy, token/call budgets, external cost budget, PR write restrictions, and human approval requirements.
- `tools`: tool IDs, descriptions, access class, cost class, trusted-only status, allowed roles, allowed modes, write restrictions, and evidence artifacts.
- `roleProfiles`: compact policy-ranked allowed tool lists and forbidden actions for setup, repair, test creation, review, handoff, and provider-specialist agents. Each list is capped by `policy.maxToolDefinitionsPerAgent` and prioritizes stable evidence reads before optional execution or external tools.

The companion `.visual-hive/tools/tool-cards.md` is a compact Markdown view intended for agents and reviewers. The registry does not execute tools or grant permissions by itself.

## MCP Manifest

Path: `.visual-hive/mcp-manifest.json`

Schema: `schemas/visual-hive.mcp.schema.json`

The MCP manifest is written by `visual-hive mcp --describe --output .visual-hive/mcp-manifest.json`. It records the first-party read-only MCP resources and tools that expose existing Visual Hive artifacts to agents without changing verdict authority or starting execution tools. During first-time onboarding, `visual-hive mcp --repo <path> --describe --output .visual-hive/mcp-manifest.json` can write a setup-only manifest before `visual-hive.config.yaml` exists; that manifest intentionally exposes only `.visual-hive/recommendations.json`, `.visual-hive/setup-pr-plan.json`, `.visual-hive/repo-map.json`, `.visual-hive/repo-context.md`, `.visual-hive/artifacts-index.json`, `.visual-hive/mcp-manifest.json`, and their read-only tools.

Key fields:

- `server`: identifies Visual Hive's `stdio` MCP server, read-only default access, and `externalCallsMade: 0`.
- `resources`: artifact-backed resources such as `visual-hive://latest-evidence`, `visual-hive://control-plane-snapshot`, `visual-hive://latest-verdict`, `visual-hive://agent-packet`, `visual-hive://tool-registry`, `visual-hive://context-ledger`, `visual-hive://provider-results`, `visual-hive://provider-upload/argos/manifest`, `visual-hive://pipeline-status`, `visual-hive://schema-catalog`, `visual-hive://repo-map`, `visual-hive://repo-context`, `visual-hive://mcp-manifest`, and `visual-hive://artifacts/index`.
- `tools`: default read-only tools such as `visual_hive_doctor`, `visual_hive_recommend_setup`, `visual_hive_plan`, `visual_hive_read_evidence_packet`, `visual_hive_read_control_plane_snapshot`, `visual_hive_read_verdict`, `visual_hive_read_agent_packet`, `visual_hive_read_context_ledger`, `visual_hive_read_mutation_report`, `visual_hive_read_provider_results`, `visual_hive_read_provider_upload_manifest`, `visual_hive_read_repo_map`, `visual_hive_read_repo_context`, `visual_hive_read_artifacts_index`, `visual_hive_read_mcp_manifest`, `visual_hive_explain_failure`, and `visual_hive_list_reproduction_commands`. Planning through MCP is an in-memory summary and does not write `plan.json`; artifact, mutation, provider, repo-intelligence, and snapshot reads expose existing sanitized artifacts and do not enable provider upload, workflow writes, or UI actions.
- `disabledExecutionTools`: write-capable or execution-capable tools that are intentionally not registered by default.
- `policy`: enterprise defaults that keep third-party MCPs, PR writes, external uploads, baseline approval, and LLM verdict authority disabled.

The manifest is advisory and access-policy evidence. It does not run tests, mutate baselines, create GitHub issues, call Hive, call LLMs, upload provider artifacts, or decide pass/fail.

## Context Ledger

Path: `.visual-hive/context-ledger.json`

Schema: `schemas/visual-hive.context-ledger.schema.json`

The Context Ledger is written by `visual-hive context`. It is a governance artifact for agent-forward runs, future MCP tooling, and trusted workflow review.

Key fields:

- `sourceArtifacts`: existing artifacts consumed to derive the ledger, such as the Agent Packet, Tool Registry, LLM usage report, provider results, provider upload manifest, pipeline report, artifact index, Hive handoff packet, Hive bead request, Hive handoff result, Hive handoff validation, and test-creation plan.
- `budgets`: maximum tool calls, tool-result tokens, external cost, and provider screenshots for the task. Defaults stay strict for ordinary agent work, but bounded acceptance pipelines may pass explicit `visual-hive context` budget overrides so known demo/CI suites do not appear as accidental agent overreach.
- `usage`: inferred tool calls used, estimated tool-result tokens, estimated prompt tokens, estimated external cost, provider screenshot count, and external calls made.
- `remaining`: remaining budget after the current evidence set.
- `toolCalls`: pipeline steps or available registry tools with access class, trusted-only status, external-network status, artifacts, estimated result tokens, and catalog-backed evidence metadata (`evidenceResourceId`, `evidenceResourceUri`, `evidenceResourceTitle`, `evidenceResourceDescription`, and `evidenceReadToolName`) when the tool maps to a known read-only artifact.
- `providerUsage`: provider upload/readiness posture, upload status, dry-run state, staged/uploaded artifact counts, external calls made, missing credential names, blocked reasons, sanitized command/output excerpts, provider URL, manifest path, and upload directory.
- `llmUsage`: prompt-only LLM governance records, token estimates, cost estimates, and call counts.
- `escalations` and `policyViolations`: reasons an agent should avoid broad context loading, external tools, provider upload, or trusted actions without human/trusted-workflow approval.

The ledger does not execute tools, call providers, call LLMs, or decide pass/fail. Visual Hive's deterministic Verdict Engine remains the authority; the ledger helps agents decide which context and tools are safe to use next.

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

The JSON artifact is catalog-backed as `visual-hive://workflow-audit` / `visual_hive_read_workflow_audit` for read-only agent, MCP, and trusted workflow review. New reports include `outputResource`, the same catalog-backed identity used by MCP, Agent Packets, the artifact index, Tool Registry, and the Control Plane. Reading it does not authorize writing workflows, granting secrets, creating issues, or executing untrusted PR code.

When `.visual-hive/workflows.json` exists before `visual-hive triage` runs, `.visual-hive/issue.md` includes a sanitized "Workflow safety" section with the audit summary and highest-priority findings. `.visual-hive/pr-comment.md` also records the workflow finding count for PR review context. This keeps trusted issue workflows focused on uploaded artifacts and avoids checking out or executing untrusted PR code.

## Risk Register

Path: `.visual-hive/risk.json`

Schema: `schemas/visual-hive.risk.schema.json`

The risk register is written by `visual-hive risk`. It prioritizes evidence from the current plan, deterministic report, mutation report, coverage, flow audit, target audit, contract audit, schedule audit, workflow audit, provider policy, provider decisions, provider setup plans, provider handoff manifests, LLM decisions, and run history. It records a bounded risk score, severity counts, PR-blocking count, trusted-only count, loaded input artifacts, and one row per risk.

Risk categories include deterministic failures, baseline review needs, mutation adequacy gaps, coverage gaps, flow coverage gaps, target safety, workflow safety, provider policy, LLM governance, environment gaps, and planning gaps. Provider setup-plan risks flag enabled external providers without a matching no-network setup plan, or setup plans that are still blocked by credential-name or cost-policy evidence. Provider handoff risks flag enabled external providers without a matching no-network handoff manifest, or handoff manifests whose artifact eligibility, credential names, or cost policy still block trusted upload. Risk rows include sanitized evidence, related contract/target IDs, artifact paths, suggested actions, and whether the issue blocks the PR-safe lane or belongs in a trusted lane. The risk register is a prioritization layer only; deterministic Playwright contracts and mutation adequacy remain the evidence source.

## Readiness Gate

Path: `.visual-hive/readiness.json`

Schema: `schemas/visual-hive.readiness.schema.json`

The readiness gate is written by `visual-hive readiness`. It combines the current plan, deterministic report, baseline review queue, mutation report, workflow audit, security audit, cost audit, provider policy, provider decisions, provider setup plans, provider handoff manifests, LLM decisions, run history, and LLM governance into a single go/no-go summary for enabling or reviewing Visual Hive automation. Gates use `passed`, `warning`, `blocked`, or `missing`; the top-level status is `ready`, `attention`, or `blocked`. New reports include `outputResource`, the same catalog-backed identity used by MCP, Agent Packets, the artifact index, Tool Registry, and the Control Plane: `.visual-hive/readiness.json`, `visual-hive://readiness-gate`, and `visual_hive_read_readiness_gate`. This artifact is guidance and adoption evidence only. Deterministic contracts, screenshot diffs, console/page/network policy, mutation adequacy, and explicitly configured provider gates are the evidence Visual Hive can use for verdicts.

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

The triage report is written by `visual-hive triage`. It records offline deterministic classifications, severity counts, source artifact paths, evidence, related contract/target IDs, suggested files to inspect, and suggested next tests. It is sanitized before writing and is the machine-readable source for the Control Plane Failure Inbox. LLM prompts and GitHub markdown are generated from the same findings, but Visual Hive verdict artifacts remain the pass/fail authority. Source artifacts can include deterministic report, mutation report, coverage report, provider-results report, and baseline approval/rejection logs. Newly generated triage reports include `outputResource`, the same catalog-backed identity used by MCP, Agent Packets, the artifact index, Tool Registry, and the Control Plane: `.visual-hive/triage.json`, `visual-hive://triage-report`, and `visual_hive_read_triage_report`.

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

The artifact index inventories files under `.visual-hive`, classifies renderable artifacts, and stores sanitized previews for text-like files. Image files are linked for rendering through the Control Plane image endpoint, while JSON, Markdown, logs, YAML, text, and generated specs receive redacted previews. `visual-hive artifacts --repo <path>` can index setup artifacts before a `visual-hive.config.yaml` exists, which keeps `.visual-hive/repo-map.json`, `.visual-hive/repo-context.md`, `.visual-hive/recommendations.json`, and `.visual-hive/setup-pr-plan.json` catalog-backed during first-time onboarding.

Known evidence artifacts also carry shared resource metadata from the core evidence-resource catalog: `evidenceResourceId`, `evidenceResourceUri`, `evidenceResourceTitle`, `evidenceResourceDescription`, and `evidenceReadToolName`. These entries include the labels `evidence-resource` and the catalog resource ID, such as `latest-evidence`, `provider-results`, or `provider-upload-argos-manifest`, while preserving existing path-derived labels for compatibility. These fields keep the artifact index, Control Plane artifact browser, MCP manifest, MCP read tools, Agent Packet, and Tool Registry aligned around the same resource identity instead of duplicating path and tool names in each package.

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

The baseline queue and decision logs are catalog-backed read-only evidence resources: `.visual-hive/baselines.json` is `visual-hive://baseline-review` / `visual_hive_read_baseline_review`, `.visual-hive/baseline-approvals.json` is `visual-hive://baseline-approvals` / `visual_hive_read_baseline_approvals`, and `.visual-hive/baseline-rejections.json` is `visual-hive://baseline-rejections` / `visual_hive_read_baseline_rejections`. Reading these resources does not authorize approving, rejecting, copying, or updating baselines; baseline changes remain explicit trusted write actions with human review.

## Mutation Report

Path: `.visual-hive/mutation-report.json`

Schema: `schemas/visual-hive.mutation-report.schema.json`

The mutation report records one row per operator. `score` is killed applicable mutations divided by total applicable mutations. A mutation is killed when deterministic contracts fail under the injected mutation. Non-applicable mutations have status `not_applicable` and are excluded from the score denominator.
