import { spawn } from "node:child_process";
import path from "node:path";
import { sanitizeText, type ContractResult, type Plan, type Report, type VisualHiveConfig } from "@visual-hive/core";
import { generatePlaywrightSpec } from "./generator.js";
import { collectArtifacts } from "./artifactCollector.js";
import { startManagedServer, type ManagedServer } from "./serverManager.js";

export interface RunPlaywrightOptions {
  config: VisualHiveConfig;
  plan: Plan;
  rootDir: string;
  ci?: boolean;
  mutationOperator?: string;
  runTargetCommands?: boolean;
}

export async function runPlaywrightContracts(options: RunPlaywrightOptions): Promise<{ report: Report; exitCode: number }> {
  const startedServers: ManagedServer[] = [];
  const startedAt = Date.now();
  const spec = await generatePlaywrightSpec(options);

  try {
    if (options.runTargetCommands ?? true) {
      for (const targetId of options.plan.targets.map((target) => target.id)) {
        const target = options.config.targets[targetId];
        if (target.kind === "command") {
          if (target.build) {
            await runShell(target.build, options.rootDir, {});
          }
          const server = await startManagedServer({
            command: target.serve,
            cwd: options.rootDir,
            url: target.url
          });
          startedServers.push(server);
        }
      }
    }

    const specArg = toPlaywrightPath(path.relative(options.rootDir, spec.path));
    const outputArg = toPlaywrightPath(path.join(".visual-hive", "playwright-results"));
    const result = await runShell(
      `npx playwright test "${specArg}" --reporter=json --output="${outputArg}"`,
      options.rootDir,
      {
        VISUAL_HIVE_CI: options.ci ? "true" : "false",
        VISUAL_HIVE_MUTATION_OPERATOR: options.mutationOperator ?? ""
      },
      true
    );

    const report = await buildReportFromPlaywrightOutput({
      config: options.config,
      plan: options.plan,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      rootDir: options.rootDir,
      durationMs: Date.now() - startedAt
    });
    return { report, exitCode: result.exitCode };
  } finally {
    for (const server of startedServers.reverse()) {
      await server.stop();
    }
  }
}

async function buildReportFromPlaywrightOutput(input: {
  config: VisualHiveConfig;
  plan: Plan;
  stdout: string;
  stderr: string;
  exitCode: number;
  rootDir: string;
  durationMs: number;
}): Promise<Report> {
  const artifacts = await collectArtifacts(input.rootDir);
  const parsed = parsePlaywrightJson(input.stdout);
  const resultByContract = new Map<string, { status: "passed" | "failed"; errors: string[]; durationMs: number }>();

  if (parsed) {
    for (const test of flattenPlaywrightTests(parsed)) {
      const contractId = extractContractId(test.title);
      if (!contractId) {
        continue;
      }
      resultByContract.set(contractId, {
        status: test.ok ? "passed" : "failed",
        errors: test.errors,
        durationMs: test.durationMs
      });
    }
  }

  const results: ContractResult[] = input.plan.items.map((item) => {
    const parsedResult = resultByContract.get(item.contractId);
    const failed = input.exitCode !== 0 && (!parsedResult || parsedResult.status === "failed");
    return {
      contractId: item.contractId,
      targetId: item.targetId,
      status: parsedResult?.status ?? (failed ? "failed" : "passed"),
      durationMs: parsedResult?.durationMs ?? input.durationMs,
      errors: parsedResult?.errors.length
        ? parsedResult.errors.map((error) => sanitizeText(error))
        : failed
          ? [sanitizeText(input.stderr || "Playwright reported a failure without structured error details.")]
          : [],
      artifacts
    };
  });

  return {
    schemaVersion: 1,
    project: input.config.project.name,
    mode: input.plan.mode,
    generatedAt: new Date().toISOString(),
    status: results.some((result) => result.status === "failed") ? "failed" : "passed",
    changedFiles: input.plan.changedFiles,
    results,
    consoleErrors: []
  };
}

function parsePlaywrightJson(stdout: string): unknown | undefined {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(trimmed.slice(first, last + 1));
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

function flattenPlaywrightTests(report: unknown): Array<{ title: string; ok: boolean; errors: string[]; durationMs: number }> {
  const tests: Array<{ title: string; ok: boolean; errors: string[]; durationMs: number }> = [];
  const visitSuite = (suite: any): void => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const results = test.results ?? [];
        const ok = test.status === "expected" || results.some((result: any) => result.status === "passed");
        const errors = results.flatMap((result: any) => (result.errors ?? []).map((error: any) => error.message ?? String(error)));
        const durationMs = results.reduce((sum: number, result: any) => sum + (result.duration ?? 0), 0);
        tests.push({ title: spec.title ?? test.title ?? "", ok, errors, durationMs });
      }
    }
    for (const child of suite.suites ?? []) {
      visitSuite(child);
    }
  };
  for (const suite of (report as any)?.suites ?? []) {
    visitSuite(suite);
  }
  return tests;
}

function extractContractId(title: string): string | undefined {
  const match = /^contract:(.+)$/.exec(title);
  return match?.[1];
}

function toPlaywrightPath(value: string): string {
  return value.replaceAll("\\", "/");
}

function runShell(command: string, cwd: string, env: NodeJS.ProcessEnv, allowFailure = false): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...env },
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      const exitCode = code ?? 1;
      if (exitCode !== 0 && !allowFailure) {
        reject(new Error(sanitizeText(stderr || `Command failed with exit code ${exitCode}: ${command}`)));
        return;
      }
      resolve({ stdout, stderr, exitCode });
    });
  });
}
