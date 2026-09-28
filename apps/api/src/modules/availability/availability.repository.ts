import { DateTime } from "luxon";
import { SLOT_HOLDING_STATUSES } from "@booking/shared";
import type { DbClient } from "../../lib/prisma.js";
import type { BookingStatus, Prisma } from "../../generated/prisma/client.js";
import { dateOnly } from "../../utils/serialize.js";
import type { AvailabilityData, Interval } from "./slot-engine.js";

/**
 * Appointments that occupy provider time: exactly the statuses covered by the
 * database exclusion constraint, so the slot search never offers a time the
 * insert would reject.
 */
export const occupyingAppointmentsWhere: Prisma.AppointmentWhereInput = {
  status: { in: [...SLOT_HOLDING_STATUSES] as BookingStatus[] },
};

export interface ProviderContext {
  id: string;
  timezone: string;
  locationIds: string[];
}

/** Provider timezone: provider → default schedule → organisation. */
export async function loadProviderContexts(
  db: DbClient,
  organizationId: string,
  providerIds: string[],
  orgTimezone: string,
): Promise<Map<string, ProviderContext>> {
  const rows = await db.providerProfile.findMany({
    where: { id: { in: providerIds }, organizationId, deletedAt: null },
    select: {
      id: true,
      timezone: true,
      availabilities: { where: { isDefault: true }, select: { timezone: true }, take: 1 },
      locations: { select: { locationId: true } },
    },
  });
  return new Map(
    rows.map((p) => [
      p.id,
      {
        id: p.id,
        timezone: p.timezone ?? p.availabilities[0]?.timezone ?? orgTimezone,
        locationIds: p.locations.map((l) => l.locationId),
      },
    ]),
  );
}

/**
 * Loads everything the slot engine needs for several providers over a UTC
 * window in a fixed number of queries (no per-provider/per-day N+1).
 * `excludeAppointmentId` lets a reschedule ignore the appointment being moved.
 * `serviceId`, when given, restricts exceptions to ones scoped to that service
 * plus every provider-wide one (serviceId null) — a provider offering several
 * services can have different working hours per service.
 */
export async function loadAvailabilityData(
  db: DbClient,
  organizationId: string,
  contexts: ProviderContext[],
  window: { from: Date; to: Date },
  excludeAppointmentId?: string,
  serviceId?: string,
): Promise<Map<string, AvailabilityData>> {
  const ids = contexts.map((c) => c.id);
  const allLocationIds = [...new Set(contexts.flatMap((c) => c.locationIds))];
  const fromDate = DateTime.fromJSDate(window.from).minus({ days: 1 }).toISODate()!;
  const toDate = DateTime.fromJSDate(window.to).plus({ days: 1 }).toISODate()!;

  const [schedules, exceptions, holidays, blocked, appointments] = await Promise.all([
    db.availability.findMany({
      where: { providerId: { in: ids }, status: "ACTIVE" },
      select: { providerId: true, effectiveFrom: true, effectiveTo: true, isDefault: true, rules: true },
    }),
    db.availabilityException.findMany({
      where: {
        providerId: { in: ids },
        startDate: { lte: new Date(`${toDate}T00:00:00Z`) },
        endDate: { gte: new Date(`${fromDate}T00:00:00Z`) },
        ...(serviceId ? { OR: [{ serviceId: null }, { serviceId }] } : {}),
      },
    }),
    db.holiday.findMany({
      where: { organizationId, OR: [{ locationId: null }, { locationId: { in: allLocationIds } }] },
      select: { date: true, isRecurring: true, locationId: true },
    }),
    db.blockedSlot.findMany({
      where: {
        startsAt: { lt: window.to },
        endsAt: { gt: window.from },
        OR: [{ providerId: { in: ids } }, { providerId: null, locationId: { in: allLocationIds } }],
      },
      select: { providerId: true, locationId: true, startsAt: true, endsAt: true },
    }),
    db.appointment.findMany({
      where: {
        providerId: { in: ids },
        blockedFrom: { lt: window.to },
        blockedUntil: { gt: window.from },
        ...occupyingAppointmentsWhere,
        ...(excludeAppointmentId ? { id: { not: excludeAppointmentId } } : {}),
      },
      select: { providerId: true, blockedFrom: true, blockedUntil: true },
    }),
  ]);

  const result = new Map<string, AvailabilityData>();
  for (const ctx of contexts) {
    const busy: Interval[] = [
      ...appointments.filter((a) => a.providerId === ctx.id).map((a) => ({ start: a.blockedFrom, end: a.blockedUntil })),
      ...blocked
        .filter((b) => b.providerId === ctx.id || (b.providerId === null && b.locationId && ctx.locationIds.includes(b.locationId)))
        .map((b) => ({ start: b.startsAt, end: b.endsAt })),
    ];
    result.set(ctx.id, {
      timezone: ctx.timezone,
      schedules: schedules
        .filter((s) => s.providerId === ctx.id)
        .map((s) => ({
          effectiveFrom: dateOnly(s.effectiveFrom),
          effectiveTo: dateOnly(s.effectiveTo),
          isDefault: s.isDefault,
          rules: s.rules.map((r) => ({ dayOfWeek: r.dayOfWeek, startMinute: r.startMinute, endMinute: r.endMinute })),
        })),
      exceptions: exceptions
        .filter((e) => e.providerId === ctx.id)
        .map((e) => ({
          type: e.type,
          startDate: dateOnly(e.startDate)!,
          endDate: dateOnly(e.endDate)!,
          startMinute: e.startMinute,
          endMinute: e.endMinute,
        })),
      holidays: holidays
        .filter((h) => h.locationId === null || ctx.locationIds.includes(h.locationId))
        .map((h) => ({ date: dateOnly(h.date)!, isRecurring: h.isRecurring })),
      busy,
    });
  }
  return result;
}
