import { mkdir, mkdtemp, readFile, readdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { VisualHiveConfigSchema, type VisualHiveConfig } from "../src/config/schema.js";
import { auditContracts } from "../src/contracts/audit.js";
import { analyzeCoverage } from "../src/coverage/analyze.js";
import { applyCoverageImprovementRecommendation, buildCoverageImprovementReport } from "../src/coverage/improve.js";
import { auditFlows } from "../src/flows/audit.js";
import { auditTargets } from "../src/targets/audit.js";
import { resolveTargetUrl } from "../src/targets/resolve.js";
import { auditSchedules } from "../src/schedules/audit.js";
import { createPlan } from "../src/planner/createPlan.js";
import { calculateMutationScore } from "../src/mutations/score.js";
import { loadConfig, parseConfigText } from "../src/config/load.js";
import { MUTATION_OPERATOR_METADATA, selectContractsForMutation } from "../src/mutations/operators.js";
import { approveBaseline, listBaselines, rejectBaseline, writeBaselineReview } from "../src/baselines/manage.js";
import { listProviderAdapters, PROVIDER_ADAPTER_OPERATION_SEQUENCE } from "../src/providers/adapter.js";
import { readProviderDecisionLog, recordProviderDecision } from "../src/providers/decisions.js";
import { inspectProviders, normalizeProviderResults } from "../src/providers/inspect.js";
import { runMockProviderAdapters } from "../src/providers/mock.js";
import { buildProviderSetupPlan } from "../src/providers/setupPlan.js";
import { createRunHistoryEntry, createRunHistoryReport, recordRunHistory } from "../src/history/record.js";
import { analyzeRisk } from "../src/risk/analyze.js";
import { analyzeReadiness } from "../src/readiness/analyze.js";
import { analyzeSecurity, npmAuditSummaryFromJson } from "../src/security/audit.js";
import { analyzeCosts } from "../src/costs/analyze.js";
import { auditWorkflows } from "../src/github/workflowAudit.js";
import { githubWorkflowTemplates } from "../src/github/workflowTemplates.js";
import { readLLMDecisionLog, recordLLMDecision } from "../src/llm/decisions.js";
import { buildLLMUsageReport, KNOWN_LLM_PROMPT_ARTIFACTS } from "../src/llm/usage.js";
import { buildTriageReport } from "../src/reports/triageReport.js";
import { indexArtifacts } from "../src/artifacts/index.js";
import { addConnection, listConnections, removeConnection } from "../src/connections/manage.js";
import { buildSetupDocsMarkdown } from "../src/setup/docs.js";
import { buildSetupProgress } from "../src/setup/progress.js";
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
    expect(sampleConfig().project.setupProfile).toBe("free-local");
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

  it("applies provider cost policy defaults", () => {
    expect(sampleConfig().costPolicy).toMatchObject({
      maxExternalScreenshotsPerRun: 0,
      maxMonthlyExternalScreenshots: 5000,
      externalUpload: {
        pullRequest: false,
        schedule: true,
        manual: true,
        canary: false,
        mutation: false,
        full: true,
        onFailureOnly: true,
        criticalContractsOnly: true
      }
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

  it("blocks external provider upload by default cost policy", () => {
    const config = VisualHiveConfigSchema.parse({
      ...sampleConfig(),
      providers: {
        argos: { enabled: true }
      }
    });

    const inspected = inspectProviders(config, { ARGOS_TOKEN: "secret-token" }, { mode: "pr", deterministicStatus: "passed", artifactCount: 3 });
    const argos = inspected.find((provider) => provider.id === "argos");
    expect(argos?.availability).toBe("policy_blocked");
    expect(argos?.costPolicy.externalUploadAllowed).toBe(false);
    expect(argos?.costPolicy.blockedReasons.join(" ")).toContain("pullRequest=false");
    expect(argos?.costPolicy.blockedReasons.join(" ")).toContain("onFailureOnly=true");
    expect(argos?.costPolicy.blockedReasons.join(" ")).toContain("maxExternalScreenshotsPerRun 0");

    const normalized = normalizeProviderResults(config, { deterministicStatus: "passed", artifactCount: 3, mode: "pr" }, { ARGOS_TOKEN: "secret-token" });
    expect(normalized.find((provider) => provider.providerId === "argos")).toMatchObject({
      status: "skipped",
      externalUploadAllowed: false,
      estimatedExternalScreenshots: 3
    });
  });

  it("builds a no-network provider setup plan with required authorization and no secret values", () => {
    const config = VisualHiveConfigSchema.parse({
      ...sampleConfig(),
      providers: {
        argos: { enabled: true, projectId: "visual-hive/demo" }
      }
    });

    const plan = buildProviderSetupPlan(config, {
      providerId: "argos",
      env: { ARGOS_TOKEN: "super-secret-token-value" },
      generatedAt: "2026-06-15T00:00:00.000Z"
    });

    expect(plan).toMatchObject({
      schemaVersion: 1,
      project: "sample",
      providerId: "argos",
      label: "Argos",
      recommendation: "blocked",
      authorizationRequired: true,
      externalCallsMade: 0,
      readiness: {
        enabled: true,
        mode: "external",
        missingEnv: [],
        projectIdConfigured: true,
        externalUploadAllowed: false
      }
    });
    expect(plan.readiness.externalUploadBlockedReasons.join(" ")).toContain("onFailureOnly=true");
    expect(plan.configChanges.join(" ")).toContain("costPolicy.externalUpload.pullRequest=false");
    expect(plan.workflowSteps.join(" ")).toContain("trusted environments");
    expect(plan.safetyChecks.join(" ")).toContain("sole pass/fail oracle");
    expect(plan.validationCommands).toContain("visual-hive providers list --mock-results");
    expect(JSON.stringify(plan)).not.toContain("super-secret-token-value");
  });

  it("keeps disabled providers advisory in setup plans", () => {
    const plan = buildProviderSetupPlan(sampleConfig(), {
      providerId: "percy",
      env: {},
      generatedAt: "2026-06-15T00:00:00.000Z"
    });

    expect(plan.recommendation).toBe("keep_disabled");
    expect(plan.authorizationRequired).toBe(true);
    expect(plan.readiness.missingEnv).toEqual(["PERCY_TOKEN"]);
    expect(plan.configChanges.join(" ")).toContain("enabled=true only after approving");
    expect(plan.warnings.join(" ")).toContain("Provider is currently disabled");
    expect(plan.externalCallsMade).toBe(0);
  });

  it("runs mock provider adapter operations without leaking credential values", () => {
    const config = VisualHiveConfigSchema.parse({
      ...sampleConfig(),
      costPolicy: {
        maxExternalScreenshotsPerRun: 25,
        maxMonthlyExternalScreenshots: 5000,
        externalUpload: {
          pullRequest: false,
          schedule: true,
          manual: true,
          canary: false,
          mutation: false,
          full: true,
          onFailureOnly: false,
          criticalContractsOnly: false
        }
      },
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
        generatedAt: "2026-06-15T00:00:00.000Z",
        mode: "manual"
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

  it("records provider governance decisions in core without leaking secrets or making external calls", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-provider-decision-"));
    tempDirs.push(tempRoot);
    const decisionPath = path.join(tempRoot, ".visual-hive", "provider-decisions.json");

    const result = await recordProviderDecision(decisionPath, {
      providerId: "argos",
      label: "Argos",
      decision: "review_later",
      reason: "Review after ARGOS_TOKEN=abc123 and client_secret=hidden are configured.",
      source: "control-plane",
      now: new Date("2026-06-16T00:00:00.000Z")
    });
    const log = await readProviderDecisionLog(decisionPath);

    expect(result.decisionPath).toBe(".visual-hive/provider-decisions.json");
    expect(result.decision).toMatchObject({
      providerId: "argos",
      label: "Argos",
      decision: "review_later",
      source: "control-plane",
      externalCallsMade: 0
    });
    expect(result.decision.reason).toContain("[REDACTED]");
    expect(JSON.stringify(log)).not.toContain("abc123");
    expect(JSON.stringify(log)).not.toContain("hidden");
    expect(log?.decisions[0].externalCallsMade).toBe(0);
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

  it("supports deploy preview targets with PR-safe cheap defaults", () => {
    const config = VisualHiveConfigSchema.parse({
      project: { name: "deploy-preview-default" },
      targets: {
        preview: {
          kind: "deployPreview",
          provider: "vercel",
          urlEnv: "VERCEL_URL"
        }
      },
      contracts: [{ id: "preview", description: "Preview", target: "preview" }]
    });

    expect(config.targets.preview.kind).toBe("deployPreview");
    expect(config.targets.preview.prSafe).toBe(true);
    expect(config.targets.preview.cost).toBe("cheap");
    expect(resolveTargetUrl(config.targets.preview, { VERCEL_URL: "visual-hive-preview.vercel.app" }).url).toBe(
      "https://visual-hive-preview.vercel.app"
    );
  });

  it("uses deploy preview templates and fallback URLs without exposing env values in reasons", () => {
    const config = VisualHiveConfigSchema.parse({
      project: { name: "deploy-preview-template" },
      targets: {
        preview: {
          kind: "deployPreview",
          provider: "custom",
          urlEnv: "PREVIEW_HOST",
          urlTemplate: "https://${PREVIEW_HOST}/console",
          fallbackUrl: "https://fallback.example.com"
        }
      },
      contracts: [{ id: "preview", description: "Preview", target: "preview" }]
    });

    expect(resolveTargetUrl(config.targets.preview, { PREVIEW_HOST: "pr-12.example.com" }).url).toBe("https://pr-12.example.com/console");
    expect(resolveTargetUrl(config.targets.preview, {}).url).toBe("https://fallback.example.com");
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

    const schedulePlan = createPlan(loaded.config, { mode: "schedule" });
    expect(schedulePlan.items.map((item) => item.contractId)).toEqual(
      expect.arrayContaining(["live-cluster-picker-renders", "live-workloads-renders"])
    );
    expect(schedulePlan.targets.find((target) => target.id === "liveCluster")).toMatchObject({
      kind: "protected",
      requiresSecrets: ["KUBECONFIG", "KC_AGENT_TOKEN"]
    });
    expect(schedulePlan.mutation.enabled).toBe(true);
  });
});

describe("schema catalog", () => {
  it("includes JSON schemas for every documented governance artifact", async () => {
    const schemaNames = new Set((await readdir(path.join(repoRoot, "schemas"))).filter((name) => name.endsWith(".schema.json")));

    expect(schemaNames).toContain("visual-hive.provider-decisions.schema.json");
    expect(schemaNames).toContain("visual-hive.llm-decisions.schema.json");
    expect(schemaNames).toContain("visual-hive.flows.schema.json");
    expect(schemaNames).toContain("visual-hive.connections-portfolio.schema.json");
    expect(schemaNames).toContain("visual-hive.runbook.schema.json");

    const providerSchema = JSON.parse(await readFile(path.join(repoRoot, "schemas", "visual-hive.provider-decisions.schema.json"), "utf8")) as {
      properties: { decisions: { items: { $ref: string } } };
      $defs: { decision: { properties: Record<string, unknown> } };
    };
    const llmSchema = JSON.parse(await readFile(path.join(repoRoot, "schemas", "visual-hive.llm-decisions.schema.json"), "utf8")) as {
      $defs: { decision: { properties: Record<string, unknown> } };
    };

    expect(providerSchema.$defs.decision.properties.externalCallsMade).toEqual({ const: 0 });
    expect(llmSchema.$defs.decision.properties.externalCallsMade).toEqual({ const: 0 });
    expect(providerSchema.$defs.decision.properties.source).toEqual({ enum: ["cli", "control-plane"] });
    expect(llmSchema.$defs.decision.properties.source).toEqual({ enum: ["cli", "control-plane"] });
  });
});

describe("planner", () => {
  it("selects PR-safe contracts for PR mode", () => {
    const plan = createPlan(sampleConfig(), { mode: "pr", changedFiles: [] });
    expect(plan.items.map((item) => item.contractId)).toContain("safe-contract");
  });

  it("records provider availability and cost policy in plans without planning external calls", () => {
    const config = sampleConfig();
    config.providers.argos = {
      ...config.providers.argos,
      enabled: true
    };

    const plan = createPlan(config, { mode: "pr", changedFiles: [], env: { ARGOS_TOKEN: "secret-value" } });
    const playwright = plan.providerPolicy.find((provider) => provider.providerId === "playwright");
    const argos = plan.providerPolicy.find((provider) => provider.providerId === "argos");

    expect(playwright).toMatchObject({
      availability: "available",
      externalUploadAllowed: true,
      externalCallsPlanned: 0
    });
    expect(argos).toMatchObject({
      availability: "policy_blocked",
      missingEnv: [],
      externalUploadAllowed: false,
      estimatedExternalScreenshots: 1,
      externalCallsPlanned: 0
    });
    expect(argos?.externalUploadBlockedReasons.join(" ")).toContain("pullRequest=false");
    expect(JSON.stringify(plan.providerPolicy)).not.toContain("secret-value");
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

  it("excludes deploy preview contracts when the URL env var is missing", () => {
    const config = VisualHiveConfigSchema.parse({
      project: { name: "deploy-preview-plan" },
      targets: {
        preview: {
          kind: "deployPreview",
          provider: "vercel",
          urlEnv: "VERCEL_URL"
        }
      },
      contracts: [
        {
          id: "preview-dashboard",
          description: "Preview dashboard",
          target: "preview",
          runOn: { pullRequest: true }
        }
      ]
    });

    const missing = createPlan(config, { mode: "pr", changedFiles: [], env: {} });
    expect(missing.items).toEqual([]);
    expect(missing.excluded[0]).toMatchObject({
      contractId: "preview-dashboard",
      reasons: expect.arrayContaining(["Deploy preview URL env var VERCEL_URL is not set and no fallbackUrl is configured."])
    });

    const resolved = createPlan(config, { mode: "pr", changedFiles: [], env: { VERCEL_URL: "preview.example.com" } });
    expect(resolved.items[0]).toMatchObject({
      contractId: "preview-dashboard",
      targetUrl: "https://preview.example.com"
    });
    expect(resolved.targets[0]).toMatchObject({
      kind: "deployPreview",
      url: "https://preview.example.com",
      prSafe: true,
      cost: "cheap"
    });
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

  it("selects all PR-safe contracts in explicit full mode by default", () => {
    const plan = createPlan(sampleConfig(), { mode: "full", changedFiles: [] });

    expect(plan.items.map((item) => item.contractId).sort()).toEqual(["changed-contract", "safe-contract"]);
    expect(plan.excluded.find((item) => item.contractId === "unsafe-contract")?.reasons).toContain("target.prSafe=false");
    expect(plan.mutation.enabled).toBe(true);
  });

  it("includes unsafe contracts in full mode only when explicitly allowed", () => {
    const plan = createPlan(sampleConfig(), { mode: "full", changedFiles: [], allowUnsafeTargets: true });

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

  it("builds deterministic coverage improvement recommendations from gaps and mutation survivors", () => {
    const config = sampleConfig();
    const plan = createPlan(config, { mode: "pr", changedFiles: ["scripts/build.js"] });
    const coverage = analyzeCoverage(config, { plan, changedFiles: ["scripts/build.js"], now: new Date("2026-06-15T00:00:00.000Z") });
    const report = buildCoverageImprovementReport(
      config,
      coverage,
      {
        schemaVersion: 2,
        project: "sample",
        generatedAt: "2026-06-15T00:01:00.000Z",
        minScore: 0.7,
        score: 0,
        killed: 0,
        total: 1,
        results: [
          {
            operator: "hide-critical-button",
            status: "survived",
            killed: false,
            contractIds: ["safe-contract"],
            applicable: true,
            expectedFailureKinds: ["missing_element"],
            durationMs: 25,
            errors: ["critical button remained uncovered"]
          }
        ]
      },
      { now: new Date("2026-06-15T00:02:00.000Z") }
    );

    expect(report.schemaVersion).toBe(1);
    expect(report.project).toBe("sample");
    expect(report.summary.total).toBeGreaterThan(0);
    expect(report.summary.fromMutationSurvivors).toBe(1);
    expect(report.recommendations.map((recommendation) => recommendation.kind)).toContain("map_mutation_operator");
    expect(report.recommendations.map((recommendation) => recommendation.kind)).toContain("add_changed_file_rule");
    expect(report.recommendations.find((recommendation) => recommendation.kind === "map_mutation_operator")?.suggestedConfigYaml).toContain(
      "hide-critical-button"
    );
    expect(report.recommendations.find((recommendation) => recommendation.id === "changed-file-rule:scripts/build.js")?.suggestedConfigYaml).toContain(
      "scripts/**"
    );
  });

  it("applies a selected coverage improvement recommendation as a validated config diff", () => {
    const config = sampleConfig();
    const plan = createPlan(config, { mode: "pr", changedFiles: ["scripts/build.js"] });
    const coverage = analyzeCoverage(config, { plan, changedFiles: ["scripts/build.js"], now: new Date("2026-06-15T00:00:00.000Z") });
    const report = buildCoverageImprovementReport(config, coverage, undefined, { now: new Date("2026-06-15T00:02:00.000Z") });
    const result = applyCoverageImprovementRecommendation(config, report, "changed-file-rule:scripts/build.js");
    const parsed = parseConfigText(result.configText);

    expect(result.applied).toBe(true);
    expect(result.diff).toContain("+    - pattern: scripts/**");
    expect(parsed.selection.changedFiles.map((rule) => rule.pattern)).toContain("scripts/**");
    expect(parsed.selection.changedFiles.find((rule) => rule.pattern === "scripts/**")?.contracts.length).toBeGreaterThan(0);
  });

  it("applies mutation survivor recommendations by mapping the operator and adding suggested assertions", () => {
    const config = sampleConfig();
    const plan = createPlan(config, { mode: "pr", changedFiles: ["src/App.tsx"] });
    const coverage = analyzeCoverage(config, { plan, changedFiles: ["src/App.tsx"], now: new Date("2026-06-15T00:00:00.000Z") });
    const report = buildCoverageImprovementReport(
      config,
      coverage,
      {
        schemaVersion: 2,
        project: "sample",
        generatedAt: "2026-06-15T00:01:00.000Z",
        minScore: 0.7,
        score: 0,
        killed: 0,
        total: 1,
        results: [
          {
            operator: "hide-critical-button",
            status: "survived",
            killed: false,
            contractIds: ["safe-contract"],
            applicable: true,
            expectedFailureKinds: ["missing_element"],
            durationMs: 25,
            errors: ["critical button remained uncovered"]
          }
        ]
      },
      { now: new Date("2026-06-15T00:02:00.000Z") }
    );
    const result = applyCoverageImprovementRecommendation(config, report, "mutation-survivor:hide-critical-button:safe-contract");
    const parsed = parseConfigText(result.configText);
    const mappedOperator = parsed.mutation.operators.find((operator) =>
      typeof operator === "string" ? false : operator.id === "hide-critical-button"
    );

    expect(result.applied).toBe(true);
    expect(result.diff).toContain("id: hide-critical-button");
    expect(mappedOperator).toMatchObject({ id: "hide-critical-button", contracts: ["safe-contract"] });
    expect(parsed.contracts.find((contract) => contract.id === "safe-contract")?.selectors.mustExist).toContain(
      "[data-testid='critical-action-button']"
    );
  });

  it("builds and applies flow-step coverage recommendations from flow gaps", () => {
    const config = sampleConfig();
    const flowAudit = auditFlows(config, { selectedContractIds: ["safe-contract"], now: new Date("2026-06-15T00:01:00.000Z") });
    const coverage = analyzeCoverage(config, { changedFiles: [], now: new Date("2026-06-15T00:00:00.000Z") });
    const report = buildCoverageImprovementReport(config, coverage, undefined, {
      now: new Date("2026-06-15T00:02:00.000Z"),
      flowAudit
    });
    const flowRecommendation = report.recommendations.find((recommendation) => recommendation.id === "flow-steps:safe-contract");
    const result = applyCoverageImprovementRecommendation(config, report, "flow-steps:safe-contract");
    const parsed = parseConfigText(result.configText);
    const steps = parsed.contracts.find((contract) => contract.id === "safe-contract")?.steps ?? [];

    expect(report.summary.fromFlowGaps).toBeGreaterThan(0);
    expect(flowRecommendation).toMatchObject({ contractId: "safe-contract", route: "/" });
    expect(flowRecommendation).toMatchObject({ lane: "pull_request", trustedOnly: false });
    expect(result.applied).toBe(true);
    expect(steps.map((step) => step.action)).toEqual(expect.arrayContaining(["goto", "assertVisible"]));
    expect(steps.find((step) => step.action === "assertVisible")?.selector).toBe("main");
  });

  it("marks protected flow recommendations as trusted-only", () => {
    const config = sampleConfig();
    const flowAudit = auditFlows(config, { selectedContractIds: ["safe-contract"], now: new Date("2026-06-15T00:01:00.000Z") });
    const coverage = analyzeCoverage(config, { changedFiles: [], now: new Date("2026-06-15T00:00:00.000Z") });
    const report = buildCoverageImprovementReport(config, coverage, undefined, { flowAudit });
    const protectedRecommendation = report.recommendations.find((recommendation) => recommendation.id === "flow-steps:unsafe-contract");

    expect(protectedRecommendation).toMatchObject({
      contractId: "unsafe-contract",
      lane: "protected",
      trustedOnly: true
    });
    expect(protectedRecommendation?.suggestedTests.join(" ")).toContain("trusted scheduled/manual lane");
  });
});

describe("risk register", () => {
  it("prioritizes deterministic, baseline, mutation, coverage, flow, target, workflow, and provider risks", () => {
    const config = sampleConfig();
    const plan = createPlan(config, { mode: "pr", changedFiles: ["src/App.tsx"] });
    const report: Report = {
      schemaVersion: 2,
      project: "sample",
      repository: sampleRepository,
      mode: "pr",
      generatedAt: "2026-06-15T00:00:00.000Z",
      status: "failed",
      changedFiles: ["src/App.tsx"],
      selectedTargets: [{ id: "safe", kind: "url", url: "https://safe.example.com", prSafe: true, cost: "cheap" }],
      selectedContracts: ["safe-contract", "changed-contract"],
      excludedContracts: [],
      targetLifecycle: [],
      generatedSpecPath: ".visual-hive/generated/visual-hive.generated.spec.ts",
      results: [
        {
          contractId: "safe-contract",
          targetId: "safe",
          status: "failed",
          durationMs: 12,
          errors: ["mustExist main failed with token=secret-value"],
          artifacts: [".visual-hive/artifacts/results/safe-contract.json"],
          selectorAssertions: [{ kind: "mustExist", value: "main", status: "failed" }],
          screenshotAssertions: [
            {
              contractId: "safe-contract",
              screenshotName: "home",
              name: "home",
              route: "/",
              viewport: "desktop",
              status: "missing_baseline",
              baselinePath: ".visual-hive/snapshots/home.png",
              actualPath: ".visual-hive/artifacts/screenshots/home.png",
              maxDiffPixelRatio: 0.01,
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
        missingBaselines: 1,
        visualDiffs: 0,
        consoleErrors: 0,
        pageErrors: 0
      },
      consoleErrors: [],
      pageErrors: [],
      artifacts: [],
      providerResults: [
        {
          providerId: "argos",
          label: "Argos",
          status: "missing_credentials",
          deterministicRole: "supplemental",
          message: "Missing ARGOS_TOKEN",
          requiredEnv: ["ARGOS_TOKEN"],
          missingEnv: ["ARGOS_TOKEN"],
          artifactCount: 0,
          normalizedAt: "2026-06-15T00:00:00.000Z"
        }
      ],
      reproductionCommands: ["visual-hive run --ci"]
    };
    const coverage = analyzeCoverage(config, { plan });
    const targets = auditTargets(config, { plan, report, env: {} });
    const workflows = auditWorkflows(config, [
      {
        path: ".github/workflows/visual-hive-pr.yml",
        content: "on: pull_request_target\npermissions:\n  contents: write\njobs:\n  test:\n    steps:\n      - run: echo broken"
      }
    ]);
    const risk = analyzeRisk(config, {
      plan,
      report,
      mutationReport: {
        schemaVersion: 2,
        project: "sample",
        generatedAt: "2026-06-15T00:00:00.000Z",
        minScore: 0.7,
        score: 0.5,
        killed: 1,
        total: 2,
        results: [
          {
            operator: "force-login-on-demo",
            status: "survived",
            killed: false,
            applicable: true,
            contractIds: ["safe-contract"],
            expectedFailureKinds: ["login_regression"],
            durationMs: 5,
            errors: [],
            artifacts: [".visual-hive/mutation-report.json"]
          }
        ]
      },
      coverageReport: coverage,
      flowAudit: auditFlows(config, { plan, report }),
      targetAudit: targets,
      workflowAudit: workflows,
      providerDecisions: {
        schemaVersion: 1,
        generatedAt: "2026-06-15T00:00:00.000Z",
        decisions: [
          {
            providerId: "argos",
            label: "Argos",
            decision: "skip",
            reason: "Use local Playwright artifacts for now.",
            decidedAt: "2026-06-15T00:00:00.000Z",
            source: "cli",
            externalCallsMade: 0
          }
        ]
      },
      llmDecisions: {
        schemaVersion: 1,
        generatedAt: "2026-06-15T00:00:00.000Z",
        decisions: [
          {
            decision: "keep_disabled",
            reason: "No model calls from PR lanes.",
            decidedAt: "2026-06-15T00:00:00.000Z",
            source: "cli",
            externalCallsMade: 0
          }
        ]
      },
      now: new Date("2026-06-15T00:00:00.000Z")
    });

    expect(risk.schemaVersion).toBe(1);
    expect(risk.summary.total).toBeGreaterThan(0);
    expect(risk.summary.prBlocking).toBeGreaterThan(0);
    expect(risk.inputs.flowAudit).toBe(true);
    expect(risk.inputs.providerDecisions).toBe(true);
    expect(risk.inputs.llmDecisions).toBe(true);
    expect(risk.risks.map((item) => item.category)).toEqual(
      expect.arrayContaining([
        "deterministic_failure",
        "baseline_review",
        "mutation_adequacy",
        "flow_coverage",
        "target_safety",
        "workflow_safety",
        "provider_policy",
        "llm_governance"
      ])
    );
    expect(risk.risks.find((item) => item.id === "provider-decision:argos")).toMatchObject({
      category: "provider_policy",
      trustedOnly: true
    });
    expect(risk.risks.find((item) => item.category === "deterministic_failure")?.message).toContain("[REDACTED]");
    expect(risk.risks.find((item) => item.id === "llm-decision:latest")).toMatchObject({
      category: "llm_governance",
      trustedOnly: true
    });
    expect(risk.recommendations).toContain("Fix deterministic contract failures before updating baselines.");
    expect(risk.recommendations).toContain("Add or repair deterministic flow steps for high-risk user journeys.");
    expect(risk.recommendations).toContain("Repair critical/high GitHub workflow safety findings before relying on CI automation.");
  });

  it("reports tag-pinned action workflow risk as production hardening only", () => {
    const workflows = auditWorkflows(sampleConfig(), [
      {
        path: ".github/workflows/visual-hive-pr.yml",
        content: `
on: pull_request
permissions:
  contents: read
jobs:
  visual-hive:
    steps:
      - uses: actions/checkout@v4
      - uses: actions/upload-artifact@v4
        with:
          include-hidden-files: true
      - run: visual-hive baselines list --write
`
      }
    ]);
    const risk = analyzeRisk(sampleConfig(), { workflowAudit: workflows, now: new Date("2026-06-15T00:00:00.000Z") });

    expect(risk.summary.prBlocking).toBe(0);
    expect(risk.risks.find((item) => item.id.includes("action_not_sha_pinned"))).toMatchObject({
      category: "workflow_safety",
      severity: "low",
      prBlocking: false
    });
    expect(risk.recommendations).toContain(
      "For production hardening, pin external GitHub Actions by full commit SHA after reviewing upstream source."
    );
    expect(risk.recommendations.join(" ")).not.toContain("Repair critical/high GitHub workflow safety findings");
  });

  it("flags enabled external providers without matching setup plans", () => {
    const config = VisualHiveConfigSchema.parse({
      project: { name: "provider-risk", type: "custom", defaultBranch: "main" },
      targets: { local: { kind: "url", url: "http://127.0.0.1:4173" } },
      contracts: [{ id: "dashboard", description: "Dashboard", target: "local", runOn: { pullRequest: true } }],
      providers: {
        argos: {
          enabled: true,
          mode: "external",
          requiredEnv: ["ARGOS_TOKEN"]
        }
      }
    });
    const plan = createPlan(config, { mode: "pr", changedFiles: ["src/App.tsx"] });

    const missingPlanRisk = analyzeRisk(config, { plan, now: new Date("2026-06-15T00:00:00.000Z") });
    expect(missingPlanRisk.inputs.providerSetupPlan).toBe(false);
    expect(missingPlanRisk.risks.find((item) => item.id === "provider-setup-plan:missing:argos")).toMatchObject({
      category: "provider_policy",
      severity: "medium",
      trustedOnly: true
    });

    const setupPlan = buildProviderSetupPlan(config, { providerId: "argos", env: {}, generatedAt: "2026-06-15T00:00:00.000Z" });
    const withPlanRisk = analyzeRisk(config, { plan, providerSetupPlan: setupPlan, now: new Date("2026-06-15T00:00:00.000Z") });
    expect(withPlanRisk.inputs.providerSetupPlan).toBe(true);
    expect(withPlanRisk.risks.find((item) => item.id === "provider-setup-plan:argos")).toMatchObject({
      title: "Provider setup is blocked: Argos",
      category: "provider_policy",
      severity: "medium",
      trustedOnly: true
    });
    expect(withPlanRisk.risks.find((item) => item.id === "provider-setup-plan:missing:argos")).toBeUndefined();
    expect(JSON.stringify(withPlanRisk)).not.toContain("secret-value");
  });

  it("turns regressed run history into actionable risk evidence", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-risk-history-"));
    tempDirs.push(tempRoot);
    const previousReport = reportFixture(tempRoot, path.join(tempRoot, ".visual-hive", "artifacts", "previous.png"), path.join(tempRoot, ".visual-hive", "snapshots", "baseline.png"));
    previousReport.status = "passed";
    previousReport.summary.failed = 0;
    previousReport.summary.visualDiffs = 0;
    previousReport.results[0]!.status = "passed";
    previousReport.results[0]!.errors = [];
    const latestReport = reportFixture(tempRoot, path.join(tempRoot, ".visual-hive", "artifacts", "latest.png"), path.join(tempRoot, ".visual-hive", "snapshots", "baseline.png"));
    const runHistory = createRunHistoryReport({
      project: "sample",
      generatedAt: "2026-06-15T01:01:00.000Z",
      entries: [
        createRunHistoryEntry({
          repoRoot: tempRoot,
          id: "previous",
          recordedAt: "2026-06-15T00:00:00.000Z",
          files: { report: ".visual-hive/history/previous/report.json" },
          report: previousReport
        }),
        createRunHistoryEntry({
          repoRoot: tempRoot,
          id: "latest",
          recordedAt: "2026-06-15T01:00:00.000Z",
          files: { report: ".visual-hive/history/latest/report.json" },
          report: latestReport
        })
      ]
    });

    const risk = analyzeRisk(sampleConfig(), { runHistory, now: new Date("2026-06-15T01:02:00.000Z") });

    expect(risk.inputs.runHistory).toBe(true);
    expect(risk.risks.find((item) => item.category === "history_regression")).toMatchObject({
      id: "history:latest-run-regressed",
      severity: "high",
      prBlocking: true
    });
    expect(risk.recommendations).toContain("Compare latest and previous run history before accepting the current visual QA state.");
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

describe("flow audit", () => {
  it("reports user-flow coverage, latest flow failures, and critical gaps", () => {
    const base = sampleConfig();
    const config = VisualHiveConfigSchema.parse({
      ...base,
      contracts: base.contracts.map((contract) =>
        contract.id === "safe-contract"
          ? {
              ...contract,
              steps: [
                { action: "goto", route: "/" },
                { action: "click", selector: "[data-testid='critical-action-button']" },
                { action: "assertText", selector: "main", text: "Ready" }
              ]
            }
          : contract
      )
    });
    const plan = createPlan(config, { mode: "pr", changedFiles: ["src/App.tsx"], allowUnsafeTargets: true });
    const report: Report = {
      schemaVersion: 2,
      project: "sample",
      repository: sampleRepository,
      mode: "pr",
      generatedAt: "2026-06-15T00:00:00.000Z",
      status: "failed",
      changedFiles: ["src/App.tsx"],
      selectedTargets: [],
      selectedContracts: ["safe-contract"],
      excludedContracts: [],
      targetLifecycle: [],
      generatedSpecPath: ".visual-hive/generated/visual-hive.generated.spec.ts",
      results: [
        {
          contractId: "safe-contract",
          targetId: "safe",
          status: "failed",
          durationMs: 10,
          errors: ["flow failed"],
          artifacts: [],
          flowSteps: [
            { action: "goto", route: "/", status: "passed", durationMs: 1 },
            {
              action: "click",
              selector: "[data-testid='critical-action-button']",
              status: "failed",
              durationMs: 2,
              message: "button was disabled"
            }
          ],
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
        pageErrors: 0,
        flowStepsPassed: 1,
        flowStepsFailed: 1
      },
      consoleErrors: [],
      pageErrors: [],
      artifacts: [],
      reproductionCommands: []
    };

    const audit = auditFlows(config, { plan, report, now: new Date("2026-06-15T00:00:00.000Z") });

    expect(audit.schemaVersion).toBe(1);
    expect(audit.summary).toMatchObject({
      contractCount: 3,
      flowContractCount: 1,
      flowStepCount: 3,
      navigationSteps: 1,
      interactionSteps: 1,
      assertionSteps: 1,
      failedFlowSteps: 1,
      criticalContractsWithoutFlow: 1
    });
    const safe = audit.flows.find((flow) => flow.contractId === "safe-contract");
    expect(safe?.steps.map((step) => step.category)).toEqual(["navigation", "interaction", "assertion"]);
    expect(safe?.gaps.map((gap) => gap.kind)).toContain("failed_latest_flow");
    expect(safe?.latestFailedMessages).toContain("button was disabled");
    const unsafe = audit.flows.find((flow) => flow.contractId === "unsafe-contract");
    expect(unsafe?.gaps.map((gap) => gap.kind)).toContain("no_flow_steps");
    expect(audit.recommendations.join(" ")).toContain("critical contracts");
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

  it("reports deploy preview target URL readiness by env name only", () => {
    const config = VisualHiveConfigSchema.parse({
      project: { name: "deploy-targets", type: "custom", defaultBranch: "main" },
      targets: {
        preview: {
          kind: "deployPreview",
          provider: "vercel",
          urlEnv: "VERCEL_URL"
        }
      },
      contracts: [
        {
          id: "preview-pr",
          description: "Preview PR",
          target: "preview",
          runOn: { pullRequest: true }
        }
      ]
    });

    const missing = auditTargets(config, { env: {}, now: new Date("2026-06-15T00:00:00.000Z") });
    expect(missing.summary.deployPreviewTargets).toBe(1);
    expect(missing.targets[0]?.url).toBe("");
    expect(missing.targets[0]?.gaps.map((gap) => gap.kind)).toContain("deploy_preview_url_unresolved");
    expect(JSON.stringify(missing)).toContain("VERCEL_URL");

    const ready = auditTargets(config, {
      env: { VERCEL_URL: "secret-preview-host.vercel.app" },
      now: new Date("2026-06-15T00:00:00.000Z")
    });
    expect(ready.targets[0]).toMatchObject({
      kind: "deployPreview",
      url: "https://secret-preview-host.vercel.app",
      prSafe: true,
      cost: "cheap"
    });
    expect(ready.targets[0]?.gaps.map((gap) => gap.kind)).not.toContain("deploy_preview_url_unresolved");
  });

  it("validates, plans, and audits storybook targets as PR-safe component lanes", () => {
    const config = VisualHiveConfigSchema.parse({
      project: { name: "storybook-targets", type: "custom", defaultBranch: "main", setupProfile: "component-storybook" },
      targets: {
        componentLibrary: {
          kind: "storybook",
          install: "npm ci",
          build: "npm run build-storybook",
          serve: "npm run storybook -- --host 127.0.0.1 --port 6006",
          url: "http://127.0.0.1:6006",
          stories: ["src/**/*.stories.tsx"],
          components: ["src/components/**"]
        }
      },
      contracts: [
        {
          id: "storybook-button",
          description: "Button story remains stable",
          target: "componentLibrary",
          severity: "medium",
          runOn: { pullRequest: true },
          screenshots: [{ name: "button-primary", route: "/?path=/story/button--primary", viewport: "desktop" }]
        }
      ],
      selection: {
        changedFiles: [{ pattern: "src/components/**", contracts: ["storybook-button"], risk: "medium" }]
      }
    });

    expect(config.targets.componentLibrary).toMatchObject({
      kind: "storybook",
      prSafe: true,
      cost: "cheap"
    });

    const plan = createPlan(config, { mode: "pr", changedFiles: ["src/components/Button.tsx"] });
    expect(plan.targets[0]).toMatchObject({ id: "componentLibrary", kind: "storybook", url: "http://127.0.0.1:6006" });
    expect(plan.items.map((item) => item.contractId)).toEqual(["storybook-button"]);

    const audit = auditTargets(config, { plan, now: new Date("2026-06-15T00:00:00.000Z") });
    expect(audit.summary.storybookTargets).toBe(1);
    expect(audit.summary.setupRequiredTargets).toBe(1);
    expect(audit.targets[0]?.labels).toEqual(expect.arrayContaining(["Safe on PR", "Needs setup"]));
    expect(audit.targets[0]?.commands).toMatchObject({
      build: "npm run build-storybook",
      serve: "npm run storybook -- --host 127.0.0.1 --port 6006"
    });
    expect(audit.targets[0]?.gaps.map((gap) => gap.kind)).not.toContain("storybook_without_component_scope");
  });

  it("flags storybook targets without declared story or component scope", () => {
    const config = VisualHiveConfigSchema.parse({
      project: { name: "storybook-scope", type: "custom", defaultBranch: "main" },
      targets: {
        componentLibrary: {
          kind: "storybook",
          url: "http://127.0.0.1:6006"
        }
      },
      contracts: [
        {
          id: "storybook-smoke",
          description: "Storybook smoke",
          target: "componentLibrary",
          runOn: { pullRequest: true }
        }
      ]
    });

    const audit = auditTargets(config, { now: new Date("2026-06-15T00:00:00.000Z") });
    expect(audit.targets[0]?.gaps.map((gap) => gap.kind)).toContain("storybook_without_component_scope");
    expect(audit.targets[0]?.recommendations.join(" ")).toContain("component globs");
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
      expect.arrayContaining([
        "pull_request_target_execution",
        "pr_uses_secrets",
        "pr_write_permissions",
        "pr_creates_issues",
        "missing_issue_artifact",
        "missing_trusted_issue_redaction"
      ])
    );
    const trusted = audit.workflows.find((workflow) => workflow.kind === "trusted_issue");
    expect(trusted?.checksOutCode).toBe(false);
    expect(trusted?.readsIssueArtifact).toBe(false);
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
      - run: npx visual-hive baselines list --write
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
    expect(audit.summary.workflowsUsingUnpinnedActions).toBe(1);
    expect(audit.summary.unpinnedActionReferences).toBe(2);
    expect(audit.workflows[0]?.risk).toBe("low");
    expect(audit.workflows[0]?.writesBaselineReview).toBe(true);
    expect(audit.workflows[0]?.unpinnedActions.map((action) => action.value)).toEqual(["actions/checkout@v4", "actions/upload-artifact@v4"]);
    expect(audit.findings.find((finding) => finding.kind === "action_not_sha_pinned")?.severity).toBe("low");
  });

  it("treats SHA-pinned external actions and local actions as production-hardened", () => {
    const sha = "1234567890abcdef1234567890abcdef12345678";
    const audit = auditWorkflows(sampleConfig(), [
      {
        path: ".github/workflows/sha-pinned.yml",
        content: `name: SHA pinned
on:
  workflow_dispatch:
permissions:
  contents: read
jobs:
  visual-hive:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@${sha}
      - uses: ./.github/actions/local-setup
      - uses: docker://ghcr.io/example/action@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
      - run: npx visual-hive report --github-step-summary
`
      }
    ]);

    expect(audit.summary.workflowsUsingUnpinnedActions).toBe(0);
    expect(audit.summary.unpinnedActionReferences).toBe(0);
    expect(audit.workflows[0]?.actions.map((action) => action.pinning)).toEqual(["sha", "local", "sha"]);
    expect(audit.findings.map((finding) => finding.kind)).not.toContain("action_not_sha_pinned");
  });

  it("warns when Visual Hive workflows upload artifacts without baseline review evidence", () => {
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
      - run: npx visual-hive plan --mode pr --ci
      - run: npx visual-hive run --ci
      - run: npx visual-hive report --github-step-summary
      - uses: actions/upload-artifact@v4
        with:
          path: .visual-hive
          include-hidden-files: true
`
      }
    ]);

    expect(audit.workflows[0]?.writesBaselineReview).toBe(false);
    expect(audit.findings.map((finding) => finding.kind)).toContain("missing_baseline_review_artifact");
    expect(audit.findings.find((finding) => finding.kind === "missing_baseline_review_artifact")?.severity).toBe("low");
  });

  it("recognizes a safe trusted issue workflow with recursive artifact discovery and redaction", () => {
    const audit = auditWorkflows(sampleConfig(), [
      {
        path: ".github/workflows/visual-hive-failure-issue.yml",
        content: `name: Visual Hive Failure Issue
on:
  workflow_run:
    workflows: ["Visual Hive PR"]
    types: [completed]
permissions:
  contents: read
  actions: read
  issues: write
jobs:
  create-issue:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@1234567890abcdef1234567890abcdef12345678
        with:
          name: visual-hive
          path: visual-hive-artifacts
      - uses: actions/github-script@abcdef1234567890abcdef1234567890abcdef12
        with:
          script: |
            const fs = require("fs");
            function walkArtifacts(dir) {
              return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walkArtifacts(entry.name) : [entry.name]);
            }
            function findIssueBody() {
              return walkArtifacts("visual-hive-artifacts").find((file) => file.endsWith("issue.md"));
            }
            function redactSecretValues(value) {
              return String(value)
                .replace(/client_secret=.*/gi, "client_secret=[REDACTED]")
                .replace(/authorization:.*/gi, "authorization: [REDACTED]")
                .replace(/set-cookie:.*/gi, "set-cookie: [REDACTED]")
                .replace(/Bearer .*/gi, "Bearer [REDACTED]");
            }
            const body = redactSecretValues(fs.readFileSync(findIssueBody(), "utf8"));
            const marker = "<!-- visual-hive-dedupe:stable-signature -->";
            await github.rest.issues.create({ body: marker + body });
`
      }
    ]);

    const trusted = audit.workflows[0];
    expect(trusted?.kind).toBe("trusted_issue");
    expect(trusted?.permissions).toMatchObject({ contents: "read", actions: "read", issues: "write" });
    expect(trusted?.downloadsArtifacts).toBe(true);
    expect(trusted?.readsIssueArtifact).toBe(true);
    expect(trusted?.usesRecursiveArtifactDiscovery).toBe(true);
    expect(trusted?.reSanitizesIssueBody).toBe(true);
    expect(trusted?.risk).toBe("low");
    expect(audit.findings).toHaveLength(0);
  });

  it("ships built-in GitHub workflow templates that audit as safe lanes", () => {
    const audit = auditWorkflows(
      sampleConfig(),
      githubWorkflowTemplates.map((template) => ({
        path: template.path,
        content: template.content
      })),
      { workflowRoot: ".github/workflows", now: new Date("2026-06-15T00:00:00.000Z") }
    );

    expect(githubWorkflowTemplates.map((template) => template.id)).toEqual(["pull_request", "scheduled", "trusted_failure_issue"]);
    const prTemplate = githubWorkflowTemplates.find((template) => template.id === "pull_request")?.content ?? "";
    const scheduledTemplate = githubWorkflowTemplates.find((template) => template.id === "scheduled")?.content ?? "";
    for (const command of ["baselines list --write", "coverage", "targets", "contracts", "flows", "schedules", "workflows", "providers list --mock-results", "triage", "llm", "report", "risk", "security", "costs", "readiness", "artifacts"]) {
      expect(prTemplate).toContain(`npx visual-hive ${command}`);
    }
    for (const command of ["baselines list --write", "mutate --enforce-min-score", "coverage", "targets", "contracts", "flows", "schedules", "workflows", "providers list --mock-results", "triage", "llm", "report", "risk", "security", "costs", "readiness", "artifacts"]) {
      expect(scheduledTemplate).toContain(`npx visual-hive ${command}`);
    }
    expect(prTemplate.indexOf("npx visual-hive readiness")).toBeLessThan(prTemplate.indexOf("npx visual-hive triage"));
    expect(prTemplate.indexOf("npx visual-hive triage")).toBeLessThan(prTemplate.indexOf("npx visual-hive report"));
    expect(scheduledTemplate.indexOf("npx visual-hive readiness")).toBeLessThan(scheduledTemplate.indexOf("npx visual-hive triage"));
    expect(scheduledTemplate.indexOf("npx visual-hive triage")).toBeLessThan(scheduledTemplate.indexOf("npx visual-hive report"));
    expect(audit.summary).toMatchObject({
      pullRequestWorkflows: 1,
      scheduledWorkflows: 1,
      trustedIssueWorkflows: 1,
      criticalFindings: 0,
      highFindings: 0,
      workflowsUsingPullRequestTarget: 0,
      prWorkflowsUsingSecrets: 0,
      prWorkflowsWithWritePermissions: 0,
      trustedIssueWorkflowsCheckingOutCode: 0,
      workflowsUsingUnpinnedActions: 3
    });
    const trusted = audit.workflows.find((workflow) => workflow.kind === "trusted_issue");
    expect(audit.workflows.find((workflow) => workflow.kind === "pull_request")?.writesBaselineReview).toBe(true);
    expect(audit.workflows.find((workflow) => workflow.kind === "scheduled")?.writesBaselineReview).toBe(true);
    expect(trusted?.usesRecursiveArtifactDiscovery).toBe(true);
    expect(trusted?.reSanitizesIssueBody).toBe(true);
    expect(trusted?.permissions).toMatchObject({ actions: "read", contents: "read", issues: "write" });
    expect(audit.findings.filter((finding) => finding.kind === "action_not_sha_pinned").length).toBeGreaterThan(0);
    expect(audit.recommendations.join(" ")).toContain("pin external GitHub Actions");
  });
});

describe("readiness gate", () => {
  it("marks complete clean evidence as ready", () => {
    const config = sampleConfig();
    const plan = createPlan(config, { mode: "pr", changedFiles: ["src/App.tsx"] });
    const report: Report = {
      schemaVersion: 2,
      project: "sample",
      repository: sampleRepository,
      mode: "pr",
      generatedAt: "2026-06-15T00:00:00.000Z",
      status: "passed",
      changedFiles: ["src/App.tsx"],
      selectedTargets: [{ id: "safe", kind: "url", url: "https://safe.example.com", prSafe: true, cost: "cheap" }],
      selectedContracts: ["safe-contract", "changed-contract"],
      excludedContracts: [],
      targetLifecycle: [],
      generatedSpecPath: ".visual-hive/generated/visual-hive.generated.spec.ts",
      results: [
        {
          contractId: "safe-contract",
          targetId: "safe",
          status: "passed",
          durationMs: 12,
          errors: [],
          artifacts: [".visual-hive/artifacts/results/safe-contract.json"],
          selectorAssertions: [{ kind: "mustExist", value: "main", status: "passed" }],
          screenshotAssertions: [
            {
              contractId: "safe-contract",
              screenshotName: "home",
              name: "home",
              route: "/",
              viewport: "desktop",
              status: "passed",
              baselinePath: ".visual-hive/snapshots/home.png",
              actualPath: ".visual-hive/artifacts/screenshots/home.png",
              maxDiffPixelRatio: 0.01,
              actualDiffPixelRatio: 0,
              actualDiffPixels: 0,
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
      reproductionCommands: ["visual-hive run --ci"]
    };
    const workflows = auditWorkflows(config, [
      {
        path: ".github/workflows/visual-hive-pr.yml",
        content: `on:
  pull_request:
permissions:
  contents: read
jobs:
  visual-hive:
    steps:
      - run: npx visual-hive plan --mode pr --ci
      - run: npx visual-hive run --ci
      - run: npx visual-hive baselines list --write
      - run: npx visual-hive report --github-step-summary
      - uses: actions/upload-artifact@v4
        with:
          path: .visual-hive
          include-hidden-files: true
`
      }
    ]);
    const baselines = {
      schemaVersion: 1 as const,
      project: "sample",
      generatedAt: "2026-06-15T00:01:00.000Z",
      reportGeneratedAt: report.generatedAt,
      reportPath: ".visual-hive/report.json",
      approvalLogPath: ".visual-hive/baseline-approvals.json",
      rejectionLogPath: ".visual-hive/baseline-rejections.json",
      summary: {
        total: 1,
        passed: 1,
        failed: 0,
        created: 0,
        missingBaseline: 0,
        approvable: 0,
        approved: 0,
        rejected: 0,
        pendingReview: 0
      },
      entries: []
    };
    const mutationReport = {
      schemaVersion: 2 as const,
      project: "sample",
      generatedAt: "2026-06-15T00:02:00.000Z",
      minScore: 0.7,
      score: 1,
      killed: 2,
      total: 2,
      results: []
    };
    const securityAudit = analyzeSecurity(config, { workflowAudit: workflows });
    const costAudit = analyzeCosts(config, { plan, report, mutationReport });

    const readiness = analyzeReadiness(config, {
      plan,
      report,
      baselines,
      mutationReport,
      workflowAudit: workflows,
      securityAudit,
      costAudit,
      providerDecisions: {
        schemaVersion: 1,
        generatedAt: "2026-06-15T00:00:00.000Z",
        decisions: [
          {
            providerId: "argos",
            label: "Argos",
            decision: "skip",
            reason: "No paid provider for this repo.",
            decidedAt: "2026-06-15T00:00:00.000Z",
            source: "cli",
            externalCallsMade: 0
          }
        ]
      },
      llmDecisions: {
        schemaVersion: 1,
        generatedAt: "2026-06-15T00:00:00.000Z",
        decisions: [
          {
            decision: "keep_disabled",
            reason: "Offline prompts only.",
            decidedAt: "2026-06-15T00:00:00.000Z",
            source: "cli",
            externalCallsMade: 0
          }
        ]
      },
      now: new Date("2026-06-15T00:03:00.000Z")
    });

    expect(readiness.schemaVersion).toBe(1);
    expect(readiness.status).toBe("attention");
    expect(readiness.gates.find((gate) => gate.id === "deterministic:status")?.status).toBe("passed");
    expect(readiness.gates.find((gate) => gate.id === "baselines:clean")?.status).toBe("passed");
    expect(readiness.gates.find((gate) => gate.id === "provider:decisions-recorded")?.status).toBe("passed");
    expect(readiness.gates.find((gate) => gate.id === "llm:decisions-recorded")?.status).toBe("passed");
    expect(readiness.gates.find((gate) => gate.id === "security:posture")?.status).toBe("warning");
    expect(JSON.stringify(readiness)).not.toContain("secret-value");
  });

  it("uses provider setup plans as readiness evidence for external providers", () => {
    const config = VisualHiveConfigSchema.parse({
      project: { name: "provider-readiness", type: "custom", defaultBranch: "main" },
      targets: { local: { kind: "url", url: "http://127.0.0.1:4173" } },
      contracts: [{ id: "dashboard", description: "Dashboard", target: "local", runOn: { pullRequest: true } }],
      providers: {
        argos: {
          enabled: true,
          mode: "external",
          requiredEnv: ["ARGOS_TOKEN"]
        }
      }
    });
    const plan = createPlan(config, { mode: "pr", changedFiles: ["src/App.tsx"] });
    const setupPlan = buildProviderSetupPlan(config, { providerId: "argos", env: {}, generatedAt: "2026-06-15T00:00:00.000Z" });
    const readiness = analyzeReadiness(config, {
      plan,
      costAudit: analyzeCosts(config, { plan }),
      providerSetupPlan: setupPlan,
      now: new Date("2026-06-15T00:00:00.000Z")
    });

    expect(readiness.inputs.providerSetupPlan).toBe(true);
    expect(readiness.gates.find((gate) => gate.id === "provider:external-enabled")).toMatchObject({
      category: "provider",
      status: "warning"
    });
    expect(readiness.gates.find((gate) => gate.id === "provider:external-enabled")?.evidence).toEqual(
      expect.arrayContaining(["setupPlan=argos", "recommendation=blocked", "externalCallsMade=0"])
    );
    expect(readiness.gates.find((gate) => gate.id === "provider:external-enabled")?.artifacts).toContain(".visual-hive/provider-setup-plan.json");
    expect(JSON.stringify(readiness)).not.toContain("secret-value");
  });

  it("builds artifact-backed setup progress and recommends the next blocked step", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-setup-progress-"));
    tempDirs.push(tempRoot);
    const config = sampleConfig();
    const plan = createPlan(config, { mode: "pr", changedFiles: ["src/App.tsx"] });
    const report = reportFixture(
      tempRoot,
      path.join(tempRoot, ".visual-hive", "artifacts", "screenshots", "actual.png"),
      path.join(tempRoot, ".visual-hive", "snapshots", "baseline.png")
    );
    report.status = "passed";
    report.generatedAt = "2026-06-15T00:00:00.000Z";
    report.summary.passed = 1;
    report.summary.failed = 0;
    report.summary.screenshotsFailed = 0;
    report.summary.visualDiffs = 0;
    report.results[0]!.status = "passed";
    report.results[0]!.errors = [];
    report.results[0]!.screenshotAssertions[0]!.status = "passed";
    const mutationReport = {
      schemaVersion: 2 as const,
      project: "sample",
      generatedAt: "2026-06-15T00:00:00.000Z",
      minScore: 0.7,
      score: 0.5,
      killed: 1,
      total: 2,
      results: [
        {
          operator: "remove-demo-badge",
          status: "survived" as const,
          killed: false,
          contractIds: ["safe-contract"],
          applicable: true,
          expectedFailureKinds: ["missing_element"],
          durationMs: 10,
          errors: ["No assertion failed."],
          artifacts: [".visual-hive/mutation-report.json"]
        }
      ]
    };
    const progress = buildSetupProgress({
      config,
      plan,
      report,
      mutationReport,
      workflowAudit: auditWorkflows(config, []),
      readinessReport: analyzeReadiness(config, { plan, report, mutationReport }),
      now: new Date("2026-06-15T00:00:00.000Z")
    });

    expect(progress.schemaVersion).toBe(1);
    expect(progress.status).toBe("attention");
    expect(progress.phase).toBe("measure mutation adequacy");
    expect(progress.nextStep).toMatchObject({
      id: "mutation",
      status: "blocked",
      command: "visual-hive mutate"
    });
    expect(progress.steps.find((step) => step.id === "run")?.status).toBe("complete");
    expect(progress.steps.find((step) => step.id === "provider-governance")?.status).toBe("complete");
    expect(JSON.stringify(progress)).not.toContain("secret-value");
  });

  it("marks setup artifacts for review when they are older than newer deterministic evidence", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-setup-progress-stale-"));
    tempDirs.push(tempRoot);
    const config = sampleConfig();
    const plan = createPlan(config, { mode: "pr", changedFiles: ["src/App.tsx"], now: new Date("2026-06-15T01:00:00.000Z") });
    const report = reportFixture(
      tempRoot,
      path.join(tempRoot, ".visual-hive", "artifacts", "screenshots", "actual.png"),
      path.join(tempRoot, ".visual-hive", "snapshots", "baseline.png")
    );
    report.generatedAt = "2026-06-15T01:00:00.000Z";
    report.status = "passed";
    report.summary.passed = 1;
    report.summary.failed = 0;
    report.summary.screenshotsFailed = 0;
    report.summary.visualDiffs = 0;
    report.results[0]!.status = "passed";
    report.results[0]!.errors = [];
    report.results[0]!.screenshotAssertions[0]!.status = "passed";
    const mutationReport = {
      schemaVersion: 2 as const,
      project: "sample",
      generatedAt: "2026-06-15T02:00:00.000Z",
      minScore: 0.7,
      score: 1,
      killed: 1,
      total: 1,
      results: [
        {
          operator: "remove-demo-badge",
          status: "killed" as const,
          killed: true,
          contractIds: ["safe-contract"],
          applicable: true,
          expectedFailureKinds: ["missing_element"],
          durationMs: 10,
          errors: [],
          artifacts: [".visual-hive/mutation-report.json"]
        }
      ]
    };
    const triageReport = buildTriageReport({
      project: "sample",
      findings: [],
      now: new Date("2026-06-15T00:00:00.000Z")
    });
    const readinessReport = analyzeReadiness(config, {
      plan,
      report,
      mutationReport,
      workflowAudit: auditWorkflows(config, [], { now: new Date("2026-06-15T02:00:00.000Z") }),
      now: new Date("2026-06-15T00:30:00.000Z")
    });
    const progress = buildSetupProgress({
      config,
      plan,
      report,
      mutationReport,
      triageReport,
      workflowAudit: auditWorkflows(config, [], { now: new Date("2026-06-15T02:00:00.000Z") }),
      readinessReport,
      now: new Date("2026-06-15T03:00:00.000Z")
    });

    const mutationStep = progress.steps.find((step) => step.id === "mutation");
    const triageStep = progress.steps.find((step) => step.id === "triage");
    const readinessStep = progress.steps.find((step) => step.id === "readiness");

    expect(mutationStep).toMatchObject({ status: "complete" });
    expect(mutationStep?.evidence).toContain("mutation-report.json=current");
    expect(triageStep).toMatchObject({ status: "review" });
    expect(triageStep?.evidence).toEqual(expect.arrayContaining(["triage.json=stale", "newer=report.json,mutation-report.json"]));
    expect(readinessStep).toMatchObject({ status: "review" });
    expect(readinessStep?.evidence).toContain("readiness.json=stale");
    expect(progress.nextStep).toMatchObject({ id: "triage", status: "review" });
  });

  it("blocks readiness on deterministic failures and missing CI baselines", () => {
    const config = sampleConfig();
    const plan = createPlan(config, { mode: "pr", changedFiles: ["src/App.tsx"] });
    const report: Report = {
      schemaVersion: 2,
      project: "sample",
      repository: sampleRepository,
      mode: "pr",
      generatedAt: "2026-06-15T00:00:00.000Z",
      status: "failed",
      changedFiles: ["src/App.tsx"],
      selectedTargets: [{ id: "safe", kind: "url", url: "https://safe.example.com", prSafe: true, cost: "cheap" }],
      selectedContracts: ["safe-contract"],
      excludedContracts: [],
      targetLifecycle: [],
      generatedSpecPath: ".visual-hive/generated/visual-hive.generated.spec.ts",
      results: [],
      summary: {
        passed: 0,
        failed: 1,
        screenshotsPassed: 0,
        screenshotsFailed: 1,
        baselinesCreated: 0,
        createdBaselines: 0,
        missingBaselines: 1,
        visualDiffs: 0,
        consoleErrors: 0,
        pageErrors: 0
      },
      consoleErrors: [],
      pageErrors: [],
      artifacts: [],
      reproductionCommands: ["visual-hive run --ci"]
    };

    const readiness = analyzeReadiness(config, { plan, report });

    expect(readiness.status).toBe("blocked");
    expect(readiness.gates.find((gate) => gate.id === "deterministic:status")?.status).toBe("blocked");
    expect(readiness.gates.find((gate) => gate.id === "baselines:missing-baseline")?.status).toBe("blocked");
    expect(readiness.nextActions.join(" ")).toContain("baselines");
  });

  it("calls out missing plan and report evidence", () => {
    const readiness = analyzeReadiness(sampleConfig(), { now: new Date("2026-06-15T00:00:00.000Z") });

    expect(readiness.status).toBe("attention");
    expect(readiness.summary.missing).toBeGreaterThanOrEqual(3);
    expect(readiness.gates.map((gate) => gate.id)).toEqual(expect.arrayContaining(["planning:missing", "deterministic:missing", "workflow:missing"]));
  });

  it("blocks readiness when run history shows a pass-to-fail regression", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-readiness-history-"));
    tempDirs.push(tempRoot);
    const previousReport = reportFixture(tempRoot, path.join(tempRoot, ".visual-hive", "artifacts", "previous.png"), path.join(tempRoot, ".visual-hive", "snapshots", "baseline.png"));
    previousReport.status = "passed";
    previousReport.summary.failed = 0;
    previousReport.summary.visualDiffs = 0;
    previousReport.results[0]!.status = "passed";
    previousReport.results[0]!.errors = [];
    const latestReport = reportFixture(tempRoot, path.join(tempRoot, ".visual-hive", "artifacts", "latest.png"), path.join(tempRoot, ".visual-hive", "snapshots", "baseline.png"));
    const runHistory = createRunHistoryReport({
      project: "sample",
      generatedAt: "2026-06-15T01:01:00.000Z",
      entries: [
        createRunHistoryEntry({
          repoRoot: tempRoot,
          id: "previous",
          recordedAt: "2026-06-15T00:00:00.000Z",
          files: { report: ".visual-hive/history/previous/report.json" },
          report: previousReport
        }),
        createRunHistoryEntry({
          repoRoot: tempRoot,
          id: "latest",
          recordedAt: "2026-06-15T01:00:00.000Z",
          files: { report: ".visual-hive/history/latest/report.json" },
          report: latestReport
        })
      ]
    });

    const readiness = analyzeReadiness(sampleConfig(), { runHistory, now: new Date("2026-06-15T01:02:00.000Z") });

    expect(readiness.inputs.runHistory).toBe(true);
    expect(readiness.status).toBe("blocked");
    expect(readiness.gates.find((gate) => gate.id === "history:regressed")).toMatchObject({
      category: "history",
      status: "blocked"
    });
    expect(readiness.nextActions.join(" ")).toContain("archived reports");
  });
});

describe("security audit", () => {
  it("combines workflow, protected target, provider, LLM, and npm audit posture", () => {
    const config = VisualHiveConfigSchema.parse({
      ...sampleConfig(),
      targets: {
        ...sampleConfig().targets,
        protectedLane: {
          kind: "protected",
          url: "https://cluster.example.com",
          prSafe: true
        }
      },
      providers: {
        argos: {
          enabled: true,
          mode: "external",
          requiredEnv: ["ARGOS_TOKEN"]
        }
      },
      costPolicy: {
        maxExternalScreenshotsPerRun: 10,
        maxMonthlyExternalScreenshots: 5000,
        externalUpload: {
          pullRequest: true
        }
      },
      ai: {
        enabled: true,
        provider: "openai",
        model: "gpt-4.1",
        neverSoleOracle: true,
        maxEstimatedCostUsd: 5
      }
    });
    const workflowAudit = auditWorkflows(config, [
      {
        path: ".github/workflows/unsafe-pr.yml",
        content: `
on: pull_request_target
permissions:
  contents: write
jobs:
  test:
    steps:
      - uses: actions/checkout@v4
      - run: visual-hive run
        env:
          TOKEN: \${{ secrets.SECRET_TOKEN }}
`
      }
    ]);
    const npmAudit = npmAuditSummaryFromJson({
      metadata: {
        vulnerabilities: {
          critical: 1,
          high: 2,
          moderate: 3,
          low: 4,
          info: 0,
          total: 10
        }
      }
    });

    const security = analyzeSecurity(config, { workflowAudit, npmAudit, now: new Date("2026-06-15T00:00:00.000Z") });

    expect(security.schemaVersion).toBe(1);
    expect(security.summary.critical).toBeGreaterThan(0);
    expect(security.summary.npmAuditTotal).toBe(10);
    expect(security.findings.map((finding) => finding.category)).toEqual(
      expect.arrayContaining(["workflow", "protected_target", "provider", "llm", "dependency"])
    );
    expect(security.findings.find((finding) => finding.id.includes("protectedLane"))?.title).toContain("Protected target");
    expect(JSON.stringify(security)).not.toContain("SECRET_TOKEN");
    expect(security.recommendations).toEqual(expect.arrayContaining(["Fix critical/high workflow safety findings before making Visual Hive checks required."]));
  });

  it("treats tag-pinned actions as production hardening instead of PR-blocking workflow risk", () => {
    const workflowAudit = auditWorkflows(sampleConfig(), [
      {
        path: ".github/workflows/visual-hive-pr.yml",
        content: `
on: pull_request
permissions:
  contents: read
jobs:
  visual-hive:
    steps:
      - uses: actions/checkout@v4
      - uses: actions/upload-artifact@v4
        with:
          include-hidden-files: true
      - run: visual-hive baselines list --write
`
      }
    ]);

    const security = analyzeSecurity(sampleConfig(), { workflowAudit, now: new Date("2026-06-15T00:00:00.000Z") });

    expect(security.summary.prBlocking).toBe(0);
    expect(security.findings.map((finding) => finding.id)).toContain("workflow:action_not_sha_pinned:.github/workflows/visual-hive-pr.yml");
    expect(security.recommendations).toContain(
      "For production hardening, pin external GitHub Actions by full commit SHA after reviewing upstream source."
    );
    expect(security.recommendations.join(" ")).not.toContain("Fix critical/high workflow safety findings");
  });

  it("keeps npm audit optional and parses object-form vulnerability output", () => {
    const audit = npmAuditSummaryFromJson({
      vulnerabilities: {
        packageA: { severity: "high" },
        packageB: { severity: "moderate" },
        packageC: { severity: "low" }
      }
    });
    const security = analyzeSecurity(sampleConfig(), { npmAudit: audit });

    expect(audit).toMatchObject({ total: 3, high: 1, moderate: 1, low: 1 });
    expect(security.findings.map((finding) => finding.id)).toEqual(expect.arrayContaining(["dependency:npm-audit-high"]));
    expect(security.findings.some((finding) => finding.id === "dependency:npm-audit-not-run")).toBe(false);
  });
});

describe("cost audit", () => {
  it("explains local/external cost posture without planning external calls", () => {
    const config = VisualHiveConfigSchema.parse({
      ...sampleConfig(),
      providers: {
        argos: {
          enabled: true,
          mode: "external",
          requiredEnv: ["ARGOS_TOKEN"]
        }
      },
      costPolicy: {
        maxExternalScreenshotsPerRun: 0,
        maxMonthlyExternalScreenshots: 20,
        externalUpload: {
          pullRequest: true,
          schedule: true,
          manual: true,
          canary: false,
          mutation: false,
          full: true,
          onFailureOnly: false,
          criticalContractsOnly: false
        }
      }
    });
    const cost = analyzeCosts(config, {
      plan: createPlan(config, { mode: "pr", changedFiles: ["src/App.tsx"], now: new Date("2026-06-15T00:00:00.000Z") }),
      env: {}
    });

    expect(cost.schemaVersion).toBe(1);
    expect(cost.summary.externalCallsPlanned).toBe(0);
    expect(cost.summary.localScreenshots).toBeGreaterThan(0);
    expect(cost.summary.maxExternalScreenshotsPerRun).toBe(0);
    expect(cost.providers.find((provider) => provider.providerId === "argos")).toMatchObject({
      enabled: true,
      availability: "missing_credentials",
      externalCallsPlanned: 0,
      missingEnv: ["ARGOS_TOKEN"]
    });
    expect(cost.risks.map((risk) => risk.id)).toEqual(expect.arrayContaining(["external-upload-pr", "screenshot-budget-exceeded"]));
    expect(JSON.stringify(cost)).not.toContain("abc123");
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
    expect(list.summary).toMatchObject({
      total: 1,
      failed: 1,
      approvable: 1,
      pendingReview: 1
    });
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

    const written = await writeBaselineReview({ repoRoot: tempRoot, reportPath, now: new Date("2026-06-16T00:00:00.000Z") });
    expect(written.baselineReportPath).toBe(path.join(hiveRoot, "baselines.json"));
    expect(written.list.summary.approved).toBe(1);
    expect(written.list.summary.pendingReview).toBe(0);
    await expect(readFile(written.baselineReportPath, "utf8")).resolves.toContain('"approved": 1');
  });

  it("rejects a screenshot baseline without modifying the baseline image", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-baseline-reject-"));
    tempDirs.push(tempRoot);
    const hiveRoot = path.join(tempRoot, ".visual-hive");
    const actualPath = path.join(hiveRoot, "artifacts", "screenshots", "dashboard.png");
    const baselinePath = path.join(hiveRoot, "snapshots", "dashboard.png");
    const reportPath = path.join(hiveRoot, "report.json");
    await mkdir(path.dirname(actualPath), { recursive: true });
    await mkdir(path.dirname(baselinePath), { recursive: true });
    await writeFile(actualPath, "changed-image", "utf8");
    await writeFile(baselinePath, "approved-image", "utf8");
    await writeFile(reportPath, JSON.stringify(reportFixture(tempRoot, actualPath, baselinePath), null, 2), "utf8");

    const rejection = await rejectBaseline({
      repoRoot: tempRoot,
      reportPath,
      contractId: "dashboard",
      screenshotName: "desktop",
      reason: "Not an intentional visual change"
    });

    expect(rejection.reason).toBe("Not an intentional visual change");
    await expect(readFile(baselinePath, "utf8")).resolves.toBe("approved-image");
    const rejectionLog = JSON.parse(await readFile(path.join(hiveRoot, "baseline-rejections.json"), "utf8")) as { rejections: unknown[] };
    expect(rejectionLog.rejections).toHaveLength(1);
    const list = await listBaselines({ repoRoot: tempRoot, reportPath });
    expect(list.entries[0]?.rejectedAt).toBeTruthy();
    expect(list.entries[0]?.rejectionReason).toBe("Not an intentional visual change");
    expect(list.summary.rejected).toBe(1);
    expect(list.summary.pendingReview).toBe(0);
    expect(list.rejectionLogPath).toContain("baseline-rejections.json");
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
    await writeFile(path.join(hiveRoot, "baseline-review.md"), "client_secret=baseline-review-secret", "utf8");
    await writeFile(path.join(hiveRoot, "flows.json"), '{"schemaVersion":1,"flows":[]}', "utf8");
    await writeJson(path.join(hiveRoot, "triage.json"), buildTriageReport({
      project: "baseline-fixture",
      findings: [
        {
          classification: "visual_diff",
          severity: "medium",
          title: "Diff includes token=abc123",
          evidence: ["Authorization: Bearer history-secret"],
          suggestedFiles: ["src/App.tsx"],
          suggestedNextTests: ["Add a focused screenshot contract."]
        }
      ],
      now: new Date("2026-06-15T00:01:30.000Z")
    }));

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
    expect(history.trend).toMatchObject({
      hasPrevious: false,
      direction: "unknown"
    });
    expect(history.entries[0]?.files.report).toBe(".visual-hive/history/run-one/report.json");
    expect(history.entries[0]?.files.issue).toBe(".visual-hive/history/run-one/issue.md");
    expect(history.entries[0]?.files.prComment).toBe(".visual-hive/history/run-one/pr-comment.md");
    expect(history.entries[0]?.files.baselineReview).toBe(".visual-hive/history/run-one/baseline-review.md");
    expect(history.entries[0]?.files.triageReport).toBe(".visual-hive/history/run-one/triage.json");
    expect(history.entries[0]?.files.flows).toBe(".visual-hive/history/run-one/flows.json");
    await expect(readFile(path.join(hiveRoot, "history", "run-one", "issue.md"), "utf8")).resolves.toContain("[REDACTED]");
    await expect(readFile(path.join(hiveRoot, "history", "run-one", "pr-comment.md"), "utf8")).resolves.toContain("[REDACTED]");
    await expect(readFile(path.join(hiveRoot, "history", "run-one", "baseline-review.md"), "utf8")).resolves.toContain("[REDACTED]");
    const index = JSON.parse(await readFile(path.join(hiveRoot, "history.json"), "utf8")) as { entries: unknown[] };
    expect(index.entries).toHaveLength(1);
  });

  it("calculates latest-vs-previous run trend evidence", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-history-trend-"));
    tempDirs.push(tempRoot);
    const previousReport = reportFixture(tempRoot, path.join(tempRoot, ".visual-hive", "artifacts", "previous.png"), path.join(tempRoot, ".visual-hive", "snapshots", "baseline.png"));
    const latestReport = reportFixture(tempRoot, path.join(tempRoot, ".visual-hive", "artifacts", "latest.png"), path.join(tempRoot, ".visual-hive", "snapshots", "baseline.png"));
    latestReport.status = "passed";
    latestReport.summary.failed = 0;
    latestReport.summary.visualDiffs = 0;
    latestReport.summary.screenshotsFailed = 0;
    latestReport.results[0]!.status = "passed";
    latestReport.results[0]!.errors = [];

    const previousEntry = createRunHistoryEntry({
      repoRoot: tempRoot,
      id: "previous",
      recordedAt: "2026-06-15T00:00:00.000Z",
      files: { report: ".visual-hive/history/previous/report.json" },
      report: previousReport,
      mutationReport: {
        schemaVersion: 2,
        project: "baseline-fixture",
        generatedAt: "2026-06-15T00:00:00.000Z",
        minScore: 0.7,
        score: 0.4,
        killed: 2,
        total: 5,
        results: []
      }
    });
    const latestEntry = createRunHistoryEntry({
      repoRoot: tempRoot,
      id: "latest",
      recordedAt: "2026-06-15T01:00:00.000Z",
      files: { report: ".visual-hive/history/latest/report.json" },
      report: latestReport,
      mutationReport: {
        schemaVersion: 2,
        project: "baseline-fixture",
        generatedAt: "2026-06-15T01:00:00.000Z",
        minScore: 0.7,
        score: 0.8,
        killed: 4,
        total: 5,
        results: []
      }
    });

    const history = createRunHistoryReport({
      project: "baseline-fixture",
      generatedAt: "2026-06-15T01:01:00.000Z",
      entries: [previousEntry, latestEntry]
    });

    expect(history.entries.map((entry) => entry.id)).toEqual(["latest", "previous"]);
    expect(history.trend).toMatchObject({
      hasPrevious: true,
      direction: "improved",
      statusChanged: { from: "failed", to: "passed" },
      mutationScoreDelta: 0.4,
      failedContractsDelta: -1,
      visualDiffsDelta: -1
    });
    expect(history.trend.reasons.join(" ")).toContain("Deterministic status recovered");
    expect(history.trend.reasons.join(" ")).toContain("Mutation score improved");
  });
});

describe("LLM usage governance", () => {
  it("defines the default prompt artifacts used by CLI and Control Plane governance", () => {
    expect(KNOWN_LLM_PROMPT_ARTIFACTS.map((artifact) => artifact.path)).toEqual([
      ".visual-hive/triage-prompt.md",
      ".visual-hive/repair-prompt.md",
      ".visual-hive/missing-tests.md",
      ".visual-hive/baseline-review.md",
      ".visual-hive/issue.md"
    ]);
    expect(KNOWN_LLM_PROMPT_ARTIFACTS.map((artifact) => artifact.task)).toEqual([
      "visual_failure_triage",
      "repair_prompt",
      "missing_tests",
      "baseline_review_summary",
      "issue_draft"
    ]);
  });

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

  it("records LLM governance decisions in core without leaking secrets or making model calls", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-llm-decision-"));
    tempDirs.push(tempRoot);
    const decisionPath = path.join(tempRoot, ".visual-hive", "llm-decisions.json");

    const result = await recordLLMDecision(decisionPath, {
      decision: "approve_trusted_prompt_only",
      reason: "Review prompts later with OPENAI_API_KEY=abc123, but never use LLM output as pass/fail.",
      source: "control-plane",
      now: new Date("2026-06-16T00:00:00.000Z")
    });
    const log = await readLLMDecisionLog(decisionPath);

    expect(result.decisionPath).toBe(".visual-hive/llm-decisions.json");
    expect(result.decision).toMatchObject({
      decision: "approve_trusted_prompt_only",
      source: "control-plane",
      externalCallsMade: 0
    });
    expect(result.decision.reason).toContain("[REDACTED]");
    expect(JSON.stringify(log)).not.toContain("abc123");
    expect(log?.decisions[0].externalCallsMade).toBe(0);
  });
});

describe("artifact index", () => {
  it("classifies artifacts and creates sanitized previews", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-artifacts-"));
    tempDirs.push(tempRoot);
    const hiveRoot = path.join(tempRoot, ".visual-hive");
    await mkdir(path.join(hiveRoot, "artifacts", "screenshots"), { recursive: true });
    await writeFile(path.join(hiveRoot, "report.json"), '{"token":"abc123","status":"failed"}', "utf8");
    await writeFile(path.join(hiveRoot, "triage.json"), '{"schemaVersion":1,"findings":[{"title":"token=abc123"}]}', "utf8");
    await writeFile(path.join(hiveRoot, "baselines.json"), '{"summary":{"pendingReview":1},"entries":[{"actualPath":"token=abc123"}]}', "utf8");
    await writeFile(path.join(hiveRoot, "triage-prompt.md"), "Authorization: Bearer secret-token", "utf8");
    await writeFile(path.join(hiveRoot, "baseline-review.md"), "client_secret=baseline-review-secret", "utf8");
    await writeFile(path.join(hiveRoot, "pr-comment.md"), "Cookie: session=secret-token", "utf8");
    await writeFile(path.join(hiveRoot, "control-plane-actions.json"), '{"actions":[{"stdout":"token=abc123"}]}', "utf8");
    await writeFile(path.join(hiveRoot, "coverage-recommendations.json"), '{"recommendations":[{"rationale":"token=abc123"}]}', "utf8");
    await writeFile(path.join(hiveRoot, "flows.json"), '{"schemaVersion":1,"flows":[{"latestFailedMessages":["token=abc123"]}]}', "utf8");
    await writeFile(path.join(hiveRoot, "security.json"), '{"findings":[{"evidence":["authorization: bearer abc123"]}]}', "utf8");
    await writeFile(path.join(hiveRoot, "costs.json"), '{"providers":[{"blockedReasons":["client_secret=abc123"]}]}', "utf8");
    await writeFile(path.join(hiveRoot, "readiness.json"), '{"gates":[{"evidence":["token=abc123"]}]}', "utf8");
    await writeFile(path.join(hiveRoot, "provider-decisions.json"), '{"decisions":[{"providerId":"argos","reason":"token=abc123"}]}', "utf8");
    await writeFile(path.join(hiveRoot, "provider-setup-plan.json"), '{"providerId":"argos","warnings":["token=abc123"]}', "utf8");
    await writeFile(path.join(hiveRoot, "llm-decisions.json"), '{"decisions":[{"decision":"keep_disabled","reason":"token=abc123"}]}', "utf8");
    await writeFile(path.join(hiveRoot, "runbook.json"), '{"runbook":{"commands":[{"id":"doctor","command":"visual-hive doctor token=abc123"}]}}', "utf8");
    await writeFile(
      path.join(hiveRoot, "connections-portfolio.json"),
      '{"schemaVersion":1,"portfolio":{"queues":[{"id":"security_risks","connections":[]}]},"connections":[{"id":"repo","attention":["token=abc123"]}]}',
      "utf8"
    );
    await writeFile(path.join(hiveRoot, "artifacts-index.json"), '{"schemaVersion":1,"artifactCount":999}', "utf8");
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

    expect(index.summary.artifactCount).toBe(19);
    expect(index.artifacts.some((artifact) => artifact.path.endsWith("artifacts-index.json"))).toBe(false);
    expect(index.summary.image).toBe(1);
    expect(index.summary.redactedPreviews).toBeGreaterThanOrEqual(1);
    const prompt = index.artifacts.find((artifact) => artifact.path.endsWith("triage-prompt.md"));
    expect(prompt?.preview).toContain("[REDACTED]");
    expect(prompt?.labels).toContain("prompt");
    const triageReport = index.artifacts.find((artifact) => artifact.path.endsWith("triage.json"));
    expect(triageReport?.preview).toContain("[REDACTED]");
    expect(triageReport?.labels).toContain("triage-report");
    expect(triageReport?.schemaPath).toBe("schemas/visual-hive.triage.schema.json");
    expect(triageReport?.schemaId).toBe("https://visual-hive.dev/schemas/visual-hive.triage.schema.json");
    const baselineReview = index.artifacts.find((artifact) => artifact.path.endsWith("baseline-review.md"));
    expect(baselineReview?.preview).toContain("[REDACTED]");
    expect(baselineReview?.labels).toContain("baseline-review");
    expect(baselineReview?.labels).toContain("prompt");
    const baselines = index.artifacts.find((artifact) => artifact.path.endsWith("baselines.json"));
    expect(baselines?.preview).toContain("[REDACTED]");
    expect(baselines?.labels).toContain("baseline-review");
    expect(baselines?.schemaPath).toBe("schemas/visual-hive.baselines.schema.json");
    const comment = index.artifacts.find((artifact) => artifact.path.endsWith("pr-comment.md"));
    expect(comment?.preview).toContain("[REDACTED]");
    expect(comment?.labels).toContain("pr-comment");
    const actions = index.artifacts.find((artifact) => artifact.path.endsWith("control-plane-actions.json"));
    expect(actions?.preview).toContain("[REDACTED]");
    expect(actions?.labels).toContain("control-plane-actions");
    const coverageRecommendations = index.artifacts.find((artifact) => artifact.path.endsWith("coverage-recommendations.json"));
    expect(coverageRecommendations?.preview).toContain("[REDACTED]");
    expect(coverageRecommendations?.labels).toContain("coverage-recommendations");
    expect(coverageRecommendations?.labels).not.toContain("setup-recommendations");
    expect(coverageRecommendations?.schemaPath).toBe("schemas/visual-hive.coverage-recommendations.schema.json");
    const flowAudit = index.artifacts.find((artifact) => artifact.path.endsWith("flows.json"));
    expect(flowAudit?.preview).toContain("[REDACTED]");
    expect(flowAudit?.labels).toContain("flow-audit");
    expect(flowAudit?.schemaPath).toBe("schemas/visual-hive.flows.schema.json");
    const securityAudit = index.artifacts.find((artifact) => artifact.path.endsWith("security.json"));
    expect(securityAudit?.preview).toContain("[REDACTED]");
    expect(securityAudit?.labels).toContain("security-audit");
    const costAudit = index.artifacts.find((artifact) => artifact.path.endsWith("costs.json"));
    expect(costAudit?.preview).toContain("[REDACTED]");
    expect(costAudit?.labels).toContain("cost-audit");
    const readinessGate = index.artifacts.find((artifact) => artifact.path.endsWith("readiness.json"));
    expect(readinessGate?.preview).toContain("[REDACTED]");
    expect(readinessGate?.labels).toContain("readiness-gate");
    expect(readinessGate?.schemaPath).toBe("schemas/visual-hive.readiness.schema.json");
    const providerDecisions = index.artifacts.find((artifact) => artifact.path.endsWith("provider-decisions.json"));
    expect(providerDecisions?.preview).toContain("[REDACTED]");
    expect(providerDecisions?.labels).toContain("provider-decisions");
    expect(providerDecisions?.schemaPath).toBe("schemas/visual-hive.provider-decisions.schema.json");
    const providerSetupPlan = index.artifacts.find((artifact) => artifact.path.endsWith("provider-setup-plan.json"));
    expect(providerSetupPlan?.preview).toContain("[REDACTED]");
    expect(providerSetupPlan?.labels).toContain("provider-setup-plan");
    expect(providerSetupPlan?.schemaPath).toBe("schemas/visual-hive.provider-setup-plan.schema.json");
    const llmDecisions = index.artifacts.find((artifact) => artifact.path.endsWith("llm-decisions.json"));
    expect(llmDecisions?.preview).toContain("[REDACTED]");
    expect(llmDecisions?.labels).toContain("llm-decisions");
    expect(llmDecisions?.schemaPath).toBe("schemas/visual-hive.llm-decisions.schema.json");
    const runbook = index.artifacts.find((artifact) => artifact.path.endsWith("runbook.json"));
    expect(runbook?.preview).toContain("[REDACTED]");
    expect(runbook?.labels).toContain("runbook");
    expect(runbook?.schemaPath).toBe("schemas/visual-hive.runbook.schema.json");
    const connectionsPortfolio = index.artifacts.find((artifact) => artifact.path.endsWith("connections-portfolio.json"));
    expect(connectionsPortfolio?.preview).toContain("[REDACTED]");
    expect(connectionsPortfolio?.labels).toContain("connections-portfolio");
    expect(connectionsPortfolio?.schemaPath).toBe("schemas/visual-hive.connections-portfolio.schema.json");
    const spec = index.artifacts.find((artifact) => artifact.kind === "typescript");
    expect(spec?.labels).toContain("generated-spec");
  });

  it("refuses to index artifact roots outside the repo", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-artifacts-escape-"));
    tempDirs.push(tempRoot);
    await expect(indexArtifacts({ repoRoot: tempRoot, hiveRoot: path.dirname(tempRoot) })).rejects.toThrow(/outside repository root/);
  });

  it("prioritizes current artifacts over history when the artifact cap is reached", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-artifacts-priority-"));
    tempDirs.push(tempRoot);
    const hiveRoot = path.join(tempRoot, ".visual-hive");
    await mkdir(path.join(hiveRoot, "history", "old"), { recursive: true });
    await writeFile(path.join(hiveRoot, "report.json"), '{"schemaVersion":2,"status":"passed"}', "utf8");
    await writeFile(path.join(hiveRoot, "generated", "visual-hive.generated.spec.ts"), "test('current', async () => {});", "utf8").catch(async () => {
      await mkdir(path.join(hiveRoot, "generated"), { recursive: true });
      await writeFile(path.join(hiveRoot, "generated", "visual-hive.generated.spec.ts"), "test('current', async () => {});", "utf8");
    });
    for (let index = 0; index < 8; index += 1) {
      await writeFile(path.join(hiveRoot, "history", "old", `${index}.json`), `{"index":${index}}`, "utf8");
    }

    const artifactIndex = await indexArtifacts({ repoRoot: tempRoot, maxArtifacts: 3 });
    const paths = artifactIndex.artifacts.map((artifact) => artifact.path);

    expect(paths).toContain(".visual-hive/report.json");
    expect(paths).toContain(".visual-hive/generated/visual-hive.generated.spec.ts");
    expect(artifactIndex.warnings.join(" ")).toContain("maxArtifacts=3");
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
    await mkdir(path.join(targetRoot, "src"), { recursive: true });
    await mkdir(path.join(targetRoot, ".github", "workflows"), { recursive: true });
    await writeFile(
      path.join(targetRoot, "src", "App.tsx"),
      `<main data-testid="dashboard-page"><a href="/clusters">Clusters</a><a href="/settings">Settings</a><Route path="/workloads" /></main>`,
      "utf8"
    );
    await writeFile(path.join(targetRoot, "playwright.config.ts"), `export default {};`, "utf8");
    await writeFile(
      path.join(targetRoot, ".github", "workflows", "ci.yml"),
      `name: CI
on:
  pull_request:
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: npm test
`,
      "utf8"
    );
    await writeFile(
      path.join(targetRoot, ".github", "workflows", "legacy.yml"),
      `name: Legacy privileged
on:
  pull_request_target:
permissions:
  contents: write
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: echo \${{ secrets.LEGACY_TOKEN }}
`,
      "utf8"
    );

    const recommendation = await recommendSetup({ repoRoot: targetRoot, now: new Date("2026-06-15T00:00:00.000Z") });
    const parsedYaml = VisualHiveConfigSchema.parse(parseYaml(recommendation.recommendedConfigYaml));

    expect(recommendation.project.type).toBe("react-vite");
    expect(recommendation.setupProfile).toBe("free-local");
    expect(recommendation.recommendedTarget.kind).toBe("command");
    expect(recommendation.recommendedTarget.serve).toBe("npm run preview -- --port 4173");
    expect(recommendation.recommendedContracts[0]?.selectors).toContain("[data-testid='dashboard-page']");
    expect(recommendation.recommendedContracts[0]?.steps[0]).toMatchObject({ action: "assertVisible", selector: "[data-testid='dashboard-page']" });
    expect(recommendation.recommendedContracts.map((contract) => contract.id)).toEqual([
      "app-shell-visual-stability",
      "route-clusters-visual-stability",
      "route-settings-visual-stability",
      "route-workloads-visual-stability"
    ]);
    expect(recommendation.recommendedContracts.find((contract) => contract.id === "route-clusters-visual-stability")).toMatchObject({
      targetId: "localPreview",
      screenshots: [{ name: "clusters-desktop", route: "/clusters", viewport: "desktop" }],
      steps: [
        { action: "goto", route: "/clusters" },
        { action: "assertVisible", selector: "[data-testid='dashboard-page']" }
      ]
    });
    expect(recommendation.costEstimate).toMatchObject({
      localScreenshotsPerRun: 5,
      externalScreenshotsPerRun: 0,
      estimatedMonthlyExternalScreenshots: 0
    });
    expect(recommendation.permissions.pullRequest.secretsRequired).toEqual([]);
    expect(recommendation.providerRecommendations.find((provider) => provider.providerId === "playwright")).toMatchObject({
      recommendation: "use",
      externalUploadAllowedByDefault: false
    });
    expect(recommendation.providerRecommendations.find((provider) => provider.providerId === "argos")).toMatchObject({
      recommendation: "future",
      requiredEnv: ["ARGOS_TOKEN"]
    });
    expect(recommendation.playwright).toMatchObject({
      status: "present",
      dependencies: ["@playwright/test"],
      scripts: ["test:e2e: playwright test"],
      configFiles: ["playwright.config.ts"]
    });
    expect(recommendation.detectedRoutes.map((route) => route.route)).toEqual(["/clusters", "/settings", "/workloads"]);
    expect(recommendation.onboardingChecklist.find((item) => item.id === "inspect-repository")?.evidence).toContain("playwright=present");
    expect(recommendation.onboardingChecklist.find((item) => item.id === "inspect-repository")?.evidence).toContain("routes=3");
    expect(recommendation.setupPullRequest.securityNotes.join(" ")).toContain("pull_request");
    expect(recommendation.setupActions.map((action) => action.id)).toContain("use-free-local-setup");
    expect(recommendation.setupActions.find((action) => action.id === "skip-provider-for-now")).toMatchObject({
      category: "provider",
      requiresConfirmation: false,
      writes: [".visual-hive/provider-decisions.json"]
    });
    expect(recommendation.setupActions.find((action) => action.id === "preview-setup-pr")?.safetyNotes.join(" ")).toContain("pull_request");
    expect(recommendation.detectedWorkflows).toEqual([
      {
        path: ".github/workflows/ci.yml",
        triggers: ["pull_request"],
        permissions: ["contents: read"],
        usesPullRequestTarget: false,
        usesSecrets: false,
        visualHiveRelated: false
      },
      {
        path: ".github/workflows/legacy.yml",
        triggers: ["pull_request_target"],
        permissions: ["contents: write"],
        usesPullRequestTarget: true,
        usesSecrets: true,
        visualHiveRelated: false
      }
    ]);
    expect(recommendation.findings.map((finding) => finding.message)).toContain(
      "Existing workflow uses pull_request_target. Do not execute untrusted PR code in that workflow."
    );
    expect(recommendation.warnings).toContain("One or more existing workflows use pull_request_target; keep Visual Hive PR checks on pull_request.");
    expect(recommendation.workflowPreviews.map((workflow) => workflow.id)).toEqual(["pull_request", "scheduled", "trusted_failure_issue"]);
    expect(recommendation.workflowPreviews.find((workflow) => workflow.id === "pull_request")).toMatchObject({
      path: ".github/workflows/visual-hive-pr.yml",
      label: "Visual Hive PR"
    });
    expect(recommendation.workflowPreviews.find((workflow) => workflow.id === "pull_request")?.content).toContain("pull_request:");
    expect(recommendation.workflowPreviews.find((workflow) => workflow.id === "pull_request")?.content).toContain("include-hidden-files: true");
    expect(recommendation.workflowPreviews.find((workflow) => workflow.id === "trusted_failure_issue")?.content).toContain("workflow_run:");
    expect(recommendation.onboardingChecklist.map((item) => item.id)).toEqual([
      "inspect-repository",
      "choose-pr-safe-target",
      "seed-starter-contracts",
      "verify-pr-safety",
      "generate-setup-files",
      "validate-locally"
    ]);
    expect(recommendation.onboardingChecklist.find((item) => item.id === "verify-pr-safety")).toMatchObject({
      status: "ready",
      relatedArtifacts: expect.arrayContaining([".github/workflows/visual-hive-pr.yml"])
    });
    expect(recommendation.onboardingChecklist.find((item) => item.id === "validate-locally")?.command).toContain("visual-hive doctor");
    expect(parsedYaml.contracts[0]?.id).toBe("app-shell-visual-stability");
    expect(parsedYaml.contracts[0]?.steps[0]?.action).toBe("assertVisible");
    expect(parsedYaml.contracts.map((contract) => contract.id)).toEqual([
      "app-shell-visual-stability",
      "route-clusters-visual-stability",
      "route-settings-visual-stability",
      "route-workloads-visual-stability"
    ]);
    expect(parsedYaml.contracts.find((contract) => contract.id === "route-settings-visual-stability")).toMatchObject({
      target: "localPreview",
      severity: "medium",
      selectors: { mustExist: ["[data-testid='dashboard-page']"] }
    });
    expect(parsedYaml.selection.changedFiles).toEqual([
      {
        pattern: "src/routes/**",
        contracts: ["route-clusters-visual-stability", "route-settings-visual-stability", "route-workloads-visual-stability"],
        risk: "medium"
      },
      {
        pattern: "src/pages/**",
        contracts: ["route-clusters-visual-stability", "route-settings-visual-stability", "route-workloads-visual-stability"],
        risk: "medium"
      },
      {
        pattern: "app/**",
        contracts: ["route-clusters-visual-stability", "route-settings-visual-stability", "route-workloads-visual-stability"],
        risk: "medium"
      },
      {
        pattern: "pages/**",
        contracts: ["route-clusters-visual-stability", "route-settings-visual-stability", "route-workloads-visual-stability"],
        risk: "medium"
      },
      {
        pattern: "src/**",
        contracts: [
          "app-shell-visual-stability",
          "route-clusters-visual-stability",
          "route-settings-visual-stability",
          "route-workloads-visual-stability"
        ],
        risk: "medium"
      }
    ]);
    expect(parsedYaml.project.setupProfile).toBe("free-local");
    expect(parsedYaml.targets.localPreview.kind).toBe("command");

    const setupDocs = buildSetupDocsMarkdown(recommendation);
    expect(setupDocs).toContain("# Visual Hive");
    expect(setupDocs).toContain("## PR Lane");
    expect(setupDocs).toContain("## Playwright Presence");
    expect(setupDocs).toContain("Status: present");
    expect(setupDocs).toContain("@playwright/test");
    expect(setupDocs).toContain("## Detected Route Hints");
    expect(setupDocs).toContain("/clusters");
    expect(setupDocs).toContain("PR checks should run with read-only permissions and no repository secrets.");
    expect(setupDocs).toContain("Serve command: npm run preview -- --port 4173");
    expect(setupDocs).toContain("app-shell-visual-stability");
    expect(setupDocs).toContain("route-clusters-visual-stability");
    expect(setupDocs).toContain("Playwright built-in");
    expect(setupDocs).toContain("## Onboarding Checklist");
    expect(setupDocs).toContain("### Verify PR safety");
    expect(setupDocs).toContain("## Setup Actions");
    expect(setupDocs).toContain("Use free local setup");
    expect(setupDocs).toContain("visual-hive providers decision --provider argos");
    expect(setupDocs).toContain("## Existing Workflow Hints");
    expect(setupDocs).toContain(".github/workflows/legacy.yml");
    expect(setupDocs).toContain("uses pull_request_target");
    expect(setupDocs).toContain("## Workflow Previews");
    expect(setupDocs).toContain("### Visual Hive PR");
    expect(setupDocs).toContain(".github/workflows/visual-hive-pr.yml");
    expect(setupDocs).toContain("include-hidden-files: true");
    expect(setupDocs).toContain("visual-hive workflows --write-templates");
    expect(setupDocs).toContain("Use `pull_request`, not `pull_request_target`");
  });

  it("recommends a component-storybook profile when Storybook is detected", async () => {
    const targetRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-recommend-storybook-"));
    tempDirs.push(targetRoot);
    await writeJson(path.join(targetRoot, "package.json"), {
      name: "storybook-fixture",
      scripts: {
        build: "vite build",
        storybook: "storybook dev -p 6006",
        preview: "vite preview"
      },
      dependencies: {
        react: "^19.0.0",
        vite: "^6.0.0",
        "@storybook/react-vite": "^8.0.0"
      }
    });
    await mkdir(path.join(targetRoot, "src", "components"), { recursive: true });
    await writeFile(path.join(targetRoot, "src", "components", "Card.tsx"), `<section data-testid="dashboard-card">Card</section>`, "utf8");
    await writeFile(path.join(targetRoot, "src", "components", "Banner.tsx"), `<section data-testid="dashboard-card">Banner</section>`, "utf8");
    await writeFile(
      path.join(targetRoot, "src", "components", "Card.stories.tsx"),
      `
import { Card } from "./Card";
export default { title: "Dashboard/Card", component: Card };
export const Primary = {};
`,
      "utf8"
    );
    await writeFile(
      path.join(targetRoot, "src", "components", "Banner.stories.tsx"),
      `
export default { title: "Dashboard/Banner" };
export const Alert = {};
`,
      "utf8"
    );

    const recommendation = await recommendSetup({ repoRoot: targetRoot, now: new Date("2026-06-15T00:00:00.000Z") });
    const parsedYaml = VisualHiveConfigSchema.parse(parseYaml(recommendation.recommendedConfigYaml));

    expect(recommendation.setupProfile).toBe("component-storybook");
    expect(recommendation.project.detectedFrameworks).toContain("storybook");
    expect(recommendation.recommendedTarget).toMatchObject({
      id: "componentLibrary",
      kind: "storybook",
      url: "http://127.0.0.1:6006",
      serve: "npm run storybook -- --host 127.0.0.1 --port 6006"
    });
    expect(parsedYaml.targets.componentLibrary.kind).toBe("storybook");
    expect(parsedYaml.targets.componentLibrary).toMatchObject({
      stories: ["src/**/*.stories.@(js|jsx|ts|tsx|mdx)"],
      components: ["src/components/**"]
    });
    expect(recommendation.detectedStories).toEqual([
      {
        storyFile: "src/components/Banner.stories.tsx",
        title: "Dashboard/Banner",
        exports: ["Alert"],
        route: "/iframe.html?id=dashboard-banner--alert&viewMode=story"
      },
      {
        storyFile: "src/components/Card.stories.tsx",
        title: "Dashboard/Card",
        exports: ["Primary"],
        route: "/iframe.html?id=dashboard-card--primary&viewMode=story"
      }
    ]);
    expect(recommendation.recommendedContracts.map((contract) => contract.id)).toEqual([
      "storybook-dashboard-banner-alert-visual-stability",
      "storybook-dashboard-card-primary-visual-stability"
    ]);
    expect(recommendation.recommendedContracts[0]).toMatchObject({
      id: "storybook-dashboard-banner-alert-visual-stability",
      targetId: "componentLibrary",
      selectors: ["[data-testid='dashboard-card']"]
    });
    expect(parsedYaml.contracts.map((contract) => contract.id)).toEqual([
      "storybook-dashboard-banner-alert-visual-stability",
      "storybook-dashboard-card-primary-visual-stability"
    ]);
    expect(parsedYaml.contracts[0]).toMatchObject({
      id: "storybook-dashboard-banner-alert-visual-stability",
      target: "componentLibrary",
      selectors: { mustExist: ["[data-testid='dashboard-card']"] }
    });
    expect(parsedYaml.contracts[0]?.screenshots.map((screenshot) => screenshot.route)).toEqual([
      "/iframe.html?id=dashboard-banner--alert&viewMode=story",
      "/iframe.html?id=dashboard-banner--alert&viewMode=story"
    ]);
    expect(parsedYaml.contracts[1]?.screenshots.map((screenshot) => screenshot.route)).toEqual([
      "/iframe.html?id=dashboard-card--primary&viewMode=story",
      "/iframe.html?id=dashboard-card--primary&viewMode=story"
    ]);
    const storybookContractIds = [
      "storybook-dashboard-banner-alert-visual-stability",
      "storybook-dashboard-card-primary-visual-stability"
    ];
    expect(parsedYaml.selection.changedFiles).toEqual([
      {
        pattern: "src/**/*.stories.*",
        contracts: storybookContractIds,
        risk: "medium"
      },
      {
        pattern: "src/components/**",
        contracts: storybookContractIds,
        risk: "medium"
      },
      {
        pattern: "src/**",
        contracts: storybookContractIds,
        risk: "low"
      }
    ]);
    expect(recommendation.providerRecommendations.find((provider) => provider.providerId === "chromatic")).toMatchObject({
      recommendation: "optional",
      requiredEnv: ["CHROMATIC_PROJECT_TOKEN"],
      externalUploadAllowedByDefault: false
    });
    expect(recommendation.setupActions.find((action) => action.id === "skip-provider-for-now")?.command).toContain("--provider chromatic");
    expect(recommendation.costEstimate.localScreenshotsPerRun).toBe(4);
    expect(recommendation.costEstimate.externalScreenshotsPerRun).toBe(4);
    expect(parsedYaml.costPolicy.maxExternalScreenshotsPerRun).toBeGreaterThanOrEqual(4);
    expect(parsedYaml.costPolicy.externalUpload.pullRequest).toBe(false);
    const setupDocs = buildSetupDocsMarkdown(recommendation);
    expect(setupDocs).toContain("## Detected Storybook Stories");
    expect(setupDocs).toContain("src/components/Banner.stories.tsx");
    expect(setupDocs).toContain("src/components/Card.stories.tsx");
    expect(setupDocs).toContain("/iframe.html?id=dashboard-banner--alert&viewMode=story");
    expect(setupDocs).toContain("/iframe.html?id=dashboard-card--primary&viewMode=story");
  });

  it("recommends a commandGroup target for complex fullstack and fake OAuth scripts", async () => {
    const targetRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-recommend-fullstack-"));
    tempDirs.push(targetRoot);
    await writeJson(path.join(targetRoot, "package.json"), {
      name: "fullstack-fixture",
      scripts: {
        "build:web": "vite build",
        "build:api": "tsc -p server",
        "dev:web": "vite --host 127.0.0.1 --port 5173",
        "dev:api": "node server.js --port 8081",
        "fake-oauth": "node fake-oauth.js --port 8788"
      },
      dependencies: {
        react: "^19.0.0",
        vite: "^6.0.0"
      }
    });
    await mkdir(path.join(targetRoot, "src"), { recursive: true });
    await writeFile(
      path.join(targetRoot, "src", "App.tsx"),
      `<main data-testid="dashboard-page"><a href="/settings">Settings</a></main>`,
      "utf8"
    );

    const recommendation = await recommendSetup({ repoRoot: targetRoot, now: new Date("2026-06-15T00:00:00.000Z") });
    const parsedYaml = VisualHiveConfigSchema.parse(parseYaml(recommendation.recommendedConfigYaml));

    expect(recommendation.setupProfile).toBe("complex-app");
    expect(recommendation.recommendedTarget).toMatchObject({
      id: "fakeOAuthFullstack",
      kind: "commandGroup",
      url: "http://127.0.0.1:5173",
      setup: ["npm run build:api", "npm run build:web"],
      services: [
        {
          name: "backend",
          command: "npm run dev:api",
          url: "http://127.0.0.1:8081/health",
          readinessTimeoutMs: 30000
        },
        {
          name: "fakeOAuth",
          command: "npm run fake-oauth",
          url: "http://127.0.0.1:8788/health",
          readinessTimeoutMs: 30000
        },
        {
          name: "frontend",
          command: "npm run dev:web",
          url: "http://127.0.0.1:5173",
          readinessTimeoutMs: 30000
        }
      ]
    });
    expect(parsedYaml.targets.fakeOAuthFullstack).toMatchObject({
      kind: "commandGroup",
      url: "http://127.0.0.1:5173",
      prSafe: true,
      cost: "medium"
    });
    expect(parsedYaml.targets.fakeOAuthFullstack.services.map((service) => service.name)).toEqual(["backend", "fakeOAuth", "frontend"]);
    expect(parsedYaml.contracts.map((contract) => contract.id)).toEqual(["app-shell-visual-stability", "route-settings-visual-stability"]);
    expect(recommendation.costEstimate.ciRuntimeClass).toBe("expensive");
    expect(recommendation.permissions.scheduled.secretsRequired).toEqual(["PROTECTED_TARGET_SECRET_NAMES"]);

    const setupDocs = buildSetupDocsMarkdown(recommendation);
    expect(setupDocs).toContain("Services:");
    expect(setupDocs).toContain("fakeOAuth: npm run fake-oauth");
    expect(setupDocs).toContain("Setup commands: npm run build:api, npm run build:web");
  });

  it("honors an explicit hosted-review setup profile without enabling PR uploads", async () => {
    const targetRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-recommend-hosted-profile-"));
    tempDirs.push(targetRoot);
    await writeJson(path.join(targetRoot, "package.json"), {
      name: "hosted-profile-fixture",
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

    const recommendation = await recommendSetup({
      repoRoot: targetRoot,
      setupProfile: "hosted-review",
      now: new Date("2026-06-15T00:00:00.000Z")
    });
    const parsedYaml = VisualHiveConfigSchema.parse(parseYaml(recommendation.recommendedConfigYaml));

    expect(recommendation.setupProfile).toBe("hosted-review");
    expect(recommendation.costEstimate).toMatchObject({
      localScreenshotsPerRun: 2,
      externalScreenshotsPerRun: 2,
      estimatedMonthlyExternalScreenshots: 40
    });
    expect(recommendation.providerRecommendations.find((provider) => provider.providerId === "argos")).toMatchObject({
      recommendation: "optional",
      requiredEnv: ["ARGOS_TOKEN"],
      externalUploadAllowedByDefault: false
    });
    expect(recommendation.providerRecommendations.find((provider) => provider.providerId === "percy")?.recommendation).toBe("optional");
    expect(parsedYaml.project.setupProfile).toBe("hosted-review");
    expect(parsedYaml.costPolicy.maxExternalScreenshotsPerRun).toBeGreaterThanOrEqual(2);
    expect(parsedYaml.costPolicy.externalUpload.pullRequest).toBe(false);
    expect(parsedYaml.costPolicy.externalUpload.onFailureOnly).toBe(true);
  });

  it("handles package.json files with a UTF-8 BOM during setup scanning", async () => {
    const targetRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-recommend-bom-"));
    tempDirs.push(targetRoot);
    await writeFile(
      path.join(targetRoot, "package.json"),
      `\uFEFF${JSON.stringify({
        name: "bom-fixture",
        scripts: { build: "vite build", preview: "vite preview" },
        dependencies: { react: "^19.0.0", vite: "^6.0.0" }
      })}`,
      "utf8"
    );
    await mkdir(path.join(targetRoot, "src"), { recursive: true });
    await writeFile(path.join(targetRoot, "src", "App.tsx"), `<main data-testid="dashboard-page">Dashboard</main>`, "utf8");

    const recommendation = await recommendSetup({ repoRoot: targetRoot, now: new Date("2026-06-15T00:00:00.000Z") });

    expect(recommendation.project.name).toBe("bom-fixture");
    expect(recommendation.project.type).toBe("react-vite");
    expect(recommendation.recommendedTarget.serve).toBe("npm run preview -- --port 4173");
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

  it("summarizes connected repository health from reports, mutation score, and risk", async () => {
    const managerRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-connections-health-manager-"));
    const connectedRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-connections-health-target-"));
    const now = new Date("2026-06-16T00:00:00.000Z");
    tempDirs.push(managerRoot, connectedRoot);
    await writeMinimalConfig(managerRoot, "manager-project");
    await writeMinimalConfig(connectedRoot, "connected-project");
    await writeJson(path.join(managerRoot, ".visual-hive", "report.json"), connectionReport("manager-project", "passed"));
    await writeJson(path.join(managerRoot, ".visual-hive", "coverage.json"), connectionCoverage("manager-project", []));
    await writeJson(path.join(connectedRoot, ".visual-hive", "report.json"), connectionReport("connected-project", "failed", "2026-06-01T00:00:00.000Z"));
    await writeJson(path.join(connectedRoot, ".visual-hive", "mutation-report.json"), {
      schemaVersion: 2,
      project: "connected-project",
      generatedAt: "2026-06-15T00:10:00.000Z",
      minScore: 0.75,
      score: 0.5,
      killed: 1,
      total: 2,
      results: []
    });
    await writeJson(
      path.join(connectedRoot, ".visual-hive", "coverage.json"),
      connectionCoverage("connected-project", [
        { kind: "target_without_contracts", severity: "high", message: "Admin target has no contracts.", targetId: "admin" },
        { kind: "contract_without_assertions", severity: "low", message: "Settings contract has no assertions.", contractId: "settings" },
        { kind: "viewport_without_screenshots", severity: "medium", message: "Mobile viewport has no screenshots.", viewport: "mobile" }
      ])
    );
    await writeJson(path.join(connectedRoot, ".visual-hive", "risk.json"), {
      schemaVersion: 1,
      project: "connected-project",
      generatedAt: "2026-06-15T00:20:00.000Z",
      summary: {
        total: 2,
        critical: 0,
        high: 1,
        medium: 1,
        low: 0,
        riskScore: 62,
        highestSeverity: "high",
        prBlocking: 1,
        trustedOnly: 0
      },
      inputs: {
        plan: true,
        report: true,
        mutationReport: true,
        coverageReport: false,
        targetAudit: false,
        contractAudit: false,
        flowAudit: false,
        scheduleAudit: false,
        workflowAudit: false
      },
      risks: [],
      recommendations: []
    });
    await writeJson(path.join(connectedRoot, ".visual-hive", "readiness.json"), {
      schemaVersion: 1,
      project: "connected-project",
      generatedAt: "2026-06-15T00:25:00.000Z",
      status: "blocked",
      score: 58,
      summary: { total: 4, passed: 1, warnings: 1, blocked: 2, missing: 0 },
      inputs: {
        plan: true,
        report: true,
        mutationReport: true,
        baselines: true,
        workflowAudit: true,
        securityAudit: true,
        costAudit: true
      },
      gates: [],
      nextActions: []
    });
    await writeJson(path.join(connectedRoot, ".visual-hive", "security.json"), {
      schemaVersion: 1,
      project: "connected-project",
      generatedAt: "2026-06-15T00:30:00.000Z",
      summary: {
        score: 72,
        totalFindings: 2,
        critical: 1,
        high: 1,
        medium: 0,
        low: 0,
        prBlocking: 1,
        trustedOnly: 1,
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
      project: "connected-project",
      generatedAt: "2026-06-15T00:35:00.000Z",
      mode: "pr",
      summary: {
        selectedContracts: 2,
        selectedTargets: 1,
        localScreenshots: 3,
        estimatedExternalScreenshots: 3,
        externalCallsPlanned: 0,
        externalCallsMade: 0,
        enabledExternalProviders: 1,
        policyBlockedProviders: 1,
        missingCredentialProviders: 0,
        expensiveTargetsSelected: 0,
        mutationOperators: 0,
        maxExternalScreenshotsPerRun: 0,
        maxMonthlyExternalScreenshots: 100,
        budgetStatus: "blocked"
      },
      costPolicy: sampleConfig().costPolicy,
      targets: [],
      providers: [],
      risks: [],
      recommendations: []
    });

    await addConnection({
      repoRoot: managerRoot,
      repoPath: connectedRoot,
      id: "risky-console",
      label: "Risky Console",
      now
    });

    const index = await listConnections({ repoRoot: managerRoot, now });
    const connection = index.connections.find((candidate) => candidate.id === "risky-console");

    expect(index.summary.failedConnections).toBe(1);
    expect(index.summary.staleReportConnections).toBe(1);
    expect(index.summary.weakMutationConnections).toBe(1);
    expect(index.summary.coverageGapConnections).toBe(1);
    expect(index.summary.highCoverageGapConnections).toBe(1);
    expect(index.summary.highRiskConnections).toBe(1);
    expect(index.summary.readinessBlockedConnections).toBe(1);
    expect(index.summary.securityRiskConnections).toBe(1);
    expect(index.summary.costPolicyConnections).toBe(1);
    expect(index.summary.connectionsNeedingAttention).toBe(1);
    expect(index.portfolio.queues.find((queue) => queue.id === "deterministic_failures")?.connections.map((item) => item.id)).toContain("risky-console");
    expect(index.portfolio.queues.find((queue) => queue.id === "stale_reports")?.connections.map((item) => item.id)).toContain("risky-console");
    expect(index.portfolio.queues.find((queue) => queue.id === "coverage_gaps")?.connections.map((item) => item.id)).toContain("risky-console");
    expect(index.portfolio.queues.find((queue) => queue.id === "weak_mutation")?.connections.map((item) => item.id)).toContain("risky-console");
    expect(index.portfolio.queues.find((queue) => queue.id === "high_risk")?.connections.map((item) => item.id)).toContain("risky-console");
    expect(index.portfolio.queues.find((queue) => queue.id === "readiness_blocked")?.connections.map((item) => item.id)).toContain("risky-console");
    expect(index.portfolio.queues.find((queue) => queue.id === "security_risks")?.connections.map((item) => item.id)).toContain("risky-console");
    expect(index.portfolio.queues.find((queue) => queue.id === "cost_policy")?.connections.map((item) => item.id)).toContain("risky-console");
    expect(index.portfolio.topAttention[0]).toMatchObject({ id: "risky-console", health: "attention" });
    expect(connection).toMatchObject({
      health: "attention",
      latestDeterministicStatus: "failed",
      latestReportAgeDays: 15,
      staleReport: true,
      latestMutationScore: 0.5,
      mutationMinScore: 0.75,
      mutationKilled: 1,
      mutationTotal: 2,
      coverageGapCount: 3,
      highCoverageGapCount: 1,
      mediumCoverageGapCount: 1,
      uncoveredTargets: 1,
      uncoveredContracts: 1,
      latestRiskScore: 62,
      latestRiskSeverity: "high",
      latestReadinessStatus: "blocked",
      latestReadinessScore: 58,
      readinessBlocked: 2,
      readinessWarnings: 1,
      latestSecurityScore: 72,
      securityCriticalHigh: 2,
      latestCostBudgetStatus: "blocked",
      costPolicyBlockedProviders: 1
    });
    expect(connection?.attention.join(" ")).toContain("Latest deterministic run failed");
    expect(connection?.attention.join(" ")).toContain("Latest deterministic report is stale");
    expect(connection?.attention.join(" ")).toContain("Mutation score 50% is below minimum 75%");
    expect(connection?.attention.join(" ")).toContain("Coverage has 1 high-severity gap");
    expect(connection?.attention.join(" ")).toContain("Risk register needs review");
    expect(connection?.attention.join(" ")).toContain("Readiness gate is blocked");
    expect(connection?.attention.join(" ")).toContain("Security audit has 2 critical/high findings");
    expect(connection?.attention.join(" ")).toContain("Cost policy is blocked");
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

function connectionReport(project: string, status: "passed" | "failed", generatedAt = "2026-06-15T00:00:00.000Z"): Report {
  return {
    schemaVersion: 2,
    project,
    repository: sampleRepository,
    mode: "pr",
    generatedAt,
    status,
    changedFiles: [],
    selectedTargets: [],
    selectedContracts: [],
    excludedContracts: [],
    targetLifecycle: [],
    generatedSpecPath: ".visual-hive/generated/visual-hive.generated.spec.ts",
    results: [],
    summary: {
      passed: status === "passed" ? 1 : 0,
      failed: status === "failed" ? 1 : 0,
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
  };
}

function connectionCoverage(
  project: string,
  gaps: Array<{ kind: string; severity: "low" | "medium" | "high"; message: string; targetId?: string; contractId?: string; route?: string; viewport?: string }>
): unknown {
  return {
    schemaVersion: 1,
    project,
    generatedAt: "2026-06-15T00:05:00.000Z",
    mode: "pr",
    summary: {
      targetCount: 2,
      contractCount: 2,
      selectedContracts: 1,
      unselectedContracts: 1,
      prSafeContracts: 1,
      protectedContracts: 0,
      scheduleOnlyContracts: 0,
      routesCovered: 1,
      viewportsCovered: 1,
      uncoveredTargets: gaps.some((gap) => gap.kind === "target_without_contracts") ? 1 : 0,
      uncoveredContracts: gaps.some((gap) => gap.kind === "contract_without_assertions") ? 1 : 0,
      changedFileRules: 1,
      matchedChangedFileRules: 1,
      unmatchedChangedFiles: 0
    },
    targets: [],
    contracts: [],
    routes: [],
    viewports: [],
    changedFileCoverage: [],
    unmatchedChangedFiles: [],
    uncoveredAreas: gaps
  };
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
