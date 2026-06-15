import type { CostClass, Plan, PlanMode } from "../planner/types.js";
import { createPlan } from "../planner/createPlan.js";
import type { VisualHiveConfig } from "../config/schema.js";
import { sanitizeText } from "../utils/sanitize.js";

export interface ScheduleAuditReport {
  schemaVersion: 1;
  project: string;
  generatedAt: string;
  changedFiles: string[];
  summary: ScheduleAuditSummary;
  lanes: ScheduleLane[];
  targetSchedules: TargetSchedule[];
  gaps: ScheduleGap[];
  recommendations: string[];
}

export interface ScheduleAuditSummary {
  contractCount: number;
  pullRequestContracts: number;
  scheduledContracts: number;
  protectedContracts: number;
  protectedScheduledContracts: number;
  targetsWithCronSchedules: number;
  mutationEnabled: boolean;
  mutationScheduled: boolean;
  missingSecretNames: number;
  highSeverityGaps: number;
}

export interface ScheduleLane {
  id: "pull_request" | "scheduled" | "protected" | "mutation" | "trusted_issue";
  label: string;
  trigger: string;
  command: string;
  safeForPullRequest: boolean;
  usesSecrets: boolean;
  mode?: PlanMode;
  targetIds: string[];
  contractIds: string[];
  excludedContractIds: string[];
  costs: CostClass[];
  requiresSecrets: string[];
  missingSecrets: string[];
  warnings: string[];
  recommendations: string[];
}

export interface TargetSchedule {
  targetId: string;
  kind: VisualHiveConfig["targets"][string]["kind"];
  schedule?: string;
  prSafe: boolean;
  cost: CostClass;
  contractIds: string[];
  scheduledContractIds: string[];
  requiresSecrets: string[];
  missingSecrets: string[];
}

export interface ScheduleGap {
  kind:
    | "pr_lane_unsafe_target"
    | "protected_target_pr_safe"
    | "protected_target_without_schedule"
    | "protected_contract_not_scheduled"
    | "schedule_contract_on_pr_only_target"
    | "mutation_not_scheduled"
    | "missing_protected_secret"
    | "target_schedule_without_contracts";
  severity: "low" | "medium" | "high";
  message: string;
  targetId?: string;
  contractId?: string;
  laneId?: ScheduleLane["id"];
}

export interface AuditSchedulesOptions {
  changedFiles?: string[];
  env?: NodeJS.ProcessEnv;
  now?: Date;
}

export function auditSchedules(config: VisualHiveConfig, options: AuditSchedulesOptions = {}): ScheduleAuditReport {
  const env = options.env ?? process.env;
  const changedFiles = options.changedFiles ?? [];
  const prPlan = createPlan(config, { mode: "pr", changedFiles, now: options.now });
  const schedulePlan = createPlan(config, { mode: "schedule", changedFiles, now: options.now });
  const protectedContracts = config.contracts.filter((contract) => config.targets[contract.target]?.kind === "protected");
  const protectedScheduledContracts = protectedContracts.filter((contract) => contract.runOn.schedule);
  const targetSchedules = collectTargetSchedules(config, env);
  const lanes = collectLanes(config, prPlan, schedulePlan, targetSchedules);
  const gaps = collectGaps(config, prPlan, targetSchedules);

  return {
    schemaVersion: 1,
    project: config.project.name,
    generatedAt: (options.now ?? new Date()).toISOString(),
    changedFiles,
    summary: {
      contractCount: config.contracts.length,
      pullRequestContracts: config.contracts.filter((contract) => contract.runOn.pullRequest).length,
      scheduledContracts: config.contracts.filter((contract) => contract.runOn.schedule).length,
      protectedContracts: protectedContracts.length,
      protectedScheduledContracts: protectedScheduledContracts.length,
      targetsWithCronSchedules: targetSchedules.filter((target) => Boolean(target.schedule)).length,
      mutationEnabled: config.mutation.enabled,
      mutationScheduled: config.mutation.enabled && config.mutation.runOn.schedule,
      missingSecretNames: targetSchedules.reduce((sum, target) => sum + target.missingSecrets.length, 0),
      highSeverityGaps: gaps.filter((gap) => gap.severity === "high").length
    },
    lanes,
    targetSchedules,
    gaps,
    recommendations: recommendationsFor(gaps)
  };
}

function collectLanes(
  config: VisualHiveConfig,
  prPlan: Plan,
  schedulePlan: Plan,
  targetSchedules: TargetSchedule[]
): ScheduleLane[] {
  const protectedContractIds = new Set(
    config.contracts.filter((contract) => config.targets[contract.target]?.kind === "protected").map((contract) => contract.id)
  );
  const protectedTargets = targetSchedules.filter((target) => target.kind === "protected");
  const protectedScheduledContractIds = schedulePlan.items
    .filter((item) => protectedContractIds.has(item.contractId))
    .map((item) => item.contractId)
    .sort();

  return [
    {
      id: "pull_request",
      label: "Pull request lane",
      trigger: "pull_request",
      command: "visual-hive plan --mode pr && visual-hive run --ci && visual-hive triage && visual-hive report --github-step-summary",
      safeForPullRequest: true,
      usesSecrets: false,
      mode: "pr",
      targetIds: prPlan.targets.map((target) => target.id).sort(),
      contractIds: prPlan.items.map((item) => item.contractId).sort(),
      excludedContractIds: prPlan.excluded.map((item) => item.contractId).sort(),
      costs: unique(prPlan.targets.map((target) => target.cost)).sort(),
      requiresSecrets: [],
      missingSecrets: [],
      warnings: prPlan.excluded.length ? ["Some contracts are excluded from PR because their targets are not PR-safe."] : [],
      recommendations: [
        "Keep this workflow on pull_request with contents: read.",
        "Do not pass secrets to PR execution.",
        "Upload .visual-hive artifacts for trusted follow-up workflows."
      ]
    },
    {
      id: "scheduled",
      label: "Scheduled lane",
      trigger: "schedule + workflow_dispatch",
      command: "visual-hive plan --mode schedule && visual-hive run --ci && visual-hive mutate --enforce-min-score && visual-hive triage && visual-hive report --github-step-summary",
      safeForPullRequest: false,
      usesSecrets: protectedTargets.some((target) => target.requiresSecrets.length > 0),
      mode: "schedule",
      targetIds: schedulePlan.targets.map((target) => target.id).sort(),
      contractIds: schedulePlan.items.map((item) => item.contractId).sort(),
      excludedContractIds: schedulePlan.excluded.map((item) => item.contractId).sort(),
      costs: unique(schedulePlan.targets.map((target) => target.cost)).sort(),
      requiresSecrets: unique(protectedTargets.flatMap((target) => target.requiresSecrets)).sort(),
      missingSecrets: unique(protectedTargets.flatMap((target) => target.missingSecrets)).sort(),
      warnings: protectedTargets.length ? ["Scheduled runs may use protected secrets and must not execute untrusted PR code."] : [],
      recommendations: ["Use protected environments for secret-backed targets.", "Run mutation adequacy here when it is too expensive for PRs."]
    },
    {
      id: "protected",
      label: "Protected target lane",
      trigger: "workflow_dispatch or trusted schedule",
      command: "visual-hive plan --mode schedule && visual-hive run --ci",
      safeForPullRequest: false,
      usesSecrets: protectedTargets.some((target) => target.requiresSecrets.length > 0),
      mode: "schedule",
      targetIds: protectedTargets.map((target) => target.targetId).sort(),
      contractIds: protectedScheduledContractIds,
      excludedContractIds: [],
      costs: unique(protectedTargets.map((target) => target.cost)).sort(),
      requiresSecrets: unique(protectedTargets.flatMap((target) => target.requiresSecrets)).sort(),
      missingSecrets: unique(protectedTargets.flatMap((target) => target.missingSecrets)).sort(),
      warnings: protectedTargets.some((target) => target.prSafe) ? ["A protected target is marked PR-safe; review this before enabling workflows."] : [],
      recommendations: [
        "Keep protected targets out of pull_request workflows.",
        "Show required secret names only; never print values.",
        "Use manual dispatch for expensive live-environment checks."
      ]
    },
    {
      id: "mutation",
      label: "Mutation adequacy lane",
      trigger: config.mutation.runOn.schedule ? "schedule + workflow_dispatch" : "manual",
      command: "visual-hive mutate --enforce-min-score",
      safeForPullRequest: false,
      usesSecrets: false,
      mode: config.mutation.runOn.schedule ? "schedule" : "manual",
      targetIds: schedulePlan.mutation.enabled ? schedulePlan.targets.map((target) => target.id).sort() : [],
      contractIds: schedulePlan.mutation.enabled ? schedulePlan.items.map((item) => item.contractId).sort() : [],
      excludedContractIds: [],
      costs: schedulePlan.mutation.enabled ? unique(schedulePlan.targets.map((target) => target.cost)).sort() : [],
      requiresSecrets: [],
      missingSecrets: [],
      warnings: !config.mutation.enabled
        ? ["Mutation testing is disabled."]
        : config.mutation.runOn.schedule
          ? []
          : ["Mutation testing is enabled but not scheduled."],
      recommendations: ["Use mutation score as a deterministic adequacy signal, not as LLM output."]
    },
    {
      id: "trusted_issue",
      label: "Trusted failure issue lane",
      trigger: "workflow_run",
      command: "visual-hive triage && visual-hive report --github-step-summary",
      safeForPullRequest: false,
      usesSecrets: true,
      targetIds: [],
      contractIds: [],
      excludedContractIds: [],
      costs: [],
      requiresSecrets: ["GITHUB_TOKEN"],
      missingSecrets: [],
      warnings: ["This lane should consume sanitized artifacts and must not checkout or execute PR code."],
      recommendations: ["Use workflow_run for issue creation and dedupe by failure signature."]
    }
  ];
}

function collectTargetSchedules(config: VisualHiveConfig, env: NodeJS.ProcessEnv): TargetSchedule[] {
  const contractsByTarget = new Map<string, string[]>();
  const scheduledContractsByTarget = new Map<string, string[]>();
  for (const targetId of Object.keys(config.targets)) {
    contractsByTarget.set(targetId, []);
    scheduledContractsByTarget.set(targetId, []);
  }
  for (const contract of config.contracts) {
    contractsByTarget.get(contract.target)?.push(contract.id);
    if (contract.runOn.schedule) {
      scheduledContractsByTarget.get(contract.target)?.push(contract.id);
    }
  }

  return Object.entries(config.targets)
    .map(([targetId, target]) => {
      const requiresSecrets = target.kind === "protected" ? target.requiresSecrets.map((name) => sanitizeText(name)) : [];
      return {
        targetId,
        kind: target.kind,
        schedule: target.schedule ? sanitizeText(target.schedule) : undefined,
        prSafe: target.prSafe,
        cost: target.cost,
        contractIds: (contractsByTarget.get(targetId) ?? []).sort(),
        scheduledContractIds: (scheduledContractsByTarget.get(targetId) ?? []).sort(),
        requiresSecrets,
        missingSecrets: requiresSecrets.filter((name) => !env[name])
      };
    })
    .sort((a, b) => a.targetId.localeCompare(b.targetId));
}

function collectGaps(config: VisualHiveConfig, prPlan: Plan, targetSchedules: TargetSchedule[]): ScheduleGap[] {
  const gaps: ScheduleGap[] = [];
  for (const excluded of prPlan.excluded) {
    gaps.push({
      kind: "pr_lane_unsafe_target",
      severity: "high",
      targetId: excluded.targetId,
      contractId: excluded.contractId,
      laneId: "pull_request",
      message: `Contract "${excluded.contractId}" is PR-related but target "${excluded.targetId}" is not PR-safe.`
    });
  }
  for (const target of targetSchedules) {
    if (target.kind === "protected" && target.prSafe) {
      gaps.push({
        kind: "protected_target_pr_safe",
        severity: "high",
        targetId: target.targetId,
        laneId: "protected",
        message: `Protected target "${target.targetId}" is marked PR-safe.`
      });
    }
    if (target.kind === "protected" && !target.schedule && target.scheduledContractIds.length > 0) {
      gaps.push({
        kind: "protected_target_without_schedule",
        severity: "medium",
        targetId: target.targetId,
        laneId: "protected",
        message: `Protected target "${target.targetId}" has scheduled contracts but no target schedule string.`
      });
    }
    for (const secretName of target.missingSecrets) {
      gaps.push({
        kind: "missing_protected_secret",
        severity: "medium",
        targetId: target.targetId,
        laneId: "protected",
        message: `Protected target "${target.targetId}" is missing required environment variable name: ${secretName}.`
      });
    }
    if (target.schedule && target.contractIds.length === 0) {
      gaps.push({
        kind: "target_schedule_without_contracts",
        severity: "medium",
        targetId: target.targetId,
        laneId: "scheduled",
        message: `Target "${target.targetId}" has a schedule but no contracts.`
      });
    }
  }

  for (const contract of config.contracts) {
    const target = config.targets[contract.target];
    if (target.kind === "protected" && !contract.runOn.schedule) {
      gaps.push({
        kind: "protected_contract_not_scheduled",
        severity: "medium",
        targetId: contract.target,
        contractId: contract.id,
        laneId: "protected",
        message: `Protected contract "${contract.id}" is not enabled for schedule runs.`
      });
    }
    if (contract.runOn.schedule && target.prSafe && !contract.runOn.pullRequest && target.cost === "cheap") {
      gaps.push({
        kind: "schedule_contract_on_pr_only_target",
        severity: "low",
        targetId: contract.target,
        contractId: contract.id,
        laneId: "scheduled",
        message: `Contract "${contract.id}" is schedule-only on a cheap PR-safe target; consider whether it should also run on PR.`
      });
    }
  }

  if (config.mutation.enabled && !config.mutation.runOn.schedule) {
    gaps.push({
      kind: "mutation_not_scheduled",
      severity: "low",
      laneId: "mutation",
      message: "Mutation testing is enabled but not scheduled."
    });
  }

  return gaps.sort((a, b) => `${rank(b.severity)}:${a.kind}:${a.message}`.localeCompare(`${rank(a.severity)}:${b.kind}:${b.message}`));
}

function recommendationsFor(gaps: ScheduleGap[]): string[] {
  const recommendations = new Set<string>();
  recommendations.add("Keep PR workflows read-only and secret-free.");
  recommendations.add("Use workflow_run or scheduled trusted workflows for issue creation.");
  for (const gap of gaps) {
    if (gap.kind === "pr_lane_unsafe_target") recommendations.add("Move unsafe contracts out of the PR lane or require explicit trusted execution.");
    if (gap.kind === "protected_target_pr_safe") recommendations.add("Set protected targets to prSafe: false.");
    if (gap.kind === "protected_target_without_schedule") recommendations.add("Add a schedule to protected targets that have scheduled contracts.");
    if (gap.kind === "protected_contract_not_scheduled") recommendations.add("Enable runOn.schedule for protected contracts or move them to a non-protected target.");
    if (gap.kind === "mutation_not_scheduled") recommendations.add("Schedule mutation adequacy if it should be enforced regularly.");
    if (gap.kind === "missing_protected_secret") recommendations.add("Configure missing secret names only in trusted environments.");
  }
  return [...recommendations];
}

function rank(severity: ScheduleGap["severity"]): number {
  return { low: 1, medium: 2, high: 3 }[severity];
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
