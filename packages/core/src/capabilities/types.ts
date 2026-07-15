export type CapabilityRuntimeStatus = "supported" | "blocked";

export interface CliCapability {
  path: string;
  aliases: string[];
  /** SHA-256 of the canonical positional-argument and option contract. */
  contractSha256: string;
}

export interface SchemaCapability {
  filename: string;
  id: string;
  /** SHA-256 of canonical JSON, so the complete schema body is frozen. */
  sha256: string;
}

export interface EvidenceResourceCapability {
  id: string;
  uri: string;
  relativePath: string;
  readTool?: string;
}

export interface ArtifactSurfaceCapability {
  path: string;
  /** SHA-256 of the surface kind, diagnostic roles, and evidence-resource binding. */
  contractSha256: string;
  runtimeStatus: CapabilityRuntimeStatus;
}

export interface PlanModeCapability {
  mode: string;
  runtimeStatus: CapabilityRuntimeStatus;
  blockedReason?: string;
}

export interface WorkflowLaneCapability {
  id: string;
  kind: "execution" | "template";
  laneId: string;
  path?: string;
  /** Present for generated templates and bound to normalized template contents. */
  sha256?: string;
  runtimeStatus: CapabilityRuntimeStatus;
  blockedReason?: string;
}

export interface ProviderCapability {
  id: string;
  category: string;
  deterministicRole: string;
  supportedOperations: string[];
  operations: ProviderOperationCapability[];
  runtimeStatus: CapabilityRuntimeStatus;
  blockedReason?: string;
}

export interface ProviderOperationCapability {
  operation: string;
  runtimeStatus: CapabilityRuntimeStatus;
  blockedReason?: string;
}

export interface MutationOperatorCapability {
  id: string;
  description: string;
  relevantSelectors: string[];
  recommendedContracts: string[];
  expectedFailureKinds: string[];
  defaultHeuristic: string;
  runtimeStatus: CapabilityRuntimeStatus;
}

export interface DeterministicPrimitiveCapability {
  id: string;
  kind: "selector_assertion" | "flow_action";
  runtimeStatus: CapabilityRuntimeStatus;
}

export interface OpenSourceAdapterCapability {
  id: string;
  version: string;
  license: string;
  command: string;
  runtimeStatus: CapabilityRuntimeStatus;
  blockedReason?: string;
}

export interface ControlPlaneCapability {
  method: "GET" | "POST";
  path: string;
  runtimeStatus: CapabilityRuntimeStatus;
  blockedReason?: string;
}

export interface CapabilityInventory {
  cli: CliCapability[];
  schemas: SchemaCapability[];
  evidenceResources: EvidenceResourceCapability[];
  artifactSurfaces: ArtifactSurfaceCapability[];
  planModes: PlanModeCapability[];
  workflowLanes: WorkflowLaneCapability[];
  mutationOperators: MutationOperatorCapability[];
  deterministicPrimitives: DeterministicPrimitiveCapability[];
  providers: ProviderCapability[];
  openSourceAdapters: OpenSourceAdapterCapability[];
  controlPlane: ControlPlaneCapability[];
}

export type CapabilityDomain = keyof CapabilityInventory;
export type CapabilityCheckStatus = "present" | "blocked" | "missing" | "unexpected" | "mismatched";

export interface CapabilityParityCheck {
  domain: CapabilityDomain;
  key: string;
  status: CapabilityCheckStatus;
  parity: boolean;
  message: string;
  expected?: Record<string, unknown>;
  actual?: Record<string, unknown>;
}

export interface CapabilityDomainSummary {
  domain: CapabilityDomain;
  expected: number;
  actual: number;
  present: number;
  blocked: number;
  missing: number;
  unexpected: number;
  mismatched: number;
}

export interface CapabilityParityReport {
  schemaVersion: "visual-hive.capability-parity.v1";
  baselineVersion: "visual-hive.capability-baseline.v1";
  generatedAt: string;
  status: "passed" | "failed";
  runtimeStatus: "ready" | "blocked";
  summary: {
    expected: number;
    actual: number;
    present: number;
    blocked: number;
    missing: number;
    unexpected: number;
    mismatched: number;
  };
  domains: CapabilityDomainSummary[];
  checks: CapabilityParityCheck[];
}
