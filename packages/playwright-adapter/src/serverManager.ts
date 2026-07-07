import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { sanitizeText } from "@visual-hive/core";

const DEFAULT_READY_TIMEOUT_MS = 30_000;
const LOG_TAIL_LINES = 30;
const SERVER_FETCH_TIMEOUT_MS = 750;

export interface ManagedServer {
  command: string;
  cwd: string;
  url: string;
  pid?: number;
  stop: () => Promise<void>;
  logTail: () => string;
}

export async function startManagedServer(input: {
  command: string;
  cwd: string;
  url: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}): Promise<ManagedServer> {
  if (await isServerReachable(input.url)) {
    await waitForServerUrlToClose(input.url);
    if (await isServerReachable(input.url)) {
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
  let closed: { code: number | null; signal: NodeJS.Signals | null } | undefined;

  const pushLog = (prefix: string, chunk: Buffer): void => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      if (line.trim()) {
        logs.push(`${prefix}: ${line}`);
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
    stop: () => stopProcessTree(child, input.url),
    logTail: () => sanitizeText(logs.join("\n"))
  };

  try {
    await waitForServerUrl({
      url: input.url,
      timeoutMs: input.timeoutMs ?? DEFAULT_READY_TIMEOUT_MS,
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
    try {
      const response = await fetchWithTimeout(input.url, SERVER_FETCH_TIMEOUT_MS);
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

    const closed = input.getClosed?.();
    if (closed) {
      if (await isServerReachable(input.url)) {
        return;
      }
      throw new Error(
        targetStartupMessage({
          url: input.url,
          command: input.command,
          reason: `process exited before the target became stably reachable (code=${closed.code ?? "null"}, signal=${closed.signal ?? "none"})`,
          logTail: input.logTail?.()
        })
      );
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
  if (!pid) {
    return;
  }

  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
    if (url) {
      await killWindowsListenersForUrl(url);
      if (!(await waitForServerUrlToClose(url))) {
        await killWindowsListenersForUrl(url, 10_000);
      }
      if (!(await waitForServerUrlToClose(url))) {
        throw new Error(`Target server did not stop cleanly for ${sanitizeText(url)} after terminating the process tree.`);
      }
    }
    return;
  }

  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      return;
    }
  }
  if (url) {
    if (!(await waitForServerUrlToClose(url))) {
      throw new Error(`Target server did not stop cleanly for ${sanitizeText(url)} after terminating the process tree.`);
    }
  }
}

async function waitForServerUrlToClose(url: string, timeoutMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let stableMisses = 0;
  while (Date.now() < deadline) {
    if (!(await isServerReachable(url))) {
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
  return !(await isServerReachable(url));
}

async function isServerReachable(url: string): Promise<boolean> {
  try {
    await fetchWithTimeout(url, SERVER_FETCH_TIMEOUT_MS);
    return true;
  } catch {
    return false;
  }
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

async function killWindowsListenersForUrl(url: string, timeoutMs = 5_000): Promise<void> {
  const parsed = safeUrl(url);
  if (!parsed?.port) {
    return;
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pids = windowsListenerPidsForPort(parsed.port);
    if (pids.size === 0) {
      return;
    }
    for (const listenerPid of pids) {
      spawnSync("taskkill", ["/pid", listenerPid, "/t", "/f"], { stdio: "ignore", windowsHide: true });
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

function windowsListenerPidsForPort(port: string): Set<string> {
  const netstat = spawnSync("netstat", ["-ano"], { encoding: "utf8", windowsHide: true });
  const output = `${netstat.stdout ?? ""}\n${netstat.stderr ?? ""}`;
  const pids = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    if (!line.includes("LISTENING")) {
      continue;
    }
    const columns = line.trim().split(/\s+/);
    const localAddress = columns[1] ?? "";
    const pid = columns[columns.length - 1];
    if (localAddress.endsWith(`:${port}`) && pid && /^\d+$/.test(pid)) {
      pids.add(pid);
    }
  }
  return pids;
}

function safeUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
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
