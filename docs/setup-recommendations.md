# Setup Recommendations

`visual-hive recommend` inspects a target repository and writes `.visual-hive/recommendations.json`. It is a bootstrap aid for real repos that do not yet have a Visual Hive config.

The command detects:

- package manager and root package scripts
- frontend framework hints from dependencies
- stable `data-testid` selectors in source files
- a likely PR-safe `localPreview` target
- a starter visual contract with desktop and mobile screenshots
- initial changed-file selection and mutation operators

It does not run target code, call LLMs, contact paid visual providers, or decide pass/fail. Playwright contracts remain the only deterministic oracle once the generated config is used.

## Commands

```bash
visual-hive recommend
visual-hive recommend --write-config
visual-hive recommend --write-config --force
visual-hive recommend --format json
```

`--write-config` creates `visual-hive.config.yaml` from the recommendation. Existing configs are protected unless `--force` is passed.

## Artifact

The report schema is `schemas/visual-hive.recommendations.schema.json`.

Important fields:

- `project`: detected project name, type, package manager, scripts, and framework hints
- `recommendedConfig`: parsed Visual Hive config object
- `recommendedConfigYaml`: YAML that can be written as `visual-hive.config.yaml`
- `recommendedTarget`: target kind, URL, commands, confidence, and reasons
- `recommendedContracts`: starter contracts, selectors, screenshots, and reasons
- `detectedSelectors`: top discovered `data-testid` selectors
- `warnings`: setup gaps such as missing preview scripts or missing selectors

## Control Plane

The Control Plane Setup tab reads `.visual-hive/recommendations.json` and shows the recommended target, contracts, warnings, and YAML preview. It is read-only; config creation remains an explicit CLI action.
