"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import {
  AVAILABILITY_EXCEPTION_TYPES,
  EXCEPTION_TYPE_LABELS,
  hhmmToMinutes,
  type AvailabilityDto,
  type AvailabilityExceptionType as ExceptionType,
  type CreateExceptionInput,
  type ProviderDto,
  type TimeInterval,
} from "@booking/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Field } from "@/components/forms/field";
import { Pagination } from "@/components/tables/pagination";
import {
  useAddBlock,
  useAddException,
  useAvailability,
  useBulkAddExceptions,
  useProvider,
  useRemoveBlock,
  useRemoveException,
} from "@/lib/api/catalog";
import { ApiError } from "@/lib/api-client";
import { usePagedItems } from "@/lib/hooks/use-paged-items";
import { formatDateTime, zonedLocalToIso } from "@/lib/format";
import { cn } from "@/lib/utils";

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);
const ALL_SERVICES = "all";
type ProviderService = ProviderDto["services"][number];

function validIntervals(list: TimeInterval[]): string | null {
  const sorted = [...list].sort((a, b) => hhmmToMinutes(a.start) - hhmmToMinutes(b.start));
  for (const [i, iv] of sorted.entries()) {
    if (!iv.start || !iv.end) return "Fill in every start and end time";
    if (hhmmToMinutes(iv.end) <= hhmmToMinutes(iv.start)) return `${iv.start}–${iv.end}: end must be after start`;
    if (i > 0 && hhmmToMinutes(iv.start) < hhmmToMinutes(sorted[i - 1]!.end)) return "Some intervals overlap";
  }
  return null;
}

/** Per-date custom hours, leave/holidays and blocked time for one provider. */
export function AvailabilityEditor({ providerId, readOnly = false }: { providerId: string; readOnly?: boolean }) {
  const { data, isPending, error } = useAvailability(providerId);
  const { data: provider } = useProvider(providerId);
  const services = provider?.services ?? [];
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);

  if (isPending) return <Skeleton className="h-96 w-full" />;
  if (error || !data) return <p className="text-destructive">{error?.message ?? "Could not load availability"}</p>;

  return (
    <div className="grid gap-6">
      {services.length > 1 && (
        <div className="grid max-w-sm gap-1.5">
          <Label htmlFor="av-service">Service</Label>
          <Select value={selectedServiceId ?? ALL_SERVICES} onValueChange={(v) => setSelectedServiceId(v === ALL_SERVICES ? null : v)}>
            <SelectTrigger id="av-service">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_SERVICES}>All services (shared hours)</SelectItem>
              {services.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            This provider offers more than one service - set shared hours, or pick a service to give it its own dates and times.
          </p>
        </div>
      )}
      <CustomHoursCalendarCard providerId={providerId} availability={data} readOnly={readOnly} services={services} selectedServiceId={selectedServiceId} />
      <div className="grid gap-6 lg:grid-cols-2">
        <ExceptionsCard providerId={providerId} availability={data} readOnly={readOnly} services={services} selectedServiceId={selectedServiceId} />
        <BlocksCard providerId={providerId} availability={data} readOnly={readOnly} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Custom hours by date — pick any dates on the calendar (a scattered handful,
// or the whole month), then set each one's own time range(s). No two selected
// dates need matching hours, and a single date can have more than one range
// (e.g. 09:00-12:00 and 15:00-18:00).
// ---------------------------------------------------------------------------

interface Cursor {
  year: number;
  month: number; // 0-based
}
const CAL_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const pad2 = (n: number) => String(n).padStart(2, "0");
const isoOf = (c: Cursor, day: number) => `${c.year}-${pad2(c.month + 1)}-${pad2(day)}`;
const daysInMonth = (c: Cursor) => new Date(Date.UTC(c.year, c.month + 1, 0)).getUTCDate();
const firstWeekday = (c: Cursor) => new Date(Date.UTC(c.year, c.month, 1)).getUTCDay();
const shiftMonth = (c: Cursor, by: number): Cursor => {
  const total = c.year * 12 + c.month + by;
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
};
function addIsoDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function eachIsoDate(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 400; d = addIsoDays(d, 1)) out.push(d);
  return out;
}
const defaultInterval: TimeInterval[] = [{ start: "09:00", end: "17:00" }];

function CustomHoursCalendarCard({
  providerId,
  availability,
  readOnly,
  services,
  selectedServiceId,
}: {
  providerId: string;
  availability: AvailabilityDto;
  readOnly: boolean;
  services: ProviderService[];
  selectedServiceId: string | null;
}) {
  const bulkAdd = useBulkAddExceptions(providerId);
  const remove = useRemoveException(providerId);
  const today = new Date().toISOString().slice(0, 10);
  const [cursor, setCursor] = useState<Cursor>({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) - 1 });
  const [selected, setSelected] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Map<string, TimeInterval[]>>(new Map());
  const scopedServiceName = services.find((s) => s.id === selectedServiceId)?.name;

  // Provider-wide overrides (serviceId null) always apply; a service-scoped one only when it's the one being viewed.
  const relevant = availability.exceptions.filter((e) => e.serviceId === null || e.serviceId === selectedServiceId);
  const statusByDate = new Map<string, "CUSTOM_HOURS" | "OFF">();
  const customByDate = new Map<string, TimeInterval[]>();
  const exceptionIdByDate = new Map<string, string>();
  for (const e of relevant) {
    for (const d of eachIsoDate(e.startDate, e.endDate)) {
      statusByDate.set(d, e.type === "CUSTOM_HOURS" ? "CUSTOM_HOURS" : "OFF");
      if (e.type === "CUSTOM_HOURS") {
        customByDate.set(d, e.intervals);
        exceptionIdByDate.set(d, e.id);
      }
    }
  }

  // Every date with custom hours already set shows beside the calendar by default, editable right away —
  // not just dates freshly clicked this session.
  useEffect(() => {
    const dates = [...customByDate.keys()].sort();
    setSelected(dates);
    setDrafts(new Map(dates.map((d) => [d, customByDate.get(d)!.map((iv) => ({ ...iv }))])));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reseed only when the server data or scope changes, not on every local edit
  }, [availability, selectedServiceId]);

  function removeDate(date: string) {
    if (readOnly) return;
    const id = exceptionIdByDate.get(date);
    setSelected((prev) => prev.filter((d) => d !== date));
    setDrafts((m) => {
      const next = new Map(m);
      next.delete(date);
      return next;
    });
    if (id) remove.mutate(id, { onError: (e) => toast.error(errorText(e, "Could not remove")) });
  }

  function toggleDate(date: string) {
    if (readOnly) return;
    if (selected.includes(date)) {
      removeDate(date);
      return;
    }
    setDrafts((m) => new Map(m).set(date, customByDate.get(date) ?? defaultInterval.map((iv) => ({ ...iv }))));
    setSelected((prev) => [...prev, date].sort());
  }

  function selectWholeMonth() {
    if (readOnly) return;
    const lastDay = daysInMonth(cursor);
    const monthDates = Array.from({ length: lastDay }, (_, i) => isoOf(cursor, i + 1));
    setSelected((prev) => [...new Set([...prev, ...monthDates])].sort());
    setDrafts((m) => {
      const next = new Map(m);
      for (const d of monthDates) if (!next.has(d)) next.set(d, customByDate.get(d) ?? defaultInterval.map((iv) => ({ ...iv })));
      return next;
    });
  }

  function setDraft(date: string, intervals: TimeInterval[]) {
    setDrafts((m) => new Map(m).set(date, intervals));
  }

  function applyFirstToAll() {
    const first = selected[0];
    if (!first) return;
    const template = drafts.get(first);
    if (!template) return;
    setDrafts((m) => {
      const next = new Map(m);
      for (const d of selected) next.set(d, template.map((iv) => ({ ...iv })));
      return next;
    });
  }

  function clearSelection() {
    setSelected([]);
    setDrafts(new Map());
  }

  function submit() {
    const items: CreateExceptionInput[] = [];
    for (const date of selected) {
      const intervals = drafts.get(date) ?? [];
      const problem = validIntervals(intervals);
      if (problem) return toast.error(`${date}: ${problem}`);
      items.push({ type: "CUSTOM_HOURS", ...(selectedServiceId ? { serviceId: selectedServiceId } : {}), startDate: date, endDate: date, intervals });
    }
    if (items.length === 0) return toast.error("Select at least one date");
    bulkAdd.mutate(
      { items },
      {
        onSuccess: () => {
          toast.success(`${items.length} date${items.length === 1 ? "" : "s"} saved`);
          clearSelection();
        },
        onError: (e) => toast.error(errorText(e, "Could not save")),
      },
    );
  }

  const leading = firstWeekday(cursor);
  const lastDay = daysInMonth(cursor);
  const trailing = (7 - ((leading + lastDay) % 7)) % 7;
  const monthLabel = new Date(Date.UTC(cursor.year, cursor.month, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Custom hours by date{scopedServiceName ? ` - ${scopedServiceName}` : ""}</CardTitle>
        <CardDescription>
          Pick any dates below - a few scattered days, or the whole month - then set each one&apos;s own time range(s).
          Dates don&apos;t need to match each other, and one date can have more than one range (e.g. a morning and an
          evening slot). {scopedServiceName ? `These hours apply only to ${scopedServiceName}.` : "These hours are shared across every service this provider offers."}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full border-2 border-primary" /> Has custom hours (shown in the list)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-muted-foreground/50" /> Off / leave / holiday
          </span>
        </div>

        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <div className="w-full max-w-2xl shrink-0 rounded-lg border p-3">
            <div className="mb-2 flex items-center justify-between">
              <Button type="button" variant="ghost" size="icon" className="size-7" onClick={() => setCursor((c) => shiftMonth(c, -1))} aria-label="Previous month">
                <ChevronLeft className="size-4" />
              </Button>
              <p className="text-sm font-medium">{monthLabel}</p>
              <Button type="button" variant="ghost" size="icon" className="size-7" onClick={() => setCursor((c) => shiftMonth(c, 1))} aria-label="Next month">
                <ChevronRight className="size-4" />
              </Button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted-foreground">
              {CAL_WEEKDAYS.map((w) => (
                <div key={w} className="py-1">
                  {w}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: leading }, (_, i) => (
                <div key={`lead-${i}`} />
              ))}
              {Array.from({ length: lastDay }, (_, i) => {
                const d = isoOf(cursor, i + 1);
                const isSelected = selected.includes(d);
                const status = statusByDate.get(d);
                const isToday = d === today;
                return (
                  <button
                    key={d}
                    type="button"
                    disabled={readOnly}
                    onClick={() => toggleDate(d)}
                    className={cn(
                      "flex aspect-square flex-col items-center justify-center gap-0.5 rounded-md text-sm transition-colors hover:bg-accent disabled:cursor-not-allowed",
                      isSelected && "border-2 border-primary font-medium",
                      !isSelected && status === "OFF" && "bg-muted-foreground/10 text-muted-foreground",
                      isToday && "ring-2 ring-ring",
                    )}
                  >
                    {i + 1}
                  </button>
                );
              })}
              {Array.from({ length: trailing }, (_, i) => (
                <div key={`trail-${i}`} />
              ))}
            </div>
            {!readOnly && (
              <div className="mt-2 flex flex-wrap gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={selectWholeMonth}>
                  Select whole month
                </Button>
                {selected.length > 0 && (
                  <Button type="button" variant="ghost" size="sm" onClick={clearSelection}>
                    Clear selection
                  </Button>
                )}
              </div>
            )}
          </div>

          {selected.length > 0 && (
            <div className="grid w-full gap-3 rounded-md bg-muted/50 p-3 lg:max-h-[26rem] lg:flex-1 lg:overflow-y-auto">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">
                  {selected.length} date{selected.length === 1 ? "" : "s"} selected
                </p>
                {!readOnly && selected.length > 1 && (
                  <Button type="button" variant="ghost" size="sm" onClick={applyFirstToAll}>
                    Use {selected[0]}&apos;s hours for all
                  </Button>
                )}
              </div>
              <div className="grid gap-3">
                {selected.map((date) => {
                  const intervals = drafts.get(date) ?? [];
                  return (
                    <div key={date} className="grid gap-1.5 border-b pb-2 last:border-0">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{date}</span>
                        {!readOnly && (
                          <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${date}`} onClick={() => removeDate(date)}>
                            <X className="size-4" />
                          </Button>
                        )}
                      </div>
                      {intervals.map((iv, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <Input
                            type="time"
                            aria-label={`${date} start ${i + 1}`}
                            className="w-32"
                            disabled={readOnly}
                            value={iv.start}
                            onChange={(e) => setDraft(date, intervals.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))}
                          />
                          <span className="text-muted-foreground">–</span>
                          <Input
                            type="time"
                            aria-label={`${date} end ${i + 1}`}
                            className="w-32"
                            disabled={readOnly}
                            value={iv.end}
                            onChange={(e) => setDraft(date, intervals.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))}
                          />
                          {!readOnly && intervals.length > 1 && (
                            <Button type="button" variant="ghost" size="icon" aria-label="Remove range" onClick={() => setDraft(date, intervals.filter((_, j) => j !== i))}>
                              <X className="size-4" />
                            </Button>
                          )}
                        </div>
                      ))}
                      {!readOnly && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="justify-self-start"
                          onClick={() => setDraft(date, [...intervals, { start: "15:00", end: "17:00" }])}
                        >
                          <Plus className="size-4" /> Add range
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </CardContent>
      {!readOnly && selected.length > 0 && (
        <CardFooter className="justify-end">
          <Button onClick={submit} disabled={bulkAdd.isPending}>
            {bulkAdd.isPending ? "Saving…" : `Save ${selected.length} date${selected.length === 1 ? "" : "s"}`}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}

const EXCEPTION_LABEL = EXCEPTION_TYPE_LABELS;
const OFF_EXCEPTION_TYPES = AVAILABILITY_EXCEPTION_TYPES.filter((t) => t !== "CUSTOM_HOURS");

function ExceptionsCard({
  providerId,
  availability,
  readOnly,
  services,
  selectedServiceId,
}: {
  providerId: string;
  availability: AvailabilityDto;
  readOnly: boolean;
  services: ProviderService[];
  selectedServiceId: string | null;
}) {
  const add = useAddException(providerId);
  const remove = useRemoveException(providerId);
  const [type, setType] = useState<Exclude<ExceptionType, "CUSTOM_HOURS">>("LEAVE");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  // Custom-hours dates have their own list next to the calendar above.
  const offExceptions = availability.exceptions.filter((e) => e.type !== "CUSTOM_HOURS");
  const paged = usePagedItems(offExceptions);
  const serviceName = (id: string | null) => (id ? (services.find((s) => s.id === id)?.name ?? "Unknown service") : "All services");

  function submit() {
    if (!startDate) return toast.error("Choose a start date");
    add.mutate(
      {
        type,
        ...(selectedServiceId ? { serviceId: selectedServiceId } : {}),
        startDate,
        endDate: endDate || startDate,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      },
      {
        onSuccess: () => {
          toast.success("Saved");
          setStartDate("");
          setEndDate("");
          setReason("");
        },
        onError: (e) => toast.error(errorText(e, "Could not save")),
      },
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Days off, leave &amp; holidays</CardTitle>
        <CardDescription>Dates that are simply closed, unlike the calendar above which sets working hours.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {offExceptions.length === 0 && <p className="text-sm text-muted-foreground">None scheduled.</p>}
        <ul className="grid gap-2">
          {paged.pageItems.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm">
              <div>
                <Badge variant="secondary" className="mr-2">
                  {EXCEPTION_LABEL[e.type]}
                </Badge>
                {services.length > 1 && (
                  <Badge variant="outline" className="mr-2">
                    {serviceName(e.serviceId)}
                  </Badge>
                )}
                {e.startDate}
                {e.endDate !== e.startDate && ` → ${e.endDate}`}
                {e.intervals.length > 0 && <span className="text-muted-foreground"> · {e.intervals.map((i) => `${i.start}–${i.end}`).join(", ")}</span>}
                {e.reason && <div className="text-xs text-muted-foreground">{e.reason}</div>}
              </div>
              {!readOnly && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Remove exception"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(e.id, { onError: (err) => toast.error(errorText(err, "Could not remove")) })}
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
        <Pagination meta={paged.meta} onPage={paged.setPage} noun="exceptions" />
        {!readOnly && (
          <div className="grid gap-3 rounded-md bg-muted/50 p-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field id="ex-type" label="Type" required>
                <Select value={type} onValueChange={(v) => setType(v as Exclude<ExceptionType, "CUSTOM_HOURS">)}>
                  <SelectTrigger id="ex-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OFF_EXCEPTION_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {EXCEPTION_LABEL[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field id="ex-start" label="From" required>
                <Input id="ex-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </Field>
              <Field id="ex-end" label="To" optional info="Leave empty for a single day">
                <Input id="ex-end" type="date" min={startDate} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </Field>
            </div>
            <Field id="ex-reason" label="Reason" optional>
              <Input id="ex-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <Button onClick={submit} disabled={add.isPending} className="justify-self-end">
              Add
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BlocksCard({ providerId, availability, readOnly }: { providerId: string; availability: AvailabilityDto; readOnly: boolean }) {
  const add = useAddBlock(providerId);
  const remove = useRemoveBlock(providerId);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [reason, setReason] = useState("");
  const tz = availability.timezone;

  const toIso = (local: string) => zonedLocalToIso(local, tz);
  const paged = usePagedItems(availability.blockedSlots);

  function submit() {
    if (!start || !end) return toast.error("Choose a start and end");
    add.mutate(
      { startsAt: toIso(start), endsAt: toIso(end), ...(reason.trim() ? { reason: reason.trim() } : {}) },
      {
        onSuccess: () => {
          toast.success("Time blocked");
          setStart("");
          setEnd("");
          setReason("");
        },
        onError: (e) => toast.error(errorText(e, "Could not block time")),
      },
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Blocked time</CardTitle>
        <CardDescription>One-off unavailability (meetings, training). Times in {tz}.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {availability.blockedSlots.length === 0 && <p className="text-sm text-muted-foreground">Nothing blocked.</p>}
        <ul className="grid gap-2">
          {paged.pageItems.map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm">
              <div>
                {formatDateTime(b.startsAt, tz)} → {formatDateTime(b.endsAt, tz)}
                {b.reason && <div className="text-xs text-muted-foreground">{b.reason}</div>}
              </div>
              {!readOnly && (
                <Button variant="ghost" size="icon" aria-label="Remove block" onClick={() => remove.mutate(b.id, { onError: (e) => toast.error(errorText(e, "Could not remove")) })}>
                  <Trash2 className="size-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
        <Pagination meta={paged.meta} onPage={paged.setPage} noun="blocked periods" />
        {!readOnly && (
          <div className="grid gap-3 rounded-md bg-muted/50 p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="bl-start" label="From" required>
                <Input id="bl-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
              </Field>
              <Field id="bl-end" label="To" required>
                <Input id="bl-end" type="datetime-local" min={start} value={end} onChange={(e) => setEnd(e.target.value)} />
              </Field>
            </div>
            <Field id="bl-reason" label="Reason" optional>
              <Input id="bl-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <Button onClick={submit} disabled={add.isPending} className="justify-self-end">
              Block time
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
