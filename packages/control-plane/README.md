# @visual-hive/control-plane

Local-first Control Plane UI server for Visual Hive.

This package reads a repository's `visual-hive.config.yaml` and `.visual-hive`
artifacts, serves a safe browser UI, and exposes JSON/image endpoints used by
`visual-hive ui`. It does not call LLMs or require paid provider accounts.

The UI renders the same core models as the CLI for runbooks, risk registers,
coverage, contracts, targets, schedules, baselines, providers, mutation adequacy,
failures, local repository connections, and raw artifacts. In write mode it can
approve or reject reviewed baselines, save validated config drafts after diff
review, add/remove local connection records, and execute a small allowlist of
local Visual Hive runbook commands by command ID. It does not execute arbitrary
browser-supplied shell text, trusted/protected lanes, or secret-bearing lanes.
`--read-only` disables those write and execution actions.
