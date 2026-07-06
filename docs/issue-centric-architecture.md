# Issue-Centric Architecture

Visual Hive is moving toward an issue-centric production model. Issues are the contract between deterministic QA evidence and humans, Hive, or coding agents.

## Production Loop

1. Visual Hive runs tests, mutations, coverage analysis, repo mapping, and workflow safety checks.
2. Visual Hive emits deterministic artifacts: reports, Evidence Packet, Handoff Packet, Hive export, issue candidates, and issue queue.
3. A trusted workflow or GitHub App creates or updates GitHub issues from sanitized artifacts.
4. Hive or agents watch issues and act because an issue exists.
5. Agents may repair code/tests in their own governed workflow.
6. Visual Hive reruns and validates the result.
7. Issues are updated with persisted evidence, resolved-candidate evidence, or suppression state.

Visual Hive detects, proves, packages, and routes. Hive and agents solve.

## Issue Artifacts

Visual Hive writes:

- `.visual-hive/issues.json`
- `.visual-hive/issues.md`
- `.visual-hive/issue-queue.json`
- `.visual-hive/setup-issue.md`
- `.visual-hive/setup-issue-candidate.json`
- `.visual-hive/setup-issue-publish-plan.json`
- `.visual-hive/setup-issue-publish-dry-run.json`
- `.visual-hive/setup-issue-publish-result.json`
- `.visual-hive/issue-publish-plan.json`
- `.visual-hive/issue-publish-dry-run.json`
- `.visual-hive/issue-publish-result.json`

Each issue candidate includes kind, severity, status, dedupe fingerprint, labels, owner hint, body, affected surfaces, reproduction command, validation command, linked artifacts, and guardrails.

Issue publishing can be scoped before any live create/update decision:

```bash
visual-hive issues publish --dry-run --kind mutation_survivor
visual-hive issues publish --live --repo owner/repo --dedupe visual-hive:mutation_survivor:abc123
visual-hive issues publish --live --repo owner/repo --kind missing_visual_coverage --limit 1
```

Use scoped live publishing for trusted smoke tests or staged rollout. Publishing the entire queue is allowed only when the repository intentionally wants every ready candidate routed as an issue.

## Queue States

- `ready_for_hive`: issue candidates ready for Hive/human routing.
- `ready_for_visual_hive_agent`: candidates with enough local evidence for a bounded issue-agent request.
- `blocked_policy`: candidates blocked by policy.
- `blocked_missing_artifact`: candidates missing required evidence.
- `resolved_candidate`: findings that disappeared after rerun.
- `suppressed`: findings suppressed by `.visual-hive/issue-suppressions.json`.

Resolved candidates are not automatically closed by default. They are evidence for a trusted workflow or human reviewer to close/update the issue.

## Agent Boundary

Visual Hive can create no-write issue-agent artifacts:

```bash
visual-hive issues --write
visual-hive agent issue-runner --issue-index 0
```

Default issue-agent artifacts are recommendation-only. They do not edit source, create branches, open PRs, create GitHub issues, call Hive APIs, call LLMs, call paid providers, or use external network.

Visual Hive can also run a configured local issue-agent command, but only when explicitly requested:

```bash
visual-hive agent issue-runner \
  --issue-index 0 \
  --execute-agent \
  --agent-command node \
  --agent-arg scripts/local-issue-agent.mjs
```

This guarded execution path passes the issue request through stdin and sets `VISUAL_HIVE_AGENT_*` environment variables for the command. It records sanitized stdout/stderr in `.visual-hive/agents/<dedupe>/agent-output.md` and `.visual-hive/agents/<dedupe>/agent-run.json`. The command is timeout-bounded, uses a minimal environment, and remains no-network by default.

Codex/OpenAI agent execution is intentionally stricter:

- Visual Hive runs bounded `--help` discovery first.
- Visual Hive does not guess Codex CLI flags.
- `codex`/`openai` commands are blocked unless external network is explicitly allowed and explicit agent args are provided.
- If the configured Codex binary is unavailable or cannot start, Visual Hive records a blocked `agent-run.json` with the exact sanitized error and keeps source mutation, branch, PR, issue, Hive API, LLM, provider, external-call, and network counters at zero.
- Even when enabled, Visual Hive records the agent evidence; it does not become the pass/fail authority.

Write-capable repair belongs in a trusted Hive/agent workflow, not in the default Visual Hive local path. `--allow-write` only records a write-preview budget for the agent request.

Visual Hive can now create a guarded local write-preview branch artifact without opening a PR:

```bash
visual-hive agent write-preview --issue-index 0
visual-hive agent write-preview --issue-index 0 --allow-write --write-preview-branch
```

The first command is a dry-run plan only. The second command requires an explicit clean working tree, creates a local branch named from the issue fingerprint, writes `.visual-hive/agents/<dedupe>/write-preview.json`, and still does not push, commit, open a PR, create an issue, approve baselines, call Hive, call LLMs, or call providers by default.

## Setup Issue Workflow

Connection/setup is issue-centric too:

```bash
visual-hive analyze --repo .
visual-hive recommend --repo .
visual-hive issues --write
visual-hive issues setup-publish --dry-run
```

`visual-hive issues setup-publish` converts `.visual-hive/setup-issue.md` into a synthetic `setup_needed` issue candidate, then writes the same publish-plan, dry-run, and result evidence used by normal issue publishing. The default mode makes zero network calls and creates zero GitHub issues.

Live setup issue creation is guarded by the same policy as other issue publishing:

- trusted workflow only,
- sanitized artifact input,
- explicit live guard environment variable,
- no PR code checkout,
- no source repair,
- no baseline approval.

The setup issue is intended to trigger a human or setup agent to create/review config and workflow changes. Visual Hive remains the detector and evidence router.

## Why Issues First

Issues provide durable review, dedupe, ownership, labels, lifecycle, and integration with existing project governance. They are also a safer handoff point for agent systems because the deterministic evidence is already packaged and policy-gated before an agent acts.

Mutation survivors are especially valuable issue inputs: they prove a test suite failed to detect an intentional product break, which is stronger than a generic request to add coverage.
