import { createHash } from "node:crypto";
import { mkdir, mkdtemp, open, rm, symlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { indexArtifacts } from "../src/artifacts/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("stable artifact indexing", () => {
  it("derives the byte count, digest, schema, and preview from one file-handle read", async () => {
    const root = await artifactRoot("visual-hive-stable-artifact-");
    const artifactPath = path.join(root, ".visual-hive", "report.json");
    const data = Buffer.from('{"message":"stable €漢字"}\n', "utf8");
    await writeFile(artifactPath, data);

    await interceptFileHandleReads(artifactPath, async () => undefined, async (readCount) => {
      const report = await indexArtifacts({ repoRoot: root, complete: true, maxPreviewBytes: data.byteLength });
      const artifact = report.artifacts.find((entry) => entry.path === ".visual-hive/report.json");

      expect(readCount()).toBe(1);
      expect(artifact).toMatchObject({
        bytes: data.byteLength,
        sha256: createHash("sha256").update(data).digest("hex"),
        preview: data.toString("utf8"),
        previewTruncated: false,
        schemaPath: "schemas/visual-hive.report.schema.json",
        schemaId: "https://visual-hive.dev/schemas/visual-hive.report.schema.json"
      });
    });
  });

  it("fails closed when an artifact mutates after its single read", async () => {
    const root = await artifactRoot("visual-hive-mutating-artifact-");
    const artifactPath = path.join(root, ".visual-hive", "report.json");
    await writeFile(artifactPath, '{"status":"before"}\n', "utf8");

    await interceptFileHandleReads(
      artifactPath,
      async (readCount) => {
        if (readCount === 1) await writeFile(artifactPath, '{"status":"changed-after-read"}\n', "utf8");
      },
      async (readCount) => {
        await expect(indexArtifacts({ repoRoot: root, complete: true })).rejects.toThrow(
          "Artifact changed while complete indexing read it: .visual-hive/report.json"
        );
        expect(readCount()).toBe(1);
      }
    );
  });

  it("fails closed when an enumerated directory snapshot changes", async () => {
    const root = await artifactRoot("visual-hive-mutating-directory-");
    const nested = path.join(root, ".visual-hive", "nested");
    const artifactPath = path.join(nested, "report.json");
    await mkdir(nested, { recursive: true });
    await writeFile(artifactPath, '{"status":"stable"}\n', "utf8");

    await interceptFileHandleReads(
      artifactPath,
      async (readCount) => {
        if (readCount !== 1) return;
        await writeFile(path.join(nested, "late.json"), "{}\n", "utf8");
        await utimes(nested, new Date("2020-01-01T00:00:00.000Z"), new Date("2020-01-01T00:00:00.000Z"));
      },
      async () => {
        await expect(indexArtifacts({ repoRoot: root, complete: true })).rejects.toThrow(
          "Complete artifact indexing directory changed during traversal: .visual-hive/nested"
        );
      }
    );
  });

  it("rejects a linked ancestor of the requested artifact root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "visual-hive-linked-ancestor-"));
    roots.push(root);
    const actualParent = path.join(root, "actual");
    const actualHiveRoot = path.join(actualParent, "hive");
    await mkdir(actualHiveRoot, { recursive: true });
    await symlink(actualParent, path.join(root, "linked"), process.platform === "win32" ? "junction" : "dir");

    await expect(indexArtifacts({
      repoRoot: root,
      hiveRoot: path.join(root, "linked", "hive"),
      complete: true
    })).rejects.toThrow("Complete artifact indexing refuses symbolic link or reparse point: linked");
  });

  it("rejects a linked child discovered during complete traversal", async () => {
    const root = await artifactRoot("visual-hive-linked-child-");
    const linkedTarget = path.join(root, "linked-target");
    await mkdir(linkedTarget, { recursive: true });
    await symlink(linkedTarget, path.join(root, ".visual-hive", "linked"), process.platform === "win32" ? "junction" : "dir");

    await expect(indexArtifacts({ repoRoot: root, complete: true })).rejects.toThrow(
      "Complete artifact indexing refuses non-regular entry: .visual-hive/linked"
    );
  });
});

async function artifactRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  roots.push(root);
  await mkdir(path.join(root, ".visual-hive"), { recursive: true });
  return root;
}

type ReadableFileHandle = {
  readFile(): Promise<Buffer>;
};

async function interceptFileHandleReads(
  filePath: string,
  afterRead: (readCount: number, data: Buffer) => Promise<void>,
  run: (readCount: () => number) => Promise<void>
): Promise<void> {
  const probe = await open(filePath, "r");
  const prototype = Object.getPrototypeOf(probe) as ReadableFileHandle;
  const originalReadFile = prototype.readFile;
  await probe.close();
  let reads = 0;
  prototype.readFile = async function readFile(): Promise<Buffer> {
    const data = await originalReadFile.call(this);
    reads += 1;
    await afterRead(reads, data);
    return data;
  };
  try {
    await run(() => reads);
  } finally {
    prototype.readFile = originalReadFile;
  }
}
