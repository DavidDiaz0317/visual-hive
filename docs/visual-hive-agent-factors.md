# Visual Hive Agent Factors

Visual Hive adapts 12-factor-agent principles to visual QA and issue handoff.

## 1. Own The Context Window

Visual Hive packages the relevant issue, Evidence Packet, Visual Graph, impact analysis, screenshots, mutation evidence, and validation command. Agents receive bounded evidence instead of a vague repo-wide task.

## 2. Own The Prompt

Agent prompts are generated artifacts. They include structured blocks for issue, evidence summary, graph refs, impact, artifacts, allowed actions, forbidden actions, validation, and output schema.

## 3. Tools Return Structured Outputs

Visual Hive exposes graph, issue, impact, evidence, MCP, tool registry, and context-ledger resources. Agents should read structured artifacts instead of scraping terminal logs.

For issue work, prefer the MCP issue path: `visual_hive_get_issue_context`, `visual_hive_read_issue_queue`, `visual_hive_query_visual_graph`, `visual_hive_get_visual_impact`, `visual_hive_read_evidence_packet`, `visual_hive_read_mutation_report`, `visual_hive_get_validation_command`, `visual_hive_get_agent_prompt`, and `visual_hive_get_handoff_context`. These tools are read-only context adapters over existing artifacts.

## 4. Unify Execution State And Business State

Issue candidates are business state. Agent runs are execution state. Both are artifacts and can be audited independently.

## 5. Launch, Pause, Resume Through Simple APIs

`visual-hive agent issue-runner` reads an issue and writes an agent run. Default no-write mode can pause safely when Codex or another agent runner is unavailable.

## 6. Own Control Flow

Visual Hive decides when to plan, run, mutate, triage, produce evidence, hand off, or validate. Agents do not bypass the Visual Hive verdict layer.

## 7. Use Small Focused Agents

Profiles are intentionally narrow: setup, map, test creator, test maintainer, mutation, and review. A mutation survivor should go to a test-creation or mutation-focused agent, not a broad repair agent by default.

## 8. Agents Are Stateless Reducers

An agent run consumes issue + evidence + graph + impact + policy and returns a bounded recommendation or artifact. It should not rely on hidden memory or undocumented side effects.

## 9. High-Risk Actions Pause

Baseline approval, threshold weakening, protected target execution, real issue creation, provider upload, Hive API calls, branch creation, PR creation, and source mutation require explicit trusted policy.

## 10. Visual Hive Validates Outcomes

Visual Hive owns the final deterministic verdict. Playwright is the default first-party browser runner and primary local evidence source, but the Visual Hive verdict engine aggregates deterministic evidence from selectors, user flows, screenshots, console/page/network policy, mutation adequacy, provider-normalized results when configured, and protected canaries.

LLMs, MCP tools, Hive, and agents are consumers and repair actors. They are never sole pass/fail authorities.
