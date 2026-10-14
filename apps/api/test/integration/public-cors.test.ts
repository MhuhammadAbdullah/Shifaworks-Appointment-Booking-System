/**
 * The WordPress availability calendar reads /public/team and /public/availability
 * from a browser on another origin. PUBLIC_CORS_ORIGINS opens exactly that, GET-only
 * and credential-less, without touching the general CORS policy.
 *
 * env.ts reads process.env once at import, so each case sets the variable, resets the
 * module registry and imports a fresh app.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import request from "supertest";

const WP = "https://shifaworks.com";
const STAGING = "https://staging.shifaworks.test";
const ORIGINAL = process.env.PUBLIC_CORS_ORIGINS;

async function appWith(origins: string | undefined) {
  if (origins === undefined) delete process.env.PUBLIC_CORS_ORIGINS;
  else process.env.PUBLIC_CORS_ORIGINS = origins;
  vi.resetModules();
  const { createApp } = await import("../../src/app.js");
  return createApp();
}

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.PUBLIC_CORS_ORIGINS;
  else process.env.PUBLIC_CORS_ORIGINS = ORIGINAL;
});

describe("PUBLIC_CORS_ORIGINS", () => {
  it("answers the preflight for an allowed origin: GET only, no credentials", async () => {
    const app = await appWith(WP);
    const res = await request(app)
      .options("/api/v1/public/availability/slots")
      .set("Origin", WP)
      .set("Access-Control-Request-Method", "GET");
    expect(res.headers["access-control-allow-origin"]).toBe(WP);
    expect(res.headers["access-control-allow-methods"]).toBe("GET,HEAD,OPTIONS");
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
  });

  it("sends the allow header on the actual response for /public/team", async () => {
    const app = await appWith(`${WP},${STAGING}`);
    const res = await request(app).get("/api/v1/public/team/no-such-provider-for-cors").set("Origin", STAGING);
    expect(res.headers["access-control-allow-origin"]).toBe(STAGING);
  });

  it("gives an origin that is not listed nothing", async () => {
    const app = await appWith(WP);
    const res = await request(app).get("/api/v1/public/team/no-such-provider-for-cors").set("Origin", "https://evil.example");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("does not open booking submission or any other route to the WordPress origin", async () => {
    const app = await appWith(WP);
    for (const path of ["/api/v1/public/bookings", "/api/v1/bookings", "/api/v1/availability/providers/me"]) {
      const res = await request(app).options(path).set("Origin", WP).set("Access-Control-Request-Method", "POST");
      expect(res.headers["access-control-allow-origin"], path).toBeUndefined();
    }
  });

  it("leaves the general policy exactly as it was for the booking site's own origin", async () => {
    const booking = (process.env.CORS_ORIGINS ?? "http://localhost:3000").split(",")[0]!.trim();
    const app = await appWith(WP);
    for (const path of ["/api/v1/public/bookings", "/api/v1/public/team/x", "/api/v1/bookings"]) {
      const res = await request(app).options(path).set("Origin", booking).set("Access-Control-Request-Method", "POST");
      expect(res.headers["access-control-allow-origin"], path).toBe(booking);
      expect(res.headers["access-control-allow-credentials"], path).toBe("true");
      expect(res.headers["access-control-allow-methods"], path).toContain("POST");
    }
  });

  it("refuses to start the API on a malformed origin list (no wildcard, path or trailing slash; https only in production)", () => {
    const starts = (origins: string, nodeEnv = "development") => {
      const r = spawnSync(process.execPath, ["--import", "tsx", "-e", 'await import("./src/config/env.ts")'], {
        cwd: process.cwd(),
        env: { ...process.env, PUBLIC_CORS_ORIGINS: origins, NODE_ENV: nodeEnv, LOG_LEVEL: "silent" },
        encoding: "utf8",
        timeout: 60_000,
      });
      return r.status === 0;
    };
    expect(starts("https://shifaworks.com,https://www.shifaworks.com")).toBe(true);
    for (const bad of ["*", "https://*.shifaworks.com", "https://shifaworks.com/", "https://shifaworks.com/path", "shifaworks.com"]) {
      expect(starts(bad), bad).toBe(false);
    }
    expect(starts("https://shifaworks.com", "production")).toBe(true); // proves the production failure below is about http, not something else
    expect(starts("http://staging.shifaworks.test", "production")).toBe(false);
  });

  it("keeps the global rate limit on the widget endpoints, and a 429 still carries the CORS header so the page can read it", async () => {
    const before = process.env.RATE_LIMIT_MAX;
    process.env.RATE_LIMIT_MAX = "2";
    try {
      const app = await appWith(WP);
      const statuses: number[] = [];
      let last: request.Response | undefined;
      for (let i = 0; i < 3; i++) {
        last = await request(app).get("/api/v1/public/team/no-such-provider-for-cors").set("Origin", WP);
        statuses.push(last.status);
      }
      expect(statuses.slice(0, 2)).not.toContain(429);
      expect(statuses[2]).toBe(429);
      expect(last!.body.code).toBe("RATE_LIMITED");
      expect(last!.headers["access-control-allow-origin"]).toBe(WP);
    } finally {
      if (before === undefined) delete process.env.RATE_LIMIT_MAX;
      else process.env.RATE_LIMIT_MAX = before;
    }
  });

  it("is off by default", async () => {
    const app = await appWith(undefined);
    const res = await request(app)
      .options("/api/v1/public/availability/slots")
      .set("Origin", WP)
      .set("Access-Control-Request-Method", "GET");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
