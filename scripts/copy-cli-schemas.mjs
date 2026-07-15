#!/usr/bin/env node
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveReleaseSourceIdentity } from "./release-source-identity.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const destination = path.join(repoRoot, "packages", "cli", "dist", "schemas");
const packageRoot = path.join(repoRoot, "packages", "cli");
const packageMetadata = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
const release = process.argv.includes("--release");
const sourceIdentity = resolveReleaseSourceIdentity({ repoRoot, requireClean: release });

await rm(destination, { recursive: true, force: true });
await cp(path.join(repoRoot, "schemas"), destination, { recursive: true });
if (release) {
  const finalSourceIdentity = resolveReleaseSourceIdentity({ repoRoot, requireClean: true });
  if (finalSourceIdentity.gitCommit !== sourceIdentity.gitCommit) {
    throw new Error("Visual Hive release HEAD changed while building the CLI package identity.");
  }
}
await writeFile(
  path.join(packageRoot, "dist", "release-identity.json"),
  `${JSON.stringify({
    schemaVersion: "visual-hive.release-identity.v1",
    name: "visual-hive",
    version: packageMetadata.version,
    gitCommit: sourceIdentity.gitCommit,
    release,
    clean: sourceIdentity.clean
  }, null, 2)}\n`,
  "utf8"
);
console.log(`Copied Visual Hive schemas to ${destination}`);
