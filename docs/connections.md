# Local Repository Connections

`visual-hive connections` manages `.visual-hive/connections.json`, a local-only store of repositories that the Control Plane can show and switch between.

The file stores:

- connection ID and label
- local repository path
- config path inside that repository
- tags

`visual-hive connections list` and the Control Plane inspect those paths at runtime to show readiness status, project name, latest deterministic status, report age, mutation score, coverage gaps, risk score, readiness gate status, security score, cost budget status, and attention reasons when the corresponding `.visual-hive` artifacts exist.

It does not store credentials, tokens, cookies, provider secrets, kubeconfigs, or LLM keys. Required secrets are still represented by name only in target/provider audits.

Example:

```bash
visual-hive connections add --repo ../console --id kubestellar-console --label "KubeStellar Console" --tag dogfood
visual-hive connections list
visual-hive connections list --write
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
- `.visual-hive/readiness.json` for blocked/warning readiness gates and readiness score
- `.visual-hive/security.json` for security score and critical/high finding counts
- `.visual-hive/costs.json` for budget status and provider cost-policy blocks

Health states:

- `ready`: config is valid and available evidence does not need operator attention
- `attention`: config is valid, but the repo has no deterministic report, a stale deterministic report, a failed deterministic run, missing coverage audit, high coverage gaps, mutation score below its minimum, a high/critical risk register, blocked/warning readiness gates, security findings, or a blocked/warning cost policy
- `blocked`: repo path, config path, or config validation is broken

The summary counts failed deterministic reports, missing deterministic reports, stale deterministic reports, missing coverage audits, coverage gaps, high coverage gaps, weak mutation scores, high-risk registers, readiness gates needing review, security audits needing review, cost policies needing review, blocked repos, and repos needing attention. Secret values are never read from the target repos; protected target audits show required environment variable names only.

## Portfolio queues

The runtime connection index also derives portfolio queues for multi-repo triage:

- `broken_setup`: repo/config paths or config validation block useful evidence
- `deterministic_failures`: latest deterministic Playwright-backed run failed
- `missing_reports`: config is valid but no deterministic report exists
- `stale_reports`: latest deterministic report is older than the built-in freshness threshold
- `missing_coverage`: a deterministic report exists but no coverage audit has been generated
- `coverage_gaps`: coverage audit found uncovered areas
- `weak_mutation`: mutation score is below the configured minimum
- `high_risk`: risk register has high/critical risk or a high aggregate score
- `readiness_blocked`: readiness gates are blocked or warning
- `security_risks`: security audit has critical/high findings or low score
- `cost_policy`: cost audit is warning or blocked
- `healthy`: valid connected repos with no derived attention signals

The Control Plane Portfolio page renders these queues as an operator view. `visual-hive connections list` prints the same queues in markdown so the CLI/core path remains usable without the UI.

Pass `--write` to persist the derived runtime view to `.visual-hive/connections-portfolio.json`. That artifact is safe to upload from CI because it contains local paths, health summaries, artifact-derived scores, and required secret names only; it must not contain secret values. The editable connection store remains `.visual-hive/connections.json`.

Schema: `schemas/visual-hive.connections.schema.json`.
Portfolio schema: `schemas/visual-hive.connections-portfolio.schema.json`.
