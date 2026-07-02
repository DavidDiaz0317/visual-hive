# Context Ledger

The Context Ledger records how much agent/tool context a Visual Hive run has already consumed or exposed.

It is written with:

```bash
visual-hive context --config visual-hive.config.yaml
```

Outputs:

- `.visual-hive/context-ledger.json`

Schema:

- `schemas/visual-hive.context-ledger.schema.json`

The ledger is intentionally derived from existing artifacts. It makes no provider calls, no LLM calls, no GitHub writes, and no target executions.

## What It Tracks

- Tool calls inferred from `.visual-hive/pipeline.json`.
- Available tool policy from `.visual-hive/tools/tool-registry.json`.
- Agent budgets from `.visual-hive/agent-packet.json`.
- LLM prompt token and cost estimates from `.visual-hive/llm-usage.json`.
- Provider screenshot, credential, upload, and external-call posture from provider artifacts.
- Remaining budget for tool calls, tool-result tokens, external cost, and provider screenshots.
- Escalations for trusted-only tools, external-network tools, LLM calls, provider uploads, missing credentials, and budget pressure.

## Governance

The Context Ledger is governance evidence for agents and future MCP tooling. It does not decide whether a run passed.

Visual Hive's deterministic Verdict Engine remains the pass/fail authority. Agents, Hive, LLMs, MCP tools, and hosted providers may consume the ledger to choose safer next actions, but they cannot use it to override deterministic evidence.

## Agent Use

Agents should read the Context Ledger before asking for broader context or enabling optional tools. If remaining budgets are low or a policy violation is present, the agent should narrow its next action, request human approval, or stop before using trusted/external capabilities.
