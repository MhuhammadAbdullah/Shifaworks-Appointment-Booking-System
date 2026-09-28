import { DateTime } from "luxon";
import {
  hhmmToMinutes,
  minutesToHhmm,
  type AvailabilityDto,
  type AvailableDatesDto,
  type AvailableDatesQuery,
  type BulkCreateExceptionsInput,
  type CreateBlockedSlotInput,
  type CreateExceptionInput,
  type CreateHolidayInput,
  type HolidayDto,
  type SlotsDto,
  type SlotsQuery,
  type WeeklyScheduleInput,
} from "@booking/shared";
import { prisma, type DbClient } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";
import { dateOnly, parseDateOnly } from "../../utils/serialize.js";
import { recordAudit, type AuditContext } from "../audit/audit.service.js";
import { hasPermission } from "../auth/permission-rules.js";
import type { Principal } from "../auth/principal.service.js";
import { loadAvailabilityData, loadProviderContexts, occupyingAppointmentsWhere } from "./availability.repository.js";
import { eachDate, generateSlots, workingIntervals, type ServiceTiming } from "./slot-engine.js";

// ---------------------------------------------------------------------------
// Access: staff with availability.manage_all manage everyone; a provider
// manages only their own; staff with availability.view may look.
// ---------------------------------------------------------------------------

export function assertCanManageAvailability(principal: Principal, providerId: string): void {
  if (hasPermission(principal, "availability.manage_all")) return;
  if (principal.providerProfileId === providerId && hasPermission(principal, "availability.manage_own")) return;
  throw AppError.forbidden("You cannot change this provider's availability");
}

function assertCanViewAvailability(principal: Principal, providerId: string): void {
  if (hasPermission(principal, "availability.manage_all")) return;
  if (principal.providerProfileId === providerId) return;
  // availability.view is also a provider permission, so it only opens other
  // providers' schedules to staff (people with a staff profile).
  if (principal.staffProfileId && hasPermission(principal, "availability.view")) return;
  throw AppError.forbidden();
}

async function loadProvider(db: DbClient, organizationId: string, providerId: string) {
  const p = await db.providerProfile.findFirst({
    where: { id: providerId, organizationId, deletedAt: null },
    select: { id: true, timezone: true, displayName: true },
  });
  if (!p) throw AppError.notFound("Provider");
  return p;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function getAvailability(principal: Principal, providerId: string): Promise<AvailabilityDto> {
  assertCanViewAvailability(principal, providerId);
  const provider = await loadProvider(prisma, principal.organizationId, providerId);
  const since = DateTime.now().minus({ days: 30 });
  const [schedule, exceptions, blocked] = await Promise.all([
    prisma.availability.findFirst({
      where: { providerId, isDefault: true },
      include: { rules: { orderBy: [{ dayOfWeek: "asc" }, { startMinute: "asc" }] } },
    }),
    prisma.availabilityException.findMany({
      where: { providerId, endDate: { gte: parseDateOnly(since.toISODate()!) } },
      orderBy: [{ startDate: "asc" }, { startMinute: "asc" }],
    }),
    prisma.blockedSlot.findMany({
      where: { providerId, endsAt: { gte: since.toJSDate() } },
      orderBy: { startsAt: "asc" },
      take: 300,
    }),
  ]);

  const weekly = [1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => ({
    dayOfWeek,
    intervals: (schedule?.rules ?? [])
      .filter((r) => r.dayOfWeek === dayOfWeek)
      .map((r) => ({ start: minutesToHhmm(r.startMinute), end: minutesToHhmm(r.endMinute) })),
  }));

  // CUSTOM_HOURS with several intervals are stored as sibling rows; present them as one entry.
  const groups = new Map<string, AvailabilityDto["exceptions"][number]>();
  for (const e of exceptions) {
    const key = `${e.type}|${e.serviceId ?? ""}|${dateOnly(e.startDate)}|${dateOnly(e.endDate)}`;
    const existing = groups.get(key);
    const interval =
      e.startMinute !== null && e.endMinute !== null ? [{ start: minutesToHhmm(e.startMinute), end: minutesToHhmm(e.endMinute) }] : [];
    if (existing) existing.intervals.push(...interval);
    else {
      groups.set(key, {
        id: e.id,
        type: e.type,
        serviceId: e.serviceId,
        startDate: dateOnly(e.startDate)!,
        endDate: dateOnly(e.endDate)!,
        intervals: interval,
        reason: e.reason,
      });
    }
  }

  return {
    providerId,
    displayName: provider.displayName,
    timezone: schedule?.timezone ?? provider.timezone ?? principal.organization.timezone,
    weekly,
    exceptions: [...groups.values()],
    blockedSlots: blocked.map((b) => ({
      id: b.id,
      startsAt: b.startsAt.toISOString(),
      endsAt: b.endsAt.toISOString(),
      reason: b.reason,
    })),
  };
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export async function setWeeklySchedule(principal: Principal, providerId: string, input: WeeklyScheduleInput, ctx: AuditContext) {
  assertCanManageAvailability(principal, providerId);
  await prisma.$transaction(async (tx) => {
    await loadProvider(tx, principal.organizationId, providerId);
    const before = await tx.availability.findFirst({ where: { providerId, isDefault: true }, include: { rules: true } });
    const schedule = before
      ? await tx.availability.update({ where: { id: before.id }, data: { timezone: input.timezone, status: "ACTIVE" } })
      : await tx.availability.create({ data: { providerId, timezone: input.timezone, isDefault: true, name: "Default" } });
    await tx.availabilityRule.deleteMany({ where: { availabilityId: schedule.id } });
    const rules = input.days.flatMap((d) =>
      d.intervals.map((i) => ({
        availabilityId: schedule.id,
        dayOfWeek: d.dayOfWeek,
        startMinute: hhmmToMinutes(i.start),
        endMinute: hhmmToMinutes(i.end),
      })),
    );
    if (rules.length) await tx.availabilityRule.createMany({ data: rules });
    await recordAudit(tx, ctx, {
      action: "availability.schedule.update",
      entityType: "provider",
      entityId: providerId,
      oldValues: before
        ? { timezone: before.timezone, rules: before.rules.map((r) => [r.dayOfWeek, minutesToHhmm(r.startMinute), minutesToHhmm(r.endMinute)]) }
        : null,
      newValues: input,
    });
  });
  return getAvailability(principal, providerId);
}

export async function createException(principal: Principal, providerId: string, input: CreateExceptionInput, ctx: AuditContext) {
  assertCanManageAvailability(principal, providerId);
  await prisma.$transaction(async (tx) => {
    await loadProvider(tx, principal.organizationId, providerId);
    const base = {
      providerId,
      serviceId: input.serviceId ?? null,
      type: input.type,
      startDate: parseDateOnly(input.startDate),
      endDate: parseDateOnly(input.endDate),
      reason: input.reason ?? null,
    };
    const rows =
      input.type === "CUSTOM_HOURS"
        ? input.intervals!.map((i) => ({ ...base, startMinute: hhmmToMinutes(i.start), endMinute: hhmmToMinutes(i.end) }))
        : [{ ...base, startMinute: null, endMinute: null }];
    await tx.availabilityException.createMany({ data: rows });
    await recordAudit(tx, ctx, { action: "availability.exception.create", entityType: "provider", entityId: providerId, newValues: input });
  });
  return getAvailability(principal, providerId);
}

/**
 * Several single-date exceptions saved together — the calendar's "select dates, set hours per date" flow.
 * Each item replaces any existing rows for its exact (type, startDate, endDate), so re-saving an
 * already-set date edits it in place instead of creating a duplicate.
 */
export async function bulkCreateExceptions(principal: Principal, providerId: string, input: BulkCreateExceptionsInput, ctx: AuditContext) {
  assertCanManageAvailability(principal, providerId);
  await prisma.$transaction(async (tx) => {
    await loadProvider(tx, principal.organizationId, providerId);
    for (const item of input.items) {
      const startDate = parseDateOnly(item.startDate);
      const endDate = parseDateOnly(item.endDate);
      const serviceId = item.serviceId ?? null;
      await tx.availabilityException.deleteMany({ where: { providerId, serviceId, type: item.type, startDate, endDate } });
      if (item.type === "CUSTOM_HOURS" && item.startDate === item.endDate) {
        // A day previously marked off/leave/holiday can be turned back into a working day this way —
        // otherwise the leftover non-custom-hours row would still close the date (see workingIntervals()).
        await tx.availabilityException.deleteMany({ where: { providerId, serviceId, type: { not: "CUSTOM_HOURS" }, startDate, endDate } });
      }
      const base = { providerId, serviceId, type: item.type, startDate, endDate, reason: item.reason ?? null };
      const rows =
        item.type === "CUSTOM_HOURS"
          ? item.intervals!.map((i) => ({ ...base, startMinute: hhmmToMinutes(i.start), endMinute: hhmmToMinutes(i.end) }))
          : [{ ...base, startMinute: null, endMinute: null }];
      await tx.availabilityException.createMany({ data: rows });
    }
    await recordAudit(tx, ctx, {
      action: "availability.exception.bulk_create",
      entityType: "provider",
      entityId: providerId,
      newValues: { count: input.items.length, dates: input.items.map((i) => i.startDate) },
    });
  });
  return getAvailability(principal, providerId);
}

export async function deleteException(principal: Principal, providerId: string, exceptionId: string, ctx: AuditContext) {
  assertCanManageAvailability(principal, providerId);
  await prisma.$transaction(async (tx) => {
    const row = await tx.availabilityException.findFirst({ where: { id: exceptionId, providerId } });
    if (!row) throw AppError.notFound("Exception");
    // Remove sibling intervals of the same CUSTOM_HOURS entry too.
    await tx.availabilityException.deleteMany({
      where: { providerId, serviceId: row.serviceId, type: row.type, startDate: row.startDate, endDate: row.endDate },
    });
    await recordAudit(tx, ctx, { action: "availability.exception.delete", entityType: "provider", entityId: providerId, oldValues: row });
  });
  return getAvailability(principal, providerId);
}

export async function createBlockedSlot(principal: Principal, providerId: string, input: CreateBlockedSlotInput, ctx: AuditContext) {
  assertCanManageAvailability(principal, providerId);
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);
  await prisma.$transaction(async (tx) => {
    await loadProvider(tx, principal.organizationId, providerId);
    const clashes = await tx.appointment.count({
      where: { providerId, blockedFrom: { lt: endsAt }, blockedUntil: { gt: startsAt }, ...occupyingAppointmentsWhere },
    });
    if (clashes) {
      throw AppError.conflict(`This period overlaps ${clashes} booking(s). Reschedule or cancel them first.`);
    }
    const row = await tx.blockedSlot.create({
      data: { providerId, startsAt, endsAt, reason: input.reason ?? null, createdById: principal.userId },
    });
    await recordAudit(tx, ctx, { action: "availability.block.create", entityType: "provider", entityId: providerId, newValues: row });
  });
  return getAvailability(principal, providerId);
}

export async function deleteBlockedSlot(principal: Principal, providerId: string, blockId: string, ctx: AuditContext) {
  assertCanManageAvailability(principal, providerId);
  await prisma.$transaction(async (tx) => {
    const row = await tx.blockedSlot.findFirst({ where: { id: blockId, providerId } });
    if (!row) throw AppError.notFound("Blocked time");
    await tx.blockedSlot.delete({ where: { id: blockId } });
    await recordAudit(tx, ctx, { action: "availability.block.delete", entityType: "provider", entityId: providerId, oldValues: row });
  });
  return getAvailability(principal, providerId);
}

// ---------------------------------------------------------------------------
// Holidays (clinic-wide closures)
// ---------------------------------------------------------------------------

export async function listHolidays(principal: Principal): Promise<HolidayDto[]> {
  const rows = await prisma.holiday.findMany({
    where: { organizationId: principal.organizationId },
    orderBy: { date: "asc" },
  });
  return rows.map((h) => ({ id: h.id, name: h.name, date: dateOnly(h.date)!, isRecurring: h.isRecurring }));
}

export async function createHoliday(principal: Principal, input: CreateHolidayInput, ctx: AuditContext) {
  await prisma.$transaction(async (tx) => {
    const row = await tx.holiday.create({
      data: {
        organizationId: principal.organizationId,
        name: input.name,
        date: parseDateOnly(input.date),
        isRecurring: input.isRecurring,
      },
    });
    await recordAudit(tx, ctx, { action: "holiday.create", entityType: "holiday", entityId: row.id, newValues: input });
  });
  return listHolidays(principal);
}

export async function deleteHoliday(principal: Principal, id: string, ctx: AuditContext) {
  await prisma.$transaction(async (tx) => {
    const row = await tx.holiday.findFirst({ where: { id, organizationId: principal.organizationId } });
    if (!row) throw AppError.notFound("Holiday");
    await tx.holiday.delete({ where: { id } });
    await recordAudit(tx, ctx, { action: "holiday.delete", entityType: "holiday", entityId: id, oldValues: row });
  });
  return listHolidays(principal);
}

// ---------------------------------------------------------------------------
// Slots
// ---------------------------------------------------------------------------

export interface SlotRequest {
  serviceId: string;
  providerId: string;
  packageId?: string | undefined;
}

export interface SlotOptions {
  /**
   * Online (customer) rules: service must be open, provider and package
   * active, notice and advance limits apply. Staff previews / manual bookings
   * use online = false (no notice limit, one year ahead).
   */
  online: boolean;
  now?: Date;
}

export interface SlotPlan {
  providerId: string;
  timezone: string;
  timing: ServiceTiming;
}

/**
 * Resolves and validates service + provider + package into slot timing. The
 * booking engine (Phase 5) uses the same function, so search and booking can
 * never disagree about duration or buffers.
 */
export async function resolveSlotPlan(
  db: DbClient,
  organization: { id: string; timezone: string },
  req: SlotRequest,
  opts: SlotOptions,
): Promise<SlotPlan> {
  const service = await db.service.findFirst({
    where: { id: req.serviceId, organizationId: organization.id },
    select: {
      isActive: true,
      bookingEnabled: true,
      defaultDurationMinutes: true,
      bufferBeforeMinutes: true,
      bufferAfterMinutes: true,
      slotIntervalMinutes: true,
      minNoticeMinutes: true,
      maxAdvanceDays: true,
    },
  });
  if (!service) throw AppError.notFound("Service");
  if (opts.online && !(service.isActive && service.bookingEnabled)) {
    throw new AppError("SERVICE_CLOSED", "Registration for this service is closed");
  }

  const link = await db.serviceProvider.findUnique({
    where: { serviceId_providerId: { serviceId: req.serviceId, providerId: req.providerId } },
    select: { isActive: true, provider: { select: { isActive: true } } },
  });
  if (!link || !link.isActive || (opts.online && !link.provider.isActive)) {
    throw AppError.validation([{ path: "providerId", message: "This provider does not offer this service" }]);
  }

  let durationMinutes = service.defaultDurationMinutes;
  if (req.packageId) {
    const pkg = await db.servicePackage.findFirst({
      where: { id: req.packageId, serviceId: req.serviceId },
      select: { durationMinutes: true, isActive: true },
    });
    if (!pkg || (opts.online && !pkg.isActive)) {
      throw AppError.validation([{ path: "packageId", message: "This option is not available" }]);
    }
    durationMinutes = pkg.durationMinutes ?? durationMinutes;
  }

  const contexts = await loadProviderContexts(db, organization.id, [req.providerId], organization.timezone);
  const ctx = contexts.get(req.providerId);
  if (!ctx) throw AppError.notFound("Provider");
  return {
    providerId: req.providerId,
    timezone: ctx.timezone,
    timing: {
      durationMinutes,
      bufferBeforeMinutes: service.bufferBeforeMinutes,
      bufferAfterMinutes: service.bufferAfterMinutes,
      slotIntervalMinutes: service.slotIntervalMinutes,
      minNoticeMinutes: opts.online ? service.minNoticeMinutes : 0,
      maxAdvanceDays: opts.online ? service.maxAdvanceDays : 365,
    },
  };
}

async function slotsInRange(organization: { id: string; timezone: string }, req: SlotRequest, from: string, to: string, opts: SlotOptions) {
  const now = opts.now ?? new Date();
  const plan = await resolveSlotPlan(prisma, organization, req, opts);
  const contexts = await loadProviderContexts(prisma, organization.id, [req.providerId], organization.timezone);
  // UTC window generously covering the local date range in any timezone.
  const window = {
    from: DateTime.fromISO(from, { zone: "UTC" }).minus({ days: 1 }).toJSDate(),
    to: DateTime.fromISO(to, { zone: "UTC" }).plus({ days: 2 }).toJSDate(),
  };
  const data = await loadAvailabilityData(prisma, organization.id, [...contexts.values()], window, undefined, req.serviceId);
  const providerData = data.get(req.providerId)!;
  return { plan, slots: generateSlots(providerData, plan.timing, from, to, now), data: providerData };
}

/** Dates in [from, to] with at least one free slot (the calendar disables the rest). */
export async function availableDates(
  organization: { id: string; timezone: string },
  query: AvailableDatesQuery,
  opts: SlotOptions,
): Promise<AvailableDatesDto> {
  const { plan, slots, data } = await slotsInRange(organization, query, query.from, query.to, opts);
  const withSlots = new Set(slots.map((s) => s.date));
  const dates = eachDate(query.from, query.to);
  return {
    timezone: plan.timezone,
    durationMinutes: plan.timing.durationMinutes,
    dates: dates.filter((d) => withSlots.has(d)),
    // No working hours at all that day (day off / leave / holiday) — as opposed to open but every slot taken.
    closedDates: dates.filter((d) => !withSlots.has(d) && workingIntervals(d, data).length === 0),
  };
}

/** Free start times on one local date. */
export async function slotsForDate(
  organization: { id: string; timezone: string },
  query: SlotsQuery,
  opts: SlotOptions,
): Promise<SlotsDto> {
  const { plan, slots } = await slotsInRange(organization, query, query.date, query.date, opts);
  return {
    timezone: plan.timezone,
    durationMinutes: plan.timing.durationMinutes,
    date: query.date,
    slots: slots.map((s) => ({ startsAt: s.start.toISOString(), endsAt: s.end.toISOString(), date: s.date, time: s.time })),
  };
}
