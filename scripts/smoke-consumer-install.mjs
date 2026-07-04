import { spawn } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = path.join(repoRoot, "examples", "consumer-react-app");
const cliPath = path.join(repoRoot, "packages", "cli", "dist", "index.js");
const DEFAULT_COMMAND_TIMEOUT_MS = 180_000;

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-consumer-"));
const appRoot = path.join(tempRoot, "consumer-react-app");
const configPath = path.join(appRoot, "visual-hive.config.yaml");
const changedFilesPath = path.join(appRoot, "changed-files.txt");
let completed = false;

try {
  await cp(fixtureRoot, appRoot, { recursive: true });
  await writeFile(changedFilesPath, "src/App.jsx\nsrc/styles.css\n", "utf8");

  await run("npm", ["install"], appRoot);
  await run("npx", ["playwright", "install", "chromium"], appRoot);
  await run("npm", ["run", "build"], appRoot);
  await run("node", [cliPath, "doctor", "--config", configPath], appRoot);
  await run("node", [
    cliPath,
    "plan",
    "--config",
    configPath,
    "--mode",
    "pr",
    "--changed-files",
    changedFilesPath
  ], appRoot);
  await run("node", [
    cliPath,
    "run",
    "--config",
    configPath,
    "--skip-install",
    "--skip-build"
  ], appRoot, { VISUAL_HIVE_CI: "false", CI: "false" });
  await run("node", [
    cliPath,
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

  const regression = await runAllowFailure("node", [
    cliPath,
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

  console.log(`Consumer smoke passed in ${appRoot}`);
  completed = true;
} finally {
  if (!process.env.VISUAL_HIVE_KEEP_CONSUMER_SMOKE && (completed || process.env.CI !== "true")) {
    await rm(tempRoot, { recursive: true, force: true });
  } else if (!completed) {
    console.error(`Consumer smoke failed; kept temporary repo at ${appRoot}`);
  }
}

function run(command, args, cwd, env = {}, timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(commandForPlatform(command), args, {
      cwd,
      env: { ...process.env, ...env },
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

function runAllowFailure(command, args, cwd, timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(commandForPlatform(command), args, {
      cwd,
      env: { ...process.env, VISUAL_HIVE_CI: "true" },
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
