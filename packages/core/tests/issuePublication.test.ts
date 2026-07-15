import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { afterEach, describe, expect, it } from "vitest";
import { indexArtifacts } from "../src/artifacts/index.js";
import { verifyVisualHiveBundleDigest, writeVisualHiveBundle } from "../src/hive/bundle.js";
import { buildIssuesReport } from "../src/issues/build.js";

const temporaryRoots: string[] = [];
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("root-cause publication metadata", () => {
  it("maps the production dummy nine-candidate taxonomy to exactly two canonical roots", async () => {
    const rootDir = await makeRoot();
    await writeDummyNineArtifacts(rootDir);

    const result = await buildIssuesReport({
      rootDir,
      project: "hive-visual-hive-e2e-proof",
      now: new Date("2026-07-12T00:25:31.204Z")
    });

    expect(result.report.issues).toHaveLength(9);
    expect(roleCounts(result.report.issues)).toEqual({ aggregate: 1, canonical: 2, derivative: 6 });
    expect(result.report.issues.filter((issue) => issue.publicationRole === "canonical").map((issue) => issue.rootCauseKey).sort()).toEqual([
      "mutation/api-500/localPreview/dashboard-shell",
      "test-adequacy/repository/testing-layer:2"
    ]);

    const mutationRoot = "mutation/api-500/localPreview/dashboard-shell";
    const mutationDerivatives = result.report.issues.filter((issue) => issue.publicationRole === "derivative" && issue.rootCauseKey === mutationRoot);
    expect(mutationDerivatives).toHaveLength(5);
    expect(mutationDerivatives.map((issue) => issue.issueKind).sort()).toEqual([
      "missing_visual_coverage",
      "missing_visual_coverage",
      "missing_visual_coverage",
      "missing_visual_coverage",
      "weak_visual_test"
    ]);
    expect(result.report.issues.find((issue) => issue.title.includes("Repo map finding"))).toMatchObject({
      publicationRole: "derivative",
      rootCauseKey: "test-adequacy/repository/testing-layer:2",
      blockedByRootKeys: []
    });
    expect(result.report.issues.find((issue) => issue.publicationRole === "aggregate")).toMatchObject({
      publicationRole: "aggregate",
      rootCauseKey: "aggregate/readiness/readiness_gate",
      blockedByRootKeys: [mutationRoot]
    });
    expect(result.report.issues.every((issue) => issue.body.includes(`Publication role: ${issue.publicationRole}`))).toBe(true);

    const schema = JSON.parse(await readFile(path.join(repoRoot, "schemas/visual-hive.issues.schema.json"), "utf8"));
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
    expect(validate(result.report), JSON.stringify(validate.errors, null, 2)).toBe(true);
  });

  it("keeps operators, targets, and sorted contract sets distinct and order-stable", async () => {
    const firstRoot = await makeRoot();
    const secondRoot = await makeRoot();
    const results = [
      survivor("api", "alpha", ["b", "a"]),
      survivor("api", "beta", ["a", "b"]),
      survivor("other", "alpha", ["a", "b"]),
      survivor("api", "alpha", ["c", "a"])
    ];
    await writeArtifact(firstRoot, ".visual-hive/mutation-report.json", mutationReport(results));
    await writeArtifact(secondRoot, ".visual-hive/mutation-report.json", mutationReport([...results].reverse().map((result) => ({
      ...result,
      contractIds: [...result.contractIds].reverse(),
      affectedSurfaces: [...result.affectedSurfaces].reverse()
    }))));

    const first = await buildIssuesReport({ rootDir: firstRoot, project: "ordering" });
    const second = await buildIssuesReport({ rootDir: secondRoot, project: "ordering" });
    const firstKeys = first.report.issues.map((issue) => issue.rootCauseKey).sort();
    const secondKeys = second.report.issues.map((issue) => issue.rootCauseKey).sort();
    expect(firstKeys).toEqual([
      "mutation/api/alpha/a,b",
      "mutation/api/alpha/a,c",
      "mutation/api/beta/a,b",
      "mutation/other/alpha/a,b"
    ]);
    expect(secondKeys).toEqual(firstKeys);
  });

  it("orders Unicode mutation identity segments by UTF-8 bytes", async () => {
    const rootDir = await makeRoot();
    await writeArtifact(rootDir, ".visual-hive/mutation-report.json", mutationReport([
      survivor("unicode", "localPreview", ["\u{10000}", "\uE000"])
    ]));
    const result = await buildIssuesReport({ rootDir, project: "unicode-root" });
    expect(result.report.issues).toHaveLength(1);
    expect(result.report.issues[0]?.rootCauseKey).toBe("mutation/unicode/localPreview/%EE%80%80,%F0%90%80%80");
  });

  it("coalesces repeated structured mutation evidence into one canonical root that bundles successfully", async () => {
    const rootDir = await makeRoot();
    const first = {
      ...survivor("api-500", "localPreview", ["dashboard-shell"]),
      affected: [{ contractId: "dashboard-shell", targetId: "localPreview", route: "/a" }],
      affectedSurfaces: [{ contractId: "dashboard-shell", targetId: "localPreview", route: "/a" }],
      failedAssertion: "Route /a did not detect the API failure.",
      artifacts: [".visual-hive/evidence/route-a.json"],
      validationCommand: "npm test -- route-a"
    };
    const second = {
      ...survivor("api-500", "localPreview", ["dashboard-shell"]),
      affected: [{ contractId: "dashboard-shell", targetId: "localPreview", route: "/b" }],
      affectedSurfaces: [{ contractId: "dashboard-shell", targetId: "localPreview", route: "/b" }],
      suggestedMissingTest: "Add API failure coverage for route /b.",
      artifacts: [".visual-hive/evidence/route-b.json"],
      validationCommand: "npm test -- route-b"
    };
    await writeArtifact(rootDir, ".visual-hive/mutation-report.json", mutationReport([second, first]));
    await writeArtifact(rootDir, ".visual-hive/coverage-recommendations.json", {
      maintenanceFindings: [],
      recommendations: [{
        id: "mutation-survivor:api-500:dashboard-shell",
        kind: "map_mutation_operator",
        severity: "high",
        title: "Strengthen tests for api-500",
        targetId: "localPreview",
        contractId: "dashboard-shell",
        mutationOperator: "api-500",
        suggestedTests: []
      }]
    });

    const report = await buildIssuesReport({ rootDir, project: "coalesced-mutation" });
    const canonical = report.report.issues.filter((issue) => issue.publicationRole === "canonical");
    const derivatives = report.report.issues.filter((issue) => issue.publicationRole === "derivative");
    expect(canonical).toHaveLength(1);
    expect(derivatives).toHaveLength(1);
    expect(canonical[0]).toMatchObject({
      rootCauseKey: "mutation/api-500/localPreview/dashboard-shell",
      affected: [
        { contractId: "dashboard-shell", targetId: "localPreview", route: "/a" },
        { contractId: "dashboard-shell", targetId: "localPreview", route: "/b" }
      ]
    });
    expect(canonical[0]?.sourceArtifacts).toEqual(expect.arrayContaining([
      ".visual-hive/evidence/route-a.json",
      ".visual-hive/evidence/route-b.json"
    ]));
    expect(canonical[0]?.body).toContain("Route /a did not detect the API failure.");
    expect(canonical[0]?.body).toContain("Add API failure coverage for route /b.");
    expect(canonical[0]?.body).toContain("npm test -- route-a");
    expect(canonical[0]?.body).toContain("npm test -- route-b");
    await prepareBundleEvidence(rootDir, "coalesced-mutation");

    const bundle = await writeVisualHiveBundle({
      rootDir,
      bundleId: "coalesced-mutation",
      project: "coalesced-mutation",
      mode: "full",
      verdict: "blocked",
      acmmRequest: 4,
      artifacts: [".visual-hive/mutation-report.json"],
      source: {
        repository: "owner/coalesced-mutation",
        ref: "refs/heads/main",
        commitSha: "abc123",
        event: "workflow_dispatch",
        workflowRunId: "1001",
        workflowRunAttempt: "1",
        workflowArtifactId: "9001",
        conclusion: "success",
        trusted: true
      },
      scan: { scope: "full", authoritativeForResolution: true },
      issues: report.report.issues,
      producerVersion: "0.3.0",
      producerGitCommit: "abc123"
    });
    expect(bundle.manifest.observations).toHaveLength(2);
    expect(bundle.manifest.observations.filter((item) => item.publicationRole === "canonical")).toHaveLength(1);
    expect(verifyVisualHiveBundleDigest(bundle.manifest)).toBe(true);
  });

  it("declares every exact root for a blocked readiness gate and fails open for an unknown gate", async () => {
    const rootDir = await makeRoot();
    await writeArtifact(rootDir, ".visual-hive/mutation-report.json", mutationReport([
      survivor("api-500", "localPreview", ["dashboard-shell"]),
      survivor("force-login", "localPreview", ["auth-shell"])
    ]));
    await writeArtifact(rootDir, ".visual-hive/handoff.json", {
      workItems: [{ id: "readiness.readiness_gate", kind: "setup", priority: "high", title: "Review readiness", summary: "Blocked.", artifacts: [".visual-hive/readiness.json"] }]
    });
    await writeArtifact(rootDir, ".visual-hive/readiness.json", {
      status: "blocked",
      blockedReasons: [],
      warnings: [],
      gates: [{ id: "mutation:score", category: "mutation", status: "blocked" }]
    });
    const linked = await buildIssuesReport({ rootDir, project: "readiness-links" });
    expect(linked.report.issues.find((issue) => issue.publicationRole === "aggregate")?.blockedByRootKeys).toEqual([
      "mutation/api-500/localPreview/dashboard-shell",
      "mutation/force-login/localPreview/auth-shell"
    ]);

    await writeArtifact(rootDir, ".visual-hive/readiness.json", {
      status: "blocked",
      blockedReasons: [],
      warnings: [],
      gates: [
        { id: "mutation:score", category: "mutation", status: "blocked" },
        { id: "security:unknown", category: "security", status: "blocked" }
      ]
    });
    const unlinked = await buildIssuesReport({ rootDir, project: "readiness-links" });
    const readinessIssue = unlinked.report.issues.find((issue) => issue.title.includes("Review readiness"));
    expect(readinessIssue).toMatchObject({ publicationRole: "canonical", blockedByRootKeys: [] });
    expect(readinessIssue?.rootCauseKey.startsWith("finding/external_repo_onboarding/")).toBe(true);
  });

  it("fails open for malformed mutation linkage and ignores malformed test-creation automation", async () => {
    const rootDir = await makeRoot();
    await writeArtifact(rootDir, ".visual-hive/mutation-report.json", mutationReport([{
      ...survivor("api-500", "localPreview", ["dashboard-shell"]),
      affectedSurfaces: [{ contractId: "dashboard-shell" }],
      affected: [{ contractId: "dashboard-shell" }]
    }]));
    await writeArtifact(rootDir, ".visual-hive/coverage-recommendations.json", {
      recommendations: [{
        id: "mutation-survivor:api-500:dashboard-shell",
        kind: "map_mutation_operator",
        severity: "high",
        title: "Strengthen malformed mutation mapping",
        mutationOperator: "api-500",
        targetId: "localPreview",
        contractId: "dashboard-shell",
        suggestedTests: []
      }],
      maintenanceFindings: []
    });
    await writeArtifact(rootDir, ".visual-hive/test-creation-plan.json", {
      recommendations: [{
        id: "malformed-layer",
        source: "testing_layer",
        kind: "unit_test",
        priority: "medium",
        title: "Malformed testing layer",
        rationale: [],
        suggestedTests: [],
        artifacts: [],
        affected: {}
      }]
    });

    const result = await buildIssuesReport({ rootDir, project: "malformed" });
    expect(result.report.issues).toHaveLength(2);
    expect(result.report.issues.every((issue) => issue.publicationRole === "canonical")).toBe(true);
    expect(new Set(result.report.issues.map((issue) => issue.rootCauseKey)).size).toBe(2);
    expect(result.report.issues.some((issue) => issue.rootCauseKey.startsWith("test-adequacy/"))).toBe(false);
    expect(result.report.issues.every((issue) => issue.blockedByRootKeys.length === 0)).toBe(true);
  });

  it("fails open when encoded mutation identity would exceed the signed key limit", async () => {
    const rootDir = await makeRoot();
    await writeArtifact(rootDir, ".visual-hive/mutation-report.json", mutationReport([
      survivor("x".repeat(600), "localPreview", ["dashboard-shell"])
    ]));
    const result = await buildIssuesReport({ rootDir, project: "overlong" });
    expect(result.report.issues).toHaveLength(1);
    expect(result.report.issues[0]).toMatchObject({ publicationRole: "canonical", blockedByRootKeys: [] });
    expect(result.report.issues[0]?.rootCauseKey.startsWith("finding/mutation_survivor/")).toBe(true);
  });
});

async function makeRoot(): Promise<string> {
  const root = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(path.join(os.tmpdir(), "visual-hive-publication-")));
  temporaryRoots.push(root);
  return root;
}

async function writeArtifact(root: string, relative: string, value: unknown): Promise<void> {
  const target = path.join(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function prepareBundleEvidence(root: string, project: string): Promise<void> {
  await writeArtifact(root, ".visual-hive/capability-parity.json", {
    schemaVersion: "visual-hive.capability-parity.v1",
    baselineVersion: "visual-hive.capability-baseline.v1",
    generatedAt: "2026-07-09T12:00:00.000Z",
    status: "passed",
    runtimeStatus: "ready",
    summary: { expected: 1, actual: 1, present: 1, blocked: 0, missing: 0, unexpected: 0, mismatched: 0 },
    domains: capabilityDomains(),
    checks: [{ domain: "cli", key: "doctor", status: "present", parity: true, message: "CLI capability is present." }]
  });
  const artifactIndex = await indexArtifacts({ repoRoot: root, project, complete: true, now: new Date("2026-07-09T12:00:00.000Z") });
  await writeArtifact(root, ".visual-hive/artifacts-index.json", artifactIndex);
}

function capabilityDomains() {
  return ["cli", "schemas", "evidenceResources", "artifactSurfaces", "planModes", "workflowLanes", "mutationOperators", "deterministicPrimitives", "providers", "openSourceAdapters", "controlPlane"].map((domain) => ({
    domain,
    expected: domain === "cli" ? 1 : 0,
    actual: domain === "cli" ? 1 : 0,
    present: domain === "cli" ? 1 : 0,
    blocked: 0,
    missing: 0,
    unexpected: 0,
    mismatched: 0
  }));
}

async function writeDummyNineArtifacts(root: string): Promise<void> {
  await writeArtifact(root, ".visual-hive/mutation-report.json", mutationReport([
    survivor("api-500", "localPreview", ["dashboard-shell"])
  ]));
  await writeArtifact(root, ".visual-hive/coverage-recommendations.json", {
    maintenanceFindings: [{
      id: "mutation-survivor-dashboard-shell",
      kind: "mutation_survivor",
      severity: "high",
      contractId: "dashboard-shell",
      targetId: "localPreview",
      message: "Mutation survived.",
      evidence: ["operator=api-500", "status=survived"]
    }],
    recommendations: [
      {
        id: "maintenance:mutation-survivor-dashboard-shell",
        kind: "maintain_visual_test",
        severity: "high",
        title: "Maintain visual test dashboard-shell",
        targetId: "localPreview",
        contractId: "dashboard-shell",
        maintenanceFindingId: "mutation-survivor-dashboard-shell",
        suggestedTests: []
      },
      {
        id: "mutation-survivor:api-500:dashboard-shell",
        kind: "map_mutation_operator",
        severity: "high",
        title: "Strengthen tests for api-500",
        targetId: "localPreview",
        contractId: "dashboard-shell",
        mutationOperator: "api-500",
        suggestedTests: []
      }
    ]
  });
  await writeArtifact(root, ".visual-hive/repo-map.json", {
    coverageGaps: [{ id: "unit-layer", layer: 2, severity: "low", message: "Unit test layer is not visible." }],
    mapFindings: []
  });
  await writeArtifact(root, ".visual-hive/test-creation-plan.json", {
    schemaVersion: "visual-hive.test-creation-plan.v2",
    generatedAt: "2026-07-12T00:00:00.000Z",
    project: "hive-visual-hive-e2e-proof",
    sourceArtifacts: {},
    governance: {
      verdictAuthority: "visual_hive",
      agentAuthority: "advisory_test_generation_only",
      writePolicy: "no_config_or_test_files_written",
      secretPolicy: "redacted_values_names_only"
    },
    summary: {
      total: 1,
      high: 0,
      medium: 1,
      low: 0,
      fromTestingLayers: 1,
      fromCoverageRecommendations: 0,
      fromMutationSurvivors: 0,
      fromHandoffWorkItems: 0
    },
    recommendations: [{
      id: "layer-2-unknown",
      gapId: "layer-2-unknown",
      source: "testing_layer",
      kind: "unit_test",
      priority: "medium",
      title: "Add unit test evidence for Unit",
      rationale: ["No repository unit test runner was detected."],
      currentEvidence: ["repo-map:coverage-gap:unit-layer"],
      grounding: {
        status: "grounded",
        evidence: ["repo-map:coverage-gap:unit-layer"],
        unresolvedReasons: []
      },
      suggestedContract: {
        id: "unit-layer-contract",
        description: "Repository-grounded unit test guidance.",
        route: "/",
        selectors: [],
        mustNotExistSelectors: [],
        textMustExist: [],
        textMustNotExist: [],
        maskSelectors: []
      },
      suggestedMutation: "not_applicable",
      validationCommand: "npm test",
      hiveOwner: "tester",
      layer: { id: 2, name: "Unit", status: "unknown" },
      suggestedTests: ["Add unit tests."],
      artifacts: [".visual-hive/testing-layers.json"],
      affected: { route: "/", component: "critical-route-shell" },
      trustedOnly: false,
      applyMode: "advisory_no_write"
    }]
  });
  await writeArtifact(root, ".visual-hive/readiness.json", {
    status: "blocked",
    blockedReasons: [],
    warnings: [],
    gates: [{ id: "mutation:score", category: "mutation", status: "blocked" }]
  });
  await writeArtifact(root, ".visual-hive/handoff.json", {
    workItems: [
      { id: "mutation.mutation_adequacy", kind: "test_creation", priority: "high", title: "Review mutation adequacy", summary: "Mutation score is below minimum.", artifacts: [".visual-hive/mutation-report.json"] },
      { id: "mutation.mutation_survivor.api-500", kind: "test_creation", priority: "high", title: "Strengthen survived mutation api-500", summary: "api-500 survived.", artifacts: [".visual-hive/mutation-report.json"] },
      { id: "readiness.readiness_gate", kind: "setup", priority: "high", title: "Review readiness gate", summary: "Readiness is blocked.", artifacts: [".visual-hive/readiness.json"] }
    ]
  });
}

function mutationReport(results: unknown[]) {
  return { schemaVersion: 2, project: "fixture", generatedAt: "2026-07-12T00:00:00.000Z", minScore: 0.8, score: 0, killed: 0, total: results.length, results };
}

function survivor(operator: string, targetId: string, contractIds: string[]) {
  const affectedSurfaces = contractIds.map((contractId) => ({ contractId, targetId }));
  return {
    operator,
    status: "survived",
    killed: false,
    applicable: true,
    contractIds,
    affected: affectedSurfaces,
    affectedSurfaces,
    durationMs: 1,
    errors: []
  };
}

function roleCounts(issues: Array<{ publicationRole: string }>): Record<string, number> {
  return Object.fromEntries(["aggregate", "canonical", "derivative"].map((role) => [role, issues.filter((issue) => issue.publicationRole === role).length]));
}
