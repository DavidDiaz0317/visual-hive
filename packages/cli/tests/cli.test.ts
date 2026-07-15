import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import Ajv2020 from "ajv/dist/2020.js";
import { afterEach, describe, expect, it } from "vitest";
import { VISUAL_HIVE_EVIDENCE_RESOURCES, loadConfig, readJson, writeJson, type MockProviderRunReport, type Plan, type Report } from "@visual-hive/core";
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
import { resolveWorkflowRoot } from "../src/commands/workflowAuditInput.js";
import { formatHistorySummary, runHistoryCommand } from "../src/commands/history.js";
import { formatArtifactsIndex, runArtifactsCommand } from "../src/commands/artifacts.js";
import { runEvidenceCommand } from "../src/commands/evidence.js";
import { formatLayersReport, runLayersCommand } from "../src/commands/layers.js";
import { formatVerdictReport, runVerdictCommand } from "../src/commands/verdict.js";
import { formatHandoffResult, formatHandoffValidation, runHandoffCommand, runHandoffValidateCommand } from "../src/commands/handoff.js";
import {
  formatIssuePublishResult,
  formatIssuesResult,
  formatSetupIssuePublishResult,
  runIssuePublishCommand,
  runIssuesCommand,
  runSetupIssuePublishCommand
} from "../src/commands/issues.js";
import {
  formatHiveExport,
  formatHiveBeads,
  formatHiveGuardedRepairPreview,
  formatHiveIntegrationSmoke,
  formatHiveModeComparison,
  formatHiveRepairRequestEnvelope,
  formatHiveSetupPack,
  formatHiveTrustedRepairConsumerSummary,
  formatHiveTrustedRepairWorkflowDryRun,
  formatHiveValidateExport,
  runHiveBeadsCommand,
  runHiveCompareModesCommand,
  runHiveExportCommand,
  runHiveGuardedRepairPreviewCommand,
  runHiveIntegrationSmokeCommand,
  runHiveRepairRequestEnvelopeCommand,
  runHiveSetupPackCommand,
  runHiveTrustedRepairConsumerSummaryCommand,
  runHiveTrustedRepairWorkflowDryRunCommand,
  runHiveValidateExportCommand
} from "../src/commands/hive.js";
import { runHiveBundleCommand } from "../src/commands/hiveBundle.js";
import { formatTestCreationPlan, runTestCreationPlanCommand } from "../src/commands/testCreationPlan.js";
import { formatAgentPacketResult, runAgentPacketCommand } from "../src/commands/agentPacket.js";
import { formatAgentIssueRunnerResult, runAgentIssueRunnerCommand } from "../src/commands/agentIssueRunner.js";
import { formatToolsRegistry, runToolsCommand } from "../src/commands/tools.js";
import { formatSchemasVerifyResult, runSchemasVerifyCommand } from "../src/commands/schemas.js";
import { formatContextLedger, runContextCommand } from "../src/commands/context.js";
import { callReadOnlyTool, createVisualHiveMcpServer, formatMcpManifest, readMcpResourceText, runMcpCommand } from "../src/commands/mcp.js";
import { formatLLMDecision, formatLLMUsage, runLLMCommand, runLLMDecisionCommand } from "../src/commands/llm.js";
import { formatRiskRegister, runRiskCommand } from "../src/commands/risk.js";
import { formatReadinessReport, runReadinessCommand } from "../src/commands/readiness.js";
import { formatSetupProgress, runSetupStatusCommand } from "../src/commands/setupStatus.js";
import { formatRunbookReport, runRunbookCommand } from "../src/commands/runbook.js";
import { formatSnapshotResult, runSnapshotCommand } from "../src/commands/snapshot.js";
import { formatSecurityAudit, runSecurityCommand } from "../src/commands/security.js";
import { formatCostsReport, runCostsCommand } from "../src/commands/costs.js";
import { formatAnalyzeSummary, runAnalyzeCommand } from "../src/commands/analyze.js";
import { formatGraphImpact, formatGraphSearch, runGraphImpactCommand, runGraphSearchCommand } from "../src/commands/graph.js";
import { formatSetupRecommendation, runRecommendCommand } from "../src/commands/recommend.js";
import { formatConnectionsIndex, runConnectionsAddCommand, runConnectionsListCommand, runConnectionsRemoveCommand } from "../src/commands/connections.js";
import { gitChangedFiles } from "../src/commands/gitChangedFiles.js";
import { renderMarkdownReport } from "../src/commands/report.js";

const tempDirs: string[] = [];
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const catalogPath = (id: string): string => {
  const resource = VISUAL_HIVE_EVIDENCE_RESOURCES.find((candidate) => candidate.id === id);
  if (!resource) throw new Error(`Missing test evidence resource fixture: ${id}`);
  return resource.relativePath;
};
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

async function expectMatchesSchema(schemaName: string, value: unknown): Promise<void> {
  const schema = JSON.parse(await readFile(path.join(repoRoot, "schemas", schemaName), "utf8")) as Record<string, unknown>;
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  const valid = validate(value);
  if (!valid) {
    throw new Error(`${schemaName} validation failed: ${ajv.errorsText(validate.errors, { separator: "\n" })}`);
  }
}

function markdownSection(markdown: string, heading: string, nextHeading: string): string {
  const start = markdown.indexOf(heading);
  const end = markdown.indexOf(nextHeading, start + heading.length);
  if (start === -1 || end === -1) {
    throw new Error(`Could not find markdown section ${heading}.`);
  }
  return markdown.slice(start, end);
}

function markdownCodeBullets(section: string, prefix: string): string[] {
  const values: string[] = [];
  for (const line of section.split(/\r?\n/)) {
    const match = line.match(/^- `([^`]+)`/);
    if (match?.[1]?.startsWith(prefix)) {
      values.push(match[1]);
    }
  }
  return values;
}

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await removeTempDir(dir);
  }
});

async function removeTempDir(dir: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await rm(dir, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  throw lastError;
}

describe("CLI commands", () => {
  it("requires release identity for hosted authority while preserving local v2 bundles", async () => {
    const previousEventName = process.env.GITHUB_EVENT_NAME;
    const previousRunId = process.env.GITHUB_RUN_ID;
    const previousRunAttempt = process.env.GITHUB_RUN_ATTEMPT;
    const previousArtifactId = process.env.VISUAL_HIVE_WORKFLOW_ARTIFACT_ID;
    const previousNpmPackageVersion = process.env.npm_package_version;
    process.env.GITHUB_EVENT_NAME = "workflow_dispatch";
    process.env.GITHUB_RUN_ID = "1001";
    process.env.GITHUB_RUN_ATTEMPT = "1";
    process.env.VISUAL_HIVE_WORKFLOW_ARTIFACT_ID = "9001";
    process.env.npm_package_version = "99.99.99-consumer";
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-cli-bundle-authority-"));
    tempDirs.push(tempRoot);
    await writeFile(
      path.join(tempRoot, "visual-hive.config.yaml"),
      `project:
  name: explicit-bundle-authority
targets:
  local:
    kind: url
    url: "http://127.0.0.1:4173"
contracts:
  - id: shell
    description: Shell renders
    target: local
    runOn:
      pullRequest: true
`,
      "utf8"
    );
    const hiveDir = path.join(tempRoot, ".visual-hive", "hive");
    await mkdir(hiveDir, { recursive: true });
    await writeJson(path.join(hiveDir, "hive-export.json"), {
      project: "explicit-bundle-authority",
      mode: "measured",
      status: "ready",
      acmmLevel: 5,
      externalCallsMade: 0
    });
    await writeJson(path.join(hiveDir, "hive-import-manifest.json"), { status: "ready", sourceArtifacts: {} });
    await writeJson(path.join(hiveDir, "hive-validation-summary.json"), { status: "passed" });
    await writeJson(path.join(tempRoot, ".visual-hive", "issues.json"), { issues: [] });
    await writeJson(path.join(hiveDir, "hive-setup-pack.json"), { schemaVersion: "test" });
    await writeFile(path.join(hiveDir, "hive-setup-pack.md"), "# Setup pack\n", "utf8");
    await writeJson(path.join(tempRoot, ".visual-hive", "capability-parity.json"), {
      schemaVersion: "visual-hive.capability-parity.v1",
      baselineVersion: "visual-hive.capability-baseline.v1",
      generatedAt: "2026-07-09T12:00:00.000Z",
      status: "passed",
      runtimeStatus: "ready",
      summary: { expected: 1, actual: 1, present: 1, blocked: 0, missing: 0, unexpected: 0, mismatched: 0 },
      domains: ["cli", "schemas", "evidenceResources", "artifactSurfaces", "planModes", "workflowLanes", "mutationOperators", "deterministicPrimitives", "providers", "openSourceAdapters", "controlPlane"].map((domain) => ({
        domain,
        expected: domain === "cli" ? 1 : 0,
        actual: domain === "cli" ? 1 : 0,
        present: domain === "cli" ? 1 : 0,
        blocked: 0,
        missing: 0,
        unexpected: 0,
        mismatched: 0
      })),
      checks: [{ domain: "cli", key: "doctor", status: "present", parity: true, message: "CLI capability is present." }]
    });
    await runArtifactsCommand({ cwd: tempRoot, config: "visual-hive.config.yaml", complete: true });

    try {
      await expect(runHiveBundleCommand({ cwd: tempRoot, acmmRequest: 4, trustedSource: true }))
        .rejects.toThrow("installed clean release identity");

      process.env.GITHUB_EVENT_NAME = "local";
      delete process.env.GITHUB_RUN_ID;
      delete process.env.GITHUB_RUN_ATTEMPT;
      delete process.env.VISUAL_HIVE_WORKFLOW_ARTIFACT_ID;
      const local = await runHiveBundleCommand({
        cwd: tempRoot,
        acmmRequest: 4,
        trustedSource: true,
        outputDir: ".visual-hive/local-bundles"
      });
      expect(local.manifest.schemaVersion).toBe("visual-hive.bundle.v2");
      expect(local.manifest.source.trusted).toBe(true);
      expect(local.manifest.artifactIndex).toBeUndefined();
      expect(local.manifest.capabilityParity).toBeUndefined();
      expect(local.manifest.producer.gitCommit).toMatch(/^[a-f0-9]{40}$|^unavailable$/);
    } finally {
      if (previousEventName === undefined) {
        delete process.env.GITHUB_EVENT_NAME;
      } else {
        process.env.GITHUB_EVENT_NAME = previousEventName;
      }
      if (previousRunId === undefined) delete process.env.GITHUB_RUN_ID;
      else process.env.GITHUB_RUN_ID = previousRunId;
      if (previousRunAttempt === undefined) delete process.env.GITHUB_RUN_ATTEMPT;
      else process.env.GITHUB_RUN_ATTEMPT = previousRunAttempt;
      if (previousArtifactId === undefined) delete process.env.VISUAL_HIVE_WORKFLOW_ARTIFACT_ID;
      else process.env.VISUAL_HIVE_WORKFLOW_ARTIFACT_ID = previousArtifactId;
      if (previousNpmPackageVersion === undefined) delete process.env.npm_package_version;
      else process.env.npm_package_version = previousNpmPackageVersion;
    }
  });

  it("validates plan modes clearly", () => {
    expect(parsePlanMode("canary")).toBe("canary");
    expect(parsePlanMode("mutation")).toBe("mutation");
    expect(parsePlanMode("full")).toBe("full");
    expect(() => parsePlanMode("unknown")).toThrow(/Invalid plan mode/);
  });

  it("times out git changed-file discovery instead of waiting indefinitely", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-fake-git-"));
    tempDirs.push(tempRoot);
    const fakeBin = path.join(tempRoot, "bin");
    await mkdir(fakeBin, { recursive: true });
    const fakeGitPath = path.join(fakeBin, process.platform === "win32" ? "git.cmd" : "git");
    if (process.platform === "win32") {
      await writeFile(fakeGitPath, "@echo off\r\nping -n 2 127.0.0.1 >nul\r\n", "utf8");
    } else {
      await writeFile(fakeGitPath, "#!/usr/bin/env sh\nsleep 1\n", "utf8");
      await chmod(fakeGitPath, 0o755);
    }
    const previousPath = process.env.PATH;
    const previousTimeout = process.env.VISUAL_HIVE_GIT_TIMEOUT_MS;
    const previousGitExecutable = process.env.VISUAL_HIVE_GIT_EXECUTABLE;
    process.env.PATH = `${fakeBin}${path.delimiter}${previousPath ?? ""}`;
    process.env.VISUAL_HIVE_GIT_TIMEOUT_MS = "50";
    process.env.VISUAL_HIVE_GIT_EXECUTABLE = fakeGitPath;
    try {
      await expect(gitChangedFiles(tempRoot, "main")).rejects.toThrow("git diff timed out after 50ms");
    } finally {
      process.env.PATH = previousPath;
      if (previousTimeout === undefined) {
        delete process.env.VISUAL_HIVE_GIT_TIMEOUT_MS;
      } else {
        process.env.VISUAL_HIVE_GIT_TIMEOUT_MS = previousTimeout;
      }
      if (previousGitExecutable === undefined) {
        delete process.env.VISUAL_HIVE_GIT_EXECUTABLE;
      } else {
        process.env.VISUAL_HIVE_GIT_EXECUTABLE = previousGitExecutable;
      }
    }
  }, 10000);

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

    expect(written.outputResource).toMatchObject({
      artifactPath: ".visual-hive/plan.json",
      evidenceResourceId: "latest-plan",
      evidenceResourceUri: "visual-hive://latest-plan"
    });
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
    const sidecarPlan = await readJson<Plan>(sidecarPath);
    expect(sidecarPlan.outputResource).toBeUndefined();
    expect(sidecarPlan.items.map((item) => item.contractId)).toEqual(["shell"]);
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
    const demoExhaustiveOutput = runDemoSuiteDryRun("exhaustive");
    expect(packageJson.scripts["demo:all"]).toBe("node scripts/run-demo-suite.mjs all");
    expect(packageJson.scripts["demo:ci"]).toBe("node scripts/run-demo-suite.mjs ci");
    expect(packageJson.scripts["demo:full-run"]).toBe("node scripts/run-demo-full-tool-suite.mjs");
    expect(packageJson.scripts["demo:list"]).toBe("node scripts/run-demo-suite.mjs --list");
    expect(packageJson.scripts["schema:verify"]).toBe("node packages/cli/dist/index.js schemas verify --output .visual-hive/schema-catalog.json");
    expect(packageJson.scripts["smoke:console:run"]).toBe("node scripts/smoke-console-local-preview.mjs");
    const consoleRunSmoke = await readFile(path.join(repoRoot, "scripts", "smoke-console-local-preview.mjs"), "utf8");
    expect(consoleRunSmoke).toContain('process.env.VISUAL_HIVE_CONSOLE_BUILD === "true"');
    expect(consoleRunSmoke).toContain("run-local-preview-ci");
    expect(consoleRunSmoke).toContain("assertLocalPreviewReport");
    const expectedCommands = [
      "demo:build",
      "demo:doctor",
      "demo:analyze",
      "demo:recommend",
      "demo:plan",
      "demo:plan:canary",
      "demo:plan:full",
      "demo:plans",
      "demo:run:seed",
      "demo:pipeline",
      "demo:provider-plan",
      "demo:provider-handoff",
      "demo:provider-upload",
      "demo:llm",
      "demo:report",
      "demo:setup-status",
      "demo:runbook",
      "demo:schemas",
      "demo:snapshot",
      "demo:connections",
      "demo:artifacts",
      "demo:evidence-resources",
      "demo:evidence",
      "demo:layers",
      "demo:verdict",
      "demo:handoff",
      "demo:handoff-validate",
      "demo:hive-export",
      "demo:hive-beads",
      "demo:hive-validate",
      "demo:hive-setup-pack",
      "demo:hive-integration-smoke",
      "demo:hive-guarded-preview",
      "demo:hive-repair-envelope",
      "demo:hive-repair-consumer",
      "demo:hive-repair-workflow",
      "demo:hive-modes",
      "demo:test-creation",
      "demo:agent-packet",
      "demo:agent-packet:handoff",
      "demo:agent-packet:provider",
      "demo:tools",
      "demo:mcp",
      "demo:context",
      "demo:kubestellar",
      "demo:ui"
    ];
    const exhaustiveOnlyCommands = [
      "demo:coverage",
      "demo:baselines",
      "demo:improve",
      "demo:targets",
      "demo:contracts",
      "demo:flows",
      "demo:schedules",
      "demo:workflows",
      "demo:providers",
      "demo:triage",
      "demo:risk",
      "demo:security",
      "demo:costs",
      "demo:history"
    ];

    for (const command of expectedCommands) {
      expect(demoAllOutput).toContain(command);
      expect(demoCiOutput).toContain(command);
    }
    expect(demoAllOutput).toContain("demo:hive-bundle");
    expect(demoCiOutput).not.toContain("demo:hive-bundle");
    for (const command of exhaustiveOnlyCommands) {
      expect(demoExhaustiveOutput).toContain(command);
    }
    expect(packageJson.scripts["demo:acceptance:exhaustive"]).toBe("node scripts/run-demo-suite.mjs exhaustive");
    expect(packageJson.scripts["demo:providers"]).toContain("providers list --config");
    expect(packageJson.scripts["demo:provider-handoff"]).toContain("providers handoff --config");
    expect(packageJson.scripts["demo:provider-handoff"]).toContain("--provider argos");
    expect(packageJson.scripts["demo:baselines"]).toContain("baselines list --config");
    expect(packageJson.scripts["demo:issue-publish"]).toContain("issues --config");
    expect(packageJson.scripts["demo:issue-publish"]).toContain(" publish --dry-run");
    expect(packageJson.scripts["demo:agent-issue-run"]).toContain("agent issue-runner");
    expect(packageJson.scripts["demo:agent-issue-run"]).toContain("--issue-index 0");
    expect(packageJson.scripts["demo:agent-issue-run:local"]).toContain("--execute-agent");
    expect(packageJson.scripts["demo:agent-issue-run:local"]).toContain("scripts/local-issue-agent.mjs");
    expect(packageJson.scripts["demo:baselines"]).toContain("--write");
    expect(packageJson.scripts["demo:improve"]).toContain("improve-coverage --config");
    expect(demoExhaustiveOutput.indexOf("demo:flows")).toBeLessThan(demoExhaustiveOutput.indexOf("demo:improve"));
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
    expect(packageJson.scripts["demo:evidence-resources"]).toBe("node scripts/check-demo-evidence-resources.mjs");
    const fullRunScript = await readFile(path.join(repoRoot, "scripts", "run-demo-full-tool-suite.mjs"), "utf8");
    const issueDryRunScript = await readFile(path.join(repoRoot, "scripts", "check-handoff-issue-dry-run.mjs"), "utf8");
    expect(fullRunScript).toContain("visual-hive.full-demo-summary.v1");
    expect(fullRunScript).toContain("full-demo-summary.json");
    expect(fullRunScript).toContain("full-demo-summary.md");
    expect(fullRunScript).toContain("demo:e2e:handoff-dry-run");
    expect(issueDryRunScript).toContain("blocked_artifacts");
    expect(fullRunScript).toContain("assertFreshAfterSeededDefect");
    expect(fullRunScript).toContain("Setup/repo intelligence");
    expect(fullRunScript).toContain("KubeStellar planning smoke");
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
    expect(packageJson.scripts["demo:handoff-validate"]).toContain("handoff-validate --config");
    expect(packageJson.scripts["demo:hive-export"]).toContain("hive export --config");
    expect(packageJson.scripts["demo:hive-export"]).toContain("--dry-run");
    expect(packageJson.scripts["demo:hive-beads"]).toContain("hive beads --config");
    expect(packageJson.scripts["demo:hive-validate"]).toContain("hive validate-export --config");
    expect(packageJson.scripts["demo:hive-setup-pack"]).toContain("hive setup-pack --config");
    expect(packageJson.scripts["demo:hive-integration-smoke"]).toContain("hive integration-smoke --config");
    expect(packageJson.scripts["demo:hive-guarded-preview"]).toContain("hive guarded-repair-preview --config");
    expect(packageJson.scripts["demo:hive-repair-envelope"]).toContain("hive repair-request-envelope --config");
    expect(packageJson.scripts["demo:hive-repair-consumer"]).toContain("hive trusted-repair-consumer-summary --config");
    expect(packageJson.scripts["demo:hive-repair-workflow"]).toContain("hive trusted-repair-workflow-dry-run --config");
    expect(packageJson.scripts["demo:hive-modes"]).toContain("hive compare-modes --config");
    expect(packageJson.scripts["demo:test-creation"]).toContain("test-creation-plan --config");
    expect(demoAllOutput.indexOf("demo:handoff")).toBeLessThan(demoAllOutput.indexOf("demo:test-creation"));
    expect(demoCiOutput.indexOf("demo:handoff")).toBeLessThan(demoCiOutput.indexOf("demo:test-creation"));
    expect(demoAllOutput.indexOf("demo:handoff")).toBeLessThan(demoAllOutput.indexOf("demo:handoff-validate"));
    expect(demoCiOutput.indexOf("demo:handoff")).toBeLessThan(demoCiOutput.indexOf("demo:handoff-validate"));
    expect(demoAllOutput.indexOf("demo:handoff-validate")).toBeLessThan(demoAllOutput.indexOf("demo:test-creation"));
    expect(demoCiOutput.indexOf("demo:handoff-validate")).toBeLessThan(demoCiOutput.indexOf("demo:test-creation"));
    expect(demoAllOutput.indexOf("demo:hive-export")).toBeLessThan(demoAllOutput.indexOf("demo:test-creation"));
    expect(demoCiOutput.indexOf("demo:hive-export")).toBeLessThan(demoCiOutput.indexOf("demo:test-creation"));
    expect(demoAllOutput.indexOf("demo:hive-export")).toBeLessThan(demoAllOutput.indexOf("demo:hive-beads"));
    expect(demoCiOutput.indexOf("demo:hive-export")).toBeLessThan(demoCiOutput.indexOf("demo:hive-beads"));
    expect(demoAllOutput.indexOf("demo:hive-beads")).toBeLessThan(demoAllOutput.indexOf("demo:hive-validate"));
    expect(demoCiOutput.indexOf("demo:hive-beads")).toBeLessThan(demoCiOutput.indexOf("demo:hive-validate"));
    expect(demoAllOutput.indexOf("demo:hive-validate")).toBeLessThan(demoAllOutput.indexOf("demo:hive-setup-pack"));
    expect(demoCiOutput.indexOf("demo:hive-validate")).toBeLessThan(demoCiOutput.indexOf("demo:hive-setup-pack"));
    expect(demoAllOutput.indexOf("demo:hive-setup-pack")).toBeLessThan(demoAllOutput.indexOf("demo:hive-integration-smoke"));
    expect(demoCiOutput.indexOf("demo:hive-setup-pack")).toBeLessThan(demoCiOutput.indexOf("demo:hive-integration-smoke"));
    expect(demoAllOutput.indexOf("demo:hive-integration-smoke")).toBeLessThan(demoAllOutput.indexOf("demo:hive-guarded-preview"));
    expect(demoCiOutput.indexOf("demo:hive-integration-smoke")).toBeLessThan(demoCiOutput.indexOf("demo:hive-guarded-preview"));
    expect(demoAllOutput.indexOf("demo:hive-export")).toBeLessThan(demoAllOutput.indexOf("demo:hive-guarded-preview"));
    expect(demoCiOutput.indexOf("demo:hive-export")).toBeLessThan(demoCiOutput.indexOf("demo:hive-guarded-preview"));
    expect(demoAllOutput.indexOf("demo:hive-guarded-preview")).toBeLessThan(demoAllOutput.indexOf("demo:hive-modes"));
    expect(demoCiOutput.indexOf("demo:hive-guarded-preview")).toBeLessThan(demoCiOutput.indexOf("demo:hive-modes"));
    expect(demoAllOutput.indexOf("demo:hive-guarded-preview")).toBeLessThan(demoAllOutput.indexOf("demo:hive-repair-envelope"));
    expect(demoCiOutput.indexOf("demo:hive-guarded-preview")).toBeLessThan(demoCiOutput.indexOf("demo:hive-repair-envelope"));
    expect(demoAllOutput.indexOf("demo:hive-repair-envelope")).toBeLessThan(demoAllOutput.indexOf("demo:hive-modes"));
    expect(demoCiOutput.indexOf("demo:hive-repair-envelope")).toBeLessThan(demoCiOutput.indexOf("demo:hive-modes"));
    expect(demoAllOutput.indexOf("demo:hive-repair-envelope")).toBeLessThan(demoAllOutput.indexOf("demo:hive-repair-consumer"));
    expect(demoCiOutput.indexOf("demo:hive-repair-envelope")).toBeLessThan(demoCiOutput.indexOf("demo:hive-repair-consumer"));
    expect(demoAllOutput.indexOf("demo:hive-repair-consumer")).toBeLessThan(demoAllOutput.indexOf("demo:hive-repair-workflow"));
    expect(demoCiOutput.indexOf("demo:hive-repair-consumer")).toBeLessThan(demoCiOutput.indexOf("demo:hive-repair-workflow"));
    expect(demoAllOutput.indexOf("demo:hive-repair-workflow")).toBeLessThan(demoAllOutput.indexOf("demo:handoff-validate"));
    expect(demoCiOutput.indexOf("demo:hive-repair-workflow")).toBeLessThan(demoCiOutput.indexOf("demo:handoff-validate"));
    expect(demoAllOutput.indexOf("demo:handoff-validate")).toBeLessThan(demoAllOutput.indexOf("demo:hive-modes"));
    expect(demoCiOutput.indexOf("demo:handoff-validate")).toBeLessThan(demoCiOutput.indexOf("demo:hive-modes"));
    expect(demoAllOutput.indexOf("demo:hive-repair-workflow")).toBeLessThan(demoAllOutput.indexOf("demo:hive-modes"));
    expect(demoCiOutput.indexOf("demo:hive-repair-workflow")).toBeLessThan(demoCiOutput.indexOf("demo:hive-modes"));
    expect(demoAllOutput.indexOf("demo:hive-export")).toBeLessThan(demoAllOutput.indexOf("demo:hive-modes"));
    expect(demoCiOutput.indexOf("demo:hive-export")).toBeLessThan(demoCiOutput.indexOf("demo:hive-modes"));
    expect(demoAllOutput.indexOf("demo:hive-modes")).toBeLessThan(demoAllOutput.indexOf("demo:test-creation"));
    expect(demoCiOutput.indexOf("demo:hive-modes")).toBeLessThan(demoCiOutput.indexOf("demo:test-creation"));
    expect(demoAllOutput.indexOf("demo:test-creation")).toBeLessThan(demoAllOutput.indexOf("demo:agent-packet"));
    expect(demoCiOutput.indexOf("demo:test-creation")).toBeLessThan(demoCiOutput.indexOf("demo:agent-packet"));
    expect(demoAllOutput.indexOf("demo:agent-packet")).toBeLessThan(demoAllOutput.indexOf("demo:agent-packet:handoff"));
    expect(demoCiOutput.indexOf("demo:agent-packet")).toBeLessThan(demoCiOutput.indexOf("demo:agent-packet:handoff"));
    expect(demoAllOutput.indexOf("demo:agent-packet:handoff")).toBeLessThan(demoAllOutput.indexOf("demo:agent-packet:provider"));
    expect(demoCiOutput.indexOf("demo:agent-packet:handoff")).toBeLessThan(demoCiOutput.indexOf("demo:agent-packet:provider"));
    expect(demoAllOutput.indexOf("demo:agent-packet:provider")).toBeLessThan(demoAllOutput.indexOf("demo:tools"));
    expect(demoCiOutput.indexOf("demo:agent-packet:provider")).toBeLessThan(demoCiOutput.indexOf("demo:tools"));
    expect(packageJson.scripts["demo:agent-packet"]).toContain("agent-packet --config");
    expect(packageJson.scripts["demo:agent-packet"]).toContain("--profile repair_agent");
    expect(packageJson.scripts["demo:agent-packet:handoff"]).toContain("--profile handoff_agent");
    expect(packageJson.scripts["demo:agent-packet:handoff"]).toContain("--output .visual-hive/handoff-agent-packet.json");
    expect(packageJson.scripts["demo:agent-packet:provider"]).toContain("--profile provider_specialist");
    expect(packageJson.scripts["demo:agent-packet:provider"]).toContain("--output .visual-hive/provider-agent-packet.json");
    expect(packageJson.scripts["demo:tools"]).toContain("tools --config");
    expect(packageJson.scripts["demo:mcp"]).toContain("mcp --config");
    expect(packageJson.scripts["demo:mcp"]).toContain("--describe");
    expect(packageJson.scripts["demo:mcp"]).toContain("--output .visual-hive/mcp-manifest.json");
    expect(packageJson.scripts["demo:context"]).toContain("context --config");
    expect(packageJson.scripts["demo:analyze"]).toContain("analyze --repo");
    expect(demoAllOutput.indexOf("demo:doctor")).toBeLessThan(demoAllOutput.indexOf("demo:analyze"));
    expect(demoCiOutput.indexOf("demo:doctor")).toBeLessThan(demoCiOutput.indexOf("demo:analyze"));
    expect(demoAllOutput.indexOf("demo:analyze")).toBeLessThan(demoAllOutput.indexOf("demo:recommend"));
    expect(demoCiOutput.indexOf("demo:analyze")).toBeLessThan(demoCiOutput.indexOf("demo:recommend"));
    expect(demoAllOutput.indexOf("demo:tools")).toBeLessThan(demoAllOutput.indexOf("demo:context"));
    expect(demoCiOutput.indexOf("demo:tools")).toBeLessThan(demoCiOutput.indexOf("demo:context"));
    expect(demoAllOutput.indexOf("demo:tools")).toBeLessThan(demoAllOutput.indexOf("demo:mcp"));
    expect(demoCiOutput.indexOf("demo:tools")).toBeLessThan(demoCiOutput.indexOf("demo:mcp"));
    expect(demoAllOutput.indexOf("demo:mcp")).toBeLessThan(demoAllOutput.indexOf("demo:context"));
    expect(demoCiOutput.indexOf("demo:mcp")).toBeLessThan(demoCiOutput.indexOf("demo:context"));
    expect(demoAllOutput.indexOf("demo:pipeline")).toBeLessThan(demoAllOutput.indexOf("demo:context"));
    expect(demoCiOutput.indexOf("demo:pipeline")).toBeLessThan(demoCiOutput.indexOf("demo:context"));
    expect(demoAllOutput.indexOf("demo:context")).toBeLessThan(demoAllOutput.indexOf("demo:artifacts"));
    expect(demoCiOutput.indexOf("demo:context")).toBeLessThan(demoCiOutput.indexOf("demo:artifacts"));
    expect(demoAllOutput.indexOf("demo:schemas")).toBeLessThan(demoAllOutput.indexOf("demo:snapshot"));
    expect(demoCiOutput.indexOf("demo:schemas")).toBeLessThan(demoCiOutput.indexOf("demo:snapshot"));
    expect(demoAllOutput.indexOf("demo:snapshot")).toBeLessThan(demoAllOutput.indexOf("demo:artifacts"));
    expect(demoCiOutput.indexOf("demo:snapshot")).toBeLessThan(demoCiOutput.indexOf("demo:artifacts"));
    expect(demoAllOutput.indexOf("demo:artifacts")).toBeLessThan(demoAllOutput.indexOf("demo:evidence-resources"));
    expect(demoCiOutput.indexOf("demo:artifacts")).toBeLessThan(demoCiOutput.indexOf("demo:evidence-resources"));
    expect(demoAllOutput.indexOf("demo:evidence-resources")).toBeLessThan(demoAllOutput.indexOf("demo:ui"));
    expect(demoCiOutput.indexOf("demo:evidence-resources")).toBeLessThan(demoCiOutput.indexOf("demo:ui"));
    expect(demoExhaustiveOutput.indexOf("demo:schemas")).toBeLessThan(demoExhaustiveOutput.indexOf("demo:snapshot"));
    expect(packageJson.scripts["demo:plan:canary"]).toContain("--mode canary");
    expect(packageJson.scripts["demo:plan:canary"]).toContain("--output .visual-hive/plan.canary.json");
    expect(packageJson.scripts["demo:plan:full"]).toContain("--mode full");
    expect(packageJson.scripts["demo:plan:full"]).toContain("--output .visual-hive/plan.full.json");
    expect(packageJson.scripts["demo:plan:full"]).not.toContain("--allow-unsafe-targets");
    expect(packageJson.scripts["demo:plans"]).toContain("plans --config");
    expect(demoAllOutput.indexOf("demo:plan:full")).toBeLessThan(demoAllOutput.indexOf("demo:plans"));
    expect(demoAllOutput.indexOf("demo:plans")).toBeLessThan(demoAllOutput.indexOf("demo:run:seed"));
    expect(demoCiOutput.indexOf("demo:plan:full")).toBeLessThan(demoCiOutput.indexOf("demo:plans"));
    expect(demoCiOutput.indexOf("demo:plans")).toBeLessThan(demoCiOutput.indexOf("demo:run:seed"));
    expect(demoCiOutput.indexOf("demo:run:seed")).toBeLessThan(demoCiOutput.indexOf("demo:pipeline"));
    expect(packageJson.scripts["demo:run:seed"]).toContain("VISUAL_HIVE_CI=false");
    expect(packageJson.scripts["demo:run:seed"]).toContain("scripts/run-with-env.mjs");
    expect(packageJson.scripts["demo:pipeline"]).toContain("--skip-install");
    expect(packageJson.scripts["demo:pipeline"]).toContain("--skip-build");
    expect(demoAllOutput).toContain("demo:pipeline");
    expect(demoAllOutput).toContain("timeout 420s");
    expect(packageJson.scripts["demo:kubestellar"]).toContain("demo:kubestellar:auth-plan");
    expect(packageJson.scripts["demo:kubestellar"]).toContain("demo:kubestellar:docs-plan");
    expect(packageJson.scripts["demo:kubestellar"]).toContain("demo:kubestellar:plans");
    expect(packageJson.scripts["demo:kubestellar"]).toContain("demo:kubestellar:artifacts");
    expect(packageJson.scripts["demo:kubestellar"]).toContain("demo:kubestellar:evidence-resources");
    expect(packageJson.scripts["demo:kubestellar:plans"]).toContain("plans --config");
    expect(packageJson.scripts["demo:kubestellar:artifacts"]).toContain("artifacts --config");
    expect(packageJson.scripts["demo:kubestellar:evidence-resources"]).toContain("check-demo-evidence-resources.mjs");
    expect(packageJson.scripts["demo:kubestellar:evidence-resources"]).toContain("--root examples/kubestellar-console");
    expect(packageJson.scripts["demo:kubestellar:evidence-resources"]).toContain("--profile general");
    expect(packageJson.scripts["demo:kubestellar:auth-plan"]).toContain("--output .visual-hive/plan.auth.json");
    expect(packageJson.scripts["demo:kubestellar:cluster-plan"]).toContain("--output .visual-hive/plan.cluster.json");
    expect(packageJson.scripts["demo:kubestellar:docs-plan"]).toContain("--output .visual-hive/plan.docs.json");
    expect(packageJson.scripts["demo:kubestellar:schedule-plan"]).toContain("--output .visual-hive/plan.schedule.json");
    expect(packageJson.scripts["demo:kubestellar:schedule-plan"]).toContain("--mode schedule");
    expect(packageJson.scripts["demo:ui"]).toBe("npm run smoke:ui");
    expect(packageJson.scripts["smoke:ui:browser"]).toBe("node scripts/smoke-ui-browser.mjs");
    expect(packageJson.scripts["demo:risk"]).toContain("risk --config");
  });

  it("demo acceptance runner terminates a timed-out child process", () => {
    const result = spawnSync(process.execPath, [path.join(repoRoot, "scripts", "run-demo-suite.mjs"), "--self-test-timeout"], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 10_000,
      windowsHide: true
    });

    expect(result.status).toBe(124);
    expect(result.stderr).toContain("timed out after");
    expect(result.stderr).toContain("terminating process tree");
    expect(result.stdout).toContain("[demo:self-test-timeout] 1/1 self-test-timeout");
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

  it("graph search and impact read generated Visual Graph artifacts", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-cli-graph-"));
    tempDirs.push(tempRoot);
    await mkdir(path.join(tempRoot, "src"), { recursive: true });
    await writeFile(
      path.join(tempRoot, "package.json"),
      JSON.stringify({ name: "graph-cli-fixture", scripts: { preview: "vite preview" }, dependencies: { react: "^19.0.0", vite: "^6.0.0" } }),
      "utf8"
    );
    await writeFile(
      path.join(tempRoot, "visual-hive.config.yaml"),
      `project:
  name: graph-cli-fixture
  type: react-vite
targets:
  local:
    kind: url
    url: http://127.0.0.1:4173
    prSafe: true
contracts:
  - id: dashboard-visual
    description: Dashboard visual
    target: local
    runOn:
      pullRequest: true
    selectors:
      mustExist:
        - "[data-testid='dashboard-page']"
    screenshots:
      - name: dashboard-mobile
        route: /
        viewport: mobile
viewports:
  mobile:
    width: 390
    height: 844
mutation:
  enabled: true
  operators:
    - mobile-overflow
`,
      "utf8"
    );
    await writeFile(path.join(tempRoot, "src", "App.tsx"), `export function App(){return <main data-testid="dashboard-page">Dashboard</main>}`, "utf8");
    const changedFiles = path.join(tempRoot, "changed-files.txt");
    await writeFile(changedFiles, "src/App.tsx\n", "utf8");

    await runAnalyzeCommand({ repo: tempRoot });
    const search = await runGraphSearchCommand("dashboard", { repo: tempRoot });
    const searchMarkdown = formatGraphSearch(search);
    expect(search.results.length).toBeGreaterThan(0);
    expect(searchMarkdown).toContain("dashboard");

    const impact = await runGraphImpactCommand({ repo: tempRoot, changedFiles, mutation: "mobile-overflow" });
    const impactMarkdown = formatGraphImpact(impact);
    expect(impact.outputPath).toBe(path.join(tempRoot, ".visual-hive", "visual-impact.json"));
    expect(impact.impact.summary.affectedNodeCount).toBeGreaterThan(0);
    expect(impactMarkdown).toContain("Visual Impact");
    expect(await readFile(path.join(tempRoot, ".visual-hive", "visual-impact.json"), "utf8")).toContain("visual-hive.visual-impact.v1");
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
    expect(written.outputResource).toMatchObject({
      artifactPath: ".visual-hive/coverage.json",
      evidenceResourceId: "coverage-map",
      evidenceResourceUri: "visual-hive://coverage-map"
    });
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
    expect(written.outputResource).toMatchObject({
      artifactPath: ".visual-hive/coverage-recommendations.json",
      evidenceResourceId: "coverage-recommendations",
      evidenceResourceUri: "visual-hive://coverage-recommendations",
      evidenceReadToolName: "visual_hive_read_coverage_recommendations"
    });
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
    expect(written.outputResource).toMatchObject({
      artifactPath: ".visual-hive/workflows.json",
      evidenceResourceId: "workflow-audit",
      evidenceResourceUri: "visual-hive://workflow-audit",
      evidenceReadToolName: "visual_hive_read_workflow_audit"
    });
    expect(written.workflows[0]?.writesBaselineReview).toBe(false);
    expect(written.findings.map((finding) => finding.kind)).toContain("missing_baseline_review_artifact");
    expect(summary).toContain("Workflow Safety Audit: cli-workflows");
    expect(summary).toContain("baselines=no");
    await expect(access(path.join(tempRoot, ".visual-hive", "workflows.json"))).resolves.toBeUndefined();
  });

  it("workflows falls back to repo cwd workflows when config is nested", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-cli-nested-workflows-"));
    tempDirs.push(tempRoot);
    const appRoot = path.join(tempRoot, "web", "e2e");
    await mkdir(appRoot, { recursive: true });
    await writeFile(
      path.join(appRoot, "visual-hive.config.yaml"),
      `project:
  name: nested-workflows
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
      - uses: actions/upload-artifact@v4
        with:
          name: visual-hive
          path: .visual-hive
          include-hidden-files: true
`,
      "utf8"
    );

    const resolution = await resolveWorkflowRoot({
      configRoot: appRoot,
      cwd: tempRoot,
      workflowDir: ".github/workflows"
    });
    const result = await runWorkflowsCommand({
      cwd: tempRoot,
      config: path.join(appRoot, "visual-hive.config.yaml"),
      workflowDir: ".github/workflows"
    });
    const summary = formatWorkflowsAudit(result.audit, result.auditPath);

    expect(resolution.source).toBe("cwd");
    expect(resolution.workflowRoot).toBe(path.join(tempRoot, ".github", "workflows"));
    expect(result.audit.workflowRoot).toBe(path.join(tempRoot, ".github", "workflows"));
    expect(result.audit.outputResource).toMatchObject({
      artifactPath: ".visual-hive/workflows.json",
      evidenceResourceId: "workflow-audit",
      evidenceResourceUri: "visual-hive://workflow-audit",
      evidenceReadToolName: "visual_hive_read_workflow_audit"
    });
    expect(result.audit.summary.pullRequestWorkflows).toBe(1);
    expect(result.auditPath).toBe(path.join(appRoot, ".visual-hive", "workflows.json"));
    expect(summary).toContain(`Scanned directory: ${path.join(tempRoot, ".github", "workflows")}`);
    await expect(access(path.join(appRoot, ".visual-hive", "workflows.json"))).resolves.toBeUndefined();
  });

  it("workflow-backed audits use repo cwd workflow fallback when config is nested", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-cli-nested-audits-"));
    tempDirs.push(tempRoot);
    const appRoot = path.join(tempRoot, "web", "e2e");
    const configPath = path.join(appRoot, "visual-hive.config.yaml");
    await mkdir(appRoot, { recursive: true });
    await writeFile(
      configPath,
      `project:
  name: nested-audits
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
      path.join(tempRoot, ".github", "workflows", "unsafe-pr.yml"),
      `name: Unsafe PR
on:
  pull_request_target:
permissions:
  contents: write
  issues: write
jobs:
  unsafe:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: visual-hive run --ci
`,
      "utf8"
    );

    const options = { cwd: tempRoot, config: configPath, workflowDir: ".github/workflows" };
    const security = await runSecurityCommand(options);
    const risk = await runRiskCommand(options);
    const readiness = await runReadinessCommand(options);
    const setupStatus = await runSetupStatusCommand(options);

    expect(security.reportPath).toBe(path.join(appRoot, ".visual-hive", "security.json"));
    expect(security.report.inputs.workflowAudit).toBe(true);
    expect(security.report.findings.map((finding) => finding.category)).toContain("workflow");
    expect(risk.report.inputs.workflowAudit).toBe(true);
    expect(risk.report.risks.map((riskItem) => riskItem.category)).toContain("workflow_safety");
    expect(readiness.report.inputs.workflowAudit).toBe(true);
    expect(readiness.report.gates.map((gate) => gate.id)).toContain("workflow:unsafe");
    expect(readiness.report.gates.map((gate) => gate.id)).not.toContain("workflow:missing");
    const workflowStep = setupStatus.report.steps.find((step) => step.id === "workflow-safety");
    expect(workflowStep?.status).toBe("blocked");
    expect(workflowStep?.evidence.join(" ")).toContain("criticalHigh=");
    await expect(access(path.join(appRoot, ".visual-hive", "security.json"))).resolves.toBeUndefined();
    await expect(access(path.join(appRoot, ".visual-hive", "risk.json"))).resolves.toBeUndefined();
    await expect(access(path.join(appRoot, ".visual-hive", "readiness.json"))).resolves.toBeUndefined();
    await expect(access(path.join(appRoot, ".visual-hive", "setup-progress.json"))).resolves.toBeUndefined();
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

  it("artifacts indexes setup evidence before a config exists", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-cli-artifacts-repo-"));
    tempDirs.push(tempRoot);
    await mkdir(path.join(tempRoot, ".visual-hive"), { recursive: true });
    await writeJson(path.join(tempRoot, ".visual-hive", "recommendations.json"), {
      schemaVersion: 1,
      project: "setup-only",
      outputResource: {
        evidenceResourceId: "setup-recommendations",
        evidenceResourceUri: "visual-hive://setup-recommendations",
        artifactPath: ".visual-hive/recommendations.json",
        evidenceReadToolName: "visual_hive_read_setup_recommendations"
      }
    });
    await writeJson(path.join(tempRoot, ".visual-hive", "setup-pr-plan.json"), {
      schemaVersion: 1,
      project: "setup-only",
      summary: { externalCallsMade: 0 },
      outputResource: {
        evidenceResourceId: "setup-pr-plan",
        evidenceResourceUri: "visual-hive://setup-pr-plan",
        artifactPath: ".visual-hive/setup-pr-plan.json",
        evidenceReadToolName: "visual_hive_read_setup_pr_plan"
      }
    });

    const result = await runArtifactsCommand({ cwd: repoRoot, repo: tempRoot, project: "setup-only" });
    const written = await readJson<typeof result.index>(result.indexPath);
    const summary = formatArtifactsIndex(written, result.indexPath);

    expect(written.project).toBe("setup-only");
    expect(written.artifacts.find((artifact) => artifact.path === ".visual-hive/recommendations.json")).toMatchObject({
      evidenceResourceId: "setup-recommendations",
      evidenceResourceUri: "visual-hive://setup-recommendations",
      evidenceReadToolName: "visual_hive_read_setup_recommendations",
      labels: expect.arrayContaining(["evidence-resource", "setup-recommendations"])
    });
    expect(written.artifacts.find((artifact) => artifact.path === ".visual-hive/setup-pr-plan.json")).toMatchObject({
      evidenceResourceId: "setup-pr-plan",
      evidenceResourceUri: "visual-hive://setup-pr-plan",
      evidenceReadToolName: "visual_hive_read_setup_pr_plan",
      labels: expect.arrayContaining(["evidence-resource", "setup-pr-plan"])
    });
    expect(summary).toContain("Artifact Index: setup-only");
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
    beadApi:
      url: "https://hive.example.invalid/api/beads?token=secret-value"
      tokenEnv: VISUAL_HIVE_TEST_HIVE_TOKEN_MISSING
      agent: quality
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
    expect(handoff.hiveBeadRequest).toMatchObject({
      integrationEnabled: false,
      configuredMode: "dry_run",
      beadApiUrl: "https://hive.example.invalid/api/beads?token=[REDACTED]",
      tokenEnv: "VISUAL_HIVE_TEST_HIVE_TOKEN_MISSING",
      tokenPresent: false,
      missingTokenEnv: "VISUAL_HIVE_TEST_HIVE_TOKEN_MISSING"
    });
    expect(result.beadRequest.target).toMatchObject({
      integrationEnabled: false,
      configuredMode: "dry_run",
      beadApiUrl: "https://hive.example.invalid/api/beads?token=[REDACTED]",
      tokenEnv: "VISUAL_HIVE_TEST_HIVE_TOKEN_MISSING",
      tokenPresent: false,
      missingTokenEnv: "VISUAL_HIVE_TEST_HIVE_TOKEN_MISSING"
    });
    expect(result.beadRequest.forbiddenActions).toContain("decide_visual_hive_verdict");
    expect(result.result.status).toBe("dry_run_written");
    expect(summary).toContain("Hive Handoff Dry Run: cli-handoff");
    expect(issue).toContain("Trusted workflows must consume uploaded sanitized artifacts");
    expect(JSON.stringify(result)).not.toContain("secret-value");
    await expect(access(path.join(tempRoot, ".visual-hive", "hive-bead-request.json"))).resolves.toBeUndefined();
    await expect(access(path.join(tempRoot, ".visual-hive", "hive-handoff-result.json"))).resolves.toBeUndefined();

    const validation = await runHandoffValidateCommand({ cwd: tempRoot });
    const validationSummary = formatHandoffValidation(validation);
    expect(validation.exitCode).toBe(0);
    expect(validation.report.status).toBe("passed");
    expect(validation.report.summary.externalCallsMade).toBe(0);
    expect(validation.report.hiveReadiness.recommendedMode).toBeTruthy();
    expect(validation.report.hiveReadiness.fullAutomationBlocked).toBe(true);
    expect(validation.report.checks.map((check) => check.id)).toContain("verdict-consistency");
    expect(validation.report.checks.map((check) => check.id)).toContain("hive-readiness-schema");
    expect(validationSummary).toContain("Hive Handoff Validation: cli-handoff");
    expect(validationSummary).toContain("Recommended Hive mode:");
    expect(validationSummary).toContain("Full automation blocked: true");
    await expect(access(path.join(tempRoot, ".visual-hive", "hive-handoff-validation.json"))).resolves.toBeUndefined();
  });

  it("writes a Hive-native export bundle with repair work orders from evidence", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-cli-hive-export-"));
    tempDirs.push(tempRoot);
    await writeFile(
      path.join(tempRoot, "visual-hive.config.yaml"),
      `project:
  name: cli-hive-export
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
    enabled: true
    mode: repair_request
    acmmLevel: 3
    defaultActor: quality
    labels:
      - visual-hive
      - hive/quality
    repair:
      enabled: true
      prOnly: true
      maxAttempts: 1
      requireHumanReview: true
      rerunVisualHive: true
      branchPrefix: hive/visual-hive-
`,
      "utf8"
    );
    await writeJson(path.join(tempRoot, ".visual-hive", "report.json"), {
      schemaVersion: 2,
      project: "cli-hive-export",
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
          errors: ["Missing selector; cookie=session-secret"],
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
    const result = await runHiveExportCommand({ cwd: tempRoot });
    const summary = formatHiveExport(result);
    const hiveExport = await readJson<typeof result.bundle>(path.join(tempRoot, ".visual-hive", "hive", "hive-export.json"));
    const issueContext = await readFile(path.join(tempRoot, ".visual-hive", "hive", "issue-context.md"), "utf8");
    const beadsResult = await runHiveBeadsCommand({ cwd: tempRoot });
    const beadsSummary = formatHiveBeads(beadsResult);
    const validateResult = await runHiveValidateExportCommand({ cwd: tempRoot });
    const validateSummary = formatHiveValidateExport(validateResult);
    const setupPackResult = await runHiveSetupPackCommand({ cwd: tempRoot });
    const setupPackSummary = formatHiveSetupPack(setupPackResult);
    const smokeResult = await runHiveIntegrationSmokeCommand({ cwd: tempRoot });
    const smokeSummary = formatHiveIntegrationSmoke(smokeResult);
    const previewResult = await runHiveGuardedRepairPreviewCommand({ cwd: tempRoot });
    const previewSummary = formatHiveGuardedRepairPreview(previewResult);
    const preview = await readJson<typeof previewResult.preview>(path.join(tempRoot, ".visual-hive", "hive", "guarded-repair-preview.json"));
    const envelopeResult = await runHiveRepairRequestEnvelopeCommand({ cwd: tempRoot });
    const envelopeSummary = formatHiveRepairRequestEnvelope(envelopeResult);
    const envelope = await readJson<typeof envelopeResult.envelope>(path.join(tempRoot, ".visual-hive", "hive", "repair-request-envelope.json"));
    const consumerResult = await runHiveTrustedRepairConsumerSummaryCommand({ cwd: tempRoot });
    const consumerSummary = formatHiveTrustedRepairConsumerSummary(consumerResult);
    const consumer = await readJson<typeof consumerResult.summary>(path.join(tempRoot, ".visual-hive", "hive", "trusted-repair-consumer-summary.json"));
    const workflowResult = await runHiveTrustedRepairWorkflowDryRunCommand({ cwd: tempRoot });
    const workflowSummary = formatHiveTrustedRepairWorkflowDryRun(workflowResult);
    const workflowDryRun = await readJson<typeof workflowResult.dryRun>(path.join(tempRoot, ".visual-hive", "hive", "trusted-repair-workflow-dry-run.json"));

    expect(result.bundle.mode).toBe("repair_request");
    expect(result.bundle.externalCallsMade).toBe(0);
    expect(result.bundle.summary.beads).toBeGreaterThanOrEqual(1);
    expect(result.bundle.summary.repairWorkOrders).toBeGreaterThanOrEqual(1);
    expect(result.bundle.repairWorkOrders[0]?.acceptanceCriteria).toContain("Visual Hive verdict passes after repair.");
    expect(summary).toContain("Hive Native Export: cli-hive-export");
    expect(hiveExport.schemaVersion).toBe("visual-hive.hive-export.v1");
    expect(issueContext).toContain("Hive Agent Work Order");
    expect(beadsResult.paths.beads).toBe(".visual-hive/hive/hive-beads.json");
    expect(beadsSummary).toContain("Hive Beads Projection");
    expect(validateResult.validation.schemaVersion).toBe("visual-hive.hive-validation-summary.v1");
    expect(validateResult.validation.status).toBe("passed");
    expect(validateResult.manifest.schemaVersion).toBe("visual-hive.hive-import-manifest.v1");
    expect(validateResult.manifest.safety.externalCallsMade).toBe(0);
    expect(validateResult.manifest.safety.visualHiveCreatesIssues).toBe(false);
    expect(validateResult.manifest.safety.visualHiveRepairsCode).toBe(false);
    expect(validateSummary).toContain("Hive Export Validation: cli-hive-export");
    expect(setupPackResult.setupPack.schemaVersion).toBe("visual-hive.hive-setup-pack.v1");
    expect(setupPackResult.setupPack.validationCommands).toContain("visual-hive hive validate-export");
    expect(setupPackResult.setupPack.permissions.find((item) => item.workflow === "pull_request")?.permissions).toEqual({ contents: "read" });
    expect(setupPackSummary).toContain("Hive Visual QA Setup Pack: cli-hive-export");
    expect(smokeResult.smoke.schemaVersion).toBe("visual-hive.hive-integration-smoke.v1");
    expect(smokeResult.smoke.status).toBe("passed");
    expect(smokeResult.smoke.externalCallsMade).toBe(0);
    expect(smokeSummary).toContain("Hive Integration Smoke: cli-hive-export");
    expect(preview.schemaVersion).toBe("visual-hive.hive-guarded-repair-preview.v1");
    expect(preview.externalCallsMade).toBe(0);
    expect(preview.status).toBe("ready");
    expect(preview.summary.repairWorkOrders).toBeGreaterThanOrEqual(1);
    expect(preview.readiness.requiredCommands).toContain("visual-hive pipeline --mode pr --ci");
    expect(preview.workOrders[0]?.branchName).toContain("hive/visual-hive-");
    expect(previewSummary).toContain("Hive Guarded Repair Preview: cli-hive-export");
    expect(envelope.schemaVersion).toBe("visual-hive.hive-repair-request-envelope.v1");
    expect(envelope.externalCallsMade).toBe(0);
    expect(envelope.status).toBe("ready");
    expect(envelope.readiness.canOpenTrustedRepairRequest).toBe(true);
    expect(envelope.requests[0]?.finalValidationCommand).toBe("visual-hive pipeline --mode pr --ci");
    expect(envelope.requests[0]?.forbiddenActions).toContain("decide_visual_hive_verdict");
    expect(envelopeSummary).toContain("Hive Repair Request Envelope: cli-hive-export");
    expect(consumer.schemaVersion).toBe("visual-hive.hive-trusted-repair-consumer-summary.v1");
    expect(consumer.externalCallsMade).toBe(0);
    expect(consumer.policy.checkoutCode).toBe(false);
    expect(consumer.policy.providerCalls).toBe(false);
    expect(consumer.policy.visualHiveRerun).toBe(false);
    expect(consumer.consumerActions.wouldCheckoutCode).toBe(false);
    expect(consumer.consumerActions.wouldExecuteRepair).toBe(false);
    expect(consumer.consumerActions.wouldCallProviders).toBe(false);
    expect(consumer.readiness.canStartTrustedRepairWorkflow).toBe(true);
    expect(consumerSummary).toContain("Hive Trusted Repair Consumer Summary: cli-hive-export");
    expect(workflowDryRun.schemaVersion).toBe("visual-hive.hive-trusted-repair-workflow-dry-run.v1");
    expect(workflowDryRun.externalCallsMade).toBe(0);
    expect(workflowDryRun.policy.checkoutCode).toBe(false);
    expect(workflowDryRun.policy.branchCreation).toBe(false);
    expect(workflowDryRun.policy.pullRequestCreation).toBe(false);
    expect(workflowDryRun.policy.hiveNetworkCalls).toBe(false);
    expect(workflowDryRun.policy.providerCalls).toBe(false);
    expect(workflowDryRun.policy.visualHiveRerun).toBe(false);
    expect(workflowDryRun.readiness.canRunTrustedRepairWorkflow).toBe(true);
    expect(workflowDryRun.items[0]?.plannedActions.map((action) => action.id)).toContain("open-repair-pull-request");
    expect(workflowSummary).toContain("Hive Trusted Repair Workflow Dry Run: cli-hive-export");
    expect(JSON.stringify(result)).not.toContain("session-secret");
    expect(JSON.stringify(preview)).not.toContain("session-secret");
    expect(JSON.stringify(envelope)).not.toContain("session-secret");
    expect(JSON.stringify(consumer)).not.toContain("session-secret");
    expect(JSON.stringify(workflowDryRun)).not.toContain("session-secret");
    expect(JSON.stringify(validateResult)).not.toContain("C:/Users");
    expect(JSON.stringify(setupPackResult)).not.toContain("C:/Users");
    await expect(access(path.join(tempRoot, ".visual-hive", "hive", "beads.json"))).resolves.toBeUndefined();
    await expect(access(path.join(tempRoot, ".visual-hive", "hive", "hive-beads.json"))).resolves.toBeUndefined();
    await expect(access(path.join(tempRoot, ".visual-hive", "hive", "hive-beads.md"))).resolves.toBeUndefined();
    await expect(access(path.join(tempRoot, ".visual-hive", "hive", "hive-import-manifest.json"))).resolves.toBeUndefined();
    await expect(access(path.join(tempRoot, ".visual-hive", "hive", "hive-validation-summary.json"))).resolves.toBeUndefined();
    await expect(access(path.join(tempRoot, ".visual-hive", "hive", "hive-agent-work-orders.json"))).resolves.toBeUndefined();
    await expect(access(path.join(tempRoot, ".visual-hive", "hive", "hive-setup-pack.json"))).resolves.toBeUndefined();
    await expect(access(path.join(tempRoot, ".visual-hive", "hive", "hive-setup-pack.md"))).resolves.toBeUndefined();
    await expect(access(path.join(tempRoot, ".visual-hive", "hive", "hive-integration-smoke.json"))).resolves.toBeUndefined();
    await expect(access(path.join(tempRoot, ".visual-hive", "hive", "hive-integration-smoke.md"))).resolves.toBeUndefined();
    await expectMatchesSchema("visual-hive.hive-beads.schema.json", await readJson(path.join(tempRoot, ".visual-hive", "hive", "hive-beads.json")));
    await expectMatchesSchema("visual-hive.hive-import-manifest.schema.json", await readJson(path.join(tempRoot, ".visual-hive", "hive", "hive-import-manifest.json")));
    await expectMatchesSchema("visual-hive.hive-validation-summary.schema.json", await readJson(path.join(tempRoot, ".visual-hive", "hive", "hive-validation-summary.json")));
    await expectMatchesSchema("visual-hive.hive-agent-work-orders.schema.json", await readJson(path.join(tempRoot, ".visual-hive", "hive", "hive-agent-work-orders.json")));
    await expectMatchesSchema("visual-hive.hive-setup-pack.schema.json", await readJson(path.join(tempRoot, ".visual-hive", "hive", "hive-setup-pack.json")));
    await expectMatchesSchema("visual-hive.hive-integration-smoke.schema.json", await readJson(path.join(tempRoot, ".visual-hive", "hive", "hive-integration-smoke.json")));
    await expect(access(path.join(tempRoot, ".visual-hive", "hive", "knowledge-graph.json"))).resolves.toBeUndefined();
    await expect(access(path.join(tempRoot, ".visual-hive", "hive", "repair-work-orders.json"))).resolves.toBeUndefined();
    await expect(access(path.join(tempRoot, ".visual-hive", "hive", "hive-agent-policy.json"))).resolves.toBeUndefined();
    await expect(access(path.join(tempRoot, ".visual-hive", "hive", "guarded-repair-preview.md"))).resolves.toBeUndefined();
    await expect(access(path.join(tempRoot, ".visual-hive", "hive", "repair-request-envelope.md"))).resolves.toBeUndefined();
    await expect(access(path.join(tempRoot, ".visual-hive", "hive", "trusted-repair-consumer-summary.md"))).resolves.toBeUndefined();
    await expect(access(path.join(tempRoot, ".visual-hive", "hive", "trusted-repair-workflow-dry-run.md"))).resolves.toBeUndefined();
  }, 15_000);

  it("writes a no-network Hive mode comparison with separate mode previews", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-cli-hive-modes-"));
    tempDirs.push(tempRoot);
    await writeFile(
      path.join(tempRoot, "visual-hive.config.yaml"),
      `project:
  name: cli-hive-modes
targets:
  local:
    kind: url
    url: "http://127.0.0.1:4173"
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
integrations:
  hive:
    enabled: true
    mode: advisory
`,
      "utf8"
    );
    await writeJson(path.join(tempRoot, ".visual-hive", "report.json"), {
      schemaVersion: 2,
      project: "cli-hive-modes",
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
    await runHandoffCommand({ cwd: tempRoot });
    const result = await runHiveCompareModesCommand({ cwd: tempRoot });
    const summary = formatHiveModeComparison(result);

    expect(result.comparison.schemaVersion).toBe("visual-hive.hive-mode-comparison.v1");
    expect(result.comparison.externalCallsMade).toBe(0);
    expect(result.comparison.modes.map((mode) => mode.mode)).toEqual(["advisory", "measured", "repair_request", "guarded_repair", "full"]);
    expect(result.comparison.recommendation.mode).toBe("repair_request");
    expect(result.comparison.modes.find((mode) => mode.mode === "guarded_repair")?.status).toBe("blocked");
    expect(result.comparison.modes.find((mode) => mode.mode === "full")?.blockedReasons).toEqual(
      expect.arrayContaining(["Full Hive automation is reserved for a future ACMM L6-compatible workflow and is blocked locally."])
    );
    expect(summary).toContain("Hive Export Mode Comparison: cli-hive-modes");
    expect(JSON.stringify(result.comparison)).not.toContain("secret-value");
    await expect(access(path.join(tempRoot, ".visual-hive", "hive", "mode-comparison.json"))).resolves.toBeUndefined();
    await expect(access(path.join(tempRoot, ".visual-hive", "hive", "mode-comparison.md"))).resolves.toBeUndefined();
    await expect(access(path.join(tempRoot, ".visual-hive", "hive", "modes", "advisory", "hive-export.json"))).resolves.toBeUndefined();
    await expect(access(path.join(tempRoot, ".visual-hive", "hive", "modes", "measured", "knowledge-graph.json"))).resolves.toBeUndefined();
    await expect(access(path.join(tempRoot, ".visual-hive", "hive", "modes", "repair_request", "repair-work-orders.json"))).resolves.toBeUndefined();
    await expect(access(path.join(tempRoot, ".visual-hive", "hive", "modes", "guarded_repair", "hive-export.json"))).resolves.toBeUndefined();
    await expect(access(path.join(tempRoot, ".visual-hive", "hive", "modes", "full", "hive-export.json"))).resolves.toBeUndefined();
  }, 15_000);

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
    expect(packet.allowedTools.map((tool) => tool.id)).toContain("visual_hive_read_triage_report");
    expect(packet.allowedTools.find((tool) => tool.id === "visual_hive_read_triage_report")).toMatchObject({
      evidenceResourceId: "triage-report",
      evidenceResourceUri: "visual-hive://triage-report",
      evidenceReadToolName: "visual_hive_read_triage_report",
      artifactPath: ".visual-hive/triage.json"
    });
    expect(packet.allowedTools.map((tool) => tool.id)).toContain("visual_hive_read_missing_tests");
    expect(packet.allowedTools.find((tool) => tool.id === "visual_hive_read_missing_tests")).toMatchObject({
      evidenceResourceId: "missing-tests",
      evidenceResourceUri: "visual-hive://missing-tests",
      evidenceReadToolName: "visual_hive_read_missing_tests",
      artifactPath: ".visual-hive/missing-tests.md"
    });
    expect(packet.allowedTools.map((tool) => tool.id)).toContain("visual_hive_read_testing_layers");
    expect(packet.allowedTools.map((tool) => tool.id)).toContain("visual_hive_read_coverage_recommendations");
    expect(packet.allowedTools.map((tool) => tool.id)).toContain("visual_hive_read_test_creation_plan");
    expect(packet.allowedTools.map((tool) => tool.id)).toContain("visual_hive_read_mutation_report");
    expect(packet.forbiddenActions).toContain("decide_visual_hive_verdict");
    expect(packet.budgets.allowExternalNetwork).toBe(false);
    expect(summary).toContain("Agent Packet: cli-agent-packet");
    expect(summary).toContain("External network allowed: false");
    expect(JSON.stringify(packet)).not.toContain("secret-value");

    const providerResult = await runAgentPacketCommand({
      cwd: tempRoot,
      profile: "provider_specialist",
      output: ".visual-hive/provider-agent-packet.json"
    });
    const providerPacket = await readJson<typeof providerResult.packet>(providerResult.packetPath);
    expect(providerPacket.profile).toBe("provider_specialist");
    expect(providerPacket.allowedTools.map((tool) => tool.id)).toEqual(
      expect.arrayContaining([
        "visual_hive_read_provider_results",
        "visual_hive_read_provider_upload_manifest",
        "visual_hive_read_provider_agent_packet",
        "visual_hive_provider_handoff_dry_run"
      ])
    );
    expect(providerPacket.budgets.allowExternalNetwork).toBe(false);
    expect(providerPacket.budgets.maxExternalCostUsd).toBe(0);
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
viewports:
  desktop:
    width: 1280
    height: 720
contracts:
  - id: dashboard
    description: Dashboard
    target: local
    selectors:
      mustExist:
        - ".mapped-dashboard"
    screenshots:
      - name: dashboard
        route: "/mapped-dashboard"
        viewport: desktop
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
    await runAnalyzeCommand({ repo: tempRoot });
    const testCreation = await runTestCreationPlanCommand({ cwd: tempRoot });
    const testCreationSummary = formatTestCreationPlan(testCreation);
    const agent = await runAgentPacketCommand({ cwd: tempRoot, profile: "test_creator" });
    const agentSummary = formatAgentPacketResult(agent);
    const plan = await readJson<typeof testCreation.plan>(testCreation.planPath);
    const packet = await readJson<typeof agent.packet>(agent.packetPath);

    expect(plan.schemaVersion).toBe("visual-hive.test-creation-plan.v2");
    expect(plan.governance.writePolicy).toBe("no_config_or_test_files_written");
    expect(plan.summary.total).toBeGreaterThan(0);
    expect(plan.summary.fromCoverageRecommendations).toBe(1);
    expect(plan.recommendations.find((recommendation) => recommendation.coverageRecommendationId === "selectors:dashboard")).toMatchObject({
      grounding: { status: "grounded" },
      suggestedContract: { route: "/mapped-dashboard", selectors: [".mapped-dashboard"] }
    });
    expect(plan.sourceArtifacts.evidencePacket).toBe(".visual-hive/evidence-packet.json");
    expect(plan.sourceArtifacts.handoffPacket).toBe(".visual-hive/handoff.json");
    expect(testCreationSummary).toContain("Test Creation Plan: cli-test-creation");
    expect(packet.profile).toBe("test_creator");
    expect(packet.sourceArtifacts.testCreationPlan).toBe(".visual-hive/test-creation-plan.json");
    expect(packet.evidenceSummary.testCreationRecommendations.length).toBeGreaterThan(0);
    expect(packet.evidenceSummary.testCreationRecommendations).toEqual(
      expect.arrayContaining([expect.objectContaining({ grounding: expect.objectContaining({ status: "grounded" }) })])
    );
    expect(agentSummary).toContain("Test creation plan: .visual-hive/test-creation-plan.json");
    expect(JSON.stringify({ plan, packet })).not.toContain("secret-value");
    expect(JSON.stringify({ plan, packet })).not.toContain("coverage-secret");
    await expect(access(path.join(tempRoot, ".visual-hive", "test-creation-plan.json"))).resolves.toBeUndefined();
    await expect(access(path.join(tempRoot, ".visual-hive", "test-creation-plan.md"))).resolves.toBeUndefined();

    const wrongRootMap = await readJson<Record<string, unknown>>(path.join(tempRoot, ".visual-hive", "repo-map.json"));
    await writeJson(path.join(tempRoot, ".visual-hive", "repo-map.json"), { ...wrongRootMap, repoRoot: ".." });
    await expect(runTestCreationPlanCommand({ cwd: tempRoot })).rejects.toThrow("does not belong to the loaded repository root");
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

  it("verifies checked-in schema catalog parity from the CLI", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-cli-schemas-"));
    tempDirs.push(tempRoot);

    const result = await runSchemasVerifyCommand({
      cwd: repoRoot,
      output: path.relative(repoRoot, path.join(tempRoot, "schema-catalog.json"))
    });
    const summary = formatSchemasVerifyResult(result);
    const written = await readJson<typeof result.report>(path.join(tempRoot, "schema-catalog.json"));

    expect(result.report.status).toBe("passed");
    expect(written.schemaVersion).toBe("visual-hive.schema-catalog.v1");
    expect(summary).toContain("Schema Catalog Verification");
    expect(summary).toContain("Status: passed");
    expect(summary).toContain(`Evidence resources: ${VISUAL_HIVE_EVIDENCE_RESOURCES.length}`);
  });

  it("describes setup-only MCP resources before a config exists", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-cli-mcp-setup-"));
    tempDirs.push(tempRoot);
    await writeJson(path.join(tempRoot, ".visual-hive", "recommendations.json"), {
      schemaVersion: 1,
      project: "setup-only",
      outputResource: {
        evidenceResourceId: "setup-recommendations",
        evidenceResourceUri: "visual-hive://setup-recommendations",
        artifactPath: ".visual-hive/recommendations.json",
        evidenceReadToolName: "visual_hive_read_setup_recommendations"
      }
    });
    await writeJson(path.join(tempRoot, ".visual-hive", "setup-pr-plan.json"), {
      schemaVersion: 1,
      project: "setup-only",
      summary: { externalCallsMade: 0 },
      outputResource: {
        evidenceResourceId: "setup-pr-plan",
        evidenceResourceUri: "visual-hive://setup-pr-plan",
        artifactPath: ".visual-hive/setup-pr-plan.json",
        evidenceReadToolName: "visual_hive_read_setup_pr_plan"
      }
    });

    const artifactIndex = await runArtifactsCommand({ cwd: repoRoot, repo: tempRoot, project: "setup-only" });
    const manifest = await runMcpCommand({ cwd: repoRoot, repo: tempRoot, project: "setup-only", output: ".visual-hive/mcp-manifest.json" });
    const writtenManifest = await readJson<typeof manifest>(path.join(tempRoot, ".visual-hive", "mcp-manifest.json"));
    const summary = formatMcpManifest(manifest);

    await expectMatchesSchema("visual-hive.mcp.schema.json", writtenManifest);
    expect(manifest.project).toBe("setup-only");
    expect(manifest.server.externalCallsMade).toBe(0);
    expect(manifest.resources.map((resource) => resource.id)).toEqual([
      "setup-recommendations",
      "setup-pr-plan",
      "repo-map",
      "repo-context",
      "artifacts-index",
      "mcp-manifest"
    ]);
    expect(manifest.tools.map((tool) => tool.name)).toEqual([
      "visual_hive_recommend_setup",
      "visual_hive_read_setup_recommendations",
      "visual_hive_read_setup_pr_plan",
      "visual_hive_read_repo_map",
      "visual_hive_read_repo_context",
      "visual_hive_read_artifacts_index",
      "visual_hive_read_mcp_manifest"
    ]);
    expect(summary).toContain("Visual Hive MCP: setup-only");
    expect(summary).toContain("setup-recommendations: visual-hive://setup-recommendations -> .visual-hive/recommendations.json");
    expect(artifactIndex.index.artifacts.find((artifact) => artifact.evidenceResourceId === "setup-pr-plan")).toBeTruthy();
    await expect(runMcpCommand({ cwd: repoRoot, repo: tempRoot, stdio: true })).rejects.toThrow("manifest-only");
  });

  it("describes a read-only MCP surface over existing Visual Hive artifacts", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-cli-mcp-"));
    tempDirs.push(tempRoot);
    await writeFile(
      path.join(tempRoot, "visual-hive.config.yaml"),
      `project:
  name: cli-mcp
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
      project: "cli-mcp",
      status: "failed",
      reproductionCommands: ["visual-hive run --token=secret-value"],
      results: [
        {
          contractId: "dashboard",
          status: "failed",
          reproductionCommand: "visual-hive run --password=secret-value"
        }
      ]
    });
    await writeJson(path.join(tempRoot, ".visual-hive", "mutation-report.json"), {
      schemaVersion: 2,
      project: "cli-mcp",
      results: [{ operator: "force-login-on-demo", status: "survived" }]
    });
    await writeJson(path.join(tempRoot, ".visual-hive", "evidence-packet.json"), {
      schemaVersion: "visual-hive.evidence-packet.v2",
      project: "cli-mcp",
      verdictSummary: {
        visualHiveVerdict: "failed",
        failedBecause: ["playwright.selector_contract.dashboard"],
        blockedBecause: [],
        advisoryOnly: []
      }
    });
    await writeJson(path.join(tempRoot, ".visual-hive", "control-plane-snapshot.json"), {
      schemaVersion: 1,
      project: "cli-mcp",
      generatedAt: "2026-07-03T00:00:00.000Z",
      guidanceState: {
        lifecycleState: "failures_need_triage",
        primaryAction: {
          id: "review-failures",
          label: "Review failures",
          commandId: "triage"
        }
      },
      adoptionChecklist: [
        {
          id: "plan-pr",
          step: "Plan PR-safe checks",
          status: "done",
          why: "Planning evidence exists.",
          nextAction: "Review plan.",
          area: "Run",
          commandRunnable: true,
          expectedArtifacts: [".visual-hive/plan.json"]
        }
      ],
      navigationBadges: {
        failures: 1,
        baselines: 0,
        risks: 0,
        missingSetup: 0,
        providerBlocks: 0
      },
      secretLikeMessage: "token=secret-value"
    });
    await writeJson(path.join(tempRoot, ".visual-hive", "handoff.json"), {
      schemaVersion: "visual-hive.handoff.v1",
      project: "cli-mcp",
      mode: "dry_run",
      status: "ready",
      externalCallsMade: 0
    });
    await writeJson(path.join(tempRoot, ".visual-hive", "hive-handoff-validation.json"), {
      schemaVersion: "visual-hive.handoff-validation.v1",
      project: "cli-mcp",
      status: "passed",
      summary: {
        externalCallsMade: 0
      }
    });
    await writeJson(path.join(tempRoot, ".visual-hive", "hive", "hive-export.json"), {
      schemaVersion: "visual-hive.hive-export.v1",
      project: "cli-mcp",
      mode: "measured",
      externalCallsMade: 0,
      summary: {
        beads: 1,
        knowledgeFacts: 1,
        graphNodes: 2,
        graphEdges: 1,
        repairWorkOrders: 0,
        blockedReasons: 0
      },
      agentPolicy: {
        verdictAuthority: "visual_hive"
      }
    });
    await writeJson(path.join(tempRoot, ".visual-hive", "hive", "beads.json"), [
      {
        id: "vh-bead-1",
        title: "Repair dashboard without token=secret-value",
        type: "bug",
        status: "open",
        priority: 1,
        actor: "quality",
        external_ref: "visual-hive://latest-evidence",
        metadata: {},
        notes: "No external Hive call was made.",
        created_at: "2026-07-03T00:00:00.000Z",
        updated_at: "2026-07-03T00:00:00.000Z",
        depends_on: []
      }
    ]);
    await writeJson(path.join(tempRoot, ".visual-hive", "hive", "hive-agent-work-orders.json"), {
      schemaVersion: "visual-hive.hive-agent-work-orders.v1",
      project: "cli-mcp",
      workOrders: [
        {
          id: "vh-work-order-1",
          title: "Repair dashboard",
          externalRef: "visual-hive://latest-evidence",
          dedupeFingerprint: "visual-hive://latest-evidence",
          agentProfile: "hive_quality_agent",
          allowedActions: ["inspect_artifacts"],
          forbiddenActions: ["decide_verdict", "approve_baseline"],
          validationCommand: "visual-hive pipeline --mode pr --ci"
        }
      ],
      policy: {
        visualHiveVerdictAuthority: true,
        noWriteDefault: true
      }
    });
    await writeJson(path.join(tempRoot, ".visual-hive", "hive", "knowledge-facts.json"), [
      {
        id: "vh-fact-1",
        kind: "regression",
        title: "Dashboard failure",
        body: "Dashboard evidence redacts client_secret=secret-value.",
        source: "visual-hive",
        confidence: 0.9,
        tags: ["visual-hive"],
        artifacts: [".visual-hive/report.json"],
        createdAt: "2026-07-03T00:00:00.000Z"
      }
    ]);
    await writeJson(path.join(tempRoot, ".visual-hive", "hive", "knowledge-graph.json"), {
      nodes: [{ id: "vh-fact-1", kind: "fact", label: "Dashboard failure", metadata: { secret: "token=secret-value" } }],
      edges: [{ id: "edge-1", from: "vh-fact-1", to: "vh-bead-1", relation: "derived_from" }]
    });
    await writeJson(path.join(tempRoot, ".visual-hive", "hive", "repair-work-orders.json"), [
      {
        id: "vh-repair-1",
        title: "Repair dashboard",
        type: "repair",
        status: "blocked",
        actor: "quality",
        objective: "Use evidence without bearer secret-value.",
        evidenceArtifacts: [".visual-hive/report.json"],
        reproductionCommands: ["visual-hive run --authorization=Bearer secret-value"],
        acceptanceCriteria: ["Visual Hive passes"],
        forbiddenActions: ["decide_verdict"],
        requiredCommands: ["visual-hive pipeline --mode pr --ci"],
        requiresHumanReview: true,
        branchPrefix: "hive/visual-hive-",
        maxAttempts: 1
      }
    ]);
    await writeJson(path.join(tempRoot, ".visual-hive", "hive", "hive-agent-policy.json"), {
      verdictAuthority: "visual_hive",
      allowedActors: ["quality"],
      forbiddenActions: ["decide_verdict", "read_secret_value"],
      requiredApprovals: ["human_review"],
      budgets: {
        maxAttempts: 1,
        maxToolCalls: 20,
        maxExternalCostUsd: 0
      },
      repairPolicy: {
        prOnly: true,
        requireHumanReview: true,
        rerunVisualHive: true,
        branchPrefix: "hive/visual-hive-"
      },
      notes: ["Never expose cookie=secret-value."]
    });
    await writeJson(path.join(tempRoot, ".visual-hive", "hive", "mode-comparison.json"), {
      schemaVersion: "visual-hive.hive-mode-comparison.v1",
      project: "cli-mcp",
      externalCallsMade: 0,
      recommendedMode: "measured",
      recommendationReason: "Measured mode exposes deterministic evidence without repair execution.",
      modes: [
        {
          mode: "advisory",
          status: "ready",
          externalCallsMade: 0,
          artifacts: [".visual-hive/hive/modes/advisory/issue-context.md"]
        },
        {
          mode: "measured",
          status: "ready",
          externalCallsMade: 0,
          artifacts: [".visual-hive/hive/modes/measured/hive-export.json"]
        }
      ]
    });
    await writeJson(path.join(tempRoot, ".visual-hive", "hive", "guarded-repair-preview.json"), {
      schemaVersion: "visual-hive.hive-guarded-repair-preview.v1",
      project: "cli-mcp",
      status: "blocked",
      externalCallsMade: 0,
      readiness: {
        canRequestGuardedRepair: false,
        blockedReasons: ["No repair work orders are available; token=secret-value"],
        requiredCommands: ["visual-hive pipeline --mode pr --ci"],
        requiredApprovals: ["human review before merge"]
      }
    });
    await writeJson(path.join(tempRoot, ".visual-hive", "hive", "repair-request-envelope.json"), {
      schemaVersion: "visual-hive.hive-repair-request-envelope.v1",
      project: "cli-mcp",
      status: "blocked",
      externalCallsMade: 0,
      readiness: {
        canOpenTrustedRepairRequest: false,
        blockedReasons: ["No guarded repair request is ready; token=secret-value"],
        requiredCommands: ["visual-hive pipeline --mode pr --ci"],
        requiredApprovals: ["human review before merge"]
      }
    });
    await writeJson(path.join(tempRoot, ".visual-hive", "hive", "trusted-repair-consumer-summary.json"), {
      schemaVersion: "visual-hive.hive-trusted-repair-consumer-summary.v1",
      project: "cli-mcp",
      status: "blocked",
      externalCallsMade: 0,
      policy: {
        verdictAuthority: "visual_hive",
        consumerExecution: "dry_run_summary_only",
        repairExecution: "not_executed_by_visual_hive",
        checkoutCode: false,
        branchCreation: false,
        pullRequestCreation: false,
        issueCreation: false,
        hiveNetworkCalls: false,
        providerCalls: false,
        visualHiveRerun: false,
        requiresTrustedWorkflow: true,
        secretsPolicy: "names_only_values_redacted"
      },
      readiness: {
        canStartTrustedRepairWorkflow: false,
        blockedReasons: ["No trusted repair request is ready; token=secret-value"],
        requiredCommands: ["visual-hive pipeline --mode pr --ci"],
        requiredApprovals: ["human review before merge"]
      },
      consumerActions: {
        wouldCheckoutCode: false,
        wouldExecuteRepair: false,
        wouldCreateBranches: false,
        wouldOpenPullRequests: false,
        wouldCreateIssues: false,
        wouldCallHiveApi: false,
        wouldCallProviders: false,
        wouldRunVisualHive: false
      }
    });
    await writeJson(path.join(tempRoot, ".visual-hive", "hive", "trusted-repair-workflow-dry-run.json"), {
      schemaVersion: "visual-hive.hive-trusted-repair-workflow-dry-run.v1",
      project: "cli-mcp",
      status: "blocked",
      externalCallsMade: 0,
      policy: {
        verdictAuthority: "visual_hive",
        workflowExecution: "dry_run_only",
        repairExecution: "not_executed_by_visual_hive",
        checkoutCode: false,
        branchCreation: false,
        pullRequestCreation: false,
        issueCreation: false,
        hiveNetworkCalls: false,
        providerCalls: false,
        visualHiveRerun: false,
        requiresTrustedWorkflow: true,
        secretsPolicy: "names_only_values_redacted"
      },
      readiness: {
        canRunTrustedRepairWorkflow: false,
        blockedReasons: ["No trusted repair workflow is ready; token=secret-value"],
        requiredCommands: ["visual-hive pipeline --mode pr --ci"],
        requiredApprovals: ["human review before merge"]
      }
    });
    await writeJson(path.join(tempRoot, ".visual-hive", "verdict.json"), {
      schemaVersion: "visual-hive.verdict.v1",
      project: "cli-mcp",
      summary: {
        visualHiveVerdict: "failed",
        failedBecause: ["playwright.selector_contract.dashboard"]
      }
    });
    await writeJson(path.join(tempRoot, ".visual-hive", "readiness.json"), {
      schemaVersion: 1,
      project: "cli-mcp",
      generatedAt: "2026-07-03T00:00:00.000Z",
      status: "blocked",
      score: 58,
      summary: {
        total: 2,
        passed: 0,
        blocked: 1,
        warnings: 1,
        missing: 0
      },
      gates: [
        {
          id: "workflow:safety",
          category: "workflow",
          status: "blocked",
          title: "Workflow safety",
          message: "Workflow uses authorization: Bearer secret-value",
          artifacts: [".visual-hive/workflows.json"]
        }
      ],
      nextActions: ["Fix workflow safety without exposing token=secret-value"],
      inputs: {}
    });
    await writeJson(path.join(tempRoot, ".visual-hive", "agent-packet.json"), {
      schemaVersion: "visual-hive.agent-packet.v1",
      project: "cli-mcp",
      profile: "repair_agent",
      objective: "Repair dashboard without using client_secret=secret-value"
    });
    await writeJson(path.join(tempRoot, ".visual-hive", "tools", "tool-registry.json"), {
      schemaVersion: "visual-hive.tool-registry.v1",
      project: "cli-mcp",
      policy: {
        exposeThirdPartyMcp: false
      }
    });
    await writeJson(path.join(tempRoot, ".visual-hive", "context-ledger.json"), {
      schemaVersion: "visual-hive.context-ledger.v1",
      project: "cli-mcp",
      budgets: {
        externalCostUsd: 0
      },
      toolCalls: [
        {
          id: "triage",
          source: "pipeline",
          toolId: "visual_hive_triage",
          label: "Triage deterministic evidence",
          access: "local_execution",
          status: "passed",
          trustedOnly: false,
          externalNetwork: false,
          evidenceResourceId: "triage-report",
          evidenceResourceUri: "visual-hive://triage-report",
          evidenceResourceTitle: "Triage Report",
          evidenceResourceDescription: "Read deterministic triage classifications, likely causes, suggested files, and suggested tests.",
          evidenceReadToolName: "visual_hive_read_triage_report",
          evidenceResources: [
            {
              evidenceResourceId: "triage-report",
              evidenceResourceUri: "visual-hive://triage-report",
              evidenceResourceTitle: "Triage Report",
              evidenceResourceDescription: "Read deterministic triage classifications, likely causes, suggested files, and suggested tests.",
              evidenceReadToolName: "visual_hive_read_triage_report",
              artifactPath: ".visual-hive/triage.json"
            },
            {
              evidenceResourceId: "issue-body",
              evidenceResourceUri: "visual-hive://issue-body",
              evidenceResourceTitle: "GitHub Issue Body",
              evidenceResourceDescription: "Read sanitized GitHub issue Markdown generated from deterministic Visual Hive evidence.",
              evidenceReadToolName: "visual_hive_read_issue_body",
              artifactPath: ".visual-hive/issue.md"
            },
            {
              evidenceResourceId: "missing-tests",
              evidenceResourceUri: "visual-hive://missing-tests",
              evidenceResourceTitle: "Missing Tests",
              evidenceResourceDescription: "Read missing-test recommendations derived from coverage gaps and mutation survivors.",
              evidenceReadToolName: "visual_hive_read_missing_tests",
              artifactPath: ".visual-hive/missing-tests.md"
            }
          ],
          estimatedResultTokens: 600,
          artifacts: [".visual-hive/triage.json", ".visual-hive/issue.md", ".visual-hive/missing-tests.md"],
          reason: "Recorded from .visual-hive/pipeline.json with token=secret-value."
        }
      ]
    });
    await writeJson(path.join(tempRoot, ".visual-hive", "provider-results.json"), {
      schemaVersion: 1,
      project: "cli-mcp",
      generatedAt: "2026-07-03T00:00:00.000Z",
      providers: [
        {
          id: "argos",
          result: {
            providerId: "argos",
            name: "Argos",
            status: "failed",
            deterministicRole: "supplemental",
            externalCallsMade: 1,
            message: "Upload failed with token=secret-value",
            upload: {
              status: "failed",
              externalCallsMade: 1,
              stagedArtifacts: 1,
              uploadedArtifacts: 0,
              manifestPath: ".visual-hive/provider-upload/argos/manifest.json",
              uploadDirectory: ".visual-hive/provider-upload/argos",
              command: "argos upload --token secret-value",
              stderr: "authorization: Bearer secret-value"
            }
          }
        }
      ]
    });
    await writeJson(path.join(tempRoot, ".visual-hive", "provider-decisions.json"), {
      schemaVersion: 1,
      generatedAt: "2026-07-03T00:00:00.000Z",
      outputResource: {
        artifactPath: ".visual-hive/provider-decisions.json",
        evidenceResourceId: "provider-decisions",
        evidenceResourceUri: "visual-hive://provider-decisions",
        evidenceResourceTitle: "Provider Decisions",
        evidenceResourceDescription: "Local optional provider governance decisions.",
        evidenceReadToolName: "visual_hive_read_provider_decisions"
      },
      decisions: [
        {
          providerId: "argos",
          decision: "review_later",
          reason: "Review later with token=secret-value",
          decidedAt: "2026-07-03T00:00:00.000Z",
          source: "cli",
          externalCallsMade: 0
        }
      ]
    });
    await writeJson(path.join(tempRoot, ".visual-hive", "provider-upload", "argos", "manifest.json"), {
      schemaVersion: 1,
      providerId: "argos",
      dryRun: true,
      externalCallsMade: 0,
      stagedArtifacts: [{ sourcePath: ".visual-hive/artifacts/screenshots/dashboard.png", stagedPath: ".visual-hive/provider-upload/argos/screenshots/dashboard.png" }],
      command: "argos upload --token secret-value",
      stdout: "uploaded with access_token=secret-value",
      stderr: "set-cookie: session=secret-value"
    });
    await writeJson(path.join(tempRoot, ".visual-hive", "pipeline.json"), {
      schemaVersion: 1,
      project: "cli-mcp",
      status: "completed",
      steps: [{ id: "evidence", status: "passed", message: "authorization: Bearer secret-value" }]
    });
    await writeFile(path.join(tempRoot, ".visual-hive", "repair-prompt.md"), "Repair dashboard without using token=secret-value.", "utf8");

    const manifest = await runMcpCommand({ cwd: tempRoot, output: ".visual-hive/mcp-manifest.json" });
    const summary = formatMcpManifest(manifest);
    const loaded = await loadConfig(undefined, tempRoot);
    const writtenManifest = await readJson<typeof manifest>(path.join(tempRoot, ".visual-hive", "mcp-manifest.json"));
    const evidenceResource = manifest.resources.find((resource) => resource.uri === "visual-hive://latest-evidence");
    const controlPlaneSnapshotResource = manifest.resources.find((resource) => resource.uri === "visual-hive://control-plane-snapshot");
    const configResource = manifest.resources.find((resource) => resource.uri === "visual-hive://config");
    const verdictResource = manifest.resources.find((resource) => resource.uri === "visual-hive://latest-verdict");
    const readinessResource = manifest.resources.find((resource) => resource.uri === "visual-hive://readiness-gate");
    const agentPacketResource = manifest.resources.find((resource) => resource.uri === "visual-hive://agent-packet");
    const handoffValidationResource = manifest.resources.find((resource) => resource.uri === "visual-hive://handoff-validation");
    const hiveExportResource = manifest.resources.find((resource) => resource.uri === "visual-hive://hive-export");
    const hiveGuardedRepairPreviewResource = manifest.resources.find((resource) => resource.uri === "visual-hive://hive-guarded-repair-preview");
    const hiveRepairRequestEnvelopeResource = manifest.resources.find((resource) => resource.uri === "visual-hive://hive-repair-request-envelope");
    const hiveTrustedRepairConsumerSummaryResource = manifest.resources.find((resource) => resource.uri === "visual-hive://hive-trusted-repair-consumer-summary");
    const hiveTrustedRepairWorkflowDryRunResource = manifest.resources.find((resource) => resource.uri === "visual-hive://hive-trusted-repair-workflow-dry-run");
    const hiveModeComparisonResource = manifest.resources.find((resource) => resource.uri === "visual-hive://hive-mode-comparison");
    const hiveBeadsResource = manifest.resources.find((resource) => resource.uri === "visual-hive://hive-beads");
    const hiveKnowledgeFactsResource = manifest.resources.find((resource) => resource.uri === "visual-hive://hive/knowledge-facts");
    const hiveKnowledgeGraphResource = manifest.resources.find((resource) => resource.uri === "visual-hive://hive/knowledge-graph");
    const hiveRepairWorkOrdersResource = manifest.resources.find((resource) => resource.uri === "visual-hive://hive/repair-work-orders");
    const hiveAgentPolicyResource = manifest.resources.find((resource) => resource.uri === "visual-hive://hive/agent-policy");
    const contextLedgerResource = manifest.resources.find((resource) => resource.uri === "visual-hive://context-ledger");
    const providerDecisionsResource = manifest.resources.find((resource) => resource.uri === "visual-hive://provider-decisions");
    const providerResultsResource = manifest.resources.find((resource) => resource.uri === "visual-hive://provider-results");
    const providerUploadResource = manifest.resources.find((resource) => resource.uri === "visual-hive://provider-upload/argos/manifest");
    const pipelineResource = manifest.resources.find((resource) => resource.uri === "visual-hive://pipeline-status");

    expect(manifest.schemaVersion).toBe("visual-hive.mcp.v1");
    await expectMatchesSchema("visual-hive.mcp.schema.json", writtenManifest);
    expect(manifest.server.defaultAccess).toBe("read_only");
    expect(manifest.server.externalCallsMade).toBe(0);
    expect(manifest.resources.map((resource) => resource.uri)).toEqual(VISUAL_HIVE_EVIDENCE_RESOURCES.map((resource) => resource.uri));
    for (const resource of VISUAL_HIVE_EVIDENCE_RESOURCES) {
      const manifestResource = manifest.resources.find((item) => item.uri === resource.uri);
      expect(manifestResource, `${resource.uri} should be exposed by MCP`).toMatchObject({
        id: resource.id,
        name: resource.name,
        title: resource.title,
        description: resource.description,
        mimeType: resource.mimeType
      });
      if (resource.readTool) {
        expect(manifestResource?.readToolName).toBe(resource.readTool.name);
      } else {
        expect(manifestResource).not.toHaveProperty("readToolName");
      }
      if (resource.uri !== "visual-hive://config") {
        expect(manifestResource?.relativePath).toBe(resource.relativePath);
      }
      if (resource.readTool) {
        expect(manifest.tools.find((tool) => tool.name === resource.readTool?.name)).toMatchObject({
          title: resource.readTool.title,
          description: resource.readTool.description,
          mode: "read_only"
        });
      }
    }
    expect(manifest.tools.map((tool) => tool.name)).toContain("visual_hive_doctor");
    expect(manifest.tools.map((tool) => tool.name)).toContain("visual_hive_recommend_setup");
    expect(manifest.tools.map((tool) => tool.name)).toContain("visual_hive_plan");
    expect(manifest.tools.map((tool) => tool.name)).toContain("visual_hive_read_plan_lanes");
    expect(manifest.tools.map((tool) => tool.name)).toContain("visual_hive_read_evidence_packet");
    expect(manifest.tools.map((tool) => tool.name)).toContain("visual_hive_read_control_plane_snapshot");
    expect(manifest.tools.map((tool) => tool.name)).toContain("visual_hive_read_verdict");
    expect(manifest.tools.map((tool) => tool.name)).toContain("visual_hive_read_readiness_gate");
    expect(manifest.tools.map((tool) => tool.name)).toContain("visual_hive_read_agent_packet");
    expect(manifest.tools.map((tool) => tool.name)).toContain("visual_hive_read_tool_registry");
    expect(manifest.tools.map((tool) => tool.name)).toContain("visual_hive_read_context_ledger");
    expect(manifest.tools.map((tool) => tool.name)).toContain("visual_hive_read_provider_decisions");
    expect(manifest.tools.map((tool) => tool.name)).toContain("visual_hive_read_provider_results");
    expect(manifest.tools.map((tool) => tool.name)).toContain("visual_hive_read_provider_upload_manifest");
    expect(manifest.tools.map((tool) => tool.name)).toContain("visual_hive_read_pipeline_status");
    expect(manifest.tools.map((tool) => tool.name)).toContain("visual_hive_read_schema_catalog");
    expect(manifest.tools.map((tool) => tool.name)).toContain("visual_hive_validate_handoff");
    expect(manifest.tools.map((tool) => tool.name)).toContain("visual_hive_get_hive_export");
    expect(manifest.tools.map((tool) => tool.name)).toContain("visual_hive_list_hive_beads");
    expect(manifest.tools.map((tool) => tool.name)).toContain("visual_hive_get_hive_bead_context");
    expect(manifest.tools.map((tool) => tool.name)).toContain("visual_hive_get_hive_agent_work_order");
    expect(manifest.tools.map((tool) => tool.name)).toContain("visual_hive_read_hive_export");
    expect(manifest.tools.map((tool) => tool.name)).toContain("visual_hive_read_hive_beads");
    expect(manifest.tools.map((tool) => tool.name)).toContain("visual_hive_read_hive_knowledge_facts");
    expect(manifest.tools.map((tool) => tool.name)).toContain("visual_hive_read_hive_knowledge_graph");
    expect(manifest.tools.map((tool) => tool.name)).toContain("visual_hive_read_hive_repair_work_orders");
    expect(manifest.tools.map((tool) => tool.name)).toContain("visual_hive_read_hive_agent_policy");
    expect(manifest.tools.map((tool) => tool.name)).toContain("visual_hive_read_hive_guarded_repair_preview");
    expect(manifest.tools.map((tool) => tool.name)).toContain("visual_hive_read_hive_repair_request_envelope");
    expect(manifest.tools.map((tool) => tool.name)).toContain("visual_hive_read_hive_trusted_repair_consumer_summary");
    expect(manifest.tools.map((tool) => tool.name)).toContain("visual_hive_read_hive_trusted_repair_workflow_dry_run");
    expect(manifest.tools.map((tool) => tool.name)).toContain("visual_hive_read_hive_mode_comparison");
    expect(manifest.tools.map((tool) => tool.name)).not.toContain("visual_hive_run");
    expect(manifest.tools.map((tool) => tool.name)).not.toContain("visual_hive_apply_patch");
    expect(manifest.tools.map((tool) => tool.name)).not.toContain("visual_hive_open_pr");
    expect(manifest.disabledExecutionTools.map((tool) => tool.name)).toContain("visual_hive_run");
    expect(manifest.disabledExecutionTools.map((tool) => tool.name)).toContain("visual_hive_hive_repair");
    expect(manifest.disabledExecutionTools.map((tool) => tool.name)).toContain("visual_hive_apply_patch");
    expect(manifest.disabledExecutionTools.map((tool) => tool.name)).toContain("visual_hive_open_pr");
    expect(manifest.policy.externalUploadsFromPr).toBe(false);
    expect(summary).toContain("Visual Hive MCP: cli-mcp");
    expect(summary).toContain("latest-evidence: visual-hive://latest-evidence -> .visual-hive/evidence-packet.json; read tool: visual_hive_read_evidence_packet");
    expect(summary).toContain(
      "control-plane-snapshot: visual-hive://control-plane-snapshot -> .visual-hive/control-plane-snapshot.json; read tool: visual_hive_read_control_plane_snapshot"
    );
    expect(summary).toContain(
      "provider-upload-argos-manifest: visual-hive://provider-upload/argos/manifest -> .visual-hive/provider-upload/argos/manifest.json; read tool: visual_hive_read_provider_upload_manifest"
    );
    expect(evidenceResource).toBeDefined();
    expect(controlPlaneSnapshotResource).toBeDefined();
    expect(configResource).toBeDefined();
    expect(verdictResource).toBeDefined();
    expect(readinessResource).toBeDefined();
    expect(agentPacketResource).toBeDefined();
    expect(handoffValidationResource).toBeDefined();
    expect(hiveExportResource).toBeDefined();
    expect(hiveGuardedRepairPreviewResource).toBeDefined();
    expect(hiveRepairRequestEnvelopeResource).toBeDefined();
    expect(hiveTrustedRepairConsumerSummaryResource).toBeDefined();
    expect(hiveTrustedRepairWorkflowDryRunResource).toBeDefined();
    expect(hiveModeComparisonResource).toBeDefined();
    expect(providerDecisionsResource).toBeDefined();
    expect(hiveBeadsResource).toBeDefined();
    expect(hiveKnowledgeFactsResource).toBeDefined();
    expect(hiveKnowledgeGraphResource).toBeDefined();
    expect(hiveRepairWorkOrdersResource).toBeDefined();
    expect(hiveAgentPolicyResource).toBeDefined();
    expect(contextLedgerResource).toBeDefined();
    expect(providerResultsResource).toBeDefined();
    expect(providerUploadResource).toBeDefined();
    expect(pipelineResource).toBeDefined();
    await expect(readMcpResourceText(loaded, evidenceResource!)).resolves.toContain("visual-hive.evidence-packet.v2");
    await expect(readMcpResourceText(loaded, controlPlaneSnapshotResource!)).resolves.toContain("failures_need_triage");
    await expect(readMcpResourceText(loaded, controlPlaneSnapshotResource!)).resolves.not.toContain("secret-value");
    await expect(readMcpResourceText(loaded, configResource!)).resolves.toContain("cli-mcp");
    await expect(readMcpResourceText(loaded, verdictResource!)).resolves.toContain("visual-hive.verdict.v1");
    await expect(readMcpResourceText(loaded, readinessResource!)).resolves.toContain("\"status\": \"blocked\"");
    await expect(readMcpResourceText(loaded, readinessResource!)).resolves.not.toContain("secret-value");
    await expect(readMcpResourceText(loaded, agentPacketResource!)).resolves.not.toContain("secret-value");
    await expect(readMcpResourceText(loaded, handoffValidationResource!)).resolves.toContain("visual-hive.handoff-validation.v1");
    await expect(readMcpResourceText(loaded, hiveExportResource!)).resolves.toContain("visual-hive.hive-export.v1");
    await expect(readMcpResourceText(loaded, hiveBeadsResource!)).resolves.toContain("vh-bead-1");
    await expect(readMcpResourceText(loaded, hiveBeadsResource!)).resolves.not.toContain("secret-value");
    await expect(readMcpResourceText(loaded, hiveKnowledgeFactsResource!)).resolves.toContain("vh-fact-1");
    await expect(readMcpResourceText(loaded, hiveKnowledgeFactsResource!)).resolves.not.toContain("secret-value");
    await expect(readMcpResourceText(loaded, hiveKnowledgeGraphResource!)).resolves.toContain("derived_from");
    await expect(readMcpResourceText(loaded, hiveKnowledgeGraphResource!)).resolves.not.toContain("secret-value");
    await expect(readMcpResourceText(loaded, hiveRepairWorkOrdersResource!)).resolves.toContain("vh-repair-1");
    await expect(readMcpResourceText(loaded, hiveRepairWorkOrdersResource!)).resolves.not.toContain("secret-value");
    await expect(readMcpResourceText(loaded, hiveAgentPolicyResource!)).resolves.toContain("visual_hive");
    await expect(readMcpResourceText(loaded, hiveAgentPolicyResource!)).resolves.not.toContain("secret-value");
    await expect(readMcpResourceText(loaded, hiveGuardedRepairPreviewResource!)).resolves.toContain("visual-hive.hive-guarded-repair-preview.v1");
    await expect(readMcpResourceText(loaded, hiveGuardedRepairPreviewResource!)).resolves.not.toContain("secret-value");
    await expect(readMcpResourceText(loaded, hiveRepairRequestEnvelopeResource!)).resolves.toContain("visual-hive.hive-repair-request-envelope.v1");
    await expect(readMcpResourceText(loaded, hiveRepairRequestEnvelopeResource!)).resolves.not.toContain("secret-value");
    await expect(readMcpResourceText(loaded, hiveTrustedRepairConsumerSummaryResource!)).resolves.toContain("visual-hive.hive-trusted-repair-consumer-summary.v1");
    await expect(readMcpResourceText(loaded, hiveTrustedRepairConsumerSummaryResource!)).resolves.not.toContain("secret-value");
    await expect(readMcpResourceText(loaded, hiveTrustedRepairWorkflowDryRunResource!)).resolves.toContain("visual-hive.hive-trusted-repair-workflow-dry-run.v1");
    await expect(readMcpResourceText(loaded, hiveTrustedRepairWorkflowDryRunResource!)).resolves.not.toContain("secret-value");
    await expect(readMcpResourceText(loaded, hiveModeComparisonResource!)).resolves.toContain("visual-hive.hive-mode-comparison.v1");
    const contextLedgerResourceText = await readMcpResourceText(loaded, contextLedgerResource!);
    expect(contextLedgerResourceText).toContain("visual-hive.context-ledger.v1");
    expect(contextLedgerResourceText).toContain("\"evidenceResources\"");
    expect(contextLedgerResourceText).toContain("visual_hive_read_missing_tests");
    expect(contextLedgerResourceText).not.toContain("secret-value");
    await expect(readMcpResourceText(loaded, providerResultsResource!)).resolves.toContain("argos");
    await expect(readMcpResourceText(loaded, providerResultsResource!)).resolves.not.toContain("secret-value");
    await expect(readMcpResourceText(loaded, providerUploadResource!)).resolves.toContain("\"dryRun\": true");
    await expect(readMcpResourceText(loaded, providerUploadResource!)).resolves.not.toContain("secret-value");
    await expect(readMcpResourceText(loaded, pipelineResource!)).resolves.not.toContain("secret-value");
    const explanation = await callReadOnlyTool(loaded, "visual_hive_explain_failure");
    const reproduction = await callReadOnlyTool(loaded, "visual_hive_list_reproduction_commands");
    const doctor = await callReadOnlyTool(loaded, "visual_hive_doctor");
    const setup = await callReadOnlyTool(loaded, "visual_hive_recommend_setup");
    const plan = await callReadOnlyTool(loaded, "visual_hive_plan");
    const repairPrompt = await callReadOnlyTool(loaded, "visual_hive_generate_repair_prompt");
    const handoff = await callReadOnlyTool(loaded, "visual_hive_generate_handoff_dry_run");
    const handoffValidation = await callReadOnlyTool(loaded, "visual_hive_validate_handoff");
    const hiveExportAlias = await callReadOnlyTool(loaded, "visual_hive_get_hive_export");
    const hiveBeadsAlias = await callReadOnlyTool(loaded, "visual_hive_list_hive_beads");
    const hiveBeadContext = await callReadOnlyTool(loaded, "visual_hive_get_hive_bead_context");
    const hiveAgentWorkOrder = await callReadOnlyTool(loaded, "visual_hive_get_hive_agent_work_order");
    const hiveExport = await callReadOnlyTool(loaded, "visual_hive_read_hive_export");
    const hiveBeads = await callReadOnlyTool(loaded, "visual_hive_read_hive_beads");
    const hiveKnowledgeFacts = await callReadOnlyTool(loaded, "visual_hive_read_hive_knowledge_facts");
    const hiveKnowledgeGraph = await callReadOnlyTool(loaded, "visual_hive_read_hive_knowledge_graph");
    const hiveRepairWorkOrders = await callReadOnlyTool(loaded, "visual_hive_read_hive_repair_work_orders");
    const hiveAgentPolicy = await callReadOnlyTool(loaded, "visual_hive_read_hive_agent_policy");
    const hiveGuardedRepairPreview = await callReadOnlyTool(loaded, "visual_hive_read_hive_guarded_repair_preview");
    const hiveRepairRequestEnvelope = await callReadOnlyTool(loaded, "visual_hive_read_hive_repair_request_envelope");
    const hiveTrustedRepairConsumerSummary = await callReadOnlyTool(loaded, "visual_hive_read_hive_trusted_repair_consumer_summary");
    const hiveTrustedRepairWorkflowDryRun = await callReadOnlyTool(loaded, "visual_hive_read_hive_trusted_repair_workflow_dry_run");
    const hiveModeComparison = await callReadOnlyTool(loaded, "visual_hive_read_hive_mode_comparison");
    const verdict = await callReadOnlyTool(loaded, "visual_hive_read_verdict");
    const readiness = await callReadOnlyTool(loaded, "visual_hive_read_readiness_gate");
    const controlPlaneSnapshot = await callReadOnlyTool(loaded, "visual_hive_read_control_plane_snapshot");
    const agentPacket = await callReadOnlyTool(loaded, "visual_hive_read_agent_packet");
    const toolRegistry = await callReadOnlyTool(loaded, "visual_hive_read_tool_registry");
    const contextLedger = await callReadOnlyTool(loaded, "visual_hive_read_context_ledger");
    const providerDecisions = await callReadOnlyTool(loaded, "visual_hive_read_provider_decisions");
    const providerResults = await callReadOnlyTool(loaded, "visual_hive_read_provider_results");
    const providerUploadManifest = await callReadOnlyTool(loaded, "visual_hive_read_provider_upload_manifest");
    const pipeline = await callReadOnlyTool(loaded, "visual_hive_read_pipeline_status");

    expect(explanation).toContain("Visual Hive verdict: failed");
    expect(explanation).toContain("Failed contracts: dashboard");
    expect(explanation).toContain("Survived mutations: force-login-on-demo");
    expect(reproduction).toContain("visual-hive run");
    expect(reproduction).not.toContain("secret-value");
    expect(doctor).toContain("\"externalCallsMade\": 0");
    expect(setup).toContain("\"externalCallsMade\": 0");
    expect(plan).toContain("\"wroteArtifacts\": false");
    expect(repairPrompt).not.toContain("secret-value");
    expect(handoff).toContain("visual-hive.handoff.v1");
    expect(handoffValidation).toContain("visual-hive.handoff-validation.v1");
    expect(hiveExportAlias).toContain("\"createsBeads\": false");
    expect(hiveExportAlias).toContain("\"createsIssues\": false");
    expect(hiveBeadsAlias).toContain("vh-bead-1");
    expect(hiveBeadsAlias).toContain("\"createsBeads\": false");
    expect(hiveBeadContext).toContain("vh-bead-1");
    expect(hiveBeadContext).toContain("visual_hive_get_hive_agent_work_order");
    expect(hiveAgentWorkOrder).toContain("hive-agent-work-orders");
    expect(hiveAgentWorkOrder).toContain("\"executesAgent\": false");
    expect(hiveExport).toContain("visual-hive.hive-export.v1");
    expect(hiveBeads).toContain("vh-bead-1");
    expect(hiveBeads).not.toContain("secret-value");
    expect(hiveKnowledgeFacts).toContain("vh-fact-1");
    expect(hiveKnowledgeFacts).not.toContain("secret-value");
    expect(hiveKnowledgeGraph).toContain("derived_from");
    expect(hiveKnowledgeGraph).not.toContain("secret-value");
    expect(hiveRepairWorkOrders).toContain("vh-repair-1");
    expect(hiveRepairWorkOrders).not.toContain("secret-value");
    expect(hiveAgentPolicy).toContain("visual_hive");
    expect(hiveAgentPolicy).not.toContain("secret-value");
    expect(hiveGuardedRepairPreview).toContain("visual-hive.hive-guarded-repair-preview.v1");
    expect(hiveGuardedRepairPreview).not.toContain("secret-value");
    expect(hiveRepairRequestEnvelope).toContain("visual-hive.hive-repair-request-envelope.v1");
    expect(hiveRepairRequestEnvelope).not.toContain("secret-value");
    expect(hiveTrustedRepairConsumerSummary).toContain("visual-hive.hive-trusted-repair-consumer-summary.v1");
    expect(hiveTrustedRepairConsumerSummary).not.toContain("secret-value");
    expect(hiveTrustedRepairWorkflowDryRun).toContain("visual-hive.hive-trusted-repair-workflow-dry-run.v1");
    expect(hiveTrustedRepairWorkflowDryRun).not.toContain("secret-value");
    expect(hiveModeComparison).toContain("visual-hive.hive-mode-comparison.v1");
    expect(verdict).toContain("visual-hive.verdict.v1");
    expect(readiness).toContain("\"status\": \"blocked\"");
    expect(readiness).not.toContain("secret-value");
    expect(controlPlaneSnapshot).toContain("failures_need_triage");
    expect(controlPlaneSnapshot).not.toContain("secret-value");
    expect(agentPacket).not.toContain("secret-value");
    expect(toolRegistry).toContain("visual-hive.tool-registry.v1");
    expect(contextLedger).toContain("visual-hive.context-ledger.v1");
    expect(contextLedger).toContain("\"evidenceResources\"");
    expect(contextLedger).toContain("visual_hive_read_issue_body");
    expect(contextLedger).toContain("visual_hive_read_missing_tests");
    expect(contextLedger).not.toContain("secret-value");
    expect(providerDecisions).toContain("provider-decisions");
    expect(providerDecisions).not.toContain("secret-value");
    expect(providerResults).toContain("argos");
    expect(providerResults).not.toContain("secret-value");
    expect(providerUploadManifest).toContain("\"dryRun\": true");
    expect(providerUploadManifest).not.toContain("secret-value");
    expect(pipeline).not.toContain("secret-value");
  });

  it("keeps the MCP schema resource and read-tool enums aligned with the shared evidence catalog", async () => {
    const schema = JSON.parse(await readFile(path.join(repoRoot, "schemas", "visual-hive.mcp.schema.json"), "utf8")) as {
      $defs?: {
        resource?: { properties?: { id?: { enum?: string[] }; uri?: { enum?: string[] }; readToolName?: { enum?: string[] } } };
        readOnlyTool?: { properties?: { name?: { enum?: string[] } } };
      };
    };

    const schemaResourceIds = schema.$defs?.resource?.properties?.id?.enum ?? [];
    const schemaResourceUris = schema.$defs?.resource?.properties?.uri?.enum ?? [];
    const schemaResourceReadToolNames = schema.$defs?.resource?.properties?.readToolName?.enum ?? [];
    const schemaToolNames = schema.$defs?.readOnlyTool?.properties?.name?.enum ?? [];
    const catalogResourceIds = VISUAL_HIVE_EVIDENCE_RESOURCES.map((resource) => resource.id);
    const catalogResourceUris = VISUAL_HIVE_EVIDENCE_RESOURCES.map((resource) => resource.uri);
    const catalogReadToolNames = VISUAL_HIVE_EVIDENCE_RESOURCES.flatMap((resource) => (resource.readTool ? [resource.readTool.name] : []));

    expect(schemaResourceIds).toEqual(catalogResourceIds);
    expect(schemaResourceUris).toEqual(catalogResourceUris);
    expect(schemaResourceReadToolNames).toEqual(catalogReadToolNames);
    expect(schemaToolNames).toEqual(expect.arrayContaining(catalogReadToolNames));

    const catalogBackedSchemaTools = schemaToolNames.filter((name) => catalogReadToolNames.includes(name));
    expect(catalogBackedSchemaTools.sort()).toEqual(catalogReadToolNames.sort());
  });

  it("keeps the MCP efficiency docs aligned with catalog resources and schema tools", async () => {
    const docs = await readFile(path.join(repoRoot, "docs", "agents", "mcp-and-tool-efficiency.md"), "utf8");
    const schema = JSON.parse(await readFile(path.join(repoRoot, "schemas", "visual-hive.mcp.schema.json"), "utf8")) as {
      $defs?: {
        readOnlyTool?: { properties?: { name?: { enum?: string[] } } };
      };
    };

    const defaultResourcesSection = markdownSection(docs, "## Default Resources", "## Default Tools");
    const defaultToolsSection = markdownSection(docs, "## Default Tools", "## Disabled By Default");
    const documentedResourceUris = markdownCodeBullets(defaultResourcesSection, "visual-hive://");
    const documentedToolNames = markdownCodeBullets(defaultToolsSection, "visual_hive_");
    const schemaToolNames = schema.$defs?.readOnlyTool?.properties?.name?.enum ?? [];

    expect(documentedResourceUris).toEqual(VISUAL_HIVE_EVIDENCE_RESOURCES.map((resource) => resource.uri));
    expect(documentedToolNames).toEqual(schemaToolNames);
  });

  it("serves MCP resources and read-only tools through the SDK client transport", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-cli-mcp-sdk-"));
    tempDirs.push(tempRoot);
    await writeFile(
      path.join(tempRoot, "visual-hive.config.yaml"),
      `project:
  name: cli-mcp-sdk
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
    await writeJson(path.join(tempRoot, ".visual-hive", "evidence-packet.json"), {
      schemaVersion: "visual-hive.evidence-packet.v2",
      project: "cli-mcp-sdk",
      verdictSummary: {
        visualHiveVerdict: "passed",
        failedBecause: [],
        blockedBecause: [],
        advisoryOnly: ["llm.offline_summary"]
      }
    });
    await writeJson(path.join(tempRoot, ".visual-hive", "control-plane-snapshot.json"), {
      schemaVersion: 1,
      project: "cli-mcp-sdk",
      generatedAt: "2026-07-03T00:00:00.000Z",
      guidanceState: {
        lifecycleState: "ready",
        primaryAction: {
          id: "keep-pr-checks-on",
          label: "Keep PR-safe checks enabled",
          commandId: "plan-pr"
        }
      },
      adoptionChecklist: []
    });
    await writeJson(path.join(tempRoot, ".visual-hive", "report.json"), {
      schemaVersion: 2,
      project: "cli-mcp-sdk",
      status: "passed",
      reproductionCommands: ["visual-hive run --cookie=secret-value"],
      results: []
    });
    await writeJson(path.join(tempRoot, ".visual-hive", "verdict.json"), {
      schemaVersion: "visual-hive.verdict.v1",
      project: "cli-mcp-sdk",
      summary: {
        visualHiveVerdict: "passed"
      }
    });

    const loaded = await loadConfig(undefined, tempRoot);
    const server = createVisualHiveMcpServer(loaded);
    const client = new Client({ name: "visual-hive-cli-test", version: "0.0.0" }, { capabilities: {} });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      const resources = await client.listResources(undefined, { timeout: 10_000 });
      const tools = await client.listTools(undefined, { timeout: 10_000 });
      const evidence = await client.readResource({ uri: "visual-hive://latest-evidence" }, { timeout: 10_000 });
      const config = await client.callTool({ name: "visual_hive_validate_config" }, undefined, { timeout: 10_000 });
      const plan = await client.callTool({ name: "visual_hive_plan" }, undefined, { timeout: 10_000 });
      const reproduction = await client.callTool({ name: "visual_hive_list_reproduction_commands" }, undefined, { timeout: 10_000 });
      const verdict = await client.callTool({ name: "visual_hive_read_verdict" }, undefined, { timeout: 10_000 });
      const snapshot = await client.callTool({ name: "visual_hive_read_control_plane_snapshot" }, undefined, { timeout: 10_000 });

      expect(resources.resources.map((resource) => resource.uri)).toContain("visual-hive://latest-evidence");
      expect(resources.resources.map((resource) => resource.uri)).toContain("visual-hive://control-plane-snapshot");
      expect(resources.resources.map((resource) => resource.uri)).toContain("visual-hive://latest-verdict");
      expect(resources.resources.map((resource) => resource.uri)).toContain("visual-hive://readiness-gate");
      expect(resources.resources.map((resource) => resource.uri)).toContain("visual-hive://context-ledger");
      expect(resources.resources.map((resource) => resource.uri)).toContain("visual-hive://hive-beads");
      expect(resources.resources.map((resource) => resource.uri)).toContain("visual-hive://hive-import-manifest");
      expect(resources.resources.map((resource) => resource.uri)).toContain("visual-hive://hive-agent-work-orders");
      expect(resources.resources.map((resource) => resource.uri)).toContain("visual-hive://hive-setup-pack");
      expect(resources.resources.map((resource) => resource.uri)).toContain("visual-hive://hive/knowledge-facts");
      expect(resources.resources.map((resource) => resource.uri)).toContain("visual-hive://hive/knowledge-graph");
      expect(resources.resources.map((resource) => resource.uri)).toContain("visual-hive://hive/repair-work-orders");
      expect(resources.resources.map((resource) => resource.uri)).toContain("visual-hive://hive/agent-policy");
      expect(resources.resources.map((resource) => resource.uri)).toContain("visual-hive://provider-results");
      expect(resources.resources.map((resource) => resource.uri)).toContain("visual-hive://provider-upload/argos/manifest");
      expect(tools.tools.map((tool) => tool.name)).toContain("visual_hive_doctor");
      expect(tools.tools.map((tool) => tool.name)).toContain("visual_hive_recommend_setup");
      expect(tools.tools.map((tool) => tool.name)).toContain("visual_hive_plan");
      expect(tools.tools.map((tool) => tool.name)).toContain("visual_hive_read_evidence_packet");
      expect(tools.tools.map((tool) => tool.name)).toContain("visual_hive_read_control_plane_snapshot");
      expect(tools.tools.map((tool) => tool.name)).toContain("visual_hive_read_verdict");
      expect(tools.tools.map((tool) => tool.name)).toContain("visual_hive_read_readiness_gate");
      expect(tools.tools.map((tool) => tool.name)).toContain("visual_hive_read_hive_beads");
      expect(tools.tools.map((tool) => tool.name)).toContain("visual_hive_validate_hive_export");
      expect(tools.tools.map((tool) => tool.name)).toContain("visual_hive_read_hive_agent_work_orders");
      expect(tools.tools.map((tool) => tool.name)).toContain("visual_hive_get_hive_setup_pack");
      expect(tools.tools.map((tool) => tool.name)).toContain("visual_hive_read_hive_knowledge_facts");
      expect(tools.tools.map((tool) => tool.name)).toContain("visual_hive_read_hive_knowledge_graph");
      expect(tools.tools.map((tool) => tool.name)).toContain("visual_hive_read_hive_repair_work_orders");
      expect(tools.tools.map((tool) => tool.name)).toContain("visual_hive_read_hive_agent_policy");
      expect(tools.tools.map((tool) => tool.name)).toContain("visual_hive_read_provider_results");
      expect(tools.tools.map((tool) => tool.name)).toContain("visual_hive_read_provider_upload_manifest");
      expect(tools.tools.map((tool) => tool.name)).toContain("visual_hive_read_pipeline_status");
      expect(tools.tools.map((tool) => tool.name)).not.toContain("visual_hive_run");
      expect(JSON.stringify(evidence.contents)).toContain("cli-mcp-sdk");
      expect(config.content.find((item) => item.type === "text")?.text).toContain("\"externalCallsMade\": 0");
      expect(plan.content.find((item) => item.type === "text")?.text).toContain("\"wroteArtifacts\": false");
      expect(reproduction.content.find((item) => item.type === "text")?.text).toContain("visual-hive run");
      expect(reproduction.content.find((item) => item.type === "text")?.text).not.toContain("secret-value");
      expect(verdict.content.find((item) => item.type === "text")?.text).toContain("visual-hive.verdict.v1");
      expect(snapshot.content.find((item) => item.type === "text")?.text).toContain("keep-pr-checks-on");
    } finally {
      await client.close();
      await server.close();
    }
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

    const result = await runContextCommand({ cwd: tempRoot, maxToolCalls: 1 });
    const summary = formatContextLedger(result);
    const ledger = await readJson<typeof result.ledger>(result.ledgerPath);

    expect(ledger.schemaVersion).toBe("visual-hive.context-ledger.v1");
    expect(ledger.budgets.maxToolCalls).toBe(1);
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
      ".github/workflows/visual-hive-hive-handoff.yml",
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
    expect(report.outputResource).toMatchObject({
      artifactPath: ".visual-hive/report.json",
      evidenceResourceId: "latest-report",
      evidenceResourceUri: "visual-hive://latest-report",
      evidenceReadToolName: "visual_hive_read_latest_report"
    });
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
    const evidence = await readJson<Record<string, unknown>>(path.join(tempRoot, ".visual-hive", "evidence-packet.json"));
    const handoffResult = await readJson<{ externalCallsMade: number; status: string }>(path.join(tempRoot, ".visual-hive", "hive-handoff-result.json"));
    const handoffValidation = await readJson<{ status: string; summary: { externalCallsMade: number } }>(
      path.join(tempRoot, ".visual-hive", "hive-handoff-validation.json")
    );
    const issues = await readJson<{ schemaVersion: string; externalCallsMade: number }>(path.join(tempRoot, ".visual-hive", "issues.json"));
    const issueQueue = await readJson<{ schemaVersion: string }>(path.join(tempRoot, ".visual-hive", "issue-queue.json"));
    const agentPacket = await readJson<{ profile: string; budgets: { allowExternalNetwork: boolean; maxExternalCostUsd: number } }>(
      path.join(tempRoot, ".visual-hive", "agent-packet.json")
    );
    const handoffAgentPacket = await readJson<{ profile: string; budgets: { allowExternalNetwork: boolean; maxExternalCostUsd: number } }>(
      path.join(tempRoot, ".visual-hive", "handoff-agent-packet.json")
    );
    const toolRegistry = await readJson<{ policy: { exposeThirdPartyMcp: boolean; externalUploadsFromPr: boolean } }>(
      path.join(tempRoot, ".visual-hive", "tools", "tool-registry.json")
    );
    const artifactIndex = await readJson<{
      complete: boolean;
      artifacts: Array<{ path: string; bytes: number; sha256: string }>;
    }>(path.join(tempRoot, ".visual-hive", "artifacts-index.json"));
    const pipelineBytes = await readFile(path.join(tempRoot, ".visual-hive", "pipeline.json"));

    expect(result.exitCode).toBe(0);
    expect(pipeline.status).toBe("passed");
    await expectMatchesSchema("visual-hive.pipeline.schema.json", pipeline);
    expect(pipeline.steps.map((step) => step.id)).toEqual(
      expect.arrayContaining([
        "doctor",
        "analyze",
        "plan",
        "run",
        "baselines",
        "coverage",
        "readiness",
        "triage",
        "report",
        "history",
        "artifacts",
        "evidence",
        "layers",
        "verdict",
        "handoff",
        "handoff-validate",
        "issues",
        "hive-export",
        "hive-guarded-repair-preview",
        "hive-repair-request-envelope",
        "hive-trusted-repair-consumer-summary",
        "hive-trusted-repair-workflow-dry-run",
        "test-creation-plan",
        "agent-packet",
        "handoff-agent-packet",
        "tools",
        "context",
        "schemas",
        "snapshot",
        "capabilities",
        "artifacts-final"
      ])
    );
    expect(pipeline.steps.find((step) => step.id === "schemas")?.status).toBe("passed");
    expect(pipeline.steps.find((step) => step.id === "snapshot")?.status).toBe("passed");
    expect(pipeline.steps.find((step) => step.id === "capabilities")?.status).toBe("passed");
    expect(pipeline.artifacts).toContain(catalogPath("pipeline-status"));
    expect(pipeline.artifacts).toContain(catalogPath("capability-parity"));
    expect(pipeline.artifacts).toEqual(
      expect.arrayContaining([
        ".visual-hive/repo-map.json",
        catalogPath("latest-plan"),
        catalogPath("latest-report"),
        catalogPath("latest-evidence"),
        catalogPath("testing-layers"),
        catalogPath("latest-verdict"),
        catalogPath("latest-handoff"),
        ".visual-hive/hive-issue.md",
        ".visual-hive/hive-bead-request.json",
        ".visual-hive/hive-handoff-result.json",
        catalogPath("handoff-validation"),
        catalogPath("hive-export"),
        catalogPath("hive-guarded-repair-preview"),
        ".visual-hive/hive/guarded-repair-preview.md",
        catalogPath("hive-repair-request-envelope"),
        ".visual-hive/hive/repair-request-envelope.md",
        catalogPath("hive-trusted-repair-consumer-summary"),
        ".visual-hive/hive/trusted-repair-consumer-summary.md",
        catalogPath("hive-trusted-repair-workflow-dry-run"),
        ".visual-hive/hive/trusted-repair-workflow-dry-run.md",
        ".visual-hive/issues.json",
        ".visual-hive/issues.md",
        ".visual-hive/issue-queue.json",
        ".visual-hive/setup-issue.md",
        catalogPath("test-creation-plan"),
        catalogPath("agent-packet"),
        catalogPath("handoff-agent-packet"),
        catalogPath("provider-agent-packet"),
        catalogPath("tool-registry"),
        catalogPath("context-ledger"),
        catalogPath("control-plane-snapshot")
      ])
    );
    expect(report.noContractsReason).toContain("selection.ignoreChangedFiles");
    expect(evidence.schemaVersion).toBe("visual-hive.evidence-packet.v2");
    expect(handoffResult.externalCallsMade).toBe(0);
    expect(["dry_run_written", "blocked"]).toContain(handoffResult.status);
    expect(["passed", "warning"]).toContain(handoffValidation.status);
    expect(handoffValidation.summary.externalCallsMade).toBe(0);
    expect(issues.schemaVersion).toBe("visual-hive.issues.v1");
    expect(issues.externalCallsMade).toBe(0);
    expect(issueQueue.schemaVersion).toBe("visual-hive.issue-queue.v1");
    expect(agentPacket.profile).toBe("repair_agent");
    expect(agentPacket.budgets.allowExternalNetwork).toBe(false);
    expect(agentPacket.budgets.maxExternalCostUsd).toBe(0);
    expect(handoffAgentPacket.profile).toBe("handoff_agent");
    expect(handoffAgentPacket.budgets.allowExternalNetwork).toBe(false);
    expect(handoffAgentPacket.budgets.maxExternalCostUsd).toBe(0);
    expect(toolRegistry.policy.exposeThirdPartyMcp).toBe(false);
    expect(toolRegistry.policy.externalUploadsFromPr).toBe(false);
    expect(artifactIndex.complete).toBe(true);
    const indexedPipeline = artifactIndex.artifacts.find((artifact) => artifact.path === ".visual-hive/pipeline.json");
    expect(indexedPipeline).toMatchObject({
      path: ".visual-hive/pipeline.json",
      bytes: pipelineBytes.byteLength,
      sha256: createHash("sha256").update(pipelineBytes).digest("hex")
    });
    await expect(access(path.join(tempRoot, ".visual-hive", "repo-context.md"))).resolves.toBeUndefined();
    await expect(access(path.join(tempRoot, ".visual-hive", "evidence-summary.md"))).resolves.toBeUndefined();
    await expect(access(path.join(tempRoot, ".visual-hive", "verdict.md"))).resolves.toBeUndefined();
    await expect(access(path.join(tempRoot, ".visual-hive", "testing-layers.md"))).resolves.toBeUndefined();
    await expect(access(path.join(tempRoot, ".visual-hive", "hive-issue.md"))).resolves.toBeUndefined();
    await expect(access(path.join(tempRoot, ".visual-hive", "artifacts-index.json"))).resolves.toBeUndefined();
  }, 20_000);

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
            affected: [{ contractId: "dashboard", targetId: "local", route: "/", component: "critical-action", viewport: "desktop" }],
            expectedFailureKinds: ["missing_element"],
            durationMs: 10,
            errors: [],
            artifacts: [],
            suggestedMissingTest: "Keep mutation hide-critical-button mapped to dashboard.",
            validationCommand: "visual-hive mutate --config visual-hive.config.yaml --enforce-min-score",
            mutationMode: "runtime",
            sourceMutation: false
          }
        ]
      },
      ".visual-hive/mutation-report.json"
    );

    expect(summary).toContain("Mutation score: 50% (1/2)");
    expect(summary).toContain("hide-critical-button: killed");
    expect(summary).toContain("(dashboard)");
    expect(summary).toContain("affected=dashboard@/");
    expect(summary).toContain("Keep mutation hide-critical-button mapped");
  });

  it("init --force creates installable workflow and config files", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-init-"));
    tempDirs.push(tempRoot);
    await runInit({ cwd: tempRoot, force: true });

    await expect(access(path.join(tempRoot, "visual-hive.config.yaml"))).resolves.toBeUndefined();
    await expect(access(path.join(tempRoot, ".github", "workflows", "visual-hive-failure-issue.yml"))).resolves.toBeUndefined();
    await expect(access(path.join(tempRoot, ".github", "workflows", "visual-hive-hive-handoff.yml"))).resolves.toBeUndefined();
    await expect(access(path.join(tempRoot, ".visual-hive", "generated"))).resolves.toBeUndefined();
    const prWorkflow = await readFile(path.join(tempRoot, ".github", "workflows", "visual-hive-pr.yml"), "utf8");
    const scheduledWorkflow = await readFile(path.join(tempRoot, ".github", "workflows", "visual-hive-scheduled.yml"), "utf8");
    const failureWorkflow = await readFile(path.join(tempRoot, ".github", "workflows", "visual-hive-failure-issue.yml"), "utf8");
    const hiveHandoffWorkflow = await readFile(path.join(tempRoot, ".github", "workflows", "visual-hive-hive-handoff.yml"), "utf8");
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
    expect(failureWorkflow).toContain("function findIssuesReport");
    expect(failureWorkflow).toContain("issues.json");
    expect(failureWorkflow).toContain("visual-hive-issue dedupe");
    expect(failureWorkflow).toContain("dedupeFingerprint");
    expect(failureWorkflow).toContain("redactSecretValues");
    expect(failureWorkflow).toContain("client_secret");
    expect(failureWorkflow).toContain("visual-hive-dedupe");
    expect(failureWorkflow).not.toContain("context.payload.workflow_run.id + \" -->\"");
    expect(failureWorkflow).toContain('path: ".hive/integrated.json"');
    expect(failureWorkflow).toContain("protected default-branch installation state assigns lifecycle writes to Hive");
    expect(hiveHandoffWorkflow).toContain("hive-bead-request.json");
    expect(hiveHandoffWorkflow).toContain("hive-handoff-validation.json");
    expect(hiveHandoffWorkflow).toContain("hive/hive-export.json");
    expect(hiveHandoffWorkflow).toContain("hive/guarded-repair-preview.json");
    expect(hiveHandoffWorkflow).toContain("hive/repair-request-envelope.json");
    expect(hiveHandoffWorkflow).toContain("Guarded repair preview");
    expect(hiveHandoffWorkflow).toContain("Repair request envelope");
    expect(hiveHandoffWorkflow).toContain("preview_only_no_execution");
    expect(hiveHandoffWorkflow).toContain("trusted_workflow_request_only");
    expect(hiveHandoffWorkflow).toContain('path: ".hive/integrated.json"');
    expect(hiveHandoffWorkflow).toContain("protected default-branch installation state assigns lifecycle writes to Hive");
    expect(hiveHandoffWorkflow).toContain("not_executed_by_visual_hive");
    expect(hiveHandoffWorkflow).toContain("canOpenTrustedRepairRequest");
    expect(hiveHandoffWorkflow).toContain("decide_visual_hive_verdict");
    expect(hiveHandoffWorkflow).toContain("hive-issue.md");
    expect(hiveHandoffWorkflow).toContain("externalCallsMade");
    expect(hiveHandoffWorkflow).toContain("visual-hive-hive-handoff-dedupe");
    expect(hiveHandoffWorkflow).toContain("github.rest.issues.create");
    expect(hiveHandoffWorkflow).toContain("Future trusted Hive Bead API adapter");
    expect(hiveHandoffWorkflow).toContain("actions/download-artifact@v4");
    expect(hiveHandoffWorkflow).not.toContain("actions/checkout");
    expect(hiveHandoffWorkflow).not.toContain("pull_request_target");
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
        trustedHandoffWorkflows: 0,
        unknownWorkflows: 0,
        criticalFindings: 0,
        highFindings: 1,
        workflowsUsingPullRequestTarget: 0,
        prWorkflowsUsingSecrets: 1,
        prWorkflowsWithWritePermissions: 0,
        workflowsUploadingArtifacts: 1,
        workflowsMissingHiddenArtifactUpload: 0,
        trustedIssueWorkflowsCheckingOutCode: 0,
        trustedHandoffWorkflowsCheckingOutCode: 0
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
      outputResource?: {
        artifactPath: string;
        evidenceResourceId: string;
        evidenceResourceUri: string;
        evidenceReadToolName?: string;
      };
      sourceArtifacts: { providerResults?: string };
      summary: { findingCount: number; classifications: Record<string, number> };
      findings: Array<{ classification: string; evidence: string[]; suggestedFiles?: string[]; suggestedNextTests: string[] }>;
    }>(result.triageReportPath);
    expect(triageReport.schemaVersion).toBe(1);
    expect(triageReport.outputResource).toMatchObject({
      artifactPath: ".visual-hive/triage.json",
      evidenceResourceId: "triage-report",
      evidenceResourceUri: "visual-hive://triage-report",
      evidenceReadToolName: "visual_hive_read_triage_report"
    });
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
    const written = await readJson<{
      outputResource?: {
        artifactPath: string;
        evidenceResourceId: string;
        evidenceResourceUri: string;
        evidenceReadToolName?: string;
      };
      decisions: Array<{ providerId: string; reason: string; externalCallsMade: number }>;
    }>(
      path.join(tempRoot, ".visual-hive", "provider-decisions.json")
    );

    expect(result.decisionPath).toBe(".visual-hive/provider-decisions.json");
    expect(result.decision.externalCallsMade).toBe(0);
    expect(result.decision.reason).toContain("[REDACTED]");
    expect(result.decision.reason).not.toContain("secret-value");
    expect(written.outputResource).toMatchObject({
      artifactPath: ".visual-hive/provider-decisions.json",
      evidenceResourceId: "provider-decisions",
      evidenceResourceUri: "visual-hive://provider-decisions",
      evidenceReadToolName: "visual_hive_read_provider_decisions"
    });
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

  it("writes a schema-validated Control Plane snapshot artifact from the CLI", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-cli-snapshot-"));
    tempDirs.push(tempRoot);
    await writeFile(
      path.join(tempRoot, "visual-hive.config.yaml"),
      `project:
  name: snapshot-demo
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

    const result = await runSnapshotCommand({ cwd: tempRoot });
    const summary = formatSnapshotResult(result);
    const rawSnapshotText = await readFile(result.snapshotPath, "utf8");
    const written = await readJson<{ schemaVersion: number; guidanceState: { adoptionChecklist: Array<{ commandId?: string }> }; runbook: { commands: Array<{ id: string }> } }>(
      result.snapshotPath
    );

    await expectMatchesSchema("visual-hive.control-plane-snapshot.schema.json", written);
    expect(result.snapshotPath).toBe(path.join(tempRoot, ".visual-hive", "control-plane-snapshot.json"));
    expect(written.schemaVersion).toBe(1);
    expect(written.guidanceState.adoptionChecklist.map((item) => item.commandId)).toContain("plan-pr");
    expect(written.runbook.commands.map((command) => command.id)).toContain("doctor");
    expect(rawSnapshotText).toContain("http://127.0.0.1:4173");
    expect(rawSnapshotText).not.toContain(tempRoot);
    expect(rawSnapshotText).not.toContain("C:\\Users");
    expect(rawSnapshotText).not.toContain("C:/Users");
    expect(rawSnapshotText).not.toContain("OneDrive");
    expect(rawSnapshotText).not.toContain("/home/");
    expect(rawSnapshotText).not.toContain("/Users/");
    expect(summary).toContain("Control Plane Snapshot");
    expect(summary).toContain("Schema: schemas/visual-hive.control-plane-snapshot.schema.json");

    const artifacts = await runArtifactsCommand({ config: path.join(tempRoot, "visual-hive.config.yaml") });
    const snapshotArtifact = artifacts.index.artifacts.find((artifact) => artifact.path.endsWith("control-plane-snapshot.json"));
    expect(snapshotArtifact?.labels).toContain("control-plane-snapshot");
    expect(snapshotArtifact?.schemaPath).toBe("schemas/visual-hive.control-plane-snapshot.schema.json");
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
    expect(written.outputResource).toMatchObject({
      artifactPath: ".visual-hive/provider-setup-plan.json",
      evidenceResourceId: "provider-setup-plan",
      evidenceResourceUri: "visual-hive://provider-setup-plan",
      evidenceReadToolName: "visual_hive_read_provider_setup_plan"
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
    expect(written.outputResource).toMatchObject({
      artifactPath: ".visual-hive/provider-handoff.json",
      evidenceResourceId: "provider-handoff",
      evidenceResourceUri: "visual-hive://provider-handoff",
      evidenceReadToolName: "visual_hive_read_provider_handoff"
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

  it("bounds default Argos provider upload command execution", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-cli-provider-timeout-"));
    tempDirs.push(tempRoot);
    const fakeBin = path.join(tempRoot, "bin");
    await mkdir(fakeBin, { recursive: true });
    if (process.platform === "win32") {
      await writeFile(path.join(fakeBin, "npm.cmd"), '@echo off\r\nnode -e "setTimeout(() => {}, 5000)"\r\n', "utf8");
    } else {
      const fakeNpm = path.join(fakeBin, "npm");
      await writeFile(fakeNpm, "#!/bin/sh\nnode -e 'setTimeout(() => {}, 5000)'\n", "utf8");
      await chmod(fakeNpm, 0o755);
    }
    await mkdir(path.join(tempRoot, ".visual-hive", "artifacts", "screenshots"), { recursive: true });
    await writeFile(path.join(tempRoot, ".visual-hive", "artifacts", "screenshots", "dashboard.png"), "fake screenshot", "utf8");
    await writeFile(
      path.join(tempRoot, "visual-hive.config.yaml"),
      `project:
  name: provider-timeout
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
    mode: external
    requiredEnv:
      - ARGOS_TOKEN
    upload:
      includeActualScreenshots: true
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
      project: "provider-timeout",
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

    const previousPath = process.env.PATH;
    const previousToken = process.env.ARGOS_TOKEN;
    const previousTimeout = process.env.VISUAL_HIVE_PROVIDER_COMMAND_TIMEOUT_MS;
    process.env.PATH = `${fakeBin}${path.delimiter}${previousPath ?? ""}`;
    process.env.ARGOS_TOKEN = "secret-provider-token";
    process.env.VISUAL_HIVE_PROVIDER_COMMAND_TIMEOUT_MS = "50";
    try {
      const result = await runProviderUploadCommand({ cwd: tempRoot, providerId: "argos" });
      const manifest = await readJson<typeof result.manifest>(result.manifestPath);
      const providerResult = result.providerResults.providers.find((provider) => provider.providerId === "argos");

      expect(result.exitCode).toBe(0);
      expect(manifest.status).toBe("failed");
      expect(manifest.externalCallsMade).toBe(1);
      expect(manifest.stderr).toContain("Provider upload command timed out after 50ms.");
      expect(JSON.stringify(manifest)).not.toContain("secret-provider-token");
      expect(providerResult?.result.upload).toMatchObject({
        status: "failed",
        externalCallsMade: 1
      });
    } finally {
      process.env.PATH = previousPath;
      if (previousToken === undefined) {
        delete process.env.ARGOS_TOKEN;
      } else {
        process.env.ARGOS_TOKEN = previousToken;
      }
      if (previousTimeout === undefined) {
        delete process.env.VISUAL_HIVE_PROVIDER_COMMAND_TIMEOUT_MS;
      } else {
        process.env.VISUAL_HIVE_PROVIDER_COMMAND_TIMEOUT_MS = previousTimeout;
      }
    }
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
    expect(written.outputResource).toMatchObject({
      artifactPath: ".visual-hive/provider-results.json",
      evidenceResourceId: "provider-results",
      evidenceResourceUri: "visual-hive://provider-results",
      evidenceReadToolName: "visual_hive_read_provider_results"
    });
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
    const providerRunReport = {
      schemaVersion: 1,
      project: "provider-report",
      generatedAt: "2026-06-15T00:00:00.000Z",
      deterministicStatus: "failed",
      artifactCount: 1,
      providers: [
        {
          providerId: "argos",
          label: "Argos",
          enabled: true,
          mode: "external",
          availability: "available",
          deterministicRole: "supplemental",
          operations: [{ operation: "upload_artifact", status: "failed", message: "Argos upload command failed." }],
          result: {
            providerId: "argos",
            label: "Argos",
            status: "failed",
            deterministicRole: "supplemental",
            message: "Argos upload command failed; deterministic Playwright status is unchanged.",
            requiredEnv: ["ARGOS_TOKEN"],
            missingEnv: [],
            artifactCount: 1,
            normalizedAt: "2026-06-15T00:00:00.000Z",
            upload: {
              status: "failed",
              externalCallsMade: 1,
              uploadedArtifacts: 0,
              stagedArtifacts: 1,
              manifestPath: ".visual-hive/provider-upload/argos/manifest.json",
              uploadDirectory: ".visual-hive/provider-upload/argos",
              command: "npm exec --yes --package @argos-ci/cli@^5 -- argos upload .visual-hive/provider-upload/argos/screenshots",
              stderr: "Provider upload command timed out after 50ms.",
              stdout: "",
              blockedReasons: []
            }
          },
          normalized: {
            providerId: "argos",
            category: "hosted-visual",
            status: "failed",
            deterministicRole: "supplemental",
            networkMode: "external",
            externalCallsMade: 1,
            artifactSummary: {
              localArtifacts: 1,
              uploadedArtifacts: 0,
              comparedArtifacts: 0,
              uploadMode: "blocked"
            },
            notes: []
          },
          artifacts: [".visual-hive/provider-upload/argos/screenshots/dashboard.png"],
          missingEnv: [],
          warnings: []
        }
      ],
      summary: {
        providerCount: 1,
        enabledProviders: 1,
        mockProviders: 0,
        missingCredentialProviders: 0,
        externalDeferredProviders: 0,
        skippedProviders: 0,
        failedProviders: 1
      },
      warnings: []
    } satisfies MockProviderRunReport;
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
    }, providerRunReport);

    expect(output).toContain("Providers: Playwright built-in=passed");
    expect(output).toContain("### Provider Results");
    expect(output).toContain("Provider Adapter Run");
    expect(output).toContain("upload=failed");
    expect(output).toContain("Provider upload command timed out after 50ms.");
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
    expect(written.outputResource).toMatchObject({
      artifactPath: ".visual-hive/readiness.json",
      evidenceResourceId: "readiness-gate",
      evidenceResourceUri: "visual-hive://readiness-gate",
      evidenceReadToolName: "visual_hive_read_readiness_gate"
    });
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
    expect(mutationReport.outputResource).toMatchObject({
      artifactPath: ".visual-hive/mutation-report.json",
      evidenceResourceId: "mutation-report",
      evidenceResourceUri: "visual-hive://mutation-report",
      evidenceReadToolName: "visual_hive_read_mutation_report"
    });
    expect(mutationReport.score).toBe(1);
    expect(mutationReport.killed).toBe(1);
    expect(mutationReport.total).toBe(1);
    expect(mutationReport.results[0]).toMatchObject({
      affected: [
        {
          contractId: "hosted-demo-never-login",
          targetId: "localPreview",
          route: "/",
          component: "auth-boundary",
          viewport: "desktop"
        }
      ],
      mutationMode: "runtime",
      sourceMutation: false,
      validationCommand: "visual-hive mutate --config visual-hive.config.yaml --enforce-min-score",
      suggestedMissingTest: expect.stringContaining("hide-critical-button")
    });
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

  it("writes issue candidates, issue queue, and setup issue artifacts", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-cli-issues-"));
    tempDirs.push(tempRoot);
    await writeFile(
      path.join(tempRoot, "visual-hive.config.yaml"),
      `project:
  name: issue-cli-demo
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
        - "[data-testid='dashboard-page']"
`,
      "utf8"
    );
    await writeJson(path.join(tempRoot, ".visual-hive", "report.json"), {
      schemaVersion: 2,
      project: "issue-cli-demo",
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
      results: [
        {
          contractId: "dashboard",
          targetId: "local",
          status: "failed",
          durationMs: 10,
          errors: ["Missing selector [data-testid='dashboard-page']"],
          artifacts: [".visual-hive/report.json"],
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
      artifacts: [".visual-hive/report.json"],
      reproductionCommands: ["visual-hive run --ci"]
    });
    await writeJson(path.join(tempRoot, ".visual-hive", "evidence-packet.json"), { project: "issue-cli-demo" });
    await writeJson(path.join(tempRoot, ".visual-hive", "repo-map.json"), { project: "issue-cli-demo" });

    const result = await runIssuesCommand({ config: path.join(tempRoot, "visual-hive.config.yaml"), cwd: tempRoot, write: true });
    const summary = formatIssuesResult(result);

    expect(summary).toContain("Wrote");
    expect(result.report.issues[0]?.issueKind).toBe("selector_contract_failure");
    expect(result.report.issues[0]?.body).toContain("Visual Hive does not repair code");
    await expectMatchesSchema("visual-hive.issues.schema.json", result.report);
    await expectMatchesSchema("visual-hive.issue-queue.schema.json", await readJson(path.join(tempRoot, ".visual-hive", "issue-queue.json")));
    await expect(readFile(path.join(tempRoot, ".visual-hive", "setup-issue.md"), "utf8")).resolves.toContain("[Visual Hive] Setup visual QA");
  });

  it("writes issue publish plan, dry-run, and result artifacts without network calls", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-cli-issue-publish-"));
    tempDirs.push(tempRoot);
    await writeFile(
      path.join(tempRoot, "visual-hive.config.yaml"),
      `project:
  name: issue-publish-demo
targets:
  local:
    kind: url
    url: "http://127.0.0.1:4173"
contracts:
  - id: shell
    description: Shell renders
    target: local
    severity: high
    runOn:
      pullRequest: true
    selectors:
      mustExist:
        - "[data-testid='dashboard-page']"
viewports:
  desktop:
    width: 1280
    height: 720
`,
      "utf8"
    );
    await mkdir(path.join(tempRoot, ".visual-hive"), { recursive: true });
    await writeJson(path.join(tempRoot, ".visual-hive", "issues.json"), {
      schemaVersion: "visual-hive.issues.v1",
      generatedAt: "2026-01-01T00:00:00.000Z",
      project: "issue-publish-demo",
      externalCallsMade: 0,
      networkCallsMade: 0,
      sourceArtifacts: { evidencePacket: ".visual-hive/evidence-packet.json" },
      summary: {
        total: 1,
        openCandidates: 1,
        updateCandidates: 0,
        resolvedCandidates: 0,
        suppressed: 0,
        blocked: 0,
        byKind: { mutation_survivor: 1 },
        bySeverity: { high: 1 }
      },
      issues: [
        {
          issueKind: "mutation_survivor",
          severity: "high",
          status: "open_candidate",
          dedupeFingerprint: "visual-hive:mutation_survivor:abcdef1234567890",
          title: "[Visual Hive] Mutation survived: force-login-on-demo",
          labels: ["visual-hive", "mutation-survivor"],
          body: "<!-- visual-hive-issue dedupe:visual-hive:mutation_survivor:abcdef1234567890 -->\nVisual Hive does not repair code.",
          owningAgentHint: "visual-hive/mutation",
          sourceArtifacts: [".visual-hive/mutation-report.json"],
          affected: [{ contractId: "public-auth-boundary" }],
          validationCommand: "visual-hive mutate --enforce-min-score",
          linkedEvidencePacket: ".visual-hive/evidence-packet.json",
          linkedRepoMap: ".visual-hive/repo-map.json",
          linkedMutationReport: ".visual-hive/mutation-report.json",
          guardrails: ["Visual Hive does not repair code."]
        }
      ]
    });

    const result = await runIssuePublishCommand({ config: path.join(tempRoot, "visual-hive.config.yaml"), cwd: tempRoot, dryRun: true });
    const output = formatIssuePublishResult(result);

    expect(output).toContain("Issue Publish");
    expect(result.plan.summary.create).toBe(1);
    expect(result.result.externalCallsMade).toBe(0);
    expect(result.result.realGithubIssuesCreated).toBe(0);
    await expectMatchesSchema("visual-hive.issue-publish-plan.schema.json", await readJson(path.join(tempRoot, ".visual-hive", "issue-publish-plan.json")));
    await expectMatchesSchema("visual-hive.issue-publish-dry-run.schema.json", await readJson(path.join(tempRoot, ".visual-hive", "issue-publish-dry-run.json")));
    await expectMatchesSchema("visual-hive.issue-publish-result.schema.json", await readJson(path.join(tempRoot, ".visual-hive", "issue-publish-result.json")));

    const liveBlocked = await runIssuePublishCommand({
      config: path.join(tempRoot, "visual-hive.config.yaml"),
      cwd: tempRoot,
      mode: "live",
      live: true
    });
    const liveOutput = formatIssuePublishResult(liveBlocked);
    expect(liveOutput).toContain("Status: blocked");
    expect(liveBlocked.plan.mode).toBe("live");
    expect(liveBlocked.result.mode).toBe("live");
    expect(liveBlocked.result.status).toBe("blocked");
    expect(liveBlocked.result.externalCallsMade).toBe(0);
    expect(liveBlocked.result.realGithubIssuesCreated).toBe(0);
    expect(liveBlocked.result.blockedReasons.join(" ")).toContain("VISUAL_HIVE_LIVE_GITHUB_ISSUE");
  });

  it("writes setup issue publish dry-run artifacts from setup-issue.md", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-cli-setup-publish-"));
    tempDirs.push(tempRoot);
    await writeFile(
      path.join(tempRoot, "visual-hive.config.yaml"),
      `project:
  name: setup-publish-demo
targets:
  local:
    kind: url
    url: "http://127.0.0.1:4173"
contracts:
  - id: shell
    description: Shell renders
    target: local
    severity: high
    runOn:
      pullRequest: true
viewports:
  desktop:
    width: 1280
    height: 720
`,
      "utf8"
    );
    await mkdir(path.join(tempRoot, ".visual-hive"), { recursive: true });
    await writeFile(
      path.join(tempRoot, ".visual-hive", "setup-issue.md"),
      [
        "<!-- visual-hive-setup-issue -->",
        "",
        "# [Visual Hive] Setup visual QA",
        "",
        "Project: setup-publish-demo",
        "",
        "- Review the proposed config.",
        "- Keep pull_request read-only."
      ].join("\n"),
      "utf8"
    );

    const result = await runSetupIssuePublishCommand({ config: path.join(tempRoot, "visual-hive.config.yaml"), cwd: tempRoot, dryRun: true });
    const output = formatSetupIssuePublishResult(result);

    expect(output).toContain("Setup Issue Publish");
    expect(result.plan.summary.create).toBe(1);
    expect(result.plan.decisions[0].issueKind).toBe("setup_needed");
    expect(result.plan.decisions[0].owningAgentHint).toBe("visual-hive/setup");
    expect(result.plan.decisions[0].labels).toEqual(expect.arrayContaining(["visual-hive", "setup", "hive/quality"]));
    expect(result.plan.decisions[0].body).toContain("does not repair code");
    expect(result.result.externalCallsMade).toBe(0);
    expect(result.result.realGithubIssuesCreated).toBe(0);
    await expectMatchesSchema("visual-hive.issues.schema.json", await readJson(path.join(tempRoot, ".visual-hive", "setup-issue-candidate.json")));
    await expectMatchesSchema("visual-hive.issue-publish-plan.schema.json", await readJson(path.join(tempRoot, ".visual-hive", "setup-issue-publish-plan.json")));
    await expectMatchesSchema("visual-hive.issue-publish-dry-run.schema.json", await readJson(path.join(tempRoot, ".visual-hive", "setup-issue-publish-dry-run.json")));
    await expectMatchesSchema("visual-hive.issue-publish-result.schema.json", await readJson(path.join(tempRoot, ".visual-hive", "setup-issue-publish-result.json")));

    const liveBlocked = await runSetupIssuePublishCommand({
      config: path.join(tempRoot, "visual-hive.config.yaml"),
      cwd: tempRoot,
      mode: "live",
      live: true
    });
    expect(liveBlocked.result.status).toBe("blocked");
    expect(liveBlocked.result.realGithubIssuesCreated).toBe(0);
    expect(liveBlocked.result.blockedReasons.join(" ")).toContain("VISUAL_HIVE_LIVE_GITHUB_ISSUE");
  });

  it("writes issue-agent no-write request, output, and run artifacts", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-cli-agent-issue-"));
    tempDirs.push(tempRoot);
    await writeFile(
      path.join(tempRoot, "visual-hive.config.yaml"),
      `project:
  name: agent-issue-cli-demo
targets:
  local:
    kind: url
    url: "http://127.0.0.1:4173"
contracts:
  - id: shell
    description: Shell renders
    target: local
    severity: high
    runOn:
      pullRequest: true
viewports:
  desktop:
    width: 1280
    height: 720
`,
      "utf8"
    );
    await mkdir(path.join(tempRoot, ".visual-hive"), { recursive: true });
    await writeJson(path.join(tempRoot, ".visual-hive", "issues.json"), {
      schemaVersion: "visual-hive.issues.v1",
      generatedAt: "2026-01-05T00:00:00.000Z",
      project: "agent-issue-cli-demo",
      externalCallsMade: 0,
      networkCallsMade: 0,
      sourceArtifacts: { evidencePacket: ".visual-hive/evidence-packet.json", repoMap: ".visual-hive/repo-map.json" },
      summary: {
        total: 1,
        openCandidates: 1,
        updateCandidates: 0,
        resolvedCandidates: 0,
        suppressed: 0,
        blocked: 0,
        byKind: { mutation_survivor: 1 },
        bySeverity: { high: 1 }
      },
      issues: [
        {
          issueKind: "mutation_survivor",
          severity: "high",
          status: "open_candidate",
          dedupeFingerprint: "visual-hive:mutation_survivor:agent-cli",
          title: "[Visual Hive] Mutation survived: remove-demo-badge",
          labels: ["visual-hive", "mutation-survivor"],
          body: "<!-- visual-hive-issue dedupe:visual-hive:mutation_survivor:agent-cli -->\nVisual Hive does not repair code.",
          owningAgentHint: "visual-hive/mutation",
          sourceArtifacts: [".visual-hive/mutation-report.json"],
          affected: [{ contractId: "badge-contract", route: "/", selector: "[data-testid='demo-badge']", viewport: "desktop", targetId: "local" }],
          reproductionCommand: "visual-hive mutate --operator remove-demo-badge",
          validationCommand: "visual-hive mutate --operator remove-demo-badge",
          linkedEvidencePacket: ".visual-hive/evidence-packet.json",
          linkedRepoMap: ".visual-hive/repo-map.json",
          linkedMutationReport: ".visual-hive/mutation-report.json",
          linkedAgentPacket: ".visual-hive/agent-packet.json",
          guardrails: ["Visual Hive does not repair code.", "Do not weaken thresholds."]
        }
      ]
    });

    const result = await runAgentIssueRunnerCommand({
      config: path.join(tempRoot, "visual-hive.config.yaml"),
      cwd: tempRoot,
      dedupe: "visual-hive:mutation_survivor:agent-cli",
      maxRuntimeMs: 1000,
      maxToolCalls: 3
    });
    const output = formatAgentIssueRunnerResult(result);

    expect(output).toContain("Visual Hive Issue Agent Run");
    expect(result.run.profile).toBe("test_creator_agent");
    expect(result.run.budgets.maxRuntimeMs).toBe(1000);
    expect(result.run.budgets.maxToolCalls).toBe(3);
    expect(result.run.budgets.allowWrite).toBe(false);
    expect(result.run.safety.externalCallsMade).toBe(0);
    expect(result.run.safety.realGithubIssuesCreated).toBe(0);
    expect(result.requestPath).toMatch(/\.visual-hive\/agents\/.+\/agent-request\.md/);
    expect(result.outputPath).toMatch(/\.visual-hive\/agents\/.+\/agent-output\.md/);
    expect(result.runPath).toMatch(/\.visual-hive\/agents\/.+\/agent-run\.json/);
    await expect(access(path.join(tempRoot, result.requestPath))).resolves.toBeUndefined();
    await expect(access(path.join(tempRoot, result.outputPath))).resolves.toBeUndefined();
    await expectMatchesSchema("visual-hive.agent-issue-run.schema.json", await readJson(path.join(tempRoot, result.runPath)));
  });
});
