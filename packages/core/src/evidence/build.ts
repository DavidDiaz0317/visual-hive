import path from "node:path";
import { access } from "node:fs/promises";
import type { MutationReport, ProviderResult, Report, TriageReport } from "../reports/types.js";
import type { Plan } from "../planner/types.js";
import type { RepoMapReport } from "../repo/types.js";
import { readJson, writeJson, writeText } from "../utils/files.js";
import { sanitizeText } from "../utils/sanitize.js";
import type { EvidenceContribution, EvidencePacket, EvidencePacketTestingLayer, VerdictSummary, VisualHiveVerdict } from "./types.js";

type EvidenceContributionInput = Omit<EvidenceContribution, "key" | "authority">;

export interface BuildEvidencePacketOptions {
  rootDir: string;
  project: string;
  now?: Date;
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

export interface WriteEvidencePacketOptions extends BuildEvidencePacketOptions {
  outputPath?: string;
  markdownPath?: string;
}

export async function buildEvidencePacket(options: BuildEvidencePacketOptions): Promise<EvidencePacket> {
  const artifactPaths = {
    plan: resolveArtifact(options.rootDir, options.planPath ?? path.join(".visual-hive", "plan.json")),
    report: resolveArtifact(options.rootDir, options.reportPath ?? path.join(".visual-hive", "report.json")),
    mutationReport: resolveArtifact(options.rootDir, options.mutationReportPath ?? path.join(".visual-hive", "mutation-report.json")),
    triageReport: resolveArtifact(options.rootDir, options.triageReportPath ?? path.join(".visual-hive", "triage.json")),
    providerResults: resolveArtifact(options.rootDir, options.providerResultsPath ?? path.join(".visual-hive", "provider-results.json")),
    readiness: resolveArtifact(options.rootDir, options.readinessPath ?? path.join(".visual-hive", "readiness.json")),
    coverage: resolveArtifact(options.rootDir, options.coveragePath ?? path.join(".visual-hive", "coverage.json")),
    repoMap: resolveArtifact(options.rootDir, options.repoMapPath ?? path.join(".visual-hive", "repo-map.json")),
    artifactsIndex: resolveArtifact(options.rootDir, options.artifactsIndexPath ?? path.join(".visual-hive", "artifacts-index.json"))
  };

  const plan = await readOptional<Plan>(artifactPaths.plan);
  const report = await readOptional<Report>(artifactPaths.report);
  const mutationReport = await readOptional<MutationReport>(artifactPaths.mutationReport);
  const triageReport = await readOptional<TriageReport>(artifactPaths.triageReport);
  const providerRunReport = await readOptional<{ providers?: Array<{ result?: ProviderResult }> }>(artifactPaths.providerResults);
  const readiness = await readOptional<{ status?: string; score?: number; gates?: Array<{ status?: string; title?: string; message?: string }> }>(artifactPaths.readiness);
  const coverage = await readOptional<{ summary?: Record<string, unknown>; uncoveredAreas?: Array<{ severity?: string; message?: string }> }>(artifactPaths.coverage);
  const repoMap = await readOptional<RepoMapReport>(artifactPaths.repoMap);

  const providerResults = [
    ...(report?.providerResults ?? []),
    ...(providerRunReport?.providers?.map((provider) => provider.result).filter((result): result is ProviderResult => Boolean(result)) ?? [])
  ];

  const evidenceContributions = normalizeEvidenceContributions(sanitizeValue([
    ...contributionsFromPlan(plan),
    ...contributionsFromReport(report),
    ...contributionsFromMutation(mutationReport),
    ...contributionsFromProviders(providerResults, report?.mode),
    ...contributionsFromReadiness(readiness),
    ...contributionsFromCoverage(coverage),
    ...contributionsFromTriage(triageReport)
  ]) as EvidenceContributionInput[]);
  const verdictSummary = aggregateVerdict(evidenceContributions);
  const testingLayers = buildTestingLayers({ plan, report, mutationReport, providerResults, coverage, triageReport, repoMap });
  const generatedAt = (options.now ?? new Date()).toISOString();

  const packet: EvidencePacket = {
    schemaVersion: "visual-hive.evidence-packet.v1",
    generatedAt,
    project: report?.project ?? mutationReport?.project ?? plan?.project ?? options.project,
    sourceArtifacts: sanitizeValue({
      plan: (await exists(artifactPaths.plan)) ? relative(options.rootDir, artifactPaths.plan) : undefined,
      report: (await exists(artifactPaths.report)) ? relative(options.rootDir, artifactPaths.report) : undefined,
      mutationReport: (await exists(artifactPaths.mutationReport)) ? relative(options.rootDir, artifactPaths.mutationReport) : undefined,
      triageReport: (await exists(artifactPaths.triageReport)) ? relative(options.rootDir, artifactPaths.triageReport) : undefined,
      providerResults: (await exists(artifactPaths.providerResults)) ? relative(options.rootDir, artifactPaths.providerResults) : undefined,
      readiness: (await exists(artifactPaths.readiness)) ? relative(options.rootDir, artifactPaths.readiness) : undefined,
      coverage: (await exists(artifactPaths.coverage)) ? relative(options.rootDir, artifactPaths.coverage) : undefined,
      repoMap: (await exists(artifactPaths.repoMap)) ? relative(options.rootDir, artifactPaths.repoMap) : undefined,
      artifactsIndex: (await exists(artifactPaths.artifactsIndex)) ? relative(options.rootDir, artifactPaths.artifactsIndex) : undefined
    }) as EvidencePacket["sourceArtifacts"],
    governance: {
      verdictAuthority: "visual_hive",
      defaultBrowserBackend: "playwright",
      llmAuthority: "advisory_only",
      providerAuthority: "policy_gated_when_normalized",
      secretPolicy: "redacted_values_names_only"
    },
    repo: sanitizeValue({
      repository: report?.repository.repository,
      branch: report?.repository.branch,
      commitSha: report?.repository.commitSha,
      runContext: report?.repository.provider
    }) as EvidencePacket["repo"],
    repoIntelligence: repoMap
      ? (sanitizeValue({
          project: repoMap.project,
          sourceSummary: repoMap.sourceSummary,
          testTools: repoMap.testTools,
          targetHints: repoMap.targetHints,
          riskSignals: repoMap.riskSignals,
          coverageGaps: repoMap.coverageGaps,
          selectorCount: repoMap.selectors.length,
          routeCount: repoMap.routes.length,
          workflowCount: repoMap.workflows.length
        }) as EvidencePacket["repoIntelligence"])
      : undefined,
    plan: plan
      ? sanitizeValue({
          schemaVersion: plan.schemaVersion,
          project: plan.project,
          mode: plan.mode,
          generatedAt: plan.generatedAt,
          changedFiles: plan.changedFiles,
          effectiveChangedFiles: plan.effectiveChangedFiles,
          selectedContracts: plan.items.map((item) => item.contractId),
          selectedTargets: plan.targets.map((target) => target.id),
          excludedContracts: plan.excluded
        }) as EvidencePacket["plan"]
      : undefined,
    deterministicReport: report
      ? sanitizeValue({
          schemaVersion: report.schemaVersion,
          project: report.project,
          mode: report.mode,
          generatedAt: report.generatedAt,
          status: report.status,
          selectedTargets: report.selectedTargets,
          selectedContracts: report.selectedContracts,
          excludedContracts: report.excludedContracts,
          summary: report.summary,
          generatedSpecPath: report.generatedSpecPath,
          reproductionCommands: report.reproductionCommands,
          failedContracts: report.results
            .filter((result) => result.status === "failed")
            .map((result) => ({
              contractId: result.contractId,
              targetId: result.targetId,
              errors: result.errors,
              artifacts: result.artifacts,
              reproductionCommand: result.reproductionCommand
            })),
          screenshotEvidence: report.results.flatMap((result) =>
            (result.screenshotAssertions ?? []).map((screenshot) => ({
              contractId: screenshot.contractId,
              screenshotName: screenshot.screenshotName,
              status: screenshot.status,
              route: screenshot.route,
              viewport: screenshot.viewport,
              baselinePath: screenshot.baselinePath,
              actualPath: screenshot.actualPath,
              diffPath: screenshot.diffPath,
              actualDiffPixelRatio: screenshot.actualDiffPixelRatio,
              actualDiffPixels: screenshot.actualDiffPixels
            }))
          ),
          consoleErrors: report.summary.consoleErrors,
          pageErrors: report.summary.pageErrors,
          networkErrors: report.results.reduce((count, result) => count + (result.networkErrors?.length ?? 0), 0)
        }) as EvidencePacket["deterministicReport"]
      : undefined,
    mutation: mutationReport
      ? sanitizeValue({
          schemaVersion: mutationReport.schemaVersion,
          project: mutationReport.project,
          generatedAt: mutationReport.generatedAt,
          minScore: mutationReport.minScore,
          score: mutationReport.score,
          killed: mutationReport.killed,
          total: mutationReport.total,
          survivedOperators: mutationReport.results
            .filter((result) => result.status === "survived")
            .map((result) => ({
              operator: result.operator,
              contractIds: result.contractIds,
              failedAssertion: result.failedAssertion,
              artifacts: result.artifacts ?? []
            })),
          notApplicableOperators: mutationReport.results.filter((result) => result.status === "not_applicable").map((result) => result.operator)
        }) as EvidencePacket["mutation"]
      : undefined,
    providers: sanitizeValue(
      providerResults.map((provider) => ({
        providerId: provider.providerId,
        label: provider.label,
        status: provider.status,
        deterministicRole: provider.deterministicRole,
        message: provider.message,
        requiredEnv: provider.requiredEnv,
        missingEnv: provider.missingEnv,
        artifactCount: provider.artifactCount
      }))
    ) as EvidencePacket["providers"],
    triage: triageReport
      ? sanitizeValue({
          schemaVersion: triageReport.schemaVersion,
          project: triageReport.project,
          generatedAt: triageReport.generatedAt,
          summary: triageReport.summary,
          findings: triageReport.findings.map((finding) => ({
            classification: finding.classification,
            severity: finding.severity,
            title: finding.title,
            evidence: finding.evidence,
            contractIds: finding.contractIds,
            targetIds: finding.targetIds,
            suggestedNextTests: finding.suggestedNextTests
          }))
        }) as EvidencePacket["triage"]
      : undefined,
    testingLayers: sanitizeValue(testingLayers) as EvidencePacketTestingLayer[],
    evidenceContributions,
    verdictSummary,
    hiveReadiness: {
      readyForIssueHandoff: Boolean(report || triageReport) && verdictSummary.visualHiveVerdict !== "inconclusive",
      readyForHiveDryRun: Boolean(report || triageReport || mutationReport) && evidenceContributions.length > 0,
      blockedReasons: hiveBlockedReasons(verdictSummary, report, triageReport),
      suggestedLabels: ["visual-hive", "hive/quality", "ai-ready"]
    }
  };

  return packet;
}

export async function writeEvidencePacket(options: WriteEvidencePacketOptions): Promise<{ packet: EvidencePacket; packetPath: string; summaryPath: string }> {
  const packet = await buildEvidencePacket(options);
  const packetPath = resolveArtifact(options.rootDir, options.outputPath ?? path.join(".visual-hive", "evidence-packet.json"));
  const summaryPath = resolveArtifact(options.rootDir, options.markdownPath ?? path.join(".visual-hive", "evidence-summary.md"));
  await writeJson(packetPath, packet);
  await writeText(summaryPath, renderEvidenceSummary(packet));
  return { packet, packetPath, summaryPath };
}

export function renderEvidenceSummary(packet: EvidencePacket): string {
  const lines = [
    `# Visual Hive Evidence Packet: ${packet.project}`,
    "",
    `- Generated: ${packet.generatedAt}`,
    `- Visual Hive verdict: ${packet.verdictSummary.visualHiveVerdict}`,
    "- Verdict authority: Visual Hive deterministic Verdict Engine",
    "- Default browser backend: Playwright",
    "- LLM / agent authority: advisory only",
    "",
    "## Verdict Reasons",
    ...reasonLines("Failed", packet.verdictSummary.failedBecause),
    ...reasonLines("Blocked", packet.verdictSummary.blockedBecause),
    ...reasonLines("Warnings", packet.verdictSummary.warningBecause),
    ...reasonLines("Advisory", packet.verdictSummary.advisoryOnly),
    "",
    "## Evidence Contributions",
    ...packet.evidenceContributions.map((contribution) => `- [${contribution.status}] ${contribution.source}.${contribution.kind}: ${contribution.reason}`),
    "",
    "## Testing Layers",
    ...packet.testingLayers.map((layer) => `- ${layer.id}. ${layer.name}: ${layer.status}${layer.gaps.length ? ` (${layer.gaps.join("; ")})` : ""}`),
    "",
    "## Handoff Readiness",
    `- Issue handoff ready: ${packet.hiveReadiness.readyForIssueHandoff}`,
    `- Hive dry-run ready: ${packet.hiveReadiness.readyForHiveDryRun}`,
    `- Labels: ${packet.hiveReadiness.suggestedLabels.join(", ")}`
  ];
  if (packet.hiveReadiness.blockedReasons.length) {
    lines.push(`- Blocked reasons: ${packet.hiveReadiness.blockedReasons.join("; ")}`);
  }
  return `${sanitizeText(lines.join("\n"))}\n`;
}

function contributionsFromPlan(plan?: Plan): EvidenceContributionInput[] {
  if (!plan) {
    return [{ source: "visual_hive", kind: "plan", status: "inconclusive", gating: false, reason: "No plan artifact was available.", artifacts: [] }];
  }
  if (plan.items.length === 0) {
    return [
      {
        source: "visual_hive",
        kind: "plan_selection",
        status: "blocked",
        gating: true,
        mode: plan.mode,
        reason: "No contracts were selected for this plan.",
        artifacts: [".visual-hive/plan.json"]
      }
    ];
  }
  return [
    {
      source: "visual_hive",
      kind: "plan_selection",
      status: "passed",
      gating: false,
      mode: plan.mode,
      reason: `${plan.items.length} contract(s) selected for ${plan.mode} mode.`,
      artifacts: [".visual-hive/plan.json"]
    }
  ];
}

function contributionsFromReport(report?: Report): EvidenceContributionInput[] {
  if (!report) {
    return [{ source: "playwright", kind: "deterministic_run", status: "inconclusive", gating: true, reason: "No deterministic report was available.", artifacts: [] }];
  }
  const contributions: EvidenceContributionInput[] = [
    {
      source: "playwright",
      kind: "deterministic_run",
      status: report.status === "passed" ? "passed" : "failed",
      gating: true,
      mode: report.mode,
      reason: `Deterministic contract run ${report.status}.`,
      artifacts: [".visual-hive/report.json", report.generatedSpecPath]
    }
  ];
  for (const result of report.results.filter((item) => item.status === "failed")) {
    contributions.push({
      source: "playwright",
      kind: "contract_result",
      status: "failed",
      gating: true,
      mode: report.mode,
      contractId: result.contractId,
      targetId: result.targetId,
      reason: result.errors[0] ?? `Contract ${result.contractId} failed.`,
      artifacts: result.artifacts
    });
  }
  for (const result of report.results) {
    for (const screenshot of result.screenshotAssertions ?? []) {
      if (screenshot.status === "failed" || screenshot.status === "missing_baseline") {
        contributions.push({
          source: "screenshot_diff",
          kind: screenshot.status,
          status: screenshot.status === "missing_baseline" ? "blocked" : "failed",
          gating: true,
          mode: report.mode,
          contractId: result.contractId,
          targetId: result.targetId,
          reason: screenshot.message ?? `${screenshot.screenshotName} ${screenshot.status}.`,
          artifacts: [screenshot.actualPath, screenshot.baselinePath, screenshot.diffPath].filter((artifact): artifact is string => Boolean(artifact))
        });
      } else if (screenshot.status === "created") {
        contributions.push({
          source: "screenshot_diff",
          kind: "created_baseline",
          status: "warning",
          gating: false,
          mode: report.mode,
          contractId: result.contractId,
          targetId: result.targetId,
          reason: `${screenshot.screenshotName} baseline was created and should be reviewed.`,
          artifacts: [screenshot.actualPath, screenshot.baselinePath]
        });
      }
    }
    const runtimeErrors = [...(result.consoleErrors ?? []), ...(result.pageErrors ?? [])];
    for (const error of runtimeErrors) {
      contributions.push({
        source: "playwright",
        kind: `${error.type}_error`,
        status: result.status === "failed" ? "failed" : "warning",
        gating: result.status === "failed",
        mode: report.mode,
        contractId: result.contractId,
        targetId: result.targetId,
        reason: error.message,
        artifacts: result.artifacts
      });
    }
  }
  return contributions;
}

function contributionsFromMutation(mutationReport?: MutationReport): EvidenceContributionInput[] {
  if (!mutationReport) return [];
  const contributions: EvidenceContributionInput[] = [];
  if (mutationReport.total > 0 && mutationReport.score < mutationReport.minScore) {
    contributions.push({
      source: "mutation",
      kind: "mutation_adequacy",
      status: "failed",
      gating: true,
      reason: `Mutation score ${Math.round(mutationReport.score * 100)}% is below minimum ${Math.round(mutationReport.minScore * 100)}%.`,
      artifacts: [".visual-hive/mutation-report.json"]
    });
  } else if (mutationReport.total > 0) {
    contributions.push({
      source: "mutation",
      kind: "mutation_adequacy",
      status: "passed",
      gating: true,
      reason: `Mutation score ${Math.round(mutationReport.score * 100)}% met minimum ${Math.round(mutationReport.minScore * 100)}%.`,
      artifacts: [".visual-hive/mutation-report.json"]
    });
  }
  for (const result of mutationReport.results) {
    if (result.status === "survived") {
      contributions.push({
        source: "mutation",
        kind: "mutation_survivor",
        status: "failed",
        gating: true,
        operator: result.operator,
        reason: result.failedAssertion ?? `${result.operator} survived selected contracts.`,
        artifacts: result.artifacts ?? []
      });
    } else if (result.status === "not_applicable") {
      contributions.push({
        source: "mutation",
        kind: "not_applicable",
        status: "skipped",
        gating: false,
        operator: result.operator,
        reason: `${result.operator} had no relevant selected contracts.`,
        artifacts: result.artifacts ?? []
      });
    }
  }
  return contributions;
}

function contributionsFromProviders(providers: ProviderResult[], mode?: string): EvidenceContributionInput[] {
  return providers.map((provider) => {
    const gating = provider.deterministicRole === "oracle";
    return {
      source: "provider",
      kind: "normalized_provider_result",
      status: provider.status === "failed" ? "failed" : provider.status === "passed" ? "passed" : "skipped",
      gating,
      mode,
      providerId: provider.providerId,
      reason: provider.message,
      artifacts: []
    };
  });
}

function contributionsFromReadiness(readiness?: { status?: string; score?: number; gates?: Array<{ status?: string; title?: string; message?: string }> }): EvidenceContributionInput[] {
  if (!readiness) return [];
  if (readiness.status === "blocked") {
    return [
      {
        source: "readiness",
        kind: "readiness_gate",
        status: "blocked",
        gating: true,
        reason: `Readiness gate is blocked (${readiness.score ?? "unknown"}/100).`,
        artifacts: [".visual-hive/readiness.json"]
      }
    ];
  }
  if (readiness.status === "warning") {
    return [
      {
        source: "readiness",
        kind: "readiness_gate",
        status: "warning",
        gating: false,
        reason: `Readiness gate has warnings (${readiness.score ?? "unknown"}/100).`,
        artifacts: [".visual-hive/readiness.json"]
      }
    ];
  }
  return [
    {
      source: "readiness",
      kind: "readiness_gate",
      status: "passed",
      gating: false,
      reason: `Readiness gate ${readiness.status ?? "available"}.`,
      artifacts: [".visual-hive/readiness.json"]
    }
  ];
}

function contributionsFromCoverage(coverage?: { uncoveredAreas?: Array<{ severity?: string; message?: string }> }): EvidenceContributionInput[] {
  if (!coverage) return [];
  const highGaps = coverage.uncoveredAreas?.filter((gap) => gap.severity === "high").length ?? 0;
  if (highGaps > 0) {
    return [
      {
        source: "coverage",
        kind: "coverage_gap",
        status: "warning",
        gating: false,
        reason: `${highGaps} high-severity coverage gap(s) found.`,
        artifacts: [".visual-hive/coverage.json"]
      }
    ];
  }
  return [];
}

function contributionsFromTriage(triage?: TriageReport): EvidenceContributionInput[] {
  if (!triage) return [];
  return triage.findings.map((finding) => ({
    source: "triage",
    kind: finding.classification,
    status: finding.severity === "critical" || finding.severity === "high" ? "warning" : "skipped",
    gating: false,
    contractId: finding.contractIds?.[0],
    targetId: finding.targetIds?.[0],
    reason: finding.title,
    artifacts: []
  }));
}

export function aggregateVerdict(contributions: EvidenceContribution[]): VerdictSummary {
  const failedBecause = contributions.filter((item) => item.gating && item.status === "failed").map(contributionKey);
  const blockedBecause = contributions.filter((item) => item.gating && item.status === "blocked").map(contributionKey);
  const warningBecause = contributions.filter((item) => item.status === "warning").map(contributionKey);
  const inconclusiveBecause = contributions.filter((item) => item.gating && item.status === "inconclusive").map(contributionKey);
  const advisoryOnly = contributions.filter((item) => !item.gating).map(contributionKey);
  let visualHiveVerdict: VisualHiveVerdict = "passed";
  if (failedBecause.length > 0) visualHiveVerdict = "failed";
  else if (blockedBecause.length > 0) visualHiveVerdict = "blocked";
  else if (inconclusiveBecause.length > 0) visualHiveVerdict = "inconclusive";
  else if (warningBecause.length > 0) visualHiveVerdict = "warning";
  return {
    visualHiveVerdict,
    failedBecause,
    warningBecause,
    blockedBecause: [...blockedBecause, ...inconclusiveBecause],
    advisoryOnly
  };
}

function buildTestingLayers(input: {
  plan?: Plan;
  report?: Report;
  mutationReport?: MutationReport;
  providerResults: ProviderResult[];
  coverage?: { uncoveredAreas?: Array<{ severity?: string; message?: string }> };
  triageReport?: TriageReport;
  repoMap?: RepoMapReport;
}): EvidencePacketTestingLayer[] {
  return [
    layer(
      0,
      "Repo intelligence",
      input.repoMap ? "covered" : input.plan ? "partial" : "unknown",
      input.repoMap ? [".visual-hive/repo-map.json", ".visual-hive/repo-context.md"] : input.plan ? [".visual-hive/plan.json"] : [],
      input.repoMap ? input.repoMap.coverageGaps.map((gap) => gap.message).slice(0, 5) : input.plan ? ["Run visual-hive analyze for source-level repo intelligence."] : ["No repo-map or plan artifact found."]
    ),
    layer(1, "Static/build/workflow safety", "unknown", [], ["Use readiness/security/workflow artifacts for full coverage."]),
    layer(2, "Unit", "unknown", [], ["Unit test evidence is not yet normalized into Evidence Packet."]),
    layer(3, "Component/accessibility", "unknown", [], ["Accessibility evidence is not yet normalized."]),
    layer(4, "API/contract", "partial", input.report ? [".visual-hive/report.json"] : [], input.report ? [] : ["No deterministic report found."]),
    layer(5, "Component visual", input.report?.summary.screenshotsPassed || input.report?.summary.screenshotsFailed ? "covered" : "partial", [".visual-hive/report.json"], []),
    layer(6, "E2E user-flow", input.report ? "covered" : "missing", input.report ? [".visual-hive/report.json"] : [], input.report ? [] : ["No deterministic browser report found."]),
    layer(7, "Cross-browser/device provider", input.providerResults.length ? "partial" : "missing", input.providerResults.length ? [".visual-hive/provider-results.json"] : [], input.providerResults.length ? [] : ["No provider-normalized result found."]),
    layer(8, "Canary/protected", input.plan?.mode === "schedule" || input.plan?.mode === "canary" ? "partial" : "unknown", input.plan ? [".visual-hive/plan.json"] : [], []),
    layer(9, "Mutation/fault injection", input.mutationReport ? "covered" : "missing", input.mutationReport ? [".visual-hive/mutation-report.json"] : [], input.mutationReport ? [] : ["No mutation report found."]),
    layer(10, "Flake/history/cost governance", "partial", [], ["History and cost artifacts are optional and not fully normalized in this packet."]),
    layer(11, "Agent/Hive feedback", input.triageReport ? "partial" : "missing", input.triageReport ? [".visual-hive/triage.json"] : [], input.triageReport ? [] : ["No triage artifact found."])
  ];
}

function layer(id: number, name: string, status: EvidencePacketTestingLayer["status"], evidence: string[], gaps: string[]): EvidencePacketTestingLayer {
  return { id, name, status, evidence, gaps };
}

function hiveBlockedReasons(verdict: VerdictSummary, report?: Report, triage?: TriageReport): string[] {
  const reasons: string[] = [];
  if (!report && !triage) reasons.push("No report or triage artifact is available.");
  if (verdict.visualHiveVerdict === "inconclusive") reasons.push("Evidence is insufficient for a confident handoff.");
  return reasons;
}

function normalizeEvidenceContributions(contributions: EvidenceContributionInput[]): EvidenceContribution[] {
  return contributions.map((contribution) => ({
    ...contribution,
    key: contributionKey(contribution),
    authority: contribution.gating ? "gating" : "advisory"
  }));
}

function contributionKey(contribution: Pick<EvidenceContribution, "source" | "kind" | "contractId" | "operator" | "providerId">): string {
  const id = contribution.contractId ?? contribution.operator ?? contribution.providerId;
  return [contribution.source, contribution.kind, id].filter(Boolean).join(".");
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === "string") return sanitizeText(value);
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeValue(item)]));
  }
  return value;
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

function reasonLines(label: string, reasons: string[]): string[] {
  if (!reasons.length) return [`- ${label}: none`];
  return [`- ${label}:`, ...reasons.map((reason) => `  - ${reason}`)];
}
