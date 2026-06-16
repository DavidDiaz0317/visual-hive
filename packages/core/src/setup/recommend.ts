import { access, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { stringify } from "yaml";
import {
  VisualHiveConfigSchema,
  type ContractConfig,
  type MutationOperator,
  type TargetConfig,
  type VisualHiveConfig
} from "../config/schema.js";
import { sanitizeText } from "../utils/sanitize.js";

export interface SetupRecommendationReport {
  schemaVersion: 1;
  project: SetupRecommendationProject;
  generatedAt: string;
  configPath: string;
  recommendedConfig: VisualHiveConfig;
  recommendedConfigYaml: string;
  detectedSelectors: SetupDetectedSelector[];
  recommendedTarget: SetupRecommendedTarget;
  recommendedContracts: SetupRecommendedContract[];
  recommendedCommands: string[];
  findings: SetupRecommendationFinding[];
  warnings: string[];
}

export interface SetupRecommendationProject {
  name: string;
  repoRoot: string;
  type: VisualHiveConfig["project"]["type"];
  packageManager: "npm" | "pnpm" | "yarn" | "unknown";
  detectedFrameworks: string[];
  scripts: string[];
}

export interface SetupDetectedSelector {
  selector: string;
  sourceFile: string;
  occurrences: number;
}

export interface SetupRecommendedTarget {
  id: string;
  kind: TargetConfig["kind"];
  url: string;
  install?: string;
  build?: string;
  serve?: string;
  confidence: "high" | "medium" | "low";
  reasons: string[];
}

export interface SetupRecommendedContract {
  id: string;
  targetId: string;
  selectors: string[];
  steps: Array<{ action: string; selector?: string; route?: string; value?: string }>;
  screenshots: Array<{ name: string; route: string; viewport: string }>;
  reasons: string[];
}

export interface SetupRecommendationFinding {
  severity: "info" | "warning";
  message: string;
  evidence?: string;
}

export interface RecommendSetupOptions {
  repoRoot: string;
  configPath?: string;
  now?: Date;
}

interface PackageJsonShape {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface RepoInventory {
  packageJson?: PackageJsonShape;
  packageManager: SetupRecommendationProject["packageManager"];
  detectedFrameworks: string[];
  sourceFiles: string[];
  selectors: SetupDetectedSelector[];
}

const DEFAULT_PORT = 4173;
const MAX_SOURCE_FILES = 250;
const TEST_ID_PATTERN = /data-testid\s*=\s*["'`]([^"'`]+)["'`]/g;
const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".vue", ".svelte", ".html"]);
const SKIPPED_DIRS = new Set([".git", ".visual-hive", "node_modules", "dist", "build", "coverage", ".next", "out"]);

export async function recommendSetup(options: RecommendSetupOptions): Promise<SetupRecommendationReport> {
  const repoRoot = path.resolve(options.repoRoot);
  const configPath = path.resolve(repoRoot, options.configPath ?? "visual-hive.config.yaml");
  const inventory = await inspectRepository(repoRoot);
  const scripts = inventory.packageJson?.scripts ?? {};
  const projectName = sanitizeText(inventory.packageJson?.name ?? path.basename(repoRoot) ?? "visual-hive-target");
  const projectType = inferProjectType(inventory);
  const install = installCommand(inventory.packageManager);
  const build = scripts.build ? `${scriptRunner(inventory.packageManager)} build` : undefined;
  const serve = serveCommand(inventory.packageManager, scripts, projectType);
  const target = buildTarget({ install, build, serve, inventory, projectType });
  const selector = preferredSelector(inventory.selectors);
  const contract = buildContract(selector, target.id);
  const recommendationInput = configInput({
    projectName,
    projectType,
    target: target.config,
    contract: contract.config
  });
  const recommendedConfig = VisualHiveConfigSchema.parse(recommendationInput);
  const recommendedConfigYaml = stringify(recommendationInput, { sortMapEntries: false });
  const warnings = buildWarnings(inventory, serve, selector);

  return {
    schemaVersion: 1,
    project: {
      name: projectName,
      repoRoot: normalizeSlashes(repoRoot),
      type: projectType,
      packageManager: inventory.packageManager,
      detectedFrameworks: inventory.detectedFrameworks,
      scripts: Object.keys(scripts).sort()
    },
    generatedAt: (options.now ?? new Date()).toISOString(),
    configPath: normalizeSlashes(path.relative(repoRoot, configPath) || path.basename(configPath)),
    recommendedConfig,
    recommendedConfigYaml,
    detectedSelectors: inventory.selectors.slice(0, 20),
    recommendedTarget: {
      id: target.id,
      kind: target.config.kind,
      url: "url" in target.config ? (target.config.url ?? "http://127.0.0.1:4173") : "http://127.0.0.1:4173",
      install: "install" in target.config ? target.config.install : undefined,
      build: "build" in target.config ? target.config.build : undefined,
      serve: "serve" in target.config ? target.config.serve : undefined,
      confidence: target.confidence,
      reasons: target.reasons
    },
    recommendedContracts: [
      {
        id: contract.config.id,
        targetId: contract.config.target,
        selectors: contract.config.selectors.mustExist,
        steps: contract.config.steps.map((step) => ({
          action: step.action,
          selector: step.selector,
          route: step.route,
          value: step.action === "fill" ? "[configured]" : (step.value ?? step.key ?? step.text)
        })),
        screenshots: contract.config.screenshots.map((screenshot) => ({
          name: screenshot.name,
          route: screenshot.route,
          viewport: screenshot.viewport
        })),
        reasons: contract.reasons
      }
    ],
    recommendedCommands: [
      "visual-hive doctor",
      "visual-hive plan --mode pr --changed-files changed-files.txt",
      "visual-hive run",
      "visual-hive coverage --mode pr --changed-files changed-files.txt",
      "visual-hive triage",
      "visual-hive report"
    ],
    findings: buildFindings(inventory, target, selector),
    warnings
  };
}

async function inspectRepository(repoRoot: string): Promise<RepoInventory> {
  const packageJson = await readPackageJson(repoRoot);
  const packageManager = await detectPackageManager(repoRoot);
  const detectedFrameworks = detectFrameworks(packageJson);
  const sourceFiles = await collectSourceFiles(repoRoot);
  const selectors = await collectSelectors(repoRoot, sourceFiles);
  return { packageJson, packageManager, detectedFrameworks, sourceFiles, selectors };
}

async function readPackageJson(repoRoot: string): Promise<PackageJsonShape | undefined> {
  try {
    return JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8")) as PackageJsonShape;
  } catch {
    return undefined;
  }
}

async function detectPackageManager(repoRoot: string): Promise<SetupRecommendationProject["packageManager"]> {
  if (await exists(path.join(repoRoot, "package-lock.json"))) return "npm";
  if (await exists(path.join(repoRoot, "pnpm-lock.yaml"))) return "pnpm";
  if (await exists(path.join(repoRoot, "yarn.lock"))) return "yarn";
  if (await exists(path.join(repoRoot, "package.json"))) return "npm";
  return "unknown";
}

function detectFrameworks(packageJson?: PackageJsonShape): string[] {
  const deps = { ...(packageJson?.dependencies ?? {}), ...(packageJson?.devDependencies ?? {}) };
  const frameworks = new Set<string>();
  for (const key of Object.keys(deps)) {
    if (["react", "vite", "next", "vue", "svelte", "@angular/core", "storybook"].includes(key)) {
      frameworks.add(key);
    }
  }
  return [...frameworks].sort();
}

function inferProjectType(inventory: RepoInventory): VisualHiveConfig["project"]["type"] {
  const frameworks = new Set(inventory.detectedFrameworks);
  if (frameworks.has("next")) return "nextjs";
  if (frameworks.has("react") && frameworks.has("vite")) return "react-vite";
  if (frameworks.has("vite")) return "static";
  if (inventory.sourceFiles.some((file) => file.endsWith("index.html"))) return "static";
  return "custom";
}

function installCommand(packageManager: SetupRecommendationProject["packageManager"]): string | undefined {
  if (packageManager === "npm") return "npm ci";
  if (packageManager === "pnpm") return "pnpm install --frozen-lockfile";
  if (packageManager === "yarn") return "yarn install --immutable";
  return undefined;
}

function scriptRunner(packageManager: SetupRecommendationProject["packageManager"]): string {
  if (packageManager === "pnpm") return "pnpm";
  if (packageManager === "yarn") return "yarn";
  return "npm run";
}

function serveCommand(
  packageManager: SetupRecommendationProject["packageManager"],
  scripts: Record<string, string>,
  projectType: VisualHiveConfig["project"]["type"]
): string | undefined {
  const runner = scriptRunner(packageManager);
  if (scripts.preview) return `${runner} preview -- --port ${DEFAULT_PORT}`;
  if (scripts.dev) return `${runner} dev -- --host 127.0.0.1 --port ${DEFAULT_PORT}`;
  if (projectType === "nextjs" && scripts.start) return `${runner} start -- -p ${DEFAULT_PORT}`;
  if (scripts.start) return `${runner} start`;
  return undefined;
}

function buildTarget(input: {
  install?: string;
  build?: string;
  serve?: string;
  inventory: RepoInventory;
  projectType: VisualHiveConfig["project"]["type"];
}): { id: string; config: TargetConfig; confidence: SetupRecommendedTarget["confidence"]; reasons: string[] } {
  const reasons: string[] = [];
  if (input.serve) {
    reasons.push(`Detected a runnable package script for local preview: ${sanitizeText(input.serve)}.`);
    if (input.build) reasons.push(`Detected a build script: ${sanitizeText(input.build)}.`);
    return {
      id: "localPreview",
      config: {
        kind: "command",
        install: input.install,
        build: input.build,
        serve: input.serve,
        url: `http://127.0.0.1:${DEFAULT_PORT}`,
        prSafe: true,
        cost: "cheap"
      },
      confidence: input.build ? "high" : "medium",
      reasons
    };
  }
  reasons.push("No preview/dev/start script was detected, so Visual Hive can only recommend a URL target until a local serve command exists.");
  return {
    id: "localPreview",
    config: {
      kind: "url",
      url: `http://127.0.0.1:${DEFAULT_PORT}`,
      prSafe: true,
      cost: "cheap"
    },
    confidence: input.inventory.packageJson ? "low" : "medium",
    reasons
  };
}

function preferredSelector(selectors: SetupDetectedSelector[]): string {
  const preferredIds = ["dashboard-page", "app-shell", "root", "main-content", "dashboard-card"];
  for (const id of preferredIds) {
    const found = selectors.find((selector) => selector.selector === `[data-testid='${id}']`);
    if (found) return found.selector;
  }
  return selectors[0]?.selector ?? "body";
}

function buildContract(
  selector: string,
  targetId: string
): { config: ContractConfig; reasons: string[] } {
  const waitFor = selector === "body" ? [] : [{ selector, state: "visible" as const, timeoutMs: 15000 }];
  return {
    config: {
      id: "app-shell-visual-stability",
      description: "Recommended app shell contract generated by Visual Hive.",
      target: targetId,
      severity: "high",
      runOn: { pullRequest: true, schedule: true },
      waitFor,
      steps:
        selector === "body"
          ? [{ action: "assertVisible", selector: "body", description: "Starter page shell is visible.", state: "visible", timeoutMs: 5000 }]
          : [{ action: "assertVisible", selector, description: "Starter page shell is visible.", state: "visible", timeoutMs: 5000 }],
      failOnConsoleError: false,
      expectedConsoleErrors: [],
      selectors: { mustExist: [selector], mustNotExist: [], textMustExist: [], textMustNotExist: [] },
      screenshots: [
        { name: "app-shell-desktop", route: "/", viewport: "desktop", fullPage: true, mask: [] },
        { name: "app-shell-mobile", route: "/", viewport: "mobile", fullPage: true, mask: [] }
      ]
    },
    reasons: [
      selector === "body"
        ? "No data-testid selectors were detected, so the starter contract uses body until project-owned selectors are added."
        : `Detected stable project-owned selector ${selector}.`,
      "Desktop and mobile screenshots give the first PR-safe visual regression lane."
    ]
  };
}

function configInput(input: {
  projectName: string;
  projectType: VisualHiveConfig["project"]["type"];
  target: TargetConfig;
  contract: ContractConfig;
}): unknown {
  return {
    project: {
      name: input.projectName,
      type: input.projectType,
      defaultBranch: "main",
      setupProfile: "free-local"
    },
    targets: {
      localPreview: input.target
    },
    contracts: [input.contract],
    viewports: {
      desktop: { width: 1440, height: 900 },
      mobile: { width: 390, height: 844 }
    },
    visual: {
      maxDiffPixelRatio: 0.01,
      updateSnapshots: false,
      failOnMissingBaselineInCI: true,
      snapshotDir: ".visual-hive/snapshots",
      artifactDir: ".visual-hive/artifacts"
    },
    selection: {
      changedFiles: [
        {
          pattern: "src/**",
          contracts: ["app-shell-visual-stability"],
          risk: "medium"
        }
      ]
    },
    mutation: {
      enabled: true,
      runOn: { schedule: true },
      minScore: 0.7,
      operators: [
        "hide-critical-button",
        "force-login-on-demo",
        "api-500",
        "mobile-overflow",
        "broken-image"
      ] satisfies MutationOperator[]
    },
    ai: {
      enabled: false,
      provider: "none",
      neverSoleOracle: true,
      createIssuePrompt: true,
      maxDailyRuns: 5
    },
    costPolicy: {
      maxExternalScreenshotsPerRun: 0,
      maxMonthlyExternalScreenshots: 5000,
      externalUpload: {
        pullRequest: false,
        schedule: true,
        manual: true,
        canary: false,
        mutation: false,
        full: true,
        onFailureOnly: true,
        criticalContractsOnly: true
      }
    },
    github: {
      enabled: true,
      issueLabels: ["visual-hive", "test-failure"],
      commentMarker: "<!-- visual-hive-report -->"
    }
  };
}

function buildFindings(
  inventory: RepoInventory,
  target: { confidence: SetupRecommendedTarget["confidence"] },
  selector: string
): SetupRecommendationFinding[] {
  const findings: SetupRecommendationFinding[] = [];
  findings.push({
    severity: "info",
    message: `Detected project type ${inferProjectType(inventory)} with ${inventory.packageManager} commands.`,
    evidence: inventory.detectedFrameworks.join(", ") || "No major frontend framework dependency detected."
  });
  if (selector === "body") {
    findings.push({
      severity: "warning",
      message: "No data-testid selectors were found. Add project-owned selectors before relying on visual contracts for precise diagnostics."
    });
  }
  if (target.confidence === "low") {
    findings.push({
      severity: "warning",
      message: "No local preview command was found. Add a dev, preview, or start script before enabling deterministic PR runs."
    });
  }
  return findings;
}

function buildWarnings(inventory: RepoInventory, serve: string | undefined, selector: string): string[] {
  const warnings: string[] = [];
  if (!inventory.packageJson) warnings.push("No package.json was found at the repository root.");
  if (!serve) warnings.push("No preview/dev/start script was detected for a command target.");
  if (selector === "body") warnings.push("Starter contract uses body because no data-testid selectors were detected.");
  return warnings;
}

async function collectSourceFiles(repoRoot: string): Promise<string[]> {
  const files: string[] = [];
  await walk(repoRoot, files);
  return files.slice(0, MAX_SOURCE_FILES);
}

async function walk(dir: string, files: string[], base = dir): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (files.length >= MAX_SOURCE_FILES) return;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRS.has(entry.name)) continue;
      await walk(fullPath, files, base);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    files.push(normalizeSlashes(path.relative(base, fullPath)));
  }
}

async function collectSelectors(repoRoot: string, sourceFiles: string[]): Promise<SetupDetectedSelector[]> {
  const counts = new Map<string, SetupDetectedSelector>();
  for (const sourceFile of sourceFiles) {
    let raw;
    try {
      raw = await readFile(path.join(repoRoot, sourceFile), "utf8");
    } catch {
      continue;
    }
    TEST_ID_PATTERN.lastIndex = 0;
    for (const match of raw.matchAll(TEST_ID_PATTERN)) {
      const testId = sanitizeText(match[1] ?? "").trim();
      if (!testId) continue;
      const selector = `[data-testid='${testId}']`;
      const existing = counts.get(selector);
      if (existing) {
        existing.occurrences += 1;
      } else {
        counts.set(selector, { selector, sourceFile: normalizeSlashes(sourceFile), occurrences: 1 });
      }
    }
  }
  return [...counts.values()].sort((a, b) => b.occurrences - a.occurrences || a.selector.localeCompare(b.selector));
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    const fileStat = await stat(filePath);
    return fileStat.isFile();
  } catch {
    return false;
  }
}

function normalizeSlashes(value: string): string {
  return sanitizeText(value.replaceAll("\\", "/"));
}
