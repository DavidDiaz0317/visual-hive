# KubeStellar Console Example

A realistic KubeStellar Console setup can use layered Visual Hive lanes.

## Hosted demo no-login canary

Run on PRs and schedules against a public hosted demo. Assert:

- dashboard shell exists
- login page does not exist
- GitHub login button does not exist
- demo badges remain visible

## Local preview visual screenshots

Run on PRs with no secrets:

```yaml
targets:
  localPreview:
    kind: command
    build: "npm run build"
    serve: "npm run preview -- --port 4173"
    url: "http://127.0.0.1:4173"
    prSafe: true
    cost: cheap
```

Capture dashboard desktop and mobile routes. Use changed-file selection for `src/components/**`, `src/routes/**`, and styling directories.

## Fake OAuth fullstack auth flow

Keep fake OAuth deterministic and secret-free in PR mode. Assert callback, session banner, logout state, and protected route behavior using local fixtures.

## Live cluster protected scheduled lane

Use scheduled or manually dispatched workflows for live cluster checks. These jobs may use secrets because they do not execute untrusted PR code.

## Mutation testing

Use scheduled mutation runs to verify that contracts catch:

- login unexpectedly appearing in demo mode
- removed demo badges
- API failures
- empty cluster lists
- mobile layout overflow

## LLM triage

Generate `.visual-hive/triage-prompt.md` and `.visual-hive/issue.md` after deterministic reports are written. Use a trusted workflow to create issues from sanitized artifacts.
