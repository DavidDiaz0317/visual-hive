import path from "node:path";
import { access } from "node:fs/promises";
import { aggregateVerdict, buildEvidencePacket } from "../evidence/build.js";
import type { EvidenceContribution, EvidencePacket } from "../evidence/types.js";
import { readJson, writeJson, writeText } from "../utils/files.js";
import { sanitizeText } from "../utils/sanitize.js";
import type { VerdictContribution, VerdictReport } from "./types.js";

export interface BuildVerdictReportOptions {
  rootDir: string;
  project: string;
  now?: Date;
  evidencePacketPath?: string;
  planPath?: string;
  reportPath?: string;
  mutationReportPath?: string;
  triageReportPath?: string;
  providerResultsPath?: string;
  readinessPath?: string;
  coveragePath?: string;
  repoMapPath?: string;
  artifactsIndexPath?: string;
}

export interface WriteVerdictReportOptions extends BuildVerdictReportOptions {
  outputPath?: string;
  markdownPath?: string;
}

export async function buildVerdictReport(options: BuildVerdictReportOptions): Promise<VerdictReport> {
  const evidencePacketPath = resolveArtifact(options.rootDir, options.evidencePacketPath ?? path.join(".visual-hive", "evidence-packet.json"));
  const evidencePacket =
    (await readOptional<EvidencePacket>(evidencePacketPath)) ??
    (await buildEvidencePacket({
      rootDir: options.rootDir,
      project: options.project,
      now: options.now,
      planPath: options.planPath,
      reportPath: options.reportPath,
      mutationReportPath: options.mutationReportPath,
      triageReportPath: options.triageReportPath,
      providerResultsPath: options.providerResultsPath,
      readinessPath: options.readinessPath,
      coveragePath: options.coveragePath,
      repoMapPath: options.repoMapPath,
      artifactsIndexPath: options.artifactsIndexPath
    }));
  const allContributions = contributionRows(evidencePacket.evidenceContributions);
  const verdict = aggregateVerdict(evidencePacket.evidenceContributions);
  const evidencePacketExists = await exists(evidencePacketPath);

  return sanitizeValue({
    schemaVersion: "visual-hive.verdict.v1",
    generatedAt: (options.now ?? new Date()).toISOString(),
    project: evidencePacket.project,
    sourceArtifacts: {
      evidencePacket: evidencePacketExists ? relative(options.rootDir, evidencePacketPath) : undefined,
      ...evidencePacket.sourceArtifacts
    },
    governance: evidencePacket.governance,
    policy: {
      passFailOwnedBy: "visual_hive_verdict_engine",
      deterministicSources: ["visual_hive", "playwright", "screenshot_diff", "mutation", "provider", "readiness", "coverage"],
      advisorySources: ["triage", "llm", "hive", "agent"],
      providerGating: "explicit_normalized_trusted_budget_authorized",
      mutationGating: "configured_threshold"
    },
    summary: {
      ...verdict,
      totalContributions: allContributions.length,
      gatingContributions: allContributions.filter((contribution) => contribution.gating).length,
      advisoryContributions: allContributions.filter((contribution) => !contribution.gating).length,
      failedContributions: countStatus(allContributions, "failed"),
      blockedContributions: countStatus(allContributions, "blocked"),
      warningContributions: countStatus(allContributions, "warning"),
      inconclusiveContributions: countStatus(allContributions, "inconclusive"),
      passedContributions: countStatus(allContributions, "passed"),
      skippedContributions: countStatus(allContributions, "skipped")
    },
    gatingContributions: allContributions.filter((contribution) => contribution.gating),
    advisoryContributions: allContributions.filter((contribution) => !contribution.gating),
    allContributions
  }) as VerdictReport;
}

export async function writeVerdictReport(options: WriteVerdictReportOptions): Promise<{ report: VerdictReport; reportPath: string; markdownPath: string }> {
  const report = await buildVerdictReport(options);
  const reportPath = resolveArtifact(options.rootDir, options.outputPath ?? path.join(".visual-hive", "verdict.json"));
  const markdownPath = resolveArtifact(options.rootDir, options.markdownPath ?? path.join(".visual-hive", "verdict.md"));
  await writeJson(reportPath, report);
  await writeText(markdownPath, renderVerdictMarkdown(report));
  return { report, reportPath, markdownPath };
}

export function renderVerdictMarkdown(report: VerdictReport): string {
  const lines = [
    `# Visual Hive Verdict: ${report.project}`,
    "",
    `- Generated: ${report.generatedAt}`,
    `- Verdict: ${report.summary.visualHiveVerdict}`,
    "- Authority: Visual Hive deterministic Verdict Engine",
    "- Default browser backend: Playwright",
    "- LLMs, agents, MCP tools, and Hive: advisory only",
    "- Providers: gating only when normalized, trusted, configured, and budget-authorized",
    "",
    "## Reasons",
    ...reasonLines("Failed", report.summary.failedBecause),
    ...reasonLines("Blocked", report.summary.blockedBecause),
    ...reasonLines("Warnings", report.summary.warningBecause),
    ...reasonLines("Advisory", report.summary.advisoryOnly),
    "",
    "## Gating Contributions",
    ...contributionLines(report.gatingContributions),
    "",
    "## Advisory Contributions",
    ...contributionLines(report.advisoryContributions)
  ];
  return `${sanitizeText(lines.join("\n"))}\n`;
}

function contributionRows(contributions: EvidenceContribution[]): VerdictContribution[] {
  return contributions.map((contribution) => ({
    ...contribution,
    key: contributionKey(contribution)
  }));
}

function contributionKey(contribution: EvidenceContribution): string {
  const id = contribution.contractId ?? contribution.operator ?? contribution.providerId;
  return [contribution.source, contribution.kind, id].filter(Boolean).join(".");
}

function countStatus(contributions: VerdictContribution[], status: VerdictContribution["status"]): number {
  return contributions.filter((contribution) => contribution.status === status).length;
}

function contributionLines(contributions: VerdictContribution[]): string[] {
  if (!contributions.length) return ["- none"];
  return contributions.map((contribution) => `- [${contribution.status}] ${contribution.key}: ${contribution.reason}`);
}

function reasonLines(label: string, reasons: string[]): string[] {
  if (!reasons.length) return [`- ${label}: none`];
  return [`- ${label}:`, ...reasons.map((reason) => `  - ${reason}`)];
}

function resolveArtifact(rootDir: string, artifactPath: string): string {
  return path.isAbsolute(artifactPath) ? artifactPath : path.resolve(rootDir, artifactPath);
}

function relative(rootDir: string, artifactPath: string): string {
  return path.relative(rootDir, artifactPath).replaceAll(path.sep, "/");
}

async function readOptional<T>(filePath: string): Promise<T | undefined> {
  try {
    return sanitizeValue(await readJson<T>(filePath)) as T;
  } catch {
    return undefined;
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === "string") return sanitizeText(value);
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeValue(item)]));
  return value;
}
