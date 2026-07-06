# npm Audit Risk Acceptance

Last reviewed: 2026-07-06

Revisit by: 2026-08-06 or before the next public package release, whichever comes first.

## Current Audit Result

Command:

```bash
npm audit --workspaces --json
```

Result:

- 5 findings total
- 3 moderate
- 1 high
- 1 critical

Affected dependency path:

- `vitest` -> `@vitest/mocker` / `vite-node` / `vite` / `esbuild`

Notable advisories:

- `vitest` `<3.2.6`: Vitest UI server arbitrary file read/execute advisory.
- `vite` `<=6.4.2`: dev-server path traversal / Windows alternate path advisories.
- `esbuild` `<=0.24.2`: dev-server request exposure advisory.

## Risk Decision

Accepted temporarily for this branch.

Reason:

- The affected packages are development/test tooling, not Visual Hive runtime production dependencies.
- The repository does not enable Vitest UI in CI or default scripts.
- Visual Hive’s default GitHub workflows run deterministic CLI/browser checks and do not expose a dev server to the public internet.
- `npm audit` reports the available fix as `vitest@4.1.10`, a semver-major upgrade. That migration is likely safe but broad enough to require its own focused compatibility pass across the workspace.

## Required Follow-Up

Create a focused dependency-hardening pass to:

1. Upgrade Vitest to the current stable major.
2. Re-run `npm run build`, `npm run typecheck`, `npm test`, `npm run lint`, `npm run demo:full-run`, `npm run smoke:ui`, and `npm run smoke:ui:browser`.
3. Confirm `npm audit --workspaces` is clean or document any remaining transitive runtime risk.

This acceptance must not be used to justify exposing Vitest UI, Vite dev servers, or Playwright/control-plane local servers publicly.
