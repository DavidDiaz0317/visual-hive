import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { analyzeRepository } from "../src/repo/analyze.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("repository visual-map grounding", () => {
  it("does not invent demo-domain owners or layouts from selector names", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-neutral-map-"));
    temporaryDirectories.push(repoRoot);
    await mkdir(path.join(repoRoot, "src"), { recursive: true });
    await writeFile(path.join(repoRoot, "package.json"), JSON.stringify({ name: "neutral-map", private: true }), "utf8");
    await writeFile(
      path.join(repoRoot, "src", "NeutralShell.tsx"),
      "export function NeutralShell() { return <main data-testid=\"dashboard-card-grid\" />; }\n",
      "utf8"
    );
    await writeFile(
      path.join(repoRoot, "src", "Widget.tsx"),
      "export function Widget() { return <button data-testid=\"github-login-button\">Continue</button>; }\n",
      "utf8"
    );

    const report = await analyzeRepository({ repoRoot, now: new Date("2026-07-15T12:00:00.000Z") });
    const nodeIds = report.visualMap.nodes.map((node) => node.id);
    const edgeIds = report.visualMap.edges.map((edge) => edge.id);

    expect(nodeIds).toContain("layout:neutralshell");
    expect(nodeIds).toContain("component:widget");
    expect(edgeIds).toContain("layout:neutralshell--uses_selector--selector:data-testid-dashboard-card-grid");
    expect(edgeIds).toContain("component:widget--uses_selector--selector:data-testid-github-login-button");
    expect(nodeIds).not.toEqual(expect.arrayContaining([
      "component:dashboard-card",
      "component:login",
      "layout:dashboard-shell",
      "layout:auth-boundary"
    ]));
    expect(edgeIds.some((edge) => edge.includes("derived:app-component-demo-impact"))).toBe(false);
  });

  it("leaves selector ownership unresolved when a file declares multiple candidate components", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-ambiguous-map-"));
    temporaryDirectories.push(repoRoot);
    await mkdir(path.join(repoRoot, "src"), { recursive: true });
    await writeFile(path.join(repoRoot, "package.json"), JSON.stringify({ name: "ambiguous-map", private: true }), "utf8");
    await writeFile(
      path.join(repoRoot, "src", "Widgets.tsx"),
      [
        "export function FirstWidget() { return <div data-testid=\"shared-control\" />; }",
        "export function SecondWidget() { return <div />; }",
        ""
      ].join("\n"),
      "utf8"
    );

    const report = await analyzeRepository({ repoRoot, now: new Date("2026-07-15T12:00:00.000Z") });
    const selectorId = "selector:data-testid-shared-control";
    const ownerEdges = report.visualMap.edges.filter((edge) => edge.to === selectorId && edge.relation === "uses_selector");

    expect(ownerEdges).toEqual([]);
  });
});
