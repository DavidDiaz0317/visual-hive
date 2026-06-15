import { constants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ScreenshotAssertionResult, VisualHiveConfig } from "@visual-hive/core";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

export interface ComparePngSnapshotOptions {
  baselinePath: string;
  actualPath: string;
  diffPath: string;
  actualBuffer: Buffer;
  ci: boolean;
  visual: VisualHiveConfig["visual"];
  contractId?: string;
  name: string;
  route: string;
  viewport: string;
}

export async function comparePngSnapshot(options: ComparePngSnapshotOptions): Promise<ScreenshotAssertionResult> {
  await mkdir(path.dirname(options.baselinePath), { recursive: true });
  await mkdir(path.dirname(options.actualPath), { recursive: true });

  const baseAssertion = {
    contractId: options.contractId ?? "",
    screenshotName: options.name,
    name: options.name,
    route: options.route,
    viewport: options.viewport,
    status: "passed" as const,
    baselinePath: options.baselinePath,
    actualPath: options.actualPath,
    maxDiffPixelRatio: options.visual.maxDiffPixelRatio,
    maxDiffPixels: options.visual.maxDiffPixels,
    actualDiffPixelRatio: 0,
    actualDiffPixels: 0,
    diffPixels: 0,
    totalPixels: imagePixelCount(options.actualBuffer)
  };

  const baselineExists = await exists(options.baselinePath);
  if (!baselineExists || options.visual.updateSnapshots) {
    await writeFile(options.actualPath, options.actualBuffer);
    if (!baselineExists && options.ci && options.visual.failOnMissingBaselineInCI && !options.visual.updateSnapshots) {
      return {
        ...baseAssertion,
        status: "missing_baseline",
        actualDiffPixelRatio: 1,
        actualDiffPixels: baseAssertion.totalPixels,
        diffPixels: baseAssertion.totalPixels,
        message: `Missing screenshot baseline in CI mode: ${options.baselinePath}`
      };
    }
    await writeFile(options.baselinePath, options.actualBuffer);
    return {
      ...baseAssertion,
      status: baselineExists ? "passed" : "created"
    };
  }

  const baseline = await readFile(options.baselinePath);
  await writeFile(options.actualPath, options.actualBuffer);
  const diff = diffImages(baseline, options.actualBuffer);
  const failed =
    diff.actualDiffPixelRatio > options.visual.maxDiffPixelRatio ||
    (typeof options.visual.maxDiffPixels === "number" && diff.diffPixels > options.visual.maxDiffPixels);
  if (diff.diffPixels > 0) {
    await mkdir(path.dirname(options.diffPath), { recursive: true });
    await writeFile(options.diffPath, PNG.sync.write(diff.diffImage));
  }

  return {
    ...baseAssertion,
    status: failed ? "failed" : "passed",
    diffPath: diff.diffPixels > 0 ? options.diffPath : undefined,
    actualDiffPixelRatio: diff.actualDiffPixelRatio,
    actualDiffPixels: diff.diffPixels,
    diffPixels: diff.diffPixels,
    totalPixels: diff.totalPixels
  };
}

function diffImages(baselineBuffer: Buffer, actualBuffer: Buffer): {
  diffImage: PNG;
  diffPixels: number;
  totalPixels: number;
  actualDiffPixelRatio: number;
} {
  const baseline = PNG.sync.read(baselineBuffer);
  const actual = PNG.sync.read(actualBuffer);
  if (baseline.width !== actual.width || baseline.height !== actual.height) {
    const width = Math.max(baseline.width, actual.width);
    const height = Math.max(baseline.height, actual.height);
    return {
      diffImage: new PNG({ width, height }),
      diffPixels: width * height,
      totalPixels: width * height,
      actualDiffPixelRatio: 1
    };
  }

  const diffImage = new PNG({ width: baseline.width, height: baseline.height });
  const diffPixels = pixelmatch(baseline.data, actual.data, diffImage.data, baseline.width, baseline.height, { threshold: 0.1 });
  const totalPixels = baseline.width * baseline.height;
  return {
    diffImage,
    diffPixels,
    totalPixels,
    actualDiffPixelRatio: totalPixels === 0 ? 0 : diffPixels / totalPixels
  };
}

function imagePixelCount(buffer: Buffer): number {
  const image = PNG.sync.read(buffer);
  return image.width * image.height;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
