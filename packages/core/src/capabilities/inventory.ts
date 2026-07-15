import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { listArtifactSurfaceCapabilities } from "../artifacts/surfaces.js";
import { FLOW_STEP_ACTIONS, SELECTOR_ASSERTION_PRIMITIVES } from "../config/schema.js";
import { githubWorkflowTemplates } from "../github/workflowTemplates.js";
import { MUTATION_OPERATOR_METADATA } from "../mutations/operators.js";
import { PLAN_MODES } from "../planner/types.js";
import { listProviderAdapters, PROVIDER_ADAPTER_OPERATION_SEQUENCE, type ProviderAdapterOperation } from "../providers/adapter.js";
import { SCHEDULE_EXECUTION_LANE_IDS } from "../schedules/audit.js";
import { buildToolRegistry } from "../tools/build.js";
import { VISUAL_HIVE_EVIDENCE_RESOURCES } from "../tools/evidenceResources.js";
import type {
  CapabilityInventory,
  CliCapability,
  ControlPlaneCapability,
  OpenSourceAdapterCapability,
  SchemaCapability
} from "./types.js";

const DEFERRED_PROVIDER_REASON =
  "The built-in adapter normalizes metadata but has no first-party external execution path for this provider.";
const DEFERRED_COMPARE_REASON =
  "Hosted provider comparison execution is deferred; Playwright remains the deterministic verdict authority.";
const DEFERRED_FETCH_REASON =
  "External provider result fetching is deferred; no provider result API call is implemented.";

const ADAPTER_COMMANDS: Record<string, string> = {
  odiff_local_compare: "adapters odiff compare",
  visual_regression_tracker_review: "adapters vrt upload"
};

export interface BuildCapabilityInventoryOptions {
  cli: CliCapability[];
  schemas: SchemaCapability[];
  controlPlane: ControlPlaneCapability[];
}

export function buildCapabilityInventory(options: BuildCapabilityInventoryOptions): CapabilityInventory {
  return {
    cli: [...options.cli].sort((left, right) => left.path.localeCompare(right.path)),
    schemas: [...options.schemas].sort((left, right) => left.filename.localeCompare(right.filename)),
    evidenceResources: VISUAL_HIVE_EVIDENCE_RESOURCES.map((resource) => ({
      id: resource.id,
      uri: resource.uri,
      relativePath: resource.relativePath,
      readTool: resource.readTool?.name
    })).sort((left, right) => left.id.localeCompare(right.id)),
    artifactSurfaces: listArtifactSurfaceCapabilities(),
    planModes: PLAN_MODES.map((mode) => ({ mode, runtimeStatus: "supported" as const })),
    workflowLanes: [
      ...SCHEDULE_EXECUTION_LANE_IDS.map((laneId) => ({
        id: `execution:${laneId}`,
        kind: "execution" as const,
        laneId,
        runtimeStatus: "supported" as const
      })),
      ...githubWorkflowTemplates.map((template) => ({
        id: `template:${template.id}`,
        kind: "template" as const,
        laneId: template.id,
        path: template.path,
        sha256: createHash("sha256").update(template.content.replaceAll("\r\n", "\n")).digest("hex"),
        runtimeStatus: "supported" as const
      }))
    ]
      .sort((left, right) => left.id.localeCompare(right.id)),
    mutationOperators: Object.values(MUTATION_OPERATOR_METADATA)
      .map((operator) => ({
        id: operator.id,
        description: operator.description,
        relevantSelectors: [...operator.relevantSelectors].sort(),
        recommendedContracts: [...operator.recommendedContracts].sort(),
        expectedFailureKinds: [...operator.expectedFailureKinds].sort(),
        defaultHeuristic: operator.defaultHeuristic,
        runtimeStatus: "supported" as const
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    deterministicPrimitives: [
      ...SELECTOR_ASSERTION_PRIMITIVES.map((primitive) => ({
        id: `selector:${primitive}`,
        kind: "selector_assertion" as const,
        runtimeStatus: "supported" as const
      })),
      ...FLOW_STEP_ACTIONS.map((action) => ({
        id: `flow:${action}`,
        kind: "flow_action" as const,
        runtimeStatus: "supported" as const
      }))
    ].sort((left, right) => left.id.localeCompare(right.id)),
    providers: listProviderAdapters()
      .map((adapter) => {
        const operations = providerOperations(adapter.id);
        const runtimeSupported = adapter.id === "playwright" || adapter.id === "argos";
        return {
          id: adapter.id,
          category: adapter.category,
          deterministicRole: adapter.deterministicRole,
          supportedOperations: operations.filter((operation) => operation.runtimeStatus === "supported").map((operation) => operation.operation),
          operations,
          runtimeStatus: runtimeSupported ? "supported" as const : "blocked" as const,
          blockedReason: runtimeSupported ? undefined : DEFERRED_PROVIDER_REASON
        };
      })
      .sort((left, right) => left.id.localeCompare(right.id)),
    openSourceAdapters: openSourceAdapters(),
    controlPlane: [...options.controlPlane].sort((left, right) => `${left.method} ${left.path}`.localeCompare(`${right.method} ${right.path}`))
  };
}

export async function readSchemaCapabilities(schemasDir: string): Promise<SchemaCapability[]> {
  const files = (await readdir(schemasDir)).filter((file) => file.endsWith(".schema.json")).sort();
  const schemas: SchemaCapability[] = [];
  for (const filename of files) {
    const parsed = JSON.parse(await readFile(path.join(schemasDir, filename), "utf8")) as { $id?: unknown };
    if (typeof parsed.$id !== "string" || parsed.$id.length === 0) {
      throw new Error(`Schema ${filename} is missing a non-empty $id.`);
    }
    schemas.push({ filename, id: parsed.$id, sha256: canonicalJsonSha256(parsed) });
  }
  return schemas;
}

function providerOperations(providerId: string): Array<{
  operation: ProviderAdapterOperation;
  runtimeStatus: "supported" | "blocked";
  blockedReason?: string;
}> {
  return PROVIDER_ADAPTER_OPERATION_SEQUENCE.map((operation) => {
    if (operation === "availability" || operation === "normalize_result" || operation === "emit_report_metadata") {
      return { operation, runtimeStatus: "supported" as const };
    }
    if (operation === "compare") {
      return providerId === "playwright"
        ? { operation, runtimeStatus: "supported" as const }
        : { operation, runtimeStatus: "blocked" as const, blockedReason: DEFERRED_COMPARE_REASON };
    }
    if (operation === "fetch_result") {
      return providerId === "playwright"
        ? { operation, runtimeStatus: "supported" as const }
        : { operation, runtimeStatus: "blocked" as const, blockedReason: DEFERRED_FETCH_REASON };
    }
    if (operation === "upload_artifact") {
      if (providerId === "argos") return { operation, runtimeStatus: "supported" as const };
      return {
        operation,
        runtimeStatus: "blocked" as const,
        blockedReason: providerId === "playwright"
          ? "Playwright evidence remains local; provider upload is not applicable."
          : "No guarded first-party upload command is implemented for this provider."
      };
    }
    return { operation, runtimeStatus: "blocked" as const, blockedReason: "No runtime implementation is registered." };
  }).sort((left, right) => left.operation.localeCompare(right.operation));
}

function canonicalJsonSha256(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
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

function openSourceAdapters(): OpenSourceAdapterCapability[] {
  return buildToolRegistry({ project: "capability-inventory", now: new Date(0) }).tools
    .filter((tool) => tool.adapterLifecycle)
    .map((tool) => ({
      id: tool.id,
      version: tool.adapterLifecycle!.version,
      license: tool.adapterLifecycle!.license,
      command: ADAPTER_COMMANDS[tool.id] ?? "",
      runtimeStatus: ADAPTER_COMMANDS[tool.id] ? "supported" as const : "blocked" as const,
      blockedReason: ADAPTER_COMMANDS[tool.id] ? undefined : "No first-party Visual Hive CLI runtime path is registered for this adapter."
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}
