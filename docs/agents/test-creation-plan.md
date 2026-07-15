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
- `visual-hive.config.yaml` and optional `.visual-hive/repo-map.json` for exact contract, target, route, viewport, selector, component, state, and mutation-mapping facts.

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

Each v2 recommendation includes a source, kind, priority, rationale, evidence-grounded suggested tests, artifact pointers, trusted-only flag, and `applyMode: advisory_no_write`. The builder does not emit placeholder YAML or repository-specific selectors inferred from names.

Recommendations also include agent-forward context so Hive Quality/Tester agents can act without scraping prose:

- `gapId`: stable identifier for the missing layer, coverage gap, mutation survivor, or handoff work item.
- `affected`: route/component/viewport/state context copied only from exact config or repository-map evidence. It is empty when unresolved.
- `currentEvidence`: sanitized evidence lines and artifact pointers that explain why the recommendation exists.
- `grounding`: `grounded` or `unresolved`, with exact evidence references and explicit unresolved reasons.
- `suggestedContract`: a required bounded contract shape. `route` is optional and `selectors` may be empty; positive/interaction selectors, negative selectors, required/forbidden text, and screenshot masks remain separate so an agent cannot invert assertion meaning. Values are populated only from exact config/repository-map facts.
- `suggestedMutation`: an operator observed on the recommendation, an exact config mapping for the grounded contract, or `not_applicable`.
- `validationCommand`: the Visual Hive command path that should prove the added test or config.
- `hiveOwner`: suggested Hive ownership: `quality`, `tester`, or `ci-maintainer`.

An unresolved recommendation is a mapping task, not permission to guess selectors, routes, components, states, viewports, targets, mutations, or configuration. These fields are advisory. They do not authorize autonomous writes, baseline approval, provider enablement, threshold changes, or verdict-policy changes.

## Agent Use

`visual-hive agent-packet --profile test_creator` automatically includes recommendations from `.visual-hive/test-creation-plan.json` when it exists. The receiving agent may draft tests or config patches, but a human or trusted workflow must still review and apply changes.
