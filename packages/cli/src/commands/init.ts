import { constants } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { defaultConfigTemplate, failureIssueWorkflowTemplate, prWorkflowTemplate, scheduledWorkflowTemplate } from "./templates.js";

export interface InitOptions {
  cwd?: string;
  force?: boolean;
}

export async function runInit(options: InitOptions = {}): Promise<string[]> {
  const cwd = options.cwd ?? process.cwd();
  const force = options.force ?? false;
  const writes = [
    { path: path.join(cwd, "visual-hive.config.yaml"), content: defaultConfigTemplate },
    { path: path.join(cwd, ".github", "workflows", "visual-hive-pr.yml"), content: prWorkflowTemplate },
    { path: path.join(cwd, ".github", "workflows", "visual-hive-scheduled.yml"), content: scheduledWorkflowTemplate },
    { path: path.join(cwd, ".github", "workflows", "visual-hive-failure-issue.yml"), content: failureIssueWorkflowTemplate }
  ];

  const created: string[] = [];
  for (const write of writes) {
    if (!force && (await exists(write.path))) {
      throw new Error(`${write.path} already exists. Re-run with --force to overwrite it.`);
    }
  }

  await mkdir(path.join(cwd, ".visual-hive", "generated"), { recursive: true });
  created.push(path.join(cwd, ".visual-hive", "generated"));
  for (const write of writes) {
    await mkdir(path.dirname(write.path), { recursive: true });
    await writeFile(write.path, write.content, "utf8");
    created.push(write.path);
  }
  return created;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
