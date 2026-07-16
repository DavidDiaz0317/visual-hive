#!/usr/bin/env node

import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { lstat, mkdir, open, readFile, readdir, realpath } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath, pathToFileURL } from "node:url";

const sha256Pattern = /^[a-f0-9]{64}$/u;
const expectedPreliminary = "app-shell-content-health";
const expectedCandidate = "app-shell-visual-stability";
const scriptPath = fileURLToPath(import.meta.url);

async function attestInputs(args) {
  const targetRoot = await realpath(required(args, "--target-root"));
  const visualRoot = await realpath(required(args, "--visual-root"));
  const target = await repositoryIdentity(targetRoot, {
    commit: required(args, "--target-commit"),
    tree: required(args, "--target-tree"),
    lockPath: "dashboard/package-lock.json",
    lockSha256: required(args, "--target-lock-sha256"),
  });
  const visual = await repositoryIdentity(visualRoot, {
    commit: required(args, "--visual-commit"),
    tree: required(args, "--visual-tree"),
    lockPath: "package-lock.json",
    lockSha256: required(args, "--visual-lock-sha256"),
  });
  const cliPath = await ordinaryFile(visualRoot, path.join(visualRoot, "packages/cli/dist/index.js"));
  const loaderPath = await ordinaryFile(visualRoot, path.join(visualRoot, "packages/core/dist/config/load.js"));
  const plannerPath = await ordinaryFile(visualRoot, path.join(visualRoot, "packages/core/dist/planner/createPlan.js"));
  const { loadConfig } = await import(pathToFileURL(loaderPath).href);
  const { createPlan } = await import(pathToFileURL(plannerPath).href);
  const loaded = await loadConfig("visual-hive.config.yaml", targetRoot);
  assertReviewedConfig(loaded.config);
  assertPlan(createPlan(loaded.config, { mode: "pr", changedFiles: [] }), expectedPreliminary);
  assertPlan(
    createPlan(loaded.config, {
      mode: "pr",
      changedFiles: [],
      includeContracts: [expectedCandidate],
      excludeContracts: [expectedPreliminary],
    }),
    expectedCandidate,
  );

  const visualRequire = createRequire(path.join(visualRoot, "package.json"));
  const playwrightPackagePath = await ordinaryFile(
    visualRoot,
    visualRequire.resolve("@playwright/test/package.json"),
  );
  const playwrightPackage = JSON.parse(await readFile(playwrightPackagePath, "utf8"));
  if (playwrightPackage.version !== "1.60.0") {
    throw new Error(`Expected @playwright/test 1.60.0, got ${playwrightPackage.version}.`);
  }
  const { chromium } = visualRequire("@playwright/test");
  const chromiumPath = await ordinaryFile("/", chromium.executablePath());
  if (!chromiumPath.startsWith("/ms-playwright/")) {
    throw new Error(`Chromium must resolve from the immutable image inventory, got ${chromiumPath}.`);
  }
  const configPath = await ordinaryFile(targetRoot, path.join(targetRoot, "visual-hive.config.yaml"));
  const sourceManifestPath = await ordinaryFile(targetRoot, path.join(targetRoot, "proof-source-manifest.json"));
  const dist = await digestDist(visualRoot);
  const osRelease = await readFile("/etc/os-release", "utf8");
  const targetUid = Number(execFileSync("id", ["-u", "pwuser"], { encoding: "utf8" }).trim());
  const targetGid = Number(execFileSync("id", ["-g", "pwuser"], { encoding: "utf8" }).trim());
  if (!Number.isSafeInteger(targetUid) || targetUid <= 0 || !Number.isSafeInteger(targetGid) || targetGid <= 0) {
    throw new Error("The reviewed non-root pwuser identity is unavailable.");
  }
  const evidence = {
    schemaVersion: "visual-hive.outer-proof-input.v1",
    status: "verified",
    capturedAt: new Date().toISOString(),
    image: {
      reference: required(args, "--image-reference"),
      id: required(args, "--image-id"),
    },
    target: {
      ...target,
      configPath: "visual-hive.config.yaml",
      configSha256: sha256(await readFile(configPath)),
      sourceManifestPath: "proof-source-manifest.json",
      sourceManifestSha256: sha256(await readFile(sourceManifestPath)),
    },
    visualHive: {
      ...visual,
      cliPath: "packages/cli/dist/index.js",
      cliSha256: sha256(await readFile(cliPath)),
      configLoaderPath: "packages/core/dist/config/load.js",
      configLoaderSha256: sha256(await readFile(loaderPath)),
      dist,
    },
    runtime: {
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch,
      osReleaseSha256: sha256(Buffer.from(osRelease)),
      playwrightVersion: playwrightPackage.version,
      playwrightPackagePath,
      playwrightPackageSha256: sha256(await readFile(playwrightPackagePath)),
      chromiumExecutablePath: chromiumPath,
      chromiumExecutableSha256: await sha256File(chromiumPath),
      locale: Intl.DateTimeFormat().resolvedOptions().locale,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      targetExecutionUser: { name: "pwuser", uid: targetUid, gid: targetGid },
    },
    config: {
      loadedByExactBuild: true,
      baselineUpdatesAllowed: false,
      maxDiffPixelRatio: 0.01,
      preliminaryContracts: [expectedPreliminary],
      candidateContracts: [expectedCandidate],
    },
  };
  await writeJsonExclusive(required(args, "--output"), evidence);
}

async function verifySource(args) {
  const inputPath = required(args, "--input-attestation");
  const sourcePath = required(args, "--source-preflight");
  const frozenSourcePath = required(args, "--frozen-source-output");
  if (frozenSourcePath !== "/proof/source-preflight.json") {
    throw new Error("Frozen source preflight must use the reviewed root-owned evidence path.");
  }
  const verified = await readVerifiedSourceEvidence({
    inputRoot: "/",
    targetRoot: "/work/target",
    inputPath,
    sourcePath,
    frozenSourcePath,
  });
  await writeBytesExclusive(frozenSourcePath, verified.frozenBytes);
  await writeJsonExclusive(required(args, "--output"), verified.attestation);
}

export async function readVerifiedSourceEvidence({
  inputRoot,
  targetRoot,
  inputPath,
  sourcePath,
  frozenSourcePath,
}) {
  const inputEvidence = await readFrozenJson(inputRoot, inputPath);
  const sourceEvidence = await readFrozenJson(targetRoot, sourcePath);
  const input = inputEvidence.value;
  const source = sourceEvidence.value;
  if (input.status !== "verified" || source.status !== "ready") {
    throw new Error("Input or source attestation is not ready.");
  }
  if (
    source.repository?.commit !== input.target.commit ||
    source.repository?.tree !== input.target.tree ||
    source.inputs?.config?.sha256 !== input.target.configSha256 ||
    source.inputs?.sourceManifest?.sha256 !== input.target.sourceManifestSha256
  ) {
    throw new Error("Target source preflight does not bind the attested target/config inputs.");
  }
  if (source.inputs?.baselineUpdatesAllowed !== false || source.inputs?.snapshots?.length !== 18) {
    throw new Error("Target source preflight did not seal the complete no-update baseline set.");
  }
  if (!sha256Pattern.test(source.inputs.snapshotSetSha256 ?? "")) {
    throw new Error("Target source preflight has no snapshot-set digest.");
  }
  return {
    frozenBytes: sourceEvidence.bytes,
    attestation: {
      schemaVersion: "visual-hive.outer-proof-source.v1",
      status: "verified",
      capturedAt: new Date().toISOString(),
      sourcePreflight: sourcePath,
      frozenSourcePreflight: frozenSourcePath,
      sourcePreflightSha256: sha256(sourceEvidence.bytes),
      repository: source.repository,
      inputs: source.inputs,
    },
  };
}

async function proveIsolation(args) {
  const dockerState = JSON.parse(
    Buffer.from(required(args, "--docker-state-base64"), "base64").toString("utf8"),
  );
  const networks = dockerState.NetworkSettings?.Networks;
  if (!networks || Object.keys(networks).length !== 0) {
    throw new Error("Docker control-plane evidence shows an attached network.");
  }
  const ports = dockerState.NetworkSettings?.Ports;
  if (ports && Object.values(ports).some((value) => value !== null)) {
    throw new Error("Docker control-plane evidence shows a published port.");
  }
  const host = dockerState.HostConfig;
  const capDrop = host?.CapDrop?.map((entry) => String(entry).toUpperCase()) ?? [];
  const securityOpt = host?.SecurityOpt?.map(String) ?? [];
  if (
    host?.IpcMode !== "private" ||
    !capDrop.includes("ALL") ||
    !securityOpt.some((entry) => entry === "no-new-privileges" || entry === "no-new-privileges:true") ||
    host?.Privileged !== false ||
    host?.ShmSize !== 2 * 1024 * 1024 * 1024
  ) {
    throw new Error("Docker control-plane evidence does not bind the reviewed containment settings.");
  }
  const mounts = dockerState.Mounts;
  if (
    !Array.isArray(mounts) ||
    mounts.length !== 1 ||
    mounts[0]?.Type !== "bind" ||
    mounts[0]?.Destination !== "/proof/input" ||
    mounts[0]?.RW !== false
  ) {
    throw new Error("Docker control-plane evidence shows an unexpected or writable host mount.");
  }
  const routeTable = await readFile("/proc/net/route", "utf8");
  const defaultRoutes = routeTable
    .split(/\r?\n/u)
    .slice(1)
    .filter((line) => line.trim())
    .filter((line) => line.trim().split(/\s+/u)[1] === "00000000");
  if (defaultRoutes.length) throw new Error("Detached proof container still has a default route.");
  const probes = [];
  for (const [host, port] of [
    ["1.1.1.1", 443],
    ["registry.npmjs.org", 443],
    ["host.docker.internal", 80],
  ]) {
    probes.push(await expectConnectionRefused(host, port));
  }
  await writeJsonExclusive(required(args, "--output"), {
    schemaVersion: "visual-hive.outer-proof-isolation.v1",
    status: "isolated",
    capturedAt: new Date().toISOString(),
    docker: { networks: {}, publishedPorts: false },
    containment: {
      ipcMode: "private",
      capabilitiesDropped: ["ALL"],
      noNewPrivileges: true,
      privileged: false,
      sharedMemoryBytes: 2 * 1024 * 1024 * 1024,
      hostMounts: [{ destination: "/proof/input", readOnly: true }],
    },
    activeEgressProbes: probes,
    defaultRoutePresent: false,
    loopbackReservedForLocalTargetServices: true,
    hostPortsPublished: false,
  });
}

async function quiesceUser() {
  const uid = process.getuid?.();
  if (!Number.isSafeInteger(uid) || uid <= 0) {
    throw new Error("quiesce-user must run as the reviewed non-root execution user.");
  }
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const targets = (await processesForUid(uid)).filter((pid) => pid !== process.pid);
    if (targets.length === 0) return;
    for (const pid of targets) {
      try {
        process.kill(pid, "SIGKILL");
      } catch (error) {
        if (error?.code !== "ESRCH") throw error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const remaining = (await processesForUid(uid)).filter((pid) => pid !== process.pid);
  throw new Error(`Target execution user did not quiesce; remaining processes: ${remaining.join(", ")}.`);
}

async function verifyPlanCommand(args) {
  const plan = await readJsonOrdinary("/work/target", required(args, "--plan"));
  assertPlan(plan, required(args, "--expected-contract"));
}

async function verifyRun(args) {
  const mode = required(args, "--mode");
  if (!new Set(["preliminary", "candidate"]).has(mode)) throw new Error("Unsupported proof mode.");
  const targetRoot = await realpath(required(args, "--target-root"));
  const inputPath = required(args, "--input-attestation");
  const sourcePath = required(args, "--source-attestation");
  const isolationPath = required(args, "--isolation");
  const inputEvidence = await readFrozenJson("/", inputPath);
  const sourceEvidence = await readFrozenJson("/", sourcePath);
  const isolationEvidence = await readFrozenJson("/", isolationPath);
  const input = inputEvidence.value;
  const source = sourceEvidence.value;
  const isolation = isolationEvidence.value;
  if (input.status !== "verified" || source.status !== "verified" || isolation.status !== "isolated") {
    throw new Error("Proof prerequisite evidence is incomplete.");
  }
  const targetUser = input.runtime?.targetExecutionUser;
  if (targetUser?.name !== "pwuser" || !Number.isSafeInteger(targetUser.uid) || targetUser.uid <= 0) {
    throw new Error("Proof input does not bind the reviewed non-root target execution identity.");
  }
  const activeTargetProcesses = await processesForUid(targetUser.uid);
  if (activeTargetProcesses.length !== 0) {
    throw new Error(`Target execution user is not quiescent: ${activeTargetProcesses.join(", ")}.`);
  }
  const finalTarget = await repositoryIdentity(targetRoot, {
    commit: input.target.commit,
    tree: input.target.tree,
    lockPath: input.target.lockPath,
    lockSha256: input.target.lockSha256,
  });
  const visualRoot = await realpath("/work/visual-hive");
  const finalVisual = await repositoryIdentity(visualRoot, {
    commit: input.visualHive.commit,
    tree: input.visualHive.tree,
    lockPath: input.visualHive.lockPath,
    lockSha256: input.visualHive.lockSha256,
  });
  const finalDist = await digestDist(visualRoot);
  const finalCliSha256 = sha256(await readFile(await ordinaryFile(visualRoot, path.join(visualRoot, input.visualHive.cliPath))));
  const finalLoaderSha256 = sha256(
    await readFile(await ordinaryFile(visualRoot, path.join(visualRoot, input.visualHive.configLoaderPath))),
  );
  const finalPlaywrightPackageSha256 = sha256(await readFile(await ordinaryFile(visualRoot, input.runtime.playwrightPackagePath)));
  const finalChromiumSha256 = await sha256File(
    await ordinaryFile("/", input.runtime.chromiumExecutablePath),
  );
  if (
    finalTarget.commit !== input.target.commit ||
    finalVisual.commit !== input.visualHive.commit ||
    JSON.stringify(finalDist) !== JSON.stringify(input.visualHive.dist) ||
    finalCliSha256 !== input.visualHive.cliSha256 ||
    finalLoaderSha256 !== input.visualHive.configLoaderSha256 ||
    finalPlaywrightPackageSha256 !== input.runtime.playwrightPackageSha256 ||
    finalChromiumSha256 !== input.runtime.chromiumExecutableSha256
  ) {
    throw new Error("Target, Visual Hive build, Playwright package, or Chromium identity changed during proof execution.");
  }
  const snapshots = await verifySnapshotSet(targetRoot);
  if (snapshots.snapshotSetSha256 !== source.inputs.snapshotSetSha256) {
    throw new Error("Baseline snapshot set changed after the source preflight.");
  }
  if (source.frozenSourcePreflight !== "/proof/source-preflight.json") {
    throw new Error("Frozen source preflight does not use the reviewed root-owned evidence path.");
  }
  const frozenSourceEvidence = await readFrozenJson("/", source.frozenSourcePreflight);
  if (
    sha256(frozenSourceEvidence.bytes) !== source.sourcePreflightSha256 ||
    JSON.stringify(frozenSourceEvidence.value.repository) !== JSON.stringify(source.repository) ||
    JSON.stringify(frozenSourceEvidence.value.inputs) !== JSON.stringify(source.inputs)
  ) {
    throw new Error("Frozen source preflight bytes do not match their sealed source attestation.");
  }

  const selected = mode === "preliminary" ? expectedPreliminary : expectedCandidate;
  const planRelative = mode === "preliminary" ? ".visual-hive/plan.json" : ".visual-hive/plan.visual-candidate.json";
  const runtimeRelative = mode === "preliminary"
    ? ".visual-hive/proof/preliminary/runtime.json"
    : ".visual-hive/proof/candidate/runtime.json";
  const planEvidence = await readFrozenJson(targetRoot, path.join(targetRoot, planRelative));
  const reportEvidence = await readFrozenJson(targetRoot, path.join(targetRoot, ".visual-hive/report.json"));
  const runtimeEvidence = await readFrozenJson(targetRoot, path.join(targetRoot, runtimeRelative));
  const plan = planEvidence.value;
  const report = reportEvidence.value;
  const runtime = runtimeEvidence.value;
  assertPlan(plan, selected);
  assertReportAndRuntime(report, runtime, selected, input);
  if (report.summary?.baselinesCreated !== 0 || report.summary?.createdBaselines !== 0 || report.summary?.missingBaselines !== 0) {
    throw new Error("Proof run created or lacked a baseline.");
  }

  const evidence = [
    {
      source: inputEvidence.source,
      outputRelative: "attestations/input.json",
      allowedRoot: "/",
      frozenBytes: inputEvidence.bytes,
    },
    {
      source: sourceEvidence.source,
      outputRelative: "attestations/source.json",
      allowedRoot: "/",
      frozenBytes: sourceEvidence.bytes,
    },
    {
      source: frozenSourceEvidence.source,
      outputRelative: "attestations/target-source-preflight.json",
      allowedRoot: "/",
      frozenBytes: frozenSourceEvidence.bytes,
      expectedSha256: source.sourcePreflightSha256,
    },
    {
      source: isolationEvidence.source,
      outputRelative: "attestations/isolation.json",
      allowedRoot: "/",
      frozenBytes: isolationEvidence.bytes,
    },
    {
      source: planEvidence.source,
      outputRelative: `visual-hive/${path.basename(planRelative)}`,
      allowedRoot: targetRoot,
      frozenBytes: planEvidence.bytes,
    },
    {
      source: reportEvidence.source,
      outputRelative: "visual-hive/report.json",
      allowedRoot: targetRoot,
      frozenBytes: reportEvidence.bytes,
    },
    {
      source: runtimeEvidence.source,
      outputRelative: "visual-hive/runtime.json",
      allowedRoot: targetRoot,
      frozenBytes: runtimeEvidence.bytes,
    },
  ];
  let runDetails;
  if (mode === "preliminary") {
    const mutationEvidence = await readFrozenJson(
      targetRoot,
      path.join(targetRoot, ".visual-hive/mutation-report.json"),
    );
    const pipelineEvidence = await readFrozenJson(
      targetRoot,
      path.join(targetRoot, ".visual-hive/pipeline.json"),
    );
    const mutation = mutationEvidence.value;
    const pipeline = pipelineEvidence.value;
    assertPreliminary(report, mutation, pipeline);
    const assertedArtifacts = new Map([
      [".visual-hive/mutation-report.json", mutationEvidence],
      [".visual-hive/pipeline.json", pipelineEvidence],
    ]);
    const requiredArtifacts = [
      ".visual-hive/mutation-report.json",
      ".visual-hive/pipeline.json",
      ".visual-hive/evidence-packet.json",
      ".visual-hive/verdict.json",
      ".visual-hive/test-creation-plan.json",
      ".visual-hive/coverage.json",
      ".visual-hive/artifacts-index.json",
      ".visual-hive/capability-parity.json",
      ".visual-hive/hive/hive-export.json",
      ".visual-hive/hive/repair-work-orders.json",
      ".visual-hive/hive/hive-agent-policy.json",
    ];
    for (const relative of requiredArtifacts) {
      const asserted = assertedArtifacts.get(relative);
      evidence.push({
        source: asserted?.source ?? path.join(targetRoot, relative),
        outputRelative: `visual-hive/${relative.slice(".visual-hive/".length)}`,
        allowedRoot: targetRoot,
        frozenBytes: asserted?.bytes,
      });
    }
    runDetails = {
      status: "passed",
      selectedContracts: [selected],
      mutation: { score: mutation.score, minScore: mutation.minScore, operator: "api-500", killed: true },
    };
  } else {
    const screenshots = assertCandidateReport(report);
    for (const screenshot of screenshots) {
      const basename = path.basename(screenshot.actualPath);
      const actual = await readFrozenPng(targetRoot, path.join(targetRoot, screenshot.actualPath));
      const diff = await readFrozenPng(targetRoot, path.join(targetRoot, screenshot.diffPath));
      evidence.push({
        source: actual.source,
        outputRelative: `candidates/${basename}`,
        allowedRoot: targetRoot,
        frozenBytes: actual.bytes,
      });
      evidence.push({
        source: diff.source,
        outputRelative: `diffs/${path.basename(screenshot.diffPath)}`,
        allowedRoot: targetRoot,
        frozenBytes: diff.bytes,
      });
    }
    runDetails = {
      status: "expected_red",
      selectedContracts: [selected],
      candidateScreenshots: screenshots.map((screenshot) => ({
        name: screenshot.screenshotName,
        viewport: screenshot.viewport,
        actualDiffPixelRatio: screenshot.actualDiffPixelRatio,
        maxDiffPixelRatio: screenshot.maxDiffPixelRatio,
      })),
    };
  }

  const runAttestationPath = "/proof/run-attestation.json";
  await writeJsonExclusive(runAttestationPath, {
    schemaVersion: "visual-hive.outer-proof-run.v1",
    mode,
    capturedAt: new Date().toISOString(),
    baselineUpdatesAllowed: false,
    baselineSnapshotSetSha256: snapshots.snapshotSetSha256,
    runtime: {
      browser: runtime.browser,
      environment: runtime.environment,
      executionBinding: runtime.executionBinding,
    },
    ...runDetails,
  });
  const runEvidence = await readFrozenJson("/", runAttestationPath);
  evidence.push({
    source: runEvidence.source,
    outputRelative: "attestations/run.json",
    allowedRoot: "/",
    frozenBytes: runEvidence.bytes,
  });
  const outputRoot = required(args, "--output-dir");
  await mkdir(outputRoot, { recursive: false });
  const copied = [];
  for (const item of evidence) {
    copied.push(await copyOrdinaryEvidence(item, outputRoot));
  }
  copied.sort((left, right) => left.path.localeCompare(right.path));
  await verifyFrozenExport(outputRoot, mode, input);
  await writeJsonExclusive(path.join(outputRoot, "proof-manifest.json"), {
    schemaVersion: "visual-hive.outer-proof.v1",
    mode,
    status: mode === "preliminary" ? "passed" : "expected_red_for_human_review",
    approvalStatus: "not_approved",
    baselineUpdatesAllowed: false,
    image: input.image,
    target: {
      commit: input.target.commit,
      tree: input.target.tree,
      lockSha256: input.target.lockSha256,
    },
    visualHive: {
      commit: input.visualHive.commit,
      tree: input.visualHive.tree,
      lockSha256: input.visualHive.lockSha256,
      distSha256: input.visualHive.dist.sha256,
    },
    files: copied,
    secretHandling: "fail_closed_no_secret_material",
  });
}

function assertReviewedConfig(config) {
  const target = config.targets?.localPreview;
  const content = config.contracts?.find((contract) => contract.id === expectedPreliminary);
  const visual = config.contracts?.find((contract) => contract.id === expectedCandidate);
  const operators = config.mutation?.operators ?? [];
  if (
    target?.kind !== "commandGroup" ||
    JSON.stringify(target.setup) !== JSON.stringify(["VITE_DASHBOARD_API_URL=http://127.0.0.1:18010 npm --prefix dashboard run build"]) ||
    !content || content.screenshots.length !== 0 ||
    !visual || visual.screenshots.length !== 2 ||
    visual.runOn.pullRequest !== false || visual.runOn.schedule !== false ||
    config.visual.updateSnapshots !== false ||
    config.visual.maxDiffPixelRatio !== 0.01 ||
    operators.length !== 1 || operators[0].id !== "api-500" ||
    JSON.stringify(operators[0].contracts) !== JSON.stringify([expectedPreliminary])
  ) {
    throw new Error("Exact config loader did not produce the reviewed proof topology.");
  }
}

function assertPlan(plan, expectedContract) {
  const contracts = plan.items?.map((item) => item.contractId);
  if (JSON.stringify(contracts) !== JSON.stringify([expectedContract])) {
    throw new Error(`Plan drift: expected only ${expectedContract}, got ${JSON.stringify(contracts)}.`);
  }
  if (plan.targets?.length !== 1 || plan.targets[0].id !== "localPreview") {
    throw new Error("Proof plan must select only the reviewed localPreview target.");
  }
}

function assertReportAndRuntime(report, runtime, expectedContract, input) {
  if (
    JSON.stringify(report.selectedContracts) !== JSON.stringify([expectedContract]) ||
    report.results?.length !== 1 ||
    report.results[0].contractId !== expectedContract ||
    !report.executionBinding
  ) {
    throw new Error("Visual Hive report does not bind the exact planned contract execution.");
  }
  if (
    runtime.schemaVersion !== "visual-hive.playwright-runtime.v1" ||
    JSON.stringify(runtime.executionBinding) !== JSON.stringify(report.executionBinding) ||
    !runtime.browser?.name || !runtime.browser?.version || runtime.browser.name === "unavailable" ||
    runtime.environment?.nodeVersion !== input.runtime.nodeVersion ||
    runtime.environment?.playwrightVersion !== input.runtime.playwrightVersion ||
    !Array.isArray(runtime.environment?.fonts) || runtime.environment.fonts.length < 1 ||
    runtime.environment.fonts.some((font) => !font.name || typeof font.available !== "boolean")
  ) {
    throw new Error("Visual Hive runtime sidecar is missing or does not bind the actual browser/runtime/font identity.");
  }
}

function assertPreliminary(report, mutation, pipeline) {
  const result = mutation.results?.[0];
  const screenshots = report.results.flatMap((item) => item.screenshotAssertions ?? []);
  if (report.status !== "passed" || report.results[0].status !== "passed" || screenshots.length !== 0) {
    throw new Error("Preliminary deterministic health contract did not pass.");
  }
  if (
    mutation.results?.length !== 1 || result.operator !== "api-500" || result.killed !== true ||
    result.applicable !== true || JSON.stringify(result.contractIds) !== JSON.stringify([expectedPreliminary]) ||
    mutation.score !== 1 || mutation.score < mutation.minScore
  ) {
    throw new Error("Preliminary mutation evidence is incomplete or drifted from api-500.");
  }
  if (
    pipeline.status !== "passed" || pipeline.exitCode !== 0 ||
    pipeline.options?.ci !== true || pipeline.options?.enforceMutation !== true ||
    pipeline.options?.skipInstall !== true || pipeline.options?.skipBuild !== true ||
    pipeline.steps?.some((step) => step.status === "failed")
  ) {
    throw new Error("Strict preliminary pipeline did not finish completely green.");
  }
}

function assertCandidateReport(report) {
  const screenshots = report.results.flatMap((result) => result.screenshotAssertions ?? []);
  if (report.status !== "failed" || report.results.length !== 1 || screenshots.length !== 2) {
    throw new Error("Candidate run must be expected-red with exactly two screenshot comparisons.");
  }
  for (const screenshot of screenshots) {
    if (
      screenshot.status !== "failed" ||
      !screenshot.actualPath ||
      !screenshot.diffPath ||
      !(screenshot.actualDiffPixelRatio > screenshot.maxDiffPixelRatio)
    ) {
      throw new Error(`Candidate screenshot ${screenshot.screenshotName ?? "unknown"} is incomplete or not expected-red.`);
    }
  }
  return screenshots;
}

async function verifyFrozenExport(outputRoot, mode, input) {
  const selected = mode === "preliminary" ? expectedPreliminary : expectedCandidate;
  const planName = mode === "preliminary" ? "plan.json" : "plan.visual-candidate.json";
  const plan = await readJsonOrdinary(outputRoot, path.join(outputRoot, "visual-hive", planName));
  const report = await readJsonOrdinary(outputRoot, path.join(outputRoot, "visual-hive/report.json"));
  const runtime = await readJsonOrdinary(outputRoot, path.join(outputRoot, "visual-hive/runtime.json"));
  const run = await readJsonOrdinary(outputRoot, path.join(outputRoot, "attestations/run.json"));
  assertPlan(plan, selected);
  assertReportAndRuntime(report, runtime, selected, input);
  if (
    report.summary?.baselinesCreated !== 0 ||
    report.summary?.createdBaselines !== 0 ||
    report.summary?.missingBaselines !== 0 ||
    run.mode !== mode ||
    run.baselineUpdatesAllowed !== false ||
    JSON.stringify(run.runtime?.executionBinding) !== JSON.stringify(runtime.executionBinding)
  ) {
    throw new Error("Frozen proof export does not preserve its no-baseline run/runtime binding.");
  }
  if (mode === "preliminary") {
    const mutation = await readJsonOrdinary(outputRoot, path.join(outputRoot, "visual-hive/mutation-report.json"));
    const pipeline = await readJsonOrdinary(outputRoot, path.join(outputRoot, "visual-hive/pipeline.json"));
    assertPreliminary(report, mutation, pipeline);
    return;
  }

  const screenshots = assertCandidateReport(report);
  const candidatePaths = await walkOrdinary(path.join(outputRoot, "candidates"), outputRoot, true);
  const diffPaths = await walkOrdinary(path.join(outputRoot, "diffs"), outputRoot, true);
  const expectedCandidates = screenshots.map((item) => `candidates/${path.basename(item.actualPath)}`).sort();
  const expectedDiffs = screenshots.map((item) => `diffs/${path.basename(item.diffPath)}`).sort();
  if (
    JSON.stringify(candidatePaths.sort()) !== JSON.stringify(expectedCandidates) ||
    JSON.stringify(diffPaths.sort()) !== JSON.stringify(expectedDiffs)
  ) {
    throw new Error("Frozen candidate PNG set does not match the asserted expected-red report.");
  }
  for (const relative of [...candidatePaths, ...diffPaths]) {
    await readFrozenPng(outputRoot, path.join(outputRoot, relative));
  }
}

async function repositoryIdentity(root, expected) {
  const commit = git(root, ["rev-parse", "HEAD"]);
  const tree = git(root, ["rev-parse", "HEAD^{tree}"]);
  const status = git(root, ["status", "--porcelain=v1", "--untracked-files=all"], true);
  if (commit !== expected.commit || tree !== expected.tree || status) {
    throw new Error(`Repository identity/cleanliness mismatch for ${root}.`);
  }
  const lockFile = await ordinaryFile(root, path.join(root, expected.lockPath));
  const trackedLockPath = path.relative(root, lockFile).replaceAll("\\", "/");
  const lockSha256 = sha256(gitBytes(root, ["show", `HEAD:${trackedLockPath}`]));
  if (lockSha256 !== expected.lockSha256) throw new Error(`Lock digest mismatch for ${root}.`);
  return { commit, tree, lockPath: expected.lockPath, lockSha256 };
}

async function digestDist(visualRoot) {
  const packagesRoot = path.join(visualRoot, "packages");
  const files = [];
  for (const packageName of (await readdir(packagesRoot)).sort()) {
    const distRoot = path.join(packagesRoot, packageName, "dist");
    try {
      files.push(...(await walkOrdinary(distRoot, visualRoot)));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  if (!files.length) throw new Error("Visual Hive build produced no package dist files.");
  const records = [];
  for (const file of files.sort()) {
    const bytes = await readFile(path.join(visualRoot, file));
    records.push({ path: file, sha256: sha256(bytes), bytes: bytes.length });
  }
  return {
    files: records.length,
    bytes: records.reduce((sum, item) => sum + item.bytes, 0),
    sha256: sha256(Buffer.from(records.map((item) => `${item.path}\0${item.sha256}\0${item.bytes}\n`).join(""))),
  };
}

async function verifySnapshotSet(targetRoot) {
  const manifest = await readJsonOrdinary(targetRoot, path.join(targetRoot, "proof-source-manifest.json"));
  if (manifest.invariants?.baselineUpdatesAllowed !== false || manifest.retainedBaselines?.algorithm !== "sha256") {
    throw new Error("Proof source manifest permits baseline updates or lacks SHA-256 identities.");
  }
  const expected = manifest.retainedBaselines.files;
  const actualPaths = [];
  for (const root of [".visual-hive/snapshots", "tests/__screenshots__"]) {
    actualPaths.push(...(await walkOrdinary(path.join(targetRoot, root), targetRoot, true)));
  }
  const pngs = actualPaths.filter((entry) => entry.toLowerCase().endsWith(".png")).sort();
  const expectedPaths = Object.keys(expected).sort();
  if (JSON.stringify(pngs) !== JSON.stringify(expectedPaths)) {
    throw new Error("Baseline snapshot set changed during proof execution.");
  }
  const records = [];
  for (const relative of expectedPaths) {
    const bytes = await readFile(await ordinaryFile(targetRoot, path.join(targetRoot, relative)));
    const digest = sha256(bytes);
    if (digest !== expected[relative]) throw new Error(`Baseline changed during proof: ${relative}.`);
    records.push({ path: relative, sha256: digest });
  }
  return {
    snapshotSetSha256: sha256(Buffer.from(records.map((item) => `${item.path}\0${item.sha256}\n`).join(""))),
  };
}

async function walkOrdinary(root, containmentRoot, pngOnly = false) {
  const canonicalContainment = await realpath(containmentRoot);
  const files = [];
  async function walk(directory) {
    const entry = await lstat(directory);
    if (entry.isSymbolicLink() || !entry.isDirectory() || !contained(canonicalContainment, await realpath(directory))) {
      throw new Error(`Linked or escaped directory in proof input: ${directory}.`);
    }
    for (const name of (await readdir(directory)).sort()) {
      const candidate = path.join(directory, name);
      const child = await lstat(candidate);
      if (child.isSymbolicLink()) throw new Error(`Symlink in proof input: ${candidate}.`);
      if (child.isDirectory()) await walk(candidate);
      else if (!child.isFile()) throw new Error(`Non-regular proof input: ${candidate}.`);
      else if (!pngOnly || candidate.toLowerCase().endsWith(".png")) {
        const resolved = await realpath(candidate);
        if (!contained(canonicalContainment, resolved) || resolved !== candidate) {
          throw new Error(`Reparse point in proof input: ${candidate}.`);
        }
        files.push(path.relative(canonicalContainment, candidate).split(path.sep).join("/"));
      }
    }
  }
  await walk(root);
  return files;
}

export async function copyOrdinaryEvidence(item, outputRoot) {
  const { source, outputRelative, allowedRoot, frozenBytes, expectedSha256 } = item;
  if (outputRelative.includes("..") || path.posix.isAbsolute(outputRelative) || outputRelative.includes("snapshots/")) {
    throw new Error(`Unsafe proof export path: ${outputRelative}.`);
  }
  const sourcePath = await ordinaryFile(await realpath(allowedRoot), path.resolve(source));
  const sourceBytes = frozenBytes ?? await readFile(sourcePath);
  if (!Buffer.isBuffer(sourceBytes)) throw new Error(`Proof evidence bytes were not frozen for ${outputRelative}.`);
  const digest = sha256(sourceBytes);
  if (expectedSha256 && digest !== expectedSha256) {
    throw new Error(`Proof evidence changed after its sealed assertion: ${outputRelative}.`);
  }
  if (outputRelative.endsWith(".png")) assertPngBytes(sourceBytes, outputRelative);
  assertNoSecretMaterial(sourceBytes, outputRelative);
  const destination = path.join(outputRoot, outputRelative);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeBytesExclusive(destination, sourceBytes);
  const destinationEntry = await lstat(destination);
  if (
    process.platform !== "win32" &&
    (destinationEntry.uid !== 0 || (destinationEntry.mode & 0o022) !== 0)
  ) {
    throw new Error(`Frozen proof evidence is not root-owned and non-writable: ${outputRelative}.`);
  }
  const written = await readFile(destination);
  if (!written.equals(sourceBytes)) throw new Error(`Frozen proof evidence write mismatch: ${outputRelative}.`);
  return { path: outputRelative, sha256: digest, bytes: sourceBytes.length };
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
    if (/token|secret|password|credential|private[_-]?key/iu.test(name) && value && value.length >= 8 && text.includes(value)) {
      throw new Error(`Proof export contains the value of sensitive environment variable ${name}: ${label}.`);
    }
  }
}

async function ordinaryFile(root, candidate) {
  const canonicalRoot = await realpath(root);
  const absolute = path.resolve(candidate);
  const entry = await lstat(absolute);
  if (entry.isSymbolicLink() || !entry.isFile()) throw new Error(`Expected ordinary file: ${absolute}.`);
  const resolved = await realpath(absolute);
  if (!contained(canonicalRoot, resolved) || resolved !== absolute) {
    throw new Error(`File escapes through a link or reparse point: ${absolute}.`);
  }
  return resolved;
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
    throw new Error(`Candidate evidence is not a valid non-empty PNG: ${label}.`);
  }
}

async function readJsonOrdinary(root, candidate) {
  return (await readFrozenJson(root, candidate)).value;
}

async function readFrozenJson(root, candidate) {
  const source = await ordinaryFile(root, candidate);
  const bytes = await readFile(source);
  return { source, bytes, value: JSON.parse(bytes.toString("utf8")) };
}

async function readFrozenPng(root, candidate) {
  const source = await ordinaryFile(root, candidate);
  const bytes = await readFile(source);
  assertPngBytes(bytes, source);
  return { source, bytes };
}

async function writeJsonExclusive(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const handle = await open(file, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeBytesExclusive(file, bytes) {
  const handle = await open(file, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function expectConnectionRefused(host, port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    let settled = false;
    let timer;
    const finish = (reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve({ host, port, connected: false, result: reason });
    };
    timer = setTimeout(() => finish("timeout"), 2_000);
    socket.once("connect", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      reject(new Error(`Detached proof container reached ${host}:${port}.`));
    });
    socket.once("error", (error) => {
      finish(error.code ?? "connection_error");
    });
  });
}

function git(cwd, args, allowEmpty = false) {
  const value = execFileSync("git", trustedGitCommandArgs(cwd, args), {
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 4 * 1024 * 1024,
  }).trim();
  if (!allowEmpty && !value) throw new Error(`git ${args.join(" ")} returned no value.`);
  return value;
}

function gitBytes(cwd, args) {
  return execFileSync("git", trustedGitCommandArgs(cwd, args), {
    timeout: 10_000,
    maxBuffer: 4 * 1024 * 1024,
  });
}

// Root attests the pwuser-owned target clone only after that user is
// quiescent. Modern Git otherwise rejects this deliberate ownership boundary
// before it can compare the exact commit, tree, cleanliness, and lock digest.
// Scope the exception to this one already-realpathed repository argument; do
// not mutate global/system Git configuration or trust every directory.
export function trustedGitCommandArgs(cwd, args) {
  if (
    typeof cwd !== "string" ||
    cwd.length === 0 ||
    !path.posix.isAbsolute(cwd) ||
    cwd.includes("\0") ||
    cwd.includes("\n") ||
    cwd.includes("\r") ||
    !Array.isArray(args)
  ) {
    throw new Error("Trusted Git attestation requires one canonical repository path and argument list.");
  }
  return ["-c", `safe.directory=${cwd}`, "-C", cwd, ...args];
}

function contained(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function sha256File(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function processesForUid(uid) {
  const processes = [];
  for (const entry of await readdir("/proc", { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d+$/u.test(entry.name)) continue;
    try {
      const status = await readFile(path.join("/proc", entry.name, "status"), "utf8");
      const match = /^Uid:\s+(\d+)/mu.exec(status);
      if (Number(match?.[1]) === uid) processes.push(Number(entry.name));
    } catch (error) {
      if (error?.code !== "ENOENT" && error?.code !== "ESRCH") throw error;
    }
  }
  return processes.sort((left, right) => left - right);
}

function required(args, name) {
  const value = args.get(name);
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function parseArgs(argv) {
  const command = argv[0];
  const allowed = {
    "attest-inputs": new Set([
      "--target-root",
      "--visual-root",
      "--target-commit",
      "--target-tree",
      "--target-lock-sha256",
      "--visual-commit",
      "--visual-tree",
      "--visual-lock-sha256",
      "--image-reference",
      "--image-id",
      "--output",
    ]),
    "verify-source": new Set([
      "--input-attestation",
      "--source-preflight",
      "--frozen-source-output",
      "--output",
    ]),
    "prove-isolation": new Set(["--docker-state-base64", "--output"]),
    "quiesce-user": new Set(),
    "verify-plan": new Set(["--plan", "--expected-contract"]),
    "verify-run": new Set([
      "--mode",
      "--target-root",
      "--input-attestation",
      "--source-attestation",
      "--isolation",
      "--output-dir",
    ]),
  }[command];
  if (!allowed) throw new Error(`Unknown proof helper command: ${command ?? "<missing>"}.`);
  const args = new Map();
  for (let index = 1; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--") || args.has(key)) {
      throw new Error(`Malformed helper argument ${key ?? "<missing>"}.`);
    }
    if (!allowed.has(key)) throw new Error(`Unknown argument ${key} for proof helper command ${command}.`);
    args.set(key, value);
  }
  return { command, args };
}

async function main() {
  const { command, args } = parseArgs(process.argv.slice(2));
  if (command === "attest-inputs") await attestInputs(args);
  else if (command === "verify-source") await verifySource(args);
  else if (command === "prove-isolation") await proveIsolation(args);
  else if (command === "quiesce-user") await quiesceUser();
  else if (command === "verify-plan") await verifyPlanCommand(args);
  else if (command === "verify-run") await verifyRun(args);
  else throw new Error(`Unknown proof helper command: ${command ?? "<missing>"}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(`Visual Hive container proof refused: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
