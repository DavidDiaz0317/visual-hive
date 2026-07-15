import { createHash } from "node:crypto";
import type { Command } from "commander";
import type { CliCapability } from "@visual-hive/core";

export function collectCliCapabilitySurface(root: Command): CliCapability[] {
  const capabilities: CliCapability[] = [capabilityFor(root, root.name() || "visual-hive", [])];

  function visit(command: Command, canonicalParents: string[], parentInvocations: string[][]): void {
    for (const child of command.commands) {
      const pathParts = [...canonicalParents, child.name()];
      const invocations = parentInvocations.flatMap((parent) =>
        [child.name(), ...child.aliases()].map((name) => [...parent, name])
      );
      const canonicalPath = pathParts.join(" ");
      const aliases = [...new Set(invocations.map((parts) => parts.join(" ")).filter((invocation) => invocation !== canonicalPath))].sort();
      capabilities.push(capabilityFor(child, canonicalPath, aliases));
      visit(child, pathParts, invocations);
    }
  }

  visit(root, [], [[]]);
  return capabilities.sort((left, right) => left.path.localeCompare(right.path));
}

function capabilityFor(command: Command, path: string, aliases: string[]): CliCapability {
  const contract = {
    arguments: (command.registeredArguments ?? []).map((argument) => ({
      name: argument.name(),
      required: argument.required,
      variadic: argument.variadic,
      ...(argument.defaultValue === undefined ? {} : { defaultValue: normalizeValue(argument.defaultValue) }),
      ...(argument.argChoices ? { choices: [...argument.argChoices] } : {}),
      parser: parserName((argument as typeof argument & { parseArg?: unknown }).parseArg)
    })),
    options: command.options
      .map((option) => ({
        flags: option.flags,
        required: option.required,
        optional: option.optional,
        variadic: option.variadic,
        mandatory: option.mandatory,
        negated: option.negate,
        ...(option.defaultValue === undefined ? {} : { defaultValue: normalizeValue(option.defaultValue) }),
        ...(option.argChoices ? { choices: [...option.argChoices] } : {}),
        ...(option.envVar ? { envVar: option.envVar } : {}),
        parser: parserName(option.parseArg)
      }))
      .sort((left, right) => left.flags.localeCompare(right.flags))
  };
  return {
    path,
    aliases,
    contractSha256: createHash("sha256").update(stableJson(contract)).digest("hex")
  };
}

function parserName(parser: unknown): string {
  if (typeof parser !== "function") return "none";
  return parser.name || "custom";
}

function normalizeValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, normalizeValue(child)]));
  }
  return String(value);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
