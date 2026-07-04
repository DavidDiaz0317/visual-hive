import path from "node:path";
import { createControlPlaneSnapshot, type ControlPlaneSnapshot } from "@visual-hive/control-plane";
import { sanitizeText, writeJson } from "@visual-hive/core";

export interface SnapshotCommandOptions {
  cwd?: string;
  repo?: string;
  config?: string;
  output?: string;
  readOnly?: boolean;
  format?: "markdown" | "json";
}

export interface SnapshotCommandResult {
  snapshot: ControlPlaneSnapshot;
  snapshotPath: string;
}

const DEFAULT_SNAPSHOT_PATH = ".visual-hive/control-plane-snapshot.json";

export async function runSnapshotCommand(options: SnapshotCommandOptions = {}): Promise<SnapshotCommandResult> {
  const cwd = options.cwd ?? process.cwd();
  const repo = path.resolve(cwd, options.repo ?? ".");
  const config = path.resolve(cwd, options.config ?? path.join(repo, "visual-hive.config.yaml"));
  const snapshot = sanitizeSnapshot(
    await createControlPlaneSnapshot({
      repo,
      config,
      readOnly: options.readOnly ?? true,
      cliPath: process.argv[1]?.endsWith(".js") ? process.argv[1] : undefined
    })
  );
  const snapshotPath = resolveSnapshotOutput(snapshot.configRoot, options.output ?? DEFAULT_SNAPSHOT_PATH);
  await writeJson(snapshotPath, snapshot);
  return { snapshot, snapshotPath };
}

export function formatSnapshotResult(result: SnapshotCommandResult, format: "markdown" | "json" = "markdown"): string {
  if (format === "json") return JSON.stringify(result.snapshot, null, 2);
  return [
    `Wrote ${result.snapshotPath}`,
    "# Visual Hive Control Plane Snapshot",
    "",
    `- Project: ${result.snapshot.config?.project.name ?? result.snapshot.report?.project ?? "unknown"}`,
    `- Repo: ${result.snapshot.repoRoot}`,
    `- Config: ${result.snapshot.configPath}`,
    `- Guidance state: ${result.snapshot.guidanceState.state}`,
    `- Primary action: ${result.snapshot.guidanceState.primaryAction.label}`,
    `- Adoption checklist items: ${result.snapshot.guidanceState.adoptionChecklist.length}`,
    `- Runbook commands: ${result.snapshot.runbook.commands.length}`,
    `- Run profiles: ${result.snapshot.runProfiles.length}`,
    `- Artifacts listed: ${result.snapshot.artifacts.length}`,
    "",
    "Schema: schemas/visual-hive.control-plane-snapshot.schema.json"
  ].join("\n");
}

function resolveSnapshotOutput(configRoot: string, output: string): string {
  const resolved = path.isAbsolute(output) ? path.resolve(output) : path.resolve(configRoot, output);
  if (!isInsideOrEqual(path.resolve(configRoot), resolved)) {
    throw new Error(`Refusing to write Control Plane snapshot outside config root: ${sanitizeText(output)}`);
  }
  return resolved;
}

function sanitizeSnapshot(snapshot: ControlPlaneSnapshot): ControlPlaneSnapshot {
  return JSON.parse(sanitizeText(JSON.stringify(snapshot))) as ControlPlaneSnapshot;
}

function isInsideOrEqual(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
