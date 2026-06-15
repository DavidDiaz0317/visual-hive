import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { VisualHiveConfigSchema, type VisualHiveConfig } from "../src/config/schema.js";
import { createPlan } from "../src/planner/createPlan.js";
import { calculateMutationScore } from "../src/mutations/score.js";
import { loadConfig } from "../src/config/load.js";
import { selectContractsForMutation } from "../src/mutations/operators.js";

const tempDirs: string[] = [];

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
    await expect(loadConfig("missing.yaml", process.cwd())).rejects.toThrow(/Missing Visual Hive config/);
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
    const loaded = await loadConfig("examples/kubestellar-console/visual-hive.config.yaml", process.cwd());
    expect(loaded.config.targets.liveCluster.kind).toBe("protected");
    expect(loaded.config.targets.fakeOAuthFullstack.kind).toBe("commandGroup");
  });

  it("selects expected KubeStellar contracts from sample changed files", async () => {
    const loaded = await loadConfig("examples/kubestellar-console/visual-hive.config.yaml", process.cwd());
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
    expect(docsPlan.items.every((item) => item.cost !== "expensive")).toBe(true);
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

  it("selects changed-file contracts", () => {
    const plan = createPlan(sampleConfig(), { mode: "pr", changedFiles: ["src/App.tsx"] });
    expect(plan.items.map((item) => item.contractId)).toContain("changed-contract");
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
});
