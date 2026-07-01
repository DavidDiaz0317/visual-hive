import { spawn } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = path.join(repoRoot, "examples", "consumer-react-app");
const cliPath = path.join(repoRoot, "packages", "cli", "dist", "index.js");

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-consumer-"));
const appRoot = path.join(tempRoot, "consumer-react-app");
const configPath = path.join(appRoot, "visual-hive.config.yaml");
const changedFilesPath = path.join(appRoot, "changed-files.txt");

try {
  await cp(fixtureRoot, appRoot, { recursive: true });
  await writeFile(changedFilesPath, "src/App.jsx\nsrc/styles.css\n", "utf8");

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
    configPath
  ], appRoot, { VISUAL_HIVE_CI: "false" });
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

  console.log(`Consumer smoke passed in ${appRoot}`);
} finally {
  if (!process.env.VISUAL_HIVE_KEEP_CONSUMER_SMOKE) {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function run(command, args, cwd, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(commandForPlatform(command), args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: "inherit",
      windowsHide: true
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}`));
      }
    });
  });
}

function runAllowFailure(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(commandForPlatform(command), args, {
      cwd,
      env: { ...process.env, VISUAL_HIVE_CI: "true" },
      stdio: "inherit",
      windowsHide: true
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ exitCode: code ?? 1 });
    });
  });
}

function commandForPlatform(command) {
  return process.platform === "win32" && command === "npm" ? "npm.cmd" : command;
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
