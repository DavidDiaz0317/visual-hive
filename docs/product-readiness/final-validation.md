# Final Validation Matrix

Date: 2026-07-07

This is an engineering readiness note for the production-like Visual Hive installation work. It is not a presentation report.

## Product Repo

| Area | Command / Proof | Expected | Actual | Status |
| --- | --- | --- | --- | --- |
| Product branch | `git rev-parse HEAD` | Canonical branch is `main` | `6c037bdbfd1ece3ed1095b129c5fd1002306d5ee` before the path-sanitization hardening commit | Pass |
| Build | `npm run build` | All workspaces build | Passed | Pass |
| Typecheck | `npm run typecheck` | Strict TypeScript checks pass | Passed | Pass |
| Tests | `npm test` | Unit/integration tests pass | 8 files, 363 tests passed after artifact-preview and snapshot path-sanitization regression coverage | Pass |
| Lint | `npm run lint` | ESLint passes | Passed after removing one unused import | Pass |
| Demo full run | `npm run demo:full-run` | Full product demo proof passes | Passed; external calls 0, network issue dry-run 0, source mutations 0, repair branches/PRs 0, real local issues 0 | Pass |
| Product MCP smoke | `npm run demo:mcp:smoke` | Manifest/read-only tools/resources exercised and execution tools disabled | Passed; 73 resources, 78 read tools, 7 disabled execution tools | Pass |
| GitHub App tests | `npm test -w @visual-hive/github-app` | GitHub App signature/mock/live-guard tests pass | 10 tests passed | Pass |
| UI smoke | Covered by `npm run demo:full-run` | Control Plane smoke passes | Passed | Pass |
| Browser UI smoke | Covered by `npm run demo:full-run` | Browser smoke passes | Passed | Pass |
| Audit | `npm audit --workspaces` | No known vulnerabilities, or documented risk | `found 0 vulnerabilities` | Pass |
| Product path leak scan | Issue-facing generated artifacts under `examples/demo-react-app/.visual-hive`, including `artifacts-index.json` and `control-plane-snapshot.json` | No local absolute paths in issue-facing artifacts | Passed after artifact preview and snapshot sanitization hardening | Pass |
| Stale branch refs | `rg "codex/control-plane-guided-cockpit|codex/v0.2-core-completion|visual-hive@codex|ref: codex" .` | No stale operational refs | Only intentional historical note in this readiness doc set | Pass |

## External Demo-Site Repo

| Area | Command / Proof | Expected | Actual | Status |
| --- | --- | --- | --- | --- |
| Demo-site branch | `git rev-parse HEAD` in `visual-hive-demo-site` | Canonical client branch is `main` | `17e327e44bf20bb5a1905a6537bb8deea4e1af44` at inspection time | Pass |
| Build | `npm run build` | Demo app builds | Passed | Pass |
| Typecheck | `npm run typecheck` | TypeScript checks pass | Passed | Pass |
| MCP smoke | `npm run vh:mcp:smoke` | External repo can read Visual Hive MCP evidence | Passed; 73 resources, 78 read tools, 7 disabled execution tools | Pass |
| Production smoke | `npm run vh:production-smoke` | Continuous client proof passes | Passed after workflow audit cleanup | Pass |
| Workflow audit | `npm run vh:workflows` | PR workflow safe; trusted workflows separated | Passed; critical 0, high 0, `pull_request_target` 0, PR secrets 0, PR write permissions 0 | Pass |
| Demo-site path leak scan | Issue-facing generated artifacts under `.visual-hive` | No local absolute paths in issue-facing artifacts | Passed | Pass |
| Stale branch refs | `rg "codex/control-plane-guided-cockpit|codex/v0.2-core-completion|visual-hive@codex|ref: codex" .` | No stale Visual Hive refs | Passed after updating workflows to `main` | Pass |

## Safety Proofs

| Area | Command / Proof | Expected | Actual | Status |
| --- | --- | --- | --- | --- |
| Local/default issue creation | Product/demo smoke summaries | Local commands create zero real issues | Product and demo-site local paths report zero real issues | Pass |
| PR workflow posture | Workflow audit | PR workflow uses read-only permissions and no secrets | Critical/high findings 0; PR secrets 0; PR write permissions 0 | Pass |
| Trusted publisher posture | Demo-site workflow files and audit | Issue publishing only in trusted `workflow_run` path | Trusted publisher uses `workflow_run`, `issues: write`, no checkout, and live guard | Pass |
| MCP default behavior | Product/demo MCP smoke | Read-only resources/tools available; execution tools disabled | Passed; execution tools listed disabled and not callable by default | Pass |
| Agent default behavior | Product full run and demo-site production smoke | No-write issue-agent output only | Passed; local deterministic agent writes only `.visual-hive/agents` artifacts | Pass |
| Baseline safety | Demo-site workflow audit | Baseline review artifact exists; no silent approval | Passed; production-smoke workflow now generates baseline review before upload | Pass |
| Paid provider/Hive/LLM calls | Smoke summaries and issue publish dry-runs | No paid provider, Hive API, or LLM calls by default | External/network counters remain zero on local/default path | Pass |

## Guarded Live Paths

| Area | Command / Proof | Expected | Actual | Status |
| --- | --- | --- | --- | --- |
| GitHub App live mode | `packages/github-app` tests and docs | Live mode blocked without explicit env/auth guard | Tests pass; no live credentials were provided in this run | Blocked by missing live credentials |
| Live issue update | `VISUAL_HIVE_LIVE_GITHUB_ISSUE=true npm run vh:trusted-publish:live-smoke` | Optional trusted live issue update only with explicit guard/token | Not run in this validation pass; local/default paths remain dry-run only | Blocked by missing explicit live guard/token |
| GitHub Actions remote proof | Product/demo workflows | Workflows are committed and triggerable | Product Proof and CI previously passed on `6c037bdb`; demo-site production smoke previously passed on `17e327e`. A follow-up trusted publisher run is required after the sanitizer hardening is pushed. | Pending after push |

## Notes

- `visual-hive://issues` is exposed through the `issue-candidates` evidence resource, backed by `.visual-hive/issues.json`, with the read tool `visual_hive_read_issue_candidates`.
- Absolute local paths are still allowed in low-level local diagnostics such as console output or workflow audit evidence; issue-facing artifacts are sanitized and were scanned separately.
- The GitHub App MVP remains safe by default: mock/dev mode can be run locally, live API calls require explicit credentials and `VISUAL_HIVE_GITHUB_APP_LIVE=true`.
