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

Current schema version: `visual-hive.evidence-packet.v2`. Version 2 requires stable contribution `key` and explicit `authority` fields so downstream agents can safely distinguish gating verdict evidence from advisory context. Readers should continue to tolerate v1 packets where practical, but new writers emit v2.

## Verdict Model

Visual Hive owns the final deterministic verdict. Playwright remains the default first-party browser execution backend and primary local evidence source, but the Evidence Packet is shaped around normalized evidence contributions rather than Playwright-only semantics.

Verdict statuses:

- `passed`
- `failed`
- `warning`
- `blocked`
- `inconclusive`

Each contribution records:

- a stable `key` such as `playwright.contract_result.dashboard-shell`
- source, such as `playwright`, `screenshot_diff`, `mutation`, `provider`, `coverage`, or `triage`
- kind, such as `deterministic_run`, `contract_result`, `mutation_adequacy`, or `normalized_provider_result`
- status
- whether it is gating
- `authority`, either `gating` or `advisory`, so agents do not infer pass/fail from source names
- human-readable reason
- artifact paths

LLM, MCP, Hive, and agent output remains advisory unless converted into normalized deterministic evidence by Visual Hive policy.

`blocked` is reserved for insufficient or unsafe evidence conditions such as target lifecycle/startup failure, protected-target missing secret names, CI missing baselines, unavailable gating providers, or policy refusal. `failed` is reserved for actual deterministic regression evidence such as missing/unexpected selectors, failed flows, visual diffs, console/page/network policy failures, mutation adequacy failures, or configured provider gates.

## Handoff Use

The packet is designed to be safe to attach to GitHub issues, pass to prompt builders, or hand to Hive dry-run workflows. Secret-like values are redacted. Missing environment variable names may be visible, but values must not be printed.

Current handoff readiness fields are intentionally conservative:

- `readyForIssueHandoff`
- `readyForHiveDryRun`
- `blockedReasons`
- `suggestedLabels`
- `recommendedMode`
- `recommendationReason`
- `modeReadiness`

`modeReadiness` is a no-network governance preview for Hive-native handoff. It lists `advisory`, `measured`, `repair_request`, `guarded_repair`, and `full`, then records whether each mode is `ready`, `blocked`, or `trusted_only`, which artifacts the mode can emit, what command or workflow would be next, and why a mode is blocked. Guarded repair and full automation must remain trusted-workflow constrained; this readiness evidence never authorizes Hive, an LLM, or an agent to decide Visual Hive pass/fail.

The next product slice should derive a smaller Handoff Packet from this Evidence Packet rather than asking agents to scrape CI logs.

## Handoff Dry Run

Run:

```bash
visual-hive handoff --dry-run --config visual-hive.config.yaml
```

This consumes `.visual-hive/evidence-packet.json` and writes:

- `.visual-hive/handoff.json`
- `.visual-hive/hive-issue.md`
- `.visual-hive/hive-bead-request.json`
- `.visual-hive/hive-handoff-result.json`

The dry run makes zero network calls. It does not create a GitHub issue, does not create a Hive Bead, and does not execute repository code. Trusted workflows can later consume these sanitized artifacts to create issues or agent work items without checking out or executing untrusted PR code.

## Agent Packet

Run:

```bash
visual-hive agent-packet --config visual-hive.config.yaml --profile repair_agent
```

This consumes `.visual-hive/evidence-packet.json`, optionally consumes `.visual-hive/handoff.json`, and writes:

- `.visual-hive/agent-packet.json`

The Agent Packet is a bounded work envelope for `repair_agent`, `test_creator`, `review_agent`, and `handoff_agent` profiles. It includes the Visual Hive verdict, compact evidence, allowed tools, forbidden actions, budgets, reproduction commands, and artifact pointers. Agents may repair or recommend next tests, but Visual Hive remains the verdict authority.
