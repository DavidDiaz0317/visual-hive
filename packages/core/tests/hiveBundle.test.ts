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
      scan: {
        scope: "full",
        authoritativeForResolution: true,
        evaluatedContracts: ["app-shell"],
        evaluatedFiles: ["src/App.tsx"],
        testPlanVersion: "plan-1",
        toolRegistryVersion: "tools-1"
      },
      issues: [issue("open_candidate")],
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
    expect(result.manifest.observations).toHaveLength(1);
    expect(result.manifest.observations[0]).toMatchObject({ state: "present", fingerprint: "visual-hive:test:app-shell" });
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

  it("rejects absent lifecycle observations from a non-authoritative scan", async () => {
    const rootDir = await makeRoot();
    await writeArtifact(rootDir, ".visual-hive/hive/beads.json", { schemaVersion: "visual-hive.hive-beads.v1", beads: [] });
    await expect(writeVisualHiveBundle({
      rootDir,
      bundleId: "unsafe-resolution",
      project: "demo",
      mode: "measured",
      verdict: "ready",
      acmmRequest: 3,
      artifacts: [".visual-hive/hive/beads.json"],
      source: source(),
      scan: { scope: "changed-files", authoritativeForResolution: false },
      issues: [issue("resolved_candidate")],
      producerVersion: "0.2.0",
      producerGitCommit: "abc123"
    })).rejects.toThrow("authoritative");
  });

  it("detects lifecycle metadata tampering", async () => {
    const rootDir = await makeRoot();
    await writeArtifact(rootDir, ".visual-hive/hive/beads.json", { schemaVersion: "visual-hive.hive-beads.v1", beads: [] });
    const result = await writeVisualHiveBundle({
      rootDir,
      bundleId: "tamper-proof",
      project: "demo",
      mode: "measured",
      verdict: "ready",
      acmmRequest: 3,
      artifacts: [".visual-hive/hive/beads.json"],
      source: source(),
      scan: { scope: "partial" },
      issues: [issue("open_candidate")],
      producerVersion: "0.2.0",
      producerGitCommit: "abc123"
    });
    result.manifest.observations[0]!.state = "absent";
    expect(verifyVisualHiveBundleDigest(result.manifest)).toBe(false);
  });

  it("binds requested authority and verdict metadata into the aggregate digest", async () => {
    const rootDir = await makeRoot();
    await writeArtifact(rootDir, ".visual-hive/hive/beads.json", { schemaVersion: "visual-hive.hive-beads.v1", beads: [] });
    const result = await writeVisualHiveBundle({
      rootDir,
      bundleId: "authority-proof",
      project: "demo",
      mode: "measured",
      verdict: "ready",
      acmmRequest: 4,
      artifacts: [".visual-hive/hive/beads.json"],
      source: source(),
      producerVersion: "0.2.0",
      producerGitCommit: "abc123"
    });

    result.manifest.acmmRequest = 6;
    expect(verifyVisualHiveBundleDigest(result.manifest)).toBe(false);
    result.manifest.acmmRequest = 4;
    result.manifest.verdict = "passed";
    expect(verifyVisualHiveBundleDigest(result.manifest)).toBe(false);
  });

  it("rejects invalid requested authority before publishing a bundle", async () => {
    const rootDir = await makeRoot();
    await writeArtifact(rootDir, ".visual-hive/hive/beads.json", { schemaVersion: "visual-hive.hive-beads.v1", beads: [] });
    await expect(writeVisualHiveBundle({
      rootDir,
      bundleId: "invalid-authority",
      project: "demo",
      mode: "measured",
      verdict: "ready",
      acmmRequest: 7,
      artifacts: [".visual-hive/hive/beads.json"],
      source: source(),
      producerVersion: "0.2.0",
      producerGitCommit: "abc123"
    })).rejects.toThrow("integer from 1 through 6");
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

function issue(status: "open_candidate" | "resolved_candidate") {
  return {
    issueKind: "visual_regression" as const,
    severity: "high" as const,
    status,
    dedupeFingerprint: "visual-hive:test:app-shell",
    title: "App shell regression",
    labels: ["visual-hive"],
    body: "Evidence-backed regression",
    owningAgentHint: "hive/quality" as const,
    sourceArtifacts: [".visual-hive/report.json"],
    affected: [{ contractId: "app-shell" }],
    validationCommand: "npm run vh:run:ci",
    guardrails: ["Do not update baselines automatically"]
  };
}
