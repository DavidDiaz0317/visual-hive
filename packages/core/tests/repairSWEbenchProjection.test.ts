import { describe, expect, it } from "vitest";
import {
  parseSWEbenchMultimodalPublicTask,
  projectSWEbenchMultimodalPublicTask,
  SWE_BENCH_MULTIMODAL_REVISION
} from "../src/index.js";

const baseCommit = "a".repeat(40);

describe("SWE-bench Multimodal public task projection", () => {
  it("copies only permitted fields and preserves original image order", () => {
    const projected = projectSWEbenchMultimodalPublicTask(publicRow());

    expect(projected.taskId).toBe("Automattic__wp-calypso-25725");
    expect(projected.repository).toBe("Automattic/wp-calypso");
    expect(projected.images.map((image) => image.sourceUrl)).toEqual([
      "https://github.com/user-attachments/assets/first.png",
      "https://github.com/user-attachments/assets/second.png"
    ]);
    expect(projected).not.toHaveProperty("hints_text");
    expect(parseSWEbenchMultimodalPublicTask(projected)).toEqual(projected);

    const reversed = publicRow();
    reversed.image_assets = { problem_statement: [...reversed.image_assets.problem_statement].reverse() };
    expect(projectSWEbenchMultimodalPublicTask(reversed).projectionDigest).not.toBe(projected.projectionDigest);
  });

  it("accepts a redacted JSON-string image inventory", () => {
    const row = publicRow();
    row.image_assets = JSON.stringify(row.image_assets) as unknown as typeof row.image_assets;
    const projected = projectSWEbenchMultimodalPublicTask(row);
    expect(projected.images).toHaveLength(2);
  });

  it.each(["patch", "test_patch", "FAIL_TO_PASS", "PASS_TO_PASS", "hints_text", "gold_patch", "reference_patch", "solution", "grader", "trajectory"])(
    "rejects the forbidden scorer field %s",
    (field) => {
      const row = { ...publicRow(), [field]: field === "FAIL_TO_PASS" || field === "PASS_TO_PASS" ? [] : "hidden" };
      expect(() => projectSWEbenchMultimodalPublicTask(row)).toThrow("forbidden answer or evaluator material");
    }
  );

  it("rejects patch and test-patch assets even when their arrays are empty", () => {
    const withPatchAssets = publicRow() as Record<string, unknown>;
    withPatchAssets.image_assets = {
      problem_statement: ["https://github.com/user-attachments/assets/first.png"],
      patch: []
    };
    expect(() => projectSWEbenchMultimodalPublicTask(withPatchAssets)).toThrow("forbidden answer or evaluator material");

    const withEncodedTestAssets = publicRow() as Record<string, unknown>;
    withEncodedTestAssets.image_assets = JSON.stringify({
      problem_statement: ["https://github.com/user-attachments/assets/first.png"],
      test_patch: []
    });
    expect(() => projectSWEbenchMultimodalPublicTask(withEncodedTestAssets)).toThrow("forbidden answer or evaluator material");
  });

  it("rejects unknown fields, unpinned revisions, unsafe identities, and non-HTTPS images", () => {
    expect(() => projectSWEbenchMultimodalPublicTask({ ...publicRow(), unrelated: true })).toThrow();
    expect(() => projectSWEbenchMultimodalPublicTask({ ...publicRow(), dataset_revision: "main" })).toThrow();
    expect(() => projectSWEbenchMultimodalPublicTask({ ...publicRow(), repo: "../.." })).toThrow();

    const insecure = publicRow();
    insecure.image_assets.problem_statement[0] = "http://example.com/image.png";
    expect(() => projectSWEbenchMultimodalPublicTask(insecure)).toThrow("HTTPS");
  });

  it("rejects tampering with the projected task identity", () => {
    const projected = projectSWEbenchMultimodalPublicTask(publicRow());
    expect(() => parseSWEbenchMultimodalPublicTask({ ...projected, problemStatement: "changed" })).toThrow("digest mismatch");
  });
});

function publicRow(): {
  dataset_revision: typeof SWE_BENCH_MULTIMODAL_REVISION;
  repo: string;
  instance_id: string;
  base_commit: string;
  problem_statement: string;
  image_assets: { problem_statement: string[] };
  created_at: string;
  version: string;
} {
  return {
    dataset_revision: SWE_BENCH_MULTIMODAL_REVISION,
    repo: "Automattic/wp-calypso",
    instance_id: "Automattic__wp-calypso-25725",
    base_commit: baseCommit,
    problem_statement: "The attachment shows the expected responsive layout.",
    image_assets: {
      problem_statement: [
        "https://github.com/user-attachments/assets/first.png",
        "https://github.com/user-attachments/assets/second.png"
      ]
    },
    created_at: "2024-01-02T03:04:05Z",
    version: "1.0"
  };
}
