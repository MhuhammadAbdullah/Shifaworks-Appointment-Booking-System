import { z } from "zod";
import { AVAILABILITY_EXCEPTION_TYPES, type AvailabilityExceptionType } from "./enums.js";
import { timezoneSchema } from "./validation.js";

// ---------------------------------------------------------------------------
// Time helpers ("09:30" <-> 570 minutes from local midnight)
// ---------------------------------------------------------------------------

export const HHMM = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/;
export function hhmmToMinutes(v: string): number {
  const [h, m] = v.split(":").map(Number);
  return h! * 60 + m!;
}
export function minutesToHhmm(v: number): string {
  return `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`;
}

const intervalSchema = z
  .object({ start: z.string().regex(HHMM, "Use HH:MM"), end: z.string().regex(HHMM, "Use HH:MM") })
  .refine((i) => hhmmToMinutes(i.end) > hhmmToMinutes(i.start), { message: "End must be after start", path: ["end"] });
export type TimeInterval = z.infer<typeof intervalSchema>;

/** Rejects overlapping intervals within one day. */
function noOverlap(intervals: TimeInterval[]): boolean {
  const sorted = [...intervals].sort((a, b) => hhmmToMinutes(a.start) - hhmmToMinutes(b.start));
  return sorted.every((iv, i) => i === 0 || hhmmToMinutes(iv.start) >= hhmmToMinutes(sorted[i - 1]!.end));
}

const isoDate = z.iso.date("Use YYYY-MM-DD");

// ---------------------------------------------------------------------------
// Provider availability
// ---------------------------------------------------------------------------

/** Weekly hours: ISO weekday (1 = Monday … 7 = Sunday) → intervals. Breaks are the gaps. */
export const weeklyScheduleSchema = z.object({
  timezone: timezoneSchema,
  days: z
    .array(
      z.object({
        dayOfWeek: z.number().int().min(1).max(7),
        intervals: z.array(intervalSchema).max(8).refine(noOverlap, "Intervals overlap"),
      }),
    )
    .max(7)
    .refine((d) => new Set(d.map((x) => x.dayOfWeek)).size === d.length, "Each weekday may appear once"),
});
export type WeeklyScheduleInput = z.infer<typeof weeklyScheduleSchema>;

export const EXCEPTION_TYPE_LABELS: Record<AvailabilityExceptionType, string> = {
  CUSTOM_HOURS: "Custom hours",
  DAY_OFF: "Day off",
  LEAVE: "Leave",
  HOLIDAY: "Holiday",
};

/**
 * Specific dates: CUSTOM_HOURS replaces the weekly hours; the other types close the dates.
 * `serviceId` scopes the override to one of the provider's services — omitted, it applies to
 * all of them (a provider offering just one service never needs to set this).
 */
export const createExceptionSchema = z
  .object({
    type: z.enum(AVAILABILITY_EXCEPTION_TYPES),
    serviceId: z.uuid().optional(),
    startDate: isoDate,
    endDate: isoDate,
    intervals: z.array(intervalSchema).max(8).optional(),
    reason: z.string().trim().max(300).optional(),
  })
  .refine((v) => v.endDate >= v.startDate, { path: ["endDate"], message: "End date is before start date" })
  .refine((v) => v.type !== "CUSTOM_HOURS" || (v.intervals && v.intervals.length > 0), {
    path: ["intervals"],
    message: "Add at least one interval",
  })
  .refine((v) => !v.intervals || noOverlap(v.intervals), { path: ["intervals"], message: "Intervals overlap" })
  .refine((v) => (Date.parse(v.endDate) - Date.parse(v.startDate)) / 86_400_000 <= 366, {
    path: ["endDate"],
    message: "At most one year",
  });
export type CreateExceptionInput = z.infer<typeof createExceptionSchema>;

/** Several single-date exceptions saved together (e.g. a calendar multi-select of custom-hours days), one transaction. */
export const bulkCreateExceptionsSchema = z.object({
  items: z.array(createExceptionSchema).min(1).max(62),
});
export type BulkCreateExceptionsInput = z.infer<typeof bulkCreateExceptionsSchema>;

/** One-off blocked time (meeting, training), absolute instants. */
export const createBlockedSlotSchema = z
  .object({
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    reason: z.string().trim().max(300).optional(),
  })
  .refine((v) => Date.parse(v.endsAt) > Date.parse(v.startsAt), { path: ["endsAt"], message: "End must be after start" })
  .refine((v) => Date.parse(v.endsAt) - Date.parse(v.startsAt) <= 31 * 86_400_000, {
    path: ["endsAt"],
    message: "Block at most 31 days at once; use Leave for longer absences",
  });
export type CreateBlockedSlotInput = z.infer<typeof createBlockedSlotSchema>;

export const createHolidaySchema = z.object({
  name: z.string().trim().min(2).max(120),
  date: isoDate,
  isRecurring: z.boolean().default(false),
});
export type CreateHolidayInput = z.infer<typeof createHolidaySchema>;

export interface AvailabilityDto {
  providerId: string;
  displayName: string;
  timezone: string;
  weekly: { dayOfWeek: number; intervals: TimeInterval[] }[];
  exceptions: {
    id: string;
    type: AvailabilityExceptionType;
    /** null = applies to every service the provider offers. */
    serviceId: string | null;
    startDate: string;
    endDate: string;
    intervals: TimeInterval[];
    reason: string | null;
  }[];
  blockedSlots: { id: string; startsAt: string; endsAt: string; reason: string | null }[];
}

export interface HolidayDto {
  id: string;
  name: string;
  date: string;
  isRecurring: boolean;
}

// ---------------------------------------------------------------------------
// Slots (computed on the backend only; the browser never derives availability)
// ---------------------------------------------------------------------------

export const MAX_DATE_RANGE_DAYS = 62;

const slotBase = {
  serviceId: z.uuid(),
  providerId: z.uuid(),
  /** Sets the duration; omitted => the service default. */
  packageId: z.uuid().optional(),
};

export const availableDatesQuerySchema = z
  .object({ ...slotBase, from: isoDate, to: isoDate })
  .refine((v) => v.to >= v.from, { path: ["to"], message: "'to' is before 'from'" })
  .refine((v) => (Date.parse(v.to) - Date.parse(v.from)) / 86_400_000 < MAX_DATE_RANGE_DAYS, {
    path: ["to"],
    message: `At most ${MAX_DATE_RANGE_DAYS} days per request`,
  });
export type AvailableDatesQuery = z.infer<typeof availableDatesQuerySchema>;

export const slotsQuerySchema = z.object({ ...slotBase, date: isoDate });
export type SlotsQuery = z.infer<typeof slotsQuerySchema>;

export interface SlotDto {
  startsAt: string; // ISO UTC
  endsAt: string;
  /** Local wall-clock in the provider's timezone, for display. */
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
}

export interface AvailableDatesDto {
  timezone: string;
  durationMinutes: number;
  dates: string[];
  /** In-window dates the provider isn't open at all that day (day off, leave, holiday) — distinct from a day that's open but fully booked. */
  closedDates: string[];
}

export interface SlotsDto {
  timezone: string;
  durationMinutes: number;
  date: string;
  slots: SlotDto[];
}
