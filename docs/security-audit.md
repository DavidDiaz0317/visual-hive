# Security Audit Posture

Last reviewed: 2026-07-07

## Current npm audit result

`npm audit --workspaces` currently reports 0 vulnerabilities.

## Resolution

Status: resolved.

The previous findings were in the development test/build chain:

- `esbuild <=0.24.2` via `vite`
- `vite <=6.4.2`
- `@vitest/mocker <=3.0.0-beta.4`
- `vite-node <=2.2.0-beta.2`
- `vitest <=3.2.5`

They were resolved with a focused dependency-security upgrade using `npm audit fix --force`, which moved Vitest to `4.1.10` and removed the vulnerable transitive chain.

## Validation

After the upgrade, the following commands passed:

- `npm audit --workspaces`
- `npm run build`
- `npm run typecheck`
- `npm test`
- `npm run lint`
- `npm run demo:full-run`

## Ongoing posture

- Do not expose Vite preview/dev servers on public networks for Visual Hive validation.
- Keep GitHub Actions PR workflows read-only and secret-free.
- Keep issue publishing in trusted, explicit workflows only.
- Re-run `npm audit --workspaces` during release prep and before publishing packages.
