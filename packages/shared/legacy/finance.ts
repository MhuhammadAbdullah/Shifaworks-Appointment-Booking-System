import { z } from "zod";
import { PAYMENT_METHODS, type PaymentMethod, type PaymentStatus } from "./enums.js";
import { moneySchema, optionalText, paginationQuerySchema, percentSchema, type MoneyString } from "./validation.js";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const PAYMENT_RECORD_STATUSES = ["PENDING", "SUCCEEDED", "FAILED", "CANCELLED", "REFUNDED", "PARTIALLY_REFUNDED"] as const;
export type PaymentRecordStatus = (typeof PAYMENT_RECORD_STATUSES)[number];
export const INVOICE_STATUSES = ["DRAFT", "ISSUED", "PARTIALLY_PAID", "PAID", "OVERDUE", "VOID"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export const FINANCE_TX_TYPES = ["INCOME", "EXPENSE", "REFUND", "ADJUSTMENT"] as const;
export type FinanceTxType = (typeof FINANCE_TX_TYPES)[number];
export const FINANCE_TX_STATUSES = ["PENDING", "POSTED", "VOID"] as const;
export type FinanceTxStatus = (typeof FINANCE_TX_STATUSES)[number];
export const EXPENSE_STATUSES = ["DRAFT", "APPROVED", "PAID", "REJECTED"] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];

/** Methods staff can record by hand (gateway methods come from verified callbacks). */
export const MANUAL_PAYMENT_METHODS = ["CASH", "BANK_TRANSFER", "CARD", "EASYPAISA", "JAZZCASH", "OTHER"] as const satisfies readonly PaymentMethod[];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: "Cash",
  BANK_TRANSFER: "Bank transfer",
  CARD: "Card",
  PAYFAST: "PayFast",
  JAZZCASH: "JazzCash",
  EASYPAISA: "EasyPaisa",
  OTHER: "Other",
};

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface PersonRef {
  id: string;
  name: string;
  customerNumber?: string;
}

export interface RefundDto {
  id: string;
  amount: MoneyString;
  reason: string | null;
  status: "PENDING" | "SUCCEEDED" | "FAILED";
  processedAt: string | null;
  processedBy: string | null;
}

export interface PaymentDto {
  id: string;
  paymentNumber: string;
  booking: { id: string; bookingNumber: string } | null;
  invoice: { id: string; invoiceNumber: string } | null;
  customer: PersonRef | null;
  method: PaymentMethod;
  gateway: string | null;
  status: PaymentRecordStatus;
  amount: MoneyString;
  refundedAmount: MoneyString;
  currency: string;
  reference: string | null;
  gatewayReference: string | null;
  failureReason: string | null;
  /** Paid, but the booking could not be kept (hold lapsed and the slot was taken): refund needed. */
  needsRefund: boolean;
  paidAt: string | null;
  receivedBy: string | null;
  refunds: RefundDto[];
  createdAt: string;
}

export interface GatewayInfo {
  key: string;
  label: string;
  description: string;
}

export interface BookingPaymentSummary {
  bookingId: string;
  bookingNumber: string;
  bookingStatus: "PENDING" | "CONFIRMED" | "COMPLETED" | "CANCELLED" | "EXPIRED";
  paymentStatus: PaymentStatus;
  currency: string;
  totalAmount: MoneyString;
  amountPaid: MoneyString;
  amountDue: MoneyString;
  payments: PaymentDto[];
  invoice: { id: string; invoiceNumber: string; status: InvoiceStatus } | null;
  /** Gateways the customer may use right now (empty when nothing is due). */
  onlineGateways: GatewayInfo[];
}

export type CheckoutAction =
  | { type: "redirect"; url: string }
  | { type: "form_post"; url: string; fields: Record<string, string> };

export interface CheckoutResponse {
  paymentId: string;
  action: CheckoutAction;
}

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
  status: InvoiceStatus;
  customer: PersonRef & { email: string | null; phone: string | null };
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
  payments: { id: string; paymentNumber: string; amount: MoneyString; method: PaymentMethod; status: PaymentRecordStatus; paidAt: string | null }[];
  issuedAt: string | null;
  voidedAt: string | null;
  createdAt: string;
}

export interface FinanceCategoryDto {
  id: string;
  type: "INCOME" | "EXPENSE";
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
  customer: PersonRef | null;
  notes: string | null;
  transactionDate: string;
  createdBy: string | null;
}

export interface ExpenseCategoryDto {
  id: string;
  name: string;
  slug: string;
}

export interface ExpenseDto {
  id: string;
  expenseNumber: string;
  category: { id: string; name: string };
  location: { id: string; name: string } | null;
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

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

const isoDate = z.iso.date("Use YYYY-MM-DD");
const positiveMoney = moneySchema.refine((v) => v > 0, "Must be more than zero");

export const checkoutSchema = z.object({ bookingId: z.uuid(), gateway: z.string().min(2).max(40) });
export type CheckoutInput = z.infer<typeof checkoutSchema>;

export const manualPaymentSchema = z
  .object({
    bookingId: z.uuid().optional(),
    invoiceId: z.uuid().optional(),
    amount: positiveMoney,
    method: z.enum(MANUAL_PAYMENT_METHODS),
    reference: z.string().trim().max(120).optional(),
    paidAt: z.iso.datetime({ offset: true }).optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .refine((v) => Boolean(v.bookingId) !== Boolean(v.invoiceId), "Record the payment against exactly one booking or invoice");
export type ManualPaymentInput = z.infer<typeof manualPaymentSchema>;

export const refundSchema = z.object({ amount: positiveMoney, reason: z.string().trim().min(2).max(500) });
export type RefundInput = z.infer<typeof refundSchema>;

export const listPaymentsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(PAYMENT_RECORD_STATUSES).optional(),
  method: z.enum(PAYMENT_METHODS).optional(),
  customerId: z.uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  needsRefund: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
});
export type ListPaymentsQuery = z.infer<typeof listPaymentsQuerySchema>;

const invoiceItemInput = z.object({
  description: z.string().trim().min(1).max(300),
  quantity: z.coerce.number().min(0.01).max(100_000),
  unitPrice: moneySchema,
  discountAmount: moneySchema.optional(),
  taxRatePercent: percentSchema.optional(),
});

export const createInvoiceSchema = z.object({
  customerId: z.uuid(),
  items: z.array(invoiceItemInput).min(1).max(100),
  dueDate: isoDate.optional(),
  notes: optionalText(2000),
  issue: z.boolean().default(false),
});
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;

export const invoiceFromBookingSchema = z.object({ bookingId: z.uuid(), dueDate: isoDate.optional(), notes: optionalText(2000) });
export type InvoiceFromBookingInput = z.infer<typeof invoiceFromBookingSchema>;

export const listInvoicesQuerySchema = paginationQuerySchema.extend({
  status: z.enum(INVOICE_STATUSES).optional(),
  customerId: z.uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});
export type ListInvoicesQuery = z.infer<typeof listInvoicesQuerySchema>;

export const createFinanceTxSchema = z.object({
  type: z.enum(["INCOME", "EXPENSE", "ADJUSTMENT"]),
  amount: positiveMoney,
  categoryId: z.uuid().nullable().optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).nullable().optional(),
  reference: z.string().trim().max(120).optional(),
  transactionDate: isoDate,
  notes: z.string().trim().min(2, "Explain this entry").max(1000),
});
export type CreateFinanceTxInput = z.infer<typeof createFinanceTxSchema>;

export const listFinanceTxQuerySchema = paginationQuerySchema.extend({
  type: z.enum(FINANCE_TX_TYPES).optional(),
  status: z.enum(FINANCE_TX_STATUSES).optional(),
  categoryId: z.uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});
export type ListFinanceTxQuery = z.infer<typeof listFinanceTxQuerySchema>;

export const financeSummaryQuerySchema = z
  .object({ from: isoDate, to: isoDate })
  .refine((v) => v.to >= v.from, { path: ["to"], message: "'to' is before 'from'" })
  .refine((v) => (Date.parse(v.to) - Date.parse(v.from)) / 86_400_000 <= 400, { path: ["to"], message: "At most ~13 months" });
export type FinanceSummaryQuery = z.infer<typeof financeSummaryQuerySchema>;

export const createCategorySimpleSchema = z.object({ name: z.string().trim().min(2).max(80) });
export const createFinanceCategorySchema = createCategorySimpleSchema.extend({ type: z.enum(["INCOME", "EXPENSE"]) });

const expenseFields = {
  categoryId: z.uuid(),
  locationId: z.uuid().nullable().optional(),
  vendor: optionalText(160),
  description: z.string().trim().min(2).max(500),
  amount: positiveMoney,
  paymentMethod: z.enum(PAYMENT_METHODS).nullable().optional(),
  reference: z.string().trim().max(120).nullable().optional(),
  expenseDate: isoDate,
  receiptFileId: z.uuid().nullable().optional(),
};
export const createExpenseSchema = z.object(expenseFields);
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;
export const updateExpenseSchema = z
  .object(expenseFields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;

export const expenseActionSchema = z.object({
  action: z.enum(["approve", "reject", "mark_paid"]),
  paymentMethod: z.enum(PAYMENT_METHODS).optional(),
  reference: z.string().trim().max(120).optional(),
});
export type ExpenseActionInput = z.infer<typeof expenseActionSchema>;

export const listExpensesQuerySchema = paginationQuerySchema.extend({
  status: z.enum(EXPENSE_STATUSES).optional(),
  categoryId: z.uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});
export type ListExpensesQuery = z.infer<typeof listExpensesQuerySchema>;
