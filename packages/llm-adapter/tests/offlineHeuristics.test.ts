import { describe, expect, it } from "vitest";
import type { MutationReport, Report } from "@visual-hive/core";
import { classifyOffline } from "../src/offlineHeuristics.js";

describe("classifyOffline", () => {
  it("recommends coverage for survived mutations", () => {
    const mutationReport: MutationReport = {
      schemaVersion: 2,
      project: "sample",
      generatedAt: "2026-01-01T00:00:00.000Z",
      minScore: 0.7,
      score: 0,
      killed: 0,
      total: 1,
      results: [
        {
          operator: "mobile-overflow",
          status: "survived",
          killed: false,
          applicable: true,
          contractIds: ["dashboard-mobile"],
          durationMs: 10,
          errors: []
        }
      ]
    };

    const findings = classifyOffline({ mutationReport });

    expect(findings[0]?.classification).toBe("mutation_survivor");
    expect(findings[0]?.suggestedNextTests.join(" ")).toContain("mobile-overflow");
  });

  it("classifies empty contract reports", () => {
    const report: Report = {
      schemaVersion: 2,
      project: "sample",
      mode: "pr",
      generatedAt: "2026-01-01T00:00:00.000Z",
      status: "passed",
      changedFiles: [],
      selectedTargets: [],
      selectedContracts: [],
      excludedContracts: [],
      targetLifecycle: [],
      generatedSpecPath: ".visual-hive/generated/visual-hive.generated.spec.ts",
      summary: {
        passed: 0,
        failed: 0,
        screenshotsPassed: 0,
        screenshotsFailed: 0,
        baselinesCreated: 0,
        createdBaselines: 0,
        missingBaselines: 0,
        visualDiffs: 0,
        consoleErrors: 0,
        pageErrors: 0
      },
      results: [],
      consoleErrors: [],
      pageErrors: [],
      artifacts: [],
      reproductionCommands: []
    };

    const findings = classifyOffline({ report });

    expect(findings[0]?.classification).toBe("no_contracts_selected");
  });
});
