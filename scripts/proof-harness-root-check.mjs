#!/usr/bin/env node

import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { copyOrdinaryEvidence } from "./proof-harness-container.mjs";

if (process.platform !== "linux" || process.getuid?.() !== 0) {
  throw new Error("The proof-harness root check must run as uid 0 on Linux.");
}

const root = await mkdtemp(path.join(os.tmpdir(), "vh-proof-root-check-"));
try {
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
  process.stdout.write("proof-harness root evidence freeze: ok\n");
} finally {
  await rm(root, { recursive: true, force: true });
}
