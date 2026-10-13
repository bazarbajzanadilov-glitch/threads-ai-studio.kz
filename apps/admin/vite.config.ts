import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [preact()],
  resolve: {
    alias: {
      "@publisher/core": path.resolve(__dirname, "../../packages/core/src/index.ts"),
    },
  },
  server: {
    port: 4173,
    strictPort: true,
    proxy: {
      "/api": {
        target: process.env.VITE_DEV_API_ORIGIN ?? "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
  build: {
    target: "es2022",
    // The admin source is reviewed in Git; production assets do not need to
    // expose browser-downloadable source maps behind the Access application.
    sourcemap: false,
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    css: true,
    exclude: ["e2e/**", "node_modules/**", "dist/**"],
  },
});
