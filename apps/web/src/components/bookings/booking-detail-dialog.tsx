"use client";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { BookingDetailView } from "./booking-detail-view";

/** The full booking detail view, opened as a popup from a bookings list instead of navigating to its own page. */
export function BookingDetailDialog({ id, onClose }: { id: string; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        {/* BookingDetailView renders its own heading (booking number); this is for screen readers only. */}
        <DialogTitle className="sr-only">Booking details</DialogTitle>
        <div className="overflow-y-auto p-6">
          <BookingDetailView id={id} onClose={onClose} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
