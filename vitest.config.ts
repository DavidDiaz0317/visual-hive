import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@visual-hive/core": path.resolve(dirname, "packages/core/src/index.ts"),
      "@visual-hive/control-plane": path.resolve(dirname, "packages/control-plane/src/index.ts"),
      "@visual-hive/github-adapter": path.resolve(dirname, "packages/github-adapter/src/index.ts"),
      "@visual-hive/llm-adapter": path.resolve(dirname, "packages/llm-adapter/src/index.ts"),
      "@visual-hive/playwright-adapter": path.resolve(dirname, "packages/playwright-adapter/src/index.ts")
    }
  },
  test: {
    // Artifact and bundle integrity tests perform bounded filesystem sealing.
    // Under the full parallel suite they can cross Vitest's 5s default even
    // though isolated bodies complete in about one second. Keep a finite
    // suite-wide budget that remains strict but is stable under contention.
    testTimeout: 15_000,
    // Bound parallel browser/process pressure so Chromium screenshot capture
    // remains deterministic on both developer and GitHub-hosted machines.
    maxWorkers: 4,
    include: ["packages/**/tests/**/*.test.ts"],
    exclude: ["**/.visual-hive/**", "**/node_modules/**", "**/dist/**"]
  }
});
