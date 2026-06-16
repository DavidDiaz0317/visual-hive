# Target Manager

`visual-hive targets` writes `.visual-hive/targets.json`, a config/report-based audit of every target.

It records:

- target ID, kind, URL, PR-safe status, cost, and schedule
- beginner labels such as `Safe on PR`, `Protected`, `Expensive`, `Schedule-only`, and `Needs setup`
- deploy-preview URL readiness, including missing `urlEnv` names without printing values
- required secret environment variable names and missing names only
- command target install/build/serve commands
- commandGroup/protected setup, service, readiness, and teardown settings
- contracts that use each target and currently selected contracts
- latest lifecycle events from `report.json`
- gaps and recommendations

Example:

```bash
visual-hive plan --mode pr --changed-files changed-files.txt
visual-hive run --ci
visual-hive targets --changed-files changed-files.txt
```

The artifact schema is tracked at `schemas/visual-hive.targets.schema.json`. The Control Plane Target Manager page reads the same core audit model as the CLI.
