#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targetRoot = path.resolve(repoRoot, process.argv[2] ?? "examples/demo-react-app");
const hiveRoot = path.join(targetRoot, ".visual-hive");

const mutationReport = await readJson(path.join(hiveRoot, "mutation-report.json"));
const testCreationPlan = await readOptionalJson(path.join(hiveRoot, "test-creation-plan.json"));
const issueBody = await readOptionalText(path.join(hiveRoot, "hive-issue.md"));

if (mutationReport.schemaVersion !== 2) {
  throw new Error(`Expected mutation report schemaVersion 2, got ${String(mutationReport.schemaVersion)}.`);
}
if (!Array.isArray(mutationReport.results) || mutationReport.results.length === 0) {
  throw new Error("Mutation report did not include any mutation results.");
}

for (const result of mutationReport.results) {
  requireString(result.operator, "operator");
  requireString(result.status, `${result.operator}.status`);
  if (!Array.isArray(result.contractIds)) throw new Error(`${result.operator} did not include contractIds.`);
  if (!Array.isArray(result.affected)) throw new Error(`${result.operator} did not include affected surfaces.`);
  if (!result.validationCommand || !String(result.validationCommand).includes("visual-hive mutate")) {
    throw new Error(`${result.operator} did not include a Visual Hive mutation validation command.`);
  }
  if (!["runtime", "fixture"].includes(result.mutationMode)) {
    throw new Error(`${result.operator} mutationMode should be runtime or fixture in the demo path, got ${String(result.mutationMode)}.`);
  }
  if (result.sourceMutation !== false) {
    throw new Error(`${result.operator} sourceMutation should be false in the normal demo path.`);
  }
}

const survived = mutationReport.results.filter((result) => result.status === "survived");
if (survived.length) {
  const recommendationText = JSON.stringify(testCreationPlan ?? {}) + "\n" + (issueBody ?? "");
  for (const result of survived) {
    if (!recommendationText.includes(result.operator)) {
      throw new Error(`Survived mutation ${result.operator} did not appear in test-creation or issue context.`);
    }
  }
}

const killed = mutationReport.results.filter((result) => result.status === "killed").length;
const denominator = mutationReport.results.filter((result) => result.status !== "not_applicable").length;
if (mutationReport.killed !== killed || mutationReport.total !== denominator) {
  throw new Error(`Mutation score denominator mismatch: expected ${killed}/${denominator}, got ${mutationReport.killed}/${mutationReport.total}.`);
}

console.log(`Visual Hive mutation proof passed: ${mutationReport.killed}/${mutationReport.total} killed, ${survived.length} survived, sourceMutation=false.`);

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function readOptionalJson(filePath) {
  try {
    return await readJson(filePath);
  } catch {
    return undefined;
  }
}

async function readOptionalText(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
}

function requireString(value, label) {
  if (!value || typeof value !== "string") {
    throw new Error(`Mutation result missing ${label}.`);
  }
}
