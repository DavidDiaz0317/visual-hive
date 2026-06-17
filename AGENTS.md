# Agent Instructions

This repo is a TypeScript npm workspace for Visual Hive. Work inside the existing repo; do not recreate the project.

Use Node 22 and npm. Prefer small, focused changes that preserve the deterministic-first model:

- Playwright contracts are the pass/fail oracle.
- LLM support is prompt/offline triage only.
- No paid visual provider is required by default.
- Do not use `pull_request_target` for workflows that execute untrusted PR code.
- Keep generated `.visual-hive` files ignored unless the user explicitly asks for baseline artifacts.

Before handoff, run:

```bash
npm run build
npm run typecheck
npm test
npm run lint
npm run demo:all
```

If adding config fields, update zod schema, JSON Schema, docs, tests, and examples together.
