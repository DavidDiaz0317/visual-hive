# Local Repository Connections

`visual-hive connections` manages `.visual-hive/connections.json`, a local-only store of repositories that the Control Plane can show and switch between.

The file stores:

- connection ID and label
- local repository path
- config path inside that repository
- tags

`visual-hive connections list` and the Control Plane inspect those paths at runtime to show readiness status, project name, latest deterministic status, report age, mutation score, coverage gaps, risk score, and attention reasons when the corresponding `.visual-hive` artifacts exist.

It does not store credentials, tokens, cookies, provider secrets, kubeconfigs, or LLM keys. Required secrets are still represented by name only in target/provider audits.

Example:

```bash
visual-hive connections add --repo ../console --id kubestellar-console --label "KubeStellar Console" --tag dogfood
visual-hive connections list
```

The Control Plane `Connections` page reads and can manage the same store in write mode. It can add a local repo path, optional config path, stable ID, label, and tags, then switch only to stored ready connection IDs. Removing a connection deletes only the local connection record; it does not delete the target repository or any Visual Hive artifacts inside that repository.

`visual-hive ui --read-only` disables connection add/remove actions. Switching repositories still uses a connection ID already present in `.visual-hive/connections.json`; the browser cannot switch to arbitrary paths.

## Health summary

The connection health dashboard is derived, not stored. For each connected repo Visual Hive reads:

- `visual-hive.config.yaml` to validate readiness and project name
- `.visual-hive/report.json` for latest deterministic status and timestamp
- `.visual-hive/mutation-report.json` for mutation score, minimum score, and killed/total count
- `.visual-hive/coverage.json` for uncovered targets, uncovered contracts, and high/medium/low coverage gaps
- `.visual-hive/risk.json` for risk score and highest severity

Health states:

- `ready`: config is valid and available evidence does not need operator attention
- `attention`: config is valid, but the repo has no deterministic report, a stale deterministic report, a failed deterministic run, missing coverage audit, high coverage gaps, mutation score below its minimum, or a high/critical risk register
- `blocked`: repo path, config path, or config validation is broken

The summary counts failed deterministic reports, missing deterministic reports, stale deterministic reports, missing coverage audits, coverage gaps, high coverage gaps, weak mutation scores, high-risk registers, blocked repos, and repos needing attention. Secret values are never read from the target repos; protected target audits show required environment variable names only.

Schema: `schemas/visual-hive.connections.schema.json`.
