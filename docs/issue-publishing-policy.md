# Visual Hive Issue Publishing Policy

Visual Hive is issue-centric, but it must not create live GitHub issues from default local runs or untrusted pull request workflows.

## Default Policy

- PR workflows run on `pull_request`, use `contents: read`, avoid secrets, and upload `.visual-hive` artifacts.
- Local/default commands write issue candidates and dry-run publish artifacts only.
- Scheduled and full-run workflows should default to dry-run publication unless a trusted operator explicitly enables live publishing.
- Trusted `workflow_run` consumers may create or update issues only from uploaded, sanitized artifacts. They must not checkout or execute PR code.
- Live issue creation requires an explicit guard such as `VISUAL_HIVE_AUTO_PUBLISH_ISSUES=true` or `VISUAL_HIVE_LIVE_GITHUB_ISSUE=true`.

## Trusted Live Publishing

Use live publishing only in a trusted lane:

```bash
VISUAL_HIVE_LIVE_GITHUB_ISSUE=true \
GITHUB_TOKEN=... \
visual-hive issues publish --live --repo owner/repo
```

The publisher dedupes by stable Visual Hive fingerprints and updates existing issues instead of creating duplicates. Token values are never written to artifacts. Published issue bodies should reference repo-relative artifact paths such as `.visual-hive/evidence-packet.json`, Evidence Resource IDs, or workflow artifact links, not local absolute paths.

## Lifecycle Policy

- `open_candidate`: publish or update a live issue when live publishing is explicitly enabled.
- `update_candidate`: update the existing issue by fingerprint.
- `resolved_candidate`: update the existing issue with resolved-candidate evidence and labels; do not auto-close by default.
- `suppressed`: keep the finding visible in `.visual-hive/issues.json`, but do not publish it unless policy explicitly says otherwise.
- Reappearing findings reuse the same fingerprint and update the existing issue rather than creating duplicates.

## Workflow Audit Expectations

`visual-hive workflows` flags these unsafe patterns:

- PR workflows with secrets, write permissions, issue creation, or `pull_request_target`.
- Trusted issue workflows that checkout code.
- Trusted issue workflows that create issues without recursive artifact discovery and secret redaction.
- Trusted issue or handoff workflows that create issues without `VISUAL_HIVE_AUTO_PUBLISH_ISSUES` or an equivalent explicit guard.

This keeps Visual Hive responsible for detection, evidence, packaging, and validation. Agents and Hive can act from issues, but Visual Hive does not silently repair code, open PRs, approve baselines, or weaken thresholds.
