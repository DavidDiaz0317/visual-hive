# Codex Goal Prompt - Visual Hive Agent-Forward Enterprise Operational Beta v2

Paste this into Codex goal mode. The canonical product goal is in this repo at:

`docs/goals/visual-hive-complete-product.md`

Treat that goal file as the source of truth. This prompt is only the launcher and orientation text; if any baseline detail, validation count, continuation marker, or architecture wording in this prompt conflicts with `docs/goals/visual-hive-complete-product.md`, follow the goal file after inspecting the current worktree.

Refreshed baseline for the next goal run: preserve the current catalog-backed evidence-resource direction, including `.visual-hive/history.json` as `visual-hive://run-history` / `visual_hive_read_run_history`, `.visual-hive/plans.json` as `visual-hive://plan-lanes` / `visual_hive_read_plan_lanes`, `.visual-hive/hive/wiki-index.json` as `visual-hive://hive/wiki-index` / `visual_hive_read_hive_wiki_index`, triage and repair-guidance artifacts such as `visual-hive://triage-report`, `visual-hive://issue-body`, `visual-hive://pr-comment`, `visual-hive://triage-prompt`, `visual-hive://repair-prompt`, and `visual-hive://missing-tests`, Context Ledger `evidenceResources[]` multi-resource links, `demo:evidence-resources` persisted artifact consistency checks, generic evidence-resource checks for KubeStellar, consumer install smoke output, and local real-console dogfood output through `smoke:console`, including console-root setup recommendation/setup PR-plan output-resource checks and config-scoped Evidence Packet/MCP/Agent Packet/Control Plane artifact checks, Agent Packet run-history trend evidence, Agent Packet no-network/no-cost budget policy through `budgets.allowExternalNetwork=false` and `budgets.maxExternalCostUsd=0`, schema/catalog verification, Control Plane snapshot artifacts, Hive repair-chain dry-run artifacts, provider evidence normalization, and bounded long-running command execution. Treat those as existing work to verify and build on, not as features to recreate.

Before doing feature work, run `git status --short`, inspect the current dirty worktree, and read the current continuation markers in `docs/goals/visual-hive-complete-product.md`. Do not trust stale validation counts in this prompt or in old summaries. Re-run the smallest relevant validation before editing and the appropriate bounded validation before handoff.

You are working in `DavidDiaz0317/visual-hive`.

Treat Visual Hive as enterprise-grade, deterministic-first, agent-forward visual QA orchestration software. It is not a demo, side project, screenshot wrapper, or dashboard-only app.

The product thesis is:

> Visual Hive turns user-visible software risk into structured deterministic evidence. Humans, GitHub, optional visual providers, LLM prompt builders, and Hive agents consume the evidence. They do not replace the evidence.

The new architecture decision is:

> Prioritize CLI + stable JSON first, Evidence Packet second, Handoff/Agent Packets third, Hive-native no-network export fourth, Visual Hive MCP fifth, trusted GitHub/Hive handoff sixth, guarded Hive repair through trusted workflow policy seventh, direct Hive Bead/API integration eighth, and HTTP/hosted API later.

Hive should be treated as more than an advisory sink in the long-term architecture, but not as a default local actor. Visual Hive should be able to package repair work orders, guarded repair previews, repair request envelopes, trusted repair consumer summaries, and trusted repair workflow dry-runs so a future trusted Hive lane can fix issues under branch, review, budget, and rerun policy. Hive, LLMs, MCP tools, hosted providers, and agents must not own the Visual Hive verdict.

## Read first

Before changing code, inspect the current repository state. Read at least:

- `README.md`
- `AGENTS.md`
- `package.json`
- `docs/goals/visual-hive-complete-product.md`
- `docs/research/visual-hive-vision-and-rationale.md`
- `docs/agents/hive-handoff-policy.md`
- `packages/**/package.json`
- `packages/core/**`
- `packages/cli/**`
- `packages/playwright-adapter/**`
- `packages/control-plane/**`
- `schemas/**`
- `examples/**`
- `docs/**`
- `.github/workflows/**`

Also read the agent-forward v2 docs in `docs/agent-forward-v2/` when they are relevant:

- `visual-hive-vision-and-research-rationale-agent-forward-v2.md`
- `visual-hive-complete-product-goal-agent-forward-v2.md`
- `visual-hive-roadmap-agent-forward-v2.md`
- `visual-hive-agent-documentation-pack-agent-forward-v2.md`
- `visual-hive-agent-forward-integration-path.md`
- `visual-hive-mcp-tool-efficiency-strategy.md`

## Current implementation baseline

Do not assume this repo is still an MVP scaffold. Before starting new work, verify what is already present and build on it.

As of the latest agent-forward pass, Visual Hive already has substantial v0.2/v0.3 foundation:

- strict TypeScript npm workspaces for core, CLI, Playwright adapter, GitHub adapter, LLM adapter, provider adapters, and Control Plane;
- deterministic config validation, planning, running, mutation, triage, reporting, evidence, verdict, handoff, agent packet, testing-layer, tool-registry, context-ledger, Hive export, and Hive export mode comparison commands;
- `url`, `command`, `commandGroup`, and `protected` target modeling;
- tolerant screenshot comparison with baseline/artifact metadata;
- contract-aware mutation mapping and mutation adequacy evidence;
- batched mutation execution that runs applicable operators through one Playwright/server lifecycle using an operator-to-contract matrix while preserving per-operator `mutationOperator` evidence and killed/survived/not_applicable mutation rows;
- optional provider upload surfaces that remain disabled by default;
- no-network Hive handoff and Hive-native export artifacts;
- a guided Control Plane UI over real local artifacts.

Recent Control Plane work specifically wired Hive-native export, guarded repair, repair request envelope, trusted repair consumer summary, trusted repair workflow dry-run, and export mode comparison into the visible product surface:

- `createControlPlaneSnapshot` reads `.visual-hive/hive/hive-export.json`;
- `createControlPlaneSnapshot` reads `.visual-hive/hive/mode-comparison.json`;
- the snapshot includes `hiveExport` and `hiveModeComparison` evidence;
- navigation badges count missing Hive export and Hive mode comparison alongside Evidence/Handoff/Agent packets;
- the `agent-handoff-review` run profile includes `hive-export` and `hive-compare-modes`;
- the runbook exposes `visual-hive hive export --dry-run`;
- the runbook exposes `visual-hive hive guarded-repair-preview`;
- the runbook exposes `visual-hive hive repair-request-envelope`;
- the runbook exposes `visual-hive hive trusted-repair-consumer-summary`;
- the runbook exposes `visual-hive hive trusted-repair-workflow-dry-run`;
- the runbook exposes `visual-hive hive compare-modes`;
- the Control Plane shows a "Hive-native bundle" with beads, knowledge facts, graph nodes, repair work orders, blocked reasons, and artifact links;
- the Control Plane shows a guarded repair preview when `.visual-hive/hive/guarded-repair-preview.json` exists, including readiness, blocked reasons, required commands, and preview-only repair policy;
- the Control Plane shows a trusted repair request envelope when `.visual-hive/hive/repair-request-envelope.json` exists, including readiness, blocked reasons, request counts, branch/label policy, and no-network trusted-workflow-only repair policy;
- the Control Plane shows a trusted repair consumer summary when `.visual-hive/hive/trusted-repair-consumer-summary.json` exists, including dry-run consumer policy, ready/blocked repair counts, branch and PR previews, required approvals, required commands, and blocked reasons;
- the Control Plane shows a trusted repair workflow dry-run when `.visual-hive/hive/trusted-repair-workflow-dry-run.json` exists, including future trusted workflow actions, blocked reasons, artifact links, no-checkout/no-repair/no-write policy, and whether the plan is ready for a future trusted workflow;
- the Control Plane shows a Hive export mode policy comparison for advisory, measured, repair-request, guarded-repair, and full paths;
- the Evidence Packet includes `hiveReadiness.recommendedMode`, `recommendationReason`, and per-mode readiness for advisory, measured, repair-request, guarded-repair, and full paths before any Hive export or trusted workflow is enabled;
- `visual-hive handoff-validate` validates the Evidence Packet and, when present, the full no-network Hive repair-chain artifacts: Hive export, guarded repair preview, repair request envelope, trusted repair consumer summary, and trusted repair workflow dry run;
- `visual-hive pipeline` and the demo suite run `handoff-validate` after the full Hive repair chain is regenerated, so validation consumes fresh optional artifacts rather than stale files;
- `smoke:ui` checks that the snapshot and built UI include no-network Hive-native export evidence, guarded repair preview evidence, trusted repair request envelope evidence, trusted repair consumer summary evidence, trusted repair workflow dry-run evidence, and mode comparison evidence.
- Context Ledger CLI flows support explicit budget overrides for tool calls, tool-result tokens, external cost, and provider screenshots; demo context generation uses bounded budgets.
- Schema catalog tests enforce stable `https://visual-hive.dev/schemas/<filename>` `$id` values and verify that artifact index schema paths point to checked-in schema files.
- `visual-hive schemas verify` exposes schema/catalog drift detection as a normal maintenance command over checked-in JSON Schema `$id` values and evidence-resource enum parity. The root `npm run schema:verify` script writes `.visual-hive/schema-catalog.json` as catalog-backed read-only evidence through `visual-hive://schema-catalog` / `visual_hive_read_schema_catalog`.
- The Control Plane treats schema/catalog health as visible evidence: `/api/snapshot` includes `schemaCatalog`, the Configure area shows schema counts, failed drift checks, artifact links, and a guarded `schemas-verify` action, the Expert evidence view includes the raw catalog, and failed schema/catalog checks raise Start/Configure/Expert badges.
- Provider upload artifacts are first-class indexed evidence: Argos upload manifests are labeled as `provider-upload` and mapped to `schemas/visual-hive.provider-upload.schema.json`.
- Provider upload evidence is visible across CLI reports, issue bodies, offline triage, and the Control Plane, including upload status, external-call count, staged/uploaded artifact counts, sanitized command metadata, stdout/stderr excerpts, provider URLs, and manifest/artifact links without making provider output a verdict authority by default.
- Provider upload evidence is normalized through the Evidence Packet, Context Ledger, Agent Packet, and Hive export bundle. Hive issue context, wiki facts, graph evidence, and agent-facing packets carry sanitized provider upload readiness/status so Hive and future repair agents can understand hosted-provider evidence without receiving credentials or making provider output authoritative by default.
- Provider evidence is now visible through the MCP surface and Tool Registry as read-only local tools/resources: `visual_hive_read_provider_results`, `visual_hive_read_provider_upload_manifest`, `visual_hive_read_provider_agent_packet`, `visual-hive://provider-results`, `visual-hive://provider-upload/argos/manifest`, and `visual-hive://provider-agent-packet`. These allow review, handoff, and provider-specialist agents to inspect sanitized provider evidence without granting upload authority, external network authority, or verdict authority.
- The core evidence-resource catalog is now the shared source of truth for read-only MCP resources, MCP read tools, Tool Registry resource-backed read tool cards, Agent Packet allowed-tool evidence metadata, Context Ledger tool-call evidence metadata, artifact index evidence metadata, and Control Plane artifact links. Known evidence artifacts carry resource IDs, URIs, titles, descriptions, artifact paths, and read-tool names through `.visual-hive/artifacts-index.json`, Agent Packets, Context Ledger tool calls, and the Control Plane artifact browser.
- Hive-native sub-artifacts are catalog-backed first-class evidence resources with standalone schemas and read-only tools, including beads, knowledge facts, knowledge graph, repair work orders, and Hive agent policy. Agents and trusted workflows should read these focused files through the shared catalog rather than scraping the full Hive export bundle.
- Readiness gate evidence is catalog-backed as `visual-hive://readiness-gate` and `visual_hive_read_readiness_gate`, so agents can inspect go/no-go readiness without rerunning targets, scraping raw reports, or treating guidance as a verdict override.
- `visual-hive agent-packet --profile handoff_agent --output .visual-hive/handoff-agent-packet.json` is the role-specific handoff packet for trusted GitHub/Hive routing review. It should expose catalog-backed read-only evidence tools for the compact handoff packet, handoff validation, Hive export, Hive sub-artifacts, guarded repair preview, repair request envelope, trusted repair consumer summary, trusted repair workflow dry-run, mode comparison, readiness/provider evidence, and related artifact metadata without creating issues, creating Hive Beads, calling Hive, calling providers, executing repair, or changing the Visual Hive verdict.
- `visual-hive agent-packet --profile provider_specialist` now emits a no-network provider-review packet with read-only provider evidence tools, provider handoff dry-run review, zero external cost, and explicit forbidden actions for provider gating or upload without trusted policy.
- The demo, pipeline, and Control Plane agent-handoff path should treat `.visual-hive/handoff-agent-packet.json` as a first-class role-specific artifact beside the main `.visual-hive/agent-packet.json` and provider-specific `.visual-hive/provider-agent-packet.json`.
- The demo and Control Plane provider-governance path now treat `.visual-hive/provider-agent-packet.json` as a first-class artifact: demo acceptance can generate it, the runbook exposes `provider-agent-packet`, the provider-governance profile includes it, and the Providers view shows its bounded tools, no-network budget, and provider-upload prohibitions.
- The Control Plane Start/Quality Cockpit path now includes a beginner-friendly setup/adoption checklist over existing snapshot state, with plain-language steps for configuration, PR-safe planning, deterministic evidence, baseline review, mutation adequacy, agent handoff, and safe workflow enablement. The checklist is part of `/api/snapshot`, not only React presentation: each item carries the linked runbook command ID, command label/text, safety class, expected artifacts, runnable state, and blocked reason. Beginner mode should stay task-oriented; expert mode should keep commands, artifact paths, raw evidence, command IDs, and advanced controls accessible.
- The Control Plane snapshot is now a schema-backed artifact surface, not only an in-memory UI response. `visual-hive snapshot` writes `.visual-hive/control-plane-snapshot.json`, `schemas/visual-hive.control-plane-snapshot.schema.json` documents the `/api/snapshot` contract, and the artifact index labels the output as `control-plane-snapshot` evidence for UI, smoke tests, agents, and future hosted/control-plane consumers.
- The structured MCP JSON manifest and human-readable `visual-hive mcp --describe` output now both expose catalog-backed resource IDs, URIs, artifact paths, and read-tool names, including latest evidence, Control Plane snapshot, readiness gate, Hive sub-artifacts, and provider upload manifest resources.
- Recent reliability hardening added bounded execution to agent-facing helper scripts, CLI changed-file discovery, and optional provider upload commands: demo suites, consumer install smoke checks, `run-with-env`, git-diff helpers, and Argos CLI execution must use explicit timeouts and process cleanup instead of waiting indefinitely.
- Recent path-ergonomics review found that repo-level workflow/security/readiness audits need clear behavior when `--config` points at a nested app config. Treat this as a correctness issue, not a broad feature: commands that scan `.github/workflows` or similar repo-level paths should prefer config-root-relative paths when they exist, then fall back to current-working-directory/repo-root-relative paths for common defaults, and should report what directory was scanned.

If those changes are still uncommitted in the worktree, finish validating them before starting a broader goal run. Do not reimplement this surface from scratch.

Current immediate continuation note: treat `visual-hive hive trusted-repair-workflow-dry-run`, optional repair-chain validation in `visual-hive handoff-validate`, context-ledger budget overrides, schema catalog consistency, `visual-hive schemas verify`, provider-upload artifact indexing, bounded provider upload command execution, provider upload evidence visibility, provider evidence MCP resources/read tools, Tool Registry provider-read tool cards, handoff-agent Agent Packet generation, provider-specialist Agent Packet generation, handoff-agent/provider-specialist Control Plane visibility, beginner-friendly Control Plane setup/adoption guidance with runbook-backed action metadata, schema-backed `visual-hive snapshot` artifact generation, read-only Control Plane snapshot MCP/resource exposure, Hive sub-artifact schemas/resources/read tools, readiness-gate schema/resource/read tool, shared core evidence-resource metadata, resource-backed Agent Packet allowed tools, resource-backed artifact index entries, and provider upload normalization across Evidence Packet, Context Ledger, Agent Packet, and Hive export as expected baseline, not as new feature work. Validate that the workflow dry-run consumes `.visual-hive/hive/trusted-repair-consumer-summary.json`, writes `.visual-hive/hive/trusted-repair-workflow-dry-run.json` plus Markdown, appears in schemas/MCP/workflow templates/Control Plane/smoke tests/docs, and remains no-network, no-write, no-checkout, no-repair, no-branch, no-PR, no-issue, no-Hive-call, no-provider-call, and no-Visual-Hive-rerun. Validate that provider upload commands have bounded timeouts, sanitize command output, expose upload evidence in reports/triage/issues/Control Plane, flow through Evidence Packet/Context Ledger/Agent Packet/Hive export, expose read-only provider evidence through MCP and Tool Registry, generate `.visual-hive/provider-agent-packet.json` for provider-specialist review, and do not affect the Visual Hive verdict unless normalized provider gating is explicitly trusted and budget-authorized. Validate that the handoff-agent packet generates `.visual-hive/handoff-agent-packet.json`, exposes only catalog-backed read-only evidence tools, carries no-network/zero-external-cost budgets, appears in pipeline/demo/control-plane/runbook/profile/artifact-index surfaces, and does not grant issue creation, Hive Bead creation, provider upload, repair execution, or verdict authority. Validate that handoff validation checks the repair-chain source artifacts and policy guarantees when those files exist, that pipeline/demo ordering regenerates Hive export, guarded repair preview, repair request envelope, trusted repair consumer summary, trusted repair workflow dry-run, handoff-agent packet, provider-specialist packet, and Control Plane snapshot before running downstream validation/smoke checks, that the Start cockpit explains the next safe action with linked command/copy/run metadata without hiding expert evidence, and that artifact/schema/resource outputs stay cataloged under checked-in `https://visual-hive.dev/schemas/*` schemas and the shared evidence-resource catalog.

If those slices are present and tests pass, the next high-leverage continuation is to continue tightening evidence-resource metadata verticals. Verify whether smoke snapshots, docs examples, generated manifests, and any remaining resource-backed surfaces consume the shared core catalog for resource IDs, artifact paths, descriptions, and read-only restrictions. If new duplicated resource names or paths appear across CLI, core, schemas, and docs, wire that surface to the existing catalog with tests. Preserve existing public CLI/MCP/tool names; the point is correctness and drift prevention, not a broad new feature.

If continuing directly from the latest metadata/catalog work, first verify any new Hive-native or agent-forward artifact path: Hive export bundle output artifacts, Hive repair-chain artifacts, Hive sub-artifact schemas, MCP resources, Tool Registry cards, Agent Packet allowed-tool metadata, Context Ledger tool-call metadata, artifact index entries, Control Plane artifact links, and JSON Schema enum constraints should all agree on catalog-backed resource IDs, URIs, artifact paths, descriptions, and read-tool names. `hive-export.json` now carries `outputResources` for split Hive JSON artifacts, and the guarded repair preview, repair request envelope, trusted repair consumer summary, trusted repair workflow dry-run, and mode comparison artifacts each carry an `outputResource` row for their own catalog-backed read-only evidence identity. Fix drift there before starting broader Hive/provider/agent features.

Latest catalog alignment baseline: `visual-hive layers` writes `.visual-hive/testing-layers.json` and `.visual-hive/testing-layers.md`, and the schema-backed JSON report is catalog-backed as `visual-hive://testing-layers` plus `visual_hive_read_testing_layers`. Preserve that read-only evidence identity through Tool Registry, MCP, Agent Packet metadata, Context Ledger metadata, artifact index metadata, Control Plane links, docs, schemas, and tests. Preserve existing CLI behavior and do not make testing-layer guidance a verdict override.

The schema-backed no-write test creation plan `.visual-hive/test-creation-plan.json` is catalog-backed as `visual-hive://test-creation-plan` plus `visual_hive_read_test_creation_plan`. Preserve that read-only evidence identity through Tool Registry, MCP, Agent Packet metadata, Context Ledger metadata, artifact index metadata, Control Plane links, docs, schemas, and tests. The Markdown summary remains a normal human-readable artifact. Do not let this advisory plan edit config, tests, baselines, thresholds, or verdict policy by default.

The deterministic coverage recommendation artifact `.visual-hive/coverage-recommendations.json` is catalog-backed as `visual-hive://coverage-recommendations` plus `visual_hive_read_coverage_recommendations`. Preserve that read-only evidence identity through Tool Registry, MCP, Agent Packet metadata, Context Ledger metadata, artifact index metadata, Control Plane links, docs, schemas, and tests. The artifact may include guarded config snippets and apply IDs, but reading it must not apply config edits; preserve explicit diff preview and `--yes` confirmation for writes.

The setup onboarding artifacts are now catalog-backed too: `.visual-hive/recommendations.json` is `visual-hive://setup-recommendations` plus `visual_hive_read_setup_recommendations`, and `.visual-hive/setup-pr-plan.json` is `visual-hive://setup-pr-plan` plus `visual_hive_read_setup_pr_plan`. Preserve those read-only evidence identities through Tool Registry, MCP, Agent Packet metadata, Context Ledger metadata, artifact index metadata, Control Plane links, docs, schemas, and tests. These files can describe config/docs/workflow setup bundles, but reading them must not write config, docs, workflows, secrets, provider settings, branches, pull requests, or issues.

The workflow safety audit artifact `.visual-hive/workflows.json` is catalog-backed as `visual-hive://workflow-audit` plus `visual_hive_read_workflow_audit`. Preserve that read-only evidence identity through Tool Registry, MCP, Agent Packet metadata, Context Ledger metadata, artifact index metadata, Control Plane links, docs, schemas, and tests. The artifact can describe PR workflow safety, secret posture, artifact upload, `pull_request_target`, and trusted `workflow_run` patterns, but reading it must not write workflows, grant secrets, create issues, or execute untrusted PR code.

The baseline governance artifacts are catalog-backed as read-only evidence: `.visual-hive/baselines.json` is `visual-hive://baseline-review` plus `visual_hive_read_baseline_review`, `.visual-hive/baseline-approvals.json` is `visual-hive://baseline-approvals` plus `visual_hive_read_baseline_approvals`, and `.visual-hive/baseline-rejections.json` is `visual-hive://baseline-rejections` plus `visual_hive_read_baseline_rejections`. Preserve those metadata paths through Tool Registry, MCP, Agent Packet metadata, Context Ledger metadata, artifact index metadata, Control Plane links, docs, schemas, and tests. Reading baseline governance evidence must not approve, reject, copy, or update baselines.

The run history artifact `.visual-hive/history.json` is catalog-backed as `visual-hive://run-history` plus `visual_hive_read_run_history`. Preserve that metadata path through Tool Registry, MCP, Agent Packet metadata, Context Ledger metadata, artifact index metadata, Control Plane links, docs, schemas, and tests. Treat run history as longitudinal trend evidence; reading it must not rerun checks, approve baselines, change verdict policy, or infer a new verdict from history alone.

The triage and repair-guidance artifacts are now part of the current catalog continuation: `.visual-hive/triage.json` should be `visual-hive://triage-report` / `visual_hive_read_triage_report`, `.visual-hive/issue.md` should be `visual-hive://issue-body` / `visual_hive_read_issue_body`, `.visual-hive/pr-comment.md` should be `visual-hive://pr-comment` / `visual_hive_read_pr_comment`, `.visual-hive/triage-prompt.md` should be `visual-hive://triage-prompt` / `visual_hive_read_triage_prompt`, `.visual-hive/repair-prompt.md` should remain `visual-hive://repair-prompt`, and `.visual-hive/missing-tests.md` should be `visual-hive://missing-tests` / `visual_hive_read_missing_tests`. Preserve those metadata paths through `packages/core/src/tools/evidenceResources.ts`, schemas, MCP output, Tool Registry cards, Agent Packet metadata, Context Ledger metadata, artifact indexing, Control Plane links, docs, and tests. Treat them as deterministic triage, sanitized GitHub text, advisory prompts, and missing-test guidance; reading them must not post GitHub comments, create issues, call LLMs, edit tests, approve baselines, or override the Visual Hive verdict.

Latest validated baseline to preserve: the recent run-history/catalog-backed evidence slice, Context Ledger multi-resource evidence exposure, plan-lane cataloging, Hive wiki-index evidence resource, and generated demo evidence-resource consistency check passed `npm run build`, `npm run typecheck`, `npm test` with 317 tests, `npm run lint`, `npm run smoke:ui`, `npm run demo:evidence-resources`, `npm run demo:kubestellar`, `npm run smoke:consumer`, `npm run smoke:console`, and `npm run demo:all`. The current schema/catalog verification passed with 63 tracked schemas, 128 checks, 50 evidence resources, and 47 evidence read tools. Do not assume this validation is still current after any new edits; rerun the relevant subset before handoff.

Recommended next continuation from the current worktree: the role-specific Agent Packet slice for triage/repair guidance, the Context Ledger multi-resource evidence slice, and the generated demo artifact consistency check have been completed and should be preserved. Repair, test-creator, handoff, and review packets should continue exposing the relevant catalog-backed read-only tools with resource IDs, URIs, artifact paths, and read-tool names, not plain duplicated tool strings. Context Ledger tool calls should continue carrying `evidenceResources[]` for all artifacts produced by a step, while retaining compatibility `evidenceResourceId` / `evidenceResourceUri` fields for existing consumers.

The next verification slice is extending that same catalog-backed consistency discipline to the remaining dogfooding surfaces. Consumer install smoke output and KubeStellar planning artifacts should already run the generic evidence-resource consistency checker. Confirm that real-console dogfood artifacts and any newly generated external-repo setup artifacts preserve the same catalog-backed evidence identity across Evidence Packet, Context Ledger, MCP manifest, Agent Packets, artifact index, and Control Plane snapshot where those artifacts exist. The goal is not broad new features; it is drift prevention for generated artifacts in repositories outside the demo app. If a dogfood or consumer surface exposes only raw paths where catalog metadata is available, patch the smallest vertical slice that restores catalog parity and add a bounded local check.

If any baseline slice is missing or regressed, fix it first. If everything is healthy, move to the next highest-leverage vertical slice from `docs/goals/visual-hive-complete-product.md`.

## Non-negotiable invariants

- Visual Hive owns the final deterministic verdict layer.
- Playwright remains the default first-party local browser runner and primary local deterministic evidence source.
- LLM output, MCP summaries, and Hive/agent judgment are advisory or repair-routing inputs; they must never be the sole pass/fail authority.
- Optional provider results may become gating only when normalized, trusted, explicitly configured, and budget-authorized.
- External providers are optional, explicit, mockable, budget-aware, and disabled by default.
- No paid provider, external upload, or real LLM call should be required by default.
- MCP-enabled tools are strength amplifiers, not uncontrolled context dumps.
- PR workflows must use safe read-only/no-secret posture.
- Do not execute untrusted PR code from `pull_request_target`.
- Protected targets run only in trusted scheduled/manual lanes unless explicitly configured otherwise.
- Secret values must never be printed; missing secret names may be reported.
- If a config field changes, update Zod schema, JSON schema, docs, tests, examples, and generated sample artifacts together.
- Stop feature expansion when CI/tests are red. Stabilize first.
- Prefer vertical slices over broad disconnected scaffolding.
- Long-running tooling, dev servers, browser checks, migrations, Docker services, and integration tests must be run with sensible timeouts or non-interactive batch mode. Never leave a shell waiting indefinitely; use explicit timeouts, scripted exits, or log polling.

## Core architecture to preserve

Visual Hive owns:

```text
repo scanning
recommendation/setup
project-aware planning
changed-file risk selection
target safety
contract generation/execution
visual diff metadata
mutation adequacy
flake/baseline stability
provider policy and normalization
LLM prompt generation/governance
Evidence Packets
Handoff Packets
Agent Packets
Tool Registry and Tool Cards
Context Ledger
triage and issue bodies
Hive handoff artifacts
Hive-native export artifacts
Control Plane UX
```

External tools/providers may own hosted screenshot review, long-term image hosting, browser/device grids, Storybook publishing, enterprise visual AI comparison, PR dashboards, or team workflows. They must be adapters over Visual Hive policy, not the center of the product.

## Testing layer lattice

Visual Hive should model testing as layers:

0. Repo intelligence
1. Static/build/workflow safety
2. Unit
3. Component/accessibility
4. API/contract
5. Component visual
6. E2E user-flow
7. Cross-browser/device provider
8. Canary/protected
9. Mutation/fault injection
10. Flake/history/cost governance
11. Agent/Hive feedback

Make these layers visible in docs and, where feasible, artifacts such as:

```text
.visual-hive/testing-layers.json
.visual-hive/coverage.json
.visual-hive/evidence-packet.json
.visual-hive/hive/hive-export.json
.visual-hive/hive/mode-comparison.json
```

## Primary mission

Move the repo toward v0.3/v0.4 "Agent-Forward Operational Beta." Do this in the highest-leverage order:

1. Inspect current repo state and summarize what already exists.
2. Compare the implementation against the canonical goal file at `docs/goals/visual-hive-complete-product.md` and preserve the current baseline before adding new surface area.
3. Run the smallest commands needed to find current breakages.
4. If any core build/test/demo command is red, fix that before feature expansion.
5. Add or harden agent documentation:
   - root `AGENTS.md` additions if missing;
   - `.github/copilot-instructions.md`;
   - `.github/instructions/testing.instructions.md`;
   - `docs/agents/enterprise-definition-of-done.md`;
   - `docs/agents/testing-layer-contract.md`;
   - `docs/agents/visual-contract-authoring.md`;
   - `docs/agents/mutation-adequacy.md`;
   - `docs/agents/hive-handoff-policy.md`;
   - `docs/agents/provider-and-llm-governance.md`;
   - `docs/agents/repo-map-and-context.md`;
   - `docs/agents/agent-forward-integration.md`;
   - `docs/agents/mcp-and-tool-efficiency.md`;
   - `docs/agents/agent-packet-schema.md`.
6. Add or harden an Evidence Packet schema/writer:
   - schema: `schemas/visual-hive.evidence-packet.schema.json`;
   - output: `.visual-hive/evidence-packet.json`;
   - summary: `.visual-hive/evidence-summary.md`;
   - include source, governance, repo intelligence, testing layers, plan, deterministic results, mutation evidence, providers, artifacts, triage, and Hive readiness;
   - sanitize all output.
7. Add or harden repo intelligence:
   - command such as `visual-hive analyze --repo . --out .visual-hive/repo-map.json --markdown .visual-hive/repo-context.md`, or equivalent if the repo already has a command;
   - detect package manager, workspaces, scripts, frameworks, workflows, routes/target hints, test tools, selectors, risk signals, and coverage gaps.
8. Add or harden testing-layer audit:
   - output layer coverage and missing-test guidance;
   - make skipped layers and reasons visible.
9. Add or harden Handoff Packet and Hive-native export:
   - config defaults disabled/advisory;
   - no network by default;
   - outputs `.visual-hive/handoff.json`, `.visual-hive/hive-issue.md`, `.visual-hive/hive-bead-request.json`, `.visual-hive/hive-handoff-result.json`;
   - outputs `.visual-hive/hive/hive-export.json`, `.visual-hive/hive/beads.json`, `.visual-hive/hive/knowledge-facts.json`, `.visual-hive/hive/knowledge-graph.json`, `.visual-hive/hive/wiki-index.json`, `.visual-hive/hive/issue-context.md`, `.visual-hive/hive/repair-work-orders.json`, and `.visual-hive/hive/wiki/*.md`;
   - command: `visual-hive hive export --dry-run`;
   - guarded repair preview command: `visual-hive hive guarded-repair-preview`;
   - guarded repair preview outputs `.visual-hive/hive/guarded-repair-preview.json` and `.visual-hive/hive/guarded-repair-preview.md` without executing repair or calling Hive;
   - trusted repair request envelope command: `visual-hive hive repair-request-envelope`;
   - trusted repair request envelope outputs `.visual-hive/hive/repair-request-envelope.json` and `.visual-hive/hive/repair-request-envelope.md` without executing repair, creating branches, opening PRs, creating issues, or calling Hive;
   - trusted repair consumer summary command: `visual-hive hive trusted-repair-consumer-summary`;
   - trusted repair consumer summary outputs `.visual-hive/hive/trusted-repair-consumer-summary.json` and `.visual-hive/hive/trusted-repair-consumer-summary.md` without checking out code, executing repair, creating branches, opening PRs, creating issues, calling Hive, calling providers, or rerunning Visual Hive;
   - trusted repair workflow dry-run command: `visual-hive hive trusted-repair-workflow-dry-run`;
   - trusted repair workflow dry-run outputs `.visual-hive/hive/trusted-repair-workflow-dry-run.json` and `.visual-hive/hive/trusted-repair-workflow-dry-run.md` as a reviewable future workflow plan only; it must not checkout code, execute repair, create branches, open pull requests, create issues, call Hive, call providers, or rerun Visual Hive;
   - mode comparison command: `visual-hive hive compare-modes`;
   - mode comparison outputs `.visual-hive/hive/mode-comparison.json`, `.visual-hive/hive/mode-comparison.md`, and `.visual-hive/hive/modes/{advisory,measured,repair_request,guarded_repair,full}/**`;
   - modes: `advisory`, `measured`, `repair_request`, `guarded_repair`, and `full`;
   - include labels such as `visual-hive`, `hive/quality`, `ai-ready`;
   - require sanitized Evidence Packet.
10. Add or harden Agent Packet generation:
   - output `.visual-hive/agent-packet.json`;
   - support at least `repair_agent`, `test_creator`, `review_agent`, and `handoff_agent` profiles in docs/schema;
   - include objective, evidence summary, allowed tools, forbidden actions, budget, reproduction commands, artifact pointers.
11. Add or harden Tool Registry and Tool Cards:
   - output `.visual-hive/tools/tool-registry.json` and `.visual-hive/tools/tool-cards.md`, or docs/schema first if implementation is too large;
   - include local Visual Hive tools, optional Playwright/Storybook MCP, GitHub MCP read-only, and paid provider MCPs disabled by default;
   - include cost class, trusted-only status, role access, allowed modes, and write restrictions.
12. Add or harden Context Ledger:
   - output `.visual-hive/context-ledger.json` where feasible;
   - track tool calls, estimated tokens, provider screenshots, external cost, escalation reasons, and remaining budget.
13. Update KubeStellar example docs/config so it models:
   - hosted demo no-login canary;
   - local preview screenshots;
   - fake OAuth `commandGroup` planning/runtime if stable;
   - protected live-cluster scheduled/manual target;
   - auth changed-files select auth contracts;
   - docs-only changes skip expensive/protected checks.
14. Update the Control Plane only when it can show real artifacts or useful readiness states. Avoid shallow UI panels without backing data.

## MCP and tool policy

Do not make MCP the first implementation path for new product behavior. Build or preserve CLI/JSON and Evidence Packet surfaces first, then expose them through MCP/resource metadata.

The first-party Visual Hive MCP surface is now expected to expose catalog-backed read-only evidence resources through:

```bash
visual-hive mcp --stdio
```

Read-only/default resources should stay aligned with `packages/core/src/tools/evidenceResources.ts`, `schemas/visual-hive.mcp.schema.json`, the Tool Registry, Agent Packet allowed-tool metadata, the artifact index, Control Plane artifact links, and `docs/agents/mcp-and-tool-efficiency.md`:

```text
visual-hive://config
visual-hive://latest-plan
visual-hive://plan-lanes
visual-hive://setup-recommendations
visual-hive://setup-pr-plan
visual-hive://latest-report
visual-hive://latest-evidence
visual-hive://control-plane-snapshot
visual-hive://latest-verdict
visual-hive://readiness-gate
visual-hive://run-history
visual-hive://workflow-audit
visual-hive://baseline-review
visual-hive://baseline-approvals
visual-hive://baseline-rejections
visual-hive://testing-layers
visual-hive://test-creation-plan
visual-hive://latest-handoff
visual-hive://handoff-validation
visual-hive://hive-export
visual-hive://hive/beads
visual-hive://hive/knowledge-facts
visual-hive://hive/knowledge-graph
visual-hive://hive/repair-work-orders
visual-hive://hive/agent-policy
visual-hive://hive-guarded-repair-preview
visual-hive://hive-repair-request-envelope
visual-hive://hive-trusted-repair-consumer-summary
visual-hive://hive-trusted-repair-workflow-dry-run
visual-hive://hive-mode-comparison
visual-hive://coverage-map
visual-hive://coverage-recommendations
visual-hive://mutation-report
visual-hive://triage-report
visual-hive://issue-body
visual-hive://pr-comment
visual-hive://triage-prompt
visual-hive://repair-prompt
visual-hive://missing-tests
visual-hive://provider-results
visual-hive://provider-upload/argos/manifest
visual-hive://artifacts/index
visual-hive://agent-packet
visual-hive://handoff-agent-packet
visual-hive://provider-agent-packet
visual-hive://tool-registry
visual-hive://context-ledger
visual-hive://pipeline-status
visual-hive://schema-catalog
```

Read-only/default tools should also stay catalog/schema/docs aligned:

```text
visual_hive_doctor
visual_hive_validate_config
visual_hive_recommend_setup
visual_hive_read_setup_recommendations
visual_hive_read_setup_pr_plan
visual_hive_plan
visual_hive_read_plan_lanes
visual_hive_read_latest_report
visual_hive_read_evidence_packet
visual_hive_read_control_plane_snapshot
visual_hive_read_verdict
visual_hive_read_readiness_gate
visual_hive_read_run_history
visual_hive_read_workflow_audit
visual_hive_read_baseline_review
visual_hive_read_baseline_approvals
visual_hive_read_baseline_rejections
visual_hive_read_testing_layers
visual_hive_read_test_creation_plan
visual_hive_validate_handoff
visual_hive_explain_failure
visual_hive_list_reproduction_commands
visual_hive_generate_repair_prompt
visual_hive_generate_handoff_dry_run
visual_hive_read_hive_export
visual_hive_read_hive_beads
visual_hive_read_hive_knowledge_facts
visual_hive_read_hive_knowledge_graph
visual_hive_read_hive_repair_work_orders
visual_hive_read_hive_agent_policy
visual_hive_read_hive_guarded_repair_preview
visual_hive_read_hive_repair_request_envelope
visual_hive_read_hive_trusted_repair_consumer_summary
visual_hive_read_hive_trusted_repair_workflow_dry_run
visual_hive_read_hive_mode_comparison
visual_hive_read_coverage_recommendations
visual_hive_read_mutation_report
visual_hive_read_triage_report
visual_hive_read_issue_body
visual_hive_read_pr_comment
visual_hive_read_triage_prompt
visual_hive_read_missing_tests
visual_hive_read_provider_results
visual_hive_read_provider_upload_manifest
visual_hive_read_artifacts_index
visual_hive_read_agent_packet
visual_hive_read_handoff_agent_packet
visual_hive_read_provider_agent_packet
visual_hive_read_tool_registry
visual_hive_read_context_ledger
visual_hive_read_pipeline_status
visual_hive_read_schema_catalog
```

The setup recommendation artifact `.visual-hive/recommendations.json` is catalog-backed as `visual-hive://setup-recommendations` / `visual_hive_read_setup_recommendations`, and the setup PR plan artifact `.visual-hive/setup-pr-plan.json` is catalog-backed as `visual-hive://setup-pr-plan` / `visual_hive_read_setup_pr_plan`. Preserve those metadata paths through `packages/core/src/tools/evidenceResources.ts`, schemas, MCP output, Tool Registry cards, Agent Packet metadata, Context Ledger metadata, artifact indexing, Control Plane links, docs, and tests. Treat them as setup review evidence; reading them must not authorize writes.

The plan lane summary artifact `.visual-hive/plans.json` is catalog-backed as `visual-hive://plan-lanes` / `visual_hive_read_plan_lanes`. Preserve that metadata path through `packages/core/src/tools/evidenceResources.ts`, schemas, MCP output, Tool Registry cards, Agent Packet metadata, artifact indexing, Control Plane links, docs, and tests. Treat it as read-only lane comparison evidence across PR, canary, full, schedule, mutation, and docs-only sidecar plans; reading it must not run targets, change plan selection, or override the Visual Hive verdict.

The workflow audit artifact `.visual-hive/workflows.json` is catalog-backed as `visual-hive://workflow-audit` / `visual_hive_read_workflow_audit`. Preserve that metadata path through `packages/core/src/tools/evidenceResources.ts`, schemas, MCP output, Tool Registry cards, Agent Packet metadata, Context Ledger metadata, artifact indexing, Control Plane links, docs, and tests. Treat it as workflow-safety evidence; reading it must not authorize workflow writes, issue creation, secret access, or untrusted PR execution.

The baseline review queue `.visual-hive/baselines.json` is catalog-backed as `visual-hive://baseline-review` / `visual_hive_read_baseline_review`, the approval log `.visual-hive/baseline-approvals.json` is `visual-hive://baseline-approvals` / `visual_hive_read_baseline_approvals`, and the rejection log `.visual-hive/baseline-rejections.json` is `visual-hive://baseline-rejections` / `visual_hive_read_baseline_rejections`. Preserve these metadata paths through `packages/core/src/tools/evidenceResources.ts`, schemas, MCP output, Tool Registry cards, Agent Packet metadata, Context Ledger metadata, artifact indexing, Control Plane links, docs, and tests. Treat them as baseline governance evidence; reading them must not authorize baseline approval, rejection, copy, or update actions.

The run history artifact `.visual-hive/history.json` is catalog-backed as `visual-hive://run-history` / `visual_hive_read_run_history`. Preserve that metadata path through `packages/core/src/tools/evidenceResources.ts`, schemas, MCP output, Tool Registry cards, Agent Packet metadata, Context Ledger metadata, artifact indexing, Control Plane links, docs, and tests. Treat it as trend evidence for flake, baseline stability, mutation adequacy, runtime, and cost review; reading it must not rerun checks, approve baselines, or override the Visual Hive verdict.

The testing-layer artifact `.visual-hive/testing-layers.json` is catalog-backed as `visual-hive://testing-layers` / `visual_hive_read_testing_layers`. Preserve that metadata path through `packages/core/src/tools/evidenceResources.ts`, schemas, MCP output, Tool Registry cards, Agent Packet metadata, Context Ledger metadata, artifact indexing, Control Plane links, docs, and tests. Treat it as advisory missing-layer evidence, not a verdict override.

The test-creation-plan artifact `.visual-hive/test-creation-plan.json` is catalog-backed as `visual-hive://test-creation-plan` / `visual_hive_read_test_creation_plan`. Preserve that metadata path through `packages/core/src/tools/evidenceResources.ts`, schemas, MCP output, Tool Registry cards, Agent Packet metadata, Context Ledger metadata, artifact indexing, Control Plane links, docs, and tests. Treat it as advisory no-write missing-test guidance, not authority to change config or tests without review.

The provider-specialist artifact `.visual-hive/provider-agent-packet.json` is catalog-backed as `visual-hive://provider-agent-packet` / `visual_hive_read_provider_agent_packet`. Preserve that metadata path through `packages/core/src/tools/evidenceResources.ts`, schemas, MCP output, Tool Registry cards, Agent Packet metadata, Context Ledger metadata, artifact indexing, Control Plane links, docs, and tests.

Execution tools must be disabled unless explicitly enabled:

```text
visual_hive_run
visual_hive_mutate
visual_hive_update_baseline
visual_hive_handoff_github_issue
visual_hive_handoff_hive_bead
visual_hive_hive_repair
visual_hive_provider_upload
```

Third-party MCPs must be disabled by default and exposed only through role/mode/budget policy.

Default enterprise policy:

```yaml
agentTools:
  exposeThirdPartyMcp: false
  defaultAccess: read_only
  providerMcpDefault: disabled
  githubWritesFromPr: false
  externalUploadsFromPr: false
  baselineApprovalByAgent: false
  requireHumanApprovalFor:
    - provider_upload_enablement
    - baseline_approval
    - github_issue_creation
    - hive_bead_creation
    - paid_provider_connection
    - protected_target_run
```

## Implementation style

Work in small vertical slices:

```text
analyze -> plan -> run -> report -> triage -> evidence -> handoff -> agent packet -> tools -> UI/docs -> tests
```

Avoid giant rewrites. Prefer focused, testable improvements.

When adding code:

- keep TypeScript types strict;
- keep artifacts schema-versioned;
- add tests for selected/skipped reasons;
- test sanitizer behavior;
- test provider/LLM disabled/default behavior;
- test PR-safe/protected target behavior;
- test agent packet/tool registry budget behavior if implemented;
- update docs and examples in the same change.

## Validation commands

Use relevant targeted commands while developing. Before final handoff, run as many of these as feasible and report exact results:

Run long commands with explicit timeouts or scripted non-interactive behavior. If a command is only needed for later confirmation, do not block all progress waiting on it.

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

Also validate important CLI flows where available:

```bash
node packages/cli/dist/index.js --help
node packages/cli/dist/index.js recommend --help
node packages/cli/dist/index.js hive export --config examples/demo-react-app/visual-hive.config.yaml --dry-run
node packages/cli/dist/index.js plan --config examples/kubestellar-console/visual-hive.config.yaml --mode pr --changed-files examples/kubestellar-console/sample-auth-changed-files.txt
node packages/cli/dist/index.js plan --config examples/kubestellar-console/visual-hive.config.yaml --mode pr --changed-files examples/kubestellar-console/sample-docs-changed-files.txt
node packages/cli/dist/index.js plan --config examples/kubestellar-console/visual-hive.config.yaml --mode schedule
```

If a listed command does not exist, do not fake success. Either add it if in scope, or document that it is not currently present and what equivalent command was used.

## Acceptance criteria

The goal run is successful if the repo has moved measurably toward agent-forward operational beta and produces real, inspectable outputs. At minimum, provide:

- summary of actual initial state found;
- implemented changes, not only docs;
- tests added/updated;
- docs updated;
- validation commands and exact results;
- artifacts produced;
- remaining gaps ranked by priority;
- next prompt for unfinished work.

Do not claim production readiness unless validation commands pass and the external-repo/KubeStellar flow has real artifacts.

## Final handoff format

End with:

```markdown
## Summary
- ...

## Files changed
- ...

## Validation
- command: result

## Artifacts produced
- ...

## Agent/tool policy changes
- ...

## Remaining gaps
1. ...

## Next prompt
...
```
