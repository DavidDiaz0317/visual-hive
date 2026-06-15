import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { sanitizeText } from "@visual-hive/core";

const DEFAULT_READY_TIMEOUT_MS = 30_000;
const LOG_TAIL_LINES = 30;

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
  const child = spawn(input.command, {
    cwd: input.cwd,
    shell: true,
    detached: true,
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
    stop: () => stopProcessTree(child),
    logTail: () => sanitizeText(logs.join("\n"))
  };

  try {
    await waitForServerUrl({
      url: input.url,
      timeoutMs: input.timeoutMs ?? DEFAULT_READY_TIMEOUT_MS,
      getClosed: () => closed,
      logTail: server.logTail,
      command: input.command
    });
    return server;
  } catch (error) {
    await server.stop();
    throw error;
  }
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

  while (Date.now() < deadline) {
    const closed = input.getClosed?.();
    if (closed) {
      throw new Error(
        targetStartupMessage({
          url: input.url,
          command: input.command,
          reason: `process exited before the target became reachable (code=${closed.code ?? "null"}, signal=${closed.signal ?? "none"})`,
          logTail: input.logTail?.()
        })
      );
    }

    try {
      const response = await fetch(input.url);
      if (response.status < 500) {
        return;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
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

export async function stopProcessTree(child: ChildProcess): Promise<void> {
  const pid = child.pid;
  if (!pid) {
    return;
  }

  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
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
