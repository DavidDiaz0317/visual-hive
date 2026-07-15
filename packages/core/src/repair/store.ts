import { canonicalSha256 } from "./canonical.js";
import { BoundedIdSchema, RepositorySchema, Sha256Schema } from "./types.js";
import { z } from "zod";

export const VisualRepairSessionStorageIdentitySchema = z.object({
  taskId: BoundedIdSchema,
  repository: RepositorySchema,
  taskContextDigest: Sha256Schema
}).strict();

export type VisualRepairSessionStorageIdentity = z.infer<typeof VisualRepairSessionStorageIdentitySchema>;

export function computeVisualRepairSessionStorageId(value: VisualRepairSessionStorageIdentity): string {
  const identity = VisualRepairSessionStorageIdentitySchema.parse(value);
  return canonicalSha256({
    schemaVersion: "visual-hive.repair-session-storage.v1",
    ...identity
  });
}

export function visualRepairSessionRelativeRoot(value: VisualRepairSessionStorageIdentity): string {
  return `.visual-hive/repair/sessions/${computeVisualRepairSessionStorageId(value)}`;
}
