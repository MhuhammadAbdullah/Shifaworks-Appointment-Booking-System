import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    // Real-database suites run separately: npm run test:integration -w @booking/api
    exclude: ["test/integration/**", "node_modules/**"],
    // Unit tests must not need real infrastructure; integration tests that do
    // live in test/integration and read TEST_DATABASE_URL (Phase 4+).
    env: {
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
      SUPABASE_URL: "http://localhost:54321",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
      APP_SIGNING_SECRET: "test-signing-secret-that-is-at-least-32-chars",
    },
  },
});
