import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@visual-hive/core": path.resolve(dirname, "../core/src/index.ts")
    }
  },
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["**/.visual-hive/**", "**/node_modules/**", "**/dist/**"]
  }
});
