import { defineConfig } from "vitest/config";

/**
 * Integration tests run against a real PostgreSQL database (the dev DB or the
 * docker-compose one). They create uniquely-named fixtures and remove them.
 *   npm run test:integration -w @booking/api
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/integration/**/*.test.ts"],
    setupFiles: ["test/integration/setup.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
