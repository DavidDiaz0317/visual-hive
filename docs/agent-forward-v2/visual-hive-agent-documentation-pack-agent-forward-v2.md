# Visual Hive Agent Documentation Pack

Status: copy-ready guidance for files agents should add or update  
Date: 2026-07-02  
Target repo: `DavidDiaz0317/visual-hive`

---

## Purpose

Most implementation work in Visual Hive will be performed by coding agents. The repo therefore needs durable, high-signal markdown files that encode the product goal, testing layers, governance rules, and definition of done.

This pack gives the content structure for those files.

---

## 1. Root `AGENTS.md` additions

Add or merge the following sections into the root `AGENTS.md`.

```markdown
# Visual Hive Agent Instructions

Visual Hive is enterprise-grade, deterministic-first visual QA orchestration software.

Do not treat it as a demo, side project, screenshot wrapper, or dashboard-only project. The product goal is to run against real repositories, produce deterministic evidence, measure visual/user-flow test adequacy, and hand off safe repair tasks to humans, GitHub, optional providers, and Hive agents.

## Core invariants

- Deterministic tests decide pass/fail.
- LLMs may explain, summarize, draft, and suggest; they must never be the sole oracle.
- Playwright is the default deterministic browser runner.
- External providers are optional, policy-gated, budget-aware, and mockable.
- No paid provider or network call is required by default.
- PR workflows must not receive secrets.
- Do not use `pull_request_target` to execute untrusted PR code.
- Protected targets run only in trusted scheduled/manual lanes unless explicitly configured otherwise.
- Secret values must never be logged; secret names may be reported when missing.
- Agent handoff is evidence delivery, not autonomous approval.

## Enterprise definition of done

A change is done only when:

1. The implementation is functional, not just scaffolded.
2. Relevant tests pass or a clear limitation is documented.
3. Config field changes update Zod schema, JSON schema, docs, tests, and examples together.
4. Reports/artifacts remain schema-versioned and sanitized.
5. The default path remains local-first and no-provider.
6. GitHub workflow changes preserve least privilege.
7. Generated artifacts are ignored where appropriate.
8. The change improves an end-to-end vertical slice.

## Preferred work pattern

Inspect current state first. Then build vertical slices:

scan -> recommend -> plan -> run -> mutate -> triage -> evidence -> UI/issue -> tests -> docs

When CI is red, stop feature expansion and stabilize.

## Validation commands

Use the smallest relevant set during development, then run full validation before handoff when feasible:

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
```

---

## 2. `.github/copilot-instructions.md`

```markdown
# GitHub Copilot Instructions for Visual Hive

Visual Hive is enterprise-grade deterministic visual QA orchestration software.

Preserve these invariants:

- Deterministic checks decide pass/fail.
- LLM output is advisory only.
- Playwright is the default browser runner, but Visual Hive owns planning, policy, reports, mutation, and evidence.
- No external provider call should happen unless config, policy, credentials, and run mode allow it.
- PR workflows must be no-secret and read-only by default.
- Never execute untrusted PR code from a privileged `pull_request_target` workflow.
- Protected targets belong in trusted scheduled/manual lanes.
- Config/schema changes require docs, tests, examples, Zod schema, and JSON schema updates together.
- Avoid stubs and docs-only changes when product behavior is expected.
- Prefer vertical slices that produce user-visible artifacts.
```

---

## 3. `.github/instructions/testing.instructions.md`

```markdown
---
applyTo: "packages/**,examples/**,schemas/**,docs/**,.github/workflows/**"
---

# Visual Hive Testing Instructions

When changing Visual Hive, identify which testing layer is affected:

0. Repo intelligence
1. Static/build/workflow safety
2. Unit
3. Component/accessibility
4. API/contract
5. Component visual
6. E2E user-flow
7. Cross-browser/device provider
8. Canary/protected
9. Mutation/fault injection
10. Flake/history/cost governance
11. Agent/Hive feedback

Update tests and artifacts for the affected layer.

Required patterns:

- Planner changes must test selected and skipped reasons.
- Runner changes must test generated specs and report output.
- Mutation changes must test killed, survived, and not-applicable cases.
- Provider changes must test disabled, missing credential, policy-blocked, mock, and success paths.
- GitHub workflow changes must preserve read-only/no-secret PR posture.
- Evidence/report schema changes must update schema files and example artifacts.
```

---

## 4. `docs/agents/enterprise-definition-of-done.md`

```markdown
# Enterprise Definition of Done

Visual Hive work is not complete because a page renders or a command exists.

A complete change must:

- solve a real product problem;
- preserve deterministic-first behavior;
- keep local-first no-provider defaults;
- update schemas/docs/tests/examples when contracts change;
- produce actionable artifacts;
- avoid unsafe GitHub workflow patterns;
- avoid secret leaks;
- include a validation summary;
- document limitations honestly.

Do not stop at stubs, TODO-only implementations, empty adapters, or shallow UI screens.
```

---

## 5. `docs/agents/testing-layer-contract.md`

```markdown
# Testing Layer Contract

Visual Hive uses a testing lattice:

| Layer | Name | Output |
| --- | --- | --- |
| 0 | Repo intelligence | repo-map.json, repo-context.md |
| 1 | Static/build/workflow safety | workflow audit, build/typecheck/lint results |
| 2 | Unit | unit test summary |
| 3 | Component/accessibility | component/a11y report |
| 4 | API/contract | API success/error/empty/loading results |
| 5 | Component visual | component screenshots/diffs |
| 6 | E2E user-flow | Playwright specs, screenshots, traces |
| 7 | Cross-browser/device | normalized provider result |
| 8 | Canary/protected | protected target report |
| 9 | Mutation/fault injection | mutation-report.json |
| 10 | Flake/history/cost | history/cost/stability reports |
| 11 | Agent/Hive feedback | evidence-packet.json, issue.md, hive-handoff.json |

Every selected/skipped check must have a reason.
```

---

## 6. `docs/agents/visual-contract-authoring.md`

```markdown
# Visual Contract Authoring

Write contracts around user-visible obligations, not implementation details.

Good contracts say:

- public demo must not show login controls;
- dashboard shell renders primary regions;
- cluster table/card state is visible;
- API error state is readable;
- empty data state is stable;
- mobile viewport has no horizontal overflow.

Avoid:

- brittle selectors without user meaning;
- sleeps/timeouts instead of readiness conditions;
- default `networkidle` waiting;
- screenshots of dynamic data without masks/fixtures;
- CI-only baseline creation unless explicitly allowed.

Each visual contract should include:

- target;
- route;
- viewports;
- readiness selector/text;
- assertions;
- screenshot policy;
- tolerance;
- masks where needed;
- run modes;
- severity;
- mutation mappings.
```

---

## 7. `docs/agents/mutation-adequacy.md`

```markdown
# Mutation Adequacy

Mutation testing answers: would the current contracts catch intentional breakage?

Mutation outcomes:

- killed: a deterministic contract caught the fault;
- survived: the fault was not caught and a test/contract is missing or weak;
- not_applicable: the mutation did not apply to selected contracts or target.

Core Visual Hive mutation operators:

- hide-critical-button
- force-login-on-demo
- remove-demo-badge
- api-500
- empty-data
- mobile-overflow
- route-guard-bypass
- hidden-error-banner
- broken-image
- removed-accessible-name
- theme-token-drift
- stale-loading-state

Survived mutations must produce actionable recommendations and repair prompts.
```

---

## 8. `docs/agents/hive-handoff-policy.md`

```markdown
# Hive Handoff Policy

Visual Hive feeds Hive deterministic visual QA evidence. Hive coordinates agent work.

Visual Hive must not become a general multi-agent orchestrator.

Allowed handoff modes:

- dry_run: write sanitized local artifacts;
- github_issue: trusted workflow creates or updates GitHub issue;
- beads_file: write a Hive Beads-compatible JSON file;
- beads_api: future trusted-only direct post.

Handoff requirements:

- Evidence Packet exists;
- artifacts are sanitized;
- secret values are absent;
- issue body is deduped by signature;
- untrusted PR code is not executed in trusted handoff workflow;
- repair prompt includes reproduction commands and missing-test guidance;
- Hive repair does not close Visual Hive finding until deterministic rerun passes.
```

---

## 9. `docs/agents/provider-and-llm-governance.md`

```markdown
# Provider and LLM Governance

External provider and LLM integrations are optional.

No provider or LLM call is made unless:

- it is enabled in config;
- run mode allows it;
- required credentials are present by name;
- budget policy allows it;
- trusted context is available when secrets are involved;
- the adapter supports mock/dry-run behavior.

LLMs may explain, summarize, suggest, draft, and help generate proposed contracts.

LLMs may not decide pass/fail, approve baselines, override deterministic failures, access secrets, upload screenshots, connect billing, or run untrusted code.
```

---

## 10. `docs/agents/repo-map-and-context.md`

```markdown
# Repo Map and Context

Agents should use the generated repo map before creating tests or modifying Visual Hive architecture.

Command:

```bash
visual-hive analyze --repo . --out .visual-hive/repo-map.json --markdown .visual-hive/repo-context.md
```

The repo map should include:

- package manager;
- workspaces;
- scripts;
- frameworks;
- routes;
- targets;
- contracts;
- workflows;
- selectors/test IDs;
- test tools;
- risk signals;
- coverage gaps;
- recommended next actions.

Do not repeatedly rediscover the repo when the repo map already exists.
```


---

# Agent-Forward Tooling and Integration Instructions

These sections should be copied into repo agent docs where appropriate. They are intended for Codex, Copilot, Claude Code, and future Hive-managed agents.

## Core agent rule

Visual Hive is deterministic-first and agent-forward. Agents may create, repair, and review tests, but deterministic evidence decides pass/fail.

Agents must prefer:

```text
CLI --json
Evidence Packet
Evidence Summary
Agent Packet
Tool Cards
Reproduction commands
```

over:

```text
raw logs
full traces
entire screenshots
provider dashboards
full MCP schemas
guessing from code alone
```

## Required agent reading order

Before making changes, an agent should read:

1. root `AGENTS.md`;
2. this agent documentation pack;
3. `docs/agents/enterprise-definition-of-done.md`;
4. `docs/agents/testing-layer-contract.md`;
5. `docs/agents/visual-contract-authoring.md`;
6. `docs/agents/mutation-adequacy.md`;
7. `docs/agents/hive-handoff-policy.md`;
8. `docs/agents/provider-and-llm-governance.md`;
9. `docs/agents/mcp-and-tool-efficiency.md`;
10. latest `.visual-hive/evidence-packet.json` if present;
11. latest `.visual-hive/agent-packet.json` if present.

## Agent role behavior

### setup_agent

Purpose: generate or harden repo setup.

Allowed:

- read repo metadata;
- run `visual-hive doctor --json`;
- run `visual-hive recommend --json`;
- validate config;
- generate config/workflow previews;
- suggest provider options with cost/safety notes.

Forbidden:

- connect paid providers;
- create repository secrets;
- write GitHub issues from PR code;
- enable protected targets in PR lane;
- make real LLM/provider calls by default.

### test_creator

Purpose: add or improve visual/user-flow contracts.

Allowed:

- read coverage/mutation reports;
- inspect selected routes and components;
- use local Playwright/Storybook MCP if enabled;
- add deterministic selectors/text/screenshot contracts;
- add mutation mappings.

Forbidden:

- approve baselines;
- upload provider artifacts;
- weaken thresholds to hide failures;
- remove failing tests without replacement evidence.

### repair_agent

Purpose: reproduce and fix deterministic failures.

Allowed:

- read Evidence Packet and repair prompt;
- run focused local commands;
- inspect DOM/accessibility snapshots if enabled;
- modify app code or tests to satisfy contracts.

Forbidden:

- treat LLM interpretation as pass/fail;
- skip failing contracts without policy reason;
- run protected targets without trusted mode;
- approve visual baselines autonomously.

### review_agent

Purpose: evaluate whether a change improves Visual Hive evidence.

Allowed:

- compare reports;
- inspect mutation score;
- review selected/skipped reasons;
- verify artifact and schema changes are consistent.

Forbidden:

- merge PRs;
- approve baselines;
- make provider writes;
- ignore red validation commands.

### handoff_agent

Purpose: create or update sanitized GitHub issues or Hive Beads.

Allowed only in trusted mode:

- read sanitized Evidence Packet;
- compute dedupe signature;
- generate GitHub issue body;
- generate Hive Bead request;
- create/update external work item if configured.

Forbidden:

- execute PR code;
- include secret values;
- attach raw unsafe logs;
- write to GitHub/Hive from untrusted PR lanes.

### provider_specialist

Purpose: use external visual/device/provider tools only when local evidence is insufficient.

Allowed only in trusted/budgeted profiles:

- check provider readiness;
- fetch normalized provider results;
- run real-device/cross-browser checks if configured;
- summarize provider evidence.

Forbidden:

- enable billing;
- upload screenshots from PR lane by default;
- make external calls without budget/policy;
- replace Visual Hive deterministic pass/fail.

## Agent Packet contract

Agents should be given a compact packet like:

```json
{
  "schemaVersion": "visual-hive.agent-packet.v1",
  "role": "repair_agent",
  "objective": "Repair failed dashboard-shell contract",
  "evidenceSummary": {
    "classification": "missing_element",
    "contract": "dashboard-shell",
    "target": "local-preview",
    "mutationScore": 0.72
  },
  "allowedTools": [
    "visualHive.latestEvidence",
    "visualHive.reproductionCommands",
    "visualHive.runFocused",
    "playwright.accessibilitySnapshot"
  ],
  "forbiddenActions": [
    "baseline.approve",
    "provider.upload",
    "github.write",
    "protectedTarget.run"
  ],
  "budgets": {
    "maxToolCalls": 20,
    "maxToolResultTokens": 12000,
    "maxExternalCostUsd": 0
  },
  "reproductionCommands": [
    "visual-hive run --contract dashboard-shell --mode local"
  ],
  "artifactPointers": [
    ".visual-hive/evidence-packet.json",
    ".visual-hive/artifacts/dashboard-shell/diff.png"
  ]
}
```

If no Agent Packet exists, the agent should generate one or request one through the CLI once the command exists.

## MCP/tool efficiency instructions

Agents must not load every MCP tool or raw artifact by default.

Preferred sequence:

```text
1. Read compact objective and Evidence Summary.
2. Read allowed Tool Cards.
3. Use local Visual Hive CLI/JSON first.
4. Use local Playwright/Storybook MCP only if it answers a specific missing context question.
5. Use GitHub MCP read-only only if CI/PR/check context is required.
6. Use provider MCP only under trusted, budgeted policy.
7. Record why each escalation was needed.
```

Agents should avoid:

- opening entire traces when a 30-line summary is sufficient;
- copying full logs into prompts;
- calling provider tools just because they exist;
- exposing paid/external tools to ordinary repair/test tasks;
- repeatedly fetching the same context instead of using cached artifacts.

## Tool Cards

Each allowed tool should be summarized as a card:

```md
## Tool: visualHive.latestEvidence
Use when: You need the latest deterministic result, mutation score, artifacts, or repair commands.
Cost: local, low-token.
Returns: compact summary + paths to full artifacts.
Do not use for: raw screenshot inspection.

## Tool: playwright.accessibilitySnapshot
Use when: You need live DOM roles/text/labels to create or repair a user-flow contract.
Cost: local browser run, medium-token.
Returns: scoped accessibility tree for one route.
Do not use for: pass/fail decisions already covered by Visual Hive report.
```

## Required final handoff from agents

Every agent run should end with:

```markdown
## Summary
- What changed and why.

## Evidence
- What Visual Hive artifacts were read or produced.

## Validation
- command: result

## Tool/Cost Usage
- tools used
- reason for each escalation
- estimated external cost
- budget remaining

## Remaining Gaps
- ranked list with next concrete action
```

## Definition of done for agent-authored work

Agent-authored work is not done until:

- deterministic tests pass or failures are honestly documented;
- schemas/docs/examples are updated with config/report changes;
- provider/LLM defaults remain disabled;
- PR-safe/protected boundaries are preserved;
- Evidence Packet or relevant artifact output is produced if the work touches reporting/handoff;
- mutation adequacy is not weakened;
- any MCP/provider use is justified and recorded;
- no secret values appear in logs, artifacts, prompts, or issue bodies.
