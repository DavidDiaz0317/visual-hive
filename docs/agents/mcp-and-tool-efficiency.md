# MCP And Tool Efficiency

Visual Hive's MCP surface is an adapter over existing CLI/JSON artifacts. It is not the source of truth, and it must not become an uncontrolled context dump.

Run:

```bash
visual-hive mcp --config visual-hive.config.yaml --describe
visual-hive mcp --config visual-hive.config.yaml --stdio
```

The `--describe` form exits immediately and prints the read-only resource/tool manifest. The `--stdio` form starts a long-running MCP server for an MCP client. Use a supervising client, timeout, or process manager when launching it from automation.

## Default Resources

The initial MCP server exposes read-only artifact resources:

- `visual-hive://config`
- `visual-hive://latest-plan`
- `visual-hive://latest-report`
- `visual-hive://latest-evidence`
- `visual-hive://latest-handoff`
- `visual-hive://coverage-map`
- `visual-hive://mutation-report`
- `visual-hive://repair-prompt`
- `visual-hive://artifacts/index`

These resources are sanitized before being returned. Missing artifacts are reported as missing evidence, not as pass/fail decisions.

## Default Tools

Default MCP tools are read-only:

- `visual_hive_validate_config`
- `visual_hive_read_latest_report`
- `visual_hive_read_evidence_packet`
- `visual_hive_explain_failure`
- `visual_hive_list_reproduction_commands`
- `visual_hive_generate_repair_prompt`
- `visual_hive_generate_handoff_dry_run`

The `generate_*` names reflect agent workflow intent, but the default implementation only reads existing local artifacts. It does not create issues, call Hive, upload provider screenshots, approve baselines, run Playwright, run mutation checks, call an LLM, or contact external services.

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
2. Use `visual_hive_explain_failure` for a compact failure summary.
3. Use `visual_hive_list_reproduction_commands` before asking for shell access.
4. Read raw report/artifact resources only when the compact evidence is insufficient.
5. Do not load screenshots or large artifacts unless the task specifically needs visual evidence.

Visual Hive remains the deterministic verdict authority. MCP clients and agents may explain, repair, or hand off evidence, but they do not decide pass/fail.
