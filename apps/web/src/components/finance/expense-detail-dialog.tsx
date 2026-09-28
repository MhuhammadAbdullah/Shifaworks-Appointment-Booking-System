"use client";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ExpenseDetailView } from "./expense-detail-view";

/** The full expense detail, opened as a popup from the expenses list instead of navigating to its own page. */
export function ExpenseDetailDialog({ id, onClose }: { id: string; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        {/* ExpenseDetailView renders its own heading (the expense number); this is for screen readers only. */}
        <DialogTitle className="sr-only">Expense details</DialogTitle>
        <div className="overflow-y-auto p-6">
          <ExpenseDetailView id={id} onClose={onClose} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
