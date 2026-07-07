import type { ToolMode, ToolRole } from "./types.js";

export type EvidenceResourceMimeType = "application/json" | "text/markdown" | "text/yaml";

export interface EvidenceResourceReadToolDefinition {
  name: string;
  title: string;
  description: string;
  command?: string;
  roles?: ToolRole[];
  modes?: ToolMode[];
  writeRestrictions?: string[];
}

export interface EvidenceResourceDefinition {
  id: string;
  uri: `visual-hive://${string}`;
  name: string;
  title: string;
  description: string;
  relativePath: string;
  mimeType: EvidenceResourceMimeType;
  readTool?: EvidenceResourceReadToolDefinition;
}

export const VISUAL_HIVE_EVIDENCE_RESOURCES = [
  resource("config", "visual-hive://config", "config", "Visual Hive Config", "Validated Visual Hive YAML configuration for this repository.", "visual-hive.config.yaml", "text/yaml"),
  resource("latest-plan", "visual-hive://latest-plan", "latest-plan", "Latest Plan", "Latest deterministic plan artifact.", ".visual-hive/plan.json"),
  resource(
    "plan-lanes",
    "visual-hive://plan-lanes",
    "plan-lanes",
    "Plan Lanes",
    "Lane summary across active and sidecar plan artifacts, including PR, schedule, canary, full, and docs-only planning evidence.",
    ".visual-hive/plans.json",
    "application/json",
    readTool(
      "visual_hive_read_plan_lanes",
      "Read Plan Lanes",
      "Read the generated plan lane summary without running targets or changing plan selection.",
      "visual-hive plans",
      ["Read plan-lane evidence only. Do not infer a new verdict, run targets, or change plan policy from lane summaries alone."]
    )
  ),
  resource(
    "setup-recommendations",
    "visual-hive://setup-recommendations",
    "setup-recommendations",
    "Setup Recommendations",
    "No-network setup recommendation evidence for configuring Visual Hive safely in a repository.",
    ".visual-hive/recommendations.json",
    "application/json",
    readTool(
      "visual_hive_read_setup_recommendations",
      "Read Setup Recommendations",
      "Read no-network setup recommendations without writing config, docs, workflows, secrets, or provider settings.",
      "visual-hive recommend",
      ["Read setup recommendations only. Do not write config, docs, workflows, secrets, or provider settings from the default evidence surface."]
    )
  ),
  resource(
    "setup-pr-plan",
    "visual-hive://setup-pr-plan",
    "setup-pr-plan",
    "Setup Pull Request Plan",
    "No-network setup PR plan with proposed files, workflow safety checks, provider posture, and validation commands.",
    ".visual-hive/setup-pr-plan.json",
    "application/json",
    readTool(
      "visual_hive_read_setup_pr_plan",
      "Read Setup PR Plan",
      "Read the setup pull request plan without creating branches, pull requests, issues, workflows, secrets, or provider settings.",
      "visual-hive recommend",
      ["Read setup PR plan evidence only. Do not create branches, pull requests, issues, workflows, secrets, or provider settings from the default evidence surface."]
    )
  ),
  resource(
    "repo-map",
    "visual-hive://repo-map",
    "repo-map",
    "Repository Intelligence Map",
    "Sanitized deterministic repository scan with package manager, frameworks, scripts, selectors, route hints, workflow hints, risk signals, and coverage gaps.",
    ".visual-hive/repo-map.json",
    "application/json",
    readTool(
      "visual_hive_read_repo_map",
      "Read Repository Map",
      "Read deterministic repository intelligence without scanning additional source files or changing setup.",
      "visual-hive analyze --repo .",
      ["Read repo intelligence evidence only. Do not infer verdict status, run targets, or authorize setup writes from repo-map evidence alone."]
    )
  ),
  resource(
    "repo-context",
    "visual-hive://repo-context",
    "repo-context",
    "Repository Context Summary",
    "Sanitized Markdown summary of deterministic repository intelligence for humans and agents.",
    ".visual-hive/repo-context.md",
    "text/markdown",
    readTool(
      "visual_hive_read_repo_context",
      "Read Repository Context",
      "Read the generated repository context summary without scanning additional source files or changing setup.",
      "visual-hive analyze --repo .",
      ["Read repo context evidence only. Do not infer verdict status, run targets, or authorize setup writes from repo-context evidence alone."]
    )
  ),
  resource(
    "visual-graph",
    "visual-hive://visual-graph",
    "visual-graph",
    "Visual Graph",
    "Production Visual Hive graph connecting files, components, routes, selectors, contracts, screenshots, mutations, artifacts, issues, agents, and Hive resources.",
    ".visual-hive/visual-graph.json",
    "application/json",
    readTool(
      "visual_hive_read_visual_graph",
      "Read Visual Graph",
      "Read the deterministic Visual Graph without running targets, creating issues, or invoking agents.",
      "visual-hive graph search dashboard",
      ["Read graph evidence only. Do not repair code, approve baselines, weaken thresholds, or create issues from graph evidence alone."]
    )
  ),
  resource(
    "visual-graph-summary",
    "visual-hive://visual-graph-summary",
    "visual-graph-summary",
    "Visual Graph Summary",
    "Human-readable Visual Graph summary with node counts, unresolved references, and extractor coverage.",
    ".visual-hive/visual-graph-summary.md",
    "text/markdown",
    readTool(
      "visual_hive_read_visual_graph_summary",
      "Read Visual Graph Summary",
      "Read the Visual Graph summary without changing repository state.",
      "visual-hive analyze --repo .",
      ["Read graph summary only. Do not treat unresolved references as failures unless policy explicitly gates them."]
    )
  ),
  resource(
    "visual-graph-vocab",
    "visual-hive://visual-graph-vocab",
    "visual-graph-vocab",
    "Visual Graph Vocabulary",
    "Search vocabulary for agent and UI lookup of graph nodes by selectors, routes, contracts, screenshots, mutation operators, and labels.",
    ".visual-hive/visual-graph-vocab.json",
    "application/json",
    readTool(
      "visual_hive_read_visual_graph_vocab",
      "Read Visual Graph Vocabulary",
      "Read graph search vocabulary without rescanning source files.",
      "visual-hive graph search login",
      ["Read vocabulary only. Do not infer pass/fail status from vocabulary terms."]
    )
  ),
  resource(
    "visual-graph-unresolved",
    "visual-hive://visual-graph-unresolved",
    "visual-graph-unresolved",
    "Visual Graph Unresolved References",
    "Unresolved and resolved graph reference lifecycle evidence for component-route, selector-component, mutation-contract, workflow-command, issue-artifact, and artifact-node links.",
    ".visual-hive/visual-graph-unresolved.json",
    "application/json",
    readTool(
      "visual_hive_read_visual_graph_unresolved",
      "Read Visual Graph Unresolved References",
      "Read unresolved graph reference evidence for map maintenance and issue context.",
      "visual-hive graph impact",
      ["Read unresolved reference evidence only. Do not suppress findings or mark references resolved without new deterministic evidence."]
    )
  ),
  resource(
    "visual-graph-impact",
    "visual-hive://visual-graph-impact",
    "visual-graph-impact",
    "Visual Impact Analysis",
    "Blast-radius analysis from changed files, routes, contracts, mutations, or issue candidates into affected visual surfaces and validation commands.",
    ".visual-hive/visual-impact.json",
    "application/json",
    readTool(
      "visual_hive_read_visual_graph_impact",
      "Read Visual Impact Analysis",
      "Read the latest Visual Graph impact analysis without running validation commands.",
      "visual-hive graph impact --changed-files changed-files.txt",
      ["Read impact evidence only. Do not execute repair or publish issues from impact evidence alone."]
    )
  ),
  resource(
    "visual-impact",
    "visual-hive://visual-impact",
    "visual-impact",
    "Visual Impact",
    "Product-facing alias for the latest Visual Impact analysis consumed by issue agents and MCP clients.",
    ".visual-hive/visual-impact.json"
  ),
  resource(
    "latest-report",
    "visual-hive://latest-report",
    "latest-report",
    "Latest Report",
    "Latest deterministic Visual Hive report.",
    ".visual-hive/report.json",
    "application/json",
    readTool("visual_hive_read_latest_report", "Read Latest Report", "Read the latest deterministic report artifact.", "visual-hive report")
  ),
  resource("report", "visual-hive://report", "report", "Report", "Product-facing alias for the latest deterministic Visual Hive report.", ".visual-hive/report.json"),
  resource(
    "latest-evidence",
    "visual-hive://latest-evidence",
    "latest-evidence",
    "Latest Evidence Packet",
    "Sanitized Evidence Packet consumed by humans, agents, GitHub, and Hive handoff flows.",
    ".visual-hive/evidence-packet.json",
    "application/json",
    readTool("visual_hive_read_evidence_packet", "Read Evidence Packet", "Read the latest sanitized Evidence Packet.", "visual-hive evidence")
  ),
  resource(
    "evidence-packet",
    "visual-hive://evidence-packet",
    "evidence-packet",
    "Evidence Packet",
    "Product-facing alias for the latest sanitized Evidence Packet used by agents, GitHub, Hive, and MCP clients.",
    ".visual-hive/evidence-packet.json"
  ),
  resource(
    "control-plane-snapshot",
    "visual-hive://control-plane-snapshot",
    "control-plane-snapshot",
    "Control Plane Snapshot",
    "Schema-backed local Control Plane snapshot with guidance state, adoption checklist, runbook, run profiles, failures, artifacts, and navigation evidence.",
    ".visual-hive/control-plane-snapshot.json",
    "application/json",
    readTool(
      "visual_hive_read_control_plane_snapshot",
      "Read Control Plane Snapshot",
      "Read the latest schema-backed Control Plane snapshot artifact.",
      "visual-hive snapshot",
      ["Read snapshot evidence only. Do not treat UI guidance as a verdict override."]
    )
  ),
  resource(
    "latest-verdict",
    "visual-hive://latest-verdict",
    "latest-verdict",
    "Latest Visual Hive Verdict",
    "Normalized Visual Hive verdict artifact assembled from deterministic evidence contributions.",
    ".visual-hive/verdict.json",
    "application/json",
    readTool("visual_hive_read_verdict", "Read Visual Hive Verdict", "Read the latest normalized Visual Hive verdict artifact.", "visual-hive verdict")
  ),
  resource(
    "readiness-gate",
    "visual-hive://readiness-gate",
    "readiness-gate",
    "Readiness Gate",
    "Go/no-go readiness evidence across deterministic results, baseline review, mutation adequacy, workflow safety, provider posture, costs, and setup gaps.",
    ".visual-hive/readiness.json",
    "application/json",
    readTool(
      "visual_hive_read_readiness_gate",
      "Read Readiness Gate",
      "Read the latest readiness gate artifact without running targets or changing repository state.",
      "visual-hive readiness",
      ["Read readiness evidence only. Do not treat readiness guidance as a verdict override."]
    )
  ),
  resource(
    "run-history",
    "visual-hive://run-history",
    "run-history",
    "Run History",
    "Longitudinal local run history for deterministic status, mutation score, flake signals, baseline review, and cost/runtime trend evidence.",
    ".visual-hive/history.json",
    "application/json",
    readTool(
      "visual_hive_read_run_history",
      "Read Run History",
      "Read longitudinal Visual Hive run history without rerunning checks, changing baselines, or changing verdict policy.",
      "visual-hive history",
      ["Read run history evidence only. Do not infer a new verdict, rerun targets, approve baselines, or change policy from history alone."]
    )
  ),
  resource(
    "workflow-audit",
    "visual-hive://workflow-audit",
    "workflow-audit",
    "Workflow Audit",
    "GitHub workflow safety evidence for PR permissions, secret use, pull_request_target posture, artifact upload, and trusted workflow_run patterns.",
    ".visual-hive/workflows.json",
    "application/json",
    readTool(
      "visual_hive_read_workflow_audit",
      "Read Workflow Audit",
      "Read workflow safety evidence without writing workflows, creating issues, or executing pull request code.",
      "visual-hive workflows",
      ["Read workflow audit evidence only. Do not write workflows, create issues, grant secrets, or execute untrusted PR code from the default evidence surface."]
    )
  ),
  resource(
    "path-leak-scan",
    "visual-hive://path-leak-scan",
    "path-leak-scan",
    "Issue-Facing Path Leak Scan",
    "Safety scan proving issue-facing artifacts do not expose local absolute paths, user home directories, cloud-synced user paths, drive-letter paths, or other machine-specific artifact paths.",
    ".visual-hive/path-leak-scan.json",
    "application/json",
    readTool(
      "visual_hive_read_path_leak_scan",
      "Read Issue-Facing Path Leak Scan",
      "Read path leak scan evidence without publishing issues, mutating artifacts, or executing repository code.",
      "visual-hive path-scan",
      ["Read path-leak evidence only. Do not publish issues, create branches, mutate source, or treat a passing scan as proof that deterministic validation passed."]
    )
  ),
  resource(
    "baseline-review",
    "visual-hive://baseline-review",
    "baseline-review",
    "Baseline Review Queue",
    "Screenshot baseline review queue with created, failed, missing, approved, rejected, and pending review evidence.",
    ".visual-hive/baselines.json",
    "application/json",
    readTool(
      "visual_hive_read_baseline_review",
      "Read Baseline Review Queue",
      "Read baseline review queue evidence without approving, rejecting, or updating screenshot baselines.",
      "visual-hive baselines list --write",
      ["Read baseline review evidence only. Do not approve, reject, update, or copy baselines from the default evidence surface."]
    )
  ),
  resource(
    "baseline-approvals",
    "visual-hive://baseline-approvals",
    "baseline-approvals",
    "Baseline Approval Log",
    "Explicit human baseline approval audit log for screenshot review decisions.",
    ".visual-hive/baseline-approvals.json",
    "application/json",
    readTool(
      "visual_hive_read_baseline_approvals",
      "Read Baseline Approval Log",
      "Read baseline approval decisions without approving or updating baselines.",
      "visual-hive baselines list",
      ["Read baseline approval evidence only. Do not approve, reject, update, or copy baselines from the default evidence surface."]
    )
  ),
  resource(
    "baseline-rejections",
    "visual-hive://baseline-rejections",
    "baseline-rejections",
    "Baseline Rejection Log",
    "Explicit human baseline rejection audit log for screenshot review decisions.",
    ".visual-hive/baseline-rejections.json",
    "application/json",
    readTool(
      "visual_hive_read_baseline_rejections",
      "Read Baseline Rejection Log",
      "Read baseline rejection decisions without approving, rejecting, or updating baselines.",
      "visual-hive baselines list",
      ["Read baseline rejection evidence only. Do not approve, reject, update, or copy baselines from the default evidence surface."]
    )
  ),
  resource(
    "testing-layers",
    "visual-hive://testing-layers",
    "testing-layers",
    "Testing Layers",
    "Testing-layer coverage lattice, missing-layer evidence, and advisory next steps.",
    ".visual-hive/testing-layers.json",
    "application/json",
    readTool(
      "visual_hive_read_testing_layers",
      "Read Testing Layers",
      "Read testing-layer coverage and missing-layer evidence without changing verdict policy.",
      "visual-hive layers",
      ["Read testing-layer evidence only. Do not treat missing-layer guidance as a verdict override."]
    )
  ),
  resource(
    "test-creation-plan",
    "visual-hive://test-creation-plan",
    "test-creation-plan",
    "Test Creation Plan",
    "No-write advisory test-creation recommendations from testing layers, mutation survivors, coverage recommendations, and handoff work.",
    ".visual-hive/test-creation-plan.json",
    "application/json",
    readTool(
      "visual_hive_read_test_creation_plan",
      "Read Test Creation Plan",
      "Read advisory no-write test-creation recommendations without editing config or tests.",
      "visual-hive test-creation-plan",
      ["Read test-creation guidance only. Do not edit config, tests, thresholds, or baselines from the default evidence surface."]
    )
  ),
  resource(
    "latest-handoff",
    "visual-hive://latest-handoff",
    "latest-handoff",
    "Latest Handoff Packet",
    "Dry-run GitHub/Hive handoff packet.",
    ".visual-hive/handoff.json",
    "application/json",
    readTool(
      "visual_hive_generate_handoff_dry_run",
      "Read Handoff Dry Run",
      "Return the existing dry-run handoff packet if it has been generated; no issue or Hive Bead is created.",
      "visual-hive handoff --dry-run"
    )
  ),
  resource(
    "handoff",
    "visual-hive://handoff",
    "handoff",
    "Handoff",
    "Product-facing alias for the dry-run GitHub/Hive handoff packet.",
    ".visual-hive/handoff.json"
  ),
  resource(
    "handoff-validation",
    "visual-hive://handoff-validation",
    "handoff-validation",
    "Handoff Validation",
    "No-network validation report for Evidence Packet and Hive handoff artifacts.",
    ".visual-hive/hive-handoff-validation.json",
    "application/json",
    readTool("visual_hive_validate_handoff", "Read Handoff Validation", "Return the existing no-network handoff validation report if it has been generated.", "visual-hive handoff-validate")
  ),
  resource(
    "hive-export",
    "visual-hive://hive-export",
    "hive-export",
    "Hive Native Export",
    "Hive-native beads, knowledge facts, graph, issue context, agent policy, and guarded repair work-order summary.",
    ".visual-hive/hive/hive-export.json",
    "application/json",
    readTool("visual_hive_read_hive_export", "Read Hive Native Export", "Return the existing no-network Hive-native export bundle if it has been generated.", "visual-hive hive export --dry-run")
  ),
  resource(
    "hive-beads",
    "visual-hive://hive/beads",
    "hive-beads",
    "Hive Beads",
    "Focused Hive-native bead work items derived from deterministic Visual Hive evidence.",
    ".visual-hive/hive/beads.json",
    "application/json",
    readTool(
      "visual_hive_read_hive_beads",
      "Read Hive Beads",
      "Return the existing no-network Hive bead work items if they have been generated.",
      "visual-hive hive export --dry-run",
      ["Read Hive bead evidence only. Do not create Beads or call Hive from the default MCP surface."]
    )
  ),
  resource(
    "hive-knowledge-facts",
    "visual-hive://hive/knowledge-facts",
    "hive-knowledge-facts",
    "Hive Knowledge Facts",
    "Focused project knowledge facts extracted for Hive graph/wiki consumers from Visual Hive evidence.",
    ".visual-hive/hive/knowledge-facts.json",
    "application/json",
    readTool(
      "visual_hive_read_hive_knowledge_facts",
      "Read Hive Knowledge Facts",
      "Return the existing no-network Hive knowledge facts if they have been generated.",
      "visual-hive hive export --dry-run"
    )
  ),
  resource(
    "hive-knowledge-graph",
    "visual-hive://hive/knowledge-graph",
    "hive-knowledge-graph",
    "Hive Knowledge Graph",
    "Focused Hive-native graph nodes and edges linking evidence, facts, beads, and repair work.",
    ".visual-hive/hive/knowledge-graph.json",
    "application/json",
    readTool(
      "visual_hive_read_hive_knowledge_graph",
      "Read Hive Knowledge Graph",
      "Return the existing no-network Hive knowledge graph if it has been generated.",
      "visual-hive hive export --dry-run"
    )
  ),
  resource(
    "hive-wiki-index",
    "visual-hive://hive/wiki-index",
    "hive-wiki-index",
    "Hive Wiki Index",
    "Focused index of Hive wiki-vault pages generated from deterministic Visual Hive knowledge facts.",
    ".visual-hive/hive/wiki-index.json",
    "application/json",
    readTool(
      "visual_hive_read_hive_wiki_index",
      "Read Hive Wiki Index",
      "Return the existing no-network Hive wiki-vault page index if it has been generated.",
      "visual-hive hive export --dry-run",
      ["Read wiki-vault index evidence only. Do not create wiki pages in Hive or call Hive from the default MCP surface."]
    )
  ),
  resource(
    "hive-repair-work-orders",
    "visual-hive://hive/repair-work-orders",
    "hive-repair-work-orders",
    "Hive Repair Work Orders",
    "Focused guarded repair work orders for future trusted Hive repair lanes.",
    ".visual-hive/hive/repair-work-orders.json",
    "application/json",
    readTool(
      "visual_hive_read_hive_repair_work_orders",
      "Read Hive Repair Work Orders",
      "Return the existing no-network Hive repair work orders if they have been generated.",
      "visual-hive hive export --dry-run",
      ["Read repair work-order evidence only. Do not execute repair or create branches from the default MCP surface."]
    )
  ),
  resource(
    "hive-agent-policy",
    "visual-hive://hive/agent-policy",
    "hive-agent-policy",
    "Hive Agent Policy",
    "Focused Hive agent policy showing allowed actors, forbidden actions, budgets, and verdict-authority limits.",
    ".visual-hive/hive/hive-agent-policy.json",
    "application/json",
    readTool(
      "visual_hive_read_hive_agent_policy",
      "Read Hive Agent Policy",
      "Return the existing no-network Hive agent policy if it has been generated.",
      "visual-hive hive export --dry-run",
      ["Read policy evidence only. Visual Hive remains the verdict authority."]
    )
  ),
  resource(
    "hive-guarded-repair-preview",
    "visual-hive://hive-guarded-repair-preview",
    "hive-guarded-repair-preview",
    "Hive Guarded Repair Preview",
    "Preview-only guarded Hive repair gate with branch, review, rerun, and forbidden-action policy.",
    ".visual-hive/hive/guarded-repair-preview.json",
    "application/json",
    readTool(
      "visual_hive_read_hive_guarded_repair_preview",
      "Read Hive Guarded Repair Preview",
      "Return the existing no-network guarded repair preview if it has been generated.",
      "visual-hive hive guarded-repair-preview"
    )
  ),
  resource(
    "hive-repair-request-envelope",
    "visual-hive://hive-repair-request-envelope",
    "hive-repair-request-envelope",
    "Hive Repair Request Envelope",
    "No-network trusted repair request envelope derived from the guarded repair preview.",
    ".visual-hive/hive/repair-request-envelope.json",
    "application/json",
    readTool(
      "visual_hive_read_hive_repair_request_envelope",
      "Read Hive Repair Request Envelope",
      "Return the existing no-network trusted repair request envelope if it has been generated.",
      "visual-hive hive repair-request-envelope"
    )
  ),
  resource(
    "hive-trusted-repair-consumer-summary",
    "visual-hive://hive-trusted-repair-consumer-summary",
    "hive-trusted-repair-consumer-summary",
    "Hive Trusted Repair Consumer Summary",
    "No-network dry-run trusted repair consumer summary derived from the repair request envelope.",
    ".visual-hive/hive/trusted-repair-consumer-summary.json",
    "application/json",
    readTool(
      "visual_hive_read_hive_trusted_repair_consumer_summary",
      "Read Hive Trusted Repair Consumer Summary",
      "Return the existing no-network trusted repair consumer summary if it has been generated.",
      "visual-hive hive trusted-repair-consumer-summary"
    )
  ),
  resource(
    "hive-trusted-repair-workflow-dry-run",
    "visual-hive://hive-trusted-repair-workflow-dry-run",
    "hive-trusted-repair-workflow-dry-run",
    "Hive Trusted Repair Workflow Dry Run",
    "No-network dry-run plan for future trusted Hive repair workflow actions.",
    ".visual-hive/hive/trusted-repair-workflow-dry-run.json",
    "application/json",
    readTool(
      "visual_hive_read_hive_trusted_repair_workflow_dry_run",
      "Read Hive Trusted Repair Workflow Dry Run",
      "Return the existing no-network trusted repair workflow dry-run if it has been generated.",
      "visual-hive hive trusted-repair-workflow-dry-run"
    )
  ),
  resource(
    "hive-mode-comparison",
    "visual-hive://hive-mode-comparison",
    "hive-mode-comparison",
    "Hive Export Mode Comparison",
    "No-network comparison of advisory, measured, and repair-request Hive export modes.",
    ".visual-hive/hive/mode-comparison.json",
    "application/json",
    readTool(
      "visual_hive_read_hive_mode_comparison",
      "Read Hive Export Mode Comparison",
      "Return the existing no-network Hive export mode comparison if it has been generated.",
      "visual-hive hive compare-modes"
    )
  ),
  resource("coverage-map", "visual-hive://coverage-map", "coverage-map", "Coverage Map", "Visual coverage and missing-test guidance.", ".visual-hive/coverage.json"),
  resource(
    "coverage-recommendations",
    "visual-hive://coverage-recommendations",
    "coverage-recommendations",
    "Coverage Recommendations",
    "Deterministic no-write missing-coverage and config-improvement recommendations for human or agent review.",
    ".visual-hive/coverage-recommendations.json",
    "application/json",
    readTool(
      "visual_hive_read_coverage_recommendations",
      "Read Coverage Recommendations",
      "Read deterministic no-write coverage recommendations without applying config changes.",
      "visual-hive improve-coverage",
      ["Read coverage recommendations only. Do not apply config edits or weaken coverage policy from the default evidence surface."]
    )
  ),
  resource(
    "mutation-report",
    "visual-hive://mutation-report",
    "mutation-report",
    "Mutation Report",
    "Mutation adequacy report and survivor evidence.",
    ".visual-hive/mutation-report.json",
    "application/json",
    readTool("visual_hive_read_mutation_report", "Read Mutation Report", "Read mutation adequacy and survivor evidence.", "visual-hive mcp/read mutation-report")
  ),
  resource(
    "triage-report",
    "visual-hive://triage-report",
    "triage-report",
    "Triage Report",
    "Offline deterministic triage classifications, likely causes, suggested tests, and repair context.",
    ".visual-hive/triage.json",
    "application/json",
    readTool(
      "visual_hive_read_triage_report",
      "Read Triage Report",
      "Read offline triage evidence without calling an LLM, creating issues, or changing verdict policy.",
      "visual-hive triage",
      ["Read triage evidence only. Do not treat LLM-ready explanations as a verdict authority."]
    )
  ),
  resource(
    "triage",
    "visual-hive://triage",
    "triage",
    "Triage",
    "Product-facing alias for offline deterministic triage evidence.",
    ".visual-hive/triage.json"
  ),
  resource(
    "issue-body",
    "visual-hive://issue-body",
    "issue-body",
    "Issue Body",
    "Sanitized GitHub-ready issue body generated from deterministic Visual Hive evidence.",
    ".visual-hive/issue.md",
    "text/markdown",
    readTool(
      "visual_hive_read_issue_body",
      "Read Issue Body",
      "Read the sanitized issue body without creating or updating GitHub issues.",
      "visual-hive triage",
      ["Read issue body evidence only. Issue creation must happen from a trusted workflow_run consumer."]
    )
  ),
  resource(
    "issue-candidates",
    "visual-hive://issues",
    "issue-candidates",
    "Issue Candidates",
    "Stable deduplicated GitHub issue candidates derived from deterministic reports, mutations, coverage, workflow safety, readiness, handoff, and Hive artifacts.",
    ".visual-hive/issues.json",
    "application/json",
    readTool(
      "visual_hive_read_issue_candidates",
      "Read Issue Candidates",
      "Read issue candidates without creating, updating, or closing GitHub issues.",
      "visual-hive issues --write",
      ["Read issue candidate evidence only. Issue creation must happen from a trusted workflow_run consumer or explicitly guarded live smoke."]
    )
  ),
  resource(
    "issue-queue",
    "visual-hive://issue-queue",
    "issue-queue",
    "Issue Queue",
    "Issue-centric work queue grouping Visual Hive findings by Hive readiness, Visual Hive agent readiness, blocked policy, missing artifacts, resolved candidates, and suppressions.",
    ".visual-hive/issue-queue.json",
    "application/json",
    readTool(
      "visual_hive_read_issue_queue",
      "Read Issue Queue",
      "Read the issue queue without publishing issues or running agents.",
      "visual-hive issues --write",
      ["Read issue queue evidence only. Agents and Hive should act from trusted issues, not from untrusted PR execution."]
    )
  ),
  resource(
    "setup-issue",
    "visual-hive://setup-issue",
    "setup-issue",
    "Setup Issue",
    "Agent-ready setup issue markdown for onboarding a repository into Visual Hive without making network calls.",
    ".visual-hive/setup-issue.md",
    "text/markdown",
    readTool(
      "visual_hive_read_setup_issue",
      "Read Setup Issue",
      "Read the setup issue body without creating a GitHub issue.",
      "visual-hive issues --write",
      ["Read setup issue evidence only. Publishing requires trusted workflow permissions."]
    )
  ),
  resource(
    "issue-publish-plan",
    "visual-hive://issue-publish-plan",
    "issue-publish-plan",
    "Issue Publish Plan",
    "No-network trusted issue publication plan showing create/update/skip/block decisions from issue candidates.",
    ".visual-hive/issue-publish-plan.json",
    "application/json",
    readTool(
      "visual_hive_read_issue_publish_plan",
      "Read Issue Publish Plan",
      "Read the issue publication plan without creating or updating GitHub issues.",
      "visual-hive issues publish --dry-run",
      ["Read issue publish planning evidence only. Publishing requires trusted workflow permissions and explicit live mode."]
    )
  ),
  resource(
    "issue-publish-dry-run",
    "visual-hive://issue-publish-dry-run",
    "issue-publish-dry-run",
    "Issue Publish Dry Run",
    "No-network issue publication dry-run evidence showing what trusted publishing would create, update, skip, or block.",
    ".visual-hive/issue-publish-dry-run.json",
    "application/json",
    readTool(
      "visual_hive_read_issue_publish_dry_run",
      "Read Issue Publish Dry Run",
      "Read no-network issue publish dry-run evidence without creating or updating GitHub issues.",
      "visual-hive issues publish --dry-run",
      ["Read issue publish dry-run evidence only. Do not publish issues from untrusted PR execution."]
    )
  ),
  resource(
    "issue-publish-result",
    "visual-hive://issue-publish-result",
    "issue-publish-result",
    "Issue Publish Result",
    "Trusted issue publication result evidence. Default local generation remains dry-run with zero real GitHub issues created.",
    ".visual-hive/issue-publish-result.json",
    "application/json",
    readTool(
      "visual_hive_read_issue_publish_result",
      "Read Issue Publish Result",
      "Read issue publish result evidence without executing another publish action.",
      "visual-hive issues publish --dry-run",
      ["Read publish result evidence only. Do not infer that default local runs created real issues unless realGithubIssuesCreated is nonzero."]
    )
  ),
  resource(
    "pr-comment",
    "visual-hive://pr-comment",
    "pr-comment",
    "Pull Request Comment",
    "Sanitized pull request comment markdown generated from deterministic Visual Hive evidence.",
    ".visual-hive/pr-comment.md",
    "text/markdown",
    readTool(
      "visual_hive_read_pr_comment",
      "Read Pull Request Comment",
      "Read the sanitized PR comment markdown without posting to GitHub.",
      "visual-hive triage",
      ["Read PR comment evidence only. Do not post comments from untrusted PR execution."]
    )
  ),
  resource(
    "triage-prompt",
    "visual-hive://triage-prompt",
    "triage-prompt",
    "Triage Prompt",
    "LLM-ready advisory triage prompt generated from deterministic evidence.",
    ".visual-hive/triage-prompt.md",
    "text/markdown",
    readTool(
      "visual_hive_read_triage_prompt",
      "Read Triage Prompt",
      "Read the advisory triage prompt without calling an LLM.",
      "visual-hive triage",
      ["Read prompt evidence only. LLM output must never be the sole pass/fail authority."]
    )
  ),
  resource(
    "repair-prompt",
    "visual-hive://repair-prompt",
    "repair-prompt",
    "Repair Prompt",
    "Offline advisory repair prompt generated from deterministic evidence.",
    ".visual-hive/repair-prompt.md",
    "text/markdown",
    readTool("visual_hive_generate_repair_prompt", "Read Repair Prompt", "Return the existing offline repair prompt if it has been generated by triage.", "visual-hive triage")
  ),
  resource(
    "missing-tests",
    "visual-hive://missing-tests",
    "missing-tests",
    "Missing Tests",
    "Advisory missing-test recommendations generated from deterministic failures, coverage gaps, and mutation survivors.",
    ".visual-hive/missing-tests.md",
    "text/markdown",
    readTool(
      "visual_hive_read_missing_tests",
      "Read Missing Tests",
      "Read advisory missing-test recommendations without editing config or tests.",
      "visual-hive triage",
      ["Read missing-test guidance only. Do not edit tests, config, thresholds, or baselines without review."]
    )
  ),
  resource(
    "provider-decisions",
    "visual-hive://provider-decisions",
    "provider-decisions",
    "Provider Decisions",
    "Local optional provider governance decisions. Read-only; does not enable credentials, uploads, billing, provider API calls, or provider gating.",
    ".visual-hive/provider-decisions.json",
    "application/json",
    readTool(
      "visual_hive_read_provider_decisions",
      "Read Provider Decisions",
      "Read local optional provider governance decisions without enabling credentials, billing, uploads, or provider gating.",
      "visual-hive providers decision",
      ["Read provider decision evidence only. Do not enable credentials, billing, provider upload, provider API calls, provider gating, or verdict overrides."]
    )
  ),
  resource(
    "provider-setup-plan",
    "visual-hive://provider-setup-plan",
    "provider-setup-plan",
    "Provider Setup Plan",
    "No-network optional provider setup, credential-name, workflow, and safety planning evidence. Read-only; does not enable credentials, billing, uploads, or provider gating.",
    ".visual-hive/provider-setup-plan.json",
    "application/json",
    readTool(
      "visual_hive_read_provider_setup_plan",
      "Read Provider Setup Plan",
      "Read optional provider setup planning evidence without enabling credentials, billing, uploads, or provider gating.",
      "visual-hive providers plan --provider argos",
      ["Read provider setup evidence only. Do not enable credentials, billing, provider upload, provider gating, or external calls from the default evidence surface."]
    )
  ),
  resource(
    "provider-handoff",
    "visual-hive://provider-handoff",
    "provider-handoff",
    "Provider Handoff Manifest",
    "No-network optional provider artifact handoff eligibility and trusted workflow planning evidence. Read-only; does not upload artifacts or authorize provider API calls.",
    ".visual-hive/provider-handoff.json",
    "application/json",
    readTool(
      "visual_hive_read_provider_handoff",
      "Read Provider Handoff Manifest",
      "Read optional provider artifact handoff evidence without uploading artifacts or making provider API calls.",
      "visual-hive providers handoff --provider argos",
      ["Read provider handoff evidence only. Do not upload artifacts, call providers, enable provider gating, or change the Visual Hive verdict."]
    )
  ),
  resource(
    "provider-results",
    "visual-hive://provider-results",
    "provider-results",
    "Provider Results",
    "Normalized optional provider readiness, mock result, and upload status evidence. Read-only; does not authorize provider upload.",
    ".visual-hive/provider-results.json",
    "application/json",
    readTool(
      "visual_hive_read_provider_results",
      "Read Provider Results",
      "Read normalized optional provider evidence without making external calls or enabling provider upload.",
      "visual-hive mcp/read provider-results",
      ["Read provider evidence only. Do not treat provider output as a verdict authority unless the Evidence Packet marks it trusted and gating."]
    )
  ),
  resource(
    "provider-upload-argos-manifest",
    "visual-hive://provider-upload/argos/manifest",
    "provider-upload-argos-manifest",
    "Argos Provider Upload Manifest",
    "Dry-run or trusted-lane Argos upload manifest with staged artifact evidence. Read-only; execution remains disabled by default.",
    ".visual-hive/provider-upload/argos/manifest.json",
    "application/json",
    readTool(
      "visual_hive_read_provider_upload_manifest",
      "Read Provider Upload Manifest",
      "Read the Argos provider upload manifest when present; provider upload execution remains disabled by default.",
      "visual-hive mcp/read provider-upload manifest",
      ["Read upload manifest evidence only. Provider upload remains disabled unless a trusted CLI workflow explicitly invokes it."]
    )
  ),
  resource(
    "artifacts-index",
    "visual-hive://artifacts/index",
    "artifacts-index",
    "Artifact Index",
    "Sanitized index of Visual Hive JSON, markdown, screenshots, and generated spec artifacts.",
    ".visual-hive/artifacts-index.json",
    "application/json",
    readTool("visual_hive_read_artifacts_index", "Read Artifact Index", "Read sanitized artifact inventory and evidence-resource metadata.", "visual-hive mcp/read artifacts-index")
  ),
  resource(
    "artifact-index",
    "visual-hive://artifact-index",
    "artifact-index",
    "Artifact Index",
    "Product-facing alias for the sanitized Visual Hive artifact inventory.",
    ".visual-hive/artifacts-index.json"
  ),
  resource(
    "agent-packet",
    "visual-hive://agent-packet",
    "agent-packet",
    "Agent Packet",
    "Bounded advisory work packet for repair, test-creation, review, or handoff agents.",
    ".visual-hive/agent-packet.json",
    "application/json",
    readTool("visual_hive_read_agent_packet", "Read Agent Packet", "Read the latest bounded advisory Agent Packet.", "visual-hive agent-packet")
  ),
  resource(
    "agent-validation",
    "visual-hive://agent-validation",
    "agent-validation",
    "Agent Artifact Validation",
    "Validation report proving issue-agent request/output/run artifacts exist, budgets are recorded, validation commands are present, and default no-write safety counters remain zero.",
    ".visual-hive/agent-validation.json",
    "application/json",
    readTool(
      "visual_hive_read_agent_validation",
      "Read Agent Artifact Validation",
      "Read no-write agent artifact validation evidence without running agents or enabling write access.",
      "visual-hive agent validate",
      ["Read agent validation evidence only. Do not execute agents, mutate source, create branches, create PRs, create issues, call Hive, call LLMs, or decide the Visual Hive verdict."]
    )
  ),
  resource(
    "handoff-agent-packet",
    "visual-hive://handoff-agent-packet",
    "handoff-agent-packet",
    "Handoff Agent Packet",
    "Role-specific no-network Agent Packet for trusted GitHub/Hive handoff review.",
    ".visual-hive/handoff-agent-packet.json",
    "application/json",
    readTool(
      "visual_hive_read_handoff_agent_packet",
      "Read Handoff Agent Packet",
      "Read the bounded handoff-agent packet for trusted GitHub/Hive routing review.",
      "visual-hive agent-packet --profile handoff_agent --output .visual-hive/handoff-agent-packet.json",
      ["Read handoff packet evidence only. Do not create issues, create Hive Beads, call Hive, call providers, execute repair, or decide the Visual Hive verdict."]
    )
  ),
  resource(
    "provider-agent-packet",
    "visual-hive://provider-agent-packet",
    "provider-agent-packet",
    "Provider Specialist Agent Packet",
    "Role-specific no-network Agent Packet for optional provider evidence review and provider handoff planning.",
    ".visual-hive/provider-agent-packet.json",
    "application/json",
    readTool(
      "visual_hive_read_provider_agent_packet",
      "Read Provider Specialist Agent Packet",
      "Read the bounded provider-specialist packet for provider evidence and policy review.",
      "visual-hive agent-packet --profile provider_specialist --output .visual-hive/provider-agent-packet.json",
      ["Read provider-specialist packet evidence only. Do not upload provider artifacts, enable provider gating, call providers, or decide the Visual Hive verdict."]
    )
  ),
  resource(
    "tool-registry",
    "visual-hive://tool-registry",
    "tool-registry",
    "Tool Registry",
    "Governed Visual Hive tool registry and MCP/provider policy surface.",
    ".visual-hive/tools/tool-registry.json",
    "application/json",
    readTool("visual_hive_read_tool_registry", "Read Tool Registry", "Read the governed first-party and optional tool policy registry.", "visual-hive tools")
  ),
  resource(
    "context-ledger",
    "visual-hive://context-ledger",
    "context-ledger",
    "Context Ledger",
    "Governance ledger for tool calls, token estimates, external cost, provider screenshots, and escalation budgets.",
    ".visual-hive/context-ledger.json",
    "application/json",
    readTool("visual_hive_read_context_ledger", "Read Context Ledger", "Read the governance ledger for tool, token, provider, and escalation budget evidence.", "visual-hive context")
  ),
  resource(
    "pipeline-status",
    "visual-hive://pipeline-status",
    "pipeline-status",
    "Pipeline Status",
    "Latest operational pipeline status across repo intelligence, evidence, verdict, handoff, agent, tool, and context artifacts.",
    ".visual-hive/pipeline.json",
    "application/json",
    readTool("visual_hive_read_pipeline_status", "Read Pipeline Status", "Read the latest operational pipeline artifact status.", "visual-hive pipeline")
  ),
  resource(
    "schema-catalog",
    "visual-hive://schema-catalog",
    "schema-catalog",
    "Schema Catalog Verification",
    "Schema/catalog drift report proving checked-in JSON Schemas and evidence-resource metadata still agree.",
    ".visual-hive/schema-catalog.json",
    "application/json",
    readTool(
      "visual_hive_read_schema_catalog",
      "Read Schema Catalog Verification",
      "Read the latest schema/catalog drift report without modifying schemas or evidence artifacts.",
      "visual-hive schemas verify --output .visual-hive/schema-catalog.json",
      ["Read schema/catalog evidence only. Do not rewrite schemas or infer verdict status from maintenance metadata."]
    )
  ),
  resource(
    "mcp-manifest",
    "visual-hive://mcp-manifest",
    "mcp-manifest",
    "MCP Manifest",
    "First-party Visual Hive MCP manifest describing read-only evidence resources, read-only tools, disabled execution tools, and local/no-network policy.",
    ".visual-hive/mcp-manifest.json",
    "application/json",
    readTool(
      "visual_hive_read_mcp_manifest",
      "Read MCP Manifest",
      "Read the latest first-party MCP manifest without starting an MCP server, enabling execution tools, or making external calls.",
      "visual-hive mcp --describe --output .visual-hive/mcp-manifest.json",
      ["Read MCP manifest evidence only. Do not enable execution tools, provider uploads, third-party MCPs, or verdict overrides from the manifest."]
    )
  )
] as const satisfies readonly EvidenceResourceDefinition[];

export type EvidenceResourceId = (typeof VISUAL_HIVE_EVIDENCE_RESOURCES)[number]["id"];

export function getEvidenceResourceById(id: string): EvidenceResourceDefinition | undefined {
  return VISUAL_HIVE_EVIDENCE_RESOURCES.find((resource) => resource.id === id);
}

export function getEvidenceResourceByUri(uri: string): EvidenceResourceDefinition | undefined {
  return VISUAL_HIVE_EVIDENCE_RESOURCES.find((resource) => resource.uri === uri);
}

export function getEvidenceResourceByReadToolName(toolName: string): EvidenceResourceDefinition | undefined {
  return VISUAL_HIVE_EVIDENCE_RESOURCES.find((resource) => resource.readTool?.name === toolName);
}

function resource(
  id: string,
  uri: `visual-hive://${string}`,
  name: string,
  title: string,
  description: string,
  relativePath: string,
  mimeType: EvidenceResourceMimeType = "application/json",
  readTool?: EvidenceResourceReadToolDefinition
): EvidenceResourceDefinition {
  return { id, uri, name, title, description, relativePath, mimeType, readTool };
}

function readTool(
  name: string,
  title: string,
  description: string,
  command: string,
  writeRestrictions?: string[]
): EvidenceResourceReadToolDefinition {
  return { name, title, description, command, writeRestrictions };
}
