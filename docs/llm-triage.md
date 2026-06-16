# LLM Triage

LLM support is prompt-only by default. No API key is required and no network call is made.

The LLM adapter builds prompts for:

- visual failure triage
- missing coverage review
- mutation survivor review
- baseline review summary
- repair planning

Every prompt states that LLM output is advisory only. Deterministic Playwright contracts and mutation results remain the only pass/fail oracle.

`visual-hive triage` writes local artifacts:

- `.visual-hive/triage.json`
- `.visual-hive/triage-prompt.md`
- `.visual-hive/repair-prompt.md`
- `.visual-hive/missing-tests.md`
- `.visual-hive/baseline-review.md`
- `.visual-hive/issue.md`
- `.visual-hive/pr-comment.md`
- `.visual-hive/llm-usage.json`

The prompt and markdown artifacts are sanitized before writing. They are inputs for a human, a PR comment step, or a separately governed LLM workflow; they do not call an LLM and they do not affect pass/fail status.

`triage.json` is the machine-readable offline finding report. It includes classifications, severity, evidence, related contract/target IDs, suggested files, and suggested next tests for the Control Plane and trusted artifact workflows.

`baseline-review.md` summarizes created, failed, and missing-baseline screenshots plus any local baseline approval or rejection decisions. It is advisory context for human review; it never approves a baseline or changes pass/fail status.

If `.visual-hive/coverage.json` exists, triage includes it in the missing-coverage prompt and converts coverage gaps into `insufficient_coverage` findings. The offline classifier also recognizes:

- `visual_diff`
- `missing_baseline`
- `created_baseline`
- `flaky_baseline`
- `missing_element`
- `unexpected_element`
- `login_regression`
- `api_contract_regression`
- `console_error`
- `page_error`
- `target_startup_failure`
- `provider_failure`
- `provider_cost_policy_skipped`
- `external_upload_blocked`
- `protected_target_missing_secret`
- `mutation_survivor`
- `possible_flake`
- `no_contracts_selected`
- `environment_failure`
- `insufficient_coverage`

`llm-usage.json` records prompt tasks, estimated tokens, estimated input cost, prompt-only status, budget status, and `callsMade: 0`. It includes `baseline_review_summary` when `visual-hive triage` writes `baseline-review.md`, and uses the config values under `ai.model`, `ai.maxPromptTokens`, and `ai.maxEstimatedCostUsd`.

Run `visual-hive llm` to re-audit the existing prompt artifacts without regenerating triage. It reads known `.visual-hive` prompt/markdown artifacts, rewrites `.visual-hive/llm-usage.json`, prints budget status, and still records `callsMade: 0`.

The Control Plane LLM page reads the same artifact and shows prompt availability, budget warnings, and governance recommendations. It never performs a model call.
