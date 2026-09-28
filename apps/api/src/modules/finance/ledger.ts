import { DateTime } from "luxon";
import type { PaymentMethod } from "@booking/shared";
import type { DbClient } from "../../lib/prisma.js";
import { nextDocumentNumber } from "../../lib/document-sequence.js";
import type { FinanceTransactionType, Prisma } from "../../generated/prisma/client.js";

export interface LedgerEntry {
  organizationId: string;
  orgTimezone: string;
  type: FinanceTransactionType;
  amount: Prisma.Decimal;
  currency: string;
  paymentMethod?: PaymentMethod | null;
  /** Finance category by slug (e.g. "appointments") or id. */
  categorySlug?: string;
  categoryId?: string | null;
  bookingId?: string | null;
  paymentId?: string | null;
  expenseId?: string | null;
  customerId?: string | null;
  reference?: string | null;
  notes?: string | null;
  transactionDate: Date;
  createdById: string | null;
}

/**
 * Posts one ledger row. Every money movement goes through here so the ledger
 * is complete: payments (INCOME), refunds (REFUND), paid expenses (EXPENSE)
 * and manual adjustments. Rows are never deleted — only voided.
 */
export async function postLedgerEntry(db: DbClient, e: LedgerEntry): Promise<string> {
  let categoryId = e.categoryId ?? null;
  if (!categoryId && e.categorySlug) {
    const type = e.type === "EXPENSE" ? "EXPENSE" : "INCOME";
    const cat = await db.financeCategory.findFirst({
      where: { organizationId: e.organizationId, type, slug: e.categorySlug },
      select: { id: true },
    });
    categoryId = cat?.id ?? null;
  }
  const year = DateTime.fromJSDate(e.transactionDate, { zone: e.orgTimezone }).year;
  const row = await db.financeTransaction.create({
    data: {
      organizationId: e.organizationId,
      transactionNumber: await nextDocumentNumber(db, e.organizationId, "TXN", year),
      type: e.type,
      categoryId,
      amount: e.amount,
      currency: e.currency,
      paymentMethod: e.paymentMethod ?? null,
      reference: e.reference ?? null,
      bookingId: e.bookingId ?? null,
      paymentId: e.paymentId ?? null,
      expenseId: e.expenseId ?? null,
      customerId: e.customerId ?? null,
      status: "POSTED",
      notes: e.notes ?? null,
      transactionDate: e.transactionDate,
      createdById: e.createdById,
    },
    select: { id: true },
  });
  return row.id;
}
