import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseConfigText, sanitizeText, type SetupRecommendationReport, type VisualHiveConfig } from "@visual-hive/core";
import type { ControlPlaneOptions } from "./types.js";
import { isInsidePath, toRepoRelativePath } from "./safePath.js";
import { resolveControlPlaneOptions } from "./repoReader.js";

const MAX_CONFIG_BYTES = 512 * 1024;

export interface ConfigDraftValidation {
  ok: boolean;
  configPath: string;
  diff: string;
  config?: VisualHiveConfig;
  error?: string;
}

export interface ConfigSaveResult extends ConfigDraftValidation {
  ok: true;
  auditPath: string;
}

export interface RecommendedConfigWriteResult extends ConfigSaveResult {
  recommendationPath: string;
  overwritten: boolean;
}

export async function validateConfigDraft(options: ControlPlaneOptions, content: string): Promise<ConfigDraftValidation> {
  const resolved = resolveControlPlaneOptions(options);
  assertEditableConfigPath(resolved.repoRoot, resolved.configPath);
  assertConfigSize(content);
  const current = await readConfigText(resolved.configPath);
  const diff = createUnifiedDiff(current, content, "current visual-hive.config.yaml", "proposed visual-hive.config.yaml");
  try {
    const config = parseConfigText(content, resolved.configPath);
    return {
      ok: true,
      configPath: toRepoRelativePath(resolved.repoRoot, resolved.configPath),
      diff,
      config
    };
  } catch (error) {
    return {
      ok: false,
      configPath: toRepoRelativePath(resolved.repoRoot, resolved.configPath),
      diff,
      error: sanitizeText(error instanceof Error ? error.message : String(error))
    };
  }
}

export async function saveConfigDraft(
  options: ControlPlaneOptions,
  content: string,
  confirm: boolean
): Promise<ConfigSaveResult> {
  const resolved = resolveControlPlaneOptions(options);
  if (resolved.readOnly) {
    throw new Error("Control Plane is read-only. Restart without --read-only to edit config.");
  }
  if (!confirm) {
    throw new Error("Config save requires explicit confirmation after reviewing the diff.");
  }
  const validation = await validateConfigDraft(options, content);
  if (!validation.ok || !validation.config) {
    throw new Error(validation.error ?? "Config draft is invalid.");
  }
  await writeFile(resolved.configPath, content, "utf8");
  const auditPath = path.join(resolved.configRoot, ".visual-hive", "config-edits.json");
  await appendAudit(auditPath, {
    source: "config-editor",
    editedAt: new Date().toISOString(),
    configPath: toRepoRelativePath(resolved.repoRoot, resolved.configPath),
    diff: validation.diff,
    bytes: Buffer.byteLength(content, "utf8")
  });
  return {
    ...validation,
    ok: true,
    auditPath: toRepoRelativePath(resolved.repoRoot, auditPath)
  };
}

export async function writeRecommendedConfigFromSetup(
  options: ControlPlaneOptions,
  confirm: boolean,
  force = false
): Promise<RecommendedConfigWriteResult> {
  const resolved = resolveControlPlaneOptions(options);
  if (resolved.readOnly) {
    throw new Error("Control Plane is read-only. Restart without --read-only to generate config.");
  }
  if (!confirm) {
    throw new Error("Recommended config write requires explicit confirmation after reviewing the generated YAML.");
  }
  assertEditableConfigPath(resolved.repoRoot, resolved.configPath);
  const recommendationPath = path.join(resolved.configRoot, ".visual-hive", "recommendations.json");
  const recommendation = await readSetupRecommendation(recommendationPath);
  const content = recommendation.recommendedConfigYaml;
  if (!content || typeof content !== "string") {
    throw new Error("Setup recommendation does not contain recommendedConfigYaml. Re-run visual-hive recommend.");
  }
  const configAlreadyExists = await exists(resolved.configPath);
  if (configAlreadyExists && !force) {
    throw new Error(`Refusing to overwrite existing Visual Hive config: ${toRepoRelativePath(resolved.repoRoot, resolved.configPath)}. Set force=true after reviewing the diff.`);
  }
  const validation = await validateConfigDraft(options, content);
  if (!validation.ok || !validation.config) {
    throw new Error(validation.error ?? "Recommended config is invalid.");
  }
  await mkdir(path.dirname(resolved.configPath), { recursive: true });
  await writeFile(resolved.configPath, content, "utf8");
  const auditPath = path.join(resolved.configRoot, ".visual-hive", "config-edits.json");
  await appendAudit(auditPath, {
    source: "setup-recommendation",
    editedAt: new Date().toISOString(),
    configPath: toRepoRelativePath(resolved.repoRoot, resolved.configPath),
    diff: validation.diff,
    bytes: Buffer.byteLength(content, "utf8")
  });
  return {
    ...validation,
    ok: true,
    auditPath: toRepoRelativePath(resolved.repoRoot, auditPath),
    recommendationPath: toRepoRelativePath(resolved.repoRoot, recommendationPath),
    overwritten: configAlreadyExists
  };
}

async function readConfigText(configPath: string): Promise<string> {
  try {
    return await readFile(configPath, "utf8");
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) return "";
    throw error;
  }
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === code);
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) return false;
    throw error;
  }
}

function assertEditableConfigPath(repoRoot: string, configPath: string): void {
  if (!isInsidePath(repoRoot, configPath)) {
    throw new Error(`Refusing to edit config outside repository root: ${sanitizeText(configPath)}`);
  }
}

function assertConfigSize(content: string): void {
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > MAX_CONFIG_BYTES) {
    throw new Error(`Config draft is too large: ${bytes} bytes. Maximum is ${MAX_CONFIG_BYTES} bytes.`);
  }
}

async function appendAudit(
  auditPath: string,
  entry: { source: "config-editor" | "setup-recommendation"; editedAt: string; configPath: string; diff: string; bytes: number }
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

async function readSetupRecommendation(recommendationPath: string): Promise<SetupRecommendationReport> {
  let raw: string;
  try {
    raw = await readFile(recommendationPath, "utf8");
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      throw new Error(`Missing setup recommendation artifact: ${sanitizeText(recommendationPath)}. Run visual-hive recommend first.`);
    }
    throw error;
  }
  try {
    return JSON.parse(raw) as SetupRecommendationReport;
  } catch {
    throw new Error(`Invalid setup recommendation artifact: ${sanitizeText(recommendationPath)}. Re-run visual-hive recommend.`);
  }
}

function createUnifiedDiff(current: string, proposed: string, fromLabel: string, toLabel: string): string {
  if (current === proposed) {
    return "No config changes.";
  }
  const currentLines = splitLines(current);
  const proposedLines = splitLines(proposed);
  const diff = [`--- ${fromLabel}`, `+++ ${toLabel}`];
  const max = Math.max(currentLines.length, proposedLines.length);
  for (let index = 0; index < max; index += 1) {
    const before = currentLines[index];
    const after = proposedLines[index];
    if (before === after && before !== undefined) {
      diff.push(` ${before}`);
      continue;
    }
    if (before !== undefined) diff.push(`-${before}`);
    if (after !== undefined) diff.push(`+${after}`);
  }
  return diff.join("\n");
}

function splitLines(value: string): string[] {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}
