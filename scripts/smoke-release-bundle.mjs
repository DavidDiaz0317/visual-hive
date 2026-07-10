import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-release-"));
const outputDir = path.join(tempRoot, "visual-hive");

try {
  await run(process.execPath, [path.join(repoRoot, "scripts", "build-release-bundle.mjs"), "--output", outputDir], repoRoot);
  const entrypoint = path.join(outputDir, "visual-hive.mjs");
  await run(process.execPath, [entrypoint, "--version"], repoRoot);
  await run(process.execPath, [entrypoint, "doctor", "--config", path.join(repoRoot, "examples", "demo-react-app", "visual-hive.config.yaml")], repoRoot);
  const manifest = JSON.parse(await readFile(path.join(outputDir, "release-manifest.json"), "utf8"));
  if (manifest.schemaVersion !== "visual-hive.release.v1" || !/^[a-f0-9]{40}$/.test(manifest.gitCommit) || manifest.files.length < 10) {
    throw new Error("release manifest is incomplete or not bound to an immutable commit");
  }
  for (const file of manifest.files) {
    if (path.isAbsolute(file.path) || file.path.split("/").includes("..") || file.path.includes("\\")) {
      throw new Error(`unsafe release path: ${file.path}`);
    }
    const data = await readFile(path.join(outputDir, ...file.path.split("/")));
    const digest = createHash("sha256").update(data).digest("hex");
    if (data.byteLength !== file.size || digest !== file.sha256) {
      throw new Error(`release inventory mismatch: ${file.path}`);
    }
  }
  console.log(`Visual Hive release smoke passed (${manifest.files.length} files).`);
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit", windowsHide: true });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${path.basename(command)} timed out`));
    }, 180_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(command)} exited ${code}`));
    });
  });
}
