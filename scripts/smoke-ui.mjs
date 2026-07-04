import { startControlPlaneServer } from "../packages/control-plane/dist/index.js";

const server = await startControlPlaneServer({
  config: "examples/demo-react-app/visual-hive.config.yaml",
  port: 0,
  readOnly: true
});

try {
  const snapshotResponse = await fetch(`${server.url}/api/snapshot`);
  if (!snapshotResponse.ok) {
    throw new Error(`snapshot endpoint returned ${snapshotResponse.status}`);
  }
  const snapshot = await snapshotResponse.json();
  if (snapshot.schemaVersion !== 1) {
    throw new Error(`unexpected snapshot schemaVersion: ${snapshot.schemaVersion}`);
  }
  if (!snapshot.config?.project?.name) {
    throw new Error("snapshot did not include a loaded project config");
  }
  assertEqual(snapshot.config.project.name, "demo-react-app", "snapshot project");
  assertEqual(snapshot.overview?.deterministicStatus, "passed", "overview deterministic status");
  assertEqual(snapshot.report?.status, "passed", "deterministic report status");
  assertArrayIncludes(snapshot.report?.selectedContracts, "dashboard-visual-stability", "selected contracts");
  assertArrayIncludes(snapshot.report?.selectedContracts, "hosted-demo-never-login", "selected contracts");
  if (!snapshot.report?.generatedSpecPath?.endsWith("visual-hive.generated.spec.ts")) {
    throw new Error(`snapshot did not include generated spec path: ${snapshot.report?.generatedSpecPath ?? "missing"}`);
  }
  if ((snapshot.report?.results ?? []).length < 2) {
    throw new Error("snapshot did not include per-contract deterministic results");
  }
  if (!snapshot.planLaneSummary || snapshot.planLaneSummary.planCount < 3) {
    throw new Error("snapshot did not include PR/canary/full plan lane summary evidence");
  }
  if (!snapshot.setupPullRequestPlan || snapshot.setupPullRequestPlan.summary?.externalCallsMade !== 0) {
    throw new Error("snapshot did not include no-network setup PR plan evidence");
  }
  if (!snapshot.mcpManifest || snapshot.mcpManifest.server?.externalCallsMade !== 0) {
    throw new Error("snapshot did not include no-network setup MCP manifest evidence");
  }
  for (const expectedResource of ["setup-recommendations", "setup-pr-plan", "artifacts-index"]) {
    if (!snapshot.mcpManifest.resources?.some((resource) => resource.id === expectedResource)) {
      throw new Error(`snapshot MCP manifest did not include setup resource: ${expectedResource}`);
    }
  }
  const checklistIds = snapshot.guidanceState?.adoptionChecklist?.map((item) => item.id) ?? [];
  for (const expectedChecklistId of ["configure-repo", "plan-pr-safe", "run-deterministic-evidence", "package-agent-handoff", "enable-safe-workflow"]) {
    assertArrayIncludes(checklistIds, expectedChecklistId, "snapshot guidance adoption checklist");
  }
  if (!snapshot.guidanceState.adoptionChecklist.some((item) => item.step === "1. Configure the repo")) {
    throw new Error("snapshot guidance adoption checklist did not include beginner setup copy");
  }
  if (!snapshot.guidanceState.adoptionChecklist.some((item) => item.step === "6. Package agent handoff")) {
    throw new Error("snapshot guidance adoption checklist did not include agent handoff copy");
  }
  const planChecklistItem = snapshot.guidanceState.adoptionChecklist.find((item) => item.id === "plan-pr-safe");
  if (planChecklistItem?.commandId !== "plan-pr" || !planChecklistItem?.command?.includes("visual-hive plan")) {
    throw new Error("snapshot guidance adoption checklist did not expose the PR plan command");
  }
  const handoffChecklistItem = snapshot.guidanceState.adoptionChecklist.find((item) => item.id === "package-agent-handoff");
  if (!handoffChecklistItem?.commandId || typeof handoffChecklistItem.commandRunnable !== "boolean") {
    throw new Error("snapshot guidance adoption checklist did not expose actionable handoff command metadata");
  }
  if (!snapshot.providerHandoff || snapshot.providerHandoff.externalCallsMade !== 0) {
    throw new Error("snapshot did not include no-network provider handoff evidence");
  }
  if (!snapshot.schemaCatalog || snapshot.schemaCatalog.status !== "passed") {
    throw new Error(`snapshot did not include passing schema catalog evidence: ${snapshot.schemaCatalog?.status ?? "missing"}`);
  }
  if (typeof snapshot.schemaCatalog.summary?.schemasChecked !== "number" || typeof snapshot.schemaCatalog.summary?.evidenceResources !== "number") {
    throw new Error("snapshot schema catalog did not include schema and evidence-resource summary counts");
  }
  if (!snapshot.schemaCatalog.checks?.some((check) => String(check.id).startsWith("catalog-enum:"))) {
    throw new Error("snapshot schema catalog did not include evidence-resource catalog verification");
  }
  if (!snapshot.mutationReport || typeof snapshot.mutationReport.score !== "number") {
    throw new Error("snapshot did not include mutation score evidence");
  }
  if (!snapshot.runHistory || snapshot.runHistory.summary?.runCount < 1) {
    throw new Error("snapshot did not include run-history trend evidence");
  }
  if (snapshot.runHistory.trend?.direction === undefined) {
    throw new Error("snapshot run-history evidence did not include trend direction");
  }
  const prAcceptanceProfile = snapshot.runProfiles?.find((profile) => profile.id === "pr-acceptance");
  if (!prAcceptanceProfile?.enabled || !prAcceptanceProfile?.runnable || prAcceptanceProfile.blockedReason) {
    throw new Error("snapshot did not expose pr-acceptance as a runnable local run profile");
  }
  const protectedProfile = snapshot.runProfiles?.find((profile) => profile.id === "protected-schedule-preview");
  if (protectedProfile && (protectedProfile.enabled || protectedProfile.runnable || !protectedProfile.blockedReason)) {
    throw new Error("snapshot did not expose protected-schedule-preview as a blocked run profile with a primary reason");
  }
  assertCatalogArtifact(snapshot, ".visual-hive/history.json", "run-history", "visual-hive://run-history", "visual_hive_read_run_history");
  assertCatalogArtifact(snapshot, ".visual-hive/repo-map.json", "repo-map", "visual-hive://repo-map", "visual_hive_read_repo_map");
  assertCatalogArtifact(snapshot, ".visual-hive/repo-context.md", "repo-context", "visual-hive://repo-context", "visual_hive_read_repo_context");
  assertCatalogArtifact(snapshot, ".visual-hive/evidence-packet.json", "latest-evidence", "visual-hive://latest-evidence", "visual_hive_read_evidence_packet");
  assertCatalogArtifact(snapshot, ".visual-hive/handoff.json", "latest-handoff", "visual-hive://latest-handoff", "visual_hive_generate_handoff_dry_run");
  assertCatalogArtifact(snapshot, ".visual-hive/hive/hive-export.json", "hive-export", "visual-hive://hive-export", "visual_hive_read_hive_export");
  assertCatalogArtifact(snapshot, ".visual-hive/agent-packet.json", "agent-packet", "visual-hive://agent-packet", "visual_hive_read_agent_packet");
  assertCatalogArtifact(snapshot, ".visual-hive/test-creation-plan.json", "test-creation-plan", "visual-hive://test-creation-plan", "visual_hive_read_test_creation_plan");
  assertCatalogArtifact(snapshot, ".visual-hive/readiness.json", "readiness-gate", "visual-hive://readiness-gate", "visual_hive_read_readiness_gate");
  assertCatalogArtifact(snapshot, ".visual-hive/workflows.json", "workflow-audit", "visual-hive://workflow-audit", "visual_hive_read_workflow_audit");
  assertCatalogArtifact(snapshot, ".visual-hive/baselines.json", "baseline-review", "visual-hive://baseline-review", "visual_hive_read_baseline_review");
  assertCatalogArtifact(snapshot, ".visual-hive/triage.json", "triage-report", "visual-hive://triage-report", "visual_hive_read_triage_report");
  assertCatalogArtifact(snapshot, ".visual-hive/issue.md", "issue-body", "visual-hive://issue-body", "visual_hive_read_issue_body");
  assertCatalogArtifact(snapshot, ".visual-hive/pr-comment.md", "pr-comment", "visual-hive://pr-comment", "visual_hive_read_pr_comment");
  assertCatalogArtifact(snapshot, ".visual-hive/triage-prompt.md", "triage-prompt", "visual-hive://triage-prompt", "visual_hive_read_triage_prompt");
  assertCatalogArtifact(snapshot, ".visual-hive/repair-prompt.md", "repair-prompt", "visual-hive://repair-prompt", "visual_hive_generate_repair_prompt");
  assertCatalogArtifact(snapshot, ".visual-hive/missing-tests.md", "missing-tests", "visual-hive://missing-tests", "visual_hive_read_missing_tests");
  assertCatalogArtifact(snapshot, ".visual-hive/provider-results.json", "provider-results", "visual-hive://provider-results", "visual_hive_read_provider_results");
  assertCatalogArtifact(snapshot, ".visual-hive/provider-upload/argos/manifest.json", "provider-upload-argos-manifest", "visual-hive://provider-upload/argos/manifest", "visual_hive_read_provider_upload_manifest");
  assertCatalogArtifact(snapshot, ".visual-hive/provider-agent-packet.json", "provider-agent-packet", "visual-hive://provider-agent-packet", "visual_hive_read_provider_agent_packet");
  assertCatalogArtifact(snapshot, ".visual-hive/context-ledger.json", "context-ledger", "visual-hive://context-ledger", "visual_hive_read_context_ledger");
  const triageToolCall = snapshot.contextLedger?.toolCalls?.find((toolCall) => toolCall.id === "triage");
  if (!triageToolCall?.evidenceResources?.some((resource) => resource.evidenceResourceId === "triage-report")) {
    throw new Error("snapshot Context Ledger did not expose triage-report as linked evidence");
  }
  if (!triageToolCall.evidenceResources.some((resource) => resource.evidenceResourceId === "issue-body")) {
    throw new Error("snapshot Context Ledger did not expose issue-body as linked evidence");
  }
  if (!triageToolCall.evidenceResources.some((resource) => resource.evidenceReadToolName === "visual_hive_read_missing_tests")) {
    throw new Error("snapshot Context Ledger did not expose missing-test read tool evidence");
  }
  if (!snapshot.coverageImprovementReport?.recommendations?.length) {
    throw new Error("snapshot did not include coverage improvement recommendations");
  }
  if (!snapshot.testCreationPlan?.recommendations?.length) {
    throw new Error("snapshot did not include test creation plan recommendations");
  }
  if (!snapshot.evidencePacket?.verdictSummary?.visualHiveVerdict) {
    throw new Error("snapshot did not include Evidence Packet verdict summary");
  }
  if (!snapshot.evidencePacket?.hiveReadiness?.recommendedMode || !snapshot.evidencePacket?.hiveReadiness?.recommendationReason) {
    throw new Error("snapshot did not include Evidence Packet Hive mode recommendation");
  }
  for (const mode of ["advisory", "measured", "repair_request", "guarded_repair", "full"]) {
    if (!snapshot.evidencePacket.hiveReadiness.modeReadiness?.some((entry) => entry.mode === mode)) {
      throw new Error(`snapshot did not include Evidence Packet Hive readiness entry: ${mode}`);
    }
  }
  const packetGuardedRepair = snapshot.evidencePacket.hiveReadiness.modeReadiness.find((entry) => entry.mode === "guarded_repair");
  const packetFullAutomation = snapshot.evidencePacket.hiveReadiness.modeReadiness.find((entry) => entry.mode === "full");
  if (!packetGuardedRepair?.trustedWorkflowRequired || !["blocked", "trusted_only"].includes(packetGuardedRepair.status)) {
    throw new Error("snapshot did not show Evidence Packet guarded repair as trusted or blocked");
  }
  if (!packetFullAutomation?.trustedWorkflowRequired || packetFullAutomation.status !== "blocked") {
    throw new Error("snapshot did not show Evidence Packet full automation as locally blocked");
  }
  if (!snapshot.handoffPacket || snapshot.handoffPacket.externalCallsMade !== 0) {
    throw new Error("snapshot did not include no-network Hive handoff packet evidence");
  }
  if (!snapshot.hiveExport || snapshot.hiveExport.externalCallsMade !== 0 || !snapshot.hiveExport.outputArtifacts?.export) {
    throw new Error("snapshot did not include no-network Hive native export evidence");
  }
  for (const artifactKey of ["beads", "knowledgeFacts", "knowledgeGraph", "issueContext", "repairWorkOrders", "agentPolicy", "wikiVaultDir"]) {
    if (!snapshot.hiveExport.outputArtifacts?.[artifactKey]) {
      throw new Error(`snapshot did not include Hive-native output artifact path: ${artifactKey}`);
    }
  }
  if (!snapshot.hiveExport.summary || typeof snapshot.hiveExport.summary.knowledgeFacts !== "number" || typeof snapshot.hiveExport.summary.graphNodes !== "number") {
    throw new Error("snapshot did not include Hive-native summary counts");
  }
  if (snapshot.hiveExport.agentPolicy?.finalValidation?.passFailOwnedBy !== "visual_hive_verdict_engine") {
    throw new Error("snapshot did not include governed Hive final-validation policy evidence");
  }
  if (!snapshot.hiveGuardedRepairPreview || snapshot.hiveGuardedRepairPreview.externalCallsMade !== 0) {
    throw new Error("snapshot did not include no-network Hive guarded repair preview evidence");
  }
  if (!snapshot.hiveGuardedRepairPreview.outputArtifacts?.preview || !snapshot.hiveGuardedRepairPreview.outputArtifacts?.markdown) {
    throw new Error("snapshot did not include Hive guarded repair preview artifact paths");
  }
  if (snapshot.hiveGuardedRepairPreview.policy?.repairExecution !== "preview_only_no_execution") {
    throw new Error("snapshot did not show guarded repair preview as preview-only");
  }
  if (!snapshot.hiveRepairRequestEnvelope || snapshot.hiveRepairRequestEnvelope.externalCallsMade !== 0) {
    throw new Error("snapshot did not include no-network Hive repair request envelope evidence");
  }
  if (!snapshot.hiveRepairRequestEnvelope.outputArtifacts?.envelope || !snapshot.hiveRepairRequestEnvelope.outputArtifacts?.markdown) {
    throw new Error("snapshot did not include Hive repair request envelope artifact paths");
  }
  if (snapshot.hiveRepairRequestEnvelope.policy?.requestExecution !== "trusted_workflow_request_only") {
    throw new Error("snapshot did not show repair request envelope as trusted-workflow only");
  }
  if (!snapshot.hiveTrustedRepairConsumerSummary || snapshot.hiveTrustedRepairConsumerSummary.externalCallsMade !== 0) {
    throw new Error("snapshot did not include no-network Hive trusted repair consumer summary evidence");
  }
  if (!snapshot.hiveTrustedRepairConsumerSummary.outputArtifacts?.summary || !snapshot.hiveTrustedRepairConsumerSummary.outputArtifacts?.markdown) {
    throw new Error("snapshot did not include Hive trusted repair consumer summary artifact paths");
  }
  if (snapshot.hiveTrustedRepairConsumerSummary.policy?.consumerExecution !== "dry_run_summary_only") {
    throw new Error("snapshot did not show trusted repair consumer summary as dry-run only");
  }
  if (
    snapshot.hiveTrustedRepairConsumerSummary.policy?.branchCreation !== false ||
    snapshot.hiveTrustedRepairConsumerSummary.policy?.pullRequestCreation !== false ||
    snapshot.hiveTrustedRepairConsumerSummary.policy?.issueCreation !== false ||
    snapshot.hiveTrustedRepairConsumerSummary.policy?.hiveNetworkCalls !== false
  ) {
    throw new Error("snapshot trusted repair consumer summary allowed a write or Hive network action");
  }
  if (!snapshot.hiveTrustedRepairWorkflowDryRun || snapshot.hiveTrustedRepairWorkflowDryRun.externalCallsMade !== 0) {
    throw new Error("snapshot did not include no-network Hive trusted repair workflow dry-run evidence");
  }
  if (!snapshot.hiveTrustedRepairWorkflowDryRun.outputArtifacts?.dryRun || !snapshot.hiveTrustedRepairWorkflowDryRun.outputArtifacts?.markdown) {
    throw new Error("snapshot did not include Hive trusted repair workflow dry-run artifact paths");
  }
  if (snapshot.hiveTrustedRepairWorkflowDryRun.policy?.workflowExecution !== "dry_run_only") {
    throw new Error("snapshot did not show trusted repair workflow dry-run as dry-run only");
  }
  if (
    snapshot.hiveTrustedRepairWorkflowDryRun.policy?.checkoutCode !== false ||
    snapshot.hiveTrustedRepairWorkflowDryRun.policy?.branchCreation !== false ||
    snapshot.hiveTrustedRepairWorkflowDryRun.policy?.pullRequestCreation !== false ||
    snapshot.hiveTrustedRepairWorkflowDryRun.policy?.issueCreation !== false ||
    snapshot.hiveTrustedRepairWorkflowDryRun.policy?.hiveNetworkCalls !== false ||
    snapshot.hiveTrustedRepairWorkflowDryRun.policy?.providerCalls !== false ||
    snapshot.hiveTrustedRepairWorkflowDryRun.policy?.visualHiveRerun !== false
  ) {
    throw new Error("snapshot trusted repair workflow dry-run allowed checkout, write, external, or rerun action");
  }
  if (!snapshot.hiveModeComparison || snapshot.hiveModeComparison.externalCallsMade !== 0) {
    throw new Error("snapshot did not include no-network Hive export mode comparison evidence");
  }
  if (!snapshot.hiveModeComparison.outputArtifacts?.comparison || !snapshot.hiveModeComparison.outputArtifacts?.markdown) {
    throw new Error("snapshot did not include Hive mode comparison artifact paths");
  }
  for (const mode of ["advisory", "measured", "repair_request", "guarded_repair", "full"]) {
    if (!snapshot.hiveModeComparison.modes?.some((entry) => entry.mode === mode)) {
      throw new Error(`snapshot did not include Hive mode comparison entry: ${mode}`);
    }
  }
  const guardedRepair = snapshot.hiveModeComparison.modes.find((entry) => entry.mode === "guarded_repair");
  const fullAutomation = snapshot.hiveModeComparison.modes.find((entry) => entry.mode === "full");
  if (guardedRepair?.status !== "blocked" || guardedRepair?.policy?.trustedWorkflowRequired !== true) {
    throw new Error("snapshot did not show guarded repair as a trusted blocked policy state");
  }
  if (fullAutomation?.status !== "blocked" || fullAutomation?.policy?.trustedWorkflowRequired !== true) {
    throw new Error("snapshot did not show full Hive automation as a trusted blocked policy state");
  }
  if (!snapshot.hiveModeComparison.recommendation?.mode) {
    throw new Error("snapshot did not include a Hive mode recommendation");
  }
  if (!snapshot.agentPacket?.budgets || snapshot.agentPacket.budgets.allowExternalNetwork !== false) {
    throw new Error("snapshot did not include bounded Agent Packet evidence");
  }
  if (snapshot.handoffAgentPacket?.profile !== "handoff_agent") {
    throw new Error("snapshot did not include handoff-agent Agent Packet evidence");
  }
  if (snapshot.handoffAgentPacket.budgets?.allowExternalNetwork !== false || snapshot.handoffAgentPacket.budgets?.maxExternalCostUsd !== 0) {
    throw new Error("handoff-agent Agent Packet must block external network and external cost by default");
  }
  if (snapshot.providerAgentPacket?.profile !== "provider_specialist") {
    throw new Error("snapshot did not include provider-specialist Agent Packet evidence");
  }
  if (snapshot.providerAgentPacket.budgets?.allowExternalNetwork !== false || snapshot.providerAgentPacket.budgets?.maxExternalCostUsd !== 0) {
    throw new Error("provider-specialist Agent Packet must block external network and external cost by default");
  }
  assertArrayIncludes(
    snapshot.runbook?.commands?.map((command) => command.id),
    "test-creation-plan",
    "runbook command ids"
  );
  assertArrayIncludes(
    snapshot.runbook?.commands?.map((command) => command.id),
    "agent-packet",
    "runbook command ids"
  );
  assertArrayIncludes(
    snapshot.runbook?.commands?.map((command) => command.id),
    "handoff-agent-packet",
    "runbook command ids"
  );
  assertArrayIncludes(
    snapshot.runbook?.commands?.map((command) => command.id),
    "provider-agent-packet",
    "runbook command ids"
  );
  assertArrayIncludes(
    snapshot.runbook?.commands?.map((command) => command.id),
    "hive-export",
    "runbook command ids"
  );
  for (const commandId of ["hive-export-advisory", "hive-export-measured", "hive-export-repair-request"]) {
    assertArrayIncludes(snapshot.runbook?.commands?.map((command) => command.id), commandId, "Hive export mode runbook command ids");
  }
  assertArrayIncludes(
    snapshot.runbook?.commands?.map((command) => command.id),
    "hive-guarded-repair-preview",
    "runbook command ids"
  );
  assertArrayIncludes(
    snapshot.runbook?.commands?.map((command) => command.id),
    "hive-trusted-repair-consumer-summary",
    "runbook command ids"
  );
  assertArrayIncludes(
    snapshot.runbook?.commands?.map((command) => command.id),
    "hive-trusted-repair-workflow-dry-run",
    "runbook command ids"
  );
  assertArrayIncludes(
    snapshot.runbook?.commands?.map((command) => command.id),
    "hive-compare-modes",
    "runbook command ids"
  );
  assertArrayIncludes(
    snapshot.runbook?.commands?.map((command) => command.id),
    "schemas-verify",
    "runbook command ids"
  );
  assertArrayIncludes(
    snapshot.runProfiles?.map((profile) => profile.id),
    "schema-catalog-health",
    "run profile ids"
  );
  assertCatalogArtifact(snapshot, ".visual-hive/schema-catalog.json", "schema-catalog", "visual-hive://schema-catalog", "visual_hive_read_schema_catalog");
  assertCatalogArtifact(snapshot, ".visual-hive/mcp-manifest.json", "mcp-manifest", "visual-hive://mcp-manifest", "visual_hive_read_mcp_manifest");
  assertArrayIncludes(
    snapshot.runbook?.commands?.map((command) => command.id),
    "control-plane",
    "runbook command ids"
  );
  assertArrayIncludes(
    snapshot.runbook?.commands?.map((command) => command.id),
    "plan-canary",
    "runbook command ids"
  );
  assertArrayIncludes(
    snapshot.runbook?.commands?.map((command) => command.id),
    "plan-full-safe",
    "runbook command ids"
  );
  assertArrayIncludes(
    snapshot.runProfiles?.map((profile) => profile.id),
    "pr-acceptance",
    "run profile ids"
  );
  assertArrayIncludes(
    snapshot.runProfiles?.map((profile) => profile.id),
    "canary-health",
    "run profile ids"
  );
  assertArrayIncludes(
    snapshot.artifacts?.map((artifact) => artifact.path),
    ".visual-hive/report.json",
    "artifact paths"
  );

  const pageResponse = await fetch(server.url);
  if (!pageResponse.ok) {
    throw new Error(`ui page returned ${pageResponse.status}`);
  }
  const page = await pageResponse.text();
  for (const expected of ["Visual Hive Control Plane", 'id="root"']) {
    if (!page.includes(expected)) {
      throw new Error(`ui page did not include expected text: ${expected}`);
    }
  }
  const assetPaths = Array.from(page.matchAll(/(?:src|href)="([^"]*\/assets\/[^"]+)"/g)).map((match) => match[1]);
  const jsAsset = assetPaths.find((asset) => asset.endsWith(".js"));
  const cssAsset = assetPaths.find((asset) => asset.endsWith(".css"));
  if (!jsAsset || !cssAsset) {
    throw new Error(`ui page did not reference built Vite assets: ${assetPaths.join(", ") || "none"}`);
  }
  const appJs = await fetchText(`${server.url}${jsAsset}`, "app.js");
  for (const expected of [
    "Visual Hive",
    "Control Plane",
    "Quality cockpit",
    "Setup/adoption checklist",
    "From first run to trusted automation",
    "What should I do next?",
    "Visual Hive verdict",
    "Why Visual Hive reached this verdict",
    "Blocked evidence",
    "Run PR-safe checks",
    "Review visual changes",
    "Evidence to agent handoff",
    "Visual Hive owns the verdict and does not repair code",
    "Hive consumes issues and evidence resources",
    "Automation ladder",
    "Full automation remains blocked locally",
    "Hive readiness next step",
    "Run recommended preview",
    "Trusted workflow required",
    "Hive export mode policy",
    "Evidence Packet readiness",
    "Pre-export recommendation",
    "Comparison artifact",
    "Recommended mode",
    "Measured",
    "Repair request",
    "Guarded repair",
    "Guarded repair preview",
    "Can request repair",
    "Repair request envelope",
    "Trusted repair ready",
    "Trusted repair consumer",
    "Repair consumer summary",
    "Hive-native bundle",
    "Hive work queue",
    "Knowledge graph preview",
    "Repair guardrails",
    "Trusted repair readiness",
    "Safety boundary",
    "Evidence chain",
    "Review trusted workflow dry run",
    "Wiki vault facts",
    "Refresh handoff packet",
    "Visual Hive owns the verdict",
    "Trusted workflow dry run",
    "Can run trusted workflow",
    "Test creation plan",
    "Advisory no-write",
    "Expert console",
    "Failure Inbox",
    "Baselines",
    "Providers",
    "Provider policy guardrails",
    "Provider output is advisory by default",
    "Default oracle",
    "Review before upload",
    "Provider specialist",
    "Run history trends",
    "History helps explain patterns",
    "Schema/catalog health",
    "Open schema catalog artifact",
    "Verify schema/catalog drift",
    "Linked evidence resources",
    "Setup evidence for agents",
    "Setup MCP resources",
    "Read tool",
    "Connections"
  ]) {
    if (!appJs.includes(expected)) {
      throw new Error(`client bundle did not include expected Control Plane view: ${expected}`);
    }
  }
  const css = await fetchText(`${server.url}${cssAsset}`, "styles.css");
  if (!css.includes("--vh-amber") || !css.includes(".app-shell")) {
    throw new Error("Control Plane stylesheet did not include expected layout classes");
  }
  console.log(`Visual Hive UI smoke passed at ${server.url}`);
} finally {
  await server.close();
}

async function fetchText(url, label) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${label} endpoint returned ${response.status}`);
  }
  return response.text();
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`unexpected ${label}: expected ${expected}, got ${actual ?? "missing"}`);
  }
}

function assertArrayIncludes(values, expected, label) {
  if (!Array.isArray(values) || !values.includes(expected)) {
    throw new Error(`${label} did not include ${expected}`);
  }
}

function assertCatalogArtifact(snapshot, artifactPath, resourceId, resourceUri, readToolName) {
  const artifact = snapshot.artifacts?.find((candidate) => candidate.path === artifactPath || candidate.path.endsWith(`/${artifactPath}`));
  if (!artifact) {
    throw new Error(`artifact paths did not include ${artifactPath}`);
  }
  if (
    artifact.evidenceResourceId !== resourceId ||
    artifact.evidenceResourceUri !== resourceUri ||
    artifact.evidenceReadToolName !== readToolName
  ) {
    throw new Error(`${artifactPath} did not include catalog-backed evidence-resource metadata`);
  }
}
