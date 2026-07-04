# @visual-hive/control-plane

Local-first Control Plane UI server for Visual Hive.

This package reads a repository's `visual-hive.config.yaml` and `.visual-hive`
artifacts, serves a safe browser UI, and exposes JSON/image endpoints used by
`visual-hive ui`. It does not call LLMs or require paid provider accounts.

The UI renders the same core models as the CLI for runbooks, readiness gates,
risk registers, coverage, contracts, targets, schedules, baselines, providers,
mutation adequacy, failures, local repository connections, and raw artifacts. In write mode it can
approve or reject reviewed baselines, save validated config drafts after diff
review, add/remove local connection records, and execute a small allowlist of
local Visual Hive runbook commands by command ID. It does not execute arbitrary
browser-supplied shell text, trusted/protected lanes, or secret-bearing lanes.
Run Profiles compose those same allowlisted commands into curated local flows
such as PR acceptance, triage refresh, and mutation adequacy audit. The
snapshot exposes whether each profile is runnable plus a primary blocked reason,
so local UI, CLI, and agent consumers can explain why trusted-only,
secret-bearing, missing-command, or guidance-only profiles cannot run locally.
`--read-only` disables those write and execution actions.
