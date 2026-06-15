import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { MutationReport, Report, TriageFinding } from "@visual-hive/core";
import { buildIssueBody } from "../src/issueBody.js";
import { sanitizeText } from "../src/sanitize.js";

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
    const schema = JSON.parse(readFileSync("schemas/visual-hive.report.schema.json", "utf8"));

    expect(schema.properties.schemaVersion.const).toBe(2);
    expect(schema.required).toEqual(expect.arrayContaining(["summary", "targetLifecycle", "generatedSpecPath"]));
  });

  it("includes failures, contracts, reproduction commands, and mutation score", () => {
    const report: Report = {
      schemaVersion: 2,
      project: "sample",
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

    const body = buildIssueBody({ report, mutationReport, findings: [finding], reproductionCommands: ["visual-hive run --ci"] });

    expect(body).toContain("dashboard-visual-stability");
    expect(body).toContain("visual-hive run --ci");
    expect(body).toContain("50% (1/2)");
    expect(body).toContain("Missing dashboard element");
    expect(body).toContain("Visual diffs");
    expect(body).toContain("Suggested files to inspect");
  });
});
