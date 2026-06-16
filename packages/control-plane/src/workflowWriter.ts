import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { githubWorkflowTemplates, sanitizeText, type GitHubWorkflowTemplate } from "@visual-hive/core";
import { isInsidePath, normalizeRepoRelativePath, toRepoRelativePath } from "./safePath.js";
import type { ControlPlaneOptions } from "./types.js";
import { resolveControlPlaneOptions } from "./repoReader.js";

export interface WorkflowTemplateWriteResult {
  ok: true;
  auditPath: string;
  written: WorkflowTemplateWriteEntry[];
  skipped: WorkflowTemplateWriteEntry[];
}

export interface WorkflowTemplateWriteEntry {
  id: GitHubWorkflowTemplate["id"];
  path: string;
  overwritten: boolean;
  bytes: number;
}

export async function writeWorkflowTemplates(
  options: ControlPlaneOptions,
  input: { confirm: boolean; force?: boolean; templateIds?: string[] }
): Promise<WorkflowTemplateWriteResult> {
  const resolved = resolveControlPlaneOptions(options);
  if (resolved.readOnly) {
    throw new Error("Control Plane is read-only. Restart without --read-only to write workflow templates.");
  }
  if (!input.confirm) {
    throw new Error("Workflow template writes require explicit confirmation after reviewing the templates.");
  }
  const selectedTemplates = selectTemplates(input.templateIds);
  const workflowRoot = path.join(resolved.repoRoot, ".github", "workflows");
  const written: WorkflowTemplateWriteEntry[] = [];
  const skipped: WorkflowTemplateWriteEntry[] = [];

  await mkdir(workflowRoot, { recursive: true });
  for (const template of selectedTemplates) {
    const absolutePath = resolveWorkflowPath(resolved.repoRoot, workflowRoot, template);
    const exists = await fileExists(absolutePath);
    const entry: WorkflowTemplateWriteEntry = {
      id: template.id,
      path: toRepoRelativePath(resolved.repoRoot, absolutePath),
      overwritten: exists,
      bytes: Buffer.byteLength(template.content, "utf8")
    };
    if (exists && !input.force) {
      skipped.push(entry);
      continue;
    }
    await writeFile(absolutePath, template.content, "utf8");
    written.push(entry);
  }

  if (!written.length && skipped.length) {
    throw new Error(`Refusing to overwrite existing workflow template(s): ${skipped.map((entry) => entry.path).join(", ")}. Set force=true after reviewing the diffs.`);
  }

  const auditPath = path.join(resolved.configRoot, ".visual-hive", "workflow-edits.json");
  await appendWorkflowAudit(auditPath, {
    editedAt: new Date().toISOString(),
    force: Boolean(input.force),
    written,
    skipped
  });
  return {
    ok: true,
    auditPath: toRepoRelativePath(resolved.repoRoot, auditPath),
    written,
    skipped
  };
}

function selectTemplates(templateIds?: string[]): GitHubWorkflowTemplate[] {
  if (!templateIds || templateIds.length === 0) return githubWorkflowTemplates;
  const wanted = new Set(templateIds);
  const selected = githubWorkflowTemplates.filter((template) => wanted.has(template.id));
  const unknown = [...wanted].filter((id) => !githubWorkflowTemplates.some((template) => template.id === id));
  if (unknown.length) {
    throw new Error(`Unknown Visual Hive workflow template id(s): ${unknown.map((id) => sanitizeText(id)).join(", ")}`);
  }
  return selected;
}

function resolveWorkflowPath(repoRoot: string, workflowRoot: string, template: GitHubWorkflowTemplate): string {
  const relativePath = normalizeRepoRelativePath(template.path);
  if (!relativePath.startsWith(".github/workflows/") || relativePath.includes("\0")) {
    throw new Error(`Refusing unsafe workflow template path: ${sanitizeText(template.path)}`);
  }
  const absolutePath = path.resolve(repoRoot, relativePath);
  if (!isInsidePath(workflowRoot, absolutePath)) {
    throw new Error(`Refusing workflow template path outside .github/workflows: ${sanitizeText(template.path)}`);
  }
  return absolutePath;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) return false;
    throw error;
  }
}

async function appendWorkflowAudit(
  auditPath: string,
  entry: { editedAt: string; force: boolean; written: WorkflowTemplateWriteEntry[]; skipped: WorkflowTemplateWriteEntry[] }
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

function isNodeErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === code);
}
