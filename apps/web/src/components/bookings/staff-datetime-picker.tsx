"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MonthCalendar } from "@/components/calendar/month-calendar";
import { useAvailableDates, useSlots } from "@/lib/api/catalog";
import { useMe } from "@/lib/auth/hooks";
import { formatTime, localDate } from "@/lib/format";

/** Staff date/time picker: the same backend engine as the public forms, no minimum-notice limit. */
export function StaffDateTimePicker({
  serviceId,
  providerId,
  packageId,
  value,
  onChange,
}: {
  serviceId: string | null;
  providerId: string | null;
  packageId: string | null;
  value: string | null;
  onChange: (iso: string) => void;
}) {
  const { data: me } = useMe();
  const timezone = me?.organization.timezone ?? "Asia/Karachi";
  const today = localDate(new Date(), timezone);
  const [date, setDate] = useState<string | null>(value ? value.slice(0, 10) : null);
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);

  const base = serviceId && providerId && packageId ? { serviceId, providerId, packageId } : null;
  const dates = useAvailableDates(base && range ? { ...base, ...range } : null);
  const slots = useSlots(base && date ? { ...base, date } : null);

  useEffect(() => setDate(null), [serviceId, providerId, packageId]);

  if (!base) return <p className="text-sm text-muted-foreground">Choose a provider and an option first.</p>;

  return (
    <div className="grid gap-3">
      {dates.error ? (
        <p className="text-sm text-destructive">{dates.error.message}</p>
      ) : (
        <MonthCalendar
          availableDates={new Set(dates.data?.dates ?? [])}
          selected={date}
          onSelect={setDate}
          onVisibleRangeChange={(from, to) => setRange({ from, to })}
          minDate={today}
          loading={dates.isPending}
        />
      )}

      {date && (
        <div className="grid gap-2">
          <p className="text-sm font-medium">{date}</p>
          {slots.isPending ? (
            <Skeleton className="h-10 w-full" />
          ) : slots.data?.slots.length ? (
            <div className="flex flex-wrap gap-1.5">
              {slots.data.slots.map((s) => (
                <Button
                  key={s.startsAt}
                  type="button"
                  variant={value === s.startsAt ? "default" : "outline"}
                  aria-pressed={value === s.startsAt}
                  onClick={() => onChange(s.startsAt)}
                >
                  {formatTime(s.startsAt, slots.data.timezone)}
                </Button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No free times on this date.</p>
          )}
        </div>
      )}
    </div>
  );
}
