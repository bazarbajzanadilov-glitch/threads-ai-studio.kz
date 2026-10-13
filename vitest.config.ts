import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/e2e/**"],
    coverage: {
      reporter: ["text", "html"],
      exclude: ["**/dist/**", "**/generated/**"]
    }
  }
});
