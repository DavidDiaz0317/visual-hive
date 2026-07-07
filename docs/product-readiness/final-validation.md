# Final Validation Matrix

Date: 2026-07-07

This is an engineering validation matrix for the production-like Visual Hive installation work. It is not a presentation report.

## Product Repo

| Area | Command / Proof | Expected | Actual | Status |
| --- | --- | --- | --- | --- |
| Product branch | `git rev-parse HEAD` | Canonical branch is `main` | `validated by latest green product runs; see CI/Product Proof rows` | Pass |
| Build | `npm run build` | All workspaces build | Passed | Pass |
| Typecheck | `npm run typecheck` | Strict TypeScript checks pass | Passed | Pass |
| Tests | `npm test` | Unit/integration tests pass | 8 files, 364 tests passed | Pass |
| Lint | `npm run lint` | ESLint passes | Passed | Pass |
| Demo full run | `npm run demo:full-run` | Full product demo proof passes | Passed; external calls 0, network issue dry-run 0, source mutations 0, repair branches/PRs 0, real local issues 0 | Pass |
| Product graph search | `npm run demo:graph:search` | Visual Graph search works | Passed; login/auth graph nodes returned | Pass |
| Product graph impact | `npm run demo:graph:impact` | Visual Impact artifact generated | Passed; visual-impact.json written | Pass |
| Product issues | `npm run demo:issues` | Issue candidates, queue, setup issue written without external calls | Passed; 18 candidates, external calls 0 | Pass |
| Product issue publish dry-run | `npm run demo:issue-publish` | Dry-run publish writes plan/result and creates no real issues | Passed; real GitHub issues created 0 | Pass |
| Product agent issue | `npm run demo:agent-issue-run` | No-write issue-agent artifacts generated | Passed; agent request/output/run written, external calls 0 | Pass |
| Product MCP smoke | `npm run demo:mcp:smoke` | MCP manifest/read-only tools/resources exercised and execution/write tools disabled | Passed; 73 resources, 78 read tools, 9 disabled execution tools | Pass |
| Product UI smoke | Covered by `npm run demo:full-run` | Control Plane smoke passes | Passed | Pass |
| Product browser UI smoke | Covered by `npm run demo:full-run` | Browser smoke passes | Passed | Pass |
| Product GitHub App tests | `npm test -w @visual-hive/github-app` | GitHub App signature/mock/live-readiness tests pass | 11 tests passed | Pass |
| Product audit | `npm audit --workspaces` | No known vulnerabilities, or documented risk | `found 0 vulnerabilities` | Pass |
| Product path leak scan | Evidence-facing generated artifacts under `examples/demo-react-app/.visual-hive` | No local absolute paths in issue/evidence/agent/MCP-facing artifacts | Passed for 18 evidence-facing artifacts after `npm run demo:full-run` | Pass |
| Product CI | GitHub Actions run `28856849311` | Product CI passes on `main` | Passed before latest sanitizer hardening commit; rerun after push required for new head | Pass |
| Product Proof | GitHub Actions run `28856849312` | Product proof passes on `main` | Passed before latest sanitizer hardening commit; rerun after push required for new head | Pass |
| Stale branch refs | `rg "codex/control-plane-guided-cockpit|codex/v0.2-core-completion|visual-hive@codex|ref: codex" .` excluding generated/untracked proof output | No stale operational refs | Only historical readiness-doc references remain | Pass |

## External Demo-Site Repo

| Area | Command / Proof | Expected | Actual | Status |
| --- | --- | --- | --- | --- |
| Demo-site branch | `git rev-parse HEAD` | Canonical client branch is `main` | `9c606dfd8ef818ee971ebd72a727916a0f922bf3` | Pass |
| CLI resolver | `node scripts/visual-hive-cli.mjs --print-resolution` | Selects current built Visual Hive checkout or explicit override | Passed; selected `../vis-hive` as newest checkout | Pass |
| Build | `npm run build` | Demo app builds | Passed | Pass |
| Typecheck | `npm run typecheck` | TypeScript checks pass | Passed | Pass |
| Demo-site graph search | `npm run vh:graph:search` | External repo graph search works | Passed; login/auth nodes returned | Pass |
| Demo-site graph impact | `npm run vh:graph:impact` | External repo Visual Impact generated | Passed; visual-impact.json written | Pass |
| Demo-site issues | `npm run vh:issues` | Issue candidates and queue generated without external calls | Passed; 31 candidates, external calls 0 | Pass |
| Demo-site issue publish dry-run | `npm run vh:issues:publish` | Dry-run publish writes plan/result and creates no real issues | Passed; real GitHub issues created 0 | Pass |
| Demo-site MCP smoke | `npm run vh:mcp:smoke` | External repo can read Visual Hive MCP evidence with execution/write tools disabled | Passed; 73 resources, 78 read tools, 9 disabled execution tools | Pass |
| Demo-site agent issue | `npm run vh:agent:issue` | No-write local deterministic issue-agent runs | Passed; agent execution completed, external calls 0 | Pass |
| Demo-site workflow audit | `npm run vh:workflows` | PR workflow safe; trusted workflows separated | Passed; critical 0, high 0, `pull_request_target` 0, PR secrets 0, PR write permissions 0 | Pass |
| Demo-site production smoke | `npm run vh:production-smoke` | Continuous client proof passes locally | Passed after resolver hardening | Pass |
| Demo-site path leak scan | Evidence-facing generated artifacts under `.visual-hive` | No local absolute paths in issue/evidence/agent/MCP-facing artifacts | Passed for 18 evidence-facing artifacts after `npm run vh:production-smoke` | Pass |
| Demo-site Production Smoke workflow | GitHub Actions run `28856425414` | Workflow-dispatched production smoke passes | Passed | Pass |
| Demo-site Trusted Publisher workflow | GitHub Actions run `28856599389` | Trusted workflow consumes artifacts and remains dry-run unless guard is enabled | Passed | Pass |
| PR workflow exists/safe | `.github/workflows/visual-hive-pr.yml` and workflow audit | Pull request workflow is read-only/no-secret/no issue creation | Passed by workflow audit | Pass |
| Scheduled workflow exists | `.github/workflows/visual-hive-scheduled.yml` and workflow audit | Scheduled/deep workflow exists and uploads artifacts | Passed by workflow audit | Pass |
| Trusted publisher exists/safe | `.github/workflows/visual-hive-trusted-publisher.yml` and workflow audit | Trusted publisher uses workflow_run, issues:write, no checkout, live guard | Passed by workflow audit and run `28856599389` | Pass |
| Stale branch refs | `rg "codex/control-plane-guided-cockpit|codex/v0.2-core-completion|visual-hive@codex|ref: codex" .` | No stale Visual Hive refs | Passed | Pass |

## Safety Proofs

| Area | Command / Proof | Expected | Actual | Status |
| --- | --- | --- | --- | --- |
| Local/default issue creation | Product/demo smoke summaries and issue-publish dry-runs | Local commands create zero real issues | Product and demo-site local paths report zero real issues | Pass |
| PR workflow posture | Workflow audit | PR workflow uses read-only permissions and no secrets | Critical/high findings 0; PR secrets 0; PR write permissions 0 | Pass |
| Trusted publisher posture | Demo-site workflow files and audit | Issue publishing only in trusted `workflow_run` path | Trusted publisher uses `workflow_run`, `issues: write`, no checkout, and live guard | Pass |
| MCP default behavior | Product/demo MCP smoke | Read-only resources/tools available; execution tools disabled | Passed; execution tools listed disabled and not callable by default | Pass |
| Agent default behavior | Product full run and demo-site production smoke | No-write issue-agent output only | Passed; local deterministic agent writes only `.visual-hive/agents` artifacts | Pass |
| Baseline safety | Demo-site workflow audit and production smoke | Baseline review artifact exists; no silent approval | Passed; production smoke generates baseline review before upload | Pass |
| Paid provider/Hive/LLM calls | Smoke summaries and issue publish dry-runs | No paid provider, Hive API, or LLM calls by default | External/network counters remain zero on local/default path | Pass |
| Issue #6 dedupe/resolved candidate | `gh issue view 6 --repo DavidDiaz0317/visual-hive-demo-site` | Existing live proof issue has dedupe marker, resolved-candidate label, and no local path leaks | Passed; issue is open, labeled `visual-hive/resolved-candidate`, body contains Visual Hive dedupe marker, local path scan false | Pass |

## Guarded Live Paths

| Area | Command / Proof | Expected | Actual | Status |
| --- | --- | --- | --- | --- |
| GitHub App live mode | `packages/github-app` tests and docs | Live mode blocked without explicit env/auth guard | Tests pass; no live GitHub App credentials were provided in this run | Blocked by missing live credentials |
| Live issue update | `VISUAL_HIVE_LIVE_GITHUB_ISSUE=true npm run vh:trusted-publish:live-smoke` | Optional trusted live issue update only with explicit guard/token | Not run in this validation pass; previous issue #6 proof remains clean and deduped | Blocked by missing explicit live guard/token |

## Notes

- `visual-hive://issues` is exposed through the `issue-candidates` evidence resource, backed by `.visual-hive/issues.json`, with the read tool `visual_hive_read_issue_candidates`.
- Absolute local paths are still allowed in local console output and low-level diagnostics. Issue-facing artifacts are sanitized and were scanned separately.
- The GitHub App MVP remains safe by default: mock/dev mode can be run locally, live API calls require explicit credentials and `VISUAL_HIVE_GITHUB_APP_LIVE=true`.
- The untracked local PDF/report folder under `docs/reports/` is intentionally not part of this product goal and was not committed.
