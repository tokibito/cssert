import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts", "src/cli/index.ts"],
      reporter: ["text", "lcov"],
      thresholds: {
        "src/core/**": { lines: 95, functions: 95, branches: 90, statements: 95 },
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
});
