/**
 * "Retry failed emails": after the cause of a delivery failure is fixed, every recently failed email goes back in the
 * queue with fresh attempts; sent ones, and failures older than 30 days, are left alone.
 *
 * Real PostgreSQL - run it against an isolated database (DATABASE_URL override), never production.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, type PermissionKey } from "@booking/shared";
import { prisma } from "../../src/lib/prisma.js";
import type { Principal } from "../../src/modules/auth/principal.service.js";
import { retryFailedNotifications } from "../../src/modules/notifications/notifications.service.js";

const TAG = `itest-${randomUUID().slice(0, 8)}`;
const ctx = { organizationId: null, userId: null, ipAddress: null, userAgent: "integration-test", requestId: TAG };

let org: { id: string; name: string; slug: string; timezone: string; currency: string; logoUrl: string | null };
let actorId: string;
const ids: Record<"failedA" | "failedB" | "failedOld" | "sent", string> = { failedA: "", failedB: "", failedOld: "", sent: "" };

function principal(permissions: readonly PermissionKey[]): Principal {
  return {
    userId: actorId, authUserId: actorId, organizationId: org.id, organization: org, email: null, phone: null, firstName: "Actor", lastName: null,
    status: "ACTIVE", locale: null, timezone: null, roles: [], roleKeys: ["ADMIN"], permissions: new Set(permissions), isSuperAdmin: false,
    staffProfileId: "staff", providerProfileId: null, providerType: null, avatarUrl: null,
  };
}

const row = (name: string, extra: Record<string, unknown>) =>
  prisma.notification.create({
    data: { organizationId: org.id, templateKey: "BOOKING_RECEIVED", audience: "CUSTOMER", channel: "EMAIL", recipientEmail: `${name}-${TAG}@example.test`, ...extra },
    select: { id: true },
  });

beforeAll(async () => {
  const o = await prisma.organization.findUniqueOrThrow({ where: { slug: process.env.DEFAULT_ORGANIZATION_SLUG ?? "default" } });
  org = { id: o.id, name: o.name, slug: o.slug, timezone: o.timezone, currency: o.currency, logoUrl: null };
  const actor = await prisma.user.create({ data: { organizationId: org.id, authUserId: randomUUID(), email: `${TAG}-actor@example.test`, firstName: TAG } });
  actorId = actor.id;
  const failed = { status: "FAILED", attempts: 5, lastError: "SMTP: Connection timeout" } as const;
  ids.failedA = (await row("a", failed)).id;
  ids.failedB = (await row("b", failed)).id;
  ids.sent = (await row("sent", { status: "SENT", attempts: 1, sentAt: new Date() })).id;
  const old = await row("old", failed);
  await prisma.$executeRaw`UPDATE notifications SET "createdAt" = now() - interval '45 days' WHERE id = ${old.id}::uuid`;
  ids.failedOld = old.id;
});

afterAll(async () => {
  await prisma.notificationLog.deleteMany({ where: { notification: { recipientEmail: { endsWith: `${TAG}@example.test` } } } });
  await prisma.notification.deleteMany({ where: { recipientEmail: { endsWith: `${TAG}@example.test` } } });
  await prisma.user.deleteMany({ where: { id: actorId } });
  await prisma.auditLog.deleteMany({ where: { requestId: TAG } });
  await prisma.$disconnect();
});

describe("retryFailedNotifications", () => {
  it("re-queues recent failed emails with fresh attempts and leaves everything else alone", async () => {
    const result = await retryFailedNotifications(principal(ALL_PERMISSIONS.filter((p) => p !== "roles.manage")), ctx);
    expect(result.retried).toBeGreaterThanOrEqual(2);

    for (const id of [ids.failedA, ids.failedB]) {
      const n = await prisma.notification.findUniqueOrThrow({ where: { id } });
      expect(n).toMatchObject({ status: "QUEUED", attempts: 0, lastError: null, scheduledFor: null });
    }
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: ids.sent } })).status).toBe("SENT");
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: ids.failedOld } })).status).toBe("FAILED");
  });

  it("does nothing the second time round", async () => {
    const again = await retryFailedNotifications(principal(ALL_PERMISSIONS.filter((p) => p !== "roles.manage")), ctx);
    expect(again.retried).toBe(0);
  });
});
