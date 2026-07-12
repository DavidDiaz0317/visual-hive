import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { afterEach, describe, expect, it } from "vitest";
import { writeEvidencePacket } from "../src/evidence/build.js";
import { writeIssuesArtifacts } from "../src/issues/build.js";
import { writeRepoMap } from "../src/repo/analyze.js";
import { writeTestCreationPlan } from "../src/testCreation/build.js";

const temporaryRoots: string[] = [];
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("repository unit-test evidence", () => {
  it("keeps runner-only Vitest partial until a real unit file resolves the canonical issue", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "visual-hive-unit-evidence-"));
    temporaryRoots.push(rootDir);
    await Promise.all([
      mkdir(path.join(rootDir, "src"), { recursive: true }),
      mkdir(path.join(rootDir, "tests", "e2e"), { recursive: true }),
      mkdir(path.join(rootDir, "tests_py"), { recursive: true }),
      mkdir(path.join(rootDir, "service"), { recursive: true }),
      mkdir(path.join(rootDir, "archive"), { recursive: true }),
      mkdir(path.join(rootDir, "tests", "integration"), { recursive: true }),
      mkdir(path.join(rootDir, "components"), { recursive: true }),
      mkdir(path.join(rootDir, ".visual-hive"), { recursive: true }),
      mkdir(path.join(rootDir, "dist"), { recursive: true })
    ]);
    await writeFile(path.join(rootDir, "package.json"), `${JSON.stringify({
      name: "runner-only-fixture",
      private: true,
      scripts: { test: "vitest run --passWithNoTests", "test:python": "python -m pytest -q" },
      devDependencies: { vitest: "^4.0.0", jest: "^30.0.0", "@playwright/test": "^1.0.0" }
    }, null, 2)}\n`, "utf8");
    await writeFile(path.join(rootDir, "src", "metrics.ts"), "export const twice = (value: number) => value * 2;\n", "utf8");
    await writeFile(path.join(rootDir, "service", "metrics.py"), "def twice(value: int) -> int:\n    return value * 2\n", "utf8");
    await writeFile(path.join(rootDir, "tests_py", "test_metrics.py"), "from unittest.mock import patch\nfrom service.metrics import twice\n\ndef test_twice():\n    assert twice(2) == 4\n", "utf8");
    await writeFile(path.join(rootDir, "pyproject.toml"), "[project]\nname = 'runner-only-python'\ndependencies = ['pytest==8.3.4']\n[tool.pytest.ini_options]\ntestpaths = ['tests_py']\naddopts = ['-ra', '--strict-markers']\n", "utf8");
    await writeFile(path.join(rootDir, "tests", "e2e", "dashboard.spec.ts"), "import { test, expect } from '@playwright/test';\ntest('dashboard', async ({ page }) => { await page.goto('/'); await expect(page).toHaveTitle(/dashboard/i); });\n", "utf8");
    await writeFile(path.join(rootDir, "archive", "legacy.test.ts"), "import { it } from 'vitest';\nit('legacy', () => {});\n", "utf8");
    await writeFile(path.join(rootDir, "tests", "integration", "api.ts"), "export const integrationFixture = true;\n", "utf8");
    await writeFile(path.join(rootDir, "components", "test_widget.py"), "import pytest\n\ndef test_mount_text_is_not_component_classification():\n    assert 'mount(' == 'mount('\n", "utf8");
    await writeFile(path.join(rootDir, "playwright.config.ts"), "export default {};\n", "utf8");
    await writeFile(path.join(rootDir, "vitest.config.ts"), "export default { test: { include: ['src/**/*.test.{ts,tsx}'] } };\n", "utf8");
    await writeFile(path.join(rootDir, ".visual-hive", "generated.test.ts"), "throw new Error('not repository evidence');\n", "utf8");
    await writeFile(path.join(rootDir, "dist", "copied.test.ts"), "throw new Error('generated output');\n", "utf8");

    const firstRepo = await writeRepoMap({ repoRoot: rootDir, now: new Date("2026-07-12T01:00:00.000Z") });
    expect(firstRepo.report.testTools).toEqual(expect.arrayContaining(["vitest", "playwright"]));
    expect(firstRepo.report.testFiles).toContainEqual({
      path: "tests/e2e/dashboard.spec.ts",
      kind: "e2e",
      runtime: "javascript",
      scope: ".",
      tools: ["playwright"],
      runnerEligible: true,
      eligibilityEvidence: ["runner:playwright:default-discovery"]
    });
    expect(firstRepo.report.testFiles.some((file) => file.path === "tests/integration/api.ts")).toBe(false);
    expect(firstRepo.report.testFiles.find((file) => file.path === "components/test_widget.py")).toMatchObject({ kind: "unit", runtime: "python", runnerEligible: false });
    expect(firstRepo.report.testFiles).toContainEqual({
      path: "tests_py/test_metrics.py",
      kind: "unit",
      runtime: "python",
      scope: ".",
      tools: ["unittest"],
      runnerEligible: true,
      eligibilityEvidence: ["runner:pytest:matched-testpaths"]
    });
    expect(firstRepo.report.testFiles).toContainEqual({
      path: "archive/legacy.test.ts",
      kind: "unit",
      runtime: "javascript",
      scope: ".",
      tools: ["vitest"],
      runnerEligible: false,
      eligibilityEvidence: ["runner:vitest:outside-include"]
    });
    expect(firstRepo.report.testFiles.some((file) => /config|generated|dist/u.test(file.path))).toBe(false);
    const firstUnitGaps = firstRepo.report.coverageGaps.filter((gap) => gap.id === "unit-layer");
    expect(firstUnitGaps).toHaveLength(1);
    expect(firstUnitGaps[0]?.message).toContain("no matching executable unit test file");
    await expectRepoMapSchema(firstRepo.report);

    const firstEvidence = await writeEvidencePacket({ rootDir, project: "runner-only-fixture", now: new Date("2026-07-12T01:01:00.000Z") });
    const firstUnitLayer = firstEvidence.packet.testingLayers.find((layer) => layer.id === 2);
    expect(firstUnitLayer).toMatchObject({ status: "partial", evidence: [".visual-hive/repo-map.json", "tests_py/test_metrics.py"] });
    expect(firstUnitLayer?.gaps).toHaveLength(1);
    expect(firstUnitLayer?.gaps[0]).toContain("javascript scope .");
    expect(firstEvidence.packet.repoIntelligence?.testFiles).toEqual(firstRepo.report.testFiles);

    const firstPlan = await writeTestCreationPlan({ rootDir, project: "runner-only-fixture", now: new Date("2026-07-12T01:02:00.000Z") });
    expect(firstPlan.plan.recommendations.filter((recommendation) => recommendation.kind === "unit_test")).toHaveLength(1);
    expect(firstPlan.plan.recommendations.find((recommendation) => recommendation.kind === "unit_test")).toMatchObject({ priority: "medium" });
    const firstIssues = await writeIssuesArtifacts({ rootDir, project: "runner-only-fixture", now: new Date("2026-07-12T01:03:00.000Z") });
    const activeIssue = firstIssues.report.issues.find((issue) => issue.issueKind === "test_adequacy_gap");
    expect(activeIssue).toMatchObject({
      status: "open_candidate",
      publicationRole: "canonical",
      rootCauseKey: "test-adequacy/repository/testing-layer:2"
    });
    expect(activeIssue?.validationCommand).toBe("npm test && visual-hive analyze --repo . && visual-hive evidence && visual-hive test-creation-plan && visual-hive issues --write");

    await writeFile(
      path.join(rootDir, "src", "metrics.test.ts"),
      "import { describe, expect, it } from 'vitest';\nimport { twice } from './metrics.js';\ndescribe('twice', () => { it('doubles values', () => expect(twice(2)).toBe(4)); });\n",
      "utf8"
    );
    const secondRepo = await writeRepoMap({ repoRoot: rootDir, now: new Date("2026-07-12T01:04:00.000Z") });
    expect(secondRepo.report.testFiles).toContainEqual({
      path: "src/metrics.test.ts",
      kind: "unit",
      runtime: "javascript",
      scope: ".",
      tools: ["vitest"],
      runnerEligible: true,
      eligibilityEvidence: ["runner:vitest:matched-include"]
    });
    expect(secondRepo.report.coverageGaps.some((gap) => gap.id === "unit-layer")).toBe(false);
    const secondEvidence = await writeEvidencePacket({ rootDir, project: "runner-only-fixture", now: new Date("2026-07-12T01:05:00.000Z") });
    expect(secondEvidence.packet.testingLayers.find((layer) => layer.id === 2)).toMatchObject({
      status: "covered",
      gaps: [],
      evidence: [".visual-hive/repo-map.json", "src/metrics.test.ts", "tests_py/test_metrics.py"]
    });
    const secondPlan = await writeTestCreationPlan({ rootDir, project: "runner-only-fixture", now: new Date("2026-07-12T01:06:00.000Z") });
    expect(secondPlan.plan.recommendations.some((recommendation) => recommendation.kind === "unit_test")).toBe(false);
    const secondIssues = await writeIssuesArtifacts({ rootDir, project: "runner-only-fixture", now: new Date("2026-07-12T01:07:00.000Z") });
    expect(secondIssues.report.issues.find((issue) => issue.issueKind === "test_adequacy_gap")).toMatchObject({
      status: "resolved_candidate",
      publicationRole: "canonical",
      rootCauseKey: "test-adequacy/repository/testing-layer:2"
    });
  });

  it("does not cross-satisfy workspace scopes and renders only safe nearest-manager commands", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "visual-hive-workspace-evidence-"));
    temporaryRoots.push(rootDir);
    const scopeA = path.join(rootDir, "packages", "a");
    const scopeB = path.join(rootDir, "packages", "b");
    const scopeC = path.join(rootDir, "packages", "c");
    const scopeD = path.join(rootDir, "packages", "d");
    const scopeE = path.join(rootDir, "packages", "e");
    const hostileScope = path.join(rootDir, "packages", "0evil & echo injected");
    await Promise.all([
      mkdir(path.join(scopeA, "src"), { recursive: true }),
      mkdir(path.join(scopeB, "src"), { recursive: true }),
      mkdir(path.join(scopeC, "src"), { recursive: true }),
      mkdir(path.join(scopeD, "src"), { recursive: true }),
      mkdir(path.join(scopeE, "src"), { recursive: true }),
      mkdir(path.join(hostileScope, "src"), { recursive: true })
    ]);
    await writeFile(path.join(rootDir, "package.json"), `${JSON.stringify({ name: "workspace-root", private: true, workspaces: ["packages/*"], scripts: { test: "npm -ws test" } }, null, 2)}\n`, "utf8");
    await writeFile(path.join(rootDir, "package-lock.json"), "{}\n", "utf8");
    await writeFile(path.join(scopeA, "package.json"), `${JSON.stringify({
      name: "scope-a",
      scripts: { test: "vitest run --passWithNoTests", "test:update": "vitest --update", "test:watch": "vitest --watch" },
      devDependencies: { vitest: "^4.0.0" }
    }, null, 2)}\n`, "utf8");
    await writeFile(path.join(scopeA, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");
    await writeFile(path.join(scopeA, "src", "a.ts"), "export const a = 1;\n", "utf8");
    await writeFile(path.join(scopeB, "package.json"), `${JSON.stringify({ name: "scope-b", scripts: { test: "vitest run" }, devDependencies: { vitest: "^4.0.0" } }, null, 2)}\n`, "utf8");
    await writeFile(path.join(scopeB, "yarn.lock"), "# yarn lock\n", "utf8");
    await writeFile(path.join(scopeB, "src", "b.ts"), "export const b = 2;\n", "utf8");
    await writeFile(path.join(scopeB, "src", "b.test.ts"), "import '@testing-library/dom';\nimport { expect, it } from 'vitest';\nimport { b } from './b.js';\nit('b', () => expect(b).toBe(2));\n", "utf8");
    await writeFile(path.join(scopeC, "package.json"), `${JSON.stringify({ name: "scope-c", devDependencies: { vitest: "^4.0.0" } }, null, 2)}\n`, "utf8");
    await writeFile(path.join(scopeC, "package-lock.json"), "{}\n", "utf8");
    await writeFile(path.join(scopeC, "src", "c.ts"), "export const c = 3;\n", "utf8");
    await writeFile(path.join(scopeC, "src", "c.test.ts"), "import { expect, it } from 'vitest';\nimport { c } from './c.js';\nit('c', () => expect(c).toBe(3));\n", "utf8");
    await writeFile(path.join(scopeD, "package.json"), `${JSON.stringify({ name: "scope-d" }, null, 2)}\n`, "utf8");
    await writeFile(path.join(scopeD, "src", "App.vue"), "<template><main>Untested Vue scope</main></template>\n", "utf8");
    await writeFile(path.join(scopeE, "package.json"), `${JSON.stringify({ name: "scope-e", scripts: { test: "vitest run --passWithNoTests" }, devDependencies: { vitest: "^4.0.0" } }, null, 2)}\n`, "utf8");
    await writeFile(path.join(scopeE, "src", "e.ts"), "export const e = 5;\n", "utf8");
    await writeFile(path.join(hostileScope, "package.json"), `${JSON.stringify({ name: "hostile-scope", scripts: { test: "vitest run" }, devDependencies: { vitest: "^4.0.0" } }, null, 2)}\n`, "utf8");
    await writeFile(path.join(hostileScope, "package-lock.json"), "{}\n", "utf8");
    await writeFile(path.join(hostileScope, "src", "hostile.ts"), "export const hostile = false;\n", "utf8");

    const repo = await writeRepoMap({ repoRoot: rootDir, now: new Date("2026-07-12T02:00:00.000Z") });
    expect(repo.report.testRunners.find((runner) => runner.scope === "packages/a" && runner.tool === "vitest")).toMatchObject({
      commandProvider: "pnpm",
      command: { cwd: "packages/a", executable: "pnpm", args: ["test"] }
    });
    expect(repo.report.testRunners.find((runner) => runner.scope === "packages/b" && runner.tool === "vitest")).toMatchObject({
      commandProvider: "yarn",
      command: { cwd: "packages/b", executable: "yarn", args: ["test"] }
    });
    expect(repo.report.testRunners.find((runner) => runner.scope === "packages/c" && runner.tool === "vitest")).toMatchObject({
      commandProvider: "npm",
      command: { cwd: "packages/c", executable: "npm", args: ["exec", "--", "vitest", "run"] }
    });
    expect(repo.report.testRunners.find((runner) => runner.scope === "packages/a" && runner.tool === "vitest")?.evidence).not.toEqual(expect.arrayContaining([
      expect.stringContaining("test:update"),
      expect.stringContaining("test:watch")
    ]));
    expect(repo.report.testFiles.find((file) => file.path === "packages/b/src/b.test.ts")).toMatchObject({ kind: "component", scope: "packages/b", runnerEligible: true });
    expect(repo.report.coverageGaps.filter((gap) => gap.id === "unit-layer")).toHaveLength(1);
    expect(repo.report.coverageGaps.find((gap) => gap.id === "unit-layer")?.message).toContain("javascript scope packages/a");
    expect(repo.report.coverageGaps.find((gap) => gap.id === "unit-layer-advisory")?.message).toContain("javascript scope packages/0evil & echo injected");
    expect(repo.report.coverageGaps.find((gap) => gap.id === "unit-layer-advisory")?.message).toContain("javascript scope packages/d");

    await writeEvidencePacket({ rootDir, project: "workspace-root", now: new Date("2026-07-12T02:01:00.000Z") });
    await writeTestCreationPlan({ rootDir, project: "workspace-root", now: new Date("2026-07-12T02:02:00.000Z") });
    const issues = await writeIssuesArtifacts({ rootDir, project: "workspace-root", now: new Date("2026-07-12T02:03:00.000Z") });
    const issue = issues.report.issues.find((candidate) => candidate.issueKind === "test_adequacy_gap");
    expect(issue?.validationCommand).toContain("cd packages/a && pnpm test");
    expect(issue?.validationCommand).toContain("cd packages/e && npm test");
    expect(issue?.validationCommand).not.toContain("injected");
    await expectRepoMapSchema(repo.report);
  });

  it("requires declared Python runner evidence and recognizes supported dependency manifests", async () => {
    const manifests = [
      ["requirements-dev.txt", "pytest==8.3.4\n"],
      ["Pipfile", "[packages]\npytest = '*'\n"],
      ["poetry.lock", "[[package]]\nname = 'pytest'\nversion = '8.3.4'\n"],
      ["uv.lock", "[[package]]\nname = 'pytest'\nversion = '8.3.4'\n"],
      ["pdm.lock", "[[package]]\nname = 'pytest'\nversion = '8.3.4'\n"]
    ] as const;
    for (const [manifestName, manifestContent] of manifests) {
      const rootDir = await mkdtemp(path.join(os.tmpdir(), "visual-hive-python-manifest-"));
      temporaryRoots.push(rootDir);
      await Promise.all([
        mkdir(path.join(rootDir, "service"), { recursive: true }),
        mkdir(path.join(rootDir, "tests"), { recursive: true })
      ]);
      await writeFile(path.join(rootDir, "service", "maths.py"), "def twice(value):\n    return value * 2\n", "utf8");
      await writeFile(path.join(rootDir, "tests", "test_maths.py"), "import pytest\nfrom service.maths import twice\n\ndef test_twice():\n    assert twice(2) == 4\n", "utf8");
      await writeFile(path.join(rootDir, "requirements-comment.txt"), "# pytest disabled; this is descriptive text only\n", "utf8");
      const withoutManifest = await writeRepoMap({ repoRoot: rootDir, now: new Date("2026-07-12T03:00:00.000Z") });
      expect(withoutManifest.report.testRunners.some((runner) => runner.tool === "pytest")).toBe(false);
      expect(withoutManifest.report.testFiles.find((file) => file.path === "tests/test_maths.py")).toMatchObject({ runnerEligible: false });

      await writeFile(path.join(rootDir, manifestName), manifestContent, "utf8");
      const withManifest = await writeRepoMap({ repoRoot: rootDir, now: new Date("2026-07-12T03:01:00.000Z") });
      expect(withManifest.report.testRunners.find((runner) => runner.tool === "pytest")).toMatchObject({
        runtime: "python",
        scope: ".",
        commandProvider: "python",
        command: { cwd: ".", executable: "python", args: ["-m", "pytest"] }
      });
      expect(withManifest.report.testFiles.find((file) => file.path === "tests/test_maths.py")).toMatchObject({ runnerEligible: true });
      expect(withManifest.report.coverageGaps.some((gap) => gap.id === "unit-layer")).toBe(false);
    }
  });

  it("separates Pytest configuration from installation proof and parses multiline dependencies", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "visual-hive-python-config-proof-"));
    temporaryRoots.push(rootDir);
    await Promise.all([mkdir(path.join(rootDir, "service"), { recursive: true }), mkdir(path.join(rootDir, "tests"), { recursive: true })]);
    await writeFile(path.join(rootDir, "service", "value.py"), "value = 1\n", "utf8");
    await writeFile(path.join(rootDir, "tests", "test_value.py"), "def test_value():\n    assert 1 == 1\n", "utf8");
    await writeFile(path.join(rootDir, "pytest.ini"), "[pytest]\ntestpaths = tests\n", "utf8");
    const configOnly = await writeRepoMap({ repoRoot: rootDir, now: new Date("2026-07-12T03:10:00.000Z") });
    expect(configOnly.report.testRunners.some((runner) => runner.tool === "pytest")).toBe(false);
    expect(configOnly.report.testFiles.find((file) => file.path === "tests/test_value.py")).toMatchObject({ runnerEligible: false });

    await writeFile(path.join(rootDir, "pyproject.toml"), "[tool.docs]\ntest = ['pytest']\n[tool.foo]\npytest = 'descriptive only'\n", "utf8");
    await writeFile(path.join(rootDir, "Pipfile"), "[scripts]\npytest = \"echo descriptive\"\n", "utf8");
    const unrelatedTables = await writeRepoMap({ repoRoot: rootDir, now: new Date("2026-07-12T03:10:30.000Z") });
    expect(unrelatedTables.report.testRunners.some((runner) => runner.tool === "pytest")).toBe(false);

    await writeFile(path.join(rootDir, "pyproject.toml"), `[project]
name = "multiline-pytest"
dependencies = [
  "requests>=2",
  "pytest==8.3.4",
]
`, "utf8");
    const declared = await writeRepoMap({ repoRoot: rootDir, now: new Date("2026-07-12T03:11:00.000Z") });
    expect(declared.report.testRunners.find((runner) => runner.tool === "pytest")).toMatchObject({ command: { executable: "python", args: ["-m", "pytest"] } });
    expect(declared.report.testFiles.find((file) => file.path === "tests/test_value.py")).toMatchObject({ runnerEligible: true });
    expect(declared.report.coverageGaps.some((gap) => gap.id === "unit-layer")).toBe(false);
    await writeFile(path.join(rootDir, "tests", "checks.py"), "def test_check():\n    assert True\n", "utf8");
    const defaultNames = await writeRepoMap({ repoRoot: rootDir, now: new Date("2026-07-12T03:11:30.000Z") });
    expect(defaultNames.report.testFiles.find((file) => file.path === "tests/checks.py")).toMatchObject({ runnerEligible: false });
    await writeFile(path.join(rootDir, "tests", "test_helper.py"), "class Helper:\n    def test_not_collected(self):\n        assert True\n", "utf8");
    const helperClass = await writeRepoMap({ repoRoot: rootDir, now: new Date("2026-07-12T03:11:40.000Z") });
    expect(helperClass.report.testFiles.find((file) => file.path === "tests/test_helper.py")).toMatchObject({ runnerEligible: false, eligibilityEvidence: ["candidate:no-runnable-declaration"] });

    await writeFile(path.join(rootDir, "package.json"), `${JSON.stringify({ name: "pytest-custom", scripts: { test: "python -m pytest -c custom.ini" } }, null, 2)}\n`, "utf8");
    await writeFile(path.join(rootDir, "package-lock.json"), "{}\n", "utf8");
    await writeFile(path.join(rootDir, "custom.ini"), "[pytest]\ntestpaths = tests/unit\n# testpaths = tests\n", "utf8");
    const custom = await writeRepoMap({ repoRoot: rootDir, now: new Date("2026-07-12T03:12:00.000Z") });
    expect(custom.report.testFiles.find((file) => file.path === "tests/test_value.py")).toMatchObject({ runnerEligible: false });

    await writeFile(path.join(rootDir, "package.json"), `${JSON.stringify({ name: "pytest-override", scripts: { test: "python -m pytest -o testpaths=tests/unit" } }, null, 2)}\n`, "utf8");
    const overridden = await writeRepoMap({ repoRoot: rootDir, now: new Date("2026-07-12T03:13:00.000Z") });
    expect(overridden.report.testRunners.find((runner) => runner.tool === "pytest")?.discoveryConstraints).toContain("unparsed-discovery-option");
    expect(overridden.report.testFiles.find((file) => file.path === "tests/test_value.py")).toMatchObject({ runnerEligible: false });
    await writeFile(path.join(rootDir, "package.json"), `${JSON.stringify({ name: "pytest-norecurse", scripts: { test: "python -m pytest -q" } }, null, 2)}\n`, "utf8");
    await writeFile(path.join(rootDir, "pytest.ini"), "[pytest]\nnorecursedirs = tests\n", "utf8");
    const noRecurse = await writeRepoMap({ repoRoot: rootDir, now: new Date("2026-07-12T03:13:10.000Z") });
    expect(noRecurse.report.testFiles.find((file) => file.path === "tests/test_value.py")).toMatchObject({ runnerEligible: false });
  });

  it("uses only local or declared-workspace package managers and fixes nested file-runner paths", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "visual-hive-manager-ownership-"));
    temporaryRoots.push(rootDir);
    const nestedNode = path.join(rootDir, "packages", "node-scope");
    const excluded = path.join(rootDir, "packages", "excluded");
    const ambiguous = path.join(rootDir, "packages", "ambiguous");
    const unrelated = path.join(rootDir, "standalone", "tool");
    await Promise.all([nestedNode, excluded, ambiguous, unrelated].map((directory) => mkdir(path.join(directory, "src"), { recursive: true })));
    await mkdir(path.join(nestedNode, "tests"), { recursive: true });
    await writeFile(path.join(rootDir, "package.json"), `${JSON.stringify({ name: "root", private: true, workspaces: ["packages/*", "!packages/excluded"] }, null, 2)}\n`, "utf8");
    await writeFile(path.join(rootDir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");
    await writeFile(path.join(nestedNode, "package.json"), `${JSON.stringify({ name: "node-scope" }, null, 2)}\n`, "utf8");
    await writeFile(path.join(nestedNode, "src", "value.js"), "export const value = 1;\n", "utf8");
    await writeFile(path.join(nestedNode, "tests", "value.test.js"), "import test from 'node:test'; test('value', () => {});\n", "utf8");
    for (const [directory, name] of [[excluded, "excluded"], [unrelated, "unrelated"]] as const) {
      await writeFile(path.join(directory, "package.json"), `${JSON.stringify({ name, scripts: { test: "vitest run" } }, null, 2)}\n`, "utf8");
      await writeFile(path.join(directory, "src", "value.ts"), "export const value = 1;\n", "utf8");
      await writeFile(path.join(directory, "src", "value.test.ts"), "import { it } from 'vitest'; it('value', () => {});\n", "utf8");
    }
    await writeFile(path.join(ambiguous, "package.json"), `${JSON.stringify({ name: "ambiguous", scripts: { test: "vitest run" } }, null, 2)}\n`, "utf8");
    await writeFile(path.join(ambiguous, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");
    await writeFile(path.join(ambiguous, "yarn.lock"), "# mixed lock\n", "utf8");
    await writeFile(path.join(ambiguous, "src", "value.ts"), "export const value = 1;\n", "utf8");
    await writeFile(path.join(ambiguous, "src", "value.test.ts"), "import { it } from 'vitest'; it('value', () => {});\n", "utf8");

    const repo = await writeRepoMap({ repoRoot: rootDir, now: new Date("2026-07-12T03:20:00.000Z") });
    expect(repo.report.packages.find((pkg) => pkg.path === "packages/node-scope/package.json")?.packageManager).toBe("pnpm");
    expect(repo.report.packages.find((pkg) => pkg.path === "packages/excluded/package.json")?.packageManager).toBe("npm");
    expect(repo.report.packages.find((pkg) => pkg.path === "standalone/tool/package.json")?.packageManager).toBe("npm");
    expect(repo.report.packages.find((pkg) => pkg.path === "packages/ambiguous/package.json")?.packageManager).toBe("unknown");
    expect(repo.report.testRunners.find((runner) => runner.scope === "packages/node-scope" && runner.tool === "node-test")?.command).toEqual({
      cwd: "packages/node-scope",
      executable: "node",
      args: ["--test", "tests/value.test.js"]
    });
    expect(repo.report.testRunners.find((runner) => runner.scope === "packages/excluded" && runner.tool === "vitest")?.commandProvider).toBe("npm");
    expect(repo.report.testRunners.find((runner) => runner.scope === "standalone/tool" && runner.tool === "vitest")?.commandProvider).toBe("npm");
    expect(repo.report.testRunners.some((runner) => runner.scope === "packages/ambiguous")).toBe(false);

    const pnpmRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-pnpm-workspace-"));
    temporaryRoots.push(pnpmRoot);
    const app = path.join(pnpmRoot, "apps", "web");
    await mkdir(path.join(app, "src"), { recursive: true });
    await writeFile(path.join(pnpmRoot, "package.json"), `${JSON.stringify({ name: "pnpm-root", private: true }, null, 2)}\n`, "utf8");
    await writeFile(path.join(pnpmRoot, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");
    await writeFile(path.join(pnpmRoot, "pnpm-workspace.yaml"), "packages:\n  - 'apps/*'\n", "utf8");
    await writeFile(path.join(app, "package.json"), `${JSON.stringify({ name: "web", scripts: { test: "vitest run" } }, null, 2)}\n`, "utf8");
    await writeFile(path.join(app, "src", "value.ts"), "export const value = 1;\n", "utf8");
    await writeFile(path.join(app, "src", "value.test.ts"), "import { it } from 'vitest'; it('value', () => {});\n", "utf8");
    const pnpmRepo = await writeRepoMap({ repoRoot: pnpmRoot, now: new Date("2026-07-12T03:21:00.000Z") });
    expect(pnpmRepo.report.packages.find((pkg) => pkg.path === "apps/web/package.json")?.packageManager).toBe("pnpm");
    expect(pnpmRepo.report.testRunners.find((runner) => runner.scope === "apps/web" && runner.tool === "vitest")?.commandProvider).toBe("pnpm");
  });

  it("recognizes inline Rust tests as executable Cargo evidence", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "visual-hive-rust-inline-"));
    temporaryRoots.push(rootDir);
    await mkdir(path.join(rootDir, "src"), { recursive: true });
    await writeFile(path.join(rootDir, "Cargo.toml"), "[package]\nname = 'inline-tests'\nversion = '0.1.0'\n", "utf8");
    await writeFile(path.join(rootDir, "src", "lib.rs"), "pub fn id<'a>(value: &'a str) -> &'a str { value }\npub fn twice(v: i32) -> i32 { v * 2 }\n#[cfg(test)]\nmod tests { #[test] fn doubles() { assert_eq!(super::twice(2), 4); } }\n", "utf8");
    const repo = await writeRepoMap({ repoRoot: rootDir, now: new Date("2026-07-12T03:30:00.000Z") });
    expect(repo.report.testFiles.find((file) => file.path === "src/lib.rs")).toMatchObject({ runtime: "rust", runnerEligible: true, tools: ["cargo-test"] });
    expect(repo.report.coverageGaps.some((gap) => gap.id === "unit-layer")).toBe(false);

    const ignoredRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-rust-ignored-"));
    temporaryRoots.push(ignoredRoot);
    await mkdir(path.join(ignoredRoot, "src"), { recursive: true });
    await writeFile(path.join(ignoredRoot, "Cargo.toml"), "[package]\nname = 'ignored-tests'\nversion = '0.1.0'\n", "utf8");
    await writeFile(path.join(ignoredRoot, "src", "lib.rs"), "pub fn value() -> i32 { 1 }\n#[cfg(test)] mod tests { #[ignore] #[test] fn ignored_first() {} #[test] #[ignore] fn test_first() {} }\n", "utf8");
    const ignoredRepo = await writeRepoMap({ repoRoot: ignoredRoot, now: new Date("2026-07-12T03:30:30.000Z") });
    expect(ignoredRepo.report.testFiles.find((file) => file.path === "src/lib.rs")).toMatchObject({ runnerEligible: false, eligibilityEvidence: ["candidate:no-runnable-declaration"] });
    expect(ignoredRepo.report.coverageGaps.some((gap) => gap.id === "unit-layer")).toBe(true);
  });

  it("masks declaration spoofs and enforces JVM and Rust discoverable paths", async () => {
    const goRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-go-spoof-"));
    temporaryRoots.push(goRoot);
    await mkdir(path.join(goRoot, "pkg"), { recursive: true });
    await writeFile(path.join(goRoot, "go.mod"), "module example.test/spoof\n\ngo 1.23\n", "utf8");
    await writeFile(path.join(goRoot, "pkg", "value.go"), "package pkg\nconst Value = 1\n", "utf8");
    await writeFile(path.join(goRoot, "pkg", "value_test.go"), "package pkg\n/* func TestGhost(t *testing.T) {} */\n", "utf8");
    const goRepo = await writeRepoMap({ repoRoot: goRoot, now: new Date("2026-07-12T03:30:40.000Z") });
    expect(goRepo.report.testFiles.find((file) => file.path === "pkg/value_test.go")).toMatchObject({ runnerEligible: false, eligibilityEvidence: ["candidate:no-runnable-declaration"] });
    expect(goRepo.report.coverageGaps.some((gap) => gap.id === "unit-layer")).toBe(true);
    await writeFile(path.join(goRoot, "pkg", "value_test.go"), "package pkg\nfunc TestGhost() {}\nfunc ExampleGhost() {}\n", "utf8");
    const invalidGo = await writeRepoMap({ repoRoot: goRoot, now: new Date("2026-07-12T03:30:42.000Z") });
    expect(invalidGo.report.testFiles.find((file) => file.path === "pkg/value_test.go")).toMatchObject({ runnerEligible: false, eligibilityEvidence: ["candidate:no-runnable-declaration"] });
    await writeFile(path.join(goRoot, "pkg", "value_test.go"), "package pkg\nimport \"testing\"\nfunc BenchmarkValue(b *testing.B) {}\n", "utf8");
    const benchmarkOnly = await writeRepoMap({ repoRoot: goRoot, now: new Date("2026-07-12T03:30:43.000Z") });
    expect(benchmarkOnly.report.testFiles.find((file) => file.path === "pkg/value_test.go")).toMatchObject({ runnerEligible: false, eligibilityEvidence: ["candidate:no-runnable-declaration"] });
    await writeFile(path.join(goRoot, "pkg", "value_test.go"), "//go:build never\npackage pkg\nimport \"testing\"\nfunc TestValue(t *testing.T) {}\n", "utf8");
    const buildTagged = await writeRepoMap({ repoRoot: goRoot, now: new Date("2026-07-12T03:30:43.500Z") });
    expect(buildTagged.report.testFiles.find((file) => file.path === "pkg/value_test.go")).toMatchObject({ runnerEligible: false, eligibilityEvidence: ["candidate:no-runnable-declaration"] });
    await writeFile(path.join(goRoot, "pkg", "value_test.go"), "package pkg\nimport \"testing\"\nfunc TestValue(t *testing.T) {}\n", "utf8");
    const validGo = await writeRepoMap({ repoRoot: goRoot, now: new Date("2026-07-12T03:30:44.000Z") });
    expect(validGo.report.testFiles.find((file) => file.path === "pkg/value_test.go")).toMatchObject({ runnerEligible: true });
    await writeFile(path.join(goRoot, "pkg", "value_windows_test.go"), "package pkg\nimport \"testing\"\nfunc TestWindows(t *testing.T) {}\n", "utf8");
    const platformGo = await writeRepoMap({ repoRoot: goRoot, now: new Date("2026-07-12T03:30:45.000Z") });
    expect(platformGo.report.testFiles.find((file) => file.path === "pkg/value_windows_test.go")).toMatchObject({ runnerEligible: false, eligibilityEvidence: ["candidate:no-runnable-declaration"] });

    const jvmRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-jvm-discovery-"));
    temporaryRoots.push(jvmRoot);
    await Promise.all([
      mkdir(path.join(jvmRoot, "src", "main", "java"), { recursive: true }),
      mkdir(path.join(jvmRoot, "src", "test", "java"), { recursive: true }),
      mkdir(path.join(jvmRoot, "tests"), { recursive: true })
    ]);
    await writeFile(path.join(jvmRoot, "pom.xml"), "<project><dependencies><dependency><groupId>org.junit.jupiter</groupId><artifactId>junit-jupiter</artifactId><scope>test</scope></dependency></dependencies></project>\n", "utf8");
    await writeFile(path.join(jvmRoot, "src", "main", "java", "Value.java"), "final class Value {}\n", "utf8");
    await writeFile(path.join(jvmRoot, "src", "test", "java", "GhostTest.java"), "final class GhostTest { String note = \"@Test\"; /* @Test void ghost() {} */ }\n", "utf8");
    await writeFile(path.join(jvmRoot, "tests", "OutsideTest.java"), "final class OutsideTest { @Test void real() {} }\n", "utf8");
    const jvmRepo = await writeRepoMap({ repoRoot: jvmRoot, now: new Date("2026-07-12T03:30:50.000Z") });
    expect(jvmRepo.report.testFiles.find((file) => file.path === "src/test/java/GhostTest.java")).toMatchObject({ runnerEligible: false, eligibilityEvidence: ["candidate:no-runnable-declaration"] });
    expect(jvmRepo.report.testFiles.find((file) => file.path === "tests/OutsideTest.java")).toMatchObject({ runnerEligible: false });
    expect(jvmRepo.report.coverageGaps.some((gap) => gap.id === "unit-layer")).toBe(true);
    await writeFile(path.join(jvmRoot, "pom.xml"), "<project><modelVersion>4.0.0</modelVersion><!-- <dependency><artifactId>junit-jupiter</artifactId></dependency> --></project>\n", "utf8");
    const bareJvmRepo = await writeRepoMap({ repoRoot: jvmRoot, now: new Date("2026-07-12T03:30:55.000Z") });
    expect(bareJvmRepo.report.testRunners.some((runner) => runner.tool === "junit")).toBe(false);

    const rustRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-rust-discovery-"));
    temporaryRoots.push(rustRoot);
    await Promise.all([mkdir(path.join(rustRoot, "src"), { recursive: true }), mkdir(path.join(rustRoot, "examples", "tests"), { recursive: true })]);
    await writeFile(path.join(rustRoot, "Cargo.toml"), "[package]\nname='rust-discovery'\nversion='0.1.0'\n", "utf8");
    await writeFile(path.join(rustRoot, "src", "lib.rs"), "pub fn value() -> i32 { 1 }\n", "utf8");
    await writeFile(path.join(rustRoot, "examples", "tests", "outside.rs"), "#[test] fn real() {}\n", "utf8");
    const rustRepo = await writeRepoMap({ repoRoot: rustRoot, now: new Date("2026-07-12T03:31:00.000Z") });
    expect(rustRepo.report.testFiles.find((file) => file.path === "examples/tests/outside.rs")).toMatchObject({ runnerEligible: false });
    expect(rustRepo.report.coverageGaps.some((gap) => gap.id === "unit-layer")).toBe(true);
  });

  it("never labels unsupported Ruby or PHP unit scopes covered without proof", async () => {
    for (const [runtime, relativePath, content] of [
      ["ruby", "lib/value.rb", "VALUE = 1\n"],
      ["php", "src/Value.php", "<?php final class Value {}\n"]
    ] as const) {
      const rootDir = await mkdtemp(path.join(os.tmpdir(), `visual-hive-${runtime}-scope-`));
      temporaryRoots.push(rootDir);
      await mkdir(path.dirname(path.join(rootDir, relativePath)), { recursive: true });
      await writeFile(path.join(rootDir, relativePath), content, "utf8");
      const repo = await writeRepoMap({ repoRoot: rootDir, now: new Date("2026-07-12T03:31:00.000Z") });
      expect(repo.report.runtimeScopes).toContainEqual({ runtime, scope: ".", sourceFiles: [relativePath] });
      expect(repo.report.coverageGaps.find((gap) => gap.id === "unit-layer")).toMatchObject({
        suggestedArtifact: "advisory-only: deterministic runner/setup required"
      });
      const evidence = await writeEvidencePacket({ rootDir, project: `${runtime}-scope`, now: new Date("2026-07-12T03:32:00.000Z") });
      expect(evidence.packet.testingLayers.find((layer) => layer.id === 2)?.status).toBe("partial");
      expect(evidence.packet.testingLayers.find((layer) => layer.id === 2)?.status).not.toBe("covered");
      const plan = await writeTestCreationPlan({ rootDir, project: `${runtime}-scope`, now: new Date("2026-07-12T03:33:00.000Z") });
      expect(plan.plan.recommendations.some((recommendation) => recommendation.kind === "unit_test")).toBe(false);
      const issues = await writeIssuesArtifacts({ rootDir, project: `${runtime}-scope`, now: new Date("2026-07-12T03:34:00.000Z") });
      expect(issues.report.issues.some((issue) => issue.issueKind === "test_adequacy_gap" || issue.rootCauseKey?.includes("testing-layer:2"))).toBe(false);
    }
  });

  it("splits mixed actionable scopes from advisory scopes and ignores orphan runners", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "visual-hive-mixed-actionability-"));
    temporaryRoots.push(rootDir);
    await Promise.all([mkdir(path.join(rootDir, "src"), { recursive: true }), mkdir(path.join(rootDir, "lib"), { recursive: true })]);
    await writeFile(path.join(rootDir, "package.json"), `${JSON.stringify({ name: "mixed", scripts: { test: "vitest run" } }, null, 2)}\n`, "utf8");
    await writeFile(path.join(rootDir, "package-lock.json"), "{}\n", "utf8");
    await writeFile(path.join(rootDir, "src", "value.ts"), "export const value = 1;\n", "utf8");
    await writeFile(path.join(rootDir, "lib", "value.rb"), "VALUE = 1\n", "utf8");
    const first = await writeRepoMap({ repoRoot: rootDir, now: new Date("2026-07-12T03:40:00.000Z") });
    expect(first.report.coverageGaps.find((gap) => gap.id === "unit-layer")?.message).toContain("javascript scope .");
    expect(first.report.coverageGaps.find((gap) => gap.id === "unit-layer-advisory")?.message).toContain("ruby scope .");
    await writeEvidencePacket({ rootDir, project: "mixed", now: new Date("2026-07-12T03:40:10.000Z") });
    const firstPlan = await writeTestCreationPlan({ rootDir, project: "mixed", now: new Date("2026-07-12T03:40:20.000Z") });
    expect(firstPlan.plan.recommendations.some((recommendation) => recommendation.kind === "unit_test")).toBe(true);
    const firstIssues = await writeIssuesArtifacts({ rootDir, project: "mixed", now: new Date("2026-07-12T03:40:30.000Z") });
    expect(firstIssues.report.issues.find((issue) => issue.issueKind === "test_adequacy_gap")).toMatchObject({ status: "open_candidate" });

    await writeFile(path.join(rootDir, "src", "value.test.ts"), "import { it } from 'vitest'; it('runs', () => {});\n", "utf8");
    const second = await writeRepoMap({ repoRoot: rootDir, now: new Date("2026-07-12T03:41:00.000Z") });
    expect(second.report.coverageGaps.some((gap) => gap.id === "unit-layer" && !gap.suggestedArtifact.startsWith("advisory-only:"))).toBe(false);
    expect(second.report.coverageGaps.some((gap) => gap.suggestedArtifact.startsWith("advisory-only:") && gap.message.includes("ruby scope ."))).toBe(true);
    await writeEvidencePacket({ rootDir, project: "mixed", now: new Date("2026-07-12T03:41:10.000Z") });
    const secondPlan = await writeTestCreationPlan({ rootDir, project: "mixed", now: new Date("2026-07-12T03:41:20.000Z") });
    expect(secondPlan.plan.recommendations.some((recommendation) => recommendation.kind === "unit_test")).toBe(false);
    const secondIssues = await writeIssuesArtifacts({ rootDir, project: "mixed", now: new Date("2026-07-12T03:41:30.000Z") });
    expect(secondIssues.report.issues.find((issue) => issue.issueKind === "test_adequacy_gap")).toMatchObject({ status: "resolved_candidate" });

    const orphanRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-orphan-runner-"));
    temporaryRoots.push(orphanRoot);
    await Promise.all([mkdir(path.join(orphanRoot, "service"), { recursive: true }), mkdir(path.join(orphanRoot, "tests"), { recursive: true })]);
    await writeFile(path.join(orphanRoot, "package.json"), `${JSON.stringify({ name: "tooling", devDependencies: { vitest: "^4.0.0" } }, null, 2)}\n`, "utf8");
    await writeFile(path.join(orphanRoot, "package-lock.json"), "{}\n", "utf8");
    await writeFile(path.join(orphanRoot, "pyproject.toml"), "[project]\ndependencies=['pytest']\n", "utf8");
    await writeFile(path.join(orphanRoot, "service", "value.py"), "VALUE = 1\n", "utf8");
    await writeFile(path.join(orphanRoot, "tests", "test_value.py"), "def test_value():\n    assert True\n", "utf8");
    const orphan = await writeRepoMap({ repoRoot: orphanRoot, now: new Date("2026-07-12T03:42:00.000Z") });
    expect(orphan.report.runtimeScopes.some((scope) => scope.runtime === "javascript")).toBe(false);
    expect(orphan.report.coverageGaps.some((gap) => gap.message.includes("javascript scope ."))).toBe(false);
    expect(orphan.report.coverageGaps.some((gap) => gap.id === "unit-layer")).toBe(false);
  });

  it("does not treat descriptive runner names or commented dependencies as runnable proof", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "visual-hive-false-runner-"));
    temporaryRoots.push(rootDir);
    await Promise.all([mkdir(path.join(rootDir, "src"), { recursive: true }), mkdir(path.join(rootDir, "service"), { recursive: true }), mkdir(path.join(rootDir, "tests"), { recursive: true })]);
    await writeFile(path.join(rootDir, "package.json"), `${JSON.stringify({ name: "false-runner", scripts: { test: "echo vitest is not configured" } }, null, 2)}\n`, "utf8");
    await writeFile(path.join(rootDir, "src", "value.ts"), "export const value = 1;\n", "utf8");
    await writeFile(path.join(rootDir, "src", "value.test.ts"), "import { expect, it } from 'vitest';\nit('value', () => expect(1).toBe(1));\n", "utf8");
    await writeFile(path.join(rootDir, "service", "value.py"), "value = 1\n", "utf8");
    await writeFile(path.join(rootDir, "tests", "test_value.py"), "import pytest\n\ndef test_value():\n    assert 1 == 1\n", "utf8");
    await writeFile(path.join(rootDir, "requirements-dev.txt"), "# pytest disabled; use no Python runner yet\n", "utf8");

    const repo = await writeRepoMap({ repoRoot: rootDir, now: new Date("2026-07-12T04:00:00.000Z") });
    expect(repo.report.testRunners.filter((runner) => runner.kind === "unit")).toEqual([]);
    expect(repo.report.testFiles.filter((file) => file.kind === "unit").every((file) => !file.runnerEligible)).toBe(true);
    expect(repo.report.coverageGaps.filter((gap) => gap.id === "unit-layer")).toHaveLength(1);
    await writeEvidencePacket({ rootDir, project: "false-runner", now: new Date("2026-07-12T04:01:00.000Z") });
    const plan = await writeTestCreationPlan({ rootDir, project: "false-runner", now: new Date("2026-07-12T04:02:00.000Z") });
    expect(plan.plan.recommendations.some((recommendation) => recommendation.kind === "unit_test")).toBe(false);
    const issues = await writeIssuesArtifacts({ rootDir, project: "false-runner", now: new Date("2026-07-12T04:03:00.000Z") });
    const issue = issues.report.issues.find((candidate) => candidate.issueKind === "test_adequacy_gap");
    expect(issue).toBeUndefined();
    expect(issues.report.issues.some((candidate) => candidate.rootCauseKey?.includes("testing-layer:2"))).toBe(false);
  });

  it("rejects conditional, non-executing, incompatible, empty, and skipped-only runner proof", async () => {
    const cases = [
      ["conditional-or", "true || vitest run", "vitest", "import { it } from 'vitest'; it('runs', () => {});"],
      ["unreachable-and", "false && vitest run", "vitest", "import { it } from 'vitest'; it('runs', () => {});"],
      ["watch-prefix", "tsc -w && vitest run", "vitest", "import { it } from 'vitest'; it('runs', () => {});"],
      ["pipe", "echo ready | vitest run", "vitest", "import { it } from 'vitest'; it('runs', () => {});"],
      ["semicolon", "echo ready; vitest run", "vitest", "import { it } from 'vitest'; it('runs', () => {});"],
      ["vitest-help", "vitest --help", "vitest", "import { it } from 'vitest'; it('runs', () => {});"],
      ["jest-list", "jest --listTests", "jest", "import { test } from '@jest/globals'; test('runs', () => {});"],
      ["node-help", "node --test --help", "node-test", "test('runs', () => {});"],
      ["cross-runner", "jest", "jest", "import { it } from 'vitest'; it('runs', () => {});"],
      ["empty-file", "vitest run --passWithNoTests", "vitest", "export const helper = true;"],
      ["skipped-only", "vitest run --passWithNoTests", "vitest", "import { test } from 'vitest'; test.skip('never runs', () => {});"],
      ["skipped-suite", "vitest run --passWithNoTests", "vitest", "import { describe, it } from 'vitest'; describe.skip('never runs', () => { it('nested', () => {}); });"],
      ["comment-spoof", "vitest run --passWithNoTests", "vitest", "// test('ghost', () => {})\nexport const note = true;"],
      ["string-spoof", "vitest run --passWithNoTests", "vitest", "const note = \"test('ghost', () => {})\";"],
      ["regex-spoof", "vitest run --passWithNoTests", "vitest", "export const pattern = /test('ghost')/;"],
      ["return-regex-spoof", "vitest run --passWithNoTests", "vitest", "export function pattern() { return /test('ghost')/; }"],
      ["member-spoof", "vitest run --passWithNoTests", "vitest", "const api = { test: () => {} }; api.test('ghost');"],
      ["method-spoof", "vitest run --passWithNoTests", "vitest", "export const api = { test() {} };"],
      ["function-spoof", "vitest run --passWithNoTests", "vitest", "export function test() {}"],
      ["commented-import-global", "vitest run --passWithNoTests", "vitest", "// import { test } from 'vitest'\ntest('global', () => {});"]
    ] as const;
    for (const [name, command, runnerTool, testContent] of cases) {
      const rootDir = await mkdtemp(path.join(os.tmpdir(), `visual-hive-runner-${name}-`));
      temporaryRoots.push(rootDir);
      await mkdir(path.join(rootDir, "src"), { recursive: true });
      await writeFile(path.join(rootDir, "package.json"), `${JSON.stringify({ name, scripts: { test: command } }, null, 2)}\n`, "utf8");
      await writeFile(path.join(rootDir, "package-lock.json"), "{}\n", "utf8");
      await writeFile(path.join(rootDir, "src", "value.ts"), "export const value = 1;\n", "utf8");
      await writeFile(path.join(rootDir, "src", "value.test.ts"), testContent, "utf8");
      const repo = await writeRepoMap({ repoRoot: rootDir, now: new Date("2026-07-12T04:10:00.000Z") });
      if (["cross-runner", "empty-file", "skipped-only", "skipped-suite", "comment-spoof", "string-spoof", "regex-spoof", "return-regex-spoof", "member-spoof", "method-spoof", "function-spoof", "commented-import-global"].includes(name)) expect(repo.report.testRunners.some((runner) => runner.tool === runnerTool)).toBe(true);
      else expect(repo.report.testRunners.some((runner) => runner.tool === runnerTool), name).toBe(false);
      expect(repo.report.testFiles.find((file) => file.path === "src/value.test.ts")?.runnerEligible ?? false).toBe(false);
      expect(repo.report.coverageGaps.some((gap) => gap.id === "unit-layer")).toBe(true);
    }

    const strictRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-runner-strict-chain-"));
    temporaryRoots.push(strictRoot);
    await mkdir(path.join(strictRoot, "src"), { recursive: true });
    await writeFile(path.join(strictRoot, "package.json"), `${JSON.stringify({ name: "strict-chain", scripts: { test: "tsc --noEmit && vitest run" } }, null, 2)}\n`, "utf8");
    await writeFile(path.join(strictRoot, "package-lock.json"), "{}\n", "utf8");
    await writeFile(path.join(strictRoot, "src", "value.ts"), "export const value = 1;\n", "utf8");
    await writeFile(path.join(strictRoot, "src", "value.test.ts"), "import { it } from 'vitest'; it('runs', () => {});\n", "utf8");
    const strictRepo = await writeRepoMap({ repoRoot: strictRoot, now: new Date("2026-07-12T04:11:00.000Z") });
    expect(strictRepo.report.testFiles.find((file) => file.path === "src/value.test.ts")).toMatchObject({ runnerEligible: true });
    expect(strictRepo.report.coverageGaps.some((gap) => gap.id === "unit-layer")).toBe(false);
    await writeFile(path.join(strictRoot, "src", "value.test.ts"), "import { describe, it } from 'vitest';\ndescribe.skip('legacy', () => { it('old', () => {}); });\nit('active', () => {});\n", "utf8");
    const mixedSkip = await writeRepoMap({ repoRoot: strictRoot, now: new Date("2026-07-12T04:11:10.000Z") });
    expect(mixedSkip.report.testFiles.find((file) => file.path === "src/value.test.ts")).toMatchObject({ runnerEligible: true });
    await writeFile(path.join(strictRoot, "src", "value.test.ts"), "import { test } from 'vitest';\ntest('function callback', function() { return true; });\n", "utf8");
    const functionCallback = await writeRepoMap({ repoRoot: strictRoot, now: new Date("2026-07-12T04:11:20.000Z") });
    expect(functionCallback.report.testFiles.find((file) => file.path === "src/value.test.ts")).toMatchObject({ runnerEligible: true });

    const modeRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-runner-mode-"));
    temporaryRoots.push(modeRoot);
    await mkdir(path.join(modeRoot, "src"), { recursive: true });
    await writeFile(path.join(modeRoot, "package.json"), `${JSON.stringify({
      name: "runner-mode",
      scripts: { test: "vitest" },
      devDependencies: { vitest: "^4.0.0", mocha: "^11.0.0" }
    }, null, 2)}\n`, "utf8");
    await writeFile(path.join(modeRoot, "package-lock.json"), "{}\n", "utf8");
    await writeFile(path.join(modeRoot, "src", "value.ts"), "export const value = 1;\n", "utf8");
    await writeFile(path.join(modeRoot, "src", "value.test.ts"), "import { it } from 'vitest'; it('runs', () => {});\n", "utf8");
    await writeFile(path.join(modeRoot, "src", "ava.test.ts"), "import test from 'ava'; test('ava', () => {});\n", "utf8");
    const modeRepo = await writeRepoMap({ repoRoot: modeRoot, now: new Date("2026-07-12T04:11:30.000Z") });
    expect(modeRepo.report.testRunners.find((runner) => runner.tool === "vitest")?.command).toEqual({ cwd: ".", executable: "npm", args: ["exec", "--", "vitest", "run"] });
    expect(modeRepo.report.testRunners.some((runner) => runner.tool === "mocha")).toBe(false);
    expect(modeRepo.report.testFiles.find((file) => file.path === "src/ava.test.ts")).toMatchObject({ tools: ["ava"], runnerEligible: false });

    await writeFile(path.join(modeRoot, "package.json"), `${JSON.stringify({ name: "node-only", scripts: { test: "node --test --test-only" } }, null, 2)}\n`, "utf8");
    await writeFile(path.join(modeRoot, "src", "value.test.ts"), "test('normal', () => {});\n", "utf8");
    const nodeOnlyRepo = await writeRepoMap({ repoRoot: modeRoot, now: new Date("2026-07-12T04:11:40.000Z") });
    expect(nodeOnlyRepo.report.testRunners.some((runner) => runner.tool === "node-test")).toBe(false);
    await writeFile(path.join(modeRoot, "package.json"), `${JSON.stringify({ name: "node-default", scripts: { test: "node --test" } }, null, 2)}\n`, "utf8");
    await writeFile(path.join(modeRoot, "src", "value.spec.js"), "import test from 'node:test'; test('spec name', () => {});\n", "utf8");
    const nodeDefault = await writeRepoMap({ repoRoot: modeRoot, now: new Date("2026-07-12T04:11:50.000Z") });
    expect(nodeDefault.report.testFiles.find((file) => file.path === "src/value.spec.js")).toMatchObject({ runnerEligible: false });

    const pytestRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-runner-pytest-collect-"));
    temporaryRoots.push(pytestRoot);
    await Promise.all([mkdir(path.join(pytestRoot, "service"), { recursive: true }), mkdir(path.join(pytestRoot, "tests"), { recursive: true })]);
    await writeFile(path.join(pytestRoot, "package.json"), `${JSON.stringify({ name: "pytest-collect", scripts: { test: "python -m pytest --collect-only" } }, null, 2)}\n`, "utf8");
    await writeFile(path.join(pytestRoot, "package-lock.json"), "{}\n", "utf8");
    await writeFile(path.join(pytestRoot, "service", "value.py"), "value = 1\n", "utf8");
    await writeFile(path.join(pytestRoot, "tests", "test_value.py"), "def test_value():\n    assert 1 == 1\n", "utf8");
    const pytestRepo = await writeRepoMap({ repoRoot: pytestRoot, now: new Date("2026-07-12T04:12:00.000Z") });
    expect(pytestRepo.report.testRunners.some((runner) => runner.tool === "pytest")).toBe(false);
    expect(pytestRepo.report.coverageGaps.some((gap) => gap.id === "unit-layer")).toBe(true);
    await writeFile(path.join(pytestRoot, "package.json"), `${JSON.stringify({ name: "pytest-skipped", scripts: { test: "python -m pytest -q" } }, null, 2)}\n`, "utf8");
    await writeFile(path.join(pytestRoot, "tests", "test_value.py"), "import pytest\n\n@pytest.mark.skip(reason='disabled')\ndef test_value():\n    assert 1 == 1\n", "utf8");
    const pytestSkipped = await writeRepoMap({ repoRoot: pytestRoot, now: new Date("2026-07-12T04:12:30.000Z") });
    expect(pytestSkipped.report.testRunners.some((runner) => runner.tool === "pytest")).toBe(true);
    expect(pytestSkipped.report.testFiles.find((file) => file.path === "tests/test_value.py")).toMatchObject({ runnerEligible: false, eligibilityEvidence: ["candidate:no-runnable-declaration"] });
    expect(pytestSkipped.report.coverageGaps.some((gap) => gap.id === "unit-layer")).toBe(true);
    await writeFile(path.join(pytestRoot, "tests", "test_value.py"), "\"\"\"def test_ghost():\n    assert True\n\"\"\"\nVALUE = 1\n", "utf8");
    const pytestDocstring = await writeRepoMap({ repoRoot: pytestRoot, now: new Date("2026-07-12T04:12:35.000Z") });
    expect(pytestDocstring.report.testFiles.find((file) => file.path === "tests/test_value.py")).toMatchObject({ runnerEligible: false, eligibilityEvidence: ["candidate:no-runnable-declaration"] });
    await writeFile(path.join(pytestRoot, "tests", "test_value.py"), "def test_value():\n    assert 1 == 1\n", "utf8");
    await writeFile(path.join(pytestRoot, "package.json"), `${JSON.stringify({ name: "pytest-env", scripts: { test: "PYTEST_ADDOPTS=--collect-only python -m pytest" } }, null, 2)}\n`, "utf8");
    const pytestEnv = await writeRepoMap({ repoRoot: pytestRoot, now: new Date("2026-07-12T04:12:40.000Z") });
    expect(pytestEnv.report.testRunners.some((runner) => runner.tool === "pytest")).toBe(false);
    await writeFile(path.join(pytestRoot, "package.json"), `${JSON.stringify({ name: "pytest-addopts", scripts: { test: "python -m pytest -q" } }, null, 2)}\n`, "utf8");
    await writeFile(path.join(pytestRoot, "pytest.ini"), "[pytest]\naddopts = --collect-only\n", "utf8");
    const pytestAddopts = await writeRepoMap({ repoRoot: pytestRoot, now: new Date("2026-07-12T04:12:45.000Z") });
    expect(pytestAddopts.report.testFiles.find((file) => file.path === "tests/test_value.py")).toMatchObject({ runnerEligible: false });

    const unittestRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-unittest-default-"));
    temporaryRoots.push(unittestRoot);
    await Promise.all([mkdir(path.join(unittestRoot, "service"), { recursive: true }), mkdir(path.join(unittestRoot, "tests"), { recursive: true })]);
    await writeFile(path.join(unittestRoot, "package.json"), `${JSON.stringify({ name: "unittest-default", scripts: { test: "python -m unittest" } }, null, 2)}\n`, "utf8");
    await writeFile(path.join(unittestRoot, "package-lock.json"), "{}\n", "utf8");
    await writeFile(path.join(unittestRoot, "service", "value.py"), "VALUE = 1\n", "utf8");
    await writeFile(path.join(unittestRoot, "tests", "value.unit.py"), "import unittest\nclass TestValue(unittest.TestCase):\n    def test_value(self):\n        self.assertTrue(True)\n", "utf8");
    const unittestRepo = await writeRepoMap({ repoRoot: unittestRoot, now: new Date("2026-07-12T04:12:50.000Z") });
    expect(unittestRepo.report.testFiles.find((file) => file.path === "tests/value.unit.py")).toMatchObject({ runnerEligible: false });
    await writeFile(path.join(unittestRoot, "tests", "test_value.py"), "import unittest\n\ndef test_top_level():\n    assert True\n", "utf8");
    const unittestTopLevel = await writeRepoMap({ repoRoot: unittestRoot, now: new Date("2026-07-12T04:12:55.000Z") });
    expect(unittestTopLevel.report.testFiles.find((file) => file.path === "tests/test_value.py")).toMatchObject({ runnerEligible: false });

    const jestGlobalsRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-jest-globals-only-"));
    temporaryRoots.push(jestGlobalsRoot);
    await mkdir(path.join(jestGlobalsRoot, "src"), { recursive: true });
    await writeFile(path.join(jestGlobalsRoot, "package.json"), `${JSON.stringify({ name: "jest-globals-only", devDependencies: { "@jest/globals": "^30.0.0" } }, null, 2)}\n`, "utf8");
    await writeFile(path.join(jestGlobalsRoot, "package-lock.json"), "{}\n", "utf8");
    await writeFile(path.join(jestGlobalsRoot, "src", "value.ts"), "export const value = 1;\n", "utf8");
    await writeFile(path.join(jestGlobalsRoot, "src", "value.test.ts"), "import { test } from '@jest/globals'; test('runs', () => {});\n", "utf8");
    const jestGlobalsRepo = await writeRepoMap({ repoRoot: jestGlobalsRoot, now: new Date("2026-07-12T04:13:00.000Z") });
    expect(jestGlobalsRepo.report.testRunners.some((runner) => runner.tool === "jest")).toBe(false);
    expect(jestGlobalsRepo.report.testFiles.find((file) => file.path === "src/value.test.ts")).toMatchObject({ runnerEligible: false });
  }, 30_000);

  it("fails closed for exact, ambiguous, dynamic, and CLI-restricted discovery configurations", async () => {
    const fixtures = [
      {
        name: "custom-config",
        command: "vitest run --config configs/unit.ts",
        configs: [["configs/unit.ts", "export default { test: { include: ['tests/**/*.test.ts'] } };\n"]]
      },
      {
        name: "ambiguous-config",
        command: "vitest run",
        configs: [
          ["vitest.config.ts", "export default { test: { include: ['src/**/*.test.ts'] } };\n"],
          ["vite.config.ts", "export default { test: { include: ['tests/**/*.test.ts'] } };\n"]
        ]
      },
      {
        name: "dynamic-spread",
        command: "vitest run",
        configs: [["vitest.config.ts", "const shared = { include: ['tests/**/*.test.ts'] }; export default { test: { ...shared } };\n"]]
      },
      {
        name: "outer-dynamic-spread",
        command: "vitest run",
        configs: [["vitest.config.ts", "const shared = { test: { include: ['tests/**/*.test.ts'] } }; export default { test: {}, ...shared };\n"]]
      },
      {
        name: "shorthand-test-config",
        command: "vitest run",
        configs: [["vitest.config.ts", "const test = { include: ['tests/**/*.test.ts'] }; export default { test };\n"]]
      },
      {
        name: "misleading-static-text",
        command: "vitest run",
        configs: [["vitest.config.ts", "const marker = 'export default {'; // module.exports = {\nconst delegated = { test: { include: ['tests/**/*.test.ts'] } }; export default delegated;\n"]]
      },
      {
        name: "multiple-config-exports",
        command: "vitest run",
        configs: [["vitest.config.ts", "export default { test: {} }; module.exports = { test: { include: ['tests/**/*.test.ts'] } };\n"]]
      },
      {
        name: "shadowed-define-config",
        command: "vitest run",
        configs: [["vitest.config.ts", "const defineConfig = (value) => value; export default defineConfig({ test: { include: ['src/**/*.test.ts'] } });\n"]]
      },
      {
        name: "dead-function-export",
        command: "vitest run",
        configs: [["vitest.config.ts", "function unused() { module.exports = { test: { include: ['src/**/*.test.ts'] } }; } export default delegated;\n"]]
      },
      {
        name: "conditional-commonjs-export",
        command: "vitest run",
        configs: [["vitest.config.ts", "if (false) module.exports = { test: { include: ['src/**/*.test.ts'] } };\n"]]
      },
      {
        name: "mutated-commonjs-export",
        command: "vitest run",
        configs: [["vitest.config.ts", "module.exports = { test: {} }; module.exports.test.include = ['src/**/*.test.ts'];\n"]]
      },
      { name: "inline-dir", command: "vitest run --dir=tests", configs: [] }
    ] as const;
    for (const fixture of fixtures) {
      const rootDir = await mkdtemp(path.join(os.tmpdir(), `visual-hive-${fixture.name}-`));
      temporaryRoots.push(rootDir);
      await mkdir(path.join(rootDir, "src"), { recursive: true });
      await writeFile(path.join(rootDir, "package.json"), `${JSON.stringify({ name: fixture.name, scripts: { test: fixture.command } }, null, 2)}\n`, "utf8");
      await writeFile(path.join(rootDir, "package-lock.json"), "{}\n", "utf8");
      await writeFile(path.join(rootDir, "src", "value.ts"), "export const value = 1;\n", "utf8");
      await writeFile(path.join(rootDir, "src", "value.test.ts"), "import { it } from 'vitest'; it('runs', () => {});\n", "utf8");
      for (const [configPath, content] of fixture.configs) {
        await mkdir(path.dirname(path.join(rootDir, configPath)), { recursive: true });
        await writeFile(path.join(rootDir, configPath), content, "utf8");
      }
      const repo = await writeRepoMap({ repoRoot: rootDir, now: new Date("2026-07-12T04:20:00.000Z") });
      expect(repo.report.testFiles.find((file) => file.path === "src/value.test.ts")).toMatchObject({ runnerEligible: false });
      expect(repo.report.coverageGaps.some((gap) => gap.id === "unit-layer")).toBe(true);
    }

    const defaultRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-default-discovery-"));
    temporaryRoots.push(defaultRoot);
    await mkdir(path.join(defaultRoot, "src"), { recursive: true });
    await writeFile(path.join(defaultRoot, "package.json"), `${JSON.stringify({ name: "default-discovery", scripts: { test: "vitest run" } }, null, 2)}\n`, "utf8");
    await writeFile(path.join(defaultRoot, "package-lock.json"), "{}\n", "utf8");
    await writeFile(path.join(defaultRoot, "src", "value.ts"), "export const value = 1;\n", "utf8");
    await writeFile(path.join(defaultRoot, "src", "value.unit.ts"), "import { it } from 'vitest'; it('runs', () => {});\n", "utf8");
    const defaultRepo = await writeRepoMap({ repoRoot: defaultRoot, now: new Date("2026-07-12T04:20:30.000Z") });
    expect(defaultRepo.report.testFiles.find((file) => file.path === "src/value.unit.ts")).toMatchObject({ runnerEligible: false });
    await writeFile(path.join(defaultRoot, "src", "global.test.ts"), "test('global', () => {});\n", "utf8");
    const globalsDisabled = await writeRepoMap({ repoRoot: defaultRoot, now: new Date("2026-07-12T04:20:35.000Z") });
    expect(globalsDisabled.report.testFiles.find((file) => file.path === "src/global.test.ts")).toMatchObject({ runnerEligible: false });
    await writeFile(path.join(defaultRoot, "src", "global.test.ts"), "vi.fn(); test('global', () => {});\n", "utf8");
    const bareViDisabled = await writeRepoMap({ repoRoot: defaultRoot, now: new Date("2026-07-12T04:20:37.000Z") });
    expect(bareViDisabled.report.testFiles.find((file) => file.path === "src/global.test.ts")).toMatchObject({ runnerEligible: false });
    await writeFile(path.join(defaultRoot, "src", "expect-only.test.ts"), "import { expect } from 'vitest';\ntest('global', () => expect(true).toBe(true));\n", "utf8");
    await writeFile(path.join(defaultRoot, "src", "side-effect.test.ts"), "import 'vitest';\ntest('global', () => {});\n", "utf8");
    await writeFile(path.join(defaultRoot, "src", "alias.test.ts"), "import { test as check } from 'vitest';\ncheck('alias', () => {});\n", "utf8");
    const importBindings = await writeRepoMap({ repoRoot: defaultRoot, now: new Date("2026-07-12T04:20:38.000Z") });
    expect(importBindings.report.testFiles.find((file) => file.path === "src/expect-only.test.ts")).toMatchObject({ runnerEligible: false });
    expect(importBindings.report.testFiles.find((file) => file.path === "src/side-effect.test.ts")).toMatchObject({ runnerEligible: false });
    expect(importBindings.report.testFiles.find((file) => file.path === "src/alias.test.ts")).toMatchObject({ runnerEligible: true });
    await writeFile(path.join(defaultRoot, "vitest.config.ts"), "export default { test: { globals: true } };\n", "utf8");
    const globalsEnabled = await writeRepoMap({ repoRoot: defaultRoot, now: new Date("2026-07-12T04:20:40.000Z") });
    expect(globalsEnabled.report.testFiles.find((file) => file.path === "src/global.test.ts")).toMatchObject({ runnerEligible: true });
    await writeFile(path.join(defaultRoot, "vitest.config.ts"), "export default { pluginOptions: { test: { include: ['src/**/*.unit.ts'] } } };\n", "utf8");
    const nestedDecoy = await writeRepoMap({ repoRoot: defaultRoot, now: new Date("2026-07-12T04:20:45.000Z") });
    expect(nestedDecoy.report.testFiles.find((file) => file.path === "src/value.unit.ts")).toMatchObject({ runnerEligible: false });
    await mkdir(path.join(defaultRoot, "src", "legacy"), { recursive: true });
    await writeFile(path.join(defaultRoot, "src", "legacy", "value.test.ts"), "import { it } from 'vitest'; it('legacy', () => {});\n", "utf8");
    await writeFile(path.join(defaultRoot, "vitest.config.ts"), "export default { test: { include: ['src/**/*.test.ts', '!src/legacy/**'] } };\n", "utf8");
    const negatedInclude = await writeRepoMap({ repoRoot: defaultRoot, now: new Date("2026-07-12T04:20:50.000Z") });
    expect(negatedInclude.report.testFiles.find((file) => file.path === "src/legacy/value.test.ts")).toMatchObject({ runnerEligible: false });

    const jestRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-jest-outer-spread-"));
    temporaryRoots.push(jestRoot);
    await mkdir(path.join(jestRoot, "src"), { recursive: true });
    await writeFile(path.join(jestRoot, "package.json"), `${JSON.stringify({ name: "jest-outer-spread", scripts: { test: "jest" } }, null, 2)}\n`, "utf8");
    await writeFile(path.join(jestRoot, "package-lock.json"), "{}\n", "utf8");
    await writeFile(path.join(jestRoot, "src", "value.ts"), "export const value = 1;\n", "utf8");
    await writeFile(path.join(jestRoot, "src", "value.test.ts"), "import { test } from '@jest/globals'; test('runs', () => {});\n", "utf8");
    await writeFile(path.join(jestRoot, "jest.config.js"), "const shared = { testMatch: ['<rootDir>/tests/**/*.test.ts'] }; module.exports = { ...shared };\n", "utf8");
    const jestRepo = await writeRepoMap({ repoRoot: jestRoot, now: new Date("2026-07-12T04:21:00.000Z") });
    expect(jestRepo.report.testFiles.find((file) => file.path === "src/value.test.ts")).toMatchObject({ runnerEligible: false });
    expect(jestRepo.report.coverageGaps.some((gap) => gap.id === "unit-layer")).toBe(true);
    await writeFile(path.join(jestRoot, "jest.config.js"), "const testMatch = ['<rootDir>/tests/**/*.test.ts']; module.exports = { testMatch };\n", "utf8");
    const jestShorthand = await writeRepoMap({ repoRoot: jestRoot, now: new Date("2026-07-12T04:22:00.000Z") });
    expect(jestShorthand.report.testFiles.find((file) => file.path === "src/value.test.ts")).toMatchObject({ runnerEligible: false });
    await writeFile(path.join(jestRoot, "jest.config.js"), "const marker = 'module.exports = {'; // export default {\nmodule.exports = require('./jest.base.js');\n", "utf8");
    const jestDelegated = await writeRepoMap({ repoRoot: jestRoot, now: new Date("2026-07-12T04:23:00.000Z") });
    expect(jestDelegated.report.testFiles.find((file) => file.path === "src/value.test.ts")).toMatchObject({ runnerEligible: false });
    await writeFile(path.join(jestRoot, "jest.config.js"), "module.exports = { testMatch: process.env.MATCH, note: \"testMatch: ['src/**/*.test.ts']\" };\n", "utf8");
    const jestSpoofed = await writeRepoMap({ repoRoot: jestRoot, now: new Date("2026-07-12T04:24:00.000Z") });
    expect(jestSpoofed.report.testFiles.find((file) => file.path === "src/value.test.ts")).toMatchObject({ runnerEligible: false });
    await writeFile(path.join(jestRoot, "jest.config.js"), "module.exports = { testMatch: ['src/**/*.test.ts'], testMatch: ['tests/**/*.test.ts'] };\n", "utf8");
    const jestDuplicate = await writeRepoMap({ repoRoot: jestRoot, now: new Date("2026-07-12T04:25:00.000Z") });
    expect(jestDuplicate.report.testFiles.find((file) => file.path === "src/value.test.ts")).toMatchObject({ runnerEligible: false });
    await rm(path.join(jestRoot, "jest.config.js"));
    await writeFile(path.join(jestRoot, "package.json"), `${JSON.stringify({
      name: "jest-package-config",
      scripts: { test: "jest" },
      jest: { testMatch: ["<rootDir>/tests/**/*.test.ts"] }
    }, null, 2)}\n`, "utf8");
    const jestPackage = await writeRepoMap({ repoRoot: jestRoot, now: new Date("2026-07-12T04:26:00.000Z") });
    expect(jestPackage.report.testFiles.find((file) => file.path === "src/value.test.ts")).toMatchObject({ runnerEligible: false });
  });

  it("fails conservatively for unsupported restrictive discovery settings and positional filters", async () => {
    const cases = [
      { name: "vitest-dir", packageJson: { scripts: { test: "vitest run" }, devDependencies: { vitest: "^4.0.0" } }, source: "src/value.test.ts", content: "import { it } from 'vitest'; it('value', () => {});", config: ["vitest.config.ts", "export default { test: { dir: 'tests' } };\n"] },
      { name: "jest-regex", packageJson: { scripts: { test: "jest" }, devDependencies: { jest: "^30.0.0" } }, source: "src/value.test.ts", content: "import { test } from '@jest/globals'; test('value', () => {});", config: ["jest.config.js", "module.exports = { testRegex: 'tests/.*\\\\.test\\\\.js$' };\n"] },
      { name: "vitest-filter", packageJson: { scripts: { test: "vitest run src/only.test.ts" }, devDependencies: { vitest: "^4.0.0" } }, source: "src/other.test.ts", content: "import { it } from 'vitest'; it('other', () => {});" }
    ] as const;
    for (const fixture of cases) {
      const rootDir = await mkdtemp(path.join(os.tmpdir(), `visual-hive-${fixture.name}-`));
      temporaryRoots.push(rootDir);
      await mkdir(path.join(rootDir, "src"), { recursive: true });
      await writeFile(path.join(rootDir, "package.json"), `${JSON.stringify({ name: fixture.name, ...fixture.packageJson }, null, 2)}\n`, "utf8");
      await writeFile(path.join(rootDir, "src", "value.ts"), "export const value = 1;\n", "utf8");
      await writeFile(path.join(rootDir, ...fixture.source.split("/")), fixture.content, "utf8");
      if (fixture.config) await writeFile(path.join(rootDir, fixture.config[0]), fixture.config[1], "utf8");
      const repo = await writeRepoMap({ repoRoot: rootDir, now: new Date("2026-07-12T05:00:00.000Z") });
      expect(repo.report.testFiles.find((file) => file.path === fixture.source)).toMatchObject({ runnerEligible: false });
      expect(repo.report.coverageGaps.some((gap) => gap.id === "unit-layer")).toBe(true);
    }

    const pythonRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-pytest-python-files-"));
    temporaryRoots.push(pythonRoot);
    await Promise.all([mkdir(path.join(pythonRoot, "service"), { recursive: true }), mkdir(path.join(pythonRoot, "tests"), { recursive: true })]);
    await writeFile(path.join(pythonRoot, "service", "value.py"), "value = 1\n", "utf8");
    await writeFile(path.join(pythonRoot, "tests", "test_value.py"), "import pytest\n\ndef test_value():\n    assert 1 == 1\n", "utf8");
    await writeFile(path.join(pythonRoot, "pyproject.toml"), "[project]\ndependencies = ['pytest==8.3.4']\n[tool.pytest.ini_options]\npython_files = ['check_*.py']\n", "utf8");
    const pythonRepo = await writeRepoMap({ repoRoot: pythonRoot, now: new Date("2026-07-12T05:01:00.000Z") });
    expect(pythonRepo.report.testFiles.find((file) => file.path === "tests/test_value.py")).toMatchObject({ runnerEligible: false });
    expect(pythonRepo.report.coverageGaps.some((gap) => gap.id === "unit-layer")).toBe(true);
  });

  it("accepts a Vitest config option while ignoring nested coverage include and exclude patterns", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "visual-hive-ai-hpc-config-"));
    temporaryRoots.push(rootDir);
    const dashboard = path.join(rootDir, "dashboard");
    await Promise.all([
      mkdir(path.join(dashboard, "src", "__tests__"), { recursive: true }),
      mkdir(path.join(rootDir, "scripts", "testing"), { recursive: true }),
      mkdir(path.join(rootDir, "tests", "helpers"), { recursive: true }),
      mkdir(path.join(rootDir, "tests", "visual"), { recursive: true })
    ]);
    await writeFile(path.join(dashboard, "package.json"), `${JSON.stringify({
      name: "ai-hpc-portfolio-dashboard",
      private: true,
      scripts: { "test:unit": "vitest run --config ./vitest.config.cjs" },
      devDependencies: { vitest: "^2.1.8" }
    }, null, 2)}\n`, "utf8");
    await writeFile(path.join(dashboard, "src", "App.tsx"), "export const App = () => <main>AI HPC</main>;\n", "utf8");
    await writeFile(
      path.join(dashboard, "src", "__tests__", "App.test.tsx"),
      "import { render } from '@testing-library/react';\nimport { expect, it } from 'vitest';\nimport { App } from '../App.js';\nit('renders App', () => expect(render(<App />).container).toBeTruthy());\n",
      "utf8"
    );
    await writeFile(path.join(rootDir, "scripts", "testing", "run-playwright.mjs"), "export const runPlaywright = async () => {};\n", "utf8");
    await writeFile(path.join(rootDir, "tests", "helpers", "browser-health.ts"), "import type { Page } from '@playwright/test';\nexport const isHealthy = (page: Page) => Boolean(page);\n", "utf8");
    await writeFile(path.join(rootDir, "tests", "visual", "visual-routes.ts"), "export const visualRoutes = ['/'];\n", "utf8");
    await writeFile(path.join(dashboard, "vitest.config.cjs"), `const { defineConfig } = require("vitest/config");
module.exports = defineConfig({
  test: {
    environment: "jsdom",
    coverage: {
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/main.tsx", "src/types.ts", "src/setupTests.ts", "src/**/*.d.ts", "src/**/__tests__/**"],
    },
  },
});
`, "utf8");

    const repo = await writeRepoMap({ repoRoot: rootDir, now: new Date("2026-07-12T05:02:00.000Z") });
    expect(repo.report.testRunners.find((runner) => runner.tool === "vitest" && runner.scope === "dashboard")).toMatchObject({
      command: { cwd: "dashboard", executable: "npm", args: ["run", "test:unit"] },
      discoveryConstraints: ["config:vitest.config.cjs"]
    });
    expect(repo.report.testFiles.find((file) => file.path === "dashboard/src/__tests__/App.test.tsx")).toMatchObject({
      kind: "component",
      runtime: "javascript",
      scope: "dashboard",
      runnerEligible: true,
      eligibilityEvidence: ["runner:vitest:default-discovery"]
    });
    expect(repo.report.runtimeScopes).toEqual([
      { runtime: "javascript", scope: "dashboard", sourceFiles: ["dashboard/src/App.tsx"] }
    ]);
    expect(repo.report.testFiles.some((file) => file.path === "tests/helpers/browser-health.ts" || file.path === "tests/visual/visual-routes.ts")).toBe(false);
    expect(repo.report.coverageGaps.some((gap) => gap.id === "unit-layer")).toBe(false);
    await expectRepoMapSchema(repo.report);
  });

  it("rejects absolute and option-like cwd values from stale runner evidence", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "visual-hive-unsafe-cwd-"));
    temporaryRoots.push(rootDir);
    await mkdir(path.join(rootDir, ".visual-hive"), { recursive: true });
    const runner = (cwd: string) => ({
      tool: "vitest",
      runtime: "javascript",
      kind: "unit",
      scope: cwd,
      command: { cwd, executable: "npm", args: ["test"] },
      commandProvider: "npm",
      discoveryConstraints: [],
      evidence: ["stale:crafted"]
    });
    await writeFile(path.join(rootDir, ".visual-hive", "repo-map.json"), `${JSON.stringify({ testFiles: [], testRunners: [runner("/tmp"), runner("-P")], runtimeScopes: [] }, null, 2)}\n`, "utf8");
    await writeFile(path.join(rootDir, ".visual-hive", "test-creation-plan.json"), `${JSON.stringify({
      recommendations: [{
        id: "layer-2-partial",
        source: "testing_layer",
        kind: "unit_test",
        priority: "medium",
        title: "Add unit test evidence for Unit",
        rationale: ["Runner evidence is incomplete."],
        layer: { id: 2, name: "Unit", status: "partial" },
        suggestedTests: ["Add a unit test."],
        artifacts: [".visual-hive/repo-map.json"],
        affected: { route: "/", component: "app" }
      }]
    }, null, 2)}\n`, "utf8");
    const issues = await writeIssuesArtifacts({ rootDir, project: "unsafe-cwd", now: new Date("2026-07-12T06:00:00.000Z") });
    const validation = issues.report.issues.find((candidate) => candidate.issueKind === "test_adequacy_gap")?.validationCommand ?? "";
    expect(validation).not.toContain("/tmp");
    expect(validation).not.toContain("cd -P");
    expect(validation).toBe("visual-hive analyze --repo . && visual-hive evidence && visual-hive test-creation-plan && visual-hive issues --write");
  });
});

async function expectRepoMapSchema(value: unknown): Promise<void> {
  const schema = JSON.parse(await readFile(path.join(repoRoot, "schemas", "visual-hive.repo-map.schema.json"), "utf8"));
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
  expect(validate(value), JSON.stringify(validate.errors, null, 2)).toBe(true);
}
