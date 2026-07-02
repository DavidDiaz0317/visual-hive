# Agent Packet Schema

The Agent Packet is a role-specific, sanitized work envelope for humans and coding agents. It is derived from the Evidence Packet and optional Handoff Packet, then scoped to one profile:

- `repair_agent`: fix deterministic failures without changing the verdict policy.
- `test_creator`: strengthen contracts from mutation survivors and coverage gaps.
- `review_agent`: audit evidence, artifacts, governance, and residual risk.
- `handoff_agent`: prepare trusted GitHub/Hive routing artifacts without executing PR code.

Run:

```bash
visual-hive evidence --config visual-hive.config.yaml
visual-hive handoff --dry-run --config visual-hive.config.yaml
visual-hive agent-packet --config visual-hive.config.yaml --profile repair_agent
```

This writes `.visual-hive/agent-packet.json`.

Schema: `schemas/visual-hive.agent-packet.schema.json`

## Contract

The packet includes:

- `objective`: the bounded job the agent should perform.
- `verdict`: Visual Hive's deterministic verdict summary.
- `evidenceSummary`: compact gating/advisory evidence, work items, selected contracts and targets, and mutation score.
- `allowedTools`: read-only or local-only tools the profile may use.
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

The packet is intentionally smaller than the Evidence Packet. It gives agents enough context to act without forcing them to scrape CI logs, ingest every raw artifact, or guess which tools are safe.
