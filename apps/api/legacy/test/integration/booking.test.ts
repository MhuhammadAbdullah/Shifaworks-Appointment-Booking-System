/**
 * Booking engine against real PostgreSQL: double-booking prevention under
 * concurrency, buffers, cancellation, rescheduling, hold expiry, idempotency
 * and the database exclusion constraint itself.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { prisma } from "../../src/lib/prisma.js";
import { deleteTestNotifications, ids } from "./cleanup.js";
import { AppError } from "../../src/utils/app-error.js";
import { isExclusionViolation } from "../../src/utils/db-errors.js";
import { createAppointmentBooking, type CreateBookingRequest } from "../../src/modules/appointments/booking-engine.js";
import { cancelAppointment, rescheduleAppointment } from "../../src/modules/appointments/appointments.service.js";
import type { Principal } from "../../src/modules/auth/principal.service.js";
import { ALL_PERMISSIONS } from "@booking/shared";

const TAG = `itest-${randomUUID().slice(0, 8)}`;
const TZ = "Asia/Karachi";
const ctx = { organizationId: null, userId: null, ipAddress: null, userAgent: "integration-test", requestId: TAG };

let org: { id: string; timezone: string; currency: string };
let providerId: string;
let serviceId: string;
let prepayServiceId: string;
let customerIds: string[] = [];
let staffUserId: string;
let seqBefore: number | null = null;
const createdUserIds: string[] = [];

/** Local Karachi wall-clock on the test Monday → Date. */
let monday: string;
const at = (time: string, date = monday) => DateTime.fromISO(`${date}T${time}`, { zone: TZ }).toJSDate();

function request(over: Partial<CreateBookingRequest>): CreateBookingRequest {
  return {
    organization: org,
    customerId: customerIds[0]!,
    serviceId,
    providerId,
    startsAt: at("10:00"),
    source: "ADMIN",
    online: false,
    confirm: true,
    overrideAvailability: false,
    actorUserId: staffUserId,
    ...over,
  };
}

async function errorCode(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "OK";
  } catch (err) {
    if (err instanceof AppError) return err.code;
    throw err;
  }
}

function staffPrincipal(): Principal {
  return {
    userId: staffUserId,
    authUserId: staffUserId,
    organizationId: org.id,
    organization: { ...org, name: "Test", slug: "test" },
    email: null,
    phone: null,
    firstName: "Staff",
    lastName: null,
    status: "ACTIVE",
    locale: null,
    timezone: null,
    roles: [],
    roleKeys: ["ADMIN"],
    permissions: new Set(ALL_PERMISSIONS),
    isSuperAdmin: false,
    staffProfileId: null,
    providerProfileId: null,
    providerType: null,
    customerProfileId: null,
  };
}

beforeAll(async () => {
  const o = await prisma.organization.findUniqueOrThrow({ where: { slug: process.env.DEFAULT_ORGANIZATION_SLUG ?? "default" } });
  org = { id: o.id, timezone: o.timezone, currency: o.currency };
  const year = DateTime.now().setZone(org.timezone).year;
  seqBefore =
    (await prisma.documentSequence.findUnique({ where: { organizationId_prefix_year: { organizationId: org.id, prefix: "APT", year } } }))
      ?.lastValue ?? null;

  // A Monday at least two weeks ahead, so notice/advance rules never interfere.
  let d = DateTime.now().setZone(TZ).plus({ days: 14 }).startOf("day");
  while (d.weekday !== 1) d = d.plus({ days: 1 });
  monday = d.toISODate()!;

  const staff = await prisma.user.create({ data: { organizationId: org.id, firstName: `${TAG}-staff` } });
  staffUserId = staff.id;
  createdUserIds.push(staff.id);

  const providerUser = await prisma.user.create({ data: { organizationId: org.id, firstName: `${TAG}-provider` } });
  createdUserIds.push(providerUser.id);
  const provider = await prisma.providerProfile.create({
    data: {
      userId: providerUser.id,
      organizationId: org.id,
      providerType: "THERAPIST",
      slug: TAG,
      displayName: `${TAG} provider`,
      isBookable: true,
      availabilities: {
        create: {
          timezone: TZ,
          isDefault: true,
          rules: { create: [1, 2, 3, 4, 5].map((dayOfWeek) => ({ dayOfWeek, startMinute: 9 * 60, endMinute: 17 * 60 })) },
        },
      },
    },
  });
  providerId = provider.id;

  const svc = await prisma.service.create({
    data: {
      organizationId: org.id,
      name: `${TAG} session`,
      slug: `${TAG}-session`,
      durationMinutes: 60,
      bufferAfterMinutes: 15,
      price: 5000,
      discountAmount: 500,
      taxRatePercent: 5,
      minNoticeMinutes: 0,
      providers: { create: { providerId } },
    },
  });
  serviceId = svc.id;
  const prepay = await prisma.service.create({
    data: {
      organizationId: org.id,
      name: `${TAG} prepaid`,
      slug: `${TAG}-prepaid`,
      durationMinutes: 60,
      price: 3000,
      requiresPrepayment: true,
      minNoticeMinutes: 0,
      providers: { create: { providerId } },
    },
  });
  prepayServiceId = prepay.id;

  for (let i = 0; i < 12; i++) {
    const u = await prisma.user.create({ data: { organizationId: org.id, firstName: `${TAG}-customer-${i}` } });
    createdUserIds.push(u.id);
    const c = await prisma.customerProfile.create({
      data: { userId: u.id, organizationId: org.id, customerNumber: `${TAG}-${i}` },
    });
    customerIds.push(c.id);
  }
});

afterAll(async () => {
  if (!org) return;
  // Every filter below must be scoped to fixture ids (see ids() in cleanup.ts).
  if (ids(providerId)) {
    const appts = await prisma.appointment.findMany({ where: { providerId }, select: { id: true, bookingId: true } });
    const bookingIds = [...new Set(appts.map((a) => a.bookingId))];
    await prisma.auditLog.deleteMany({ where: { OR: [{ requestId: TAG }, { entityId: { in: appts.map((a) => a.id) } }] } });
    // Reschedules reference each other; clear the self-relation before deleting.
    await prisma.appointment.updateMany({ where: { providerId }, data: { rescheduledFromId: null } });
    await prisma.appointment.deleteMany({ where: { providerId } });
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
  }
  await prisma.auditLog.deleteMany({ where: { requestId: TAG } });
  await prisma.service.deleteMany({ where: { id: { in: [serviceId, prepayServiceId].filter(Boolean) } } });
  await prisma.customerProfile.deleteMany({ where: { id: { in: customerIds } } });
  if (ids(providerId)) await prisma.providerProfile.deleteMany({ where: { id: providerId } });
  await deleteTestNotifications(createdUserIds);
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });

  // Give back the APT numbers the test consumed (only if nobody else booked meanwhile).
  const year = DateTime.now().setZone(org.timezone).year;
  const key = { organizationId_prefix_year: { organizationId: org.id, prefix: "APT", year } };
  const now = await prisma.documentSequence.findUnique({ where: key });
  const realBookings = await prisma.booking.count({
    where: { organizationId: org.id, type: "APPOINTMENT", bookingNumber: { startsWith: `APT-${year}-` } },
  });
  if (now && (seqBefore ?? 0) >= realBookings) {
    if (seqBefore === null) await prisma.documentSequence.delete({ where: key });
    else await prisma.documentSequence.update({ where: key, data: { lastValue: seqBefore } });
  }
  await prisma.$disconnect();
});

describe("double-booking prevention", () => {
  it("12 concurrent bookings for the same slot: exactly one succeeds", async () => {
    const results = await Promise.all(
      customerIds.map((customerId) => errorCode(createAppointmentBooking(request({ customerId, startsAt: at("09:00") }), ctx))),
    );
    expect(results.filter((r) => r === "OK")).toHaveLength(1);
    expect(results.filter((r) => r === "SLOT_UNAVAILABLE")).toHaveLength(customerIds.length - 1);
    const stored = await prisma.appointment.count({ where: { providerId, startsAt: at("09:00"), status: "CONFIRMED" } });
    expect(stored).toBe(1);
  });

  it("concurrent overlapping (not identical) times: exactly one succeeds", async () => {
    const results = await Promise.all([
      errorCode(createAppointmentBooking(request({ customerId: customerIds[0]!, startsAt: at("13:00") }), ctx)),
      errorCode(createAppointmentBooking(request({ customerId: customerIds[1]!, startsAt: at("13:30") }), ctx)),
      errorCode(createAppointmentBooking(request({ customerId: customerIds[2]!, startsAt: at("12:45") }), ctx)),
    ]);
    expect(results.filter((r) => r === "OK")).toHaveLength(1);
  });

  it("the database constraint rejects an overlap even when application checks are bypassed", async () => {
    const existing = await prisma.appointment.findFirstOrThrow({ where: { providerId, startsAt: at("09:00") } });
    await expect(
      prisma.appointment.create({
        data: {
          ...existing,
          id: undefined,
          rescheduledFromId: null,
          formSubmissionId: null,
          startsAt: at("09:30"),
          endsAt: at("10:30"),
          blockedFrom: at("09:30"),
          blockedUntil: at("10:45"),
          createdAt: undefined,
          updatedAt: undefined,
        } as never,
      }),
    ).rejects.toSatisfy(isExclusionViolation);
  });

  it("buffer time is protected: 09:00 (+60 +15 buffer) blocks 10:00 but allows 10:15", async () => {
    expect(await errorCode(createAppointmentBooking(request({ customerId: customerIds[3]!, startsAt: at("10:00") }), ctx))).toBe(
      "SLOT_UNAVAILABLE",
    );
    expect(await errorCode(createAppointmentBooking(request({ customerId: customerIds[3]!, startsAt: at("10:15") }), ctx))).toBe("OK");
  });

  it("rejects times outside availability unless overridden", async () => {
    expect(await errorCode(createAppointmentBooking(request({ customerId: customerIds[4]!, startsAt: at("18:00") }), ctx))).toBe(
      "VALIDATION_ERROR",
    );
    expect(
      await errorCode(createAppointmentBooking(request({ customerId: customerIds[4]!, startsAt: at("18:00"), overrideAvailability: true }), ctx)),
    ).toBe("OK");
    const row = await prisma.appointment.findFirstOrThrow({ where: { providerId, startsAt: at("18:00") } });
    expect(row.availabilityOverridden).toBe(true);
  });

  it("online bookings must use an offered slot", async () => {
    const tue = DateTime.fromISO(monday).plus({ days: 1 }).toISODate()!;
    expect(
      await errorCode(createAppointmentBooking(request({ customerId: customerIds[5]!, startsAt: at("09:20", tue), online: true, source: "ONLINE" }), ctx)),
    ).toBe("VALIDATION_ERROR");
    expect(
      await errorCode(createAppointmentBooking(request({ customerId: customerIds[5]!, startsAt: at("09:00", tue), online: true, source: "ONLINE" }), ctx)),
    ).toBe("OK");
  });

  it("a customer cannot hold two appointments at the same time", async () => {
    const wed = DateTime.fromISO(monday).plus({ days: 2 }).toISODate()!;
    await createAppointmentBooking(request({ customerId: customerIds[6]!, startsAt: at("09:00", wed) }), ctx);
    // same customer, overlapping time (provider has room later, so the customer rule is what fails)
    expect(await errorCode(createAppointmentBooking(request({ customerId: customerIds[6]!, startsAt: at("09:30", wed), overrideAvailability: true }), ctx))).toBe(
      "CONFLICT",
    );
  });
});

describe("pricing, numbering and idempotency", () => {
  it("stores exact decimal totals and a human booking number", async () => {
    const thu = DateTime.fromISO(monday).plus({ days: 3 }).toISODate()!;
    const appt = await createAppointmentBooking(request({ customerId: customerIds[7]!, startsAt: at("09:00", thu) }), ctx);
    expect(appt.bookingNumber).toMatch(/^APT-\d{4}-\d{6}$/);
    // 5000 - 500 = 4500; 5% tax = 225.00; total 4725.00
    expect([appt.price, appt.discountAmount, appt.taxAmount, appt.totalAmount]).toEqual(["5000.00", "500.00", "225.00", "4725.00"]);
  });

  it("replaying the same Idempotency-Key returns the same booking", async () => {
    const thu = DateTime.fromISO(monday).plus({ days: 3 }).toISODate()!;
    const key = `${TAG}-idem`;
    const [a, b] = await Promise.all([
      createAppointmentBooking(request({ customerId: customerIds[8]!, startsAt: at("11:00", thu), idempotencyKey: key }), ctx),
      createAppointmentBooking(request({ customerId: customerIds[8]!, startsAt: at("11:00", thu), idempotencyKey: key }), ctx),
    ]);
    expect(a.id).toBe(b.id);
    expect(await prisma.booking.count({ where: { idempotencyKey: key } })).toBe(1);
  });
});

describe("holds, cancellation and rescheduling", () => {
  const fri = () => DateTime.fromISO(monday).plus({ days: 4 }).toISODate()!;

  it("an unpaid online hold blocks the slot until it lapses, then the slot is free", async () => {
    const hold = await createAppointmentBooking(
      request({ serviceId: prepayServiceId, customerId: customerIds[9]!, startsAt: at("09:00", fri()), online: true, source: "ONLINE" }),
      ctx,
    );
    expect(hold.status).toBe("PENDING");
    expect(hold.holdExpiresAt).not.toBeNull();
    expect(
      await errorCode(createAppointmentBooking(request({ customerId: customerIds[10]!, startsAt: at("09:00", fri()) }), ctx)),
    ).toBe("SLOT_UNAVAILABLE");

    await prisma.appointment.update({ where: { id: hold.id }, data: { holdExpiresAt: new Date(Date.now() - 60_000) } });
    expect(await errorCode(createAppointmentBooking(request({ customerId: customerIds[10]!, startsAt: at("09:00", fri()) }), ctx))).toBe("OK");
    const expired = await prisma.appointment.findUniqueOrThrow({ where: { id: hold.id }, include: { booking: true } });
    expect(expired.status).toBe("EXPIRED");
    expect(expired.booking.status).toBe("EXPIRED");
  });

  it("cancelling frees the slot for someone else", async () => {
    const appt = await createAppointmentBooking(request({ customerId: customerIds[11]!, startsAt: at("14:00", fri()) }), ctx);
    await cancelAppointment(staffPrincipal(), appt.id, { reason: "Customer request" }, ctx);
    expect(await errorCode(createAppointmentBooking(request({ customerId: customerIds[0]!, startsAt: at("14:00", fri()) }), ctx))).toBe("OK");
  });

  it("rescheduling can move into time overlapping its own old slot, and keeps the booking number", async () => {
    const appt = await createAppointmentBooking(request({ customerId: customerIds[1]!, startsAt: at("11:00", fri()) }), ctx);
    const moved = await rescheduleAppointment(staffPrincipal(), appt.id, { startsAt: at("11:30", fri()).toISOString(), overrideAvailability: false }, ctx);
    expect(moved.bookingNumber).toBe(appt.bookingNumber);
    expect(moved.rescheduledFromId).toBe(appt.id);
    const old = await prisma.appointment.findUniqueOrThrow({ where: { id: appt.id } });
    expect(old.status).toBe("RESCHEDULED");
  });

  it("a failed reschedule leaves the original appointment untouched", async () => {
    const appt = await createAppointmentBooking(request({ customerId: customerIds[2]!, startsAt: at("16:00", fri()) }), ctx);
    // 14:00 on Friday is taken (see the cancellation test)
    expect(
      await errorCode(rescheduleAppointment(staffPrincipal(), appt.id, { startsAt: at("14:00", fri()).toISOString(), overrideAvailability: false }, ctx)),
    ).toBe("SLOT_UNAVAILABLE");
    const still = await prisma.appointment.findUniqueOrThrow({ where: { id: appt.id } });
    expect(still.status).toBe("CONFIRMED");
  });
});
