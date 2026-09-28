/**
 * Contracts for the unauthenticated /public/* endpoints the five booking
 * forms use (Phase 4). Never includes anything a browser shouldn't see:
 * provider cards have no email/phone/account, and the service bootstrap
 * never lists other services.
 */
import { z } from "zod";
import { GENDERS, type BookingStatus, type PaymentStatus, type ProviderType } from "./enums.js";
import { MAX_DATE_RANGE_DAYS } from "./availability.js";
import { SERVICE_SLUGS, type ServiceSlug } from "./service-forms/index.js";
import type { MoneyString } from "./validation.js";

export interface SupportContactsDto {
  email: string;
  phone: string;
  whatsapp: string;
}

/** Org identity shown on the public booking forms before anyone signs in. */
export interface PublicBrandingDto {
  name: string;
  logoUrl: string | null;
}

export interface PaymentInstructionsDto {
  bankName: string;
  accountTitle: string;
  accountNumber: string;
  iban: string;
  jazzcash: string;
  easypaisa: string;
  whatsapp: string;
  instructions: string;
}

/** An admin-managed "Areas of concern" style checklist option — only active ones are ever sent to the browser. */
export interface PublicConcernOptionDto {
  code: string;
  label: string;
}

export interface PublicPackageDto {
  id: string;
  name: string;
  description: string | null;
  points: number | null;
  /** Falls back to the service's default when the package has none of its own. */
  durationMinutes: number;
  /** The payable amount — already discounted when a discount is active. */
  price: MoneyString;
  /** Only present (and different from `price`) when a discount is active. */
  originalPrice: MoneyString | null;
  discountPercent: number | null;
}

export interface PublicServiceDto {
  slug: ServiceSlug;
  name: string;
  description: string | null;
  /** False when the service is inactive or bookings are paused — show "Registration Closed". */
  open: boolean;
  providerType: ProviderType;
  currency: string;
  termsUrl: string;
  packages: PublicPackageDto[];
  /** Empty for services with no admin-managed checklist (see CONCERN_CHECKLIST_FIELD). */
  concernOptions: PublicConcernOptionDto[];
  /** Whether the "In person or online" question should be asked at all. */
  deliveryModeVisible: boolean;
  support: SupportContactsDto;
  /** Shown in the review step, before submission — so a customer can pay before or while submitting, not only after. */
  paymentInstructions: PaymentInstructionsDto;
}

export interface PublicProviderDto {
  id: string;
  displayName: string;
  designation: string | null;
  experienceYears: number;
  /** "4.8" or null when the provider has no rating yet — hide the stars. */
  rating: string | null;
  photoUrl: string | null;
}

export const publicProvidersQuerySchema = z.object({
  service: z.enum(SERVICE_SLUGS, "Unknown service"),
  gender: z.enum(GENDERS).optional(),
});
export type PublicProvidersQuery = z.infer<typeof publicProvidersQuerySchema>;

const isoDate = z.iso.date("Use YYYY-MM-DD");

export const publicAvailableDatesQuerySchema = z
  .object({
    service: z.enum(SERVICE_SLUGS, "Unknown service"),
    provider: z.uuid("Choose a provider"),
    package: z.uuid().optional(),
    from: isoDate,
    to: isoDate,
  })
  .refine((v) => v.to >= v.from, { path: ["to"], message: "'to' is before 'from'" })
  .refine((v) => (Date.parse(v.to) - Date.parse(v.from)) / 86_400_000 < MAX_DATE_RANGE_DAYS, {
    path: ["to"],
    message: `At most ${MAX_DATE_RANGE_DAYS} days per request`,
  });
export type PublicAvailableDatesQuery = z.infer<typeof publicAvailableDatesQuerySchema>;

export const publicSlotsQuerySchema = z.object({
  service: z.enum(SERVICE_SLUGS, "Unknown service"),
  provider: z.uuid("Choose a provider"),
  package: z.uuid().optional(),
  date: isoDate,
});
export type PublicSlotsQuery = z.infer<typeof publicSlotsQuerySchema>;

export interface PublicBookingAppointment {
  providerName: string;
  serviceName: string;
  packageName: string;
  startsAt: string; // ISO UTC
  endsAt: string;
  timezone: string;
  date: string; // local YYYY-MM-DD
  time: string; // local HH:MM
}

export interface PublicBookingResponse {
  bookingNumber: string;
  status: BookingStatus;
  paymentStatus: PaymentStatus;
  amount: MoneyString;
  currency: string;
  appointment: PublicBookingAppointment;
  paymentInstructions: PaymentInstructionsDto;
  support: SupportContactsDto;
}
