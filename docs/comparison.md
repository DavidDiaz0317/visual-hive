# Comparison

Visual Hive is not just another screenshot runner.

## Playwright-only

Playwright gives deterministic browser automation. Visual Hive keeps Playwright as the default first-party local runner and primary evidence source, then adds the verdict layer, project-aware planning, target safety, report schemas, mutation adequacy, and repair-ready issue context.

## Percy, Chromatic, Argos, and Applitools

Hosted visual providers offer strong review UIs, baseline approval workflows, browser matrices, and visual diff services. Visual Hive can optionally orchestrate them, starting with an explicit Argos upload command. Percy, Chromatic, and Applitools remain governed/deferred adapters.

Visual Hive's core value is different:

- select the right targets/contracts based on risk, schedule, changed files, and cost
- model safe PR targets and protected scheduled targets
- combine selector, route, screenshot, console, and user-visible contracts
- run mutation checks that prove tests catch intentional breakage
- generate sanitized GitHub context and LLM-ready prompts

The default v0.2 path requires no paid accounts.

Argos upload is opt-in:

```bash
visual-hive providers upload --provider argos --dry-run
```

A real upload requires `providers.argos.enabled=true`, `ARGOS_TOKEN`, and a cost policy that allows the trusted scheduled/manual lane. Argos evidence is supplemental unless normalized provider gating is explicitly enabled; Visual Hive remains the verdict authority.
