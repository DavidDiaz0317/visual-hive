import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { VisualHiveConfigSchema, type VisualHiveConfig } from "../src/config/schema.js";
import { buildEvidencePacket } from "../src/evidence/build.js";
import { buildIssuesReport } from "../src/issues/build.js";
import { writeIssuePublishArtifacts } from "../src/issues/publish.js";
import {
  VISUAL_HIVE_HIVE_MANAGED_LIFECYCLE,
  VISUAL_HIVE_STANDALONE_LIFECYCLE
} from "../src/issues/lifecycle.js";
import { createPlan } from "../src/planner/createPlan.js";
import type { MutationReport, Report } from "../src/reports/types.js";
import { buildVerdictReport } from "../src/verdict/build.js";

const temporaryRoots: string[] = [];
const now = new Date("2026-07-14T12:00:00.000Z");

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("standalone and Hive-integrated deterministic parity", () => {
  it("uses one planning, observation, finding, mutation, and verdict engine", async () => {
    const standaloneConfig = parityConfig(false);
    const integratedConfig = parityConfig(true);
    const planOptions = {
      mode: "full" as const,
      changedFiles: ["src/dashboard.tsx"],
      now,
      env: {} as NodeJS.ProcessEnv
    };
    const standalonePlan = createPlan(standaloneConfig, planOptions);
    const integratedPlan = createPlan(integratedConfig, planOptions);

    expect(integratedPlan).toEqual(standalonePlan);
    expect(integratedPlan.items.map((item) => item.contractId)).toEqual(["dashboard"]);
    expect(integratedPlan.mutation).toEqual(standalonePlan.mutation);

    const standaloneRoot = await fixtureRoot("standalone", standalonePlan);
    const integratedRoot = await fixtureRoot("integrated", integratedPlan);
    const standalonePacket = await buildEvidencePacket({
      rootDir: standaloneRoot,
      project: standaloneConfig.project.name,
      now,
      hiveConfig: standaloneConfig.integrations.hive
    });
    const integratedPacket = await buildEvidencePacket({
      rootDir: integratedRoot,
      project: integratedConfig.project.name,
      now,
      hiveConfig: integratedConfig.integrations.hive
    });

    expect(withoutHiveProjection(integratedPacket)).toEqual(withoutHiveProjection(standalonePacket));
    expect(integratedPacket.deterministicReport).toEqual(standalonePacket.deterministicReport);
    expect(integratedPacket.mutation).toEqual(standalonePacket.mutation);
    expect(integratedPacket.evidenceContributions).toEqual(standalonePacket.evidenceContributions);
    expect(integratedPacket.verdictSummary).toEqual(standalonePacket.verdictSummary);

    await writeJson(path.join(standaloneRoot, ".visual-hive", "evidence-packet.json"), standalonePacket);
    await writeJson(path.join(integratedRoot, ".visual-hive", "evidence-packet.json"), integratedPacket);
    const standaloneVerdict = await buildVerdictReport({ rootDir: standaloneRoot, project: "parity-fixture", now });
    const integratedVerdict = await buildVerdictReport({ rootDir: integratedRoot, project: "parity-fixture", now });

    expect(integratedVerdict).toEqual(standaloneVerdict);
    expect(integratedVerdict.summary.visualHiveVerdict).toBe("failed");
    expect(integratedVerdict.gatingContributions).toEqual(standaloneVerdict.gatingContributions);

    const standaloneIssues = await buildIssuesReport({
      rootDir: standaloneRoot,
      project: "parity-fixture",
      now,
      lifecycle: VISUAL_HIVE_STANDALONE_LIFECYCLE
    });
    const integratedIssues = await buildIssuesReport({
      rootDir: integratedRoot,
      project: "parity-fixture",
      now,
      lifecycle: VISUAL_HIVE_HIVE_MANAGED_LIFECYCLE
    });
    const { lifecycle: standaloneLifecycle, ...standaloneFindingContract } = standaloneIssues.report;
    const { lifecycle: integratedLifecycle, ...integratedFindingContract } = integratedIssues.report;

    expect(integratedFindingContract).toEqual(standaloneFindingContract);
    expect(standaloneLifecycle).toEqual(VISUAL_HIVE_STANDALONE_LIFECYCLE);
    expect(integratedLifecycle).toEqual(VISUAL_HIVE_HIVE_MANAGED_LIFECYCLE);
    expect(integratedIssues.report.issues.map(findingIdentity)).toEqual(
      standaloneIssues.report.issues.map(findingIdentity)
    );

    await writeJson(path.join(integratedRoot, ".visual-hive", "issues.json"), integratedIssues.report);
    let lifecycleClientCalled = false;
    const managedPublish = await writeIssuePublishArtifacts({
      rootDir: integratedRoot,
      mode: "live",
      githubRepository: "example/parity-fixture",
      env: {
        VISUAL_HIVE_LIVE_GITHUB_ISSUE: "true",
        GITHUB_TOKEN: "must-not-be-used"
      },
      githubClient: {
        async listOpenIssues() {
          lifecycleClientCalled = true;
          return [];
        },
        async createIssue() {
          lifecycleClientCalled = true;
          throw new Error("Hive-managed mode must not create issues directly");
        },
        async updateIssue() {
          lifecycleClientCalled = true;
          throw new Error("Hive-managed mode must not update issues directly");
        }
      }
    });

    expect(lifecycleClientCalled).toBe(false);
    expect(managedPublish.plan.lifecycle).toEqual(VISUAL_HIVE_HIVE_MANAGED_LIFECYCLE);
    expect(managedPublish.result.lifecycle).toEqual(VISUAL_HIVE_HIVE_MANAGED_LIFECYCLE);
    expect(managedPublish.result.status).toBe("managed_by_hive");
    expect(managedPublish.result.networkCallsMade).toBe(0);
  });
});

function parityConfig(hiveEnabled: boolean): VisualHiveConfig {
  return VisualHiveConfigSchema.parse({
    project: { name: "parity-fixture", type: "react-vite", defaultBranch: "main" },
    targets: {
      local: { kind: "url", url: "http://127.0.0.1:4173", prSafe: true, cost: "cheap" }
    },
    contracts: [
      {
        id: "dashboard",
        description: "Dashboard visual and API-state contract",
        target: "local",
        severity: "critical",
        runOn: { pullRequest: true, schedule: true },
        selectors: {
          mustExist: ["main", "[data-testid='dashboard']"],
          textMustNotExist: ["visual-hive api-500 mutation"]
        },
        screenshots: [{ name: "dashboard", route: "/", viewport: "desktop" }]
      }
    ],
    viewports: { desktop: { width: 1440, height: 900 } },
    selection: { changedFiles: [{ pattern: "src/**", contracts: ["dashboard"], risk: "high" }] },
    mutation: { enabled: true, runOn: { schedule: true }, minScore: 0.8, operators: ["api-500"] },
    integrations: { hive: { enabled: hiveEnabled, mode: hiveEnabled ? "full" : "advisory" } }
  });
}

async function fixtureRoot(label: string, plan: ReturnType<typeof createPlan>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), `visual-hive-parity-${label}-`));
  temporaryRoots.push(root);
  await mkdir(path.join(root, ".visual-hive"), { recursive: true });
  await writeJson(path.join(root, ".visual-hive", "plan.json"), plan);
  await writeJson(path.join(root, ".visual-hive", "report.json"), reportFixture());
  await writeJson(path.join(root, ".visual-hive", "mutation-report.json"), mutationFixture());
  return root;
}

function reportFixture(): Report {
  return {
    schemaVersion: 2,
    project: "parity-fixture",
    repository: {
      provider: "github-actions",
      repository: "example/parity-fixture",
      branch: "main",
      commitSha: "0123456789abcdef0123456789abcdef01234567",
      runId: "100",
      runAttempt: "2"
    },
    mode: "full",
    generatedAt: now.toISOString(),
    status: "failed",
    changedFiles: ["src/dashboard.tsx"],
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
        durationMs: 25,
        errors: ["API failure state was visible"],
        artifacts: [".visual-hive/artifacts/screenshots/dashboard.png"],
        reproductionCommand: "visual-hive pipeline --mode full --ci",
        selectorAssertions: [
          {
            kind: "textMustNotExist",
            value: "visual-hive api-500 mutation",
            status: "failed",
            message: "API failure marker was visible"
          }
        ],
        screenshotAssertions: [
          {
            contractId: "dashboard",
            screenshotName: "dashboard",
            name: "dashboard",
            route: "/",
            viewport: "desktop",
            status: "failed",
            baselinePath: ".visual-hive/snapshots/dashboard.png",
            actualPath: ".visual-hive/artifacts/screenshots/dashboard.png",
            diffPath: ".visual-hive/artifacts/diffs/dashboard.png",
            maxDiffPixelRatio: 0.01,
            actualDiffPixelRatio: 0.2,
            actualDiffPixels: 20,
            diffPixels: 20,
            totalPixels: 100
          }
        ],
        consoleErrors: [],
        pageErrors: [],
        networkErrors: []
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
    artifacts: [".visual-hive/artifacts/screenshots/dashboard.png", ".visual-hive/artifacts/diffs/dashboard.png"],
    reproductionCommands: ["visual-hive pipeline --mode full --ci"]
  };
}

function mutationFixture(): MutationReport {
  return {
    schemaVersion: 2,
    project: "parity-fixture",
    generatedAt: now.toISOString(),
    minScore: 0.8,
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
        affected: [{ contractId: "dashboard", targetId: "local", route: "/", component: "dashboard", viewport: "desktop" }],
        durationMs: 10,
        errors: [],
        artifacts: [".visual-hive/mutation-report.json"],
        failedAssertion: "The API failure state was not rejected",
        validationCommand: "visual-hive mutate --enforce-min-score",
        suggestedMissingTest: "Assert that the exact API failure marker is absent.",
        mutationMode: "runtime"
      }
    ]
  };
}

function withoutHiveProjection<T extends { hiveReadiness: unknown }>(packet: T): Omit<T, "hiveReadiness"> {
  const { hiveReadiness: _hiveReadiness, ...shared } = packet;
  void _hiveReadiness;
  return shared;
}

function findingIdentity(issue: {
  dedupeFingerprint: string;
  rootCauseKey: string;
  validationCommand: string;
  reproductionCommand: string;
}): object {
  return {
    dedupeFingerprint: issue.dedupeFingerprint,
    rootCauseKey: issue.rootCauseKey,
    validationCommand: issue.validationCommand,
    reproductionCommand: issue.reproductionCommand
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
