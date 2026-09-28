import { DateTime } from "luxon";
import type {
  BookingDetailDto,
  BookingListItemDto,
  CancelBookingInput,
  ListBookingsQuery,
  ManualBookingInput,
  RescheduleBookingInput,
  UpdateBookingDetailsInput,
  UpdateBookingNotesInput,
} from "@booking/shared";
import { prisma, type DbClient } from "../../lib/prisma.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { AppError } from "../../utils/app-error.js";
import { toCsv } from "../../utils/csv.js";
import { money, moneyOrNull } from "../../utils/serialize.js";
import { BOOKING_TX_OPTIONS, isExclusionViolation, withTxRetry } from "../../utils/db-errors.js";
import { recordAudit, type AuditContext } from "../audit/audit.service.js";
import { hasPermission } from "../auth/permission-rules.js";
import type { Principal } from "../auth/principal.service.js";
import { loadAvailabilityData, loadProviderContexts } from "../availability/availability.repository.js";
import { resolveSlotPlan } from "../availability/availability.service.js";
import { SLOT_CHECK_MESSAGES, checkSlot } from "../availability/slot-engine.js";
import { queueNotifications } from "../notifications/outbox.js";
import { createAppointmentBooking } from "./booking-engine.js";

// ---------------------------------------------------------------------------
// Scoping: staff with bookings.view_all see everything; a provider with
// bookings.view sees only bookings whose live appointment is their own.
// ---------------------------------------------------------------------------

function scopeFilter(p: Principal): Prisma.AppointmentWhereInput | null {
  if (hasPermission(p, "bookings.view_all")) return null;
  if (p.providerProfileId && hasPermission(p, "bookings.view")) return { providerId: p.providerProfileId };
  throw AppError.forbidden();
}

const liveAppointmentSelect = {
  id: true,
  startsAt: true,
  endsAt: true,
  timezone: true,
  providerId: true,
  confirmedAt: true,
  completedAt: true,
  cancelledAt: true,
  cancellationReason: true,
  availabilityOverridden: true,
  rescheduledFromId: true,
  checkedInAt: true,
  provider: { select: { id: true, displayName: true, phone: true, email: true } },
  service: { select: { id: true, slug: true, name: true } },
  package: { select: { id: true, name: true, points: true } },
  rescheduledTo: { select: { id: true } },
  checkedInBy: { select: { firstName: true, lastName: true } },
} as const satisfies Prisma.AppointmentSelect;

const bookingInclude = {
  customer: { select: { id: true, customerNumber: true } },
  payments: { orderBy: { createdAt: "desc" as const }, take: 1 },
  appointments: { where: { rescheduledTo: null }, take: 1, select: liveAppointmentSelect },
} as const satisfies Prisma.BookingInclude;

type BookingRow = Prisma.BookingGetPayload<{ include: typeof bookingInclude }>;

const fullName = (u: { firstName: string; lastName: string | null } | null) => (u ? [u.firstName, u.lastName].filter(Boolean).join(" ") : null);

function liveOrThrow(b: BookingRow) {
  const live = b.appointments[0];
  if (!live) throw AppError.notFound("Booking");
  return live;
}

/** A provider sees only their own appointments and never the customer's contact details — the name stays (they need to know who's coming), everything else is redacted server-side, not just hidden in the UI. */
function isRestricted(p: Principal): boolean {
  return !hasPermission(p, "bookings.view_all");
}

function toListItem(b: BookingRow, p: Principal): BookingListItemDto {
  const live = liveOrThrow(b);
  const restricted = isRestricted(p);
  return {
    id: b.id,
    bookingNumber: b.bookingNumber,
    status: b.status,
    paymentStatus: b.paymentStatus,
    source: b.source,
    customerName: [b.customerFirstName, b.customerLastName].filter(Boolean).join(" "),
    customerPhone: restricted ? null : b.customerPhone,
    customerEmail: restricted ? null : b.customerEmail,
    serviceName: live.service.name,
    serviceSlug: live.service.slug,
    providerName: live.provider.displayName,
    packageName: live.package?.name ?? null,
    startsAt: live.startsAt.toISOString(),
    endsAt: live.endsAt.toISOString(),
    timezone: live.timezone,
    amount: money(b.totalAmount),
    currency: b.currency,
    createdAt: b.createdAt.toISOString(),
  };
}

function toDetail(b: BookingRow, p: Principal): BookingDetailDto {
  const live = liveOrThrow(b);
  const payment = b.payments[0];
  const restricted = isRestricted(p);
  return {
    ...toListItem(b, p),
    appointmentId: live.id,
    customer: {
      id: b.customer.id,
      customerNumber: b.customer.customerNumber,
      firstName: b.customerFirstName,
      lastName: b.customerLastName,
      email: restricted ? null : b.customerEmail,
      phone: restricted ? null : b.customerPhone,
      dateOfBirth: restricted || !b.customerDateOfBirth ? null : b.customerDateOfBirth.toISOString().slice(0, 10),
      gender: restricted ? null : b.customerGender,
      city: restricted ? null : b.customerCity,
      province: restricted ? null : b.customerProvince,
      address: restricted ? null : b.customerAddress,
    },
    provider: live.provider,
    service: live.service,
    package: live.package,
    formData: b.formData,
    customerNotes: restricted ? null : b.customerNotes,
    internalNotes: b.internalNotes,
    termsAcceptedAt: b.termsAcceptedAt?.toISOString() ?? null,
    payment:
      restricted || !payment
        ? null
        : { id: payment.id, paymentNumber: payment.paymentNumber, status: payment.status, method: payment.method, amount: money(payment.amount), proofFileId: payment.proofFileId },
    confirmedAt: live.confirmedAt?.toISOString() ?? null,
    completedAt: live.completedAt?.toISOString() ?? null,
    cancelledAt: live.cancelledAt?.toISOString() ?? null,
    cancellationReason: live.cancellationReason,
    rescheduledFromId: live.rescheduledFromId,
    rescheduledToId: null, // by definition: `live` is the appointment with no rescheduledTo
    availabilityOverridden: live.availabilityOverridden,
    checkIn: restricted || !live.checkedInAt ? null : { checkedInAt: live.checkedInAt.toISOString(), checkedInBy: fullName(live.checkedInBy) },
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

function bookingsWhere(p: Principal, q: Partial<ListBookingsQuery>): Prisma.BookingWhereInput {
  const scope = scopeFilter(p);
  const appointmentFilter: Prisma.AppointmentWhereInput = {
    rescheduledTo: null,
    ...(scope ?? {}),
    ...(q.providerId ? { providerId: q.providerId } : {}),
    ...(q.service ? { service: { slug: q.service } } : {}),
    ...(q.from || q.to
      ? { startsAt: { ...(q.from ? { gte: DateTime.fromISO(q.from, { zone: "utc" }).toJSDate() } : {}), ...(q.to ? { lt: DateTime.fromISO(q.to, { zone: "utc" }).plus({ days: 1 }).toJSDate() } : {}) } }
      : {}),
  };
  return {
    organizationId: p.organizationId,
    type: "APPOINTMENT",
    ...(q.status?.length ? { status: { in: q.status } } : {}),
    ...(q.paymentStatus ? { paymentStatus: q.paymentStatus } : {}),
    appointments: { some: appointmentFilter },
    ...(q.search
      ? {
          OR: [
            { bookingNumber: { contains: q.search, mode: "insensitive" } },
            { customerFirstName: { contains: q.search, mode: "insensitive" } },
            { customerLastName: { contains: q.search, mode: "insensitive" } },
            { customerEmail: { contains: q.search, mode: "insensitive" } },
            { customerPhone: { contains: q.search.replace(/[\s-]/g, "") } },
          ],
        }
      : {}),
  };
}

export async function listBookings(p: Principal, q: ListBookingsQuery) {
  const where = bookingsWhere(p, q);
  const [total, rows] = await prisma.$transaction([
    prisma.booking.count({ where }),
    prisma.booking.findMany({
      where,
      include: bookingInclude,
      orderBy: { createdAt: q.sort },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
  ]);
  return { items: rows.map((r) => toListItem(r, p)), total, page: q.page, pageSize: q.pageSize };
}

export async function exportBookingsCsv(p: Principal, q: Partial<ListBookingsQuery>): Promise<string> {
  const where = bookingsWhere(p, q);
  const rows = await prisma.booking.findMany({ where, include: bookingInclude, orderBy: { createdAt: "desc" }, take: 50_000 });
  const header = [
    "Booking number",
    "Status",
    "Payment status",
    "Customer",
    "Phone",
    "Email",
    "Service",
    "Provider",
    "Package",
    "Date & time",
    "Timezone",
    "Amount",
    "Currency",
    "Booked on",
  ];
  return toCsv(
    header,
    rows.map((r) => {
      const item = toListItem(r, p);
      return [
        item.bookingNumber,
        item.status,
        item.paymentStatus,
        item.customerName,
        item.customerPhone ?? "",
        item.customerEmail ?? "",
        item.serviceName,
        item.providerName,
        item.packageName ?? "",
        DateTime.fromISO(item.startsAt, { zone: item.timezone }).toFormat("yyyy-LL-dd HH:mm"),
        item.timezone,
        item.amount,
        item.currency,
        DateTime.fromISO(item.createdAt).toFormat("yyyy-LL-dd HH:mm"),
      ];
    }),
  );
}

async function loadScoped(p: Principal, id: string): Promise<BookingRow> {
  const scope = scopeFilter(p);
  const row = await prisma.booking.findFirst({
    where: { id, organizationId: p.organizationId, type: "APPOINTMENT", ...(scope ? { appointments: { some: scope } } : {}) },
    include: bookingInclude,
  });
  if (!row) throw AppError.notFound("Booking");
  return row;
}

export async function getBooking(p: Principal, id: string): Promise<BookingDetailDto> {
  return toDetail(await loadScoped(p, id), p);
}

// ---------------------------------------------------------------------------
// Manual / staff booking
// ---------------------------------------------------------------------------

export async function createManualBooking(p: Principal, input: ManualBookingInput, ctx: AuditContext) {
  if (!hasPermission(p, "bookings.create")) throw AppError.forbidden();
  if (input.overrideAvailability && !hasPermission(p, "bookings.override_availability")) {
    throw AppError.forbidden("You are not allowed to book outside the provider's availability");
  }
  const serviceRow = await prisma.service.findFirst({ where: { organizationId: p.organizationId, slug: input.service }, select: { id: true } });
  if (!serviceRow) throw AppError.notFound("Service");

  const result = await createAppointmentBooking({
    organization: p.organization,
    serviceId: serviceRow.id,
    providerId: input.providerId,
    packageId: input.packageId,
    startsAt: new Date(input.startsAt),
    customer: {
      firstName: input.personal.firstName,
      lastName: input.personal.lastName ?? null,
      email: input.personal.email,
      phone: input.personal.phone,
      dateOfBirth: input.personal.dateOfBirth ?? null,
      gender: input.personal.gender,
      city: input.location.city ?? null,
      province: input.location.province ?? null,
      address: input.location.address ?? null,
    },
    formData: {},
    formVersion: 1,
    termsUrl: null,
    termsAcceptedAt: null,
    customerNotes: input.customerNotes ?? null,
    source: input.source,
    online: false,
    overrideAvailability: input.overrideAvailability,
    createdById: p.userId,
    markPaid: input.markPaid ? { method: input.paymentMethod!, verifiedById: p.userId } : null,
  });
  await recordAudit(prisma, ctx, {
    action: "booking.create_manual",
    entityType: "booking",
    entityId: result.bookingId,
    newValues: { bookingNumber: result.bookingNumber, source: input.source, markPaid: input.markPaid },
  });
  return getBooking(p, result.bookingId);
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export async function updateBookingNotes(p: Principal, id: string, input: UpdateBookingNotesInput, ctx: AuditContext) {
  if (!hasPermission(p, "bookings.update")) throw AppError.forbidden();
  await prisma.$transaction(async (tx) => {
    const before = await loadScoped(p, id);
    await tx.booking.update({ where: { id }, data: { internalNotes: input.internalNotes ?? null } });
    await recordAudit(tx, ctx, {
      action: "booking.notes.update",
      entityType: "booking",
      entityId: id,
      oldValues: { internalNotes: before.internalNotes },
      newValues: input,
    });
  });
  return getBooking(p, id);
}

/** The customer-contact snapshot only — everything else about a booking is immutable once created. */
export async function updateBookingDetails(p: Principal, id: string, input: UpdateBookingDetailsInput, ctx: AuditContext) {
  if (!hasPermission(p, "bookings.update")) throw AppError.forbidden();
  await prisma.$transaction(async (tx) => {
    const before = await loadScoped(p, id);
    await tx.booking.update({
      where: { id },
      data: {
        customerFirstName: input.firstName,
        customerLastName: input.lastName ?? null,
        customerEmail: input.email ?? null,
        customerPhone: input.phone ?? null,
      },
    });
    await recordAudit(tx, ctx, {
      action: "booking.update_details",
      entityType: "booking",
      entityId: id,
      oldValues: {
        firstName: before.customerFirstName,
        lastName: before.customerLastName,
        email: before.customerEmail,
        phone: before.customerPhone,
      },
      newValues: input,
    });
  });
  return getBooking(p, id);
}

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

const SLOT_HOLDING: string[] = ["PENDING_PAYMENT", "PAYMENT_SUBMITTED", "PAYMENT_VERIFIED", "CONFIRMED"];

export async function cancelBooking(p: Principal, id: string, input: CancelBookingInput, ctx: AuditContext) {
  if (!hasPermission(p, "bookings.cancel")) throw AppError.forbidden();
  const b = await loadScoped(p, id);
  const live = liveOrThrow(b);
  if (!SLOT_HOLDING.includes(b.status)) throw AppError.badRequest(`A ${b.status.toLowerCase().replaceAll("_", " ")} booking cannot be cancelled`);

  await prisma.$transaction(async (tx) => {
    const now = new Date();
    const updated = await tx.appointment.updateMany({
      where: { id: live.id, status: b.status },
      data: { status: "CANCELLED", cancelledAt: now, cancelledById: p.userId, cancellationReason: input.reason ?? null },
    });
    if (updated.count !== 1) throw AppError.conflict("This booking was just changed by someone else. Refresh and try again.");
    await tx.booking.update({
      where: { id },
      data: { status: "CANCELLED", cancelledAt: now, cancelledById: p.userId, cancellationReason: input.reason ?? null },
    });
    await recordAudit(tx, ctx, {
      action: "booking.cancel",
      entityType: "booking",
      entityId: id,
      oldValues: { status: b.status },
      newValues: { status: "CANCELLED", reason: input.reason ?? null },
    });
    // The provider only hears about it if they already knew the booking was happening.
    await queueNotifications(tx, { templateKey: "BOOKING_CANCELLED", bookingId: id, audiences: b.status === "CONFIRMED" ? ["CUSTOMER", "PROVIDER"] : ["CUSTOMER"] });
  });
  return getBooking(p, id);
}

// ---------------------------------------------------------------------------
// Delete — only while the booking has no payment history (same guard pattern
// as providers.service.ts::deleteProvider / services.service.ts::deletePackage
// / expenses.service.ts::deleteExpense). Cancel is the answer once real money
// has moved; nothing with payment/ledger history is ever hard-deleted here.
// ---------------------------------------------------------------------------

export async function deleteBooking(p: Principal, id: string, ctx: AuditContext): Promise<void> {
  if (!hasPermission(p, "bookings.delete")) throw AppError.forbidden();
  const b = await loadScoped(p, id);

  // PENDING (still waiting) and REJECTED (proof rejected) carry no real money movement — only a
  // VERIFIED or REFUNDED payment means something actually changed hands.
  const hasPaymentHistory = await prisma.payment.count({ where: { bookingId: id, status: { in: ["VERIFIED", "REFUNDED"] } } });
  if (hasPaymentHistory) throw AppError.conflict("This booking has payment history. Cancel it instead of deleting.");
  const hasLedgerHistory = await prisma.financeTransaction.count({ where: { bookingId: id } });
  if (hasLedgerHistory) throw AppError.conflict("This booking has ledger entries. Cancel it instead of deleting.");

  await prisma.$transaction(async (tx) => {
    // Recorded first: the audit log is never deleted, so this is the only trace
    // left that the booking existed once the rows below are gone.
    await recordAudit(tx, ctx, {
      action: "booking.delete",
      entityType: "booking",
      entityId: id,
      oldValues: {
        bookingNumber: b.bookingNumber,
        status: b.status,
        customerFirstName: b.customerFirstName,
        customerLastName: b.customerLastName,
        customerEmail: b.customerEmail,
        customerPhone: b.customerPhone,
      },
    });
    await tx.payment.deleteMany({ where: { bookingId: id } });
    await tx.appointment.deleteMany({ where: { bookingId: id } });
    await tx.booking.delete({ where: { id } });
  });
}

// ---------------------------------------------------------------------------
// Complete / no-show — CONFIRMED only, staff or the appointment's own provider
// ---------------------------------------------------------------------------

async function transitionFromConfirmed(p: Principal, id: string, target: "COMPLETED" | "NO_SHOW", ctx: AuditContext) {
  if (!hasPermission(p, "bookings.update")) throw AppError.forbidden();
  const b = await loadScoped(p, id);
  const live = liveOrThrow(b);
  const isOwnProvider = p.providerProfileId === live.providerId;
  if (!hasPermission(p, "bookings.view_all") && !isOwnProvider) throw AppError.forbidden();
  if (b.status !== "CONFIRMED") throw AppError.badRequest(`Only a confirmed booking can be marked ${target === "COMPLETED" ? "completed" : "no-show"}`);
  if (live.startsAt.getTime() > Date.now()) throw AppError.badRequest("This can only be recorded once the appointment has started");

  await prisma.$transaction(async (tx) => {
    const now = new Date();
    const updated = await tx.appointment.updateMany({
      where: { id: live.id, status: "CONFIRMED" },
      data: { status: target, ...(target === "COMPLETED" ? { completedAt: now } : {}) },
    });
    if (updated.count !== 1) throw AppError.conflict("This booking was just changed by someone else. Refresh and try again.");
    await tx.booking.update({ where: { id }, data: { status: target } });
    await recordAudit(tx, ctx, { action: `booking.${target.toLowerCase()}`, entityType: "booking", entityId: id, oldValues: { status: "CONFIRMED" }, newValues: { status: target } });
  });
  return getBooking(p, id);
}

export const completeBooking = (p: Principal, id: string, ctx: AuditContext) => transitionFromConfirmed(p, id, "COMPLETED", ctx);
export const markNoShow = (p: Principal, id: string, ctx: AuditContext) => transitionFromConfirmed(p, id, "NO_SHOW", ctx);

// ---------------------------------------------------------------------------
// Confirm: PAYMENT_VERIFIED → CONFIRMED. Only reachable when the org's
// booking.autoConfirmOnVerify setting is off, so a verified payment does not
// confirm the booking on its own (docs/ARCHITECTURE.md §5) and staff confirm
// it as a separate step.
// ---------------------------------------------------------------------------

export async function confirmBooking(p: Principal, id: string, ctx: AuditContext) {
  if (!hasPermission(p, "bookings.update")) throw AppError.forbidden();
  const b = await loadScoped(p, id);
  const live = liveOrThrow(b);
  if (b.status !== "PAYMENT_VERIFIED") throw AppError.badRequest("Only a payment-verified booking can be confirmed this way");

  await prisma.$transaction(async (tx) => {
    const now = new Date();
    const updated = await tx.appointment.updateMany({ where: { id: live.id, status: "PAYMENT_VERIFIED" }, data: { status: "CONFIRMED", confirmedAt: now } });
    if (updated.count !== 1) throw AppError.conflict("This booking was just changed by someone else. Refresh and try again.");
    await tx.booking.update({ where: { id }, data: { status: "CONFIRMED", confirmedAt: now } });
    await recordAudit(tx, ctx, { action: "booking.confirm", entityType: "booking", entityId: id, oldValues: { status: "PAYMENT_VERIFIED" }, newValues: { status: "CONFIRMED" } });
    await queueNotifications(tx, { templateKey: "BOOKING_CONFIRMED", bookingId: id, audiences: ["CUSTOMER", "PROVIDER"] });
  });
  return getBooking(p, id);
}

/** Re-sends the digital ticket (CUSTOMER audience only — provider already got their own copy the first time). */
export async function resendConfirmation(p: Principal, id: string, ctx: AuditContext) {
  if (!hasPermission(p, "bookings.update")) throw AppError.forbidden();
  const b = await loadScoped(p, id);
  if (b.status !== "CONFIRMED") throw AppError.badRequest("Only a confirmed booking has a ticket to resend");
  await prisma.$transaction(async (tx) => {
    // A fresh `occurrence` (not "-") gives this a new dedupeKey — otherwise the original
    // confirmation's row would already exist and queueNotifications would be a no-op.
    await queueNotifications(tx, { templateKey: "BOOKING_CONFIRMED", bookingId: id, audiences: ["CUSTOMER"], occurrence: `resend-${Date.now()}` });
    await recordAudit(tx, ctx, { action: "booking.resend_confirmation", entityType: "booking", entityId: id });
  });
  return getBooking(p, id);
}

// ---------------------------------------------------------------------------
// Reschedule: the old appointment becomes RESCHEDULED (freeing its slot), a
// new one takes over at the new time. The booking's own status is untouched
// — it reflects the live appointment either way.
// ---------------------------------------------------------------------------

export async function rescheduleBooking(p: Principal, id: string, input: RescheduleBookingInput, ctx: AuditContext) {
  if (!hasPermission(p, "bookings.update") || !hasPermission(p, "bookings.view_all")) {
    throw AppError.forbidden("Only staff can reschedule a booking");
  }
  if (input.overrideAvailability && !hasPermission(p, "bookings.override_availability")) {
    throw AppError.forbidden("You are not allowed to book outside the provider's availability");
  }
  const b = await loadScoped(p, id);
  const old = liveOrThrow(b);
  if (!SLOT_HOLDING.includes(b.status)) throw AppError.badRequest(`A ${b.status.toLowerCase().replaceAll("_", " ")} booking cannot be rescheduled`);

  const providerId = input.providerId ?? old.providerId;
  const startsAt = new Date(input.startsAt);
  if (startsAt.getTime() === old.startsAt.getTime() && providerId === old.providerId) {
    throw AppError.badRequest("Choose a different time or provider");
  }

  try {
    await withTxRetry(() =>
      prisma.$transaction(async (tx) => {
        // Take the old appointment out of the blocking set first — the exclusion
        // constraint is checked per statement, so the new time may overlap it.
        const moved = await tx.appointment.updateMany({ where: { id: old.id, status: b.status }, data: { status: "RESCHEDULED" } });
        if (moved.count !== 1) throw AppError.conflict("This booking was just changed by someone else. Refresh and try again.");

        const [plan, pkg] = await Promise.all([
          resolveSlotPlan(tx, p.organization, { serviceId: old.service.id, providerId, packageId: old.package?.id }, { online: false }),
          old.package ? tx.servicePackage.findFirstOrThrow({ where: { id: old.package.id }, select: { price: true } }) : Promise.resolve(null),
        ]);
        const durationMs = plan.timing.durationMinutes * 60_000;
        const endsAt = new Date(startsAt.getTime() + durationMs);
        const blockedFrom = new Date(startsAt.getTime() - plan.timing.bufferBeforeMinutes * 60_000);
        const blockedUntil = new Date(endsAt.getTime() + plan.timing.bufferAfterMinutes * 60_000);

        if (!input.overrideAvailability) {
          const contexts = await loadProviderContexts(tx, p.organizationId, [providerId], p.organization.timezone);
          const data = (
            await loadAvailabilityData(tx, p.organizationId, [...contexts.values()], { from: blockedFrom, to: blockedUntil }, old.id, old.service.id)
          ).get(providerId)!;
          const check = checkSlot(data, plan.timing, startsAt, new Date(), false);
          if (!check.ok) {
            const message = SLOT_CHECK_MESSAGES[check.reason];
            if (check.reason === "CONFLICT") throw new AppError("SLOT_UNAVAILABLE", message);
            throw AppError.validation([{ path: "startsAt", message }]);
          }
        }

        const created = await tx.appointment.create({
          data: {
            organizationId: p.organizationId,
            bookingId: id,
            customerId: b.customerId,
            providerId,
            serviceId: old.service.id,
            packageId: old.package?.id ?? null,
            startsAt,
            endsAt,
            blockedFrom,
            blockedUntil,
            timezone: plan.timezone,
            status: b.status,
            paymentStatus: b.paymentStatus,
            price: pkg?.price ?? b.totalAmount,
            totalAmount: b.totalAmount,
            source: b.source,
            availabilityOverridden: input.overrideAvailability,
            rescheduledFromId: old.id,
            confirmedAt: old.confirmedAt,
          },
          select: { id: true },
        });
        await recordAudit(tx, ctx, {
          action: "booking.reschedule",
          entityType: "booking",
          entityId: id,
          oldValues: { appointmentId: old.id, startsAt: old.startsAt, providerId: old.providerId },
          newValues: { appointmentId: created.id, startsAt, providerId, reason: input.reason ?? null },
        });
        // occurrence: the new appointment's id, so a booking rescheduled more than once emails each time.
        await queueNotifications(tx, { templateKey: "BOOKING_RESCHEDULED", bookingId: id, audiences: ["CUSTOMER", "PROVIDER"], occurrence: created.id });
        return created.id;
      }, BOOKING_TX_OPTIONS),
    );
    return getBooking(p, id);
  } catch (err) {
    if (isExclusionViolation(err)) throw new AppError("SLOT_UNAVAILABLE", "This time was just booked by someone else. Please choose another time.");
    throw err;
  }
}
