"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/dashboard/app-shell";
import { Pagination } from "@/components/tables/pagination";
import { BookingDetailDialog } from "@/components/bookings/booking-detail-dialog";
import { DayBookingsDialog } from "@/components/calendar/day-bookings-dialog";
import {
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
import { useDebounced } from "@/lib/hooks/use-debounced";

const CONFIRMED = "CONFIRMED";

export default function ProviderCalendarPage() {
  const [view, setView] = useState<CalendarView>("month");
  const [current, setCurrent] = useState(() => new Date());
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [viewingDate, setViewingDate] = useState<string | null>(null);
  const debounced = useDebounced(search);
  useEffect(() => setPage(1), [debounced, view]);

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

  const filters = { status: CONFIRMED, ...(debounced ? { search: debounced } : {}) };

  const gridQuery = useBookings({ page: 1, pageSize: 100, sort: "asc", ...(range ?? {}), ...filters });
  const listQuery = useBookings({ page, pageSize: 25, sort: "desc", ...filters });
  const { data, isPending, error } = view === "list" ? listQuery : gridQuery;
  const bookings = useMemo(() => data?.data ?? [], [data]);
  const byDate = useMemo(() => groupByDate(bookings), [bookings]);

  return (
    <div>
      <PageHeader title="Calendar" description="Your confirmed appointments only - never another provider's." />

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

      <div className="mb-4 relative w-full max-w-xs">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input aria-label="Search appointments" placeholder="Reference, name" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
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

      {view === "list" && <Pagination meta={data?.meta} onPage={setPage} noun="appointments" />}

      {viewingId && <BookingDetailDialog id={viewingId} onClose={() => setViewingId(null)} />}
      {viewingDate && <DayBookingsDialog date={viewingDate} status={CONFIRMED} onClose={() => setViewingDate(null)} />}
    </div>
  );
}
