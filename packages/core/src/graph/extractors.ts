import path from "node:path";
import type { RepoMapReport } from "../repo/types.js";
import type { VisualGraph, VisualGraphResolvedReference, VisualGraphUnresolvedReference, VisualHiveGraphExtractor } from "./types.js";

export interface VisualHiveGraphExtractorDefinition extends VisualHiveGraphExtractor {
  description: string;
  evidenceKinds: string[];
}

export const VISUAL_HIVE_GRAPH_EXTRACTORS: VisualHiveGraphExtractorDefinition[] = [
  {
    id: "visual-hive-config",
    description: "Extracts targets, contracts, screenshots, selectors, viewports, and mutation mappings from visual-hive.config.yaml.",
    evidenceKinds: ["config", "targets", "contracts", "screenshots", "mutation"],
    detect: (_context) => hasFile(_context.files, "visual-hive.config.yaml")
  },
  {
    id: "react-vite",
    description: "Extracts React component and Vite package signals from TSX/JSX source and package metadata.",
    evidenceKinds: ["file", "component", "route", "selector"],
    detect: (context) => context.files.some((file) => /\.(tsx|jsx)$/.test(file)) && context.files.some((file) => file.endsWith("package.json"))
  },
  {
    id: "react-router",
    description: "Extracts route hints from React route path literals and router-like source patterns.",
    evidenceKinds: ["route", "component", "layout"],
    detect: (context) => context.files.some((file) => /\.(tsx|jsx|ts|js)$/.test(file))
  },
  {
    id: "storybook",
    description: "Extracts component-library and story route hints from Storybook config, stories, or generated storybook artifacts.",
    evidenceKinds: ["component", "route", "screenshot", "target"],
    detect: (context) => context.files.some((file) => file.includes(".storybook") || /\.stories\.(tsx|jsx|ts|js|mdx)$/.test(file) || file.includes("storybook-static"))
  },
  {
    id: "github-actions",
    description: "Extracts workflow safety, command, trigger, artifact-upload, and trusted issue handoff evidence from GitHub Actions YAML.",
    evidenceKinds: ["workflow", "artifact", "issue_candidate"],
    detect: (context) => context.files.some((file) => file.replaceAll("\\", "/").startsWith(".github/workflows/"))
  },
  {
    id: "playwright-report-artifact",
    description: "Extracts deterministic contract result, selector, screenshot, console/page/network, and generated-spec evidence from report.json.",
    evidenceKinds: ["contract", "selector", "screenshot", "artifact"],
    detect: (context) => hasFile(context.files, ".visual-hive/report.json")
  },
  {
    id: "mutation-report-artifact",
    description: "Extracts mutation adequacy, killed/survived/not-applicable operators, affected surfaces, and validation commands from mutation-report.json.",
    evidenceKinds: ["mutation_operator", "contract", "issue_candidate"],
    detect: (context) => hasFile(context.files, ".visual-hive/mutation-report.json")
  },
  {
    id: "baseline-artifact",
    description: "Extracts baseline and visual artifact relationships from snapshot and screenshot artifact paths.",
    evidenceKinds: ["baseline", "screenshot", "artifact"],
    detect: (context) => context.files.some((file) => file.includes(".visual-hive/snapshots") || file.includes(".visual-hive/artifacts/screenshots"))
  },
  {
    id: "issue-artifact",
    description: "Extracts stable issue candidates, issue queue, owning agent hints, and trusted publication artifacts.",
    evidenceKinds: ["issue_candidate", "agent_profile", "artifact"],
    detect: (context) => hasFile(context.files, ".visual-hive/issues.json") || hasFile(context.files, ".visual-hive/issue-queue.json"),
    resolve: (reference: VisualGraphUnresolvedReference, context: { graph: VisualGraph }): VisualGraphResolvedReference | undefined => {
      if (reference.referenceKind !== "issue_to_artifact") return undefined;
      const artifact = context.graph.nodes.find((node) => node.kind === "artifact" && reference.candidates.some((candidate) => candidate.nodeId === node.id));
      if (!artifact) return undefined;
      return {
        id: `resolved:${reference.id}`,
        fromNodeId: reference.fromNodeId,
        referenceName: reference.referenceName,
        referenceKind: reference.referenceKind,
        targetNodeId: artifact.id,
        confidence: Math.max(reference.confidence, 0.7),
        resolvedBy: "exact_id"
      };
    },
    postExtract: (context) => context.graph
  }
];

export function detectVisualGraphExtractors(repoMap: RepoMapReport, artifacts: string[] = []): VisualHiveGraphExtractorDefinition[] {
  const files = graphDetectionFiles(repoMap, artifacts);
  return VISUAL_HIVE_GRAPH_EXTRACTORS.filter((extractor) => extractor.detect({ repoRoot: repoMap.repoRoot, files }));
}

export function graphDetectionFiles(repoMap: RepoMapReport, artifacts: string[] = []): string[] {
  return unique([
    "visual-hive.config.yaml",
    ...repoMap.packages.map((pkg) => pkg.path),
    ...repoMap.scripts.map((script) => script.packagePath),
    ...repoMap.selectors.map((selector) => selector.sourceFile),
    ...repoMap.routes.map((route) => route.sourceFile),
    ...repoMap.workflows.map((workflow) => workflow.path),
    ...repoMap.visualMap.nodes.flatMap((node) => node.sourceFiles),
    ...artifacts
  ]).map((file) => path.normalize(file).replaceAll("\\", "/"));
}

function hasFile(files: string[], target: string): boolean {
  const normalizedTarget = target.replaceAll("\\", "/");
  return files.some((file) => file.replaceAll("\\", "/").endsWith(normalizedTarget));
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
