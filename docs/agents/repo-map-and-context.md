# Repo Map And Context

Visual Hive repo intelligence starts with a read-only scan:

```bash
visual-hive analyze --repo . --out .visual-hive/repo-map.json --markdown .visual-hive/repo-context.md
```

Outputs:

- `.visual-hive/repo-map.json` (`visual-hive://repo-map` / `visual_hive_read_repo_map`)
- `.visual-hive/repo-context.md` (`visual-hive://repo-context` / `visual_hive_read_repo_context`)

Schema:

- `schemas/visual-hive.repo-map.schema.json`

## Purpose

The repo map gives humans and agents a compact view of the target repository before they generate config, run checks, or load broad source context.

It detects:

- package manager and workspace hints;
- package scripts and likely local preview commands;
- framework and test-tool signals;
- stable `data-testid` selectors;
- route hints;
- GitHub workflow triggers, permissions, secret references, artifact uploads, and `pull_request_target` risk;
- target hints such as `localPreview`, Storybook, deploy preview, and fullstack command groups;
- risk signals and testing-layer coverage gaps;
- `visualMap` lifecycle evidence that connects files, components, layouts, routes, states, viewports, targets, contracts, screenshots, mutations, and issue/handoff findings.

New repo-map artifacts include an `outputResource` row that identifies `.visual-hive/repo-map.json` as `visual-hive://repo-map` with read tool `visual_hive_read_repo_map`. The schema keeps this field optional for older artifacts, but new agent-forward flows should preserve it so MCP clients, Agent Packets, artifact indexes, and the Control Plane do not guess resource identity from paths.

## Agent Policy

Agents should read `.visual-hive/repo-context.md` and `.visual-hive/repo-map.json` before loading large source folders. Both artifacts are catalog-backed read-only evidence resources, so MCP clients, Agent Packets, the artifact index, and the Control Plane can refer to the same repo intelligence without path guessing. The map is an efficiency layer, not an oracle.

Visual Hive's deterministic Verdict Engine still owns pass/fail. Repo intelligence only informs setup, planning, contract authoring, and handoff context.

Reading repo-map or repo-context evidence must not authorize setup writes, workflow edits, baseline changes, target execution, provider uploads, LLM calls, Hive calls, or verdict changes.

Agents should prefer `visualMap` node IDs and edges when explaining impact, proposing missing tests, or preparing Hive issue context. Findings include fingerprints and status fields so later analysis can update or supersede stale map evidence instead of treating old observations as permanent truth.

## Recommended Flow

1. Run `visual-hive analyze --repo .`.
2. Review target hints and risk signals.
3. Run `visual-hive recommend` to generate a setup recommendation.
4. Author or update `visual-hive.config.yaml`.
5. Run `visual-hive doctor`, `plan`, `run`, `triage`, `evidence`, and `context`.
