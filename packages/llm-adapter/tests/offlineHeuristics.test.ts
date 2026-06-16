import { describe, expect, it } from "vitest";
import type { CoverageReport, MutationReport, Report } from "@visual-hive/core";
import { classifyOffline } from "../src/offlineHeuristics.js";
import {
  buildBaselineReviewSummaryMarkdown,
  buildMissingTestsMarkdown,
  buildRepairPrompt,
  buildVisualFailureTriagePrompt
} from "../src/promptBuilders.js";

const sampleRepository = {
  provider: "local" as const,
  repository: "visual-hive/test",
  branch: "main",
  commitSha: "abcdef1234567890"
};

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

  it("does not treat not-applicable mutations as survivors", () => {
    const mutationReport: MutationReport = {
      schemaVersion: 2,
      project: "sample",
      generatedAt: "2026-01-01T00:00:00.000Z",
      minScore: 0.7,
      score: 0,
      killed: 0,
      total: 0,
      results: [
        {
          operator: "remove-demo-badge",
          status: "not_applicable",
          killed: false,
          applicable: false,
          contractIds: [],
          durationMs: 0,
          errors: ["No contracts matched"]
        }
      ]
    };

    const findings = classifyOffline({ mutationReport });

    expect(findings.map((finding) => finding.classification)).not.toContain("mutation_survivor");
  });

  it("classifies empty contract reports", () => {
    const report: Report = {
      schemaVersion: 2,
      project: "sample",
      repository: sampleRepository,
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

  it("builds sanitized repair and triage prompts", () => {
    const report = sampleReport({
      errors: ["Authorization: Bearer secret-token", "https://example.com?client_secret=abc"]
    });
    const findings = classifyOffline({ report });

    const triagePrompt = buildVisualFailureTriagePrompt({ report, findings });
    const repairPrompt = buildRepairPrompt({ report, findings });

    expect(triagePrompt).toContain("LLM output is advisory only");
    expect(repairPrompt).toContain("Repair prompt");
    expect(triagePrompt).not.toContain("secret-token");
    expect(repairPrompt).not.toContain("client_secret=abc");
    expect(triagePrompt).toContain("[REDACTED]");
  });

  it("classifies provider failures, protected missing secrets, flaky baselines, and insufficient coverage", () => {
    const report = sampleReport({ errors: ["screenshot diff"] });
    report.selectedTargets = [
      {
        id: "liveCluster",
        kind: "protected",
        url: "https://cluster.example.invalid",
        prSafe: false,
        cost: "expensive",
        missingSecrets: ["KUBECONFIG", "KC_AGENT_TOKEN"]
      }
    ];
    report.providerResults = [
      {
        providerId: "argos",
        label: "Argos",
        status: "missing_credentials",
        deterministicRole: "supplemental",
        message: "Provider credentials are missing.",
        requiredEnv: ["ARGOS_TOKEN"],
        missingEnv: ["ARGOS_TOKEN"],
        artifactCount: 0,
        normalizedAt: "2026-01-01T00:00:00.000Z"
      },
      {
        providerId: "percy",
        label: "Percy",
        status: "skipped",
        deterministicRole: "supplemental",
        message: "Provider enabled but external upload is blocked by cost policy.",
        requiredEnv: ["PERCY_TOKEN"],
        missingEnv: [],
        artifactCount: 2,
        externalUploadAllowed: false,
        externalUploadBlockedReasons: ["costPolicy.externalUpload.pullRequest=false for pr mode."],
        estimatedExternalScreenshots: 2,
        normalizedAt: "2026-01-01T00:00:00.000Z"
      }
    ];
    report.results[0].screenshotAssertions = [
      {
        contractId: "dashboard",
        screenshotName: "desktop",
        name: "desktop",
        route: "/",
        viewport: "desktop",
        status: "failed",
        baselinePath: ".visual-hive/snapshots/dashboard.png",
        actualPath: ".visual-hive/artifacts/screenshots/dashboard.png",
        diffPath: ".visual-hive/artifacts/screenshots/dashboard.diff.png",
        maxDiffPixelRatio: 0.01,
        actualDiffPixelRatio: 0.012,
        actualDiffPixels: 12,
        diffPixels: 12,
        totalPixels: 1000
      }
    ];
    const coverageReport: CoverageReport = {
      schemaVersion: 1,
      project: "sample",
      generatedAt: "2026-01-01T00:00:00.000Z",
      summary: {
        targetCount: 1,
        contractCount: 1,
        selectedContracts: 1,
        unselectedContracts: 0,
        prSafeContracts: 1,
        protectedContracts: 0,
        scheduleOnlyContracts: 0,
        routesCovered: 1,
        viewportsCovered: 1,
        uncoveredTargets: 0,
        uncoveredContracts: 0,
        changedFileRules: 1,
        matchedChangedFileRules: 0,
        unmatchedChangedFiles: 1
      },
      targets: [],
      contracts: [],
      routes: [],
      viewports: [],
      changedFileCoverage: [],
      unmatchedChangedFiles: ["src/unmapped.ts"],
      uncoveredAreas: [
        {
          kind: "changed_file_without_rule",
          severity: "low",
          changedFile: "src/unmapped.ts",
          message: "Changed file did not match any selection rule."
        }
      ]
    };

    const findings = classifyOffline({ report, coverageReport });
    const classifications = findings.map((finding) => finding.classification);

    expect(classifications).toContain("provider_failure");
    expect(classifications).toContain("provider_cost_policy_skipped");
    expect(classifications).toContain("protected_target_missing_secret");
    expect(classifications).toContain("flaky_baseline");
    expect(classifications).toContain("insufficient_coverage");

    const coveragePrompt = buildVisualFailureTriagePrompt({ report, coverageReport, findings });
    expect(coveragePrompt).toContain("Coverage report JSON");
    expect(coveragePrompt).toContain("changed_file_without_rule");
  });

  it("builds missing-test markdown from mutation survivors", () => {
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
          operator: "api-500",
          status: "survived",
          killed: false,
          applicable: true,
          contractIds: ["dashboard"],
          durationMs: 10,
          errors: ["Operator api-500 did not fail selected contracts."]
        }
      ]
    };
    const findings = classifyOffline({ mutationReport });
    const markdown = buildMissingTestsMarkdown({ mutationReport, findings });

    expect(markdown).toContain("# Missing Test Suggestions");
    expect(markdown).toContain("Mutation survived: api-500");
    expect(markdown).toContain("Add an assertion that detects api-500");
  });

  it("builds a sanitized baseline review summary", () => {
    const report = sampleReport({ errors: [] });
    report.results[0].screenshotAssertions = [
      {
        contractId: "dashboard",
        screenshotName: "desktop",
        name: "desktop",
        route: "/",
        viewport: "desktop",
        status: "failed",
        baselinePath: ".visual-hive/snapshots/dashboard.png",
        actualPath: ".visual-hive/artifacts/screenshots/dashboard.png?token=abc",
        diffPath: ".visual-hive/artifacts/screenshots/dashboard.diff.png",
        maxDiffPixelRatio: 0.01,
        actualDiffPixelRatio: 0.12,
        actualDiffPixels: 12,
        diffPixels: 12,
        totalPixels: 100
      }
    ];
    const markdown = buildBaselineReviewSummaryMarkdown({
      report,
      baselineRejectionLog: {
        schemaVersion: 1,
        rejections: [
          {
            schemaVersion: 1,
            rejectedAt: "2026-06-15T00:00:00.000Z",
            contractId: "dashboard",
            screenshotName: "desktop",
            route: "/",
            viewport: "desktop",
            sourceStatus: "failed",
            baselinePath: ".visual-hive/snapshots/dashboard.png",
            actualPath: ".visual-hive/artifacts/screenshots/dashboard.png",
            reason: "secret=do-not-print"
          }
        ]
      }
    });

    expect(markdown).toContain("# Baseline Review Summary");
    expect(markdown).toContain("Screenshots needing review: 1");
    expect(markdown).toContain("Rejected Decisions");
    expect(markdown).not.toContain("do-not-print");
    expect(markdown).toContain("[REDACTED]");
  });
});

function sampleReport(options: { errors: string[] }): Report {
  return {
    schemaVersion: 2,
    project: "sample",
    repository: sampleRepository,
    mode: "pr",
    generatedAt: "2026-01-01T00:00:00.000Z",
    status: "failed",
    changedFiles: [],
    selectedTargets: [{ id: "local", kind: "url", url: "http://127.0.0.1:4173", prSafe: true, cost: "cheap" }],
    selectedContracts: ["dashboard"],
    excludedContracts: [],
    targetLifecycle: [],
    generatedSpecPath: ".visual-hive/generated/visual-hive.generated.spec.ts",
    summary: {
      passed: 0,
      failed: 1,
      screenshotsPassed: 0,
      screenshotsFailed: 0,
      baselinesCreated: 0,
      createdBaselines: 0,
      missingBaselines: 0,
      visualDiffs: 0,
      consoleErrors: 0,
      pageErrors: 0
    },
    results: [
      {
        contractId: "dashboard",
        targetId: "local",
        status: "failed",
        durationMs: 1,
        errors: options.errors,
        artifacts: [],
        consoleErrors: [],
        pageErrors: [],
        networkErrors: [],
        reproductionCommand: "visual-hive run --ci"
      }
    ],
    consoleErrors: [],
    pageErrors: [],
    artifacts: [],
    reproductionCommands: ["visual-hive run --ci"]
  };
}
