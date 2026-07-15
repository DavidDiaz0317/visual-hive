import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { resolveVisualHiveSchemasDir } from "../src/schemaLocation.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("packaged schema location", () => {
  it("does not let an unrelated consumer schemas directory shadow the shipped catalog", async () => {
    const consumerRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-schema-collision-"));
    roots.push(consumerRoot);
    const consumerSchemas = path.join(consumerRoot, "schemas");
    await mkdir(consumerSchemas);
    await writeFile(
      path.join(consumerSchemas, "visual-hive.report.schema.json"),
      JSON.stringify({ $id: "https://consumer.invalid/report.schema.json", type: "object" }),
      "utf8"
    );

    const resolved = await resolveVisualHiveSchemasDir(consumerRoot);

    expect(resolved).toBe(path.join(repoRoot, "schemas"));
    expect(resolved).not.toBe(consumerSchemas);
  });

  it("rejects an explicitly selected directory that is not a Visual Hive catalog", async () => {
    const consumerRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-schema-invalid-"));
    roots.push(consumerRoot);
    await mkdir(path.join(consumerRoot, "schemas"));
    await writeFile(path.join(consumerRoot, "schemas", "consumer.schema.json"), "{}\n", "utf8");

    await expect(resolveVisualHiveSchemasDir(consumerRoot, "schemas")).rejects.toThrow(/missing visual-hive\.agent-packet\.schema\.json/);
  });
});
