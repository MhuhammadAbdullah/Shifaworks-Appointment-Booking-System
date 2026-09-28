/**
 * Slot engine — pure functions, no I/O. Used both to list bookable slots and
 * to re-validate a requested time inside the booking transaction, so search
 * results and booking checks can never disagree.
 *
 * Model (see docs/ARCHITECTURE.md §4):
 *  - Weekly rules are wall-clock intervals in the provider's IANA timezone.
 *  - Per local date: holiday / DAY_OFF / LEAVE / HOLIDAY exception → closed;
 *    CUSTOM_HOURS exceptions → replace the weekly rules; otherwise weekly rules
 *    of the applicable schedule.
 *  - The service itself [start, start+duration) must lie inside a working
 *    interval; the provider time it consumes [start−bufferBefore,
 *    end+bufferAfter) must not overlap busy time (other appointments incl.
 *    their buffers, blocked slots). Buffers may extend past working hours.
 *  - Candidates are generated on a grid of `step` minutes anchored at the
 *    start of each working interval and at the end of each busy block, so a
 *    free gap after an off-grid booking is still used.
 */
import { DateTime } from "luxon";

export interface WeeklyRule {
  dayOfWeek: number; // ISO 1 = Monday … 7 = Sunday
  startMinute: number;
  endMinute: number;
}

export interface ScheduleInput {
  effectiveFrom: string | null; // YYYY-MM-DD inclusive
  effectiveTo: string | null;
  isDefault: boolean;
  rules: WeeklyRule[];
}

export interface ExceptionInput {
  type: "CUSTOM_HOURS" | "DAY_OFF" | "LEAVE" | "HOLIDAY";
  startDate: string;
  endDate: string;
  startMinute: number | null;
  endMinute: number | null;
}

export interface HolidayInput {
  date: string; // YYYY-MM-DD
  isRecurring: boolean;
}

export interface Interval {
  start: Date;
  end: Date;
}

export interface ServiceTiming {
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  /** Grid step; defaults to duration + bufferAfter. */
  slotIntervalMinutes: number | null;
  minNoticeMinutes: number;
  maxAdvanceDays: number;
}

export interface AvailabilityData {
  timezone: string;
  schedules: ScheduleInput[];
  exceptions: ExceptionInput[];
  holidays: HolidayInput[];
  /** Absolute busy time: existing appointments (with their buffers) and blocked slots. */
  busy: Interval[];
}

export interface Slot {
  start: Date;
  end: Date;
  date: string; // local YYYY-MM-DD
  time: string; // local HH:MM
}

const MINUTE = 60_000;

// ---------------------------------------------------------------------------
// Working intervals
// ---------------------------------------------------------------------------

/** Wall-clock minute-of-day on a local date → absolute instant (DST-safe). */
function atLocalMinute(date: string, minute: number, zone: string): DateTime {
  const day = DateTime.fromISO(date, { zone });
  if (minute >= 1440) return day.plus({ days: 1 }).startOf("day");
  return day.set({ hour: Math.floor(minute / 60), minute: minute % 60, second: 0, millisecond: 0 });
}

function scheduleFor(date: string, schedules: ScheduleInput[]): ScheduleInput | null {
  const applicable = schedules.filter(
    (s) => (!s.effectiveFrom || s.effectiveFrom <= date) && (!s.effectiveTo || s.effectiveTo >= date),
  );
  // A dated (seasonal) schedule wins over the default; latest start wins among dated ones.
  const dated = applicable
    .filter((s) => !s.isDefault)
    .sort((a, b) => (b.effectiveFrom ?? "").localeCompare(a.effectiveFrom ?? ""));
  return dated[0] ?? applicable.find((s) => s.isDefault) ?? applicable[0] ?? null;
}

function isHoliday(date: string, holidays: HolidayInput[]): boolean {
  return holidays.some((h) => h.date === date || (h.isRecurring && h.date.slice(5) === date.slice(5)));
}

function mergeMinuteRanges(ranges: [number, number][]): [number, number][] {
  const sorted = ranges.filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

/** Working intervals (absolute) for one local date. */
export function workingIntervals(date: string, data: Pick<AvailabilityData, "timezone" | "schedules" | "exceptions" | "holidays">): Interval[] {
  if (isHoliday(date, data.holidays)) return [];
  const onDate = data.exceptions.filter((e) => e.startDate <= date && e.endDate >= date);
  if (onDate.some((e) => e.type !== "CUSTOM_HOURS")) return [];

  let ranges: [number, number][];
  const custom = onDate.filter((e) => e.type === "CUSTOM_HOURS" && e.startMinute !== null && e.endMinute !== null);
  if (custom.length) {
    ranges = custom.map((e) => [e.startMinute!, e.endMinute!]);
  } else {
    const schedule = scheduleFor(date, data.schedules);
    if (!schedule) return [];
    const weekday = DateTime.fromISO(date, { zone: data.timezone }).weekday;
    ranges = schedule.rules.filter((r) => r.dayOfWeek === weekday).map((r) => [r.startMinute, r.endMinute]);
  }
  return mergeMinuteRanges(ranges).map(([s, e]) => ({
    start: atLocalMinute(date, s, data.timezone).toJSDate(),
    end: atLocalMinute(date, e, data.timezone).toJSDate(),
  }));
}

// ---------------------------------------------------------------------------
// Slots
// ---------------------------------------------------------------------------

function overlaps(aStart: number, aEnd: number, busy: Interval[]): boolean {
  return busy.some((b) => aStart < b.end.getTime() && b.start.getTime() < aEnd);
}

function stepMinutes(t: ServiceTiming): number {
  return Math.max(5, t.slotIntervalMinutes ?? t.durationMinutes + t.bufferAfterMinutes);
}

function bookingWindow(t: ServiceTiming, now: Date): { earliest: number; latest: number } {
  return {
    earliest: now.getTime() + t.minNoticeMinutes * MINUTE,
    latest: now.getTime() + t.maxAdvanceDays * 1440 * MINUTE,
  };
}

/** Local calendar dates from..to inclusive. */
export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  let d = DateTime.fromISO(from, { zone: "UTC" });
  const end = DateTime.fromISO(to, { zone: "UTC" });
  while (d <= end && out.length < 400) {
    out.push(d.toISODate()!);
    d = d.plus({ days: 1 });
  }
  return out;
}

function toSlot(startMs: number, t: ServiceTiming, zone: string): Slot {
  const local = DateTime.fromMillis(startMs, { zone });
  return {
    start: new Date(startMs),
    end: new Date(startMs + t.durationMinutes * MINUTE),
    date: local.toISODate()!,
    time: local.toFormat("HH:mm"),
  };
}

/** All bookable slots for local dates [fromDate, toDate]. */
export function generateSlots(
  data: AvailabilityData,
  timing: ServiceTiming,
  fromDate: string,
  toDate: string,
  now: Date,
): Slot[] {
  const d = timing.durationMinutes * MINUTE;
  const bb = timing.bufferBeforeMinutes * MINUTE;
  const ba = timing.bufferAfterMinutes * MINUTE;
  const step = stepMinutes(timing) * MINUTE;
  const { earliest, latest } = bookingWindow(timing, now);
  const seen = new Set<number>();
  const slots: Slot[] = [];

  for (const date of eachDate(fromDate, toDate)) {
    for (const w of workingIntervals(date, data)) {
      const ws = w.start.getTime();
      const we = w.end.getTime();
      const anchors = [
        ws,
        ...data.busy.map((b) => b.end.getTime() + bb).filter((a) => a > ws && a < we),
      ].sort((a, b) => a - b);

      for (const anchor of anchors) {
        for (let s = anchor; s + d <= we; s += step) {
          if (overlaps(s - bb, s + d + ba, data.busy)) break; // the next anchor continues after this busy block
          if (s < earliest || s > latest || seen.has(s)) continue;
          seen.add(s);
          slots.push(toSlot(s, timing, data.timezone));
        }
      }
    }
  }
  return slots.sort((a, b) => a.start.getTime() - b.start.getTime());
}

export type SlotCheck =
  | { ok: true }
  | { ok: false; reason: "OUTSIDE_WORKING_HOURS" | "CONFLICT" | "TOO_SOON" | "TOO_FAR" | "NOT_ON_GRID" };

/**
 * Validates one requested start time.
 * strict = true (online bookings): the time must be one of the offered slots.
 * strict = false (staff bookings): any start that fits the availability.
 */
export function checkSlot(data: AvailabilityData, timing: ServiceTiming, start: Date, now: Date, strict: boolean): SlotCheck {
  const s = start.getTime();
  const d = timing.durationMinutes * MINUTE;
  const { earliest, latest } = bookingWindow(timing, now);
  if (s < earliest) return { ok: false, reason: "TOO_SOON" };
  if (s > latest) return { ok: false, reason: "TOO_FAR" };

  const localDate = DateTime.fromMillis(s, { zone: data.timezone }).toISODate()!;
  const inside = workingIntervals(localDate, data).some((w) => s >= w.start.getTime() && s + d <= w.end.getTime());
  if (!inside) return { ok: false, reason: "OUTSIDE_WORKING_HOURS" };
  if (overlaps(s - timing.bufferBeforeMinutes * MINUTE, s + d + timing.bufferAfterMinutes * MINUTE, data.busy)) {
    return { ok: false, reason: "CONFLICT" };
  }
  if (strict) {
    const offered = generateSlots(data, timing, localDate, localDate, now);
    if (!offered.some((o) => o.start.getTime() === s)) return { ok: false, reason: "NOT_ON_GRID" };
  }
  return { ok: true };
}

export const SLOT_CHECK_MESSAGES: Record<Exclude<SlotCheck, { ok: true }>["reason"], string> = {
  OUTSIDE_WORKING_HOURS: "The provider is not available at this time",
  CONFLICT: "This time overlaps another booking or a blocked period",
  TOO_SOON: "This time is too soon to book",
  TOO_FAR: "This time is too far in the future to book",
  NOT_ON_GRID: "Please choose one of the offered times",
};
