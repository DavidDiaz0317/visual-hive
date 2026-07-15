import path from "node:path";
import { access } from "node:fs/promises";
import type { MutationReport, ProviderResult, Report, TriageReport } from "../reports/types.js";
import type { Plan } from "../planner/types.js";
import type { RepoMapReport } from "../repo/types.js";
import { incompleteUnitTestScopeMessages, isUnitLayerTestFile, unitTestScopes } from "../repo/testEvidence.js";
import type { VisualHiveConfig } from "../config/schema.js";
import { normalizeHiveExportConfig } from "../hive/build.js";
import { API_500_MUTATION_MARKER } from "../mutations/operators.js";
import { readJson, writeJson, writeText } from "../utils/files.js";
import { sanitizeArtifactPathsForMarkdown, sanitizeText } from "../utils/sanitize.js";
import {
  evidenceContributionKey,
  type EvidenceContribution,
  type EvidencePacket,
  type EvidencePacketHiveMode,
  type EvidencePacketHiveModeReadiness,
  type EvidencePacketTestingLayer,
  type VerdictSummary,
  type VisualHiveVerdict
} from "./types.js";

type EvidenceContributionInput = Omit<EvidenceContribution, "key" | "authority">;
const HIVE_MODES: EvidencePacketHiveMode[] = ["advisory", "measured", "repair_request", "guarded_repair", "full"];

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
  hiveConfig?: Partial<VisualHiveConfig["integrations"]["hive"]>;
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

  const plan = await readOptional<Plan>(options.rootDir, artifactPaths.plan);
  const report = await readOptional<Report>(options.rootDir, artifactPaths.report);
  const mutationReport = await readOptional<MutationReport>(options.rootDir, artifactPaths.mutationReport);
  const triageReport = await readOptional<TriageReport>(options.rootDir, artifactPaths.triageReport);
  const providerRunReport = await readOptional<{ providers?: Array<{ result?: ProviderResult }> }>(options.rootDir, artifactPaths.providerResults);
  const readiness = await readOptional<{ status?: string; score?: number; gates?: Array<{ status?: string; title?: string; message?: string }> }>(options.rootDir, artifactPaths.readiness);
  const coverage = await readOptional<{ summary?: Record<string, unknown>; uncoveredAreas?: Array<{ severity?: string; message?: string }> }>(options.rootDir, artifactPaths.coverage);
  const repoMap = await readOptional<RepoMapReport>(options.rootDir, artifactPaths.repoMap);

  const providerResults = [
    ...(report?.providerResults ?? []),
    ...(providerRunReport?.providers?.map((provider) => provider.result).filter((result): result is ProviderResult => Boolean(result)) ?? [])
  ];

  const evidenceContributions = normalizeEvidenceContributions(sanitizeValue(options.rootDir, [
    ...contributionsFromPlan(plan),
    ...contributionsFromReport(report),
    ...contributionsFromMutation(mutationReport),
    ...contributionsFromProviders(providerResults.filter((provider) => provider.providerId !== "playwright"), report?.mode),
    ...contributionsFromReadiness(readiness),
    ...contributionsFromCoverage(coverage),
    ...contributionsFromTriage(triageReport)
  ]) as EvidenceContributionInput[]);
  const verdictSummary = aggregateVerdict(evidenceContributions);
  const testingLayers = buildTestingLayers({ plan, report, mutationReport, providerResults, coverage, triageReport, repoMap });
  const generatedAt = (options.now ?? new Date()).toISOString();
  const readyForIssueHandoff = Boolean(report || triageReport) && verdictSummary.visualHiveVerdict !== "inconclusive";
  const readyForHiveDryRun = Boolean(report || triageReport || mutationReport) && evidenceContributions.length > 0;
  const hiveReadinessBlockedReasons = hiveBlockedReasons(verdictSummary, report, triageReport);
  const modeReadiness = buildHiveModeReadiness({
    readyForHiveDryRun,
    baseBlockedReasons: hiveReadinessBlockedReasons,
    evidenceContributions,
    testingLayers,
    hiveConfig: options.hiveConfig
  });
  const hiveRecommendation = recommendHiveMode(modeReadiness);

  const packet: EvidencePacket = {
    schemaVersion: "visual-hive.evidence-packet.v2",
    generatedAt,
    project: report?.project ?? mutationReport?.project ?? plan?.project ?? options.project,
    sourceArtifacts: sanitizeValue(options.rootDir, {
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
    repo: sanitizeValue(options.rootDir, {
      repository: report?.repository.repository,
      branch: report?.repository.branch,
      commitSha: report?.repository.commitSha,
      runContext: report?.repository.provider
    }) as EvidencePacket["repo"],
    repoIntelligence: repoMap
      ? (sanitizeValue(options.rootDir, {
          project: repoMap.project,
          sourceSummary: repoMap.sourceSummary,
          testTools: repoMap.testTools,
          testFiles: repoMap.testFiles ?? [],
          testRunners: repoMap.testRunners ?? [],
          runtimeScopes: repoMap.runtimeScopes ?? [],
          targetHints: repoMap.targetHints,
          riskSignals: repoMap.riskSignals,
          coverageGaps: repoMap.coverageGaps,
          selectorCount: repoMap.selectors.length,
          routeCount: repoMap.routes.length,
          workflowCount: repoMap.workflows.length
        }) as EvidencePacket["repoIntelligence"])
      : undefined,
    plan: plan
      ? sanitizeValue(options.rootDir, {
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
      ? sanitizeValue(options.rootDir, {
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
      ? sanitizeValue(options.rootDir, {
          schemaVersion: mutationReport.schemaVersion,
          project: mutationReport.project,
          generatedAt: mutationReport.generatedAt,
          minScore: mutationReport.minScore,
          score: mutationReport.score,
          killed: mutationReport.killed,
          total: mutationReport.total,
          killedOperators: mutationReport.results
            .filter((result) => result.status === "killed")
            .map((result) => ({
              operator: result.operator,
              contractIds: result.contractIds,
              affected: result.affected,
              artifacts: result.artifacts ?? [],
              suggestedMissingTest: result.suggestedMissingTest
            })),
          survivedOperators: mutationReport.results
            .filter((result) => result.status === "survived")
            .map((result) => ({
              operator: result.operator,
              contractIds: result.contractIds,
              failedAssertion: result.failedAssertion,
              affected: result.affected,
              artifacts: result.artifacts ?? [],
              suggestedMissingTest: result.suggestedMissingTest,
              validationCommand: result.validationCommand
            })),
          notApplicableOperators: mutationReport.results.filter((result) => result.status === "not_applicable").map((result) => result.operator)
        }) as EvidencePacket["mutation"]
      : undefined,
    providers: sanitizeValue(options.rootDir,
      providerResults.map((provider) => ({
        providerId: provider.providerId,
        label: provider.label,
        status: provider.status,
        deterministicRole: provider.deterministicRole,
        message: provider.message,
        requiredEnv: provider.requiredEnv,
        missingEnv: provider.missingEnv,
        artifactCount: provider.artifactCount,
        externalUrl: provider.externalUrl,
        externalUploadAllowed: provider.externalUploadAllowed,
        externalUploadBlockedReasons: provider.externalUploadBlockedReasons,
        estimatedExternalScreenshots: provider.estimatedExternalScreenshots,
        upload: provider.upload
          ? {
              status: provider.upload.status,
              externalCallsMade: provider.upload.externalCallsMade,
              uploadedArtifacts: provider.upload.uploadedArtifacts,
              stagedArtifacts: provider.upload.stagedArtifacts,
              manifestPath: provider.upload.manifestPath,
              uploadDirectory: provider.upload.uploadDirectory,
              command: provider.upload.command,
              stdout: provider.upload.stdout,
              stderr: provider.upload.stderr,
              providerUrl: provider.upload.providerUrl,
              blockedReasons: provider.upload.blockedReasons ?? []
            }
          : undefined
      }))
    ) as EvidencePacket["providers"],
    triage: triageReport
      ? sanitizeValue(options.rootDir, {
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
    testingLayers: sanitizeValue(options.rootDir, testingLayers) as EvidencePacketTestingLayer[],
    evidenceContributions,
    verdictSummary,
    hiveReadiness: {
      readyForIssueHandoff,
      readyForHiveDryRun,
      blockedReasons: hiveReadinessBlockedReasons,
      suggestedLabels: ["visual-hive", "hive/quality", "ai-ready"],
      recommendedMode: hiveRecommendation.mode,
      recommendationReason: hiveRecommendation.reason,
      modeReadiness
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

export function buildReportVerdict(report: Report): { verdictSummary: VerdictSummary; verdictContributions: EvidenceContribution[] } {
  const verdictContributions = normalizeEvidenceContributions([
    ...contributionsFromReport(report),
    ...contributionsFromProviders((report.providerResults ?? []).filter((provider) => provider.providerId !== "playwright"), report.mode)
  ]);
  return {
    verdictContributions,
    verdictSummary: aggregateVerdict(verdictContributions)
  };
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
    `- Recommended Hive mode: ${packet.hiveReadiness.recommendedMode}`,
    `- Recommendation: ${packet.hiveReadiness.recommendationReason}`,
    `- Labels: ${packet.hiveReadiness.suggestedLabels.join(", ")}`
  ];
  if (packet.hiveReadiness.blockedReasons.length) {
    lines.push(`- Blocked reasons: ${packet.hiveReadiness.blockedReasons.join("; ")}`);
  }
  lines.push(
    "",
    "## Hive Mode Readiness",
    ...packet.hiveReadiness.modeReadiness.map((entry) =>
      `- ${entry.mode}: ${entry.status}; ${entry.reason}${entry.blockedReasons.length ? ` (${entry.blockedReasons.join("; ")})` : ""}`
    )
  );
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
  const reportBlockedOnly = report.status === "failed" && reportHasBlockingCondition(report) && !report.results.some((result) => resultHasRegressionFailure(result));
  const contributions: EvidenceContributionInput[] = [
    {
      source: "playwright",
      kind: "deterministic_run",
      status: report.status === "passed" ? "passed" : reportBlockedOnly ? "blocked" : "failed",
      gating: true,
      mode: report.mode,
      reason: reportBlockedOnly ? "Deterministic contract run was blocked by environment or policy evidence." : `Deterministic contract run ${report.status}.`,
      artifacts: [".visual-hive/report.json", report.generatedSpecPath]
    }
  ];
  for (const event of report.targetLifecycle.filter((event) => event.status === "failed")) {
    contributions.push({
      source: "visual_hive",
      kind: "target_lifecycle_failure",
      status: "blocked",
      gating: true,
      mode: report.mode,
      targetId: event.targetId,
      reason: event.message ?? `${event.phase} failed for target ${event.targetId}.`,
      artifacts: [".visual-hive/report.json"]
    });
  }
  for (const target of report.selectedTargets.filter((target) => (target.missingSecrets?.length ?? 0) > 0)) {
    contributions.push({
      source: "visual_hive",
      kind: "protected_target_missing_secret",
      status: "blocked",
      gating: true,
      mode: report.mode,
      targetId: target.id,
      reason: `Protected target ${target.id} is missing required secret name(s): ${target.missingSecrets?.join(", ")}.`,
      artifacts: [".visual-hive/report.json"]
    });
  }
  for (const result of report.results.filter((item) => item.status === "failed")) {
    const resultBlockedOnly = resultHasBlockingCondition(report, result) && !resultHasRegressionFailure(result);
    contributions.push({
      source: "playwright",
      kind: "contract_result",
      status: resultBlockedOnly ? "blocked" : "failed",
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

function reportHasBlockingCondition(report: Report): boolean {
  return (
    report.targetLifecycle.some((event) => event.status === "failed") ||
    report.selectedTargets.some((target) => (target.missingSecrets?.length ?? 0) > 0) ||
    report.results.some((result) => resultHasBlockingCondition(report, result))
  );
}

function resultHasBlockingCondition(report: Report, result: Report["results"][number]): boolean {
  return (
    report.targetLifecycle.some((event) => event.targetId === result.targetId && event.status === "failed") ||
    report.selectedTargets.some((target) => target.id === result.targetId && (target.missingSecrets?.length ?? 0) > 0) ||
    (result.screenshotAssertions ?? []).some((screenshot) => screenshot.status === "missing_baseline")
  );
}

function resultHasRegressionFailure(result: Report["results"][number]): boolean {
  if (result.status !== "failed") return false;
  return (
    (result.selectorAssertions ?? []).some((assertion) => assertion.status === "failed") ||
    (result.flowSteps ?? []).some((step) => step.status === "failed") ||
    (result.screenshotAssertions ?? []).some((screenshot) => screenshot.status === "failed") ||
    (result.consoleErrors?.length ?? 0) > 0 ||
    (result.pageErrors?.length ?? 0) > 0 ||
    (result.networkErrors?.length ?? 0) > 0
  );
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
      const scope = primaryMutationRepairScope(result);
      const repairGuidance = safeMutationRepairGuidance(result.operator, scope.contractId);
      contributions.push({
        source: "mutation",
        kind: "mutation_survivor",
        status: "failed",
        gating: true,
        operator: result.operator,
        ...(repairGuidance ? scope : {}),
        reason: [result.failedAssertion ?? `${result.operator} survived selected contracts.`, repairGuidance].filter(Boolean).join(" "),
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

function primaryMutationRepairScope(result: MutationReport["results"][number]): { contractId?: string; targetId?: string } {
  const affected = result.affectedSurfaces ?? result.affected ?? [];
  const contractIds = [...new Set([...(result.contractIds ?? []), ...affected.map((surface) => surface.contractId)].map((value) => value.trim()).filter(Boolean))]
    .sort(stableStringCompare);
  const contractId = contractIds[0];
  if (!contractId) return {};
  const targetIds = [...new Set(
    affected
      .filter((surface) => surface.contractId.trim() === contractId)
      .map((surface) => surface.targetId?.trim())
      .filter((value): value is string => Boolean(value))
  )].sort(stableStringCompare);
  return {
    contractId,
    ...(targetIds.length === 1 ? { targetId: targetIds[0] } : {})
  };
}

function safeMutationRepairGuidance(operator: string, contractId?: string): string | undefined {
  if (operator !== "api-500" || !contractId) return undefined;
  return `Safe repository-scoped repair: update contract ${JSON.stringify(contractId)} in visual-hive.config.yaml so selectors.textMustNotExist includes the exact first-party marker ${JSON.stringify(API_500_MUTATION_MARKER)}; do not invent or replace this marker.`;
}

function stableStringCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function contributionsFromProviders(providers: ProviderResult[], mode?: string): EvidenceContributionInput[] {
  return providers.flatMap((provider) => {
    const gating = provider.deterministicRole === "oracle";
    const status = provider.status === "failed" ? "failed" : provider.status === "passed" ? "passed" : gating ? "blocked" : "skipped";
    const contributions: EvidenceContributionInput[] = [{
      source: "provider",
      kind: "normalized_provider_result",
      status,
      gating,
      mode,
      providerId: provider.providerId,
      reason: provider.message,
      artifacts: []
    }];
    if (provider.upload) {
      const uploadStatus = provider.upload.status;
      const uploadContributionStatus =
        uploadStatus === "uploaded"
          ? "warning"
          : uploadStatus === "failed" || uploadStatus === "blocked" || uploadStatus === "missing_credentials"
            ? "blocked"
            : "skipped";
      contributions.push({
        source: "provider",
        kind: "provider_upload",
        status: uploadContributionStatus,
        gating: gating && uploadContributionStatus === "blocked",
        mode,
        providerId: provider.providerId,
        reason: providerUploadReason(provider),
        artifacts: [provider.upload.manifestPath, provider.upload.uploadDirectory].filter((artifact): artifact is string => Boolean(artifact))
      });
    }
    return contributions;
  });
}

function providerUploadReason(provider: ProviderResult): string {
  const upload = provider.upload;
  if (!upload) return `${provider.label} upload evidence is not available.`;
  const detail = upload.blockedReasons?.length ? ` ${upload.blockedReasons.join("; ")}` : "";
  if (upload.status === "uploaded") return `${provider.label} uploaded ${upload.uploadedArtifacts} artifact(s); provider evidence remains policy-gated.`;
  if (upload.status === "dry_run") return `${provider.label} dry run staged ${upload.stagedArtifacts} artifact(s) without external calls.`;
  if (upload.status === "failed") return `${provider.label} upload command failed.${detail}`;
  if (upload.status === "missing_credentials") return `${provider.label} upload is missing required credential name(s).${detail}`;
  if (upload.status === "blocked") return `${provider.label} upload is blocked by policy.${detail}`;
  return `${provider.label} upload was skipped.${detail}`;
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
  const failedBecause = contributions.filter((item) => item.gating && item.status === "failed").map(evidenceContributionKey);
  const blockedBecause = contributions.filter((item) => item.gating && item.status === "blocked").map(evidenceContributionKey);
  const warningBecause = contributions.filter((item) => item.status === "warning").map(evidenceContributionKey);
  const inconclusiveBecause = contributions.filter((item) => item.gating && item.status === "inconclusive").map(evidenceContributionKey);
  const advisoryOnly = contributions.filter((item) => !item.gating).map(evidenceContributionKey);
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
  const unitFiles = (input.repoMap?.testFiles ?? []).filter((file) => isUnitLayerTestFile(file) && file.runnerEligible);
  const unitScopes = unitTestScopes(input.repoMap?.testRunners ?? [], input.repoMap?.testFiles ?? [], input.repoMap?.runtimeScopes ?? []);
  const incompleteScopes = incompleteUnitTestScopeMessages(unitScopes);
  const actionableUnitGap = input.repoMap?.coverageGaps.find((gap) => gap.id === "unit-layer" && !gap.suggestedArtifact.startsWith("advisory-only:"));
  const classifiedIncompleteScopes = incompleteScopes.map((message) => actionableUnitGap?.message.includes(message) ? message : `Advisory-only: ${message}`);
  const unitStatus: EvidencePacketTestingLayer["status"] = !input.repoMap
    ? "unknown"
    : unitScopes.length > 0 && incompleteScopes.length === 0
      ? "covered"
      : unitScopes.length > 0
        ? "partial"
        : "missing";
  const unitGap = unitStatus === "covered"
    ? []
    : unitStatus === "unknown"
      ? ["Run visual-hive analyze to discover repository unit-test evidence."]
      : classifiedIncompleteScopes.length > 0
        ? classifiedIncompleteScopes
        : ["No deterministic repository unit-test runner or executable unit test file was detected."];
  return [
    layer(
      0,
      "Repo intelligence",
      input.repoMap ? "covered" : input.plan ? "partial" : "unknown",
      input.repoMap ? [".visual-hive/repo-map.json", ".visual-hive/repo-context.md"] : input.plan ? [".visual-hive/plan.json"] : [],
      input.repoMap ? input.repoMap.coverageGaps.map((gap) => gap.message).slice(0, 5) : input.plan ? ["Run visual-hive analyze for source-level repo intelligence."] : ["No repo-map or plan artifact found."]
    ),
    layer(1, "Static/build/workflow safety", "unknown", [], ["Use readiness/security/workflow artifacts for full coverage."]),
    layer(
      2,
      "Unit",
      unitStatus,
      input.repoMap ? [".visual-hive/repo-map.json", ...unitFiles.map((file) => file.path).slice(0, 20)] : [],
      unitGap
    ),
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

function buildHiveModeReadiness(input: {
  readyForHiveDryRun: boolean;
  baseBlockedReasons: string[];
  evidenceContributions: EvidenceContribution[];
  testingLayers: EvidencePacketTestingLayer[];
  hiveConfig?: Partial<VisualHiveConfig["integrations"]["hive"]>;
}): EvidencePacketHiveModeReadiness[] {
  const config = normalizeHiveExportConfig(input.hiveConfig);
  const actionableEvidence = input.evidenceContributions.some(
    (contribution) =>
      contribution.status === "failed" ||
      contribution.status === "blocked" ||
      contribution.kind === "mutation_survivor" ||
      contribution.kind === "coverage_gap"
  );
  const testingLayerGaps = input.testingLayers.some((layer) => layer.status === "missing" || layer.status === "partial" || layer.status === "unknown");
  const hasRepairReadyEvidence = actionableEvidence || testingLayerGaps;
  return HIVE_MODES.map((mode) => {
    const blockedReasons = [...input.baseBlockedReasons];
    if (!input.readyForHiveDryRun) blockedReasons.push("Hive dry-run requires deterministic, triage, or mutation evidence.");
    if (mode === "repair_request" && !hasRepairReadyEvidence) {
      blockedReasons.push("No failed, blocked, mutation, coverage, or testing-layer evidence is available for repair work orders.");
    }
    if (mode === "guarded_repair") {
      if (!config.enabled) blockedReasons.push("Guarded Hive repair requires integrations.hive.enabled=true in a trusted workflow.");
      if (!config.repair.enabled) blockedReasons.push("Guarded Hive repair requires integrations.hive.repair.enabled=true.");
      if (config.acmmLevel < 5) blockedReasons.push("Guarded Hive repair requires ACMM level 5 or higher.");
      if (!config.repair.prOnly) blockedReasons.push("Guarded Hive repair must remain PR-only.");
      if (!config.repair.requireHumanReview) blockedReasons.push("Guarded Hive repair requires human review.");
      if (!config.repair.rerunVisualHive) blockedReasons.push("Guarded Hive repair requires a Visual Hive rerun before completion.");
      if (!hasRepairReadyEvidence) blockedReasons.push("No repair-ready evidence is available for guarded repair.");
    }
    if (mode === "full") {
      blockedReasons.push("Full Hive automation is reserved for a future ACMM L6-compatible workflow and is blocked locally.");
    }
    const trustedWorkflowRequired = mode === "guarded_repair" || mode === "full";
    const status: EvidencePacketHiveModeReadiness["status"] = blockedReasons.length
      ? "blocked"
      : trustedWorkflowRequired
        ? "trusted_only"
        : "ready";
    return {
      mode,
      status,
      reason: hiveModeReason(mode, status),
      nextCommand: hiveModeNextCommand(mode, status),
      localPreviewAllowed: !trustedWorkflowRequired && status === "ready",
      trustedWorkflowRequired,
      externalCallsMade: 0,
      emits: hiveModeEmits(mode),
      blockedReasons: dedupe(blockedReasons)
    };
  });
}

function recommendHiveMode(entries: EvidencePacketHiveModeReadiness[]): { mode: EvidencePacketHiveMode; reason: string } {
  const repairRequest = entries.find((entry) => entry.mode === "repair_request" && entry.status === "ready");
  if (repairRequest) {
    return {
      mode: "repair_request",
      reason: "Repair-request mode can package deterministic evidence into bounded work orders without granting Hive verdict authority."
    };
  }
  const measured = entries.find((entry) => entry.mode === "measured" && entry.status === "ready");
  if (measured) {
    return {
      mode: "measured",
      reason: "Measured mode can emit Beads, facts, graph context, and wiki pages without repair authority."
    };
  }
  const advisory = entries.find((entry) => entry.mode === "advisory" && entry.status === "ready");
  if (advisory) {
    return {
      mode: "advisory",
      reason: "Advisory mode is the safest available Hive context export."
    };
  }
  return {
    mode: "advisory",
    reason: "Hive export is blocked until an Evidence Packet includes deterministic, triage, or mutation evidence."
  };
}

function hiveModeReason(mode: EvidencePacketHiveMode, status: EvidencePacketHiveModeReadiness["status"]): string {
  if (status === "blocked") return `${mode} is blocked by missing evidence or governance policy.`;
  if (mode === "advisory") return "Advisory mode can package sanitized issue context and policy only.";
  if (mode === "measured") return "Measured mode can add Beads, knowledge facts, graph context, and wiki pages.";
  if (mode === "repair_request") return "Repair-request mode can emit bounded repair work orders for a trusted lane.";
  if (mode === "guarded_repair") return "Guarded repair is ready only for a trusted workflow, branch isolation, human review, and Visual Hive rerun.";
  return "Full automation is reserved for future mature governance.";
}

function hiveModeNextCommand(mode: EvidencePacketHiveMode, status: EvidencePacketHiveModeReadiness["status"]): string {
  if (status === "blocked") return "visual-hive hive compare-modes";
  if (mode === "guarded_repair" || mode === "full") return "trusted workflow required";
  return `visual-hive hive export --dry-run --mode ${mode}`;
}

function hiveModeEmits(mode: EvidencePacketHiveMode): EvidencePacketHiveModeReadiness["emits"] {
  return {
    issueContext: true,
    beads: mode !== "advisory",
    knowledgeFacts: mode !== "advisory",
    knowledgeGraph: mode !== "advisory",
    wikiVault: mode !== "advisory",
    repairWorkOrders: mode === "repair_request" || mode === "guarded_repair" || mode === "full",
    agentPolicy: true
  };
}

function normalizeEvidenceContributions(contributions: EvidenceContributionInput[]): EvidenceContribution[] {
  return contributions.map((contribution) => ({
    ...contribution,
    key: evidenceContributionKey(contribution),
    authority: contribution.gating ? "gating" : "advisory"
  }));
}

function sanitizeValue(rootDir: string, value: unknown): unknown {
  if (typeof value === "string") return sanitizeArtifactPathsForMarkdown(rootDir, sanitizeText(value));
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(rootDir, item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeValue(rootDir, item)]));
  }
  return value;
}

function resolveArtifact(rootDir: string, artifactPath: string): string {
  return path.isAbsolute(artifactPath) ? artifactPath : path.resolve(rootDir, artifactPath);
}

function relative(rootDir: string, artifactPath: string): string {
  return path.relative(rootDir, artifactPath).replaceAll(path.sep, "/");
}

async function readOptional<T>(rootDir: string, filePath: string): Promise<T | undefined> {
  try {
    return sanitizeValue(rootDir, await readJson<T>(filePath)) as T;
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

function dedupe(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
