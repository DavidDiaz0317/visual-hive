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

Visual Hive can run first to decide which targets/contracts deserve attention. A future adapter can forward selected screenshots to Percy, Chromatic, Argos, or Applitools. The hosted provider can own review UI while Visual Hive owns planning, contract coverage, mutation score, and issue context.

The MVP does not require paid accounts or external visual providers.
