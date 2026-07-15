import { createHash } from "node:crypto";
import { artifactKind, artifactLabelsForPath } from "./index.js";
import { VISUAL_HIVE_EVIDENCE_RESOURCES } from "../tools/evidenceResources.js";
import type { ArtifactSurfaceCapability } from "../capabilities/types.js";

export const VISUAL_HIVE_ARTIFACT_SURFACE_PATHS = [
  ".visual-hive/adapters/lifecycle-plan.json",
  ".visual-hive/adapters/odiff-result.json",
  ".visual-hive/adapters/vrt-result.json",
  ".visual-hive/agent-packet.json",
  ".visual-hive/agents",
  ".visual-hive/agents/*/agent-output.md",
  ".visual-hive/agents/*/agent-request.md",
  ".visual-hive/agents/*/agent-run.json",
  ".visual-hive/agents/*/write-preview.json",
  ".visual-hive/agent-validation.json",
  ".visual-hive/artifacts",
  ".visual-hive/artifacts/diffs",
  ".visual-hive/artifacts/diffs/**",
  ".visual-hive/artifacts/screenshots",
  ".visual-hive/artifacts/screenshots/**",
  ".visual-hive/artifacts-index.json",
  ".visual-hive/baseline-approvals.json",
  ".visual-hive/baseline-bootstrap.md",
  ".visual-hive/baseline-rejections.json",
  ".visual-hive/baseline-review.md",
  ".visual-hive/baselines.json",
  ".visual-hive/bundles",
  ".visual-hive/bundles/*/files/**",
  ".visual-hive/bundles/*/manifest.json",
  ".visual-hive/capability-parity.json",
  ".visual-hive/config-edits.json",
  ".visual-hive/connections.json",
  ".visual-hive/connections-portfolio.json",
  ".visual-hive/context-ledger.json",
  ".visual-hive/control-plane-actions.json",
  ".visual-hive/contracts.json",
  ".visual-hive/control-plane-snapshot.json",
  ".visual-hive/costs.json",
  ".visual-hive/coverage.json",
  ".visual-hive/coverage-recommendations.json",
  ".visual-hive/evidence-packet.json",
  ".visual-hive/evidence-summary.md",
  ".visual-hive/flows.json",
  ".visual-hive/generated/visual-hive.generated.spec.ts",
  ".visual-hive/github-app-issue-preview.md",
  ".visual-hive/github-app-live-publish-result.json",
  ".visual-hive/github-app-live-smoke-result.json",
  ".visual-hive/github-app-setup-issue-preview.md",
  ".visual-hive/github-app-webhook-result.json",
  ".visual-hive/handoff.json",
  ".visual-hive/handoff-agent-packet.json",
  ".visual-hive/history",
  ".visual-hive/history/*/baseline-review.md",
  ".visual-hive/history/*/contracts.json",
  ".visual-hive/history/*/coverage.json",
  ".visual-hive/history/*/flows.json",
  ".visual-hive/history/*/issue.md",
  ".visual-hive/history/*/llm-usage.json",
  ".visual-hive/history/*/missing-tests.md",
  ".visual-hive/history/*/mutation-report.json",
  ".visual-hive/history/*/plan.json",
  ".visual-hive/history/*/pr-comment.md",
  ".visual-hive/history/*/repair-prompt.md",
  ".visual-hive/history/*/report.json",
  ".visual-hive/history/*/schedules.json",
  ".visual-hive/history/*/targets.json",
  ".visual-hive/history/*/triage-prompt.md",
  ".visual-hive/history/*/triage.json",
  ".visual-hive/history.json",
  ".visual-hive/hive",
  ".visual-hive/hive/beads.json",
  ".visual-hive/hive/guarded-repair-preview.json",
  ".visual-hive/hive/guarded-repair-preview.md",
  ".visual-hive/hive/hive-agent-policy.json",
  ".visual-hive/hive/hive-agent-work-orders.json",
  ".visual-hive/hive/hive-beads.json",
  ".visual-hive/hive/hive-export.json",
  ".visual-hive/hive/hive-import-manifest.json",
  ".visual-hive/hive/hive-setup-pack.json",
  ".visual-hive/hive/hive-validation-summary.json",
  ".visual-hive/hive/issue-context.md",
  ".visual-hive/hive/knowledge-facts.json",
  ".visual-hive/hive/knowledge-graph.json",
  ".visual-hive/hive/mode-comparison.json",
  ".visual-hive/hive/mode-comparison.md",
  ".visual-hive/hive/modes",
  ".visual-hive/hive/modes/*/**",
  ".visual-hive/hive/repair-request-envelope.json",
  ".visual-hive/hive/repair-request-envelope.md",
  ".visual-hive/hive/repair-work-orders.json",
  ".visual-hive/hive/trusted-repair-consumer-summary.json",
  ".visual-hive/hive/trusted-repair-consumer-summary.md",
  ".visual-hive/hive/trusted-repair-workflow-dry-run.json",
  ".visual-hive/hive/trusted-repair-workflow-dry-run.md",
  ".visual-hive/hive/wiki",
  ".visual-hive/hive/wiki/*.md",
  ".visual-hive/hive/wiki-index.json",
  ".visual-hive/hive-bead-request.json",
  ".visual-hive/hive-handoff-result.json",
  ".visual-hive/hive-handoff-validation.json",
  ".visual-hive/hive-issue.md",
  ".visual-hive/hive-issue-dry-run.json",
  ".visual-hive/issue.md",
  ".visual-hive/issue-publish-dry-run.json",
  ".visual-hive/issue-publish-plan.json",
  ".visual-hive/issue-publish-result.json",
  ".visual-hive/issue-queue.json",
  ".visual-hive/issues.json",
  ".visual-hive/issues.md",
  ".visual-hive/issue-suppressions.json",
  ".visual-hive/llm-decisions.json",
  ".visual-hive/llm-usage.json",
  ".visual-hive/mcp-manifest.json",
  ".visual-hive/missing-tests.md",
  ".visual-hive/mutation-report.json",
  ".visual-hive/path-leak-scan.json",
  ".visual-hive/pipeline.json",
  ".visual-hive/plan*.json",
  ".visual-hive/plan.canary.json",
  ".visual-hive/plan.full.json",
  ".visual-hive/plan.json",
  ".visual-hive/plans.json",
  ".visual-hive/pr-comment.md",
  ".visual-hive/provider-agent-packet.json",
  ".visual-hive/provider-decisions.json",
  ".visual-hive/provider-handoff.json",
  ".visual-hive/provider-results.json",
  ".visual-hive/provider-setup-plan.json",
  ".visual-hive/provider-upload/argos",
  ".visual-hive/provider-upload/argos/manifest.json",
  ".visual-hive/provider-upload/argos/screenshots/**",
  ".visual-hive/readiness.json",
  ".visual-hive/recommendations.json",
  ".visual-hive/repair-prompt.md",
  ".visual-hive/repo-context.md",
  ".visual-hive/repo-map.json",
  ".visual-hive/report.json",
  ".visual-hive/risk.json",
  ".visual-hive/runbook.json",
  ".visual-hive/schedules.json",
  ".visual-hive/schema-catalog.json",
  ".visual-hive/security.json",
  ".visual-hive/setup-bundle-edits.json",
  ".visual-hive/setup-doc-edits.json",
  ".visual-hive/setup-issue.md",
  ".visual-hive/setup-issue-candidate.json",
  ".visual-hive/setup-issue-publish-dry-run.json",
  ".visual-hive/setup-issue-publish-plan.json",
  ".visual-hive/setup-issue-publish-result.json",
  ".visual-hive/setup-pr-plan.json",
  ".visual-hive/setup-progress.json",
  ".visual-hive/snapshots",
  ".visual-hive/snapshots/**",
  ".visual-hive/targets.json",
  ".visual-hive/test-creation-plan.json",
  ".visual-hive/test-creation-plan.md",
  ".visual-hive/testing-layers.json",
  ".visual-hive/testing-layers.md",
  ".visual-hive/tools/tool-cards.md",
  ".visual-hive/tools/tool-registry.json",
  ".visual-hive/triage.json",
  ".visual-hive/triage-prompt.md",
  ".visual-hive/verdict.json",
  ".visual-hive/verdict.md",
  ".visual-hive/visual-graph.json",
  ".visual-hive/visual-graph-summary.md",
  ".visual-hive/visual-graph-unresolved.json",
  ".visual-hive/visual-graph-vocab.json",
  ".visual-hive/visual-impact.json",
  ".visual-hive/workflow-edits.json",
  ".visual-hive/workflows.json"
] as const;

const DIRECTORY_SURFACES = new Set<string>([
  ".visual-hive/agents",
  ".visual-hive/artifacts",
  ".visual-hive/artifacts/diffs",
  ".visual-hive/artifacts/screenshots",
  ".visual-hive/bundles",
  ".visual-hive/history",
  ".visual-hive/hive",
  ".visual-hive/hive/modes",
  ".visual-hive/hive/wiki",
  ".visual-hive/provider-upload/argos",
  ".visual-hive/snapshots"
]);

export function listArtifactSurfaceCapabilities(): ArtifactSurfaceCapability[] {
  const resources = new Map(VISUAL_HIVE_EVIDENCE_RESOURCES.map((resource) => [resource.relativePath.replaceAll("\\", "/"), resource]));
  return VISUAL_HIVE_ARTIFACT_SURFACE_PATHS.map((artifactPath) => {
    const evidenceResource = resources.get(artifactPath);
    const surfaceKind = artifactPath.includes("*") ? "pattern" : DIRECTORY_SURFACES.has(artifactPath) ? "directory" : "file";
    const kind = surfaceKind === "directory" ? "other" : artifactKind(artifactPath);
    const roles = artifactLabelsForPath(artifactPath, kind);
    roles.push(...dynamicRoles(artifactPath));
    if (evidenceResource) roles.push("evidence-resource", evidenceResource.id);
    const contract = {
      surfaceKind,
      artifactKind: kind,
      roles: [...new Set(roles)].sort(),
      producerContract: producerContractFor(artifactPath),
      ...(evidenceResource
        ? {
            evidenceResourceId: evidenceResource.id,
            evidenceResourceUri: evidenceResource.uri,
            evidenceReadTool: evidenceResource.readTool?.name ?? null
          }
        : {})
    };
    return {
      path: artifactPath,
      contractSha256: createHash("sha256").update(stableJson(contract)).digest("hex"),
      runtimeStatus: "supported" as const
    };
  }).sort((left, right) => left.path.localeCompare(right.path));
}

function dynamicRoles(artifactPath: string): string[] {
  if (artifactPath === ".visual-hive/plan*.json") return ["plan", "plan-sidecar"];
  if (artifactPath.startsWith(".visual-hive/agents/*/")) return ["agent-issue-run"];
  if (artifactPath.startsWith(".visual-hive/bundles/*/")) return ["hive-bundle"];
  if (artifactPath.startsWith(".visual-hive/history/*/")) return ["history"];
  if (artifactPath.startsWith(".visual-hive/hive/modes/*/")) return ["hive-mode-preview"];
  if (artifactPath === ".visual-hive/hive/wiki/*.md") return ["hive-wiki"];
  if (artifactPath.startsWith(".visual-hive/artifacts/screenshots/")) return ["screenshot"];
  if (artifactPath.startsWith(".visual-hive/artifacts/diffs/")) return ["visual-diff"];
  if (artifactPath.startsWith(".visual-hive/snapshots/")) return ["baseline"];
  if (artifactPath.startsWith(".visual-hive/provider-upload/argos/screenshots/")) return ["provider-upload", "screenshot"];
  return [];
}

function producerContractFor(artifactPath: string): string {
  if (artifactPath.startsWith(".visual-hive/agents/*/")) return "agent-issue-runner";
  if (artifactPath.startsWith(".visual-hive/bundles/*/")) return "hive-bundle-writer";
  if (artifactPath.startsWith(".visual-hive/history/*/")) return "run-history-writer";
  if (artifactPath.startsWith(".visual-hive/hive/modes/*/")) return "hive-mode-comparison-writer";
  if (artifactPath === ".visual-hive/hive/wiki/*.md") return "hive-export-writer";
  if (artifactPath.startsWith(".visual-hive/artifacts/screenshots/") || artifactPath.startsWith(".visual-hive/artifacts/diffs/")) return "deterministic-runner";
  if (artifactPath.startsWith(".visual-hive/snapshots/")) return "playwright-baseline-store";
  if (artifactPath.startsWith(".visual-hive/provider-upload/argos/screenshots/")) return "guarded-argos-upload";
  if (artifactPath.startsWith(".visual-hive/github-app-")) return "github-app-diagnostics";
  if (artifactPath.startsWith(".visual-hive/control-plane-") || artifactPath.endsWith("-edits.json")) return "control-plane-audit";
  return "declared-fixed-output";
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
