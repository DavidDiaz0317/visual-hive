# Final Validation Matrix

Date: 2026-07-08

This is an engineering validation matrix for the Visual Hive -> Hive integration readiness work. It is not a presentation report.

## Product Repo

| Area | Command / Proof | Expected | Actual | Status |
| --- | --- | --- | --- | --- |
| Product branch | `git branch --show-current`; `git rev-parse HEAD` | Work is on the canonical product repo branch before commit | `main`, pre-commit HEAD `1c2d50ab2545e79f87b01f77d9d2cc8ae2688a2b` | Pass |
| Install | `npm ci` | Clean workspace install succeeds | Passed; 0 vulnerabilities reported by install audit | Pass |
| Build | `npm run build` | All workspaces build | Passed | Pass |
| Typecheck | `npm run typecheck` | Strict TypeScript checks pass | Passed | Pass |
| Tests | `npm test` | Unit/integration suite passes | Passed; 8 files, 382 tests | Pass |
| Lint | `npm run lint` | ESLint passes | Passed | Pass |
| GitHub App tests | `npm test -w @visual-hive/github-app` | GitHub App package tests pass | Passed; 22 tests | Pass |
| Audit | `npm audit --workspaces` | No known vulnerabilities or documented risk | `found 0 vulnerabilities` | Pass |
| Full demo | `npm run demo:full-run` | Product demo exercises deterministic run, mutation, evidence, issue dry-run, Hive handoff, MCP, UI, and KubeStellar planning | Passed; external calls 0, issue dry-run network calls 0, source mutations 0, repair branches/PRs 0, real local issues 0 | Pass |
| Product graph search | Covered by `npm run demo:full-run`; also available as `npm run demo:graph:search` | Visual Graph search works | Passed inside full demo; login/auth graph nodes returned | Pass |
| Product graph impact | Covered by `npm run demo:full-run`; also available as `npm run demo:graph:impact` | Visual Impact artifact generated | Passed inside full demo | Pass |
| Product issues | `npm run demo:issues` | Issue candidates, queue, and setup issue write with zero external calls | Passed; 17 candidates; external calls 0 | Pass |
| Product issue publish dry-run | `npm run demo:issue-publish` | Dry-run writes plan/result and creates no real issues | Passed; real GitHub issues created 0, network calls 0 | Pass |
| Product agent issue runner | `npm run demo:agent-issue-run` | No-write issue-agent artifacts generated without unsafe side effects | Passed as a safe blocked artifact; Codex shim failed with `spawn EPERM`, external calls 0, real GitHub issues 0 | Blocked by local Codex CLI execution policy; Visual Hive behavior safe |
| Hive export | `npm run demo:hive-export` | Hive export bundle generated with zero external calls | Passed; advisory export written, external calls 0 | Pass |
| Hive beads | `npm run demo:hive-beads` | Hive bead projection generated | Passed; 8 bead projections written | Pass |
| Hive validate | `npm run demo:hive-validate` | Hive import manifest and validation summary pass, with no path or secret leaks | Passed; 8 beads, 8 work orders, path leaks 0, secret leaks 0 | Pass |
| Hive setup pack | `npm run demo:hive-setup-pack` | One-setup Visual QA pack generated for Hive | Passed; ACMM level 3, 4 proposed files, 8 validation commands, external calls 0 | Pass |
| Hive integration smoke | `npm run demo:hive-integration-smoke` | Local Visual Hive -> Hive readiness smoke passes | Passed; 8 beads, 8 work orders, failed checks 0, external calls 0 | Pass |
| MCP manifest | `npm run demo:mcp` | MCP manifest includes read-only Hive resources/tools and disabled execution tools | Passed; 78 resources, 87 read-only tools, 9 disabled execution tools | Pass |
| MCP smoke | `npm run demo:mcp:smoke` | MCP smoke reads evidence/Hive context and keeps execution tools disabled | Passed; 78 resources, 87 read tools, 9 disabled execution tools | Pass |
| UI smoke | `npm run smoke:ui` | Control Plane snapshot/UI smoke passes | Passed | Pass |
| Browser UI smoke | `npm run smoke:ui:browser` | Browser-rendered Control Plane smoke passes | Passed | Pass |
| Product path scan | `npm run demo:path-scan` | No local absolute paths in issue-facing artifacts | Passed; 27 files scanned, 0 findings | Pass |
| Schema catalog | `node packages/cli/dist/index.js schemas verify --output .visual-hive/schema-debug.json --format markdown` | Schemas and evidence-resource catalog verify | Passed; 80 schemas, 215 checks, 0 failed | Pass |

## External Demo-Site Repo

| Area | Command / Proof | Expected | Actual | Status |
| --- | --- | --- | --- | --- |
| Demo-site branch | `git branch --show-current`; `git rev-parse HEAD` | Canonical external client repo on `main` before commit | `main`, pre-commit HEAD `cdbe7623c997bf6be7690de68f361d3739550974` | Pass |
| Install | `npm ci` | Clean install succeeds | Passed; 0 vulnerabilities | Pass |
| Build | `npm run build` | Demo-site app builds | Passed | Pass |
| Typecheck | `npm run typecheck` | TypeScript checks pass | Passed | Pass |
| External full run | `npm run vh:full-run` | Full external client proof passes and writes summary artifacts | Passed after verifier schema alignment; clean deterministic pass, seeded defect proof, mutation adequacy, evidence, handoff, Hive export/beads/setup pack, MCP, Control Plane, and summary artifacts all verified | Pass |
| External production smoke | `npm run vh:production-smoke` | Continuous/scheduled-style client proof passes | Passed; mutation score 100%, Hive/MCP/workflow/path-scan lanes passed | Pass |
| Demo-site Hive export | Covered by `npm run vh:full-run` and `npm run vh:production-smoke` | Hive export generated with zero external calls | Passed; measured export wrote 6 beads and 12 knowledge facts | Pass |
| Demo-site Hive beads | Covered by `npm run vh:full-run` and `npm run vh:production-smoke` | Hive bead projections generated | Passed; 6 bead projections written | Pass |
| Demo-site Hive validate | Covered by `npm run vh:full-run` and `npm run vh:production-smoke` | Import manifest and validation summary pass | Passed; path leaks 0, secret leaks 0 | Pass |
| Demo-site Hive setup pack | Covered by `npm run vh:full-run` and `npm run vh:production-smoke` | Setup pack generated | Passed; schema valid with proposed files and validation commands | Pass |
| Demo-site Hive integration smoke | Covered by `npm run vh:full-run` and `npm run vh:production-smoke` | Local integration smoke passes | Passed; 6 beads, 6 work orders, failed checks 0, external calls 0 | Pass |
| Demo-site MCP smoke | Covered by `npm run vh:full-run` and `npm run vh:production-smoke` | MCP can read Visual Hive/Hive evidence with execution tools disabled | Passed; 78 resources, 87 read tools, 9 disabled execution tools | Pass |
| Demo-site workflow audit | Covered by `npm run vh:production-smoke` | PR workflow read-only/no-secret; trusted publisher separated | Passed; 6 workflows, critical/high 0, `pull_request_target` 0, PR secrets 0, PR write permissions 0 | Pass |
| Demo-site path scan | Covered by `npm run vh:production-smoke` | No local absolute paths in issue/Hive-facing artifacts | Passed; 34 files scanned, 0 findings | Pass |

## Hive Clone / Compatibility Patch

| Area | Command / Proof | Expected | Actual | Status |
| --- | --- | --- | --- | --- |
| Hive branch | `git branch --show-current`; `git rev-parse HEAD` | Minimal compatibility branch exists locally | `visual-hive-integration`, pre-commit HEAD `23501bc1895e718414bf45be0c65e0161ef39385` | Pass |
| Hive parser tests | `go test ./pkg/visualhive` from `v2` | Minimal Hive-side Visual Hive import parser validates fixture, dedupe, and path leak rejection | Passed | Pass |

## Safety Proofs

| Area | Command / Proof | Expected | Actual | Status |
| --- | --- | --- | --- | --- |
| Local/default issue creation | Product/demo issue publish dry-runs and smoke summaries | Local/default commands create zero real GitHub issues | Product and demo-site dry-runs report zero real issues created | Pass |
| Network/external calls | Product/demo Hive, provider, LLM, and issue dry-run outputs | No Hive API, LLM, paid provider, or GitHub live calls by default | External/network counters remain zero on local/default paths | Pass |
| PR workflow posture | Product and demo-site workflow audits | PR workflows are read-only, no secrets, no issue creation, no `pull_request_target` execution | Product and demo-site audits pass with no critical/high findings | Pass |
| MCP default behavior | Product/demo MCP smoke | MCP is read-only by default and execution tools remain disabled | Passed; disabled tools listed and not executed | Pass |
| Baseline safety | Demo/full-run and workflow audit | No silent baseline approvals or threshold weakening | Passed; baseline review artifacts generated separately | Pass |
| Path sanitization | `npm run demo:path-scan`; `npm run vh:path-scan` via production smoke | No local user-home/drive-letter paths in issue/Hive-facing artifacts | Passed in both product and demo-site scans | Pass |

## Notes

- Absolute local paths can appear in console output from local commands and low-level local diagnostics. Issue-facing and Hive-facing artifacts are scanned separately and passed.
- The Codex issue-agent path is safe but blocked in this shell because the discovered Codex Windows shim cannot execute (`spawn EPERM`). Visual Hive records this as a blocked no-write artifact with zero unsafe counters and remediation instructions.
- No PDF, presentation, or marketing artifact is part of this validation.
