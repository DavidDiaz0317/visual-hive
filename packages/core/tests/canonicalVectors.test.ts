import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { canonicalJson, canonicalSha256 } from "../src/index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

describe("visual-hive.canonical-json.sha256.v1 cross-language vectors", () => {
  it("matches the immutable canonical text and SHA-256 fixtures", async () => {
    const raw = await readFile(path.join(repoRoot, "schemas/fixtures/visual-hive.canonical-json.sha256.v1.json"), "utf8");
    const fixture = JSON.parse(raw) as {
      algorithm: string;
      vectors: Array<{ name: string; input: string; canonical: string; sha256: string }>;
    };
    expect(fixture.algorithm).toBe("visual-hive.canonical-json.sha256.v1");
    expect(fixture.vectors).toHaveLength(4);
    for (const vector of fixture.vectors) {
      const value = JSON.parse(vector.input) as unknown;
      expect(canonicalJson(value), vector.name).toBe(vector.canonical);
      expect(canonicalSha256(value), vector.name).toBe(vector.sha256);
    }
  });
});
