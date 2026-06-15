import type { CoverageReport, MutationReport, Report, TriageFinding } from "@visual-hive/core";

export interface TriageInput {
  report?: Report;
  mutationReport?: MutationReport;
  coverageReport?: CoverageReport;
}

export interface PromptInput {
  report?: Report;
  mutationReport?: MutationReport;
  coverageReport?: CoverageReport;
  findings?: TriageFinding[];
}
