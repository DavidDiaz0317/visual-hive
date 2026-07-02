# Visual Hive Complete Product Goal — Updated Enterprise Goal

Status: agent-readable product north star  
Date: 2026-07-02  
Target repo: `DavidDiaz0317/visual-hive`

---

## The sentence every agent must preserve

Visual Hive is an enterprise-grade, local-first/cloud-ready, deterministic-first visual QA orchestration and evidence platform.

It turns visual and user-flow risk into structured evidence that humans, GitHub, optional providers, LLM prompt builders, and Hive agents can safely consume.

It is not a demo, side project, screenshot wrapper, dashboard-only project, or generic testing toy.

---

## Product north star

Visual Hive should let a serious engineering team connect a repository and answer:

- What user-visible behavior is protected?
- Which routes, viewports, components, auth states, API states, and visual baselines are covered?
- Which checks run on every PR, which run daily, and which require protected secrets?
- Which failures are deterministic product failures versus environment/provider/flake issues?
- Did mutation testing prove the tests are meaningful?
- What changed file or risk signal selected each contract?
- What would this run cost if external providers or LLMs were enabled?
- Which artifacts are safe to send to GitHub, Hive, or a repair agent?
- What exact repair prompt or issue should an agent receive?
- What should be improved next to raise visual QA maturity?

The system should feel guided for beginners and deeply controllable for enterprise teams.

---

## Enterprise product standard

Visual Hive is enterprise-level only when these properties are true:

1. **Reproducible:** every failure has a target, contract, mode, commit, run command, artifact path, and reason.
2. **Governed:** PR-safe, protected, provider, LLM, baseline, and issue-creation policy is explicit.
3. **Deterministic-first:** Visual Hive's verdict layer decides status from configured deterministic evidence; Playwright is the default first-party runner, and LLM output never decides pass/fail alone.
4. **Local-first:** the default path works with CLI + Playwright + GitHub Actions + artifacts, without a paid provider.
5. **Cloud-ready:** artifacts and schemas are stable enough for a future GitHub App or hosted Control Plane.
6. **Agent-ready:** docs and artifacts are structured enough that coding agents can work without guessing the architecture.
7. **Auditable:** reports, Evidence Packets, baseline actions, provider usage, LLM prompts, and handoffs are traceable.
8. **Secure by default:** no secrets in untrusted PR workflows, no privileged execution of PR code, no silent external uploads.
9. **Budget-aware:** external screenshots, LLM tokens, and provider calls are planned and reported before use.
10. **Extensible:** provider and runner integrations are adapters over Visual Hive policy, not the product's core identity.

---

## Product boundary

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
triage and issue bodies
Hive handoff artifacts
Control Plane UX
```

External tools may own:

```text
hosted visual review UIs
long-term image hosting
browser/device grids
Storybook publishing
enterprise visual AI diff engines
managed QA services
synthetic monitor hosting
```

Visual Hive should integrate those tools when they add value, but the product must remain useful without them.

---

## Testing layer lattice

Visual Hive must establish testing as a layered quality system, not a single Playwright pass.

| Layer | Name | Description | First-class Visual Hive output |
| --- | --- | --- | --- |
| 0 | Repo intelligence | Detect repo type, package manager, routes, workflows, test scripts, selectors, apps, services, targets, and risk areas | `.visual-hive/repo-map.json`, `.visual-hive/repo-context.md` |
| 1 | Static/build/workflow safety | Typecheck, lint, build, workflow security, secret/protected-target safety | workflow audit, safety findings |
| 2 | Unit | Low-level behavior for modules, utilities, reducers, handlers | unit test summary |
| 3 | Component/a11y | Component states, accessibility, selectors, accessible names | component/a11y findings |
| 4 | API/contract | API success/error/empty/loading state contracts | API contract results |
| 5 | Component visual | Story/component/design-token visual regression | component screenshots/diffs |
| 6 | E2E user-flow | Critical browser flows and route-level visual contracts | Playwright specs, screenshots, traces |
| 7 | Cross-browser/device | Browser/device visual variation where provider value is justified | normalized provider results |
| 8 | Canary/protected | Hosted demo, staging, live cluster, secret-bearing scheduled checks | protected target report |
| 9 | Mutation/fault injection | Prove tests catch intentional breakage | mutation report and survived recommendations |
| 10 | Flake/history/cost | Run stability, baseline churn, provider spend, external screenshot budget | history/cost/stability reports |
| 11 | Agent/Hive feedback | Convert evidence into repair-ready tasks and validate repair PRs | Evidence Packet, issue, repair prompt, Hive handoff |

### Required lane behavior

#### Pull request lane

Use `pull_request`, read-only permissions, no secrets, no protected targets. It should be fast and selected by changed files.

Minimum PR outputs:

```text
.visual-hive/plan.json
.visual-hive/report.json
.visual-hive/triage.json
.visual-hive/evidence-packet.json
.visual-hive/issue.md or issue-preview.md
```

#### Scheduled/deep lane

Use `schedule`/`workflow_dispatch`, may use protected secrets only when configured. It should run deeper coverage, mutation adequacy, provider upload if allowed, and flake/history updates.

Minimum scheduled outputs:

```text
.visual-hive/report.json
.visual-hive/mutation-report.json
.visual-hive/history.json
.visual-hive/provider-results.json
.visual-hive/evidence-packet.json
.visual-hive/hive-handoff.json
```

#### Trusted issue/handoff lane

Use trusted artifact consumption. Do not checkout or execute untrusted PR code. Sanitize issue bodies and dedupe by signature.

Minimum handoff outputs:

```text
.visual-hive/hive-issue.md
.visual-hive/hive-bead-request.json
.visual-hive/hive-handoff-result.json
```

---

## Required agent documentation pack

The repo should include agent-facing documentation that is treated as product infrastructure.

### Root `AGENTS.md`

Must include:

- enterprise goal;
- architecture overview;
- workspace/package layout;
- deterministic-first rule;
- security and provider rules;
- testing commands;
- schema update rules;
- vertical-slice work pattern;
- “stop feature work when CI is red.”

### `.github/copilot-instructions.md`

A shorter mirror for GitHub Copilot:

- Visual Hive is enterprise software;
- preserve deterministic-first model;
- never introduce `pull_request_target` execution of PR code;
- update schemas/docs/tests/examples together;
- avoid stubs;
- keep LLM/provider calls opt-in and mockable.

### `.github/instructions/testing.instructions.md`

Path-scoped guidance for files under `packages/**`, `examples/**`, `docs/**`, `schemas/**`, `.github/workflows/**`:

- what test layer each file affects;
- how to add contracts;
- how to validate mutations;
- what artifacts must be emitted;
- which commands to run.

### `docs/agents/*`

Add these documents:

```text
docs/agents/enterprise-definition-of-done.md
docs/agents/testing-layer-contract.md
docs/agents/visual-contract-authoring.md
docs/agents/mutation-adequacy.md
docs/agents/hive-handoff-policy.md
docs/agents/provider-and-llm-governance.md
docs/agents/repo-map-and-context.md
```

---

## Repo intelligence and knowledge graph

Visual Hive should add a machine-readable repo map before agents generate tests. This is the easiest format for agents to consume because it is structured, schema-validated, and stable.

### Command

```bash
visual-hive analyze --repo . --out .visual-hive/repo-map.json --markdown .visual-hive/repo-context.md
```

### Repo map responsibilities

The analyzer should detect:

- package manager;
- workspaces;
- scripts;
- frameworks;
- apps/packages;
- routes;
- Storybook/Ladle/Histoire presence;
- Playwright/Cypress/WebdriverIO/Vitest/Jest presence;
- GitHub workflows and triggers;
- risky workflow patterns;
- test IDs/selectors;
- public/protected target hints;
- route/component ownership hints;
- changed-file-to-contract mappings;
- missing coverage areas;
- recommended setup profile;
- recommended first contracts.

### Suggested JSON shape

```json
{
  "schemaVersion": "visual-hive.repo-map.v0.1",
  "generatedAt": "2026-07-02T00:00:00Z",
  "repo": { "root": ".", "name": "visual-hive" },
  "packageManager": "npm",
  "workspaces": [],
  "apps": [],
  "packages": [],
  "scripts": {},
  "testing": {
    "unit": [],
    "component": [],
    "e2e": [],
    "visual": [],
    "mutation": []
  },
  "routes": [],
  "targets": [],
  "contracts": [],
  "workflows": [],
  "riskSignals": [],
  "coverageGaps": [],
  "recommendedNextActions": []
}
```

---

## Current ecosystem positioning

Visual Hive should explicitly position itself relative to other tools.

### Playwright

Default deterministic execution backend. Visual Hive should produce readable specs and use Playwright traces/screenshots/errors as evidence.

### Cypress and WebdriverIO

Potential future runner adapters. WebdriverIO is especially useful for mobile/native/hybrid visual horizons. Cypress may be useful for teams already standardized on Cypress.

### Vitest Browser Mode

Potential fast component/page visual lane. Useful for PR checks when component files or design tokens change.

### Storybook/Chromatic/Loki/Happo

Component/design-system lane. Visual Hive should detect Storybook and recommend component visual coverage, especially for design systems.

### Argos/Percy/Applitools

Hosted review/cross-browser provider lane. These should be optional, budget-aware, mocked in tests, and skipped by default on PRs.

### Meticulous/Wopee/AI QA tools

Inspiration for route discovery, session-derived test suggestions, and self-healing setup recommendations. They should not become verdict authorities in Visual Hive.

### Currents/Replay/Checkly

Inspiration for run history, flake index, trace replay, sharding, and synthetic canary UX.

### Stryker/PIT

Proof that mutation adequacy is a serious engineering discipline. Visual Hive's unique angle is UI/auth/API/visual mutation adequacy.

---

## CLI/Core product goals

The CLI should support:

```bash
visual-hive init
visual-hive recommend
visual-hive analyze
visual-hive plan
visual-hive run
visual-hive mutate
visual-hive triage
visual-hive report
visual-hive evidence
visual-hive pipeline
visual-hive ui
visual-hive providers inspect
visual-hive providers evaluate
visual-hive baselines inspect
visual-hive baselines approve --dry-run
visual-hive coverage inspect
visual-hive test-layers audit
visual-hive integrations hive handoff --dry-run
visual-hive integrations hive handoff --mode github_issue
```

### `pipeline` should be the operational spine

The pipeline command should eventually orchestrate:

```text
analyze -> recommend/read config -> plan -> run -> mutate when selected -> triage -> evidence -> provider normalization -> handoff preview -> summary
```

### `test-layers audit`

This command should inspect the repo/config/report and produce:

```text
.visual-hive/testing-layers.json
.visual-hive/coverage.json
.visual-hive/missing-tests.md
```

It should make missing layers explicit. Example:

```text
Layer 5 component visual: not configured; Storybook detected.
Layer 8 protected canary: configured but skipped on PR because target is protected.
Layer 9 mutation: enabled for schedule, skipped on PR by cost policy.
```

---

## Config model additions

Add or plan fields for:

```yaml
enterprise:
  productTier: local-first
  evidenceRetentionDays: 30
  requireSchemaVersion: true

testingLayers:
  enabled: true
  prBudgetSeconds: 180
  scheduleBudgetMinutes: 30
  layers:
    repoIntelligence: true
    staticBuildWorkflow: true
    unit: detect
    componentA11y: detect
    apiContract: detect
    componentVisual: detect
    e2eUserFlow: true
    crossBrowserDevice: provider-gated
    canaryProtected: schedule-only
    mutationFaultInjection: schedule-or-selected
    flakeHistoryCost: true
    agentHiveFeedback: trusted-only

repoMap:
  enabled: true
  output: .visual-hive/repo-map.json
  markdownOutput: .visual-hive/repo-context.md

evidencePacket:
  enabled: true
  output: .visual-hive/evidence-packet.json
  schemaVersion: visual-hive.evidence-packet.v0.3
  includeTraces: true
  sanitize: true

integrations:
  hive:
    enabled: false
    mode: dry_run
    trustedOnly: true
    labels: [visual-hive, hive/quality, ai-ready]

governance:
  deterministicFirst: true
  llmNeverSoleOracle: true
  noSecretsOnPullRequest: true
  noExternalUploadByDefault: true
  forbidPullRequestTargetExecution: true
```

---

## Control Plane additions

The Control Plane should expose enterprise readiness, not only run output.

Add or prioritize:

1. Evidence Packet viewer.
2. Testing layer coverage page.
3. Repo map page.
4. Hive handoff readiness page.
5. Provider cost and skip reasons page.
6. Flake/baseline stability page.
7. Workflow safety audit page.
8. Agent-ready issue/prompt preview.
9. Protected target readiness panel.
10. Schema/version compatibility panel.

---

## KubeStellar example expectations

The KubeStellar example must be treated as realistic enterprise dogfooding, not a demo.

Minimum modeled targets:

```text
hosted-demo-no-login        PR-safe canary URL, no login exposure
local-preview-dashboard     command target, dashboard/routes screenshots
fake-oauth-fullstack        commandGroup target, planned/runtime when stable
protected-live-cluster      protected target, scheduled/manual only
storybook-or-component      optional if detected
```

Minimum modeled contracts:

```text
public demo never shows login controls
dashboard shell renders primary regions
clusters route renders table/card states
settings route preserves controls and empty states
mobile viewport has no horizontal overflow
API 500 shows stable error state
empty data shows stable empty state
auth changes select auth contracts
docs-only changes skip expensive/protected contracts
schedule mode selects protected targets when secrets are configured
```

---

## LLM governance

LLMs may:

- explain failures;
- summarize diffs;
- suggest missing tests;
- draft issues;
- generate repair prompts;
- review mutation survivors;
- help generate proposed contracts;
- explain setup recommendations.

LLMs may not:

- decide pass/fail;
- approve baselines;
- override deterministic failures;
- access secrets;
- upload screenshots externally;
- silently connect paid providers;
- run untrusted code in privileged workflows.

Default mode:

```yaml
llm:
  enabled: false
  mode: prompt_only
  neverSoleOracle: true
  sanitizePrompts: true
```

---

## Provider governance

Every provider adapter must implement:

- availability check;
- credential-name check only;
- policy check;
- budget estimate;
- dry-run/mock mode;
- upload/compare/fetch when explicitly allowed;
- normalized result;
- skipped reason;
- external calls made count;
- test coverage.

No adapter should make a network call unless all are true:

```text
provider enabled
credentials present
run mode allows external calls
policy allows external upload
budget constraints pass
trusted context when secrets are involved
```

---

## Enterprise definition of done for agent work

A change is not done unless:

1. It is implemented, not just scaffolded.
2. It has tests or an explicit reason tests are not applicable.
3. It updates docs when behavior changes.
4. It updates config schema, JSON schema, examples, and tests when fields change.
5. It preserves PR-safe/no-secret defaults.
6. It produces or updates artifacts when appropriate.
7. It runs relevant validation commands.
8. It explains remaining limitations honestly.
9. It does not make paid provider/LLM/network calls by default.
10. It improves an end-to-end vertical slice.

Preferred vertical slice:

```text
scan -> recommend -> config -> plan -> run -> evidence -> triage -> UI/issue -> test -> docs
```

Avoid disconnected broad scaffolding.

---

## Immediate product priorities

1. Stabilize current build/test/demo flows.
2. Add Evidence Packet v0.3 schema and writer if not already complete.
3. Add repo-map analyzer and markdown context output.
4. Add testing-layer lattice docs and audit output.
5. Add Hive handoff dry run.
6. Add KubeStellar example layer coverage.
7. Add agent documentation pack.
8. Add provider evaluation/skip-reason report.
9. Add flake/baseline stability index.
10. Reflect all of the above in the Control Plane.

---

## Final product standard

Visual Hive is substantially complete when a user can:

1. Install it.
2. Run it locally on a real repo.
3. Generate a recommended config and workflows.
4. Understand what each testing layer covers.
5. Run fast PR-safe checks.
6. Run deeper scheduled/protected checks.
7. Manage baselines safely.
8. See deterministic visual/user-flow failures.
9. See mutation adequacy.
10. Understand flake/baseline stability.
11. Understand provider recommendations and cost.
12. Generate sanitized Evidence Packets.
13. Create trusted issue/handoff artifacts.
14. Route failures to Hive or agents under governance.
15. Rerun deterministic gates on repairs.
16. Dogfood against KubeStellar Console and another external repo.

Remaining gaps should be external activation items, not missing core architecture.


---

# Agent-Forward Product Architecture Addendum

## Product-level decision

Visual Hive should be **agent-forward**, not merely AI-adjacent. The system should be designed so that agents can safely administer, create, review, repair, and improve tests through structured evidence and governed tools.

The product principle:

> Visual Hive gives agents the smallest sufficient evidence and tool surface needed to perform a test-quality task, while deterministic checks remain the source of truth.

This should be visible in CLI behavior, schemas, docs, examples, Control Plane UX, GitHub workflows, and future Hive integration.

## Integration priority

Prioritize integration surfaces in this order:

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

This order keeps the product portable and enterprise-safe. CLI/JSON and artifacts work anywhere. MCP, Hive, APIs, and providers become adapters over the same core.

## Required first-party agent artifacts

Visual Hive should produce these artifacts as first-class outputs:

```text
.visual-hive/evidence-packet.json
.visual-hive/evidence-summary.md
.visual-hive/handoff.json
.visual-hive/hive-issue.md
.visual-hive/hive-bead-request.json
.visual-hive/agent-packet.json
.visual-hive/tools/tool-registry.json
.visual-hive/tools/tool-cards.md
.visual-hive/context-ledger.json
.visual-hive/testing-layers.json
.visual-hive/coverage.json
```

Each artifact has a different job:

| Artifact | Purpose |
| --- | --- |
| Evidence Packet | Full stable machine-readable truth for the run |
| Evidence Summary | Compact human/agent summary of the run |
| Handoff Packet | Small task object for GitHub, Hive, and queues |
| Hive Issue | Sanitized issue body for trusted GitHub issue creation |
| Hive Bead Request | Optional direct Hive API payload |
| Agent Packet | Role-specific task context for agents |
| Tool Registry | All known tools, costs, risks, modes, and role access |
| Tool Cards | Compact descriptions of only the tools an agent may use |
| Context Ledger | Token/tool/external-cost budget and usage tracking |
| Testing Layers | Layer-by-layer coverage and missing-test posture |
| Coverage | Route/target/contract/viewport/risk coverage map |

## Tool Registry product requirement

Visual Hive should own the tool registry rather than expecting each agent to discover tools blindly.

Suggested config:

```yaml
agentTools:
  defaultPolicy: gated
  exposeThirdPartyMcp: false
  maxToolDefinitionsPerAgent: 8
  maxToolCallsPerTask: 20
  maxToolResultTokensPerTask: 12000
  maxExternalCostUsdPerTask: 0
  requireTrustedModeForWrites: true
  requireTrustedModeForProviderMcp: true

  mcpServers:
    visualHive:
      enabled: true
      kind: first_party
      transport: stdio
      costClass: local
      defaultAccess: read_only

    playwright:
      enabled: false
      kind: local
      command: npx
      args: ["@playwright/mcp@latest"]
      costClass: local
      defaultAccess: read_only
      allowedRoles: [test_creator, repair_agent]
      allowedModes: [local, pr_debug, schedule]

    github:
      enabled: false
      kind: remote_or_local
      costClass: external_api
      defaultAccess: read_only
      allowedRoles: [review_agent, handoff_agent, admin_agent]
      writeRequiresTrustedMode: true

    applitools:
      enabled: false
      kind: provider
      costClass: paid_provider
      defaultAccess: read_only
      allowedRoles: [provider_specialist]
      allowedModes: [schedule, manual, trusted]

    browserstack:
      enabled: false
      kind: provider
      costClass: paid_provider
      defaultAccess: read_only
      allowedRoles: [provider_specialist]
      allowedModes: [schedule, manual, trusted]
```

## Agent profiles

Visual Hive should define role-specific profiles. Each profile should map to allowed tools, forbidden actions, budgets, and expected outputs.

```yaml
agentProfiles:
  setup_agent:
    purpose: Generate a safe Visual Hive setup.
    tools:
      - visualHive.doctor
      - visualHive.recommend
      - visualHive.validateConfig
      - visualHive.generateConfigPreview
      - github.readRepoMetadata
    forbidden:
      - provider.write
      - github.createIssue
      - github.mergePullRequest

  test_creator:
    purpose: Add or improve visual/user-flow contracts.
    tools:
      - visualHive.coverage
      - visualHive.plan
      - visualHive.mutationReport
      - visualHive.generateContractDraft
      - playwright.accessibilitySnapshot
      - storybook.componentIndex
    forbidden:
      - baseline.approve
      - provider.upload
      - github.write

  repair_agent:
    purpose: Reproduce and fix deterministic failures.
    tools:
      - visualHive.latestEvidence
      - visualHive.reproductionCommands
      - visualHive.runFocused
      - playwright.accessibilitySnapshot
      - playwright.screenshot
    forbidden:
      - baseline.approve
      - provider.upload
      - protectedTarget.run

  review_agent:
    purpose: Review whether a change improved evidence.
    tools:
      - visualHive.compareReports
      - visualHive.mutationReport
      - github.readPullRequest
      - github.readChecks
    forbidden:
      - github.mergePullRequest
      - baseline.approve
      - provider.write

  handoff_agent:
    purpose: Create/update sanitized GitHub issue or Hive Bead.
    tools:
      - visualHive.handoffDryRun
      - visualHive.issueBody
      - github.createOrUpdateIssue
      - hive.createBead
    trustedOnly: true

  provider_specialist:
    purpose: Use Applitools/BrowserStack/Chromatic only when local evidence is insufficient.
    tools:
      - visualHive.providerReadiness
      - applitools.fetchResults
      - browserstack.fetchSessionLogs
      - chromatic.storybookContext
    trustedOnly: true
    requiresBudget: true
```

## Visual Hive MCP server

A first-party MCP server should be implemented after the CLI and Evidence Packet stabilize.

Command:

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

Execution tools should be disabled unless explicitly enabled:

```text
visual_hive_run
visual_hive_mutate
visual_hive_update_baseline
visual_hive_handoff_github_issue
visual_hive_handoff_hive_bead
visual_hive_provider_upload
```

MCP safety flags:

```bash
visual-hive mcp --stdio \
  --repo . \
  --allow-run=false \
  --allow-mutate=false \
  --allow-baseline-write=false \
  --allow-provider-upload=false \
  --allow-handoff=false
```

## Tool Broker

The Tool Broker is a future internal service that lets agents request compact summaries instead of directly loading raw results from many tools.

Bad pattern:

```text
agent -> GitHub MCP -> huge logs
agent -> Visual Hive report -> huge JSON
agent -> provider MCP -> huge result
agent manually merges context
```

Preferred pattern:

```text
agent -> Visual Hive Tool Broker:
  "Summarize failed GitHub checks and matching visual failures."

Tool Broker:
  reads GitHub/Visual Hive/provider data locally
  filters to relevant failures
  returns a compact summary + artifact pointers
```

This keeps agent strength high while reducing token usage and tool noise.

## Context Ledger

Every agent task should track budget and usage:

```json
{
  "taskId": "vh-task-123",
  "role": "repair_agent",
  "budget": {
    "maxInputTokens": 30000,
    "maxOutputTokens": 8000,
    "maxToolCalls": 20,
    "maxExternalCostUsd": 0,
    "maxProviderScreenshots": 0
  },
  "usage": {
    "toolCalls": 4,
    "estimatedInputTokens": 9200,
    "externalCostUsd": 0,
    "providerScreenshots": 0
  }
}
```

The Control Plane should surface this in an Agent/Tool Usage panel so teams can see which agent/tool paths are actually worth the cost.

## MCP escalation ladder

Agents should escalate tool use in a predictable order:

```text
Level 0: Visual Hive summary + local artifacts
Level 1: Visual Hive full Evidence Packet
Level 2: Playwright/Storybook local MCP inspection
Level 3: GitHub read-only logs/checks
Level 4: Hosted provider result fetch
Level 5: Provider upload / real-device / cross-browser run
Level 6: GitHub issue write or Hive Bead write
```

Each escalation should require a reason and should be recorded in the context ledger.

Example reasons:

```text
Escalated to Playwright MCP because selector failure lacked enough DOM context.
Escalated to BrowserStack because failure reproduced only on mobile Safari.
Escalated to Applitools because enterprise profile requested cross-browser visual AI.
```

## Control Plane additions

Add these future Control Plane sections:

### Agent Handoff

Show:

- Evidence Packet status;
- Handoff Packet status;
- GitHub issue dry-run body;
- Hive Bead request preview;
- labels;
- dedupe signature;
- trusted workflow readiness;
- missing secret names only;
- safe/unsafe artifact markers.

### Agent Tool Registry

Show:

- enabled tools/MCP servers;
- role access;
- cost class;
- trusted-only status;
- read/write capability;
- allowed modes;
- budget policy;
- recent usage outcomes.

### Agent Packet Preview

Show the exact compact packet a repair/test/review agent would receive.

### Context Ledger

Show:

- tool calls used;
- estimated input/output tokens;
- external provider cost;
- provider screenshots;
- remaining budget;
- final outcome.

## Enterprise policy defaults

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

Enterprise users can loosen these policies, but Visual Hive should not start there.

## Updated finished product standard

Visual Hive should be considered agent-forward when a user can:

1. run Visual Hive locally with no LLM or provider;
2. produce a stable Evidence Packet;
3. produce a compact Agent Packet;
4. produce a Hive/GitHub Handoff Packet in dry-run mode;
5. give an agent a role-specific task packet and tool card set;
6. prevent the agent from seeing or calling unsafe tools;
7. track tool calls, tokens, and external cost;
8. optionally expose read-only Visual Hive MCP resources;
9. optionally connect local debugging MCPs such as Playwright/Storybook;
10. optionally use paid provider MCPs only under trusted, budgeted enterprise policy;
11. preserve deterministic pass/fail and human/governed approval boundaries.
