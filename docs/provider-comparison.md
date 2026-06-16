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

Visual Hive can run first to decide which targets/contracts deserve attention. The v0.2 adapter surface can inspect optional provider readiness, report missing credential names, and run mock-mode adapters without external accounts. `visual-hive providers --mock-results` writes `.visual-hive/provider-results.json` with availability, artifact upload, compare, fetch, normalize, and report-metadata operation evidence. Future external adapters can forward selected screenshots to Percy, Chromatic, Argos, or Applitools. The hosted provider can own review UI while Visual Hive owns planning, contract coverage, mutation score, and issue context.

Visual Hive also owns external upload policy. The `costPolicy` config can block PR uploads, require failure-only upload, limit external screenshots per run, and keep critical-contract-only provider usage as the default posture. Provider results record `externalUploadAllowed`, blocked reasons, estimated external screenshot counts, and still report `externalCallsMade: 0` unless a future trusted adapter explicitly performs a network call.

The default Visual Hive workflow does not require paid accounts or external visual providers.

## Adapter surface

The core registry exposes one adapter object for each built-in provider: Playwright, Argos, Percy, Chromatic, Applitools, Storybook, and GitHub Checks. Every adapter has methods for availability, artifact upload, compare, result fetch, result normalization, and report metadata emission. In v0.2, non-Playwright external methods are mock or deferred by default, so no paid provider or network call is required.

`provider-results.json` also includes normalized provider-specific payloads:

- Hosted visual providers include project ID, future review URL shape, and baseline ownership policy.
- Storybook includes a recommended local command and a coverage mapping hint.
- GitHub Checks includes a check name, deterministic conclusion, and a trusted-workflow warning.
- All providers record `externalCallsMade: 0` unless a future trusted adapter explicitly changes that behavior.
