#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targetRoot = path.resolve(repoRoot, process.argv[2] ?? "examples/demo-react-app");
const hiveRoot = path.join(targetRoot, ".visual-hive");
const outputPath = path.join(hiveRoot, "hive-issue-dry-run.json");

const handoff = await readJson(path.join(hiveRoot, "handoff.json"));
const validation = await readJson(path.join(hiveRoot, "hive-handoff-validation.json"));
const issueBody = await readText(path.join(hiveRoot, "hive-issue.md"));
const evidence = await readJson(path.join(hiveRoot, "evidence-packet.json"));

const marker = "<!-- visual-hive-hive-handoff -->";
const dedupeSignature = String(handoff.githubIssue?.dedupeSignature ?? "");
const labels = sanitizeList(handoff.githubIssue?.labels ?? handoff.labels ?? []);
const title = sanitizeText(handoff.githubIssue?.title ?? `[Visual Hive] ${handoff.project ?? "unknown"} evidence handoff`);
const body = sanitizeText(issueBody);
const blockingReasons = [
  ...(handoff.status === "blocked" ? handoff.blockedReasons ?? ["Handoff packet is blocked."] : []),
  ...(validation.status === "blocked" ? validation.blockedReasons ?? ["Handoff validation is blocked."] : []),
  ...(evidence?.verdictSummary?.visualHiveVerdict === "blocked" ? evidence.verdictSummary.blockedBecause ?? ["Evidence verdict is blocked."] : []),
  ...(!body.includes(marker) ? ["Hive issue body is missing the Visual Hive handoff marker."] : []),
  ...(!dedupeSignature ? ["Handoff packet is missing a dedupe signature."] : [])
].map(sanitizeText);

const existingIssueBody = [
  "# Existing Visual Hive handoff",
  "",
  marker,
  "",
  `Dedupe fingerprint: ${dedupeSignature}`,
  "",
  "Old body to replace."
].join("\n");

const scenarios = [
  simulateIssueDecision({ name: "no_existing_issue", existingIssues: [] }),
  simulateIssueDecision({
    name: "existing_issue_found",
    existingIssues: [
      {
        number: 42,
        title: "Existing Visual Hive handoff",
        body: existingIssueBody,
        labels
      }
    ]
  }),
  simulateIssueDecision({
    name: "blocked_artifacts",
    existingIssues: [],
    forcedBlockingReasons: ["Synthetic blocked-artifact proof: trusted workflow must not create or update issues from blocked evidence."]
  })
];

const report = {
  schemaVersion: "visual-hive.hive-issue-dry-run.v1",
  generatedAt: new Date().toISOString(),
  project: sanitizeText(handoff.project ?? evidence.project ?? "unknown"),
  externalCallsMade: 0,
  networkCallsMade: 0,
  sourceArtifacts: {
    issue: ".visual-hive/hive-issue.md",
    handoff: ".visual-hive/handoff.json",
    validation: ".visual-hive/hive-handoff-validation.json",
    evidencePacket: ".visual-hive/evidence-packet.json"
  },
  dedupeSignature,
  marker,
  title,
  labels,
  blocked: blockingReasons.length > 0,
  blockingReasons,
  scenarios
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

if (JSON.stringify(report).includes("secret-value") || JSON.stringify(report).includes("Bearer abc") || JSON.stringify(report).includes("token=abc")) {
  throw new Error("Handoff issue dry-run report contained an unredacted secret-like value.");
}

if (report.blocked && report.scenarios.some((scenario) => scenario.wouldCreateOrUpdate)) {
  throw new Error("Unsafe or blocked handoff artifacts would still create/update an issue.");
}
if (!report.blocked) {
  const create = report.scenarios.find((scenario) => scenario.name === "no_existing_issue");
  const update = report.scenarios.find((scenario) => scenario.name === "existing_issue_found");
  if (create?.decision !== "create" || update?.decision !== "update") {
    throw new Error(`Expected create/update dry-run decisions, got ${create?.decision ?? "missing"}/${update?.decision ?? "missing"}.`);
  }
}

console.log(`Visual Hive Hive issue handoff dry-run passed: ${path.relative(repoRoot, outputPath).replaceAll("\\", "/")}`);

function simulateIssueDecision({ name, existingIssues, forcedBlockingReasons = [] }) {
  const existing = existingIssues.find((issue) => String(issue.body ?? "").includes(dedupeSignature) || String(issue.body ?? "").includes(marker));
  const effectiveBlockingReasons = [...blockingReasons, ...forcedBlockingReasons].map(sanitizeText);
  const decision = effectiveBlockingReasons.length ? "blocked" : existing ? "update" : "create";
  return {
    name,
    decision,
    wouldCreateOrUpdate: decision === "create" || decision === "update",
    existingIssueNumber: existing?.number,
    blocked: decision === "blocked",
    blockingReasons: effectiveBlockingReasons,
    title,
    labels,
    bodyPreview: body.slice(0, 1000),
    dedupeSignature,
    markerPresent: body.includes(marker)
  };
}

async function readJson(filePath) {
  return JSON.parse(await readText(filePath));
}

async function readText(filePath) {
  return readFile(filePath, "utf8");
}

function sanitizeList(values) {
  return Array.from(new Set(values.map((value) => sanitizeText(String(value))).filter(Boolean))).sort();
}

function sanitizeText(value) {
  return String(value)
    .replace(/(access_token|id_token|refresh_token|client_secret|token|password|secret|key|code)=([^&\s]+)/gi, "$1=[REDACTED]")
    .replace(/(authorization|bearer|cookie|set-cookie)\s*[:=]\s*([^\n\r]+)/gi, "$1: [REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]");
}
