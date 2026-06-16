import { createRequire } from "node:module";
import { loadConfig, resolveTargetUrl, sanitizeText } from "@visual-hive/core";

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
      const primaryUrl = resolveTargetUrl(target);
      diagnostics.push({
        check: `target:${targetId}:url`,
        ok: Boolean(primaryUrl.url),
        detail: primaryUrl.url
          ? target.kind === "deployPreview" && target.urlEnv && !target.url
            ? `Resolved from deploy preview env var ${target.urlEnv}`
            : primaryUrl.url
          : primaryUrl.reason ?? "Target URL is missing"
      });
      if (target.kind === "deployPreview") {
        const envStatus = target.urlEnv ? (process.env[target.urlEnv] ? "present" : "missing") : "not configured";
        diagnostics.push({
          check: `target:${targetId}:deploy-preview`,
          ok: Boolean(primaryUrl.url),
          detail: `provider=${target.provider}; urlEnv=${target.urlEnv ?? "none"} (${envStatus}); fallback=${target.fallbackUrl ? "configured" : "none"}`
        });
      }
      if (target.kind === "command") {
        diagnostics.push({
          check: `target:${targetId}:serve`,
          ok: Boolean(target.serve),
          detail: target.serve ? target.serve : "Command target serve command is missing"
        });
      }
      if (target.kind === "storybook") {
        diagnostics.push({
          check: `target:${targetId}:storybook`,
          ok: Boolean(primaryUrl.url),
          detail: `stories=${target.stories.length}; components=${target.components.length}; serve=${target.serve ? "configured" : "external/static URL"}`
        });
      }
      if (target.kind === "commandGroup" || target.kind === "protected") {
        diagnostics.push({
          check: `target:${targetId}:services`,
          ok: target.kind === "protected" || target.services.length > 0,
          detail:
            target.kind === "protected" && target.services.length === 0
              ? "Protected URL target has no local services to start"
              : `${target.services.length} service(s) configured`
        });
        for (const service of target.services) {
          diagnostics.push({
            check: `target:${targetId}:service:${service.name}`,
            ok: Boolean(service.command && service.url),
            detail: `${service.command} -> ${service.url}${service.readinessTimeoutMs ? ` (${service.readinessTimeoutMs}ms timeout)` : ""}`
          });
        }
      }
      if (target.kind === "protected") {
        const missing = target.requiresSecrets.filter((name) => !process.env[name]);
        diagnostics.push({
          check: `target:${targetId}:protected`,
          ok: !target.prSafe,
          detail: target.prSafe ? "Protected targets should not be prSafe" : "Protected target is not PR safe"
        });
        diagnostics.push({
          check: `target:${targetId}:secrets`,
          ok: true,
          detail:
            missing.length === 0
              ? "All required secret environment variables are present"
              : `Missing env vars for protected runs only: ${missing.join(", ")}`
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
