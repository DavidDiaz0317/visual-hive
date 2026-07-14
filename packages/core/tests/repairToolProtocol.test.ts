import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import {
  VISUAL_REPAIR_TOOL_NAMES,
  VisualRepairToolRequestSchema
} from "../src/index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const common = {
  taskId: "task.card",
  repository: "owner/repo",
  taskContextDigest: "a".repeat(64)
};

describe("Visual repair tool protocol", () => {
  it("freezes exactly the eight read-only treatment tools", () => {
    expect(VISUAL_REPAIR_TOOL_NAMES).toEqual([
      "visual_hive_get_task_context",
      "visual_hive_get_issue_context",
      "visual_hive_search_surface",
      "visual_hive_get_visual_asset",
      "visual_hive_get_screenshot_set",
      "visual_hive_get_browser_evidence",
      "visual_hive_compare_assets",
      "visual_hive_get_repair_validation"
    ]);
  });

  it("parses identity-bound requests and rejects widened arguments", () => {
    const request = VisualRepairToolRequestSchema.parse({
      tool: "visual_hive_get_visual_asset",
      arguments: { ...common, assetId: "asset.expected" }
    });
    expect(request.arguments).toMatchObject({ maxBytes: 8 * 1024 * 1024 });

    expect(() => VisualRepairToolRequestSchema.parse({
      tool: "visual_hive_get_visual_asset",
      arguments: { ...common, assetId: "asset.expected", path: "../../secret" }
    })).toThrow();
    expect(() => VisualRepairToolRequestSchema.parse({
      tool: "visual_hive_get_browser_evidence",
      arguments: { ...common, runId: "run.before", contractId: "contract.card" }
    })).toThrow();
    expect(() => VisualRepairToolRequestSchema.parse({
      tool: "visual_hive_get_screenshot_set",
      arguments: {
        ...common,
        runId: "run.before",
        runContextDigest: "b".repeat(64),
        commitSha: "c".repeat(40),
        contractId: "contract.card",
        screenshotName: "Card",
        route: "/",
        state: "default",
        viewportId: "viewport.desktop",
        roles: ["actual", "actual"]
      }
    })).toThrow("unique");
  });

  it("matches the checked-in JSON Schema", async () => {
    const schema = JSON.parse(await readFile(path.join(repoRoot, "schemas/visual-hive.mcp-repair-tool-request.schema.json"), "utf8"));
    const validate = new Ajv2020({ allErrors: true, strict: false, validateFormats: false }).compile(schema);
    const valid = {
      tool: "visual_hive_compare_assets",
      arguments: {
        ...common,
        before: { source: "task", assetId: "asset.before" },
        after: { source: "run", runId: "run.after", runContextDigest: "b".repeat(64), commitSha: "c".repeat(40), assetId: "asset.after" }
      }
    };
    expect(validate(valid), JSON.stringify(validate.errors, null, 2)).toBe(true);
    expect(validate({ ...valid, arguments: { ...valid.arguments, command: "npm test" } })).toBe(false);
  });
});
