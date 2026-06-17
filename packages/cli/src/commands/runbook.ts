import path from "node:path";
import {
  createControlPlaneSnapshot,
  executeRunbookCommand,
  executeRunbookProfile,
  resolveControlPlaneOptions,
  type ControlPlaneCommandExecution,
  type ControlPlaneCommandRunner,
  type ControlPlaneProfileExecution,
  type ControlPlaneRunProfile,
  type ControlPlaneRunbook,
  type ControlPlaneRunbookCommand
} from "@visual-hive/control-plane";
import { sanitizeText, writeJson } from "@visual-hive/core";

export interface RunbookCommandOptions {
  cwd?: string;
  repo?: string;
  config?: string;
  format?: "markdown" | "json";
  executeCommand?: string;
  executeProfile?: string;
  readOnly?: boolean;
  commandRunner?: ControlPlaneCommandRunner;
}

export interface RunbookReport {
  schemaVersion: 1;
  generatedAt: string;
  repoRoot: string;
  configPath: string;
  runbook: ControlPlaneRunbook;
  profiles: ControlPlaneRunProfile[];
  execution?: ControlPlaneCommandExecution | ControlPlaneProfileExecution;
}

export async function runRunbookCommand(options: RunbookCommandOptions = {}): Promise<{ report: RunbookReport; reportPath: string }> {
  const cwd = options.cwd ?? process.cwd();
  const repo = path.resolve(cwd, options.repo ?? ".");
  const config = path.resolve(cwd, options.config ?? path.join(repo, "visual-hive.config.yaml"));
  const cliPath = process.argv[1]?.endsWith(".js") ? process.argv[1] : undefined;
  const controlPlaneOptions = {
    repo,
    config,
    readOnly: options.readOnly,
    cliPath,
    commandRunner: options.commandRunner
  };
  const snapshot = await createControlPlaneSnapshot(controlPlaneOptions);
  const resolved = resolveControlPlaneOptions(controlPlaneOptions);
  let execution: RunbookReport["execution"];

  if (options.executeCommand && options.executeProfile) {
    throw new Error("Choose either --execute-command or --execute-profile, not both.");
  }
  if (options.executeCommand) {
    const command = findCommand(snapshot.runbook.commands, options.executeCommand);
    execution = await executeRunbookCommand({
      options: controlPlaneOptions,
      resolved,
      command
    });
  }
  if (options.executeProfile) {
    const profile = findProfile(snapshot.runProfiles, options.executeProfile);
    execution = await executeRunbookProfile({
      options: controlPlaneOptions,
      resolved,
      profile,
      commands: snapshot.runbook.commands
    });
  }

  const report: RunbookReport = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    repoRoot: sanitizeText(snapshot.repoRoot),
    configPath: sanitizeText(snapshot.configPath),
    runbook: snapshot.runbook,
    profiles: snapshot.runProfiles,
    execution
  };
  const reportPath = path.join(snapshot.configRoot, ".visual-hive", "runbook.json");
  await writeJson(reportPath, report);
  return { report, reportPath };
}

export function formatRunbookReport(input: { report: RunbookReport; reportPath: string }, format: "markdown" | "json" = "markdown"): string {
  if (format === "json") return JSON.stringify(input.report, null, 2);
  const { report, reportPath } = input;
  const lines = [
    `Wrote ${reportPath}`,
    `# Visual Hive Runbook`,
    "",
    `- Config: ${report.runbook.configPath}`,
    `- Commands: ${report.runbook.commands.length}`,
    `- Profiles: ${report.profiles.length}`,
    `- Executable profiles: ${report.profiles.filter((profile) => profile.enabled).length}`,
    "",
    "## Profiles"
  ];
  for (const profile of report.profiles) {
    lines.push(
      `- ${profile.id}: ${profile.label} [${profile.enabled ? "enabled" : "blocked"}; ${profile.safety}]`,
      `  ${profile.description}`,
      `  Commands: ${profile.commandIds.join(", ")}`
    );
    if (profile.blockedReasons.length) {
      lines.push(`  Blocked: ${profile.blockedReasons.join(" ")}`);
    }
  }
  lines.push("", "## Commands");
  for (const command of report.runbook.commands) {
    lines.push(
      `- ${command.id}: ${command.label} [${command.safety}; ${command.lane}]`,
      `  ${command.description}`,
      `  Command: \`${command.command}\``
    );
    if (command.requiredSecrets.length) {
      lines.push(`  Required secret names: ${command.requiredSecrets.join(", ")}`);
    }
  }
  if (report.execution) {
    lines.push("", "## Execution", `- Status: ${report.execution.status}`, `- Message: ${report.execution.message}`);
    if ("commandExecutions" in report.execution) {
      lines.push(`- Commands executed: ${report.execution.commandExecutions.length}`);
    } else {
      lines.push(`- Steps executed: ${report.execution.steps.length}`);
    }
  }
  if (report.runbook.notes.length) {
    lines.push("", "## Notes", ...report.runbook.notes.map((note) => `- ${note}`));
  }
  return lines.join("\n");
}

function findCommand(commands: ControlPlaneRunbookCommand[], commandId: string): ControlPlaneRunbookCommand {
  const command = commands.find((candidate) => candidate.id === commandId);
  if (!command) {
    throw new Error(`Unknown runbook command "${sanitizeText(commandId)}". Run "visual-hive runbook" to list available commands.`);
  }
  return command;
}

function findProfile(profiles: ControlPlaneRunProfile[], profileId: string): ControlPlaneRunProfile {
  const profile = profiles.find((candidate) => candidate.id === profileId);
  if (!profile) {
    throw new Error(`Unknown run profile "${sanitizeText(profileId)}". Run "visual-hive runbook" to list available profiles.`);
  }
  return profile;
}
