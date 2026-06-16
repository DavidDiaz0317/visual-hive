# Raw Artifacts

`visual-hive artifacts` writes `.visual-hive/artifacts-index.json`, a safe inventory of files under `.visual-hive`.

It records:

- artifact path, kind, content type, byte size, and labels
- matching `schemas/visual-hive.*.schema.json` path and schema ID for known JSON artifacts
- JSON, Markdown, text, log, YAML, TypeScript/generated spec, image, and other classifications
- setup recommendation artifacts labeled as `setup-recommendations`
- flow audit artifacts labeled as `flow-audit`
- sanitized previews for text-like artifacts
- redaction and truncation flags

The indexer refuses artifact roots outside the repository and only previews non-image text-like files. Secret-looking values are redacted with the same sanitizer used for issues, PR comments, prompts, and reports.

The generated `.visual-hive/artifacts-index.json` file is intentionally excluded from the next index run. This keeps repeated artifact indexing stable and avoids the inventory recursively growing by indexing its own previous output.

Example:

```bash
visual-hive artifacts --config visual-hive.config.yaml
```

The Control Plane Raw Artifacts page reads the same model and renders image previews plus redacted text previews. Direct file/image endpoints remain constrained to `.visual-hive` and use no-store responses with `X-Content-Type-Options: nosniff`.

The artifact schema is tracked at `schemas/visual-hive.artifacts.schema.json`.
