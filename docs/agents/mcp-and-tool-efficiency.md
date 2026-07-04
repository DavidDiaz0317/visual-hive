# MCP And Tool Efficiency

Visual Hive's MCP surface is an adapter over existing CLI/JSON artifacts. It is not the source of truth, and it must not become an uncontrolled context dump.

Run:

```bash
visual-hive mcp --config visual-hive.config.yaml --describe
visual-hive mcp --config visual-hive.config.yaml --describe --output .visual-hive/mcp-manifest.json
visual-hive mcp --config visual-hive.config.yaml --stdio
visual-hive mcp --repo . --describe --output .visual-hive/mcp-manifest.json
visual-hive schemas verify
```

The `--describe` form exits immediately and prints the read-only resource/tool manifest. Add `--output .visual-hive/mcp-manifest.json` to persist the manifest for CI, agents, or schema validation.

Use the `--repo` form during first-time setup when `.visual-hive/recommendations.json` and `.visual-hive/setup-pr-plan.json` exist but `visual-hive.config.yaml` has not been committed yet. It is manifest-only and exposes setup recommendations, setup PR plan, and artifact-index resources; it does not start `--stdio`, run targets, write config, create PRs, call Hive, call providers, or authorize setup writes.

Schema: `schemas/visual-hive.mcp.schema.json`

The `--stdio` form starts a long-running MCP server for an MCP client. Use a supervising client, timeout, or process manager when launching it from automation.

MCP resources and resource-backed read tools are generated from the shared core evidence resource catalog in `packages/core/src/tools/evidenceResources.ts`. Do not hand-copy artifact paths, resource descriptions, or read-only tool names into MCP or agent docs without updating that catalog and the corresponding tests. MCP, Tool Registry cards, Agent Packets, artifact indexes, and Control Plane links should describe the same evidence system.

When a catalog-backed artifact contains nested evidence links, such as Context Ledger `toolCalls[].evidenceResources`, MCP resource reads and read-only tools should preserve those fields in sanitized form. They should not flatten multi-artifact steps back to a single raw path or require agents to infer linked triage, issue, prompt, and missing-test artifacts manually.

Each resource in `visual-hive mcp --describe --format json` includes the catalog `id`, `uri`, display metadata, artifact `relativePath`, MIME type, and `readToolName` when a read-only MCP tool exists for the same resource. This lets agents correlate MCP resources with Tool Registry cards, Agent Packet allowed tools, artifact-index evidence metadata, and Control Plane artifact links without guessing from URI strings.

The Markdown `--describe` output mirrors that identity in a compact resource line:

```text
- latest-evidence: visual-hive://latest-evidence -> .visual-hive/evidence-packet.json; read tool: visual_hive_read_evidence_packet
```

The CLI test suite also compares the checked-in MCP JSON Schema resource IDs, resource URIs, resource read-tool names, and read-only tool enums against this catalog. `visual-hive schemas verify` exposes the same catalog/schema parity check as a normal maintenance command. Adding a resource-backed evidence artifact now requires updating the catalog and schema together, so agents and downstream MCP clients do not receive stale resource names or tool names.

## Default Resources

The initial MCP server exposes read-only artifact resources:

- `visual-hive://config`
- `visual-hive://latest-plan`
- `visual-hive://plan-lanes`
- `visual-hive://setup-recommendations`
- `visual-hive://setup-pr-plan`
- `visual-hive://latest-report`
- `visual-hive://latest-evidence`
- `visual-hive://control-plane-snapshot`
- `visual-hive://latest-verdict`
- `visual-hive://readiness-gate`
- `visual-hive://run-history`
- `visual-hive://workflow-audit`
- `visual-hive://baseline-review`
- `visual-hive://baseline-approvals`
- `visual-hive://baseline-rejections`
- `visual-hive://testing-layers`
- `visual-hive://test-creation-plan`
- `visual-hive://latest-handoff`
- `visual-hive://handoff-validation`
- `visual-hive://hive-export`
- `visual-hive://hive/beads`
- `visual-hive://hive/knowledge-facts`
- `visual-hive://hive/knowledge-graph`
- `visual-hive://hive/wiki-index`
- `visual-hive://hive/repair-work-orders`
- `visual-hive://hive/agent-policy`
- `visual-hive://hive-guarded-repair-preview`
- `visual-hive://hive-repair-request-envelope`
- `visual-hive://hive-trusted-repair-consumer-summary`
- `visual-hive://hive-trusted-repair-workflow-dry-run`
- `visual-hive://hive-mode-comparison`
- `visual-hive://coverage-map`
- `visual-hive://coverage-recommendations`
- `visual-hive://mutation-report`
- `visual-hive://triage-report`
- `visual-hive://issue-body`
- `visual-hive://pr-comment`
- `visual-hive://triage-prompt`
- `visual-hive://repair-prompt`
- `visual-hive://missing-tests`
- `visual-hive://provider-results`
- `visual-hive://provider-upload/argos/manifest`
- `visual-hive://artifacts/index`
- `visual-hive://agent-packet`
- `visual-hive://handoff-agent-packet`
- `visual-hive://provider-agent-packet`
- `visual-hive://tool-registry`
- `visual-hive://context-ledger`
- `visual-hive://pipeline-status`
- `visual-hive://schema-catalog`

These resources are sanitized before being returned. Missing artifacts are reported as missing evidence, not as pass/fail decisions.

## Default Tools

- `visual_hive_doctor`
- `visual_hive_validate_config`
- `visual_hive_recommend_setup`
- `visual_hive_plan`
- `visual_hive_explain_failure`
- `visual_hive_list_reproduction_commands`
- `visual_hive_read_plan_lanes`
- `visual_hive_read_setup_recommendations`
- `visual_hive_read_setup_pr_plan`
- `visual_hive_read_latest_report`
- `visual_hive_read_evidence_packet`
- `visual_hive_read_control_plane_snapshot`
- `visual_hive_read_verdict`
- `visual_hive_read_readiness_gate`
- `visual_hive_read_run_history`
- `visual_hive_read_workflow_audit`
- `visual_hive_read_baseline_review`
- `visual_hive_read_baseline_approvals`
- `visual_hive_read_baseline_rejections`
- `visual_hive_read_testing_layers`
- `visual_hive_read_test_creation_plan`
- `visual_hive_generate_handoff_dry_run`
- `visual_hive_validate_handoff`
- `visual_hive_read_hive_export`
- `visual_hive_read_hive_beads`
- `visual_hive_read_hive_knowledge_facts`
- `visual_hive_read_hive_knowledge_graph`
- `visual_hive_read_hive_wiki_index`
- `visual_hive_read_hive_repair_work_orders`
- `visual_hive_read_hive_agent_policy`
- `visual_hive_read_hive_guarded_repair_preview`
- `visual_hive_read_hive_repair_request_envelope`
- `visual_hive_read_hive_trusted_repair_consumer_summary`
- `visual_hive_read_hive_trusted_repair_workflow_dry_run`
- `visual_hive_read_hive_mode_comparison`
- `visual_hive_read_coverage_recommendations`
- `visual_hive_read_mutation_report`
- `visual_hive_read_triage_report`
- `visual_hive_read_issue_body`
- `visual_hive_read_pr_comment`
- `visual_hive_read_triage_prompt`
- `visual_hive_generate_repair_prompt`
- `visual_hive_read_missing_tests`
- `visual_hive_read_provider_results`
- `visual_hive_read_provider_upload_manifest`
- `visual_hive_read_artifacts_index`
- `visual_hive_read_agent_packet`
- `visual_hive_read_handoff_agent_packet`
- `visual_hive_read_provider_agent_packet`
- `visual_hive_read_tool_registry`
- `visual_hive_read_context_ledger`
- `visual_hive_read_pipeline_status`
- `visual_hive_read_schema_catalog`

## Disabled By Default

Execution-capable tools are intentionally not registered in the default MCP server:

- `visual_hive_run`
- `visual_hive_mutate`
- `visual_hive_update_baseline`
- `visual_hive_handoff_github_issue`
- `visual_hive_handoff_hive_bead`
- `visual_hive_hive_repair`
- `visual_hive_provider_upload`

Those actions require trusted CLI workflows, human approval, protected credentials, or explicit future policy gates.

## Efficiency Rules

Agents should prefer compact resources and tools before loading broad files:

1. Read `visual-hive://latest-evidence` first.
2. Read `visual-hive://control-plane-snapshot` when the agent needs the same guided state, adoption checklist, runbook, and artifact/navigation context the UI shows.
3. Read `visual-hive://latest-verdict` when the agent needs the final gating/advisory breakdown without scanning the full report.
4. Read `visual-hive://readiness-gate` when the task is about whether a repo is safe to enable, merge, schedule, hand off, or repair.
5. Read `visual-hive://run-history` when the task is about flake trends, baseline stability, mutation adequacy trends, runtime/cost history, or repeated failures. Reading it does not rerun checks, approve baselines, infer a new verdict, or change policy.
6. Read `visual-hive://workflow-audit` when the task is about PR workflow safety, `pull_request_target`, secret exposure, artifact upload, or trusted `workflow_run` issue/handoff posture.
7. Read `visual-hive://baseline-review`, `visual-hive://baseline-approvals`, and `visual-hive://baseline-rejections` when the task is about created/missing baselines, visual diff review, or approval history. Reading them does not authorize approving, rejecting, copying, or updating baselines.
8. Read `visual-hive://setup-recommendations` and `visual-hive://setup-pr-plan` when the task is initial adoption, config generation review, setup bundle review, or safe workflow enablement.
9. Read `visual-hive://testing-layers` when the task is about missing coverage, test creation, mutation survivor follow-up, or whether a layer is only partially measured.
10. Read `visual-hive://coverage-recommendations` when the task is to review deterministic missing-coverage or config-improvement suggestions before creating tests.
11. Read `visual-hive://test-creation-plan` when the task is to draft missing tests or config changes from existing no-write recommendations.
12. Use `visual_hive_explain_failure` for a compact failure summary.
13. Use `visual_hive_list_reproduction_commands` before asking for shell access.
14. Use `visual_hive_plan` for a no-write PR planning summary before reading the full plan artifact.
15. Read `visual-hive://agent-packet`, `visual-hive://handoff-agent-packet`, `visual-hive://provider-agent-packet`, `visual-hive://tool-registry`, and `visual-hive://context-ledger` only when the task requires agent role policy, handoff routing policy, provider-review policy, or budget context.
16. Read `visual-hive://provider-results` or `visual-hive://provider-upload/argos/manifest` only when external-provider readiness or upload evidence is directly relevant; these resources do not grant upload authority.
17. Read `visual-hive://hive-mode-comparison` before requesting Hive repair escalation; it shows the no-network advisory, measured, repair-request, guarded-repair, and full policy choices.
18. Read the guarded repair preview, repair request envelope, trusted repair consumer summary, and workflow dry-run resources before asking for any repair automation.
19. Read raw report/artifact resources only when the compact evidence is insufficient.
19. Do not load screenshots or large artifacts unless the task specifically needs visual evidence.

Visual Hive remains the deterministic verdict authority. MCP clients and agents may explain, repair, or hand off evidence, but they do not decide pass/fail.
