import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = path.join(repoRoot, "examples", "consumer-react-app");
const DEFAULT_COMMAND_TIMEOUT_MS = 180_000;
const publishableWorkspacePackages = [
  "core",
  "control-plane",
  "github-adapter",
  "llm-adapter",
  "playwright-adapter",
  "cli"
];
const inheritedGitHubContextVariables = [
  "GITHUB_ACTIONS",
  "GITHUB_EVENT_NAME",
  "GITHUB_HEAD_REF",
  "GITHUB_REF",
  "GITHUB_REF_NAME",
  "GITHUB_REPOSITORY",
  "GITHUB_REPOSITORY_ID",
  "GITHUB_RUN_ATTEMPT",
  "GITHUB_RUN_ID",
  "GITHUB_SHA",
  "GITHUB_WORKFLOW",
  "VISUAL_HIVE_SOURCE_CONCLUSION",
  "VISUAL_HIVE_WORKFLOW_ARTIFACT_ID"
];

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-consumer-"));
const appRoot = path.join(tempRoot, "consumer-react-app");
const packageRoot = path.join(tempRoot, "packages");
const configPath = path.join(appRoot, "visual-hive.config.yaml");
const changedFilesPath = path.join(appRoot, "changed-files.txt");
let completed = false;
let installedCliEntrypoint;

try {
  const packedDependencies = await packVisualHiveWorkspaces(packageRoot);
  await cp(fixtureRoot, appRoot, { recursive: true });
  await mkdir(path.join(appRoot, "schemas"));
  await writeFile(
    path.join(appRoot, "schemas", "visual-hive.report.schema.json"),
    '{"$id":"https://consumer.invalid/report.schema.json","type":"object"}\n',
    "utf8"
  );
  await writeFile(changedFilesPath, "src/App.jsx\nsrc/styles.css\n", "utf8");
  const consumerPackage = JSON.parse(await readFile(path.join(appRoot, "package.json"), "utf8"));
  consumerPackage.devDependencies = {
    ...consumerPackage.devDependencies,
    ...Object.fromEntries(
      packedDependencies.map(({ name, tarball }) => [
        name,
        `file:${path.relative(appRoot, tarball).replaceAll("\\", "/")}`
      ])
    )
  };
  await writeFile(path.join(appRoot, "package.json"), `${JSON.stringify(consumerPackage, null, 2)}\n`, "utf8");

  await run("npm", ["install"], appRoot);
  const installedPackage = await readJson(path.join(appRoot, "node_modules", "@visual-hive", "cli", "package.json"));
  const installedIdentity = await readJson(path.join(appRoot, "node_modules", "@visual-hive", "cli", "dist", "release-identity.json"));
  const sourceCommit = (await runCapture("git", ["rev-parse", "HEAD"], repoRoot)).stdout.trim();
  if (installedIdentity.schemaVersion !== "visual-hive.release-identity.v1"
    || installedIdentity.version !== installedPackage.version
    || installedIdentity.gitCommit !== sourceCommit
    || installedIdentity.release !== true
    || installedIdentity.clean !== true
    || !/^[a-f0-9]{40}$/.test(installedIdentity.gitCommit)) {
    throw new Error("Packed Visual Hive CLI release identity is missing or does not match the packed source.");
  }
  await run("npx", ["playwright", "install", "chromium"], appRoot);
  await run("npm", ["run", "build"], appRoot);
  installedCliEntrypoint = path.join(appRoot, "node_modules", "@visual-hive", "cli", "dist", "index.js");
  const version = await runVisualHiveCapture(["--version"], appRoot, {
    npm_package_version: "99.99.99-consumer"
  });
  if (version.stdout.trim() !== installedIdentity.version) {
    throw new Error(`Packed Visual Hive version mismatch: expected ${installedIdentity.version}, got ${version.stdout.trim()}`);
  }
  await runVisualHive([
    "schemas",
    "verify",
    "--output",
    ".visual-hive/packaged-schema-catalog.json",
    "--format",
    "json"
  ], appRoot);
  const packagedCatalog = await readJson(path.join(appRoot, ".visual-hive", "packaged-schema-catalog.json"));
  if (packagedCatalog.status !== "passed" || packagedCatalog.summary.schemasChecked < 50 || packagedCatalog.schemasDir === "schemas") {
    throw new Error("Packed Visual Hive schema resolution was shadowed by the consumer schemas directory.");
  }
  const identityHiveRoot = path.join(appRoot, ".visual-hive", "hive");
  await mkdir(identityHiveRoot, { recursive: true });
  await writeFile(path.join(identityHiveRoot, "hive-export.json"), JSON.stringify({
    project: "visual-hive-consumer-react-app",
    mode: "measured",
    status: "ready",
    acmmLevel: 3,
    externalCallsMade: 0
  }), "utf8");
  await writeFile(path.join(identityHiveRoot, "hive-import-manifest.json"), '{"status":"ready","sourceArtifacts":{}}\n', "utf8");
  await writeFile(path.join(identityHiveRoot, "hive-validation-summary.json"), '{"status":"passed"}\n', "utf8");
  await writeFile(path.join(identityHiveRoot, "hive-setup-pack.json"), '{"schemaVersion":"smoke.v1"}\n', "utf8");
  await writeFile(path.join(identityHiveRoot, "hive-setup-pack.md"), "# Setup pack\n", "utf8");
  await writeFile(path.join(appRoot, ".visual-hive", "issues.json"), '{"issues":[]}\n', "utf8");
  const bundleResult = await runVisualHiveCapture([
    "hive",
    "bundle",
    "--config",
    configPath,
    "--trusted-source",
    "--output-dir",
    ".visual-hive/identity-bundles",
    "--format",
    "json"
  ], appRoot, { npm_package_version: "99.99.99-consumer" });
  const bundle = JSON.parse(bundleResult.stdout);
  if (bundle.schemaVersion !== "visual-hive.bundle.v2"
    || bundle.source.trusted !== true
    || bundle.producer.version !== installedIdentity.version
    || bundle.producer.gitCommit !== installedIdentity.gitCommit
    || bundle.producer.version === "99.99.99-consumer") {
    throw new Error("Packed Visual Hive bundle did not preserve trusted-local v2 semantics and installed producer identity.");
  }
  await rm(path.join(appRoot, ".visual-hive"), { recursive: true, force: true });
  await runVisualHive(["doctor", "--config", configPath], appRoot);
  await runVisualHive([
    "plan",
    "--config",
    configPath,
    "--mode",
    "pr",
    "--changed-files",
    changedFilesPath
  ], appRoot);
  await runVisualHive([
    "run",
    "--config",
    configPath,
    "--skip-install",
    "--skip-build"
  ], appRoot, { VISUAL_HIVE_CI: "false", CI: "false" });
  await runVisualHive([
    "pipeline",
    "--config",
    configPath,
    "--mode",
    "pr",
    "--changed-files",
    changedFilesPath,
    "--ci",
    "--skip-install",
    "--skip-build",
    "--enforce-mutation",
    "--continue-on-error"
  ], appRoot);

  await assertArtifact(appRoot, ".visual-hive/report.json");
  await assertArtifact(appRoot, ".visual-hive/mutation-report.json");
  await assertArtifact(appRoot, ".visual-hive/triage.json");
  await assertArtifact(appRoot, ".visual-hive/issue.md");
  await assertArtifact(appRoot, ".visual-hive/readiness.json");
  await assertArtifact(appRoot, ".visual-hive/artifacts-index.json");

  const report = await readJson(path.join(appRoot, ".visual-hive", "report.json"));
  if (report.status !== "passed") {
    throw new Error(`Expected clean consumer strict pipeline to pass, got ${report.status}`);
  }
  const mutationReport = await readJson(path.join(appRoot, ".visual-hive", "mutation-report.json"));
  if (mutationReport.score < 1) {
    throw new Error(`Expected mapped consumer mutation to be killed, got score ${mutationReport.score}`);
  }
  const screenshots = report.results.flatMap((result) => result.screenshotAssertions ?? []);
  if (!screenshots.some((screenshot) => screenshot.actualPath) || !screenshots.some((screenshot) => screenshot.baselinePath)) {
    throw new Error("Expected clean consumer report to include actual and baseline screenshot paths.");
  }

  const stylePath = path.join(appRoot, "src", "styles.css");
  const originalCss = await readFile(stylePath, "utf8");
  await writeFile(
    stylePath,
    `${originalCss}

.metric-card {
  background: #111827 !important;
  color: #ffffff !important;
}
`,
    "utf8"
  );
  await run("npm", ["run", "build"], appRoot);

  const regression = await runVisualHiveAllowFailure([
    "pipeline",
    "--config",
    configPath,
    "--mode",
    "pr",
    "--changed-files",
    changedFilesPath,
    "--ci",
    "--skip-install",
    "--skip-build",
    "--enforce-mutation",
    "--continue-on-error"
  ], appRoot);
  if (regression.exitCode === 0) {
    throw new Error("Expected deliberate consumer visual regression to fail strict pipeline.");
  }

  const failedReport = await readJson(path.join(appRoot, ".visual-hive", "report.json"));
  const failedScreenshots = failedReport.results.flatMap((result) => result.screenshotAssertions ?? []);
  if (failedReport.status !== "failed") {
    throw new Error(`Expected regression report status failed, got ${failedReport.status}`);
  }
  if (!failedScreenshots.some((screenshot) => screenshot.status === "failed" && screenshot.diffPath && screenshot.actualDiffPixels > 0)) {
    throw new Error("Expected regression report to include failed screenshot diff metadata.");
  }
  await assertArtifact(appRoot, ".visual-hive/triage.json");
  await assertArtifact(appRoot, ".visual-hive/issue.md");
  await assertArtifact(appRoot, ".visual-hive/readiness.json");
  await assertArtifact(appRoot, ".visual-hive/artifacts-index.json");
  await run("node", [
    path.join(repoRoot, "scripts", "check-demo-evidence-resources.mjs"),
    "--root",
    appRoot,
    "--profile",
    "general"
  ], repoRoot);

  console.log(`Packed npm consumer smoke passed in ${appRoot}`);
  completed = true;
} finally {
  if (!process.env.VISUAL_HIVE_KEEP_CONSUMER_SMOKE && (completed || process.env.CI !== "true")) {
    await rm(tempRoot, { recursive: true, force: true });
  } else if (!completed) {
    console.error(`Consumer smoke failed; kept temporary repo at ${appRoot}`);
  }
}

async function packVisualHiveWorkspaces(destination) {
  await mkdir(destination, { recursive: true });
  const packed = [];
  for (const workspace of publishableWorkspacePackages) {
    const workspaceRoot = path.join(repoRoot, "packages", workspace);
    const metadata = JSON.parse(await readFile(path.join(workspaceRoot, "package.json"), "utf8"));
    const result = await runCapture("npm", ["pack", "--pack-destination", destination], workspaceRoot);
    const filename = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .findLast((line) => line.endsWith(".tgz"));
    if (!filename) throw new Error(`npm pack did not report a tarball for ${metadata.name}`);
    const tarball = path.resolve(destination, filename);
    await readFile(tarball);
    packed.push({ name: metadata.name, tarball });
  }
  return packed;
}

function runVisualHive(args, cwd, env = {}) {
  return run(process.execPath, [requireInstalledCliEntrypoint(), ...args], cwd, visualHiveEnvironment(env));
}

function runVisualHiveCapture(args, cwd, env = {}) {
  return runCapture(
    process.execPath,
    [requireInstalledCliEntrypoint(), ...args],
    cwd,
    DEFAULT_COMMAND_TIMEOUT_MS,
    visualHiveEnvironment(env)
  );
}

function runVisualHiveAllowFailure(args, cwd) {
  return runAllowFailure(
    process.execPath,
    [requireInstalledCliEntrypoint(), ...args],
    cwd,
    DEFAULT_COMMAND_TIMEOUT_MS,
    visualHiveEnvironment()
  );
}

function requireInstalledCliEntrypoint() {
  if (!installedCliEntrypoint) {
    throw new Error("Packed Visual Hive CLI entrypoint is not installed.");
  }
  return installedCliEntrypoint;
}

function visualHiveEnvironment(env = {}) {
  return {
    ...Object.fromEntries(inheritedGitHubContextVariables.map((name) => [name, undefined])),
    ...env
  };
}

function childEnvironment(overrides = {}) {
  const env = { ...process.env };
  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[name];
    else env[name] = value;
  }
  return env;
}

function run(command, args, cwd, env = {}, timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(commandForPlatform(command), args, {
      cwd,
      env: childEnvironment(env),
      stdio: "inherit",
      shell: useShellForPlatformCommand(command),
      windowsHide: true
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      killProcessTree(child);
      reject(new Error(`${command} ${args.join(" ")} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", async (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        await printFailureArtifacts(cwd);
        reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}`));
      }
    });
  });
}

function runAllowFailure(command, args, cwd, timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS, env = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(commandForPlatform(command), args, {
      cwd,
      env: childEnvironment({ ...env, VISUAL_HIVE_CI: "true" }),
      stdio: "inherit",
      shell: useShellForPlatformCommand(command),
      windowsHide: true
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      killProcessTree(child);
      resolve({ exitCode: 124 });
    }, timeoutMs);
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: code ?? 1 });
    });
  });
}

function runCapture(command, args, cwd, timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS, env = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    const child = spawn(commandForPlatform(command), args, {
      cwd,
      env: childEnvironment(env),
      stdio: ["ignore", "pipe", "pipe"],
      shell: useShellForPlatformCommand(command),
      windowsHide: true
    });
    child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      killProcessTree(child);
      reject(new Error(`${command} ${args.join(" ")} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}: ${stderr || stdout}`));
    });
  });
}

function killProcessTree(child) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true
    });
    killer.on("error", () => {
      child.kill("SIGKILL");
    });
    return;
  }
  child.kill("SIGTERM");
  setTimeout(() => {
    try {
      child.kill("SIGKILL");
    } catch {
      // Process may already be gone.
    }
  }, 2_000).unref();
}

function commandForPlatform(command) {
  return process.platform === "win32" && (command === "npm" || command === "npx") ? `${command}.cmd` : command;
}

function useShellForPlatformCommand(command) {
  return process.platform === "win32" && (command === "npm" || command === "npx");
}

async function assertArtifact(root, relativePath) {
  try {
    await readFile(path.join(root, relativePath));
  } catch {
    throw new Error(`Expected artifact ${relativePath} to exist.`);
  }
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function printFailureArtifacts(root) {
  const reportPath = path.join(root, ".visual-hive", "report.json");
  const pipelinePath = path.join(root, ".visual-hive", "pipeline.json");
  for (const filePath of [reportPath, pipelinePath]) {
    try {
      const artifact = JSON.parse(await readFile(filePath, "utf8"));
      console.error(`\n--- ${path.relative(root, filePath)} ---`);
      console.error(JSON.stringify(summarizeArtifact(artifact), null, 2));
    } catch {
      // The failing command may have failed before writing this artifact.
    }
  }
}

function summarizeArtifact(artifact) {
  if (artifact?.schemaVersion === 2 && Array.isArray(artifact.results)) {
    return {
      status: artifact.status,
      summary: artifact.summary,
      lifecycle: artifact.targetLifecycle,
      results: artifact.results.map((result) => ({
        contractId: result.contractId,
        status: result.status,
        errors: result.errors,
        screenshots: (result.screenshotAssertions ?? []).map((screenshot) => ({
          name: screenshot.screenshotName ?? screenshot.name,
          status: screenshot.status,
          message: screenshot.message,
          actualDiffPixelRatio: screenshot.actualDiffPixelRatio,
          actualDiffPixels: screenshot.actualDiffPixels
        })),
        consoleErrors: result.consoleErrors,
        pageErrors: result.pageErrors,
        networkErrors: result.networkErrors
      }))
    };
  }
  if (artifact?.schemaVersion === 1 && Array.isArray(artifact.steps)) {
    return {
      status: artifact.status,
      rootCause: artifact.rootCause,
      steps: artifact.steps.map((step) => ({
        id: step.id,
        status: step.status,
        exitCode: step.exitCode,
        message: step.message
      }))
    };
  }
  return artifact;
}
