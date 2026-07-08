import path from "node:path";
import { access, mkdir, writeFile } from "node:fs/promises";
import { loadConfig, readJson, writeJson, type VisualHiveIssuesReport } from "@visual-hive/core";
import { formatIssuesResult, runIssuesCommand } from "./issues.js";
import { formatPipelineSummary, runPipelineCommand, type PipelineCommandOptions, type PipelineCommandResult } from "./pipeline.js";

export interface LoopRunOptions extends PipelineCommandOptions {
  includeSeededSmoke?: boolean;
  format?: "markdown" | "json";
}

export interface LoopLifecycleOptions {
  config?: string;
  cwd?: string;
  format?: "markdown" | "json";
}

export interface LoopInitOptions {
  cwd?: string;
  profile?: "github-hive";
  force?: boolean;
}

export interface LoopLifecycleReport {
  schemaVersion: "visual-hive.loop-lifecycle.v1";
  generatedAt: string;
  project: string;
  status: "ready" | "no_issues";
  closeResolvedEnabled: boolean;
  externalCallsMade: 0;
  networkCallsMade: 0;
  realGithubIssuesCreated: 0;
  realGithubIssuesClosed: 0;
  summary: {
    active: number;
    updateCandidates: number;
    resolvedCandidates: number;
    suppressed: number;
  };
  policy: {
    activeFindingLabels: string[];
    resolvedCandidateLabels: string[];
    closeResolvedEnv: "VISUAL_HIVE_CLOSE_RESOLVED";
    defaultAutoClose: false;
  };
}

export async function runLoopRunCommand(options: LoopRunOptions = {}): Promise<PipelineCommandResult> {
  const result = await runPipelineCommand({
    ...options,
    mode: options.mode ?? "full",
    continueOnError: options.continueOnError ?? true
  });
  if (options.includeSeededSmoke) {
    const loaded = await loadConfig(options.config, options.cwd ?? process.cwd());
    await writeJson(path.join(loaded.rootDir, ".visual-hive", "loop-seeded-smoke-request.json"), {
      schemaVersion: "visual-hive.loop-seeded-smoke-request.v1",
      generatedAt: new Date().toISOString(),
      enabled: true,
      message: "Seeded smoke was explicitly requested. The default live loop excludes synthetic seeded findings."
    });
  }
  return result;
}

export async function runLoopDeriveIssuesCommand(options: { config?: string; cwd?: string; write?: boolean; format?: "markdown" | "json" } = {}) {
  return runIssuesCommand({ config: options.config, cwd: options.cwd, write: options.write ?? true, format: options.format });
}

export async function runLoopLifecycleCommand(options: LoopLifecycleOptions = {}): Promise<{ report: LoopLifecycleReport; reportPath: string }> {
  const loaded = await loadConfig(options.config, options.cwd ?? process.cwd());
  await runIssuesCommand({ config: options.config, cwd: options.cwd, write: true });
  const issues = await readJson<VisualHiveIssuesReport>(path.join(loaded.rootDir, ".visual-hive", "issues.json"));
  const active = issues.issues.filter((issue) => issue.status === "open_candidate" || issue.status === "update_candidate");
  const report: LoopLifecycleReport = {
    schemaVersion: "visual-hive.loop-lifecycle.v1",
    generatedAt: new Date().toISOString(),
    project: loaded.config.project.name,
    status: issues.issues.length ? "ready" : "no_issues",
    closeResolvedEnabled: process.env.VISUAL_HIVE_CLOSE_RESOLVED === "true",
    externalCallsMade: 0,
    networkCallsMade: 0,
    realGithubIssuesCreated: 0,
    realGithubIssuesClosed: 0,
    summary: {
      active: active.length,
      updateCandidates: issues.issues.filter((issue) => issue.status === "update_candidate").length,
      resolvedCandidates: issues.issues.filter((issue) => issue.status === "resolved_candidate").length,
      suppressed: issues.issues.filter((issue) => issue.status === "suppressed").length
    },
    policy: {
      activeFindingLabels: ["visual-hive/still-active", "visual-hive/ready-for-hive"],
      resolvedCandidateLabels: ["visual-hive/resolved-candidate"],
      closeResolvedEnv: "VISUAL_HIVE_CLOSE_RESOLVED",
      defaultAutoClose: false
    }
  };
  const reportPath = path.join(loaded.rootDir, ".visual-hive", "loop-lifecycle.json");
  await writeJson(reportPath, report);
  return { report, reportPath };
}

export async function runLoopInitCommand(options: LoopInitOptions = {}): Promise<string[]> {
  const cwd = options.cwd ?? process.cwd();
  if (options.profile && options.profile !== "github-hive") {
    throw new Error(`Unsupported loop init profile "${options.profile}". Expected github-hive.`);
  }
  const files: Array<{ path: string; content: string }> = [
    {
      path: "scripts/visual-hive-cli.mjs",
      content: visualHiveResolverTemplate()
    },
    {
      path: ".github/workflows/visual-hive-pr.yml",
      content: prWorkflowTemplate()
    },
    {
      path: ".github/workflows/visual-hive-live-detection.yml",
      content: liveWorkflowTemplate()
    },
    {
      path: ".github/workflows/visual-hive-trusted-publisher.yml",
      content: trustedPublisherWorkflowTemplate()
    },
    {
      path: ".github/workflows/visual-hive-lifecycle.yml",
      content: lifecycleWorkflowTemplate()
    },
    {
      path: ".github/workflows/visual-hive-seeded-smoke.yml",
      content: seededSmokeWorkflowTemplate()
    }
  ];
  const written: string[] = [];
  for (const file of files) {
    const target = path.join(cwd, file.path);
    if (!options.force) {
      try {
        await access(target);
        throw new Error(`Refusing to overwrite ${file.path}; pass --force to replace it.`);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("Refusing")) throw error;
      }
    }
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.content, "utf8");
    written.push(target);
  }
  return written;
}

export function formatLoopRunResult(result: PipelineCommandResult, format: "markdown" | "json" = "markdown"): string {
  return formatPipelineSummary(result, format);
}

export function formatLoopDeriveIssuesResult(result: Awaited<ReturnType<typeof runLoopDeriveIssuesCommand>>, format: "markdown" | "json" = "markdown"): string {
  return formatIssuesResult(result, format);
}

export function formatLoopLifecycleResult(result: { report: LoopLifecycleReport; reportPath: string }, format: "markdown" | "json" = "markdown"): string {
  if (format === "json") return JSON.stringify(result.report, null, 2);
  return [
    `Wrote ${result.reportPath}`,
    "",
    `# Visual Hive Loop Lifecycle: ${result.report.project}`,
    "",
    `- Status: ${result.report.status}`,
    `- Active findings: ${result.report.summary.active}`,
    `- Update candidates: ${result.report.summary.updateCandidates}`,
    `- Resolved candidates: ${result.report.summary.resolvedCandidates}`,
    `- Suppressed: ${result.report.summary.suppressed}`,
    `- Auto-close enabled: ${result.report.closeResolvedEnabled}`,
    "",
    "Visual Hive updates issue evidence and marks resolved candidates. It does not close issues unless trusted policy explicitly enables `VISUAL_HIVE_CLOSE_RESOLVED=true`."
  ].join("\n");
}

function visualHiveResolverTemplate(): string {
  return `#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
const candidates = [
  process.env.VISUAL_HIVE_CLI,
  path.resolve("..", "visual-hive", "packages", "cli", "dist", "index.js"),
  path.resolve("..", "vis-hive", "packages", "cli", "dist", "index.js"),
  path.resolve("node_modules", ".bin", process.platform === "win32" ? "visual-hive.cmd" : "visual-hive")
].filter(Boolean);
const cli = candidates.find((candidate) => existsSync(candidate));
if (!cli) {
  console.error("Visual Hive CLI was not found. Set VISUAL_HIVE_CLI, checkout DavidDiaz0317/visual-hive next to this repo, or install the visual-hive package when published.");
  process.exit(1);
}
if (process.argv.includes("--print-resolution")) {
  console.log(cli);
  process.exit(0);
}
const isNodeScript = cli.endsWith(".js");
const child = spawnSync(isNodeScript ? process.execPath : cli, isNodeScript ? [cli, ...process.argv.slice(2)] : process.argv.slice(2), { stdio: "inherit", env: process.env });
process.exit(child.status ?? 1);
`;
}

function prWorkflowTemplate(): string {
  return `name: Visual Hive PR
on: [pull_request]
permissions:
  contents: read
jobs:
  visual-hive:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npm run build --if-present
      - run: node scripts/visual-hive-cli.mjs loop run --mode pr --ci
      - if: always()
        uses: actions/upload-artifact@v4
        with:
          name: visual-hive-pr
          path: .visual-hive
          include-hidden-files: true
`;
}

function liveWorkflowTemplate(): string {
  return `name: Visual Hive Live Detection
on:
  workflow_dispatch:
  schedule:
    - cron: "17 */6 * * *"
permissions:
  contents: read
jobs:
  live-detection:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: node scripts/visual-hive-cli.mjs loop run --mode full --bootstrap-baselines --ci
      - run: node scripts/visual-hive-cli.mjs loop derive-issues
      - if: always()
        uses: actions/upload-artifact@v4
        with:
          name: visual-hive-live-detection
          path: .visual-hive
          include-hidden-files: true
`;
}

function trustedPublisherWorkflowTemplate(): string {
  return `name: Visual Hive Trusted Publisher
on:
  workflow_run:
    workflows: [Visual Hive Live Detection]
    types: [completed]
permissions:
  actions: read
  contents: read
  issues: write
jobs:
  publish:
    if: github.event.workflow_run.event != 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - run: echo "Download sanitized artifacts and publish/update Visual Hive issues from issues.json. Do not checkout or execute PR code."
`;
}

function lifecycleWorkflowTemplate(): string {
  return `name: Visual Hive Lifecycle
on:
  workflow_dispatch:
permissions:
  contents: read
  issues: write
jobs:
  lifecycle:
    runs-on: ubuntu-latest
    steps:
      - run: echo "Run visual-hive loop lifecycle from trusted artifacts; close only when VISUAL_HIVE_CLOSE_RESOLVED=true."
`;
}

function seededSmokeWorkflowTemplate(): string {
  return `name: Visual Hive Seeded Smoke
on:
  workflow_dispatch:
permissions:
  contents: read
jobs:
  seeded-smoke:
    runs-on: ubuntu-latest
    steps:
      - run: echo "Optional synthetic seeded smoke only. Label generated issues visual-hive/smoke and keep this separate from live detection."
`;
}
