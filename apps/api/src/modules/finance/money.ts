import type { InvoiceStatus } from "@booking/shared";
import { Prisma } from "../../generated/prisma/client.js";

type Dec = Prisma.Decimal;
/** Anything Decimal.js accepts: numbers, numeric strings or Decimals. */
export type DecValue = string | number | Prisma.Decimal;
export const D = (v: DecValue) => new Prisma.Decimal(v);
export const ZERO = D(0);

/** Invoice status; DRAFT and VOID are only changed by explicit actions. */
export function invoiceStatus(current: InvoiceStatus, total: Dec, paid: Dec, dueDate: Date | null, now = new Date()): InvoiceStatus {
  if (current === "DRAFT" || current === "VOID") return current;
  if (paid.gte(total)) return "PAID";
  if (dueDate && dueDate.getTime() + 86_400_000 <= now.getTime()) return "OVERDUE";
  return paid.gt(0) ? "PARTIALLY_PAID" : "ISSUED";
}

export interface LineInput {
  quantity: DecValue;
  unitPrice: DecValue;
  discountAmount?: DecValue;
  taxRatePercent?: DecValue;
}

/** One invoice line: (qty × price − discount) + tax on the net, rounded half-up to 2 dp. */
export function priceLine(l: LineInput) {
  const gross = D(l.quantity).times(D(l.unitPrice)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const discount = Prisma.Decimal.min(D(l.discountAmount ?? 0), gross);
  const net = gross.minus(discount);
  const rate = D(l.taxRatePercent ?? 0);
  const tax = net.times(rate).dividedBy(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  return { gross, discount, tax, rate, total: net.plus(tax) };
}

export function sumLines(lines: ReturnType<typeof priceLine>[]) {
  return lines.reduce(
    (acc, l) => ({
      subtotal: acc.subtotal.plus(l.gross),
      discount: acc.discount.plus(l.discount),
      tax: acc.tax.plus(l.tax),
      total: acc.total.plus(l.total),
    }),
    { subtotal: ZERO, discount: ZERO, tax: ZERO, total: ZERO },
  );
}
