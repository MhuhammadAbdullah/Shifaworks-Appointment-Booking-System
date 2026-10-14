import { defineConfig } from "vitest/config";

// Pure-logic tests only (no DOM): URL prefill, provider matching, stale-slot and timezone helpers.
export default defineConfig({
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
