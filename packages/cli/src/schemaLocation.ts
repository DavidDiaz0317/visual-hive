import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCHEMA_ID_PREFIX = "https://visual-hive.dev/schemas/";
const REQUIRED_CATALOG_FILES = [
  "visual-hive.agent-packet.schema.json",
  "visual-hive.artifacts.schema.json",
  "visual-hive.bundle.schema.json",
  "visual-hive.capability-parity.schema.json",
  "visual-hive.config.schema.json",
  "visual-hive.mcp.schema.json",
  "visual-hive.report.schema.json",
  "visual-hive.tool-registry.schema.json"
] as const;

export async function resolveVisualHiveSchemasDir(cwd: string, explicit?: string): Promise<string> {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = explicit
    ? [path.resolve(cwd, explicit)]
    : [
        path.join(moduleDir, "schemas"),
        path.join(path.dirname(process.argv[1] ?? ""), "schemas"),
        path.resolve(moduleDir, "../../../schemas"),
        path.resolve(moduleDir, "../dist/schemas"),
        path.join(cwd, "schemas")
      ];
  const checked: string[] = [];
  for (const [index, candidate] of [...new Set(candidates.map((value) => path.resolve(value)))].entries()) {
    const validation = await validateVisualHiveSchemaCatalog(candidate);
    if (validation.valid) return candidate;
    if (!explicit && index === 0 && validation.exists) {
      throw new Error(`Installed Visual Hive schema catalog is invalid: ${candidate} (${validation.reason})`);
    }
    checked.push(`${candidate} (${validation.reason})`);
  }
  throw new Error(`Unable to locate Visual Hive schemas. Checked: ${checked.join(", ")}`);
}

async function validateVisualHiveSchemaCatalog(candidate: string): Promise<{ valid: true } | { valid: false; exists: boolean; reason: string }> {
  let files: string[];
  try {
    files = (await readdir(candidate)).filter((file) => file.endsWith(".schema.json")).sort();
  } catch (error) {
    const missing = isRecord(error) && error.code === "ENOENT";
    return { valid: false, exists: !missing, reason: error instanceof Error ? error.message : "not readable" };
  }

  const missing = REQUIRED_CATALOG_FILES.filter((file) => !files.includes(file));
  if (missing.length > 0) return { valid: false, exists: true, reason: `missing ${missing.join(", ")}` };

  const ids = new Set<string>();
  for (const file of files) {
    try {
      const parsed = JSON.parse(await readFile(path.join(candidate, file), "utf8")) as { $id?: unknown };
      const expectedId = `${SCHEMA_ID_PREFIX}${file}`;
      if (parsed.$id !== expectedId) return { valid: false, exists: true, reason: `${file} has an invalid $id` };
      if (ids.has(expectedId)) return { valid: false, exists: true, reason: `${file} duplicates $id ${expectedId}` };
      ids.add(expectedId);
    } catch (error) {
      return { valid: false, exists: true, reason: `${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
  return { valid: true };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
