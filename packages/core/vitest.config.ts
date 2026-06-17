import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["**/.visual-hive/**", "**/node_modules/**", "**/dist/**"]
  }
});
