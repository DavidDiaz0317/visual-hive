# Agent Packet Schema

The Agent Packet is a role-specific, sanitized work envelope for humans and coding agents. It is derived from the Evidence Packet and optional Handoff Packet, then scoped to one profile:

- `repair_agent`: fix deterministic failures without changing the verdict policy.
- `test_creator`: strengthen contracts from mutation survivors, coverage gaps, and missing testing-layer evidence.
- `review_agent`: audit evidence, artifacts, governance, and residual risk.
- `handoff_agent`: prepare trusted GitHub/Hive routing artifacts without executing PR code.
- `provider_specialist`: review optional provider evidence, upload policy, blocked reasons, and provider readiness without enabling external uploads or changing verdict policy.

Run:

```bash
visual-hive evidence --config visual-hive.config.yaml
visual-hive handoff --dry-run --config visual-hive.config.yaml
visual-hive test-creation-plan --config visual-hive.config.yaml
visual-hive agent-packet --config visual-hive.config.yaml --profile repair_agent
visual-hive agent-packet --config visual-hive.config.yaml --profile handoff_agent --output .visual-hive/handoff-agent-packet.json
visual-hive agent-packet --config visual-hive.config.yaml --profile provider_specialist --output .visual-hive/provider-agent-packet.json
```

The default output is `.visual-hive/agent-packet.json`. The demo and agent-handoff Control Plane run profile also write `.visual-hive/handoff-agent-packet.json` for the handoff-agent packet, while the provider-governance run profile writes `.visual-hive/provider-agent-packet.json` for provider-specialist review. Those role-specific packets sit beside the main repair/test Agent Packet without replacing it, and both role-specific packet paths are catalog-backed read-only evidence resources for MCP, Tool Registry, Context Ledger, artifact index, and Control Plane consumers.

Schema: `schemas/visual-hive.agent-packet.schema.json`

## Contract

The packet includes:

- `objective`: the bounded job the agent should perform.
- `verdict`: Visual Hive's deterministic verdict summary.
- `evidenceSummary`: compact gating/advisory evidence, work items, selected contracts and targets, mutation score, provider evidence summaries, the testing-layer status snapshot, and optional test-creation recommendations.
- `evidenceSummary.providerEvidence`: sanitized optional provider posture copied from the Evidence Packet, including upload status, external calls made, staged/uploaded artifact counts, missing credential names, blocked reasons, manifest path, upload directory, and provider URL. This guides agents but does not grant provider upload authority or verdict authority.
- `evidenceSummary.runHistory`: optional longitudinal trend evidence from `.visual-hive/history.json`, including run count, latest deterministic status, latest mutation score, trend direction, and baseline/visual-diff totals. It is catalog-backed as `visual-hive://run-history` / `visual_hive_read_run_history` and has `authority: trend_evidence_only`; reading it does not rerun checks, approve baselines, or override the Visual Hive verdict.
- `allowedTools`: read-only or local-only tools the profile may use. Catalog-backed evidence tools include `evidenceResourceId`, `evidenceResourceUri`, `evidenceResourceTitle`, `evidenceResourceDescription`, `evidenceReadToolName`, and `artifactPath` so an agent can resolve the allowed tool to the same resource identity used by the MCP manifest, Tool Registry, artifact index, and Control Plane.
- `forbiddenActions`: actions that require human/trusted-workflow authority or are never allowed.
- `budgets`: local tool-call and token budgets, with `allowExternalNetwork: false` and `maxExternalCostUsd: 0` by default.
- `reproductionCommands`: focused commands for humans or trusted local agents.
- `artifactPointers`: exact artifacts to inspect before loading broad repository context.
- `governance`: states that Visual Hive, not the agent, owns the verdict.

## Governance

Agents may repair, explain, suggest tests, or prepare handoff artifacts. They must not:

- decide or override the Visual Hive verdict;
- read or expose secret values;
- approve baselines without human review;
- enable paid provider uploads without policy authorization;
- run protected targets without approval;
- execute untrusted PR code through privileged workflows.

The packet is intentionally smaller than the Evidence Packet. It gives agents enough context to act without forcing them to scrape CI logs, ingest every raw artifact, or guess which tools are safe. When an allowed tool points at a known Visual Hive artifact, the packet uses the shared core evidence-resource catalog rather than hand-written duplicate path metadata; this keeps agent packets aligned with MCP resources and Control Plane artifact links.

The `handoff_agent` profile is the exception to the "smallest packet" rule because its job is trusted routing. It receives catalog-backed read-only tools for the compact Handoff Packet, handoff validation, Hive native export, split Hive bead/fact/graph/work-order/policy artifacts, guarded repair preview, repair request envelope, trusted repair consumer summary, trusted repair workflow dry-run, Hive mode comparison, and provider evidence. These entries are still local-only evidence reads: they do not create GitHub issues, create Hive Beads, call Hive, call providers, execute repair, approve baselines, or decide the Visual Hive verdict.

Testing-layer gaps are converted into bounded work items before they reach the agent. For example, a missing mutation layer becomes a `test_creation` task, an unknown workflow-safety layer becomes a `setup` task, and flake/history gaps become `review` tasks. `visual-hive improve-coverage` writes deterministic no-write coverage recommendations as `visual-hive://coverage-recommendations` / `visual_hive_read_coverage_recommendations`; `visual-hive test-creation-plan` can further convert those recommendations, work items, and mutation survivors into `.visual-hive/test-creation-plan.json`. The JSON test-creation plan is catalog-backed as `visual-hive://test-creation-plan` / `visual_hive_read_test_creation_plan` so agents can read recommendations without scraping raw artifacts. These tasks remain advisory repair or test-generation guidance; they do not affect the Visual Hive verdict unless normalized deterministic evidence and policy allow it.
