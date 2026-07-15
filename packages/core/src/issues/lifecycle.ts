import type { VisualHiveLifecyclePolicy } from "./types.js";

export const VISUAL_HIVE_STANDALONE_LIFECYCLE: VisualHiveLifecyclePolicy = {
  owner: "visual-hive",
  standaloneIssueWrites: "allowed",
  reason: "Visual Hive is operating standalone and may use its explicitly guarded trusted issue publisher."
};

export const VISUAL_HIVE_HIVE_MANAGED_LIFECYCLE: VisualHiveLifecyclePolicy = {
  owner: "hive",
  standaloneIssueWrites: "suppressed",
  reason: "Hive is the sole external issue and pull-request lifecycle writer; Visual Hive continues producing candidates and evidence only."
};

export function visualHiveLifecyclePolicy(hiveEnabled: boolean): VisualHiveLifecyclePolicy {
  return hiveEnabled ? VISUAL_HIVE_HIVE_MANAGED_LIFECYCLE : VISUAL_HIVE_STANDALONE_LIFECYCLE;
}

export function lifecycleWriteBlock(policy: VisualHiveLifecyclePolicy | undefined): string | undefined {
  return policy?.owner === "hive" || policy?.standaloneIssueWrites === "suppressed"
    ? "managed_by_hive: Hive is the configured lifecycle owner; Visual Hive standalone issue writes are suppressed."
    : undefined;
}

export function resolveVisualHiveLifecyclePolicy(
  ...policies: Array<VisualHiveLifecyclePolicy | undefined>
): VisualHiveLifecyclePolicy {
  const managed = policies.find((policy) => lifecycleWriteBlock(policy));
  return managed ?? policies.find(Boolean) ?? VISUAL_HIVE_STANDALONE_LIFECYCLE;
}
