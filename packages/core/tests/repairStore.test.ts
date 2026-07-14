import { describe, expect, it } from "vitest";
import { computeVisualRepairSessionStorageId, visualRepairSessionRelativeRoot } from "../src/index.js";

describe("Visual repair session storage identity", () => {
  const identity = {
    taskId: "task.visual",
    repository: "owner/repo",
    taskContextDigest: "a".repeat(64)
  };

  it("is deterministic, bounded, and content addressed", () => {
    const first = computeVisualRepairSessionStorageId(identity);
    const second = computeVisualRepairSessionStorageId({ ...identity });
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/u);
    expect(visualRepairSessionRelativeRoot(identity)).toBe(`.visual-hive/repair/sessions/${first}`);
  });

  it("separates repositories, tasks, and immutable task contexts", () => {
    const ids = new Set([
      computeVisualRepairSessionStorageId(identity),
      computeVisualRepairSessionStorageId({ ...identity, repository: "owner/other" }),
      computeVisualRepairSessionStorageId({ ...identity, taskId: "task.other" }),
      computeVisualRepairSessionStorageId({ ...identity, taskContextDigest: "b".repeat(64) })
    ]);
    expect(ids).toHaveLength(4);
  });
});
