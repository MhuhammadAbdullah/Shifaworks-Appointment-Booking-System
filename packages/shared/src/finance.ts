/**
 * Payment verification, invoices and finance (Phase 6). Payments here are
 * always manual: a Payment row is created PENDING alongside a booking
 * (booking-engine.ts) and staff verify it after the customer sends proof —
 * there is no gateway, no webhook, no online checkout (docs/ARCHITECTURE.md
 * §0, §5). Only staff have accounts, so every list/detail here is staff-only.
 */
import { z } from "zod";
import {
  EXPENSE_STATUSES,
  FINANCE_CATEGORY_TYPES,
  FINANCE_TX_STATUSES,
  FINANCE_TX_TYPES,
  INVOICE_AUDIENCES,
  INVOICE_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  type ExpenseStatus,
  type FinanceCategoryType,
  type FinanceTxStatus,
  type FinanceTxType,
  type InvoiceAudience,
  type InvoiceStatus,
  type PaymentMethod,
  type PaymentStatus,
  type ProviderType,
} from "./enums.js";
import { moneySchema, multiEnumQuery, optionalText, paginationQuerySchema, percentSchema, type MoneyString } from "./validation.js";

const isoDate = z.iso.date("Use YYYY-MM-DD");

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export interface PaymentDto {
  id: string;
  paymentNumber: string;
  booking: { id: string; bookingNumber: string } | null;
  invoice: { id: string; invoiceNumber: string } | null;
  customer: { id: string; name: string; customerNumber: string } | null;
  status: PaymentStatus;
  method: PaymentMethod | null;
  amount: MoneyString;
  currency: string;
  reference: string | null;
  proofFileId: string | null;
  notes: string | null;
  submittedAt: string | null;
  verifiedAt: string | null;
  verifiedBy: string | null;
  rejectedAt: string | null;
  rejectedBy: string | null;
  rejectionReason: string | null;
  refundedAmount: MoneyString;
  refundedAt: string | null;
  refundedBy: string | null;
  refundReason: string | null;
  createdAt: string;
}

export const listPaymentsQuerySchema = paginationQuerySchema.extend({
  status: multiEnumQuery(PAYMENT_STATUSES),
  method: z.enum(PAYMENT_METHODS).optional(),
  bookingId: z.uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});
export type ListPaymentsQuery = z.infer<typeof listPaymentsQuerySchema>;

/** Staff record that a proof (screenshot, transfer slip) arrived, before verifying it. */
export const markSubmittedSchema = z.object({ reference: optionalText(200) });
export type MarkSubmittedInput = z.infer<typeof markSubmittedSchema>;

export const verifyPaymentSchema = z.object({
  method: z.enum(PAYMENT_METHODS),
  reference: optionalText(200),
  proofFileId: z.uuid().nullable().optional(),
});
export type VerifyPaymentInput = z.infer<typeof verifyPaymentSchema>;

export const rejectPaymentSchema = z.object({ reason: z.string().trim().min(2, "Explain why this was rejected").max(500) });
export type RejectPaymentInput = z.infer<typeof rejectPaymentSchema>;

export const refundPaymentSchema = z.object({
  amount: moneySchema,
  reason: z.string().trim().min(2, "Explain why this was refunded").max(500),
});
export type RefundPaymentInput = z.infer<typeof refundPaymentSchema>;

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

export interface InvoiceItemDto {
  id: string;
  description: string;
  quantity: string;
  unitPrice: MoneyString;
  discountAmount: MoneyString;
  taxRatePercent: string;
  taxAmount: MoneyString;
  totalAmount: MoneyString;
}

export interface InvoiceDto {
  id: string;
  invoiceNumber: string;
  audience: InvoiceAudience;
  status: InvoiceStatus;
  customer: { id: string; name: string; customerNumber: string; email: string | null; phone: string | null } | null;
  provider: { id: string; displayName: string; providerType: ProviderType } | null;
  booking: { id: string; bookingNumber: string } | null;
  currency: string;
  subtotal: MoneyString;
  discountAmount: MoneyString;
  taxAmount: MoneyString;
  totalAmount: MoneyString;
  amountPaid: MoneyString;
  amountDue: MoneyString;
  issueDate: string;
  dueDate: string | null;
  notes: string | null;
  items: InvoiceItemDto[];
  payments: { id: string; paymentNumber: string; amount: MoneyString; method: PaymentMethod | null; status: PaymentStatus; verifiedAt: string | null }[];
  issuedAt: string | null;
  voidedAt: string | null;
  createdAt: string;
}

export const listInvoicesQuerySchema = paginationQuerySchema.extend({
  status: z.enum(INVOICE_STATUSES).optional(),
  audience: z.enum(INVOICE_AUDIENCES).optional(),
  customerId: z.uuid().optional(),
  providerId: z.uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});
export type ListInvoicesQuery = z.infer<typeof listInvoicesQuerySchema>;

/** Idempotent: an invoice already raised for this booking is returned as-is. */
export const invoiceFromBookingSchema = z.object({
  bookingId: z.uuid(),
  dueDate: isoDate.optional(),
  notes: optionalText(1000),
});
export type InvoiceFromBookingInput = z.infer<typeof invoiceFromBookingSchema>;

const invoiceLineSchema = z.object({
  description: z.string().trim().min(1, "Required").max(300),
  quantity: moneySchema.default(1),
  unitPrice: moneySchema,
  discountAmount: moneySchema.default(0),
  taxRatePercent: percentSchema.default(0),
});

export const createInvoiceSchema = z.object({
  customerId: z.uuid("Choose a customer"),
  items: z.array(invoiceLineSchema).min(1, "Add at least one line"),
  dueDate: isoDate.optional(),
  notes: optionalText(1000),
  issue: z.boolean().default(false),
});
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;

/**
 * A therapist/counsellor pay-slip: one manually-entered amount per issue (no
 * line-items array like a customer invoice) — the service builds a single
 * InvoiceItem from amount+description internally, reusing the same
 * totals/PDF/issue/void machinery under audience: "PROVIDER".
 */
export const createPayslipSchema = z.object({
  providerId: z.uuid("Choose a provider"),
  amount: moneySchema,
  description: z.string().trim().min(1, "Required").max(300),
  dueDate: isoDate.optional(),
  notes: optionalText(1000),
  issue: z.boolean().default(false),
});
export type CreatePayslipInput = z.infer<typeof createPayslipSchema>;

export const voidInvoiceSchema = z.object({ reason: z.string().trim().min(2).max(500) });
export type VoidInvoiceInput = z.infer<typeof voidInvoiceSchema>;

// ---------------------------------------------------------------------------
// Finance ledger: transactions & categories
// ---------------------------------------------------------------------------

export interface FinanceCategoryDto {
  id: string;
  type: FinanceCategoryType;
  name: string;
  slug: string;
}

export interface FinanceTransactionDto {
  id: string;
  transactionNumber: string;
  type: FinanceTxType;
  status: FinanceTxStatus;
  category: { id: string; name: string } | null;
  amount: MoneyString;
  currency: string;
  paymentMethod: PaymentMethod | null;
  reference: string | null;
  booking: { id: string; bookingNumber: string } | null;
  paymentId: string | null;
  expenseId: string | null;
  notes: string | null;
  transactionDate: string;
  createdBy: string | null;
}

export const listFinanceTxQuerySchema = paginationQuerySchema.extend({
  type: z.enum(FINANCE_TX_TYPES).optional(),
  status: z.enum(FINANCE_TX_STATUSES).optional(),
  categoryId: z.uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});
export type ListFinanceTxQuery = z.infer<typeof listFinanceTxQuerySchema>;

export const financeSummaryQuerySchema = z.object({ from: isoDate, to: isoDate });
export type FinanceSummaryQuery = z.infer<typeof financeSummaryQuerySchema>;

export interface FinanceSummaryDto {
  from: string;
  to: string;
  currency: string;
  income: MoneyString;
  refunds: MoneyString;
  expenses: MoneyString;
  adjustments: MoneyString;
  net: MoneyString;
  byMethod: { method: PaymentMethod | "UNSPECIFIED"; amount: MoneyString }[];
  byCategory: { categoryId: string | null; name: string; type: FinanceTxType; amount: MoneyString }[];
  daily: { date: string; income: MoneyString; outgoing: MoneyString }[];
  outstanding: MoneyString;
}

/** REFUND entries are always system-posted (from a payment refund), never entered by hand here. */
export const createFinanceTxSchema = z.object({
  type: z.enum(["INCOME", "EXPENSE", "ADJUSTMENT"] as const satisfies readonly FinanceTxType[]),
  categoryId: z.uuid().optional(),
  amount: moneySchema,
  paymentMethod: z.enum(PAYMENT_METHODS).optional(),
  reference: optionalText(200),
  notes: z.string().trim().min(2, "Say what this entry is").max(500),
  transactionDate: isoDate,
});
export type CreateFinanceTxInput = z.infer<typeof createFinanceTxSchema>;

export const voidFinanceTxSchema = z.object({ reason: z.string().trim().min(2).max(500) });
export type VoidFinanceTxInput = z.infer<typeof voidFinanceTxSchema>;

export const createFinanceCategorySchema = z.object({
  name: z.string().trim().min(2).max(100),
  type: z.enum(FINANCE_CATEGORY_TYPES),
});
export type CreateFinanceCategoryInput = z.infer<typeof createFinanceCategorySchema>;

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

export interface ExpenseCategoryDto {
  id: string;
  name: string;
  slug: string;
}

export interface ExpenseDto {
  id: string;
  expenseNumber: string;
  category: { id: string; name: string };
  vendor: string | null;
  description: string;
  amount: MoneyString;
  currency: string;
  paymentMethod: PaymentMethod | null;
  reference: string | null;
  expenseDate: string;
  status: ExpenseStatus;
  receiptFileId: string | null;
  createdBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
}

export const listExpensesQuerySchema = paginationQuerySchema.extend({
  status: multiEnumQuery(EXPENSE_STATUSES),
  categoryId: z.uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});
export type ListExpensesQuery = z.infer<typeof listExpensesQuerySchema>;

export const createExpenseSchema = z.object({
  categoryId: z.uuid("Choose a category"),
  vendor: optionalText(150),
  description: z.string().trim().min(2, "Required").max(300),
  amount: moneySchema,
  paymentMethod: z.enum(PAYMENT_METHODS).optional(),
  reference: optionalText(200),
  expenseDate: isoDate,
  receiptFileId: z.uuid().nullable().optional(),
});
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;

export const updateExpenseSchema = createExpenseSchema.partial();
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;

export const expenseActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve") }),
  z.object({ action: z.literal("reject") }),
  z.object({ action: z.literal("mark_paid"), paymentMethod: z.enum(PAYMENT_METHODS).optional(), reference: optionalText(200) }),
]);
export type ExpenseActionInput = z.infer<typeof expenseActionSchema>;

export const createCategorySimpleSchema = z.object({ name: z.string().trim().min(2).max(100) });
export type CreateCategorySimpleInput = z.infer<typeof createCategorySimpleSchema>;
