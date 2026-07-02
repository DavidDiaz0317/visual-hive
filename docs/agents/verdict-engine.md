# Visual Hive Verdict Engine

Visual Hive's Verdict Engine is the pass/fail authority. Playwright is the default first-party browser runner and primary local evidence source, but the final decision is a Visual Hive verdict assembled from normalized deterministic evidence.

## Artifact Contract

Run:

```bash
visual-hive evidence --config visual-hive.config.yaml
visual-hive verdict --config visual-hive.config.yaml
```

Outputs:

- `.visual-hive/evidence-packet.json`: full evidence packet for humans, GitHub, Hive, and agents.
- `.visual-hive/verdict.json`: compact verdict report with gating and advisory contributions.
- `.visual-hive/verdict.md`: sanitized Markdown summary.

## Policy

The verdict report separates:

- `gatingContributions`: evidence allowed to affect the final verdict.
- `advisoryContributions`: evidence useful for repair, triage, handoff, or review, but not allowed to decide pass/fail.

LLM output, MCP summaries, Hive recommendations, and agent judgment must stay advisory. Provider output can become gating only when it is normalized, trusted, explicitly configured, and budget-authorized.

## Statuses

The final verdict can be:

- `passed`
- `failed`
- `warning`
- `blocked`
- `inconclusive`

`blocked` is distinct from `failed`. Missing required evidence, policy refusal, unsafe target selection, missing secrets, or target startup failure can block a verdict without pretending the product regressed.

## Agent Use

Agents may consume `.visual-hive/verdict.json` to decide what to inspect next, which reproduction command to run, or what missing tests to suggest. They must not override the verdict, approve baselines, enable external providers, create GitHub issues, or run protected targets without the configured trusted workflow/human approval path.
