import path from "node:path";
import { loadConfig, writeToolRegistry, type ToolRegistry } from "@visual-hive/core";

export interface ToolsCommandOptions {
  config?: string;
  cwd?: string;
  output?: string;
  markdown?: string;
  format?: "markdown" | "json";
}

export interface ToolsCommandResult {
  registry: ToolRegistry;
  registryPath: string;
  cardsPath: string;
  cardsMarkdown: string;
}

export async function runToolsCommand(options: ToolsCommandOptions = {}): Promise<ToolsCommandResult> {
  const cwd = options.cwd ?? process.cwd();
  const loaded = await loadConfig(options.config, cwd);
  return writeToolRegistry({
    rootDir: loaded.rootDir,
    project: loaded.config.project.name,
    registryPath: options.output ?? path.join(".visual-hive", "tools", "tool-registry.json"),
    cardsPath: options.markdown ?? path.join(".visual-hive", "tools", "tool-cards.md")
  });
}

export function formatToolsRegistry(result: ToolsCommandResult, format: "markdown" | "json" = "markdown"): string {
  if (format === "json") return JSON.stringify(result.registry, null, 2);
  const { registry } = result;
  const enabledTools = registry.tools.filter((tool) => tool.enabled).length;
  const trustedTools = registry.tools.filter((tool) => tool.trustedOnly).length;
  const externalTools = registry.tools.filter((tool) => tool.externalNetwork).length;
  return [
    `Wrote ${result.registryPath}`,
    `Wrote ${result.cardsPath}`,
    "",
    `# Tool Registry: ${registry.project}`,
    "",
    `- Tools: ${registry.tools.length}`,
    `- Enabled by default: ${enabledTools}`,
    `- Trusted-only: ${trustedTools}`,
    `- External network tools: ${externalTools}`,
    `- Third-party MCP exposed by default: ${registry.policy.exposeThirdPartyMcp}`,
    `- External uploads from PR: ${registry.policy.externalUploadsFromPr}`,
    `- Max external cost per task: $${registry.policy.maxExternalCostUsdPerTask}`,
    "",
    "## Role Profiles",
    ...registry.roleProfiles.map((profile) => `- ${profile.role}: ${profile.allowedToolIds.length} tool card(s); trustedOnly=${profile.trustedOnly}`)
  ].join("\n");
}
