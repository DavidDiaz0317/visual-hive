import { readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { ZodError } from "zod";
import { VisualHiveConfigSchema, type VisualHiveConfig } from "./schema.js";
import { sanitizeText } from "../utils/sanitize.js";

export interface LoadedConfig {
  config: VisualHiveConfig;
  configPath: string;
  rootDir: string;
}

export async function loadConfig(configPath = "visual-hive.config.yaml", cwd = process.cwd()): Promise<LoadedConfig> {
  const resolvedPath = path.resolve(cwd, configPath);
  let raw: string;
  try {
    raw = await readFile(resolvedPath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Missing Visual Hive config at ${resolvedPath}. Run "visual-hive init" or pass --config <path>. Details: ${sanitizeText(message)}`
    );
  }

  let parsed: unknown;
  try {
    parsed = YAML.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to parse YAML config at ${resolvedPath}: ${sanitizeText(message)}`);
  }

  try {
    const config = VisualHiveConfigSchema.parse(parsed);
    validateReferences(config);
    return {
      config,
      configPath: resolvedPath,
      rootDir: path.dirname(resolvedPath)
    };
  } catch (error) {
    if (error instanceof ZodError) {
      const details = error.issues.map((issue) => `${issue.path.join(".") || "config"}: ${issue.message}`).join("; ");
      throw new Error(`Invalid Visual Hive config at ${resolvedPath}: ${sanitizeText(details)}`);
    }
    throw error;
  }
}

export function validateReferences(config: VisualHiveConfig): void {
  const targetIds = new Set(Object.keys(config.targets));
  const contractIds = new Set(config.contracts.map((contract) => contract.id));

  for (const contract of config.contracts) {
    if (!targetIds.has(contract.target)) {
      throw new Error(
        `Invalid target reference in Visual Hive config: contract "${contract.id}" references unknown target "${contract.target}". Define it under targets or change the contract target.`
      );
    }
    for (const shot of contract.screenshots) {
      if (!config.viewports[shot.viewport]) {
        throw new Error(
          `Invalid Visual Hive config: screenshot "${shot.name}" in contract "${contract.id}" references unknown viewport "${shot.viewport}"`
        );
      }
    }
  }

  for (const rule of config.selection.changedFiles) {
    for (const contractId of rule.contracts) {
      if (!contractIds.has(contractId)) {
        throw new Error(`Invalid Visual Hive config: changed file rule "${rule.pattern}" references unknown contract "${contractId}"`);
      }
    }
  }

  for (const operator of config.mutation.operators) {
    if (typeof operator === "string") {
      continue;
    }
    for (const contractId of operator.contracts) {
      if (!contractIds.has(contractId)) {
        throw new Error(`Invalid Visual Hive config: mutation operator "${operator.id}" references unknown contract "${contractId}"`);
      }
    }
  }
}
