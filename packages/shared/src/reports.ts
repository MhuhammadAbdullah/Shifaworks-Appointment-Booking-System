/**
 * Operational reports (Phase 9). Built on Appointment rows (the "live"
 * occurrence of a booking — see bookings.ts) filtered by startsAt within the
 * range, so a report answers "what was scheduled in this period" the same
 * way the admin calendar would. Revenue here is the appointment's booked
 * value for CONFIRMED/COMPLETED rows — a simple, self-consistent operational
 * figure, not the ledger's verified income (that's /finance/summary).
 */
import { z } from "zod";
import type { BookingSource, BookingStatus, ProviderType } from "./enums.js";
import type { MoneyString } from "./validation.js";

const isoDate = z.iso.date("Use YYYY-MM-DD");

export const REPORT_TYPES = ["bookings", "providers", "services"] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const reportTypeParamSchema = z.object({ type: z.enum(REPORT_TYPES) });

export const reportQuerySchema = z.object({
  from: isoDate,
  to: isoDate,
  /** Which Appointment timestamp the range filters on. Defaults to the scheduled date (startsAt); "createdAt" answers "what was booked in this period" instead of "what happens in this period" — used by the admin dashboard's period filter. */
  dateField: z.enum(["startsAt", "createdAt"]).default("startsAt"),
});
export type ReportQuery = z.infer<typeof reportQuerySchema>;

export interface BookingsReportDto {
  from: string;
  to: string;
  total: number;
  byStatus: { status: BookingStatus; count: number }[];
  byService: { serviceId: string; serviceName: string; count: number }[];
  bySource: { source: BookingSource; count: number }[];
  cancelledCount: number;
  noShowCount: number;
  completedCount: number;
  cancellationRatePercent: number;
  noShowRatePercent: number;
  daily: { date: string; count: number }[];
}

export interface ProviderReportRow {
  providerId: string;
  providerName: string;
  providerType: ProviderType;
  total: number;
  completed: number;
  cancelled: number;
  noShow: number;
  revenue: MoneyString;
}
export interface ProvidersReportDto {
  from: string;
  to: string;
  currency: string;
  rows: ProviderReportRow[];
}

export interface ServiceReportRow {
  serviceId: string;
  serviceName: string;
  total: number;
  completed: number;
  cancelled: number;
  revenue: MoneyString;
  averageValue: MoneyString;
}
export interface ServicesReportDto {
  from: string;
  to: string;
  currency: string;
  rows: ServiceReportRow[];
}
