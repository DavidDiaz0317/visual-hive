import { createHash } from "node:crypto";
import { cp, chmod, lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { resolveReleaseSourceIdentity } from "./release-source-identity.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
const verifyTreeOnly = valueAfter("--verify-tree-only");
if (verifyTreeOnly) {
  console.log(JSON.stringify(await listFiles(path.resolve(verifyTreeOnly))));
  process.exit(0);
}
const outputDir = path.resolve(repoRoot, valueAfter("--output") ?? path.join("dist", `visual-hive-${packageJson.version}`));
const sourceIdentity = resolveReleaseSourceIdentity({ repoRoot, requireClean: true });

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

await build({
  entryPoints: [path.join(repoRoot, "packages", "cli", "dist", "index.js")],
  outfile: path.join(outputDir, "visual-hive.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: false,
  legalComments: "linked",
  banner: {
    js: "import { createRequire as __visualHiveCreateRequire } from 'node:module'; const require = __visualHiveCreateRequire(import.meta.url);"
  }
});

for (const dependency of ["@playwright/test", "playwright", "playwright-core", "pixelmatch", "pngjs"]) {
  const source = path.join(repoRoot, "node_modules", ...dependency.split("/"));
  const destination = path.join(outputDir, "node_modules", ...dependency.split("/"));
  await cp(source, destination, { recursive: true });
}

const webSource = path.join(repoRoot, "packages", "control-plane", "dist", "web");
await cp(webSource, path.join(outputDir, "web"), { recursive: true });

// Schema verification is part of the public CLI contract. Keep the schemas next
// to the bundled entrypoint so consumers never need a Visual Hive source checkout.
await cp(path.join(repoRoot, "schemas"), path.join(outputDir, "schemas"), { recursive: true });

await writeFile(
  path.join(outputDir, "visual-hive"),
  "#!/usr/bin/env sh\nset -eu\nexec node \"$(CDPATH= cd -- \"$(dirname -- \"$0\")\" && pwd)/visual-hive.mjs\" \"$@\"\n",
  "utf8"
);
await chmod(path.join(outputDir, "visual-hive"), 0o755);
await writeFile(
  path.join(outputDir, "visual-hive.cmd"),
  "@echo off\r\nnode \"%~dp0visual-hive.mjs\" %*\r\n",
  "utf8"
);

const files = await listFiles(outputDir);
const inventory = [];
for (const relativePath of files) {
  const data = await readFile(path.join(outputDir, relativePath));
  inventory.push({
    path: relativePath.replaceAll("\\", "/"),
    sha256: createHash("sha256").update(data).digest("hex"),
    size: data.byteLength
  });
}
const playwrightPackage = JSON.parse(
  await readFile(path.join(repoRoot, "node_modules", "@playwright", "test", "package.json"), "utf8")
);
const finalSourceIdentity = resolveReleaseSourceIdentity({ repoRoot, requireClean: true });
if (finalSourceIdentity.gitCommit !== sourceIdentity.gitCommit) {
  throw new Error("Visual Hive release HEAD changed while building the release bundle.");
}
await writeFile(
  path.join(outputDir, "release-manifest.json"),
  `${JSON.stringify(
    {
      schemaVersion: "visual-hive.release.v1",
      name: "visual-hive",
      version: packageJson.version,
      gitCommit: sourceIdentity.gitCommit,
      release: true,
      clean: sourceIdentity.clean,
      node: ">=22",
      entrypoint: "visual-hive.mjs",
      playwrightVersion: playwrightPackage.version,
      files: inventory
    },
    null,
    2
  )}\n`,
  "utf8"
);

console.log(outputDir);

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

async function listFiles(root) {
  const rootInfo = await lstat(root);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
    throw new Error("release bundle root must be a real directory");
  }
  const result = [];
  async function visit(current, prefix = "") {
    for (const name of (await readdir(current)).sort()) {
      const absolute = path.join(current, name);
      const relative = path.join(prefix, name);
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) throw new Error(`release bundle cannot contain symlinks: ${relative}`);
      if (info.isDirectory()) await visit(absolute, relative);
      else if (info.isFile()) result.push(relative);
      else throw new Error(`release bundle cannot contain non-regular entries: ${relative}`);
    }
  }
  await visit(root);
  return result;
}
