#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveReleaseSourceIdentity } from "./release-source-identity.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = path.join(repoRoot, "packages", "cli");

// Validate before mutating dist, then rebuild from an empty directory so ignored
// or stale developer output can never enter the distributable package.
const sourceIdentity = resolveReleaseSourceIdentity({ repoRoot, requireClean: true });
await rm(path.join(packageRoot, "dist"), { recursive: true, force: true });
runNode(path.join(repoRoot, "node_modules", "typescript", "bin", "tsc"), [
  "-p",
  path.join(packageRoot, "tsconfig.json")
]);
runNode(path.join(repoRoot, "scripts", "copy-cli-schemas.mjs"), ["--release"], {
  ...process.env,
  VISUAL_HIVE_GIT_COMMIT: sourceIdentity.gitCommit
});

function runNode(script, args, env = process.env) {
  execFileSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    windowsHide: true,
    timeout: 120_000,
    env,
    stdio: "inherit"
  });
}
