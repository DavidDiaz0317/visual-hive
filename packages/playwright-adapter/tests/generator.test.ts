import { constants } from "node:fs";
import { access, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  API_500_MUTATION_MARKER,
  VISUAL_REPAIR_IMAGE_COMPARISON_ALGORITHM,
  VISUAL_REPAIR_IMAGE_COMPARISON_DIAGNOSTIC_COLORS,
  VisualHiveConfigSchema
} from "@visual-hive/core";
import { buildPlaywrightConfigContent, buildSpecContent, generatePlaywrightSpec } from "../src/generator.js";
import { collectArtifacts } from "../src/artifactCollector.js";
import { waitForServerUrl } from "../src/serverManager.js";
import { comparePngSnapshot } from "../src/visualDiff.js";
import { assertNewRuntimeSidecarPath, normalizeStructuredContractResult, playwrightNodeModulesPath, resolvePlaywrightCli, runPlaywrightContracts } from "../src/runner.js";
import { PNG } from "pngjs";

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("buildSpecContent", () => {
  it("gives hidden generated specs an explicit Playwright discovery root", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-hidden-spec-"));
    tempDirs.push(tempRoot);
    const generatedDir = path.join(tempRoot, ".visual-hive", "generated");
    await mkdir(generatedDir, { recursive: true });
    const specPath = path.join(generatedDir, "visual-hive.generated.spec.ts");
    const configPath = path.join(generatedDir, "visual-hive.generated.config.cjs");
    await writeFile(specPath, 'import { test } from "@playwright/test"; test("hidden generated spec", async () => {});\n', "utf8");
    await writeFile(configPath, buildPlaywrightConfigContent(), "utf8");

    const playwrightCli = resolvePlaywrightCli(tempRoot);
    const nodeModules = playwrightNodeModulesPath(playwrightCli);
    const result = spawnSync(
      process.execPath,
      [playwrightCli, "test", ".visual-hive/generated/visual-hive.generated.spec.ts", "--config=.visual-hive/generated/visual-hive.generated.config.cjs", "--list"],
      {
        cwd: tempRoot,
        encoding: "utf8",
        env: { ...process.env, NODE_PATH: [nodeModules, process.env.NODE_PATH].filter(Boolean).join(path.delimiter) }
      }
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("hidden generated spec");
  });

  it("requires runtime sidecars to use a new ordinary destination", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-runtime-sidecar-path-"));
    tempDirs.push(tempRoot);
    const proofRoot = path.join(tempRoot, ".visual-hive", "proof");
    const transactionRoot = path.join(proofRoot, "transaction");
    await mkdir(transactionRoot, { recursive: true });
    const runtimePath = path.join(transactionRoot, "runtime.json");
    await expect(assertNewRuntimeSidecarPath(tempRoot, runtimePath)).resolves.toBeUndefined();
    await writeFile(runtimePath, '{"schemaVersion":"preseeded"}\n', "utf8");
    await expect(assertNewRuntimeSidecarPath(tempRoot, runtimePath)).rejects.toThrow(
      /destination already exists/u
    );

    const realParent = path.join(tempRoot, "real-runtime-parent");
    const linkedParent = path.join(proofRoot, "linked");
    await mkdir(realParent);
    await symlink(realParent, linkedParent, process.platform === "win32" ? "junction" : "dir");
    await expect(
      assertNewRuntimeSidecarPath(tempRoot, path.join(linkedParent, "runtime.json"))
    ).rejects.toThrow(/linked|junction/u);
  });

  it("includes expected selectors, routes, viewport usage, and mutation hook", () => {
    const config = VisualHiveConfigSchema.parse({
      project: { name: "sample", type: "react-vite", defaultBranch: "main" },
      targets: {
        localPreview: {
          kind: "url",
          url: "http://127.0.0.1:4173",
          prSafe: true,
          cost: "cheap"
        }
      },
      contracts: [
        {
          id: "dashboard-visual-stability",
          description: "Dashboard",
          target: "localPreview",
          severity: "high",
          runOn: { pullRequest: true },
          waitFor: [{ selector: "[data-testid='dashboard-page']", state: "visible", timeoutMs: 5000 }],
          steps: [
            { action: "click", selector: "[data-testid='critical-action-button']", description: "Critical action is clickable." },
            { action: "assertText", selector: ".data-status", text: "Demo metrics loaded" }
          ],
          failOnConsoleError: true,
          expectedConsoleErrors: ["Known harmless"],
          selectors: {
            mustExist: ["[data-testid='dashboard-page']"],
            mustNotExist: ["[data-testid='login-page']"],
            textMustExist: ["Demo metrics loaded"]
          },
          screenshots: [{ name: "dashboard", route: "/", viewport: "desktop" }]
        }
      ],
      viewports: { desktop: { width: 1440, height: 900 } }
    });

    const content = buildSpecContent({
      rootDir: "/tmp/sample",
      contracts: config.contracts,
      targets: config.targets,
      viewports: config.viewports,
      visual: config.visual
    });

    expect(content).toContain("[data-testid='dashboard-page']");
    expect(content).toContain("\"route\": \"/\"");
    expect(content).toContain("\"width\": 1440");
    expect(content).toContain("VISUAL_HIVE_MUTATION_OPERATOR");
    expect(content).toContain("VISUAL_HIVE_MUTATION_OPERATORS");
    expect(content).toContain("VISUAL_HIVE_MUTATION_MATRIX");
    expect(content).toContain("mutationAppliesToContract");
    expect(content).toContain("hide-critical-button");
    expect(content).toContain("route-guard-bypass");
    expect(content).toContain("hidden-error-banner");
    expect(content).toContain("broken-image");
    expect(content).toContain("removed-accessible-name");
    expect(content).toContain("theme-token-drift");
    expect(content).toContain("stale-loading-state");
    expect(content).toContain("Generated by Visual Hive");
    expect(content).toContain("Missing screenshot baseline in CI mode");
    expect(content).toContain('caret: "initial"');
    expect(content).toContain('visual.baselinePlatform === "platform" ? [process.platform] : []');
    expect(content).toContain("domcontentloaded");
    expect(content).not.toContain("networkidle");
    expect(content).toContain("visualHiveCi === \"false\" ? false");
    expect(content).toContain("if (exclusiveEvidenceWrites || forceExclusive)");
    expect(content).toMatch(/runtimeSidecarPath,[\s\S]*?"utf8",\s*true\s*\);/u);
    expect(content).toContain("applyWaits");
    expect(content).toContain("runFlowSteps");
    expect(content).toContain("executeFlowStep");
    expect(content).toContain("flowSteps");
    expect(content).toContain("await locator.waitFor({ state: \"visible\", timeout });");
    expect(content).toContain("await locator.scrollIntoViewIfNeeded({ timeout });");
    expect(content).toContain("Critical action is clickable.");
    expect(content).toContain("visibleStepValue");
    expect(content).toContain("page.on(\"pageerror\"");
    expect(content).toContain("page.on(\"response\"");
    expect(content).toContain("consoleErrors.push({ type: \"console\", message: sanitizeText");
    expect(content).toContain("pageErrors.push({ type: \"page\", message: sanitizeText");
    expect(content).toContain("url: sanitizeText(response.url())");
    expect(content).toContain("actualDiffPixelRatio");
    expect(content).toContain("pixelmatch");
    expect(content).toContain(`const visualRepairImageComparisonAlgorithm = ${JSON.stringify(VISUAL_REPAIR_IMAGE_COMPARISON_ALGORITHM)}`);
    expect(content).toContain(`const visualRepairImageComparisonDiagnosticColors = ${JSON.stringify(VISUAL_REPAIR_IMAGE_COMPARISON_DIAGNOSTIC_COLORS)}`);
    expect(content).toContain("includeAA: false");
    expect(content).toContain("diffMask: true");
    expect(content).toContain("beforeDimensions: { width: baseline.width, height: baseline.height }");
    expect(content).toContain("afterDimensions: { width: actual.width, height: actual.height }");
    expect(content).toContain("changedBoundingBox: changedBoundingBox(diffImage)");
    expect(content).toContain("Screenshot dimensions changed from ");
    expect(content).toContain("message.includes(pattern)");
    expect(content).toContain(`const api500MutationMarker = ${JSON.stringify(API_500_MUTATION_MARKER)}`);
    expect(content.match(new RegExp(API_500_MUTATION_MARKER, "g"))).toHaveLength(1);
    expect(content).toContain("data-visual-hive-api-500-mutation");
    expect(content).toContain("const routeMutationTracker = await applyRouteMutation(page, activeMutationOperator, contract.timeoutMs)");
    expect(content).toContain("await finalizeApi500MutationObservation(page, contract, activeMutationOperator, routeMutationTracker, selectorAssertions)");
    expect(content).toContain('sentinel.style.setProperty("display", "none", "important")');
  });

  it("kills api-500 only after a real interception and keeps the hidden sentinel out of screenshots", async () => {
    const runFixture = async (options: {
      requestApi: boolean;
      flowRequest?: boolean;
      markerAssertion: boolean;
      screenshotCount?: number;
      mutation?: boolean;
      rootDir?: string;
      useDefaultTimeout?: boolean;
    }) => {
      const screenshotCount = options.screenshotCount ?? 0;
      const server = createServer((request, response) => {
        if (request.url === "/api/data") {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify({ ok: true }));
          return;
        }
        response.writeHead(200, { "content-type": "text/html" });
        response.end(`<!doctype html><html><body><main id="root">stable dashboard</main>${options.flowRequest ? '<button id="load-api">Load API</button><script>document.querySelector("#load-api").addEventListener("click", () => { void fetch("/api/data"); });</script>' : ""}${
          options.requestApi ? '<script>setTimeout(() => { void fetch("/api/data"); }, 150);</script>' : ""
        }</body></html>`);
      });
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("fixture server did not bind a TCP port");
      const rootDir = options.rootDir ?? await mkdtemp(path.join(os.tmpdir(), "visual-hive-api-500-runtime-"));
      if (!options.rootDir) tempDirs.push(rootDir);
      try {
        const config = VisualHiveConfigSchema.parse({
          project: { name: "api-500-runtime" },
          targets: { local: { kind: "url", url: `http://127.0.0.1:${address.port}`, prSafe: true } },
          contracts: [{
            id: "api-contract",
            description: "API-backed stable dashboard",
            target: "local",
            ...(options.useDefaultTimeout ? {} : { timeoutMs: 3000 }),
            selectors: {
              mustExist: ["#root"],
              textMustNotExist: options.markerAssertion ? [API_500_MUTATION_MARKER] : []
            },
            steps: options.flowRequest ? [{ action: "click", selector: "#load-api", description: "Trigger the API request." }] : [],
            screenshots: Array.from({ length: screenshotCount }, (_, index) => ({ name: `dashboard-${index + 1}`, route: "/", viewport: "desktop", fullPage: false }))
          }],
          viewports: { desktop: { width: 320, height: 200 } }
        });
        const plan = {
          schemaVersion: 1 as const,
          project: "api-500-runtime",
          mode: "mutation" as const,
          generatedAt: "2026-07-12T00:00:00.000Z",
          changedFiles: [],
          effectiveChangedFiles: [],
          ignoredChangedFiles: [],
          targets: [{ id: "local", kind: "url", url: `http://127.0.0.1:${address.port}`, prSafe: true, cost: "medium" as const }],
          items: [{
            contractId: "api-contract",
            targetId: "local",
            targetUrl: `http://127.0.0.1:${address.port}`,
            severity: "medium" as const,
            cost: "medium" as const,
            reasons: ["test"],
            screenshots: Array.from({ length: screenshotCount }, (_, index) => `dashboard-${index + 1}:/:desktop`)
          }],
          excluded: [],
          mutation: { enabled: true, operators: ["api-500" as const], minScore: 0.8, reasons: ["test"] },
          providerPolicy: []
        };
        return await runPlaywrightContracts({
          config,
          plan,
          rootDir,
          ci: false,
          mutationOperators: options.mutation ? ["api-500"] : undefined,
          mutationMatrix: options.mutation ? { "api-500": ["api-contract"] } : undefined,
          runTargetCommands: false,
          skipInstall: true,
          skipBuild: true
        });
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    };

    const intercepted = await runFixture({ requestApi: true, markerAssertion: true, mutation: true });
    expect(intercepted.exitCode).toBe(1);
    expect(intercepted.report.results[0]?.status).toBe("failed");
    const interceptedAssertions = intercepted.report.results[0]?.selectorAssertions;
    if (!interceptedAssertions) throw new Error(`missing structured api-500 assertions: ${JSON.stringify(intercepted.report, null, 2)}`);
    expect(interceptedAssertions).toContainEqual(
      expect.objectContaining({ kind: "textMustNotExist", value: API_500_MUTATION_MARKER, status: "failed" })
    );

    const noRequest = await runFixture({ requestApi: false, markerAssertion: true, mutation: true });
    expect(noRequest.exitCode).toBe(0);
    expect(noRequest.report.results[0]?.status).toBe("passed");

    const noRequestManyScreenshots = await runFixture({
      requestApi: false,
      markerAssertion: true,
      screenshotCount: 6,
      mutation: true,
      useDefaultTimeout: true
    });
    expect(noRequestManyScreenshots.exitCode).toBe(0);
    expect(noRequestManyScreenshots.report.results[0]?.status).not.toBe("failed");

    const flowTriggered = await runFixture({ requestApi: false, flowRequest: true, markerAssertion: true, mutation: true });
    expect(flowTriggered.exitCode).toBe(1);
    expect(flowTriggered.report.results[0]?.selectorAssertions).toContainEqual(
      expect.objectContaining({ kind: "textMustNotExist", value: API_500_MUTATION_MARKER, status: "failed" })
    );

    const screenshotRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-api-500-screenshot-"));
    tempDirs.push(screenshotRoot);
    const baseline = await runFixture({ requestApi: true, markerAssertion: false, screenshotCount: 1, mutation: false, rootDir: screenshotRoot });
    expect(baseline.exitCode).toBe(0);
    expect(baseline.report.results[0]?.screenshotAssertions?.[0]?.status).toBe("created");
    const repeated = await runFixture({ requestApi: true, markerAssertion: false, screenshotCount: 1, mutation: false, rootDir: screenshotRoot });
    expect(repeated.exitCode).toBe(0);
    expect(repeated.report.results[0]?.screenshotAssertions?.[0]).toMatchObject({ status: "passed", actualDiffPixelRatio: 0 });
    const mutated = await runFixture({ requestApi: true, markerAssertion: false, screenshotCount: 1, mutation: true, rootDir: screenshotRoot });
    expect(mutated.exitCode).toBe(0);
    expect(mutated.report.results[0]?.screenshotAssertions?.[0]).toMatchObject({ status: "passed", actualDiffPixelRatio: 0 });
  }, 60_000);

  it("collects later screenshot evidence after an earlier visual assertion fails", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "visual-hive-complete-screenshot-run-"));
    tempDirs.push(rootDir);
    let firstRouteText = "stable first state";
    let firstRouteColor = "white";
    const server = createServer((request, response) => {
      const body = request.url === "/first" ? firstRouteText : "stable second state";
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      const color = request.url === "/first" ? firstRouteColor : "white";
      response.end(`<!doctype html><html><body><main style="width:300px;height:160px;background:${color}">${body}</main></body></html>`);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("screenshot fixture server did not bind a TCP port");
    const url = `http://127.0.0.1:${address.port}`;
    try {
      const config = VisualHiveConfigSchema.parse({
        project: { name: "complete-screenshot-run" },
        targets: { local: { kind: "url", url, prSafe: true } },
        contracts: [{
          id: "two-screenshots",
          description: "Both independent screenshots are always collected.",
          target: "local",
          screenshots: [
            { name: "first", route: "/first", viewport: "desktop", fullPage: false },
            { name: "second", route: "/second", viewport: "desktop", fullPage: false }
          ]
        }],
        viewports: { desktop: { width: 320, height: 200 } }
      });
      const plan = {
        schemaVersion: 1 as const,
        project: config.project.name,
        mode: "full" as const,
        generatedAt: "2026-07-15T12:00:00.000Z",
        changedFiles: [],
        effectiveChangedFiles: [],
        ignoredChangedFiles: [],
        targets: [{ id: "local", kind: "url", url, prSafe: true, cost: "medium" as const }],
        items: [{
          contractId: "two-screenshots",
          targetId: "local",
          targetUrl: url,
          severity: "medium" as const,
          cost: "medium" as const,
          reasons: ["complete evidence fixture"],
          screenshots: ["first:/first:desktop", "second:/second:desktop"]
        }],
        excluded: [],
        mutation: { enabled: false, operators: [], minScore: 0.7, reasons: [] },
        providerPolicy: []
      };

      const baseline = await runPlaywrightContracts({ config, plan, rootDir, ci: false, runTargetCommands: false });
      expect(baseline.report.results[0]?.screenshotAssertions).toHaveLength(2);
      expect(baseline.report.results[0]?.screenshotAssertions?.map((assertion) => assertion.status)).toEqual(["created", "created"]);

      firstRouteText = "changed first state";
      firstRouteColor = "black";
      const validation = await runPlaywrightContracts({ config, plan, rootDir, ci: true, runTargetCommands: false });
      expect(validation.exitCode).toBe(1);
      expect(validation.report.results[0]?.screenshotAssertions).toHaveLength(2);
      expect(validation.report.results[0]?.screenshotAssertions?.map((assertion) => assertion.status)).toEqual(["failed", "passed"]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 60_000);

  it("includes generated spec path in collected artifacts", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-artifacts-"));
    tempDirs.push(tempRoot);
    const generatedDir = path.join(tempRoot, ".visual-hive", "generated");
    await mkdir(generatedDir, { recursive: true });
    await writeFile(path.join(generatedDir, "visual-hive.generated.spec.ts"), "// generated", "utf8");

    const artifacts = await collectArtifacts(tempRoot);

    expect(artifacts.some((artifact) => artifact.endsWith("visual-hive.generated.spec.ts"))).toBe(true);
  });

  it("rejects linked artifact trees instead of traversing outside the repository", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-artifact-link-"));
    const outside = await mkdtemp(path.join(os.tmpdir(), "visual-hive-artifact-outside-"));
    tempDirs.push(tempRoot, outside);
    const artifactDir = path.join(tempRoot, ".visual-hive", "artifacts");
    await mkdir(artifactDir, { recursive: true });
    await writeFile(path.join(outside, "forged.json"), "{}", "utf8");
    await symlink(outside, path.join(artifactDir, "linked"), process.platform === "win32" ? "junction" : "dir");

    await expect(collectArtifacts(tempRoot)).rejects.toThrow(/symbolic link|ordinary directory/u);
  });

  it("keeps mutation batch contract artifacts scoped to the operator result", () => {
    const structured = {
      contractId: "dashboard",
      mutationOperator: "force-login-on-demo",
      targetId: "localPreview",
      status: "failed" as const,
      durationMs: 100,
      errors: ["token=secret-value"],
      artifacts: [
        ".visual-hive/artifacts/results/force-login-on-demo__dashboard.json",
        ".visual-hive/artifacts/screenshots/force-login-on-demo__dashboard.png"
      ]
    };
    const runArtifacts = [
      ".visual-hive/generated/visual-hive.generated.spec.ts",
      ".visual-hive/artifacts/results/other-operator__dashboard.json",
      ".visual-hive/artifacts/screenshots/other-operator__dashboard.png"
    ];

    const mutationResult = normalizeStructuredContractResult(structured, runArtifacts, "visual-hive mutate", "contract-only");
    const deterministicResult = normalizeStructuredContractResult(structured, runArtifacts, "visual-hive run --ci", "include-run-artifacts");

    expect(mutationResult.artifacts).toEqual(structured.artifacts);
    expect(mutationResult.artifacts).not.toContain(".visual-hive/artifacts/results/other-operator__dashboard.json");
    expect(mutationResult.reproductionCommand).toBe("visual-hive mutate");
    expect(mutationResult.errors).toEqual(["token=[REDACTED]"]);
    expect(deterministicResult.artifacts).toContain(".visual-hive/generated/visual-hive.generated.spec.ts");
  });

  it("ignores a target-controlled Playwright CLI and uses the packaged verifier", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-target-playwright-"));
    tempDirs.push(tempRoot);
    const packageDir = path.join(tempRoot, "node_modules", "@playwright", "test");
    await mkdir(packageDir, { recursive: true });
    await writeFile(
      path.join(packageDir, "package.json"),
      JSON.stringify({
        name: "@playwright/test",
        version: "99.0.0-target-fixture",
        exports: { "./cli": "./cli.js" }
      }),
      "utf8"
    );
    await writeFile(path.join(packageDir, "cli.js"), "#!/usr/bin/env node\n", "utf8");

    const cli = resolvePlaywrightCli(tempRoot);
    expect(cli).not.toBe(path.join(packageDir, "cli.js"));
    expect(cli).toBe(resolvePlaywrightCli(process.cwd()));
    expect(playwrightNodeModulesPath(cli)).not.toBe(path.join(tempRoot, "node_modules"));
  });

  it("serializes resolved deploy preview URLs into generated specs", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-deploy-preview-spec-"));
    tempDirs.push(tempRoot);
    const config = VisualHiveConfigSchema.parse({
      project: { name: "preview-spec" },
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
          runOn: { pullRequest: true },
          screenshots: [{ name: "home", route: "/", viewport: "desktop" }]
        }
      ]
    });

    const generated = await generatePlaywrightSpec({
      rootDir: tempRoot,
      config,
      plan: {
        schemaVersion: 1,
        project: "preview-spec",
        mode: "pr",
        generatedAt: "2026-06-16T00:00:00.000Z",
        changedFiles: [],
        effectiveChangedFiles: [],
        ignoredChangedFiles: [],
        targets: [{ id: "preview", kind: "deployPreview", url: "https://preview.example.com", prSafe: true, cost: "cheap" }],
        items: [
          {
            contractId: "preview-dashboard",
            targetId: "preview",
            targetUrl: "https://preview.example.com",
            severity: "medium",
            cost: "cheap",
            reasons: ["runOn.pullRequest=true"],
            screenshots: ["home:/:desktop"]
          }
        ],
        excluded: [],
        mutation: { enabled: false, operators: [], minScore: 0.7, reasons: [] },
        providerPolicy: []
      }
    });

    expect(generated.content).toContain("\"kind\": \"deployPreview\"");
    expect(generated.content).toContain("\"url\": \"https://preview.example.com\"");
    await expect(access(generated.path, constants.F_OK)).resolves.toBeUndefined();
  });

  it("serializes storybook targets and component story routes into generated specs", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-storybook-spec-"));
    tempDirs.push(tempRoot);
    const config = VisualHiveConfigSchema.parse({
      project: { name: "storybook-spec", setupProfile: "component-storybook" },
      targets: {
        componentLibrary: {
          kind: "storybook",
          serve: "npm run storybook -- --host 127.0.0.1 --port 6006",
          url: "http://127.0.0.1:6006",
          stories: ["src/**/*.stories.tsx"],
          components: ["src/components/**"]
        }
      },
      contracts: [
        {
          id: "storybook-button",
          description: "Button story",
          target: "componentLibrary",
          runOn: { pullRequest: true },
          screenshots: [{ name: "button-primary", route: "/?path=/story/button--primary", viewport: "desktop" }]
        }
      ]
    });

    const generated = await generatePlaywrightSpec({
      rootDir: tempRoot,
      config,
      plan: {
        schemaVersion: 1,
        project: "storybook-spec",
        mode: "pr",
        generatedAt: "2026-06-16T00:00:00.000Z",
        changedFiles: [],
        effectiveChangedFiles: [],
        ignoredChangedFiles: [],
        targets: [{ id: "componentLibrary", kind: "storybook", url: "http://127.0.0.1:6006", prSafe: true, cost: "cheap" }],
        items: [
          {
            contractId: "storybook-button",
            targetId: "componentLibrary",
            targetUrl: "http://127.0.0.1:6006",
            severity: "medium",
            cost: "cheap",
            reasons: ["runOn.pullRequest=true"],
            screenshots: ["button-primary:/?path=/story/button--primary:desktop"]
          }
        ],
        excluded: [],
        mutation: { enabled: false, operators: [], minScore: 0.7, reasons: [] },
        providerPolicy: []
      }
    });

    expect(generated.content).toContain("\"kind\": \"storybook\"");
    expect(generated.content).toContain("\"url\": \"http://127.0.0.1:6006\"");
    expect(generated.content).toContain("\"/?path=/story/button--primary\"");
    await expect(access(generated.path, constants.F_OK)).resolves.toBeUndefined();
  });

  it("creates a missing baseline locally and serializes diff metadata", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-visual-diff-"));
    tempDirs.push(tempRoot);
    const baselinePath = path.join(tempRoot, ".visual-hive", "snapshots", "baseline.png");
    const actualPath = path.join(tempRoot, ".visual-hive", "artifacts", "screenshots", "actual.png");
    const diffPath = path.join(tempRoot, ".visual-hive", "artifacts", "screenshots", "diff.png");
    const visual = VisualHiveConfigSchema.parse({
      project: { name: "sample" },
      targets: { local: { kind: "url", url: "http://127.0.0.1:4173" } },
      contracts: [{ id: "c", description: "c", target: "local" }]
    }).visual;

    const result = await comparePngSnapshot({
      baselinePath,
      actualPath,
      diffPath,
      actualBuffer: pngBuffer([255, 0, 0, 255]),
      ci: false,
      visual,
      contractId: "c",
      name: "home",
      route: "/",
      viewport: "desktop"
    });

    expect(result.status).toBe("created");
    expect(result.contractId).toBe("c");
    expect(result.screenshotName).toBe("home");
    expect(result.actualDiffPixelRatio).toBe(0);
    expect(result.actualDiffPixels).toBe(0);
    await expect(access(baselinePath, constants.F_OK)).resolves.toBeUndefined();
    await expect(access(actualPath, constants.F_OK)).resolves.toBeUndefined();
  });

  it("fails missing baselines in CI mode", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-missing-baseline-"));
    tempDirs.push(tempRoot);
    const visual = VisualHiveConfigSchema.parse({
      project: { name: "sample" },
      targets: { local: { kind: "url", url: "http://127.0.0.1:4173" } },
      contracts: [{ id: "c", description: "c", target: "local" }]
    }).visual;

    const result = await comparePngSnapshot({
      baselinePath: path.join(tempRoot, "baseline.png"),
      actualPath: path.join(tempRoot, "actual.png"),
      diffPath: path.join(tempRoot, "diff.png"),
      actualBuffer: pngBuffer([255, 0, 0, 255]),
      ci: true,
      visual,
      name: "home",
      route: "/",
      viewport: "desktop"
    });

    expect(result.status).toBe("missing_baseline");
    expect(result.message).toContain("Missing screenshot baseline");
    expect(result.actualDiffPixelRatio).toBe(1);
    expect(result.actualDiffPixels).toBe(1);
  });

  it("passes when the actual screenshot matches the baseline", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-identical-baseline-"));
    tempDirs.push(tempRoot);
    const baselinePath = path.join(tempRoot, "baseline.png");
    const image = pngBuffer([255, 0, 0, 255]);
    await writeFile(baselinePath, image);
    const visual = VisualHiveConfigSchema.parse({
      project: { name: "sample" },
      targets: { local: { kind: "url", url: "http://127.0.0.1:4173" } },
      contracts: [{ id: "c", description: "c", target: "local" }]
    }).visual;

    const result = await comparePngSnapshot({
      baselinePath,
      actualPath: path.join(tempRoot, "actual.png"),
      diffPath: path.join(tempRoot, "diff.png"),
      actualBuffer: image,
      ci: true,
      visual,
      contractId: "c",
      name: "home",
      route: "/",
      viewport: "desktop"
    });

    expect(result.status).toBe("passed");
    expect(result.actualDiffPixels).toBe(0);
    expect(result.actualDiffPixelRatio).toBe(0);
  });

  it("fails when visual diff exceeds tolerance and writes diff metadata", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-diff-baseline-"));
    tempDirs.push(tempRoot);
    const baselinePath = path.join(tempRoot, "baseline.png");
    const diffPath = path.join(tempRoot, "diff.png");
    await writeFile(baselinePath, pngBuffer([0, 0, 255, 255]));
    const visual = {
      maxDiffPixelRatio: 0,
      updateSnapshots: false,
      failOnMissingBaselineInCI: true,
      baselinePlatform: "shared" as const,
      snapshotDir: ".visual-hive/snapshots",
      artifactDir: ".visual-hive/artifacts"
    };

    const result = await comparePngSnapshot({
      baselinePath,
      actualPath: path.join(tempRoot, "actual.png"),
      diffPath,
      actualBuffer: pngBuffer([255, 0, 0, 255]),
      ci: true,
      visual,
      contractId: "c",
      name: "home",
      route: "/",
      viewport: "desktop"
    });

    expect(result.status).toBe("failed");
    expect(result.diffPath).toBe(diffPath);
    expect(result.actualDiffPixels).toBeGreaterThan(0);
    await expect(access(diffPath, constants.F_OK)).resolves.toBeUndefined();
  });

  it("updates snapshots when visual.updateSnapshots is enabled", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-update-baseline-"));
    tempDirs.push(tempRoot);
    const baselinePath = path.join(tempRoot, "baseline.png");
    await writeFile(baselinePath, pngBuffer([0, 0, 255, 255]));
    const visual = {
      maxDiffPixelRatio: 0.01,
      updateSnapshots: true,
      failOnMissingBaselineInCI: true,
      baselinePlatform: "shared" as const,
      snapshotDir: ".visual-hive/snapshots",
      artifactDir: ".visual-hive/artifacts"
    };

    const result = await comparePngSnapshot({
      baselinePath,
      actualPath: path.join(tempRoot, "actual.png"),
      diffPath: path.join(tempRoot, "diff.png"),
      actualBuffer: pngBuffer([255, 0, 0, 255]),
      ci: true,
      visual,
      contractId: "c",
      name: "home",
      route: "/",
      viewport: "desktop"
    });

    expect(result.status).toBe("passed");
    expect(result.totalPixels).toBe(1);
  });

  it("returns an excellent target startup timeout error", async () => {
    await expect(
      waitForServerUrl({
        url: "http://127.0.0.1:9",
        timeoutMs: 1,
        command: "npm run preview -- --port 9",
        logTail: () => "secret=abc\nserver failed"
      })
    ).rejects.toThrow(/Target server failed to start/);
    await expect(
      waitForServerUrl({
        url: "http://127.0.0.1:9?token=abc",
        timeoutMs: 1,
        command: "npm run preview -- --port 9",
        logTail: () => "secret=abc"
      })
    ).rejects.toThrow(/token=\[REDACTED\]/);
  });

  it("rejects readiness from an unrelated listener after the managed process exits", async () => {
    const server = createServer((_request, response) => response.end("unrelated"));
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Listener did not expose a test port.");
      await expect(waitForServerUrl({
        url: `http://127.0.0.1:${address.port}`,
        timeoutMs: 2_000,
        command: "node exited-server.js",
        getClosed: () => ({ code: 1, signal: null })
      })).rejects.toThrow("managed process exited before readiness");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("returns a failed report with sanitized lifecycle evidence when a target cannot start", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-startup-report-"));
    tempDirs.push(tempRoot);
    const config = VisualHiveConfigSchema.parse({
      project: { name: "startup-report" },
      targets: {
        local: {
          kind: "command",
          serve: "node -e \"console.error('secret=abc'); process.exit(1)\"",
          url: "http://127.0.0.1:9?token=abc",
          prSafe: true
        }
      },
      contracts: [
        {
          id: "home",
          description: "Home",
          target: "local",
          runOn: { pullRequest: true },
          selectors: { mustExist: ["main"] }
        }
      ]
    });
    const plan = {
      schemaVersion: 1 as const,
      project: "startup-report",
      mode: "pr" as const,
      generatedAt: "2026-01-01T00:00:00.000Z",
      changedFiles: [],
      effectiveChangedFiles: [],
      ignoredChangedFiles: [],
      targets: [{ id: "local", kind: "command", url: "http://127.0.0.1:9?token=abc", prSafe: true, cost: "medium" }],
      items: [
        {
          contractId: "home",
          targetId: "local",
          targetUrl: "http://127.0.0.1:9?token=abc",
          severity: "medium" as const,
          cost: "medium" as const,
          reasons: ["test"],
          screenshots: []
        }
      ],
      excluded: [],
      mutation: { enabled: false, operators: [], minScore: 0.7, reasons: [] }
    };

    const { report, exitCode } = await runPlaywrightContracts({ config, plan, rootDir: tempRoot, skipInstall: true, skipBuild: true });

    expect(exitCode).toBe(1);
    expect(report.status).toBe("failed");
    expect(report.outputResource).toMatchObject({
      artifactPath: ".visual-hive/report.json",
      evidenceResourceId: "latest-report",
      evidenceResourceUri: "visual-hive://latest-report",
      evidenceReadToolName: "visual_hive_read_latest_report"
    });
    expect(report.verdictSummary?.visualHiveVerdict).toBe("blocked");
    expect(report.verdictSummary?.blockedBecause).toContain("playwright.deterministic_run");
    expect(report.verdictSummary?.blockedBecause).toContain("visual_hive.target_lifecycle_failure");
    expect(report.verdictContributions?.some((contribution) => contribution.key === "playwright.contract_result.home" && contribution.status === "blocked" && contribution.gating)).toBe(true);
    expect(report.generatedSpecPath).toBe(".visual-hive/generated/visual-hive.generated.spec.ts");
    expect(report.targetLifecycle.some((event) => event.phase === "serve" && event.status === "failed")).toBe(true);
    expect(report.providerResults?.find((provider) => provider.providerId === "playwright")?.status).toBe("failed");
    expect(report.results[0]?.errors.join("\n")).toContain("Target server failed to start");
    expect(JSON.stringify(report)).toContain("token=[REDACTED]");
    expect(JSON.stringify(report)).not.toContain("secret=abc");
  }, 15_000);

  it("records lifecycle evidence when a storybook target cannot start", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-storybook-startup-"));
    tempDirs.push(tempRoot);
    const config = VisualHiveConfigSchema.parse({
      project: { name: "storybook-startup", setupProfile: "component-storybook" },
      targets: {
        componentLibrary: {
          kind: "storybook",
          serve: "node -e \"process.exit(1)\"",
          url: "http://127.0.0.1:9",
          stories: ["src/**/*.stories.tsx"],
          components: ["src/components/**"],
          prSafe: true
        }
      },
      contracts: [
        {
          id: "storybook-home",
          description: "Storybook home",
          target: "componentLibrary",
          runOn: { pullRequest: true }
        }
      ]
    });
    const plan = {
      schemaVersion: 1 as const,
      project: "storybook-startup",
      mode: "pr" as const,
      generatedAt: "2026-01-01T00:00:00.000Z",
      changedFiles: [],
      effectiveChangedFiles: [],
      ignoredChangedFiles: [],
      targets: [{ id: "componentLibrary", kind: "storybook", url: "http://127.0.0.1:9", prSafe: true, cost: "cheap" as const }],
      items: [
        {
          contractId: "storybook-home",
          targetId: "componentLibrary",
          targetUrl: "http://127.0.0.1:9",
          severity: "medium" as const,
          cost: "cheap" as const,
          reasons: ["test"],
          screenshots: []
        }
      ],
      excluded: [],
      mutation: { enabled: false, operators: [], minScore: 0.7, reasons: [] },
      providerPolicy: []
    };

    const { report, exitCode } = await runPlaywrightContracts({ config, plan, rootDir: tempRoot, skipInstall: true, skipBuild: true });

    expect(exitCode).toBe(1);
    expect(report.status).toBe("failed");
    expect(report.verdictSummary?.visualHiveVerdict).toBe("blocked");
    expect(report.verdictContributions?.map((contribution) => contribution.key)).toContain("playwright.contract_result.storybook-home");
    expect(report.selectedTargets[0]?.kind).toBe("storybook");
    expect(report.targetLifecycle.some((event) => event.targetId === "componentLibrary" && event.serviceName === "storybook" && event.status === "failed")).toBe(true);
  }, 15_000);

  it("runs shared repository installs before target builds regardless of plan order", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-target-phases-"));
    tempDirs.push(tempRoot);
    const config = VisualHiveConfigSchema.parse({
      project: { name: "target-phases" },
      targets: {
        componentLibrary: {
          kind: "storybook",
          build: "node -e \"require('fs').accessSync('dependencies.ready')\"",
          serve: "node -e \"process.exit(1)\"",
          url: "http://127.0.0.1:9",
          stories: ["src/**/*.stories.tsx"],
          components: ["src/**"],
          prSafe: true
        },
        localPreview: {
          kind: "command",
          install: "node -e \"require('fs').writeFileSync('dependencies.ready', 'ready')\"",
          serve: "node -e \"process.exit(1)\"",
          url: "http://127.0.0.1:10",
          prSafe: true
        }
      },
      contracts: [
        { id: "component", description: "Component", target: "componentLibrary", runOn: { pullRequest: true } },
        { id: "local", description: "Local", target: "localPreview", runOn: { pullRequest: true } }
      ]
    });
    const plan = {
      schemaVersion: 1 as const,
      project: "target-phases",
      mode: "pr" as const,
      generatedAt: "2026-01-01T00:00:00.000Z",
      changedFiles: [],
      effectiveChangedFiles: [],
      ignoredChangedFiles: [],
      targets: [
        { id: "componentLibrary", kind: "storybook", url: "http://127.0.0.1:9", prSafe: true, cost: "cheap" as const },
        { id: "localPreview", kind: "command", url: "http://127.0.0.1:10", prSafe: true, cost: "cheap" as const }
      ],
      items: [
        { contractId: "component", targetId: "componentLibrary", targetUrl: "http://127.0.0.1:9", severity: "medium" as const, cost: "cheap" as const, reasons: ["test"], screenshots: [] },
        { contractId: "local", targetId: "localPreview", targetUrl: "http://127.0.0.1:10", severity: "medium" as const, cost: "cheap" as const, reasons: ["test"], screenshots: [] }
      ],
      excluded: [],
      mutation: { enabled: false, operators: [], minScore: 0.7, reasons: [] },
      providerPolicy: []
    };

    const { report } = await runPlaywrightContracts({ config, plan, rootDir: tempRoot });

    const installIndex = report.targetLifecycle.findIndex((event) => event.targetId === "localPreview" && event.phase === "install" && event.status === "passed");
    const buildIndex = report.targetLifecycle.findIndex((event) => event.targetId === "componentLibrary" && event.phase === "build" && event.status === "passed");
    expect(installIndex).toBeGreaterThanOrEqual(0);
    expect(buildIndex).toBeGreaterThan(installIndex);
  }, 15_000);

  it("bounds lifecycle process duration and captured output", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "visual-hive-process-bounds-"));
    tempDirs.push(rootDir);
    const baseConfig = {
      project: { name: "process-bounds" },
      contracts: [{ id: "home", description: "Home", target: "app", runOn: { pullRequest: true } }]
    };
    const plan = {
      schemaVersion: 1 as const,
      project: "process-bounds",
      mode: "pr" as const,
      generatedAt: "2026-01-01T00:00:00.000Z",
      changedFiles: [], effectiveChangedFiles: [], ignoredChangedFiles: [],
      targets: [{ id: "app", kind: "command", url: "http://127.0.0.1:9", prSafe: true, cost: "cheap" as const }],
      items: [{ contractId: "home", targetId: "app", targetUrl: "http://127.0.0.1:9", severity: "medium" as const, cost: "cheap" as const, reasons: ["test"], screenshots: [] }],
      excluded: [], mutation: { enabled: false, operators: [], minScore: 0.7, reasons: [] }, providerPolicy: []
    };
    const timeoutConfig = VisualHiveConfigSchema.parse({
      ...baseConfig,
      targets: { app: { kind: "command", install: "node -e \"setInterval(() => {}, 1000)\"", serve: "node -e \"process.exit(1)\"", url: "http://127.0.0.1:9", prSafe: true } }
    });
    const started = Date.now();
    const timeout = await runPlaywrightContracts({ config: timeoutConfig, plan, rootDir, processTimeoutMs: 200, maxProcessOutputBytes: 1024 });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(timeout.report.targetLifecycle.some((event) => event.phase === "install" && event.status === "failed" && event.message?.includes("timed out"))).toBe(true);

    const outputConfig = VisualHiveConfigSchema.parse({
      ...baseConfig,
      targets: { app: { kind: "command", install: "node -e \"process.stdout.write('x'.repeat(8192))\"", serve: "node -e \"process.exit(1)\"", url: "http://127.0.0.1:9", prSafe: true } }
    });
    const output = await runPlaywrightContracts({ config: outputConfig, plan, rootDir, processTimeoutMs: 5_000, maxProcessOutputBytes: 1024 });
    expect(output.report.targetLifecycle.some((event) => event.phase === "install" && event.status === "failed" && event.message?.includes("output exceeded"))).toBe(true);

    const deadlineConfig = VisualHiveConfigSchema.parse({
      ...baseConfig,
      targets: { app: { kind: "command", serve: "node -e \"setInterval(() => {}, 1000)\"", url: "http://127.0.0.1:9", prSafe: true } }
    });
    const deadlineStarted = Date.now();
    const deadline = await runPlaywrightContracts({
      config: deadlineConfig,
      plan,
      rootDir,
      skipInstall: true,
      skipBuild: true,
      processTimeoutMs: 5_000,
      maxProcessOutputBytes: 1024,
      deadlineAtMs: Date.now() + 300
    });
    expect(Date.now() - deadlineStarted).toBeLessThan(5_000);
    expect(deadline.report.targetLifecycle.some((event) => event.phase === "serve" && event.status === "failed" && /deadline|timed out/u.test(event.message ?? ""))).toBe(true);
  }, 15_000);

  it("regenerates a partial-startup plan into the exact isolated spec that is executed", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "visual-hive-partial-target-"));
    tempDirs.push(rootDir);
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<!doctype html><main>healthy</main>");
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Fixture server has no address.");
      const healthyUrl = `http://127.0.0.1:${address.port}`;
      const failedUrl = "http://127.0.0.1:9";
      const config = VisualHiveConfigSchema.parse({
        project: { name: "partial-target" },
        targets: {
          failed: { kind: "command", serve: "node -e \"process.exit(1)\"", url: failedUrl, prSafe: true },
          healthy: { kind: "url", url: healthyUrl, prSafe: true }
        },
        contracts: [
          { id: "failed-contract", description: "Failed target", target: "failed", runOn: { pullRequest: true }, selectors: { mustExist: ["main"] } },
          { id: "healthy-contract", description: "Healthy target", target: "healthy", runOn: { pullRequest: true }, selectors: { mustExist: ["main"] } }
        ]
      });
      const plan = {
        schemaVersion: 1 as const, project: "partial-target", mode: "pr" as const, generatedAt: "2026-01-01T00:00:00.000Z",
        changedFiles: [], effectiveChangedFiles: [], ignoredChangedFiles: [],
        targets: [
          { id: "failed", kind: "command", url: failedUrl, prSafe: true, cost: "cheap" as const },
          { id: "healthy", kind: "url", url: healthyUrl, prSafe: true, cost: "cheap" as const }
        ],
        items: [
          { contractId: "failed-contract", targetId: "failed", targetUrl: failedUrl, severity: "medium" as const, cost: "cheap" as const, reasons: ["test"], screenshots: [] },
          { contractId: "healthy-contract", targetId: "healthy", targetUrl: healthyUrl, severity: "medium" as const, cost: "cheap" as const, reasons: ["test"], screenshots: [] }
        ],
        excluded: [], mutation: { enabled: false, operators: [], minScore: 0.7, reasons: [] }, providerPolicy: []
      };
      const generatedOutputDir = path.join(rootDir, ".visual-hive", "isolated");
      const result = await runPlaywrightContracts({ config, plan, rootDir, generatedOutputDir, skipInstall: true, skipBuild: true });
      const generated = await readFile(path.join(generatedOutputDir, "visual-hive.generated.spec.ts"), "utf8");
      expect(generated).toContain("healthy-contract");
      expect(generated).not.toContain("failed-contract");
      const healthyResult = result.report.results.find((item) => item.contractId === "healthy-contract");
      expect(healthyResult?.status, JSON.stringify(healthyResult, null, 2)).toBe("passed");
      expect(result.report.results.find((item) => item.contractId === "failed-contract")?.status).toBe("failed");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 30_000);
});

function pngBuffer(rgba: [number, number, number, number]): Buffer {
  const image = new PNG({ width: 1, height: 1 });
  image.data[0] = rgba[0];
  image.data[1] = rgba[1];
  image.data[2] = rgba[2];
  image.data[3] = rgba[3];
  return PNG.sync.write(image);
}
