# Research Artifact Manifest

This manifest maps Visual Hive artifacts to research claims. Generated `.visual-hive` files remain ignored working outputs unless a baseline or fixture is intentionally reviewed and committed.

## Generated Artifacts

| Artifact | Status | Claim supported |
| --- | --- | --- |
| `.visual-hive/report.json` | ignored generated output | Final deterministic verdict, contract results, visual diff and runtime error evidence. |
| `.visual-hive/evidence-packet.json` | ignored generated output | Stable handoff object for humans, issues, MCP clients, Hive exports, and optional LLM review. |
| `.visual-hive/mutation-report.json` | ignored generated output | Mutation adequacy, survived mutation classes, and missing-test evidence. |
| `.visual-hive/issues.json` and `.visual-hive/issue-queue.json` | ignored generated output | Issue-centric routing, dedupe, severity, affected surfaces, validation command, and lifecycle state. |
| `.visual-hive/visual-graph.json`, `.visual-hive/visual-graph-vocab.json`, `.visual-hive/visual-impact.json` | ignored generated output | Changed-file impact, affected graph neighborhoods, and bounded agent context. |
| `.visual-hive/mcp-manifest.json` | ignored generated output | Read-only MCP resources/tools and disabled execution/write tools. |
| `.visual-hive/artifacts-index.json` | ignored generated output | Discoverability and artifact completeness for reproducibility. |
| `.visual-hive/security.json` and `.visual-hive/workflow-audit.json` | ignored generated output | PR-safe/protected workflow posture and unsafe automation prevention. |
| `.visual-hive/handoff.json`, `.visual-hive/hive-handoff-validation.json`, `.visual-hive/hive/*` | ignored generated output | No-network Hive/GitHub issue handoff readiness and guarded future repair evidence. |
| `.visual-hive/history.json` and `.visual-hive/context-ledger.json` | ignored generated output | Longitudinal trends, run context, and governance audit trail. |

## Committed Contracts

| File family | Status | Claim supported |
| --- | --- | --- |
| `schemas/visual-hive.*.schema.json` | committed | Machine-readable artifact contracts and schema verification. |
| `docs/research/*.md` | committed | Research framing, evaluation protocol, artifact mapping, and paper scaffold. |
| `docs/product-readiness/*.md` | committed | Engineering readiness notes and validation summaries; not a substitute for raw experiment logs. |
| `docs/agents/*.md`, `docs/mcp.md`, `docs/evidence-packet.md` | committed | Agent, MCP, verdict, and evidence-interface documentation. |
| `README.md` | committed | Product overview, safety boundary, and quick reproducibility entrypoint. |

## Reproducibility Commands

Run these before citing product-repo evidence:

```bash
npm run build
npm run typecheck
npm test
npm run lint
npm run schema:verify
npm run demo:full-run
npm run demo:all
```

Run these in the external demo-site repo before citing consumer evidence:

```bash
npm run vh:production-smoke
npm run vh:mcp:smoke
npm run vh:issues
npm run vh:graph:impact
npm run vh:agent:issue
```

For a paper artifact bundle, record the repo URL, commit SHA, command, exit status, wall time, relevant `.visual-hive` artifact paths, and any GitHub Actions run IDs. If a command is blocked by missing credentials or local execution policy, record it as a limitation with the sanitized error.
