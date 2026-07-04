# Coverage Map

`visual-hive coverage` writes `.visual-hive/coverage.json`. The first version is config/report based, so it does not require static route discovery or a backend service.

The generated JSON includes an `outputResource` row that identifies it as the catalog-backed read-only coverage resource `visual-hive://coverage-map`. This lets the Control Plane, artifact index, MCP manifest, Agent Packets, and external consumers recognize coverage-map evidence without guessing from file paths. Reading the artifact does not authorize config edits, test edits, target execution, or verdict changes.

It records:

- targets and their configured contracts
- selected vs unselected contracts from the latest plan or an in-memory plan
- PR-safe, protected, and schedule-only coverage
- screenshot routes and viewports
- changed-file selection rules and matched files
- uncovered targets, assertion-free contracts, unmatched changed files, and other actionable gaps

Example:

```bash
visual-hive plan --mode pr --changed-files changed-files.txt
visual-hive coverage --changed-files changed-files.txt
visual-hive improve-coverage
```

`visual-hive improve-coverage` writes `.visual-hive/coverage-recommendations.json`. It is deterministic: it reads coverage gaps, flow gaps, and mutation survivors, then emits concrete recommendations such as starter contracts, screenshot additions, changed-file rules, selector assertions, flow steps, or mutation mappings. It also includes YAML snippets for humans to review before editing `visual-hive.config.yaml`. Flow recommendations include lane/trusted-only context so protected targets stay in scheduled or manual trusted lanes. The artifact schema is tracked at `schemas/visual-hive.coverage-recommendations.schema.json`, and the JSON includes the read-only catalog identity `visual-hive://coverage-recommendations` / `visual_hive_read_coverage_recommendations` for agents and MCP consumers.

To turn one recommendation into a guarded config edit, copy its `ID` and preview the diff first:

```bash
visual-hive improve-coverage --apply changed-file-rule:src/auth/Login.tsx
```

Visual Hive validates the resulting config and prints a diff without writing. After review, apply it explicitly:

```bash
visual-hive improve-coverage --apply changed-file-rule:src/auth/Login.tsx --yes
```

This path is intentionally not automatic. It helps beginners make progress from a concrete recommendation while preserving the same review-before-write safety model used by setup generation and the Control Plane config editor. For flow recommendations, the guarded apply path merges suggested `steps` into the selected contract so screenshots gain user-journey evidence. For mutation-survivor recommendations, the guarded apply path maps the operator to the selected contract and merges the suggested selector assertions into that contract so the next mutation run has real deterministic evidence to kill the survivor.

The artifact schema is tracked at `schemas/visual-hive.coverage.schema.json`. The Control Plane reads the same core coverage model, so CLI and UI coverage views stay consistent.
