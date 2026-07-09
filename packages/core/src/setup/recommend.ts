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
import { githubWorkflowTemplates } from "../github/workflowTemplates.js";
import { getEvidenceResourceById } from "../tools/evidenceResources.js";
import { sanitizeText } from "../utils/sanitize.js";

export interface SetupRecommendationReport {
  schemaVersion: 1;
  project: SetupRecommendationProject;
  generatedAt: string;
  outputResource?: SetupRecommendationOutputResource;
  configPath: string;
  setupProfile: VisualHiveConfig["project"]["setupProfile"];
  providerRecommendations: SetupProviderRecommendation[];
  costEstimate: SetupCostEstimate;
  permissions: SetupPermissionRecommendation;
  setupPullRequest: SetupPullRequestRecommendation;
  setupActions: SetupActionRecommendation[];
  workflowPreviews: SetupWorkflowPreview[];
  recommendedConfig: VisualHiveConfig;
  recommendedConfigYaml: string;
  detectedSelectors: SetupDetectedSelector[];
  detectedRoutes: SetupDetectedRoute[];
  detectedStories: SetupDetectedStory[];
  detectedWorkflows: SetupDetectedWorkflow[];
  playwright: SetupPlaywrightPresence;
  recommendedTarget: SetupRecommendedTarget;
  recommendedContracts: SetupRecommendedContract[];
  onboardingChecklist: SetupChecklistItem[];
  recommendedCommands: string[];
  findings: SetupRecommendationFinding[];
  warnings: string[];
}

export interface SetupRecommendationOutputResource {
  artifactPath: string;
  evidenceResourceId: string;
  evidenceResourceUri: string;
  evidenceResourceTitle: string;
  evidenceResourceDescription: string;
  evidenceReadToolName?: string;
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

export interface SetupDetectedRoute {
  route: string;
  sourceFile: string;
  occurrences: number;
}

export interface SetupDetectedStory {
  storyFile: string;
  title: string;
  exports: string[];
  route: string;
}

export interface SetupDetectedWorkflow {
  path: string;
  triggers: string[];
  permissions: string[];
  usesPullRequestTarget: boolean;
  usesSecrets: boolean;
  visualHiveRelated: boolean;
}

export interface SetupPlaywrightPresence {
  status: "present" | "partial" | "missing";
  dependencies: string[];
  scripts: string[];
  configFiles: string[];
  notes: string[];
}

export interface SetupRecommendedTarget {
  id: string;
  kind: TargetConfig["kind"];
  url: string;
  install?: string;
  build?: string;
  serve?: string;
  setup?: string[];
  services?: SetupRecommendedService[];
  teardown?: string[];
  confidence: "high" | "medium" | "low";
  reasons: string[];
}

export interface SetupRecommendedService {
  name: string;
  command: string;
  url: string;
  readinessTimeoutMs?: number;
}

export interface SetupRecommendedContract {
  id: string;
  targetId: string;
  selectors: string[];
  steps: Array<{ action: string; selector?: string; route?: string; value?: string }>;
  screenshots: Array<{ name: string; route: string; viewport: string }>;
  reasons: string[];
}

export interface SetupProviderRecommendation {
  providerId: string;
  label: string;
  recommendation: "use" | "optional" | "skip" | "future";
  reason: string;
  requiredEnv: string[];
  externalUploadAllowedByDefault: boolean;
}

export interface SetupCostEstimate {
  localScreenshotsPerRun: number;
  externalScreenshotsPerRun: number;
  estimatedPrMinutes: number;
  estimatedScheduledMinutes: number;
  estimatedMonthlyExternalScreenshots: number;
  ciRuntimeClass: "cheap" | "medium" | "expensive";
  notes: string[];
}

export interface SetupPermissionRecommendation {
  pullRequest: {
    permissions: string[];
    secretsRequired: string[];
    externalNetwork: boolean;
    notes: string[];
  };
  scheduled: {
    permissions: string[];
    secretsRequired: string[];
    externalNetwork: boolean;
    notes: string[];
  };
}

export interface SetupPullRequestRecommendation {
  recommended: boolean;
  title: string;
  files: string[];
  steps: string[];
  securityNotes: string[];
}

export interface SetupActionRecommendation {
  id: string;
  label: string;
  category: "profile" | "write" | "provider" | "validate";
  description: string;
  command: string;
  recommended: boolean;
  requiresConfirmation: boolean;
  writes: string[];
  safetyNotes: string[];
  outcome: string;
}

export interface SetupWorkflowPreview {
  id: string;
  label: string;
  path: string;
  description: string;
  safetyNotes: string[];
  content: string;
}

export interface SetupRecommendationFinding {
  severity: "info" | "warning";
  message: string;
  evidence?: string;
}

export interface SetupChecklistItem {
  id: string;
  title: string;
  status: "ready" | "review" | "blocked";
  description: string;
  evidence: string[];
  action: string;
  command?: string;
  relatedArtifacts: string[];
}

export interface RecommendSetupOptions {
  repoRoot: string;
  configPath?: string;
  setupProfile?: VisualHiveConfig["project"]["setupProfile"];
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
  routes: SetupDetectedRoute[];
  stories: SetupDetectedStory[];
  workflows: SetupDetectedWorkflow[];
  playwright: SetupPlaywrightPresence;
}

const DEFAULT_PORT = 4173;
const STORYBOOK_PORT = 6006;
const MAX_SOURCE_FILES = 250;
const MAX_RECOMMENDED_STORYBOOK_CONTRACTS = 3;
const MAX_RECOMMENDED_ROUTE_CONTRACTS = 3;
const TEST_ID_PATTERN = /data-testid\s*=\s*["'`]([^"'`]+)["'`]/g;
const ROUTE_HINT_PATTERN = /\b(?:to|href|path)\s*=\s*["'`]((?:\/|#\/)[^"'`{}\s]*)["'`]|(?:route|path)\s*:\s*["'`]((?:\/|#\/)[^"'`{}\s]*)["'`]/g;
const STORY_TITLE_PATTERN = /title\s*:\s*["'`]([^"'`]+)["'`]/;
const STORY_EXPORT_PATTERN = /export\s+(?:const|function)\s+([A-Z_a-z]\w*)/g;
const NON_STORY_EXPORTS = new Set(["meta", "default"]);
const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".vue", ".svelte", ".html"]);
const SKIPPED_DIRS = new Set([".git", ".visual-hive", "node_modules", "dist", "build", "coverage", ".next", "out"]);
const PROVIDER_LABELS: Record<string, string> = {
  playwright: "Playwright built-in",
  argos: "Argos",
  percy: "Percy",
  chromatic: "Chromatic",
  applitools: "Applitools",
  storybook: "Storybook",
  "github-checks": "GitHub Checks"
};

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
  const setupProfile = options.setupProfile ?? inferSetupProfile(inventory, scripts);
  const target = buildTarget({ install, build, serve, inventory, projectType, setupProfile });
  const selector = preferredSelector(inventory.selectors);
  const contracts = buildContracts(selector, target.id, target.config, inventory);
  const recommendationInput = configInput({
    projectName,
    projectType,
    setupProfile,
    targetId: target.id,
    target: target.config,
    contracts: contracts.map((contract) => contract.config)
  });
  const recommendedConfig = VisualHiveConfigSchema.parse(recommendationInput);
  const recommendedConfigYaml = stringify(recommendationInput, { sortMapEntries: false });
  const warnings = buildWarnings(inventory, serve, selector);
  const costEstimate = buildCostEstimate(contracts.map((contract) => contract.config), target.config, setupProfile);
  const providerRecommendations = buildProviderRecommendations(inventory, setupProfile);
  const permissions = buildPermissionRecommendation(setupProfile);
  const setupPullRequest = buildSetupPullRequestRecommendation(configPath, setupProfile);
  const workflowPreviews = buildWorkflowPreviews();
  const recommendedContracts = contracts.map((contract) => ({
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
  }));
  const recommendedCommands = [
    "visual-hive doctor",
    "visual-hive plan --mode pr --changed-files changed-files.txt",
    "visual-hive run",
    "visual-hive coverage --mode pr --changed-files changed-files.txt",
    "visual-hive triage",
    "visual-hive report"
  ];
  const setupActions = buildSetupActionRecommendations({
    setupProfile,
    setupPullRequest,
    providerRecommendations,
    recommendedCommands
  });

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
    outputResource: catalogedOutputResource("setup-recommendations", ".visual-hive/recommendations.json"),
    configPath: normalizeSlashes(path.relative(repoRoot, configPath) || path.basename(configPath)),
    setupProfile,
    providerRecommendations,
    costEstimate,
    permissions,
    setupPullRequest,
    setupActions,
    workflowPreviews,
    recommendedConfig,
    recommendedConfigYaml,
    detectedSelectors: inventory.selectors.slice(0, 20),
    detectedRoutes: inventory.routes.slice(0, 20),
    detectedStories: inventory.stories.slice(0, 20),
    detectedWorkflows: inventory.workflows.slice(0, 20),
    playwright: inventory.playwright,
    recommendedTarget: {
      id: target.id,
      kind: target.config.kind,
      url: "url" in target.config ? (target.config.url ?? "http://127.0.0.1:4173") : "http://127.0.0.1:4173",
      install: "install" in target.config ? target.config.install : undefined,
      build: "build" in target.config ? target.config.build : undefined,
      serve: "serve" in target.config ? target.config.serve : undefined,
      setup: "setup" in target.config ? target.config.setup : undefined,
      services: "services" in target.config ? target.config.services.map((service) => ({
        name: service.name,
        command: service.command,
        url: service.url,
        readinessTimeoutMs: service.readinessTimeoutMs
      })) : undefined,
      teardown: "teardown" in target.config ? target.config.teardown : undefined,
      confidence: target.confidence,
      reasons: target.reasons
    },
    recommendedContracts,
    onboardingChecklist: buildOnboardingChecklist({
      projectName,
      inventory,
      target,
      recommendedContracts,
      providerRecommendations,
      permissions,
      setupPullRequest,
      recommendedCommands
    }),
    recommendedCommands,
    findings: buildFindings(inventory, target, selector),
    warnings
  };
}

function buildWorkflowPreviews(): SetupWorkflowPreview[] {
  return githubWorkflowTemplates.map((template) => ({
    id: template.id,
    label: template.label,
    path: template.path,
    description: template.description,
    safetyNotes: template.safetyNotes,
    content: template.content
  }));
}

async function inspectRepository(repoRoot: string): Promise<RepoInventory> {
  const packageJson = await readPackageJson(repoRoot);
  const packageManager = await detectPackageManager(repoRoot);
  const detectedFrameworks = detectFrameworks(packageJson);
  const sourceFiles = await collectSourceFiles(repoRoot);
  const selectors = await collectSelectors(repoRoot, sourceFiles);
  const routes = await collectRoutes(repoRoot, sourceFiles);
  const stories = await collectStories(repoRoot, sourceFiles);
  const workflows = await collectWorkflowHints(repoRoot);
  const playwright = await detectPlaywrightPresence(repoRoot, packageJson);
  return { packageJson, packageManager, detectedFrameworks, sourceFiles, selectors, routes, stories, workflows, playwright };
}

async function readPackageJson(repoRoot: string): Promise<PackageJsonShape | undefined> {
  try {
    const raw = await readFile(path.join(repoRoot, "package.json"), "utf8");
    return JSON.parse(stripBom(raw)) as PackageJsonShape;
  } catch {
    return undefined;
  }
}

function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
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
    if (["react", "vite", "next", "vue", "svelte", "@angular/core"].includes(key)) {
      frameworks.add(key);
    }
    if (key === "storybook" || key.startsWith("@storybook/") || key.includes("storybook")) frameworks.add("storybook");
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
  if (scripts.preview) return `${runner} preview -- --port ${DEFAULT_PORT} --strictPort`;
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
  setupProfile: VisualHiveConfig["project"]["setupProfile"];
}): { id: string; config: TargetConfig; confidence: SetupRecommendedTarget["confidence"]; reasons: string[] } {
  const reasons: string[] = [];
  const storybook = storybookCommands(input.inventory);
  if (storybook.serve) {
    reasons.push(`Detected a runnable Storybook script: ${sanitizeText(storybook.serve)}.`);
    if (storybook.build) reasons.push(`Detected a Storybook build script: ${sanitizeText(storybook.build)}.`);
    return {
      id: "componentLibrary",
      config: {
        kind: "storybook",
        install: input.install,
        build: storybook.build,
        serve: storybook.serve,
        url: `http://127.0.0.1:${STORYBOOK_PORT}`,
        stories: ["src/**/*.stories.@(js|jsx|ts|tsx|mdx)"],
        components: ["src/components/**"],
        prSafe: true,
        cost: "cheap"
      },
      confidence: storybook.build ? "high" : "medium",
      reasons
    };
  }
  const commandGroup = commandGroupTarget(input.inventory, input.setupProfile);
  if (commandGroup) {
    return commandGroup;
  }
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

function commandGroupTarget(
  inventory: RepoInventory,
  setupProfile: VisualHiveConfig["project"]["setupProfile"]
): { id: string; config: TargetConfig; confidence: SetupRecommendedTarget["confidence"]; reasons: string[] } | undefined {
  if (setupProfile !== "complex-app") return undefined;
  const scripts = inventory.packageJson?.scripts ?? {};
  const runner = scriptRunner(inventory.packageManager);
  const frontend = findScript(scripts, [
    "dev:web",
    "web:dev",
    "dev:frontend",
    "frontend:dev",
    "preview",
    "dev"
  ]);
  const backend = findScript(scripts, [
    "dev:api",
    "api:dev",
    "dev:backend",
    "backend:dev",
    "dev:server",
    "server:dev"
  ]);
  const fakeOAuth = findScript(
    scripts,
    ["dev:oauth", "oauth:dev", "fake-oauth", "oauth:fake", "mock-oauth", "auth:fake"],
    (name, command) => /(fake|mock).*oauth|oauth.*(fake|mock)|auth.*(fake|mock)/i.test(`${name} ${command}`)
  );
  const services = [
    backend
      ? {
          name: "backend",
          command: `${runner} ${backend.name}`,
          url: serviceUrl(backend.value, 8080, "/health"),
          readinessTimeoutMs: 30000
        }
      : undefined,
    fakeOAuth
      ? {
          name: "fakeOAuth",
          command: `${runner} ${fakeOAuth.name}`,
          url: serviceUrl(fakeOAuth.value, 8787, "/health"),
          readinessTimeoutMs: 30000
        }
      : undefined,
    frontend
      ? {
          name: "frontend",
          command: `${runner} ${frontend.name}`,
          url: serviceUrl(frontend.value, DEFAULT_PORT),
          readinessTimeoutMs: 30000
        }
      : undefined
  ].filter((service): service is { name: string; command: string; url: string; readinessTimeoutMs: number } => Boolean(service));
  if (!frontend || services.length < 2) return undefined;
  const setup = setupCommandsForCommandGroup(scripts, runner);
  const reasons = [
    `Detected complex-app script profile with frontend service ${sanitizeText(frontend.name)}.`,
    backend ? `Detected backend service script ${sanitizeText(backend.name)}.` : "",
    fakeOAuth ? `Detected fake OAuth service script ${sanitizeText(fakeOAuth.name)}.` : "",
    setup.length ? `Detected setup command(s): ${setup.map((command) => sanitizeText(command)).join(", ")}.` : "No setup commands were added; review whether backend/frontend builds are needed."
  ].filter(Boolean);
  return {
    id: fakeOAuth ? "fakeOAuthFullstack" : "localFullstack",
    config: {
      kind: "commandGroup",
      setup,
      services,
      teardown: [],
      url: services.find((service) => service.name === "frontend")?.url ?? `http://127.0.0.1:${DEFAULT_PORT}`,
      prSafe: true,
      cost: fakeOAuth ? "medium" : "medium"
    },
    confidence: fakeOAuth && backend ? "high" : "medium",
    reasons
  };
}

function findScript(
  scripts: Record<string, string>,
  preferredNames: string[],
  predicate?: (name: string, command: string) => boolean
): { name: string; value: string } | undefined {
  for (const name of preferredNames) {
    if (scripts[name]) return { name, value: scripts[name] };
  }
  const match = Object.entries(scripts).find(([name, command]) => predicate?.(name, command));
  return match ? { name: match[0], value: match[1] } : undefined;
}

function setupCommandsForCommandGroup(scripts: Record<string, string>, runner: string): string[] {
  const setupScripts = [
    "build:backend",
    "backend:build",
    "build:api",
    "api:build",
    "build:frontend",
    "frontend:build",
    "build:web",
    "web:build",
    "build"
  ];
  const commands = setupScripts.filter((script) => scripts[script]).map((script) => `${runner} ${script}`);
  return unique(commands).slice(0, 4);
}

function serviceUrl(command: string, fallbackPort: number, fallbackPath = ""): string {
  const port = extractPort(command) ?? fallbackPort;
  return `http://127.0.0.1:${port}${fallbackPath}`;
}

function extractPort(command: string): number | undefined {
  const matches = [
    /(?:--port|-p)\s+(\d{2,5})/i.exec(command),
    /PORT=(\d{2,5})/i.exec(command),
    /port\s*[:=]\s*(\d{2,5})/i.exec(command)
  ];
  const value = matches.find(Boolean)?.[1];
  if (!value) return undefined;
  const port = Number.parseInt(value, 10);
  return Number.isFinite(port) && port > 0 && port <= 65535 ? port : undefined;
}

function storybookCommands(inventory: RepoInventory): { serve?: string; build?: string } {
  const scripts = inventory.packageJson?.scripts ?? {};
  const runner = scriptRunner(inventory.packageManager);
  const serveScript = scripts.storybook
    ? "storybook"
    : scripts["storybook:dev"]
      ? "storybook:dev"
      : scripts["dev:storybook"]
        ? "dev:storybook"
        : undefined;
  const buildScript = scripts["build-storybook"] ? "build-storybook" : scripts["storybook:build"] ? "storybook:build" : undefined;
  return {
    serve: serveScript ? `${runner} ${serveScript} -- --host 127.0.0.1 --port ${STORYBOOK_PORT}` : undefined,
    build: buildScript ? `${runner} ${buildScript}` : undefined
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

function buildContracts(
  selector: string,
  targetId: string,
  target: TargetConfig,
  inventory: RepoInventory
): Array<{ config: ContractConfig; reasons: string[] }> {
  if (target.kind === "storybook") {
    return buildStorybookContracts(selector, targetId, inventory);
  }
  return buildAppContracts(selector, targetId, inventory);
}

function buildAppContracts(
  selector: string,
  targetId: string,
  inventory: RepoInventory
): Array<{ config: ContractConfig; reasons: string[] }> {
  const waitFor = selector === "body" ? [] : [{ selector, state: "visible" as const, timeoutMs: 15000 }];
  const primaryContract = {
    config: {
      id: "app-shell-visual-stability",
      description: "Recommended app shell contract generated by Visual Hive.",
      target: targetId,
      severity: "high" as const,
      runOn: { pullRequest: true, schedule: true },
      waitFor,
      steps:
        selector === "body"
          ? [{ action: "assertVisible" as const, selector: "body", description: "Starter page shell is visible.", state: "visible" as const, timeoutMs: 5000 }]
          : [{ action: "assertVisible" as const, selector, description: "Starter page shell is visible.", state: "visible" as const, timeoutMs: 5000 }],
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
  const routeContracts = uniqueRoutes(inventory.routes)
    .filter((route) => route.route !== "/" && route.route !== "#/")
    .slice(0, MAX_RECOMMENDED_ROUTE_CONTRACTS)
    .map((route) => buildRouteContract(selector, targetId, route));
  return [primaryContract, ...routeContracts];
}

function buildRouteContract(
  selector: string,
  targetId: string,
  route: SetupDetectedRoute
): { config: ContractConfig; reasons: string[] } {
  const slug = routeContractSlug(route.route);
  const assertionSelector = selector === "body" ? "body" : selector;
  return {
    config: {
      id: `route-${slug}-visual-stability`,
      description: `Recommended route contract for ${route.route} generated by Visual Hive.`,
      target: targetId,
      severity: "medium",
      runOn: { pullRequest: true, schedule: true },
      waitFor: [{ selector: assertionSelector, state: "visible", timeoutMs: 15000 }],
      steps: [
        { action: "goto", route: route.route, description: `Navigate to ${route.route}.`, state: "visible", timeoutMs: 15000 },
        { action: "assertVisible", selector: assertionSelector, description: `Route ${route.route} shell is visible.`, state: "visible", timeoutMs: 5000 }
      ],
      failOnConsoleError: false,
      expectedConsoleErrors: [],
      selectors: { mustExist: [assertionSelector], mustNotExist: [], textMustExist: [], textMustNotExist: [] },
      screenshots: [{ name: `${slug}-desktop`, route: route.route, viewport: "desktop", fullPage: true, mask: [] }]
    },
    reasons: [
      `Detected route hint ${route.route} in ${route.sourceFile}.`,
      "Route-specific screenshots make initial coverage broader than a single home page without requiring protected targets."
    ]
  };
}

function uniqueRoutes(routes: SetupDetectedRoute[]): SetupDetectedRoute[] {
  const seen = new Set<string>();
  return routes.filter((route) => {
    if (seen.has(route.route)) {
      return false;
    }
    seen.add(route.route);
    return true;
  });
}

function routeContractSlug(route: string): string {
  const normalized = route
    .replace(/^#/, "")
    .replace(/[/?#&=]+/g, "-")
    .replace(/[^A-Za-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return normalized || "root";
}

function buildStorybookContracts(
  selector: string,
  targetId: string,
  inventory: RepoInventory
): Array<{ config: ContractConfig; reasons: string[] }> {
  const stories = inventory.stories.length ? inventory.stories.slice(0, MAX_RECOMMENDED_STORYBOOK_CONTRACTS) : [undefined];
  const waitFor = selector === "body" ? [{ selector: "body", state: "visible" as const, timeoutMs: 15000 }] : [{ selector, state: "visible" as const, timeoutMs: 15000 }];
  const selectors = selector === "body" ? ["body"] : [selector];
  return stories.map((story, index) => {
    const route = story?.route ?? "/iframe.html?viewMode=story";
    const storySlug = story ? storyContractSlug(story) : "storybook-component";
    const screenshotBase = storySlug || `storybook-component-${index + 1}`;
    return {
      config: {
        id: story ? `storybook-${storySlug}-visual-stability` : "component-library-visual-stability",
        description: "Recommended Storybook component contract generated by Visual Hive.",
        target: targetId,
        severity: "high",
        runOn: { pullRequest: true, schedule: true },
        waitFor,
        steps: [{ action: "assertVisible", selector: selectors[0], description: "Starter Storybook story is visible.", state: "visible", timeoutMs: 5000 }],
        failOnConsoleError: false,
        expectedConsoleErrors: [],
        selectors: { mustExist: selectors, mustNotExist: [], textMustExist: [], textMustNotExist: [] },
        screenshots: [
          { name: `${screenshotBase}-desktop`, route, viewport: "desktop", fullPage: true, mask: [] },
          { name: `${screenshotBase}-mobile`, route, viewport: "mobile", fullPage: true, mask: [] }
        ]
      },
      reasons: [
        story
          ? `Detected Storybook story ${story.title} in ${story.storyFile}; starter screenshots target ${story.route}.`
          : "Storybook was detected, but no story files were found; starter screenshots use the Storybook iframe route and should be refined after adding stories.",
        selector === "body"
          ? "No data-testid selectors were detected, so the starter Storybook contract uses body until component-owned selectors are added."
          : `Detected component selector ${selector}.`,
        "Desktop and mobile Storybook screenshots give a PR-safe component visual lane without requiring Chromatic."
      ]
    };
  });
}

function inferSetupProfile(
  inventory: RepoInventory,
  scripts: Record<string, string>
): VisualHiveConfig["project"]["setupProfile"] {
  const frameworks = new Set(inventory.detectedFrameworks);
  if (frameworks.has("storybook")) return "component-storybook";
  const scriptText = Object.entries(scripts)
    .map(([name, value]) => `${name} ${value}`)
    .join(" ")
    .toLowerCase();
  const complexHints = ["backend", "server", "api", "oauth", "auth", "cluster", "fullstack", "docker compose"];
  if (complexHints.some((hint) => scriptText.includes(hint))) return "complex-app";
  return "free-local";
}

function buildProviderRecommendations(
  inventory: RepoInventory,
  setupProfile: VisualHiveConfig["project"]["setupProfile"]
): SetupProviderRecommendation[] {
  const frameworks = new Set(inventory.detectedFrameworks);
  const recommendations: SetupProviderRecommendation[] = [
    {
      providerId: "playwright",
      label: PROVIDER_LABELS.playwright,
      recommendation: "use",
      reason: "Default local browser evidence runner. No paid account or external upload is required.",
      requiredEnv: [],
      externalUploadAllowedByDefault: false
    }
  ];
  if (frameworks.has("storybook")) {
    recommendations.push({
      providerId: "chromatic",
      label: PROVIDER_LABELS.chromatic,
      recommendation: "optional",
      reason: "Storybook was detected, so hosted component review can be useful after the local Playwright lane is stable.",
      requiredEnv: ["CHROMATIC_PROJECT_TOKEN"],
      externalUploadAllowedByDefault: false
    });
  } else {
    recommendations.push({
      providerId: "argos",
      label: PROVIDER_LABELS.argos,
      recommendation: setupProfile === "free-local" ? "future" : "optional",
      reason:
        setupProfile === "free-local"
          ? "Start with local artifacts. Enable hosted review later only if the team needs shared screenshot review/history."
          : "Useful for hosted screenshot review on scheduled or failure-only runs after local checks are stable.",
      requiredEnv: ["ARGOS_TOKEN"],
      externalUploadAllowedByDefault: false
    });
  }
  recommendations.push(
    {
      providerId: "percy",
      label: PROVIDER_LABELS.percy,
      recommendation: setupProfile === "hosted-review" || setupProfile === "enterprise-visual-ai" ? "optional" : "future",
      reason:
        setupProfile === "hosted-review" || setupProfile === "enterprise-visual-ai"
          ? "Useful when the team wants hosted review history or broader browser/device coverage after local checks pass."
          : "Consider only when broader hosted review or browser/device coverage justifies the extra service.",
      requiredEnv: ["PERCY_TOKEN"],
      externalUploadAllowedByDefault: false
    },
    {
      providerId: "applitools",
      label: PROVIDER_LABELS.applitools,
      recommendation: setupProfile === "enterprise-visual-ai" ? "optional" : "future",
      reason:
        setupProfile === "enterprise-visual-ai"
          ? "Enterprise visual AI is in scope for this profile, but it should run only from trusted scheduled/manual lanes after budget approval."
          : "Reserve for enterprise visual AI or cross-browser/device requirements.",
      requiredEnv: ["APPLITOOLS_API_KEY"],
      externalUploadAllowedByDefault: false
    }
  );
  return recommendations;
}

function buildCostEstimate(
  contracts: ContractConfig[],
  target: TargetConfig,
  setupProfile: VisualHiveConfig["project"]["setupProfile"]
): SetupCostEstimate {
  const localScreenshotsPerRun = contracts.reduce((sum, contract) => sum + contract.screenshots.length, 0);
  const externalScreenshotsPerRun = externalScreenshotsForProfile(setupProfile, localScreenshotsPerRun);
  const estimatedPrMinutes =
    target.kind === "commandGroup"
      ? 6
      : (target.kind === "command" || target.kind === "storybook") && target.build
        ? 4
        : 2;
  const estimatedScheduledMinutes =
    setupProfile === "complex-app" || setupProfile === "enterprise-visual-ai"
      ? estimatedPrMinutes + 6
      : setupProfile === "hosted-review" || setupProfile === "component-storybook"
        ? estimatedPrMinutes + 4
        : estimatedPrMinutes + 2;
  return {
    localScreenshotsPerRun,
    externalScreenshotsPerRun,
    estimatedPrMinutes,
    estimatedScheduledMinutes,
    estimatedMonthlyExternalScreenshots: externalScreenshotsPerRun * 20,
    ciRuntimeClass:
      setupProfile === "complex-app" || setupProfile === "enterprise-visual-ai" ? "expensive" : estimatedPrMinutes <= 2 ? "cheap" : "medium",
    notes: [
      setupProfile === "free-local"
        ? "Default recommendation uses local Playwright artifacts only."
        : "Profile allows optional external review only in trusted/failure-oriented lanes after credentials are configured.",
      "External provider uploads are disabled on PRs by the generated cost policy.",
      "Actual runtime depends on dependency cache, app build time, and target startup time."
    ]
  };
}

function externalScreenshotsForProfile(setupProfile: VisualHiveConfig["project"]["setupProfile"], localScreenshotsPerRun: number): number {
  if (setupProfile === "free-local") return 0;
  if (setupProfile === "enterprise-visual-ai") return localScreenshotsPerRun * 2;
  return localScreenshotsPerRun;
}

function buildPermissionRecommendation(setupProfile: VisualHiveConfig["project"]["setupProfile"]): SetupPermissionRecommendation {
  return {
    pullRequest: {
      permissions: ["contents: read"],
      secretsRequired: [],
      externalNetwork: false,
      notes: ["PR lane should run with no repository secrets and should not create issues."]
    },
    scheduled: {
      permissions: ["contents: read", "actions: read"],
      secretsRequired:
        setupProfile === "complex-app" || setupProfile === "enterprise-visual-ai" ? ["PROTECTED_TARGET_SECRET_NAMES"] : [],
      externalNetwork: setupProfile !== "free-local",
      notes: [
        "Scheduled/manual lanes may use protected secrets after explicit user authorization.",
        "Issue creation should happen from sanitized artifacts in a trusted workflow_run lane."
      ]
    }
  };
}

function buildSetupPullRequestRecommendation(configPath: string, setupProfile: VisualHiveConfig["project"]["setupProfile"]): SetupPullRequestRecommendation {
  return {
    recommended: true,
    title: "Add Visual Hive deterministic visual QA",
    files: [
      normalizeSlashes(path.basename(configPath)),
      ".github/workflows/visual-hive-pr.yml",
      ".github/workflows/visual-hive-scheduled.yml",
      "docs/visual-hive.md"
    ],
    steps: [
      "Run visual-hive recommend --write-config in the target repo.",
      "Review the generated config and PR workflow diff before committing.",
      "Run visual-hive doctor, plan, and run locally before opening the setup PR.",
      setupProfile === "free-local"
        ? "Keep the first PR lane local-only; add providers later if hosted review is needed."
        : "Keep provider uploads disabled until credentials and cost policy are explicitly approved."
    ],
    securityNotes: [
      "Use pull_request, not pull_request_target, for PR code execution.",
      "Do not put secrets in PR workflows.",
      "Show required secret names only; never print values.",
      "LLM output remains advisory and cannot decide pass/fail."
    ]
  };
}

function buildSetupActionRecommendations(input: {
  setupProfile: VisualHiveConfig["project"]["setupProfile"];
  setupPullRequest: SetupPullRequestRecommendation;
  providerRecommendations: SetupProviderRecommendation[];
  recommendedCommands: string[];
}): SetupActionRecommendation[] {
  const providerEnvNames = unique(input.providerRecommendations.flatMap((provider) => provider.requiredEnv)).sort();
  const hostedProviderLabels = input.providerRecommendations
    .filter((provider) => provider.recommendation === "optional" || provider.recommendation === "future")
    .map((provider) => provider.label);
  const providerDecisionTarget =
    input.providerRecommendations.find((provider) => provider.providerId !== "playwright" && provider.recommendation === "optional") ??
    input.providerRecommendations.find((provider) => provider.providerId !== "playwright" && provider.recommendation === "future");
  return [
    {
      id: "use-free-local-setup",
      label: "Use free local setup",
      category: "profile",
      description: "Regenerate recommendations for a Playwright-only setup with local artifacts and no paid provider assumptions.",
      command: "visual-hive recommend --profile free-local --write-setup-bundle",
      recommended: input.setupProfile === "free-local",
      requiresConfirmation: true,
      writes: input.setupPullRequest.files,
      safetyNotes: [
        "PR workflows remain read-only and secret-free.",
        "No external provider upload, billing, or LLM call is enabled."
      ],
      outcome: "Creates a guarded local-first config, docs, and workflow bundle."
    },
    {
      id: "enable-hosted-review-posture",
      label: "Enable hosted review posture",
      category: "profile",
      description: "Regenerate recommendations for teams that may later connect Argos, Percy, Chromatic, or Applitools in trusted lanes.",
      command: "visual-hive recommend --profile hosted-review --write-setup-bundle",
      recommended: input.setupProfile === "hosted-review",
      requiresConfirmation: true,
      writes: input.setupPullRequest.files,
      safetyNotes: [
        "This only changes recommended posture; it does not create credentials or upload artifacts.",
        providerEnvNames.length ? `Credential names to review later: ${providerEnvNames.join(", ")}` : "No provider credential names are required for the default path."
      ],
      outcome: `Produces hosted-review guidance while keeping provider use opt-in${hostedProviderLabels.length ? ` for ${hostedProviderLabels.join(", ")}` : ""}.`
    },
    {
      id: "skip-provider-for-now",
      label: "Skip provider for now",
      category: "provider",
      description: `Record a local governance decision to keep ${providerDecisionTarget?.label ?? "a supplemental provider"} disabled while using Playwright artifacts.`,
      command: `visual-hive providers decision --provider ${providerDecisionTarget?.providerId ?? "argos"} --decision skip --reason "Playwright artifacts are enough for this repo right now"`,
      recommended: input.setupProfile === "free-local",
      requiresConfirmation: false,
      writes: [".visual-hive/provider-decisions.json"],
      safetyNotes: [
        "Records local audit evidence only.",
        "Does not create credentials, enable billing, upload screenshots, or call a provider API."
      ],
      outcome: "Keeps the default provider posture explicit for reviewers."
    },
    {
      id: "generate-config",
      label: "Generate config",
      category: "write",
      description: "Write the recommended Visual Hive config after reviewing the YAML preview.",
      command: "visual-hive recommend --write-config",
      recommended: true,
      requiresConfirmation: true,
      writes: ["visual-hive.config.yaml", ".visual-hive/recommendations.json"],
      safetyNotes: ["Refuses to overwrite an existing config unless --force is passed."],
      outcome: "Creates the config used by doctor, plan, run, mutate, triage, and report."
    },
    {
      id: "preview-setup-pr",
      label: "Preview setup PR",
      category: "write",
      description: "Generate the config, docs, and workflow bundle that should be reviewed as a setup PR.",
      command: "visual-hive recommend --write-setup-bundle",
      recommended: true,
      requiresConfirmation: true,
      writes: input.setupPullRequest.files,
      safetyNotes: input.setupPullRequest.securityNotes,
      outcome: "Creates a reviewable setup bundle and audit artifacts without opening a PR automatically."
    },
    {
      id: "validate-local-path",
      label: "Validate local path",
      category: "validate",
      description: "Run the deterministic local proof after setup files are generated.",
      command: input.recommendedCommands.join(" && "),
      recommended: true,
      requiresConfirmation: false,
      writes: [".visual-hive/plan.json", ".visual-hive/report.json", ".visual-hive/triage.json"],
      safetyNotes: [
        "Visual Hive owns the deterministic verdict; Playwright is the default local evidence runner.",
        "First local screenshot runs may create baselines for human review."
      ],
      outcome: "Proves the local PR-safe path before making CI required."
    }
  ];
}

function configInput(input: {
  projectName: string;
  projectType: VisualHiveConfig["project"]["type"];
  setupProfile: VisualHiveConfig["project"]["setupProfile"];
  targetId: string;
  target: TargetConfig;
  contracts: ContractConfig[];
}): unknown {
  return {
    project: {
      name: input.projectName,
      type: input.projectType,
      defaultBranch: "main",
      setupProfile: input.setupProfile
    },
    targets: {
      [input.targetId]: input.target
    },
    contracts: input.contracts,
    viewports: {
      desktop: { width: 1440, height: 900 },
      mobile: { width: 390, height: 844 }
    },
    visual: {
      maxDiffPixelRatio: 0.01,
      updateSnapshots: false,
      failOnMissingBaselineInCI: true,
      baselinePlatform: "shared",
      snapshotDir: ".visual-hive/snapshots",
      artifactDir: ".visual-hive/artifacts"
    },
    selection: {
      changedFiles: selectionRulesFor(input.target, input.contracts)
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
      maxExternalScreenshotsPerRun: maxExternalScreenshotsPerRun(input.setupProfile, input.contracts.reduce((sum, contract) => sum + contract.screenshots.length, 0)),
      maxMonthlyExternalScreenshots: input.setupProfile === "enterprise-visual-ai" ? 10000 : 5000,
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

function selectionRulesFor(target: TargetConfig, contracts: ContractConfig[]): Array<{ pattern: string; contracts: string[]; risk: "medium" | "low" }> {
  const contractIds = contracts.map((contract) => contract.id);
  if (target.kind === "storybook") {
    return [
      {
        pattern: "src/**/*.stories.*",
        contracts: contractIds,
        risk: "medium"
      },
      {
        pattern: "src/components/**",
        contracts: contractIds,
        risk: "medium"
      },
      {
        pattern: "src/**",
        contracts: contractIds,
        risk: "low"
      }
    ];
  }
  const routeContractIds = contracts.filter((contract) => contract.id.startsWith("route-")).map((contract) => contract.id);
  if (routeContractIds.length) {
    return [
      {
        pattern: "src/routes/**",
        contracts: routeContractIds,
        risk: "medium"
      },
      {
        pattern: "src/pages/**",
        contracts: routeContractIds,
        risk: "medium"
      },
      {
        pattern: "app/**",
        contracts: routeContractIds,
        risk: "medium"
      },
      {
        pattern: "pages/**",
        contracts: routeContractIds,
        risk: "medium"
      },
      {
        pattern: "src/**",
        contracts: contractIds,
        risk: "medium"
      }
    ];
  }
  return [
    {
      pattern: "src/**",
      contracts: contractIds,
      risk: "medium"
    }
  ];
}

function maxExternalScreenshotsPerRun(setupProfile: VisualHiveConfig["project"]["setupProfile"], screenshotCount: number): number {
  if (setupProfile === "free-local") return 0;
  if (setupProfile === "enterprise-visual-ai") return Math.max(10, screenshotCount * 2);
  return Math.max(5, screenshotCount);
}

function buildOnboardingChecklist(input: {
  projectName: string;
  inventory: RepoInventory;
  target: { id: string; config: TargetConfig; confidence: SetupRecommendedTarget["confidence"]; reasons: string[] };
  recommendedContracts: SetupRecommendedContract[];
  providerRecommendations: SetupProviderRecommendation[];
  permissions: SetupPermissionRecommendation;
  setupPullRequest: SetupPullRequestRecommendation;
  recommendedCommands: string[];
}): SetupChecklistItem[] {
  const prSecrets = input.permissions.pullRequest.secretsRequired;
  const externalProvidersByDefault = input.providerRecommendations.filter((provider) => provider.externalUploadAllowedByDefault);
  const selectorCount = input.inventory.selectors.length;
  const routeCount = input.inventory.routes.length;
  const screenshotCount = input.recommendedContracts.flatMap((contract) => contract.screenshots).length;
  return [
    {
      id: "inspect-repository",
      title: "Inspect repository",
      status: input.inventory.packageJson ? "ready" : "review",
      description: "Confirm Visual Hive detected the project, package manager, scripts, framework signals, and selectors correctly.",
      evidence: [
        `project=${input.projectName}`,
        `packageManager=${input.inventory.packageManager}`,
        `frameworks=${input.inventory.detectedFrameworks.join(", ") || "none"}`,
        `scripts=${Object.keys(input.inventory.packageJson?.scripts ?? {}).sort().join(", ") || "none"}`,
        `routes=${routeCount}`,
        `playwright=${input.inventory.playwright.status}`
      ],
      action: "Review detected repo facts before writing setup files.",
      command: "visual-hive recommend --repo .",
      relatedArtifacts: [".visual-hive/recommendations.json"]
    },
    {
      id: "choose-pr-safe-target",
      title: "Choose PR-safe target",
      status: input.target.confidence === "low" ? "review" : "ready",
      description: "Use a local or otherwise PR-safe target that can run without secrets in pull request workflows.",
      evidence: [
        `target=${input.target.id}`,
        `kind=${input.target.config.kind}`,
        `confidence=${input.target.confidence}`,
        `url=${"url" in input.target.config ? input.target.config.url ?? "not configured" : "not configured"}`
      ],
      action:
        input.target.confidence === "low"
          ? "Add or fix a dev, preview, or start script before enabling required PR checks."
          : "Keep this target in the first PR-safe deterministic lane.",
      relatedArtifacts: ["visual-hive.config.yaml", ".visual-hive/targets.json"]
    },
    {
      id: "seed-starter-contracts",
      title: "Seed starter contracts",
      status: input.recommendedContracts.length && selectorCount ? "ready" : "review",
      description: "Start with the smallest useful route, selector, flow, and screenshot coverage before expanding to protected lanes.",
      evidence: [
        `contracts=${input.recommendedContracts.length}`,
        `selectors=${selectorCount}`,
        `screenshots=${screenshotCount}`
      ],
      action:
        selectorCount === 0
          ? "Add project-owned data-testid selectors for more precise diagnostics."
          : "Review the starter contract and add domain-specific contracts for important routes.",
      relatedArtifacts: ["visual-hive.config.yaml", ".visual-hive/contracts.json", ".visual-hive/coverage.json"]
    },
    {
      id: "verify-pr-safety",
      title: "Verify PR safety",
      status: prSecrets.length || externalProvidersByDefault.length ? "blocked" : "ready",
      description: "PR execution must stay read-only, no-secret, local-first, and free of external uploads by default.",
      evidence: [
        `permissions=${input.permissions.pullRequest.permissions.join(", ") || "unknown"}`,
        `prSecrets=${prSecrets.join(", ") || "none"}`,
        `externalProvidersByDefault=${externalProvidersByDefault.map((provider) => provider.label).join(", ") || "none"}`
      ],
      action:
        prSecrets.length || externalProvidersByDefault.length
          ? "Move secrets or external uploads to a scheduled/manual trusted lane before opening the setup PR."
          : "Use pull_request with read-only permissions and no secrets for the generated PR workflow.",
      relatedArtifacts: [".github/workflows/visual-hive-pr.yml", ".visual-hive/workflows.json", ".visual-hive/security.json"]
    },
    {
      id: "generate-setup-files",
      title: "Generate setup files",
      status: input.setupPullRequest.recommended ? "review" : "ready",
      description: "Write config, repo docs, and safe workflow templates only after reviewing the generated YAML and security notes.",
      evidence: [
        `files=${input.setupPullRequest.files.join(", ") || "none"}`,
        `title=${input.setupPullRequest.title}`
      ],
      action: "Run the guarded setup bundle command after reviewing the recommended YAML.",
      command: "visual-hive recommend --write-setup-bundle",
      relatedArtifacts: ["visual-hive.config.yaml", "docs/visual-hive.md", ".github/workflows/visual-hive-pr.yml"]
    },
    {
      id: "validate-locally",
      title: "Validate locally",
      status: input.recommendedCommands.length ? "ready" : "review",
      description: "Prove the deterministic local path before making CI required or approving baselines.",
      evidence: [`commands=${input.recommendedCommands.join(" && ") || "none"}`],
      action: "Run the recommended commands locally and review created baselines before CI enforcement.",
      command: input.recommendedCommands.join(" && "),
      relatedArtifacts: [".visual-hive/plan.json", ".visual-hive/report.json", ".visual-hive/triage.json", ".visual-hive/issue.md"]
    }
  ];
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
  if (inventory.playwright.status === "missing") {
    findings.push({
      severity: "info",
      message: "No Playwright dependency, script, or config file was detected. Visual Hive can still generate setup, but the target repo should install Visual Hive/Playwright before CI runs."
    });
  }
  const unsafeWorkflow = inventory.workflows.find((workflow) => workflow.usesPullRequestTarget);
  if (unsafeWorkflow) {
    findings.push({
      severity: "warning",
      message: "Existing workflow uses pull_request_target. Do not execute untrusted PR code in that workflow.",
      evidence: unsafeWorkflow.path
    });
  }
  const secretPrWorkflow = inventory.workflows.find((workflow) => workflow.triggers.includes("pull_request") && workflow.usesSecrets);
  if (secretPrWorkflow) {
    findings.push({
      severity: "warning",
      message: "Existing pull_request workflow appears to reference secrets. Visual Hive PR lanes should stay secret-free.",
      evidence: secretPrWorkflow.path
    });
  }
  return findings;
}

function buildWarnings(inventory: RepoInventory, serve: string | undefined, selector: string): string[] {
  const warnings: string[] = [];
  if (!inventory.packageJson) warnings.push("No package.json was found at the repository root.");
  if (!serve) warnings.push("No preview/dev/start script was detected for a command target.");
  if (selector === "body") warnings.push("Starter contract uses body because no data-testid selectors were detected.");
  if (inventory.playwright.status === "missing") warnings.push("No Playwright setup was detected in the target repo.");
  if (inventory.workflows.some((workflow) => workflow.usesPullRequestTarget)) {
    warnings.push("One or more existing workflows use pull_request_target; keep Visual Hive PR checks on pull_request.");
  }
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

async function collectRoutes(repoRoot: string, sourceFiles: string[]): Promise<SetupDetectedRoute[]> {
  const counts = new Map<string, SetupDetectedRoute>();
  for (const sourceFile of sourceFiles) {
    let raw;
    try {
      raw = await readFile(path.join(repoRoot, sourceFile), "utf8");
    } catch {
      continue;
    }
    ROUTE_HINT_PATTERN.lastIndex = 0;
    for (const match of raw.matchAll(ROUTE_HINT_PATTERN)) {
      const route = normalizeRouteHint(match[1] ?? match[2] ?? "");
      if (!route) continue;
      const existing = counts.get(route);
      if (existing) {
        existing.occurrences += 1;
      } else {
        counts.set(route, { route, sourceFile: normalizeSlashes(sourceFile), occurrences: 1 });
      }
    }
  }
  return [...counts.values()].sort((a, b) => b.occurrences - a.occurrences || a.route.localeCompare(b.route));
}

function normalizeRouteHint(route: string): string | undefined {
  const trimmed = sanitizeText(route).trim();
  if (!trimmed || trimmed.includes("*") || trimmed.includes(":") || trimmed.includes("${")) return undefined;
  const normalized = trimmed.startsWith("#/") ? trimmed.slice(1) : trimmed;
  if (!normalized.startsWith("/")) return undefined;
  if (/^\/(?:\/|#|mailto:|tel:)/i.test(normalized)) return undefined;
  return normalized.length > 1 ? normalized.replace(/\/+$/, "") : normalized;
}

async function collectStories(repoRoot: string, sourceFiles: string[]): Promise<SetupDetectedStory[]> {
  const stories: SetupDetectedStory[] = [];
  for (const sourceFile of sourceFiles.filter(isStoryFile)) {
    let raw;
    try {
      raw = await readFile(path.join(repoRoot, sourceFile), "utf8");
    } catch {
      continue;
    }
    const title = sanitizeText(STORY_TITLE_PATTERN.exec(raw)?.[1] ?? storyTitleFromPath(sourceFile));
    const exports = storyExports(raw);
    const firstExport = exports[0] ?? "Default";
    stories.push({
      storyFile: normalizeSlashes(sourceFile),
      title,
      exports,
      route: storyRoute(title, firstExport)
    });
  }
  return stories.sort((a, b) => a.storyFile.localeCompare(b.storyFile));
}

async function collectWorkflowHints(repoRoot: string): Promise<SetupDetectedWorkflow[]> {
  const workflowRoot = path.join(repoRoot, ".github", "workflows");
  let entries;
  try {
    entries = await readdir(workflowRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const workflows: SetupDetectedWorkflow[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/\.ya?ml$/i.test(entry.name)) continue;
    const fullPath = path.join(workflowRoot, entry.name);
    let raw;
    try {
      raw = await readFile(fullPath, "utf8");
    } catch {
      continue;
    }
    workflows.push({
      path: normalizeSlashes(path.join(".github", "workflows", entry.name)),
      triggers: detectWorkflowTriggers(raw),
      permissions: detectWorkflowPermissions(raw),
      usesPullRequestTarget: /\bpull_request_target\s*:/i.test(raw),
      usesSecrets: /\bsecrets\./i.test(raw) || /\$\{\{\s*secrets\./i.test(raw),
      visualHiveRelated: /\bvisual-hive\b/i.test(raw)
    });
  }
  return workflows.sort((a, b) => a.path.localeCompare(b.path));
}

async function detectPlaywrightPresence(repoRoot: string, packageJson?: PackageJsonShape): Promise<SetupPlaywrightPresence> {
  const deps = { ...(packageJson?.dependencies ?? {}), ...(packageJson?.devDependencies ?? {}) };
  const dependencies = Object.keys(deps)
    .filter((name) => name === "@playwright/test" || name === "playwright" || name.startsWith("@playwright/"))
    .sort();
  const scripts = Object.entries(packageJson?.scripts ?? {})
    .filter(([, command]) => /\bplaywright\b/i.test(command))
    .map(([name, command]) => `${name}: ${command}`)
    .sort();
  const configCandidates = [
    "playwright.config.ts",
    "playwright.config.mts",
    "playwright.config.cts",
    "playwright.config.js",
    "playwright.config.mjs",
    "playwright.config.cjs"
  ];
  const configFiles: string[] = [];
  for (const candidate of configCandidates) {
    if (await exists(path.join(repoRoot, candidate))) configFiles.push(candidate);
  }
  const evidenceCount = dependencies.length + scripts.length + configFiles.length;
  const status: SetupPlaywrightPresence["status"] = dependencies.length && (scripts.length || configFiles.length) ? "present" : evidenceCount > 0 ? "partial" : "missing";
  const notes = [
    dependencies.length ? `Dependencies detected: ${dependencies.join(", ")}` : "No Playwright dependency was detected.",
    scripts.length ? `Playwright scripts detected: ${scripts.map(scriptNameFromEntry).join(", ")}` : "No package script references Playwright.",
    configFiles.length ? `Config files detected: ${configFiles.join(", ")}` : "No Playwright config file was detected."
  ];
  return { status, dependencies, scripts, configFiles, notes };
}

function scriptNameFromEntry(entry: string): string {
  const separator = entry.indexOf(": ");
  return separator >= 0 ? entry.slice(0, separator) : entry;
}

function detectWorkflowTriggers(raw: string): string[] {
  const triggers = new Set<string>();
  const triggerNames = ["pull_request_target", "pull_request", "schedule", "workflow_dispatch", "push", "workflow_run"];
  for (const trigger of triggerNames) {
    if (new RegExp(`\\b${trigger}\\s*:`, "i").test(raw)) triggers.add(trigger);
  }
  return [...triggers];
}

function detectWorkflowPermissions(raw: string): string[] {
  const permissions = new Set<string>();
  const block = /permissions\s*:\s*\n((?:\s+[A-Za-z_-]+\s*:\s*[A-Za-z_-]+\s*\n?)+)/i.exec(raw)?.[1] ?? "";
  for (const line of block.split(/\r?\n/)) {
    const match = /^\s+([A-Za-z_-]+)\s*:\s*([A-Za-z_-]+)\s*$/.exec(line);
    if (match) permissions.add(`${match[1]}: ${match[2]}`);
  }
  return [...permissions].sort();
}

function isStoryFile(sourceFile: string): boolean {
  return /\.(stories|story)\.[cm]?[jt]sx?$|\.stories\.mdx$/i.test(sourceFile);
}

function storyExports(raw: string): string[] {
  const exports = new Set<string>();
  STORY_EXPORT_PATTERN.lastIndex = 0;
  for (const match of raw.matchAll(STORY_EXPORT_PATTERN)) {
    const name = match[1] ?? "";
    if (!name || NON_STORY_EXPORTS.has(name)) continue;
    exports.add(name);
  }
  return [...exports].sort();
}

function storyTitleFromPath(sourceFile: string): string {
  return normalizeSlashes(sourceFile)
    .replace(/^src\//, "")
    .replace(/\.(stories|story)\.[^.]+$/i, "")
    .replace(/\/index$/i, "")
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.replace(/[-_]/g, " "))
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join("/");
}

function storyRoute(title: string, exportName: string): string {
  const storyId = `${slugForStorybook(title)}--${slugForStorybook(exportName)}`;
  return `/iframe.html?id=${encodeURIComponent(storyId)}&viewMode=story`;
}

function storyContractSlug(story: SetupDetectedStory): string {
  const exportName = story.exports[0] ?? "default";
  return `${slugForStorybook(story.title)}-${slugForStorybook(exportName)}`.replace(/^-+|-+$/g, "");
}

function slugForStorybook(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function normalizeSlashes(value: string): string {
  return sanitizeText(value.replaceAll("\\", "/"));
}

export function catalogedSetupOutputResource(resourceId: string, artifactPath: string): SetupRecommendationOutputResource {
  return catalogedOutputResource(resourceId, artifactPath);
}

function catalogedOutputResource(resourceId: string, artifactPath: string): SetupRecommendationOutputResource {
  const resource = getEvidenceResourceById(resourceId);
  return {
    artifactPath,
    evidenceResourceId: resource?.id ?? resourceId,
    evidenceResourceUri: resource?.uri ?? `visual-hive://${resourceId}`,
    evidenceResourceTitle: resource?.title ?? resourceId,
    evidenceResourceDescription: resource?.description ?? "Visual Hive setup evidence artifact.",
    ...(resource?.readTool?.name ? { evidenceReadToolName: resource.readTool.name } : {})
  };
}
