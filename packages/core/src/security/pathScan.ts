import path from "node:path";
import { access, readdir, readFile } from "node:fs/promises";
import { writeJson } from "../utils/files.js";

export type PathLeakScanStatus = "passed" | "failed";

export interface PathLeakFinding {
  file: string;
  patternId: string;
  excerpt: string;
}

export interface PathLeakScanReport {
  schemaVersion: "visual-hive.path-leak-scan.v1";
  generatedAt: string;
  rootDir: string;
  status: PathLeakScanStatus;
  summary: {
    filesScanned: number;
    findings: number;
  };
  scannedFiles: string[];
  findings: PathLeakFinding[];
}

export interface ScanIssueFacingPathsOptions {
  rootDir: string;
  artifactRoot?: string;
  outputPath?: string;
  now?: Date;
}

const PATH_LEAK_PATTERNS = [
  { id: "windows-user-path", pattern: /\b[A-Za-z]:\\Users\\[^\s"'`<>)\]]+/gi },
  { id: "windows-user-slash-path", pattern: /\b[A-Za-z]:\/Users\/[^\s"'`<>)\]]+/gi },
  { id: "onedrive-path", pattern: /\b[A-Za-z]:[\\/][^\s"'`<>)\]]*OneDrive[^\s"'`<>)\]]*/gi },
  { id: "posix-users-path", pattern: /\/Users\/[^\s"'`<>)\]]+/gi },
  { id: "posix-home-path", pattern: /\/home\/[^\s"'`<>)\]]+/gi },
  { id: "drive-letter-path", pattern: /(?:^|[^A-Za-z])([A-Za-z]:[\\/][^\s"'`<>)\]]+)/gi }
] as const;

const ISSUE_FACING_BASENAMES = new Set([
  "issues.json",
  "issues.md",
  "issue-queue.json",
  "issue-publish-plan.json",
  "issue-publish-dry-run.json",
  "issue-publish-result.json",
  "setup-issue.md",
  "setup-issue-publish-plan.json",
  "setup-issue-publish-dry-run.json",
  "setup-issue-publish-result.json",
  "handoff.json",
  "hive-issue.md",
  "hive-bead-request.json",
  "hive-handoff-result.json",
  "hive-handoff-validation.json",
  "evidence-packet.json",
  "agent-validation.json",
  "artifacts-index.json",
  "mcp-manifest.json",
  "control-plane-snapshot.json",
  "github-app-webhook-result.json",
  "github-app-issue-preview.md",
  "github-app-setup-issue-preview.md"
]);

const AGENT_ARTIFACT_BASENAMES = new Set([
  "agent-request.md",
  "agent-output.md",
  "agent-run.json",
  "write-preview.json"
]);

export async function scanIssueFacingPaths(options: ScanIssueFacingPathsOptions): Promise<{ report: PathLeakScanReport; outputPath?: string }> {
  const rootDir = path.resolve(options.rootDir);
  const artifactRoot = path.resolve(rootDir, options.artifactRoot ?? ".visual-hive");
  const files = (await exists(artifactRoot)) ? await collectIssueFacingFiles(rootDir, artifactRoot) : [];
  const findings: PathLeakFinding[] = [];

  for (const filePath of files) {
    const text = await readFile(filePath, "utf8").catch(() => "");
    for (const { id, pattern } of PATH_LEAK_PATTERNS) {
      pattern.lastIndex = 0;
      for (const match of text.matchAll(pattern)) {
        const value = match[1] ?? match[0];
        findings.push({
          file: repoRelative(rootDir, filePath),
          patternId: id,
          excerpt: excerpt(value)
        });
      }
    }
  }

  const report: PathLeakScanReport = {
    schemaVersion: "visual-hive.path-leak-scan.v1",
    generatedAt: (options.now ?? new Date()).toISOString(),
    rootDir: ".",
    status: findings.length === 0 ? "passed" : "failed",
    summary: {
      filesScanned: files.length,
      findings: findings.length
    },
    scannedFiles: files.map((file) => repoRelative(rootDir, file)).sort(),
    findings
  };

  if (options.outputPath) {
    const outputPath = path.resolve(rootDir, options.outputPath);
    await writeJson(outputPath, report);
    return { report, outputPath };
  }
  return { report };
}

async function collectIssueFacingFiles(rootDir: string, artifactRoot: string): Promise<string[]> {
  const files: string[] = [];
  await visit(artifactRoot, files);
  return files
    .filter((filePath) => shouldScan(rootDir, filePath))
    .sort((left, right) => repoRelative(rootDir, left).localeCompare(repoRelative(rootDir, right)));
}

async function visit(current: string, files: string[]): Promise<void> {
  const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const fullPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      await visit(fullPath, files);
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
}

function shouldScan(rootDir: string, filePath: string): boolean {
  const normalized = repoRelative(rootDir, filePath);
  const basename = path.basename(normalized);
  if (!/\.(json|md)$/i.test(basename)) return false;
  if (ISSUE_FACING_BASENAMES.has(basename)) return true;
  if (normalized.includes("/agents/") && AGENT_ARTIFACT_BASENAMES.has(basename)) return true;
  if (normalized.includes("/github-app-artifact-smoke/") && ISSUE_FACING_BASENAMES.has(basename)) return true;
  return false;
}

function repoRelative(rootDir: string, filePath: string): string {
  return path.relative(rootDir, filePath).replaceAll(path.sep, "/") || ".";
}

function excerpt(value: string): string {
  const normalized = value.replace(/\s+/g, " ");
  if (normalized.length <= 180) return normalized;
  return `${normalized.slice(0, 177)}...`;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
