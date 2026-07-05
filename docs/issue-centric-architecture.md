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
- `.visual-hive/issue-publish-plan.json`
- `.visual-hive/issue-publish-dry-run.json`
- `.visual-hive/issue-publish-result.json`

Each issue candidate includes kind, severity, status, dedupe fingerprint, labels, owner hint, body, affected surfaces, reproduction command, validation command, linked artifacts, and guardrails.

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

Write-capable repair belongs in a trusted Hive/agent workflow, not in the default Visual Hive local path.

## Why Issues First

Issues provide durable review, dedupe, ownership, labels, lifecycle, and integration with existing project governance. They are also a safer handoff point for agent systems because the deterministic evidence is already packaged and policy-gated before an agent acts.

Mutation survivors are especially valuable issue inputs: they prove a test suite failed to detect an intentional product break, which is stronger than a generic request to add coverage.
