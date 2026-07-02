import Anthropic from "@anthropic-ai/sdk";
import type { SetupRecommendationReport } from "@visual-hive/core";

export interface RepoAnalyzerOptions {
  report: SetupRecommendationReport;
  apiKey: string;
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

const SYSTEM_PROMPT = `You are a visual regression testing expert helping teams adopt Playwright-based visual QA.
You analyze static code inventory data extracted from a repository and suggest concrete test contracts.

Rules:
- LLM output is advisory only. Deterministic Playwright contracts are the only pass/fail oracle.
- Prefer routes and selectors already detected in the repo over invented ones.
- Suggest minimal, high-value contracts — prefer quality over quantity.
- Use kebab-case for contract IDs (e.g. "home-page-shell").
- All screenshot names should be descriptive and lowercase with hyphens.
- Focus on: login/auth flows, main navigation, dashboards, forms, and error states.`;

const TOOL_NAME = "suggest_contracts";

const TOOL_SCHEMA: Anthropic.Tool = {
  name: TOOL_NAME,
  description: "Return structured visual regression contract suggestions for the given repository inventory.",
  input_schema: {
    type: "object" as const,
    required: ["priorityRoutes", "contractSuggestions", "coverageGaps", "enhancedConfigYaml"],
    properties: {
      priorityRoutes: {
        type: "array",
        items: { type: "string" },
        description: "Most important routes to test visually, max 8."
      },
      contractSuggestions: {
        type: "array",
        items: {
          type: "object",
          required: ["id", "targetId", "route", "screenshotName", "selectors", "rationale"],
          properties: {
            id: { type: "string", description: "kebab-case contract ID" },
            targetId: { type: "string", description: "target ID from the inventory" },
            route: { type: "string", description: "URL path for this contract" },
            screenshotName: { type: "string", description: "descriptive screenshot name with hyphens" },
            selectors: { type: "array", items: { type: "string" }, description: "data-testid selectors that must exist" },
            rationale: { type: "string", description: "why this contract matters" }
          }
        },
        description: "3-6 high-value test contracts."
      },
      coverageGaps: {
        type: "array",
        items: { type: "string" },
        description: "Important UI areas not yet covered by suggested contracts, max 5."
      },
      enhancedConfigYaml: {
        type: "string",
        description: "Full visual-hive.config.yaml content with contracts added or improved."
      }
    }
  }
};

function buildAnalysisPrompt(report: SetupRecommendationReport): { prompt: string; truncated: boolean } {
  const { project, detectedRoutes, detectedSelectors, detectedStories, recommendedTarget, recommendedContracts, recommendedConfigYaml } = report;

  const truncated =
    detectedRoutes.length > ROUTE_LIMIT ||
    detectedSelectors.length > SELECTOR_LIMIT ||
    detectedStories.length > STORY_LIMIT;

  const routes = detectedRoutes.slice(0, ROUTE_LIMIT).map((r) => r.route);
  const selectors = detectedSelectors.slice(0, SELECTOR_LIMIT).map((s) => s.selector);
  const stories = detectedStories.slice(0, STORY_LIMIT).map((s) => `${s.title} (${s.route})`);

  const inventory = {
    projectName: project.name,
    frameworks: project.detectedFrameworks,
    packageManager: project.packageManager,
    targetUrl: recommendedTarget.url,
    targetId: recommendedTarget.id,
    detectedRoutes: routes,
    detectedSelectors: selectors,
    storybookStories: stories,
    existingContracts: recommendedContracts.map((c) => ({ id: c.id, selectors: c.selectors, screenshots: c.screenshots })),
    note: truncated
      ? `Inventory was truncated to the first ${ROUTE_LIMIT} routes, ${SELECTOR_LIMIT} selectors, and ${STORY_LIMIT} stories. Prioritize the visible subset.`
      : undefined
  };

  const prompt = `Analyze this repository inventory and call the ${TOOL_NAME} tool with your structured suggestions.

Repository inventory:
${JSON.stringify(inventory, null, 2)}

Existing recommended config YAML (improve or extend it):
${recommendedConfigYaml}

Suggest 3-6 high-value contracts. Prioritize auth/login, primary navigation, main dashboard or landing page, and any forms.`;

  return { prompt, truncated };
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

function parseToolResult(input: unknown): Pick<RepoAnalysis, "priorityRoutes" | "contractSuggestions" | "coverageGaps" | "enhancedConfigYaml"> | null {
  if (typeof input !== "object" || input === null) return null;
  const v = input as Record<string, unknown>;

  const priorityRoutes = Array.isArray(v["priorityRoutes"]) ? (v["priorityRoutes"] as unknown[]).filter((r): r is string => typeof r === "string") : [];
  const contractSuggestions = Array.isArray(v["contractSuggestions"]) ? (v["contractSuggestions"] as unknown[]).filter(isContractSuggestion) : [];
  const coverageGaps = Array.isArray(v["coverageGaps"]) ? (v["coverageGaps"] as unknown[]).filter((g): g is string => typeof g === "string") : [];
  const enhancedConfigYaml = typeof v["enhancedConfigYaml"] === "string" ? v["enhancedConfigYaml"] : null;

  if (enhancedConfigYaml === null) return null;

  return { priorityRoutes, contractSuggestions, coverageGaps, enhancedConfigYaml };
}

export async function analyzeRepo(options: RepoAnalyzerOptions): Promise<RepoAnalysis> {
  const { report, apiKey, model = "claude-sonnet-4-6" } = options;

  const client = new Anthropic({ apiKey });
  const { prompt, truncated } = buildAnalysisPrompt(report);

  let message: Anthropic.Message;
  try {
    message = await client.messages.create({
      model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: [TOOL_SCHEMA],
      tool_choice: { type: "tool", name: TOOL_NAME },
      messages: [{ role: "user", content: prompt }]
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new RepoAnalysisApiError(`Claude API call failed: ${detail}`, err);
  }

  const toolBlock = message.content.find((block): block is Anthropic.ToolUseBlock => block.type === "tool_use" && block.name === TOOL_NAME);
  const rawResponse = JSON.stringify(toolBlock?.input ?? null, null, 2);

  const parsed = toolBlock ? parseToolResult(toolBlock.input) : null;

  if (!parsed) {
    throw new RepoAnalysisApiError(
      `Claude responded but did not return a parseable ${TOOL_NAME} tool call. Raw response: ${rawResponse}`
    );
  }

  return {
    callsMade: 1,
    model,
    inputTruncated: truncated,
    rawResponse,
    ...parsed
  };
}
