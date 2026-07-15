import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, open, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  BoundedIdSchema,
  RelativeArtifactPathSchema,
  buildVisualRepairValidationFromArtifacts,
  parseVisualHiveTaskContext,
  parseVisualRepairValidation,
  visualRepairSessionRelativeRoot,
  type BuildVisualRepairValidationArtifacts,
  type RawRepairArtifact,
  type VisualRepairValidation
} from "@visual-hive/core";
import { canonicalExistingDirectoryRoot, ensureCanonicalDirectoryRoot, readBoundedOrdinaryFile, resolveSafeRelativeWriteFile } from "./repairFileIo.js";

const MAX_JSON_BYTES = 16 * 1024 * 1024;
const MAX_BUNDLE_FILE_BYTES = 64 * 1024 * 1024;
const MAX_BUNDLE_BYTES = 256 * 1024 * 1024;

export interface RepairValidateCommandOptions {
  storeRoot: string;
  taskContext: string;
  hiveSession: string;
  hiveResult: string;
  beforeBundle: string;
  beforeRunContext: string;
  afterBundle: string;
  afterRunContext: string;
  validationId: string;
  output?: string;
  /** Injectable trusted clock for deterministic tests. The CLI never accepts a caller timestamp. */
  now?: () => Date;
}

export interface RepairValidateCommandResult {
  schemaVersion: "visual-hive.repair-validate-result.v1";
  created: boolean;
  outputPath: string;
  validationId: string;
  sessionId: string;
  sessionDigest: string;
  authorizationDigest: string;
  taskId: string;
  taskContextDigest: string;
  findingFingerprint: string;
  hiveRepairResultDigest: string;
  repository: string;
  baseSha: string;
  headSha: string;
  beforeBundleDigest: string;
  afterBundleDigest: string;
  beforeReportDigest: string;
  afterReportDigest: string;
  beforeRunContextDigest: string;
  afterRunContextDigest: string;
  comparabilityStatus: VisualRepairValidation["comparability"]["status"];
  authoritativeForResolution: boolean;
  verdict: VisualRepairValidation["verdict"];
  closureRecommendation: VisualRepairValidation["closureRecommendation"];
  receiptDigest: string;
}

export async function runRepairValidateCommand(options: RepairValidateCommandOptions): Promise<RepairValidateCommandResult> {
  const validationId = BoundedIdSchema.parse(options.validationId);
  const trustedNow = options.now?.() ?? new Date();
  if (!Number.isFinite(trustedNow.getTime())) throw new Error("Repair validation trusted clock is invalid.");
  const taskContext = await rawJsonArtifact(path.resolve(options.taskContext), "task-context.json");
  const task = parseVisualHiveTaskContext(parseJsonObject(Buffer.from(taskContext.bytes), "task context"));
  const hiveRepairSession = await rawJsonArtifact(path.resolve(options.hiveSession), "hive-repair-session.json");
  const hiveRepairResult = await rawJsonArtifact(path.resolve(options.hiveResult), "hive-repair-result.json");
  const before = await loadBundle(path.resolve(options.beforeBundle), RelativeArtifactPathSchema.parse(options.beforeRunContext));
  const after = await loadBundle(path.resolve(options.afterBundle), RelativeArtifactPathSchema.parse(options.afterRunContext));
  const storeRoot = await ensureCanonicalDirectoryRoot(options.storeRoot, "Visual Hive repair validation store");
  const defaultOutput = `${visualRepairSessionRelativeRoot({ taskId: task.taskId, repository: task.repository.name, taskContextDigest: task.contextDigest })}/validations/${validationId}.json`;
  const outputPath = RelativeArtifactPathSchema.parse(options.output ?? defaultOutput);
  if (outputPath !== defaultOutput) throw new Error("Visual Hive repair validation output must use the exact computed session namespace.");
  const generatedAt = await existingValidationTime(storeRoot, outputPath, validationId, task.taskId, task.contextDigest, trustedNow) ?? trustedNow.toISOString();
  const receipt = buildVisualRepairValidationFromArtifacts({
    validationId,
    generatedAt,
    taskContext,
    hiveRepairSession,
    hiveRepairResult,
    before,
    after
  });
  if (!receipt.sessionId || !receipt.sessionDigest || !receipt.authorizationDigest) throw new Error("Authoritative Visual Hive repair validation is missing its Hive session or authorization binding.");
  if (receipt.taskId !== task.taskId || receipt.taskContextDigest !== task.contextDigest || receipt.repository !== task.repository.name) throw new Error("Visual Hive repair validation receipt escaped its task namespace.");
  const bytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  const created = await writeImmutable(storeRoot, outputPath, bytes);
  return {
    schemaVersion: "visual-hive.repair-validate-result.v1",
    created,
    outputPath,
    validationId: receipt.validationId,
    sessionId: receipt.sessionId,
    sessionDigest: receipt.sessionDigest,
    authorizationDigest: receipt.authorizationDigest,
    taskId: receipt.taskId,
    taskContextDigest: receipt.taskContextDigest,
    findingFingerprint: receipt.findingFingerprint,
    hiveRepairResultDigest: receipt.hiveRepairResultDigest,
    repository: receipt.repository,
    baseSha: receipt.baseSha,
    headSha: receipt.headSha,
    beforeBundleDigest: receipt.beforeBundleDigest,
    afterBundleDigest: receipt.afterBundleDigest,
    beforeReportDigest: receipt.beforeReportDigest,
    afterReportDigest: receipt.afterReportDigest,
    beforeRunContextDigest: receipt.beforeRunContextDigest,
    afterRunContextDigest: receipt.afterRunContextDigest,
    comparabilityStatus: receipt.comparability.status,
    authoritativeForResolution: receipt.authoritativeForResolution,
    verdict: receipt.verdict,
    closureRecommendation: receipt.closureRecommendation,
    receiptDigest: receipt.receiptDigest
  };
}

async function existingValidationTime(
  storeRoot: string,
  outputPath: string,
  validationId: string,
  taskId: string,
  taskContextDigest: string,
  trustedNow: Date
): Promise<string | undefined> {
  const filePath = await resolveSafeRelativeWriteFile(storeRoot, outputPath, "Visual Hive immutable repair validation");
  try {
    const bytes = await readBoundedOrdinaryFile(filePath, MAX_JSON_BYTES, "Existing Visual Hive repair validation");
    const existing = parseVisualRepairValidation(parseJsonObject(bytes, "existing repair validation"));
    if (existing.validationId !== validationId || existing.taskId !== taskId || existing.taskContextDigest !== taskContextDigest) throw new Error("Existing Visual Hive repair validation does not match its immutable namespace.");
    if (Date.parse(existing.generatedAt) > trustedNow.getTime()) throw new Error("Existing Visual Hive repair validation was generated in the future relative to the trusted clock.");
    return existing.generatedAt;
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

async function loadBundle(bundleRoot: string, runContextPath: string): Promise<BuildVisualRepairValidationArtifacts["before"]> {
  bundleRoot = await canonicalExistingDirectoryRoot(bundleRoot, "Visual Hive repair bundle root");
  const manifestBytes = await readOrdinaryContainedFile(bundleRoot, "manifest.json", MAX_JSON_BYTES);
  const manifest = parseJsonObject(manifestBytes, "bundle manifest");
  const files = manifest.files;
  if (!Array.isArray(files) || files.length > 4096) throw new Error("Visual Hive repair bundle manifest has an invalid file inventory.");
  const payloads: RawRepairArtifact[] = [];
  let totalBytes = 0;
  for (const record of files) {
    if (!isRecord(record) || typeof record.path !== "string" || typeof record.sourcePath !== "string") throw new Error("Visual Hive repair bundle manifest contains an invalid file record.");
    const bundledPath = RelativeArtifactPathSchema.parse(record.path);
    const sourcePath = RelativeArtifactPathSchema.parse(record.sourcePath);
    const bytes = await readOrdinaryContainedFile(bundleRoot, bundledPath, MAX_BUNDLE_FILE_BYTES);
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_BUNDLE_BYTES) throw new Error(`Visual Hive repair bundle exceeds ${MAX_BUNDLE_BYTES} bytes.`);
    payloads.push({ sourcePath, bytes });
  }
  if (!payloads.some((payload) => payload.sourcePath === runContextPath)) throw new Error(`Visual Hive repair bundle does not contain run context ${runContextPath}.`);
  return { manifest: { sourcePath: "manifest.json", bytes: manifestBytes }, runContextPath, payloads };
}

async function rawJsonArtifact(filePath: string, sourcePath: string): Promise<RawRepairArtifact> {
  const bytes = await readBoundedOrdinaryFile(filePath, MAX_JSON_BYTES, `Visual Hive JSON artifact ${sourcePath}`);
  parseJsonObject(bytes, sourcePath);
  return { sourcePath, bytes };
}

async function readOrdinaryContainedFile(rootValue: string, relativeValue: string, maxBytes: number): Promise<Buffer> {
  const relativePath = RelativeArtifactPathSchema.parse(relativeValue);
  const root = await realpath(path.resolve(rootValue));
  let current = root;
  const segments = relativePath.split("/");
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    const entry = await lstat(current);
    if (entry.isSymbolicLink()) throw new Error(`Visual Hive repair bundle path contains a symbolic link: ${relativePath}.`);
    if (index < segments.length - 1 && !entry.isDirectory()) throw new Error(`Visual Hive repair bundle path has a non-directory parent: ${relativePath}.`);
  }
  const resolved = await realpath(current);
  const relative = path.relative(root, resolved);
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("Visual Hive repair bundle artifact resolved outside its bundle root.");
  const handle = await open(resolved, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size <= 0 || stat.size > maxBytes) throw new Error(`Visual Hive repair bundle artifact ${relativePath} is not a bounded ordinary file.`);
    const bytes = await handle.readFile();
    if (bytes.byteLength !== stat.size) throw new Error(`Visual Hive repair bundle artifact changed while being read: ${relativePath}.`);
    return bytes;
  } finally {
    await handle.close();
  }
}

async function writeImmutable(storeRoot: string, relativePath: string, bytes: Buffer): Promise<boolean> {
  const filePath = await resolveSafeRelativeWriteFile(storeRoot, relativePath, "Visual Hive immutable repair validation");
  try {
    const existing = await readBoundedOrdinaryFile(filePath, MAX_JSON_BYTES, "Existing Visual Hive repair validation");
    if (!existing.equals(bytes)) throw new Error("Existing Visual Hive repair validation artifact differs from the deterministic receipt.");
    await assertPublishedReceipt(storeRoot, filePath);
    return false;
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  const temporary = `${filePath}.tmp-${randomUUID()}`;
  let created = false;
  try {
    await canonicalExistingDirectoryRoot(path.dirname(filePath), "Visual Hive immutable repair validation parent");
    await writeFile(temporary, bytes, { flag: "wx", mode: 0o600, flush: true });
    await canonicalExistingDirectoryRoot(path.dirname(filePath), "Visual Hive immutable repair validation parent");
    try {
      await link(temporary, filePath);
      created = true;
    } catch (error) {
      if (!isErrorCode(error, "EEXIST")) throw error;
      const existing = await readBoundedOrdinaryFile(filePath, MAX_JSON_BYTES, "Existing Visual Hive repair validation");
      if (!existing.equals(bytes)) throw new Error("Existing Visual Hive repair validation artifact differs from the deterministic receipt.");
    }
  } finally {
    await rm(temporary, { force: true });
  }
  await assertPublishedReceipt(storeRoot, filePath);
  return created;
}

async function assertPublishedReceipt(storeRoot: string, filePath: string): Promise<void> {
  const parent = await canonicalExistingDirectoryRoot(path.dirname(filePath), "Visual Hive immutable repair validation parent");
  let entry = await lstat(filePath);
  for (let attempt = 0; entry.nlink > 1 && attempt < 20; attempt += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    entry = await lstat(filePath);
  }
  if (!entry.isFile() || entry.isSymbolicLink()) throw new Error("Visual Hive immutable repair validation destination is not an ordinary file.");
  if (entry.nlink > 1) throw new Error("Visual Hive immutable repair validation destination has an unsafe hard-link alias.");
  const canonical = await realpath(filePath);
  const relativeToStore = path.relative(storeRoot, canonical);
  if (!relativeToStore || relativeToStore === ".." || relativeToStore.startsWith(`..${path.sep}`) || path.isAbsolute(relativeToStore)) {
    throw new Error("Visual Hive immutable repair validation destination escaped its approved store.");
  }
  const relativeToParent = path.relative(parent, canonical);
  if (!relativeToParent || relativeToParent === ".." || relativeToParent.startsWith(`..${path.sep}`) || path.isAbsolute(relativeToParent)) {
    throw new Error("Visual Hive immutable repair validation destination escaped its approved parent.");
  }
}

function parseJsonObject(bytes: Buffer, label: string): Record<string, unknown> {
  try {
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
    if (!isRecord(value)) throw new Error("expected a JSON object");
    return value;
  } catch (error) {
    throw new Error(`Visual Hive ${label} is invalid UTF-8 JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}

function isErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code;
}
