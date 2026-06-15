# KubeStellar Console Example

The example config at `examples/kubestellar-console/visual-hive.config.yaml` models a realistic layered setup for KubeStellar Console.

## What Runs On PR

PR runs should use `pull_request`, read-only permissions, and no secrets.

Safe PR targets:

- `hostedDemo`: public demo canary at `https://console.kubestellar.io`.
- `localPreview`: frontend preview built from PR code.
- `fakeOAuthFullstack`: fake OAuth provider, backend, and frontend with no real GitHub credentials.

PR contracts include hosted demo no-login checks, fake OAuth flow checks, dashboard/card screenshots, cluster fixture screenshots, and mobile overflow screenshots.

Sample local planning commands:

```bash
node packages/cli/dist/index.js plan --config examples/kubestellar-console/visual-hive.config.yaml --mode pr --changed-files examples/kubestellar-console/sample-auth-changed-files.txt
node packages/cli/dist/index.js plan --config examples/kubestellar-console/visual-hive.config.yaml --mode pr --changed-files examples/kubestellar-console/sample-docs-changed-files.txt
node packages/cli/dist/index.js plan --config examples/kubestellar-console/visual-hive.config.yaml --mode schedule
```

## What Runs On Schedule

Scheduled workflows may use protected secrets. They can include:

- all PR-safe lanes
- `liveCluster` protected target
- mutation adequacy checks

`liveCluster` requires environment variables such as `KUBECONFIG` and `KC_AGENT_TOKEN`. Doctor/report output names missing variables but never prints their values.

## Manual Protected Runs

Manual runs are useful before releases or when debugging a protected environment. Use a trusted workflow or local shell with explicit secrets.

## Fake OAuth

The `fakeOAuthFullstack` target starts a local fake OAuth provider. This proves auth routing, callback handling, and dashboard rendering without real GitHub credentials. It is PR-safe because it uses deterministic local fixtures.

## Why Hosted Demo Must Never Expose Login

The hosted demo is public. If it exposes login controls, users can be sent into a broken or unsafe auth flow. The `hosted-demo-never-login` contract asserts dashboard visibility and forbids login selectors.

## Sample Failure Issue

```md
# Visual Hive failure report

## Summary
- Project: kubestellar-console
- Deterministic status: failed
- Failed contracts: 1

## Failed contracts
- hosted-demo-never-login on hostedDemo: Expected selector to be absent: [data-testid='github-login-button']

## Likely cause classification
- login_regression: Login state regression in hosted-demo-never-login

## Suggested next tests
- Add a contract that asserts demo mode feature flags hide every OAuth entry point.
```

## Sample Mutation Report

```json
{
  "operator": "force-login-on-demo",
  "status": "killed",
  "killed": true,
  "applicable": true,
  "contractIds": ["hosted-demo-never-login"],
  "failureKind": "login_regression"
}
```
