# Report Schemas

Visual Hive writes stable machine-readable JSON artifacts with `schemaVersion: 1`.

## Plan

Path: `.visual-hive/plan.json`

Schema: `schemas/visual-hive.plan.schema.json`

The plan records selected targets, contracts, changed files, exclusion reasons, and mutation selection. A plan with no selected contracts is treated as an error by the CLI.

## Deterministic Report

Path: `.visual-hive/report.json`

Schema: `schemas/visual-hive.report.schema.json`

The report records deterministic Playwright contract results. `status` is `failed` if any selected contract failed. Each result includes errors and artifact paths, including screenshots and the generated Playwright spec when present.

## Mutation Report

Path: `.visual-hive/mutation-report.json`

Schema: `schemas/visual-hive.mutation-report.schema.json`

The mutation report records one row per operator. `score` is `killed / total`. A mutation is killed when deterministic contracts fail under the injected mutation.
