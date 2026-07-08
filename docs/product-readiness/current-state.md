# Current Product Readiness State

Date: 2026-07-08

This is an engineering readiness note for the production-like Visual Hive installation work. It is not a presentation report.

## Canonical Branches

| Repo | Canonical branch | Current reference | Notes |
| --- | --- | --- | --- |
| `DavidDiaz0317/visual-hive` | `main` | `cee1b7e1aa35fd9940dd2fa3a12cac6368940e23` | `main` is the current product branch. The older `codex/control-plane-guided-cockpit` branch is historical only and must not be used by active workflows. Use `git rev-parse HEAD` and the latest GitHub Actions run list as the live source of truth for subsequent commits. |
| `DavidDiaz0317/visual-hive-demo-site` | `main` | `cdbe7623c997bf6be7690de68f361d3739550974` | Demo-site is the canonical external client installation. |

## Current Verified State

- Product `CI` passed on `main` run `28908287220` for commit `cee1b7e1`.
- Product `Product Proof` passed on `main` run `28908287263` for commit `cee1b7e1`, including the blocked-by-default GitHub App live-smoke proof.
- Product workflow audit reports zero critical/high findings, zero `pull_request_target` workflows, zero PR secrets/write permissions, and zero tag/unpinned external actions.
- Product `npm audit --workspaces` reports `found 0 vulnerabilities`.
- Product root `npm run github-app:smoke:mock` passes and writes a sanitized no-network GitHub App workflow-run issue preview.
- Product root `npm run github-app:smoke:artifacts` passes after demo artifacts exist and builds a GitHub App issue action from the downloaded-artifact directory path with zero external/network calls.
- Product root `npm run github-app:smoke:server` starts the local GitHub App server, checks `/health`, posts a mock installation event, writes a setup issue preview, and makes zero external/network calls.
- The GitHub App package now includes a guarded installation-token issue client and `npm run github-app:smoke:live`. It remains blocked unless `VISUAL_HIVE_GITHUB_APP_LIVE=true`, `VISUAL_HIVE_GITHUB_APP_LIVE_ISSUE_WRITE=true`, and GitHub App id/private-key/installation/webhook-secret env vars are configured. Tests mock the live GitHub API path and prove create/update-by-dedupe behavior without real network calls; the default live smoke writes blocked artifacts with zero external/network calls.
- Demo-site `Visual Hive Production Smoke` passed on `main` run `28908584336` for commit `cdbe762`, including the GitHub App artifact-ingestion smoke after consolidating to the single trusted publisher workflow.
- Demo-site `Visual Hive Trusted Publisher` passed on `main` run `28908707994` for the production-smoke artifacts from commit `cdbe762`.
- Demo-site `Visual Hive Scheduled` passed on `main` workflow-dispatch run `28892559286` for commit `5c6598f`, after all demo-site workflows were SHA-pinned and the scheduled lane was updated to run `npm run vh:full-run` before the deep evidence chain.
- Demo-site `Visual Hive Trusted Publisher` passed on `main` run `28892981209` for artifacts from the pinned scheduled lane.
- Demo-site PR workflow now captures the actual pull request diff into `.visual-hive/changed-files.pr.txt`, plans from that file, emits Visual Graph/Impact artifacts, and handles planning-only diffs without running deterministic contracts. Temporary smoke PR #7 passed the `visual-hive` check on run `28864434672` and was closed/deleted after validation.
- Demo-site local resolver now chooses the newest built sibling checkout when both `../visual-hive` and `../vis-hive` exist, avoiding stale local tooling.
- Demo-site workflow audit now accepts the single trusted issue publisher as the consolidated handoff/publish path when it consumes sanitized handoff artifacts; it no longer recommends adding a duplicate trusted Hive handoff workflow for this installation.
- Demo-site issue #6 is open, deduped, marked `visual-hive/resolved-candidate`, and contains no local absolute path leaks.
- Guarded live issue smoke updated existing demo-site issue #4 (`https://github.com/DavidDiaz0317/visual-hive-demo-site/issues/4`) with `VISUAL_HIVE_LIVE_GITHUB_ISSUE=true`; it reported `realGithubIssuesCreated: 0`, `realGithubIssuesUpdated: 1`, and no local absolute path leaks in the published body.
- Evidence-facing artifacts now sanitize repo-local screenshot/spec paths to `.visual-hive/...` in Evidence Packets, Visual Graph/Vocab/Impact, Agent Packets, Control Plane snapshots, and Artifact Index previews.
- `visual-hive path-scan` is the first-class issue-facing path leak scanner. It writes `.visual-hive/path-leak-scan.json`, is cataloged as `visual-hive://path-leak-scan` / `visual_hive_read_path_leak_scan`, and is wired into both the product demo full-run and the external demo-site production/full-run gates.

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

Live GitHub issue publishing and GitHub App issue writes require explicit trusted workflow or local live-smoke guards. The GitHub App live issue client has an additional `VISUAL_HIVE_GITHUB_APP_LIVE_ISSUE_WRITE=true` guard beyond live credential readiness.

## Current Cleanup Focus

The latest hardening pass fixed local resolver selection for the external demo-site, hardened structured evidence path sanitization, refreshed issue-facing path evidence, exposed GitHub App live-readiness health data without leaking secrets, added a guarded GitHub App installation-token issue client with mocked live create/update tests, added a dedicated blocked-by-default GitHub App live-smoke command, fixed the demo-site scheduled workflow so clean CI generates Visual Graph, Visual Impact, issue queue, issue-publish dry-run, Agent Packet, Artifact Index, and MCP smoke prerequisites before reading MCP resources, made the demo-site PR workflow plan from real PR diffs instead of checked-in fixture files, added a demo-site GitHub App artifact-ingestion smoke that feeds real `.visual-hive` artifacts into the product GitHub App mock with zero external calls, zero network calls, no checkout, and no repo code execution, proved MCP stdio with a real client, added guarded issue-agent write-preview dry-run proof in both product and demo-site acceptance paths, added reusable agent artifact validation for request/output/run bundles and no-write safety counters, added the `repair_planner_agent` profile for deterministic visual/selector/screenshot failure planning, added a local deterministic issue-agent runner so product demos can exercise structured no-write agent output without Codex, Hive, LLM, provider, network, or GitHub writes, accepted the consolidated trusted publisher workflow model in workflow audit logic, and improved the external production-smoke harness so any failed step records a bounded output excerpt in `.visual-hive/production-smoke-summary.json`.

Generated `.visual-hive` artifacts remain ignored working outputs. A local Codex CLI no-write issue-agent proof is currently blocked in this Windows environment because `codex --help` / guarded discovery fails with `Access is denied` / `spawn EPERM`; Visual Hive now records that as a blocked no-write agent artifact with zero source mutations, branches, PRs, issues, external calls, network calls, Hive API calls, LLM calls, or paid provider calls. The deterministic local issue-agent path remains the passing no-write proof.
