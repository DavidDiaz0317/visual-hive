import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { Command } from "commander";
import { afterEach, describe, expect, it } from "vitest";
import { VISUAL_HIVE_CAPABILITY_BASELINE } from "@visual-hive/core";
import { collectCliCapabilitySurface } from "../src/capabilitySurface.js";
import { runCapabilitiesCommand } from "../src/commands/capabilities.js";
import { program } from "../src/index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("capabilities command", () => {
  it("dynamically inventories Commander and writes a schema-valid frozen-baseline receipt", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "visual-hive-capabilities-"));
    roots.push(root);
    const cli = collectCliCapabilitySurface(program);
    const result = await runCapabilitiesCommand({
      cwd: root,
      schemasDir: path.join(repoRoot, "schemas"),
      cli,
      baseline: VISUAL_HIVE_CAPABILITY_BASELINE,
      now: new Date("2026-07-14T12:00:00.000Z")
    });

    expect(result.outputPath).toBe(path.join(root, ".visual-hive", "capability-parity.json"));
    expect(result.report.status).toBe("passed");
    expect(result.report.runtimeStatus).toBe("blocked");
    expect(result.report.summary.blocked).toBe(5);
    expect(result.report.domains.find((domain) => domain.domain === "workflowLanes")).toMatchObject({
      expected: 9,
      actual: 9,
      present: 9,
      missing: 0,
      unexpected: 0,
      mismatched: 0
    });
    expect(cli).toEqual(VISUAL_HIVE_CAPABILITY_BASELINE.cli);
    expect(cli).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "visual-hive", aliases: [] }),
      expect.objectContaining({ path: "capabilities", aliases: [] }),
      expect.objectContaining({ path: "baselines", aliases: ["baseline"] }),
      expect.objectContaining({ path: "baselines approve", aliases: ["baseline approve"] }),
      expect.objectContaining({ path: "connections add", aliases: ["connection add"] }),
      expect.objectContaining({ path: "workflows", aliases: ["workflow"] })
    ]));
    expect(cli.every((entry) => /^[a-f0-9]{64}$/.test(entry.contractSha256))).toBe(true);
    expect(VISUAL_HIVE_CAPABILITY_BASELINE.schemas.every((entry) => /^[a-f0-9]{64}$/.test(entry.sha256))).toBe(true);
    const artifactsCommand = program.commands.find((command) => command.name() === "artifacts");
    expect(artifactsCommand?.options.some((option) => option.long === "--complete")).toBe(true);
    const schemasVerifyCommand = program.commands
      .find((command) => command.name() === "schemas")
      ?.commands.find((command) => command.name() === "verify");
    expect(schemasVerifyCommand?.getOptionValue("schemasDir")).toBeUndefined();

    const written = JSON.parse(await readFile(result.outputPath, "utf8"));
    expect(written).toEqual(result.report);
    const schema = JSON.parse(await readFile(path.join(repoRoot, "schemas", "visual-hive.capability-parity.schema.json"), "utf8"));
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
    expect(validate(written), JSON.stringify(validate.errors, null, 2)).toBe(true);
  });

  it("content-addresses positional arguments and option contracts independently of command paths", () => {
    const base = new Command("fixture")
      .argument("<repository>")
      .option("--format <format>", "output format", "json");
    const changedArgument = new Command("fixture")
      .argument("[repository]")
      .option("--format <format>", "output format", "json");
    const changedOption = new Command("fixture")
      .argument("<repository>")
      .option("--format <format>", "output format", "text");

    const baseCapability = collectCliCapabilitySurface(base)[0]!;
    const changedArgumentCapability = collectCliCapabilitySurface(changedArgument)[0]!;
    const changedOptionCapability = collectCliCapabilitySurface(changedOption)[0]!;

    expect(changedArgumentCapability.path).toBe(baseCapability.path);
    expect(changedOptionCapability.path).toBe(baseCapability.path);
    expect(changedArgumentCapability.contractSha256).not.toBe(baseCapability.contractSha256);
    expect(changedOptionCapability.contractSha256).not.toBe(baseCapability.contractSha256);
  });
});
