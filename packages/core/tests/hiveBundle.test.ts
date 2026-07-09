import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { afterEach, describe, expect, it } from "vitest";
import { verifyVisualHiveBundleDigest, writeVisualHiveBundle } from "../src/hive/bundle.js";

const temporaryRoots: string[] = [];
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Visual Hive atomic bundle", () => {
  it("copies evidence, records content digests, and publishes by atomic rename", async () => {
    const rootDir = await makeRoot();
    await writeArtifact(rootDir, ".visual-hive/hive/beads.json", { schemaVersion: "visual-hive.hive-beads.v1", beads: [] });

    const result = await writeVisualHiveBundle({
      rootDir,
      bundleId: "proof-1",
      project: "demo",
      mode: "measured",
      verdict: "ready",
      acmmRequest: 3,
      artifacts: [".visual-hive/hive/beads.json"],
      source: source(),
      producerVersion: "0.2.0",
      producerGitCommit: "abc123",
      now: new Date("2026-07-09T12:00:00.000Z")
    });

    expect(result.manifestPath).toBe(".visual-hive/bundles/proof-1/manifest.json");
    expect(result.manifest.files[0]).toMatchObject({
      path: "files/.visual-hive/hive/beads.json",
      sourcePath: ".visual-hive/hive/beads.json",
      schemaVersion: "visual-hive.hive-beads.v1"
    });
    expect(verifyVisualHiveBundleDigest(result.manifest)).toBe(true);
    expect(JSON.parse(await readFile(path.join(rootDir, result.manifestPath), "utf8"))).toEqual(result.manifest);
    const schema = JSON.parse(await readFile(path.join(repoRoot, "schemas/visual-hive.bundle.schema.json"), "utf8"));
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
    expect(validate(result.manifest), JSON.stringify(validate.errors, null, 2)).toBe(true);
  });

  it("rejects escaping paths and removes an incomplete temporary bundle", async () => {
    const rootDir = await makeRoot();
    await expect(writeVisualHiveBundle({
      rootDir,
      bundleId: "unsafe",
      project: "demo",
      mode: "measured",
      verdict: "ready",
      acmmRequest: 3,
      artifacts: ["../secret.txt"],
      source: source(),
      producerVersion: "0.2.0",
      producerGitCommit: "abc123"
    })).rejects.toThrow("unsafe");
    await expect(readFile(path.join(rootDir, ".visual-hive/bundles/unsafe/manifest.json"))).rejects.toThrow();
  });
});

async function makeRoot(): Promise<string> {
  const root = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(path.join(os.tmpdir(), "visual-hive-bundle-")));
  temporaryRoots.push(root);
  return root;
}

async function writeArtifact(root: string, relative: string, value: unknown): Promise<void> {
  const target = path.join(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value)}\n`, "utf8");
}

function source() {
  return {
    repository: "owner/repo",
    ref: "refs/heads/main",
    commitSha: "abc123",
    event: "workflow_dispatch",
    conclusion: "success",
    trusted: true
  };
}
