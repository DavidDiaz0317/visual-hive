import { minimatch } from "minimatch";
import type { VisualHiveConfig } from "../config/schema.js";
import { selectContractsForMutation } from "../mutations/operators.js";
import type { CreatePlanOptions, ExcludedPlanItem, MutationPlan, Plan, PlanItem } from "./types.js";

export function createPlan(config: VisualHiveConfig, options: CreatePlanOptions): Plan {
  const changedFiles = [...(options.changedFiles ?? [])].sort();
  const ignoredChangedFiles = getIgnoredChangedFiles(config, changedFiles);
  const ignoredFileSet = new Set(ignoredChangedFiles.map((entry) => entry.file));
  const effectiveChangedFiles = changedFiles.filter((file) => !ignoredFileSet.has(file));
  const onlyIgnoredChangedFiles = options.mode === "pr" && changedFiles.length > 0 && effectiveChangedFiles.length === 0 && ignoredChangedFiles.length > 0;
  const allowUnsafeTargets = options.allowUnsafeTargets ?? false;
  const includeContracts = new Set(options.includeContracts ?? []);
  const excludeContracts = new Set(options.excludeContracts ?? []);
  const includeTargets = new Set(options.includeTargets ?? []);
  const excludeTargets = new Set(options.excludeTargets ?? []);
  const selected = new Map<string, PlanItem>();
  const excluded: ExcludedPlanItem[] = [];
  const changedFileReasons = getChangedFileReasons(config, effectiveChangedFiles);
  const mutationModeReasons = options.mode === "mutation" ? getMutationModeReasons(config) : new Map<string, string[]>();

  for (const contract of config.contracts) {
    const target = config.targets[contract.target];
    const reasons: string[] = [];
    const explicitlyIncluded = includeContracts.has(contract.id) || includeTargets.has(contract.target);

    const explicitExclusionReasons = explicitExclusionReasonsFor(contract.id, contract.target, excludeContracts, excludeTargets);
    if (explicitExclusionReasons.length > 0) {
      excluded.push({
        contractId: contract.id,
        targetId: contract.target,
        reasons: explicitExclusionReasons
      });
      continue;
    }

    if (onlyIgnoredChangedFiles && contract.runOn.pullRequest && !explicitlyIncluded) {
      excluded.push({
        contractId: contract.id,
        targetId: contract.target,
        reasons: [
          "all changed files matched selection.ignoreChangedFiles",
          ...ignoredChangedFiles.map((entry) => `ignored:${entry.file}:matches=${entry.pattern}:reason=${entry.reason}`)
        ]
      });
      continue;
    }

    if (options.mode === "pr" && contract.runOn.pullRequest) {
      reasons.push("runOn.pullRequest=true");
    }
    if (options.mode === "schedule" && contract.runOn.schedule) {
      reasons.push("runOn.schedule=true");
    }
    if (options.mode === "manual") {
      reasons.push("manual mode");
    }
    if (options.mode === "full") {
      reasons.push("full mode");
    }
    if (options.mode === "canary" && contract.runOn.schedule && target.schedule) {
      reasons.push("mode=canary", "runOn.schedule=true", `target.schedule=${target.schedule}`);
      if (target.cost !== "expensive") {
        reasons.push("cost is not expensive");
      }
    }
    if (options.mode === "mutation") {
      reasons.push(...(mutationModeReasons.get(contract.id) ?? []));
    }
    if (includeContracts.has(contract.id)) {
      reasons.push("explicit include contract");
    }
    if (includeTargets.has(contract.target)) {
      reasons.push("explicit include target");
    }

    const ruleReasons = changedFileReasons.get(contract.id) ?? [];
    if (options.mode === "pr" || options.mode === "schedule" || options.mode === "manual") {
      reasons.push(...ruleReasons);
    } else if (reasons.length > 0 && ruleReasons.length > 0) {
      reasons.push(...ruleReasons.map((reason) => `context:${reason}`));
    }

    if (reasons.length === 0) {
      continue;
    }

    const exclusionReasons = targetExclusionReasons(options.mode, target, allowUnsafeTargets);
    if (exclusionReasons.length > 0) {
      excluded.push({
        contractId: contract.id,
        targetId: contract.target,
        reasons: exclusionReasons
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
    effectiveChangedFiles,
    ignoredChangedFiles,
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

function explicitExclusionReasonsFor(contractId: string, targetId: string, excludeContracts: Set<string>, excludeTargets: Set<string>): string[] {
  const reasons: string[] = [];
  if (excludeContracts.has(contractId)) {
    reasons.push("explicit exclude contract");
  }
  if (excludeTargets.has(targetId)) {
    reasons.push("explicit exclude target");
  }
  return reasons;
}

function getIgnoredChangedFiles(config: VisualHiveConfig, changedFiles: string[]): Plan["ignoredChangedFiles"] {
  const ignored: Plan["ignoredChangedFiles"] = [];
  for (const file of changedFiles) {
    const normalizedFile = normalizePath(file);
    const match = config.selection.ignoreChangedFiles.find((rule) => minimatch(normalizedFile, normalizePath(rule.pattern), { dot: true }));
    if (match) {
      ignored.push({ file, pattern: match.pattern, reason: match.reason });
    }
  }
  return ignored;
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

function getMutationModeReasons(config: VisualHiveConfig): Map<string, string[]> {
  const reasons = new Map<string, string[]>();
  if (!config.mutation.enabled) {
    return reasons;
  }
  for (const operator of config.mutation.operators) {
    const selection = selectContractsForMutation(operator, config.contracts);
    if (!selection.applicable) {
      continue;
    }
    for (const contractId of selection.contractIds) {
      const existing = reasons.get(contractId) ?? [];
      existing.push(`mutation-mode:${selection.operatorId}:${selection.reason}`);
      reasons.set(contractId, existing);
    }
  }
  return reasons;
}

function targetExclusionReasons(
  mode: CreatePlanOptions["mode"],
  target: VisualHiveConfig["targets"][string],
  allowUnsafeTargets: boolean
): string[] {
  const reasons: string[] = [];
  if (!allowUnsafeTargets && (mode === "pr" || mode === "canary" || mode === "mutation") && !target.prSafe) {
    reasons.push("target.prSafe=false", "pass --allow-unsafe-targets to include this target");
  }
  if (mode === "canary" && target.cost === "expensive") {
    reasons.push("target.cost=expensive", "canary mode only selects cheap or medium scheduled targets");
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
  if (options.mode === "mutation") {
    return {
      enabled: true,
      operators: config.mutation.operators,
      minScore: config.mutation.minScore,
      reasons: ["mode=mutation"]
    };
  }
  if (options.mode === "full") {
    return {
      enabled: true,
      operators: config.mutation.operators,
      minScore: config.mutation.minScore,
      reasons: ["full mode"]
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
