# Enterprise Definition Of Done

For agent-forward work in Visual Hive, "done" means the system produces inspectable deterministic evidence, not just passing local commands.

Minimum bar for code changes:

- Visual Hive's deterministic Verdict Engine remains the pass/fail authority.
- Playwright remains the default first-party browser backend and primary local evidence source.
- LLMs, MCP tools, Hive agents, and hosted providers do not become default verdict authorities.
- New config fields update Zod schema, JSON Schema, docs, tests, and examples together.
- PR workflows stay read-only, no-secret, and do not execute untrusted code from `pull_request_target`.
- Secret values are redacted from JSON, Markdown, logs, provider output, issue bodies, and handoff packets.
- Relevant artifacts are written under `.visual-hive/` with stable schema versions.

Agent-forward changes should prefer vertical slices:

```text
plan -> run -> report -> triage -> evidence -> handoff -> agent packet -> tools -> UI
```

When evidence or reporting changes, `visual-hive evidence` should still produce:

- `.visual-hive/evidence-packet.json`
- `.visual-hive/evidence-summary.md`

The packet must explain the Visual Hive verdict, gating evidence, advisory-only evidence, artifact pointers, and handoff readiness.
