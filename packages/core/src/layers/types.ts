import type { EvidencePacketTestingLayer } from "../evidence/types.js";

export interface TestingLayerReport {
  schemaVersion: 1;
  generatedAt: string;
  project: string;
  outputResource?: TestingLayerOutputResource;
  sourceArtifacts: {
    evidencePacket?: string;
    plan?: string;
    report?: string;
    mutationReport?: string;
    triageReport?: string;
    providerResults?: string;
    readiness?: string;
    coverage?: string;
    repoMap?: string;
    artifactsIndex?: string;
  };
  governance: {
    verdictAuthority: "visual_hive";
    defaultBrowserBackend: "playwright";
    agentAuthority: "advisory_only";
  };
  summary: {
    totalLayers: number;
    covered: number;
    partial: number;
    missing: number;
    notApplicable: number;
    unknown: number;
    gapCount: number;
    status: "covered" | "attention" | "missing_evidence";
  };
  layers: Array<
    EvidencePacketTestingLayer & {
      skippedReasons: string[];
      recommendedNextStep?: string;
    }
  >;
  recommendations: string[];
}

export interface TestingLayerOutputResource {
  artifactPath: string;
  evidenceResourceId: string;
  evidenceResourceUri: string;
  evidenceResourceTitle: string;
  evidenceResourceDescription: string;
  evidenceReadToolName?: string;
}
