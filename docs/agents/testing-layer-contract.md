# Testing Layer Contract

Visual Hive models quality evidence as a layer lattice rather than a single screenshot check. Run:

```bash
visual-hive evidence --config visual-hive.config.yaml
visual-hive layers --config visual-hive.config.yaml
```

Outputs:

- `.visual-hive/testing-layers.json`
- `.visual-hive/testing-layers.md`

## Layers

0. Repo intelligence
1. Static/build/workflow safety
2. Unit
3. Component/accessibility
4. API/contract
5. Component visual
6. E2E user-flow
7. Cross-browser/device provider
8. Canary/protected
9. Mutation/fault injection
10. Flake/history/cost governance
11. Agent/Hive feedback

## Statuses

- `covered`: normalized evidence exists.
- `partial`: some evidence exists, but gaps remain.
- `missing`: expected evidence is absent.
- `not_applicable`: the layer does not apply to the current project or lane.
- `unknown`: Visual Hive cannot yet determine the layer status.

The report records `skippedReasons` and `recommendedNextStep` for non-covered layers so humans and agents can see why evidence is missing without treating advisory guidance as a verdict.

When `visual-hive handoff --dry-run` runs from an Evidence Packet, non-covered layers are also translated into Handoff Packet work items:

- setup-oriented layers such as repo intelligence, workflow safety, provider, and protected/canary evidence become `setup` tasks;
- test-oriented layers such as unit, accessibility, API/contract, component visual, E2E, and mutation evidence become `test_creation` tasks;
- governance/history/agent-feedback layers become `review` tasks.

This is intentionally separate from pass/fail. The layer audit can tell an agent what to improve next, but only Visual Hive's normalized deterministic verdict can fail or pass the run.

Run `visual-hive test-creation-plan --config visual-hive.config.yaml` after `evidence` and optional `handoff` to turn test-oriented layer gaps into `.visual-hive/test-creation-plan.json` and `.visual-hive/test-creation-plan.md`. The plan is advisory and no-write: it suggests selector assertions, screenshots, flows, accessibility checks, API contracts, or mutation mappings, but it does not edit config or test files.

## Agent Policy

Agents may use this report to suggest tests, setup changes, or handoff tasks. They must not decide pass/fail, approve baselines, enable external providers, or run protected targets. Visual Hive's deterministic Verdict Engine remains the authority.
