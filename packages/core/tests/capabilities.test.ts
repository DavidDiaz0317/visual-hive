import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { minimatch } from "minimatch";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { VISUAL_HIVE_CAPABILITY_BASELINE } from "../src/capabilities/baseline.js";
import { buildCapabilityInventory } from "../src/capabilities/inventory.js";
import { buildCapabilityParityReport } from "../src/capabilities/report.js";
import type { CapabilityInventory } from "../src/capabilities/types.js";
import { VISUAL_HIVE_ARTIFACT_SURFACE_PATHS } from "../src/artifacts/surfaces.js";
import { VISUAL_HIVE_EVIDENCE_RESOURCES } from "../src/tools/evidenceResources.js";
import { githubWorkflowTemplates } from "../src/github/workflowTemplates.js";
import { SCHEDULE_EXECUTION_LANE_IDS } from "../src/schedules/audit.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

describe("capability parity report", () => {
  it("keeps known unsupported runtime lanes explicit without treating them as omitted", () => {
    const actual = cloneBaseline();
    const report = buildCapabilityParityReport(VISUAL_HIVE_CAPABILITY_BASELINE, actual, new Date("2026-07-14T12:00:00.000Z"));

    expect(report.status).toBe("passed");
    expect(report.runtimeStatus).toBe("blocked");
    expect(report.summary.missing).toBe(0);
    expect(report.summary.unexpected).toBe(0);
    expect(report.summary.mismatched).toBe(0);
    expect(report.checks.filter((check) => check.status === "blocked").map((check) => check.key)).toEqual([
      "applitools",
      "chromatic",
      "github-checks",
      "percy",
      "storybook"
    ]);
    expect(report.checks.filter((check) => check.status === "blocked").every((check) => check.parity)).toBe(true);

    const argos = actual.providers.find((provider) => provider.id === "argos");
    expect(argos).toMatchObject({
      runtimeStatus: "supported",
      supportedOperations: expect.arrayContaining(["upload_artifact"]),
      operations: expect.arrayContaining([
        expect.objectContaining({ operation: "upload_artifact", runtimeStatus: "supported" }),
        expect.objectContaining({ operation: "compare", runtimeStatus: "blocked" }),
        expect.objectContaining({ operation: "fetch_result", runtimeStatus: "blocked" })
      ])
    });
    expect(report.checks.find((check) => check.domain === "providers" && check.key === "argos")).toMatchObject({
      status: "present",
      parity: true
    });
  });

  it("fails closed for removed, unreviewed, or weakened public surfaces", () => {
    const actual = cloneBaseline();
    actual.planModes = actual.planModes.filter((entry) => entry.mode !== "full");
    actual.cli.push({ path: "unreviewed-command", aliases: [], contractSha256: "0".repeat(64) });
    actual.providers = actual.providers.map((provider) =>
      provider.id === "playwright"
        ? { ...provider, runtimeStatus: "blocked", blockedReason: "runtime missing" }
        : provider
    );

    const report = buildCapabilityParityReport(VISUAL_HIVE_CAPABILITY_BASELINE, actual);

    expect(report.status).toBe("failed");
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ domain: "planModes", key: "full", status: "missing", parity: false }),
      expect.objectContaining({ domain: "cli", key: "unreviewed-command", status: "unexpected", parity: false }),
      expect.objectContaining({ domain: "providers", key: "playwright", status: "mismatched", parity: false })
    ]));
  });

  it("fails when content-addressed contracts drift without changing their public identity", () => {
    const actual = cloneBaseline();
    actual.cli = actual.cli.map((entry) =>
      entry.path === "analyze" ? { ...entry, contractSha256: "0".repeat(64) } : entry
    );
    actual.schemas = actual.schemas.map((entry, index) =>
      index === 0 ? { ...entry, sha256: "1".repeat(64) } : entry
    );
    actual.artifactSurfaces = actual.artifactSurfaces.map((entry) =>
      entry.path === ".visual-hive/evidence-summary.md" ? { ...entry, contractSha256: "3".repeat(64) } : entry
    );
    actual.workflowLanes = actual.workflowLanes.map((entry) =>
      entry.id === "template:pull_request" ? { ...entry, sha256: "2".repeat(64) } : entry
    );
    actual.mutationOperators = actual.mutationOperators.filter((entry) => entry.id !== "api-500");
    actual.deterministicPrimitives = actual.deterministicPrimitives.filter((entry) => entry.id !== "selector:mustExist");

    const report = buildCapabilityParityReport(VISUAL_HIVE_CAPABILITY_BASELINE, actual);

    expect(report.status).toBe("failed");
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ domain: "cli", key: "analyze", status: "mismatched", parity: false }),
      expect.objectContaining({ domain: "schemas", key: actual.schemas[0]!.filename, status: "mismatched", parity: false }),
      expect.objectContaining({ domain: "artifactSurfaces", key: ".visual-hive/evidence-summary.md", status: "mismatched", parity: false }),
      expect.objectContaining({ domain: "workflowLanes", key: "template:pull_request", status: "mismatched", parity: false }),
      expect.objectContaining({ domain: "mutationOperators", key: "api-500", status: "missing", parity: false }),
      expect.objectContaining({ domain: "deterministicPrimitives", key: "selector:mustExist", status: "missing", parity: false })
    ]));
  });

  it("freezes every declared fixed and dynamic artifact surface without treating it as an MCP resource", async () => {
    const surfaces = [...VISUAL_HIVE_ARTIFACT_SURFACE_PATHS].sort((left, right) => left.localeCompare(right));
    const actual = buildCapabilityInventory({ cli: [], schemas: [], controlPlane: [] }).artifactSurfaces;
    const requiredDynamicPatterns = [
      ".visual-hive/agents/*/agent-output.md",
      ".visual-hive/agents/*/agent-request.md",
      ".visual-hive/agents/*/agent-run.json",
      ".visual-hive/agents/*/write-preview.json",
      ".visual-hive/artifacts/diffs/**",
      ".visual-hive/artifacts/screenshots/**",
      ".visual-hive/bundles/*/files/**",
      ".visual-hive/bundles/*/manifest.json",
      ".visual-hive/history/*/baseline-review.md",
      ".visual-hive/history/*/contracts.json",
      ".visual-hive/history/*/coverage.json",
      ".visual-hive/history/*/flows.json",
      ".visual-hive/history/*/issue.md",
      ".visual-hive/history/*/llm-usage.json",
      ".visual-hive/history/*/missing-tests.md",
      ".visual-hive/history/*/mutation-report.json",
      ".visual-hive/history/*/plan.json",
      ".visual-hive/history/*/pr-comment.md",
      ".visual-hive/history/*/repair-prompt.md",
      ".visual-hive/history/*/report.json",
      ".visual-hive/history/*/schedules.json",
      ".visual-hive/history/*/targets.json",
      ".visual-hive/history/*/triage-prompt.md",
      ".visual-hive/history/*/triage.json",
      ".visual-hive/hive/modes/*/**",
      ".visual-hive/hive/wiki/*.md",
      ".visual-hive/plan*.json",
      ".visual-hive/provider-upload/argos/screenshots/**",
      ".visual-hive/repair",
      ".visual-hive/repair/sessions",
      ".visual-hive/repair/sessions/*",
      ".visual-hive/repair/sessions/*/task-assets",
      ".visual-hive/repair/sessions/*/task-assets/**",
      ".visual-hive/repair/sessions/*/task-context.json",
      ".visual-hive/repair/sessions/*/runs",
      ".visual-hive/repair/sessions/*/runs/exec.*",
      ".visual-hive/repair/sessions/*/runs/exec.*/**",
      ".visual-hive/repair/sessions/*/runs/run.*",
      ".visual-hive/repair/sessions/*/runs/run.*/bundle",
      ".visual-hive/repair/sessions/*/runs/run.*/bundle/*/files/**",
      ".visual-hive/repair/sessions/*/runs/run.*/bundle/*/manifest.json",
      ".visual-hive/repair/sessions/*/runs/run.*/capture-failure.json",
      ".visual-hive/repair/sessions/*/runs/run.*/capture-input.json",
      ".visual-hive/repair/sessions/*/runs/run.*/capture-metadata.json",
      ".visual-hive/repair/sessions/*/runs/run.*/capture-result.json",
      ".visual-hive/repair/sessions/*/runs/run.*/report.json",
      ".visual-hive/repair/sessions/*/runs/run.*/run-context.json",
      ".visual-hive/repair/sessions/*/runs/run.*.failed.*",
      ".visual-hive/repair/sessions/*/runs/run.*.failed.*/**",
      ".visual-hive/repair/sessions/*/runs/run.*.interrupted.*",
      ".visual-hive/repair/sessions/*/runs/run.*.interrupted.*/**",
      ".visual-hive/repair/sessions/*/validations",
      ".visual-hive/repair/sessions/*/validations/*.json",
      ".visual-hive/snapshots/**"
    ];
    const requiredFixedDiagnostics = [
      ".visual-hive/config-edits.json",
      ".visual-hive/connections.json",
      ".visual-hive/control-plane-actions.json",
      ".visual-hive/github-app-issue-preview.md",
      ".visual-hive/github-app-live-publish-result.json",
      ".visual-hive/github-app-live-smoke-result.json",
      ".visual-hive/github-app-setup-issue-preview.md",
      ".visual-hive/github-app-webhook-result.json",
      ".visual-hive/hive-issue-dry-run.json",
      ".visual-hive/runbook.json",
      ".visual-hive/setup-doc-edits.json",
      ".visual-hive/setup-progress.json",
      ".visual-hive/workflow-edits.json"
    ];

    expect(new Set(surfaces).size).toBe(surfaces.length);
    expect(surfaces).not.toContain(".visual-hive/i.test");
    expect(surfaces).not.toContain(".visual-hive/plan");
    expect(surfaces).toEqual(expect.arrayContaining([...requiredDynamicPatterns, ...requiredFixedDiagnostics]));
    expect(actual.map((entry) => entry.path)).toEqual(surfaces);
    expect(actual.every((entry) => /^[a-f0-9]{64}$/.test(entry.contractSha256))).toBe(true);

    for (const resource of VISUAL_HIVE_EVIDENCE_RESOURCES) {
      if (!resource.relativePath.startsWith(".visual-hive/")) continue;
      expect(isArtifactSurfaceCovered(resource.relativePath, surfaces), resource.id).toBe(true);
    }

    const sourceDeclarations = await collectArtifactDeclarations([
      path.join(repoRoot, "packages", "core", "src"),
      path.join(repoRoot, "packages", "cli", "src"),
      path.join(repoRoot, "packages", "control-plane", "src"),
      path.join(repoRoot, "packages", "playwright-adapter", "src"),
      path.join(repoRoot, "packages", "github-app", "src")
    ]);
    const reviewDocuments = [
      path.join(repoRoot, "docs", "report-schema.md"),
      path.join(repoRoot, "docs", "control-plane.md"),
      path.join(repoRoot, "docs", "github-app.md"),
      path.join(repoRoot, "docs", "setup-recommendations.md"),
      path.join(repoRoot, "scripts", "run-demo-full-tool-suite.mjs")
    ];
    const documentedDeclarations = new Set<string>();
    for (const document of reviewDocuments) {
      for (const artifactPath of extractArtifactPaths(await readFile(document, "utf8"))) documentedDeclarations.add(artifactPath);
    }
    const declared = new Set([...sourceDeclarations, ...documentedDeclarations, ...requiredDynamicPatterns]);
    const githubAppSources = [
      await readFile(path.join(repoRoot, "packages", "github-app", "src", "server.ts"), "utf8"),
      await readFile(path.join(repoRoot, "packages", "github-app", "src", "liveSmoke.ts"), "utf8")
    ].join("\n");
    for (const artifactPath of requiredFixedDiagnostics.filter((candidate) => candidate.startsWith(".visual-hive/github-app-"))) {
      expect(githubAppSources, artifactPath).toContain(path.basename(artifactPath));
      expect(githubAppSources, "GitHub App default output directory").toContain('".visual-hive"');
      declared.add(artifactPath);
    }

    expect([...declared].filter((artifactPath) => !isArtifactSurfaceCovered(artifactPath, surfaces))).toEqual([]);
    expect(surfaces.filter((surface) => !isSurfaceDeclared(surface, declared))).toEqual([]);
    expect(actual).toEqual(VISUAL_HIVE_CAPABILITY_BASELINE.artifactSurfaces);
  });

  it("freezes all execution lanes and generated workflow templates without key collisions", () => {
    const actual = buildCapabilityInventory({ cli: [], schemas: [], controlPlane: [] }).workflowLanes;
    const execution = actual.filter((lane) => lane.kind === "execution");
    const templates = actual.filter((lane) => lane.kind === "template");

    expect(execution.map((lane) => lane.id).sort()).toEqual(
      SCHEDULE_EXECUTION_LANE_IDS.map((laneId) => `execution:${laneId}`).sort()
    );
    expect(templates.map((lane) => lane.id).sort()).toEqual(
      githubWorkflowTemplates.map((template) => `template:${template.id}`).sort()
    );
    expect(templates.map((lane) => lane.path).every(Boolean)).toBe(true);
    expect(templates.map((lane) => lane.sha256).every((digest) => /^[a-f0-9]{64}$/.test(digest ?? ""))).toBe(true);
    expect(new Set(actual.map((lane) => lane.id)).size).toBe(9);
    expect(actual).toEqual(VISUAL_HIVE_CAPABILITY_BASELINE.workflowLanes);

    const missingExecutionLane = cloneBaseline();
    missingExecutionLane.workflowLanes = missingExecutionLane.workflowLanes.filter((lane) => lane.id !== "execution:protected");
    expect(buildCapabilityParityReport(VISUAL_HIVE_CAPABILITY_BASELINE, missingExecutionLane).checks).toContainEqual(
      expect.objectContaining({ domain: "workflowLanes", key: "execution:protected", status: "missing", parity: false })
    );
  });

  it("keeps every frozen checked-in schema valid JSON Schema 2020-12", async () => {
    for (const capability of VISUAL_HIVE_CAPABILITY_BASELINE.schemas) {
      const schema = JSON.parse(await readFile(path.join(repoRoot, "schemas", capability.filename), "utf8"));
      expect(() => new Ajv2020({ allErrors: true, strict: false }).compile(schema), capability.filename).not.toThrow();
    }
  }, 30_000);
});

function cloneBaseline(): CapabilityInventory {
  return structuredClone(VISUAL_HIVE_CAPABILITY_BASELINE);
}

async function collectArtifactDeclarations(roots: string[]): Promise<Set<string>> {
  const declarations = new Set<string>();
  for (const root of roots) {
    for (const filename of await sourceFiles(root)) {
      if (filename.endsWith(path.join("artifacts", "surfaces.ts"))) continue;
      const source = await readFile(filename, "utf8");
      const sourceFile = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node): void => {
        if (ts.isStringLiteralLike(node)) {
          for (const artifactPath of extractArtifactPaths(node.text)) declarations.add(artifactPath);
        }
        ts.forEachChild(node, visit);
      };
      visit(sourceFile);
    }
  }
  return declarations;
}

async function sourceFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(target));
    else if (entry.isFile() && (target.endsWith(".ts") || target.endsWith(".mjs"))) files.push(target);
  }
  return files;
}

function extractArtifactPaths(value: string): string[] {
  return [...value.matchAll(/\.visual-hive(?:\/[A-Za-z0-9_.*-]+)+/g)]
    .map((match) => match[0]!.replace(/(\.json|\.md|\.ts)\.$/u, "$1"));
}

function isArtifactSurfaceCovered(artifactPath: string, surfaces: string[]): boolean {
  return surfaces.some((surface) => surface === artifactPath || (surface.includes("*") && minimatch(artifactPath, surface, { dot: true })));
}

function isSurfaceDeclared(surface: string, declarations: Set<string>): boolean {
  if (declarations.has(surface)) return true;
  if (surface.includes("*")) return [...declarations].some((artifactPath) => minimatch(artifactPath, surface, { dot: true }));
  return false;
}
