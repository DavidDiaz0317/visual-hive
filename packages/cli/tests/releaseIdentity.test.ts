import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { resolveVisualHiveReleaseIdentity } from "../src/releaseIdentity.js";
import { visualHiveVersion } from "../src/version.js";

const cliRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const previousNpmPackageVersion = process.env.npm_package_version;
const previousVisualHiveVersion = process.env.VISUAL_HIVE_VERSION;
const tempRoots: string[] = [];

afterEach(async () => {
  restore("npm_package_version", previousNpmPackageVersion);
  restore("VISUAL_HIVE_VERSION", previousVisualHiveVersion);
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("installed Visual Hive release identity", () => {
  it("uses the shipped identity instead of consumer npm environment metadata", async () => {
    const shipped = JSON.parse(await readFile(path.join(cliRoot, "dist", "release-identity.json"), "utf8"));
    process.env.npm_package_version = "99.99.99-consumer";
    process.env.VISUAL_HIVE_VERSION = "99.99.99-environment";

    const identity = await resolveVisualHiveReleaseIdentity();

    expect(identity).toEqual({
      version: shipped.version,
      gitCommit: shipped.gitCommit,
      release: shipped.release === true,
      clean: shipped.clean === true
    });
    expect(identity.version).not.toBe(process.env.npm_package_version);
    expect(identity.version).not.toBe(process.env.VISUAL_HIVE_VERSION);
    expect(identity.gitCommit).toMatch(/^[a-f0-9]{40}$/);
  });

  it("accepts an explicit clean release identity for hosted publication", async () => {
    const candidate = await writeIdentity({ release: true, clean: true });

    await expect(resolveVisualHiveReleaseIdentity({
      requireRelease: true,
      candidates: [candidate]
    })).resolves.toMatchObject({ release: true, clean: true, gitCommit: "a".repeat(40) });
  });

  it("keeps legacy or developer identity usable locally but rejects it for hosted publication", async () => {
    const candidate = await writeIdentity({});

    await expect(resolveVisualHiveReleaseIdentity({ candidates: [candidate] })).resolves.toMatchObject({
      release: false,
      clean: false,
      gitCommit: "a".repeat(40)
    });
    await expect(resolveVisualHiveReleaseIdentity({
      requireRelease: true,
      candidates: [candidate]
    })).rejects.toThrow("installed clean release identity");
  });

  it("rejects inconsistent release markers and missing hosted identity", async () => {
    const inconsistent = await writeIdentity({ release: true, clean: false });
    const missing = path.join(await makeTempRoot(), "missing.json");

    await expect(resolveVisualHiveReleaseIdentity({ candidates: [inconsistent] })).rejects.toThrow("release/clean marker");
    await expect(resolveVisualHiveReleaseIdentity({
      requireRelease: true,
      candidates: [missing]
    })).rejects.toThrow("installed clean release identity");
  });

  it("allows unavailable developer identity only for local compatibility", async () => {
    const candidate = await writeIdentity({ release: false, clean: false }, "unavailable");

    await expect(resolveVisualHiveReleaseIdentity({ candidates: [candidate] })).resolves.toMatchObject({
      gitCommit: "unavailable",
      release: false,
      clean: false
    });
    await expect(resolveVisualHiveReleaseIdentity({
      requireRelease: true,
      candidates: [candidate]
    })).rejects.toThrow("installed clean release identity");
  });
});

async function writeIdentity(
  markers: { release?: boolean; clean?: boolean },
  gitCommit = "a".repeat(40)
): Promise<string> {
  const candidate = path.join(await makeTempRoot(), "release-identity.json");
  await writeFile(candidate, `${JSON.stringify({
    schemaVersion: "visual-hive.release-identity.v1",
    name: "visual-hive",
    version: visualHiveVersion,
    gitCommit,
    ...markers
  })}\n`, "utf8");
  return candidate;
}

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-hive-release-identity-"));
  tempRoots.push(root);
  return root;
}

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
