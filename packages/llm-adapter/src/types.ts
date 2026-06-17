import type {
  BaselineApprovalLog,
  BaselineRejectionLog,
  CoverageReport,
  MockProviderRunReport,
  MutationReport,
  Report,
  TriageFinding
} from "@visual-hive/core";

export interface TriageInput {
  report?: Report;
  mutationReport?: MutationReport;
  coverageReport?: CoverageReport;
  providerRunReport?: MockProviderRunReport;
  baselineApprovalLog?: BaselineApprovalLog;
  baselineRejectionLog?: BaselineRejectionLog;
}

export interface PromptInput {
  report?: Report;
  mutationReport?: MutationReport;
  coverageReport?: CoverageReport;
  providerRunReport?: MockProviderRunReport;
  baselineApprovalLog?: BaselineApprovalLog;
  baselineRejectionLog?: BaselineRejectionLog;
  findings?: TriageFinding[];
}
