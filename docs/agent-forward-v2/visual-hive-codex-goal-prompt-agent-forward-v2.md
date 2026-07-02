# Codex Goal Prompt — Visual Hive Agent-Forward Enterprise Operational Beta v2

Paste this into Codex goal mode together with the v2 docs in this pack.

You are working in `DavidDiaz0317/visual-hive`.

Treat Visual Hive as enterprise-grade, deterministic-first, agent-forward visual QA orchestration software. It is not a demo, side project, screenshot wrapper, or dashboard-only app.

The product thesis is:

> Visual Hive turns user-visible software risk into structured deterministic evidence. Humans, GitHub, optional visual providers, LLM prompt builders, and Hive agents consume the evidence. They do not replace the evidence.

The new architecture decision is:

> Prioritize CLI + stable JSON first, Evidence Packet second, Handoff/Agent Packets third, trusted GitHub/Hive dry-run handoff fourth, Visual Hive MCP fifth, direct Hive Bead API sixth, and HTTP/hosted API later.

## Read first

Before changing code, inspect the current repository state. Read at least:

- `README.md`
- `AGENTS.md`
- `package.json`
- `packages/**/package.json`
- `packages/core/**`
- `packages/cli/**`
- `packages/playwright-adapter/**`
- `packages/control-plane/**`
- `schemas/**`
- `examples/**`
- `docs/**`
- `.github/workflows/**`

Also read the attached v2 docs:

- `visual-hive-vision-and-research-rationale-agent-forward-v2.md`
- `visual-hive-complete-product-goal-agent-forward-v2.md`
- `visual-hive-roadmap-agent-forward-v2.md`
- `visual-hive-agent-documentation-pack-agent-forward-v2.md`
- `visual-hive-agent-forward-integration-path.md`
- `visual-hive-mcp-tool-efficiency-strategy.md`

## Non-negotiable invariants

- Deterministic tests decide pass/fail.
- LLM output is advisory only and must never be the sole oracle.
- Playwright remains the default deterministic browser execution backend.
- External providers are optional, explicit, mockable, budget-aware, and disabled by default.
- No paid provider, external upload, or real LLM call should be required by default.
- MCP-enabled tools are strength amplifiers, not uncontrolled context dumps.
- PR workflows must use safe read-only/no-secret posture.
- Do not execute untrusted PR code from `pull_request_target`.
- Protected targets run only in trusted scheduled/manual lanes unless explicitly configured otherwise.
- Secret values must never be printed; missing secret names may be reported.
- If a config field changes, update Zod schema, JSON schema, docs, tests, examples, and generated sample artifacts together.
- Stop feature expansion when CI/tests are red. Stabilize first.
- Prefer vertical slices over broad disconnected scaffolding.

## Core architecture to preserve

Visual Hive owns:

```text
repo scanning
recommendation/setup
project-aware planning
changed-file risk selection
target safety
contract generation/execution
visual diff metadata
mutation adequacy
flake/baseline stability
provider policy and normalization
LLM prompt generation/governance
Evidence Packets
Handoff Packets
Agent Packets
Tool Registry and Tool Cards
Context Ledger
triage and issue bodies
Hive handoff artifacts
Control Plane UX
```

External tools/providers may own hosted screenshot review, long-term image hosting, browser/device grids, Storybook publishing, enterprise visual AI comparison, PR dashboards, or team workflows. They must be adapters over Visual Hive policy, not the center of the product.

## Testing layer lattice

Visual Hive should model testing as layers:

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

Make these layers visible in docs and, where feasible, artifacts such as:

```text
.visual-hive/testing-layers.json
.visual-hive/coverage.json
.visual-hive/evidence-packet.json
```

## Primary mission

Move the repo toward v0.3/v0.4 “Agent-Forward Operational Beta.” Do this in the highest-leverage order:

1. Inspect current repo state and summarize what already exists.
2. Run the smallest commands needed to find current breakages.
3. If any core build/test/demo command is red, fix that before feature expansion.
4. Add or harden agent documentation:
   - root `AGENTS.md` additions if missing;
   - `.github/copilot-instructions.md`;
   - `.github/instructions/testing.instructions.md`;
   - `docs/agents/enterprise-definition-of-done.md`;
   - `docs/agents/testing-layer-contract.md`;
   - `docs/agents/visual-contract-authoring.md`;
   - `docs/agents/mutation-adequacy.md`;
   - `docs/agents/hive-handoff-policy.md`;
   - `docs/agents/provider-and-llm-governance.md`;
   - `docs/agents/repo-map-and-context.md`;
   - `docs/agents/agent-forward-integration.md`;
   - `docs/agents/mcp-and-tool-efficiency.md`;
   - `docs/agents/agent-packet-schema.md`.
5. Add or harden an Evidence Packet schema/writer:
   - schema: `schemas/visual-hive.evidence-packet.schema.json`;
   - output: `.visual-hive/evidence-packet.json`;
   - summary: `.visual-hive/evidence-summary.md`;
   - include source, governance, repo intelligence, testing layers, plan, deterministic results, mutation evidence, providers, artifacts, triage, and Hive readiness;
   - sanitize all output.
6. Add or harden repo intelligence:
   - command such as `visual-hive analyze --repo . --out .visual-hive/repo-map.json --markdown .visual-hive/repo-context.md`, or equivalent if the repo already has a command;
   - detect package manager, workspaces, scripts, frameworks, workflows, routes/target hints, test tools, selectors, risk signals, and coverage gaps.
7. Add or harden testing-layer audit:
   - output layer coverage and missing-test guidance;
   - make skipped layers and reasons visible.
8. Add or harden Handoff Packet and Hive dry-run:
   - config defaults disabled/dry-run;
   - no network by default;
   - outputs `.visual-hive/handoff.json`, `.visual-hive/hive-issue.md`, `.visual-hive/hive-bead-request.json`, `.visual-hive/hive-handoff-result.json`;
   - include labels such as `visual-hive`, `hive/quality`, `ai-ready`;
   - require sanitized Evidence Packet.
9. Add or harden Agent Packet generation:
   - output `.visual-hive/agent-packet.json`;
   - support at least `repair_agent`, `test_creator`, `review_agent`, and `handoff_agent` profiles in docs/schema;
   - include objective, evidence summary, allowed tools, forbidden actions, budget, reproduction commands, artifact pointers.
10. Add or harden Tool Registry and Tool Cards:
   - output `.visual-hive/tools/tool-registry.json` and `.visual-hive/tools/tool-cards.md`, or docs/schema first if implementation is too large;
   - include local Visual Hive tools, optional Playwright/Storybook MCP, GitHub MCP read-only, and paid provider MCPs disabled by default;
   - include cost class, trusted-only status, role access, allowed modes, and write restrictions.
11. Add or harden Context Ledger:
   - output `.visual-hive/context-ledger.json` where feasible;
   - track tool calls, estimated tokens, provider screenshots, external cost, escalation reasons, and remaining budget.
12. Update KubeStellar example docs/config so it models:
   - hosted demo no-login canary;
   - local preview screenshots;
   - fake OAuth `commandGroup` planning/runtime if stable;
   - protected live-cluster scheduled/manual target;
   - auth changed-files select auth contracts;
   - docs-only changes skip expensive/protected checks.
13. Update the Control Plane only when it can show real artifacts or useful readiness states. Avoid shallow UI panels without backing data.

## MCP and tool policy

Do not make MCP the first implementation. Build CLI/JSON and Evidence Packet first.

The first-party Visual Hive MCP server should eventually expose:

```bash
visual-hive mcp --stdio
```

Read-only/default resources:

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

Read-only/default tools:

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

Execution tools must be disabled unless explicitly enabled:

```text
visual_hive_run
visual_hive_mutate
visual_hive_update_baseline
visual_hive_handoff_github_issue
visual_hive_handoff_hive_bead
visual_hive_provider_upload
```

Third-party MCPs must be disabled by default and exposed only through role/mode/budget policy.

Default enterprise policy:

```yaml
agentTools:
  exposeThirdPartyMcp: false
  defaultAccess: read_only
  providerMcpDefault: disabled
  githubWritesFromPr: false
  externalUploadsFromPr: false
  baselineApprovalByAgent: false
  requireHumanApprovalFor:
    - provider_upload_enablement
    - baseline_approval
    - github_issue_creation
    - hive_bead_creation
    - paid_provider_connection
    - protected_target_run
```

## Implementation style

Work in small vertical slices:

```text
analyze -> plan -> run -> report -> triage -> evidence -> handoff -> agent packet -> tools -> UI/docs -> tests
```

Avoid giant rewrites. Prefer focused, testable improvements.

When adding code:

- keep TypeScript types strict;
- keep artifacts schema-versioned;
- add tests for selected/skipped reasons;
- test sanitizer behavior;
- test provider/LLM disabled/default behavior;
- test PR-safe/protected target behavior;
- test agent packet/tool registry budget behavior if implemented;
- update docs and examples in the same change.

## Validation commands

Use relevant targeted commands while developing. Before final handoff, run as many of these as feasible and report exact results:

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

Also validate important CLI flows where available:

```bash
node packages/cli/dist/index.js --help
node packages/cli/dist/index.js recommend --help
node packages/cli/dist/index.js plan --config examples/kubestellar-console/visual-hive.config.yaml --mode pr --changed-files examples/kubestellar-console/sample-auth-changed-files.txt
node packages/cli/dist/index.js plan --config examples/kubestellar-console/visual-hive.config.yaml --mode pr --changed-files examples/kubestellar-console/sample-docs-changed-files.txt
node packages/cli/dist/index.js plan --config examples/kubestellar-console/visual-hive.config.yaml --mode schedule
```

If a listed command does not exist, do not fake success. Either add it if in scope, or document that it is not currently present and what equivalent command was used.

## Acceptance criteria

The goal run is successful if the repo has moved measurably toward agent-forward operational beta and produces real, inspectable outputs. At minimum, provide:

- summary of actual initial state found;
- implemented changes, not only docs;
- tests added/updated;
- docs updated;
- validation commands and exact results;
- artifacts produced;
- remaining gaps ranked by priority;
- next prompt for unfinished work.

Do not claim production readiness unless validation commands pass and the external-repo/KubeStellar flow has real artifacts.

## Final handoff format

End with:

```markdown
## Summary
- ...

## Files changed
- ...

## Validation
- command: result

## Artifacts produced
- ...

## Agent/tool policy changes
- ...

## Remaining gaps
1. ...

## Next prompt
...
```
