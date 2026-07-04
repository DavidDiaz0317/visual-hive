#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const targetRoot = path.resolve(repoRoot, args.root ?? path.join("examples", "demo-react-app"));
const profile = args.profile ?? (targetRoot.endsWith(path.join("examples", "demo-react-app")) ? "demo" : "general");
const evidenceCatalog = await loadEvidenceResourceCatalog();

const coreTriageResources = [
  resourceFromCatalog("triage-report"),
  resourceFromCatalog("issue-body"),
  resourceFromCatalog("pr-comment"),
  resourceFromCatalog("triage-prompt"),
  resourceFromCatalog("missing-tests")
];

const optionalTriageResources = [
  resourceFromCatalog("repair-prompt")
];

const supportResources = [
  resourceFromCatalog("context-ledger"),
  resourceFromCatalog("control-plane-snapshot"),
  resourceFromCatalog("artifacts-index"),
  resourceFromCatalog("repo-map"),
  resourceFromCatalog("repo-context"),
  resourceFromCatalog("pipeline-status"),
  resourceFromCatalog("run-history"),
  resourceFromCatalog("schema-catalog"),
  resourceFromCatalog("mcp-manifest"),
  resourceFromCatalog("agent-packet"),
  resourceFromCatalog("handoff-agent-packet"),
  resourceFromCatalog("provider-agent-packet"),
  resourceFromCatalog("provider-results"),
  resourceFromCatalog("provider-upload-argos-manifest")
];

const triageResources = [
  ...coreTriageResources,
  ...(await exists(optionalTriageResources[0].artifactPath) ? optionalTriageResources : [])
];

const artifactIndex = await readJson(".visual-hive/artifacts-index.json");
assert(Array.isArray(artifactIndex.artifacts), "artifacts-index.json contains an artifacts array");

const contextLedger = await readOptionalJson(".visual-hive/context-ledger.json");
const snapshot = await readOptionalJson(".visual-hive/control-plane-snapshot.json");
const mcpManifest = await readOptionalJson(".visual-hive/mcp-manifest.json");
const agentPacket = await readOptionalJson(".visual-hive/agent-packet.json");
const handoffAgentPacket = await readOptionalJson(".visual-hive/handoff-agent-packet.json");
const providerAgentPacket = await readOptionalJson(".visual-hive/provider-agent-packet.json");
const hiveExport = await readOptionalJson(".visual-hive/hive/hive-export.json");
const planLanes = await readOptionalJson(".visual-hive/plans.json");
const runHistory = await readOptionalJson(".visual-hive/history.json");
const testingLayers = await readOptionalJson(".visual-hive/testing-layers.json");
const workflowAudit = await readOptionalJson(".visual-hive/workflows.json");
const readinessGate = await readOptionalJson(".visual-hive/readiness.json");
const triageReport = await readOptionalJson(".visual-hive/triage.json");

checkGenericArtifactIndex(artifactIndex);
if (contextLedger) checkGenericContextLedger(contextLedger, artifactIndex);
if (snapshot) checkGenericSnapshot(snapshot, artifactIndex);
if (mcpManifest) checkGenericMcpManifest(mcpManifest, artifactIndex);
if (hiveExport) checkGenericHiveExport(hiveExport, artifactIndex);
if (planLanes?.outputResource) checkOutputResource(planLanes.outputResource, "Plan lane summary outputResource", artifactIndex);
if (runHistory?.outputResource) checkOutputResource(runHistory.outputResource, "Run history outputResource", artifactIndex);
if (testingLayers?.outputResource) checkOutputResource(testingLayers.outputResource, "Testing layers outputResource", artifactIndex);
if (workflowAudit?.outputResource) checkOutputResource(workflowAudit.outputResource, "Workflow audit outputResource", artifactIndex);
if (readinessGate?.outputResource) checkOutputResource(readinessGate.outputResource, "Readiness gate outputResource", artifactIndex);
if (triageReport?.outputResource) checkOutputResource(triageReport.outputResource, "Triage report outputResource", artifactIndex);
for (const packet of [agentPacket, handoffAgentPacket, providerAgentPacket].filter(Boolean)) {
  checkGenericAgentPacket(packet, artifactIndex);
}

if (profile === "demo") {
  assert(contextLedger?.schemaVersion === "visual-hive.context-ledger.v1", "context-ledger.json has the expected schema version");
  assert(snapshot?.schemaVersion === 1, "control-plane-snapshot.json has the expected schema version");
  assert(Array.isArray(mcpManifest?.resources), "mcp-manifest.json contains a resources array");
  checkContextLedger(contextLedger, triageResources);
  checkSnapshot(snapshot, [...triageResources, ...supportResources]);
  checkArtifactIndex(artifactIndex, [...triageResources, ...supportResources]);
  checkMcpManifest(mcpManifest, [...triageResources, ...supportResources]);
  checkAgentPacket(agentPacket, [triageResources[0], byId("triage-prompt"), byId("repair-prompt"), byId("missing-tests")].filter(Boolean));
  checkAgentPacket(handoffAgentPacket, [byId("triage-report"), byId("issue-body"), byId("pr-comment"), byId("missing-tests")].filter(Boolean));
  checkAgentPacket(providerAgentPacket, [byId("provider-results"), byId("provider-upload-argos-manifest")].filter(Boolean));
}

console.log(
  `Visual Hive ${profile} evidence-resource consistency passed for ${path.relative(repoRoot, targetRoot) || "."} (${catalogBackedArtifacts(artifactIndex).length} catalog-backed artifacts).`
);

function checkGenericArtifactIndex(index) {
  for (const artifact of catalogBackedArtifacts(index)) {
    assertResourceShape(artifact, `Artifact index ${artifact.path}`);
    assert(artifact.labels?.includes("evidence-resource"), `Artifact index labels ${artifact.evidenceResourceId} as evidence-resource`);
    if (artifact.schemaPath) {
      assert(normalizePath(artifact.schemaPath).startsWith("schemas/"), `Artifact index ${artifact.path} has a repo schema path`);
    }
  }
}

function checkGenericContextLedger(ledger, index) {
  assert(ledger.schemaVersion === "visual-hive.context-ledger.v1", "context-ledger.json has the expected schema version");
  assert(Array.isArray(ledger.toolCalls), "context-ledger.json exposes toolCalls[]");
  for (const toolCall of ledger.toolCalls) {
    if (toolCall.evidenceResourceId || toolCall.evidenceResourceUri) {
      assertCompatibilityResourceShape(toolCall, `Context Ledger toolCall[${toolCall.id ?? "unknown"}]`);
      checkAgainstArtifactIndex(toolCall, index, `Context Ledger toolCall[${toolCall.id ?? "unknown"}]`);
    }
    for (const linkedResource of toolCall.evidenceResources ?? []) {
      assertResourceShape(linkedResource, `Context Ledger toolCall[${toolCall.id ?? "unknown"}].evidenceResources[]`);
      checkAgainstArtifactIndex(linkedResource, index, `Context Ledger toolCall[${toolCall.id ?? "unknown"}].evidenceResources[]`);
    }
  }
}

function checkGenericSnapshot(controlPlaneSnapshot, index) {
  assert(controlPlaneSnapshot.schemaVersion === 1, "control-plane-snapshot.json has the expected schema version");
  for (const artifact of controlPlaneSnapshot.artifacts ?? []) {
    if (!artifact.evidenceResourceId && !artifact.evidenceResourceUri) continue;
    assertResourceShape(artifact, `Control Plane snapshot artifact[${artifact.path ?? artifact.artifactPath ?? "unknown"}]`);
    checkAgainstArtifactIndex(artifact, index, `Control Plane snapshot artifact[${artifact.evidenceResourceId}]`);
  }
  for (const toolCall of controlPlaneSnapshot.contextLedger?.toolCalls ?? []) {
    for (const linkedResource of toolCall.evidenceResources ?? []) {
      assertResourceShape(linkedResource, `Control Plane snapshot toolCall[${toolCall.id ?? "unknown"}].evidenceResources[]`);
      checkAgainstArtifactIndex(linkedResource, index, `Control Plane snapshot toolCall[${toolCall.id ?? "unknown"}].evidenceResources[]`);
    }
  }
}

function checkGenericMcpManifest(manifest, index) {
  assert(Array.isArray(manifest.resources), "mcp-manifest.json contains a resources array");
  const indexedById = new Map(catalogBackedArtifacts(index).map((artifact) => [artifact.evidenceResourceId, artifact]));
  for (const mcpResource of manifest.resources) {
    assert(mcpResource.id, "MCP manifest resource has an id");
    assert(isVisualHiveUri(mcpResource.uri), `MCP manifest ${mcpResource.id} has a visual-hive URI`);
    assert(mcpResource.relativePath, `MCP manifest ${mcpResource.id} has a relativePath`);
    if (mcpResource.readToolName) {
      assert(isVisualHiveReadTool(mcpResource.readToolName), `MCP manifest ${mcpResource.id} has a Visual Hive read tool name`);
    }
    const indexed = indexedById.get(mcpResource.id);
    if (indexed) {
      assert(indexed.evidenceResourceUri === mcpResource.uri, `MCP manifest ${mcpResource.id} URI matches artifact index`);
      assert(pathMatches(indexed.path, mcpResource.relativePath), `MCP manifest ${mcpResource.id} path matches artifact index`);
      if (indexed.evidenceReadToolName || mcpResource.readToolName) {
        assert(indexed.evidenceReadToolName === mcpResource.readToolName, `MCP manifest ${mcpResource.id} read tool matches artifact index`);
      }
    }
  }
}

function checkGenericHiveExport(exportBundle, index) {
  assert(exportBundle.schemaVersion === "visual-hive.hive-export.v1", "hive-export.json has the expected schema version");
  assert(Array.isArray(exportBundle.outputResources), "hive-export.json exposes outputResources[]");
  for (const outputResource of exportBundle.outputResources) {
    assertResourceShape(outputResource, `Hive export outputResources[${outputResource.artifactKey ?? "unknown"}]`);
    checkAgainstArtifactIndex(outputResource, index, `Hive export outputResources[${outputResource.evidenceResourceId}]`);
  }
}

function checkGenericAgentPacket(packet, index) {
  assert(packet?.schemaVersion === "visual-hive.agent-packet.v1", `Agent Packet ${packet?.profile ?? "unknown"} has expected schema version`);
  assert(Array.isArray(packet.allowedTools), `Agent Packet ${packet.profile} exposes allowed tools`);
  for (const tool of packet.allowedTools) {
    if (!tool.evidenceResourceId && !tool.evidenceResourceUri && !tool.evidenceReadToolName) continue;
    assertResourceShape(tool, `Agent Packet ${packet.profile} allowedTools[]`);
    checkAgainstArtifactIndex(tool, index, `Agent Packet ${packet.profile} tool[${tool.evidenceResourceId}]`);
  }
}

function checkOutputResource(outputResource, label, index) {
  assertResourceShape(outputResource, label);
  checkAgainstArtifactIndex(outputResource, index, label);
}

function checkAgainstArtifactIndex(resourceLike, index, label) {
  const artifactPath = resourceLike.artifactPath ?? resourceLike.relativePath ?? resourceLike.path;
  const indexed = catalogBackedArtifacts(index).find(
    (artifact) =>
      artifact.evidenceResourceId === resourceLike.evidenceResourceId ||
      artifact.evidenceResourceUri === resourceLike.evidenceResourceUri ||
      pathMatches(artifact.path, artifactPath)
  );
  if (!indexed) return;
  if (resourceLike.evidenceResourceId) {
    assert(indexed.evidenceResourceId === resourceLike.evidenceResourceId, `${label} resource ID matches artifact index`);
  }
  if (resourceLike.evidenceResourceUri) {
    assert(indexed.evidenceResourceUri === resourceLike.evidenceResourceUri, `${label} URI matches artifact index`);
  }
  if (artifactPath) {
    assert(pathMatches(indexed.path, artifactPath), `${label} path matches artifact index`);
  }
  const readToolName = resourceLike.evidenceReadToolName ?? resourceLike.readToolName;
  if (readToolName || indexed.evidenceReadToolName) {
    assert(indexed.evidenceReadToolName === readToolName, `${label} read tool matches artifact index`);
  }
}

function assertCompatibilityResourceShape(actual, label) {
  assert(actual.evidenceResourceId || actual.id, `${label} has a resource ID`);
  assert(isVisualHiveUri(actual.evidenceResourceUri ?? actual.uri), `${label} has a visual-hive URI`);
}

function assertResourceShape(actual, label) {
  assert(actual.evidenceResourceId || actual.id, `${label} has a resource ID`);
  assert(isVisualHiveUri(actual.evidenceResourceUri ?? actual.uri), `${label} has a visual-hive URI`);
  assert(actual.artifactPath ?? actual.relativePath ?? actual.path, `${label} has an artifact path`);
  if (actual.evidenceResourceTitle !== undefined) {
    assert(String(actual.evidenceResourceTitle).trim().length > 0, `${label} has a resource title`);
  }
  if (actual.evidenceResourceDescription !== undefined) {
    assert(String(actual.evidenceResourceDescription).trim().length > 0, `${label} has a resource description`);
  }
  const readToolName = actual.evidenceReadToolName ?? actual.readToolName;
  if (readToolName !== undefined) {
    assert(isVisualHiveReadTool(readToolName), `${label} has a Visual Hive read tool`);
  }
}

function checkContextLedger(ledger, expectedResources) {
  const triageCall = findToolCall(ledger, "triage");
  assert(triageCall, "Context Ledger includes the triage tool call");
  assert(triageCall.evidenceResourceId === "triage-report", "triage tool call keeps triage-report as compatibility resource ID");
  assert(triageCall.evidenceResourceUri === "visual-hive://triage-report", "triage tool call keeps triage-report as compatibility URI");
  assert(Array.isArray(triageCall.evidenceResources), "triage tool call exposes evidenceResources[]");
  for (const expected of expectedResources) {
    const actual = triageCall.evidenceResources.find((entry) => entry.evidenceResourceId === expected.id);
    assert(actual, `triage tool call links ${expected.id}`);
    assertResource(actual, expected, `Context Ledger triage evidenceResources[${expected.id}]`);
  }
}

function checkSnapshot(controlPlaneSnapshot, expectedResources) {
  const triageCall = findToolCall(controlPlaneSnapshot.contextLedger, "triage");
  assert(triageCall?.evidenceResources?.length, "Control Plane snapshot preserves Context Ledger linked evidence resources");
  for (const expected of triageResources) {
    const actual = triageCall.evidenceResources.find((entry) => entry.evidenceResourceId === expected.id);
    assert(actual, `Control Plane snapshot triage call links ${expected.id}`);
    assertResource(actual, expected, `Control Plane snapshot triage evidenceResources[${expected.id}]`);
  }
  const artifacts = controlPlaneSnapshot.artifacts ?? [];
  for (const expected of expectedResources) {
    const actual = artifacts.find((entry) => pathMatches(entry.path, expected.artifactPath));
    assert(actual, `Control Plane snapshot artifact list includes ${expected.artifactPath}`);
    assertResource(actual, expected, `Control Plane snapshot artifact[${expected.id}]`);
  }
}

function checkArtifactIndex(index, expectedResources) {
  for (const expected of expectedResources) {
    if (expected.id === "artifacts-index") {
      continue;
    }
    const actual = index.artifacts.find((entry) => pathMatches(entry.path, expected.artifactPath));
    assert(actual, `Artifact index includes ${expected.artifactPath}`);
    assertResource(actual, expected, `Artifact index artifact[${expected.id}]`);
    assert(actual.labels?.includes("evidence-resource"), `Artifact index labels ${expected.id} as evidence-resource`);
  }
}

function checkMcpManifest(manifest, expectedResources) {
  for (const expected of expectedResources) {
    const actual = manifest.resources.find((entry) => entry.id === expected.id);
    assert(actual, `MCP manifest includes ${expected.id}`);
    assert(actual.uri === expected.uri, `MCP manifest ${expected.id} URI matches catalog`);
    assert(normalizePath(actual.relativePath) === normalizePath(expected.artifactPath), `MCP manifest ${expected.id} path matches catalog`);
    assert(actual.readToolName === expected.readToolName, `MCP manifest ${expected.id} read tool matches catalog`);
  }
}

function checkAgentPacket(packet, expectedResources) {
  assert(packet?.schemaVersion === "visual-hive.agent-packet.v1", `Agent Packet ${packet?.profile ?? "unknown"} has expected schema version`);
  assert(Array.isArray(packet.allowedTools), `Agent Packet ${packet.profile} exposes allowed tools`);
  for (const expected of expectedResources) {
    const actual = packet.allowedTools.find(
      (tool) => tool.evidenceResourceId === expected.id || tool.evidenceReadToolName === expected.readToolName
    );
    assert(actual, `Agent Packet ${packet.profile} includes ${expected.id}`);
    assertResource(actual, expected, `Agent Packet ${packet.profile} tool[${expected.id}]`);
  }
}

function assertResource(actual, expected, label) {
  assert(actual.evidenceResourceId === expected.id, `${label} has resource ID ${expected.id}`);
  assert(actual.evidenceResourceUri === expected.uri, `${label} has URI ${expected.uri}`);
  assert(pathMatches(actual.artifactPath ?? actual.relativePath ?? actual.path, expected.artifactPath), `${label} has artifact path ${expected.artifactPath}`);
  assert(actual.evidenceReadToolName === expected.readToolName || actual.readToolName === expected.readToolName, `${label} has read tool ${expected.readToolName}`);
}

function findToolCall(source, id) {
  return source?.toolCalls?.find((toolCall) => toolCall.id === id);
}

function byId(id) {
  return [...triageResources, ...supportResources].find((entry) => entry.id === id);
}

function resourceFromCatalog(id) {
  const definition = evidenceCatalog.find((entry) => entry.id === id);
  assert(definition, `Core evidence-resource catalog contains ${id}`);
  assert(definition.readTool?.name, `Core evidence-resource catalog ${id} has a read tool`);
  return {
    id: definition.id,
    uri: definition.uri,
    artifactPath: definition.relativePath,
    readToolName: definition.readTool.name
  };
}

function catalogBackedArtifacts(index) {
  return (index.artifacts ?? []).filter((entry) => entry.evidenceResourceId || entry.evidenceResourceUri);
}

async function readJson(relativePath) {
  const absolutePath = path.join(targetRoot, relativePath);
  try {
    return JSON.parse(await readFile(absolutePath, "utf8"));
  } catch (error) {
    throw new Error(`Failed to read ${path.relative(repoRoot, absolutePath)}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function readOptionalJson(relativePath) {
  try {
    return await readJson(relativePath);
  } catch {
    return undefined;
  }
}

async function exists(relativePath) {
  try {
    await access(path.join(targetRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}

function parseArgs(rawArgs) {
  const parsed = {};
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--root") {
      parsed.root = rawArgs[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--profile") {
      parsed.profile = rawArgs[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function normalizePath(input) {
  return String(input ?? "").replaceAll("\\", "/").toLowerCase();
}

function pathMatches(actual, expected) {
  const normalizedActual = normalizePath(actual);
  const normalizedExpected = normalizePath(expected);
  return (
    normalizedActual === normalizedExpected ||
    normalizedActual.endsWith(`/${normalizedExpected}`) ||
    normalizedExpected.endsWith(`/${normalizedActual}`)
  );
}

function isVisualHiveUri(input) {
  return typeof input === "string" && input.startsWith("visual-hive://");
}

function isVisualHiveReadTool(input) {
  return typeof input === "string" && input.startsWith("visual_hive_");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function loadEvidenceResourceCatalog() {
  const catalogPath = path.join(repoRoot, "packages", "core", "dist", "tools", "evidenceResources.js");
  try {
    const module = await import(pathToFileURL(catalogPath).href);
    const resources = module.VISUAL_HIVE_EVIDENCE_RESOURCES;
    assert(Array.isArray(resources), "Built core evidence-resource catalog exports VISUAL_HIVE_EVIDENCE_RESOURCES");
    return resources;
  } catch (error) {
    throw new Error(
      `Failed to load built evidence-resource catalog from ${path.relative(repoRoot, catalogPath)}. Run "npm run build" before evidence-resource consistency checks. ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}
