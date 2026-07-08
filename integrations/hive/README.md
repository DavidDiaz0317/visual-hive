# Visual Hive -> Hive Integration

This directory documents the compatibility boundary with `kubestellar/hive`.

Visual Hive currently implements the integration bundle in the product repo:

- `.visual-hive/hive/hive-export.json`
- `.visual-hive/hive/hive-beads.json`
- `.visual-hive/hive/hive-import-manifest.json`
- `.visual-hive/hive/hive-agent-work-orders.json`
- `.visual-hive/hive/hive-validation-summary.json`
- `.visual-hive/hive/hive-setup-pack.json`

Suggested minimal Hive-side importer location:

```text
kubestellar/hive/v2/pkg/visualhive/
```

Importer responsibilities:

- parse and validate Visual Hive export/bead/import-manifest artifacts;
- reject path leaks and secret markers;
- dedupe bead projections by `external_ref`;
- map Visual Hive agent work orders to Hive agents under ACMM policy;
- never execute Visual Hive or PR code while importing artifacts.

Visual Hive remains the source of deterministic evidence. Hive remains the product shell and agent orchestration layer.
