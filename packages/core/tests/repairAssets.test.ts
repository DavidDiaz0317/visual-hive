import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildVisualHiveTaskContext,
  buildVisualRunContext,
  canonicalSha256,
  computeVisualRepositoryFingerprint,
  computeVisualValidationProfileDigest,
  computeVisualValidationPolicyDigest,
  inspectDeclaredVisualTaskAsset,
  loadVisualRunEvidenceAsset,
  loadVisualTaskAsset,
  sha256Bytes,
  sha256Utf8,
  type VisualHiveTaskContext,
  type VisualRunContext,
  type VisualTaskAsset
} from "../src/index.js";

const temporaryRoots: string[] = [];
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZK4sAAAAASUVORK5CYII=", "base64");
const commit = (character: string): string => character.repeat(40);
const digest = (character: string): string => character.repeat(64);

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("verified Visual Hive task assets", () => {
  it("loads real image bytes only through bound task and asset identity", async () => {
    const root = await makeRoot();
    await writeAsset(root, "images/reference.png", png);
    const asset = await inspect(root, "images/reference.png", "image/png", "asset.reference");
    const context = taskContext(asset);

    const loaded = await loadVisualTaskAsset({
      evidenceRoot: root,
      taskContext: context,
      taskId: context.taskId,
      repository: context.repository.name,
      commitSha: context.repository.baseSha,
      assetId: asset.assetId
    });

    expect(loaded.data.equals(png)).toBe(true);
    expect(loaded.asset).toEqual(asset);
    expect(loaded.contextDigest).toBe(context.contextDigest);
  });

  it("rejects stale or cross-repository identity before reading", async () => {
    const root = await makeRoot();
    await writeAsset(root, "images/reference.png", png);
    const asset = await inspect(root, "images/reference.png", "image/png", "asset.reference");
    const context = taskContext(asset);
    const common = { evidenceRoot: root, taskContext: context, taskId: context.taskId, repository: context.repository.name, commitSha: context.repository.baseSha, assetId: asset.assetId };

    await expect(loadVisualTaskAsset({ ...common, taskId: "task.other" })).rejects.toThrow("task identity mismatch");
    await expect(loadVisualTaskAsset({ ...common, repository: "owner/other" })).rejects.toThrow("repository identity mismatch");
    await expect(loadVisualTaskAsset({ ...common, commitSha: commit("b") })).rejects.toThrow("commit identity mismatch");
    await expect(loadVisualTaskAsset({ ...common, assetId: "asset.unknown" })).rejects.toThrow("has no asset");
  });

  it("loads run evidence only through exact run, task, repository, commit, and digest identity", async () => {
    const root = await makeRoot();
    await writeAsset(root, "images/actual.png", png);
    const asset = await inspect(root, "images/actual.png", "image/png", "asset.reference");
    const task = taskContext(asset);
    const run = runContext(task, asset);
    const common = {
      evidenceRoot: root,
      runContext: run,
      taskId: task.taskId,
      taskContextDigest: task.contextDigest,
      repository: task.repository.name,
      commitSha: run.repository.commitSha,
      runId: run.runId,
      assetId: "asset.actual"
    };

    const loaded = await loadVisualRunEvidenceAsset(common);
    expect(loaded.data.equals(png)).toBe(true);
    expect(loaded.runContextDigest).toBe(run.runContextDigest);
    await expect(loadVisualRunEvidenceAsset({ ...common, runId: "run.other" })).rejects.toThrow("run identity mismatch");
    await expect(loadVisualRunEvidenceAsset({ ...common, taskContextDigest: digest("f") })).rejects.toThrow("task context digest mismatch");
    await expect(loadVisualRunEvidenceAsset({ ...common, repository: "owner/other" })).rejects.toThrow("repository identity mismatch");
    await expect(loadVisualRunEvidenceAsset({ ...common, commitSha: commit("f") })).rejects.toThrow("commit identity mismatch");
    await expect(loadVisualRunEvidenceAsset({ ...common, assetId: "asset.unknown" })).rejects.toThrow("has no asset");
  });

  it("recomputes size, digest, MIME, and dimensions from bytes", async () => {
    const root = await makeRoot();
    await writeAsset(root, "images/reference.png", png);
    const asset = await inspect(root, "images/reference.png", "image/png", "asset.reference");
    const common = { evidenceRoot: root, taskId: "task.visual", repository: "owner/repo", commitSha: commit("a"), assetId: asset.assetId };

    await expect(loadVisualTaskAsset({ ...common, taskContext: taskContext({ ...asset, size: asset.size + 1 }) })).rejects.toThrow("size mismatch");
    await expect(loadVisualTaskAsset({ ...common, taskContext: taskContext({ ...asset, sha256: digest("f") }) })).rejects.toThrow("digest mismatch");
    await expect(loadVisualTaskAsset({ ...common, taskContext: taskContext({ ...asset, mediaType: "image/jpeg" }) })).rejects.toThrow("media type mismatch");
    await expect(loadVisualTaskAsset({ ...common, taskContext: taskContext({ ...asset, width: 2 }) })).rejects.toThrow("width mismatch");
    await expect(loadVisualTaskAsset({ ...common, taskContext: taskContext(asset), maxBytes: png.byteLength - 1 })).rejects.toThrow("retrieval limit");
  });

  it("rejects corrupt images and declared MIME mismatches during ingestion", async () => {
    const root = await makeRoot();
    await writeAsset(root, "images/corrupt.png", Buffer.from("not an image", "utf8"));
    await expect(inspect(root, "images/corrupt.png", "image/png", "asset.corrupt")).rejects.toThrow("not a supported");

    await writeAsset(root, "images/reference.png", png);
    await expect(inspect(root, "images/reference.png", "image/jpeg", "asset.reference")).rejects.toThrow("media type");
  });

  it("rejects symlinked parent paths that escape the evidence root", async () => {
    const root = await makeRoot();
    const outside = await makeRoot();
    await writeAsset(outside, "reference.png", png);
    await symlink(outside, path.join(root, "linked"), process.platform === "win32" ? "junction" : "dir");
    const asset: VisualTaskAsset = {
      assetId: "asset.reference",
      role: "reference",
      path: "linked/reference.png",
      mediaType: "image/png",
      sha256: sha256Bytes(png),
      size: png.byteLength,
      width: 1,
      height: 1,
      provenance: { kind: "fixture", sourceId: "fixture:reference" },
      regions: []
    };
    const context = taskContext(asset);

    await expect(loadVisualTaskAsset({
      evidenceRoot: root,
      taskContext: context,
      taskId: context.taskId,
      repository: context.repository.name,
      commitSha: context.repository.baseSha,
      assetId: asset.assetId
    })).rejects.toThrow("symbolic link");
  });

  it("recognizes supported PNG, GIF, JPEG, and WebP dimensions", async () => {
    const root = await makeRoot();
    const gif = Buffer.alloc(10);
    gif.write("GIF89a", 0, "ascii");
    gif.writeUInt16LE(2, 6);
    gif.writeUInt16LE(3, 8);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x02, 0x00, 0x03, 0x01, 0x01, 0x11, 0x00, 0xff, 0xd9]);
    const webp = Buffer.alloc(30);
    webp.write("RIFF", 0, "ascii");
    webp.writeUInt32LE(22, 4);
    webp.write("WEBP", 8, "ascii");
    webp.write("VP8X", 12, "ascii");
    webp.writeUInt32LE(10, 16);
    webp[24] = 2;
    webp[27] = 1;
    const cases = [
      { file: "image.png", data: png, mediaType: "image/png" as const, width: 1, height: 1 },
      { file: "image.gif", data: gif, mediaType: "image/gif" as const, width: 2, height: 3 },
      { file: "image.jpg", data: jpeg, mediaType: "image/jpeg" as const, width: 3, height: 2 },
      { file: "image.webp", data: webp, mediaType: "image/webp" as const, width: 3, height: 2 }
    ];

    for (const item of cases) {
      await writeAsset(root, item.file, item.data);
      const asset = await inspect(root, item.file, item.mediaType, `asset.${path.extname(item.file).slice(1)}`);
      expect(asset).toMatchObject({ mediaType: item.mediaType, width: item.width, height: item.height, size: item.data.byteLength });
    }
  });
});

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-hive-assets-"));
  temporaryRoots.push(root);
  return root;
}

async function writeAsset(root: string, relativePath: string, data: Buffer): Promise<void> {
  const destination = path.join(root, ...relativePath.split("/"));
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, data);
}

async function inspect(root: string, assetPath: string, mediaType: VisualTaskAsset["mediaType"], assetId: string): Promise<VisualTaskAsset> {
  return inspectDeclaredVisualTaskAsset({
    evidenceRoot: root,
    asset: {
      assetId,
      role: "reference",
      path: assetPath,
      mediaType,
      provenance: { kind: "fixture", sourceId: `fixture:${assetId}` },
      regions: []
    }
  });
}

function taskContext(asset: VisualTaskAsset): VisualHiveTaskContext {
  const profileBody = {
    profileId: "profile.repair",
    targetId: "target.app",
    requestKinds: ["capture", "patch_validation"] as Array<"capture" | "patch_validation">,
    contractIds: ["contract.visual"],
    routes: ["/"],
    scenarioIds: ["scenario.default"],
    viewports: [{ viewportId: "viewport.desktop", width: 1280, height: 720, deviceScaleFactor: 1 }],
    validationCommandId: "command.playwright"
  };
  const files = [{ path: "src/App.tsx", sha256: digest("8"), size: 200, classification: "source" as const }];
  return buildVisualHiveTaskContext({
    schemaVersion: "visual-hive.task-context.v1",
    digestAlgorithm: "visual-hive.canonical-json.sha256.v1",
    generatedAt: "2026-07-14T12:00:00.000Z",
    taskId: "task.visual",
    repository: {
      name: "owner/repo",
      repositoryId: "42",
      repositoryFingerprint: computeVisualRepositoryFingerprint("owner/repo", "42"),
      baseSha: commit("a")
    },
    issue: {
      source: "fixture",
      externalId: "fixture-asset",
      problemStatement: "Repair the visual regression shown in the reference image.",
      problemStatementSha256: sha256Utf8("Repair the visual regression shown in the reference image.")
    },
    assets: [asset],
    imageReferences: [{ position: 0, assetId: asset.assetId, role: asset.role }],
    graphCandidates: [],
    profiles: [{ ...profileBody, profileDigest: computeVisualValidationProfileDigest(profileBody) }],
    obligations: [{
      obligationId: "obligation.visual",
      description: "The rendered page matches the supplied reference.",
      sourceAssetIds: [asset.assetId],
      mappedContractIds: ["contract.visual"],
      route: "/",
      state: "default",
      viewportId: "viewport.desktop",
      assertionKind: "pixel_region",
      authority: "deterministic",
      confidence: 1,
      status: "mapped"
    }],
    sourceContext: { digest: canonicalSha256({ files, omittedPaths: 0, truncated: false }), files, omittedPaths: 0, truncated: false }
  });
}

function runContext(task: VisualHiveTaskContext, asset: VisualTaskAsset): VisualRunContext {
  const cases = [{
    caseId: "case.default",
    targetId: "target.app",
    route: "/",
    state: "default",
    viewport: { viewportId: "viewport.desktop", width: 1280, height: 720, deviceScaleFactor: 1 },
    contractIds: ["contract.visual"]
  }];
  const thresholds = [{ contractId: "contract.visual", maxDiffPixelRatio: 0, missingBaseline: "fail" as const }];
  return buildVisualRunContext({
    schemaVersion: "visual-hive.run-context.v1",
    digestAlgorithm: "visual-hive.canonical-json.sha256.v1",
    generatedAt: "2026-07-14T12:30:00.000Z",
    runId: "run.before",
    phase: "before",
    taskId: task.taskId,
    taskContextDigest: task.contextDigest,
    findingFingerprint: "finding.visual",
    repository: {
      name: task.repository.name,
      ...(task.repository.repositoryId ? { repositoryId: task.repository.repositoryId } : {}),
      repositoryFingerprint: task.repository.repositoryFingerprint,
      commitSha: task.repository.baseSha
    },
    execution: {
      commitSha: task.repository.baseSha,
      profileId: "profile.repair",
      profileDigest: task.profiles[0]!.profileDigest,
      configDigest: digest("1"),
      validationPolicyDigest: computeVisualValidationPolicyDigest("command.playwright", thresholds),
      contractInventoryDigest: canonicalSha256(["contract.visual"]),
      planDigest: digest("2"),
      testPlanDigest: digest("3"),
      toolRegistryDigest: digest("4"),
      baselineIdentityDigest: digest("5"),
      executionMatrixDigest: canonicalSha256(cases),
      browser: { name: "chromium", version: "130" },
      environment: {
        os: "windows",
        architecture: "x64",
        nodeVersion: "22.13.1",
        playwrightVersion: "1.54.1",
        fontManifestDigest: digest("6"),
        locale: "en-US",
        timezone: "UTC"
      },
      cases
    },
    producer: { visualHiveVersion: "0.3.2", visualHiveCommit: commit("c"), playwrightVersion: "1.54.1" },
    command: { validationCommandId: "command.playwright", startedAt: "2026-07-14T12:29:00.000Z", completedAt: "2026-07-14T12:30:00.000Z", exitCode: 0 },
    report: { path: "report.json", sha256: digest("7") },
    evidenceAssets: [{
      assetId: "asset.actual",
      role: "actual",
      path: asset.path,
      mediaType: asset.mediaType,
      sha256: asset.sha256,
      size: asset.size,
      width: asset.width!,
      height: asset.height!,
      assertion: { contractId: "contract.visual", screenshotName: "Visual card", route: "/", state: "default", viewportId: "viewport.desktop" },
      obligationIds: ["obligation.visual"]
    }],
    thresholds,
    capture: { status: "passed", failures: [] }
  });
}
