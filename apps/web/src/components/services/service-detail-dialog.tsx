"use client";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ServiceDetailView } from "./service-detail-view";

/** A service's full detail page, opened as a popup from the Services list instead of navigating to its own page. */
export function ServiceDetailDialog({ slug, onClose }: { slug: string; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        {/* ServiceDetailView renders its own heading (the service name); this is for screen readers only. */}
        <DialogTitle className="sr-only">Service details</DialogTitle>
        <div className="overflow-y-auto p-6">
          <ServiceDetailView slug={slug} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
