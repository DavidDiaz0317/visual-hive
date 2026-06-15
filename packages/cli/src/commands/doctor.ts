import { createRequire } from "node:module";
import { loadConfig, sanitizeText } from "@visual-hive/core";

const require = createRequire(import.meta.url);

export interface Diagnostic {
  check: string;
  ok: boolean;
  detail: string;
}

export interface DoctorOptions {
  config?: string;
  cwd?: string;
}

export async function runDoctor(options: DoctorOptions = {}): Promise<{ ok: boolean; diagnostics: Diagnostic[] }> {
  const diagnostics: Diagnostic[] = [];
  let loaded: Awaited<ReturnType<typeof loadConfig>> | undefined;

  try {
    loaded = await loadConfig(options.config, options.cwd);
    diagnostics.push({ check: "config", ok: true, detail: `Loaded ${loaded.configPath}` });
  } catch (error) {
    diagnostics.push({ check: "config", ok: false, detail: sanitizeText(error instanceof Error ? error.message : String(error)) });
  }

  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  diagnostics.push({
    check: "node",
    ok: nodeMajor >= 22,
    detail: `Detected Node ${process.versions.node}; Visual Hive requires Node >=22`
  });

  try {
    require.resolve("@playwright/test");
    diagnostics.push({ check: "playwright", ok: true, detail: "@playwright/test is available" });
  } catch {
    diagnostics.push({ check: "playwright", ok: false, detail: "@playwright/test is not installed or cannot be resolved" });
  }

  if (loaded) {
    for (const [targetId, target] of Object.entries(loaded.config.targets)) {
      diagnostics.push({
        check: `target:${targetId}:url`,
        ok: Boolean(target.url),
        detail: target.url ? target.url : "Target URL is missing"
      });
      if (target.kind === "command") {
        diagnostics.push({
          check: `target:${targetId}:serve`,
          ok: Boolean(target.serve),
          detail: target.serve ? target.serve : "Command target serve command is missing"
        });
      }
    }
  }

  return {
    ok: diagnostics.every((diagnostic) => diagnostic.ok),
    diagnostics
  };
}

export function formatDiagnostics(diagnostics: Diagnostic[]): string {
  const rows = diagnostics.map((diagnostic) => [
    diagnostic.ok ? "PASS" : "FAIL",
    diagnostic.check,
    sanitizeText(diagnostic.detail).replace(/\s+/g, " ")
  ]);
  const widths = [0, 1, 2].map((index) => Math.max(...rows.map((row) => row[index]?.length ?? 0), index === 0 ? 6 : 10));
  return [
    ["Status", "Check", "Detail"].map((cell, index) => cell.padEnd(widths[index])).join("  "),
    widths.map((width) => "-".repeat(width)).join("  "),
    ...rows.map((row) => row.map((cell, index) => cell.padEnd(widths[index])).join("  "))
  ].join("\n");
}
