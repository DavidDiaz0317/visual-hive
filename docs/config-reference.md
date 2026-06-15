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
- `mutation`: enables mutation adequacy checks.
- `ai`: controls prompt generation only.
- `github`: controls generated markdown labels and PR marker.

Command targets require `serve` and `url`; `install` and `build` are optional. URL targets require only `url`.

Contracts support:

- `selectors.mustExist`
- `selectors.mustNotExist`
- `selectors.textMustExist`
- `selectors.textMustNotExist`
- `screenshots[].route`
- `screenshots[].viewport`
- `screenshots[].fullPage`
- `screenshots[].mask`
