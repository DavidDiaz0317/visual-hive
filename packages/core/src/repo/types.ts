export type RepoPackageManager = "npm" | "pnpm" | "yarn" | "unknown";

export interface RepoScriptInfo {
  packagePath: string;
  name: string;
  command: string;
}

export interface RepoPackageInfo {
  path: string;
  name?: string;
  private?: boolean;
  workspaces: string[];
  scripts: RepoScriptInfo[];
  dependencyNames: string[];
}

export interface RepoSelectorHint {
  selector: string;
  sourceFile: string;
  occurrences: number;
}

export interface RepoRouteHint {
  route: string;
  sourceFile: string;
  occurrences: number;
}

export interface RepoWorkflowHint {
  path: string;
  triggers: string[];
  permissions: string[];
  usesPullRequestTarget: boolean;
  usesSecrets: boolean;
  uploadsArtifacts: boolean;
  visualHiveRelated: boolean;
}

export interface RepoTargetHint {
  id: string;
  kind: "command" | "commandGroup" | "storybook" | "deployPreview" | "url";
  confidence: "high" | "medium" | "low";
  command?: string;
  url?: string;
  evidence: string[];
}

export interface RepoRiskSignal {
  id: string;
  severity: "info" | "warning" | "high";
  message: string;
  evidence: string[];
  recommendation: string;
}

export interface RepoCoverageGap {
  id: string;
  layer: number;
  severity: "low" | "medium" | "high";
  message: string;
  suggestedArtifact: string;
}

export interface RepoMapOutputResource {
  artifactPath: string;
  evidenceResourceId: string;
  evidenceResourceUri: string;
  evidenceResourceTitle: string;
  evidenceResourceDescription: string;
  evidenceReadToolName?: string;
}

export interface RepoMapReport {
  schemaVersion: 1;
  generatedAt: string;
  repoRoot: string;
  outputResource?: RepoMapOutputResource;
  project: {
    name: string;
    packageManager: RepoPackageManager;
    workspaces: string[];
    frameworks: string[];
  };
  packages: RepoPackageInfo[];
  scripts: RepoScriptInfo[];
  sourceSummary: {
    scannedFiles: number;
    truncated: boolean;
    extensions: Record<string, number>;
  };
  selectors: RepoSelectorHint[];
  routes: RepoRouteHint[];
  workflows: RepoWorkflowHint[];
  testTools: string[];
  targetHints: RepoTargetHint[];
  riskSignals: RepoRiskSignal[];
  coverageGaps: RepoCoverageGap[];
  recommendations: string[];
}
