import { canonicalJson, canonicalSha256, sha256Utf8, stableTextCompare } from "./canonical.js";
import {
  VisualHiveTaskContextInputSchema,
  VisualHiveTaskContextSchema,
  VisualRepairValidationInputSchema,
  VisualRepairValidationSchema,
  type VisualExecutionContext,
  type VisualHiveTaskContext,
  type VisualHiveTaskContextInput,
  type VisualRepairValidation,
  type VisualRepairValidationInput
} from "./types.js";

const COMPARABILITY_FIELDS = [
  "profileId",
  "profileDigest",
  "validationPolicyDigest",
  "contractInventoryDigest",
  "planDigest",
  "testPlanDigest",
  "toolRegistryDigest",
  "baselineIdentityDigest",
  "executionMatrixDigest",
  "browser",
  "environment",
  "cases"
] as const;

export function buildVisualHiveTaskContext(input: VisualHiveTaskContextInput): VisualHiveTaskContext {
  const parsed = VisualHiveTaskContextInputSchema.parse(input);
  const problemStatementDigest = sha256Utf8(parsed.issue.problemStatement);
  if (parsed.issue.problemStatementSha256 !== problemStatementDigest) {
    throw new Error(`Visual Hive problem statement digest mismatch: expected ${problemStatementDigest}, got ${parsed.issue.problemStatementSha256}.`);
  }
  const assetIds = new Set(parsed.assets.map((asset) => asset.assetId));
  const assetsById = new Map(parsed.assets.map((asset) => [asset.assetId, asset]));
  uniqueBy(parsed.assets, (asset) => asset.assetId);
  uniqueBy(parsed.assets, (asset) => asset.path);
  uniqueBy(parsed.assets, (asset) => asset.sha256);
  for (const asset of parsed.assets) assertPermittedVisualTaskPath(asset.path);
  const referencePositions = new Set<number>();
  for (const reference of parsed.imageReferences) {
    if (!assetIds.has(reference.assetId)) throw new Error(`Visual Hive task image reference names an unknown asset: ${reference.assetId}.`);
    if (assetsById.get(reference.assetId)?.role !== reference.role) throw new Error(`Visual Hive task image reference role does not match asset ${reference.assetId}.`);
    if (referencePositions.has(reference.position)) throw new Error(`Duplicate Visual Hive task image position: ${reference.position}.`);
    referencePositions.add(reference.position);
  }
  const expectedPositions = [...referencePositions].sort((left, right) => left - right);
  if (expectedPositions.some((position, index) => position !== index)) throw new Error("Visual Hive task image positions must be contiguous from zero.");
  const repositoryFingerprint = computeVisualRepositoryFingerprint(parsed.repository.name, parsed.repository.repositoryId);
  if (parsed.repository.repositoryFingerprint !== repositoryFingerprint) throw new Error(`Visual Hive repository fingerprint mismatch: expected ${repositoryFingerprint}, got ${parsed.repository.repositoryFingerprint}.`);
  const declaredContractIds = new Set(parsed.profiles.flatMap((profile) => profile.contractIds));
  const declaredViewportIds = new Set(parsed.profiles.flatMap((profile) => profile.viewports.map((viewport) => viewport.viewportId)));
  for (const obligation of parsed.obligations) {
    for (const sourceAssetId of obligation.sourceAssetIds) {
      if (!assetIds.has(sourceAssetId)) throw new Error(`Visual Hive obligation ${obligation.obligationId} names an unknown source asset: ${sourceAssetId}.`);
    }
    for (const contractId of obligation.mappedContractIds) {
      if (!declaredContractIds.has(contractId)) throw new Error(`Visual Hive obligation ${obligation.obligationId} names an undeclared contract: ${contractId}.`);
    }
    if (obligation.viewportId && !declaredViewportIds.has(obligation.viewportId)) throw new Error(`Visual Hive obligation ${obligation.obligationId} names an undeclared viewport: ${obligation.viewportId}.`);
  }
  const normalizedProfiles = uniqueBy(parsed.profiles, (item) => item.profileId).map((profile) => ({
    ...profile,
    requestKinds: [...new Set(profile.requestKinds)].sort(stableTextCompare),
    contractIds: sortedUnique(profile.contractIds),
    routes: sortedUnique(profile.routes),
    scenarioIds: sortedUnique(profile.scenarioIds),
    viewports: uniqueBy(profile.viewports, (item) => item.viewportId).sort((left, right) => stableTextCompare(left.viewportId, right.viewportId))
  })).sort((left, right) => stableTextCompare(left.profileId, right.profileId));
  for (const profile of normalizedProfiles) {
    const profileDigest = computeVisualValidationProfileDigest(profile);
    if (profile.profileDigest !== profileDigest) throw new Error(`Visual Hive validation profile digest mismatch for ${profile.profileId}: expected ${profileDigest}, got ${profile.profileDigest}.`);
  }
  const normalizedSourceFiles = uniqueBy(parsed.sourceContext.files, (item) => item.path).sort((left, right) => stableTextCompare(left.path, right.path));
  for (const file of normalizedSourceFiles) assertPermittedVisualTaskPath(file.path);
  const sourceContextDigest = canonicalSha256({ files: normalizedSourceFiles, omittedPaths: parsed.sourceContext.omittedPaths, truncated: parsed.sourceContext.truncated });
  if (parsed.sourceContext.digest !== sourceContextDigest) throw new Error(`Visual Hive source context digest mismatch: expected ${sourceContextDigest}, got ${parsed.sourceContext.digest}.`);
  const normalized = {
    ...parsed,
    assets: uniqueBy(parsed.assets, (item) => item.assetId).sort((left, right) => stableTextCompare(left.assetId, right.assetId)),
    imageReferences: [...parsed.imageReferences].sort((left, right) => left.position - right.position),
    graphCandidates: uniqueBy(parsed.graphCandidates, (item) => item.nodeId).sort((left, right) => right.score - left.score || stableTextCompare(left.nodeId, right.nodeId)),
    profiles: normalizedProfiles,
    obligations: uniqueBy(parsed.obligations, (item) => item.obligationId).map((obligation) => ({
      ...obligation,
      sourceAssetIds: sortedUnique(obligation.sourceAssetIds),
      mappedContractIds: sortedUnique(obligation.mappedContractIds)
    })).sort((left, right) => stableTextCompare(left.obligationId, right.obligationId)),
    sourceContext: { ...parsed.sourceContext, files: normalizedSourceFiles },
    safety: {
      containsGoldPatch: false as const,
      containsTestPatch: false as const,
      containsGraderTests: false as const,
      externalCallsMade: 0 as const,
      networkCallsMade: 0 as const,
      writesMade: 0 as const
    }
  };
  return VisualHiveTaskContextSchema.parse({ ...normalized, contextDigest: canonicalSha256(normalized) });
}

export function parseVisualHiveTaskContext(value: unknown): VisualHiveTaskContext {
  const parsed = VisualHiveTaskContextSchema.parse(value);
  const { contextDigest, ...content } = parsed;
  const expected = canonicalSha256(content);
  if (contextDigest !== expected) throw new Error(`Visual Hive task context digest mismatch: expected ${expected}, got ${contextDigest}.`);
  const { safety: _safety, ...input } = content;
  void _safety;
  const rebuilt = buildVisualHiveTaskContext(input);
  if (canonicalJson(rebuilt) !== canonicalJson(parsed)) throw new Error("Visual Hive task context is not in canonical normalized form.");
  return parsed;
}

/** @internal Production consumers must use buildVisualRepairValidationFromArtifacts. */
export function buildVisualRepairValidation(input: VisualRepairValidationInput): VisualRepairValidation {
  const parsed = VisualRepairValidationInputSchema.parse(input);
  const normalized = normalizeValidationInput(parsed);
  const comparability = compareExecutionContexts(normalized.before, normalized.after);
  const verdict = deriveRepairVerdict(normalized, comparability.status);
  const closureRecommendation = verdict === "pass" ? "resolved_candidate" : "keep_open";
  const content = { ...normalized, comparability, verdict, closureRecommendation };
  return VisualRepairValidationSchema.parse({ ...content, receiptDigest: canonicalSha256(content) });
}

export function parseVisualRepairValidation(value: unknown): VisualRepairValidation {
  const parsed = VisualRepairValidationSchema.parse(value);
  const { receiptDigest, ...content } = parsed;
  const expectedDigest = canonicalSha256(content);
  if (receiptDigest !== expectedDigest) throw new Error(`Visual Hive repair validation digest mismatch: expected ${expectedDigest}, got ${receiptDigest}.`);

  const rebuilt = buildVisualRepairValidation(stripDerivedValidationFields(parsed));
  if (canonicalJson(rebuilt) !== canonicalJson(parsed)) throw new Error("Visual Hive repair validation derived verdict or comparability does not match deterministic recomputation.");
  return parsed;
}

function stripDerivedValidationFields(validation: VisualRepairValidation): VisualRepairValidationInput {
  const { comparability: _comparability, verdict: _verdict, closureRecommendation: _closureRecommendation, receiptDigest: _receiptDigest, ...input } = validation;
  void _comparability;
  void _verdict;
  void _closureRecommendation;
  void _receiptDigest;
  return input;
}

function normalizeValidationInput(input: VisualRepairValidationInput): VisualRepairValidationInput {
  return {
    ...input,
    before: normalizeExecutionContext(input.before),
    after: normalizeExecutionContext(input.after),
    obligations: uniqueBy(input.obligations, (item) => item.obligationId).map((item) => ({
      ...item,
      contractIds: sortedUnique(item.contractIds),
      evidenceAssetIds: sortedUnique(item.evidenceAssetIds)
    })).sort((left, right) => stableTextCompare(left.obligationId, right.obligationId)),
    screenshotTriplets: uniqueBy(input.screenshotTriplets, (item) => `${item.obligationId}\0${item.beforeAssetId}\0${item.afterAssetId}\0${item.diffAssetId ?? ""}`).sort((left, right) => stableTextCompare(
      `${left.obligationId}\0${left.beforeAssetId}\0${left.afterAssetId}\0${left.diffAssetId ?? ""}`,
      `${right.obligationId}\0${right.beforeAssetId}\0${right.afterAssetId}\0${right.diffAssetId ?? ""}`
    )),
    lanes: {
      targeted: normalizeLane(input.lanes.targeted),
      regression: normalizeLane(input.lanes.regression),
      mutation: { ...input.lanes.mutation, operatorIds: sortedUnique(input.lanes.mutation.operatorIds) }
    },
    remainingFailures: uniqueBy(input.remainingFailures, (item) => item.id).sort((left, right) => stableTextCompare(left.id, right.id)),
    newFailures: uniqueBy(input.newFailures, (item) => item.id).sort((left, right) => stableTextCompare(left.id, right.id))
  };
}

function normalizeExecutionContext(context: VisualExecutionContext): VisualExecutionContext {
  return {
    ...context,
    cases: uniqueBy(context.cases, (executionCase) => executionCase.caseId).map((executionCase) => ({
      ...executionCase,
      contractIds: sortedUnique(executionCase.contractIds)
    })).sort((left, right) => stableTextCompare(left.caseId, right.caseId))
  };
}

function normalizeLane<T extends { evaluatedContractIds: string[]; failures: string[] }>(lane: T): T {
  return { ...lane, evaluatedContractIds: sortedUnique(lane.evaluatedContractIds), failures: sortedUnique(lane.failures) };
}

function compareExecutionContexts(before: VisualExecutionContext, after: VisualExecutionContext): VisualRepairValidation["comparability"] {
  const differences: VisualRepairValidation["comparability"]["differences"] = [];
  for (const field of COMPARABILITY_FIELDS) {
    const beforeValue = before[field];
    const afterValue = after[field];
    const beforeDigest = canonicalSha256(beforeValue);
    const afterDigest = canonicalSha256(afterValue);
    if (beforeDigest !== afterDigest) differences.push({ field, beforeDigest, afterDigest });
  }
  return {
    status: differences.length === 0 ? "comparable" : "non_comparable",
    comparedFields: [...COMPARABILITY_FIELDS],
    differences
  };
}

function deriveRepairVerdict(input: VisualRepairValidationInput, comparability: "comparable" | "non_comparable"): VisualRepairValidation["verdict"] {
  if (comparability !== "comparable") return "blocked";
  if (input.findingBeforeStatus !== "present") return "blocked";
  if (!input.authoritativeForResolution || input.findingStatus === "not_evaluated") return "blocked";
  if (input.policyChanges.configChanged || input.policyChanges.validationPolicyChanged || input.policyChanges.thresholdWeakened || input.policyChanges.baselineChanged) return "blocked";
  const deterministic = input.obligations.filter((obligation) => obligation.deterministic);
  if (deterministic.some((obligation) => obligation.status === "blocked" || obligation.status === "not_evaluated")) return "blocked";
  if (input.lanes.targeted.status === "blocked" || input.lanes.targeted.status === "skipped" || input.lanes.regression.status === "blocked" || input.lanes.regression.status === "skipped" || input.lanes.mutation.status === "blocked") return "blocked";
  if (deterministic.some((obligation) => obligation.status === "failed")) return "fail";
  if (input.lanes.targeted.status === "failed" || input.lanes.regression.status === "failed" || input.lanes.mutation.status === "failed") return "fail";
  if (input.findingStatus === "present") return "fail";
  if (input.remainingFailures.length > 0 || input.newFailures.length > 0) return "fail";
  return "pass";
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort(stableTextCompare);
}

function uniqueBy<T>(values: T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  for (const value of values) {
    const identity = key(value);
    if (seen.has(identity)) throw new Error(`Duplicate Visual Hive repair artifact identity: ${identity}.`);
    seen.add(identity);
  }
  return [...values];
}

export function computeVisualRepositoryFingerprint(repository: string, repositoryId?: string): string {
  return canonicalSha256({ repository, repositoryId: repositoryId ?? null });
}

export function computeVisualValidationProfileDigest(profile: Omit<VisualHiveTaskContext["profiles"][number], "profileDigest"> | VisualHiveTaskContext["profiles"][number]): string {
  const { profileDigest: _profileDigest, ...content } = profile as VisualHiveTaskContext["profiles"][number];
  void _profileDigest;
  return canonicalSha256({
    ...content,
    requestKinds: [...new Set(content.requestKinds)].sort(stableTextCompare),
    contractIds: sortedUnique(content.contractIds),
    routes: sortedUnique(content.routes),
    scenarioIds: sortedUnique(content.scenarioIds),
    viewports: uniqueBy(content.viewports, (viewport) => viewport.viewportId).sort((left, right) => stableTextCompare(left.viewportId, right.viewportId))
  });
}

export function assertPermittedVisualTaskPath(value: string): void {
  const segments = value.toLowerCase().split("/");
  if (segments.some((segment) => segment === ".git" || segment === ".swebench" || segment === "grader") || segments.some((segment) => /^(?:gold|test)[_-]?patch(?:\.|$)/u.test(segment))) {
    throw new Error(`Visual Hive task context contains a prohibited evaluator or answer path: ${value}.`);
  }
}
