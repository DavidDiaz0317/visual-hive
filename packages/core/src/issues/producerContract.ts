import type { VisualHiveIssueKind, VisualHiveOwningAgentHint } from "./types.js";

export const VISUAL_HIVE_PRODUCER_ISSUE_KINDS = [
  "setup_needed",
  "map_drift",
  "missing_visual_coverage",
  "test_adequacy_gap",
  "weak_visual_test",
  "stale_baseline",
  "baseline_churn",
  "visual_regression",
  "selector_contract_failure",
  "screenshot_diff",
  "mutation_survivor",
  "workflow_safety",
  "provider_governance",
  "protected_target_blocked",
  "external_repo_onboarding"
] as const satisfies readonly VisualHiveIssueKind[];

export const VISUAL_HIVE_PRODUCER_OWNER_HINTS = [
  "visual-hive/setup",
  "visual-hive/map",
  "visual-hive/test-creator",
  "visual-hive/test-maintainer",
  "visual-hive/mutation",
  "hive/quality",
  "hive/ci"
] as const satisfies readonly VisualHiveOwningAgentHint[];

export const VISUAL_HIVE_OWNER_HINTS_BY_ISSUE_KIND = {
  setup_needed: ["visual-hive/setup"],
  map_drift: ["visual-hive/map"],
  missing_visual_coverage: ["visual-hive/test-creator", "visual-hive/map"],
  test_adequacy_gap: ["visual-hive/test-creator"],
  weak_visual_test: ["visual-hive/test-maintainer"],
  stale_baseline: ["visual-hive/test-maintainer"],
  baseline_churn: ["visual-hive/test-maintainer"],
  visual_regression: ["hive/quality"],
  selector_contract_failure: ["visual-hive/test-maintainer"],
  screenshot_diff: ["hive/quality", "visual-hive/test-maintainer"],
  mutation_survivor: ["visual-hive/mutation"],
  workflow_safety: ["hive/ci"],
  provider_governance: ["hive/ci"],
  protected_target_blocked: ["hive/ci"],
  external_repo_onboarding: ["visual-hive/setup", "hive/quality"]
} as const satisfies Record<VisualHiveIssueKind, readonly VisualHiveOwningAgentHint[]>;

const ISSUE_KIND_SET = new Set<string>(VISUAL_HIVE_PRODUCER_ISSUE_KINDS);
const OWNER_HINT_SET = new Set<string>(VISUAL_HIVE_PRODUCER_OWNER_HINTS);

export function isVisualHiveProducerIssueKind(value: unknown): value is VisualHiveIssueKind {
  return typeof value === "string" && ISSUE_KIND_SET.has(value);
}

export function isVisualHiveProducerOwnerHint(value: unknown): value is VisualHiveOwningAgentHint {
  return typeof value === "string" && OWNER_HINT_SET.has(value);
}

export function isVisualHiveProducerRoute(issueKind: unknown, owningAgentHint: unknown): boolean {
  return isVisualHiveProducerIssueKind(issueKind)
    && isVisualHiveProducerOwnerHint(owningAgentHint)
    && (VISUAL_HIVE_OWNER_HINTS_BY_ISSUE_KIND[issueKind] as readonly VisualHiveOwningAgentHint[]).includes(owningAgentHint);
}
