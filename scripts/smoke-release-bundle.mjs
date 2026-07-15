import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  const manifest = JSON.parse(await readFile(path.join(outputDir, "release-manifest.json"), "utf8"));
  const version = await runCapture(process.execPath, [entrypoint, "--version"], repoRoot);
  if (version.stdout.trim() !== manifest.version) {
    throw new Error(`release entrypoint version mismatch: expected ${manifest.version}, got ${version.stdout.trim()}`);
  }
  await run(process.execPath, [entrypoint, "doctor", "--config", path.join(repoRoot, "examples", "demo-react-app", "visual-hive.config.yaml")], repoRoot);

  await mkdir(path.join(tempRoot, "schemas"));
  await writeFile(
    path.join(tempRoot, "schemas", "visual-hive.report.schema.json"),
    '{"$id":"https://consumer.invalid/report.schema.json","type":"object"}\n',
    "utf8"
  );
  await run(
    process.execPath,
    [
      entrypoint,
      "schemas",
      "verify",
      "--output",
      path.join(tempRoot, "schema-catalog.json")
    ],
    tempRoot
  );
  const catalog = JSON.parse(await readFile(path.join(tempRoot, "schema-catalog.json"), "utf8"));
  if (catalog.status !== "passed" || catalog.summary.schemasChecked < 50 || catalog.schemasDir === "schemas") {
    throw new Error("release schema catalog was shadowed by the consumer schemas directory");
  }
  const capabilityPath = path.join(tempRoot, "capability-parity.json");
  await run(process.execPath, [
    entrypoint,
    "capabilities",
    "--output",
    capabilityPath,
    "--format",
    "json"
  ], tempRoot);
  const capabilityParity = JSON.parse(await readFile(capabilityPath, "utf8"));
  if (capabilityParity.status !== "passed"
    || capabilityParity.summary.missing !== 0
    || capabilityParity.summary.unexpected !== 0
    || capabilityParity.summary.mismatched !== 0
    || capabilityParity.domains.length !== 11) {
    throw new Error("release entrypoint capability surface does not match the frozen parity baseline");
  }

  const fixtureRoot = path.join(tempRoot, "bundle-fixture");
  const fixtureHiveRoot = path.join(fixtureRoot, ".visual-hive", "hive");
  await mkdir(fixtureHiveRoot, { recursive: true });
  await writeFile(path.join(fixtureRoot, "visual-hive.config.yaml"), [
    "project:",
    "  name: release-identity-smoke",
    "targets:",
    "  local:",
    "    kind: url",
    "    url: http://127.0.0.1:4173",
    "contracts:",
    "  - id: shell",
    "    description: Shell renders",
    "    target: local",
    "    runOn:",
    "      pullRequest: true",
    ""
  ].join("\n"), "utf8");
  await writeJson(path.join(fixtureHiveRoot, "hive-export.json"), {
    project: "release-identity-smoke",
    mode: "measured",
    status: "ready",
    acmmLevel: 3,
    externalCallsMade: 0
  });
  await writeJson(path.join(fixtureHiveRoot, "hive-import-manifest.json"), { status: "ready", sourceArtifacts: {} });
  await writeJson(path.join(fixtureHiveRoot, "hive-validation-summary.json"), { status: "passed" });
  await writeJson(path.join(fixtureHiveRoot, "hive-setup-pack.json"), { schemaVersion: "smoke.v1" });
  await writeFile(path.join(fixtureHiveRoot, "hive-setup-pack.md"), "# Setup pack\n", "utf8");
  await writeJson(path.join(fixtureRoot, ".visual-hive", "issues.json"), { issues: [] });
  await run(process.execPath, [
    entrypoint,
    "capabilities",
    "--output",
    path.join(fixtureRoot, ".visual-hive", "capability-parity.json"),
    "--format",
    "json"
  ], fixtureRoot);
  await run(process.execPath, [
    entrypoint,
    "artifacts",
    "--config",
    path.join(fixtureRoot, "visual-hive.config.yaml"),
    "--complete",
    "--format",
    "json"
  ], fixtureRoot);
  const bundleOutput = await runCapture(process.execPath, [
    entrypoint,
    "hive",
    "bundle",
    "--trusted-source",
    "--output-dir",
    ".visual-hive/release-identity-bundles",
    "--format",
    "json"
  ], fixtureRoot, {
    npm_package_version: "99.99.99-consumer",
    VISUAL_HIVE_VERSION: "99.99.99-env",
    GITHUB_ACTIONS: "true",
    GITHUB_REPOSITORY: "example/release-identity-smoke",
    GITHUB_REPOSITORY_ID: "1234",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    GITHUB_SHA: "c".repeat(40),
    GITHUB_WORKFLOW: "Visual Hive release smoke",
    GITHUB_RUN_ID: "1001",
    GITHUB_RUN_ATTEMPT: "1",
    VISUAL_HIVE_WORKFLOW_ARTIFACT_ID: "9001",
    VISUAL_HIVE_SOURCE_CONCLUSION: "success"
  });
  const bundle = JSON.parse(bundleOutput.stdout);
  if (bundle.schemaVersion !== "visual-hive.bundle.v3"
    || bundle.source.trusted !== true
    || bundle.producer.version !== manifest.version
    || bundle.producer.gitCommit !== manifest.gitCommit) {
    throw new Error("release bundle producer identity does not match the immutable release manifest");
  }

  if (manifest.schemaVersion !== "visual-hive.release.v1"
    || manifest.release !== true
    || manifest.clean !== true
    || !/^[a-f0-9]{40}$/.test(manifest.gitCommit)
    || manifest.files.length < 10) {
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
  if (!manifest.files.some((file) => file.path.startsWith("schemas/") && file.path.endsWith(".schema.json"))) {
    throw new Error("release manifest does not contain the Visual Hive schemas");
  }
  for (const dependency of ["@playwright/test", "pixelmatch", "pngjs"]) {
    const packagePath = `node_modules/${dependency}/package.json`;
    if (!manifest.files.some((file) => file.path === packagePath)) {
      throw new Error(`release manifest does not contain runtime dependency ${dependency}`);
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

function runCapture(command, args, cwd, env = {}) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
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
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${path.basename(command)} exited ${code}: ${stderr || stdout}`));
    });
  });
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
