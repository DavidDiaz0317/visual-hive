# Evaluation Protocol

This protocol defines the first research study shape for Visual Hive. It is intended for a systems/software-engineering paper, not a marketing report.

## Study Design

Use three evaluation tracks:

- Demo app seeded regressions: run controlled defects in `examples/demo-react-app` and compare screenshot-only evidence with Visual Hive's contract, mutation, issue, and MCP evidence.
- External client validation: run the `visual-hive-demo-site` `vh:*` commands to prove the same artifact model works outside the product repo.
- Realistic target planning: use KubeStellar/demo-site configuration as the higher-complexity target for changed-file planning, protected-target separation, issue handoff, and workflow safety checks.

The initial experiments should answer:

- whether mutation survivors identify missing or weak UI tests better than generic coverage gaps;
- whether changed-file planning reduces selected contracts and CI time without hiding seeded defects;
- whether Evidence Packets and issue candidates reduce time from failure to actionable repair task;
- whether MCP context gives agents enough bounded evidence without granting write, network, or verdict authority.

## Metrics

Record these metrics from generated `.visual-hive` artifacts and validation logs:

- detection rate for seeded regressions;
- false-positive review burden, measured as issue candidates or visual diffs that do not map to intentional defects;
- mutation score and survived mutation classes;
- selected versus skipped contract count;
- CI duration and demo command wall time;
- diagnosis time from failure to issue candidate with reproduction and validation command;
- issue completeness, including affected surfaces, artifacts, labels, guardrails, and validation command;
- repair validation outcome, measured by deterministic rerun status after a human or agent change;
- safety counters: external calls, network calls, source mutations, branches, PRs, real issues, provider uploads, LLM calls, and Hive API calls.

## Acceptance Criteria

A run is paper-usable only when:

- `npm run demo:full-run`, `npm run demo:all`, and `npm run schema:verify` pass in the product repo;
- the generated Evidence Packet, report, mutation report, issue candidates, issue queue, Visual Graph, Visual Impact, MCP manifest, artifact index, and safety artifacts are present;
- local/default runs report zero real GitHub issues, zero branch/PR creation, zero source mutation, zero provider uploads, zero Hive API calls, and zero LLM calls;
- issue-facing artifacts do not expose local absolute paths or secrets;
- any external demo-site evidence records the exact repo commit, command, run ID when available, and artifact path used for the claim;
- failures, blocked live modes, and missing credentials are recorded as limitations rather than silently omitted.

## Reproducibility Commands

Product repo:

```bash
npm run build
npm run typecheck
npm test
npm run lint
npm run schema:verify
npm run demo:full-run
npm run demo:all
```

External demo-site repo:

```bash
npm run vh:production-smoke
npm run vh:mcp:smoke
npm run vh:issues
npm run vh:graph:impact
npm run vh:agent:issue
```

Each paper run should preserve command logs separately from ignored `.visual-hive` generated artifacts. Commit only schemas, docs, configs, and intentionally reviewed baselines.
