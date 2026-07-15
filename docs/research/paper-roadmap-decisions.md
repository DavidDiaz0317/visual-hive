# Paper Roadmap Decisions for the Hive Integration

This record maps the paper-aligned roadmap to the production Hive/Visual Hive repair integration. It is a design decision log, not a claim that every longer-term paper feature belongs in the first benchmark release.

## Status key

- **Implemented now:** present on the isolated feature branch; still subject to the Goal's required tests and end-to-end proof.
- **Already present:** production capability that predates this feature branch and is being reused.
- **Adapted:** accepted in a narrower form that preserves deterministic authority and repository ownership.
- **Deferred pending evidence:** intentionally excluded until measured evidence justifies it.
- **Rejected:** conflicts with the product boundary or experiment.

Evaluation has not begun. "Implemented now" is a code/document status, not a benchmark-performance or production-readiness claim.

## Recommendation traceability

| Roadmap recommendation | Status | Current evidence and boundary | Remaining work |
| --- | --- | --- | --- |
| Comparable before/after repair closure | Implemented now | Versioned task, session, result, run-context, and validation contracts bind task, repository, base/head, profile, obligation, route/state/viewport, browser environment, baseline, producer artifact, and execution request. A disappeared fingerprint is never sufficient. | Complete Hive broker integration, sandboxed execution proof, receipt-gated publication, and fresh post-merge target-branch closure proof. |
| Obligation-aware evidence | Implemented now | Task contexts and receipts map deterministic contracts and screenshots to explicit user-visible obligations and bounded source/graph candidates. | Prove all required fixture classes and measure usefulness in the paired harness. |
| Structured finding and repair adjudication | Adapted | The initial receipt records deterministic `pass`/`fail`/`blocked`, remaining/new failures, and policy/baseline/threshold changes. | Broader reviewer categories, UI, and longitudinal adjudication remain deferred; no result automatically suppresses a future finding. |
| Reproducible external SWE-bench Multimodal harness | Adapted | Protocol v2, repository-grouped split, leakage rules, paired statistics, numeric caps, and artifact requirements are frozen beside the product. | The resumable paired runner, smoke, pilot, and untouched evaluation have not begun; no performance claim exists yet. |
| Governed Hive evidence loop | Adapted | The contracts preserve Hive as orchestrator/lifecycle writer and Visual Hive as deterministic visual authority. Repair MCP is scoped and read-only. | Hive's durable multi-turn broker, exact candidate commit, OS sandbox, merge-time receipt recheck, and lifecycle proof are still required. |
| Existing readiness/ACMM/VEMM | Already present, adapted | Existing readiness evidence is the extension point; no new marketing score is introduced. | Expose open/closed repair-loop evidence only after the lifecycle is operational; maturity never replaces exact validation. |
| Evidence stability | Deferred pending evidence | Incomplete or non-comparable evidence is already blocked and cannot weaken thresholds. | Add rich contract/browser/OS longitudinal classification only if fixture or benchmark evidence shows it improves decisions. |
| Tool-provider evolution | Already present, adapted | Playwright remains the first-party runner; provider capability metadata and conformance policy already exist. The repair model cannot install tools during a run. | A new adapter requires a demonstrated Playwright-specific gap, compatibility tests, and representative shadow runs. |
| Deterministic relational UI contracts | Deferred pending evidence | Existing obligations, states, routes, and viewports cover the first repair experiment. | Add relational contracts only when frozen evidence identifies a material detection gap. |

## Deferred details

- Full longitudinal contract/browser/OS stability scoring and automated maintenance-issue generation.
- A complete reviewer-facing adjudication UI and broad Control Plane changes.
- Relational UI contracts across themes, authentication states, and data states.
- Additional open-source browser or visual adapters. Add one only if frozen benchmark evidence identifies a Playwright-specific gap that materially affects the primary outcome.

## Rejected

- An LLM or VLM as the pass/fail oracle.
- A second repair-agent orchestrator inside Visual Hive.
- Automatic baseline approval, threshold weakening, finding suppression, or policy changes from a model classification.
- Repair-agent self-certification without a deterministic Visual Hive rerun.
- Benchmark-specific behavior in the default product CLI.
- Giving Visual Hive issue, branch, PR, approval, merge, or closure authority. Those actions remain exclusively Hive-owned.
