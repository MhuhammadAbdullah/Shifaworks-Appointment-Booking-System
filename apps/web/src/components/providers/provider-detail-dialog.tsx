"use client";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ProviderDetailView } from "./provider-detail-view";

/** The full provider profile, opened as a popup from the providers list instead of navigating to its own page. */
export function ProviderDetailDialog({ id, onClose }: { id: string; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        {/* ProviderDetailView renders its own heading (the provider's name); this is for screen readers only. */}
        <DialogTitle className="sr-only">Provider details</DialogTitle>
        <div className="overflow-y-auto p-6">
          <ProviderDetailView id={id} onClose={onClose} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
