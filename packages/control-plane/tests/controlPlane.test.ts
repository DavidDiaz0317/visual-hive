import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { addConnection } from "@visual-hive/core";
import { createControlPlaneSnapshot, readControlPlaneArtifact, startControlPlaneServer } from "../src/index.js";

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
  await mkdir(path.join(repoRoot, ".visual-hive", "hive", "wiki"), { recursive: true });
  await mkdir(path.join(repoRoot, ".visual-hive", "snapshots"), { recursive: true });
  await mkdir(path.join(repoRoot, ".github", "workflows"), { recursive: true });
  const configPath = path.join(repoRoot, "visual-hive.config.yaml");
  const configYaml = `project:
  name: ui-fixture
  type: react-vite
  defaultBranch: main
targets:
  localPreview:
    kind: command
    serve: "npm run preview -- --port 4173"
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
        selectedTargets: [
          { id: "localPreview", kind: "url", url: "http://127.0.0.1:4173", prSafe: true, cost: "cheap" }
        ],
        selectedContracts: ["dashboard"],
        excludedContracts: [{ contractId: "admin", targetId: "protectedTarget", reasons: ["target.prSafe=false", "pass --allow-unsafe-targets to include this target"] }],
        targetLifecycle: [{ targetId: "localPreview", phase: "serve", status: "passed", durationMs: 42, url: "http://127.0.0.1:4173" }],
        generatedSpecPath: path.join(repoRoot, ".visual-hive", "generated", "visual-hive.generated.spec.ts"),
        results: [
          {
            contractId: "dashboard",
            targetId: "localPreview",
            status: "passed",
            durationMs: 10,
            errors: ["Known harmless warning was captured for evidence."],
            artifacts: [".visual-hive/artifacts/results/dashboard.json"],
            selectorAssertions: [
              { kind: "mustExist", value: "[data-testid='dashboard-page']", status: "passed" },
              { kind: "mustNotExist", value: "[data-testid='login-page']", status: "passed" }
            ],
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
                diffPath: path.join(repoRoot, ".visual-hive", "artifacts", "screenshots", "dashboard.diff.png"),
                maxDiffPixelRatio: 0.01,
                actualDiffPixelRatio: 0,
                actualDiffPixels: 0,
                diffPixels: 0,
                totalPixels: 100
              }
            ],
            consoleErrors: [{ type: "console", message: "ResizeObserver loop completed with undelivered notifications." }],
            pageErrors: [{ type: "page", message: "Ignored demo page error" }],
            networkErrors: [{ type: "network", url: "http://127.0.0.1:4173/api/demo", status: 500, statusText: "Internal Server Error" }],
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
          consoleErrors: 1,
          pageErrors: 1
        },
        consoleErrors: ["ResizeObserver loop completed with undelivered notifications."],
        pageErrors: [{ type: "page", message: "Ignored demo page error" }],
        artifacts: [".visual-hive/report.json", ".visual-hive/artifacts/results/dashboard.json"],
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
  await writeFile(
    path.join(repoRoot, ".visual-hive", "plan.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        project: "ui-fixture",
        mode: "pr",
        generatedAt: "2026-06-15T00:00:00.000Z",
        changedFiles: ["src/App.tsx"],
        effectiveChangedFiles: ["src/App.tsx"],
        ignoredChangedFiles: [],
        targets: [{ id: "localPreview", kind: "url", url: "http://127.0.0.1:4173", prSafe: true, cost: "cheap" }],
        items: [
          {
            contractId: "dashboard",
            targetId: "localPreview",
            targetUrl: "http://127.0.0.1:4173",
            severity: "high",
            cost: "cheap",
            reasons: ["runOn.pullRequest=true"],
            screenshots: ["dashboard:/:desktop"]
          }
        ],
        excluded: [],
        mutation: { enabled: false, operators: [], minScore: 0.7, reasons: ["mode=pr", "mutation not selected for this mode"] },
        providerPolicy: [
          {
            providerId: "playwright",
            label: "Playwright built-in",
            enabled: true,
            mode: "external",
            availability: "available",
            deterministicRole: "oracle",
            requiredEnv: [],
            missingEnv: [],
            externalUploadAllowed: true,
            externalUploadBlockedReasons: [],
            estimatedExternalScreenshots: 1,
            externalCallsPlanned: 0,
            reasons: ["Visual Hive owns the deterministic verdict; Playwright is the default local evidence runner."]
          },
          {
            providerId: "argos",
            label: "Argos",
            enabled: false,
            mode: "external",
            availability: "disabled",
            deterministicRole: "supplemental",
            requiredEnv: ["ARGOS_TOKEN"],
            missingEnv: ["ARGOS_TOKEN"],
            externalUploadAllowed: false,
            externalUploadBlockedReasons: ["costPolicy.externalUpload.pullRequest=false for pr mode."],
            estimatedExternalScreenshots: 1,
            externalCallsPlanned: 0,
            reasons: ["Provider is disabled in config.", "No external provider network calls are planned by the default Visual Hive planner."]
          }
        ]
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    path.join(repoRoot, ".visual-hive", "plans.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        project: "ui-fixture",
        generatedAt: "2026-06-15T00:00:00.000Z",
        planCount: 2,
        summary: {
          modes: ["canary", "pr"],
          selectedContracts: 1,
          selectedTargets: 1,
          emptyPlans: 0,
          reviewPlans: 1,
          unsafeExcludedContracts: 1,
          expensiveTargets: 0,
          mutationEnabledPlans: 0,
          externalCallsPlanned: 0
        },
        lanes: [
          {
            path: ".visual-hive/plan.json",
            mode: "pr",
            generatedAt: "2026-06-15T00:00:00.000Z",
            changedFiles: 1,
            effectiveChangedFiles: 1,
            ignoredChangedFiles: 0,
            selectedContracts: ["dashboard"],
            selectedTargets: ["localPreview"],
            excludedContracts: 1,
            unsafeExcludedContracts: 1,
            expensiveTargets: [],
            mutationEnabled: false,
            mutationOperators: [],
            externalCallsPlanned: 0,
            providerPolicyBlocked: [],
            status: "review",
            reasons: ["1 non-PR-safe contract(s) excluded."]
          },
          {
            path: ".visual-hive/plan.canary.json",
            mode: "canary",
            generatedAt: "2026-06-15T00:00:00.000Z",
            changedFiles: 0,
            effectiveChangedFiles: 0,
            ignoredChangedFiles: 0,
            selectedContracts: ["dashboard"],
            selectedTargets: ["localPreview"],
            excludedContracts: 0,
            unsafeExcludedContracts: 0,
            expensiveTargets: [],
            mutationEnabled: false,
            mutationOperators: [],
            externalCallsPlanned: 0,
            providerPolicyBlocked: [],
            status: "ready",
            reasons: []
          }
        ],
        recommendations: ["Keep non-PR-safe targets out of untrusted lanes."]
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
        recommendations: ["Never use LLM output as a verdict authority."]
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
              notes: ["Playwright is the default first-party local browser runner for Visual Hive verdict evidence."]
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
    path.join(repoRoot, ".visual-hive", "provider-handoff.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        project: "ui-fixture",
        generatedAt: "2026-06-15T00:00:00.000Z",
        providerId: "argos",
        label: "Argos",
        status: "review",
        deterministicStatus: "passed",
        mode: "manual",
        externalCallsMade: 0,
        readiness: {
          enabled: true,
          providerMode: "mock",
          availability: "mock",
          deterministicRole: "supplemental",
          requiredEnv: ["ARGOS_TOKEN"],
          missingEnv: [],
          externalUploadAllowed: true,
          externalUploadBlockedReasons: [],
          projectIdConfigured: true
        },
        summary: {
          totalArtifacts: 3,
          screenshotArtifacts: 1,
          diffArtifacts: 1,
          eligibleArtifacts: 0,
          blockedArtifacts: 3,
          estimatedExternalScreenshots: 1,
          maxExternalScreenshotsPerRun: 10
        },
        artifacts: [
          {
            path: ".visual-hive/artifacts/screenshots/dashboard.png",
            kind: "actual_screenshot",
            contractId: "dashboard",
            screenshotName: "desktop",
            route: "/",
            viewport: "desktop",
            screenshotStatus: "failed",
            eligibleForUpload: false,
            blockedReasons: ["Provider is in mock mode; the handoff is review-only and will not upload externally."]
          },
          {
            path: ".visual-hive/artifacts/screenshots/dashboard.diff.png",
            kind: "diff_screenshot",
            contractId: "dashboard",
            screenshotName: "desktop",
            route: "/",
            viewport: "desktop",
            screenshotStatus: "failed",
            eligibleForUpload: false,
            blockedReasons: ["Provider is in mock mode; the handoff is review-only and will not upload externally."]
          }
        ],
        trustedWorkflowSteps: ["Run visual-hive plan/run first so Visual Hive can produce deterministic verdict evidence."],
        validationCommands: ["visual-hive providers handoff --provider argos"],
        warnings: ["This manifest made zero external calls and does not upload screenshots."]
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
            reason: "Default local browser evidence runner. No paid account or external upload is required.",
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
        setupActions: [
          {
            id: "use-free-local-setup",
            label: "Use free local setup",
            category: "profile",
            description: "Regenerate recommendations for local artifacts.",
            command: "visual-hive recommend --profile free-local --write-setup-bundle",
            recommended: true,
            requiresConfirmation: true,
            writes: ["visual-hive.config.yaml", ".github/workflows/visual-hive-pr.yml"],
            safetyNotes: ["No external provider upload is enabled."],
            outcome: "Creates a guarded local-first setup bundle."
          },
          {
            id: "skip-provider-for-now",
            label: "Skip provider for now",
            category: "provider",
            description: "Record local provider governance.",
            command: "visual-hive providers decision --provider argos --decision skip --reason \"Playwright artifacts are enough\"",
            recommended: true,
            requiresConfirmation: false,
            writes: [".visual-hive/provider-decisions.json"],
            safetyNotes: ["Does not create credentials or upload screenshots."],
            outcome: "Keeps the default provider posture explicit."
          }
        ],
        workflowPreviews: [
          {
            id: "pull_request",
            label: "Visual Hive PR",
            path: ".github/workflows/visual-hive-pr.yml",
            description: "Read-only, no-secret PR validation for PR-safe deterministic contracts.",
            safetyNotes: ["Uses pull_request, not pull_request_target.", "Uses contents: read only."],
            content: "name: Visual Hive PR\non:\n  pull_request:\npermissions:\n  contents: read\n"
          },
          {
            id: "trusted_failure_issue",
            label: "Visual Hive Failure Issue",
            path: ".github/workflows/visual-hive-failure-issue.yml",
            description: "Trusted workflow_run issue creation from sanitized artifacts.",
            safetyNotes: ["Does not checkout or execute PR code."],
            content: "name: Visual Hive Failure Issue\non:\n  workflow_run:\n"
          }
        ],
        recommendedConfig: {},
        recommendedConfigYaml: configYaml,
        detectedSelectors: [{ selector: "[data-testid='dashboard-page']", sourceFile: "src/App.tsx", occurrences: 1 }],
        detectedRoutes: [
          {
            route: "/clusters",
            sourceFile: "src/App.tsx",
            occurrences: 1
          },
          {
            route: "/settings",
            sourceFile: "src/routes.tsx",
            occurrences: 2
          }
        ],
        detectedStories: [
          {
            storyFile: "src/components/DashboardCard.stories.tsx",
            title: "dashboard/DashboardCard",
            exports: ["Primary", "Loading"],
            route: "/iframe.html?id=dashboard-dashboardcard--primary&viewMode=story"
          }
        ],
        detectedWorkflows: [
          {
            path: ".github/workflows/legacy.yml",
            triggers: ["pull_request_target"],
            permissions: ["contents: write"],
            usesPullRequestTarget: true,
            usesSecrets: true,
            visualHiveRelated: false
          },
          {
            path: ".github/workflows/visual-hive-pr.yml",
            triggers: ["pull_request"],
            permissions: ["contents: read"],
            usesPullRequestTarget: false,
            usesSecrets: false,
            visualHiveRelated: true
          }
        ],
        playwright: {
          status: "present",
          dependencies: ["@playwright/test"],
          scripts: ["test:e2e: playwright test"],
          configFiles: ["playwright.config.ts"],
          notes: ["Dependencies detected: @playwright/test", "Playwright scripts detected: test:e2e", "Config files detected: playwright.config.ts"]
        },
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
    path.join(repoRoot, ".visual-hive", "setup-pr-plan.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        project: "ui-fixture",
        generatedAt: "2026-06-15T00:00:00.000Z",
        sourceRecommendationGeneratedAt: "2026-06-15T00:00:00.000Z",
        setupProfile: "free-local",
        status: "review",
        title: "Add Visual Hive deterministic visual QA",
        summary: {
          filesPlanned: 5,
          workflowsPlanned: 2,
          validationCommands: 2,
          externalCallsMade: 0,
          requiresReview: true,
          blockedReasons: []
        },
        files: [
          { path: "visual-hive.config.yaml", kind: "config", action: "create", source: "setupPullRequest.files", requiresOverwriteReview: true },
          { path: ".github/workflows/visual-hive-pr.yml", kind: "workflow", action: "create", source: "setupPullRequest.files", requiresOverwriteReview: true },
          { path: ".visual-hive/setup-pr-plan.json", kind: "audit", action: "audit", source: "visual-hive", requiresOverwriteReview: false }
        ],
        workflowPreviews: [
          {
            id: "pull_request",
            label: "Visual Hive PR",
            path: ".github/workflows/visual-hive-pr.yml",
            description: "Read-only PR validation.",
            safetyNotes: ["Uses pull_request, not pull_request_target."]
          }
        ],
        providerDecisions: [
          {
            providerId: "argos",
            label: "Argos",
            recommendation: "future",
            requiredEnv: ["ARGOS_TOKEN"],
            externalUploadAllowedByDefault: false
          }
        ],
        validationCommands: ["visual-hive doctor", "visual-hive run"],
        steps: [
          {
            id: "review-recommendation",
            title: "Review setup recommendation and generated config",
            status: "review",
            command: "visual-hive recommend",
            writes: [".visual-hive/recommendations.json", ".visual-hive/setup-pr-plan.json"],
            safetyNotes: ["No external calls are made."]
          },
          {
            id: "write-setup-files",
            title: "Write config, docs, and safe workflow templates",
            status: "review",
            command: "visual-hive recommend --write-setup-bundle",
            writes: ["visual-hive.config.yaml", ".github/workflows/visual-hive-pr.yml"],
            safetyNotes: ["Review generated files before writing."]
          }
        ],
        security: {
          pullRequestPermissions: ["contents: read"],
          pullRequestSecretsRequired: [],
          scheduledSecretsRequired: [],
          generatedWorkflowsUsePullRequestTarget: false,
          generatedPrWorkflowUsesSecrets: false,
          externalUploadsInPullRequest: false,
          issueCreationFromUntrustedPr: false,
          notes: ["PR setup must use pull_request with read-only permissions and no secrets."]
        },
        warnings: ["Setup PR files should be reviewed before writing."]
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
  await writeFile(
    path.join(repoRoot, ".visual-hive", "risk.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        project: "ui-fixture",
        generatedAt: "2026-06-15T00:00:00.000Z",
        summary: {
          total: 1,
          critical: 0,
          high: 0,
          medium: 0,
          low: 1,
          riskScore: 2,
          highestSeverity: "low",
          prBlocking: 0,
          trustedOnly: 0
        },
        inputs: {
          plan: true,
          report: true,
          mutationReport: false,
          coverageReport: true,
          targetAudit: true,
          contractAudit: true,
          flowAudit: true,
          scheduleAudit: true,
          workflowAudit: true
        },
        risks: [
          {
            id: "coverage:viewport:tablet",
            category: "coverage_gap",
            severity: "low",
            title: "Coverage gap: viewport_without_screenshots",
            message: "Tablet viewport is configured but has no screenshot coverage.",
            evidence: ["tablet"],
            contractIds: ["dashboard"],
            targetIds: ["localPreview"],
            artifacts: [".visual-hive/coverage.json", ".visual-hive/report.json"],
            suggestedActions: ["Add a tablet screenshot if this viewport matters."],
            prBlocking: false,
            trustedOnly: false
          }
        ],
        recommendations: ["Add contracts or changed-file rules for uncovered high-risk areas."]
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    path.join(repoRoot, ".visual-hive", "mutation-report.json"),
    JSON.stringify(
      {
        schemaVersion: 2,
        project: "ui-fixture",
        generatedAt: "2026-06-15T00:00:00.000Z",
        minScore: 0.75,
        score: 0.5,
        killed: 1,
        total: 2,
        results: [
          {
            operator: "force-login-on-demo",
            status: "killed",
            killed: true,
            contractIds: ["dashboard"],
            applicable: true,
            expectedFailureKinds: ["unexpected_element", "login_regression"],
            failureKind: "unexpected_element",
            failedAssertion: "[data-testid='login-page'] became visible",
            durationMs: 1200,
            errors: [],
            artifacts: [".visual-hive/artifacts/results/force-login-on-demo.json"]
          },
          {
            operator: "remove-demo-badge",
            status: "survived",
            killed: false,
            contractIds: ["dashboard"],
            applicable: true,
            expectedFailureKinds: ["missing_element"],
            failureKind: "missing_element",
            durationMs: 900,
            errors: ["No assertion failed for missing demo badge."],
            artifacts: [".visual-hive/mutation-report.json"]
          },
          {
            operator: "hidden-error-banner",
            status: "not_applicable",
            killed: false,
            contractIds: [],
            applicable: false,
            expectedFailureKinds: ["missing_element"],
            durationMs: 10,
            errors: []
          },
          {
            operator: "api-500",
            status: "error",
            killed: false,
            contractIds: ["dashboard"],
            applicable: true,
            expectedFailureKinds: ["api_contract_regression"],
            durationMs: 200,
            errors: ["Mutation runner failed before assertions completed."]
          }
        ]
      },
      null,
      2
    ),
    "utf8"
  );
  const evidenceContributions = [
    {
      key: "playwright.deterministic_run.dashboard",
      source: "playwright",
      kind: "deterministic_run",
      status: "failed",
      gating: true,
      authority: "gating",
      mode: "pr",
      contractId: "dashboard",
      reason: "Deterministic contract run failed.",
      artifacts: [".visual-hive/report.json"]
    },
    {
      key: "mutation.mutation_adequacy.remove-demo-badge",
      source: "mutation",
      kind: "mutation_adequacy",
      status: "failed",
      gating: true,
      authority: "gating",
      operator: "remove-demo-badge",
      reason: "Mutation remove-demo-badge survived.",
      artifacts: [".visual-hive/mutation-report.json"]
    },
    {
      key: "triage.insufficient_coverage",
      source: "triage",
      kind: "insufficient_coverage",
      status: "skipped",
      gating: false,
      authority: "advisory",
      reason: "Coverage recommendation is advisory.",
      artifacts: [".visual-hive/triage.json"]
    }
  ];
  const verdictSummary = {
    visualHiveVerdict: "failed",
    failedBecause: ["playwright.deterministic_run.dashboard", "mutation.mutation_adequacy.remove-demo-badge"],
    warningBecause: [],
    blockedBecause: [],
    advisoryOnly: ["triage.insufficient_coverage"]
  };
  const testingLayers = [
    { id: 0, name: "Repo intelligence", status: "covered", evidence: [".visual-hive/repo-map.json"], gaps: [] },
    { id: 3, name: "Component/accessibility", status: "unknown", evidence: [], gaps: ["Accessibility evidence is not yet normalized."] },
    { id: 9, name: "Mutation/fault injection", status: "partial", evidence: [".visual-hive/mutation-report.json"], gaps: ["One mutation survived."] }
  ];
  const handoffWorkItems = [
    {
      id: "mutation-remove-demo-badge-dashboard",
      kind: "test_creation",
      priority: "high",
      title: "Strengthen demo badge contract",
      summary: "The remove-demo-badge mutation survived and needs deterministic coverage.",
      evidenceKeys: ["mutation.mutation_adequacy.remove-demo-badge"],
      artifacts: [".visual-hive/mutation-report.json", ".visual-hive/evidence-packet.json"],
      suggestedNextSteps: ["Add a selector assertion for [data-testid='demo-badge'].", "Rerun Visual Hive mutation checks."]
    }
  ];
  await writeFile(
    path.join(repoRoot, ".visual-hive", "evidence-packet.json"),
    JSON.stringify(
      {
        schemaVersion: "visual-hive.evidence-packet.v2",
        generatedAt: "2026-06-15T00:00:00.000Z",
        project: "ui-fixture",
        sourceArtifacts: {
          plan: ".visual-hive/plan.json",
          report: ".visual-hive/report.json",
          mutationReport: ".visual-hive/mutation-report.json",
          triageReport: ".visual-hive/triage.json"
        },
        governance: {
          verdictAuthority: "visual_hive",
          defaultBrowserBackend: "playwright",
          llmAuthority: "advisory_only",
          providerAuthority: "policy_gated_when_normalized",
          secretPolicy: "redacted_values_names_only"
        },
        repo: { repository: "local/ui-fixture", branch: "main", runContext: "test" },
        plan: {
          schemaVersion: 1,
          project: "ui-fixture",
          mode: "pr",
          generatedAt: "2026-06-15T00:00:00.000Z",
          changedFiles: ["src/App.tsx"],
          effectiveChangedFiles: ["src/App.tsx"],
          selectedContracts: ["dashboard"],
          selectedTargets: ["localPreview"],
          excludedContracts: []
        },
        deterministicReport: {
          schemaVersion: 2,
          project: "ui-fixture",
          mode: "pr",
          generatedAt: "2026-06-15T00:00:00.000Z",
          status: "failed",
          selectedTargets: [{ id: "localPreview", kind: "url", url: "http://127.0.0.1:4173", prSafe: true, cost: "cheap", missingSecrets: [] }],
          selectedContracts: ["dashboard"],
          excludedContracts: [],
          summary: { passed: 0, failed: 1, screenshotsPassed: 0, screenshotsFailed: 1, baselinesCreated: 0, missingBaselines: 0, visualDiffs: 1, consoleErrors: 0, pageErrors: 0 },
          generatedSpecPath: ".visual-hive/generated/visual-hive.generated.spec.ts",
          reproductionCommands: ["visual-hive run"],
          failedContracts: [{ contractId: "dashboard", targetId: "localPreview", errors: ["Missing selector"], artifacts: [".visual-hive/report.json"], reproductionCommand: "visual-hive run" }],
          screenshotEvidence: [],
          consoleErrors: 0,
          pageErrors: 0,
          networkErrors: 1
        },
        mutation: {
          schemaVersion: 2,
          project: "ui-fixture",
          generatedAt: "2026-06-15T00:00:00.000Z",
          minScore: 0.75,
          score: 0.5,
          killed: 1,
          total: 2,
          survivedOperators: [{ operator: "remove-demo-badge", contractIds: ["dashboard"], artifacts: [".visual-hive/mutation-report.json"] }],
          notApplicableOperators: ["hidden-error-banner"]
        },
        providers: [],
        testingLayers,
        evidenceContributions,
        verdictSummary,
        hiveReadiness: {
          readyForIssueHandoff: true,
          readyForHiveDryRun: true,
          blockedReasons: [],
          suggestedLabels: ["visual-hive", "hive/quality", "ai-ready"]
        }
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(path.join(repoRoot, ".visual-hive", "evidence-summary.md"), "# Evidence Summary\n", "utf8");
  await writeFile(
    path.join(repoRoot, ".visual-hive", "verdict.json"),
    JSON.stringify(
      {
        schemaVersion: "visual-hive.verdict.v1",
        generatedAt: "2026-06-15T00:00:00.000Z",
        project: "ui-fixture",
        sourceArtifacts: { evidencePacket: ".visual-hive/evidence-packet.json" },
        governance: {
          verdictAuthority: "visual_hive",
          defaultBrowserBackend: "playwright",
          llmAuthority: "advisory_only",
          providerAuthority: "policy_gated_when_normalized",
          secretPolicy: "redacted_values_names_only"
        },
        policy: {
          passFailOwnedBy: "visual_hive_verdict_engine",
          deterministicSources: ["playwright", "mutation"],
          advisorySources: ["triage", "llm", "agent"],
          providerGating: "explicit_normalized_trusted_budget_authorized",
          mutationGating: "configured_threshold"
        },
        summary: {
          ...verdictSummary,
          totalContributions: 3,
          gatingContributions: 2,
          advisoryContributions: 1,
          failedContributions: 2,
          blockedContributions: 0,
          warningContributions: 0,
          inconclusiveContributions: 0,
          passedContributions: 0,
          skippedContributions: 1
        },
        gatingContributions: evidenceContributions.filter((contribution) => contribution.gating).map((contribution) => ({ ...contribution, key: `${contribution.source}.${contribution.kind}.${contribution.contractId ?? contribution.operator}` })),
        advisoryContributions: evidenceContributions.filter((contribution) => !contribution.gating).map((contribution) => ({ ...contribution, key: `${contribution.source}.${contribution.kind}` })),
        allContributions: evidenceContributions.map((contribution) => ({ ...contribution, key: `${contribution.source}.${contribution.kind}.${contribution.contractId ?? contribution.operator ?? "advisory"}` }))
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(path.join(repoRoot, ".visual-hive", "verdict.md"), "# Visual Hive Verdict\n", "utf8");
  await writeFile(
    path.join(repoRoot, ".visual-hive", "handoff.json"),
    JSON.stringify(
      {
        schemaVersion: "visual-hive.handoff.v1",
        generatedAt: "2026-06-15T00:00:00.000Z",
        project: "ui-fixture",
        mode: "dry_run",
        status: "ready",
        externalCallsMade: 0,
        sourceEvidencePacket: ".visual-hive/evidence-packet.json",
        labels: ["visual-hive", "hive/quality", "ai-ready"],
        verdict: verdictSummary,
        governance: {
          verdictAuthority: "visual_hive",
          handoffAuthority: "advisory_repair_routing",
          networkPolicy: "no_network_calls_in_dry_run",
          secretPolicy: "redacted_values_names_only",
          requiresHumanApprovalFor: ["github_issue_creation", "hive_bead_creation", "provider_upload_enablement"]
        },
        workItems: handoffWorkItems,
        githubIssue: {
          title: "[Visual Hive] ui-fixture failed evidence handoff",
          labels: ["visual-hive", "hive/quality", "ai-ready"],
          bodyPath: ".visual-hive/hive-issue.md",
          dedupeSignature: "visual-hive-test",
          trustedWorkflowRequired: true
        },
        hiveBeadRequest: {
          dryRun: true,
          requestPath: ".visual-hive/hive-bead-request.json",
          agent: "quality",
          labels: ["visual-hive", "hive/quality", "ai-ready"],
          evidencePacketPath: ".visual-hive/evidence-packet.json",
          handoffPacketPath: ".visual-hive/handoff.json"
        },
        blockedReasons: []
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(path.join(repoRoot, ".visual-hive", "hive-issue.md"), "# Hive Issue\n", "utf8");
  await writeFile(path.join(repoRoot, ".visual-hive", "hive-bead-request.json"), JSON.stringify({ schemaVersion: "visual-hive.hive-bead-request.v1", dryRun: true, externalCallsMade: 0 }, null, 2), "utf8");
  await writeFile(path.join(repoRoot, ".visual-hive", "hive-handoff-result.json"), JSON.stringify({ schemaVersion: "visual-hive.hive-handoff-result.v1", status: "dry_run_written", externalCallsMade: 0 }, null, 2), "utf8");
  const hiveBeads = [
    {
      id: "vhb-mutation-remove-demo-badge-dashboard",
      title: "Strengthen demo badge contract",
      type: "task",
      status: "open",
      priority: 80,
      actor: "quality",
      external_ref: "visual-hive:mutation-remove-demo-badge-dashboard",
      metadata: { project: "ui-fixture", source: "visual-hive" },
      notes: "The remove-demo-badge mutation survived and needs deterministic coverage.",
      created_at: "2026-06-15T00:00:00.000Z",
      updated_at: "2026-06-15T00:00:00.000Z",
      depends_on: []
    }
  ];
  const hiveKnowledgeFacts = [
    {
      slug: "mutation-remove-demo-badge-survived",
      title: "Demo badge mutation survived",
      type: "coverage_rule",
      layer: "project",
      confidence: 0.9,
      tags: ["visual-hive", "mutation"],
      source: ".visual-hive/evidence-packet.json",
      body: "Add a deterministic selector assertion for the demo badge so remove-demo-badge is killed.",
      relatedEvidenceKeys: ["mutation.mutation_adequacy.remove-demo-badge"],
      artifacts: [".visual-hive/mutation-report.json"]
    }
  ];
  const hiveKnowledgeGraph = {
    schemaVersion: "visual-hive.hive-knowledge-graph.v1",
    nodes: [
      { id: "bead:vhb-mutation-remove-demo-badge-dashboard", slug: "vhb-mutation-remove-demo-badge-dashboard", title: "Strengthen demo badge contract", type: "bead", tags: ["visual-hive"] },
      { id: "fact:mutation-remove-demo-badge-survived", slug: "mutation-remove-demo-badge-survived", title: "Demo badge mutation survived", type: "coverage_rule", layer: "project", confidence: 0.9, tags: ["mutation"] }
    ],
    edges: [{ from: "bead:vhb-mutation-remove-demo-badge-dashboard", to: "fact:mutation-remove-demo-badge-survived", predicate: "derived_from" }]
  };
  const hiveRepairWorkOrders = [
    {
      id: "repair-vhb-mutation-remove-demo-badge-dashboard",
      actor: "quality",
      title: "Strengthen demo badge contract",
      objective: "Add or strengthen deterministic Visual Hive coverage so the survived mutation is killed.",
      sourceBeadIds: ["vhb-mutation-remove-demo-badge-dashboard"],
      evidenceKeys: ["mutation.mutation_adequacy.remove-demo-badge"],
      likelyFiles: ["src/App.tsx"],
      artifacts: [".visual-hive/evidence-packet.json", ".visual-hive/mutation-report.json"],
      reproductionCommands: ["visual-hive mutate"],
      acceptanceCriteria: ["Visual Hive verdict passes after repair.", "The survived mutation is killed on rerun."],
      allowedActions: ["edit_tests", "edit_visual_hive_config", "open_pull_request"],
      forbiddenActions: ["decide_visual_hive_verdict", "read_secret_values", "auto_merge_without_visual_hive_pass"],
      maxAttempts: 1,
      branchPrefix: "hive/visual-hive-",
      prOnly: true,
      requireHumanReview: true,
      rerunVisualHive: true
    }
  ];
  const hiveAgentPolicy = {
    schemaVersion: "visual-hive.hive-agent-policy.v1",
    mode: "repair_request",
    acmmLevel: 3,
    enabled: true,
    externalCallsMade: 0,
    verdictAuthority: "visual_hive",
    hiveAuthority: "advisory_or_guarded_repair",
    repair: {
      enabled: true,
      prOnly: true,
      maxAttempts: 1,
      requireHumanReview: true,
      rerunVisualHive: true,
      branchPrefix: "hive/visual-hive-"
    },
    allowedActions: ["create_issue_context", "create_bead_payload", "create_repair_work_order"],
    forbiddenActions: ["decide_visual_hive_verdict", "read_secret_values", "auto_merge_without_visual_hive_pass"],
    trustedWorkflowRequiredFor: ["github_issue_creation", "hive_bead_creation", "guarded_repair"],
    finalValidation: {
      required: true,
      command: "visual-hive verdict --config visual-hive.config.yaml",
      passFailOwnedBy: "visual_hive_verdict_engine"
    }
  };
  const hiveExport = {
    schemaVersion: "visual-hive.hive-export.v1",
    generatedAt: "2026-06-15T00:00:00.000Z",
    project: "ui-fixture",
    status: "ready",
    externalCallsMade: 0,
    mode: "repair_request",
    configuredMode: "repair_request",
    acmmLevel: 3,
    sourceArtifacts: {
      evidencePacket: ".visual-hive/evidence-packet.json",
      handoffPacket: ".visual-hive/handoff.json"
    },
    outputArtifacts: {
      export: ".visual-hive/hive/hive-export.json",
      beads: ".visual-hive/hive/beads.json",
      knowledgeFacts: ".visual-hive/hive/knowledge-facts.json",
      knowledgeGraph: ".visual-hive/hive/knowledge-graph.json",
      issueContext: ".visual-hive/hive/issue-context.md",
      repairWorkOrders: ".visual-hive/hive/repair-work-orders.json",
      agentPolicy: ".visual-hive/hive/hive-agent-policy.json",
      wikiVaultDir: ".visual-hive/hive/wiki"
    },
    governance: {
      verdictAuthority: "visual_hive",
      defaultMode: "advisory_no_network",
      repairAuthority: "hive_may_open_pr_only_when_trusted_policy_allows",
      validationRequired: "visual_hive_must_rerun_after_repair",
      secretPolicy: "redacted_values_names_only"
    },
    summary: {
      beads: hiveBeads.length,
      knowledgeFacts: hiveKnowledgeFacts.length,
      graphNodes: hiveKnowledgeGraph.nodes.length,
      graphEdges: hiveKnowledgeGraph.edges.length,
      repairWorkOrders: hiveRepairWorkOrders.length,
      blockedReasons: 0
    },
    labels: ["visual-hive", "hive/quality", "ai-ready"],
    beads: hiveBeads,
    knowledgeFacts: hiveKnowledgeFacts,
    knowledgeGraph: hiveKnowledgeGraph,
    repairWorkOrders: hiveRepairWorkOrders,
    agentPolicy: hiveAgentPolicy,
    blockedReasons: []
  };
  await writeFile(path.join(repoRoot, ".visual-hive", "hive", "hive-export.json"), JSON.stringify(hiveExport, null, 2), "utf8");
  await writeFile(path.join(repoRoot, ".visual-hive", "hive", "beads.json"), JSON.stringify(hiveBeads, null, 2), "utf8");
  await writeFile(path.join(repoRoot, ".visual-hive", "hive", "knowledge-facts.json"), JSON.stringify(hiveKnowledgeFacts, null, 2), "utf8");
  await writeFile(path.join(repoRoot, ".visual-hive", "hive", "knowledge-graph.json"), JSON.stringify(hiveKnowledgeGraph, null, 2), "utf8");
  await writeFile(path.join(repoRoot, ".visual-hive", "hive", "repair-work-orders.json"), JSON.stringify(hiveRepairWorkOrders, null, 2), "utf8");
  await writeFile(path.join(repoRoot, ".visual-hive", "hive", "hive-agent-policy.json"), JSON.stringify(hiveAgentPolicy, null, 2), "utf8");
  await writeFile(path.join(repoRoot, ".visual-hive", "hive", "issue-context.md"), "# Hive Issue Context\n", "utf8");
  await writeFile(path.join(repoRoot, ".visual-hive", "hive", "wiki", "mutation-remove-demo-badge-survived.md"), "---\ntitle: Demo badge mutation survived\n---\n", "utf8");
  await writeFile(
    path.join(repoRoot, ".visual-hive", "agent-packet.json"),
    JSON.stringify(
      {
        schemaVersion: "visual-hive.agent-packet.v1",
        generatedAt: "2026-06-15T00:00:00.000Z",
        project: "ui-fixture",
        profile: "repair_agent",
        objective: "Strengthen deterministic coverage for the survived demo badge mutation.",
        sourceArtifacts: {
          evidencePacket: ".visual-hive/evidence-packet.json",
          handoffPacket: ".visual-hive/handoff.json",
          testCreationPlan: ".visual-hive/test-creation-plan.json"
        },
        verdict: verdictSummary,
        evidenceSummary: {
          gatingContributions: evidenceContributions.filter((contribution) => contribution.gating),
          advisoryContributions: evidenceContributions.filter((contribution) => !contribution.gating),
          workItems: handoffWorkItems,
          selectedContracts: ["dashboard"],
          selectedTargets: ["localPreview"],
          mutationScore: 0.5,
          testingLayers,
          testCreationRecommendations: []
        },
        allowedTools: [{ id: "visual_hive_read_evidence_packet", label: "Read Evidence Packet", access: "read_only", reason: "Primary sanitized evidence source." }],
        forbiddenActions: ["decide_visual_hive_verdict", "read_secret_values", "approve_baselines_without_human_review"],
        budgets: { maxToolCalls: 20, maxToolResultTokens: 12000, maxExternalCostUsd: 0, allowExternalNetwork: false },
        reproductionCommands: ["visual-hive run", "visual-hive mutate"],
        artifactPointers: [".visual-hive/evidence-packet.json", ".visual-hive/handoff.json", ".visual-hive/test-creation-plan.json"],
        instructions: ["Use the Evidence Packet as the source of truth.", "Do not decide pass/fail."],
        governance: {
          verdictAuthority: "visual_hive",
          agentAuthority: "advisory_repair_only",
          secretPolicy: "redacted_values_names_only",
          requireHumanApprovalFor: ["github_issue_creation", "hive_bead_creation", "provider_upload_enablement"]
        }
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    path.join(repoRoot, ".visual-hive", "test-creation-plan.json"),
    JSON.stringify(
      {
        schemaVersion: "visual-hive.test-creation-plan.v1",
        generatedAt: "2026-06-15T00:00:00.000Z",
        project: "ui-fixture",
        sourceArtifacts: {
          evidencePacket: ".visual-hive/evidence-packet.json",
          coverageRecommendations: ".visual-hive/coverage-recommendations.json",
          handoffPacket: ".visual-hive/handoff.json"
        },
        governance: {
          verdictAuthority: "visual_hive",
          agentAuthority: "advisory_test_generation_only",
          writePolicy: "no_config_or_test_files_written",
          secretPolicy: "redacted_values_names_only"
        },
        summary: {
          total: 2,
          high: 1,
          medium: 1,
          low: 0,
          fromTestingLayers: 1,
          fromCoverageRecommendations: 0,
          fromMutationSurvivors: 1,
          fromHandoffWorkItems: 0
        },
        recommendations: [
          {
            id: "mutation-remove-demo-badge-dashboard",
            source: "mutation_survivor",
            kind: "mutation_mapping",
            priority: "high",
            title: "Strengthen demo badge contract",
            rationale: ["The remove-demo-badge mutation survived and needs deterministic coverage."],
            contractId: "dashboard",
            mutationOperator: "remove-demo-badge",
            suggestedTests: ["Assert [data-testid='demo-badge'] remains visible on dashboard cards."],
            suggestedConfigYaml: "selectors:\n  mustExist:\n    - \"[data-testid='demo-badge']\"",
            artifacts: [".visual-hive/mutation-report.json"],
            trustedOnly: false,
            applyMode: "advisory_no_write"
          },
          {
            id: "layer-3-unknown",
            source: "testing_layer",
            kind: "accessibility_check",
            priority: "medium",
            title: "Add accessibility evidence",
            rationale: ["Accessibility evidence is not yet normalized."],
            layer: { id: 3, name: "Component/accessibility", status: "unknown" },
            suggestedTests: ["Add deterministic accessibility checks for the dashboard shell."],
            artifacts: [".visual-hive/testing-layers.json"],
            trustedOnly: false,
            applyMode: "advisory_no_write"
          }
        ]
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(path.join(repoRoot, ".visual-hive", "test-creation-plan.md"), "# Visual Hive Test Creation Plan\n", "utf8");
  await writeFile(
    path.join(repoRoot, ".visual-hive", "pipeline.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        project: "ui-fixture",
        mode: "pr",
        generatedAt: "2026-06-15T00:00:00.000Z",
        status: "passed",
        exitCode: 0,
        options: {
          ci: true,
          bootstrapBaselines: false,
          enforceMutation: false,
          continueOnError: true,
          skipInstall: true,
          skipBuild: true
        },
        steps: [
          {
            id: "run",
            label: "Deterministic Run",
            status: "passed",
            startedAt: "2026-06-15T00:00:00.000Z",
            completedAt: "2026-06-15T00:00:01.000Z",
            durationMs: 1000,
            exitCode: 0,
            artifacts: [".visual-hive/report.json"]
          },
          {
            id: "evidence",
            label: "Evidence Packet",
            status: "passed",
            startedAt: "2026-06-15T00:00:01.000Z",
            completedAt: "2026-06-15T00:00:02.000Z",
            durationMs: 1000,
            exitCode: 0,
            artifacts: [".visual-hive/evidence-packet.json"]
          },
          {
            id: "handoff",
            label: "Hive Handoff Dry Run",
            status: "passed",
            startedAt: "2026-06-15T00:00:02.000Z",
            completedAt: "2026-06-15T00:00:03.000Z",
            durationMs: 1000,
            exitCode: 0,
            artifacts: [".visual-hive/handoff.json", ".visual-hive/hive-handoff-result.json"]
          },
          {
            id: "hive-export",
            label: "Hive Native Export",
            status: "passed",
            startedAt: "2026-06-15T00:00:03.000Z",
            completedAt: "2026-06-15T00:00:04.000Z",
            durationMs: 1000,
            exitCode: 0,
            artifacts: [".visual-hive/hive/hive-export.json", ".visual-hive/hive/repair-work-orders.json"]
          }
        ],
        artifacts: [
          ".visual-hive/pipeline.json",
          ".visual-hive/report.json",
          ".visual-hive/evidence-packet.json",
          ".visual-hive/handoff.json",
          ".visual-hive/hive/hive-export.json",
          ".visual-hive/agent-packet.json"
        ]
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    path.join(repoRoot, ".visual-hive", "security.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        project: "ui-fixture",
        generatedAt: "2026-06-15T00:00:00.000Z",
        summary: {
          score: 96,
          totalFindings: 1,
          critical: 0,
          high: 0,
          medium: 0,
          low: 1,
          prBlocking: 0,
          trustedOnly: 0,
          npmAuditSource: "not_run",
          npmAuditTotal: 0
        },
        inputs: {
          workflowAudit: true,
          npmAudit: false
        },
        npmAudit: {
          source: "not_run",
          total: 0,
          critical: 0,
          high: 0,
          moderate: 0,
          low: 0,
          info: 0
        },
        findings: [
          {
            id: "dependency:npm-audit-not-run",
            category: "dependency",
            severity: "low",
            title: "Dependency audit was not run",
            message: "Security audit did not run npm audit by default.",
            evidence: ["npmAudit.source=not_run"],
            recommendation: "Run visual-hive security --npm-audit in a trusted environment.",
            trustedOnly: false
          }
        ],
        recommendations: ["Run npm audit in a trusted environment when reviewing supply-chain risk."]
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    path.join(repoRoot, ".visual-hive", "costs.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        project: "ui-fixture",
        generatedAt: "2026-06-15T00:00:00.000Z",
        mode: "pr",
        summary: {
          selectedContracts: 1,
          selectedTargets: 1,
          localScreenshots: 1,
          estimatedExternalScreenshots: 0,
          externalCallsPlanned: 0,
          externalCallsMade: 0,
          enabledExternalProviders: 0,
          policyBlockedProviders: 0,
          missingCredentialProviders: 0,
          expensiveTargetsSelected: 0,
          mutationOperators: 1,
          maxExternalScreenshotsPerRun: 0,
          maxMonthlyExternalScreenshots: 5000,
          budgetStatus: "blocked"
        },
        costPolicy: {
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
        },
        targets: [
          {
            targetId: "localPreview",
            kind: "command",
            cost: "cheap",
            prSafe: true,
            selected: true,
            contractCount: 1,
            screenshotCount: 1
          }
        ],
        providers: [
          {
            providerId: "playwright",
            label: "Playwright built-in",
            enabled: true,
            mode: "external",
            availability: "available",
            deterministicRole: "oracle",
            externalUploadAllowed: true,
            blockedReasons: [],
            estimatedExternalScreenshots: 0,
            externalCallsPlanned: 0,
            externalCallsMade: 0,
            missingEnv: []
          }
        ],
        risks: [],
        recommendations: ["Keep default PR runs local-only."]
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(path.join(repoRoot, ".visual-hive", "artifacts", "screenshots", "dashboard.png"), "actual-dashboard", "utf8");
  await writeFile(path.join(repoRoot, ".visual-hive", "snapshots", "dashboard.png"), "old-dashboard", "utf8");
  return { repoRoot, configPath };
}

async function writeCoverageRecommendationFixture(repoRoot: string): Promise<void> {
  await writeFile(
    path.join(repoRoot, ".visual-hive", "coverage-recommendations.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        project: "ui-fixture",
        generatedAt: "2026-06-15T00:00:00.000Z",
        summary: {
          total: 2,
          high: 0,
          medium: 2,
          low: 0,
          fromCoverageGaps: 1,
          fromMutationSurvivors: 1,
          fromFlowGaps: 0
        },
        recommendations: [
          {
            id: "changed-file-rule:src/auth/Login.tsx",
            kind: "add_changed_file_rule",
            severity: "medium",
            title: "Map changed file \"src/auth/Login.tsx\" to visual coverage",
            rationale: ["Changed file did not match any selection rule."],
            changedFile: "src/auth/Login.tsx",
            contractId: "dashboard",
            targetId: "localPreview",
            suggestedConfigYaml:
              "selection:\n  changedFiles:\n    - pattern: src/auth/**\n      contracts:\n        - dashboard\n      risk: high",
            suggestedTests: ["Add a selection.changedFiles rule for src/auth/**."]
          },
          {
            id: "mutation:remove-demo-badge:dashboard",
            kind: "add_selector_assertion",
            severity: "medium",
            title: "Kill mutation \"remove-demo-badge\"",
            rationale: ["Mutation \"remove-demo-badge\" survived, so current contracts did not catch the intentional breakage."],
            contractId: "dashboard",
            targetId: "localPreview",
            mutationOperator: "remove-demo-badge",
            suggestedConfigYaml:
              "selectors:\n  mustExist:\n    - \"[data-testid='demo-badge']\"",
            suggestedTests: ["Assert the demo badge is visible on dashboard cards."]
          }
        ]
      },
      null,
      2
    ),
    "utf8"
  );
}

describe("control plane", () => {
  it("builds a snapshot from config and report artifacts", async () => {
    const fixture = await makeFixture();
    const snapshot = await createControlPlaneSnapshot({ repo: fixture.repoRoot, config: fixture.configPath, readOnly: true });

    expect(snapshot.config?.project.name).toBe("ui-fixture");
    expect(snapshot.overview.deterministicStatus).toBe("passed");
    expect(snapshot.overview.visualHiveVerdict).toBe("failed");
    expect(snapshot.overview.gatingContributions).toBe(2);
    expect(snapshot.overview.advisoryContributions).toBe(1);
    expect(snapshot.overview.failedContributions).toBe(2);
    expect(snapshot.overview.blockedContributions).toBe(0);
    expect(snapshot.overview.pipelineStatus).toBe("passed");
    expect(snapshot.overview.pipelineSteps).toBe(4);
    expect(snapshot.overview.pipelineFailedSteps).toBe(0);
    expect(snapshot.pipelineReport).toMatchObject({
      schemaVersion: 1,
      status: "passed",
      exitCode: 0,
      steps: [{ id: "run", status: "passed" }, { id: "evidence", status: "passed" }, { id: "handoff", status: "passed" }, { id: "hive-export", status: "passed" }]
    });
    expect(snapshot.guidanceState).toMatchObject({
      state: "failures_need_triage",
      title: "Failures need triage",
      primaryAction: {
        area: "review"
      }
    });
    expect(snapshot.guidanceState.progress.map((step) => step.id)).toEqual(["setup", "plan", "run", "review", "strengthen"]);
    expect(snapshot.navigationBadges.review).toBeGreaterThan(0);
    expect(snapshot.navigationBadges.configure).toBeGreaterThan(0);
    expect(snapshot.targets).toHaveLength(1);
    expect(snapshot.contracts).toHaveLength(1);
    expect(snapshot.providers.find((provider) => provider.id === "playwright")?.availability).toBe("available");
    expect(snapshot.providers.find((provider) => provider.id === "argos")?.costPolicy.externalUploadAllowed).toBe(false);
    expect(snapshot.providers.find((provider) => provider.id === "argos")?.costPolicy.blockedReasons).toContain(
      "costPolicy.externalUpload.onFailureOnly=true and deterministic status is passed."
    );
    expect(snapshot.report?.providerResults?.[0]?.status).toBe("passed");
    expect(snapshot.report?.excludedContracts[0]?.contractId).toBe("admin");
    expect(snapshot.report?.results[0]?.selectorAssertions?.map((assertion) => assertion.kind)).toContain("mustNotExist");
    expect(snapshot.report?.results[0]?.screenshotAssertions?.[0]?.diffPath).toContain("dashboard.diff.png");
    expect(snapshot.report?.results[0]?.networkErrors?.[0]?.status).toBe(500);
    expect(snapshot.triageReport?.summary.findingCount).toBe(1);
    expect(snapshot.failures.find((failure) => failure.classification === "insufficient_coverage")?.suggestedFiles).toContain("src/unmapped.ts");
    expect(snapshot.failures.find((failure) => failure.classification === "insufficient_coverage")?.changedFiles).toContain("src/App.tsx");
    expect(snapshot.providerRunReport?.providers[0]?.operations.map((operation) => operation.operation)).toContain("compare");
    expect(snapshot.providerHandoff).toMatchObject({
      providerId: "argos",
      status: "review",
      externalCallsMade: 0,
      summary: {
        diffArtifacts: 1
      }
    });
    expect(snapshot.providerSetupPlan).toBeUndefined();
    expect(snapshot.mutationReport?.score).toBe(0.5);
    expect(snapshot.mutationReport?.results.map((result) => result.status)).toEqual(["killed", "survived", "not_applicable", "error"]);
    expect(snapshot.coverageImprovementReport?.summary.fromMutationSurvivors).toBe(1);
    expect(snapshot.coverageImprovementReport?.recommendations.map((recommendation) => recommendation.mutationOperator)).toContain("remove-demo-badge");
    expect(snapshot.evidencePacket).toMatchObject({
      schemaVersion: "visual-hive.evidence-packet.v2",
      verdictSummary: { visualHiveVerdict: "failed" },
      hiveReadiness: { readyForHiveDryRun: true }
    });
    expect(snapshot.verdictReport).toMatchObject({
      schemaVersion: "visual-hive.verdict.v1",
      summary: { visualHiveVerdict: "failed", gatingContributions: 2 }
    });
    expect(snapshot.handoffPacket).toMatchObject({
      schemaVersion: "visual-hive.handoff.v1",
      status: "ready",
      externalCallsMade: 0,
      workItems: [{ kind: "test_creation", priority: "high" }]
    });
    expect(snapshot.hiveExport).toMatchObject({
      schemaVersion: "visual-hive.hive-export.v1",
      status: "ready",
      mode: "repair_request",
      externalCallsMade: 0,
      summary: {
        beads: 1,
        knowledgeFacts: 1,
        graphNodes: 2,
        graphEdges: 1,
        repairWorkOrders: 1
      },
      governance: {
        verdictAuthority: "visual_hive",
        validationRequired: "visual_hive_must_rerun_after_repair"
      }
    });
    expect(snapshot.hiveExport?.repairWorkOrders[0]?.forbiddenActions).toContain("auto_merge_without_visual_hive_pass");
    expect(snapshot.hiveExport?.beads[0]).toMatchObject({
      id: "vhb-mutation-remove-demo-badge-dashboard",
      actor: "quality",
      title: "Strengthen demo badge contract"
    });
    expect(snapshot.hiveExport?.knowledgeFacts[0]).toMatchObject({
      slug: "mutation-remove-demo-badge-survived",
      type: "coverage_rule",
      relatedEvidenceKeys: ["mutation.mutation_adequacy.remove-demo-badge"]
    });
    expect(snapshot.hiveExport?.knowledgeGraph.edges[0]).toMatchObject({
      predicate: "derived_from",
      from: "bead:vhb-mutation-remove-demo-badge-dashboard",
      to: "fact:mutation-remove-demo-badge-survived"
    });
    expect(snapshot.hiveExport?.outputArtifacts.wikiVaultDir).toBe(".visual-hive/hive/wiki");
    expect(snapshot.hiveExport?.agentPolicy.finalValidation).toMatchObject({
      required: true,
      passFailOwnedBy: "visual_hive_verdict_engine"
    });
    expect(snapshot.agentPacket).toMatchObject({
      schemaVersion: "visual-hive.agent-packet.v1",
      profile: "repair_agent",
      budgets: { allowExternalNetwork: false, maxExternalCostUsd: 0 }
    });
    expect(snapshot.testCreationPlan).toMatchObject({
      schemaVersion: "visual-hive.test-creation-plan.v1",
      governance: { writePolicy: "no_config_or_test_files_written" },
      summary: { total: 2, high: 1, fromMutationSurvivors: 1 }
    });
    expect(snapshot.testCreationPlan?.recommendations.map((recommendation) => recommendation.kind)).toContain("mutation_mapping");
    expect(snapshot.providerDecisionLog).toBeUndefined();
    expect((snapshot.plan as { providerPolicy?: Array<{ providerId: string; externalCallsPlanned: number }> })?.providerPolicy?.[0]).toMatchObject({
      providerId: "playwright",
      externalCallsPlanned: 0
    });
    expect(snapshot.planLaneSummary).toMatchObject({
      planCount: 2,
      summary: { modes: ["canary", "pr"], reviewPlans: 1 }
    });
    expect(snapshot.setupRecommendation?.recommendedTarget.id).toBe("localPreview");
    expect(snapshot.setupRecommendation?.setupProfile).toBe("free-local");
    expect(snapshot.setupRecommendation?.providerRecommendations.find((provider) => provider.providerId === "argos")?.requiredEnv).toEqual([
      "ARGOS_TOKEN"
    ]);
    expect(snapshot.setupPullRequestPlan).toMatchObject({
      status: "review",
      summary: {
        externalCallsMade: 0,
        workflowsPlanned: 2
      },
      security: {
        generatedWorkflowsUsePullRequestTarget: false,
        generatedPrWorkflowUsesSecrets: false
      }
    });
    expect(snapshot.setupPullRequestPlan?.files.map((file) => file.path)).toContain(".visual-hive/setup-pr-plan.json");
    expect(snapshot.setupProgress).toMatchObject({
      status: "attention",
      phase: "measure mutation adequacy",
      completedSteps: 8,
      totalSteps: 10,
      blockedSteps: 1,
      reviewSteps: 1
    });
    expect(snapshot.setupProgress.nextStep).toMatchObject({
      id: "mutation",
      status: "blocked",
      command: "visual-hive mutate"
    });
    expect(snapshot.setupProgress.steps.map((step) => step.id)).toEqual([
      "recommend",
      "config",
      "plan",
      "run",
      "baselines",
      "mutation",
      "triage",
      "workflow-safety",
      "provider-governance",
      "readiness"
    ]);
    expect(snapshot.setupProgress.steps.find((step) => step.id === "provider-governance")).toMatchObject({
      label: "Record provider posture and handoff",
      status: "complete",
      command: "visual-hive providers list --mock-results"
    });
    expect(snapshot.setupProgress.steps.find((step) => step.id === "provider-governance")?.evidence.join(" ")).toContain("handoff=argos:review");
    expect(snapshot.runHistory?.summary.runCount).toBe(1);
    expect(snapshot.runHistory?.trend.direction).toBe("unknown");
    expect(snapshot.runHistory?.entries[0]?.deterministicStatus).toBe("passed");
    expect(snapshot.llmUsage?.summary.callsMade).toBe(0);
    expect(snapshot.llmUsage?.records[0]?.task).toBe("repair_prompt");
    expect(snapshot.llmDecisionLog).toBeUndefined();
    const artifactPreview = snapshot.artifacts.find((artifact) => artifact.path.endsWith("console.log"));
    expect(artifactPreview?.kind).toBe("log");
    expect(artifactPreview?.preview).toContain("[REDACTED]");
    expect(snapshot.targetAudit?.summary.targetCount).toBe(1);
    expect(snapshot.targetAudit?.targets[0]?.latestStatus).toBe("passed");
    expect(snapshot.coverage.summary.contractCount).toBe(1);
    expect(snapshot.coverage.routes[0]?.selectedContracts).toEqual(["dashboard"]);
    expect(snapshot.coverageImprovementReport?.summary.total).toBeGreaterThan(0);
    expect(snapshot.coverageImprovementReport?.recommendations.map((recommendation) => recommendation.kind)).toContain("add_changed_file_rule");
    expect(snapshot.contractAudit?.summary.contractCount).toBe(1);
    expect(snapshot.contractAudit?.contracts[0]?.latestStatus).toBe("passed");
    expect(snapshot.flowAudit?.summary.contractCount).toBe(1);
    expect(snapshot.flowAudit?.summary.contractsWithoutFlow).toBe(1);
    expect(snapshot.flowAudit?.recommendations.join(" ")).toContain("flow");
    expect(snapshot.scheduleAudit?.summary.pullRequestContracts).toBe(1);
    expect(snapshot.scheduleAudit?.lanes.map((lane) => lane.id)).toContain("trusted_issue");
    expect(snapshot.workflowAudit?.summary.pullRequestWorkflows).toBe(1);
    expect(snapshot.workflowAudit?.summary.criticalFindings).toBe(0);
    expect(snapshot.workflowTemplates.map((template) => template.id)).toEqual([
      "pull_request",
      "scheduled",
      "trusted_failure_issue",
      "trusted_hive_handoff"
    ]);
    expect(snapshot.workflowTemplates.find((template) => template.id === "trusted_failure_issue")?.content).toContain("function walkArtifacts");
    expect(snapshot.runbook.configPath).toBe("visual-hive.config.yaml");
    expect(snapshot.runbook.commands.find((command) => command.id === "plan-pr")).toMatchObject({
      lane: "pull_request",
      safety: "pr_safe",
      requiredSecrets: []
    });
    expect(snapshot.runbook.commands.find((command) => command.id === "plan-canary")).toMatchObject({
      lane: "pull_request",
      safety: "pr_safe",
      command: expect.stringContaining("--mode canary"),
      expectedArtifacts: [".visual-hive/plan.canary.json"]
    });
    expect(snapshot.runbook.commands.find((command) => command.id === "plan-canary")?.command).toContain("--output .visual-hive/plan.canary.json");
    expect(snapshot.runbook.commands.find((command) => command.id === "plan-full-safe")).toMatchObject({
      lane: "local",
      safety: "pr_safe",
      command: expect.stringContaining("--mode full"),
      expectedArtifacts: [".visual-hive/plan.full.json"]
    });
    expect(snapshot.runbook.commands.find((command) => command.id === "plan-full-safe")?.command).toContain("--output .visual-hive/plan.full.json");
    expect(snapshot.runbook.commands.find((command) => command.id === "plan-full-safe")?.command).not.toContain("--allow-unsafe-targets");
    expect(snapshot.runbook.commands.find((command) => command.id === "run-ci")?.expectedArtifacts).toContain(".visual-hive/report.json");
    expect(snapshot.runbook.notes).toContain("Visual Hive owns the deterministic verdict; Playwright is the default local evidence runner.");
    expect(snapshot.runProfiles.find((profile) => profile.id === "pr-acceptance")).toMatchObject({
      enabled: true,
      commandIds: ["doctor", "plan-pr", "run-ci", "baselines", "readiness", "triage-report"],
      safety: "pr_safe"
    });
    expect(snapshot.runProfiles.find((profile) => profile.id === "mutation-audit")).toMatchObject({
      enabled: true,
      commandIds: ["doctor", "plan-pr", "mutate", "readiness", "triage-report"],
      safety: "local_only"
    });
    expect(snapshot.runProfiles.find((profile) => profile.id === "canary-health")).toMatchObject({
      enabled: true,
      commandIds: ["doctor", "plan-canary", "readiness"],
      safety: "pr_safe"
    });
    expect(snapshot.runProfiles.find((profile) => profile.id === "full-safe-plan")).toMatchObject({
      enabled: true,
      commandIds: ["doctor", "plan-full-safe", "readiness"],
      safety: "pr_safe"
    });
    expect(snapshot.runProfiles.find((profile) => profile.id === "coverage-improvement")).toMatchObject({
      enabled: true,
      commandIds: ["coverage", "improve-coverage", "test-creation-plan"],
      safety: "pr_safe"
    });
    expect(snapshot.runProfiles.find((profile) => profile.id === "coverage-improvement")?.expectedArtifacts).toEqual(
      expect.arrayContaining([".visual-hive/coverage.json", ".visual-hive/coverage-recommendations.json", ".visual-hive/test-creation-plan.json"])
    );
    expect(snapshot.runProfiles.find((profile) => profile.id === "agent-handoff-review")).toMatchObject({
      enabled: true,
      commandIds: ["evidence", "verdict", "handoff", "hive-export", "test-creation-plan", "agent-packet"],
      safety: "pr_safe",
      expectedArtifacts: expect.arrayContaining([
        ".visual-hive/evidence-packet.json",
        ".visual-hive/verdict.json",
        ".visual-hive/handoff.json",
        ".visual-hive/hive/hive-export.json",
        ".visual-hive/agent-packet.json"
      ])
    });
    expect(snapshot.runProfiles.find((profile) => profile.id === "operational-pipeline")).toMatchObject({
      enabled: true,
      commandIds: ["pipeline"],
      safety: "pr_safe",
      expectedArtifacts: expect.arrayContaining([
        ".visual-hive/pipeline.json",
        ".visual-hive/repo-map.json",
        ".visual-hive/report.json",
        ".visual-hive/mutation-report.json",
        ".visual-hive/testing-layers.json",
        ".visual-hive/evidence-packet.json",
        ".visual-hive/verdict.json",
        ".visual-hive/handoff.json",
        ".visual-hive/hive/hive-export.json",
        ".visual-hive/agent-packet.json",
        ".visual-hive/tools/tool-registry.json",
        ".visual-hive/context-ledger.json"
      ])
    });
    expect(snapshot.runbook.commands.find((command) => command.id === "pipeline")).toMatchObject({
      lane: "pull_request",
      safety: "pr_safe",
      command: expect.stringContaining("pipeline"),
      expectedArtifacts: expect.arrayContaining([".visual-hive/pipeline.json", ".visual-hive/evidence-packet.json", ".visual-hive/context-ledger.json"])
    });
    expect(snapshot.runbook.commands.find((command) => command.id === "pipeline")?.command).toContain("--continue-on-error");
    expect(snapshot.runbook.commands.find((command) => command.id === "security")?.expectedArtifacts).toContain(".visual-hive/security.json");
    expect(snapshot.runbook.commands.find((command) => command.id === "costs")?.expectedArtifacts).toContain(".visual-hive/costs.json");
    expect(snapshot.runbook.commands.find((command) => command.id === "providers")).toMatchObject({
      safety: "pr_safe",
      command: expect.stringContaining("providers list"),
      expectedArtifacts: [".visual-hive/provider-results.json"]
    });
    expect(snapshot.runbook.commands.find((command) => command.id === "provider-plan")).toMatchObject({
      safety: "pr_safe",
      command: expect.stringContaining("providers plan"),
      expectedArtifacts: [".visual-hive/provider-setup-plan.json"]
    });
    expect(snapshot.runbook.commands.find((command) => command.id === "provider-handoff")).toMatchObject({
      safety: "pr_safe",
      command: expect.stringContaining("providers handoff"),
      expectedArtifacts: [".visual-hive/provider-handoff.json"]
    });
    expect(snapshot.runbook.commands.find((command) => command.id === "readiness")?.expectedArtifacts).toContain(".visual-hive/readiness.json");
    expect(snapshot.runbook.commands.find((command) => command.id === "connections-portfolio")).toMatchObject({
      safety: "pr_safe",
      expectedArtifacts: [".visual-hive/connections-portfolio.json"]
    });
    expect(snapshot.runbook.commands.find((command) => command.id === "baselines")).toMatchObject({
      safety: "pr_safe",
      expectedArtifacts: [".visual-hive/baselines.json"]
    });
    expect(snapshot.runbook.commands.find((command) => command.id === "coverage")).toMatchObject({
      safety: "pr_safe",
      expectedArtifacts: [".visual-hive/coverage.json"]
    });
    expect(snapshot.runbook.commands.find((command) => command.id === "improve-coverage")).toMatchObject({
      safety: "pr_safe",
      expectedArtifacts: [".visual-hive/coverage-recommendations.json"]
    });
    expect(snapshot.runbook.commands.find((command) => command.id === "test-creation-plan")).toMatchObject({
      safety: "pr_safe",
      command: expect.stringContaining("test-creation-plan"),
      expectedArtifacts: [".visual-hive/test-creation-plan.json", ".visual-hive/test-creation-plan.md"]
    });
    expect(snapshot.runbook.commands.find((command) => command.id === "evidence")).toMatchObject({
      safety: "pr_safe",
      command: expect.stringContaining("evidence"),
      expectedArtifacts: [".visual-hive/evidence-packet.json", ".visual-hive/evidence-summary.md"]
    });
    expect(snapshot.runbook.commands.find((command) => command.id === "handoff")).toMatchObject({
      safety: "pr_safe",
      command: expect.stringContaining("handoff"),
      expectedArtifacts: [".visual-hive/handoff.json", ".visual-hive/hive-issue.md", ".visual-hive/hive-bead-request.json", ".visual-hive/hive-handoff-result.json"]
    });
    expect(snapshot.runbook.commands.find((command) => command.id === "hive-export")).toMatchObject({
      safety: "pr_safe",
      command: expect.stringContaining("hive export"),
      expectedArtifacts: expect.arrayContaining([".visual-hive/hive/hive-export.json", ".visual-hive/hive/repair-work-orders.json"])
    });
    expect(snapshot.runbook.commands.find((command) => command.id === "hive-export-advisory")).toMatchObject({
      safety: "pr_safe",
      command: expect.stringContaining("--mode advisory"),
      expectedArtifacts: expect.arrayContaining([".visual-hive/hive/hive-export.json", ".visual-hive/hive/issue-context.md"])
    });
    expect(snapshot.runbook.commands.find((command) => command.id === "hive-export-measured")).toMatchObject({
      safety: "pr_safe",
      command: expect.stringContaining("--mode measured"),
      expectedArtifacts: expect.arrayContaining([".visual-hive/hive/beads.json", ".visual-hive/hive/knowledge-graph.json"])
    });
    expect(snapshot.runbook.commands.find((command) => command.id === "hive-export-repair-request")).toMatchObject({
      safety: "pr_safe",
      command: expect.stringContaining("--mode repair_request"),
      expectedArtifacts: expect.arrayContaining([".visual-hive/hive/repair-work-orders.json", ".visual-hive/hive/hive-agent-policy.json"])
    });
    expect(snapshot.runbook.commands.find((command) => command.id === "agent-packet")).toMatchObject({
      safety: "pr_safe",
      command: expect.stringContaining("agent-packet"),
      expectedArtifacts: [".visual-hive/agent-packet.json"]
    });
    expect(snapshot.runProfiles.find((profile) => profile.id === "security-audit")).toMatchObject({
      enabled: true,
      commandIds: ["doctor", "security", "readiness", "triage-report"],
      safety: "pr_safe"
    });
    expect(snapshot.runProfiles.find((profile) => profile.id === "cost-audit")).toMatchObject({
      enabled: true,
      commandIds: ["doctor", "costs", "readiness", "triage-report"],
      safety: "pr_safe"
    });
    expect(snapshot.runProfiles.find((profile) => profile.id === "provider-governance")).toMatchObject({
      enabled: true,
      commandIds: ["providers", "provider-plan", "provider-handoff", "costs", "readiness"],
      expectedArtifacts: expect.arrayContaining([".visual-hive/provider-results.json", ".visual-hive/provider-setup-plan.json", ".visual-hive/provider-handoff.json"]),
      safety: "pr_safe"
    });
    expect(snapshot.runProfiles.find((profile) => profile.id === "portfolio-refresh")).toMatchObject({
      enabled: true,
      commandIds: ["security", "costs", "readiness", "connections-portfolio"],
      expectedArtifacts: expect.arrayContaining([".visual-hive/connections-portfolio.json"]),
      safety: "pr_safe"
    });
    expect(snapshot.runProfiles.find((profile) => profile.id === "pr-acceptance")?.commandIds).toEqual([
      "doctor",
      "plan-pr",
      "run-ci",
      "baselines",
      "readiness",
      "triage-report"
    ]);
    expect(snapshot.readinessReport?.project).toBe("ui-fixture");
    expect(snapshot.readinessReport?.gates.map((gate) => gate.id)).toContain("deterministic:status");
    expect(snapshot.runProfiles.find((profile) => profile.id === "protected-schedule-preview")?.enabled).toBe(false);
    expect(snapshot.riskReport?.project).toBe("ui-fixture");
    expect(snapshot.securityAudit?.project).toBe("ui-fixture");
    expect(snapshot.securityAudit?.summary.score).toBe(96);
    expect(snapshot.costAudit?.project).toBe("ui-fixture");
    expect(snapshot.costAudit?.summary.localScreenshots).toBe(1);
    expect(snapshot.riskReport?.inputs.report).toBe(true);
    expect(snapshot.riskReport?.risks.map((risk) => risk.category)).toContain("coverage_gap");
    expect(snapshot.riskReport?.risks[0]?.contractIds).toEqual(["dashboard"]);
    expect(snapshot.riskReport?.risks[0]?.targetIds).toEqual(["localPreview"]);
    expect(snapshot.screenshots[0]?.name).toBe("dashboard");
    expect(snapshot.baselineSummary).toMatchObject({ total: 1, passed: 1, pendingReview: 0 });
    expect(snapshot.issueMarkdown).toContain("Issue");
    expect(snapshot.prCommentMarkdown).toContain("Visual Hive report");
    expect(snapshot.missingTestsMarkdown).toContain("Missing Test Suggestions");
    expect(snapshot.baselineReviewMarkdown).toContain("Baseline Review Summary");
    expect(snapshot.artifacts.find((artifact) => artifact.path.endsWith("baseline-review.md"))?.labels).toContain("baseline-review");
    expect(snapshot.artifacts.find((artifact) => artifact.path.endsWith("setup-pr-plan.json"))?.labels).toContain("setup-pr-plan");
    expect(snapshot.artifacts.find((artifact) => artifact.path.endsWith("provider-handoff.json"))?.labels).toContain("provider-handoff");
    expect(snapshot.artifacts.find((artifact) => artifact.path.endsWith("hive-export.json"))?.labels).toContain("hive-export");
    expect(snapshot.artifacts.find((artifact) => artifact.path.endsWith("plans.json"))?.labels).toContain("plan-lanes");
    expect(snapshot.artifacts.find((artifact) => artifact.path.endsWith("risk.json"))?.labels).toContain("risk-register");
    expect(snapshot.artifacts.find((artifact) => artifact.path.endsWith("security.json"))?.labels).toContain("security-audit");
    expect(snapshot.artifacts.find((artifact) => artifact.path.endsWith("costs.json"))?.labels).toContain("cost-audit");
  });

  it("surfaces blocked verdict evidence separately from deterministic failures", async () => {
    const fixture = await makeFixture();
    const blockedSummary = {
      visualHiveVerdict: "blocked",
      failedBecause: [],
      warningBecause: [],
      blockedBecause: ["target.startup.localPreview"],
      advisoryOnly: ["triage.insufficient_coverage"]
    };
    const blockedContribution = {
      key: "target.startup.localPreview",
      source: "target",
      kind: "target_startup",
      status: "blocked",
      gating: true,
      authority: "deterministic",
      targetId: "localPreview",
      reason: "Target localPreview did not become ready before timeout.",
      artifacts: [".visual-hive/report.json"]
    };

    const evidencePath = path.join(fixture.repoRoot, ".visual-hive", "evidence-packet.json");
    const evidencePacket = JSON.parse(await readFile(evidencePath, "utf8"));
    evidencePacket.evidenceContributions = [blockedContribution, ...(evidencePacket.evidenceContributions ?? [])];
    evidencePacket.verdictSummary = blockedSummary;
    evidencePacket.hiveReadiness = {
      ...(evidencePacket.hiveReadiness ?? {}),
      readyForHiveDryRun: false,
      blockedReasons: ["target.startup.localPreview"]
    };
    await writeFile(evidencePath, JSON.stringify(evidencePacket, null, 2), "utf8");

    const verdictPath = path.join(fixture.repoRoot, ".visual-hive", "verdict.json");
    const verdictReport = JSON.parse(await readFile(verdictPath, "utf8"));
    verdictReport.summary = {
      ...verdictReport.summary,
      ...blockedSummary,
      totalContributions: 4,
      gatingContributions: 3,
      advisoryContributions: 1,
      failedContributions: 0,
      blockedContributions: 1,
      warningContributions: 0,
      inconclusiveContributions: 0,
      passedContributions: 0,
      skippedContributions: 1
    };
    verdictReport.gatingContributions = [blockedContribution, ...(verdictReport.gatingContributions ?? [])];
    verdictReport.allContributions = [blockedContribution, ...(verdictReport.allContributions ?? [])];
    await writeFile(verdictPath, JSON.stringify(verdictReport, null, 2), "utf8");

    const snapshot = await createControlPlaneSnapshot({ repo: fixture.repoRoot, config: fixture.configPath, readOnly: true });

    expect(snapshot.overview.deterministicStatus).toBe("passed");
    expect(snapshot.overview.visualHiveVerdict).toBe("blocked");
    expect(snapshot.overview.blockedContributions).toBe(1);
    expect(snapshot.guidanceState).toMatchObject({
      state: "readiness_blocked",
      title: "Checks are blocked",
      primaryAction: {
        label: "Review blockers",
        area: "review"
      }
    });
    expect(snapshot.guidanceState.blockedReasons).toContain("target.startup.localPreview");
    expect(snapshot.overview.nextActions[0]).toContain("blocked evidence");
  });

  it("builds beginner guidance when no config exists yet", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-empty-ui-"));
    const snapshot = await createControlPlaneSnapshot({
      repo: repoRoot,
      config: path.join(repoRoot, "visual-hive.config.yaml"),
      readOnly: true
    });

    expect(snapshot.config).toBeUndefined();
    expect(snapshot.guidanceState).toMatchObject({
      state: "no_config",
      title: "Create a Visual Hive config",
      primaryAction: {
        label: "Start setup",
        area: "configure"
      }
    });
    expect(snapshot.guidanceState.progress[0]).toMatchObject({
      id: "setup",
      status: "current"
    });
  });

  it("computes flow coverage risks when no stored risk artifact exists", async () => {
    const fixture = await makeFixture();
    await rm(path.join(fixture.repoRoot, ".visual-hive", "risk.json"), { force: true });

    const snapshot = await createControlPlaneSnapshot({ repo: fixture.repoRoot, config: fixture.configPath, readOnly: true });

    expect(snapshot.flowAudit?.summary.contractsWithoutFlow).toBe(1);
    expect(snapshot.riskReport?.inputs.flowAudit).toBe(true);
    expect(snapshot.riskReport?.risks.map((risk) => risk.category)).toContain("flow_coverage");
    expect(snapshot.riskReport?.recommendations).toContain("Add or repair deterministic flow steps for high-risk user journeys.");
  });

  it("adds trusted protected-lane runbook commands with secret names only", async () => {
    const fixture = await makeFixture();
    const config = await readFile(fixture.configPath, "utf8");
    await writeFile(
      fixture.configPath,
      config.replace(
        "contracts:\n",
        `  liveCluster:
    kind: protected
    url: "https://cluster.example.invalid"
    requiresSecrets:
      - KUBECONFIG
      - KC_AGENT_TOKEN
    schedule: "0 6 * * *"
    cost: expensive
contracts:
`
      ),
      "utf8"
    );
    process.env.KC_AGENT_TOKEN = "real-secret-value";
    try {
      const snapshot = await createControlPlaneSnapshot({ repo: fixture.repoRoot, config: fixture.configPath, readOnly: true });
      const protectedCommand = snapshot.runbook.commands.find((command) => command.id === "schedule-protected");

      expect(protectedCommand).toMatchObject({
        lane: "protected",
        safety: "trusted_only",
        requiredSecrets: ["KC_AGENT_TOKEN", "KUBECONFIG"]
      });
      expect(protectedCommand?.command).toContain("--allow-unsafe-targets");
      expect(JSON.stringify(snapshot.runbook)).not.toContain("real-secret-value");
    } finally {
      delete process.env.KC_AGENT_TOKEN;
    }
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

  it("surfaces multi-repo connection health from report, mutation, and risk artifacts", async () => {
    const manager = await makeFixture();
    const connected = await makeFixture();
    const reportPath = path.join(connected.repoRoot, ".visual-hive", "report.json");
    const report = JSON.parse(await readFile(reportPath, "utf8")) as { status: string; generatedAt: string; summary: { passed: number; failed: number } };
    report.status = "failed";
    report.generatedAt = "2020-01-01T00:00:00.000Z";
    report.summary.passed = 0;
    report.summary.failed = 1;
    await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
    await writeFile(
      path.join(connected.repoRoot, ".visual-hive", "mutation-report.json"),
      JSON.stringify(
        {
          schemaVersion: 2,
          project: "connected-fixture",
          generatedAt: "2026-06-15T00:10:00.000Z",
          minScore: 0.8,
          score: 0.4,
          killed: 2,
          total: 5,
          results: []
        },
        null,
        2
      ),
      "utf8"
    );
    await writeFile(
      path.join(connected.repoRoot, ".visual-hive", "coverage.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          project: "connected-fixture",
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
            uncoveredTargets: 1,
            uncoveredContracts: 0,
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
          uncoveredAreas: [{ kind: "target_without_contracts", severity: "high", message: "Fullstack target has no contracts.", targetId: "fullstack" }]
        },
        null,
        2
      ),
      "utf8"
    );
    await writeFile(
      path.join(connected.repoRoot, ".visual-hive", "risk.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          project: "connected-fixture",
          generatedAt: "2026-06-15T00:20:00.000Z",
          summary: {
            total: 1,
            critical: 1,
            high: 0,
            medium: 0,
            low: 0,
            riskScore: 80,
            highestSeverity: "critical",
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
        },
        null,
        2
      ),
      "utf8"
    );
    await writeFile(
      path.join(connected.repoRoot, ".visual-hive", "readiness.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          project: "connected-fixture",
          generatedAt: "2026-06-15T00:25:00.000Z",
          status: "blocked",
          score: 61,
          summary: { total: 3, passed: 1, warnings: 0, blocked: 2, missing: 0 },
          inputs: { plan: true, report: true, mutationReport: true, baselines: true, workflowAudit: true, securityAudit: true, costAudit: true },
          gates: [],
          nextActions: []
        },
        null,
        2
      ),
      "utf8"
    );
    await writeFile(
      path.join(connected.repoRoot, ".visual-hive", "security.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          project: "connected-fixture",
          generatedAt: "2026-06-15T00:30:00.000Z",
          summary: {
            score: 70,
            totalFindings: 1,
            critical: 0,
            high: 1,
            medium: 0,
            low: 0,
            prBlocking: 1,
            trustedOnly: 0,
            npmAuditSource: "not_run",
            npmAuditTotal: 0
          },
          inputs: { workflowAudit: true, npmAudit: false },
          npmAudit: { source: "not_run", total: 0, critical: 0, high: 0, moderate: 0, low: 0, info: 0 },
          findings: [],
          recommendations: []
        },
        null,
        2
      ),
      "utf8"
    );
    await writeFile(
      path.join(connected.repoRoot, ".visual-hive", "costs.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          project: "connected-fixture",
          generatedAt: "2026-06-15T00:35:00.000Z",
          mode: "pr",
          summary: { budgetStatus: "blocked", policyBlockedProviders: 1 },
          targets: [],
          providers: [],
          risks: [],
          recommendations: []
        },
        null,
        2
      ),
      "utf8"
    );
    await addConnection({
      repoRoot: manager.repoRoot,
      repoPath: connected.repoRoot,
      id: "attention-repo",
      label: "Attention Repo"
    });

    const snapshot = await createControlPlaneSnapshot({ repo: manager.repoRoot, config: manager.configPath, readOnly: true });
    const connection = snapshot.connections?.connections.find((candidate) => candidate.id === "attention-repo");

    expect(snapshot.connections?.summary.failedConnections).toBe(1);
    expect(snapshot.connections?.summary.staleReportConnections).toBe(2);
    expect(snapshot.connections?.summary.weakMutationConnections).toBe(2);
    expect(snapshot.connections?.summary.coverageGapConnections).toBe(1);
    expect(snapshot.connections?.summary.highCoverageGapConnections).toBe(1);
    expect(snapshot.connections?.summary.highRiskConnections).toBe(1);
    expect(snapshot.connections?.summary.readinessBlockedConnections).toBe(1);
    expect(snapshot.connections?.summary.securityRiskConnections).toBe(1);
    expect(snapshot.connections?.summary.costPolicyConnections).toBeGreaterThanOrEqual(1);
    expect(snapshot.connections?.portfolio.queues.find((queue) => queue.id === "deterministic_failures")?.count).toBe(1);
    expect(snapshot.connections?.portfolio.queues.find((queue) => queue.id === "coverage_gaps")?.connections[0]?.id).toBe("attention-repo");
    expect(snapshot.connections?.portfolio.queues.find((queue) => queue.id === "readiness_blocked")?.connections[0]?.id).toBe("attention-repo");
    expect(snapshot.connections?.portfolio.queues.find((queue) => queue.id === "security_risks")?.connections[0]?.id).toBe("attention-repo");
    expect(snapshot.connections?.portfolio.queues.find((queue) => queue.id === "cost_policy")?.connections.map((item) => item.id)).toContain("attention-repo");
    expect(snapshot.connections?.portfolio.topAttention[0]?.id).toBe("attention-repo");
    expect(connection?.health).toBe("attention");
    expect(connection?.staleReport).toBe(true);
    expect(connection?.latestMutationScore).toBe(0.4);
    expect(connection?.coverageGapCount).toBe(1);
    expect(connection?.highCoverageGapCount).toBe(1);
    expect(connection?.latestRiskSeverity).toBe("critical");
    expect(connection?.latestReadinessStatus).toBe("blocked");
    expect(connection?.latestSecurityScore).toBe(70);
    expect(connection?.latestCostBudgetStatus).toBe("blocked");
    expect(connection?.attention.join(" ")).toContain("Latest deterministic run failed");
    expect(connection?.attention.join(" ")).toContain("Coverage has 1 high-severity gap");
    expect(connection?.attention.join(" ")).toContain("Readiness gate is blocked");
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

  it("executes allowlisted runbook commands through the local API and records sanitized output", async () => {
    const fixture = await makeFixture();
    const calls: Array<{ commandId: string; stepId: string; args: string[]; cwd: string }> = [];
    const server = await startControlPlaneServer({
      repo: fixture.repoRoot,
      config: fixture.configPath,
      port: 0,
      commandRunner: async (input) => {
        calls.push({ commandId: input.commandId, stepId: input.stepId, args: input.args, cwd: input.cwd });
        return {
          exitCode: 0,
          stdout: "doctor ok token=secret-token authorization: Bearer secret-value",
          stderr: "cookie=session-secret"
        };
      }
    });
    try {
      const response = await fetch(`${server.url}/api/runbook/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commandId: "doctor" })
      });
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.execution.status).toBe("passed");
      expect(payload.execution.steps[0].stdout).toContain("[REDACTED]");
      expect(payload.execution.steps[0].stdout).not.toContain("secret-token");
      expect(payload.execution.steps[0].stderr).not.toContain("session-secret");
      expect(calls[0]).toMatchObject({
        commandId: "doctor",
        stepId: "doctor",
        cwd: fixture.repoRoot
      });
      expect(calls[0]?.args).toContain("doctor");
      expect(calls[0]?.args).toContain("--config");
      expect(calls[0]?.args).toContain(path.resolve(fixture.configPath));

      const audit = await readFile(path.join(fixture.repoRoot, ".visual-hive", "control-plane-actions.json"), "utf8");
      expect(audit).toContain('"commandId": "doctor"');
      expect(audit).toContain('"summary"');
      expect(audit).toContain("[REDACTED]");
      expect(audit).not.toContain("secret-value");

      const snapshot = await createControlPlaneSnapshot({ repo: fixture.repoRoot, config: fixture.configPath });
      expect(snapshot.actionHistory?.summary.total).toBe(1);
      expect(snapshot.actionHistory?.summary.passed).toBe(1);
      expect(snapshot.actionHistory?.actions[0]?.commandId).toBe("doctor");
      expect(snapshot.actionHistory?.actions[0]?.steps[0]?.stdout).not.toContain("secret-token");
      expect(snapshot.artifacts.find((artifact) => artifact.path.endsWith("control-plane-actions.json"))?.kind).toBe("json");
    } finally {
      await server.close();
    }
  });

  it("executes Hive export mode previews with fixed no-network args", async () => {
    const fixture = await makeFixture();
    const calls: Array<{ commandId: string; stepId: string; args: string[] }> = [];
    const server = await startControlPlaneServer({
      repo: fixture.repoRoot,
      config: fixture.configPath,
      port: 0,
      commandRunner: async (input) => {
        calls.push({ commandId: input.commandId, stepId: input.stepId, args: input.args });
        return { exitCode: 0, stdout: `${input.stepId} ok`, stderr: "" };
      }
    });
    try {
      for (const commandId of ["hive-export-advisory", "hive-export-measured", "hive-export-repair-request"]) {
        const response = await fetch(`${server.url}/api/runbook/execute`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ commandId })
        });
        const payload = await response.json();
        expect(response.status).toBe(200);
        expect(payload.execution.status).toBe("passed");
      }

      expect(calls.map((call) => `${call.commandId}:${call.stepId}`)).toEqual([
        "hive-export-advisory:hive-export-advisory",
        "hive-export-measured:hive-export-measured",
        "hive-export-repair-request:hive-export-repair-request"
      ]);
      expect(calls[0]?.args.slice(-7)).toEqual(["hive", "export", "--config", path.resolve(fixture.configPath), "--dry-run", "--mode", "advisory"]);
      expect(calls[1]?.args.slice(-7)).toEqual(["hive", "export", "--config", path.resolve(fixture.configPath), "--dry-run", "--mode", "measured"]);
      expect(calls[2]?.args.slice(-7)).toEqual(["hive", "export", "--config", path.resolve(fixture.configPath), "--dry-run", "--mode", "repair_request"]);
    } finally {
      await server.close();
    }
  });

  it("executes run profiles as allowlisted runbook command sequences", async () => {
    const fixture = await makeFixture();
    const calls: Array<{ commandId: string; stepId: string }> = [];
    const server = await startControlPlaneServer({
      repo: fixture.repoRoot,
      config: fixture.configPath,
      port: 0,
      commandRunner: async (input) => {
        calls.push({ commandId: input.commandId, stepId: input.stepId });
        return { exitCode: 0, stdout: `${input.stepId} ok`, stderr: "" };
      }
    });
    try {
      const response = await fetch(`${server.url}/api/runbook/profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: "pr-acceptance" })
      });
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.execution.status).toBe("passed");
      expect(payload.execution.commandExecutions.map((execution: { commandId: string }) => execution.commandId)).toEqual([
        "doctor",
        "plan-pr",
        "run-ci",
        "baselines",
        "readiness",
        "triage-report"
      ]);
      expect(calls.map((call) => `${call.commandId}:${call.stepId}`)).toEqual([
        "doctor:doctor",
        "plan-pr:plan-pr",
        "run-ci:run-ci",
        "baselines:baselines",
        "readiness:readiness",
        "triage-report:triage",
        "triage-report:report"
      ]);

      const snapshot = await createControlPlaneSnapshot({ repo: fixture.repoRoot, config: fixture.configPath });
      expect(snapshot.actionHistory?.summary.total).toBe(6);
      expect(snapshot.actionHistory?.summary.latestCommandId).toBe("triage-report");
    } finally {
      await server.close();
    }
  });

  it("executes the coverage-improvement run profile as an allowlisted recommendation workflow", async () => {
    const fixture = await makeFixture();
    const calls: Array<{ commandId: string; stepId: string; args: string[] }> = [];
    const server = await startControlPlaneServer({
      repo: fixture.repoRoot,
      config: fixture.configPath,
      port: 0,
      commandRunner: async (input) => {
        calls.push({ commandId: input.commandId, stepId: input.stepId, args: input.args });
        return { exitCode: 0, stdout: `${input.stepId} ok`, stderr: "" };
      }
    });
    try {
      const response = await fetch(`${server.url}/api/runbook/profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: "coverage-improvement" })
      });
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.execution.status).toBe("passed");
      expect(payload.execution.commandExecutions.map((execution: { commandId: string }) => execution.commandId)).toEqual([
        "coverage",
        "improve-coverage",
        "test-creation-plan"
      ]);
      expect(calls.map((call) => `${call.commandId}:${call.stepId}`)).toEqual([
        "coverage:coverage",
        "improve-coverage:improve-coverage",
        "test-creation-plan:test-creation-plan"
      ]);
      expect(calls[0]?.args.slice(-3)).toEqual(["coverage", "--config", path.resolve(fixture.configPath)]);
      expect(calls[1]?.args.slice(-3)).toEqual(["improve-coverage", "--config", path.resolve(fixture.configPath)]);
      expect(calls[2]?.args.slice(-3)).toEqual(["test-creation-plan", "--config", path.resolve(fixture.configPath)]);

      const snapshot = await createControlPlaneSnapshot({ repo: fixture.repoRoot, config: fixture.configPath });
      expect(snapshot.actionHistory?.summary.total).toBe(3);
      expect(snapshot.actionHistory?.summary.latestCommandId).toBe("test-creation-plan");
    } finally {
      await server.close();
    }
  });

  it("executes the agent-handoff-review profile as a no-network evidence handoff workflow", async () => {
    const fixture = await makeFixture();
    const calls: Array<{ commandId: string; stepId: string; args: string[] }> = [];
    const server = await startControlPlaneServer({
      repo: fixture.repoRoot,
      config: fixture.configPath,
      port: 0,
      commandRunner: async (input) => {
        calls.push({ commandId: input.commandId, stepId: input.stepId, args: input.args });
        return { exitCode: 0, stdout: `${input.stepId} ok`, stderr: "" };
      }
    });
    try {
      const response = await fetch(`${server.url}/api/runbook/profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: "agent-handoff-review" })
      });
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.execution.status).toBe("passed");
      expect(payload.execution.commandExecutions.map((execution: { commandId: string }) => execution.commandId)).toEqual([
        "evidence",
        "verdict",
        "handoff",
        "hive-export",
        "test-creation-plan",
        "agent-packet"
      ]);
      expect(calls.map((call) => `${call.commandId}:${call.stepId}`)).toEqual([
        "evidence:evidence",
        "verdict:verdict",
        "handoff:handoff",
        "hive-export:hive-export",
        "test-creation-plan:test-creation-plan",
        "agent-packet:agent-packet"
      ]);
      expect(calls[0]?.args.slice(-3)).toEqual(["evidence", "--config", path.resolve(fixture.configPath)]);
      expect(calls[1]?.args.slice(-3)).toEqual(["verdict", "--config", path.resolve(fixture.configPath)]);
      expect(calls[2]?.args.slice(-4)).toEqual(["handoff", "--config", path.resolve(fixture.configPath), "--dry-run"]);
      expect(calls[3]?.args.slice(-5)).toEqual(["hive", "export", "--config", path.resolve(fixture.configPath), "--dry-run"]);
      expect(calls[5]?.args.slice(-5)).toEqual(["agent-packet", "--config", path.resolve(fixture.configPath), "--profile", "repair_agent"]);
    } finally {
      await server.close();
    }
  });

  it("executes the operational-pipeline profile as a bounded PR-safe artifact chain", async () => {
    const fixture = await makeFixture();
    const calls: Array<{ commandId: string; stepId: string; args: string[] }> = [];
    const server = await startControlPlaneServer({
      repo: fixture.repoRoot,
      config: fixture.configPath,
      port: 0,
      commandRunner: async (input) => {
        calls.push({ commandId: input.commandId, stepId: input.stepId, args: input.args });
        return { exitCode: 0, stdout: `${input.stepId} ok`, stderr: "" };
      }
    });
    try {
      const response = await fetch(`${server.url}/api/runbook/profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: "operational-pipeline" })
      });
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.execution.status).toBe("passed");
      expect(payload.execution.commandExecutions.map((execution: { commandId: string }) => execution.commandId)).toEqual(["pipeline"]);
      expect(calls.map((call) => `${call.commandId}:${call.stepId}`)).toEqual(["pipeline:pipeline"]);
      expect(calls[0]?.args.slice(-10)).toEqual([
        "pipeline",
        "--config",
        path.resolve(fixture.configPath),
        "--mode",
        "pr",
        "--ci",
        "--skip-install",
        "--skip-build",
        "--enforce-mutation",
        "--continue-on-error"
      ]);

      const snapshot = await createControlPlaneSnapshot({ repo: fixture.repoRoot, config: fixture.configPath });
      expect(snapshot.actionHistory?.summary.total).toBe(1);
      expect(snapshot.actionHistory?.summary.latestCommandId).toBe("pipeline");
    } finally {
      await server.close();
    }
  });

  it("executes the portfolio-refresh profile as an allowlisted governance workflow", async () => {
    const fixture = await makeFixture();
    const calls: Array<{ commandId: string; stepId: string; args: string[] }> = [];
    const server = await startControlPlaneServer({
      repo: fixture.repoRoot,
      config: fixture.configPath,
      port: 0,
      commandRunner: async (input) => {
        calls.push({ commandId: input.commandId, stepId: input.stepId, args: input.args });
        return { exitCode: 0, stdout: `${input.stepId} ok`, stderr: "" };
      }
    });
    try {
      const response = await fetch(`${server.url}/api/runbook/profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: "portfolio-refresh" })
      });
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.execution.status).toBe("passed");
      expect(payload.execution.commandExecutions.map((execution: { commandId: string }) => execution.commandId)).toEqual([
        "security",
        "costs",
        "readiness",
        "connections-portfolio"
      ]);
      expect(calls.map((call) => `${call.commandId}:${call.stepId}`)).toEqual([
        "security:security",
        "costs:costs",
        "readiness:readiness",
        "connections-portfolio:connections-portfolio"
      ]);
      expect(calls.at(-1)?.args.slice(-5)).toEqual([
        "connections",
        "list",
        "--config",
        path.resolve(fixture.configPath),
        "--write"
      ]);

      const snapshot = await createControlPlaneSnapshot({ repo: fixture.repoRoot, config: fixture.configPath });
      expect(snapshot.actionHistory?.summary.total).toBe(4);
      expect(snapshot.actionHistory?.summary.latestCommandId).toBe("connections-portfolio");
    } finally {
      await server.close();
    }
  });

  it("executes the provider-governance profile as no-network provider handoff workflow", async () => {
    const fixture = await makeFixture();
    const calls: Array<{ commandId: string; stepId: string; args: string[] }> = [];
    const server = await startControlPlaneServer({
      repo: fixture.repoRoot,
      config: fixture.configPath,
      port: 0,
      commandRunner: async (input) => {
        calls.push({ commandId: input.commandId, stepId: input.stepId, args: input.args });
        return { exitCode: 0, stdout: `${input.stepId} ok`, stderr: "" };
      }
    });
    try {
      const response = await fetch(`${server.url}/api/runbook/profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: "provider-governance" })
      });
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.execution.status).toBe("passed");
      expect(payload.execution.commandExecutions.map((execution: { commandId: string }) => execution.commandId)).toEqual([
        "providers",
        "provider-plan",
        "provider-handoff",
        "costs",
        "readiness"
      ]);
      expect(calls.map((call) => `${call.commandId}:${call.stepId}`)).toEqual([
        "providers:providers",
        "provider-plan:provider-plan",
        "provider-handoff:provider-handoff",
        "costs:costs",
        "readiness:readiness"
      ]);
      expect(calls[0]?.args.slice(-5)).toEqual(["providers", "list", "--config", path.resolve(fixture.configPath), "--mock-results"]);
      expect(calls[1]?.args.slice(-6)).toEqual(["providers", "plan", "--config", path.resolve(fixture.configPath), "--provider", "argos"]);
      expect(calls[2]?.args.slice(-6)).toEqual(["providers", "handoff", "--config", path.resolve(fixture.configPath), "--provider", "argos"]);

      const snapshot = await createControlPlaneSnapshot({ repo: fixture.repoRoot, config: fixture.configPath });
      expect(snapshot.actionHistory?.summary.total).toBe(5);
      expect(snapshot.actionHistory?.summary.latestCommandId).toBe("readiness");
    } finally {
      await server.close();
    }
  });

  it("blocks guidance-only protected run profiles", async () => {
    const fixture = await makeFixture();
    const server = await startControlPlaneServer({ repo: fixture.repoRoot, config: fixture.configPath, port: 0 });
    try {
      const response = await fetch(`${server.url}/api/runbook/profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: "protected-schedule-preview" })
      });
      const payload = await response.json();

      expect(response.status).toBe(403);
      expect(payload.execution.status).toBe("blocked");
      expect(payload.execution.message).toContain("not available");
    } finally {
      await server.close();
    }
  });

  it("blocks runbook execution in read-only mode", async () => {
    const fixture = await makeFixture();
    let called = false;
    const server = await startControlPlaneServer({
      repo: fixture.repoRoot,
      config: fixture.configPath,
      port: 0,
      readOnly: true,
      commandRunner: async () => {
        called = true;
        return { exitCode: 0, stdout: "", stderr: "" };
      }
    });
    try {
      const response = await fetch(`${server.url}/api/runbook/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commandId: "doctor" })
      });
      const payload = await response.json();

      expect(response.status).toBe(403);
      expect(payload.execution.status).toBe("blocked");
      expect(payload.execution.message).toContain("read-only");
      expect(called).toBe(false);
    } finally {
      await server.close();
    }
  });

  it("keeps trusted protected runbook commands guidance-only", async () => {
    const fixture = await makeFixture();
    const config = await readFile(fixture.configPath, "utf8");
    await writeFile(
      fixture.configPath,
      config.replace(
        "contracts:\n",
        `  liveCluster:
    kind: protected
    url: "https://cluster.example.invalid"
    requiresSecrets:
      - KUBECONFIG
    schedule: "0 6 * * *"
    cost: expensive
contracts:
`
      ),
      "utf8"
    );
    let called = false;
    const server = await startControlPlaneServer({
      repo: fixture.repoRoot,
      config: fixture.configPath,
      port: 0,
      commandRunner: async () => {
        called = true;
        return { exitCode: 0, stdout: "", stderr: "" };
      }
    });
    try {
      const response = await fetch(`${server.url}/api/runbook/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commandId: "schedule-protected" })
      });
      const payload = await response.json();

      expect(response.status).toBe(403);
      expect(payload.execution.status).toBe("blocked");
      expect(payload.execution.message).toContain("guidance-only");
      expect(JSON.stringify(payload)).not.toContain("secret-token");
      expect(called).toBe(false);
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

  it("serves the built React UI, static assets, and snapshot API", async () => {
    const fixture = await makeFixture();
    const server = await startControlPlaneServer({ repo: fixture.repoRoot, config: fixture.configPath, port: 0, readOnly: true });
    try {
      const pageResponse = await fetch(server.url);
      expect(pageResponse.status).toBe(200);
      const page = await pageResponse.text();
      expect(page).toContain("Visual Hive Control Plane");
      expect(page).toContain('id="root"');
      const assetPaths = Array.from(page.matchAll(/(?:src|href)="([^"]*\/assets\/[^"]+)"/g)).map((match) => match[1]);
      const jsAsset = assetPaths.find((asset) => asset.endsWith(".js"));
      const cssAsset = assetPaths.find((asset) => asset.endsWith(".css"));
      expect(jsAsset).toBeTruthy();
      expect(cssAsset).toBeTruthy();

      const appJs = await fetch(`${server.url}${jsAsset}`).then((response) => response.text());
      expect(appJs).toContain("Visual Hive");
      expect(appJs).toContain("Control Plane");
      expect(appJs).toContain("Quality cockpit");
      expect(appJs).toContain("What should I do next?");
      expect(appJs).toContain("Visual Hive verdict");
      expect(appJs).toContain("Why Visual Hive reached this verdict");
      expect(appJs).toContain("Blocked evidence");
      expect(appJs).toContain("Expert console");
      expect(appJs).toContain("Failure Inbox");
      expect(appJs).toContain("Baselines");
      expect(appJs).toContain("/api/runbook/execute");
      expect(appJs).toContain("/api/providers/decision");
      expect(appJs).toContain("/api/llm/decision");
      expect(appJs).toContain("Approve actual screenshot as the new baseline");

      const css = await fetch(`${server.url}${cssAsset}`).then((response) => response.text());
      expect(css).toContain("--vh-amber");
      expect(css).toContain(".app-shell");

      const blockedAsset = await fetch(`${server.url}/assets/..%2Fserver.js`);
      expect(blockedAsset.status).toBe(404);

      const snapshot = await fetch(`${server.url}/api/snapshot`).then((response) => response.json());
      expect(snapshot.config.project.name).toBe("ui-fixture");
      expect(snapshot.setupRecommendation.playwright.status).toBe("present");
      expect(snapshot.setupRecommendation.detectedRoutes[0].route).toBe("/clusters");
      expect(snapshot.setupRecommendation.setupActions[0].id).toBe("use-free-local-setup");
      expect(snapshot.setupRecommendation.detectedStories[0].route).toBe("/iframe.html?id=dashboard-dashboardcard--primary&viewMode=story");
      expect(snapshot.setupRecommendation.detectedWorkflows[0].usesPullRequestTarget).toBe(true);
      expect(snapshot.setupRecommendation.workflowPreviews[0].path).toBe(".github/workflows/visual-hive-pr.yml");
    } finally {
      await server.close();
    }
  });

  it("ships a Control Plane bundle with all primary views represented", async () => {
    const fixture = await makeFixture();
    const server = await startControlPlaneServer({ repo: fixture.repoRoot, config: fixture.configPath, port: 0, readOnly: true });
    try {
      const page = await fetch(server.url).then((response) => response.text());
      const jsAsset = Array.from(page.matchAll(/(?:src|href)="([^"]*\/assets\/[^"]+)"/g))
        .map((match) => match[1])
        .find((asset) => asset.endsWith(".js"));
      expect(jsAsset).toBeTruthy();
      const appJs = await fetch(`${server.url}${jsAsset}`).then((response) => response.text());
      for (const expected of [
        "Quality cockpit",
        "What should I do next?",
        "Visual Hive verdict",
        "Why Visual Hive reached this verdict",
        "Blocked evidence",
        "Run PR-safe checks",
        "Review visual changes",
        "Expert console",
        "Operational pipeline",
        "Packet chain",
        "Start",
        "Run",
        "Review",
        "Configure",
        "Run center",
        "First-run guide",
        "Raw snapshot evidence",
        "Readiness",
        "Risk",
        "Security",
        "Costs",
        "Setup",
        "Current report",
        "Failure Inbox",
        "Baselines",
        "Mutation",
        "Coverage",
        "Flows",
        "Targets",
        "Contracts",
        "Schedule",
        "LLM",
        "Providers",
        "GitHub / CI",
        "Connections",
        "Artifacts"
      ]) {
        expect(appJs).toContain(expected);
      }
    } finally {
      await server.close();
    }
  });
  it("approves a baseline through the local API when write mode is enabled", async () => {
    const fixture = await makeFixture();
    const server = await startControlPlaneServer({ repo: fixture.repoRoot, config: fixture.configPath, port: 0 });
    try {
      const response = await fetch(`${server.url}/api/baseline/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contractId: "dashboard", screenshotName: "dashboard", viewport: "desktop", confirm: true })
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
        body: JSON.stringify({ contractId: "dashboard", screenshotName: "dashboard", viewport: "desktop", reason: "Needs design review", confirm: true })
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

  it("requires explicit confirmation before baseline approval or rejection", async () => {
    const fixture = await makeFixture();
    const server = await startControlPlaneServer({ repo: fixture.repoRoot, config: fixture.configPath, port: 0 });
    try {
      const approval = await fetch(`${server.url}/api/baseline/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contractId: "dashboard", screenshotName: "dashboard", viewport: "desktop" })
      });
      await expect(approval.text()).resolves.toContain("Baseline approval requires explicit confirmation");
      expect(approval.status).toBe(400);

      const rejection = await fetch(`${server.url}/api/baseline/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contractId: "dashboard", screenshotName: "dashboard", viewport: "desktop", reason: "Needs review" })
      });
      await expect(rejection.text()).resolves.toContain("Baseline rejection requires explicit confirmation");
      expect(rejection.status).toBe(400);

      await expect(readFile(path.join(fixture.repoRoot, ".visual-hive", "snapshots", "dashboard.png"), "utf8")).resolves.toBe("old-dashboard");
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

  it("previews and applies coverage recommendation config edits through the local API", async () => {
    const fixture = await makeFixture();
    await writeCoverageRecommendationFixture(fixture.repoRoot);
    const originalConfig = await readFile(fixture.configPath, "utf8");
    const server = await startControlPlaneServer({ repo: fixture.repoRoot, config: fixture.configPath, port: 0 });
    try {
      const preview = await fetch(`${server.url}/api/coverage/apply-recommendation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recommendationId: "changed-file-rule:src/auth/Login.tsx" })
      });
      const previewPayload = await preview.json();
      expect(preview.status).toBe(200);
      expect(previewPayload.saved).toBe(false);
      expect(previewPayload.applyResult.diff).toContain("+    - pattern: src/auth/**");
      await expect(readFile(fixture.configPath, "utf8")).resolves.toBe(originalConfig);

      const applied = await fetch(`${server.url}/api/coverage/apply-recommendation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recommendationId: "changed-file-rule:src/auth/Login.tsx", confirm: true })
      });
      const appliedPayload = await applied.json();
      expect(applied.status).toBe(200);
      expect(appliedPayload.saved).toBe(true);
      expect(appliedPayload.config.auditPath).toBe(".visual-hive/config-edits.json");
      await expect(readFile(fixture.configPath, "utf8")).resolves.toContain("pattern: src/auth/**");
      await expect(readFile(path.join(fixture.repoRoot, ".visual-hive", "config-edits.json"), "utf8")).resolves.toContain("src/auth/**");
    } finally {
      await server.close();
    }
  });

  it("allows coverage recommendation previews but blocks applying them in read-only mode", async () => {
    const fixture = await makeFixture();
    await writeCoverageRecommendationFixture(fixture.repoRoot);
    const server = await startControlPlaneServer({ repo: fixture.repoRoot, config: fixture.configPath, port: 0, readOnly: true });
    try {
      const preview = await fetch(`${server.url}/api/coverage/apply-recommendation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recommendationId: "changed-file-rule:src/auth/Login.tsx" })
      });
      expect(preview.status).toBe(200);

      const blocked = await fetch(`${server.url}/api/coverage/apply-recommendation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recommendationId: "changed-file-rule:src/auth/Login.tsx", confirm: true })
      });
      const blockedPayload = await blocked.json();
      expect(blocked.status).toBe(403);
      expect(blockedPayload.error).toContain("read-only");
      await expect(readFile(fixture.configPath, "utf8")).resolves.not.toContain("src/auth/**");
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

  it("regenerates setup recommendations for an explicit setup profile", async () => {
    const fixture = await makeFixture();
    const server = await startControlPlaneServer({ repo: fixture.repoRoot, config: fixture.configPath, port: 0 });
    try {
      const response = await fetch(`${server.url}/api/setup/recommend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: "hosted-review" })
      });
      const responseText = await response.text();
      expect(response.status, responseText).toBe(200);
      const payload = JSON.parse(responseText);
      expect(payload.ok).toBe(true);
      expect(payload.profile).toBe("hosted-review");
      expect(payload.recommendationPath).toBe(".visual-hive/recommendations.json");
      expect(payload.costEstimate.externalScreenshotsPerRun).toBeGreaterThan(0);

      const recommendation = JSON.parse(await readFile(path.join(fixture.repoRoot, ".visual-hive", "recommendations.json"), "utf8"));
      expect(recommendation.setupProfile).toBe("hosted-review");
      expect(recommendation.providerRecommendations.find((provider: { providerId: string }) => provider.providerId === "percy")?.recommendation).toBe(
        "optional"
      );
      const snapshot = await createControlPlaneSnapshot({ repo: fixture.repoRoot, config: fixture.configPath });
      expect(snapshot.setupRecommendation?.setupProfile).toBe("hosted-review");
    } finally {
      await server.close();
    }
  });

  it("rejects invalid setup profiles without changing recommendations", async () => {
    const fixture = await makeFixture();
    const before = await readFile(path.join(fixture.repoRoot, ".visual-hive", "recommendations.json"), "utf8");
    const server = await startControlPlaneServer({ repo: fixture.repoRoot, config: fixture.configPath, port: 0 });
    try {
      const response = await fetch(`${server.url}/api/setup/recommend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: "paid-everything" })
      });
      const payload = await response.json();
      expect(response.status).toBe(400);
      expect(payload.error).toContain("Invalid setup profile");
      expect(payload.error).toContain("free-local");
      await expect(readFile(path.join(fixture.repoRoot, ".visual-hive", "recommendations.json"), "utf8")).resolves.toBe(before);
    } finally {
      await server.close();
    }
  });

  it("writes recommended setup docs from setup artifact with audit and overwrite protection", async () => {
    const fixture = await makeFixture();
    const server = await startControlPlaneServer({ repo: fixture.repoRoot, config: fixture.configPath, port: 0 });
    try {
      const response = await fetch(`${server.url}/api/setup/write-docs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true })
      });
      const responseText = await response.text();
      expect(response.status, responseText).toBe(200);
      const payload = JSON.parse(responseText);
      expect(payload.ok).toBe(true);
      expect(payload.docsPath).toBe("docs/visual-hive.md");
      expect(payload.recommendationPath).toBe(".visual-hive/recommendations.json");
      expect(payload.auditPath).toBe(".visual-hive/setup-doc-edits.json");
      expect(payload.overwritten).toBe(false);

      const docs = await readFile(path.join(fixture.repoRoot, "docs", "visual-hive.md"), "utf8");
      expect(docs).toContain("# Visual Hive");
      expect(docs).toContain("PR checks should run with read-only permissions");
      expect(docs).toContain("Playwright built-in");
      const audit = await readFile(path.join(fixture.repoRoot, ".visual-hive", "setup-doc-edits.json"), "utf8");
      expect(audit).toContain("setup-recommendation");
      expect(audit).toContain("docs/visual-hive.md");

      const blocked = await fetch(`${server.url}/api/setup/write-docs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true })
      });
      const blockedPayload = await blocked.json();
      expect(blocked.status).toBe(400);
      expect(blockedPayload.error).toContain("Refusing to overwrite existing Visual Hive docs");

      const forced = await fetch(`${server.url}/api/setup/write-docs`, {
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

  it("writes a full setup PR bundle from setup recommendations when files are missing", async () => {
    const fixture = await makeFixture();
    await rm(fixture.configPath);
    await rm(path.join(fixture.repoRoot, ".github", "workflows", "visual-hive-pr.yml"), { force: true });
    const server = await startControlPlaneServer({ repo: fixture.repoRoot, config: fixture.configPath, port: 0 });
    try {
      const response = await fetch(`${server.url}/api/setup/write-bundle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true })
      });
      const responseText = await response.text();
      expect(response.status, responseText).toBe(200);
      const payload = JSON.parse(responseText);
      expect(payload.ok).toBe(true);
      expect(payload.auditPath).toBe(".visual-hive/setup-bundle-edits.json");
      expect(payload.config.configPath).toBe("visual-hive.config.yaml");
      expect(payload.docs.docsPath).toBe("docs/visual-hive.md");
      expect(payload.workflows.written.map((entry: { path: string }) => entry.path).sort()).toEqual([
        ".github/workflows/visual-hive-failure-issue.yml",
        ".github/workflows/visual-hive-hive-handoff.yml",
        ".github/workflows/visual-hive-pr.yml",
        ".github/workflows/visual-hive-scheduled.yml"
      ]);

      await expect(readFile(fixture.configPath, "utf8")).resolves.toContain("name: ui-fixture");
      await expect(readFile(path.join(fixture.repoRoot, "docs", "visual-hive.md"), "utf8")).resolves.toContain("## PR Lane");
      await expect(readFile(path.join(fixture.repoRoot, ".github", "workflows", "visual-hive-pr.yml"), "utf8")).resolves.toContain("pull_request");
      await expect(readFile(path.join(fixture.repoRoot, ".github", "workflows", "visual-hive-scheduled.yml"), "utf8")).resolves.toContain(
        "workflow_dispatch"
      );
      await expect(readFile(path.join(fixture.repoRoot, ".github", "workflows", "visual-hive-failure-issue.yml"), "utf8")).resolves.toContain(
        "workflow_run"
      );
      const audit = await readFile(path.join(fixture.repoRoot, ".visual-hive", "setup-bundle-edits.json"), "utf8");
      expect(audit).toContain("setup-recommendation");
      expect(audit).toContain("docs/visual-hive.md");
      expect(audit).toContain(".github/workflows/visual-hive-pr.yml");
    } finally {
      await server.close();
    }
  });

  it("protects setup bundle files from accidental overwrite unless force is confirmed", async () => {
    const fixture = await makeFixture();
    const server = await startControlPlaneServer({ repo: fixture.repoRoot, config: fixture.configPath, port: 0 });
    try {
      const blocked = await fetch(`${server.url}/api/setup/write-bundle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true })
      });
      const blockedPayload = await blocked.json();
      expect(blocked.status).toBe(400);
      expect(blockedPayload.error).toContain("Refusing to write setup bundle because files already exist");

      const forced = await fetch(`${server.url}/api/setup/write-bundle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true, force: true })
      });
      const forcedPayload = await forced.json();
      expect(forced.status).toBe(200);
      expect(forcedPayload.overwritten).toBe(true);
      await expect(readFile(path.join(fixture.repoRoot, ".visual-hive", "setup-bundle-edits.json"), "utf8")).resolves.toContain("force");
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

  it("records provider decisions without making external provider calls", async () => {
    const fixture = await makeFixture();
    const server = await startControlPlaneServer({ repo: fixture.repoRoot, config: fixture.configPath, port: 0 });
    try {
      const response = await fetch(`${server.url}/api/providers/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId: "argos",
          decision: "skip",
          reason: "No hosted review yet; token=secret-value",
          confirm: true
        })
      });
      const responseText = await response.text();
      expect(response.status, responseText).toBe(200);
      const payload = JSON.parse(responseText);
      expect(payload.ok).toBe(true);
      expect(payload.decisionPath).toBe(".visual-hive/provider-decisions.json");
      expect(payload.decision).toMatchObject({
        providerId: "argos",
        label: "Argos",
        decision: "skip",
        source: "control-plane",
        externalCallsMade: 0
      });
      expect(payload.decision.reason).toContain("[REDACTED]");

      const log = JSON.parse(await readFile(path.join(fixture.repoRoot, ".visual-hive", "provider-decisions.json"), "utf8"));
      expect(log.decisions[0]).toMatchObject({ providerId: "argos", decision: "skip", externalCallsMade: 0 });
      expect(log.decisions[0].reason).not.toContain("secret-value");

      const snapshot = await createControlPlaneSnapshot({ repo: fixture.repoRoot, config: fixture.configPath });
      expect(snapshot.providerDecisionLog?.decisions[0]?.decision).toBe("skip");
      expect(snapshot.artifacts.find((artifact) => artifact.path.endsWith("provider-decisions.json"))?.labels).toContain("provider-decisions");
    } finally {
      await server.close();
    }
  });

  it("writes provider setup plans without making external provider calls", async () => {
    const fixture = await makeFixture();
    const server = await startControlPlaneServer({ repo: fixture.repoRoot, config: fixture.configPath, port: 0 });
    try {
      const response = await fetch(`${server.url}/api/providers/setup-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId: "argos",
          confirm: true
        })
      });
      const responseText = await response.text();
      expect(response.status, responseText).toBe(200);
      const payload = JSON.parse(responseText);
      expect(payload.ok).toBe(true);
      expect(payload.planPath).toBe(".visual-hive/provider-setup-plan.json");
      expect(payload.plan).toMatchObject({
        schemaVersion: 1,
        providerId: "argos",
        label: "Argos",
        recommendation: "keep_disabled",
        authorizationRequired: true,
        externalCallsMade: 0
      });
      expect(payload.plan.readiness.requiredEnv).toEqual(["ARGOS_TOKEN"]);
      expect(JSON.stringify(payload)).not.toContain("secret-value");

      const plan = JSON.parse(await readFile(path.join(fixture.repoRoot, ".visual-hive", "provider-setup-plan.json"), "utf8"));
      expect(plan.providerId).toBe("argos");
      expect(plan.externalCallsMade).toBe(0);
      expect(plan.validationCommands).toContain("visual-hive providers list --mock-results");

      const snapshot = await createControlPlaneSnapshot({ repo: fixture.repoRoot, config: fixture.configPath });
      expect(snapshot.providerSetupPlan?.providerId).toBe("argos");
      expect(snapshot.artifacts.find((artifact) => artifact.path.endsWith("provider-setup-plan.json"))?.labels).toContain("provider-setup-plan");
    } finally {
      await server.close();
    }
  });

  it("rejects unconfirmed, unknown, and invalid provider decisions", async () => {
    const fixture = await makeFixture();
    const server = await startControlPlaneServer({ repo: fixture.repoRoot, config: fixture.configPath, port: 0 });
    try {
      const unconfirmed = await fetch(`${server.url}/api/providers/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: "argos", decision: "skip" })
      });
      expect(unconfirmed.status).toBe(400);

      const unknown = await fetch(`${server.url}/api/providers/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: "unknown-provider", decision: "skip", confirm: true })
      });
      expect(unknown.status).toBe(404);

      const invalid = await fetch(`${server.url}/api/providers/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: "argos", decision: "enable_now", confirm: true })
      });
      const invalidPayload = await invalid.json();
      expect(invalid.status).toBe(400);
      expect(invalidPayload.error).toContain("Invalid provider decision");
      await expect(readFile(path.join(fixture.repoRoot, ".visual-hive", "provider-decisions.json"), "utf8")).rejects.toMatchObject({
        code: "ENOENT"
      });
    } finally {
      await server.close();
    }
  });

  it("rejects unconfirmed, unknown, and read-only provider setup planning", async () => {
    const fixture = await makeFixture();
    const server = await startControlPlaneServer({ repo: fixture.repoRoot, config: fixture.configPath, port: 0 });
    const readOnlyServer = await startControlPlaneServer({ repo: fixture.repoRoot, config: fixture.configPath, port: 0, readOnly: true });
    try {
      const unconfirmed = await fetch(`${server.url}/api/providers/setup-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: "argos" })
      });
      expect(unconfirmed.status).toBe(400);

      const unknown = await fetch(`${server.url}/api/providers/setup-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: "unknown-provider", confirm: true })
      });
      expect(unknown.status).toBe(404);

      const readOnly = await fetch(`${readOnlyServer.url}/api/providers/setup-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: "argos", confirm: true })
      });
      const readOnlyPayload = await readOnly.json();
      expect(readOnly.status).toBe(403);
      expect(readOnlyPayload.error).toContain("read-only");

      await expect(readFile(path.join(fixture.repoRoot, ".visual-hive", "provider-setup-plan.json"), "utf8")).rejects.toMatchObject({
        code: "ENOENT"
      });
    } finally {
      await server.close();
      await readOnlyServer.close();
    }
  });

  it("records LLM governance decisions without making model calls", async () => {
    const fixture = await makeFixture();
    const server = await startControlPlaneServer({ repo: fixture.repoRoot, config: fixture.configPath, port: 0 });
    try {
      const response = await fetch(`${server.url}/api/llm/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision: "keep_disabled",
          reason: "No LLM calls before review; token=secret-value",
          confirm: true
        })
      });
      const responseText = await response.text();
      expect(response.status, responseText).toBe(200);
      const payload = JSON.parse(responseText);
      expect(payload.ok).toBe(true);
      expect(payload.decisionPath).toBe(".visual-hive/llm-decisions.json");
      expect(payload.decision).toMatchObject({
        decision: "keep_disabled",
        source: "control-plane",
        externalCallsMade: 0
      });
      expect(payload.decision.reason).toContain("[REDACTED]");

      const log = JSON.parse(await readFile(path.join(fixture.repoRoot, ".visual-hive", "llm-decisions.json"), "utf8"));
      expect(log.decisions[0]).toMatchObject({ decision: "keep_disabled", externalCallsMade: 0 });
      expect(log.decisions[0].reason).not.toContain("secret-value");

      const snapshot = await createControlPlaneSnapshot({ repo: fixture.repoRoot, config: fixture.configPath });
      expect(snapshot.llmDecisionLog?.decisions[0]?.decision).toBe("keep_disabled");
      expect(snapshot.artifacts.find((artifact) => artifact.path.endsWith("llm-decisions.json"))?.labels).toContain("llm-decisions");
    } finally {
      await server.close();
    }
  });

  it("rejects unconfirmed and invalid LLM decisions", async () => {
    const fixture = await makeFixture();
    const server = await startControlPlaneServer({ repo: fixture.repoRoot, config: fixture.configPath, port: 0 });
    try {
      const unconfirmed = await fetch(`${server.url}/api/llm/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "keep_disabled" })
      });
      expect(unconfirmed.status).toBe(400);

      const invalid = await fetch(`${server.url}/api/llm/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "call_openai_now", confirm: true })
      });
      const invalidPayload = await invalid.json();
      expect(invalid.status).toBe(400);
      expect(invalidPayload.error).toContain("Invalid LLM decision");
      await expect(readFile(path.join(fixture.repoRoot, ".visual-hive", "llm-decisions.json"), "utf8")).rejects.toMatchObject({
        code: "ENOENT"
      });
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
      await expect(readFile(workflowPath, "utf8")).resolves.toContain("DavidDiaz0317/visual-hive/actions/run@main");
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

      const setupRecommendBlocked = await fetch(`${server.url}/api/setup/recommend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: "hosted-review" })
      });
      expect(setupRecommendBlocked.status).toBe(403);

      const setupDocsBlocked = await fetch(`${server.url}/api/setup/write-docs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true, force: true })
      });
      expect(setupDocsBlocked.status).toBe(403);

      const setupBundleBlocked = await fetch(`${server.url}/api/setup/write-bundle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true, force: true })
      });
      expect(setupBundleBlocked.status).toBe(403);

      const workflowsBlocked = await fetch(`${server.url}/api/workflows/write-templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true, force: true })
      });
      expect(workflowsBlocked.status).toBe(403);

      const providerDecisionBlocked = await fetch(`${server.url}/api/providers/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: "argos", decision: "skip", confirm: true })
      });
      expect(providerDecisionBlocked.status).toBe(403);

      const llmDecisionBlocked = await fetch(`${server.url}/api/llm/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "keep_disabled", confirm: true })
      });
      expect(llmDecisionBlocked.status).toBe(403);
    } finally {
      await server.close();
    }
  });
});
