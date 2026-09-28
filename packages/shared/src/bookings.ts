/**
 * Staff-facing bookings (Phase 5): list, detail, manual/staff booking
 * creation, and the cancel/reschedule/complete/no-show transitions. Built on
 * the same `createAppointmentBooking` engine the public forms use
 * (docs/ARCHITECTURE.md §5); manual booking skips the service-specific
 * "details" questionnaire (§8 admin workflow) but goes through the same
 * slot and gender checks.
 */
import { z } from "zod";
import {
  BOOKING_SOURCES,
  BOOKING_STATUSES,
  GENDERS,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  type BookingSource,
  type BookingStatus,
  type Gender,
  type PaymentMethod,
  type PaymentStatus,
} from "./enums.js";
import { SERVICE_SLUGS, type ServiceSlug } from "./service-forms/index.js";
import { emailSchema, multiEnumQuery, optionalText, paginationQuerySchema, phoneSchema, type MoneyString } from "./validation.js";

const isoDate = z.iso.date("Use YYYY-MM-DD");

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export interface BookingListItemDto {
  id: string;
  bookingNumber: string;
  status: BookingStatus;
  paymentStatus: PaymentStatus;
  source: BookingSource;
  customerName: string;
  customerPhone: string | null;
  customerEmail: string | null;
  serviceName: string;
  serviceSlug: string;
  providerName: string;
  packageName: string | null;
  startsAt: string;
  endsAt: string;
  timezone: string;
  amount: MoneyString;
  currency: string;
  createdAt: string;
}

export interface BookingDetailDto extends BookingListItemDto {
  appointmentId: string;
  customer: {
    id: string;
    customerNumber: string;
    firstName: string;
    lastName: string | null;
    email: string | null;
    phone: string | null;
    dateOfBirth: string | null;
    gender: Gender | null;
    city: string | null;
    province: string | null;
    address: string | null;
  };
  provider: { id: string; displayName: string; phone: string | null; email: string | null };
  service: { id: string; slug: string; name: string };
  package: { id: string; name: string; points: number | null } | null;
  /** The service-specific "Service details" step answers (empty for manual bookings). */
  formData: unknown;
  customerNotes: string | null;
  internalNotes: string | null;
  termsAcceptedAt: string | null;
  payment: { id: string; paymentNumber: string; status: PaymentStatus; method: PaymentMethod | null; amount: MoneyString; proofFileId: string | null } | null;
  confirmedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  rescheduledFromId: string | null;
  rescheduledToId: string | null;
  availabilityOverridden: boolean;
  /** Digital-ticket check-in (Phase 11) — the booking number itself doubles as the ticket number. */
  checkIn: { checkedInAt: string; checkedInBy: string | null } | null;
}

export const listBookingsQuerySchema = paginationQuerySchema.extend({
  status: multiEnumQuery(BOOKING_STATUSES),
  paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
  service: z.enum(SERVICE_SLUGS).optional(),
  providerId: z.uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  sort: z.enum(["asc", "desc"]).default("desc"),
});
export type ListBookingsQuery = z.infer<typeof listBookingsQuerySchema>;

// ---------------------------------------------------------------------------
// Manual / staff booking
// ---------------------------------------------------------------------------

const manualPersonalSchema = z.object({
  firstName: z.string().trim().min(1, "Required").max(80),
  lastName: optionalText(80),
  phone: phoneSchema,
  email: emailSchema,
  dateOfBirth: isoDate.nullable().optional(),
  gender: z.enum(GENDERS),
});

const manualLocationSchema = z.object({
  city: optionalText(100),
  province: optionalText(100),
  address: optionalText(300),
});

export const manualBookingSchema = z
  .object({
    service: z.enum(SERVICE_SLUGS),
    providerId: z.uuid("Choose a provider"),
    packageId: z.uuid("Choose an option"),
    startsAt: z.iso.datetime({ offset: true, error: "Choose a date and time" }),
    personal: manualPersonalSchema,
    location: manualLocationSchema,
    source: z.enum(["ADMIN", "PHONE", "WALK_IN"] as const satisfies readonly BookingSource[]),
    customerNotes: optionalText(2000),
    overrideAvailability: z.boolean().default(false),
    markPaid: z.boolean().default(false),
    paymentMethod: z.enum(PAYMENT_METHODS).optional(),
  })
  .refine((v) => !v.markPaid || v.paymentMethod, { path: ["paymentMethod"], message: "Choose how they paid" });
export type ManualBookingInput = z.infer<typeof manualBookingSchema>;

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

export const cancelBookingSchema = z.object({ reason: optionalText(500) });
export type CancelBookingInput = z.infer<typeof cancelBookingSchema>;

export const updateBookingNotesSchema = z.object({ internalNotes: optionalText(2000) });
export type UpdateBookingNotesInput = z.infer<typeof updateBookingNotesSchema>;

/** The customer-contact snapshot on a booking — the one place a typo can be fixed after submission. */
export const updateBookingDetailsSchema = z.object({
  firstName: z.string().trim().min(1, "Required").max(80),
  lastName: optionalText(80),
  email: emailSchema.nullable().optional(),
  phone: phoneSchema.nullable().optional(),
});
export type UpdateBookingDetailsInput = z.infer<typeof updateBookingDetailsSchema>;

export const rescheduleBookingSchema = z.object({
  startsAt: z.iso.datetime({ offset: true, error: "Choose a date and time" }),
  providerId: z.uuid().optional(),
  overrideAvailability: z.boolean().default(false),
  reason: optionalText(500),
});
export type RescheduleBookingInput = z.infer<typeof rescheduleBookingSchema>;
