import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { sha256Bytes } from "./canonical.js";

export const VISUAL_REPAIR_IMAGE_COMPARISON_ALGORITHM = "pixelmatch.v7.threshold-0.1.include-aa-false.v1" as const;

export interface DirectVisualImageComparison {
  algorithm: typeof VISUAL_REPAIR_IMAGE_COMPARISON_ALGORITHM;
  width: number;
  height: number;
  diffPixels: number;
  totalPixels: number;
  diffRatio: number;
  beforeSha256: string;
  afterSha256: string;
  diffSha256: string;
  diffPng: Buffer;
}

export function compareVisualPngBytes(beforeBytes: Uint8Array, afterBytes: Uint8Array): DirectVisualImageComparison {
  const before = readPng(beforeBytes, "before");
  const after = readPng(afterBytes, "after");
  if (before.width !== after.width || before.height !== after.height) {
    throw new Error(`Visual Hive direct comparison requires equal dimensions; before is ${before.width}x${before.height}, after is ${after.width}x${after.height}.`);
  }
  const diff = new PNG({ width: before.width, height: before.height });
  const diffPixels = pixelmatch(before.data, after.data, diff.data, before.width, before.height, { threshold: 0.1, includeAA: false });
  const totalPixels = before.width * before.height;
  const diffPng = PNG.sync.write(diff);
  return {
    algorithm: VISUAL_REPAIR_IMAGE_COMPARISON_ALGORITHM,
    width: before.width,
    height: before.height,
    diffPixels,
    totalPixels,
    diffRatio: diffPixels / totalPixels,
    beforeSha256: sha256Bytes(beforeBytes),
    afterSha256: sha256Bytes(afterBytes),
    diffSha256: sha256Bytes(diffPng),
    diffPng
  };
}

function readPng(value: Uint8Array, label: string): PNG {
  try {
    return PNG.sync.read(Buffer.isBuffer(value) ? value : Buffer.from(value));
  } catch (error) {
    throw new Error(`Visual Hive could not decode the ${label} PNG for direct comparison: ${error instanceof Error ? error.message : String(error)}`);
  }
}
