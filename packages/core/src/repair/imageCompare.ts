import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { sha256Bytes } from "./canonical.js";

export const VISUAL_REPAIR_IMAGE_COMPARISON_ALGORITHM = "pixelmatch.v7.threshold-0.1.include-aa-false.diagnostic-v2" as const;

export const VISUAL_REPAIR_IMAGE_COMPARISON_DIAGNOSTIC_COLORS = {
  changed: [255, 165, 0, 255],
  removed: [255, 0, 128, 255],
  added: [0, 192, 255, 255]
} as const;

export interface VisualImageDimensions {
  width: number;
  height: number;
}

export interface VisualChangedBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DirectVisualImageComparison {
  algorithm: typeof VISUAL_REPAIR_IMAGE_COMPARISON_ALGORITHM;
  width: number;
  height: number;
  beforeDimensions: VisualImageDimensions;
  afterDimensions: VisualImageDimensions;
  changedBoundingBox: VisualChangedBoundingBox | null;
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
    const width = Math.max(before.width, after.width);
    const height = Math.max(before.height, after.height);
    const diff = new PNG({ width, height });
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const beforeExists = x < before.width && y < before.height;
        const afterExists = x < after.width && y < after.height;
        if (beforeExists && !afterExists) {
          writeDiagnosticPixel(diff, x, y, VISUAL_REPAIR_IMAGE_COMPARISON_DIAGNOSTIC_COLORS.removed);
        } else if (!beforeExists && afterExists) {
          writeDiagnosticPixel(diff, x, y, VISUAL_REPAIR_IMAGE_COMPARISON_DIAGNOSTIC_COLORS.added);
        } else if (beforeExists && afterExists && !pixelsEqual(before, after, x, y)) {
          writeDiagnosticPixel(diff, x, y, VISUAL_REPAIR_IMAGE_COMPARISON_DIAGNOSTIC_COLORS.changed);
        }
      }
    }
    const diffPng = PNG.sync.write(diff);
    const totalPixels = width * height;
    return {
      algorithm: VISUAL_REPAIR_IMAGE_COMPARISON_ALGORITHM,
      width,
      height,
      beforeDimensions: dimensionsOf(before),
      afterDimensions: dimensionsOf(after),
      changedBoundingBox: changedBoundingBox(diff),
      diffPixels: totalPixels,
      totalPixels,
      diffRatio: 1,
      beforeSha256: sha256Bytes(beforeBytes),
      afterSha256: sha256Bytes(afterBytes),
      diffSha256: sha256Bytes(diffPng),
      diffPng
    };
  }
  const diff = new PNG({ width: before.width, height: before.height });
  const diffPixels = pixelmatch(before.data, after.data, diff.data, before.width, before.height, {
    threshold: 0.1,
    includeAA: false,
    diffMask: true,
    diffColor: [
      VISUAL_REPAIR_IMAGE_COMPARISON_DIAGNOSTIC_COLORS.changed[0],
      VISUAL_REPAIR_IMAGE_COMPARISON_DIAGNOSTIC_COLORS.changed[1],
      VISUAL_REPAIR_IMAGE_COMPARISON_DIAGNOSTIC_COLORS.changed[2]
    ]
  });
  const totalPixels = before.width * before.height;
  const diffPng = PNG.sync.write(diff);
  return {
    algorithm: VISUAL_REPAIR_IMAGE_COMPARISON_ALGORITHM,
    width: before.width,
    height: before.height,
    beforeDimensions: dimensionsOf(before),
    afterDimensions: dimensionsOf(after),
    changedBoundingBox: changedBoundingBox(diff),
    diffPixels,
    totalPixels,
    diffRatio: diffPixels / totalPixels,
    beforeSha256: sha256Bytes(beforeBytes),
    afterSha256: sha256Bytes(afterBytes),
    diffSha256: sha256Bytes(diffPng),
    diffPng
  };
}

function dimensionsOf(image: Pick<PNG, "width" | "height">): VisualImageDimensions {
  return { width: image.width, height: image.height };
}

function pixelsEqual(before: PNG, after: PNG, x: number, y: number): boolean {
  const beforeOffset = (y * before.width + x) * 4;
  const afterOffset = (y * after.width + x) * 4;
  for (let channel = 0; channel < 4; channel += 1) {
    if (before.data[beforeOffset + channel] !== after.data[afterOffset + channel]) return false;
  }
  return true;
}

function writeDiagnosticPixel(image: PNG, x: number, y: number, rgba: readonly [number, number, number, number]): void {
  const offset = (y * image.width + x) * 4;
  image.data[offset] = rgba[0];
  image.data[offset + 1] = rgba[1];
  image.data[offset + 2] = rgba[2];
  image.data[offset + 3] = rgba[3];
}

function changedBoundingBox(diff: PNG): VisualChangedBoundingBox | null {
  let minX = diff.width;
  let minY = diff.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < diff.height; y += 1) {
    for (let x = 0; x < diff.width; x += 1) {
      if (diff.data[(y * diff.width + x) * 4 + 3] === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function readPng(value: Uint8Array, label: string): PNG {
  try {
    return PNG.sync.read(Buffer.isBuffer(value) ? value : Buffer.from(value));
  } catch (error) {
    throw new Error(`Visual Hive could not decode the ${label} PNG for direct comparison: ${error instanceof Error ? error.message : String(error)}`);
  }
}
