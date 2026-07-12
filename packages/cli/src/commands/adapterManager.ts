import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import {
  buildToolRegistry,
  loadConfig,
  sanitizeText,
  writeJson,
  type ToolAdapterLifecycle
} from "@visual-hive/core";

const ODIFF_PACKAGE = "odiff-bin";
const ODIFF_VERSION = "4.3.8";
const ODIFF_INTEGRITY = "sha512-nEGbO932GgDZUT6KNI30wio+JaNhLHGbeXrDnYQF4UeSmroC55w8wRXqOAYqGJXk2xFK72RxxLnGofofwV+eDQ==";
const MAX_PROCESS_OUTPUT = 1_000_000;
const REQUIRED_VRT_ENV = ["VRT_APIURL", "VRT_APIKEY", "VRT_PROJECT", "VRT_BRANCH"] as const;
const ODIFF_PLATFORMS = new Set([
  "linux-x64",
  "linux-arm64",
  "linux-riscv64",
  "darwin-x64",
  "darwin-arm64",
  "win32-x64",
  "win32-arm64"
]);
const RED_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAE0lEQVR4AWP8z8DwnwEImBigAAAfFwICgH3ifwAAAABJRU5ErkJggg==";
const BLUE_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAE0lEQVR4AWNkYPj/nwEImBigAAAdGQICxBbJ1AAAAABJRU5ErkJggg==";

export type AdapterLifecycleDecision = "install" | "update" | "use" | "skip" | "replace";
export type AdapterLifecycleStatus = "ready" | "action_required" | "blocked" | "not_applicable";
export type AdapterActionStatus = "planned" | "passed" | "failed" | "skipped";

export interface AdapterManagerProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type AdapterManagerProcessRunner = (
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number
) => Promise<AdapterManagerProcessResult>;

export interface AdapterLifecycleAction {
  id: string;
  kind: "install" | "update" | "health_check" | "parity_check" | "use" | "replace" | "review";
  status: AdapterActionStatus;
  automatic: boolean;
  command?: string;
  reason: string;
}

export interface ManagedAdapterPlanEntry {
  id: "odiff_local_compare" | "visual_regression_tracker_review";
  label: string;
  selected: boolean;
  decision: AdapterLifecycleDecision;
  status: AdapterLifecycleStatus;
  evidenceRole: "supplemental";
  verdictAuthority: false;
  targetVersion: string;
  installedVersion?: string;
  reason: string;
  lifecycle: ToolAdapterLifecycle;
  signals: {
    screenshotContracts: number;
    platform: string;
    packageJson: boolean;
    packageLock: boolean;
    packagePin?: string;
    lockIntegrityVerified?: boolean;
    credentialNamesPresent: string[];
    credentialNamesMissing: string[];
    pullRequestLane: boolean;
  };
  actions: AdapterLifecycleAction[];
}

export interface AdapterLifecyclePlan {
  schemaVersion: "visual-hive.adapter-lifecycle-plan.v1";
  generatedAt: string;
  project: string;
  status: "ready" | "action_required" | "blocked";
  mode: "plan" | "apply";
  repositoryRoot: string;
  packageRoot: string;
  packageManager: "npm" | "unsupported" | "unavailable";
  defaultEvidenceAdapter: "playwright";
  verdictAuthority: "visual-hive";
  externalCallsMade: 0;
  dependencyWritesMade: boolean;
  summary: {
    screenshotContracts: number;
    ready: number;
    actionRequired: number;
    blocked: number;
    notApplicable: number;
  };
  adapters: ManagedAdapterPlanEntry[];
  notes: string[];
}

export interface RunAdapterManagerOptions {
  config?: string;
  cwd?: string;
  output?: string;
  apply?: boolean;
  now?: Date;
  platform?: NodeJS.Platform;
  arch?: string;
  env?: NodeJS.ProcessEnv;
  processRunner?: AdapterManagerProcessRunner;
}

export interface RunAdapterManagerResult {
  plan: AdapterLifecyclePlan;
  outputPath: string;
}

interface NpmState {
  packageRoot: string;
  projectPackagePath: string;
  packageLockPath: string;
  packageJson?: JsonObject;
  packageLock?: JsonObject;
  packageManager: AdapterLifecyclePlan["packageManager"];
  workspaceName?: string;
  packagePin?: string;
  installedVersion?: string;
  lockIntegrity?: string;
}

type JsonObject = Record<string, unknown>;

export async function runAdapterManager(options: RunAdapterManagerOptions = {}): Promise<RunAdapterManagerResult> {
  const loaded = await loadConfig(options.config, options.cwd ?? process.cwd());
  const rootDir = loaded.rootDir;
  const outputPath = resolveWithin(rootDir, options.output ?? path.join(".visual-hive", "adapters", "lifecycle-plan.json"));
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const platformKey = `${platform}-${arch}`;
  const env = options.env ?? process.env;
  const screenshotContracts = loaded.config.contracts.reduce((count, contract) => count + contract.screenshots.length, 0);
  let npmState = await inspectNpmState(rootDir);
  const registry = buildToolRegistry({ project: loaded.config.project.name, now: options.now });
  const odiffLifecycle = requiredLifecycle(registry, "odiff_local_compare");
  const vrtLifecycle = requiredLifecycle(registry, "visual_regression_tracker_review");
  let odiff = planODiff({ npmState, screenshotContracts, platformKey, lifecycle: odiffLifecycle });
  const vrt = planVRT({ env, screenshotContracts, platformKey, lifecycle: vrtLifecycle });
  let dependencyWritesMade = false;

  if (options.apply && (odiff.decision === "install" || odiff.decision === "update")) {
    const action = odiff.actions.find((entry) => entry.kind === odiff.decision);
    try {
      if (npmState.packageManager !== "npm") throw new Error("ODiff dependency changes require an npm-managed package and package-lock.");
      const args = npmInstallArgs(npmState);
      const npm = await resolveNpmInvocation(platform);
      const execution = await (options.processRunner ?? runManagedProcess)(npm.command, [...npm.args, ...args], npmState.packageRoot, 120_000);
      if (execution.exitCode !== 0) {
        throw new Error(`npm install failed (${execution.exitCode}): ${sanitizeText(execution.stderr || execution.stdout).slice(0, 500)}`);
      }
      dependencyWritesMade = true;
      if (action) action.status = "passed";
      npmState = await inspectNpmState(rootDir);
      assertExactODiffState(npmState);
      const next = planODiff({ npmState, screenshotContracts, platformKey, lifecycle: odiffLifecycle });
      if (action) next.actions.unshift(action);
      odiff = next;
    } catch (error) {
      if (action) {
        action.status = "failed";
        action.reason = sanitizeText(error instanceof Error ? error.message : String(error));
      }
      odiff.status = "blocked";
      odiff.reason = "ODiff installation/update failed closed; Playwright and Visual Hive remain the active evidence and verdict path.";
    }
  }

  if (options.apply && odiff.decision === "use" && odiff.status !== "blocked") {
    const healthActions = odiff.actions.filter((entry) => entry.kind === "health_check" || entry.kind === "parity_check");
    try {
      assertExactODiffState(npmState);
      await verifyODiffHealth(rootDir, npmState, platformKey, options.processRunner ?? runManagedProcess);
      for (const action of healthActions) action.status = "passed";
      odiff.status = "ready";
      odiff.reason = "Exact ODiff package integrity, executable version, and identical/different golden-image parity checks passed.";
    } catch (error) {
      for (const action of healthActions) {
        action.status = "failed";
        action.reason = sanitizeText(error instanceof Error ? error.message : String(error));
      }
      odiff.decision = "replace";
      odiff.status = "blocked";
      odiff.reason = "ODiff health/parity verification failed; replace or roll back the pin while retaining Playwright as the active primary evidence source.";
      odiff.actions.push({
        id: "retain-playwright-fallback",
        kind: "replace",
        status: "passed",
        automatic: false,
        reason: "Visual Hive retained Playwright/pixelmatch and did not grant ODiff verdict authority."
      });
    }
  }

  const adapters = [odiff, vrt];
  const plan: AdapterLifecyclePlan = {
    schemaVersion: "visual-hive.adapter-lifecycle-plan.v1",
    generatedAt: (options.now ?? new Date()).toISOString(),
    project: loaded.config.project.name,
    status: summarizeStatus(adapters),
    mode: options.apply ? "apply" : "plan",
    repositoryRoot: ".",
    packageRoot: relative(rootDir, npmState.packageRoot),
    packageManager: npmState.packageManager,
    defaultEvidenceAdapter: "playwright",
    verdictAuthority: "visual-hive",
    externalCallsMade: 0,
    dependencyWritesMade,
    summary: {
      screenshotContracts,
      ready: adapters.filter((entry) => entry.status === "ready").length,
      actionRequired: adapters.filter((entry) => entry.status === "action_required").length,
      blocked: adapters.filter((entry) => entry.status === "blocked").length,
      notApplicable: adapters.filter((entry) => entry.status === "not_applicable").length
    },
    adapters,
    notes: [
      "Playwright remains the first-party primary local browser evidence adapter.",
      "Visual Hive remains the only verdict authority; adapter results are supplemental and cannot turn a failed verdict green.",
      "The manager never uploads screenshots or provisions VRT infrastructure; VRT use remains an explicit trusted non-PR action.",
      "Install/update actions use an exact npm pin and verify package-lock integrity before executing the adapter."
    ]
  };
  await writeJson(outputPath, plan);
  return { plan, outputPath };
}

export function formatAdapterManagerResult(result: RunAdapterManagerResult, format: "markdown" | "json" = "markdown"): string {
  if (format === "json") return JSON.stringify(result.plan, null, 2);
  return [
    `Wrote ${result.outputPath}`,
    "",
    `# Adapter Lifecycle Plan: ${result.plan.project}`,
    "",
    `- Status: ${result.plan.status}`,
    `- Mode: ${result.plan.mode}`,
    `- Screenshot contracts: ${result.plan.summary.screenshotContracts}`,
    `- Default evidence adapter: ${result.plan.defaultEvidenceAdapter}`,
    `- Verdict authority: ${result.plan.verdictAuthority}`,
    `- Dependency writes made: ${result.plan.dependencyWritesMade}`,
    `- External calls made: ${result.plan.externalCallsMade}`,
    "",
    "## Decisions",
    ...result.plan.adapters.map((adapter) => `- ${adapter.id}: ${adapter.decision} (${adapter.status}) — ${adapter.reason}`)
  ].join("\n");
}

function planODiff(input: {
  npmState: NpmState;
  screenshotContracts: number;
  platformKey: string;
  lifecycle: ToolAdapterLifecycle;
}): ManagedAdapterPlanEntry {
  const base = baseEntry("odiff_local_compare", "ODiff local image comparison", input);
  if (input.screenshotContracts === 0) {
    return {
      ...base,
      selected: false,
      decision: "skip",
      status: "not_applicable",
      reason: "The Visual Hive config has no screenshot contracts, so a second image comparator adds no repository-specific coverage.",
      actions: []
    };
  }
  if (lifecycleRequiresReplacement(input.lifecycle)) {
    return lifecycleReplacement(base, "ODiff");
  }
  if (!ODIFF_PLATFORMS.has(input.platformKey)) {
    return {
      ...base,
      selected: false,
      decision: "replace",
      status: "blocked",
      reason: `ODiff ${ODIFF_VERSION} does not publish a managed binary for ${input.platformKey}; retain Playwright/pixelmatch or select a reviewed compatible local adapter.`,
      actions: [{
        id: "replace-unsupported-odiff",
        kind: "replace",
        status: "planned",
        automatic: false,
        reason: "Replacement requires a reviewed adapter with equivalent local, deterministic, no-baseline-write behavior."
      }]
    };
  }
  if (input.npmState.packageManager !== "npm") {
    return {
      ...base,
      selected: false,
      decision: "replace",
      status: "blocked",
      reason: "The repository is not managed by npm, so Visual Hive will not mutate its dependency graph automatically.",
      actions: [{
        id: "retain-default-comparator",
        kind: "replace",
        status: "planned",
        automatic: false,
        reason: "Retain Playwright/pixelmatch until a package-manager-specific exact-pin installer is reviewed."
      }]
    };
  }

  const exactPin = input.npmState.packagePin === ODIFF_VERSION;
  const exactLock = input.npmState.installedVersion === ODIFF_VERSION && input.npmState.lockIntegrity === ODIFF_INTEGRITY;
  if (!input.npmState.packagePin) {
    return {
      ...base,
      selected: true,
      decision: "install",
      status: "action_required",
      reason: "Screenshot contracts are configured and ODiff is absent; install the reviewed exact pin as supplemental parity evidence.",
      actions: installOrUpdateActions("install", input.npmState, input.platformKey)
    };
  }
  if (!exactPin || !exactLock) {
    return {
      ...base,
      selected: true,
      decision: "update",
      status: "action_required",
      reason: "The ODiff dependency or lockfile does not match the reviewed version and registry integrity; reconcile it in an explicit dependency change.",
      actions: installOrUpdateActions("update", input.npmState, input.platformKey)
    };
  }
  return {
    ...base,
    selected: true,
    decision: "use",
    status: "action_required",
    reason: "The exact ODiff dependency and lock integrity are present; run executable health and golden-image parity checks before use.",
    actions: [
      {
        id: "odiff-version-health",
        kind: "health_check",
        status: "planned",
        automatic: true,
        command: `${relative(input.npmState.packageRoot, odiffBinary(input.npmState.packageRoot))} --version`,
        reason: `The executable must report ODiff ${ODIFF_VERSION}.`
      },
      {
        id: "odiff-golden-parity",
        kind: "parity_check",
        status: "planned",
        automatic: true,
        reason: "Identical fixtures must match and different fixtures must produce the expected deterministic pixel-diff result."
      },
      {
        id: "odiff-supplemental-use",
        kind: "use",
        status: "planned",
        automatic: false,
        command: "visual-hive adapters odiff compare --baseline <baseline.png> --actual <actual.png> --diff <diff.png>",
        reason: "Use ODiff only as supplemental evidence after the manager health checks pass."
      }
    ]
  };
}

function planVRT(input: {
  env: NodeJS.ProcessEnv;
  screenshotContracts: number;
  platformKey: string;
  lifecycle: ToolAdapterLifecycle;
}): ManagedAdapterPlanEntry {
  const present = REQUIRED_VRT_ENV.filter((name) => Boolean(input.env[name]?.trim()));
  const missing = REQUIRED_VRT_ENV.filter((name) => !present.includes(name));
  const pullRequestLane = input.env.GITHUB_EVENT_NAME === "pull_request" || input.env.GITHUB_EVENT_NAME === "pull_request_target";
  const base = baseEntry("visual_regression_tracker_review", "Visual Regression Tracker review", {
    screenshotContracts: input.screenshotContracts,
    platformKey: input.platformKey,
    lifecycle: input.lifecycle,
    npmState: undefined,
    credentialNamesPresent: present,
    credentialNamesMissing: missing,
    pullRequestLane
  });
  if (input.screenshotContracts === 0) {
    return { ...base, selected: false, decision: "skip", status: "not_applicable", reason: "No screenshot contracts are configured.", actions: [] };
  }
  if (lifecycleRequiresReplacement(input.lifecycle)) {
    return lifecycleReplacement(base, "Visual Regression Tracker");
  }
  if (pullRequestLane) {
    return {
      ...base,
      selected: false,
      decision: "replace",
      status: "blocked",
      reason: "VRT external upload is forbidden while pull-request code is executing; retain local Visual Hive evidence in this lane.",
      actions: [{
        id: "move-vrt-to-trusted-lane",
        kind: "replace",
        status: "planned",
        automatic: false,
        reason: "Run VRT only from a separately trusted schedule/manual lane after deterministic evidence exists."
      }]
    };
  }
  if (present.length === 0) {
    return {
      ...base,
      selected: false,
      decision: "skip",
      status: "not_applicable",
      reason: "The optional self-hosted review service is not configured; local Playwright evidence fully supports the default production path.",
      actions: [{
        id: "review-vrt-adoption",
        kind: "review",
        status: "planned",
        automatic: false,
        reason: `Adopt only when team baseline-review history is needed and all credential names are supplied in a trusted lane: ${REQUIRED_VRT_ENV.join(", ")}.`
      }]
    };
  }
  if (missing.length > 0) {
    return {
      ...base,
      selected: true,
      decision: "update",
      status: "blocked",
      reason: `VRT configuration is partial; add the missing secret/setting names in a trusted store: ${missing.join(", ")}.`,
      actions: [{
        id: "complete-vrt-configuration",
        kind: "update",
        status: "planned",
        automatic: false,
        reason: "The manager reports credential names only and never stores or prints their values."
      }]
    };
  }
  return {
    ...base,
    selected: true,
    decision: "use",
    status: "action_required",
    reason: "All VRT setting/credential names are present in a trusted non-PR lane; run the explicit disposable-build/upload health path before relying on supplemental review evidence.",
    actions: [{
      id: "vrt-trusted-upload",
      kind: "use",
      status: "planned",
      automatic: false,
      command: "visual-hive adapters vrt upload --image <actual.png> --name <contract> --trusted",
      reason: "The manager never performs external uploads automatically."
    }]
  };
}

function baseEntry(
  id: ManagedAdapterPlanEntry["id"],
  label: string,
  input: {
    screenshotContracts: number;
    platformKey: string;
    lifecycle: ToolAdapterLifecycle;
    npmState?: NpmState;
    credentialNamesPresent?: string[];
    credentialNamesMissing?: string[];
    pullRequestLane?: boolean;
  }
): Omit<ManagedAdapterPlanEntry, "selected" | "decision" | "status" | "reason" | "actions"> {
  return {
    id,
    label,
    evidenceRole: "supplemental",
    verdictAuthority: false,
    targetVersion: input.lifecycle.version,
    installedVersion: input.npmState?.installedVersion,
    lifecycle: input.lifecycle,
    signals: {
      screenshotContracts: input.screenshotContracts,
      platform: input.platformKey,
      packageJson: Boolean(input.npmState?.packageJson),
      packageLock: Boolean(input.npmState?.packageLock),
      packagePin: input.npmState?.packagePin,
      lockIntegrityVerified: input.npmState?.lockIntegrity ? input.npmState.lockIntegrity === ODIFF_INTEGRITY : undefined,
      credentialNamesPresent: input.credentialNamesPresent ?? [],
      credentialNamesMissing: input.credentialNamesMissing ?? [],
      pullRequestLane: input.pullRequestLane ?? false
    }
  };
}

function lifecycleRequiresReplacement(lifecycle: ToolAdapterLifecycle): boolean {
  return lifecycle.maturity === "deprecated" || lifecycle.maintenanceStatus === "unmaintained";
}

function lifecycleReplacement(
  base: Omit<ManagedAdapterPlanEntry, "selected" | "decision" | "status" | "reason" | "actions">,
  label: string
): ManagedAdapterPlanEntry {
  return {
    ...base,
    selected: false,
    decision: "replace",
    status: "blocked",
    reason: `${label} is marked ${base.lifecycle.maturity}/${base.lifecycle.maintenanceStatus} in the reviewed registry and cannot be selected for new use.`,
    actions: [{
      id: `replace-${base.id}`,
      kind: "replace",
      status: "planned",
      automatic: false,
      reason: `Review these registered replacement triggers: ${base.lifecycle.replacementCriteria.join("; ")}. ${base.lifecycle.rollback}`
    }]
  };
}

function installOrUpdateActions(kind: "install" | "update", state: NpmState, platformKey: string): AdapterLifecycleAction[] {
  const platform = platformKey.slice(0, platformKey.indexOf("-")) as NodeJS.Platform;
  return [{
    id: `odiff-${kind}-exact-pin`,
    kind,
    status: "planned",
    automatic: true,
    command: `${npmCommand(platform)} ${npmInstallArgs(state).join(" ")}`,
    reason: `Write ${ODIFF_PACKAGE}=${ODIFF_VERSION} and require npm lock integrity ${ODIFF_INTEGRITY}.`
  }];
}

async function inspectNpmState(rootDir: string): Promise<NpmState> {
  const projectPackagePath = path.join(rootDir, "package.json");
  const packageJson = await readJsonIfPresent(projectPackagePath);
  const packageRoot = await findPackageManagerRoot(rootDir);
  const packageLockPath = await exists(path.join(packageRoot, "package-lock.json"))
    ? path.join(packageRoot, "package-lock.json")
    : path.join(packageRoot, "npm-shrinkwrap.json");
  const packageLock = await readJsonIfPresent(packageLockPath);
  const rootPackage = packageRoot === rootDir ? packageJson : await readJsonIfPresent(path.join(packageRoot, "package.json"));
  const declaredManager = typeof rootPackage?.packageManager === "string" ? rootPackage.packageManager : undefined;
  const competingLock = await hasCompetingPackageManagerLock(packageRoot);
  const packageManager = !packageJson
    ? "unavailable"
    : (declaredManager && !declaredManager.startsWith("npm@")) || competingLock
      ? "unsupported"
      : "npm";
  const deps = isObject(packageJson?.devDependencies) ? packageJson.devDependencies : {};
  const runtimeDeps = isObject(packageJson?.dependencies) ? packageJson.dependencies : {};
  const packagePin = stringValue(deps[ODIFF_PACKAGE]) ?? stringValue(runtimeDeps[ODIFF_PACKAGE]);
  const lockPackage = lockPackageEntry(packageLock, packageRoot, rootDir);
  return {
    packageRoot,
    projectPackagePath,
    packageLockPath,
    packageJson,
    packageLock,
    packageManager,
    workspaceName: packageRoot === rootDir ? undefined : stringValue(packageJson?.name),
    packagePin,
    installedVersion: stringValue(lockPackage?.version),
    lockIntegrity: stringValue(lockPackage?.integrity)
  };
}

async function findPackageManagerRoot(start: string): Promise<string> {
  let current = start;
  let fallback = start;
  while (true) {
    if (await hasAnyPackageManagerLock(current)) return current;
    if (await exists(path.join(current, "package.json"))) fallback = current;
    if (await exists(path.join(current, ".git"))) return fallback;
    const parent = path.dirname(current);
    if (parent === current) return fallback;
    current = parent;
  }
}

async function hasAnyPackageManagerLock(root: string): Promise<boolean> {
  return (await Promise.all([
    "package-lock.json",
    "npm-shrinkwrap.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "bun.lock",
    "bun.lockb"
  ].map((name) => exists(path.join(root, name))))).some(Boolean);
}

async function hasCompetingPackageManagerLock(root: string): Promise<boolean> {
  return (await Promise.all([
    "pnpm-lock.yaml",
    "yarn.lock",
    "bun.lock",
    "bun.lockb"
  ].map((name) => exists(path.join(root, name))))).some(Boolean);
}

function lockPackageEntry(lock: JsonObject | undefined, packageRoot: string, projectRoot: string): JsonObject | undefined {
  if (!lock) return undefined;
  const packages = isObject(lock.packages) ? lock.packages : undefined;
  const direct = packages && isObject(packages[`node_modules/${ODIFF_PACKAGE}`]) ? packages[`node_modules/${ODIFF_PACKAGE}`] as JsonObject : undefined;
  if (direct) return direct;
  const relativeProject = path.relative(packageRoot, projectRoot).replaceAll(path.sep, "/");
  const nestedKey = `${relativeProject ? `${relativeProject}/` : ""}node_modules/${ODIFF_PACKAGE}`;
  if (packages && isObject(packages[nestedKey])) return packages[nestedKey] as JsonObject;
  const dependencies = isObject(lock.dependencies) ? lock.dependencies : undefined;
  return dependencies && isObject(dependencies[ODIFF_PACKAGE]) ? dependencies[ODIFF_PACKAGE] as JsonObject : undefined;
}

function npmInstallArgs(state: NpmState): string[] {
  const args = ["install", "--save-dev", "--save-exact", "--ignore-audit", "--ignore-fund"];
  if (state.workspaceName) args.push("--workspace", state.workspaceName);
  args.push(`${ODIFF_PACKAGE}@${ODIFF_VERSION}`);
  return args;
}

function assertExactODiffState(state: NpmState): void {
  if (state.packagePin !== ODIFF_VERSION) throw new Error(`package.json must pin ${ODIFF_PACKAGE} exactly to ${ODIFF_VERSION}.`);
  if (state.installedVersion !== ODIFF_VERSION) throw new Error(`package-lock must resolve ${ODIFF_PACKAGE} exactly to ${ODIFF_VERSION}.`);
  if (state.lockIntegrity !== ODIFF_INTEGRITY) throw new Error(`package-lock integrity for ${ODIFF_PACKAGE}@${ODIFF_VERSION} does not match the reviewed registry digest.`);
}

async function verifyODiffHealth(
  rootDir: string,
  state: NpmState,
  platformKey: string,
  runner: AdapterManagerProcessRunner
): Promise<void> {
  if (!ODIFF_PLATFORMS.has(platformKey)) throw new Error(`Unsupported ODiff platform: ${platformKey}.`);
  const binary = odiffBinary(state.packageRoot);
  await access(binary, constants.X_OK);
  const version = await runner(binary, ["--version"], rootDir, 15_000);
  const versionOutput = `${version.stdout}\n${version.stderr}`;
  if (version.exitCode !== 0 || !new RegExp(`\\bodiff\\s+${ODIFF_VERSION.replaceAll(".", "\\.")}\\b`, "i").test(versionOutput)) {
    throw new Error(`ODiff executable health check did not report ${ODIFF_VERSION}.`);
  }

  const healthDir = path.join(rootDir, ".visual-hive", "adapters", `.odiff-health-${process.pid}-${Date.now()}`);
  await mkdir(healthDir, { recursive: true });
  try {
    const red = path.join(healthDir, "red.png");
    const redCopy = path.join(healthDir, "red-copy.png");
    const blue = path.join(healthDir, "blue.png");
    await Promise.all([
      writeFile(red, Buffer.from(RED_PNG, "base64")),
      writeFile(redCopy, Buffer.from(RED_PNG, "base64")),
      writeFile(blue, Buffer.from(BLUE_PNG, "base64"))
    ]);
    const common = ["--parsable-stdout", "--fail-on-layout", "--threshold", "0.1"];
    const same = await runner(binary, [red, redCopy, path.join(healthDir, "same-diff.png"), ...common], rootDir, 30_000);
    if (same.exitCode !== 0 || same.stdout.trim() !== "0") throw new Error("ODiff identical-image golden fixture did not match.");
    const different = await runner(binary, [red, blue, path.join(healthDir, "different-diff.png"), ...common], rootDir, 30_000);
    if (different.exitCode !== 22 || !/^4;100(?:\.0+)?$/.test(different.stdout.trim())) {
      throw new Error("ODiff different-image golden fixture did not produce the expected four-pixel diff.");
    }
  } finally {
    await rm(healthDir, { recursive: true, force: true });
  }
}

function odiffBinary(packageRoot: string): string {
  return path.join(packageRoot, "node_modules", ODIFF_PACKAGE, "bin", "odiff.exe");
}

function npmCommand(platform: NodeJS.Platform): string {
  return platform === "win32" ? "npm.cmd" : "npm";
}

async function resolveNpmInvocation(platform: NodeJS.Platform): Promise<{ command: string; args: string[] }> {
  if (platform !== "win32") return { command: "npm", args: [] };
  const candidates = [
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
    process.env.npm_execpath
  ];
  for (const candidate of candidates) {
    if (!candidate || !path.isAbsolute(candidate) || !/^npm-cli\.(?:c?js)$/i.test(path.basename(candidate))) continue;
    try {
      const info = await lstat(candidate);
      if (info.isFile() && !info.isSymbolicLink()) return { command: process.execPath, args: [candidate] };
    } catch {
      // Try the next trusted npm CLI location.
    }
  }
  throw new Error("Unable to locate npm-cli.js beside Node or in npm_execpath; install npm with Node before applying adapter dependencies.");
}

function requiredLifecycle(registry: ReturnType<typeof buildToolRegistry>, id: string): ToolAdapterLifecycle {
  const lifecycle = registry.tools.find((tool) => tool.id === id)?.adapterLifecycle;
  if (!lifecycle) throw new Error(`Tool Registry is missing adapter lifecycle metadata for ${id}.`);
  return lifecycle;
}

function summarizeStatus(adapters: ManagedAdapterPlanEntry[]): AdapterLifecyclePlan["status"] {
  if (adapters.some((adapter) => adapter.status === "blocked")) return "blocked";
  if (adapters.some((adapter) => adapter.status === "action_required")) return "action_required";
  return "ready";
}

async function readJsonIfPresent(filePath: string): Promise<JsonObject | undefined> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    if (!isObject(parsed)) throw new Error("expected a JSON object");
    return parsed;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : undefined;
    if (code === "ENOENT") return undefined;
    throw new Error(`Unable to read ${filePath}: ${sanitizeText(error instanceof Error ? error.message : String(error))}`);
  }
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveWithin(root: string, value: string): string {
  const resolved = path.resolve(root, value);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new Error(`Adapter manager output escapes the repository root: ${value}`);
  return resolved;
}

function relative(root: string, target: string): string {
  const value = path.relative(root, target).replaceAll(path.sep, "/");
  return value || ".";
}

function runManagedProcess(command: string, args: string[], cwd: string, timeoutMs: number): Promise<AdapterManagerProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true, env: { ...process.env } });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`Adapter lifecycle command timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      if (stdout.length < MAX_PROCESS_OUTPUT) stdout += String(chunk).slice(0, MAX_PROCESS_OUTPUT - stdout.length);
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < MAX_PROCESS_OUTPUT) stderr += String(chunk).slice(0, MAX_PROCESS_OUTPUT - stderr.length);
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: exitCode ?? 1, stdout, stderr });
    });
  });
}
