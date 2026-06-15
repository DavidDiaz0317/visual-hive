import path from "node:path";
import { indexArtifacts, loadConfig, writeJson, type ArtifactIndexReport } from "@visual-hive/core";

export interface ArtifactsCommandOptions {
  config?: string;
  cwd?: string;
  format?: "markdown" | "json";
  maxArtifacts?: number;
  maxPreviewBytes?: number;
}

export async function runArtifactsCommand(options: ArtifactsCommandOptions = {}): Promise<{ index: ArtifactIndexReport; indexPath: string }> {
  const cwd = options.cwd ?? process.cwd();
  const loaded = await loadConfig(options.config, cwd);
  const hiveRoot = path.join(loaded.rootDir, ".visual-hive");
  const index = await indexArtifacts({
    repoRoot: loaded.rootDir,
    hiveRoot,
    project: loaded.config.project.name,
    maxArtifacts: options.maxArtifacts,
    maxPreviewBytes: options.maxPreviewBytes
  });
  const indexPath = path.join(hiveRoot, "artifacts-index.json");
  await writeJson(indexPath, index);
  return { index, indexPath };
}

export function formatArtifactsIndex(index: ArtifactIndexReport, indexPath: string, format: "markdown" | "json" = "markdown"): string {
  if (format === "json") {
    return JSON.stringify(index, null, 2);
  }
  const lines = [
    `Wrote ${indexPath}`,
    `# Artifact Index: ${index.project}`,
    "",
    `- Artifacts: ${index.summary.artifactCount}`,
    `- Total bytes: ${index.summary.totalBytes}`,
    `- JSON: ${index.summary.json}`,
    `- Markdown: ${index.summary.markdown}`,
    `- Images: ${index.summary.image}`,
    `- TypeScript/specs: ${index.summary.typescript}`,
    `- Previewed: ${index.summary.previewed}`,
    `- Redacted previews: ${index.summary.redactedPreviews}`,
    `- Truncated previews: ${index.summary.truncatedPreviews}`,
    "",
    "## Artifacts"
  ];
  for (const artifact of index.artifacts.slice(0, 12)) {
    const labels = artifact.labels.length ? ` labels=${artifact.labels.join(",")}` : "";
    lines.push(`- ${artifact.path} (${artifact.kind}, ${artifact.bytes} bytes)${labels}`);
  }
  if (index.artifacts.length > 12) {
    lines.push(`- ... ${index.artifacts.length - 12} more artifact(s)`);
  }
  if (index.warnings.length) {
    lines.push("", "## Warnings", ...index.warnings.map((warning) => `- ${warning}`));
  }
  return lines.join("\n");
}
