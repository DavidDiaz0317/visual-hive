# Visual Hive Roadmap — Agent-Forward Enterprise v2

This roadmap integrates the original Visual Hive roadmap with the agent-forward, Hive, API, and MCP/tool-efficiency strategy.

The long-term product direction is:

> Visual Hive is the deterministic visual/user-flow evidence layer for AI-maintained codebases. Agents, humans, GitHub, Hive, providers, and the Control Plane consume Visual Hive evidence; they do not replace it.

## Guiding order of integration

```text
1. CLI + stable --json
2. Evidence Packet
3. Handoff Packet
4. Agent Packet
5. GitHub issue / Hive dry-run handoff
6. Visual Hive MCP server
7. Direct Hive Bead API
8. HTTP API / hosted Control Plane API
9. Third-party MCP/provider integrations
```

## Testing layer lattice

Visual Hive should document and increasingly emit artifacts for these layers:

| Layer | Name | Purpose |
| --- | --- | --- |
| 0 | Repo intelligence | Understand package manager, framework, scripts, routes, workflows, test tools, selectors, risk signals |
| 1 | Static/build/workflow safety | Typecheck, build, lint, dependency/workflow/security posture |
| 2 | Unit | Function/module correctness |
| 3 | Component/accessibility | Component render contracts, accessibility names/roles, Storybook where available |
| 4 | API/contract | API response shape, error states, fixtures, mocked services |
| 5 | Component visual | Component/story screenshots, design-system drift |
| 6 | E2E user-flow | Real browser route/user-flow obligations |
| 7 | Cross-browser/device provider | Optional provider/device/browser grid coverage |
| 8 | Canary/protected | Hosted demo, staging, live cluster, secret-bearing scheduled checks |
| 9 | Mutation/fault injection | Prove tests catch intentional UI/auth/API/layout breakage |
| 10 | Flake/history/cost governance | Baseline churn, retries, unstable targets, provider/LLM/MCP budgets |
| 11 | Agent/Hive feedback | Evidence packets, agent packets, handoff packets, repair outcomes |

## v0.1 — Local deterministic foundation

- npm workspace CLI.
- Zod config validation.
- Playwright generated specs.
- Basic visual snapshots.
- Basic mutation score.
- Offline triage and GitHub markdown.
- Demo React app.
- No paid provider, LLM, or external service required.

## v0.2 — Realistic visual/user-flow checks

- Tolerance-based PNG visual diffing.
- Rich target kinds: `url`, `deployPreview`, `storybook`, `command`, `commandGroup`, `protected`.
- Structured report schema with selector, screenshot, console, page, and network error details.
- Mutation-to-contract mapping and applicability reporting.
- Realistic KubeStellar Console example.
- PR-safe vs protected target rules.
- Clear selected/skipped plan reasons.

## v0.3 — Operational beta and Evidence Packet

Goal: Visual Hive can run against real repositories and produce agent-ready evidence without unsafe provider/LLM/workflow behavior.

Deliverables:

- Operational pipeline command with bootstrap/strict CI modes.
- Pre-publish GitHub Action wrapper for target repositories.
- External consumer smoke fixture proving setup, bootstrap, strict pass, and deliberate visual regression failure.
- Setup/readiness hardening for incomplete contracts, workflow distribution gaps, and artifact evidence.
- Evidence Packet schema:

```text
schemas/visual-hive.evidence-packet.schema.json
.visual-hive/evidence-packet.json
.visual-hive/evidence-summary.md
```

Evidence Packet must include:

- source/repo metadata;
- repo intelligence summary;
- testing-layer map;
- selected/skipped targets/contracts;
- deterministic results;
- visual diffs;
- mutation evidence;
- provider/LLM/tool policy posture;
- artifacts and redaction status;
- triage/repair guidance;
- handoff readiness.

Additional v0.3 items:

- Hive/GitHub handoff design documented and dry-run capable.
- KubeStellar example hardened:
  - hosted demo no-login canary;
  - local preview screenshots;
  - fake OAuth `commandGroup` planning/runtime if stable;
  - protected live-cluster scheduled/manual target;
  - auth changed-files select auth contracts;
  - docs-only changes skip expensive/protected checks.
- Agent documentation added or hardened:
  - root `AGENTS.md`;
  - `.github/copilot-instructions.md`;
  - `.github/instructions/testing.instructions.md`;
  - `docs/agents/*`.

## v0.4 — Agent Packet, Tool Registry, and Handoff Packet

Goal: agents receive compact, role-specific work packets instead of raw logs and huge contexts.

Deliverables:

- Handoff Packet:

```text
.visual-hive/handoff.json
.visual-hive/hive-issue.md
.visual-hive/hive-bead-request.json
.visual-hive/hive-handoff-result.json
```

- Agent Packet:

```text
.visual-hive/agent-packet.json
```

- Tool Registry and Tool Cards:

```text
.visual-hive/tools/tool-registry.json
.visual-hive/tools/tool-cards.md
```

- Context Ledger:

```text
.visual-hive/context-ledger.json
```

- CLI commands or equivalents:

```bash
visual-hive evidence build --json
visual-hive handoff hive --mode dry-run --json
visual-hive agent packet --role repair_agent --finding <id> --json
visual-hive tools list --json
visual-hive tools recommend --role repair_agent --json
```

- Role profiles:
  - setup_agent;
  - test_creator;
  - repair_agent;
  - review_agent;
  - handoff_agent;
  - provider_specialist.

- Token/cost controls:
  - max tool definitions per agent;
  - max tool calls per task;
  - max tool result tokens;
  - max external cost;
  - trusted-only writes.

## v0.5 — First-party Visual Hive MCP server

Goal: expose Visual Hive to agents through an agent-native protocol without making MCP the core implementation.

Deliverables:

- Local stdio MCP server:

```bash
visual-hive mcp --stdio
```

- Read-only/default resources:

```text
visual-hive://config
visual-hive://latest-plan
visual-hive://latest-report
visual-hive://latest-evidence
visual-hive://latest-handoff
visual-hive://coverage-map
visual-hive://mutation-report
visual-hive://repair-prompt
visual-hive://artifacts/index
```

- Read-only/default tools:

```text
visual_hive_doctor
visual_hive_validate_config
visual_hive_recommend_setup
visual_hive_plan
visual_hive_read_latest_report
visual_hive_read_evidence_packet
visual_hive_explain_failure
visual_hive_list_reproduction_commands
visual_hive_generate_repair_prompt
visual_hive_generate_handoff_dry_run
```

- Execution tools disabled unless explicitly enabled:

```text
visual_hive_run
visual_hive_mutate
visual_hive_update_baseline
visual_hive_handoff_github_issue
visual_hive_handoff_hive_bead
visual_hive_provider_upload
```

- MCP safety flags:

```bash
visual-hive mcp --stdio \
  --allow-run=false \
  --allow-mutate=false \
  --allow-baseline-write=false \
  --allow-provider-upload=false \
  --allow-handoff=false
```

- MCP prompt templates:
  - repair failure;
  - add missing contract;
  - review mutation survivor;
  - stabilize flake;
  - KubeStellar console regression.

## v0.6 — Trusted GitHub/Hive handoff

Goal: Visual Hive can hand off failures to enterprise workflows safely.

Deliverables:

- Trusted GitHub issue workflow:
  - consumes sanitized artifacts;
  - does not execute PR code;
  - dedupes by Visual Hive signature;
  - applies labels such as `visual-hive`, `hive/quality`, `ai-ready`;
  - includes Evidence Packet summary, repair prompt, and reproduction commands.

- Direct Hive Bead API mode, disabled by default:

```bash
visual-hive handoff hive --mode bead_api --json
```

- Hive config:

```yaml
integrations:
  hive:
    enabled: false
    mode: dry_run # dry_run | github_issue | bead_api
    agent: quality
    labels:
      - visual-hive
      - hive/quality
      - ai-ready
    beadApi:
      urlEnv: HIVE_DASHBOARD_URL
      tokenEnv: HIVE_DASHBOARD_TOKEN
    githubIssue:
      createFromTrustedWorkflow: true
      dedupeBy: visual_hive_signature
```

- Strict safeguards:
  - no issue creation from untrusted PR execution;
  - no direct Bead API from untrusted PR lane;
  - no secret value printing;
  - metadata kept small and sanitized.

## v0.7 — Optional local and provider MCPs

Goal: use external MCP-enabled tools only when they add measurable strength.

Local/low-risk integrations:

- Playwright MCP for DOM/accessibility snapshots during test authoring and repair.
- Storybook/Chromatic MCP for component/story/design-system context.
- GitHub MCP read-only for PR/check/log context.

Provider/trusted integrations:

- Applitools MCP for enterprise visual AI/cross-browser result review.
- BrowserStack MCP for real-device/cross-browser debugging.
- Sentry MCP for protected/prod error context and MCP observability.

Requirements:

- disabled by default;
- role-gated;
- mode-gated;
- budget-gated;
- trusted-only for writes/provider uploads;
- usage recorded in context ledger;
- artifact summaries preferred over raw result dumps.

## v0.8 — Tool Broker and cost-learning loop

Goal: maximize agent strength per token and per dollar.

Deliverables:

- Tool Broker that returns compact summaries from multiple sources.
- Tool search before tool load:

```text
visual_hive_search_tools(query, role, detailLevel)
```

where `detailLevel` can be:

```text
names_only
summary
full_schema
```

- Cached summaries by:

```text
repo + commit + configHash + contractId + targetId + viewport
```

- MCP/tool value tracking:

```json
{
  "mcpValue": {
    "tool": "playwright.accessibilitySnapshot",
    "reason": "selector repair",
    "costClass": "local",
    "inputTokensEstimated": 2400,
    "outcome": "contract_repaired",
    "rerunStatus": "passed"
  }
}
```

- Control Plane tool/cost/value panels.

## v1.0 — Enterprise stable release

Visual Hive reaches v1.0 when it has:

- stable public config schema;
- stable report schema;
- stable Evidence Packet schema;
- stable Handoff Packet schema;
- stable Agent Packet schema;
- deterministic Playwright-based execution;
- mutation adequacy;
- trusted GitHub issue creation workflow;
- optional Hive Bead API;
- first-party read-only MCP server;
- provider adapters for Percy, Chromatic, Argos, Applitools, and/or BrowserStack-style workflows;
- monorepo-scale planning and cost budgets;
- Control Plane views for setup, runs, coverage, mutation, baselines, providers, LLMs, agents, tools, and handoff;
- KubeStellar Console dogfood path;
- docs that make the enterprise posture explicit;
- no required LLM or paid provider by default;
- secure PR/protected target separation.

## v1.1+ — Governed autonomy experiments

Only after v1.0 foundations are stable:

- agent-generated repair PRs under hold labels;
- mutation-guided automatic test improvement proposals;
- Hive agent queue feedback loops;
- tool-value learning by repo;
- org-wide Visual QA health scoring;
- hosted Control Plane / GitHub App;
- enterprise audit and policy inheritance;
- benchmark dataset of visual/user-flow regressions and mutation survivors.

## Always defer

Do not prioritize these before the deterministic/agent packet foundation is stable:

- paid provider dependency as the main path;
- LLM as pass/fail oracle;
- direct production-impacting actions from untrusted PR workflows;
- broad MCP tool exposure;
- autonomous baseline approval;
- direct Hive API as the only handoff path;
- hosted backend requirement for basic use.
