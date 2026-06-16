import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { githubWorkflowTemplates, sanitizeText } from "@visual-hive/core";
import { writeRecommendedConfigFromSetup, writeRecommendedDocsFromSetup, type RecommendedConfigWriteResult, type RecommendedDocsWriteResult } from "./configEditor.js";
import { resolveControlPlaneOptions } from "./repoReader.js";
import { isInsidePath, toRepoRelativePath } from "./safePath.js";
import type { ControlPlaneOptions } from "./types.js";
import { writeWorkflowTemplates, type WorkflowTemplateWriteResult } from "./workflowWriter.js";

export interface SetupBundleWriteResult {
  ok: true;
  auditPath: string;
  overwritten: boolean;
  config: RecommendedConfigWriteResult;
  docs: RecommendedDocsWriteResult;
  workflows: WorkflowTemplateWriteResult;
}

export async function writeSetupBundleFromRecommendation(
  options: ControlPlaneOptions,
  input: { confirm: boolean; force?: boolean }
): Promise<SetupBundleWriteResult> {
  const resolved = resolveControlPlaneOptions(options);
  if (resolved.readOnly) {
    throw new Error("Control Plane is read-only. Restart without --read-only to generate a setup bundle.");
  }
  if (!input.confirm) {
    throw new Error("Setup bundle generation requires explicit confirmation after reviewing the recommendation and workflow snippets.");
  }
  const force = input.force === true;
  const outputs = setupBundleOutputPaths(resolved.repoRoot, resolved.configPath);
  const existing = await existingOutputPaths(outputs);
  if (existing.length && !force) {
    throw new Error(
      `Refusing to write setup bundle because files already exist: ${existing
        .map((filePath) => toRepoRelativePath(resolved.repoRoot, filePath))
        .join(", ")}. Set force=true after reviewing the generated setup bundle.`
    );
  }

  const config = await writeRecommendedConfigFromSetup(options, true, force);
  const docs = await writeRecommendedDocsFromSetup(options, true, force);
  const workflows = await writeWorkflowTemplates(options, { confirm: true, force });
  const auditPath = path.join(resolved.configRoot, ".visual-hive", "setup-bundle-edits.json");
  await appendSetupBundleAudit(auditPath, {
    source: "setup-recommendation",
    editedAt: new Date().toISOString(),
    force,
    configPath: config.configPath,
    docsPath: docs.docsPath,
    workflowPaths: workflows.written.map((entry) => entry.path),
    auditPaths: [config.auditPath, docs.auditPath, workflows.auditPath]
  });
  return {
    ok: true,
    auditPath: toRepoRelativePath(resolved.repoRoot, auditPath),
    overwritten: existing.length > 0,
    config,
    docs,
    workflows
  };
}

function setupBundleOutputPaths(repoRoot: string, configPath: string): string[] {
  const paths = [
    configPath,
    path.join(repoRoot, "docs", "visual-hive.md"),
    ...githubWorkflowTemplates.map((template) => path.join(repoRoot, template.path))
  ];
  for (const filePath of paths) {
    if (!isInsidePath(repoRoot, filePath)) {
      throw new Error(`Refusing to write setup bundle output outside repository root: ${sanitizeText(filePath)}`);
    }
  }
  return paths;
}

async function existingOutputPaths(paths: string[]): Promise<string[]> {
  const existing: string[] = [];
  for (const filePath of paths) {
    try {
      await access(filePath);
      existing.push(filePath);
    } catch {
      // Missing files are safe to create.
    }
  }
  return existing;
}

async function appendSetupBundleAudit(
  auditPath: string,
  entry: {
    source: "setup-recommendation";
    editedAt: string;
    force: boolean;
    configPath: string;
    docsPath: string;
    workflowPaths: string[];
    auditPaths: string[];
  }
): Promise<void> {
  let previous: { schemaVersion: 1; edits: Array<typeof entry> } = { schemaVersion: 1, edits: [] };
  try {
    previous = JSON.parse(await readFile(auditPath, "utf8")) as typeof previous;
    if (!Array.isArray(previous.edits)) previous.edits = [];
  } catch {
    previous = { schemaVersion: 1, edits: [] };
  }
  previous.edits.push(entry);
  await mkdir(path.dirname(auditPath), { recursive: true });
  await writeFile(auditPath, `${JSON.stringify(previous, null, 2)}\n`, "utf8");
}
