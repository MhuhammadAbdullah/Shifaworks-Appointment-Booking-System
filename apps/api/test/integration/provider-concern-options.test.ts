/**
 * "Areas of concern" belongs to each provider: the admin manages a provider's own list, the public
 * provider cards carry only that provider's active options, and a booking may only pick codes the
 * chosen provider offers ("Other" is always allowed).
 *
 * Runs against a real PostgreSQL database. Use an isolated one (DATABASE_URL override) - never production.
 * Every row is a fixture tagged with TAG.
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
import { createConcernOption, createProvider, deleteConcernOption, updateConcernOption } from "../../src/modules/providers/providers.service.js";
import { createPackage } from "../../src/modules/services/services.service.js";
import { setWeeklySchedule } from "../../src/modules/availability/availability.service.js";
import { getServiceBootstrap, listPublicProviders, submitPublicBooking } from "../../src/modules/public/public.service.js";

const TAG = `itest-${randomUUID().slice(0, 8)}`;
const TZ = "Asia/Karachi";
const ctx = { organizationId: null, userId: null, ipAddress: null, userAgent: "integration-test", requestId: TAG };

let org: { id: string; name: string; slug: string; timezone: string; currency: string; logoUrl: string | null };
let actorId: string;
let clinicalServiceId: string;
let providerA: string; // covers ANXIETY and TRAUMA (+ a hidden one)
let providerB: string; // covers only RELATIONSHIPS
let providerC: string; // no options at all
let packageId: string;
const createdUserIds: string[] = [];
const createdProviderIds: string[] = [];
const createdBookingIds: string[] = [];

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

async function errorOf(p: Promise<unknown>): Promise<AppError> {
  try {
    await p;
    throw new Error("expected a rejection");
  } catch (err) {
    if (err instanceof AppError) return err;
    throw err;
  }
}

/** A Monday three weeks out, clear of minimum-notice windows. */
const monday = DateTime.now().setZone(TZ).plus({ weeks: 3 }).startOf("week").toISODate()!;
const at = (time: string) => DateTime.fromISO(`${monday}T${time}`, { zone: TZ }).toISO()!;

const body = (providerId: string, selected: string[], startsAt: string, otherDetail?: string) => ({
  service: "clinical-counseling",
  providerId,
  packageId,
  startsAt,
  personal: { firstName: "Sara", lastName: TAG, phone: "+923001234567", email: `${TAG}@example.test`, gender: "FEMALE" },
  location: { city: "Karachi" },
  details: { areasOfConcern: { selected, ...(otherDetail ? { otherDetail } : {}) }, previousDiagnosis: false },
  termsAccepted: true,
  website: "",
});

async function newProvider(name: string): Promise<string> {
  const id = (
    await createProvider(
      admin(),
      { providerType: "COUNSELLOR", displayName: `${TAG} ${name}`, gender: "FEMALE", acceptsMale: true, acceptsFemale: true, serviceIds: [clinicalServiceId] },
      ctx,
    )
  ).id;
  createdProviderIds.push(id);
  await setWeeklySchedule(admin(), id, { timezone: TZ, days: [{ dayOfWeek: 1, intervals: [{ start: "09:00", end: "17:00" }] }] }, ctx);
  return id;
}

beforeAll(async () => {
  const o = await prisma.organization.findUniqueOrThrow({ where: { slug: process.env.DEFAULT_ORGANIZATION_SLUG ?? "default" } });
  org = { id: o.id, name: o.name, slug: o.slug, timezone: o.timezone, currency: o.currency, logoUrl: null };
  clinicalServiceId = (await prisma.service.findFirstOrThrow({ where: { organizationId: org.id, slug: "clinical-counseling" } })).id;
  const actor = await prisma.user.create({ data: { organizationId: org.id, authUserId: randomUUID(), email: `${TAG}-actor@example.test`, firstName: TAG } });
  actorId = actor.id;
  createdUserIds.push(actor.id);

  providerA = await newProvider("A");
  providerB = await newProvider("B");
  providerC = await newProvider("C");
  packageId = (await createPackage(admin(), clinicalServiceId, { name: `${TAG} Session`, price: 1000, durationMinutes: 60 }, ctx)).id;

  await createConcernOption(admin(), providerA, { code: "ANXIETY", label: "Anxiety" }, ctx);
  await createConcernOption(admin(), providerA, { code: "TRAUMA", label: "Trauma" }, ctx);
  await createConcernOption(admin(), providerA, { code: "HIDDEN_ONE", label: "Hidden", isActive: false }, ctx);
  await createConcernOption(admin(), providerB, { code: "RELATIONSHIPS", label: "Relationships" }, ctx);
});

afterAll(async () => {
  if (createdBookingIds.length) {
    await prisma.payment.deleteMany({ where: { bookingId: { in: createdBookingIds } } });
    await prisma.appointment.deleteMany({ where: { bookingId: { in: createdBookingIds } } });
    await prisma.booking.deleteMany({ where: { id: { in: createdBookingIds } } });
  }
  await prisma.customer.deleteMany({ where: { email: { endsWith: `${TAG}@example.test` } } });
  await prisma.servicePackage.deleteMany({ where: { name: { startsWith: TAG } } });
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

describe("admin manages a provider's own list", () => {
  it("rejects a duplicate code for the same provider but allows the same code on another provider", async () => {
    const dup = await errorOf(createConcernOption(admin(), providerA, { code: "ANXIETY", label: "Again" }, ctx));
    expect(dup.code).toBe("CONFLICT");
    await createConcernOption(admin(), providerB, { code: "ANXIETY", label: "Anxiety (B)" }, ctx);
    const rows = await prisma.providerConcernOption.findMany({ where: { code: "ANXIETY", providerId: { in: [providerA, providerB] } } });
    expect(rows).toHaveLength(2);
    await prisma.providerConcernOption.deleteMany({ where: { providerId: providerB, code: "ANXIETY" } });
  });

  it("edits and deletes an option, and refuses to touch another provider's option", async () => {
    const created = await createConcernOption(admin(), providerC, { code: "TEMP_ONE", label: "Temp" }, ctx);
    const updated = await updateConcernOption(admin(), providerC, created.id, { label: "Temp renamed", isActive: false }, ctx);
    expect(updated).toMatchObject({ label: "Temp renamed", isActive: false });

    const wrongOwner = await errorOf(updateConcernOption(admin(), providerA, created.id, { label: "x" }, ctx));
    expect(wrongOwner.code).toBe("NOT_FOUND");
    const wrongDelete = await errorOf(deleteConcernOption(admin(), providerA, created.id, ctx));
    expect(wrongDelete.code).toBe("NOT_FOUND");

    await deleteConcernOption(admin(), providerC, created.id, ctx);
    expect(await prisma.providerConcernOption.count({ where: { id: created.id } })).toBe(0);
  });

  it("is removed together with the provider", async () => {
    const id = await newProvider("Temp");
    await createConcernOption(admin(), id, { code: "GONE_SOON", label: "Gone soon" }, ctx);
    await prisma.serviceProvider.deleteMany({ where: { providerId: id } });
    await prisma.availabilityRule.deleteMany({ where: { availability: { providerId: id } } });
    await prisma.availability.deleteMany({ where: { providerId: id } });
    await prisma.providerProfile.delete({ where: { id } });
    expect(await prisma.providerConcernOption.count({ where: { providerId: id } })).toBe(0);
  });
});

describe("public provider cards", () => {
  it("carry only that provider's active options, in order", async () => {
    const list = await listPublicProviders("clinical-counseling", undefined);
    const a = list.find((p) => p.id === providerA);
    const b = list.find((p) => p.id === providerB);
    const c = list.find((p) => p.id === providerC);
    expect(a?.concernOptions).toEqual([
      { code: "ANXIETY", label: "Anxiety" },
      { code: "TRAUMA", label: "Trauma" },
    ]);
    expect(b?.concernOptions).toEqual([{ code: "RELATIONSHIPS", label: "Relationships" }]);
    expect(c?.concernOptions).toEqual([]);
  });

  it("no longer put a checklist on the service itself", async () => {
    const service = await getServiceBootstrap("clinical-counseling");
    expect(service.concernOptions).toEqual([]);
  });

  it("GET /public/providers exposes the options over HTTP", async () => {
    const res = await request(createApp()).get("/api/v1/public/providers").query({ service: "clinical-counseling" });
    expect(res.status).toBe(200);
    const a = (res.body.data as { id: string; concernOptions: { code: string }[] }[]).find((p) => p.id === providerA);
    expect(a?.concernOptions.map((o) => o.code)).toEqual(["ANXIETY", "TRAUMA"]);
  });
});

describe("booking validation uses the chosen provider's list", () => {
  it("accepts options the provider covers", async () => {
    const r = await submitPublicBooking(body(providerA, ["ANXIETY", "TRAUMA"], at("09:00")), null);
    createdBookingIds.push((await prisma.booking.findUniqueOrThrow({ where: { bookingNumber: r.bookingNumber }, select: { id: true } })).id);
    expect(r.status).toBe("PENDING_PAYMENT");
  });

  it("refuses an option that only another provider covers", async () => {
    const err = await errorOf(submitPublicBooking(body(providerA, ["RELATIONSHIPS"], at("10:15")), null));
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.errors?.[0]?.path).toBe("details.areasOfConcern.selected");
  });

  it("refuses a hidden option", async () => {
    const err = await errorOf(submitPublicBooking(body(providerA, ["HIDDEN_ONE"], at("10:15")), null));
    expect(err.code).toBe("VALIDATION_ERROR");
  });

  it("lets a provider with no options take a booking through 'Other' with a description", async () => {
    const r = await submitPublicBooking(body(providerC, ["OTHER"], at("09:00"), "Work stress"), null);
    createdBookingIds.push((await prisma.booking.findUniqueOrThrow({ where: { bookingNumber: r.bookingNumber }, select: { id: true } })).id);
    expect(r.status).toBe("PENDING_PAYMENT");
  });

  it("still refuses a named option for a provider with none", async () => {
    const err = await errorOf(submitPublicBooking(body(providerC, ["ANXIETY"], at("10:15")), null));
    expect(err.code).toBe("VALIDATION_ERROR");
  });
});
