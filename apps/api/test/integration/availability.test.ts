/**
 * Phase 3 against real PostgreSQL: backend slot computation from stored
 * availability (weekly hours with a break, service buffers, package
 * duration, leave, custom hours, blocked time, clinic holidays), gender
 * filtering, provider ownership rules, service/provider type matching,
 * packages, and linking an existing account as a provider login.
 * Every fixture carries TAG and is removed by id afterwards.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { ALL_PERMISSIONS, minutesToHhmm, type PermissionKey } from "@booking/shared";
import { prisma } from "../../src/lib/prisma.js";
import { AppError } from "../../src/utils/app-error.js";
import type { Principal } from "../../src/modules/auth/principal.service.js";
import {
  availableDates,
  createBlockedSlot,
  createException,
  createHoliday,
  deleteHoliday,
  getAvailability,
  setWeeklySchedule,
  slotsForDate,
} from "../../src/modules/availability/availability.service.js";
import { createProvider, inviteProvider, listProviders, setProviderServices } from "../../src/modules/providers/providers.service.js";
import { createPackage, deletePackage, updatePackage } from "../../src/modules/services/services.service.js";
import { ids } from "./cleanup.js";

const TAG = `itest-${randomUUID().slice(0, 8)}`;
const TZ = "Asia/Karachi";
const ctx = { organizationId: null, userId: null, ipAddress: null, userAgent: "integration-test", requestId: TAG };

let org: { id: string; name: string; slug: string; timezone: string; currency: string; logoUrl: string | null };
let actorId: string;
let hijama: { id: string; bufferBeforeMinutes: number; bufferAfterMinutes: number; slotIntervalMinutes: number | null };
let counselingId: string;
let maleOnlyId: string;
let femaleOnlyId: string;
let packageId: string;
const createdUserIds: string[] = [];
const createdHolidayIds: string[] = [];

/** A Monday at least two weeks ahead, and the Wednesday after it. */
const monday = DateTime.now().setZone(TZ).plus({ weeks: 2 }).startOf("week").toISODate()!;
const tuesday = DateTime.fromISO(monday).plus({ days: 1 }).toISODate()!;
const wednesday = DateTime.fromISO(monday).plus({ days: 2 }).toISODate()!;

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
const orgRef = () => ({ id: org.id, timezone: org.timezone });

async function errorCode(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "OK";
  } catch (err) {
    if (err instanceof AppError) return err.code;
    throw err;
  }
}

/** Expected starts in [startMin, endMin) for 60-minute sessions with this service's timing. */
function expectedTimes(startMin: number, endMin: number, duration = 60) {
  const step = Math.max(5, hijama.slotIntervalMinutes ?? duration + hijama.bufferAfterMinutes);
  const out: string[] = [];
  for (let s = startMin; s + duration <= endMin; s += step) out.push(minutesToHhmm(s));
  return out;
}

const times = async (date: string, providerId = maleOnlyId, pkg?: string) =>
  (await slotsForDate(orgRef(), { serviceId: hijama.id, providerId, date, ...(pkg ? { packageId: pkg } : {}) }, { online: false })).slots.map(
    (s) => s.time,
  );

beforeAll(async () => {
  const o = await prisma.organization.findUniqueOrThrow({ where: { slug: process.env.DEFAULT_ORGANIZATION_SLUG ?? "default" } });
  org = { id: o.id, name: o.name, slug: o.slug, timezone: o.timezone, currency: o.currency, logoUrl: null };
  const actor = await prisma.user.create({
    data: { organizationId: org.id, authUserId: randomUUID(), email: `${TAG}-actor@example.test`, firstName: TAG },
  });
  actorId = actor.id;
  createdUserIds.push(actor.id);

  const h = await prisma.service.findFirstOrThrow({ where: { organizationId: org.id, slug: "hijama-therapy" } });
  hijama = h;
  counselingId = (await prisma.service.findFirstOrThrow({ where: { organizationId: org.id, slug: "clinical-counseling" } })).id;

  const base = { providerType: "THERAPIST" as const, experienceYears: 3, serviceIds: [hijama.id] };
  maleOnlyId = (
    await createProvider(admin(), { ...base, displayName: `${TAG} Male`, gender: "MALE", acceptsMale: true, acceptsFemale: false }, ctx)
  ).id;
  femaleOnlyId = (
    await createProvider(admin(), { ...base, displayName: `${TAG} Female`, gender: "FEMALE", acceptsMale: false, acceptsFemale: true }, ctx)
  ).id;

  // Mon 09-13 + 14-18 (break 13-14), Tue off, Wed 10-16.
  for (const id of [maleOnlyId, femaleOnlyId]) {
    await setWeeklySchedule(
      admin(),
      id,
      {
        timezone: TZ,
        days: [
          { dayOfWeek: 1, intervals: [{ start: "09:00", end: "13:00" }, { start: "14:00", end: "18:00" }] },
          { dayOfWeek: 3, intervals: [{ start: "10:00", end: "16:00" }] },
        ],
      },
      ctx,
    );
  }
  packageId = (await createPackage(admin(), hijama.id, { name: `${TAG} 30 min`, price: 1000, durationMinutes: 30, isActive: false }, ctx)).id;
});

afterAll(async () => {
  const providerIds = [maleOnlyId, femaleOnlyId].filter((x): x is string => ids(x));
  if (providerIds.length) {
    await prisma.blockedSlot.deleteMany({ where: { providerId: { in: providerIds } } });
    await prisma.availabilityException.deleteMany({ where: { providerId: { in: providerIds } } });
    await prisma.availability.deleteMany({ where: { providerId: { in: providerIds } } });
    await prisma.serviceProvider.deleteMany({ where: { providerId: { in: providerIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: { in: providerIds } } });
  }
  if (ids(packageId)) await prisma.servicePackage.deleteMany({ where: { id: packageId } });
  await prisma.servicePackage.deleteMany({ where: { name: { startsWith: TAG } } });
  if (createdHolidayIds.length) await prisma.holiday.deleteMany({ where: { id: { in: createdHolidayIds } } });
  if (createdUserIds.length) {
    await prisma.userRole.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  if (ids(TAG)) await prisma.auditLog.deleteMany({ where: { requestId: TAG } });
  await prisma.$disconnect();
});

describe("slots from stored availability", () => {
  it("weekly hours with a break, using the service's buffers", async () => {
    expect(await times(monday)).toEqual([...expectedTimes(9 * 60, 13 * 60), ...expectedTimes(14 * 60, 18 * 60)]);
    expect(await times(tuesday)).toEqual([]);
    expect(await times(wednesday)).toEqual(expectedTimes(10 * 60, 16 * 60));
  });

  it("the package sets the duration", async () => {
    const d = await slotsForDate(orgRef(), { serviceId: hijama.id, providerId: maleOnlyId, date: wednesday, packageId }, { online: false });
    expect(d.durationMinutes).toBe(30);
    expect(d.slots.map((s) => s.time)).toEqual(expectedTimes(10 * 60, 16 * 60, 30));
  });

  it("available dates only include days with free slots", async () => {
    const res = await availableDates(orgRef(), { serviceId: hijama.id, providerId: maleOnlyId, from: monday, to: wednesday }, { online: false });
    expect(res.timezone).toBe(TZ);
    expect(res.dates).toEqual([monday, wednesday]);
  });

  it("leave closes the dates; custom hours replace the weekly hours", async () => {
    await createException(admin(), femaleOnlyId, { type: "LEAVE", startDate: monday, endDate: monday, reason: TAG }, ctx);
    await createException(
      admin(),
      femaleOnlyId,
      { type: "CUSTOM_HOURS", startDate: tuesday, endDate: tuesday, intervals: [{ start: "15:00", end: "17:00" }] },
      ctx,
    );
    expect(await times(monday, femaleOnlyId)).toEqual([]);
    expect(await times(tuesday, femaleOnlyId)).toEqual(expectedTimes(15 * 60, 17 * 60));
    const av = await getAvailability(admin(), femaleOnlyId);
    expect(av.exceptions.map((e) => e.type).sort()).toEqual(["CUSTOM_HOURS", "LEAVE"]);
  });

  it("blocked time removes the slots it overlaps (including buffers)", async () => {
    const at = (t: string) => DateTime.fromISO(`${wednesday}T${t}`, { zone: TZ }).toISO()!;
    await createBlockedSlot(admin(), maleOnlyId, { startsAt: at("10:00"), endsAt: at("12:00"), reason: TAG }, ctx);
    const after = await times(wednesday);
    expect(after.every((t) => t >= "12:00")).toBe(true);
    expect(after.length).toBeGreaterThan(0);
  });

  it("a clinic holiday closes the day for everyone", async () => {
    const list = await createHoliday(admin(), { name: `${TAG} holiday`, date: monday, isRecurring: false }, ctx);
    const holiday = list.find((x) => x.name === `${TAG} holiday`)!;
    createdHolidayIds.push(holiday.id);
    expect(await times(monday)).toEqual([]);
    await deleteHoliday(admin(), holiday.id, ctx);
    expect((await times(monday)).length).toBeGreaterThan(0);
  });

  it("online rules: hidden packages and unassigned providers are refused", async () => {
    const q = { serviceId: hijama.id, providerId: maleOnlyId, date: wednesday };
    expect(await errorCode(slotsForDate(orgRef(), { ...q, packageId }, { online: true }))).toBe("VALIDATION_ERROR");
    expect(await errorCode(slotsForDate(orgRef(), { ...q, serviceId: counselingId }, { online: false }))).toBe("VALIDATION_ERROR");
  });
});

describe("providers", () => {
  it("gender filtering happens on the backend", async () => {
    const male = await listProviders(admin(), { page: 1, pageSize: 50, search: TAG, gender: "MALE", serviceId: hijama.id });
    const female = await listProviders(admin(), { page: 1, pageSize: 50, search: TAG, gender: "FEMALE", serviceId: hijama.id });
    expect(male.items.map((p) => p.id)).toEqual([maleOnlyId]);
    expect(female.items.map((p) => p.id)).toEqual([femaleOnlyId]);
  });

  it("a therapist cannot be assigned to a counselling service", async () => {
    expect(await errorCode(setProviderServices(admin(), maleOnlyId, [hijama.id, counselingId], ctx))).toBe("VALIDATION_ERROR");
  });

  it("providers manage only their own availability", async () => {
    const own = principal(["availability.view", "availability.manage_own"], { staffProfileId: null, providerProfileId: maleOnlyId });
    expect((await getAvailability(own, maleOnlyId)).providerId).toBe(maleOnlyId);
    expect(await errorCode(getAvailability(own, femaleOnlyId))).toBe("FORBIDDEN");
    expect(
      await errorCode(setWeeklySchedule(own, femaleOnlyId, { timezone: TZ, days: [] }, ctx)),
    ).toBe("FORBIDDEN");
  });

  it("links an existing staff account as the provider's login (adds the role, no email)", async () => {
    const staff = await prisma.user.create({
      data: { organizationId: org.id, authUserId: randomUUID(), email: `${TAG}-staff@example.test`, firstName: TAG },
    });
    createdUserIds.push(staff.id);
    const linked = await inviteProvider(admin(), maleOnlyId, { email: staff.email! }, ctx);
    expect(linked.account?.userId).toBe(staff.id);
    const roles = await prisma.userRole.findMany({ where: { userId: staff.id }, select: { role: { select: { key: true } } } });
    expect(roles.map((r) => r.role.key)).toEqual(["THERAPIST"]);
    await prisma.providerProfile.update({ where: { id: maleOnlyId }, data: { userId: null } });
  });
});

describe("packages", () => {
  it("creates, reprices and deletes an unbooked package", async () => {
    const p = await createPackage(admin(), "hijama-therapy", { name: `${TAG} Test`, price: 2500, points: 12 }, ctx);
    expect(p.effectiveDurationMinutes).toBeGreaterThan(0);
    const updated = await updatePackage(admin(), "hijama-therapy", p.id, { price: 3000 }, ctx);
    expect(updated.price).toBe("3000.00");
    const audit = await prisma.auditLog.findFirst({ where: { requestId: TAG, entityId: p.id, action: "package.price.update" } });
    expect(audit).not.toBeNull();
    await deletePackage(admin(), "hijama-therapy", p.id, ctx);
    expect(await prisma.servicePackage.count({ where: { id: p.id } })).toBe(0);
  });
});
