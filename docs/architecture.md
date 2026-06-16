# Architecture

Visual Hive is split into small packages:

- `@visual-hive/core`: config validation, plan creation, report types, mutation scoring, and filesystem utilities.
- `@visual-hive/cli`: user-facing commands.
- `@visual-hive/playwright-adapter`: deterministic generated Playwright specs and execution.
- `@visual-hive/github-adapter`: sanitized PR comments and issue bodies.
- `@visual-hive/llm-adapter`: offline findings and LLM-ready prompts.

Tracked JSON Schemas live in `schemas/` for config, plan, deterministic reports, mutation reports, security audits, and the other management artifacts written under `.visual-hive`.

The core flow is:

1. Load `visual-hive.config.yaml`.
2. Build `.visual-hive/plan.json`.
3. Generate `.visual-hive/generated/visual-hive.generated.spec.ts`.
4. Run Playwright contracts.
5. Write `.visual-hive/report.json`.
6. Optionally run mutation adequacy and write `.visual-hive/mutation-report.json`.
7. Generate sanitized triage artifacts.

Playwright is the only default execution engine. Paid visual providers are intentionally outside the required path.
