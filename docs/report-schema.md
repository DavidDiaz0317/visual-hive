# Report Schemas

Visual Hive writes stable machine-readable JSON artifacts. `plan.json` uses `schemaVersion: 1`; deterministic and mutation reports use `schemaVersion: 2`.

## Plan

Path: `.visual-hive/plan.json`

Schema: `schemas/visual-hive.plan.schema.json`

The plan records selected targets, contracts, changed files, exclusion reasons, and mutation selection. A plan with no selected contracts is treated as an error by the CLI.

## Deterministic Report

Path: `.visual-hive/report.json`

Schema: `schemas/visual-hive.report.schema.json`

The report records deterministic Playwright contract results. `status` is `failed` if any selected contract failed.

Top-level fields include project, mode, generated time, changed files, selected targets, selected contracts, excluded contracts, generated spec path, target lifecycle events, summary counts, aggregate console/page errors, artifacts, and reproduction commands. Summary counts include passed/failed contracts, screenshot pass/fail counts, created baselines, missing baselines, visual diffs, and console/page errors.

Per-contract fields include selector assertions, screenshot assertions, console/page/network errors, artifacts, duration, and a reproduction command. Screenshot assertions include contract ID, screenshot name, route, viewport, baseline path, actual path, optional diff path, max diff thresholds, actual diff ratio, diff pixel count, and `passed | failed | created | missing_baseline` status.

## Mutation Report

Path: `.visual-hive/mutation-report.json`

Schema: `schemas/visual-hive.mutation-report.schema.json`

The mutation report records one row per operator. `score` is killed applicable mutations divided by total applicable mutations. A mutation is killed when deterministic contracts fail under the injected mutation. Non-applicable mutations have status `not_applicable` and are excluded from the score denominator.
