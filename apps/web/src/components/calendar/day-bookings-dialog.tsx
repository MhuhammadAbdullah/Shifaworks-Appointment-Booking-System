"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { BookingStatusBadge } from "@/components/bookings/status-badges";
import { BookingDetailDialog } from "@/components/bookings/booking-detail-dialog";
import { useBookings } from "@/lib/api/bookings";
import { formatTime } from "@/lib/format";

/** That day's bookings/appointments — opened from a calendar day cell. `status` narrows it (the provider calendar only ever shows confirmed). */
export function DayBookingsDialog({ date, status, onClose }: { date: string; status?: string; onClose: () => void }) {
  const [viewingId, setViewingId] = useState<string | null>(null);
  const { data, isPending, error } = useBookings({ from: date, to: date, pageSize: 100, sort: "asc", ...(status ? { status } : {}) });
  const bookings = data?.data ?? [];
  const label = new Date(`${date}T00:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="flex max-h-[85dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
          <DialogHeader className="shrink-0 border-b px-6 py-4">
            <DialogTitle>{label}</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            {isPending && <Skeleton className="h-40 w-full" />}
            {error && <p className="text-sm text-destructive">{error.message}</p>}
            {!isPending && !error && bookings.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No bookings on this date.</p>}
            <div className="grid gap-1.5">
              {bookings.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setViewingId(b.id)}
                  className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-accent/50"
                >
                  <span className="min-w-0">
                    <span className="block font-medium">{formatTime(b.startsAt, b.timezone)} - {b.customerName}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {b.serviceName} with {b.providerName} - {b.bookingNumber}
                    </span>
                  </span>
                  <BookingStatusBadge status={b.status} />
                </button>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {viewingId && <BookingDetailDialog id={viewingId} onClose={() => setViewingId(null)} />}
    </>
  );
}
