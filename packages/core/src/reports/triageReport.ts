import type { TriageFinding, TriageReport } from "./types.js";
import { sanitizeText } from "../utils/sanitize.js";

export interface BuildTriageReportOptions {
  project: string;
  findings: TriageFinding[];
  sourceArtifacts?: TriageReport["sourceArtifacts"];
  now?: Date;
}

export function buildTriageReport(options: BuildTriageReportOptions): TriageReport {
  const findings = options.findings.map(sanitizeFinding);
  return {
    schemaVersion: 1,
    project: sanitizeText(options.project),
    generatedAt: (options.now ?? new Date()).toISOString(),
    sourceArtifacts: sanitizeSourceArtifacts(options.sourceArtifacts ?? {}),
    summary: summarize(findings),
    findings
  };
}

function sanitizeFinding(finding: TriageFinding): TriageFinding {
  return {
    classification: finding.classification,
    severity: finding.severity,
    title: sanitizeText(finding.title),
    evidence: finding.evidence.map((item) => sanitizeText(item)),
    contractIds: sanitizeOptionalList(finding.contractIds),
    targetIds: sanitizeOptionalList(finding.targetIds),
    suggestedFiles: sanitizeOptionalList(finding.suggestedFiles),
    suggestedNextTests: finding.suggestedNextTests.map((item) => sanitizeText(item))
  };
}

function sanitizeOptionalList(values?: string[]): string[] | undefined {
  if (!values) return undefined;
  return [...new Set(values.map((value) => sanitizeText(value)).filter(Boolean))].sort();
}

function sanitizeSourceArtifacts(sourceArtifacts: TriageReport["sourceArtifacts"]): TriageReport["sourceArtifacts"] {
  return Object.fromEntries(
    Object.entries(sourceArtifacts).map(([key, value]) => [key, value ? sanitizeText(value) : value])
  ) as TriageReport["sourceArtifacts"];
}

function summarize(findings: TriageFinding[]): TriageReport["summary"] {
  const classifications: Record<string, number> = {};
  for (const finding of findings) {
    classifications[finding.classification] = (classifications[finding.classification] ?? 0) + 1;
  }
  return {
    findingCount: findings.length,
    critical: findings.filter((finding) => finding.severity === "critical").length,
    high: findings.filter((finding) => finding.severity === "high").length,
    medium: findings.filter((finding) => finding.severity === "medium").length,
    low: findings.filter((finding) => finding.severity === "low").length,
    classifications: Object.fromEntries(Object.entries(classifications).sort(([a], [b]) => a.localeCompare(b)))
  };
}
