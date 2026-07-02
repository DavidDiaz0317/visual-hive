import { spawn, execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { promisify } from "node:util";
import type { SetupRecommendationReport } from "@visual-hive/core";

export interface RepoAnalyzerOptions {
  report: SetupRecommendationReport;
  claudePath?: string;
  model?: string;
}

export interface ContractSuggestion {
  id: string;
  targetId: string;
  route: string;
  screenshotName: string;
  selectors: string[];
  rationale: string;
}

export interface RepoAnalysis {
  callsMade: number;
  model: string;
  inputTruncated: boolean;
  priorityRoutes: string[];
  contractSuggestions: ContractSuggestion[];
  coverageGaps: string[];
  enhancedConfigYaml: string;
  rawResponse: string;
}

export class RepoAnalysisApiError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "RepoAnalysisApiError";
  }
}

const ROUTE_LIMIT = 30;
const SELECTOR_LIMIT = 40;
const STORY_LIMIT = 20;

const DEFAULT_CLAUDE_PATHS = [
  "claude",
  "/usr/local/bin/claude",
  "/usr/bin/claude",
  `${process.env["HOME"] ?? ""}/.claude/local/claude`
];

function buildPrompt(report: SetupRecommendationReport): { prompt: string; truncated: boolean } {
  const { project, detectedRoutes, detectedSelectors, detectedStories, recommendedTarget, recommendedContracts, recommendedConfigYaml } = report;

  const truncated =
    detectedRoutes.length > ROUTE_LIMIT ||
    detectedSelectors.length > SELECTOR_LIMIT ||
    detectedStories.length > STORY_LIMIT;

  const inventory = {
    projectName: project.name,
    frameworks: project.detectedFrameworks,
    packageManager: project.packageManager,
    targetUrl: recommendedTarget.url,
    targetId: recommendedTarget.id,
    detectedRoutes: detectedRoutes.slice(0, ROUTE_LIMIT).map((r) => r.route),
    detectedSelectors: detectedSelectors.slice(0, SELECTOR_LIMIT).map((s) => s.selector),
    storybookStories: detectedStories.slice(0, STORY_LIMIT).map((s) => `${s.title} (${s.route})`),
    existingContracts: recommendedContracts.map((c) => ({ id: c.id, selectors: c.selectors, screenshots: c.screenshots })),
    note: truncated
      ? `Inventory truncated to first ${ROUTE_LIMIT} routes, ${SELECTOR_LIMIT} selectors, ${STORY_LIMIT} stories.`
      : undefined
  };

  const prompt = `You are a visual regression testing expert. Analyze this repository inventory and return ONLY a valid JSON object — no markdown, no explanation, no prose before or after the JSON.

Important: LLM output is advisory only. Deterministic Playwright contracts are the only pass/fail oracle.

Rules:
- Prefer routes and selectors already detected in the repo over invented ones.
- Use kebab-case for contract IDs (e.g. "home-page-shell").
- Screenshot names must be lowercase with hyphens.
- Suggest 3-6 high-value contracts. Focus on: auth/login, main navigation, dashboard, forms, error states.

Return exactly this JSON shape:
{
  "priorityRoutes": ["max 8 most important routes to test visually"],
  "contractSuggestions": [
    {
      "id": "kebab-case-id",
      "targetId": "target id from inventory",
      "route": "/path",
      "screenshotName": "descriptive-name",
      "selectors": ["data-testid selectors that must exist"],
      "rationale": "why this contract matters"
    }
  ],
  "coverageGaps": ["max 5 important UI areas not yet covered"],
  "enhancedConfigYaml": "full visual-hive.config.yaml content with contracts improved"
}

Repository inventory:
${JSON.stringify(inventory, null, 2)}

Existing config YAML to improve:
${recommendedConfigYaml}`;

  return { prompt, truncated };
}

function extractJsonFromResult(text: string): string {
  // Try the whole text first
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return trimmed;

  // Extract from a fenced code block if the model wrapped it despite instructions
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch?.[1]) return fenceMatch[1].trim();

  // Find the first { ... } block
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) return trimmed.slice(start, end + 1);

  return trimmed;
}

function isContractSuggestion(value: unknown): value is ContractSuggestion {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["id"] === "string" &&
    typeof v["targetId"] === "string" &&
    typeof v["route"] === "string" &&
    typeof v["screenshotName"] === "string" &&
    Array.isArray(v["selectors"]) &&
    (v["selectors"] as unknown[]).every((s) => typeof s === "string") &&
    typeof v["rationale"] === "string"
  );
}

function parseAnalysisResult(
  raw: string,
  fallbackYaml: string
): Pick<RepoAnalysis, "priorityRoutes" | "contractSuggestions" | "coverageGaps" | "enhancedConfigYaml"> {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(extractJsonFromResult(raw)) as Record<string, unknown>;
  } catch {
    throw new RepoAnalysisApiError(
      `Claude responded but output could not be parsed as JSON.\nRaw response:\n${raw}`
    );
  }

  const enhancedConfigYaml = typeof parsed["enhancedConfigYaml"] === "string" ? parsed["enhancedConfigYaml"] : fallbackYaml;

  return {
    priorityRoutes: Array.isArray(parsed["priorityRoutes"])
      ? (parsed["priorityRoutes"] as unknown[]).filter((r): r is string => typeof r === "string")
      : [],
    contractSuggestions: Array.isArray(parsed["contractSuggestions"])
      ? (parsed["contractSuggestions"] as unknown[]).filter(isContractSuggestion)
      : [],
    coverageGaps: Array.isArray(parsed["coverageGaps"])
      ? (parsed["coverageGaps"] as unknown[]).filter((g): g is string => typeof g === "string")
      : [],
    enhancedConfigYaml
  };
}

function runClaudeCli(cliPath: string, prompt: string, model: string | undefined): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--max-turns",
      "1",
      ...(model ? ["--model", model] : []),
      "--",
      prompt
    ];

    const child = spawn(cliPath, args, { windowsHide: true });

    const stdoutLines: string[] = [];
    const stderrChunks: string[] = [];

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      for (const line of chunk.split("\n")) {
        if (line.trim()) stdoutLines.push(line.trim());
      }
    });

    child.stderr.on("data", (chunk: string) => stderrChunks.push(chunk));

    child.on("error", (err: Error) => reject(new RepoAnalysisApiError(`Failed to start Claude CLI at "${cliPath}": ${err.message}`, err)));

    child.on("close", (code: number | null) => {
      // Parse JSONL and find the result event
      for (const line of stdoutLines) {
        try {
          const event = JSON.parse(line) as Record<string, unknown>;
          if (event["type"] === "result" && event["subtype"] === "success" && typeof event["result"] === "string") {
            resolve(event["result"]);
            return;
          }
          if (event["type"] === "result" && event["subtype"] !== "success") {
            reject(new RepoAnalysisApiError(`Claude CLI returned a non-success result: ${JSON.stringify(event)}`));
            return;
          }
        } catch {
          // not valid JSON — skip
        }
      }

      // If no result event found, fall back to assembling assistant text blocks
      const textParts: string[] = [];
      for (const line of stdoutLines) {
        try {
          const event = JSON.parse(line) as Record<string, unknown>;
          if (event["type"] === "assistant") {
            const msg = event["message"] as Record<string, unknown> | undefined;
            const content = msg?.["content"];
            if (Array.isArray(content)) {
              for (const block of content as Record<string, unknown>[]) {
                if (block["type"] === "text" && typeof block["text"] === "string") {
                  textParts.push(block["text"]);
                }
              }
            }
          }
        } catch {
          // skip
        }
      }

      if (textParts.length > 0) {
        resolve(textParts.join(""));
        return;
      }

      const stderr = stderrChunks.join("").trim();
      reject(
        new RepoAnalysisApiError(
          `Claude CLI exited with code ${code} and no parseable result.${stderr ? `\nstderr: ${stderr}` : ""}`
        )
      );
    });
  });
}

const execFileAsync = promisify(execFile);

async function findClaudeCli(preferred?: string): Promise<string> {
  const candidates = preferred ? [preferred, ...DEFAULT_CLAUDE_PATHS] : DEFAULT_CLAUDE_PATHS;

  for (const candidate of candidates) {
    try {
      if (candidate === "claude") {
        await execFileAsync("claude", ["--version"], { timeout: 5000 });
        return "claude";
      }
      await access(candidate);
      return candidate;
    } catch {
      // try next
    }
  }

  throw new RepoAnalysisApiError(
    `Claude CLI not found. Install it with: npm install -g @anthropic-ai/claude-code\nSearched: ${candidates.join(", ")}`
  );
}

export async function analyzeRepo(options: RepoAnalyzerOptions): Promise<RepoAnalysis> {
  const { report, claudePath, model } = options;

  const cliPath = await findClaudeCli(claudePath);
  const { prompt, truncated } = buildPrompt(report);

  let rawResponse: string;
  try {
    rawResponse = await runClaudeCli(cliPath, prompt, model);
  } catch (err) {
    if (err instanceof RepoAnalysisApiError) throw err;
    const detail = err instanceof Error ? err.message : String(err);
    throw new RepoAnalysisApiError(`Claude CLI invocation failed: ${detail}`, err);
  }

  const parsed = parseAnalysisResult(rawResponse, report.recommendedConfigYaml);

  return {
    callsMade: 1,
    model: model ?? "default",
    inputTruncated: truncated,
    rawResponse,
    ...parsed
  };
}
