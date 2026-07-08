# Hive Integration Current State

Generated during the Visual Hive -> Hive readiness pass.

## Repository State

| Repo | Workspace label | Branch | SHA | Notes |
| --- | --- | --- | --- | --- |
| Visual Hive | `[local-visual-hive]` | `main` | `1c2d50ab2545e79f87b01f77d9d2cc8ae2688a2b` | Product repo inspected locally. |
| visual-hive-demo-site | `[local-demo-site]` | `main` | `cdbe7623c997bf6be7690de68f361d3739550974` | Canonical external client repo inspected locally. |
| Hive | `[local-hive-clone]` | `visual-hive-integration` | `23501bc1895e718414bf45be0c65e0161ef39385` | Local clone of `kubestellar/hive`; no upstream push. |

## Hive Integration Anchors

- Beads are implemented in Hive v2 under `v2/pkg/beads/` and stored in the configured data directory, with deployment examples under `v2/deploy/data/beads/<agent>/beads.json`.
- ACMM/governance is represented by `v2/docs/acmm-policy-matrix.md`, config packs under `v2/pkg/config/packs/level-*.yaml`, and dashboard/API support around `v2/pkg/dashboard/api_acmm_eval.go`.
- Hive dashboard/API routes live under `v2/pkg/dashboard/` and static dashboard assets live under `v2/pkg/dashboard/static/`.
- Hive Hub/server routes live under `v2/pkg/hub/`, including `v2/pkg/hub/static/openapi.yaml`.
- GitHub App/integration code lives under `v2/pkg/github/`.
- Knowledge graph/wiki storage lives under `v2/pkg/knowledge/` and `v2/deploy/data/wiki/`.

## Natural Import Boundary

Visual Hive should generate the importable evidence bundle. Hive should own importing that bundle into beads, dashboard state, issue lifecycle, and agent orchestration.

The minimal Hive-side bridge naturally fits under `v2/pkg/visualhive/`:

- parse `.visual-hive/hive/hive-export.json`
- parse `.visual-hive/hive/hive-beads.json`
- validate `.visual-hive/hive/hive-import-manifest.json`
- reject path leaks and secret markers
- dedupe beads by `external_ref` / `visual_hive_dedupe_fingerprint`

## Visual Hive Responsibilities

- Run deterministic visual/UI QA.
- Produce Evidence Packet, Visual Graph, Visual Impact, issues, handoff, and artifact index.
- Project issue candidates into Hive bead-compatible work items.
- Generate Hive import manifest, setup pack, validation summary, and agent work orders.
- Keep default/local paths no-network and no-write.

## Hive Responsibilities

- Provide product shell, onboarding, ACMM policy, bead storage, GitHub App, issue/PR lifecycle, dashboard, and agent orchestration.
- Consume Visual Hive evidence only from sanitized artifacts.
- Decide when trusted workflows import artifacts into beads/issues.
- Govern any repair agents; Visual Hive remains a validation/verdict layer, not the repair actor.
