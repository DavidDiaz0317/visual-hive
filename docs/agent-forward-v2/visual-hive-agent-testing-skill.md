# Visual Hive Agent Testing Skill

This file is designed to be copied into one or more of these locations:

```text
AGENTS.md
.github/copilot-instructions.md
.github/instructions/visual-hive-testing.instructions.md
docs/agent-testing-guide.md
```

Use it to guide Codex, Copilot, Claude, Gemini, or any future coding agent working on Visual Hive.

---

## Mission

Visual Hive is enterprise-grade deterministic visual QA orchestration. It is not a screenshot demo.

Every code change should preserve this model:

```text
Plan -> deterministic contracts -> visual artifacts -> mutation adequacy -> evidence packet -> trusted handoff
```

The LLM/agent can help write code and tests, but deterministic artifacts decide pass/fail.

---

## Non-negotiables

- Do not make an LLM a verdict authority.
- Do not add external provider calls by default.
- Do not put secrets in PR workflows.
- Do not use `pull_request_target` to execute untrusted PR code.
- Do not create issues directly from an untrusted PR run.
- Do not print secret values; report missing secret names only.
- Do not silently approve baselines.
- Do not skip tests because a feature is “just docs” unless planner no-op evidence proves it.
- Do not stop at stubs or shallow UI. Implement the tested vertical slice.
- Do not rewrite architecture without inspecting current packages and docs.

---

## Inspect-first workflow

Before coding:

1. Read `README.md`.
2. Read `docs/architecture.md`.
3. Read `docs/roadmap.md` and enterprise roadmap if present.
4. Read `docs/kubestellar-console-example.md`.
5. Read `docs/mutation-testing.md`.
6. Read `docs/provider-comparison.md`.
7. Inspect `package.json` scripts.
8. Inspect relevant package files under `packages/core`, `packages/cli`, `packages/playwright-adapter`, `packages/github-adapter`, `packages/llm-adapter`, and `packages/control-plane`.
9. Search for existing schema/report/artifact patterns before adding a new shape.
10. Write down the smallest vertical slice and test gate before editing.

---

## Testing ladder

Classify every change by the deepest relevant level.

| Level | Name | Use when | Required evidence |
| --- | --- | --- | --- |
| T0 | Static/build/schema | Any TypeScript, schema, config, package change | typecheck/build/schema validation |
| T1 | Unit | Core planner, scorer, validators, serializers, risk/cost logic | unit tests |
| T2 | Adapter/integration | CLI commands, filesystem artifacts, provider mocks, workflow parsing | integration/CLI tests and output files |
| T3 | Component/browser unit | Control Plane components, setup UI, artifact pages | component tests or browser-mode tests where available |
| T4 | Deterministic E2E/visual | Generated Playwright contracts, visual diffs, route/user-flow assertions | Playwright report, screenshots, diffs |
| T5 | KubeStellar/protected canary | KubeStellar routes, fake OAuth, live cluster, ground truth | PR-safe plan plus protected scheduled plan evidence |
| T6 | Mutation adequacy | Contracts, failure classes, test quality | mutation report with killed/survived/not-applicable |
| T7 | Governance/security/cost | Workflows, providers, LLMs, GitHub issue creation | workflow audit, cost/provider/LLM artifacts |
| T8 | Evidence/handoff | Reports, triage, GitHub/Hive handoff | evidence packet, issue body, handoff payload |

Rule: A change touching a deeper level must also keep shallower gates healthy.

---

## Standard command strategy

Use the repo’s actual `package.json` scripts as source of truth. Prefer this order:

```bash
npm install
npm run build
npm test
npm run demo:kubestellar
npm run demo:ci
```

For focused work, run the smallest relevant command first, then the broader gate.

Examples:

- Core schema change: run unit tests for core, then build, then demo command that writes artifact.
- CLI command change: run focused CLI invocation, inspect `.visual-hive/*`, then build/test.
- KubeStellar config change: run plan in PR mode and schedule mode; verify protected target selection is correct.
- Provider change: run mock/dry-run path and confirm `externalCallsMade: 0` unless explicitly testing trusted external mode.
- Handoff change: run dry-run and inspect generated JSON/Markdown for sanitization and dedupe.

---

## How to add a Visual Hive feature safely

1. Define the artifact shape first.
2. Add or update schema if the artifact is stable/user-facing.
3. Add core type and writer/reader utility.
4. Add CLI command or integrate into existing command.
5. Add tests for normal, missing-input, and unsafe-policy cases.
6. Add example output under demo or KubeStellar where appropriate.
7. Update docs.
8. Update Control Plane only after CLI artifact exists.
9. Run gates.
10. Summarize exactly which deterministic evidence proves completion.

---

## How to write contracts

Prefer user-visible assertions:

- role/name selectors;
- stable `data-testid` only when intentionally part of the product contract;
- visible text for user-facing promises;
- route state;
- console/page/network policy;
- screenshot with masks/tolerance when layout matters;
- ground-truth comparison when API/Kubernetes data is expected.

Avoid brittle implementation details:

- CSS module names;
- random generated IDs;
- raw pixel assertions without tolerance;
- sleep-only waits;
- `.first()` on duplicate semantic markers unless all duplicates are intentionally equivalent and verified.

---

## KubeStellar-specific rules

PR-safe targets may include:

- public hosted demo no-login canary;
- local preview routes;
- deterministic fake OAuth/fullstack fixtures;
- docs-only no-op planning.

Protected/scheduled/manual targets may include:

- live cluster;
- real auth;
- Kubernetes API ground truth;
- provider upload;
- trusted GitHub issue/Hive handoff.

Never run protected targets from an untrusted PR. Never print kubeconfig, tokens, or secret values. Missing secret names may appear in reports.

---

## Mutation testing rules

Every mutation operator should map to a real product failure class.

For each operator, document:

- what it breaks;
- which contracts should kill it;
- when it is not applicable;
- how the report displays killed/survived/not-applicable;
- what missing-test suggestion is generated for survivors.

A survived mutation should produce a task like:

```text
Survived mutation: stale-loading-state
Expected contract: dashboard-renders-ready-state
Missing test: assert loading overlay is absent after readiness and dashboard cards are visible
Reproduce: visual-hive mutate --operator stale-loading-state --contract dashboard-renders-ready-state
Expected future status: killed
```

---

## Workflow and provider safety rules

PR workflow:

```yaml
on: pull_request
permissions:
  contents: read
```

Allowed:

- install/build/test;
- PR-safe targets;
- artifact upload;
- step summary;
- sanitized markdown generation.

Not allowed:

- secrets;
- issue creation;
- provider upload requiring tokens;
- live cluster;
- untrusted checkout inside privileged trigger.

Trusted workflow:

- may consume artifacts;
- may create/update issue;
- must not checkout or execute PR code;
- must sanitize again;
- must dedupe by deterministic signature.

---

## Evidence Packet rules

Every failure should be explainable from artifacts, not from terminal scrollback.

Evidence Packet must include:

- source metadata;
- plan selections/skips with reasons;
- deterministic results;
- visual diffs;
- console/page/network errors;
- mutation evidence;
- workflow safety posture;
- provider/LLM posture;
- artifact paths;
- repair guidance;
- GitHub/Hive handoff candidate;
- dedupe signature.

Evidence Packet must not include:

- secret values;
- raw tokens;
- arbitrary environment dumps;
- unbounded logs;
- provider API responses with credentials;
- LLM output as final pass/fail.

---

## Control Plane rules

The UI is a Control Plane over artifacts, not a separate source of truth.

- It must read/write the same files as CLI.
- It must show missing artifacts with commands to generate them.
- It must not invent health scores without explanation.
- It must support read-only mode.
- It must guard path traversal in raw artifact views.
- It must record config/workflow edits.
- It must show provider/LLM external-call posture.

---

## Done definition

A task is done only when:

- code is implemented, not stubbed;
- relevant schemas/types are updated;
- relevant tests pass;
- generated artifacts are inspected;
- docs/examples are updated;
- security/provider/LLM defaults remain safe;
- KubeStellar behavior is preserved if touched;
- acceptance criteria are explicitly demonstrated.

Final agent response should include:

```text
Changed files:
Tests run:
Artifacts generated:
Security/provider/LLM posture:
Known remaining risks:
```
