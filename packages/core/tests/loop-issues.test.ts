import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeIssuesArtifacts } from "../src/issues/build.js";
import { writeJson } from "../src/utils/files.js";

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function tempRepo(): Promise<string> {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "visual-hive-loop-issues-"));
  tempDirs.push(rootDir);
  await mkdir(path.join(rootDir, ".visual-hive"), { recursive: true });
  return rootDir;
}

describe("operational loop issue derivation", () => {
  it("derives real issue candidates from deterministic failures, mutation survivors, and coverage gaps", async () => {
    const rootDir = await tempRepo();
    await writeJson(path.join(rootDir, ".visual-hive", "report.json"), {
      schemaVersion: 2,
      project: "real-loop-demo",
      mode: "full",
      generatedAt: "2026-07-08T00:00:00.000Z",
      status: "failed",
      changedFiles: ["src/Dashboard.tsx"],
      results: [
        {
          contractId: "dashboard-visual-stability",
          targetId: "localPreview",
          status: "failed",
          durationMs: 120,
          errors: ["Missing selector [data-testid='dashboard-card-grid']"],
          selectorAssertions: [{ kind: "mustExist", value: "[data-testid='dashboard-card-grid']", status: "failed" }],
          screenshotAssertions: [
            {
              contractId: "dashboard-visual-stability",
              screenshotName: "dashboard-desktop",
              route: "/",
              viewport: "desktop",
              status: "failed",
              baselinePath: ".visual-hive/snapshots/dashboard.png",
              actualPath: ".visual-hive/artifacts/screenshots/dashboard.png",
              diffPath: ".visual-hive/artifacts/screenshots/dashboard.diff.png",
              maxDiffPixelRatio: 0.01,
              actualDiffPixelRatio: 0.12,
              actualDiffPixels: 1200
            }
          ],
          consoleErrors: [],
          pageErrors: [],
          networkErrors: [],
          artifacts: [".visual-hive/artifacts/screenshots/dashboard.png"],
          reproductionCommand: "visual-hive run --ci"
        }
      ],
      summary: {}
    });
    await writeJson(path.join(rootDir, ".visual-hive", "mutation-report.json"), {
      schemaVersion: 2,
      project: "real-loop-demo",
      generatedAt: "2026-07-08T00:00:00.000Z",
      score: 0,
      killed: 0,
      survived: 1,
      total: 1,
      results: [
        {
          operator: "force-login-on-demo",
          status: "survived",
          killed: false,
          contractIds: ["hosted-demo-never-login"],
          selectedContracts: ["hosted-demo-never-login"],
          expectedFailureKinds: ["login_regression"],
          failedAssertion: "Login exposure mutation was not caught.",
          validationCommand: "visual-hive mutate --operator force-login-on-demo",
          durationMs: 50,
          artifacts: [".visual-hive/mutation-report.json"],
          sourceMutation: false
        }
      ]
    });
    await writeJson(path.join(rootDir, ".visual-hive", "coverage-recommendations.json"), {
      schemaVersion: "visual-hive.coverage-recommendations.v1",
      generatedAt: "2026-07-08T00:00:00.000Z",
      project: "real-loop-demo",
      recommendations: [
        {
          id: "settings-route-gap",
          title: "Add settings route visual coverage",
          description: "Settings route is missing a PR-safe visual contract.",
          severity: "medium",
          targetId: "localPreview",
          route: "/settings"
        }
      ],
      maintenanceFindings: []
    });
    await writeJson(path.join(rootDir, ".visual-hive", "evidence-packet.json"), { project: "real-loop-demo" });
    await writeJson(path.join(rootDir, ".visual-hive", "visual-graph.json"), { nodes: [] });
    await writeJson(path.join(rootDir, ".visual-hive", "handoff.json"), { workItems: [] });
    await writeJson(path.join(rootDir, ".visual-hive", "hive", "hive-export.json"), { beads: [] });

    const result = await writeIssuesArtifacts({ rootDir, project: "real-loop-demo" });

    expect(result.report.issues.map((issue) => issue.issueKind)).toEqual(
      expect.arrayContaining(["selector_contract_failure", "mutation_survivor", "missing_visual_coverage"])
    );
    const survivor = result.report.issues.find((issue) => issue.issueKind === "mutation_survivor");
    expect(survivor?.labels).toEqual(expect.arrayContaining(["visual-hive/ready-for-hive", "visual-hive/live", "hive/quality"]));
    expect(survivor?.dedupeFingerprint).toMatch(/^visual-hive:real-loop-demo:mutation_survivor:/);
    expect(survivor?.body).toContain("Visual Hive validates; Hive repairs");
    expect(JSON.stringify(result.report)).not.toMatch(/[A-Z]:\\|C:\/Users|\/Users\/|\/home\//);
  });

  it("marks repeated findings as update candidates and disappeared findings as resolved candidates", async () => {
    const rootDir = await tempRepo();
    await writeJson(path.join(rootDir, ".visual-hive", "coverage-recommendations.json"), {
      recommendations: [{ id: "gap", title: "Add route coverage", description: "Missing route coverage.", severity: "medium" }],
      maintenanceFindings: []
    });

    const first = await writeIssuesArtifacts({ rootDir, project: "lifecycle-demo" });
    const firstIssue = first.report.issues[0]!;
    expect(firstIssue.status).toBe("open_candidate");

    const second = await writeIssuesArtifacts({ rootDir, project: "lifecycle-demo" });
    expect(second.report.issues.find((issue) => issue.dedupeFingerprint === firstIssue.dedupeFingerprint)?.status).toBe("update_candidate");
    expect(second.report.issues[0]?.labels).toContain("visual-hive/still-active");

    await writeJson(path.join(rootDir, ".visual-hive", "coverage-recommendations.json"), {
      recommendations: [],
      maintenanceFindings: []
    });
    const resolved = await writeIssuesArtifacts({ rootDir, project: "lifecycle-demo" });
    expect(resolved.report.issues.find((issue) => issue.dedupeFingerprint === firstIssue.dedupeFingerprint)?.status).toBe("resolved_candidate");
    expect(resolved.report.issues[0]?.labels).toContain("visual-hive/resolved-candidate");
  });

  it("creates no live issue candidates for clean artifacts without seeded smoke", async () => {
    const rootDir = await tempRepo();
    await writeJson(path.join(rootDir, ".visual-hive", "report.json"), {
      schemaVersion: 2,
      project: "clean-loop-demo",
      status: "passed",
      results: []
    });
    await writeJson(path.join(rootDir, ".visual-hive", "mutation-report.json"), {
      schemaVersion: 2,
      project: "clean-loop-demo",
      score: 1,
      killed: 1,
      survived: 0,
      total: 1,
      results: [{ operator: "force-login-on-demo", status: "killed", killed: true, contractIds: ["hosted-demo-never-login"] }]
    });
    await writeJson(path.join(rootDir, ".visual-hive", "coverage-recommendations.json"), {
      recommendations: [],
      maintenanceFindings: []
    });

    const result = await writeIssuesArtifacts({ rootDir, project: "clean-loop-demo" });

    expect(result.report.summary.total).toBe(0);
    expect(result.markdown).not.toContain("seeded");
  });
});
