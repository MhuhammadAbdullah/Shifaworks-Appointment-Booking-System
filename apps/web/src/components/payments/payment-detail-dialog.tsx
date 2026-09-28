"use client";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { PaymentDetailView } from "./payment-detail-view";

/** The full payment detail, opened as a popup from the payments list instead of navigating to its own page. */
export function PaymentDetailDialog({ id, onClose }: { id: string; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        {/* PaymentDetailView renders its own heading (the payment number); this is for screen readers only. */}
        <DialogTitle className="sr-only">Payment details</DialogTitle>
        <div className="overflow-y-auto p-6">
          <PaymentDetailView id={id} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
