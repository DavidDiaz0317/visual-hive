import type { TargetConfig } from "../config/schema.js";

export interface TargetUrlResolution {
  url?: string;
  reason?: string;
}

export function resolveTargetUrl(target: TargetConfig, env: NodeJS.ProcessEnv = process.env): TargetUrlResolution {
  if (target.url) {
    return { url: target.url };
  }
  if (target.kind === "deployPreview") {
    return resolveDeployPreviewUrl(target, env);
  }
  if ((target.kind === "commandGroup" || target.kind === "protected") && target.services.length > 0) {
    return { url: target.services[0]?.url };
  }
  return { reason: `Target kind "${target.kind}" is missing a primary URL.` };
}

function resolveDeployPreviewUrl(target: Extract<TargetConfig, { kind: "deployPreview" }>, env: NodeJS.ProcessEnv): TargetUrlResolution {
  if (target.urlEnv) {
    const value = env[target.urlEnv];
    if (value) {
      const url = buildUrlFromEnvironment(value, target.urlEnv, target.urlTemplate);
      if (isValidUrl(url)) {
        return { url };
      }
      return { reason: `Deploy preview env var ${target.urlEnv} did not resolve to a valid URL.` };
    }
  }
  if (target.fallbackUrl) {
    return { url: target.fallbackUrl };
  }
  return {
    reason: target.urlEnv
      ? `Deploy preview URL env var ${target.urlEnv} is not set and no fallbackUrl is configured.`
      : "Deploy preview target does not have a resolved URL."
  };
}

function buildUrlFromEnvironment(value: string, envName: string, template: string | undefined): string {
  const trimmed = value.trim();
  if (template) {
    return template
      .replaceAll(`\${${envName}}`, trimmed)
      .replaceAll(`$${envName}`, trimmed)
      .replaceAll(`{{${envName}}}`, trimmed);
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

function isValidUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
