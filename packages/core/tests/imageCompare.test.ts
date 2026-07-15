import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import {
  compareVisualPngBytes,
  VISUAL_REPAIR_IMAGE_COMPARISON_ALGORITHM,
  VISUAL_REPAIR_IMAGE_COMPARISON_DIAGNOSTIC_COLORS
} from "../src/index.js";

type Rgba = readonly [number, number, number, number];

describe("direct visual image comparison diagnostics", () => {
  it("reports the exact changed bounding box for equal-sized images without changing mismatch math", () => {
    const before = png(3, 2, () => [255, 255, 255, 255]);
    const after = png(3, 2, (x, y) => (x === 2 && y === 1 ? [0, 0, 0, 255] : [255, 255, 255, 255]));

    const comparison = compareVisualPngBytes(before, after);
    const diff = PNG.sync.read(comparison.diffPng);

    expect(comparison).toMatchObject({
      algorithm: VISUAL_REPAIR_IMAGE_COMPARISON_ALGORITHM,
      width: 3,
      height: 2,
      beforeDimensions: { width: 3, height: 2 },
      afterDimensions: { width: 3, height: 2 },
      changedBoundingBox: { x: 2, y: 1, width: 1, height: 1 },
      diffPixels: 1,
      totalPixels: 6,
      diffRatio: 1 / 6
    });
    expect(pixelAt(diff, 2, 1)).toEqual(VISUAL_REPAIR_IMAGE_COMPARISON_DIAGNOSTIC_COLORS.changed);
    expect(pixelAt(diff, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(compareVisualPngBytes(before, after).diffSha256).toBe(comparison.diffSha256);
  });

  it("returns no changed bounds for identical images", () => {
    const image = png(2, 1, () => [18, 52, 86, 255]);

    const comparison = compareVisualPngBytes(image, image);

    expect(comparison.diffPixels).toBe(0);
    expect(comparison.diffRatio).toBe(0);
    expect(comparison.changedBoundingBox).toBeNull();
  });

  it("renders changed, removed-only, and added-only pixels when dimensions differ", () => {
    const before = png(2, 2, (x, y) => {
      if (x === 0 && y === 0) return [255, 0, 0, 255];
      if (x === 1 && y === 0) return [0, 255, 0, 255];
      return x === 0 ? [0, 0, 255, 255] : [255, 255, 255, 255];
    });
    const after = png(3, 1, (x) => {
      if (x === 0) return [255, 0, 0, 255];
      if (x === 1) return [0, 0, 0, 255];
      return [255, 255, 0, 255];
    });

    const comparison = compareVisualPngBytes(before, after);
    const diff = PNG.sync.read(comparison.diffPng);

    expect(comparison).toMatchObject({
      width: 3,
      height: 2,
      beforeDimensions: { width: 2, height: 2 },
      afterDimensions: { width: 3, height: 1 },
      changedBoundingBox: { x: 0, y: 0, width: 3, height: 2 },
      diffPixels: 6,
      totalPixels: 6,
      diffRatio: 1
    });
    expect(pixelAt(diff, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(pixelAt(diff, 1, 0)).toEqual(VISUAL_REPAIR_IMAGE_COMPARISON_DIAGNOSTIC_COLORS.changed);
    expect(pixelAt(diff, 2, 0)).toEqual(VISUAL_REPAIR_IMAGE_COMPARISON_DIAGNOSTIC_COLORS.added);
    expect(pixelAt(diff, 0, 1)).toEqual(VISUAL_REPAIR_IMAGE_COMPARISON_DIAGNOSTIC_COLORS.removed);
    expect(pixelAt(diff, 1, 1)).toEqual(VISUAL_REPAIR_IMAGE_COMPARISON_DIAGNOSTIC_COLORS.removed);
    expect(pixelAt(diff, 2, 1)).toEqual([0, 0, 0, 0]);
    expect(comparison.diffSha256).not.toBe(compareVisualPngBytes(before, before).diffSha256);
  });
});

function png(width: number, height: number, color: (x: number, y: number) => Rgba): Buffer {
  const image = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const rgba = color(x, y);
      const offset = (y * width + x) * 4;
      image.data[offset] = rgba[0];
      image.data[offset + 1] = rgba[1];
      image.data[offset + 2] = rgba[2];
      image.data[offset + 3] = rgba[3];
    }
  }
  return PNG.sync.write(image);
}

function pixelAt(image: PNG, x: number, y: number): number[] {
  const offset = (y * image.width + x) * 4;
  return Array.from(image.data.subarray(offset, offset + 4));
}
