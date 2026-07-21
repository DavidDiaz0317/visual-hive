import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { indexArtifacts } from "../src/artifacts/index.js";
import { VISUAL_HIVE_OWNER_HINTS_BY_ISSUE_KIND, VISUAL_HIVE_PRODUCER_ISSUE_KINDS } from "../src/issues/producerContract.js";
import {
  VISUAL_HIVE_BUNDLE_DIGEST_ALGORITHM,
  VISUAL_HIVE_BUNDLE_V3_DIGEST_ALGORITHM,
  verifyVisualHiveBundleDigest,
  writeVisualHiveBundle as writeVisualHiveBundleV3,
  type WriteVisualHiveBundleOptions
} from "../src/hive/bundle.js";

type ActualFsPromises = typeof import("node:fs/promises");

const fsInterception = vi.hoisted(() => ({
  afterWrite: undefined as undefined | ((actual: ActualFsPromises, target: string) => Promise<void>),
  afterRename: undefined as undefined | ((actual: ActualFsPromises, source: string, destination: string) => Promise<void>),
  afterReaddir: undefined as undefined | ((actual: ActualFsPromises, directory: string) => Promise<void>)
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<ActualFsPromises>();
  return {
    ...actual,
    writeFile: async (...args: unknown[]) => {
      const result = await Reflect.apply(actual.writeFile, actual, args) as Promise<void>;
      await fsInterception.afterWrite?.(actual, String(args[0]));
      return result;
    },
    rename: async (...args: unknown[]) => {
      const result = await Reflect.apply(actual.rename, actual, args) as Promise<void>;
      await fsInterception.afterRename?.(actual, String(args[0]), String(args[1]));
      return result;
    },
    readdir: async (...args: unknown[]) => {
      const result = await Reflect.apply(actual.readdir, actual, args) as unknown;
      await fsInterception.afterReaddir?.(actual, String(args[0]));
      return result;
    }
  };
});

const temporaryRoots: string[] = [];
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const DEFAULT_OBSERVATION_ARTIFACTS = [".visual-hive/issues.json", ".visual-hive/report.json"] as const;

afterEach(async () => {
  fsInterception.afterWrite = undefined;
  fsInterception.afterRename = undefined;
  fsInterception.afterReaddir = undefined;
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Visual Hive atomic bundle", () => {
  it("copies evidence, records content digests, and publishes by atomic rename", async () => {
    const rootDir = await makeRoot();
    await writeArtifact(rootDir, ".visual-hive/hive/beads.json", { schemaVersion: "visual-hive.hive-beads.v1", beads: [] });
    await writeDefaultObservationEvidence(rootDir);

    const result = await writeVisualHiveBundle({
      rootDir,
      bundleId: "proof-1",
      project: "demo",
      mode: "measured",
      verdict: "ready",
      acmmRequest: 3,
      artifacts: [".visual-hive/hive/beads.json", ...DEFAULT_OBSERVATION_ARTIFACTS],
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
    expect(result.manifest.schemaVersion).toBe("visual-hive.bundle.v3");
    expect(result.manifest.digestAlgorithm).toBe(VISUAL_HIVE_BUNDLE_V3_DIGEST_ALGORITHM);
    expect(result.manifest.files.find((file) => file.sourcePath === ".visual-hive/hive/beads.json")).toMatchObject({
      path: "files/.visual-hive/hive/beads.json",
      sourcePath: ".visual-hive/hive/beads.json",
      schemaVersion: "visual-hive.hive-beads.v1"
    });
    expect(result.manifest.artifactIndex).toMatchObject({ contentAddressed: true, complete: true, sourcePath: ".visual-hive/artifacts-index.json" });
    expect(result.manifest.capabilityParity).toMatchObject({ status: "passed", runtimeStatus: "ready", sourcePath: ".visual-hive/capability-parity.json" });
    expect(result.manifest.files.map((file) => file.sourcePath)).toEqual(expect.arrayContaining([
      ".visual-hive/artifacts-index.json",
      ".visual-hive/capability-parity.json"
    ]));
    expect(verifyVisualHiveBundleDigest(result.manifest)).toBe(true);
    expect(result.manifest.observations).toHaveLength(1);
    expect(result.manifest.observations[0]).toMatchObject({
      state: "present",
      fingerprint: "visual-hive:test:app-shell",
      publicationRole: "canonical",
      rootCauseKey: "finding/visual_regression/app-shell",
      blockedByRootKeys: []
    });
    expect(JSON.parse(await readFile(path.join(rootDir, result.manifestPath), "utf8"))).toEqual(result.manifest);
    const schema = JSON.parse(await readFile(path.join(repoRoot, "schemas/visual-hive.bundle.schema.json"), "utf8"));
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
    expect(validate(result.manifest), JSON.stringify(validate.errors, null, 2)).toBe(true);
    const missingReceipt = structuredClone(result.manifest) as unknown as Record<string, unknown>;
    delete missingReceipt.capabilityParity;
    expect(validate(missingReceipt)).toBe(false);
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
      purpose: "repair-validation" as const,
      producerVersion: "0.2.0",
      producerGitCommit: "abc123"
    })).rejects.toThrow("unsafe");
    await expect(readFile(path.join(rootDir, ".visual-hive/bundles/unsafe/manifest.json"))).rejects.toThrow();
  });

  it("rejects an intermediate directory link before reading evidence outside the repository", async () => {
    const rootDir = await makeRoot();
    const outsideRoot = await makeRoot();
    await writeArtifact(outsideRoot, "evidence.json", { secret: "outside" });
    await mkdir(path.join(rootDir, ".visual-hive"), { recursive: true });
    await symlink(outsideRoot, path.join(rootDir, ".visual-hive", "linked"), process.platform === "win32" ? "junction" : "dir");

    await expect(writeVisualHiveBundleV3({
      rootDir,
      bundleId: "linked-input",
      project: "demo",
      mode: "manual",
      verdict: "ready",
      acmmRequest: 2,
      artifacts: [".visual-hive/linked/evidence.json"],
      source: { repository: "owner/repo", ref: "main", commitSha: "local", event: "local", conclusion: "local", trusted: true },
      producerVersion: "0.3.2",
      producerGitCommit: "abc123"
    })).rejects.toThrow("symbolic link or reparse point");
    await expect(readFile(path.join(rootDir, ".visual-hive", "bundles", "linked-input", "manifest.json"))).rejects.toThrow();
  });

  it("rejects a linked output directory without writing outside the repository", async () => {
    const rootDir = await makeRoot();
    const outsideRoot = await makeRoot();
    await writeArtifact(rootDir, ".visual-hive/evidence.json", { status: "ready" });
    await symlink(outsideRoot, path.join(rootDir, ".visual-hive", "bundles"), process.platform === "win32" ? "junction" : "dir");

    await expect(writeVisualHiveBundleV3({
      rootDir,
      bundleId: "linked-output",
      project: "demo",
      mode: "manual",
      verdict: "ready",
      acmmRequest: 2,
      artifacts: [".visual-hive/evidence.json"],
      source: { repository: "owner/repo", ref: "main", commitSha: "local", event: "local", conclusion: "local", trusted: true },
      producerVersion: "0.3.2",
      producerGitCommit: "abc123"
    })).rejects.toThrow("symbolic link");
    await expect(readFile(path.join(outsideRoot, "linked-output", "manifest.json"))).rejects.toThrow();
  });

  it.skipIf(process.platform === "win32")("rejects a final-file symlink before opening it", async () => {
    const rootDir = await makeRoot();
    const outsideRoot = await makeRoot();
    await writeArtifact(outsideRoot, "evidence.json", { secret: "outside" });
    await mkdir(path.join(rootDir, ".visual-hive"), { recursive: true });
    await symlink(path.join(outsideRoot, "evidence.json"), path.join(rootDir, ".visual-hive", "evidence.json"), "file");

    await expect(writeVisualHiveBundleV3({
      rootDir,
      bundleId: "linked-file",
      project: "demo",
      mode: "manual",
      verdict: "ready",
      acmmRequest: 2,
      artifacts: [".visual-hive/evidence.json"],
      source: { repository: "owner/repo", ref: "main", commitSha: "local", event: "local", conclusion: "local", trusted: true },
      producerVersion: "0.3.2",
      producerGitCommit: "abc123"
    })).rejects.toThrow("symbolic link or reparse point");
  });

  it.each(["artifact", "manifest"] as const)("fails closed when a staged %s is tampered after write", async (tamperTarget) => {
    const rootDir = await makeRoot();
    const bundleId = `staged-${tamperTarget}-tamper`;
    const artifactPath = ".visual-hive/local-evidence.json";
    await writeArtifact(rootDir, artifactPath, { status: "ready" });
    let tampered = false;
    fsInterception.afterWrite = async (actual, target) => {
      const normalized = target.replaceAll("\\", "/");
      const expectedSuffix = tamperTarget === "artifact"
        ? `/files/${artifactPath}`
        : "/manifest.json";
      if (tampered || !normalized.includes(`/.tmp-${bundleId}-`) || !normalized.endsWith(expectedSuffix)) return;
      tampered = true;
      await actual.writeFile(target, Buffer.from("tampered-after-write\n", "utf8"));
    };

    await expect(writeVisualHiveBundleV3({
      rootDir,
      bundleId,
      project: "local-demo",
      mode: "manual",
      verdict: "ready",
      acmmRequest: 2,
      artifacts: [artifactPath],
      source: { repository: "owner/local-demo", ref: "main", commitSha: "local", event: "local", conclusion: "local", trusted: true },
      observations: [],
      producerVersion: "0.3.2",
      producerGitCommit: "abc123"
    })).rejects.toThrow("failed exact readback");
    expect(tampered).toBe(true);
    await expect(readFile(path.join(rootDir, ".visual-hive/bundles", bundleId, "manifest.json"))).rejects.toThrow();
  });

  it.each(["artifact", "manifest"] as const)("fails closed when a published %s is tampered after rename", async (tamperTarget) => {
    const rootDir = await makeRoot();
    const bundleId = `published-${tamperTarget}-tamper`;
    const artifactPath = ".visual-hive/local-evidence.json";
    await writeArtifact(rootDir, artifactPath, { status: "ready" });
    let tampered = false;
    fsInterception.afterRename = async (actual, _source, destination) => {
      const normalized = destination.replaceAll("\\", "/");
      if (tampered || !normalized.endsWith(`/.visual-hive/bundles/${bundleId}`)) return;
      tampered = true;
      const target = tamperTarget === "artifact"
        ? path.join(destination, "files", ...artifactPath.split("/"))
        : path.join(destination, "manifest.json");
      await actual.writeFile(target, Buffer.from("tampered-after-rename\n", "utf8"));
    };

    await expect(writeVisualHiveBundleV3({
      rootDir,
      bundleId,
      project: "local-demo",
      mode: "manual",
      verdict: "ready",
      acmmRequest: 2,
      artifacts: [artifactPath],
      source: { repository: "owner/local-demo", ref: "main", commitSha: "local", event: "local", conclusion: "local", trusted: true },
      observations: [],
      producerVersion: "0.3.2",
      producerGitCommit: "abc123"
    })).rejects.toThrow("failed exact readback");
    expect(tampered).toBe(true);
    await expect(readFile(path.join(rootDir, ".visual-hive/bundles", bundleId, "manifest.json"))).rejects.toThrow();
  });

  it("rejects a directory swap during complete artifact traversal", async () => {
    const rootDir = await makeRoot();
    const evidenceDir = path.join(rootDir, ".visual-hive", "evidence");
    const evidencePath = path.join(evidenceDir, "payload.json");
    const evidenceData = Buffer.from(`${JSON.stringify({ status: "ready" })}\n`, "utf8");
    await mkdir(evidenceDir, { recursive: true });
    await writeFile(evidencePath, evidenceData);
    await prepareBundleEvidence({ rootDir, project: "demo" });
    let swapped = false;
    fsInterception.afterReaddir = async (actual, directory) => {
      if (swapped || path.resolve(directory) !== path.resolve(evidenceDir)) return;
      swapped = true;
      await actual.rename(evidenceDir, `${evidenceDir}-original`);
      await actual.mkdir(evidenceDir);
      await actual.writeFile(evidencePath, evidenceData);
    };

    await expect(writeVisualHiveBundleV3({
      rootDir,
      bundleId: "directory-swap",
      project: "demo",
      mode: "measured",
      verdict: "ready",
      acmmRequest: 3,
      artifacts: [".visual-hive/evidence/payload.json"],
      source: source(),
      observations: [],
      producerVersion: "0.3.2",
      producerGitCommit: "abc123"
    })).rejects.toThrow("directory identity changed during traversal");
    expect(swapped).toBe(true);
    await expect(readFile(path.join(rootDir, ".visual-hive/bundles/directory-swap/manifest.json"))).rejects.toThrow();
  });

  it("rejects directory content drift during complete artifact traversal", async () => {
    const rootDir = await makeRoot();
    const evidenceDir = path.join(rootDir, ".visual-hive", "evidence");
    await mkdir(evidenceDir, { recursive: true });
    await writeArtifact(rootDir, ".visual-hive/evidence/payload.json", { status: "ready" });
    await prepareBundleEvidence({ rootDir, project: "demo" });
    let changed = false;
    fsInterception.afterReaddir = async (actual, directory) => {
      if (changed || path.resolve(directory) !== path.resolve(evidenceDir)) return;
      changed = true;
      await actual.writeFile(path.join(evidenceDir, "late.json"), "{}\n", "utf8");
    };

    await expect(writeVisualHiveBundleV3({
      rootDir,
      bundleId: "directory-content-drift",
      project: "demo",
      mode: "measured",
      verdict: "ready",
      acmmRequest: 3,
      artifacts: [".visual-hive/evidence/payload.json"],
      source: source(),
      observations: [],
      producerVersion: "0.3.2",
      producerGitCommit: "abc123"
    })).rejects.toThrow("directory identity changed during traversal");
    expect(changed).toBe(true);
    await expect(readFile(path.join(rootDir, ".visual-hive/bundles/directory-content-drift/manifest.json"))).rejects.toThrow();
  });

  it("rejects any repository artifact-index seal lock before reading v3 evidence", async () => {
    const rootDir = await makeRoot();
    await writeArtifact(rootDir, ".visual-hive/evidence.json", { status: "ready" });
    await prepareBundleEvidence({ rootDir, project: "demo" });
    await writeFile(path.join(rootDir, ".visual-hive-artifacts-index.lock"), "malformed-lock-state", "utf8");

    await expect(writeVisualHiveBundleV3({
      rootDir,
      bundleId: "locked-before-evidence",
      project: "demo",
      mode: "measured",
      verdict: "ready",
      acmmRequest: 3,
      artifacts: [".visual-hive/evidence.json"],
      source: source(),
      observations: [],
      producerVersion: "0.3.2",
      producerGitCommit: "abc123"
    })).rejects.toThrow("artifact index seal lock");
    await expect(readFile(path.join(rootDir, ".visual-hive/bundles/locked-before-evidence/manifest.json"))).rejects.toThrow();
  });

  it.each(["before-publication", "before-readback"] as const)("rejects an artifact-index seal lock created %s", async (phase) => {
    const rootDir = await makeRoot();
    const bundleId = `locked-${phase}`;
    const lockPath = path.join(rootDir, ".visual-hive-artifacts-index.lock");
    await writeArtifact(rootDir, ".visual-hive/evidence.json", { status: "ready" });
    await prepareBundleEvidence({ rootDir, project: "demo" });
    let locked = false;
    const createLock = async (actual: ActualFsPromises) => {
      if (locked) return;
      locked = true;
      await actual.writeFile(lockPath, "lock-created-during-publication", "utf8");
    };
    if (phase === "before-publication") {
      fsInterception.afterWrite = async (actual, target) => {
        const normalized = target.replaceAll("\\", "/");
        if (normalized.includes(`/.tmp-${bundleId}-`) && normalized.endsWith("/manifest.json")) await createLock(actual);
      };
    } else {
      fsInterception.afterRename = async (actual, _source, destination) => {
        if (destination.replaceAll("\\", "/").endsWith(`/.visual-hive/bundles/${bundleId}`)) await createLock(actual);
      };
    }

    await expect(writeVisualHiveBundleV3({
      rootDir,
      bundleId,
      project: "demo",
      mode: "measured",
      verdict: "ready",
      acmmRequest: 3,
      artifacts: [".visual-hive/evidence.json"],
      source: source(),
      observations: [],
      producerVersion: "0.3.2",
      producerGitCommit: "abc123"
    })).rejects.toThrow("artifact index seal lock");
    expect(locked).toBe(true);
    await expect(readFile(path.join(rootDir, ".visual-hive/bundles", bundleId, "manifest.json"))).rejects.toThrow();
  });

  it("preserves a trusted standalone local writer as a verifiable v2 bundle without hosted identity or parity receipts", async () => {
    const rootDir = await makeRoot();
    await writeArtifact(rootDir, ".visual-hive/local-evidence.json", { schemaVersion: "local.v1", status: "ready" });
    const result = await writeVisualHiveBundleV3({
      rootDir,
      bundleId: "local-v2",
      project: "local-demo",
      mode: "manual",
      verdict: "ready",
      acmmRequest: 2,
      artifacts: [".visual-hive/local-evidence.json"],
      source: {
        repository: "owner/local-demo",
        ref: "main",
        commitSha: "local123",
        event: "local",
        conclusion: "local",
        trusted: true
      },
      observations: [],
      producerVersion: "0.3.0",
      producerGitCommit: "abc123",
      now: new Date("2026-07-09T12:00:00.000Z")
    });

    expect(result.manifest.schemaVersion).toBe("visual-hive.bundle.v2");
    expect(result.manifest.digestAlgorithm).toBe(VISUAL_HIVE_BUNDLE_DIGEST_ALGORITHM);
    expect(result.manifest.artifactIndex).toBeUndefined();
    expect(result.manifest.capabilityParity).toBeUndefined();
    expect(result.manifest.source.trusted).toBe(true);
    expect(result.manifest.files.map((file) => file.sourcePath)).toEqual([".visual-hive/local-evidence.json"]);
    expect(verifyVisualHiveBundleDigest(result.manifest)).toBe(true);
    const schema = JSON.parse(await readFile(path.join(repoRoot, "schemas/visual-hive.bundle.schema.json"), "utf8"));
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
    expect(validate(result.manifest), JSON.stringify(validate.errors, null, 2)).toBe(true);

    await expect(writeVisualHiveBundleV3({
      rootDir,
      bundleId: "hosted-without-identity",
      project: "hosted-demo",
      mode: "measured",
      verdict: "ready",
      acmmRequest: 3,
      artifacts: [".visual-hive/local-evidence.json"],
      source: { ...result.manifest.source, event: "workflow_dispatch" },
      observations: [],
      producerVersion: "0.3.0",
      producerGitCommit: "abc123"
    })).rejects.toThrow("Hosted Visual Hive bundle publication requires");

    const advisoryRepair = await writeVisualHiveBundleV3({
      rootDir,
      bundleId: "advisory-repair-evidence",
      purpose: "repair-validation",
      project: "local-demo",
      mode: "full",
      verdict: "passed",
      acmmRequest: 5,
      artifacts: [".visual-hive/local-evidence.json"],
      source: { ...result.manifest.source, repository: "owner/repo", event: "hive_repair", commitSha: "a".repeat(40) },
      scan: { scope: "full", authoritativeForResolution: false },
      observations: [observation({ fingerprint: "repair-present", state: "present" })],
      producerVersion: "0.3.2",
      producerGitCommit: "abc123"
    });
    expect(advisoryRepair.manifest.schemaVersion).toBe("visual-hive.bundle.v2");
    expect(verifyVisualHiveBundleDigest(advisoryRepair.manifest)).toBe(true);

    await expect(writeVisualHiveBundleV3({
      rootDir,
      bundleId: "repair-cannot-claim-authority",
      purpose: "repair-validation",
      project: "local-demo",
      mode: "full",
      verdict: "passed",
      acmmRequest: 5,
      artifacts: [".visual-hive/local-evidence.json"],
      source: { ...result.manifest.source, repository: "owner/repo", event: "hive_repair", commitSha: "a".repeat(40) },
      scan: { scope: "full", authoritativeForResolution: true },
      observations: [observation({ fingerprint: "repair-authority", state: "present" })],
      producerVersion: "0.3.2",
      producerGitCommit: "abc123"
    })).rejects.toThrow("cannot claim resolution authority");
  });

  it("enforces caller-supplied bundle file, per-file, and aggregate byte limits", async () => {
    const rootDir = await makeRoot();
    await mkdir(path.join(rootDir, "evidence"), { recursive: true });
    await Promise.all([
      writeFile(path.join(rootDir, "evidence", "one.bin"), Buffer.alloc(4, 1)),
      writeFile(path.join(rootDir, "evidence", "two.bin"), Buffer.alloc(4, 2))
    ]);
    const base = {
      rootDir,
      project: "demo",
      mode: "measured" as const,
      verdict: "ready" as const,
      acmmRequest: 3,
      artifacts: ["evidence/one.bin", "evidence/two.bin"],
      source: source(),
      purpose: "repair-validation" as const,
      producerVersion: "0.2.0",
      producerGitCommit: "abc123"
    };

    await expect(writeVisualHiveBundle({
      ...base,
      bundleId: "too-many-files",
      artifactLimits: { maxFiles: 1, maxFileBytes: 4, maxTotalBytes: 8 }
    })).rejects.toThrow("1-file limit");
    await expect(writeVisualHiveBundle({
      ...base,
      bundleId: "file-too-large",
      artifactLimits: { maxFiles: 2, maxFileBytes: 3, maxTotalBytes: 8 }
    })).rejects.toThrow("bounded file size");
    await expect(writeVisualHiveBundle({
      ...base,
      bundleId: "aggregate-too-large",
      artifactLimits: { maxFiles: 2, maxFileBytes: 4, maxTotalBytes: 7 }
    })).rejects.toThrow("7-byte aggregate limit");
  });

  it("rejects absent lifecycle observations from a non-authoritative scan", async () => {
    const rootDir = await makeRoot();
    await writeArtifact(rootDir, ".visual-hive/hive/beads.json", { schemaVersion: "visual-hive.hive-beads.v1", beads: [] });
    await writeDefaultObservationEvidence(rootDir);
    await expect(writeVisualHiveBundle({
      rootDir,
      bundleId: "unsafe-resolution",
      project: "demo",
      mode: "measured",
      verdict: "ready",
      acmmRequest: 3,
      artifacts: [".visual-hive/hive/beads.json", ...DEFAULT_OBSERVATION_ARTIFACTS],
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
    await writeDefaultObservationEvidence(rootDir);
    const result = await writeVisualHiveBundle({
      rootDir,
      bundleId: "tamper-proof",
      project: "demo",
      mode: "measured",
      verdict: "ready",
      acmmRequest: 3,
      artifacts: [".visual-hive/hive/beads.json", ...DEFAULT_OBSERVATION_ARTIFACTS],
      source: source(),
      scan: { scope: "partial" },
      issues: [issue("open_candidate")],
      producerVersion: "0.2.0",
      producerGitCommit: "abc123"
    });
    result.manifest.observations[0]!.state = "absent";
    expect(verifyVisualHiveBundleDigest(result.manifest)).toBe(false);
  });

  it("binds publication metadata into the digest while retaining legacy v2 verification", async () => {
    const rootDir = await makeRoot();
    await writeArtifact(rootDir, ".visual-hive/hive/beads.json", { schemaVersion: "visual-hive.hive-beads.v1", beads: [] });
    await writeDefaultObservationEvidence(rootDir);
    const result = await writeVisualHiveBundle({
      rootDir,
      bundleId: "publication-digest",
      project: "demo",
      mode: "measured",
      verdict: "ready",
      acmmRequest: 3,
      artifacts: [".visual-hive/hive/beads.json", ...DEFAULT_OBSERVATION_ARTIFACTS],
      source: source(),
      issues: [issue("open_candidate")],
      producerVersion: "0.2.0",
      producerGitCommit: "abc123"
    });

    const tampered = structuredClone(result.manifest);
    tampered.observations[0]!.rootCauseKey = "finding/visual_regression/other-shell";
    expect(verifyVisualHiveBundleDigest(tampered)).toBe(false);

    const publicationV2 = structuredClone(result.manifest) as unknown as Record<string, any>;
    publicationV2.schemaVersion = "visual-hive.bundle.v2";
    publicationV2.digestAlgorithm = VISUAL_HIVE_BUNDLE_DIGEST_ALGORITHM;
    delete publicationV2.artifactIndex;
    delete publicationV2.capabilityParity;
    publicationV2.overallDigest = publicationDigestV2(publicationV2);
    publicationV2.provenance.subjectDigest = publicationV2.overallDigest;
    expect(verifyVisualHiveBundleDigest(publicationV2)).toBe(true);

    const legacy = structuredClone(result.manifest) as unknown as Record<string, any>;
    legacy.schemaVersion = "visual-hive.bundle.v2";
    delete legacy.digestAlgorithm;
    delete legacy.artifactIndex;
    delete legacy.capabilityParity;
    for (const observation of legacy.observations) {
      delete observation.publicationRole;
      delete observation.rootCauseKey;
      delete observation.blockedByRootKeys;
    }
    legacy.overallDigest = legacyDigest(legacy);
    legacy.provenance.subjectDigest = legacy.overallDigest;
    expect(verifyVisualHiveBundleDigest(legacy)).toBe(true);
    const schema = JSON.parse(await readFile(path.join(repoRoot, "schemas/visual-hive.bundle.schema.json"), "utf8"));
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
    expect(validate(publicationV2), JSON.stringify(validate.errors, null, 2)).toBe(true);
    expect(validate(legacy), JSON.stringify(validate.errors, null, 2)).toBe(true);
    const unsupported = structuredClone(result.manifest) as unknown as Record<string, any>;
    unsupported.digestAlgorithm = "visual-hive.bundle.publication-digest.v2";
    expect(validate(unsupported)).toBe(false);
  });

  it("uses length-prefixed array boundaries for publication, evidence, and scan metadata", async () => {
    const rootDir = await makeRoot();
    await writeArtifact(rootDir, ".visual-hive/hive/beads.json", { schemaVersion: "visual-hive.hive-beads.v1", beads: [] });
    await writeArtifact(rootDir, ".visual-hive/issues.json", { schemaVersion: "visual-hive.issues.v1", issues: [] });
    for (const artifact of [".visual-hive/a", ".visual-hive/b,c", ".visual-hive/a,b", ".visual-hive/c"]) {
      await writeArtifact(rootDir, artifact, { artifact });
    }
    const result = await writeVisualHiveBundle({
      rootDir,
      bundleId: "array-boundaries",
      project: "demo",
      mode: "measured",
      verdict: "ready",
      acmmRequest: 3,
      artifacts: [".visual-hive/hive/beads.json", ".visual-hive/issues.json", ".visual-hive/a", ".visual-hive/b,c", ".visual-hive/a,b", ".visual-hive/c"],
      source: source(),
      scan: {
        scope: "partial",
        evaluatedContracts: ["a", "b,c"],
        evaluatedFiles: ["a", "b,c"]
      },
      observations: [observation({
        fingerprint: "visual-hive:aggregate:collision-proof",
        publicationRole: "aggregate",
        rootCauseKey: "aggregate/readiness/collision-proof",
        blockedByRootKeys: ["a", "b,c"],
        issueKind: "external_repo_onboarding",
        labels: ["a", "b,c"],
        sourceArtifacts: [".visual-hive/a", ".visual-hive/b,c"],
        affectedContracts: ["a", "b,c"]
      })],
      producerVersion: "0.3.0",
      producerGitCommit: "abc123"
    });

    expect(verifyVisualHiveBundleDigest(result.manifest)).toBe(true);
    const collisionMutations: Array<(manifest: typeof result.manifest) => void> = [
      (manifest) => { manifest.observations[0]!.blockedByRootKeys = ["a,b", "c"]; },
      (manifest) => { manifest.observations[0]!.labels = ["a,b", "c"]; },
      (manifest) => { manifest.observations[0]!.sourceArtifacts = [".visual-hive/a,b", ".visual-hive/c"]; },
      (manifest) => { manifest.observations[0]!.affectedContracts = ["a,b", "c"]; },
      (manifest) => { manifest.scan.evaluatedContracts = ["a,b", "c"]; },
      (manifest) => { manifest.scan.evaluatedFiles = ["a,b", "c"]; }
    ];
    for (const mutate of collisionMutations) {
      const tampered = structuredClone(result.manifest);
      mutate(tampered);
      expect(verifyVisualHiveBundleDigest(tampered)).toBe(false);
    }
  });

  it("normalizes signed Unicode arrays by UTF-8 bytes for Go parity", async () => {
    const rootDir = await makeRoot();
    const astral = "\u{10000}";
    const privateUse = "\uE000";
    await writeArtifact(rootDir, ".visual-hive/hive/beads.json", []);
    await writeDefaultObservationEvidence(rootDir);
    const result = await writeVisualHiveBundle({
      rootDir,
      bundleId: "unicode-vector",
      project: "unicode",
      mode: "full",
      verdict: "ready",
      acmmRequest: 4,
      artifacts: [".visual-hive/hive/beads.json", ...DEFAULT_OBSERVATION_ARTIFACTS],
      source: source(),
      scan: {
        scope: "full",
        authoritativeForResolution: true,
        evaluatedContracts: [astral, privateUse],
        evaluatedFiles: [`src/${astral}.ts`, `src/${privateUse}.ts`],
        testPlanVersion: "unicode-plan",
        toolRegistryVersion: "unicode-tools"
      },
      observations: [observation({
        fingerprint: "unicode-observation",
        rootCauseKey: "finding/visual_regression/unicode",
        labels: [astral, privateUse],
        sourceArtifacts: [".visual-hive/report.json"],
        affectedContracts: [astral, privateUse]
      })],
      producerVersion: "0.3.0",
      producerGitCommit: "unicode",
      externalCallsMade: 0,
      now: new Date("2026-07-09T12:00:00.000Z")
    });

    expect(result.manifest.scan.evaluatedContracts).toEqual([privateUse, astral]);
    expect(result.manifest.scan.evaluatedFiles).toEqual([`src/${privateUse}.ts`, `src/${astral}.ts`]);
    expect(result.manifest.observations[0]?.labels).toEqual([privateUse, astral]);
    expect(result.manifest.observations[0]?.sourceArtifacts).toEqual([".visual-hive/report.json"]);
    expect(result.manifest.observations[0]?.affectedContracts).toEqual([privateUse, astral]);
    expect(result.manifest.overallDigest).toBe("5c79b50aff104b5a5db6d26ee528dbfbe39411ad08adb01c4c3a1d2f75803d2b");
    expect(verifyVisualHiveBundleDigest(result.manifest)).toBe(true);
  });

  it("marks empty authoritative bundles and rejects unsupported or mismatched digest modes", async () => {
    const rootDir = await makeRoot();
    await writeArtifact(rootDir, ".visual-hive/hive/beads.json", { schemaVersion: "visual-hive.hive-beads.v1", beads: [] });
    const result = await writeVisualHiveBundle({
      rootDir,
      bundleId: "vector-1",
      project: "demo",
      mode: "measured",
      verdict: "ready",
      acmmRequest: 3,
      artifacts: [".visual-hive/hive/beads.json"],
      source: source(),
      scan: {
        scope: "full",
        authoritativeForResolution: true,
        evaluatedContracts: ["a", "b,c"],
        evaluatedFiles: ["src/a.ts", "src/b,c.ts"],
        testPlanVersion: "plan-1",
        toolRegistryVersion: "tools-1"
      },
      observations: [],
      producerVersion: "0.3.0",
      producerGitCommit: "abc123"
    });

    expect(result.manifest.observations).toEqual([]);
    expect(result.manifest.digestAlgorithm).toBe(VISUAL_HIVE_BUNDLE_V3_DIGEST_ALGORITHM);
    expect(verifyVisualHiveBundleDigest(result.manifest)).toBe(true);
    const unmarked = structuredClone(result.manifest) as unknown as Record<string, any>;
    delete unmarked.digestAlgorithm;
    expect(verifyVisualHiveBundleDigest(unmarked)).toBe(false);
    const unsupported = structuredClone(result.manifest) as unknown as Record<string, any>;
    unsupported.digestAlgorithm = "visual-hive.bundle.publication-digest.v2";
    expect(verifyVisualHiveBundleDigest(unsupported)).toBe(false);

    const publication = structuredClone(result.manifest) as unknown as Record<string, any>;
    publication.observations = [observation({ fingerprint: "unmarked-publication" })];
    delete publication.digestAlgorithm;
    expect(verifyVisualHiveBundleDigest(publication)).toBe(false);
    const markedLegacy = structuredClone(publication);
    markedLegacy.digestAlgorithm = VISUAL_HIVE_BUNDLE_DIGEST_ALGORITHM;
    for (const item of markedLegacy.observations) {
      delete item.publicationRole;
      delete item.rootCauseKey;
      delete item.blockedByRootKeys;
    }
    expect(verifyVisualHiveBundleDigest(markedLegacy)).toBe(false);
  });

  it("normalizes unmatched derivative and aggregate references without hiding them", async () => {
    const rootDir = await makeRoot();
    await writeArtifact(rootDir, ".visual-hive/hive/beads.json", { schemaVersion: "visual-hive.hive-beads.v1", beads: [] });
    await writeDefaultObservationEvidence(rootDir);
    const derivative = observation({
      fingerprint: "visual-hive:derivative:one",
      publicationRole: "derivative",
      rootCauseKey: "mutation/api-500/localPreview/dashboard-shell",
      issueKind: "missing_visual_coverage",
      owningAgentHint: "visual-hive/test-creator"
    });
    const aggregate = observation({
      fingerprint: "visual-hive:aggregate:one",
      publicationRole: "aggregate",
      rootCauseKey: "aggregate/readiness/readiness_gate",
      blockedByRootKeys: ["test-adequacy/repository/testing-layer:2", "mutation/api-500/localPreview/dashboard-shell", "mutation/api-500/localPreview/dashboard-shell"],
      issueKind: "external_repo_onboarding"
    });
    const result = await writeVisualHiveBundle({
      rootDir,
      bundleId: "unmatched-links",
      project: "demo",
      mode: "measured",
      verdict: "ready",
      acmmRequest: 3,
      artifacts: [".visual-hive/hive/beads.json", ...DEFAULT_OBSERVATION_ARTIFACTS],
      source: source(),
      observations: [aggregate, derivative],
      producerVersion: "0.2.0",
      producerGitCommit: "abc123"
    });

    expect(result.manifest.observations.find((item) => item.publicationRole === "aggregate")?.blockedByRootKeys).toEqual([
      "mutation/api-500/localPreview/dashboard-shell",
      "test-adequacy/repository/testing-layer:2"
    ]);
    expect(result.manifest.observations.map((item) => item.fingerprint).sort()).toEqual([
      "visual-hive:aggregate:one",
      "visual-hive:derivative:one"
    ]);
    expect(verifyVisualHiveBundleDigest(result.manifest)).toBe(true);
  });

  it("rejects malformed, partial, role-incompatible, and duplicate-canonical metadata", async () => {
    const rootDir = await makeRoot();
    await writeArtifact(rootDir, ".visual-hive/hive/beads.json", { schemaVersion: "visual-hive.hive-beads.v1", beads: [] });
    const base = {
      rootDir,
      project: "demo",
      mode: "measured",
      verdict: "ready",
      acmmRequest: 3,
      artifacts: [".visual-hive/hive/beads.json"],
      source: source(),
      producerVersion: "0.2.0",
      producerGitCommit: "abc123"
    };
    const partial = observation({ fingerprint: "partial", publicationRole: "canonical" }) as unknown as Record<string, unknown>;
    delete partial.rootCauseKey;
    await expect(writeVisualHiveBundle({ ...base, bundleId: "partial", observations: [partial as never] })).rejects.toThrow("rootCauseKey");
    await expect(writeVisualHiveBundle({
      ...base,
      bundleId: "unsafe-root",
      observations: [observation({ fingerprint: "unsafe", publicationRole: "canonical", rootCauseKey: "bad root" })]
    })).rejects.toThrow("URI-safe");
    await expect(writeVisualHiveBundle({
      ...base,
      bundleId: "bad-percent-root",
      observations: [observation({ fingerprint: "bad-percent", publicationRole: "canonical", rootCauseKey: "mutation/bad%operator/target/contract" })]
    })).rejects.toThrow("URI-safe");
    await expect(writeVisualHiveBundle({
      ...base,
      bundleId: "wrong-role-kind",
      observations: [observation({ fingerprint: "wrong-kind", publicationRole: "derivative", issueKind: "mutation_survivor" })]
    })).rejects.toThrow("cannot be a derivative");
    const duplicateRoot = "mutation/api-500/localPreview/dashboard-shell";
    await expect(writeVisualHiveBundle({
      ...base,
      bundleId: "duplicate-canonical",
      observations: [
        observation({ fingerprint: "canonical-one", publicationRole: "canonical", rootCauseKey: duplicateRoot }),
        observation({ fingerprint: "canonical-two", publicationRole: "canonical", rootCauseKey: duplicateRoot })
      ]
    })).rejects.toThrow("Duplicate lifecycle observation");
  });

  it("emits a schema-valid evidence packet for every deterministic producer route", async () => {
    const rootDir = await makeRoot();
    await writeArtifact(rootDir, ".visual-hive/hive/beads.json", { schemaVersion: "visual-hive.hive-beads.v1", beads: [] });
    const schema = JSON.parse(await readFile(path.join(repoRoot, "schemas/visual-hive.bundle.schema.json"), "utf8"));
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
    const routes = VISUAL_HIVE_PRODUCER_ISSUE_KINDS.flatMap((issueKind) =>
      VISUAL_HIVE_OWNER_HINTS_BY_ISSUE_KIND[issueKind].map((owningAgentHint) => ({ issueKind, owningAgentHint }))
    );
    await writeArtifact(rootDir, ".visual-hive/issues.json", {
      schemaVersion: "visual-hive.issues.v1",
      producerRoutes: routes
    });
    await writeArtifact(rootDir, ".visual-hive/report.json", {
      schemaVersion: 2,
      status: "failed",
      results: [{ contractId: "app-shell", status: "failed", evidence: "producer route proof" }]
    });
    const artifactIndex = await prepareBundleEvidence({ rootDir, project: "producer-routing" });
    const result = await writeVisualHiveBundleV3({
      rootDir,
      bundleId: "producer-routes",
      project: "producer-routing",
      mode: "measured",
      verdict: "ready",
      acmmRequest: 3,
      artifacts: [".visual-hive/hive/beads.json", ...DEFAULT_OBSERVATION_ARTIFACTS],
      observations: routes.map((route, index) => observation({
        fingerprint: `visual-hive:producer-route:${index}`,
        rootCauseKey: `finding/${route.issueKind}/producer-route-${index}`,
        issueKind: route.issueKind,
        owningAgentHint: route.owningAgentHint
      })),
      source: source(),
      producerVersion: "0.2.0",
      producerGitCommit: "abc123"
    });

    expect(validate(result.manifest), JSON.stringify(validate.errors, null, 2)).toBe(true);
    expect(new Set(result.manifest.observations.map((item) => item.issueKind))).toEqual(new Set(VISUAL_HIVE_PRODUCER_ISSUE_KINDS));
    for (const route of routes) {
      const packet = result.manifest.observations.find((item) => item.issueKind === route.issueKind && item.owningAgentHint === route.owningAgentHint);
      expect(packet).toMatchObject({
        ...route,
        sourceArtifact: ".visual-hive/issues.json",
        sourceArtifacts: [".visual-hive/report.json"],
        affectedContracts: ["app-shell"],
        validationCommand: "npm test"
      });
    }
    for (const evidencePath of DEFAULT_OBSERVATION_ARTIFACTS) {
      const indexed = artifactIndex.artifacts.find((artifact) => artifact.path === evidencePath);
      const bundled = result.manifest.files.find((file) => file.sourcePath === evidencePath);
      expect(indexed).toBeTruthy();
      expect(bundled).toMatchObject({
        path: `files/${evidencePath}`,
        sourcePath: evidencePath,
        sha256: indexed!.sha256,
        size: indexed!.bytes
      });
      expect(await readFile(path.join(rootDir, result.bundleDir, "files", ...evidencePath.split("/"))))
        .toEqual(await readFile(path.join(rootDir, ...evidencePath.split("/"))));
    }
    expect(result.manifest.artifactIndex?.sha256).toBe(
      result.manifest.files.find((file) => file.sourcePath === ".visual-hive/artifacts-index.json")?.sha256
    );
    expect(verifyVisualHiveBundleDigest(result.manifest)).toBe(true);
    const expandedAuthority = structuredClone(result.manifest);
    expandedAuthority.observations.find((item) => item.issueKind === "workflow_safety")!.owningAgentHint = "hive/quality";
    expect(validate(expandedAuthority)).toBe(false);
    expect(verifyVisualHiveBundleDigest(expandedAuthority)).toBe(false);
  });

  it("bundles indexed repository evidence while rejecting an unindexed remediation target", async () => {
    const rootDir = await makeRoot();
    await writeArtifact(rootDir, ".visual-hive/repo-map.json", { schemaVersion: 1, project: "repo-evidence" });
    await writeArtifact(rootDir, ".visual-hive/repo-context.md", { summary: "Repository evidence" });
    await writeFile(path.join(rootDir, "visual-hive.config.yaml"), "project: repo-evidence\n", "utf8");
    await prepareBundleEvidence({ rootDir, project: "repo-evidence" });

    const base = {
      rootDir,
      project: "repo-evidence",
      mode: "measured" as const,
      verdict: "ready" as const,
      acmmRequest: 3,
      artifacts: [".visual-hive/repo-map.json", ".visual-hive/repo-context.md"],
      source: source(),
      producerVersion: "0.4.1",
      producerGitCommit: "abc123"
    };
    await expect(writeVisualHiveBundleV3({
      ...base,
      bundleId: "unindexed-remediation-target",
      artifacts: [...base.artifacts, "visual-hive.config.yaml"]
    })).rejects.toThrow("Compact bundle artifact is missing from the complete content-addressed index: visual-hive.config.yaml");

    const result = await writeVisualHiveBundleV3({ ...base, bundleId: "indexed-repo-evidence" });
    expect(result.manifest.files.map((file) => file.sourcePath)).toEqual(expect.arrayContaining(base.artifacts));
  });

  it("fails v3 closed for missing, unrequested, or tampered observation evidence", async () => {
    const base = (rootDir: string, bundleId: string, artifacts: string[]) => ({
      rootDir,
      bundleId,
      project: "producer-routing",
      mode: "measured",
      verdict: "ready",
      acmmRequest: 3,
      artifacts,
      observations: [observation({})],
      source: source(),
      producerVersion: "0.3.0",
      producerGitCommit: "abc123"
    });

    const missingRoot = await makeRoot();
    await writeArtifact(missingRoot, ".visual-hive/issues.json", { schemaVersion: "visual-hive.issues.v1", issues: [] });
    await prepareBundleEvidence({ rootDir: missingRoot, project: "producer-routing" });
    await expect(writeVisualHiveBundleV3(base(missingRoot, "missing-observation-evidence", [...DEFAULT_OBSERVATION_ARTIFACTS])))
      .rejects.toThrow("Compact bundle artifact is missing from the complete content-addressed index: .visual-hive/report.json");

    const unrequestedRoot = await makeRoot();
    await writeDefaultObservationEvidence(unrequestedRoot);
    await prepareBundleEvidence({ rootDir: unrequestedRoot, project: "producer-routing" });
    await expect(writeVisualHiveBundleV3(base(unrequestedRoot, "unrequested-observation-evidence", [".visual-hive/issues.json"])))
      .rejects.toThrow("observation evidence must be explicitly requested: .visual-hive/report.json");

    const tamperedRoot = await makeRoot();
    await writeDefaultObservationEvidence(tamperedRoot);
    await prepareBundleEvidence({ rootDir: tamperedRoot, project: "producer-routing" });
    await writeArtifact(tamperedRoot, ".visual-hive/report.json", { schemaVersion: 2, status: "tampered" });
    await expect(writeVisualHiveBundleV3(base(tamperedRoot, "tampered-observation-evidence", [...DEFAULT_OBSERVATION_ARTIFACTS])))
      .rejects.toThrow("Content-addressed artifact index is stale for .visual-hive/report.json");
  });

  it("rejects owner-hint authority expansion and unknown or unproven kinds", async () => {
    const rootDir = await makeRoot();
    await writeArtifact(rootDir, ".visual-hive/hive/beads.json", { schemaVersion: "visual-hive.hive-beads.v1", beads: [] });
    const base = {
      rootDir,
      project: "producer-routing",
      mode: "measured",
      verdict: "ready",
      acmmRequest: 3,
      artifacts: [".visual-hive/hive/beads.json"],
      source: source(),
      producerVersion: "0.2.0",
      producerGitCommit: "abc123"
    };

    await expect(writeVisualHiveBundle({
      ...base,
      bundleId: "mismatched-owner",
      observations: [observation({ issueKind: "workflow_safety", owningAgentHint: "hive/quality" })]
    })).rejects.toThrow("Unsupported Visual Hive issue kind and owner hint pair");
    await expect(writeVisualHiveBundle({
      ...base,
      bundleId: "authority-owner",
      observations: [observation({ issueKind: "mutation_survivor", owningAgentHint: "hive/architect" })]
    })).rejects.toThrow("Unsupported Visual Hive issue kind and owner hint pair");

    for (const issueKind of ["ci_failure", "security_finding", "architecture_finding", "unknown_future_kind"]) {
      await expect(writeVisualHiveBundle({
        ...base,
        bundleId: `unproven-${issueKind}`,
        observations: [observation({ issueKind, owningAgentHint: "hive/ci" })]
      })).rejects.toThrow("Unknown lifecycle observation issue kind");
    }

    await expect(writeVisualHiveBundle({
      ...base,
      bundleId: "missing-evidence",
      observations: [observation({ sourceArtifacts: [] })]
    })).rejects.toThrow("requires at least one evidence artifact");
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

  it("binds immutable workflow identity, run attempt, index, and capability receipt into v3 verification", async () => {
    const rootDir = await makeRoot();
    await writeArtifact(rootDir, ".visual-hive/hive/beads.json", { schemaVersion: "visual-hive.hive-beads.v1", beads: [] });
    const result = await writeVisualHiveBundle({
      rootDir,
      bundleId: "identity-binding",
      project: "demo",
      mode: "measured",
      verdict: "ready",
      acmmRequest: 3,
      artifacts: [".visual-hive/hive/beads.json"],
      source: source(),
      observations: [],
      producerVersion: "0.3.0",
      producerGitCommit: "abc123",
      now: new Date("2026-07-09T12:00:00.000Z")
    });

    for (const mutate of [
      (manifest: typeof result.manifest) => { manifest.generatedAt = "2026-07-09T12:00:01.000Z"; },
      (manifest: typeof result.manifest) => { manifest.expiresAt = "2026-07-16T12:00:01.000Z"; },
      (manifest: typeof result.manifest) => { manifest.source.workflowRunAttempt = "3"; },
      (manifest: typeof result.manifest) => { manifest.source.workflowArtifactId = "9002"; },
      (manifest: typeof result.manifest) => { manifest.artifactIndex!.artifactCount += 1; },
      (manifest: typeof result.manifest) => { manifest.capabilityParity!.summary.present += 1; }
    ]) {
      const tampered = structuredClone(result.manifest);
      mutate(tampered);
      expect(verifyVisualHiveBundleDigest(tampered)).toBe(false);
    }
    const nonCanonicalTimestamp = structuredClone(result.manifest);
    nonCanonicalTimestamp.generatedAt = "2026-07-09T12:00:00Z";
    expect(verifyVisualHiveBundleDigest(nonCanonicalTimestamp)).toBe(false);
    const nonIncreasingExpiry = structuredClone(result.manifest);
    nonIncreasingExpiry.expiresAt = nonIncreasingExpiry.generatedAt;
    expect(verifyVisualHiveBundleDigest(nonIncreasingExpiry)).toBe(false);
  });

  it("fails closed before publication for missing provenance, failed parity, incomplete indexes, and unindexed compact files", async () => {
    const base = {
      project: "demo",
      mode: "measured",
      verdict: "ready",
      acmmRequest: 3,
      source: source(),
      observations: [],
      producerVersion: "0.3.0",
      producerGitCommit: "abc123"
    };

    const missingIdentityRoot = await makeRoot();
    await writeArtifact(missingIdentityRoot, ".visual-hive/evidence.json", { status: "ready" });
    await prepareBundleEvidence({ rootDir: missingIdentityRoot, project: "demo" });
    await expect(writeVisualHiveBundleV3({
      ...base,
      rootDir: missingIdentityRoot,
      bundleId: "missing-identity",
      artifacts: [".visual-hive/evidence.json"],
      source: { ...source(), workflowArtifactId: undefined }
    })).rejects.toThrow("immutable workflow artifact ID");
    await expect(readFile(path.join(missingIdentityRoot, ".visual-hive/bundles/missing-identity/manifest.json"))).rejects.toThrow();

    const failedParityRoot = await makeRoot();
    await writeArtifact(failedParityRoot, ".visual-hive/evidence.json", { status: "ready" });
    const failedReceipt = capabilityParityReceipt();
    failedReceipt.status = "failed";
    failedReceipt.summary = { expected: 1, actual: 0, present: 0, blocked: 0, missing: 1, unexpected: 0, mismatched: 0 };
    failedReceipt.domains = capabilityDomainSummaries("cli", { expected: 1, actual: 0, present: 0, blocked: 0, missing: 1, unexpected: 0, mismatched: 0 });
    failedReceipt.checks = [{ domain: "cli", key: "doctor", status: "missing", parity: false, message: "CLI capability is missing." }];
    await prepareBundleEvidence({ rootDir: failedParityRoot, project: "demo" }, failedReceipt);
    await expect(writeVisualHiveBundleV3({
      ...base,
      rootDir: failedParityRoot,
      bundleId: "failed-parity",
      artifacts: [".visual-hive/evidence.json"]
    })).rejects.toThrow("capability parity failed");

    const incompleteRoot = await makeRoot();
    await writeArtifact(incompleteRoot, ".visual-hive/evidence.json", { status: "ready" });
    const incomplete = await prepareBundleEvidence({ rootDir: incompleteRoot, project: "demo" });
    await writeArtifact(incompleteRoot, ".visual-hive/artifacts-index.json", { ...incomplete, complete: false });
    await expect(writeVisualHiveBundleV3({
      ...base,
      rootDir: incompleteRoot,
      bundleId: "incomplete-index",
      artifacts: [".visual-hive/evidence.json"]
    })).rejects.toThrow("complete content-addressed artifact index");

    const unindexedRoot = await makeRoot();
    await prepareBundleEvidence({ rootDir: unindexedRoot, project: "demo" });
    await writeArtifact(unindexedRoot, ".visual-hive/late-evidence.json", { status: "ready" });
    await expect(writeVisualHiveBundleV3({
      ...base,
      rootDir: unindexedRoot,
      bundleId: "unindexed-file",
      artifacts: []
    })).rejects.toThrow("omits on-disk artifact");
  });

  it("allows explicit blocked runtime lanes when capability parity still passes", async () => {
    const rootDir = await makeRoot();
    await writeArtifact(rootDir, ".visual-hive/evidence.json", { status: "ready" });
    const blockedReceipt = capabilityParityReceipt();
    blockedReceipt.runtimeStatus = "blocked";
    blockedReceipt.summary = { expected: 1, actual: 1, present: 0, blocked: 1, missing: 0, unexpected: 0, mismatched: 0 };
    blockedReceipt.domains = capabilityDomainSummaries("providers", { expected: 1, actual: 1, present: 0, blocked: 1, missing: 0, unexpected: 0, mismatched: 0 });
    blockedReceipt.checks = [{ domain: "providers", key: "external", status: "blocked", parity: true, message: "External lane is explicitly blocked." }];
    await prepareBundleEvidence({ rootDir, project: "demo" }, blockedReceipt);
    const result = await writeVisualHiveBundleV3({
      rootDir,
      bundleId: "blocked-runtime",
      project: "demo",
      mode: "measured",
      verdict: "ready",
      acmmRequest: 3,
      artifacts: [".visual-hive/evidence.json"],
      source: source(),
      observations: [],
      producerVersion: "0.3.0",
      producerGitCommit: "abc123"
    });
    expect(result.manifest.capabilityParity?.runtimeStatus).toBe("blocked");
    expect(verifyVisualHiveBundleDigest(result.manifest)).toBe(true);
  });
});

async function makeRoot(): Promise<string> {
  const root = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(path.join(os.tmpdir(), "visual-hive-bundle-")));
  temporaryRoots.push(root);
  return root;
}

async function writeVisualHiveBundle(options: WriteVisualHiveBundleOptions) {
  await prepareBundleEvidence(options);
  return writeVisualHiveBundleV3(options);
}

async function prepareBundleEvidence(options: Pick<WriteVisualHiveBundleOptions, "rootDir" | "project" | "now">, receipt = capabilityParityReceipt()) {
  await writeArtifact(options.rootDir, ".visual-hive/capability-parity.json", receipt);
  const artifactIndex = await indexArtifacts({
    repoRoot: options.rootDir,
    project: options.project,
    complete: true,
    now: options.now ?? new Date("2026-07-09T12:00:00.000Z")
  });
  await writeArtifact(options.rootDir, ".visual-hive/artifacts-index.json", artifactIndex);
  return artifactIndex;
}

function capabilityParityReceipt() {
  return {
    schemaVersion: "visual-hive.capability-parity.v1",
    baselineVersion: "visual-hive.capability-baseline.v1",
    generatedAt: "2026-07-09T12:00:00.000Z",
    status: "passed",
    runtimeStatus: "ready",
    summary: { expected: 1, actual: 1, present: 1, blocked: 0, missing: 0, unexpected: 0, mismatched: 0 },
    domains: capabilityDomainSummaries("cli", { expected: 1, actual: 1, present: 1, blocked: 0, missing: 0, unexpected: 0, mismatched: 0 }),
    checks: [{ domain: "cli", key: "doctor", status: "present", parity: true, message: "CLI capability is present." }]
  };
}

function capabilityDomainSummaries(activeDomain: string, counts: { expected: number; actual: number; present: number; blocked: number; missing: number; unexpected: number; mismatched: number }) {
  return ["cli", "schemas", "evidenceResources", "artifactSurfaces", "planModes", "workflowLanes", "mutationOperators", "deterministicPrimitives", "providers", "openSourceAdapters", "controlPlane"].map((domain) => ({
    domain,
    expected: domain === activeDomain ? counts.expected : 0,
    actual: domain === activeDomain ? counts.actual : 0,
    present: domain === activeDomain ? counts.present : 0,
    blocked: domain === activeDomain ? counts.blocked : 0,
    missing: domain === activeDomain ? counts.missing : 0,
    unexpected: domain === activeDomain ? counts.unexpected : 0,
    mismatched: domain === activeDomain ? counts.mismatched : 0
  }));
}

async function writeArtifact(root: string, relative: string, value: unknown): Promise<void> {
  const target = path.join(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value)}\n`, "utf8");
}

async function writeDefaultObservationEvidence(root: string): Promise<void> {
  await writeArtifact(root, ".visual-hive/issues.json", { schemaVersion: "visual-hive.issues.v1", issues: [] });
  await writeArtifact(root, ".visual-hive/report.json", { schemaVersion: 2, status: "failed", results: [] });
}

function source() {
  return {
    repository: "owner/repo",
    ref: "refs/heads/main",
    commitSha: "abc123",
    event: "workflow_dispatch",
    workflowRunId: "1001",
    workflowRunAttempt: "2",
    workflowArtifactId: "9001",
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
    publicationRole: "canonical" as const,
    rootCauseKey: "finding/visual_regression/app-shell",
    blockedByRootKeys: [],
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

function observation(overrides: Record<string, unknown>) {
  const fingerprint = String(overrides.fingerprint ?? "visual-hive:test:observation");
  const publicationRole = String(overrides.publicationRole ?? "canonical");
  const rootCauseKey = String(overrides.rootCauseKey ?? "finding/visual_regression/app-shell");
  const repositoryIdentity = publicationRole === "canonical" ? rootCauseKey : fingerprint;
  return {
    fingerprint,
    repositoryFingerprint: sha256(`owner/repo\0${repositoryIdentity}`),
    publicationRole,
    rootCauseKey,
    blockedByRootKeys: [],
    state: "present",
    issueKind: "visual_regression",
    severity: "high",
    owningAgentHint: "hive/quality",
    title: "Evidence observation",
    body: "Evidence-backed observation",
    labels: ["visual-hive"],
    sourceArtifacts: [".visual-hive/report.json"],
    affectedContracts: ["app-shell"],
    validationCommand: "npm test",
    observedAt: "2026-07-09T12:00:00.000Z",
    firstSeenAt: "2026-07-09T12:00:00.000Z",
    sourceArtifact: ".visual-hive/issues.json",
    ...overrides
  } as any;
}

function legacyDigest(manifest: Record<string, any>): string {
  const fileLines = manifest.files.map((file: Record<string, any>) => `file\0${file.path}\0${file.sha256}\0${file.size}`).sort();
  const observationLines = manifest.observations.map((item: Record<string, any>) => [
    "observation",
    item.repositoryFingerprint,
    item.fingerprint,
    item.state,
    item.issueKind,
    item.severity,
    item.owningAgentHint,
    item.title,
    item.body,
    item.labels.join(","),
    item.sourceArtifacts.join(","),
    item.affectedContracts.join(","),
    item.validationCommand,
    item.observedAt,
    item.firstSeenAt,
    item.sourceArtifact
  ].join("\0")).sort();
  const scanLine = ["scan", manifest.scan.scope, String(manifest.scan.authoritativeForResolution), manifest.scan.evaluatedContracts.join(","), manifest.scan.evaluatedFiles.join(","), manifest.scan.testPlanVersion, manifest.scan.toolRegistryVersion].join("\0");
  const sourceLine = ["source", manifest.source.repository, manifest.source.repositoryId ?? "", manifest.source.ref, manifest.source.commitSha, manifest.source.workflowRunId ?? "", manifest.source.workflowArtifactId ?? "", manifest.source.conclusion].join("\0");
  const metadataLine = ["metadata", manifest.project, manifest.mode, manifest.verdict, String(manifest.acmmRequest), String(manifest.externalCallsMade), manifest.producer.name, manifest.producer.version, manifest.producer.gitCommit].join("\0");
  return sha256([...fileLines, ...observationLines, scanLine, sourceLine, metadataLine, `replay\0${manifest.replayProtection.key}`].join("\n"));
}

function publicationDigestV2(manifest: Record<string, any>): string {
  const fileRecords = manifest.files.map((file: Record<string, any>) => testRecord("file", [
    testScalar("path", file.path),
    testScalar("sha256", file.sha256),
    testScalar("size", String(file.size))
  ])).sort(Buffer.compare);
  const observationRecords = manifest.observations.map((item: Record<string, any>) => testRecord("observation", [
    testScalar("repositoryFingerprint", item.repositoryFingerprint),
    testScalar("fingerprint", item.fingerprint),
    testScalar("publicationRole", item.publicationRole),
    testScalar("rootCauseKey", item.rootCauseKey),
    testArray("blockedByRootKeys", item.blockedByRootKeys),
    testScalar("state", item.state),
    testScalar("issueKind", item.issueKind),
    testScalar("severity", item.severity),
    testScalar("owningAgentHint", item.owningAgentHint),
    testScalar("title", item.title),
    testScalar("body", item.body),
    testArray("labels", item.labels),
    testArray("sourceArtifacts", item.sourceArtifacts),
    testArray("affectedContracts", item.affectedContracts),
    testScalar("validationCommand", item.validationCommand),
    testScalar("observedAt", item.observedAt),
    testScalar("firstSeenAt", item.firstSeenAt),
    testScalar("sourceArtifact", item.sourceArtifact)
  ])).sort(Buffer.compare);
  return sha256(Buffer.concat([
    Buffer.from(VISUAL_HIVE_BUNDLE_DIGEST_ALGORITHM, "utf8"),
    testCollection("files", fileRecords),
    testCollection("observations", observationRecords),
    testRecord("scan", [
      testScalar("scope", manifest.scan.scope),
      testScalar("authoritativeForResolution", String(manifest.scan.authoritativeForResolution)),
      testArray("evaluatedContracts", manifest.scan.evaluatedContracts),
      testArray("evaluatedFiles", manifest.scan.evaluatedFiles),
      testScalar("testPlanVersion", manifest.scan.testPlanVersion),
      testScalar("toolRegistryVersion", manifest.scan.toolRegistryVersion)
    ]),
    testRecord("source", [
      testScalar("repository", manifest.source.repository),
      testScalar("repositoryId", manifest.source.repositoryId ?? ""),
      testScalar("ref", manifest.source.ref),
      testScalar("commitSha", manifest.source.commitSha),
      testScalar("workflowRunId", manifest.source.workflowRunId ?? ""),
      testScalar("workflowArtifactId", manifest.source.workflowArtifactId ?? ""),
      testScalar("conclusion", manifest.source.conclusion)
    ]),
    testRecord("metadata", [
      testScalar("project", manifest.project),
      testScalar("mode", manifest.mode),
      testScalar("verdict", manifest.verdict),
      testScalar("acmmRequest", String(manifest.acmmRequest)),
      testScalar("externalCallsMade", String(manifest.externalCallsMade)),
      testScalar("producerName", manifest.producer.name),
      testScalar("producerVersion", manifest.producer.version),
      testScalar("producerGitCommit", manifest.producer.gitCommit)
    ]),
    testRecord("replay", [testScalar("key", manifest.replayProtection.key)])
  ]));
}

type TestDigestField = { kind: "scalar" | "array"; name: string; value: string | string[] };

function testScalar(name: string, value: string): TestDigestField {
  return { kind: "scalar", name, value };
}

function testArray(name: string, value: string[]): TestDigestField {
  return { kind: "array", name, value };
}

function testRecord(domain: string, fields: TestDigestField[]): Buffer {
  const chunks: Buffer[] = [Buffer.from("R"), testLength(domain)];
  for (const field of fields) {
    if (field.kind === "scalar") chunks.push(Buffer.from("S"), testLength(field.name), testLength(field.value as string));
    else {
      const values = field.value as string[];
      chunks.push(Buffer.from("A"), testLength(field.name), testLength(String(values.length)));
      for (const value of values) chunks.push(Buffer.from("E"), testLength(value));
    }
  }
  chunks.push(Buffer.from("Z"));
  return Buffer.concat(chunks);
}

function testCollection(domain: string, records: Buffer[]): Buffer {
  const chunks: Buffer[] = [Buffer.from("C"), testLength(domain), testLength(String(records.length))];
  for (const record of records) chunks.push(Buffer.from("I"), testLength(record));
  return Buffer.concat(chunks);
}

function testLength(value: string | Buffer): Buffer {
  const data = typeof value === "string" ? Buffer.from(value, "utf8") : value;
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(data.byteLength);
  return Buffer.concat([length, data]);
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
