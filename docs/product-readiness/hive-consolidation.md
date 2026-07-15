# Visual Hive and Hive consolidation

## Shipping decision

Keep two source repositories and ship one user workflow.

- Visual Hive remains the independently installable deterministic test engine, Playwright runner, evidence schema owner, and verdict authority.
- Hive owns repository setup, credentials, ACMM policy, persistent bead/agent lifecycle, and the user-facing orchestration shell.
- `visual-hive hive bundle` is the producer boundary; `hive visual import validate|apply` is the consumer boundary.
- Hive setup agents should generate and maintain Visual Hive config/workflows through CLI commands. The dashboard is an optional view over the same operations, not a required setup path.

A monorepo would couple a Node/browser release train to Hive's Go/server/deployment train, broaden the trusted computing base, and make the engine harder to use without Hive. A shared protocol and coordinated releases provide the seamless UX without those costs.

## Additive, duplicate, and retained ownership

| Capability | Decision |
| --- | --- |
| Browser execution, screenshots, selector/flow contracts, deterministic verdict | Retain in Visual Hive |
| Mutation adequacy, missing-test analysis, repository-specific test plan | Retain as Visual Hive evidence; expose to Hive test-creator/quality agents |
| Setup, connection management, credentials, schedules, agent execution, bead persistence | Retain in Hive |
| Issue/bead projection duplicated in both repos | Visual Hive projects sanitized work; Hive alone persists and owns lifecycle |
| Dashboard setup controls duplicated with CLI | Make CLI/API authoritative and dashboard a client |
| Cross-repo transport | New atomic, expiring, provenance-bearing, digested bundle |
| Import/retry semantics | New strict Hive validator and atomic idempotent batch import |

## Repository-specific testing plan

The setup/test-creator agent should produce a plan from deterministic repository intelligence, not from a generic prompt:

1. Detect framework, runnable targets, routes, components/stories, auth boundaries, API/error/empty/loading states, current tests, CI restrictions, and changed-file risk.
2. Map each critical user journey to selector assertions, accessibility state, screenshots, and negative contracts.
3. Require a tracked, human-reviewed baseline for every CI screenshot. Missing CI baselines fail; CI never creates expectations.
4. Run fast PR-safe contracts first, then scheduled mutation, cross-viewport, component, deploy-preview, and protected-target lanes under explicit policy.
5. Use mutation survivors and uncovered graph nodes to create test work orders. Never weaken a threshold or approve a baseline to make a run pass.
6. Select optional tools only when they add a missing capability and satisfy the registry's maintenance/security/data policy.
7. After a repair, rerun the narrow reproduction command and the relevant Visual Hive lane. Only Visual Hive can turn the deterministic verdict green.

## Open-source tool lifecycle

Playwright plus pixelmatch remains the required default. ODiff is registered as an optional local second implementation and must pass golden-image parity on every supported OS/architecture before enablement. Visual Regression Tracker is registered as an optional self-hosted review surface; it cannot override the verdict.

`visual-hive adapters manage` now turns those rules into a deterministic repository-specific plan. It chooses install/update/use/skip/replace from screenshot coverage, npm package and lock integrity, supported runtime, PR-lane safety, and VRT credential-name readiness. `--apply` can make only the exact local ODiff dependency change and must pass executable health plus golden parity before reporting it ready; VRT provisioning and upload remain explicit trusted operations.

For every optional tool, a setup-agent change must pin a version or container digest, record license and maintenance status, add compatibility and rollback tests, keep export portability, and start disabled. Update after the same fixtures pass. Replace or retire when security response, maintenance, API stability, data export, supported runtime, or deterministic parity falls below policy. Archived tools may inform UX patterns but are not new dependencies.

## Production gates

A release is reusable only after all of these pass:

- clean consumer install and CLI resolution without a hardcoded checkout;
- CI run against committed baselines with `createdBaselines: 0`;
- deterministic seeded-defect failure and clean rerun;
- mutation threshold;
- bundle schema, digest, path, credential, expiry, provenance, and ACMM rejection tests;
- real Hive import into a persistent-format bead store plus zero-duplicate retry;
- agent repair on a branch/PR followed by a green Visual Hive rerun;
- trusted workflow proof using pinned fork revisions before changing official Hive deployment.

The Visual Hive integration slice can pass while Hive's unrelated repository test suite still has red or deployment-only packages. Those failures must be reported separately and prevent a claim that the entire Hive product is production-ready.
