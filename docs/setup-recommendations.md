# Setup Recommendations

`visual-hive recommend` inspects a target repository and writes `.visual-hive/recommendations.json`. It is a bootstrap aid for real repos that do not yet have a Visual Hive config.

The command detects:

- package manager and root package scripts
- frontend framework hints from dependencies
- stable `data-testid` selectors in source files
- a likely PR-safe `localPreview` target
- a starter visual contract with desktop and mobile screenshots
- an opinionated setup profile such as `free-local`, `component-storybook`, or `complex-app`
- provider recommendations that keep Playwright as the default oracle and external uploads disabled by default
- CI runtime, screenshot, and external upload cost estimates
- PR/scheduled permission guidance and required secret names only
- setup PR file list, steps, and security notes
- repo-specific setup documentation for `docs/visual-hive.md`
- initial changed-file selection and mutation operators

It does not run target code, call LLMs, contact paid visual providers, or decide pass/fail. Playwright contracts remain the only deterministic oracle once the generated config is used.

## Commands

```bash
visual-hive recommend
visual-hive recommend --profile hosted-review
visual-hive recommend --write-config --write-docs
visual-hive recommend --write-setup-bundle
visual-hive recommend --write-config --force
visual-hive recommend --write-docs --force
visual-hive recommend --write-setup-bundle --force
visual-hive recommend --format json
```

`--profile` overrides the inferred setup profile. Supported profiles are `free-local`, `hosted-review`, `component-storybook`, `enterprise-visual-ai`, and `complex-app`. Profile selection changes the generated `project.setupProfile`, provider recommendations, estimated external screenshot budget, scheduled-lane permission guidance, and `costPolicy.maxExternalScreenshotsPerRun`. It still keeps PR external uploads disabled by default and does not make provider calls.

`--write-config` creates `visual-hive.config.yaml` from the recommendation. Existing configs are protected unless `--force` is passed.

`--write-docs` creates `docs/visual-hive.md` from the same deterministic recommendation data. It explains the PR lane, scheduled/protected lane, recommended contracts, provider posture, cost guardrails, baseline review commands, setup PR checklist, and security rules. Existing docs are protected unless `--force` is passed.

`--write-setup-bundle` creates the recommended config, repo docs, and built-in PR, scheduled, and trusted failure-issue workflow templates in one guarded operation. It preflights every output path and refuses to overwrite existing files unless `--force` is passed after review. The bundle records `.visual-hive/config-edits.json`, `.visual-hive/setup-doc-edits.json`, `.visual-hive/workflow-edits.json`, and `.visual-hive/setup-bundle-edits.json`.

The local Control Plane exposes the same guarded setup path from the Setup tab. It reads `.visual-hive/recommendations.json`, validates `recommendedConfigYaml` for config writes, can generate `docs/visual-hive.md` from the same recommendation, refuses accidental overwrites, requires explicit confirmation, and records `.visual-hive/config-edits.json` or `.visual-hive/setup-doc-edits.json`. It can also generate the same setup PR bundle after preflighting every output path. `--read-only` disables these actions.

## Artifact

The report schema is `schemas/visual-hive.recommendations.schema.json`.

Important fields:

- `project`: detected project name, type, package manager, scripts, and framework hints
- `setupProfile`: deterministic setup profile recommendation
- `providerRecommendations`: Playwright and optional hosted-provider guidance, required environment variable names only, and whether external upload is allowed by default
- `costEstimate`: local screenshot count, external screenshot count, CI runtime class, monthly external screenshot estimate, and notes
- `permissions`: least-privilege PR and scheduled-lane recommendations
- `setupPullRequest`: suggested setup PR title, files, steps, and security notes
- `recommendedConfig`: parsed Visual Hive config object
- `recommendedConfigYaml`: YAML that can be written as `visual-hive.config.yaml`
- `recommendedTarget`: target kind, URL, commands, confidence, and reasons; Storybook repos can receive a `storybook` target with story/component globs
- `recommendedContracts`: starter contracts, selectors, screenshots, and reasons
- `detectedSelectors`: top discovered `data-testid` selectors
- `warnings`: setup gaps such as missing preview scripts or missing selectors

## Control Plane

The Control Plane Setup tab reads `.visual-hive/recommendations.json` and shows the setup profile, provider recommendation, cost estimate, permission guidance, setup PR guidance, recommended target, contracts, warnings, and YAML preview. In write mode it can generate the recommended config, `docs/visual-hive.md`, or the full setup PR bundle with confirmation and audit logging; in `--read-only` mode it remains display-only.
