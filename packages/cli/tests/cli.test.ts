import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { readJson, writeJson, type Plan, type Report } from "@visual-hive/core";
import { runDoctor } from "../src/commands/doctor.js";
import { formatPlanSummary, parsePlanMode, runPlanCommand } from "../src/commands/plan.js";
import { runPipelineCommand } from "../src/commands/pipeline.js";
import { formatPlansSummary, runPlansCommand } from "../src/commands/plans.js";
import { runDeterministicCommand } from "../src/commands/run.js";
import { formatMutationSummary, runMutateCommand } from "../src/commands/mutate.js";
import { runInit } from "../src/commands/init.js";
import {
  formatBaselineApproval,
  formatBaselineList,
  formatBaselineRejection,
  runBaselineApproveCommand,
  runBaselineListCommand,
  runBaselineRejectCommand
} from "../src/commands/baselines.js";
import { runTriageCommand } from "../src/commands/triage.js";
import {
  formatProviderDecision,
  formatProviderHandoff,
  formatProviderSetupPlan,
  formatProviderUpload,
  formatProvidersMockSummary,
  formatProvidersSummary,
  runProviderDecisionCommand,
  runProviderHandoffCommand,
  runProviderSetupPlanCommand,
  runProviderUploadCommand,
  runProvidersCommand,
  runProvidersMockCommand
} from "../src/commands/providers.js";
import { formatCoverageSummary, runCoverageCommand } from "../src/commands/coverage.js";
import { formatCoverageImprovementReport, runImproveCoverageCommand } from "../src/commands/improve.js";
import { formatContractsAudit, runContractsCommand } from "../src/commands/contracts.js";
import { formatFlowsAudit, runFlowsCommand } from "../src/commands/flows.js";
import { formatTargetsAudit, runTargetsCommand } from "../src/commands/targets.js";
import { formatSchedulesAudit, runSchedulesCommand } from "../src/commands/schedules.js";
import { formatWorkflowTemplateWrite, formatWorkflowsAudit, runWorkflowTemplatesWriteCommand, runWorkflowsCommand } from "../src/commands/workflows.js";
import { formatHistorySummary, runHistoryCommand } from "../src/commands/history.js";
import { formatArtifactsIndex, runArtifactsCommand } from "../src/commands/artifacts.js";
import { runEvidenceCommand } from "../src/commands/evidence.js";
import { formatLayersReport, runLayersCommand } from "../src/commands/layers.js";
import { formatVerdictReport, runVerdictCommand } from "../src/commands/verdict.js";
import { formatHandoffResult, runHandoffCommand } from "../src/commands/handoff.js";
import { formatTestCreationPlan, runTestCreationPlanCommand } from "../src/commands/testCreationPlan.js";
import { formatAgentPacketResult, runAgentPacketCommand } from "../src/commands/agentPacket.js";
import { formatToolsRegistry, runToolsCommand } from "../src/commands/tools.js";
import { formatContextLedger, runContextCommand } from "../src/commands/context.js";
import { formatLLMDecision, formatLLMUsage, runLLMCommand, runLLMDecisionCommand } from "../src/commands/llm.js";
import { formatRiskRegister, runRiskCommand } from "../src/commands/risk.js";
import { formatReadinessReport, runReadinessCommand } from "../src/commands/readiness.js";
import { formatSetupProgress, runSetupStatusCommand } from "../src/commands/setupStatus.js";
import { formatRunbookReport, runRunbookCommand } from "../src/commands/runbook.js";
import { formatSecurityAudit, runSecurityCommand } from "../src/commands/security.js";
import { formatCostsReport, runCostsCommand } from "../src/commands/costs.js";
import { formatAnalyzeSummary, runAnalyzeCommand } from "../src/commands/analyze.js";
import { formatSetupRecommendation, runRecommendCommand } from "../src/commands/recommend.js";
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

function runDemoSuiteDryRun(suite: "all" | "ci"): string {
  const result = spawnSync(process.execPath, [path.join(repoRoot, "scripts", "run-demo-suite.mjs"), "--dry-run", suite], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 30_000,
    windowsHide: true
  });
  if (result.status !== 0) {
    throw new Error(`demo suite dry-run failed for ${suite}\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
}

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("CLI commands", () => {
  it("validates plan modes clearly", () => {
    expect(parsePlanMode("canary")).toBe("canary");
    expect(parsePlanMode("mutation")).toBe("mutation");
    expect(parsePlanMode("full")).toBe("full");
    expect(() => parsePlanMode("unknown")).toThrow(/Invalid plan mode/);
  });

  it("doctor handles a valid demo config", async () => {
    const result = await runDoctor({ config: "examples/demo-react-app/visual-hive.config.yaml", cwd: repoRoot });
    expect(result.ok).toBe(true);
  });

  it("doctor reports deploy preview URL env readiness without printing secret values", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-cli-preview-"));
    tempDirs.push(tempRoot);
    await writeFile(
      path.join(tempRoot, "visual-hive.config.yaml"),
      `project:
  name: deploy-preview-doctor
targets:
  preview:
    kind: deployPreview
    provider: vercel
    urlEnv: VISUAL_HIVE_TEST_PREVIEW_URL
contracts:
  - id: preview
    description: Preview
    target: preview
    runOn:
      pullRequest: true
`,
      "utf8"
    );

    const previous = process.env.VISUAL_HIVE_TEST_PREVIEW_URL;
    process.env.VISUAL_HIVE_TEST_PREVIEW_URL = "secret-preview-host.example.com";
    try {
      const result = await runDoctor({ cwd: tempRoot });
      const serialized = JSON.stringify(result.diagnostics);

      expect(result.ok).toBe(true);
      expect(serialized).toContain("target:preview:deploy-preview");
      expect(serialized).toContain("VISUAL_HIVE_TEST_PREVIEW_URL");
      expect(serialized).not.toContain("secret-preview-host");
    } finally {
      if (previous === undefined) {
        delete process.env.VISUAL_HIVE_TEST_PREVIEW_URL;
      } else {
        process.env.VISUAL_HIVE_TEST_PREVIEW_URL = previous;
      }
    }
  });

  it("doctor reports storybook target scope and local serve posture", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-cli-storybook-"));
    tempDirs.push(tempRoot);
    await writeFile(
      path.join(tempRoot, "visual-hive.config.yaml"),
      `project:
  name: storybook-doctor
  setupProfile: component-storybook
targets:
  componentLibrary:
    kind: storybook
    install: "npm ci"
    build: "npm run build-storybook"
    serve: "npm run storybook -- --host 127.0.0.1 --port 6006"
    url: "http://127.0.0.1:6006"
    stories:
      - "src/**/*.stories.tsx"
    components:
      - "src/components/**"
contracts:
  - id: component-library-smoke
    description: Component library smoke
    target: componentLibrary
    runOn:
      pullRequest: true
`,
      "utf8"
    );

    const result = await runDoctor({ cwd: tempRoot });
    const serialized = JSON.stringify(result.diagnostics);

    expect(result.ok).toBe(true);
    expect(serialized).toContain("target:componentLibrary:storybook");
    expect(serialized).toContain("stories=1");
    expect(serialized).toContain("components=1");
    expect(serialized).toContain("serve=configured");
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
    expect(written.providerPolicy.find((provider) => provider.providerId === "playwright")).toMatchObject({
      availability: "available",
      externalCallsPlanned: 0
    });
    expect(formatPlanSummary(written)).toContain("Provider policy: Playwright built-in=available/local/calls=0");
  });

  it("plan can write a sidecar output artifact without clobbering the default plan", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-cli-plan-output-"));
    tempDirs.push(tempRoot);
    await writeFile(
      path.join(tempRoot, "visual-hive.config.yaml"),
      `project:
  name: plan-output
  type: static
  defaultBranch: main
targets:
  app:
    kind: url
    url: "http://127.0.0.1:4173"
    prSafe: true
contracts:
  - id: shell
    description: Shell renders
    target: app
    severity: high
    runOn:
      pullRequest: true
    selectors:
      mustExist:
        - "body"
viewports:
  desktop:
    width: 1280
    height: 720
`,
      "utf8"
    );

    const plan = await runPlanCommand({ cwd: tempRoot, mode: "pr", output: ".visual-hive/plan.canary.json" });
    const sidecarPath = path.join(tempRoot, ".visual-hive", "plan.canary.json");

    await expect(access(sidecarPath)).resolves.toBeUndefined();
    await expect(access(path.join(tempRoot, ".visual-hive", "plan.json"))).rejects.toThrow();
    expect((await readJson<Plan>(sidecarPath)).items.map((item) => item.contractId)).toEqual(["shell"]);
    expect(plan.items.map((item) => item.contractId)).toEqual(["shell"]);
  });

  it("plans summarizes default and sidecar plan artifacts", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-cli-plans-"));
    tempDirs.push(tempRoot);
    await writeFile(
      path.join(tempRoot, "visual-hive.config.yaml"),
      `project:
  name: plans-fixture
  type: static
  defaultBranch: main
targets:
  app:
    kind: url
    url: "http://127.0.0.1:4173"
    prSafe: true
    schedule: "*/15 * * * *"
contracts:
  - id: shell
    description: Shell renders
    target: app
    severity: high
    runOn:
      pullRequest: true
      schedule: true
    selectors:
      mustExist:
        - "body"
viewports:
  desktop:
    width: 1280
    height: 720
mutation:
  enabled: true
  operators:
    - broken-image
`,
      "utf8"
    );
    await runPlanCommand({ cwd: tempRoot, mode: "pr" });
    await runPlanCommand({ cwd: tempRoot, mode: "canary", output: ".visual-hive/plan.canary.json" });
    await runPlanCommand({ cwd: tempRoot, mode: "full", output: ".visual-hive/plan.full.json" });

    const result = await runPlansCommand({ cwd: tempRoot });
    const written = await readJson<typeof result.report>(result.reportPath);
    const summary = formatPlansSummary(result.report, result.reportPath);

    expect(result.reportPath).toBe(path.join(tempRoot, ".visual-hive", "plans.json"));
    expect(written.planCount).toBe(3);
    expect(written.summary.modes).toEqual(["canary", "full", "pr"]);
    expect(written.lanes.map((lane) => lane.path)).toEqual(
      expect.arrayContaining([".visual-hive/plan.json", ".visual-hive/plan.canary.json", ".visual-hive/plan.full.json"])
    );
    expect(summary).toContain("Plan Lanes: plans-fixture");
    expect(summary).toContain("| .visual-hive/plan.canary.json | canary |");
  });

  it("demo acceptance scripts exercise management-plane artifacts", async () => {
    const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const demoAllOutput = runDemoSuiteDryRun("all");
    const demoCiOutput = runDemoSuiteDryRun("ci");
    expect(packageJson.scripts["demo:all"]).toBe("node scripts/run-demo-suite.mjs all");
    expect(packageJson.scripts["demo:ci"]).toBe("node scripts/run-demo-suite.mjs ci");
    expect(packageJson.scripts["demo:list"]).toBe("node scripts/run-demo-suite.mjs --list");
    const expectedCommands = [
      "demo:coverage",
      "demo:baselines",
      "demo:improve",
      "demo:targets",
      "demo:contracts",
      "demo:flows",
      "demo:schedules",
      "demo:workflows",
      "demo:providers",
      "demo:provider-handoff",
      "demo:triage",
      "demo:llm",
      "demo:report",
      "demo:risk",
      "demo:security",
      "demo:costs",
      "demo:runbook",
      "demo:history",
      "demo:connections",
      "demo:artifacts",
      "demo:evidence",
      "demo:layers",
      "demo:verdict",
      "demo:handoff",
      "demo:test-creation",
      "demo:agent-packet",
      "demo:tools",
      "demo:context",
      "demo:analyze",
      "demo:kubestellar",
      "demo:plan:canary",
      "demo:plan:full",
      "demo:plans",
      "demo:pipeline",
      "demo:ui"
    ];

    for (const command of expectedCommands) {
      expect(demoAllOutput).toContain(command);
      expect(demoCiOutput).toContain(command);
    }
    expect(packageJson.scripts["demo:providers"]).toContain("providers list --config");
    expect(packageJson.scripts["demo:provider-handoff"]).toContain("providers handoff --config");
    expect(packageJson.scripts["demo:provider-handoff"]).toContain("--provider argos");
    expect(packageJson.scripts["demo:baselines"]).toContain("baselines list --config");
    expect(packageJson.scripts["demo:baselines"]).toContain("--write");
    expect(packageJson.scripts["demo:improve"]).toContain("improve-coverage --config");
    expect(demoAllOutput.indexOf("demo:flows")).toBeLessThan(demoAllOutput.indexOf("demo:improve"));
    expect(demoCiOutput.indexOf("demo:flows")).toBeLessThan(demoCiOutput.indexOf("demo:improve"));
    expect(packageJson.scripts["demo:providers"]).toContain("--mock-results");
    expect(packageJson.scripts["demo:llm"]).toContain("llm --config");
    expect(packageJson.scripts["demo:security"]).toContain("security --config");
    expect(packageJson.scripts["demo:costs"]).toContain("costs --config");
    expect(packageJson.scripts["demo:runbook"]).toContain("runbook --config");
    expect(packageJson.scripts["demo:history"]).toContain("history --config");
    expect(packageJson.scripts["demo:history"]).toContain("--record");
    expect(packageJson.scripts["demo:connections"]).toContain("connections list --config");
    expect(packageJson.scripts["demo:connections"]).toContain("--write");
    expect(packageJson.scripts["demo:artifacts"]).toContain("artifacts --config");
    expect(packageJson.scripts["demo:evidence"]).toContain("evidence --config");
    expect(packageJson.scripts["demo:layers"]).toContain("layers --config");
    expect(demoAllOutput.indexOf("demo:evidence")).toBeLessThan(demoAllOutput.indexOf("demo:layers"));
    expect(demoCiOutput.indexOf("demo:evidence")).toBeLessThan(demoCiOutput.indexOf("demo:layers"));
    expect(demoAllOutput.indexOf("demo:layers")).toBeLessThan(demoAllOutput.indexOf("demo:verdict"));
    expect(demoCiOutput.indexOf("demo:layers")).toBeLessThan(demoCiOutput.indexOf("demo:verdict"));
    expect(packageJson.scripts["demo:verdict"]).toContain("verdict --config");
    expect(demoAllOutput.indexOf("demo:evidence")).toBeLessThan(demoAllOutput.indexOf("demo:verdict"));
    expect(demoCiOutput.indexOf("demo:evidence")).toBeLessThan(demoCiOutput.indexOf("demo:verdict"));
    expect(demoAllOutput.indexOf("demo:verdict")).toBeLessThan(demoAllOutput.indexOf("demo:handoff"));
    expect(demoCiOutput.indexOf("demo:verdict")).toBeLessThan(demoCiOutput.indexOf("demo:handoff"));
    expect(packageJson.scripts["demo:handoff"]).toContain("handoff --config");
    expect(packageJson.scripts["demo:handoff"]).toContain("--dry-run");
    expect(packageJson.scripts["demo:test-creation"]).toContain("test-creation-plan --config");
    expect(demoAllOutput.indexOf("demo:handoff")).toBeLessThan(demoAllOutput.indexOf("demo:test-creation"));
    expect(demoCiOutput.indexOf("demo:handoff")).toBeLessThan(demoCiOutput.indexOf("demo:test-creation"));
    expect(demoAllOutput.indexOf("demo:test-creation")).toBeLessThan(demoAllOutput.indexOf("demo:agent-packet"));
    expect(demoCiOutput.indexOf("demo:test-creation")).toBeLessThan(demoCiOutput.indexOf("demo:agent-packet"));
    expect(packageJson.scripts["demo:agent-packet"]).toContain("agent-packet --config");
    expect(packageJson.scripts["demo:agent-packet"]).toContain("--profile repair_agent");
    expect(packageJson.scripts["demo:tools"]).toContain("tools --config");
    expect(packageJson.scripts["demo:context"]).toContain("context --config");
    expect(packageJson.scripts["demo:analyze"]).toContain("analyze --repo");
    expect(demoAllOutput.indexOf("demo:doctor")).toBeLessThan(demoAllOutput.indexOf("demo:analyze"));
    expect(demoCiOutput.indexOf("demo:doctor")).toBeLessThan(demoCiOutput.indexOf("demo:analyze"));
    expect(demoAllOutput.indexOf("demo:analyze")).toBeLessThan(demoAllOutput.indexOf("demo:recommend"));
    expect(demoCiOutput.indexOf("demo:analyze")).toBeLessThan(demoCiOutput.indexOf("demo:recommend"));
    expect(demoAllOutput.indexOf("demo:tools")).toBeLessThan(demoAllOutput.indexOf("demo:context"));
    expect(demoCiOutput.indexOf("demo:tools")).toBeLessThan(demoCiOutput.indexOf("demo:context"));
    expect(demoAllOutput.indexOf("demo:pipeline")).toBeLessThan(demoAllOutput.indexOf("demo:context"));
    expect(demoCiOutput.indexOf("demo:pipeline")).toBeLessThan(demoCiOutput.indexOf("demo:context"));
    expect(demoAllOutput.indexOf("demo:context")).toBeLessThan(demoAllOutput.indexOf("demo:artifacts"));
    expect(demoCiOutput.indexOf("demo:context")).toBeLessThan(demoCiOutput.indexOf("demo:artifacts"));
    expect(packageJson.scripts["demo:plan:canary"]).toContain("--mode canary");
    expect(packageJson.scripts["demo:plan:canary"]).toContain("--output .visual-hive/plan.canary.json");
    expect(packageJson.scripts["demo:plan:full"]).toContain("--mode full");
    expect(packageJson.scripts["demo:plan:full"]).toContain("--output .visual-hive/plan.full.json");
    expect(packageJson.scripts["demo:plan:full"]).not.toContain("--allow-unsafe-targets");
    expect(packageJson.scripts["demo:plans"]).toContain("plans --config");
    expect(demoAllOutput.indexOf("demo:plan:full")).toBeLessThan(demoAllOutput.indexOf("demo:plans"));
    expect(demoAllOutput.indexOf("demo:plans")).toBeLessThan(demoAllOutput.indexOf("demo:run"));
    expect(demoCiOutput.indexOf("demo:plan:full")).toBeLessThan(demoCiOutput.indexOf("demo:plans"));
    expect(demoCiOutput.indexOf("demo:plans")).toBeLessThan(demoCiOutput.indexOf("demo:run:seed"));
    expect(demoCiOutput.indexOf("demo:run:seed")).toBeLessThan(demoCiOutput.indexOf("demo:run:ci"));
    expect(packageJson.scripts["demo:run:seed"]).toContain("VISUAL_HIVE_CI=false");
    expect(packageJson.scripts["demo:run:seed"]).toContain("scripts/run-with-env.mjs");
    expect(packageJson.scripts["demo:pipeline"]).toContain("--skip-install");
    expect(packageJson.scripts["demo:pipeline"]).toContain("--skip-build");
    expect(packageJson.scripts["demo:kubestellar"]).toContain("demo:kubestellar:auth-plan");
    expect(packageJson.scripts["demo:kubestellar"]).toContain("demo:kubestellar:docs-plan");
    expect(packageJson.scripts["demo:kubestellar"]).toContain("demo:kubestellar:plans");
    expect(packageJson.scripts["demo:kubestellar:plans"]).toContain("plans --config");
    expect(packageJson.scripts["demo:kubestellar:auth-plan"]).toContain("--output .visual-hive/plan.auth.json");
    expect(packageJson.scripts["demo:kubestellar:cluster-plan"]).toContain("--output .visual-hive/plan.cluster.json");
    expect(packageJson.scripts["demo:kubestellar:docs-plan"]).toContain("--output .visual-hive/plan.docs.json");
    expect(packageJson.scripts["demo:kubestellar:schedule-plan"]).toContain("--output .visual-hive/plan.schedule.json");
    expect(packageJson.scripts["demo:kubestellar:schedule-plan"]).toContain("--mode schedule");
    expect(packageJson.scripts["demo:ui"]).toBe("npm run smoke:ui");
    expect(packageJson.scripts["demo:risk"]).toContain("risk --config");
  });

  it("analyze writes repo map and context artifacts", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-cli-analyze-"));
    tempDirs.push(tempRoot);
    await mkdir(path.join(tempRoot, "src"), { recursive: true });
    await writeFile(
      path.join(tempRoot, "package.json"),
      JSON.stringify(
        {
          name: "analyze-fixture",
          scripts: {
            build: "vite build",
            preview: "vite preview",
            test: "vitest"
          },
          dependencies: {
            react: "^19.0.0",
            vite: "^6.0.0"
          },
          devDependencies: {
            "@playwright/test": "^1.50.0",
            vitest: "^2.1.8"
          }
        },
        null,
        2
      ),
      "utf8"
    );
    await writeFile(
      path.join(tempRoot, "src", "App.tsx"),
      `export function App() {
  const token = "secret-value";
  return <a href="/clusters" data-testid="dashboard-page">Clusters</a>;
}
`,
      "utf8"
    );

    const result = await runAnalyzeCommand({ repo: tempRoot });
    const summary = formatAnalyzeSummary(result);
    const report = await readJson<typeof result.report>(result.reportPath);
    const markdown = await readFile(result.markdownPath, "utf8");

    expect(result.reportPath).toBe(path.join(tempRoot, ".visual-hive", "repo-map.json"));
    expect(result.markdownPath).toBe(path.join(tempRoot, ".visual-hive", "repo-context.md"));
    expect(report.schemaVersion).toBe(1);
    expect(report.project.name).toBe("analyze-fixture");
    expect(report.project.frameworks).toEqual(expect.arrayContaining(["react", "vite"]));
    expect(report.testTools).toEqual(expect.arrayContaining(["playwright", "vitest"]));
    expect(report.selectors.map((selector) => selector.selector)).toContain("[data-testid='dashboard-page']");
    expect(report.routes.map((route) => route.route)).toContain("/clusters");
    expect(report.targetHints.map((hint) => hint.id)).toContain("localPreview");
    expect(summary).toContain("Visual Hive Repo Context: analyze-fixture");
    expect(markdown).toContain("Visual Hive Repo Context: analyze-fixture");
    expect(JSON.stringify(report)).not.toContain("secret-value");
    expect(markdown).not.toContain("secret-value");
  });

  it("passes explicit include and exclude options through plan command", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-cli-explicit-plan-"));
    tempDirs.push(tempRoot);
    await writeFile(
      path.join(tempRoot, "visual-hive.config.yaml"),
      `project:
  name: explicit-plan
targets:
  local:
    kind: url
    url: "http://127.0.0.1:4173"
    prSafe: true
contracts:
  - id: pr-contract
    description: PR contract
    target: local
    runOn:
      pullRequest: true
  - id: manual-contract
    description: Manual contract
    target: local
    runOn:
      pullRequest: false
`,
      "utf8"
    );

    const plan = await runPlanCommand({
      cwd: tempRoot,
      mode: "pr",
      includeContracts: ["manual-contract"],
      excludeContracts: ["pr-contract"]
    });

    expect(plan.items.map((item) => item.contractId)).toEqual(["manual-contract"]);
    expect(plan.items[0]?.reasons).toContain("explicit include contract");
    expect(plan.excluded.find((item) => item.contractId === "pr-contract")?.reasons).toContain("explicit exclude contract");
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

  it("improve-coverage writes recommendations from coverage gaps and mutation survivors", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-improve-"));
    tempDirs.push(tempRoot);
    await mkdir(path.join(tempRoot, ".visual-hive"), { recursive: true });
    await writeFile(
      path.join(tempRoot, "visual-hive.config.yaml"),
      `project:
  name: improve-fixture
targets:
  local:
    kind: url
    url: "http://127.0.0.1:4173"
    prSafe: true
contracts:
  - id: dashboard
    description: Dashboard
    target: local
    severity: high
    runOn:
      pullRequest: true
    selectors:
      mustExist:
        - "[data-testid='dashboard-page']"
    screenshots:
      - name: dashboard
        route: "/"
        viewport: desktop
viewports:
  desktop:
    width: 1440
    height: 900
  mobile:
    width: 390
    height: 844
`,
      "utf8"
    );
    await writeJson(path.join(tempRoot, ".visual-hive", "coverage.json"), {
      schemaVersion: 1,
      project: "improve-fixture",
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
        viewportsCovered: 2,
        uncoveredTargets: 0,
        uncoveredContracts: 0,
        changedFileRules: 0,
        matchedChangedFileRules: 0,
        unmatchedChangedFiles: 1
      },
      targets: [],
      contracts: [],
      routes: [],
      viewports: [],
      changedFileCoverage: [],
      unmatchedChangedFiles: ["src/auth/Login.tsx"],
      uncoveredAreas: [
        {
          kind: "changed_file_without_rule",
          severity: "low",
          changedFile: "src/auth/Login.tsx",
          message: "Changed file did not match any selection rule."
        },
        {
          kind: "viewport_without_screenshots",
          severity: "medium",
          viewport: "mobile",
          message: "Mobile viewport has no screenshot coverage."
        }
      ]
    });
    await writeJson(path.join(tempRoot, ".visual-hive", "mutation-report.json"), {
      schemaVersion: 2,
      project: "improve-fixture",
      generatedAt: "2026-06-15T00:00:00.000Z",
      minScore: 0.7,
      score: 0,
      killed: 0,
      total: 1,
      results: [
        {
          operator: "force-login-on-demo",
          status: "survived",
          killed: false,
          contractIds: ["dashboard"],
          applicable: true,
          durationMs: 10,
          errors: []
        }
      ]
    });
    await writeJson(path.join(tempRoot, ".visual-hive", "flows.json"), {
      schemaVersion: 1,
      project: "improve-fixture",
      generatedAt: "2026-06-15T00:00:00.000Z",
      summary: {
        contractCount: 1,
        flowContractCount: 0,
        selectedFlowContracts: 0,
        flowStepCount: 0,
        navigationSteps: 0,
        interactionSteps: 0,
        assertionSteps: 0,
        failedFlowSteps: 0,
        contractsWithoutFlow: 1,
        criticalContractsWithoutFlow: 0,
        highSeverityFlowGaps: 0
      },
      flows: [
        {
          contractId: "dashboard",
          targetId: "local",
          targetKind: "url",
          severity: "high",
          selected: true,
          runOn: { pullRequest: true, schedule: false },
          steps: [],
          latestStatus: "not_run",
          latestPassedSteps: 0,
          latestFailedSteps: 0,
          latestFailedMessages: [],
          gaps: [{ kind: "no_flow_steps", severity: "medium", message: "Contract has no deterministic user-flow steps." }],
          recommendations: ["Add deterministic flow steps to dashboard."]
        }
      ],
      recommendations: ["Start with a dashboard flow."]
    });

    const result = await runImproveCoverageCommand({ config: path.join(tempRoot, "visual-hive.config.yaml") });
    const written = await readJson<typeof result.report>(result.reportPath);
    const summary = formatCoverageImprovementReport(written, result.reportPath);

    expect(written.schemaVersion).toBe(1);
    expect(written.summary.fromMutationSurvivors).toBe(1);
    expect(written.summary.fromFlowGaps).toBe(1);
    expect(written.recommendations.map((recommendation) => recommendation.kind)).toEqual(
      expect.arrayContaining(["add_changed_file_rule", "add_screenshot", "map_mutation_operator", "add_flow_steps"])
    );
    expect(summary).toContain("Coverage Improvement Plan: improve-fixture");
    expect(summary).toContain("- From flow gaps: 1");
    expect(summary).toContain("add_flow_steps, lane=pull_request");
    await expect(access(path.join(tempRoot, ".visual-hive", "coverage-recommendations.json"))).resolves.toBeUndefined();
  });

  it("improve-coverage previews and applies a selected config recommendation only with --yes", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-improve-apply-"));
    tempDirs.push(tempRoot);
    await mkdir(path.join(tempRoot, ".visual-hive"), { recursive: true });
    const configPath = path.join(tempRoot, "visual-hive.config.yaml");
    const originalConfig = `project:
  name: improve-apply
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
    selectors:
      mustExist:
        - "body"
`;
    await writeFile(configPath, originalConfig, "utf8");
    await writeJson(path.join(tempRoot, ".visual-hive", "coverage.json"), {
      schemaVersion: 1,
      project: "improve-apply",
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
        changedFileRules: 0,
        matchedChangedFileRules: 0,
        unmatchedChangedFiles: 1
      },
      targets: [],
      contracts: [],
      routes: [],
      viewports: [],
      changedFileCoverage: [],
      unmatchedChangedFiles: ["src/auth/Login.tsx"],
      uncoveredAreas: [
        {
          kind: "changed_file_without_rule",
          severity: "medium",
          changedFile: "src/auth/Login.tsx",
          message: "Changed file did not match any selection rule."
        }
      ]
    });

    const preview = await runImproveCoverageCommand({
      config: configPath,
      apply: "changed-file-rule:src/auth/Login.tsx"
    });
    const previewSummary = formatCoverageImprovementReport(preview.report, preview.reportPath, "markdown", preview.applyResult, false);

    expect(preview.applyResult?.applied).toBe(true);
    expect(previewSummary).toContain("Selected Recommendation Diff");
    expect(previewSummary).toContain("re-run with --yes");
    await expect(readFile(configPath, "utf8")).resolves.toBe(originalConfig);

    const applied = await runImproveCoverageCommand({
      config: configPath,
      apply: "changed-file-rule:src/auth/Login.tsx",
      yes: true
    });
    const updated = await readFile(configPath, "utf8");

    expect(formatCoverageImprovementReport(applied.report, applied.reportPath, "markdown", applied.applyResult, true)).toContain("- Applied: yes");
    expect(updated).toContain("pattern: src/auth/**");
    expect(updated).toContain("- dashboard");
  });

  it("improve-coverage applies mutation survivor recommendations into mapped assertions", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-improve-mutation-"));
    tempDirs.push(tempRoot);
    await mkdir(path.join(tempRoot, ".visual-hive"), { recursive: true });
    const configPath = path.join(tempRoot, "visual-hive.config.yaml");
    await writeFile(
      configPath,
      `project:
  name: improve-mutation
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
    selectors:
      mustExist:
        - "body"
mutation:
  enabled: true
  operators:
    - remove-demo-badge
`,
      "utf8"
    );
    await writeJson(path.join(tempRoot, ".visual-hive", "coverage.json"), {
      schemaVersion: 1,
      project: "improve-mutation",
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
        changedFileRules: 0,
        matchedChangedFileRules: 0,
        unmatchedChangedFiles: 0
      },
      targets: [],
      contracts: [],
      routes: [],
      viewports: [],
      changedFileCoverage: [],
      unmatchedChangedFiles: [],
      uncoveredAreas: []
    });
    await writeJson(path.join(tempRoot, ".visual-hive", "mutation-report.json"), {
      schemaVersion: 2,
      project: "improve-mutation",
      generatedAt: "2026-06-15T00:00:00.000Z",
      minScore: 0.7,
      score: 0,
      killed: 0,
      total: 1,
      results: [
        {
          operator: "remove-demo-badge",
          status: "survived",
          killed: false,
          contractIds: ["dashboard"],
          applicable: true,
          durationMs: 10,
          errors: []
        }
      ]
    });

    const applied = await runImproveCoverageCommand({
      config: configPath,
      apply: "mutation-survivor:remove-demo-badge:dashboard",
      yes: true
    });
    const updated = await readFile(configPath, "utf8");

    expect(applied.applyResult?.applied).toBe(true);
    expect(updated).toContain("id: remove-demo-badge");
    expect(updated).toContain("- dashboard");
    expect(updated).toContain("[data-testid='demo-badge']");
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

  it("flows writes a user-flow audit artifact", async () => {
    const demoRoot = path.join(repoRoot, "examples/demo-react-app");
    const result = await runFlowsCommand({
      config: path.join(demoRoot, "visual-hive.config.yaml"),
      cwd: repoRoot,
      mode: "pr",
      changedFiles: path.join(demoRoot, "changed-files.txt")
    });
    const written = await readJson<typeof result.audit>(result.auditPath);
    const summary = formatFlowsAudit(written, result.auditPath);

    expect(written.schemaVersion).toBe(1);
    expect(written.summary.contractCount).toBeGreaterThan(0);
    expect(written.flows.map((flow) => flow.contractId)).toContain("hosted-demo-never-login");
    expect(summary).toContain("Flow Audit: demo-react-app");
    await expect(access(path.join(demoRoot, ".visual-hive", "flows.json"))).resolves.toBeUndefined();
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
    prSafe: true
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
    expect(written.workflows[0]?.writesBaselineReview).toBe(false);
    expect(written.findings.map((finding) => finding.kind)).toContain("missing_baseline_review_artifact");
    expect(summary).toContain("Workflow Safety Audit: cli-workflows");
    expect(summary).toContain("baselines=no");
    await expect(access(path.join(tempRoot, ".visual-hive", "workflows.json"))).resolves.toBeUndefined();
  });

  it("workflows can write guarded built-in workflow templates and audit the result", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-cli-workflow-templates-"));
    tempDirs.push(tempRoot);
    await writeFile(
      path.join(tempRoot, "visual-hive.config.yaml"),
      `project:
  name: cli-workflow-templates
targets:
  local:
    kind: url
    url: "http://127.0.0.1:4173"
    prSafe: true
contracts:
  - id: dashboard
    description: Dashboard
    target: local
`,
      "utf8"
    );

    const result = await runWorkflowTemplatesWriteCommand({
      cwd: tempRoot,
      templateIds: ["pull_request"]
    });
    const summary = formatWorkflowTemplateWrite(result);
    const workflowPath = path.join(tempRoot, ".github", "workflows", "visual-hive-pr.yml");

    await expect(readFile(workflowPath, "utf8")).resolves.toContain("Visual Hive PR");
    await expect(readFile(path.join(tempRoot, ".visual-hive", "workflow-edits.json"), "utf8")).resolves.toContain("pull_request");
    await expect(access(path.join(tempRoot, ".visual-hive", "workflows.json"))).resolves.toBeUndefined();
    expect(result.write.written[0]?.path).toBe(".github/workflows/visual-hive-pr.yml");
    expect(result.audit.summary.pullRequestWorkflows).toBe(1);
    expect(result.audit.workflows[0]?.writesBaselineReview).toBe(true);
    expect(summary).toContain("baselines=yes");
    expect(summary).toContain("Templates written: 1");
    expect(summary).toContain("Workflow Safety Audit: cli-workflow-templates");

    await expect(
      runWorkflowTemplatesWriteCommand({
        cwd: tempRoot,
        templateIds: ["pull_request"]
      })
    ).rejects.toThrow(/Refusing to overwrite existing workflow template/);

    await writeFile(workflowPath, "custom workflow", "utf8");
    const forced = await runWorkflowTemplatesWriteCommand({
      cwd: tempRoot,
      force: true,
      templateIds: ["pull_request"]
    });

    expect(forced.write.written[0]?.overwritten).toBe(true);
    await expect(readFile(workflowPath, "utf8")).resolves.toContain("DavidDiaz0317/visual-hive/actions/run@main");
  });

  it("writes a security audit from workflow and npm audit evidence", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-cli-security-"));
    tempDirs.push(tempRoot);
    await writeFile(
      path.join(tempRoot, "visual-hive.config.yaml"),
      `project:
  name: cli-security
targets:
  local:
    kind: url
    url: "http://127.0.0.1:4173"
  protectedLane:
    kind: protected
    url: "https://cluster.example.com"
    prSafe: true
contracts:
  - id: dashboard
    description: Dashboard
    target: local
providers:
  argos:
    enabled: true
    mode: external
costPolicy:
  externalUpload:
    pullRequest: true
ai:
  enabled: true
  provider: openai
  model: gpt-4.1
  neverSoleOracle: true
`,
      "utf8"
    );
    await mkdir(path.join(tempRoot, ".github", "workflows"), { recursive: true });
    await writeFile(
      path.join(tempRoot, ".github", "workflows", "unsafe-pr.yml"),
      `on: pull_request_target
permissions:
  contents: write
jobs:
  visual:
    steps:
      - uses: actions/checkout@v4
      - run: visual-hive run
        env:
          TOKEN: \${{ secrets.SECRET_TOKEN }}
`,
      "utf8"
    );
    await writeJson(path.join(tempRoot, "npm-audit.json"), {
      metadata: {
        vulnerabilities: {
          critical: 1,
          high: 1,
          moderate: 0,
          low: 0,
          info: 0,
          total: 2
        }
      }
    });

    const result = await runSecurityCommand({ cwd: tempRoot, auditJson: "npm-audit.json" });
    const written = await readJson<typeof result.report>(result.reportPath);
    const summary = formatSecurityAudit(written, result.reportPath);

    expect(written.schemaVersion).toBe(1);
    expect(written.summary.critical).toBeGreaterThan(0);
    expect(written.summary.npmAuditTotal).toBe(2);
    expect(written.findings.map((finding) => finding.category)).toEqual(
      expect.arrayContaining(["workflow", "protected_target", "provider", "llm", "dependency"])
    );
    expect(JSON.stringify(written)).not.toContain("SECRET_TOKEN");
    expect(summary).toContain("Security Audit: cli-security");
    expect(summary).toContain("npm audit: npm_audit_json");
    await expect(access(path.join(tempRoot, ".visual-hive", "security.json"))).resolves.toBeUndefined();
  });

  it("writes a cost audit from plan, report, mutation, and provider evidence", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-cli-costs-"));
    tempDirs.push(tempRoot);
    await writeFile(
      path.join(tempRoot, "visual-hive.config.yaml"),
      `project:
  name: cli-costs
targets:
  local:
    kind: url
    url: "http://127.0.0.1:4173"
    prSafe: true
    cost: cheap
contracts:
  - id: dashboard
    description: Dashboard
    target: local
    runOn:
      pullRequest: true
    screenshots:
      - name: dashboard
        route: /
        viewport: desktop
viewports:
  desktop:
    width: 1440
    height: 900
providers:
  argos:
    enabled: true
    mode: mock
costPolicy:
  maxExternalScreenshotsPerRun: 5
  maxMonthlyExternalScreenshots: 50
`,
      "utf8"
    );
    await mkdir(path.join(tempRoot, ".visual-hive"), { recursive: true });
    await writeJson(path.join(tempRoot, ".visual-hive", "plan.json"), {
      schemaVersion: 1,
      project: "cli-costs",
      mode: "pr",
      generatedAt: "2026-06-15T00:00:00.000Z",
      changedFiles: ["src/App.tsx"],
      effectiveChangedFiles: ["src/App.tsx"],
      ignoredChangedFiles: [],
      targets: [{ id: "local", kind: "url", url: "http://127.0.0.1:4173", prSafe: true, cost: "cheap" }],
      items: [
        {
          contractId: "dashboard",
          targetId: "local",
          targetUrl: "http://127.0.0.1:4173",
          severity: "medium",
          cost: "cheap",
          reasons: ["runOn.pullRequest=true"],
          screenshots: ["dashboard:/:desktop"]
        }
      ],
      excluded: [],
      mutation: { enabled: false, operators: [], minScore: 0.7, reasons: [] },
      providerPolicy: []
    });
    await writeJson(path.join(tempRoot, ".visual-hive", "mutation-report.json"), {
      schemaVersion: 2,
      project: "cli-costs",
      generatedAt: "2026-06-15T00:00:00.000Z",
      minScore: 0.7,
      score: 0,
      killed: 0,
      total: 0,
      results: []
    });

    const result = await runCostsCommand({ cwd: tempRoot });
    const written = await readJson<typeof result.report>(result.reportPath);
    const summary = formatCostsReport(written, result.reportPath);

    expect(written.schemaVersion).toBe(1);
    expect(written.summary.selectedContracts).toBe(1);
    expect(written.summary.localScreenshots).toBe(1);
    expect(written.summary.externalCallsPlanned).toBe(0);
    expect(written.providers.find((provider) => provider.providerId === "argos")?.mode).toBe("mock");
    expect(summary).toContain("Cost Audit: cli-costs");
    await expect(access(path.join(tempRoot, ".visual-hive", "costs.json"))).resolves.toBeUndefined();
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
    prSafe: true
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
    await writeJson(path.join(tempRoot, ".visual-hive", "report.json"), {
      schemaVersion: 2,
      status: "passed",
      token: "secret-value"
    });

    const result = await runArtifactsCommand({ cwd: tempRoot });
    const written = await readJson<typeof result.index>(result.indexPath);
    const summary = formatArtifactsIndex(written, result.indexPath);

    expect(written.summary.artifactCount).toBeGreaterThanOrEqual(1);
    expect(written.artifacts[0]?.preview).toContain("[REDACTED]");
    expect(written.artifacts.find((artifact) => artifact.path.endsWith("report.json"))?.schemaPath).toBe("schemas/visual-hive.report.schema.json");
    expect(summary).toContain("Artifact Index: cli-artifacts");
    expect(summary).toContain("schema=schemas/visual-hive.report.schema.json");
    await expect(access(path.join(tempRoot, ".visual-hive", "artifacts-index.json"))).resolves.toBeUndefined();
  });

  it("writes Hive handoff dry-run artifacts from an Evidence Packet", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-cli-handoff-"));
    tempDirs.push(tempRoot);
    await writeFile(
      path.join(tempRoot, "visual-hive.config.yaml"),
      `project:
  name: cli-handoff
targets:
  local:
    kind: url
    url: "http://127.0.0.1:4173"
contracts:
  - id: dashboard
    description: Dashboard
    target: local
integrations:
  hive:
    enabled: false
    mode: dry_run
    labels:
      - visual-hive
      - hive/quality
      - ai-ready
      - cli-test
`,
      "utf8"
    );
    await writeJson(path.join(tempRoot, ".visual-hive", "report.json"), {
      schemaVersion: 2,
      project: "cli-handoff",
      repository: sampleRepository,
      mode: "pr",
      generatedAt: "2026-06-15T00:00:00.000Z",
      status: "failed",
      changedFiles: ["src/App.tsx"],
      selectedTargets: [{ id: "local", kind: "url", url: "http://127.0.0.1:4173?token=secret-value", prSafe: true, cost: "cheap" }],
      selectedContracts: ["dashboard"],
      excludedContracts: [],
      targetLifecycle: [],
      generatedSpecPath: ".visual-hive/generated/visual-hive.generated.spec.ts",
      results: [
        {
          contractId: "dashboard",
          targetId: "local",
          status: "failed",
          durationMs: 12,
          errors: ["Missing selector; authorization: Bearer secret-value"],
          artifacts: [".visual-hive/artifacts/screenshots/dashboard.png"],
          selectorAssertions: [{ kind: "mustExist", value: "[data-testid='dashboard-page']", status: "failed", message: "missing" }],
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
      artifacts: [".visual-hive/artifacts/screenshots/dashboard.png"],
      reproductionCommands: ["visual-hive run --ci"]
    });

    await runEvidenceCommand({ cwd: tempRoot });
    const result = await runHandoffCommand({ cwd: tempRoot });
    const summary = formatHandoffResult(result);
    const handoff = await readJson<typeof result.handoff>(result.handoffPath);
    const issue = await readFile(result.issuePath, "utf8");

    expect(handoff.status).toBe("ready");
    expect(handoff.externalCallsMade).toBe(0);
    expect(handoff.labels).toContain("cli-test");
    expect(handoff.workItems[0]?.kind).toBe("repair");
    expect(result.beadRequest.forbiddenActions).toContain("decide_visual_hive_verdict");
    expect(result.result.status).toBe("dry_run_written");
    expect(summary).toContain("Hive Handoff Dry Run: cli-handoff");
    expect(issue).toContain("Trusted workflows must consume uploaded sanitized artifacts");
    expect(JSON.stringify(result)).not.toContain("secret-value");
    await expect(access(path.join(tempRoot, ".visual-hive", "hive-bead-request.json"))).resolves.toBeUndefined();
    await expect(access(path.join(tempRoot, ".visual-hive", "hive-handoff-result.json"))).resolves.toBeUndefined();
  });

  it("writes a standalone verdict artifact from normalized evidence", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-cli-verdict-"));
    tempDirs.push(tempRoot);
    await writeFile(
      path.join(tempRoot, "visual-hive.config.yaml"),
      `project:
  name: cli-verdict
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
      project: "cli-verdict",
      repository: sampleRepository,
      mode: "pr",
      generatedAt: "2026-06-15T00:00:00.000Z",
      status: "failed",
      changedFiles: ["src/App.tsx"],
      selectedTargets: [{ id: "local", kind: "url", url: "http://127.0.0.1:4173", prSafe: true, cost: "cheap" }],
      selectedContracts: ["dashboard"],
      excludedContracts: [],
      targetLifecycle: [],
      generatedSpecPath: ".visual-hive/generated/visual-hive.generated.spec.ts",
      results: [
        {
          contractId: "dashboard",
          targetId: "local",
          status: "failed",
          durationMs: 12,
          errors: ["Missing selector; token=secret-value"],
          artifacts: [".visual-hive/artifacts/screenshots/dashboard.png"],
          selectorAssertions: [{ kind: "mustExist", value: "[data-testid='dashboard-page']", status: "failed", message: "missing" }],
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
      artifacts: [".visual-hive/artifacts/screenshots/dashboard.png"],
      reproductionCommands: ["visual-hive run --ci"]
    });

    await runEvidenceCommand({ cwd: tempRoot });
    const result = await runVerdictCommand({ cwd: tempRoot });
    const summary = formatVerdictReport(result);
    const verdict = await readJson<typeof result.report>(result.reportPath);
    const markdown = await readFile(result.markdownPath, "utf8");

    expect(verdict.schemaVersion).toBe("visual-hive.verdict.v1");
    expect(verdict.summary.visualHiveVerdict).toBe("failed");
    expect(verdict.summary.failedBecause).toContain("playwright.deterministic_run");
    expect(verdict.governance.verdictAuthority).toBe("visual_hive");
    expect(verdict.policy.passFailOwnedBy).toBe("visual_hive_verdict_engine");
    expect(verdict.sourceArtifacts.evidencePacket).toBe(".visual-hive/evidence-packet.json");
    expect(summary).toContain("Visual Hive Verdict: cli-verdict");
    expect(markdown).toContain("Authority: Visual Hive deterministic Verdict Engine");
    expect(JSON.stringify(verdict)).not.toContain("secret-value");
    await expect(access(path.join(tempRoot, ".visual-hive", "verdict.json"))).resolves.toBeUndefined();
    await expect(access(path.join(tempRoot, ".visual-hive", "verdict.md"))).resolves.toBeUndefined();
  });

  it("writes a testing-layer audit artifact from normalized evidence", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-cli-layers-"));
    tempDirs.push(tempRoot);
    await writeFile(
      path.join(tempRoot, "visual-hive.config.yaml"),
      `project:
  name: cli-layers
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
      project: "cli-layers",
      repository: sampleRepository,
      mode: "pr",
      generatedAt: "2026-06-15T00:00:00.000Z",
      status: "passed",
      changedFiles: ["src/App.tsx"],
      selectedTargets: [{ id: "local", kind: "url", url: "http://127.0.0.1:4173", prSafe: true, cost: "cheap" }],
      selectedContracts: ["dashboard"],
      excludedContracts: [],
      targetLifecycle: [],
      generatedSpecPath: ".visual-hive/generated/visual-hive.generated.spec.ts",
      results: [
        {
          contractId: "dashboard",
          targetId: "local",
          status: "passed",
          durationMs: 12,
          errors: [],
          artifacts: [".visual-hive/artifacts/screenshots/dashboard.png"],
          selectorAssertions: [{ kind: "mustExist", value: "[data-testid='dashboard-page']", status: "passed" }],
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
      artifacts: [".visual-hive/artifacts/screenshots/dashboard.png"],
      reproductionCommands: ["visual-hive run --ci"]
    });

    await runEvidenceCommand({ cwd: tempRoot });
    const result = await runLayersCommand({ cwd: tempRoot });
    const summary = formatLayersReport(result);
    const layers = await readJson<typeof result.report>(result.reportPath);
    const markdown = await readFile(result.markdownPath, "utf8");

    expect(layers.schemaVersion).toBe(1);
    expect(layers.summary.totalLayers).toBe(12);
    expect(layers.layers.map((layer) => layer.id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(layers.layers.find((layer) => layer.id === 6)?.status).toBe("covered");
    expect(layers.layers.find((layer) => layer.id === 9)?.skippedReasons).toContain("No mutation report found.");
    expect(summary).toContain("Testing Layers: cli-layers");
    expect(markdown).toContain("Visual Hive Testing Layers: cli-layers");
    await expect(access(path.join(tempRoot, ".visual-hive", "testing-layers.json"))).resolves.toBeUndefined();
    await expect(access(path.join(tempRoot, ".visual-hive", "testing-layers.md"))).resolves.toBeUndefined();
  });

  it("writes an Agent Packet from Evidence and Handoff artifacts", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-cli-agent-packet-"));
    tempDirs.push(tempRoot);
    await writeFile(
      path.join(tempRoot, "visual-hive.config.yaml"),
      `project:
  name: cli-agent-packet
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
      project: "cli-agent-packet",
      repository: sampleRepository,
      mode: "pr",
      generatedAt: "2026-06-15T00:00:00.000Z",
      status: "failed",
      changedFiles: ["src/App.tsx"],
      selectedTargets: [{ id: "local", kind: "url", url: "http://127.0.0.1:4173?token=secret-value", prSafe: true, cost: "cheap" }],
      selectedContracts: ["dashboard"],
      excludedContracts: [],
      targetLifecycle: [],
      generatedSpecPath: ".visual-hive/generated/visual-hive.generated.spec.ts",
      results: [
        {
          contractId: "dashboard",
          targetId: "local",
          status: "failed",
          durationMs: 12,
          errors: ["Missing selector; authorization: Bearer secret-value"],
          artifacts: [".visual-hive/artifacts/screenshots/dashboard.png"],
          selectorAssertions: [{ kind: "mustExist", value: "[data-testid='dashboard-page']", status: "failed", message: "missing" }],
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
      artifacts: [".visual-hive/artifacts/screenshots/dashboard.png"],
      reproductionCommands: ["visual-hive run --ci"]
    });

    await runEvidenceCommand({ cwd: tempRoot });
    await runHandoffCommand({ cwd: tempRoot });
    const result = await runAgentPacketCommand({ cwd: tempRoot, profile: "test_creator" });
    const summary = formatAgentPacketResult(result);
    const packet = await readJson<typeof result.packet>(result.packetPath);

    expect(packet.schemaVersion).toBe("visual-hive.agent-packet.v1");
    expect(packet.profile).toBe("test_creator");
    expect(packet.allowedTools.map((tool) => tool.id)).toContain("visual_hive_read_mutation_report");
    expect(packet.forbiddenActions).toContain("decide_visual_hive_verdict");
    expect(packet.budgets.allowExternalNetwork).toBe(false);
    expect(summary).toContain("Agent Packet: cli-agent-packet");
    expect(summary).toContain("External network allowed: false");
    expect(JSON.stringify(packet)).not.toContain("secret-value");
    await expect(access(path.join(tempRoot, ".visual-hive", "agent-packet.json"))).resolves.toBeUndefined();
  });

  it("writes a no-write test creation plan and threads it into test creator Agent Packets", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-cli-test-creation-"));
    tempDirs.push(tempRoot);
    await writeFile(
      path.join(tempRoot, "visual-hive.config.yaml"),
      `project:
  name: cli-test-creation
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
      project: "cli-test-creation",
      repository: sampleRepository,
      mode: "pr",
      generatedAt: "2026-06-15T00:00:00.000Z",
      status: "failed",
      changedFiles: ["src/App.tsx"],
      selectedTargets: [{ id: "local", kind: "url", url: "http://127.0.0.1:4173?token=secret-value", prSafe: true, cost: "cheap" }],
      selectedContracts: ["dashboard"],
      excludedContracts: [],
      targetLifecycle: [],
      generatedSpecPath: ".visual-hive/generated/visual-hive.generated.spec.ts",
      results: [
        {
          contractId: "dashboard",
          targetId: "local",
          status: "failed",
          durationMs: 12,
          errors: ["Missing selector; authorization: Bearer secret-value"],
          artifacts: [".visual-hive/artifacts/screenshots/dashboard.png"],
          selectorAssertions: [{ kind: "mustExist", value: "[data-testid='dashboard-page']", status: "failed", message: "missing" }],
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
      artifacts: [".visual-hive/artifacts/screenshots/dashboard.png"],
      reproductionCommands: ["visual-hive run --ci"]
    });
    await writeJson(path.join(tempRoot, ".visual-hive", "coverage-recommendations.json"), {
      schemaVersion: 1,
      project: "cli-test-creation",
      generatedAt: "2026-06-15T00:01:00.000Z",
      summary: { total: 1, high: 1, medium: 0, low: 0 },
      recommendations: [
        {
          id: "selectors:dashboard",
          kind: "add_selector_assertion",
          severity: "high",
          title: "Add dashboard selector assertion",
          rationale: ["token=coverage-secret"],
          contractId: "dashboard",
          suggestedTests: ["Add a stable dashboard page selector."],
          suggestedConfigYaml: "selectors:\n  mustExist:\n    - \"[data-testid='dashboard-page']\""
        }
      ]
    });

    await runEvidenceCommand({ cwd: tempRoot });
    await runHandoffCommand({ cwd: tempRoot });
    const testCreation = await runTestCreationPlanCommand({ cwd: tempRoot });
    const testCreationSummary = formatTestCreationPlan(testCreation);
    const agent = await runAgentPacketCommand({ cwd: tempRoot, profile: "test_creator" });
    const agentSummary = formatAgentPacketResult(agent);
    const plan = await readJson<typeof testCreation.plan>(testCreation.planPath);
    const packet = await readJson<typeof agent.packet>(agent.packetPath);

    expect(plan.schemaVersion).toBe("visual-hive.test-creation-plan.v1");
    expect(plan.governance.writePolicy).toBe("no_config_or_test_files_written");
    expect(plan.summary.total).toBeGreaterThan(0);
    expect(plan.summary.fromCoverageRecommendations).toBe(1);
    expect(plan.sourceArtifacts.evidencePacket).toBe(".visual-hive/evidence-packet.json");
    expect(plan.sourceArtifacts.handoffPacket).toBe(".visual-hive/handoff.json");
    expect(testCreationSummary).toContain("Test Creation Plan: cli-test-creation");
    expect(packet.profile).toBe("test_creator");
    expect(packet.sourceArtifacts.testCreationPlan).toBe(".visual-hive/test-creation-plan.json");
    expect(packet.evidenceSummary.testCreationRecommendations.length).toBeGreaterThan(0);
    expect(agentSummary).toContain("Test creation plan: .visual-hive/test-creation-plan.json");
    expect(JSON.stringify({ plan, packet })).not.toContain("secret-value");
    expect(JSON.stringify({ plan, packet })).not.toContain("coverage-secret");
    await expect(access(path.join(tempRoot, ".visual-hive", "test-creation-plan.json"))).resolves.toBeUndefined();
    await expect(access(path.join(tempRoot, ".visual-hive", "test-creation-plan.md"))).resolves.toBeUndefined();
  });

  it("writes Tool Registry and Tool Cards artifacts", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-cli-tools-"));
    tempDirs.push(tempRoot);
    await writeFile(
      path.join(tempRoot, "visual-hive.config.yaml"),
      `project:
  name: cli-tools
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

    const result = await runToolsCommand({ cwd: tempRoot });
    const summary = formatToolsRegistry(result);
    const registry = await readJson<typeof result.registry>(result.registryPath);
    const cards = await readFile(result.cardsPath, "utf8");

    expect(registry.schemaVersion).toBe("visual-hive.tool-registry.v1");
    expect(registry.policy.exposeThirdPartyMcp).toBe(false);
    expect(registry.policy.externalUploadsFromPr).toBe(false);
    expect(registry.tools.find((tool) => tool.id === "visual_hive_provider_upload")).toMatchObject({
      trustedOnly: true,
      forbiddenInPullRequest: true,
      externalNetwork: true
    });
    expect(cards).toContain("Tool: visual_hive_read_evidence_packet");
    expect(cards).toContain("Max external cost per task: $0");
    expect(summary).toContain("Tool Registry: cli-tools");
    expect(summary).toContain("Third-party MCP exposed by default: false");
    await expect(access(path.join(tempRoot, ".visual-hive", "tools", "tool-registry.json"))).resolves.toBeUndefined();
    await expect(access(path.join(tempRoot, ".visual-hive", "tools", "tool-cards.md"))).resolves.toBeUndefined();
  });

  it("writes Context Ledger artifact from generated agent/tool governance files", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-cli-context-"));
    tempDirs.push(tempRoot);
    await writeFile(
      path.join(tempRoot, "visual-hive.config.yaml"),
      `project:
  name: cli-context
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
    await runToolsCommand({ cwd: tempRoot });
    await writeJson(path.join(tempRoot, ".visual-hive", "pipeline.json"), {
      schemaVersion: 1,
      project: "cli-context",
      steps: [
        {
          id: "doctor",
          label: "Doctor",
          status: "passed",
          exitCode: 0,
          artifacts: [],
          message: "token=secret-value"
        }
      ]
    });

    const result = await runContextCommand({ cwd: tempRoot });
    const summary = formatContextLedger(result);
    const ledger = await readJson<typeof result.ledger>(result.ledgerPath);

    expect(ledger.schemaVersion).toBe("visual-hive.context-ledger.v1");
    expect(ledger.usage.toolCallsUsed).toBe(1);
    expect(ledger.sourceArtifacts.toolRegistry).toBe(".visual-hive/tools/tool-registry.json");
    expect(summary).toContain("Context Ledger: cli-context");
    expect(summary).toContain("Tool calls used: 1/");
    expect(JSON.stringify(ledger)).not.toContain("secret-value");
    await expect(access(path.join(tempRoot, ".visual-hive", "context-ledger.json"))).resolves.toBeUndefined();
  });

  it("fails handoff clearly when the Evidence Packet is missing", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-cli-handoff-missing-"));
    tempDirs.push(tempRoot);
    await writeFile(
      path.join(tempRoot, "visual-hive.config.yaml"),
      `project:
  name: missing-handoff
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
    await expect(runHandoffCommand({ cwd: tempRoot })).rejects.toThrow(/Run "visual-hive evidence" before "visual-hive handoff --dry-run"/);
  });

  it("recommend writes setup recommendations and protects existing config files", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-cli-recommend-"));
    tempDirs.push(tempRoot);
    await writeJson(path.join(tempRoot, "package.json"), {
      name: "recommend-fixture",
      scripts: {
        build: "vite build",
        preview: "vite preview",
        "test:e2e": "playwright test"
      },
      dependencies: {
        react: "^19.0.0",
        vite: "^6.0.0"
      },
      devDependencies: {
        "@playwright/test": "^1.50.0"
      }
    });
    await mkdir(path.join(tempRoot, "src"), { recursive: true });
    await mkdir(path.join(tempRoot, ".github", "workflows"), { recursive: true });
    await writeFile(path.join(tempRoot, "src", "App.tsx"), `<main data-testid="dashboard-page"><a href="/clusters">Clusters</a><Route path="/settings" /></main>`, "utf8");
    await writeFile(path.join(tempRoot, "playwright.config.ts"), `export default {};`, "utf8");
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
      - run: npx visual-hive plan --mode pr
`,
      "utf8"
    );

    const result = await runRecommendCommand({ cwd: tempRoot, writeConfig: true, writeDocs: true });
    const summary = formatSetupRecommendation(result);
    const report = await readJson<typeof result.report>(result.reportPath);
    const docsPath = path.join(tempRoot, "docs", "visual-hive.md");

    expect(report.project.type).toBe("react-vite");
    expect(report.setupProfile).toBe("free-local");
    expect(report.recommendedContracts[0]?.selectors).toContain("[data-testid='dashboard-page']");
    expect(report.providerRecommendations.find((provider) => provider.providerId === "playwright")?.recommendation).toBe("use");
    expect(report.costEstimate.externalScreenshotsPerRun).toBe(0);
    expect(report.playwright).toMatchObject({ status: "present", dependencies: ["@playwright/test"], configFiles: ["playwright.config.ts"] });
    expect(report.detectedRoutes.map((route) => route.route)).toEqual(["/clusters", "/settings"]);
    expect(report.setupActions.find((action) => action.id === "generate-config")?.command).toBe("visual-hive recommend --write-config");
    expect(report.setupActions.find((action) => action.id === "skip-provider-for-now")?.safetyNotes.join(" ")).toContain("Does not create credentials");
    expect(report.detectedWorkflows[0]).toMatchObject({
      path: ".github/workflows/visual-hive-pr.yml",
      triggers: ["pull_request"],
      permissions: ["contents: read"],
      visualHiveRelated: true
    });
    expect(report.workflowPreviews.map((workflow) => workflow.path)).toContain(".github/workflows/visual-hive-pr.yml");
    expect(summary).toContain("Visual Hive Setup Recommendation");
    expect(summary).toContain("Setup profile: free-local");
    expect(summary).toContain("Playwright setup: present");
    expect(summary).toContain("App routes: /clusters, /settings");
    expect(summary).toContain("Playwright Presence");
    expect(summary).toContain("Provider Recommendation");
    expect(summary).toContain("Existing Workflow Hints");
    expect(summary).toContain("Detected Route Hints");
    expect(summary).toContain(".github/workflows/visual-hive-pr.yml");
    expect(summary).toContain("Workflow Previews");
    expect(summary).toContain("Visual Hive PR: .github/workflows/visual-hive-pr.yml");
    expect(summary).toContain("Onboarding Checklist");
    expect(summary).toContain("[ready] Verify PR safety");
    expect(summary).toContain("Setup Actions");
    expect(summary).toContain("Use free local setup");
    expect(summary).toContain("visual-hive recommend --write-setup-bundle");
    expect(summary).toContain("Setup PR plan: review");
    expect(summary).toContain("External calls made: 0");
    expect(summary).toContain("PR secrets required: none");
    expect(summary).toContain("Docs written:");
    await expect(access(path.join(tempRoot, ".visual-hive", "recommendations.json"))).resolves.toBeUndefined();
    await expect(access(path.join(tempRoot, ".visual-hive", "setup-pr-plan.json"))).resolves.toBeUndefined();
    await expect(readFile(path.join(tempRoot, ".visual-hive", "setup-pr-plan.json"), "utf8")).resolves.toContain('"externalCallsMade": 0');
    await expect(readFile(path.join(tempRoot, ".visual-hive", "setup-pr-plan.json"), "utf8")).resolves.toContain('"generatedWorkflowsUsePullRequestTarget": false');
    await expect(access(path.join(tempRoot, "visual-hive.config.yaml"))).resolves.toBeUndefined();
    await expect(readFile(docsPath, "utf8")).resolves.toContain("PR checks should run with read-only permissions and no repository secrets.");
    await expect(readFile(docsPath, "utf8")).resolves.toContain("## Playwright Presence");
    await expect(readFile(docsPath, "utf8")).resolves.toContain("@playwright/test");
    await expect(readFile(docsPath, "utf8")).resolves.toContain("## Detected Route Hints");
    await expect(readFile(docsPath, "utf8")).resolves.toContain("## Setup Actions");
    await expect(readFile(docsPath, "utf8")).resolves.toContain("visual-hive providers decision --provider argos");
    await expect(readFile(docsPath, "utf8")).resolves.toContain("## Existing Workflow Hints");
    await expect(readFile(docsPath, "utf8")).resolves.toContain("## Workflow Previews");
    await expect(readFile(docsPath, "utf8")).resolves.toContain("include-hidden-files: true");
    await expect(readFile(docsPath, "utf8")).resolves.toContain("visual-hive workflows --write-templates");
    await expect(runRecommendCommand({ cwd: tempRoot, writeConfig: true })).rejects.toThrow(/Refusing to overwrite/);
    await expect(runRecommendCommand({ cwd: tempRoot, writeDocs: true })).rejects.toThrow(/Refusing to overwrite existing Visual Hive docs/);

    await writeFile(docsPath, "custom docs", "utf8");
    const forced = await runRecommendCommand({ cwd: tempRoot, writeDocs: true, force: true });
    expect(forced.docsWritten).toBe(docsPath);
    await expect(readFile(docsPath, "utf8")).resolves.toContain("# Visual Hive");
  });

  it("recommend honors explicit setup profiles in generated config", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-cli-recommend-profile-"));
    tempDirs.push(tempRoot);
    await writeJson(path.join(tempRoot, "package.json"), {
      name: "recommend-profile-fixture",
      scripts: {
        build: "vite build",
        preview: "vite preview"
      },
      dependencies: {
        react: "^19.0.0",
        vite: "^6.0.0"
      }
    });
    await mkdir(path.join(tempRoot, "src"), { recursive: true });
    await writeFile(path.join(tempRoot, "src", "App.tsx"), `<main data-testid="dashboard-page">Dashboard</main>`, "utf8");

    const result = await runRecommendCommand({ cwd: tempRoot, profile: "hosted-review", writeConfig: true });
    const summary = formatSetupRecommendation(result);
    const config = await readFile(path.join(tempRoot, "visual-hive.config.yaml"), "utf8");

    expect(result.report.setupProfile).toBe("hosted-review");
    expect(result.report.costEstimate.externalScreenshotsPerRun).toBeGreaterThan(0);
    expect(summary).toContain("Setup profile: hosted-review");
    expect(summary).toContain("External screenshots/run: 2");
    expect(config).toContain("setupProfile: hosted-review");
    expect(config).toContain("maxExternalScreenshotsPerRun: 5");
    await expect(runRecommendCommand({ cwd: tempRoot, profile: "not-a-profile" as never })).rejects.toThrow(/Invalid setup profile/);
  });

  it("recommend writes a complete setup bundle with safe workflows and audit logging", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-cli-recommend-bundle-"));
    tempDirs.push(tempRoot);
    await writeJson(path.join(tempRoot, "package.json"), {
      name: "recommend-bundle-fixture",
      scripts: {
        build: "vite build",
        preview: "vite preview",
        test: "vitest"
      },
      dependencies: {
        react: "^19.0.0",
        vite: "^6.0.0"
      }
    });
    await mkdir(path.join(tempRoot, "src"), { recursive: true });
    await writeFile(path.join(tempRoot, "src", "App.tsx"), `<main data-testid="dashboard-page">Dashboard</main>`, "utf8");

    const result = await runRecommendCommand({ cwd: tempRoot, writeSetupBundle: true });
    const summary = formatSetupRecommendation(result);

    expect(result.setupBundle?.ok).toBe(true);
    expect(result.setupBundle?.workflows.written.map((entry) => entry.path).sort()).toEqual([
      ".github/workflows/visual-hive-failure-issue.yml",
      ".github/workflows/visual-hive-pr.yml",
      ".github/workflows/visual-hive-scheduled.yml"
    ]);
    expect(summary).toContain("Setup bundle written: yes");
    expect(summary).toContain("## Setup Bundle");
    await expect(access(path.join(tempRoot, "visual-hive.config.yaml"))).resolves.toBeUndefined();
    await expect(readFile(path.join(tempRoot, "docs", "visual-hive.md"), "utf8")).resolves.toContain("PR checks should run with read-only permissions");
    await expect(readFile(path.join(tempRoot, ".github", "workflows", "visual-hive-pr.yml"), "utf8")).resolves.toContain("pull_request");
    await expect(readFile(path.join(tempRoot, ".github", "workflows", "visual-hive-pr.yml"), "utf8")).resolves.not.toContain("pull_request_target");
    await expect(readFile(path.join(tempRoot, ".visual-hive", "setup-bundle-edits.json"), "utf8")).resolves.toContain("setup-recommendation");
    await expect(readFile(path.join(tempRoot, ".visual-hive", "workflow-edits.json"), "utf8")).resolves.toContain("visual-hive-pr.yml");
    await expect(runRecommendCommand({ cwd: tempRoot, writeSetupBundle: true })).rejects.toThrow(/Refusing to write setup bundle/);

    const forced = await runRecommendCommand({ cwd: tempRoot, writeSetupBundle: true, force: true });
    expect(forced.setupBundle?.overwritten).toBe(true);
    expect(forced.setupBundle?.workflows.written.every((entry) => entry.overwritten)).toBe(true);
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
    await writeJson(path.join(connectedRoot, ".visual-hive", "readiness.json"), {
      schemaVersion: 1,
      project: "connected",
      generatedAt: "2026-06-15T00:00:00.000Z",
      status: "attention",
      score: 82,
      summary: { total: 3, passed: 2, warnings: 1, blocked: 0, missing: 0 },
      inputs: { plan: true, report: true, mutationReport: false, baselines: false, workflowAudit: true, securityAudit: true, costAudit: true },
      gates: [],
      nextActions: []
    });
    await writeJson(path.join(connectedRoot, ".visual-hive", "security.json"), {
      schemaVersion: 1,
      project: "connected",
      generatedAt: "2026-06-15T00:00:00.000Z",
      summary: {
        score: 90,
        totalFindings: 0,
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        prBlocking: 0,
        trustedOnly: 0,
        npmAuditSource: "not_run",
        npmAuditTotal: 0
      },
      inputs: { workflowAudit: true, npmAudit: false },
      npmAudit: { source: "not_run", total: 0, critical: 0, high: 0, moderate: 0, low: 0, info: 0 },
      findings: [],
      recommendations: []
    });
    await writeJson(path.join(connectedRoot, ".visual-hive", "costs.json"), {
      schemaVersion: 1,
      project: "connected",
      generatedAt: "2026-06-15T00:00:00.000Z",
      mode: "pr",
      summary: { budgetStatus: "warning", policyBlockedProviders: 1 },
      targets: [],
      providers: [],
      risks: [],
      recommendations: []
    });

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
    expect(addedSummary).toContain("Readiness gates needing review: 1");
    expect(addedSummary).toContain("readiness=attention 82/100");
    expect(addedSummary).toContain("security=90/100 criticalHigh=0");
    expect(addedSummary).toContain("cost=warning");

    const listed = await runConnectionsListCommand({ cwd: managerRoot });
    expect(listed.index.connections.map((connection) => connection.id)).toContain("connected");

    const written = await runConnectionsListCommand({ cwd: managerRoot, write: true });
    const portfolioArtifact = await readJson<{ schemaVersion: 1; portfolio: { queues: Array<{ id: string }> }; connections: Array<{ id: string }> }>(
      written.portfolioPath
    );
    expect(written.written).toBe(true);
    expect(formatConnectionsIndex(written.index, written.indexPath, "markdown", written.portfolioPath)).toContain("Portfolio artifact:");
    expect(portfolioArtifact.connections.map((connection) => connection.id)).toContain("connected");
    expect(portfolioArtifact.portfolio.queues.map((queue) => queue.id)).toContain("cost_policy");

    const removed = await runConnectionsRemoveCommand({ cwd: managerRoot, id: "connected" });
    expect(removed.index.connections.map((connection) => connection.id)).not.toContain("connected");
  });

  it("writes an empty plan and no-op report for ignored docs-only changes", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-docs-only-"));
    tempDirs.push(tempRoot);
    const configPath = path.join(tempRoot, "visual-hive.config.yaml");
    const changedPath = path.join(tempRoot, "changed-files.txt");
    await writeFile(
      configPath,
      `project:
  name: docs-only
targets:
  local:
    kind: command
    serve: "npm run preview"
    url: "http://127.0.0.1:4173"
    prSafe: true
contracts:
  - id: dashboard
    description: Dashboard
    target: local
    runOn:
      pullRequest: true
    selectors:
      mustExist:
        - "[data-testid='dashboard-page']"
    screenshots:
      - name: dashboard
        route: "/"
        viewport: desktop
selection:
  ignoreChangedFiles:
    - pattern: "docs/**"
      reason: "documentation-only"
    - pattern: "**/*.md"
      reason: "markdown-only"
    - pattern: "*.md"
      reason: "root markdown-only"
`,
      "utf8"
    );
    await writeFile(changedPath, "docs/visual-hive.md\nREADME.md\n", "utf8");

    const plan = await runPlanCommand({ config: configPath, cwd: tempRoot, mode: "pr", changedFiles: changedPath });
    const summary = await readFile(path.join(tempRoot, ".visual-hive", "plan.json"), "utf8");
    const exitCode = await runDeterministicCommand({ config: configPath, cwd: tempRoot });
    const report = await readJson<Report>(path.join(tempRoot, ".visual-hive", "report.json"));

    expect(plan.items).toEqual([]);
    expect(plan.effectiveChangedFiles).toEqual([]);
    expect(plan.ignoredChangedFiles.map((entry) => entry.file)).toEqual(["README.md", "docs/visual-hive.md"]);
    expect(summary).toContain("ignoredChangedFiles");
    expect(exitCode).toBe(0);
    expect(report.status).toBe("passed");
    expect(report.results).toEqual([]);
    expect(report.noContractsReason).toContain("selection.ignoreChangedFiles");
  });

  it("pipeline writes an operational artifact for ignored docs-only changes", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-pipeline-docs-only-"));
    tempDirs.push(tempRoot);
    const configPath = path.join(tempRoot, "visual-hive.config.yaml");
    const changedPath = path.join(tempRoot, "changed-files.txt");
    await writeFile(
      configPath,
      `project:
  name: pipeline-docs-only
targets:
  local:
    kind: command
    serve: "npm run preview"
    url: "http://127.0.0.1:4173"
    prSafe: true
contracts:
  - id: dashboard
    description: Dashboard
    target: local
    runOn:
      pullRequest: true
    selectors:
      mustExist:
        - "[data-testid='dashboard-page']"
    screenshots:
      - name: dashboard
        route: "/"
        viewport: desktop
selection:
  ignoreChangedFiles:
    - pattern: "docs/**"
      reason: "documentation-only"
`,
      "utf8"
    );
    await writeFile(changedPath, "docs/visual-hive.md\n", "utf8");

    const result = await runPipelineCommand({
      config: configPath,
      cwd: tempRoot,
      mode: "pr",
      changedFiles: changedPath,
      continueOnError: true
    });
    const pipeline = await readJson<typeof result.report>(path.join(tempRoot, ".visual-hive", "pipeline.json"));
    const report = await readJson<Report>(path.join(tempRoot, ".visual-hive", "report.json"));

    expect(result.exitCode).toBe(0);
    expect(pipeline.status).toBe("passed");
    expect(pipeline.steps.map((step) => step.id)).toEqual(
      expect.arrayContaining(["doctor", "plan", "run", "baselines", "coverage", "readiness", "triage", "report", "history", "artifacts"])
    );
    expect(pipeline.artifacts).toContain(".visual-hive/pipeline.json");
    expect(report.noContractsReason).toContain("selection.ignoreChangedFiles");
    await expect(access(path.join(tempRoot, ".visual-hive", "artifacts-index.json"))).resolves.toBeUndefined();
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
    const failureWorkflow = await readFile(path.join(tempRoot, ".github", "workflows", "visual-hive-failure-issue.yml"), "utf8");
    expect(prWorkflow).toContain("include-hidden-files: true");
    expect(prWorkflow).toContain("DavidDiaz0317/visual-hive/actions/run@main");
    expect(prWorkflow).toContain("command: pipeline");
    expect(prWorkflow).toContain("arguments: --mode pr --base origin/main --ci --github-step-summary");
    expect(prWorkflow).not.toContain("npx visual-hive");
    expect(scheduledWorkflow).toContain("include-hidden-files: true");
    expect(scheduledWorkflow).toContain("DavidDiaz0317/visual-hive/actions/run@main");
    expect(scheduledWorkflow).toContain("command: pipeline");
    expect(scheduledWorkflow).toContain("arguments: --mode schedule --ci --enforce-mutation --github-step-summary");
    expect(scheduledWorkflow).not.toContain("npx visual-hive");
    expect(failureWorkflow).toContain("function walkArtifacts");
    expect(failureWorkflow).toContain("function findIssueBody");
    expect(failureWorkflow).toContain("redactSecretValues");
    expect(failureWorkflow).toContain("client_secret");
    expect(failureWorkflow).toContain("visual-hive-dedupe");
    expect(failureWorkflow).not.toContain("context.payload.workflow_run.id + \" -->\"");
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
          schemaVersion: 1,
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
    expect(formatBaselineList(list)).toContain("Pending review: 1");

    const approval = await runBaselineApproveCommand({ cwd: tempRoot, contractId: "dashboard", screenshotName: "desktop" });
    expect(formatBaselineApproval(approval)).toContain("Approved baseline dashboard/desktop");
    await expect(readFile(baselinePath, "utf8")).resolves.toBe("actual");

    await writeFile(actualPath, "rejected-actual", "utf8");
    const rejection = await runBaselineRejectCommand({
      cwd: tempRoot,
      contractId: "dashboard",
      screenshotName: "desktop",
      reason: "Needs design review"
    });
    expect(formatBaselineRejection(rejection)).toContain("Rejected baseline dashboard/desktop");
    expect(formatBaselineRejection(rejection)).toContain("Needs design review");
    await expect(readFile(baselinePath, "utf8")).resolves.toBe("actual");
    const listedAfterReject = await runBaselineListCommand({ cwd: tempRoot });
    expect(listedAfterReject.entries[0]?.rejectedAt).toBeTruthy();
    expect(listedAfterReject.summary.rejected).toBe(1);

    const written = await runBaselineListCommand({ cwd: tempRoot, write: true });
    expect(written.baselineReportPath).toContain("baselines.json");
    expect(formatBaselineList(written)).toContain("Wrote");
    await expect(readFile(path.join(tempRoot, ".visual-hive", "baselines.json"), "utf8")).resolves.toContain('"rejected": 1');
    expect(formatBaselineList(written, "json")).toContain('"pendingReview"');
  });

  it("triage writes issue, prompt, repair, missing-test, and baseline-review artifacts", async () => {
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
          errors: ["Expected selector to exist", "Authorization: Bearer secret-value"],
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
    await writeJson(path.join(tempRoot, ".visual-hive", "provider-results.json"), {
      schemaVersion: 1,
      project: "cli-triage",
      generatedAt: "2026-06-15T00:00:00.000Z",
      deterministicStatus: "failed",
      artifactCount: 1,
      providers: [
        {
          providerId: "argos",
          label: "Argos",
          enabled: true,
          mode: "external",
          availability: "missing_credentials",
          deterministicRole: "supplemental",
          operations: [
            {
              operation: "availability",
              status: "failed",
              message: "Missing credential environment variable names: ARGOS_TOKEN"
            }
          ],
          result: {
            providerId: "argos",
            label: "Argos",
            status: "missing_credentials",
            deterministicRole: "supplemental",
            message: "Provider enabled but missing credential names: ARGOS_TOKEN",
            requiredEnv: ["ARGOS_TOKEN"],
            missingEnv: ["ARGOS_TOKEN"],
            artifactCount: 1,
            normalizedAt: "2026-06-15T00:00:00.000Z"
          },
          normalized: {
            providerId: "argos",
            category: "hosted-visual",
            status: "missing_credentials",
            deterministicRole: "supplemental",
            networkMode: "missing_credentials",
            externalCallsMade: 0,
            artifactSummary: {
              localArtifacts: 1,
              uploadedArtifacts: 0,
              comparedArtifacts: 0,
              uploadMode: "blocked"
            },
            costPolicy: {
              externalUploadAllowed: false,
              blockedReasons: [],
              estimatedExternalScreenshots: 1,
              maxExternalScreenshotsPerRun: 0,
              maxMonthlyExternalScreenshots: 5000
            },
            hostedVisual: {
              provider: "argos",
              reviewUrl: "https://app.argos-ci.com/review?token=secret-value",
              baselinePolicy: "provider-owned-future"
            },
            notes: ["Missing credential names: ARGOS_TOKEN"]
          },
          artifacts: [".visual-hive/artifacts/screenshots/dashboard.png?token=secret-value"],
          missingEnv: ["ARGOS_TOKEN"],
          warnings: ["Argos is enabled but missing credential names: ARGOS_TOKEN"]
        }
      ],
      summary: {
        providerCount: 1,
        enabledProviders: 1,
        mockProviders: 0,
        missingCredentialProviders: 1,
        externalDeferredProviders: 0,
        skippedProviders: 0,
        failedProviders: 1
      },
      warnings: ["Argos is enabled but missing credential names: ARGOS_TOKEN"]
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
    await writeJson(path.join(tempRoot, ".visual-hive", "readiness.json"), {
      schemaVersion: 1,
      project: "cli-triage",
      generatedAt: "2026-06-15T00:00:00.000Z",
      status: "blocked",
      score: 58,
      summary: {
        total: 3,
        passed: 1,
        warnings: 1,
        blocked: 1,
        missing: 0
      },
      inputs: {
        plan: true,
        report: true,
        mutationReport: true,
        baselines: true,
        workflowAudit: true,
        securityAudit: false,
        costAudit: false
      },
      gates: [
        {
          id: "workflow:unsafe",
          category: "workflow",
          status: "blocked",
          title: "Workflow safety has high-risk findings",
          message: "PR workflow references token=secret-value",
          evidence: ["token=secret-value"],
          artifacts: [".visual-hive/workflows.json"],
          nextActions: ["Fix workflow before enabling CI."]
        }
      ],
      nextActions: ["Fix workflow before enabling CI."]
    });
    await writeJson(path.join(tempRoot, ".visual-hive", "baseline-rejections.json"), {
      schemaVersion: 1,
      project: "cli-triage",
      generatedAt: "2026-06-15T00:00:00.000Z",
      rejections: [
        {
          contractId: "dashboard",
          screenshotName: "desktop",
          route: "/",
          viewport: "desktop",
          rejectedAt: "2026-06-15T00:01:00.000Z",
          sourceStatus: "failed",
          baselinePath: ".visual-hive/snapshots/dashboard.png",
          actualPath: ".visual-hive/artifacts/screenshots/dashboard.png",
          reason: "token=secret-value"
        }
      ]
    });

    const result = await runTriageCommand({ cwd: tempRoot });

    const triageReport = await readJson<{
      schemaVersion: 1;
      sourceArtifacts: { providerResults?: string };
      summary: { findingCount: number; classifications: Record<string, number> };
      findings: Array<{ classification: string; evidence: string[]; suggestedFiles?: string[]; suggestedNextTests: string[] }>;
    }>(result.triageReportPath);
    expect(triageReport.schemaVersion).toBe(1);
    expect(triageReport.summary.findingCount).toBeGreaterThan(0);
    expect(triageReport.summary.classifications.missing_element).toBe(1);
    expect(triageReport.summary.classifications.provider_failure).toBe(1);
    expect(triageReport.sourceArtifacts.providerResults).toBe(".visual-hive/provider-results.json");
    expect(triageReport.findings[0]?.suggestedFiles).toContain("src/App.tsx");
    expect(JSON.stringify(triageReport)).not.toContain("secret-value");
    expect(JSON.stringify(triageReport)).toContain("[REDACTED]");
    await expect(readFile(result.promptPath, "utf8")).resolves.toContain("Visual failure triage");
    await expect(readFile(result.promptPath, "utf8")).resolves.toContain("Coverage report JSON");
    await expect(readFile(result.promptPath, "utf8")).resolves.toContain("Provider adapter results JSON");
    await expect(readFile(result.repairPromptPath, "utf8")).resolves.toContain("Repair prompt");
    await expect(readFile(result.missingTestsPath, "utf8")).resolves.toContain("Mutation survived: api-500");
    await expect(readFile(result.missingTestsPath, "utf8")).resolves.toContain("changed_file_without_rule");
    await expect(readFile(result.baselineReviewPath, "utf8")).resolves.toContain("Baseline Review Summary");
    await expect(readFile(result.baselineReviewPath, "utf8")).resolves.toContain("[REDACTED]");
    await expect(readFile(result.prCommentPath, "utf8")).resolves.toContain("## Visual Hive report");
    await expect(readFile(result.prCommentPath, "utf8")).resolves.toContain("Workflow safety findings: 1");
    await expect(readFile(result.prCommentPath, "utf8")).resolves.toContain("Provider adapter evidence: 1 providers");
    await expect(readFile(result.prCommentPath, "utf8")).resolves.toContain("Readiness: blocked (58/100");
    const issue = await readFile(result.issuePath, "utf8");
    expect(issue).toContain("dashboard");
    expect(issue).toContain("Workflow safety");
    expect(issue).toContain("Readiness gate");
    expect(issue).toContain("Status: blocked");
    expect(issue).toContain("Provider adapter evidence");
    expect(issue).toContain("Argos");
    expect(issue).toContain("high/pr_secrets");
    expect(issue).not.toContain("secret-value");
    const llmUsage = await readJson<{ summary: { callsMade: number; promptOnly: boolean }; records: Array<{ task: string }> }>(result.llmUsagePath);
    expect(llmUsage.summary).toMatchObject({ callsMade: 0, promptOnly: true });
    expect(llmUsage.records.map((record) => record.task)).toContain("repair_prompt");
    expect(llmUsage.records.map((record) => record.task)).toContain("baseline_review_summary");

    const llmResult = await runLLMCommand({ cwd: tempRoot });
    const llmSummary = formatLLMUsage(llmResult);
    expect(llmResult.promptArtifactCount).toBe(5);
    expect(llmResult.report.summary.callsMade).toBe(0);
    expect(llmResult.report.summary.promptOnly).toBe(true);
    expect(llmResult.report.records.map((record) => record.task)).toEqual([
      "visual_failure_triage",
      "repair_prompt",
      "missing_tests",
      "baseline_review_summary",
      "issue_draft"
    ]);
    expect(llmSummary).toContain("LLM Governance: cli-triage");
    expect(llmSummary).toContain("External LLM calls made: 0");
    expect(llmSummary).not.toContain("secret-value");

    const riskResult = await runRiskCommand({ cwd: tempRoot });
    const riskSummary = formatRiskRegister(riskResult.report, riskResult.reportPath);
    expect(riskResult.report.summary.total).toBeGreaterThan(0);
    expect(riskResult.report.risks.map((risk) => risk.category)).toEqual(
      expect.arrayContaining(["deterministic_failure", "mutation_adequacy", "coverage_gap", "flow_coverage", "workflow_safety"])
    );
    expect(riskResult.report.inputs.flowAudit).toBe(true);
    expect(JSON.stringify(riskResult.report)).not.toContain("secret-value");
    expect(JSON.stringify(riskResult.report)).toContain("[REDACTED]");
    expect(riskSummary).toContain("Risk Register: cli-triage");
    await expect(readFile(path.join(tempRoot, ".visual-hive", "risk.json"), "utf8")).resolves.toContain("flow_coverage");
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

  it("records provider governance decisions from the CLI without external calls", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-cli-provider-decision-"));
    tempDirs.push(tempRoot);
    await writeFile(
      path.join(tempRoot, "visual-hive.config.yaml"),
      `project:
  name: provider-decision
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
    enabled: false
`,
      "utf8"
    );

    const result = await runProviderDecisionCommand({
      cwd: tempRoot,
      providerId: "argos",
      decision: "skip",
      reason: "No hosted review yet; token=secret-value"
    });
    const summary = formatProviderDecision(result);
    const written = await readJson<{ decisions: Array<{ providerId: string; reason: string; externalCallsMade: number }> }>(
      path.join(tempRoot, ".visual-hive", "provider-decisions.json")
    );

    expect(result.decisionPath).toBe(".visual-hive/provider-decisions.json");
    expect(result.decision.externalCallsMade).toBe(0);
    expect(result.decision.reason).toContain("[REDACTED]");
    expect(result.decision.reason).not.toContain("secret-value");
    expect(written.decisions[0]).toMatchObject({ providerId: "argos", externalCallsMade: 0 });
    expect(written.decisions[0]?.reason).not.toContain("secret-value");
    expect(summary).toContain("Provider Decision");
    expect(summary).toContain("does not enable credentials");
    expect(summary).not.toContain("secret-value");

    const risk = await runRiskCommand({ cwd: tempRoot });
    expect(risk.report.inputs.providerDecisions).toBe(true);
    expect(risk.report.risks.find((item) => item.id === "provider-decision:argos")).toMatchObject({
      category: "provider_policy",
      trustedOnly: true
    });

    const readiness = await runReadinessCommand({ cwd: tempRoot });
    expect(readiness.report.inputs.providerDecisions).toBe(true);
    expect(readiness.report.gates.find((gate) => gate.id === "provider:decisions-recorded")).toMatchObject({
      category: "provider",
      status: "passed"
    });

    await expect(
      runProviderDecisionCommand({ cwd: tempRoot, providerId: "not-real", decision: "skip" })
    ).rejects.toThrow(/Unknown provider/);
  });

  it("writes setup progress from CLI artifacts", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-cli-setup-status-"));
    tempDirs.push(tempRoot);
    await writeFile(
      path.join(tempRoot, "visual-hive.config.yaml"),
      `project:
  name: setup-status
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
`
    );
    const plan = await runPlanCommand({ cwd: tempRoot, mode: "pr", changedFiles: undefined });
    const report: Report = {
      schemaVersion: 2,
      project: "setup-status",
      repository: sampleRepository,
      mode: "pr",
      generatedAt: "2026-06-15T00:00:00.000Z",
      status: "passed",
      changedFiles: [],
      selectedTargets: [{ id: "local", kind: "url", url: "http://127.0.0.1:4173", prSafe: true, cost: "cheap" }],
      selectedContracts: ["dashboard"],
      excludedContracts: [],
      targetLifecycle: [],
      generatedSpecPath: ".visual-hive/generated/visual-hive.generated.spec.ts",
      results: [
        {
          contractId: "dashboard",
          targetId: "local",
          status: "passed",
          durationMs: 10,
          errors: [],
          artifacts: [".visual-hive/artifacts/results/dashboard.json"],
          selectorAssertions: [],
          screenshotAssertions: [],
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
      artifacts: [".visual-hive/report.json"],
      reproductionCommands: ["visual-hive run"]
    };
    await writeJson(path.join(tempRoot, ".visual-hive", "report.json"), report);

    const result = await runSetupStatusCommand({ cwd: tempRoot });
    const summary = formatSetupProgress(result.report, result.reportPath);
    const written = await readJson<{ schemaVersion: number; project: string; steps: Array<{ id: string; status: string }> }>(result.reportPath);

    expect(plan.items.map((item) => item.contractId)).toContain("dashboard");
    expect(result.reportPath).toBe(path.join(tempRoot, ".visual-hive", "setup-progress.json"));
    expect(result.report.project).toBe("setup-status");
    expect(result.report.steps.find((step) => step.id === "config")?.status).toBe("complete");
    expect(result.report.steps.find((step) => step.id === "run")?.status).toBe("complete");
    expect(result.report.nextStep?.command).toBe("visual-hive mutate");
    expect(summary).toContain("Setup Progress: setup-status");
    expect(summary).toContain("Next Best Action");
    expect(written.schemaVersion).toBe(1);
    expect(written.steps.map((step) => step.id)).toContain("mutation");
  });

  it("writes runbook guidance from the CLI", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-cli-runbook-"));
    tempDirs.push(tempRoot);
    await writeFile(
      path.join(tempRoot, "visual-hive.config.yaml"),
      `project:
  name: runbook-demo
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
`
    );

    const result = await runRunbookCommand({ cwd: tempRoot });
    const summary = formatRunbookReport(result);
    const written = await readJson<{ schemaVersion: number; runbook: { commands: Array<{ id: string }> }; profiles: Array<{ id: string }> }>(
      result.reportPath
    );

    expect(result.reportPath).toBe(path.join(tempRoot, ".visual-hive", "runbook.json"));
    expect(result.report.runbook.commands.map((command) => command.id)).toContain("plan-pr");
    expect(result.report.profiles.map((profile) => profile.id)).toContain("pr-acceptance");
    expect(summary).toContain("Visual Hive Runbook");
    expect(summary).toContain("PR acceptance");
    expect(written.schemaVersion).toBe(1);
    expect(written.runbook.commands.map((command) => command.id)).toContain("run-ci");
  });

  it("executes allowlisted runbook commands through the CLI with sanitized audit output", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-cli-runbook-execute-"));
    tempDirs.push(tempRoot);
    await writeFile(
      path.join(tempRoot, "visual-hive.config.yaml"),
      `project:
  name: runbook-execute
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
`
    );

    const result = await runRunbookCommand({
      cwd: tempRoot,
      executeCommand: "doctor",
      commandRunner: async (input) => ({
        exitCode: 0,
        stdout: `ran ${input.stepId} token=secret-value`,
        stderr: ""
      })
    });
    const summary = formatRunbookReport(result);
    const actionHistory = await readFile(path.join(tempRoot, ".visual-hive", "control-plane-actions.json"), "utf8");

    expect(result.report.execution).toMatchObject({ status: "passed", commandId: "doctor" });
    expect(summary).toContain("Execution");
    expect(summary).toContain("Status: passed");
    expect(actionHistory).toContain("doctor");
    expect(actionHistory).toContain("[REDACTED]");
    expect(actionHistory).not.toContain("secret-value");
  });

  it("writes provider setup plans from the CLI without enabling external calls", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-cli-provider-plan-"));
    tempDirs.push(tempRoot);
    await writeFile(
      path.join(tempRoot, "visual-hive.config.yaml"),
      `project:
  name: provider-plan
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
    projectId: "visual-hive/demo"
`,
      "utf8"
    );

    const result = await runProviderSetupPlanCommand({ cwd: tempRoot, providerId: "argos" });
    const written = await readJson<typeof result.plan>(result.planPath);
    const summary = formatProviderSetupPlan(result);

    expect(result.planPath).toBe(path.join(tempRoot, ".visual-hive", "provider-setup-plan.json"));
    expect(written).toMatchObject({
      providerId: "argos",
      label: "Argos",
      authorizationRequired: true,
      externalCallsMade: 0
    });
    expect(summary).toContain("Provider Setup Plan: Argos");
    expect(summary).toContain("External calls made: 0");
    expect(summary).toContain("visual-hive providers list --mock-results");
    expect(summary).not.toContain("secret");
    await expect(access(path.join(tempRoot, ".visual-hive", "provider-setup-plan.json"))).resolves.toBeUndefined();

    const risk = await runRiskCommand({ cwd: tempRoot });
    expect(risk.report.inputs.providerSetupPlan).toBe(true);
    expect(risk.report.risks.find((item) => item.id === "provider-setup-plan:argos")).toMatchObject({
      category: "provider_policy",
      trustedOnly: true
    });

    const readiness = await runReadinessCommand({ cwd: tempRoot });
    expect(readiness.report.inputs.providerSetupPlan).toBe(true);
    expect(readiness.report.gates.find((gate) => gate.id === "provider:external-enabled")?.artifacts).toContain(
      ".visual-hive/provider-setup-plan.json"
    );
  });

  it("writes provider handoff manifests from deterministic reports without external calls", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-cli-provider-handoff-"));
    tempDirs.push(tempRoot);
    await writeFile(
      path.join(tempRoot, "visual-hive.config.yaml"),
      `project:
  name: provider-handoff
targets:
  local:
    kind: url
    url: "http://127.0.0.1:4173"
contracts:
  - id: dashboard
    description: Dashboard
    target: local
    severity: critical
providers:
  argos:
    enabled: true
    mode: mock
`
    );
    const report: Report = {
      schemaVersion: 2,
      project: "provider-handoff",
      repository: sampleRepository,
      mode: "manual",
      generatedAt: "2026-06-15T00:00:00.000Z",
      status: "failed",
      changedFiles: [],
      selectedTargets: [{ id: "local", kind: "url", url: "http://127.0.0.1:4173", prSafe: true, cost: "cheap" }],
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
          artifacts: [".visual-hive/artifacts/screenshots/dashboard.png"],
          screenshotAssertions: [
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
              actualDiffPixelRatio: 0.2,
              actualDiffPixels: 20,
              totalPixels: 100
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
      artifacts: [".visual-hive/artifacts/screenshots/dashboard.png"],
      reproductionCommands: ["visual-hive run --ci"]
    };
    await writeJson(path.join(tempRoot, ".visual-hive", "report.json"), report);

    const result = await runProviderHandoffCommand({ cwd: tempRoot, providerId: "argos" });
    const written = await readJson<typeof result.manifest>(result.manifestPath);
    const summary = formatProviderHandoff(result);

    expect(result.manifestPath).toBe(path.join(tempRoot, ".visual-hive", "provider-handoff.json"));
    expect(written).toMatchObject({
      providerId: "argos",
      label: "Argos",
      status: "review",
      externalCallsMade: 0,
      summary: {
        screenshotArtifacts: 1,
        diffArtifacts: 1
      }
    });
    expect(written.artifacts.map((artifact) => artifact.kind)).toEqual([
      "actual_screenshot",
      "diff_screenshot",
      "baseline_screenshot",
      "generated_spec",
      "deterministic_report"
    ]);
    expect(summary).toContain("Provider Handoff: Argos");
    expect(summary).toContain("External calls made: 0");
    expect(summary).toContain("dashboard.diff.png");

    const risk = await runRiskCommand({ cwd: tempRoot });
    expect(risk.report.inputs.providerHandoff).toBe(true);
    expect(risk.report.risks.find((item) => item.id === "provider-handoff:argos")).toMatchObject({
      category: "provider_policy",
      trustedOnly: true
    });

    const readiness = await runReadinessCommand({ cwd: tempRoot });
    expect(readiness.report.inputs.providerHandoff).toBe(true);
    expect(readiness.report.gates.find((gate) => gate.id === "provider:handoff-recorded")).toMatchObject({
      category: "provider",
      status: "passed"
    });

    const setupStatus = await runSetupStatusCommand({ cwd: tempRoot });
    const providerStep = setupStatus.report.steps.find((step) => step.id === "provider-governance");
    expect(providerStep).toMatchObject({
      status: "complete",
      command: "visual-hive providers list --mock-results"
    });
    expect(providerStep?.evidence.join(" ")).toContain("handoff=argos:review");
  });

  it("writes Argos provider upload dry-run artifacts without external calls", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-cli-provider-upload-"));
    tempDirs.push(tempRoot);
    await mkdir(path.join(tempRoot, ".visual-hive", "artifacts", "screenshots"), { recursive: true });
    await writeFile(path.join(tempRoot, ".visual-hive", "artifacts", "screenshots", "dashboard.png"), "fake screenshot", "utf8");
    await writeFile(
      path.join(tempRoot, "visual-hive.config.yaml"),
      `project:
  name: provider-upload
targets:
  local:
    kind: url
    url: "http://127.0.0.1:4173"
contracts:
  - id: dashboard
    description: Dashboard
    target: local
    severity: critical
    screenshots:
      - name: desktop
        route: /
        viewport: desktop
providers:
  argos:
    enabled: true
    upload:
      includeTextArtifacts: true
costPolicy:
  maxExternalScreenshotsPerRun: 10
  externalUpload:
    manual: true
    onFailureOnly: false
    criticalContractsOnly: false
`,
      "utf8"
    );
    await writeJson(path.join(tempRoot, ".visual-hive", "report.json"), {
      schemaVersion: 2,
      project: "provider-upload",
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
          errors: [],
          artifacts: [".visual-hive/artifacts/screenshots/dashboard.png"],
          screenshotAssertions: [
            {
              contractId: "dashboard",
              screenshotName: "desktop",
              name: "desktop",
              route: "/",
              viewport: "desktop",
              status: "failed",
              baselinePath: ".visual-hive/snapshots/dashboard.png",
              actualPath: ".visual-hive/artifacts/screenshots/dashboard.png",
              maxDiffPixelRatio: 0.01,
              actualDiffPixelRatio: 0.2,
              actualDiffPixels: 20,
              totalPixels: 100
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
      artifacts: [".visual-hive/artifacts/screenshots/dashboard.png"],
      reproductionCommands: ["visual-hive run --ci"]
    } satisfies Report);
    let calls = 0;

    const result = await runProviderUploadCommand(
      { cwd: tempRoot, providerId: "argos", dryRun: true },
      async () => {
        calls += 1;
        return { exitCode: 0, stdout: "", stderr: "" };
      }
    );
    const summary = formatProviderUpload(result);
    const manifest = await readJson<typeof result.manifest>(result.manifestPath);
    const providerResults = await readJson<typeof result.providerResults>(result.providerResultsPath);

    expect(result.exitCode).toBe(0);
    expect(calls).toBe(0);
    expect(manifest.status).toBe("dry_run");
    expect(manifest.summary.stagedArtifacts).toBe(2);
    expect(providerResults.providers.find((provider) => provider.providerId === "argos")?.result.upload).toMatchObject({
      status: "dry_run",
      externalCallsMade: 0
    });
    expect(summary).toContain("Provider Upload: Argos");
    expect(summary).toContain("External calls made: 0");
    await expect(access(path.join(tempRoot, ".visual-hive", "provider-upload", "argos", "manifest.json"))).resolves.toBeUndefined();
  });

  it("records LLM governance decisions from the CLI without model calls", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-cli-llm-decision-"));
    tempDirs.push(tempRoot);
    await writeFile(
      path.join(tempRoot, "visual-hive.config.yaml"),
      `project:
  name: llm-decision
targets:
  local:
    kind: url
    url: "http://127.0.0.1:4173"
contracts:
  - id: dashboard
    description: Dashboard
    target: local
ai:
  enabled: false
  provider: none
`,
      "utf8"
    );

    const result = await runLLMDecisionCommand({
      cwd: tempRoot,
      decision: "keep_disabled",
      reason: "No model calls for PRs; authorization: Bearer secret-value"
    });
    const summary = formatLLMDecision(result);
    const written = await readJson<{ decisions: Array<{ decision: string; reason: string; externalCallsMade: number }> }>(
      path.join(tempRoot, ".visual-hive", "llm-decisions.json")
    );

    expect(result.decisionPath).toBe(".visual-hive/llm-decisions.json");
    expect(result.decision.externalCallsMade).toBe(0);
    expect(result.decision.reason).toContain("[REDACTED]");
    expect(result.decision.reason).not.toContain("secret-value");
    expect(written.decisions[0]).toMatchObject({ decision: "keep_disabled", externalCallsMade: 0 });
    expect(summary).toContain("LLM Decision");
    expect(summary).toContain("does not enable API keys");
    expect(summary).not.toContain("secret-value");

    const risk = await runRiskCommand({ cwd: tempRoot });
    expect(risk.report.inputs.llmDecisions).toBe(true);
    expect(risk.report.risks.find((item) => item.id === "llm-decision:latest")).toMatchObject({
      category: "llm_governance",
      trustedOnly: true
    });

    const readiness = await runReadinessCommand({ cwd: tempRoot });
    expect(readiness.report.inputs.llmDecisions).toBe(true);
    expect(readiness.report.gates.find((gate) => gate.id === "llm:decisions-recorded")).toMatchObject({
      category: "llm",
      status: "passed"
    });

    await expect(
      runLLMDecisionCommand({ cwd: tempRoot, decision: "call_openai_now" as never })
    ).rejects.toThrow(/Invalid LLM decision/);
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
    }, undefined, {
      schemaVersion: 1,
      project: "provider-report",
      generatedAt: "2026-06-15T00:00:00.000Z",
      status: "attention",
      score: 84,
      summary: { total: 2, passed: 1, warnings: 1, blocked: 0, missing: 0 },
      inputs: {
        plan: true,
        report: true,
        mutationReport: false,
        baselines: true,
        workflowAudit: true,
        securityAudit: true,
        costAudit: true
      },
      gates: [
        {
          id: "cost:policy",
          category: "cost",
          status: "warning",
          title: "Cost policy needs review",
          message: "Budget status is blocked.",
          evidence: [],
          artifacts: [".visual-hive/costs.json"],
          nextActions: ["Review cost policy."]
        }
      ],
      nextActions: ["Review cost policy."]
    });

    expect(output).toContain("Providers: Playwright built-in=passed");
    expect(output).toContain("### Provider Results");
    expect(output).toContain("Readiness: attention (84/100)");
    expect(output).toContain("### Readiness Gate");
    expect(output).toContain("Cost policy needs review");
  });

  it("writes a readiness gate artifact from current evidence", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-readiness-"));
    tempDirs.push(tempRoot);
    await mkdir(path.join(tempRoot, ".visual-hive"), { recursive: true });
    await writeFile(
      path.join(tempRoot, "visual-hive.config.yaml"),
      `project:
  name: readiness-fixture
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
`,
      "utf8"
    );
    await writeJson(path.join(tempRoot, ".visual-hive", "plan.json"), {
      schemaVersion: 1,
      project: "readiness-fixture",
      mode: "pr",
      generatedAt: "2026-06-15T00:00:00.000Z",
      changedFiles: ["src/App.tsx"],
      effectiveChangedFiles: ["src/App.tsx"],
      ignoredChangedFiles: [],
      targets: [{ id: "local", kind: "url", url: "http://127.0.0.1:4173", prSafe: true, cost: "medium" }],
      items: [
        {
          contractId: "home",
          targetId: "local",
          targetUrl: "http://127.0.0.1:4173",
          severity: "medium",
          cost: "medium",
          reasons: ["runOn.pullRequest=true"],
          screenshots: []
        }
      ],
      excluded: [],
      mutation: { enabled: false, operators: [], minScore: 0.7, reasons: [] },
      providerPolicy: []
    });
    await writeJson(path.join(tempRoot, ".visual-hive", "report.json"), {
      schemaVersion: 2,
      project: "readiness-fixture",
      repository: sampleRepository,
      mode: "pr",
      generatedAt: "2026-06-15T00:00:00.000Z",
      status: "passed",
      changedFiles: ["src/App.tsx"],
      selectedTargets: [{ id: "local", kind: "url", url: "http://127.0.0.1:4173", prSafe: true, cost: "medium" }],
      selectedContracts: ["home"],
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
      reproductionCommands: ["visual-hive run --ci"]
    });

    const result = await runReadinessCommand({ config: path.join(tempRoot, "visual-hive.config.yaml"), cwd: tempRoot });
    const written = await readJson<typeof result.report>(result.reportPath);
    const summary = formatReadinessReport(result.report, result.reportPath);

    expect(written.project).toBe("readiness-fixture");
    expect(written.gates.map((gate) => gate.id)).toContain("deterministic:status");
    expect(summary).toContain("Readiness Gate: readiness-fixture");
    await expect(access(path.join(tempRoot, ".visual-hive", "readiness.json"))).resolves.toBeUndefined();
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

  it("restores the deterministic report after mutation runs", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-mutate-restore-"));
    tempDirs.push(tempRoot);
    const configPath = path.join(tempRoot, "visual-hive.config.yaml");
    await writeFile(
      configPath,
      `project:
  name: mutate-restore
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
        - "[data-testid='critical-action-button']"
mutation:
  enabled: true
  operators:
    - hide-critical-button
`,
      "utf8"
    );
    const plan: Plan = {
      schemaVersion: 1,
      project: "mutate-restore",
      mode: "pr",
      generatedAt: "2026-01-01T00:00:00.000Z",
      changedFiles: ["src/App.tsx"],
      effectiveChangedFiles: ["src/App.tsx"],
      ignoredChangedFiles: [],
      targets: [{ id: "local", kind: "url", url: "http://127.0.0.1:4173", prSafe: true, cost: "cheap" }],
      items: [
        {
          contractId: "home",
          targetId: "local",
          targetUrl: "http://127.0.0.1:4173",
          severity: "medium",
          cost: "cheap",
          reasons: ["test"],
          screenshots: []
        }
      ],
      excluded: [],
      mutation: { enabled: true, operators: ["hide-critical-button"], minScore: 0.7, reasons: ["test"] },
      providerPolicy: []
    };
    await writeJson(path.join(tempRoot, ".visual-hive", "plan.json"), plan);
    const deterministicReport: Report = {
      schemaVersion: 2,
      project: "mutate-restore",
      repository: sampleRepository,
      mode: "pr",
      generatedAt: "2026-01-01T00:00:00.000Z",
      status: "passed",
      changedFiles: ["src/App.tsx"],
      selectedTargets: [{ id: "local", kind: "url", url: "http://127.0.0.1:4173", prSafe: true, cost: "cheap" }],
      selectedContracts: ["home"],
      excludedContracts: [],
      targetLifecycle: [],
      generatedSpecPath: ".visual-hive/generated/visual-hive.generated.spec.ts",
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
      reproductionCommands: ["visual-hive run"],
      results: [
        {
          contractId: "home",
          targetId: "local",
          status: "passed",
          durationMs: 5,
          errors: [],
          artifacts: [],
          reproductionCommand: "visual-hive run --ci"
        }
      ]
    };
    const mutatedReport: Report = {
      ...deterministicReport,
      status: "failed",
      summary: { ...deterministicReport.summary, passed: 0, failed: 1 },
      results: [{ ...deterministicReport.results[0]!, status: "failed", errors: ["mutation killed"] }]
    };
    await writeJson(path.join(tempRoot, ".visual-hive", "report.json"), deterministicReport);

    await runMutateCommand({
      config: configPath,
      cwd: tempRoot,
      runner: async () => {
        await writeJson(path.join(tempRoot, ".visual-hive", "report.json"), mutatedReport);
        return { report: mutatedReport, exitCode: 1 };
      }
    });

    const restored = await readJson<Report>(path.join(tempRoot, ".visual-hive", "report.json"));
    expect(restored.status).toBe("passed");
    expect(restored.results[0]?.errors).toEqual([]);
    await expect(readJson(path.join(tempRoot, ".visual-hive", "mutation-report.json"))).resolves.toMatchObject({ score: 1 });
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
      effectiveChangedFiles: [],
      ignoredChangedFiles: [],
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
      mutation: { enabled: true, operators: ["remove-demo-badge"], minScore: 0.9, reasons: ["test"] },
      providerPolicy: []
    };
    const planPath = path.join(tempRoot, "plan.json");
    await writeJson(planPath, plan);

    const result = await runMutateCommand({ config: configPath, cwd: tempRoot, plan: planPath, enforceMinScore: true });

    expect(result.exitCode).toBe(1);
    expect(result.report.results[0]?.status).toBe("not_applicable");
    expect(result.report.total).toBe(0);
  });
});
