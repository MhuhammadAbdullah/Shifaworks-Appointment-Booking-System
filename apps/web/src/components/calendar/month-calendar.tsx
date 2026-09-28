"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const WEEKDAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface Cursor {
  year: number;
  month: number; // 0-based
}

const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (c: Cursor, day: number) => `${c.year}-${pad(c.month + 1)}-${pad(day)}`;
const daysInMonth = (c: Cursor) => new Date(Date.UTC(c.year, c.month + 1, 0)).getUTCDate();
const firstWeekday = (c: Cursor) => new Date(Date.UTC(c.year, c.month, 1)).getUTCDay();
const monthsBetween = (a: Cursor, b: Cursor) => (b.year - a.year) * 12 + (b.month - a.month);
const shiftMonth = (c: Cursor, by: number): Cursor => {
  const total = c.year * 12 + c.month + by;
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
};

/** A real month-grid calendar: 1st to last date of the visible month, aligned under Sun–Sat columns. */
export function MonthCalendar({
  availableDates,
  selected,
  onSelect,
  onVisibleRangeChange,
  minDate,
  maxMonthsAhead = 3,
  loading = false,
}: {
  /** Bookable dates (YYYY-MM-DD) for the currently visible month — refetch when the range changes. */
  availableDates: Set<string>;
  selected: string | null;
  onSelect: (date: string) => void;
  /** Fires with the visible month's first/last date whenever it changes, including on mount. */
  onVisibleRangeChange: (from: string, to: string) => void;
  /** ISO date; days and months before this are disabled. Defaults to today. */
  minDate?: string;
  /** How many months forward from the starting month can be navigated to. */
  maxMonthsAhead?: number;
  loading?: boolean;
}) {
  const today = minDate ?? new Date().toISOString().slice(0, 10);
  const todayCursor: Cursor = { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) - 1 };
  const [cursor, setCursor] = useState<Cursor>(todayCursor);

  const from = isoOf(cursor, 1);
  const lastDay = daysInMonth(cursor);
  const to = isoOf(cursor, lastDay);

  useEffect(() => onVisibleRangeChange(from, to), [from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  const offset = monthsBetween(todayCursor, cursor);
  const atMin = offset <= 0;
  const atMax = offset >= maxMonthsAhead;
  const leading = firstWeekday(cursor);
  const trailing = (7 - ((leading + lastDay) % 7)) % 7;
  const monthLabel = new Date(Date.UTC(cursor.year, cursor.month, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <Button type="button" variant="ghost" size="icon" disabled={atMin} aria-label="Previous month" onClick={() => setCursor((c) => shiftMonth(c, -1))}>
          <ChevronLeft className="size-4" />
        </Button>
        <p className="text-sm font-medium">{monthLabel}</p>
        <Button type="button" variant="ghost" size="icon" disabled={atMax} aria-label="Next month" onClick={() => setCursor((c) => shiftMonth(c, 1))}>
          <ChevronRight className="size-4" />
        </Button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-muted-foreground">
        {WEEKDAY_HEADERS.map((w) => (
          <div key={w}>{w}</div>
        ))}
      </div>
      {loading ? (
        <Skeleton className="mt-1.5 h-56 w-full" />
      ) : (
        <div className="mt-1.5 grid grid-cols-7 gap-1.5" role="group" aria-label="Choose a date">
          {Array.from({ length: leading }, (_, i) => (
            <div key={`lead-${i}`} aria-hidden="true" />
          ))}
          {Array.from({ length: lastDay }, (_, i) => {
            const d = isoOf(cursor, i + 1);
            const open = d >= today && availableDates.has(d);
            const active = selected === d;
            return (
              <Button
                key={d}
                type="button"
                size="sm"
                variant={active ? "default" : "outline"}
                disabled={!open}
                aria-pressed={active}
                className={cn("h-9 w-full p-0 text-sm font-normal", !open && "opacity-40")}
                onClick={() => onSelect(d)}
              >
                {i + 1}
              </Button>
            );
          })}
          {Array.from({ length: trailing }, (_, i) => (
            <div key={`trail-${i}`} aria-hidden="true" />
          ))}
        </div>
      )}
    </div>
  );
}
