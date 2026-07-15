import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildVisualHiveTaskContext,
  canonicalJson,
  loadVisualTaskAsset,
  parseVisualHiveTaskContext,
  visualRepairSessionRelativeRoot,
  type VisualHiveTaskContext,
  type VisualHiveTaskContextInput
} from "@visual-hive/core";
import {
  canonicalExistingDirectoryRoot,
  ensureCanonicalDirectoryRoot,
  ensureSafeRelativeDirectory,
  readBoundedJsonFile,
  resolveSafeRelativeWriteFile
} from "./repairFileIo.js";
import { loadStoredVisualTaskAsset, VISUAL_REPAIR_TASK_ASSET_DIRECTORY } from "./repairTaskAssetStore.js";

const MAX_TASK_CONTEXT_BYTES = 16 * 1024 * 1024;
const MAX_TASK_ASSET_BYTES = 32 * 1024 * 1024;
const MAX_TASK_ASSET_TOTAL_BYTES = 256 * 1024 * 1024;

export interface RepairTaskContextCommandOptions {
  storeRoot: string;
  input: string;
  assetRoot: string;
}

export interface RepairTaskContextCommandResult {
  schemaVersion: "visual-hive.repair-task-ingest-result.v1";
  created: boolean;
  storeRoot: string;
  sessionStorageId: string;
  sessionRoot: string;
  taskContextPath: string;
  taskId: string;
  taskContextDigest: string;
  repository: string;
  baseSha: string;
  assetCount: number;
}

export async function runRepairTaskContextCommand(options: RepairTaskContextCommandOptions): Promise<RepairTaskContextCommandResult> {
  const storeRoot = await ensureCanonicalDirectoryRoot(options.storeRoot, "Visual Hive repair store");
  const assetRoot = await canonicalExistingDirectoryRoot(options.assetRoot, "Visual Hive task asset root");
  const input = await readBoundedJsonFile<VisualHiveTaskContextInput>(path.resolve(options.input), MAX_TASK_CONTEXT_BYTES, "Visual Hive task context input");
  const task = buildVisualHiveTaskContext(input);
  const loadedAssets: Array<Awaited<ReturnType<typeof loadVisualTaskAsset>>> = [];
  let totalAssetBytes = 0;
  for (const asset of task.assets) {
    const loaded = await loadVisualTaskAsset({
      evidenceRoot: assetRoot,
      taskContext: task,
      taskId: task.taskId,
      repository: task.repository.name,
      commitSha: task.repository.baseSha,
      assetId: asset.assetId,
      maxBytes: MAX_TASK_ASSET_BYTES
    });
    totalAssetBytes += loaded.data.byteLength;
    if (totalAssetBytes > MAX_TASK_ASSET_TOTAL_BYTES) {
      throw new Error(`Visual Hive task assets exceed the ${MAX_TASK_ASSET_TOTAL_BYTES}-byte aggregate limit.`);
    }
    loadedAssets.push(loaded);
  }
  const sessionRelativeRoot = visualRepairSessionRelativeRoot({ taskId: task.taskId, repository: task.repository.name, taskContextDigest: task.contextDigest });
  const sessionStorageId = sessionRelativeRoot.split("/").at(-1)!;
  const finalRoot = path.join(storeRoot, ...sessionRelativeRoot.split("/"));
  const existing = await verifyExistingSession(finalRoot, task);
  if (existing) return result(false, storeRoot, sessionRelativeRoot, sessionStorageId, task);

  const relativeParent = path.posix.dirname(sessionRelativeRoot);
  const sessionsRoot = await ensureSafeRelativeDirectory(storeRoot, relativeParent, "Visual Hive repair session storage");
  const temporaryRoot = await mkdtemp(path.join(sessionsRoot, ".tmp-ingest-"));
  try {
    const taskAssetRoot = await ensureSafeRelativeDirectory(temporaryRoot, VISUAL_REPAIR_TASK_ASSET_DIRECTORY, "Visual Hive repair task assets");
    for (const loaded of loadedAssets) {
      const destination = await resolveSafeRelativeWriteFile(taskAssetRoot, loaded.asset.path, "Visual Hive repair task asset");
      await writeFile(destination, loaded.data, { flag: "wx" });
    }
    await writeFile(path.join(temporaryRoot, "task-context.json"), `${JSON.stringify(task, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    try {
      await rename(temporaryRoot, finalRoot);
    } catch (error) {
      if (!(await verifyExistingSession(finalRoot, task))) throw error;
      await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      return result(false, storeRoot, sessionRelativeRoot, sessionStorageId, task);
    }
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    throw error;
  }
  return result(true, storeRoot, sessionRelativeRoot, sessionStorageId, task);
}

async function verifyExistingSession(root: string, expected: VisualHiveTaskContext): Promise<boolean> {
  let canonicalRoot: string;
  try {
    canonicalRoot = await canonicalExistingDirectoryRoot(root, "Visual Hive stored repair session");
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
  let parsed: VisualHiveTaskContext;
  try {
    parsed = parseVisualHiveTaskContext(await readBoundedJsonFile(path.join(canonicalRoot, "task-context.json"), MAX_TASK_CONTEXT_BYTES, "Visual Hive stored task context"));
  } catch (error) {
    if (isMissing(error)) throw new Error("Existing Visual Hive repair session storage is incomplete.");
    throw error;
  }
  if (canonicalJson(parsed) !== canonicalJson(expected)) throw new Error("Existing Visual Hive repair session storage contains a different task context.");
  let totalAssetBytes = 0;
  for (const asset of parsed.assets) {
    const loaded = await loadStoredVisualTaskAsset({
      sessionRoot: canonicalRoot,
      taskContext: parsed,
      taskId: parsed.taskId,
      repository: parsed.repository.name,
      commitSha: parsed.repository.baseSha,
      assetId: asset.assetId,
      maxBytes: MAX_TASK_ASSET_BYTES
    });
    totalAssetBytes += loaded.data.byteLength;
    if (totalAssetBytes > MAX_TASK_ASSET_TOTAL_BYTES) {
      throw new Error(`Visual Hive stored task assets exceed the ${MAX_TASK_ASSET_TOTAL_BYTES}-byte aggregate limit.`);
    }
  }
  return true;
}

function result(created: boolean, storeRoot: string, sessionRelativeRoot: string, sessionStorageId: string, task: VisualHiveTaskContext): RepairTaskContextCommandResult {
  return {
    schemaVersion: "visual-hive.repair-task-ingest-result.v1",
    created,
    storeRoot,
    sessionStorageId,
    sessionRoot: sessionRelativeRoot,
    taskContextPath: `${sessionRelativeRoot}/task-context.json`,
    taskId: task.taskId,
    taskContextDigest: task.contextDigest,
    repository: task.repository.name,
    baseSha: task.repository.baseSha,
    assetCount: task.assets.length
  };
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}
