import { describe, expect, it } from "vitest";
import express from "express";
import { pinoHttp } from "pino-http";
import request from "supertest";
import type { PermissionKey } from "@booking/shared";
import { logger } from "../config/logger.js";
import { AppError } from "../utils/app-error.js";
import { errorHandler } from "./error-handler.js";
import { createAuthenticate, requireAnyPermission, requirePermission } from "./auth.js";
import type { Principal } from "../modules/auth/principal.service.js";

function principal(permissions: PermissionKey[], overrides: Partial<Principal> = {}): Principal {
  return {
    userId: "u1",
    authUserId: "a1",
    organizationId: "o1",
    organization: { id: "o1", name: "Org", slug: "org", timezone: "Asia/Karachi", currency: "PKR", logoUrl: null },
    email: "user@example.com",
    phone: null,
    firstName: "Test",
    lastName: null,
    status: "ACTIVE",
    locale: null,
    timezone: null,
    roles: [],
    roleKeys: [],
    permissions: new Set(permissions),
    isSuperAdmin: false,
    staffProfileId: null,
    providerProfileId: null,
    providerType: null,
    ...overrides,
  };
}

/** Test tokens: "good:<perm,perm>", "super", "disabled", anything else invalid. */
function buildApp() {
  const { requireAuth, authenticate } = createAuthenticate(
    async (token) => {
      if (token.startsWith("good:") || token === "super" || token === "disabled") {
        return { sub: token, email: null, sessionId: null, payload: {} };
      }
      throw AppError.unauthenticated("Invalid access token");
    },
    async (t) => {
      if (t.sub === "super") return principal([], { isSuperAdmin: true });
      if (t.sub === "disabled") throw AppError.forbidden("This account is disabled.");
      return principal(t.sub.slice(5).split(",").filter(Boolean) as PermissionKey[]);
    },
  );
  const app = express();
  app.use(pinoHttp({ logger }));
  app.get("/public", authenticate, (req, res) => {
    res.json({ anonymous: !req.principal });
  });
  app.get("/view", requireAuth, requirePermission("bookings.view"), (_req, res) => {
    res.json({ ok: true });
  });
  app.get("/both", requireAuth, requirePermission("finance.view", "finance.export"), (_req, res) => {
    res.json({ ok: true });
  });
  app.get("/any", requireAuth, requireAnyPermission("staff.view", "payments.view"), (_req, res) => {
    res.json({ ok: true });
  });
  app.use(errorHandler);
  return app;
}

const app = buildApp();

describe("auth middleware", () => {
  it("401 without a token", async () => {
    const res = await request(app).get("/view");
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ success: false, code: "UNAUTHENTICATED" });
  });

  it("401 for a non-bearer or invalid token", async () => {
    expect((await request(app).get("/view").set("Authorization", "Basic abc")).status).toBe(401);
    expect((await request(app).get("/view").set("Authorization", "Bearer nope")).status).toBe(401);
  });

  it("403 for a disabled account", async () => {
    const res = await request(app).get("/view").set("Authorization", "Bearer disabled");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN");
  });

  it("403 when the permission is missing, 200 when present", async () => {
    expect((await request(app).get("/view").set("Authorization", "Bearer good:services.view")).status).toBe(403);
    expect((await request(app).get("/view").set("Authorization", "Bearer good:bookings.view")).status).toBe(200);
  });

  it("requirePermission needs ALL listed permissions", async () => {
    expect((await request(app).get("/both").set("Authorization", "Bearer good:finance.view")).status).toBe(403);
    expect(
      (await request(app).get("/both").set("Authorization", "Bearer good:finance.view,finance.export")).status,
    ).toBe(200);
  });

  it("requireAnyPermission needs ONE of the listed permissions", async () => {
    expect((await request(app).get("/any").set("Authorization", "Bearer good:payments.view")).status).toBe(200);
    expect((await request(app).get("/any").set("Authorization", "Bearer good:finance.view")).status).toBe(403);
  });

  it("super admin bypasses permission checks", async () => {
    expect((await request(app).get("/both").set("Authorization", "Bearer super")).status).toBe(200);
  });

  it("authenticate is optional but still rejects bad tokens", async () => {
    expect((await request(app).get("/public")).body).toEqual({ anonymous: true });
    expect((await request(app).get("/public").set("Authorization", "Bearer good:")).body).toEqual({ anonymous: false });
    expect((await request(app).get("/public").set("Authorization", "Bearer nope")).status).toBe(401);
  });
});
