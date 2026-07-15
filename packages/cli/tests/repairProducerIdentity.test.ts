import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sha256Bytes } from "@visual-hive/core";
import { afterEach, describe, expect, it } from "vitest";
import {
  resolveVerifiedVisualHiveProducerIdentity,
  verifyVisualHiveProducerIdentity
} from "../src/commands/repairProducerIdentity.js";

const roots: string[] = [];
const version = "0.3.2";
const commit = "a".repeat(40);

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe.sequential("verified Visual Hive producer identity", () => {
  it("derives immutable version and commit identity from the exact inventoried entrypoint", async () => {
    const fixture = await releaseFixture();
    const identity = await verifyVisualHiveProducerIdentity(fixture.options);

    expect(identity).toEqual({
      identityKind: "verified_release_manifest",
      visualHiveVersion: version,
      visualHiveCommit: commit,
      manifestSha256: sha256Bytes(fixture.manifestBytes),
      entrypointSha256: sha256Bytes(fixture.entrypointBytes)
    });
    expect(Object.isFrozen(identity)).toBe(true);
  });

  it("rejects malformed, unpinned, duplicate, unsafe, and version-mismatched manifests", async () => {
    const fixture = await releaseFixture();
    const cases: Array<{ name: string; mutate: (manifest: Record<string, unknown>) => void; error: RegExp }> = [
      { name: "unknown field", mutate: (manifest) => { manifest.unexpected = true; }, error: /unrecognized_key/u },
      { name: "unversioned commit", mutate: (manifest) => { manifest.gitCommit = "unknown"; }, error: /invalid_string|Invalid/u },
      { name: "version mismatch", mutate: (manifest) => { manifest.version = "9.9.9"; }, error: /does not match/u },
      { name: "unsafe inventory", mutate: (manifest) => { manifest.files = [{ path: "../visual-hive.mjs", sha256: sha256Bytes(fixture.entrypointBytes), size: fixture.entrypointBytes.length }]; }, error: /unsafe/u },
      { name: "duplicate entrypoint", mutate: (manifest) => { manifest.files = [manifest.files as unknown, manifest.files as unknown].flat(); }, error: /unique|exactly once/u }
    ];
    for (const testCase of cases) {
      const manifest = structuredClone(fixture.manifest) as Record<string, unknown>;
      testCase.mutate(manifest);
      await writeFile(fixture.manifestPath, `${JSON.stringify(manifest)}\n`);
      await expect(verifyVisualHiveProducerIdentity(fixture.options), testCase.name).rejects.toThrow(testCase.error);
    }
  });

  it("rejects missing manifests and entrypoint byte replacement", async () => {
    const missing = await temporaryRoot("producer-missing");
    const entrypointPath = path.join(missing, "visual-hive.mjs");
    await writeFile(entrypointPath, "console.log('bundle');\n");
    await expect(verifyVisualHiveProducerIdentity({
      entrypointPath,
      manifestPath: path.join(missing, "release-manifest.json"),
      expectedVersion: version
    })).rejects.toThrow();

    const fixture = await releaseFixture();
    await writeFile(fixture.entrypointPath, "console.log('tampered');\n");
    await expect(verifyVisualHiveProducerIdentity(fixture.options)).rejects.toThrow("does not match its immutable release inventory");
  });

  it("rejects a linked release directory instead of following it", async () => {
    const fixture = await releaseFixture();
    const root = await temporaryRoot("producer-link");
    const linked = path.join(root, "linked-release");
    await symlink(fixture.root, linked, process.platform === "win32" ? "junction" : "dir");
    await expect(verifyVisualHiveProducerIdentity({
      entrypointPath: path.join(linked, "visual-hive.mjs"),
      manifestPath: path.join(linked, "release-manifest.json"),
      expectedVersion: version
    })).rejects.toThrow(/symbolic-link|junction|canonical|ordinary directory/u);
  });

  it("has no source-Git or environment identity fallback", async () => {
    const previous = process.env.VISUAL_HIVE_GIT_COMMIT;
    process.env.VISUAL_HIVE_GIT_COMMIT = commit;
    try {
      await expect(resolveVerifiedVisualHiveProducerIdentity()).rejects.toThrow(/release manifest|ENOENT/u);
    } finally {
      if (previous === undefined) delete process.env.VISUAL_HIVE_GIT_COMMIT;
      else process.env.VISUAL_HIVE_GIT_COMMIT = previous;
    }
  });
});

async function releaseFixture(): Promise<{
  root: string;
  entrypointPath: string;
  manifestPath: string;
  entrypointBytes: Buffer;
  manifestBytes: Buffer;
  manifest: Record<string, unknown>;
  options: { entrypointPath: string; manifestPath: string; expectedVersion: string };
}> {
  const root = await temporaryRoot("producer-release");
  const entrypointPath = path.join(root, "visual-hive.mjs");
  const manifestPath = path.join(root, "release-manifest.json");
  const entrypointBytes = Buffer.from("console.log('visual-hive');\n", "utf8");
  await writeFile(entrypointPath, entrypointBytes);
  const manifest: Record<string, unknown> = {
    schemaVersion: "visual-hive.release.v1",
    name: "visual-hive",
    version,
    gitCommit: commit,
    node: ">=22",
    entrypoint: "visual-hive.mjs",
    playwrightVersion: "1.54.1",
    files: [{ path: "visual-hive.mjs", sha256: sha256Bytes(entrypointBytes), size: entrypointBytes.length }]
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(manifestPath, manifestBytes);
  return { root, entrypointPath, manifestPath, entrypointBytes, manifestBytes, manifest, options: { entrypointPath, manifestPath, expectedVersion: version } };
}

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), `visual-hive-${prefix}-`));
  roots.push(root);
  return root;
}
