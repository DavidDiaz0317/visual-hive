import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  VISUAL_HIVE_CAPABILITY_BASELINE,
  buildCapabilityInventory,
  buildCapabilityParityReport,
  readSchemaCapabilities
} from "../packages/core/dist/index.js";
import { CONTROL_PLANE_CAPABILITY_SURFACES } from "../packages/control-plane/dist/index.js";
import { collectCliCapabilitySurface } from "../packages/cli/dist/capabilitySurface.js";
import { program } from "../packages/cli/dist/index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arguments_ = parseArguments(process.argv.slice(2));
const actual = buildCapabilityInventory({
  cli: collectCliCapabilitySurface(program),
  schemas: await readSchemaCapabilities(path.join(repoRoot, "schemas")),
  controlPlane: CONTROL_PLANE_CAPABILITY_SURFACES
});
const report = buildCapabilityParityReport(VISUAL_HIVE_CAPABILITY_BASELINE, actual, new Date(0));
const failures = report.checks.filter((check) => !check.parity);

console.log(JSON.stringify({ status: report.status, runtimeStatus: report.runtimeStatus, summary: report.summary, failures }, null, 2));

if (!arguments_.candidate) {
  if (report.status !== "passed") process.exitCode = 1;
} else {
  if (report.status === "passed") {
    throw new Error("The checked-in capability baseline already matches the product; refusing to create a no-op candidate.");
  }
  if (!arguments_.reviewReason?.trim()) {
    throw new Error("Candidate generation requires --review-reason <reason>.");
  }
  if (arguments_.confirmIntent !== "accept-capability-drift") {
    throw new Error("Candidate generation requires --confirm-intent accept-capability-drift.");
  }

  const outputPath = path.resolve(repoRoot, arguments_.output ?? path.join(".visual-hive", "capability-baseline.candidate.json"));
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify({
    schemaVersion: "visual-hive.capability-baseline-candidate.v1",
    reviewReason: arguments_.reviewReason.trim(),
    inventory: actual,
    failures
  }, null, 2)}\n`, "utf8");
  console.log(`Wrote reviewed capability candidate to ${outputPath}`);
}

function parseArguments(values) {
  const parsed = { candidate: false };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--candidate") {
      parsed.candidate = true;
      continue;
    }
    if (value === "--output" || value === "--review-reason" || value === "--confirm-intent") {
      const next = values[index + 1];
      if (!next || next.startsWith("--")) throw new Error(`${value} requires a value.`);
      const key = value === "--output" ? "output" : value === "--review-reason" ? "reviewReason" : "confirmIntent";
      parsed[key] = next;
      index += 1;
      continue;
    }
    throw new Error(`Unknown capability baseline review argument: ${value}`);
  }
  return parsed;
}
