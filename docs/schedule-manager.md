# Schedule Manager

`visual-hive schedules` writes `.visual-hive/schedules.json`, a safety audit of the lanes that should run in GitHub Actions or locally.

It models:

- pull request checks: read-only, no secrets, PR-safe contracts only
- scheduled checks: deeper deterministic runs and mutation adequacy
- protected checks: secret-backed live/staging targets by secret name only
- mutation adequacy: whether mutation is enabled and scheduled
- trusted issue creation: `workflow_run` consumption of sanitized artifacts

Example:

```bash
visual-hive schedules --config visual-hive.config.yaml --changed-files changed-files.txt
```

The audit includes lane commands, trigger guidance, selected contract IDs, target IDs, missing secret names, safety gaps, and recommendations. It never prints secret values.

The artifact schema is tracked at `schemas/visual-hive.schedules.schema.json`. The Control Plane Schedule Manager page reads the same core model as the CLI.
