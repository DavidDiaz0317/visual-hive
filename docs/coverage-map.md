# Coverage Map

`visual-hive coverage` writes `.visual-hive/coverage.json`. The first version is config/report based, so it does not require static route discovery or a backend service.

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

`visual-hive improve-coverage` writes `.visual-hive/coverage-recommendations.json`. It is deterministic: it reads coverage gaps and mutation survivors, then emits concrete recommendations such as starter contracts, screenshot additions, changed-file rules, selector assertions, or mutation mappings. It also includes YAML snippets for humans to review before editing `visual-hive.config.yaml`. The artifact schema is tracked at `schemas/visual-hive.coverage-recommendations.schema.json`.

To turn one recommendation into a guarded config edit, copy its `ID` and preview the diff first:

```bash
visual-hive improve-coverage --apply changed-file-rule:src/auth/Login.tsx
```

Visual Hive validates the resulting config and prints a diff without writing. After review, apply it explicitly:

```bash
visual-hive improve-coverage --apply changed-file-rule:src/auth/Login.tsx --yes
```

This path is intentionally not automatic. It helps beginners make progress from a concrete recommendation while preserving the same review-before-write safety model used by setup generation and the Control Plane config editor. For mutation-survivor recommendations, the guarded apply path maps the operator to the selected contract and merges the suggested selector assertions into that contract so the next mutation run has a real deterministic oracle to kill the survivor.

The artifact schema is tracked at `schemas/visual-hive.coverage.schema.json`. The Control Plane reads the same core coverage model, so CLI and UI coverage views stay consistent.
