import { defineConfig } from "vitest/config";

export default defineConfig({ test: {
  environment: "node", include: ["tests/integration/*.postgres.ts"],
  maxWorkers: 1, fileParallelism: false, testTimeout: 30000, hookTimeout: 120000,
} });
