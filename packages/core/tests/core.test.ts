import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { VisualHiveConfigSchema, type VisualHiveConfig } from "../src/config/schema.js";
import { auditContracts } from "../src/contracts/audit.js";
import { analyzeCoverage } from "../src/coverage/analyze.js";
import { auditTargets } from "../src/targets/audit.js";
import { auditSchedules } from "../src/schedules/audit.js";
import { createPlan } from "../src/planner/createPlan.js";
import { calculateMutationScore } from "../src/mutations/score.js";
import { loadConfig, parseConfigText } from "../src/config/load.js";
import { MUTATION_OPERATOR_METADATA, selectContractsForMutation } from "../src/mutations/operators.js";
import { approveBaseline, listBaselines } from "../src/baselines/manage.js";
import { listProviderAdapters, PROVIDER_ADAPTER_OPERATION_SEQUENCE } from "../src/providers/adapter.js";
import { inspectProviders, normalizeProviderResults } from "../src/providers/inspect.js";
import { runMockProviderAdapters } from "../src/providers/mock.js";
import { recordRunHistory } from "../src/history/record.js";
import { auditWorkflows } from "../src/github/workflowAudit.js";
import { buildLLMUsageReport } from "../src/llm/usage.js";
import { indexArtifacts } from "../src/artifacts/index.js";
import { addConnection, listConnections, removeConnection } from "../src/connections/manage.js";
import { recommendSetup } from "../src/setup/recommend.js";
import { writeJson } from "../src/utils/files.js";
import type { Report } from "../src/reports/types.js";

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

function sampleConfig(): VisualHiveConfig {
  return VisualHiveConfigSchema.parse({
    project: {
      name: "sample",
      type: "react-vite",
      defaultBranch: "main"
    },
    targets: {
      safe: {
        kind: "url",
        url: "https://safe.example.com",
        prSafe: true,
        cost: "cheap"
      },
      unsafe: {
        kind: "url",
        url: "https://unsafe.example.com",
        prSafe: false,
        cost: "expensive"
      }
    },
    contracts: [
      {
        id: "safe-contract",
        description: "safe",
        target: "safe",
        severity: "high",
        runOn: { pullRequest: true, schedule: true },
        selectors: { mustExist: ["main"] },
        screenshots: [{ name: "home", route: "/", viewport: "desktop" }]
      },
      {
        id: "unsafe-contract",
        description: "unsafe",
        target: "unsafe",
        severity: "critical",
        runOn: { pullRequest: true, schedule: true },
        selectors: { mustExist: ["main"] }
      },
      {
        id: "changed-contract",
        description: "changed",
        target: "safe",
        severity: "medium",
        runOn: { pullRequest: false, schedule: false },
        selectors: { mustExist: ["main"] }
      }
    ],
    viewports: {
      desktop: { width: 1440, height: 900 }
    },
    selection: {
      ignoreChangedFiles: [
        {
          pattern: "docs/**",
          reason: "documentation-only"
        },
        {
          pattern: "**/*.md",
          reason: "markdown-only"
        },
        {
          pattern: "*.md",
          reason: "root markdown-only"
        }
      ],
      changedFiles: [
        {
          pattern: "src/**",
          contracts: ["changed-contract"],
          risk: "medium"
        }
      ]
    },
    mutation: {
      enabled: true,
      runOn: { schedule: true },
      minScore: 0.7,
      operators: ["hide-critical-button", "force-login-on-demo"]
    },
    ai: {
      enabled: false,
      provider: "none",
      neverSoleOracle: true,
      createIssuePrompt: true,
      maxDailyRuns: 5
    },
    github: {
      enabled: true,
      issueLabels: ["visual-hive"],
      commentMarker: "<!-- visual-hive-report -->"
    }
  });
}

describe("config validation", () => {
  it("accepts a valid config", () => {
    expect(sampleConfig().project.name).toBe("sample");
  });

  it("applies visual config defaults", () => {
    expect(sampleConfig().visual).toMatchObject({
      maxDiffPixelRatio: 0.01,
      updateSnapshots: false,
      failOnMissingBaselineInCI: true,
      snapshotDir: ".visual-hive/snapshots",
      artifactDir: ".visual-hive/artifacts"
    });
  });

  it("applies ignored changed-file defaults and validation", () => {
    const config = VisualHiveConfigSchema.parse({
      ...sampleConfig(),
      selection: {
        ignoreChangedFiles: [{ pattern: "docs/**" }]
      }
    });
    expect(config.selection.ignoreChangedFiles[0]).toEqual({
      pattern: "docs/**",
      reason: "changed file is ignored for visual planning"
    });
    expect(() =>
      VisualHiveConfigSchema.parse({
        ...sampleConfig(),
        selection: {
          ignoreChangedFiles: [{ pattern: "" }]
        }
      })
    ).toThrow();
  });

  it("validates contract flow steps", () => {
    const config = VisualHiveConfigSchema.parse({
      ...sampleConfig(),
      contracts: [
        {
          id: "flow-contract",
          description: "Flow contract",
          target: "safe",
          runOn: { pullRequest: true },
          steps: [
            { action: "goto", route: "/" },
            { action: "click", selector: "[data-testid='critical-action-button']" },
            { action: "assertText", selector: ".data-status", text: "Demo metrics loaded" }
          ]
        }
      ]
    });

    expect(config.contracts[0]?.steps.map((step) => step.action)).toEqual(["goto", "click", "assertText"]);
    expect(config.contracts[0]?.steps[0]?.timeoutMs).toBe(5000);
    expect(() =>
      VisualHiveConfigSchema.parse({
        ...sampleConfig(),
        contracts: [{ id: "broken-flow", description: "Broken", target: "safe", steps: [{ action: "click" }] }]
      })
    ).toThrow(/click steps require selector/);
  });

  it("applies AI governance defaults", () => {
    expect(sampleConfig().ai).toMatchObject({
      enabled: false,
      provider: "none",
      model: "offline-heuristics",
      neverSoleOracle: true,
      maxDailyRuns: 5,
      maxPromptTokens: 50000,
      maxEstimatedCostUsd: 0
    });
  });

  it("applies provider defaults and inspects credential names only", () => {
    const config = VisualHiveConfigSchema.parse({
      ...sampleConfig(),
      providers: {
        argos: { enabled: true },
        percy: { enabled: true, mode: "mock" }
      }
    });
    expect(config.providers.playwright.enabled).toBe(true);
    expect(config.providers.argos.requiredEnv).toEqual(["ARGOS_TOKEN"]);

    const inspected = inspectProviders(config, {});
    expect(inspected.find((provider) => provider.id === "playwright")?.availability).toBe("available");
    expect(inspected.find((provider) => provider.id === "argos")?.missingEnv).toEqual(["ARGOS_TOKEN"]);
    expect(inspected.find((provider) => provider.id === "argos")?.message).not.toContain("undefined");
    expect(inspected.find((provider) => provider.id === "percy")?.availability).toBe("mock");

    const normalized = normalizeProviderResults(config, { deterministicStatus: "passed", artifactCount: 3 }, {});
    expect(normalized.find((provider) => provider.providerId === "playwright")).toMatchObject({
      status: "passed",
      deterministicRole: "oracle",
      artifactCount: 3
    });
    expect(normalized.find((provider) => provider.providerId === "argos")).toMatchObject({
      status: "missing_credentials",
      missingEnv: ["ARGOS_TOKEN"]
    });
    expect(normalized.find((provider) => provider.providerId === "percy")?.status).toBe("mock");
  });

  it("runs mock provider adapter operations without leaking credential values", () => {
    const config = VisualHiveConfigSchema.parse({
      ...sampleConfig(),
      providers: {
        argos: { enabled: true, projectId: "visual-hive/demo" },
        percy: { enabled: true },
        storybook: { enabled: true, mode: "mock" },
        "github-checks": { enabled: true, mode: "mock" }
      }
    });

    const report = runMockProviderAdapters(
      config,
      {
        deterministicStatus: "passed",
        artifactCount: 2,
        artifactPaths: [".visual-hive/report.json", ".visual-hive/artifacts/screenshots/dashboard.png"],
        generatedAt: "2026-06-15T00:00:00.000Z"
      },
      { ARGOS_TOKEN: "super-secret-token-value" }
    );

    expect(report.schemaVersion).toBe(1);
    expect(report.summary.mockProviders).toBe(2);
    expect(report.summary.externalDeferredProviders).toBe(1);
    expect(report.summary.missingCredentialProviders).toBe(1);
    expect(report.providers.find((provider) => provider.providerId === "storybook")?.operations.map((operation) => operation.operation)).toEqual([
      "availability",
      "upload_artifact",
      "compare",
      "fetch_result",
      "normalize_result",
      "emit_report_metadata"
    ]);
    expect(report.providers.find((provider) => provider.providerId === "percy")?.missingEnv).toEqual(["PERCY_TOKEN"]);
    expect(report.providers.find((provider) => provider.providerId === "argos")?.normalized).toMatchObject({
      networkMode: "deferred",
      externalCallsMade: 0,
      hostedVisual: {
        provider: "argos",
        projectId: "visual-hive/demo",
        baselinePolicy: "provider-owned-future"
      }
    });
    expect(report.providers.find((provider) => provider.providerId === "storybook")?.normalized.storybook).toMatchObject({
      mode: "mock",
      recommendedCommand: "npm run storybook -- --ci"
    });
    expect(report.providers.find((provider) => provider.providerId === "github-checks")?.normalized.githubChecks).toMatchObject({
      checkName: "Visual Hive",
      conclusion: "success",
      trustedIssueWorkflowRequired: true
    });
    expect(report.providers.every((provider) => provider.normalized.externalCallsMade === 0)).toBe(true);
    expect(JSON.stringify(report)).not.toContain("super-secret-token-value");
  });

  it("exposes a provider adapter registry for every built-in provider", () => {
    const adapters = listProviderAdapters();

    expect(adapters.map((adapter) => adapter.id).sort()).toEqual(
      ["applitools", "argos", "chromatic", "github-checks", "percy", "playwright", "storybook"].sort()
    );
    for (const adapter of adapters) {
      expect(adapter.supportedOperations).toContain("availability");
      expect(adapter.supportedOperations).toContain("normalize_result");
      expect(adapter.supportedOperations).toContain("emit_report_metadata");
      expect(typeof adapter.checkAvailability).toBe("function");
      expect(typeof adapter.uploadArtifact).toBe("function");
      expect(typeof adapter.compare).toBe("function");
      expect(typeof adapter.fetchResult).toBe("function");
      expect(typeof adapter.normalizeResult).toBe("function");
      expect(typeof adapter.emitReportMetadata).toBe("function");
    }
    expect(PROVIDER_ADAPTER_OPERATION_SEQUENCE).toEqual([
      "availability",
      "upload_artifact",
      "compare",
      "fetch_result",
      "normalize_result",
      "emit_report_metadata"
    ]);
  });

  it("defaults protected target cost to expensive", () => {
    const config = VisualHiveConfigSchema.parse({
      project: { name: "protected-default" },
      targets: {
        live: {
          kind: "protected",
          url: "https://example.com"
        }
      },
      contracts: [{ id: "live", description: "Live", target: "live" }]
    });

    expect(config.targets.live.cost).toBe("expensive");
    expect(config.targets.live.prSafe).toBe(false);
  });

  it("rejects unsafe visual artifact paths", () => {
    expect(() =>
      VisualHiveConfigSchema.parse({
        project: { name: "bad-paths" },
        targets: { local: { kind: "url", url: "http://127.0.0.1:4173" } },
        contracts: [{ id: "home", description: "Home", target: "local" }],
        visual: { snapshotDir: "../snapshots" }
      })
    ).toThrow(/repo-relative/);
  });

  it("rejects an invalid config", () => {
    expect(() =>
      VisualHiveConfigSchema.parse({
        project: { name: "", type: "react-vite", defaultBranch: "main" },
        targets: {},
        contracts: []
      })
    ).toThrow();
  });

  it("returns an excellent missing config error", async () => {
    await expect(loadConfig("missing.yaml", repoRoot)).rejects.toThrow(/Missing Visual Hive config/);
  });

  it("parses config text with the same reference validation as file loading", () => {
    expect(() =>
      parseConfigText(
        `project:
  name: draft
targets:
  local:
    kind: url
    url: "http://127.0.0.1:4173"
contracts:
  - id: broken
    description: Broken
    target: missing
`,
        "draft.yaml"
      )
    ).toThrow(/Invalid target reference/);
  });

  it("returns an excellent invalid target reference error", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-core-"));
    tempDirs.push(tempRoot);
    const configPath = path.join(tempRoot, "visual-hive.config.yaml");
    await writeFile(
      configPath,
      `project:
  name: invalid-target
targets:
  local:
    kind: url
    url: "http://127.0.0.1:4173"
contracts:
  - id: broken
    description: Broken target ref
    target: missingTarget
`,
      "utf8"
    );

    await expect(loadConfig(configPath)).rejects.toThrow(/Invalid target reference/);
  });

  it("validates the KubeStellar example config", async () => {
    const loaded = await loadConfig("examples/kubestellar-console/visual-hive.config.yaml", repoRoot);
    expect(loaded.config.targets.liveCluster.kind).toBe("protected");
    expect(loaded.config.targets.fakeOAuthFullstack.kind).toBe("commandGroup");
  });

  it("selects expected KubeStellar contracts from sample changed files", async () => {
    const loaded = await loadConfig("examples/kubestellar-console/visual-hive.config.yaml", repoRoot);
    const authPlan = createPlan(loaded.config, {
      mode: "pr",
      changedFiles: ["web/src/features/auth/LoginPage.tsx"]
    });
    expect(authPlan.items.map((item) => item.contractId)).toEqual(
      expect.arrayContaining(["fake-oauth-login-dashboard", "hosted-demo-never-login", "local-login-visible-when-oauth-enabled"])
    );
    expect(authPlan.items.map((item) => item.contractId)).not.toContain("live-cluster-picker-renders");

    const docsPlan = createPlan(loaded.config, {
      mode: "pr",
      changedFiles: ["docs/getting-started.md"]
    });
    expect(docsPlan.items).toEqual([]);
    expect(docsPlan.effectiveChangedFiles).toEqual([]);
    expect(docsPlan.ignoredChangedFiles[0]).toMatchObject({ file: "docs/getting-started.md", pattern: "docs/**" });
    expect(docsPlan.excluded.map((item) => item.reasons.join(";"))).toContainEqual(
      expect.stringContaining("all changed files matched selection.ignoreChangedFiles")
    );
  });
});

describe("planner", () => {
  it("selects PR-safe contracts for PR mode", () => {
    const plan = createPlan(sampleConfig(), { mode: "pr", changedFiles: [] });
    expect(plan.items.map((item) => item.contractId)).toContain("safe-contract");
  });

  it("excludes unsafe targets unless allowed", () => {
    const plan = createPlan(sampleConfig(), { mode: "pr", changedFiles: [] });
    expect(plan.items.map((item) => item.contractId)).not.toContain("unsafe-contract");
    expect(plan.excluded[0]?.contractId).toBe("unsafe-contract");

    const allowed = createPlan(sampleConfig(), { mode: "pr", changedFiles: [], allowUnsafeTargets: true });
    expect(allowed.items.map((item) => item.contractId)).toContain("unsafe-contract");
  });

  it("selects scheduled contracts in schedule mode", () => {
    const plan = createPlan(sampleConfig(), { mode: "schedule", changedFiles: [] });
    expect(plan.items.map((item) => item.contractId)).toEqual(["safe-contract", "unsafe-contract"]);
    expect(plan.mutation.enabled).toBe(true);
  });

  it("selects cheap scheduled PR-safe contracts in canary mode", () => {
    const config = sampleConfig();
    config.targets.safe = { ...config.targets.safe, schedule: "*/15 * * * *", cost: "cheap" };
    config.targets.unsafe = { ...config.targets.unsafe, schedule: "*/15 * * * *", cost: "expensive" };

    const plan = createPlan(config, { mode: "canary", changedFiles: [] });

    expect(plan.items.map((item) => item.contractId)).toEqual(["safe-contract"]);
    expect(plan.items[0]?.reasons).toContain("mode=canary");
    expect(plan.items[0]?.reasons).toContain("cost is not expensive");
    expect(plan.excluded.find((item) => item.contractId === "unsafe-contract")?.reasons).toContain("target.prSafe=false");
    expect(plan.mutation.enabled).toBe(false);
  });

  it("selects mutation-applicable PR-safe contracts in mutation mode", () => {
    const config = sampleConfig();
    config.contracts = [
      {
        id: "critical-action",
        description: "Critical action is present",
        target: "safe",
        severity: "high",
        runOn: { pullRequest: false, schedule: false },
        waitFor: [],
        steps: [],
        failOnConsoleError: false,
        expectedConsoleErrors: [],
        selectors: {
          mustExist: ["[data-testid='critical-action-button']"],
          mustNotExist: [],
          textMustExist: [],
          textMustNotExist: []
        },
        screenshots: []
      },
      {
        id: "unsafe-login",
        description: "Unsafe login target",
        target: "unsafe",
        severity: "critical",
        runOn: { pullRequest: false, schedule: false },
        waitFor: [],
        steps: [],
        failOnConsoleError: false,
        expectedConsoleErrors: [],
        selectors: {
          mustExist: [],
          mustNotExist: ["[data-testid='login-page']"],
          textMustExist: [],
          textMustNotExist: []
        },
        screenshots: []
      }
    ];
    config.mutation.operators = ["hide-critical-button", "force-login-on-demo"];

    const plan = createPlan(config, { mode: "mutation", changedFiles: [] });

    expect(plan.items.map((item) => item.contractId)).toEqual(["critical-action"]);
    expect(plan.items[0]?.reasons.join(";")).toContain("mutation-mode:hide-critical-button");
    expect(plan.excluded.find((item) => item.contractId === "unsafe-login")?.reasons).toContain("target.prSafe=false");
    expect(plan.mutation.enabled).toBe(true);
  });

  it("selects all contracts in explicit full mode", () => {
    const plan = createPlan(sampleConfig(), { mode: "full", changedFiles: [] });

    expect(plan.items.map((item) => item.contractId).sort()).toEqual(["changed-contract", "safe-contract", "unsafe-contract"]);
    expect(plan.mutation.enabled).toBe(true);
  });

  it("selects changed-file contracts", () => {
    const plan = createPlan(sampleConfig(), { mode: "pr", changedFiles: ["src/App.tsx"] });
    expect(plan.items.map((item) => item.contractId)).toContain("changed-contract");
  });

  it("writes an intentional empty PR plan when every changed file is ignored", () => {
    const plan = createPlan(sampleConfig(), { mode: "pr", changedFiles: ["docs/guide.md", "README.md"] });

    expect(plan.items).toEqual([]);
    expect(plan.changedFiles).toEqual(["README.md", "docs/guide.md"]);
    expect(plan.effectiveChangedFiles).toEqual([]);
    expect(plan.ignoredChangedFiles.map((entry) => entry.file)).toEqual(["README.md", "docs/guide.md"]);
    expect(plan.excluded.find((item) => item.contractId === "safe-contract")?.reasons).toContain(
      "all changed files matched selection.ignoreChangedFiles"
    );
  });

  it("keeps normal PR selection when ignored files are mixed with app changes", () => {
    const plan = createPlan(sampleConfig(), { mode: "pr", changedFiles: ["docs/guide.md", "src/App.tsx"] });

    expect(plan.effectiveChangedFiles).toEqual(["src/App.tsx"]);
    expect(plan.ignoredChangedFiles.map((entry) => entry.file)).toEqual(["docs/guide.md"]);
    expect(plan.items.map((item) => item.contractId)).toContain("safe-contract");
    expect(plan.items.map((item) => item.contractId)).toContain("changed-contract");
  });

  it("supports explicit contract and target include rules", () => {
    const plan = createPlan(sampleConfig(), {
      mode: "pr",
      changedFiles: [],
      includeContracts: ["changed-contract"],
      includeTargets: ["safe"]
    });

    const selected = plan.items.map((item) => item.contractId);
    expect(selected).toContain("safe-contract");
    expect(selected).toContain("changed-contract");
    expect(plan.items.find((item) => item.contractId === "changed-contract")?.reasons).toContain("explicit include contract");
    expect(plan.items.find((item) => item.contractId === "safe-contract")?.reasons).toContain("explicit include target");
  });

  it("supports explicit exclude rules and keeps them higher priority than includes", () => {
    const plan = createPlan(sampleConfig(), {
      mode: "pr",
      changedFiles: ["src/App.tsx"],
      includeContracts: ["changed-contract"],
      excludeContracts: ["safe-contract"],
      excludeTargets: ["safe"]
    });

    expect(plan.items).toEqual([]);
    expect(plan.excluded.find((item) => item.contractId === "safe-contract")?.reasons).toEqual([
      "explicit exclude contract",
      "explicit exclude target"
    ]);
    expect(plan.excluded.find((item) => item.contractId === "changed-contract")?.reasons).toEqual(["explicit exclude target"]);
  });

  it("does not let explicit includes bypass PR target safety", () => {
    const blocked = createPlan(sampleConfig(), {
      mode: "pr",
      changedFiles: [],
      includeContracts: ["unsafe-contract"]
    });
    expect(blocked.items.map((item) => item.contractId)).not.toContain("unsafe-contract");
    expect(blocked.excluded.find((item) => item.contractId === "unsafe-contract")?.reasons).toContain("target.prSafe=false");

    const allowed = createPlan(sampleConfig(), {
      mode: "pr",
      changedFiles: [],
      includeContracts: ["unsafe-contract"],
      allowUnsafeTargets: true
    });
    expect(allowed.items.map((item) => item.contractId)).toContain("unsafe-contract");
  });
});

describe("coverage analysis", () => {
  it("summarizes targets, selected contracts, routes, viewports, and changed-file gaps", () => {
    const config = sampleConfig();
    const plan = createPlan(config, { mode: "pr", changedFiles: ["src/App.tsx", "README.md"] });
    const coverage = analyzeCoverage(config, { plan, now: new Date("2026-06-15T00:00:00.000Z") });

    expect(coverage.schemaVersion).toBe(1);
    expect(coverage.project).toBe("sample");
    expect(coverage.summary).toMatchObject({
      targetCount: 2,
      contractCount: 3,
      selectedContracts: 2,
      unselectedContracts: 1,
      prSafeContracts: 2,
      protectedContracts: 0,
      routesCovered: 1,
      viewportsCovered: 1,
      matchedChangedFileRules: 1,
      unmatchedChangedFiles: 0
    });
    expect(coverage.targets.find((target) => target.id === "safe")?.selectedContractIds.sort()).toEqual(["changed-contract", "safe-contract"]);
    expect(coverage.contracts.find((contract) => contract.id === "unsafe-contract")?.excludedReasons).toContain("target.prSafe=false");
    expect(coverage.routes[0]).toMatchObject({ route: "/", contracts: ["safe-contract"], selectedContracts: ["safe-contract"] });
    expect(coverage.changedFileCoverage[0]).toMatchObject({
      pattern: "src/**",
      matchedFiles: ["src/App.tsx"],
      selectedContracts: ["changed-contract"]
    });
    expect(coverage.uncoveredAreas.map((gap) => gap.kind)).not.toContain("changed_file_without_rule");
  });
});

describe("contract audit", () => {
  it("reports contract gaps, latest status, changed-file rules, and mutation mappings", () => {
    const config = sampleConfig();
    const plan = createPlan(config, { mode: "pr", changedFiles: ["src/App.tsx"] });
    const audit = auditContracts(config, {
      plan,
      report: {
        schemaVersion: 2,
        project: "sample",
        repository: sampleRepository,
        mode: "pr",
        generatedAt: "2026-06-15T00:00:00.000Z",
        status: "failed",
        changedFiles: ["src/App.tsx"],
        selectedTargets: [],
        selectedContracts: ["safe-contract", "changed-contract"],
        excludedContracts: [],
        targetLifecycle: [],
        generatedSpecPath: ".visual-hive/generated/visual-hive.generated.spec.ts",
        results: [
          {
            contractId: "safe-contract",
            targetId: "safe",
            status: "failed",
            durationMs: 5,
            errors: ["selector failed"],
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
        reproductionCommands: []
      }
    });

    expect(audit.schemaVersion).toBe(1);
    expect(audit.summary.contractCount).toBe(3);
    expect(audit.summary.failedContracts).toBe(1);
    expect(audit.summary.mutationMappedContracts).toBe(0);
    const safe = audit.contracts.find((contract) => contract.id === "safe-contract");
    expect(safe?.latestStatus).toBe("failed");
    expect(safe?.gaps.map((gap) => gap.kind)).toContain("failed_latest_run");
    const changed = audit.contracts.find((contract) => contract.id === "changed-contract");
    expect(changed?.changedFileRules[0]?.pattern).toBe("src/**");
    const unsafe = audit.contracts.find((contract) => contract.id === "unsafe-contract");
    expect(unsafe?.gaps.map((gap) => gap.kind)).toContain("pr_unsafe_target");
  });
});

describe("target audit", () => {
  it("reports target safety, services, missing secret names, lifecycle, and gaps", () => {
    const config = VisualHiveConfigSchema.parse({
      project: { name: "targets", type: "custom", defaultBranch: "main" },
      targets: {
        preview: {
          kind: "command",
          serve: "npm run preview -- --token=abc",
          url: "http://127.0.0.1:4173",
          prSafe: true,
          cost: "cheap"
        },
        fullstack: {
          kind: "commandGroup",
          url: "http://127.0.0.1:4177",
          prSafe: true,
          cost: "medium",
          services: [{ name: "api", command: "npm run api -- --secret=abc", url: "http://127.0.0.1:8080/health" }]
        },
        live: {
          kind: "protected",
          url: "https://prod.example.com",
          cost: "expensive",
          requiresSecrets: ["KUBECONFIG", "KC_AGENT_TOKEN"]
        }
      },
      contracts: [
        {
          id: "preview-contract",
          description: "Preview",
          target: "preview",
          runOn: { pullRequest: true },
          selectors: { mustExist: ["main"] }
        },
        {
          id: "live-contract",
          description: "Live",
          target: "live",
          runOn: { pullRequest: true, schedule: true },
          selectors: { mustExist: ["main"] }
        }
      ]
    });
    const plan = createPlan(config, { mode: "pr", changedFiles: [] });
    const audit = auditTargets(config, {
      plan,
      env: {},
      now: new Date("2026-06-15T00:00:00.000Z"),
      report: {
        schemaVersion: 2,
        project: "targets",
        repository: sampleRepository,
        mode: "pr",
        generatedAt: "2026-06-15T00:00:00.000Z",
        status: "failed",
        changedFiles: [],
        selectedTargets: [],
        selectedContracts: ["preview-contract"],
        excludedContracts: [],
        targetLifecycle: [
          {
            targetId: "preview",
            phase: "serve",
            status: "failed",
            durationMs: 10,
            command: "npm run preview -- --token=abc",
            url: "http://127.0.0.1:4173",
            message: "token=abc failed"
          }
        ],
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
        reproductionCommands: []
      }
    });

    expect(audit.summary.targetCount).toBe(3);
    expect(audit.summary.protectedTargets).toBe(1);
    expect(audit.summary.missingSecretNames).toBe(2);
    expect(audit.summary.targetsWithFailedLifecycle).toBe(1);
    expect(audit.targets.find((target) => target.id === "preview")?.lifecycleEvents[0]?.command).toContain("[REDACTED]");
    expect(audit.targets.find((target) => target.id === "fullstack")?.gaps.map((gap) => gap.kind)).toContain("target_without_contracts");
    const live = audit.targets.find((target) => target.id === "live");
    expect(live?.labels).toEqual(expect.arrayContaining(["Protected", "Expensive"]));
    expect(live?.missingSecrets).toEqual(["KUBECONFIG", "KC_AGENT_TOKEN"]);
    expect(live?.gaps.map((gap) => gap.kind)).toContain("pr_contract_on_unsafe_target");
  });
});

describe("schedule audit", () => {
  it("models PR, scheduled, protected, mutation, and trusted issue lanes without secret values", () => {
    const config = VisualHiveConfigSchema.parse({
      project: { name: "schedules", type: "custom", defaultBranch: "main" },
      targets: {
        preview: {
          kind: "url",
          url: "http://127.0.0.1:4173",
          prSafe: true,
          cost: "cheap"
        },
        live: {
          kind: "protected",
          url: "https://prod.example.com",
          schedule: "0 6 * * *",
          requiresSecrets: ["LIVE_TOKEN", "KC_AGENT_TOKEN"],
          cost: "expensive"
        }
      },
      contracts: [
        {
          id: "preview-pr",
          description: "Preview PR",
          target: "preview",
          runOn: { pullRequest: true, schedule: true },
          selectors: { mustExist: ["main"] }
        },
        {
          id: "live-scheduled",
          description: "Live scheduled",
          target: "live",
          runOn: { schedule: true },
          selectors: { mustExist: ["main"] }
        }
      ],
      mutation: {
        enabled: true,
        runOn: { schedule: true },
        minScore: 0.7,
        operators: ["hide-critical-button"]
      }
    });

    const audit = auditSchedules(config, {
      env: { LIVE_TOKEN: "super-secret-value" },
      now: new Date("2026-06-15T00:00:00.000Z"),
      changedFiles: ["src/App.tsx"]
    });

    expect(audit.schemaVersion).toBe(1);
    expect(audit.summary).toMatchObject({
      pullRequestContracts: 1,
      scheduledContracts: 2,
      protectedContracts: 1,
      protectedScheduledContracts: 1,
      mutationScheduled: true,
      missingSecretNames: 1
    });
    expect(audit.lanes.map((lane) => lane.id)).toEqual(["pull_request", "scheduled", "protected", "mutation", "trusted_issue"]);
    expect(audit.lanes.find((lane) => lane.id === "pull_request")?.usesSecrets).toBe(false);
    expect(audit.lanes.find((lane) => lane.id === "protected")?.requiresSecrets).toEqual(["KC_AGENT_TOKEN", "LIVE_TOKEN"]);
    expect(audit.lanes.find((lane) => lane.id === "protected")?.missingSecrets).toEqual(["KC_AGENT_TOKEN"]);
    expect(JSON.stringify(audit)).not.toContain("super-secret-value");
    expect(audit.recommendations).toContain("Keep PR workflows read-only and secret-free.");
  });
});

describe("workflow safety audit", () => {
  it("flags unsafe PR workflow patterns and validates trusted issue workflows", () => {
    const audit = auditWorkflows(
      sampleConfig(),
      [
        {
          path: ".github/workflows/unsafe-pr.yml",
          content: `name: Unsafe PR
on:
  pull_request_target:
permissions:
  contents: write
  issues: write
jobs:
  visual-hive:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npx visual-hive plan --mode pr
        env:
          TOKEN: \${{ secrets.PR_TOKEN }}
      - uses: actions/github-script@v7
        with:
          script: github.rest.issues.create({})
`
        },
        {
          path: ".github/workflows/visual-hive-failure-issue.yml",
          content: `name: Visual Hive failure issue
on:
  workflow_run:
    workflows: ["Visual Hive PR"]
permissions:
  contents: read
  actions: read
  issues: write
jobs:
  issue:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
      - uses: actions/github-script@v7
        with:
          script: |
            const marker = "<!-- visual-hive-dedupe:" + context.runId + " -->";
            await github.rest.issues.create({ body: marker });
`
        }
      ],
      { workflowRoot: ".github/workflows", now: new Date("2026-06-15T00:00:00.000Z") }
    );

    expect(audit.schemaVersion).toBe(1);
    expect(audit.summary.workflowCount).toBe(2);
    expect(audit.summary.workflowsUsingPullRequestTarget).toBe(1);
    expect(audit.summary.prWorkflowsUsingSecrets).toBe(1);
    expect(audit.summary.prWorkflowsWithWritePermissions).toBe(1);
    expect(audit.summary.trustedIssueWorkflows).toBe(1);
    expect(audit.findings.map((finding) => finding.kind)).toEqual(
      expect.arrayContaining(["pull_request_target_execution", "pr_uses_secrets", "pr_write_permissions", "pr_creates_issues"])
    );
    expect(audit.workflows.find((workflow) => workflow.kind === "trusted_issue")?.checksOutCode).toBe(false);
  });

  it("recognizes a safe Visual Hive PR workflow", () => {
    const audit = auditWorkflows(sampleConfig(), [
      {
        path: ".github/workflows/visual-hive-pr.yml",
        content: `name: Visual Hive PR
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
      - run: npx visual-hive triage
      - run: npx visual-hive report --github-step-summary
      - uses: actions/upload-artifact@v4
        with:
          name: visual-hive
          path: .visual-hive
          include-hidden-files: true
`
      }
    ]);

    expect(audit.summary.pullRequestWorkflows).toBe(1);
    expect(audit.summary.criticalFindings).toBe(0);
    expect(audit.summary.prWorkflowsUsingSecrets).toBe(0);
    expect(audit.workflows[0]?.risk).toBe("low");
  });
});

describe("mutation score", () => {
  it("calculates killed over total", () => {
    expect(calculateMutationScore([{ killed: true }, { killed: false }, { killed: true }])).toEqual({
      killed: 2,
      total: 3,
      score: 2 / 3
    });
  });

  it("returns zero for empty mutation sets", () => {
    expect(calculateMutationScore([])).toEqual({ killed: 0, total: 0, score: 0 });
  });

  it("excludes non-applicable mutations from score", () => {
    expect(calculateMutationScore([{ killed: false, applicable: false }, { killed: true, applicable: true }])).toEqual({
      killed: 1,
      total: 1,
      score: 1
    });
  });

  it("maps mutation operators to contracts explicitly and heuristically", () => {
    const config = sampleConfig();
    const explicit = selectContractsForMutation({ id: "hide-critical-button", contracts: ["safe-contract"] }, config.contracts);
    expect(explicit.contractIds).toEqual(["safe-contract"]);

    const heuristic = selectContractsForMutation("force-login-on-demo", [
      {
        ...config.contracts[0],
        id: "login-guard",
        selectors: { mustExist: [], mustNotExist: ["[data-testid='login-page']"], textMustExist: [], textMustNotExist: [] }
      }
    ]);
    expect(heuristic.contractIds).toEqual(["login-guard"]);
  });

  it("accepts and documents the complete built-in mutation operator set", () => {
    const operatorIds = [
      "hide-critical-button",
      "force-login-on-demo",
      "remove-demo-badge",
      "api-500",
      "empty-data",
      "mobile-overflow",
      "route-guard-bypass",
      "hidden-error-banner",
      "broken-image",
      "removed-accessible-name",
      "theme-token-drift",
      "stale-loading-state"
    ] as const;
    const config = VisualHiveConfigSchema.parse({
      project: { name: "mutations" },
      targets: { local: { kind: "url", url: "http://127.0.0.1:4173" } },
      contracts: [{ id: "home", description: "home", target: "local" }],
      mutation: {
        enabled: true,
        operators: operatorIds
      }
    });

    expect(config.mutation.operators).toEqual(operatorIds);
    expect(Object.keys(MUTATION_OPERATOR_METADATA).sort()).toEqual([...operatorIds].sort());
    for (const operatorId of operatorIds) {
      expect(MUTATION_OPERATOR_METADATA[operatorId].description.length).toBeGreaterThan(10);
      expect(MUTATION_OPERATOR_METADATA[operatorId].expectedFailureKinds.length).toBeGreaterThan(0);
    }
  });

  it("heuristically maps extended mutation operators to relevant contracts", () => {
    const contracts = VisualHiveConfigSchema.parse({
      project: { name: "extended-mutations" },
      targets: { local: { kind: "url", url: "http://127.0.0.1:4173" } },
      contracts: [
        {
          id: "auth-guard",
          description: "Public route guard should not expose protected UI",
          target: "local",
          selectors: { mustNotExist: ["[data-testid='protected-route']"] }
        },
        {
          id: "error-state",
          description: "API error banner should render",
          target: "local",
          selectors: { mustExist: ["[data-testid='error-banner']"] }
        },
        {
          id: "hero-image",
          description: "Logo image should render",
          target: "local",
          selectors: { mustExist: ["img[alt='Logo']"] },
          screenshots: [{ name: "home", route: "/", viewport: "desktop" }]
        },
        {
          id: "accessible-button",
          description: "Critical accessible button remains labeled",
          target: "local",
          selectors: { mustExist: ["button[aria-label='Deploy']"], textMustExist: ["Deploy"] }
        },
        {
          id: "theme",
          description: "Theme token visual stability",
          target: "local",
          screenshots: [{ name: "theme", route: "/", viewport: "desktop" }]
        },
        {
          id: "loading",
          description: "Loaded dashboard should not show stale loading spinner",
          target: "local",
          selectors: { mustNotExist: ["[data-testid='loading-state']"] }
        }
      ],
      viewports: { desktop: { width: 1440, height: 900 } }
    }).contracts;

    expect(selectContractsForMutation("route-guard-bypass", contracts).contractIds).toEqual(["auth-guard"]);
    expect(selectContractsForMutation("hidden-error-banner", contracts).contractIds).toEqual(["error-state"]);
    expect(selectContractsForMutation("broken-image", contracts).contractIds).toContain("hero-image");
    expect(selectContractsForMutation("removed-accessible-name", contracts).contractIds).toContain("accessible-button");
    expect(selectContractsForMutation("theme-token-drift", contracts).contractIds).toContain("theme");
    expect(selectContractsForMutation("stale-loading-state", contracts).contractIds).toContain("loading");
  });
});

describe("baseline management", () => {
  it("lists and approves a screenshot baseline with an audit record", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-baseline-"));
    tempDirs.push(tempRoot);
    const hiveRoot = path.join(tempRoot, ".visual-hive");
    const actualPath = path.join(hiveRoot, "artifacts", "screenshots", "dashboard.png");
    const baselinePath = path.join(hiveRoot, "snapshots", "dashboard.png");
    const reportPath = path.join(hiveRoot, "report.json");
    await mkdir(path.dirname(actualPath), { recursive: true });
    await mkdir(path.dirname(baselinePath), { recursive: true });
    await writeFile(actualPath, "approved-image", "utf8");
    await writeFile(baselinePath, "old-image", "utf8");
    await writeFile(reportPath, JSON.stringify(reportFixture(tempRoot, actualPath, baselinePath), null, 2), "utf8");

    const list = await listBaselines({ repoRoot: tempRoot, reportPath });
    expect(list.entries[0]).toMatchObject({
      contractId: "dashboard",
      screenshotName: "desktop",
      status: "failed",
      canApprove: true
    });

    const approval = await approveBaseline({
      repoRoot: tempRoot,
      reportPath,
      contractId: "dashboard",
      screenshotName: "desktop",
      viewport: "desktop"
    });

    expect(approval.bytes).toBe("approved-image".length);
    await expect(readFile(baselinePath, "utf8")).resolves.toBe("approved-image");
    const approvalLog = JSON.parse(await readFile(path.join(hiveRoot, "baseline-approvals.json"), "utf8")) as { approvals: unknown[] };
    expect(approvalLog.approvals).toHaveLength(1);
  });

  it("refuses to approve baselines outside the repo root", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-baseline-escape-"));
    tempDirs.push(tempRoot);
    const hiveRoot = path.join(tempRoot, ".visual-hive");
    const actualPath = path.join(hiveRoot, "artifacts", "screenshots", "dashboard.png");
    const reportPath = path.join(hiveRoot, "report.json");
    await mkdir(path.dirname(actualPath), { recursive: true });
    await writeFile(actualPath, "image", "utf8");
    await writeFile(reportPath, JSON.stringify(reportFixture(tempRoot, actualPath, path.join(tempRoot, "..", "escape.png")), null, 2), "utf8");

    await expect(
      approveBaseline({
        repoRoot: tempRoot,
        reportPath,
        contractId: "dashboard",
        screenshotName: "desktop"
      })
    ).rejects.toThrow(/outside repository root/);
  });
});

describe("run history", () => {
  it("archives latest artifacts, summarizes trends, and sanitizes copied text artifacts", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-history-"));
    tempDirs.push(tempRoot);
    const hiveRoot = path.join(tempRoot, ".visual-hive");
    await mkdir(hiveRoot, { recursive: true });
    await writeFile(
      path.join(hiveRoot, "report.json"),
      JSON.stringify(reportFixture(tempRoot, path.join(hiveRoot, "artifacts", "actual.png"), path.join(hiveRoot, "snapshots", "baseline.png")), null, 2),
      "utf8"
    );
    await writeFile(
      path.join(hiveRoot, "mutation-report.json"),
      JSON.stringify(
        {
          schemaVersion: 2,
          project: "baseline-fixture",
          generatedAt: "2026-06-15T00:01:00.000Z",
          minScore: 0.7,
          score: 0.5,
          killed: 1,
          total: 2,
          results: []
        },
        null,
        2
      ),
      "utf8"
    );
    await writeFile(path.join(hiveRoot, "issue.md"), "token=abc123 should be redacted", "utf8");
    await writeFile(path.join(hiveRoot, "pr-comment.md"), "Authorization: Bearer pr-comment-secret", "utf8");

    const history = await recordRunHistory({
      repoRoot: tempRoot,
      now: new Date("2026-06-15T00:02:00.000Z"),
      runId: "run-one"
    });

    expect(history.summary).toMatchObject({
      runCount: 1,
      failedRuns: 1,
      latestStatus: "failed",
      latestMutationScore: 0.5,
      totalVisualDiffs: 1
    });
    expect(history.entries[0]?.files.report).toBe(".visual-hive/history/run-one/report.json");
    expect(history.entries[0]?.files.issue).toBe(".visual-hive/history/run-one/issue.md");
    expect(history.entries[0]?.files.prComment).toBe(".visual-hive/history/run-one/pr-comment.md");
    await expect(readFile(path.join(hiveRoot, "history", "run-one", "issue.md"), "utf8")).resolves.toContain("[REDACTED]");
    await expect(readFile(path.join(hiveRoot, "history", "run-one", "pr-comment.md"), "utf8")).resolves.toContain("[REDACTED]");
    const index = JSON.parse(await readFile(path.join(hiveRoot, "history.json"), "utf8")) as { entries: unknown[] };
    expect(index.entries).toHaveLength(1);
  });
});

describe("LLM usage governance", () => {
  it("records prompt-only token and cost estimates without API calls", () => {
    const config = VisualHiveConfigSchema.parse({
      ...sampleConfig(),
      ai: {
        enabled: true,
        provider: "openai",
        model: "gpt-4o-mini",
        neverSoleOracle: true,
        createIssuePrompt: true,
        maxDailyRuns: 5,
        maxPromptTokens: 10,
        maxEstimatedCostUsd: 1
      }
    });

    const usage = buildLLMUsageReport(
      config,
      [{ task: "repair_prompt", path: ".visual-hive/repair-prompt.md", content: "x".repeat(100) }],
      { now: new Date("2026-06-15T00:00:00.000Z") }
    );

    expect(usage.schemaVersion).toBe(1);
    expect(usage.summary.callsMade).toBe(0);
    expect(usage.summary.promptOnly).toBe(true);
    expect(usage.records[0]).toMatchObject({
      task: "repair_prompt",
      promptOnly: true,
      advisoryOnly: true,
      callsMade: 0,
      status: "blocked_by_token_budget",
      estimatedTokens: 25
    });
  });
});

describe("artifact index", () => {
  it("classifies artifacts and creates sanitized previews", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-artifacts-"));
    tempDirs.push(tempRoot);
    const hiveRoot = path.join(tempRoot, ".visual-hive");
    await mkdir(path.join(hiveRoot, "artifacts", "screenshots"), { recursive: true });
    await writeFile(path.join(hiveRoot, "report.json"), '{"token":"abc123","status":"failed"}', "utf8");
    await writeFile(path.join(hiveRoot, "triage-prompt.md"), "Authorization: Bearer secret-token", "utf8");
    await writeFile(path.join(hiveRoot, "pr-comment.md"), "Cookie: session=secret-token", "utf8");
    await writeFile(path.join(hiveRoot, "generated", "visual-hive.generated.spec.ts"), "test('dashboard', async () => {});", "utf8").catch(async () => {
      await mkdir(path.join(hiveRoot, "generated"), { recursive: true });
      await writeFile(path.join(hiveRoot, "generated", "visual-hive.generated.spec.ts"), "test('dashboard', async () => {});", "utf8");
    });
    await writeFile(path.join(hiveRoot, "artifacts", "screenshots", "dashboard.png"), "png-bytes", "utf8");

    const index = await indexArtifacts({
      repoRoot: tempRoot,
      project: "artifact-fixture",
      now: new Date("2026-06-15T00:00:00.000Z")
    });

    expect(index.summary.artifactCount).toBe(5);
    expect(index.summary.image).toBe(1);
    expect(index.summary.redactedPreviews).toBeGreaterThanOrEqual(1);
    const prompt = index.artifacts.find((artifact) => artifact.path.endsWith("triage-prompt.md"));
    expect(prompt?.preview).toContain("[REDACTED]");
    expect(prompt?.labels).toContain("prompt");
    const comment = index.artifacts.find((artifact) => artifact.path.endsWith("pr-comment.md"));
    expect(comment?.preview).toContain("[REDACTED]");
    expect(comment?.labels).toContain("pr-comment");
    const spec = index.artifacts.find((artifact) => artifact.kind === "typescript");
    expect(spec?.labels).toContain("generated-spec");
  });

  it("refuses to index artifact roots outside the repo", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-artifacts-escape-"));
    tempDirs.push(tempRoot);
    await expect(indexArtifacts({ repoRoot: tempRoot, hiveRoot: path.dirname(tempRoot) })).rejects.toThrow(/outside repository root/);
  });

  it("labels setup recommendation artifacts", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-artifacts-recommend-"));
    tempDirs.push(tempRoot);
    await writeJson(path.join(tempRoot, ".visual-hive", "recommendations.json"), { schemaVersion: 1 });

    const index = await indexArtifacts({ repoRoot: tempRoot });

    expect(index.artifacts.find((artifact) => artifact.path.endsWith("recommendations.json"))?.labels).toContain("setup-recommendations");
  });
});

describe("setup recommendations", () => {
  it("detects a React/Vite repo and emits a validated starter config", async () => {
    const targetRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-recommend-"));
    tempDirs.push(targetRoot);
    await writeJson(path.join(targetRoot, "package.json"), {
      name: "sample-dashboard",
      scripts: {
        build: "vite build",
        preview: "vite preview"
      },
      dependencies: {
        react: "^19.0.0",
        vite: "^6.0.0"
      }
    });
    await mkdir(path.join(targetRoot, "src"), { recursive: true });
    await writeFile(path.join(targetRoot, "src", "App.tsx"), `<main data-testid="dashboard-page">Dashboard</main>`, "utf8");

    const recommendation = await recommendSetup({ repoRoot: targetRoot, now: new Date("2026-06-15T00:00:00.000Z") });
    const parsedYaml = VisualHiveConfigSchema.parse(parseYaml(recommendation.recommendedConfigYaml));

    expect(recommendation.project.type).toBe("react-vite");
    expect(recommendation.recommendedTarget.kind).toBe("command");
    expect(recommendation.recommendedTarget.serve).toBe("npm run preview -- --port 4173");
    expect(recommendation.recommendedContracts[0]?.selectors).toContain("[data-testid='dashboard-page']");
    expect(recommendation.recommendedContracts[0]?.steps[0]).toMatchObject({ action: "assertVisible", selector: "[data-testid='dashboard-page']" });
    expect(parsedYaml.contracts[0]?.id).toBe("app-shell-visual-stability");
    expect(parsedYaml.contracts[0]?.steps[0]?.action).toBe("assertVisible");
    expect(parsedYaml.targets.localPreview.kind).toBe("command");
  });
});

describe("local repository connections", () => {
  it("adds, lists, inspects, and removes connected repositories", async () => {
    const managerRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-connections-manager-"));
    const connectedRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-connections-target-"));
    tempDirs.push(managerRoot, connectedRoot);
    await writeMinimalConfig(managerRoot, "manager-project");
    await writeMinimalConfig(connectedRoot, "connected-project");
    await writeJson(path.join(connectedRoot, ".visual-hive", "report.json"), {
      schemaVersion: 2,
      project: "connected-project",
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
      reproductionCommands: []
    });

    const added = await addConnection({
      repoRoot: managerRoot,
      repoPath: connectedRoot,
      id: "console",
      label: "Console",
      tags: ["dogfood"]
    });

    expect(added.summary.storedConnections).toBe(1);
    expect(added.connections.find((connection) => connection.id === "console")).toMatchObject({
      status: "ready",
      projectName: "connected-project",
      latestDeterministicStatus: "passed",
      tags: ["dogfood"]
    });

    const listed = await listConnections({ repoRoot: managerRoot });
    expect(listed.connections.map((connection) => connection.id)).toContain("current");
    expect(listed.connections.map((connection) => connection.id)).toContain("console");

    const removed = await removeConnection({ repoRoot: managerRoot, id: "console" });
    expect(removed.connections.map((connection) => connection.id)).not.toContain("console");
  });

  it("refuses connection stores outside the managing repo", async () => {
    const managerRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-connections-safe-"));
    tempDirs.push(managerRoot);
    await writeMinimalConfig(managerRoot, "manager-project");

    await expect(listConnections({ repoRoot: managerRoot, connectionsPath: path.join(managerRoot, "..", "connections.json") })).rejects.toThrow(
      /outside the repository root/
    );
  });
});

async function writeMinimalConfig(repoRoot: string, projectName: string): Promise<void> {
  await writeFile(
    path.join(repoRoot, "visual-hive.config.yaml"),
    `project:
  name: ${projectName}
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
}

function reportFixture(repoRoot: string, actualPath: string, baselinePath: string): Report {
  return {
    schemaVersion: 2,
    project: "baseline-fixture",
    repository: sampleRepository,
    mode: "manual",
    generatedAt: "2026-06-15T00:00:00.000Z",
    status: "failed",
    changedFiles: [],
    selectedTargets: [{ id: "local", kind: "url", url: "http://127.0.0.1:4173", prSafe: true, cost: "cheap" }],
    selectedContracts: ["dashboard"],
    excludedContracts: [],
    targetLifecycle: [],
    generatedSpecPath: path.join(repoRoot, ".visual-hive", "generated", "visual-hive.generated.spec.ts"),
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
            actualDiffPixels: 20,
            diffPixels: 20,
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
    artifacts: [actualPath],
    reproductionCommands: ["visual-hive run --ci"]
  };
}
