# Combined Hive + Visual Hive Product Direction

The target product experience is one setup:

```text
Install / configure Hive once
-> enable Visual QA
-> Visual Hive runs on PRs and schedules
-> deterministic evidence/artifacts are produced
-> Hive consumes Visual Hive evidence
-> Hive creates/updates beads/issues
-> Hive agents act under governance
-> Visual Hive reruns validation
```

## Product Boundary

Hive:

- main product shell, onboarding, GitHub App, Hub, dashboard
- ACMM/governance
- beads and issue/PR lifecycle
- agent orchestration and repair governance

Visual Hive:

- deterministic visual/UI QA engine
- Playwright-backed local checks
- Visual Graph and Visual Impact
- mutation adequacy
- Evidence Packet
- issue candidates and validation commands
- read-only MCP evidence/context
- Hive export/import bundle

## Why This Split Matters

Visual Hive must be trusted as measurement infrastructure. If it silently repairs code, creates PRs, approves baselines, or calls agents by default, it becomes another automation risk. Hive should orchestrate agents and governance; Visual Hive should prove what happened and validate whether the repair worked.

## Contract Artifacts

The handoff between products is file-based and no-network by default:

- `hive-export.json`: full deterministic evidence bundle for Hive.
- `hive-beads.json`: direct bead projection for Hive importers.
- `hive-import-manifest.json`: safety and import readiness manifest.
- `hive-agent-work-orders.json`: governed agent work orders.
- `hive-validation-summary.json`: path/secret/schema/dedupe validation summary.
- `hive-setup-pack.json/md`: one-setup instructions Hive can turn into a setup issue/PR.

## Maintainer Review Criteria

- Importer rejects path leaks and secret markers.
- Importer dedupes by `external_ref`.
- PR workflows are read-only/no-secret.
- Trusted publishing/importing never executes PR code.
- Agents never decide Visual Hive verdicts.
- Visual Hive validation command is attached to every repair-oriented bead/work order.
