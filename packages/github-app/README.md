# @visual-hive/github-app

Prototype helpers for Visual Hive's future GitHub App connection model.

This package is intentionally local/mock first. It validates webhook signatures, models least-privilege permissions, creates setup issue payloads, and converts sanitized Visual Hive issue artifacts into GitHub issue payloads without making network calls.

Guarded live issue publication is single-writer aware. After obtaining an installation token, the app reads `.hive/integrated.json` from the repository's default branch through its read-only Contents permission. `visual_hive: true` suppresses all Visual Hive issue API writes so Hive remains the sole lifecycle owner. Missing protected state preserves standalone behavior; every other unreadable, malformed, false-valued, or repository-mismatched marker fails closed. Only the audited Hive uninstall may restore standalone ownership by removing the protected marker. Artifact lifecycle metadata is suppress-only and can never grant live-write authority.
