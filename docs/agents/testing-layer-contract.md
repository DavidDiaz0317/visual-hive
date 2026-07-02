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

## Agent Policy

Agents may use this report to suggest tests, setup changes, or handoff tasks. They must not decide pass/fail, approve baselines, enable external providers, or run protected targets. Visual Hive's deterministic Verdict Engine remains the authority.
