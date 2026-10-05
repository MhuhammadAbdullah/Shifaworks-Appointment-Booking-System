/**
 * Phase 7 against real PostgreSQL: the transactional outbox (queued in the
 * same transaction as the booking change, deduped by templateKey+booking+
 * audience+occurrence), delivery (render, send via a fake provider, log),
 * retry, "send test", and template management. `test/integration/setup.ts`
 * turns off auto-dispatch for the whole suite, so delivery only happens when
 * a test calls dispatchDue()/deliverNotification() itself.
 */
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { ALL_PERMISSIONS, type PermissionKey } from "@booking/shared";
import { prisma } from "../../src/lib/prisma.js";
import { AppError } from "../../src/utils/app-error.js";
import type { Principal } from "../../src/modules/auth/principal.service.js";
import { createProvider } from "../../src/modules/providers/providers.service.js";
import { createPackage } from "../../src/modules/services/services.service.js";
import { setWeeklySchedule } from "../../src/modules/availability/availability.service.js";
import { createManualBooking, cancelBooking, rescheduleBooking } from "../../src/modules/appointments/bookings.service.js";
import { verifyPayment, rejectPayment } from "../../src/modules/payments/payments.service.js";
import { dispatchDue, deliverNotification } from "../../src/modules/notifications/dispatcher.js";
import { getNotification, listNotifications, retryNotification, sendTest } from "../../src/modules/notifications/notifications.service.js";
import { listTemplates, updateTemplate, previewTemplate } from "../../src/modules/notifications/templates.service.js";
import { setEmailProviderForTest, type EmailMessage, type EmailProvider, type SendResult } from "../../src/modules/notifications/providers/index.js";
import { DeliveryError } from "../../src/modules/notifications/providers/types.js";

const TAG = `itest-${randomUUID().slice(0, 8)}`;
const TZ = "Asia/Karachi";
const ctx = { organizationId: null, userId: null, ipAddress: null, userAgent: "integration-test", requestId: TAG };

let org: { id: string; name: string; slug: string; timezone: string; currency: string; logoUrl: string | null };
let actorId: string;
let hijamaServiceId: string;
let providerId: string;
let otherProviderId: string;
let packageId: string;
const createdUserIds: string[] = [];
const createdProviderIds: string[] = [];
const createdPackageIds: string[] = [];

function principal(permissions: readonly PermissionKey[], over: Partial<Principal> = {}): Principal {
  return {
    userId: actorId,
    authUserId: actorId,
    organizationId: org.id,
    organization: org,
    email: null,
    phone: null,
    firstName: "Actor",
    lastName: null,
    status: "ACTIVE",
    locale: null,
    timezone: null,
    roles: [],
    roleKeys: ["ADMIN"],
    permissions: new Set(permissions),
    isSuperAdmin: false,
    staffProfileId: "staff",
    providerProfileId: null,
    providerType: null,
    avatarUrl: null,
    ...over,
  };
}
const admin = () => principal(ALL_PERMISSIONS.filter((p) => p !== "roles.manage"));

async function errorOf(p: Promise<unknown>): Promise<AppError> {
  try {
    await p;
    throw new Error("expected a rejection");
  } catch (err) {
    if (err instanceof AppError) return err;
    throw err;
  }
}

const weekMonday = (n: number) => DateTime.now().setZone(TZ).plus({ weeks: 4 + n }).startOf("week").toISODate()!;
const at = (n: number, time = "09:00") => DateTime.fromISO(`${weekMonday(n)}T${time}`, { zone: TZ }).toISO()!;

let emailCounter = 0;
const bookAt = (n: number, over: Record<string, unknown> = {}) =>
  createManualBooking(
    admin(),
    {
      service: "hijama-therapy" as const,
      providerId,
      packageId,
      startsAt: at(n),
      personal: { firstName: "Ahmed", lastName: TAG, phone: "+923001234567", email: `n${emailCounter++}-${TAG}@example.test`, gender: "MALE" as const },
      location: { city: "Karachi", address: "House 1" },
      source: "PHONE" as const,
      overrideAvailability: false,
      markPaid: false,
      ...over,
    },
    ctx,
  );

/** A fake provider so tests control exactly what "sending" does, without touching a real inbox. */
class FakeEmailProvider implements EmailProvider {
  readonly name = "fake";
  readonly configured = true;
  sent: EmailMessage[] = [];
  nextError: DeliveryError | null = null;
  async send(m: EmailMessage): Promise<SendResult> {
    if (this.nextError) {
      const e = this.nextError;
      this.nextError = null;
      throw e;
    }
    this.sent.push(m);
    return { providerMessageId: `fake-${this.sent.length}` };
  }
}
const fake = new FakeEmailProvider();

beforeAll(async () => {
  const o = await prisma.organization.findUniqueOrThrow({ where: { slug: process.env.DEFAULT_ORGANIZATION_SLUG ?? "default" } });
  org = { id: o.id, name: o.name, slug: o.slug, timezone: o.timezone, currency: o.currency, logoUrl: null };
  hijamaServiceId = (await prisma.service.findFirstOrThrow({ where: { organizationId: org.id, slug: "hijama-therapy" } })).id;
  const actor = await prisma.user.create({ data: { organizationId: org.id, authUserId: randomUUID(), email: `${TAG}-actor@example.test`, firstName: TAG } });
  actorId = actor.id;
  createdUserIds.push(actor.id);

  for (const [target, name] of [
    ["providerId", "Provider"],
    ["otherProviderId", "Other"],
  ] as const) {
    const id = (
      await createProvider(admin(), { providerType: "THERAPIST", displayName: `${TAG} ${name}`, gender: "MALE", acceptsMale: true, acceptsFemale: true, serviceIds: [hijamaServiceId], email: `${TAG}-${name}@example.test` }, ctx)
    ).id;
    createdProviderIds.push(id);
    await setWeeklySchedule(admin(), id, { timezone: TZ, days: [{ dayOfWeek: 1, intervals: [{ start: "09:00", end: "17:00" }] }] }, ctx);
    if (target === "providerId") providerId = id;
    else otherProviderId = id;
  }
  packageId = (await createPackage(admin(), hijamaServiceId, { name: `${TAG} Package`, price: 1000, durationMinutes: 60 }, ctx)).id;
  createdPackageIds.push(packageId);

  setEmailProviderForTest(fake);
});

afterEach(() => {
  fake.sent = [];
  fake.nextError = null;
});

afterAll(async () => {
  setEmailProviderForTest(null);
  const customers = await prisma.customer.findMany({ where: { email: { endsWith: `${TAG}@example.test` } }, select: { id: true } });
  const customerIds = customers.map((c) => c.id);
  if (customerIds.length) {
    const bookings = await prisma.booking.findMany({ where: { customerId: { in: customerIds } }, select: { id: true } });
    const bookingIds = bookings.map((b) => b.id);
    if (bookingIds.length) {
      await prisma.notificationLog.deleteMany({ where: { notification: { bookingId: { in: bookingIds } } } });
      await prisma.emailLog.deleteMany({ where: { notification: { bookingId: { in: bookingIds } } } });
      await prisma.notification.deleteMany({ where: { bookingId: { in: bookingIds } } });
    }
    await prisma.financeTransaction.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.payment.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.appointment.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.booking.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
  }
  // Test-send notifications have no booking to key off.
  await prisma.notificationLog.deleteMany({ where: { notification: { organizationId: org.id, recipientEmail: { contains: TAG } } } });
  await prisma.emailLog.deleteMany({ where: { recipient: { contains: TAG } } });
  await prisma.notification.deleteMany({ where: { organizationId: org.id, recipientEmail: { contains: TAG } } });
  if (createdPackageIds.length) await prisma.servicePackage.deleteMany({ where: { id: { in: createdPackageIds } } });
  if (createdProviderIds.length) {
    await prisma.serviceProvider.deleteMany({ where: { providerId: { in: createdProviderIds } } });
    await prisma.availabilityRule.deleteMany({ where: { availability: { providerId: { in: createdProviderIds } } } });
    await prisma.availability.deleteMany({ where: { providerId: { in: createdProviderIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: { in: createdProviderIds } } });
  }
  if (createdUserIds.length) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.auditLog.deleteMany({ where: { requestId: TAG } });
  await prisma.$disconnect();
});

describe("outbox: booking submitted", () => {
  it("queues BOOKING_RECEIVED to customer and admin, not provider", async () => {
    const b = await bookAt(0);
    const rows = await prisma.notification.findMany({ where: { bookingId: b.id } });
    expect(rows.map((r) => r.audience).sort()).toEqual(["ADMIN", "CUSTOMER"]);
    expect(rows.every((r) => r.templateKey === "BOOKING_RECEIVED")).toBe(true);
    expect(rows.every((r) => r.status === "QUEUED")).toBe(true);
    const customerRow = rows.find((r) => r.audience === "CUSTOMER")!;
    expect(customerRow.recipientEmail).toContain(TAG);
  });

  it("delivers a queued row: renders, sends via the provider, logs, marks SENT", async () => {
    const b = await bookAt(1);
    await dispatchDue();
    const rows = await prisma.notification.findMany({ where: { bookingId: b.id } });
    expect(rows.every((r) => r.status === "SENT")).toBe(true);
    // dispatchDue() sweeps every due row in the org, not just this test's — filter to this booking's own mail.
    const sentForThisBooking = fake.sent.filter((m) => m.subject.includes(b.bookingNumber));
    expect(sentForThisBooking).toHaveLength(2);

    const emailLogs = await prisma.emailLog.findMany({ where: { notificationId: { in: rows.map((r) => r.id) } } });
    expect(emailLogs).toHaveLength(2);
    expect(emailLogs.every((l) => l.status === "SENT")).toBe(true);
  });

  it("'paid at the desk' sends BOOKING_RECEIVED to admin only and BOOKING_CONFIRMED to customer + provider", async () => {
    const b = await bookAt(2, { markPaid: true, paymentMethod: "CASH" });
    const rows = await prisma.notification.findMany({ where: { bookingId: b.id } });
    const byKey = new Map<string, string[]>();
    for (const r of rows) byKey.set(r.templateKey, [...(byKey.get(r.templateKey) ?? []), r.audience]);
    expect(byKey.get("BOOKING_RECEIVED")?.sort()).toEqual(["ADMIN"]);
    expect(byKey.get("BOOKING_CONFIRMED")?.sort()).toEqual(["CUSTOMER", "PROVIDER"]);
  });
});

describe("outbox: payment verified / rejected", () => {
  it("verifying a payment (auto-confirm on) queues BOOKING_CONFIRMED to customer + provider", async () => {
    const b = await bookAt(3);
    await verifyPayment(admin(), b.payment!.id, { method: "CASH" }, ctx);
    const rows = await prisma.notification.findMany({ where: { bookingId: b.id, templateKey: "BOOKING_CONFIRMED" } });
    expect(rows.map((r) => r.audience).sort()).toEqual(["CUSTOMER", "PROVIDER"]);
  });

  it("rejecting a payment queues PAYMENT_REJECTED to the customer, with the reason in the rendered body", async () => {
    const b = await bookAt(4);
    await rejectPayment(admin(), b.payment!.id, { reason: "Screenshot did not match our records" }, ctx);
    const rows = await prisma.notification.findMany({ where: { bookingId: b.id, templateKey: "PAYMENT_REJECTED" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.audience).toBe("CUSTOMER");
    await dispatchDue();
    // The same recipient also got the BOOKING_RECEIVED mail from booking creation — match on subject, not just "to".
    const sent = fake.sent.find((m) => m.to === rows[0]!.recipientEmail && m.subject.includes(b.bookingNumber) && !m.subject.startsWith("We received"));
    expect(sent?.text).toContain("Screenshot did not match our records");
  });

  it("rejecting the same booking's payment twice queues two distinct notifications (not deduped)", async () => {
    const b = await bookAt(5);
    await rejectPayment(admin(), b.payment!.id, { reason: "First rejection" }, ctx);
    const fresh = await prisma.payment.findFirstOrThrow({ where: { bookingId: b.id, status: "PENDING" } });
    await rejectPayment(admin(), fresh.id, { reason: "Second rejection" }, ctx);
    const rows = await prisma.notification.findMany({ where: { bookingId: b.id, templateKey: "PAYMENT_REJECTED" } });
    expect(rows).toHaveLength(2);
  });
});

describe("outbox: cancel / reschedule", () => {
  it("cancelling a pending booking emails only the customer", async () => {
    const b = await bookAt(6);
    await cancelBooking(admin(), b.id, { reason: "Changed plans" }, ctx);
    const rows = await prisma.notification.findMany({ where: { bookingId: b.id, templateKey: "BOOKING_CANCELLED" } });
    expect(rows.map((r) => r.audience)).toEqual(["CUSTOMER"]);
  });

  it("cancelling a confirmed booking also emails the provider", async () => {
    const b = await bookAt(7);
    await verifyPayment(admin(), b.payment!.id, { method: "CASH" }, ctx);
    await cancelBooking(admin(), b.id, { reason: "No longer needed" }, ctx);
    const rows = await prisma.notification.findMany({ where: { bookingId: b.id, templateKey: "BOOKING_CANCELLED" } });
    expect(rows.map((r) => r.audience).sort()).toEqual(["CUSTOMER", "PROVIDER"]);
  });

  it("rescheduling queues BOOKING_RESCHEDULED to customer + provider, describing the new time", async () => {
    const b = await bookAt(8);
    await rescheduleBooking(admin(), b.id, { startsAt: at(9), providerId: otherProviderId, overrideAvailability: false }, ctx);
    const rows = await prisma.notification.findMany({ where: { bookingId: b.id, templateKey: "BOOKING_RESCHEDULED" } });
    expect(rows.map((r) => r.audience).sort()).toEqual(["CUSTOMER", "PROVIDER"]);
    // Confirms the email goes to the NEW provider, not the one the booking was moved away from.
    const providerRow = rows.find((r) => r.audience === "PROVIDER")!;
    expect(providerRow.recipientEmail).toContain("Other");
    await dispatchDue();
    const customerRow = rows.find((r) => r.audience === "CUSTOMER")!;
    const sentToCustomer = fake.sent.find((m) => m.to === customerRow.recipientEmail && m.subject.includes("rescheduled"));
    expect(sentToCustomer?.text).toContain("Other"); // "...with Other Provider"
  });
});

describe("delivery failure and retry", () => {
  it("a transient DeliveryError leaves the row FAILED for retry", async () => {
    const b = await bookAt(10);
    fake.nextError = new DeliveryError("SMTP timeout", false);
    await dispatchDue();
    const rows = await prisma.notification.findMany({ where: { bookingId: b.id } });
    const failed = rows.find((r) => r.status === "FAILED");
    expect(failed).toBeTruthy();
    expect(failed!.lastError).toContain("SMTP timeout");
  });

  it("retryNotification re-queues a failed row and dispatch then sends it", async () => {
    const b = await bookAt(11);
    fake.nextError = new DeliveryError("temporary", false);
    await dispatchDue();
    const before = await prisma.notification.findFirstOrThrow({ where: { bookingId: b.id, status: "FAILED" } });
    await retryNotification(admin(), before.id, ctx);
    const requeued = await prisma.notification.findUniqueOrThrow({ where: { id: before.id } });
    expect(requeued.status).toBe("QUEUED");
    expect(requeued.attempts).toBe(0);
    await deliverNotification(before.id);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: before.id } })).status).toBe("SENT");
  });

  it("retryNotification refuses a row that is not failed or skipped", async () => {
    const b = await bookAt(12);
    const row = await prisma.notification.findFirstOrThrow({ where: { bookingId: b.id } });
    const err = await errorOf(retryNotification(admin(), row.id, ctx));
    expect(err.code).toBe("BAD_REQUEST");
  });
});

describe("send test", () => {
  it("delivers synchronously with sample values and no booking", async () => {
    const detail = await sendTest(admin(), { templateKey: "BOOKING_CONFIRMED", audience: "CUSTOMER", to: `test-${TAG}@example.test` }, ctx);
    expect(detail.status).toBe("SENT");
    expect(detail.booking).toBeNull();
    expect(fake.sent.some((m) => m.to === `test-${TAG}@example.test`)).toBe(true);
  });
});

describe("list / get", () => {
  it("lists notifications scoped to the organisation and filters by templateKey", async () => {
    const b = await bookAt(13);
    const { items } = await listNotifications(admin(), { page: 1, pageSize: 50, templateKey: "BOOKING_RECEIVED", bookingId: b.id });
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.templateKey === "BOOKING_RECEIVED")).toBe(true);
    expect(await getNotification(admin(), items[0]!.id)).toMatchObject({ id: items[0]!.id });
  });
});

describe("templates", () => {
  it("lists the seeded templates and rejects an unknown variable on update", async () => {
    const templates = await listTemplates(admin());
    expect(templates.length).toBeGreaterThan(0);
    const t = templates.find((x) => x.key === "BOOKING_CONFIRMED" && x.audience === "CUSTOMER")!;
    const err = await errorOf(updateTemplate(admin(), t.id, { bodyHtml: "{{notAVariable}}" }, ctx));
    expect(err.code).toBe("VALIDATION_ERROR");
  });

  it("previews a template with sample values without saving it", () => {
    const preview = previewTemplate({ key: "BOOKING_CONFIRMED", subject: "Hi {{customerName}}", bodyHtml: "<p>{{serviceName}} on {{date}}</p>" });
    expect(preview.errors).toEqual([]);
    expect(preview.subject).toContain("Hi ");
    expect(preview.html).toContain("Hijama Therapy");
  });

  it("preview reports an unknown-variable error instead of throwing", () => {
    const preview = previewTemplate({ key: "BOOKING_CONFIRMED", subject: "Hi", bodyHtml: "{{nope}}" });
    expect(preview.errors.length).toBeGreaterThan(0);
    expect(preview.html).toBe("");
  });
});
