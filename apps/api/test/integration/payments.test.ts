/**
 * Phase 6 against real PostgreSQL: payment verification. Every booking is
 * created with exactly one PENDING payment (booking-engine.ts); staff mark it
 * submitted, then verify or reject it. Verifying posts an INCOME ledger row
 * (finance/ledger.ts) and confirms the booking; rejecting opens a fresh
 * PENDING payment so the customer can pay again. Refunding a verified payment
 * posts a REFUND row.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { ALL_PERMISSIONS, type PermissionKey } from "@booking/shared";
import { prisma } from "../../src/lib/prisma.js";
import { AppError } from "../../src/utils/app-error.js";
import type { Principal } from "../../src/modules/auth/principal.service.js";
import { createProvider } from "../../src/modules/providers/providers.service.js";
import { createPackage } from "../../src/modules/services/services.service.js";
import { setWeeklySchedule } from "../../src/modules/availability/availability.service.js";
import { createManualBooking } from "../../src/modules/appointments/bookings.service.js";
import { getPayment, markSubmitted, rejectPayment, verifyPayment, refundPayment } from "../../src/modules/payments/payments.service.js";

const TAG = `itest-${randomUUID().slice(0, 8)}`;
const TZ = "Asia/Karachi";
const ctx = { organizationId: null, userId: null, ipAddress: null, userAgent: "integration-test", requestId: TAG };

let org: { id: string; name: string; slug: string; timezone: string; currency: string; logoUrl: string | null };
let actorId: string;
let hijamaServiceId: string;
let providerId: string;
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
const bookAt = (n: number) =>
  createManualBooking(
    admin(),
    {
      service: "hijama-therapy" as const,
      providerId,
      packageId,
      startsAt: at(n),
      personal: { firstName: "Ahmed", lastName: TAG, phone: "+923001234567", email: `p${emailCounter++}-${TAG}@example.test`, gender: "MALE" as const },
      location: { city: "Karachi", address: "House 1" },
      source: "PHONE" as const,
      overrideAvailability: false,
      markPaid: false,
    },
    ctx,
  );

beforeAll(async () => {
  const o = await prisma.organization.findUniqueOrThrow({ where: { slug: process.env.DEFAULT_ORGANIZATION_SLUG ?? "default" } });
  org = { id: o.id, name: o.name, slug: o.slug, timezone: o.timezone, currency: o.currency, logoUrl: null };
  hijamaServiceId = (await prisma.service.findFirstOrThrow({ where: { organizationId: org.id, slug: "hijama-therapy" } })).id;
  const actor = await prisma.user.create({
    data: { organizationId: org.id, authUserId: randomUUID(), email: `${TAG}-actor@example.test`, firstName: TAG },
  });
  actorId = actor.id;
  createdUserIds.push(actor.id);

  const provider = await createProvider(
    admin(),
    { providerType: "THERAPIST", displayName: `${TAG} Provider`, gender: "MALE", acceptsMale: true, acceptsFemale: true, serviceIds: [hijamaServiceId] },
    ctx,
  );
  providerId = provider.id;
  createdProviderIds.push(providerId);
  await setWeeklySchedule(admin(), providerId, { timezone: TZ, days: [{ dayOfWeek: 1, intervals: [{ start: "09:00", end: "17:00" }] }] }, ctx);
  packageId = (await createPackage(admin(), hijamaServiceId, { name: `${TAG} Package`, price: 1000, durationMinutes: 60 }, ctx)).id;
  createdPackageIds.push(packageId);
});

afterAll(async () => {
  const customers = await prisma.customer.findMany({ where: { email: { endsWith: `${TAG}@example.test` } }, select: { id: true } });
  const customerIds = customers.map((c) => c.id);
  if (customerIds.length) {
    await prisma.financeTransaction.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.payment.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.appointment.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.booking.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
  }
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

describe("mark submitted", () => {
  it("moves PENDING_PAYMENT -> PAYMENT_SUBMITTED and records the reference", async () => {
    const b = await bookAt(0);
    const paymentId = b.payment!.id;
    const updated = await markSubmitted(admin(), paymentId, { reference: "TXN123" }, ctx);
    expect(updated.submittedAt).not.toBeNull();
    expect(updated.reference).toBe("TXN123");
    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect(booking.status).toBe("PAYMENT_SUBMITTED");
  });

  it("needs payments.verify", async () => {
    const b = await bookAt(1);
    const err = await errorOf(markSubmitted(principal(["payments.view"]), b.payment!.id, {}, ctx));
    expect(err.code).toBe("FORBIDDEN");
  });
});

describe("verify", () => {
  it("confirms the booking (autoConfirmOnVerify defaults on) and posts an INCOME ledger row", async () => {
    const b = await bookAt(2);
    const verified = await verifyPayment(admin(), b.payment!.id, { method: "CASH", reference: "BANK-1" }, ctx);
    expect(verified.status).toBe("VERIFIED");
    expect(verified.method).toBe("CASH");
    expect(verified.verifiedAt).not.toBeNull();

    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect(booking.status).toBe("CONFIRMED");
    expect(booking.paymentStatus).toBe("VERIFIED");
    expect(booking.amountPaid.toFixed(2)).toBe(booking.totalAmount.toFixed(2));

    const ledger = await prisma.financeTransaction.findFirst({ where: { paymentId: b.payment!.id } });
    expect(ledger?.type).toBe("INCOME");
    expect(ledger?.amount.toFixed(2)).toBe("1000.00");
    expect(ledger?.transactionNumber).toMatch(/^TXN-\d{4}-\d{6}$/);
  });

  it("refuses to verify a payment twice", async () => {
    const b = await bookAt(3);
    await verifyPayment(admin(), b.payment!.id, { method: "CASH" }, ctx);
    const err = await errorOf(verifyPayment(admin(), b.payment!.id, { method: "CASH" }, ctx));
    expect(err.code).toBe("BAD_REQUEST");
  });

  it("needs payments.verify", async () => {
    const b = await bookAt(4);
    const err = await errorOf(verifyPayment(principal(["payments.view"]), b.payment!.id, { method: "CASH" }, ctx));
    expect(err.code).toBe("FORBIDDEN");
  });
});

describe("reject", () => {
  it("sends the booking back to PENDING_PAYMENT and opens a fresh PENDING payment", async () => {
    const b = await bookAt(5);
    const rejected = await rejectPayment(admin(), b.payment!.id, { reason: "Screenshot did not match" }, ctx);
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.rejectionReason).toBe("Screenshot did not match");

    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect(booking.status).toBe("PENDING_PAYMENT");
    expect(booking.paymentStatus).toBe("PENDING");

    const payments = await prisma.payment.findMany({ where: { bookingId: b.id }, orderBy: { createdAt: "asc" } });
    expect(payments).toHaveLength(2);
    expect(payments[0]!.status).toBe("REJECTED");
    expect(payments[1]!.status).toBe("PENDING");
    expect(payments[1]!.paymentNumber).not.toBe(payments[0]!.paymentNumber);
  });
});

describe("refund", () => {
  it("refunds part of a verified payment, leaving it VERIFIED with a partial refundedAmount", async () => {
    const b = await bookAt(6);
    const verified = await verifyPayment(admin(), b.payment!.id, { method: "CASH" }, ctx);
    const refunded = await refundPayment(admin(), verified.id, { amount: 400, reason: "Partial refund requested" }, ctx);
    expect(refunded.status).toBe("VERIFIED");
    expect(refunded.refundedAmount).toBe("400.00");

    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect(booking.amountPaid.toFixed(2)).toBe("600.00");

    const ledger = await prisma.financeTransaction.findFirst({ where: { paymentId: verified.id, type: "REFUND" } });
    expect(ledger?.amount.toFixed(2)).toBe("400.00");
  });

  it("fully refunding moves the payment to REFUNDED", async () => {
    const b = await bookAt(7);
    const verified = await verifyPayment(admin(), b.payment!.id, { method: "CASH" }, ctx);
    const refunded = await refundPayment(admin(), verified.id, { amount: 1000, reason: "Cancelled" }, ctx);
    expect(refunded.status).toBe("REFUNDED");
    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect(booking.paymentStatus).toBe("REFUNDED");
  });

  it("refuses to refund more than what is refundable", async () => {
    const b = await bookAt(8);
    const verified = await verifyPayment(admin(), b.payment!.id, { method: "CASH" }, ctx);
    const err = await errorOf(refundPayment(admin(), verified.id, { amount: 5000, reason: "Too much" }, ctx));
    expect(err.code).toBe("VALIDATION_ERROR");
  });

  it("refuses to refund a payment that was never verified", async () => {
    const b = await bookAt(9);
    const err = await errorOf(refundPayment(admin(), b.payment!.id, { amount: 100, reason: "N/A" }, ctx));
    expect(err.code).toBe("BAD_REQUEST");
  });

  it("needs payments.refund (payments.verify is not enough)", async () => {
    const b = await bookAt(10);
    const verified = await verifyPayment(admin(), b.payment!.id, { method: "CASH" }, ctx);
    const err = await errorOf(refundPayment(principal(["payments.view", "payments.verify"]), verified.id, { amount: 100, reason: "N/A" }, ctx));
    expect(err.code).toBe("FORBIDDEN");
  });
});

describe("read scoping", () => {
  it("getPayment needs payments.view", async () => {
    const b = await bookAt(11);
    const err = await errorOf(getPayment(principal([]), b.payment!.id));
    expect(err.code).toBe("FORBIDDEN");
    expect((await getPayment(admin(), b.payment!.id)).id).toBe(b.payment!.id);
  });
});
