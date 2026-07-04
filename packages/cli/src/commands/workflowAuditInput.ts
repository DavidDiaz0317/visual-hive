import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { WorkflowAuditInputFile } from "@visual-hive/core";

export interface WorkflowRootResolution {
  workflowDir: string;
  workflowRoot: string;
  source: "absolute" | "config_root" | "cwd";
  exists: boolean;
  checked: string[];
}

export async function resolveWorkflowRoot(options: {
  configRoot: string;
  cwd: string;
  workflowDir?: string;
}): Promise<WorkflowRootResolution> {
  const workflowDir = options.workflowDir ?? path.join(".github", "workflows");
  if (path.isAbsolute(workflowDir)) {
    return {
      workflowDir,
      workflowRoot: workflowDir,
      source: "absolute",
      exists: await pathExists(workflowDir),
      checked: [workflowDir]
    };
  }

  const configRootCandidate = path.resolve(options.configRoot, workflowDir);
  const cwdCandidate = path.resolve(options.cwd, workflowDir);
  const checked = configRootCandidate === cwdCandidate ? [configRootCandidate] : [configRootCandidate, cwdCandidate];

  if (await pathExists(configRootCandidate)) {
    return {
      workflowDir,
      workflowRoot: configRootCandidate,
      source: "config_root",
      exists: true,
      checked
    };
  }

  if (cwdCandidate !== configRootCandidate && (await pathExists(cwdCandidate))) {
    return {
      workflowDir,
      workflowRoot: cwdCandidate,
      source: "cwd",
      exists: true,
      checked
    };
  }

  return {
    workflowDir,
    workflowRoot: configRootCandidate,
    source: "config_root",
    exists: false,
    checked
  };
}

export async function readWorkflowFiles(workflowRoot: string): Promise<WorkflowAuditInputFile[]> {
  let entries: string[];
  try {
    entries = await readdir(workflowRoot);
  } catch {
    return [];
  }
  const workflowFiles = entries.filter((entry) => entry.endsWith(".yml") || entry.endsWith(".yaml")).sort();
  return Promise.all(
    workflowFiles.map(async (entry) => {
      const filePath = path.join(workflowRoot, entry);
      return {
        path: filePath,
        content: await readFile(filePath, "utf8")
      };
    })
  );
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
