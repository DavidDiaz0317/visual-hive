import type { MutationReport, MutationResult } from "../reports/types.js";

export function calculateMutationScore(results: Pick<MutationResult, "killed">[]): {
  killed: number;
  total: number;
  score: number;
} {
  const total = results.length;
  const killed = results.filter((result) => result.killed).length;
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
    schemaVersion: 1,
    project: input.project,
    generatedAt: (input.now ?? new Date()).toISOString(),
    minScore: input.minScore,
    results: input.results,
    ...score
  };
}
