import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { afterEach, describe, expect, it } from "vitest";
import { runODiffCompare, runVRTUpload } from "../src/commands/adapters.js";
import { formatAdapterManagerResult, runAdapterManager, type AdapterManagerProcessRunner } from "../src/commands/adapterManager.js";

const roots: string[] = [];
const originalEvent = process.env.GITHUB_EVENT_NAME;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

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
    delete process.env.GITHUB_EVENT_NAME;
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

  it("plans the exact ODiff install from repository screenshot coverage without network calls", async () => {
    const root = await managedRoot();
    const result = await runAdapterManager({
      cwd: root,
      now: new Date("2026-07-12T00:00:00.000Z"),
      env: {}
    });

    expect(result.plan).toMatchObject({
      schemaVersion: "visual-hive.adapter-lifecycle-plan.v1",
      status: "action_required",
      mode: "plan",
      defaultEvidenceAdapter: "playwright",
      verdictAuthority: "visual-hive",
      externalCallsMade: 0,
      dependencyWritesMade: false
    });
    expect(result.plan.adapters.find((entry) => entry.id === "odiff_local_compare")).toMatchObject({
      selected: true,
      decision: "install",
      status: "action_required",
      targetVersion: "4.3.8",
      verdictAuthority: false
    });
    expect(result.plan.adapters.find((entry) => entry.id === "visual_regression_tracker_review")).toMatchObject({
      selected: false,
      decision: "skip",
      status: "not_applicable"
    });
    expect(formatAdapterManagerResult(result)).toContain("ODiff");
    expect(JSON.stringify(result.plan)).not.toContain("secret-value");
    await expectPlanMatchesSchema(result.plan);
  });

  it("applies, locks, health-checks, and parity-checks ODiff before selecting it for supplemental use", async () => {
    const root = await managedRoot();
    const binary = path.join(root, "node_modules", "odiff-bin", "bin", "odiff.exe");
    const runner: AdapterManagerProcessRunner = async (command, args, cwd) => {
      if (args.includes("odiff-bin@4.3.8")) {
        await writeFile(
          path.join(cwd, "package.json"),
          JSON.stringify({ name: "adapter-fixture", private: true, devDependencies: { "odiff-bin": "4.3.8" } }, null, 2)
        );
        await writeFile(
          path.join(cwd, "package-lock.json"),
          JSON.stringify({
            name: "adapter-fixture",
            lockfileVersion: 3,
            packages: {
              "": { name: "adapter-fixture", devDependencies: { "odiff-bin": "4.3.8" } },
              "node_modules/odiff-bin": {
                version: "4.3.8",
                integrity: "sha512-nEGbO932GgDZUT6KNI30wio+JaNhLHGbeXrDnYQF4UeSmroC55w8wRXqOAYqGJXk2xFK72RxxLnGofofwV+eDQ=="
              }
            }
          }, null, 2)
        );
        await mkdir(path.dirname(binary), { recursive: true });
        await writeFile(binary, "fixture");
        await chmod(binary, 0o755);
        expect(args).toContain("odiff-bin@4.3.8");
        expect(["node", "node.exe", "npm", "npm.cmd"]).toContain(path.basename(command).toLowerCase());
        return { exitCode: 0, stdout: "installed", stderr: "" };
      }
      if (args[0] === "--version") return { exitCode: 0, stdout: "odiff 4.3.8 - deterministic compare\n", stderr: "" };
      if (args[1]?.endsWith("red-copy.png")) return { exitCode: 0, stdout: "0\n", stderr: "" };
      return { exitCode: 22, stdout: "4;100.00\n", stderr: "" };
    };

    const result = await runAdapterManager({ cwd: root, apply: true, env: {}, processRunner: runner });
    const odiff = result.plan.adapters.find((entry) => entry.id === "odiff_local_compare");
    expect(result.plan).toMatchObject({ mode: "apply", status: "ready", dependencyWritesMade: true, externalCallsMade: 0 });
    expect(odiff).toMatchObject({ decision: "use", status: "ready", installedVersion: "4.3.8", verdictAuthority: false });
    expect(odiff?.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "install", status: "passed" }),
      expect.objectContaining({ kind: "health_check", status: "passed" }),
      expect.objectContaining({ kind: "parity_check", status: "passed" })
    ]));
    await expectPlanMatchesSchema(result.plan);
  });

  it("fails closed on partial VRT readiness and reports credential names without values", async () => {
    const root = await managedRoot();
    const result = await runAdapterManager({
      cwd: root,
      platform: "freebsd",
      arch: "x64",
      env: { VRT_APIURL: "https://vrt.example.test", VRT_APIKEY: "secret-value" }
    });
    const odiff = result.plan.adapters.find((entry) => entry.id === "odiff_local_compare");
    const vrt = result.plan.adapters.find((entry) => entry.id === "visual_regression_tracker_review");
    expect(odiff).toMatchObject({ decision: "replace", status: "blocked", verdictAuthority: false });
    expect(vrt).toMatchObject({
      decision: "update",
      status: "blocked",
      signals: {
        credentialNamesPresent: ["VRT_APIURL", "VRT_APIKEY"],
        credentialNamesMissing: ["VRT_PROJECT", "VRT_BRANCH"]
      }
    });
    expect(JSON.stringify(result.plan)).not.toContain("secret-value");
    expect(JSON.stringify(result.plan)).not.toContain("vrt.example.test");
  });

  it("refuses to mutate repositories owned by another package manager", async () => {
    const root = await managedRoot();
    await writeFile(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");
    const result = await runAdapterManager({ cwd: root, apply: true, env: {} });
    expect(result.plan.packageManager).toBe("unsupported");
    expect(result.plan.dependencyWritesMade).toBe(false);
    expect(result.plan.adapters.find((entry) => entry.id === "odiff_local_compare")).toMatchObject({
      decision: "replace",
      status: "blocked"
    });
  });
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-hive-adapters-"));
  roots.push(root);
  return root;
}

async function managedRoot(): Promise<string> {
  const root = await tempRoot();
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "adapter-fixture", private: true }, null, 2));
  await writeFile(
    path.join(root, "visual-hive.config.yaml"),
    `project:
  name: adapter-fixture
targets:
  local:
    kind: url
    url: "http://127.0.0.1:4173"
contracts:
  - id: dashboard
    description: Dashboard
    target: local
    screenshots:
      - name: dashboard
        route: /
        viewport: desktop
`,
    "utf8"
  );
  return root;
}

async function expectPlanMatchesSchema(plan: unknown): Promise<void> {
  const schema = JSON.parse(
    await readFile(path.join(repoRoot, "schemas", "visual-hive.adapter-lifecycle-plan.schema.json"), "utf8")
  ) as Record<string, unknown>;
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  expect(validate(plan), JSON.stringify(validate.errors, null, 2)).toBe(true);
}
