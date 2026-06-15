import type { MutationReport, Report, TriageFinding } from "@visual-hive/core";

export interface TriageInput {
  report?: Report;
  mutationReport?: MutationReport;
}

export interface PromptInput {
  report?: Report;
  mutationReport?: MutationReport;
  findings?: TriageFinding[];
}
