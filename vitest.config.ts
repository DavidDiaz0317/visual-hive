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
    include: ["packages/**/tests/**/*.test.ts"],
    exclude: ["**/.visual-hive/**", "**/node_modules/**", "**/dist/**"]
  }
});
