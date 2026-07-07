# Security Audit Posture

Last reviewed: 2026-07-07

## Current npm audit result

`npm audit --workspaces` currently reports 5 findings through the development test/build chain:

- `esbuild <=0.24.2` via `vite`
- `vite <=6.4.2`
- `@vitest/mocker <=3.0.0-beta.4`
- `vite-node <=2.2.0-beta.2`
- `vitest <=3.2.5`

The reported fix path is `npm audit fix --force`, which upgrades Vitest to a newer major line and is treated as a breaking dependency change for this workspace.

## Risk decision

Status: accepted temporarily for development tooling only.

Reason:

- The affected chain is used by local development, tests, and Vite preview/build tooling.
- Visual Hive does not expose Vite/Vitest dev servers as a production hosted service.
- PR and local Visual Hive runs remain deterministic-first and do not grant secrets to untrusted workflows.
- Forcing the major Vitest upgrade is outside the current focused production-hardening scope and should be handled as its own dependency migration with full validation.

Mitigations:

- Do not expose Vite preview/dev servers on public networks for Visual Hive validation.
- Keep GitHub Actions PR workflows read-only and secret-free.
- Keep issue publishing in trusted, explicit workflows only.
- Re-run `npm audit --workspaces` during release prep and before publishing packages.

Revisit by: 2026-08-15

Recommended next action:

Open a focused dependency-upgrade PR that moves Vitest/Vite/esbuild to non-vulnerable versions, then run the full validation suite including `npm run demo:full-run`, `npm run smoke:ui:browser`, and the external demo-site full run.
