import type { MutationReport, MutationResult } from "../reports/types.js";
import { getEvidenceResourceById } from "../tools/evidenceResources.js";

export function calculateMutationScore(results: Array<Pick<MutationResult, "killed"> & Partial<Pick<MutationResult, "applicable">>>): {
  killed: number;
  total: number;
  score: number;
} {
  const applicable = results.filter((result) => result.applicable !== false);
  const total = applicable.length;
  const killed = applicable.filter((result) => result.killed).length;
  return {
    killed,
    total,
    score: total === 0 ? 0 : killed / total
  };
}

export function buildMutationReport(input: {
  project: string;
  minScore: number;
  results: MutationResult[];
  now?: Date;
}): MutationReport {
  const results = input.results.map(enrichMutationResult);
  const score = calculateMutationScore(results);
  return {
    schemaVersion: 2,
    project: input.project,
    generatedAt: (input.now ?? new Date()).toISOString(),
    outputResource: catalogedMutationOutputResource(),
    minScore: input.minScore,
    results,
    ...score
  };
}

function enrichMutationResult(result: MutationResult): MutationResult {
  const affectedSurfaces = result.affectedSurfaces ?? result.affected ?? result.contractIds.map((contractId) => ({ contractId }));
  return {
    ...result,
    affected: result.affected ?? affectedSurfaces,
    affectedSurfaces,
    validationCommand: result.validationCommand ?? "visual-hive mutate --config visual-hive.config.yaml --enforce-min-score",
    suggestedMissingTest: result.suggestedMissingTest ?? suggestedMissingTest(result),
    mutationMode: result.mutationMode ?? "runtime",
    sourceMutation: result.sourceMutation ?? false
  };
}

function suggestedMissingTest(result: MutationResult): string {
  if (result.status === "survived") {
    return `Add or strengthen deterministic assertions so mutation "${result.operator}" fails at least one mapped contract.`;
  }
  if (result.status === "not_applicable") {
    return `Map mutation "${result.operator}" to a relevant contract or document why it is not applicable.`;
  }
  if (result.status === "error") {
    return `Repair mutation execution for "${result.operator}" before using the score as a gate.`;
  }
  return `Keep mutation "${result.operator}" mapped to contracts that protect the affected user-visible surface.`;
}

function catalogedMutationOutputResource(): NonNullable<MutationReport["outputResource"]> {
  const resource = getEvidenceResourceById("mutation-report");
  return {
    artifactPath: ".visual-hive/mutation-report.json",
    evidenceResourceId: resource?.id ?? "mutation-report",
    evidenceResourceUri: resource?.uri ?? "visual-hive://mutation-report",
    evidenceResourceTitle: resource?.title ?? "Mutation Report",
    evidenceResourceDescription: resource?.description ?? "Mutation adequacy report and survivor evidence.",
    evidenceReadToolName: resource?.readTool?.name ?? "visual_hive_read_mutation_report"
  };
}
