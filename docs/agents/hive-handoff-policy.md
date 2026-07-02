# Hive Handoff Policy

Visual Hive handoff is evidence-first and no-network by default.

Required order:

```text
plan -> run -> mutate/triage -> evidence -> handoff dry-run -> trusted issue/Hive workflow
```

The local command is:

```bash
visual-hive handoff --dry-run
```

It requires `.visual-hive/evidence-packet.json` and writes:

- `.visual-hive/handoff.json`
- `.visual-hive/hive-issue.md`
- `.visual-hive/hive-bead-request.json`
- `.visual-hive/hive-handoff-result.json`

The Handoff Packet converts evidence into bounded work items:

- deterministic failures become `repair` tasks;
- blocked evidence collection becomes `setup` tasks;
- mutation survivors become `test_creation` tasks;
- missing, unknown, or partial testing layers become setup, test-creation, or review tasks depending on the layer.

This keeps Hive and coding agents focused on concrete evidence gaps instead of raw logs or broad repository context.

Policy:

- Visual Hive's deterministic Verdict Engine owns pass/fail.
- Hive, LLMs, MCP tools, and agents are advisory repair/handoff actors.
- Dry-run handoff makes `externalCallsMade: 0`.
- GitHub issue creation requires a trusted workflow that consumes sanitized artifacts.
- Hive Bead creation requires human/trusted-workflow approval.
- PR workflows must not use `pull_request_target` to execute untrusted code.
- Secret values must never appear in handoff JSON or Markdown.
- Missing secret names may be reported when useful for trusted setup.

Default config:

```yaml
integrations:
  hive:
    enabled: false
    mode: dry_run
    labels:
      - visual-hive
      - hive/quality
      - ai-ready
    beadApi:
      url: https://hive.example.invalid/api/beads
      tokenEnv: HIVE_DASHBOARD_TOKEN
      agent: quality
```

The bead request records only trusted-setup metadata: configured mode, optional bead API URL with secret-like query values redacted, token environment variable name, whether that environment variable was present, and the agent name. It never records the token value.

Future `github_issue` and `bead_api` modes should remain trusted-lane only. They must consume the Evidence Packet or Handoff Packet and must not scrape raw CI logs as their source of truth.
