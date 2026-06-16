import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { addConnection } from "@visual-hive/core";
import { createControlPlaneSnapshot, readControlPlaneArtifact, startControlPlaneServer } from "../src/index.js";
import { controlPlaneJs } from "../src/uiAssets.js";

const sampleRepository = {
  provider: "local",
  repository: "visual-hive/ui-fixture",
  branch: "main",
  commitSha: "abcdef1234567890"
};

async function makeFixture(): Promise<{ repoRoot: string; configPath: string }> {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-ui-"));
  await mkdir(path.join(repoRoot, ".visual-hive", "artifacts", "results"), { recursive: true });
  await mkdir(path.join(repoRoot, ".visual-hive", "artifacts", "screenshots"), { recursive: true });
  await mkdir(path.join(repoRoot, ".visual-hive", "snapshots"), { recursive: true });
  await mkdir(path.join(repoRoot, ".github", "workflows"), { recursive: true });
  const configPath = path.join(repoRoot, "visual-hive.config.yaml");
  const configYaml = `project:
  name: ui-fixture
  type: react-vite
  defaultBranch: main
targets:
  localPreview:
    kind: url
    url: "http://127.0.0.1:4173"
    prSafe: true
    cost: cheap
contracts:
  - id: dashboard
    description: Dashboard shell
    target: localPreview
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
`;
  await writeFile(configPath, configYaml, "utf8");
  await writeFile(
    path.join(repoRoot, ".visual-hive", "report.json"),
    JSON.stringify(
      {
        schemaVersion: 2,
        project: "ui-fixture",
        repository: sampleRepository,
        mode: "pr",
        generatedAt: "2026-06-15T00:00:00.000Z",
        status: "passed",
        changedFiles: ["src/App.tsx"],
        selectedTargets: [{ id: "localPreview", kind: "url", url: "http://127.0.0.1:4173", prSafe: true, cost: "cheap" }],
        selectedContracts: ["dashboard"],
        excludedContracts: [],
        targetLifecycle: [],
        generatedSpecPath: path.join(repoRoot, ".visual-hive", "generated", "visual-hive.generated.spec.ts"),
        results: [
          {
            contractId: "dashboard",
            targetId: "localPreview",
            status: "passed",
            durationMs: 10,
            errors: [],
            artifacts: [],
            selectorAssertions: [{ kind: "mustExist", value: "[data-testid='dashboard-page']", status: "passed" }],
            screenshotAssertions: [
              {
                contractId: "dashboard",
                screenshotName: "dashboard",
                name: "dashboard",
                route: "/",
                viewport: "desktop",
                status: "passed",
                baselinePath: path.join(repoRoot, ".visual-hive", "snapshots", "dashboard.png"),
                actualPath: path.join(repoRoot, ".visual-hive", "artifacts", "screenshots", "dashboard.png"),
                maxDiffPixelRatio: 0.01,
                actualDiffPixelRatio: 0,
                actualDiffPixels: 0,
                diffPixels: 0,
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
        reproductionCommands: ["visual-hive run"]
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(path.join(repoRoot, ".visual-hive", "issue.md"), "# Issue\n", "utf8");
  await writeFile(path.join(repoRoot, ".visual-hive", "pr-comment.md"), "<!-- visual-hive-report -->\n## Visual Hive report\n", "utf8");
  await writeFile(
    path.join(repoRoot, ".visual-hive", "triage.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        project: "ui-fixture",
        generatedAt: "2026-06-15T00:00:00.000Z",
        sourceArtifacts: { report: ".visual-hive/report.json" },
        summary: {
          findingCount: 1,
          critical: 0,
          high: 0,
          medium: 1,
          low: 0,
          classifications: { insufficient_coverage: 1 }
        },
        findings: [
          {
            classification: "insufficient_coverage",
            severity: "medium",
            title: "Coverage gap: changed_file_without_rule",
            evidence: ["Changed file did not match any selection rule."],
            suggestedFiles: ["src/unmapped.ts"],
            suggestedNextTests: ["Add a changed-file selection rule."]
          }
        ]
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(path.join(repoRoot, ".visual-hive", "missing-tests.md"), "# Missing Test Suggestions\n", "utf8");
  await writeFile(path.join(repoRoot, ".visual-hive", "baseline-review.md"), "# Baseline Review Summary\n", "utf8");
  await writeFile(path.join(repoRoot, ".visual-hive", "artifacts", "results", "console.log"), "authorization: Bearer secret-token", "utf8");
  await writeFile(
    path.join(repoRoot, ".visual-hive", "llm-usage.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        project: "ui-fixture",
        generatedAt: "2026-06-15T00:00:00.000Z",
        governance: {
          enabled: false,
          provider: "none",
          model: "offline-heuristics",
          neverSoleOracle: true,
          maxDailyRuns: 5,
          maxPromptTokens: 50000,
          maxEstimatedCostUsd: 0,
          callsMade: 0
        },
        summary: {
          promptCount: 2,
          totalEstimatedTokens: 25,
          totalEstimatedCostUsd: 0,
          blockedPrompts: 0,
          promptOnly: true,
          advisoryOnly: true,
          callsMade: 0
        },
        records: [
          {
            task: "repair_prompt",
            path: ".visual-hive/repair-prompt.md",
            provider: "none",
            model: "offline-heuristics",
            enabled: false,
            promptOnly: true,
            advisoryOnly: true,
            callsMade: 0,
            status: "disabled",
            promptChars: 40,
            estimatedTokens: 10,
            estimatedCostUsd: 0,
            budget: { maxPromptTokens: 50000, maxEstimatedCostUsd: 0 },
            notes: ["No LLM API call was made."]
          },
          {
            task: "baseline_review_summary",
            path: ".visual-hive/baseline-review.md",
            provider: "none",
            model: "offline-heuristics",
            enabled: false,
            promptOnly: true,
            advisoryOnly: true,
            callsMade: 0,
            status: "disabled",
            promptChars: 60,
            estimatedTokens: 15,
            estimatedCostUsd: 0,
            budget: { maxPromptTokens: 50000, maxEstimatedCostUsd: 0 },
            notes: ["No LLM API call was made."]
          }
        ],
        warnings: ["LLM usage is disabled; prompts are generated for offline review only."],
        recommendations: ["Never use LLM output as the sole pass/fail oracle."]
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    path.join(repoRoot, ".visual-hive", "provider-results.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        project: "ui-fixture",
        generatedAt: "2026-06-15T00:00:00.000Z",
        deterministicStatus: "passed",
        artifactCount: 1,
        providers: [
          {
            providerId: "playwright",
            label: "Playwright built-in",
            enabled: true,
            mode: "external",
            availability: "available",
            deterministicRole: "oracle",
            operations: [
              { operation: "availability", status: "passed", message: "Built-in Playwright adapter is available." },
              { operation: "compare", status: "passed", message: "Deterministic Playwright run passed.", artifactCount: 1 }
            ],
            result: {
              providerId: "playwright",
              label: "Playwright built-in",
              status: "passed",
              deterministicRole: "oracle",
              message: "Built-in Playwright deterministic run passed.",
              requiredEnv: [],
              missingEnv: [],
              artifactCount: 1,
              normalizedAt: "2026-06-15T00:00:00.000Z"
            },
            normalized: {
              providerId: "playwright",
              category: "built-in",
              status: "passed",
              deterministicRole: "oracle",
              networkMode: "local",
              externalCallsMade: 0,
              artifactSummary: {
                localArtifacts: 1,
                uploadedArtifacts: 0,
                comparedArtifacts: 1,
                uploadMode: "local-only"
              },
              notes: ["Playwright is the deterministic pass/fail oracle."]
            },
            artifacts: [".visual-hive/report.json"],
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
          failedProviders: 0
        },
        warnings: []
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    path.join(repoRoot, ".visual-hive", "recommendations.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        project: {
          name: "ui-fixture",
          repoRoot,
          type: "react-vite",
          packageManager: "npm",
          detectedFrameworks: ["react", "vite"],
          scripts: ["build", "preview"]
        },
        generatedAt: "2026-06-15T00:00:00.000Z",
        configPath: "visual-hive.config.yaml",
        setupProfile: "free-local",
        providerRecommendations: [
          {
            providerId: "playwright",
            label: "Playwright built-in",
            recommendation: "use",
            reason: "Default deterministic oracle. No paid account or external upload is required.",
            requiredEnv: [],
            externalUploadAllowedByDefault: false
          },
          {
            providerId: "argos",
            label: "Argos",
            recommendation: "future",
            reason: "Start with local artifacts. Enable hosted review later only if the team needs shared screenshot review/history.",
            requiredEnv: ["ARGOS_TOKEN"],
            externalUploadAllowedByDefault: false
          }
        ],
        costEstimate: {
          localScreenshotsPerRun: 2,
          externalScreenshotsPerRun: 0,
          estimatedPrMinutes: 4,
          estimatedScheduledMinutes: 6,
          estimatedMonthlyExternalScreenshots: 0,
          ciRuntimeClass: "medium",
          notes: ["Default recommendation uses local Playwright artifacts only."]
        },
        permissions: {
          pullRequest: {
            permissions: ["contents: read"],
            secretsRequired: [],
            externalNetwork: false,
            notes: ["PR lane should run with no repository secrets and should not create issues."]
          },
          scheduled: {
            permissions: ["contents: read", "actions: read"],
            secretsRequired: [],
            externalNetwork: false,
            notes: ["Issue creation should happen from sanitized artifacts in a trusted workflow_run lane."]
          }
        },
        setupPullRequest: {
          recommended: true,
          title: "Add Visual Hive deterministic visual QA",
          files: ["visual-hive.config.yaml", ".github/workflows/visual-hive-pr.yml"],
          steps: ["Run visual-hive recommend --write-config in the target repo."],
          securityNotes: ["Use pull_request, not pull_request_target, for PR code execution."]
        },
        recommendedConfig: {},
        recommendedConfigYaml: configYaml,
        detectedSelectors: [{ selector: "[data-testid='dashboard-page']", sourceFile: "src/App.tsx", occurrences: 1 }],
        recommendedTarget: {
          id: "localPreview",
          kind: "command",
          url: "http://127.0.0.1:4173",
          confidence: "high",
          reasons: ["Detected preview script."]
        },
        recommendedContracts: [
          {
            id: "app-shell-visual-stability",
            targetId: "localPreview",
            selectors: ["[data-testid='dashboard-page']"],
            steps: [{ action: "assertVisible", selector: "[data-testid='dashboard-page']" }],
            screenshots: [{ name: "app-shell-desktop", route: "/", viewport: "desktop" }],
            reasons: ["Detected stable project-owned selector."]
          }
        ],
        recommendedCommands: ["visual-hive doctor", "visual-hive run"],
        findings: [],
        warnings: []
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    path.join(repoRoot, ".github", "workflows", "visual-hive-pr.yml"),
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
  await writeFile(path.join(repoRoot, ".visual-hive", "artifacts", "screenshots", "dashboard.png"), "actual-dashboard", "utf8");
  await writeFile(path.join(repoRoot, ".visual-hive", "snapshots", "dashboard.png"), "old-dashboard", "utf8");
  return { repoRoot, configPath };
}

describe("control plane", () => {
  it("builds a snapshot from config and report artifacts", async () => {
    const fixture = await makeFixture();
    const snapshot = await createControlPlaneSnapshot({ repo: fixture.repoRoot, config: fixture.configPath, readOnly: true });

    expect(snapshot.config?.project.name).toBe("ui-fixture");
    expect(snapshot.overview.deterministicStatus).toBe("passed");
    expect(snapshot.targets).toHaveLength(1);
    expect(snapshot.contracts).toHaveLength(1);
    expect(snapshot.providers.find((provider) => provider.id === "playwright")?.availability).toBe("available");
    expect(snapshot.report?.providerResults?.[0]?.status).toBe("passed");
    expect(snapshot.triageReport?.summary.findingCount).toBe(1);
    expect(snapshot.failures.find((failure) => failure.classification === "insufficient_coverage")?.suggestedFiles).toContain("src/unmapped.ts");
    expect(snapshot.providerRunReport?.providers[0]?.operations.map((operation) => operation.operation)).toContain("compare");
    expect(snapshot.setupRecommendation?.recommendedTarget.id).toBe("localPreview");
    expect(snapshot.setupRecommendation?.setupProfile).toBe("free-local");
    expect(snapshot.setupRecommendation?.providerRecommendations.find((provider) => provider.providerId === "argos")?.requiredEnv).toEqual([
      "ARGOS_TOKEN"
    ]);
    expect(snapshot.runHistory?.summary.runCount).toBe(1);
    expect(snapshot.runHistory?.entries[0]?.deterministicStatus).toBe("passed");
    expect(snapshot.llmUsage?.summary.callsMade).toBe(0);
    expect(snapshot.llmUsage?.records[0]?.task).toBe("repair_prompt");
    const artifactPreview = snapshot.artifacts.find((artifact) => artifact.path.endsWith("console.log"));
    expect(artifactPreview?.kind).toBe("log");
    expect(artifactPreview?.preview).toContain("[REDACTED]");
    expect(snapshot.targetAudit?.summary.targetCount).toBe(1);
    expect(snapshot.targetAudit?.targets[0]?.latestStatus).toBe("passed");
    expect(snapshot.coverage.summary.contractCount).toBe(1);
    expect(snapshot.coverage.routes[0]?.selectedContracts).toEqual(["dashboard"]);
    expect(snapshot.contractAudit?.summary.contractCount).toBe(1);
    expect(snapshot.contractAudit?.contracts[0]?.latestStatus).toBe("passed");
    expect(snapshot.scheduleAudit?.summary.pullRequestContracts).toBe(1);
    expect(snapshot.scheduleAudit?.lanes.map((lane) => lane.id)).toContain("trusted_issue");
    expect(snapshot.workflowAudit?.summary.pullRequestWorkflows).toBe(1);
    expect(snapshot.workflowAudit?.summary.criticalFindings).toBe(0);
    expect(snapshot.workflowTemplates.map((template) => template.id)).toEqual(["pull_request", "scheduled", "trusted_failure_issue"]);
    expect(snapshot.workflowTemplates.find((template) => template.id === "trusted_failure_issue")?.content).toContain("function walkArtifacts");
    expect(snapshot.screenshots[0]?.name).toBe("dashboard");
    expect(snapshot.issueMarkdown).toContain("Issue");
    expect(snapshot.prCommentMarkdown).toContain("Visual Hive report");
    expect(snapshot.missingTestsMarkdown).toContain("Missing Test Suggestions");
    expect(snapshot.baselineReviewMarkdown).toContain("Baseline Review Summary");
    expect(snapshot.artifacts.find((artifact) => artifact.path.endsWith("baseline-review.md"))?.labels).toContain("baseline-review");
  });

  it("loads a selected connected repository by connection id", async () => {
    const manager = await makeFixture();
    const connected = await makeFixture();
    const connectedConfig = await readFile(connected.configPath, "utf8");
    await writeFile(connected.configPath, connectedConfig.replace("name: ui-fixture", "name: connected-fixture"), "utf8");
    await addConnection({
      repoRoot: manager.repoRoot,
      repoPath: connected.repoRoot,
      id: "connected",
      label: "Connected fixture"
    });

    const snapshot = await createControlPlaneSnapshot({ repo: manager.repoRoot, config: manager.configPath, readOnly: true }, "connected");

    expect(snapshot.activeConnectionId).toBe("connected");
    expect(snapshot.repoRoot).toBe(path.resolve(connected.repoRoot));
    expect(snapshot.config?.project.name).toBe("connected-fixture");
    expect(snapshot.connections?.connections.map((connection) => connection.id)).toContain("connected");
  });

  it("rejects unknown selected connection ids", async () => {
    const fixture = await makeFixture();

    await expect(createControlPlaneSnapshot({ repo: fixture.repoRoot, config: fixture.configPath, readOnly: true }, "missing")).rejects.toThrow(
      /Unknown Visual Hive connection/
    );
  });

  it("adds and removes local repository connections through the local API", async () => {
    const manager = await makeFixture();
    const connected = await makeFixture();
    const connectedConfig = await readFile(connected.configPath, "utf8");
    await writeFile(connected.configPath, connectedConfig.replace("name: ui-fixture", "name: api-connected-fixture"), "utf8");
    const server = await startControlPlaneServer({ repo: manager.repoRoot, config: manager.configPath, port: 0 });
    try {
      const add = await fetch(`${server.url}/api/connections/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoPath: connected.repoRoot,
          configPath: "visual-hive.config.yaml",
          id: "api-connected",
          label: "API Connected",
          tags: "dogfood,ui"
        })
      });
      const addPayload = await add.json();
      expect(add.status).toBe(200);
      expect(addPayload.index.connections.find((connection: { id: string }) => connection.id === "api-connected")?.projectName).toBe(
        "api-connected-fixture"
      );

      const snapshot = await createControlPlaneSnapshot({ repo: manager.repoRoot, config: manager.configPath }, "api-connected");
      expect(snapshot.config?.project.name).toBe("api-connected-fixture");

      const remove = await fetch(`${server.url}/api/connections/remove`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "api-connected" })
      });
      const removePayload = await remove.json();
      expect(remove.status).toBe(200);
      expect(removePayload.index.connections.map((connection: { id: string }) => connection.id)).not.toContain("api-connected");
    } finally {
      await server.close();
    }
  });

  it("blocks connection writes in read-only mode", async () => {
    const manager = await makeFixture();
    const connected = await makeFixture();
    const server = await startControlPlaneServer({ repo: manager.repoRoot, config: manager.configPath, port: 0, readOnly: true });
    try {
      const add = await fetch(`${server.url}/api/connections/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoPath: connected.repoRoot, id: "blocked" })
      });
      expect(add.status).toBe(403);

      const remove = await fetch(`${server.url}/api/connections/remove`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "blocked" })
      });
      expect(remove.status).toBe(403);

      const snapshot = await createControlPlaneSnapshot({ repo: manager.repoRoot, config: manager.configPath, readOnly: true });
      expect(snapshot.connections?.connections.map((connection) => connection.id)).not.toContain("blocked");
    } finally {
      await server.close();
    }
  });

  it("rejects artifact path traversal", async () => {
    const fixture = await makeFixture();
    await expect(readControlPlaneArtifact({ repo: fixture.repoRoot, config: fixture.configPath }, "../visual-hive.config.yaml")).rejects.toThrow(
      /outside \.visual-hive/
    );
  });

  it("serves the UI and snapshot API", async () => {
    const fixture = await makeFixture();
    const server = await startControlPlaneServer({ repo: fixture.repoRoot, config: fixture.configPath, port: 0, readOnly: true });
    try {
      const page = await fetch(server.url).then((response) => response.text());
      expect(page).toContain("Visual Hive Control Plane");
      const appJs = await fetch(`${server.url}/assets/app.js`).then((response) => response.text());
      expect(appJs).toContain("contract-filter-target");
      expect(appJs).toContain("contract-filter-severity");
      expect(appJs).toContain("contract-filter-prsafe");
      expect(appJs).toContain("contract-filter-status");
      expect(appJs).toContain("contract-filter-route");
      expect(appJs).toContain("contract-filter-viewport");
      expect(appJs).toContain("copy-button");
      expect(appJs).toContain("function copyText");
      expect(appJs).toContain("Diff pixels");
      expect(appJs).toContain("Workflow templates");
      expect(appJs).toContain("trusted workflow_run lane");
      expect(appJs).toContain("/api/workflows/write-templates");
      expect(appJs).toContain("workflow-write-all");
      expect(appJs).toContain("Provider recommendation");
      expect(appJs).toContain("Setup PR guidance");
      expect(appJs).toContain("setup-write-config");
      expect(appJs).toContain("/api/setup/write-config");
      const snapshot = await fetch(`${server.url}/api/snapshot`).then((response) => response.json());
      expect(snapshot.config.project.name).toBe("ui-fixture");
    } finally {
      await server.close();
    }
  });

  it("ships parseable browser JavaScript for contract manager filters", () => {
    expect(() => new Function(controlPlaneJs)).not.toThrow();
    expect(controlPlaneJs).toContain("function filterContracts");
    expect(controlPlaneJs).toContain("contractTargetPrSafe");
    expect(controlPlaneJs).toContain("Filters are local to the browser");
    expect(controlPlaneJs).toContain("function baselineCardBody");
    expect(controlPlaneJs).toContain("navigator.clipboard");
    expect(controlPlaneJs).toContain("function workflowTemplatesCard");
  });

  it("approves a baseline through the local API when write mode is enabled", async () => {
    const fixture = await makeFixture();
    const server = await startControlPlaneServer({ repo: fixture.repoRoot, config: fixture.configPath, port: 0 });
    try {
      const response = await fetch(`${server.url}/api/baseline/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contractId: "dashboard", screenshotName: "dashboard", viewport: "desktop" })
      });
      const responseText = await response.text();
      expect(response.status, responseText).toBe(200);
      const payload = JSON.parse(responseText);
      expect(payload.approval.contractId).toBe("dashboard");
      await expect(readFile(path.join(fixture.repoRoot, ".visual-hive", "snapshots", "dashboard.png"), "utf8")).resolves.toBe("actual-dashboard");
      const snapshot = await createControlPlaneSnapshot({ repo: fixture.repoRoot, config: fixture.configPath });
      expect(snapshot.screenshots[0]?.approvedAt).toBeTruthy();
    } finally {
      await server.close();
    }
  });

  it("rejects a baseline through the local API without changing the baseline image", async () => {
    const fixture = await makeFixture();
    const server = await startControlPlaneServer({ repo: fixture.repoRoot, config: fixture.configPath, port: 0 });
    try {
      const response = await fetch(`${server.url}/api/baseline/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contractId: "dashboard", screenshotName: "dashboard", viewport: "desktop", reason: "Needs design review" })
      });
      const responseText = await response.text();
      expect(response.status, responseText).toBe(200);
      const payload = JSON.parse(responseText);
      expect(payload.rejection.reason).toBe("Needs design review");
      await expect(readFile(path.join(fixture.repoRoot, ".visual-hive", "snapshots", "dashboard.png"), "utf8")).resolves.toBe("old-dashboard");
      const snapshot = await createControlPlaneSnapshot({ repo: fixture.repoRoot, config: fixture.configPath });
      expect(snapshot.screenshots[0]?.rejectedAt).toBeTruthy();
      expect(snapshot.screenshots[0]?.rejectionReason).toBe("Needs design review");
    } finally {
      await server.close();
    }
  });

  it("blocks baseline approval in read-only mode", async () => {
    const fixture = await makeFixture();
    const server = await startControlPlaneServer({ repo: fixture.repoRoot, config: fixture.configPath, port: 0, readOnly: true });
    try {
      const response = await fetch(`${server.url}/api/baseline/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contractId: "dashboard", screenshotName: "dashboard", viewport: "desktop" })
      });
      expect(response.status).toBe(403);
      const rejected = await fetch(`${server.url}/api/baseline/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contractId: "dashboard", screenshotName: "dashboard", viewport: "desktop", reason: "blocked" })
      });
      expect(rejected.status).toBe(403);
      await expect(readFile(path.join(fixture.repoRoot, ".visual-hive", "snapshots", "dashboard.png"), "utf8")).resolves.toBe("old-dashboard");
    } finally {
      await server.close();
    }
  });

  it("validates config drafts and returns a review diff without saving", async () => {
    const fixture = await makeFixture();
    const original = await readFile(fixture.configPath, "utf8");
    const draft = original.replace("name: ui-fixture", "name: ui-fixture-edited");
    const server = await startControlPlaneServer({ repo: fixture.repoRoot, config: fixture.configPath, port: 0 });
    try {
      const response = await fetch(`${server.url}/api/config/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: draft })
      });
      const payload = await response.json();
      expect(response.status).toBe(200);
      expect(payload.ok).toBe(true);
      expect(payload.diff).toContain("-  name: ui-fixture");
      expect(payload.diff).toContain("+  name: ui-fixture-edited");
      await expect(readFile(fixture.configPath, "utf8")).resolves.toBe(original);
    } finally {
      await server.close();
    }
  });

  it("saves config drafts only with confirmation and records an audit entry", async () => {
    const fixture = await makeFixture();
    const draft = (await readFile(fixture.configPath, "utf8")).replace("name: ui-fixture", "name: ui-fixture-saved");
    const server = await startControlPlaneServer({ repo: fixture.repoRoot, config: fixture.configPath, port: 0 });
    try {
      const unconfirmed = await fetch(`${server.url}/api/config/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: draft, confirm: false })
      });
      expect(unconfirmed.status).toBe(400);

      const response = await fetch(`${server.url}/api/config/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: draft, confirm: true })
      });
      const payload = await response.json();
      expect(response.status).toBe(200);
      expect(payload.auditPath).toBe(".visual-hive/config-edits.json");
      await expect(readFile(fixture.configPath, "utf8")).resolves.toContain("name: ui-fixture-saved");
      await expect(readFile(path.join(fixture.repoRoot, ".visual-hive", "config-edits.json"), "utf8")).resolves.toContain("ui-fixture-saved");
    } finally {
      await server.close();
    }
  });

  it("writes recommended config from setup artifact when config is missing", async () => {
    const fixture = await makeFixture();
    await rm(fixture.configPath);
    const server = await startControlPlaneServer({ repo: fixture.repoRoot, config: fixture.configPath, port: 0 });
    try {
      const response = await fetch(`${server.url}/api/setup/write-config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true })
      });
      const responseText = await response.text();
      expect(response.status, responseText).toBe(200);
      const payload = JSON.parse(responseText);
      expect(payload.ok).toBe(true);
      expect(payload.overwritten).toBe(false);
      expect(payload.recommendationPath).toBe(".visual-hive/recommendations.json");
      await expect(readFile(fixture.configPath, "utf8")).resolves.toContain("name: ui-fixture");
      const audit = await readFile(path.join(fixture.repoRoot, ".visual-hive", "config-edits.json"), "utf8");
      expect(audit).toContain("setup-recommendation");
      const snapshot = await createControlPlaneSnapshot({ repo: fixture.repoRoot, config: fixture.configPath });
      expect(snapshot.config?.project.name).toBe("ui-fixture");
    } finally {
      await server.close();
    }
  });

  it("protects existing config from setup writes unless force is confirmed", async () => {
    const fixture = await makeFixture();
    const server = await startControlPlaneServer({ repo: fixture.repoRoot, config: fixture.configPath, port: 0 });
    try {
      const blocked = await fetch(`${server.url}/api/setup/write-config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true })
      });
      const blockedPayload = await blocked.json();
      expect(blocked.status).toBe(400);
      expect(blockedPayload.error).toContain("Refusing to overwrite existing Visual Hive config");

      const forced = await fetch(`${server.url}/api/setup/write-config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true, force: true })
      });
      const forcedPayload = await forced.json();
      expect(forced.status).toBe(200);
      expect(forcedPayload.overwritten).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("writes built-in workflow templates through the local API", async () => {
    const fixture = await makeFixture();
    const server = await startControlPlaneServer({ repo: fixture.repoRoot, config: fixture.configPath, port: 0 });
    try {
      const response = await fetch(`${server.url}/api/workflows/write-templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true, templateIds: ["scheduled"] })
      });
      const payload = await response.json();
      expect(response.status).toBe(200);
      expect(payload.written[0].path).toBe(".github/workflows/visual-hive-scheduled.yml");
      await expect(readFile(path.join(fixture.repoRoot, ".github", "workflows", "visual-hive-scheduled.yml"), "utf8")).resolves.toContain(
        "Visual Hive Scheduled"
      );
      const audit = await readFile(path.join(fixture.repoRoot, ".visual-hive", "workflow-edits.json"), "utf8");
      expect(audit).toContain("scheduled");

      const unknown = await fetch(`${server.url}/api/workflows/write-templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true, templateIds: ["missing-template"] })
      });
      const unknownPayload = await unknown.json();
      expect(unknown.status).toBe(400);
      expect(unknownPayload.error).toContain("Unknown Visual Hive workflow template id");
    } finally {
      await server.close();
    }
  });

  it("protects existing workflow templates unless force is confirmed", async () => {
    const fixture = await makeFixture();
    const workflowPath = path.join(fixture.repoRoot, ".github", "workflows", "visual-hive-pr.yml");
    const original = await readFile(workflowPath, "utf8");
    const server = await startControlPlaneServer({ repo: fixture.repoRoot, config: fixture.configPath, port: 0 });
    try {
      const blocked = await fetch(`${server.url}/api/workflows/write-templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true, templateIds: ["pull_request"] })
      });
      const blockedPayload = await blocked.json();
      expect(blocked.status).toBe(400);
      expect(blockedPayload.error).toContain("Refusing to overwrite existing workflow template");
      await expect(readFile(workflowPath, "utf8")).resolves.toBe(original);

      const forced = await fetch(`${server.url}/api/workflows/write-templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true, force: true, templateIds: ["pull_request"] })
      });
      const forcedPayload = await forced.json();
      expect(forced.status).toBe(200);
      expect(forcedPayload.written[0].overwritten).toBe(true);
      await expect(readFile(workflowPath, "utf8")).resolves.toContain("npx visual-hive plan --mode pr");
    } finally {
      await server.close();
    }
  });

  it("rejects invalid config drafts and blocks config saves in read-only mode", async () => {
    const fixture = await makeFixture();
    const invalidDraft = "project:\n  name: broken\ncontracts: []\ntargets: {}\n";
    const server = await startControlPlaneServer({ repo: fixture.repoRoot, config: fixture.configPath, port: 0, readOnly: true });
    try {
      const invalid = await fetch(`${server.url}/api/config/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: invalidDraft })
      });
      const invalidPayload = await invalid.json();
      expect(invalid.status).toBe(422);
      expect(invalidPayload.error).toContain("Invalid Visual Hive config");

      const blocked = await fetch(`${server.url}/api/config/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: invalidDraft, confirm: true })
      });
      expect(blocked.status).toBe(403);

      const setupBlocked = await fetch(`${server.url}/api/setup/write-config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true, force: true })
      });
      expect(setupBlocked.status).toBe(403);

      const workflowsBlocked = await fetch(`${server.url}/api/workflows/write-templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true, force: true })
      });
      expect(workflowsBlocked.status).toBe(403);
    } finally {
      await server.close();
    }
  });
});
