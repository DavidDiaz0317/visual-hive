# Current Product Readiness State

Date: 2026-07-07

This is an engineering readiness note for the production-like Visual Hive installation work. It is not a presentation report.

## Canonical Branches

| Repo | Canonical branch | Current SHA | Notes |
| --- | --- | --- | --- |
| `DavidDiaz0317/visual-hive` | `main` | `1dd39a97bfaa52b1e614bca5d1fe91bea6047f97` | `main` is the current product branch. The older `codex/control-plane-guided-cockpit` branch is historical only and must not be used by active workflows. |
| `DavidDiaz0317/visual-hive-demo-site` | `main` | `92aec709fb17bb20ca154afd71669567779cf2d6` | Demo-site is the canonical external client installation. |

## Current Verified State

- Product `CI` passed on `main` run `28861431167` for commit `1dd39a9`.
- Product `Product Proof` passed on `main` run `28861431149` for commit `1dd39a9`.
- Product `npm audit --workspaces` reports `found 0 vulnerabilities`.
- Demo-site `Visual Hive Production Smoke` passed on `main` run `28862783105`.
- Demo-site `Visual Hive Scheduled` passed on `main` workflow-dispatch run `28862904560` after scheduled-chain artifact prerequisite cleanup.
- Demo-site `Visual Hive Trusted Publisher` passed on `main` run `28863088358`.
- Demo-site PR workflow now captures the actual pull request diff into `.visual-hive/changed-files.pr.txt`, plans from that file, emits Visual Graph/Impact artifacts, and handles docs-only PRs as planning-only evidence without running deterministic contracts.
- Demo-site local resolver now chooses the newest built sibling checkout when both `../visual-hive` and `../vis-hive` exist, avoiding stale local tooling.
- Demo-site issue #6 is open, deduped, marked `visual-hive/resolved-candidate`, and contains no local absolute path leaks.
- Evidence-facing artifacts now sanitize repo-local screenshot/spec paths to `.visual-hive/...` in Evidence Packets, Visual Graph/Vocab/Impact, Agent Packets, Control Plane snapshots, and Artifact Index previews.

## Stale Reference Cleanup

- Product `product-proof.yml` runs on pushes to `main` and `workflow_dispatch`.
- Demo-site Visual Hive workflows check out `DavidDiaz0317/visual-hive@main` in CI.
- The only remaining references to older Codex branch names are historical notes in readiness documentation or untracked local proof artifacts.

## Current Product Boundary

Visual Hive detects, proves, packages, routes, and validates visual/UI quality issues. It does not repair code by default. GitHub Issues are the durable work queue. Visual Hive artifacts and MCP are the structured evidence layer. Hive/Codex/agents act from issues under governance, and Visual Hive reruns deterministic validation afterward.

## Live-Credential Boundary

The local/default path remains no-network:

- no real GitHub issue creation;
- no Hive API calls;
- no LLM calls;
- no provider uploads;
- no branch/PR creation;
- no source mutation.

Live GitHub issue publishing and GitHub App operation require explicit trusted workflow or local live-smoke guards.

## Current Cleanup Focus

The latest hardening pass fixed local resolver selection for the external demo-site, hardened structured evidence path sanitization, refreshed issue-facing path evidence, exposed GitHub App live-readiness health data without leaking secrets, fixed the demo-site scheduled workflow so clean CI generates Visual Graph, Visual Impact, issue queue, issue-publish dry-run, Agent Packet, Artifact Index, and MCP smoke prerequisites before reading MCP resources, and made the demo-site PR workflow plan from real PR diffs instead of checked-in fixture files.

Generated `.visual-hive` artifacts remain ignored working outputs. A local Codex CLI no-write issue-agent proof is currently blocked in this Windows environment because `codex --help` fails with `Access is denied`; the deterministic local issue-agent path remains the passing no-write proof.
