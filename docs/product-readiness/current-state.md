# Current Product Readiness State

Date: 2026-07-07

This is an engineering readiness note for the production-like Visual Hive installation work. It is not a presentation report.

## Canonical Branches

| Repo | Canonical branch | Current SHA | Notes |
| --- | --- | --- | --- |
| `DavidDiaz0317/visual-hive` | `main` | `784f6b2628c2f19264c210fdcda3a000a588ab81` | `main` is the current product branch. The older `codex/control-plane-guided-cockpit` branch is historical only and must not be used by active workflows. |
| `DavidDiaz0317/visual-hive-demo-site` | `main` | `ea473f5fa5a12a43052b391dfe6e9c9331cc6aa9` | Demo-site is the canonical external client installation. |

## Current Verified State

- Product `CI` passed on `main` run `28871673336` for commit `784f6b2`.
- Product `Product Proof` passed on `main` run `28871672131` for commit `784f6b2`.
- Product `npm audit --workspaces` reports `found 0 vulnerabilities`.
- Product root `npm run github-app:smoke:mock` passes and writes a sanitized no-network GitHub App workflow-run issue preview.
- Product root `npm run github-app:smoke:artifacts` passes after demo artifacts exist and builds a GitHub App issue action from the downloaded-artifact directory path with zero external/network calls.
- Product root `npm run github-app:smoke:server` starts the local GitHub App server, checks `/health`, posts a mock installation event, writes a setup issue preview, and makes zero external/network calls.
- Demo-site `Visual Hive Production Smoke` passed on `main` run `28868555140` for commit `145c0d7`, including the GitHub App artifact-ingestion smoke.
- Demo-site `Visual Hive Scheduled` passed on `main` workflow-dispatch run `28862904560` after scheduled-chain artifact prerequisite cleanup.
- Demo-site `Visual Hive Trusted Publisher` passed on `main` run `28863088358`.
- Demo-site PR workflow now captures the actual pull request diff into `.visual-hive/changed-files.pr.txt`, plans from that file, emits Visual Graph/Impact artifacts, and handles planning-only diffs without running deterministic contracts. Temporary smoke PR #7 passed the `visual-hive` check on run `28864434672` and was closed/deleted after validation.
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

The latest hardening pass fixed local resolver selection for the external demo-site, hardened structured evidence path sanitization, refreshed issue-facing path evidence, exposed GitHub App live-readiness health data without leaking secrets, fixed the demo-site scheduled workflow so clean CI generates Visual Graph, Visual Impact, issue queue, issue-publish dry-run, Agent Packet, Artifact Index, and MCP smoke prerequisites before reading MCP resources, made the demo-site PR workflow plan from real PR diffs instead of checked-in fixture files, added a demo-site GitHub App artifact-ingestion smoke that feeds real `.visual-hive` artifacts into the product GitHub App mock with zero external calls, zero network calls, no checkout, and no repo code execution, proved MCP stdio with a real client, and added guarded issue-agent write-preview dry-run proof in both product and demo-site acceptance paths.

Generated `.visual-hive` artifacts remain ignored working outputs. A local Codex CLI no-write issue-agent proof is currently blocked in this Windows environment because `codex --help` fails with `Access is denied`; the deterministic local issue-agent path remains the passing no-write proof.
