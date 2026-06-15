import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readJson, writeJson, type Plan, type Report } from "@visual-hive/core";
import { runDoctor } from "../src/commands/doctor.js";
import { runPlanCommand } from "../src/commands/plan.js";
import { formatMutationSummary, runMutateCommand } from "../src/commands/mutate.js";
import { runInit } from "../src/commands/init.js";

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("CLI commands", () => {
  it("doctor handles a valid demo config", async () => {
    const result = await runDoctor({ config: "examples/demo-react-app/visual-hive.config.yaml", cwd: process.cwd() });
    expect(result.ok).toBe(true);
  });

  it("plan writes plan.json for the demo config", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-cli-"));
    tempDirs.push(tempRoot);
    await runPlanCommand({
      config: path.join(process.cwd(), "examples/demo-react-app/visual-hive.config.yaml"),
      cwd: tempRoot,
      mode: "pr",
      changedFiles: path.join(process.cwd(), "examples/demo-react-app/changed-files.txt")
    });
    const planPath = path.join(process.cwd(), "examples/demo-react-app", ".visual-hive", "plan.json");
    const written = await readJson<Plan>(planPath);

    expect(written.items.map((item) => item.contractId)).toContain("dashboard-visual-stability");
    expect(written.excluded.map((item) => item.contractId)).toContain("live-cluster-protected-lane");
  });

  it("fails clearly when no contracts are selected", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-empty-plan-"));
    tempDirs.push(tempRoot);
    const configPath = path.join(tempRoot, "visual-hive.config.yaml");
    await writeFile(
      configPath,
      `project:
  name: empty-plan
targets:
  local:
    kind: url
    url: "http://127.0.0.1:4173"
    prSafe: true
contracts:
  - id: manual-only
    description: Not selected in PR mode
    target: local
    runOn:
      pullRequest: false
      schedule: false
`,
      "utf8"
    );

    await expect(runPlanCommand({ config: configPath, cwd: tempRoot, mode: "pr" })).rejects.toThrow(/No contracts selected/);
  });

  it("formats mutation summary output", () => {
    const summary = formatMutationSummary(
      {
        schemaVersion: 2,
        project: "sample",
        generatedAt: "2026-01-01T00:00:00.000Z",
        minScore: 0.7,
        score: 0.5,
        killed: 1,
        total: 2,
        results: [
          {
            operator: "hide-critical-button",
            status: "killed",
          killed: true,
          applicable: true,
          contractIds: ["dashboard"],
          expectedFailureKinds: ["missing_element"],
          durationMs: 10,
          errors: [],
          artifacts: []
        }
      ]
      },
      ".visual-hive/mutation-report.json"
    );

    expect(summary).toContain("Mutation score: 50% (1/2)");
    expect(summary).toContain("hide-critical-button: killed");
    expect(summary).toContain("(dashboard)");
  });

  it("init --force creates installable workflow and config files", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-init-"));
    tempDirs.push(tempRoot);
    await runInit({ cwd: tempRoot, force: true });

    await expect(access(path.join(tempRoot, "visual-hive.config.yaml"))).resolves.toBeUndefined();
    await expect(access(path.join(tempRoot, ".github", "workflows", "visual-hive-failure-issue.yml"))).resolves.toBeUndefined();
    await expect(access(path.join(tempRoot, ".visual-hive", "generated"))).resolves.toBeUndefined();
  });

  it("integration: plans demo config and verifies fake mutation score output", async () => {
    const demoRoot = path.join(process.cwd(), "examples/demo-react-app");
    const plan = await runPlanCommand({
      config: path.join(demoRoot, "visual-hive.config.yaml"),
      cwd: process.cwd(),
      mode: "pr",
      changedFiles: path.join(demoRoot, "changed-files.txt")
    });
    expect(plan.items.map((item) => item.contractId).sort()).toEqual(["dashboard-visual-stability", "hosted-demo-never-login"]);

    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-integration-"));
    tempDirs.push(tempRoot);
    const mutationPlan: Plan = {
      ...plan,
      mutation: {
        enabled: true,
        operators: ["hide-critical-button"],
        minScore: 0.7,
        reasons: ["integration test"]
      }
    };
    const planPath = path.join(tempRoot, "plan.json");
    await writeJson(planPath, mutationPlan);

    const result = await runMutateCommand({
      config: path.join(demoRoot, "visual-hive.config.yaml"),
      cwd: process.cwd(),
      plan: planPath,
      runner: async ({ mutationOperator }): Promise<{ report: Report; exitCode: number }> => ({
        exitCode: 1,
        report: {
          schemaVersion: 2,
          project: "demo-react-app",
          mode: "pr",
          generatedAt: "2026-01-01T00:00:00.000Z",
          status: "failed",
          changedFiles: ["src/App.tsx"],
          selectedTargets: [{ id: "localPreview", kind: "command", url: "http://127.0.0.1:4173", prSafe: true, cost: "cheap" }],
          selectedContracts: ["hosted-demo-never-login"],
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
          consoleErrors: [],
          pageErrors: [],
          artifacts: [],
          reproductionCommands: ["visual-hive run"],
          results: [
            {
              contractId: "hosted-demo-never-login",
              targetId: "localPreview",
              status: "failed",
              durationMs: 5,
              errors: [`Killed ${mutationOperator}`],
              artifacts: [],
              reproductionCommand: "visual-hive run --ci"
            }
          ]
        }
      })
    });

    const mutationReport = await readJson<typeof result.report>(result.reportPath);
    expect(mutationReport.score).toBe(1);
    expect(mutationReport.killed).toBe(1);
    expect(mutationReport.total).toBe(1);
  });

  it("enforces min score and records not-applicable mutations", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-not-applicable-"));
    tempDirs.push(tempRoot);
    const configPath = path.join(tempRoot, "visual-hive.config.yaml");
    await writeFile(
      configPath,
      `project:
  name: not-applicable
targets:
  local:
    kind: url
    url: "http://127.0.0.1:4173"
    prSafe: true
contracts:
  - id: home
    description: Home
    target: local
    runOn:
      pullRequest: true
    selectors:
      mustExist:
        - "main"
mutation:
  enabled: true
  minScore: 0.9
  operators:
    - remove-demo-badge
`,
      "utf8"
    );
    const plan: Plan = {
      schemaVersion: 1,
      project: "not-applicable",
      mode: "manual",
      generatedAt: "2026-01-01T00:00:00.000Z",
      changedFiles: [],
      targets: [{ id: "local", kind: "url", url: "http://127.0.0.1:4173", prSafe: true, cost: "medium" }],
      items: [
        {
          contractId: "home",
          targetId: "local",
          targetUrl: "http://127.0.0.1:4173",
          severity: "medium",
          cost: "medium",
          reasons: ["manual mode"],
          screenshots: []
        }
      ],
      excluded: [],
      mutation: { enabled: true, operators: ["remove-demo-badge"], minScore: 0.9, reasons: ["test"] }
    };
    const planPath = path.join(tempRoot, "plan.json");
    await writeJson(planPath, plan);

    const result = await runMutateCommand({ config: configPath, cwd: tempRoot, plan: planPath, enforceMinScore: true });

    expect(result.exitCode).toBe(1);
    expect(result.report.results[0]?.status).toBe("not_applicable");
    expect(result.report.total).toBe(0);
  });
});
