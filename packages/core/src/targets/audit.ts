import type { VisualHiveConfig } from "../config/schema.js";
import type { Plan } from "../planner/types.js";
import type { Report, TargetLifecycleEvent } from "../reports/types.js";
import { sanitizeText } from "../utils/sanitize.js";
import { resolveTargetUrl } from "./resolve.js";

export interface TargetAuditReport {
  schemaVersion: 1;
  project: string;
  generatedAt: string;
  mode?: Plan["mode"] | Report["mode"];
  summary: TargetAuditSummary;
  targets: TargetAuditEntry[];
}

export interface TargetAuditSummary {
  targetCount: number;
  prSafeTargets: number;
  protectedTargets: number;
  commandTargets: number;
  commandGroupTargets: number;
  deployPreviewTargets: number;
  storybookTargets: number;
  scheduledTargets: number;
  expensiveTargets: number;
  setupRequiredTargets: number;
  targetsRequiringSecrets: number;
  missingSecretNames: number;
  targetsWithContracts: number;
  targetsWithoutContracts: number;
  selectedTargets: number;
  targetsWithFailedLifecycle: number;
}

export interface TargetAuditEntry {
  id: string;
  kind: VisualHiveConfig["targets"][string]["kind"];
  url: string;
  prSafe: boolean;
  cost: VisualHiveConfig["targets"][string]["cost"];
  schedule?: string;
  labels: Array<"Safe on PR" | "Protected" | "Expensive" | "Schedule-only" | "Needs setup">;
  requiresSecrets: string[];
  missingSecrets: string[];
  commands: {
    install?: string;
    build?: string;
    serve?: string;
    setup: string[];
    teardown: string[];
  };
  services: TargetServiceAudit[];
  readinessChecks: Array<{ name: string; url: string; readinessTimeoutMs?: number }>;
  contractIds: string[];
  selectedContractIds: string[];
  selected: boolean;
  latestStatus: "passed" | "failed" | "not_run";
  lifecycleEvents: TargetLifecycleEvent[];
  gaps: TargetAuditGap[];
  recommendations: string[];
}

export interface TargetServiceAudit {
  name: string;
  command: string;
  url: string;
  healthPath?: string;
  readinessUrl: string;
  readinessTimeoutMs?: number;
}

export interface TargetAuditGap {
  kind:
    | "target_without_contracts"
    | "protected_missing_secret"
    | "protected_pr_safe"
    | "pr_contract_on_unsafe_target"
    | "setup_target_not_run"
    | "failed_lifecycle"
    | "missing_readiness_timeout"
    | "deploy_preview_url_unresolved"
    | "storybook_without_component_scope"
    | "expensive_pr_safe";
  severity: "low" | "medium" | "high";
  message: string;
}

export interface AuditTargetsOptions {
  plan?: Plan;
  report?: Report;
  env?: NodeJS.ProcessEnv;
  now?: Date;
}

export function auditTargets(config: VisualHiveConfig, options: AuditTargetsOptions = {}): TargetAuditReport {
  const env = options.env ?? process.env;
  const selectedTargetIds = new Set(options.plan?.targets.map((target) => target.id) ?? options.report?.selectedTargets.map((target) => target.id) ?? []);
  const selectedContractIds = new Set(options.plan?.items.map((item) => item.contractId) ?? options.report?.selectedContracts ?? []);
  const contractsByTarget = new Map<string, string[]>();
  for (const targetId of Object.keys(config.targets)) {
    contractsByTarget.set(targetId, []);
  }
  for (const contract of config.contracts) {
    contractsByTarget.get(contract.target)?.push(contract.id);
  }

  const targets = Object.entries(config.targets)
    .map(([id, target]) => {
      const contractIds = contractsByTarget.get(id) ?? [];
      const selectedContracts = contractIds.filter((contractId) => selectedContractIds.has(contractId));
      const lifecycleEvents = sanitizeLifecycle((options.report?.targetLifecycle ?? []).filter((event) => event.targetId === id));
      const missingSecrets = target.kind === "protected" ? target.requiresSecrets.filter((name) => !env[name]) : [];
      const services = target.kind === "commandGroup" || target.kind === "protected" ? target.services.map(serviceAudit) : [];
      const resolvedUrl = resolveTargetUrl(target, env);
      const targetResults = (options.report?.results ?? []).filter((result) => result.targetId === id);
      const commands = {
        install: target.kind === "command" || target.kind === "storybook" ? sanitizeText(target.install ?? "") || undefined : undefined,
        build: target.kind === "command" || target.kind === "storybook" ? sanitizeText(target.build ?? "") || undefined : undefined,
        serve: target.kind === "command" ? sanitizeText(target.serve) : target.kind === "storybook" ? sanitizeText(target.serve ?? "") || undefined : undefined,
        setup: target.kind === "commandGroup" || target.kind === "protected" ? target.setup.map((command) => sanitizeText(command)) : [],
        teardown: target.kind === "commandGroup" || target.kind === "protected" ? target.teardown.map((command) => sanitizeText(command)) : []
      };
      const selected = selectedTargetIds.has(id);
      const latestStatus = lifecycleEvents.some((event) => event.status === "failed") || targetResults.some((result) => result.status === "failed")
        ? "failed"
        : lifecycleEvents.some((event) => event.status === "passed" || event.status === "stopped") ||
            targetResults.some((result) => result.status === "passed" || result.status === "created")
          ? "passed"
          : "not_run";
      const gaps = collectGaps({
        id,
        target,
        contractIds,
        config,
        missingSecrets,
        lifecycleEvents,
        selected,
        services,
        resolvedUrlReason: resolvedUrl.url ? undefined : resolvedUrl.reason
      });

      return {
        id,
        kind: target.kind,
        url: sanitizeText(resolvedUrl.url ?? ""),
        prSafe: target.prSafe,
        cost: target.cost,
        schedule: target.schedule,
        labels: labelsFor(target),
        requiresSecrets: target.kind === "protected" ? target.requiresSecrets.map((name) => sanitizeText(name)) : [],
        missingSecrets: missingSecrets.map((name) => sanitizeText(name)),
        commands,
        services,
        readinessChecks: services.map((service) => ({
          name: service.name,
          url: service.readinessUrl,
          readinessTimeoutMs: service.readinessTimeoutMs
        })),
        contractIds,
        selectedContractIds: selectedContracts,
        selected,
        latestStatus,
        lifecycleEvents,
        gaps,
        recommendations: recommendationsFor(id, gaps)
      } satisfies TargetAuditEntry;
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  return {
    schemaVersion: 1,
    project: config.project.name,
    generatedAt: (options.now ?? new Date()).toISOString(),
    mode: options.plan?.mode ?? options.report?.mode,
    summary: {
      targetCount: targets.length,
      prSafeTargets: targets.filter((target) => target.prSafe).length,
      protectedTargets: targets.filter((target) => target.kind === "protected").length,
      commandTargets: targets.filter((target) => target.kind === "command").length,
      commandGroupTargets: targets.filter((target) => target.kind === "commandGroup").length,
      deployPreviewTargets: targets.filter((target) => target.kind === "deployPreview").length,
      storybookTargets: targets.filter((target) => target.kind === "storybook").length,
      scheduledTargets: targets.filter((target) => Boolean(target.schedule)).length,
      expensiveTargets: targets.filter((target) => target.cost === "expensive").length,
      setupRequiredTargets: targets.filter((target) => target.labels.includes("Needs setup")).length,
      targetsRequiringSecrets: targets.filter((target) => target.requiresSecrets.length > 0).length,
      missingSecretNames: targets.reduce((sum, target) => sum + target.missingSecrets.length, 0),
      targetsWithContracts: targets.filter((target) => target.contractIds.length > 0).length,
      targetsWithoutContracts: targets.filter((target) => target.contractIds.length === 0).length,
      selectedTargets: targets.filter((target) => target.selected).length,
      targetsWithFailedLifecycle: targets.filter((target) => target.lifecycleEvents.some((event) => event.status === "failed")).length
    },
    targets
  };
}

function serviceAudit(service: { name: string; command: string; url: string; healthPath?: string; readinessTimeoutMs?: number }): TargetServiceAudit {
  const readinessUrl = service.healthPath ? new URL(service.healthPath, service.url).toString() : service.url;
  return {
    name: service.name,
    command: sanitizeText(service.command),
    url: sanitizeText(service.url),
    healthPath: service.healthPath,
    readinessUrl: sanitizeText(readinessUrl),
    readinessTimeoutMs: service.readinessTimeoutMs
  };
}

function sanitizeLifecycle(events: TargetLifecycleEvent[]): TargetLifecycleEvent[] {
  return events.map((event) => ({
    ...event,
    command: event.command ? sanitizeText(event.command) : undefined,
    url: event.url ? sanitizeText(event.url) : undefined,
    message: event.message ? sanitizeText(event.message) : undefined
  }));
}

function labelsFor(target: VisualHiveConfig["targets"][string]): TargetAuditEntry["labels"] {
  const labels: TargetAuditEntry["labels"] = [];
  if (target.prSafe) labels.push("Safe on PR");
  if (target.kind === "protected") labels.push("Protected");
  if (target.cost === "expensive") labels.push("Expensive");
  if (target.schedule) labels.push("Schedule-only");
  if (
    target.kind === "command" ||
    target.kind === "commandGroup" ||
    (target.kind === "storybook" && Boolean(target.install || target.build || target.serve)) ||
    (target.kind === "protected" && target.services.length > 0)
  ) {
    labels.push("Needs setup");
  }
  return labels;
}

function collectGaps(input: {
  id: string;
  target: VisualHiveConfig["targets"][string];
  contractIds: string[];
  config: VisualHiveConfig;
  missingSecrets: string[];
  lifecycleEvents: TargetLifecycleEvent[];
  selected: boolean;
  services: TargetServiceAudit[];
  resolvedUrlReason?: string;
}): TargetAuditGap[] {
  const gaps: TargetAuditGap[] = [];
  if (input.contractIds.length === 0) {
    gaps.push({
      kind: "target_without_contracts",
      severity: "medium",
      message: `Target "${input.id}" has no contracts.`
    });
  }
  if (input.target.kind === "protected" && input.missingSecrets.length > 0) {
    gaps.push({
      kind: "protected_missing_secret",
      severity: "medium",
      message: `Protected target "${input.id}" is missing required environment variable names: ${input.missingSecrets.join(", ")}.`
    });
  }
  if (input.target.kind === "protected" && input.target.prSafe) {
    gaps.push({
      kind: "protected_pr_safe",
      severity: "high",
      message: `Protected target "${input.id}" should not be marked prSafe.`
    });
  }
  if (input.target.kind === "deployPreview" && input.resolvedUrlReason) {
    gaps.push({
      kind: "deploy_preview_url_unresolved",
      severity: "medium",
      message: `Deploy preview target "${input.id}" has no resolvable URL: ${sanitizeText(input.resolvedUrlReason)}`
    });
  }
  if (input.target.kind === "storybook" && input.target.stories.length === 0 && input.target.components.length === 0) {
    gaps.push({
      kind: "storybook_without_component_scope",
      severity: "low",
      message: `Storybook target "${input.id}" does not declare stories or component globs.`
    });
  }
  const prContracts = input.config.contracts.filter((contract) => contract.target === input.id && contract.runOn.pullRequest);
  if (!input.target.prSafe && prContracts.length > 0) {
    gaps.push({
      kind: "pr_contract_on_unsafe_target",
      severity: "high",
      message: `Target "${input.id}" has pull-request contracts but is not PR safe.`
    });
  }
  const needsSetup =
    input.target.kind === "command" ||
    input.target.kind === "commandGroup" ||
    (input.target.kind === "storybook" && Boolean(input.target.install || input.target.build || input.target.serve)) ||
    (input.target.kind === "protected" && input.target.services.length > 0);
  if (needsSetup && input.selected && input.lifecycleEvents.length === 0) {
    gaps.push({
      kind: "setup_target_not_run",
      severity: "low",
      message: `Target "${input.id}" was selected but has no lifecycle evidence in the latest report.`
    });
  }
  if (input.lifecycleEvents.some((event) => event.status === "failed")) {
    gaps.push({
      kind: "failed_lifecycle",
      severity: "high",
      message: `Target "${input.id}" has failed lifecycle events in the latest report.`
    });
  }
  for (const service of input.services.filter((service) => service.readinessTimeoutMs === undefined)) {
    gaps.push({
      kind: "missing_readiness_timeout",
      severity: "low",
      message: `Service "${service.name}" on target "${input.id}" has no explicit readinessTimeoutMs.`
    });
  }
  if (input.target.prSafe && input.target.cost === "expensive") {
    gaps.push({
      kind: "expensive_pr_safe",
      severity: "medium",
      message: `Target "${input.id}" is expensive but PR safe; consider moving it to schedule/manual if cost matters.`
    });
  }
  return gaps.sort((a, b) => `${rank(b.severity)}:${a.kind}`.localeCompare(`${rank(a.severity)}:${b.kind}`));
}

function recommendationsFor(targetId: string, gaps: TargetAuditGap[]): string[] {
  const recommendations: string[] = [];
  for (const gap of gaps) {
    if (gap.kind === "target_without_contracts") recommendations.push(`Add at least one contract for target "${targetId}" or remove the unused target.`);
    if (gap.kind === "protected_missing_secret") recommendations.push(`Configure the missing environment variables only in trusted scheduled/manual workflows.`);
    if (gap.kind === "protected_pr_safe") recommendations.push(`Set target "${targetId}" prSafe to false.`);
    if (gap.kind === "pr_contract_on_unsafe_target") recommendations.push(`Move PR contracts off "${targetId}" or require --allow-unsafe-targets only in trusted runs.`);
    if (gap.kind === "setup_target_not_run") recommendations.push(`Run visual-hive run so install/build/service lifecycle evidence is captured for "${targetId}".`);
    if (gap.kind === "failed_lifecycle") recommendations.push(`Inspect target lifecycle events and server logs for "${targetId}".`);
    if (gap.kind === "missing_readiness_timeout") recommendations.push(`Set readinessTimeoutMs for services on "${targetId}" to make startup failures clearer.`);
    if (gap.kind === "deploy_preview_url_unresolved") recommendations.push(`Set the deploy preview URL environment variable or configure fallbackUrl for "${targetId}".`);
    if (gap.kind === "storybook_without_component_scope") recommendations.push(`Add stories or component globs to "${targetId}" so component visual coverage can be audited.`);
    if (gap.kind === "expensive_pr_safe") recommendations.push(`Review whether "${targetId}" should be schedule-only or manual.`);
  }
  return [...new Set(recommendations)];
}

function rank(severity: TargetAuditGap["severity"]): number {
  return { low: 1, medium: 2, high: 3 }[severity];
}
