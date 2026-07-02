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
  if (!snapshot.providerHandoff || snapshot.providerHandoff.externalCallsMade !== 0) {
    throw new Error("snapshot did not include no-network provider handoff evidence");
  }
  if (!snapshot.mutationReport || typeof snapshot.mutationReport.score !== "number") {
    throw new Error("snapshot did not include mutation score evidence");
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
  if (!snapshot.handoffPacket || snapshot.handoffPacket.externalCallsMade !== 0) {
    throw new Error("snapshot did not include no-network Hive handoff packet evidence");
  }
  if (!snapshot.agentPacket?.budgets || snapshot.agentPacket.budgets.allowExternalNetwork !== false) {
    throw new Error("snapshot did not include bounded Agent Packet evidence");
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
    "What should I do next?",
    "Run PR-safe checks",
    "Review visual changes",
    "Evidence to agent handoff",
    "Refresh handoff packet",
    "Visual Hive owns the verdict",
    "Test creation plan",
    "Advisory no-write",
    "Expert console",
    "Failure Inbox",
    "Baselines",
    "Providers",
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
