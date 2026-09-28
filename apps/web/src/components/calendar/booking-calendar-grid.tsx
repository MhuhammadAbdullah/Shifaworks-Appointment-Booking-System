"use client";

import type { BookingListItemDto, BookingStatus } from "@booking/shared";
import { BookingStatusBadge, PaymentStatusBadge } from "@/components/bookings/status-badges";
import { formatDateTime, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export type CalendarView = "month" | "week" | "day" | "list";

/** Solid chip colors for events inside the grid — same hue families as the status badge, just filled in. */
export const CHIP_STYLES: Record<BookingStatus, string> = {
  PENDING_PAYMENT: "bg-amber-500",
  PAYMENT_SUBMITTED: "bg-sky-500",
  PAYMENT_VERIFIED: "bg-sky-500",
  CONFIRMED: "bg-emerald-500",
  CANCELLED: "bg-muted-foreground/50",
  COMPLETED: "bg-violet-500",
  NO_SHOW: "bg-rose-500",
  RESCHEDULED: "bg-muted-foreground/50",
};

const HOURS = Array.from({ length: 16 }, (_, i) => i + 7); // 07:00 - 22:00, clinic hours

const pad = (n: number) => String(n).padStart(2, "0");
export const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const addDays = (d: Date, n: number) => {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
};
export const startOfWeek = (d: Date) => addDays(d, -d.getDay());
const localDateOf = (iso: string, tz: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: tz });
const localHourOf = (iso: string, tz: string) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(new Date(iso)));

export function shiftCurrent(view: CalendarView, current: Date, dir: 1 | -1): Date {
  const d = new Date(current);
  if (view === "month") d.setMonth(d.getMonth() + dir);
  else if (view === "week") d.setDate(d.getDate() + dir * 7);
  else d.setDate(d.getDate() + dir);
  return d;
}

export function headerLabel(view: CalendarView, current: Date): string {
  if (view === "month") return current.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  if (view === "week") return `Week of ${startOfWeek(current).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;
  if (view === "day") return current.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return "All bookings";
}

/** Groups bookings by their local calendar date, sorted by start time within each day. */
export function groupByDate(bookings: BookingListItemDto[]): Map<string, BookingListItemDto[]> {
  const map = new Map<string, BookingListItemDto[]>();
  for (const b of bookings) {
    const d = localDateOf(b.startsAt, b.timezone);
    if (!map.has(d)) map.set(d, []);
    map.get(d)!.push(b);
  }
  for (const arr of map.values()) arr.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return map;
}

export function EventChip({ b, onClick }: { b: BookingListItemDto; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={`${formatTime(b.startsAt, b.timezone)} - ${b.customerName} (${b.serviceName})`}
      className={cn("w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] font-medium text-white transition-transform hover:scale-[1.02]", CHIP_STYLES[b.status])}
    >
      {formatTime(b.startsAt, b.timezone)} {b.customerName}
    </button>
  );
}

export function MonthGrid({
  current,
  byDate,
  onDayClick,
  onEventClick,
}: {
  current: Date;
  byDate: Map<string, BookingListItemDto[]>;
  onDayClick: (date: string) => void;
  onEventClick: (id: string) => void;
}) {
  const today = isoOf(new Date());
  const first = new Date(current.getFullYear(), current.getMonth(), 1);
  const gridStart = startOfWeek(first);
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="grid grid-cols-7 border-b">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((w) => (
          <div key={w} className="border-r p-2 text-center text-xs font-medium text-muted-foreground last:border-r-0">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day, i) => {
          const d = isoOf(day);
          const isCurrentMonth = day.getMonth() === current.getMonth();
          const isToday = d === today;
          const dayEvents = byDate.get(d) ?? [];
          return (
            <button
              type="button"
              key={i}
              onClick={() => onDayClick(d)}
              className={cn(
                "min-h-24 border-r border-b p-1.5 text-left transition-colors last:border-r-0 hover:bg-accent/50 sm:min-h-28",
                !isCurrentMonth && "bg-muted/30",
              )}
            >
              <span className={cn("mb-1 flex size-6 items-center justify-center rounded-full text-sm", isToday && "bg-primary font-semibold text-primary-foreground", !isCurrentMonth && "text-muted-foreground/50")}>
                {day.getDate()}
              </span>
              <div className="space-y-1">
                {dayEvents.slice(0, 3).map((b) => (
                  <EventChip key={b.id} b={b} onClick={() => onEventClick(b.id)} />
                ))}
                {dayEvents.length > 3 && <div className="text-[10px] text-muted-foreground">+{dayEvents.length - 3} more</div>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function HourGrid({ columns, bookings, onEventClick }: { columns: Date[]; bookings: BookingListItemDto[]; onEventClick: (id: string) => void }) {
  const at = (day: Date, hour: number) =>
    bookings.filter((b) => localDateOf(b.startsAt, b.timezone) === isoOf(day) && localHourOf(b.startsAt, b.timezone) === hour);

  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <div className="grid min-w-[640px]" style={{ gridTemplateColumns: `4rem repeat(${columns.length}, 1fr)` }}>
        <div className="border-r border-b p-2" />
        {columns.map((day) => (
          <div key={day.toISOString()} className="border-r border-b p-2 text-center text-xs font-medium last:border-r-0">
            {day.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
          </div>
        ))}
        {HOURS.map((hour) => (
          <div key={`row-${hour}`} className="contents">
            <div className="border-r border-b p-2 text-xs text-muted-foreground">{pad(hour)}:00</div>
            {columns.map((day) => {
              const cell = at(day, hour);
              return (
                <div key={`${day.toISOString()}-${hour}`} className="min-h-14 space-y-1 border-r border-b p-1 last:border-r-0">
                  {cell.map((b) => (
                    <EventChip key={b.id} b={b} onClick={() => onEventClick(b.id)} />
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export function WeekGrid({ current, bookings, onEventClick }: { current: Date; bookings: BookingListItemDto[]; onEventClick: (id: string) => void }) {
  const start = startOfWeek(current);
  const columns = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  return <HourGrid columns={columns} bookings={bookings} onEventClick={onEventClick} />;
}

export function DayGrid({ current, bookings, onEventClick }: { current: Date; bookings: BookingListItemDto[]; onEventClick: (id: string) => void }) {
  return <HourGrid columns={[current]} bookings={bookings} onEventClick={onEventClick} />;
}

export function ListTable({ bookings, onEventClick }: { bookings: BookingListItemDto[]; onEventClick: (id: string) => void }) {
  if (bookings.length === 0) return <p className="py-8 text-center text-sm text-muted-foreground">No bookings match these filters.</p>;
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="divide-y">
        {bookings.map((b) => (
          <button key={b.id} type="button" onClick={() => onEventClick(b.id)} className="flex w-full items-center justify-between gap-3 p-3 text-left text-sm transition-colors hover:bg-accent/50">
            <span className={cn("size-2.5 shrink-0 rounded-full", CHIP_STYLES[b.status])} />
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{b.customerName}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {b.serviceName} with {b.providerName} - {b.bookingNumber}
              </span>
            </span>
            <span className="shrink-0 text-right text-xs text-muted-foreground">{formatDateTime(b.startsAt, b.timezone)}</span>
            <BookingStatusBadge status={b.status} />
            <PaymentStatusBadge status={b.paymentStatus} />
          </button>
        ))}
      </div>
    </div>
  );
}
