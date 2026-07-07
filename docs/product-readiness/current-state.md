# Current Product Readiness State

Generated for the production installation hardening pass.

## Canonical Branches

| Repo | Canonical branch | Current SHA | Notes |
| --- | --- | --- | --- |
| `DavidDiaz0317/visual-hive` | `main` | `86cc790d58786ee2a867fec89e6066af46a59654` at inspection time | `main` is fresher than `codex/control-plane-guided-cockpit`; product workflows should use `main`. |
| `DavidDiaz0317/visual-hive-demo-site` | `main` | `7662561e2106fe4ee944a5fcfce403dd43894bf9` at inspection time | Demo-site is the canonical external client installation. |

## Stale Reference Cleanup

- Product `product-proof.yml` now runs on pushes to `main`.
- Demo-site Visual Hive workflows should check out `DavidDiaz0317/visual-hive@main`.
- Historical Codex branch names should not appear in active workflow references.

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
