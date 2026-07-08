# Visual Hive Safety Checklist

Use this checklist before marking a client installation production-ready.

## PR Workflow

- Uses `pull_request`, not `pull_request_target`.
- Has `permissions: contents: read`.
- Does not use secrets.
- Does not publish GitHub issues.
- Does not call Hive APIs, LLMs, or paid providers.
- Uploads `.visual-hive` artifacts with hidden files included.

## Trusted Publisher

- Triggered by `workflow_run`.
- Does not checkout or execute PR code.
- Downloads artifacts from the completed workflow.
- Validates artifacts before reading issue candidates.
- Scans issue-facing artifacts for local absolute paths and secrets.
- Requires explicit live guard such as `VISUAL_HIVE_AUTO_PUBLISH_ISSUES=true`.
- Uses dedupe fingerprint/marker to update existing issues.
- Publishes a scoped candidate, not the whole queue by accident.

Run `npm run demo:path-scan` before trusted publishing to verify issue-facing artifacts are repo-relative or redacted.

## Local Defaults

- `externalCallsMade` remains `0`.
- `networkCallsMade` remains `0` for dry-run issue handoff.
- `realGithubIssuesCreated` remains `0`.
- `sourceMutations` remains `0`.
- `repairBranchesOrPrsCreated` remains `0`.
- MCP is read-only by default.
- Agent issue runs write only `.visual-hive/agents/**` artifacts unless explicit write-preview flags are used.

## Path and Secret Hygiene

Issue-facing artifacts must not contain:

- Windows user-home paths
- Windows slash-style user-home paths
- cloud-sync local root names
- macOS user-home paths
- Linux user-home paths
- Windows drive-letter paths
- token, password, cookie, bearer, authorization, or client secret values

The first-party scanner writes `.visual-hive/path-leak-scan.json` and fails when issue-facing artifacts expose local absolute paths.

## Baselines and Thresholds

- Missing baselines are created locally only in non-CI seed mode.
- CI mode fails on missing baselines unless update snapshots is explicitly configured.
- Baselines are never silently approved.
- Thresholds are not weakened to make a run pass.
