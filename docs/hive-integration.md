# Hive Integration

Visual Hive is the deterministic visual/UI QA capability that Hive can consume. Hive owns setup, product shell, ACMM governance, bead lifecycle, GitHub App behavior, and agent orchestration. Visual Hive owns evidence generation, verdicts, validation commands, issue candidates, and no-network Hive export bundles.

## Default Safety Model

- Local/default Visual Hive commands create zero real GitHub issues.
- PR workflows stay read-only, secret-free, and do not use `pull_request_target`.
- Hive, LLM, provider, and agent calls are disabled by default.
- Visual Hive never repairs code, opens PRs, auto-approves baselines, or weakens thresholds.
- Hive-facing paths are repo-relative or redacted.
- Agents consume evidence and may recommend/act under Hive governance, but do not decide Visual Hive pass/fail.

## Artifact Contract

Visual Hive inputs for Hive export:

- `.visual-hive/report.json`
- `.visual-hive/evidence-packet.json`
- `.visual-hive/visual-graph.json`
- `.visual-hive/visual-impact.json`
- `.visual-hive/mutation-report.json`
- `.visual-hive/issues.json`
- `.visual-hive/issue-queue.json`
- `.visual-hive/handoff.json`
- `.visual-hive/capability-parity.json`
- `.visual-hive/artifacts-index.json`
- `.visual-hive/agent-packet.json` when available
- `.visual-hive/path-leak-scan.json` when available

Hive-facing outputs:

- `.visual-hive/hive/hive-export.json`
- `.visual-hive/hive/hive-beads.json`
- `.visual-hive/hive/hive-import-manifest.json`
- `.visual-hive/hive/hive-agent-work-orders.json`
- `.visual-hive/hive/hive-validation-summary.json`
- `.visual-hive/hive/hive-setup-pack.json`
- `.visual-hive/hive/hive-setup-pack.md`
- `.visual-hive/bundles/<bundle-id>/manifest.json` plus immutable copied files

Legacy compatibility outputs such as `.visual-hive/hive/beads.json` remain available for existing Visual Hive consumers.

## CLI

```bash
visual-hive hive export --config visual-hive.config.yaml --dry-run
visual-hive hive beads --config visual-hive.config.yaml
visual-hive hive validate-export --config visual-hive.config.yaml
visual-hive hive setup-pack --config visual-hive.config.yaml
visual-hive hive integration-smoke --config visual-hive.config.yaml
visual-hive hive bundle --config visual-hive.config.yaml
```

`integration-smoke` runs export, bead projection, validation, and setup-pack generation locally with `externalCallsMade: 0`.

`hive bundle` is the trust boundary. The writer emits `visual-hive.bundle.v3` and retains verification support for existing v2 manifests. Before creating a temporary bundle, it requires a passing `.visual-hive/capability-parity.json` receipt and a complete content-addressed `.visual-hive/artifacts-index.json`. It strictly enumerates the indexed evidence root, rejects unlisted or non-regular entries and linked path components, reads each accepted file once from a stable handle, and writes those exact bytes into a private directory before atomic publication. Every compact import file must match an index entry; the receipt and index are always copied into the bundle and bound into its aggregate digest.

The v3 manifest also requires immutable hosted source-artifact identity. Canonical generation and expiry timestamps, repository, commit, workflow name, workflow run ID, workflow run attempt, workflow artifact ID, event, conclusion, and the producer trust claim are bound into the digest; the run attempt is also part of replay identity. Expiry must be later than generation. Hive can therefore download the complete source artifact named by that identity and verify its exact path, byte-size, and SHA-256 set against the bundled index without copying every large evidence file into the compact handoff bundle. Standalone local `hive bundle` remains available and emits a verifiable v2 bundle when no hosted identity is present. `--trusted-source` may retain a local operator trust claim on that v2 manifest, but the claim remains advisory and does not invent hosted provenance. Any hosted event or partial hosted identity fails closed unless the complete v3 identity is available.

Bundle producer version and commit come from the installed Visual Hive package identity or the adjacent immutable release manifest. Consumer npm metadata and working-directory package versions cannot replace that producer identity. Hosted v3 publication also requires that identity to carry explicit `release: true` and `clean: true` markers created from an exact 40-character clean HEAD; missing, legacy, unavailable, or developer-build identity remains usable for local v2 but cannot confer hosted authority. Package and release-bundle construction reject staged, unstaged, relevant untracked, or environment-SHA-mismatched source state before emitting those markers. Likewise, automatic schema discovery validates and prefers the catalog shipped beside the installed CLI; an unrelated repository-level `schemas/` directory cannot shadow it.

## ACMM Compatibility

| ACMM level | Visual Hive behavior | Hive behavior |
| --- | --- | --- |
| L1 Assisted | advisory evidence only | human imports/reviews |
| L2 Instructed | bead projections are generated | trusted/manual import |
| L3 Measured | sanitized issue/bead evidence | trusted workflow may publish/update |
| L4 Adaptive | validation commands and agent work orders | agents can prepare governed changes |
| L5 Semi-Automated | rerun Visual Hive required after repair | larger holdgated repairs possible |
| L6 Fully Autonomous | deterministic verdict remains Visual Hive-owned | Hive may merge only if policy allows and validation is green |

Visual Hive itself does not repair, push, open PRs, merge, or call Hive by default at any level.

## MCP Resources

Hive agents should use read-only MCP resources/tools:

- `visual-hive://hive-export`
- `visual-hive://hive-beads`
- `visual-hive://hive-import-manifest`
- `visual-hive://hive-agent-work-orders`
- `visual-hive://hive-setup-pack`

Preferred read-only tools for Hive agents:

- `visual_hive_get_hive_export`
- `visual_hive_list_hive_beads`
- `visual_hive_get_hive_bead_context`
- `visual_hive_get_hive_setup_pack`
- `visual_hive_get_hive_agent_work_order`
- `visual_hive_validate_hive_export`

Execution/write tools remain disabled in the default MCP surface.

## One Setup Flow

1. User installs Hive GitHub App or starts Hive local/server mode.
2. User enables Visual QA.
3. Hive creates a setup issue.
4. Hive creates a reviewed setup PR.
5. Setup PR adds Visual Hive config and workflows.
6. PR workflow runs Visual Hive read-only checks.
7. Scheduled workflow runs deeper mutation/canary checks.
8. Trusted workflow finalizes a digested bundle and imports it with `hive visual import apply --bundle <manifest> --beads-dir <dir>`.
9. Hive dashboard shows Visual QA beads/findings.
10. Hive agents act under ACMM.
11. Visual Hive reruns validation before resolution.
