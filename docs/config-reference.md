# Config Reference

`visual-hive.config.yaml` is validated with zod.

The JSON Schema for editor support is tracked at `schemas/visual-hive.config.schema.json`.

```yaml
# yaml-language-server: $schema=./schemas/visual-hive.config.schema.json
```

Required sections:

- `project`: `name`, `type`, and `defaultBranch`.
- `targets`: command or URL targets.
- `contracts`: selector and screenshot checks.
- `viewports`: named viewport dimensions.

Optional sections with defaults:

- `selection.changedFiles`: maps glob patterns to contract IDs.
- `visual`: controls screenshot diff thresholds and baseline update behavior.
- `mutation`: enables mutation adequacy checks.
- `ai`: controls prompt generation only.
- `github`: controls generated markdown labels and PR marker.

Target kinds:

- `url`: checks an already-running or hosted URL.
- `command`: optionally runs `install` and `build`, then starts one long-running `serve` command with a health `url`.
- `commandGroup`: runs setup commands, starts named services with health URLs and optional `readinessTimeoutMs`, and then optional teardown commands.
- `protected`: schedule/manual-only target for secret-backed environments; `url` is optional when services are configured, `cost` defaults to `expensive`, and missing `requiresSecrets` are reported by name only.

Contracts support:

- `waitFor[]`
- `timeoutMs`
- `failOnConsoleError`
- `expectedConsoleErrors`
- `selectors.mustExist`
- `selectors.mustNotExist`
- `selectors.textMustExist`
- `selectors.textMustNotExist`
- `screenshots[].route`
- `screenshots[].viewport`
- `screenshots[].fullPage`
- `screenshots[].mask`

Visual defaults:

```yaml
visual:
  maxDiffPixelRatio: 0.01
  updateSnapshots: false
  failOnMissingBaselineInCI: true
  snapshotDir: ".visual-hive/snapshots"
  artifactDir: ".visual-hive/artifacts"
```

`snapshotDir` and `artifactDir` must be repo-relative paths and cannot contain `..` traversal.
