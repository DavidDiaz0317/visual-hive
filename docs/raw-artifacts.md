# Raw Artifacts

`visual-hive artifacts` writes `.visual-hive/artifacts-index.json`, a safe inventory of files under `.visual-hive`.

It records:

- artifact path, kind, content type, byte size, and labels
- JSON, Markdown, text, log, YAML, TypeScript/generated spec, image, and other classifications
- sanitized previews for text-like artifacts
- redaction and truncation flags

The indexer refuses artifact roots outside the repository and only previews non-image text-like files. Secret-looking values are redacted with the same sanitizer used for issues, PR comments, prompts, and reports.

Example:

```bash
visual-hive artifacts --config visual-hive.config.yaml
```

The Control Plane Raw Artifacts page reads the same model and renders image previews plus redacted text previews. Direct file/image endpoints remain constrained to `.visual-hive` and use no-store responses with `X-Content-Type-Options: nosniff`.

The artifact schema is tracked at `schemas/visual-hive.artifacts.schema.json`.
