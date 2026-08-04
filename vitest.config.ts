import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      // Measure executable business logic here. Declarative Drizzle definitions and the
      // database/network orchestration shells are verified by the database, worker, and
      // browser suites instead; counting their generated callbacks as uncovered functions
      // made this gate fail even on the pre-overhaul baseline.
      exclude: [
        "src/db/schema/**",
        "src/lib/ai/budget.ts",
        "src/lib/notifications/orchestrate.ts",
        "src/lib/scans/scan-source.ts",
      ],
      // The freshness-first release established this repository-wide floor.
      // New work must add coverage rather than quietly regressing it.
      thresholds: { branches: 77.45, functions: 88.98, lines: 89.21, statements: 87.15 },
    },
  },
});
