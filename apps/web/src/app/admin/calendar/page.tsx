"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarPlus, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { BOOKING_STATUSES, BOOKING_STATUS_LABELS, SERVICE_DEFINITIONS, SERVICE_SLUGS, type ServiceSlug } from "@booking/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/dashboard/app-shell";
import { StatusFilter } from "@/components/tables/status-filter";
import { Pagination } from "@/components/tables/pagination";
import { NewBookingDialog } from "@/components/bookings/new-booking-dialog";
import { BookingDetailDialog } from "@/components/bookings/booking-detail-dialog";
import { DayBookingsDialog } from "@/components/calendar/day-bookings-dialog";
import {
  CHIP_STYLES,
  DayGrid,
  ListTable,
  MonthGrid,
  WeekGrid,
  addDays,
  groupByDate,
  headerLabel,
  isoOf,
  shiftCurrent,
  startOfWeek,
  type CalendarView,
} from "@/components/calendar/booking-calendar-grid";
import { useBookings } from "@/lib/api/bookings";
import { useProviders } from "@/lib/api/catalog";
import { useDebounced } from "@/lib/hooks/use-debounced";
import { usePermissions } from "@/lib/auth/hooks";
import { cn } from "@/lib/utils";

const STATUS_OPTIONS = BOOKING_STATUSES.map((s) => ({ value: s, label: BOOKING_STATUS_LABELS[s] }));

export default function AdminCalendarPage() {
  const { can } = usePermissions();
  const providers = useProviders({ pageSize: 100 });
  const [view, setView] = useState<CalendarView>("month");
  const [current, setCurrent] = useState(() => new Date());
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string[]>([]);
  const [providerId, setProviderId] = useState("all");
  const [service, setService] = useState("all");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [viewingDate, setViewingDate] = useState<string | null>(null);
  const debounced = useDebounced(search);
  useEffect(() => setPage(1), [debounced, status, providerId, service, view]);

  const range = useMemo(() => {
    if (view === "month") {
      const first = new Date(current.getFullYear(), current.getMonth(), 1);
      const gridStart = startOfWeek(first);
      return { from: isoOf(gridStart), to: isoOf(addDays(gridStart, 41)) };
    }
    if (view === "week") {
      const start = startOfWeek(current);
      return { from: isoOf(start), to: isoOf(addDays(start, 6)) };
    }
    if (view === "day") return { from: isoOf(current), to: isoOf(current) };
    return null;
  }, [view, current]);

  const filters = {
    ...(status.length ? { status: status.join(",") } : {}),
    ...(debounced ? { search: debounced } : {}),
    ...(providerId !== "all" ? { providerId } : {}),
    ...(service !== "all" ? { service: service as ServiceSlug } : {}),
  };

  const gridQuery = useBookings({ page: 1, pageSize: 100, sort: "asc", ...(range ?? {}), ...filters });
  const listQuery = useBookings({ page, pageSize: 25, sort: "desc", ...filters });
  const { data, isPending, error } = view === "list" ? listQuery : gridQuery;
  const bookings = useMemo(() => data?.data ?? [], [data]);
  const byDate = useMemo(() => groupByDate(bookings), [bookings]);

  return (
    <div>
      <PageHeader
        title="Calendar"
        description="Every provider's bookings and appointments."
        actions={
          can("bookings.create") && (
            <Button onClick={() => setCreating(true)}>
              <CalendarPlus className="size-4" /> New booking
            </Button>
          )
        }
      />

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-lg font-semibold">{headerLabel(view, current)}</p>
          {view !== "list" && (
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" className="size-8" onClick={() => setCurrent((c) => shiftCurrent(view, c, -1))} aria-label="Previous">
                <ChevronLeft className="size-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => setCurrent(new Date())}>
                Today
              </Button>
              <Button variant="outline" size="icon" className="size-8" onClick={() => setCurrent((c) => shiftCurrent(view, c, 1))} aria-label="Next">
                <ChevronRight className="size-4" />
              </Button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 self-start rounded-lg border bg-background p-1">
          {(["month", "week", "day", "list"] as const).map((v) => (
            <Button key={v} variant={view === v ? "secondary" : "ghost"} size="sm" className="h-8 capitalize" onClick={() => setView(v)}>
              {v}
            </Button>
          ))}
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <StatusFilter options={STATUS_OPTIONS} selected={status} onChange={setStatus} />
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Search bookings" placeholder="Reference, name, email, phone" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={service} onValueChange={setService}>
          <SelectTrigger className="w-44" aria-label="Filter by service">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All services</SelectItem>
            {SERVICE_SLUGS.map((s) => (
              <SelectItem key={s} value={s}>
                {SERVICE_DEFINITIONS[s].name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={providerId} onValueChange={setProviderId}>
          <SelectTrigger className="w-44" aria-label="Filter by provider">
            <SelectValue placeholder={providers.isPending ? "Loading…" : "All providers"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All providers</SelectItem>
            {providers.data?.data.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.displayName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        {BOOKING_STATUSES.map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className={cn("size-2.5 rounded-full", CHIP_STYLES[s])} /> {BOOKING_STATUS_LABELS[s]}
          </span>
        ))}
      </div>

      {error && <p className="mb-4 text-sm text-destructive">{error.message}</p>}

      {isPending ? (
        <Skeleton className="h-[36rem] w-full" />
      ) : view === "month" ? (
        <MonthGrid current={current} byDate={byDate} onDayClick={setViewingDate} onEventClick={setViewingId} />
      ) : view === "week" ? (
        <WeekGrid current={current} bookings={bookings} onEventClick={setViewingId} />
      ) : view === "day" ? (
        <DayGrid current={current} bookings={bookings} onEventClick={setViewingId} />
      ) : (
        <ListTable bookings={bookings} onEventClick={setViewingId} />
      )}

      {view === "list" && <Pagination meta={data?.meta} onPage={setPage} noun="bookings" />}

      {creating && <NewBookingDialog onClose={() => setCreating(false)} />}
      {viewingId && <BookingDetailDialog id={viewingId} onClose={() => setViewingId(null)} />}
      {viewingDate && <DayBookingsDialog date={viewingDate} onClose={() => setViewingDate(null)} />}
    </div>
  );
}
