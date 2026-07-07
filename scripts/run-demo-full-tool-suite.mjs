#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const demoRoot = path.join(repoRoot, "examples", "demo-react-app");
const demoHive = path.join(demoRoot, ".visual-hive");
const kubestellarRoot = path.join(repoRoot, "examples", "kubestellar-console");
const kubestellarHive = path.join(kubestellarRoot, ".visual-hive");
const summaryJsonPath = path.join(demoHive, "full-demo-summary.json");
const summaryMarkdownPath = path.join(demoHive, "full-demo-summary.md");

const DEFAULT_TIMEOUT_MS = 120_000;
const DEMO_TARGET_URL = "http://127.0.0.1:4173";
const DEMO_TARGET_IDLE_TIMEOUT_MS = 15_000;
const TARGET_OWNING_SCRIPTS = new Set(["demo:run:seed", "demo:run:ci", "demo:mutate", "demo:e2e:defect", "smoke:ui:browser"]);
const NORMAL_PLAN_TARGET_SCRIPTS = new Set(["demo:run:seed", "demo:run:ci", "demo:mutate"]);
const DIRECT_SCRIPT_COMMANDS = new Map([
  [
    "demo:run:seed",
    [
      "scripts/run-with-env.mjs",
      "VISUAL_HIVE_CI=false",
      "--",
      process.execPath,
      "packages/cli/dist/index.js",
      "run",
      "--config",
      "examples/demo-react-app/visual-hive.config.yaml",
      "--plan",
      ".visual-hive/plan.json",
      "--skip-install",
      "--skip-build"
    ]
  ],
  [
    "demo:run:ci",
    [
      "scripts/run-with-env.mjs",
      "VISUAL_HIVE_CI=true",
      "--",
      process.execPath,
      "packages/cli/dist/index.js",
      "run",
      "--config",
      "examples/demo-react-app/visual-hive.config.yaml",
      "--plan",
      ".visual-hive/plan.json",
      "--ci",
      "--skip-install",
      "--skip-build"
    ]
  ],
  ["demo:mutate", ["packages/cli/dist/index.js", "mutate", "--config", "examples/demo-react-app/visual-hive.config.yaml", "--skip-install", "--skip-build"]],
  ["demo:e2e:defect", ["scripts/run-demo-defect.mjs"]],
  ["smoke:ui:browser", ["scripts/smoke-ui-browser.mjs"]]
]);
const TIMEOUTS_BY_SCRIPT = {
  "demo:build": 180_000,
  "demo:run:seed": 180_000,
  "demo:run:ci": 180_000,
  "demo:mutate": 240_000,
  "demo:e2e:defect": 300_000,
  "demo:e2e:mutation": 120_000,
  "demo:e2e:handoff-dry-run": 120_000,
  "demo:kubestellar": 180_000,
  "smoke:ui": 120_000,
  "smoke:ui:browser": 180_000
};

const ARTIFACTS_BY_SECTION = {
  "Setup/repo intelligence": [
    ".visual-hive/repo-map.json",
    ".visual-hive/repo-context.md",
    ".visual-hive/visual-graph.json",
    ".visual-hive/visual-graph-summary.md",
    ".visual-hive/visual-graph-vocab.json",
    ".visual-hive/visual-graph-unresolved.json",
    ".visual-hive/visual-impact.json",
    ".visual-hive/recommendations.json"
  ],
  Planning: [".visual-hive/plan.json", ".visual-hive/plan.canary.json", ".visual-hive/plan.full.json", ".visual-hive/plans.json"],
  "Clean deterministic run": [".visual-hive/report.json", ".visual-hive/baselines.json"],
  "Seeded defect proof": [
    ".visual-hive/report.json",
    ".visual-hive/triage.json",
    ".visual-hive/evidence-packet.json",
    ".visual-hive/handoff.json",
    ".visual-hive/hive-issue.md",
    ".visual-hive/test-creation-plan.json"
  ],
  "Mutation adequacy": [".visual-hive/mutation-report.json"],
  "Coverage/test maintenance": [
    ".visual-hive/coverage.json",
    ".visual-hive/coverage-recommendations.json",
    ".visual-hive/flows.json",
    ".visual-hive/targets.json",
    ".visual-hive/contracts.json",
    ".visual-hive/schedules.json"
  ],
  "Governance/provider/safety": [
    ".visual-hive/workflows.json",
    ".visual-hive/provider-results.json",
    ".visual-hive/provider-setup-plan.json",
    ".visual-hive/provider-handoff.json",
    ".visual-hive/provider-upload/argos/manifest.json",
    ".visual-hive/risk.json",
    ".visual-hive/security.json",
    ".visual-hive/costs.json",
    ".visual-hive/readiness.json",
    ".visual-hive/setup-progress.json",
    ".visual-hive/runbook.json"
  ],
  "Evidence/verdict/triage": [
    ".visual-hive/triage.json",
    ".visual-hive/llm-usage.json",
    ".visual-hive/evidence-packet.json",
    ".visual-hive/testing-layers.json",
    ".visual-hive/verdict.json"
  ],
  "Hive handoff/resource sharing": [
    ".visual-hive/handoff.json",
    ".visual-hive/hive-issue.md",
    ".visual-hive/hive-bead-request.json",
    ".visual-hive/hive-handoff-result.json",
    ".visual-hive/hive-handoff-validation.json",
    ".visual-hive/hive/hive-export.json",
    ".visual-hive/hive/beads.json",
    ".visual-hive/hive/knowledge-facts.json",
    ".visual-hive/hive/knowledge-graph.json",
    ".visual-hive/hive/wiki-index.json",
    ".visual-hive/hive/repair-work-orders.json",
    ".visual-hive/hive/hive-agent-policy.json",
    ".visual-hive/hive/guarded-repair-preview.json",
    ".visual-hive/hive/repair-request-envelope.json",
    ".visual-hive/hive/trusted-repair-consumer-summary.json",
    ".visual-hive/hive/trusted-repair-workflow-dry-run.json",
    ".visual-hive/hive-issue-dry-run.json"
  ],
  "Agent packets/tools/MCP/context": [
    ".visual-hive/test-creation-plan.json",
    ".visual-hive/agent-packet.json",
    ".visual-hive/agent-validation.json",
    ".visual-hive/agents/*/write-preview.json",
    ".visual-hive/handoff-agent-packet.json",
    ".visual-hive/provider-agent-packet.json",
    ".visual-hive/tools/tool-registry.json",
    ".visual-hive/mcp-manifest.json",
    ".visual-hive/context-ledger.json",
    ".visual-hive/schema-catalog.json"
  ],
  "Control Plane/UI": [".visual-hive/control-plane-snapshot.json", ".visual-hive/artifacts-index.json"],
  "KubeStellar planning smoke": [
    "examples/kubestellar-console/.visual-hive/plan.auth.json",
    "examples/kubestellar-console/.visual-hive/plan.cluster.json",
    "examples/kubestellar-console/.visual-hive/plan.docs.json",
    "examples/kubestellar-console/.visual-hive/plan.schedule.json",
    "examples/kubestellar-console/.visual-hive/plans.json",
    "examples/kubestellar-console/.visual-hive/artifacts-index.json"
  ]
};

const sections = [
  section("Setup/repo intelligence", ["demo:build", "demo:doctor", "demo:analyze", "demo:graph:search", "demo:graph:impact", "demo:recommend"], verifySetup),
  section("Planning", ["demo:plan", "demo:plan:canary", "demo:plan:full", "demo:plans"], verifyPlanning),
  section("Clean deterministic run", ["demo:run:seed", "demo:run:ci", "demo:baselines"], verifyCleanRun),
  section("Seeded defect proof", ["demo:e2e:defect"], verifySeededDefect, restoreCleanArtifacts),
  section("Mutation adequacy", ["demo:mutate", "demo:e2e:mutation"], verifyMutation),
  section(
    "Coverage/test maintenance",
    ["demo:coverage", "demo:flows", "demo:improve", "demo:targets", "demo:contracts", "demo:schedules"],
    verifyCoverageMaintenance
  ),
  section(
    "Governance/provider/safety",
    [
      "demo:workflows",
      "demo:providers",
      "demo:provider-plan",
      "demo:provider-handoff",
      "demo:provider-upload",
      "demo:risk",
      "demo:security",
      "demo:costs",
      "demo:readiness",
      "demo:setup-status",
      "demo:runbook"
    ],
    verifyGovernance
  ),
  section("Evidence/verdict/triage", ["demo:triage", "demo:llm", "demo:report", "demo:evidence", "demo:layers", "demo:verdict"], verifyEvidence),
  section(
    "Hive handoff/resource sharing",
    [
      "demo:handoff",
      "demo:hive-export",
      "demo:hive-guarded-preview",
      "demo:hive-repair-envelope",
      "demo:hive-repair-consumer",
      "demo:hive-repair-workflow",
      "demo:handoff-validate",
      "demo:hive-modes",
      "demo:issues",
      "demo:setup-issue-publish",
      "demo:issue-publish",
      "demo:e2e:handoff-dry-run"
    ],
    verifyHiveHandoff
  ),
  section(
    "Agent packets/tools/MCP/context",
    [
      "demo:test-creation",
      "demo:agent-packet",
      "demo:agent-issue-run",
      "demo:agent-validate",
      "demo:agent-write-preview",
      "demo:agent-packet:handoff",
      "demo:agent-packet:provider",
      "demo:tools",
      "demo:mcp",
      "demo:history",
      "demo:context",
      "demo:schemas"
    ],
    verifyAgentTooling
  ),
  section("Control Plane/UI", ["demo:snapshot", "demo:artifacts", "demo:evidence-resources", "smoke:ui", "smoke:ui:browser"], verifyControlPlane),
  section("KubeStellar planning smoke", ["demo:kubestellar"], verifyKubestellar)
];

const metrics = {
  cleanReports: 0,
  seededDefects: 0,
  mutationResults: 0,
  evidencePackets: 0,
  handoffPackets: 0,
  hiveIssueDryRuns: 0,
  agentPackets: 0,
  agentIssueRuns: 0,
  controlPlaneSnapshots: 0,
  artifactIndexes: 0,
  mcpManifests: 0,
  toolRegistries: 0,
  externalCallsMade: 0,
  networkCallsMade: 0,
  sourceMutations: 0,
  repairBranchesOrPrsCreated: 0,
  realGithubIssuesCreated: 0
};

const results = [];
let seededDefectGeneratedAtMs = 0;

console.log("[demo:full-run] starting complete Visual Hive demo tool-suite acceptance run");
await cleanupDemoTargetListeners("suite start");

for (const currentSection of sections) {
  console.log(`\n[demo:full-run] ${currentSection.name}`);
  const sectionStartedAt = Date.now();
  try {
    for (const scriptName of currentSection.scripts) {
      await runScript(scriptName);
    }
    await currentSection.verify();
    if (currentSection.after) {
      await currentSection.after();
    }
    results.push({
      name: currentSection.name,
      status: "pass",
      commandsRun: currentSection.scripts,
      artifactsChecked: currentSection.artifactsChecked,
      durationMs: Date.now() - sectionStartedAt
    });
    console.log(`[demo:full-run] ${currentSection.name}: pass`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({
      name: currentSection.name,
      status: "fail",
      commandsRun: currentSection.scripts,
      artifactsChecked: currentSection.artifactsChecked,
      durationMs: Date.now() - sectionStartedAt,
      message
    });
    console.error(`[demo:full-run] ${currentSection.name}: fail`);
    console.error(message);
    await printFinalSummary("FAIL");
    process.exit(1);
  }
}

await verifyFinalMetrics();
await printFinalSummary("PASS");

function section(name, scripts, verify, after) {
  return { name, scripts, verify, after, artifactsChecked: ARTIFACTS_BY_SECTION[name] ?? [] };
}

async function restoreCleanArtifacts() {
  console.log("[demo:full-run] restoring clean demo artifacts after seeded defect proof");
  for (const scriptName of [
    "demo:plan",
    "demo:run:seed",
    "demo:run:ci",
    "demo:baselines",
    "demo:mutate",
    "demo:coverage",
    "demo:triage",
    "demo:evidence",
    "demo:layers",
    "demo:verdict",
    "demo:handoff",
    "demo:handoff-validate",
    "demo:test-creation",
    "demo:snapshot",
    "demo:artifacts"
  ]) {
    await runScript(scriptName);
  }
  await verifyCleanRun();
  await assertFreshAfterSeededDefect("report.json", "clean report");
  await assertFreshAfterSeededDefect("mutation-report.json", "clean mutation report");
  await assertFreshAfterSeededDefect("coverage.json", "clean coverage report");
  await assertFreshAfterSeededDefect("triage.json", "clean triage report");
  await assertFreshAfterSeededDefect("evidence-packet.json", "clean Evidence Packet");
  await assertFreshAfterSeededDefect("verdict.json", "clean verdict report");
  await assertFreshAfterSeededDefect("handoff.json", "clean handoff packet");
  await assertFreshAfterSeededDefect("hive-handoff-validation.json", "clean handoff validation");
  await assertFreshAfterSeededDefect("test-creation-plan.json", "clean test creation plan");
  await assertFreshAfterSeededDefect("control-plane-snapshot.json", "clean Control Plane snapshot");
  await assertFreshAfterSeededDefect("artifacts-index.json", "clean artifact index");
}

async function verifySetup() {
  const repoMap = await readDemoJson("repo-map.json");
  const repoContext = await readDemoText("repo-context.md");
  const graph = await readDemoJson("visual-graph.json");
  const vocab = await readDemoJson("visual-graph-vocab.json");
  const unresolved = await readDemoJson("visual-graph-unresolved.json");
  const impact = await readDemoJson("visual-impact.json");
  assert(repoMap.outputResource, "repo-map.json must include outputResource metadata.");
  assert(repoMap.visualMap, "repo-map.json must include visualMap.");
  assert(repoMap.visualGraphOutputResources?.graph?.artifactPath === ".visual-hive/visual-graph.json", "repo-map must reference Visual Graph artifact.");
  assert(nonEmptyArray(repoMap.visualMap.nodes), "repo map visualMap must include nodes.");
  assert(nonEmptyArray(repoMap.visualMap.edges), "repo map visualMap must include edges.");
  assert(Array.isArray(repoMap.visualMap.findings), "repo map visualMap must include findings.");
  const relationCount =
    countArray(repoMap.routes) +
    countArray(repoMap.selectors) +
    countArray(repoMap.targetHints) +
    countArray(repoMap.coverageGaps) +
    countArray(repoMap.visualMap.edges);
  assert(relationCount > 0, "repo map must include at least one route, selector, target, contract, screenshot, or coverage-gap relation.");
  assert(
    repoMap.visualMap.findings.some((finding) => finding.firstSeen || finding.lastSeen || "previouslySeen" in finding),
    "repo map findings must include fingerprint lifecycle fields."
  );
  assert(
    repoContext.includes("Visual Hive") && repoContext.toLowerCase().includes("repo context"),
    "repo context must be human-readable Visual Hive repo context."
  );
  assert(graph.schemaVersion === "visual-hive.visual-graph.v1", "visual-graph.json must use schema v1.");
  assert(graph.summary?.nodes > 0 && graph.summary?.edges > 0, "Visual Graph must include nodes and edges.");
  assert(graph.summary?.completeChains >= 1, "Visual Graph must include at least one file/component/route/contract/screenshot/mutation chain.");
  assert(nonEmptyArray(vocab.entries), "Visual Graph vocabulary must include searchable entries.");
  assert(Array.isArray(unresolved.unresolvedReferences), "Visual Graph unresolved artifact must include unresolvedReferences.");
  assert(impact.schemaVersion === "visual-hive.visual-impact.v1", "visual-impact.json must be written by graph impact.");
  assert(impact.summary?.affectedNodeCount > 0, "visual impact must include affected nodes.");
}

async function verifyPlanning() {
  const plan = await readDemoJson("plan.json");
  const canaryPlan = await readDemoJson("plan.canary.json");
  const fullPlan = await readDemoJson("plan.full.json");
  const plans = await readDemoJson("plans.json");
  assert(nonEmptyArray(plan.items), "default plan must select at least one contract.");
  assert(nonEmptyArray(plan.targets), "default plan must select at least one target.");
  assert(canaryPlan.mode === "canary", "plan.canary.json must be a canary lane.");
  assert(fullPlan.mode === "full", "plan.full.json must be a full lane.");
  const lanes = JSON.stringify(plans.lanes ?? plans.summary ?? plans);
  assert(lanes.includes("pr") && lanes.includes("canary") && lanes.includes("full"), "plans summary must include PR, canary, and full lanes.");
}

async function verifyCleanRun() {
  const report = await readDemoJson("report.json");
  assert(report.status === "passed", `clean deterministic report status must be passed, got ${report.status}.`);
  assert(!JSON.stringify(report).includes("seeded-force-login-public-demo"), "clean report must not include seeded defect contract evidence.");
  assert(report.outputResource, "report.json must include outputResource metadata.");
  assert(nonEmptyArray(report.selectedContracts), "report must include selected contracts.");
  assert(nonEmptyArray(report.results), "report must include per-contract results.");
  assert(
    report.results.some((result) => nonEmptyArray(result.selectorAssertions) || nonEmptyArray(result.screenshotAssertions)),
    "report must include selector or screenshot assertion evidence."
  );
  const screenshotCount = report.results.reduce((count, result) => count + countArray(result.screenshotAssertions), 0);
  assert(screenshotCount > 0, "report must include screenshot evidence.");
  await readDemoJson("baselines.json");
  metrics.cleanReports += 1;
}

async function verifySeededDefect() {
  const report = await readDemoJson("report.json");
  const evidence = await readDemoJson("evidence-packet.json");
  const triage = await readDemoJson("triage.json");
  const handoff = await readDemoJson("handoff.json");
  const testCreation = await readDemoJson("test-creation-plan.json");
  const issue = await readDemoText("hive-issue.md");
  const reportText = JSON.stringify(report);
  assert(report.status === "failed", `seeded defect report status must be failed, got ${report.status}.`);
  assert(!reportText.includes("target_startup_failure"), "seeded defect must not fail because of target startup infrastructure.");
  assert(!reportText.includes("environment_failure"), "seeded defect must not fail because of environment infrastructure.");
  assert(reportText.includes("seeded-force-login-public-demo"), "seeded defect report must include seeded-force-login-public-demo.");
  assert(evidence.verdictSummary?.visualHiveVerdict === "failed", "seeded defect Evidence Packet verdict must be failed.");
  assert(nonEmptyArray(triage.findings), "seeded defect triage must include findings.");
  assert(handoff.externalCallsMade === 0, "seeded defect handoff must remain no-network.");
  assert(nonEmptyArray(testCreation.recommendations), "seeded defect must produce test-creation context.");
  assert(issue.includes("Visual Hive") && issue.includes("seeded-force-login-public-demo"), "seeded defect issue body must include Visual Hive context.");
  seededDefectGeneratedAtMs = timestampMs(report.generatedAt);
  metrics.seededDefects += 1;
}

async function verifyMutation() {
  const report = await readDemoJson("mutation-report.json");
  assert(report.schemaVersion === 2, "mutation-report.json schemaVersion must be 2.");
  assert(nonEmptyArray(report.results), "mutation report must include at least one mutation result.");
  let killed = 0;
  let survived = 0;
  let notApplicable = 0;
  let sourceMutations = 0;
  for (const result of report.results) {
    assert(result.operator, "mutation result must include operator.");
    assert(["killed", "survived", "not_applicable", "error"].includes(result.status), `unexpected mutation status ${result.status}.`);
    assert(Array.isArray(result.contractIds), `mutation ${result.operator} must include contractIds.`);
    assert(Array.isArray(result.affected), `mutation ${result.operator} must include affected surfaces.`);
    assert(result.validationCommand, `mutation ${result.operator} must include validationCommand.`);
    assert(["runtime", "fixture"].includes(result.mutationMode), `mutation ${result.operator} must include runtime or fixture mutationMode.`);
    assert(result.sourceMutation === false, `mutation ${result.operator} must not mutate source files.`);
    if (result.status === "killed") killed += 1;
    if (result.status === "survived") survived += 1;
    if (result.status === "not_applicable") notApplicable += 1;
    if (result.sourceMutation) sourceMutations += 1;
  }
  assert(report.killed === killed, "mutation killed count must match killed results.");
  assert(report.total === killed + survived, "mutation total must exclude not_applicable results.");
  if (survived > 0) {
    const issue = await readDemoText("hive-issue.md");
    const testCreation = JSON.stringify(await readDemoJson("test-creation-plan.json"));
    assert(issue.includes("mutation") || testCreation.includes("mutation_survivor"), "survived mutations must appear in issue or test-creation context.");
  }
  metrics.mutationResults += report.results.length;
  metrics.sourceMutations += sourceMutations;
  void notApplicable;
}

async function verifyCoverageMaintenance() {
  const coverage = await readDemoJson("coverage.json");
  const recommendations = await readDemoJson("coverage-recommendations.json");
  assert(coverage.outputResource, "coverage.json must include outputResource metadata.");
  assert(Array.isArray(recommendations.recommendations), "coverage recommendations must include a recommendations array.");
  assert(
    recommendations.recommendations.length > 0 || recommendations.summary?.recommendationCount === 0,
    "coverage recommendations must include recommendations or explicitly report none."
  );
  assert(Array.isArray(recommendations.maintenanceFindings), "coverage recommendations must include maintenanceFindings.");
  const allowedKinds = new Set([
    "screenshot_without_assertion",
    "missing_mobile_viewport",
    "mutation_survivor",
    "stale_baseline",
    "baseline_churn",
    "weak_threshold",
    "duplicate_screenshot",
    "generic_selector"
  ]);
  assert(
    recommendations.maintenanceFindings.some((finding) => allowedKinds.has(finding.kind)),
    "maintenance findings must include at least one required visual-test maintenance kind."
  );
  const serialized = JSON.stringify(recommendations).toLowerCase();
  assert(!serialized.includes("auto_approve") && !serialized.includes("approved baseline automatically"), "full-run must not auto-approve baselines.");
}

async function verifyGovernance() {
  const workflows = await readDemoJson("workflows.json");
  const providers = await readDemoJson("provider-results.json");
  const providerPlan = await readDemoJson("provider-setup-plan.json");
  const providerHandoff = await readDemoJson("provider-handoff.json");
  const providerUpload = await readDemoJson("provider-upload/argos/manifest.json");
  await readDemoJson("risk.json");
  await readDemoJson("security.json");
  await readDemoJson("costs.json");
  await readDemoJson("readiness.json");
  await readDemoJson("setup-progress.json");
  await readDemoJson("runbook.json");
  assert(workflows.outputResource, "workflow audit must include outputResource metadata.");
  assert(workflows.summary?.workflowsUsingPullRequestTarget === 0, "PR workflow must not use pull_request_target.");
  assert(workflows.summary?.pullRequestWorkflows >= 1, "workflow audit must include PR workflows.");
  assert(String(JSON.stringify(workflows)).includes("read-only") || workflows.summary?.trustedIssueWorkflows >= 1, "workflow audit must capture read-only/trusted issue posture.");
  assert(providers.summary?.externalCallsMade === 0 || collectNumericKey(providers, "externalCallsMade") === 0, "provider listing must not make external calls.");
  assert(providerPlan.externalCallsMade === 0, "provider plan must not make external calls.");
  assert(providerHandoff.externalCallsMade === 0, "provider handoff must not make external calls.");
  assert(providerUpload.dryRun === true || providerUpload.externalCallsMade === 0, "provider upload must remain dry-run/mock by default.");
  assertNoSecretValues([workflows, providers, providerPlan, providerHandoff, providerUpload], "governance/provider artifacts");
}

async function verifyEvidence() {
  const triage = await readDemoJson("triage.json");
  const llm = await readDemoJson("llm-usage.json");
  const evidence = await readDemoJson("evidence-packet.json");
  const layers = await readDemoJson("testing-layers.json");
  const verdict = await readDemoJson("verdict.json");
  assert(Array.isArray(triage.findings), "triage.json must include findings.");
  assert(evidence.verdictSummary?.visualHiveVerdict === "passed", "restored clean Evidence Packet verdict must be passed.");
  assert(layers.summary, "testing-layers.json must include summary.");
  assert(verdict.summary?.visualHiveVerdict === "passed", "verdict.json must preserve Visual Hive passed verdict.");
  assert(llm.summary?.callsMade === 0 || collectNumericKey(llm, "callsMade") === 0, "LLM governance artifacts must report callsMade 0.");
  const serialized = JSON.stringify({ evidence, verdict, llm });
  assert(serialized.includes("Visual Hive") || serialized.includes("visual_hive"), "verdict authority must be Visual Hive.");
  metrics.evidencePackets += 1;
}

async function verifyHiveHandoff() {
  const handoff = await readDemoJson("handoff.json");
  const beadRequest = await readDemoJson("hive-bead-request.json");
  const handoffResult = await readDemoJson("hive-handoff-result.json");
  const validation = await readDemoJson("hive-handoff-validation.json");
  const hiveExport = await readDemoJson("hive/hive-export.json");
  await readDemoJson("hive/beads.json");
  await readDemoJson("hive/knowledge-facts.json");
  await readDemoJson("hive/knowledge-graph.json");
  await readDemoJson("hive/wiki-index.json");
  await readDemoJson("hive/repair-work-orders.json");
  await readDemoJson("hive/hive-agent-policy.json");
  const guarded = await readDemoJson("hive/guarded-repair-preview.json");
  const envelope = await readDemoJson("hive/repair-request-envelope.json");
  const consumer = await readDemoJson("hive/trusted-repair-consumer-summary.json");
  const workflow = await readDemoJson("hive/trusted-repair-workflow-dry-run.json");
  const dryRun = await readDemoJson("hive-issue-dry-run.json");
  const issues = await readDemoJson("issues.json");
  const issueQueue = await readDemoJson("issue-queue.json");
  const setupIssueCandidate = await readDemoJson("setup-issue-candidate.json");
  const setupIssuePublishResult = await readDemoJson("setup-issue-publish-result.json");
  const issuePublishResult = await readDemoJson("issue-publish-result.json");
  const issue = await readDemoText("hive-issue.md");

  for (const [name, artifact] of Object.entries({ handoff, beadRequest, handoffResult, validation, hiveExport, guarded, envelope, consumer, workflow, dryRun })) {
    assert(collectNumericKey(artifact, "externalCallsMade") === 0, `${name} must report externalCallsMade 0.`);
  }
  assert(dryRun.networkCallsMade === 0, "issue handoff dry-run must report networkCallsMade 0.");
  assert(dryRun.scenarios?.some((scenario) => scenario.decision === "create" && scenario.wouldCreateOrUpdate), "issue dry-run must simulate create.");
  assert(dryRun.scenarios?.some((scenario) => scenario.decision === "update" && scenario.wouldCreateOrUpdate), "issue dry-run must simulate update.");
  assert(dryRun.scenarios?.some((scenario) => scenario.blocked === true && !scenario.wouldCreateOrUpdate), "issue dry-run must block unsafe artifacts.");
  assert(nonEmptyArray(issues.issues), "issues.json must include issue candidates before issue-agent runs.");
  assert(issueQueue.summary?.total >= 1, "issue-queue.json must include queued issues.");
  assert(setupIssueCandidate.issues?.[0]?.issueKind === "setup_needed", "setup issue publish must create a setup_needed candidate.");
  assert(setupIssuePublishResult.realGithubIssuesCreated === 0, "setup issue publish dry-run must not create real issues.");
  assert(issuePublishResult.realGithubIssuesCreated === 0, "issue publish dry-run must not create real issues.");
  for (const expected of [
    "dedupe",
    "Evidence Packet",
    "repo-map",
    "test-creation-plan",
    "mutation",
    "screenshot",
    "validation",
    "guardrail",
    "baseline",
    "threshold"
  ]) {
    assert(issue.toLowerCase().includes(expected.toLowerCase()), `hive issue body must include ${expected}.`);
  }
  assert(consumer.consumerActions?.wouldCreateBranches === false, "trusted repair consumer must not create branches.");
  assert(consumer.consumerActions?.wouldOpenPullRequests === false, "trusted repair consumer must not open pull requests.");
  assert(workflow.currentActions?.createdBranches === false, "trusted repair workflow dry-run must not create branches.");
  assert(workflow.currentActions?.openedPullRequests === false, "trusted repair workflow dry-run must not open pull requests.");
  assert((workflow.summary?.plannedBranches ?? 0) === 0, "trusted repair workflow dry-run must plan zero branches locally.");
  assert((workflow.summary?.plannedPullRequests ?? 0) === 0, "trusted repair workflow dry-run must plan zero pull requests locally.");
  metrics.handoffPackets += 1;
  metrics.hiveIssueDryRuns += 1;
  metrics.networkCallsMade += dryRun.networkCallsMade ?? 0;
}

async function verifyAgentTooling() {
  const testCreation = await readDemoJson("test-creation-plan.json");
  const agent = await readDemoJson("agent-packet.json");
  const validation = await readDemoJson("agent-validation.json");
  const issueAgentRun = await findLatestAgentIssueRun();
  const writePreview = await findLatestAgentArtifact("write-preview.json");
  const handoffAgent = await readDemoJson("handoff-agent-packet.json");
  const providerAgent = await readDemoJson("provider-agent-packet.json");
  const tools = await readDemoJson("tools/tool-registry.json");
  const mcp = await readDemoJson("mcp-manifest.json");
  const context = await readDemoJson("context-ledger.json");
  const schemas = await readDemoJson("schema-catalog.json");
  assert(nonEmptyArray(testCreation.recommendations), "test-creation-plan.json must include recommendations.");
  for (const packet of [agent, handoffAgent, providerAgent]) {
    assert(packet.budgets?.allowExternalNetwork === false, "agent packet budgets must set allowExternalNetwork false.");
    assert(packet.budgets?.maxExternalCostUsd === 0, "agent packet budgets must set maxExternalCostUsd 0.");
  }
  assert(issueAgentRun.schemaVersion === "visual-hive.agent-issue-run.v1", "Issue agent run must use the expected schema.");
  assert(issueAgentRun.mode === "no_write", "Issue agent run must default to no_write mode.");
  assert(issueAgentRun.budgets?.allowExternalNetwork === false, "Issue agent run must disable external network.");
  assert(issueAgentRun.safety?.sourceMutations === 0, "Issue agent run must not mutate source.");
  assert(issueAgentRun.safety?.branchesCreated === 0, "Issue agent run must not create branches.");
  assert(issueAgentRun.safety?.pullRequestsOpened === 0, "Issue agent run must not open pull requests.");
  assert(issueAgentRun.safety?.realGithubIssuesCreated === 0, "Issue agent run must not create GitHub issues.");
  assert(issueAgentRun.parsedIssue?.validationCommand, "Issue agent run must preserve the issue validation command.");
  assert(validation.schemaVersion === "visual-hive.agent-artifacts-validation.v1", "Agent validation report must use the expected schema.");
  assert(validation.status === "passed", "Agent validation report must pass.");
  assert(validation.summary?.agentRuns >= 1, "Agent validation report must inspect at least one agent run.");
  assert(validation.summary?.forbiddenActionFailures === 0, "Agent validation report must have zero forbidden action failures.");
  assert(writePreview.schemaVersion === "visual-hive.agent-write-preview.v1", "Write-preview proof must use the expected schema.");
  assert(writePreview.mode === "dry_run", "Write-preview must default to dry_run mode.");
  assert(writePreview.status === "planned", "Write-preview default proof must only plan the guarded branch.");
  assert(writePreview.validationCommand, "Write-preview proof must preserve the validation command.");
  assert(writePreview.safety?.branchesCreated === 0, "Write-preview default proof must not create branches.");
  assert(writePreview.safety?.commitsCreated === 0, "Write-preview default proof must not create commits.");
  assert(writePreview.safety?.pullRequestsOpened === 0, "Write-preview default proof must not open pull requests.");
  assert(writePreview.safety?.pushesPerformed === 0, "Write-preview default proof must not push.");
  assert(writePreview.safety?.realGithubIssuesCreated === 0, "Write-preview default proof must not create GitHub issues.");
  assert(writePreview.safety?.externalCallsMade === 0, "Write-preview default proof must not make external calls.");
  assert(nonEmptyArray(tools.tools), "Tool Registry must include tools.");
  assert(nonEmptyArray(mcp.resources) && nonEmptyArray(mcp.tools), "MCP manifest must include resources and read tools.");
  assert(nonEmptyArray(context.toolCalls) || context.sourceArtifacts, "Context Ledger must include tool/evidence context.");
  assert(JSON.stringify(context).includes("evidenceResources"), "Context Ledger must include evidenceResources links.");
  const mcpToolIds = new Set(mcp.tools.map((tool) => tool.name ?? tool.id));
  assert(
    mcp.resources.every((resource) => !resource.readToolName || mcpToolIds.has(resource.readToolName)),
    "MCP resources with read tools must align with the MCP read-tool catalog."
  );
  assert(schemas.summary?.failed === 0 || schemas.failed === 0, "schema verification must pass.");
  metrics.agentPackets += 3;
  metrics.agentIssueRuns += 1;
  metrics.mcpManifests += 1;
  metrics.toolRegistries += 1;
}

async function verifyControlPlane() {
  const snapshot = await readDemoJson("control-plane-snapshot.json");
  const artifacts = await readDemoJson("artifacts-index.json");
  assert(snapshot.report, "Control Plane snapshot must include report.");
  assert(snapshot.mutationReport, "Control Plane snapshot must include mutation report.");
  assert(snapshot.evidencePacket, "Control Plane snapshot must include evidence packet.");
  assert(snapshot.testCreationPlan, "Control Plane snapshot must include test creation plan.");
  assert(snapshot.handoffPacket, "Control Plane snapshot must include handoff packet.");
  assert(snapshot.hiveExport, "Control Plane snapshot must include Hive export.");
  assert(snapshot.runbook, "Control Plane snapshot must include runbook commands.");
  assert(snapshot.guidanceState?.primaryAction || snapshot.overview?.nextActions, "Control Plane snapshot must include next safe action.");
  assert(nonEmptyArray(snapshot.artifacts), "Control Plane snapshot must include artifact links.");
  const snapshotText = JSON.stringify(snapshot).toLowerCase();
  assert(snapshotText.includes("does not repair code"), "Control Plane copy must state Visual Hive does not repair code.");
  assert(snapshotText.includes("does not create branches") || snapshotText.includes("create branches"), "Control Plane copy must discuss branch creation boundary.");
  assert(artifacts.summary?.artifactCount > 0, "artifact index must include artifacts.");
  metrics.controlPlaneSnapshots += 1;
  metrics.artifactIndexes += 1;
}

async function verifyKubestellar() {
  await readJson(path.join(kubestellarHive, "plan.auth.json"));
  await readJson(path.join(kubestellarHive, "plan.cluster.json"));
  await readJson(path.join(kubestellarHive, "plan.docs.json"));
  await readJson(path.join(kubestellarHive, "plan.schedule.json"));
  await readJson(path.join(kubestellarHive, "plans.json"));
  await readJson(path.join(kubestellarHive, "artifacts-index.json"));
}

async function verifyFinalMetrics() {
  metrics.externalCallsMade = await collectExternalCallsFromLatestArtifacts();
  assert(metrics.cleanReports >= 1, "At least 1 clean deterministic report must be generated.");
  assert(metrics.seededDefects >= 1, "At least 1 seeded defect failure must be proven.");
  assert(metrics.mutationResults >= 1, "At least 1 mutation result must exist.");
  assert(metrics.evidencePackets >= 1, "At least 1 Evidence Packet must be generated.");
  assert(metrics.handoffPackets >= 1, "At least 1 Handoff Packet must be generated.");
  assert(metrics.hiveIssueDryRuns >= 1, "At least 1 Hive issue dry-run report must be generated.");
  assert(metrics.agentPackets >= 1, "At least 1 Agent Packet must be generated.");
  assert(metrics.agentIssueRuns >= 1, "At least 1 issue-driven agent run artifact must be generated.");
  assert(metrics.controlPlaneSnapshots >= 1, "At least 1 Control Plane snapshot must be generated.");
  assert(metrics.artifactIndexes >= 1, "At least 1 artifact index must be generated.");
  assert(metrics.mcpManifests >= 1, "At least 1 MCP manifest must be generated.");
  assert(metrics.toolRegistries >= 1, "At least 1 Tool Registry must be generated.");
  assert(metrics.externalCallsMade === 0, `externalCallsMade must equal 0 for default/local demo path, got ${metrics.externalCallsMade}.`);
  assert(metrics.networkCallsMade === 0, `networkCallsMade must equal 0 for issue dry-run, got ${metrics.networkCallsMade}.`);
  assert(metrics.sourceMutations === 0, `sourceMutation must be false for all demo mutation results, got ${metrics.sourceMutations}.`);
  assert(metrics.repairBranchesOrPrsCreated === 0, "Visual Hive must not create repair branches or PRs.");
  assert(metrics.realGithubIssuesCreated === 0, "Visual Hive must not create real GitHub issues locally.");
}

async function collectExternalCallsFromLatestArtifacts() {
  const files = [
    "provider-results.json",
    "provider-setup-plan.json",
    "provider-handoff.json",
    "provider-upload/argos/manifest.json",
    "llm-usage.json",
    "handoff.json",
    "hive-bead-request.json",
    "hive-handoff-result.json",
    "hive-handoff-validation.json",
    "hive/hive-export.json",
    "hive/guarded-repair-preview.json",
    "hive/repair-request-envelope.json",
    "hive/trusted-repair-consumer-summary.json",
    "hive/trusted-repair-workflow-dry-run.json",
    "hive-issue-dry-run.json"
  ];
  let total = 0;
  for (const file of files) {
    const fullPath = path.join(demoHive, file);
    if (existsSync(fullPath)) {
      total += collectNumericKey(await readJson(fullPath), "externalCallsMade");
    }
  }
  return total;
}

async function printFinalSummary(result) {
  const summary = await writeFullDemoSummary(result);
  console.log("\n=== Visual Hive Full Demo Summary ===");
  const byName = new Map(results.map((entry) => [entry.name, entry]));
  for (const name of sections.map((entry) => entry.name)) {
    const entry = byName.get(name);
    console.log(`- ${name}: ${entry?.status ?? "not_run"}`);
    if (entry?.message) {
      console.log(`  ${entry.message}`);
    }
  }
  console.log(`- External calls made by local/default path: ${metrics.externalCallsMade}`);
  console.log(`- Network calls made by issue dry-run: ${metrics.networkCallsMade}`);
  console.log(`- Source mutations in demo path: ${metrics.sourceMutations}`);
  console.log(`- Repair branches/PRs created by Visual Hive: ${metrics.repairBranchesOrPrsCreated}`);
  console.log(`- Real GitHub issues created locally: ${metrics.realGithubIssuesCreated}`);
  console.log(`- Result: ${result}`);
  console.log(`- Summary JSON: ${path.relative(repoRoot, summaryJsonPath).replaceAll("\\", "/")}`);
  console.log(`- Summary Markdown: ${path.relative(repoRoot, summaryMarkdownPath).replaceAll("\\", "/")}`);
  return summary;
}

async function writeFullDemoSummary(finalResult) {
  const summary = {
    schemaVersion: "visual-hive.full-demo-summary.v1",
    generatedAt: new Date().toISOString(),
    project: "demo-react-app",
    headSha: await getGitHeadSha(),
    sections: sections.map((currentSection) => {
      const result = results.find((entry) => entry.name === currentSection.name);
      return {
        name: currentSection.name,
        status: result?.status ?? "fail",
        commandsRun: result?.commandsRun ?? currentSection.scripts,
        artifactsChecked: result?.artifactsChecked ?? currentSection.artifactsChecked,
        durationMs: result?.durationMs ?? 0,
        ...(result?.message ? { failureMessage: result.message } : result ? {} : { failureMessage: "Section did not run." })
      };
    }),
    metrics: { ...metrics },
    finalResult,
    safety: {
      visualHiveDoesNotRepairCode: true,
      visualHiveDoesNotCreateBranches: true,
      visualHiveDoesNotOpenPullRequests: true,
      localRunDoesNotCreateGitHubIssues: true,
      localRunDoesNotCallHiveApi: true,
      localRunDoesNotCallLlm: true,
      localRunDoesNotCallPaidProvider: true
    }
  };
  await mkdir(demoHive, { recursive: true });
  await writeFile(summaryJsonPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  await writeFile(summaryMarkdownPath, renderSummaryMarkdown(summary), "utf8");
  return summary;
}

function renderSummaryMarkdown(summary) {
  const lines = [
    "# Visual Hive Full Demo Summary",
    "",
    `- Project: ${summary.project}`,
    `- Final result: ${summary.finalResult}`,
    `- Generated: ${summary.generatedAt}`,
    `- Head SHA: ${summary.headSha ?? "unknown"}`,
    "",
    "## Sections",
    "",
    "| Section | Status | Commands | Artifacts | Duration |",
    "| --- | --- | ---: | ---: | ---: |",
    ...summary.sections.map(
      (entry) => `| ${entry.name} | ${entry.status} | ${entry.commandsRun.length} | ${entry.artifactsChecked.length} | ${entry.durationMs}ms |`
    ),
    "",
    "## Metrics",
    "",
    ...Object.entries(summary.metrics).map(([key, value]) => `- ${key}: ${value}`),
    "",
    "## Safety",
    "",
    ...Object.entries(summary.safety).map(([key, value]) => `- ${key}: ${value}`)
  ];
  return `${lines.join("\n")}\n`;
}

async function getGitHeadSha() {
  const result = await runCapture({ label: "git-head", executable: "git", args: ["rev-parse", "HEAD"], timeoutMs: 10_000 });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

async function runScript(scriptName) {
  const timeoutMs = TIMEOUTS_BY_SCRIPT[scriptName] ?? DEFAULT_TIMEOUT_MS;
  const step = scriptCommand(scriptName, timeoutMs);
  if (NORMAL_PLAN_TARGET_SCRIPTS.has(scriptName)) {
    await ensureNormalDemoPlan(scriptName);
  }
  if (TARGET_OWNING_SCRIPTS.has(scriptName)) {
    await cleanupDemoTargetListeners(`before ${scriptName}`);
    await waitForDemoTargetIdle(`${scriptName} cannot start`);
  }
  console.log(`[demo:full-run] running ${scriptName} (${Math.round(timeoutMs / 1000)}s timeout)`);
  const result = await runStep(step);
  if (result.status !== 0) {
    throw new Error(`${scriptName} failed with exit code ${result.status}.`);
  }
  if (TARGET_OWNING_SCRIPTS.has(scriptName)) {
    await cleanupDemoTargetListeners(`after ${scriptName}`);
    await waitForDemoTargetIdle(`${scriptName} did not finish cleanly`);
  }
}

async function ensureNormalDemoPlan(scriptName) {
  const planPath = path.join(demoHive, "plan.json");
  if (!(await planContainsSeededDefect(planPath))) return;
  console.log(`[demo:full-run] regenerating normal demo plan before ${scriptName}`);
  const result = await runStep({
    label: "restore-normal-demo-plan",
    executable: process.execPath,
    args: [
      "packages/cli/dist/index.js",
      "plan",
      "--config",
      "examples/demo-react-app/visual-hive.config.yaml",
      "--mode",
      "pr",
      "--changed-files",
      "examples/demo-react-app/changed-files.txt"
    ],
    timeoutMs: DEFAULT_TIMEOUT_MS
  });
  if (result.status !== 0) {
    throw new Error(`Could not regenerate normal demo plan before ${scriptName}; plan command exited ${result.status}.`);
  }
  if (await planContainsSeededDefect(planPath)) {
    throw new Error(`Normal demo plan still contains seeded defect contract before ${scriptName}.`);
  }
}

async function planContainsSeededDefect(planPath) {
  if (!existsSync(planPath)) return false;
  const plan = await readJson(planPath);
  return JSON.stringify(plan).includes("seeded-force-login-public-demo");
}

async function waitForDemoTargetIdle(context) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < DEMO_TARGET_IDLE_TIMEOUT_MS) {
    if (!(await isDemoTargetReachable())) return;
    await sleep(500);
  }
  throw new Error(`${context} because ${DEMO_TARGET_URL} is still reachable after ${DEMO_TARGET_IDLE_TIMEOUT_MS}ms.`);
}

async function cleanupDemoTargetListeners(context) {
  if (process.platform !== "win32") {
    return;
  }
  const parsed = new globalThis.URL(DEMO_TARGET_URL);
  const pids = windowsListenerPidsForPort(parsed.port);
  if (pids.size === 0) {
    return;
  }
  console.log(`[demo:full-run] cleaning ${pids.size} stale demo listener(s) on ${DEMO_TARGET_URL} (${context})`);
  for (const pid of pids) {
    spawnSync("taskkill", ["/pid", pid, "/T", "/F"], { stdio: "ignore", windowsHide: true });
  }
  await waitForDemoTargetIdle(`demo target cleanup for ${context} did not finish`);
}

function windowsListenerPidsForPort(port) {
  const netstat = spawnSync("netstat", ["-ano"], { encoding: "utf8", windowsHide: true });
  const output = `${netstat.stdout ?? ""}\n${netstat.stderr ?? ""}`;
  const pids = new Set();
  for (const line of output.split(/\r?\n/)) {
    if (!line.includes("LISTENING")) continue;
    const columns = line.trim().split(/\s+/);
    const localAddress = columns[1] ?? "";
    const pid = columns[columns.length - 1];
    if (localAddress.endsWith(`:${port}`) && /^\d+$/.test(pid)) {
      pids.add(pid);
    }
  }
  return pids;
}

async function isDemoTargetReachable() {
  const controller = new globalThis.AbortController();
  const timer = setTimeout(() => controller.abort(), 500);
  try {
    await fetch(DEMO_TARGET_URL, { signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function scriptCommand(name, timeoutMs) {
  const directArgs = DIRECT_SCRIPT_COMMANDS.get(name);
  if (directArgs) {
    return { label: name, executable: process.execPath, args: directArgs, timeoutMs };
  }
  if (process.platform === "win32") {
    return { label: name, executable: process.env.ComSpec ?? "cmd.exe", args: ["/d", "/s", "/c", "npm", "run", name], timeoutMs };
  }
  return { label: name, executable: "npm", args: ["run", name], timeoutMs };
}

function runStep(step) {
  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    const child = spawn(step.executable, step.args, {
      cwd: repoRoot,
      stdio: "inherit",
      windowsHide: true,
      detached: process.platform !== "win32"
    });

    const timer = setTimeout(async () => {
      timedOut = true;
      console.error(`[${step.label}] timed out after ${Math.round(step.timeoutMs / 1000)}s; terminating process tree`);
      await killProcessTree(child);
    }, step.timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        console.error(`[${step.label}] failed to start: ${error.message}`);
        resolve({ status: 1 });
      }
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        if (timedOut) {
          resolve({ status: 124 });
          return;
        }
        if (signal) {
          console.error(`[${step.label}] exited after signal ${signal}`);
          resolve({ status: 1 });
          return;
        }
        resolve({ status: code ?? 1 });
      }
    });
  });
}

function runCapture(step) {
  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let stdout = "";
    let stderr = "";
    const child = spawn(step.executable, step.args, {
      cwd: repoRoot,
      windowsHide: true,
      detached: process.platform !== "win32"
    });

    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });

    const timer = setTimeout(async () => {
      timedOut = true;
      await killProcessTree(child);
    }, step.timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        resolve({ status: 1, stdout, stderr: `${stderr}${error.message}` });
      }
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        resolve({ status: timedOut ? 124 : code ?? 1, stdout, stderr });
      }
    });
  });
}

async function killProcessTree(child) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      killer.on("close", resolve);
      killer.on("error", resolve);
    });
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      // Already exited.
    }
  }
}

async function readDemoJson(relativePath) {
  return readJson(path.join(demoHive, relativePath));
}

async function readDemoText(relativePath) {
  return readFile(path.join(demoHive, relativePath), "utf8");
}

async function findLatestAgentIssueRun() {
  return findLatestAgentArtifact("agent-run.json");
}

async function findLatestAgentArtifact(fileName) {
  const agentsDir = path.join(demoHive, "agents");
  const entries = await readdir(agentsDir, { withFileTypes: true });
  const artifactPaths = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(agentsDir, entry.name, fileName))
    .filter((artifactPath) => existsSync(artifactPath));
  assert(artifactPaths.length > 0, `At least one ${fileName} agent artifact must exist.`);
  return readJson(artifactPaths.sort().at(-1));
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function assertFreshAfterSeededDefect(relativePath, label) {
  if (!seededDefectGeneratedAtMs) return;
  const artifact = await readDemoJson(relativePath);
  const generatedAtMs = timestampMs(artifact.generatedAt);
  assert(generatedAtMs > seededDefectGeneratedAtMs, `${label} must be regenerated after seeded defect proof.`);
}

function timestampMs(value) {
  const parsed = Date.parse(String(value ?? ""));
  assert(Number.isFinite(parsed), `Artifact timestamp is missing or invalid: ${value ?? "missing"}.`);
  return parsed;
}

function nonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function countArray(value) {
  return Array.isArray(value) ? value.length : 0;
}

function collectNumericKey(value, key) {
  if (!value || typeof value !== "object") return 0;
  let total = 0;
  if (typeof value[key] === "number") {
    total += value[key];
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      total += collectNumericKey(item, key);
    }
    return total;
  }
  for (const item of Object.values(value)) {
    total += collectNumericKey(item, key);
  }
  return total;
}

function assertNoSecretValues(values, label) {
  const text = JSON.stringify(values);
  const forbidden = [
    /gh[pousr]_[A-Za-z0-9_]+/,
    /Bearer\s+[A-Za-z0-9._-]{8,}/i,
    /ARGOS_TOKEN\s*[:=]\s*[^,\s"'}]+/i,
    /client_secret\s*[:=]\s*[^,\s"'}]+/i,
    /set-cookie\s*[:=]\s*[^,\s"'}]+/i
  ];
  for (const pattern of forbidden) {
    assert(!pattern.test(text), `${label} must not contain secret-like values matching ${pattern}.`);
  }
}
