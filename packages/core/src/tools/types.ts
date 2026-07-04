export type ToolRole = "setup_agent" | "repair_agent" | "test_creator" | "review_agent" | "handoff_agent" | "provider_specialist";

export type ToolAccess = "read_only" | "local_execution" | "trusted_write" | "external_upload";

export type ToolKind = "first_party_cli" | "first_party_mcp" | "local_mcp" | "github_mcp" | "provider_mcp" | "external_provider";

export type ToolCostClass = "local" | "external_api" | "paid_provider";

export type ToolMode = "local" | "pr" | "pr_debug" | "schedule" | "manual" | "protected" | "trusted";

export interface ToolRegistryPolicy {
  defaultPolicy: "gated";
  exposeThirdPartyMcp: false;
  maxToolDefinitionsPerAgent: number;
  maxToolCallsPerTask: number;
  maxToolResultTokensPerTask: number;
  maxExternalCostUsdPerTask: 0;
  requireTrustedModeForWrites: true;
  requireTrustedModeForProviderMcp: true;
  githubWritesFromPr: false;
  externalUploadsFromPr: false;
  baselineApprovalByAgent: false;
  requireHumanApprovalFor: string[];
}

export interface ToolRegistryEntry {
  id: string;
  label: string;
  description: string;
  kind: ToolKind;
  enabled: boolean;
  defaultAccess: ToolAccess;
  costClass: ToolCostClass;
  trustedOnly: boolean;
  externalNetwork: boolean;
  forbiddenInPullRequest: boolean;
  requiresHumanApproval: string[];
  allowedRoles: ToolRole[];
  allowedModes: ToolMode[];
  command?: string;
  mcp?: {
    server: string;
    tool?: string;
    transport?: "stdio" | "http" | "remote";
    status: "available" | "planned" | "disabled";
  };
  reads: string[];
  writes: string[];
  writeRestrictions: string[];
  evidenceArtifacts: string[];
  evidenceResourceId?: string;
  evidenceResourceUri?: string;
  evidenceResourceTitle?: string;
  evidenceResourceDescription?: string;
  evidenceReadToolName?: string;
  notes: string[];
}

export interface ToolRoleProfile {
  role: ToolRole;
  purpose: string;
  trustedOnly: boolean;
  requiresBudget: boolean;
  allowedToolIds: string[];
  forbiddenActions: string[];
}

export interface ToolRegistry {
  schemaVersion: "visual-hive.tool-registry.v1";
  generatedAt: string;
  project: string;
  policy: ToolRegistryPolicy;
  tools: ToolRegistryEntry[];
  roleProfiles: ToolRoleProfile[];
  notes: string[];
}
