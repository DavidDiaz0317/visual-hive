# Mutation Testing

Visual Hive mutations intentionally break UI, auth, API, or responsive behavior. A mutation is killed when deterministic Playwright contracts fail.

Built-in v0.2 operators:

- `hide-critical-button`: hides `[data-testid='critical-action-button']`.
- `force-login-on-demo`: injects a login page surface into the public demo route.
- `remove-demo-badge`: hides `[data-testid='demo-badge']`.
- `api-500`: returns HTTP 500 for `**/api/**` with the exact first-party marker `visual-hive api-500 mutation`.
- `empty-data`: returns empty JSON data for `**/api/**`.
- `mobile-overflow`: injects mobile horizontal overflow.
- `route-guard-bypass`: injects protected-route UI into the current page.
- `hidden-error-banner`: hides `[data-testid='error-banner']`, `[role='alert']`, and common error banner classes.
- `broken-image`: breaks image requests and injects a broken image marker when no image exists.
- `removed-accessible-name`: removes accessible labels, alt/title text, and visible labels from controls.
- `theme-token-drift`: changes theme colors and card/button styling to simulate design-system drift.
- `stale-loading-state`: injects a persistent `[data-testid='loading-state']` overlay.

Operators can be configured as strings for heuristic mapping or as objects with explicit contract IDs:

```yaml
mutation:
  operators:
    - route-guard-bypass
    - id: stale-loading-state
      contracts:
        - hosted-demo-never-login
```

Mutation score is:

```text
killed / total
```

Default mutation runs are non-invasive. Visual Hive uses Playwright-side DOM/CSS injection, route interception, local storage/auth state, and fixture/env-driven defect states. Normal demo and PR mutation runs do not patch real source files. Generated report rows include `mutationMode: runtime` and `sourceMutation: false` for this default path.

For `api-500`, the generated runner adds a hidden, screenshot-neutral sentinel containing that exact marker only after an API request is actually intercepted. A coverage recommendation may therefore add the marker to the affected contract's `selectors.textMustNotExist`. The runner waits for the intercepted request before evaluating that assertion; a contract that never exercises an API request receives no sentinel and cannot claim a false mutation kill.

Generated `.visual-hive/mutation-report.json` files include an `outputResource` row for the catalog-backed read-only resource `visual-hive://mutation-report` / `visual_hive_read_mutation_report`. Agents, MCP clients, Hive exports, and the Control Plane may read this adequacy evidence, but reading it does not authorize editing tests, changing mutation thresholds, running targets, executing repair, or overriding the Visual Hive verdict.

Each mutation result includes or derives:

- selected contract IDs and affected route/component/viewport/target surfaces when known;
- `killed`, `survived`, `not_applicable`, or `error` status;
- expected failure kinds and concise assertion/error evidence;
- artifact paths and duration;
- a validation command for rerunning after a fix;
- suggested missing-test guidance for survived or not-applicable mutations.

`visual-hive mutate --enforce-min-score` exits nonzero when the score is lower than `mutation.minScore`.
