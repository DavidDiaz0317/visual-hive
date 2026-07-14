import { canonicalJson, canonicalSha256, stableTextCompare } from "./canonical.js";
import { computeVisualRepositoryFingerprint } from "./build.js";
import {
  VisualRunContextInputSchema,
  VisualRunContextSchema,
  type VisualRunContext,
  type VisualRunContextInput
} from "./types.js";

export function buildVisualRunContext(input: VisualRunContextInput): VisualRunContext {
  const parsed = VisualRunContextInputSchema.parse(input);
  const repositoryFingerprint = computeVisualRepositoryFingerprint(parsed.repository.name, parsed.repository.repositoryId);
  if (parsed.repository.repositoryFingerprint !== repositoryFingerprint) {
    throw new Error(`Visual Hive run repository fingerprint mismatch: expected ${repositoryFingerprint}, got ${parsed.repository.repositoryFingerprint}.`);
  }
  const executionCases = uniqueBy(parsed.execution.cases, (executionCase) => executionCase.caseId).map((executionCase) => ({
    ...executionCase,
    contractIds: sortedUnique(executionCase.contractIds)
  })).sort((left, right) => stableTextCompare(left.caseId, right.caseId));
  const executionContractIds = sortedUnique(executionCases.flatMap((executionCase) => executionCase.contractIds));
  const declaredContracts = new Set(executionContractIds);
  const evidenceAssets = uniqueBy(parsed.evidenceAssets, (asset) => asset.assetId).map((asset) => ({
    ...asset,
    obligationIds: sortedUnique(asset.obligationIds)
  })).sort((left, right) => stableTextCompare(left.assetId, right.assetId));
  uniqueBy(evidenceAssets, (asset) => asset.path);
  for (const asset of evidenceAssets) {
    if (!declaredContracts.has(asset.assertion.contractId)) throw new Error(`Visual Hive run asset ${asset.assetId} names an undeclared contract: ${asset.assertion.contractId}.`);
  }
  const thresholds = uniqueBy(parsed.thresholds, (threshold) => threshold.contractId).sort((left, right) => stableTextCompare(left.contractId, right.contractId));
  for (const threshold of thresholds) {
    if (!declaredContracts.has(threshold.contractId)) throw new Error(`Visual Hive run threshold names an undeclared contract: ${threshold.contractId}.`);
  }
  const thresholdContracts = new Set(thresholds.map((threshold) => threshold.contractId));
  for (const contractId of executionContractIds) {
    if (!thresholdContracts.has(contractId)) throw new Error(`Visual Hive run context has no threshold policy for contract ${contractId}.`);
  }
  const validationPolicyDigest = computeVisualValidationPolicyDigest(parsed.command.validationCommandId, thresholds);
  if (parsed.execution.validationPolicyDigest !== validationPolicyDigest) throw new Error(`Visual Hive validation policy digest mismatch: expected ${validationPolicyDigest}, got ${parsed.execution.validationPolicyDigest}.`);
  const executionMatrixDigest = canonicalSha256(executionCases);
  if (parsed.execution.executionMatrixDigest !== executionMatrixDigest) throw new Error(`Visual Hive execution matrix digest mismatch: expected ${executionMatrixDigest}, got ${parsed.execution.executionMatrixDigest}.`);
  const contractInventoryDigest = canonicalSha256(executionContractIds);
  if (parsed.execution.contractInventoryDigest !== contractInventoryDigest) throw new Error(`Visual Hive contract inventory digest mismatch: expected ${contractInventoryDigest}, got ${parsed.execution.contractInventoryDigest}.`);
  const normalized = {
    ...parsed,
    execution: { ...parsed.execution, cases: executionCases },
    evidenceAssets,
    thresholds,
    capture: { ...parsed.capture, failures: sortedUnique(parsed.capture.failures) }
  };
  return VisualRunContextSchema.parse({ ...normalized, runContextDigest: canonicalSha256(normalized) });
}

export function parseVisualRunContext(value: unknown): VisualRunContext {
  const parsed = VisualRunContextSchema.parse(value);
  const { runContextDigest, ...content } = parsed;
  const expected = canonicalSha256(content);
  if (runContextDigest !== expected) throw new Error(`Visual Hive run context digest mismatch: expected ${expected}, got ${runContextDigest}.`);
  const rebuilt = buildVisualRunContext(content);
  if (canonicalJson(rebuilt) !== canonicalJson(parsed)) throw new Error("Visual Hive run context is not in canonical normalized form.");
  return parsed;
}

export function computeVisualValidationPolicyDigest(validationCommandId: string, thresholds: VisualRunContextInput["thresholds"]): string {
  const normalizedThresholds = uniqueBy(thresholds, (threshold) => threshold.contractId).sort((left, right) => stableTextCompare(left.contractId, right.contractId));
  return canonicalSha256({ validationCommandId, thresholds: normalizedThresholds });
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort(stableTextCompare);
}

function uniqueBy<T>(values: T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  for (const value of values) {
    const identity = key(value);
    if (seen.has(identity)) throw new Error(`Duplicate Visual Hive run identity: ${identity}.`);
    seen.add(identity);
  }
  return [...values];
}
