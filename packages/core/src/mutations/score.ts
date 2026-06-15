import type { MutationReport, MutationResult } from "../reports/types.js";

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
  const score = calculateMutationScore(input.results);
  return {
    schemaVersion: 2,
    project: input.project,
    generatedAt: (input.now ?? new Date()).toISOString(),
    minScore: input.minScore,
    results: input.results,
    ...score
  };
}
