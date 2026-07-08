# Visual Hive Live Loop Current Gap

Generated during the demo-site live deployment hardening pass.

## Current continuous workflows

- `Visual Hive PR` runs on pull requests and remains read-only/no-secret.
- `Visual Hive Scheduled` and `Visual Hive Production Smoke` run deeper proof lanes.
- `Visual Hive Trusted Publisher` consumes workflow artifacts and is the only trusted path that can write Visual Hive issues.
- Before this pass there was no permanent live detection workflow dedicated to active seeded/current findings.

## Issue-writing workflows

- `Visual Hive Trusted Publisher` has `issues: write`.
- PR workflows must not write issues and must not use secrets.
- The repair workflow is allowed to write issues/PRs only in guarded contexts and must not run untrusted PR code.

## Dry-run-only workflows and commands

- Normal local commands still create dry-run issue/handoff artifacts only.
- Provider, Hive API, and LLM integrations remain disabled or dry-run by default.
- The full-run harness remains a proof harness and creates no real issues.

## Why seeded defects were not becoming real issues

The existing external full-run intentionally proved a seeded defect and then restored clean artifacts so the final local summary stayed green and safe. That is correct for acceptance testing, but it meant the artifact uploaded to trusted publishing did not represent active seeded findings.

The trusted publisher was also scoped too narrowly: it only considered `missing_visual_coverage`, limited publication to one candidate, and required `VISUAL_HIVE_AUTO_PUBLISH_ISSUES=true`. Seeded findings such as `force-login-on-demo`, `mobile-overflow`, `api-500`, `empty-data`, `hidden-error-banner`, `route-guard-bypass`, and `theme-token-drift` were therefore present as proof/mutation evidence but not as active issue candidates for live publication.

## Full-run clean restoration

`vh:full-run` should keep restoring clean artifacts after the seeded defect proof. That protects the local proof harness from looking permanently failed. A separate live lane is required for ongoing issue creation.

## Publisher hardcoding

The previous publisher used:

```text
ISSUE_KIND=missing_visual_coverage
ISSUE_LIMIT=1
```

That prevented a production-style issue loop. The live publisher must be policy-driven, read multiple issue kinds, dedupe by fingerprint, and publish all allowed active candidates from trusted scheduled/manual/main workflows.

## Required changes for the live loop

1. Add a live detection workflow that runs on `main`, schedule, and manual dispatch.
2. Add demo-site scripts that produce active seeded issue candidates without restoring clean artifacts first.
3. Update the trusted publisher to publish/update multiple allowed candidates and skip PR-origin runs.
4. Add lifecycle updates for still-active, resolved-candidate, and suppressed states.
5. Add a guarded repair PR workflow using Hive-compatible work orders.
6. Keep PR workflows read-only and free of secrets/issue writes.
7. Keep all issue-facing artifact paths repo-relative or redacted.
