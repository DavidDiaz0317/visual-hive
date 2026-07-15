import crypto from "node:crypto";
import path from "node:path";
import { readJson, writeJson, writeText } from "../utils/files.js";
import { sanitizeArtifactPathForIssue, sanitizeArtifactPathsForMarkdown, sanitizeText } from "../utils/sanitize.js";
import type { MutationReport, Report, TriageReport } from "../reports/types.js";
import { writeVisualGraphArtifacts } from "../graph/build.js";
import type { RepoMapReport } from "../repo/types.js";
import { TestCreationPlanV2Schema, type TestCreationRecommendation } from "../testCreation/types.js";
import { VISUAL_HIVE_STANDALONE_LIFECYCLE } from "./lifecycle.js";
import type { VisualHiveIssueCandidate, VisualHiveIssueQueue, VisualHiveIssuesReport, VisualHiveIssueSuppression, VisualHiveLifecyclePolicy, VisualHiveSetupIssue } from "./types.js";

type JsonObject = Record<string, unknown>;

interface MutationPublicationRoot {
  rootCauseKey: string;
  operator: string;
  targetId: string;
  contractIds: string[];
}

interface TestAdequacyPublicationRoot {
  rootCauseKey: string;
  layerId: number;
}

interface PublicationContext {
  mutationRoots: MutationPublicationRoot[];
  testAdequacyRoots: TestAdequacyPublicationRoot[];
  readinessBlockedRootKeys?: string[];
}

interface TestCreationAutomationView {
  recommendations: TestCreationRecommendation[];
  canResolveTestAdequacy: boolean;
  resolutionBlockReason?: string;
}

const DEFAULT_GUARDRAILS = [
  "Visual Hive does not repair code; it detects, proves, packages, and routes this finding.",
  "Hive or an agent may act only from a trusted issue or handoff artifact.",
  "Do not approve baselines blindly.",
  "Do not weaken screenshot thresholds, selector contracts, or mutation thresholds to make the issue disappear.",
  "Rerun the listed Visual Hive validation command before marking the issue resolved."
];

const DEFAULT_LABELS = ["visual-hive", "hive/quality", "visual-hive/live", "visual-hive/ready-for-hive"];
const ISSUE_QUEUE_LABELS = [
  "visual-hive",
  "visual-hive/ready",
  "visual-hive/live",
  "visual-hive/still-active",
  "visual-hive/ready-for-hive",
  "visual-hive/blocked",
  "visual-hive/resolved-candidate",
  "visual-hive/agent-setup",
  "visual-hive/agent-map",
  "visual-hive/agent-test-creator",
  "visual-hive/agent-test-maintainer",
  "visual-hive/agent-mutation",
  "hive/quality",
  "hive/ci",
  "hive/architect",
  "mutation-survivor",
  "missing-coverage",
  "visual-regression",
  "map-drift",
  "stale-baseline"
];

export interface BuildIssuesOptions {
  rootDir: string;
  project?: string;
  now?: Date;
  sourcePaths?: Partial<VisualHiveIssuesReport["sourceArtifacts"]>;
  suppressionPath?: string;
  lifecycle?: VisualHiveLifecyclePolicy;
}

export interface WriteIssuesOptions extends BuildIssuesOptions {
  issuesPath?: string;
  markdownPath?: string;
  queuePath?: string;
  setupIssuePath?: string;
}

export async function buildIssuesReport(options: BuildIssuesOptions): Promise<{ report: VisualHiveIssuesReport; markdown: string; queue: VisualHiveIssueQueue; setupIssue: VisualHiveSetupIssue }> {
  const rootDir = path.resolve(options.rootDir);
  const sourceArtifacts = defaultSourceArtifacts(options.sourcePaths);
  const [report, mutationReport, triage, coverage, coverageRecommendations, repoMap, visualGraph, visualImpact, workflows, readiness, evidencePacket, handoff, hiveExport, knowledgeGraph, agentPacket, testCreationPlan, previousIssues, suppressions] =
    await Promise.all([
      readOptional<Report>(rootDir, sourceArtifacts.report),
      readOptional<MutationReport>(rootDir, sourceArtifacts.mutationReport),
      readOptional<TriageReport>(rootDir, sourceArtifacts.triage),
      readOptional<JsonObject>(rootDir, sourceArtifacts.coverage),
      readOptional<JsonObject>(rootDir, sourceArtifacts.coverageRecommendations),
      readOptional<JsonObject>(rootDir, sourceArtifacts.repoMap),
      readOptional<JsonObject>(rootDir, sourceArtifacts.visualGraph),
      readOptional<JsonObject>(rootDir, sourceArtifacts.visualImpact),
      readOptional<JsonObject>(rootDir, sourceArtifacts.workflows),
      readOptional<JsonObject>(rootDir, sourceArtifacts.readiness),
      readOptional<JsonObject>(rootDir, sourceArtifacts.evidencePacket),
      readOptional<JsonObject>(rootDir, sourceArtifacts.handoff),
      readOptional<JsonObject>(rootDir, sourceArtifacts.hiveExport),
      readOptional<JsonObject>(rootDir, sourceArtifacts.knowledgeGraph),
      readOptional<JsonObject>(rootDir, sourceArtifacts.agentPacket),
      readOptional<unknown>(rootDir, sourceArtifacts.testCreationPlan),
      readOptional<VisualHiveIssuesReport>(rootDir, ".visual-hive/issues.json"),
      readSuppressions(rootDir, options.suppressionPath ?? ".visual-hive/issue-suppressions.json")
    ]);
  const project = options.project ?? report?.project ?? readString(evidencePacket, "project") ?? "unknown";
  const generatedAt = (options.now ?? new Date()).toISOString();
  const testCreationAutomation = testCreationAutomationView(testCreationPlan);
  const publication = buildPublicationContext(mutationReport, testCreationAutomation, readiness);
  const current = [
    ...issuesFromReport(report, sourceArtifacts),
    ...issuesFromMutation(mutationReport, sourceArtifacts, publication),
    ...issuesFromTriage(triage, sourceArtifacts),
    ...issuesFromCoverage(coverage, coverageRecommendations, sourceArtifacts, publication),
    ...issuesFromRepoMap(repoMap, sourceArtifacts, publication),
    ...issuesFromWorkflows(workflows, sourceArtifacts),
    ...issuesFromReadiness(readiness, sourceArtifacts),
    ...issuesFromProviderEvidence(evidencePacket, sourceArtifacts),
    ...issuesFromHandoff(handoff, sourceArtifacts, publication),
    ...issuesFromTestCreation(testCreationAutomation, repoMap, sourceArtifacts, publication)
  ];

  const previousByFingerprint = new Map((previousIssues?.issues ?? []).map((issue) => [issue.dedupeFingerprint, issue]));
  const keyed = new Map<string, VisualHiveIssueCandidate>();
  for (const issue of current) {
    const candidate = normalizeIssue(issue, rootDir, project, {
      evidencePacket: exists(sourceArtifacts.evidencePacket, evidencePacket),
      repoMap: exists(sourceArtifacts.repoMap, repoMap),
      visualGraph: exists(sourceArtifacts.visualGraph, visualGraph),
      visualImpact: exists(sourceArtifacts.visualImpact, visualImpact),
      mutationReport: exists(sourceArtifacts.mutationReport, mutationReport),
      handoff: exists(sourceArtifacts.handoff, handoff),
      hiveExport: exists(sourceArtifacts.hiveExport, hiveExport),
      knowledgeGraph: exists(sourceArtifacts.knowledgeGraph, knowledgeGraph),
      agentPacket: exists(sourceArtifacts.agentPacket, agentPacket)
    });
    const previous = previousByFingerprint.get(candidate.dedupeFingerprint);
    if (previous && previous.status !== "resolved_candidate" && previous.status !== "suppressed") {
      candidate.status = "update_candidate";
      candidate.labels = dedupe([...candidate.labels, "visual-hive/still-active"]);
      candidate.body = renderIssueBody(candidate, issueSummary(candidate.body), rootDir);
    }
    keyed.set(candidate.dedupeFingerprint, candidate);
  }

  for (const previous of previousIssues?.issues ?? []) {
    if (!keyed.has(previous.dedupeFingerprint) && previous.status !== "resolved_candidate" && previous.status !== "suppressed") {
      if (previous.issueKind === "test_adequacy_gap" && !testCreationAutomation.canResolveTestAdequacy) {
        const blocked = {
          ...ensurePublicationMetadata(previous),
          status: "blocked" as const,
          labels: dedupe([...previous.labels, "visual-hive/blocked"]),
          sourceArtifacts: dedupe([...previous.sourceArtifacts, sourceArtifacts.testCreationPlan ?? ".visual-hive/test-creation-plan.json"]),
          guardrails: DEFAULT_GUARDRAILS,
          validationCommand: previous.validationCommand || "visual-hive test-creation-plan && visual-hive issues --write"
        };
        keyed.set(previous.dedupeFingerprint, {
          ...blocked,
          body: renderIssueBody(
            blocked,
            `Resolution is blocked because the current test-creation plan cannot authoritatively omit this repository-specific finding: ${testCreationAutomation.resolutionBlockReason ?? "the plan is not eligible for automated resolution"}. A structurally valid visual-hive.test-creation-plan.v2 with grounded evidence, or a valid empty/no-relevant v2 plan, is required.`,
            rootDir
          )
        });
        continue;
      }
      keyed.set(previous.dedupeFingerprint, {
        ...ensurePublicationMetadata(previous),
        status: "resolved_candidate",
        labels: dedupe([...previous.labels, "visual-hive/resolved-candidate"]),
        body: renderIssueBody({
          ...ensurePublicationMetadata(previous),
          status: "resolved_candidate",
          labels: dedupe([...previous.labels, "visual-hive/resolved-candidate"]),
          sourceArtifacts: dedupe([...previous.sourceArtifacts, sourceArtifacts.evidencePacket ?? ".visual-hive/evidence-packet.json"]),
          guardrails: DEFAULT_GUARDRAILS,
          validationCommand: previous.validationCommand || "visual-hive evidence && visual-hive issues --write"
        }, undefined, rootDir)
      });
    }
  }

  const suppressionByFingerprint = new Map(suppressions.map((entry) => [entry.dedupeFingerprint, entry]));
  const issues = [...keyed.values()]
    .map((issue) => applySuppression(issue, suppressionByFingerprint.get(issue.dedupeFingerprint)))
    .sort(compareIssues);

  const issuesReport: VisualHiveIssuesReport = sanitizeValue({
    schemaVersion: "visual-hive.issues.v1",
    generatedAt,
    project,
    externalCallsMade: 0,
    networkCallsMade: 0,
    lifecycle: options.lifecycle ?? VISUAL_HIVE_STANDALONE_LIFECYCLE,
    sourceArtifacts: presentSourceArtifacts(rootDir, sourceArtifacts, {
      report,
      mutationReport,
      triage,
      coverage,
      coverageRecommendations,
      repoMap,
      visualGraph,
      visualImpact,
      workflows,
      readiness,
      evidencePacket,
      handoff,
      hiveExport,
      knowledgeGraph,
      agentPacket,
      testCreationPlan
    }),
    summary: summarizeIssues(issues),
    issues
  }) as VisualHiveIssuesReport;
  const queue = buildIssueQueue(issuesReport, generatedAt);
  const setupIssue = buildSetupIssue({ project, generatedAt, sourceArtifacts: issuesReport.sourceArtifacts, repoMap, readiness, rootDir });
  return {
    report: issuesReport,
    markdown: renderIssuesMarkdown(issuesReport),
    queue,
    setupIssue
  };
}

export async function writeIssuesArtifacts(options: WriteIssuesOptions): Promise<{
  report: VisualHiveIssuesReport;
  markdown: string;
  queue: VisualHiveIssueQueue;
  setupIssue: VisualHiveSetupIssue;
  issuesPath: string;
  markdownPath: string;
  queuePath: string;
  setupIssuePath: string;
}> {
  const built = await buildIssuesReport(options);
  const issuesPath = resolve(options.rootDir, options.issuesPath ?? ".visual-hive/issues.json");
  const markdownPath = resolve(options.rootDir, options.markdownPath ?? ".visual-hive/issues.md");
  const queuePath = resolve(options.rootDir, options.queuePath ?? ".visual-hive/issue-queue.json");
  const setupIssuePath = resolve(options.rootDir, options.setupIssuePath ?? ".visual-hive/setup-issue.md");
  await writeJson(issuesPath, built.report);
  await writeText(markdownPath, built.markdown);
  await writeJson(queuePath, built.queue);
  await writeText(setupIssuePath, built.setupIssue.body);
  await refreshVisualGraphWithIssues(options.rootDir, built.report);
  return { ...built, issuesPath, markdownPath, queuePath, setupIssuePath };
}

export function buildIssueQueue(report: VisualHiveIssuesReport, generatedAt = new Date().toISOString()): VisualHiveIssueQueue {
  const readyForHive = report.issues.filter((issue) => issue.status === "open_candidate" || issue.status === "update_candidate");
  const readyForAgent = readyForHive.filter((issue) => !issue.sourceArtifacts.some((artifact) => artifact.includes("missing")));
  const blockedPolicy = report.issues.filter((issue) => issue.status === "blocked");
  const blockedMissingArtifact = report.issues.filter((issue) => issue.status !== "suppressed" && issue.status !== "resolved_candidate" && !issue.linkedEvidencePacket);
  const resolved = report.issues.filter((issue) => issue.status === "resolved_candidate");
  const suppressed = report.issues.filter((issue) => issue.status === "suppressed");
  return sanitizeValue({
    schemaVersion: "visual-hive.issue-queue.v1",
    generatedAt,
    project: report.project,
    externalCallsMade: 0,
    networkCallsMade: 0,
    summary: {
      total: report.issues.length,
      readyForHive: readyForHive.length,
      readyForVisualHiveAgent: readyForAgent.length,
      blockedPolicy: blockedPolicy.length,
      blockedMissingArtifact: blockedMissingArtifact.length,
      resolvedCandidates: resolved.length,
      suppressed: suppressed.length
    },
    labels: ISSUE_QUEUE_LABELS,
    queues: {
      ready_for_hive: readyForHive,
      ready_for_visual_hive_agent: readyForAgent,
      blocked_policy: blockedPolicy,
      blocked_missing_artifact: blockedMissingArtifact,
      resolved_candidate: resolved,
      suppressed
    }
  }) as VisualHiveIssueQueue;
}

export function renderIssuesMarkdown(report: VisualHiveIssuesReport): string {
  const lines = [
    `# Visual Hive Issue Candidates: ${report.project}`,
    "",
    "Visual Hive does not repair code. These issue candidates are deterministic evidence packets for humans, Hive, and agents.",
    "",
    `- Total: ${report.summary.total}`,
    `- Open candidates: ${report.summary.openCandidates}`,
    `- Update candidates: ${report.summary.updateCandidates}`,
    `- Resolved candidates: ${report.summary.resolvedCandidates}`,
    `- Suppressed: ${report.summary.suppressed}`,
    `- External calls made: ${report.externalCallsMade}`,
    "",
    "## Candidates"
  ];
  for (const issue of report.issues) {
    lines.push(
      "",
      `### ${issue.title}`,
      "",
      `- Kind: ${issue.issueKind}`,
      `- Severity: ${issue.severity}`,
      `- Status: ${issue.status}`,
      `- Dedupe: ${issue.dedupeFingerprint}`,
      `- Agent: ${issue.owningAgentHint}`,
      `- Labels: ${issue.labels.join(", ")}`,
      `- Validation: \`${issue.validationCommand}\``,
      "",
      issue.body
    );
  }
  return `${sanitizeText(lines.join("\n"))}\n`;
}

function issuesFromReport(report: Report | undefined, sourceArtifacts: VisualHiveIssuesReport["sourceArtifacts"]): VisualHiveIssueCandidate[] {
  if (!report) return [];
  const issues: VisualHiveIssueCandidate[] = [];
  for (const result of report.results ?? []) {
    if (result.status !== "failed") continue;
    const hasSelectorFailure = result.selectorAssertions?.some((assertion) => assertion.status === "failed");
    const hasScreenshotFailure = result.screenshotAssertions?.some((shot) => shot.status === "failed" || shot.status === "missing_baseline");
    issues.push(baseIssue({
      issueKind: hasSelectorFailure ? "selector_contract_failure" : hasScreenshotFailure ? "screenshot_diff" : "visual_regression",
      severity: reportSeverity(result.errors, "high"),
      title: `[Visual Hive] ${result.contractId} failed deterministic validation`,
      labels: ["visual-regression"],
      owningAgentHint: hasSelectorFailure ? "visual-hive/test-maintainer" : "hive/quality",
      sourceArtifacts: [sourceArtifacts.report ?? ".visual-hive/report.json"],
      affected: [
        {
          contractId: result.contractId,
          targetId: result.targetId,
          selector: result.selectorAssertions?.find((assertion) => assertion.status === "failed")?.value,
          route: result.screenshotAssertions?.[0]?.route,
          viewport: result.screenshotAssertions?.[0]?.viewport
        }
      ],
      reproductionCommand: result.reproductionCommand,
      validationCommand: result.reproductionCommand ?? "visual-hive run --ci && visual-hive evidence",
      bodySummary: `${result.contractId} failed with ${result.errors.length} error(s). ${result.errors.slice(0, 3).join(" ")}`
    }));
  }
  for (const result of report.results ?? []) {
    for (const shot of result.screenshotAssertions ?? []) {
      if (shot.status === "created" || shot.status === "missing_baseline") {
        issues.push(baseIssue({
          issueKind: shot.status === "created" ? "stale_baseline" : "screenshot_diff",
          severity: shot.status === "missing_baseline" ? "high" : "medium",
          title: `[Visual Hive] Review ${shot.status === "created" ? "created" : "missing"} baseline for ${shot.contractId}/${shot.screenshotName}`,
          labels: ["stale-baseline"],
          owningAgentHint: "visual-hive/test-maintainer",
          sourceArtifacts: [sourceArtifacts.report ?? ".visual-hive/report.json", shot.actualPath, shot.baselinePath, shot.diffPath].filter((artifact): artifact is string => Boolean(artifact)),
          affected: [{ contractId: shot.contractId, route: shot.route, viewport: shot.viewport }],
          reproductionCommand: result.reproductionCommand,
          validationCommand: "visual-hive baselines list --write && visual-hive run --ci",
          bodySummary: `Screenshot ${shot.screenshotName} on ${shot.viewport} reported baseline status ${shot.status}. Baseline review must be explicit.`
        }));
      }
    }
  }
  return issues;
}

function issuesFromMutation(
  report: MutationReport | undefined,
  sourceArtifacts: VisualHiveIssuesReport["sourceArtifacts"],
  publication: PublicationContext
): VisualHiveIssueCandidate[] {
  if (!report) return [];
  const structured = new Map<string, { root: MutationPublicationRoot; results: MutationReport["results"] }>();
  const unstructured: MutationReport["results"] = [];
  for (const result of (report.results ?? []).filter((candidate) => candidate.status === "survived")) {
    const root = mutationRootForResult(result, publication);
    if (!root) {
      unstructured.push(result);
      continue;
    }
    const group = structured.get(root.rootCauseKey) ?? { root, results: [] };
    group.results.push(result);
    structured.set(root.rootCauseKey, group);
  }
  const groups = [
    ...[...structured.values()].sort((left, right) => stableCompare(left.root.rootCauseKey, right.root.rootCauseKey)),
    ...unstructured
      .sort((left, right) => stableCompare(mutationResultSortKey(left), mutationResultSortKey(right)))
      .map((result) => ({ root: undefined, results: [result] }))
  ];
  return groups.map(({ root, results }) => mutationIssueForResults(results, sourceArtifacts, root));
}

function mutationIssueForResults(
  results: MutationReport["results"],
  sourceArtifacts: VisualHiveIssuesReport["sourceArtifacts"],
  root: MutationPublicationRoot | undefined
): VisualHiveIssueCandidate {
  const sortedResults = [...results].sort((left, right) => stableCompare(mutationResultSortKey(left), mutationResultSortKey(right)));
  const operator = root?.operator ?? sortedResults[0]?.operator ?? "unknown";
  const affected = uniqueMutationSurfaces(sortedResults.flatMap((result) => result.affectedSurfaces ?? result.affected ?? []));
  const validationCommands = stableUnique(sortedResults.map((result) => result.validationCommand).filter((value): value is string => Boolean(value)));
  const summaries = stableUnique(sortedResults.map((result) =>
    result.failedAssertion
      ?? result.suggestedMissingTest
      ?? `${result.operator} survived; add or strengthen a contract so the mutation is killed.`
  ));
  const bodySummary = [
    ...summaries,
    ...(validationCommands.length > 1
      ? ["Validation commands observed across this root cause:", ...validationCommands.map((command) => `- \`${command}\``)]
      : [])
  ].join("\n");
  const primaryValidation = validationCommands[0] ?? "visual-hive mutate --enforce-min-score";
  return baseIssue({
    issueKind: "mutation_survivor",
    severity: "high",
    title: `[Visual Hive] Mutation survived: ${operator}`,
    labels: ["mutation-survivor", "missing-coverage"],
    owningAgentHint: "visual-hive/mutation",
    sourceArtifacts: stableUnique([
      sourceArtifacts.mutationReport ?? ".visual-hive/mutation-report.json",
      ...sortedResults.flatMap((result) => result.artifacts ?? [])
    ]),
    affected,
    reproductionCommand: primaryValidation,
    validationCommand: primaryValidation,
    bodySummary,
    ...(root ? canonicalPublication(root.rootCauseKey) : {})
  });
}

function uniqueMutationSurfaces(
  surfaces: Array<NonNullable<MutationReport["results"][number]["affectedSurfaces"]>[number]>
): VisualHiveIssueCandidate["affected"] {
  const normalized = surfaces.map((surface) => ({
    contractId: surface.contractId,
    targetId: surface.targetId,
    route: surface.route,
    component: surface.component,
    viewport: surface.viewport
  }));
  return uniqueBy(normalized, mutationSurfaceSortKey).sort((left, right) => stableCompare(mutationSurfaceSortKey(left), mutationSurfaceSortKey(right)));
}

function mutationSurfaceSortKey(surface: VisualHiveIssueCandidate["affected"][number]): string {
  return JSON.stringify([
    surface.contractId ?? "",
    surface.targetId ?? "",
    surface.route ?? "",
    surface.component ?? "",
    surface.viewport ?? ""
  ]);
}

function mutationResultSortKey(result: MutationReport["results"][number]): string {
  return JSON.stringify([
    result.operator,
    result.validationCommand ?? "",
    result.failedAssertion ?? "",
    result.suggestedMissingTest ?? "",
    stableUnique(result.artifacts ?? []),
    uniqueMutationSurfaces(result.affectedSurfaces ?? result.affected ?? []).map(mutationSurfaceSortKey)
  ]);
}

function issuesFromTriage(report: TriageReport | undefined, sourceArtifacts: VisualHiveIssuesReport["sourceArtifacts"]): VisualHiveIssueCandidate[] {
  if (!report) return [];
  return (report.findings ?? [])
    .filter((finding) => ["coverage_gap", "insufficient_coverage", "provider_failure", "protected_target_missing_secret", "external_upload_blocked"].includes(finding.classification))
    .map((finding) =>
      baseIssue({
        issueKind: finding.classification.includes("coverage") ? "missing_visual_coverage" : finding.classification === "protected_target_missing_secret" ? "protected_target_blocked" : "provider_governance",
        severity: finding.severity,
        title: `[Visual Hive] ${finding.title}`,
        labels: finding.classification.includes("coverage") ? ["missing-coverage"] : ["visual-hive/blocked"],
        owningAgentHint: finding.classification.includes("coverage") ? "visual-hive/test-creator" : "hive/ci",
        sourceArtifacts: [sourceArtifacts.triage ?? ".visual-hive/triage.json"],
        affected: (finding.contractIds ?? []).map((contractId) => ({ contractId })),
        validationCommand: "visual-hive triage && visual-hive issues --write",
        bodySummary: finding.evidence.join("\n")
      })
    );
}

function issuesFromCoverage(
  coverage: JsonObject | undefined,
  recommendations: JsonObject | undefined,
  sourceArtifacts: VisualHiveIssuesReport["sourceArtifacts"],
  publication: PublicationContext
): VisualHiveIssueCandidate[] {
  const rows = arrayOfObjects(recommendations?.recommendations);
  const maintenance = arrayOfObjects(recommendations?.maintenanceFindings);
  const maintenanceById = new Map(maintenance.map((finding) => [readString(finding, "id"), finding] as const).filter((entry): entry is [string, JsonObject] => Boolean(entry[0])));
  const issues: VisualHiveIssueCandidate[] = rows.slice(0, 12).map((row) => {
    const maintenanceFinding = readString(row, "maintenanceFindingId") ? maintenanceById.get(readString(row, "maintenanceFindingId")!) : undefined;
    const root = mutationRootForCoverageRecord(row, maintenanceFinding, publication);
    return baseIssue({
      issueKind: "missing_visual_coverage",
      severity: severityFromString(readString(row, "priority") ?? readString(row, "severity"), "medium"),
      title: `[Visual Hive] Add visual coverage: ${readString(row, "title") ?? readString(row, "id") ?? "coverage recommendation"}`,
      labels: ["missing-coverage"],
      owningAgentHint: "visual-hive/test-creator",
      sourceArtifacts: [sourceArtifacts.coverageRecommendations ?? ".visual-hive/coverage-recommendations.json", sourceArtifacts.coverage ?? ".visual-hive/coverage.json"],
      affected: [{ contractId: readString(row, "contractId"), targetId: readString(row, "targetId") }],
      validationCommand: "visual-hive improve-coverage && visual-hive issues --write",
      bodySummary: readString(row, "description") ?? readString(row, "rationale") ?? JSON.stringify(row).slice(0, 800),
      ...(root ? derivativePublication(root.rootCauseKey) : {})
    });
  });
  for (const finding of maintenance.slice(0, 12)) {
    const root = mutationRootForCoverageRecord(finding, finding, publication);
    issues.push(
      baseIssue({
        issueKind: maintenanceKind(readString(finding, "kind")),
        severity: severityFromString(readString(finding, "severity"), "medium"),
        title: `[Visual Hive] Maintain visual test: ${readString(finding, "title") ?? readString(finding, "kind") ?? "maintenance finding"}`,
        labels: ["visual-hive/agent-test-maintainer"],
        owningAgentHint: "visual-hive/test-maintainer",
        sourceArtifacts: [sourceArtifacts.coverageRecommendations ?? ".visual-hive/coverage-recommendations.json"],
        affected: [{ contractId: readString(finding, "contractId"), route: readString(finding, "route"), viewport: readString(finding, "viewport") }],
        validationCommand: "visual-hive improve-coverage && visual-hive issues --write",
        bodySummary: readString(finding, "description") ?? JSON.stringify(finding).slice(0, 800),
        ...(root ? derivativePublication(root.rootCauseKey) : {})
      })
    );
  }
  if (!coverage && !recommendations) return [];
  return issues;
}

function issuesFromRepoMap(
  repoMap: JsonObject | undefined,
  sourceArtifacts: VisualHiveIssuesReport["sourceArtifacts"],
  publication: PublicationContext
): VisualHiveIssueCandidate[] {
  const gaps = arrayOfObjects(repoMap?.coverageGaps)
    .filter((gap) => !readString(gap, "suggestedArtifact")?.startsWith("advisory-only:"))
    .concat(arrayOfObjects(repoMap?.mapFindings));
  return gaps.slice(0, 10).map((gap) => {
    const layerId = readNumber(gap, "layer");
    const testRoot = readString(gap, "id") === "unit-layer" && layerId !== undefined
      ? publication.testAdequacyRoots.find((root) => root.layerId === layerId)
      : undefined;
    return baseIssue({
      issueKind: readString(gap, "kind")?.includes("map") ? "map_drift" : "missing_visual_coverage",
      severity: severityFromString(readString(gap, "severity"), "medium"),
      title: `[Visual Hive] Repo map finding: ${readString(gap, "title") ?? readString(gap, "kind") ?? "coverage gap"}`,
      labels: ["map-drift"],
      owningAgentHint: "visual-hive/map",
      sourceArtifacts: [sourceArtifacts.repoMap ?? ".visual-hive/repo-map.json"],
      affected: [{ route: readString(gap, "route"), component: readString(gap, "component"), selector: readString(gap, "selector") }],
      validationCommand: "visual-hive analyze --repo . && visual-hive issues --write",
      bodySummary: readString(gap, "description") ?? JSON.stringify(gap).slice(0, 800),
      ...(testRoot ? derivativePublication(testRoot.rootCauseKey) : {})
    });
  });
}

function issuesFromWorkflows(workflows: JsonObject | undefined, sourceArtifacts: VisualHiveIssuesReport["sourceArtifacts"]): VisualHiveIssueCandidate[] {
  const findings = arrayOfObjects(workflows?.findings);
  return findings.slice(0, 10).map((finding) =>
    baseIssue({
      issueKind: "workflow_safety",
      severity: severityFromString(readString(finding, "severity"), readString(finding, "level") === "critical" ? "critical" : "high"),
      title: `[Visual Hive] Workflow safety finding: ${readString(finding, "title") ?? readString(finding, "id") ?? "workflow safety"}`,
      labels: ["visual-hive/blocked", "hive/ci"],
      owningAgentHint: "hive/ci",
      sourceArtifacts: [sourceArtifacts.workflows ?? ".visual-hive/workflows.json"],
      affected: [],
      validationCommand: "visual-hive workflows && visual-hive security",
      bodySummary: readString(finding, "message") ?? JSON.stringify(finding).slice(0, 800)
    })
  );
}

function issuesFromReadiness(readiness: JsonObject | undefined, sourceArtifacts: VisualHiveIssuesReport["sourceArtifacts"]): VisualHiveIssueCandidate[] {
  const blockers = readStringArray(readiness?.blockedReasons).concat(readStringArray(readiness?.warnings));
  return blockers.slice(0, 10).map((reason) =>
    baseIssue({
      issueKind: reason.toLowerCase().includes("setup") ? "setup_needed" : "external_repo_onboarding",
      severity: reason.toLowerCase().includes("blocked") ? "high" : "medium",
      title: `[Visual Hive] Readiness action: ${reason.slice(0, 80)}`,
      labels: ["visual-hive/blocked"],
      owningAgentHint: "visual-hive/setup",
      sourceArtifacts: [sourceArtifacts.readiness ?? ".visual-hive/readiness.json"],
      affected: [],
      validationCommand: "visual-hive readiness && visual-hive issues --write",
      bodySummary: reason
    })
  );
}

function issuesFromProviderEvidence(evidence: JsonObject | undefined, sourceArtifacts: VisualHiveIssuesReport["sourceArtifacts"]): VisualHiveIssueCandidate[] {
  const providers = arrayOfObjects(evidence?.providers);
  return providers
    .map((provider) => ({ provider, issueStatus: providerIssueStatus(provider) }))
    .filter((entry): entry is { provider: JsonObject; issueStatus: "failed" | "missing_credentials" | "blocked" } => entry.issueStatus !== undefined)
    .map(({ provider, issueStatus }) =>
      baseIssue({
        issueKind: "provider_governance",
        severity: issueStatus === "failed" ? "high" : "medium",
        title: `[Visual Hive] Provider governance: ${readString(provider, "providerId") ?? "provider"} ${issueStatus}`,
        labels: ["visual-hive/blocked"],
        owningAgentHint: "hive/ci",
        sourceArtifacts: [sourceArtifacts.evidencePacket ?? ".visual-hive/evidence-packet.json", ".visual-hive/provider-results.json"],
        affected: [],
        validationCommand: "visual-hive providers list && visual-hive issues --write",
        bodySummary: readString(provider, "message") ?? JSON.stringify(provider).slice(0, 800)
      })
    );
}

function providerIssueStatus(provider: JsonObject): "failed" | "missing_credentials" | "blocked" | undefined {
  const statuses = [readString(provider, "status"), readString(objectValue(provider, "upload"), "status")];
  for (const status of ["failed", "missing_credentials", "blocked"] as const) {
    if (statuses.includes(status)) return status;
  }
  return undefined;
}

function issuesFromHandoff(
  handoff: JsonObject | undefined,
  sourceArtifacts: VisualHiveIssuesReport["sourceArtifacts"],
  publication: PublicationContext
): VisualHiveIssueCandidate[] {
  const workItems = arrayOfObjects(handoff?.workItems);
  return workItems
    .filter((item) => readString(item, "priority") === "critical" || readString(item, "priority") === "high")
    .slice(0, 10)
    .map((item) => {
      const contractId = workItemContractId(item);
      const workItemId = readString(item, "id");
      const mutationRoot = mutationRootForWorkItem(workItemId, publication);
      const publicationMetadata = mutationRoot
        ? derivativePublication(mutationRoot.rootCauseKey)
        : workItemId === "readiness.readiness_gate" && publication.readinessBlockedRootKeys?.length
          ? aggregatePublication("aggregate/readiness/readiness_gate", publication.readinessBlockedRootKeys)
          : {};
      return baseIssue({
        issueKind: readString(item, "kind") === "test_creation" ? "missing_visual_coverage" : "external_repo_onboarding",
        severity: severityFromString(readString(item, "priority"), "medium"),
        title: `[Visual Hive] Handoff work item: ${readString(item, "title") ?? readString(item, "id") ?? "agent work"}`,
        labels: ["visual-hive/ready"],
        owningAgentHint: readString(item, "kind") === "test_creation" ? "visual-hive/test-creator" : "hive/quality",
        sourceArtifacts: [sourceArtifacts.handoff ?? ".visual-hive/handoff.json", ...readStringArray(item.artifacts)],
        affected: contractId ? [{ contractId }] : [],
        validationCommand: "visual-hive handoff-validate && visual-hive issues --write",
        bodySummary: readString(item, "summary") ?? JSON.stringify(item).slice(0, 800),
        ...publicationMetadata
      });
    });
}

function testCreationAutomationView(value: unknown): TestCreationAutomationView {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      recommendations: [],
      canResolveTestAdequacy: false,
      resolutionBlockReason: "the test-creation plan is missing or unreadable"
    };
  }
  if ((value as JsonObject).schemaVersion !== "visual-hive.test-creation-plan.v2") {
    return {
      recommendations: [],
      canResolveTestAdequacy: false,
      resolutionBlockReason: "legacy or unsupported test-creation plans cannot drive repository automation"
    };
  }
  const parsed = TestCreationPlanV2Schema.safeParse(value);
  if (!parsed.success) {
    return {
      recommendations: [],
      canResolveTestAdequacy: false,
      resolutionBlockReason: "the v2 test-creation plan or its grounding is malformed"
    };
  }

  const relevant = parsed.data.recommendations.filter(isTestAdequacyRecommendation);
  const grounded = relevant.filter(isGroundedForAutomation);
  const ineligible = relevant.filter((recommendation) => !isGroundedForAutomation(recommendation));
  return {
    recommendations: grounded,
    canResolveTestAdequacy: ineligible.length === 0,
    ...(ineligible.length
      ? { resolutionBlockReason: "one or more relevant v2 recommendations are unresolved or lack automation-eligible grounding" }
      : {})
  };
}

function isTestAdequacyRecommendation(recommendation: TestCreationRecommendation): boolean {
  return recommendation.source === "testing_layer"
    && recommendation.kind === "unit_test"
    && (recommendation.priority === "high" || recommendation.priority === "medium");
}

function isGroundedForAutomation(recommendation: TestCreationRecommendation): boolean {
  return recommendation.grounding.status === "grounded"
    && recommendation.grounding.evidence.length > 0
    && recommendation.grounding.evidence.every((item) => Boolean(item.trim()))
    && recommendation.grounding.unresolvedReasons.length === 0;
}

function issuesFromTestCreation(
  automation: TestCreationAutomationView,
  repoMap: JsonObject | undefined,
  sourceArtifacts: VisualHiveIssuesReport["sourceArtifacts"],
  publication: PublicationContext
): VisualHiveIssueCandidate[] {
  return automation.recommendations
    .slice(0, 1)
    .map((recommendation) => {
      const structuredLayerId = recommendation.layer?.id;
      const layerId = typeof structuredLayerId === "number" && Number.isInteger(structuredLayerId) && structuredLayerId > 0 ? structuredLayerId : 2;
      const root = structuredLayerId === layerId
        ? publication.testAdequacyRoots.find((candidate) => candidate.layerId === layerId)
        : undefined;
      const unitTestCommands = repositoryUnitTestCommands(repoMap);
      return baseIssue({
        issueKind: "test_adequacy_gap",
        severity: "high",
        title: `[Visual Hive] Add repository test coverage: ${recommendation.title}`,
        labels: ["missing-coverage", "test-adequacy-gap"],
        owningAgentHint: "visual-hive/test-creator",
        sourceArtifacts: [sourceArtifacts.testCreationPlan ?? ".visual-hive/test-creation-plan.json", ...recommendation.artifacts],
        affected: [
          { route: recommendation.affected.route, component: recommendation.affected.component },
          { contractId: `testing-layer:${layerId}` }
        ],
        validationCommand: [
          ...unitTestCommands,
          "visual-hive analyze --repo .",
          "visual-hive evidence",
          "visual-hive test-creation-plan",
          "visual-hive issues --write"
        ].filter(Boolean).join(" && "),
        bodySummary: [
          ...recommendation.rationale,
          ...recommendation.suggestedTests,
          "Repair scope: add focused repository test files only; do not change source, package metadata, workflows, Visual Hive config, or baselines."
        ].join("\n"),
        ...(root ? canonicalPublication(root.rootCauseKey) : {})
      });
    });
}

function repositoryUnitTestCommands(repoMap: JsonObject | undefined): string[] {
  const eligibleFileScopes = new Set(arrayOfObjects(repoMap?.testFiles)
    .filter((file) => {
      const kind = readString(file, "kind");
      const runtime = readString(file, "runtime");
      return file.runnerEligible === true && (kind === "unit" || (kind === "component" && runtime === "javascript"));
    })
    .map((file) => `${readString(file, "runtime") ?? ""}\0${readString(file, "scope") ?? ""}`));
  const candidates = arrayOfObjects(repoMap?.testRunners)
    .filter((runner) => readString(runner, "kind") === "unit")
    .filter((runner) => !eligibleFileScopes.has(`${readString(runner, "runtime") ?? ""}\0${readString(runner, "scope") ?? ""}`))
    .sort((left, right) =>
      stableCompare(readString(left, "runtime") ?? "", readString(right, "runtime") ?? "")
      || stableCompare(readString(left, "scope") ?? "", readString(right, "scope") ?? "")
      || runnerEvidenceRank(right) - runnerEvidenceRank(left)
      || stableCompare(readString(left, "tool") ?? "", readString(right, "tool") ?? "")
    );
  const commands: string[] = [];
  const handledScopes = new Set<string>();
  for (const runner of candidates) {
    const scopeIdentity = `${readString(runner, "runtime") ?? ""}\0${readString(runner, "scope") ?? ""}`;
    if (handledScopes.has(scopeIdentity)) continue;
    const rendered = renderSafeRunnerCommand(objectValue(runner, "command"));
    if (!rendered) continue;
    handledScopes.add(scopeIdentity);
    if (!commands.includes(rendered)) commands.push(rendered);
  }
  return commands;
}

function runnerEvidenceRank(runner: JsonObject): number {
  const evidence = readStringArray(runner.evidence);
  if (evidence.some((item) => item.startsWith("script:"))) return 3;
  if (evidence.some((item) => item.startsWith("manifest:") || item.startsWith("test-file:"))) return 2;
  if (evidence.some((item) => item.startsWith("dependency:"))) return 1;
  return 0;
}

function renderSafeRunnerCommand(command: JsonObject | undefined): string | undefined {
  if (!command) return undefined;
  const cwd = readString(command, "cwd");
  const executable = readString(command, "executable");
  const args = readStringArray(command.args);
  if (!cwd || !executable || !["npm", "pnpm", "yarn", "node", "python", "go", "cargo", "mvn", "gradle", "ruby", "php"].includes(executable)) return undefined;
  const safeToken = (value: string) => /^[A-Za-z0-9@%_+=:,./-]+$/u.test(value) && !value.split("/").includes("..");
  if (cwd !== ".") {
    if (cwd.startsWith("-") || cwd.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(cwd)) return undefined;
    if (!safeToken(cwd) || cwd.split("/").some((segment) => segment.startsWith("-"))) return undefined;
  }
  if (!args.every(safeToken)) return undefined;
  const invocation = [executable, ...args].join(" ");
  return cwd === "." ? invocation : `cd ${cwd} && ${invocation}`;
}

function workItemContractId(item: JsonObject): string | undefined {
  const explicit = readString(item, "contractId");
  if (explicit) return explicit;
  const id = readString(item, "id");
  if (!id) return undefined;
  for (const prefix of ["playwright.contract_result.", "playwright.console_error.", "playwright.page_error.", "screenshot_diff.missing_baseline.", "screenshot_diff.failed."]) {
    if (id.startsWith(prefix)) {
      return id.slice(prefix.length) || undefined;
    }
  }
  return undefined;
}

function buildPublicationContext(
  mutationReport: MutationReport | undefined,
  testCreationAutomation: TestCreationAutomationView,
  readiness: JsonObject | undefined
): PublicationContext {
  const mutationRoots = uniqueBy(
    (mutationReport?.results ?? [])
      .filter((result) => result.status === "survived")
      .map(mutationPublicationRoot)
      .filter((root): root is MutationPublicationRoot => Boolean(root)),
    (root) => root.rootCauseKey
  ).sort((left, right) => stableCompare(left.rootCauseKey, right.rootCauseKey));
  const testAdequacyRoots = uniqueBy(
    testCreationAutomation.recommendations
      .slice(0, 1)
      .map((recommendation) => recommendation.layer?.id)
      .filter((layerId): layerId is number => typeof layerId === "number" && Number.isInteger(layerId) && layerId > 0)
      .map((layerId) => ({ rootCauseKey: `test-adequacy/repository/testing-layer:${layerId}`, layerId })),
    (root) => root.rootCauseKey
  );
  return {
    mutationRoots,
    testAdequacyRoots,
    readinessBlockedRootKeys: readinessBlockedRootKeys(readiness, mutationRoots)
  };
}

function mutationPublicationRoot(result: MutationReport["results"][number]): MutationPublicationRoot | undefined {
  const operator = cleanPublicationIdentity(result.operator);
  const affected = result.affectedSurfaces ?? result.affected ?? [];
  const targetIds = stableUnique(affected.map((surface) => surface.targetId).filter((value): value is string => Boolean(value)));
  const contractIds = stableUnique([
    ...(result.contractIds ?? []),
    ...affected.map((surface) => surface.contractId)
  ]);
  if (!operator || targetIds.length !== 1 || contractIds.length === 0) return undefined;
  const targetId = targetIds[0]!;
  const rootCauseKey = `mutation/${rootKeySegment(operator)}/${rootKeySegment(targetId)}/${contractIds.map(rootKeySegment).join(",")}`;
  try {
    cleanRootCauseKey(rootCauseKey);
  } catch {
    return undefined;
  }
  return {
    rootCauseKey,
    operator,
    targetId,
    contractIds
  };
}

function mutationRootForResult(result: MutationReport["results"][number], publication: PublicationContext): MutationPublicationRoot | undefined {
  const expected = mutationPublicationRoot(result);
  return expected ? publication.mutationRoots.find((root) => root.rootCauseKey === expected.rootCauseKey) : undefined;
}

function mutationRootForCoverageRecord(
  record: JsonObject,
  maintenanceFinding: JsonObject | undefined,
  publication: PublicationContext
): MutationPublicationRoot | undefined {
  const operator = readString(record, "mutationOperator")
    ?? readString(maintenanceFinding, "mutationOperator")
    ?? taggedEvidenceValue(maintenanceFinding, "operator");
  if (!operator) return undefined;
  const targetId = readString(record, "targetId") ?? readString(maintenanceFinding, "targetId");
  const contractId = readString(record, "contractId") ?? readString(maintenanceFinding, "contractId");
  return uniqueMutationRoot(publication.mutationRoots.filter((root) =>
    root.operator === operator
      && (!targetId || root.targetId === targetId)
      && (!contractId || root.contractIds.includes(contractId))
  ));
}

function mutationRootForWorkItem(workItemId: string | undefined, publication: PublicationContext): MutationPublicationRoot | undefined {
  if (workItemId === "mutation.mutation_adequacy") return uniqueMutationRoot(publication.mutationRoots);
  const prefix = "mutation.mutation_survivor.";
  if (!workItemId?.startsWith(prefix)) return undefined;
  const operator = workItemId.slice(prefix.length);
  if (!operator) return undefined;
  return uniqueMutationRoot(publication.mutationRoots.filter((root) => root.operator === operator));
}

function uniqueMutationRoot(roots: MutationPublicationRoot[]): MutationPublicationRoot | undefined {
  return roots.length === 1 ? roots[0] : undefined;
}

function readinessBlockedRootKeys(
  readiness: JsonObject | undefined,
  mutationRoots: MutationPublicationRoot[]
): string[] | undefined {
  if (!readiness) return undefined;
  const blockedGates = arrayOfObjects(readiness.gates).filter((gate) => readString(gate, "status") === "blocked");
  if (blockedGates.length === 0) return undefined;
  const roots: string[] = [];
  for (const gate of blockedGates) {
    if (readString(gate, "id") === "mutation:score" && readString(gate, "category") === "mutation" && mutationRoots.length > 0) {
      roots.push(...mutationRoots.map((root) => root.rootCauseKey));
      continue;
    }
    // Unknown blocked gates remain independent publications. Guessing a linkage could hide real work.
    return undefined;
  }
  return stableUnique(roots);
}

function taggedEvidenceValue(record: JsonObject | undefined, key: string): string | undefined {
  const prefix = `${key}=`;
  const values = stableUnique(readStringArray(record?.evidence)
    .filter((value) => value.startsWith(prefix))
    .map((value) => value.slice(prefix.length))
    .filter(Boolean));
  return values.length === 1 ? values[0] : undefined;
}

function canonicalPublication(rootCauseKey: string): Pick<VisualHiveIssueCandidate, "publicationRole" | "rootCauseKey" | "blockedByRootKeys"> {
  return { publicationRole: "canonical", rootCauseKey, blockedByRootKeys: [] };
}

function derivativePublication(rootCauseKey: string): Pick<VisualHiveIssueCandidate, "publicationRole" | "rootCauseKey" | "blockedByRootKeys"> {
  return { publicationRole: "derivative", rootCauseKey, blockedByRootKeys: [] };
}

function aggregatePublication(
  rootCauseKey: string,
  blockedByRootKeys: string[]
): Pick<VisualHiveIssueCandidate, "publicationRole" | "rootCauseKey" | "blockedByRootKeys"> {
  return { publicationRole: "aggregate", rootCauseKey, blockedByRootKeys: stableUnique(blockedByRootKeys) };
}

function ensurePublicationMetadata(issue: VisualHiveIssueCandidate): VisualHiveIssueCandidate {
  const raw = issue as VisualHiveIssueCandidate & {
    publicationRole?: unknown;
    rootCauseKey?: unknown;
    blockedByRootKeys?: unknown;
  };
  const values = [raw.publicationRole, raw.rootCauseKey, raw.blockedByRootKeys];
  const present = values.filter((value) => value !== undefined).length;
  const metadata = present === 0
    ? canonicalPublication(defaultRootCauseKey(issue.issueKind, issue.title, issue.affected))
    : present === 3
      ? normalizePublicationMetadata({
          publicationRole: raw.publicationRole as VisualHiveIssueCandidate["publicationRole"],
          rootCauseKey: raw.rootCauseKey as string,
          blockedByRootKeys: raw.blockedByRootKeys as string[]
        })
      : (() => { throw new Error(`Issue candidate ${issue.dedupeFingerprint} has partial publication metadata.`); })();
  validatePublicationRoleForKind(issue.issueKind, metadata.publicationRole);
  return { ...issue, ...metadata };
}

function normalizePublicationMetadata(
  metadata: Pick<VisualHiveIssueCandidate, "publicationRole" | "rootCauseKey" | "blockedByRootKeys">
): Pick<VisualHiveIssueCandidate, "publicationRole" | "rootCauseKey" | "blockedByRootKeys"> {
  if (!(["canonical", "derivative", "aggregate"] as const).includes(metadata.publicationRole)) {
    throw new Error(`Invalid issue publication role: ${String(metadata.publicationRole)}`);
  }
  const rootCauseKey = cleanRootCauseKey(metadata.rootCauseKey);
  if (!Array.isArray(metadata.blockedByRootKeys)) throw new Error("Issue blockedByRootKeys must be an array.");
  const blockedByRootKeys = stableUnique(metadata.blockedByRootKeys.map(cleanRootCauseKey));
  if (metadata.publicationRole === "aggregate" && blockedByRootKeys.length === 0) {
    throw new Error("Aggregate issue candidates require at least one blocked root key.");
  }
  if (metadata.publicationRole !== "aggregate" && blockedByRootKeys.length > 0) {
    throw new Error("Only aggregate issue candidates may declare blocked root keys.");
  }
  if (blockedByRootKeys.includes(rootCauseKey)) throw new Error("An aggregate issue cannot block on its own root cause key.");
  return { publicationRole: metadata.publicationRole, rootCauseKey, blockedByRootKeys };
}

function validatePublicationRoleForKind(issueKind: VisualHiveIssueCandidate["issueKind"], role: VisualHiveIssueCandidate["publicationRole"]): void {
  if (role === "derivative" && !["missing_visual_coverage", "weak_visual_test", "external_repo_onboarding"].includes(issueKind)) {
    throw new Error(`Issue kind ${issueKind} cannot be published as a derivative.`);
  }
  if (role === "aggregate" && issueKind !== "external_repo_onboarding") {
    throw new Error(`Issue kind ${issueKind} cannot be published as an aggregate.`);
  }
}

function defaultRootCauseKey(issueKind: VisualHiveIssueCandidate["issueKind"], title: string, affected: VisualHiveIssueCandidate["affected"]): string {
  const stableAffected = affected
    .map((surface) => Object.entries(surface).filter(([, value]) => value !== undefined).sort(([left], [right]) => stableCompare(left, right)))
    .map((entries) => Object.fromEntries(entries))
    .sort((left, right) => stableCompare(JSON.stringify(left), JSON.stringify(right)));
  const digest = crypto.createHash("sha256").update(JSON.stringify({ issueKind, title: title.trim(), affected: stableAffected })).digest("hex");
  return `finding/${issueKind}/${digest}`;
}

function cleanRootCauseKey(value: string): string {
  if (typeof value !== "string") throw new Error("Issue rootCauseKey must be a string.");
  const clean = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._~:/,%+-]{0,511}$/u.test(clean) || /%(?![0-9A-Fa-f]{2})/u.test(clean)) {
    throw new Error("Issue rootCauseKey must be a 1-512 character URI-safe publication key.");
  }
  return clean;
}

function cleanPublicationIdentity(value: string | undefined): string | undefined {
  const clean = value?.trim();
  return clean && ![...clean].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) ? clean : undefined;
}

function rootKeySegment(value: string): string {
  return encodeURIComponent(value.trim()).replace(/[!'()*]/gu, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function baseIssue(input: Omit<VisualHiveIssueCandidate, "status" | "dedupeFingerprint" | "body" | "labels" | "guardrails" | "validationCommand" | "publicationRole" | "rootCauseKey" | "blockedByRootKeys"> & {
  labels?: string[];
  validationCommand?: string;
  bodySummary: string;
  publicationRole?: VisualHiveIssueCandidate["publicationRole"];
  rootCauseKey?: string;
  blockedByRootKeys?: string[];
}): VisualHiveIssueCandidate {
  const labels = dedupe([...DEFAULT_LABELS, ...agentLabels(input.owningAgentHint), ...(input.labels ?? []), input.issueKind.replaceAll("_", "-")]);
  const publication = normalizePublicationMetadata({
    publicationRole: input.publicationRole ?? "canonical",
    rootCauseKey: input.rootCauseKey ?? defaultRootCauseKey(input.issueKind, input.title, input.affected),
    blockedByRootKeys: input.blockedByRootKeys ?? []
  });
  const partial: VisualHiveIssueCandidate = {
    issueKind: input.issueKind,
    severity: input.severity,
    status: "open_candidate",
    dedupeFingerprint: legacyFingerprint(input.issueKind, input.title, input.affected),
    ...publication,
    title: input.title,
    labels,
    body: "",
    owningAgentHint: input.owningAgentHint,
    sourceArtifacts: dedupe(input.sourceArtifacts),
    affected: input.affected.filter((surface) => Object.values(surface).some(Boolean)),
    reproductionCommand: input.reproductionCommand,
    validationCommand: input.validationCommand ?? "visual-hive issues --write",
    guardrails: DEFAULT_GUARDRAILS
  };
  partial.body = renderIssueBody(partial, input.bodySummary);
  return partial;
}

function normalizeIssue(issue: VisualHiveIssueCandidate, rootDir: string, project: string, links: Partial<Record<"evidencePacket" | "repoMap" | "visualGraph" | "visualImpact" | "mutationReport" | "handoff" | "hiveExport" | "knowledgeGraph" | "agentPacket", string>>): VisualHiveIssueCandidate {
  const publishedIssue = ensurePublicationMetadata(issue);
  const surface = publishedIssue.affected[0]?.contractId ?? publishedIssue.affected[0]?.route ?? publishedIssue.affected[0]?.component ?? publishedIssue.issueKind;
  const normalized = {
    ...publishedIssue,
    dedupeFingerprint: fingerprint(project, publishedIssue.issueKind, surface, publishedIssue.title, publishedIssue.affected),
    linkedEvidencePacket: links.evidencePacket ? sanitizeArtifactPathForIssue(rootDir, links.evidencePacket) : undefined,
    linkedRepoMap: links.repoMap ? sanitizeArtifactPathForIssue(rootDir, links.repoMap) : undefined,
    linkedVisualGraph: links.visualGraph ? sanitizeArtifactPathForIssue(rootDir, links.visualGraph) : undefined,
    linkedVisualImpact: links.visualImpact ? sanitizeArtifactPathForIssue(rootDir, links.visualImpact) : undefined,
    linkedMutationReport: publishedIssue.issueKind === "mutation_survivor" && links.mutationReport ? sanitizeArtifactPathForIssue(rootDir, links.mutationReport) : publishedIssue.linkedMutationReport ? sanitizeArtifactPathForIssue(rootDir, publishedIssue.linkedMutationReport) : undefined,
    linkedHandoff: links.handoff ? sanitizeArtifactPathForIssue(rootDir, links.handoff) : undefined,
    linkedHiveExport: links.hiveExport ? sanitizeArtifactPathForIssue(rootDir, links.hiveExport) : undefined,
    linkedKnowledgeGraph: links.knowledgeGraph ? sanitizeArtifactPathForIssue(rootDir, links.knowledgeGraph) : undefined,
    linkedAgentPacket: links.agentPacket ? sanitizeArtifactPathForIssue(rootDir, links.agentPacket) : undefined
  };
  normalized.sourceArtifacts = dedupe([
    ...normalized.sourceArtifacts.map((artifact) => sanitizeArtifactPathForIssue(rootDir, artifact)),
    normalized.linkedEvidencePacket,
    normalized.linkedRepoMap,
    normalized.linkedVisualGraph,
    normalized.linkedVisualImpact,
    normalized.linkedMutationReport,
    normalized.linkedHandoff,
    normalized.linkedHiveExport,
    normalized.linkedKnowledgeGraph,
    normalized.linkedAgentPacket
  ]);
  normalized.body = renderIssueBody(normalized, issueSummary(issue.body), rootDir);
  return sanitizeValue(normalized) as VisualHiveIssueCandidate;
}

function issueSummary(body: string): string | undefined {
  const evidenceMarker = "\n## Visual Hive Evidence\n";
  const evidenceIndex = body.indexOf(evidenceMarker);
  if (evidenceIndex < 0) return undefined;
  const headingEnd = body.indexOf("\n", body.indexOf("\n# ") + 1);
  if (headingEnd < 0 || headingEnd >= evidenceIndex) return undefined;
  return body.slice(headingEnd, evidenceIndex).trim() || undefined;
}

function renderIssueBody(issue: VisualHiveIssueCandidate, bodySummary?: string, rootDir?: string): string {
  const linkedArtifacts = dedupe([
    issue.linkedEvidencePacket,
    issue.linkedRepoMap,
    issue.linkedVisualGraph,
    issue.linkedVisualImpact,
    issue.linkedMutationReport,
    issue.linkedHandoff,
    issue.linkedHiveExport,
    issue.linkedKnowledgeGraph,
    issue.linkedAgentPacket,
    ...issue.sourceArtifacts
  ]).map((artifact) => (rootDir ? sanitizeArtifactPathForIssue(rootDir, artifact) : artifact));
  const lines = [
    `<!-- visual-hive-issue dedupe:${issue.dedupeFingerprint} -->`,
    `<!-- visual-hive-issue-kind:${issue.issueKind} -->`,
    "",
    `# ${issue.title}`,
    "",
    bodySummary ?? "",
    "",
    "## Visual Hive Evidence",
    "",
    `- Issue kind: ${issue.issueKind}`,
    `- Severity: ${issue.severity}`,
    `- Status: ${issue.status}`,
    `- Publication role: ${issue.publicationRole}`,
    `- Root cause key: ${issue.rootCauseKey}`,
    ...(issue.blockedByRootKeys.length ? [`- Blocked by root keys: ${issue.blockedByRootKeys.join(", ")}`] : []),
    `- Owning agent hint: ${issue.owningAgentHint}`,
    `- Dedupe fingerprint: ${issue.dedupeFingerprint}`,
    issue.reproductionCommand ? `- Reproduction command: \`${issue.reproductionCommand}\`` : undefined,
    `- Validation command: \`${issue.validationCommand}\``,
    "",
    "## Linked Artifacts",
    "",
    ...linkedArtifacts.map((artifact) => `- ${artifact}`),
    "",
    "## Affected Surface",
    "",
    ...(issue.affected.length ? issue.affected.map((surface) => `- ${Object.entries(surface).filter(([, value]) => Boolean(value)).map(([key, value]) => `${key}=${value}`).join(", ")}`) : ["- No specific route/component/selector recorded."]),
    "",
    "## Guardrails",
    "",
    ...issue.guardrails.map((guardrail) => `- ${guardrail}`),
    "",
    ...(issue.status === "resolved_candidate"
      ? [
          "## Resolved Candidate Evidence",
          "",
          "Visual Hive no longer detects this finding in the latest artifact set. Treat this as deterministic resolved-candidate evidence for a trusted workflow or human reviewer.",
          "",
          "Do not auto-close by default unless repository policy explicitly enables auto-close. Prefer updating the existing issue with this evidence and adding `visual-hive/resolved-candidate`."
        ]
      : []),
    "",
    "## Agent Direction",
    "",
    "Visual Hive validates; Hive repairs. Hive and agents should use this issue as the queue item, then rerun the listed Visual Hive validation command after any proposed fix."
  ].filter((line): line is string => line !== undefined);
  const body = lines.join("\n");
  return rootDir ? sanitizeArtifactPathsForMarkdown(rootDir, body) : sanitizeText(body);
}

function buildSetupIssue(input: { project: string; generatedAt: string; sourceArtifacts: VisualHiveIssuesReport["sourceArtifacts"]; repoMap?: JsonObject; readiness?: JsonObject; rootDir: string }): VisualHiveSetupIssue {
  const artifacts = Object.values(input.sourceArtifacts).filter(Boolean).map((artifact) => sanitizeArtifactPathForIssue(input.rootDir, artifact));
  const body = sanitizeArtifactPathsForMarkdown(input.rootDir, [
    "<!-- visual-hive-setup-issue -->",
    "# [Visual Hive] Setup visual QA",
    "",
    `Project: ${input.project}`,
    "",
    "Visual Hive detected this repository as a candidate for deterministic visual QA orchestration.",
    "",
    "## Setup Checklist",
    "",
    "- [ ] Confirm app build and local preview commands.",
    "- [ ] Add stable route-level and component-level selectors.",
    "- [ ] Add `visual-hive.config.yaml` targets and contracts.",
    "- [ ] Seed baselines locally and review them explicitly.",
    "- [ ] Enable PR-safe workflow with read-only permissions and no secrets.",
    "- [ ] Enable trusted issue handoff only after artifact validation.",
    "",
    "## Evidence",
    "",
    ...artifacts.map((artifact) => `- ${artifact}`),
    "",
    "## Commands",
    "",
    "```bash",
    "visual-hive doctor",
    "visual-hive analyze --repo .",
    "visual-hive recommend --repo .",
    "visual-hive plan --mode pr",
    "visual-hive issues --write",
    "```",
    "",
    "Visual Hive does not repair code or create pull requests from this setup issue. A setup agent may propose config/workflow changes in a reviewed branch."
  ].join("\n"));
  return {
    schemaVersion: "visual-hive.setup-issue.v1",
    generatedAt: input.generatedAt,
    project: input.project,
    title: "[Visual Hive] Setup visual QA",
    labels: ["visual-hive", "setup", "hive/quality"],
    body,
    externalCallsMade: 0,
    networkCallsMade: 0,
    sourceArtifacts: artifacts
  };
}

function applySuppression(issue: VisualHiveIssueCandidate, suppression?: VisualHiveIssueSuppression): VisualHiveIssueCandidate {
  if (!suppression) return issue;
  if (suppression.expiresAt && Date.parse(suppression.expiresAt) < Date.now()) return issue;
  return {
    ...issue,
    status: "suppressed",
    suppressedReason: suppression.reason,
    suppressionExpiresAt: suppression.expiresAt,
    body: `${issue.body}\n\n## Suppression\n\n- Reason: ${sanitizeText(suppression.reason)}${suppression.expiresAt ? `\n- Expires: ${sanitizeText(suppression.expiresAt)}` : ""}\n`
  };
}

function summarizeIssues(issues: VisualHiveIssueCandidate[]): VisualHiveIssuesReport["summary"] {
  const byKind: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};
  for (const issue of issues) {
    byKind[issue.issueKind] = (byKind[issue.issueKind] ?? 0) + 1;
    bySeverity[issue.severity] = (bySeverity[issue.severity] ?? 0) + 1;
  }
  return {
    total: issues.length,
    openCandidates: issues.filter((issue) => issue.status === "open_candidate").length,
    updateCandidates: issues.filter((issue) => issue.status === "update_candidate").length,
    resolvedCandidates: issues.filter((issue) => issue.status === "resolved_candidate").length,
    suppressed: issues.filter((issue) => issue.status === "suppressed").length,
    blocked: issues.filter((issue) => issue.status === "blocked").length,
    byKind,
    bySeverity
  };
}

function presentSourceArtifacts(rootDir: string, sourceArtifacts: VisualHiveIssuesReport["sourceArtifacts"], values: Record<string, unknown>): VisualHiveIssuesReport["sourceArtifacts"] {
  return Object.fromEntries(
    Object.entries(sourceArtifacts)
      .filter(([key, value]) => Boolean(value) && values[key] !== undefined)
      .map(([key, value]) => [key, value ? sanitizeArtifactPathForIssue(rootDir, value) : value])
  ) as VisualHiveIssuesReport["sourceArtifacts"];
}

function defaultSourceArtifacts(overrides?: Partial<VisualHiveIssuesReport["sourceArtifacts"]>): VisualHiveIssuesReport["sourceArtifacts"] {
  return {
    report: ".visual-hive/report.json",
    mutationReport: ".visual-hive/mutation-report.json",
    coverage: ".visual-hive/coverage.json",
    coverageRecommendations: ".visual-hive/coverage-recommendations.json",
    testCreationPlan: ".visual-hive/test-creation-plan.json",
    triage: ".visual-hive/triage.json",
    repoMap: ".visual-hive/repo-map.json",
    workflows: ".visual-hive/workflows.json",
    readiness: ".visual-hive/readiness.json",
    evidencePacket: ".visual-hive/evidence-packet.json",
    visualGraph: ".visual-hive/visual-graph.json",
    visualImpact: ".visual-hive/visual-impact.json",
    handoff: ".visual-hive/handoff.json",
    hiveExport: ".visual-hive/hive/hive-export.json",
    knowledgeGraph: ".visual-hive/hive/knowledge-graph.json",
    agentPacket: ".visual-hive/agent-packet.json",
    ...overrides
  };
}

async function readOptional<T>(rootDir: string, artifactPath?: string): Promise<T | undefined> {
  if (!artifactPath) return undefined;
  try {
    return sanitizeValue(await readJson<T>(resolve(rootDir, artifactPath))) as T;
  } catch {
    return undefined;
  }
}

async function readSuppressions(rootDir: string, artifactPath: string): Promise<VisualHiveIssueSuppression[]> {
  const parsed = await readOptional<{ suppressions?: VisualHiveIssueSuppression[] } | VisualHiveIssueSuppression[]>(rootDir, artifactPath);
  if (Array.isArray(parsed)) return parsed;
  return parsed?.suppressions ?? [];
}

async function refreshVisualGraphWithIssues(rootDir: string, issuesReport: VisualHiveIssuesReport): Promise<void> {
  const repoMap = await readOptional<RepoMapReport>(rootDir, ".visual-hive/repo-map.json");
  if (!isRepoMapReport(repoMap)) return;
  await writeVisualGraphArtifacts({ repoRoot: rootDir, repoMap, issuesReport });
}

function isRepoMapReport(value: unknown): value is RepoMapReport {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const visualMap = (value as { visualMap?: unknown }).visualMap;
  if (!visualMap || typeof visualMap !== "object" || Array.isArray(visualMap)) return false;
  const map = visualMap as { nodes?: unknown; edges?: unknown };
  return Array.isArray(map.nodes) && Array.isArray(map.edges);
}

function exists(pathValue?: string, object?: unknown): string | undefined {
  return pathValue && object ? pathValue : undefined;
}

function maintenanceKind(kind?: string): VisualHiveIssueCandidate["issueKind"] {
  if (!kind) return "weak_visual_test";
  if (kind.includes("baseline_churn")) return "baseline_churn";
  if (kind.includes("stale_baseline")) return "stale_baseline";
  if (kind.includes("missing")) return "missing_visual_coverage";
  return "weak_visual_test";
}

function reportSeverity(errors: string[], fallback: VisualHiveIssueCandidate["severity"]): VisualHiveIssueCandidate["severity"] {
  const joined = errors.join(" ").toLowerCase();
  if (joined.includes("critical") || joined.includes("login")) return "critical";
  return fallback;
}

function severityFromString(value: string | undefined, fallback: VisualHiveIssueCandidate["severity"]): VisualHiveIssueCandidate["severity"] {
  if (value === "critical" || value === "high" || value === "medium" || value === "low") return value;
  return fallback;
}

function agentLabels(agent: VisualHiveIssueCandidate["owningAgentHint"]): string[] {
  const map: Record<VisualHiveIssueCandidate["owningAgentHint"], string[]> = {
    "visual-hive/setup": ["visual-hive/agent-setup"],
    "visual-hive/map": ["visual-hive/agent-map", "map-drift"],
    "visual-hive/test-creator": ["visual-hive/agent-test-creator"],
    "visual-hive/test-maintainer": ["visual-hive/agent-test-maintainer"],
    "visual-hive/mutation": ["visual-hive/agent-mutation"],
    "hive/quality": ["hive/quality"],
    "hive/ci": ["hive/ci"],
    "hive/architect": ["hive/architect"]
  };
  return map[agent];
}

function fingerprint(project: string, kind: string, surface: string | undefined, title: string, affected: VisualHiveIssueCandidate["affected"]): string {
  const repo = safeFingerprintSegment(project);
  const surfaceSegment = safeFingerprintSegment(surface ?? "surface");
  const base = JSON.stringify({ repo, kind, surface: surfaceSegment, title: title.toLowerCase(), affected: fingerprintAffected(affected) });
  return `visual-hive:${repo}:${kind}:${surfaceSegment}:${crypto.createHash("sha256").update(base).digest("hex").slice(0, 16)}`;
}

function legacyFingerprint(kind: string, title: string, affected: VisualHiveIssueCandidate["affected"]): string {
  const base = JSON.stringify({ kind, title: title.toLowerCase(), affected: fingerprintAffected(affected) });
  return `visual-hive:${kind}:${crypto.createHash("sha256").update(base).digest("hex").slice(0, 16)}`;
}

function fingerprintAffected(affected: VisualHiveIssueCandidate["affected"]): VisualHiveIssueCandidate["affected"] {
  return affected.filter((surface) => {
    const resolutionScope = surface.contractId?.startsWith("testing-layer:") && Object.entries(surface).every(([key, value]) => key === "contractId" || value === undefined);
    return !resolutionScope;
  });
}

function safeFingerprintSegment(value: string): string {
  return sanitizeText(value).toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}

function compareIssues(left: VisualHiveIssueCandidate, right: VisualHiveIssueCandidate): number {
  const severity = { critical: 0, high: 1, medium: 2, low: 3 };
  return severity[left.severity] - severity[right.severity] || stableCompare(left.issueKind, right.issueKind) || stableCompare(left.title, right.title);
}

function arrayOfObjects(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter((item): item is JsonObject => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
}

function objectValue(value: unknown, key: string): JsonObject | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const child = (value as JsonObject)[key];
  return child && typeof child === "object" && !Array.isArray(child) ? (child as JsonObject) : undefined;
}

function readString(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const child = (value as JsonObject)[key];
  return typeof child === "string" && child.trim() ? sanitizeText(child) : undefined;
}

function readNumber(value: unknown, key: string): number | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const child = (value as JsonObject)[key];
  return typeof child === "number" && Number.isFinite(child) ? child : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim())).map((entry) => sanitizeText(entry)) : [];
}

function dedupe(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)).map((value) => sanitizeText(value.replaceAll("\\", "/"))))];
}

function stableUnique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort(stableCompare);
}

function uniqueBy<T>(values: T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const identity = key(value);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function stableCompare(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function resolve(rootDir: string, artifactPath: string): string {
  return path.isAbsolute(artifactPath) ? artifactPath : path.resolve(rootDir, artifactPath);
}

function sanitizeValue<T>(value: T): T {
  return JSON.parse(sanitizeText(JSON.stringify(value))) as T;
}
