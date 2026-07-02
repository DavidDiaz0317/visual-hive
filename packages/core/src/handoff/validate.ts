import path from "node:path";
import { readFile } from "node:fs/promises";
import { readJson, writeJson } from "../utils/files.js";
import { sanitizeText } from "../utils/sanitize.js";
import type { EvidencePacket, VerdictSummary } from "../evidence/types.js";
import type { HandoffPacket, HiveBeadDryRunRequest, HiveHandoffResult } from "./types.js";

export type HandoffValidationStatus = "passed" | "warning" | "blocked";

export interface HandoffValidationCheck {
  id: string;
  label: string;
  status: HandoffValidationStatus;
  evidence: string[];
  message: string;
}

export interface HandoffValidationReport {
  schemaVersion: "visual-hive.handoff-validation.v1";
  generatedAt: string;
  project: string;
  status: HandoffValidationStatus;
  sourceArtifacts: {
    evidencePacket: string;
    handoff: string;
    issue: string;
    beadRequest: string;
    result: string;
  };
  summary: {
    checksPassed: number;
    warnings: number;
    blocked: number;
    externalCallsMade: number;
    workItems: number;
  };
  checks: HandoffValidationCheck[];
  blockedReasons: string[];
  warnings: string[];
}

export interface ValidateHandoffArtifactsOptions {
  rootDir: string;
  evidencePacketPath?: string;
  handoffPath?: string;
  issuePath?: string;
  beadRequestPath?: string;
  resultPath?: string;
  outputPath?: string;
  now?: Date;
}

const DEFAULT_PATHS = {
  evidencePacket: ".visual-hive/evidence-packet.json",
  handoff: ".visual-hive/handoff.json",
  issue: ".visual-hive/hive-issue.md",
  beadRequest: ".visual-hive/hive-bead-request.json",
  result: ".visual-hive/hive-handoff-result.json",
  output: ".visual-hive/hive-handoff-validation.json"
};

export async function validateHandoffArtifacts(
  options: ValidateHandoffArtifactsOptions
): Promise<{ report: HandoffValidationReport; reportPath: string }> {
  const rootDir = path.resolve(options.rootDir);
  const sourceArtifacts = {
    evidencePacket: normalizeArtifactPath(options.evidencePacketPath ?? DEFAULT_PATHS.evidencePacket),
    handoff: normalizeArtifactPath(options.handoffPath ?? DEFAULT_PATHS.handoff),
    issue: normalizeArtifactPath(options.issuePath ?? DEFAULT_PATHS.issue),
    beadRequest: normalizeArtifactPath(options.beadRequestPath ?? DEFAULT_PATHS.beadRequest),
    result: normalizeArtifactPath(options.resultPath ?? DEFAULT_PATHS.result)
  };
  const outputPath = normalizeArtifactPath(options.outputPath ?? DEFAULT_PATHS.output);
  const checks: HandoffValidationCheck[] = [];

  const evidence = await readArtifact<EvidencePacket>(rootDir, sourceArtifacts.evidencePacket, "evidence-packet", checks);
  const handoff = await readArtifact<HandoffPacket>(rootDir, sourceArtifacts.handoff, "handoff-packet", checks);
  const beadRequest = await readArtifact<HiveBeadDryRunRequest>(rootDir, sourceArtifacts.beadRequest, "hive-bead-request", checks);
  const result = await readArtifact<HiveHandoffResult>(rootDir, sourceArtifacts.result, "hive-handoff-result", checks);
  const issueBody = await readTextArtifact(rootDir, sourceArtifacts.issue, checks);

  if (evidence) {
    addCheck(
      checks,
      "evidence-schema",
      "Evidence Packet schema",
      evidence.schemaVersion === "visual-hive.evidence-packet.v2" ? "passed" : "blocked",
      [`schemaVersion=${String(evidence.schemaVersion)}`],
      "Evidence Packet must be schema version visual-hive.evidence-packet.v2."
    );
  }
  if (handoff) {
    addCheck(
      checks,
      "handoff-schema",
      "Handoff Packet schema",
      handoff.schemaVersion === "visual-hive.handoff.v1" ? "passed" : "blocked",
      [`schemaVersion=${String(handoff.schemaVersion)}`],
      "Handoff Packet must be schema version visual-hive.handoff.v1."
    );
  }
  if (beadRequest) {
    addCheck(
      checks,
      "bead-request-schema",
      "Hive bead request schema",
      beadRequest.schemaVersion === "visual-hive.hive-bead-request.v1" ? "passed" : "blocked",
      [`schemaVersion=${String(beadRequest.schemaVersion)}`, `dryRun=${String(beadRequest.dryRun)}`],
      "Hive bead request must be dry-run schema version visual-hive.hive-bead-request.v1."
    );
  }
  if (result) {
    addCheck(
      checks,
      "handoff-result-schema",
      "Hive handoff result schema",
      result.schemaVersion === "visual-hive.hive-handoff-result.v1" ? "passed" : "blocked",
      [`schemaVersion=${String(result.schemaVersion)}`],
      "Hive handoff result must be schema version visual-hive.hive-handoff-result.v1."
    );
  }

  const externalCallsMade = sumExternalCalls(handoff, beadRequest, result);
  addCheck(
    checks,
    "no-external-calls",
    "No external handoff calls",
    externalCallsMade === 0 ? "passed" : "blocked",
    [`externalCallsMade=${externalCallsMade}`],
    "Trusted Hive handoff validation expects dry-run artifacts with zero external calls."
  );

  if (handoff && beadRequest && result) {
    addCheck(
      checks,
      "dry-run-policy",
      "Dry-run policy",
      handoff.externalCallsMade === 0 &&
        beadRequest.dryRun === true &&
        beadRequest.externalCallsMade === 0 &&
        result.externalCallsMade === 0
        ? "passed"
        : "blocked",
      [
        `handoff.externalCallsMade=${handoff.externalCallsMade}`,
        `beadRequest.dryRun=${String(beadRequest.dryRun)}`,
        `beadRequest.externalCallsMade=${beadRequest.externalCallsMade}`,
        `result.externalCallsMade=${result.externalCallsMade}`
      ],
      "Handoff, bead request, and result artifacts must remain dry-run/no-network artifacts."
    );
  }

  if (evidence && handoff && beadRequest && result) {
    const projectStatus = allSame([evidence.project, handoff.project, beadRequest.project, result.project]) ? "passed" : "blocked";
    addCheck(
      checks,
      "project-consistency",
      "Project consistency",
      projectStatus,
      [`evidence=${evidence.project}`, `handoff=${handoff.project}`, `beadRequest=${beadRequest.project}`, `result=${result.project}`],
      "Handoff artifacts must describe the same project."
    );

    const verdictStatus = sameVerdict(evidence.verdictSummary, handoff.verdict) && sameVerdict(evidence.verdictSummary, beadRequest.verdict) ? "passed" : "blocked";
    addCheck(
      checks,
      "verdict-consistency",
      "Verdict consistency",
      verdictStatus,
      [
        `evidence=${evidence.verdictSummary.visualHiveVerdict}`,
        `handoff=${handoff.verdict.visualHiveVerdict}`,
        `beadRequest=${beadRequest.verdict.visualHiveVerdict}`
      ],
      "Hive handoff artifacts must preserve the Visual Hive verdict without reinterpreting it."
    );

    const pathStatus =
      normalizeArtifactPath(handoff.sourceEvidencePacket) === normalizeArtifactPath(beadRequest.evidencePacketPath) &&
      normalizeArtifactPath(handoff.hiveBeadRequest.handoffPacketPath) === normalizeArtifactPath(beadRequest.handoffPacketPath) &&
      normalizeArtifactPath(result.artifacts.evidencePacket) === normalizeArtifactPath(beadRequest.evidencePacketPath)
        ? "passed"
        : "blocked";
    addCheck(
      checks,
      "artifact-path-consistency",
      "Artifact path consistency",
      pathStatus,
      [
        `handoff.sourceEvidencePacket=${handoff.sourceEvidencePacket}`,
        `beadRequest.evidencePacketPath=${beadRequest.evidencePacketPath}`,
        `result.artifacts.evidencePacket=${result.artifacts.evidencePacket}`
      ],
      "Evidence and handoff artifact pointers must agree."
    );

    addCheck(
      checks,
      "handoff-readiness",
      "Handoff readiness",
      handoff.status === "ready" && result.status === "dry_run_written" ? "passed" : "warning",
      [`handoff.status=${handoff.status}`, `result.status=${result.status}`, `blockedReasons=${[...handoff.blockedReasons, ...result.blockedReasons].join("; ") || "none"}`],
      "Blocked handoff is safe to inspect but not ready for trusted issue/Hive routing."
    );
  }

  if (issueBody !== undefined) {
    const sanitizedIssueBody = sanitizeText(issueBody);
    addCheck(
      checks,
      "issue-body-marker",
      "Hive issue marker",
      issueBody.includes("<!-- visual-hive-hive-handoff -->") ? "passed" : "warning",
      [issueBody.includes("<!-- visual-hive-hive-handoff -->") ? "marker=present" : "marker=missing"],
      "Hive issue body should include the Visual Hive handoff marker for trusted workflow consumers."
    );
    addCheck(
      checks,
      "issue-body-sanitized",
      "Hive issue body sanitized",
      redactionCount(sanitizedIssueBody) === redactionCount(issueBody) ? "passed" : "blocked",
      ["secretScan=sanitizeText"],
      "Hive issue body must not contain secret-like values."
    );
  }

  const blockedReasons = checks.filter((check) => check.status === "blocked").map((check) => `${check.id}: ${check.message}`);
  const warnings = checks.filter((check) => check.status === "warning").map((check) => `${check.id}: ${check.message}`);
  const status: HandoffValidationStatus = blockedReasons.length ? "blocked" : warnings.length ? "warning" : "passed";
  const project = sanitizeText(evidence?.project ?? handoff?.project ?? beadRequest?.project ?? result?.project ?? "unknown");
  const report: HandoffValidationReport = sanitizeValue({
    schemaVersion: "visual-hive.handoff-validation.v1",
    generatedAt: (options.now ?? new Date()).toISOString(),
    project,
    status,
    sourceArtifacts,
    summary: {
      checksPassed: checks.filter((check) => check.status === "passed").length,
      warnings: warnings.length,
      blocked: blockedReasons.length,
      externalCallsMade,
      workItems: handoff?.workItems.length ?? beadRequest?.workItems.length ?? 0
    },
    checks,
    blockedReasons,
    warnings
  }) as HandoffValidationReport;
  const reportPath = resolveArtifact(rootDir, outputPath);
  await writeJson(reportPath, report);
  return { report, reportPath };
}

async function readArtifact<T>(
  rootDir: string,
  artifactPath: string,
  label: string,
  checks: HandoffValidationCheck[]
): Promise<T | undefined> {
  try {
    return (await readJson<T>(resolveArtifact(rootDir, artifactPath))) as T;
  } catch (error) {
    addCheck(checks, `artifact-${label}`, `Read ${label}`, "blocked", [artifactPath], sanitizeText(error instanceof Error ? error.message : String(error)));
    return undefined;
  }
}

async function readTextArtifact(rootDir: string, artifactPath: string, checks: HandoffValidationCheck[]): Promise<string | undefined> {
  try {
    return await readFile(resolveArtifact(rootDir, artifactPath), "utf8");
  } catch (error) {
    addCheck(checks, "artifact-hive-issue", "Read Hive issue body", "blocked", [artifactPath], sanitizeText(error instanceof Error ? error.message : String(error)));
    return undefined;
  }
}

function addCheck(
  checks: HandoffValidationCheck[],
  id: string,
  label: string,
  status: HandoffValidationStatus,
  evidence: string[],
  message: string
): void {
  checks.push({
    id: sanitizeText(id),
    label: sanitizeText(label),
    status,
    evidence: evidence.map((item) => sanitizeText(item)),
    message: sanitizeText(message)
  });
}

function sumExternalCalls(handoff?: HandoffPacket, beadRequest?: HiveBeadDryRunRequest, result?: HiveHandoffResult): number {
  return Number(handoff?.externalCallsMade ?? 0) + Number(beadRequest?.externalCallsMade ?? 0) + Number(result?.externalCallsMade ?? 0);
}

function sameVerdict(left: VerdictSummary, right: VerdictSummary): boolean {
  return JSON.stringify(normalizedVerdict(left)) === JSON.stringify(normalizedVerdict(right));
}

function normalizedVerdict(verdict: VerdictSummary): VerdictSummary {
  return {
    visualHiveVerdict: verdict.visualHiveVerdict,
    failedBecause: [...verdict.failedBecause].sort(),
    warningBecause: [...verdict.warningBecause].sort(),
    blockedBecause: [...verdict.blockedBecause].sort(),
    advisoryOnly: [...verdict.advisoryOnly].sort()
  };
}

function allSame(values: string[]): boolean {
  return new Set(values.map((value) => sanitizeText(value))).size === 1;
}

function resolveArtifact(rootDir: string, artifactPath: string): string {
  return path.isAbsolute(artifactPath) ? artifactPath : path.resolve(rootDir, artifactPath);
}

function normalizeArtifactPath(value: string): string {
  return value.replaceAll("\\", "/");
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === "string") return sanitizeText(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, sanitizeValue(child)]));
  return value;
}

function redactionCount(value: string): number {
  return value.match(/\[REDACTED]/g)?.length ?? 0;
}
