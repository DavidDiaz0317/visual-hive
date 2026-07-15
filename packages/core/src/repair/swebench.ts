import { canonicalJson, canonicalSha256, sha256Utf8 } from "./canonical.js";
import { BoundedIdSchema, GitCommitSchema, RepositorySchema, Sha256Schema } from "./types.js";
import { z } from "zod";

export const SWE_BENCH_MULTIMODAL_DATASET = "SWE-bench/SWE-bench_Multimodal" as const;
export const SWE_BENCH_MULTIMODAL_REVISION = "6051de316c9dbe807322d568d9dc5f465b33a96f" as const;

const ForbiddenAnswerKeyNames = new Set([
  "answer",
  "expectedpatch",
  "failtopass",
  "goldpatch",
  "grader",
  "gradertests",
  "hintstext",
  "modelpatch",
  "passtopass",
  "patch",
  "referenceanswer",
  "referencepatch",
  "referencesolution",
  "solution",
  "testpatch",
  "trajectory"
]);

const HttpsUrlSchema = z.string().min(1).max(8192).url().refine((value) => new URL(value).protocol === "https:", "SWE-bench Multimodal image URLs must use HTTPS.");

const PublicImageAssetsSchema = z.object({
  problem_statement: z.array(HttpsUrlSchema).max(64)
}).strict();

export const SWEbenchMultimodalPublicRowSchema = z.object({
  dataset_revision: z.literal(SWE_BENCH_MULTIMODAL_REVISION),
  repo: RepositorySchema,
  instance_id: BoundedIdSchema,
  base_commit: GitCommitSchema,
  problem_statement: z.string().min(1).max(120_000),
  image_assets: z.union([PublicImageAssetsSchema, z.string().min(2).max(1_000_000)]),
  created_at: z.string().trim().min(1).max(128).optional(),
  version: z.string().trim().min(1).max(128).optional()
}).strict();

const SWEbenchMultimodalPublicTaskContentSchema = z.object({
  schemaVersion: z.literal("visual-hive.swebench-multimodal-public-task.v1"),
  dataset: z.object({
    name: z.literal(SWE_BENCH_MULTIMODAL_DATASET),
    revision: z.literal(SWE_BENCH_MULTIMODAL_REVISION)
  }).strict(),
  taskId: BoundedIdSchema,
  repository: RepositorySchema,
  baseSha: GitCommitSchema,
  problemStatement: z.string().min(1).max(120_000),
  problemStatementSha256: Sha256Schema,
  images: z.array(z.object({
    position: z.number().int().nonnegative().max(63),
    sourceUrl: HttpsUrlSchema
  }).strict()).max(64),
  publicMetadata: z.object({
    createdAt: z.string().trim().min(1).max(128).optional(),
    version: z.string().trim().min(1).max(128).optional()
  }).strict(),
  digestAlgorithm: z.literal("visual-hive.canonical-json.sha256.v1")
}).strict();

export const SWEbenchMultimodalPublicTaskSchema = SWEbenchMultimodalPublicTaskContentSchema.extend({
  projectionDigest: Sha256Schema
}).strict();

export type SWEbenchMultimodalPublicRow = z.infer<typeof SWEbenchMultimodalPublicRowSchema>;
export type SWEbenchMultimodalPublicTask = z.infer<typeof SWEbenchMultimodalPublicTaskSchema>;

/**
 * Converts only an explicitly redacted SWE-bench Multimodal row into the agent-visible task.
 * Passing an official development row directly is intentionally rejected because those rows
 * contain scorer-only patch, test, hint, and grader fields.
 */
export function projectSWEbenchMultimodalPublicTask(value: unknown): SWEbenchMultimodalPublicTask {
  assertNoSWEbenchAnswerMaterial(value);
  canonicalJson(value);
  const parsed = SWEbenchMultimodalPublicRowSchema.parse(value);
  const imageAssets = parsePublicImageAssets(parsed.image_assets);
  const publicMetadata = {
    ...(parsed.created_at === undefined ? {} : { createdAt: parsed.created_at }),
    ...(parsed.version === undefined ? {} : { version: parsed.version })
  };
  const content = SWEbenchMultimodalPublicTaskContentSchema.parse({
    schemaVersion: "visual-hive.swebench-multimodal-public-task.v1",
    dataset: {
      name: SWE_BENCH_MULTIMODAL_DATASET,
      revision: SWE_BENCH_MULTIMODAL_REVISION
    },
    taskId: parsed.instance_id,
    repository: parsed.repo,
    baseSha: parsed.base_commit,
    problemStatement: parsed.problem_statement,
    problemStatementSha256: sha256Utf8(parsed.problem_statement),
    images: imageAssets.problem_statement.map((sourceUrl, position) => ({ position, sourceUrl })),
    publicMetadata,
    digestAlgorithm: "visual-hive.canonical-json.sha256.v1"
  });
  return SWEbenchMultimodalPublicTaskSchema.parse({ ...content, projectionDigest: canonicalSha256(content) });
}

export function parseSWEbenchMultimodalPublicTask(value: unknown): SWEbenchMultimodalPublicTask {
  assertNoSWEbenchAnswerMaterial(value);
  const parsed = SWEbenchMultimodalPublicTaskSchema.parse(value);
  const { projectionDigest, ...content } = parsed;
  const expected = canonicalSha256(content);
  if (projectionDigest !== expected) throw new Error(`SWE-bench Multimodal public task digest mismatch: expected ${expected}, got ${projectionDigest}.`);
  return parsed;
}

export function assertNoSWEbenchAnswerMaterial(value: unknown): void {
  inspectForAnswerMaterial(value, "$", new Set<object>());
}

function parsePublicImageAssets(value: SWEbenchMultimodalPublicRow["image_assets"]): z.infer<typeof PublicImageAssetsSchema> {
  if (typeof value !== "string") return PublicImageAssetsSchema.parse(value);
  let decoded: unknown;
  try {
    decoded = JSON.parse(value);
  } catch (error) {
    throw new Error(`SWE-bench Multimodal image_assets is not valid JSON: ${error instanceof Error ? error.message : String(error)}.`);
  }
  assertNoSWEbenchAnswerMaterial(decoded);
  canonicalJson(decoded);
  return PublicImageAssetsSchema.parse(decoded);
}

function inspectForAnswerMaterial(value: unknown, location: string, seen: Set<object>): void {
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) throw new Error(`SWE-bench Multimodal public input contains a cyclic value at ${location}.`);
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => inspectForAnswerMaterial(entry, `${location}[${index}]`, seen));
    seen.delete(value);
    return;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`SWE-bench Multimodal public input requires ordinary JSON objects at ${location}.`);
  for (const key of Object.keys(value as Record<string, unknown>)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/gu, "");
    if (ForbiddenAnswerKeyNames.has(normalized)) {
      throw new Error(`SWE-bench Multimodal public input contains forbidden answer or evaluator material at ${location}.${key}.`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.get || descriptor.set) throw new Error(`SWE-bench Multimodal public input rejects accessor properties at ${location}.${key}.`);
    inspectForAnswerMaterial(descriptor.value, `${location}.${key}`, seen);
  }
  seen.delete(value);
}
