/**
 * Operational reports (Phase 9). Built on Appointment rows — the "live"
 * occurrence of a booking (rescheduledTo: null, same convention as
 * bookings.service.ts) — filtered by startsAt within the requested range.
 * Revenue is the appointment's booked value for CONFIRMED/COMPLETED rows: a
 * simple, self-consistent operational figure, not the ledger's verified
 * income (see finance.service.ts's financeSummary for that).
 */
import { DateTime } from "luxon";
import type {
  BookingsReportDto,
  ProviderReportRow,
  ProvidersReportDto,
  ReportQuery,
  ReportType,
  ServiceReportRow,
  ServicesReportDto,
} from "@booking/shared";
import { BOOKING_STATUSES } from "@booking/shared";
import { prisma } from "../../lib/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import { AppError } from "../../utils/app-error.js";
import { money } from "../../utils/serialize.js";
import { toCsv } from "../../utils/csv.js";
import { hasPermission } from "../auth/permission-rules.js";
import type { Principal } from "../auth/principal.service.js";

const REVENUE_STATUSES: ("CONFIRMED" | "COMPLETED")[] = ["CONFIRMED", "COMPLETED"];

function range(tz: string, from: string, to: string): Prisma.DateTimeFilter {
  return { gte: DateTime.fromISO(from, { zone: tz }).toJSDate(), lt: DateTime.fromISO(to, { zone: tz }).plus({ days: 1 }).toJSDate() };
}

type DateField = "startsAt" | "createdAt";

function baseWhere(p: Principal, from: string, to: string, dateField: DateField): Prisma.AppointmentWhereInput {
  const filter = range(p.organization.timezone, from, to);
  return dateField === "createdAt"
    ? { organizationId: p.organizationId, rescheduledTo: null, createdAt: filter }
    : { organizationId: p.organizationId, rescheduledTo: null, startsAt: filter };
}

function assertCanView(p: Principal): void {
  if (!hasPermission(p, "reports.view")) throw AppError.forbidden();
}
function assertCanExport(p: Principal): void {
  if (!hasPermission(p, "reports.export")) throw AppError.forbidden();
}

// ---------------------------------------------------------------------------
// Bookings report
// ---------------------------------------------------------------------------

async function bookingsReport(p: Principal, from: string, to: string, dateField: DateField): Promise<BookingsReportDto> {
  const where = baseWhere(p, from, to, dateField);
  const tz = p.organization.timezone;
  const fromUtc = DateTime.fromISO(from, { zone: tz }).toJSDate();
  const toUtc = DateTime.fromISO(to, { zone: tz }).plus({ days: 1 }).toJSDate();
  const col = Prisma.raw(dateField === "createdAt" ? `a."createdAt"` : `a."startsAt"`);

  const [total, byStatus, byServiceRaw, bySource, services, daily] = await Promise.all([
    prisma.appointment.count({ where }),
    prisma.appointment.groupBy({ by: ["status"], where, _count: { _all: true } }),
    prisma.appointment.groupBy({ by: ["serviceId"], where, _count: { _all: true } }),
    prisma.appointment.groupBy({ by: ["source"], where, _count: { _all: true } }),
    prisma.service.findMany({ where: { organizationId: p.organizationId }, select: { id: true, name: true } }),
    prisma.$queryRaw<{ day: string; count: bigint }[]>`
      SELECT to_char((${col} AT TIME ZONE ${tz})::date, 'YYYY-MM-DD') AS day, COUNT(*)::bigint AS count
      FROM "appointments" a
      WHERE a."organizationId" = ${p.organizationId}::uuid
        AND ${col} >= ${fromUtc} AND ${col} < ${toUtc}
        AND NOT EXISTS (SELECT 1 FROM "appointments" r WHERE r."rescheduledFromId" = a."id")
      GROUP BY 1 ORDER BY 1`,
  ]);

  const names = new Map(services.map((s) => [s.id, s.name]));
  const countOf = (status: string) => byStatus.find((s) => s.status === status)?._count._all ?? 0;
  const cancelledCount = countOf("CANCELLED");
  const noShowCount = countOf("NO_SHOW");
  const completedCount = countOf("COMPLETED");
  const days = new Map<string, number>();
  for (let d = DateTime.fromISO(from); d <= DateTime.fromISO(to); d = d.plus({ days: 1 })) days.set(d.toISODate()!, 0);
  for (const r of daily) days.set(r.day, Number(r.count));

  return {
    from,
    to,
    total,
    byStatus: BOOKING_STATUSES.map((status) => ({ status, count: countOf(status) })).filter((s) => s.count > 0),
    byService: byServiceRaw
      .map((s) => ({ serviceId: s.serviceId, serviceName: names.get(s.serviceId) ?? "Unknown", count: s._count._all }))
      .sort((a, b) => b.count - a.count),
    bySource: bySource.map((s) => ({ source: s.source, count: s._count._all })).sort((a, b) => b.count - a.count),
    cancelledCount,
    noShowCount,
    completedCount,
    cancellationRatePercent: total > 0 ? Math.round((cancelledCount / total) * 1000) / 10 : 0,
    noShowRatePercent: total > 0 ? Math.round((noShowCount / total) * 1000) / 10 : 0,
    daily: [...days.entries()].map(([date, count]) => ({ date, count })),
  };
}

function bookingsReportCsv(r: BookingsReportDto): string {
  return toCsv(
    ["Date", "Bookings"],
    r.daily.map((d) => [d.date, d.count]),
  );
}

// ---------------------------------------------------------------------------
// Providers report
// ---------------------------------------------------------------------------

async function providersReport(p: Principal, from: string, to: string, dateField: DateField): Promise<ProvidersReportDto> {
  const where = baseWhere(p, from, to, dateField);
  const [byStatus, revenue, providers] = await Promise.all([
    prisma.appointment.groupBy({ by: ["providerId", "status"], where, _count: { _all: true } }),
    prisma.appointment.groupBy({ by: ["providerId"], where: { ...where, status: { in: REVENUE_STATUSES } }, _sum: { totalAmount: true } }),
    prisma.providerProfile.findMany({ where: { organizationId: p.organizationId }, select: { id: true, displayName: true, providerType: true } }),
  ]);

  const revenueById = new Map(revenue.map((r) => [r.providerId, r._sum?.totalAmount ?? null]));
  const rows: ProviderReportRow[] = providers
    .map((prov) => {
      const rowsForProvider = byStatus.filter((s) => s.providerId === prov.id);
      const total = rowsForProvider.reduce((sum, s) => sum + s._count._all, 0);
      const countOf = (status: string) => rowsForProvider.find((s) => s.status === status)?._count._all ?? 0;
      return {
        providerId: prov.id,
        providerName: prov.displayName,
        providerType: prov.providerType,
        total,
        completed: countOf("COMPLETED"),
        cancelled: countOf("CANCELLED"),
        noShow: countOf("NO_SHOW"),
        revenue: money(revenueById.get(prov.id) ?? { toFixed: () => "0.00" }),
      };
    })
    .filter((r) => r.total > 0)
    .sort((a, b) => Number(b.revenue) - Number(a.revenue));

  return { from, to, currency: p.organization.currency, rows };
}

function providersReportCsv(r: ProvidersReportDto): string {
  return toCsv(
    ["Provider", "Type", "Total", "Completed", "Cancelled", "No-show", "Revenue"],
    r.rows.map((row) => [row.providerName, row.providerType, row.total, row.completed, row.cancelled, row.noShow, row.revenue]),
  );
}

// ---------------------------------------------------------------------------
// Services report
// ---------------------------------------------------------------------------

async function servicesReport(p: Principal, from: string, to: string, dateField: DateField): Promise<ServicesReportDto> {
  const where = baseWhere(p, from, to, dateField);
  const [byStatus, revenue, services] = await Promise.all([
    prisma.appointment.groupBy({ by: ["serviceId", "status"], where, _count: { _all: true } }),
    prisma.appointment.groupBy({ by: ["serviceId"], where: { ...where, status: { in: REVENUE_STATUSES } }, _sum: { totalAmount: true }, _avg: { totalAmount: true } }),
    prisma.service.findMany({ where: { organizationId: p.organizationId }, select: { id: true, name: true } }),
  ]);

  const revenueById = new Map(revenue.map((r) => [r.serviceId, r]));
  const rows: ServiceReportRow[] = services
    .map((svc) => {
      const rowsForService = byStatus.filter((s) => s.serviceId === svc.id);
      const total = rowsForService.reduce((sum, s) => sum + s._count._all, 0);
      const countOf = (status: string) => rowsForService.find((s) => s.status === status)?._count._all ?? 0;
      const rev = revenueById.get(svc.id);
      return {
        serviceId: svc.id,
        serviceName: svc.name,
        total,
        completed: countOf("COMPLETED"),
        cancelled: countOf("CANCELLED"),
        revenue: money(rev?._sum?.totalAmount ?? { toFixed: () => "0.00" }),
        averageValue: money(rev?._avg?.totalAmount ?? { toFixed: () => "0.00" }),
      };
    })
    .filter((r) => r.total > 0)
    .sort((a, b) => Number(b.revenue) - Number(a.revenue));

  return { from, to, currency: p.organization.currency, rows };
}

function servicesReportCsv(r: ServicesReportDto): string {
  return toCsv(
    ["Service", "Total", "Completed", "Cancelled", "Revenue", "Average value"],
    r.rows.map((row) => [row.serviceName, row.total, row.completed, row.cancelled, row.revenue, row.averageValue]),
  );
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

type ReportDtoFor<T extends ReportType> = T extends "bookings" ? BookingsReportDto : T extends "providers" ? ProvidersReportDto : ServicesReportDto;

export async function getReport<T extends ReportType>(p: Principal, type: T, q: ReportQuery): Promise<ReportDtoFor<T>> {
  assertCanView(p);
  if (type === "bookings") return bookingsReport(p, q.from, q.to, q.dateField) as Promise<ReportDtoFor<T>>;
  if (type === "providers") return providersReport(p, q.from, q.to, q.dateField) as Promise<ReportDtoFor<T>>;
  return servicesReport(p, q.from, q.to, q.dateField) as Promise<ReportDtoFor<T>>;
}

export async function exportReportCsv(p: Principal, type: ReportType, q: ReportQuery): Promise<string> {
  assertCanExport(p);
  if (type === "bookings") return bookingsReportCsv(await bookingsReport(p, q.from, q.to, q.dateField));
  if (type === "providers") return providersReportCsv(await providersReport(p, q.from, q.to, q.dateField));
  return servicesReportCsv(await servicesReport(p, q.from, q.to, q.dateField));
}
