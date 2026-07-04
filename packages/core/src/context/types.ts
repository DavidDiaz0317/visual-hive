export type ContextLedgerEscalationKind =
  | "trusted_tool"
  | "external_network"
  | "provider"
  | "llm"
  | "baseline"
  | "protected_target"
  | "budget";

export type ContextLedgerSeverity = "info" | "warning" | "blocked";

export interface ContextLedgerSourceArtifacts {
  toolRegistry?: string;
  agentPacket?: string;
  evidencePacket?: string;
  llmUsage?: string;
  providerResults?: string;
  providerUploadManifest?: string;
  pipeline?: string;
  artifactsIndex?: string;
  handoffPacket?: string;
  hiveBeadRequest?: string;
  hiveHandoffResult?: string;
  hiveHandoffValidation?: string;
  testCreationPlan?: string;
}

export interface ContextLedgerBudgets {
  maxToolCalls: number;
  maxToolResultTokens: number;
  maxExternalCostUsd: number;
  maxProviderScreenshots: number;
}

export interface ContextLedgerUsage {
  toolCallsUsed: number;
  estimatedToolResultTokens: number;
  estimatedPromptTokens: number;
  estimatedExternalCostUsd: number;
  providerScreenshots: number;
  externalCallsMade: number;
}

export interface ContextLedgerRemaining {
  toolCalls: number;
  toolResultTokens: number;
  externalCostUsd: number;
  providerScreenshots: number;
}

export interface ContextToolCall {
  id: string;
  source: "pipeline" | "tool-registry" | "agent-packet" | "handoff" | "manual";
  toolId: string;
  label: string;
  access: string;
  status: string;
  trustedOnly: boolean;
  externalNetwork: boolean;
  evidenceResourceId?: string;
  evidenceResourceUri?: string;
  evidenceResourceTitle?: string;
  evidenceResourceDescription?: string;
  evidenceReadToolName?: string;
  evidenceResources?: ContextEvidenceResourceLink[];
  estimatedResultTokens: number;
  artifacts: string[];
  reason: string;
}

export interface ContextEvidenceResourceLink {
  evidenceResourceId: string;
  evidenceResourceUri: string;
  evidenceResourceTitle: string;
  evidenceResourceDescription: string;
  evidenceReadToolName?: string;
  artifactPath: string;
}

export interface ContextProviderUsage {
  providerId: string;
  status: string;
  uploadStatus?: string;
  artifactCount: number;
  stagedArtifacts?: number;
  uploadedArtifacts?: number;
  estimatedExternalScreenshots: number;
  externalCallsMade: number;
  estimatedCostUsd: number;
  missingEnv: string[];
  blockedReasons: string[];
  artifacts: string[];
  manifestPath?: string;
  uploadDirectory?: string;
  command?: string;
  stdout?: string;
  stderr?: string;
  providerUrl?: string;
  dryRun?: boolean;
}

export interface ContextLlmUsage {
  task: string;
  promptOnly: boolean;
  callsMade: number;
  estimatedPromptTokens: number;
  estimatedCompletionTokens?: number;
  estimatedCostUsd: number;
  budgetStatus?: string;
  artifact?: string;
}

export interface ContextEscalation {
  kind: ContextLedgerEscalationKind;
  severity: ContextLedgerSeverity;
  reason: string;
  relatedToolIds: string[];
  artifacts: string[];
}

export interface ContextPolicyViolation {
  policy: string;
  severity: "warning" | "blocked";
  reason: string;
  artifacts: string[];
}

export interface ContextLedger {
  schemaVersion: "visual-hive.context-ledger.v1";
  generatedAt: string;
  project: string;
  sourceArtifacts: ContextLedgerSourceArtifacts;
  budgets: ContextLedgerBudgets;
  usage: ContextLedgerUsage;
  remaining: ContextLedgerRemaining;
  toolCalls: ContextToolCall[];
  providerUsage: ContextProviderUsage[];
  llmUsage: ContextLlmUsage[];
  escalations: ContextEscalation[];
  policyViolations: ContextPolicyViolation[];
  notes: string[];
}
