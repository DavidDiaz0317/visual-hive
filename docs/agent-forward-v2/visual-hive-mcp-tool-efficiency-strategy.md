# Visual Hive MCP Tool and Agent Efficiency Strategy

## Executive decision

MCP-enabled tools can provide real value to Visual Hive, but they should not be connected freely or treated as always-on context.

Visual Hive should use this posture:

1. **Visual Hive's own CLI/JSON and Evidence Packet remain the default agent interface.**
2. **Visual Hive should expose its own MCP server for agent-native access.**
3. **Third-party MCPs should be optional, role-gated, budget-gated, and mediated through Visual Hive.**
4. **Agents should receive a compact tool card and task packet, not a full catalog of every MCP tool.**
5. **External paid MCPs should be used only when they add measurable strength over local deterministic checks.**

The goal is not to give agents more tools. The goal is to give the correct agent the smallest sufficient tool surface for the current task.

---

## Why MCPs are useful

MCPs are useful when they give agents structured access to systems that would otherwise require brittle scraping, dashboard navigation, or manual context copying.

For Visual Hive, useful categories are:

| MCP/tool category | Value to Visual Hive | Default posture |
| --- | --- | --- |
| Visual Hive MCP | Lets agents read reports, evidence, plans, mutation survivors, repair prompts, and safe commands | First-party, supported |
| Playwright MCP | Lets agents inspect live DOM/accessibility snapshots and generate better tests | Local, optional, test-authoring/debug only |
| Storybook/Chromatic MCP | Gives agents component/stories/design-system context, reducing pattern drift | Optional, strong for component-heavy repos |
| GitHub MCP | Issues, PRs, checks, logs, workflow status, code search | Read-only by default; writes trusted only |
| Applitools MCP | Provider setup, visual checkpoints, cross-browser/visual AI result analysis | Enterprise/paid profile only |
| BrowserStack MCP | Real-device/cross-browser debugging and logs | Enterprise/paid profile only |
| Sentry MCP | Production/protected error context and MCP observability | Optional, protected/trusted only |
| Jira/Linear/Slack MCPs | Enterprise routing and team workflow integration | Later, issue-routing only |

MCPs should be strongest in setup, test generation, failure diagnosis, external provider result review, and issue handoff. They should not replace Visual Hive's deterministic verdict authority.

---

## Main risk: tool bloat and token bloat

The major failure mode is connecting many MCP servers and letting every agent see every tool definition and every raw result.

That creates three problems:

1. **More input tokens.** Tool descriptions and schemas occupy context before the agent has done useful work.
2. **More intermediate tokens.** Large tool results, traces, logs, screenshots, and issue bodies get copied through the model.
3. **Worse decisions.** Extra context can distract models, cause wrong tool selection, and increase latency.

Visual Hive should assume that MCPs are expensive until proven useful.

---

## Visual Hive MCP architecture

### 1. Tool Registry

Add a first-class registry describing available tool surfaces.

Suggested file:

```text
.visual-hive/tools/tool-registry.json
```

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

### 2. Role-based tool profiles

Do not give every agent every tool.

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

### 3. Tool Cards instead of full tool dumps

Agents should not receive raw full MCP schemas by default. Visual Hive should generate compact tool cards.

Suggested path:

```text
.visual-hive/tools/tool-cards.md
```

Example:

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

Tool cards should be generated per role. A repair agent should not see provider setup tools; a provider specialist should not see GitHub merge tools.

---

## Token and credit optimization techniques

## 1. Progressive disclosure

Give the agent only:

1. task objective;
2. role;
3. current evidence summary;
4. allowed tool card list;
5. exact reproduction command;
6. budget.

Do not include full docs, schemas, traces, screenshots, and provider results unless requested.

## 2. Tool search before tool load

Add a Visual Hive tool:

```text
visual_hive_search_tools(query, role, detailLevel)
```

`detailLevel` should support:

```text
names_only
summary
full_schema
```

Most tasks should need only `names_only` or `summary`.

## 3. Tool broker/code execution pattern

Instead of forcing the model to call ten MCP tools and read every raw result, Visual Hive should support a small tool broker that does local filtering and returns compact summaries.

Example:

```text
Agent asks: summarize failed GitHub checks and Visual Hive failures.

Bad:
  model calls GitHub logs -> huge logs into context
  model calls Visual Hive report -> huge JSON into context
  model manually merges them

Good:
  Visual Hive broker calls GitHub/Visual Hive tools locally
  filters to failed steps and matching contract IDs
  returns 30-line summary + artifact paths
```

This same pattern should apply to traces, logs, mutation reports, provider results, and Sentry events.

## 4. Artifact pointers over raw artifacts

Default output should be:

```json
{
  "summary": "dashboard-shell failed due to missing primary nav",
  "evidencePath": ".visual-hive/evidence-packet.json",
  "diffPath": ".visual-hive/artifacts/dashboard/diff.png",
  "reproduce": "visual-hive run --contract dashboard-shell --mode local"
}
```

Only load raw artifacts when the task requires it.

## 5. Context ledger

Every agent task should have a ledger:

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

The agent should see the remaining budget.

## 6. Cache by commit/run/signature

Cache expensive results under stable keys:

```text
repo + commit + configHash + contractId + targetId + viewport
```

Cache:

- route discovery;
- component index;
- accessibility snapshots;
- Visual Hive plan summaries;
- mutation applicability;
- provider result summaries;
- GitHub workflow failure summaries.

## 7. Small summaries before full JSON

For every major artifact, write both:

```text
.visual-hive/evidence-packet.json
.visual-hive/evidence-summary.md
.visual-hive/evidence-summary.compact.json
```

Agents should read compact summaries first.

## 8. No screenshots through LLM unless needed

Visual Hive should prefer:

- visual diff metadata;
- bounding boxes;
- selector failures;
- OCR-free text assertions;
- accessibility snapshots;
- artifact paths.

Image/vision analysis should be used only when deterministic metadata is insufficient.

## 9. Provider escalation ladder

Do not jump directly to paid MCPs.

```text
Level 0: Visual Hive report and local Playwright artifacts
Level 1: Playwright MCP / Storybook MCP local inspection
Level 2: GitHub read-only checks/logs
Level 3: Hosted visual provider result fetch
Level 4: Provider upload / real-device/cross-browser run
Level 5: GitHub issue/Hive Bead write
```

Each escalation needs a reason.

## 10. Reusable recipes instead of free-form prompting

Create recipes:

```text
docs/agents/recipes/debug-visual-failure.md
docs/agents/recipes/create-contract-from-mutation-survivor.md
docs/agents/recipes/review-provider-result.md
docs/agents/recipes/handoff-to-hive.md
```

Agents should follow recipes and call tools in bounded sequences.

---

## Recommended MCP adoption phases

### Phase 1: First-party Visual Hive agent surface

Build:

```bash
visual-hive tools list --json
visual-hive tools recommend --role repair_agent --json
visual-hive agent packet --role repair_agent --finding <id> --json
visual-hive mcp --stdio
```

Expose first-party MCP resources:

```text
visual-hive://latest-evidence
visual-hive://latest-summary
visual-hive://latest-handoff
visual-hive://mutation-report
visual-hive://repair-prompt
visual-hive://tool-cards/repair_agent
```

### Phase 2: Local MCP integrations

Support optional local Playwright and Storybook MCP discovery.

Use cases:

- create contracts from live DOM;
- verify selectors;
- inspect component patterns;
- reduce hallucinated UI code.

No provider costs.

### Phase 3: GitHub read-only MCP

Use GitHub MCP for:

- PR metadata;
- changed files;
- failed checks;
- issue lookup;
- dedupe existing failure issues.

Writes remain trusted-only.

### Phase 4: Provider MCPs

Use Applitools, BrowserStack, Chromatic, or similar MCPs only in explicit profiles.

Use cases:

- enterprise cross-browser/device coverage;
- existing provider result analysis;
- onboarding a team already paying for the provider;
- failures that local Playwright cannot reproduce.

### Phase 5: MCP Gateway / Tool Broker

Build a Visual Hive MCP gateway that can expose a small, role-specific, budget-controlled subset of external MCP capabilities.

The agent should talk to Visual Hive, and Visual Hive decides whether/how to call third-party MCPs.

---

## When MCPs are worth the credits

MCPs are worth it when they improve one of these metrics:

- fewer false positives;
- fewer false negatives;
- faster failure diagnosis;
- better generated tests;
- fewer hallucinated UI components;
- better repair PR success rate;
- less human review time;
- better protected/cross-browser coverage.

They are not worth it merely because they are available.

Visual Hive should track:

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

Over time, this becomes a real product advantage: Visual Hive can recommend which MCPs are actually valuable for a repo.

---

## Default enterprise policy

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

---

## Product language

Use this wording in docs:

> Visual Hive supports MCP-enabled tools as strength amplifiers, not as uncontrolled context sources. Agents interact first with Visual Hive's Evidence Packet, compact summaries, and role-specific tool cards. External MCPs are enabled only when a task, role, safety mode, and budget policy justify them. This keeps the system agent-forward while preserving deterministic pass/fail, low token usage, and enterprise safety.
