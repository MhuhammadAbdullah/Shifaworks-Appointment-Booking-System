/**
 * Phase 9 against real PostgreSQL: operational reports built on Appointment
 * rows. The providers report is scoped by a fresh providerId, so its counts
 * are exact and immune to whatever other concurrently-running test files book
 * against the shared hijama-therapy service; the bookings/services reports
 * are organisation-wide, so only loose/structural assertions are made there.
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
import { cancelBooking, completeBooking, createManualBooking, markNoShow } from "../../src/modules/appointments/bookings.service.js";
import { exportReportCsv, getReport } from "../../src/modules/reports/reports.service.js";
import { ids } from "./cleanup.js";

const TAG = `itest-${randomUUID().slice(0, 8)}`;
const TZ = "Asia/Karachi";
const WEEK = 7; // within the service's maxAdvanceDays (60); exact isolation from other files'
// `4 + n` week fixtures isn't guaranteed here, so only the providers report (scoped by this
// file's own fresh providerId) gets exact-count assertions below — see the note at that block.
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

const weekMonday = (n: number) => DateTime.now().setZone(TZ).plus({ weeks: n }).startOf("week").toISODate()!;
const at = (time: string) => DateTime.fromISO(`${weekMonday(WEEK)}T${time}`, { zone: TZ }).toISO()!;

const body = (startsAt: string) => ({
  service: "hijama-therapy" as const,
  providerId,
  packageId,
  startsAt,
  personal: { firstName: "Ahmed", lastName: TAG, phone: "+923001234567", email: `${TAG}@example.test`, gender: "MALE" as const },
  location: { city: "Karachi", address: "House 1" },
  source: "PHONE" as const,
  overrideAvailability: false,
  markPaid: true,
  paymentMethod: "CASH" as const,
});

/** Moves a confirmed appointment into the true past so complete/no-show accept it. */
async function shiftIntoPast(bookingId: string, hoursAgo: number) {
  const start = new Date(Date.now() - hoursAgo * 3_600_000);
  const end = new Date(start.getTime() + 3_600_000);
  await prisma.appointment.updateMany({ where: { bookingId }, data: { startsAt: start, endsAt: end, blockedFrom: start, blockedUntil: end } });
}

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

describe("reports", () => {
  it("builds a consistent set of appointments across every status", async () => {
    // 2-hour spacing: the 60-minute package plus the service's 15-minute buffer-after
    // blocks 75 minutes, so anything tighter than 2 hours would collide.
    const a = await createManualBooking(admin(), body(at("09:00")), ctx); // stays CONFIRMED, far future
    const b = await createManualBooking(admin(), body(at("11:00")), ctx); // -> CANCELLED, far future
    const c = await createManualBooking(admin(), body(at("13:00")), ctx); // -> COMPLETED, shifted to the past
    const d = await createManualBooking(admin(), body(at("15:00")), ctx); // -> NO_SHOW, shifted to the past

    await cancelBooking(admin(), b.id, { reason: `${TAG} cancelled` }, ctx);
    await shiftIntoPast(c.id, 1);
    await completeBooking(admin(), c.id, ctx);
    await shiftIntoPast(d.id, 2);
    await markNoShow(admin(), d.id, ctx);

    // Wide enough to contain both the far-future (A, B) and the shifted-past (C, D) rows.
    const wide = {
      from: DateTime.now().setZone(TZ).minus({ days: 1 }).toISODate()!,
      to: DateTime.fromISO(weekMonday(WEEK)).plus({ days: 1 }).toISODate()!,
      dateField: "startsAt" as const,
    };

    const providers = await getReport(admin(), "providers", wide);
    const row = providers.rows.find((r) => r.providerId === providerId);
    expect(row).toBeDefined();
    expect(row).toMatchObject({ total: 4, completed: 1, cancelled: 1, noShow: 1 });
    expect(row?.revenue).toBe("2000.00"); // CONFIRMED (a) + COMPLETED (c), 1000 each — CANCELLED/NO_SHOW excluded

    // services/bookings are organisation-wide (not scoped to our fixtures the way the
    // providers report is), so only loose "at least our contribution" assertions here.
    const services = await getReport(admin(), "services", wide);
    const serviceRow = services.rows.find((r) => r.serviceId === hijamaServiceId);
    expect(serviceRow).toBeDefined();
    expect(serviceRow!.total).toBeGreaterThanOrEqual(4);

    const bookings = await getReport(admin(), "bookings", wide);
    expect(bookings.total).toBeGreaterThanOrEqual(4);
    expect(bookings.cancelledCount).toBeGreaterThanOrEqual(1);
    expect(bookings.completedCount).toBeGreaterThanOrEqual(1);
    expect(bookings.noShowCount).toBeGreaterThanOrEqual(1);
    const days = DateTime.fromISO(wide.to).diff(DateTime.fromISO(wide.from), "days").days + 1;
    expect(bookings.daily).toHaveLength(days);

    const csv = await exportReportCsv(admin(), "providers", wide);
    expect(csv).toContain(`${TAG} Provider`);
    expect(csv.split("\r\n")[0]).toContain("Provider");
  });

  it("needs reports.view to view and reports.export to export", async () => {
    const range = { from: weekMonday(WEEK), to: weekMonday(WEEK), dateField: "startsAt" as const };
    const viewErr = await errorOf(getReport(principal([]), "bookings", range));
    expect(viewErr.code).toBe("FORBIDDEN");
    const exportErr = await errorOf(exportReportCsv(principal(["reports.view"]), "bookings", range));
    expect(exportErr.code).toBe("FORBIDDEN");
  });
});
