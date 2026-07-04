# Context Ledger

The Context Ledger records how much agent/tool context a Visual Hive run has already consumed or exposed.

It is written with:

```bash
visual-hive context --config visual-hive.config.yaml
```

Acceptance or CI suites that intentionally run many bounded Visual Hive steps can raise only the ledger budget for that run:

```bash
visual-hive context --config visual-hive.config.yaml --max-tool-calls 40
```

Do not use budget overrides to hide unexpected agent/tool sprawl. Use them only when the upstream pipeline is scripted, timeout-bounded, and already part of the reviewed acceptance path.

Outputs:

- `.visual-hive/context-ledger.json`

Schema:

- `schemas/visual-hive.context-ledger.schema.json`

The ledger is intentionally derived from existing artifacts. It makes no provider calls, no LLM calls, no GitHub writes, and no target executions.

## What It Tracks

- Tool calls inferred from `.visual-hive/pipeline.json`.
- Available tool policy from `.visual-hive/tools/tool-registry.json`.
- Catalog-backed tool-call metadata from the shared evidence-resource catalog, including `evidenceResourceId`, `evidenceResourceUri`, `evidenceReadToolName`, and evidence descriptions when a tool maps to a known read-only artifact.
- Multi-artifact evidence-resource links in `toolCalls[].evidenceResources`, so a single pipeline step such as triage can expose `triage-report`, `issue-body`, `pr-comment`, `triage-prompt`, `repair-prompt`, and `missing-tests` without agents scraping artifact paths by hand.
- The Control Plane snapshot exposes the parsed Context Ledger as `contextLedger` and the Expert console renders those linked evidence resources as file/tool links when the ledger exists.
- Agent budgets from `.visual-hive/agent-packet.json`.
- LLM prompt token and cost estimates from `.visual-hive/llm-usage.json`.
- Provider screenshot, credential, upload, and external-call posture from provider artifacts.
- Provider upload command evidence from `.visual-hive/provider-results.json` and `.visual-hive/provider-upload/argos/manifest.json`, including upload status, dry-run state, staged/uploaded counts, sanitized command/output excerpts, provider URL, manifest path, and upload directory.
- Hive handoff dry-run posture from `.visual-hive/handoff.json`, `.visual-hive/hive-bead-request.json`, `.visual-hive/hive-handoff-result.json`, and `.visual-hive/hive-handoff-validation.json`.
- Test-creation guidance source presence from `.visual-hive/test-creation-plan.json`.
- Remaining budget for tool calls, tool-result tokens, external cost, and provider screenshots.
- Escalations for trusted-only tools, external-network tools, LLM calls, provider uploads, blocked Hive handoff, missing credentials, and budget pressure.

## Governance

The Context Ledger is governance evidence for agents and future MCP tooling. It does not decide whether a run passed.

Visual Hive's deterministic Verdict Engine remains the pass/fail authority. Agents, Hive, LLMs, MCP tools, and hosted providers may consume the ledger to choose safer next actions, but they cannot use it to override deterministic evidence.

## Agent Use

Agents should read the Context Ledger before asking for broader context or enabling optional tools. If remaining budgets are low or a policy violation is present, the agent should narrow its next action, request human approval, or stop before using trusted/external capabilities.
