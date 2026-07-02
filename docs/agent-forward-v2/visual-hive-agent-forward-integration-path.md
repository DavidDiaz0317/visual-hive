# Visual Hive Agent-Forward Integration Path

## Decision

Visual Hive should be **agent-forward**, but not agent-dependent. The integration strategy should be:

1. **CLI + JSON-first contracts as the canonical surface.**
2. **Evidence Packet and Handoff Packet as the stable machine interface.**
3. **MCP server as the main agent-native surface once the CLI contracts are stable.**
4. **Hive integration through GitHub issue handoff first, direct Bead API second.**
5. **HTTP API / Control Plane API after the local core is stable, mainly for UI, GitHub App, hosted mode, and enterprise integrations.**

The key architectural rule:

> All integrations must call the same Visual Hive core service layer. CLI, MCP, HTTP API, GitHub Actions, and Hive handoff must not become separate implementations.

Visual Hive should not force users to have Hive installed. Hive should be an optional orchestration partner. Visual Hive must remain useful to a repo using only `npx visual-hive`, Playwright, and GitHub Actions.

---

## Why this order

### CLI first

The CLI should be the first-class interface because it is:

- easy for humans;
- easy for CI;
- easy for Codex, Claude Code, Copilot CLI, Goose, and other local agents;
- easy to test;
- easy to run in target repositories without a daemon;
- secure by default;
- portable across GitHub Actions, local development, containers, and Hive-managed agents.

This is similar in spirit to agent-native tools such as `bd`, where agents are expected to use command output in JSON form. Visual Hive should adopt the same principle: every important command must have `--json`, stable exit codes, and schema-versioned output.

### Evidence Packet second

The Evidence Packet is the actual product boundary. It lets every integration consume the same truth:

- humans in the Control Plane;
- GitHub issue workflows;
- Hive Beads;
- MCP tools/resources;
- external CI systems;
- future hosted Visual Hive;
- LLM repair prompts;
- enterprise audit systems.

Without this packet, integrations will scrape logs and become brittle.

### MCP third

MCP should be added after the CLI/Evidence Packet are stable because it is the most natural agent-native interface. Agents increasingly discover tools dynamically, call tools, read resources, and use structured prompts. Visual Hive should expose those capabilities through MCP, but the MCP server should be a thin adapter over the core/CLI behavior, not the product’s foundation.

MCP should start **read-only by default**. Commands that execute tests, mutate files, update baselines, upload to providers, or hand off to Hive should require explicit enablement and should surface policy warnings.

### Hive issue handoff before direct Bead API

Hive is moving fast, and its internal API may evolve. GitHub issues are stable, auditable, and already fit enterprise review workflows. Therefore:

- **Phase 1:** trusted GitHub issue handoff with Hive labels.
- **Phase 2:** direct Hive Bead API handoff when explicitly configured.
- **Phase 3:** deeper Hive/Visual Hive cooperation around queue policy, agent specialization, and repair PRs.

Direct Bead API is valuable, but it should not be the only path.

### HTTP API later

The HTTP API should support the Control Plane and future hosted/GitHub App usage. It should not be the initial required integration path for agents because local agents and CI can operate more safely through the CLI and artifacts. The HTTP API becomes important when Visual Hive needs multi-repo dashboards, remote artifact ingestion, repo connection management, org policies, and enterprise access control.

---

## Integration surfaces

## 1. CLI: canonical execution surface

Every meaningful Visual Hive operation should be available through a stable CLI.

Required command posture:

```bash
visual-hive doctor --json
visual-hive recommend --json
visual-hive init --profile free-local
visual-hive validate --json
visual-hive plan --mode pr --json
visual-hive run --mode pr --json
visual-hive mutate --json
visual-hive triage --json
visual-hive report --json
visual-hive evidence build --json
visual-hive handoff hive --mode dry-run --json
visual-hive handoff github-issue --dry-run --json
visual-hive mcp --stdio
visual-hive serve --api --port 8787
```

CLI design requirements:

- every command supports `--json` where useful;
- all JSON is schema-versioned;
- exit codes are stable and documented;
- no paid provider call by default;
- no LLM call by default;
- no secret value is printed;
- PR mode refuses protected targets unless explicitly allowed in a trusted lane;
- all commands write deterministic artifacts under `.visual-hive/`;
- every failure includes a reproduction command;
- commands should be safe for agents to call repeatedly.

Suggested exit codes:

| Code | Meaning |
| --- | --- |
| `0` | success / no failing contracts |
| `1` | deterministic test failure |
| `2` | config/schema validation failure |
| `3` | target startup/environment failure |
| `4` | protected target or secret policy violation |
| `5` | provider/LLM policy violation |
| `6` | mutation score below threshold |
| `7` | internal Visual Hive error |

---

## 2. Evidence Packet: stable machine contract

The Evidence Packet should be the canonical artifact consumed by every downstream integration.

Path:

```text
.visual-hive/evidence-packet.json
```

Minimum structure:

```json
{
  "schemaVersion": "visual-hive.evidence.v1",
  "source": {
    "tool": "visual-hive",
    "version": "0.3.0",
    "repo": "owner/repo",
    "commit": "abc123",
    "branch": "feature/x",
    "mode": "pr",
    "runId": "github-actions-run-id"
  },
  "plan": {
    "selectedContracts": [],
    "skippedContracts": [],
    "selectedTargets": [],
    "skippedTargets": []
  },
  "deterministicResults": {
    "status": "failed",
    "contracts": [],
    "visualDiffs": [],
    "selectorFailures": [],
    "consoleErrors": [],
    "pageErrors": [],
    "networkErrors": []
  },
  "mutationResults": {
    "status": "failed",
    "score": 0.75,
    "killed": [],
    "survived": []
  },
  "safety": {
    "prSafe": true,
    "secretsUsed": false,
    "protectedTargetsSkipped": true,
    "externalUploads": [],
    "llmCalls": []
  },
  "artifacts": [],
  "repairGuidance": {
    "classification": "login_regression",
    "suggestedFiles": [],
    "reproductionCommands": [],
    "agentPromptPath": ".visual-hive/repair-prompt.md"
  }
}
```

The Evidence Packet must be sanitized enough to pass to agents and issue trackers. If a raw artifact is not safe, the packet should include a redacted version and mark the raw artifact as local-only.

---

## 3. Handoff Packet: agent queue contract

The Handoff Packet should be a smaller, task-oriented object derived from the Evidence Packet.

Path:

```text
.visual-hive/handoff.json
```

Purpose:

- create GitHub issues;
- create Hive Beads;
- feed agent queues;
- generate repair prompts;
- dedupe repeated failures;
- preserve audit metadata.

Suggested structure:

```json
{
  "schemaVersion": "visual-hive.handoff.v1",
  "kind": "visual-regression-finding",
  "title": "Visual Hive: login control appeared on public demo",
  "priority": 1,
  "severity": "critical",
  "type": "bug",
  "externalRef": "visual-hive://owner/repo/commit/abc123/signature/login-public-demo",
  "dedupeSignature": "sha256:...",
  "labels": ["visual-hive", "hive/quality", "ai-ready", "needs-test"],
  "summary": "The public demo rendered login controls that should not be visible.",
  "evidencePacketPath": ".visual-hive/evidence-packet.json",
  "issueBodyPath": ".visual-hive/hive-issue.md",
  "repairPromptPath": ".visual-hive/repair-prompt.md",
  "reproductionCommands": [],
  "metadata": {
    "visual_hive_schema": "visual-hive.handoff.v1",
    "repo": "owner/repo",
    "commit": "abc123",
    "mode": "schedule",
    "classification": "login_regression",
    "mutation_score": "0.75"
  }
}
```

Metadata values should be strings when targeting Hive Bead API compatibility.

---

## 4. MCP server: agent-native interface

Visual Hive should include a local MCP server once the CLI/artifact contracts are stable.

Command:

```bash
visual-hive mcp --stdio
```

Optional later remote mode:

```bash
visual-hive mcp --http --port 8788
```

### MCP principles

- The MCP server is an adapter over Visual Hive core.
- Read-only tools are enabled by default.
- Write/execution tools require explicit flags.
- Dangerous actions require policy checks and clear responses.
- Tool descriptions must be compact, specific, and hard to misuse.
- Every tool returns structured JSON and a concise human summary.
- Agents should be told to prefer JSON outputs and reproduction commands.

### Initial MCP resources

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

### Initial MCP tools

Read-only/default:

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

Execution tools, disabled unless explicitly enabled:

```text
visual_hive_run
visual_hive_mutate
visual_hive_update_baseline
visual_hive_handoff_github_issue
visual_hive_handoff_hive_bead
visual_hive_provider_upload
```

### MCP prompts

```text
visual_hive_repair_failure_prompt
visual_hive_add_missing_contract_prompt
visual_hive_review_mutation_survivor_prompt
visual_hive_stabilize_flake_prompt
visual_hive_kubestellar_console_prompt
```

### MCP safety flags

```bash
visual-hive mcp --stdio \
  --repo . \
  --allow-run=false \
  --allow-mutate=false \
  --allow-baseline-write=false \
  --allow-provider-upload=false \
  --allow-handoff=false
```

For local trusted work:

```bash
visual-hive mcp --stdio \
  --repo . \
  --allow-run \
  --allow-mutate \
  --allow-handoff=dry-run
```

---

## 5. HTTP API / Control Plane API

The HTTP API should be introduced when the UI and future hosted mode need a stable backend.

Command:

```bash
visual-hive serve --api --port 8787
```

Initial routes:

```text
GET  /api/version
GET  /api/config
POST /api/config/validate
POST /api/recommend
POST /api/plan
POST /api/run
POST /api/mutate
POST /api/triage
POST /api/evidence/build
GET  /api/evidence/latest
GET  /api/report/latest
GET  /api/artifacts
POST /api/handoff/hive/dry-run
POST /api/handoff/hive/bead
POST /api/handoff/github-issue/dry-run
GET  /api/health
```

Production rules:

- local bind by default;
- no unauthenticated remote write mode;
- explicit `--host 0.0.0.0` required for remote exposure;
- bearer token or OAuth required for remote mode;
- audit log for every write/execution action;
- same policy engine as CLI/MCP.

---

## 6. Hive integration

Visual Hive and Hive should have a clean separation of duties.

```text
Visual Hive:
  plan visual/user-flow QA
  run deterministic checks
  measure mutation adequacy
  produce sanitized evidence
  classify failures
  generate repair-ready prompts
  hand off findings

Hive:
  govern agent queue
  assign work to quality/CI/security agents
  enforce ACMM level
  manage agent cadence and budgets
  open issues/PRs under policy
  preserve autonomy audit trail
```

### Recommended Hive integration modes

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

### Mode 1: dry run

Command:

```bash
visual-hive handoff hive --mode dry-run --json
```

Outputs:

```text
.visual-hive/handoff.json
.visual-hive/hive-issue.md
.visual-hive/hive-bead-request.json
.visual-hive/hive-handoff-result.json
```

Use this first. It proves the integration without creating external side effects.

### Mode 2: GitHub issue handoff

Command:

```bash
visual-hive handoff hive --mode github_issue --json
```

This should run only in a trusted workflow. It should:

1. read sanitized artifacts;
2. compute a dedupe signature;
3. create or update a GitHub issue;
4. attach labels like `visual-hive`, `hive/quality`, `ai-ready`;
5. include the repair prompt and reproduction commands;
6. avoid executing PR code.

This should be the default enterprise path because GitHub issues are stable, auditable, and compatible with Hive’s GitHub-centered workflow.

### Mode 3: direct Hive Bead API

Command:

```bash
visual-hive handoff hive --mode bead_api --json
```

Target API shape:

```bash
curl -X POST "$HIVE_DASHBOARD_URL/api/beads/quality" \
  -H "Authorization: Bearer $HIVE_DASHBOARD_TOKEN" \
  -H "Content-Type: application/json" \
  -d @.visual-hive/hive-bead-request.json
```

Request body:

```json
{
  "title": "Visual Hive: login control appeared on public demo",
  "type": "bug",
  "priority": 1,
  "external_ref": "visual-hive://owner/repo/commit/abc123/signature/login-public-demo",
  "metadata": {
    "source": "visual-hive",
    "schema": "visual-hive.handoff.v1",
    "repo": "owner/repo",
    "commit": "abc123",
    "classification": "login_regression",
    "severity": "critical",
    "issue_url": "https://github.com/owner/repo/issues/123",
    "evidence_artifact": ".visual-hive/evidence-packet.json"
  }
}
```

Bead API compatibility rules:

- `title` required;
- `type` defaults to `advisory` if omitted, but Visual Hive should set `bug`, `task`, or `advisory` explicitly;
- `priority` must be `0-4`;
- `external_ref` should be a stable dedupe/cross-reference string;
- metadata should be small, string-valued, and sanitized;
- Visual Hive should never put full logs, screenshots, secrets, or large JSON blobs into metadata.

---

## 7. GitHub Actions lanes for agent-forward use

### PR lane: safe measurement

```text
pull_request:
  visual-hive plan --mode pr --json
  visual-hive run --mode pr --json
  visual-hive evidence build --json
  upload .visual-hive artifacts
```

No secrets. No issue creation. No provider upload by default. No direct Hive Bead API.

### Scheduled/protected lane: deeper evidence

```text
schedule/workflow_dispatch:
  visual-hive plan --mode schedule --json
  visual-hive run --mode schedule --json
  visual-hive mutate --json
  visual-hive triage --json
  visual-hive evidence build --json
  visual-hive handoff hive --mode dry-run --json
```

May use protected targets and secrets if explicitly configured.

### Trusted issue/handoff lane

```text
workflow_run:
  download artifacts
  visual-hive evidence verify --json
  visual-hive handoff hive --mode github_issue --json
```

This lane does not checkout or execute untrusted PR code.

---

## Agent workflows Visual Hive should support

## Workflow A: setup agent

Goal: get Visual Hive installed correctly in a repo.

```bash
visual-hive doctor --json
visual-hive recommend --json
visual-hive init --profile free-local
visual-hive validate --json
visual-hive plan --mode pr --json
```

Agent output:

- config PR;
- workflow PR;
- docs update;
- list of protected targets to configure later;
- no paid provider enabled by default.

## Workflow B: test-generation agent

Goal: create missing visual/user-flow contracts.

```bash
visual-hive coverage --json
visual-hive mutate --json
visual-hive triage --json
```

Agent reads:

- mutation survivors;
- uncovered routes;
- selected/skipped contract reasons;
- repair prompt.

Agent writes:

- new contract definitions;
- selector/test-id improvements;
- deterministic Playwright expectations;
- docs explaining the contract.

## Workflow C: repair agent

Goal: fix a user-visible regression.

```bash
visual-hive report --json
visual-hive evidence show --json
visual-hive reproduce <finding-id>
```

Agent reads:

- failed contract;
- actual/baseline/diff artifact paths;
- console/page errors;
- changed files;
- reproduction commands;
- repair prompt.

Agent writes:

- app fix or test fix;
- new mutation coverage if the failure exposed weak tests;
- final verification output.

## Workflow D: Hive quality agent

Goal: consume Visual Hive Beads/issues and open hold-gated PRs.

Inputs:

- GitHub issue or Hive Bead;
- Evidence Packet;
- repair prompt;
- reproduction commands;
- relevant artifact links.

Expected agent behavior:

1. reproduce failure;
2. inspect suggested files;
3. fix app or test contract;
4. rerun exact Visual Hive command;
5. include before/after evidence in PR;
6. do not approve baselines silently;
7. leave PR hold-gated unless ACMM policy allows otherwise.

---

## Repo documentation that agents need

Add these files over time:

```text
AGENTS.md
.github/copilot-instructions.md
.github/instructions/visual-hive.instructions.md
docs/agents/visual-hive-agent-contract.md
docs/agents/visual-hive-repair-workflow.md
docs/agents/visual-hive-hive-integration.md
docs/schemas/evidence-packet.md
docs/schemas/handoff-packet.md
```

`AGENTS.md` should include this rule:

> When working on Visual Hive, treat agents as primary users. Do not add features that only work through a human dashboard. Every major capability must have a CLI/JSON path, stable artifacts, and safety rules before it is exposed through UI or hosted services.

---

## Prioritized roadmap update

### v0.3: agent-consumable core

- Stable `--json` output for `doctor`, `recommend`, `validate`, `plan`, `run`, `mutate`, `triage`.
- Evidence Packet schema and writer.
- Handoff Packet schema and dry-run writer.
- Agent docs in `AGENTS.md` and `docs/agents/*`.
- Trusted GitHub issue handoff design, not necessarily full automation.

### v0.4: Hive/GitHub handoff

- `visual-hive handoff hive --mode dry-run`.
- `visual-hive handoff hive --mode github_issue` for trusted workflows.
- Dedupe signatures.
- KubeStellar Console example that produces a Hive-ready issue from seeded visual regressions.
- Mocked Bead API tests.

### v0.5: MCP server

- `visual-hive mcp --stdio`.
- Read-only resources and tools.
- `visual_hive_plan`, `visual_hive_read_evidence_packet`, `visual_hive_generate_repair_prompt`.
- Optional run/mutate tools behind explicit flags.
- MCP safety docs and tests.

### v0.6: direct Hive Bead API

- `visual-hive handoff hive --mode bead_api`.
- token/env readiness checks;
- mock and integration tests;
- Bead API response artifact;
- fallback to GitHub issue mode if direct API is unavailable.

### v0.7+: Control Plane API / hosted path

- `visual-hive serve --api`.
- Local Control Plane reads same Evidence Packet.
- GitHub App/hosted ingestion later.
- Multi-repo agent queue visibility later.

---

## Product positioning language

Use this in docs:

> Visual Hive is agent-forward: every run produces structured evidence that coding agents can consume without scraping logs or guessing from screenshots. The CLI is the canonical execution interface, the Evidence Packet is the canonical data contract, MCP is the agent-native tool interface, and Hive/GitHub integrations are governed handoff layers. Visual Hive does not ask agents to decide whether UI behavior is correct; it gives agents deterministic, reproducible failures and asks them to repair or strengthen the system under policy.
