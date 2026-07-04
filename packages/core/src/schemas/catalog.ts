import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { VISUAL_HIVE_EVIDENCE_RESOURCES } from "../tools/evidenceResources.js";

export type SchemaCatalogStatus = "passed" | "failed";

export interface SchemaCatalogCheck {
  id: string;
  status: SchemaCatalogStatus;
  message: string;
  file?: string;
  expected?: string[];
  actual?: string[];
}

export interface SchemaCatalogReport {
  schemaVersion: "visual-hive.schema-catalog.v1";
  generatedAt: string;
  status: SchemaCatalogStatus;
  schemasDir: string;
  summary: {
    schemasChecked: number;
    checks: number;
    passed: number;
    failed: number;
    evidenceResources: number;
    evidenceReadTools: number;
  };
  checks: SchemaCatalogCheck[];
}

export interface VerifySchemaCatalogOptions {
  rootDir: string;
  schemasDir?: string;
  now?: Date;
}

type JsonObject = Record<string, unknown>;

const SCHEMA_ID_PREFIX = "https://visual-hive.dev/schemas/";
const BROAD_CATALOG_SCHEMA_FILES = new Set([
  "visual-hive.agent-packet.schema.json",
  "visual-hive.artifacts.schema.json",
  "visual-hive.context-ledger.schema.json",
  "visual-hive.control-plane-snapshot.schema.json",
  "visual-hive.mcp.schema.json",
  "visual-hive.tool-registry.schema.json"
]);
const CATALOG_ENUMS: Record<string, string[]> = {
  evidenceResourceId: VISUAL_HIVE_EVIDENCE_RESOURCES.map((resource) => resource.id),
  evidenceResourceUri: VISUAL_HIVE_EVIDENCE_RESOURCES.map((resource) => resource.uri),
  evidenceReadToolName: VISUAL_HIVE_EVIDENCE_RESOURCES.flatMap((resource) => (resource.readTool ? [resource.readTool.name] : [])),
  readToolName: VISUAL_HIVE_EVIDENCE_RESOURCES.flatMap((resource) => (resource.readTool ? [resource.readTool.name] : [])),
  artifactPath: VISUAL_HIVE_EVIDENCE_RESOURCES.map((resource) => resource.relativePath)
};

export async function verifySchemaCatalog(options: VerifySchemaCatalogOptions): Promise<SchemaCatalogReport> {
  const schemasDir = path.resolve(options.rootDir, options.schemasDir ?? "schemas");
  const schemaFiles = (await readdir(schemasDir))
    .filter((file) => file.endsWith(".schema.json"))
    .sort((left, right) => left.localeCompare(right));
  const checks: SchemaCatalogCheck[] = [];

  for (const file of schemaFiles) {
    const fullPath = path.join(schemasDir, file);
    const relativePath = path.relative(options.rootDir, fullPath).replaceAll(path.sep, "/");
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(fullPath, "utf8"));
    } catch (error) {
      checks.push({
        id: `parse:${relativePath}`,
        status: "failed",
        file: relativePath,
        message: `Schema is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
      });
      continue;
    }

    const schemaId = isObject(parsed) && typeof parsed.$id === "string" ? parsed.$id : undefined;
    checks.push(compareScalar({
      id: `schema-id:${relativePath}`,
      file: relativePath,
      actual: schemaId,
      expected: `${SCHEMA_ID_PREFIX}${file}`,
      label: "$id"
    }));

    for (const check of collectCatalogEnumChecks(parsed, relativePath, BROAD_CATALOG_SCHEMA_FILES.has(file))) {
      checks.push(check);
    }
  }

  const failed = checks.filter((check) => check.status === "failed").length;
  return {
    schemaVersion: "visual-hive.schema-catalog.v1",
    generatedAt: (options.now ?? new Date()).toISOString(),
    status: failed > 0 ? "failed" : "passed",
    schemasDir: path.relative(options.rootDir, schemasDir).replaceAll(path.sep, "/") || ".",
    summary: {
      schemasChecked: schemaFiles.length,
      checks: checks.length,
      passed: checks.length - failed,
      failed,
      evidenceResources: VISUAL_HIVE_EVIDENCE_RESOURCES.length,
      evidenceReadTools: CATALOG_ENUMS.evidenceReadToolName.length
    },
    checks
  };
}

function collectCatalogEnumChecks(value: unknown, file: string, requireFullCatalog: boolean): SchemaCatalogCheck[] {
  const checks: SchemaCatalogCheck[] = [];
  visit(value, [], (node, pathParts) => {
    const isEvidenceResourceObject = ["evidenceResourceId", "evidenceResourceUri", "evidenceReadToolName"].some((propertyName) => isObject(node[propertyName]));
    for (const [propertyName, expected] of Object.entries(CATALOG_ENUMS)) {
      if (propertyName === "artifactPath" && !isEvidenceResourceObject) continue;
      const propertyValue = node[propertyName];
      if (!isObject(propertyValue)) continue;
      const enumValue = propertyValue.enum;
      const constValue = propertyValue.const;
      if (typeof constValue === "string") {
        checks.push(compareSubset({
          id: `catalog-const:${file}:${[...pathParts, propertyName, "const"].join(".")}`,
          file,
          actual: [constValue],
          expected,
          label: propertyName
        }));
        continue;
      }
      if (!Array.isArray(enumValue) && pathParts.includes("properties")) {
        checks.push({
          id: `catalog-enum:${file}:${[...pathParts, propertyName].join(".")}`,
          status: "failed",
          file,
          message: `${propertyName} must use a catalog-backed enum`,
          expected
        });
        continue;
      }
      if (Array.isArray(enumValue)) {
        checks.push((requireFullCatalog ? compareArray : compareSubset)({
          id: `catalog-enum:${file}:${[...pathParts, propertyName, "enum"].join(".")}`,
          file,
          actual: enumValue.map((item) => String(item)),
          expected,
          label: propertyName
        }));
      }
    }
  });
  return checks;
}

function visit(value: unknown, pathParts: string[], callback: (node: JsonObject, pathParts: string[]) => void): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => visit(item, [...pathParts, String(index)], callback));
    return;
  }
  if (!isObject(value)) return;
  callback(value, pathParts);
  for (const [key, child] of Object.entries(value)) {
    visit(child, [...pathParts, key], callback);
  }
}

function compareScalar(input: { id: string; file: string; actual?: string; expected: string; label: string }): SchemaCatalogCheck {
  const passed = input.actual === input.expected;
  return {
    id: input.id,
    status: passed ? "passed" : "failed",
    file: input.file,
    message: passed ? `${input.label} matches ${input.expected}` : `${input.label} drift: expected ${input.expected}, got ${input.actual ?? "missing"}`,
    expected: [input.expected],
    actual: input.actual ? [input.actual] : []
  };
}

function compareArray(input: { id: string; file: string; actual: string[]; expected: string[]; label: string }): SchemaCatalogCheck {
  const passed = arraysEqual(input.actual, input.expected);
  return {
    id: input.id,
    status: passed ? "passed" : "failed",
    file: input.file,
    message: passed
      ? `${input.label} enum matches the evidence-resource catalog`
      : `${input.label} enum drift: expected ${input.expected.length} item(s), got ${input.actual.length}`,
    expected: input.expected,
    actual: input.actual
  };
}

function compareSubset(input: { id: string; file: string; actual: string[]; expected: string[]; label: string }): SchemaCatalogCheck {
  const unknown = input.actual.filter((value) => !input.expected.includes(value));
  const passed = unknown.length === 0;
  return {
    id: input.id,
    status: passed ? "passed" : "failed",
    file: input.file,
    message: passed
      ? `${input.label} values are catalog-backed`
      : `${input.label} has ${unknown.length} value(s) outside the evidence-resource catalog`,
    expected: input.expected,
    actual: input.actual
  };
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
