import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { MutationReport, Report, TriageFinding, WorkflowAuditReport } from "@visual-hive/core";
import { buildIssueBody } from "../src/issueBody.js";
import { buildPrComment } from "../src/prComment.js";
import { sanitizeText } from "../src/sanitize.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const sampleRepository = {
  provider: "github-actions" as const,
  repository: "DavidDiaz0317/visual-hive",
  branch: "feature",
  baseBranch: "main",
  commitSha: "abcdef1234567890",
  pullRequestNumber: 1,
  runId: "123"
};

describe("sanitizeText", () => {
  it("redacts secret-like values in URLs, headers, cookies, and logs", () => {
    const input = [
      "https://example.com/callback?token=abc&access_token=def&id_token=ghi&refresh_token=jkl&code=123&key=456",
      "Authorization: Bearer secret-value",
      "Cookie: session=abc; password=secret",
      "Set-Cookie: session=abc",
      "{\"client_secret\":\"json-secret\"}",
      "secret=my-secret password=hunter2 bearer=abc"
    ].join("\n");
    const output = sanitizeText(input);

    expect(output).toContain("token=[REDACTED]");
    expect(output).toContain("access_token=[REDACTED]");
    expect(output).toContain("Authorization: [REDACTED]");
    expect(output).toContain("Cookie: [REDACTED]");
    expect(output).toContain("Set-Cookie: [REDACTED]");
    expect(output).not.toContain("hunter2");
    expect(output).not.toContain("secret-value");
    expect(output).not.toContain("json-secret");
  });

  it("redacts report-visible strings", () => {
    const output = sanitizeText("Server log token=abc Authorization: Bearer def Cookie: session=ghi");
    expect(output).toContain("token=[REDACTED]");
    expect(output).toContain("Authorization: [REDACTED]");
    expect(output).not.toContain("abc");
    expect(output).not.toContain("def");
    expect(output).not.toContain("ghi");
  });
});

describe("buildIssueBody", () => {
  it("documents required v2 report fields in the JSON schema", () => {
    const schema = JSON.parse(readFileSync(path.join(repoRoot, "schemas/visual-hive.report.schema.json"), "utf8"));

    expect(schema.properties.schemaVersion.const).toBe(2);
    expect(schema.required).toEqual(expect.arrayContaining(["summary", "targetLifecycle", "generatedSpecPath"]));
  });

  it("includes failures, contracts, reproduction commands, and mutation score", () => {
    const report: Report = {
      schemaVersion: 2,
      project: "sample",
      repository: sampleRepository,
      mode: "pr",
      generatedAt: "2026-01-01T00:00:00.000Z",
      status: "failed",
      changedFiles: ["src/App.tsx"],
      selectedTargets: [{ id: "localPreview", kind: "command", url: "http://127.0.0.1:4173", prSafe: true, cost: "cheap" }],
      selectedContracts: ["dashboard-visual-stability"],
      excludedContracts: [],
      targetLifecycle: [],
      generatedSpecPath: ".visual-hive/generated/visual-hive.generated.spec.ts",
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
      consoleErrors: [],
      pageErrors: [],
      artifacts: [".visual-hive/artifacts/screenshot.png"],
      providerResults: [
        {
          providerId: "playwright",
          label: "Playwright built-in",
          status: "failed",
          deterministicRole: "oracle",
          message: "Built-in Playwright deterministic run failed.",
          requiredEnv: [],
          missingEnv: [],
          artifactCount: 1,
          normalizedAt: "2026-01-01T00:00:00.000Z"
        }
      ],
      reproductionCommands: ["visual-hive run --ci"],
      results: [
        {
          contractId: "dashboard-visual-stability",
          targetId: "localPreview",
          status: "failed",
          durationMs: 100,
          errors: ["Expected selector to exist"],
          artifacts: [".visual-hive/artifacts/screenshot.png"],
          reproductionCommand: "visual-hive run --ci",
          screenshotAssertions: [
            {
              contractId: "dashboard-visual-stability",
              screenshotName: "dashboard",
              name: "dashboard",
              route: "/",
              viewport: "desktop",
              status: "failed",
              baselinePath: ".visual-hive/snapshots/dashboard.png",
              actualPath: ".visual-hive/artifacts/dashboard.png",
              diffPath: ".visual-hive/artifacts/dashboard.diff.png",
              maxDiffPixelRatio: 0.01,
              actualDiffPixelRatio: 0.2,
              actualDiffPixels: 2,
              diffPixels: 2,
              totalPixels: 10
            }
          ]
        }
      ]
    };
    const mutationReport: MutationReport = {
      schemaVersion: 2,
      project: "sample",
      generatedAt: "2026-01-01T00:00:00.000Z",
      minScore: 0.7,
      score: 0.5,
      killed: 1,
      total: 2,
      results: []
    };
    const finding: TriageFinding = {
      classification: "missing_element",
      severity: "high",
      title: "Missing dashboard element",
      evidence: ["Expected selector"],
      suggestedNextTests: ["Add a selector contract"]
    };

    const workflowAudit: WorkflowAuditReport = {
      schemaVersion: 1,
      project: "sample",
      generatedAt: "2026-01-01T00:00:00.000Z",
      workflowRoot: ".github/workflows",
      summary: {
        workflowCount: 2,
        pullRequestWorkflows: 1,
        scheduledWorkflows: 0,
        trustedIssueWorkflows: 1,
        unknownWorkflows: 0,
        criticalFindings: 1,
        highFindings: 0,
        workflowsUsingPullRequestTarget: 1,
        prWorkflowsUsingSecrets: 1,
        prWorkflowsWithWritePermissions: 1,
        workflowsUploadingArtifacts: 1,
        workflowsMissingHiddenArtifactUpload: 1,
        trustedIssueWorkflowsCheckingOutCode: 0
      },
      workflows: [],
      findings: [
        {
          workflowPath: ".github/workflows/pr.yml?token=secret-token",
          kind: "pull_request_target",
          severity: "critical",
          message: "Workflow uses pull_request_target with Authorization: Bearer secret-value",
          evidence: "pull_request_target"
        }
      ],
      recommendations: ["Keep PR workflows read-only and secret-free."]
    };

    const body = buildIssueBody({
      report,
      mutationReport,
      workflowAudit,
      findings: [finding],
      reproductionCommands: ["visual-hive run --ci"]
    });

    expect(body).toContain("dashboard-visual-stability");
    expect(body).toContain("DavidDiaz0317/visual-hive");
    expect(body).toContain("abcdef123456");
    expect(body).toContain("visual-hive run --ci");
    expect(body).toContain("50% (1/2)");
    expect(body).toContain("Missing dashboard element");
    expect(body).toContain("Visual diffs");
    expect(body).toContain("Suggested files to inspect");
    expect(body).toContain("Provider results");
    expect(body).toContain("Playwright built-in");
    expect(body).toContain("Workflow safety");
    expect(body).toContain("pull_request_target workflows: 1");
    expect(body).toContain("critical/pull_request_target");
    expect(body).toContain("token=[REDACTED]");
    expect(body).not.toContain("secret-token");
    expect(body).not.toContain("secret-value");
  });
});

describe("buildPrComment", () => {
  it("builds a sanitized PR comment with workflow safety summary", () => {
    const body = buildPrComment({
      marker: "<!-- visual-hive-report -->",
      report: {
        schemaVersion: 2,
        project: "sample",
        repository: { ...sampleRepository, branch: "feature?token=secret-token" },
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
          passed: 1,
          failed: 0,
          screenshotsPassed: 1,
          screenshotsFailed: 0,
          baselinesCreated: 0,
          createdBaselines: 0,
          missingBaselines: 0,
          visualDiffs: 0,
          consoleErrors: 0,
          pageErrors: 0
        },
        consoleErrors: [],
        pageErrors: [],
        artifacts: [],
        providerResults: [],
        reproductionCommands: [],
        results: []
      },
      workflowAudit: {
        schemaVersion: 1,
        project: "sample",
        generatedAt: "2026-01-01T00:00:00.000Z",
        workflowRoot: ".github/workflows",
        summary: {
          workflowCount: 1,
          pullRequestWorkflows: 1,
          scheduledWorkflows: 0,
          trustedIssueWorkflows: 0,
          unknownWorkflows: 0,
          criticalFindings: 0,
          highFindings: 1,
          workflowsUsingPullRequestTarget: 0,
          prWorkflowsUsingSecrets: 1,
          prWorkflowsWithWritePermissions: 0,
          workflowsUploadingArtifacts: 1,
          workflowsMissingHiddenArtifactUpload: 0,
          trustedIssueWorkflowsCheckingOutCode: 0
        },
        workflows: [],
        findings: [
          {
            workflowPath: ".github/workflows/pr.yml",
            kind: "pr_secrets",
            severity: "high",
            message: "PR workflow uses secret",
            evidence: "secrets"
          }
        ],
        recommendations: []
      }
    });

    expect(body).toContain("<!-- visual-hive-report -->");
    expect(body).toContain("Workflow safety findings: 1");
    expect(body).toContain("token=[REDACTED]");
    expect(body).not.toContain("secret-token");
  });
});
