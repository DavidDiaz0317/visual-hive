import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { readJson, writeJson, type Plan, type Report } from "@visual-hive/core";
import { runDoctor } from "../src/commands/doctor.js";
import { runPlanCommand } from "../src/commands/plan.js";
import { formatMutationSummary, runMutateCommand } from "../src/commands/mutate.js";
import { runInit } from "../src/commands/init.js";
import { formatBaselineApproval, runBaselineApproveCommand, runBaselineListCommand } from "../src/commands/baselines.js";
import { runTriageCommand } from "../src/commands/triage.js";
import { formatProvidersMockSummary, formatProvidersSummary, runProvidersCommand, runProvidersMockCommand } from "../src/commands/providers.js";
import { formatCoverageSummary, runCoverageCommand } from "../src/commands/coverage.js";
import { formatContractsAudit, runContractsCommand } from "../src/commands/contracts.js";
import { formatTargetsAudit, runTargetsCommand } from "../src/commands/targets.js";
import { formatSchedulesAudit, runSchedulesCommand } from "../src/commands/schedules.js";
import { formatWorkflowsAudit, runWorkflowsCommand } from "../src/commands/workflows.js";
import { formatHistorySummary, runHistoryCommand } from "../src/commands/history.js";
import { formatArtifactsIndex, runArtifactsCommand } from "../src/commands/artifacts.js";
import { formatConnectionsIndex, runConnectionsAddCommand, runConnectionsListCommand, runConnectionsRemoveCommand } from "../src/commands/connections.js";
import { renderMarkdownReport } from "../src/commands/report.js";

const tempDirs: string[] = [];
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const sampleRepository = {
  provider: "local" as const,
  repository: "visual-hive/test",
  branch: "main",
  commitSha: "abcdef1234567890"
};

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("CLI commands", () => {
  it("doctor handles a valid demo config", async () => {
    const result = await runDoctor({ config: "examples/demo-react-app/visual-hive.config.yaml", cwd: repoRoot });
    expect(result.ok).toBe(true);
  });

  it("plan writes plan.json for the demo config", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-cli-"));
    tempDirs.push(tempRoot);
    await runPlanCommand({
      config: path.join(repoRoot, "examples/demo-react-app/visual-hive.config.yaml"),
      cwd: tempRoot,
      mode: "pr",
      changedFiles: path.join(repoRoot, "examples/demo-react-app/changed-files.txt")
    });
    const planPath = path.join(repoRoot, "examples/demo-react-app", ".visual-hive", "plan.json");
    const written = await readJson<Plan>(planPath);

    expect(written.items.map((item) => item.contractId)).toContain("dashboard-visual-stability");
    expect(written.excluded.map((item) => item.contractId)).toContain("live-cluster-protected-lane");
  });

  it("coverage writes coverage.json for the demo config", async () => {
    const demoRoot = path.join(repoRoot, "examples/demo-react-app");
    const result = await runCoverageCommand({
      config: path.join(demoRoot, "visual-hive.config.yaml"),
      cwd: repoRoot,
      mode: "pr",
      changedFiles: path.join(demoRoot, "changed-files.txt")
    });
    const written = await readJson<typeof result.report>(result.reportPath);
    const summary = formatCoverageSummary(written, result.reportPath);

    expect(written.schemaVersion).toBe(1);
    expect(written.summary.contractCount).toBeGreaterThan(0);
    expect(written.summary.selectedContracts).toBeGreaterThan(0);
    expect(written.routes.map((route) => route.route)).toContain("/");
    expect(summary).toContain("Coverage for demo-react-app");
  });

  it("coverage can run before a plan file exists", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-coverage-no-plan-"));
    tempDirs.push(tempRoot);
    await writeFile(
      path.join(tempRoot, "visual-hive.config.yaml"),
      `project:
  name: coverage-no-plan
targets:
  local:
    kind: url
    url: "http://127.0.0.1:4173"
    prSafe: true
contracts:
  - id: dashboard
    description: Dashboard
    target: local
    runOn:
      pullRequest: true
    screenshots:
      - name: dashboard
        route: "/"
        viewport: desktop
`,
      "utf8"
    );

    const result = await runCoverageCommand({ cwd: tempRoot, mode: "pr" });

    expect(result.report.summary.selectedContracts).toBe(1);
    await expect(access(path.join(tempRoot, ".visual-hive", "coverage.json"))).resolves.toBeUndefined();
  });

  it("contracts writes a contract audit artifact", async () => {
    const demoRoot = path.join(repoRoot, "examples/demo-react-app");
    const result = await runContractsCommand({
      config: path.join(demoRoot, "visual-hive.config.yaml"),
      cwd: repoRoot,
      mode: "pr",
      changedFiles: path.join(demoRoot, "changed-files.txt")
    });
    const written = await readJson<typeof result.audit>(result.auditPath);
    const summary = formatContractsAudit(written, result.auditPath);

    expect(written.schemaVersion).toBe(1);
    expect(written.summary.contractCount).toBeGreaterThan(0);
    expect(written.contracts.map((contract) => contract.id)).toContain("dashboard-visual-stability");
    expect(summary).toContain("Contract Audit: demo-react-app");
    await expect(access(path.join(demoRoot, ".visual-hive", "contracts.json"))).resolves.toBeUndefined();
  });

  it("targets writes a target audit artifact", async () => {
    const demoRoot = path.join(repoRoot, "examples/demo-react-app");
    const result = await runTargetsCommand({
      config: path.join(demoRoot, "visual-hive.config.yaml"),
      cwd: repoRoot,
      mode: "pr",
      changedFiles: path.join(demoRoot, "changed-files.txt")
    });
    const written = await readJson<typeof result.audit>(result.auditPath);
    const summary = formatTargetsAudit(written, result.auditPath);

    expect(written.schemaVersion).toBe(1);
    expect(written.summary.targetCount).toBeGreaterThan(0);
    expect(written.targets.map((target) => target.id)).toContain("localPreview");
    expect(summary).toContain("Target Audit: demo-react-app");
    await expect(access(path.join(demoRoot, ".visual-hive", "targets.json"))).resolves.toBeUndefined();
  });

  it("schedules writes a schedule audit artifact", async () => {
    const demoRoot = path.join(repoRoot, "examples/demo-react-app");
    const result = await runSchedulesCommand({
      config: path.join(demoRoot, "visual-hive.config.yaml"),
      cwd: repoRoot,
      changedFiles: path.join(demoRoot, "changed-files.txt")
    });
    const written = await readJson<typeof result.audit>(result.auditPath);
    const summary = formatSchedulesAudit(written, result.auditPath);

    expect(written.schemaVersion).toBe(1);
    expect(written.lanes.map((lane) => lane.id)).toContain("pull_request");
    expect(written.lanes.map((lane) => lane.id)).toContain("trusted_issue");
    expect(written.summary.contractCount).toBeGreaterThan(0);
    expect(summary).toContain("Schedule Audit: demo-react-app");
    await expect(access(path.join(demoRoot, ".visual-hive", "schedules.json"))).resolves.toBeUndefined();
  });

  it("workflows writes a workflow safety audit artifact", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-cli-workflows-"));
    tempDirs.push(tempRoot);
    await writeFile(
      path.join(tempRoot, "visual-hive.config.yaml"),
      `project:
  name: cli-workflows
targets:
  local:
    kind: url
    url: "http://127.0.0.1:4173"
contracts:
  - id: dashboard
    description: Dashboard
    target: local
`,
      "utf8"
    );
    await mkdir(path.join(tempRoot, ".github", "workflows"), { recursive: true });
    await writeFile(
      path.join(tempRoot, ".github", "workflows", "visual-hive-pr.yml"),
      `name: Visual Hive PR
on:
  pull_request:
permissions:
  contents: read
jobs:
  visual-hive:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npx visual-hive plan --mode pr --ci
      - run: npx visual-hive run --ci
      - run: npx visual-hive report --github-step-summary
      - uses: actions/upload-artifact@v4
        with:
          name: visual-hive
          path: .visual-hive
          include-hidden-files: true
`,
      "utf8"
    );

    const result = await runWorkflowsCommand({ cwd: tempRoot });
    const written = await readJson<typeof result.audit>(result.auditPath);
    const summary = formatWorkflowsAudit(written, result.auditPath);

    expect(written.summary.pullRequestWorkflows).toBe(1);
    expect(written.summary.criticalFindings).toBe(0);
    expect(summary).toContain("Workflow Safety Audit: cli-workflows");
    await expect(access(path.join(tempRoot, ".visual-hive", "workflows.json"))).resolves.toBeUndefined();
  });

  it("history records the latest report and mutation artifacts", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-cli-history-"));
    tempDirs.push(tempRoot);
    await writeFile(
      path.join(tempRoot, "visual-hive.config.yaml"),
      `project:
  name: cli-history
targets:
  local:
    kind: url
    url: "http://127.0.0.1:4173"
contracts:
  - id: dashboard
    description: Dashboard
    target: local
`,
      "utf8"
    );
    await writeJson(path.join(tempRoot, ".visual-hive", "report.json"), {
      schemaVersion: 2,
      project: "cli-history",
      repository: sampleRepository,
      mode: "pr",
      generatedAt: "2026-06-15T00:00:00.000Z",
      status: "passed",
      changedFiles: ["src/App.tsx"],
      selectedTargets: [{ id: "local", kind: "url", url: "http://127.0.0.1:4173", prSafe: true, cost: "medium" }],
      selectedContracts: ["dashboard"],
      excludedContracts: [],
      targetLifecycle: [],
      generatedSpecPath: ".visual-hive/generated/visual-hive.generated.spec.ts",
      results: [],
      summary: {
        passed: 1,
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
      consoleErrors: [],
      pageErrors: [],
      artifacts: [],
      reproductionCommands: []
    });
    await writeJson(path.join(tempRoot, ".visual-hive", "mutation-report.json"), {
      schemaVersion: 2,
      project: "cli-history",
      generatedAt: "2026-06-15T00:01:00.000Z",
      minScore: 0.7,
      score: 1,
      killed: 1,
      total: 1,
      results: []
    });

    const result = await runHistoryCommand({ cwd: tempRoot, record: true, maxEntries: 5 });
    const written = await readJson<typeof result.history>(result.historyPath);
    const summary = formatHistorySummary(written, result.historyPath, "markdown", result.recorded);

    expect(written.summary.runCount).toBe(1);
    expect(written.entries[0]?.files.report).toContain(".visual-hive/history/");
    expect(summary).toContain("Run History: cli-history");
    await expect(access(path.join(tempRoot, ".visual-hive", "history.json"))).resolves.toBeUndefined();
  });

  it("artifacts indexes .visual-hive files with sanitized previews", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-cli-artifacts-"));
    tempDirs.push(tempRoot);
    await writeFile(
      path.join(tempRoot, "visual-hive.config.yaml"),
      `project:
  name: cli-artifacts
targets:
  local:
    kind: url
    url: "http://127.0.0.1:4173"
contracts:
  - id: dashboard
    description: Dashboard
    target: local
`,
      "utf8"
    );
    await writeFile(path.join(tempRoot, ".visual-hive", "logs", "run.log"), "cookie=session-secret", "utf8").catch(async () => {
      await mkdir(path.join(tempRoot, ".visual-hive", "logs"), { recursive: true });
      await writeFile(path.join(tempRoot, ".visual-hive", "logs", "run.log"), "cookie=session-secret", "utf8");
    });

    const result = await runArtifactsCommand({ cwd: tempRoot });
    const written = await readJson<typeof result.index>(result.indexPath);
    const summary = formatArtifactsIndex(written, result.indexPath);

    expect(written.summary.artifactCount).toBeGreaterThanOrEqual(1);
    expect(written.artifacts[0]?.preview).toContain("[REDACTED]");
    expect(summary).toContain("Artifact Index: cli-artifacts");
    await expect(access(path.join(tempRoot, ".visual-hive", "artifacts-index.json"))).resolves.toBeUndefined();
  });

  it("connections adds, lists, and removes local repos", async () => {
    const managerRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-cli-connections-manager-"));
    const connectedRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-cli-connections-target-"));
    tempDirs.push(managerRoot, connectedRoot);
    await writeFile(
      path.join(managerRoot, "visual-hive.config.yaml"),
      `project:
  name: manager
targets:
  local:
    kind: url
    url: "http://127.0.0.1:4173"
contracts:
  - id: dashboard
    description: Dashboard
    target: local
`,
      "utf8"
    );
    await writeFile(
      path.join(connectedRoot, "visual-hive.config.yaml"),
      `project:
  name: connected
targets:
  local:
    kind: url
    url: "http://127.0.0.1:4173"
contracts:
  - id: dashboard
    description: Dashboard
    target: local
`,
      "utf8"
    );

    const added = await runConnectionsAddCommand({ cwd: managerRoot, repo: connectedRoot, id: "connected", label: "Connected Repo", tags: ["dogfood"] });
    const stored = await readJson<{ schemaVersion: 1; connections: Array<{ id: string; tags: string[] }> }>(added.indexPath);
    const addedSummary = formatConnectionsIndex(added.index, added.indexPath);

    expect(added.index.connections.find((connection) => connection.id === "connected")).toMatchObject({
      status: "ready",
      projectName: "connected",
      tags: ["dogfood"]
    });
    expect(stored.connections.find((connection) => connection.id === "connected")).toMatchObject({ tags: ["dogfood"] });
    expect(addedSummary).toContain("Visual Hive Connections");

    const listed = await runConnectionsListCommand({ cwd: managerRoot });
    expect(listed.index.connections.map((connection) => connection.id)).toContain("connected");

    const removed = await runConnectionsRemoveCommand({ cwd: managerRoot, id: "connected" });
    expect(removed.index.connections.map((connection) => connection.id)).not.toContain("connected");
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
    const prWorkflow = await readFile(path.join(tempRoot, ".github", "workflows", "visual-hive-pr.yml"), "utf8");
    const scheduledWorkflow = await readFile(path.join(tempRoot, ".github", "workflows", "visual-hive-scheduled.yml"), "utf8");
    expect(prWorkflow).toContain("include-hidden-files: true");
    expect(prWorkflow).toContain("npx visual-hive workflows");
    expect(prWorkflow.indexOf("npx visual-hive workflows")).toBeLessThan(prWorkflow.indexOf("npx visual-hive triage"));
    expect(scheduledWorkflow).toContain("include-hidden-files: true");
    expect(scheduledWorkflow).toContain("npx visual-hive workflows");
    expect(scheduledWorkflow.indexOf("npx visual-hive workflows")).toBeLessThan(scheduledWorkflow.indexOf("npx visual-hive triage"));
  });

  it("lists and approves baselines from the CLI command helpers", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-cli-baseline-"));
    tempDirs.push(tempRoot);
    await writeFile(
      path.join(tempRoot, "visual-hive.config.yaml"),
      `project:
  name: cli-baseline
targets:
  local:
    kind: url
    url: "http://127.0.0.1:4173"
contracts:
  - id: dashboard
    description: Dashboard
    target: local
`,
      "utf8"
    );
    const actualPath = path.join(tempRoot, ".visual-hive", "artifacts", "screenshots", "dashboard.png");
    const baselinePath = path.join(tempRoot, ".visual-hive", "snapshots", "dashboard.png");
    await mkdir(path.dirname(actualPath), { recursive: true });
    await mkdir(path.dirname(baselinePath), { recursive: true });
    await writeFile(actualPath, "actual", "utf8");
    await writeFile(baselinePath, "old", "utf8");
    await writeJson(path.join(tempRoot, ".visual-hive", "report.json"), {
      schemaVersion: 2,
      project: "cli-baseline",
      repository: sampleRepository,
      mode: "manual",
      generatedAt: "2026-06-15T00:00:00.000Z",
      status: "failed",
      changedFiles: [],
      selectedTargets: [{ id: "local", kind: "url", url: "http://127.0.0.1:4173", prSafe: true, cost: "medium" }],
      selectedContracts: ["dashboard"],
      excludedContracts: [],
      targetLifecycle: [],
      generatedSpecPath: ".visual-hive/generated/visual-hive.generated.spec.ts",
      results: [
        {
          contractId: "dashboard",
          targetId: "local",
          status: "failed",
          durationMs: 1,
          errors: ["visual diff"],
          artifacts: [actualPath],
          screenshotAssertions: [
            {
              contractId: "dashboard",
              screenshotName: "desktop",
              name: "desktop",
              route: "/",
              viewport: "desktop",
              status: "failed",
              baselinePath,
              actualPath,
              maxDiffPixelRatio: 0.01,
              actualDiffPixelRatio: 0.2,
              actualDiffPixels: 2,
              diffPixels: 2,
              totalPixels: 10
            }
          ],
          consoleErrors: [],
          pageErrors: [],
          networkErrors: [],
          reproductionCommand: "visual-hive run --ci"
        }
      ],
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
      artifacts: [actualPath],
      reproductionCommands: ["visual-hive run --ci"]
    });

    const list = await runBaselineListCommand({ cwd: tempRoot });
    expect(list.entries[0]?.contractId).toBe("dashboard");

    const approval = await runBaselineApproveCommand({ cwd: tempRoot, contractId: "dashboard", screenshotName: "desktop" });
    expect(formatBaselineApproval(approval)).toContain("Approved baseline dashboard/desktop");
    await expect(readFile(baselinePath, "utf8")).resolves.toBe("actual");
  });

  it("triage writes issue, triage prompt, repair prompt, and missing-test artifacts", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-cli-triage-"));
    tempDirs.push(tempRoot);
    await writeFile(
      path.join(tempRoot, "visual-hive.config.yaml"),
      `project:
  name: cli-triage
targets:
  local:
    kind: url
    url: "http://127.0.0.1:4173"
contracts:
  - id: dashboard
    description: Dashboard
    target: local
`,
      "utf8"
    );
    await writeJson(path.join(tempRoot, ".visual-hive", "report.json"), {
      schemaVersion: 2,
      project: "cli-triage",
      repository: sampleRepository,
      mode: "pr",
      generatedAt: "2026-06-15T00:00:00.000Z",
      status: "failed",
      changedFiles: ["src/App.tsx"],
      selectedTargets: [{ id: "local", kind: "url", url: "http://127.0.0.1:4173", prSafe: true, cost: "medium" }],
      selectedContracts: ["dashboard"],
      excludedContracts: [],
      targetLifecycle: [],
      generatedSpecPath: ".visual-hive/generated/visual-hive.generated.spec.ts",
      results: [
        {
          contractId: "dashboard",
          targetId: "local",
          status: "failed",
          durationMs: 1,
          errors: ["Expected selector to exist"],
          artifacts: [],
          consoleErrors: [],
          pageErrors: [],
          networkErrors: [],
          reproductionCommand: "visual-hive run --ci"
        }
      ],
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
      reproductionCommands: ["visual-hive run --ci"]
    });
    await writeJson(path.join(tempRoot, ".visual-hive", "mutation-report.json"), {
      schemaVersion: 2,
      project: "cli-triage",
      generatedAt: "2026-06-15T00:00:00.000Z",
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
          expectedFailureKinds: ["api_contract_regression"],
          durationMs: 1,
          errors: []
        }
      ]
    });
    await writeJson(path.join(tempRoot, ".visual-hive", "coverage.json"), {
      schemaVersion: 1,
      project: "cli-triage",
      generatedAt: "2026-06-15T00:00:00.000Z",
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
    });
    await writeJson(path.join(tempRoot, ".visual-hive", "workflows.json"), {
      schemaVersion: 1,
      project: "cli-triage",
      generatedAt: "2026-06-15T00:00:00.000Z",
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
          workflowPath: ".github/workflows/visual-hive-pr.yml",
          kind: "pr_secrets",
          severity: "high",
          message: "PR workflow references secrets.token=secret-value",
          evidence: "secrets"
        }
      ],
      recommendations: ["Keep PR workflows read-only and secret-free."]
    });

    const result = await runTriageCommand({ cwd: tempRoot });

    await expect(readFile(result.promptPath, "utf8")).resolves.toContain("Visual failure triage");
    await expect(readFile(result.promptPath, "utf8")).resolves.toContain("Coverage report JSON");
    await expect(readFile(result.repairPromptPath, "utf8")).resolves.toContain("Repair prompt");
    await expect(readFile(result.missingTestsPath, "utf8")).resolves.toContain("Mutation survived: api-500");
    await expect(readFile(result.missingTestsPath, "utf8")).resolves.toContain("changed_file_without_rule");
    await expect(readFile(result.prCommentPath, "utf8")).resolves.toContain("## Visual Hive report");
    await expect(readFile(result.prCommentPath, "utf8")).resolves.toContain("Workflow safety findings: 1");
    const issue = await readFile(result.issuePath, "utf8");
    expect(issue).toContain("dashboard");
    expect(issue).toContain("Workflow safety");
    expect(issue).toContain("high/pr_secrets");
    expect(issue).not.toContain("secret-value");
    const llmUsage = await readJson<{ summary: { callsMade: number; promptOnly: boolean }; records: Array<{ task: string }> }>(result.llmUsagePath);
    expect(llmUsage.summary).toMatchObject({ callsMade: 0, promptOnly: true });
    expect(llmUsage.records.map((record) => record.task)).toContain("repair_prompt");
  });

  it("inspects providers without printing secret values", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-cli-providers-"));
    tempDirs.push(tempRoot);
    await writeFile(
      path.join(tempRoot, "visual-hive.config.yaml"),
      `project:
  name: providers
targets:
  local:
    kind: url
    url: "http://127.0.0.1:4173"
contracts:
  - id: dashboard
    description: Dashboard
    target: local
providers:
  argos:
    enabled: true
  percy:
    enabled: true
    mode: mock
`,
      "utf8"
    );

    const providers = await runProvidersCommand({ cwd: tempRoot });
    const summary = formatProvidersSummary(providers);

    expect(summary).toContain("Argos");
    expect(summary).toContain("missing_credentials");
    expect(summary).toContain("ARGOS_TOKEN");
    expect(summary).toContain("Mock mode");
    expect(summary).not.toContain("secret");
  });

  it("writes provider mock results from the latest deterministic report", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-cli-provider-results-"));
    tempDirs.push(tempRoot);
    await writeFile(
      path.join(tempRoot, "visual-hive.config.yaml"),
      `project:
  name: provider-results
targets:
  local:
    kind: url
    url: "http://127.0.0.1:4173"
contracts:
  - id: dashboard
    description: Dashboard
    target: local
providers:
  storybook:
    enabled: true
    mode: mock
`,
      "utf8"
    );
    await writeJson(path.join(tempRoot, ".visual-hive", "report.json"), {
      schemaVersion: 2,
      project: "provider-results",
      repository: sampleRepository,
      mode: "pr",
      generatedAt: "2026-06-15T00:00:00.000Z",
      status: "passed",
      changedFiles: [],
      selectedTargets: [{ id: "local", kind: "url", url: "http://127.0.0.1:4173", prSafe: true, cost: "medium" }],
      selectedContracts: ["dashboard"],
      excludedContracts: [],
      targetLifecycle: [],
      generatedSpecPath: path.join(tempRoot, ".visual-hive", "generated", "visual-hive.generated.spec.ts"),
      results: [
        {
          contractId: "dashboard",
          targetId: "local",
          status: "passed",
          durationMs: 1,
          errors: [],
          artifacts: [path.join(tempRoot, ".visual-hive", "artifacts", "screenshots", "dashboard.png")],
          consoleErrors: [],
          pageErrors: [],
          networkErrors: [],
          reproductionCommand: "visual-hive run --ci"
        }
      ],
      summary: {
        passed: 1,
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
      consoleErrors: [],
      pageErrors: [],
      artifacts: [path.join(tempRoot, ".visual-hive", "report.json")],
      reproductionCommands: ["visual-hive run --ci"]
    });

    const result = await runProvidersMockCommand({ cwd: tempRoot });
    const written = await readJson<typeof result.report>(result.reportPath);
    const summary = formatProvidersMockSummary(written, result.reportPath);

    expect(written.schemaVersion).toBe(1);
    expect(written.providers.find((provider) => provider.providerId === "storybook")?.result.status).toBe("mock");
    expect(written.providers.find((provider) => provider.providerId === "storybook")?.normalized.storybook?.recommendedCommand).toBe(
      "npm run storybook -- --ci"
    );
    expect(written.providers.find((provider) => provider.providerId === "storybook")?.operations.map((operation) => operation.operation)).toContain(
      "upload_artifact"
    );
    expect(summary).toContain("Provider Adapter Mock Results: provider-results");
    expect(summary).toContain("| Storybook | mock | mock | mock | mock |");
    await expect(access(path.join(tempRoot, ".visual-hive", "provider-results.json"))).resolves.toBeUndefined();
  });

  it("renders provider results in markdown reports", () => {
    const output = renderMarkdownReport({
      schemaVersion: 2,
      project: "provider-report",
      repository: sampleRepository,
      mode: "pr",
      generatedAt: "2026-06-15T00:00:00.000Z",
      status: "passed",
      changedFiles: [],
      selectedTargets: [],
      selectedContracts: [],
      excludedContracts: [],
      targetLifecycle: [],
      generatedSpecPath: ".visual-hive/generated/visual-hive.generated.spec.ts",
      results: [],
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
      consoleErrors: [],
      pageErrors: [],
      artifacts: [],
      providerResults: [
        {
          providerId: "playwright",
          label: "Playwright built-in",
          status: "passed",
          deterministicRole: "oracle",
          message: "Built-in Playwright deterministic run passed.",
          requiredEnv: [],
          missingEnv: [],
          artifactCount: 1,
          normalizedAt: "2026-06-15T00:00:00.000Z"
        }
      ],
      reproductionCommands: []
    });

    expect(output).toContain("Providers: Playwright built-in=passed");
    expect(output).toContain("### Provider Results");
  });

  it("integration: plans demo config and verifies fake mutation score output", async () => {
    const demoRoot = path.join(repoRoot, "examples/demo-react-app");
    const plan = await runPlanCommand({
      config: path.join(demoRoot, "visual-hive.config.yaml"),
      cwd: repoRoot,
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
      cwd: repoRoot,
      plan: planPath,
      runner: async ({ mutationOperator }): Promise<{ report: Report; exitCode: number }> => ({
        exitCode: 1,
        report: {
          schemaVersion: 2,
          project: "demo-react-app",
          repository: sampleRepository,
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
