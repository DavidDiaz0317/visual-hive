export const CONTROL_PLANE_EXECUTABLE_COMMAND_IDS = [
  "doctor",
  "recommend",
  "plan-pr",
  "run-ci",
  "baselines",
  "coverage",
  "improve-coverage",
  "test-creation-plan",
  "triage-report",
  "mutate",
  "security",
  "costs",
  "providers",
  "provider-plan",
  "provider-handoff",
  "schemas-verify",
  "handoff-agent-packet",
  "provider-agent-packet",
  "readiness",
  "evidence",
  "verdict",
  "handoff",
  "hive-export",
  "hive-export-advisory",
  "hive-export-measured",
  "hive-export-repair-request",
  "hive-guarded-repair-preview",
  "hive-repair-request-envelope",
  "hive-trusted-repair-consumer-summary",
  "hive-trusted-repair-workflow-dry-run",
  "hive-compare-modes",
  "agent-packet",
  "pipeline",
  "connections-portfolio"
] as const;

const executableCommandIds = new Set<string>(CONTROL_PLANE_EXECUTABLE_COMMAND_IDS);

export function isControlPlaneExecutableCommandId(commandId: string): boolean {
  return executableCommandIds.has(commandId);
}
