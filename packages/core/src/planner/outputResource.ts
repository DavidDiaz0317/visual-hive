import type { Plan } from "./types.js";
import { getEvidenceResourceById } from "../tools/evidenceResources.js";

export function catalogedPlanOutputResource(): NonNullable<Plan["outputResource"]> {
  const resource = getEvidenceResourceById("latest-plan");
  return {
    artifactPath: ".visual-hive/plan.json",
    evidenceResourceId: resource?.id ?? "latest-plan",
    evidenceResourceUri: resource?.uri ?? "visual-hive://latest-plan",
    evidenceResourceTitle: resource?.title ?? "Latest Plan",
    evidenceResourceDescription: resource?.description ?? "Latest deterministic plan artifact.",
    evidenceReadToolName: resource?.readTool?.name
  };
}
