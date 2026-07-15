import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { VisualHiveConfigSchema } from "../src/config/schema.js";
import type { VisualGraph } from "../src/graph/types.js";
import type { RepoMapReport } from "../src/repo/types.js";
import { sha256Bytes } from "../src/repair/canonical.js";
import { compileVisualHiveTaskContext, type CompileVisualTaskContextOptions } from "../src/repair/taskContextCompiler.js";

const generatedAt = "2026-07-15T12:00:00.000Z";
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe("deterministic repair task-context compiler", () => {
  it("maps only configured evidence into a profile, obligation, and exact source span", async () => {
    const fixture = await repositoryFixture();
    const options = compilerOptions(fixture.root, fixture.repoMap, fixture.graph);

    const compiled = await compileVisualHiveTaskContext(options);

    expect(compiled.taskContext.profiles).toHaveLength(1);
    expect(compiled.taskContext.profiles[0]).toMatchObject({
      targetId: "app",
      validationCommandId: "command.visual-repair-app",
      contractIds: ["checkout.save"],
      routes: ["/checkout"],
      scenarioIds: ["default"],
      viewports: [{ viewportId: "desktop", width: 1280, height: 720, deviceScaleFactor: 1 }]
    });
    expect(compiled.taskContext.obligations).toEqual([
      expect.objectContaining({
        mappedContractIds: ["checkout.save"],
        route: "/checkout",
        state: "default",
        viewportId: "desktop",
        sourceAssetIds: [],
        assertionKind: "pixel_region",
        authority: "deterministic",
        status: "mapped"
      })
    ]);
    expect(compiled.taskContext.graphCandidates).toEqual([
      expect.objectContaining({
        nodeId: "component.SaveOrderButton",
        kind: "component",
        sourceSpans: [expect.objectContaining({ path: "src/Checkout.tsx", startLine: 3, endLine: 3 })]
      })
    ]);
    expect(compiled.taskContext.sourceContext.files).toEqual([
      expect.objectContaining({ path: "src/Checkout.tsx", classification: "source" })
    ]);
    expect(compiled.report.selection.mappedContractIds).toEqual(["checkout.save"]);
    expect(compiled.report.resolution.deterministicObligations).toBe(1);
    expect(compiled.taskContext.safety).toMatchObject({ externalCallsMade: 0, networkCallsMade: 0, writesMade: 0 });
  });

  it("is byte-stable for repeated compilation from unchanged inputs", async () => {
    const fixture = await repositoryFixture();
    const options = compilerOptions(fixture.root, fixture.repoMap, fixture.graph);

    const first = await compileVisualHiveTaskContext(options);
    const second = await compileVisualHiveTaskContext(options);

    expect(second.taskContext).toEqual(first.taskContext);
    expect(second.input).toEqual(first.input);
    expect(second.report).toEqual(first.report);
    expect(second.report.reportDigest).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("does not invent candidates, profiles, commands, or contracts for a neutral issue", async () => {
    const fixture = await repositoryFixture();
    const options = compilerOptions(fixture.root, fixture.repoMap, fixture.graph);
    options.issue = {
      source: "fixture",
      externalId: "neutral-1",
      title: "Unrelated concern",
      problemStatement: "Typography kerning differs in an unrelated legal notice."
    };

    const compiled = await compileVisualHiveTaskContext(options);

    expect(compiled.taskContext.graphCandidates).toEqual([]);
    expect(compiled.taskContext.profiles).toEqual([]);
    expect(compiled.taskContext.obligations).toEqual([
      expect.objectContaining({
        mappedContractIds: [],
        authority: "advisory",
        status: "unresolved"
      })
    ]);
    expect(compiled.report.resolution.codes).toContain("no_configured_contract_match");
  });

  it("does not attach source files from a different repository-map node that only shares a label", async () => {
    const fixture = await repositoryFixture();
    await writeFile(path.join(fixture.root, "src", "Other.tsx"), "export const SaveOrderButton = 'unrelated';\n");
    fixture.repoMap.visualMap.nodes.push({
      ...structuredClone(fixture.repoMap.visualMap.nodes[0]!),
      id: "component.UnrelatedSaveOrderButton",
      sourceFiles: ["src/Other.tsx"],
      provenance: {
        ...structuredClone(fixture.repoMap.visualMap.nodes[0]!.provenance),
        sourceFile: "src/Other.tsx"
      }
    });

    const compiled = await compileVisualHiveTaskContext(compilerOptions(fixture.root, fixture.repoMap, fixture.graph));

    expect(compiled.taskContext.graphCandidates[0]?.sourceSpans.map((span) => span.path)).toEqual(["src/Checkout.tsx"]);
    expect(compiled.taskContext.sourceContext.files.map((file) => file.path)).toEqual(["src/Checkout.tsx"]);
  });

  it("keeps a matched contract advisory when no registered validation command exists", async () => {
    const fixture = await repositoryFixture();
    const options = compilerOptions(fixture.root, fixture.repoMap, fixture.graph);
    delete options.registeredValidationCommands;

    const compiled = await compileVisualHiveTaskContext(options);

    expect(compiled.taskContext.profiles).toEqual([]);
    expect(compiled.taskContext.obligations[0]).toMatchObject({
      mappedContractIds: [],
      authority: "advisory",
      status: "unresolved"
    });
    expect(compiled.report.resolution.codes).toContain("matched_contract_without_registered_validation_command");
  });

  it("keeps DOM-only, text-only, and behavior-only contracts advisory", async () => {
    const fixture = await repositoryFixture();
    const base = compilerOptions(fixture.root, fixture.repoMap, fixture.graph);
    const variants = [
      {
        assertionKind: "dom" as const,
        mutate: (contract: typeof base.config.contracts[number]) => {
          contract.screenshots = [];
        }
      },
      {
        assertionKind: "text" as const,
        mutate: (contract: typeof base.config.contracts[number]) => {
          contract.screenshots = [];
          contract.selectors.mustExist = [];
          contract.selectors.textMustExist = ["Save order"];
        }
      },
      {
        assertionKind: "behavior" as const,
        mutate: (contract: typeof base.config.contracts[number]) => {
          contract.screenshots = [];
          contract.selectors.mustExist = [];
          contract.steps = [{ action: "click", selector: "data-testid=save-order", state: "visible", timeoutMs: 5000 }];
        }
      }
    ];

    for (const variant of variants) {
      const options = { ...base, config: structuredClone(base.config) };
      variant.mutate(options.config.contracts[0]!);
      const compiled = await compileVisualHiveTaskContext(options);

      expect(compiled.taskContext.profiles, variant.assertionKind).toEqual([]);
      expect(compiled.taskContext.obligations, variant.assertionKind).toEqual([
        expect.objectContaining({
          assertionKind: variant.assertionKind,
          authority: "advisory",
          mappedContractIds: [],
          sourceAssetIds: [],
          state: "default",
          status: "unresolved"
        })
      ]);
      expect(compiled.report.resolution.codes, variant.assertionKind).toContain("matched_contract_without_supported_screenshot_capture");
    }
  });

  it("keeps a screenshot contract advisory without an exact configured viewport", async () => {
    const fixture = await repositoryFixture();
    const options = compilerOptions(fixture.root, fixture.repoMap, fixture.graph);
    options.config.contracts[0]!.screenshots[0]!.viewport = "missing";

    const compiled = await compileVisualHiveTaskContext(options);

    expect(compiled.taskContext.profiles).toEqual([]);
    expect(compiled.taskContext.obligations).toEqual([
      expect.objectContaining({ authority: "advisory", mappedContractIds: [], status: "unresolved" })
    ]);
    expect(compiled.report.resolution.codes).toContain("matched_contract_without_supported_screenshot_capture");
  });

  it("resolves analyzeRepository's relative repo root against the requested repository", async () => {
    const fixture = await repositoryFixture();
    const relativeMap = structuredClone(fixture.repoMap);
    relativeMap.repoRoot = ".";

    const compiled = await compileVisualHiveTaskContext(compilerOptions(fixture.root, relativeMap, fixture.graph));

    expect(compiled.taskContext.profiles).toHaveLength(1);
    expect(compiled.report.repository.checkoutVerified).toBe(true);

    const escapingMap = structuredClone(fixture.repoMap);
    escapingMap.repoRoot = "..";
    await expect(compileVisualHiveTaskContext(compilerOptions(fixture.root, escapingMap, fixture.graph))).rejects.toThrow("does not belong to repoRoot");
  });

  it("verifies local assets by containment, size, and digest", async () => {
    const fixture = await repositoryFixture();
    await mkdir(path.join(fixture.root, "evidence"));
    const image = Buffer.from("fixture-image");
    await writeFile(path.join(fixture.root, "evidence", "problem.png"), image);
    const options = compilerOptions(fixture.root, fixture.repoMap, fixture.graph);
    options.assets = [{
      assetId: "problem-image",
      role: "problem",
      path: "evidence/problem.png",
      mediaType: "image/png",
      sha256: sha256Bytes(image),
      size: image.byteLength,
      provenance: { kind: "fixture", sourceId: "fixture-asset" },
      regions: []
    }];
    options.imageReferences = [{ position: 0, assetId: "problem-image", role: "problem", caption: "Reported checkout state" }];

    const compiled = await compileVisualHiveTaskContext(options);
    expect(compiled.report.assets).toEqual({ verified: 1, imageReferences: 1 });
    expect(compiled.taskContext.obligations).toEqual([
      expect.objectContaining({ authority: "deterministic", mappedContractIds: ["checkout.save"], sourceAssetIds: [] }),
      expect.objectContaining({ authority: "advisory", mappedContractIds: [], sourceAssetIds: ["problem-image"], status: "unresolved" })
    ]);
    expect(compiled.report.resolution.codes).toContain("visual_assets_require_explicit_obligation_mapping");

    options.assets[0] = { ...options.assets[0]!, sha256: "f".repeat(64) };
    await expect(compileVisualHiveTaskContext(options)).rejects.toThrow("asset digest mismatch");
  });

  it("omits answer paths and rejects mismatched repository identity or unsafe assets", async () => {
    const fixture = await repositoryFixture();
    const unsafeGraph = structuredClone(fixture.graph);
    unsafeGraph.nodes[0]!.sourceSpan = { filePath: "answers/gold.ts" };
    unsafeGraph.nodes[0]!.metadata = { selectors: ["data-testid=save-order"], contractIds: ["checkout.save"] };
    const unsafeMap = structuredClone(fixture.repoMap);
    unsafeMap.visualMap.nodes[0]!.sourceFiles = ["answers/gold.ts"];
    unsafeMap.visualMap.nodes[0]!.provenance.sourceFile = "answers/gold.ts";
    unsafeMap.selectors = [];
    unsafeMap.routes = [];
    const omitted = await compileVisualHiveTaskContext(compilerOptions(fixture.root, unsafeMap, unsafeGraph));
    expect(omitted.taskContext.graphCandidates).toEqual([]);
    expect(omitted.taskContext.sourceContext.files).toEqual([]);
    expect(omitted.taskContext.sourceContext.omittedPaths).toBeGreaterThan(0);

    const wrongMap = structuredClone(fixture.repoMap);
    wrongMap.repoRoot = path.join(fixture.root, "other");
    await expect(compileVisualHiveTaskContext(compilerOptions(fixture.root, wrongMap, fixture.graph))).rejects.toThrow("does not belong to repoRoot");

    const invalidBase = compilerOptions(fixture.root, fixture.repoMap, fixture.graph);
    invalidBase.repository.baseSha = "not-a-commit";
    await expect(compileVisualHiveTaskContext(invalidBase)).rejects.toThrow("base SHA format is invalid");

    const checkoutMismatch = compilerOptions(fixture.root, fixture.repoMap, fixture.graph);
    checkoutMismatch.observedCheckoutSha = "b".repeat(40);
    await expect(compileVisualHiveTaskContext(checkoutMismatch)).rejects.toThrow("does not match the observed checkout SHA");

    const missingCheckout = compilerOptions(fixture.root, fixture.repoMap, fixture.graph) as Partial<CompileVisualTaskContextOptions>;
    delete missingCheckout.observedCheckoutSha;
    await expect(compileVisualHiveTaskContext(missingCheckout as CompileVisualTaskContextOptions)).rejects.toThrow("observed checkout SHA format is invalid");

    const unsafeAsset = compilerOptions(fixture.root, fixture.repoMap, fixture.graph);
    unsafeAsset.assets = [{
      assetId: "answer-image",
      role: "problem",
      path: "answers/problem.png",
      mediaType: "image/png",
      sha256: "f".repeat(64),
      size: 1,
      provenance: { kind: "fixture", sourceId: "unsafe" },
      regions: []
    }];
    await expect(compileVisualHiveTaskContext(unsafeAsset)).rejects.toThrow("prohibits answer and grader paths");
  });

  it("applies stable source and obligation bounds with an auditable receipt", async () => {
    const fixture = await repositoryFixture();
    const options = compilerOptions(fixture.root, fixture.repoMap, fixture.graph);
    options.bounds = { maxSourceFileBytes: 8, maxSourceBytes: 8, maxObligations: 1 };

    const compiled = await compileVisualHiveTaskContext(options);

    expect(compiled.taskContext.graphCandidates).toEqual([]);
    expect(compiled.taskContext.sourceContext).toMatchObject({ files: [], truncated: true });
    expect(compiled.report.sourceContext).toMatchObject({ selectedFiles: 0, selectedBytes: 0, truncated: true });
    expect(compiled.report.reportDigest).toMatch(/^[a-f0-9]{64}$/u);
  });
});

async function repositoryFixture(): Promise<{ root: string; repoMap: RepoMapReport; graph: VisualGraph }> {
  const root = await mkdtemp(path.join(tmpdir(), "visual-hive-task-context-"));
  temporaryDirectories.push(root);
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src", "Checkout.tsx"), [
    "export function Checkout() {",
    "  return (",
    "    <button data-testid=\"save-order\">Save order</button>",
    "  );",
    "}"
  ].join("\n"));

  const repoMap: RepoMapReport = {
    schemaVersion: 1,
    generatedAt,
    repoRoot: root,
    project: { name: "fixture", packageManager: "npm", workspaces: [], frameworks: ["react"] },
    packages: [],
    scripts: [],
    sourceSummary: { scannedFiles: 1, truncated: false, extensions: { ".tsx": 1 } },
    selectors: [{ selector: "data-testid=save-order", sourceFile: "src/Checkout.tsx", occurrences: 1 }],
    routes: [{ route: "/checkout", sourceFile: "src/Checkout.tsx", occurrences: 1 }],
    workflows: [],
    testTools: [],
    testFiles: [],
    testRunners: [],
    runtimeScopes: [],
    targetHints: [],
    riskSignals: [],
    coverageGaps: [],
    visualMap: {
      schemaVersion: 1,
      generatedAt,
      summary: { nodes: 1, edges: 0, routes: 1, components: 1, contracts: 1, screenshots: 1, mutations: 0, activeFindings: 0 },
      lifecycle: "File -> Component -> Layout -> Route -> State -> Viewport -> Target -> Contract -> Screenshot -> Mutation -> Issue",
      nodes: [{
        id: "component.SaveOrderButton",
        kind: "component",
        label: "SaveOrderButton",
        status: "active",
        provenance: { source: "static", confidence: "high", sourceFile: "src/Checkout.tsx", generatedAt, firstSeen: generatedAt },
        sourceFiles: ["src/Checkout.tsx"],
        routes: ["/checkout"],
        states: [],
        viewports: ["desktop"],
        selectors: ["data-testid=save-order"],
        targetIds: ["app"],
        contractIds: ["checkout.save"],
        screenshotNames: ["checkout"],
        mutationOperators: [],
        coverageGapIds: []
      }],
      edges: [],
      findings: []
    },
    recommendations: []
  };
  const graph: VisualGraph = {
    schemaVersion: "visual-hive.visual-graph.v1",
    generatedAt,
    project: "fixture",
    summary: { nodes: 1, edges: 0, unresolvedReferences: 0, resolvedReferences: 0, completeChains: 0, nodeKinds: { component: 1 } },
    extractorArchitecture: { interface: "VisualHiveGraphExtractor", extractors: ["fixture"], notes: [] },
    nodes: [{
      id: "component.SaveOrderButton",
      kind: "component",
      label: "SaveOrderButton",
      sourceSpan: { filePath: "src/Checkout.tsx" },
      provenance: "static",
      confidence: 0.95,
      firstSeen: generatedAt,
      lastSeen: generatedAt,
      status: "active",
      evidenceArtifacts: [],
      metadata: { routes: ["/checkout"], selectors: ["data-testid=save-order"], contractIds: ["checkout.save"] }
    }],
    edges: [],
    unresolvedReferences: [],
    resolvedReferences: []
  };
  return { root, repoMap, graph };
}

function compilerOptions(root: string, repoMap: RepoMapReport, graph: VisualGraph): CompileVisualTaskContextOptions {
  return {
    repoRoot: root,
    generatedAt,
    taskId: "fixture.checkout-repair",
    repository: { name: "owner/fixture", repositoryId: "fixture-42", baseSha: "a".repeat(40), ref: "refs/heads/main" },
    issue: {
      source: "fixture",
      externalId: "fixture-1",
      title: "Checkout save order button disappears",
      problemStatement: "The checkout save order button disappears before the order can be submitted."
    },
    config: VisualHiveConfigSchema.parse({
      project: { name: "fixture" },
      targets: { app: { kind: "command", url: "http://127.0.0.1:4173", serve: "npm run dev" } },
      contracts: [{
        id: "checkout.save",
        description: "Checkout save order button remains visible",
        target: "app",
        selectors: { mustExist: ["data-testid=save-order"] },
        screenshots: [{ name: "checkout", route: "/checkout", viewport: "desktop" }]
      }],
      viewports: { desktop: { width: 1280, height: 720 } }
    }),
    repoMap,
    graph,
    observedCheckoutSha: "a".repeat(40),
    registeredValidationCommands: { app: "command.visual-repair-app" }
  };
}
