import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { sha256Bytes } from "./canonical.js";
import { parseVisualHiveTaskContext } from "./build.js";
import {
  RelativeArtifactPathSchema,
  VisualTaskAssetSchema,
  type VisualHiveTaskContext,
  type VisualTaskAsset
} from "./types.js";

const MAX_ASSET_BYTES = 32 * 1024 * 1024;

export interface LoadVisualTaskAssetOptions {
  evidenceRoot: string;
  taskContext: VisualHiveTaskContext;
  taskId: string;
  repository: string;
  commitSha: string;
  assetId: string;
  maxBytes?: number;
}

export interface LoadedVisualTaskAsset {
  taskId: string;
  repository: string;
  commitSha: string;
  contextDigest: string;
  asset: VisualTaskAsset;
  data: Buffer;
}

export interface InspectDeclaredVisualTaskAssetOptions {
  evidenceRoot: string;
  asset: Omit<VisualTaskAsset, "sha256" | "size" | "width" | "height"> & Partial<Pick<VisualTaskAsset, "width" | "height">>;
  maxBytes?: number;
}

export async function loadVisualTaskAsset(options: LoadVisualTaskAssetOptions): Promise<LoadedVisualTaskAsset> {
  const context = parseVisualHiveTaskContext(options.taskContext);
  if (context.taskId !== options.taskId) throw new Error(`Visual Hive task identity mismatch: expected ${context.taskId}.`);
  if (context.repository.name !== options.repository) throw new Error(`Visual Hive repository identity mismatch: expected ${context.repository.name}.`);
  if (context.repository.baseSha !== options.commitSha) throw new Error(`Visual Hive commit identity mismatch: expected ${context.repository.baseSha}.`);
  const asset = context.assets.find((candidate) => candidate.assetId === options.assetId);
  if (!asset) throw new Error(`Visual Hive task ${context.taskId} has no asset ${options.assetId}.`);

  const inspected = await readAndInspectAsset(options.evidenceRoot, asset.path, options.maxBytes ?? MAX_ASSET_BYTES);
  if (inspected.data.byteLength !== asset.size) throw new Error(`Visual Hive asset ${asset.assetId} size mismatch: expected ${asset.size}, got ${inspected.data.byteLength}.`);
  if (inspected.sha256 !== asset.sha256) throw new Error(`Visual Hive asset ${asset.assetId} digest mismatch: expected ${asset.sha256}, got ${inspected.sha256}.`);
  if (inspected.mediaType !== asset.mediaType) throw new Error(`Visual Hive asset ${asset.assetId} media type mismatch: expected ${asset.mediaType}, got ${inspected.mediaType}.`);
  if (asset.width !== undefined && inspected.width !== asset.width) throw new Error(`Visual Hive asset ${asset.assetId} width mismatch: expected ${asset.width}, got ${inspected.width}.`);
  if (asset.height !== undefined && inspected.height !== asset.height) throw new Error(`Visual Hive asset ${asset.assetId} height mismatch: expected ${asset.height}, got ${inspected.height}.`);

  return {
    taskId: context.taskId,
    repository: context.repository.name,
    commitSha: context.repository.baseSha,
    contextDigest: context.contextDigest,
    asset,
    data: inspected.data
  };
}

/**
 * Trusted ingestion helper. MCP/tool callers must use loadVisualTaskAsset and select by assetId;
 * they must never supply a filesystem path.
 */
export async function inspectDeclaredVisualTaskAsset(options: InspectDeclaredVisualTaskAssetOptions): Promise<VisualTaskAsset> {
  const pathValue = RelativeArtifactPathSchema.parse(options.asset.path);
  const inspected = await readAndInspectAsset(options.evidenceRoot, pathValue, options.maxBytes ?? MAX_ASSET_BYTES);
  if (options.asset.mediaType !== inspected.mediaType) throw new Error(`Declared asset media type does not match ${pathValue}.`);
  if (options.asset.width !== undefined && options.asset.width !== inspected.width) throw new Error(`Declared asset width does not match ${pathValue}.`);
  if (options.asset.height !== undefined && options.asset.height !== inspected.height) throw new Error(`Declared asset height does not match ${pathValue}.`);
  return VisualTaskAssetSchema.parse({
    ...options.asset,
    path: pathValue,
    mediaType: inspected.mediaType,
    sha256: inspected.sha256,
    size: inspected.data.byteLength,
    width: inspected.width,
    height: inspected.height
  });
}

interface InspectedAssetBytes {
  data: Buffer;
  sha256: string;
  mediaType: VisualTaskAsset["mediaType"];
  width: number;
  height: number;
}

async function readAndInspectAsset(evidenceRoot: string, relativePath: string, maxBytes: number): Promise<InspectedAssetBytes> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > MAX_ASSET_BYTES) throw new Error(`Visual Hive asset byte limit must be between 1 and ${MAX_ASSET_BYTES}.`);
  const normalizedPath = RelativeArtifactPathSchema.parse(relativePath);
  const root = await realpath(path.resolve(evidenceRoot));
  let current = root;
  const segments = normalizedPath.split("/");
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    const entry = await lstat(current);
    if (entry.isSymbolicLink()) throw new Error(`Visual Hive asset path contains a symbolic link: ${normalizedPath}.`);
    if (index < segments.length - 1 && !entry.isDirectory()) throw new Error(`Visual Hive asset path has a non-directory parent: ${normalizedPath}.`);
  }

  const resolvedFile = await realpath(current);
  assertContained(root, resolvedFile);
  const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);
  const handle = await open(resolvedFile, flags);
  let data: Buffer;
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error(`Visual Hive asset is not a regular file: ${normalizedPath}.`);
    if (stat.size <= 0) throw new Error(`Visual Hive asset is empty: ${normalizedPath}.`);
    if (stat.size > maxBytes) throw new Error(`Visual Hive asset exceeds the ${maxBytes}-byte retrieval limit: ${normalizedPath}.`);
    data = await handle.readFile();
    if (data.byteLength !== stat.size) throw new Error(`Visual Hive asset changed while it was being read: ${normalizedPath}.`);
  } finally {
    await handle.close();
  }

  const image = inspectVisualImageBytes(data);
  return { data, sha256: sha256Bytes(data), ...image };
}

function assertContained(root: string, candidate: string): void {
  const relative = path.relative(root, candidate);
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Visual Hive asset resolved outside the approved evidence root.");
  }
}

export function inspectVisualImageBytes(value: Uint8Array): Pick<InspectedAssetBytes, "mediaType" | "width" | "height"> {
  const data = Buffer.isBuffer(value) ? value : Buffer.from(value);
  if (data.length >= 24 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    if (data.toString("ascii", 12, 16) !== "IHDR") throw new Error("Visual Hive PNG asset has no leading IHDR chunk.");
    return requirePositiveDimensions("image/png", data.readUInt32BE(16), data.readUInt32BE(20));
  }
  if (data.length >= 10 && (data.toString("ascii", 0, 6) === "GIF87a" || data.toString("ascii", 0, 6) === "GIF89a")) {
    return requirePositiveDimensions("image/gif", data.readUInt16LE(6), data.readUInt16LE(8));
  }
  if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return inspectJpeg(data);
  if (data.length >= 30 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP") return inspectWebp(data);
  throw new Error("Visual Hive asset is not a supported PNG, JPEG, WebP, or GIF image.");
}

function inspectJpeg(data: Buffer): Pick<InspectedAssetBytes, "mediaType" | "width" | "height"> {
  let offset = 2;
  while (offset + 4 <= data.length) {
    if (data[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (data[offset] === 0xff) offset += 1;
    const marker = data[offset++];
    if (marker === undefined || marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > data.length) break;
    const length = data.readUInt16BE(offset);
    if (length < 2 || offset + length > data.length) throw new Error("Visual Hive JPEG asset has a malformed segment length.");
    if (isStartOfFrame(marker)) {
      if (length < 7) throw new Error("Visual Hive JPEG asset has a truncated frame header.");
      return requirePositiveDimensions("image/jpeg", data.readUInt16BE(offset + 5), data.readUInt16BE(offset + 3));
    }
    offset += length;
  }
  throw new Error("Visual Hive JPEG asset has no supported frame header.");
}

function isStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
}

function inspectWebp(data: Buffer): Pick<InspectedAssetBytes, "mediaType" | "width" | "height"> {
  const declaredSize = data.readUInt32LE(4) + 8;
  if (declaredSize > data.length) throw new Error("Visual Hive WebP asset is truncated.");
  const chunk = data.toString("ascii", 12, 16);
  if (chunk === "VP8X") return requirePositiveDimensions("image/webp", readUInt24LE(data, 24) + 1, readUInt24LE(data, 27) + 1);
  if (chunk === "VP8 ") {
    const payload = 20;
    if (data.length < payload + 10 || data[payload + 3] !== 0x9d || data[payload + 4] !== 0x01 || data[payload + 5] !== 0x2a) throw new Error("Visual Hive WebP VP8 asset has an invalid frame header.");
    return requirePositiveDimensions("image/webp", data.readUInt16LE(payload + 6) & 0x3fff, data.readUInt16LE(payload + 8) & 0x3fff);
  }
  if (chunk === "VP8L") {
    const payload = 20;
    if (data.length < payload + 5 || data[payload] !== 0x2f) throw new Error("Visual Hive WebP VP8L asset has an invalid frame header.");
    const b1 = data[payload + 1]!;
    const b2 = data[payload + 2]!;
    const b3 = data[payload + 3]!;
    const b4 = data[payload + 4]!;
    return requirePositiveDimensions("image/webp", 1 + b1 + ((b2 & 0x3f) << 8), 1 + (b2 >> 6) + (b3 << 2) + ((b4 & 0x0f) << 10));
  }
  throw new Error(`Visual Hive WebP asset uses unsupported chunk ${chunk || "<empty>"}.`);
}

function readUInt24LE(data: Buffer, offset: number): number {
  if (offset + 3 > data.length) throw new Error("Visual Hive WebP asset has a truncated dimension field.");
  return data[offset]! + (data[offset + 1]! << 8) + (data[offset + 2]! << 16);
}

function requirePositiveDimensions(mediaType: VisualTaskAsset["mediaType"], width: number, height: number): Pick<InspectedAssetBytes, "mediaType" | "width" | "height"> {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || width > 32_768 || height > 32_768) {
    throw new Error(`Visual Hive ${mediaType} asset has invalid ${width}x${height} dimensions.`);
  }
  return { mediaType, width, height };
}
