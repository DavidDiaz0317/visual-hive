export const controlPlaneHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Visual Hive Control Plane</title>
  <link rel="stylesheet" href="/assets/styles.css" />
</head>
<body>
  <header class="topbar">
    <div>
      <h1>Visual Hive Control Plane</h1>
      <p id="repo-path"></p>
    </div>
    <div id="status-pill" class="pill">Loading</div>
  </header>
  <nav id="tabs" class="tabs"></nav>
  <main id="app" class="content">Loading Visual Hive artifacts...</main>
  <script type="module" src="/assets/app.js"></script>
</body>
</html>`;

export const controlPlaneCss = `
:root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #101418; color: #e8edf2; }
body { margin: 0; background: #101418; }
.topbar { display: flex; justify-content: space-between; align-items: center; padding: 20px 28px; border-bottom: 1px solid #28313a; background: #151b21; position: sticky; top: 0; z-index: 2; }
h1 { margin: 0; font-size: 22px; letter-spacing: 0; }
h2 { margin: 0 0 12px; font-size: 18px; }
h3 { margin: 0 0 8px; font-size: 15px; color: #b9c6d3; }
p { color: #aebcca; margin: 4px 0 0; }
.pill { border: 1px solid #3b4652; border-radius: 999px; padding: 7px 12px; background: #202831; color: #d8e6f3; font-weight: 600; }
.pill.passed { border-color: #2c6f54; color: #8ee1bd; }
.pill.failed { border-color: #8b3a3a; color: #ffaaa5; }
.tabs { display: flex; gap: 4px; padding: 10px 20px; border-bottom: 1px solid #28313a; background: #121820; overflow-x: auto; }
.tab { border: 0; border-radius: 6px; padding: 9px 11px; color: #b7c4d1; background: transparent; cursor: pointer; white-space: nowrap; font-size: 13px; }
.tab.active, .tab:hover { background: #26313c; color: #fff; }
.content { padding: 24px; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; }
.card { border: 1px solid #28313a; border-radius: 8px; background: #171e25; padding: 16px; min-width: 0; }
.metric { font-size: 30px; font-weight: 750; margin-top: 8px; }
.muted { color: #98a8b8; }
.ok { color: #8ee1bd; }
.bad { color: #ffaaa5; }
.warn { color: #ffd27d; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; background: #0c1014; border: 1px solid #28313a; border-radius: 8px; padding: 12px; color: #dce7f2; }
textarea.editor { width: 100%; min-height: 420px; box-sizing: border-box; resize: vertical; border: 1px solid #303b46; border-radius: 8px; background: #0c1014; color: #dce7f2; padding: 12px; font: 13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
input.text-input { width: 100%; box-sizing: border-box; border: 1px solid #303b46; border-radius: 6px; background: #0c1014; color: #dce7f2; padding: 9px 10px; font: 13px ui-sans-serif, system-ui, sans-serif; }
select.filter-select { width: 100%; box-sizing: border-box; border: 1px solid #303b46; border-radius: 6px; background: #0c1014; color: #dce7f2; padding: 9px 10px; font: 13px ui-sans-serif, system-ui, sans-serif; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; border-bottom: 1px solid #28313a; padding: 9px; vertical-align: top; }
th { color: #b9c6d3; font-size: 12px; text-transform: uppercase; }
a { color: #8bc7ff; }
.image-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; margin-top: 10px; }
.image-row img { width: 100%; border: 1px solid #303b46; border-radius: 6px; background: #0c1014; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
.actions.compact { margin-top: 0; gap: 6px; }
.button { border: 1px solid #3f5368; border-radius: 6px; padding: 8px 10px; background: #22303c; color: #f0f6fc; cursor: pointer; font-weight: 650; }
.link-button { padding: 5px 8px; font-size: 12px; }
.button:hover { background: #2c3b49; }
.button:disabled { cursor: not-allowed; opacity: 0.55; }
.focus-hit { outline: 2px solid #8bc7ff; outline-offset: 3px; border-radius: 5px; background: rgba(139, 199, 255, 0.12); }
.status-ready { color: #8ee1bd; font-weight: 700; }
.status-review { color: #ffd27d; font-weight: 700; }
.status-blocked { color: #ffaaa5; font-weight: 700; }
.section { display: grid; gap: 14px; }
.empty { border: 1px dashed #3b4652; border-radius: 8px; padding: 18px; color: #98a8b8; }
`;

export const controlPlaneJs = `
const tabs = [
  ["overview", "Overview"],
  ["portfolio", "Portfolio"],
  ["runbook", "Runbook"],
  ["actions", "Actions"],
  ["risk", "Risk"],
  ["setup", "Setup"],
  ["runs", "Runs / Reports"],
  ["failures", "Failure Inbox"],
  ["baselines", "Baselines"],
  ["mutation", "Mutation"],
  ["coverage", "Coverage"],
  ["config", "Config"],
  ["targets", "Targets"],
  ["contracts", "Contracts"],
  ["schedule", "Schedule"],
  ["llm", "LLM"],
  ["providers", "Providers"],
  ["github", "GitHub / CI"],
  ["connections", "Connections"],
  ["artifacts", "Raw Artifacts"]
];
let snapshot;
let active = "overview";
let activeConnectionId = new URLSearchParams(window.location.search).get("connection") || "current";
let contractFilters = { contract: "all", target: "all", severity: "all", prSafe: "all", status: "all", route: "all", viewport: "all" };
let focusKind = "";
let focusValue = "";

const app = document.querySelector("#app");
const tabRoot = document.querySelector("#tabs");

function apiUrl(path) {
  if (!activeConnectionId || activeConnectionId === "current") return path;
  return path + (path.includes("?") ? "&" : "?") + "connection=" + encodeURIComponent(activeConnectionId);
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[ch]));
}

function link(path, label = path) {
  if (!path) return "";
  return '<a href="' + apiUrl("/api/file?path=" + encodeURIComponent(path)) + '" target="_blank" rel="noreferrer">' + esc(label) + '</a>';
}

function image(path, label) {
  if (!path) return '<div class="empty">No ' + esc(label) + '</div>';
  return '<figure><img src="' + apiUrl("/api/image?path=" + encodeURIComponent(path)) + '" alt="' + esc(label) + '" /><figcaption class="muted">' + esc(label) + '</figcaption></figure>';
}

function renderTabs() {
  tabRoot.innerHTML = tabs.map(([id, label]) => '<button class="tab ' + (id === active ? "active" : "") + '" data-tab="' + id + '">' + esc(label) + '</button>').join("");
  tabRoot.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => {
    active = button.dataset.tab;
    render();
  }));
}

function render() {
  renderTabs();
  document.querySelector("#repo-path").textContent = snapshot.repoRoot;
  const pill = document.querySelector("#status-pill");
  pill.textContent = snapshot.overview.deterministicStatus + " / " + snapshot.overview.healthGrade;
  pill.className = "pill " + snapshot.overview.deterministicStatus;
  activeConnectionId = snapshot.activeConnectionId || activeConnectionId || "current";
  const views = { overview, portfolio, runbook, actions, risk, setup, runs, failures, baselines, mutation, coverage, config, targets, contracts, schedule, llm, providers, github, connections, artifacts };
  app.innerHTML = views[active]();
  wireActions();
  scrollToFocusedElement();
}

function overview() {
  const o = snapshot.overview;
  return '<div class="grid">' +
    metric("Health score", o.healthScore + "/100", o.healthGrade) +
    metric("Deterministic", o.deterministicStatus, o.deterministicStatus) +
    metric("Mutation", o.mutationScore == null ? "not run" : Math.round(o.mutationScore * 100) + "%", "") +
    metric("Failed contracts", o.failedContracts, o.failedContracts ? "bad" : "ok") +
    metric("Baselines created", o.createdBaselines, o.createdBaselines ? "warn" : "ok") +
    metric("Visual diffs", o.visualDiffs, o.visualDiffs ? "bad" : "ok") +
    '</div><div class="grid" style="margin-top:14px">' +
    card("Next actions", list(o.nextActions)) +
    card("Why this score?", list(o.explanations)) +
    card("Artifacts", "Issue body: " + yes(snapshot.issueMarkdown) + "<br>PR comment: " + yes(snapshot.prCommentMarkdown) + "<br>Triage prompt: " + yes(snapshot.triagePrompt) + "<br>Repair prompt: " + yes(snapshot.repairPrompt) + "<br>Missing tests: " + yes(snapshot.missingTestsMarkdown) + "<br>Baseline review: " + yes(snapshot.baselineReviewMarkdown)) +
    '</div>';
}

function portfolio() {
  const index = snapshot.connections;
  if (!index?.portfolio) return empty("No connected repository portfolio found.");
  const queues = index.portfolio.queues || [];
  const activeQueues = queues.filter(queue => queue.count > 0 && queue.id !== "healthy");
  const healthy = queues.find(queue => queue.id === "healthy");
  return '<div class="grid">' +
    metric("Connected repos", index.summary.connectionCount, "") +
    metric("Attention queues", activeQueues.length, activeQueues.length ? "warn" : "ok") +
    metric("Top attention", index.portfolio.topAttention.length, index.portfolio.topAttention.length ? "warn" : "ok") +
    metric("Healthy", healthy?.count || 0, healthy?.count ? "ok" : "warn") +
    '</div><div class="section" style="margin-top:14px">' +
    card("Portfolio attention queue", index.portfolio.topAttention.length ? table(["Repository", "Score", "Evidence", "Switch"], index.portfolio.topAttention.map(portfolioItemRow)) : '<p class="ok">No connected repositories need attention.</p>') +
    card("Queues", table(["Queue", "Count", "Severity", "Next action", "Repositories"], queues.map(queue => [
      '<b>' + esc(queue.label) + '</b><p class="muted">' + esc(queue.description) + '</p>',
      esc(queue.count),
      portfolioSeverity(queue.severity),
      esc(queue.nextAction),
      queue.connections.length ? queue.connections.map(item => '<span class="' + (item.health === "blocked" ? "bad" : item.health === "attention" ? "warn" : "ok") + '">' + esc(item.label) + '</span> <span class="muted">(' + esc(item.score) + ')</span>').join("<br>") : '<span class="muted">none</span>'
    ]))) +
    card("How to use this", list([
      "Fix broken setup first; those repos cannot produce trustworthy Visual Hive evidence.",
      "Treat deterministic failures as the highest pass/fail queue.",
      "Use stale, missing coverage, weak mutation, and high-risk queues to decide where deeper scheduled validation or new contracts are needed.",
      "Switching repos only uses IDs from the local connection store; no arbitrary browser-supplied paths are accepted."
    ])) +
    '</div>';
}

function portfolioItemRow(item) {
  return [
    '<b>' + esc(item.label) + '</b><p class="muted">' + esc(item.projectName || item.id) + '</p><p class="muted">' + esc(item.health) + " / " + esc(item.status) + '</p>',
    esc(item.score),
    list(item.reasons || []),
    portfolioSwitchAction(item)
  ];
}

function portfolioSeverity(severity) {
  if (severity === "critical") return '<span class="bad">critical</span>';
  if (severity === "warning") return '<span class="warn">warning</span>';
  return '<span class="ok">ok</span>';
}

function portfolioSwitchAction(item) {
  if (item.status !== "ready") return '<span class="muted">Not ready</span>';
  if ((snapshot.activeConnectionId || "current") === item.id) return '<span class="ok">Active</span>';
  return '<button class="button connection-switch" data-connection="' + escAttr(item.id) + '">Switch</button>';
}

function runbook() {
  const rb = snapshot.runbook;
  if (!rb || !rb.commands?.length) return empty("No runbook could be generated. Load a valid Visual Hive config first.");
  const commandsByLane = {};
  rb.commands.forEach(command => {
    commandsByLane[command.lane] ||= [];
    commandsByLane[command.lane].push(command);
  });
  const laneOrder = ["local", "pull_request", "ci", "schedule", "protected", "triage", "ui"];
  const laneCards = laneOrder
    .filter(lane => commandsByLane[lane]?.length)
    .map(lane => card(laneLabel(lane), table(["Command", "Safety", "Secrets", "Artifacts", "Actions"], commandsByLane[lane].map(command => [
      '<b>' + esc(command.label) + '</b><p class="muted">' + esc(command.description) + '</p><pre>' + esc(command.command) + '</pre><p class="muted">cwd: ' + esc(command.cwd) + '</p>',
      safetyBadge(command.safety),
      command.requiredSecrets?.length ? esc(command.requiredSecrets.join(", ")) : '<span class="ok">none</span>',
      command.expectedArtifacts?.length ? command.expectedArtifacts.map(path => '<code>' + esc(path) + '</code>').join("<br>") : '<span class="muted">none</span>',
      runbookActions(command)
    ]))));
  return '<div class="section">' +
    card("Runbook", '<p>Generated from <code>' + esc(rb.configPath) + '</code>. The Control Plane can execute allowlisted local commands in write mode; trusted and secret-bearing lanes remain guidance-only.</p>' + list(rb.notes || [])) +
    laneCards.join("") +
    '</div>';
}

function actions() {
  const history = snapshot.actionHistory;
  if (!history || !history.actions?.length) {
    return '<div class="section">' +
      empty("No Control Plane action history yet. Run an allowlisted command from the Runbook in write mode to create .visual-hive/control-plane-actions.json.") +
      card("Safety model", list([
        "Actions are executed by command ID, not arbitrary browser-supplied shell text.",
        "Read-only mode blocks execution.",
        "Trusted and secret-bearing lanes remain guidance-only.",
        "stdout and stderr are sanitized before they are written or displayed."
      ])) +
      '</div>';
  }
  const summary = history.summary || {};
  const ordered = [...history.actions].reverse();
  return '<div class="section">' +
    '<div class="grid">' +
    metric("Actions", summary.total ?? ordered.length, "") +
    metric("Passed", summary.passed ?? 0, (summary.passed ?? 0) ? "ok" : "") +
    metric("Failed", summary.failed ?? 0, (summary.failed ?? 0) ? "bad" : "ok") +
    metric("Blocked", summary.blocked ?? 0, (summary.blocked ?? 0) ? "warn" : "ok") +
    '</div>' +
    card("Latest action", '<p><b>Command:</b> ' + esc(summary.latestCommandId || ordered[0]?.commandId || "n/a") + '</p><p><b>Status:</b> ' + actionStatus(summary.latestStatus || ordered[0]?.status) + '</p><p><b>Completed:</b> ' + esc(summary.latestCompletedAt || ordered[0]?.completedAt || "n/a") + '</p>') +
    card("Action history", table(["Command", "Status", "When", "Duration", "Steps", "Output"], ordered.map(action => [
      '<b>' + esc(action.label || action.commandId) + '</b><p class="muted">' + esc(action.commandId) + '</p><p class="muted">cwd: ' + esc(action.cwd || "n/a") + '</p>',
      actionStatus(action.status) + '<p class="muted">' + esc(action.message || "") + '</p>' + safetyBadge(action.safety),
      esc(action.completedAt || action.startedAt || "n/a"),
      esc(action.durationMs ?? 0) + "ms",
      actionSteps(action),
      actionOutput(action)
    ]))) +
    '</div>';
}

function actionStatus(status) {
  if (status === "passed") return '<span class="ok">passed</span>';
  if (status === "failed") return '<span class="bad">failed</span>';
  if (status === "blocked") return '<span class="warn">blocked</span>';
  return '<span class="muted">unknown</span>';
}

function actionSteps(action) {
  if (!action.steps?.length) return '<span class="muted">none</span>';
  return action.steps.map(step => '<p><b>' + esc(step.stepId) + '</b> exit=' + esc(step.exitCode) + ' duration=' + esc(step.durationMs) + 'ms</p><pre>' + esc([step.command, ...(step.args || [])].join(" ")) + '</pre>').join("");
}

function actionOutput(action) {
  if (!action.steps?.length) return '<span class="muted">no process output</span>';
  return action.steps.map(step => {
    const stdout = step.stdout ? '<h3>stdout</h3><pre>' + esc(step.stdout) + '</pre>' : '';
    const stderr = step.stderr ? '<h3>stderr</h3><pre>' + esc(step.stderr) + '</pre>' : '';
    return stdout || stderr ? stdout + stderr : '<span class="muted">empty</span>';
  }).join("");
}

function runbookActions(command) {
  return '<div class="actions compact">' + copyButton(command.command, command.label) + runbookExecuteButton(command) + '</div>';
}

function runbookExecuteButton(command) {
  const executable = ["doctor", "plan-pr", "run-ci", "triage-report", "mutate"].includes(command.id);
  if (snapshot.readOnly) return '<button class="button link-button" disabled>Read-only</button>';
  if (!executable || command.safety === "trusted_only" || command.requiredSecrets?.length) return '<button class="button link-button" disabled>Guidance only</button>';
  return '<button class="button link-button runbook-execute" data-command="' + escAttr(command.id) + '">Run</button>';
}

function risk() {
  const report = snapshot.riskReport;
  if (!report) return empty("No risk register available. Run visual-hive risk or load enough artifacts to compute one.");
  const summary = report.summary;
  return '<div class="section">' +
    '<div class="grid">' +
    metric("Risk score", summary.riskScore + "/100", summary.riskScore >= 50 ? "bad" : (summary.riskScore ? "warn" : "ok")) +
    metric("Total risks", summary.total, summary.total ? "warn" : "ok") +
    metric("Critical/high", summary.critical + summary.high, summary.critical || summary.high ? "bad" : "ok") +
    metric("PR blocking", summary.prBlocking, summary.prBlocking ? "bad" : "ok") +
    metric("Trusted-only", summary.trustedOnly, summary.trustedOnly ? "warn" : "ok") +
    '</div>' +
    card("Recommendations", list(report.recommendations || [])) +
    card("Inputs", table(["Artifact", "Loaded"], Object.entries(report.inputs || {}).map(([key, value]) => [esc(key), value ? '<span class="ok">yes</span>' : '<span class="muted">no</span>']))) +
    card("Risk Register", report.risks?.length ? table(["Severity", "Category", "Title", "Open", "Evidence", "Actions", "Artifacts"], report.risks.map(r => [
      severityBadge(r.severity),
      esc(r.category),
      '<b>' + esc(r.title) + '</b><p class="muted">' + esc(r.message) + '</p>',
      riskNavigation(r),
      (r.evidence || []).map(esc).join("<br>") || '<span class="muted">none</span>',
      (r.suggestedActions || []).map(esc).join("<br>") || '<span class="muted">none</span>',
      (r.artifacts || []).map(a => link(a)).join("<br>") || '<span class="muted">none</span>'
    ])) : '<p class="ok">No immediate visual QA risks were found.</p>') +
    '</div>';
}

function severityBadge(severity) {
  if (severity === "critical" || severity === "high") return '<span class="bad">' + esc(severity) + '</span>';
  if (severity === "medium") return '<span class="warn">' + esc(severity) + '</span>';
  return '<span class="ok">' + esc(severity) + '</span>';
}

function riskNavigation(risk) {
  const buttons = [];
  (risk.contractIds || []).forEach(id => buttons.push(navButton("contracts", "contract:" + id, { contract: id })));
  (risk.targetIds || []).forEach(id => buttons.push(navButton("targets", "target:" + id, { target: id })));
  if (risk.category === "deterministic_failure" || risk.category === "mutation_adequacy") buttons.push(navButton("failures", "failure inbox"));
  if (risk.category === "baseline_review") buttons.push(navButton("baselines", "baseline review"));
  if (risk.category === "coverage_gap") buttons.push(navButton("coverage", "coverage"));
  if (risk.category === "workflow_safety") buttons.push(navButton("github", "GitHub / CI"));
  if (risk.category === "provider_policy") buttons.push(navButton("providers", "providers"));
  if (risk.category === "planning") buttons.push(navButton("runbook", "runbook"));
  if ((risk.artifacts || []).length) buttons.push(navButton("artifacts", "artifact", { artifact: risk.artifacts[0] }));
  return buttons.length ? '<div class="actions compact">' + buttons.join("") + '</div>' : '<span class="muted">global</span>';
}

function navButton(tab, label, data = {}) {
  const attrs = Object.entries(data)
    .filter(([, value]) => value)
    .map(([key, value]) => ' data-' + escAttr(key) + '="' + escAttr(value) + '"')
    .join("");
  return '<button class="button link-button risk-nav" data-tab="' + escAttr(tab) + '"' + attrs + '>' + esc(label) + '</button>';
}

function laneLabel(lane) {
  const labels = {
    local: "Local readiness",
    pull_request: "Pull request lane",
    ci: "CI deterministic lane",
    schedule: "Scheduled adequacy lane",
    protected: "Trusted protected lane",
    triage: "Triage and reporting",
    ui: "Control Plane"
  };
  return labels[lane] || lane;
}

function safetyBadge(safety) {
  if (safety === "pr_safe") return '<span class="ok">PR-safe</span>';
  if (safety === "trusted_only") return '<span class="bad">trusted only</span>';
  return '<span class="warn">local only</span>';
}

function setup() {
  const recommendation = snapshot.setupRecommendation;
  if (!recommendation) {
    return '<div class="grid">' +
      card("No recommendation artifact", '<p class="muted">Run <code>visual-hive recommend</code> in the target repo to generate .visual-hive/recommendations.json.</p>') +
      card("Bootstrap command", '<pre>visual-hive recommend --write-config</pre>') +
      card("What it detects", list(["package scripts for install/build/serve", "frontend framework signals", "project-owned data-testid selectors", "starter PR-safe screenshots and selection rules"])) +
      '</div>';
  }
  const cost = recommendation.costEstimate || {};
  const permissions = recommendation.permissions || {};
  const setupPr = recommendation.setupPullRequest || {};
  return '<div class="section">' +
    '<div class="grid">' +
    metric("Setup profile", recommendation.setupProfile || "unknown", "") +
    metric("Detected type", recommendation.project.type, "") +
    metric("Package manager", recommendation.project.packageManager, "") +
    metric("Target confidence", recommendation.recommendedTarget.confidence, recommendation.recommendedTarget.confidence === "low" ? "warn" : "ok") +
    metric("Selectors", recommendation.detectedSelectors.length, recommendation.detectedSelectors.length ? "ok" : "warn") +
    metric("PR runtime", cost.estimatedPrMinutes == null ? "unknown" : cost.estimatedPrMinutes + "m", cost.ciRuntimeClass === "expensive" ? "bad" : "") +
    metric("External screenshots", cost.externalScreenshotsPerRun == null ? "unknown" : cost.externalScreenshotsPerRun + "/run", cost.externalScreenshotsPerRun ? "warn" : "ok") +
    '</div>' +
    setupChecklist(recommendation) +
    card("Recommended target", table(["Field", "Value"], [["ID", recommendation.recommendedTarget.id], ["Kind", recommendation.recommendedTarget.kind], ["URL", recommendation.recommendedTarget.url], ["Install", recommendation.recommendedTarget.install || "n/a"], ["Build", recommendation.recommendedTarget.build || "n/a"], ["Serve", recommendation.recommendedTarget.serve || "n/a"]])) +
    card("Provider recommendation", recommendation.providerRecommendations?.length ? table(["Provider", "Recommendation", "External by default", "Required env names", "Reason"], recommendation.providerRecommendations.map(p => [p.label, p.recommendation, p.externalUploadAllowedByDefault ? "yes" : "no", p.requiredEnv?.join(", ") || "none", p.reason])) : '<p class="muted">No provider recommendation found. Run a newer visual-hive recommend.</p>') +
    card("Cost and permissions", table(["Area", "Value"], [
      ["Local screenshots/run", String(cost.localScreenshotsPerRun ?? "unknown")],
      ["External screenshots/run", String(cost.externalScreenshotsPerRun ?? "unknown")],
      ["Estimated monthly external screenshots", String(cost.estimatedMonthlyExternalScreenshots ?? "unknown")],
      ["PR permissions", permissions.pullRequest?.permissions?.join(", ") || "unknown"],
      ["PR secrets", permissions.pullRequest?.secretsRequired?.join(", ") || "none"],
      ["Scheduled secrets", permissions.scheduled?.secretsRequired?.join(", ") || "none"]
    ]) + (cost.notes?.length ? '<h3>Notes</h3>' + list(cost.notes) : "")) +
    card("Setup actions", setupActions()) +
    card("Setup PR guidance", setupPr.recommended ? '<p><b>' + esc(setupPr.title) + '</b></p>' + table(["Files", "Security notes"], [[list(setupPr.files || []), list(setupPr.securityNotes || [])]]) + '<h3>Steps</h3>' + list(setupPr.steps || []) : '<p class="muted">No setup PR guidance found.</p>') +
    card("Recommended contracts", table(["Contract", "Target", "Selectors", "Steps", "Screenshots"], recommendation.recommendedContracts.map(c => [c.id, c.targetId, c.selectors.join(", ") || "none", (c.steps || []).map(s => s.action + ":" + (s.selector || s.route || s.value || "")).join(", ") || "none", c.screenshots.map(s => s.name + " " + s.route + "@" + s.viewport).join(", ")]))) +
    card("Next commands", list(recommendation.recommendedCommands)) +
    card("Findings", recommendation.findings.length ? table(["Severity", "Message", "Evidence"], recommendation.findings.map(f => [f.severity, f.message, f.evidence || ""])) : "No findings.") +
    card("Warnings", recommendation.warnings.length ? list(recommendation.warnings) : "No setup warnings.") +
    preview("Recommended YAML", recommendation.recommendedConfigYaml) +
    '</div>';
}

function setupChecklist(recommendation) {
  const prSecrets = recommendation.permissions?.pullRequest?.secretsRequired || [];
  const providers = recommendation.providerRecommendations || [];
  const externalByDefault = providers.filter(provider => provider.externalUploadAllowedByDefault);
  const contractCount = recommendation.recommendedContracts?.length || 0;
  const screenshotCount = (recommendation.recommendedContracts || []).flatMap(contract => contract.screenshots || []).length;
  const selectorCount = recommendation.detectedSelectors?.length || 0;
  const target = recommendation.recommendedTarget || {};
  const setupPr = recommendation.setupPullRequest || {};
  const validationCommands = recommendation.recommendedCommands || [];
  const rows = [
    setupChecklistRow(
      "Inspect repository",
      recommendation.project?.scripts?.length ? "ready" : "review",
      [
        "project=" + (recommendation.project?.name || "unknown"),
        "frameworks=" + ((recommendation.project?.detectedFrameworks || []).join(", ") || "none"),
        "scripts=" + ((recommendation.project?.scripts || []).join(", ") || "none")
      ],
      copyButton("visual-hive recommend --repo .", "recommend command")
    ),
    setupChecklistRow(
      "Choose PR-safe local target",
      target.confidence === "low" ? "review" : "ready",
      ["target=" + (target.id || "unknown"), "kind=" + (target.kind || "unknown"), "confidence=" + (target.confidence || "unknown"), "url=" + (target.url || "n/a")],
      navButton("targets", "open targets", target.id ? { target: target.id } : {})
    ),
    setupChecklistRow(
      "Seed starter contracts",
      contractCount ? "ready" : "review",
      ["contracts=" + contractCount, "selectors=" + selectorCount, "screenshots=" + screenshotCount],
      navButton("contracts", "open contracts")
    ),
    setupChecklistRow(
      "Verify PR safety",
      prSecrets.length || externalByDefault.length ? "blocked" : "ready",
      [
        "pull_request permissions=" + ((recommendation.permissions?.pullRequest?.permissions || []).join(", ") || "unknown"),
        "PR secrets=" + (prSecrets.join(", ") || "none"),
        "external providers by default=" + (externalByDefault.map(provider => provider.label).join(", ") || "none")
      ],
      navButton("github", "open GitHub / CI")
    ),
    setupChecklistRow(
      "Generate setup files",
      setupPr.recommended ? "review" : "ready",
      ["files=" + ((setupPr.files || []).join(", ") || "none"), "title=" + (setupPr.title || "n/a")],
      snapshot.readOnly ? '<span class="muted">restart without --read-only to write</span>' : '<span class="muted">use Setup actions below after reviewing YAML</span>'
    ),
    setupChecklistRow(
      "Validate locally",
      validationCommands.length ? "ready" : "review",
      ["commands=" + (validationCommands.join(" && ") || "none")],
      validationCommands.map(command => copyButton(command, command)).join(" ")
    )
  ];
  return card(
    "Guided setup checklist",
    '<p class="muted">Driven by <code>.visual-hive/recommendations.json</code>. Complete these steps in order before opening a setup PR in another repository.</p>' +
      table(["Step", "Status", "Evidence", "Operator action"], rows)
  );
}

function setupChecklistRow(step, status, evidence, action) {
  return [
    '<b>' + esc(step) + '</b>',
    setupStatusBadge(status),
    (evidence || []).map(esc).join("<br>") || '<span class="muted">none</span>',
    action || '<span class="muted">review</span>'
  ];
}

function setupStatusBadge(status) {
  const labels = { ready: "ready", review: "needs review", blocked: "blocked" };
  return '<span class="status-' + escAttr(status) + '">' + esc(labels[status] || status) + '</span>';
}

function setupActions() {
  if (snapshot.readOnly) {
    return '<p class="muted">Read-only mode disables setup writes. Restart without <code>--read-only</code> to generate config or docs from this recommendation.</p>';
  }
  const hasConfig = Boolean(snapshot.configRaw);
  return '<p class="muted">Recommended setup writes use .visual-hive/recommendations.json, require confirmation, and record audit files.</p>' +
    '<div class="actions">' +
    '<button id="setup-write-config" class="button" data-force="' + (hasConfig ? "true" : "false") + '">' + (hasConfig ? "Overwrite config after review" : "Generate config") + '</button>' +
    '<button class="button copy-button" data-copy="' + escAttr(snapshot.setupRecommendation?.recommendedConfigYaml || "") + '">Copy recommended YAML</button>' +
    '<span id="setup-action-status" class="muted">' + (hasConfig ? "Existing config detected. Overwrite requires confirmation." : "No config content loaded for this repo.") + '</span>' +
    '</div><div class="actions">' +
    '<button id="setup-write-docs" class="button" data-force="false">Generate setup docs</button>' +
    '<button id="setup-overwrite-docs" class="button" data-force="true">Overwrite setup docs after review</button>' +
    '<span id="setup-docs-status" class="muted">Writes docs/visual-hive.md and records .visual-hive/setup-doc-edits.json.</span>' +
    '</div><div class="actions">' +
    '<button id="setup-write-bundle" class="button">Generate setup PR bundle</button>' +
    '<button id="setup-overwrite-bundle" class="button">Overwrite setup bundle after review</button>' +
    '<span id="setup-bundle-status" class="muted">Writes config, docs, workflow templates, and records .visual-hive/setup-bundle-edits.json.</span>' +
    '</div>';
}

function runs() {
  const report = snapshot.report;
  const history = snapshot.runHistory;
  if (!report && !history) return empty("No report found. Run visual-hive run.");
  const historyBlock = history ? '<div class="grid" style="margin-top:14px">' +
    metric("Recorded runs", history.summary.runCount, "") +
    metric("Passed runs", history.summary.passedRuns, "ok") +
    metric("Failed runs", history.summary.failedRuns, history.summary.failedRuns ? "bad" : "ok") +
    metric("Avg mutation", history.summary.averageMutationScore == null ? "n/a" : Math.round(history.summary.averageMutationScore * 100) + "%", "") +
    '</div>' + card("Run history", table(["Run", "Recorded", "Status", "Mode", "Failed", "Visual diffs", "Mutation", "Report"], history.entries.map(e => [e.id, e.recordedAt, e.deterministicStatus || "unknown", e.mode || "unknown", String(e.failedContracts), String(e.visualDiffs), e.mutationScore == null ? "n/a" : Math.round(e.mutationScore * 100) + "%", e.files.report ? link(e.files.report, "report") : "latest"]))) : "";
  if (!report) return '<div class="section">' + historyBlock + '</div>';
  return '<div class="section">' +
    card("Run metadata", '<table><tr><th>Project</th><td>' + esc(report.project) + '</td></tr><tr><th>Repository</th><td>' + esc(report.repository?.repository || "unknown") + '</td></tr><tr><th>Branch</th><td>' + esc(report.repository?.branch || "unknown") + '</td></tr><tr><th>Commit</th><td>' + esc(report.repository?.commitSha ? report.repository.commitSha.slice(0, 12) : "unknown") + '</td></tr><tr><th>Run context</th><td>' + esc(report.repository?.provider || "unknown") + '</td></tr><tr><th>Mode</th><td>' + esc(report.mode) + '</td></tr><tr><th>Status</th><td>' + esc(report.status) + '</td></tr><tr><th>Generated</th><td>' + esc(report.generatedAt) + '</td></tr><tr><th>Spec</th><td>' + link(rel(report.generatedSpecPath), "generated spec") + '</td></tr></table>') +
    historyBlock +
    card("Contract results", table(["Contract", "Target", "Status", "Duration", "Flow", "Reproduce"], report.results.map(r => [r.contractId, r.targetId, r.status, r.durationMs + "ms", ((r.flowSteps || []).filter(s => s.status === "passed").length + "/" + (r.flowSteps || []).length), r.reproductionCommand || ""]))) +
    card("Flow steps", report.results.some(r => (r.flowSteps || []).length) ? table(["Contract", "Action", "Selector/route", "Status", "Duration", "Message"], report.results.flatMap(r => (r.flowSteps || []).map(s => [r.contractId, s.action, s.selector || s.route || s.value || "", s.status, s.durationMs + "ms", s.message || ""]))) : '<p class="muted">No user-flow steps were reported.</p>') +
    card("Lifecycle", table(["Target", "Phase", "Status", "Duration", "Message"], report.targetLifecycle.map(e => [e.targetId, e.phase, e.status, e.durationMs + "ms", e.message || e.url || ""]))) +
    providerResultsCard(report.providerResults) +
    card("Raw JSON", '<pre>' + esc(JSON.stringify(report, null, 2)) + '</pre>') +
    '</div>';
}

function failures() {
  if (!snapshot.failures.length) return empty("No deterministic failures or mutation survivors found.");
  return '<div class="section">' + snapshot.failures.map(f => card(f.contractId, '<p><b>Classification:</b> ' + esc(f.classification) + (f.severity ? ' <b>Severity:</b> ' + esc(f.severity) : '') + '</p><p><b>Target:</b> ' + esc(f.targetId) + '</p><pre>' + esc(f.errorExcerpt) + '</pre>' + failureList("Evidence", f.evidence) + failureList("Suggested files", f.suggestedFiles) + failureList("Suggested tests", f.suggestedNextTests) + '<p>' + esc(f.reproductionCommand || '') + '</p><p>' + f.artifacts.map(a => link(a)).join("<br>") + '</p>')).join("") + preview("Issue body", snapshot.issueMarkdown) + preview("PR comment", snapshot.prCommentMarkdown) + preview("Missing tests", snapshot.missingTestsMarkdown) + preview("Baseline review", snapshot.baselineReviewMarkdown) + preview("Triage prompt", snapshot.triagePrompt) + preview("Repair prompt", snapshot.repairPrompt) + '</div>';
}

function baselines() {
  if (!snapshot.screenshots.length) return empty("No screenshot assertions found.");
  return '<div class="section">' + preview("Baseline review", snapshot.baselineReviewMarkdown) + snapshot.screenshots.map(s => card(s.contractId + " / " + s.name, baselineCardBody(s))).join("") + '</div>';
}

function mutation() {
  const report = snapshot.mutationReport;
  if (!report) return empty("No mutation report found. Run visual-hive mutate.");
  return '<div class="section">' + metric("Mutation score", Math.round(report.score * 100) + "%", report.score >= report.minScore ? "ok" : "bad") + card("Operator results", table(["Operator", "Status", "Contracts", "Duration", "Excerpt"], report.results.map(r => [r.operator, r.status, r.contractIds.join(", "), r.durationMs + "ms", r.failedAssertion || r.errors?.[0] || ""]))) + '</div>';
}

function coverage() {
  const c = snapshot.coverage;
  const s = c.summary;
  return '<div class="grid">' +
    metric("Targets", s.targetCount, "") +
    metric("Contracts", s.contractCount, "") +
    metric("Selected", s.selectedContracts, "") +
    metric("Coverage gaps", c.uncoveredAreas.length, c.uncoveredAreas.length ? "bad" : "ok") +
    '</div><div class="grid" style="margin-top:14px">' +
    metric("PR-safe contracts", s.prSafeContracts, "") +
    metric("Protected contracts", s.protectedContracts, "") +
    metric("Schedule-only", s.scheduleOnlyContracts, "") +
    metric("Routes", s.routesCovered, "") +
    '</div><div class="section" style="margin-top:14px">' +
    card("Targets", table(["Target", "Kind", "Contracts", "Selected", "Safety"], c.targets.map(t => [t.id, t.kind, t.contractIds.join(", ") || "none", t.selectedContractIds.join(", ") || "none", t.protected ? "protected" : (t.prSafe ? "PR-safe" : "unsafe")]))) +
    card("Routes", table(["Route", "Contracts", "Selected", "Viewports"], c.routes.map(r => [r.route, r.contracts.join(", "), r.selectedContracts.join(", ") || "none", r.viewports.join(", ")]))) +
    card("Viewports", table(["Viewport", "Size", "Routes", "Contracts"], c.viewports.map(v => [v.viewport, v.width + "x" + v.height, v.routes.join(", ") || "none", v.contracts.join(", ") || "none"]))) +
    card("Changed-file coverage", c.changedFileCoverage.length ? table(["Pattern", "Risk", "Matches", "Selected contracts", "Unselected contracts"], c.changedFileCoverage.map(r => [r.pattern, r.risk, r.matchedFiles.join(", ") || "none", r.selectedContracts.join(", ") || "none", r.unselectedContracts.join(", ") || "none"])) : "No changed-file selection rules configured.") +
    card("Coverage gaps", c.uncoveredAreas.length ? table(["Severity", "Kind", "Message"], c.uncoveredAreas.map(g => [g.severity, g.kind, g.message])) : "No coverage gaps detected from config and latest plan.") +
    '</div>';
}

function config() {
  return '<div class="section">' +
    (snapshot.configError ? card("Validation error", '<pre class="bad">' + esc(snapshot.configError) + '</pre>') : card("Validation", '<p class="ok">Config loaded successfully.</p>')) +
    card("Config editor", '<textarea id="config-editor" class="editor" spellcheck="false">' + esc(snapshot.configRaw || "") + '</textarea><div class="actions"><button id="config-validate" class="button">Validate and preview diff</button><button id="config-save" class="button" ' + (snapshot.readOnly ? "disabled" : "") + '>Save after diff review</button>' + (snapshot.readOnly ? '<span class="muted">Read-only mode</span>' : '') + '</div><pre id="config-editor-status" class="muted">Edit YAML, validate, review the diff, then save explicitly.</pre>') +
    card("Parsed config", '<pre>' + esc(JSON.stringify(snapshot.config || {}, null, 2)) + '</pre>') +
    '</div>';
}

function targets() {
  if (!snapshot.targets.length) return empty("No targets found.");
  const audit = snapshot.targetAudit;
  if (!audit) {
    return card("Targets", table(["ID", "Kind", "URL", "PR safe", "Cost", "Contracts", "Latest"], snapshot.targets.map(t => [focusWrapper("target", t.id, esc(t.id)), t.config.kind, t.config.url || "", t.config.prSafe ? "yes" : "no", t.config.cost, t.contractIds.join(", "), t.latestStatus || "not run"])));
  }
  const s = audit.summary;
  return '<div class="grid">' +
    metric("Targets", s.targetCount, "") +
    metric("Selected", s.selectedTargets, "") +
    metric("PR-safe", s.prSafeTargets, "") +
    metric("Protected", s.protectedTargets, "") +
    '</div><div class="grid" style="margin-top:14px">' +
    metric("Deploy previews", s.deployPreviewTargets || 0, s.deployPreviewTargets ? "ok" : "") +
    metric("Storybook targets", s.storybookTargets || 0, s.storybookTargets ? "ok" : "") +
    metric("Needs setup", s.setupRequiredTargets, "") +
    metric("Missing secrets", s.missingSecretNames, s.missingSecretNames ? "bad" : "ok") +
    metric("Failed lifecycle", s.targetsWithFailedLifecycle, s.targetsWithFailedLifecycle ? "bad" : "ok") +
    metric("Without contracts", s.targetsWithoutContracts, s.targetsWithoutContracts ? "bad" : "ok") +
    '</div><div class="section" style="margin-top:14px">' +
    card("Target audit", table(["ID", "Kind", "URL", "Safety", "Cost", "Contracts", "Selected", "Latest", "Labels", "Gaps"], audit.targets.map(t => [focusWrapper("target", t.id, esc(t.id)), t.kind, t.url || "n/a", t.prSafe ? "PR-safe" : "not PR-safe", t.cost, t.contractIds.join(", ") || "none", t.selected ? "yes" : "no", t.latestStatus, t.labels.join(", ") || "none", t.gaps.map(g => g.kind).join(", ") || "none"]))) +
    card("Services and readiness", table(["Target", "Service", "Readiness URL", "Timeout"], audit.targets.flatMap(t => t.services.map(service => [t.id, service.name, service.readinessUrl, service.readinessTimeoutMs ? service.readinessTimeoutMs + "ms" : "default"])))) +
    card("Lifecycle events", table(["Target", "Phase", "Status", "Duration", "Message"], audit.targets.flatMap(t => t.lifecycleEvents.map(e => [t.id, e.phase, e.status, e.durationMs + "ms", e.message || e.url || ""])))) +
    card("Recommendations", audit.targets.flatMap(t => t.recommendations.map(r => t.id + ": " + r)).length ? list(audit.targets.flatMap(t => t.recommendations.map(r => t.id + ": " + r))) : "No target recommendations from the current audit.") +
    '</div>';
}

function contracts() {
  if (!snapshot.contracts.length) return empty("No contracts found.");
  const audit = snapshot.contractAudit;
  if (!audit) {
    const rows = snapshot.contracts.map(c => ({ id: c.config.id, targetId: c.config.target, severity: c.config.severity, selected: false, latestStatus: c.latestStatus || "not_run", routes: (c.config.screenshots || []).map(s => s.route), viewports: (c.config.screenshots || []).map(s => s.viewport), mutationMappings: c.mutationOperators.map(operator => ({ operator })), gaps: [], recommendations: [], flowStepCount: c.config.flow?.length || 0, consoleRules: { failOnConsoleError: Boolean(c.config.failOnConsoleError), expectedConsoleErrors: c.config.expectedConsoleErrors || [] } }));
    const filtered = filterContracts(rows);
    return contractFilterCard(rows, filtered.length) + card("Contracts", table(["ID", "Target", "Severity", "Run on PR", "Routes", "Viewports", "Latest", "Mutations"], filtered.map(c => [focusWrapper("contract", c.id, esc(c.id)), c.targetId, c.severity, snapshot.config?.contracts?.find(contract => contract.id === c.id)?.runOn?.pullRequest ? "yes" : "no", c.routes.join(", ") || "none", c.viewports.join(", ") || "none", statusLabel(c), c.mutationMappings.map(m => m.operator).join(", ")])));
  }
  const s = audit.summary;
  const filteredContracts = filterContracts(audit.contracts);
  return '<div class="grid">' +
    metric("Contracts", s.contractCount, "") +
    metric("Selected", s.selectedContracts, "") +
    metric("Not run", s.notRunContracts, s.notRunContracts ? "bad" : "ok") +
    metric("High gaps", s.contractsWithHighSeverityGaps, s.contractsWithHighSeverityGaps ? "bad" : "ok") +
    '</div><div class="grid" style="margin-top:14px">' +
    metric("Assertion-free", s.assertionFreeContracts, s.assertionFreeContracts ? "bad" : "ok") +
    metric("Screenshotless", s.screenshotlessContracts, "") +
    metric("No waitFor", s.contractsWithoutWaitFor, "") +
    metric("Mutation mapped", s.mutationMappedContracts, "") +
    '</div><div class="section" style="margin-top:14px">' +
    contractFilterCard(audit.contracts, filteredContracts.length) +
    card("Contract audit", table(["ID", "Target", "Severity", "PR safe", "Selected", "Latest", "Flow", "Routes", "Viewports", "Mutations", "Gaps"], filteredContracts.map(c => [focusWrapper("contract", c.id, esc(c.id)), c.targetId, c.severity, contractTargetPrSafe(c.targetId) ? "yes" : "no", c.selected ? "yes" : "no", statusLabel(c), String(c.flowStepCount ?? 0), c.routes.join(", ") || "none", c.viewports.join(", ") || "none", c.mutationMappings.map(m => m.operator).join(", ") || "none", c.gaps.map(g => g.kind).join(", ") || "none"]))) +
    card("Recommendations", filteredContracts.flatMap(c => c.recommendations.map(r => c.id + ": " + r)).length ? list(filteredContracts.flatMap(c => c.recommendations.map(r => c.id + ": " + r))) : "No contract recommendations match the current filters.") +
    card("Console rules", table(["ID", "Fail on console", "Expected errors"], filteredContracts.map(c => [c.id, c.consoleRules.failOnConsoleError ? "yes" : "no", c.consoleRules.expectedConsoleErrors.join(", ") || "none"]))) +
    '</div>';
}

function contractFilterCard(contracts, filteredCount) {
  const contractIds = uniqueValues(contracts.map(c => c.id));
  const targets = uniqueValues(contracts.map(c => c.targetId));
  const severities = uniqueValues(contracts.map(c => c.severity));
  const routes = uniqueValues(contracts.flatMap(c => c.routes || []));
  const viewports = uniqueValues(contracts.flatMap(c => c.viewports || []));
  return card("Contract filters", '<div class="grid">' +
    filterSelect("contract-filter-contract", "Contract", contractFilters.contract, [["all", "All contracts"]].concat(contractIds.map(value => [value, value]))) +
    filterSelect("contract-filter-target", "Target", contractFilters.target, [["all", "All targets"]].concat(targets.map(value => [value, value]))) +
    filterSelect("contract-filter-severity", "Severity", contractFilters.severity, [["all", "All severities"]].concat(severities.map(value => [value, value]))) +
    filterSelect("contract-filter-prsafe", "PR safety", contractFilters.prSafe, [["all", "Any safety"], ["safe", "PR-safe targets"], ["unsafe", "Not PR-safe/protected"]]) +
    filterSelect("contract-filter-status", "Status", contractFilters.status, [["all", "Any status"], ["failed", "Failed"], ["passed", "Passed"], ["not_run", "Not run"], ["selected", "Selected"], ["unselected", "Not selected"]]) +
    filterSelect("contract-filter-route", "Route", contractFilters.route, [["all", "All routes"]].concat(routes.map(value => [value, value]))) +
    filterSelect("contract-filter-viewport", "Viewport", contractFilters.viewport, [["all", "All viewports"]].concat(viewports.map(value => [value, value]))) +
    '</div><p class="muted">' + esc(filteredCount) + ' of ' + esc(contracts.length) + ' contracts shown. Filters are local to the browser and do not change config.</p>');
}

function filterContracts(contracts) {
  return contracts.filter(c => {
    if (contractFilters.contract !== "all" && c.id !== contractFilters.contract) return false;
    if (contractFilters.target !== "all" && c.targetId !== contractFilters.target) return false;
    if (contractFilters.severity !== "all" && c.severity !== contractFilters.severity) return false;
    if (contractFilters.prSafe === "safe" && !contractTargetPrSafe(c.targetId)) return false;
    if (contractFilters.prSafe === "unsafe" && contractTargetPrSafe(c.targetId)) return false;
    if (contractFilters.status === "failed" && statusLabel(c) !== "failed") return false;
    if (contractFilters.status === "passed" && statusLabel(c) !== "passed") return false;
    if (contractFilters.status === "not_run" && statusLabel(c) !== "not run") return false;
    if (contractFilters.status === "selected" && !c.selected) return false;
    if (contractFilters.status === "unselected" && c.selected) return false;
    if (contractFilters.route !== "all" && !(c.routes || []).includes(contractFilters.route)) return false;
    if (contractFilters.viewport !== "all" && !(c.viewports || []).includes(contractFilters.viewport)) return false;
    return true;
  });
}

function contractTargetPrSafe(targetId) {
  return Boolean(snapshot.targets.find(t => t.id === targetId)?.config?.prSafe);
}

function statusLabel(contract) {
  const status = contract.latestStatus || "not run";
  return status === "not_run" ? "not run" : status;
}

function filterSelect(id, label, selected, options) {
  return '<label>' + esc(label) + '<select id="' + escAttr(id) + '" class="filter-select contract-filter" data-filter="' + escAttr(id.replace("contract-filter-", "")) + '">' + options.map(([value, text]) => '<option value="' + escAttr(value) + '" ' + (selected === value ? "selected" : "") + '>' + esc(text) + '</option>').join("") + '</select></label>';
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean).map(value => String(value)))].sort();
}

function schedule() {
  const audit = snapshot.scheduleAudit;
  if (!audit) {
    return '<div class="grid">' + card("PR lane", "Use pull_request, read-only permissions, no secrets, plan/run/triage/report, upload .visual-hive artifacts.") + card("Scheduled lane", "Use schedule or workflow_dispatch for deeper checks, mutation, and protected targets.") + card("Trusted issue lane", "Use workflow_run to consume sanitized artifacts. Do not checkout or execute PR code.") + '</div>';
  }
  const s = audit.summary;
  return '<div class="grid">' +
    metric("PR contracts", s.pullRequestContracts, "") +
    metric("Scheduled", s.scheduledContracts, "") +
    metric("Protected", s.protectedContracts, "") +
    metric("High gaps", s.highSeverityGaps, s.highSeverityGaps ? "bad" : "ok") +
    '</div><div class="grid" style="margin-top:14px">' +
    metric("Cron targets", s.targetsWithCronSchedules, "") +
    metric("Mutation scheduled", s.mutationScheduled ? "yes" : "no", s.mutationScheduled ? "ok" : "warn") +
    metric("Missing secrets", s.missingSecretNames, s.missingSecretNames ? "bad" : "ok") +
    metric("Protected scheduled", s.protectedScheduledContracts, "") +
    '</div><div class="section" style="margin-top:14px">' +
    card("Workflow lanes", table(["Lane", "Trigger", "Contracts", "Targets", "Secrets", "Warnings"], audit.lanes.map(l => [l.label, l.trigger, l.contractIds.join(", ") || "none", l.targetIds.join(", ") || "none", l.usesSecrets ? "yes" : "no", l.warnings.join("; ") || "none"]))) +
    card("Target schedules", table(["Target", "Kind", "Cron", "Contracts", "Scheduled contracts", "Missing secrets"], audit.targetSchedules.map(t => [t.targetId, t.kind, t.schedule || "none", t.contractIds.join(", ") || "none", t.scheduledContractIds.join(", ") || "none", t.missingSecrets.join(", ") || "none"]))) +
    card("Schedule gaps", audit.gaps.length ? table(["Severity", "Kind", "Message"], audit.gaps.map(g => [g.severity, g.kind, g.message])) : "No schedule safety gaps detected.") +
    card("Recommendations", audit.recommendations.length ? list(audit.recommendations) : "No schedule recommendations from the current audit.") +
    '</div>';
}

function llm() {
  const ai = snapshot.config?.ai;
  const usage = snapshot.llmUsage;
  const settings = card("LLM settings", table(["Setting", "Value"], [["Enabled", ai?.enabled ? "yes" : "no"], ["Provider", ai?.provider || "none"], ["Model", ai?.model || "offline-heuristics"], ["Never sole oracle", ai?.neverSoleOracle ? "yes" : "no"], ["Daily max", ai?.maxDailyRuns ?? "n/a"], ["Prompt token budget", ai?.maxPromptTokens ?? "n/a"], ["Estimated cost budget", ai?.maxEstimatedCostUsd == null ? "n/a" : "$" + ai.maxEstimatedCostUsd]]));
  const usageBlock = usage ? '<div class="grid" style="margin-top:14px">' +
    metric("Prompt artifacts", usage.summary.promptCount, "") +
    metric("Estimated tokens", usage.summary.totalEstimatedTokens, "") +
    metric("Estimated cost", "$" + usage.summary.totalEstimatedCostUsd, "") +
    metric("Calls made", usage.summary.callsMade, usage.summary.callsMade ? "bad" : "ok") +
    '</div>' +
    card("Usage records", table(["Task", "Status", "Tokens", "Cost", "Prompt-only"], usage.records.map(r => [r.task, r.status, String(r.estimatedTokens), "$" + r.estimatedCostUsd, r.promptOnly ? "yes" : "no"]))) +
    card("Governance warnings", usage.warnings.length ? list(usage.warnings) : "No LLM governance warnings.") +
    card("Recommendations", usage.recommendations.length ? list(usage.recommendations) : "No LLM recommendations.") : card("LLM usage", '<p class="muted">No llm-usage.json found. Run visual-hive triage to generate prompt-only usage records.</p>');
  return settings + usageBlock + preview("Triage prompt", snapshot.triagePrompt) + preview("Repair prompt", snapshot.repairPrompt) + preview("Missing tests", snapshot.missingTestsMarkdown) + preview("Baseline review", snapshot.baselineReviewMarkdown);
}

function providers() {
  if (!snapshot.providers.length) return empty("No provider config loaded.");
  const enabled = snapshot.providers.filter(p => p.enabled || p.id === "playwright");
  const missing = snapshot.providers.filter(p => p.missingEnv?.length);
  const policyBlocked = snapshot.providers.filter(p => p.availability === "policy_blocked");
  return '<div class="grid">' +
    metric("Providers", snapshot.providers.length, "") +
    metric("Enabled", enabled.length, "") +
    metric("Missing credentials", missing.length, missing.length ? "warn" : "ok") +
    metric("Policy blocked", policyBlocked.length, policyBlocked.length ? "warn" : "ok") +
    '</div><div class="section" style="margin-top:14px">' +
    providerCostPolicyCard() +
    card("Provider adapters", table(["Provider", "Enabled", "Status", "Mode", "Role", "Credentials", "External upload", "Supports"], snapshot.providers.map(p => [
      '<b>' + esc(p.label) + '</b><p class="muted">' + esc(p.docs) + '</p>',
      p.enabled ? "yes" : "no",
      p.availability,
      p.mode,
      p.deterministicRole,
      providerCredentialSummary(p),
      providerInspectionPolicy(p),
      p.supports.join(", ")
    ]))) +
    providerPlanPolicyCard(snapshot.plan?.providerPolicy) +
    providerResultsCard(snapshot.report?.providerResults) +
    providerRunResultsCard(snapshot.providerRunReport) +
    '<div class="grid" style="margin-top:14px">' + snapshot.providers.map(p => card(p.label, providerDetailBody(p))).join("") + '</div>' +
    '</div>';
}

function providerCostPolicyCard() {
  const policy = snapshot.config?.costPolicy;
  if (!policy) return card("External upload guardrails", '<p class="muted">No cost policy loaded. External providers remain optional and disabled by default.</p>');
  return card("External upload guardrails", table(["Policy", "Value"], [
    ["PR uploads", policy.externalUpload?.pullRequest ? "allowed" : "blocked"],
    ["Scheduled uploads", policy.externalUpload?.schedule ? "allowed" : "blocked"],
    ["Manual uploads", policy.externalUpload?.manual ? "allowed" : "blocked"],
    ["Failure-only", policy.externalUpload?.onFailureOnly ? "yes" : "no"],
    ["Critical contracts only", policy.externalUpload?.criticalContractsOnly ? "yes" : "no"],
    ["Max external screenshots/run", String(policy.maxExternalScreenshotsPerRun)],
    ["Max monthly external screenshots", String(policy.maxMonthlyExternalScreenshots)]
  ]) + '<p class="muted">Playwright remains local and deterministic. Hosted providers are supplemental and require explicit config plus credential names.</p>');
}

function providerCredentialSummary(provider) {
  const required = provider.requiredEnv || [];
  const missing = provider.missingEnv || [];
  if (!required.length) return '<span class="ok">none required</span>';
  return '<p>Required names: ' + esc(required.join(", ")) + '</p>' +
    (missing.length ? '<p class="warn">Missing names: ' + esc(missing.join(", ")) + '</p>' : '<p class="ok">Credential names present</p>');
}

function providerInspectionPolicy(provider) {
  if (provider.id === "playwright") return '<span class="ok">local only</span>';
  const policy = provider.costPolicy;
  if (!provider.enabled) return '<span class="muted">disabled</span>';
  if (!policy) return '<span class="muted">not evaluated</span>';
  const allowed = policy.externalUploadAllowed;
  const reasons = policy.blockedReasons || [];
  return '<span class="' + (allowed ? "ok" : "warn") + '">' + (allowed ? "allowed" : "blocked") + '</span>' +
    '<p class="muted">' + esc(policy.estimatedExternalScreenshots) + " estimated screenshot(s), max " + esc(policy.maxExternalScreenshotsPerRun) + "/run</p>" +
    (reasons.length ? '<p class="muted">' + esc(reasons.join(" ")) + '</p>' : "");
}

function providerDetailBody(provider) {
  const policy = provider.costPolicy;
  return '<p><b>Status:</b> ' + esc(provider.availability) + ' <b>Mode:</b> ' + esc(provider.mode) + '</p>' +
    '<p>' + esc(provider.message) + '</p>' +
    table(["Field", "Value"], [
      ["Deterministic role", esc(provider.deterministicRole)],
      ["Credential names", providerCredentialSummary(provider)],
      ["External upload", providerInspectionPolicy(provider)],
      ["Estimated screenshots", esc(policy?.estimatedExternalScreenshots ?? "n/a")],
      ["Run limit", esc(policy?.maxExternalScreenshotsPerRun ?? "n/a")],
      ["Monthly limit", esc(policy?.maxMonthlyExternalScreenshots ?? "n/a")],
      ["Supported actions", esc((provider.supports || []).join(", ") || "none")]
    ]);
}

function providerPlanPolicyCard(policy) {
  if (!policy || !policy.length) return card("Provider plan policy", '<p class="muted">No provider policy found in plan.json. Run visual-hive plan with a current CLI.</p>');
  return card("Provider plan policy", '<p class="muted">Planner evidence only. External calls planned should remain 0 unless a future trusted adapter explicitly changes that.</p>' +
    table(["Provider", "Availability", "Upload", "Estimated screenshots", "External calls", "Missing env", "Reasons"], policy.map(p => [
      p.label,
      p.availability,
      p.providerId === "playwright" ? "local" : (p.externalUploadAllowed ? "allowed" : "blocked"),
      String(p.estimatedExternalScreenshots),
      String(p.externalCallsPlanned),
      (p.missingEnv || []).join(", ") || "none",
      (p.reasons || []).join("; ")
    ])));
}

function github() {
  const gh = snapshot.config?.github;
  return '<div class="section">' + card("GitHub settings", table(["Setting", "Value"], [["Enabled", gh?.enabled ? "yes" : "no"], ["Labels", (gh?.issueLabels || []).join(", ")], ["Comment marker", gh?.commentMarker || ""]])) + workflowTemplatesCard() + workflowAuditCard() + schedule() + '</div>';
}

function workflowTemplatesCard() {
  const templates = snapshot.workflowTemplates || [];
  if (!templates.length) return card("Workflow templates", '<p class="muted">No built-in workflow templates were loaded.</p>');
  return '<div class="section">' + card("Workflow templates", '<p class="muted">Copy these snippets into the target repository or run <code>visual-hive init</code>. PR execution stays read-only and no-secret; issue creation belongs in the trusted workflow_run lane.</p>' +
    workflowTemplateActions() +
    table(["Template", "Path", "Purpose", "Safety", "Actions"], templates.map(t => [esc(t.label), esc(t.path), esc(t.description), list(t.safetyNotes), copyButton(t.content, t.label + " workflow") + workflowTemplateWriteButton(t)])) +
    '<p class="muted">For production supply-chain hardening, pin GitHub Actions by SHA after adopting a template.</p><pre id="workflow-template-status" class="muted">Workflow writes require confirmation and record .visual-hive/workflow-edits.json.</pre>') +
    templates.map(t => card(t.label + " snippet", '<p class="muted">' + esc(t.path) + '</p><pre>' + esc(t.content) + '</pre>')).join("") +
    '</div>';
}

function workflowTemplateActions() {
  if (snapshot.readOnly) return '<p class="muted">Read-only mode disables workflow template writes.</p>';
  return '<div class="actions"><button id="workflow-write-all" class="button">Write all templates</button><button id="workflow-overwrite-all" class="button">Overwrite all after review</button></div>';
}

function workflowTemplateWriteButton(template) {
  if (snapshot.readOnly) return "";
  return ' <button class="button workflow-write-one" data-template="' + escAttr(template.id) + '">Write</button>';
}

function workflowAuditCard() {
  const audit = snapshot.workflowAudit;
  if (!audit) return card("Workflow safety", '<p class="muted">No workflow audit found. Run visual-hive workflows or add .github/workflows files.</p>');
  return card("Workflow safety", '<div class="grid">' +
    metric("Workflows", audit.summary.workflowCount, "") +
    metric("Critical findings", audit.summary.criticalFindings, audit.summary.criticalFindings ? "bad" : "ok") +
    metric("PR secrets", audit.summary.prWorkflowsUsingSecrets, audit.summary.prWorkflowsUsingSecrets ? "bad" : "ok") +
    metric("pull_request_target", audit.summary.workflowsUsingPullRequestTarget, audit.summary.workflowsUsingPullRequestTarget ? "bad" : "ok") +
    '</div>' +
    table(["Workflow", "Kind", "Risk", "Triggers", "Artifacts", "Summary", "Issue artifact", "Redacts issue"], audit.workflows.map(w => [w.path, w.kind, w.risk, w.triggers.join(", ") || "none", w.uploadsVisualHiveArtifacts ? "yes" : "no", w.appendsStepSummary ? "yes" : "no", w.kind === "trusted_issue" ? (w.usesRecursiveArtifactDiscovery ? "recursive" : (w.readsIssueArtifact ? "fixed path" : "missing")) : "n/a", w.kind === "trusted_issue" ? (w.reSanitizesIssueBody ? "yes" : "no") : "n/a"])) +
    (audit.findings.length ? '<h3>Findings</h3>' + table(["Severity", "Workflow", "Message"], audit.findings.map(f => [f.severity, f.workflowPath, f.message])) : '<p class="ok">No workflow safety findings.</p>'));
}

function connections() {
  const index = snapshot.connections;
  if (!index) return empty("No local connection index found.");
  return '<div class="grid">' +
    metric("Connections", index.summary.connectionCount, "") +
    metric("Ready", index.summary.readyConnections, index.summary.readyConnections ? "ok" : "warn") +
    metric("Stored", index.summary.storedConnections, "") +
    metric("Needs attention", index.summary.connectionsNeedingAttention || 0, index.summary.connectionsNeedingAttention ? "warn" : "ok") +
    metric("Blocked", index.summary.blockedConnections || 0, index.summary.blockedConnections ? "bad" : "ok") +
    metric("Stale reports", index.summary.staleReportConnections || 0, index.summary.staleReportConnections ? "warn" : "ok") +
    metric("Weak mutation", index.summary.weakMutationConnections || 0, index.summary.weakMutationConnections ? "warn" : "ok") +
    metric("Coverage gaps", index.summary.coverageGapConnections || 0, index.summary.highCoverageGapConnections ? "bad" : (index.summary.coverageGapConnections ? "warn" : "ok")) +
    metric("High risk", index.summary.highRiskConnections || 0, index.summary.highRiskConnections ? "bad" : "ok") +
    '</div><div class="section" style="margin-top:14px">' +
    card("Connection health dashboard", table(["Repository", "Health", "Latest deterministic", "Mutation", "Coverage", "Risk", "Attention", "Action"], index.connections.map(c => [
      '<b>' + esc(c.label) + '</b><p class="muted">' + esc(c.projectName || c.id) + '</p><p class="muted">' + esc((c.tags || []).join(", ") || "no tags") + '</p>',
      connectionHealthBadge(c),
      connectionLatest(c),
      connectionMutation(c),
      connectionCoverage(c),
      connectionRisk(c),
      connectionAttention(c),
      connectionAction(c)
    ]))) +
    card("Connected repositories", table(["ID", "Project", "Status", "Repo", "Config"], index.connections.map(c => [esc(c.id), esc(c.projectName || "unknown"), esc(c.status), esc(c.repoRoot), esc(c.configPath)]))) +
    connectionForm() +
    card("Local connection file", '<p>' + esc(index.connectionsPath) + '</p><p class="muted">Connections store local paths only. Secret values are not stored. Only IDs from this file can be selected through the Control Plane.</p>') +
    card("Warnings", index.warnings.length ? list(index.warnings) : "No connection warnings.") +
    '</div>';
}

function connectionHealthBadge(connection) {
  if (connection.health === "ready") return '<span class="ok">ready</span>';
  if (connection.health === "blocked") return '<span class="bad">blocked</span><p class="muted">' + esc(connection.status) + '</p>';
  return '<span class="warn">attention</span><p class="muted">' + esc(connection.status) + '</p>';
}

function connectionLatest(connection) {
  const age = connection.latestReportAgeDays == null ? "" : '<p class="' + (connection.staleReport ? "warn" : "muted") + '">' + esc(connection.latestReportAgeDays) + 'd old</p>';
  if (connection.latestDeterministicStatus === "passed") return '<span class="ok">passed</span>' + connectionTimestamp(connection.latestReportAt) + age;
  if (connection.latestDeterministicStatus === "failed") return '<span class="bad">failed</span>' + connectionTimestamp(connection.latestReportAt) + age;
  return '<span class="muted">no report</span>';
}

function connectionMutation(connection) {
  if (connection.latestMutationScore == null) return '<span class="muted">not run</span>';
  const score = Math.round(connection.latestMutationScore * 100) + "%";
  const min = connection.mutationMinScore == null ? "" : '<p class="muted">min ' + Math.round(connection.mutationMinScore * 100) + "%</p>";
  const cls = connection.mutationMinScore != null && connection.latestMutationScore < connection.mutationMinScore ? "warn" : "ok";
  const detail = connection.mutationTotal == null ? "" : '<p class="muted">' + esc(connection.mutationKilled ?? 0) + "/" + esc(connection.mutationTotal) + " killed</p>";
  return '<span class="' + cls + '">' + esc(score) + '</span>' + min + detail;
}

function connectionCoverage(connection) {
  if (connection.missingCoverage || connection.coverageGapCount == null) return '<span class="muted">not run</span>';
  const high = connection.highCoverageGapCount || 0;
  const medium = connection.mediumCoverageGapCount || 0;
  const cls = high ? "bad" : (connection.coverageGapCount ? "warn" : "ok");
  const uncovered = (connection.uncoveredTargets || connection.uncoveredContracts)
    ? '<p class="muted">' + esc(connection.uncoveredTargets || 0) + " target(s), " + esc(connection.uncoveredContracts || 0) + " contract(s) uncovered</p>"
    : "";
  return '<span class="' + cls + '">' + esc(connection.coverageGapCount) + ' gap(s)</span><p class="muted">high ' + esc(high) + ', medium ' + esc(medium) + '</p>' + uncovered;
}

function connectionRisk(connection) {
  if (connection.latestRiskScore == null) return '<span class="muted">not run</span>';
  const severe = connection.latestRiskSeverity === "critical" || connection.latestRiskSeverity === "high" || connection.latestRiskScore >= 50;
  return '<span class="' + (severe ? "bad" : connection.latestRiskScore ? "warn" : "ok") + '">' + esc(connection.latestRiskScore) + '/100</span><p class="muted">' + esc(connection.latestRiskSeverity || "unknown") + '</p>';
}

function connectionAttention(connection) {
  if (!connection.attention?.length) return '<span class="ok">none</span>';
  return list(connection.attention);
}

function connectionTimestamp(value) {
  return value ? '<p class="muted">' + esc(value) + '</p>' : "";
}

function connectionAction(connection) {
  const remove = connection.stored && !snapshot.readOnly ? ' <button class="button connection-remove" data-connection="' + escAttr(connection.id) + '">Remove</button>' : "";
  if (connection.status !== "ready") return '<span class="muted">Not ready</span>';
  if ((snapshot.activeConnectionId || "current") === connection.id) return '<span class="ok">Active</span>' + remove;
  return '<button class="button connection-switch" data-connection="' + escAttr(connection.id) + '">Switch</button>' + remove;
}

function connectionForm() {
  if (snapshot.readOnly) {
    return card("Add repository", '<p class="muted">Read-only mode disables connection changes. Restart without <code>--read-only</code> to add or remove local repositories.</p>');
  }
  return card("Add repository", '<div class="grid">' +
    '<label>Repo path<input id="connection-repo-path" class="text-input" placeholder="C:/path/to/repo" /></label>' +
    '<label>Config path<input id="connection-config-path" class="text-input" value="visual-hive.config.yaml" /></label>' +
    '<label>ID<input id="connection-id" class="text-input" placeholder="optional-stable-id" /></label>' +
    '<label>Label<input id="connection-label" class="text-input" placeholder="Optional label" /></label>' +
    '<label>Tags<input id="connection-tags" class="text-input" placeholder="dogfood,team-a" /></label>' +
    '</div><div class="actions"><button id="connection-add" class="button">Add connection</button><span id="connection-status" class="muted">Only local paths are stored. Secret values are never stored.</span></div>');
}

function artifacts() {
  if (!snapshot.artifacts.length) return empty("No .visual-hive artifacts found.");
  const counts = snapshot.artifacts.reduce((acc, artifact) => {
    acc[artifact.kind] = (acc[artifact.kind] || 0) + 1;
    return acc;
  }, {});
  return '<div class="grid">' +
    metric("Artifacts", snapshot.artifacts.length, "") +
    metric("JSON", counts.json || 0, "") +
    metric("Images", counts.image || 0, "") +
    metric("Redacted previews", snapshot.artifacts.filter(a => a.previewRedacted).length, snapshot.artifacts.some(a => a.previewRedacted) ? "warn" : "ok") +
    '</div><div class="section" style="margin-top:14px">' +
    card("Artifact inventory", table(["Path", "Kind", "Bytes", "Labels", "Preview"], snapshot.artifacts.map(a => [focusWrapper("artifact", a.path, link(a.path)), esc(a.kind), String(a.bytes), esc((a.labels || []).join(", ") || "none"), artifactPreview(a)]))) +
    '</div>';
}

function artifactPreview(artifact) {
  if (artifact.kind === "image") return image(artifact.path, "image preview");
  if (!artifact.preview) return '<span class="muted">No safe preview available</span>';
  const flags = [artifact.previewRedacted ? "redacted" : "", artifact.previewTruncated ? "truncated" : ""].filter(Boolean).join(", ");
  return (flags ? '<p class="warn">' + esc(flags) + '</p>' : '') + '<pre>' + esc(artifact.preview) + '</pre>';
}

function providerResultsCard(results) {
  if (!results || !results.length) return card("Provider results", '<p class="muted">No provider results found in the latest report.</p>');
  return card("Provider results", table(["Provider", "Status", "Role", "External", "Artifacts", "Missing env", "Message"], results.map(p => [p.label, p.status, p.deterministicRole, providerExternalPolicy(p), String(p.artifactCount), p.missingEnv?.join(", ") || "none", p.message])));
}

function providerRunResultsCard(report) {
  if (!report) return card("Provider adapter run", '<p class="muted">No provider-results.json found. Run visual-hive providers --mock-results after a deterministic run.</p>');
  return card("Provider adapter run", '<p><b>Source deterministic status:</b> ' + esc(report.deterministicStatus) + '</p><p><b>Artifacts:</b> ' + esc(report.artifactCount) + '</p>' +
    table(["Provider", "Availability", "Result", "Network", "Upload", "Policy", "Operations", "Metadata"], report.providers.map(p => [p.label, p.availability, p.result.status, p.normalized?.networkMode || "unknown", p.normalized?.artifactSummary?.uploadMode || "unknown", providerExternalPolicy(p.result, p.normalized), p.operations.map(o => o.operation + ":" + o.status).join(", "), providerMetadataSummary(p)])));
}

function providerExternalPolicy(provider, normalized) {
  const policy = normalized?.costPolicy;
  const allowed = provider.externalUploadAllowed ?? policy?.externalUploadAllowed;
  if (provider.providerId === "playwright") return "local";
  if (allowed === true) return "allowed";
  if (allowed === false) {
    const reasons = provider.externalUploadBlockedReasons || policy?.blockedReasons || [];
    return "blocked" + (reasons.length ? ": " + reasons.join(" ") : "");
  }
  return "n/a";
}

function providerMetadataSummary(provider) {
  const normalized = provider.normalized;
  if (!normalized) return provider.warnings.join("; ") || "none";
  if (normalized.githubChecks) return "GitHub check: " + normalized.githubChecks.checkName + " / " + normalized.githubChecks.conclusion;
  if (normalized.storybook) return "Storybook: " + normalized.storybook.mode + " / " + normalized.storybook.recommendedCommand;
  if (normalized.hostedVisual) return "Hosted: " + normalized.hostedVisual.provider + " / " + (normalized.hostedVisual.projectId || "no project id");
  return normalized.notes?.join("; ") || "none";
}

function baselineCardBody(s) {
  return '<p><b>Status:</b> ' + esc(s.status) + ' <b>Route:</b> ' + esc(s.route) + ' <b>Viewport:</b> ' + esc(s.viewport) + '</p>' +
    baselineDecisionStatus(s) +
    table(["Field", "Value", "Copy"], [
      ["Diff ratio", esc(s.actualDiffPixelRatio ?? "n/a") + " / " + esc(s.maxDiffPixelRatio ?? "n/a"), copyButton(String(s.actualDiffPixelRatio ?? "n/a"), "diff ratio")],
      ["Diff pixels", esc(s.actualDiffPixels ?? "n/a"), copyButton(String(s.actualDiffPixels ?? "n/a"), "diff pixels")],
      ["Baseline path", link(s.baselinePath, s.baselinePath), copyButton(s.baselinePath, "baseline path")],
      ["Actual path", link(s.actualPath, s.actualPath), copyButton(s.actualPath, "actual path")],
      ["Diff path", s.diffPath ? link(s.diffPath, s.diffPath) : '<span class="muted">No diff artifact</span>', s.diffPath ? copyButton(s.diffPath, "diff path") : ""]
    ]) +
    '<div class="image-row">' + image(s.baselinePath, "baseline") + image(s.actualPath, "actual") + image(s.diffPath, "diff") + '</div>' +
    baselineActions(s);
}

function copyButton(value, label) {
  if (!value) return "";
  return '<button class="button copy-button" data-copy="' + escAttr(value) + '" title="Copy ' + escAttr(label) + '">Copy</button>';
}

function baselineActions(s) {
  if (snapshot.readOnly) return '<div class="actions"><button class="button" disabled>Read-only mode</button></div>';
  if (!s.canApprove && !s.canReject) return '<div class="actions"><button class="button" disabled>No review action needed</button></div>';
  return '<div class="actions">' +
    (s.canApprove ? '<button class="button baseline-approve" data-contract="' + escAttr(s.contractId) + '" data-name="' + escAttr(s.name) + '" data-viewport="' + escAttr(s.viewport) + '" data-route="' + escAttr(s.route) + '">Approve actual as baseline</button>' : '') +
    (s.canReject ? '<button class="button baseline-reject" data-contract="' + escAttr(s.contractId) + '" data-name="' + escAttr(s.name) + '" data-viewport="' + escAttr(s.viewport) + '" data-route="' + escAttr(s.route) + '">Reject screenshot</button>' : '') +
    '</div>';
}

function baselineDecisionStatus(s) {
  if (s.approvedAt) return '<p><span class="ok">Approved ' + esc(s.approvedAt) + '</span></p>';
  if (s.rejectedAt) return '<p><span class="bad">Rejected ' + esc(s.rejectedAt) + '</span>' + (s.rejectionReason ? '<br><span class="muted">' + esc(s.rejectionReason) + '</span>' : '') + '</p>';
  return '<p><span class="muted">Not reviewed in this repo</span></p>';
}

function wireActions() {
  document.querySelectorAll(".baseline-approve").forEach((button) => button.addEventListener("click", async () => {
    button.disabled = true;
    button.textContent = "Approving...";
    const response = await fetch(apiUrl("/api/baseline/approve"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contractId: button.dataset.contract,
        screenshotName: button.dataset.name,
        viewport: button.dataset.viewport,
        route: button.dataset.route
      })
    });
    if (!response.ok) {
      const text = await response.text();
      button.textContent = "Approval failed";
      alert(text);
      return;
    }
    snapshot = await fetch(apiUrl("/api/snapshot")).then(r => r.json());
    render();
  }));
  document.querySelectorAll(".baseline-reject").forEach((button) => button.addEventListener("click", async () => {
    const reason = prompt("Why is this screenshot not an approved baseline?", "Visual change is not approved");
    if (reason === null) return;
    button.disabled = true;
    button.textContent = "Rejecting...";
    const response = await fetch(apiUrl("/api/baseline/reject"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contractId: button.dataset.contract,
        screenshotName: button.dataset.name,
        viewport: button.dataset.viewport,
        route: button.dataset.route,
        reason
      })
    });
    if (!response.ok) {
      const text = await response.text();
      button.textContent = "Reject failed";
      alert(text);
      return;
    }
    snapshot = await fetch(apiUrl("/api/snapshot")).then(r => r.json());
    render();
  }));
  const validate = document.querySelector("#config-validate");
  const save = document.querySelector("#config-save");
  if (validate) validate.addEventListener("click", () => validateConfigDraft(false));
  if (save) save.addEventListener("click", () => validateConfigDraft(true));
  const setupWrite = document.querySelector("#setup-write-config");
  if (setupWrite) setupWrite.addEventListener("click", () => writeRecommendedConfig());
  const setupWriteDocs = document.querySelector("#setup-write-docs");
  if (setupWriteDocs) setupWriteDocs.addEventListener("click", () => writeRecommendedDocs(false));
  const setupOverwriteDocs = document.querySelector("#setup-overwrite-docs");
  if (setupOverwriteDocs) setupOverwriteDocs.addEventListener("click", () => writeRecommendedDocs(true));
  const setupWriteBundle = document.querySelector("#setup-write-bundle");
  if (setupWriteBundle) setupWriteBundle.addEventListener("click", () => writeSetupBundle(false));
  const setupOverwriteBundle = document.querySelector("#setup-overwrite-bundle");
  if (setupOverwriteBundle) setupOverwriteBundle.addEventListener("click", () => writeSetupBundle(true));
  const workflowWriteAll = document.querySelector("#workflow-write-all");
  if (workflowWriteAll) workflowWriteAll.addEventListener("click", () => writeWorkflowTemplates(false));
  const workflowOverwriteAll = document.querySelector("#workflow-overwrite-all");
  if (workflowOverwriteAll) workflowOverwriteAll.addEventListener("click", () => writeWorkflowTemplates(true));
  document.querySelectorAll(".workflow-write-one").forEach((button) => button.addEventListener("click", () => writeWorkflowTemplates(false, [button.dataset.template])));
  document.querySelectorAll(".copy-button").forEach((button) => button.addEventListener("click", async () => {
    const value = button.dataset.copy || "";
    await copyText(value);
    const original = button.textContent;
    button.textContent = "Copied";
    setTimeout(() => { button.textContent = original || "Copy"; }, 1200);
  }));
  document.querySelectorAll(".runbook-execute").forEach((button) => button.addEventListener("click", async () => {
    const commandId = button.dataset.command;
    if (!commandId) return;
    if (!confirm("Run Visual Hive command " + commandId + " locally? This executes the selected repository's configured commands when the runbook command requires it.")) return;
    button.disabled = true;
    const original = button.textContent;
    button.textContent = "Running...";
    const response = await fetch(apiUrl("/api/runbook/execute"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commandId })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.execution?.status === "failed") {
      button.textContent = "Failed";
      alert(payload.execution?.message || payload.error || "Runbook command failed.");
      snapshot = await fetch(apiUrl("/api/snapshot")).then(r => r.json());
      active = "actions";
      render();
      return;
    }
    button.textContent = "Done";
    snapshot = await fetch(apiUrl("/api/snapshot")).then(r => r.json());
    active = "actions";
    setTimeout(() => { button.textContent = original || "Run"; render(); }, 800);
  }));
  document.querySelectorAll(".contract-filter").forEach((select) => select.addEventListener("change", () => {
    const key = select.dataset.filter;
    if (key) contractFilters[key] = select.value || "all";
    render();
  }));
  document.querySelectorAll(".risk-nav").forEach((button) => button.addEventListener("click", () => {
    active = button.dataset.tab || active;
    if (button.dataset.contract) {
      contractFilters = { contract: button.dataset.contract, target: "all", severity: "all", prSafe: "all", status: "all", route: "all", viewport: "all" };
      focusKind = "contract";
      focusValue = button.dataset.contract;
    } else if (button.dataset.target) {
      focusKind = "target";
      focusValue = button.dataset.target;
    } else if (button.dataset.artifact) {
      focusKind = "artifact";
      focusValue = button.dataset.artifact;
    } else {
      focusKind = "";
      focusValue = "";
    }
    render();
  }));
  document.querySelectorAll(".connection-switch").forEach((button) => button.addEventListener("click", async () => {
    activeConnectionId = button.dataset.connection || "current";
    window.history.replaceState(null, "", activeConnectionId === "current" ? window.location.pathname : "?connection=" + encodeURIComponent(activeConnectionId));
    snapshot = await fetch(apiUrl("/api/snapshot")).then(r => r.json());
    active = "overview";
    render();
  }));
  document.querySelectorAll(".connection-remove").forEach((button) => button.addEventListener("click", async () => {
    const id = button.dataset.connection;
    if (!id || !confirm("Remove connection " + id + "?")) return;
    button.disabled = true;
    const response = await fetch("/api/connections/remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id })
    });
    if (!response.ok) {
      alert(await response.text());
      button.disabled = false;
      return;
    }
    if (activeConnectionId === id) {
      activeConnectionId = "current";
      window.history.replaceState(null, "", window.location.pathname);
    }
    snapshot = await fetch(apiUrl("/api/snapshot")).then(r => r.json());
    render();
  }));
  const addConnection = document.querySelector("#connection-add");
  if (addConnection) addConnection.addEventListener("click", async () => {
    const status = document.querySelector("#connection-status");
    const repoPath = document.querySelector("#connection-repo-path")?.value || "";
    const configPath = document.querySelector("#connection-config-path")?.value || "visual-hive.config.yaml";
    const id = document.querySelector("#connection-id")?.value || "";
    const label = document.querySelector("#connection-label")?.value || "";
    const tags = document.querySelector("#connection-tags")?.value || "";
    if (!repoPath.trim()) {
      if (status) {
        status.className = "bad";
        status.textContent = "Repo path is required.";
      }
      return;
    }
    addConnection.disabled = true;
    if (status) {
      status.className = "muted";
      status.textContent = "Adding connection...";
    }
    const response = await fetch("/api/connections/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repoPath, configPath, id, label, tags })
    });
    const text = await response.text();
    if (!response.ok) {
      if (status) {
        status.className = "bad";
        status.textContent = text;
      }
      addConnection.disabled = false;
      return;
    }
    snapshot = await fetch(apiUrl("/api/snapshot")).then(r => r.json());
    render();
  });
}

async function writeWorkflowTemplates(force, templateIds) {
  const status = document.querySelector("#workflow-template-status");
  if (!status) return;
  const label = templateIds && templateIds.length ? "selected workflow template" : "all Visual Hive workflow templates";
  const promptText = force
    ? "Overwrite " + label + " after reviewing the snippets on this page?"
    : "Write " + label + " without overwriting existing files?";
  if (!confirm(promptText)) return;
  status.className = "muted";
  status.textContent = force ? "Writing workflow templates with overwrite enabled..." : "Writing workflow templates...";
  const response = await fetch(apiUrl("/api/workflows/write-templates"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirm: true, force, templateIds: (templateIds || []).filter(Boolean) })
  });
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = { error: text }; }
  if (!response.ok || payload.ok === false) {
    status.className = "bad";
    status.textContent = payload.error || "Workflow template write failed.";
    return;
  }
  status.className = "ok";
  status.textContent = "Wrote " + payload.written.length + " workflow template(s). Audit: " + payload.auditPath;
  snapshot = await fetch(apiUrl("/api/snapshot")).then(r => r.json());
  render();
}

async function writeRecommendedConfig() {
  const button = document.querySelector("#setup-write-config");
  const status = document.querySelector("#setup-action-status");
  if (!button || !status) return;
  const force = button.dataset.force === "true";
  const promptText = force
    ? "Overwrite the existing Visual Hive config with the recommended YAML after reviewing it on this page?"
    : "Write the recommended Visual Hive config after reviewing the generated YAML on this page?";
  if (!confirm(promptText)) return;
  button.disabled = true;
  status.className = "muted";
  status.textContent = force ? "Overwriting recommended config..." : "Writing recommended config...";
  const response = await fetch(apiUrl("/api/setup/write-config"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirm: true, force })
  });
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = { error: text }; }
  if (!response.ok || payload.ok === false) {
    status.className = "bad";
    status.textContent = payload.error || "Recommended config write failed.";
    button.disabled = false;
    return;
  }
  status.className = "ok";
  status.textContent = "Config written. Audit: " + payload.auditPath;
  snapshot = await fetch(apiUrl("/api/snapshot")).then(r => r.json());
  render();
}

async function writeRecommendedDocs(force) {
  const status = document.querySelector("#setup-docs-status");
  const buttons = [document.querySelector("#setup-write-docs"), document.querySelector("#setup-overwrite-docs")].filter(Boolean);
  if (!status) return;
  const promptText = force
    ? "Overwrite docs/visual-hive.md with generated setup docs after reviewing the recommendation on this page?"
    : "Write docs/visual-hive.md from the setup recommendation without overwriting existing docs?";
  if (!confirm(promptText)) return;
  buttons.forEach((button) => { button.disabled = true; });
  status.className = "muted";
  status.textContent = force ? "Overwriting setup docs..." : "Writing setup docs...";
  const response = await fetch(apiUrl("/api/setup/write-docs"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirm: true, force })
  });
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = { error: text }; }
  if (!response.ok || payload.ok === false) {
    status.className = "bad";
    status.textContent = payload.error || "Setup docs write failed.";
    buttons.forEach((button) => { button.disabled = false; });
    return;
  }
  status.className = "ok";
  status.textContent = "Docs written to " + payload.docsPath + ". Audit: " + payload.auditPath;
  snapshot = await fetch(apiUrl("/api/snapshot")).then(r => r.json());
  render();
}

async function writeSetupBundle(force) {
  const status = document.querySelector("#setup-bundle-status");
  const buttons = [document.querySelector("#setup-write-bundle"), document.querySelector("#setup-overwrite-bundle")].filter(Boolean);
  if (!status) return;
  const promptText = force
    ? "Overwrite config, docs, and Visual Hive workflow templates after reviewing the generated setup bundle?"
    : "Write config, docs, and Visual Hive workflow templates for a setup PR without overwriting existing files?";
  if (!confirm(promptText)) return;
  buttons.forEach((button) => { button.disabled = true; });
  status.className = "muted";
  status.textContent = force ? "Overwriting setup PR bundle..." : "Writing setup PR bundle...";
  const response = await fetch(apiUrl("/api/setup/write-bundle"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirm: true, force })
  });
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = { error: text }; }
  if (!response.ok || payload.ok === false) {
    status.className = "bad";
    status.textContent = payload.error || "Setup bundle write failed.";
    buttons.forEach((button) => { button.disabled = false; });
    return;
  }
  status.className = "ok";
  status.textContent = "Setup PR bundle written. Audit: " + payload.auditPath;
  snapshot = await fetch(apiUrl("/api/snapshot")).then(r => r.json());
  render();
}

async function validateConfigDraft(saveAfterValidation) {
  const editor = document.querySelector("#config-editor");
  const status = document.querySelector("#config-editor-status");
  if (!editor || !status) return;
  if (saveAfterValidation && !confirm("Save this Visual Hive config after reviewing the diff?")) return;
  status.textContent = saveAfterValidation ? "Validating before save..." : "Validating...";
  const response = await fetch(apiUrl(saveAfterValidation ? "/api/config/save" : "/api/config/validate"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: editor.value, confirm: saveAfterValidation })
  });
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = { error: text }; }
  if (!response.ok || payload.ok === false) {
    status.className = "bad";
    status.textContent = (payload.error || "Config validation failed.") + "\\n\\n" + (payload.diff || "");
    return;
  }
  status.className = "ok";
  status.textContent = (saveAfterValidation ? "Saved config. Audit: " + payload.auditPath : "Config is valid. Review diff before saving.") + "\\n\\n" + payload.diff;
  if (saveAfterValidation) {
    snapshot = await fetch(apiUrl("/api/snapshot")).then(r => r.json());
  }
}

function metric(label, value, cls) { return '<div class="card"><h3>' + esc(label) + '</h3><div class="metric ' + esc(cls) + '">' + esc(value) + '</div></div>'; }
function card(title, body) { return '<section class="card"><h2>' + esc(title) + '</h2>' + body + '</section>'; }
function empty(text) { return '<div class="empty">' + esc(text) + '</div>'; }
function list(items) { return '<ul>' + items.map(item => '<li>' + esc(item) + '</li>').join("") + '</ul>'; }
function yes(value) { return value ? '<span class="ok">available</span>' : '<span class="muted">missing</span>'; }
function preview(title, text) { return text ? card(title, '<pre>' + esc(text) + '</pre>') : ""; }
function failureList(title, items) { return items && items.length ? '<h3>' + esc(title) + '</h3>' + list(items) : ""; }
function table(headers, rows) { return '<table><thead><tr>' + headers.map(h => '<th>' + esc(h) + '</th>').join("") + '</tr></thead><tbody>' + rows.map(row => '<tr>' + row.map(cell => '<td>' + cell + '</td>').join("") + '</tr>').join("") + '</tbody></table>'; }
function rel(path) { if (!path) return ""; const root = snapshot.repoRoot.replaceAll('\\\\', '/'); const value = String(path).replaceAll('\\\\', '/'); return value.startsWith(root) ? value.slice(root.length + 1) : value; }
function escAttr(value) { return esc(value).replaceAll('"', "&quot;"); }

function focusKey(kind, value) {
  return kind + ":" + String(value ?? "");
}

function focusWrapper(kind, value, html) {
  const key = focusKey(kind, value);
  const cls = focusKind === kind && focusValue === String(value ?? "") ? "focus-hit" : "";
  return '<span data-focus-key="' + escAttr(key) + '" class="' + cls + '">' + html + '</span>';
}

function scrollToFocusedElement() {
  if (!focusKind || !focusValue) return;
  const key = focusKey(focusKind, focusValue);
  const element = [...document.querySelectorAll("[data-focus-key]")].find((candidate) => candidate.dataset.focusKey === key);
  if (element) element.scrollIntoView({ block: "center", behavior: "smooth" });
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Browser automation and some local contexts deny clipboard writes.
      // Fall back to the textarea path without surfacing noisy console errors.
    }
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  } catch {
    // Copy is a convenience action; failed clipboard permission should not
    // degrade Control Plane health or deterministic QA evidence.
  }
}

fetch(apiUrl("/api/snapshot")).then(r => r.json()).then(data => { snapshot = data; render(); }).catch(error => { app.innerHTML = '<pre>' + esc(error.stack || error.message) + '</pre>'; });
`;
