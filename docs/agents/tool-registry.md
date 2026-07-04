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

Resource-backed read-only Tool Cards should use the shared evidence resource catalog in `packages/core/src/tools/evidenceResources.ts`. That catalog is also used by the MCP manifest, Agent Packet allowed-tool metadata, artifact index entries, and Control Plane artifact links, so artifact paths, read-tool names, descriptions, and local read restrictions stay aligned instead of drifting across CLI, core, docs, and schemas.

For catalog-backed entries, `tool-registry.json` includes `evidenceResourceId`, `evidenceResourceUri`, `evidenceResourceTitle`, `evidenceResourceDescription`, and `evidenceReadToolName`. The Tool Registry schema constrains those fields to known catalog values so agent-facing tool cards cannot silently point at invented resources or stale read tools.

## Default Policy

The initial policy is conservative:

- third-party MCP exposure is disabled by default;
- provider MCPs and uploads require trusted mode;
- provider evidence reads, such as `visual_hive_read_provider_results`, `visual_hive_read_provider_upload_manifest`, and `visual_hive_read_provider_agent_packet`, are local read-only tools and do not grant provider upload authority;
- Control Plane snapshot reads, such as `visual_hive_read_control_plane_snapshot`, expose guided setup/runbook/navigation evidence only and do not grant UI write or command execution authority;
- setup recommendation reads, such as `visual_hive_read_setup_recommendations` and `visual_hive_read_setup_pr_plan`, expose no-network setup guidance, setup bundle review, and workflow-safety evidence only and do not authorize writing config, docs, workflows, secrets, or provider settings;
- run-history reads, such as `visual_hive_read_run_history`, expose longitudinal status, flake, baseline, mutation, runtime, and cost trend evidence only and do not authorize reruns, baseline approval, or verdict-policy changes;
- workflow audit reads, such as `visual_hive_read_workflow_audit`, expose PR workflow safety and trusted workflow-run posture only and do not authorize writing workflows, granting secrets, creating issues, or executing untrusted PR code;
- baseline governance reads, such as `visual_hive_read_baseline_review`, `visual_hive_read_baseline_approvals`, and `visual_hive_read_baseline_rejections`, expose created, missing, failed, approved, rejected, and pending screenshot review evidence only and do not authorize approving, rejecting, copying, or updating baselines;
- testing-layer reads, such as `visual_hive_read_testing_layers`, expose missing-layer and coverage-lattice evidence only and do not make advisory coverage guidance a verdict override;
- coverage-recommendation reads, such as `visual_hive_read_coverage_recommendations`, expose deterministic no-write coverage and config-improvement suggestions only and do not authorize applying config edits;
- test-creation-plan reads, such as `visual_hive_read_test_creation_plan`, expose no-write missing-test recommendations only and do not authorize edits to config, tests, baselines, or thresholds;
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

Each role gets a bounded, policy-ranked list of allowed tool IDs and forbidden actions. The default registry caps each profile at `maxToolDefinitionsPerAgent` so agents receive the highest-value evidence tools first instead of whichever tools happen to appear earliest in source order. Evidence Packet, Control Plane snapshot, Verdict, Handoff/Hive, provider-read, and context-budget tools are ranked per role before optional execution or external tools.

Trusted-only roles may see issue or provider handoff tools, but those tools still require a trusted workflow and human approval policy. Provider specialists and handoff agents may read sanitized provider results and upload manifests to understand evidence; they may not upload artifacts unless `visual_hive_provider_upload` is explicitly enabled by trusted policy.

## Governance

The Tool Registry does not execute tools. It is a policy artifact consumed by Agent Packets, the first-party Visual Hive MCP manifest/server, future third-party MCP adapters, the Control Plane, and human reviewers.

Visual Hive remains the verdict authority. Tools may gather evidence, repair code, suggest tests, or prepare handoff artifacts. They must not decide pass/fail, expose secrets, bypass baseline review, or enable paid/external providers by default.
