import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { afterEach, describe, expect, it } from "vitest";
import {
  writeEvidencePacket,
  writeJson,
  type TestCreationPlan,
  type TestCreationRecommendation
} from "@visual-hive/core";
import { runAgentPacketCommand } from "../src/commands/agentPacket.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Agent Packet test-creation v2 boundary", () => {
  it("accepts a strict v2 plan, transports only grounded recommendations, and satisfies the Agent Packet schema", async () => {
    const rootDir = await repositoryFixture();
    const testCreationPlanPath = path.join(rootDir, ".visual-hive", "test-creation-plan.json");
    await writeJson(testCreationPlanPath, planFixture());

    const result = await runAgentPacketCommand({ cwd: rootDir, profile: "test_creator" });

    expect(result.testCreationPlanPath).toBe(testCreationPlanPath);
    expect(result.packet.sourceArtifacts.testCreationPlan).toBe(".visual-hive/test-creation-plan.json");
    expect(result.packet.evidenceSummary.testCreationRecommendations.map((recommendation) => recommendation.id)).toEqual(["grounded-contract"]);
    expect(result.packet.evidenceSummary.testCreationRecommendations[0]?.grounding).toEqual({
      status: "grounded",
      evidence: ["config.contract:dashboard"],
      unresolvedReasons: []
    });
    expect(result.packet.evidenceSummary.testCreationRecommendations[0]?.suggestedContract).toMatchObject({
      selectors: ["[data-testid='dashboard']"],
      mustNotExistSelectors: ["[data-testid='fatal-error']"],
      textMustExist: ["Dashboard"],
      textMustNotExist: ["Service unavailable"],
      maskSelectors: ["[data-testid='last-updated']"]
    });
    expect(result.packet.instructions).toContain(
      "Author tests or configuration only from recommendations whose grounding status is grounded; unresolved recommendations are mapping/review context only."
    );

    const schema = JSON.parse(
      await readFile(new URL("../../../schemas/visual-hive.agent-packet.schema.json", import.meta.url), "utf8")
    ) as object;
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
    expect(validate(result.packet), JSON.stringify(validate.errors)).toBe(true);
  });

  it.each([
    ["legacy", { schemaVersion: "visual-hive.test-creation-plan.v1", recommendations: [groundedRecommendation()] }],
    ["malformed", { ...planFixture(), recommendations: [{ id: "missing-v2-fields", grounding: { status: "grounded" } }] }],
    ["extra-property", { ...planFixture(), unexpected: true }],
    ["extra-recommendation-property", {
      ...planFixture(),
      recommendations: [{ ...groundedRecommendation(), unexpected: true }, unresolvedRecommendation()]
    }],
    ["incorrect-summary", { ...planFixture(), summary: { ...planFixture().summary, total: 99 } }],
    ["malformed-grounding", {
      ...planFixture(),
      recommendations: [
        { ...groundedRecommendation(), grounding: { status: "grounded", evidence: [], unresolvedReasons: [] } },
        unresolvedRecommendation()
      ]
    }]
  ])("ignores a %s test-creation artifact without leaking provenance or recommendations", async (name, artifact) => {
    const rootDir = await repositoryFixture();
    await writeJson(path.join(rootDir, ".visual-hive", "test-creation-plan.json"), artifact);

    const result = await runAgentPacketCommand({
      cwd: rootDir,
      profile: "test_creator",
      output: path.join(".visual-hive", `agent-packet-${name}.json`)
    });

    expect(result.testCreationPlanPath).toBeUndefined();
    expect(result.packet.sourceArtifacts.testCreationPlan).toBeUndefined();
    expect(result.packet.evidenceSummary.testCreationRecommendations).toEqual([]);
  });
});

async function repositoryFixture(): Promise<string> {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "visual-hive-agent-v2-"));
  temporaryDirectories.push(rootDir);
  await writeFile(
    path.join(rootDir, "visual-hive.config.yaml"),
    [
      "project:",
      "  name: agent-v2-fixture",
      "targets:",
      "  local:",
      "    kind: url",
      "    url: http://127.0.0.1:4173",
      "contracts:",
      "  - id: dashboard",
      "    description: Dashboard remains visible",
      "    target: local",
      ""
    ].join("\n"),
    "utf8"
  );
  await writeEvidencePacket({
    rootDir,
    project: "agent-v2-fixture",
    now: new Date("2026-07-15T12:00:00.000Z")
  });
  return rootDir;
}

function planFixture(): TestCreationPlan {
  return {
    schemaVersion: "visual-hive.test-creation-plan.v2",
    generatedAt: "2026-07-15T12:01:00.000Z",
    project: "agent-v2-fixture",
    sourceArtifacts: { evidencePacket: ".visual-hive/evidence-packet.json" },
    governance: {
      verdictAuthority: "visual_hive",
      agentAuthority: "advisory_test_generation_only",
      writePolicy: "no_config_or_test_files_written",
      secretPolicy: "redacted_values_names_only"
    },
    summary: {
      total: 2,
      high: 2,
      medium: 0,
      low: 0,
      fromTestingLayers: 0,
      fromCoverageRecommendations: 2,
      fromMutationSurvivors: 0,
      fromHandoffWorkItems: 0
    },
    recommendations: [groundedRecommendation(), unresolvedRecommendation()]
  };
}

function groundedRecommendation(): TestCreationRecommendation {
  return {
    ...recommendationBase("grounded-contract"),
    affected: { route: "/dashboard", viewport: "desktop" },
    grounding: {
      status: "grounded",
      evidence: ["config.contract:dashboard"],
      unresolvedReasons: []
    },
    suggestedContract: {
      id: "dashboard",
      description: "Dashboard remains visible",
      targetId: "local",
      route: "/dashboard",
      viewport: "desktop",
      selectors: ["[data-testid='dashboard']"],
      mustNotExistSelectors: ["[data-testid='fatal-error']"],
      textMustExist: ["Dashboard"],
      textMustNotExist: ["Service unavailable"],
      maskSelectors: ["[data-testid='last-updated']"]
    },
    suggestedTests: ["Add deterministic selector coverage for the observed dashboard contract."]
  };
}

function unresolvedRecommendation(): TestCreationRecommendation {
  return {
    ...recommendationBase("unresolved-contract"),
    affected: {},
    grounding: {
      status: "unresolved",
      evidence: [],
      unresolvedReasons: ["Contract unknown-contract is not present in the loaded Visual Hive config or repository map."]
    },
    suggestedContract: {
      id: "unknown-contract",
      description: "Unknown contract",
      selectors: [],
      mustNotExistSelectors: [],
      textMustExist: [],
      textMustNotExist: [],
      maskSelectors: []
    },
    suggestedTests: ["Resolve this gap to exact evidence before authoring a test."]
  };
}

function recommendationBase(id: string): Omit<
  TestCreationRecommendation,
  "affected" | "grounding" | "suggestedContract" | "suggestedTests"
> {
  return {
    id,
    gapId: `gap:${id}`,
    source: "coverage_recommendation",
    kind: "selector_assertion",
    priority: "high",
    title: `Recommendation ${id}`,
    rationale: ["Deterministic coverage evidence requires review."],
    currentEvidence: ["Artifact: .visual-hive/coverage-recommendations.json"],
    suggestedMutation: "not_applicable",
    validationCommand: "visual-hive run --config visual-hive.config.yaml --ci",
    hiveOwner: "tester",
    coverageRecommendationId: id,
    artifacts: [".visual-hive/coverage-recommendations.json"],
    trustedOnly: false,
    applyMode: "advisory_no_write"
  };
}
