import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import {
  buildVisualRunContext,
  canonicalSha256,
  computeVisualValidationPolicyDigest,
  computeVisualRepositoryFingerprint,
  parseVisualRunContext,
  type VisualRunContextInput
} from "../src/index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const sha = (character: string): string => character.repeat(64);
const commit = (character: string): string => character.repeat(40);

describe("visual-hive.run-context.v1", () => {
  it("builds a canonical environment, policy, report, and evidence binding", () => {
    const first = buildVisualRunContext(runInput());
    const reordered = runInput();
    reordered.execution.cases[0]!.contractIds.reverse();
    reordered.thresholds.reverse();
    const second = buildVisualRunContext(reordered);

    expect(first.runContextDigest).toBe(second.runContextDigest);
    expect(parseVisualRunContext(first)).toEqual(first);
  });

  it("rejects repository, commit, contract, threshold, and duplicate evidence drift", () => {
    const fingerprint = runInput();
    fingerprint.repository.repositoryFingerprint = sha("f");
    expect(() => buildVisualRunContext(fingerprint)).toThrow("fingerprint mismatch");

    const commitMismatch = runInput();
    commitMismatch.execution.commitSha = commit("b");
    expect(() => buildVisualRunContext(commitMismatch)).toThrow("commit must match");

    const missingThreshold = runInput();
    missingThreshold.thresholds = missingThreshold.thresholds.slice(0, 1);
    expect(() => buildVisualRunContext(missingThreshold)).toThrow("no threshold policy");

    const unknownThreshold = runInput();
    unknownThreshold.thresholds[0]!.contractId = "contract.unknown";
    expect(() => buildVisualRunContext(unknownThreshold)).toThrow("undeclared contract");

    const unknownAssetContract = runInput();
    unknownAssetContract.evidenceAssets[0]!.assertion.contractId = "contract.unknown";
    expect(() => buildVisualRunContext(unknownAssetContract)).toThrow("undeclared contract");

    const duplicatePath = runInput();
    duplicatePath.evidenceAssets.push({ ...structuredClone(duplicatePath.evidenceAssets[0]!), assetId: "asset.other", sha256: sha("9") });
    expect(() => buildVisualRunContext(duplicatePath)).toThrow("Duplicate");
  });

  it("rejects incoherent capture outcomes", () => {
    const passedWithFailure = runInput();
    passedWithFailure.capture.failures = ["browser crashed"];
    expect(() => buildVisualRunContext(passedWithFailure)).toThrow("passed capture");

    const failedWithoutReason = runInput();
    failedWithoutReason.capture = { status: "failed", failures: [] };
    failedWithoutReason.command.exitCode = 1;
    expect(() => buildVisualRunContext(failedWithoutReason)).toThrow("requires a reason");
  });

  it("allows distinct evidence identities to contain identical image bytes", () => {
    const input = runInput();
    input.evidenceAssets[0]!.assertion.screenshotName = "Card desktop state";
    input.evidenceAssets.push({
      ...structuredClone(input.evidenceAssets[0]!),
      assetId: "asset.reference",
      role: "reference",
      path: ".visual-hive/results/card-reference.png"
    });

    const built = buildVisualRunContext(input);
    expect(built.evidenceAssets).toHaveLength(2);
    expect(built.evidenceAssets[0]!.sha256).toBe(built.evidenceAssets[1]!.sha256);
    expect(built.evidenceAssets[0]!.assertion.screenshotName).toBe("Card desktop state");
  });

  it("rejects digest tampering and noncanonical self-digested inputs", () => {
    const built = buildVisualRunContext(runInput());
    expect(() => parseVisualRunContext({ ...built, runContextDigest: sha("f") })).toThrow("digest mismatch");

    const { runContextDigest: _digest, ...content } = structuredClone(built);
    content.execution.cases[0]!.contractIds.reverse();
    expect(() => parseVisualRunContext({ ...content, runContextDigest: canonicalSha256(content) })).toThrow("canonical normalized form");
  });

  it("matches the checked-in JSON Schema", async () => {
    const schema = JSON.parse(await readFile(path.join(repoRoot, "schemas/visual-hive.run-context.schema.json"), "utf8"));
    const validate = new Ajv2020({ allErrors: true, strict: false, validateFormats: false }).compile(schema);
    const built = buildVisualRunContext(runInput());
    expect(validate(built), JSON.stringify(validate.errors, null, 2)).toBe(true);
    expect(validate({ ...built, unexpected: true })).toBe(false);
  });
});

function runInput(): VisualRunContextInput {
  const repository = "owner/repo";
  const repositoryId = "42";
  const commitSha = commit("a");
  const cases = [{
    caseId: "case.default",
    targetId: "target.app",
    route: "/",
    state: "default",
    viewport: { viewportId: "viewport.desktop", width: 1280, height: 720, deviceScaleFactor: 1 },
    contractIds: ["contract.card", "contract.secondary"]
  }];
  const contractIds = ["contract.card", "contract.secondary"];
  const thresholds = [
    { contractId: "contract.secondary", maxDiffPixelRatio: 0, missingBaseline: "fail" as const },
    { contractId: "contract.card", maxDiffPixelRatio: 0.001, maxDiffPixels: 100, missingBaseline: "fail" as const }
  ];
  return {
    schemaVersion: "visual-hive.run-context.v1",
    digestAlgorithm: "visual-hive.canonical-json.sha256.v1",
    generatedAt: "2026-07-14T12:30:00.000Z",
    runId: "run.before",
    phase: "before",
    taskId: "task.visual",
    taskContextDigest: sha("5"),
    findingFingerprint: "visual-hive:fixture:card-layout",
    repository: {
      name: repository,
      repositoryId,
      repositoryFingerprint: computeVisualRepositoryFingerprint(repository, repositoryId),
      commitSha
    },
    execution: {
      commitSha,
      profileId: "profile.repair",
      profileDigest: sha("1"),
      configDigest: sha("2"),
      validationPolicyDigest: computeVisualValidationPolicyDigest("command.playwright", thresholds),
      contractInventoryDigest: canonicalSha256(contractIds),
      planDigest: sha("a"),
      testPlanDigest: sha("b"),
      toolRegistryDigest: sha("c"),
      baselineIdentityDigest: sha("3"),
      executionMatrixDigest: canonicalSha256(cases),
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
      cases
    },
    producer: { visualHiveVersion: "0.3.2", visualHiveCommit: commit("c"), playwrightVersion: "1.54.1" },
    command: {
      validationCommandId: "command.playwright",
      startedAt: "2026-07-14T12:29:00.000Z",
      completedAt: "2026-07-14T12:30:00.000Z",
      exitCode: 0
    },
    report: { path: ".visual-hive/report.json", sha256: sha("6") },
    evidenceAssets: [{
      assetId: "asset.actual",
      role: "actual",
      path: ".visual-hive/results/card-actual.png",
      mediaType: "image/png",
      sha256: sha("7"),
      size: 100,
      width: 1280,
      height: 720,
      assertion: { contractId: "contract.card", screenshotName: "card", route: "/", state: "default", viewportId: "viewport.desktop" },
      obligationIds: ["obligation.card"]
    }],
    thresholds,
    capture: { status: "passed", failures: [] }
  };
}
