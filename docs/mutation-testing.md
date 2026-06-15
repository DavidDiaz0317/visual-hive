# Mutation Testing

Visual Hive mutations intentionally break UI, auth, API, or responsive behavior. A mutation is killed when deterministic Playwright contracts fail.

MVP operators:

- `hide-critical-button`: hides `[data-testid='critical-action-button']`.
- `force-login-on-demo`: injects a login page surface into the public demo route.
- `remove-demo-badge`: hides `[data-testid='demo-badge']`.
- `api-500`: returns HTTP 500 for `**/api/**`.
- `empty-data`: returns empty JSON data for `**/api/**`.
- `mobile-overflow`: injects mobile horizontal overflow.

Mutation score is:

```text
killed / total
```

`visual-hive mutate --enforce-min-score` exits nonzero when the score is lower than `mutation.minScore`.
