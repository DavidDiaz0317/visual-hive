# Final Validation Matrix

Date: 2026-07-07

This is an engineering validation matrix for the production-like Visual Hive installation work. It is not a presentation report.

## Product Repo

| Area | Command / Proof | Expected | Actual | Status |
| --- | --- | --- | --- | --- |
| Product branch | `git rev-parse HEAD` | Canonical branch is `main` | `0c5da7b2d7a99edb46539155c9a0478706ea143b` | Pass |
| Build | `npm run build` | All workspaces build | Passed | Pass |
| Typecheck | `npm run typecheck` | Strict TypeScript checks pass | Passed | Pass |
| Tests | `npm test` | Unit/integration tests pass | 372 tests passed, including issue-facing path scan coverage | Pass |
| Lint | `npm run lint` | ESLint passes | Passed | Pass |
| Demo full run | `npm run demo:full-run` | Full product demo proof passes | Passed; external calls 0, network issue dry-run 0, source mutations 0, repair branches/PRs 0, real local issues 0 | Pass |
| Product graph search | `npm run demo:graph:search` | Visual Graph search works | Passed; login/auth graph nodes returned | Pass |
| Product graph impact | `npm run demo:graph:impact` | Visual Impact artifact generated | Passed; visual-impact.json written | Pass |
| Product issues | `npm run demo:issues` | Issue candidates, queue, setup issue written without external calls | Passed; 18 candidates, external calls 0 | Pass |
| Product issue publish dry-run | `npm run demo:issue-publish` | Dry-run publish writes plan/result and creates no real issues | Passed; real GitHub issues created 0 | Pass |
| Product agent issue | `npm run demo:agent-issue-run` | No-write issue-agent artifacts generated | Passed; agent request/output/run written, external calls 0 | Pass |
| Product agent validation | `npm run demo:agent-validate`; covered by `npm run demo:full-run` | Agent request/output/run artifacts, budgets, validation commands, and forbidden-action counters validate | Passed; 2 agent runs inspected, forbidden action failures 0 | Pass |
| Product agent write-preview | `npm run demo:agent-write-preview`; covered by `npm run demo:full-run` | Default guarded preview writes only `.visual-hive/agents/*/write-preview.json` and creates no branches, commits, pushes, PRs, or issues | Passed; mode `dry_run`, status `planned`, safety counters 0 | Pass |
| Product MCP smoke | `npm run demo:mcp:smoke` | MCP manifest/read-only tools/resources exercised, real stdio server starts, execution/write tools disabled | Passed; 75 resources, 80 read tools, 9 disabled execution tools, stdioSmoke passed | Pass |
| Product UI smoke | Covered by `npm run demo:full-run` | Control Plane smoke passes | Passed | Pass |
| Product browser UI smoke | Covered by `npm run demo:full-run` | Browser smoke passes | Passed | Pass |
| Product GitHub App tests | `npm test -w @visual-hive/github-app` | GitHub App signature/mock/live-readiness tests pass | 15 tests passed | Pass |
| Product GitHub App root smoke | `npm run github-app:smoke:mock` | Root command builds app package and writes sanitized no-network workflow-run issue preview | Passed; external calls 0, network calls 0, repo code executed false | Pass |
| Product GitHub App server smoke | `npm run github-app:smoke:server` | Root command builds app package, starts local server, checks `/health`, posts mock installation, writes sanitized setup preview, and makes no network/external calls | Passed locally; added to Product Proof workflow | Pass |
| Product GitHub App artifact smoke | `npm run github-app:smoke:artifacts` after demo artifacts exist | Root command builds app package and creates an issue action from a downloaded-artifact directory without checkout or network calls | Passed; external calls 0, network calls 0, repo code executed false | Pass |
| Product audit | `npm audit --workspaces` | No known vulnerabilities, or documented risk | `found 0 vulnerabilities` | Pass |
| Product path leak scan | `npm run demo:path-scan`; covered by `npm run demo:full-run` | No local absolute paths in issue/evidence/agent/MCP-facing artifacts | Passed; scanned 27 issue-facing artifacts and found 0 leaks | Pass |
| Product workflow audit | `npm run demo:workflows` | Product workflows are PR-safe, summary-capable, baseline-artifact capable, and SHA-pinned | Passed; critical/high 0, `pull_request_target` 0, PR secrets/write permissions 0, unpinned actions 0 | Pass |
| Product CI | GitHub Actions run `28883222683` | Product CI passes on `main` | Passed for commit `0c5da7b` | Pass |
| Product Proof | GitHub Actions run `28883222687` | Product proof passes on `main` | Passed for commit `0c5da7b`, including `github-app:smoke:server` and pinned workflow actions | Pass |
| Stale branch refs | `rg "codex/control-plane-guided-cockpit|codex/v0.2-core-completion|visual-hive@codex|ref: codex" .` excluding generated/untracked proof output | No stale operational refs | Only historical readiness-doc references remain | Pass |

## External Demo-Site Repo

| Area | Command / Proof | Expected | Actual | Status |
| --- | --- | --- | --- | --- |
| Demo-site branch | `git rev-parse HEAD` | Canonical client branch is `main` | `d36b576178cd756d4c9ab819f45cdcdad000a65e` | Pass |
| CLI resolver | `node scripts/visual-hive-cli.mjs --print-resolution` | Selects current built Visual Hive checkout or explicit override | Passed; selected `../vis-hive` as newest checkout | Pass |
| Build | `npm run build` | Demo app builds | Passed | Pass |
| Typecheck | `npm run typecheck` | TypeScript checks pass | Passed | Pass |
| Demo-site graph search | `npm run vh:graph:search` | External repo graph search works | Passed; login/auth nodes returned | Pass |
| Demo-site graph impact | `npm run vh:graph:impact` | External repo Visual Impact generated | Passed; visual-impact.json written | Pass |
| Demo-site issues | `npm run vh:issues` | Issue candidates and queue generated without external calls | Passed; 31 candidates, external calls 0 | Pass |
| Demo-site issue publish dry-run | `npm run vh:issues:publish` | Dry-run publish writes plan/result and creates no real issues | Passed; real GitHub issues created 0 | Pass |
| Demo-site MCP smoke | `npm run vh:mcp:smoke` | External repo can read Visual Hive MCP evidence through the product smoke script, including real stdio server proof, with execution/write tools disabled | Passed; 75 resources, 80 read tools, 9 disabled execution tools, stdioSmoke passed | Pass |
| Demo-site agent issue | `npm run vh:agent:issue` | No-write local deterministic issue-agent runs | Passed; agent execution completed, external calls 0 | Pass |
| Demo-site agent validation | `npm run vh:agent:validate`; covered by `npm run vh:full-run` and `npm run vh:production-smoke` | Client repo validates agent request/output/run artifacts and no-write counters | Passed; 1 agent run inspected, forbidden action failures 0 | Pass |
| Demo-site agent write-preview | `npm run vh:agent:write-preview`; covered by `npm run vh:production-smoke` | Client repo proves the guarded write-preview path in dry-run mode | Passed; mode `dry_run`, status `planned`, branches/commits/pushes/PRs/issues 0 | Pass |
| Demo-site workflow audit | `npm run vh:workflows` | PR workflow safe; trusted workflows separated | Passed; critical 0, high 0, `pull_request_target` 0, PR secrets 0, PR write permissions 0 | Pass |
| Demo-site PR diff planning | GitHub PR #7 and local docs-only branch simulation | PR workflow plans from actual PR changed files and planning-only changes do not run deterministic contracts | Passed; PR run `28864434672` green, `.visual-hive/changed-files.pr.txt` feeds graph impact and plan, local docs-only simulation selected 0 contracts and still wrote issue/MCP/artifact evidence | Pass |
| Demo-site production smoke | `npm run vh:production-smoke` | Continuous client proof passes locally | Passed locally after adding agent artifact validation; safety counters all zero | Pass |
| Demo-site GitHub App artifact smoke | `npm run vh:github-app:artifact-smoke` and workflow step in run `28868555140` | Product GitHub App consumes real `.visual-hive` artifacts without checkout, repo code execution, network calls, or external calls | Passed; create/update issue action generated, path leak scan clean, external/network calls 0 | Pass |
| Demo-site path leak scan | `npm run vh:path-scan`; covered by `npm run vh:production-smoke` and `npm run vh:full-run` | No local absolute paths in issue/evidence/agent/MCP-facing artifacts | Passed; scanned 34 issue-facing artifacts and found 0 leaks | Pass |
| Demo-site Production Smoke workflow | GitHub Actions run `28881564304`; local `npm run vh:production-smoke` on `d36b576` | Manual production smoke passes and includes GitHub App artifact-ingestion, write-preview proof, and path-scan proof | GitHub workflow passed for commit `d36b576`; local production smoke passed for commit `d36b576` | Pass |
| Demo-site Scheduled workflow | GitHub Actions run `28862904560` | Scheduled/deep workflow creates prerequisites before MCP smoke and uploads artifacts | Passed after workflow prerequisite fix | Pass |
| Demo-site Trusted Publisher workflow | GitHub Actions run `28881802371` | Trusted workflow consumes artifacts, validates sanitized issue-facing paths, and remains dry-run unless guard is enabled | Passed after path-scan pattern alignment; no live issue write | Pass |
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
| MCP default behavior | Product/demo MCP smoke | Read-only resources/tools available; real stdio server starts; execution tools disabled | Passed; execution tools listed disabled and not callable by default; stdio subprocess smoke passed | Pass |
| Agent default behavior | Product full run and demo-site production smoke | No-write issue-agent output only | Passed; local deterministic agent writes only `.visual-hive/agents` artifacts | Pass |
| Baseline safety | Demo-site workflow audit and production smoke | Baseline review artifact exists; no silent approval | Passed; production smoke generates baseline review before upload | Pass |
| Paid provider/Hive/LLM calls | Smoke summaries and issue publish dry-runs | No paid provider, Hive API, or LLM calls by default | External/network counters remain zero on local/default path | Pass |
| Issue #6 dedupe/resolved candidate | `gh issue view 6 --repo DavidDiaz0317/visual-hive-demo-site` | Existing live proof issue has dedupe marker, resolved-candidate label, and no local path leaks | Passed; issue is open, labeled `visual-hive/resolved-candidate`, body contains Visual Hive dedupe marker, local path scan false | Pass |
| Issue #4 guarded live smoke | `VISUAL_HIVE_LIVE_GITHUB_ISSUE=true npm run vh:trusted-publish:live-smoke`; `gh issue view 4 --repo DavidDiaz0317/visual-hive-demo-site` | Explicit trusted live smoke updates exactly one issue, creates no duplicate, and publishes only repo-relative artifact paths | Passed; `.visual-hive/live-issue-smoke.json` reports `realGithubIssuesCreated: 0`, `realGithubIssuesUpdated: 1`, issue URL `https://github.com/DavidDiaz0317/visual-hive-demo-site/issues/4`, and body path scan found no `C:/Users`, `OneDrive`, `/Users/`, `/home/`, or drive-letter artifact paths | Pass |

## Guarded Live Paths

| Area | Command / Proof | Expected | Actual | Status |
| --- | --- | --- | --- | --- |
| GitHub App live mode | `packages/github-app` tests and docs | Live mode blocked without explicit env/auth guard | Tests pass; no live GitHub App credentials were provided in this run | Blocked by missing live credentials |
| Live issue update | `VISUAL_HIVE_LIVE_GITHUB_ISSUE=true npm run vh:trusted-publish:live-smoke` | Optional trusted live issue update only with explicit guard/token | Passed against demo-site issue #4 with token guard set; created 0 issues and updated 1 existing issue | Pass |
| Codex CLI no-write agent | `codex --help` before attempting a real Codex issue-agent run | CLI help should be callable before adapter execution | `codex.exe` failed with `Access is denied`; deterministic local no-write agent remains passing | Blocked by local Codex CLI execution policy |

## Notes

- `visual-hive://issues` is exposed through the `issue-candidates` evidence resource, backed by `.visual-hive/issues.json`, with the read tool `visual_hive_read_issue_candidates`.
- Absolute local paths are still allowed in local console output and low-level diagnostics. Issue-facing artifacts are sanitized and were scanned separately.
- The GitHub App MVP remains safe by default: mock/dev mode can be run locally, live API calls require explicit credentials and `VISUAL_HIVE_GITHUB_APP_LIVE=true`.
- The untracked local PDF/report folder under `docs/reports/` is intentionally not part of this product goal and was not committed.
