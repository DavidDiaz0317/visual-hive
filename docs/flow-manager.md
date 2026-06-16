# Flow Manager

`visual-hive flows` audits deterministic user-flow coverage from `visual-hive.config.yaml` and the latest `.visual-hive/report.json`.

Screenshots catch layout drift. Flow steps catch whether important user-visible behavior still works. A mature contract should usually combine selectors, screenshots, and at least one deterministic flow for high-risk actions such as login, route transitions, filters, form submission, protected-route guards, and critical dashboard actions.

## Command

```bash
visual-hive flows --config visual-hive.config.yaml --mode pr --changed-files changed-files.txt
```

The command writes `.visual-hive/flows.json` with schema `schemas/visual-hive.flows.schema.json`.

## What It Reports

- contracts with and without flow steps
- selected flow contracts from the current or in-memory plan
- navigation, interaction, wait, and assertion step counts
- latest passed and failed flow steps from `report.json`
- gaps such as critical contracts without flows, flows without explicit `goto`, and flows with interactions but no assertions
- recommendations for which contracts to strengthen

## Safety Model

`visual-hive flows` does not execute app code. It reads config, plan, and report artifacts only. Deterministic Playwright execution still happens through `visual-hive run`; the flow audit explains coverage and gaps after or before that run.

## Suggested Use

Run `visual-hive flows` after `visual-hive run` in PR and scheduled workflows. Use it alongside `visual-hive contracts`, `visual-hive coverage`, and `visual-hive improve-coverage` to decide which user journeys need stronger deterministic protection.
