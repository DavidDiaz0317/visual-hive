#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath } from "node:url";

export const PROOF_IMAGE_REFERENCE =
  "mcr.microsoft.com/playwright@sha256:9bd26ad900bb5e0f4dee75839e957a89ae89c2b7ab1e76050e559790e946b948";

const scriptPath = fileURLToPath(import.meta.url);
const visualHiveRoot = path.resolve(path.dirname(scriptPath), "..");
const sha256Pattern = /^[a-f0-9]{64}$/u;
const gitObjectPattern = /^[a-f0-9]{40}$/u;

export class SystemCommandRunner {
  async run(command, args, options = {}) {
    const timeoutMs = options.timeoutMs ?? 30_000;
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env ? { ...process.env, ...options.env } : process.env,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      const stdout = [];
      const stderr = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      const maxBytes = options.maxOutputBytes ?? 4 * 1024 * 1024;
      const append = (chunks, chunk, current) => {
        const remaining = Math.max(0, maxBytes - current);
        if (remaining > 0) chunks.push(chunk.subarray(0, remaining));
        return current + chunk.length;
      };
      child.stdout.on("data", (chunk) => {
        stdoutBytes = append(stdout, chunk, stdoutBytes);
      });
      child.stderr.on("data", (chunk) => {
        stderrBytes = append(stderr, chunk, stderrBytes);
      });
      const timer = setTimeout(() => {
        terminateProcess(child.pid);
      }, timeoutMs);
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("close", (exitCode, signal) => {
        clearTimeout(timer);
        const result = {
          exitCode: exitCode ?? 1,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
          signal,
        };
        if (stdoutBytes > maxBytes || stderrBytes > maxBytes) {
          reject(new Error(`${command} output exceeded ${maxBytes} bytes.`));
          return;
        }
        if (result.exitCode !== 0 && !options.allowFailure) {
          const outputDigest = sha256(
            Buffer.from(`${result.stderr}\0${result.stdout}`, "utf8"),
          );
          reject(
            new Error(
              `${command} exited ${result.exitCode}; command output withheld (sha256:${outputDigest}).`,
            ),
          );
          return;
        }
        resolve(result);
      });
    });
  }
}

export function validateImageReference(reference) {
  if (reference !== PROOF_IMAGE_REFERENCE) {
    throw new Error(
      `Proof image must be the reviewed repository digest ${PROOF_IMAGE_REFERENCE}; mutable tags and digest drift are refused.`,
    );
  }
  const [repository, digest, extra] = reference.split("@");
  if (!repository || extra || !/^sha256:[a-f0-9]{64}$/u.test(digest ?? "")) {
    throw new Error("Proof image must use one immutable repository@sha256 digest.");
  }
  return { repository, digest };
}

export async function inspectCleanRepository({
  root,
  expectedCommit,
  expectedTree,
  lockPath,
  expectedLockSha256,
  runner,
  label,
}) {
  assertGitObject(expectedCommit, `${label} commit`);
  assertGitObject(expectedTree, `${label} tree`);
  assertSha256(expectedLockSha256, `${label} lock digest`);
  const canonicalRoot = await realpath(path.resolve(root));
  const gitRoot = await git(runner, canonicalRoot, ["rev-parse", "--show-toplevel"]);
  if (!samePath(await realpath(gitRoot), canonicalRoot)) {
    throw new Error(`${label} root must be the exact git worktree root.`);
  }
  const commit = await git(runner, canonicalRoot, ["rev-parse", "HEAD"]);
  const tree = await git(runner, canonicalRoot, ["rev-parse", "HEAD^{tree}"]);
  if (commit !== expectedCommit || tree !== expectedTree) {
    throw new Error(
      `${label} identity mismatch: expected ${expectedCommit}/${expectedTree}, got ${commit}/${tree}.`,
    );
  }
  const status = await git(
    runner,
    canonicalRoot,
    ["status", "--porcelain=v1", "--untracked-files=all"],
    true,
  );
  if (status) throw new Error(`${label} worktree must be clean: ${status}`);
  await assertTrackedFilesAreOrdinary(canonicalRoot, runner, label);
  const canonicalLock = await assertOrdinaryContainedFile(
    canonicalRoot,
    path.resolve(canonicalRoot, lockPath),
    `${label} lockfile`,
  );
  const lockSha256 = sha256(await readFile(canonicalLock));
  if (lockSha256 !== expectedLockSha256) {
    throw new Error(
      `${label} lock digest mismatch: expected ${expectedLockSha256}, got ${lockSha256}.`,
    );
  }
  return { root: canonicalRoot, commit, tree, lockPath, lockSha256 };
}

export async function runDockerProof(input, runner) {
  const mode = input.mode;
  if (!new Set(["preliminary", "candidate"]).has(mode)) {
    throw new Error("Proof mode must be preliminary or candidate.");
  }
  validateImageReference(input.image);
  const imageInspect = await runner.run(
    "docker",
    ["image", "inspect", input.image, "--format", "{{json .}}"],
    { timeoutMs: 15_000 },
  );
  const image = parseJsonLine(imageInspect.stdout, "Docker image inspection");
  if (!Array.isArray(image.RepoDigests) || !image.RepoDigests.includes(input.image)) {
    throw new Error("The locally available image does not advertise the required repository digest.");
  }
  if (!/^sha256:[a-f0-9]{64}$/u.test(String(image.Id ?? ""))) {
    throw new Error("Docker image inspection returned no immutable image ID.");
  }

  const runId = `vh-proof-${randomBytes(8).toString("hex")}`;
  const networkName = `${runId}-net`;
  const containerName = `${runId}-container`;
  const targetExecOptions = ["--user", "pwuser", "--env", "HOME=/home/pwuser"];
  let networkCreated = false;
  let containerCreated = false;
  let primaryError;
  let proofResult;
  const cleanupErrors = [];
  const sealedAttestations = new Map();
  try {
    await runner.run(
      "docker",
      ["network", "create", "--driver", "bridge", "--label", `visual-hive.proof=${runId}`, networkName],
      { timeoutMs: 15_000 },
    );
    networkCreated = true;
    const mount = `type=bind,source=${input.bundleRoot},target=/proof/input,readonly`;
    const create = await runner.run(
      "docker",
      [
        "create",
        "--name",
        containerName,
        "--network",
        networkName,
        "--init",
        "--ipc",
        "private",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--shm-size",
        "2g",
        "--mount",
        mount,
        "--env",
        "CI=true",
        "--env",
        "VISUAL_HIVE_CI=true",
        "--env",
        "TZ=UTC",
        "--env",
        "LANG=C.UTF-8",
        "--env",
        "LC_ALL=C.UTF-8",
        "--env",
        "PLAYWRIGHT_BROWSERS_PATH=/ms-playwright",
        "--env",
        "GITHUB_TOKEN=",
        "--env",
        "GH_TOKEN=",
        "--env",
        "OPENAI_API_KEY=",
        "--env",
        "ANTHROPIC_API_KEY=",
        "--env",
        "VISUAL_HIVE_LIVE_GITHUB_ISSUE=false",
        input.image,
        "sleep",
        "infinity",
      ],
      { timeoutMs: 15_000 },
    );
    if (!create.stdout.trim()) throw new Error("Docker create returned no container identity.");
    containerCreated = true;
    await docker(runner, ["start", containerName], 15_000);
    await dockerExec(runner, containerName, ["mkdir", "-p", "/work", "/proof"]);
    await dockerExec(runner, containerName, ["git", "clone", "/proof/input/visual-hive.bundle", "/work/visual-hive"], 60_000);
    await dockerExec(runner, containerName, ["git", "-C", "/work/visual-hive", "checkout", "--detach", input.visual.commit]);

    await dockerExec(
      runner,
      containerName,
      ["npm", "ci", "--no-audit", "--no-fund"],
      600_000,
      "/work/visual-hive",
    );
    await dockerExec(runner, containerName, ["npm", "run", "build"], 600_000, "/work/visual-hive");
    await dockerExec(runner, containerName, ["chmod", "-R", "a-w", "/work/visual-hive"], 60_000);
    const helper = "/work/visual-hive/scripts/proof-harness-container.mjs";
    await dockerExec(runner, containerName, ["chmod", "0777", "/work"]);
    await dockerExec(
      runner,
      containerName,
      ["mkdir", "/work/target"],
      30_000,
      "/work",
      false,
      targetExecOptions,
    );
    await dockerExec(runner, containerName, ["chmod", "0755", "/work"]);
    await dockerExec(
      runner,
      containerName,
      ["git", "clone", "/proof/input/target.bundle", "/work/target"],
      60_000,
      "/work",
      false,
      targetExecOptions,
    );
    await dockerExec(
      runner,
      containerName,
      ["git", "checkout", "--detach", input.target.commit],
      30_000,
      "/work/target",
      false,
      targetExecOptions,
    );
    await dockerExec(
      runner,
      containerName,
      ["npm", "--prefix", "dashboard", "ci", "--no-audit", "--no-fund"],
      600_000,
      "/work/target",
      false,
      targetExecOptions,
    );
    await dockerExec(
      runner,
      containerName,
      ["npm", "--prefix", "dashboard", "run", "build"],
      600_000,
      "/work/target",
      false,
      [...targetExecOptions, "--env", "VITE_DASHBOARD_API_URL=http://127.0.0.1:18010"],
    );
    await dockerExec(
      runner,
      containerName,
      ["node", helper, "quiesce-user"],
      30_000,
      "/work/target",
      false,
      targetExecOptions,
    );
    await dockerExec(
      runner,
      containerName,
      [
        "node",
        helper,
        "attest-inputs",
        "--target-root",
        "/work/target",
        "--visual-root",
        "/work/visual-hive",
        "--target-commit",
        input.target.commit,
        "--target-tree",
        input.target.tree,
        "--target-lock-sha256",
        input.target.lockSha256,
        "--visual-commit",
        input.visual.commit,
        "--visual-tree",
        input.visual.tree,
        "--visual-lock-sha256",
        input.visual.lockSha256,
        "--image-reference",
        input.image,
        "--image-id",
        image.Id,
        "--output",
        "/proof/input-attestation.json",
      ],
      60_000,
      "/work/target",
    );
    sealedAttestations.set(
      "/proof/input-attestation.json",
      await containerFileSha256(runner, containerName, "/proof/input-attestation.json"),
    );

    await dockerExec(
      runner,
      containerName,
      ["node", "scripts/testing/visual-hive-proof-preflight.mjs"],
      60_000,
      "/work/target",
      false,
      [...targetExecOptions, "--env", `VISUAL_HIVE_PROOF_NAMESPACE=${runId}`],
    );
    await dockerExec(
      runner,
      containerName,
      ["node", helper, "quiesce-user"],
      30_000,
      "/work/target",
      false,
      targetExecOptions,
    );
    const sourcePreflight = `/work/target/artifacts/visual-hive-proof/${runId}/source-integrity.json`;
    await dockerExec(
      runner,
      containerName,
      [
        "node",
        helper,
        "verify-source",
        "--input-attestation",
        "/proof/input-attestation.json",
        "--source-preflight",
        sourcePreflight,
        "--frozen-source-output",
        "/proof/source-preflight.json",
        "--output",
        "/proof/source-attestation.json",
      ],
      30_000,
      "/work/target",
    );
    sealedAttestations.set(
      "/proof/source-attestation.json",
      await containerFileSha256(runner, containerName, "/proof/source-attestation.json"),
    );
    sealedAttestations.set(
      "/proof/source-preflight.json",
      await containerFileSha256(runner, containerName, "/proof/source-preflight.json"),
    );

    await docker(runner, ["network", "disconnect", "--force", networkName, containerName], 15_000);
    const containerInspect = await docker(
      runner,
      ["inspect", containerName, "--format", "{{json .}}"],
      15_000,
    );
    const containerState = parseJsonLine(containerInspect.stdout, "Docker container inspection");
    assertContainerIsolationState(containerState);
    const ports = await docker(runner, ["port", containerName], 15_000);
    if (ports.stdout.trim()) throw new Error("Proof container unexpectedly publishes a host port.");
    const dockerState = Buffer.from(JSON.stringify(containerState), "utf8").toString("base64");
    await dockerExec(
      runner,
      containerName,
      [
        "node",
        helper,
        "prove-isolation",
        "--docker-state-base64",
        dockerState,
        "--output",
        "/proof/isolation.json",
      ],
      30_000,
      "/work/target",
    );
    sealedAttestations.set(
      "/proof/isolation.json",
      await containerFileSha256(runner, containerName, "/proof/isolation.json"),
    );

    const cli = "/work/visual-hive/packages/cli/dist/index.js";
    if (mode === "preliminary") {
      await dockerExec(
        runner,
        containerName,
        [
          "node",
          cli,
          "pipeline",
          "--config",
          "visual-hive.config.yaml",
          "--mode",
          "pr",
          "--ci",
          "--enforce-mutation",
          "--skip-install",
          "--skip-build",
          "--runtime-sidecar",
          ".visual-hive/proof/preliminary/runtime.json",
        ],
        1_200_000,
        "/work/target",
        false,
        targetExecOptions,
      );
    } else {
      await dockerExec(
        runner,
        containerName,
        [
          "node",
          cli,
          "plan",
          "--config",
          "visual-hive.config.yaml",
          "--mode",
          "pr",
          "--include-contract",
          "app-shell-visual-stability",
          "--exclude-contract",
          "app-shell-content-health",
          "--output",
          ".visual-hive/plan.visual-candidate.json",
        ],
        60_000,
        "/work/target",
        false,
        targetExecOptions,
      );
      await dockerExec(
        runner,
        containerName,
        [
          "node",
          helper,
          "verify-plan",
          "--plan",
          "/work/target/.visual-hive/plan.visual-candidate.json",
          "--expected-contract",
          "app-shell-visual-stability",
        ],
        30_000,
        "/work/target",
      );
      const candidate = await dockerExec(
        runner,
        containerName,
        [
          "node",
          cli,
          "run",
          "--config",
          "visual-hive.config.yaml",
          "--plan",
          ".visual-hive/plan.visual-candidate.json",
          "--ci",
          "--skip-install",
          "--skip-build",
          "--runtime-sidecar",
          ".visual-hive/proof/candidate/runtime.json",
        ],
        600_000,
        "/work/target",
        true,
        targetExecOptions,
      );
      if (candidate.exitCode === 0) {
        throw new Error("Candidate comparison unexpectedly passed; expected-red evidence was not produced.");
      }
    }

    await dockerExec(
      runner,
      containerName,
      ["node", helper, "quiesce-user"],
      30_000,
      "/work/target",
      false,
      targetExecOptions,
    );

    for (const [attestationPath, expectedDigest] of sealedAttestations) {
      const actualDigest = await containerFileSha256(runner, containerName, attestationPath);
      if (actualDigest !== expectedDigest) {
        throw new Error(`Root-owned proof attestation changed during target execution: ${attestationPath}.`);
      }
    }

    await dockerExec(
      runner,
      containerName,
      [
        "node",
        helper,
        "verify-run",
        "--mode",
        mode,
        "--target-root",
        "/work/target",
        "--input-attestation",
        "/proof/input-attestation.json",
        "--source-attestation",
        "/proof/source-attestation.json",
        "--isolation",
        "/proof/isolation.json",
        "--output-dir",
        "/proof/export",
      ],
      60_000,
      "/work/target",
    );
    await docker(runner, ["cp", `${containerName}:/proof/export/.`, input.output], 60_000);
    proofResult = {
      runId,
      mode,
      imageReference: input.image,
      imageId: image.Id,
      output: input.output,
    };
  } catch (error) {
    primaryError = error;
  } finally {
    if (containerCreated) {
      try {
        await runner.run("docker", ["rm", "--force", containerName], {
          allowFailure: false,
          timeoutMs: 30_000,
        });
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (networkCreated) {
      try {
        await runner.run("docker", ["network", "rm", networkName], {
          allowFailure: false,
          timeoutMs: 30_000,
        });
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
  }
  if (primaryError && cleanupErrors.length) {
    throw new Error(
      `${primaryError instanceof Error ? primaryError.message : String(primaryError)}; cleanup also failed: ${cleanupErrors
        .map((error) => error.message)
        .join("; ")}`,
    );
  }
  if (primaryError) throw primaryError;
  if (cleanupErrors.length) {
    throw new Error(
      `Proof cleanup failed: ${cleanupErrors.map((error) => error.message).join("; ")}`,
    );
  }
  return proofResult;
}

export async function verifyExportDirectory(output) {
  const root = await realpath(output);
  const files = await listOrdinaryFiles(root);
  if (!files.includes("proof-manifest.json")) {
    throw new Error("Proof export is missing proof-manifest.json.");
  }
  const manifestBytes = await readFile(path.join(root, "proof-manifest.json"));
  assertNoSecretMaterial(manifestBytes, "proof-manifest.json");
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (manifest.schemaVersion !== "visual-hive.outer-proof.v1") {
    throw new Error("Proof export manifest has an unsupported schema version.");
  }
  assertManifestSemantics(manifest);
  const declaredInOrder = manifest.files?.map((entry) => entry.path);
  const declared = [...(declaredInOrder ?? [])].sort();
  if (JSON.stringify(declaredInOrder) !== JSON.stringify(declared) || new Set(declared).size !== declared.length) {
    throw new Error("Proof export manifest file identities must be unique and deterministically sorted.");
  }
  const actual = files.filter((entry) => entry !== "proof-manifest.json").sort();
  if (JSON.stringify(declared) !== JSON.stringify(actual)) {
    throw new Error("Proof export file set does not match its manifest.");
  }
  for (const entry of manifest.files) {
    if (!sha256Pattern.test(entry.sha256) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0) {
      throw new Error(`Proof export has malformed file identity for ${entry.path}.`);
    }
    const bytes = await readFile(path.join(root, entry.path));
    if (entry.path.endsWith(".png")) assertPngBytes(bytes, entry.path);
    assertNoSecretMaterial(bytes, entry.path);
    if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256) {
      throw new Error(`Proof export digest mismatch for ${entry.path}.`);
    }
    if (entry.path.includes("snapshots/") || entry.path.endsWith("baseline.png")) {
      throw new Error(`Proof export must not copy or approve a baseline: ${entry.path}.`);
    }
  }
  return manifest;
}

function assertManifestSemantics(manifest) {
  assertExactKeys(
    manifest,
    [
      "approvalStatus",
      "baselineUpdatesAllowed",
      "files",
      "image",
      "mode",
      "schemaVersion",
      "secretHandling",
      "status",
      "target",
      "visualHive",
    ],
    "proof manifest",
  );
  assertExactKeys(manifest.image, ["id", "reference"], "proof image identity");
  assertExactKeys(manifest.target, ["commit", "lockSha256", "tree"], "target identity");
  assertExactKeys(
    manifest.visualHive,
    ["commit", "distSha256", "lockSha256", "tree"],
    "Visual Hive identity",
  );
  if (!Array.isArray(manifest.files)) throw new Error("Proof export manifest files must be an array.");
  for (const entry of manifest.files) {
    assertExactKeys(entry, ["bytes", "path", "sha256"], "proof file identity");
    if (typeof entry.path !== "string") throw new Error("Proof export manifest file path must be a string.");
  }
  const expectedStatus = {
    preliminary: "passed",
    candidate: "expected_red_for_human_review",
  }[manifest.mode];
  if (
    !expectedStatus ||
    manifest.status !== expectedStatus ||
    manifest.approvalStatus !== "not_approved" ||
    manifest.baselineUpdatesAllowed !== false ||
    manifest.secretHandling !== "fail_closed_no_secret_material"
  ) {
    throw new Error("Proof export manifest does not preserve the reviewed mode, status, or no-approval policy.");
  }
  if (
    manifest.image?.reference !== PROOF_IMAGE_REFERENCE ||
    !/^sha256:[a-f0-9]{64}$/u.test(manifest.image?.id ?? "")
  ) {
    throw new Error("Proof export manifest is not bound to the reviewed immutable image identity.");
  }
  for (const [value, label, pattern] of [
    [manifest.target?.commit, "target commit", gitObjectPattern],
    [manifest.target?.tree, "target tree", gitObjectPattern],
    [manifest.target?.lockSha256, "target lock digest", sha256Pattern],
    [manifest.visualHive?.commit, "Visual Hive commit", gitObjectPattern],
    [manifest.visualHive?.tree, "Visual Hive tree", gitObjectPattern],
    [manifest.visualHive?.lockSha256, "Visual Hive lock digest", sha256Pattern],
    [manifest.visualHive?.distSha256, "Visual Hive dist digest", sha256Pattern],
  ]) {
    if (!pattern.test(value ?? "")) throw new Error(`Proof export manifest has no valid ${label}.`);
  }

  const paths = manifest.files?.map((entry) => entry.path) ?? [];
  const common = [
    "attestations/input.json",
    "attestations/isolation.json",
    "attestations/run.json",
    "attestations/source.json",
    "attestations/target-source-preflight.json",
    "visual-hive/report.json",
    "visual-hive/runtime.json",
  ];
  if (manifest.mode === "preliminary") {
    const expected = [
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
    ].sort();
    if (JSON.stringify([...paths].sort()) !== JSON.stringify(expected)) {
      throw new Error("Preliminary proof export does not contain exactly the reviewed evidence allowlist.");
    }
    return;
  }

  const fixed = new Set([...common, "visual-hive/plan.visual-candidate.json"]);
  const candidates = paths.filter((entry) => /^candidates\/[^/]+\.png$/u.test(entry));
  const diffs = paths.filter((entry) => /^diffs\/[^/]+\.png$/u.test(entry));
  if (
    candidates.length !== 2 ||
    diffs.length !== 2 ||
    paths.some(
      (entry) => !fixed.has(entry) && !/^candidates\/[^/]+\.png$/u.test(entry) && !/^diffs\/[^/]+\.png$/u.test(entry),
    ) ||
    paths.length !== fixed.size + 4
  ) {
    throw new Error("Candidate proof export does not contain exactly two candidates, two diffs, and reviewed attestations.");
  }
}

function assertExactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const keys = Object.keys(value).sort();
  const required = [...expected].sort();
  if (JSON.stringify(keys) !== JSON.stringify(required)) {
    throw new Error(`${label} has unexpected or missing fields.`);
  }
}

function assertPngBytes(bytes, label) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (
    bytes.length < 33 ||
    !bytes.subarray(0, signature.length).equals(signature) ||
    bytes.subarray(12, 16).toString("ascii") !== "IHDR" ||
    bytes.readUInt32BE(16) === 0 ||
    bytes.readUInt32BE(20) === 0
  ) {
    throw new Error(`Proof export contains malformed PNG evidence: ${label}.`);
  }
}

function assertNoSecretMaterial(bytes, label) {
  if (/\.png$/iu.test(label)) return;
  const text = bytes.toString("utf8");
  const secretPatterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
    /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/u,
    /\bAKIA[0-9A-Z]{16}\b/u,
    /["']?(?:authorization|access[_-]?token|api[_-]?key|client[_-]?secret|password)["']?\s*[:=]\s*["'](?:bearer\s+)?[^"'\s]{8,}["']/iu,
  ];
  if (secretPatterns.some((pattern) => pattern.test(text))) {
    throw new Error(`Proof export contains secret-shaped material: ${label}.`);
  }
  for (const [name, value] of Object.entries(process.env)) {
    if (
      /token|secret|password|credential|private[_-]?key/iu.test(name) &&
      value &&
      value.length >= 8 &&
      text.includes(value)
    ) {
      throw new Error(`Proof export contains the value of sensitive environment variable ${name}: ${label}.`);
    }
  }
}

export async function runProofHarness(options, runner = new SystemCommandRunner()) {
  validateImageReference(options.image);
  const requestedOutput = path.resolve(options.output);
  const output = path.join(await realpath(path.dirname(requestedOutput)), path.basename(requestedOutput));
  const target = await inspectCleanRepository({
    root: options.targetRoot,
    expectedCommit: options.targetCommit,
    expectedTree: options.targetTree,
    lockPath: "dashboard/package-lock.json",
    expectedLockSha256: options.targetLockSha256,
    runner,
    label: "target",
  });
  const visual = await inspectCleanRepository({
    root: options.visualRoot,
    expectedCommit: options.visualCommit,
    expectedTree: options.visualTree,
    lockPath: "package-lock.json",
    expectedLockSha256: options.visualLockSha256,
    runner,
    label: "Visual Hive",
  });
  if (isContained(target.root, output) || isContained(visual.root, output)) {
    throw new Error("Proof output must be outside both source worktrees.");
  }
  await mkdir(output, { recursive: false });
  let staging;
  try {
    staging = await mkdtemp(path.join(os.tmpdir(), "visual-hive-proof-"));
    if (staging.includes(",")) throw new Error("Docker proof staging path must not contain commas.");
    await runner.run("git", ["-C", visual.root, "bundle", "create", path.join(staging, "visual-hive.bundle"), "HEAD"], {
      timeoutMs: 120_000,
    });
    await runner.run("git", ["-C", target.root, "bundle", "create", path.join(staging, "target.bundle"), "HEAD"], {
      timeoutMs: 120_000,
    });
    const result = await runDockerProof(
      {
        mode: options.mode,
        image: options.image,
        output,
        bundleRoot: staging,
        target,
        visual,
      },
      runner,
    );
    const manifest = await verifyExportDirectory(output);
    return { ...result, manifest };
  } catch (error) {
    await rm(output, { recursive: true, force: true });
    throw error;
  } finally {
    if (staging) await rm(staging, { recursive: true, force: true });
  }
}

async function assertTrackedFilesAreOrdinary(root, runner, label) {
  const listing = await git(runner, root, ["ls-files", "-z", "--stage"]);
  for (const record of listing.split("\0").filter(Boolean)) {
    const match = /^(\d{6}) [a-f0-9]{40} (\d)\t(.+)$/u.exec(record);
    if (!match) throw new Error(`${label} git index returned a malformed entry.`);
    const [, mode, stage, relative] = match;
    if (stage !== "0" || !new Set(["100644", "100755"]).has(mode)) {
      throw new Error(`${label} contains a staged, linked, or non-regular tracked entry: ${relative}.`);
    }
    await assertOrdinaryContainedFile(root, path.resolve(root, relative), `${label} tracked file ${relative}`);
  }
}

async function assertOrdinaryContainedFile(root, candidate, label) {
  if (!isContained(root, candidate)) throw new Error(`${label} escapes its repository.`);
  const entry = await lstat(candidate);
  if (entry.isSymbolicLink() || !entry.isFile()) throw new Error(`${label} must be one ordinary file.`);
  const resolved = await realpath(candidate);
  if (!isContained(root, resolved) || !samePath(resolved, candidate)) {
    throw new Error(`${label} resolves through a symlink, junction, or reparse point.`);
  }
  return resolved;
}

async function listOrdinaryFiles(root, relative = "") {
  const directory = path.join(root, relative);
  const entry = await lstat(directory);
  if (entry.isSymbolicLink() || !entry.isDirectory() || !samePath(await realpath(directory), directory)) {
    throw new Error(`Proof export contains a linked or non-directory path: ${relative || "."}.`);
  }
  const files = [];
  for (const name of (await readdir(directory)).sort()) {
    const childRelative = path.posix.join(relative.replaceAll("\\", "/"), name);
    const child = path.join(directory, name);
    const childEntry = await lstat(child);
    if (childEntry.isSymbolicLink()) throw new Error(`Proof export contains a symlink: ${childRelative}.`);
    if (childEntry.isDirectory()) files.push(...(await listOrdinaryFiles(root, childRelative)));
    else if (childEntry.isFile()) files.push(childRelative);
    else throw new Error(`Proof export contains a non-regular file: ${childRelative}.`);
  }
  return files;
}

async function docker(runner, args, timeoutMs, allowFailure = false) {
  return runner.run("docker", args, { timeoutMs, allowFailure });
}

async function dockerExec(
  runner,
  container,
  command,
  timeoutMs = 30_000,
  workdir,
  allowFailure = false,
  extraOptions = [],
) {
  const args = ["exec", ...extraOptions];
  if (workdir) args.push("--workdir", workdir);
  args.push(container, ...command);
  return docker(runner, args, timeoutMs, allowFailure);
}

async function containerFileSha256(runner, container, file) {
  const result = await dockerExec(runner, container, ["sha256sum", file], 30_000);
  const digest = result.stdout.trim().split(/\s+/u)[0];
  if (!sha256Pattern.test(digest ?? "")) {
    throw new Error(`Container returned no SHA-256 identity for ${file}.`);
  }
  return digest;
}

function assertContainerIsolationState(state) {
  const networks = state?.NetworkSettings?.Networks;
  if (!networks || typeof networks !== "object" || Object.keys(networks).length !== 0) {
    throw new Error("Proof container remains attached to a Docker network.");
  }
  const ports = state?.NetworkSettings?.Ports;
  if (ports && Object.values(ports).some((value) => value !== null)) {
    throw new Error("Proof container has a published host port.");
  }
  const host = state?.HostConfig;
  const capDrop = host?.CapDrop?.map((entry) => String(entry).toUpperCase()) ?? [];
  const securityOpt = host?.SecurityOpt?.map(String) ?? [];
  const portBindings = host?.PortBindings;
  if (
    host?.IpcMode !== "private" ||
    !capDrop.includes("ALL") ||
    !securityOpt.some((entry) => entry === "no-new-privileges" || entry === "no-new-privileges:true") ||
    host?.Privileged !== false ||
    host?.ShmSize !== 2 * 1024 * 1024 * 1024 ||
    (portBindings && Object.keys(portBindings).length !== 0)
  ) {
    throw new Error("Proof container is missing private IPC, dropped capabilities, no-new-privileges, or fixed shared memory.");
  }
  const mounts = state?.Mounts;
  if (
    !Array.isArray(mounts) ||
    mounts.length !== 1 ||
    mounts[0]?.Type !== "bind" ||
    mounts[0]?.Destination !== "/proof/input" ||
    mounts[0]?.RW !== false
  ) {
    throw new Error("Proof container must expose only the read-only proof bundle bind mount.");
  }
  const environment = new Map(
    (state?.Config?.Env ?? []).map((entry) => {
      const separator = entry.indexOf("=");
      return [separator < 0 ? entry : entry.slice(0, separator), separator < 0 ? "" : entry.slice(separator + 1)];
    }),
  );
  for (const [name, expected] of [
    ["CI", "true"],
    ["VISUAL_HIVE_CI", "true"],
    ["GITHUB_TOKEN", ""],
    ["GH_TOKEN", ""],
    ["OPENAI_API_KEY", ""],
    ["ANTHROPIC_API_KEY", ""],
    ["VISUAL_HIVE_LIVE_GITHUB_ISSUE", "false"],
  ]) {
    if (environment.get(name) !== expected) {
      throw new Error(`Proof container environment is not sanitized for ${name}.`);
    }
  }
}

async function git(runner, cwd, args, allowEmpty = false) {
  const result = await runner.run("git", ["-C", cwd, ...args], { timeoutMs: 30_000 });
  const value = result.stdout.trim();
  if (!allowEmpty && !value) throw new Error(`git ${args.join(" ")} returned no value.`);
  return value;
}

function parseJsonLine(value, label) {
  try {
    return JSON.parse(value.trim());
  } catch {
    throw new Error(`${label} returned malformed JSON.`);
  }
}

function assertGitObject(value, label) {
  if (!gitObjectPattern.test(value ?? "")) throw new Error(`${label} must be a 40-character lowercase SHA.`);
}

function assertSha256(value, label) {
  if (!sha256Pattern.test(value ?? "")) throw new Error(`${label} must be a lowercase SHA-256 digest.`);
}

function isContained(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function samePath(left, right) {
  const normalize = (value) =>
    process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
  return normalize(left) === normalize(right);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function terminateProcess(pid) {
  if (!pid) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(pid), "/t", "/f"], {
      windowsHide: true,
      stdio: "ignore",
    });
  } else {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // The bounded child already exited.
    }
  }
}

export function parseArguments(argv) {
  if (argv.includes("--help")) {
    if (argv.length !== 1) throw new Error("--help cannot be combined with proof execution arguments.");
    return { help: true };
  }
  const allowed = new Set([
    "--mode",
    "--target-root",
    "--target-commit",
    "--target-tree",
    "--target-lock-sha256",
    "--visual-hive-root",
    "--visual-hive-commit",
    "--visual-hive-tree",
    "--visual-hive-lock-sha256",
    "--image",
    "--output",
  ]);
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error(`Expected --name value arguments; malformed token ${key ?? "<missing>"}.`);
    }
    if (!allowed.has(key)) throw new Error(`Unknown proof harness argument ${key}.`);
    if (values.has(key)) throw new Error(`Duplicate argument ${key}.`);
    values.set(key, value);
  }
  const required = (name) => {
    const value = values.get(name);
    if (!value) throw new Error(`${name} is required.`);
    return value;
  };
  return {
    mode: required("--mode"),
    targetRoot: required("--target-root"),
    targetCommit: required("--target-commit"),
    targetTree: required("--target-tree"),
    targetLockSha256: required("--target-lock-sha256"),
    visualRoot: values.get("--visual-hive-root") ?? visualHiveRoot,
    visualCommit: required("--visual-hive-commit"),
    visualTree: required("--visual-hive-tree"),
    visualLockSha256: required("--visual-hive-lock-sha256"),
    image: values.get("--image") ?? PROOF_IMAGE_REFERENCE,
    output: required("--output"),
  };
}

function help() {
  return `Usage: node scripts/proof-harness.mjs \\
  --mode preliminary|candidate \\
  --target-root <clean-worktree> --target-commit <sha> --target-tree <sha> \\
  --target-lock-sha256 <sha256> \\
  --visual-hive-commit <sha> --visual-hive-tree <sha> \\
  --visual-hive-lock-sha256 <sha256> --output <new-directory>\n\nThe reviewed Playwright repository digest is fixed. The command never pulls an image, publishes ports, updates snapshots, or mutates a remote.`;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(help());
    return;
  }
  const result = await runProofHarness(options);
  console.log(
    JSON.stringify(
      {
        status: "verified",
        mode: result.mode,
        runId: result.runId,
        imageReference: result.imageReference,
        imageId: result.imageId,
        output: result.output,
        evidenceFiles: result.manifest.files.length,
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(`Visual Hive proof harness refused: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
