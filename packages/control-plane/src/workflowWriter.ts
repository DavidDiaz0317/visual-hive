import {
  writeWorkflowTemplates as writeCoreWorkflowTemplates,
  type WorkflowTemplateWriteResult
} from "@visual-hive/core";
import { resolveControlPlaneOptions } from "./repoReader.js";
import type { ControlPlaneOptions } from "./types.js";

export type { WorkflowTemplateWriteEntry, WorkflowTemplateWriteResult } from "@visual-hive/core";

export async function writeWorkflowTemplates(
  options: ControlPlaneOptions,
  input: { confirm: boolean; force?: boolean; templateIds?: string[] }
): Promise<WorkflowTemplateWriteResult> {
  const resolved = resolveControlPlaneOptions(options);
  if (resolved.readOnly) {
    throw new Error("Control Plane is read-only. Restart without --read-only to write workflow templates.");
  }
  return writeCoreWorkflowTemplates(
    {
      repoRoot: resolved.repoRoot,
      configRoot: resolved.configRoot,
      readOnly: resolved.readOnly
    },
    input
  );
}
