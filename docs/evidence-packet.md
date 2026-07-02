# Evidence Packet

The Evidence Packet is Visual Hive's stable machine contract for humans, GitHub workflows, optional providers, LLM prompt builders, and Hive/agent handoff.

It is not a raw log bundle. It is a sanitized, versioned packet that explains what deterministic evidence exists, how that evidence affected the Visual Hive verdict, and which advisory signals are available for repair workflows.

## Files

Run:

```bash
visual-hive evidence --config visual-hive.config.yaml
```

This writes:

- `.visual-hive/evidence-packet.json`
- `.visual-hive/evidence-summary.md`

The JSON schema is:

- `schemas/visual-hive.evidence-packet.schema.json`

## Verdict Model

Visual Hive owns the final deterministic verdict. Playwright remains the default first-party browser execution backend and primary local evidence source, but the Evidence Packet is shaped around normalized evidence contributions rather than Playwright-only semantics.

Verdict statuses:

- `passed`
- `failed`
- `warning`
- `blocked`
- `inconclusive`

Each contribution records:

- source, such as `playwright`, `screenshot_diff`, `mutation`, `provider`, `coverage`, or `triage`
- kind, such as `deterministic_run`, `contract_result`, `mutation_adequacy`, or `normalized_provider_result`
- status
- whether it is gating
- human-readable reason
- artifact paths

LLM, MCP, Hive, and agent output remains advisory unless converted into normalized deterministic evidence by Visual Hive policy.

## Handoff Use

The packet is designed to be safe to attach to GitHub issues, pass to prompt builders, or hand to Hive dry-run workflows. Secret-like values are redacted. Missing environment variable names may be visible, but values must not be printed.

Current handoff readiness fields are intentionally conservative:

- `readyForIssueHandoff`
- `readyForHiveDryRun`
- `blockedReasons`
- `suggestedLabels`

The next product slice should derive a smaller Handoff Packet from this Evidence Packet rather than asking agents to scrape CI logs.
