import path from "node:path";
import { access } from "node:fs/promises";
import { buildEvidencePacket } from "../evidence/build.js";
import type { EvidencePacket, EvidencePacketTestingLayer } from "../evidence/types.js";
import { getEvidenceResourceById } from "../tools/evidenceResources.js";
import { readJson, writeJson, writeText } from "../utils/files.js";
import { sanitizeText } from "../utils/sanitize.js";
import type { TestingLayerOutputResource, TestingLayerReport } from "./types.js";

export interface BuildTestingLayerReportOptions {
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

export interface WriteTestingLayerReportOptions extends BuildTestingLayerReportOptions {
  outputPath?: string;
  markdownPath?: string;
}

export async function buildTestingLayerReport(options: BuildTestingLayerReportOptions): Promise<TestingLayerReport> {
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
  const evidencePacketExists = await exists(evidencePacketPath);
  const layers = evidencePacket.testingLayers.map(expandLayer);
  const summary = summarizeLayers(layers);
  const report: TestingLayerReport = {
    schemaVersion: 1,
    generatedAt: (options.now ?? new Date()).toISOString(),
    project: evidencePacket.project,
    outputResource: catalogedTestingLayerOutputResource(),
    sourceArtifacts: sanitizeValue({
      evidencePacket: evidencePacketExists ? relative(options.rootDir, evidencePacketPath) : undefined,
      ...evidencePacket.sourceArtifacts
    }) as TestingLayerReport["sourceArtifacts"],
    governance: {
      verdictAuthority: "visual_hive",
      defaultBrowserBackend: "playwright",
      agentAuthority: "advisory_only"
    },
    summary,
    layers: sanitizeValue(layers) as TestingLayerReport["layers"],
    recommendations: sanitizeValue(recommendationsFor(layers)) as string[]
  };
  return report;
}

function catalogedTestingLayerOutputResource(): TestingLayerOutputResource {
  const resource = getEvidenceResourceById("testing-layers");
  return {
    artifactPath: ".visual-hive/testing-layers.json",
    evidenceResourceId: resource?.id ?? "testing-layers",
    evidenceResourceUri: resource?.uri ?? "visual-hive://testing-layers",
    evidenceResourceTitle: resource?.title ?? "Testing Layers",
    evidenceResourceDescription:
      resource?.description ?? "Testing-layer coverage lattice, missing-layer evidence, and advisory next steps.",
    evidenceReadToolName: resource?.readTool?.name ?? "visual_hive_read_testing_layers"
  };
}

export async function writeTestingLayerReport(options: WriteTestingLayerReportOptions): Promise<{ report: TestingLayerReport; reportPath: string; markdownPath: string }> {
  const report = await buildTestingLayerReport(options);
  const reportPath = resolveArtifact(options.rootDir, options.outputPath ?? path.join(".visual-hive", "testing-layers.json"));
  const markdownPath = resolveArtifact(options.rootDir, options.markdownPath ?? path.join(".visual-hive", "testing-layers.md"));
  await writeJson(reportPath, report);
  await writeText(markdownPath, renderTestingLayerMarkdown(report));
  return { report, reportPath, markdownPath };
}

export function renderTestingLayerMarkdown(report: TestingLayerReport): string {
  const lines = [
    `# Visual Hive Testing Layers: ${report.project}`,
    "",
    `- Generated: ${report.generatedAt}`,
    `- Status: ${report.summary.status}`,
    `- Covered: ${report.summary.covered}/${report.summary.totalLayers}`,
    `- Partial: ${report.summary.partial}`,
    `- Missing: ${report.summary.missing}`,
    `- Unknown: ${report.summary.unknown}`,
    `- Gaps: ${report.summary.gapCount}`,
    "- Verdict authority: Visual Hive deterministic Verdict Engine",
    "- Agents and LLMs may use this audit for guidance only.",
    "",
    "## Layers",
    ...report.layers.map((layer) => `- ${layer.id}. ${layer.name}: ${layer.status}${layer.gaps.length ? ` - ${layer.gaps.join("; ")}` : ""}`),
    "",
    "## Recommendations",
    ...(report.recommendations.length ? report.recommendations.map((recommendation) => `- ${recommendation}`) : ["- none"])
  ];
  return `${sanitizeText(lines.join("\n"))}\n`;
}

function expandLayer(layer: EvidencePacketTestingLayer): TestingLayerReport["layers"][number] {
  const skippedReasons = layer.status === "covered" ? [] : layer.gaps;
  return {
    ...layer,
    skippedReasons,
    recommendedNextStep: recommendedNextStep(layer)
  };
}

function summarizeLayers(layers: TestingLayerReport["layers"]): TestingLayerReport["summary"] {
  const count = (status: EvidencePacketTestingLayer["status"]) => layers.filter((layer) => layer.status === status).length;
  const missing = count("missing");
  const unknown = count("unknown");
  const partial = count("partial");
  const summary = {
    totalLayers: layers.length,
    covered: count("covered"),
    partial,
    missing,
    notApplicable: count("not_applicable"),
    unknown,
    gapCount: layers.reduce((sum, layer) => sum + layer.gaps.length, 0),
    status: "covered" as TestingLayerReport["summary"]["status"]
  };
  if (missing > 0 || unknown > 0) summary.status = "missing_evidence";
  else if (partial > 0 || summary.gapCount > 0) summary.status = "attention";
  return summary;
}

function recommendationsFor(layers: TestingLayerReport["layers"]): string[] {
  const recommendations = new Set<string>();
  for (const layer of layers) {
    if (layer.recommendedNextStep && layer.status !== "covered" && layer.status !== "not_applicable") recommendations.add(layer.recommendedNextStep);
  }
  recommendations.add("Keep deterministic evidence as the verdict source; use agents only for repair and missing-test suggestions.");
  return [...recommendations];
}

function recommendedNextStep(layer: EvidencePacketTestingLayer): string | undefined {
  if (layer.status === "covered" || layer.status === "not_applicable") return undefined;
  const firstGap = layer.gaps[0];
  if (firstGap) return firstGap;
  if (layer.id === 0) return "Run visual-hive analyze to produce repo intelligence.";
  if (layer.id === 6) return "Run visual-hive run to produce deterministic browser evidence.";
  if (layer.id === 9) return "Run visual-hive mutate to measure mutation adequacy.";
  return `Add or normalize evidence for ${layer.name}.`;
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
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, sanitizeValue(child)]));
  return value;
}
