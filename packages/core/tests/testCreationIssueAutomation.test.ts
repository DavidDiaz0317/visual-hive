import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildIssuesReport } from "../src/issues/build.js";
import { TestCreationPlanV2Schema } from "../src/testCreation/types.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("test-creation issue automation grounding", () => {
  it.each([
    ["unknown plan field", () => ({ ...plan([recommendation()]), unknownPlanField: true })],
    ["unknown recommendation field", () => plan([{ ...recommendation(), unknownRecommendationField: true }])],
    ["unknown grounding field", () => plan([recommendation({
      grounding: { status: "grounded", evidence: ["repo-map:test-runner:vitest"], unresolvedReasons: [], unknownGroundingField: true }
    })])],
    ["incorrect summary", () => ({ ...plan([recommendation()]), summary: { ...(plan([recommendation()]).summary as object), total: 2 } })],
    ["blank grounded evidence", () => plan([recommendation({
      grounding: { status: "grounded", evidence: ["  "], unresolvedReasons: [] }
    })])],
    ["grounded unresolved reason", () => plan([recommendation({
      grounding: { status: "grounded", evidence: ["repo-map:test-runner:vitest"], unresolvedReasons: ["Still unresolved."] }
    })])]
  ])("the shared strict v2 schema rejects %s", (_name, makePlan) => {
    expect(TestCreationPlanV2Schema.safeParse(makePlan()).success).toBe(false);
  });

  it("the shared strict v2 schema accepts the canonical fixture", () => {
    expect(TestCreationPlanV2Schema.safeParse(plan([recommendation()])).success).toBe(true);
  });

  it("uses only grounded v2 recommendations and filters before limiting publications", async () => {
    const rootDir = await makeRoot();
    const unresolved = recommendation({
      id: "unresolved-first",
      gapId: "unresolved-first",
      title: "FABRICATED UNRESOLVED SCOPE",
      affected: { route: "/fabricated", component: "invented-component" },
      grounding: { status: "unresolved", evidence: [], unresolvedReasons: ["Repository evidence does not identify this route."] }
    });
    const grounded = recommendation({
      id: "grounded-second",
      gapId: "grounded-second",
      title: "Grounded repository unit coverage",
      affected: { component: "repository-module" },
      grounding: { status: "grounded", evidence: ["repo-map:test-runner:vitest", "repo-map:file:src/module.ts"], unresolvedReasons: [] }
    });
    await writeArtifact(rootDir, ".visual-hive/test-creation-plan.json", plan([unresolved, grounded]));

    const result = await buildIssuesReport({ rootDir, project: "grounding-filter" });
    const gaps = result.report.issues.filter((issue) => issue.issueKind === "test_adequacy_gap");

    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({
      title: "[Visual Hive] Add repository test coverage: Grounded repository unit coverage",
      publicationRole: "canonical",
      rootCauseKey: "test-adequacy/repository/testing-layer:2",
      affected: [{ component: "repository-module" }, { contractId: "testing-layer:2" }]
    });
    expect(JSON.stringify(result.report)).not.toContain("FABRICATED UNRESOLVED SCOPE");
    expect(JSON.stringify(result.report)).not.toContain("/fabricated");
    expect(gaps[0]?.body).toContain("Repair scope: add focused repository test files only");
  });

  it.each([
    ["legacy v1", () => ({ ...plan([recommendation()]), schemaVersion: "visual-hive.test-creation-plan.v1" })],
    ["unresolved v2", () => plan([recommendation({
      grounding: { status: "unresolved", evidence: [], unresolvedReasons: ["No repository mapping exists."] },
      affected: { route: "/guessed" }
    })])],
    ["malformed grounded v2", () => plan([recommendation({
      grounding: { status: "grounded", evidence: [], unresolvedReasons: [] },
      affected: { component: "guessed-component" }
    })])],
    ["unknown-field v2", () => ({ ...plan([recommendation()]), unknownPlanField: true })]
  ])("does not derive repository automation from %s", async (_name, makePlan) => {
    const rootDir = await makeRoot();
    await writeArtifact(rootDir, ".visual-hive/test-creation-plan.json", makePlan());

    const result = await buildIssuesReport({ rootDir, project: "negative-grounding" });

    expect(result.report.issues.some((issue) => issue.issueKind === "test_adequacy_gap")).toBe(false);
    expect(result.report.issues.some((issue) => issue.rootCauseKey.startsWith("test-adequacy/"))).toBe(false);
    expect(JSON.stringify(result.report)).not.toContain("Repair scope: add focused repository test files only");
  });

  it.each([
    ["legacy v1", () => ({ ...plan([recommendation()]), schemaVersion: "visual-hive.test-creation-plan.v1" })],
    ["unresolved v2", () => plan([recommendation({
      grounding: { status: "unresolved", evidence: [], unresolvedReasons: ["No repository mapping exists."] }
    })])],
    ["malformed v2", () => plan([recommendation({
      grounding: { status: "grounded", evidence: [""], unresolvedReasons: [] }
    })])],
    ["unknown-field v2", () => ({ ...plan([recommendation()]), unknownPlanField: true })]
  ])("blocks rather than resolves a prior test-adequacy issue when the current plan is %s", async (_name, makePlan) => {
    const rootDir = await makeRoot();
    await writeArtifact(rootDir, ".visual-hive/test-creation-plan.json", plan([recommendation()]));
    const first = await buildIssuesReport({ rootDir, project: "resolution-safety" });
    const previous = first.report.issues.find((issue) => issue.issueKind === "test_adequacy_gap");
    expect(previous).toBeDefined();
    await writeArtifact(rootDir, ".visual-hive/issues.json", first.report);
    await writeArtifact(rootDir, ".visual-hive/test-creation-plan.json", makePlan());

    const next = await buildIssuesReport({ rootDir, project: "resolution-safety" });
    const retained = next.report.issues.find((issue) => issue.dedupeFingerprint === previous?.dedupeFingerprint);

    expect(retained).toMatchObject({ status: "blocked", issueKind: "test_adequacy_gap" });
    expect(retained?.labels).toContain("visual-hive/blocked");
    expect(retained?.body).toContain("Resolution is blocked because the current test-creation plan cannot authoritatively omit");
  });

  it.each([
    ["empty", []],
    ["no relevant recommendation", [recommendation({
      id: "grounded-screenshot",
      gapId: "grounded-screenshot",
      source: "coverage_recommendation",
      kind: "screenshot",
      title: "Grounded but unrelated screenshot guidance",
      layer: undefined
    })]]
  ])("allows a structurally valid v2 %s plan to resolve an absent prior test-adequacy issue", async (_name, recommendations) => {
    const rootDir = await makeRoot();
    await writeArtifact(rootDir, ".visual-hive/test-creation-plan.json", plan([recommendation()]));
    const first = await buildIssuesReport({ rootDir, project: "valid-resolution" });
    const previous = first.report.issues.find((issue) => issue.issueKind === "test_adequacy_gap");
    expect(previous).toBeDefined();
    await writeArtifact(rootDir, ".visual-hive/issues.json", first.report);
    await writeArtifact(rootDir, ".visual-hive/test-creation-plan.json", plan(recommendations));

    const next = await buildIssuesReport({ rootDir, project: "valid-resolution" });
    expect(next.report.issues.find((issue) => issue.dedupeFingerprint === previous?.dedupeFingerprint)).toMatchObject({
      status: "resolved_candidate",
      issueKind: "test_adequacy_gap"
    });
  });
});

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-hive-test-creation-issues-"));
  temporaryRoots.push(root);
  return root;
}

async function writeArtifact(root: string, relative: string, value: unknown): Promise<void> {
  const target = path.join(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function plan(recommendations: Array<Record<string, unknown>>): Record<string, unknown> {
  return {
    schemaVersion: "visual-hive.test-creation-plan.v2",
    generatedAt: "2026-07-15T12:00:00.000Z",
    project: "issue-automation-fixture",
    sourceArtifacts: {},
    governance: {
      verdictAuthority: "visual_hive",
      agentAuthority: "advisory_test_generation_only",
      writePolicy: "no_config_or_test_files_written",
      secretPolicy: "redacted_values_names_only"
    },
    summary: {
      total: recommendations.length,
      high: recommendations.filter((item) => item.priority === "high").length,
      medium: recommendations.filter((item) => item.priority === "medium").length,
      low: recommendations.filter((item) => item.priority === "low").length,
      fromTestingLayers: recommendations.filter((item) => item.source === "testing_layer").length,
      fromCoverageRecommendations: recommendations.filter((item) => item.source === "coverage_recommendation").length,
      fromMutationSurvivors: recommendations.filter((item) => item.source === "mutation_survivor").length,
      fromHandoffWorkItems: recommendations.filter((item) => item.source === "handoff_work_item").length
    },
    recommendations
  };
}

function recommendation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: "grounded-unit",
    gapId: "grounded-unit",
    source: "testing_layer",
    kind: "unit_test",
    priority: "medium",
    title: "Add grounded repository unit coverage",
    rationale: ["Repository mapping identifies an uncovered unit-test scope."],
    affected: {},
    currentEvidence: ["repo-map:test-runner:vitest"],
    grounding: { status: "grounded", evidence: ["repo-map:test-runner:vitest"], unresolvedReasons: [] },
    suggestedContract: {
      id: "grounded-unit-contract",
      description: "Grounded unit-test guidance.",
      selectors: [],
      mustNotExistSelectors: [],
      textMustExist: [],
      textMustNotExist: [],
      maskSelectors: []
    },
    suggestedMutation: "not_applicable",
    validationCommand: "npm test",
    hiveOwner: "tester",
    layer: { id: 2, name: "Unit", status: "missing" },
    suggestedTests: ["Add a focused repository unit test."],
    artifacts: [".visual-hive/repo-map.json"],
    trustedOnly: false,
    applyMode: "advisory_no_write"
  };
  const merged = { ...base, ...overrides };
  if (overrides.layer === undefined && Object.prototype.hasOwnProperty.call(overrides, "layer")) delete merged.layer;
  return merged;
}
