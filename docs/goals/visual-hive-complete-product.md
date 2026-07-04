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
- No-network Hive export artifacts for beads, knowledge facts, graph edges, wiki pages, issue context, repair work orders, agent policy, and side-by-side advisory/measured/repair-request/guarded-repair/full mode comparison.
- Evidence Packet Hive readiness fields that recommend the safest current Hive mode and show per-mode readiness for `advisory`, `measured`, `repair_request`, `guarded_repair`, and `full` before any export or trusted workflow is enabled.
- Trusted Hive handoff validation that consumes the Evidence Packet, verifies no-network/dry-run policy, checks Hive readiness mode policy, blocks unsafe full automation, validates the optional Hive repair-chain artifacts when they exist, and preserves sanitized evidence for trusted workflow consumers.
- Preview-only guarded repair artifact generation through `visual-hive hive guarded-repair-preview`, which consumes Hive repair work orders and agent policy, performs no repair, makes no Hive network calls, and exposes branch/review/rerun/forbidden-action readiness for future trusted Hive repair lanes.
- No-network trusted repair request envelope generation through `visual-hive hive repair-request-envelope`, which consumes the guarded repair preview and packages branch names, labels, required commands, acceptance criteria, blocked reasons, and Visual Hive verdict-authority policy for a future trusted Hive/GitHub repair workflow without creating branches, PRs, issues, or Hive Beads itself.
- No-network trusted repair consumer summary generation through `visual-hive hive trusted-repair-consumer-summary`, which consumes the repair request envelope and produces a trusted workflow readiness summary without checking out code, creating branches, opening pull requests, creating issues, calling Hive, calling providers, rerunning Visual Hive, or executing repair.
- No-network trusted repair workflow dry-run generation through `visual-hive hive trusted-repair-workflow-dry-run`, which consumes the trusted repair consumer summary and produces a reviewable future trusted workflow plan without checking out code, creating branches, opening pull requests, creating issues, calling Hive, calling providers, rerunning Visual Hive, or executing repair.
- Pipeline and demo acceptance ordering that generates the full Hive repair chain before `handoff-validate` runs, so validation consumes fresh Hive export, guarded repair preview, repair request envelope, trusted repair consumer summary, and trusted repair workflow dry-run artifacts instead of stale optional files.
- Context Ledger budget override support in CLI/demo flows, including bounded tool-call, token, provider screenshot, and external-cost budgets so agent-forward runs can stay measurable and constrained.
- Schema catalog discipline for tracked JSON Schemas, including stable `https://visual-hive.dev/schemas/<filename>` `$id` values and tests that ensure artifact index entries point to checked-in schemas.
- Schema/catalog drift verification through `visual-hive schemas verify`, which checks tracked JSON Schema `$id` values and evidence-resource enums against the shared core evidence-resource catalog so MCP resources, Tool Registry cards, Agent Packet allowed tools, Context Ledger tool-call metadata, artifact-index metadata, and Control Plane links do not silently diverge. The root `npm run schema:verify` path writes `.visual-hive/schema-catalog.json`, which is now catalog-backed as `visual-hive://schema-catalog` / `visual_hive_read_schema_catalog` so reviewers and agents can inspect schema/catalog health without re-running maintenance checks.
- Control Plane schema/catalog health visibility: `/api/snapshot` reads `.visual-hive/schema-catalog.json`, the Configure area shows pass/fail drift status and failed checks, the Expert evidence view includes the raw catalog, navigation badges surface failed drift checks, and the runbook/profile surface exposes a guarded `schemas-verify` action. Schema/catalog drift is therefore visible to users and agents as product evidence, not only as a developer maintenance script.
- Standalone schema, artifact-index, and read-only evidence-resource support for Hive-native sub-artifacts, including `beads.json`, `knowledge-facts.json`, `knowledge-graph.json`, `wiki-index.json` (`visual-hive://hive/wiki-index` / `visual_hive_read_hive_wiki_index`), `repair-work-orders.json`, and `hive-agent-policy.json`, so Hive, MCP tools, agents, and trusted workflow consumers can read focused evidence files without parsing the full Hive export bundle or scanning the wiki directory.
- Provider upload artifact indexing that labels Argos upload manifests as `provider-upload` evidence and maps them to the provider upload schema instead of treating them as anonymous JSON.
- Provider upload evidence visibility across CLI reports, issue bodies, offline triage, and the Control Plane, including upload status, external-call count, staged/uploaded artifact counts, sanitized command metadata, stderr/stdout excerpts, provider URLs, and manifest/artifact links without making providers verdict authorities by default.
- Normalized provider upload evidence now flows through the Evidence Packet, Context Ledger, Agent Packet, and Hive export bundle. Provider upload failures remain advisory unless a provider is explicitly configured as normalized, trusted, gating, and budget-authorized verdict evidence.
- Hive export issue context, wiki facts, graph evidence, and agent-facing packets now carry provider upload status in sanitized form, so Hive and future repair agents can understand external-provider readiness without receiving credentials or treating hosted review output as the default oracle.
- MCP and Tool Registry provider evidence alignment: `visual_hive_read_provider_results` and `visual_hive_read_provider_upload_manifest` are read-only local evidence tools, their resources are exposed through `visual-hive mcp`, and provider-specialist/handoff/review agents may inspect provider results or Argos upload manifests without gaining upload authority or verdict authority.
- Readiness gate evidence is also catalog-backed as `visual-hive://readiness-gate` / `visual_hive_read_readiness_gate`, so agents and trusted workflow consumers can inspect go/no-go readiness without scraping raw reports, rerunning targets, or treating guidance as a verdict override.
- Agent Packet provider-specialist profile support: `visual-hive agent-packet --profile provider_specialist` creates a no-network, zero-external-cost packet for provider evidence review, provider handoff dry-run inspection, blocked-reason review, and optional provider readiness work without granting upload authority or changing the Visual Hive verdict.
- Agent Packet handoff-agent profile support: `visual-hive agent-packet --profile handoff_agent --output .visual-hive/handoff-agent-packet.json` creates a no-network, zero-external-cost packet for trusted GitHub/Hive routing review. It exposes catalog-backed read-only evidence tools for the compact handoff packet, handoff validation, Hive export, split Hive bead/fact/graph/work-order/policy artifacts, guarded repair preview, repair request envelope, trusted repair consumer summary, trusted repair workflow dry-run, Hive mode comparison, readiness/provider evidence, and related artifact metadata without creating issues, creating Hive Beads, calling Hive, calling providers, executing repair, or changing the Visual Hive verdict.
- Provider-specialist demo and Control Plane visibility: `demo:all`, `demo:ci`, `visual-hive pipeline`, and the provider-governance run profile generate or expose `.visual-hive/provider-agent-packet.json`, and the Control Plane Providers view shows its bounded tools, no-network budget, artifact link, and forbidden provider actions.
- Handoff-agent demo and Control Plane visibility should remain part of the expected agent-forward baseline: the demo suite, `visual-hive pipeline`, and the `agent-handoff-review` run profile should generate or expose `.visual-hive/handoff-agent-packet.json`, the Control Plane should surface it in expert evidence and runbook/profile flows, and the artifact index/MCP/tool registry surfaces should keep it catalog-backed as read-only local evidence.
- Beginner-friendly Control Plane guidance: the Start/Quality Cockpit view now includes a setup/adoption checklist that translates artifact state into plain-language progress from configuration through PR-safe planning, deterministic evidence, baseline review, mutation adequacy, agent handoff, and safe workflow enablement. The checklist is part of `/api/snapshot`, not only React presentation: each item carries the linked runbook command ID, command text, safety class, expected artifacts, runnable state, and blocked reason. Beginner mode should stay task-oriented and explain "why this matters"; expert mode should keep commands, artifact paths, raw evidence, and advanced controls accessible.
- Shared Control Plane runbook/action policy: guided actions, run profiles, checklist items, and executable command IDs now share one policy surface instead of drifting through duplicated React, snapshot, and command-executor lists. Future work should keep beginner guidance, expert runbook commands, and write/read-only gating aligned through that shared policy.
- Schema-backed Control Plane snapshots are now a first-class artifact surface. `visual-hive snapshot` writes `.visual-hive/control-plane-snapshot.json`, the artifact index labels it as `control-plane-snapshot` evidence, `visual-hive mcp` exposes it through `visual-hive://control-plane-snapshot` and `visual_hive_read_control_plane_snapshot`, the Tool Registry describes it as read-only local evidence, and `schemas/visual-hive.control-plane-snapshot.schema.json` documents the `/api/snapshot` contract for the UI, smoke tests, agents, and future hosted/control-plane consumers. Future work should preserve this public snapshot contract instead of making the React UI depend on undocumented local JSON shapes.
- Bounded local command execution for agent-facing helper scripts, CLI changed-file discovery, and optional provider upload commands, including explicit timeouts for demo suites, consumer install smoke checks, `run-with-env`, git-diff helpers, and Argos CLI execution so future agents do not leave shells waiting indefinitely.
- Batched mutation adequacy execution: the default `visual-hive mutate` path can run multiple applicable mutation operators through one Playwright/server lifecycle using an operator-to-contract matrix while still writing per-operator structured evidence, `mutationOperator` fields in contract results, killed/survived/not_applicable rows, and the standard mutation score. Future work should preserve this contract-aware batch path unless replacing it with a faster equivalent that keeps the same report evidence and target-lifecycle guarantees.
- Nested-repo and nested-config ergonomics should remain a product-correctness concern. Commands that inspect repository-level workflows, security posture, readiness, risk, setup status, changed files, or artifact paths should make path resolution explicit and user-friendly when `--config` points below the repository root. A config under `examples/demo-react-app/` or `web/e2e/` should not silently cause `.github/workflows` audits to scan zero files when the user clearly invoked Visual Hive from the repository root. Prefer deterministic resolution with tests: config-root-relative paths first when they exist, then current-working-directory/repo-root-relative fallbacks for common repo-level paths, with diagnostics that say what was scanned.
- Demo acceptance scripts including `demo:all`, `demo:ci`, `demo:snapshot`, `demo:evidence-resources`, `smoke:cli`, `smoke:consumer`, `smoke:console`, `smoke:console:run`, and `smoke:ui`. The bounded demo suite should generate schema/catalog evidence before the Control Plane snapshot, then generate the artifact index, then run a persisted evidence-resource consistency check so `.visual-hive/context-ledger.json`, `.visual-hive/control-plane-snapshot.json`, `.visual-hive/artifacts-index.json`, `.visual-hive/mcp-manifest.json`, and role-specific Agent Packets agree on catalog-backed resource IDs, URIs, artifact paths, descriptions, and read-tool names before the UI smoke runs. The same checker should run in generic mode for consumer install smoke output, KubeStellar planning artifacts, and local real-console dogfood output where those generated surfaces exist, so catalog-backed evidence identity is not only a demo-app property. The fast `smoke:console` path should stay no-target/no-network from Visual Hive's side, while `smoke:console:run` is the heavier opt-in proof that Visual Hive can plan a localPreview-only lane, start the real Console preview server, seed baselines, rerun strict CI-mode screenshots, and verify lifecycle plus screenshot metadata. `smoke:console:run` should reuse an existing Console `web/dist` build by default and require explicit `VISUAL_HIVE_CONSOLE_BUILD=true` when rebuilding the external repo is desired, so dogfood validation does not hide Visual Hive regressions behind a long external TypeScript build.
- Console dogfooding direction through KubeStellar-style hosted demo, local preview, fake OAuth planning, and protected live-cluster modeling.

The next product work should focus on tightening vertical slices that connect scanner/recommendation, planning, execution, evidence, Control Plane guidance, provider governance, and Hive handoff into one understandable workflow. The `visual-hive hive trusted-repair-workflow-dry-run` slice, bounded Argos/provider upload execution, provider upload normalization across Evidence Packet, Context Ledger, Agent Packet, and Hive export, the handoff-agent and provider-specialist packet/control-plane paths, the schema-backed Control Plane snapshot artifact, and the batched contract-aware mutation runner are now part of the baseline: future agents should validate them, preserve their no-network/no-write/no-checkout/no-provider-call guarantees unless an explicit trusted upload mode is configured, and build on them rather than reimplementing them. `visual-hive pipeline` and the demo suite should continue running `handoff-validate` after the full Hive repair chain has been regenerated, continue generating the main Agent Packet plus role-specific `.visual-hive/handoff-agent-packet.json` and `.visual-hive/provider-agent-packet.json`, continue preserving per-operator mutation evidence, and continue producing the Control Plane snapshot before the final artifact index. If validation shows that slice is missing or regressed, repair it first; otherwise, move to the next highest-leverage vertical slice toward trusted workflow consumption, Hive handoff policy, real repo dogfooding, beginner-friendly Control Plane guidance, schema/artifact consistency, provider evidence normalization, mutation runtime/cost controls, or budget-governed agent execution.

Recent metadata-consistency work made the shared evidence-resource catalog in core the source of truth for read-only MCP resources, MCP read tools, Tool Registry resource-backed read tool cards, Agent Packet allowed-tool evidence metadata, Context Ledger tool-call evidence metadata, artifact index evidence metadata, and Control Plane artifact links. Known evidence artifacts now expose resource IDs, URIs, titles, descriptions, artifact paths, and MCP read tool names in `.visual-hive/artifacts-index.json`, Agent Packets, Context Ledger tool calls, and the Control Plane artifact browser. The structured `visual-hive mcp --format json` manifest, the human-readable `visual-hive mcp --describe` output, `visual-hive schemas verify`, and the `.visual-hive/schema-catalog.json` artifact should preserve catalog resource IDs and read-tool names, so humans and agents see the same evidence-resource identity and can catch schema drift before committing. Future agents should preserve that catalog-driven path instead of reintroducing duplicated hand-written resource names, artifact paths, or read-only tool descriptions across CLI, core, schemas, and docs. The remaining high-leverage continuation is to keep pushing any new resource-backed surfaces through the same catalog when practical. This is not a new user-facing feature; it is product correctness for agent-forward workflows.

If continuing directly from this metadata work, first verify that any new Hive-native or agent-forward output artifacts preserve the same catalog-backed evidence identity. The Hive export bundle, Hive repair-chain artifacts, Hive sub-artifact schemas, MCP manifest, Tool Registry, Agent Packet allowed tools, Context Ledger tool calls, artifact index, Control Plane artifact links, and checked-in JSON Schemas should all agree on resource IDs, URIs, artifact paths, descriptions, and read-tool names before new agent/provider/Hive surface area is added. `hive-export.json` now carries `outputResources` for split Hive JSON artifacts, and the guarded repair preview, repair request envelope, trusted repair consumer summary, trusted repair workflow dry-run, and mode comparison artifacts each carry an `outputResource` row for their own catalog-backed read-only evidence identity. The provider-specialist packet `.visual-hive/provider-agent-packet.json` is also catalog-backed as `visual-hive://provider-agent-packet` / `visual_hive_read_provider_agent_packet`; preserve that read-only evidence-resource identity across schemas, MCP output, Tool Registry, Agent Packet metadata, Context Ledger metadata, artifact index, Control Plane links, docs, and tests.

Testing-layer evidence is now expected to follow the same catalog-backed path: `.visual-hive/testing-layers.json` should be read-only local evidence under `visual-hive://testing-layers` / `visual_hive_read_testing_layers`, with matching Tool Registry, MCP, Agent Packet metadata, Context Ledger metadata, artifact-index metadata, Control Plane links, docs, schemas, and tests. The Markdown summary remains a normal human-readable artifact. Preserve existing CLI behavior; this is drift prevention and agent-forward correctness, not a new verdict source.

Test-creation-plan evidence should follow the same pattern: `.visual-hive/test-creation-plan.json` should be read-only local evidence under `visual-hive://test-creation-plan` / `visual_hive_read_test_creation_plan`, with matching Tool Registry, MCP, Agent Packet metadata, Context Ledger metadata, artifact-index metadata, Control Plane links, docs, schemas, and tests. The Markdown summary remains a normal human-readable artifact. Preserve existing CLI behavior; the plan is advisory no-write missing-test guidance, not authority to edit config, tests, baselines, thresholds, or verdict policy by default.

Coverage-recommendation evidence should also remain catalog-backed: `.visual-hive/coverage-recommendations.json` is read-only local evidence under `visual-hive://coverage-recommendations` / `visual_hive_read_coverage_recommendations`. It may contain guarded config snippets and apply IDs, but reading the artifact does not authorize applying config edits. Preserve explicit `--apply` diff preview and `--yes` write confirmation as the only local write path.

Setup onboarding evidence should remain catalog-backed as well: `.visual-hive/recommendations.json` is read-only local evidence under `visual-hive://setup-recommendations` / `visual_hive_read_setup_recommendations`, and `.visual-hive/setup-pr-plan.json` is read-only local evidence under `visual-hive://setup-pr-plan` / `visual_hive_read_setup_pr_plan`. These artifacts may describe generated config/docs/workflow bundles and setup PR plans, but reading them does not authorize writing config, docs, workflows, secrets, provider settings, branches, pull requests, or issues. Preserve explicit write commands, overwrite preflight, confirmation boundaries, and no-network setup review.

Workflow safety evidence should remain catalog-backed: `.visual-hive/workflows.json` is read-only local evidence under `visual-hive://workflow-audit` / `visual_hive_read_workflow_audit`. It can show PR permission posture, secret usage, `pull_request_target` findings, artifact upload posture, and trusted `workflow_run` issue/handoff safety, but reading it does not authorize writing workflows, granting secrets, creating issues, or executing untrusted PR code.

Baseline governance evidence should remain catalog-backed: `.visual-hive/baselines.json` is read-only local evidence under `visual-hive://baseline-review` / `visual_hive_read_baseline_review`, `.visual-hive/baseline-approvals.json` is read-only local evidence under `visual-hive://baseline-approvals` / `visual_hive_read_baseline_approvals`, and `.visual-hive/baseline-rejections.json` is read-only local evidence under `visual-hive://baseline-rejections` / `visual_hive_read_baseline_rejections`. These artifacts may show created, missing, failed, approved, rejected, and pending screenshot review decisions, but reading them does not authorize approving, rejecting, copying, or updating baselines. Preserve explicit human confirmation and trusted write boundaries for baseline changes.

Run history evidence should remain catalog-backed: `.visual-hive/history.json` is read-only local evidence under `visual-hive://run-history` / `visual_hive_read_run_history`. It may show longitudinal deterministic status, mutation score, flake signals, baseline review, runtime, and cost trends, but reading it does not authorize rerunning checks, approving baselines, changing verdict policy, or inferring a new verdict from history alone.

Triage evidence should remain catalog-backed too: `.visual-hive/triage.json`, `.visual-hive/issue.md`, `.visual-hive/pr-comment.md`, `.visual-hive/triage-prompt.md`, `.visual-hive/repair-prompt.md`, and `.visual-hive/missing-tests.md` should expose read-only evidence-resource identities for deterministic triage, sanitized GitHub-ready text, advisory LLM prompts, and missing-test recommendations. Reading those artifacts must not post GitHub comments, create issues, call an LLM, edit tests, or override the Visual Hive verdict. The current catalog direction is to expose those artifacts as focused resources such as `visual-hive://triage-report`, `visual-hive://issue-body`, `visual-hive://pr-comment`, `visual-hive://triage-prompt`, `visual-hive://repair-prompt`, and `visual-hive://missing-tests`, with matching read-only tools where appropriate.

Current continuation marker: the recent catalog-backed work promotes triage and repair-adjacent outputs into the shared evidence-resource model after the run-history slice, and `.visual-hive/plans.json` is now catalog-backed as lane-comparison evidence under `visual-hive://plan-lanes` / `visual_hive_read_plan_lanes`. Future work should preserve `.visual-hive/history.json` as trend evidence; preserve `.visual-hive/plans.json` as read-only PR/canary/full/schedule/docs-only lane evidence; preserve `.visual-hive/hive/wiki-index.json` as Hive wiki-vault index evidence under `visual-hive://hive/wiki-index` / `visual_hive_read_hive_wiki_index`; and preserve `.visual-hive/triage.json`, `.visual-hive/issue.md`, `.visual-hive/pr-comment.md`, `.visual-hive/triage-prompt.md`, `.visual-hive/repair-prompt.md`, and `.visual-hive/missing-tests.md` as catalog-backed read-only evidence across the core evidence-resource catalog, JSON Schemas, MCP manifest/read tools, Tool Registry, Agent Packet metadata, Context Ledger metadata, artifact index, Control Plane links, docs, and smoke tests. These artifacts are read-only evidence and guidance; they must not post GitHub comments, create issues, call LLMs, edit tests, approve baselines, run targets, change plan selection, or override the Visual Hive verdict. The latest schema/catalog verification for this slice passed with 63 tracked schemas, 128 checks, 50 evidence resources, and 47 evidence read tools. The last full validation for the surrounding worktree passed `npm run build`, `npm run typecheck`, `npm test` with 317 tests, `npm run lint`, and `npm run demo:all`; future agents must rerun the relevant validation after any edits and should not treat those old counts as current.

Recent role-profile work finished the first triage/repair-guidance Agent Packet slice: the repair, test-creator, handoff, and review profiles should expose the relevant catalog-backed read-only tools with resource IDs, URIs, artifact paths, and read-tool names rather than plain duplicated tool strings. The Tool Registry role profiles now prioritize the relevant triage report, issue body, PR comment, repair prompt, and missing-test guidance tools for those roles. Future agents should preserve this catalog-backed role metadata and add tests before changing role tool priorities.

Generated demo artifact consistency is now expected baseline for the catalog-backed evidence-resource model. Context Ledger multi-resource evidence exposure is also expected baseline: Context Ledger tool calls may carry `evidenceResources[]` in addition to compatibility `evidenceResourceId` / `evidenceResourceUri` fields when one command produced multiple catalog-backed artifacts, and the Control Plane snapshot/expert evidence should preserve those links. `demo:evidence-resources` verifies that `.visual-hive/context-ledger.json`, `.visual-hive/control-plane-snapshot.json`, `.visual-hive/artifacts-index.json`, `.visual-hive/mcp-manifest.json`, and role-specific Agent Packets expose the same catalog-backed resource IDs, URIs, artifact paths, descriptions, and read-tool names for triage, issue, PR comment, prompt, repair, missing-test, provider, and support evidence when those artifacts exist. The checker also supports `--root <repo> --profile general`, which is used by KubeStellar planning artifacts, consumer install smoke output, and `smoke:console` real-console dogfood output to verify catalog-backed evidence identity for non-demo generated artifacts. The console dogfood smoke now covers both external-repo setup onboarding artifacts at the console repo root (`.visual-hive/recommendations.json` and `.visual-hive/setup-pr-plan.json`) and config-scoped evidence artifacts under `web/e2e/.visual-hive`; it verifies setup output-resource metadata, zero setup external calls, safe generated workflow posture, and current Agent Packet budget policy through `budgets.allowExternalNetwork=false` and `budgets.maxExternalCostUsd=0`, so role packets remain no-network/no-cost unless a future trusted mode explicitly changes policy. `.visual-hive/plans.json` should remain catalog-backed as `visual-hive://plan-lanes` / `visual_hive_read_plan_lanes`, so sidecar PR/canary/full/schedule/docs-only plans are reachable as read-only lane evidence without making each sidecar plan a separate hard-coded resource. Future agents should preserve that check and update it when new catalog-backed generated artifacts become part of demo, consumer, KubeStellar, or dogfood acceptance.

Immediate next step for a resumed goal run: extend the same catalog-backed consistency discipline to real-console dogfood artifacts and any newly generated external-repo setup artifacts. The goal is not to add broad new features; it is to ensure that when another repository consumes Visual Hive, the generated Evidence Packet, Context Ledger, MCP manifest, Agent Packets, artifact index, and Control Plane snapshot still expose consistent resource IDs, URIs, artifact paths, descriptions, and read-tool names without leaking secrets, calling providers, calling LLMs, or granting agents verdict authority.

The first-party `visual_hive_mcp` entry is now an available local MCP adapter over Visual Hive CLI/JSON artifacts, not a planned third-party provider integration. It should remain read-only by default, local-first, no-network, and evidence-oriented unless a future trusted mode explicitly grants additional authority. Third-party MCPs and provider-specific MCPs should stay disabled or planned until their access, cost, network, and verdict-authority policies are explicit.

Future implementation agents should also preserve the current operating discipline: run long tooling with sensible timeouts or non-interactive batch commands, avoid waiting indefinitely on shells, and use targeted validation while developing before running the full handoff suite.

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
.visual-hive/hive/guarded-repair-preview.json
.visual-hive/hive/guarded-repair-preview.md
.visual-hive/hive/repair-request-envelope.json
.visual-hive/hive/repair-request-envelope.md
.visual-hive/hive/trusted-repair-consumer-summary.json
.visual-hive/hive/trusted-repair-consumer-summary.md
.visual-hive/hive/trusted-repair-workflow-dry-run.json
.visual-hive/hive/trusted-repair-workflow-dry-run.md
.visual-hive/hive/mode-comparison.json
.visual-hive/hive/mode-comparison.md
.visual-hive/hive/modes/advisory/**
.visual-hive/hive/modes/measured/**
.visual-hive/hive/modes/repair_request/**
.visual-hive/hive/modes/guarded_repair/**
.visual-hive/hive/modes/full/**
.visual-hive/hive/wiki/*.md
```

The command surface should include:

```bash
visual-hive hive export --dry-run
visual-hive hive export --mode measured
visual-hive hive export --mode repair_request
visual-hive hive guarded-repair-preview
visual-hive hive repair-request-envelope
visual-hive hive trusted-repair-consumer-summary
visual-hive hive trusted-repair-workflow-dry-run
visual-hive hive compare-modes
```

`visual-hive hive compare-modes` should remain no-network and write a side-by-side preview of the safe Hive export levels. It lets a maintainer compare advisory issue context, measured Beads/knowledge graph/wiki output, and guarded repair-request work orders before enabling any trusted Hive workflow. The Control Plane should surface this comparison as a beginner-friendly policy explanation and as expert-accessible artifacts.

`visual-hive hive repair-request-envelope` should remain no-network and trusted-workflow-only. It should not execute repair, create a branch, open a pull request, create a GitHub issue, or call Hive. Its job is to turn a ready guarded repair preview into a sanitized request envelope that a separate trusted workflow or Hive operator can consume. If the guarded preview is blocked, the envelope should still be written as blocked evidence with clear reasons rather than pretending repair is ready.

`visual-hive hive trusted-repair-consumer-summary` should remain a no-network dry-run consumer over the repair request envelope. It should summarize whether a trusted repair workflow could start, which repair requests are ready or blocked, which branch names and PR titles a future trusted workflow would use, and which approvals or commands are still required. It must not checkout code, execute repair, create branches, open pull requests, create issues, call Hive, call providers, or rerun Visual Hive. Its job is to make the next trusted automation step reviewable before any write action exists.

`visual-hive hive trusted-repair-workflow-dry-run` should remain a no-network, no-write plan over the trusted repair consumer summary. It should list the future trusted workflow actions that would validate artifacts, checkout a trusted base, create isolated repair branches, run a bounded Hive repair agent, rerun Visual Hive, and open pull requests, but it must not perform any of those actions itself.

The Evidence Packet should also expose pre-export Hive readiness so users and agents do not need to infer governance status from raw files. The packet should include:

- `recommendedMode`
- `recommendationReason`
- `modeReadiness[]`
- per-mode `status`
- per-mode `blockedReasons`
- per-mode `trustedWorkflowRequired`
- per-mode artifact capabilities

This readiness layer is advisory/control-plane evidence only. It does not call Hive, does not create issues, does not request repair, and does not override the Visual Hive deterministic verdict.

Trusted handoff workflows should validate this readiness layer before consuming Hive artifacts. A handoff validator should refuse missing readiness, refuse `full` as the recommended mode, require `guarded_repair` to remain blocked or trusted-only unless an explicit policy exists, require `full` automation to stay blocked until governance is mature, and validate the optional Hive repair-chain artifacts before any future branch, PR, issue, or Hive API action is considered. When present, that chain includes the Hive export, guarded repair preview, repair request envelope, trusted repair consumer summary, and trusted repair workflow dry run. Validation output should be written as a sanitized artifact such as `.visual-hive/hive-handoff-validation.json` so a trusted GitHub workflow or Hive operator can decide whether to create an issue, enqueue Beads, or request guarded repair without executing untrusted PR code.

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

Long-running validation, development servers, browser checks, Docker services, migrations, and integration tests must be invoked with explicit timeouts, scripted exits, or log polling. Do not leave an interactive command waiting indefinitely.

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
