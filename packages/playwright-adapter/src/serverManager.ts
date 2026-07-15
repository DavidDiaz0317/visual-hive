import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { sanitizeText } from "@visual-hive/core";

const DEFAULT_READY_TIMEOUT_MS = 30_000;
const LOG_TAIL_LINES = 30;
const SERVER_FETCH_TIMEOUT_MS = 750;
const PROCESS_TERMINATION_GRACE_MS = 1_000;
const PROCESS_FORCE_KILL_TIMEOUT_MS = 3_000;
const MAX_SERVER_LOG_BYTES = 256 * 1024;

export interface ManagedServer {
  command: string;
  cwd: string;
  url: string;
  pid?: number;
  isRunning: () => boolean;
  stop: () => Promise<void>;
  logTail: () => string;
}

export async function startManagedServer(input: {
  command: string;
  cwd: string;
  url: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  deadlineAtMs?: number;
}): Promise<ManagedServer> {
  const readyTimeoutMs = remainingTimeout(input.timeoutMs ?? DEFAULT_READY_TIMEOUT_MS, input.deadlineAtMs);
  if (await isServerReachable(input.url, Math.min(SERVER_FETCH_TIMEOUT_MS, readyTimeoutMs))) {
    await waitForServerUrlToClose(input.url, Math.min(5_000, readyTimeoutMs));
    if (await isServerReachable(input.url, Math.min(SERVER_FETCH_TIMEOUT_MS, remainingTimeout(readyTimeoutMs, input.deadlineAtMs)))) {
      throw new Error(
        targetStartupMessage({
          url: input.url,
          command: input.command,
          reason: "the target URL was already reachable before Visual Hive started the configured command"
        })
      );
    }
  }

  const child = spawn(input.command, {
    cwd: input.cwd,
    shell: true,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...input.env },
    windowsHide: true
  });
  const logs: string[] = [];
  let logBytes = 0;
  let closed: { code: number | null; signal: NodeJS.Signals | null } | undefined;

  const pushLog = (prefix: string, chunk: Buffer): void => {
    if (logBytes >= MAX_SERVER_LOG_BYTES) return;
    const remaining = MAX_SERVER_LOG_BYTES - logBytes;
    const bounded = chunk.subarray(0, remaining);
    logBytes += bounded.byteLength;
    for (const line of bounded.toString().split(/\r?\n/)) {
      if (line.trim()) {
        logs.push(`${prefix}: ${line.slice(0, 8_192)}`);
      }
    }
    if (logs.length > LOG_TAIL_LINES) {
      logs.splice(0, logs.length - LOG_TAIL_LINES);
    }
  };

  child.stdout?.on("data", (chunk: Buffer) => pushLog("stdout", chunk));
  child.stderr?.on("data", (chunk: Buffer) => pushLog("stderr", chunk));
  child.on("close", (code, signal) => {
    closed = { code, signal };
  });

  const server: ManagedServer = {
    command: input.command,
    cwd: input.cwd,
    url: input.url,
    pid: child.pid,
    isRunning: () => closed === undefined,
    stop: () => stopProcessTree(child, input.url),
    logTail: () => sanitizeText(logs.join("\n"))
  };

  try {
    await waitForServerUrl({
      url: input.url,
      timeoutMs: remainingTimeout(readyTimeoutMs, input.deadlineAtMs),
      getClosed: () => closed ?? currentChildExit(child),
      logTail: server.logTail,
      command: input.command
    });
    return server;
  } catch (error) {
    await server.stop();
    throw error;
  }
}

function currentChildExit(child: ChildProcess): { code: number | null; signal: NodeJS.Signals | null } | undefined {
  if (child.exitCode === null && child.signalCode === null) {
    return undefined;
  }
  return { code: child.exitCode, signal: child.signalCode };
}

export async function waitForServerUrl(input: {
  url: string;
  timeoutMs?: number;
  getClosed?: () => { code: number | null; signal: NodeJS.Signals | null } | undefined;
  logTail?: () => string;
  command?: string;
}): Promise<void> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  let stableSuccesses = 0;

  while (Date.now() < deadline) {
    const closedBeforeProbe = input.getClosed?.();
    if (closedBeforeProbe) {
      throw new Error(targetStartupMessage({ url: input.url, command: input.command, reason: `managed process exited before readiness (code=${closedBeforeProbe.code ?? "null"}, signal=${closedBeforeProbe.signal ?? "none"})`, logTail: input.logTail?.() }));
    }
    try {
      const response = await fetchWithTimeout(input.url, Math.min(SERVER_FETCH_TIMEOUT_MS, Math.max(1, deadline - Date.now())));
      const closedAfterProbe = input.getClosed?.();
      if (closedAfterProbe) throw new Error(`managed process exited during readiness (code=${closedAfterProbe.code ?? "null"}, signal=${closedAfterProbe.signal ?? "none"})`);
      if (response.status < 500) {
        stableSuccesses += 1;
        if (stableSuccesses >= 3) {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
        continue;
      }
      stableSuccesses = 0;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      stableSuccesses = 0;
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(
    targetStartupMessage({
      url: input.url,
      command: input.command,
      reason: `timed out after ${timeoutMs}ms${lastError instanceof Error ? `; last error: ${lastError.message}` : ""}`,
      logTail: input.logTail?.()
    })
  );
}

export async function stopProcessTree(child: ChildProcess, url?: string): Promise<void> {
  const pid = child.pid;
  try {
    if (!pid) {
      return;
    }

    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore", windowsHide: true, timeout: 5_000 });
    } else {
      await stopUnixProcessGroup(pid);
    }

    if (url && !(await waitForServerUrlToClose(url))) {
      throw new Error(`Target server did not stop cleanly for ${sanitizeText(url)} after terminating the process tree.`);
    }
  } finally {
    releaseChildResources(child);
  }
}

async function stopUnixProcessGroup(pid: number): Promise<void> {
  signalUnixProcessTree(pid, "SIGTERM");
  if (await waitForUnixProcessGroupToExit(pid, PROCESS_TERMINATION_GRACE_MS)) {
    return;
  }

  signalUnixProcessTree(pid, "SIGKILL");
  if (!(await waitForUnixProcessGroupToExit(pid, PROCESS_FORCE_KILL_TIMEOUT_MS))) {
    throw new Error(`Target process group ${pid} did not exit after forced termination.`);
  }
}

function signalUnixProcessTree(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
    return;
  } catch {
    // Fall back to the direct child when process groups are unavailable.
  }
  try {
    process.kill(pid, signal);
  } catch {
    // The process already exited.
  }
}

async function waitForUnixProcessGroupToExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isUnixProcessGroupRunning(pid)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !isUnixProcessGroupRunning(pid);
}

function isUnixProcessGroupRunning(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function releaseChildResources(child: ChildProcess): void {
  child.stdout?.removeAllListeners("data");
  child.stderr?.removeAllListeners("data");
  child.stdout?.destroy();
  child.stderr?.destroy();
  child.stdin?.destroy();
  child.unref();
}

async function waitForServerUrlToClose(url: string, timeoutMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let stableMisses = 0;
  while (Date.now() < deadline) {
    if (!(await isServerReachable(url, Math.min(SERVER_FETCH_TIMEOUT_MS, Math.max(1, deadline - Date.now()))))) {
      stableMisses += 1;
      if (stableMisses >= 3) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
      continue;
    }
    stableMisses = 0;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return !(await isServerReachable(url, SERVER_FETCH_TIMEOUT_MS));
}

async function isServerReachable(url: string, timeoutMs = SERVER_FETCH_TIMEOUT_MS): Promise<boolean> {
  try {
    await fetchWithTimeout(url, timeoutMs);
    return true;
  } catch {
    return false;
  }
}

function remainingTimeout(requestedMs: number, deadlineAtMs?: number): number {
  if (!Number.isSafeInteger(requestedMs) || requestedMs <= 0) throw new Error("Target server readiness timeout is invalid.");
  if (deadlineAtMs === undefined) return requestedMs;
  if (!Number.isSafeInteger(deadlineAtMs) || deadlineAtMs <= 0) throw new Error("Target server deadline is invalid.");
  const remaining = Math.min(requestedMs, deadlineAtMs - Date.now());
  if (remaining <= 0) throw new Error("Target server deadline elapsed before readiness.");
  return remaining;
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}


function targetStartupMessage(input: { url: string; command?: string; reason: string; logTail?: string }): string {
  const lines = [
    `Target server failed to start for ${sanitizeText(input.url)}.`,
    `Reason: ${sanitizeText(input.reason)}.`
  ];
  if (input.command) {
    lines.push(`Command: ${sanitizeText(input.command)}`);
  }
  if (input.logTail) {
    lines.push("Recent server output:", input.logTail);
  }
  return lines.join("\n");
}
