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

Validate the dry-run package before trusted workflow consumption:

```bash
visual-hive handoff-validate --config visual-hive.config.yaml
```

This writes `.visual-hive/hive-handoff-validation.json`. The validator checks that the Evidence Packet, Handoff Packet, Hive bead request, Hive issue body, and handoff result are present, schema-versioned, internally consistent, sanitized, and still no-network (`externalCallsMade: 0`).

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

Trusted workflow templates:

- `.github/workflows/visual-hive-failure-issue.yml` consumes `.visual-hive/issue.md` from uploaded artifacts and may create or update GitHub issues.
- `.github/workflows/visual-hive-hive-handoff.yml` consumes `.visual-hive/evidence-packet.json`, `.visual-hive/handoff.json`, `.visual-hive/hive-bead-request.json`, `.visual-hive/hive-handoff-validation.json`, `.visual-hive/hive-issue.md`, `.visual-hive/hive-bead-request.json`, and `.visual-hive/hive-handoff-result.json`.
- `.visual-hive/hive-handoff-validation.json` is the local preflight evidence that the trusted workflow handoff package is structurally safe to consume.

The Hive handoff workflow is intentionally artifact-only:

- it uses `workflow_run`, not `pull_request_target`;
- it does not checkout or execute PR code;
- it downloads the `visual-hive` artifact produced by a prior run;
- it re-redacts secret-like values before writing the step summary;
- it expects dry-run artifacts with `externalCallsMade: 0`;
- it runs issue creation only for failed upstream Visual Hive workflows by default;
- it refuses issue creation when `hive-handoff-validation.json` is blocked or missing;
- it creates or updates a deduped GitHub issue from sanitized `hive-issue.md` only after validation is not blocked;
- it leaves the real Hive Bead API call as a future trusted insertion point, not a default behavior.

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
