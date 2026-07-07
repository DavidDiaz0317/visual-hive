# Production Demo-Site Installation

`DavidDiaz0317/visual-hive-demo-site` is the canonical external client installation for Visual Hive.

## Continuous Lanes

### PR Lane

Workflow: `.github/workflows/visual-hive-pr.yml`

- Trigger: `pull_request`
- Permissions: `contents: read`
- Secrets: none
- Issue creation: disabled
- Provider upload: disabled
- Runs Visual Hive from `DavidDiaz0317/visual-hive@main`
- Produces deterministic report, triage, evidence, issue candidates, handoff packet, MCP manifest, and artifact index.

### Scheduled / Deep Lane

Workflow: `.github/workflows/visual-hive-scheduled.yml`

- Trigger: schedule and manual dispatch
- Runs deeper mutation, coverage, provider dry-run, handoff validation, MCP smoke, and agent issue context.
- Issue publishing is dry-run by default.

### Trusted Publisher

Workflow: `.github/workflows/visual-hive-trusted-publisher.yml`

- Trigger: `workflow_run`
- Permissions: `actions: read`, `contents: read`, `issues: write`
- Does not checkout or execute PR code.
- Downloads uploaded Visual Hive artifacts.
- Scans issue-facing artifacts for local path leaks.
- Live publish is disabled unless `VISUAL_HIVE_AUTO_PUBLISH_ISSUES=true` is set as a repository variable.
- Publishes at most one scoped issue candidate by default.

### Production Smoke

Workflow: `.github/workflows/visual-hive-production-smoke.yml`

Manual workflow that runs the same production-style sequence locally available as:

```bash
npm run vh:production-smoke
```

## Required Local Commands

```bash
npm ci
npm run build
npm run typecheck
npm run vh:full-run
npm run vh:mcp:smoke
npm run vh:production-smoke
```

## Safety Defaults

Local/default demo-site runs make zero real GitHub issues, zero Hive API calls, zero LLM calls, zero provider uploads, zero source mutations, and zero repair branches or PRs.
