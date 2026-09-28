/**
 * Digital-ticket check-in (Phase 11). One action, `checkIn()`, backs both the
 * QR-scan flow and the manual booking/ticket-number search — the admin page
 * always looks up first (read-only) then confirms, exactly like the spec
 * asks, so staff sees who they're checking in before it happens.
 *
 * Idempotent by design: checking in an already-checked-in ticket is a no-op
 * (returns the existing check-in, `alreadyCheckedIn: true`) rather than an
 * error — this is what "do not allow another check-in unless explicitly
 * reset" means in practice, since the original checkedInAt/checkedInBy are
 * never overwritten by a second scan.
 */
import type { CheckInLookupQuery, CheckInResultDto } from "@booking/shared";
import { prisma } from "../../lib/prisma.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { AppError } from "../../utils/app-error.js";
import { recordAudit, type AuditContext } from "../audit/audit.service.js";
import { hasPermission } from "../auth/permission-rules.js";
import type { Principal } from "../auth/principal.service.js";

const CHECKABLE_STATUSES = ["CONFIRMED", "COMPLETED"] as const;

const include = {
  booking: { select: { id: true, bookingNumber: true, customerFirstName: true, customerLastName: true, customerPhone: true } },
  provider: { select: { displayName: true } },
  service: { select: { name: true } },
  package: { select: { name: true } },
  checkedInBy: { select: { firstName: true, lastName: true } },
} as const satisfies Prisma.AppointmentInclude;
type Row = Prisma.AppointmentGetPayload<{ include: typeof include }>;

const fullName = (u: { firstName: string; lastName: string | null } | null) => (u ? [u.firstName, u.lastName].filter(Boolean).join(" ") : null);

function toDto(a: Row): CheckInResultDto {
  return {
    appointmentId: a.id,
    bookingId: a.bookingId,
    bookingNumber: a.booking.bookingNumber,
    customerName: [a.booking.customerFirstName, a.booking.customerLastName].filter(Boolean).join(" "),
    customerPhone: a.booking.customerPhone,
    serviceName: a.service.name,
    packageName: a.package?.name ?? null,
    providerName: a.provider.displayName,
    startsAt: a.startsAt.toISOString(),
    timezone: a.timezone,
    status: a.status,
    checkedIn: a.checkedInAt !== null,
    checkedInAt: a.checkedInAt?.toISOString() ?? null,
    checkedInBy: fullName(a.checkedInBy),
    alreadyCheckedIn: a.checkedInAt !== null,
  };
}

function assertCanCheckIn(p: Principal): void {
  if (!hasPermission(p, "bookings.check_in")) throw AppError.forbidden();
}

export async function lookup(p: Principal, q: CheckInLookupQuery) {
  assertCanCheckIn(p);
  const where: Prisma.AppointmentWhereInput = q.token
    ? { checkInToken: q.token, organizationId: p.organizationId }
    : { organizationId: p.organizationId, rescheduledTo: null, booking: { is: { bookingNumber: { equals: q.search, mode: "insensitive" } } } };
  const a = await prisma.appointment.findFirst({ where, include, orderBy: { startsAt: "desc" } });
  if (!a) throw AppError.notFound("Ticket");
  return toDto(a);
}

export async function checkIn(p: Principal, appointmentId: string, ctx: AuditContext): Promise<CheckInResultDto> {
  assertCanCheckIn(p);
  const a = await prisma.appointment.findFirst({ where: { id: appointmentId, organizationId: p.organizationId }, include });
  if (!a) throw AppError.notFound("Ticket");
  if (a.checkedInAt) return toDto(a);
  if (!(CHECKABLE_STATUSES as readonly string[]).includes(a.status)) {
    throw AppError.badRequest(`A ${a.status.toLowerCase().replaceAll("_", " ")} booking cannot be checked in`);
  }

  const now = new Date();
  let won = false;
  await prisma.$transaction(async (tx) => {
    // Guards the same race a duplicate scan/tap would cause: only the first write wins.
    const updated = await tx.appointment.updateMany({ where: { id: appointmentId, checkedInAt: null }, data: { checkedInAt: now, checkedInById: p.userId } });
    won = updated.count === 1;
    if (won) await recordAudit(tx, ctx, { action: "checkin.create", entityType: "appointment", entityId: appointmentId, newValues: { checkedInAt: now, checkedInById: p.userId } });
  });
  const after = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId }, include });
  return { ...toDto(after), alreadyCheckedIn: !won };
}

export async function reset(p: Principal, appointmentId: string, ctx: AuditContext): Promise<CheckInResultDto> {
  assertCanCheckIn(p);
  const a = await prisma.appointment.findFirst({ where: { id: appointmentId, organizationId: p.organizationId } });
  if (!a) throw AppError.notFound("Ticket");
  await prisma.$transaction(async (tx) => {
    await tx.appointment.update({ where: { id: appointmentId }, data: { checkedInAt: null, checkedInById: null } });
    await recordAudit(tx, ctx, {
      action: "checkin.reset",
      entityType: "appointment",
      entityId: appointmentId,
      oldValues: { checkedInAt: a.checkedInAt, checkedInById: a.checkedInById },
    });
  });
  const after = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId }, include });
  return toDto(after);
}
