import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const packageDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  root: path.join(packageDir, "web"),
  build: {
    outDir: path.join(packageDir, "dist", "web"),
    emptyOutDir: true,
    sourcemap: true,
    assetsDir: "assets"
  }
});
