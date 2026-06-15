import { describe, expect, it } from "vitest";
import type { MutationReport, Report, TriageFinding } from "@visual-hive/core";
import { buildIssueBody } from "../src/issueBody.js";
import { sanitizeText } from "../src/sanitize.js";

describe("sanitizeText", () => {
  it("redacts secret-like values in URLs, headers, cookies, and logs", () => {
    const input = [
      "https://example.com/callback?token=abc&access_token=def&id_token=ghi&refresh_token=jkl&code=123&key=456",
      "Authorization: Bearer secret-value",
      "Cookie: session=abc; password=secret",
      "secret=my-secret password=hunter2 bearer=abc"
    ].join("\n");
    const output = sanitizeText(input);

    expect(output).toContain("token=[REDACTED]");
    expect(output).toContain("access_token=[REDACTED]");
    expect(output).toContain("Authorization: [REDACTED]");
    expect(output).toContain("Cookie: [REDACTED]");
    expect(output).not.toContain("hunter2");
    expect(output).not.toContain("secret-value");
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
  it("includes failures, contracts, reproduction commands, and mutation score", () => {
    const report: Report = {
      schemaVersion: 1,
      project: "sample",
      mode: "pr",
      generatedAt: "2026-01-01T00:00:00.000Z",
      status: "failed",
      changedFiles: ["src/App.tsx"],
      consoleErrors: [],
      results: [
        {
          contractId: "dashboard-visual-stability",
          targetId: "localPreview",
          status: "failed",
          durationMs: 100,
          errors: ["Expected selector to exist"],
          artifacts: [".visual-hive/artifacts/screenshot.png"]
        }
      ]
    };
    const mutationReport: MutationReport = {
      schemaVersion: 1,
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
  });
});
