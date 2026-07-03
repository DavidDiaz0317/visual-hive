# MCP And Tool Efficiency

Visual Hive's MCP surface is an adapter over existing CLI/JSON artifacts. It is not the source of truth, and it must not become an uncontrolled context dump.

Run:

```bash
visual-hive mcp --config visual-hive.config.yaml --describe
visual-hive mcp --config visual-hive.config.yaml --describe --output .visual-hive/mcp-manifest.json
visual-hive mcp --config visual-hive.config.yaml --stdio
```

The `--describe` form exits immediately and prints the read-only resource/tool manifest. Add `--output .visual-hive/mcp-manifest.json` to persist the manifest for CI, agents, or schema validation.

Schema: `schemas/visual-hive.mcp.schema.json`

The `--stdio` form starts a long-running MCP server for an MCP client. Use a supervising client, timeout, or process manager when launching it from automation.

## Default Resources

The initial MCP server exposes read-only artifact resources:

- `visual-hive://config`
- `visual-hive://latest-plan`
- `visual-hive://latest-report`
- `visual-hive://latest-evidence`
- `visual-hive://latest-verdict`
- `visual-hive://latest-handoff`
- `visual-hive://handoff-validation`
- `visual-hive://hive-export`
- `visual-hive://hive-mode-comparison`
- `visual-hive://coverage-map`
- `visual-hive://mutation-report`
- `visual-hive://repair-prompt`
- `visual-hive://artifacts/index`
- `visual-hive://agent-packet`
- `visual-hive://tool-registry`
- `visual-hive://context-ledger`
- `visual-hive://pipeline-status`

These resources are sanitized before being returned. Missing artifacts are reported as missing evidence, not as pass/fail decisions.

## Default Tools

Default MCP tools are read-only:

- `visual_hive_doctor`
- `visual_hive_validate_config`
- `visual_hive_recommend_setup`
- `visual_hive_plan`
- `visual_hive_read_latest_report`
- `visual_hive_read_evidence_packet`
- `visual_hive_read_verdict`
- `visual_hive_read_agent_packet`
- `visual_hive_read_tool_registry`
- `visual_hive_read_context_ledger`
- `visual_hive_read_pipeline_status`
- `visual_hive_explain_failure`
- `visual_hive_list_reproduction_commands`
- `visual_hive_generate_repair_prompt`
- `visual_hive_generate_handoff_dry_run`
- `visual_hive_validate_handoff`
- `visual_hive_read_hive_export`
- `visual_hive_read_hive_mode_comparison`

`visual_hive_doctor`, `visual_hive_recommend_setup`, and `visual_hive_plan` return bounded summaries from loaded config, repo setup signals, or in-memory PR planning. They do not write `plan.json`, start target servers, run Playwright, run mutation checks, call an LLM, upload screenshots, create issues, approve baselines, call Hive, or contact external services. The `generate_*` names reflect agent workflow intent, but the default implementation only reads existing local artifacts.

## Disabled By Default

Execution-capable tools are intentionally not registered in the default MCP server:

- `visual_hive_run`
- `visual_hive_mutate`
- `visual_hive_update_baseline`
- `visual_hive_handoff_github_issue`
- `visual_hive_handoff_hive_bead`
- `visual_hive_provider_upload`

Those actions require trusted CLI workflows, human approval, protected credentials, or explicit future policy gates.

## Efficiency Rules

Agents should prefer compact resources and tools before loading broad files:

1. Read `visual-hive://latest-evidence` first.
2. Read `visual-hive://latest-verdict` when the agent needs the final gating/advisory breakdown without scanning the full report.
3. Use `visual_hive_explain_failure` for a compact failure summary.
4. Use `visual_hive_list_reproduction_commands` before asking for shell access.
5. Use `visual_hive_plan` for a no-write PR planning summary before reading the full plan artifact.
6. Read `visual-hive://agent-packet`, `visual-hive://tool-registry`, and `visual-hive://context-ledger` only when the task requires agent role policy or budget context.
7. Read `visual-hive://hive-mode-comparison` before requesting Hive repair escalation; it shows the no-network advisory, measured, repair-request, guarded-repair, and full policy choices.
8. Read raw report/artifact resources only when the compact evidence is insufficient.
9. Do not load screenshots or large artifacts unless the task specifically needs visual evidence.

Visual Hive remains the deterministic verdict authority. MCP clients and agents may explain, repair, or hand off evidence, but they do not decide pass/fail.
