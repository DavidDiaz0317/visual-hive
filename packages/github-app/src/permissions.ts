export type GitHubAppPermissionAccess = "read" | "write" | "none";

export type GitHubAppPermissionName =
  | "metadata"
  | "contents"
  | "actions"
  | "checks"
  | "issues"
  | "pull_requests"
  | "workflows";

export interface GitHubAppPermissionEntry {
  name: GitHubAppPermissionName;
  access: GitHubAppPermissionAccess;
  requiredFor: string;
  justification: string;
}

export interface GitHubAppPermissionOptions {
  setupPullRequests?: boolean;
  directContentWrites?: boolean;
  directWorkflowWrites?: boolean;
}

export const BASE_VISUAL_HIVE_GITHUB_APP_PERMISSIONS: GitHubAppPermissionEntry[] = [
  {
    name: "metadata",
    access: "read",
    requiredFor: "installation and repository identity",
    justification: "Required by GitHub Apps and used to map installations to repositories."
  },
  {
    name: "contents",
    access: "read",
    requiredFor: "repo metadata and artifact context",
    justification: "Reads repository metadata and existing Visual Hive setup state; default app mode does not write files."
  },
  {
    name: "actions",
    access: "read",
    requiredFor: "trusted workflow_run artifact discovery",
    justification: "Downloads Visual Hive artifacts produced by trusted workflows without executing PR code."
  },
  {
    name: "checks",
    access: "read",
    requiredFor: "validation state",
    justification: "Reads check conclusions to attach deterministic validation context to issues."
  },
  {
    name: "issues",
    access: "write",
    requiredFor: "issue-centric routing",
    justification: "Creates and updates Visual Hive issues from sanitized artifacts."
  }
];

export function getVisualHiveGitHubAppPermissions(options: GitHubAppPermissionOptions = {}): GitHubAppPermissionEntry[] {
  const permissions = [...BASE_VISUAL_HIVE_GITHUB_APP_PERMISSIONS];
  permissions.push({
    name: "pull_requests",
    access: options.setupPullRequests ? "write" : "none",
    requiredFor: "optional setup PR flow",
    justification: options.setupPullRequests
      ? "Only needed when the app opens a setup PR for config/workflow files."
      : "Not needed for issue-only setup."
  });
  permissions.push({
    name: "contents",
    access: options.directContentWrites ? "write" : "read",
    requiredFor: "optional direct setup writes",
    justification: options.directContentWrites
      ? "Only needed if the app writes setup files directly; setup PR is preferred."
      : "Read-only contents are enough for issue-centric routing."
  });
  permissions.push({
    name: "workflows",
    access: options.directWorkflowWrites ? "write" : "none",
    requiredFor: "optional direct workflow writes",
    justification: options.directWorkflowWrites
      ? "Only needed if the app writes workflow files directly; setup PR is preferred."
      : "Not needed unless workflow files are written directly."
  });
  return collapsePermissions(permissions);
}

export function assertLeastPrivilegePermissions(permissions: GitHubAppPermissionEntry[]): { passed: boolean; findings: string[] } {
  const findings: string[] = [];
  for (const permission of permissions) {
    if (permission.name === "workflows" && permission.access === "write") {
      findings.push("workflows:write is high impact; prefer a setup PR unless direct workflow writes are explicitly required.");
    }
    if (permission.name === "contents" && permission.access === "write") {
      findings.push("contents:write is not part of the default issue-centric model; prefer issue or setup PR routing.");
    }
    if (permission.name === "pull_requests" && permission.access === "write" && !permission.requiredFor.includes("setup")) {
      findings.push("pull_requests:write must be limited to setup PR flow.");
    }
  }
  return { passed: findings.length === 0, findings };
}

function collapsePermissions(entries: GitHubAppPermissionEntry[]): GitHubAppPermissionEntry[] {
  const rank: Record<GitHubAppPermissionAccess, number> = { none: 0, read: 1, write: 2 };
  const byName = new Map<GitHubAppPermissionName, GitHubAppPermissionEntry>();
  for (const entry of entries) {
    const previous = byName.get(entry.name);
    if (!previous || rank[entry.access] > rank[previous.access]) {
      byName.set(entry.name, entry);
    }
  }
  return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
}
