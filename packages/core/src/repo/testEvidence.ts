import type { RepoRuntimeScopeInfo, RepoTestFileInfo, RepoTestRunnerInfo, RepoTestRuntime } from "./types.js";

export interface RepoUnitTestScope {
  runtime: RepoTestRuntime;
  scope: string;
  runners: string[];
  files: string[];
  status: "covered" | "partial";
}

export function unitTestScopes(
  testRunners: RepoTestRunnerInfo[] = [],
  testFiles: RepoTestFileInfo[] = [],
  runtimeScopes: RepoRuntimeScopeInfo[] = []
): RepoUnitTestScope[] {
  const runtimes = utf8Unique([
    ...testFiles.filter(isUnitLayerTestFile).map((file) => `${file.runtime}\0${file.scope}`),
    ...runtimeScopes.map((scope) => `${scope.runtime}\0${scope.scope}`)
  ]);
  return runtimes.map((identity) => {
    const [runtime, scope] = identity.split("\0") as [RepoTestRuntime, string];
    const runners = utf8Unique(testRunners.filter((runner) => runner.kind === "unit" && runner.runtime === runtime && runner.scope === scope && isSafeStructuredRunnerCommand(runner.command)).map((runner) => runner.tool));
    const files = utf8Unique(testFiles.filter((file) => isUnitLayerTestFile(file) && file.runnerEligible && file.runtime === runtime && file.scope === scope).map((file) => file.path));
    return { runtime, scope, runners, files, status: runners.length > 0 && files.length > 0 ? "covered" : "partial" };
  });
}

export function isUnitLayerTestFile(file: RepoTestFileInfo): boolean {
  return file.kind === "unit" || (file.runtime === "javascript" && file.kind === "component");
}

export function isSafeStructuredRunnerCommand(command: RepoTestRunnerInfo["command"]): boolean {
  const safeToken = (value: string) => /^[A-Za-z0-9@%_+=:,./-]+$/u.test(value) && !value.split("/").includes("..");
  if (!command || !["npm", "pnpm", "yarn", "node", "python", "go", "cargo", "mvn", "gradle", "ruby", "php"].includes(command.executable)) return false;
  if (command.cwd !== ".") {
    if (command.cwd.startsWith("-") || command.cwd.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(command.cwd)) return false;
    if (!safeToken(command.cwd) || command.cwd.split("/").some((segment) => segment.startsWith("-"))) return false;
  }
  return command.args.every(safeToken);
}

export function incompleteUnitTestScopeMessages(scopes: RepoUnitTestScope[]): string[] {
  return scopes.filter((scope) => scope.status === "partial").map((scope) => {
    if (scope.runtime === "ruby" || scope.runtime === "php") {
      return `${scope.runtime} scope ${scope.scope} has no deterministic Layer-2 runner adapter; this scope is advisory-only and not eligible for canonical auto-repair.`;
    }
    if (scope.runners.length > 0) return `${scope.runtime} scope ${scope.scope} unit runner ${scope.runners.join(", ")} has no matching executable unit test file.`;
    if (scope.files.length > 0) return `${scope.runtime} scope ${scope.scope} unit test files exist, but no matching deterministic runner or script was detected.`;
    return `${scope.runtime} scope ${scope.scope} has neither a deterministic unit runner nor a runner-discoverable unit test file.`;
  });
}

function utf8Unique(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")));
}
