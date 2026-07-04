# Test Creation Plan

The Test Creation Plan is an advisory bridge between Visual Hive evidence and human or agent-authored test improvements.

Run:

```bash
visual-hive evidence --config visual-hive.config.yaml
visual-hive handoff --dry-run --config visual-hive.config.yaml
visual-hive test-creation-plan --config visual-hive.config.yaml
```

Outputs:

- `.visual-hive/test-creation-plan.json`
- `.visual-hive/test-creation-plan.md`

Schema: `schemas/visual-hive.test-creation-plan.schema.json`

Catalog resource: `visual-hive://test-creation-plan`

Read tool: `visual_hive_read_test_creation_plan`

Generated JSON includes an `outputResource` block that repeats the catalog identity inside the artifact itself:

- `artifactPath: .visual-hive/test-creation-plan.json`
- `evidenceResourceId: test-creation-plan`
- `evidenceResourceUri: visual-hive://test-creation-plan`
- `evidenceReadToolName: visual_hive_read_test_creation_plan`

Agents and trusted workflow consumers should use that metadata instead of guessing from paths.

## Inputs

The command reads:

- `.visual-hive/evidence-packet.json` for testing-layer gaps and mutation survivors.
- `.visual-hive/coverage-recommendations.json` when coverage improvement analysis exists.
- `.visual-hive/handoff.json` when Hive/GitHub handoff work items exist.

Missing optional inputs are treated as absent evidence, not as failures.

## Governance

The plan always declares:

- `verdictAuthority: visual_hive`
- `agentAuthority: advisory_test_generation_only`
- `writePolicy: no_config_or_test_files_written`
- `secretPolicy: redacted_values_names_only`

It does not decide pass/fail, approve baselines, enable providers, run protected targets, call LLMs, or write tests. It gives humans and agents a bounded, sanitized list of suggested tests to author.

## Recommendation Sources

Recommendations can come from:

- missing or partial testing layers;
- coverage recommendations;
- mutation survivors;
- handoff work items whose kind is `test_creation`.

Each recommendation includes a source, kind, priority, rationale, suggested tests, optional YAML snippet, artifact pointers, trusted-only flag, and `applyMode: advisory_no_write`.

## Agent Use

`visual-hive agent-packet --profile test_creator` automatically includes recommendations from `.visual-hive/test-creation-plan.json` when it exists. The receiving agent may draft tests or config patches, but a human or trusted workflow must still review and apply changes.
