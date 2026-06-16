import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { githubWorkflowTemplates, type GitHubWorkflowTemplate } from "./workflowTemplates.js";
import { sanitizeText } from "../utils/sanitize.js";

export interface WorkflowTemplateWriteOptions {
  repoRoot: string;
  configRoot?: string;
  readOnly?: boolean;
}

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
  options: WorkflowTemplateWriteOptions,
  input: { confirm: boolean; force?: boolean; templateIds?: string[] }
): Promise<WorkflowTemplateWriteResult> {
  const repoRoot = path.resolve(options.repoRoot);
  const configRoot = path.resolve(options.configRoot ?? repoRoot);
  if (options.readOnly) {
    throw new Error("Workflow template writes are disabled in read-only mode.");
  }
  if (!input.confirm) {
    throw new Error("Workflow template writes require explicit confirmation after reviewing the templates.");
  }
  if (!isInsidePath(repoRoot, configRoot)) {
    throw new Error(`Refusing to write workflow audit outside repository root: ${sanitizeText(configRoot)}`);
  }

  const selectedTemplates = selectTemplates(input.templateIds);
  const workflowRoot = path.join(repoRoot, ".github", "workflows");
  const written: WorkflowTemplateWriteEntry[] = [];
  const skipped: WorkflowTemplateWriteEntry[] = [];

  await mkdir(workflowRoot, { recursive: true });
  for (const template of selectedTemplates) {
    const absolutePath = resolveWorkflowPath(repoRoot, workflowRoot, template);
    const exists = await fileExists(absolutePath);
    const entry: WorkflowTemplateWriteEntry = {
      id: template.id,
      path: toRepoRelativePath(repoRoot, absolutePath),
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
    throw new Error(`Refusing to overwrite existing workflow template(s): ${skipped.map((entry) => entry.path).join(", ")}. Pass --force after reviewing the diffs.`);
  }

  const auditPath = path.join(configRoot, ".visual-hive", "workflow-edits.json");
  await appendWorkflowAudit(auditPath, {
    editedAt: new Date().toISOString(),
    force: Boolean(input.force),
    written,
    skipped
  });
  return {
    ok: true,
    auditPath: toRepoRelativePath(repoRoot, auditPath),
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

function normalizeRepoRelativePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\/+/, "");
}

function toRepoRelativePath(repoRoot: string, filePath: string): string {
  return normalizeRepoRelativePath(path.relative(repoRoot, filePath));
}

function isInsidePath(parent: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === code);
}
