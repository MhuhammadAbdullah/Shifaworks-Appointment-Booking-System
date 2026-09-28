"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ServiceSlug } from "@booking/shared";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { usePublicAvailableDates, usePublicSlots } from "@/lib/api/public";
import { publicEnv } from "@/lib/env";
import { addDays, formatTime12, localDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { BaseBookingValues, StepProps } from "./wizard-types";

const WINDOW_DAYS = 61; // < MAX_DATE_RANGE_DAYS (62)
const WEEKDAY_HEADERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

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
  const [date, setDate] = useState<string | null>(startsAt ? startsAt.slice(0, 10) : null);
  // The first of the currently viewed month, clamped to the bookable window.
  const [viewMonth, setViewMonth] = useState(() => `${from.slice(0, 7)}-01`);

  const query = providerId && packageId ? { slug, providerId, packageId, from, to } : null;
  const dates = usePublicAvailableDates(query);
  const slots = usePublicSlots(date && query ? { ...query, date } : null);

  useEffect(() => {
    if (dates.data?.timezone) onTimezone(dates.data.timezone);
  }, [dates.data?.timezone, onTimezone]);

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
          <div className="p-3">
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
            <div className="grid w-96 grid-cols-7 gap-1" role="group" aria-label="Choose a date">
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
                      if (startsAt && !startsAt.startsWith(d)) form.setValue("startsAt" as never, "" as never, { shouldValidate: false });
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
                    slots.data.slots.map((s) => (
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
                    ))
                  ) : (
                    <p className="pt-6 text-center text-sm text-muted-foreground">No free times on this date.</p>
                  )}
                </div>
              </ScrollArea>
            </div>
          </div>
        </div>
      )}
      {dates.data && available.size === 0 && (
        <p className="text-sm text-muted-foreground">No free times in the next two months. Please contact support.</p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
