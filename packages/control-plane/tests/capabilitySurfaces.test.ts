import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CONTROL_PLANE_CAPABILITY_SURFACES } from "../src/capabilitySurfaces.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("Control Plane capability surfaces", () => {
  it("matches every HTTP route implemented by the server", async () => {
    const source = await readFile(path.join(packageRoot, "src", "server.ts"), "utf8");
    const actual: Array<{ method: "GET" | "POST"; path: string; runtimeStatus: "supported" }> = [];
    const exactRoute = /if \(url\.pathname === "([^"]+)"(?: \|\| url\.pathname === "([^"]+)")?\) \{\s*if \(request\.method !== "(GET|POST)"\)/g;
    for (const match of source.matchAll(exactRoute)) {
      const method = match[3] as "GET" | "POST";
      actual.push({ method, path: match[1], runtimeStatus: "supported" });
      if (match[2]) actual.push({ method, path: match[2], runtimeStatus: "supported" });
    }
    const assetRoute = /if \(url\.pathname\.startsWith\("\/assets\/"\)\) \{\s*if \(request\.method !== "(GET|POST)"\)/.exec(source);
    expect(assetRoute).not.toBeNull();
    actual.push({ method: assetRoute![1] as "GET" | "POST", path: "/assets/*", runtimeStatus: "supported" });

    expect(sort(actual)).toEqual(sort(CONTROL_PLANE_CAPABILITY_SURFACES));
  });
});

function sort<T extends { method: string; path: string }>(values: T[]): T[] {
  return [...values].sort((left, right) => `${left.method} ${left.path}`.localeCompare(`${right.method} ${right.path}`));
}

