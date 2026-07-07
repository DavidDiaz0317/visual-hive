# Issue-Centric Agent Architecture

Visual Hive treats issues as the primary business object for humans, Hive, and agents. A Visual Hive issue is not just Markdown. It is a graph-backed, evidence-backed candidate that points to deterministic facts: contracts, selectors, routes, screenshots, mutations, reports, baselines, workflows, and validation commands.

Visual Hive does not repair application code by default. Its production boundary is:

- Detect user-visible risk.
- Prove it with deterministic evidence.
- Package the evidence into reports, Evidence Packets, Visual Graph nodes, issue candidates, and Hive resources.
- Route the work to humans, GitHub issues, Hive, or no-write agents.
- Validate outcomes with deterministic commands.

Hive and agents may perform repair work in explicitly governed workflows. Visual Hive remains the evidence and verdict layer.

## Business State vs Execution State

Issues are business state. They describe what should be reviewed, repaired, suppressed, or validated. Agent runs are execution state. They describe what a particular agent was asked to do, the prompt it received, the budget it used, the output it wrote, and whether the run was blocked.

This separation matters because a failed visual contract can be durable business state while multiple agent attempts, human reviews, and validation reruns happen around it.

## Evidence Inputs

An issue-agent prompt must include these context inputs:

- Issue candidate from `.visual-hive/issues.json`.
- Evidence Packet from `.visual-hive/evidence-packet.json`.
- Visual Graph from `.visual-hive/visual-graph.json`.
- Impact report from `.visual-hive/visual-impact.json`.
- Unresolved graph references from `.visual-hive/visual-graph-unresolved.json`.
- Repo map and repo context.
- Mutation report, deterministic report, screenshots, diffs, and validation commands when available.

The agent must not infer pass/fail authority from any single advisory source. Visual Hive owns the deterministic verdict.

## MCP Context Path

When MCP is available, an issue agent should start with the first-party Visual Hive read-only surface instead of scraping broad `.visual-hive` files:

- `visual_hive_list_issues`
- `visual_hive_get_issue_context`
- `visual_hive_read_issue_queue`
- `visual_hive_query_visual_graph`
- `visual_hive_get_visual_impact`
- `visual_hive_read_evidence_packet`
- `visual_hive_read_mutation_report`
- `visual_hive_get_validation_command`
- `visual_hive_get_agent_prompt`
- `visual_hive_get_handoff_context`

These tools are context and routing helpers only. They do not run targets, mutate source, create GitHub issues, call Hive, upload provider artifacts, approve baselines, or decide pass/fail.

## Visual Graph Role

The Visual Graph connects:

`file -> component -> route -> contract -> screenshot -> mutation_operator -> issue_candidate -> agent_profile -> hive_resource`

This gives agents a bounded context window. Instead of asking an agent to inspect an entire repository, Visual Hive can provide the affected subgraph and a concrete validation command.

## Agent Profiles

Visual Hive defines focused issue-agent profiles:

- `setup_agent`: setup/config/workflow advice.
- `map_agent`: graph, selector, route, and repo-map drift.
- `test_creator_agent`: missing contracts, coverage gaps, and mutation survivors.
- `test_maintainer_agent`: flaky, stale, or weak tests and baselines.
- `mutation_agent`: mutation adequacy mapping and survivor analysis.
- `review_agent`: general review and triage.

Default local runs are no-write. Write mode must be explicit and governed.

## Safe Handoff Pattern

For untrusted PRs:

- Run deterministic checks without secrets.
- Generate sanitized evidence artifacts.
- Upload artifacts.
- Do not create issues, branches, PRs, provider uploads, Hive API calls, or LLM calls.

For trusted handoff:

- Consume sanitized artifacts.
- Validate handoff and dedupe fingerprint.
- Create or update a GitHub issue, or later a Hive Bead/API request.
- Do not checkout or execute untrusted PR code in the issue-creation workflow.

## Agent Output Contract

Issue-agent output should include:

- `summary`
- `graphNodesUsed`
- `artifactsUsed`
- `proposedChanges`
- `validationCommand`
- `safetyNotes`

Agents may recommend changes, but Visual Hive validates those changes with deterministic commands before any claim of resolution.
