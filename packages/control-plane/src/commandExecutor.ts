import { spawn } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { sanitizeText } from "@visual-hive/core";
import type {
  ControlPlaneCommandExecution,
  ControlPlaneCommandRunner,
  ControlPlaneCommandRunnerInput,
  ControlPlaneCommandRunnerResult,
  ControlPlaneCommandStepResult,
  ControlPlaneOptions,
  ControlPlaneRunbookCommand,
  ResolvedControlPlaneOptions
} from "./types.js";

const EXECUTABLE_COMMAND_IDS = new Set(["doctor", "plan-pr", "run-ci", "triage-report", "mutate"]);
const OUTPUT_TAIL_CHARS = 12_000;
const MAX_OUTPUT_BYTES = 2_000_000;

interface CommandStep {
  stepId: string;
  args: string[];
}

interface ExecuteCommandInput {
  options: ControlPlaneOptions;
  resolved: ResolvedControlPlaneOptions;
  command: ControlPlaneRunbookCommand;
}

export async function executeRunbookCommand(input: ExecuteCommandInput): Promise<ControlPlaneCommandExecution> {
  const startedAt = new Date();
  const blocked = blockReason(input.resolved, input.command);
  if (blocked) {
    const execution = executionResult(input, startedAt, "blocked", blocked, []);
    await appendExecution(input.resolved, execution);
    return execution;
  }

  const runner = input.options.commandRunner ?? defaultCommandRunner(input.options);
  const steps = commandSteps(input.command.id, input.resolved.configPath);
  const stepResults: ControlPlaneCommandStepResult[] = [];
  let status: ControlPlaneCommandExecution["status"] = "passed";
  let message = "Command completed successfully.";

  for (const step of steps) {
    const stepStarted = Date.now();
    const runInput: ControlPlaneCommandRunnerInput = {
      commandId: input.command.id,
      stepId: step.stepId,
      command: cliCommand(input.options),
      args: cliArgs(input.options, step.args),
      cwd: input.resolved.repoRoot,
      env: {
        ...process.env,
        VISUAL_HIVE_CONTROL_PLANE: "true"
      }
    };
    const result = await runner(runInput);
    const stepResult = sanitizeStepResult(runInput, result, Date.now() - stepStarted);
    stepResults.push(stepResult);
    if (result.exitCode !== 0) {
      status = "failed";
      message = `${step.stepId} failed with exit code ${result.exitCode}.`;
      break;
    }
  }

  const execution = executionResult(input, startedAt, status, message, stepResults);
  await appendExecution(input.resolved, execution);
  return execution;
}

function blockReason(resolved: ResolvedControlPlaneOptions, command: ControlPlaneRunbookCommand): string | undefined {
  if (resolved.readOnly) {
    return "Control Plane is read-only. Restart without --read-only before executing local runbook commands.";
  }
  if (!EXECUTABLE_COMMAND_IDS.has(command.id)) {
    return `Runbook command "${command.id}" is guidance-only and cannot be executed from the Control Plane.`;
  }
  if (command.safety === "trusted_only") {
    return "Trusted-only commands require a scheduled/manual protected workflow and cannot be launched from the local Control Plane.";
  }
  if (command.requiredSecrets.length > 0) {
    return `Command requires protected environment variable names: ${command.requiredSecrets.join(", ")}. Secret-bearing lanes must run from trusted automation.`;
  }
  return undefined;
}

function commandSteps(commandId: string, configPath: string): CommandStep[] {
  switch (commandId) {
    case "doctor":
      return [{ stepId: "doctor", args: ["doctor", "--config", configPath] }];
    case "plan-pr":
      return [{ stepId: "plan-pr", args: ["plan", "--config", configPath, "--mode", "pr", "--base", "origin/main", "--ci"] }];
    case "run-ci":
      return [{ stepId: "run-ci", args: ["run", "--config", configPath, "--ci"] }];
    case "triage-report":
      return [
        { stepId: "triage", args: ["triage", "--config", configPath] },
        { stepId: "report", args: ["report", "--config", configPath] }
      ];
    case "mutate":
      return [{ stepId: "mutate", args: ["mutate", "--config", configPath] }];
    default:
      return [];
  }
}

function defaultCommandRunner(options: ControlPlaneOptions): ControlPlaneCommandRunner {
  return async (input) =>
    new Promise<ControlPlaneCommandRunnerResult>((resolve) => {
      const child = spawn(input.command, input.args, {
        cwd: input.cwd,
        env: input.env,
        windowsHide: true,
        shell: shouldUseShell(options)
      });
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (chunk: Buffer) => {
        stdout = appendBounded(stdout, chunk.toString("utf8"));
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr = appendBounded(stderr, chunk.toString("utf8"));
      });
      child.once("error", (error) => {
        resolve({ exitCode: 1, stdout, stderr: appendBounded(stderr, error.message) });
      });
      child.once("close", (code) => {
        resolve({ exitCode: code ?? 1, stdout, stderr });
      });
    });
}

function cliCommand(options: ControlPlaneOptions): string {
  if (options.cliPath) return process.execPath;
  const currentEntry = process.argv[1];
  if (currentEntry && currentEntry.endsWith(".js")) return process.execPath;
  return "visual-hive";
}

function cliArgs(options: ControlPlaneOptions, commandArgs: string[]): string[] {
  if (options.cliPath) return [path.resolve(options.cliPath), ...commandArgs];
  const currentEntry = process.argv[1];
  if (currentEntry && currentEntry.endsWith(".js")) return [currentEntry, ...commandArgs];
  return commandArgs;
}

function shouldUseShell(options: ControlPlaneOptions): boolean {
  if (options.cliPath) return false;
  const currentEntry = process.argv[1];
  return !(currentEntry && currentEntry.endsWith(".js")) && process.platform === "win32";
}

function sanitizeStepResult(
  input: ControlPlaneCommandRunnerInput,
  result: ControlPlaneCommandRunnerResult,
  durationMs: number
): ControlPlaneCommandStepResult {
  return {
    stepId: input.stepId,
    command: sanitizeText(input.command),
    args: input.args.map((arg) => sanitizeText(arg)),
    exitCode: result.exitCode,
    stdout: tail(sanitizeText(result.stdout)),
    stderr: tail(sanitizeText(result.stderr)),
    durationMs
  };
}

function executionResult(
  input: ExecuteCommandInput,
  startedAt: Date,
  status: ControlPlaneCommandExecution["status"],
  message: string,
  steps: ControlPlaneCommandStepResult[]
): ControlPlaneCommandExecution {
  const completedAt = new Date();
  return {
    schemaVersion: 1,
    commandId: input.command.id,
    label: input.command.label,
    status,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    cwd: input.resolved.repoRoot,
    safety: input.command.safety,
    readOnly: input.resolved.readOnly,
    message: sanitizeText(message),
    steps,
    expectedArtifacts: input.command.expectedArtifacts
  };
}

async function appendExecution(resolved: ResolvedControlPlaneOptions, execution: ControlPlaneCommandExecution): Promise<void> {
  const hiveRoot = path.join(resolved.configRoot, ".visual-hive");
  await mkdir(hiveRoot, { recursive: true });
  const actionPath = path.join(hiveRoot, "control-plane-actions.json");
  const previous = await readExecutions(actionPath);
  previous.push(execution);
  await writeFile(
    actionPath,
    JSON.stringify(
      {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        actions: previous.slice(-50)
      },
      null,
      2
    ),
    "utf8"
  );
}

async function readExecutions(actionPath: string): Promise<ControlPlaneCommandExecution[]> {
  try {
    await access(actionPath);
    const parsed = JSON.parse(await readFile(actionPath, "utf8")) as { actions?: ControlPlaneCommandExecution[] };
    return Array.isArray(parsed.actions) ? parsed.actions : [];
  } catch {
    return [];
  }
}

function appendBounded(current: string, next: string): string {
  const joined = current + next;
  if (Buffer.byteLength(joined, "utf8") <= MAX_OUTPUT_BYTES) return joined;
  return joined.slice(-MAX_OUTPUT_BYTES);
}

function tail(value: string): string {
  return value.length > OUTPUT_TAIL_CHARS ? value.slice(-OUTPUT_TAIL_CHARS) : value;
}
