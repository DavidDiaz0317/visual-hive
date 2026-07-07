import path from "node:path";
import { access, readdir, readFile } from "node:fs/promises";
import { readJson, writeJson } from "../utils/files.js";
import { sanitizeArtifactPathForIssue, sanitizeText } from "../utils/sanitize.js";
import type { AgentIssueRun } from "./issueRunner.js";

export interface ValidateAgentArtifactsOptions {
  rootDir: string;
  agentsDir?: string;
  dedupeFingerprint?: string;
  allowWriteArtifacts?: boolean;
  outputPath?: string;
  now?: Date;
}

export interface AgentArtifactValidationItem {
  dedupeFingerprint: string;
  profile: string;
  mode: string;
  status: "passed" | "failed";
  requestPath: string;
  outputPath: string;
  runPath: string;
  checks: Array<{
    id: string;
    status: "passed" | "failed";
    message: string;
  }>;
}

export interface AgentArtifactsValidationReport {
  schemaVersion: "visual-hive.agent-artifacts-validation.v1";
  generatedAt: string;
  rootDir: string;
  agentsDir: string;
  status: "passed" | "failed";
  summary: {
    agentRuns: number;
    passed: number;
    failed: number;
    forbiddenActionFailures: number;
  };
  items: AgentArtifactValidationItem[];
}

const FORBIDDEN_SAFETY_COUNTERS = [
  "sourceMutations",
  "branchesCreated",
  "pullRequestsOpened",
  "externalCallsMade",
  "networkCallsMade",
  "realGithubIssuesCreated",
  "realGithubIssuesUpdated",
  "hiveApiCallsMade",
  "llmCallsMade",
  "paidProviderCallsMade"
] as const;

export async function validateAgentArtifacts(options: ValidateAgentArtifactsOptions): Promise<{ report: AgentArtifactsValidationReport; outputPath?: string }> {
  const rootDir = path.resolve(options.rootDir);
  const agentsDir = resolve(rootDir, options.agentsDir ?? ".visual-hive/agents");
  const entries = await readdir(agentsDir, { withFileTypes: true }).catch(() => []);
  const runDirs = entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(agentsDir, entry.name));
  const items: AgentArtifactValidationItem[] = [];

  for (const runDir of runDirs) {
    const runPath = path.join(runDir, "agent-run.json");
    if (!(await exists(runPath))) continue;
    const run = await readJson<AgentIssueRun>(runPath);
    if (options.dedupeFingerprint && run.selectedIssue.dedupeFingerprint !== options.dedupeFingerprint) continue;
    items.push(await validateOneRun(rootDir, runDir, runPath, run, Boolean(options.allowWriteArtifacts)));
  }

  if (options.dedupeFingerprint && items.length === 0) {
    items.push({
      dedupeFingerprint: sanitizeText(options.dedupeFingerprint),
      profile: "unknown",
      mode: "unknown",
      status: "failed",
      requestPath: "",
      outputPath: "",
      runPath: "",
      checks: [{
        id: "dedupe_found",
        status: "failed",
        message: `No agent-run.json matched dedupe fingerprint ${sanitizeText(options.dedupeFingerprint)}.`
      }]
    });
  }

  if (items.length === 0) {
    items.push({
      dedupeFingerprint: "none",
      profile: "none",
      mode: "none",
      status: "failed",
      requestPath: "",
      outputPath: "",
      runPath: "",
      checks: [{
        id: "agent_runs_found",
        status: "failed",
        message: "No agent-run.json artifacts found. Run visual-hive agent issue-runner first."
      }]
    });
  }

  const failed = items.filter((item) => item.status === "failed").length;
  const forbiddenActionFailures = items.reduce(
    (count, item) => count + item.checks.filter((check) => check.id.startsWith("forbidden_") && check.status === "failed").length,
    0
  );
  const report: AgentArtifactsValidationReport = {
    schemaVersion: "visual-hive.agent-artifacts-validation.v1",
    generatedAt: (options.now ?? new Date()).toISOString(),
    rootDir: ".",
    agentsDir: displayPath(rootDir, agentsDir),
    status: failed === 0 ? "passed" : "failed",
    summary: {
      agentRuns: items.length,
      passed: items.length - failed,
      failed,
      forbiddenActionFailures
    },
    items
  };

  if (options.outputPath) {
    const outputPath = resolve(rootDir, options.outputPath);
    await writeJson(outputPath, report);
    return { report, outputPath };
  }
  return { report };
}

async function validateOneRun(rootDir: string, runDir: string, runPath: string, run: AgentIssueRun, allowWriteArtifacts: boolean): Promise<AgentArtifactValidationItem> {
  const requestPath = resolveArtifactPath(rootDir, runDir, run.artifactPaths?.request, "agent-request.md");
  const outputPath = resolveArtifactPath(rootDir, runDir, run.artifactPaths?.output, "agent-output.md");
  const checks: AgentArtifactValidationItem["checks"] = [];

  checks.push(await fileCheck("request_exists", requestPath, "agent-request.md exists and is readable."));
  checks.push(await fileCheck("output_exists", outputPath, "agent-output.md exists and is readable."));
  checks.push(await fileCheck("run_exists", runPath, "agent-run.json exists and is readable."));
  checks.push(valueCheck("schema", run.schemaVersion === "visual-hive.agent-issue-run.v1", "agent-run.json uses the expected schema."));
  checks.push(valueCheck("budget_recorded", Boolean(run.budgets) && typeof run.budgets.maxRuntimeMs === "number" && typeof run.budgets.allowWrite === "boolean", "Agent budgets are recorded."));
  checks.push(valueCheck("validation_command", Boolean(run.parsedIssue?.validationCommand), "Validation command is present."));
  checks.push(valueCheck("selected_issue", Boolean(run.selectedIssue?.dedupeFingerprint && run.selectedIssue.title), "Selected issue metadata is present."));
  checks.push(valueCheck("agent_execution_recorded", Boolean(run.agentExecution?.status), "Agent execution status is recorded."));

  if (!allowWriteArtifacts) {
    for (const key of FORBIDDEN_SAFETY_COUNTERS) {
      const value = Number(run.safety?.[key] ?? 0);
      checks.push(valueCheck(`forbidden_${key}`, value === 0, `Safety counter ${key} is 0 in default/no-write validation.`));
    }
    checks.push(valueCheck("budget_allow_write_false", run.budgets?.allowWrite === false, "Default agent artifact budget disallows writes."));
    checks.push(valueCheck("budget_allow_external_network_false", run.budgets?.allowExternalNetwork === false, "Default agent artifact budget disallows external network."));
  }

  const requestText = await readFile(requestPath, "utf8").catch(() => "");
  const outputText = await readFile(outputPath, "utf8").catch(() => "");
  checks.push(valueCheck("request_guardrails", /Forbidden Actions|Do not decide Visual Hive pass\/fail|Do not approve baselines/i.test(requestText), "Agent request includes safety guardrails."));
  checks.push(valueCheck("output_safety", /Safety Counters|Source mutations|Real GitHub issues created/i.test(outputText), "Agent output includes safety counters."));

  const status = checks.every((check) => check.status === "passed") ? "passed" : "failed";
  return {
    dedupeFingerprint: run.selectedIssue?.dedupeFingerprint ?? "unknown",
    profile: run.profile,
    mode: run.mode,
    status,
    requestPath: displayPath(rootDir, requestPath),
    outputPath: displayPath(rootDir, outputPath),
    runPath: displayPath(rootDir, runPath),
    checks
  };
}

async function fileCheck(id: string, filePath: string, message: string): Promise<AgentArtifactValidationItem["checks"][number]> {
  try {
    await access(filePath);
    const text = await readFile(filePath, "utf8");
    return valueCheck(id, text.trim().length > 0, message);
  } catch {
    return valueCheck(id, false, message);
  }
}

function valueCheck(id: string, passed: boolean, message: string): AgentArtifactValidationItem["checks"][number] {
  return { id, status: passed ? "passed" : "failed", message };
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function resolveArtifactPath(rootDir: string, runDir: string, artifactPath: string | undefined, fallbackName: string): string {
  if (!artifactPath) return path.join(runDir, fallbackName);
  return path.isAbsolute(artifactPath) ? artifactPath : path.resolve(rootDir, artifactPath);
}

function resolve(rootDir: string, artifactPath: string): string {
  return path.isAbsolute(artifactPath) ? artifactPath : path.resolve(rootDir, artifactPath);
}

function displayPath(rootDir: string, filePath: string): string {
  const relativePath = path.relative(rootDir, filePath).replaceAll(path.sep, "/");
  if (!relativePath.startsWith("../") && relativePath !== ".." && !path.isAbsolute(relativePath)) {
    return relativePath || ".";
  }
  return sanitizeArtifactPathForIssue(rootDir, filePath);
}
