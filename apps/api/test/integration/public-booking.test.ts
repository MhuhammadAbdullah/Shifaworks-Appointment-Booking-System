/**
 * Phase 4 against real PostgreSQL: the unauthenticated /public/* endpoints
 * and the booking engine they call — service bootstrap, backend-only gender
 * filtering, slot search, a full submission (customer/booking/appointment/
 * payment created together), idempotent retries, gender-mismatch and
 * inactive-option rejections, and — the one that matters most — concurrent
 * submissions for the same slot resolving to exactly one winner via the
 * database exclusion constraint.
 *
 * Deliberately does not toggle isActive/bookingEnabled on the shared demo
 * services (dev servers run against this same database); every mutated row
 * is a fixture tagged with TAG.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import request from "supertest";
import { ALL_PERMISSIONS, type PermissionKey } from "@booking/shared";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/lib/prisma.js";
import { AppError } from "../../src/utils/app-error.js";
import type { Principal } from "../../src/modules/auth/principal.service.js";
import { createProvider } from "../../src/modules/providers/providers.service.js";
import { createPackage } from "../../src/modules/services/services.service.js";
import { setWeeklySchedule } from "../../src/modules/availability/availability.service.js";
import {
  getServiceBootstrap,
  listPublicProviders,
  publicAvailableDates,
  publicSlots,
  submitPublicBooking,
  uploadPublicReceipt,
} from "../../src/modules/public/public.service.js";
import { ids } from "./cleanup.js";

// A 1x1 PNG — small enough to be a fast fixture, real enough to pass magic-byte sniffing.
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

const TAG = `itest-${randomUUID().slice(0, 8)}`;
const TZ = "Asia/Karachi";
const ctx = { organizationId: null, userId: null, ipAddress: null, userAgent: "integration-test", requestId: TAG };

let org: { id: string; name: string; slug: string; timezone: string; currency: string; logoUrl: string | null };
let actorId: string;
let hijamaServiceId: string;
let providerId: string; // 60-min duration, accepts male only, Mon 09:00-17:00
let packageId: string; // 60-min, price 1000
let inactiveProviderId: string;
let inactivePackageId: string;
const createdUserIds: string[] = [];
const createdProviderIds: string[] = [];
const createdPackageIds: string[] = [];
const createdBookingIds: string[] = [];
const createdFileIds: string[] = [];

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
    avatarUrl: null,
  };
}
const admin = () => principal(ALL_PERMISSIONS.filter((p) => p !== "roles.manage"));

/** The public response only carries bookingNumber (the customer-facing reference); look up the id for cleanup/assertions. */
async function idFor(bookingNumber: string): Promise<string> {
  return (await prisma.booking.findUniqueOrThrow({ where: { bookingNumber }, select: { id: true } })).id;
}

async function errorOf(p: Promise<unknown>): Promise<AppError> {
  try {
    await p;
    throw new Error("expected a rejection");
  } catch (err) {
    if (err instanceof AppError) return err;
    throw err;
  }
}

/** A Monday at least a week ahead, safely clear of minimum-notice windows. */
const monday = DateTime.now().setZone(TZ).plus({ weeks: 3 }).startOf("week").toISODate()!;
const at = (time: string) => DateTime.fromISO(`${monday}T${time}`, { zone: TZ }).toISO()!;

// hijama-therapy is seeded with a 15-minute buffer after each session (see
// prisma/seed.ts SERVICE_TIMING); with the fixture package's 60-minute
// duration the offered grid within 09:00-17:00 is exactly 09:00, 10:15,
// 11:30, 12:45, 14:00, 15:15 (duration + bufferAfter = 75-minute step).

const body = (over: Partial<Record<string, unknown>> = {}) => ({
  service: "hijama-therapy",
  providerId,
  packageId,
  startsAt: at("09:00"),
  personal: {
    firstName: "Fatima",
    lastName: TAG,
    phone: "+923001234567",
    email: `${TAG}@example.test`,
    gender: "MALE",
  },
  location: { city: "Karachi", address: "House 1, Street 2" },
  details: {},
  termsAccepted: true,
  website: "",
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

  providerId = (
    await createProvider(
      admin(),
      { providerType: "THERAPIST", displayName: `${TAG} Provider`, gender: "MALE", acceptsMale: true, acceptsFemale: false, serviceIds: [hijamaServiceId] },
      ctx,
    )
  ).id;
  createdProviderIds.push(providerId);
  await setWeeklySchedule(admin(), providerId, { timezone: TZ, days: [{ dayOfWeek: 1, intervals: [{ start: "09:00", end: "17:00" }] }] }, ctx);
  packageId = (await createPackage(admin(), hijamaServiceId, { name: `${TAG} Package`, price: 1000, durationMinutes: 60 }, ctx)).id;
  createdPackageIds.push(packageId);

  inactiveProviderId = (
    await createProvider(
      admin(),
      { providerType: "THERAPIST", displayName: `${TAG} Inactive`, gender: "MALE", acceptsMale: true, acceptsFemale: false, isActive: false, serviceIds: [hijamaServiceId] },
      ctx,
    )
  ).id;
  createdProviderIds.push(inactiveProviderId);
  inactivePackageId = (await createPackage(admin(), hijamaServiceId, { name: `${TAG} Hidden`, price: 500, isActive: false }, ctx)).id;
  createdPackageIds.push(inactivePackageId);
});

afterAll(async () => {
  if (createdBookingIds.length) {
    await prisma.payment.deleteMany({ where: { bookingId: { in: createdBookingIds } } });
    await prisma.appointment.deleteMany({ where: { bookingId: { in: createdBookingIds } } });
    await prisma.booking.deleteMany({ where: { id: { in: createdBookingIds } } });
  }
  await prisma.customer.deleteMany({ where: { email: { endsWith: `${TAG}@example.test` } } });
  if (createdFileIds.length) await prisma.file.deleteMany({ where: { id: { in: createdFileIds } } });
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

describe("service bootstrap and provider directory", () => {
  it("returns the open flag, packages and support contacts; never another service", async () => {
    const dto = await getServiceBootstrap("hijama-therapy");
    expect(dto.slug).toBe("hijama-therapy");
    expect(dto.open).toBe(true);
    expect(dto.packages.some((p) => p.id === packageId)).toBe(true);
    expect(dto.packages.some((p) => p.id === inactivePackageId)).toBe(false);
  });

  it("404s for an unknown slug", async () => {
    const err = await errorOf(getServiceBootstrap("not-a-real-service"));
    expect(err.code).toBe("NOT_FOUND");
  });

  it("filters providers by gender on the backend, and hides inactive ones", async () => {
    const forMale = await listPublicProviders("hijama-therapy", "MALE");
    const forFemale = await listPublicProviders("hijama-therapy", "FEMALE");
    expect(forMale.some((p) => p.id === providerId)).toBe(true);
    expect(forFemale.some((p) => p.id === providerId)).toBe(false);
    expect(forMale.some((p) => p.id === inactiveProviderId)).toBe(false);
    // Public cards never carry contact details.
    expect(forMale[0]).not.toHaveProperty("email");
    expect(forMale[0]).not.toHaveProperty("phone");
  });
});

describe("slot search (same engine as the staff preview)", () => {
  it("offers the Monday and the 09:00 start", async () => {
    const dates = await publicAvailableDates({ service: "hijama-therapy", provider: providerId, package: packageId, from: monday, to: monday });
    expect(dates.dates).toEqual([monday]);
    const slots = await publicSlots({ service: "hijama-therapy", provider: providerId, package: packageId, date: monday });
    expect(slots.slots.map((s) => s.time)).toContain("09:00");
  });
});

describe("submitting a booking", () => {
  it("creates the customer, booking, appointment and a pending payment", async () => {
    const result = await submitPublicBooking(body(), null);
    const bookingId = await idFor(result.bookingNumber);
    createdBookingIds.push(bookingId);
    expect(result.bookingNumber).toMatch(/^APT-\d{4}-\d{6}$/);
    expect(result.status).toBe("PENDING_PAYMENT");
    expect(result.paymentStatus).toBe("PENDING");
    expect(result.amount).toBe("1000.00");
    expect(result.appointment.time).toBe("09:00");

    const appointment = await prisma.appointment.findFirstOrThrow({ where: { bookingId } });
    expect(appointment.providerId).toBe(providerId);
    expect(appointment.status).toBe("PENDING_PAYMENT");
    const payment = await prisma.payment.findFirstOrThrow({ where: { bookingId } });
    expect(payment.status).toBe("PENDING");
    expect(payment.amount.toString()).toBe("1000");
    const customer = await prisma.customer.findFirstOrThrow({ where: { email: `${TAG}@example.test` } });
    expect(customer.customerNumber).toMatch(/^CUS-\d{4}-\d{6}$/);
  });

  it("matches the same customer by email on a second booking", async () => {
    const first = await prisma.customer.findFirstOrThrow({ where: { email: `${TAG}@example.test` } });
    const result = await submitPublicBooking(body({ startsAt: at("10:15") }), null);
    const bookingId = await idFor(result.bookingNumber);
    createdBookingIds.push(bookingId);
    const appointment = await prisma.appointment.findFirstOrThrow({ where: { bookingId } });
    expect(appointment.customerId).toBe(first.id);
  });

  it("replays an identical Idempotency-Key instead of double-booking", async () => {
    const key = `${TAG}-idem`;
    const first = await submitPublicBooking(body({ startsAt: at("12:45") }), key);
    const bookingId = await idFor(first.bookingNumber);
    createdBookingIds.push(bookingId);
    const second = await submitPublicBooking(body({ startsAt: at("12:45") }), key);
    expect(second.bookingNumber).toBe(first.bookingNumber);
    expect(await prisma.appointment.count({ where: { bookingId } })).toBe(1);
  });

  it("refuses a provider that does not accept the customer's gender", async () => {
    const err = await errorOf(submitPublicBooking(body({ startsAt: at("15:00"), personal: { ...body().personal, gender: "FEMALE" } }), null));
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.errors?.[0]?.path).toBe("providerId");
  });

  it("refuses an inactive provider and an inactive package", async () => {
    expect((await errorOf(submitPublicBooking(body({ providerId: inactiveProviderId, startsAt: at("15:00") }), null))).code).toBe("VALIDATION_ERROR");
    expect((await errorOf(submitPublicBooking(body({ packageId: inactivePackageId, startsAt: at("15:00") }), null))).code).toBe("VALIDATION_ERROR");
  });

  it("refuses a time outside the provider's working hours", async () => {
    const err = await errorOf(submitPublicBooking(body({ startsAt: at("07:00") }), null));
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.errors?.[0]?.path).toBe("startsAt");
  });

  it("rejects a filled honeypot field", async () => {
    const err = await errorOf(submitPublicBooking(body({ startsAt: at("16:00"), website: "http://spam.example" }), null));
    expect(err.code).toBe("VALIDATION_ERROR");
  });

  it("lets exactly one of two concurrent submissions for the same slot win", async () => {
    const startsAt = at("11:30");
    const results = await Promise.allSettled([
      submitPublicBooking(body({ startsAt, personal: { ...body().personal, email: `race-a-${TAG}@example.test` } }), null),
      submitPublicBooking(body({ startsAt, personal: { ...body().personal, email: `race-b-${TAG}@example.test` } }), null),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<Awaited<ReturnType<typeof submitPublicBooking>>>[];
    const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    createdBookingIds.push(await idFor(fulfilled[0]!.value.bookingNumber));
    expect(rejected[0]!.reason).toBeInstanceOf(AppError);
    expect((rejected[0]!.reason as AppError).code).toBe("SLOT_UNAVAILABLE");

    const overlapping = await prisma.appointment.count({
      where: { providerId, status: "PENDING_PAYMENT", startsAt: new Date(startsAt) },
    });
    expect(overlapping).toBe(1);
  });
});

// The Monday grid above is fully claimed by the tests before this point (6 offered
// slots, 5 consumed by successful bookings, 1 left) — these two blocks get their own
// Tuesday-scheduled provider so they don't have to fight over what's left of it.
describe("package discounts and receipt uploads (own provider/day, see note above)", () => {
  let tuesdayProviderId: string;
  const tuesday = DateTime.fromISO(monday, { zone: TZ }).plus({ days: 1 }).toISODate()!;
  const atTue = (time: string) => DateTime.fromISO(`${tuesday}T${time}`, { zone: TZ }).toISO()!;

  beforeAll(async () => {
    tuesdayProviderId = (
      await createProvider(
        admin(),
        { providerType: "THERAPIST", displayName: `${TAG} Tuesday`, gender: "MALE", acceptsMale: true, acceptsFemale: false, serviceIds: [hijamaServiceId] },
        ctx,
      )
    ).id;
    createdProviderIds.push(tuesdayProviderId);
    await setWeeklySchedule(admin(), tuesdayProviderId, { timezone: TZ, days: [{ dayOfWeek: 2, intervals: [{ start: "09:00", end: "17:00" }] }] }, ctx);
  });

  it("charges the discounted amount and records both the gross price and the discount", async () => {
    const discounted = await createPackage(admin(), hijamaServiceId, { name: `${TAG} 20% off`, price: 1000, discountEnabled: true, discountPercent: 20 }, ctx);
    createdPackageIds.push(discounted.id);

    const result = await submitPublicBooking(body({ providerId: tuesdayProviderId, packageId: discounted.id, startsAt: atTue("09:00") }), null);
    const bookingId = await idFor(result.bookingNumber);
    createdBookingIds.push(bookingId);
    expect(result.amount).toBe("800.00"); // 1000 - 20%

    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(booking.subtotal.toFixed(2)).toBe("1000.00");
    expect(booking.discountAmount.toFixed(2)).toBe("200.00");
    expect(booking.totalAmount.toFixed(2)).toBe("800.00");
    const payment = await prisma.payment.findFirstOrThrow({ where: { bookingId } });
    expect(payment.amount.toFixed(2)).toBe("800.00");
  });

  it("shows the discounted price, original price and percentage on the public service bootstrap", async () => {
    const discounted = await createPackage(admin(), hijamaServiceId, { name: `${TAG} bootstrap 15% off`, price: 2000, discountEnabled: true, discountPercent: 15 }, ctx);
    createdPackageIds.push(discounted.id);
    const dto = await getServiceBootstrap("hijama-therapy");
    const pkg = dto.packages.find((p) => p.id === discounted.id);
    expect(pkg).toMatchObject({ price: "1700.00", originalPrice: "2000.00", discountPercent: 15 });
  });

  it("uploads a receipt, then skips straight to PAYMENT_SUBMITTED and attaches it as the payment's proof", async () => {
    const receipt = await uploadPublicReceipt({ buffer: PNG_BYTES, originalname: "receipt.png", size: PNG_BYTES.length }, { ipAddress: null, userAgent: "integration-test", requestId: TAG });
    createdFileIds.push(receipt.id);

    const result = await submitPublicBooking(body({ providerId: tuesdayProviderId, startsAt: atTue("10:15"), receiptFileId: receipt.id }), null);
    const bookingId = await idFor(result.bookingNumber);
    createdBookingIds.push(bookingId);
    expect(result.status).toBe("PAYMENT_SUBMITTED");
    expect(result.paymentStatus).toBe("PENDING"); // staff still verifies it — only the "proof arrived" step is skipped

    const appointment = await prisma.appointment.findFirstOrThrow({ where: { bookingId } });
    expect(appointment.status).toBe("PAYMENT_SUBMITTED");
    const payment = await prisma.payment.findFirstOrThrow({ where: { bookingId } });
    expect(payment.proofFileId).toBe(receipt.id);
    expect(payment.submittedAt).not.toBeNull();
  });

  it("rejects a receiptFileId that doesn't exist", async () => {
    const err = await errorOf(submitPublicBooking(body({ providerId: tuesdayProviderId, startsAt: atTue("11:30"), receiptFileId: randomUUID() }), null));
    expect(err.code).toBe("VALIDATION_ERROR");
  });
});

// Everything above calls the service layer directly. This block goes through
// the real Express app (routes â†’ middleware â†’ controller â†’ service) at least
// once per endpoint, so a wiring mistake — e.g. a route param the controller
// reads via `validated()` without a `validate()` middleware to populate it —
// fails here even when the service function underneath is perfectly correct.
describe("HTTP wiring", () => {
  const app = createApp();

  it("GET /public/services/:slug", async () => {
    const res = await request(app).get("/api/v1/public/services/hijama-therapy");
    expect(res.status).toBe(200);
    expect(res.body.data.slug).toBe("hijama-therapy");
    expect(res.body.data.support).toEqual(expect.objectContaining({ email: expect.any(String) }));
  });

  it("GET /public/services/:slug for an unknown slug is a 404, not a crash", async () => {
    const res = await request(app).get("/api/v1/public/services/not-a-real-service");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });

  it("GET /public/providers validates the query", async () => {
    const ok = await request(app).get("/api/v1/public/providers").query({ service: "hijama-therapy", gender: "MALE" });
    expect(ok.status).toBe(200);
    expect(Array.isArray(ok.body.data)).toBe(true);

    const bad = await request(app).get("/api/v1/public/providers").query({ service: "not-a-real-service" });
    expect(bad.status).toBe(422);
  });

  it("POST /public/bookings end to end, honouring Idempotency-Key", async () => {
    const payload = body({ startsAt: at("14:00") });
    const key = `${TAG}-http`;
    const res = await request(app).post("/api/v1/public/bookings").set("Idempotency-Key", key).send(payload);
    expect(res.status).toBe(201);
    expect(res.body.data.bookingNumber).toMatch(/^APT-\d{4}-\d{6}$/);
    createdBookingIds.push(await idFor(res.body.data.bookingNumber));

    const replay = await request(app).post("/api/v1/public/bookings").set("Idempotency-Key", key).send(payload);
    expect(replay.status).toBe(201);
    expect(replay.body.data.bookingNumber).toBe(res.body.data.bookingNumber);
  });

  it("POST /public/bookings rejects a filled honeypot with a normal-looking validation error", async () => {
    const res = await request(app)
      .post("/api/v1/public/bookings")
      .send(body({ startsAt: at("14:00"), website: "http://spam.example" }));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });
});
