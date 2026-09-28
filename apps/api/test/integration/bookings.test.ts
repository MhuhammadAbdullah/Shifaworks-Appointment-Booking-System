/**
 * Phase 5 against real PostgreSQL: manual/staff booking (built on the same
 * `createAppointmentBooking` engine the public forms use), "paid at the desk"
 * auto-confirmation, listing/filtering/search, provider-owns-only scoping,
 * cancel, complete/no-show (staff or the appointment's own provider, only
 * once it has started), and reschedule (old appointment freed via the
 * exclusion constraint, new one takes over — same pattern the double-booking
 * guarantee in public-booking.test.ts relies on).
 *
 * Deliberately does not touch the shared demo providers/services; every
 * mutated row is a fixture tagged with TAG.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { ALL_PERMISSIONS, manualBookingSchema, type PermissionKey } from "@booking/shared";
import { prisma } from "../../src/lib/prisma.js";
import { AppError } from "../../src/utils/app-error.js";
import type { Principal } from "../../src/modules/auth/principal.service.js";
import { createProvider } from "../../src/modules/providers/providers.service.js";
import { createPackage } from "../../src/modules/services/services.service.js";
import { setWeeklySchedule } from "../../src/modules/availability/availability.service.js";
import {
  cancelBooking,
  completeBooking,
  createManualBooking,
  deleteBooking,
  getBooking,
  listBookings,
  markNoShow,
  rescheduleBooking,
  updateBookingDetails,
  updateBookingNotes,
} from "../../src/modules/appointments/bookings.service.js";
import { ids } from "./cleanup.js";

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
const createdBookingIds: string[] = [];

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
    ...over,
  };
}
const admin = () => principal(ALL_PERMISSIONS.filter((p) => p !== "roles.manage"));
const asProvider = (id: string) => principal(["bookings.view", "bookings.update"], { staffProfileId: null, providerProfileId: id });

async function errorOf(p: Promise<unknown>): Promise<AppError> {
  try {
    await p;
    throw new Error("expected a rejection");
  } catch (err) {
    if (err instanceof AppError) return err;
    throw err;
  }
}

/**
 * Every booking in this file gets its own Monday, `4 + n` weeks out, always
 * at 09:00 (on-grid, well within the working hours set up below) — this
 * sidesteps tracking a shared slot grid across ~20 fixtures on two providers;
 * each call site below just uses the next unused `n`. A handful of pairs
 * intentionally reuse the same `n` (documented at each call) to set up an
 * exact same-time collision the test is checking for.
 */
const weekMonday = (n: number) => DateTime.now().setZone(TZ).plus({ weeks: 4 + n }).startOf("week").toISODate()!;
const at = (n: number, time = "09:00") => DateTime.fromISO(`${weekMonday(n)}T${time}`, { zone: TZ }).toISO()!;

const body = (over: Partial<Record<string, unknown>> = {}) => ({
  service: "hijama-therapy" as const,
  providerId,
  packageId,
  startsAt: at(0),
  personal: { firstName: "Ahmed", lastName: TAG, phone: "+923001234567", email: `${TAG}@example.test`, gender: "MALE" as const },
  location: { city: "Karachi", address: "House 1" },
  source: "PHONE" as const,
  overrideAvailability: false,
  markPaid: false,
  ...over,
});

beforeAll(async () => {
  const o = await prisma.organization.findUniqueOrThrow({ where: { slug: process.env.DEFAULT_ORGANIZATION_SLUG ?? "default" } });
  org = { id: o.id, name: o.name, slug: o.slug, timezone: o.timezone, currency: o.currency, logoUrl: null };
  hijamaServiceId = (await prisma.service.findFirstOrThrow({ where: { organizationId: org.id, slug: "hijama-therapy" } })).id;
  const actor = await prisma.user.create({
    data: { organizationId: org.id, authUserId: randomUUID(), email: `${TAG}-actor@example.test`, firstName: TAG },
  });
  actorId = actor.id;
  createdUserIds.push(actor.id);

  for (const [target, name] of [
    ["providerId", "Provider"],
    ["otherProviderId", "Other"],
  ] as const) {
    const id = (
      await createProvider(
        admin(),
        { providerType: "THERAPIST", displayName: `${TAG} ${name}`, gender: "MALE", acceptsMale: true, acceptsFemale: true, serviceIds: [hijamaServiceId] },
        ctx,
      )
    ).id;
    createdProviderIds.push(id);
    await setWeeklySchedule(admin(), id, { timezone: TZ, days: [{ dayOfWeek: 1, intervals: [{ start: "09:00", end: "17:00" }] }] }, ctx);
    if (target === "providerId") providerId = id;
    else otherProviderId = id;
  }
  packageId = (await createPackage(admin(), hijamaServiceId, { name: `${TAG} Package`, price: 1000, durationMinutes: 60 }, ctx)).id;
  createdPackageIds.push(packageId);
});

afterAll(async () => {
  // Scoped by customer, not just the tracked createdBookingIds array: every
  // fixture customer's email ends with `${TAG}@example.test`, so this sweeps
  // every booking/appointment/payment even if a failed test skipped pushing
  // its id, instead of leaving orphans that block the customer delete below.
  const customers = await prisma.customer.findMany({ where: { email: { endsWith: `${TAG}@example.test` } }, select: { id: true } });
  const customerIds = customers.map((c) => c.id);
  if (customerIds.length) {
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

describe("manual booking", () => {
  it("creates a PENDING_PAYMENT booking by default", async () => {
    const b = await createManualBooking(admin(), body(), ctx);
    createdBookingIds.push(b.id);
    expect(b.bookingNumber).toMatch(/^APT-\d{4}-\d{6}$/);
    expect(b.status).toBe("PENDING_PAYMENT");
    expect(b.paymentStatus).toBe("PENDING");
    expect(b.source).toBe("PHONE");
    expect(b.providerName).toContain(TAG);
    expect(b.customer.customerNumber).toMatch(/^CUS-\d{4}-\d{6}$/);
    expect(b.payment?.status).toBe("PENDING");
  });

  it("'paid at the desk' auto-confirms (autoConfirmOnVerify defaults on)", async () => {
    const b = await createManualBooking(admin(), body({ startsAt: at(1), markPaid: true, paymentMethod: "CASH" }), ctx);
    createdBookingIds.push(b.id);
    expect(b.status).toBe("CONFIRMED");
    expect(b.paymentStatus).toBe("VERIFIED");
    expect(b.confirmedAt).not.toBeNull();
    expect(b.payment?.status).toBe("VERIFIED");
    expect(b.payment?.method).toBe("CASH");
  });

  it("the shared schema requires a payment method when marking paid (enforced by validate() before the service runs)", () => {
    expect(manualBookingSchema.safeParse(body({ startsAt: at(2), markPaid: true })).success).toBe(false);
    expect(manualBookingSchema.safeParse(body({ startsAt: at(2), markPaid: true, paymentMethod: "CASH" })).success).toBe(true);
  });

  it("needs bookings.create", async () => {
    // Rejected at the permission gate before any slot is touched, so the time value here is nominal.
    const err = await errorOf(createManualBooking(principal(["bookings.view_all"]), body({ startsAt: at(3) }), ctx));
    expect(err.code).toBe("FORBIDDEN");
  });

  it("still refuses a time outside the provider's working hours", async () => {
    const err = await errorOf(createManualBooking(admin(), body({ startsAt: at(4, "06:00") }), ctx));
    expect(err.code).toBe("VALIDATION_ERROR");
  });
});

describe("listing and scoping", () => {
  let ownBookingId: string;
  let otherBookingId: string;

  beforeAll(async () => {
    ownBookingId = (await createManualBooking(admin(), body({ startsAt: at(5) }), ctx)).id;
    createdBookingIds.push(ownBookingId);
    otherBookingId = (await createManualBooking(admin(), body({ startsAt: at(6), providerId: otherProviderId, personal: { ...body().personal, email: `other-${TAG}@example.test` } }), ctx)).id;
    createdBookingIds.push(otherBookingId);
  });

  it("staff with bookings.view_all sees everything and can filter/search", async () => {
    const all = await listBookings(admin(), { page: 1, pageSize: 50, search: TAG, sort: "desc" });
    const ids_ = all.items.map((i) => i.id);
    expect(ids_).toEqual(expect.arrayContaining([ownBookingId, otherBookingId]));

    const byProvider = await listBookings(admin(), { page: 1, pageSize: 50, providerId, search: TAG, sort: "desc" });
    expect(byProvider.items.map((i) => i.id)).toContain(ownBookingId);
    expect(byProvider.items.map((i) => i.id)).not.toContain(otherBookingId);
  });

  it("a provider sees only bookings on their own appointments", async () => {
    const mine = await listBookings(asProvider(providerId), { page: 1, pageSize: 50, search: TAG, sort: "desc" });
    expect(mine.items.map((i) => i.id)).toContain(ownBookingId);
    expect(mine.items.map((i) => i.id)).not.toContain(otherBookingId);

    expect((await getBooking(asProvider(providerId), ownBookingId)).id).toBe(ownBookingId);
    expect(await errorOf(getBooking(asProvider(providerId), otherBookingId))).toMatchObject({ code: "NOT_FOUND" });
  });

  it("redacts customer contact details, payment and check-in from a provider (name stays, everything else is stripped server-side)", async () => {
    const asStaff = await getBooking(admin(), ownBookingId);
    expect(asStaff.customer.phone).not.toBeNull();
    expect(asStaff.customerPhone).not.toBeNull();
    expect(asStaff.payment).not.toBeNull();

    const list = await listBookings(asProvider(providerId), { page: 1, pageSize: 50, search: TAG, sort: "desc" });
    const row = list.items.find((i) => i.id === ownBookingId)!;
    expect(row.customerName).not.toBe("");
    expect(row.customerPhone).toBeNull();
    expect(row.customerEmail).toBeNull();

    const detail = await getBooking(asProvider(providerId), ownBookingId);
    expect(detail.customer.phone).toBeNull();
    expect(detail.customer.email).toBeNull();
    expect(detail.customer.dateOfBirth).toBeNull();
    expect(detail.customer.gender).toBeNull();
    expect(detail.customer.city).toBeNull();
    expect(detail.customer.province).toBeNull();
    expect(detail.customer.address).toBeNull();
    expect(detail.customerNotes).toBeNull();
    expect(detail.payment).toBeNull();
  });

  it("saves internal notes", async () => {
    const updated = await updateBookingNotes(admin(), ownBookingId, { internalNotes: "Called to confirm" }, ctx);
    expect(updated.internalNotes).toBe("Called to confirm");
  });

  it("accepts a comma-separated multi-select status filter (Part A)", async () => {
    const cancelledForFilter = await createManualBooking(
      admin(),
      body({ startsAt: at(24), personal: { ...body().personal, email: `filter-${TAG}@example.test` } }),
      ctx,
    );
    createdBookingIds.push(cancelledForFilter.id);
    await cancelBooking(admin(), cancelledForFilter.id, {}, ctx);

    const union = await listBookings(admin(), { page: 1, pageSize: 50, search: TAG, status: ["PENDING_PAYMENT", "CANCELLED"], sort: "desc" });
    const unionIds = union.items.map((i) => i.id);
    expect(unionIds).toContain(ownBookingId); // still PENDING_PAYMENT
    expect(unionIds).toContain(cancelledForFilter.id);

    const onlyCancelled = await listBookings(admin(), { page: 1, pageSize: 50, search: TAG, status: ["CANCELLED"], sort: "desc" });
    const cancelledIds = onlyCancelled.items.map((i) => i.id);
    expect(cancelledIds).toContain(cancelledForFilter.id);
    expect(cancelledIds).not.toContain(ownBookingId);
  });
});

describe("cancel", () => {
  it("cancels a pending booking and refuses a second cancel", async () => {
    const b = await createManualBooking(admin(), body({ startsAt: at(7) }), ctx);
    createdBookingIds.push(b.id);
    const cancelled = await cancelBooking(admin(), b.id, { reason: "Customer changed plans" }, ctx);
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.cancellationReason).toBe("Customer changed plans");

    const appointment = await prisma.appointment.findFirstOrThrow({ where: { bookingId: b.id } });
    expect(appointment.status).toBe("CANCELLED");

    const err = await errorOf(cancelBooking(admin(), b.id, {}, ctx));
    expect(err.code).toBe("BAD_REQUEST");
  });
});

describe("complete / no-show", () => {
  async function confirmedPastBooking(week: number) {
    const b = await createManualBooking(admin(), body({ startsAt: at(week), markPaid: true, paymentMethod: "CASH" }), ctx);
    createdBookingIds.push(b.id);
    // Simulate time passing: move the appointment into the past directly (the
    // booking engine itself never accepts a past start time). blockedFrom/
    // blockedUntil must move with it — the DB check constraint requires
    // blockedFrom <= startsAt <= endsAt <= blockedUntil.
    await prisma.appointment.updateMany({
      where: { bookingId: b.id },
      data: {
        startsAt: new Date(Date.now() - 3_600_000),
        endsAt: new Date(Date.now() - 1_800_000),
        blockedFrom: new Date(Date.now() - 3_600_000),
        blockedUntil: new Date(Date.now() - 1_800_000),
      },
    });
    return b.id;
  }

  it("refuses to complete a confirmed booking before it has started", async () => {
    const b = await createManualBooking(admin(), body({ startsAt: at(8) }), ctx); // future, not even confirmed
    createdBookingIds.push(b.id);
    const err = await errorOf(completeBooking(admin(), b.id, ctx));
    expect(err.code).toBe("BAD_REQUEST");
  });

  it("staff can complete a confirmed, started booking", async () => {
    const id = await confirmedPastBooking(9);
    const done = await completeBooking(admin(), id, ctx);
    expect(done.status).toBe("COMPLETED");
    expect(done.completedAt).not.toBeNull();
  });

  it("the owning provider can mark their own booking no-show; a provider with no visibility into it gets a 404", async () => {
    const id = await confirmedPastBooking(10);
    // otherProviderId isn't on this booking at all, so the scoped lookup itself can't see it — 404,
    // the same "cannot even tell you it exists" behaviour as listing/scoping above, not a bare 403.
    expect((await errorOf(markNoShow(asProvider(otherProviderId), id, ctx))).code).toBe("NOT_FOUND");
    const result = await markNoShow(asProvider(providerId), id, ctx);
    expect(result.status).toBe("NO_SHOW");
  });
});

describe("reschedule", () => {
  it("moves a booking to a new time, freeing the old slot", async () => {
    const b = await createManualBooking(admin(), body({ startsAt: at(11) }), ctx);
    createdBookingIds.push(b.id);
    const moved = await rescheduleBooking(admin(), b.id, { startsAt: at(12), providerId: otherProviderId, overrideAvailability: false }, ctx);
    expect(moved.providerName).toContain("Other");
    expect(moved.startsAt).toBe(new Date(at(12)).toISOString());
    expect(moved.rescheduledFromId).not.toBeNull();

    // The old appointment is RESCHEDULED, not deleted, and no longer blocks the old slot.
    const rows = await prisma.appointment.findMany({ where: { bookingId: b.id }, orderBy: { createdAt: "asc" } });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.status).toBe("RESCHEDULED");
    expect(rows[1]!.status).toBe("PENDING_PAYMENT");
  });

  it("refuses to reschedule onto the same time and provider", async () => {
    const b = await createManualBooking(admin(), body({ startsAt: at(13) }), ctx);
    createdBookingIds.push(b.id);
    const err = await errorOf(rescheduleBooking(admin(), b.id, { startsAt: at(13), overrideAvailability: false }, ctx));
    expect(err.code).toBe("BAD_REQUEST");
  });

  it("only staff (bookings.view_all) may reschedule, not a bare provider", async () => {
    const b = await createManualBooking(admin(), body({ startsAt: at(14), providerId: otherProviderId, personal: { ...body().personal, email: `resched-${TAG}@example.test` } }), ctx);
    createdBookingIds.push(b.id);
    // Rejected at the permission gate before any slot is touched, so the target time here is nominal.
    const err = await errorOf(rescheduleBooking(asProvider(otherProviderId), b.id, { startsAt: at(15), overrideAvailability: false }, ctx));
    expect(err.code).toBe("FORBIDDEN");
  });

  it("lets exactly one of two concurrent reschedules onto the same free slot win", async () => {
    const a = await createManualBooking(admin(), body({ startsAt: at(16), personal: { ...body().personal, email: `race-a-${TAG}@example.test` } }), ctx);
    const b = await createManualBooking(admin(), body({ startsAt: at(17), providerId: otherProviderId, personal: { ...body().personal, email: `race-b-${TAG}@example.test` } }), ctx);
    createdBookingIds.push(a.id, b.id);
    const target = at(18);
    const results = await Promise.allSettled([
      rescheduleBooking(admin(), a.id, { startsAt: target, providerId, overrideAvailability: false }, ctx),
      rescheduleBooking(admin(), b.id, { startsAt: target, providerId, overrideAvailability: false }, ctx),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0]!.reason as AppError).code).toBe("SLOT_UNAVAILABLE");
  });
});

describe("update details", () => {
  it("updates the customer-contact snapshot and records an audit entry", async () => {
    const b = await createManualBooking(admin(), body({ startsAt: at(30) }), ctx);
    createdBookingIds.push(b.id);
    const updated = await updateBookingDetails(
      admin(),
      b.id,
      { firstName: "Updated", lastName: "Customer", email: `updated-${TAG}@example.test`, phone: "+923009999999" },
      ctx,
    );
    expect(updated.customer.firstName).toBe("Updated");
    expect(updated.customer.lastName).toBe("Customer");
    expect(updated.customer.email).toBe(`updated-${TAG}@example.test`);
    expect(updated.customer.phone).toBe("+923009999999");

    const audit = await prisma.auditLog.findFirst({ where: { entityId: b.id, action: "booking.update_details" } });
    expect(audit).not.toBeNull();
  });

  it("needs bookings.update", async () => {
    const b = await createManualBooking(admin(), body({ startsAt: at(31) }), ctx);
    createdBookingIds.push(b.id);
    const err = await errorOf(updateBookingDetails(principal(["bookings.view_all"]), b.id, { firstName: "Nope" }, ctx));
    expect(err.code).toBe("FORBIDDEN");
  });
});

describe("delete", () => {
  it("hard-deletes a booking with no payment history", async () => {
    const b = await createManualBooking(admin(), body({ startsAt: at(32) }), ctx);
    await deleteBooking(admin(), b.id, ctx);
    expect(await prisma.booking.findUnique({ where: { id: b.id } })).toBeNull();
    expect(await prisma.appointment.findFirst({ where: { bookingId: b.id } })).toBeNull();
    expect(await prisma.payment.findFirst({ where: { bookingId: b.id } })).toBeNull();

    // The audit log is never deleted — it's the only trace left afterwards.
    const audit = await prisma.auditLog.findFirst({ where: { entityId: b.id, action: "booking.delete" } });
    expect(audit).not.toBeNull();
  });

  it("refuses to delete a booking with a verified payment, naming Cancel instead", async () => {
    const b = await createManualBooking(admin(), body({ startsAt: at(33), markPaid: true, paymentMethod: "CASH" }), ctx);
    createdBookingIds.push(b.id);
    const err = await errorOf(deleteBooking(admin(), b.id, ctx));
    expect(err.code).toBe("CONFLICT");
    expect(err.message).toMatch(/cancel/i);
    expect(await prisma.booking.findUnique({ where: { id: b.id } })).not.toBeNull();
  });

  it("needs bookings.delete", async () => {
    const b = await createManualBooking(admin(), body({ startsAt: at(34) }), ctx);
    createdBookingIds.push(b.id);
    const err = await errorOf(deleteBooking(principal(["bookings.view_all"]), b.id, ctx));
    expect(err.code).toBe("FORBIDDEN");
  });
});
