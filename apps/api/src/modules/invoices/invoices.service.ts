/**
 * Invoices (Phase 6): a billing document for a booking or for a customer
 * directly, separate from the Payment record. Raising an invoice from a
 * booking is idempotent — the booking's existing (non-void) invoice, if any,
 * is returned unchanged. Only staff have accounts, so every read here is
 * staff-only (no customer self-view, unlike the general-purpose app this was
 * adapted from).
 */
import { DateTime } from "luxon";
import type { CreateInvoiceInput, CreatePayslipInput, InvoiceDto, InvoiceFromBookingInput, ListInvoicesQuery } from "@booking/shared";
import { prisma, type DbClient } from "../../lib/prisma.js";
import { nextDocumentNumber } from "../../lib/document-sequence.js";
import { getOrgSettings } from "../../lib/settings.js";
import { Prisma } from "../../generated/prisma/client.js";
import { AppError } from "../../utils/app-error.js";
import { toCsv } from "../../utils/csv.js";
import { dateOnly, money, parseDateOnly } from "../../utils/serialize.js";
import { recordAudit, type AuditContext } from "../audit/audit.service.js";
import { hasPermission } from "../auth/permission-rules.js";
import type { Principal } from "../auth/principal.service.js";
import { postLedgerEntry } from "../finance/ledger.js";
import { ZERO, priceLine, sumLines } from "../finance/money.js";
import { invoiceStatus } from "../finance/money.js";

export const invoiceInclude = {
  customer: { select: { id: true, customerNumber: true, firstName: true, lastName: true, email: true, phone: true } },
  provider: { select: { id: true, displayName: true, providerType: true } },
  booking: { select: { id: true, bookingNumber: true } },
  items: { orderBy: { sortOrder: "asc" as const } },
  payments: { where: { status: { in: ["VERIFIED", "REFUNDED"] as const } }, orderBy: { verifiedAt: "asc" as const } },
} as const satisfies Prisma.InvoiceInclude;
export type InvoiceRow = Prisma.InvoiceGetPayload<{ include: typeof invoiceInclude }>;

export function toInvoiceDto(i: InvoiceRow): InvoiceDto {
  return {
    id: i.id,
    invoiceNumber: i.invoiceNumber,
    audience: i.audience,
    status: i.status,
    customer: i.customer
      ? {
          id: i.customer.id,
          name: [i.customer.firstName, i.customer.lastName].filter(Boolean).join(" "),
          customerNumber: i.customer.customerNumber,
          email: i.customer.email,
          phone: i.customer.phone,
        }
      : null,
    provider: i.provider ? { id: i.provider.id, displayName: i.provider.displayName, providerType: i.provider.providerType } : null,
    booking: i.booking,
    currency: i.currency,
    subtotal: money(i.subtotal),
    discountAmount: money(i.discountAmount),
    taxAmount: money(i.taxAmount),
    totalAmount: money(i.totalAmount),
    amountPaid: money(i.amountPaid),
    amountDue: money(i.amountDue),
    issueDate: dateOnly(i.issueDate)!,
    dueDate: dateOnly(i.dueDate),
    notes: i.notes,
    items: i.items.map((it) => ({
      id: it.id,
      description: it.description,
      quantity: it.quantity.toFixed(2).replace(/\.00$/, ""),
      unitPrice: money(it.unitPrice),
      discountAmount: money(it.discountAmount),
      taxRatePercent: it.taxRatePercent.toFixed(2),
      taxAmount: money(it.taxAmount),
      totalAmount: money(it.totalAmount),
    })),
    payments: i.payments.map((p) => ({
      id: p.id,
      paymentNumber: p.paymentNumber,
      amount: money(p.amount.minus(p.refundedAmount)),
      method: p.method,
      status: p.status,
      verifiedAt: p.verifiedAt?.toISOString() ?? null,
    })),
    issuedAt: i.issuedAt?.toISOString() ?? null,
    voidedAt: i.voidedAt?.toISOString() ?? null,
    createdAt: i.createdAt.toISOString(),
  };
}

function scope(p: Principal): Prisma.InvoiceWhereInput {
  if (!hasPermission(p, "invoices.view")) throw AppError.forbidden();
  return { organizationId: p.organizationId };
}

export async function loadInvoice(db: DbClient, p: Principal, id: string): Promise<InvoiceRow> {
  const row = await db.invoice.findFirst({ where: { id, ...scope(p) }, include: invoiceInclude });
  if (!row) throw AppError.notFound("Invoice");
  return row;
}

function invoicesWhere(p: Principal, q: Partial<ListInvoicesQuery>): Prisma.InvoiceWhereInput {
  return {
    AND: [
      scope(p),
      q.status ? { status: q.status } : {},
      q.audience ? { audience: q.audience } : {},
      q.customerId ? { customerId: q.customerId } : {},
      q.providerId ? { providerId: q.providerId } : {},
      q.from ? { issueDate: { gte: parseDateOnly(q.from) } } : {},
      q.to ? { issueDate: { lte: parseDateOnly(q.to) } } : {},
      q.search
        ? {
            OR: [
              { invoiceNumber: { contains: q.search, mode: "insensitive" } },
              { booking: { bookingNumber: { contains: q.search, mode: "insensitive" } } },
              { customer: { firstName: { contains: q.search, mode: "insensitive" } } },
              { customer: { customerNumber: { contains: q.search, mode: "insensitive" } } },
            ],
          }
        : {},
    ],
  };
}

export async function listInvoices(p: Principal, q: ListInvoicesQuery) {
  const where = invoicesWhere(p, q);
  const [total, rows] = await prisma.$transaction([
    prisma.invoice.count({ where }),
    prisma.invoice.findMany({ where, include: invoiceInclude, orderBy: [{ issueDate: "desc" }, { invoiceNumber: "desc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
  ]);
  return { items: rows.map(toInvoiceDto), total, page: q.page, pageSize: q.pageSize };
}

export async function getInvoice(p: Principal, id: string): Promise<InvoiceDto> {
  return toInvoiceDto(await loadInvoice(prisma, p, id));
}

const today = (tz: string) => DateTime.now().setZone(tz).toISODate()!;

/** Recomputes an invoice's paid/due/status from its payments (net of refunds). Call after any payment change. */
export async function recomputeInvoice(db: DbClient, invoiceId: string, now = new Date()): Promise<void> {
  const inv = await db.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: { payments: { where: { status: { in: ["VERIFIED", "REFUNDED"] } }, select: { amount: true, refundedAmount: true } } },
  });
  const paid = inv.payments.reduce((sum, p) => sum.plus(p.amount).minus(p.refundedAmount), ZERO);
  const due = Prisma.Decimal.max(inv.totalAmount.minus(paid), ZERO);
  await db.invoice.update({
    where: { id: invoiceId },
    data: { amountPaid: paid, amountDue: due, status: invoiceStatus(inv.status, inv.totalAmount, paid, inv.dueDate, now) },
  });
}

/** The active (issued, not void/draft) invoice of a booking, if any. */
export async function activeInvoiceId(db: DbClient, bookingId: string): Promise<string | null> {
  const inv = await db.invoice.findFirst({ where: { bookingId, status: { notIn: ["VOID", "DRAFT"] } }, select: { id: true } });
  return inv?.id ?? null;
}

/** Invoice for a booking, built from its appointment's snapshot price. Idempotent: returns the existing one. */
export async function invoiceFromBooking(p: Principal, input: InvoiceFromBookingInput, ctx: AuditContext): Promise<InvoiceDto> {
  if (!hasPermission(p, "invoices.create")) throw AppError.forbidden();
  const tz = p.organization.timezone;
  const dueDays = (await getOrgSettings(p.organizationId)).invoiceDefaultDueDays;
  const id = await prisma.$transaction(async (tx) => {
    const existing = await tx.invoice.findFirst({ where: { bookingId: input.bookingId, organizationId: p.organizationId, status: { not: "VOID" } }, select: { id: true } });
    if (existing) return existing.id;
    const b = await tx.booking.findFirst({
      where: { id: input.bookingId, organizationId: p.organizationId, type: "APPOINTMENT" },
      include: {
        appointments: {
          where: { rescheduledTo: null },
          include: { service: { select: { id: true, name: true } }, provider: { select: { displayName: true } } },
        },
      },
    });
    if (!b) throw AppError.notFound("Booking");
    if (b.status === "CANCELLED") throw AppError.badRequest("Cannot invoice a cancelled booking");
    const appointment = b.appointments[0];
    if (!appointment) throw AppError.badRequest("This booking has nothing to invoice");

    const net = appointment.price.minus(appointment.discountAmount);
    const items: Prisma.InvoiceItemCreateWithoutInvoiceInput[] = [
      {
        description: `${appointment.service.name} with ${appointment.provider.displayName}, ${DateTime.fromJSDate(appointment.startsAt, { zone: appointment.timezone }).toFormat("d LLL yyyy HH:mm")}`,
        quantity: 1,
        unitPrice: appointment.price,
        discountAmount: appointment.discountAmount,
        taxRatePercent: 0,
        taxAmount: 0,
        totalAmount: net,
        service: { connect: { id: appointment.service.id } },
      },
    ];

    const issueDate = today(tz);
    const inv = await tx.invoice.create({
      data: {
        organizationId: p.organizationId,
        invoiceNumber: await nextDocumentNumber(tx, p.organizationId, "INV", DateTime.now().setZone(tz).year),
        customerId: b.customerId,
        bookingId: b.id,
        status: "ISSUED",
        currency: b.currency,
        subtotal: b.subtotal,
        discountAmount: b.discountAmount,
        taxAmount: 0,
        totalAmount: b.totalAmount,
        amountPaid: 0,
        amountDue: b.totalAmount,
        issueDate: parseDateOnly(issueDate),
        dueDate: parseDateOnly(input.dueDate ?? DateTime.fromISO(issueDate).plus({ days: dueDays }).toISODate()!),
        notes: input.notes ?? null,
        issuedAt: new Date(),
        createdById: p.userId,
        items: { create: items.map((it, i) => ({ ...it, sortOrder: i })) },
      },
    });
    // Payments already received for the booking count towards the invoice.
    await tx.payment.updateMany({ where: { bookingId: b.id, invoiceId: null }, data: { invoiceId: inv.id } });
    await recomputeInvoice(tx, inv.id);
    await recordAudit(tx, ctx, { action: "invoice.create_from_booking", entityType: "invoice", entityId: inv.id, newValues: { bookingId: b.id, total: b.totalAmount.toFixed(2) } });
    return inv.id;
  });
  return getInvoice(p, id);
}

export async function createInvoice(p: Principal, input: CreateInvoiceInput, ctx: AuditContext): Promise<InvoiceDto> {
  if (!hasPermission(p, "invoices.create")) throw AppError.forbidden();
  const tz = p.organization.timezone;
  const dueDays = (await getOrgSettings(p.organizationId)).invoiceDefaultDueDays;
  const customer = await prisma.customer.findFirst({ where: { id: input.customerId, organizationId: p.organizationId }, select: { id: true } });
  if (!customer) throw AppError.validation([{ path: "customerId", message: "Customer not found" }]);
  const lines = input.items.map((it) => ({ it, priced: priceLine(it) }));
  const totals = sumLines(lines.map((l) => l.priced));
  const id = await prisma.$transaction(async (tx) => {
    const issueDate = today(tz);
    const inv = await tx.invoice.create({
      data: {
        organizationId: p.organizationId,
        invoiceNumber: await nextDocumentNumber(tx, p.organizationId, "INV", DateTime.now().setZone(tz).year),
        customerId: input.customerId,
        status: input.issue ? "ISSUED" : "DRAFT",
        currency: p.organization.currency,
        subtotal: totals.subtotal,
        discountAmount: totals.discount,
        taxAmount: totals.tax,
        totalAmount: totals.total,
        amountPaid: 0,
        amountDue: totals.total,
        issueDate: parseDateOnly(issueDate),
        dueDate: input.dueDate
          ? parseDateOnly(input.dueDate)
          : input.issue
            ? parseDateOnly(DateTime.fromISO(issueDate).plus({ days: dueDays }).toISODate()!)
            : null,
        notes: input.notes ?? null,
        issuedAt: input.issue ? new Date() : null,
        createdById: p.userId,
        items: {
          create: lines.map(({ it, priced }, i) => ({
            description: it.description,
            quantity: it.quantity,
            unitPrice: it.unitPrice,
            discountAmount: priced.discount,
            taxRatePercent: priced.rate,
            taxAmount: priced.tax,
            totalAmount: priced.total,
            sortOrder: i,
          })),
        },
      },
    });
    await recordAudit(tx, ctx, { action: "invoice.create", entityType: "invoice", entityId: inv.id, newValues: { total: totals.total.toFixed(2), items: input.items.length } });
    return inv.id;
  });
  return getInvoice(p, id);
}

/** Provider pay-slips post an EXPENSE ledger row when issued (category "Salaries", seeded for every org) — customer invoices never touch the ledger. */
async function postPayslipLedgerEntry(
  tx: DbClient,
  p: Principal,
  opts: { invoiceNumber: string; amount: Prisma.Decimal; currency: string; providerName: string },
): Promise<void> {
  await postLedgerEntry(tx, {
    organizationId: p.organizationId,
    orgTimezone: p.organization.timezone,
    type: "EXPENSE",
    amount: opts.amount,
    currency: opts.currency,
    categorySlug: "salaries",
    reference: opts.invoiceNumber,
    notes: `Payout - ${opts.providerName}`,
    transactionDate: new Date(),
    createdById: p.userId,
  });
}

/** A therapist/counsellor pay-slip: one manually-entered amount, same document machinery as a customer invoice, own audience/branding. */
export async function createPayslip(p: Principal, input: CreatePayslipInput, ctx: AuditContext): Promise<InvoiceDto> {
  if (!hasPermission(p, "invoices.create")) throw AppError.forbidden();
  const tz = p.organization.timezone;
  const dueDays = (await getOrgSettings(p.organizationId)).invoiceDefaultDueDays;
  const provider = await prisma.providerProfile.findFirst({ where: { id: input.providerId, organizationId: p.organizationId, deletedAt: null }, select: { id: true, displayName: true } });
  if (!provider) throw AppError.validation([{ path: "providerId", message: "Provider not found" }]);
  const amount = new Prisma.Decimal(input.amount);
  const id = await prisma.$transaction(async (tx) => {
    const issueDate = today(tz);
    const inv = await tx.invoice.create({
      data: {
        organizationId: p.organizationId,
        invoiceNumber: await nextDocumentNumber(tx, p.organizationId, "PSL", DateTime.now().setZone(tz).year),
        audience: "PROVIDER",
        providerId: input.providerId,
        status: input.issue ? "ISSUED" : "DRAFT",
        currency: p.organization.currency,
        subtotal: amount,
        discountAmount: 0,
        taxAmount: 0,
        totalAmount: amount,
        amountPaid: 0,
        amountDue: amount,
        issueDate: parseDateOnly(issueDate),
        dueDate: input.dueDate
          ? parseDateOnly(input.dueDate)
          : input.issue
            ? parseDateOnly(DateTime.fromISO(issueDate).plus({ days: dueDays }).toISODate()!)
            : null,
        notes: input.notes ?? null,
        issuedAt: input.issue ? new Date() : null,
        createdById: p.userId,
        items: {
          create: [
            { description: input.description, quantity: 1, unitPrice: amount, discountAmount: 0, taxRatePercent: 0, taxAmount: 0, totalAmount: amount, sortOrder: 0 },
          ],
        },
      },
    });
    if (input.issue) {
      await postPayslipLedgerEntry(tx, p, { invoiceNumber: inv.invoiceNumber, amount, currency: p.organization.currency, providerName: provider.displayName });
    }
    await recordAudit(tx, ctx, {
      action: "invoice.create_payslip",
      entityType: "invoice",
      entityId: inv.id,
      newValues: { providerId: input.providerId, amount: amount.toFixed(2), issued: input.issue },
    });
    return inv.id;
  });
  return getInvoice(p, id);
}

export async function issueInvoice(p: Principal, id: string, ctx: AuditContext): Promise<InvoiceDto> {
  if (!hasPermission(p, "invoices.update")) throw AppError.forbidden();
  await prisma.$transaction(async (tx) => {
    const inv = await loadInvoice(tx, p, id);
    if (inv.status !== "DRAFT") throw AppError.badRequest("Only draft invoices can be issued");
    await tx.invoice.update({ where: { id }, data: { status: "ISSUED", issuedAt: new Date(), issueDate: parseDateOnly(today(p.organization.timezone)) } });
    await recomputeInvoice(tx, id);
    if (inv.audience === "PROVIDER" && inv.provider) {
      await postPayslipLedgerEntry(tx, p, { invoiceNumber: inv.invoiceNumber, amount: inv.totalAmount, currency: inv.currency, providerName: inv.provider.displayName });
    }
    await recordAudit(tx, ctx, { action: "invoice.issue", entityType: "invoice", entityId: id });
  });
  return getInvoice(p, id);
}

export async function voidInvoice(p: Principal, id: string, reason: string, ctx: AuditContext): Promise<InvoiceDto> {
  if (!hasPermission(p, "invoices.void")) throw AppError.forbidden();
  await prisma.$transaction(async (tx) => {
    const inv = await loadInvoice(tx, p, id);
    if (inv.status === "VOID") return;
    const netPaid = inv.payments.reduce((s, x) => s.plus(x.amount).minus(x.refundedAmount), ZERO);
    if (netPaid.gt(0)) throw AppError.badRequest("Refund the payments on this invoice before voiding it");
    await tx.invoice.update({ where: { id }, data: { status: "VOID", voidedAt: new Date(), notes: [inv.notes, `Voided: ${reason}`].filter(Boolean).join("\n") } });
    await tx.payment.updateMany({ where: { invoiceId: id }, data: { invoiceId: null } });
    await recordAudit(tx, ctx, { action: "invoice.void", entityType: "invoice", entityId: id, newValues: { reason } });
  });
  return getInvoice(p, id);
}

export async function exportInvoicesCsv(p: Principal, q: Partial<ListInvoicesQuery>): Promise<string> {
  if (!hasPermission(p, "invoices.view")) throw AppError.forbidden();
  const rows = await prisma.invoice.findMany({ where: invoicesWhere(p, q), include: invoiceInclude, orderBy: [{ issueDate: "desc" }, { invoiceNumber: "desc" }], take: 50_000 });
  const header = ["Number", "Audience", "Billed to", "Booking", "Status", "Subtotal", "Discount", "Tax", "Total", "Paid", "Due", "Currency", "Issue date", "Due date"];
  return toCsv(
    header,
    rows.map((i) => [
      i.invoiceNumber,
      i.audience,
      i.customer ? [i.customer.firstName, i.customer.lastName].filter(Boolean).join(" ") : (i.provider?.displayName ?? ""),
      i.booking?.bookingNumber ?? "",
      i.status,
      i.subtotal.toFixed(2),
      i.discountAmount.toFixed(2),
      i.taxAmount.toFixed(2),
      i.totalAmount.toFixed(2),
      i.amountPaid.toFixed(2),
      i.amountDue.toFixed(2),
      i.currency,
      dateOnly(i.issueDate) ?? "",
      i.dueDate ? (dateOnly(i.dueDate) ?? "") : "",
    ]),
  );
}
