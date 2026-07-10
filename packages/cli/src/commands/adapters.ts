import { spawn } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import { sanitizeText, writeJson } from "@visual-hive/core";

const MAX_ADAPTER_OUTPUT = 1_000_000;
const MAX_VRT_IMAGE_BYTES = 25 * 1024 * 1024;

export interface ODiffCompareOptions {
  baseline: string;
  actual: string;
  diff: string;
  threshold?: number;
  command?: string;
  commandArgs?: string[];
  cwd?: string;
  timeoutMs?: number;
}

export interface ODiffCompareResult {
  schemaVersion: "visual-hive.odiff-result.v1";
  adapter: "odiff";
  adapterVersion: "4.3.8";
  deterministicRole: "supplemental";
  match: boolean;
  reason: "match" | "pixel-diff" | "layout-diff";
  diffCount?: number;
  diffPercentage?: number;
  baseline: string;
  actual: string;
  diff: string;
}

export async function runODiffCompare(options: ODiffCompareOptions): Promise<ODiffCompareResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const baseline = await resolveInput(cwd, options.baseline);
  const actual = await resolveInput(cwd, options.actual);
  const diff = resolveOutput(cwd, options.diff);
  const threshold = options.threshold ?? 0.1;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new Error("ODiff threshold must be between 0 and 1.");
  const args = [
    ...(options.commandArgs ?? []),
    baseline,
    actual,
    diff,
    "--parsable-stdout",
    "--fail-on-layout",
    "--threshold",
    String(threshold)
  ];
  const execution = await runProcess(options.command ?? process.env.VISUAL_HIVE_ODIFF_COMMAND ?? "odiff", args, cwd, options.timeoutMs ?? 30_000);
  const parsed = parseODiffOutput(execution.exitCode, execution.stdout);
  return {
    schemaVersion: "visual-hive.odiff-result.v1",
    adapter: "odiff",
    adapterVersion: "4.3.8",
    deterministicRole: "supplemental",
    ...parsed,
    baseline: relative(cwd, baseline),
    actual: relative(cwd, actual),
    diff: relative(cwd, diff)
  };
}

export interface VRTUploadOptions {
  image: string;
  name: string;
  apiUrl?: string;
  apiKey?: string;
  project?: string;
  branch?: string;
  baselineBranch?: string;
  ciBuildId?: string;
  browser?: string;
  os?: string;
  viewport?: string;
  diffTolerancePercent?: number;
  trusted?: boolean;
  cwd?: string;
  output?: string;
  fetchFn?: typeof fetch;
}

export interface VRTUploadResult {
  schemaVersion: "visual-hive.vrt-result.v1";
  adapter: "visual-regression-tracker";
  adapterVersion: "5.1.1";
  sdkContractVersion: "5.7.1";
  deterministicRole: "supplemental";
  buildId: string;
  testRunId: string;
  status: string;
  diffPercent?: number;
  reviewUrl?: string;
  uploadedArtifacts: 1;
  verdictAuthority: false;
}

export async function runVRTUpload(options: VRTUploadOptions): Promise<VRTUploadResult> {
  if (!options.trusted) throw new Error("VRT upload requires explicit --trusted authorization.");
  if (process.env.GITHUB_EVENT_NAME === "pull_request" || process.env.GITHUB_EVENT_NAME === "pull_request_target") {
    throw new Error("VRT upload is forbidden while executing pull request code.");
  }
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const imagePath = await resolveInput(cwd, options.image);
  const image = await readFile(imagePath);
  if (image.length > MAX_VRT_IMAGE_BYTES) throw new Error("VRT image exceeds the 25 MiB adapter limit.");
  const apiUrl = required(options.apiUrl ?? process.env.VRT_APIURL, "VRT_APIURL").replace(/\/+$/, "");
  const apiKey = required(options.apiKey ?? process.env.VRT_APIKEY, "VRT_APIKEY");
  const project = required(options.project ?? process.env.VRT_PROJECT, "VRT_PROJECT");
  const branchName = required(options.branch ?? process.env.VRT_BRANCH, "VRT_BRANCH");
  const url = new URL(apiUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("VRT_APIURL must use http or https.");
  const fetchFn = options.fetchFn ?? fetch;
  const headers = { "content-type": "application/json", apiKey, project };
  const build = await requestJson(fetchFn, `${apiUrl}/builds`, {
    method: "POST",
    headers,
    body: JSON.stringify({ branchName, baselineBranchName: options.baselineBranch, project, ciBuildId: options.ciBuildId }),
    signal: AbortSignal.timeout(15_000)
  });
  const buildId = stringField(build, "id");
  const projectId = stringField(build, "projectId");
  let tracked: Record<string, unknown> | undefined;
  try {
    tracked = await requestJson(fetchFn, `${apiUrl}/test-runs`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: sanitizeText(options.name),
        imageBase64: image.toString("base64"),
        buildId,
        projectId,
        branchName,
        baselineBranchName: options.baselineBranch,
        browser: options.browser,
        os: options.os,
        viewport: options.viewport,
        diffTollerancePercent: options.diffTolerancePercent
      }),
      signal: AbortSignal.timeout(30_000)
    });
  } finally {
    await requestJson(fetchFn, `${apiUrl}/builds/${encodeURIComponent(buildId)}`, {
      method: "PATCH",
      headers,
      body: "{}",
      signal: AbortSignal.timeout(15_000)
    }).catch(() => undefined);
  }
  if (!tracked) throw new Error("VRT did not return a test run.");
  const result: VRTUploadResult = {
    schemaVersion: "visual-hive.vrt-result.v1",
    adapter: "visual-regression-tracker",
    adapterVersion: "5.1.1",
    sdkContractVersion: "5.7.1",
    deterministicRole: "supplemental",
    buildId,
    testRunId: stringField(tracked, "id"),
    status: sanitizeText(String(tracked.status ?? "unknown")),
    diffPercent: numberField(tracked, "diffPercent"),
    reviewUrl: optionalURL(tracked.url),
    uploadedArtifacts: 1,
    verdictAuthority: false
  };
  if (options.output) await writeJson(resolveOutput(cwd, options.output), result);
  return result;
}

function parseODiffOutput(exitCode: number, stdout: string): Pick<ODiffCompareResult, "match" | "reason" | "diffCount" | "diffPercentage"> {
  const value = stdout.trim();
  if (exitCode === 0 && value === "0") return { match: true, reason: "match" };
  if (exitCode === 21 && value === "layout") return { match: false, reason: "layout-diff" };
  if (exitCode === 22) {
    const [count, percentage] = value.split(";");
    const diffCount = Number(count);
    const diffPercentage = Number(percentage);
    if (Number.isFinite(diffCount) && Number.isFinite(diffPercentage)) return { match: false, reason: "pixel-diff", diffCount, diffPercentage };
  }
  throw new Error(`ODiff failed with exit code ${exitCode}: ${sanitizeText(value || "no parsable output")}`);
}

function runProcess(command: string, args: string[], cwd: string, timeoutMs: number): Promise<{ exitCode: number; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true, env: { ...process.env } });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`Adapter command timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      if (stdout.length < MAX_ADAPTER_OUTPUT) stdout += String(chunk).slice(0, MAX_ADAPTER_OUTPUT - stdout.length);
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < MAX_ADAPTER_OUTPUT) stderr += String(chunk).slice(0, MAX_ADAPTER_OUTPUT - stderr.length);
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const code = exitCode ?? 1;
      if (![0, 21, 22].includes(code)) reject(new Error(`Adapter command failed (${code}): ${sanitizeText(stderr || stdout)}`));
      else resolve({ exitCode: code, stdout });
    });
  });
}

async function resolveInput(root: string, input: string): Promise<string> {
  const resolved = resolveWithin(root, input);
  const info = await lstat(resolved);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Adapter input must be a regular non-symlinked file: ${input}`);
  return resolved;
}

function resolveOutput(root: string, output: string): string {
  return resolveWithin(root, output);
}

function resolveWithin(root: string, value: string): string {
  const resolved = path.resolve(root, value);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new Error(`Adapter path escapes the repository root: ${value}`);
  return resolved;
}

function relative(root: string, target: string): string {
  return path.relative(root, target).replaceAll(path.sep, "/");
}

async function requestJson(fetchFn: typeof fetch, url: string, init: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetchFn(url, init);
  const text = await response.text();
  if (!response.ok) throw new Error(`VRT request failed (${response.status}): ${sanitizeText(text).slice(0, 500)}`);
  const value = text ? JSON.parse(text) : {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("VRT returned an invalid response.");
  return value as Record<string, unknown>;
}

function required(value: string | undefined, name: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error(`${name} is required.`);
  return trimmed;
}

function stringField(value: Record<string, unknown>, field: string): string {
  if (typeof value[field] !== "string" || !value[field]) throw new Error(`VRT response is missing ${field}.`);
  return sanitizeText(String(value[field]));
}

function numberField(value: Record<string, unknown>, field: string): number | undefined {
  return typeof value[field] === "number" && Number.isFinite(value[field]) ? value[field] : undefined;
}

function optionalURL(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? sanitizeText(parsed.toString()) : undefined;
  } catch {
    return undefined;
  }
}
