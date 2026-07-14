import { z } from "zod";
import { BoundedIdSchema, GitCommitSchema, RepositorySchema, Sha256Schema } from "./types.js";

export const VISUAL_REPAIR_MAX_JSON_BYTES = 4 * 1024 * 1024;
export const VISUAL_REPAIR_MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const VISUAL_REPAIR_MAX_SCREENSHOT_IMAGES = 4;

export const VISUAL_REPAIR_TOOL_NAMES = [
  "visual_hive_get_task_context",
  "visual_hive_get_issue_context",
  "visual_hive_search_surface",
  "visual_hive_get_visual_asset",
  "visual_hive_get_screenshot_set",
  "visual_hive_get_browser_evidence",
  "visual_hive_compare_assets",
  "visual_hive_get_repair_validation"
] as const;

export const VisualRepairToolNameSchema = z.enum(VISUAL_REPAIR_TOOL_NAMES);

const CommonTaskIdentityShape = {
  taskId: BoundedIdSchema,
  repository: RepositorySchema,
  taskContextDigest: Sha256Schema
};

const PageShape = {
  cursor: z.number().int().nonnegative().default(0),
  limit: z.number().int().positive().max(50).default(20)
};

export const VisualRepairGetTaskContextInputSchema = z.object({
  ...CommonTaskIdentityShape,
  baseSha: GitCommitSchema,
  section: z.enum(["summary", "issue", "assets", "graph", "profiles", "obligations", "source"]).default("summary"),
  ...PageShape,
  maxChars: z.number().int().positive().max(32_000).default(16_000)
}).strict();

export const VisualRepairGetIssueContextInputSchema = z.object({
  ...CommonTaskIdentityShape,
  issueFingerprint: z.string().trim().min(1).max(1024)
}).strict();

export const VisualRepairSearchSurfaceInputSchema = z.object({
  ...CommonTaskIdentityShape,
  query: z.string().trim().min(1).max(512),
  kinds: z.array(z.enum(["file", "symbol", "component", "route", "selector", "contract", "flow", "mutation"]))
    .max(8)
    .default([])
    .refine((values) => new Set(values).size === values.length, "Surface search kinds must be unique."),
  ...PageShape
}).strict();

export const VisualRepairGetVisualAssetInputSchema = z.object({
  ...CommonTaskIdentityShape,
  assetId: BoundedIdSchema,
  maxBytes: z.number().int().positive().max(VISUAL_REPAIR_MAX_IMAGE_BYTES).default(VISUAL_REPAIR_MAX_IMAGE_BYTES)
}).strict();

const RunSelectionShape = {
  ...CommonTaskIdentityShape,
  runId: BoundedIdSchema,
  runContextDigest: Sha256Schema,
  commitSha: GitCommitSchema,
  contractId: BoundedIdSchema
};

export const VisualRepairGetScreenshotSetInputSchema = z.object({
  ...RunSelectionShape,
  screenshotName: z.string().trim().min(1).max(512),
  route: z.string().min(1).max(2048),
  state: z.string().min(1).max(1024),
  viewportId: BoundedIdSchema,
  roles: z.array(z.enum(["baseline", "actual", "diff"]))
    .min(1)
    .max(3)
    .default(["baseline", "actual", "diff"])
    .refine((values) => new Set(values).size === values.length, "Screenshot roles must be unique."),
  maxBytesPerImage: z.number().int().positive().max(VISUAL_REPAIR_MAX_IMAGE_BYTES).default(VISUAL_REPAIR_MAX_IMAGE_BYTES)
}).strict();

export const VisualRepairGetBrowserEvidenceInputSchema = z.object({
  ...RunSelectionShape,
  includeImages: z.boolean().default(true),
  maxImages: z.number().int().nonnegative().max(VISUAL_REPAIR_MAX_SCREENSHOT_IMAGES).default(2),
  maxBytesPerImage: z.number().int().positive().max(VISUAL_REPAIR_MAX_IMAGE_BYTES).default(VISUAL_REPAIR_MAX_IMAGE_BYTES)
}).strict();

export const VisualRepairAssetLocatorSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("task"), assetId: BoundedIdSchema }).strict(),
  z.object({ source: z.literal("run"), runId: BoundedIdSchema, runContextDigest: Sha256Schema, commitSha: GitCommitSchema, assetId: BoundedIdSchema }).strict()
]);

export const VisualRepairCompareAssetsInputSchema = z.object({
  ...CommonTaskIdentityShape,
  before: VisualRepairAssetLocatorSchema,
  after: VisualRepairAssetLocatorSchema,
  maxBytesPerImage: z.number().int().positive().max(VISUAL_REPAIR_MAX_IMAGE_BYTES).default(VISUAL_REPAIR_MAX_IMAGE_BYTES)
}).strict();

export const VisualRepairGetValidationInputSchema = z.object({
  ...CommonTaskIdentityShape,
  validationId: BoundedIdSchema,
  findingFingerprint: z.string().trim().min(1).max(1024),
  headSha: GitCommitSchema,
  receiptDigest: Sha256Schema,
  detail: z.enum(["summary", "full"]).default("summary")
}).strict();

export const VisualRepairToolRequestSchema = z.discriminatedUnion("tool", [
  z.object({ tool: z.literal("visual_hive_get_task_context"), arguments: VisualRepairGetTaskContextInputSchema }).strict(),
  z.object({ tool: z.literal("visual_hive_get_issue_context"), arguments: VisualRepairGetIssueContextInputSchema }).strict(),
  z.object({ tool: z.literal("visual_hive_search_surface"), arguments: VisualRepairSearchSurfaceInputSchema }).strict(),
  z.object({ tool: z.literal("visual_hive_get_visual_asset"), arguments: VisualRepairGetVisualAssetInputSchema }).strict(),
  z.object({ tool: z.literal("visual_hive_get_screenshot_set"), arguments: VisualRepairGetScreenshotSetInputSchema }).strict(),
  z.object({ tool: z.literal("visual_hive_get_browser_evidence"), arguments: VisualRepairGetBrowserEvidenceInputSchema }).strict(),
  z.object({ tool: z.literal("visual_hive_compare_assets"), arguments: VisualRepairCompareAssetsInputSchema }).strict(),
  z.object({ tool: z.literal("visual_hive_get_repair_validation"), arguments: VisualRepairGetValidationInputSchema }).strict()
]);

export type VisualRepairToolName = z.infer<typeof VisualRepairToolNameSchema>;
export type VisualRepairGetTaskContextInput = z.infer<typeof VisualRepairGetTaskContextInputSchema>;
export type VisualRepairGetIssueContextInput = z.infer<typeof VisualRepairGetIssueContextInputSchema>;
export type VisualRepairSearchSurfaceInput = z.infer<typeof VisualRepairSearchSurfaceInputSchema>;
export type VisualRepairGetVisualAssetInput = z.infer<typeof VisualRepairGetVisualAssetInputSchema>;
export type VisualRepairGetScreenshotSetInput = z.infer<typeof VisualRepairGetScreenshotSetInputSchema>;
export type VisualRepairGetBrowserEvidenceInput = z.infer<typeof VisualRepairGetBrowserEvidenceInputSchema>;
export type VisualRepairAssetLocator = z.infer<typeof VisualRepairAssetLocatorSchema>;
export type VisualRepairCompareAssetsInput = z.infer<typeof VisualRepairCompareAssetsInputSchema>;
export type VisualRepairGetValidationInput = z.infer<typeof VisualRepairGetValidationInputSchema>;
export type VisualRepairToolRequest = z.infer<typeof VisualRepairToolRequestSchema>;
