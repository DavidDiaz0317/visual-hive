import { minimatch } from "minimatch";
import type { VisualHiveConfig } from "../config/schema.js";
import type { CreatePlanOptions, ExcludedPlanItem, MutationPlan, Plan, PlanItem } from "./types.js";

export function createPlan(config: VisualHiveConfig, options: CreatePlanOptions): Plan {
  const changedFiles = options.changedFiles ?? [];
  const allowUnsafeTargets = options.allowUnsafeTargets ?? false;
  const selected = new Map<string, PlanItem>();
  const excluded: ExcludedPlanItem[] = [];
  const changedFileReasons = getChangedFileReasons(config, changedFiles);

  for (const contract of config.contracts) {
    const target = config.targets[contract.target];
    const reasons: string[] = [];

    if (options.mode === "pr" && contract.runOn.pullRequest) {
      reasons.push("runOn.pullRequest=true");
    }
    if (options.mode === "schedule" && contract.runOn.schedule) {
      reasons.push("runOn.schedule=true");
    }
    if (options.mode === "manual") {
      reasons.push("manual mode");
    }

    const ruleReasons = changedFileReasons.get(contract.id) ?? [];
    reasons.push(...ruleReasons);

    if (reasons.length === 0) {
      continue;
    }

    if (options.mode === "pr" && !target.prSafe && !allowUnsafeTargets) {
      excluded.push({
        contractId: contract.id,
        targetId: contract.target,
        reasons: ["target.prSafe=false", "pass --allow-unsafe-targets to include this target"]
      });
      continue;
    }

    reasons.push(`severity=${contract.severity}`, `cost=${target.cost}`);
    selected.set(contract.id, {
      contractId: contract.id,
      targetId: contract.target,
      targetUrl: targetPrimaryUrl(target),
      severity: contract.severity,
      cost: target.cost,
      reasons: unique(reasons),
      screenshots: contract.screenshots.map((shot) => `${shot.name}:${shot.route}:${shot.viewport}`)
    });
  }

  const items = [...selected.values()].sort((a, b) => `${a.targetId}:${a.contractId}`.localeCompare(`${b.targetId}:${b.contractId}`));

  return {
    schemaVersion: 1,
    project: config.project.name,
    mode: options.mode,
    generatedAt: (options.now ?? new Date()).toISOString(),
    changedFiles,
    targets: unique(items.map((item) => item.targetId))
      .sort()
      .map((targetId) => {
        const target = config.targets[targetId];
        return {
          id: targetId,
          kind: target.kind,
          url: targetPrimaryUrl(target),
          prSafe: target.prSafe,
          cost: target.cost,
          requiresSecrets: target.kind === "protected" ? target.requiresSecrets : undefined
        };
      }),
    items,
    excluded,
    mutation: createMutationPlan(config, options)
  };
}

function getChangedFileReasons(config: VisualHiveConfig, changedFiles: string[]): Map<string, string[]> {
  const reasons = new Map<string, string[]>();
  for (const rule of config.selection.changedFiles) {
    const matches = changedFiles.filter((file) => minimatch(normalizePath(file), normalizePath(rule.pattern), { dot: true }));
    if (matches.length === 0) {
      continue;
    }
    for (const contractId of rule.contracts) {
      const existing = reasons.get(contractId) ?? [];
      existing.push(`changed-file:${rule.pattern}:risk=${rule.risk}:matches=${matches.join(",")}`);
      reasons.set(contractId, existing);
    }
  }
  return reasons;
}

function createMutationPlan(config: VisualHiveConfig, options: CreatePlanOptions): MutationPlan {
  if (!config.mutation.enabled) {
    return { enabled: false, operators: [], minScore: config.mutation.minScore, reasons: ["mutation.enabled=false"] };
  }
  if (options.mode === "schedule" && config.mutation.runOn.schedule) {
    return {
      enabled: true,
      operators: config.mutation.operators,
      minScore: config.mutation.minScore,
      reasons: ["mode=schedule", "mutation.runOn.schedule=true"]
    };
  }
  if (options.mode === "manual") {
    return {
      enabled: true,
      operators: config.mutation.operators,
      minScore: config.mutation.minScore,
      reasons: ["manual mode"]
    };
  }
  return {
    enabled: false,
    operators: [],
    minScore: config.mutation.minScore,
    reasons: [`mode=${options.mode}`, "mutation not selected for this mode"]
  };
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/");
}

function targetPrimaryUrl(target: VisualHiveConfig["targets"][string]): string {
  if (target.url) {
    return target.url;
  }
  if ((target.kind === "commandGroup" || target.kind === "protected") && target.services.length > 0) {
    return target.services[0].url;
  }
  throw new Error(`Target ${target.kind} is missing a primary URL`);
}
