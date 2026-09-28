/**
 * Payment verification (Phase 6). Every booking is created with exactly one
 * PENDING payment (booking-engine.ts); staff mark it submitted (proof
 * arrived), then verify or reject it. A rejection opens a fresh PENDING
 * payment so the customer can pay again — there is never more than one
 * "live" payment per booking. Verifying posts an INCOME ledger row
 * (finance/ledger.ts); refunding posts a REFUND row.
 */
import { DateTime } from "luxon";
import type { ListPaymentsQuery, MarkSubmittedInput, PaymentDto, RefundPaymentInput, RejectPaymentInput, VerifyPaymentInput } from "@booking/shared";
import { prisma } from "../../lib/prisma.js";
import { nextDocumentNumber } from "../../lib/document-sequence.js";
import { getOrgSettings } from "../../lib/settings.js";
import { Prisma } from "../../generated/prisma/client.js";
import { AppError } from "../../utils/app-error.js";
import { BOOKING_TX_OPTIONS, withTxRetry } from "../../utils/db-errors.js";
import { money } from "../../utils/serialize.js";
import { toCsv } from "../../utils/csv.js";
import { recordAudit, type AuditContext } from "../audit/audit.service.js";
import { hasPermission } from "../auth/permission-rules.js";
import type { Principal } from "../auth/principal.service.js";
import { assertPrivateFile } from "../files/files.service.js";
import { postLedgerEntry } from "../finance/ledger.js";
import { D, ZERO } from "../finance/money.js";
import { recomputeInvoice } from "../invoices/invoices.service.js";
import { queueNotifications } from "../notifications/outbox.js";

const paymentInclude = {
  booking: { select: { id: true, bookingNumber: true } },
  invoice: { select: { id: true, invoiceNumber: true } },
  customer: { select: { id: true, customerNumber: true, firstName: true, lastName: true } },
  verifiedBy: { select: { firstName: true, lastName: true } },
  rejectedBy: { select: { firstName: true, lastName: true } },
  refundedBy: { select: { firstName: true, lastName: true } },
} as const satisfies Prisma.PaymentInclude;
type PaymentRow = Prisma.PaymentGetPayload<{ include: typeof paymentInclude }>;

const name = (u: { firstName: string; lastName: string | null } | null | undefined) => (u ? [u.firstName, u.lastName].filter(Boolean).join(" ") : null);

export function toPaymentDto(p: PaymentRow): PaymentDto {
  return {
    id: p.id,
    paymentNumber: p.paymentNumber,
    booking: p.booking,
    invoice: p.invoice,
    customer: p.customer ? { id: p.customer.id, name: name(p.customer)!, customerNumber: p.customer.customerNumber } : null,
    status: p.status,
    method: p.method,
    amount: money(p.amount),
    currency: p.currency,
    reference: p.reference,
    proofFileId: p.proofFileId,
    notes: p.notes,
    submittedAt: p.submittedAt?.toISOString() ?? null,
    verifiedAt: p.verifiedAt?.toISOString() ?? null,
    verifiedBy: name(p.verifiedBy),
    rejectedAt: p.rejectedAt?.toISOString() ?? null,
    rejectedBy: name(p.rejectedBy),
    rejectionReason: p.rejectionReason,
    refundedAmount: money(p.refundedAmount),
    refundedAt: p.refundedAt?.toISOString() ?? null,
    refundedBy: name(p.refundedBy),
    refundReason: p.refundReason,
    createdAt: p.createdAt.toISOString(),
  };
}

function scope(p: Principal): Prisma.PaymentWhereInput {
  if (!hasPermission(p, "payments.view")) throw AppError.forbidden();
  return { organizationId: p.organizationId };
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

function paymentsWhere(p: Principal, q: Partial<ListPaymentsQuery>): Prisma.PaymentWhereInput {
  const tz = p.organization.timezone;
  return {
    ...scope(p),
    ...(q.status?.length ? { status: { in: q.status } } : {}),
    ...(q.method ? { method: q.method } : {}),
    ...(q.bookingId ? { bookingId: q.bookingId } : {}),
    ...(q.from || q.to
      ? {
          createdAt: {
            ...(q.from ? { gte: DateTime.fromISO(q.from, { zone: tz }).toJSDate() } : {}),
            ...(q.to ? { lt: DateTime.fromISO(q.to, { zone: tz }).plus({ days: 1 }).toJSDate() } : {}),
          },
        }
      : {}),
    ...(q.search
      ? {
          OR: [
            { paymentNumber: { contains: q.search, mode: "insensitive" } },
            { reference: { contains: q.search, mode: "insensitive" } },
            { booking: { bookingNumber: { contains: q.search, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
}

export async function listPayments(p: Principal, q: ListPaymentsQuery) {
  const where = paymentsWhere(p, q);
  const [total, rows] = await prisma.$transaction([
    prisma.payment.count({ where }),
    prisma.payment.findMany({ where, include: paymentInclude, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
  ]);
  return { items: rows.map(toPaymentDto), total, page: q.page, pageSize: q.pageSize };
}

export async function getPayment(p: Principal, id: string): Promise<PaymentDto> {
  const row = await prisma.payment.findFirst({ where: { id, ...scope(p) }, include: paymentInclude });
  if (!row) throw AppError.notFound("Payment");
  return toPaymentDto(row);
}

// ---------------------------------------------------------------------------
// Mark submitted: proof arrived, not yet verified
// ---------------------------------------------------------------------------

export async function markSubmitted(p: Principal, id: string, input: MarkSubmittedInput, ctx: AuditContext): Promise<PaymentDto> {
  if (!hasPermission(p, "payments.verify")) throw AppError.forbidden();
  await prisma.$transaction(async (tx) => {
    const pay = await tx.payment.findFirst({ where: { id, organizationId: p.organizationId } });
    if (!pay) throw AppError.notFound("Payment");
    if (pay.status !== "PENDING" || !pay.bookingId) throw AppError.badRequest("Only a pending payment can be marked as submitted");
    const booking = await tx.booking.findUniqueOrThrow({ where: { id: pay.bookingId } });
    if (booking.status !== "PENDING_PAYMENT") {
      throw AppError.badRequest(`A ${booking.status.toLowerCase().replaceAll("_", " ")} booking cannot be updated this way`);
    }
    await tx.payment.update({ where: { id }, data: { submittedAt: new Date(), reference: input.reference ?? pay.reference } });
    const moved = await tx.appointment.updateMany({ where: { bookingId: booking.id, rescheduledTo: null, status: "PENDING_PAYMENT" }, data: { status: "PAYMENT_SUBMITTED" } });
    if (moved.count !== 1) throw AppError.conflict("This booking was just changed by someone else. Refresh and try again.");
    await tx.booking.update({ where: { id: booking.id }, data: { status: "PAYMENT_SUBMITTED" } });
    await recordAudit(tx, ctx, { action: "payment.mark_submitted", entityType: "payment", entityId: id, newValues: input });
  });
  return getPayment(p, id);
}

// ---------------------------------------------------------------------------
// Verify: PENDING/PAYMENT_SUBMITTED booking → CONFIRMED (or PAYMENT_VERIFIED
// if auto-confirm is off); posts the INCOME ledger row.
// ---------------------------------------------------------------------------

export async function verifyPayment(p: Principal, id: string, input: VerifyPaymentInput, ctx: AuditContext): Promise<PaymentDto> {
  if (!hasPermission(p, "payments.verify")) throw AppError.forbidden();
  await assertPrivateFile(prisma, p.organizationId, input.proofFileId, "proofFileId");
  const now = new Date();
  await withTxRetry(() =>
    prisma.$transaction(async (tx) => {
      const pay = await tx.payment.findFirst({ where: { id, organizationId: p.organizationId } });
      if (!pay) throw AppError.notFound("Payment");
      if (pay.status !== "PENDING" || !pay.bookingId) throw AppError.badRequest("Only a pending payment can be verified");
      const booking = await tx.booking.findUniqueOrThrow({ where: { id: pay.bookingId } });
      if (booking.status !== "PENDING_PAYMENT" && booking.status !== "PAYMENT_SUBMITTED") {
        throw AppError.badRequest(`A ${booking.status.toLowerCase().replaceAll("_", " ")} booking cannot be verified`);
      }
      const { autoConfirmOnVerify } = await getOrgSettings(p.organizationId);
      const bookingStatus = autoConfirmOnVerify ? "CONFIRMED" : "PAYMENT_VERIFIED";
      const confirmedAt = autoConfirmOnVerify ? now : null;

      await tx.payment.update({
        where: { id },
        data: {
          status: "VERIFIED",
          method: input.method,
          reference: input.reference ?? pay.reference,
          proofFileId: input.proofFileId ?? pay.proofFileId,
          verifiedAt: now,
          verifiedById: p.userId,
        },
      });
      const moved = await tx.appointment.updateMany({
        where: { bookingId: booking.id, rescheduledTo: null, status: booking.status },
        data: { status: bookingStatus, paymentStatus: "VERIFIED", confirmedAt },
      });
      if (moved.count !== 1) throw AppError.conflict("This booking was just changed by someone else. Refresh and try again.");
      await tx.booking.update({
        where: { id: booking.id },
        data: { status: bookingStatus, paymentStatus: "VERIFIED", amountPaid: { increment: pay.amount }, confirmedAt },
      });

      await postLedgerEntry(tx, {
        organizationId: p.organizationId,
        orgTimezone: p.organization.timezone,
        type: "INCOME",
        amount: pay.amount,
        currency: pay.currency,
        paymentMethod: input.method,
        categorySlug: "appointments",
        bookingId: booking.id,
        paymentId: pay.id,
        customerId: pay.customerId,
        reference: pay.paymentNumber,
        notes: `Payment for ${booking.bookingNumber}`,
        transactionDate: now,
        createdById: p.userId,
      });
      if (pay.invoiceId) await recomputeInvoice(tx, pay.invoiceId, now);
      await recordAudit(tx, ctx, { action: "payment.verify", entityType: "payment", entityId: id, newValues: { ...input, bookingStatus } });
      // Only when this verification confirms the booking outright — with autoConfirmOnVerify off,
      // it stops at PAYMENT_VERIFIED and the later staff confirm() sends this email instead.
      if (bookingStatus === "CONFIRMED") {
        await queueNotifications(tx, { templateKey: "BOOKING_CONFIRMED", bookingId: booking.id, audiences: ["CUSTOMER", "PROVIDER"] });
      }
    }, BOOKING_TX_OPTIONS),
  );
  return getPayment(p, id);
}

// ---------------------------------------------------------------------------
// Reject: booking goes back to PENDING_PAYMENT with a fresh PENDING payment
// so the customer can pay again.
// ---------------------------------------------------------------------------

export async function rejectPayment(p: Principal, id: string, input: RejectPaymentInput, ctx: AuditContext): Promise<PaymentDto> {
  if (!hasPermission(p, "payments.verify")) throw AppError.forbidden();
  const now = new Date();
  await withTxRetry(() =>
    prisma.$transaction(async (tx) => {
      const pay = await tx.payment.findFirst({ where: { id, organizationId: p.organizationId } });
      if (!pay) throw AppError.notFound("Payment");
      if (pay.status !== "PENDING" || !pay.bookingId) throw AppError.badRequest("Only a pending payment can be rejected");
      const booking = await tx.booking.findUniqueOrThrow({ where: { id: pay.bookingId } });
      if (booking.status !== "PENDING_PAYMENT" && booking.status !== "PAYMENT_SUBMITTED") {
        throw AppError.badRequest(`A ${booking.status.toLowerCase().replaceAll("_", " ")} booking cannot be rejected`);
      }
      await tx.payment.update({ where: { id }, data: { status: "REJECTED", rejectedAt: now, rejectedById: p.userId, rejectionReason: input.reason } });
      const moved = await tx.appointment.updateMany({
        where: { bookingId: booking.id, rescheduledTo: null, status: booking.status },
        data: { status: "PENDING_PAYMENT", paymentStatus: "PENDING" },
      });
      if (moved.count !== 1) throw AppError.conflict("This booking was just changed by someone else. Refresh and try again.");
      await tx.booking.update({ where: { id: booking.id }, data: { status: "PENDING_PAYMENT", paymentStatus: "PENDING" } });

      const paymentNumber = await nextDocumentNumber(tx, p.organizationId, "PAY", DateTime.now().setZone(p.organization.timezone).year);
      await tx.payment.create({
        data: {
          organizationId: p.organizationId,
          paymentNumber,
          bookingId: booking.id,
          customerId: pay.customerId,
          status: "PENDING",
          amount: pay.amount,
          currency: pay.currency,
        },
      });
      await recordAudit(tx, ctx, { action: "payment.reject", entityType: "payment", entityId: id, newValues: { reason: input.reason } });
      // occurrence: this payment's id, so a booking rejected more than once emails each time.
      await queueNotifications(tx, { templateKey: "PAYMENT_REJECTED", bookingId: booking.id, audiences: ["CUSTOMER"], occurrence: pay.id });
    }, BOOKING_TX_OPTIONS),
  );
  return getPayment(p, id);
}

// ---------------------------------------------------------------------------
// Refund: up to (amount − already refunded) of a verified payment.
// ---------------------------------------------------------------------------

export async function refundPayment(p: Principal, id: string, input: RefundPaymentInput, ctx: AuditContext): Promise<PaymentDto> {
  if (!hasPermission(p, "payments.refund")) throw AppError.forbidden();
  const amount = D(input.amount);
  const now = new Date();
  await withTxRetry(() =>
    prisma.$transaction(async (tx) => {
      const pay = await tx.payment.findFirst({ where: { id, organizationId: p.organizationId } });
      if (!pay) throw AppError.notFound("Payment");
      if (pay.status !== "VERIFIED") throw AppError.badRequest("Only a verified payment can be refunded");
      const refundable = pay.amount.minus(pay.refundedAmount);
      if (amount.gt(refundable)) throw AppError.validation([{ path: "amount", message: `At most ${refundable.toFixed(2)} can be refunded` }]);
      const refundedAmount = pay.refundedAmount.plus(amount);
      const fullyRefunded = refundedAmount.gte(pay.amount);
      const moved = await tx.payment.updateMany({
        where: { id, refundedAmount: pay.refundedAmount },
        data: { refundedAmount, refundedAt: now, refundedById: p.userId, refundReason: input.reason, status: fullyRefunded ? "REFUNDED" : "VERIFIED" },
      });
      if (moved.count !== 1) throw AppError.conflict("The payment changed meanwhile. Refresh and try again.");

      if (pay.bookingId) {
        const booking = await tx.booking.findUniqueOrThrow({ where: { id: pay.bookingId } });
        const amountPaid = Prisma.Decimal.max(booking.amountPaid.minus(amount), ZERO);
        await tx.booking.update({ where: { id: booking.id }, data: { amountPaid, ...(fullyRefunded ? { paymentStatus: "REFUNDED" } : {}) } });
      }
      if (pay.invoiceId) await recomputeInvoice(tx, pay.invoiceId, now);

      await postLedgerEntry(tx, {
        organizationId: p.organizationId,
        orgTimezone: p.organization.timezone,
        type: "REFUND",
        amount,
        currency: pay.currency,
        paymentMethod: pay.method,
        bookingId: pay.bookingId,
        paymentId: pay.id,
        customerId: pay.customerId,
        reference: pay.paymentNumber,
        notes: `Refund of ${pay.paymentNumber}`,
        transactionDate: now,
        createdById: p.userId,
      });
      await recordAudit(tx, ctx, { action: "payment.refund", entityType: "payment", entityId: id, newValues: { amount: amount.toFixed(2), reason: input.reason } });
    }, BOOKING_TX_OPTIONS),
  );
  return getPayment(p, id);
}

// ---------------------------------------------------------------------------
// Delete: only PENDING/REJECTED, never once a payment has posted ledger history.
// ---------------------------------------------------------------------------

export async function deletePayment(p: Principal, id: string, ctx: AuditContext): Promise<void> {
  if (!hasPermission(p, "payments.delete")) throw AppError.forbidden();
  await prisma.$transaction(async (tx) => {
    const pay = await tx.payment.findFirst({ where: { id, organizationId: p.organizationId }, include: paymentInclude });
    if (!pay) throw AppError.notFound("Payment");
    if (pay.status === "VERIFIED" || pay.status === "REFUNDED") {
      throw AppError.conflict("This payment has ledger history (verified or refunded). Reject it instead, or refund it first.");
    }
    await tx.payment.delete({ where: { id } });
    await recordAudit(tx, ctx, { action: "payment.delete", entityType: "payment", entityId: id, oldValues: toPaymentDto(pay) });
  });
}

export async function exportPaymentsCsv(p: Principal, q: Partial<ListPaymentsQuery>): Promise<string> {
  const tz = p.organization.timezone;
  const rows = await prisma.payment.findMany({ where: paymentsWhere(p, q), include: paymentInclude, orderBy: { createdAt: "desc" }, take: 50_000 });
  const header = ["Reference", "Booking", "Customer", "Status", "Method", "Amount", "Currency", "Refunded", "Received"];
  return toCsv(
    header,
    rows.map((r) => [
      r.paymentNumber,
      r.booking?.bookingNumber ?? "",
      r.customer ? name(r.customer) : "",
      r.status,
      r.method ?? "",
      r.amount.toFixed(2),
      r.currency,
      r.refundedAmount.toFixed(2),
      DateTime.fromJSDate(r.createdAt, { zone: tz }).toFormat("yyyy-LL-dd HH:mm"),
    ]),
  );
}
