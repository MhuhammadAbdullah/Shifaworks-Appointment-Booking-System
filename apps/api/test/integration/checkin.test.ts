/**
 * Phase 11 against real PostgreSQL: digital-ticket check-in. One action
 * (checkIn) backs both the QR-scan flow (lookup by checkInToken) and the
 * manual search flow (lookup by booking number) — this file exercises both
 * lookup paths against the same underlying check-in/reset logic.
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
import { checkIn, lookup, reset } from "../../src/modules/checkin/checkin.service.js";
import { ids } from "./cleanup.js";

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

function principal(permissions: readonly PermissionKey[]): Principal {
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

const monday = DateTime.now().setZone(TZ).plus({ weeks: 8 }).startOf("week").toISODate()!;
const at = (time: string) => DateTime.fromISO(`${monday}T${time}`, { zone: TZ }).toISO()!;

const body = (startsAt: string, over: Partial<Record<string, unknown>> = {}) => ({
  service: "hijama-therapy" as const,
  providerId,
  packageId,
  startsAt,
  personal: { firstName: "Ahmed", lastName: TAG, phone: "+923001234567", email: `${TAG}@example.test`, gender: "MALE" as const },
  location: { city: "Karachi" },
  source: "PHONE" as const,
  overrideAvailability: false,
  markPaid: true,
  paymentMethod: "CASH" as const,
  ...over,
});

beforeAll(async () => {
  const o = await prisma.organization.findUniqueOrThrow({ where: { slug: process.env.DEFAULT_ORGANIZATION_SLUG ?? "default" } });
  org = { id: o.id, name: o.name, slug: o.slug, timezone: o.timezone, currency: o.currency, logoUrl: null };
  hijamaServiceId = (await prisma.service.findFirstOrThrow({ where: { organizationId: org.id, slug: "hijama-therapy" } })).id;
  const actor = await prisma.user.create({ data: { organizationId: org.id, authUserId: randomUUID(), email: `${TAG}-actor@example.test`, firstName: TAG } });
  actorId = actor.id;
  createdUserIds.push(actor.id);

  providerId = (
    await createProvider(admin(), { providerType: "THERAPIST", displayName: `${TAG} Provider`, gender: "MALE", acceptsMale: true, acceptsFemale: true, serviceIds: [hijamaServiceId] }, ctx)
  ).id;
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
  if (ids(TAG)) await prisma.auditLog.deleteMany({ where: { requestId: TAG } });
  await prisma.$disconnect();
});

describe("check-in", () => {
  it("looks up a confirmed booking by its QR check-in token", async () => {
    const b = await createManualBooking(admin(), body(at("09:00")), ctx);
    expect(b.status).toBe("CONFIRMED");
    const appointment = await prisma.appointment.findFirstOrThrow({ where: { bookingId: b.id } });

    const found = await lookup(admin(), { token: appointment.checkInToken });
    expect(found).toMatchObject({ appointmentId: appointment.id, bookingNumber: b.bookingNumber, checkedIn: false });
  });

  it("looks up the same booking by its booking number (manual search)", async () => {
    const b = await createManualBooking(admin(), body(at("10:15")), ctx);
    const found = await lookup(admin(), { search: b.bookingNumber });
    expect(found.bookingId).toBe(b.id);
    // case-insensitive, matching the payments/bookings search convention elsewhere
    const lower = await lookup(admin(), { search: b.bookingNumber.toLowerCase() });
    expect(lower.bookingId).toBe(b.id);
  });

  it("404s for an unknown token", async () => {
    const err = await errorOf(lookup(admin(), { token: randomUUID() }));
    expect(err.code).toBe("NOT_FOUND");
  });

  it("checks in once, is idempotent on a second attempt, and blocks the same via a second reset-free check-in", async () => {
    const b = await createManualBooking(admin(), body(at("11:30")), ctx);
    const appointment = await prisma.appointment.findFirstOrThrow({ where: { bookingId: b.id } });

    const first = await checkIn(admin(), appointment.id, ctx);
    expect(first).toMatchObject({ checkedIn: true, alreadyCheckedIn: false });
    expect(first.checkedInAt).not.toBeNull();

    const second = await checkIn(admin(), appointment.id, ctx);
    expect(second).toMatchObject({ checkedIn: true, alreadyCheckedIn: true });
    expect(second.checkedInAt).toBe(first.checkedInAt); // untouched by the second attempt

    const auditRows = await prisma.auditLog.count({ where: { action: "checkin.create", entityId: appointment.id } });
    expect(auditRows).toBe(1); // only the first, real check-in was recorded
  });

  it("reset clears the check-in so it can be checked in again", async () => {
    const b = await createManualBooking(admin(), body(at("12:45")), ctx);
    const appointment = await prisma.appointment.findFirstOrThrow({ where: { bookingId: b.id } });
    await checkIn(admin(), appointment.id, ctx);

    const afterReset = await reset(admin(), appointment.id, ctx);
    expect(afterReset.checkedIn).toBe(false);

    const rechecked = await checkIn(admin(), appointment.id, ctx);
    expect(rechecked).toMatchObject({ checkedIn: true, alreadyCheckedIn: false });
  });

  it("refuses to check in a booking that isn't confirmed yet", async () => {
    const b = await createManualBooking(admin(), body(at("14:00"), { markPaid: false, paymentMethod: undefined }), ctx);
    expect(b.status).toBe("PENDING_PAYMENT");
    const appointment = await prisma.appointment.findFirstOrThrow({ where: { bookingId: b.id } });
    const err = await errorOf(checkIn(admin(), appointment.id, ctx));
    expect(err.code).toBe("BAD_REQUEST");
  });

  it("needs bookings.check_in for lookup, check-in and reset", async () => {
    const b = await createManualBooking(admin(), body(at("15:15")), ctx);
    const appointment = await prisma.appointment.findFirstOrThrow({ where: { bookingId: b.id } });
    const noPerm = principal([]);
    expect((await errorOf(lookup(noPerm, { token: appointment.checkInToken }))).code).toBe("FORBIDDEN");
    expect((await errorOf(checkIn(noPerm, appointment.id, ctx))).code).toBe("FORBIDDEN");
    expect((await errorOf(reset(noPerm, appointment.id, ctx))).code).toBe("FORBIDDEN");
  });
});
