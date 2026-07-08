# Production Demo-Site Installation Pattern

The canonical external repo is `DavidDiaz0317/visual-hive-demo-site`.

## Local Pattern

1. Build Visual Hive from a sibling checkout or set `VISUAL_HIVE_CLI`.
2. Run the demo-site resolver scripts rather than hardcoding `../vis-hive`.
3. Generate deterministic evidence.
4. Generate Hive export, beads, validation, setup pack, and integration smoke artifacts.
5. Run path leak scans before any trusted publish/import step.

## Expected Commands

```bash
npm run vh:full-run
npm run vh:hive-export
npm run vh:hive-validate
npm run vh:hive-beads
npm run vh:hive-setup-pack
npm run vh:hive-integration-smoke
npm run vh:mcp:smoke
```

## Workflow Pattern

- PR workflow: read-only, no secrets, no live issue creation, no Hive/provider calls.
- Scheduled workflow: deeper checks and dry-run import/publish by default.
- Trusted publisher/importer: consumes sanitized artifacts, does not checkout PR code, live mode only behind an explicit guard.

## Adapting Another Repo

1. Add stable route/page selectors.
2. Add `visual-hive.config.yaml`.
3. Add localPreview and hosted/canary targets as appropriate.
4. Run `visual-hive doctor`, `plan`, and `run`.
5. Seed baselines only from trusted context.
6. Add mutation operators and coverage rules.
7. Generate `visual-hive hive setup-pack`.
8. Review and apply workflows.
9. Keep live publishing/importing trusted and guarded.
