import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runODiffCompare, runVRTUpload } from "../src/commands/adapters.js";

const roots: string[] = [];
const originalEvent = process.env.GITHUB_EVENT_NAME;

afterEach(async () => {
  process.env.GITHUB_EVENT_NAME = originalEvent;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("open-source adapter execution", () => {
  it("normalizes pinned ODiff CLI output as supplemental evidence", async () => {
    const root = await tempRoot();
    await writeFile(path.join(root, "baseline.png"), "baseline");
    await writeFile(path.join(root, "actual.png"), "actual");
    const adapter = path.join(root, "fake-odiff.mjs");
    await writeFile(adapter, "process.stdout.write('5;1.25\\n'); process.exit(22);\n");

    const result = await runODiffCompare({
      cwd: root,
      baseline: "baseline.png",
      actual: "actual.png",
      diff: "diff.png",
      command: process.execPath,
      commandArgs: [adapter]
    });

    expect(result).toMatchObject({
      schemaVersion: "visual-hive.odiff-result.v1",
      adapterVersion: "4.3.8",
      deterministicRole: "supplemental",
      match: false,
      reason: "pixel-diff",
      diffCount: 5,
      diffPercentage: 1.25
    });
  });

  it("uploads to the VRT 5 API only in an explicitly trusted lane", async () => {
    const root = await tempRoot();
    await writeFile(path.join(root, "actual.png"), "image-bytes");
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchFn: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith("/builds") && init?.method === "POST") {
        return new Response(JSON.stringify({ id: "build-1", projectId: "project-1" }), { status: 200 });
      }
      if (url.endsWith("/test-runs")) {
        const body = JSON.parse(String(init?.body));
        expect(body.imageBase64).toBe(Buffer.from("image-bytes").toString("base64"));
        expect((init?.headers as Record<string, string>).apiKey).toBe("secret-key");
        return new Response(JSON.stringify({ id: "run-1", status: "new", diffPercent: 2.5, url: "http://vrt.test/runs/run-1" }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    };

    const output = ".visual-hive/adapters/vrt-result.json";
    const result = await runVRTUpload({
      cwd: root,
      image: "actual.png",
      name: "dashboard",
      apiUrl: "http://vrt.test",
      apiKey: "secret-key",
      project: "demo",
      branch: "main",
      trusted: true,
      output,
      fetchFn
    });

    expect(result).toMatchObject({
      schemaVersion: "visual-hive.vrt-result.v1",
      adapterVersion: "5.1.1",
      sdkContractVersion: "5.7.1",
      deterministicRole: "supplemental",
      verdictAuthority: false,
      buildId: "build-1",
      testRunId: "run-1"
    });
    expect(calls.map((call) => `${call.init?.method} ${call.url}`)).toEqual([
      "POST http://vrt.test/builds",
      "POST http://vrt.test/test-runs",
      "PATCH http://vrt.test/builds/build-1"
    ]);
    expect(await readFile(path.join(root, output), "utf8")).not.toContain("secret-key");
  });

  it("rejects VRT uploads from untrusted and pull-request lanes", async () => {
    const root = await tempRoot();
    await writeFile(path.join(root, "actual.png"), "image-bytes");
    const base = { cwd: root, image: "actual.png", name: "dashboard", apiUrl: "http://vrt.test", apiKey: "secret", project: "demo", branch: "main" };
    await expect(runVRTUpload(base)).rejects.toThrow("explicit --trusted");
    process.env.GITHUB_EVENT_NAME = "pull_request";
    await expect(runVRTUpload({ ...base, trusted: true })).rejects.toThrow("forbidden");
  });
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-hive-adapters-"));
  roots.push(root);
  return root;
}

