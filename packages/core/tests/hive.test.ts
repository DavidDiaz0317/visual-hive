import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { buildHiveExportArtifacts, buildHiveModeComparison } from "../src/hive/build.js";
import type { EvidencePacket } from "../src/evidence/types.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

describe("Hive native export", () => {
  it("keeps advisory mode issue-context only and no-network", () => {
    const result = buildHiveExportArtifacts({
      evidencePacket: sampleEvidencePacket(),
      evidencePacketPath: ".visual-hive/evidence-packet.json",
      hiveConfig: {
        enabled: false,
        mode: "advisory"
      },
      now: new Date("2026-07-02T00:00:00.000Z")
    });

    expect(result.bundle.mode).toBe("advisory");
    expect(result.bundle.externalCallsMade).toBe(0);
    expect(result.bundle.summary.beads).toBe(0);
    expect(result.bundle.summary.knowledgeFacts).toBe(0);
    expect(result.bundle.summary.repairWorkOrders).toBe(0);
    expect(result.issueContext).toContain("Hive Agent Work Order");
    expect(result.issueContext).not.toContain("secret-value");
  });

  it("maps deterministic and mutation evidence into measured Hive beads, facts, and graph nodes", () => {
    const result = buildHiveExportArtifacts({
      evidencePacket: sampleEvidencePacket(),
      evidencePacketPath: ".visual-hive/evidence-packet.json",
      hiveConfig: {
        enabled: false,
        mode: "measured",
        export: {
          beads: true,
          knowledgeFacts: true,
          knowledgeGraph: true,
          wikiVault: true,
          repairWorkOrders: true,
          maxFacts: 20
        }
      },
      now: new Date("2026-07-02T00:00:00.000Z")
    });

    expect(result.bundle.summary.beads).toBeGreaterThanOrEqual(2);
    expect(result.bundle.beads.find((bead) => bead.type === "bug")?.actor).toBe("quality");
    expect(result.bundle.beads.find((bead) => bead.type === "task")?.metadata.visual_hive_operator).toBe("force-login-on-demo");
    expect(result.bundle.knowledgeFacts.map((fact) => fact.type)).toEqual(expect.arrayContaining(["regression", "coverage_rule", "decision"]));
    expect(result.bundle.knowledgeGraph.nodes.length).toBeGreaterThan(0);
    expect(result.bundle.knowledgeGraph.edges.every((edge) => nodeIds(result).has(edge.from) && nodeIds(result).has(edge.to))).toBe(true);
    expect(JSON.stringify(result.bundle)).not.toContain("secret-value");
  });

  it("creates guarded repair work orders with Visual Hive rerun acceptance criteria", () => {
    const result = buildHiveExportArtifacts({
      evidencePacket: sampleEvidencePacket(),
      evidencePacketPath: ".visual-hive/evidence-packet.json",
      hiveConfig: {
        enabled: true,
        mode: "repair_request",
        repair: {
          enabled: true,
          prOnly: true,
          maxAttempts: 1,
          requireHumanReview: true,
          rerunVisualHive: true,
          branchPrefix: "hive/visual-hive-"
        }
      },
      now: new Date("2026-07-02T00:00:00.000Z")
    });

    expect(result.bundle.summary.repairWorkOrders).toBeGreaterThan(0);
    expect(result.bundle.repairWorkOrders[0]?.acceptanceCriteria).toContain("Visual Hive verdict passes after repair.");
    expect(result.bundle.repairWorkOrders[0]?.forbiddenActions).toContain("auto_merge_without_visual_hive_pass");
    expect(result.bundle.agentPolicy.finalValidation.passFailOwnedBy).toBe("visual_hive_verdict_engine");
  });

  it("blocks guarded repair export unless explicit trusted repair policy is configured", () => {
    const result = buildHiveExportArtifacts({
      evidencePacket: sampleEvidencePacket(),
      evidencePacketPath: ".visual-hive/evidence-packet.json",
      hiveConfig: {
        enabled: false,
        mode: "guarded_repair"
      },
      now: new Date("2026-07-02T00:00:00.000Z")
    });

    expect(result.bundle.mode).toBe("guarded_repair");
    expect(result.bundle.status).toBe("blocked");
    expect(result.bundle.externalCallsMade).toBe(0);
    expect(result.bundle.blockedReasons).toEqual(
      expect.arrayContaining([
        "Guarded Hive repair requires integrations.hive.enabled=true in a trusted workflow.",
        "Guarded Hive repair requires integrations.hive.repair.enabled=true.",
        "Guarded Hive repair requires ACMM level 5 or higher."
      ])
    );
  });

  it("matches the tracked Hive export JSON schema", async () => {
    const result = buildHiveExportArtifacts({
      evidencePacket: sampleEvidencePacket(),
      evidencePacketPath: ".visual-hive/evidence-packet.json",
      hiveConfig: { enabled: true, mode: "repair_request" },
      now: new Date("2026-07-02T00:00:00.000Z")
    });
    const schema = JSON.parse(await readFile(path.join(repoRoot, "schemas", "visual-hive.hive-export.schema.json"), "utf8")) as Record<string, unknown>;
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
    expect(validate(result.bundle), JSON.stringify(validate.errors, null, 2)).toBe(true);
  });

  it("compares no-network Hive export modes and recommends repair request when work orders exist", async () => {
    const result = buildHiveModeComparison({
      evidencePacket: sampleEvidencePacket(),
      evidencePacketPath: ".visual-hive/evidence-packet.json",
      handoffPacketPath: ".visual-hive/handoff.json",
      hiveConfig: {
        enabled: true,
        mode: "advisory"
      },
      now: new Date("2026-07-02T00:00:00.000Z")
    });

    expect(result.comparison.schemaVersion).toBe("visual-hive.hive-mode-comparison.v1");
    expect(result.comparison.externalCallsMade).toBe(0);
    expect(result.comparison.modes.map((mode) => mode.mode)).toEqual(["advisory", "measured", "repair_request", "guarded_repair", "full"]);
    expect(result.comparison.modes.find((mode) => mode.mode === "advisory")?.summary.beads).toBe(0);
    expect(result.comparison.modes.find((mode) => mode.mode === "measured")?.summary.beads).toBeGreaterThan(0);
    expect(result.comparison.modes.find((mode) => mode.mode === "repair_request")?.summary.repairWorkOrders).toBeGreaterThan(0);
    expect(result.comparison.modes.find((mode) => mode.mode === "guarded_repair")).toMatchObject({
      status: "blocked",
      policy: {
        trustedWorkflowRequired: true
      }
    });
    expect(result.comparison.modes.find((mode) => mode.mode === "guarded_repair")?.blockedReasons).toEqual(
      expect.arrayContaining(["Guarded Hive repair requires integrations.hive.repair.enabled=true.", "Guarded Hive repair requires ACMM level 5 or higher."])
    );
    expect(result.comparison.modes.find((mode) => mode.mode === "full")).toMatchObject({
      status: "blocked",
      policy: {
        trustedWorkflowRequired: true
      }
    });
    expect(result.comparison.recommendation.mode).toBe("repair_request");
    expect(result.markdown).toContain("Hive Export Mode Comparison");
    expect(JSON.stringify(result.comparison)).not.toContain("secret-value");
  });

  it("matches the tracked Hive mode comparison JSON schema", async () => {
    const result = buildHiveModeComparison({
      evidencePacket: sampleEvidencePacket(),
      evidencePacketPath: ".visual-hive/evidence-packet.json",
      hiveConfig: { enabled: true },
      now: new Date("2026-07-02T00:00:00.000Z")
    });
    const schema = JSON.parse(await readFile(path.join(repoRoot, "schemas", "visual-hive.hive-mode-comparison.schema.json"), "utf8")) as Record<string, unknown>;
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
    expect(validate(result.comparison), JSON.stringify(validate.errors, null, 2)).toBe(true);
  });
});

function nodeIds(result: ReturnType<typeof buildHiveExportArtifacts>): Set<string> {
  return new Set(result.bundle.knowledgeGraph.nodes.map((node) => node.id));
}

function sampleEvidencePacket(): EvidencePacket {
  return {
    schemaVersion: "visual-hive.evidence-packet.v2",
    generatedAt: "2026-07-02T00:00:00.000Z",
    project: "hive-export-fixture",
    sourceArtifacts: {
      report: ".visual-hive/report.json",
      mutationReport: ".visual-hive/mutation-report.json"
    },
    governance: {
      verdictAuthority: "visual_hive",
      defaultBrowserBackend: "playwright",
      llmAuthority: "advisory_only",
      providerAuthority: "policy_gated_when_normalized",
      secretPolicy: "redacted_values_names_only"
    },
    repo: {
      repository: "visual-hive/test",
      branch: "main",
      commitSha: "abcdef"
    },
    plan: {
      schemaVersion: 1,
      project: "hive-export-fixture",
      mode: "pr",
      generatedAt: "2026-07-02T00:00:00.000Z",
      changedFiles: ["src/App.tsx"],
      effectiveChangedFiles: ["src/App.tsx"],
      selectedContracts: ["hosted-demo-never-login"],
      selectedTargets: ["hostedDemo"],
      excludedContracts: []
    },
    deterministicReport: {
      schemaVersion: 2,
      project: "hive-export-fixture",
      mode: "pr",
      generatedAt: "2026-07-02T00:00:00.000Z",
      status: "failed",
      selectedTargets: [{ id: "hostedDemo", kind: "url", url: "https://console.example.invalid?token=secret-value", prSafe: true, cost: "cheap" }],
      selectedContracts: ["hosted-demo-never-login"],
      excludedContracts: [],
      summary: {
        passed: 0,
        failed: 1,
        screenshotsPassed: 0,
        screenshotsFailed: 1,
        baselinesCreated: 0,
        createdBaselines: 0,
        missingBaselines: 0,
        visualDiffs: 1,
        consoleErrors: 0,
        pageErrors: 0
      },
      generatedSpecPath: ".visual-hive/generated/visual-hive.generated.spec.ts",
      reproductionCommands: ["visual-hive run --ci"],
      failedContracts: [
        {
          contractId: "hosted-demo-never-login",
          targetId: "hostedDemo",
          errors: ["Unexpected login button access_token=secret-value"],
          artifacts: [".visual-hive/artifacts/screenshots/dashboard.png"],
          reproductionCommand: "visual-hive run --ci"
        }
      ],
      screenshotEvidence: [
        {
          contractId: "hosted-demo-never-login",
          screenshotName: "dashboard",
          status: "failed",
          route: "/",
          viewport: "desktop",
          baselinePath: ".visual-hive/snapshots/dashboard.png",
          actualPath: ".visual-hive/artifacts/screenshots/dashboard.png",
          diffPath: ".visual-hive/artifacts/screenshots/dashboard-diff.png",
          actualDiffPixelRatio: 0.2,
          actualDiffPixels: 200
        }
      ],
      consoleErrors: 0,
      pageErrors: 0,
      networkErrors: 0
    },
    mutation: {
      schemaVersion: 2,
      project: "hive-export-fixture",
      generatedAt: "2026-07-02T00:00:00.000Z",
      minScore: 0.75,
      score: 0.5,
      killed: 1,
      total: 2,
      survivedOperators: [
        {
          operator: "force-login-on-demo",
          contractIds: ["hosted-demo-never-login"],
          failedAssertion: "Mutation survived",
          artifacts: [".visual-hive/mutation-report.json"]
        }
      ],
      notApplicableOperators: []
    },
    providers: [],
    testingLayers: [
      { id: 6, name: "E2E user-flow", status: "covered", evidence: [".visual-hive/report.json"], gaps: [] },
      { id: 9, name: "Mutation/fault injection", status: "covered", evidence: [".visual-hive/mutation-report.json"], gaps: [] },
      { id: 11, name: "Agent/Hive feedback", status: "partial", evidence: [".visual-hive/triage.json"], gaps: ["No Hive export yet."] }
    ],
    evidenceContributions: [
      {
        key: "playwright.selector_contract.hosted-demo-never-login",
        source: "playwright",
        kind: "selector_contract",
        status: "failed",
        gating: true,
        authority: "gating",
        mode: "pr",
        contractId: "hosted-demo-never-login",
        targetId: "hostedDemo",
        reason: "Unexpected login button access_token=secret-value",
        artifacts: [".visual-hive/artifacts/screenshots/dashboard.png"]
      },
      {
        key: "mutation.mutation_survivor.force-login-on-demo",
        source: "mutation",
        kind: "mutation_survivor",
        status: "warning",
        gating: false,
        authority: "advisory",
        operator: "force-login-on-demo",
        reason: "Mutation survived bearer secret-value",
        artifacts: [".visual-hive/mutation-report.json"]
      }
    ],
    verdictSummary: {
      visualHiveVerdict: "failed",
      failedBecause: ["playwright.selector_contract.hosted-demo-never-login"],
      warningBecause: [],
      blockedBecause: [],
      advisoryOnly: ["mutation.mutation_survivor.force-login-on-demo"]
    },
    hiveReadiness: {
      readyForIssueHandoff: true,
      readyForHiveDryRun: true,
      blockedReasons: [],
      suggestedLabels: ["visual-hive", "hive/quality", "ai-ready"],
      recommendedMode: "repair_request",
      recommendationReason: "Repair-request mode can package deterministic evidence into bounded work orders without granting Hive verdict authority.",
      modeReadiness: sampleHiveModeReadiness()
    }
  };
}

function sampleHiveModeReadiness(): EvidencePacket["hiveReadiness"]["modeReadiness"] {
  return [
    {
      mode: "advisory",
      status: "ready",
      reason: "Advisory mode can package sanitized issue context and policy only.",
      nextCommand: "visual-hive hive export --dry-run --mode advisory",
      localPreviewAllowed: true,
      trustedWorkflowRequired: false,
      externalCallsMade: 0,
      emits: { issueContext: true, beads: false, knowledgeFacts: false, knowledgeGraph: false, wikiVault: false, repairWorkOrders: false, agentPolicy: true },
      blockedReasons: []
    },
    {
      mode: "measured",
      status: "ready",
      reason: "Measured mode can add Beads, knowledge facts, graph context, and wiki pages.",
      nextCommand: "visual-hive hive export --dry-run --mode measured",
      localPreviewAllowed: true,
      trustedWorkflowRequired: false,
      externalCallsMade: 0,
      emits: { issueContext: true, beads: true, knowledgeFacts: true, knowledgeGraph: true, wikiVault: true, repairWorkOrders: false, agentPolicy: true },
      blockedReasons: []
    },
    {
      mode: "repair_request",
      status: "ready",
      reason: "Repair-request mode can emit bounded repair work orders for a trusted lane.",
      nextCommand: "visual-hive hive export --dry-run --mode repair_request",
      localPreviewAllowed: true,
      trustedWorkflowRequired: false,
      externalCallsMade: 0,
      emits: { issueContext: true, beads: true, knowledgeFacts: true, knowledgeGraph: true, wikiVault: true, repairWorkOrders: true, agentPolicy: true },
      blockedReasons: []
    },
    {
      mode: "guarded_repair",
      status: "blocked",
      reason: "guarded_repair is blocked by missing evidence or governance policy.",
      nextCommand: "visual-hive hive compare-modes",
      localPreviewAllowed: false,
      trustedWorkflowRequired: true,
      externalCallsMade: 0,
      emits: { issueContext: true, beads: true, knowledgeFacts: true, knowledgeGraph: true, wikiVault: true, repairWorkOrders: true, agentPolicy: true },
      blockedReasons: ["Guarded Hive repair requires integrations.hive.repair.enabled=true."]
    },
    {
      mode: "full",
      status: "blocked",
      reason: "full is blocked by missing evidence or governance policy.",
      nextCommand: "visual-hive hive compare-modes",
      localPreviewAllowed: false,
      trustedWorkflowRequired: true,
      externalCallsMade: 0,
      emits: { issueContext: true, beads: true, knowledgeFacts: true, knowledgeGraph: true, wikiVault: true, repairWorkOrders: true, agentPolicy: true },
      blockedReasons: ["Full Hive automation is reserved for a future ACMM L6-compatible workflow and is blocked locally."]
    }
  ];
}
