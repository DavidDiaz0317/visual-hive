import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runIssuePublishCommand, runIssuesCommand, runSetupIssuePublishCommand } from "../src/commands/issues.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Hive-managed CLI lifecycle", () => {
  it("keeps full issue evidence but suppresses the standalone publisher", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "visual-hive-cli-hive-managed-"));
    roots.push(root);
    const configPath = path.join(root, "visual-hive.config.yaml");
    await writeFile(configPath, config(), "utf8");
    await mkdir(path.join(root, ".visual-hive"), { recursive: true });
    await writeFile(path.join(root, ".visual-hive", "report.json"), `${JSON.stringify(failedReport(), null, 2)}\n`, "utf8");

    const issues = await runIssuesCommand({ config: configPath, cwd: root, write: true });
    expect(issues.report.lifecycle).toMatchObject({ owner: "hive", standaloneIssueWrites: "suppressed" });
    expect(issues.report.issues.length).toBeGreaterThan(0);
    expect(issues.report.issues.every((issue) => issue.dedupeFingerprint && issue.validationCommand)).toBe(true);

    const publish = await runIssuePublishCommand({ config: configPath, cwd: root, mode: "live", live: true });
    expect(publish.plan.lifecycle).toEqual(issues.report.lifecycle);
    expect(publish.result.status).toBe("managed_by_hive");
    expect(publish.result.externalCallsMade).toBe(0);
    expect(publish.result.networkCallsMade).toBe(0);
    expect(publish.result.realGithubIssuesCreated).toBe(0);
    expect(publish.result.realGithubIssuesUpdated).toBe(0);
    expect(publish.result.blockedReasons.join(" ")).toContain("managed_by_hive");

    const setupPublish = await runSetupIssuePublishCommand({ config: configPath, cwd: root, mode: "live", live: true });
    expect(setupPublish.plan.lifecycle).toMatchObject({ owner: "hive", standaloneIssueWrites: "suppressed" });
    expect(setupPublish.result.status).toBe("managed_by_hive");
    expect(setupPublish.result.networkCallsMade).toBe(0);
  });

  it("uses the durable Hive installation marker even when branch config tries to disable integration", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "visual-hive-cli-hive-marker-"));
    roots.push(root);
    const configPath = path.join(root, "visual-hive.config.yaml");
    await writeFile(configPath, config(false), "utf8");
    await mkdir(path.join(root, ".hive"), { recursive: true });
    await writeFile(
      path.join(root, ".hive", "integrated.json"),
      `${JSON.stringify({ repository: "example/hive-managed-cli", visual_hive: true })}\n`,
      "utf8"
    );
    await mkdir(path.join(root, ".visual-hive"), { recursive: true });
    await writeFile(path.join(root, ".visual-hive", "report.json"), `${JSON.stringify(failedReport(), null, 2)}\n`, "utf8");

    const issues = await runIssuesCommand({ config: configPath, cwd: root, write: true });
    expect(issues.report.lifecycle).toMatchObject({ owner: "hive", standaloneIssueWrites: "suppressed" });
    const publish = await runIssuePublishCommand({ config: configPath, cwd: root, mode: "live", live: true });
    expect(publish.result.status).toBe("managed_by_hive");
    expect(publish.result.networkCallsMade).toBe(0);
  });

  it("fails closed for every present Hive marker that does not affirm Hive ownership", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "visual-hive-cli-malformed-hive-marker-"));
    roots.push(root);
    const configPath = path.join(root, "visual-hive.config.yaml");
    await writeFile(configPath, config(false), "utf8");
    await mkdir(path.join(root, ".hive"), { recursive: true });
    await writeFile(
      path.join(root, ".hive", "integrated.json"),
      `${JSON.stringify({ repository: "example/hive-managed-cli" })}\n`,
      "utf8"
    );
    await mkdir(path.join(root, ".visual-hive"), { recursive: true });
    await writeFile(path.join(root, ".visual-hive", "report.json"), `${JSON.stringify(failedReport(), null, 2)}\n`, "utf8");

    await runIssuesCommand({ config: configPath, cwd: root, write: true });
    const publish = await runIssuePublishCommand({ config: configPath, cwd: root, mode: "live", live: true });
    expect(publish.result.status).toBe("managed_by_hive");
    expect(publish.result.networkCallsMade).toBe(0);

    for (const marker of [
      { repository: "example/hive-managed-cli", visual_hive: "true" },
      { repository: "example/hive-managed-cli", visual_hive: false }
    ]) {
      await writeFile(path.join(root, ".hive", "integrated.json"), `${JSON.stringify(marker)}\n`, "utf8");
      const retry = await runIssuePublishCommand({ config: configPath, cwd: root, mode: "live", live: true });
      expect(retry.result.status).toBe("managed_by_hive");
      expect(retry.result.networkCallsMade).toBe(0);
    }
  });
});

function config(hiveEnabled = true): string {
  return `project:
  name: hive-managed-cli
  type: react-vite
targets:
  local:
    kind: url
    url: http://127.0.0.1:4173
    prSafe: true
contracts:
  - id: dashboard
    description: Dashboard renders
    target: local
    severity: high
    runOn:
      pullRequest: true
    selectors:
      mustExist:
        - main
viewports:
  desktop:
    width: 1280
    height: 720
integrations:
  hive:
    enabled: ${hiveEnabled}
    mode: ${hiveEnabled ? "full" : "advisory"}
`;
}

function failedReport(): object {
  return {
    schemaVersion: 2,
    project: "hive-managed-cli",
    repository: { provider: "local", repository: "example/hive-managed-cli", branch: "main" },
    mode: "pr",
    generatedAt: "2026-07-14T12:00:00.000Z",
    status: "failed",
    changedFiles: ["src/App.tsx"],
    selectedTargets: [{ id: "local", kind: "url", url: "http://127.0.0.1:4173", prSafe: true, cost: "cheap" }],
    selectedContracts: ["dashboard"],
    excludedContracts: [],
    targetLifecycle: [],
    generatedSpecPath: ".visual-hive/generated/visual-hive.generated.spec.ts",
    results: [{
      contractId: "dashboard",
      targetId: "local",
      status: "failed",
      durationMs: 5,
      errors: ["Dashboard element missing"],
      artifacts: [".visual-hive/report.json"],
      selectorAssertions: [{ kind: "mustExist", value: "main", status: "failed", message: "main was missing" }],
      consoleErrors: [],
      pageErrors: [],
      networkErrors: [],
      reproductionCommand: "visual-hive run --ci"
    }],
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
    consoleErrors: [],
    pageErrors: [],
    artifacts: [".visual-hive/report.json"],
    reproductionCommands: ["visual-hive run --ci"]
  };
}
