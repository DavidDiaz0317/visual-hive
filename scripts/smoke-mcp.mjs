#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { clearTimeout, setTimeout } from "node:timers";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MCP_DISABLED_EXECUTION_TOOLS,
  callReadOnlyTool,
  readMcpResourceText,
  runMcpCommand
} from "../packages/cli/dist/commands/mcp.js";
import { loadConfig } from "../packages/core/dist/index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = process.argv.includes("--config")
  ? process.argv[process.argv.indexOf("--config") + 1]
  : "examples/demo-react-app/visual-hive.config.yaml";
const loaded = await loadConfig(config, repoRoot);
const root = process.argv.includes("--root")
  ? path.resolve(repoRoot, process.argv[process.argv.indexOf("--root") + 1])
  : loaded.rootDir;
const outputDir = path.join(root, ".visual-hive");
const summaryPath = path.join(outputDir, "mcp-smoke.json");

const requiredArtifacts = [
  ".visual-hive/issues.json",
  ".visual-hive/issue-queue.json",
  ".visual-hive/visual-graph.json",
  ".visual-hive/visual-impact.json",
  ".visual-hive/evidence-packet.json",
  ".visual-hive/mutation-report.json"
];

const requiredResourceIds = [
  "config",
  "control-plane-snapshot",
  "repo-map",
  "repo-context",
  "visual-graph",
  "visual-impact",
  "issue-queue",
  "evidence-packet",
  "report",
  "mutation-report",
  "triage",
  "handoff",
  "hive-export",
  "artifacts-index",
  "agent-packet",
  "issue-candidates"
];

const requiredReadTools = [
  "visual_hive_doctor",
  "visual_hive_validate_config",
  "visual_hive_plan",
  "visual_hive_list_issues",
  "visual_hive_get_issue_context",
  "visual_hive_read_issue_queue",
  "visual_hive_query_visual_graph",
  "visual_hive_get_visual_impact",
  "visual_hive_read_evidence_packet",
  "visual_hive_read_mutation_report",
  "visual_hive_list_artifacts",
  "visual_hive_get_validation_command",
  "visual_hive_get_agent_prompt",
  "visual_hive_get_handoff_context"
];

await mkdir(outputDir, { recursive: true });
await ensureArtifacts();

const manifest = await runMcpCommand({ cwd: repoRoot, config, output: path.relative(loaded.rootDir, path.join(outputDir, "mcp-manifest.json")) });
const readToolNames = new Set(manifest.tools.map((tool) => tool.name));
const resourceIds = new Set(manifest.resources.map((resource) => resource.id));
const disabledToolNames = new Set(manifest.disabledExecutionTools.map((tool) => tool.name));
const errors = [];

for (const id of requiredResourceIds) {
  if (!resourceIds.has(id)) errors.push(`Missing MCP resource: ${id}`);
}
for (const tool of requiredReadTools) {
  if (!readToolNames.has(tool)) errors.push(`Missing MCP read-only tool: ${tool}`);
}
for (const tool of MCP_DISABLED_EXECUTION_TOOLS.map((entry) => entry.name)) {
  if (!disabledToolNames.has(tool)) errors.push(`Execution tool is not marked disabled: ${tool}`);
  if (readToolNames.has(tool)) errors.push(`Execution tool is callable by default: ${tool}`);
}

const resourceReads = [];
for (const id of ["issue-candidates", "issue-queue", "visual-graph", "visual-impact", "evidence-packet", "mutation-report", "artifacts-index", "agent-packet", "handoff", "triage"]) {
  const resource = manifest.resources.find((entry) => entry.id === id);
  if (!resource) continue;
  const text = await readMcpResourceText(loaded, resource);
  resourceReads.push({ id, uri: resource.uri, bytes: text.length, ok: text.length > 0 && !text.includes("is not available yet") });
}

const toolCalls = [];
for (const tool of [
  "visual_hive_list_issues",
  "visual_hive_get_issue_context",
  "visual_hive_query_visual_graph",
  "visual_hive_get_visual_impact",
  "visual_hive_read_evidence_packet",
  "visual_hive_read_mutation_report",
  "visual_hive_get_validation_command",
  "visual_hive_get_agent_prompt",
  "visual_hive_get_handoff_context",
  "visual_hive_list_artifacts"
]) {
  const text = await callReadOnlyTool(loaded, tool);
  toolCalls.push({ name: tool, bytes: text.length, ok: text.length > 0 && !text.includes("is not available yet") });
}

if (resourceReads.filter((entry) => entry.ok).length < 10) {
  errors.push("MCP smoke read fewer than 10 concrete resources.");
}
if (toolCalls.filter((entry) => entry.ok).length < 10) {
  errors.push("MCP smoke called fewer than 10 concrete read-only tools.");
}

const summary = {
  schemaVersion: "visual-hive.mcp-smoke.v1",
  generatedAt: new Date().toISOString(),
  project: manifest.project,
  config,
  manifestPath: ".visual-hive/mcp-manifest.json",
  resourcesListed: manifest.resources.length,
  toolsListed: manifest.tools.length,
  disabledExecutionTools: manifest.disabledExecutionTools.map((tool) => tool.name),
  resourceReads,
  toolCalls,
  safety: {
    readOnly: true,
    externalCallsMade: 0,
    networkCallsMade: 0,
    writesToSource: 0,
    createsIssues: false,
    createsBranches: false,
    opensPullRequests: false,
    approvesBaselines: false
  },
  status: errors.length ? "failed" : "passed",
  errors
};

await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`Visual Hive MCP smoke passed: ${summary.resourcesListed} resources, ${summary.toolsListed} read tools, ${summary.disabledExecutionTools.length} disabled execution tools.`);

async function ensureArtifacts() {
  const missing = requiredArtifacts.filter((artifact) => !existsSync(path.join(root, artifact)));
  if (!missing.length) return;
  if (!root.startsWith(repoRoot)) {
    throw new Error(`Missing required MCP artifacts in ${root}: ${missing.join(", ")}. Run the target repo Visual Hive full run first.`);
  }
  for (const scriptName of ["demo:analyze", "demo:graph:impact", "demo:issues", "demo:evidence", "demo:mutate", "demo:handoff", "demo:artifacts", "demo:agent-packet"]) {
    await runNpmScript(scriptName, 180_000);
  }
}

function runNpmScript(scriptName, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.platform === "win32" ? "cmd.exe" : "npm", process.platform === "win32" ? ["/d", "/s", "/c", "npm", "run", scriptName] : ["run", scriptName], {
      cwd: repoRoot,
      stdio: "inherit"
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${scriptName} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${scriptName} failed with exit code ${code}`));
    });
  });
}
