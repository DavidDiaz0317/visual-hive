import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { buildHiveExportArtifacts } from "../src/hive/build.js";
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
      suggestedLabels: ["visual-hive", "hive/quality", "ai-ready"]
    }
  };
}
