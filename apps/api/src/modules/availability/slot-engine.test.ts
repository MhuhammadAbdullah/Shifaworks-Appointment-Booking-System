import { describe, expect, it } from "vitest";
import {
  checkSlot,
  generateSlots,
  workingIntervals,
  type AvailabilityData,
  type ServiceTiming,
  type WeeklyRule,
} from "./slot-engine.js";

const TZ = "Asia/Karachi"; // UTC+5, no DST
const MON = "2026-10-05";
const TUE = "2026-10-06";
const WED = "2026-10-07";
const EARLY_NOW = new Date("2026-09-01T00:00:00Z");
const h = (hh: number, mm = 0) => hh * 60 + mm;
/** Local Karachi wall-clock on a date → UTC Date. */
const k = (date: string, time: string) => new Date(`${date}T${time}:00+05:00`);

// Spec schedule: Mon 09-13 + 14-18, Tue OFF, Wed 10-16
const SPEC_RULES: WeeklyRule[] = [
  { dayOfWeek: 1, startMinute: h(9), endMinute: h(13) },
  { dayOfWeek: 1, startMinute: h(14), endMinute: h(18) },
  { dayOfWeek: 3, startMinute: h(10), endMinute: h(16) },
];

function data(over: Partial<AvailabilityData> = {}): AvailabilityData {
  return {
    timezone: TZ,
    schedules: [{ effectiveFrom: null, effectiveTo: null, isDefault: true, rules: SPEC_RULES }],
    exceptions: [],
    holidays: [],
    busy: [],
    ...over,
  };
}

function timing(over: Partial<ServiceTiming> = {}): ServiceTiming {
  return {
    durationMinutes: 60,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
    slotIntervalMinutes: null,
    minNoticeMinutes: 0,
    maxAdvanceDays: 365,
    ...over,
  };
}

const times = (slots: { time: string }[]) => slots.map((s) => s.time);
const morningOnly = (over: Partial<AvailabilityData> = {}) =>
  data({
    schedules: [{ effectiveFrom: null, effectiveTo: null, isDefault: true, rules: [{ dayOfWeek: 1, startMinute: h(9), endMinute: h(13) }] }],
    ...over,
  });

describe("specification examples", () => {
  it("09:00-13:00, 60 min → 09:00, 10:00, 11:00, 12:00", () => {
    expect(times(generateSlots(morningOnly(), timing(), MON, MON, EARLY_NOW))).toEqual(["09:00", "10:00", "11:00", "12:00"]);
  });

  it("with a 15 minute buffer → 09:00, 10:15, 11:30", () => {
    expect(times(generateSlots(morningOnly(), timing({ bufferAfterMinutes: 15 }), MON, MON, EARLY_NOW))).toEqual([
      "09:00",
      "10:15",
      "11:30",
    ]);
  });
});

describe("weekly schedule", () => {
  it("honours breaks between intervals", () => {
    const t = times(generateSlots(data(), timing(), MON, MON, EARLY_NOW));
    expect(t).toEqual(["09:00", "10:00", "11:00", "12:00", "14:00", "15:00", "16:00", "17:00"]);
    expect(t).not.toContain("13:00");
  });

  it("returns nothing on a day off", () => {
    expect(generateSlots(data(), timing(), TUE, TUE, EARLY_NOW)).toEqual([]);
  });

  it("converts local wall-clock to UTC (Karachi 09:00 = 04:00Z)", () => {
    const [first] = generateSlots(data(), timing(), MON, MON, EARLY_NOW);
    expect(first?.start.toISOString()).toBe("2026-10-05T04:00:00.000Z");
    expect(first?.end.toISOString()).toBe("2026-10-05T05:00:00.000Z");
  });

  it("spans multiple days in date order", () => {
    const slots = generateSlots(data(), timing({ durationMinutes: 120 }), MON, WED, EARLY_NOW);
    expect(slots.map((s) => `${s.date} ${s.time}`)).toEqual([
      `${MON} 09:00`,
      `${MON} 11:00`,
      `${MON} 14:00`,
      `${MON} 16:00`,
      `${WED} 10:00`,
      `${WED} 12:00`,
      `${WED} 14:00`,
    ]);
  });

  it("supports a custom slot interval shorter than the duration", () => {
    const t = times(generateSlots(morningOnly(), timing({ slotIntervalMinutes: 30 }), MON, MON, EARLY_NOW));
    expect(t).toEqual(["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00"]);
  });

  it("a dated seasonal schedule overrides the default", () => {
    const d = data({
      schedules: [
        { effectiveFrom: null, effectiveTo: null, isDefault: true, rules: SPEC_RULES },
        { effectiveFrom: "2026-10-01", effectiveTo: "2026-10-31", isDefault: false, rules: [{ dayOfWeek: 1, startMinute: h(16), endMinute: h(18) }] },
      ],
    });
    expect(times(generateSlots(d, timing(), MON, MON, EARLY_NOW))).toEqual(["16:00", "17:00"]);
    // outside the seasonal range the default applies again
    expect(times(generateSlots(d, timing(), "2026-11-02", "2026-11-02", EARLY_NOW))).toHaveLength(8);
  });
});

describe("existing bookings and blocked time", () => {
  it("skips an existing booking", () => {
    const busy = [{ start: k(MON, "10:00"), end: k(MON, "11:00") }];
    expect(times(generateSlots(morningOnly({ busy }), timing(), MON, MON, EARLY_NOW))).toEqual(["09:00", "11:00", "12:00"]);
  });

  it("re-anchors after an off-grid booking so the gap is still used", () => {
    const busy = [{ start: k(MON, "10:30"), end: k(MON, "11:45") }];
    const t = times(generateSlots(morningOnly({ busy }), timing({ bufferAfterMinutes: 15 }), MON, MON, EARLY_NOW));
    expect(t).toEqual(["09:00", "11:45"]);
  });

  it("respects buffer-before after a busy block", () => {
    const busy = [{ start: k(MON, "09:00"), end: k(MON, "10:00") }];
    const t = times(generateSlots(morningOnly({ busy }), timing({ bufferBeforeMinutes: 15 }), MON, MON, EARLY_NOW));
    expect(t[0]).toBe("10:15");
  });

  it("buffer-after may extend past closing time but not into another booking", () => {
    // 12:00-13:00 fits even though its 15 min buffer ends at 13:15 (provider is off by then)
    expect(times(generateSlots(morningOnly(), timing({ bufferAfterMinutes: 15, slotIntervalMinutes: 60 }), MON, MON, EARLY_NOW))).toContain(
      "12:00",
    );
    // …but a booking at 13:00 (afternoon) would be hit by the buffer
    const busy = [{ start: k(MON, "14:00"), end: k(MON, "15:00") }];
    const t = times(generateSlots(data({ busy }), timing({ bufferAfterMinutes: 15, slotIntervalMinutes: 60 }), MON, MON, EARLY_NOW));
    expect(t).toContain("12:00"); // lunch break separates it
    expect(t).not.toContain("14:00");
  });

  it("a blocked slot covering the morning removes it", () => {
    const busy = [{ start: k(MON, "08:00"), end: k(MON, "13:00") }];
    expect(times(generateSlots(data({ busy }), timing(), MON, MON, EARLY_NOW))).toEqual(["14:00", "15:00", "16:00", "17:00"]);
  });

  it("adjacent bookings are allowed (half-open intervals)", () => {
    const busy = [{ start: k(MON, "09:00"), end: k(MON, "10:00") }];
    expect(times(generateSlots(morningOnly({ busy }), timing(), MON, MON, EARLY_NOW))[0]).toBe("10:00");
  });
});

describe("exceptions and holidays", () => {
  it("DAY_OFF / LEAVE ranges close every date in the range", () => {
    const d = data({ exceptions: [{ type: "LEAVE", startDate: MON, endDate: WED, startMinute: null, endMinute: null }] });
    expect(generateSlots(d, timing(), MON, WED, EARLY_NOW)).toEqual([]);
    expect(generateSlots(d, timing(), "2026-10-12", "2026-10-12", EARLY_NOW)).not.toEqual([]);
  });

  it("CUSTOM_HOURS replace the weekly rules, even on a normal day off", () => {
    const d = data({
      exceptions: [
        { type: "CUSTOM_HOURS", startDate: TUE, endDate: TUE, startMinute: h(15), endMinute: h(17) },
        { type: "CUSTOM_HOURS", startDate: MON, endDate: MON, startMinute: h(8), endMinute: h(9) },
      ],
    });
    expect(times(generateSlots(d, timing(), TUE, TUE, EARLY_NOW))).toEqual(["15:00", "16:00"]);
    expect(times(generateSlots(d, timing(), MON, MON, EARLY_NOW))).toEqual(["08:00"]);
  });

  it("a closure exception wins over custom hours on the same date", () => {
    const d = data({
      exceptions: [
        { type: "CUSTOM_HOURS", startDate: MON, endDate: MON, startMinute: h(8), endMinute: h(9) },
        { type: "DAY_OFF", startDate: MON, endDate: MON, startMinute: null, endMinute: null },
      ],
    });
    expect(generateSlots(d, timing(), MON, MON, EARLY_NOW)).toEqual([]);
  });

  it("organisation holidays close the day; recurring holidays repeat yearly", () => {
    expect(generateSlots(data({ holidays: [{ date: MON, isRecurring: false }] }), timing(), MON, MON, EARLY_NOW)).toEqual([]);
    const recurring = data({ holidays: [{ date: "2020-10-05", isRecurring: true }] });
    expect(generateSlots(recurring, timing(), MON, MON, EARLY_NOW)).toEqual([]);
  });

  it("workingIntervals merges overlapping rules", () => {
    const d = data({
      schedules: [
        {
          effectiveFrom: null,
          effectiveTo: null,
          isDefault: true,
          rules: [
            { dayOfWeek: 1, startMinute: h(9), endMinute: h(12) },
            { dayOfWeek: 1, startMinute: h(11), endMinute: h(13) },
          ],
        },
      ],
    });
    const w = workingIntervals(MON, d);
    expect(w).toHaveLength(1);
    expect(w[0]?.end.toISOString()).toBe(k(MON, "13:00").toISOString());
  });
});

describe("booking window", () => {
  it("minimum notice hides slots that start too soon", () => {
    const now = k(MON, "09:30");
    expect(times(generateSlots(morningOnly(), timing({ minNoticeMinutes: 60 }), MON, MON, now))).toEqual(["11:00", "12:00"]);
  });

  it("slots in the past are never offered", () => {
    expect(times(generateSlots(morningOnly(), timing(), MON, MON, k(MON, "11:00")))).toEqual(["11:00", "12:00"]);
  });

  it("max advance days caps how far ahead", () => {
    const now = k("2026-10-01", "00:00");
    expect(generateSlots(data(), timing({ maxAdvanceDays: 3 }), MON, MON, now)).toEqual([]);
    expect(generateSlots(data(), timing({ maxAdvanceDays: 5 }), MON, MON, now)).not.toEqual([]);
  });
});

describe("timezones", () => {
  it("handles a DST change (Europe/London spring forward)", () => {
    const d: AvailabilityData = {
      timezone: "Europe/London",
      schedules: [{ effectiveFrom: null, effectiveTo: null, isDefault: true, rules: [{ dayOfWeek: 7, startMinute: h(0), endMinute: h(4) }] }],
      exceptions: [],
      holidays: [],
      busy: [],
    };
    // 29 Mar 2026: 01:00 → 02:00. 00:00-04:00 local is only 3 real hours.
    const [w] = workingIntervals("2026-03-29", d);
    expect((w!.end.getTime() - w!.start.getTime()) / 3_600_000).toBe(3);
    // and summer 09:00 London is 08:00Z
    const summer = { ...d, schedules: [{ ...d.schedules[0]!, rules: [{ dayOfWeek: 1, startMinute: h(9), endMinute: h(10) }] }] };
    const januaryNow = new Date("2026-01-01T00:00:00Z");
    expect(generateSlots(summer, timing(), "2026-06-01", "2026-06-01", januaryNow)[0]?.start.toISOString()).toBe(
      "2026-06-01T08:00:00.000Z",
    );
  });
});

describe("checkSlot", () => {
  const busy = [{ start: k(MON, "11:00"), end: k(MON, "12:00") }];

  it("accepts an offered slot in strict mode", () => {
    expect(checkSlot(morningOnly(), timing(), k(MON, "10:00"), EARLY_NOW, true)).toEqual({ ok: true });
  });

  it("accepts an off-grid time for staff but not online", () => {
    expect(checkSlot(morningOnly(), timing(), k(MON, "09:30"), EARLY_NOW, false)).toEqual({ ok: true });
    expect(checkSlot(morningOnly(), timing(), k(MON, "09:30"), EARLY_NOW, true)).toEqual({ ok: false, reason: "NOT_ON_GRID" });
  });

  it("rejects conflicts, including through buffers", () => {
    expect(checkSlot(morningOnly({ busy }), timing(), k(MON, "11:30"), EARLY_NOW, false)).toMatchObject({ reason: "CONFLICT" });
    expect(checkSlot(morningOnly({ busy }), timing({ bufferAfterMinutes: 15 }), k(MON, "10:00"), EARLY_NOW, false)).toMatchObject({
      reason: "CONFLICT",
    });
  });

  it("rejects times outside working hours, overrunning closing, too soon and too far", () => {
    expect(checkSlot(morningOnly(), timing(), k(MON, "08:00"), EARLY_NOW, false)).toMatchObject({ reason: "OUTSIDE_WORKING_HOURS" });
    expect(checkSlot(morningOnly(), timing(), k(MON, "12:30"), EARLY_NOW, false)).toMatchObject({ reason: "OUTSIDE_WORKING_HOURS" });
    expect(checkSlot(morningOnly(), timing(), k(TUE, "10:00"), EARLY_NOW, false)).toMatchObject({ reason: "OUTSIDE_WORKING_HOURS" });
    expect(checkSlot(morningOnly(), timing({ minNoticeMinutes: 120 }), k(MON, "10:00"), k(MON, "09:00"), false)).toMatchObject({
      reason: "TOO_SOON",
    });
    expect(checkSlot(morningOnly(), timing({ maxAdvanceDays: 1 }), k(MON, "10:00"), EARLY_NOW, false)).toMatchObject({ reason: "TOO_FAR" });
  });
});
