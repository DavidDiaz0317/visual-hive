# Troubleshooting

## Missing Baseline

In local non-CI mode, Visual Hive creates missing baselines in `visual.snapshotDir`, which defaults to `.visual-hive/snapshots`. Review the image before relying on it. In CI, missing baselines fail by default unless `visual.updateSnapshots` is true.

## Target Server Failed To Start

Check the target command, working directory, port, and health URL. Visual Hive reports the command and a sanitized log tail. Secret-looking values are redacted.

## No Contracts Selected

Check `runOn`, changed-file selection rules, target `prSafe`, and whether the current mode is `pr`, `schedule`, or `manual`. Protected targets are not selected for PR runs unless unsafe targets are explicitly allowed.

## Playwright Browser Missing

Run:

```bash
npx playwright install chromium
```

CI templates use `npx playwright install --with-deps chromium`.

## CI vs Local Snapshot Differences

Use deterministic viewports, disable animations, mask dynamic regions, and prefer stable fixture data. Increase `visual.maxDiffPixelRatio` only when the difference is expected and reviewed.
