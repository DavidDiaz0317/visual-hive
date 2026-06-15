# @visual-hive/control-plane

Local-first Control Plane UI server for Visual Hive.

This package reads a repository's `visual-hive.config.yaml` and `.visual-hive`
artifacts, serves a safe browser UI, and exposes JSON/image endpoints used by
`visual-hive ui`. It does not execute target code, call LLMs, or require paid
provider accounts.

The UI renders the same core models as the CLI for coverage, contracts, targets,
schedules, baselines, providers, mutation adequacy, failures, and raw artifacts.
