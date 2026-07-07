# Current Product Readiness State

Date: 2026-07-07

This is an engineering readiness note for the production-like Visual Hive installation work. It is not a presentation report.

## Canonical Branches

| Repo | Canonical branch | Current SHA | Notes |
| --- | --- | --- | --- |
| `DavidDiaz0317/visual-hive` | `main` | `893395cba104c4de819b22222074490ca7ecb016` | `main` is the current product branch. The older `codex/control-plane-guided-cockpit` branch is historical only and must not be used by active workflows. |
| `DavidDiaz0317/visual-hive-demo-site` | `main` | `1cf174550385176e9b71f221d6b302a9614b70d8` | Demo-site is the canonical external client installation. |

## Current Verified State

- Product `CI` passed on `main` run `28854470813`.
- Product `Product Proof` passed on `main` run `28854470800`.
- Demo-site `Visual Hive Production Smoke` passed on `main` run `28855015024`.
- Demo-site `Visual Hive Trusted Publisher` passed on `main` run `28855193550`.
- Demo-site local resolver now chooses the newest built sibling checkout when both `../visual-hive` and `../vis-hive` exist, avoiding stale local tooling.
- Demo-site issue #6 is open, deduped, marked `visual-hive/resolved-candidate`, and contains no local absolute path leaks.

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

The latest hardening pass fixed local resolver selection for the external demo-site, refreshed issue-facing path sanitization evidence, and confirmed both local and GitHub-hosted production paths are green. Generated `.visual-hive` artifacts remain ignored working outputs.
