# Run History

`visual-hive history --record` archives the latest Visual Hive artifacts into `.visual-hive/history/<run-id>/` and updates `.visual-hive/history.json`.

It records:

- deterministic status, mode, selected targets, selected contracts, and changed files
- repository, branch, commit, pull request, and CI run context when available in the source report
- failed contracts, visual diffs, created/missing baselines, console errors, and page errors
- mutation score, killed count, and total applicable mutations
- provider result statuses
- links to archived plan, report, mutation report, issue body, PR comment, triage, coverage, contract, flow, target, and schedule artifacts when present
- latest-vs-previous trend direction, including deterministic status changes, mutation score delta, failed contract delta, visual diff delta, baseline delta, console error delta, and page error delta

Example:

```bash
visual-hive plan --mode pr
visual-hive run --ci
visual-hive mutate
visual-hive triage
visual-hive coverage
visual-hive contracts
visual-hive flows
visual-hive targets
visual-hive schedules
visual-hive history --record
```

Use `visual-hive history` without `--record` to print the existing history index. If no index exists, the CLI summarizes the latest report/mutation artifacts without copying files.

The `trend` section compares the latest recorded run with the previous recorded run. It is intentionally simple and deterministic: a recovered deterministic status, higher mutation score, fewer failed contracts, fewer visual diffs, fewer missing/created baselines, and fewer console/page errors move the direction toward `improved`; the opposite moves it toward `regressed`. With fewer than two runs, the trend is `unknown`.

The artifact schema is tracked at `schemas/visual-hive.history.schema.json`. The Control Plane Runs page uses the same model to show run trends and archived report links.
