import path from "node:path";
import {
  loadVisualTaskAsset,
  type LoadedVisualTaskAsset,
  type VisualHiveTaskContext
} from "@visual-hive/core";
import { canonicalExistingDirectoryRoot } from "./repairFileIo.js";

export const VISUAL_REPAIR_TASK_ASSET_DIRECTORY = "task-assets";

export interface LoadStoredVisualTaskAssetOptions {
  sessionRoot: string;
  taskContext: VisualHiveTaskContext;
  taskId: string;
  repository: string;
  commitSha: string;
  assetId: string;
  maxBytes: number;
}

/**
 * New sessions isolate caller-declared task paths below task-assets/. Sessions
 * written by the original v1 implementation remain readable from their legacy
 * root, but the fallback is used only when the dedicated namespace itself is
 * absent; a missing or corrupted asset in a new session cannot fall through.
 */
export async function loadStoredVisualTaskAsset(options: LoadStoredVisualTaskAssetOptions): Promise<LoadedVisualTaskAsset> {
  const namespacedRoot = path.join(options.sessionRoot, VISUAL_REPAIR_TASK_ASSET_DIRECTORY);
  let evidenceRoot: string;
  try {
    evidenceRoot = await canonicalExistingDirectoryRoot(namespacedRoot, "Visual Hive stored repair task assets");
  } catch (error) {
    if (!isMissing(error)) throw error;
    evidenceRoot = options.sessionRoot;
  }
  return loadVisualTaskAsset({
    evidenceRoot,
    taskContext: options.taskContext,
    taskId: options.taskId,
    repository: options.repository,
    commitSha: options.commitSha,
    assetId: options.assetId,
    maxBytes: options.maxBytes
  });
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}
