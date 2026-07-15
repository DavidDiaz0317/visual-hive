#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { VISUAL_HIVE_EVIDENCE_RESOURCES } from "../packages/core/dist/tools/evidenceResources.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checkOnly = process.argv.includes("--check");
const schemaFiles = [
  "visual-hive.agent-packet.schema.json",
  "visual-hive.artifacts.schema.json",
  "visual-hive.context-ledger.schema.json",
  "visual-hive.control-plane-snapshot.schema.json",
  "visual-hive.mcp.schema.json",
  "visual-hive.tool-registry.schema.json"
];
const mcpDocsPath = path.join(repoRoot, "docs", "agents", "mcp-and-tool-efficiency.md");
const catalog = {
  evidenceResourceId: VISUAL_HIVE_EVIDENCE_RESOURCES.map((resource) => resource.id),
  evidenceResourceUri: VISUAL_HIVE_EVIDENCE_RESOURCES.map((resource) => resource.uri),
  evidenceReadToolName: VISUAL_HIVE_EVIDENCE_RESOURCES.flatMap((resource) => resource.readTool ? [resource.readTool.name] : []),
  readToolName: VISUAL_HIVE_EVIDENCE_RESOURCES.flatMap((resource) => resource.readTool ? [resource.readTool.name] : []),
  artifactPath: VISUAL_HIVE_EVIDENCE_RESOURCES.map((resource) => resource.relativePath)
};
const changed = [];

for (const schemaFile of schemaFiles) {
  const schemaPath = path.join(repoRoot, "schemas", schemaFile);
  const before = await readFile(schemaPath, "utf8");
  const schema = JSON.parse(before);
  synchronize(schema);
  if (schemaFile === "visual-hive.mcp.schema.json") synchronizeMcpSchema(schema);
  const after = `${JSON.stringify(schema, null, 2)}\n`;
  if (normalizeNewlines(before) === normalizeNewlines(after)) continue;
  changed.push(schemaFile);
  if (!checkOnly) await writeFile(schemaPath, after, "utf8");
}

const mcpSchema = JSON.parse(await readFile(path.join(repoRoot, "schemas", "visual-hive.mcp.schema.json"), "utf8"));
const docsBefore = await readFile(mcpDocsPath, "utf8");
const docsAfter = synchronizeMcpDocs(
  docsBefore,
  catalog.evidenceResourceUri,
  mcpSchema.$defs.readOnlyTool.properties.name.enum
);
if (normalizeNewlines(docsBefore) !== normalizeNewlines(docsAfter)) {
  changed.push(path.relative(repoRoot, mcpDocsPath).replaceAll("\\", "/"));
  if (!checkOnly) await writeFile(mcpDocsPath, docsAfter, "utf8");
}

if (changed.length > 0 && checkOnly) {
  throw new Error(`Evidence-resource schema enums are stale: ${changed.join(", ")}. Run npm run schema:sync.`);
}

console.log(changed.length === 0 ? "Evidence-resource schema enums are current." : `Updated ${changed.length} contract file(s): ${changed.join(", ")}`);

function synchronize(value) {
  if (Array.isArray(value)) {
    value.forEach(synchronize);
    return;
  }
  if (!value || typeof value !== "object") return;

  const isEvidenceResourceObject = ["evidenceResourceId", "evidenceResourceUri", "evidenceReadToolName"]
    .some((propertyName) => isObject(value[propertyName]));
  for (const [propertyName, values] of Object.entries(catalog)) {
    if (propertyName === "artifactPath" && !isEvidenceResourceObject) continue;
    const property = value[propertyName];
    if (isObject(property) && Array.isArray(property.enum)) property.enum = [...values];
  }
  Object.values(value).forEach(synchronize);
}

function synchronizeMcpSchema(schema) {
  const resourceProperties = schema?.$defs?.resource?.properties;
  const readOnlyToolName = schema?.$defs?.readOnlyTool?.properties?.name;
  if (!resourceProperties || !readOnlyToolName || !Array.isArray(readOnlyToolName.enum)) {
    throw new Error("visual-hive.mcp.schema.json does not expose the expected resource/tool enum contract.");
  }
  resourceProperties.id.enum = [...catalog.evidenceResourceId];
  resourceProperties.uri.enum = [...catalog.evidenceResourceUri];
  resourceProperties.readToolName.enum = [...catalog.evidenceReadToolName];
  readOnlyToolName.enum = [...new Set([...readOnlyToolName.enum, ...catalog.readToolName])].sort();
}

function synchronizeMcpDocs(markdown, resourceUris, toolNames) {
  let result = replaceMarkdownBulletList(markdown, "## Default Resources", "## Default Tools", resourceUris);
  result = replaceMarkdownBulletList(result, "## Default Tools", "## Disabled By Default", toolNames);
  return result;
}

function replaceMarkdownBulletList(markdown, heading, nextHeading, values) {
  const headingIndex = markdown.indexOf(heading);
  const nextHeadingIndex = markdown.indexOf(nextHeading, headingIndex + heading.length);
  if (headingIndex < 0 || nextHeadingIndex < 0) {
    throw new Error(`MCP documentation is missing ${heading} or ${nextHeading}.`);
  }
  const sectionStart = headingIndex + heading.length;
  const section = markdown.slice(sectionStart, nextHeadingIndex);
  const matches = [...section.matchAll(/^- `[^`]+`\r?$/gm)];
  if (matches.length === 0) throw new Error(`MCP documentation section ${heading} has no managed bullet list.`);
  const first = matches[0];
  const last = matches.at(-1);
  const firstIndex = first.index;
  const lastEnd = last.index + last[0].length;
  const replacement = values.map((value) => `- \`${value}\``).join("\n");
  const updatedSection = section.slice(0, firstIndex) + replacement + section.slice(lastEnd);
  return markdown.slice(0, sectionStart) + updatedSection + markdown.slice(nextHeadingIndex);
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeNewlines(value) {
  return value.replaceAll("\r\n", "\n");
}
