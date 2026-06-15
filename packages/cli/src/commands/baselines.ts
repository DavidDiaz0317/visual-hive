import path from "node:path";
import {
  approveBaseline,
  listBaselines,
  loadConfig,
  type BaselineApproval,
  type BaselineCandidate,
  type BaselineList
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

export function formatBaselineList(list: BaselineList): string {
  if (list.entries.length === 0) {
    return `No screenshot baselines found in ${list.reportPath}`;
  }
  const rows = list.entries.map(formatBaselineRow).join("\n");
  return [`Baselines from ${list.reportPath}`, rows, `Approval log: ${list.approvalLogPath}`].join("\n");
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
  const action = entry.canApprove ? "approve-ready" : "review-only";
  return `- ${entry.contractId}/${entry.screenshotName} route=${entry.route} viewport=${entry.viewport} status=${entry.status} ${action}${approval}`;
}
