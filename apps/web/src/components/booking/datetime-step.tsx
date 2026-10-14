"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ServiceSlug } from "@booking/shared";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { usePublicAvailableDates, usePublicSlots } from "@/lib/api/public";
import { publicEnv } from "@/lib/env";
import { addDays, formatDate, formatTime12, localDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { isSlotOffered, zonedDate } from "./prefill";
import type { BaseBookingValues, StepProps } from "./wizard-types";

const WINDOW_DAYS = 61; // < MAX_DATE_RANGE_DAYS (62)
const WEEKDAY_HEADERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Morning / afternoon / evening, by the slot's own local "HH:MM" (what the visitor reads on a clock). */
const PERIODS = [
  { key: "morning", label: "Morning", test: (hour: number) => hour < 12 },
  { key: "afternoon", label: "Afternoon", test: (hour: number) => hour >= 12 && hour < 17 },
  { key: "evening", label: "Evening", test: (hour: number) => hour >= 17 },
];

/** ISO weekday, Monday-first (0 = Monday .. 6 = Sunday), for a "YYYY-MM-DD" string treated as UTC. */
function mondayFirstWeekday(isoDate: string): number {
  return (new Date(`${isoDate}T00:00:00Z`).getUTCDay() + 6) % 7;
}

function monthLabel(isoDate: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(`${isoDate}T00:00:00Z`));
}

export function DateTimeStep<TValues extends BaseBookingValues>({
  form,
  slug,
  onTimezone,
}: StepProps<TValues> & { slug: ServiceSlug; onTimezone: (tz: string) => void }) {
  const watched = form.watch();
  const providerId = watched.providerId;
  const packageId = watched.packageId;
  const startsAt = watched.startsAt;
  const error = (form.formState.errors as Record<string, { message?: string } | undefined>).startsAt?.message;

  const from = useMemo(() => localDate(new Date(), publicEnv.NEXT_PUBLIC_DEFAULT_TIMEZONE), []);
  const to = useMemo(() => addDays(from, WINDOW_DAYS), [from]);
  // The calendar day of a prefilled/previously chosen time, in the clinic's zone - not slice(0, 10) of
  // the UTC instant, which lands on the previous day for early-morning slots east of UTC.
  const [date, setDate] = useState<string | null>(() =>
    startsAt ? zonedDate(startsAt, publicEnv.NEXT_PUBLIC_DEFAULT_TIMEZONE) : null,
  );
  // The first of the currently viewed month, clamped to the bookable window.
  const [viewMonth, setViewMonth] = useState(() => `${(date && date >= from && date <= to ? date : from).slice(0, 7)}-01`);

  const query = providerId && packageId ? { slug, providerId, packageId, from, to } : null;
  const dates = usePublicAvailableDates(query);
  const slots = usePublicSlots(date && query ? { ...query, date } : null);

  useEffect(() => {
    if (dates.data?.timezone) onTimezone(dates.data.timezone);
  }, [dates.data?.timezone, onTimezone]);

  // A chosen time that the API no longer offers (taken meanwhile, or a stale link) is dropped rather than
  // silently submitted; the server would reject it anyway.
  const [timeGone, setTimeGone] = useState(false);
  useEffect(() => {
    if (!startsAt || !slots.data || slots.data.date !== date) return;
    if (!isSlotOffered(slots.data.slots, startsAt)) {
      form.setValue("startsAt" as never, "" as never, { shouldValidate: false });
      setTimeGone(true);
    }
  }, [slots.data, startsAt, date, form]);

  const available = new Set(dates.data?.dates ?? []);
  const closed = new Set(dates.data?.closedDates ?? []);

  const minMonth = from.slice(0, 7);
  const maxMonth = to.slice(0, 7);
  const canGoPrev = viewMonth.slice(0, 7) > minMonth;
  const canGoNext = viewMonth.slice(0, 7) < maxMonth;

  function shiftMonth(delta: number) {
    const d = new Date(`${viewMonth}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + delta);
    setViewMonth(d.toISOString().slice(0, 8) + "01");
  }

  const cells = useMemo(() => {
    const leading = mondayFirstWeekday(viewMonth);
    const daysInMonth = new Date(Date.UTC(Number(viewMonth.slice(0, 4)), Number(viewMonth.slice(5, 7)), 0)).getUTCDate();
    const out: (string | null)[] = Array.from({ length: leading }, () => null);
    for (let d = 0; d < daysInMonth; d++) out.push(addDays(viewMonth, d));
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [viewMonth]);

  function chooseTime(iso: string) {
    form.setValue("startsAt" as never, iso as never, { shouldDirty: true, shouldValidate: true });
  }

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">Pick a date and time that works for you.</p>

      {dates.isPending ? (
        <Skeleton className="h-72 w-full" />
      ) : dates.error ? (
        <p className="text-sm text-destructive">{dates.error.message}</p>
      ) : (
        <div className="flex flex-col divide-y overflow-hidden rounded-lg border bg-background sm:flex-row sm:divide-x sm:divide-y-0">
          <div className="p-3 sm:shrink-0">
            <div className="mb-2 flex items-center justify-between">
              <Button type="button" variant="ghost" size="icon" className="size-7" disabled={!canGoPrev} onClick={() => shiftMonth(-1)} aria-label="Previous month">
                <ChevronLeft className="size-4" />
              </Button>
              <p className="text-sm font-medium">{monthLabel(viewMonth)}</p>
              <Button type="button" variant="ghost" size="icon" className="size-7" disabled={!canGoNext} onClick={() => shiftMonth(1)} aria-label="Next month">
                <ChevronRight className="size-4" />
              </Button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted-foreground">
              {WEEKDAY_HEADERS.map((w) => (
                <div key={w} className="py-1">
                  {w}
                </div>
              ))}
            </div>
            <div className="grid w-full grid-cols-7 gap-1 sm:w-80" role="group" aria-label="Choose a date">
              {cells.map((d, i) => {
                if (!d) return <div key={i} />;
                const inWindow = d >= from && d <= to;
                const open = inWindow && available.has(d);
                const fullyBooked = inWindow && !open && !closed.has(d);
                const active = date === d;
                return (
                  <button
                    key={d}
                    type="button"
                    disabled={!open}
                    aria-pressed={active}
                    title={fullyBooked ? "Fully booked" : undefined}
                    className={cn(
                      "flex aspect-square flex-col items-center justify-center gap-0.5 rounded-md text-sm transition-colors",
                      open && !active && "hover:bg-accent",
                      active && "bg-[#86C242] text-[#14210a]",
                      !inWindow && "text-muted-foreground/30",
                      inWindow && !open && "cursor-not-allowed text-muted-foreground/50",
                      fullyBooked && "line-through decoration-1",
                    )}
                    onClick={() => {
                      setDate(d);
                      setTimeGone(false);
                      if (startsAt && !(slots.data?.date === d && isSlotOffered(slots.data.slots, startsAt))) {
                        form.setValue("startsAt" as never, "" as never, { shouldValidate: false });
                      }
                    }}
                  >
                    <span>{Number(d.slice(8))}</span>
                    {fullyBooked && <span className="text-[8px] leading-none">Full</span>}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="text-muted-foreground/50 line-through decoration-1">12</span> = Fully booked
            </p>
          </div>

          <div className="relative h-72 w-full sm:h-auto sm:w-64">
            <div className="absolute inset-0 flex flex-col">
              <p className="px-4 pt-4 pb-2 text-center text-sm font-medium">Available times</p>
              <ScrollArea className="min-h-0 flex-1">
                <div className="grid grid-cols-1 gap-2 px-4 pb-4">
                  {!date ? (
                    <p className="pt-6 text-center text-sm text-muted-foreground">Pick a date first.</p>
                  ) : slots.isPending ? (
                    <Skeleton className="h-9 w-full" />
                  ) : slots.data?.slots.length ? (
                    PERIODS.map((period) => {
                      const inPeriod = slots.data.slots.filter((s) => period.test(Number(s.time.slice(0, 2))));
                      if (inPeriod.length === 0) return null;
                      return (
                        <div key={period.key} className="grid gap-2">
                          <p className="pt-1 text-xs font-medium text-muted-foreground">{period.label}</p>
                          <div className="grid grid-cols-2 gap-2">
                            {inPeriod.map((s) => (
                              <Button
                                key={s.startsAt}
                                type="button"
                                size="sm"
                                variant={startsAt === s.startsAt ? "default" : "outline"}
                                aria-pressed={startsAt === s.startsAt}
                                className={startsAt === s.startsAt ? "bg-[#86C242] text-[#14210a] hover:bg-[#72A538]" : undefined}
                                onClick={() => chooseTime(s.startsAt)}
                              >
                                {formatTime12(s.startsAt, slots.data.timezone)}
                              </Button>
                            ))}
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <p className="pt-6 text-center text-sm text-muted-foreground">No free times on this date.</p>
                  )}
                </div>
              </ScrollArea>
            </div>
          </div>
        </div>
      )}
      {startsAt && (
        <p className="rounded-md border border-[#86C242]/60 bg-[#86C242]/10 p-3 text-sm" aria-live="polite">
          Selected: <span className="font-medium">{formatDate(startsAt, dates.data?.timezone ?? publicEnv.NEXT_PUBLIC_DEFAULT_TIMEZONE)}</span> at{" "}
          <span className="font-medium">{formatTime12(startsAt, dates.data?.timezone ?? publicEnv.NEXT_PUBLIC_DEFAULT_TIMEZONE)}</span>
        </p>
      )}
      {dates.data && available.size === 0 && (
        <p className="text-sm text-muted-foreground">No free times in the next two months. Please contact support.</p>
      )}
      {timeGone && !startsAt && <p className="text-sm text-destructive">That time is no longer available. Please choose another.</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
