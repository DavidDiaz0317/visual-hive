# Hive Repo Analysis for Visual Hive Integration

## 1. Hive Concepts Visual Hive Should Map To

- **Beads:** Hive's unit of work. Visual Hive issue candidates map cleanly to bead projections with stable `external_ref` dedupe keys.
- **Agents:** Hive routes work to role-specific agents. Visual Hive should emit work orders for quality, tester, CI, setup, and security agents.
- **ACMM/governance:** Hive maturity levels define what automation is allowed. Visual Hive should emit allowed/forbidden actions and require Visual Hive validation before repair work moves forward.
- **Wiki vault / knowledge graph:** Hive stores project knowledge. Visual Hive can contribute deterministic facts about visual contracts, mutations, selectors, routes, and recurring failures.
- **GitHub integration:** Hive owns issue/PR lifecycle. Visual Hive should provide sanitized issue/bead context and never publish by default.

## 2. Hive Files/Packages Likely Touched by Minimal Bridge

- `v2/pkg/beads/`: bead structs/storage/import behavior.
- `v2/pkg/knowledge/`: graph/wiki facts if Visual Hive knowledge is imported.
- `v2/pkg/dashboard/`: Visual QA dashboard view/API wiring.
- `v2/pkg/github/`: trusted issue/PR lifecycle integration.
- `v2/pkg/config/` and `v2/pkg/config/packs/`: ACMM policy defaults.
- Proposed: `v2/pkg/visualhive/` for parsing and validating Visual Hive bundles.

## 3. Bead Schema Mapping

| Visual Hive | Hive bead projection |
| --- | --- |
| `issue.title` | `title` |
| visual regression / contract failure | `type: bug` |
| missing coverage / mutation survivor | `type: task` |
| setup or workflow safety issue | `type: chore` or `task` |
| `severity: critical/high/medium/low` | `priority: 0/1/2/3` |
| `owningAgentHint` | `actor` |
| `dedupeFingerprint` | `external_ref` |
| validation/reproduction/artifact refs | `metadata` and `notes` |

Blocked, suppressed, and resolved-candidate Visual Hive issues must not be imported as ordinary open repair work.

## 4. ACMM/Governance Mapping

- L1 Assisted: Visual Hive emits advisory evidence only.
- L2 Instructed: Hive can import beads manually/trusted; no issue creation by default.
- L3 Measured: Trusted workflow can create/update issues from sanitized artifacts.
- L4 Adaptive: Hive agents can plan holdgated changes; Visual Hive validation required.
- L5 Semi-Automated: Hive agents can produce larger guarded PRs; human/policy gates remain.
- L6 Fully Autonomous: Hive policy may allow merge only after deterministic validation is green. Visual Hive still does not merge or decide repair action.

## 5. GitHub Issue Lifecycle Mapping

Visual Hive produces issue candidates, publish plans, dry-run results, and Hive-ready issue bodies. Hive should consume sanitized artifacts from trusted workflows. PR workflows must remain read-only and cannot create issues.

## 6. Dashboard/Hive Hub Integration Path

The first dashboard integration should be a read/import surface:

1. show Visual Hive import manifest status;
2. show bead projection counts and safety scan status;
3. link Evidence Packet, Visual Graph, Visual Impact, screenshots, and validation commands;
4. route selected beads to Hive agents under ACMM policy.

## 7. One-Setup User Flow

Install/configure Hive once, enable Visual QA, review a setup PR that adds Visual Hive config/workflows, run PR-safe checks, run scheduled/deep checks, then let trusted Hive import sanitized Visual Hive evidence into beads/issues.

## 8. Minimal Hive-Side Changes Needed

- Add a `visualhive` parser/import package.
- Add fixture tests for `hive-export.json`, `hive-beads.json`, and `hive-import-manifest.json`.
- Reject local absolute paths and secret-like strings.
- Dedupe by `external_ref`.
- Add dashboard/import documentation.

## 9. Visual-Hive-Side Changes Needed

- Generate explicit Hive-facing outputs: `hive-beads.json`, `hive-import-manifest.json`, `hive-agent-work-orders.json`, `hive-validation-summary.json`, and `hive-setup-pack.json/md`.
- Add `hive validate-export`, `hive beads`, `hive setup-pack`, and `hive integration-smoke` CLI commands.
- Add MCP resources for the new artifacts.
- Keep all default operations no-network and no-write.

## 10. Risks / Unknowns

- Hive's production bead storage/import API may evolve; Visual Hive should keep a stable import manifest rather than depending on an internal path.
- ACMM names and exact policy gates may change; Visual Hive should emit compatibility fields rather than enforce Hive's full policy model.
- Live issue creation/import must remain trusted workflow-only.
- Repair-capable agents should consume Visual Hive work orders, but Visual Hive must not become the repair agent.
