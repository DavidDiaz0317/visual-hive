import path from "node:path";
import {
  approveBaseline,
  listBaselines,
  loadConfig,
  rejectBaseline,
  type BaselineApproval,
  type BaselineCandidate,
  type BaselineList,
  type BaselineRejection
} from "@visual-hive/core";

export interface BaselineCommandOptions {
  config?: string;
  report?: string;
  cwd?: string;
}

export interface BaselineApproveOptions extends BaselineCommandOptions {
  contractId: string;
  screenshotName: string;
  viewport?: string;
  route?: string;
}

export interface BaselineRejectOptions extends BaselineApproveOptions {
  reason?: string;
}

export async function runBaselineListCommand(options: BaselineCommandOptions = {}): Promise<BaselineList> {
  const resolved = await resolveBaselineCommandOptions(options);
  return listBaselines(resolved);
}

export async function runBaselineApproveCommand(options: BaselineApproveOptions): Promise<BaselineApproval> {
  const resolved = await resolveBaselineCommandOptions(options);
  return approveBaseline({
    ...resolved,
    contractId: options.contractId,
    screenshotName: options.screenshotName,
    viewport: options.viewport,
    route: options.route
  });
}

export async function runBaselineRejectCommand(options: BaselineRejectOptions): Promise<BaselineRejection> {
  const resolved = await resolveBaselineCommandOptions(options);
  return rejectBaseline({
    ...resolved,
    contractId: options.contractId,
    screenshotName: options.screenshotName,
    viewport: options.viewport,
    route: options.route,
    reason: options.reason
  });
}

export function formatBaselineList(list: BaselineList): string {
  if (list.entries.length === 0) {
    return `No screenshot baselines found in ${list.reportPath}`;
  }
  const rows = list.entries.map(formatBaselineRow).join("\n");
  return [`Baselines from ${list.reportPath}`, rows, `Approval log: ${list.approvalLogPath}`, `Rejection log: ${list.rejectionLogPath}`].join("\n");
}

export function formatBaselineApproval(approval: BaselineApproval): string {
  return [
    `Approved baseline ${approval.contractId}/${approval.screenshotName} (${approval.viewport} ${approval.route})`,
    `- actual: ${approval.actualPath}`,
    `- baseline: ${approval.baselinePath}`,
    `- bytes: ${approval.bytes}`,
    `- approvedAt: ${approval.approvedAt}`
  ].join("\n");
}

export function formatBaselineRejection(rejection: BaselineRejection): string {
  const reason = rejection.reason ? [`- reason: ${rejection.reason}`] : [];
  return [
    `Rejected baseline ${rejection.contractId}/${rejection.screenshotName} (${rejection.viewport} ${rejection.route})`,
    `- actual: ${rejection.actualPath}`,
    `- baseline: ${rejection.baselinePath}`,
    ...reason,
    `- rejectedAt: ${rejection.rejectedAt}`
  ].join("\n");
}

async function resolveBaselineCommandOptions(options: BaselineCommandOptions): Promise<{ repoRoot: string; reportPath: string }> {
  const cwd = options.cwd ?? process.cwd();
  const loaded = await loadConfig(options.config ?? "visual-hive.config.yaml", cwd);
  const reportPath = options.report ? path.resolve(cwd, options.report) : path.join(loaded.rootDir, ".visual-hive", "report.json");
  return {
    repoRoot: loaded.rootDir,
    reportPath
  };
}

function formatBaselineRow(entry: BaselineCandidate): string {
  const approval = entry.approvedAt ? ` approved=${entry.approvedAt}` : "";
  const rejection = entry.rejectedAt ? ` rejected=${entry.rejectedAt}` : "";
  const action = entry.canApprove || entry.canReject ? "review-ready" : "review-only";
  return `- ${entry.contractId}/${entry.screenshotName} route=${entry.route} viewport=${entry.viewport} status=${entry.status} ${action}${approval}${rejection}`;
}
