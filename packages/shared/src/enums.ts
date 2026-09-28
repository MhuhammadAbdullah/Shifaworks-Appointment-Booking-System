/**
 * Enum values mirrored from apps/api/prisma/schema.prisma so the browser
 * bundle never imports the Prisma client. apps/api has a test asserting they
 * stay in sync.
 */

export const USER_STATUSES = ["ACTIVE", "INVITED", "SUSPENDED", "DEACTIVATED"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const PROVIDER_TYPES = ["THERAPIST", "COUNSELLOR"] as const;
export type ProviderType = (typeof PROVIDER_TYPES)[number];
export const PROVIDER_TYPE_LABELS: Record<ProviderType, string> = { THERAPIST: "Therapist", COUNSELLOR: "Counsellor" };

export const GENDERS = ["MALE", "FEMALE"] as const;
export type Gender = (typeof GENDERS)[number];
export const GENDER_LABELS: Record<Gender, string> = { MALE: "Male", FEMALE: "Female" };

export const AVAILABILITY_EXCEPTION_TYPES = ["CUSTOM_HOURS", "DAY_OFF", "LEAVE", "HOLIDAY"] as const;
export type AvailabilityExceptionType = (typeof AVAILABILITY_EXCEPTION_TYPES)[number];

export const BOOKING_TYPES = ["APPOINTMENT"] as const;
export type BookingType = (typeof BOOKING_TYPES)[number];

/** Lifecycle shared by bookings and appointments. */
export const BOOKING_STATUSES = [
  "PENDING_PAYMENT",
  "PAYMENT_SUBMITTED",
  "PAYMENT_VERIFIED",
  "CONFIRMED",
  "CANCELLED",
  "COMPLETED",
  "NO_SHOW",
  "RESCHEDULED",
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  PENDING_PAYMENT: "Pending payment",
  PAYMENT_SUBMITTED: "Payment submitted",
  PAYMENT_VERIFIED: "Payment verified",
  CONFIRMED: "Confirmed",
  CANCELLED: "Cancelled",
  COMPLETED: "Completed",
  NO_SHOW: "No-show",
  RESCHEDULED: "Rescheduled",
};

/**
 * Statuses that keep a provider's time reserved. Must match the WHERE clause of
 * the `appointments_no_provider_overlap` exclusion constraint.
 */
export const SLOT_HOLDING_STATUSES = ["PENDING_PAYMENT", "PAYMENT_SUBMITTED", "PAYMENT_VERIFIED", "CONFIRMED"] as const satisfies readonly BookingStatus[];

export const BOOKING_SOURCES = ["ONLINE", "ADMIN", "PHONE", "WALK_IN"] as const;
export type BookingSource = (typeof BOOKING_SOURCES)[number];

export const PAYMENT_STATUSES = ["PENDING", "VERIFIED", "REJECTED", "REFUNDED"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = { PENDING: "Pending", VERIFIED: "Verified", REJECTED: "Rejected", REFUNDED: "Refunded" };

export const PAYMENT_METHODS = ["BANK_TRANSFER", "JAZZCASH", "EASYPAISA", "CASH", "CARD", "OTHER"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  BANK_TRANSFER: "Bank transfer",
  JAZZCASH: "JazzCash",
  EASYPAISA: "Easypaisa",
  CASH: "Cash",
  CARD: "Card",
  OTHER: "Other",
};

export const INVOICE_STATUSES = ["DRAFT", "ISSUED", "PARTIALLY_PAID", "PAID", "OVERDUE", "VOID"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  DRAFT: "Draft",
  ISSUED: "Issued",
  PARTIALLY_PAID: "Partially paid",
  PAID: "Paid",
  OVERDUE: "Overdue",
  VOID: "Void",
};

export const INVOICE_AUDIENCES = ["CUSTOMER", "PROVIDER"] as const;
export type InvoiceAudience = (typeof INVOICE_AUDIENCES)[number];
export const INVOICE_AUDIENCE_LABELS: Record<InvoiceAudience, string> = { CUSTOMER: "Customer invoice", PROVIDER: "Provider pay-slip" };

export const FINANCE_TX_TYPES = ["INCOME", "EXPENSE", "REFUND", "ADJUSTMENT"] as const;
export type FinanceTxType = (typeof FINANCE_TX_TYPES)[number];
export const FINANCE_TX_TYPE_LABELS: Record<FinanceTxType, string> = { INCOME: "Income", EXPENSE: "Expense", REFUND: "Refund", ADJUSTMENT: "Adjustment" };

export const FINANCE_TX_STATUSES = ["PENDING", "POSTED", "VOID"] as const;
export type FinanceTxStatus = (typeof FINANCE_TX_STATUSES)[number];

export const FINANCE_CATEGORY_TYPES = ["INCOME", "EXPENSE"] as const;
export type FinanceCategoryType = (typeof FINANCE_CATEGORY_TYPES)[number];

export const EXPENSE_STATUSES = ["DRAFT", "APPROVED", "PAID", "REJECTED"] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];
export const EXPENSE_STATUS_LABELS: Record<ExpenseStatus, string> = { DRAFT: "Draft", APPROVED: "Approved", PAID: "Paid", REJECTED: "Rejected" };

/** WHATSAPP is reserved for a future Meta Cloud API provider. */
export const NOTIFICATION_CHANNELS = ["EMAIL", "WHATSAPP"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_AUDIENCES = ["CUSTOMER", "ADMIN", "PROVIDER", "STAFF"] as const;
export type NotificationAudience = (typeof NOTIFICATION_AUDIENCES)[number];

export const EMAIL_TEMPLATE_KEYS = [
  "BOOKING_RECEIVED",
  "BOOKING_CONFIRMED",
  "PAYMENT_REJECTED",
  "BOOKING_CANCELLED",
  "BOOKING_RESCHEDULED",
  "STAFF_INVITE",
] as const;
export type EmailTemplateKey = (typeof EMAIL_TEMPLATE_KEYS)[number];
export const EMAIL_TEMPLATE_KEY_LABELS: Record<EmailTemplateKey, string> = {
  BOOKING_RECEIVED: "Booking received",
  BOOKING_CONFIRMED: "Booking confirmed",
  PAYMENT_REJECTED: "Payment rejected",
  BOOKING_CANCELLED: "Booking cancelled",
  BOOKING_RESCHEDULED: "Booking rescheduled",
  STAFF_INVITE: "Staff/provider invitation",
};

export const NOTIFICATION_STATUSES = ["QUEUED", "SENDING", "SENT", "FAILED", "SKIPPED"] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];
export const NOTIFICATION_STATUS_LABELS: Record<NotificationStatus, string> = {
  QUEUED: "Queued",
  SENDING: "Sending",
  SENT: "Sent",
  FAILED: "Failed",
  SKIPPED: "Skipped",
};

export const DELIVERY_STATUSES = ["SENT", "DELIVERED", "FAILED", "BOUNCED"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const FILE_VISIBILITIES = ["PUBLIC", "PRIVATE"] as const;
export type FileVisibility = (typeof FILE_VISIBILITIES)[number];
