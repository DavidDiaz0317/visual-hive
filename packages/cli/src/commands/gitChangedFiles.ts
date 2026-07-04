import { spawn, type ChildProcess } from "node:child_process";
import { clearTimeout, setTimeout } from "node:timers";

const DEFAULT_GIT_TIMEOUT_MS = 30_000;

export function gitChangedFiles(cwd: string, base: string, timeoutMs = resolveGitTimeoutMs()): Promise<string[]> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    const gitExecutable = resolveGitExecutable();
    const child = spawn(gitExecutable, ["diff", "--name-only", `${base}...HEAD`], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: shouldUseShellForGitExecutable(gitExecutable)
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      killProcessTree(child);
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`git diff timed out after ${timeoutMs}ms for base ${base}`));
        return;
      }
      if (code !== 0) {
        reject(new Error(stderr || `git diff failed for base ${base}`));
        return;
      }
      resolve(
        stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
      );
    });
  });
}

function resolveGitTimeoutMs(): number {
  const raw = process.env.VISUAL_HIVE_GIT_TIMEOUT_MS;
  if (!raw) return DEFAULT_GIT_TIMEOUT_MS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_GIT_TIMEOUT_MS;
}

function resolveGitExecutable(): string {
  return process.env.VISUAL_HIVE_GIT_EXECUTABLE || "git";
}

function shouldUseShellForGitExecutable(executable: string): boolean {
  return process.platform === "win32" && /\.(cmd|bat)$/i.test(executable);
}

function killProcessTree(child: ChildProcess): void {
  if (!child.pid) return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true
    });
    killer.on("error", () => {
      child.kill("SIGKILL");
    });
    return;
  }
  child.kill("SIGTERM");
  setTimeout(() => {
    try {
      child.kill("SIGKILL");
    } catch {
      // Process may already be gone.
    }
  }, 2_000).unref();
}
