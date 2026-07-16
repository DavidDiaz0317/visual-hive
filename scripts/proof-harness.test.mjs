import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  PROOF_IMAGE_REFERENCE,
  SystemCommandRunner,
  inspectCleanRepository,
  parseArguments,
  runDockerProof,
  validateImageReference,
  verifyExportDirectory,
} from "./proof-harness.mjs";
import { copyOrdinaryEvidence } from "./proof-harness-container.mjs";

class FakeDockerRunner {
  constructor(options = {}) {
    this.options = options;
    this.calls = [];
  }

  async run(command, args, options = {}) {
    this.calls.push({ command, args: [...args], options: { ...options } });
    if (command !== "docker") return { exitCode: 0, stdout: "", stderr: "" };
    if (args[0] === "image" && args[1] === "inspect") {
      return {
        exitCode: 0,
        stdout: `${JSON.stringify({
          Id: `sha256:${"1".repeat(64)}`,
          RepoDigests: this.options.digestMismatch ? [] : [PROOF_IMAGE_REFERENCE],
        })}\n`,
        stderr: "",
      };
    }
    if (args[0] === "network" && args[1] === "create") {
      return { exitCode: 0, stdout: "network-id\n", stderr: "" };
    }
    if (args[0] === "create") return { exitCode: 0, stdout: "container-id\n", stderr: "" };
    if (args[0] === "inspect") {
      return {
        exitCode: 0,
        stdout: `${JSON.stringify({
          NetworkSettings: {
            Networks: this.options.attachedNetwork ? { proof: { NetworkID: "still-attached" } } : {},
            Ports: {},
          },
          HostConfig: {
            IpcMode: this.options.weakContainment ? "host" : "private",
            CapDrop: ["ALL"],
            SecurityOpt: ["no-new-privileges"],
            Privileged: false,
            ShmSize: 2 * 1024 * 1024 * 1024,
            PortBindings: {},
          },
          Mounts: [{ Type: "bind", Destination: "/proof/input", RW: false }],
          Config: {
            Env: [
              "CI=true",
              "VISUAL_HIVE_CI=true",
              "GITHUB_TOKEN=",
              "GH_TOKEN=",
              "OPENAI_API_KEY=",
              "ANTHROPIC_API_KEY=",
              "VISUAL_HIVE_LIVE_GITHUB_ISSUE=false",
            ],
          },
        })}\n`,
        stderr: "",
      };
    }
    if (args[0] === "exec" && args.includes("sha256sum")) {
      return { exitCode: 0, stdout: `${"d".repeat(64)}  evidence.json\n`, stderr: "" };
    }
    const isCandidateRun =
      args[0] === "exec" && args.includes("run") && args.includes(".visual-hive/plan.visual-candidate.json");
    if (isCandidateRun) {
      return {
        exitCode: this.options.candidatePasses ? 0 : 1,
        stdout: "",
        stderr: "expected visual diff",
      };
    }
    return { exitCode: 0, stdout: args[0] === "port" ? "" : "ok\n", stderr: "" };
  }
}

const identity = {
  commit: "a".repeat(40),
  tree: "b".repeat(40),
  lockSha256: "c".repeat(64),
};

function proofInput(mode) {
  return {
    mode,
    image: PROOF_IMAGE_REFERENCE,
    bundleRoot: "/tmp/proof-input",
    output: "/tmp/proof-output",
    target: identity,
    visual: identity,
  };
}

test("immutable proof image refuses tags and digest drift", () => {
  assert.throws(
    () => validateImageReference("mcr.microsoft.com/playwright:v1.60.0-noble"),
    /repository digest/u,
  );
  assert.throws(
    () => validateImageReference(`mcr.microsoft.com/playwright@sha256:${"0".repeat(64)}`),
    /repository digest/u,
  );
  assert.deepEqual(validateImageReference(PROOF_IMAGE_REFERENCE), {
    repository: "mcr.microsoft.com/playwright",
    digest: `sha256:${"9bd26ad900bb5e0f4dee75839e957a89ae89c2b7ab1e76050e559790e946b948"}`,
  });
});

test("proof harness arguments reject unknown fields and ambiguous help", () => {
  assert.throws(() => parseArguments(["--unexpected", "value"]), /Unknown proof harness argument/u);
  assert.throws(() => parseArguments(["--help", "--mode", "preliminary"]), /cannot be combined/u);
  assert.deepEqual(parseArguments(["--help"]), { help: true });
});

test("preliminary workflow builds online, detaches, then runs only the strict health pipeline", async () => {
  const runner = new FakeDockerRunner();
  await runDockerProof(proofInput("preliminary"), runner);
  const dockerCalls = runner.calls.filter((call) => call.command === "docker");
  const create = dockerCalls.find((call) => call.args[0] === "create");
  assert.ok(create.args.includes("--init"));
  assert.ok(create.args.includes("--ipc"));
  assert.ok(create.args.includes("private"));
  assert.ok(!create.args.includes("host"));
  assert.ok(create.args.includes("--cap-drop"));
  assert.ok(create.args.includes("ALL"));
  assert.ok(create.args.includes("--security-opt"));
  assert.ok(create.args.includes("no-new-privileges"));
  assert.ok(create.args.includes("2g"));
  assert.ok(!create.args.includes("--publish"));
  assert.ok(!create.args.includes("-p"));
  assert.equal(create.args.at(-3), PROOF_IMAGE_REFERENCE);

  const commandLines = dockerCalls.map((call) => call.args.join(" "));
  const buildIndex = commandLines.findIndex((line) => line.includes("npm run build"));
  const preflightIndex = commandLines.findIndex((line) => line.includes("visual-hive-proof-preflight.mjs"));
  const disconnectIndex = commandLines.findIndex((line) => line.startsWith("network disconnect"));
  const isolationIndex = commandLines.findIndex((line) => line.includes("prove-isolation"));
  const pipelineIndex = commandLines.findIndex((line) => line.includes(" pipeline "));
  const visualFreezeIndex = commandLines.findIndex((line) => line.includes("chmod -R a-w /work/visual-hive"));
  const openWorkIndex = commandLines.findIndex((line) => line.includes("chmod 0777 /work"));
  const targetCloneIndex = commandLines.findIndex((line) => line.includes("git clone") && line.includes("target.bundle"));
  const closeWorkIndex = commandLines.findIndex((line) => line.includes("chmod 0755 /work"));
  const targetInstallIndex = commandLines.findIndex((line) => line.includes("npm --prefix dashboard ci"));
  assert.ok(buildIndex >= 0 && buildIndex < preflightIndex);
  assert.ok(preflightIndex < disconnectIndex && disconnectIndex < isolationIndex && isolationIndex < pipelineIndex);
  assert.ok(
    visualFreezeIndex < openWorkIndex &&
      openWorkIndex < targetCloneIndex &&
      targetCloneIndex < closeWorkIndex &&
      closeWorkIndex < targetInstallIndex,
  );
  assert.ok(commandLines.some((line) => line.includes("chmod -R a-w /work/visual-hive")));
  assert.ok(!commandLines.some((line) => line.includes("chown")));
  assert.ok(commandLines.some((line) => /^exec --user pwuser .*git clone .*target\.bundle \/work\/target/u.test(line)));
  assert.ok(commandLines.some((line) => line.includes("proof-harness-container.mjs quiesce-user")));
  for (const line of commandLines.filter(
    (candidate) =>
      candidate.includes("npm --prefix dashboard") ||
      candidate.includes("visual-hive-proof-preflight.mjs") ||
      candidate.includes(" pipeline "),
  )) {
    assert.match(line, /^exec --user pwuser /u);
  }
  assert.equal(commandLines.filter((line) => line.includes("sha256sum /proof/")).length, 6);
  const pipeline = commandLines[pipelineIndex];
  for (const token of [
    "--mode pr",
    "--ci",
    "--enforce-mutation",
    "--skip-install",
    "--skip-build",
    "--runtime-sidecar .visual-hive/proof/preliminary/runtime.json",
  ]) {
    assert.match(pipeline, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  }
  assert.doesNotMatch(pipeline, /update|bootstrap|continue-on-error/u);
  assert.equal(commandLines.filter((line) => line.includes("visual-hive-proof-preflight.mjs")).length, 1);
});

test("candidate workflow verifies the isolated visual plan and requires an expected-red run", async () => {
  const runner = new FakeDockerRunner();
  await runDockerProof(proofInput("candidate"), runner);
  const lines = runner.calls.map((call) => call.args.join(" "));
  const plan = lines.findIndex((line) => line.includes("plan.visual-candidate.json") && line.includes(" plan "));
  const verify = lines.findIndex((line) => line.includes("verify-plan"));
  const run = lines.findIndex((line) => line.includes("plan.visual-candidate.json") && line.includes(" run "));
  assert.ok(plan >= 0 && plan < verify && verify < run);
  assert.match(lines[plan], /--include-contract app-shell-visual-stability/u);
  assert.match(lines[plan], /--exclude-contract app-shell-content-health/u);
  assert.doesNotMatch(lines[run], /update-snapshots/u);
  assert.equal(lines.filter((line) => line.includes(" pipeline ")).length, 0);

  await assert.rejects(
    runDockerProof(proofInput("candidate"), new FakeDockerRunner({ candidatePasses: true })),
    /unexpectedly passed/u,
  );
});

test("Docker digest and network drift fail closed and still clean owned resources", async () => {
  await assert.rejects(
    runDockerProof(proofInput("preliminary"), new FakeDockerRunner({ digestMismatch: true })),
    /does not advertise/u,
  );
  const runner = new FakeDockerRunner({ attachedNetwork: true });
  await assert.rejects(runDockerProof(proofInput("preliminary"), runner), /remains attached/u);
  const lines = runner.calls.map((call) => `${call.command} ${call.args.join(" ")}`);
  assert.ok(lines.some((line) => line.startsWith("docker rm --force")));
  assert.ok(lines.some((line) => line.startsWith("docker network rm")));
  await assert.rejects(
    runDockerProof(proofInput("preliminary"), new FakeDockerRunner({ weakContainment: true })),
    /missing private IPC/u,
  );
});

test("clean repository inspection binds exact commit, tree, lock, and dirtiness", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vh-proof-repo-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", ["-C", root, "config", "user.name", "Proof Test"]);
  execFileSync("git", ["-C", root, "config", "user.email", "proof@example.invalid"]);
  await writeFile(path.join(root, "package-lock.json"), '{"lockfileVersion":3}\n');
  execFileSync("git", ["-C", root, "add", "package-lock.json"]);
  execFileSync("git", ["-C", root, "commit", "-qm", "fixture"]);
  const commit = git(root, ["rev-parse", "HEAD"]);
  const tree = git(root, ["rev-parse", "HEAD^{tree}"]);
  const lockSha256 = createHash("sha256")
    .update(await readFile(path.join(root, "package-lock.json")))
    .digest("hex");
  const result = await inspectCleanRepository({
    root,
    expectedCommit: commit,
    expectedTree: tree,
    lockPath: "package-lock.json",
    expectedLockSha256: lockSha256,
    runner: new SystemCommandRunner(),
    label: "fixture",
  });
  assert.equal(result.commit, commit);
  await writeFile(path.join(root, "dirty.txt"), "dirty");
  await assert.rejects(
    inspectCleanRepository({
      root,
      expectedCommit: commit,
      expectedTree: tree,
      lockPath: "package-lock.json",
      expectedLockSha256: lockSha256,
      runner: new SystemCommandRunner(),
      label: "fixture",
    }),
    /must be clean/u,
  );
});

test("export verifier accepts only the deterministic preliminary allowlist", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vh-proof-export-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const manifest = await writeProofExport(root, "preliminary");
  const verified = await verifyExportDirectory(root);
  assert.equal(verified.files.length, 19);
  await writeFile(path.join(root, "extra.txt"), "undeclared");
  await assert.rejects(verifyExportDirectory(root), /file set/u);
  await rm(path.join(root, "extra.txt"));

  const runPath = path.join(root, "attestations", "run.json");
  const original = await readFile(runPath);
  await writeFile(runPath, "changed\n");
  await assert.rejects(verifyExportDirectory(root), /digest mismatch/u);
  await writeFile(runPath, original);

  const baseline = Buffer.from("forbidden\n");
  await mkdir(path.join(root, "snapshots"));
  await writeFile(path.join(root, "snapshots", "baseline.png"), baseline);
  manifest.files.push(fileIdentity("snapshots/baseline.png", baseline));
  manifest.files.sort((left, right) => left.path.localeCompare(right.path));
  await writeFile(path.join(root, "proof-manifest.json"), `${JSON.stringify(manifest)}\n`);
  await assert.rejects(verifyExportDirectory(root), /evidence allowlist/u);
  await rm(path.join(root, "snapshots"), { recursive: true });
  manifest.files = manifest.files.filter((entry) => entry.path !== "snapshots/baseline.png");

  const secret = Buffer.from('{"access_token":"ghp_abcdefghijklmnopqrstuvwxyz123456"}\n');
  await writeFile(runPath, secret);
  const runEntry = manifest.files.find((entry) => entry.path === "attestations/run.json");
  Object.assign(runEntry, fileIdentity("attestations/run.json", secret));
  await writeFile(path.join(root, "proof-manifest.json"), `${JSON.stringify(manifest)}\n`);
  await assert.rejects(verifyExportDirectory(root), /secret-shaped material/u);
});

test("candidate export requires exactly two valid candidate and diff PNGs", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vh-proof-candidate-export-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const manifest = await writeProofExport(root, "candidate");
  assert.equal((await verifyExportDirectory(root)).files.length, 12);
  const candidatePath = path.join(root, "candidates", "candidate-1.png");
  const malformed = Buffer.from("not a png\n");
  await writeFile(candidatePath, malformed);
  Object.assign(
    manifest.files.find((entry) => entry.path === "candidates/candidate-1.png"),
    fileIdentity("candidates/candidate-1.png", malformed),
  );
  await writeFile(path.join(root, "proof-manifest.json"), `${JSON.stringify(manifest)}\n`);
  await assert.rejects(verifyExportDirectory(root), /malformed PNG/u);
});

test("evidence freezing exports asserted bytes and rejects a post-assertion source swap", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vh-proof-freeze-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, "report.json");
  const asserted = Buffer.from('{"status":"asserted"}\n');
  const swapped = Buffer.from('{"status":"swapped"}\n');
  await writeFile(source, asserted);
  await writeFile(source, swapped);

  const frozenOutput = path.join(root, "frozen-output");
  await mkdir(frozenOutput);
  await copyOrdinaryEvidence(
    {
      source,
      outputRelative: "visual-hive/report.json",
      allowedRoot: root,
      frozenBytes: asserted,
    },
    frozenOutput,
  );
  assert.deepEqual(await readFile(path.join(frozenOutput, "visual-hive/report.json")), asserted);

  const sealedOutput = path.join(root, "sealed-output");
  await mkdir(sealedOutput);
  await assert.rejects(
    copyOrdinaryEvidence(
      {
        source,
        outputRelative: "visual-hive/report.json",
        allowedRoot: root,
        expectedSha256: createHash("sha256").update(asserted).digest("hex"),
      },
      sealedOutput,
    ),
    /changed after its sealed assertion/u,
  );
});

async function writeProofExport(root, mode) {
  const common = [
    "attestations/input.json",
    "attestations/isolation.json",
    "attestations/run.json",
    "attestations/source.json",
    "attestations/target-source-preflight.json",
    "visual-hive/report.json",
    "visual-hive/runtime.json",
  ];
  const paths = mode === "preliminary"
    ? [
        ...common,
        "visual-hive/artifacts-index.json",
        "visual-hive/capability-parity.json",
        "visual-hive/coverage.json",
        "visual-hive/evidence-packet.json",
        "visual-hive/hive/hive-agent-policy.json",
        "visual-hive/hive/hive-export.json",
        "visual-hive/hive/repair-work-orders.json",
        "visual-hive/mutation-report.json",
        "visual-hive/pipeline.json",
        "visual-hive/plan.json",
        "visual-hive/test-creation-plan.json",
        "visual-hive/verdict.json",
      ]
    : [
        ...common,
        "visual-hive/plan.visual-candidate.json",
        "candidates/candidate-1.png",
        "candidates/candidate-2.png",
        "diffs/diff-1.png",
        "diffs/diff-2.png",
      ];
  const json = Buffer.from('{"status":"verified"}\n');
  const png = minimalPng();
  const files = [];
  for (const relative of paths.sort()) {
    const bytes = relative.endsWith(".png") ? png : json;
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await writeFile(path.join(root, relative), bytes);
    files.push(fileIdentity(relative, bytes));
  }
  const manifest = {
    schemaVersion: "visual-hive.outer-proof.v1",
    mode,
    status: mode === "preliminary" ? "passed" : "expected_red_for_human_review",
    approvalStatus: "not_approved",
    baselineUpdatesAllowed: false,
    image: { reference: PROOF_IMAGE_REFERENCE, id: `sha256:${"1".repeat(64)}` },
    target: { commit: identity.commit, tree: identity.tree, lockSha256: identity.lockSha256 },
    visualHive: {
      commit: identity.commit,
      tree: identity.tree,
      lockSha256: identity.lockSha256,
      distSha256: "d".repeat(64),
    },
    files,
    secretHandling: "fail_closed_no_secret_material",
  };
  await writeFile(path.join(root, "proof-manifest.json"), `${JSON.stringify(manifest)}\n`);
  return manifest;
}

function fileIdentity(relative, bytes) {
  return {
    path: relative,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
  };
}

function minimalPng() {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(1, 16);
  bytes.writeUInt32BE(1, 20);
  return bytes;
}

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
}
