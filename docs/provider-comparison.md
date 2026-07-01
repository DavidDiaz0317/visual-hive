# Provider Comparison

Percy, Chromatic, Argos, and Applitools are valuable visual testing products. Visual Hive is designed to complement them, not replace every hosted review workflow they provide.

## What hosted visual providers usually optimize

- Screenshot hosting and review UI.
- Browser/device matrix management.
- Baseline approval workflows.
- Visual diff algorithms and team collaboration.
- Product-specific integrations such as Storybook or visual AI matching.

## What Visual Hive adds

- Project-aware target planning from changed files, target safety, schedule, severity, and cost.
- Deterministic selector, route, and user-visible contract checks through Playwright.
- Mutation adequacy checks that intentionally break UI/auth/API behavior and verify tests catch the breakage.
- Repair-ready GitHub issue/comment context with sanitized logs, changed files, artifacts, and likely failure classes.
- Optional prompt generation for LLM triage without making the LLM a pass/fail oracle.

## How they work together

Visual Hive can run first to decide which targets/contracts deserve attention. The v0.2 adapter surface can inspect optional provider readiness, report missing credential names, and run mock-mode adapters without external accounts. `visual-hive providers list --mock-results` writes `.visual-hive/provider-results.json` with availability, artifact upload, compare, fetch, normalize, and report-metadata operation evidence. Argos has the first real optional upload path through `visual-hive providers upload --provider argos`; Percy, Chromatic, and Applitools remain governed/deferred adapters. A hosted provider can own review UI while Visual Hive owns planning, contract coverage, mutation score, and issue context.

Visual Hive also owns external upload policy. The `costPolicy` config can block PR uploads, require failure-only upload, limit external screenshots per run, and keep critical-contract-only provider usage as the default posture. Provider results record `externalUploadAllowed`, blocked reasons, estimated external screenshot counts, upload status, staged/uploaded artifact counts, and external call counts. Playwright remains the deterministic oracle even when Argos upload succeeds or fails.

The CLI and Control Plane use the same core governance helper to record provider decisions in `.visual-hive/provider-decisions.json`. These decisions are local audit evidence only: skip a provider for now, review it later, or approve it for a future trusted setup review. Recording a decision does not create credentials, enable billing, upload screenshots, or call a provider API. `visual-hive risk` and `visual-hive readiness` load the decision log so governance choices are visible before a team enables trusted provider-backed lanes.

CLI-only example:

```bash
visual-hive providers plan --provider argos
visual-hive providers decision --provider argos --decision skip --reason "Playwright artifacts are enough for this repo right now"
visual-hive providers decision --provider percy --decision review_later
visual-hive providers decision --provider applitools --decision approve_trusted_setup
```

`visual-hive providers plan --provider <id>` writes `.visual-hive/provider-setup-plan.json`. The Control Plane Providers page can write the same artifact after explicit confirmation. The plan is a no-network readiness artifact: it lists required environment variable names, missing credential names, config changes to review, trusted workflow steps, safety checks, validation commands, warnings, and `externalCallsMade: 0`. It helps a maintainer prepare a provider-backed scheduled lane without silently enabling billing, credentials, external uploads, or provider API calls.

`visual-hive providers handoff --provider <id>` writes `.visual-hive/provider-handoff.json` after a deterministic run. This no-network bridge lists exact actual/diff screenshot artifacts, baseline context, generated spec/report context, upload eligibility, credential/cost-policy blocked reasons, and trusted workflow steps.

`visual-hive providers upload --provider argos --dry-run` stages eligible actual/diff screenshots into `.visual-hive/provider-upload/argos` and writes `.visual-hive/provider-results.json` plus `.visual-hive/provider-upload/argos/manifest.json` without external calls. A real upload requires:

- `providers.argos.enabled: true`
- `providers.argos.mode: external`
- `ARGOS_TOKEN` present in the trusted workflow environment
- a cost policy that allows the current mode/status/screenshot count
- an explicit `visual-hive providers upload --provider argos` command

The command invokes `npm exec --yes --package @argos-ci/cli@^5 -- argos upload ...` only after those gates pass. Tokens are passed through the environment and are redacted from stdout/stderr excerpts, manifests, reports, and markdown.

`visual-hive risk` and `visual-hive readiness` consume the same handoff manifest automatically. If an external provider is enabled, those commands expect both a setup plan and a handoff manifest before the lane is considered reviewed. Missing or blocked handoff evidence is reported as trusted-only provider policy risk, not as a deterministic test failure.

Mock, plan, decision, and handoff commands write sanitized local audit entries and record `externalCallsMade: 0`. The Argos upload command records `externalCallsMade: 1` only for an attempted real upload; disabled, missing-credential, policy-blocked, and dry-run paths record zero external calls.

The default Visual Hive workflow does not require paid accounts or external visual providers.

## Adapter surface

The core registry exposes one adapter object for each built-in provider: Playwright, Argos, Percy, Chromatic, Applitools, Storybook, and GitHub Checks. Every adapter has methods for availability, artifact upload, compare, result fetch, result normalization, and report metadata emission. In v0.2, Argos is the only implemented hosted upload adapter and it is opt-in. Other non-Playwright external methods are mock or deferred by default, so no paid provider or network call is required.

`provider-results.json` also includes normalized provider-specific payloads:

- Hosted visual providers include project ID, future review URL shape, and baseline ownership policy.
- Storybook includes a recommended local command and a coverage mapping hint.
- GitHub Checks includes a check name, deterministic conclusion, and a trusted-workflow warning.
- All providers record `externalCallsMade: 0` unless a future trusted adapter explicitly changes that behavior.
