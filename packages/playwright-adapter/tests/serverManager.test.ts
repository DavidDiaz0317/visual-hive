import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startManagedServer } from "../src/serverManager.js";

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("managed server cleanup", () => {
  it("force-stops a SIGTERM-resistant server and its inherited-pipe descendant", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-server-cleanup-"));
    tempDirs.push(tempRoot);
    const port = await reservePort();
    const fixturePath = path.join(tempRoot, "stubborn-server.mjs");
    await writeFile(
      fixturePath,
      [
        'import { spawn } from "node:child_process";',
        'import { createServer } from "node:http";',
        'spawn(process.execPath, ["-e", "process.on(\\"SIGTERM\\", () => {}); setInterval(() => {}, 1000)"], { stdio: "inherit" });',
        'process.on("SIGTERM", () => {});',
        'createServer((_request, response) => response.end("ready")).listen(Number(process.argv[2]), "127.0.0.1");'
      ].join("\n"),
      "utf8"
    );

    const url = `http://127.0.0.1:${port}`;
    const server = await startManagedServer({
      command: `${quoteCommandArg(process.execPath)} ${quoteCommandArg(fixturePath)} ${port}`,
      cwd: tempRoot,
      url,
      timeoutMs: 10_000
    });
    const pid = server.pid;

    const startedAt = Date.now();
    await server.stop();

    expect(Date.now() - startedAt).toBeLessThan(8_000);
    await expect(fetch(url)).rejects.toThrow();
    if (process.platform !== "win32" && pid) {
      expect(isProcessGroupRunning(pid)).toBe(false);
    }
  }, 15_000);
});

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to reserve an ephemeral TCP port.");
  }
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return address.port;
}

function quoteCommandArg(value: string): string {
  return `"${value.replaceAll('"', '\\"')}"`;
}

function isProcessGroupRunning(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
