import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import {
  buildVisualHiveTaskContext,
  canonicalJson,
  canonicalSha256,
  computeVisualRepositoryFingerprint,
  computeVisualValidationProfileDigest,
  parseVisualHiveTaskContext,
  parseVisualRepairValidation,
  sha256Utf8,
  type VisualHiveTaskContextInput,
  type VisualRepairValidationInput
} from "../src/index.js";
import { buildVisualRepairValidation } from "../src/repair/build.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const sha = (character: string): string => character.repeat(64);
const commit = (character: string): string => character.repeat(40);

describe("canonical Visual Hive repair JSON", () => {
  it("is invariant to object insertion order and normalizes negative zero", () => {
    expect(canonicalJson({ zebra: -0, alpha: { beta: 2, alpha: 1 } })).toBe(canonicalJson({ alpha: { alpha: 1, beta: 2 }, zebra: 0 }));
  });

  it("rejects undefined, non-finite numbers, accessors, symbols, and lone surrogates", () => {
    expect(() => canonicalJson({ value: undefined })).toThrow("undefined");
    expect(() => canonicalJson({ value: Number.POSITIVE_INFINITY })).toThrow("non-finite");
    expect(() => canonicalJson({ get value() { return 1; } })).toThrow("accessor");
    expect(() => canonicalJson({ [Symbol("hidden")]: "value" })).toThrow("symbol");
    expect(() => canonicalJson({ value: "\ud800" })).toThrow("surrogate");
  });

  it("preserves an enumerable __proto__ data property", () => {
    const value = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(value, "__proto__", { configurable: true, enumerable: true, value: "bound", writable: true });
    expect(canonicalJson(value)).toBe("{\"__proto__\":\"bound\"}");
  });
});

describe("visual-hive.task-context.v1", () => {
  it("builds a deterministic, content-addressed, no-gold context", () => {
    const first = buildVisualHiveTaskContext(taskInput());
    const reorderedInput = taskInput();
    reorderedInput.profiles[0]!.contractIds = ["contract.secondary", "contract.card"];
    reorderedInput.profiles[0]!.requestKinds = ["patch_validation", "capture"];
    reorderedInput.sourceContext.files.reverse();
    const second = buildVisualHiveTaskContext(reorderedInput);

    expect(first.contextDigest).toBe(second.contextDigest);
    expect(first.safety).toEqual({
      containsGoldPatch: false,
      containsTestPatch: false,
      containsGraderTests: false,
      externalCallsMade: 0,
      networkCallsMade: 0,
      writesMade: 0
    });
    expect(parseVisualHiveTaskContext(first)).toEqual(first);
  });

  it("preserves original image order in the context identity", () => {
    const firstInput = taskInput();
    const secondInput = taskInput();
    secondInput.imageReferences = secondInput.imageReferences.map((reference) => ({ ...reference, position: reference.position === 0 ? 1 : 0 }));
    expect(buildVisualHiveTaskContext(firstInput).contextDigest).not.toBe(buildVisualHiveTaskContext(secondInput).contextDigest);
  });

  it("rejects mismatched content and relationship identities", () => {
    const problemMismatch = taskInput();
    problemMismatch.issue.problemStatementSha256 = sha("f");
    expect(() => buildVisualHiveTaskContext(problemMismatch)).toThrow("problem statement digest mismatch");

    const repositoryMismatch = taskInput();
    repositoryMismatch.repository.repositoryFingerprint = sha("f");
    expect(() => buildVisualHiveTaskContext(repositoryMismatch)).toThrow("repository fingerprint mismatch");

    const profileMismatch = taskInput();
    profileMismatch.profiles[0]!.profileDigest = sha("f");
    expect(() => buildVisualHiveTaskContext(profileMismatch)).toThrow("profile digest mismatch");

    const sourceMismatch = taskInput();
    sourceMismatch.sourceContext.digest = sha("f");
    expect(() => buildVisualHiveTaskContext(sourceMismatch)).toThrow("source context digest mismatch");

    const roleMismatch = taskInput();
    roleMismatch.imageReferences[0]!.role = "actual";
    expect(() => buildVisualHiveTaskContext(roleMismatch)).toThrow("role does not match");

    const unknownContract = taskInput();
    unknownContract.obligations[0]!.mappedContractIds = ["contract.unknown"];
    expect(() => buildVisualHiveTaskContext(unknownContract)).toThrow("undeclared contract");

    const unknownViewport = taskInput();
    unknownViewport.obligations[0]!.viewportId = "viewport.unknown";
    expect(() => buildVisualHiveTaskContext(unknownViewport)).toThrow("undeclared viewport");
  });

  it("rejects ambiguous assets and unsafe cross-platform paths", () => {
    const duplicatePath = taskInput();
    duplicatePath.assets[1]!.path = duplicatePath.assets[0]!.path;
    expect(() => buildVisualHiveTaskContext(duplicatePath)).toThrow("Duplicate");

    const duplicateDigest = taskInput();
    duplicateDigest.assets[1]!.sha256 = duplicateDigest.assets[0]!.sha256;
    expect(() => buildVisualHiveTaskContext(duplicateDigest)).toThrow("Duplicate");

    for (const unsafePath of ["../secret.png", "evidence\\secret.png", "evidence/secret.txt:stream", "evidence/bad\nname.png", "evidence/CON.png", ".git/objects/secret"]) {
      const input = taskInput();
      input.assets[0]!.path = unsafePath;
      expect(() => buildVisualHiveTaskContext(input), unsafePath).toThrow();
    }

    const unsafeSource = taskInput();
    unsafeSource.sourceContext.files[0]!.path = ".git/config";
    unsafeSource.sourceContext.digest = sourceDigest(unsafeSource.sourceContext);
    expect(() => buildVisualHiveTaskContext(unsafeSource)).toThrow();
  });

  it("requires coherent image dimensions and bounded regions", () => {
    const missingHeight = taskInput();
    delete missingHeight.assets[0]!.height;
    expect(() => buildVisualHiveTaskContext(missingHeight)).toThrow("width and height");

    const outside = taskInput();
    outside.assets[0]!.regions = [{ regionId: "region.card", x: 1200, y: 0, width: 100, height: 10 }];
    expect(() => buildVisualHiveTaskContext(outside)).toThrow("image bounds");
  });

  it("rejects a self-digested but noncanonical representation", () => {
    const built = buildVisualHiveTaskContext(taskInput());
    const { contextDigest: _digest, ...content } = structuredClone(built);
    void _digest;
    content.sourceContext.files.reverse();
    expect(() => parseVisualHiveTaskContext({ ...content, contextDigest: canonicalSha256(content) })).toThrow("canonical normalized form");
  });
});

describe("visual-hive.repair-validation.v1", () => {
  it("derives pass only from comparable deterministic evidence", () => {
    const receipt = buildVisualRepairValidation(validationInput());
    expect(receipt.comparability.status).toBe("comparable");
    expect(receipt.verdict).toBe("pass");
    expect(receipt.closureRecommendation).toBe("resolved_candidate");
    expect(parseVisualRepairValidation(receipt)).toEqual(receipt);
  });

  it("records all twelve comparability differences and blocks closure", () => {
    const input = validationInput();
    input.after.profileId = "profile.other";
    input.after.profileDigest = sha("d");
    input.after.validationPolicyDigest = sha("e");
    input.after.contractInventoryDigest = sha("f");
    input.after.planDigest = sha("0");
    input.after.testPlanDigest = sha("7");
    input.after.toolRegistryDigest = sha("8");
    input.after.baselineIdentityDigest = sha("9");
    input.after.executionMatrixDigest = sha("a");
    input.after.browser = { name: "firefox", version: "128" };
    input.after.environment = { ...input.after.environment, os: "linux" };
    input.after.cases = [{
      caseId: "case.other",
      targetId: "target.other",
      route: "/other",
      state: "expanded",
      viewport: { viewportId: "viewport.other", width: 1024, height: 768, deviceScaleFactor: 1 },
      contractIds: ["contract.other"]
    }];
    input.lanes.targeted.profileId = "profile.other";
    input.lanes.regression.profileId = "profile.other";

    const receipt = buildVisualRepairValidation(input);
    expect(receipt.comparability.status).toBe("non_comparable");
    expect(receipt.comparability.differences).toHaveLength(12);
    expect(receipt.verdict).toBe("blocked");
    expect(receipt.closureRecommendation).toBe("keep_open");
  });

  it("fails closed for missing evidence, lane gaps, mutation incoherence, and same-head validation", () => {
    const noEvidence = validationInput();
    noEvidence.obligations[0]!.evidenceAssetIds = [];
    expect(() => buildVisualRepairValidation(noEvidence)).toThrow("requires evidence");

    const noContracts = validationInput();
    noContracts.lanes.targeted.evaluatedContractIds = [];
    expect(() => buildVisualRepairValidation(noContracts)).toThrow();

    const passingFailures = validationInput();
    passingFailures.lanes.regression.failures = ["unexpected failure"];
    expect(() => buildVisualRepairValidation(passingFailures)).toThrow("passed lane");

    const survivor = validationInput();
    survivor.lanes.mutation = { status: "passed", killed: 1, survived: 1, operatorIds: ["mutation.card"] };
    expect(() => buildVisualRepairValidation(survivor)).toThrow("cannot contain survivors");

    const unnecessaryMutation = validationInput();
    unnecessaryMutation.lanes.mutation = { status: "not_required", killed: 1, survived: 0, operatorIds: ["mutation.card"] };
    expect(() => buildVisualRepairValidation(unnecessaryMutation)).toThrow("not-required");

    const sameHead = validationInput();
    sameHead.headSha = sameHead.baseSha;
    sameHead.after.commitSha = sameHead.baseSha;
    expect(() => buildVisualRepairValidation(sameHead)).toThrow("distinct");
  });

  it("blocks skipped, non-authoritative, unevaluated, or policy-changing validation", () => {
    const skipped = validationInput();
    skipped.lanes.targeted = { profileId: "profile.repair", status: "skipped", evaluatedContractIds: [], failures: ["capture unavailable"] };
    expect(buildVisualRepairValidation(skipped).verdict).toBe("blocked");

    const nonAuthoritative = validationInput();
    nonAuthoritative.authoritativeForResolution = false;
    expect(buildVisualRepairValidation(nonAuthoritative).verdict).toBe("blocked");

    const notEvaluated = validationInput();
    notEvaluated.findingStatus = "not_evaluated";
    expect(buildVisualRepairValidation(notEvaluated).verdict).toBe("blocked");

    const policy = validationInput();
    policy.policyChanges.thresholdWeakened = true;
    expect(buildVisualRepairValidation(policy).verdict).toBe("blocked");

    const configOnly = validationInput();
    configOnly.policyChanges.configChanged = true;
    expect(buildVisualRepairValidation(configOnly).verdict).toBe("pass");
  });

  it("fails when the finding remains or deterministic failures are introduced", () => {
    const present = validationInput();
    present.findingStatus = "present";
    expect(buildVisualRepairValidation(present).verdict).toBe("fail");

    const regression = validationInput();
    regression.newFailures = [{ id: "finding.new", severity: "critical", message: "New deterministic regression" }];
    expect(buildVisualRepairValidation(regression).verdict).toBe("fail");
  });

  it("validates screenshot arithmetic, identity, and canonical ordering", () => {
    const arithmetic = validationInput();
    arithmetic.screenshotTriplets[0]!.diffPixels = 2;
    expect(() => buildVisualRepairValidation(arithmetic)).toThrow("diffRatio");

    const overflow = validationInput();
    overflow.screenshotTriplets[0]!.diffPixels = 101;
    overflow.screenshotTriplets[0]!.diffRatio = 1;
    expect(() => buildVisualRepairValidation(overflow)).toThrow("totalPixels");

    const sameAsset = validationInput();
    sameAsset.screenshotTriplets[0]!.afterAssetId = sameAsset.screenshotTriplets[0]!.beforeAssetId;
    expect(() => buildVisualRepairValidation(sameAsset)).toThrow("must be distinct");

    const first = validationInput();
    first.screenshotTriplets.push({ obligationId: "obligation.card", beforeAssetId: "before.second", afterAssetId: "after.second", diffPixels: 0, totalPixels: 100, diffRatio: 0 });
    const second = structuredClone(first);
    second.screenshotTriplets.reverse();
    expect(buildVisualRepairValidation(first).receiptDigest).toBe(buildVisualRepairValidation(second).receiptDigest);
  });

  it("rejects wrong commit/profile bindings and receipt tampering", () => {
    const wrongHead = validationInput();
    wrongHead.after.commitSha = commit("9");
    expect(() => buildVisualRepairValidation(wrongHead)).toThrow("repair head SHA");

    const wrongProfile = validationInput();
    wrongProfile.lanes.targeted.profileId = "profile.other";
    expect(() => buildVisualRepairValidation(wrongProfile)).toThrow("profile must match");

    const receipt = buildVisualRepairValidation(validationInput());
    expect(() => parseVisualRepairValidation({ ...receipt, receiptDigest: sha("f") })).toThrow("digest mismatch");

    const forged = { ...receipt, verdict: "fail" as const, closureRecommendation: "keep_open" as const };
    const { receiptDigest: _receiptDigest, ...forgedContent } = forged;
    void _receiptDigest;
    expect(() => parseVisualRepairValidation({ ...forgedContent, receiptDigest: canonicalSha256(forgedContent) })).toThrow("derived verdict");
  });
});

describe("repair contract JSON Schemas", () => {
  it("accepts runtime-built artifacts and rejects unknown fields", async () => {
    const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
    const taskSchema = JSON.parse(await readFile(path.join(repoRoot, "schemas/visual-hive.task-context.schema.json"), "utf8"));
    const validationSchema = JSON.parse(await readFile(path.join(repoRoot, "schemas/visual-hive.repair-validation.schema.json"), "utf8"));
    const validateTask = ajv.compile(taskSchema);
    const validateReceipt = ajv.compile(validationSchema);
    const task = buildVisualHiveTaskContext(taskInput());
    const receipt = buildVisualRepairValidation(validationInput());
    expect(validateTask(task), JSON.stringify(validateTask.errors, null, 2)).toBe(true);
    expect(validateReceipt(receipt), JSON.stringify(validateReceipt.errors, null, 2)).toBe(true);
    expect(validateTask({ ...task, unexpected: true })).toBe(false);
    expect(validateReceipt({ ...receipt, unexpected: true })).toBe(false);
  });
});

function taskInput(): VisualHiveTaskContextInput {
  const profileBody = {
    profileId: "profile.repair",
    targetId: "target.app",
    requestKinds: ["capture", "patch_validation"] as Array<"capture" | "patch_validation">,
    contractIds: ["contract.card", "contract.secondary"],
    routes: ["/"],
    scenarioIds: ["scenario.default"],
    viewports: [{ viewportId: "viewport.desktop", width: 1280, height: 720, deviceScaleFactor: 1 }],
    validationCommandId: "command.playwright"
  };
  const files = [
    { path: "src/App.tsx", sha256: sha("8"), size: 200, classification: "source" as const },
    { path: "tests/app.spec.ts", sha256: sha("9"), size: 400, classification: "test" as const }
  ];
  return {
    schemaVersion: "visual-hive.task-context.v1",
    digestAlgorithm: "visual-hive.canonical-json.sha256.v1",
    generatedAt: "2026-07-14T12:00:00.000Z",
    taskId: "task.card-layout",
    repository: {
      name: "owner/repo",
      repositoryId: "42",
      repositoryFingerprint: computeVisualRepositoryFingerprint("owner/repo", "42"),
      baseSha: commit("a"),
      ref: "main"
    },
    issue: {
      source: "fixture",
      externalId: "fixture-1",
      title: "Repair card layout",
      problemStatement: "Center the card and preserve the secondary panel.",
      problemStatementSha256: sha256Utf8("Center the card and preserve the secondary panel.")
    },
    assets: [
      {
        assetId: "asset.expected",
        role: "expected",
        path: "evidence/expected.png",
        mediaType: "image/png",
        sha256: sha("1"),
        size: 100,
        width: 1280,
        height: 720,
        provenance: { kind: "fixture", sourceId: "fixture:expected" },
        regions: []
      },
      {
        assetId: "asset.current",
        role: "current",
        path: "evidence/current.png",
        mediaType: "image/png",
        sha256: sha("2"),
        size: 110,
        width: 1280,
        height: 720,
        provenance: { kind: "capture", sourceId: "run:before", runId: "run.before" },
        regions: []
      }
    ],
    imageReferences: [
      { position: 0, assetId: "asset.expected", role: "expected", caption: "Expected card layout" },
      { position: 1, assetId: "asset.current", role: "current", caption: "Current card layout" }
    ],
    graphCandidates: [{
      nodeId: "component.card",
      kind: "component",
      label: "Card",
      score: 0.95,
      reasons: ["Referenced by the failing route"],
      sourceSpans: [{ path: "src/App.tsx", startLine: 10, endLine: 40 }]
    }],
    profiles: [{ ...profileBody, profileDigest: computeVisualValidationProfileDigest(profileBody) }],
    obligations: [{
      obligationId: "obligation.card",
      description: "The primary card is centered without moving the secondary panel.",
      sourceAssetIds: ["asset.expected", "asset.current"],
      mappedContractIds: ["contract.card"],
      route: "/",
      state: "default",
      viewportId: "viewport.desktop",
      assertionKind: "pixel_region",
      authority: "deterministic",
      confidence: 1,
      status: "mapped"
    }],
    sourceContext: {
      digest: canonicalSha256({ files, omittedPaths: 0, truncated: false }),
      files,
      omittedPaths: 0,
      truncated: false
    }
  };
}

function validationInput(): VisualRepairValidationInput {
  const baseSha = commit("a");
  const headSha = commit("b");
  const shared = {
    profileId: "profile.repair",
    profileDigest: sha("1"),
    configDigest: sha("2"),
    validationPolicyDigest: sha("d"),
    contractInventoryDigest: sha("e"),
    planDigest: sha("f"),
    testPlanDigest: sha("0"),
    toolRegistryDigest: sha("7"),
    baselineIdentityDigest: sha("3"),
    executionMatrixDigest: sha("8"),
    browser: { name: "chromium", version: "130.0" },
    environment: {
      os: "windows",
      architecture: "x64",
      nodeVersion: "22.13.1",
      playwrightVersion: "1.54.1",
      fontManifestDigest: sha("4"),
      locale: "en-US",
      timezone: "UTC"
    },
    cases: [{
      caseId: "case.default",
      targetId: "target.app",
      route: "/",
      state: "default",
      viewport: { viewportId: "viewport.desktop", width: 1280, height: 720, deviceScaleFactor: 1 },
      contractIds: ["contract.card", "contract.secondary"]
    }]
  };
  return {
    schemaVersion: "visual-hive.repair-validation.v1",
    generatedAt: "2026-07-14T13:00:00.000Z",
    validationId: "validation.card",
    sessionId: sha("d"),
    sessionDigest: sha("e"),
    authorizationDigest: sha("f"),
    taskId: "task.card-layout",
    taskContextDigest: sha("5"),
    findingFingerprint: "visual-hive:fixture:card-layout",
    hiveRepairResultDigest: sha("6"),
    repository: "owner/repo",
    baseSha,
    headSha,
    beforeBundleDigest: sha("7"),
    afterBundleDigest: sha("8"),
    beforeReportDigest: sha("9"),
    afterReportDigest: sha("a"),
    beforeRunContextDigest: sha("b"),
    afterRunContextDigest: sha("c"),
    before: { ...structuredClone(shared), commitSha: baseSha },
    after: { ...structuredClone(shared), commitSha: headSha },
    obligations: [{ obligationId: "obligation.card", deterministic: true, status: "passed", contractIds: ["contract.card"], evidenceAssetIds: ["asset.after"] }],
    screenshotTriplets: [{ obligationId: "obligation.card", beforeAssetId: "asset.before", afterAssetId: "asset.after", diffAssetId: "asset.diff", diffPixels: 0, totalPixels: 100, diffRatio: 0 }],
    lanes: {
      targeted: { profileId: "profile.repair", status: "passed", evaluatedContractIds: ["contract.card"], failures: [] },
      regression: { profileId: "profile.repair", status: "passed", evaluatedContractIds: ["contract.card", "contract.secondary"], failures: [] },
      mutation: { status: "not_required", killed: 0, survived: 0, operatorIds: [] }
    },
    remainingFailures: [],
    newFailures: [],
    findingBeforeStatus: "present",
    findingStatus: "absent",
    authoritativeForResolution: true,
    policyChanges: { configChanged: false, validationPolicyChanged: false, thresholdWeakened: false, baselineChanged: false },
    claimedOutcome: "Centered the card without changing validation policy.",
    digestAlgorithm: "visual-hive.canonical-json.sha256.v1"
  };
}

function sourceDigest(sourceContext: VisualHiveTaskContextInput["sourceContext"]): string {
  return canonicalSha256({ files: sourceContext.files, omittedPaths: sourceContext.omittedPaths, truncated: sourceContext.truncated });
}
