"use client";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { InvoiceDetailView } from "./invoice-detail-view";

/** The full invoice (or pay slip) detail, opened as a popup from the invoices list instead of navigating to its own page. */
export function InvoiceDetailDialog({ id, onClose }: { id: string; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        {/* InvoiceDetailView renders its own heading (the invoice number); this is for screen readers only. */}
        <DialogTitle className="sr-only">Invoice details</DialogTitle>
        <div className="overflow-y-auto p-6">
          <InvoiceDetailView id={id} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
