# Mutation Testing

Visual Hive mutations intentionally break UI, auth, API, or responsive behavior. A mutation is killed when deterministic Playwright contracts fail.

Built-in v0.2 operators:

- `hide-critical-button`: hides `[data-testid='critical-action-button']`.
- `force-login-on-demo`: injects a login page surface into the public demo route.
- `remove-demo-badge`: hides `[data-testid='demo-badge']`.
- `api-500`: returns HTTP 500 for `**/api/**`.
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

Generated `.visual-hive/mutation-report.json` files include an `outputResource` row for the catalog-backed read-only resource `visual-hive://mutation-report` / `visual_hive_read_mutation_report`. Agents, MCP clients, Hive exports, and the Control Plane may read this adequacy evidence, but reading it does not authorize editing tests, changing mutation thresholds, running targets, executing repair, or overriding the Visual Hive verdict.

`visual-hive mutate --enforce-min-score` exits nonzero when the score is lower than `mutation.minScore`.
