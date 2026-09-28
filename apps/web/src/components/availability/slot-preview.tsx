"use client";

import { useState } from "react";
import type { ProviderDto } from "@booking/shared";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { MonthCalendar } from "@/components/calendar/month-calendar";
import { useAvailableDates, useServices, useSlots } from "@/lib/api/catalog";
import { useMe } from "@/lib/auth/hooks";
import { localDate } from "@/lib/format";

/**
 * Shows the dates and start times the backend offers for one provider,
 * service and package: the same engine the booking forms use (without the
 * minimum-notice limit, as for staff bookings).
 */
export function SlotPreview({ provider }: { provider: ProviderDto }) {
  const services = useServices();
  const linked = provider.services.filter((s) => s.linkActive);
  const [serviceId, setServiceId] = useState<string>(linked[0]?.id ?? "");
  const service = services.data?.find((s) => s.id === serviceId);
  const packages = service?.packages.filter((p) => p.isActive) ?? [];
  const [packageId, setPackageId] = useState<string>("default");
  const [date, setDate] = useState<string | null>(null);
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);

  const { data: me } = useMe();
  const orgTimezone = me?.organization.timezone ?? "Asia/Karachi";
  const today = localDate(new Date(), orgTimezone);
  const base = serviceId ? { serviceId, providerId: provider.id, ...(packageId !== "default" ? { packageId } : {}) } : null;
  const dates = useAvailableDates(base && range ? { ...base, ...range } : null);
  const slots = useSlots(base && date ? { ...base, date } : null);

  if (!linked.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Bookable times</CardTitle>
          <CardDescription>Assign a service to this provider to see their bookable times.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const available = new Set(dates.data?.dates ?? []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bookable times</CardTitle>
        <CardDescription>
          What customers can pick, after weekly hours, leave, holidays, blocked time, buffers and existing bookings.{" "}
          {dates.data && `Times in ${dates.data.timezone}; ${dates.data.durationMinutes} min sessions.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="sp-service">Service</Label>
            <Select
              value={serviceId}
              onValueChange={(v) => {
                setServiceId(v);
                setPackageId("default");
                setDate(null);
              }}
            >
              <SelectTrigger id="sp-service">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {linked.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sp-package">Package / session type</Label>
            <Select
              value={packageId}
              onValueChange={(v) => {
                setPackageId(v);
                setDate(null);
              }}
            >
              <SelectTrigger id="sp-package">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Default duration ({service?.defaultDurationMinutes ?? "…"} min)</SelectItem>
                {packages.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} ({p.effectiveDurationMinutes} min)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {dates.error ? (
          <p className="text-sm text-destructive">{dates.error.message}</p>
        ) : (
          <MonthCalendar availableDates={available} selected={date} onSelect={setDate} onVisibleRangeChange={(from, to) => setRange({ from, to })} minDate={today} loading={dates.isPending} />
        )}
        {dates.data && available.size === 0 && <p className="text-sm text-muted-foreground">No free times this month. Check the weekly hours.</p>}

        {date && (
          <div className="grid gap-2">
            <p className="text-sm font-medium">{date}</p>
            {slots.isPending ? (
              <Skeleton className="h-10 w-full" />
            ) : slots.data?.slots.length ? (
              <div className="flex flex-wrap gap-1.5">
                {slots.data.slots.map((s) => (
                  <Badge key={s.startsAt} variant="secondary" className="px-2.5 py-1 text-sm">
                    {s.time}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No free times on this date.</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
