# Hive Handoff Policy

Visual Hive handoff is evidence-first and no-network by default.

Required order:

```text
 plan -> run -> mutate/triage -> evidence -> handoff dry-run -> hive export dry-run -> guarded repair preview -> repair request envelope -> trusted repair consumer summary -> trusted repair workflow dry-run -> trusted issue/Hive workflow
```

The local command is:

```bash
visual-hive handoff --dry-run
visual-hive hive export --dry-run
visual-hive hive guarded-repair-preview
visual-hive hive repair-request-envelope
visual-hive hive trusted-repair-consumer-summary
visual-hive hive trusted-repair-workflow-dry-run
visual-hive hive compare-modes
```

It requires `.visual-hive/evidence-packet.json` and writes:

- `.visual-hive/handoff.json`
- `.visual-hive/hive-issue.md`
- `.visual-hive/hive-bead-request.json`
- `.visual-hive/hive-handoff-result.json`
- `.visual-hive/hive/hive-export.json`
- `.visual-hive/hive/beads.json`
- `.visual-hive/hive/knowledge-facts.json`
- `.visual-hive/hive/knowledge-graph.json`
- `.visual-hive/hive/issue-context.md`
- `.visual-hive/hive/repair-work-orders.json`
- `.visual-hive/hive/hive-agent-policy.json`
- `.visual-hive/hive/guarded-repair-preview.json`
- `.visual-hive/hive/guarded-repair-preview.md`
- `.visual-hive/hive/repair-request-envelope.json`
- `.visual-hive/hive/repair-request-envelope.md`
- `.visual-hive/hive/trusted-repair-consumer-summary.json`
- `.visual-hive/hive/trusted-repair-consumer-summary.md`
- `.visual-hive/hive/trusted-repair-workflow-dry-run.json`
- `.visual-hive/hive/trusted-repair-workflow-dry-run.md`
- `.visual-hive/hive/mode-comparison.json`
- `.visual-hive/hive/mode-comparison.md`
- `.visual-hive/hive/modes/advisory/**`
- `.visual-hive/hive/modes/measured/**`
- `.visual-hive/hive/modes/repair_request/**`
- `.visual-hive/hive/modes/guarded_repair/**`
- `.visual-hive/hive/modes/full/**`
- `.visual-hive/hive/wiki/*.md`

Validate the dry-run package before trusted workflow consumption:

```bash
visual-hive handoff-validate --config visual-hive.config.yaml
```

This writes `.visual-hive/hive-handoff-validation.json`. The validator checks that the Evidence Packet, Handoff Packet, Hive bead request, Hive issue body, and handoff result are present, schema-versioned, internally consistent, sanitized, and still no-network (`externalCallsMade: 0`). It also checks the Evidence Packet's Hive readiness policy before a trusted workflow consumes artifacts: all governed modes must be represented, `full` must not be the recommended mode, `full` automation must remain blocked, and `guarded_repair` must remain blocked or trusted-only until explicit trusted policy exists.

When Hive-native repair-chain artifacts are present, `handoff-validate` also validates them as a complete no-network chain: Hive export, guarded repair preview, repair request envelope, trusted repair consumer summary, and trusted repair workflow dry-run. It verifies schema versions, source-artifact continuity, `externalCallsMade: 0`, dry-run consumer policy, all-false current action flags, and no checkout/branch/PR/issue/Hive/provider/Visual-Hive-rerun behavior. Missing repair-chain artifacts do not block early advisory validation; present repair-chain artifacts must be structurally safe before a trusted workflow consumes them.

The Handoff Packet converts evidence into bounded work items:

- deterministic failures become `repair` tasks;
- blocked evidence collection becomes `setup` tasks;
- mutation survivors become `test_creation` tasks;
- missing, unknown, or partial testing layers become setup, test-creation, or review tasks depending on the layer.

This keeps Hive and coding agents focused on concrete evidence gaps instead of raw logs or broad repository context.

The Hive-native export expands that compact packet into artifacts that Hive can use directly:

- `beads.json` mirrors Hive's bead/work-item shape for quality, CI-maintainer, and security actors;
- `knowledge-facts.json` and `wiki/*.md` preserve regressions, gotchas, integration facts, coverage rules, and test scaffolds;
- `knowledge-graph.json` links evidence, facts, beads, and repair work orders with `derived_from`, `depends_on`, and `related_to` edges;
- `repair-work-orders.json` tells a trusted Hive repair lane what to fix, which artifacts to inspect, and how Visual Hive must re-verify the result.
- `guarded-repair-preview.json` is a preview-only repair gate over the work orders and agent policy. It performs no repair, calls no Hive API, and records whether every work order is PR-only, branch-isolated, bounded, reviewable, forbidden from deciding the Visual Hive verdict, and required to rerun Visual Hive.
- `repair-request-envelope.json` packages a ready or blocked guarded repair preview into a trusted-workflow request. It includes branch names, labels, dedupe keys, required commands, acceptance criteria, blocked reasons, and no-network/verdict-authority policy. It performs no repair, creates no branch, opens no PR, creates no issue, and calls no Hive API.
- `trusted-repair-consumer-summary.json` is a no-network dry-run consumer over the repair request envelope. It previews whether a trusted workflow could start, which repair requests are ready or blocked, and which branches/PRs a future trusted workflow would create. It performs no checkout, repair, branch creation, PR creation, issue creation, Hive API call, provider call, or Visual Hive rerun.
- `trusted-repair-workflow-dry-run.json` is a no-network future workflow plan over the trusted repair consumer summary. It lists artifact validation, trusted checkout, future branch creation, bounded Hive repair-agent, final validation, and future pull request steps as planned or blocked actions. It performs no checkout, repair, branch creation, PR creation, issue creation, Hive API call, provider call, or Visual Hive rerun.

`hive-export.json` also includes `outputResources`, a catalog-backed view over the split Hive JSON artifacts. Each entry connects the actual output path to the shared Visual Hive evidence-resource ID, URI, title, description, and read-only MCP tool name. The repair-chain artifacts and mode comparison each include their own `outputResource` field for the same reason. Hive agents and trusted workflow consumers should prefer those resource identities over path guessing when they need focused beads, facts, graph, work-order, policy, guarded-repair, request-envelope, trusted-consumer, workflow-dry-run, or mode-comparison evidence.

`visual-hive hive compare-modes` writes a no-network comparison bundle that previews all five Hive integration levels side by side:

- `advisory`: sanitized issue context and policy only.
- `measured`: advisory output plus Beads, knowledge facts, wiki pages, and graph edges.
- `repair_request`: measured output plus bounded repair work orders for a trusted Hive lane.
- `guarded_repair`: blocked unless Hive and repair policy are explicitly enabled in a trusted workflow with high maturity.
- `full`: reserved for future ACMM L6-compatible automation and blocked locally.

The comparison writes `.visual-hive/hive/mode-comparison.json` and `.visual-hive/hive/mode-comparison.md`, plus per-mode preview directories under `.visual-hive/hive/modes/`. It must keep `externalCallsMade: 0`. The purpose is to let humans and agents inspect the tradeoff between explanation, knowledge-graph enrichment, bounded repair requests, and blocked future automation states before any real Hive API call is introduced.

A `blocked` guarded-repair preview is a valid safe artifact state. It means Visual Hive generated repair-policy evidence but refused to represent the current export as repair-ready until the missing branch, review, rerun, work-order, or governance requirements are satisfied.

Policy:

- Visual Hive's deterministic Verdict Engine owns pass/fail.
- Hive, LLMs, MCP tools, and agents may advise, route, or repair under policy, but they do not own the Visual Hive verdict.
- Dry-run handoff makes `externalCallsMade: 0`.
- GitHub issue creation requires a trusted workflow that consumes sanitized artifacts.
- Hive Bead creation requires human/trusted-workflow approval.
- Hive repair requires a trusted workflow, a branch or pull request, human review unless explicitly governed otherwise, and a fresh passing Visual Hive rerun.
- PR workflows must not use `pull_request_target` to execute untrusted code.
- Secret values must never appear in handoff JSON or Markdown.
- Missing secret names may be reported when useful for trusted setup.

Trusted workflow templates:

- `.github/workflows/visual-hive-failure-issue.yml` consumes `.visual-hive/issue.md` from uploaded artifacts and may create or update GitHub issues.
- `.github/workflows/visual-hive-hive-handoff.yml` consumes `.visual-hive/evidence-packet.json`, `.visual-hive/handoff.json`, `.visual-hive/hive-bead-request.json`, `.visual-hive/hive-handoff-result.json`, `.visual-hive/hive-handoff-validation.json`, `.visual-hive/hive/hive-export.json`, `.visual-hive/hive/guarded-repair-preview.json`, `.visual-hive/hive/repair-request-envelope.json`, `.visual-hive/hive/trusted-repair-consumer-summary.json`, `.visual-hive/hive/trusted-repair-workflow-dry-run.json`, and `.visual-hive/hive-issue.md`.
- `.visual-hive/hive-handoff-validation.json` is the local preflight evidence that the trusted workflow handoff package is structurally safe to consume.

The Hive handoff workflow is intentionally artifact-only:

- it uses `workflow_run`, not `pull_request_target`;
- it does not checkout or execute PR code;
- it downloads the `visual-hive` artifact produced by a prior run;
- it re-redacts secret-like values before writing the step summary;
- it expects dry-run artifacts with `externalCallsMade: 0`;
- it verifies Hive-native export, guarded repair preview, repair request envelope, trusted repair consumer summary, and trusted repair workflow dry-run schema versions;
- it verifies the guarded repair preview remains preview-only, no-network, and under Visual Hive verdict authority;
- it verifies the repair request envelope remains trusted-workflow-only, no-network, non-executing, and under Visual Hive verdict authority;
- it verifies the trusted repair consumer summary remains dry-run-only, no-network, no-checkout, no-branch, no-PR, no-issue, no-provider-call, no-Hive-call, no-Visual-Hive-rerun, and under Visual Hive verdict authority;
- it verifies the trusted repair workflow dry-run remains dry-run-only, no-network, no-checkout, no-write, no-provider-call, no-Hive-call, no-Visual-Hive-rerun, and under Visual Hive verdict authority;
- it refuses artifacts with missing Hive readiness policy, recommended `full` automation, unblocked `full` automation, or unrestricted `guarded_repair`;
- it runs issue creation only for failed upstream Visual Hive workflows by default;
- it refuses issue creation when `hive-handoff-validation.json` is blocked or missing;
- it creates or updates a deduped GitHub issue from sanitized `hive-issue.md` only after validation is not blocked;
- it leaves the real Hive Bead API call as a future trusted insertion point, not a default behavior.

Default config:

```yaml
integrations:
  hive:
    enabled: false
    mode: advisory
    acmmLevel: 3
    defaultActor: quality
    labels:
      - visual-hive
      - hive/quality
      - ai-ready
    export:
      beads: true
      knowledgeFacts: true
      knowledgeGraph: true
      wikiVault: true
      repairWorkOrders: true
      maxFacts: 50
    repair:
      enabled: false
      prOnly: true
      maxAttempts: 1
      requireHumanReview: true
      rerunVisualHive: true
      branchPrefix: hive/visual-hive-
    beadApi:
      url: https://hive.example.invalid/api/beads
      tokenEnv: HIVE_DASHBOARD_TOKEN
      agent: quality
```

Hive modes:

- `advisory`: issue-context only, no beads/facts/repair orders.
- `measured`: emits beads, project knowledge facts, wiki pages, and graph data.
- `repair_request`: emits guarded repair work orders for a trusted Hive lane.
- `guarded_repair`: allows Hive to open a repair branch/PR when trusted policy permits; Visual Hive must pass afterward.
- `full`: reserved for future ACMM L6-compatible automation and blocked locally for now.

The Evidence Packet exposes this same mode policy before export through `hiveReadiness.recommendedMode`, `recommendationReason`, and `modeReadiness[]`. That lets the Control Plane, agents, and trusted workflows see whether each mode is `ready`, `blocked`, or `trusted_only` without enabling external Hive calls or giving Hive verdict authority.

Legacy `dry_run`, `github_issue`, and `bead_api` config values remain accepted for existing repos and map back to safe no-network local behavior.

The bead request records only trusted-setup metadata: configured mode, optional bead API URL with secret-like query values redacted, token environment variable name, whether that environment variable was present, and the agent name. It never records the token value.

Future `github_issue` and `bead_api` modes should remain trusted-lane only. They must consume the Evidence Packet or Handoff Packet and must not scrape raw CI logs as their source of truth.
