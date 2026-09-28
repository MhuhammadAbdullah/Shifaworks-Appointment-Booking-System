import { z } from "zod";
import type { PaginationMeta } from "./api.js";
import { APPOINTMENT_STATUSES, BOOKING_STATUSES, EVENT_STATUSES, PAYMENT_METHODS, PAYMENT_STATUSES, type PaymentMethod } from "./enums.js";
import { EXPENSE_STATUSES, PAYMENT_RECORD_STATUSES } from "./finance.js";
import { paginationQuerySchema } from "./validation.js";

// ---------------------------------------------------------------------------
// Report catalogue
// ---------------------------------------------------------------------------

export const REPORT_TYPES = [
  "bookings",
  "appointments",
  "events",
  "revenue",
  "expenses",
  "payments",
  "providers",
  "customers",
  "cancellations",
  "no-shows",
  "event-attendance",
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const REPORT_GROUP_BY = ["day", "week", "month", "service", "provider", "category", "method"] as const;
export type ReportGroupBy = (typeof REPORT_GROUP_BY)[number];

export type ReportFilterKey =
  | "providerId"
  | "serviceId"
  | "categoryId"
  | "locationId"
  | "eventId"
  | "paymentStatus"
  | "bookingStatus"
  | "status"
  | "method"
  | "groupBy";

export interface ReportDefinition {
  type: ReportType;
  title: string;
  description: string;
  /** What the date range applies to. */
  dateBasis: string;
  filters: readonly ReportFilterKey[];
  /** Allowed values of the report-specific `status` filter. */
  statuses?: readonly string[];
}

const PLACE = ["providerId", "serviceId", "categoryId", "locationId"] as const;

export const REPORTS: Record<ReportType, ReportDefinition> = {
  bookings: {
    type: "bookings",
    title: "Bookings",
    description: "Every appointment and event booking made in the period, with its value and payment state.",
    dateBasis: "Booking date",
    filters: [...PLACE, "eventId", "bookingStatus", "paymentStatus"],
  },
  appointments: {
    type: "appointments",
    title: "Appointments",
    description: "Appointments scheduled in the period by provider, service and status.",
    dateBasis: "Appointment date",
    filters: [...PLACE, "status", "bookingStatus", "paymentStatus"],
    statuses: APPOINTMENT_STATUSES.filter((s) => s !== "RESCHEDULED"),
  },
  events: {
    type: "events",
    title: "Events",
    description: "Capacity, tickets sold and revenue per event.",
    dateBasis: "Event date",
    filters: ["categoryId", "locationId", "eventId", "status"],
    statuses: EVENT_STATUSES,
  },
  revenue: {
    type: "revenue",
    title: "Revenue",
    description: "Income and refunds posted to the ledger, grouped by time, service, provider, category or method.",
    dateBasis: "Transaction date",
    filters: [...PLACE, "eventId", "method", "groupBy"],
  },
  expenses: {
    type: "expenses",
    title: "Expenses",
    description: "Recorded expenses with totals per category.",
    dateBasis: "Expense date",
    filters: ["categoryId", "locationId", "status", "method"],
    statuses: EXPENSE_STATUSES,
  },
  payments: {
    type: "payments",
    title: "Payments",
    description: "Payments received and refunded, by method.",
    dateBasis: "Payment date",
    filters: [...PLACE, "eventId", "status", "method"],
    statuses: PAYMENT_RECORD_STATUSES,
  },
  providers: {
    type: "providers",
    title: "Providers",
    description: "Workload, completion, cancellations, no-shows and booked value per provider.",
    dateBasis: "Appointment date",
    filters: PLACE,
  },
  customers: {
    type: "customers",
    title: "Customers",
    description: "Activity and spend of customers who booked or visited in the period.",
    dateBasis: "Booking / appointment / payment date",
    filters: [...PLACE],
  },
  cancellations: {
    type: "cancellations",
    title: "Cancellations",
    description: "Cancelled appointments and event bookings with reason and notice given.",
    dateBasis: "Cancellation date",
    filters: [...PLACE, "eventId"],
  },
  "no-shows": {
    type: "no-shows",
    title: "No-shows",
    description: "Appointments the customer did not attend.",
    dateBasis: "Appointment date",
    filters: PLACE,
  },
  "event-attendance": {
    type: "event-attendance",
    title: "Event attendance",
    description: "Tickets issued versus checked in, per event and ticket type.",
    dateBasis: "Event date",
    filters: ["categoryId", "locationId", "eventId"],
  },
};

// ---------------------------------------------------------------------------
// Report data
// ---------------------------------------------------------------------------

export type ReportValueType = "text" | "number" | "money" | "percent" | "date" | "datetime" | "status";

export interface ReportColumn {
  key: string;
  label: string;
  type: ReportValueType;
}

export interface ReportSummaryItem {
  label: string;
  value: number | string | null;
  type: Exclude<ReportValueType, "date" | "datetime" | "status">;
  hint?: string;
}

export type ReportRow = Record<string, string | number | null>;

export interface ReportDto {
  type: ReportType;
  title: string;
  from: string;
  to: string;
  timezone: string;
  currency: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  summary: ReportSummaryItem[];
  /** Suggested single-series bar chart over the (full, unpaged) grouped rows. */
  chart: { labelKey: string; valueKey: string; label: string; points: { label: string; value: number }[] } | null;
  meta: PaginationMeta;
}

const isoDate = z.iso.date("Use YYYY-MM-DD");

export const reportQuerySchema = paginationQuerySchema
  .extend({
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
    from: isoDate,
    to: isoDate,
    providerId: z.uuid().optional(),
    serviceId: z.uuid().optional(),
    categoryId: z.uuid().optional(),
    locationId: z.uuid().optional(),
    eventId: z.uuid().optional(),
    paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
    bookingStatus: z.enum(BOOKING_STATUSES).optional(),
    status: z.string().regex(/^[A-Z_]{2,30}$/).optional(),
    method: z.enum(PAYMENT_METHODS).optional(),
    groupBy: z.enum(REPORT_GROUP_BY).optional(),
  })
  .refine((v) => v.to >= v.from, { path: ["to"], message: "'to' is before 'from'" })
  .refine((v) => (Date.parse(v.to) - Date.parse(v.from)) / 86_400_000 <= 400, { path: ["to"], message: "At most ~13 months per report" });
export type ReportQuery = z.infer<typeof reportQuerySchema>;

// ---------------------------------------------------------------------------
// Dashboards
// ---------------------------------------------------------------------------

export interface DashboardAppointment {
  id: string;
  bookingNumber: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  status: string;
  customer: string;
  provider: string;
  service: string;
}

export interface AdminDashboardDto {
  generatedAt: string;
  timezone: string;
  currency: string;
  /** Sections the viewer is not allowed to see are null. */
  revenue: {
    monthNet: string;
    previousMonthNet: string;
    todayIncome: string;
    trend: { date: string; net: string }[];
  } | null;
  appointments: {
    today: number;
    week: number;
    pendingConfirmation: number;
    monthCancelled: number;
    monthNoShows: number;
    todayList: DashboardAppointment[];
    providerSchedule: { providerId: string; provider: string; count: number; firstStart: string | null; lastEnd: string | null; next: string | null }[];
  } | null;
  events: {
    monthTicketsSold: number;
    upcoming: { id: string; name: string; startsAt: string; timezone: string; sold: number; capacity: number | null; status: string }[];
  } | null;
  customers: { total: number; newThisMonth: number } | null;
  payments: {
    pendingCount: number;
    pendingAmount: string;
    needsRefund: number;
    recent: { id: string; paymentNumber: string; customer: string | null; amount: string; currency: string; method: PaymentMethod; paidAt: string | null }[];
  } | null;
  recentBookings: { id: string; href: string; bookingNumber: string; type: "APPOINTMENT" | "EVENT"; customer: string; item: string; status: string; totalAmount: string; createdAt: string }[] | null;
  attention: { key: string; label: string; count: number; href: string }[];
}

export interface ProviderDashboardDto {
  timezone: string;
  counts: { today: number; week: number; monthCompleted: number; monthNoShows: number; monthCancelled: number };
  pendingForms: { appointmentId: string; customer: string; service: string; startsAt: string; timezone: string; form: string }[];
  clients: { customerId: string; name: string; visits: number; lastVisit: string | null; nextVisit: string | null }[];
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

export interface AuditLogDto {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  user: { id: string; name: string; email: string | null } | null;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
  oldValues: unknown;
  newValues: unknown;
  createdAt: string;
}

export const listAuditLogsQuerySchema = paginationQuerySchema.extend({
  from: isoDate.optional(),
  to: isoDate.optional(),
  userId: z.uuid().optional(),
  entityType: z.string().trim().max(60).optional(),
  entityId: z.string().trim().max(60).optional(),
  action: z.string().trim().max(80).optional(),
});
export type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>;

export interface AuditFacetsDto {
  entityTypes: string[];
  actions: string[];
}
