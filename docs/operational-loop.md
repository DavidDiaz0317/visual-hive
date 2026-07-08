# Visual Hive Operational Loop

Visual Hive's production loop is issue-centric:

```text
scan repo -> plan checks -> run deterministic checks -> run mutation adequacy -> derive real issue candidates -> trusted issue publish/update -> Hive handoff -> Hive repairs -> Visual Hive validates repair PRs
```

Visual Hive owns detection, evidence, issue candidates, Hive work orders, and validation. Hive or a human repair agent owns code changes and pull requests.

## Commands

```bash
visual-hive loop run --config visual-hive.config.yaml --mode full --bootstrap-baselines --ci
visual-hive loop derive-issues --config visual-hive.config.yaml
visual-hive loop lifecycle --config visual-hive.config.yaml
```

`loop run` executes the repeatable evidence chain: repo analysis, planning, deterministic Playwright-backed checks, mutation adequacy, coverage/test maintenance analysis, verdict, Evidence Packet, artifact index, MCP manifest, Hive export, beads, and work orders.

`loop derive-issues` creates issue candidates from real artifacts only:

- failed deterministic contracts
- visual diffs
- missing or created baselines requiring review
- mutation survivors
- coverage and maintenance gaps
- workflow safety findings
- readiness or target startup failures
- provider governance blocks when a provider is explicitly enabled

Synthetic seeded findings are excluded by default. Use an explicitly separate smoke workflow if you need to test issue plumbing.

`loop lifecycle` records active, update, resolved-candidate, and suppressed issue state. Visual Hive does not auto-close by default. A trusted workflow may close resolved candidates only when repository policy explicitly enables `VISUAL_HIVE_CLOSE_RESOLVED=true`.

## Generated Setup

```bash
visual-hive loop init --profile github-hive
```

The generated scaffold keeps the default safety boundary:

- PR workflow uses `pull_request`, read-only permissions, no secrets, and no issue creation.
- Live detection runs scheduled/manual checks and uploads `.visual-hive` artifacts.
- Trusted publisher consumes sanitized artifacts and publishes/updates issues by dedupe fingerprint.
- Lifecycle workflow marks active or resolved-candidate evidence.
- Seeded smoke is manual-only and separated from live detection.

Until Visual Hive is published to npm, generated consumers can use `VISUAL_HIVE_CLI` or a sibling checkout resolver.

## Issue Handoff Contract

Issue candidates use stable fingerprints:

```text
visual-hive:<repo>:<kind>:<surface>:<hash>
```

Published issue bodies must include:

- deterministic evidence summary
- affected route/component/selector/contract/mutation
- artifact/resource links
- validation command
- suggested Hive agent or work order
- guardrails against baseline approval and threshold weakening
- the ownership rule: Visual Hive validates; Hive repairs

Default Hive routing labels:

```text
visual-hive
hive/quality
visual-hive/live
visual-hive/ready-for-hive
```

Visual Hive does not create repair branches, open repair pull requests, call Hive APIs, call LLMs, or call paid providers by default.
