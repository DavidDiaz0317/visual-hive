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

`hive bundle` is the trust boundary. It refuses blocked validation, copies every import artifact into a temporary directory, records per-file and aggregate SHA-256 digests, then atomically renames the completed bundle. Trusted GitHub workflows pass `--trusted-source`; local proofs omit it and Hive must explicitly opt into `--allow-local`.

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
