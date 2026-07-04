import type { Report } from "./types.js";
import { getEvidenceResourceById } from "../tools/evidenceResources.js";

export function catalogedReportOutputResource(): NonNullable<Report["outputResource"]> {
  const resource = getEvidenceResourceById("latest-report");
  return {
    artifactPath: ".visual-hive/report.json",
    evidenceResourceId: resource?.id ?? "latest-report",
    evidenceResourceUri: resource?.uri ?? "visual-hive://latest-report",
    evidenceResourceTitle: resource?.title ?? "Latest Report",
    evidenceResourceDescription: resource?.description ?? "Latest deterministic Visual Hive report.",
    evidenceReadToolName: resource?.readTool?.name ?? "visual_hive_read_latest_report"
  };
}
