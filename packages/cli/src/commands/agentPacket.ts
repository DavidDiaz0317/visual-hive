import path from "node:path";
import { z } from "zod";
import {
  loadConfig,
  readEvidencePacket,
  readHandoffPacket,
  readJson,
  writeAgentPacket,
  type AgentPacket,
  type AgentPacketProfile,
  type RunHistoryReport,
  type TestCreationPlan
} from "@visual-hive/core";

const AGENT_PACKET_PROFILES: AgentPacketProfile[] = ["repair_agent", "test_creator", "review_agent", "handoff_agent", "provider_specialist"];

const TestCreationRecommendationV2Schema = z.object({
  id: z.string(),
  gapId: z.string(),
  source: z.enum(["testing_layer", "coverage_recommendation", "mutation_survivor", "handoff_work_item"]),
  kind: z.enum([
    "unit_test",
    "accessibility_check",
    "api_contract",
    "selector_assertion",
    "screenshot",
    "flow",
    "mutation_mapping",
    "workflow_setup",
    "provider_review",
    "protected_canary",
    "history_review",
    "agent_handoff"
  ]),
  priority: z.enum(["low", "medium", "high"]),
  title: z.string(),
  rationale: z.array(z.string()),
  affected: z.object({
    route: z.string().optional(),
    component: z.string().optional(),
    viewport: z.string().optional(),
    state: z.string().optional()
  }).strict(),
  currentEvidence: z.array(z.string()),
  grounding: z.object({
    status: z.enum(["grounded", "unresolved"]),
    evidence: z.array(z.string()),
    unresolvedReasons: z.array(z.string())
  }).strict(),
  suggestedContract: z.object({
    id: z.string(),
    description: z.string(),
    targetId: z.string().optional(),
    route: z.string().optional(),
    viewport: z.string().optional(),
    selectors: z.array(z.string()),
    mustNotExistSelectors: z.array(z.string()),
    textMustExist: z.array(z.string()),
    textMustNotExist: z.array(z.string()),
    maskSelectors: z.array(z.string())
  }).strict(),
  suggestedMutation: z.string(),
  validationCommand: z.string(),
  hiveOwner: z.enum(["quality", "tester", "ci-maintainer"]),
  layer: z.object({
    id: z.number(),
    name: z.string(),
    status: z.enum(["covered", "partial", "missing", "not_applicable", "unknown"])
  }).strict().optional(),
  targetId: z.string().optional(),
  contractId: z.string().optional(),
  mutationOperator: z.string().optional(),
  coverageRecommendationId: z.string().optional(),
  handoffWorkItemId: z.string().optional(),
  suggestedTests: z.array(z.string()),
  suggestedConfigYaml: z.string().optional(),
  artifacts: z.array(z.string()),
  trustedOnly: z.boolean(),
  applyMode: z.literal("advisory_no_write")
}).strict();

const TestCreationPlanV2Schema = z.object({
  schemaVersion: z.literal("visual-hive.test-creation-plan.v2"),
  generatedAt: z.string(),
  project: z.string(),
  outputResource: z.object({
    artifactPath: z.literal(".visual-hive/test-creation-plan.json"),
    evidenceResourceId: z.literal("test-creation-plan"),
    evidenceResourceUri: z.literal("visual-hive://test-creation-plan"),
    evidenceResourceTitle: z.literal("Test Creation Plan"),
    evidenceResourceDescription: z.string(),
    evidenceReadToolName: z.literal("visual_hive_read_test_creation_plan").optional()
  }).strict().optional(),
  sourceArtifacts: z.object({
    evidencePacket: z.string().optional(),
    coverageRecommendations: z.string().optional(),
    handoffPacket: z.string().optional()
  }).strict(),
  governance: z.object({
    verdictAuthority: z.literal("visual_hive"),
    agentAuthority: z.literal("advisory_test_generation_only"),
    writePolicy: z.literal("no_config_or_test_files_written"),
    secretPolicy: z.literal("redacted_values_names_only")
  }).strict(),
  summary: z.object({
    total: z.number(),
    high: z.number(),
    medium: z.number(),
    low: z.number(),
    fromTestingLayers: z.number(),
    fromCoverageRecommendations: z.number(),
    fromMutationSurvivors: z.number(),
    fromHandoffWorkItems: z.number()
  }).strict(),
  recommendations: z.array(TestCreationRecommendationV2Schema)
}).strict();

export interface AgentPacketCommandOptions {
  config?: string;
  cwd?: string;
  evidence?: string;
  handoff?: string;
  testCreationPlan?: string;
  profile?: string;
  output?: string;
  format?: "markdown" | "json";
}

export interface AgentPacketCommandResult {
  packet: AgentPacket;
  packetPath: string;
  evidencePath: string;
  handoffPath?: string;
  testCreationPlanPath?: string;
  runHistoryPath?: string;
}

export async function runAgentPacketCommand(options: AgentPacketCommandOptions = {}): Promise<AgentPacketCommandResult> {
  const cwd = options.cwd ?? process.cwd();
  const loaded = await loadConfig(options.config, cwd);
  const evidencePath = path.resolve(loaded.rootDir, options.evidence ?? path.join(".visual-hive", "evidence-packet.json"));
  const handoffPath = path.resolve(loaded.rootDir, options.handoff ?? path.join(".visual-hive", "handoff.json"));
  const testCreationPlanPath = path.resolve(loaded.rootDir, options.testCreationPlan ?? path.join(".visual-hive", "test-creation-plan.json"));
  const runHistoryPath = path.resolve(loaded.rootDir, path.join(".visual-hive", "history.json"));
  const profile = parseAgentPacketProfile(options.profile ?? "repair_agent");

  let evidencePacket;
  try {
    evidencePacket = await readEvidencePacket(evidencePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Missing or invalid Evidence Packet at ${evidencePath}. Run "visual-hive evidence" before "visual-hive agent-packet". Details: ${message}`);
  }

  let handoffPacket;
  let resolvedHandoffPath: string | undefined;
  try {
    handoffPacket = await readHandoffPacket(handoffPath);
    resolvedHandoffPath = path.relative(loaded.rootDir, handoffPath).replaceAll(path.sep, "/");
  } catch {
    handoffPacket = undefined;
    resolvedHandoffPath = undefined;
  }

  let testCreationPlan: TestCreationPlan | undefined;
  let resolvedTestCreationPlanPath: string | undefined;
  try {
    const parsed = TestCreationPlanV2Schema.safeParse(await readJson<unknown>(testCreationPlanPath));
    if (parsed.success) {
      testCreationPlan = parsed.data as TestCreationPlan;
      resolvedTestCreationPlanPath = path.relative(loaded.rootDir, testCreationPlanPath).replaceAll(path.sep, "/");
    }
  } catch {
    testCreationPlan = undefined;
    resolvedTestCreationPlanPath = undefined;
  }

  let runHistory: RunHistoryReport | undefined;
  let resolvedRunHistoryPath: string | undefined;
  try {
    runHistory = await readJson<RunHistoryReport>(runHistoryPath);
    if (runHistory.schemaVersion === 1) {
      resolvedRunHistoryPath = path.relative(loaded.rootDir, runHistoryPath).replaceAll(path.sep, "/");
    }
  } catch {
    runHistory = undefined;
    resolvedRunHistoryPath = undefined;
  }

  const result = await writeAgentPacket({
    rootDir: loaded.rootDir,
    evidencePacket,
    evidencePacketPath: path.relative(loaded.rootDir, evidencePath).replaceAll(path.sep, "/"),
    handoffPacket,
    handoffPacketPath: resolvedHandoffPath,
    testCreationRecommendations: testCreationPlan?.recommendations,
    testCreationPlanPath: resolvedTestCreationPlanPath,
    runHistory,
    runHistoryPath: resolvedRunHistoryPath,
    profile,
    outputPath: options.output ?? path.join(".visual-hive", "agent-packet.json")
  });

  return {
    ...result,
    evidencePath,
    handoffPath: resolvedHandoffPath ? handoffPath : undefined,
    testCreationPlanPath: resolvedTestCreationPlanPath ? testCreationPlanPath : undefined,
    runHistoryPath: resolvedRunHistoryPath ? runHistoryPath : undefined
  };
}

export function parseAgentPacketProfile(value: string): AgentPacketProfile {
  if (AGENT_PACKET_PROFILES.includes(value as AgentPacketProfile)) {
    return value as AgentPacketProfile;
  }
  throw new Error(`Invalid agent packet profile "${value}". Expected one of: ${AGENT_PACKET_PROFILES.join(", ")}`);
}

export function formatAgentPacketResult(result: AgentPacketCommandResult, format: "markdown" | "json" = "markdown"): string {
  if (format === "json") {
    return JSON.stringify(result.packet, null, 2);
  }
  return [
    `Wrote ${result.packetPath}`,
    "",
    `# Agent Packet: ${result.packet.project}`,
    "",
    `- Profile: ${result.packet.profile}`,
    `- Objective: ${result.packet.objective}`,
    `- Visual Hive verdict: ${result.packet.verdict.visualHiveVerdict}`,
    `- Work items: ${result.packet.evidenceSummary.workItems.length}`,
    `- Allowed tools: ${result.packet.allowedTools.length}`,
    `- External network allowed: ${result.packet.budgets.allowExternalNetwork}`,
    `- Max external cost: $${result.packet.budgets.maxExternalCostUsd}`,
    `- Evidence source: ${result.packet.sourceArtifacts.evidencePacket}`,
    ...(result.packet.sourceArtifacts.handoffPacket ? [`- Handoff source: ${result.packet.sourceArtifacts.handoffPacket}`] : []),
    ...(result.packet.sourceArtifacts.testCreationPlan ? [`- Test creation plan: ${result.packet.sourceArtifacts.testCreationPlan}`] : []),
    ...(result.packet.sourceArtifacts.runHistory ? [`- Run history: ${result.packet.sourceArtifacts.runHistory}`] : [])
  ].join("\n");
}
