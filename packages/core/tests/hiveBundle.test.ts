import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { afterEach, describe, expect, it } from "vitest";
import {
  VISUAL_HIVE_BUNDLE_DIGEST_ALGORITHM,
  verifyVisualHiveBundleDigest,
  writeVisualHiveBundle
} from "../src/hive/bundle.js";

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
    expect(result.manifest.digestAlgorithm).toBe(VISUAL_HIVE_BUNDLE_DIGEST_ALGORITHM);
    expect(result.manifest.files[0]).toMatchObject({
      path: "files/.visual-hive/hive/beads.json",
      sourcePath: ".visual-hive/hive/beads.json",
      schemaVersion: "visual-hive.hive-beads.v1"
    });
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

  it("binds publication metadata into the digest while retaining legacy v2 verification", async () => {
    const rootDir = await makeRoot();
    await writeArtifact(rootDir, ".visual-hive/hive/beads.json", { schemaVersion: "visual-hive.hive-beads.v1", beads: [] });
    const result = await writeVisualHiveBundle({
      rootDir,
      bundleId: "publication-digest",
      project: "demo",
      mode: "measured",
      verdict: "ready",
      acmmRequest: 3,
      artifacts: [".visual-hive/hive/beads.json"],
      source: source(),
      issues: [issue("open_candidate")],
      producerVersion: "0.2.0",
      producerGitCommit: "abc123"
    });

    const tampered = structuredClone(result.manifest);
    tampered.observations[0]!.rootCauseKey = "finding/visual_regression/other-shell";
    expect(verifyVisualHiveBundleDigest(tampered)).toBe(false);

    const legacy = structuredClone(result.manifest) as unknown as Record<string, any>;
    delete legacy.digestAlgorithm;
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
    expect(validate(legacy), JSON.stringify(validate.errors, null, 2)).toBe(true);
    const unsupported = structuredClone(result.manifest) as unknown as Record<string, any>;
    unsupported.digestAlgorithm = "visual-hive.bundle.publication-digest.v2";
    expect(validate(unsupported)).toBe(false);
  });

  it("uses length-prefixed array boundaries for publication, evidence, and scan metadata", async () => {
    const rootDir = await makeRoot();
    await writeArtifact(rootDir, ".visual-hive/hive/beads.json", { schemaVersion: "visual-hive.hive-beads.v1", beads: [] });
    const result = await writeVisualHiveBundle({
      rootDir,
      bundleId: "array-boundaries",
      project: "demo",
      mode: "measured",
      verdict: "ready",
      acmmRequest: 3,
      artifacts: [".visual-hive/hive/beads.json"],
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
        sourceArtifacts: ["a", "b,c"],
        affectedContracts: ["a", "b,c"]
      })],
      producerVersion: "0.3.0",
      producerGitCommit: "abc123"
    });

    expect(verifyVisualHiveBundleDigest(result.manifest)).toBe(true);
    const collisionMutations: Array<(manifest: typeof result.manifest) => void> = [
      (manifest) => { manifest.observations[0]!.blockedByRootKeys = ["a,b", "c"]; },
      (manifest) => { manifest.observations[0]!.labels = ["a,b", "c"]; },
      (manifest) => { manifest.observations[0]!.sourceArtifacts = ["a,b", "c"]; },
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
    await writeArtifact(rootDir, ".visual-hive/hive/beads.json", { schemaVersion: "visual-hive.hive-beads.v1", beads: [] });
    const result = await writeVisualHiveBundle({
      rootDir,
      bundleId: "unicode-vector",
      project: "unicode",
      mode: "full",
      verdict: "ready",
      acmmRequest: 4,
      artifacts: [".visual-hive/hive/beads.json"],
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
        sourceArtifacts: [`evidence/${astral}.json`, `evidence/${privateUse}.json`],
        affectedContracts: [astral, privateUse]
      })],
      producerVersion: "0.3.0",
      producerGitCommit: "unicode",
      externalCallsMade: 0
    });

    expect(result.manifest.scan.evaluatedContracts).toEqual([privateUse, astral]);
    expect(result.manifest.scan.evaluatedFiles).toEqual([`src/${privateUse}.ts`, `src/${astral}.ts`]);
    expect(result.manifest.observations[0]?.labels).toEqual([privateUse, astral]);
    expect(result.manifest.observations[0]?.sourceArtifacts).toEqual([`evidence/${privateUse}.json`, `evidence/${astral}.json`]);
    expect(result.manifest.observations[0]?.affectedContracts).toEqual([privateUse, astral]);
    expect(result.manifest.overallDigest).toBe("289d4b4a672d4b6b32c6f7fc6c970070f40f7afff3151411a47e982e447950d7");
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
    expect(result.manifest.digestAlgorithm).toBe(VISUAL_HIVE_BUNDLE_DIGEST_ALGORITHM);
    expect(result.manifest.overallDigest).toBe("8831ed6c7209ebe1b6e7dfb845b3ed9a1df1cbc8d72fd839339fb3140ee1bf32");
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
    const derivative = observation({
      fingerprint: "visual-hive:derivative:one",
      publicationRole: "derivative",
      rootCauseKey: "mutation/api-500/localPreview/dashboard-shell",
      issueKind: "missing_visual_coverage"
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
      artifacts: [".visual-hive/hive/beads.json"],
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

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
