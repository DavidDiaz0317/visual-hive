# Tool Registry And Tool Cards

Visual Hive exposes agent tools through a registry instead of dumping every CLI command, MCP server, and provider integration into an agent context.

Run:

```bash
visual-hive tools --config visual-hive.config.yaml
```

This writes:

- `.visual-hive/tools/tool-registry.json`
- `.visual-hive/tools/tool-cards.md`

Schema: `schemas/visual-hive.tool-registry.schema.json`

## Purpose

The registry tells agents which tools exist, which roles may use them, which modes are safe, and which actions require human or trusted-workflow approval.

Tool Cards are the compact, human-readable version. They let an agent see the few tools relevant to a profile without loading full MCP schemas or raw artifact dumps.

## Default Policy

The initial policy is conservative:

- third-party MCP exposure is disabled by default;
- provider MCPs and uploads require trusted mode;
- GitHub writes from PR execution are disabled;
- external uploads from PR execution are disabled;
- agents cannot approve baselines;
- default external cost budget is `0`;
- secret values must not be exposed.

## Roles

The registry includes role profiles for:

- `setup_agent`
- `repair_agent`
- `test_creator`
- `review_agent`
- `handoff_agent`
- `provider_specialist`

Each role gets a bounded list of allowed tool IDs and forbidden actions. Trusted-only roles may see issue or provider handoff tools, but those tools still require a trusted workflow and human approval policy.

## Governance

The Tool Registry does not execute tools. It is a policy artifact consumed by Agent Packets, future MCP adapters, the Control Plane, and human reviewers.

Visual Hive remains the verdict authority. Tools may gather evidence, repair code, suggest tests, or prepare handoff artifacts. They must not decide pass/fail, expose secrets, bypass baseline review, or enable paid/external providers by default.
