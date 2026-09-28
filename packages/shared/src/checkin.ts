/**
 * Digital-ticket check-in (Phase 11). One shared action (`POST
 * /check-in/:appointmentId`) backs both entry points — scanning the QR from
 * the confirmation email and manually searching a booking/ticket number —
 * so there is exactly one place that decides what a valid check-in is.
 */
import { z } from "zod";
import type { BookingStatus } from "./enums.js";

export interface CheckInLookupDto {
  appointmentId: string;
  bookingId: string;
  bookingNumber: string;
  customerName: string;
  customerPhone: string | null;
  serviceName: string;
  packageName: string | null;
  providerName: string;
  startsAt: string;
  timezone: string;
  status: BookingStatus;
  checkedIn: boolean;
  checkedInAt: string | null;
  checkedInBy: string | null;
}

/** Response of POST /check-in/:appointmentId — `alreadyCheckedIn: true` means this call changed nothing (idempotent). */
export interface CheckInResultDto extends CheckInLookupDto {
  alreadyCheckedIn: boolean;
}

export const checkInLookupQuerySchema = z
  .object({
    token: z.uuid().optional(),
    search: z.string().trim().min(2).max(100).optional(),
  })
  .refine((v) => Boolean(v.token) !== Boolean(v.search), "Provide either a token or a search term, not both");
export type CheckInLookupQuery = z.infer<typeof checkInLookupQuerySchema>;
