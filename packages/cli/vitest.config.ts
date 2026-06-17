import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@visual-hive/core": path.resolve(dirname, "../core/src/index.ts"),
      "@visual-hive/control-plane": path.resolve(dirname, "../control-plane/src/index.ts"),
      "@visual-hive/github-adapter": path.resolve(dirname, "../github-adapter/src/index.ts"),
      "@visual-hive/llm-adapter": path.resolve(dirname, "../llm-adapter/src/index.ts"),
      "@visual-hive/playwright-adapter": path.resolve(dirname, "../playwright-adapter/src/index.ts")
    }
  },
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["**/.visual-hive/**", "**/node_modules/**", "**/dist/**"]
  }
});
